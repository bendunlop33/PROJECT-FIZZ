import { describe, expect, it } from 'vitest';
import type { EquipmentInstance } from '@fizz/schemas';
import {
  getAchievableLoads,
  isLoadAchievable,
  planPlateChain,
  planWarmups,
  plateBreakdownLine,
  plateKitOf,
  platesInChain,
  simpleWarmupLoads,
  stacksFor,
  stripFriendlyDrop,
  stripFriendlyRows,
  type BuilderSetRow,
  type PlateKit,
  type SlotLoadInput,
  type WarmupPlanInput,
  type WarmupStep,
} from '../src/index';
import { barbell, plateMachine } from './fixtures';

/**
 * Plate-friendly warm-ups and drops (Ben, 2 Nov): "Warm ups should ideally be in multiples of 5kg max but ideally
 * starting with 60kg, then 80kg then 100kg or 60 then 90 then 105 … minimal unloading of weights is the goal."
 * "Going from 100 kg to 97.5 on any set is a hassle unless built them up properly."
 */

const fmt = (s: readonly WarmupStep[]): string => s.map((x) => `${String(x.load)}×${String(x.reps)}`).join(' ');
/** A commercial gym: 25 → 1.25 kg, two pairs of each (the gym presets). */
const GYM = barbell({ plates: [25, 20, 15, 10, 5, 2.5, 1.25].map((mass) => ({ mass, count: 4 })) });
/** A home set: one pair of each, no 25s. */
const HOME = barbell({ plates: [20, 15, 10, 5, 2.5, 1.25].map((mass) => ({ mass, count: 2 })) });
const LB = barbell({ unit: 'lb', barMass: 45, plates: [45, 35, 25, 10, 5, 2.5].map((mass) => ({ mass, count: 4 })) });
const kitOf = (eq: EquipmentInstance): PlateKit => {
  const k = plateKitOf(eq);
  if (k === null) throw new Error('no kit');
  return k;
};

function warm(eq: EquipmentInstance, load: number, reps: number, over: Partial<WarmupPlanInput> = {}): WarmupStep[] {
  return planWarmups({
    cls: 'heavy',
    reps,
    load,
    warmed: false,
    firstOfSession: true,
    floorStart: false,
    barMass: eq.kind === 'barbell' ? eq.barMass : null,
    loads: getAchievableLoads(eq).loads,
    simple: simpleWarmupLoads(eq),
    ...over,
  });
}

/** Plates only go on from warm-up to warm-up and on to the working set. */
const onlyAdds = (eq: EquipmentInstance, steps: readonly WarmupStep[], W: number): boolean => planPlateChain([...steps.map((s) => s.load), W], kitOf(eq)).hassle === 0;

describe('stacks and chains', () => {
  it('stacks are heaviest inside (change plates in any order outside them), fewest plates first, from the real inventory', () => {
    const k = kitOf(GYM);
    expect(stacksFor(100, k)[0]).toEqual([25, 15]);
    for (const s of stacksFor(100, k)) {
      for (let j = 1; j < s.length; j += 1) if ((s[j - 1] ?? 0) > 2.5) expect(s[j] ?? 0).toBeLessThanOrEqual(s[j - 1] ?? 0);
      expect(s.reduce((n, m) => n + m, 0)).toBe(40);
    }
    expect(stacksFor(20, k)).toEqual([[]]);
    expect(stacksFor(21, k)).toEqual([]);
    // One pair of 20s only: 100 can't be 20 + 20 a side.
    expect(stacksFor(100, kitOf(barbell({ plates: [{ mass: 20, count: 2 }, { mass: 10, count: 4 }] })))).toEqual([[20, 10, 10]]);
  });
  it('60 → 80 → 100 → 90 × 2 loads 100 as 20 + 10 + 5 + 5: every warm-up adds, the back-offs take the 5s off', () => {
    const c = planPlateChain([60, 80, 100, 90, 90], kitOf(GYM));
    expect(c.stacks).toEqual([[20], [20, 10], [20, 10, 5, 5], [20, 10, 5], [20, 10, 5]]);
    expect(c.hassle).toBe(0);
  });
  it('97.5 → 92.5 is the 2.5s off when 97.5 is loaded 20 + 15 + 1.25 + 2.5 (change plates in any order)', () => {
    const c = planPlateChain([97.5, 92.5], kitOf(GYM));
    expect(c.hassle).toBe(0);
    expect(c.stacks[0]?.slice(-1)).toEqual([2.5]);
  });
  it('100 → 97.5 is a removal when the 1.25s go on outermost', () => {
    const c = planPlateChain([60, 80, 100, 97.5], kitOf(GYM));
    expect(c.hassle).toBe(0);
    expect(c.stacks[2]?.slice(-2)).toEqual([1.25, 1.25]);
  });
  it('a load the kit can’t make breaks the chain without failing it', () => {
    const c = planPlateChain([60, 61, 100], kitOf(GYM));
    expect(c.stacks[1]).toBeNull();
    expect(c.stacks[2]).not.toBeNull();
  });
  it('plate-loaded machines: plates added, per horn', () => {
    const m = plateMachine();
    const k = kitOf(m);
    expect(k.base).toBe(0);
    for (const s of stacksFor(100, k)) expect(s.reduce((n, x) => n + x, 0) * k.sides).toBe(100);
  });
});

describe('warm-ups: whole 5 kg plates, only adding, towards the working set (kg)', () => {
  it('100 kg × 5 → 60, 80 (the bar + 20s, then a 10 a side; 100 adds another 10)', () => {
    const s = warm(GYM, 100, 5);
    expect(fmt(s)).toBe('60×5 80×2');
    expect(planPlateChain([60, 80, 100], kitOf(GYM)).stacks).toEqual([[20], [20, 10], [20, 10, 10]]);
  });
  it('105 kg × 5 → 60, 90: Ben’s own ladder (a 30 kg jump, 29 % of W: a bar allows 30 %); plates only go on', () => {
    const s = warm(GYM, 105, 5);
    expect(fmt(s)).toBe('60×5 90×2');
    // 25 % would have forced 60, 80 (60 → 90 is over 26.25 kg).
    expect(planPlateChain([60, 90, 105], kitOf(GYM)).stacks).toEqual([[20], [20, 15], [20, 15, 5, 2.5]]);
    expect(onlyAdds(GYM, s, 105)).toBe(true);
  });
  it('107.5 kg × 5 → 2 warm-ups, not 5 (before: bar, 40, 60, 70, 90)', () => {
    const s = warm(GYM, 107.5, 5);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(fmt(s)).toBe('60×5 90×2');
    expect(onlyAdds(GYM, s, 107.5)).toBe(true);
  });
  it('92.5 kg × 5 → 60, 80', () => {
    expect(fmt(warm(GYM, 92.5, 5))).toBe('60×5 80×2');
    expect(onlyAdds(GYM, warm(GYM, 92.5, 5), 92.5)).toBe(true);
  });
  it('light 40 kg × 5: the empty bar, then 30', () => {
    expect(fmt(warm(GYM, 40, 5))).toBe('20×5 30×2');
  });
  it('the empty bar only up to 60 kg (3 × the bar); heavier lifts start with plates on, at most 60 kg', () => {
    for (let W = 62.5; W <= 200; W += 2.5) {
      const s = warm(GYM, W, 5);
      expect(s[0]?.load).toBeGreaterThan(20);
      expect(s[0]?.load).toBeLessThanOrEqual(60);
    }
  });
  it('100 kg × 3 → 60, 80, then a single at 90', () => {
    expect(fmt(warm(GYM, 100, 3))).toBe('60×5 80×2 90×1');
  });
  it('heavy lifts get 2–3 warm-ups up to 175 kg, every one the bar + whole 5 kg plates, under 90 % of W, no jump over 30 %', () => {
    for (let W = 62.5; W <= 175; W += 2.5) {
      for (const R of [3, 5]) {
        const s = warm(GYM, W, R);
        expect(s.length).toBeGreaterThanOrEqual(2);
        expect(s.length).toBeLessThanOrEqual(3);
        const pts = [...s.map((x) => x.load), W];
        for (let j = 1; j < pts.length; j += 1) expect((pts[j] ?? 0) - (pts[j - 1] ?? 0)).toBeLessThanOrEqual(0.3 * W + 1e-9);
        for (const x of s) {
          expect((x.load - 20) % 10).toBe(0);
          expect(x.load).toBeLessThanOrEqual(0.9 * W + 1e-9);
          expect(isLoadAchievable({ value: x.load, unit: 'kg', convention: 'total' }, GYM)).toBe(true);
        }
      }
    }
  });
  it('from 80 to 220 kg the plates only ever go on, warm-up to warm-up and on to the working set', () => {
    // Lighter lifts can need one swap: two pairs of 5s can't build 30 → 40 → 50 → 60 by adding alone.
    const bad: string[] = [];
    for (let W = 80; W <= 220; W += 2.5) for (const R of [3, 5, 8]) if (!onlyAdds(GYM, warm(GYM, W, R), W)) bad.push(`${String(W)}×${String(R)}: ${fmt(warm(GYM, W, R))}`);
    expect(bad).toEqual([]);
  });
  it('the warm-ups’ plates are never 2.5 or 1.25 kg', () => {
    for (let W = 60; W <= 175; W += 2.5) {
      const s = warm(GYM, W, 5);
      const c = planPlateChain([...s.map((x) => x.load), W], kitOf(GYM));
      for (const st of c.stacks.slice(0, s.length)) for (const p of st ?? []) expect(p).toBeGreaterThanOrEqual(5);
    }
  });
  it('a light lift (55 kg) still uses whole 5 kg plates: 30, 40', () => {
    expect(fmt(warm(GYM, 55, 5))).toBe('30×5 40×2');
  });
  it('a home set (one pair of each) stays achievable and below W, 2–3 warm-ups', () => {
    for (let W = 62.5; W <= 120; W += 2.5) {
      const s = warm(HOME, W, 5);
      expect(s.length).toBeLessThanOrEqual(3);
      for (const x of s) {
        expect(x.load).toBeLessThan(W);
        expect(isLoadAchievable({ value: x.load, unit: 'kg', convention: 'total' }, HOME)).toBe(true);
      }
    }
  });
  it('already warm (WU2): one step at about 80 %, plates only going on; never as many as the same lift cold', () => {
    const s = warm(GYM, 100, 5, { warmed: true });
    expect(fmt(s)).toBe('80×2');
    expect(onlyAdds(GYM, s, 100)).toBe(true);
    expect(fmt(warm(GYM, 140, 3, { warmed: true }))).toBe('110×2');
    for (let W = 40; W <= 200; W += 2.5) {
      for (const R of [1, 3, 5, 6]) {
        const hot = warm(GYM, W, R, { warmed: true });
        const cold = warm(GYM, W, R);
        expect(hot.length).toBeLessThanOrEqual(1);
        if (cold.length > 0) expect(hot.length).toBeLessThan(cold.length);
        for (const x of hot) {
          expect(x.load).toBeGreaterThanOrEqual(0.7 * W - 1e-9);
          expect(x.load).toBeLessThanOrEqual(0.9 * W + 1e-9);
          expect(isLoadAchievable({ value: x.load, unit: 'kg', convention: 'total' }, GYM)).toBe(true);
        }
      }
    }
  });
  it('already warm in the rep band (WU5): its one 80 % step, as before', () => {
    expect(warm(GYM, 100, 8, { warmed: true })).toHaveLength(1);
  });
  it('already warm with warm-ups off for time (WU11 none): none', () => {
    expect(warm(GYM, 100, 5, { warmed: true, cut: 'none' })).toEqual([]);
  });
  it('rep band 100 × 8: 50 × 8, 80 × 4 (the bar + 15s, then another 15 a side)', () => {
    const s = warm(GYM, 100, 8);
    expect(fmt(s)).toBe('50×8 80×4');
    expect(onlyAdds(GYM, s, 100)).toBe(true);
  });
  it('a deadlift from the floor never starts with the empty bar: 140 × 5 → 60, 100', () => {
    expect(fmt(warm(GYM, 140, 5, { floorStart: true }))).toBe('60×5 100×2');
  });
  it('Simple warm-up weights off: the 22 Oct table as before', () => {
    expect(fmt(warm(GYM, 100, 5, { simple: null }))).toBe('20×5 40×5 60×3 80×2');
  });
});

describe('warm-ups in lb: the bar + 20 lb steps, as Ben accepted', () => {
  it('225 lb × 5 → 125, 185 (before: 45, 85, 125, 145, 185)', () => {
    const s = warm(LB, 225, 5);
    expect(fmt(s)).toBe('125×5 185×2');
    for (const x of s) expect((x.load - 45) % 20).toBe(0);
  });
  it('135 lb × 5 → 65, 105', () => {
    expect(fmt(warm(LB, 135, 5))).toBe('65×5 105×2');
  });
});

describe('drops between working sets: take plates off, don’t swap them', () => {
  it('the worked-out load stays when the top can be loaded so it’s a removal (100 → 95 with 2.5s outermost)', () => {
    expect(stripFriendlyDrop({ value: 95, before: [60, 80, 100], kit: kitOf(GYM), loads: getAchievableLoads(GYM).loads })).toBe(95);
    expect(stripFriendlyDrop({ value: 97.5, before: [60, 80, 100], kit: kitOf(GYM), loads: getAchievableLoads(GYM).loads })).toBe(97.5);
  });
  it('one pair of each plate: 100 is 20 + 15 + 5, so a worked-out 92.5 becomes 90 (the 5s off), within 5 %', () => {
    expect(stripFriendlyDrop({ value: 92.5, before: [100], kit: kitOf(HOME), loads: getAchievableLoads(HOME).loads })).toBe(90);
  });
  it('no 97.5 when the plates can’t make it a removal: two pairs of 2.5s and one of 1.25s → 95', () => {
    const eq = barbell({ plates: [{ mass: 20, count: 2 }, { mass: 15, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 4 }, { mass: 1.25, count: 2 }] });
    expect(stripFriendlyDrop({ value: 97.5, before: [100], kit: kitOf(eq), loads: getAchievableLoads(eq).loads })).toBe(95);
  });
  it('nothing within 5 % fits: the worked-out load as it was (never further down)', () => {
    // 100 = 20 + 15 + 5 only; 95 and 92.5 both need a plate on; 90 is over 5 % below 97.5.
    expect(stripFriendlyDrop({ value: 97.5, before: [100], kit: kitOf(HOME), loads: getAchievableLoads(HOME).loads })).toBe(97.5);
  });
  it('never heavier than worked out, and a set that isn’t lighter is left alone', () => {
    const loads = getAchievableLoads(HOME).loads;
    for (let v = 40; v < 100; v += 2.5) expect(stripFriendlyDrop({ value: v, before: [100], kit: kitOf(HOME), loads })).toBeLessThanOrEqual(v);
    expect(stripFriendlyDrop({ value: 100, before: [100], kit: kitOf(HOME), loads })).toBe(100);
    expect(stripFriendlyDrop({ value: 90, before: [], kit: kitOf(HOME), loads })).toBe(90);
  });
  it('builder rows: a back-off Ben typed is kept as typed; the others go to a removal; the top and warm-ups never move', () => {
    const load = slotLoad(HOME);
    const rows: BuilderSetRow[] = [
      { type: 'warmup', reps: 5, load: 60, rpe: null },
      { type: 'top', reps: 6, load: 100, rpe: 8 },
      { type: 'backoff', reps: 8, load: 92.5, rpe: 8 },
      { type: 'backoff', reps: 8, load: 92.5, rpe: 8, typed: true },
    ];
    const out = stripFriendlyRows(rows, load);
    expect(out.map((r) => r.load)).toEqual([60, 100, 90, 92.5]);
  });
  it('an item that isn’t plate-loaded (dumbbells, stacks) is left alone', () => {
    const rows: BuilderSetRow[] = [
      { type: 'top', reps: 6, load: 100, rpe: 8 },
      { type: 'backoff', reps: 8, load: 92.5, rpe: 8 },
    ];
    expect(stripFriendlyRows(rows, { ...slotLoad(HOME), equipment: null }).map((r) => r.load)).toEqual([100, 92.5]);
  });
});

describe('showing the plates in the order they come off', () => {
  it('the top set’s plates follow its warm-ups and back-offs; without the run, the fewest plates', () => {
    const load = { value: 100, unit: 'kg' as const, convention: 'total' as const };
    const chain = { loads: [60, 80, 100, 90].map((value) => ({ value, unit: 'kg' as const, convention: 'total' })), at: 2 };
    expect(platesInChain(100, GYM, chain)).toEqual([20, 10, 5, 5]);
    const plain = (t: string | null): string | null => t?.replace(/\u00a0/g, ' ') ?? null;
    expect(plain(plateBreakdownLine(load, GYM, chain))).toBe('20 bar + 20 + 10 + 5 + 5 / side');
    expect(plain(plateBreakdownLine(load, GYM))).toBe('20 bar + 25 + 15 / side');
  });
});

function slotLoad(eq: EquipmentInstance): SlotLoadInput {
  return {
    unit: 'kg',
    convention: 'total',
    equipment: eq,
    painCap: null,
  } as unknown as SlotLoadInput;
}
