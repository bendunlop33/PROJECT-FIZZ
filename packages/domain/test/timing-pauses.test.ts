import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { getActiveDurationMs, reduceSession } from '../src/index';
import { at, kg, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, HANG, logCmd, setsFor, startFixture } from './session-fixture';

const MIN = 60;
const minutes = (m: number) => m * 60_000;

/** Warm-up logged at `lastSetMin`; returns the state. */
function withSetAt(lastSetMin: number): SessionAggregate {
  const { state } = startFixture();
  const w = setsFor(state, BENCH)[0];
  if (!w) throw new Error('fixture');
  return apply(state, logCmd(w.id, values(kg(60), 10), lastSetMin * MIN));
}

const finish = (s: SessionAggregate, tapMin: number, endedAtMin: number | null, opId = 'f') =>
  apply(s, { type: 'finish', at: at(tapMin * MIN), opId, expectedVersion: s.session.version, endedAt: endedAtMin === null ? null : at(endedAtMin * MIN) });

const editTimes = (s: SessionAggregate, nowMin: number, startedAtMin: number | null, endedAtMin: number | null, opId = 't') =>
  apply(s, {
    type: 'update_session_timing',
    at: at(nowMin * MIN),
    opId,
    expectedVersion: s.session.version,
    startedAt: startedAtMin === null ? null : at(startedAtMin * MIN),
    endedAt: endedAtMin === null ? null : at(endedAtMin * MIN),
  });

const duration = (s: SessionAggregate) => getActiveDurationMs(s, ms(24 * 3600));

describe('duration counts only pauses inside the start→end window (review R1, ADR 0003)', () => {
  it("reviewer's probe: last set 60 min, Pause 61, Finish tapped at 5 h, end edited to 63 → 61 min active", () => {
    let s = withSetAt(60);
    s = apply(s, { type: 'pause', at: at(61 * MIN), opId: 'p' });
    s = finish(s, 300, null);
    expect(duration(s)).toBe(minutes(61)); // 300 min wall − 239 min paused
    s = editTimes(s, 301, null, 63);
    // Window [0, 63]: only 61→63 of the pause overlaps, so 63 − 2 = 61 min.
    // (Before the fix this was 0. The review text says 62; 63 − 2 is 61.)
    expect(duration(s)).toBe(minutes(61));
    expect(duration(s)).toBeGreaterThan(0);
  });

  it('the stored pause is the original, unclipped; the tap time stays in the timing audit', () => {
    let s = withSetAt(60);
    s = apply(s, { type: 'pause', at: at(61 * MIN), opId: 'p' });
    s = finish(s, 300, null);
    s = editTimes(s, 301, null, 63);
    expect(s.session.pauses).toEqual([{ startUtc: at(61 * MIN).utc, endUtc: at(300 * MIN).utc }]);
    expect(s.timingAudit.map((e) => [e.field, e.before?.utc, e.after.utc])).toEqual([['endedAt', at(300 * MIN).utc, at(63 * MIN).utc]]);
    // Moving the end back out to 5 h restores the original 61 min: nothing was lost.
    s = editTimes(s, 302, null, 300, 't2');
    expect(duration(s)).toBe(minutes(61));
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it('finish-sheet time after a Resume: pause 61→181, Finish with end 63 → 61 min', () => {
    let s = withSetAt(60);
    s = apply(s, { type: 'pause', at: at(61 * MIN), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(181 * MIN), opId: 'r' });
    s = finish(s, 200, 63);
    expect(duration(s)).toBe(minutes(61));
  });

  it('finish chosen before the pause began: the pause is ignored entirely', () => {
    let s = withSetAt(60);
    s = apply(s, { type: 'pause', at: at(70 * MIN), opId: 'p' });
    s = finish(s, 300, 62);
    expect(s.session.pauses).toEqual([{ startUtc: at(70 * MIN).utc, endUtc: at(300 * MIN).utc }]);
    expect(duration(s)).toBe(minutes(62));
  });

  it('finish while paused with no chosen end: the open pause counts up to the tap time', () => {
    let s = withSetAt(60);
    s = apply(s, { type: 'pause', at: at(61 * MIN), opId: 'p' });
    expect(getActiveDurationMs(s, ms(100 * MIN))).toBe(minutes(61));
    s = finish(s, 100, null);
    expect(duration(s)).toBe(minutes(61));
  });

  it('start-time correction: started at home, paused an hour, start edited to arrival → the hour is not subtracted', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'pause', at: at(5 * MIN), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(65 * MIN), opId: 'r' });
    const w = setsFor(s, BENCH)[0];
    if (!w) throw new Error('fixture');
    s = apply(s, logCmd(w.id, values(kg(60), 10), 70 * MIN));
    s = finish(s, 120, null);
    expect(duration(s)).toBe(minutes(60)); // 120 − 60 paused
    const arrived = editTimes(s, 130, 65, null);
    expect(duration(arrived)).toBe(minutes(55)); // was 0 before the fix (120 − 65 − 60)
  });

  it('a start correction inside a pause clips it', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'pause', at: at(5 * MIN), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(65 * MIN), opId: 'r' });
    const w = setsFor(s, BENCH)[0];
    if (!w) throw new Error('fixture');
    s = apply(s, logCmd(w.id, values(kg(60), 10), 70 * MIN));
    s = finish(s, 120, null);
    expect(duration(editTimes(s, 130, 30, null))).toBe(minutes(120 - 30 - 35));
  });

  it('several pauses: only those inside the window count', () => {
    let s = withSetAt(10);
    s = apply(s, { type: 'pause', at: at(20 * MIN), opId: 'p1' });
    s = apply(s, { type: 'resume', at: at(25 * MIN), opId: 'r1' });
    s = apply(s, { type: 'pause', at: at(40 * MIN), opId: 'p2' });
    s = apply(s, { type: 'resume', at: at(50 * MIN), opId: 'r2' });
    s = apply(s, { type: 'pause', at: at(70 * MIN), opId: 'p3' });
    s = finish(s, 200, null);
    expect(s.session.pauses).toHaveLength(3);
    expect(duration(s)).toBe(minutes(200 - 5 - 10 - 130));
    expect(duration(editTimes(s, 201, null, 45))).toBe(minutes(45 - 5 - 5));
  });

  it('discard closes an open pause so the record stays consistent', () => {
    let s = withSetAt(10);
    s = apply(s, { type: 'pause', at: at(20 * MIN), opId: 'p' });
    const r = expectOk(reduceSession(s, { type: 'discard', at: at(30 * MIN), opId: 'd', expectedVersion: s.session.version, confirmedLoggedSets: 1 }));
    expect(r.state.session).toMatchObject({ pause: null, pauses: [{ startUtc: at(20 * MIN).utc, endUtc: at(30 * MIN).utc }] });
  });
});

describe('Stop while paused (review R2, ADR 0003)', () => {
  const startHang = () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    return { s: apply(state, { type: 'start_work_interval', at: at(10), opId: 'w', setId: hang.id, durationS: 45 }), hangId: hang.id };
  };

  it('stale card: paused session + paused interval → Stop → Finish completes; paused time is not work', () => {
    const { s: started, hangId } = startHang();
    let s = apply(started, { type: 'pause', at: at(30), opId: 'p' });
    const v = s.session.version;
    expectError(reduceSession(s, { type: 'finish', at: at(7200), opId: 'f', expectedVersion: v, endedAt: null }), 'work_interval_running');
    const stopped = expectOk(reduceSession(s, { type: 'stop_work_interval', at: at(7200), opId: 'stop', setId: hangId }));
    expect(stopped.events).toEqual([{ type: 'WorkIntervalEnded', setId: hangId, reason: 'stopped', elapsedS: 20, lateByMs: 0 }]);
    s = stopped.state;
    expect(s.workInterval).toMatchObject({ status: 'stopped', endedAtUtc: at(30).utc, remainingMsAtPause: null });
    expect(s.session.pause).not.toBeNull(); // Stop doesn't resume the workout
    s = apply(s, { type: 'finish', at: at(7200), opId: 'f', expectedVersion: v, endedAt: null });
    expect(s.session.status).toBe('finished');
    expect(s.sets.find((x) => x.id === hangId)).toMatchObject({ status: 'skipped', actual: null, draft: { durationS: 20 } });
  });

  it('earlier pauses inside the interval are excluded too', () => {
    const { s: started, hangId } = startHang();
    let s = apply(started, { type: 'pause', at: at(20), opId: 'p1' });
    s = apply(s, { type: 'resume', at: at(50), opId: 'r1' }); // 30 s paused
    s = apply(s, { type: 'pause', at: at(60), opId: 'p2' });
    s = apply(s, { type: 'stop_work_interval', at: at(900), opId: 'stop', setId: hangId });
    expect(s.sets.find((x) => x.id === hangId)?.draft?.durationS).toBe(20); // 60 − 10 − 30
  });

  it('after Stop, Resume does not restart the interval', () => {
    const { s: started, hangId } = startHang();
    let s = apply(started, { type: 'pause', at: at(30), opId: 'p' });
    s = apply(s, { type: 'stop_work_interval', at: at(100), opId: 'stop', setId: hangId });
    s = apply(s, { type: 'resume', at: at(110), opId: 'r' });
    expect(s.workInterval?.status).toBe('stopped');
    expect(apply(s, { type: 'tick', at: at(500) }).sets.find((x) => x.id === hangId)?.draft?.durationS).toBe(20);
  });

  it('Stop while paused with no interval for that set is still refused', () => {
    const { state } = startFixture();
    const s = apply(state, { type: 'pause', at: at(5), opId: 'p' });
    expectError(reduceSession(s, { type: 'stop_work_interval', at: at(6), opId: 'stop', setId: setsFor(s, HANG)[0]?.id ?? '' }), 'work_interval_not_running');
  });
});
