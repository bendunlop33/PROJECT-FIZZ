import { describe, expect, it } from 'vitest';
import {
  buildPlateSetup,
  convertMass,
  getAchievableLoads,
  isLoadAchievable,
  KG_PER_LB,
  roundToAvailableLoad,
  roundToStep,
  sameMass,
  stepLoad,
} from '../src/index';
import { assisted, barbell, bodyweightStation, dumbbells, kg, lb, plateMachine, stack } from './fixtures';

describe('units', () => {
  it('converts kg and lb with the exact pound definition', () => {
    expect(convertMass({ value: 1, unit: 'lb' }, 'kg').value).toBe(KG_PER_LB);
    expect(convertMass({ value: 100, unit: 'kg' }, 'lb').value).toBeCloseTo(220.462, 3);
    const round = convertMass(convertMass({ value: 102.5, unit: 'kg' }, 'lb'), 'kg');
    expect(round.value).toBeCloseTo(102.5, 9);
  });

  it('never compares masses across units implicitly', () => {
    expect(sameMass({ value: 100, unit: 'kg' }, { value: 100, unit: 'lb' })).toBe(false);
    expect(sameMass({ value: 0.1 + 0.2, unit: 'kg' }, { value: 0.3, unit: 'kg' })).toBe(true);
  });

  it('rounds to a display step without float noise', () => {
    expect(roundToStep(220.46226, 0.5)).toBe(220.5);
    expect(roundToStep(101.3, 1.25)).toBe(101.25);
  });
});

describe('getAchievableLoads', () => {
  it('barbell: bar plus balanced plate pairs only', () => {
    const a = getAchievableLoads(barbell());
    expect(a.unit).toBe('kg');
    expect(a.convention).toBe('total');
    expect(a.direction).toBe('resistance');
    expect(a.loads[0]).toBe(20);
    expect(a.loads).toContain(22.5);
    expect(a.loads).toContain(102.5);
    expect(a.loads).not.toContain(21.25); // a single 1.25 plate can't be balanced
    expect(a.loads[a.loads.length - 1]).toBe(187.5);
  });

  it('barbell: an odd plate count only contributes complete pairs', () => {
    const a = getAchievableLoads(barbell({ plates: [{ mass: 20, count: 3 }] }));
    expect(a.loads).toEqual([20, 60]);
  });

  it('barbell: honours an explicit max load', () => {
    const a = getAchievableLoads(barbell({ maxLoad: 100 }));
    expect(Math.max(...a.loads)).toBe(100);
  });

  it('dumbbells: per-hand list from the rack, bounded by the rack maximum', () => {
    const a = getAchievableLoads(dumbbells());
    expect(a.convention).toBe('per_hand');
    expect(a.loads[a.loads.length - 1]).toBe(30);
    expect(a.loads).not.toContain(37.5);
  });

  it('stack: pin positions plus optional add-ons used at most once', () => {
    const a = getAchievableLoads(stack({ addOns: [2.5] }));
    expect(a.loads).toContain(7.5);
    expect(a.loads).toContain(52.5);
    expect(a.loads).not.toContain(55);
  });

  it('stack: explicit non-uniform increments are not assumed to be 2.5', () => {
    const a = getAchievableLoads(stack({ stackLoads: [9, 18, 27, 36, 45.5] }));
    expect(a.loads).toEqual([9, 18, 27, 36, 45.5]);
  });

  it('assisted machine: direction is assistance', () => {
    const a = getAchievableLoads(assisted());
    expect(a.direction).toBe('assistance');
    expect(a.convention).toBe('assistance');
  });

  it('plate-loaded machine: added plates only, balanced or single horn', () => {
    expect(getAchievableLoads(plateMachine()).loads.slice(0, 4)).toEqual([0, 20, 40, 60]);
    const single = getAchievableLoads(plateMachine({ loadingSides: 1, plates: [{ mass: 10, count: 3 }] }));
    expect(single.loads).toEqual([0, 10, 20, 30]);
  });

  it('bodyweight station has no external loads', () => {
    expect(getAchievableLoads(bodyweightStation()).loads).toEqual([]);
  });

  it('lb equipment stays in lb', () => {
    const bar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 2.5, count: 2 }] });
    const a = getAchievableLoads(bar);
    expect(a.unit).toBe('lb');
    expect(a.loads).toEqual([45, 50, 135, 140, 225, 230]);
  });
});

describe('roundToAvailableLoad', () => {
  it('up / down / nearest on a barbell', () => {
    const eq = barbell();
    const r = (v: number, p: 'up' | 'down' | 'nearest') => {
      const res = roundToAvailableLoad(kg(v), eq, p);
      if (!res.ok) throw new Error(res.reason);
      return res.load.value;
    };
    expect(r(101, 'up')).toBe(102.5);
    expect(r(101, 'down')).toBe(100);
    expect(r(101, 'nearest')).toBe(100);
    expect(r(102, 'nearest')).toBe(102.5);
  });

  it('nearest ties go to the easier load', () => {
    const res = roundToAvailableLoad(kg(101.25), barbell(), 'nearest');
    expect(res.ok && res.load.value).toBe(100);
  });

  it('reports exact hits', () => {
    const res = roundToAvailableLoad(kg(100), barbell(), 'up');
    expect(res.ok && res.exact).toBe(true);
  });

  it('home gym dumbbells: 37.5 kg each is bounded to the 30 kg rack maximum', () => {
    const res = roundToAvailableLoad(kg(37.5, 'per_hand'), dumbbells(), 'up');
    expect(res).toMatchObject({ ok: true, load: { value: 30, unit: 'kg', convention: 'per_hand' }, bounded: 'max', exact: false });
  });

  it('never extrapolates past a machine maximum', () => {
    const res = roundToAvailableLoad(kg(80, 'stack'), stack(), 'harder');
    expect(res).toMatchObject({ ok: true, load: { value: 50 }, bounded: 'max' });
  });

  it('bounds below the minimum', () => {
    const res = roundToAvailableLoad(kg(2, 'per_hand'), dumbbells(), 'down');
    expect(res).toMatchObject({ ok: true, load: { value: 5 }, bounded: 'min' });
  });

  it('assisted: easier means MORE assistance, harder means less', () => {
    const eq = assisted();
    expect(roundToAvailableLoad(kg(12, 'assistance'), eq, 'easier')).toMatchObject({ ok: true, load: { value: 15 } });
    expect(roundToAvailableLoad(kg(12, 'assistance'), eq, 'harder')).toMatchObject({ ok: true, load: { value: 10 } });
    // tie between 10 and 15 goes to easier = 15 on an assisted machine
    expect(roundToAvailableLoad(kg(12.5, 'assistance'), eq, 'nearest')).toMatchObject({ ok: true, load: { value: 15 } });
  });

  it('converts explicit units and reports the conversion', () => {
    const res = roundToAvailableLoad(lb(225), barbell(), 'down');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.load).toEqual({ value: 100, unit: 'kg', convention: 'total' });
      expect(res.convertedRequest?.value).toBeCloseTo(102.058, 3);
    }
  });

  it('refuses to convert between load conventions (no machine-to-free-weight equivalence)', () => {
    expect(roundToAvailableLoad(kg(40, 'stack'), barbell(), 'nearest')).toMatchObject({
      ok: false,
      reason: 'convention_mismatch',
    });
  });

  it('reports equipment with no loads', () => {
    expect(roundToAvailableLoad(kg(0, 'bodyweight'), bodyweightStation(), 'nearest')).toMatchObject({
      ok: false,
      reason: 'no_achievable_loads',
    });
  });
});

describe('isLoadAchievable', () => {
  it('checks value, unit and convention', () => {
    expect(isLoadAchievable(kg(30, 'per_hand'), dumbbells())).toBe(true);
    expect(isLoadAchievable(kg(37.5, 'per_hand'), dumbbells())).toBe(false);
    expect(isLoadAchievable(lb(30, 'per_hand'), dumbbells())).toBe(false);
    expect(isLoadAchievable(kg(30, 'total'), dumbbells())).toBe(false);
  });
});

describe('stepLoad', () => {
  it('steps through feasible loads and stops at the maximum', () => {
    expect(stepLoad(100, barbell(), 'increase')).toEqual({ ok: true, value: 102.5 });
    expect(stepLoad(100, barbell(), 'decrease')).toEqual({ ok: true, value: 97.5 });
    expect(stepLoad(30, dumbbells(), 'increase')).toEqual({ ok: false, reason: 'at_max' });
    expect(stepLoad(5, dumbbells(), 'decrease')).toEqual({ ok: false, reason: 'at_min' });
  });

  it('steps from an off-profile typed value to the next real load', () => {
    expect(stepLoad(23, dumbbells(), 'increase')).toEqual({ ok: true, value: 25 });
    expect(stepLoad(23, dumbbells(), 'decrease')).toEqual({ ok: true, value: 22.5 });
  });
});

describe('buildPlateSetup', () => {
  it('uses the fewest plates per side', () => {
    expect(buildPlateSetup({ value: 100, unit: 'kg' }, barbell())).toEqual({
      ok: true,
      total: { value: 100, unit: 'kg' },
      base: { value: 20, unit: 'kg' },
      sides: 2,
      perSide: [{ mass: 20, count: 2 }],
    });
  });

  it('includes small plates', () => {
    const r = buildPlateSetup({ value: 102.5, unit: 'kg' }, barbell());
    expect(r.ok && r.perSide).toEqual([
      { mass: 20, count: 2 },
      { mass: 1.25, count: 1 },
    ]);
  });

  it('finds a solution where greedy would fail', () => {
    const eq = barbell({ plates: [{ mass: 15, count: 2 }, { mass: 10, count: 4 }] });
    const r = buildPlateSetup({ value: 60, unit: 'kg' }, eq);
    expect(r.ok && r.perSide).toEqual([{ mass: 10, count: 2 }]);
  });

  it('returns an infeasible result with the nearest achievable totals', () => {
    expect(buildPlateSetup({ value: 101, unit: 'kg' }, barbell())).toEqual({
      ok: false,
      reason: 'not_achievable',
      nearestBelow: 100,
      nearestAbove: 102.5,
    });
  });

  it('rejects loads below the bar and above the max', () => {
    expect(buildPlateSetup({ value: 15, unit: 'kg' }, barbell())).toMatchObject({ ok: false, reason: 'below_base' });
    expect(buildPlateSetup({ value: 200, unit: 'kg' }, barbell())).toMatchObject({
      ok: false,
      reason: 'above_max',
      nearestBelow: 187.5,
      nearestAbove: null,
    });
    expect(buildPlateSetup({ value: 120, unit: 'kg' }, barbell({ maxLoad: 100 }))).toMatchObject({
      ok: false,
      reason: 'above_max',
    });
  });

  it('lb bar: 225 lb is two 45s a side; a kg request is converted, not approximated', () => {
    const bar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 2.5, count: 2 }] });
    expect(buildPlateSetup({ value: 225, unit: 'lb' }, bar)).toMatchObject({ ok: true, perSide: [{ mass: 45, count: 2 }] });
    expect(buildPlateSetup({ value: 100, unit: 'kg' }, bar)).toMatchObject({
      ok: false,
      reason: 'not_achievable',
      nearestBelow: 140,
      nearestAbove: 225,
    });
  });

  it('plate-loaded machine reports added plates with a zero base', () => {
    const r = buildPlateSetup({ value: 100, unit: 'kg' }, plateMachine());
    expect(r).toMatchObject({ ok: true, base: { value: 0 }, perSide: [{ mass: 20, count: 2 }, { mass: 10, count: 1 }] });
  });

  it('is not available for non-plate equipment', () => {
    expect(buildPlateSetup({ value: 20, unit: 'kg' }, dumbbells())).toMatchObject({ ok: false, reason: 'not_plate_loaded' });
  });
});
