import { describe, expect, it } from 'vitest';

import { exerciseHistoryGlance, lastComparableSessions, NBSP, type HistorySession, type PreviousSession } from '../src/index';
import { GYM, id, kg, lb, values } from './fixtures';

/**
 * (Ben, 26 Oct) The exercise pop-up's read-only History mid-workout: the last 3 comparable sessions and a small
 * top-set chart, from logged results only (rule 6).
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const BAR = id(700);

function hist(n: number, day: string, sets: { load: number; reps: number; unit?: 'kg' | 'lb' }[], over: Partial<HistorySession> = {}): HistorySession {
  return {
    sessionId: id(9000 + n),
    performedAtUtc: `${day}T06:00:00.000Z`,
    equipmentId: BAR,
    gymId: GYM,
    imported: false,
    sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.unit === 'lb' ? lb(s.load) : kg(s.load), reps: s.reps, rpe: null, rir: null })),
    ...over,
  };
}

const EX = { equipmentId: BAR, unit: 'kg' as const, loadConvention: 'total' as const, measurement: 'reps' as const, laterality: 'bilateral' as const };

describe('lastComparableSessions', () => {
  it('newest first, like-for-like only (another item or unit is never offered)', () => {
    const h = [
      hist(1, '2026-10-01', [{ load: 95, reps: 8 }]),
      hist(2, '2026-10-08', [{ load: 100, reps: 8 }]),
      hist(3, '2026-10-12', [{ load: 225, reps: 5, unit: 'lb' }]),
      hist(4, '2026-10-15', [{ load: 70, reps: 8 }], { equipmentId: id(799) }),
      hist(5, '2026-10-20', [{ load: 102.5, reps: 7 }]),
    ];
    expect(lastComparableSessions(h, EX, 3).map((s) => s.sessionId)).toEqual([id(9005), id(9002), id(9001)]);
    expect(lastComparableSessions(h, EX, 1)).toHaveLength(1);
  });
});

describe('exerciseHistoryGlance', () => {
  const prev = (n: number, day: string, sets: { load: number; reps: number }[]): PreviousSession => ({
    sessionId: id(9100 + n),
    performedAtUtc: `${day}T06:00:00.000Z`,
    gymId: GYM,
    imported: false,
    sets: sets.map((s, index) => ({ index, values: values(kg(s.load), s.reps) })),
  });

  it('the last 3 as `12 Oct · 100 × 8, 8, 7`; the chart is every session’s top set, oldest to newest', () => {
    const sessions = [
      prev(4, '2026-10-20', [{ load: 102.5, reps: 7 }, { load: 100, reps: 8 }]),
      prev(3, '2026-10-12', [{ load: 100, reps: 8 }, { load: 100, reps: 8 }, { load: 100, reps: 7 }]),
      prev(2, '2026-10-05', [{ load: 97.5, reps: 8 }]),
      prev(1, '2026-09-28', [{ load: 95, reps: 8 }]),
    ];
    const v = exerciseHistoryGlance({ sessions, ex: EX, eq: null, tz: 'UTC', today: '2026-10-26' });
    expect(v.rows.map((r) => [plain(r.date), plain(r.text)])).toEqual([
      ['20 Oct', '102.5 × 7, 100 × 8'],
      ['12 Oct', '100 × 8, 8, 7'],
      ['5 Oct', '97.5 × 8'],
    ]);
    expect(v.chart?.points.map((p) => p.value)).toEqual([95, 97.5, 100, 102.5]);
    expect(v.chart?.unit).toBe('kg');
    expect(v.chart?.points.at(-1)?.readout).toBe('20 Oct · 102.5 × 7');
    expect(v.empty).toBeNull();
  });

  it('no history: says so, no chart; assisted charts the least assistance', () => {
    expect(exerciseHistoryGlance({ sessions: [], ex: EX, eq: null, tz: 'UTC', today: '2026-10-26' })).toEqual({ rows: [], chart: null, empty: 'No history yet' });
    const ap = { ...EX, loadConvention: 'assistance' as const };
    const s = [{ sessionId: id(1), performedAtUtc: '2026-10-20T06:00:00.000Z', gymId: GYM, imported: false, sets: [{ index: 0, values: values(kg(30, 'assistance'), 8) }, { index: 1, values: values(kg(25, 'assistance'), 6) }] }];
    const v = exerciseHistoryGlance({ sessions: s, ex: ap, eq: null, tz: 'UTC', today: '2026-10-26' });
    expect(v.chart?.points.map((p) => p.value)).toEqual([25]);
    expect(v.chart?.unit).toBe('kg assist');
  });
});
