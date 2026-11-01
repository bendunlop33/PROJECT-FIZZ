import { describe, expect, it } from 'vitest';

import { pbDefaultAnswers, pbRange, PB_EFFORT, WEEKLY_SET_RANGE, workoutMuscleGroups } from '../src';

/**
 * (Ben, 1 Nov: "check not losing functionality") Pins for what option C must not change: Up next's and the plan day
 * match's muscle groups (first primary muscle, every working set; D19's ticks read the same map), the plan builder's own
 * bands, and the weekly review's ranges as reconciled to approved V4. Progress's V1 `sets` beside `direct` is pinned in
 * plan-muscles-1nov.test.ts; the review's planned vs done counts in weekly-review.test.ts.
 */
describe('unchanged by the one muscle count', () => {
  it('Up next / plan-day matching: each exercise’s working sets go to its first primary muscle’s group only', () => {
    const groups = workoutMuscleGroups([
      { primaryMuscles: ['lats', 'biceps'], workingSets: 3 },
      { primaryMuscles: ['biceps'], workingSets: 2 },
      { primaryMuscles: ['rear_delts'], workingSets: 2 },
    ]);
    expect(Object.fromEntries(groups)).toEqual({ Back: 5, Biceps: 2 });
  });

  it('the plan builder’s bands are its own (plan-builder §5 Q3), untouched', () => {
    expect(PB_EFFORT.standard).toMatchObject({ pri: [12, 20], oth: [8, 14], sm: [4, 10] });
    const a = pbDefaultAnswers({ sessions: 6, minutes: 60 });
    expect(pbRange({ ...a, effort: 'standard', priorities: [], other: [] }, 'Biceps')).toEqual([4, 10]);
    expect(pbRange({ ...a, effort: 'standard', priorities: [], other: [] }, 'Chest')).toEqual([8, 14]);
  });

  it('the weekly review’s base bands are approved V4 (Muscle 6–10, Strength 4–10)', () => {
    expect(WEEKLY_SET_RANGE).toEqual({ muscle: { min: 6, max: 10 }, strength: { min: 4, max: 10 }, both: { min: 6, max: 10 } });
  });
});
