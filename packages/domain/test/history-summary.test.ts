import { describe, expect, it } from 'vitest';
import {
  addedRowIdsOf,
  deriveId,
  extraCopies,
  HISTORY_SUMMARY_FORMAT,
  historySummaryOf,
  historyVersionOf,
  sameHistorySummary,
  sortNewestFirst,
  stableStringify,
  toHistorySessions,
  toHistoryWorkout,
  toMs,
  type RefSession,
} from '../src/index';
import { richFinishedSession } from './repository-contract';

/** (ADR 0032, Ben-approved 24 Oct) The pure side of the stored history summary. */

describe('historySummaryOf', () => {
  const rich = richFinishedSession();

  it('a finished workout: the workout as history reads it, and each exercise’s progression history', () => {
    const s = historySummaryOf(rich);
    if (s === null) throw new Error('none');
    expect(s.format).toBe(HISTORY_SUMMARY_FORMAT);
    expect(s.workout).toEqual(toHistoryWorkout(rich));
    for (const e of rich.exercises) expect(s.lifts[e.exerciseId]).toEqual(toHistorySessions(rich, e.exerciseId, { identity: true }));
    // Read back from JSON (as stored), it is the same summary.
    expect(sameHistorySummary(JSON.parse(JSON.stringify(s)) as typeof s, s)).toBe(true);
  });

  it('only workouts in history have one', () => {
    for (const status of ['active', 'discarded', 'reverted'] as const) expect(historySummaryOf({ ...rich, session: { ...rich.session, status } })).toBeNull();
  });

  it('a summary reads like the workout: progression history and copies are the same from either', () => {
    const w = toHistoryWorkout(rich);
    const id = rich.exercises[0]?.exerciseId ?? '';
    expect(toHistorySessions(w, id, { identity: true })).toEqual(toHistorySessions(rich, id, { identity: true }));
    expect(extraCopies(w, rich.exercises, true)).toEqual(extraCopies(rich, rich.exercises, true));
  });

  it('rows added after planning come from the add_exercise operations, in order', () => {
    const ops = {
      a: { opId: 'a', commandType: 'add_exercise', fingerprint: 'x', atUtc: rich.session.startedAt.utc, createdIds: ['r1', 's1'] },
      b: { opId: 'b', commandType: 'log_set', fingerprint: 'y', atUtc: rich.session.startedAt.utc, createdIds: ['z'] },
      c: { opId: 'c', commandType: 'add_exercise', fingerprint: 'z', atUtc: rich.session.startedAt.utc, createdIds: ['r2'] },
    };
    expect(addedRowIdsOf({ processedOps: ops })).toEqual(['r1', 's1', 'r2']);
    expect(addedRowIdsOf({ addedRowIds: ['q'], processedOps: ops })).toEqual(['q']);
    expect(toHistoryWorkout({ ...rich, processedOps: ops }).addedRowIds).toEqual(['r1', 's1', 'r2']);
  });

  it('two summaries differing in one value are not the same', () => {
    const s = historySummaryOf(rich);
    if (s === null) throw new Error('none');
    const other = { ...s, workout: { ...s.workout, revision: s.workout.revision + 1 } };
    expect(sameHistorySummary(s, other)).toBe(false);
    expect(sameHistorySummary(null, null)).toBe(true);
    expect(sameHistorySummary(s, null)).toBe(false);
  });
});

describe('perf helpers keep their results (24 Oct)', () => {
  it('sortNewestFirst: newest first, equal times keep their order', () => {
    const xs = [
      { t: '2026-10-01T10:00:00.000Z', n: 1 },
      { t: '2026-10-03T10:00:00.000Z', n: 2 },
      { t: '2026-10-01T10:00:00.000Z', n: 3 },
      { t: '2026-10-02T10:00:00.000Z', n: 4 },
    ];
    expect(sortNewestFirst(xs, (x) => x.t).map((x) => x.n)).toEqual([2, 4, 1, 3]);
    expect(xs.map((x) => x.n)).toEqual([1, 2, 3, 4]);
  });

  it('toMs: the same parse every time, and still refuses a bad timestamp', () => {
    expect(toMs('2026-10-01T10:00:00.000Z')).toBe(Date.UTC(2026, 9, 1, 10));
    expect(toMs('2026-10-01T10:00:00.000Z')).toBe(Date.UTC(2026, 9, 1, 10));
    expect(() => toMs('not a time')).toThrow(RangeError);
    expect(() => toMs('not a time')).toThrow(RangeError);
  });

  it('historyVersionOf is the same text as before (stored versions still match)', () => {
    const sessions: RefSession[] = [
      { sessionId: 's1', performedAtUtc: '2026-10-01T10:00:00.000Z', tz: 'UTC', source: 'app', sets: [{ value: 100, reps: 5, rpe: 8 }, { value: 102.5, reps: 3, rpe: null }], top: { value: 102.5, reps: 3, rpe: null } },
      { sessionId: 's2', performedAtUtc: '2026-09-28T10:00:00.000Z', tz: 'UTC', source: 'fitnotes', sets: [{ value: -20, reps: 8, rpe: 9.5 }], top: { value: -20, reps: 8, rpe: 9.5 } },
    ];
    const before = deriveId(`builder-history:${stableStringify(sessions.map((s) => [s.sessionId, s.performedAtUtc, s.sets.map((x) => [x.value, x.reps, x.rpe])]))}`);
    expect(historyVersionOf(sessions)).toBe(before);
    expect(historyVersionOf([])).toBe(deriveId(`builder-history:${stableStringify([])}`));
  });
});
