import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import { chatSetUndoCommand, reduceSession } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

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

  it('shows no rest (and no late alert) when the replaced rest has run out by the undo', () => {
    const { s, b1 } = accidentalTick();
    const r = expectOk(reduceSession(s, undo(b1.id, 130)));
    expect(r.state.restTimer).toMatchObject({ setId: b1.id, status: 'cancelled' });
    expect(r.state.restTimer?.resumeOnUndo).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'ActiveSetChanged']);
  });

  it('at exactly the deadline the rest has finished: none comes back', () => {
    const { s, b1 } = accidentalTick();
    const r = expectOk(reduceSession(s, undo(b1.id, 120)));
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(r.events.some((e) => e.type === 'RestStarted')).toBe(false);
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

  it('a pause after the kept rest has run out drops it', () => {
    const { s, b1 } = accidentalTick();
    const t = apply(s, { type: 'pause', at: at(150), opId: 'p' });
    expect(t.restTimer?.resumeOnUndo).toBeUndefined();
    const r = expectOk(reduceSession(apply(t, { type: 'resume', at: at(160), opId: 'r' }), undo(b1.id, 170)));
    expect(r.state.restTimer?.status).toBe('cancelled');
  });

  it('no rest was running before the log: undo cancels its rest and starts none', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    // W's rest (deadline 90 s) has run out when B1 is logged.
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100));
    expect(s.restTimer?.resumeOnUndo).toBeUndefined();
    const r = expectOk(reduceSession(s, undo(b1.id, 110)));
    expect(r.state.restTimer).toMatchObject({ setId: b1.id, status: 'cancelled' });
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'ActiveSetChanged']);
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

  it('the kept rest survives a schema round trip (what persistence stores)', () => {
    const { s, b1, warm } = accidentalTick();
    const parsed = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
    const r = expectOk(reduceSession(parsed, undo(b1.id, 60)));
    expect(r.state.restTimer).toMatchObject({ id: warm.id, status: 'running', deadlineUtc: at(120).utc });
  });
});
