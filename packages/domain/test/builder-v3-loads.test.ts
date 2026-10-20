import { describe, expect, it } from 'vitest';
import { addDropSet, builderLoad, changeSetType, editSetRow, roundDownHere, setRowsFor, setWorkingCount, type BuilderSlot, type SetRowsInput, type SlotLoadInput } from '../src/index';
import { assist, bar, cable, coarseBar, lbRack, loadInput, rack } from './builder-v3-fixture';

const benchIn = (load: Partial<SlotLoadInput>, over: Partial<SetRowsInput> = {}): SetRowsInput => ({
  main: true,
  role: 'compound',
  barbell: true,
  workingSets: 4,
  repRange: { min: 6, max: 8 },
  load: loadInput(load),
  ...over,
});

const slotOf = (input: SetRowsInput): BuilderSlot => {
  const r = setRowsFor(input);
  return { key: 'k', exerciseId: 'x', main: input.main, repRange: input.repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm };
};

describe('builderLoad: source order (§9 Q12)', () => {
  const anchor = (value: number) => ({ value, reps: 6, rpe: 8 });

  it('a coach target of 102.5 is the top set whatever the est. max says', () => {
    const r = builderLoad(loadInput({ coachTarget: anchor(102.5), planFirstLoad: anchor(90), ruleTarget: anchor(95), e1rm: 200 }), { reps: 6, rpe: 8 });
    expect(r).toMatchObject({ source: 'coach_target', working: 102.5, estimate: false });
    const rows = setRowsFor(benchIn({ coachTarget: anchor(102.5), e1rm: 200 })).rows;
    expect(rows.find((x) => x.type === 'top')?.load).toBe(102.5);
  });

  it('then the plan first-week load, then the built-in rule (labelled), then est. max (estimate)', () => {
    expect(builderLoad(loadInput({ planFirstLoad: anchor(90), ruleTarget: anchor(95), e1rm: 200 }), { reps: 6, rpe: 8 })).toMatchObject({ source: 'plan', working: 90 });
    expect(builderLoad(loadInput({ ruleTarget: anchor(95), e1rm: 200 }), { reps: 6, rpe: 8 })).toMatchObject({ source: 'rule', working: 95, estimate: false });
    const calc = builderLoad(loadInput({ e1rm: 126 }), { reps: 6, rpe: 8 });
    expect(calc.source).toBe('calc');
    expect(calc.estimate).toBe(true);
    expect(calc.working).toBeCloseTo(126 / (1 + 8 / 30), 2);
  });

  it('none: no load and the Start light ceiling', () => {
    expect(builderLoad(loadInput({ startLightCeiling: 40 }), { reps: 8, rpe: 8 })).toEqual({ unit: 'kg', convention: 'total', source: 'none', working: null, anchorE1rm: null, estimate: false, startLight: 40 });
  });

  it('a target for other reps converts by Epley with RIR = 10 − RPE', () => {
    const r = builderLoad(loadInput({ ruleTarget: { value: 100, reps: 6, rpe: 8 } }), { reps: 8, rpe: 8 });
    expect(r.working).toBe(95);
  });

  it('the built-in rule is never scaled up: fewer reps than its prescription keep its load (review B3)', () => {
    // Hold after a miss on 8–12: the rule says 50 at 8; a set asked at 6 reps is still 50, not more.
    expect(builderLoad(loadInput({ ruleTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 6, rpe: 8 }).working).toBe(50);
    expect(builderLoad(loadInput({ ruleTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 8, rpe: 8 }).working).toBe(50);
    // A coach target still converts both ways (the coach chose it for its reps).
    expect(builderLoad(loadInput({ coachTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 6, rpe: 8 }).working).toBeGreaterThan(50);
  });
});

describe('setRowsFor: main lift (§3.1, §3.3)', () => {
  it('bench 100 × 6 @ 8: warm-ups bar/50/70/85 %, top set, back-offs 95 × 8 @ 8', () => {
    const r = setRowsFor(benchIn({ ruleTarget: { value: 100, reps: 6, rpe: 8 } }));
    expect(r.source).toBe('rule');
    expect(r.rows).toEqual([
      { type: 'warmup', reps: 10, load: 20, rpe: null },
      { type: 'warmup', reps: 5, load: 50, rpe: null },
      { type: 'warmup', reps: 3, load: 70, rpe: null },
      { type: 'warmup', reps: 1, load: 85, rpe: null },
      { type: 'top', reps: 6, load: 100, rpe: 8 },
      { type: 'backoff', reps: 8, load: 95, rpe: 8 },
      { type: 'backoff', reps: 8, load: 95, rpe: 8 },
      { type: 'backoff', reps: 8, load: 95, rpe: 8 },
    ]);
  });

  it('rounds down at a gym whose smallest pair is 2.5 kg: 95.25 → 95, warm-ups and drops down too', () => {
    expect(roundDownHere(95.25, { unit: 'kg', convention: 'total', equipment: coarseBar })?.value).toBe(95);
    expect(roundDownHere(99.9, { unit: 'kg', convention: 'total', equipment: coarseBar })?.value).toBe(95);
    const r = setRowsFor(benchIn({ equipment: coarseBar, coachTarget: { value: 102.5, reps: 6, rpe: 8 } }));
    // 102.5 isn't loadable here: down to 100, never up to 105.
    expect(r.rows.find((x) => x.type === 'top')?.load).toBe(100);
    // 51.25 → 50, 71.75 → 70, 87.125 → 85.
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.load)).toEqual([20, 50, 70, 85]);
    const drop = addDropSet(slotOf(benchIn({ equipment: coarseBar, ruleTarget: { value: 100, reps: 6, rpe: 8 } })), loadInput({ equipment: coarseBar }));
    // 95 × 0.78 = 74.1 → 70 (5 kg steps).
    expect(drop.ok && drop.slot.rows[drop.slot.rows.length - 1]).toEqual({ type: 'drop', reps: 10, load: 70, rpe: 9 });
  });

  it('skips a warm-up step no heavier than the one before; max 4', () => {
    const r = setRowsFor(benchIn({ ruleTarget: { value: 30, reps: 6, rpe: 8 } }));
    // bar 20, 50 % = 15 (≤ 20, skipped), 70 % = 21 → 20 (skipped), 85 % = 25.5 → 25.
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.load)).toEqual([20, 25]);
  });

  it('a stack max of 100 never gives more than 100', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', e1rm: 300 }) });
    expect(r.rows.every((x) => x.load === 100)).toBe(true);
    expect(roundDownHere(120, { unit: 'kg', convention: 'stack', equipment: cable })).toMatchObject({ value: 100, bounded: 'max' });
  });

  it('below the lightest loadable weight is no load, never rounded up', () => {
    expect(roundDownHere(3, { unit: 'kg', convention: 'stack', equipment: cable })).toBeNull();
  });

  it('pain hold: never heavier than the last comparable working load (rule 9)', () => {
    const r = setRowsFor(benchIn({ ruleTarget: { value: 100, reps: 6, rpe: 8 }, painCap: 90 }));
    expect(r.rows.filter((x) => x.type !== 'warmup').every((x) => (x.load ?? 0) <= 90)).toBe(true);
    expect(r.rows.find((x) => x.type === 'top')?.load).toBe(90);
  });
});

describe('setRowsFor: accessories, per-hand, lb, assisted', () => {
  it('compound accessory: one warm-up at 60 % × 8, working sets at the bottom of the range, last @ RPE 9', () => {
    const r = setRowsFor({ main: false, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: rack, convention: 'per_hand', ruleTarget: { value: 30, reps: 8, rpe: 8 } }) });
    expect(r.rows).toEqual([
      { type: 'warmup', reps: 8, load: 17.5, rpe: null },
      { type: 'working', reps: 8, load: 30, rpe: 8 },
      { type: 'working', reps: 8, load: 30, rpe: 8 },
      { type: 'working', reps: 8, load: 30, rpe: 9 },
    ]);
  });

  it('isolation: no warm-ups', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', e1rm: 41 }) });
    expect(r.rows.some((x) => x.type === 'warmup')).toBe(false);
    expect(r.estimate).toBe(true);
  });

  it('lb dumbbells round down in lb, per hand', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 2, repRange: { min: 8, max: 12 }, load: loadInput({ unit: 'lb', equipment: lbRack, convention: 'per_hand', ruleTarget: { value: 47, reps: 8, rpe: 8 } }) });
    expect(r.rows.map((x) => x.load)).toEqual([45, 45]);
  });

  it('assisted: keeps its kg (no formula, no warm-ups); more assistance is the easier way to round', () => {
    const load = loadInput({ equipment: assist, convention: 'assistance', ruleTarget: { value: 25, reps: 8, rpe: 8 }, e1rm: 999 });
    const input: SetRowsInput = { main: false, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load };
    const r = setRowsFor(input);
    expect(r.rows).toEqual([
      { type: 'working', reps: 8, load: 25, rpe: 8 },
      { type: 'working', reps: 8, load: 25, rpe: 8 },
      { type: 'working', reps: 8, load: 25, rpe: 9 },
    ]);
    expect(roundDownHere(27, { unit: 'kg', convention: 'assistance', equipment: assist })?.value).toBe(30);
    // More assistance than the machine has would be harder: no load.
    expect(roundDownHere(50, { unit: 'kg', convention: 'assistance', equipment: assist })).toBeNull();
    const edit = editSetRow(slotOf(input), 0, { kind: 'reps', reps: 12 }, load);
    expect(edit.ok && edit.slot.rows[0]).toEqual({ type: 'working', reps: 12, load: 25, rpe: 8 });
  });

  it('bodyweight with no item: no load (`—`)', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: null, convention: 'bodyweight' }) });
    expect(r.rows.every((x) => x.load === null)).toBe(true);
  });
});

describe('set edits (§2.4)', () => {
  const load = loadInput({ ruleTarget: { value: 100, reps: 6, rpe: 8 } });
  const bench = () => slotOf(benchIn({ ruleTarget: { value: 100, reps: 6, rpe: 8 } }));

  it('one Top set: choosing Top set on a back-off turns the old one into a back-off; both recalculated', () => {
    const r = changeSetType(bench(), 6, 'top', load);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const work = r.slot.rows.filter((x) => x.type !== 'warmup');
    expect(work.filter((x) => x.type === 'top')).toHaveLength(1);
    expect(work.map((x) => [x.type, x.reps, x.load])).toEqual([
      ['backoff', 8, 95],
      ['backoff', 8, 95],
      ['top', 6, 100],
      ['backoff', 8, 95],
    ]);
  });

  it('a type change recalculates that set (back-off → working = bottom of range @ 8)', () => {
    const r = changeSetType(bench(), 5, 'working', load);
    expect(r.ok && r.slot.rows[5]).toEqual({ type: 'working', reps: 6, load: 100, rpe: 8 });
  });

  it('keeps at least one working set; a drop needs a set before it; max 3 drops', () => {
    const one = slotOf({ ...benchIn({ ruleTarget: { value: 100, reps: 6, rpe: 8 } }), workingSets: 1 });
    expect(changeSetType(one, one.rows.length - 1, 'warmup', load)).toEqual({ ok: false, reason: 'keep_one_set' });
    expect(changeSetType(bench(), 4, 'drop', load)).toEqual({ ok: false, reason: 'drop_needs_set_before' });
    let s = bench();
    for (let i = 0; i < 3; i += 1) {
      const d = addDropSet(s, load);
      expect(d.ok).toBe(true);
      if (d.ok) s = d.slot;
    }
    expect(addDropSet(s, load)).toEqual({ ok: false, reason: 'max_drops' });
  });

  it('reps or RPE recalculates kg; a typed kg rounds down, is kept on later edits, and says it moved', () => {
    const more = editSetRow(bench(), 5, { kind: 'reps', reps: 10 }, load);
    // 126.67 / (1 + 12/30) = 90.48 → 90.
    expect(more.ok && more.slot.rows[5]?.load).toBe(90);
    const typed = editSetRow(bench(), 5, { kind: 'load', value: 101.3 }, load);
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(typed.slot.rows[5]).toMatchObject({ load: 100, typed: true });
    expect(typed.rounded).toMatchObject({ value: 100, rounded: true });
    const after = editSetRow(typed.slot, 5, { kind: 'rpe', rpe: 9 }, load);
    expect(after.ok && after.slot.rows[5]).toMatchObject({ load: 100, rpe: 9, typed: true });
  });

  it('set count: copies the last set (top → back-off), removes from the end but never the top set; last @ RPE 9', () => {
    const acc = slotOf({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', ruleTarget: { value: 30, reps: 8, rpe: 8 } }) });
    expect(setWorkingCount(acc, 4).rows.map((x) => x.rpe)).toEqual([8, 8, 8, 9]);
    expect(setWorkingCount(acc, 2).rows.map((x) => x.rpe)).toEqual([8, 9]);
    expect(setWorkingCount(acc, 0).rows).toHaveLength(1);
    const b = setWorkingCount(bench(), 1);
    expect(b.rows.filter((x) => x.type !== 'warmup').map((x) => x.type)).toEqual(['top']);
    expect(setWorkingCount(bench(), 5).rows.filter((x) => x.type === 'backoff')).toHaveLength(4);
  });

  it('bar warm-up only on a bar-loaded item', () => {
    const r = setRowsFor(benchIn({ equipment: rack, convention: 'per_hand', ruleTarget: { value: 30, reps: 6, rpe: 8 } }));
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.load)).toEqual([15, 20, 25]);
    expect(bar.kind).toBe('barbell');
  });
});
