import { describe, expect, it } from 'vitest';

import type { EquipmentInstance } from '@fizz/schemas';

import { buildPlateSetup, getAchievableLoads } from '../src/equipment';
import { rangeValues } from '../src/gym-editor';
import { loadRange } from '../src/gym-presets';
import { countAxisTicks, countSessions } from '../src/progress/activity';
import { pickerMonths } from '../src/progress/window';
import { weekBars } from '../src/progress/training-period';
import { dumbbellLoadsFor } from '../src/quick-gym';
import { fitWarmupCount } from '../src/warmup/plan';

/**
 * (Hang fix, 27 Oct) Wall-clock budgets for `loop-bounds-27oct.test.ts`'s odd inputs: each finishes well under
 * 200 ms in Node (the phone's Hermes is several times slower; a real blocking loop there blanks the screen).
 */
const BUDGET_MS = 200;
const ODD = [0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9, 1e15, Number.MAX_VALUE];

function within(fn: () => unknown): void {
  const t0 = performance.now();
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RangeError);
  }
  expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
}

const meta = { id: 'eq', ownerId: 'o', version: 1, createdAtUtc: '2026-10-01T00:00:00.000Z', updatedAtUtc: '2026-10-01T00:00:00.000Z', gymId: 'g', name: 'Bar', unit: 'kg', movementTags: [], availability: 'available' } as const;

describe('loop bounds within budget', () => {
  it('ranges, racks and editor ranges', () => {
    for (const a of [...ODD, 1]) for (const b of [...ODD, 100]) for (const s of [...ODD, 2.5]) {
      within(() => loadRange(a, b, s));
      within(() => rangeValues({ from: a, to: b, step: s }));
    }
    for (const step of [...ODD, 1, 2.5]) for (const max of [...ODD, 50]) within(() => dumbbellLoadsFor('kg', step, max));
  });

  it('the schema’s largest plate inventory: loads and plate setups', () => {
    const plates = Array.from({ length: 50 }, (_, i) => ({ mass: 0.25 + i * 1.37 + (i % 7) * 0.013, count: 200 }));
    const eq = { ...meta, kind: 'barbell', loadConvention: 'total', barMass: 20, plates } as unknown as EquipmentInstance;
    let loads: readonly number[] = [];
    within(() => (loads = getAchievableLoads(eq).loads));
    for (const l of [loads[1] ?? 20, loads[Math.floor(loads.length / 2)] ?? 20, loads.at(-1) ?? 20, 20.37]) within(() => buildPlateSetup({ value: l, unit: 'kg' }, eq));
  });

  it('warm-up counts, axis ticks and calendar loops', () => {
    const loads = Array.from({ length: 400 }, (_, k) => k * 0.25);
    for (const n of [...ODD, 1e6]) within(() => fitWarmupCount([], n, 100, loads));
    for (const n of ODD) within(() => countAxisTicks(n));
    const DATES = ['', 'x', 'NaN-NaN-NaN', '0000-01-01', '9999-12-31', '2026-10-27'];
    for (const from of DATES) for (const to of DATES) {
      within(() => countSessions([], { from, to, days: 400, preset: null, previous: { from, to } }));
      within(() => pickerMonths(from, to));
      within(() => weekBars([], { from, to }, to, null));
    }
  });
});
