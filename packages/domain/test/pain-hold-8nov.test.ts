import { describe, expect, it } from 'vitest';

import type { PainFlag, ZonedTimestamp } from '@fizz/schemas';

import {
  calculateNextTargets,
  clearPainFlag,
  newPainFlag,
  painClearsAfter,
  painHeldSessionIds,
  painHeldSessions,
  painHoldOf,
  painStatusFor,
  withPainHold,
  type HistorySession,
  type PainExposure,
} from '../src/index';
import { doubleProgression, id, kg, OWNER } from './fixtures';

/**
 * Rule 9 as changed by Ben on 8 Nov: a pain flag holds its movement in the workout it was reported in and in the
 * movement's next workout, then clears by itself, unless pain is reported again. Ben can still clear it early.
 */

const BENCH = id(9201);
const z = (utc: string): ZonedTimestamp => ({ utc, tz: 'Europe/London' });

function flag(reportedAtUtc: string, over: Partial<PainFlag> = {}): PainFlag {
  return { ...newPainFlag({ id: id(9300), ownerId: OWNER, opId: 'pain-op', exerciseId: BENCH, exerciseName: 'Bench press', area: 'shoulder', source: 'workout', checkInId: null, at: z(reportedAtUtc) }), ...over };
}

const s0: PainExposure = { sessionId: 's0', startedAtUtc: '2026-11-02T08:00:00.000Z', finishedAtUtc: '2026-11-02T09:00:00.000Z', checkInId: null };
const s1: PainExposure = { sessionId: 's1', startedAtUtc: '2026-11-05T08:00:00.000Z', finishedAtUtc: '2026-11-05T09:00:00.000Z', checkInId: null };
const s2: PainExposure = { sessionId: 's2', startedAtUtc: '2026-11-08T08:00:00.000Z', finishedAtUtc: '2026-11-08T09:00:00.000Z', checkInId: null };
const inProgress = (e: PainExposure): PainExposure => ({ ...e, finishedAtUtc: null });
// Reported mid-workout in s0.
const REPORTED = '2026-11-02T08:30:00.000Z';

describe('the one-session hold', () => {
  it('holds the report workout and the next one, then clears by itself on the one after', () => {
    const f = flag(REPORTED);
    // During s0 and after it: holding.
    expect(withPainHold(f, [inProgress(s0)]).status).toBe('active');
    expect(withPainHold(f, [s0]).status).toBe('active');
    expect(painHoldOf(f, [s0])).toEqual({ reportSessionId: 's0', nextSessionId: null, lapsedAtUtc: null });
    // s1 in progress: still holding, and it's the last workout it holds.
    expect(withPainHold(f, [s0, inProgress(s1)]).status).toBe('active');
    expect(painClearsAfter(f, { startedAtUtc: s1.startedAtUtc, checkInId: null })).toBe(true);
    expect(painClearsAfter(f, { startedAtUtc: s0.startedAtUtc, checkInId: null })).toBe(false);
    // s1 finished: cleared by itself, as of s1's finish.
    const after = withPainHold(f, [s0, s1]);
    expect(after).toMatchObject({ status: 'cleared', clearedAtUtc: s1.finishedAtUtc, lapsed: { atUtc: s1.finishedAtUtc, sessionId: 's1' } });
    expect(painStatusFor([after], BENCH).active).toBe(false);
    // The workouts it held: s0 and s1, never s2.
    expect([...painHeldSessionIds(after, [s0, s1, s2])].sort()).toEqual(['s0', 's1']);
  });

  it('a check-in flag holds the check-in’s own workout (started after the answer) and the next one', () => {
    const f = flag('2026-11-02T07:58:00.000Z', { source: 'check_in', checkInId: id(9400) });
    const own = { ...s0, checkInId: id(9400) };
    expect(painHoldOf(f, [own, s1])).toMatchObject({ reportSessionId: 's0', nextSessionId: 's1', lapsedAtUtc: s1.finishedAtUtc });
    expect(withPainHold(f, [own]).status).toBe('active');
    expect(painClearsAfter(f, { startedAtUtc: own.startedAtUtc, checkInId: id(9400) })).toBe(false);
  });

  it('a flag set between workouts (the coach, at home) holds the movement’s next workout only', () => {
    const f = flag('2026-11-03T20:00:00.000Z', { source: 'coach' });
    expect(painHoldOf(f, [s0, s1])).toMatchObject({ reportSessionId: null, nextSessionId: 's1' });
    expect(withPainHold(f, [s0, s1]).status).toBe('cleared');
    expect(withPainHold(f, [s0, inProgress(s1)]).status).toBe('active');
  });

  it('pain reported again makes a new flag with its own hold', () => {
    const first = withPainHold(flag(REPORTED), [s0, s1]);
    const again = flag('2026-11-08T08:20:00.000Z', { id: id(9301) });
    expect(first.status).toBe('cleared');
    expect(withPainHold(again, [s0, s1, inProgress(s2)]).status).toBe('active');
    expect(painStatusFor([first, withPainHold(again, [s0, s1, s2])], BENCH).active).toBe(true);
    const held = painHeldSessions([first, again], () => [s0, s1, s2]);
    expect([...(held.get(BENCH) ?? [])].sort()).toEqual(['s0', 's1', 's2']);
  });

  it('Ben can still clear it early: cleared at once, and only the workouts before the clear were held', () => {
    const f = flag(REPORTED);
    const cleared = clearPainFlag(f, z('2026-11-03T10:00:00.000Z'));
    expect(cleared.status).toBe('cleared');
    expect(withPainHold(cleared, [s0, s1])).toBe(cleared);
    expect([...painHeldSessionIds(cleared, [s0, s1])]).toEqual(['s0']);
  });

  it('a flag stored before 8 Nov whose movement has been done once since reads as cleared (no migration)', () => {
    const old = flag('2026-10-01T10:00:00.000Z');
    expect(withPainHold(old, [s0]).status).toBe('cleared');
    expect(withPainHold(old, []).status).toBe('active');
  });

  it('a retracted flag held nothing', () => {
    expect(painHeldSessionIds({ ...flag(REPORTED), status: 'retracted' }, [s0, s1]).size).toBe(0);
  });
});

describe('stalls skip only the workouts a flag held', () => {
  const rule = doubleProgression({ repRange: { min: 8, max: 10 }, workingSets: 3, failuresBeforeReduce: 2 });
  const session = (n: number, at: string, reps: number, held = false): HistorySession => ({
    sessionId: id(n),
    performedAtUtc: at,
    equipmentId: null,
    gymId: null,
    imported: false,
    sets: [0, 1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(100, 'total'), reps, rpe: 8, rir: null })),
    ...(held ? { painHeld: true as const } : {}),
  });
  const input = (history: HistorySession[]) => ({ exerciseName: 'Bench press', measurement: 'reps' as const, history, rule, equipment: null, unit: 'kg' as const, convention: 'total' as const, pain: { active: false, reportedAtUtc: null } });

  it('two held workouts below the range are not a miss stall; unheld they are', () => {
    const history = [session(1, '2026-10-20T08:00:00.000Z', 9), session(2, '2026-10-27T08:00:00.000Z', 5), session(3, '2026-11-05T08:00:00.000Z', 5)];
    expect(calculateNextTargets(input(history)).stalled).toBe(true);
    const held = [history[0] as HistorySession, session(2, '2026-10-27T08:00:00.000Z', 5, true), session(3, '2026-11-05T08:00:00.000Z', 5, true)];
    const r = calculateNextTargets(input(held));
    expect(r.stalled).toBeUndefined();
    expect(r.decision).toBe('hold');
    // The held workout is still the load reference: nothing plans above it.
    expect(r.sets[0]?.load?.value).toBe(100);
  });

  it('a miss after the hold counts with the misses before it, reading past the held workouts', () => {
    const history = [session(1, '2026-10-13T08:00:00.000Z', 5), session(2, '2026-10-27T08:00:00.000Z', 5, true), session(3, '2026-11-05T08:00:00.000Z', 5)];
    expect(calculateNextTargets(input(history)).stalled).toBe(true);
  });
});
