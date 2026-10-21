import type { LoadDirection } from './equipment';
import type { ProgressionDecision } from './progression';

/**
 * Reps from history (Ben, 21 Oct, live Back workout: shrugs planned at 8 reps
 * although he did 15 last time). PROPOSED, awaiting Ben's approval of the
 * numbers below. Pure.
 *
 * The built-in rule's rep range (the goal: isolation 8–12, compound 6–10)
 * applies when there's no history, or when Ben's last session of this exact
 * exercise was inside it. Otherwise the range follows his last session:
 *
 * - above the goal, up to the rule's rep cap (isolation 15, compound 12):
 *   `last − 3 … last` (15 → 12–15), so double progression adds load at his
 *   reps and the reps come down gradually as the load goes up;
 * - above the cap ("wildly outside"): the top moves `stepTowardGoal` reps
 *   toward the goal each session, never past the cap (20 → 15–18), and Why?
 *   says so;
 * - below the goal: `last … last + 3` (never above the goal's top): reps are
 *   added at his load before the load goes up;
 * - bodyweight (nothing to load): the range follows his reps however high,
 *   with room to add reps (the cap moves up with it).
 *
 * `aim` is the one rep count a builder slot plans inside that range, by the
 * rule's decision: after a load increase, the reps the new load allows at the
 * same effort (Epley), else what he did last time (a hold), the rule's next
 * rep (add reps), or the range floor (a miss or a reduction).
 *
 * Main barbell lifts keep their range (top set / back-offs, ADR 0006), and so
 * does a rule of Ben's own: `kind: 'fixed'`.
 */

export interface RepRangeValue {
  min: number;
  max: number;
}

export const PERSONAL_REPS = {
  /** Reps between the bottom and top of a range from history. */
  width: 3,
  /** Reps per session the range's top moves toward the goal when history is above the rule's rep cap. */
  stepTowardGoal: 2,
} as const;

/**
 * - `goal`: no history, or history inside the goal range: the goal range.
 * - `history`: the range follows Ben's last session.
 * - `toward_goal`: history far above the goal; the range moves toward it.
 * - `fixed`: the rule's own range stands (a main barbell lift, or a rule of Ben's own).
 */
export type PersonalRepsKind = 'goal' | 'history' | 'toward_goal' | 'fixed';

/** The rule's reps for one exercise, as every new-workout path and the coach read them. */
export interface RuleReps {
  /** Typical working reps of the newest comparable session (`typicalReps`); null with no history. */
  last: number | null;
  /** The rule's goal range (its category's, or Ben's own rule's). */
  goal: RepRangeValue;
  /** The range the rule used. */
  range: RepRangeValue;
  kind: PersonalRepsKind;
  /** One rep count to plan inside `range` (`aimReps`). */
  aim: number;
}

/** The lower median of a session's working reps (one odd set never moves it); null when none. */
export function typicalReps(reps: readonly number[]): number | null {
  const ok = reps.filter((r) => Number.isInteger(r) && r > 0).sort((a, b) => a - b);
  if (ok.length === 0) return null;
  return ok[Math.floor((ok.length - 1) / 2)] ?? null;
}

/**
 * The range from Ben's last session's reps against the goal range and the
 * rule's rep cap. `loadable: false` (bodyweight: reps are the only way to
 * progress) never moves toward the goal.
 */
export function personalRepRange(goal: RepRangeValue, last: number | null, cap: number, loadable = true): { range: RepRangeValue; kind: Exclude<PersonalRepsKind, 'fixed'> } {
  const W = PERSONAL_REPS.width;
  if (last === null || (last >= goal.min && last <= goal.max)) return { range: { ...goal }, kind: 'goal' };
  if (last > goal.max) {
    if (last <= cap || !loadable) return { range: { min: Math.max(goal.min, last - W), max: last }, kind: 'history' };
    const top = Math.max(cap, last - PERSONAL_REPS.stepTowardGoal);
    return { range: { min: Math.max(goal.min, top - W), max: top }, kind: 'toward_goal' };
  }
  return { range: { min: last, max: Math.max(last, Math.min(goal.max, last + W)) }, kind: 'history' };
}

const clamp = (n: number, r: RepRangeValue): number => Math.max(r.min, Math.min(r.max, n));

/**
 * Reps a set at `to` allows at the same effort as `reps` at `from` (Epley:
 * `load × (1 + reps / 30)` held equal), to the nearest rep. Null without both loads,
 * or for assisted loads (more assistance is easier, not harder).
 */
export function sameEffortReps(reps: number, from: number | null, to: number | null, direction: LoadDirection): number | null {
  if (from === null || to === null || !(from > 0) || !(to > 0) || direction !== 'resistance') return null;
  return Math.round(30 * (((1 + reps / 30) * from) / to - 1));
}

/**
 * `aimReps`: the one rep count a slot plans inside `range` by the rule's
 * decision. `loads` (the load last time and the rule's load) turn a load
 * increase into the reps the new load allows at the same effort.
 */
export function aimReps(decision: ProgressionDecision, range: RepRangeValue, last: number | null, loads: { from: number | null; to: number | null; direction: LoadDirection } | null): number {
  switch (decision) {
    case 'increase_reps':
    case 'ceiling_reached':
      return range.min;
    case 'increase_load': {
      if (last === null) return range.min;
      const r = loads === null ? null : sameEffortReps(last, loads.from, loads.to, loads.direction);
      return clamp(r ?? range.max - PERSONAL_REPS.width, range);
    }
    case 'hold':
    case 'halted_pain':
      return last === null ? range.min : clamp(last, range);
    case 'hold_after_miss':
    case 'reduce_load':
    case 'insufficient_data':
    case 'no_feasible_load':
    case 'unsupported':
      return range.min;
  }
}

const rangeText = (r: RepRangeValue): string => (r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`);

/** The fact behind `Why?` when the range came from history; null when it's the goal range. */
export function ruleRepsFact(r: Pick<RuleReps, 'last' | 'goal' | 'range' | 'kind'>): string | null {
  if (r.last === null) return null;
  if (r.kind === 'history') return `Reps follow your last session (${String(r.last)} reps): ${rangeText(r.range)}.`;
  if (r.kind === 'toward_goal') return `Last session ${String(r.last)} reps, well above ${rangeText(r.goal)}: ${rangeText(r.range)} this time, moving toward ${rangeText(r.goal)}.`;
  return null;
}

/** `12–15 reps, up to RPE 9`: the rule's name with the range it used. */
export function personalRuleName(range: RepRangeValue, maxRpe: number | null): string {
  return maxRpe === null ? `${rangeText(range)} reps` : `${rangeText(range)} reps, up to RPE ${String(maxRpe)}`;
}
