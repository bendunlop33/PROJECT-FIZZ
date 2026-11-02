import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, TrainingChange, TrainingProfile } from '@fizz/schemas';
import {
  applyTrainingChange,
  fewPlateSizes,
  getAchievableLoads,
  isLoadAchievable,
  isPrehabExercise,
  newTrainingProfile,
  planWarmups,
  simpleWarmupLoads,
  toScaled,
  warmupPrefsOf,
  warmupProfileOf,
  type WarmupPlanInput,
  type WarmupStep,
} from '../src/index';
import { barbell, dumbbells, plateMachine, stack } from './fixtures';

/**
 * WU8 amendment, simple warm-up loads (Ben, 1 Nov): warm-ups use easy-to-load numbers; prehab work has no warm-ups.
 */

const fmt = (s: readonly WarmupStep[]): string => s.map((x) => `${String(x.load)}×${String(x.reps)}`).join(' ');
const PLATES_KG = [{ mass: 25, count: 4 }, { mass: 20, count: 4 }, { mass: 15, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }];
const BAR = barbell({ plates: PLATES_KG });

function input(eq: EquipmentInstance, over: Partial<Omit<WarmupPlanInput, 'simple'>> & { plain?: boolean }): WarmupPlanInput {
  const { plain = false, ...rest } = over;
  return {
    cls: 'heavy',
    reps: 5,
    load: 100,
    warmed: false,
    firstOfSession: false,
    floorStart: false,
    barMass: eq.kind === 'barbell' ? eq.barMass : null,
    loads: getAchievableLoads(eq).loads,
    simple: plain ? null : simpleWarmupLoads(eq),
    ...rest,
  };
}

describe('simple loads on a barbell (kg)', () => {
  // (Ben, 2 Nov) Plate-friendly warm-ups (plate-path.test.ts): the bar + 20s first, plates only going on.
  it('100 kg bench × 3: 60, 80, then 90 × 1 (1 Nov: bar, 40, 60, 80; 22 Oct: 75 and 87.5)', () => {
    expect(fmt(planWarmups(input(BAR, { load: 100, reps: 3, plain: true })))).toBe('20×5 40×5 60×3 75×2 87.5×1');
    expect(fmt(planWarmups(input(BAR, { load: 100, reps: 3 })))).toBe('60×5 80×2 90×1');
  });
  it('100 kg bench × 5 with one pair of 10s: 60, 90 (20 + 15 + 5 a side: plates only go on; 1 Nov: bar, 40, 60, 80)', () => {
    expect(fmt(planWarmups(input(BAR, { load: 100, reps: 5 })))).toBe('60×5 90×2');
  });
  it('92.5 kg × 5: 60, 80 (1 Nov: bar, 40, 60, 70; 22 Oct: 35, 55, 72.5)', () => {
    expect(fmt(planWarmups(input(BAR, { load: 92.5, reps: 5, plain: true })))).toBe('20×5 35×5 55×3 72.5×2');
    expect(fmt(planWarmups(input(BAR, { load: 92.5, reps: 5 })))).toBe('60×5 80×2');
  });
  it('140 kg × 3 keeps WU4’s gaps: 20 kg steps only where no jump is over 25 % of W', () => {
    const steps = planWarmups(input(BAR, { load: 140, reps: 3 }));
    const points = [...steps.map((s) => s.load), 140];
    for (let k = 1; k < points.length; k += 1) expect((points[k] ?? 0) - (points[k - 1] ?? 0)).toBeLessThanOrEqual(35);
    for (const s of steps) expect((s.load - 20) % 10).toBe(0);
  });
  it('nothing reaches the working weight, and every step is achievable, for any W and reps', () => {
    for (let W = 22.5; W <= 200; W += 2.5) {
      for (const reps of [1, 3, 5, 8, 12]) {
        for (const s of planWarmups(input(BAR, { load: W, reps }))) {
          expect(s.load).toBeLessThan(W);
          expect(isLoadAchievable({ value: s.load, unit: 'kg', convention: 'total' }, BAR)).toBe(true);
        }
      }
    }
  });
  it('rounding that collapses two steps into one load keeps one of them', () => {
    // 45 kg × 3: 18, 27, 33.75, 39.4 → bar, 30, 30, 40 → bar, 30, 40 (no load twice).
    const steps = planWarmups(input(BAR, { load: 45, reps: 3 }));
    const loads = steps.map((s) => s.load);
    expect(new Set(loads).size).toBe(loads.length);
    expect(loads.every((l) => l < 45)).toBe(true);
  });
  it('at most 2 plate sizes a side when the inventory can do it', () => {
    for (const W of [80, 100, 120, 150]) {
      for (const s of planWarmups(input(BAR, { load: W, reps: 5 }))) {
        expect(fewPlateSizes((toScaled(s.load) - toScaled(20)) / 2, PLATES_KG)).toBe(true);
      }
    }
  });
  it('a limited plate set (20s and 5s only) stays achievable: snaps down where a simple load can’t be made', () => {
    const small = barbell({ plates: [{ mass: 20, count: 2 }, { mass: 5, count: 4 }] });
    for (const W of [60, 70, 80]) {
      for (const s of planWarmups(input(small, { load: W, reps: 5 }))) {
        expect(isLoadAchievable({ value: s.load, unit: 'kg', convention: 'total' }, small)).toBe(true);
        expect(s.load).toBeLessThan(W);
      }
    }
    // (Ben, 2 Nov) 40 (two 5s a side), 60 (a 20 a side): fewest steps (1 Nov: bar, 30, 40, 60).
    expect(fmt(planWarmups(input(small, { load: 80, reps: 5 })))).toBe('40×5 60×2');
  });
});

describe('simple loads on a barbell (lb)', () => {
  const LB_BAR = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 6 }, { mass: 35, count: 2 }, { mass: 25, count: 2 }, { mass: 10, count: 4 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
  it('225 lb × 5: the bar + multiples of 20 lb, from at most the bar + 80 lb, jumps up to 30 % (Ben, 2 Nov; 1 Nov: 45, 85, 125, 145, 185)', () => {
    const steps = planWarmups(input(LB_BAR, { load: 225, reps: 5, barMass: 45 }));
    expect(steps[0]?.load).toBe(125);
    for (const s of steps) expect((s.load - 45) % 20).toBe(0);
    expect(fmt(steps)).toBe('125×5 185×2');
    for (const s of steps) expect(s.load).toBeLessThanOrEqual(0.9 * 225);
  });
});

describe('simple loads on dumbbells, stacks and machines', () => {
  const RACK = dumbbells({ loads: [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40] });
  it('32.5 kg DB press × 6, first exercise: 15, 20, 25 (before: 15, 17.5, 25)', () => {
    const base = { cls: 'secondary' as const, load: 32.5, reps: 6, firstOfSession: true, barMass: null };
    expect(fmt(planWarmups(input(RACK, { ...base, plain: true })))).toBe('15×8 17.5×3 25×2');
    expect(fmt(planWarmups(input(RACK, base)))).toBe('15×8 20×3 25×2');
  });
  it('32.5 kg DB press × 10: one step at 25', () => {
    expect(fmt(planWarmups(input(RACK, { cls: 'secondary', load: 32.5, reps: 10, barMass: null })))).toBe('25×5');
  });
  it('a 2 kg-step rack without the 5s near a step: the nearest the rack has below it', () => {
    const odd = dumbbells({ loads: [2, 4, 6, 8, 12, 14, 16, 18, 22, 24, 26, 28, 32] });
    // 0.8 × 32 = 25.6: no 25 in the rack, nearest simple (20, 30) is too far, so 24.
    expect(fmt(planWarmups(input(odd, { cls: 'secondary', load: 32, reps: 10, barMass: null })))).toBe('24×5');
  });
  it('50 kg stack × 6: multiples of 10 (30, 40)', () => {
    const s = stack({ stackLoads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50] });
    expect(fmt(planWarmups(input(s, { cls: 'secondary', load: 50, reps: 6, barMass: null, plain: true })))).toBe('30×3 40×2');
    expect(fmt(planWarmups(input(s, { cls: 'secondary', load: 52.5, reps: 6, barMass: null, plain: true })))).toBe('30×3 40×2');
    expect(fmt(planWarmups(input(s, { cls: 'secondary', load: 47.5, reps: 6, barMass: null, plain: true })))).toBe('27.5×3 37.5×2');
    expect(fmt(planWarmups(input(s, { cls: 'secondary', load: 47.5, reps: 6, barMass: null })))).toBe('30×3 40×2');
  });
  it('a stack with a bigger own step (12.5) uses its own step', () => {
    const s = stack({ stackLoads: [12.5, 25, 37.5, 50, 62.5, 75] });
    expect(simpleWarmupLoads(s)?.step).toBe(12.5);
  });
  it('plate-loaded machine (added): multiples of 10', () => {
    const m = plateMachine();
    for (const st of planWarmups(input(m, { cls: 'machine', load: 140, reps: 6, barMass: null }))) expect(st.load % 10).toBe(0);
  });
  it('Simple warm-up weights off: the 22 Oct snapping', () => {
    expect(planWarmups(input(RACK, { cls: 'secondary', load: 32.5, reps: 6, firstOfSession: true, barMass: null, plain: true })).map((x) => x.load)).toEqual([15, 17.5, 25]);
  });
});

describe('prehab: no warm-up sets', () => {
  const ctx = { main: false, itemKind: 'dumbbells', convention: 'per_hand' as const };
  it('rotator cuff, Y raises, band pull-aparts and face pulls are prehab; rows are not', () => {
    expect(isPrehabExercise({ catalogueKey: 'dumbbell-side-lying-external-rotation', family: 'shoulder_external_rotation', primaryMuscles: ['rotator_cuff'] })).toBe(true);
    expect(isPrehabExercise({ catalogueKey: 'cable-external-rotation' })).toBe(true);
    expect(isPrehabExercise({ catalogueKey: 'band-pull-apart', family: 'rear_delt_fly', primaryMuscles: ['rear_delts'] })).toBe(true);
    expect(isPrehabExercise({ catalogueKey: 'dumbbell-incline-y-raise', family: 'y_raise' })).toBe(true);
    // Face pulls (any equipment) are shoulder-health work too (coordinator review, 1 Nov).
    expect(isPrehabExercise({ catalogueKey: 'cable-face-pull', family: 'face_pull', primaryMuscles: ['rear_delts'] })).toBe(true);
    expect(isPrehabExercise({ catalogueKey: null, family: 'face_pull' })).toBe(true);
    expect(isPrehabExercise({ catalogueKey: 'dumbbell-row', family: 'row', primaryMuscles: ['lats'] })).toBe(false);
  });
  it('side-lying external rotation gets class none (no warm-ups); `normal` gives it WU7’s one step; other isolation keeps one step', () => {
    const er = { catalogueKey: 'dumbbell-side-lying-external-rotation', family: 'shoulder_external_rotation', mechanic: 'isolation' as const, primaryMuscles: ['rotator_cuff'], measurement: 'reps' };
    expect(warmupProfileOf(er, ctx).cls).toBe('none');
    expect(warmupProfileOf(er, { ...ctx, setting: 'normal' }).cls).toBe('isolation');
    const curl = { catalogueKey: 'dumbbell-curl', family: 'curl', mechanic: 'isolation' as const, primaryMuscles: ['biceps'], measurement: 'reps' };
    expect(warmupProfileOf(curl, ctx).cls).toBe('isolation');
    expect(warmupProfileOf(curl, { ...ctx, setting: 'off' }).cls).toBe('none');
    expect(planWarmups({ cls: 'none', reps: 12, load: 5, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: [2, 4, 5] })).toEqual([]);
  });
});

describe('the preference on the training profile', () => {
  const base: TrainingProfile = newTrainingProfile({ id: '00000000-0000-4000-8000-0000000000aa', ownerId: '00000000-0000-4000-8000-0000000000bb', atUtc: '2026-11-01T00:00:00.000Z' });
  it('absent = simple loads on; off is stored, on again clears it; per-exercise settings set and clear', () => {
    expect(warmupPrefsOf(null).simpleLoads).toBe(true);
    const w = (opId: string, expectedVersion: number) => ({ opId, expectedVersion, atUtc: '2026-11-01T00:00:00.000Z', nowYear: 2026, today: '2026-11-01' });
    const step = (p: TrainingProfile, c: TrainingChange, op: string): TrainingProfile => {
      const r = applyTrainingChange(p, c, w(op, p.version));
      if (!r.ok) throw new Error(r.error);
      return r.profile;
    };
    const off = step(base, { kind: 'warmup_prefs', simpleLoads: false }, 'a');
    expect(off.warmups).toEqual({ simpleLoads: false });
    expect(warmupPrefsOf(off).simpleLoads).toBe(false);
    const per = step(off, { kind: 'warmup_prefs', perExercise: { ex1: 'off' } }, 'b');
    expect(per.warmups).toEqual({ simpleLoads: false, perExercise: { ex1: 'off' } });
    const back = step(per, { kind: 'warmup_prefs', simpleLoads: true, perExercise: { ex1: null } }, 'c');
    expect(back.warmups).toBeUndefined();
    expect(applyTrainingChange(back, { kind: 'warmup_prefs', simpleLoads: false }, w('d', 1)).ok).toBe(false);
  });
});

describe('(c) still caps every step (review of the 20 kg ladder)', () => {
  it('no warm-up above 90 % of W in the heavy band or 85 % in the rep band, for any W', () => {
    const plates = barbell({ plates: [{ mass: 25, count: 4 }, { mass: 20, count: 4 }, { mass: 15, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
    for (let W = 40; W <= 220; W += 2.5) {
      for (const reps of [3, 5, 8, 12]) {
        const cap = (reps <= 6 ? 0.9 : 0.85) * W;
        for (const s of planWarmups(input(plates, { load: W, reps }))) expect(s.load).toBeLessThanOrEqual(cap + 1e-9);
      }
    }
  });
});
