import { describe, expect, it } from 'vitest';
import type { CoachTarget, Load } from '@fizz/schemas';

import { doneLine, fromToLine, NBSP, topBackoffLine, type ChangeSide } from '../src';

/** (Ben, 30 Oct) One `Next time` change per line: from → to, units and conventions explicit. */

const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const lb = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'lb', convention });
const t = (load: Load | null, min: number | null, max = min, rpe?: number): CoachTarget => ({ load, reps: min === null || max === null ? null : { min, max }, ...(rpe !== undefined ? { rpe } : {}) });
const plain = (x: string | undefined) => (x ?? '').replaceAll(NBSP, ' ');
const side = (target: CoachTarget, sets: number | null = 3, plates?: true): ChangeSide => ({ target, sets, ...(plates ? { plates } : {}) });

describe('fromToLine', () => {
  it('load only: `100 → 102.5 kg`, spoken in kilograms', () => {
    const l = fromToLine(side(t(kg(100), 5)), side(t(kg(102.5), 5)));
    expect(l).toEqual({ text: '100 → 102.5 kg', spoken: '100 to 102.5 kilograms', same: false });
  });

  it('lb stays lb', () => {
    expect(fromToLine(side(t(lb(225), 5)), side(t(lb(230), 5))).text).toBe('225 → 230 lb');
  });

  it('per-hand dumbbells say `ea`', () => {
    const l = fromToLine(side(t(kg(24, 'per_hand'), 10)), side(t(kg(26, 'per_hand'), 10)));
    expect(l.text).toBe('24 → 26 kg ea');
    expect(l.spoken).toBe('24 to 26 kilograms each');
  });

  it('reps only: sets × reps on both sides', () => {
    const l = fromToLine(side(t(kg(59, 'stack'), 10)), side(t(kg(59, 'stack'), 12)));
    expect(l.text).toBe('3×10 → 3×12');
    expect(l.spoken).toBe('3 sets of 10 to 3 sets of 12');
  });

  it('reps only with no set count: `8 → 10 reps`', () => {
    expect(fromToLine(side(t(kg(59), 8), null), side(t(kg(59), 10), null)).text).toBe('8 → 10 reps');
  });

  it('rep ranges keep their dash; the spoken arrow pauses first', () => {
    const l = fromToLine(side(t(kg(80), 6, 8)), side(t(kg(80), 8, 10)));
    expect(l.text).toBe('3×6–8 → 3×8–10');
    expect(l.spoken).toBe('3 sets of 6 to 8, to 3 sets of 8 to 10');
  });

  it('load and reps together: `100×5 → 102.5×6 kg`', () => {
    expect(fromToLine(side(t(kg(100), 5)), side(t(kg(102.5), 6))).text).toBe('100×5 → 102.5×6 kg');
  });

  it('sets only: `3 → 4 sets`', () => {
    expect(fromToLine(side(t(kg(100), 5), 3), side(t(kg(100), 5), 4))).toEqual({ text: '3 → 4 sets', spoken: '3 to 4 sets', same: false });
  });

  it('sets beside a load change: the new count after a dot', () => {
    expect(fromToLine(side(t(kg(100), 5), 3), side(t(kg(102.5), 5), 4)).text).toBe('100 → 102.5 kg · 4 sets');
  });

  it('assisted machines: `kg assist`, less assistance is the lower number', () => {
    const l = fromToLine(side(t(kg(30, 'assistance'), 8)), side(t(kg(25, 'assistance'), 8)));
    expect(l.text).toBe('30 → 25 kg assist');
    expect(l.spoken).toBe('30 to 25 kilograms of assistance');
  });

  it('added load reads `+`; plates on a plate-loaded machine don’t', () => {
    expect(fromToLine(side(t(kg(10, 'added'), 8)), side(t(kg(12.5, 'added'), 8))).text).toBe('+10 → +12.5 kg');
    expect(fromToLine(side(t(kg(100, 'added'), 8), 3, true), side(t(kg(110, 'added'), 8), 3, true)).text).toBe('100 → 110 kg');
  });

  it('bodyweight reps', () => {
    expect(fromToLine(side(t(null, 12)), side(t(null, 15))).text).toBe('3×12 → 3×15');
  });

  it('kg → lb (or any convention change) spells both sides in full', () => {
    expect(fromToLine(side(t(kg(100), 5)), side(t(lb(225), 5))).text).toBe('100×5 kg → 225×5 lb');
    expect(plain(fromToLine(side(t(kg(20, 'per_hand'), 10)), side(t(kg(40, 'total'), 10))).text)).toBe('20 kg ea × 10 → 40×10 kg');
  });

  it('(Ben, 21 Nov) per hand: the load and its unit first, then the reps: `7 kg ea × 17`, never `7×17 kg ea`', () => {
    const same = fromToLine(side(t(kg(7, 'per_hand'), 17)), side(t(kg(7, 'per_hand'), 17)));
    expect(same.same).toBe(true);
    expect(same.text).toBe(`7${NBSP}kg ea${NBSP}×${NBSP}17`);
    expect(same.spoken).toBe('7 kilograms each for 17');
    expect(plain(fromToLine(null, side(t(kg(26, 'per_hand'), 8, 10))).text)).toBe('26 kg ea × 8–10');
    expect(plain(fromToLine(side(t(kg(24, 'per_hand'), 10)), side(t(kg(26, 'per_hand'), 8))).text)).toBe('24 kg ea × 10 → 26 kg ea × 8');
    expect(plain(fromToLine(side(t(lb(50, 'per_hand'), 12)), side(t(lb(50, 'per_hand'), 12))).text)).toBe('50 lb ea × 12');
    // Reps only and load only keep their short forms.
    expect(fromToLine(side(t(kg(7, 'per_hand'), 15)), side(t(kg(7, 'per_hand'), 17))).text).toBe('3×15 → 3×17');
    expect(fromToLine(side(t(kg(24, 'per_hand'), 10)), side(t(kg(26, 'per_hand'), 10))).text).toBe('24 → 26 kg ea');
  });

  it('(Ben, 21 Nov) assisted the same way: `30 kg assist × 8`; totals stay `97.5×8 → 100×6–10 kg`', () => {
    expect(plain(fromToLine(null, side(t(kg(30, 'assistance'), 8))).text)).toBe('30 kg assist × 8');
    expect(fromToLine(side(t(kg(97.5), 8)), side(t(kg(100), 6, 10))).text).toBe('97.5×8 → 100×6–10 kg');
  });

  it('(Ben, 21 Nov) a per-hand top set and back-off line: `Top 30 kg ea × 6 → 32 kg ea × 6 · back-off 26`', () => {
    const l = topBackoffLine(side(t(kg(30, 'per_hand'), 6), null), side(t(kg(32, 'per_hand'), 6), null), { from: kg(25, 'per_hand'), to: kg(26, 'per_hand') });
    expect(plain(l.text)).toBe('Top 30 kg ea × 6 → 32 kg ea × 6 · back-off 26');
    const b = topBackoffLine(side(t(kg(100), 5), null), side(t(kg(102.5), 5), null), { from: kg(85), to: kg(87.5) });
    expect(b.text).toBe('Top 100×5 → 102.5×5 kg · back-off 87.5');
  });

  it('nothing different: the target alone, marked same', () => {
    expect(fromToLine(side(t(kg(100), 6, 8)), side(t(kg(100), 6, 8)))).toEqual({ text: '100×6–8 kg', spoken: '100 kilograms for 6 to 8', same: true });
  });

  it('no from: the target alone', () => {
    expect(fromToLine(null, side(t(kg(102.5), 5)))).toMatchObject({ text: '102.5×5 kg', same: true });
  });

  it('a new target RIR is named after the change', () => {
    expect(fromToLine(side(t(kg(100), 5, 5, 8)), side(t(kg(102.5), 5, 5, 9))).text).toBe('100 → 102.5 kg · RIR 1');
    expect(fromToLine(side(t(kg(100), 5, 5, 8)), side(t(kg(100), 5, 5, 8))).same).toBe(true);
  });
});

describe('doneLine', () => {
  const set = (load: Load | null, reps: number | null) => ({ load, reps });
  const r = { direction: 'resistance' as const };

  it('every set the same: `3×8 @ 80 kg`', () => {
    expect(doneLine([set(kg(80), 8), set(kg(80), 8), set(kg(80), 8)], r)).toEqual({ text: '3×8 @ 80 kg', spoken: '3 sets of 8 at 80 kilograms' });
  });

  it('one load, reps differ: `8, 8, 7 @ 80 kg`', () => {
    expect(doneLine([set(kg(80), 8), set(kg(80), 8), set(kg(80), 7)], r)?.text).toBe('8, 8, 7 @ 80 kg');
  });

  it('loads differ: count and best set', () => {
    expect(doneLine([set(kg(100), 5), set(kg(102.5), 5), set(kg(102.5), 3), set(kg(95), 8)], r)?.text).toBe('4 sets · best 102.5×5 kg');
  });

  it('assisted: the best is the least assistance', () => {
    expect(plain(doneLine([set(kg(30, 'assistance'), 8), set(kg(25, 'assistance'), 6)], { direction: 'assistance' })?.text)).toBe('2 sets · best 25 kg assist × 6');
  });

  it('(Ben, 21 Nov) per hand, loads differ: `best 9 kg ea × 15`', () => {
    expect(plain(doneLine([set(kg(7, 'per_hand'), 17), set(kg(9, 'per_hand'), 15)], r)?.text)).toBe('2 sets · best 9 kg ea × 15');
  });

  it('per hand and lb', () => {
    expect(doneLine([set(kg(24, 'per_hand'), 10), set(kg(24, 'per_hand'), 10)], r)?.text).toBe('2×10 @ 24 kg ea');
    expect(doneLine([set(lb(135), 5)], r)?.text).toBe('1×5 @ 135 lb');
  });

  it('bodyweight', () => {
    expect(doneLine([set(null, 15), set(null, 15)], r)?.text).toBe('2×15');
    expect(doneLine([set(null, 15), set(null, 12)], r)?.text).toBe('15, 12');
  });

  it('mixed units, or no reps: null (the full results show)', () => {
    expect(doneLine([set(kg(100), 5), set(lb(225), 5)], r)).toBeNull();
    expect(doneLine([set(kg(100), null)], r)).toBeNull();
    expect(doneLine([], r)).toBeNull();
  });
});
