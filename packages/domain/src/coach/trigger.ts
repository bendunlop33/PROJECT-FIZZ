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

/** Editable thresholds (profile-and-settings §2.7). Defaults: rule T as amended 11 Oct 2026. */
export interface CoachTriggerThresholds {
  enabled: boolean;
  /**
   * Deviation from the set's target RPE (CHANGELOG 2026-10-11, Ben):
   * "harder than planned" when logged effort ≥ target + this.
   */
  harderBy: number;
  /** "Easier than planned" when logged effort ≤ target − this. */
  easierBy: number;
  /**
   * Reps below the range minimum don't count as a miss when logged effort is
   * clearly below target (≤ target − this): Ben stopped short with reps in
   * the tank, for a reason of his own.
   */
  clearlyBelowBy: number;
  /** D20, sets with no target only: "too hard" when logged effort is at least this RPE (RIR equivalent: 10 − value). */
  rpeHigh: number;
  /**
   * "Too hard" on a single-number target (8) when reps fall short of it by at
   * least this. A range target (3–6) fires on any rep below its floor
   * (build 108 fix F1: Ben is shown the top of the range, so a 2 against
   * `× 6` is a big miss even though it is only 1 below the floor).
   */
  repsShortBy: number;
  /** D20, sets with no target only: "too easy" when logged effort is at most this RPE. */
  rpeLow: number;
  /** "Too easy" never fires on sets above this many reps (rule T, rule 4: ratings above 12 reps are unreliable). */
  easyMaxReps: number;
}

export const DEFAULT_COACH_TRIGGER_THRESHOLDS: CoachTriggerThresholds = {
  enabled: true,
  harderBy: 1.5,
  easierBy: 2,
  clearlyBelowBy: 1,
  rpeHigh: 9.5,
  repsShortBy: 2,
  rpeLow: 6,
  easyMaxReps: 12,
};

export interface CoachTrigger {
  /** Deterministic: the same logged set version gives the same ID. */
  triggerId: string;
  kind: CoachTriggerKind;
  setId: string;
  /** App text: `RPE 10 on set 2 (target 8)`, `RIR 0 on set 2 (target RIR 2)`, `6 reps on set 2 (target 8–10)`. Quotes what Ben entered. */
  fact: string;
  /** `That looked hard. Adjust remaining sets?` / `That looked easy. Adjust remaining sets?` */
  prompt: string;
  /** The target RPE the set was judged against; null when it had none (D20 thresholds). */
  targetRpe: number | null;
  /** Logged effort as RPE (RIR read as 10 − RIR); null when none was logged. */
  loggedRpe: number | null;
}

export interface TriggerSetInput {
  id: string;
  version: number;
  setType: SetType;
  status: 'pending' | 'completed' | 'skipped' | 'deleted';
  planned: Pick<PlannedSet, 'reps' | 'rpe' | 'rir'> & Partial<Pick<PlannedSet, 'rpeOverride' | 'source'>>;
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
 * The target in the scale Ben logged with: `target 8`, or `target RIR 2` when
 * he logged RIR. RIR is whole reps, so a half-step target (RPE 8.5) reads
 * `target RPE 8.5` rather than `target RIR 1.5` (review target-rpe S3).
 */
function targetWords(actual: { rpe: number | null; rir: number | null }, target: number): string {
  if (actual.rpe === null && actual.rir !== null) {
    const rir = Math.max(0, 10 - target);
    return Number.isInteger(rir) ? `target RIR ${formatNumber(rir)}` : `target RPE ${formatNumber(target)}`;
  }
  return `target ${formatNumber(target)}`;
}

/**
 * Reps short of target (rule T "short of target", F1 option A): below the
 * floor of a range, or short of a single number by `repsShortBy`.
 */
export function repsShort(range: { min: number; max: number }, reps: number, thresholds: Pick<CoachTriggerThresholds, 'repsShortBy'> = DEFAULT_COACH_TRIGGER_THRESHOLDS): boolean {
  if (range.min <= 0) return false;
  if (range.min < range.max) return reps < range.min;
  return range.min - reps >= thresholds.repsShortBy;
}

const NEVER_TRIGGERS: ReadonlySet<SetType> = new Set<SetType>(['warmup', 'drop']);

/**
 * Rule T, deviation-based (CHANGELOG 2026-10-11 "Offers follow the target
 * RPE"): compare what was logged with the set's **target RPE**
 * (`targetRpeOf`: Ben's, the coach's, the plan's, else the built-in rule's).
 * - `rpe_high`: logged effort ≥ target + `harderBy` (1.5).
 * - `reps_short`: reps below the range minimum (single number: short by
 *   `repsShortBy`), unless logged effort is clearly below target
 *   (≤ target − `clearlyBelowBy`). No effort logged still counts.
 * - `rpe_low`: logged effort ≤ target − `easierBy` (2), on a set of at most
 *   `easyMaxReps` reps whose reps weren't short.
 * A target of RPE 10 (planned all-out) never fires (CHANGELOG: never "too
 * hard"; approved rule T: planned all-out sets never trigger at all).
 *
 * `targetRpe`: the resolved target (`targetRpeOf(…)?.rpe`); omitted, the
 * set's own planned RPE/RIR is used. With no target at all, the fixed D20
 * thresholds apply (RPE ≥ 9.5 / reps short / RPE ≤ 6). Priority when several
 * hold: `rpe_high`, then `reps_short`, then `rpe_low`.
 */
export function evaluateCoachTrigger(
  set: TriggerSetInput,
  setNumber: number,
  thresholds: CoachTriggerThresholds = DEFAULT_COACH_TRIGGER_THRESHOLDS,
  targetRpe?: number | null,
  /** (PM, 23 Oct) The workout is in the plan's deload week: easy on purpose, so `rpe_low` never fires (Ben can still ask). */
  opts: { deload?: boolean } = {},
): CoachTrigger | null {
  if (!thresholds.enabled) return null;
  const easyOk = opts.deload !== true;
  if (set.status !== 'completed' || set.actual === null) return null;
  if (NEVER_TRIGGERS.has(set.setType)) return null;

  const actual = set.actual;
  const logged = effortAsRpe(actual);
  const target = targetRpe !== undefined ? targetRpe : set.planned.rpeOverride !== undefined ? set.planned.rpeOverride : effortAsRpe(set.planned);
  const make = (kind: CoachTriggerKind, fact: string): CoachTrigger => ({
    triggerId: deriveId(`coach-trigger:${set.id}:${String(set.version)}:${kind}`),
    kind,
    setId: set.id,
    fact,
    prompt: kind === 'rpe_low' ? 'That looked easy. Adjust remaining sets?' : 'That looked hard. Adjust remaining sets?',
    targetRpe: target,
    loggedRpe: logged,
  });
  const where = `on set ${String(setNumber)}`;
  const effortFact = (): string => `${effortWords(actual)} ${where}${target === null ? '' : ` (${targetWords(actual, target)})`}`;

  const range = set.planned.reps;
  const reps = actual.reps;
  const short = range !== null && reps !== null && repsShort(range, reps, thresholds);
  const shortFact = (): string => {
    const r = range ?? { min: 0, max: 0 };
    const t = r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`;
    return `${String(reps ?? 0)} ${reps === 1 ? 'rep' : 'reps'} ${where} (target ${t})`;
  };

  if (target === null) {
    // D20: no target on the set (shouldn't happen once every working set carries one).
    if (logged !== null && logged >= thresholds.rpeHigh) return make('rpe_high', effortFact());
    if (short) return make('reps_short', shortFact());
    if (easyOk && logged !== null && logged <= thresholds.rpeLow && (reps === null || reps <= thresholds.easyMaxReps)) return make('rpe_low', effortFact());
    return null;
  }

  // A planned all-out set (target RPE 10) never triggers (rule T: "planned all-out/AMRAP sets never trigger").
  if (target >= 10) return null;
  if (logged !== null && logged >= target + thresholds.harderBy) return make('rpe_high', effortFact());
  if (short && !(logged !== null && logged <= target - thresholds.clearlyBelowBy)) return make('reps_short', shortFact());
  if (easyOk && logged !== null && !short && logged <= target - thresholds.easierBy && (reps === null || reps <= thresholds.easyMaxReps)) return make('rpe_low', effortFact());
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
 * exercise was applied after the last offer). Whether it is the coach's
 * offer or the built-in rule's (CA6, coach unreachable) is decided by the
 * caller; the gate is the same for both.
 */
export function shouldShowCoachOffer(input: OfferGateInput): boolean {
  if (!input.resting || input.pending) return false;
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
