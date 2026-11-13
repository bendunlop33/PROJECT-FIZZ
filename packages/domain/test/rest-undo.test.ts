import { describe, expect, it } from 'vitest';
import { MAX_FINISHED_RESUMABLE_DEPTH, MAX_RESUMABLE_RESTS, ResumableRestSchema, SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { boundResumable, chatSetUndoCommand, getSessionPhase, reduceSession } from '../src/index';
import { at, id, kg, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/*
 * Unticking a set never resets the rest (workout-table-v3 §3; Ben, 20 Oct:
 * "if u accidentally click completed set and then deselect the rest time
 * should continue as it was not reset").
 */

const bench = (s: SessionAggregate) => setsFor(s, BENCH);
const undo = (setId: string, t: number, opId = `u-${setId}-${String(t)}`) => ({ type: 'undo_log' as const, at: at(t), opId, setId, expectedSetVersion: 2 });

/** W logged at 30 s (warm-up rest 60 s, deadline 90 s), +30 at 40 s (deadline 120 s), then B1 ticked by accident at 50 s. */
function accidentalTick() {
  const { state } = startFixture();
  const [w, b1, b2] = bench(state);
  if (!w || !b1 || !b2) throw new Error('fixture');
  let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
  const warm = s.restTimer;
  if (!warm) throw new Error('no rest');
  s = apply(s, { type: 'adjust_rest', at: at(40), opId: 'plus30', timerId: warm.id, deltaS: 30 });
  const adjusted = s.restTimer;
  if (!adjusted) throw new Error('no rest');
  expect(adjusted.deadlineUtc).toBe(at(120).utc);
  s = apply(s, logCmd(b1.id, values(kg(100), 8), 50));
  return { s, w, b1, b2, warm: adjusted };
}

describe('undo of a log puts back the rest it replaced', () => {
  it('restores the replaced rest with its original deadline (−30/+30 kept) and cancels the accidental one', () => {
    const { s, b1, warm } = accidentalTick();
    const accidental = s.restTimer;
    expect(accidental).toMatchObject({ setId: b1.id, status: 'running', deadlineUtc: at(230).utc });
    expect(accidental?.resumeOnUndo).toEqual([{ afterUndoOfSetId: b1.id, timer: warm }]);

    const r = expectOk(reduceSession(s, undo(b1.id, 60)));
    expect(r.state.restTimer).toEqual({ ...warm, version: warm.version + 2 });
    expect(r.state.restTimer?.restoredFinished).toBeUndefined();
    expect(r.state.restTimer?.resumeOnUndo).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'RestStarted', 'ActiveSetChanged']);
    expect(r.events[1]).toMatchObject({ type: 'RestEnded', timerId: accidental?.id, reason: 'cancelled' });
    expect(r.events[2]).toEqual({
      type: 'RestStarted',
      timerId: warm.id,
      setId: warm.setId,
      kind: 'rest',
      durationS: 60,
      deadlineUtc: at(120).utc,
      timerVersion: warm.version + 2,
    });
    expect(r.state.session.activeSetId).toBe(b1.id);
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
  });

  it('the replaced rest ran out between tick and untick: it comes back finished at its deadline, "Rested" counting on, no alert', () => {
    const { s, b1, warm } = accidentalTick();
    const r = expectOk(reduceSession(s, undo(b1.id, 130)));
    expect(r.state.restTimer).toEqual({ ...warm, status: 'expired', endedAtUtc: at(120).utc, remainingMsAtPause: null, version: warm.version + 2, restoredFinished: true });
    expect(r.state.restTimer?.resumeOnUndo).toBeUndefined();
    // No RestStarted: nothing to schedule. The accidental rest is cancelled.
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'ActiveSetChanged']);
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
    // Ready, rested since the original start: 90 s planned (60 + 30) and 10 s over at 2:10, 40 s over at 2:40.
    expect(getSessionPhase(r.state, ms(130))).toEqual({
      kind: 'ready',
      setId: b1.id,
      restEnded: { timerId: warm.id, endedAtUtc: at(120).utc, restedMs: 60_000 + 10_000, skipped: false },
    });
    expect(getSessionPhase(r.state, ms(160))).toMatchObject({ kind: 'ready', restEnded: { restedMs: 60_000 + 40_000 } });
  });

  it('at exactly the deadline the rest has finished: it comes back expired, no RestStarted', () => {
    const { s, b1, warm } = accidentalTick();
    const r = expectOk(reduceSession(s, undo(b1.id, 120)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'expired', endedAtUtc: at(120).utc });
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('the rest had already run out before the accidental tick (never ticked expired): it comes back expired at its deadline', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30)); // warm-up rest to 90 s
    const warm = s.restTimer;
    if (!warm) throw new Error('no rest');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100));
    expect(s.restTimer?.resumeOnUndo).toMatchObject([{ afterUndoOfSetId: b1.id, timer: { id: warm.id, status: 'expired', deadlineUtc: at(90).utc, endedAtUtc: at(90).utc } }]);
    const r = expectOk(reduceSession(s, undo(b1.id, 110)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'expired', endedAtUtc: at(90).utc, deadlineUtc: at(90).utc });
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'ActiveSetChanged']);
    // "Rested 1:20" at 1:50: the count-up runs from the warm-up log, not from the untick.
    expect(getSessionPhase(r.state, ms(110))).toMatchObject({ kind: 'ready', setId: b1.id, restEnded: { timerId: warm.id, restedMs: 80_000, skipped: false } });
  });

  it('the rest had been marked expired by a tick before the accidental tick: it comes back as it was', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, { type: 'tick', at: at(95) });
    const expired = s.restTimer;
    expect(expired).toMatchObject({ status: 'expired', endedAtUtc: at(90).utc });
    if (!expired) throw new Error('no rest');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100));
    const r = expectOk(reduceSession(s, undo(b1.id, 110)));
    expect(r.state.restTimer).toEqual({ ...expired, version: expired.version + 2, restoredFinished: true });
    expect(getSessionPhase(r.state, ms(110))).toMatchObject({ kind: 'ready', restEnded: { endedAtUtc: at(90).utc, restedMs: 80_000 } });
  });

  it('the rest had been skipped before the accidental tick: it comes back skipped, at its original skip time', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const warm = s.restTimer;
    if (!warm) throw new Error('no rest');
    s = apply(s, { type: 'skip_rest', at: at(40), opId: 'skip', timerId: warm.id });
    const skipped = s.restTimer;
    expect(skipped).toMatchObject({ status: 'skipped', endedAtUtc: at(40).utc });
    if (!skipped) throw new Error('no rest');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 50));
    const r = expectOk(reduceSession(s, undo(b1.id, 60)));
    expect(r.state.restTimer).toEqual({ ...skipped, version: skipped.version + 2, restoredFinished: true });
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
    expect(getSessionPhase(r.state, ms(60))).toEqual({
      kind: 'ready',
      setId: b1.id,
      restEnded: { timerId: warm.id, endedAtUtc: at(40).utc, restedMs: 0, skipped: true },
    });
  });

  it('a restored finished rest does not start counting down again on pause and resume', () => {
    const { s, b1, warm } = accidentalTick();
    const r = expectOk(reduceSession(s, undo(b1.id, 130))).state;
    let t = apply(r, { type: 'pause', at: at(140), opId: 'p' });
    t = apply(t, { type: 'resume', at: at(200), opId: 'r' });
    expect(t.restTimer).toMatchObject({ id: warm.id, status: 'expired', deadlineUtc: at(120).utc, endedAtUtc: at(120).utc });
  });

  it('while the workout is paused the rest comes back paused with its remaining time, and resumes from there', () => {
    const { s, b1, warm } = accidentalTick();
    const paused = apply(s, { type: 'pause', at: at(60), opId: 'p' });
    expect(paused.restTimer?.resumeOnUndo?.[0]?.timer).toMatchObject({ status: 'paused', remainingMsAtPause: 60_000 });
    const r = expectOk(reduceSession(paused, undo(b1.id, 200)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'paused', remainingMsAtPause: 60_000 });
    const resumed = apply(r.state, { type: 'resume', at: at(300), opId: 'r' });
    expect(resumed.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(360).utc });
  });

  it('a pause between the log and the undo shifts the kept rest like the live one', () => {
    const { s, b1, warm } = accidentalTick();
    let t = apply(s, { type: 'pause', at: at(60), opId: 'p' });
    t = apply(t, { type: 'resume', at: at(100), opId: 'r' });
    expect(t.restTimer?.resumeOnUndo?.[0]?.timer).toMatchObject({ status: 'running', deadlineUtc: at(160).utc });
    const r = expectOk(reduceSession(t, undo(b1.id, 110)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(160).utc });
  });

  it('a pause after the kept rest has run out keeps it, finished at its deadline; pause and resume never revive it', () => {
    const { s, b1, warm } = accidentalTick();
    const t = apply(s, { type: 'pause', at: at(150), opId: 'p' });
    expect(t.restTimer?.resumeOnUndo?.[0]?.timer).toMatchObject({ id: warm.id, status: 'expired', endedAtUtc: at(120).utc, deadlineUtc: at(120).utc });
    const resumed = apply(t, { type: 'resume', at: at(160), opId: 'r' });
    expect(resumed.restTimer?.resumeOnUndo?.[0]?.timer).toMatchObject({ status: 'expired', deadlineUtc: at(120).utc });
    const r = expectOk(reduceSession(resumed, undo(b1.id, 170)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'expired', endedAtUtc: at(120).utc });
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('a rest that ended early (no rest after the log before) has nothing to put back', () => {
    const { state } = startFixture();
    const [w] = bench(state);
    const [r1] = setsFor(state, ROW);
    const [f1] = setsFor(state, FACE);
    if (!w || !r1 || !f1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 10));
    s = apply(s, { type: 'set_active_set', at: at(15), opId: 'sa', setId: r1.id, expectedVersion: s.session.version });
    s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 10), 20));
    expect(s.restTimer?.status).toBe('ended_early');
    const before = s.restTimer?.resumeOnUndo;
    s = apply(s, { type: 'set_active_set', at: at(25), opId: 'sb', setId: f1.id, expectedVersion: s.session.version });
    s = apply(s, logCmd(f1.id, values(kg(20, 'stack'), 12), 30));
    // Only what R1's log kept is carried; F1's log added nothing for the ended-early rest.
    expect(s.restTimer?.resumeOnUndo?.map((e) => e.afterUndoOfSetId)).toEqual(before?.map((e) => e.afterUndoOfSetId));
  });

  it('first set of the workout: nothing to restore', () => {
    const { state } = startFixture();
    const [w] = bench(state);
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const r = expectOk(reduceSession(s, undo(w.id, 40)));
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('a log that starts no rest (superset transition) still restores the rest it ended', () => {
    const { state } = startFixture();
    const [w] = bench(state);
    const [r1] = setsFor(state, ROW);
    if (!w || !r1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 10));
    const warm = s.restTimer;
    s = apply(s, { type: 'set_active_set', at: at(15), opId: 'sa', setId: r1.id, expectedVersion: s.session.version });
    s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 10), 20));
    expect(s.restTimer).toMatchObject({ id: warm?.id, status: 'ended_early' });
    const r = expectOk(reduceSession(s, undo(r1.id, 30)));
    expect(r.state.restTimer).toMatchObject({ id: warm?.id, status: 'running', deadlineUtc: at(70).utc, endedAtUtc: null });
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestStarted', 'ActiveSetChanged']);
  });

  it('double undo: a retried undo is a no-op duplicate, a second undo is refused, and undoing the earlier set next unwinds one more', () => {
    const { s, w, b1, warm } = accidentalTick();
    const cmd = undo(b1.id, 60, 'u1');
    const once = expectOk(reduceSession(s, cmd));
    const retried = expectOk(reduceSession(once.state, cmd));
    expect(retried).toMatchObject({ duplicate: true, events: [] });
    expect(retried.state.restTimer).toEqual(once.state.restTimer);
    expectError(reduceSession(once.state, undo(b1.id, 61, 'u2')), 'set_not_completed');
    // W is now the latest log: undoing it cancels its (restored) rest.
    const r = expectOk(reduceSession(once.state, undo(w.id, 70)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'cancelled' });
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('unwinds a chain of quick ticks one rest at a time, each with its own deadline', () => {
    const { state } = startFixture();
    const [w, b1, b2] = bench(state);
    if (!w || !b1 || !b2) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30)); // warm-up rest to 90 s
    const warm = s.restTimer;
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 40)); // B1 rest to 220 s
    const b1Rest = s.restTimer;
    s = apply(s, logCmd(b2.id, values(kg(100), 8), 50));
    expect(s.restTimer?.resumeOnUndo?.map((e) => e.afterUndoOfSetId)).toEqual([b1.id, b2.id]);
    s = expectOk(reduceSession(s, undo(b2.id, 60))).state;
    expect(s.restTimer).toMatchObject({ id: b1Rest?.id, status: 'running', deadlineUtc: at(220).utc });
    s = expectOk(reduceSession(s, undo(b1.id, 70))).state;
    expect(s.restTimer).toMatchObject({ id: warm?.id, status: 'running', deadlineUtc: at(90).utc });
    expect(s.restTimer?.resumeOnUndo).toBeUndefined();
  });

  it('undo of an older set stays refused, and a stale undo is rejected without touching the rest', () => {
    const { s, w, b1 } = accidentalTick();
    expectError(reduceSession(s, undo(w.id, 60)), 'not_latest_set');
    expectError(reduceSession(s, { ...undo(b1.id, 60), expectedSetVersion: 1 }), 'stale_version');
  });

  it('starting a work timer ends rest for good: a later undo restores none', () => {
    const { s, b1 } = accidentalTick();
    const [hang] = setsFor(s, HANG);
    if (!hang) throw new Error('fixture');
    let t = apply(s, { type: 'start_work_interval', at: at(55), opId: 'w1', setId: hang.id, durationS: 45 });
    expect(t.restTimer?.resumeOnUndo).toBeUndefined();
    t = apply(t, { type: 'stop_work_interval', at: at(58), opId: 'w2', setId: hang.id });
    const r = expectOk(reduceSession(t, undo(b1.id, 60)));
    expect(r.state.restTimer?.status).toBe('ended_early');
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('Finish drops the kept rest with the live one', () => {
    const { s } = accidentalTick();
    const r = expectOk(reduceSession(s, { type: 'finish', at: at(60), opId: 'f', expectedVersion: s.session.version, endedAt: null }));
    expect(r.state.restTimer).toMatchObject({ status: 'cancelled' });
    expect(r.state.restTimer?.resumeOnUndo).toBeUndefined();
  });

  it('the coach chat’s Undo of a log is the same undo_log: it puts the rest back too', () => {
    const { s, b1, warm } = accidentalTick();
    const cmd = chatSetUndoCommand({ kind: 'log_set', setId: b1.id, setVersionAfter: 2 }, { opId: 'chat-undo', at: at(60) });
    if (cmd === null) throw new Error('no command');
    const r = expectOk(reduceSession(s, cmd));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(120).utc });
  });

  it('a kept rest that ran out survives a schema round trip as expired and comes back finished', () => {
    const { s, b1, warm } = accidentalTick();
    // A pause at 2:30 settles the kept rest as expired; then the app is closed and reopened.
    const t = apply(apply(s, { type: 'pause', at: at(150), opId: 'p' }), { type: 'resume', at: at(155), opId: 'r' });
    const parsed = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(t)));
    expect(parsed.restTimer?.resumeOnUndo?.[0]?.timer.status).toBe('expired');
    const r = expectOk(reduceSession(parsed, undo(b1.id, 160)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'expired', endedAtUtc: at(120).utc });
  });

  it('the kept rest survives a schema round trip (what persistence stores)', () => {
    const { s, b1, warm } = accidentalTick();
    const parsed = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
    const r = expectOk(reduceSession(parsed, undo(b1.id, 60)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(120).utc });
  });
});

/*
 * Review S1: the accidental rest is touched (Skip, −30 to zero, runs out)
 * before the untick. The earlier rest must still come back with its deadline.
 */

/** W logged at 30 s (warm-up rest to 90 s), then R1 ticked by accident at 40 s: a 15 s transition rest to 55 s. */
function accidentalShortTick() {
  const { state } = startFixture({ supersetTransitionS: 15 });
  const [w] = bench(state);
  const [r1] = setsFor(state, ROW);
  if (!w || !r1) throw new Error('fixture');
  let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
  const warm = s.restTimer;
  if (!warm) throw new Error('no rest');
  s = apply(s, { type: 'set_active_set', at: at(35), opId: 'sa', setId: r1.id, expectedVersion: s.session.version });
  s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 10), 40));
  expect(s.restTimer).toMatchObject({ setId: r1.id, kind: 'transition', status: 'running', deadlineUtc: at(55).utc });
  return { s, r1, warm };
}

describe('the accidental rest is changed before the untick (review S1)', () => {
  it('Skip on the accidental rest, then untick: the earlier rest comes back with its deadline', () => {
    const { s, b1, warm } = accidentalTick();
    const accidental = s.restTimer;
    if (!accidental) throw new Error('no rest');
    const skipped = apply(s, { type: 'skip_rest', at: at(55), opId: 'skip', timerId: accidental.id });
    expect(skipped.restTimer).toMatchObject({ id: accidental.id, status: 'skipped' });
    expect(skipped.restTimer?.resumeOnUndo).toHaveLength(1);
    const r = expectOk(reduceSession(skipped, undo(b1.id, 60)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(120).utc });
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestStarted', 'ActiveSetChanged']);
  });

  it('−30 takes the accidental rest to zero, then untick: the earlier rest comes back with its deadline', () => {
    const { s, r1, warm } = accidentalShortTick();
    const accidental = s.restTimer;
    if (!accidental) throw new Error('no rest');
    const zeroed = apply(s, { type: 'adjust_rest', at: at(45), opId: 'minus30', timerId: accidental.id, deltaS: -30 });
    expect(zeroed.restTimer).toMatchObject({ id: accidental.id, status: 'expired' });
    expect(zeroed.restTimer?.resumeOnUndo).toHaveLength(1);
    const r = expectOk(reduceSession(zeroed, undo(r1.id, 50)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(90).utc });
  });

  it('the accidental rest runs out on a clock tick, then untick: the earlier rest comes back with its deadline', () => {
    const { s, r1, warm } = accidentalShortTick();
    const ticked = expectOk(reduceSession(s, { type: 'tick', at: at(60) }));
    expect(ticked.events.map((e) => e.type)).toEqual(['RestEnded']);
    expect(ticked.state.restTimer).toMatchObject({ status: 'expired' });
    expect(ticked.state.restTimer?.resumeOnUndo).toHaveLength(1);
    const r = expectOk(reduceSession(ticked.state, undo(r1.id, 70)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(90).utc });
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(true);
  });

  it('Discard drops the kept rest with the live one', () => {
    const { s } = accidentalTick();
    const r = expectOk(reduceSession(s, { type: 'discard', at: at(60), opId: 'd', expectedVersion: s.session.version, confirmedLoggedSets: 2 }));
    expect(r.state.restTimer).toMatchObject({ status: 'cancelled' });
    expect(r.state.restTimer?.resumeOnUndo).toBeUndefined();
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
  });

  it('final set of a planned workout ticked by accident: untick restores the rest it ended', () => {
    const { state } = startFixture();
    const order = [...bench(state), setsFor(state, ROW)[0], setsFor(state, FACE)[0], setsFor(state, ROW)[1], setsFor(state, FACE)[1]];
    let s = state;
    let t = 0;
    for (const set of order) {
      if (!set) throw new Error('fixture');
      const v = set.planned.load?.convention === 'stack' ? values(set.planned.load, 12) : values(set.planned.load, 8);
      s = apply(s, logCmd(set.id, v, (t += 60)));
    }
    const before = s.restTimer;
    if (before?.status !== 'running') throw new Error('expected a running rest after the last superset round');
    const hang = setsFor(s, HANG)[0];
    if (!hang) throw new Error('fixture');
    s = apply(s, logCmd(hang.id, values(null, null, { durationS: 45 }), t + 5));
    expect(s.session.activeSetId).toBeNull();
    expect(s.restTimer).toMatchObject({ id: before.id, status: 'ended_early' });
    expect(s.restTimer?.resumeOnUndo?.at(-1)?.afterUndoOfSetId).toBe(hang.id);
    const r = expectOk(reduceSession(s, undo(hang.id, t + 10)));
    expect(r.state.restTimer).toMatchObject({ id: before.id, status: 'running', deadlineUtc: before.deadlineUtc, endedAtUtc: null });
    expect(r.state.session.activeSetId).toBe(hang.id);
  });
});

describe('kept rests are capped (review S2)', () => {
  it(`22 quick ticks (21 rests replaced) keep the newest ${String(MAX_RESUMABLE_RESTS)}, newest on top, and the newest undo still works`, () => {
    const { state } = startFixture();
    const [w, b1, b2] = bench(state);
    if (!w || !b1 || !b2) throw new Error('fixture');
    let s = state;
    let after = b2.id;
    const added: string[] = [];
    for (let i = 0; i < 19; i += 1) {
      const newSetId = id(70_000 + i);
      s = apply(s, { type: 'add_set', at: at(1), opId: `add-${String(i)}`, sessionExerciseId: b2.sessionExerciseId, newSetId, setType: null, afterSetId: after });
      added.push(newSetId);
      after = newSetId;
    }
    const ticks = [w.id, b1.id, b2.id, ...added];
    // The first tick replaces no rest, so 22 ticks keep 21 rests: one over the cap.
    expect(ticks).toHaveLength(22);
    let t = 10;
    let previousTimerId: string | undefined;
    for (const setId of ticks) {
      previousTimerId = s.restTimer?.id;
      s = apply(s, logCmd(setId, values(kg(100), 8), (t += 1)));
    }
    const stack = s.restTimer?.resumeOnUndo ?? [];
    expect(stack).toHaveLength(MAX_RESUMABLE_RESTS);
    // Oldest dropped (W's rest, kept by B1's log), newest on top.
    expect(stack[0]?.afterUndoOfSetId).toBe(ticks[2]);
    expect(stack.at(-1)?.afterUndoOfSetId).toBe(ticks[21]);
    expect(stack.at(-1)?.timer.id).toBe(previousTimerId);
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).error?.issues).toBeUndefined();
    const r = expectOk(reduceSession(s, undo(ticks[21] ?? '', t + 1)));
    expect(r.state.restTimer).toMatchObject({ id: previousTimerId, status: 'running' });
    expect(r.state.restTimer?.resumeOnUndo).toHaveLength(MAX_RESUMABLE_RESTS - 1);
  });
});

describe('finished kept rests stay near the top (review rest-undo-sp1 S1)', () => {
  it(`22 ticks with each rest run out first keep only the newest ${String(MAX_FINISHED_RESUMABLE_DEPTH)} finished rests, and the row stays small`, () => {
    const { state } = startFixture();
    const [w, b1, b2] = bench(state);
    if (!w || !b1 || !b2) throw new Error('fixture');
    let s = state;
    let after = b2.id;
    const added: string[] = [];
    for (let i = 0; i < 19; i += 1) {
      const newSetId = id(71_000 + i);
      s = apply(s, { type: 'add_set', at: at(1), opId: `add-${String(i)}`, sessionExerciseId: b2.sessionExerciseId, newSetId, setType: null, afterSetId: after });
      added.push(newSetId);
      after = newSetId;
    }
    const ticks = [w.id, b1.id, b2.id, ...added];
    // Ten minutes apart: every rest has run out (expired) before the next log.
    let t = 10;
    for (const setId of ticks) s = apply(s, logCmd(setId, values(kg(100), 8), (t += 600)));
    const stack = s.restTimer?.resumeOnUndo ?? [];
    expect(stack).toHaveLength(MAX_FINISHED_RESUMABLE_DEPTH);
    expect(stack.every((e) => e.timer.status === 'expired')).toBe(true);
    expect(stack.map((e) => e.afterUndoOfSetId)).toEqual(ticks.slice(-MAX_FINISHED_RESUMABLE_DEPTH));
    // Rewritten on every command (draft saves too): a small, fixed budget.
    expect(JSON.stringify(stack).length).toBeLessThan(2_500);
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).error?.issues).toBeUndefined();
    // The newest five unwind one at a time, each finished; the sixth back puts no rest back.
    for (const setId of ticks.slice(-MAX_FINISHED_RESUMABLE_DEPTH).reverse()) {
      const r = expectOk(reduceSession(s, undo(setId, (t += 5))));
      expect(r.state.restTimer).toMatchObject({ status: 'expired', restoredFinished: true });
      s = r.state;
    }
    expect(s.restTimer?.resumeOnUndo).toBeUndefined();
    const deeper = ticks.at(-MAX_FINISHED_RESUMABLE_DEPTH - 1) ?? '';
    const before = s.restTimer;
    const r = expectOk(reduceSession(s, undo(deeper, t + 5)));
    expect(r.state.restTimer).toEqual(before);
  });

  it('only finished entries are bounded by depth: a running or paused one further down is kept', () => {
    const { s, b1 } = accidentalTick();
    const entry = s.restTimer?.resumeOnUndo?.[0];
    if (!entry) throw new Error('fixture');
    const finished = (n: number) => ({ afterUndoOfSetId: id(72_000 + n), timer: { ...entry.timer, status: 'expired' as const, endedAtUtc: entry.timer.deadlineUtc } });
    const stack = [entry, ...Array.from({ length: MAX_FINISHED_RESUMABLE_DEPTH + 2 }, (_, n) => finished(n))];
    const bounded = boundResumable(stack);
    expect(bounded.map((e) => e.afterUndoOfSetId)).toEqual([b1.id, ...stack.slice(-MAX_FINISHED_RESUMABLE_DEPTH).map((e) => e.afterUndoOfSetId)]);
    expect(bounded[0]?.timer.status).toBe('running');
  });
});

describe('kept rest schema (review rest-undo-sp1 N1)', () => {
  it('a finished kept rest needs its end time and no paused remainder', () => {
    const { s } = accidentalTick();
    const entry = s.restTimer?.resumeOnUndo?.[0];
    if (!entry) throw new Error('fixture');
    const finished = { ...entry, timer: { ...entry.timer, status: 'expired' as const, endedAtUtc: entry.timer.deadlineUtc, remainingMsAtPause: null } };
    expect(ResumableRestSchema.safeParse(finished).success).toBe(true);
    expect(ResumableRestSchema.safeParse({ ...finished, timer: { ...finished.timer, endedAtUtc: null } }).success).toBe(false);
    expect(ResumableRestSchema.safeParse({ ...finished, timer: { ...finished.timer, status: 'skipped', remainingMsAtPause: 1000 } }).success).toBe(false);
    expect(ResumableRestSchema.safeParse(entry).success).toBe(true);
  });
});
