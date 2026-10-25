import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, UpdateSessionTimingCommandSchema, type SessionAggregate, type SessionCommand, type ZonedTimestamp } from '@fizz/schemas';
import {
  asPastLog,
  buildActiveSetView,
  buildLockScreenContent,
  buildWorkoutSummary,
  createMemoryRepositories,
  createSessionService,
  EARLIEST_WORKOUT_MS,
  getActiveDurationMs,
  latestHappenedMs,
  localDateOf,
  localTimeUtcMs,
  moveWorkoutTimes,
  paceSamplesOf,
  PAST_LOG_SET_SPACING_MS,
  pastLogDefaultEnd,
  pastLogDefaultStart,
  pastLogStartRefusal,
  reduceSession,
  shiftSessionTimes,
  shiftTimeBounds,
  summaryTimeline,
  timelineOf,
  timingUndoCommand,
  toHistorySessions,
  toIso,
  toMs,
  unshiftedMs,
  type HistorySession,
} from '../src/index';
import { at, barbell, GYM, id, idGen, kg, ms, OWNER, profile, stack, TZ, values } from './fixtures';
import { apply, BENCH, exercises, expectError, expectOk, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 25 Oct) "I should be able to freely edit times, e.g. if I want to import a workout
 * historically from the day before or beyond." Moving the start moves the whole workout (sets,
 * pauses, timers by the same offset); `Log a past workout` runs no clock.
 */

const MIN = 60;
const DAY = 24 * 3600;
const z = (utcMs: number, tz = TZ): ZonedTimestamp => ({ utc: toIso(utcMs), tz });

/** Warm-up at +10 min, B1 at +14, a 3-minute pause from +20, B2 at +30, finished at +40. */
function finishedWorkout(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1, b2] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10 * MIN));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 14 * MIN));
  s = apply(s, { type: 'pause', at: at(20 * MIN), opId: 'p1' });
  s = apply(s, { type: 'resume', at: at(23 * MIN), opId: 'r1' });
  s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 7), 30 * MIN));
  return apply(s, { type: 'finish', at: at(40 * MIN), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

const shiftCmd = (s: SessionAggregate, nowS: number, startMs: number, endMs: number | null, opId = 'shift-1'): SessionCommand => ({
  type: 'update_session_timing',
  at: at(nowS),
  opId,
  expectedVersion: s.session.version,
  startedAt: z(startMs),
  endedAt: endMs === null ? null : z(endMs),
  shift: true,
});

const doneTimes = (s: SessionAggregate) => s.sets.filter((x) => x.status === 'completed').map((x) => toMs(x.completedAt?.utc ?? ''));
const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - (xs[i] ?? 0));

describe('shiftSessionTimes', () => {
  it('moves every time on the timeline by the same offset; values, versions and edit times stay', () => {
    const s = finishedWorkout();
    const off = -7 * DAY * 1000;
    const moved = shiftSessionTimes(s, off);
    expect(toMs(moved.session.startedAt.utc)).toBe(ms(0) + off);
    expect(toMs(moved.session.endedAt?.utc ?? '')).toBe(ms(40 * MIN) + off);
    expect(doneTimes(moved)).toEqual(doneTimes(s).map((t) => t + off));
    expect(moved.session.pauses).toEqual([{ startUtc: toIso(ms(20 * MIN) + off), endUtc: toIso(ms(23 * MIN) + off) }]);
    if (s.restTimer && moved.restTimer) expect(toMs(moved.restTimer.startedAtUtc)).toBe(toMs(s.restTimer.startedAtUtc) + off);
    // Logged values and set versions never change; audits and the last activity are when Ben did things.
    expect(moved.sets.map((x) => [x.actual, x.version, x.status])).toEqual(s.sets.map((x) => [x.actual, x.version, x.status]));
    expect(moved.audit).toEqual(s.audit);
    expect(moved.session.lastActivityAtUtc).toBe(s.session.lastActivityAtUtc);
    expect(getActiveDurationMs(moved, ms(0))).toBe(getActiveDurationMs(s, ms(0)));
    expect(SessionAggregateSchema.safeParse(moved).success).toBe(true);
    expect(shiftSessionTimes(s, 0)).toBe(s);
  });
});

describe('update_session_timing with shift (a finished workout)', () => {
  it('a week back: every set, the pause and the end move with the start; audited with the offset; originals recoverable', () => {
    const s = finishedWorkout();
    const now = 2 * DAY;
    const back = ms(0) - 7 * DAY * 1000;
    const r = expectOk(reduceSession(s, shiftCmd(s, now, back, null)));
    const t = r.state;
    expect(toMs(t.session.startedAt.utc)).toBe(back);
    expect(toMs(t.session.endedAt?.utc ?? '')).toBe(back + 40 * MIN * 1000);
    expect(gaps(doneTimes(t))).toEqual(gaps(doneTimes(s)));
    expect(getActiveDurationMs(t, ms(now))).toBe(getActiveDurationMs(s, ms(now)));
    expect(t.session.version).toBe(s.session.version + 1);
    expect(t.timingAudit.map((e) => [e.field, e.source, e.before?.utc, e.after.utc, e.shiftMs])).toEqual([
      ['startedAt', 'correction', at(0).utc, toIso(back), -7 * DAY * 1000],
      ['endedAt', 'correction', at(40 * MIN).utc, toIso(back + 40 * MIN * 1000), undefined],
    ]);
    // Rule 2: the logged values are untouched.
    expect(t.sets.map((x) => x.actual)).toEqual(s.sets.map((x) => x.actual));
    // Provenance: each set's recorded time is its time now minus the shifts.
    const first = t.sets.find((x) => x.status === 'completed');
    expect(unshiftedMs(first?.completedAt?.utc ?? '', t.timingAudit)).toBe(ms(10 * MIN));
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(t))).success).toBe(true);
  });

  it('the end can be set on its own after the moved last set; before it, in the future or before the start is refused', () => {
    const s = finishedWorkout();
    const back = ms(0) - DAY * 1000;
    const ok = expectOk(reduceSession(s, shiftCmd(s, 2 * DAY, back, back + 50 * MIN * 1000)));
    expect(toMs(ok.state.session.endedAt?.utc ?? '')).toBe(back + 50 * MIN * 1000);
    expectError(reduceSession(s, shiftCmd(s, 2 * DAY, back, back + 29 * MIN * 1000)), 'invalid_time');
    expectError(reduceSession(s, shiftCmd(s, 2 * DAY, back, ms(3 * DAY))), 'invalid_time');
  });

  it('nothing may move into the future: a start ahead of now, or sets pushed past now, is refused; before 2000 too', () => {
    const s = finishedWorkout();
    // Now is +50 min: moving the start 20 min later puts the last set (+30) at +50 min… and the end at +60.
    expectError(reduceSession(s, shiftCmd(s, 45 * MIN, ms(20 * MIN), null)), 'invalid_time');
    expectError(reduceSession(s, shiftCmd(s, 50 * MIN, ms(60 * MIN), null)), 'invalid_time');
    expectError(reduceSession(s, shiftCmd(s, 50 * MIN, EARLIEST_WORKOUT_MS - 60_000, null)), 'invalid_time');
    // Forward by 5 min with now at +2 h is fine.
    expect(reduceSession(s, shiftCmd(s, 2 * 3600, ms(5 * MIN), null)).ok).toBe(true);
  });

  it('Undo is the same shift back with a new op: the times are as logged again, and both moves stay in the audit', () => {
    const s = finishedWorkout();
    const moved = apply(s, shiftCmd(s, 2 * DAY, ms(0) - 3 * DAY * 1000, null, 'shift-a'));
    const undone = apply(moved, shiftCmd(moved, 2 * DAY + 5, ms(0), toMs(s.session.endedAt?.utc ?? ''), 'undo-shift-a'));
    expect(undone.session.startedAt.utc).toBe(s.session.startedAt.utc);
    expect(undone.session.endedAt?.utc).toBe(s.session.endedAt?.utc);
    expect(doneTimes(undone)).toEqual(doneTimes(s));
    expect(undone.session.pauses).toEqual(s.session.pauses);
    expect(undone.timingAudit.filter((e) => e.shiftMs !== undefined).map((e) => e.shiftMs)).toEqual([-3 * DAY * 1000, 3 * DAY * 1000]);
    expect(unshiftedMs(undone.session.startedAt.utc, undone.timingAudit)).toBe(ms(0));
  });

  it('a retry with the same op is a duplicate (no second move); a reused op with another intent and a stale version are refused', () => {
    const s = finishedWorkout();
    const cmd = shiftCmd(s, 2 * DAY, ms(0) - DAY * 1000, null);
    const once = apply(s, cmd);
    const again = expectOk(reduceSession(once, { ...cmd, at: at(2 * DAY + 30) }));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(once);
    expectError(reduceSession(once, shiftCmd(s, 2 * DAY, ms(0) - 2 * DAY * 1000, null)), 'operation_id_reused');
    // The version the sheet opened on is gone after the move.
    expectError(reduceSession(once, shiftCmd(s, 2 * DAY, ms(0) - 2 * DAY * 1000, null, 'shift-2')), 'stale_version');
  });

  it('a live workout can’t move while it runs; the command needs a start', () => {
    let s = startFixture().state;
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10 * MIN));
    expectError(reduceSession(s, shiftCmd(s, 20 * MIN, ms(-DAY), null)), 'invalid_time');
    expect(UpdateSessionTimingCommandSchema.safeParse({ type: 'update_session_timing', at: at(0), opId: 'x', expectedVersion: 1, startedAt: null, endedAt: at(5), shift: true }).success).toBe(false);
  });

  it('without shift the 19 Oct rule still holds: the start alone, not after the first set', () => {
    const s = finishedWorkout();
    expectError(
      reduceSession(s, { type: 'update_session_timing', at: at(DAY), opId: 'plain', expectedVersion: s.session.version, startedAt: at(11 * MIN), endedAt: null }),
      'invalid_time',
    );
  });

  it('DST: moved from 8 Oct (NZDT) to 20 Sep (NZST) at 19:00 local, durations stay to the millisecond', () => {
    const s = finishedWorkout();
    const target = localTimeUtcMs('2026-09-20', 19, 0, TZ);
    const t = apply(s, shiftCmd(s, 2 * DAY, target, null));
    expect(localDateOf(toMs(t.session.startedAt.utc), TZ)).toBe('2026-09-20');
    expect(gaps(doneTimes(t))).toEqual(gaps(doneTimes(s)));
    expect(toMs(t.session.endedAt?.utc ?? '') - toMs(t.session.startedAt.utc)).toBe(40 * MIN * 1000);
    // The offset is 18 days less an hour: NZ clocks went forward on 27 Sep, so 19:00 NZST is 07:00 UTC, 19:00 NZDT 06:00.
    expect(t.timingAudit[0]?.shiftMs).toBe(target - ms(0));
    expect(ms(0) - target).toBe((18 * DAY - 3600) * 1000);
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(toMs(t.session.startedAt.utc))).toBe('19:00');
  });
});

describe('finish with shift', () => {
  it('a live workout finished as the day before: everything moves back, the chosen end is kept, the tap time is in the audit', () => {
    let s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10 * MIN));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 14 * MIN));
    s = apply(s, { type: 'pause', at: at(16 * MIN), opId: 'p' });
    const back = ms(0) - DAY * 1000;
    const r = expectOk(
      reduceSession(s, { type: 'finish', at: at(30 * MIN), opId: 'fin-shift', expectedVersion: s.session.version, endedAt: z(back + 25 * MIN * 1000), startedAt: z(back), shift: true }),
    );
    const f = r.state;
    expect(f.session.status).toBe('finished');
    expect(toMs(f.session.startedAt.utc)).toBe(back);
    expect(toMs(f.session.endedAt?.utc ?? '')).toBe(back + 25 * MIN * 1000);
    expect(doneTimes(f)).toEqual(doneTimes(s).map((t) => t - DAY * 1000));
    // The open pause closed at the tap time, then moved with the rest.
    expect(f.session.pauses).toEqual([{ startUtc: toIso(ms(16 * MIN) - DAY * 1000), endUtc: toIso(ms(30 * MIN) - DAY * 1000) }]);
    expect(f.timingAudit.map((e) => [e.field, e.source, e.shiftMs])).toEqual([
      ['startedAt', 'finish', -DAY * 1000],
      ['endedAt', 'finish', undefined],
    ]);
    expect(f.timingAudit[1]?.before?.utc).toBe(at(30 * MIN).utc);
    expect(f.session.version).toBe(s.session.version + 1);
    expect(latestHappenedMs(f)).toBeLessThanOrEqual(ms(30 * MIN));
  });

  it('an end before the moved last set is refused and nothing is finished', () => {
    let s = startFixture().state;
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10 * MIN));
    const back = ms(0) - DAY * 1000;
    const r = reduceSession(s, { type: 'finish', at: at(30 * MIN), opId: 'f', expectedVersion: s.session.version, endedAt: z(back + 5 * MIN * 1000), startedAt: z(back), shift: true });
    expectError(r, 'invalid_time');
    expect(r.state.session.status).toBe('active');
  });
});

describe('a past log (`Log a past workout`)', () => {
  const yesterday = ms(0) - DAY * 1000;
  function pastLog(): SessionAggregate {
    return asPastLog(startFixture().state, z(yesterday), at(0));
  }

  it('ticked sets take placeholder times in tick order from the start; no rest, no timers, no pause, no Live Activity', () => {
    let s = pastLog();
    const [w, b1] = setsFor(s, BENCH);
    const [r1] = setsFor(s, ROW);
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 10));
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 20));
    s = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 12), 30));
    const times = [b1, w, r1].map((x) => toMs(s.sets.find((y) => y.id === x?.id)?.completedAt?.utc ?? ''));
    expect(times).toEqual([1, 2, 3].map((n) => yesterday + n * PAST_LOG_SET_SPACING_MS));
    expect(s.sets.find((x) => x.id === b1?.id)?.completedAt?.tz).toBe(TZ);
    expect(s.restTimer).toBeNull();
    expectError(reduceSession(s, { type: 'pause', at: at(40), opId: 'p' }), 'past_log_no_clock');
    expect(buildLockScreenContent(s, ms(40), TZ)).toBeNull();
    expect(paceSamplesOf(s, ms(40))).toEqual({ set: [], changeover: [] });
  });

  it('untick and tick again: the set goes after the others; Finish takes the chosen end; the start can move (it is a past log)', () => {
    let s = pastLog();
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10, 'l1'));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 20, 'l2'));
    s = apply(s, { type: 'undo_log', at: at(25), opId: 'u1', setId: b1?.id ?? '', expectedSetVersion: s.sets.find((x) => x.id === b1?.id)?.version ?? 0 });
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 9), 30, 'l3'));
    expect(toMs(s.sets.find((x) => x.id === b1?.id)?.completedAt?.utc ?? '')).toBe(yesterday + 2 * PAST_LOG_SET_SPACING_MS);
    // Moved to two days back before Finish (a past log may move while open).
    s = apply(s, shiftCmd(s, 40, yesterday - DAY * 1000, null, 'mv'));
    const start = toMs(s.session.startedAt.utc);
    const end = pastLogDefaultEnd(start, Math.max(...doneTimes(s)), ms(40));
    expect(end).toBe(start + 60 * MIN * 1000);
    const f = apply(s, { type: 'finish', at: at(50), opId: 'fin', expectedVersion: s.session.version, endedAt: z(end) });
    expect(f.session.status).toBe('finished');
    expect(localDateOf(toMs(f.session.startedAt.utc), TZ)).toBe(localDateOf(yesterday - DAY * 1000, TZ));
    expect(f.session.pastLog).toEqual({ enteredAt: at(0) });
  });

  it('defaults: yesterday at the latest workout’s time of day (5-minute steps), else 18:00; refusals', () => {
    // Now: 8 Oct 19:00 Auckland. Latest workout started 06:47 local.
    const latest = localTimeUtcMs('2026-10-05', 6, 47, TZ);
    expect(pastLogDefaultStart(ms(0), TZ, latest)).toBe(localTimeUtcMs('2026-10-07', 6, 45, TZ));
    expect(pastLogDefaultStart(ms(0), TZ, null)).toBe(localTimeUtcMs('2026-10-07', 18, 0, TZ));
    expect(pastLogStartRefusal(ms(10), ms(0))).toBe('in_future');
    expect(pastLogStartRefusal(EARLIEST_WORKOUT_MS - 1, ms(0))).toBe('too_far_back');
    expect(pastLogStartRefusal(ms(-3 * 365 * DAY), ms(0))).toBeNull();
  });

  it('the session service starts it at the picked time, marks it, reads the deload week for that date, and is idempotent', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
    for (const ex of exercises.values()) await repos.exercises.save(ex, null);
    const routine = startFixture().input.routine;
    if (!routine) throw new Error('fixture');
    await repos.routines.save(routine, null);
    const asked: string[] = [];
    const svc = createSessionService(repos, idGen(), {
      deloadAt: (_o, when) => {
        asked.push(when.utc);
        return Promise.resolve(null);
      },
    });
    const req = { ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'past-1', at: at(0), pastStart: z(yesterday) };
    const r = await svc.startRoutine(req);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.aggregate.session.startedAt.utc).toBe(toIso(yesterday));
    expect(r.aggregate.session.pastLog).toEqual({ enteredAt: at(0) });
    expect(asked).toEqual([toIso(yesterday)]);
    const again = await svc.startRoutine({ ...req, at: at(9) });
    expect(again.ok && again.duplicate).toBe(true);
    // A start in the future is refused, nothing saved.
    const future = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 'past-2', at: at(0), pastStart: at(60) });
    expect(future.ok).toBe(false);
  });
});

describe('the wheels when the start moves the whole workout', () => {
  const s = finishedWorkout();
  const t = timelineOf(s);
  const now = ms(2 * DAY);
  const times = { startMs: ms(0), endMs: ms(40 * MIN) };

  it('any start back to 2000; the latest keeps sets out of the future; the end’s floor moves with the start', () => {
    const b = shiftTimeBounds(t, ms(0) - 5 * DAY * 1000, now);
    expect(b.startMinMs).toBe(EARLIEST_WORKOUT_MS);
    expect(b.startMaxMs).toBe(ms(0) + now - ms(30 * MIN));
    expect(b.endMinMs).toBe(ms(30 * MIN) - 5 * DAY * 1000);
    expect(b.endMaxMs).toBe(now);
  });

  it('moving the start several days back keeps the duration; moving the end changes only the end', () => {
    const back = moveWorkoutTimes('start', ms(0) - 4 * DAY * 1000, times, t, now);
    expect(back).toEqual({ startMs: ms(0) - 4 * DAY * 1000, endMs: ms(40 * MIN) - 4 * DAY * 1000, note: null });
    const end = moveWorkoutTimes('end', back.startMs + 55 * MIN * 1000, back, t, now);
    expect(end).toEqual({ startMs: back.startMs, endMs: back.startMs + 55 * MIN * 1000, note: null });
    const early = moveWorkoutTimes('end', back.startMs + 20 * MIN * 1000, back, t, now);
    expect(early).toMatchObject({ endMs: back.startMs + 30 * MIN * 1000, note: 'end_before_last_set' });
  });

  it('a start pushed past what the sets allow is clamped with a note; before 2000 too', () => {
    const late = moveWorkoutTimes('start', now, times, t, now);
    expect(late.startMs).toBe(ms(0) + now - ms(30 * MIN));
    expect(late.note).toBe('sets_in_future');
    expect(late.endMs).toBe(now);
    expect(moveWorkoutTimes('start', EARLIEST_WORKOUT_MS - DAY * 1000, times, t, now)).toMatchObject({ startMs: EARLIEST_WORKOUT_MS, note: 'start_too_far_back' });
  });

  it('nothing logged: the start can go until a minute before now', () => {
    const empty = timelineOf(startFixture().state);
    expect(shiftTimeBounds(empty, ms(0), ms(600)).startMaxMs).toBe(ms(540));
    expect(moveWorkoutTimes('start', ms(900), { startMs: ms(0), endMs: ms(300) }, empty, ms(600)).note).toBe('start_in_future');
  });
});

describe('Summary of a workout dated before newer ones (Ben, 25 Oct)', () => {
  const bar = barbell();
  const session = (sid: number, atS: number, load: number): HistorySession => ({
    sessionId: id(sid),
    performedAtUtc: at(atS).utc,
    equipmentId: bar.id,
    gymId: GYM,
    imported: false,
    sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(load), reps: 8, rpe: 8, rir: null })),
  });

  function summaryOf(history: HistorySession[]) {
    let s = startFixture().state;
    const [w, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 5 * MIN));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 10 * MIN));
    s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 8), 15 * MIN));
    s = apply(s, { type: 'finish', at: at(20 * MIN), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const own = toHistorySessions(s, BENCH);
    const sum = buildWorkoutSummary({ aggregate: s, nowMs: ms(3 * DAY), gymName: 'Main Gym', history: { [BENCH]: [...history, ...own] }, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    return { s, sum };
  }

  it('compares with the workout before it, and gives no Next time where the exercise was done again since', () => {
    const before = session(601, -7 * DAY, 95);
    const newer = session(602, DAY, 120);
    const alone = summaryOf([before]).sum;
    expect(alone.nextTime).not.toBeNull();
    const { sum } = summaryOf([before, newer]);
    expect(sum.comparison).toMatchObject({ kind: 'compared', lastAtUtc: before.performedAtUtc });
    expect(sum.nextTime).toBeNull();
    // Records and the highlight are read as of its date: the newer 120 kg doesn't hide today's best.
    expect(sum.records).toEqual(alone.records);
    expect(sum.highlight).toEqual(alone.highlight);
  });

  it('carries the timeline the wheels move from, and whether it was a past log', () => {
    const { s, sum } = summaryOf([]);
    expect(sum.timeline).toEqual({ lastSetUtc: at(15 * MIN).utc, latestUtc: at(15 * MIN).utc });
    expect(sum.pastLog).toBe(false);
    expect(timelineOf(s)).toEqual(summaryTimeline(sum.startedAtUtc, sum.timeline));
  });
});

describe('timingUndoCommand', () => {
  it('a whole-workout move undoes as a move back, from the audit; an end alone as the end; nothing: null', () => {
    const s = finishedWorkout();
    const moved = apply(s, shiftCmd(s, 2 * DAY, ms(0) - 2 * DAY * 1000, ms(0) - 2 * DAY * 1000 + 50 * MIN * 1000, 'mv'));
    const undo = timingUndoCommand(moved, 'mv', 'undo-mv', at(2 * DAY + 1));
    expect(undo).toMatchObject({ startedAt: s.session.startedAt, endedAt: s.session.endedAt, shift: true, expectedVersion: moved.session.version });
    if (!undo) throw new Error('no undo');
    const back = apply(moved, undo);
    expect(doneTimes(back)).toEqual(doneTimes(s));
    expect(back.session.endedAt).toEqual(s.session.endedAt);
    // Once something else changed the workout, the Undo is stale.
    const later = apply(moved, { type: 'update_session_timing', at: at(2 * DAY + 2), opId: 'end2', expectedVersion: moved.session.version, startedAt: null, endedAt: z(toMs(moved.session.endedAt?.utc ?? '') + 60_000) });
    expectError(reduceSession(later, undo), 'stale_version');
    const endOnly = apply(s, { type: 'update_session_timing', at: at(DAY), opId: 'e', expectedVersion: s.session.version, startedAt: null, endedAt: at(45 * MIN) });
    expect(timingUndoCommand(endOnly, 'e', 'u', at(DAY + 1))).toMatchObject({ startedAt: null, endedAt: s.session.endedAt });
    expect(timingUndoCommand(s, 'nothing', 'u', at(DAY))).toBeNull();
  });
});

describe('the workout view of a past log', () => {
  it('a timed set has no Start/Stop (the time is typed), and there is no Time left', () => {
    let s = asPastLog(startFixture().state, z(ms(0) - DAY * 1000), at(0));
    const hang = setsFor(s, HANG)[0];
    s = apply(s, { type: 'set_active_set', at: at(5), opId: 'focus-hang', setId: hang?.id ?? '', expectedVersion: s.session.version });
    const view = buildActiveSetView({ aggregate: s, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
    expect(view.focus?.workTimer).toBeNull();
    expect(['log', 'enter']).toContain(view.primary.kind);
    expect(view.timeLeft).toBeNull();
    expectError(reduceSession(s, { type: 'start_work_interval', at: at(20), opId: 'w', setId: hang?.id ?? '', durationS: 45 }), 'past_log_no_clock');
  });
});
