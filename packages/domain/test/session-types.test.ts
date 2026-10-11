import { describe, expect, it } from 'vitest';
import type { ZonedTimestamp } from '@fizz/schemas';

import {
  categoryLabel,
  deriveSessionTypes,
  formatLastDone,
  nextInRotation,
  normaliseSessionName,
  orderSessionTypes,
  recommendSession,
  NBSP,
  type FinishedRef,
  type SessionTypeRoutine,
  type SessionTypeSession,
} from '../src/index';

const TZ = 'Europe/London';
/** Sun 11 Oct 2026, 09:00 BST. */
const NOW: ZonedTimestamp = { utc: '2026-10-11T08:00:00.000Z', tz: TZ };
const on = (date: string, hour = 18): ZonedTimestamp => ({ utc: `${date}T${String(hour - 1).padStart(2, '0')}:00:00.000Z`, tz: TZ });
const plain = (s: string) => s.replaceAll(NBSP, ' ');
function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no item ${String(i)}`);
  return x;
}

function imported(id: string, date: string, categories: Record<string, number>, exerciseCount = 5): SessionTypeSession {
  return { id, routineId: null, routineName: null, startedAt: on(date), exerciseCount, imported: true, importCategories: categories };
}
function logged(id: string, date: string, o: { routineId?: string | null; routineName?: string | null; exerciseCount?: number } = {}): SessionTypeSession {
  return { id, routineId: o.routineId ?? null, routineName: o.routineName ?? null, startedAt: on(date), exerciseCount: o.exerciseCount ?? 5, imported: false };
}
const ref = (s: SessionTypeSession): FinishedRef => ({ sessionId: s.id, routineId: s.routineId, startedAtUtc: s.startedAt.utc, tz: s.startedAt.tz });

/** §8 fixture: routines Arms (never done) and Full body (14 Aug); FitNotes Legs, Shoulders, Back, Chest and one mixed session. */
function fixture() {
  const routines: SessionTypeRoutine[] = [
    { id: 'r-arms', name: 'Arms', exerciseCount: 4 },
    { id: 'r-full', name: 'Full body', exerciseCount: 6 },
  ];
  const sessions: SessionTypeSession[] = [
    logged('s-full', '2026-08-14', { routineId: 'r-full', routineName: 'Full body', exerciseCount: 6 }),
    imported('i-legs', '2026-10-05', { Legs: 15 }),
    imported('i-shoulders', '2026-10-07', { Shoulders: 12, Arms: 3 }),
    imported('i-back', '2026-10-08', { Back: 14, Arms: 4 }, 6),
    imported('i-mixed', '2026-10-08', { Chest: 4, Back: 4, Legs: 4, Shoulders: 4 }),
    imported('i-chest', '2026-10-09', { Chest: 13, Triceps: 2 }),
  ];
  return { routines, sessions };
}

describe('categoryLabel (SP3)', () => {
  it('names a session after a category with 60% or more of the working sets', () => {
    expect(categoryLabel({ Legs: 6, Back: 4 })?.label).toBe('Legs');
    expect(categoryLabel({ Legs: 59, Back: 41 })?.label).toBe('Back + Legs');
    expect(categoryLabel({ Legs: 59, Back: 21, Chest: 20 })).toBeNull();
  });

  it('pairs the top two in alphabetical order, and either order gives one key', () => {
    const a = categoryLabel({ Triceps: 5, Chest: 5 });
    const b = categoryLabel({ Chest: 5, Triceps: 4, Shoulders: 1 });
    expect(a?.label).toBe('Chest + Triceps');
    expect(b?.label).toBe('Chest + Triceps');
    expect(a?.key).toBe(b?.key);
  });

  it('returns null for a mixed session', () => {
    expect(categoryLabel({ Chest: 4, Back: 4, Legs: 4, Shoulders: 4 })).toBeNull();
    // Top two each ≥ 25% but under 80% together.
    expect(categoryLabel({ Chest: 4, Back: 3, Legs: 3 })).toBeNull();
    // Together ≥ 80% but one under 25%.
    expect(categoryLabel({ Chest: 59, Back: 22, Legs: 19 })).toBeNull();
  });

  it('ignores empty cells, and keeps Ben’s spelling (trimmed only)', () => {
    expect(categoryLabel({ '': 10, '  ': 5, ' quads & glutes ': 3 })?.label).toBe('quads & glutes');
    expect(categoryLabel({})).toBeNull();
    expect(categoryLabel({ '': 4 })).toBeNull();
    expect(categoryLabel({ 'Legs ': 2, Legs: 2, Back: 1 })?.label).toBe('Legs');
  });
});

describe('deriveSessionTypes (§3.1)', () => {
  it('lists routines and imported FitNotes categories as session types; a mixed session is not one (SP2)', () => {
    const { routines, sessions } = fixture();
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    expect(types.map((t) => t.label)).toEqual(['Arms', 'Full body', 'Back', 'Chest', 'Legs', 'Shoulders']);
    const legs = types.find((t) => t.label === 'Legs');
    expect(legs).toMatchObject({ kind: 'category', routineId: null, sourceSessionId: 'i-legs', older: false, exerciseCount: 5 });
    expect(types.find((t) => t.label === 'Arms')).toMatchObject({ kind: 'routine', routineId: 'r-arms', sourceSessionId: null, lastDone: null, exerciseCount: 4, older: false });
    expect(types.find((t) => t.label === 'Full body')).toMatchObject({ kind: 'routine', sourceSessionId: 's-full', older: true });
    expect(types.some((t) => t.sourceSessionId === 'i-mixed')).toBe(false);
  });

  it('groups a type by its most recent session', () => {
    const types = deriveSessionTypes({ routines: [], sessions: [imported('a', '2026-09-28', { Legs: 9 }, 4), imported('b', '2026-10-05', { Legs: 9 }, 6)], now: NOW });
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ sourceSessionId: 'b', exerciseCount: 6, lastDone: on('2026-10-05') });
  });

  it('merges named and category groups with the same normalised label (SP4, SP12)', () => {
    const sessions = [imported('i-legs', '2026-10-05', { Legs: 15 }), logged('s-legs', '2026-10-10', { routineName: '  legs ' })];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ kind: 'named', label: 'legs', sourceSessionId: 's-legs' });
  });

  it('shows the most recent spelling of a name', () => {
    const sessions = [logged('a', '2026-10-01', { routineName: 'push  day' }), logged('b', '2026-10-08', { routineName: 'Push day' })];
    expect(deriveSessionTypes({ routines: [], sessions, now: NOW }).map((t) => t.label)).toEqual(['Push day']);
  });

  it('counts a named workout equal to a routine’s name for the routine (SP4)', () => {
    const routines = [{ id: 'r-pull', name: 'Pull A', exerciseCount: 5 }];
    const sessions = [logged('s1', '2026-10-01', { routineId: 'r-pull', routineName: 'Pull A' }), logged('s2', '2026-10-06', { routineName: 'pull a' }), imported('i1', '2026-10-09', { 'Pull A': 9 })];
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ kind: 'routine', routineId: 'r-pull', sourceSessionId: 'i1' });
  });

  it('counts the workout a routine was saved from for that routine', () => {
    const routines = [{ id: 'r-legs', name: 'Leg day', createdFromSessionId: 's1', exerciseCount: 5 }];
    const types = deriveSessionTypes({ routines, sessions: [logged('s1', '2026-10-01', { routineName: 'Legs' })], now: NOW });
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ key: 'routine:r-legs', sourceSessionId: 's1' });
  });

  it('never makes `Workout` or an unnamed app workout a type (SP4)', () => {
    const sessions = [logged('a', '2026-10-01', { routineName: 'Workout' }), logged('b', '2026-10-02'), logged('c', '2026-10-03', { routineName: '   ' })];
    expect(deriveSessionTypes({ routines: [], sessions, now: NOW })).toEqual([]);
  });

  it('only reads Category for imported workouts', () => {
    const appSession: SessionTypeSession = { ...logged('a', '2026-10-01'), importCategories: { Legs: 10 } };
    expect(deriveSessionTypes({ routines: [], sessions: [appSession], now: NOW })).toEqual([]);
  });

  it('leaves workouts from a deleted routine to Past workouts', () => {
    expect(deriveSessionTypes({ routines: [], sessions: [logged('a', '2026-10-01', { routineId: 'gone', routineName: 'Old split' })], now: NOW })).toEqual([]);
  });

  it('marks types last done more than 42 days ago as older, in the local calendar', () => {
    const at42 = imported('a', '2026-08-30', { Legs: 5 });
    const at43 = imported('b', '2026-08-29', { Back: 5 });
    const types = deriveSessionTypes({ routines: [], sessions: [at42, at43], now: NOW });
    expect(types.find((t) => t.label === 'Legs')?.older).toBe(false);
    expect(types.find((t) => t.label === 'Back')?.older).toBe(true);
  });
});

describe('recommendSession (§3.3, SP5)', () => {
  it('recommends the type with the longest gap, never the one just done (SP1)', () => {
    const { routines, sessions } = fixture();
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    const last = ref(nth(sessions, sessions.length - 1));
    const rec = recommendSession(types, routines, last);
    expect(rec).toEqual({ key: types.find((t) => t.label === 'Legs')?.key, basis: { kind: 'longest_gap', lastDone: on('2026-10-05') } });
  });

  it('never recommends an OLDER type, even when it has the longest gap', () => {
    const sessions = [imported('old', '2026-07-01', { Arms: 9 }), imported('a', '2026-10-06', { Legs: 9 }), imported('b', '2026-10-09', { Back: 9 })];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    expect(types.find((t) => t.key === recommendSession(types, [], ref(nth(sessions, 2)))?.key)?.label).toBe('Legs');
  });

  it('excludes the type just done unless it is the only active one', () => {
    const sessions = [imported('old', '2026-07-01', { Arms: 9 }), imported('b', '2026-10-09', { Back: 9 })];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    const rec = recommendSession(types, [], ref(nth(sessions, 1)));
    expect(rec).toEqual({ key: 'name:back', basis: { kind: 'longest_gap', lastDone: on('2026-10-09') } });
  });

  it('with one type, that type (`From …`)', () => {
    const sessions = [imported('b', '2026-10-09', { Back: 9 })];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    expect(recommendSession(types, [], ref(nth(sessions, 0)))).toEqual({ key: 'name:back', basis: { kind: 'single', lastDone: on('2026-10-09') } });
  });

  it('with one type done long ago, still that type; with none, null (First workout)', () => {
    const sessions = [imported('b', '2026-06-01', { Back: 9 })];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    expect(recommendSession(types, [], ref(nth(sessions, 0)))?.basis.kind).toBe('single');
    expect(recommendSession([], [], null)).toBeNull();
  });

  it('follows the D19 rotation when the last workout came from a routine (equals nextInRotation)', () => {
    const routines = [
      { id: 'r-push', name: 'Push A', exerciseCount: 5 },
      { id: 'r-pull', name: 'Pull A', exerciseCount: 5 },
      { id: 'r-legs', name: 'Legs', exerciseCount: 5 },
    ];
    // Push A has the longest gap, but the last workout was Pull A, so D19 wins: Legs.
    const sessions = [logged('legs', '2026-10-02', { routineId: 'r-legs', routineName: 'Legs' }), logged('push', '2026-09-30', { routineId: 'r-push', routineName: 'Push A' }), logged('pull', '2026-10-08', { routineId: 'r-pull', routineName: 'Pull A' })];
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    const last = ref(nth(sessions, 2));
    const d19 = nextInRotation(routines, last);
    expect(d19.kind).toBe('routine');
    const rec = recommendSession(types, routines, last);
    expect(rec).toEqual({ key: 'routine:r-legs', basis: { kind: 'after', routineName: 'Pull A', at: on('2026-10-08') } });
  });

  it('with one routine and the last workout from it: `Your only routine`', () => {
    const routines = [{ id: 'r-full', name: 'Full body', exerciseCount: 6 }];
    const sessions = [logged('f', '2026-10-08', { routineId: 'r-full', routineName: 'Full body' }), imported('i', '2026-10-01', { Legs: 9 })];
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    expect(recommendSession(types, routines, ref(nth(sessions, 0)))).toEqual({ key: 'routine:r-full', basis: { kind: 'only' } });
  });

  it('when the last workout is not from a routine, the longest gap replaces “repeat the last workout”', () => {
    const routines = [
      { id: 'r-push', name: 'Push A', exerciseCount: 5 },
      { id: 'r-pull', name: 'Pull A', exerciseCount: 5 },
    ];
    const sessions = [logged('push', '2026-10-03', { routineId: 'r-push', routineName: 'Push A' }), logged('pull', '2026-10-06', { routineId: 'r-pull', routineName: 'Pull A' }), logged('legs', '2026-10-10', { routineName: 'Legs' })];
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    expect(nextInRotation(routines, ref(nth(sessions, 2))).kind).toBe('last_workout');
    expect(recommendSession(types, routines, ref(nth(sessions, 2)))?.key).toBe('routine:r-push');
  });

  it('an unnamed app workout as the last workout excludes nothing', () => {
    const sessions = [imported('a', '2026-10-05', { Legs: 9 }), imported('b', '2026-10-08', { Back: 9 }), logged('u', '2026-10-10')];
    const types = deriveSessionTypes({ routines: [], sessions, now: NOW });
    expect(recommendSession(types, [], ref(nth(sessions, 2)))?.key).toBe('name:legs');
  });
});

describe('orderSessionTypes (SP-D3, SP2)', () => {
  it('orders recommended, longest gap first, New routines, then OLDER', () => {
    const { routines, sessions } = fixture();
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    const rec = recommendSession(types, routines, ref(nth(sessions, sessions.length - 1)));
    const ordered = orderSessionTypes(types, rec?.key ?? null);
    expect(ordered.current.map((t) => t.label)).toEqual(['Legs', 'Shoulders', 'Back', 'Chest', 'Arms']);
    expect(ordered.older.map((t) => t.label)).toEqual(['Full body']);
  });

  it('lists OLDER most recent first and keeps New routines in list order', () => {
    const routines = [
      { id: 'r-b', name: 'B', exerciseCount: 3 },
      { id: 'r-a', name: 'A', exerciseCount: 3 },
    ];
    const sessions = [imported('x', '2026-06-01', { Back: 9 }), imported('y', '2026-07-01', { Legs: 9 })];
    const ordered = orderSessionTypes(deriveSessionTypes({ routines, sessions, now: NOW }), null);
    expect(ordered.current.map((t) => t.label)).toEqual(['B', 'A']);
    expect(ordered.older.map((t) => t.label)).toEqual(['Legs', 'Back']);
  });

  it('keeps every type exactly once', () => {
    const { routines, sessions } = fixture();
    const types = deriveSessionTypes({ routines, sessions, now: NOW });
    const ordered = orderSessionTypes(types, 'routine:r-full');
    expect(ordered.current[0]?.label).toBe('Full body');
    expect([...ordered.current, ...ordered.older].map((t) => t.key).sort()).toEqual(types.map((t) => t.key).sort());
  });
});

describe('formatLastDone (§6)', () => {
  it('reads Today, Yesterday, N days ago under 14 days, then a date', () => {
    expect(formatLastDone(on('2026-10-11', 8), NOW)).toBe('Today');
    expect(formatLastDone(on('2026-10-10', 23), NOW)).toBe('Yesterday');
    expect(formatLastDone(on('2026-10-05'), NOW)).toBe('6 days ago');
    expect(formatLastDone(on('2026-09-28'), NOW)).toBe('13 days ago');
    expect(plain(formatLastDone(on('2026-09-27'), NOW))).toBe('27 Sep');
    expect(plain(formatLastDone(on('2026-08-14'), NOW))).toBe('14 Aug');
  });

  it('counts calendar days in Ben’s zone, not 24-hour blocks', () => {
    // 23:30 local on 10 Oct is "Yesterday" at 09:00 on 11 Oct, though under 24 h ago.
    expect(formatLastDone({ utc: '2026-10-10T22:30:00.000Z', tz: TZ }, NOW)).toBe('Yesterday');
  });
});

describe('normaliseSessionName', () => {
  it('trims, collapses spaces and case-folds', () => {
    expect(normaliseSessionName('  Chest  +   Triceps ')).toBe('chest + triceps');
  });
});
