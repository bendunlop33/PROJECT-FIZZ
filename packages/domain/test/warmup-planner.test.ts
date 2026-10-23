import { describe, expect, it } from 'vitest';
import {
  fitWarmupCount,
  generalWarmupMinutes,
  getAchievableLoads,
  heavyBand,
  isWarmed,
  planSessionWarmups,
  planWarmups,
  warmupProfileOf,
  warmupRestS,
  warmupShape,
  warmupTimeS,
  type WarmupPlanInput,
  type WarmupStep,
} from '../src/index';
import { makeSlot, settleWarmups, slotsOf, workingCount, type BuilderWorkout } from '../src/index';
import { context } from './builder-v3-fixture';
import { barbell, dumbbells, plateMachine, stack } from './fixtures';

/**
 * The shared warm-up planner, one block per approved rule (WU1–WU12, Ben 22 Oct 2026;
 * docs/training-guides/warm-up.md). Worked examples use the guide's equipment: a 20 kg bar with plate pairs down to
 * 1.25 kg (2.5 kg steps), dumbbells in 1 kg steps up to 10 kg.
 */

const BAR = barbell({ plates: [{ mass: 25, count: 4 }, { mass: 20, count: 4 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const BAR_LOADS = getAchievableLoads(BAR).loads;
const DB_1KG = dumbbells({ loads: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });

const heavy = (over: Partial<WarmupPlanInput>): WarmupPlanInput => ({ cls: 'heavy', reps: 5, load: 100, warmed: false, firstOfSession: false, floorStart: false, barMass: 20, loads: BAR_LOADS, ...over });
const fmt = (s: readonly WarmupStep[]): string => s.map((x) => `${String(x.load)}×${String(x.reps)}`).join(' ');

describe('WU1: what warm-ups are', () => {
  it('the planner only ever returns warm-up steps below the working load (never a working set, never at W)', () => {
    for (const W of [22.5, 40, 60, 100, 140, 180]) {
      for (const reps of [1, 3, 5, 8, 12, 15]) {
        const steps = planWarmups(heavy({ load: W, reps }));
        for (const s of steps) expect(s.load).toBeLessThan(W);
      }
    }
  });
});

describe('WU1 in the builder: warm-ups never count, never touch working sets, and Ben’s own stay', () => {
  const ctx = context();
  const w = (): BuilderWorkout => ({ restLevel: 'normal', blocks: [{ slots: [makeSlot('bench', { main: true }, ctx)], auto: false }, { slots: [makeSlot('incline_db', { main: false }, ctx)], auto: false }, { slots: [makeSlot('pushdown', { main: false }, ctx)], auto: false }] });
  it('a slot’s set count is its working sets; re-planning by place changes warm-up rows only', () => {
    const before = w();
    const after = settleWarmups(before, ctx);
    for (const [i, s] of slotsOf(after.blocks).entries()) {
      const was = slotsOf(before.blocks)[i];
      expect(workingCount(s)).toBe(workingCount(was ?? s));
      expect(s.rows.filter((r) => r.type !== 'warmup')).toEqual(was?.rows.filter((r) => r.type !== 'warmup'));
      expect(s.rows.filter((r) => r.type === 'warmup').every((r) => r.rpe === null)).toBe(true);
    }
    // The incline press after bench is warmed (WU2): none; the pushdown (triceps) keeps its one step (WU7).
    expect(slotsOf(after.blocks).map((s) => s.rows.filter((r) => r.type === 'warmup').length)).toEqual([4, 0, 1]);
  });
  it('warm-ups Ben set himself (`ownWarmups`, or a warm-up kg he typed) are kept as he set them', () => {
    const base = w();
    const mine = { ...base, blocks: base.blocks.map((b, i) => (i === 1 ? { ...b, slots: b.slots.map((s) => ({ ...s, ownWarmups: true as const })) } : b)) };
    const after = settleWarmups(mine, ctx);
    expect(slotsOf(after.blocks)[1]?.rows).toEqual(slotsOf(mine.blocks)[1]?.rows);
    const typed = { ...base, blocks: base.blocks.map((b, i) => (i === 2 ? { ...b, slots: b.slots.map((s) => ({ ...s, rows: s.rows.map((r) => (r.type === 'warmup' ? { ...r, load: 15, typed: true as const } : r)) })) } : b)) };
    expect(slotsOf(settleWarmups(typed, ctx).blocks)[2]?.rows).toEqual(slotsOf(typed.blocks)[2]?.rows);
  });
});

describe('WU2: is the muscle already warm?', () => {
  const p = (pattern: string, primary: string, over: { cardio?: boolean } = {}) => warmupProfileOf({ movementPattern: pattern, primaryMuscles: [primary], mechanic: 'compound', measurement: over.cardio === true ? 'cardio' : 'reps' }, { main: false, itemKind: 'barbell', convention: 'total' });
  const bench = p('horizontal_push', 'chest');
  const row = p('horizontal_pull', 'lats');
  const pulldown = p('vertical_pull', 'lats');
  const deadlift = warmupProfileOf({ movementPattern: 'hinge', primaryMuscles: ['glutes', 'hamstrings', 'spinal_erectors'], mechanic: 'compound' }, { main: false, itemKind: 'barbell', convention: 'total' });
  const pushdown = p('arms', 'triceps');
  const run = p('conditioning', 'quads', { cardio: true });
  const squat = p('squat', 'quads');

  it('same primary muscle group warms (pulldowns warm rows)', () => {
    expect(isWarmed(row, [pulldown])).toBe(true);
  });
  it('same movement pattern warms (leg press after squats)', () => {
    expect(isWarmed(p('squat', 'glutes'), [squat])).toBe(true);
  });
  it('secondary muscles don’t count: bench doesn’t warm triceps pushdowns; deadlifts don’t warm rows', () => {
    expect(isWarmed(pushdown, [bench])).toBe(false);
    expect(isWarmed(row, [deadlift])).toBe(false);
  });
  it('cardio and running never warm a lifting pattern', () => {
    expect(isWarmed(squat, [run])).toBe(false);
  });
  it('a superset partner of one already started is warmed', () => {
    expect(isWarmed(pushdown, [], true)).toBe(true);
  });
  it('nothing earlier: not warmed', () => {
    expect(isWarmed(bench, [])).toBe(false);
  });
});

describe('WU3: band', () => {
  it('heavy band is R ≤ 6, rep band R ≥ 7', () => {
    expect(heavyBand(6)).toBe(true);
    expect(heavyBand(7)).toBe(false);
  });
});

describe('WU4: heavy band ladder', () => {
  it('example 2: back squat 140 × 5, first exercise → bar 20 × 5, 55 × 5, 82.5 × 3, 110 × 2 (no gap step)', () => {
    expect(fmt(planWarmups(heavy({ load: 140, reps: 5 })))).toBe('20×5 55×5 82.5×3 110×2');
  });
  it('example 3: bench 100 × 3 → bar 20 × 5, 40 × 5, 60 × 3, 75 × 2, 87.5 × 1', () => {
    expect(fmt(planWarmups(heavy({ load: 100, reps: 3 })))).toBe('20×5 40×5 60×3 75×2 87.5×1');
  });
  it('warmed: 60 % × 3 → 80 % × 2 (+ 87.5 % × 1 when R ≤ 3)', () => {
    expect(fmt(planWarmups(heavy({ load: 100, reps: 5, warmed: true })))).toBe('60×3 80×2');
    expect(fmt(planWarmups(heavy({ load: 100, reps: 2, warmed: true })))).toBe('60×3 80×2 87.5×1');
  });
  it('the bar step needs W ≥ 3 × bar', () => {
    expect(fmt(planWarmups(heavy({ load: 59, reps: 5 })))).toBe('22.5×5 35×3 45×2');
    expect(fmt(planWarmups(heavy({ load: 60, reps: 5 })))).toBe('20×5 22.5×5 35×3 47.5×2');
  });
  it('gap check on snapped loads: a jump > 25 % of W gets a midpoint step with the lighter step’s reps', () => {
    // 180 × 5: bar 20 → 70 is 50 (> 45): 45 × 5 goes in between.
    expect(fmt(planWarmups(heavy({ load: 180, reps: 5 })))).toBe('20×5 45×5 70×5 107.5×3 142.5×2');
  });
  it('never more than 6 steps', () => {
    for (const W of [60, 100, 140, 180]) for (const reps of [1, 2, 3, 4, 5, 6]) expect(planWarmups(heavy({ load: W, reps })).length).toBeLessThanOrEqual(6);
  });
});

describe('WU5: rep band, heavy compound', () => {
  it('example 1: barbell row 90 × 12, not warmed → 45 × 8, 70 × 5', () => {
    expect(fmt(planWarmups(heavy({ load: 90, reps: 12, floorStart: true })))).toBe('45×8 70×5');
  });
  it('warmed (after pulldowns): 70 × 5 only', () => {
    expect(fmt(planWarmups(heavy({ load: 90, reps: 12, warmed: true })))).toBe('70×5');
  });
  it('R 7–9 tops out at × 4', () => {
    expect(fmt(planWarmups(heavy({ load: 100, reps: 8 })))).toBe('50×8 80×4');
  });
  it('the coach’s single rep is never what the table gives', () => {
    expect(planWarmups(heavy({ load: 90, reps: 12 })).every((s) => s.reps >= 2)).toBe(true);
  });
});

describe('WU6: secondary compound and machine compound with R ≤ 6', () => {
  const DB = dumbbells({ loads: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36] });
  const sec = (over: Partial<WarmupPlanInput>): WarmupPlanInput => ({ cls: 'secondary', reps: 10, load: 30, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: getAchievableLoads(DB).loads, ...over });
  it('R ≥ 10 → 80 % × 5; R 7–9 → 80 % × 4; R ≤ 6 → 60 % × 3, 80 % × 2', () => {
    expect(fmt(planWarmups(sec({ reps: 10 })))).toBe('24×5');
    expect(fmt(planWarmups(sec({ reps: 8 })))).toBe('24×4');
    expect(fmt(planWarmups(sec({ reps: 6 })))).toBe('18×3 24×2');
  });
  it('the session’s first exercise adds 50 % × 8 first', () => {
    expect(fmt(planWarmups(sec({ reps: 10, firstOfSession: true })))).toBe('14×8 24×5');
  });
  it('warmed: none', () => {
    expect(planWarmups(sec({ warmed: true }))).toEqual([]);
  });
  it('a machine compound follows WU6 only with R ≤ 6; with R ≥ 7 it is WU7 (50 % × 8)', () => {
    const loads = getAchievableLoads(stack({ stackLoads: Array.from({ length: 20 }, (_, k) => (k + 1) * 5) })).loads;
    expect(fmt(planWarmups({ ...sec({ cls: 'machine', reps: 6, load: 100, loads }) }))).toBe('60×3 80×2');
    expect(fmt(planWarmups({ ...sec({ cls: 'machine', reps: 10, load: 100, loads }) }))).toBe('50×8');
  });
});

describe('WU7: isolation, other machines, bodyweight, cardio, plate-loaded', () => {
  const iso = (over: Partial<WarmupPlanInput>): WarmupPlanInput => ({ cls: 'isolation', reps: 15, load: 10, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: getAchievableLoads(DB_1KG).loads, ...over });
  it('example 4: lateral raise 10 kg each × 15 → 5 × 8; after overhead pressing → none', () => {
    expect(fmt(planWarmups(iso({})))).toBe('5×8');
    expect(planWarmups(iso({ warmed: true }))).toEqual([]);
  });
  it('weighted bodyweight: bodyweight only × min(5, ⌈R/2⌉)', () => {
    expect(planWarmups(iso({ cls: 'weighted_bodyweight', reps: 8, load: 20 }))).toEqual([{ load: 0, reps: 4 }]);
    expect(planWarmups(iso({ cls: 'weighted_bodyweight', reps: 12, load: 20 }))).toEqual([{ load: 0, reps: 5 }]);
    expect(planWarmups(iso({ cls: 'weighted_bodyweight', reps: 12, load: 20, warmed: true }))).toEqual([]);
  });
  it('bodyweight and assisted: none (no easier-variation data: documented fallback); cardio: none', () => {
    expect(planWarmups(iso({ cls: 'bodyweight', reps: 5 }))).toEqual([]);
    expect(planWarmups(iso({ cls: 'none' }))).toEqual([]);
  });
  it('plate-loaded machine: % of the plates-only load (no sled weight recorded), snapped to its plates', () => {
    const loads = getAchievableLoads(plateMachine({ plates: [{ mass: 20, count: 10 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }] })).loads;
    // Leg press 200 × 10 not warmed: machine, rep band → WU7 50 % × 8 = 100.
    expect(fmt(planWarmups({ cls: 'machine', reps: 10, load: 200, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads }))).toBe('100×8');
    // Example 5 as a heavy compound, warmed: 160 × 5.
    expect(fmt(planWarmups({ cls: 'heavy', reps: 10, load: 200, warmed: true, firstOfSession: false, floorStart: false, barMass: null, loads }))).toBe('160×5');
  });
  it('profiles: catalogue facts and the item decide the class', () => {
    const facts = (over: object) => ({ movementPattern: 'horizontal_push', primaryMuscles: ['chest'], mechanic: 'compound' as const, measurement: 'reps', ...over });
    expect(warmupProfileOf(facts({}), { main: false, itemKind: 'barbell', convention: 'total' }).cls).toBe('heavy');
    expect(warmupProfileOf(facts({}), { main: false, itemKind: 'dumbbells', convention: 'per_hand' }).cls).toBe('secondary');
    expect(warmupProfileOf(facts({}), { main: true, itemKind: 'dumbbells', convention: 'per_hand' }).cls).toBe('heavy');
    expect(warmupProfileOf(facts({ catalogueKey: 'machine-chest-press' }), { main: false, itemKind: 'weight_stack', convention: 'stack' }).cls).toBe('machine');
    expect(warmupProfileOf(facts({ catalogueKey: 'cable-seated-row' }), { main: false, itemKind: 'weight_stack', convention: 'stack' }).cls).toBe('secondary');
    expect(warmupProfileOf(facts({}), { main: false, itemKind: 'plate_loaded_machine', convention: 'added' }).cls).toBe('machine');
    expect(warmupProfileOf(facts({ mechanic: 'isolation' }), { main: false, itemKind: 'weight_stack', convention: 'stack' }).cls).toBe('isolation');
    expect(warmupProfileOf(facts({ defaultLoadConvention: 'bodyweight' }), { main: false, itemKind: null, convention: 'added' }).cls).toBe('weighted_bodyweight');
    expect(warmupProfileOf(facts({}), { main: false, itemKind: 'assisted_stack', convention: 'assistance' }).cls).toBe('bodyweight');
    expect(warmupProfileOf(facts({ measurement: 'cardio', movementPattern: 'conditioning' }), { main: false, itemKind: null, convention: 'bodyweight' }).cls).toBe('none');
  });
});

describe('WU8: snapping', () => {
  it('every load is achievable on the item, snapped down, and below W', () => {
    for (const W of [47.5, 63, 100, 133.3]) {
      for (const s of planWarmups(heavy({ load: W, reps: 5 }))) {
        expect(BAR_LOADS).toContain(s.load);
        expect(s.load).toBeLessThan(W);
      }
    }
  });
  it('(a) a step below the item’s lightest becomes the lightest', () => {
    const loads = getAchievableLoads(stack()).loads; // 5..50
    expect(fmt(planWarmups({ cls: 'isolation', reps: 12, load: 8, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads }))).toBe('5×8');
  });
  it('(b) steps that land on the same load merge, keeping the larger reps', () => {
    const loads = [10, 30, 50, 70, 90];
    // 40 % = 40 → 30, 60 % = 60 → 50, 80 % = 80 → 70: distinct. With a coarser stack 40 and 60 both land on 30.
    expect(fmt(planWarmups(heavy({ load: 100, reps: 5, barMass: null, loads: [10, 30, 70] })))).toBe('30×5 70×2');
    expect(planWarmups(heavy({ load: 100, reps: 5, barMass: null, loads })).length).toBe(3);
  });
  it('(c) the top step stays ≤ 90 % of W (heavy band) and ≤ 85 % (rep band)', () => {
    for (const s of planWarmups(heavy({ load: 100, reps: 5, barMass: null, loads: [40, 60, 91, 95] }))) expect(s.load).toBeLessThanOrEqual(90);
    expect(fmt(planWarmups({ cls: 'isolation', reps: 12, load: 100, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: [50, 86] }))).toBe('50×8');
  });
  it('(d) WU4/WU5: a last step below 70 % of W moves to the next load up when that stays within (c)', () => {
    // 80 % of 100 = 80 → 65 on this ladder; the next load up, 85, is within 90 %.
    expect(planWarmups(heavy({ load: 100, reps: 5, barMass: null, loads: [40, 60, 65, 85, 100] })).at(-1)?.load).toBe(85);
    // In the rep band 85 % caps it: 65 stays.
    expect(planWarmups(heavy({ load: 100, reps: 12, barMass: null, loads: [40, 50, 65, 86, 100] })).at(-1)?.load).toBe(65);
  });
  it('(e) a step at or above W is dropped; nothing below W: no warm-ups', () => {
    expect(planWarmups(heavy({ load: 20, reps: 5, barMass: 20, loads: BAR_LOADS }))).toEqual([]);
    const loads = getAchievableLoads(stack()).loads;
    expect(planWarmups({ cls: 'isolation', reps: 12, load: 5, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads })).toEqual([]);
  });
  it('(f) rep band: a step before the top step that lands ≥ 60 % of W is dropped', () => {
    // Rows 90 × 12 with a plates-on start of 60 kg (WU9): 60 is ≥ 54 (60 % of W), so only 70 × 5 stays.
    expect(fmt(planWarmups(heavy({ load: 90, reps: 12, floorStart: true, fullPlateStart: 60 })))).toBe('70×5');
  });
});

describe('WU9: floor-start lifts', () => {
  it('no empty-bar step on a floor lift', () => {
    expect(fmt(planWarmups(heavy({ load: 140, reps: 5, floorStart: true })))).toBe('55×5 82.5×3 110×2');
  });
  it('the first step is at least the plates-on start when the gym records it', () => {
    expect(planWarmups(heavy({ load: 140, reps: 5, floorStart: true, fullPlateStart: 60 }))[0]?.load).toBe(60);
  });
  it('profile: deadlifts and floor rows are floor-start on a bar; a seal row or dumbbell deadlift isn’t', () => {
    const ctx = { main: false, itemKind: 'barbell', convention: 'total' as const };
    expect(warmupProfileOf({ family: 'deadlift', mechanic: 'compound' }, ctx).floorStart).toBe(true);
    expect(warmupProfileOf({ catalogueKey: 'barbell-bent-over-row', family: 'row', mechanic: 'compound' }, ctx).floorStart).toBe(true);
    expect(warmupProfileOf({ catalogueKey: 'barbell-seal-row', family: 'row', mechanic: 'compound' }, ctx).floorStart).toBe(false);
    expect(warmupProfileOf({ family: 'deadlift', mechanic: 'compound' }, { ...ctx, itemKind: 'kettlebell' }).floorStart).toBe(false);
  });
});

describe('WU10: don’t tire Ben out', () => {
  it('every step ≤ 8 reps; steps above 50 % ≤ max(R, 5); ≤ 25 reps in all', () => {
    for (const W of [60, 100, 140, 180]) {
      for (const R of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20]) {
        const steps = planWarmups(heavy({ load: W, reps: R }));
        expect(steps.reduce((n, s) => n + s.reps, 0)).toBeLessThanOrEqual(25);
        for (const s of steps) {
          expect(s.reps).toBeLessThanOrEqual(8);
          if (s.load > 0.5 * W) expect(s.reps).toBeLessThanOrEqual(Math.max(R, 5));
        }
      }
    }
  });
  it('1-rep steps only in the heavy band with R ≤ 3', () => {
    for (const R of [4, 5, 6, 8, 12]) expect(planWarmups(heavy({ load: 140, reps: R })).some((s) => s.reps === 1)).toBe(false);
    expect(planWarmups(heavy({ load: 140, reps: 3 })).some((s) => s.reps === 1)).toBe(true);
  });
});

describe('WU11: rest, time and the session budget', () => {
  it('time = Σ(reps × 4 s) + 60 s between steps', () => {
    expect(warmupTimeS([{ load: 20, reps: 5 }, { load: 55, reps: 5 }, { load: 82.5, reps: 3 }, { load: 110, reps: 2 }])).toBe(240);
    expect(warmupTimeS([])).toBe(0);
  });
  it('rest: 60 s between steps; 2 min before a rep-band first working set, 3 min heavy band', () => {
    expect(warmupRestS(5, false)).toBe(60);
    expect(warmupRestS(12, true)).toBe(120);
    expect(warmupRestS(5, true)).toBe(180);
  });
  it('example 7: squat 140 × 5, bench 100 × 3, row 90 × 12, lateral raise 10 × 15 with a general warm-up → cuts 1–3 bring it to ≈ 9.4 min', () => {
    const items = [
      { ...heavy({ load: 140, reps: 5 }), firstOfSession: true },
      heavy({ load: 100, reps: 3 }),
      heavy({ load: 90, reps: 12, floorStart: true }),
      { cls: 'isolation' as const, reps: 15, load: 10, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: getAchievableLoads(DB_1KG).loads },
    ];
    const plan = planSessionWarmups(items, { generalMinutes: 3 });
    expect(plan.generalMinutes).toBeNull();
    expect(plan.steps.map(fmt)).toEqual(['20×5 55×5 82.5×3 110×2', '20×5 40×5 60×3 75×2 87.5×1', '70×5', '']);
    expect(plan.timeS).toBe(240 + 304 + 20);
    expect(plan.overBudget).toBe(false);
  });
  it('cut 4: the bar step, then the short ladder; floors keep 2 steps on a heavy-band lift', () => {
    const items = [heavy({ load: 140, reps: 5 }), heavy({ load: 100, reps: 3 })];
    const tight = planSessionWarmups(items, { budgetS: 300 });
    expect(tight.steps.map(fmt)).toEqual(['70×5 105×2', '50×5 70×3 85×1']);
    expect(tight.overBudget).toBe(false);
    const none = planSessionWarmups(items, { budgetS: 10 });
    expect(none.steps.every((s) => s.length >= 2)).toBe(true);
    expect(none.overBudget).toBe(true);
  });
  it('within the budget nothing is cut', () => {
    const plan = planSessionWarmups([heavy({ load: 140, reps: 5 })], { generalMinutes: 3 });
    expect(plan.generalMinutes).toBe(3);
    expect(plan.cuts).toEqual(['full']);
  });
});

describe('WU12: general warm-up', () => {
  it('3 min before a heavy first exercise; none after cardio ≤ 30 min ago, or before a lighter first exercise', () => {
    expect(generalWarmupMinutes({ cls: 'heavy' })).toBe(3);
    expect(generalWarmupMinutes({ cls: 'heavy' }, 20)).toBeNull();
    expect(generalWarmupMinutes({ cls: 'heavy' }, 45)).toBe(3);
    expect(generalWarmupMinutes({ cls: 'isolation' })).toBeNull();
    expect(generalWarmupMinutes(null)).toBeNull();
  });
});

describe('a fixed count of warm-ups (a saved workout’s, or the coach’s when Ben asked for a number)', () => {
  it('takes the heaviest steps; more than the table fills gaps below W', () => {
    const full = planWarmups(heavy({ load: 90, reps: 12 }));
    expect(fmt(fitWarmupCount(full, 1, 90, BAR_LOADS))).toBe('70×5');
    expect(fitWarmupCount(full, 3, 90, BAR_LOADS).map((s) => s.load)).toEqual([22.5, 45, 70]);
    expect(fitWarmupCount(full, 0, 90, BAR_LOADS)).toEqual([]);
  });
  it('warmupShape: the table’s reps before the gym’s loads are known', () => {
    expect(warmupShape({ cls: 'heavy', reps: 12, warmed: false, firstOfSession: true, floorStart: true, bar: true })).toEqual([8, 5]);
    expect(warmupShape({ cls: 'heavy', reps: 5, warmed: false, firstOfSession: true, floorStart: false, bar: true })).toEqual([5, 5, 3, 2]);
    expect(warmupShape({ cls: 'isolation', reps: 12, warmed: true, firstOfSession: false, floorStart: false, bar: false })).toEqual([]);
    expect(warmupShape({ cls: 'heavy', reps: 12, warmed: false, firstOfSession: false, floorStart: false, bar: false }, 1)).toEqual([5]);
  });
});
