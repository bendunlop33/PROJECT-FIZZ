import type { PlannedSet, SetType, SetValues } from '@fizz/schemas';
import { formatNumber } from '../display';
import { deriveId } from '../stable';

/**
 * Coach offer triggers (ADR 0006 and its amendment, playbook v1 rule T, D20,
 * coach-adjustments path B). Pure: no AI call and no network. A trigger only
 * lets the rest card *offer* to adjust; nothing changes until Ben taps Adjust.
 */

export type CoachTriggerKind = 'rpe_high' | 'reps_short' | 'rpe_low';

/** A stored offer's kind, read back (an unknown value is ignored rather than trusted). */
export function isTriggerKind(value: string): value is CoachTriggerKind {
  return value === 'rpe_high' || value === 'reps_short' || value === 'rpe_low';
}

/** Stored as data and editable (profile-and-settings §2.7). Defaults are rule T. */
export interface CoachTriggerThresholds {
  enabled: boolean;
  /** "Too hard" when logged effort is at least this RPE (RIR equivalent: 10 − value). */
  rpeHigh: number;
  /** …and the plan's effort was at most this (rule T). */
  plannedAtMostForHigh: number;
  /** "Too hard" when reps fall short of the bottom of the target range by at least this. */
  repsShortBy: number;
  /** "Too easy" when logged effort is at most this RPE. */
  rpeLow: number;
  /** …and the plan's effort was at least this (rule T). */
  plannedAtLeastForLow: number;
  /** "Too easy" never fires on sets above this many reps (rule T). */
  easyMaxReps: number;
}

export const DEFAULT_COACH_TRIGGER_THRESHOLDS: CoachTriggerThresholds = {
  enabled: true,
  rpeHigh: 9.5,
  plannedAtMostForHigh: 8.5,
  repsShortBy: 2,
  rpeLow: 6,
  plannedAtLeastForLow: 8,
  easyMaxReps: 12,
};

export interface CoachTrigger {
  /** Deterministic: the same logged set version gives the same ID. */
  triggerId: string;
  kind: CoachTriggerKind;
  setId: string;
  /** App text: `RPE 10 on set 2`, `RIR 0 on set 2`, `6 reps on set 2 (target 8–10)`. Quotes what Ben entered. */
  fact: string;
  /** `That looked hard. Adjust remaining sets?` / `That looked easy. Adjust remaining sets?` */
  prompt: string;
}

export interface TriggerSetInput {
  id: string;
  version: number;
  setType: SetType;
  status: 'pending' | 'completed' | 'skipped' | 'deleted';
  planned: Pick<PlannedSet, 'reps' | 'rpe' | 'rir'>;
  actual: Pick<SetValues, 'reps' | 'rpe' | 'rir'> | null;
}

/** RPE equivalent of an effort entry. RIR maps as 10 − RIR (RIR 0 ≈ RPE 10, RIR 4 ≈ RPE 6). */
function effortAsRpe(e: { rpe: number | null; rir: number | null }): number | null {
  if (e.rpe !== null) return e.rpe;
  if (e.rir !== null) return 10 - e.rir;
  return null;
}

function effortWords(e: { rpe: number | null; rir: number | null }): string {
  return e.rpe !== null ? `RPE ${formatNumber(e.rpe)}` : `RIR ${String(e.rir ?? 0)}`;
}

/**
 * Planned all-out work never triggers (rule T). The schema has no AMRAP flag
 * yet, so a plan of RPE 10 or RIR 0 is read as all-out.
 */
function plannedAllOut(planned: TriggerSetInput['planned']): boolean {
  return (planned.rpe !== null && planned.rpe >= 10) || (planned.rir !== null && planned.rir <= 0);
}

const NEVER_TRIGGERS: ReadonlySet<SetType> = new Set<SetType>(['warmup', 'drop']);

/**
 * Rule T: compare what was logged with the set's planned effort. With no
 * planned effort, the original ADR 0006 thresholds apply (D20). Priority when
 * several hold: `rpe_high`, then `reps_short`, then `rpe_low`.
 */
export function evaluateCoachTrigger(
  set: TriggerSetInput,
  setNumber: number,
  thresholds: CoachTriggerThresholds = DEFAULT_COACH_TRIGGER_THRESHOLDS,
): CoachTrigger | null {
  if (!thresholds.enabled) return null;
  if (set.status !== 'completed' || set.actual === null) return null;
  if (NEVER_TRIGGERS.has(set.setType) || plannedAllOut(set.planned)) return null;

  const logged = effortAsRpe(set.actual);
  const planned = effortAsRpe(set.planned);
  const make = (kind: CoachTriggerKind, fact: string): CoachTrigger => ({
    triggerId: deriveId(`coach-trigger:${set.id}:${String(set.version)}:${kind}`),
    kind,
    setId: set.id,
    fact,
    prompt: kind === 'rpe_low' ? 'That looked easy. Adjust remaining sets?' : 'That looked hard. Adjust remaining sets?',
  });
  const where = `on set ${String(setNumber)}`;

  if (logged !== null && logged >= thresholds.rpeHigh && (planned === null || planned <= thresholds.plannedAtMostForHigh)) {
    return make('rpe_high', `${effortWords(set.actual)} ${where}`);
  }
  const range = set.planned.reps;
  const reps = set.actual.reps;
  if (range !== null && reps !== null && range.min - reps >= thresholds.repsShortBy) {
    const target = range.min === range.max ? String(range.min) : `${String(range.min)}–${String(range.max)}`;
    return make('reps_short', `${String(reps)} reps ${where} (target ${target})`);
  }
  if (
    logged !== null &&
    logged <= thresholds.rpeLow &&
    (planned === null || planned >= thresholds.plannedAtLeastForLow) &&
    (reps === null || reps <= thresholds.easyMaxReps)
  ) {
    return make('rpe_low', `${effortWords(set.actual)} ${where}`);
  }
  return null;
}

export interface OfferLogEntry {
  sessionExerciseId: string;
  kind: CoachTriggerKind;
  /** Session version when the offer was shown. */
  atVersion: number;
}

export interface OfferGateInput {
  trigger: CoachTrigger;
  sessionExerciseId: string;
  /** Only while Resting (path B), never in Ready. */
  resting: boolean;
  /** `getAiCapabilities` says a route can answer now. Offline: no offers at all. */
  coachReachable: boolean;
  /** A coach request is already pending. */
  pending: boolean;
  /** Offers shown earlier in this session (any response). */
  log: readonly OfferLogEntry[];
  /** Session version of the last applied coach adjustment to this exercise, if any. */
  lastAdjustedAtVersion: number | null;
}

/**
 * Whether to show an offer now (coach-adjustments §4.2 step 2 and CA4: at
 * most once per exercise and trigger kind, unless an adjustment to that
 * exercise was applied after the last offer).
 */
export function shouldShowCoachOffer(input: OfferGateInput): boolean {
  if (!input.resting || !input.coachReachable || input.pending) return false;
  const earlier = input.log.filter((e) => e.sessionExerciseId === input.sessionExerciseId && e.kind === input.trigger.kind);
  if (earlier.length === 0) return true;
  const lastOffer = Math.max(...earlier.map((e) => e.atVersion));
  return input.lastAdjustedAtVersion !== null && input.lastAdjustedAtVersion > lastOffer;
}

/**
 * The in-workout coach adjustments still carried by an exercise's sets
 * (`planned.coach`, set only by `adjust_pending_sets`). A next-session
 * target the workout started with is `source: 'coach'` too, but it isn't
 * an adjustment made during this workout, so it never re-opens CA4.
 */
export function todayAdjustmentIds(sets: readonly { sessionExerciseId: string; planned: PlannedSet }[], sessionExerciseId: string): string[] {
  return [...new Set(sets.flatMap((s) => (s.sessionExerciseId === sessionExerciseId && s.planned.coach !== undefined ? [s.planned.coach.actionId] : [])))];
}

/**
 * `lastAdjustedAtVersion` for the offer gate: the latest session version at
 * which one of those adjustments was applied (`appliedAt`: its saved
 * record's session version; unknown ones are skipped). Null: none.
 */
export function lastAdjustedVersion(actionIds: readonly string[], appliedAt: ReadonlyMap<string, number>): number | null {
  const versions = actionIds.flatMap((id) => {
    const v = appliedAt.get(id);
    return v === undefined ? [] : [v];
  });
  return versions.length === 0 ? null : Math.max(...versions);
}
