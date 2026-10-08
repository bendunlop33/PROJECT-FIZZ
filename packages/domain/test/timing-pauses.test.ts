import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { getActiveDurationMs, reduceSession } from '../src/index';
import { at, kg, ms, values } from './fixtures';
import { apply, BENCH, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

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
    const r = expectOk(reduceSession(s, { type: 'discard', at: at(30 * MIN), opId: 'd', expectedVersion: s.session.version }));
    expect(r.state.session).toMatchObject({ pause: null, pauses: [{ startUtc: at(20 * MIN).utc, endUtc: at(30 * MIN).utc }] });
  });
});
