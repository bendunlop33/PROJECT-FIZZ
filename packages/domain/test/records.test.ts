import { describe, expect, it } from 'vitest';
import type { Load } from '@fizz/schemas';

import { findSetRecord, NBSP, RECORD_MIN_SESSIONS, type HistorySession, type HistorySet, type SetRecordInput } from '../src/index';
import { kg, lb } from './fixtures';

/** premium-feel §5.1, acceptance 17: one rule per test. */
const plain = (s: string | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const EQ = 'eq-bar';
const set = (load: Load | null, reps: number | null, setType: HistorySet['setType'] = 'working'): HistorySet => ({ setType, side: null, load, reps, rpe: null, rir: null });
const session = (n: number, sets: HistorySet[], over: Partial<HistorySession> = {}): HistorySession => ({
  sessionId: `s${String(n)}`,
  performedAtUtc: `2026-10-0${String(n)}T10:00:00.000Z`,
  equipmentId: EQ,
  gymId: 'g',
  imported: false,
  sets,
  ...over,
});
const three = [session(1, [set(kg(90), 8)]), session(2, [set(kg(95), 8)]), session(3, [set(kg(97.5), 6), set(kg(97.5), 5)])];
const input = (over: Partial<SetRecordInput> = {}): SetRecordInput => ({
  exerciseName: 'Bench press',
  gymName: 'Main gym',
  equipmentId: EQ,
  convention: 'total',
  measurement: 'reps',
  set: { setType: 'working', load: kg(100), reps: 6 },
  earlierToday: [],
  history: three,
  ...over,
});

describe('findSetRecord', () => {
  it('heaviest comparable set after 3 earlier sessions', () => {
    expect(RECORD_MIN_SESSIONS).toBe(3);
    expect(findSetRecord(input())).toEqual({ kind: 'heaviest', text: 'Heaviest bench press set at Main gym so far' });
    expect(findSetRecord(input({ gymName: null }))?.text).toBe('Heaviest bench press set so far');
    // No equipment instance: compared across gyms, so no gym in the words (review N5).
    const noEq = three.map((h) => ({ ...h, equipmentId: null }));
    expect(findSetRecord(input({ equipmentId: null, history: noEq }))?.text).toBe('Heaviest bench press set so far');
  });

  it('needs at least 3 earlier comparable sessions', () => {
    expect(findSetRecord(input({ history: three.slice(0, 2) }))).toBeNull();
    // A session on other equipment, imported, or with only warm-ups doesn't count towards the 3.
    expect(findSetRecord(input({ history: [...three.slice(0, 2), session(4, [set(kg(50), 8)], { equipmentId: 'other' })] }))).toBeNull();
    expect(findSetRecord(input({ history: [...three.slice(0, 2), session(4, [set(kg(50), 8)], { imported: true })] }))).toBeNull();
    expect(findSetRecord(input({ history: [...three.slice(0, 2), session(4, [set(kg(50), 8, 'warmup')])] }))).toBeNull();
  });

  it('most reps at the heaviest load', () => {
    expect(plain(findSetRecord(input({ set: { setType: 'working', load: kg(97.5), reps: 7 } }))?.text)).toBe('Most reps at 97.5 kg on bench press so far');
    expect(findSetRecord(input({ set: { setType: 'working', load: kg(97.5), reps: 6 } }))).toBeNull();
    expect(findSetRecord(input({ set: { setType: 'working', load: kg(95), reps: 12 } }))).toBeNull();
  });

  it('never for warm-ups or drop sets; top and back-off sets count', () => {
    expect(findSetRecord(input({ set: { setType: 'warmup', load: kg(100), reps: 6 } }))).toBeNull();
    expect(findSetRecord(input({ set: { setType: 'drop', load: kg(100), reps: 6 } }))).toBeNull();
    expect(findSetRecord(input({ set: { setType: 'top', load: kg(100), reps: 6 } }))?.kind).toBe('heaviest');
    // A heavier warm-up in history doesn't block a working-set record.
    expect(findSetRecord(input({ history: [...three, session(4, [set(kg(120), 1, 'warmup'), set(kg(90), 8)])] }))?.kind).toBe('heaviest');
  });

  it('suppressed when an imported set of the exercise was heavier, on any equipment and in either unit', () => {
    expect(findSetRecord(input({ history: [...three, session(5, [set(kg(110), 3)], { imported: true, equipmentId: null })] }))).toBeNull();
    expect(findSetRecord(input({ history: [...three, session(5, [set(lb(225), 3)], { imported: true, equipmentId: null })] }))).toBeNull();
    // Lighter imported history doesn't suppress it.
    expect(findSetRecord(input({ history: [...three, session(5, [set(kg(80), 3)], { imported: true })] }))?.kind).toBe('heaviest');
  });

  it('a heavier set earlier in the same workout means this one is not a record', () => {
    expect(findSetRecord(input({ earlierToday: [set(kg(100), 6)] }))).toBeNull();
    expect(findSetRecord(input({ earlierToday: [set(kg(100), 5)] }))?.kind).toBe('most_reps_at_load');
  });

  it('kg and lb are never compared as numbers: lb history is not comparable with a kg set', () => {
    const lbHistory = [1, 2, 3].map((n) => session(n, [set(lb(315), 5)]));
    expect(findSetRecord(input({ history: lbHistory }))).toBeNull();
    expect(findSetRecord(input({ history: lbHistory, set: { setType: 'working', load: lb(320), reps: 5 } }))?.kind).toBe('heaviest');
  });

  it('per-hand dumbbells keep their wording; assisted and bodyweight never have records', () => {
    const db = [1, 2, 3].map((n) => session(n, [set(kg(27.5, 'per_hand'), 10)]));
    const r = findSetRecord(input({ convention: 'per_hand', history: db, set: { setType: 'working', load: kg(27.5, 'per_hand'), reps: 11 } }));
    expect(plain(r?.text)).toBe('Most reps at 27.5 kg each on bench press so far');
    const assist = [1, 2, 3].map((n) => session(n, [set(kg(30, 'assistance'), 8)]));
    expect(findSetRecord(input({ convention: 'assistance', history: assist, set: { setType: 'working', load: kg(40, 'assistance'), reps: 8 } }))).toBeNull();
    expect(findSetRecord(input({ convention: 'bodyweight', set: { setType: 'working', load: null, reps: 20 } }))).toBeNull();
  });

  it('a set with a convention that differs from the exercise, no load, or a timed exercise is never a record', () => {
    expect(findSetRecord(input({ set: { setType: 'working', load: kg(100, 'per_hand'), reps: 6 } }))).toBeNull();
    expect(findSetRecord(input({ set: { setType: 'working', load: null, reps: 6 } }))).toBeNull();
    expect(findSetRecord(input({ measurement: 'duration' }))).toBeNull();
  });
});
