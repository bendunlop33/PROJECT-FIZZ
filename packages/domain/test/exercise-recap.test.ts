import { describe, expect, it } from 'vitest';

import type { Load } from '@fizz/schemas';

import { exerciseRecap, NBSP, type HistorySession, type HistorySet } from '../src/index';

/** Redesign 27 Oct, D6: the expanded editor card's `Last · <date>` with its sets and `Best`, from logged results only. */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const lb = (value: number): Load => ({ value, unit: 'lb', convention: 'total' });
const set = (load: Load | null, reps: number, setType: HistorySet['setType'] = 'working'): HistorySet => ({ setType, side: null, load, reps, rpe: null, rir: null });
const sess = (id: string, at: string, sets: HistorySet[], more: Partial<HistorySession> = {}): HistorySession => ({ sessionId: id, performedAtUtc: at, equipmentId: 'bar', gymId: 'g', imported: false, sets, ...more });
const base = { measurement: 'reps' as const, laterality: 'bilateral' as const, tz: 'Europe/London', today: '2026-10-27' };

describe('exerciseRecap', () => {
  it('Last · 20 Oct with that session’s working sets (warm-ups left out), Best = heaviest top set across comparable sessions', () => {
    const r = exerciseRecap({
      ...base,
      history: [
        sess('a', '2026-10-13T09:00:00.000Z', [set(kg(82.5), 6), set(kg(80), 8)]),
        sess('b', '2026-10-20T09:00:00.000Z', [set(kg(40), 8, 'warmup'), set(kg(80), 8), set(kg(80), 8), set(kg(80), 7), set(kg(80), 6)]),
      ],
    });
    expect(plain(r?.lastLabel)).toBe('Last · 20 Oct');
    expect(plain(r?.lastText)).toBe('80 × 8, 8, 7, 6');
    expect(plain(r?.bestText)).toBe('82.5 × 6');
    expect(r?.accessibilityLabel).toContain('best 82.5 × 6');
  });

  it('kg and lb are never compared: the newest workout’s unit decides', () => {
    const r = exerciseRecap({ ...base, history: [sess('a', '2026-10-13T09:00:00.000Z', [set(lb(225), 5)]), sess('b', '2026-10-20T09:00:00.000Z', [set(kg(80), 8)])] });
    expect(plain(r?.bestText)).toBe('80 × 8');
  });

  it('per dumbbell keeps `each`; assisted: best is the least assistance', () => {
    const db = exerciseRecap({ ...base, history: [sess('a', '2026-10-20T09:00:00.000Z', [set(kg(24, 'per_hand'), 10), set(kg(24, 'per_hand'), 9)])] });
    expect(plain(db?.lastText)).toBe('24 ea × 10, 9');
    expect(db?.accessibilityLabel).toContain('24 each × 10, 9');
    const assisted = exerciseRecap({ ...base, history: [sess('a', '2026-10-13T09:00:00.000Z', [set(kg(30, 'assistance'), 8)]), sess('b', '2026-10-20T09:00:00.000Z', [set(kg(35, 'assistance'), 8)])] });
    expect(plain(assisted?.bestText)).toContain('30');
  });

  it('no history: null (never invented)', () => {
    expect(exerciseRecap({ ...base, history: [] })).toBeNull();
    expect(exerciseRecap({ ...base, history: [sess('a', '2026-10-20T09:00:00.000Z', [set(kg(40), 8, 'warmup')])] })).toBeNull();
  });
});
