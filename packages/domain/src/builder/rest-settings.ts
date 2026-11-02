import {
  REST_DEFAULT_KEYS,
  REST_DEFAULT_LIMITS,
  coachEditStepOpId,
  type CoachEditStep,
  type CoachEditTodayCommand,
  type FitRestLevel,
  type RestDefaultKey,
  type RestSettings,
  type SessionAggregate,
  type SessionExercise,
  type TrainingProfile,
  type WorkoutSet,
  type ZonedTimestamp,
} from "@fizz/schemas";
import { stableStringify } from "../stable";
import { todayMainIds } from "../session/time-fit-today";
import {
  defaultRestS,
  REST_DEFAULT_ROWS,
  REST_LEVEL_NAMES,
  restClockText,
  restDefaultsOf,
  SHORTEN_MAIN_COPY,
  type RestDefaults,
  type RestRole,
} from "./rest";
import type { BuilderInfoLookup, RestKind } from "./types";

/**
 * (Ben, 2 Nov) The coach's `update_rest_settings`: Ben's rest settings (Profile › Rest times, `Rest when short on time`,
 * `Shorten main lift too`) changed from his words, at once with Undo (they are his settings). Pure.
 *
 * - `restSettingsOf`: the profile's settings as one snapshot (what Undo puts back).
 * - `restSettingsChange`: the coach's request on that snapshot, checked with Rest times' own limits (0:30–6:00, 15 s
 *   steps): a value outside them is refused with one line, never rounded or clamped. A rest set to the standard value
 *   is stored as the standard (no own value). Lines read as Profile does (`Isolation 1:30 → 2:00`).
 * - `restTodayCommand`: `Today too?`: the live workout's pending sets whose rest is the old default for their set type
 *   get the new one, as one `coach_edit_today` of `edit_planned_set` rest steps (Undo: `revert_coach_edit`). A rest Ben
 *   set himself, one the coach or a time fit set, warm-ups before the first working set and rests before a drop never
 *   move; done sets never change (rule 2).
 */

export function restSettingsOf(
  p: Pick<
    TrainingProfile,
    "restDefaultsS" | "fitRestLevel" | "fitShortenMain"
  > | null,
): RestSettings {
  const own = p?.restDefaultsS;
  return {
    restDefaultsS:
      own === undefined || Object.keys(own).length === 0 ? null : { ...own },
    fitRestLevel: p?.fitRestLevel ?? null,
    fitShortenMain: p?.fitShortenMain === true,
  };
}

export const sameRestSettings = (a: RestSettings, b: RestSettings): boolean =>
  stableStringify(a) === stableStringify(b);

/** The rest defaults a snapshot gives (as `restDefaultsOf` reads a profile). */
export function restDefaultsOfSettings(s: RestSettings): RestDefaults {
  return restDefaultsOf({
    ...(s.restDefaultsS === null ? {} : { restDefaultsS: s.restDefaultsS }),
    fitShortenMain: s.fitShortenMain,
  });
}

export interface RestSettingsRequest {
  rests: readonly { setType: RestDefaultKey; seconds: number | null }[];
  whenShort: FitRestLevel | null;
  shortenMain: boolean | null;
}

export type RestSettingsChange =
  | { kind: "ok"; after: RestSettings; lines: string[] }
  /** Nothing differs from what he has (`Already 2:00`). */
  | { kind: "already"; line: string }
  | { kind: "invalid"; line: string };

const LABEL: Readonly<Record<RestDefaultKey, string>> = Object.fromEntries(
  REST_DEFAULT_ROWS.map((r) => [r.key, r.label]),
) as Record<RestDefaultKey, string>;

/** The value a rest key has under a snapshot: his own, else the standard (exactly as Profile › Rest times shows it). */
export function restValueOf(s: RestSettings, key: RestDefaultKey): number {
  const d = restDefaultsOfSettings(s);
  if (key === "warmup") return defaultRestS("warmup", "isolation", "normal", d);
  if (key === "round") return defaultRestS("round", "isolation", "normal", d);
  if (key === "top") return defaultRestS("top", "main", "normal", d);
  if (key === "backoff") return defaultRestS("backoff", "main", "normal", d);
  return defaultRestS(
    "working",
    key === "workingMain"
      ? "main"
      : key === "workingCompound"
        ? "compound"
        : "isolation",
    "normal",
    d,
  );
}

export function restSettingsChange(
  before: RestSettings,
  req: RestSettingsRequest,
): RestSettingsChange {
  const L = REST_DEFAULT_LIMITS;
  const own = new Map<RestDefaultKey, number>(
    REST_DEFAULT_KEYS.flatMap((k) => {
      const v = before.restDefaultsS?.[k];
      return v === undefined ? [] : [[k, v] as const];
    }),
  );
  const standard = restSettingsOf(null);
  for (const r of req.rests) {
    if (r.seconds === null) {
      own.delete(r.setType);
      continue;
    }
    if (r.seconds < L.minS || r.seconds > L.maxS || r.seconds % L.stepS !== 0) {
      return {
        kind: "invalid",
        line: `Rest times go from ${restClockText(L.minS)} to ${restClockText(L.maxS)} in ${String(L.stepS)} s steps`,
      };
    }
    // The standard value is stored as the standard (no own value), as Rest times' `Default`.
    if (r.seconds === restValueOf(standard, r.setType)) own.delete(r.setType);
    else own.set(r.setType, r.seconds);
  }
  const ordered: Partial<Record<RestDefaultKey, number>> = {};
  for (const k of REST_DEFAULT_KEYS) {
    const v = own.get(k);
    if (v !== undefined) ordered[k] = v;
  }
  const after: RestSettings = {
    restDefaultsS: Object.keys(ordered).length === 0 ? null : ordered,
    fitRestLevel: req.whenShort ?? before.fitRestLevel,
    fitShortenMain: req.shortenMain ?? before.fitShortenMain,
  };
  const lines: string[] = [];
  for (const k of REST_DEFAULT_KEYS) {
    const a = restValueOf(before, k);
    const b = restValueOf(after, k);
    if (a !== b)
      lines.push(`${LABEL[k]} ${restClockText(a)} → ${restClockText(b)}`);
  }
  const levelOf = (s: RestSettings) => s.fitRestLevel ?? "shortest";
  if (levelOf(before) !== levelOf(after))
    lines.push(`When short on time: ${REST_LEVEL_NAMES[levelOf(after)]}`);
  if (before.fitShortenMain !== after.fitShortenMain)
    lines.push(
      `${SHORTEN_MAIN_COPY.label}: ${after.fitShortenMain ? "on" : "off"}`,
    );
  if (lines.length === 0) {
    const first = req.rests[0];
    const already =
      first !== undefined
        ? `Already ${restClockText(restValueOf(after, first.setType))}`
        : req.shortenMain !== null
          ? `${SHORTEN_MAIN_COPY.label} is already ${after.fitShortenMain ? "on" : "off"}`
          : req.whenShort !== null
            ? `Already ${REST_LEVEL_NAMES[levelOf(after)]}`
            : "Nothing to change";
    return { kind: "already", line: already };
  }
  return { kind: "ok", after, lines };
}

// ---------------------------------------------------------------------------
// `Today too?`

export interface RestTodayInput {
  aggregate: SessionAggregate;
  before: RestSettings;
  after: RestSettings;
  info: BuilderInfoLookup;
  /** The main lifts the workout was built with (as the time fit reads them). */
  mainExerciseIds?: ReadonlySet<string>;
}

export interface RestTodayStep {
  setId: string;
  expectedSetVersion: number;
  restS: number;
}

const pendingOf = (a: SessionAggregate, exId: string): WorkoutSet[] =>
  a.sets
    .filter((s) => s.sessionExerciseId === exId && s.status === "pending")
    .sort((x, y) => x.index - y.index);
const liveRowsOf = (a: SessionAggregate): SessionExercise[] =>
  a.exercises
    .filter((e) => e.removed === undefined)
    .sort((x, y) => x.order - y.order);

/** A rest set by Ben (or anyone but the planner): never moved by a settings change. */
function ownRest(s: WorkoutSet): boolean {
  return (
    s.planned.edit !== undefined ||
    s.rest.byOpId !== undefined ||
    s.rest.source === "set_override"
  );
}

/** The pending sets a rest-settings change moves today, each with its new rest. Empty: nothing there to change. */
export function restTodaySteps(input: RestTodayInput): RestTodayStep[] {
  const a = input.aggregate;
  if (a.session.status !== "active") return [];
  const was = restDefaultsOfSettings(input.before);
  const now = restDefaultsOfSettings(input.after);
  const live = liveRowsOf(a);
  const mains = todayMainIds(a, live, input.info, input.mainExerciseIds);
  const groupSize = new Map<string, SessionExercise[]>();
  for (const e of live)
    if (e.supersetGroup !== null)
      groupSize.set(e.supersetGroup, [
        ...(groupSize.get(e.supersetGroup) ?? []),
        e,
      ]);
  const out: RestTodayStep[] = [];
  for (const ex of live) {
    const role: RestRole = mains.has(ex.id)
      ? "main"
      : input.info(ex.exerciseId)?.role === "compound"
        ? "compound"
        : "isolation";
    const group =
      ex.supersetGroup === null ? undefined : groupSize.get(ex.supersetGroup);
    const inSuperset = group !== undefined && group.length > 1;
    // In a superset the only rest is `After each round`, after the round's last exercise.
    if (inSuperset && group.at(-1)?.id !== ex.id) continue;
    const all = a.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status !== "deleted")
      .sort((x, y) => x.index - y.index);
    const pending = new Set(pendingOf(a, ex.id).map((s) => s.id));
    all.forEach((s, i) => {
      if (!pending.has(s.id) || ownRest(s)) return;
      const next = all[i + 1];
      let kind: RestKind | "round";
      if (inSuperset) {
        if (s.setType === "warmup") return;
        kind = "round";
      } else if (s.setType !== "warmup" && next?.setType === "drop") return;
      else if (s.setType === "warmup") {
        // The last warm-up's rest depends on the working set after it (WU11), not on the default.
        if (next !== undefined && next.setType !== "warmup") return;
        kind = "warmup";
      } else kind = s.setType;
      const from = defaultRestS(kind, role, "normal", was);
      const to = defaultRestS(kind, role, "normal", now);
      if (from === to || s.rest.seconds !== from) return;
      out.push({ setId: s.id, expectedSetVersion: s.version, restS: to });
    });
  }
  return out;
}

/** `Today too?`'s command: one `coach_edit_today` (all or nothing, on the version read; rule 5). Null: nothing to change. */
export function restTodayCommand(
  input: RestTodayInput & {
    opId: string;
    actionId: string;
    at: ZonedTimestamp;
  },
): CoachEditTodayCommand | null {
  const steps = restTodaySteps(input).slice(0, 60);
  if (steps.length === 0) return null;
  const edits: CoachEditStep[] = steps.map((x, i) => ({
    type: "edit_planned_set",
    at: input.at,
    opId: coachEditStepOpId(input.opId, i),
    setId: x.setId,
    expectedSetVersion: x.expectedSetVersion,
    patch: { restS: x.restS },
  }));
  return {
    type: "coach_edit_today",
    at: input.at,
    opId: input.opId,
    expectedVersion: input.aggregate.session.version,
    actionId: input.actionId,
    steps: edits,
  };
}
