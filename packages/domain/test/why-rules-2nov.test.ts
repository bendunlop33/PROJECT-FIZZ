import { describe, expect, it } from 'vitest';

import { muscleVolumeLines, pbWeeksCoachLine, type MuscleCreditInfo, type MuscleInfo, type PlanMuscleDay, type PlanMuscleRow } from '../src';

/**
 * (Ben, 2 Nov: "a good coach applies rules without lecturing, but must be able to say why when asked") The facts the
 * coach needs to name a rule's outcome with Ben's own numbers: VC3's day flags in `plan.inUse.muscles`, VC1's neutral
 * band worded as not flagged, and LW1's dropped deload in `plan.inUse.weeks`.
 */

const INFO: Record<string, MuscleInfo & MuscleCreditInfo> = {
  bench: { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'] },
  fly: { name: 'Cable fly', movementPattern: 'isolation', primaryMuscles: ['chest'], secondaryMuscles: [] },
  dip: { name: 'Chest dip', movementPattern: 'vertical_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] },
  ohp: { name: 'Overhead press', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], secondaryMuscles: ['side_delts', 'triceps'] },
  raise: { name: 'Lateral raise', movementPattern: 'isolation', primaryMuscles: ['side_delts'], secondaryMuscles: [] },
};
const infoOf = (id: string) => INFO[id] ?? null;
let k = 0;
const r = (exerciseId: string, sets: number, main = false): PlanMuscleRow => ({ key: `r${String((k += 1))}`, exerciseId, sets, main, order: k, superset: null });
const day = (dayIndex: number, name: string, rows: PlanMuscleRow[]): PlanMuscleDay => ({ dayIndex, name, minutes: 75, rows: rows.map((x, i) => ({ ...x, order: i })) });
const MUSCLE = { goal: 'muscle' as const, priorities: new Set<never>() };

describe('plan.inUse.muscles carries what Rebalance acts on', () => {
  it('VC3: a day above 8 direct sets for one group is its own line, as Plan › Muscles words it', () => {
    const days = [day(0, 'Push A', [r('bench', 4, true), r('fly', 3), r('dip', 3), r('raise', 3)]), day(1, 'Push B', [r('ohp', 3, true), r('raise', 3)])];
    const lines = muscleVolumeLines(days, MUSCLE, infoOf);
    expect(lines).toContain('Chest 10 on Push A · above 8');
    // Exactly 8 is fine: no line.
    const eight = [day(0, 'Push A', [r('bench', 4, true), r('fly', 4)])];
    expect(muscleVolumeLines(eight, MUSCLE, infoOf).some((l) => l.includes(' on Push A'))).toBe(false);
  });

  it('VC1: between the range top and 20 direct the group is said to be above its range but not flagged', () => {
    const days = [day(0, 'Push A', [r('bench', 4, true), r('fly', 4)]), day(1, 'Push B', [r('bench', 3, true), r('dip', 3)])];
    const chest = muscleVolumeLines(days, MUSCLE, infoOf).find((l) => l.startsWith('Chest'));
    expect(chest).toMatch(/^Chest 14 direct .*· above range, not flagged up to 20$/);
  });
});

describe('plan.inUse.weeks carries the block week and LW1', () => {
  const six = { effort: 'standard' as const, weeks: 6 as const };

  it('a plain Standard plan: week now and its planned deload', () => {
    expect(pbWeeksCoachLine(six, { week: 3, done: false, leadIn: false })).toBe('Week 3 of 6 · planned deload week: 6');
  });

  it('LW1: a lighter week 3 drops the week 6 deload, with the reason and its numbers', () => {
    const line = pbWeeksCoachLine({ ...six, lighterWeeks: [3], skippedDeloads: [6] }, { week: 4, done: false, leadIn: false });
    expect(line).toBe('Week 4 of 6 · no planned deload weeks · lighter week (asked for): 3 · week 6 deload dropped: lighter week 3 was 3 weeks before (LW1)');
  });

  it('a later deload outside 3 weeks stays; Maintain has none; lead-in, finished and unknown block', () => {
    const push = { effort: 'push' as const, weeks: 12 as const, lighterWeeks: [2] };
    expect(pbWeeksCoachLine(push, { week: 2, done: false, leadIn: false })).toBe('Week 2 of 12 · planned deload weeks: 4, 8, 12 · lighter week (asked for): 2');
    expect(pbWeeksCoachLine({ effort: 'maintain', weeks: 6 as const }, null)).toBe('6 weeks · no planned deload weeks');
    expect(pbWeeksCoachLine(six, { week: 1, done: false, leadIn: true })).toBe('Lead-in week, then week 1 of 6 · planned deload week: 6');
    expect(pbWeeksCoachLine(six, { week: 7, done: true, leadIn: false })).toBe('Plan finished (6 weeks) · planned deload week: 6');
  });
});
