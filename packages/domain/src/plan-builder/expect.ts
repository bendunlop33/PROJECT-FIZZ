import type { PlanBuilderAnswers } from '@fizz/schemas';
import { pbAtReps, type PlanKit } from './loads';
import type { PbLiftStart } from './lifts';
import { PB_EFFORT, PB_FOCUS_GAIN, PB_FOCUS_REPS, PB_LEGGY_SPORTS } from './tables';

/**
 * What to expect in N weeks (Gym goals; Ben, 22 Oct): for each main lift, the weight for the focus's reference reps
 * now and at the end of the plan, est. (rule 6). The est. 1RM rises at effort × focus × weeks (Maintain flat), about
 * 0.6× with ★ sports and 0.7× again on lower-body lifts when a ★ sport is hard on the legs. Placeholder rates until
 * his own trend replaces them (plan-builder §5 Q6). Pure.
 */

const LOWER = new Set(['barbell-back-squat', 'barbell-deadlift', 'barbell-front-squat', 'barbell-romanian-deadlift']);

export interface PbExpectRow {
  key: string;
  reps: number;
  now: number | null;
  end: number | null;
  perHand: boolean;
}

export function pbExpect(a: Pick<PlanBuilderAnswers, 'effort' | 'focus' | 'weeks' | 'other'>, lifts: readonly { start: PbLiftStart; kit: PlanKit }[]): { reps: number; rows: PbExpectRow[]; sportsSlower: boolean; legsMost: boolean } {
  const reps = PB_FOCUS_REPS[a.focus];
  const stars = a.other.filter((o) => o.star);
  const sportMul = stars.length > 0 ? 0.6 : 1;
  const legSport = stars.some((o) => o.sport === 'Running' || PB_LEGGY_SPORTS.has(o.sport));
  const rows = lifts.flatMap(({ start, kit }) => {
    if (start.six === null) return [];
    const e0 = start.six * 1.2;
    const rate = a.effort === 'maintain' ? 0 : PB_EFFORT[a.effort].pct * PB_FOCUS_GAIN[a.focus] * a.weeks * sportMul * (legSport && LOWER.has(start.key) ? 0.7 : 1);
    return [{ key: start.key, reps, now: pbAtReps(kit, e0, reps), end: pbAtReps(kit, e0 * (1 + rate), reps), perHand: kit.convention === 'per_hand' }];
  });
  return { reps, rows, sportsSlower: stars.length > 0 && a.effort !== 'maintain', legsMost: legSport };
}
