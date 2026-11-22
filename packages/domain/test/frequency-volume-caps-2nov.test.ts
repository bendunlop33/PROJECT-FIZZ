import { describe, expect, it } from 'vitest';

import {
  dayMuscleFlags,
  muscleFlags,
  planMusclesView,
  plannedMuscleSets,
  rebalanceDayMinutes,
  rebalancePlan,
  WEEKLY_SET_RANGE,
  type MuscleCreditInfo,
  type MuscleInfo,
  type PlanMuscleDay,
  type PlanMuscleRow,
  type RebalanceOp,
} from '../src';

/**
 * (Ben, 2 Nov: approved FQ1–FQ3, VC1–VC4 without the 30-total backstop; docs/training-guides/frequency-and-volume-caps.md)
 * Plan › Muscles and Rebalance: neutral between a range's top and 20 direct (VC1), flag above 20 direct only (VC2),
 * amber for > 8 direct on one day and move the excess first (VC3 / FQ2), main lifts keep 2 days (FQ3), a second
 * exposure is a tie-breaker only (FQ1), and the weekly review's Strength high edge stays 10 (VC4).
 */

const INFO: Record<string, MuscleInfo & MuscleCreditInfo> = {
  bench: { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'] },
  incline: { name: 'Incline DB press', movementPattern: 'horizontal_push', primaryMuscles: ['upper_chest'], secondaryMuscles: ['front_delts', 'triceps'] },
  fly: { name: 'Cable fly', movementPattern: 'isolation', primaryMuscles: ['chest'], secondaryMuscles: [] },
  dip: { name: 'Chest dip', movementPattern: 'vertical_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] },
  ohp: { name: 'Overhead press', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], secondaryMuscles: ['side_delts', 'triceps'] },
  raise: { name: 'Lateral raise', movementPattern: 'isolation', primaryMuscles: ['side_delts'], secondaryMuscles: [] },
  pushdown: { name: 'Triceps pushdown', movementPattern: 'isolation', primaryMuscles: ['triceps'], secondaryMuscles: [] },
  row: { name: 'Barbell row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['rear_delts', 'biceps'] },
  pulldown: { name: 'Lat pulldown', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], secondaryMuscles: ['upper_back', 'biceps'] },
  curl: { name: 'Dumbbell curl', movementPattern: 'isolation', primaryMuscles: ['biceps'], secondaryMuscles: [] },
  squat: { name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: [] },
};
const infoOf = (id: string) => INFO[id] ?? null;
const nameOf = (id: string) => INFO[id]?.name ?? id;

let k = 0;
const r = (exerciseId: string, sets: number, main = false): PlanMuscleRow => ({ key: `r${String((k += 1))}`, exerciseId, sets, main, order: k, superset: null });
const day = (dayIndex: number, name: string, rows: PlanMuscleRow[], minutes: number | null = 75): PlanMuscleDay => ({ dayIndex, name, minutes, rows: rows.map((x, i) => ({ ...x, order: i })) });
const MUSCLE = { goal: 'muscle' as const, priorities: new Set<never>() };
const ports = { infoOf, isolationsFor: () => [] as string[], alternativesOf: () => [] as string[] };
const week = (days: PlanMuscleDay[]) => [{ key: '1', label: '1', kind: 'week' as const, deload: false, current: true, days, done: null }];
const view = (days: PlanMuscleDay[]) => planMusclesView({ ...MUSCLE, weeks: week(days), typical: days, selected: null, infoOf, nameOf });

describe('VC1 / VC2: weekly bars', () => {
  it('VC1: between the range top and 20 direct the bar is neutral and nothing is flagged', () => {
    const days = [day(0, 'Push A', [r('bench', 4, true), r('fly', 4)]), day(1, 'Push B', [r('bench', 3, true), r('dip', 3)])];
    const v = view(days);
    const chest = v.bars.find((b) => b.group === 'Chest');
    expect([chest?.direct, chest?.status, chest?.look.tone]).toEqual([14, 'in', 'none']);
    expect(v.flags.some((f) => f.group === 'Chest')).toBe(false);
    // Rebalance never trims a group for being between its top and 20.
    expect(rebalancePlan({ ...MUSCLE, days, ports }).ops.filter((o) => o.group === 'Chest')).toEqual([]);
  });

  it('VC2: above 20 direct is flagged; assisted sets never flag, however many (no 30-total backstop)', () => {
    const over = [day(0, 'A', [r('bench', 4, true), r('fly', 4)]), day(1, 'B', [r('bench', 4, true), r('fly', 3)]), day(2, 'C', [r('dip', 3), r('fly', 3)])];
    expect(muscleFlags(plannedMuscleSets(over, infoOf), MUSCLE).map((f) => [f.group, f.status, f.direct])).toContainEqual(['Chest', 'above', 21]);
    // Triceps: 6 direct, 30+ assisted from pressing: in range, never "above".
    const presses = [0, 1, 2, 3, 4].map((i) => day(i, `P${String(i)}`, [r('bench', 5, true), r('incline', 5), r('dip', 4), r('pushdown', i < 2 ? 3 : 0)].filter((x) => x.sets > 0)));
    const t = plannedMuscleSets(presses, infoOf).get('Triceps');
    expect((t?.assisted ?? 0) + (t?.direct ?? 0)).toBeGreaterThan(30);
    expect(muscleFlags(plannedMuscleSets(presses, infoOf), MUSCLE).some((f) => f.group === 'Triceps')).toBe(false);
  });

  it('VC4: the weekly review keeps Strength’s high edge at 10 (Muscle 20)', () => {
    expect(WEEKLY_SET_RANGE.strength.max).toBe(10);
    expect(WEEKLY_SET_RANGE.muscle.max).toBe(20);
  });
});

describe('VC3: more than 8 direct sets for one group on one day', () => {
  const heavy = () => [day(0, 'Push A', [r('bench', 4, true), r('fly', 3), r('dip', 3), r('raise', 3)]), day(1, 'Push B', [r('ohp', 3, true), r('incline', 3), r('raise', 3), r('pushdown', 3)])];

  it('is amber on By day with its own line; exactly 8 is fine', () => {
    const v = view(heavy());
    expect(v.dayFlags).toEqual([{ dayIndex: 0, dayName: 'Push A', group: 'Chest', direct: 10 }]);
    expect(v.flagLines).toContain('Chest 10 on Push A · above 8');
    expect(v.byDay[0]?.chips.find((c) => c.group === 'Chest')?.over).toBe(true);
    expect(v.byDay[1]?.chips.every((c) => !c.over)).toBe(true);
    expect(dayMuscleFlags([day(0, 'A', [r('bench', 4, true), r('fly', 4)])], infoOf)).toEqual([]);
  });

  it('no goal: no amber (no flags without a goal)', () => {
    const v = planMusclesView({ goal: null, priorities: new Set(), weeks: week(heavy()), typical: heavy(), selected: null, infoOf, nameOf });
    expect(v.dayFlags).toEqual([]);
    expect(v.byDay[0]?.chips.some((c) => c.over)).toBe(false);
  });

  it('Rebalance moves the excess to another of the group’s days with time first (whole row; weekly sets unchanged)', () => {
    const res = rebalancePlan({ ...MUSCLE, days: heavy(), ports });
    const chestOps = res.ops.filter((o) => o.group === 'Chest');
    expect(chestOps.map((o) => [o.kind, o.dayIndex, o.kind === 'trim' ? `${String(o.from)}→${String(o.to)}` : o.kind === 'add' ? o.sets : null])).toEqual([
      ['trim', 0, '3→0'],
      ['add', 1, 3],
    ]);
    expect(dayMuscleFlags(res.days, infoOf)).toEqual([]);
    expect(res.after.get('Chest')?.direct).toBe(res.before.get('Chest')?.direct);
    for (const d of res.days) expect(rebalanceDayMinutes(d)).toBeLessThanOrEqual(75);
  });

  it('with no other day with time, trims to 8: never the main lift, never below 2 sets a row', () => {
    const tight = [day(0, 'Push A', [r('bench', 5, true), r('fly', 3), r('dip', 3)]), day(1, 'Push B', [r('incline', 3), r('raise', 3), r('pushdown', 4)], 40)];
    const res = rebalancePlan({ ...MUSCLE, days: tight, ports });
    const trims = res.ops.filter((o): o is Extract<RebalanceOp, { kind: 'trim' }> => o.kind === 'trim' && o.group === 'Chest');
    expect(res.ops.some((o) => o.kind === 'add' && o.group === 'Chest')).toBe(false);
    expect(trims.length).toBeGreaterThan(0);
    for (const t of trims) expect(t.to === 0 || t.to >= 2).toBe(true);
    const a = res.days.find((d) => d.dayIndex === 0);
    expect(a?.rows.find((x) => x.main)?.sets).toBe(5);
    expect(dayMuscleFlags(res.days, infoOf)).toEqual([]);
  });

  it('FQ2: a gap fill never takes a day above 8 for its group', () => {
    // Biceps low; Pull A already has 8 back… a curl there is fine (Biceps), but no day gets > 8 Biceps.
    const days = [day(0, 'Pull A', [r('row', 4, true), r('pulldown', 4)]), day(1, 'Pull B', [r('row', 4, true), r('curl', 7)])];
    const res = rebalancePlan({ ...MUSCLE, days, ports: { ...ports, isolationsFor: (g: string) => (g === 'Biceps' ? ['curl'] : []) } });
    expect(dayMuscleFlags(res.days, infoOf)).toEqual([]);
  });
});

describe('FQ3 / FQ1', () => {
  it('FQ3: a trim never takes a main lift below 2 days a week', () => {
    // Bench is a main lift on Push A and an accessory row on Push B: the 3-set excess would remove Push B's bench row,
    // but that would leave bench on 1 day, so the fly row goes instead.
    const days = [day(0, 'Push A', [r('bench', 4, true), r('incline', 4)], 40), day(1, 'Push B', [r('ohp', 3, true), r('bench', 2), r('fly', 2), r('dip', 4), r('incline', 3)], 50)];
    const res = rebalancePlan({ ...MUSCLE, days, ports });
    const benchDays = res.days.filter((d) => d.rows.some((x) => x.exerciseId === 'bench')).length;
    expect(benchDays).toBe(2);
    expect(dayMuscleFlags(res.days, infoOf)).toEqual([]);
  });

  it('FQ1: a group trained once a week is never flagged for it', () => {
    const ppl = [day(0, 'Push', [r('bench', 3, true), r('fly', 3), r('raise', 3), r('pushdown', 3)]), day(1, 'Pull', [r('row', 3, true), r('pulldown', 3), r('curl', 6)]), day(2, 'Legs', [r('squat', 6, true)])];
    const v = view(ppl);
    expect(v.flags.some((f) => f.status === 'above')).toBe(false);
    expect(v.dayFlags).toEqual([]);
    expect(v.flagLines.some((l) => /day|once|frequency/i.test(l))).toBe(false);
  });

  it('FQ1: the move goes to the day with the fewest of the group’s sets (a second exposure), not just the first', () => {
    const days = [
      day(0, 'Push A', [r('bench', 4, true), r('fly', 3), r('dip', 3)]),
      day(1, 'Push B', [r('ohp', 3, true), r('incline', 4), r('raise', 2)]),
      day(2, 'Push C', [r('ohp', 3, true), r('incline', 2), r('raise', 2)]),
    ];
    const res = rebalancePlan({ ...MUSCLE, days, ports });
    const add = res.ops.find((o) => o.kind === 'add' && o.group === 'Chest');
    expect(add?.dayIndex).toBe(2);
  });
});
