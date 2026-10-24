import { describe, expect, it } from 'vitest';
import { addDropSet, editSetRow, makeSlot, setRowsFor, setWorkingCount, type BuilderSlot, type SetRowsInput, type SlotLoadInput } from '../src/index';
import { assist, cable, context, lbRack, loadInput, rack } from './builder-v3-fixture';
import { barbell, bodyweightStation, id } from './fixtures';

/** Review b3-rules-20oct: B1 (kg slot on lb items), B2 (added weight), S1–S4, S9. */

const lbBar = barbell({
  id: id(7790),
  unit: 'lb',
  barMass: 45,
  plates: [
    { mass: 45, count: 8 },
    { mass: 25, count: 2 },
    { mass: 10, count: 2 },
    { mass: 5, count: 2 },
    { mass: 2.5, count: 2 },
  ],
});

/** The working rows (warm-ups are the shared planner's: warmup-planner.test.ts). */
const work = <R extends { type: string }>(rows: readonly R[]): R[] => rows.filter((x) => x.type !== 'warmup');
const slotOf = (input: SetRowsInput): BuilderSlot => {
  const r = setRowsFor(input);
  return { key: 'k', exerciseId: 'x', main: input.main, repRange: input.repRange, rows: work(r.rows), unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm };
};
const acc = (load: Partial<SlotLoadInput>, over: Partial<SetRowsInput> = {}): SetRowsInput => ({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput(load), ...over });
const KG_PER_LB = 0.45359237;

describe('B1: a kg slot on lb equipment works in lb and says so', () => {
  it('20 kg per hand on lb dumbbells is 40 lb (44.1 lb rounded down), labelled lb', () => {
    const r = setRowsFor(acc({ unit: 'kg', convention: 'per_hand', equipment: lbRack, ruleTarget: { value: 20, reps: 8, rpe: 8 } }));
    expect(r.unit).toBe('lb');
    expect(work(r.rows).map((x) => x.load)).toEqual([40, 40, 40]);
  });

  it('45 kg per hand is 95 lb; 50 kg is capped at the rack max of 100 lb, never past it (rule 4)', () => {
    expect(work(setRowsFor(acc({ convention: 'per_hand', equipment: lbRack, ruleTarget: { value: 45, reps: 8, rpe: 8 } })).rows)[0]?.load).toBe(95);
    const big = setRowsFor(acc({ convention: 'per_hand', equipment: lbRack, ruleTarget: { value: 50, reps: 8, rpe: 8 } }));
    expect(work(big.rows).every((x) => x.load === 100)).toBe(true);
    expect(big.rows.filter((x) => x.type === 'warmup').every((x) => (x.load ?? 0) < 100)).toBe(true);
    expect(big.unit).toBe('lb');
  });

  it('a 100 kg bench target on an lb bar: top ≤ 220.5 lb, back-offs ≤ 95 kg in lb, warm-ups bar/40/60/80 % in lb (WU4)', () => {
    const r = setRowsFor({ main: true, role: 'compound', barbell: true, workingSets: 4, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: lbBar, ruleTarget: { value: 100, reps: 6, rpe: 8 } }) });
    expect(r.unit).toBe('lb');
    const top = r.rows.find((x) => x.type === 'top')?.load ?? 0;
    expect(top).toBeLessThanOrEqual(100 / KG_PER_LB);
    expect(top).toBeGreaterThanOrEqual(100 / KG_PER_LB - 5);
    const backoffs = r.rows.filter((x) => x.type === 'backoff').map((x) => x.load ?? 0);
    expect(backoffs).toHaveLength(3);
    for (const b of backoffs) {
      expect(b).toBeLessThanOrEqual(95 / KG_PER_LB + 1e-6);
      expect(b).toBeLessThan(top);
    }
    const warm = r.rows.filter((x) => x.type === 'warmup').map((x) => x.load ?? 0);
    expect(warm[0]).toBe(45);
    expect(warm).toHaveLength(4);
    // 220.46 → 220 lb; 95 kg = 209.4 → 205 lb; 40 / 60 / 80 % of 220 = 88, 132, 176 → 80, 130, 170 on these plates (down).
    expect(r.rows.map((x) => x.load)).toEqual([45, 80, 130, 170, 220, 205, 205, 205]);
    for (const [i, pct] of [0.4, 0.6, 0.8].entries()) expect(warm[i + 1]).toBeLessThanOrEqual(top * pct + 1e-6);
  });

  it('drops and a typed kg on lb dumbbells are worked out in lb too', () => {
    const load = loadInput({ convention: 'per_hand', equipment: lbRack, ruleTarget: { value: 20, reps: 8, rpe: 8 } });
    const s = slotOf(acc(load));
    const d = addDropSet(s, load);
    // 40 lb × 0.78 = 31.2 → 30 lb.
    expect(d.ok && d.slot.rows[d.slot.rows.length - 1]?.load).toBe(30);
    // Ben types 20 kg (his unit): 44.1 lb → 40 lb, `Why?` has both.
    const t = editSetRow(s, 0, { kind: 'load', value: 20, unit: 'kg' }, load);
    expect(t.ok && t.slot.rows[0]?.load).toBe(40);
    expect(t.ok && t.rounded).toMatchObject({ value: 40, unit: 'lb', rounded: true, capped: null });
    // A number typed without a unit is in the slot's unit (lb).
    const u = editSetRow(s, 0, { kind: 'load', value: 47 }, load);
    expect(u.ok && u.slot.rows[0]?.load).toBe(45);
  });

  it('a pain cap in kg is applied in lb (30 kg ≈ 66.1 lb → 65 lb)', () => {
    const r = setRowsFor(acc({ convention: 'per_hand', equipment: lbRack, ruleTarget: { value: 40, reps: 8, rpe: 8 }, painCap: 30 }));
    expect(work(r.rows).map((x) => x.load)).toEqual([65, 65, 65]);
    // Its warm-up is planned from the held top, never above it.
    expect(r.rows.filter((x) => x.type === 'warmup').every((x) => (x.load ?? 0) < 65)).toBe(true);
  });
});

describe('B2: weighted bodyweight (added) lifts keep their target', () => {
  const station = bodyweightStation();
  const base = { convention: 'added' as const, bodyweightExercise: true, ruleTarget: { value: 10, reps: 8, rpe: 8 } };

  it('BW+10 on a dip station with the gym dumbbells: 10, rule; its warm-up is bodyweight only × 4 (WU7: min(5, ⌈8/2⌉), no load: BW)', () => {
    const r = setRowsFor(acc({ ...base, equipment: station, gymEquipment: [rack] }, { role: 'compound' }));
    expect(r.rows.map((x) => x.load)).toEqual([null, 10, 10, 10]);
    expect(r.rows[0]).toEqual({ type: 'warmup', reps: 4, load: null, rpe: null });
    expect(r.source).toBe('rule');
    expect(r.convention).toBe('added');
  });

  it('BW+11 rounds down to what the gym can hang on: 10', () => {
    const r = setRowsFor(acc({ ...base, ruleTarget: { value: 11, reps: 8, rpe: 8 }, equipment: station, gymEquipment: [rack] }));
    expect(work(r.rows).map((x) => x.load)).toEqual([10, 10, 10]);
  });

  it('mapped straight to the dumbbells (convention added): still 10', () => {
    const r = setRowsFor(acc({ ...base, coachTarget: { value: 10, reps: 8, rpe: 8 }, equipment: rack }));
    expect(work(r.rows).map((x) => x.load)).toEqual([10, 10, 10]);
    expect(r.source).toBe('coach_target');
  });

  it('no item and no gym items: kept in the slot unit and convention (fitWithoutEquipment)', () => {
    const r = setRowsFor(acc({ ...base, equipment: null }));
    expect(work(r.rows).map((x) => x.load)).toEqual([10, 10, 10]);
    expect(r.unit).toBe('kg');
  });

  it('an equipped lift whose item is not here: no load and source none (not the rule)', () => {
    const r = setRowsFor(acc({ convention: 'stack', equipment: null, ruleTarget: { value: 30, reps: 8, rpe: 8 }, startLightCeiling: 20 }));
    expect(r.rows.every((x) => x.load === null)).toBe(true);
    expect(r.source).toBe('none');
    expect(r.startLight).toBe(20);
  });

  it('below the lightest stack plate: no load, source none', () => {
    const r = setRowsFor(acc({ convention: 'stack', equipment: cable, ruleTarget: { value: 3, reps: 8, rpe: 8 } }));
    expect(r.rows.every((x) => x.load === null)).toBe(true);
    expect(r.source).toBe('none');
  });
});

describe('S1: set count around a drop set', () => {
  const load = loadInput({ convention: 'stack', equipment: cable, ruleTarget: { value: 40, reps: 8, rpe: 8 } });
  const withDrop = (): BuilderSlot => {
    const d = addDropSet(slotOf(acc(load)), load);
    if (!d.ok) throw new Error('drop');
    return d.slot;
  };

  it('＋ Set copies the last working set (not the drop) and puts it before the drop', () => {
    const s = setWorkingCount(withDrop(), 5);
    expect(s.rows.map((x) => [x.type, x.reps, x.load])).toEqual([
      ['working', 8, 40],
      ['working', 8, 40],
      ['working', 8, 40],
      ['working', 8, 40],
      ['drop', 14, 30],
    ]);
    expect(s.rows.filter((x) => x.type === 'working').map((x) => x.rpe)).toEqual([8, 8, 8, 9]);
  });

  it('− Set removes the trailing drop first, so a drop never loses its set', () => {
    const s = setWorkingCount(withDrop(), 3);
    expect(s.rows.map((x) => x.type)).toEqual(['working', 'working', 'working']);
  });
});

describe('S2–S4: typed kg, pain, ranges', () => {
  const load = loadInput({ convention: 'stack', equipment: cable, ruleTarget: { value: 30, reps: 8, rpe: 8 }, painCap: 30 });

  it('S2: a typed kg above the pain hold stays, with mayHurt; computed loads say the pain hold capped them', () => {
    const s = slotOf(acc(load));
    const t = editSetRow(s, 0, { kind: 'load', value: 45 }, load);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.slot.rows[0]).toMatchObject({ load: 45, typed: true });
    expect(t.mayHurt).toBe(true);
    expect(t.rounded).toMatchObject({ value: 45, rounded: false, capped: null });
    const below = editSetRow(s, 0, { kind: 'load', value: 25 }, load);
    expect(below.ok && below.mayHurt).toBeUndefined();
  });

  it('S3: a typed kg below the lightest load is refused with the lightest, the row unchanged', () => {
    const s = slotOf(acc(load));
    expect(editSetRow(s, 0, { kind: 'load', value: 3 }, load)).toEqual({ ok: false, reason: 'lightest_is_harder', lightest: 5 });
    expect(editSetRow(s, 0, { kind: 'load', value: -5 }, load)).toEqual({ ok: false, reason: 'load_out_of_range' });
    expect(editSetRow(s, 0, { kind: 'load', value: Number.NaN }, load)).toEqual({ ok: false, reason: 'load_out_of_range' });
  });

  it('assisted: typed assistance past the machine max is refused (it would be harder), the max offered', () => {
    const a = loadInput({ convention: 'assistance', equipment: assist, ruleTarget: { value: 25, reps: 8, rpe: 8 } });
    const s = slotOf(acc(a, { role: 'compound' }));
    expect(editSetRow(s, 0, { kind: 'load', value: 50 }, a)).toEqual({ ok: false, reason: 'lightest_is_harder', lightest: 40 });
    const ok = editSetRow(s, 0, { kind: 'load', value: 27 }, a);
    expect(ok.ok && ok.slot.rows[0]?.load).toBe(30);
  });

  it('S4: RPE outside 1–10 or off 0.5 steps, and reps outside 1–100, are refused', () => {
    const s = slotOf(acc(loadInput({ convention: 'stack', equipment: cable, ruleTarget: { value: 40, reps: 8, rpe: 8 } })));
    const l = loadInput({ convention: 'stack', equipment: cable });
    expect(editSetRow(s, 0, { kind: 'rpe', rpe: 14 }, l)).toEqual({ ok: false, reason: 'rpe_out_of_range' });
    expect(editSetRow(s, 0, { kind: 'rpe', rpe: 0.5 }, l)).toEqual({ ok: false, reason: 'rpe_out_of_range' });
    expect(editSetRow(s, 0, { kind: 'rpe', rpe: 8.3 }, l)).toEqual({ ok: false, reason: 'rpe_out_of_range' });
    expect(editSetRow(s, 0, { kind: 'reps', reps: 0 }, l)).toEqual({ ok: false, reason: 'reps_out_of_range' });
    expect(editSetRow(s, 0, { kind: 'reps', reps: 101 }, l)).toEqual({ ok: false, reason: 'reps_out_of_range' });
    const fine = editSetRow(s, 0, { kind: 'rpe', rpe: 9.5 }, l);
    expect(fine.ok && (fine.slot.rows[0]?.load ?? 0) <= 40).toBe(true);
  });
});

describe('S9: the slot keeps Start light', () => {
  it('makeSlot carries the cap, the unit and the convention', () => {
    const ctx = context({ cable_fly: { e1rm: null, startLightCeiling: 20 } });
    const s = makeSlot('cable_fly', { main: false }, ctx);
    expect(s).toMatchObject({ source: 'none', startLight: 20, unit: 'kg', convention: 'stack' });
    expect(makeSlot('pushdown', { main: false }, ctx).startLight).toBeNull();
  });
});
