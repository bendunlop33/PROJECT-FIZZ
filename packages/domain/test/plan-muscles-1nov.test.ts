import { describe, expect, it } from 'vitest';

import {
  blockAverage,
  directMuscleGroup,
  directRange,
  leadMuscleGroup,
  muscleBarLook,
  muscleFlags,
  muscleFrequency,
  muscleGroupCredits,
  muscleSetCredits,
  muscleVolumeLines,
  planMuscleKey,
  planMusclesLine,
  planMusclesView,
  plannedMuscleSets,
  PLAN_MUSCLES_COPY,
  rebalanceDayMinutes,
  rebalancePlan,
  type MuscleCreditInfo,
  type MuscleInfo,
  type PlanMuscleDay,
  type PlanMuscleRow,
  type PlanMuscleWeek,
  type ProgressSession,
  type RebalanceOp,
} from '../src';

/** Catalogue values (packages/catalogue/data/exercises), trimmed to what counting reads. */
const INFO: Record<string, MuscleInfo & MuscleCreditInfo> = {
  bench: { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'] },
  incline: { name: 'Incline DB press', movementPattern: 'horizontal_push', primaryMuscles: ['upper_chest'], secondaryMuscles: ['front_delts', 'triceps'] },
  ohp: { name: 'Overhead press', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], secondaryMuscles: ['side_delts', 'triceps'] },
  raise: { name: 'Lateral raise', movementPattern: 'isolation', primaryMuscles: ['side_delts'], secondaryMuscles: [] },
  pushdown: { name: 'Triceps pushdown', movementPattern: 'isolation', primaryMuscles: ['triceps'], secondaryMuscles: [] },
  row: { name: 'Barbell row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['rear_delts', 'traps', 'biceps', 'brachialis', 'spinal_erectors', 'hamstrings', 'grip'] },
  pulldown: { name: 'Lat pulldown', movementPattern: 'vertical_pull', primaryMuscles: ['lats'], secondaryMuscles: ['upper_back', 'biceps', 'brachialis', 'rear_delts'] },
  cablerow: { name: 'Seated cable row', movementPattern: 'horizontal_pull', primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['rear_delts', 'traps', 'biceps', 'brachialis', 'grip'] },
  chinup: { name: 'Chin-up', movementPattern: 'vertical_pull', primaryMuscles: ['lats', 'biceps'], secondaryMuscles: ['upper_back', 'brachialis', 'rear_delts', 'grip', 'core'] },
  shrug: { name: 'Shrug', movementPattern: 'isolation', primaryMuscles: ['traps'], secondaryMuscles: [] },
  crunch: { name: 'Cable crunch', movementPattern: 'isolation', primaryMuscles: ['abs'], secondaryMuscles: [] },
  curl: { name: 'Dumbbell curl', movementPattern: 'isolation', primaryMuscles: ['biceps'], secondaryMuscles: ['brachialis', 'forearms'] },
  hammer: { name: 'Hammer curl', movementPattern: 'isolation', primaryMuscles: ['brachialis', 'biceps'], secondaryMuscles: ['forearms'] },
  squat: { name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['adductors', 'spinal_erectors'] },
  rdl: { name: 'Romanian deadlift', movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], secondaryMuscles: ['spinal_erectors'] },
  legext: { name: 'Leg extension', movementPattern: 'isolation', primaryMuscles: ['quads'], secondaryMuscles: [] },
  legcurl: { name: 'Leg curl', movementPattern: 'isolation', primaryMuscles: ['hamstrings'], secondaryMuscles: [] },
  hipthrust: { name: 'Hip thrust', movementPattern: 'hinge', primaryMuscles: ['glutes'], secondaryMuscles: ['hamstrings'] },
  calf: { name: 'Calf raise', movementPattern: 'isolation', primaryMuscles: ['calves'], secondaryMuscles: [] },
  legraise: { name: 'Hanging leg raise', movementPattern: 'isolation', primaryMuscles: ['abs', 'hip_flexors'], secondaryMuscles: [] },
  wristcurl: { name: 'Wrist curl', movementPattern: 'isolation', primaryMuscles: ['forearms'], secondaryMuscles: [] },
  carry: { name: 'Farmer carry', movementPattern: 'carry', primaryMuscles: ['grip', 'traps'], secondaryMuscles: ['core'] },
};
const infoOf = (id: string) => INFO[id] ?? null;
const nameOf = (id: string) => INFO[id]?.name ?? id;

let k = 0;
const r = (exerciseId: string, sets: number, main = false, superset: string | null = null): PlanMuscleRow => ({ key: `r${String((k += 1))}`, exerciseId, sets, main, order: k, superset });
const day = (dayIndex: number, name: string, rows: PlanMuscleRow[], minutes: number | null = 60): PlanMuscleDay => ({ dayIndex, name, minutes, rows: rows.map((x, i) => ({ ...x, order: i })) });

/** Ben-like 6-day PPL A/B with no curls (1 Nov): every group but Biceps in range. */
function benPpl(minutes: number | null = 60): PlanMuscleDay[] {
  return [
    day(0, 'Push A', [r('bench', 3, true), r('incline', 2), r('raise', 3), r('pushdown', 3)], minutes),
    day(1, 'Pull A', [r('row', 3, true), r('pulldown', 2), r('crunch', 2)], minutes),
    day(2, 'Legs A', [r('squat', 3, true), r('legcurl', 3), r('calf', 3), r('legraise', 2)], minutes),
    day(3, 'Push B', [r('ohp', 3, true), r('bench', 3), r('raise', 2), r('pushdown', 3)], minutes),
    day(4, 'Pull B', [r('chinup', 3, true), r('cablerow', 2), r('crunch', 2)], minutes),
    day(5, 'Legs B', [r('rdl', 3, true), r('legext', 3), r('hipthrust', 4), r('calf', 3)], minutes),
  ];
}
const MUSCLE = { goal: 'muscle' as const, priorities: new Set<never>() };
const ports = {
  infoOf,
  isolationsFor: (g: string) => (g === 'Biceps' ? ['curl', 'hammer'] : g === 'Back' ? ['shrug'] : []),
  alternativesOf: () => [] as string[],
};

describe('one muscle count: direct and assisted (Ben, 1 Nov, option C)', () => {
  it('a curl is direct Biceps; a row is direct Back with ½ assisted Biceps; direct + assisted is always V1’s credit', () => {
    expect(muscleSetCredits(INFO.curl).get('Biceps')).toEqual({ direct: 1, assisted: 0 });
    expect(muscleSetCredits(INFO.row).get('Back')).toEqual({ direct: 1, assisted: 0 });
    expect(muscleSetCredits(INFO.row).get('Biceps')).toEqual({ direct: 0, assisted: 0.5 });
    // A second primary group (chin-up's biceps) is V1's full credit, as assisted.
    expect(muscleSetCredits(INFO.chinup).get('Biceps')).toEqual({ direct: 0, assisted: 1 });
    for (const info of Object.values(INFO)) {
      const v1 = muscleGroupCredits(info);
      for (const [g, c] of muscleSetCredits(info)) expect(c.direct + c.assisted).toBe(v1.get(g));
    }
  });

  it('direct is the builder’s lead group (as the review counted); forearm-only work is direct Forearms; carries have no direct group', () => {
    expect(directMuscleGroup(INFO.hammer)).toBe('Biceps');
    expect(leadMuscleGroup(INFO.wristcurl)).toBeNull();
    expect(directMuscleGroup(INFO.wristcurl)).toBe('Forearms');
    expect(directMuscleGroup(INFO.carry)).toBeNull();
    expect(muscleSetCredits(INFO.carry).get('Back')).toEqual({ direct: 0, assisted: 1 });
  });

  it('Progress’s muscleFrequency keeps V1’s `sets` and adds direct and assisted (warm-ups never count)', () => {
    const s: ProgressSession = {
      sessionId: 's1',
      date: '2026-10-28',
      startedAtUtc: '2026-10-28T08:00:00.000Z',
      exercises: [
        {
          exerciseId: 'row',
          exerciseName: 'Barbell row',
          laterality: 'bilateral',
          sets: [
            { index: 0, setType: 'warmup', rpe: null, rir: null, side: null },
            { index: 1, setType: 'working', rpe: null, rir: null, side: null },
            { index: 2, setType: 'working', rpe: null, rir: null, side: null },
          ],
        },
      ],
    } as unknown as ProgressSession;
    const f = muscleFrequency([s], new Map(Object.entries(INFO)), { from: '2026-10-26', to: '2026-11-01', days: 7 } as never, 'body_part');
    const back = f.rows.find((x) => x.key === 'Back');
    const biceps = f.rows.find((x) => x.key === 'Biceps');
    expect(back).toMatchObject({ sets: 2, direct: 2, assisted: 0 });
    expect(biceps).toMatchObject({ sets: 1, direct: 0, assisted: 1 });
  });
});

describe('ranges (rule 1 / V4, amended by Ben 1 Nov)', () => {
  it('Muscle 6–10; 4–8 once ≥ 6 assisted; priority 10–20; Strength and General fitness 4–10; no goal: none', () => {
    expect(directRange('muscle', { priority: false, assisted: 5.5 })).toEqual({ min: 6, max: 10, why: 'goal' });
    expect(directRange('muscle', { priority: false, assisted: 6 })).toEqual({ min: 4, max: 8, why: 'covered' });
    expect(directRange('both', { priority: false, assisted: 0 })).toMatchObject({ min: 6, max: 10 });
    expect(directRange('muscle', { priority: true, assisted: 9 })).toEqual({ min: 10, max: 20, why: 'priority' });
    expect(directRange('strength', { priority: false, assisted: 9 })).toMatchObject({ min: 4, max: 10 });
    expect(directRange('fitness', { priority: false, assisted: 0 })).toMatchObject({ min: 4, max: 10 });
    expect(directRange(null, { priority: false, assisted: 0 })).toBeNull();
  });

  it('Ben’s PPL with no curls: Biceps 0 direct, 6½ assisted, range 4–8, flagged below; the rest in range', () => {
    const t = plannedMuscleSets(benPpl(), infoOf);
    expect(t.get('Biceps')).toEqual({ direct: 0, assisted: 6.5 });
    const flags = muscleFlags(t, MUSCLE);
    expect(flags.map((f) => [f.group, f.status, f.range.min, f.range.max])).toEqual([['Biceps', 'below', 4, 8]]);
    expect(PLAN_MUSCLES_COPY.gap(flags[0] ?? (undefined as never))).toBe('Biceps 0/wk · below 4–8');
    expect(planMusclesLine(flags, 'muscle')).toBe('Muscles · Biceps low');
    expect(planMusclesLine([], 'muscle')).toBe('Muscles · all in range');
    expect(planMusclesLine(flags, null)).toBeNull();
  });

  it('a plan with no pulling keeps Biceps at 6–10', () => {
    const noPull = benPpl().filter((d) => !d.name.startsWith('Pull'));
    const f = muscleFlags(plannedMuscleSets(noPull, infoOf), MUSCLE).find((x) => x.group === 'Biceps');
    expect(f?.range).toMatchObject({ min: 6, max: 10 });
  });
});

describe('Plan › Muscles view: weeks, deload, lead-in, skips, block average', () => {
  const typical = benPpl();
  const deload = typical.map((d) => ({ ...d, rows: d.rows.map((x) => ({ ...x, sets: Math.max(Math.min(2, x.sets), x.sets - 1) })) }));
  const done = new Map([['Back', { direct: 3, assisted: 0 }]]) as PlanMuscleWeek['done'];
  const weeks: PlanMuscleWeek[] = [
    { key: 'lead', label: 'Lead-in', kind: 'lead_in', deload: false, current: false, days: typical, done: null },
    { key: '1', label: '1', kind: 'week', deload: false, current: true, days: typical.map((d) => (d.dayIndex === 2 ? { ...d, skipped: true } : d)), done },
    { key: '2', label: '2', kind: 'week', deload: false, current: false, days: typical, done: null },
    { key: '3', label: '3 · Deload', kind: 'week', deload: true, current: false, days: deload, done: null },
  ];
  const base = { weeks, typical, goal: 'muscle' as const, priorities: new Set<never>(), infoOf, nameOf };

  it('defaults to this week, with the done-so-far marker; a skipped day makes the bars neutral with one note', () => {
    const v = planMusclesView({ ...base, selected: null });
    expect(v.selected).toBe('1');
    expect(v.note).toBe('1 day skipped');
    expect(v.bars.every((b) => b.status === null && b.look.tone === 'none')).toBe(true);
    expect(v.bars.find((b) => b.group === 'Back')?.done).toBe(3);
    expect(v.bars.find((b) => b.group === 'Back')?.look.marker).toBeGreaterThan(0);
    expect(v.hasDone).toBe(true);
    // The skipped leg day counts nothing that week.
    expect(v.bars.find((b) => b.group === 'Quads')?.direct).toBe(3);
    // Flags always come from the typical week.
    expect(v.flagLines).toEqual(['Biceps 0/wk · below 4–8']);
  });

  it('a typical week is coloured; deload and lead-in are neutral with their note', () => {
    const w2 = planMusclesView({ ...base, selected: '2' });
    expect(w2.note).toBeNull();
    expect(w2.bars.find((b) => b.group === 'Biceps')).toMatchObject({ status: 'below', look: { tone: 'out' }, assistedText: '+6½ assisted' });
    expect(w2.bars.find((b) => b.group === 'Chest')).toMatchObject({ status: 'in', look: { tone: 'in' } });
    expect(w2.bars.find((b) => b.group === 'Biceps')?.why).toBe('Biceps 0 direct · +6½ assisted from Chin-up, Barbell row, Lat pulldown · range 4–8: other lifts cover some');
    expect(planMusclesView({ ...base, selected: '3' }).note).toBe('Deload');
    expect(planMusclesView({ ...base, selected: 'lead' }).note).toBe('Lead-in');
    expect(planMusclesView({ ...base, selected: 'lead' }).bars.every((b) => b.status === null)).toBe(true);
  });

  it('Block avg is the mean of the block’s weeks (lead-in out), one decimal', () => {
    const avg = blockAverage(weeks, infoOf);
    // Chest a week: 8 (week 1; the skipped day is a leg day), 8, 6 (deload: 3→2, 2→2, 3→2) → 7.3.
    expect(avg.get('Chest')?.direct).toBe(7.3);
    const v = planMusclesView({ ...base, selected: 'avg' });
    expect(v.chips.at(-1)).toMatchObject({ key: 'avg', label: 'Block avg', selected: true });
    expect(v.bars.find((b) => b.group === 'Chest')?.valueText).toBe('7.3');
  });

  it('By day: each day’s direct sets per group, most first', () => {
    const v = planMusclesView({ ...base, selected: '2' });
    expect(v.byDay.find((d) => d.name === 'Pull A')?.chips.map((c) => c.text)).toEqual(['Back 5', 'Core 2']);
  });

  it('the coach’s compact lines and the offer key', () => {
    const lines = muscleVolumeLines(typical, MUSCLE, infoOf);
    expect(lines).toContain('Biceps 0 direct (+6½ assisted) · range 4–8 · below');
    expect(planMuscleKey('p1', typical)).toBe(planMuscleKey('p1', [...typical].reverse()));
    expect(planMuscleKey('p1', typical)).not.toBe(planMuscleKey('p1', typical.slice(1)));
  });
});

describe('Rebalance (Ben, 1 Nov: holistic)', () => {
  it('Ben’s PPL A/B: Biceps gets +2 (rule 1 / V5 step) as supersets on the pull days; the rest of the gap stays flagged; Back unchanged; no day past its minutes', () => {
    const res = rebalancePlan({ ...MUSCLE, days: benPpl(), ports });
    // 0 → 2 of 4–8: still below, and shown so.
    expect(res.flagsAfter.map((f) => [f.group, f.direct, f.status])).toEqual([['Biceps', 2, 'below']]);
    const adds = res.ops.filter((o): o is Extract<RebalanceOp, { kind: 'add' }> => o.kind === 'add');
    expect(adds.map((o) => [o.dayIndex, o.exerciseId, o.sets])).toEqual([
      [1, 'curl', 1],
      [4, 'curl', 1],
    ]);
    // Paired with the day's non-competing accessory (the crunch), after the main lift.
    for (const a of adds) expect(a.supersetWith).toBeTruthy();
    expect(res.after.get('Biceps')?.direct).toBe(2);
    expect(res.after.get('Back')?.direct).toBe(res.before.get('Back')?.direct);
    for (const d of res.days) expect(rebalanceDayMinutes(d)).toBeLessThanOrEqual(d.minutes ?? Infinity);
    // The new rows go after every main lift.
    const pullA = res.days.find((d) => d.dayIndex === 1);
    const curl = pullA?.rows.find((x) => x.exerciseId === 'curl');
    expect(curl?.order).toBeGreaterThan(Math.max(...(pullA?.rows.filter((x) => x.main).map((x) => x.order) ?? [0])));
  });

  it('with 2 direct sets already, the fix sizes to the lower edge: +2, split across the pull days', () => {
    const days = benPpl().map((d) => (d.name === 'Pull A' ? { ...d, rows: [...d.rows, { key: 'h', exerciseId: 'hammer', sets: 2, main: false, order: 9, superset: null }] } : d));
    const res = rebalancePlan({ ...MUSCLE, days, ports: { ...ports, isolationsFor: () => ['curl'] } });
    const adds = res.ops.filter((o): o is Extract<RebalanceOp, { kind: 'add' }> => o.kind === 'add');
    expect(adds.reduce((s, o) => s + o.sets, 0)).toBe(2);
    expect(adds.map((o) => o.dayIndex)).toEqual([1, 4]);
  });

  it('a swap that covers the gap with no time added comes first', () => {
    // Swapping the cable row (½ Biceps) for a chin-up variant raises assisted Biceps and keeps Back the same; with a
    // hammer curl alternative for a back accessory refused (Back would leave its range), the swap is the chin-up.
    // (2 Nov) The pulldown sits on the Arms day so no day has more than 8 Back sets (VC3 would act first).
    const days = [day(0, 'Pull', [r('row', 3, true), r('cablerow', 3)], 60), day(1, 'Arms', [r('pulldown', 3), r('curl', 3), r('pushdown', 3)], 60)];
    const res = rebalancePlan({ goal: 'muscle', priorities: new Set(), days, ports: { infoOf, isolationsFor: () => ['hammer'], alternativesOf: (id: string) => (id === 'cablerow' ? ['chinup'] : []) } });
    expect(res.ops[0]).toMatchObject({ kind: 'swap', fromExerciseId: 'cablerow', toExerciseId: 'chinup' });
  });

  it('a Back above 20 direct sets is trimmed to 20 (never a main lift, never below 2 a row); 11–20 is never trimmed', () => {
    // (2 Nov) Three pull days of 7 Back each: no day above 8 (VC3), so only the weekly trim is at work.
    const days = [
      day(0, 'Pull A', [r('row', 3, true), r('pulldown', 4)], 60),
      day(1, 'Pull B', [r('chinup', 3, true), r('pulldown', 4)], 60),
      day(2, 'Pull C', [r('row', 3, true), r('cablerow', 4)], 60),
    ];
    const res = rebalancePlan({ ...MUSCLE, days, ports: { ...ports, isolationsFor: () => [] } });
    expect(res.before.get('Back')?.direct).toBe(21);
    expect(res.after.get('Back')?.direct).toBe(20);
    // 14 Back sets (above the 6–10 target) are neither flagged nor trimmed.
    const fourteen = rebalancePlan({ ...MUSCLE, days: [day(0, 'Pull A', [r('row', 3, true), r('pulldown', 4)], 90), day(1, 'Pull B', [r('cablerow', 4), r('shrug', 3)], 90)], ports: { ...ports, isolationsFor: () => [] } });
    expect(fourteen.flagsBefore.some((f) => f.group === 'Back')).toBe(false);
    expect(fourteen.ops.filter((o) => o.kind === 'trim' && o.group === 'Back')).toEqual([]);
    expect(res.ops.every((o) => o.kind !== 'trim' || (!['row', 'chinup'].includes(o.exerciseId) && (o.to === 0 || o.to >= 2)))).toBe(true);
    expect(res.ops.some((o) => o.kind === 'trim')).toBe(true);
  });

  it('a day already at its time cap gets no added sets', () => {
    const tight = benPpl(null).map((d) => ({ ...d, minutes: rebalanceDayMinutes(d) }));
    const res = rebalancePlan({ ...MUSCLE, days: tight, ports });
    expect(res.ops.filter((o) => o.kind === 'add')).toEqual([]);
    for (const d of res.days) expect(rebalanceDayMinutes(d)).toBeLessThanOrEqual(d.minutes ?? Infinity);
    // Honest: still flagged.
    expect(res.flagsAfter.map((f) => f.group)).toEqual(['Biceps']);
  });

  it('a day with no room frees minutes on that day from a group above its target (never below it), then fits the fill', () => {
    // Two pull days at their cap with Back at 14 a week (above the 6–10 target; 8 and 6 a day, so VC3 isn't at work,
    // 2 Nov): a Back set on each day gives room for a curl set.
    const pullA = day(0, 'Pull A', [r('row', 3, true), r('pulldown', 3), r('cablerow', 2)], null);
    const pullB = day(1, 'Pull B', [r('chinup', 3, true), r('shrug', 3)], null);
    const days = [pullA, pullB].map((d) => ({ ...d, minutes: rebalanceDayMinutes(d) }));
    const res = rebalancePlan({ ...MUSCLE, days, ports: { ...ports, isolationsFor: () => ['curl'] } });
    const trims = res.ops.filter((o) => o.kind === 'trim');
    expect(trims.length).toBeGreaterThan(0);
    expect(res.ops.some((o) => o.kind === 'add' && o.exerciseId === 'curl')).toBe(true);
    expect(res.after.get('Back')?.direct).toBeGreaterThanOrEqual(10);
    for (const d of res.days) expect(rebalanceDayMinutes(d)).toBeLessThanOrEqual(d.minutes ?? Infinity);
  });
});

describe('the high side (stay inside approved rules)', () => {
  it('above the target but at most 20 a week: neutral, not flagged; above 20: flagged high', () => {
    const at14 = new Map([['Chest', { direct: 14, assisted: 0 }]]) as Parameters<typeof muscleFlags>[0];
    expect(muscleFlags(at14, MUSCLE).some((f) => f.group === 'Chest')).toBe(false);
    const at22 = new Map([['Chest', { direct: 22, assisted: 0 }]]) as Parameters<typeof muscleFlags>[0];
    const f = muscleFlags(at22, MUSCLE).find((x) => x.group === 'Chest');
    expect(f?.status).toBe('above');
    expect(PLAN_MUSCLES_COPY.gap(f ?? (undefined as never))).toBe('Chest 22/wk · above 20');
    expect(planMusclesLine(muscleFlags(at14, MUSCLE).filter((x) => x.group === 'Chest'), 'muscle')).toBe('Muscles · all in range');
    expect(muscleBarLook(14, { min: 6, max: 10 }, { scaleMax: 22 }).tone).toBe('none');
    expect(muscleBarLook(8, { min: 6, max: 10 }, { scaleMax: 22 }).tone).toBe('in');
    expect(muscleBarLook(4, { min: 6, max: 10 }, { scaleMax: 22 }).tone).toBe('out');
    expect(muscleBarLook(22, { min: 6, max: 10 }, { scaleMax: 22 }).tone).toBe('out');
  });
});
