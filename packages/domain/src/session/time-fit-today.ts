import { coachEditStepOpId, type FitTodayStep, type FitTodayToTimeCommand, type SessionAggregate, type SessionExercise, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { estimateBuilderSeconds } from '../builder/estimate';
import { fitToMinutes, type BuilderFitStatus } from '../builder/fit';
import { restAfterRows, roundRestOf } from '../builder/rest';
import { reduceSession } from './reducer';
import type { BuilderBlock, BuilderContext, BuilderGroupName, BuilderInfoLookup, BuilderSetRow, BuilderSlot, BuilderWorkout, RestKind, RestLevel } from '../builder/types';

/**
 * The workout's `+N min` offer (workout-table-v3 §5; Ben, 20 Oct): the
 * builder's fit ladder (`fitToMinutes`: shorter accessory rests → RPE 9 → accessory
 * sets down to 2 → an exercise left out, never the main lift) over the sets not done yet, as one
 * offer. Pure: the screen shows `lines`, and only Ben's Apply sends
 * `fitTodayCommand` (rule 3: never applied unasked). Done sets are never in
 * it (rule 2); it only shortens rests, raises no load and adds nothing.
 *
 * Minutes are the builder's estimate of the sets left (§3.6 formula), not
 * the pace-based Time left: `savedMinutes` is what the fit takes off that.
 *
 * Left exactly as they are (review build-a B1, R1; CHANGELOG 21 Oct): sets Ben
 * edited himself (their rests included, and rests set with "Rest after"), pain-flagged movements (rule 9) and
 * exercises not counted in reps. Their rests are pinned at what they are, so
 * the estimate doesn't count time the fit won't take; a superset with one of
 * them keeps its round rest.
 *
 * The main lift (builder rule, workout-builder-v3 §2.0.2, kept the same here
 * so the workout and the builder agree): its sets and loads never change for
 * time, nor do its rests (Ben, 27 Oct). Accessory rests shorten only as far as
 * Ben's `Rest when short on time` (`fitRestLevel`; default Minimum rest): isolation
 * and round 1:30 → 1:15 → 1:00, a compound accessory 2:00 → 1:30, never lower.
 *
 * The target never collapses (review S3): the sets left are never fitted
 * below half their length. When the overrun is more than that, the offer is
 * the most it takes off (`status: 'over'`, shown as `Saves ≈ N min`).
 */

export interface TimeFitInput {
  aggregate: SessionAggregate;
  /** How far over the plan the workout runs (the header's `+N min`). */
  overByMinutes: number;
  info: BuilderInfoLookup;
  /** Pain-flagged movements (exercise IDs): never trimmed, pushed or dropped (rule 9). */
  painFlagged?: ReadonlySet<string>;
  /** Ben's rest presets (seconds), as the builder's. */
  restPresetsS?: readonly number[];
  /**
   * The main lifts the workout was built with (exercise IDs): the builder or
   * plan draft's `main` slots it started from (`session.coachDraft`). Absent
   * or empty: the plan day's main lift, else a Top set, else the first compound.
   */
  mainExerciseIds?: ReadonlySet<string>;
  /** (Ben, 27 Oct) Profile › Training › `Rest when short on time` (absent: `shortest`, Minimum rest), as the builder's. */
  fitRestLevel?: RestLevel;
}

/** One change, with its before → after (rule 2). */
export type TimeFitLine =
  | { kind: 'rest'; sessionExerciseId: string; name: string; fromS: number; toS: number; sets: number }
  | { kind: 'effort'; sessionExerciseId: string; name: string; from: number | null; to: number }
  | { kind: 'sets'; sessionExerciseId: string; name: string; from: number; to: number }
  | { kind: 'drop'; sessionExerciseId: string; name: string };

export interface TimeFitOffer {
  /** `fitted`: the sets left fit the time; `over`: the most it offers, short of the whole overrun; `none`: nothing to change. */
  status: BuilderFitStatus | 'none';
  beforeMinutes: number;
  afterMinutes: number;
  savedMinutes: number;
  /** The length the sets left were fitted to. */
  targetMinutes: number;
  lines: TimeFitLine[];
  /** The workout's own commands, without `opId` and `at` (`fitTodayCommand` adds them). */
  steps: FitStepDraft[];
  /** The workout's version the offer was made on (rule 5). */
  expectedVersion: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FitStepDraft = DistributiveOmit<FitTodayStep, 'opId' | 'at'>;

type FitRow = BuilderSetRow & { setId: string };

const effRpe = (s: WorkoutSet): number | null => s.planned.rpeOverride ?? s.planned.rpe;

const liveOrdered = (a: SessionAggregate): SessionExercise[] => a.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);

const pendingOf = (a: SessionAggregate, exId: string): WorkoutSet[] =>
  a.sets.filter((s) => s.sessionExerciseId === exId && s.status === 'pending').sort((x, y) => x.index - y.index);

/** The fit's own earlier change (a step of a `fit_today_to_time`), not Ben's (review N4). */
function fitOwnEdit(a: SessionAggregate, opId: string): boolean {
  const cut = opId.lastIndexOf(':');
  return cut > 0 && a.processedOps[opId.slice(0, cut)]?.commandType === 'fit_today_to_time';
}

/**
 * A pending set Ben (or the coach he asked) changed himself: the fit leaves
 * it, rest included. That covers a rest he set with the "Rest after" sheet
 * for the set or the whole exercise (`rest.byOpId`, review R1); the fit's own
 * rest writes go through `edit_planned_set` and never carry it.
 */
const bensEdit = (a: SessionAggregate, s: WorkoutSet): boolean =>
  (s.planned.edit !== undefined && !fitOwnEdit(a, s.planned.edit.opId)) || (s.rest.byOpId !== undefined && !fitOwnEdit(a, s.rest.byOpId));

/** The rest kind after each row, as `restAfterRows` reads it. */
const restKindAt = (rows: readonly BuilderSetRow[], i: number): RestKind | undefined => {
  const row = rows[i];
  if (row === undefined) return undefined;
  return rows[i + 1]?.type === 'drop' && row.type !== 'warmup' ? 'before_drop' : row.type;
};

/** A left-alone slot's rests (and the main lift's, which time never moves), pinned at what its sets have now (so no level moves them in the estimate). */
function pinnedRests(rows: readonly FitRow[], byId: ReadonlyMap<string, WorkoutSet>): Partial<Record<RestKind, number>> {
  const out: Partial<Record<RestKind, number>> = {};
  rows.forEach((r, i) => {
    const kind = restKindAt(rows, i);
    const set = byId.get(r.setId);
    if (kind !== undefined && set !== undefined && out[kind] === undefined) out[kind] = set.rest.seconds;
  });
  return out;
}

/** The main lifts: the draft's, or the plan day's (provenance), else one with a Top set, else the first compound in order. */
function mainIds(a: SessionAggregate, live: readonly SessionExercise[], info: BuilderInfoLookup, fromDraft: ReadonlySet<string> | undefined): Set<string> {
  const drafted = live.filter((e) => fromDraft?.has(e.exerciseId) === true);
  if (drafted.length > 0) return new Set(drafted.map((e) => e.id));
  const planned = a.session.planDay?.mainLiftExerciseId ?? null;
  if (planned !== null) {
    const hit = live.filter((e) => e.exerciseId === planned);
    if (hit.length > 0) return new Set(hit.map((e) => e.id));
  }
  const top = live.filter((e) => a.sets.some((s) => s.sessionExerciseId === e.id && s.status !== 'deleted' && s.setType === 'top'));
  if (top.length > 0) return new Set(top.map((e) => e.id));
  const first = live.find((e) => info(e.exerciseId)?.role === 'compound');
  return new Set(first === undefined ? [] : [first.id]);
}

function slotOf(a: SessionAggregate, ex: SessionExercise, main: boolean, touched: boolean, byId: ReadonlyMap<string, WorkoutSet>): BuilderSlot | null {
  const pending = pendingOf(a, ex.id);
  if (pending.length === 0) return null;
  const rows: FitRow[] = pending.map((s) => ({
    setId: s.id,
    type: s.setType,
    reps: s.planned.reps?.max ?? s.planned.reps?.min ?? 0,
    load: s.planned.load?.value ?? null,
    rpe: s.setType === 'warmup' ? null : effRpe(s),
  }));
  const reps = pending.find((s) => s.planned.reps !== null)?.planned.reps ?? { min: 8, max: 12 };
  return {
    key: ex.id,
    exerciseId: ex.exerciseId,
    main,
    repRange: { min: reps.min, max: reps.max },
    rows,
    unit: ex.unit,
    convention: ex.loadConvention,
    source: 'plan',
    startLight: null,
    anchorE1rm: null,
    ...(touched ? { touched: true as const, restS: pinnedRests(rows, byId) } : main ? { restS: pinnedRests(rows, byId) } : {}),
  };
}

const rowsOf = (s: BuilderSlot): FitRow[] => s.rows as FitRow[];
const isWork = (r: BuilderSetRow): boolean => r.type !== 'warmup';

/** The sets left as the builder's workout: one slot per exercise with a pending set, supersets as one block. */
function remainingWorkout(input: TimeFitInput): { w: BuilderWorkout; mainGroup: BuilderGroupName | null } {
  const a = input.aggregate;
  const live = liveOrdered(a);
  const mains = mainIds(a, live, input.info, input.mainExerciseIds);
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const blocks: BuilderBlock[] = [];
  let lastGroup: string | null = null;
  let mainGroup: BuilderGroupName | null = null;
  for (const ex of live) {
    const pending = pendingOf(a, ex.id);
    // Ben's own edits, pain-flagged movements and anything not counted in reps are left as they are.
    const touched = ex.measurement !== 'reps' || (input.painFlagged?.has(ex.exerciseId) ?? false) || pending.some((s) => bensEdit(a, s));
    const main = mains.has(ex.id);
    if (main && mainGroup === null) mainGroup = input.info(ex.exerciseId)?.group ?? null;
    const slot = slotOf(a, ex, main, touched, byId);
    if (slot === null) continue;
    const last = blocks[blocks.length - 1];
    if (ex.supersetGroup !== null && ex.supersetGroup === lastGroup && last !== undefined) last.slots.push(slot);
    else blocks.push({ slots: [slot], auto: false });
    lastGroup = ex.supersetGroup;
  }
  // A superset with a left-alone exercise keeps its round rest (the longest it has now).
  for (const b of blocks) {
    if (b.slots.length < 2 || !b.slots.some((x) => x.touched === true)) continue;
    const rests = b.slots.flatMap((x) => rowsOf(x).filter(isWork).map((r) => byId.get(r.setId)?.rest.seconds ?? 0));
    b.roundRestS = Math.max(0, ...rests);
  }
  return { w: { blocks, restLevel: 'normal' }, mainGroup };
}

/**
 * The pending sets that stay, each with its row after the fit. The fit
 * never touches warm-ups; fewer sets come off the end, last non-top first
 * (`setWorkingCount`), and a set given back (a drop freed time) is a copy
 * at the end, so what stays lines up with the rows after by position.
 */
function aligned(orig: BuilderSlot, after: BuilderSlot): { kept: { setId: string; row: BuilderSetRow; next: BuilderSetRow | undefined }[]; gone: string[] } {
  const rows = [...rowsOf(orig)];
  let extra = rows.filter(isWork).length - after.rows.filter(isWork).length;
  const gone: string[] = [];
  while (extra > 0) {
    const work = rows.filter(isWork);
    const cut = [...work].reverse().find((r) => r.type !== 'top') ?? work[work.length - 1];
    if (cut === undefined) break;
    rows.splice(rows.indexOf(cut), 1);
    gone.push(cut.setId);
    extra -= 1;
  }
  const kept = rows.flatMap((r, i) => {
    const row = after.rows[i];
    return row === undefined ? [] : [{ setId: r.setId, row, next: after.rows[i + 1] }];
  });
  return { kept, gone };
}

/**
 * Rests a level shortens: set ID → seconds, only where it is shorter than
 * now. Warm-ups and the rest before a drop never change; nor do the main lift's
 * (Ben, 27 Oct: whatever they are now, even longer than the default), the rests of
 * a left-alone slot (Ben's edit, pain flag, timed: `touched`), of a set Ben
 * edited, or a superset round with a left-alone exercise in it (review B1).
 */
function restCuts(a: SessionAggregate, orig: BuilderWorkout, w: BuilderWorkout, info: BuilderInfoLookup, presets?: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const origSlots = new Map(orig.blocks.flatMap((b) => b.slots.map((x) => [x.key, x] as const)));
  const origBlockOf = new Map(orig.blocks.flatMap((b) => b.slots.map((x) => [x.key, b] as const)));
  for (const b of w.blocks) {
    const round = b.slots.length > 1 ? roundRestOf(b, w.restLevel, presets) : null;
    for (const slot of b.slots) {
      const o = origSlots.get(slot.key);
      if (o === undefined || o.touched === true || o.main) continue;
      if (round !== null && origBlockOf.get(slot.key)?.slots.some((x) => x.touched === true) === true) continue;
      const targets = restAfterRows(slot, info, w.restLevel, presets);
      aligned(o, slot).kept.forEach((k, i) => {
        const set = byId.get(k.setId);
        if (set === undefined || set.status !== 'pending' || bensEdit(a, set) || k.row.type === 'warmup' || k.next?.type === 'drop') return;
        const target = round ?? targets[i];
        if (target === undefined || set.rest.seconds <= 0 || target >= set.rest.seconds) return;
        out.set(k.setId, target);
      });
    }
  }
  return out;
}

const rank = (l: RestLevel): number => (l === 'normal' ? 0 : l === 'shorter' ? 1 : 2);

/** The least the sets left are fitted to: half their length (review S3), never below a minute. */
export const TIME_FIT_MIN_SHARE = 0.5;

export function timeFitOffer(input: TimeFitInput): TimeFitOffer {
  const a = input.aggregate;
  const { w: built, mainGroup } = remainingWorkout(input);
  const ctx: BuilderContext = {
    info: input.info,
    ...(input.restPresetsS === undefined ? {} : { restPresetsS: input.restPresetsS }),
    ...(input.fitRestLevel === undefined ? {} : { fitRestLevel: input.fitRestLevel }),
    // Shrinking never adds an exercise, so these are never asked for.
    loads: () => ({ unit: 'kg', convention: 'total', equipment: null, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: null, painCap: null }),
    newKey: (id) => `fit:${id}`,
  };
  // Rests already at a level count as that level, so the ladder's first step changes something.
  let start: RestLevel = 'normal';
  for (const l of ['shorter', 'shortest'] as const) if (restCuts(a, built, { ...built, restLevel: l }, input.info, input.restPresetsS).size === 0) start = l;
  const w: BuilderWorkout = { ...built, restLevel: start };
  const beforeS = estimateBuilderSeconds(w, ctx);
  const beforeMinutes = Math.round(beforeS / 60);
  const asked = Math.floor((beforeS - Math.max(0, input.overByMinutes) * 60) / 60);
  const least = Math.max(1, Math.ceil((beforeS / 60) * TIME_FIT_MIN_SHARE));
  const capped = asked < least;
  const targetMinutes = Math.max(least, asked);
  const base = { beforeMinutes, targetMinutes, expectedVersion: a.session.version };
  const none: TimeFitOffer = { ...base, status: 'none', afterMinutes: beforeMinutes, savedMinutes: 0, lines: [], steps: [] };
  if (w.blocks.length === 0 || input.overByMinutes <= 0) return none;

  // Its own spec keeps the effort step (workout-table-v3 §5); the cut itself is the shared one (fit-to-time 22 Oct).
  const fit = fitToMinutes(w, ctx, { minutes: targetMinutes, mainGroup, grow: false, supersets: false, floorMinutes: 1, pushEffort: true });
  if (fit.status === 'fits') return none;

  const names = new Map(a.exercises.map((e) => [e.id, e.exerciseName]));
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const kept = new Map(fit.workout.blocks.flatMap((b) => b.slots.map((s) => [s.key, s] as const)));
  const steps: FitStepDraft[] = [];

  // (a) rests: one line per exercise and before → after.
  const rests = rank(fit.workout.restLevel) > rank(start) ? restCuts(a, w, fit.workout, input.info, input.restPresetsS) : new Map<string, number>();
  const restLines: Extract<TimeFitLine, { kind: 'rest' }>[] = [];
  for (const slot of w.blocks.flatMap((b) => b.slots)) {
    for (const r of rowsOf(slot)) {
      const toS = rests.get(r.setId);
      const fromS = byId.get(r.setId)?.rest.seconds;
      if (toS === undefined || fromS === undefined) continue;
      const same = restLines.find((l) => l.sessionExerciseId === slot.key && l.fromS === fromS && l.toS === toS);
      if (same !== undefined) same.sets += 1;
      else restLines.push({ kind: 'rest', sessionExerciseId: slot.key, name: names.get(slot.key) ?? '', fromS, toS, sets: 1 });
    }
  }

  // (b) fewer sets and effort, per exercise in order (both shown when an exercise has both, review S2); (c) drops last.
  const rpes = new Map<string, number>();
  const gone: FitStepDraft[] = [];
  const changes: TimeFitLine[] = [];
  const drops: TimeFitLine[] = [];
  for (const b of w.blocks) {
    for (const slot of b.slots) {
      const after = kept.get(slot.key);
      const name = names.get(slot.key) ?? '';
      if (after === undefined) {
        gone.push({ type: 'skip_exercise', sessionExerciseId: slot.key });
        drops.push({ kind: 'drop', sessionExerciseId: slot.key, name });
        continue;
      }
      const al = aligned(slot, after);
      if (al.gone.length > 0) {
        for (const id of al.gone) {
          const set = byId.get(id);
          if (set !== undefined) gone.push({ type: 'delete_set', setId: set.id, expectedSetVersion: set.version });
        }
        const done = a.sets.filter((x) => x.sessionExerciseId === slot.key && x.status === 'completed' && x.setType !== 'warmup').length;
        changes.push({ kind: 'sets', sessionExerciseId: slot.key, name, from: done + slot.rows.filter(isWork).length, to: done + after.rows.filter(isWork).length });
      }
      let effort: Extract<TimeFitLine, { kind: 'effort' }> | null = null;
      for (const k of al.kept) {
        const set = byId.get(k.setId);
        if (set === undefined || k.row.rpe === null || k.row.type === 'warmup' || k.row.rpe === effRpe(set)) continue;
        rpes.set(k.setId, k.row.rpe);
        effort = { kind: 'effort', sessionExerciseId: slot.key, name, from: effRpe(set), to: k.row.rpe };
      }
      if (effort !== null) changes.push(effort);
    }
  }
  const lines: TimeFitLine[] = [...restLines, ...changes, ...drops];
  for (const b of w.blocks) {
    for (const slot of b.slots) {
      for (const r of rowsOf(slot)) {
        const set = byId.get(r.setId);
        const restS = rests.get(r.setId);
        const targetRpe = rpes.get(r.setId);
        if (set === undefined || (restS === undefined && targetRpe === undefined)) continue;
        steps.push({ type: 'edit_planned_set', setId: set.id, expectedSetVersion: set.version, patch: { ...(restS === undefined ? {} : { restS }), ...(targetRpe === undefined ? {} : { targetRpe }) } });
      }
    }
  }
  steps.push(...gone);
  if (steps.length === 0) return none;
  const afterMinutes = Math.round(estimateBuilderSeconds(fit.workout, ctx) / 60);
  return { ...base, status: capped ? 'over' : fit.status, afterMinutes, savedMinutes: Math.max(0, beforeMinutes - afterMinutes), lines, steps };
}

/** Ben's Apply: the offer as one `fit_today_to_time`, each step with its own opId (`coachEditStepOpId`). */
export function fitTodayCommand(offer: TimeFitOffer, p: { opId: string; at: ZonedTimestamp }): FitTodayToTimeCommand | null {
  if (offer.steps.length === 0) return null;
  const steps = offer.steps.map((s, i): FitTodayStep => ({ ...s, opId: coachEditStepOpId(p.opId, i), at: p.at }));
  return { type: 'fit_today_to_time', at: p.at, opId: p.opId, expectedVersion: offer.expectedVersion, minutes: Math.max(1, Math.min(600, offer.targetMinutes)), steps };
}

const clock = (s: number): string => `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;

/** One change with its before → after (`Cable row rest 1:30 → 1:00`, `Lateral raise 3 → 2 sets`, `Curl last set @8 → @9`, `Skip: Cable crunch`). */
export function timeFitLineText(l: TimeFitLine): string {
  switch (l.kind) {
    case 'rest':
      return `${l.name} rest ${clock(l.fromS)} → ${clock(l.toS)}`;
    case 'effort':
      return `${l.name} last set ${l.from === null ? '' : `@${String(l.from)} `}→ @${String(l.to)}`;
    case 'sets':
      return `${l.name} ${String(l.from)} → ${String(l.to)} sets`;
    case 'drop':
      return `Skip: ${l.name}`;
  }
}

/**
 * The fit Ben can still undo (review S1): the latest `fit_today_to_time`
 * whose Undo would go through now; null when there is none. Pure: a dry run
 * of the same `undo_op` the toast sends, so `⋯ › Undo fit to time` is only
 * shown when it would work (a stale one is refused there all the same).
 */
export function undoableTimeFit(a: SessionAggregate, at: ZonedTimestamp): string | null {
  const latest = Object.values(a.processedOps)
    .filter((o) => o.commandType === 'fit_today_to_time')
    .sort((x, y) => (x.atUtc < y.atUtc ? 1 : x.atUtc > y.atUtc ? -1 : 0))[0];
  if (latest === undefined) return null;
  return reduceSession(a, { type: 'undo_op', at, opId: `probe:${latest.opId}`, targetOpId: latest.opId }).ok ? latest.opId : null;
}
