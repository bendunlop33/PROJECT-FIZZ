import { describe, expect, it } from 'vitest';
import {
  BACKOFF_BANDS,
  backoffLoad,
  changeSetType,
  editSetRow,
  lowerWithTop,
  mainFocusOf,
  reloadSlotLoads,
  setRowsFor,
  setWorkingCount,
  type BuilderSlot,
  type MainFocus,
  type SetRowsInput,
  type SlotLoadInput,
} from '../src/index';
import { assist, bar, cable, lbRack, loadInput, rack } from './builder-v3-fixture';
import { dumbbells, id } from './fixtures';

/**
 * D4 (Ben, 22–23 Oct; set-structures SS4, HT8): back-offs from their reps and effort, snapped down to what the gym
 * can load, inside the focus's band below the top (Strength 2–8 %, Balanced 4–10 %, Muscle 8–15 %), never above the
 * top; when today's top is lowered they drop by the same %.
 */

const benchIn = (load: Partial<SlotLoadInput>, over: Partial<SetRowsInput> = {}): SetRowsInput => ({
  main: true,
  role: 'compound',
  barbell: true,
  workingSets: 3,
  repRange: { min: 6, max: 8 },
  load: loadInput(load),
  ...over,
});

const slotOf = (input: SetRowsInput): BuilderSlot => {
  const r = setRowsFor(input);
  return { key: 'k', exerciseId: 'x', main: input.main, repRange: input.repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm };
};

const work = (rows: BuilderSlot['rows']) => rows.filter((r) => r.type !== 'warmup');
const top = (rows: BuilderSlot['rows']) => rows.find((r) => r.type === 'top')?.load ?? null;
const backoffs = (rows: BuilderSlot['rows']) => rows.filter((r) => r.type === 'backoff').map((r) => r.load);
const rule100 = { ruleTarget: { value: 100, reps: 6, rpe: 8 } };

describe('D4: the band by focus', () => {
  it('goal → focus: strength → Strength, muscle → Muscle, both or not set → Balanced', () => {
    expect(mainFocusOf('strength')).toBe('strength');
    expect(mainFocusOf('muscle')).toBe('muscle');
    expect(mainFocusOf('both')).toBe('balanced');
    expect(mainFocusOf(null)).toBe('balanced');
    expect(mainFocusOf(undefined)).toBe('balanced');
    expect(BACKOFF_BANDS).toEqual({ strength: { min: 0.02, max: 0.08 }, balanced: { min: 0.04, max: 0.1 }, muscle: { min: 0.08, max: 0.15 }, fitness: { min: 0.02, max: 0.15 } });
  });

  it('from reps and RPE (Epley, RIR = 10 − RPE): 100 × 6 @ 8 → 8 @ 8 = 95, inside Balanced and Strength; Muscle holds it 8 % below', () => {
    const e1rm = 100 * (1 + 8 / 30);
    expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 8, rpe: 8, top: 100, focus: 'balanced' })).toBe(95);
    expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 8, rpe: 8, top: 100, focus: 'strength' })).toBe(95);
    expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 8, rpe: 8, top: 100, focus: 'muscle' })).toBe(92);
    // (Review B3) An easy back-off (12 @ 6) is ~17 % below: it keeps what its reps and RPE give (126.7 ÷ 1.533 =
    // 82.6), never moved up to the band's lower edge (92 would be about RPE 10 for 12 reps).
    expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 12, rpe: 6, top: 100, focus: 'strength' })).toBe(82.609);
    expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 12, rpe: 6, top: 100, focus: 'muscle' })).toBe(82.609);
    // A back-off as hard as the top (6 @ 8) or harder (3 @ 9) is never at or above it.
    for (const focus of ['strength', 'balanced', 'muscle'] as MainFocus[]) {
      const b = BACKOFF_BANDS[focus];
      expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 6, rpe: 8, top: 100, focus })).toBeCloseTo(100 * (1 - b.min), 6);
      expect(backoffLoad({ anchorE1rm: e1rm, working: 100, reps: 3, rpe: 9, top: 100, focus })).toBeLessThan(100);
    }
  });

  it('no formula (assisted, added weight): the working kg, as before; no top: the formula as is', () => {
    expect(backoffLoad({ anchorE1rm: null, working: 25, reps: 8, rpe: 8, top: 25, focus: 'muscle' })).toBe(25);
    expect(backoffLoad({ anchorE1rm: 100 * (1 + 8 / 30), working: 100, reps: 8, rpe: 8, top: null, focus: 'muscle' })).toBe(95);
  });

  it('lowerWithTop: the same % lower; raising or an unknown top leaves it', () => {
    expect(lowerWithTop(95, 100, 90)).toBe(85.5);
    expect(lowerWithTop(95, 100, 105)).toBe(95);
    expect(lowerWithTop(95, null, 90)).toBe(95);
    expect(lowerWithTop(null, 100, 90)).toBeNull();
  });
});

describe('D4: the builder’s rows (setRowsFor)', () => {
  it('Balanced (no goal): top 100 × 6, back-offs 95 × 8 (unchanged from the formula)', () => {
    const rows = setRowsFor(benchIn(rule100)).rows;
    expect(top(rows)).toBe(100);
    expect(backoffs(rows)).toEqual([95, 95]);
  });

  it('Muscle: back-offs 8–15 % below the top, rounded down on the plates (92 → 90)', () => {
    const rows = setRowsFor(benchIn({ ...rule100, mainFocus: 'muscle' })).rows;
    expect(top(rows)).toBe(100);
    expect(backoffs(rows)).toEqual([90, 90]);
  });

  it('Strength: the formula’s 95 is inside 2–8 %', () => {
    expect(backoffs(setRowsFor(benchIn({ ...rule100, mainFocus: 'strength' })).rows)).toEqual([95, 95]);
  });

  it('every back-off is below the top and within its band (before rounding down) across loads, foci and plates', () => {
    for (const focus of ['strength', 'balanced', 'muscle'] as MainFocus[]) {
      for (const v of [40, 61.25, 82.5, 100, 137.5, 160]) {
        const rows = setRowsFor(benchIn({ ruleTarget: { value: v, reps: 6, rpe: 8 }, mainFocus: focus })).rows;
        const t = top(rows) ?? 0;
        for (const b of backoffs(rows)) {
          expect(b).not.toBeNull();
          expect(b ?? Infinity).toBeLessThan(t);
          expect(b ?? 0).toBeLessThanOrEqual(t * (1 - BACKOFF_BANDS[focus].min) + 1e-9);
          // Rounded down at most one bar step (2.5 kg) below the band's floor.
          expect(b ?? 0).toBeGreaterThan(t * (1 - BACKOFF_BANDS[focus].max) - 2.5 - 1e-9);
        }
      }
    }
  });

  it('per-hand dumbbells: 30 kg each × 6 @ 8 → back-offs 27.5 each (2.5 kg rack steps), never 30', () => {
    const rows = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: rack, convention: 'per_hand', ruleTarget: { value: 30, reps: 6, rpe: 8 } }) }).rows;
    expect(top(rows)).toBe(30);
    // 30 × 0.95 = 28.5 → 27.5 on the rack.
    expect(backoffs(rows)).toEqual([27.5, 27.5]);
  });

  it('PM, 23 Oct: coarse dumbbells (2 kg steps 20–30) with nothing inside the band: the nearest lighter achievable load, never the top', () => {
    const coarse = dumbbells({ id: id(7790), loads: [20, 22, 24, 26, 28, 30] });
    for (const focus of ['strength', 'balanced', 'muscle'] as const) {
      for (const t of [22, 24, 26, 28, 30]) {
        const rows = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: coarse, convention: 'per_hand', ruleTarget: { value: t, reps: 6, rpe: 8 }, mainFocus: focus }) }).rows;
        expect(top(rows)).toBe(t);
        // Strength 24 → 2–8 % is 22.08–23.52: no 2 kg step inside, so the next one down (22), never 24.
        for (const b of backoffs(rows)) {
          expect(b).not.toBeNull();
          expect(b ?? Infinity).toBeLessThan(t);
          expect([20, 22, 24, 26, 28]).toContain(b);
        }
      }
    }
    const strength24 = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: coarse, convention: 'per_hand', ruleTarget: { value: 24, reps: 6, rpe: 8 }, mainFocus: 'strength' }) }).rows;
    expect(backoffs(strength24)).toEqual([22, 22]);
  });

  it('PM, 23 Oct: goal both or not set maps to the Balanced band', () => {
    expect(mainFocusOf('both')).toBe('balanced');
    expect(mainFocusOf(null)).toBe('balanced');
    expect(mainFocusOf(undefined)).toBe('balanced');
    expect(mainFocusOf('strength')).toBe('strength');
    expect(mainFocusOf('muscle')).toBe('muscle');
  });

  it('lb: a kg target on an lb rack is worked out in lb, back-offs below the top in lb', () => {
    const r = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: lbRack, convention: 'per_hand', ruleTarget: { value: 30, reps: 6, rpe: 8 }, mainFocus: 'muscle' }) });
    expect(r.unit).toBe('lb');
    const t = top(r.rows) ?? 0;
    for (const b of backoffs(r.rows)) {
      expect(b ?? Infinity).toBeLessThanOrEqual(t * 0.92 + 1e-9);
      expect((b ?? 0) % 5).toBe(0);
    }
  });

  it('a stack’s max: a top capped at 100 keeps its back-offs below it, never extrapolated past the max', () => {
    const rows = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: cable, convention: 'stack', ruleTarget: { value: 130, reps: 6, rpe: 8 } }) }).rows;
    expect(top(rows)).toBe(100);
    for (const b of backoffs(rows)) expect(b ?? Infinity).toBeLessThan(100);
  });

  it('assisted: no formula, the back-offs keep the working assistance', () => {
    const rows = setRowsFor({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: assist, convention: 'assistance', ruleTarget: { value: 20, reps: 6, rpe: 8 } }) }).rows;
    expect(work(rows).map((r) => r.load)).toEqual([20, 20, 20]);
  });

  it('a pain hold lowers the top (100 → 90): the back-offs drop by the same % (95 → 85.5 → 85), never equal to the top', () => {
    const rows = setRowsFor(benchIn({ ...rule100, painCap: 90 })).rows;
    expect(top(rows)).toBe(90);
    expect(backoffs(rows)).toEqual([85, 85]);
  });
});

describe('D4: when today’s top is lowered in Your workout (editSetRow)', () => {
  const load = loadInput(rule100);
  const base = () => slotOf(benchIn(rule100));
  const topIndex = (s: BuilderSlot) => s.rows.findIndex((r) => r.type === 'top');

  it('Ben types a lighter top (100 → 90): back-offs drop 10 % (95 → 85.5 → 85)', () => {
    const r = editSetRow(base(), topIndex(base()), { kind: 'load', value: 90 }, load);
    if (!r.ok) throw new Error(r.reason);
    expect(top(r.slot.rows)).toBe(90);
    expect(backoffs(r.slot.rows)).toEqual([85, 85]);
  });

  it('a saved workout’s own back-offs (no formula anchor) drop the same way: top 100 → 80, back-offs 90 → 72 → 70 (rounded down)', () => {
    const saved: BuilderSlot = { ...base(), source: 'saved', anchorE1rm: null, rows: [{ type: 'top', reps: 5, load: 100, rpe: 8 }, { type: 'backoff', reps: 5, load: 90, rpe: 8 }, { type: 'backoff', reps: 5, load: 90, rpe: 8 }, { type: 'drop', reps: 10, load: 70, rpe: 9 }] };
    const r = editSetRow(saved, 0, { kind: 'load', value: 80 }, load);
    if (!r.ok) throw new Error(r.reason);
    // Never rounded up to 72.5; the drop after the last back-off follows it (70 × 0.78 = 54.6 → 52.5).
    expect(work(r.slot.rows).map((x) => [x.type, x.load])).toEqual([
      ['top', 80],
      ['backoff', 70],
      ['backoff', 70],
      ['drop', 52.5],
    ]);
  });

  it('assisted: a top’s assistance changed leaves the back-offs (no formula, another direction)', () => {
    const a = slotOf({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ equipment: assist, convention: 'assistance', ruleTarget: { value: 20, reps: 6, rpe: 8 } }) });
    const ti = a.rows.findIndex((x) => x.type === 'top');
    const r = editSetRow(a, ti, { kind: 'load', value: 10 }, loadInput({ equipment: assist, convention: 'assistance' }));
    if (!r.ok) throw new Error(r.reason);
    expect(backoffs(r.slot.rows)).toEqual([20, 20]);
  });

  it('raising the top never raises the back-offs', () => {
    const r = editSetRow(base(), topIndex(base()), { kind: 'load', value: 110 }, load);
    if (!r.ok) throw new Error(r.reason);
    expect(top(r.slot.rows)).toBe(110);
    expect(backoffs(r.slot.rows)).toEqual([95, 95]);
  });

  it('a back-off Ben typed keeps his kg', () => {
    const s0 = base();
    const bi = s0.rows.findIndex((r) => r.type === 'backoff');
    const typed = editSetRow(s0, bi, { kind: 'load', value: 92.5 }, load);
    if (!typed.ok) throw new Error(typed.reason);
    const r = editSetRow(typed.slot, topIndex(typed.slot), { kind: 'load', value: 90 }, load);
    if (!r.ok) throw new Error(r.reason);
    expect(backoffs(r.slot.rows)).toEqual([92.5, 85]);
  });

  it('a lb typed top on a kg bar: compared in the slot’s unit (198.4 lb ≈ 90 kg)', () => {
    const r = editSetRow(base(), topIndex(base()), { kind: 'load', value: 198.416, unit: 'lb' }, load);
    if (!r.ok) throw new Error(r.reason);
    expect(top(r.slot.rows)).toBe(90);
    expect(backoffs(r.slot.rows)).toEqual([85, 85]);
  });

  it('a back-off’s reps or RPE edit works its load out again inside the band below the current top', () => {
    const s0 = slotOf(benchIn({ ...rule100, mainFocus: 'strength' }));
    const bi = s0.rows.findIndex((r) => r.type === 'backoff');
    // 6 @ 8 is as hard as the top: held 2 % below it (98 → 97.5), never 100.
    const harder = editSetRow(s0, bi, { kind: 'reps', reps: 6 }, loadInput({ ...rule100, mainFocus: 'strength' }));
    if (!harder.ok) throw new Error(harder.reason);
    expect(harder.slot.rows[bi]?.load).toBe(97.5);
    // 12 @ 6 is far easier: what its reps and RPE give (82.6 → 82.5), not the band's lower edge (review B3).
    const r1 = editSetRow(s0, bi, { kind: 'reps', reps: 12 }, loadInput({ ...rule100, mainFocus: 'strength' }));
    if (!r1.ok) throw new Error(r1.reason);
    const easier = editSetRow(r1.slot, bi, { kind: 'rpe', rpe: 6 }, loadInput({ ...rule100, mainFocus: 'strength' }));
    if (!easier.ok) throw new Error(easier.reason);
    expect(easier.slot.rows[bi]?.load).toBe(82.5);
  });

  it('a set retyped as Back-off is worked out by the rule, below the top', () => {
    const s0 = slotOf(benchIn(rule100, { workingSets: 1 }));
    const added = setWorkingCount(s0, 2, load);
    expect(work(added.rows).map((r) => [r.type, r.load])).toEqual([
      ['top', 100],
      // A top copied as a back-off: 6 @ 8 is as hard as the top → 4 % below (96 → 95), not 100.
      ['backoff', 95],
    ]);
    const plain = { ...s0, rows: s0.rows.map((r) => (r.type === 'top' ? { ...r, type: 'working' as const } : r)) };
    const two = setWorkingCount(plain, 2);
    const wi = two.rows.findIndex((r, i) => r.type === 'working' && i > two.rows.findIndex((x) => x.type === 'working'));
    const t = changeSetType(two, wi, 'top', load);
    if (!t.ok) throw new Error(t.reason);
    const bi = t.slot.rows.findIndex((r) => r.type === 'working');
    const b = changeSetType(t.slot, bi, 'backoff', load);
    if (!b.ok) throw new Error(b.reason);
    for (const x of backoffs(b.slot.rows)) expect(x ?? Infinity).toBeLessThan(top(b.slot.rows) ?? 0);
  });

  it('Gym changed: a top Ben typed lighter is kept and the back-offs are worked out again the same % lower', () => {
    const s0 = base();
    const r = editSetRow(s0, topIndex(s0), { kind: 'load', value: 90 }, load);
    if (!r.ok) throw new Error(r.reason);
    const moved = reloadSlotLoads(r.slot, { role: 'compound', barbell: true }, loadInput({ ...rule100, equipment: bar }));
    expect(top(moved.rows)).toBe(90);
    expect(backoffs(moved.rows)).toEqual([85, 85]);
  });
});
