import { describe, expect, it } from 'vitest';

import type { Load, LoadConvention, WeightUnit } from '@fizz/schemas';

import {
  blockDelta,
  blockDeltaText,
  blockLineText,
  blockLoadKind,
  bestSetWithUnit,
  compareBest,
  liftBlockProgress,
  weekBestSet,
  type BlockBestSet,
  type BlockLoadKind,
  type LiftWeekInput,
} from '../src/index';

/**
 * (Ben, 31 Oct; block-progress.md) Up / held / stalled per main lift across a block. Best set per week: heaviest load,
 * then reps at it. Up = more load or more reps at that load than the best so far; held = equal; stalled = no gain for
 * 2+ trained weeks in a row. Deload weeks and weeks with no session never count as a stall (nor break one).
 */

const load = (value: number, convention: LoadConvention = 'total', unit: WeightUnit = 'kg'): Load => ({ value, unit, convention });
const set = (value: number | null, reps: number, convention: LoadConvention = 'total', unit: WeightUnit = 'kg') => ({ setType: 'working' as const, load: value === null ? null : load(value, convention, unit), reps });

function best(value: number, reps: number, kind: BlockLoadKind = 'load', convention: LoadConvention = 'total', unit: WeightUnit = 'kg'): BlockBestSet {
  const b = weekBestSet([set(value, reps, convention, unit)], kind, null, unit);
  if (b === null) throw new Error('no best');
  return b;
}

const week = (w: number, b: BlockBestSet | null, over: Partial<LiftWeekInput> = {}): LiftWeekInput => ({ week: w, deload: false, reached: true, best: b, sets: b === null ? 0 : 3, ...over });

describe('weekBestSet: heaviest load, then most reps at it', () => {
  it('100×6, 102.5×4, 102.5×5 → 102.5×5; warm-ups and marked sets never count', () => {
    const b = weekBestSet(
      [
        { setType: 'warmup', load: load(120), reps: 1 },
        set(100, 6),
        set(102.5, 4),
        set(102.5, 5),
        { setType: 'working', load: load(110), reps: 5, exclusions: ['spotted'] },
      ],
      'load',
    );
    expect(b).toMatchObject({ value: 102.5, reps: 5 });
    expect(b?.e1rm).toBe(119.5);
  });

  it('assisted: less assistance is heavier (Assist 20×8 beats Assist 30×10)', () => {
    const b = weekBestSet([set(30, 10, 'assistance'), set(20, 8, 'assistance')], 'assisted');
    expect(b).toMatchObject({ value: 20, reps: 8, e1rm: null });
  });

  it('bodyweight-plus: BW counts as added 0; BW+5×6 beats BW×10', () => {
    const b = weekBestSet([{ setType: 'working', load: null, reps: 10 }, set(5, 6, 'added')], 'bodyweight_plus');
    expect(b).toMatchObject({ value: 5, reps: 6, kind: 'bodyweight_plus' });
  });

  it('kg and lb compare by mass: 225 lb (102.06 kg) beats 100 kg', () => {
    const b = weekBestSet([set(100, 5), set(225, 5, 'total', 'lb')], 'load');
    expect(b).toMatchObject({ value: 225, unit: 'lb' });
  });

  it('the lift kind from its conventions', () => {
    expect(blockLoadKind(['total'])).toBe('load');
    expect(blockLoadKind(['per_hand'])).toBe('load');
    expect(blockLoadKind(['bodyweight', 'added'])).toBe('bodyweight_plus');
    expect(blockLoadKind(['added'], 'plate_loaded_machine')).toBe('load');
    expect(blockLoadKind(['assistance'])).toBe('assisted');
  });
});

describe('liftBlockProgress: up, held, stalled', () => {
  it('up every week: bench 100×6 → 102.5×6 → 105×6, +5%', () => {
    const p = liftBlockProgress([week(1, best(100, 6)), week(2, best(102.5, 6)), week(3, best(105, 6)), week(4, null, { reached: false }), week(5, null, { reached: false }), week(6, null, { reached: false, deload: true })]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'up', 'up', 'todo', 'todo', 'deload']);
    expect(p.status).toBe('up');
    expect(p.delta).toEqual({ kind: 'pct', value: 5 });
    expect(blockLineText(p.first as BlockBestSet, p.best as BlockBestSet)).toBe('100×6 → 105×6 kg');
  });

  it('more reps at the same load is up; equal is held (green, no +)', () => {
    const p = liftBlockProgress([week(1, best(80, 8)), week(2, best(80, 8)), week(3, best(80, 9))]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'held', 'up']);
    expect(p.status).toBe('up');
    const held = liftBlockProgress([week(1, best(80, 8)), week(2, best(80, 8))]);
    expect(held.status).toBe('held');
    expect(blockDeltaText(held.delta ?? { kind: 'pct', value: 99 })).toBe('0%');
  });

  it('stalled: barbell row 95×8, 95×8, 95×7 → stalled 2 weeks; both no-gain weeks read stalled', () => {
    const p = liftBlockProgress([week(1, best(95, 8)), week(2, best(95, 8)), week(3, best(95, 7))]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'stalled', 'stalled']);
    expect(p.status).toBe('stalled');
    expect(p.noGainRun).toBe(2);
  });

  it('one week with no gain is not a stall yet', () => {
    const p = liftBlockProgress([week(1, best(95, 8)), week(2, best(95, 7))]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'dip']);
    expect(p.status).toBe('held');
  });

  it('a gain after a stall ends it; the stalled weeks stay amber in the history', () => {
    const p = liftBlockProgress([week(1, best(95, 8)), week(2, best(95, 8)), week(3, best(95, 8)), week(4, best(97.5, 8))]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'stalled', 'stalled', 'up']);
    expect(p.status).toBe('up');
  });

  it('the deload week never counts as a stall and never breaks one', () => {
    const lighter = liftBlockProgress([week(1, best(100, 5)), week(2, best(102.5, 5)), week(3, best(92.5, 4), { deload: true })]);
    expect(lighter.weeks.map((w) => w.state)).toEqual(['base', 'up', 'deload']);
    expect(lighter.status).toBe('up');
    // held, deload, held: still two trained no-gain weeks in a row.
    const across = liftBlockProgress([week(1, best(100, 5)), week(2, best(100, 5)), week(3, best(90, 5), { deload: true }), week(4, best(100, 5))]);
    expect(across.weeks.map((w) => w.state)).toEqual(['base', 'stalled', 'deload', 'stalled']);
  });

  it('weeks with no session of the lift are skipped (grey), never a stall', () => {
    const p = liftBlockProgress([week(1, best(100, 5)), week(2, null), week(3, best(100, 5)), week(4, null)]);
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'none', 'held', 'none']);
    expect(p.status).toBe('held');
  });

  it('the lead-in (week 0) is shown but never week 1: the baseline is week 1', () => {
    const p = liftBlockProgress([week(0, best(90, 6)), week(1, best(100, 6)), week(2, best(102.5, 6))]);
    expect(p.weeks.map((w) => w.state)).toEqual(['lead_in', 'base', 'up']);
    expect(p.firstWeek).toBe(1);
    expect(p.first?.value).toBe(100);
  });

  it('per-hand dumbbells: 32×8 → 34×8 kg ea, +6%', () => {
    const p = liftBlockProgress([week(1, best(32, 8, 'load', 'per_hand')), week(2, best(34, 8, 'load', 'per_hand'))]);
    expect(blockLineText(p.first as BlockBestSet, p.best as BlockBestSet)).toBe('32×8 → 34×8 kg ea');
    expect(blockDeltaText(p.delta ?? { kind: 'pct', value: 0 })).toBe('+6%');
    expect(bestSetWithUnit(p.best as BlockBestSet)).toBe('34×8 kg ea');
  });

  it('bodyweight-plus: BW×8 → BW+5×8 kg, +5 kg (no %)', () => {
    const p = liftBlockProgress([week(1, best(0, 8, 'bodyweight_plus', 'bodyweight')), week(2, best(5, 8, 'bodyweight_plus', 'added'))]);
    expect(blockLineText(p.first as BlockBestSet, p.best as BlockBestSet)).toBe('BW×8 → BW+5×8 kg');
    expect(p.delta).toEqual({ kind: 'added', value: 5, unit: 'kg' });
    expect(blockDeltaText(p.delta ?? { kind: 'pct', value: 0 })).toBe('+5 kg');
    // Bodyweight only, more reps: a reps change.
    const reps = liftBlockProgress([week(1, best(0, 8, 'bodyweight_plus', 'bodyweight')), week(2, best(0, 10, 'bodyweight_plus', 'bodyweight'))]);
    expect(blockDeltaText(reps.delta ?? { kind: 'pct', value: 0 })).toBe('+2 reps');
    expect(blockLineText(reps.first as BlockBestSet, reps.best as BlockBestSet)).toBe('BW×8 → BW×10');
  });

  it('assisted machine: less assistance is up (Assist −5 kg)', () => {
    const p = liftBlockProgress([week(1, best(30, 8, 'assisted', 'assistance')), week(2, best(25, 8, 'assisted', 'assistance'))]);
    expect(p.status).toBe('up');
    expect(blockDeltaText(p.delta ?? { kind: 'pct', value: 0 })).toBe('Assist −5 kg');
  });

  it('lb stays lb: 185×5 → 195×5 lb', () => {
    const p = liftBlockProgress([week(1, best(185, 5, 'load', 'total', 'lb')), week(2, best(195, 5, 'load', 'total', 'lb'))]);
    expect(blockLineText(p.first as BlockBestSet, p.best as BlockBestSet)).toBe('185×5 → 195×5 lb');
    // Est. 1RM 216 → 228 lb (rounded to 1 lb).
    expect(p.delta).toEqual({ kind: 'pct', value: 6 });
  });

  it('kg then lb: each side keeps its own unit', () => {
    expect(blockLineText(best(100, 5), best(225, 5, 'load', 'total', 'lb'))).toBe('100×5 kg → 225×5 lb');
    expect(blockDelta(best(100, 5), best(225, 5, 'load', 'total', 'lb'))).toEqual({ kind: 'pct', value: 2 });
  });

  it('nothing trained: no line, no delta', () => {
    const p = liftBlockProgress([week(1, null), week(2, null, { reached: false })]);
    expect(p.status).toBe('none');
    expect(p.delta).toBeNull();
  });

  it('compareBest: load first, then reps', () => {
    expect(compareBest(best(100, 5), best(97.5, 10))).toBeGreaterThan(0);
    expect(compareBest(best(100, 5), best(100, 6))).toBeLessThan(0);
    expect(compareBest(best(100, 5), best(100, 5))).toBe(0);
  });
});
