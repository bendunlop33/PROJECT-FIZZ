import { describe, expect, it } from 'vitest';

import type { EquipmentInstance } from '@fizz/schemas';

import { buildPlateSetup, getAchievableLoads, PLATE_SEARCH_MAX_NODES, SUBSET_SUM_LIMITS } from '../src/equipment';
import { LOAD_RANGE_MAX_VALUES, loadRange } from '../src/gym-presets';
import { rangeValues } from '../src/gym-editor';
import { countAxisTicks, countSessions } from '../src/progress/activity';
import { pickerMonths, progressWindow } from '../src/progress/window';
import { weekBars } from '../src/progress/training-period';
import { dumbbellLoadsFor } from '../src/quick-gym';
import { weekFacts } from '../src/session/week-plan';
import { fitWarmupCount } from '../src/warmup/plan';

/**
 * (Hang fix, 27 Oct: build 457 blank after Start.) Every loop with a computed bound or step that a stored value
 * reaches terminates on odd-but-possible input: step 0, NaN, Infinity, a huge max, schema-maximum inventories,
 * malformed dates (before the fix, `rangeValues` with an infinite `from` pushed until the array overflowed, and
 * `countAxisTicks(Infinity)` never returned). The wall-clock budgets are in `loop-bounds-27oct.perf.test.ts`.
 */
function quick<T>(fn: () => T): T {
  return fn();
}

function settles(fn: () => unknown): void {
  quick(() => {
    try {
      fn();
    } catch (e) {
      // A clear RangeError is a fine answer to nonsense input; a hang is not.
      expect(e).toBeInstanceOf(RangeError);
    }
  });
}

const ODD = [0, -1, -0.001, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9, 1e15, Number.MAX_VALUE];

describe('load ranges', () => {
  it('loadRange: normal results unchanged; any odd from/to/step terminates or throws at once', () => {
    expect(loadRange(2.5, 10, 2.5)).toEqual([2.5, 5, 7.5, 10]);
    expect(loadRange(5, 100, 5)).toHaveLength(20);
    for (const a of [...ODD, 1, 2.5]) for (const b of [...ODD, 10, 100]) for (const s of [...ODD, 1, 2.5]) settles(() => loadRange(a, b, s));
    expect(() => loadRange(1, 1e9, 0.001)).toThrow(RangeError);
    expect(loadRange(0.001, LOAD_RANGE_MAX_VALUES * 0.001 - 0.001, 0.001)).toHaveLength(LOAD_RANGE_MAX_VALUES - 1);
  });

  it('dumbbellLoadsFor: the light ladder unchanged; NaN, Infinity and huge maxes never loop', () => {
    expect(dumbbellLoadsFor('kg', 1, 15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5, 15]);
    expect(dumbbellLoadsFor('kg', 2.5, 10)).toEqual([2.5, 5, 7.5, 10]);
    for (const unit of ['kg', 'lb'] as const) for (const step of [...ODD, 1, 2.5, 5]) for (const max of [...ODD, 50]) settles(() => dumbbellLoadsFor(unit, step, max));
  });

  it('the gym editor’s range values stay capped at 500', () => {
    for (const from of [...ODD, 1]) for (const to of [...ODD, 100]) for (const step of [...ODD, 0.5]) settles(() => rangeValues({ from, to, step }));
    expect(rangeValues({ from: 1, to: 1e9, step: 0.001 })).toEqual([]);
  });
});

const meta = { id: 'eq', ownerId: 'o', version: 1, createdAtUtc: '2026-10-01T00:00:00.000Z', updatedAtUtc: '2026-10-01T00:00:00.000Z', gymId: 'g', name: 'Bar', unit: 'kg', movementTags: [], availability: 'available' } as const;

function bar(plates: { mass: number; count: number }[]): EquipmentInstance {
  return { ...meta, kind: 'barbell', loadConvention: 'total', barMass: 20, plates } as unknown as EquipmentInstance;
}

describe('plate sums and plate setups', () => {
  it('a real bar: the same loads and setups as before', () => {
    const eq = bar([25, 20, 15, 10, 5, 2.5, 1.25].map((mass) => ({ mass, count: 8 })));
    const loads = getAchievableLoads(eq).loads;
    expect(loads[0]).toBe(20);
    expect(loads.at(-1)).toBe(20 + 2 * 4 * (25 + 20 + 15 + 10 + 5 + 2.5 + 1.25));
    expect(loads).toHaveLength(Math.round(((loads.at(-1) ?? 0) - 20) / 2.5) + 1);
    expect(buildPlateSetup({ value: 100, unit: 'kg' }, eq)).toMatchObject({ ok: true, perSide: [{ mass: 25, count: 1 }, { mass: 15, count: 1 }] });
  });

  it('the schema’s largest inventory (50 odd plate masses × 200 each) terminates quickly', () => {
    const plates = Array.from({ length: 50 }, (_, i) => ({ mass: 0.25 + i * 1.37 + (i % 7) * 0.013, count: 200 }));
    const eq = bar(plates);
    const loads = quick(() => getAchievableLoads(eq).loads);
    expect(loads.length).toBeLessThanOrEqual(SUBSET_SUM_LIMITS.maxSums);
    for (const l of [loads[1] ?? 20, loads[Math.floor(loads.length / 2)] ?? 20, loads.at(-1) ?? 20, 20.37]) settles(() => buildPlateSetup({ value: l, unit: 'kg' }, eq));
    expect(PLATE_SEARCH_MAX_NODES).toBeGreaterThan(1000);
  });
});

describe('warm-up count', () => {
  it('a huge or odd stored count never loops', () => {
    const loads = Array.from({ length: 400 }, (_, k) => k * 0.25);
    for (const n of [...ODD, 3, 1e6]) for (const W of [...ODD, 100]) settles(() => fitWarmupCount([], n, W, loads));
    expect(quick(() => fitWarmupCount([], 1e9, 100, loads)).length).toBeLessThanOrEqual(30);
  });
});

describe('chart axes and calendar loops', () => {
  it('countAxisTicks: Infinity no longer loops; normal ticks unchanged', () => {
    expect(countAxisTicks(4)).toEqual([0, 1, 2, 3, 4]);
    for (const n of ODD) settles(() => countAxisTicks(n));
  });

  it('activity buckets, picker months, week bars and the week’s open dates terminate on malformed dates', () => {
    const DATES = ['', 'x', '2026-13-45', 'NaN-NaN-NaN', '0000-01-01', '9999-12-31', '2026-10-27T10:00:00Z', '2026-10-27'];
    for (const from of DATES) {
      for (const to of DATES) {
        settles(() => countSessions([], { from, to, days: 400, preset: null, previous: { from, to } }));
        settles(() => pickerMonths(from, to));
        settles(() => weekBars([], { from, to }, to, null));
      }
    }
    settles(() => countSessions([], progressWindow('2026-10-27', 3 * 366)));
    for (const today of DATES) {
      settles(() => weekFacts({ nowMs: Date.parse('2026-10-27T10:00:00Z'), tz: 'Europe/London', today, gymDates: new Set([today]), aim: 3, days: [], activities: [] }));
    }
  });
});
