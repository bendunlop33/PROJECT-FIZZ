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
    const r = builderLoad(loadInput({ planFirstLoad: { value: 100, reps: 6, rpe: 8 } }), { reps: 8, rpe: 8 });
    expect(r.working).toBe(95);
  });

  it('the built-in rule’s load is the working load as is, never rescaled (review B3)', () => {
    // Hold after a miss on 8–12: the rule says 50 from 8 reps; the working sets are 50 whatever their reps.
    expect(builderLoad(loadInput({ ruleTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 6, rpe: 8 }).working).toBe(50);
    expect(builderLoad(loadInput({ ruleTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 10, rpe: 8 }).working).toBe(50);
    // Other sets derive at the rule's own reps: a back-off at more reps is lighter.
    const r = builderLoad(loadInput({ ruleTarget: { value: 100, reps: 4, rpe: 8 } }), { reps: 6, rpe: 8 });
    expect(r.working).toBe(100);
    expect(r.anchorE1rm).not.toBeNull();
    // A coach target still converts both ways (the coach chose it for its reps).
    expect(builderLoad(loadInput({ coachTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 6, rpe: 8 }).working).toBeGreaterThan(50);
    // (21 Oct) The one exception: a rule load marked `yieldsToHistory` that is clearly below Ben's recent
    // est. max gives way to it (builder-loads-history.test.ts). Unmarked (a miss, a reduction, pain), B3 stands.
    expect(builderLoad(loadInput({ e1rm: 126, ruleTarget: { value: 50, reps: 8, rpe: 8 } }), { reps: 6, rpe: 8 }).working).toBe(50);
    expect(builderLoad(loadInput({ e1rm: 126, ruleTarget: { value: 50, reps: 8, rpe: 8, yieldsToHistory: true } }), { reps: 6, rpe: 8 }).source).toBe('calc');
  });
});

describe('setRowsFor: main lift (§3.1, §3.3)', () => {
  it('bench 100 × 6 @ 8: warm-ups from the shared planner (WU4: bar × 5, 40 / 60 / 80 %), top set, back-offs 95 × 8 @ 8', () => {
    const r = setRowsFor(benchIn({ ruleTarget: { value: 100, reps: 6, rpe: 8 } }));
    expect(r.source).toBe('rule');
    expect(r.rows).toEqual([
      { type: 'warmup', reps: 5, load: 20, rpe: null },
      { type: 'warmup', reps: 5, load: 40, rpe: null },
      { type: 'warmup', reps: 3, load: 60, rpe: null },
      { type: 'warmup', reps: 2, load: 80, rpe: null },
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
    // WU4 from the 100 top: 40, 60, 80 (all loadable in 5 kg steps), after the bar.
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.load)).toEqual([20, 40, 60, 80]);
    const drop = addDropSet(slotOf(benchIn({ equipment: coarseBar, ruleTarget: { value: 100, reps: 6, rpe: 8 } })), loadInput({ equipment: coarseBar }));
    // 95 × 0.78 = 74.1 → 70 (5 kg steps).
    expect(drop.ok && drop.slot.rows[drop.slot.rows.length - 1]).toEqual({ type: 'drop', reps: 10, load: 70, rpe: 9 });
  });

  it('a light top: steps that land on the same load merge (WU8 b); nothing below the bar; no bar step under 3 × bar', () => {
    const r = setRowsFor(benchIn({ ruleTarget: { value: 30, reps: 6, rpe: 8 } }));
    // 30 < 3 × 20: no bar step. 40 % = 12 and 60 % = 18 → the bar (20), merged; 80 % = 24 → 22.5.
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => [x.load, x.reps])).toEqual([[20, 5], [22.5, 2]]);
  });

  it('a stack max of 100 never gives more than 100', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', e1rm: 300 }) });
    expect(r.rows.filter((x) => x.type !== 'warmup').every((x) => x.load === 100)).toBe(true);
    // WU7: one warm-up at 50 % × 8 of the capped top.
    expect(r.rows.filter((x) => x.type === 'warmup')).toEqual([{ type: 'warmup', reps: 8, load: 50, rpe: null }]);
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
  it('compound accessory (dumbbells: a secondary compound, WU6): R 8 → one warm-up at 80 % × 4, working sets at the bottom of the range, last @ RPE 9', () => {
    const r = setRowsFor({ main: false, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: rack, convention: 'per_hand', ruleTarget: { value: 30, reps: 8, rpe: 8 } }) });
    expect(r.rows).toEqual([
      { type: 'warmup', reps: 4, load: 22.5, rpe: null },
      { type: 'working', reps: 8, load: 30, rpe: 8 },
      { type: 'working', reps: 8, load: 30, rpe: 8 },
      { type: 'working', reps: 8, load: 30, rpe: 9 },
    ]);
  });

  it('isolation: one warm-up at 50 % × 8 (WU7)', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', e1rm: 41 }) });
    const top = r.rows.find((x) => x.type !== 'warmup')?.load ?? 0;
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.reps)).toEqual([8]);
    expect(r.rows.find((x) => x.type === 'warmup')?.load).toBeLessThanOrEqual(top / 2);
    expect(r.estimate).toBe(true);
  });

  it('lb dumbbells round down in lb, per hand', () => {
    const r = setRowsFor({ main: false, role: 'isolation', barbell: false, workingSets: 2, repRange: { min: 8, max: 12 }, load: loadInput({ unit: 'lb', equipment: lbRack, convention: 'per_hand', ruleTarget: { value: 47, reps: 8, rpe: 8 } }) });
    // 45 lb each; its WU7 warm-up, 22.5 → 20 lb (down on the rack).
    expect(r.rows.map((x) => x.load)).toEqual([20, 45, 45]);
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

  it('reps or RPE recalculates kg; a typed kg is kept exactly as typed (Ben, 27 Oct) and on later edits', () => {
    const more = editSetRow(bench(), 5, { kind: 'reps', reps: 10 }, load);
    // 126.67 / (1 + 12/30) = 90.48 → 90.
    expect(more.ok && more.slot.rows[5]?.load).toBe(90);
    const typed = editSetRow(bench(), 5, { kind: 'load', value: 101.3 }, load);
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(typed.slot.rows[5]).toMatchObject({ load: 101.3, typed: true });
    expect(typed.rounded).toMatchObject({ value: 101.3, rounded: false });
    const after = editSetRow(typed.slot, 5, { kind: 'rpe', rpe: 9 }, load);
    expect(after.ok && after.slot.rows[5]).toMatchObject({ load: 101.3, rpe: 9, typed: true });
  });

  it('set count: copies the last set (top → back-off), removes from the end but never the top set; last @ RPE 9', () => {
    const acc = slotOf({ main: false, role: 'isolation', barbell: false, workingSets: 3, repRange: { min: 8, max: 12 }, load: loadInput({ equipment: cable, convention: 'stack', ruleTarget: { value: 30, reps: 8, rpe: 8 } }) });
    const work = (sl: BuilderSlot) => sl.rows.filter((x) => x.type !== 'warmup');
    expect(work(setWorkingCount(acc, 4)).map((x) => x.rpe)).toEqual([8, 8, 8, 9]);
    expect(work(setWorkingCount(acc, 2)).map((x) => x.rpe)).toEqual([8, 9]);
    expect(work(setWorkingCount(acc, 0))).toHaveLength(1);
    const b = setWorkingCount(bench(), 1);
    expect(b.rows.filter((x) => x.type !== 'warmup').map((x) => x.type)).toEqual(['top']);
    expect(setWorkingCount(bench(), 5).rows.filter((x) => x.type === 'backoff')).toHaveLength(4);
  });

  it('bar warm-up only on a bar-loaded item', () => {
    const r = setRowsFor(benchIn({ equipment: rack, convention: 'per_hand', ruleTarget: { value: 30, reps: 6, rpe: 8 } }));
    // A dumbbell main lift: WU4 without the bar, 40 / 60 / 80 % of 30 → 10, 17.5, 22.5 each.
    expect(r.rows.filter((x) => x.type === 'warmup').map((x) => x.load)).toEqual([10, 17.5, 22.5]);
    expect(bar.kind).toBe('barbell');
  });
});
