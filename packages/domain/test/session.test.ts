import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema } from '@fizz/schemas';
import {
  draftOperationId,
  getActiveDurationMs,
  getSessionPhase,
  latestCommittedSetId,
  prefillDraft,
  reduceSession,
  restRemainingMs,
  startWorkout,
} from '../src/index';
import { at, barbell, GYM, id, kg, lb, ms, values } from './fixtures';
import {
  apply,
  BENCH,
  expectError,
  expectOk,
  FACE,
  HANG,
  logCmd,
  ROW,
  setsFor,
  startFixture,
} from './session-fixture';

const bench = (s: ReturnType<typeof startFixture>['state']) => setsFor(s, BENCH);

describe('startWorkout', () => {
  it('snapshots the routine, equipment and resolved rest per set', () => {
    const { state } = startFixture();
    expect(state.session.status).toBe('active');
    expect(state.session.version).toBe(1);
    expect(state.session.equipmentSnapshot.map((e) => e.kind)).toEqual(['barbell', 'weight_stack']);
    const [w, b1] = bench(state);
    expect(w?.rest).toEqual({ seconds: 60, source: 'routine_set_type', sourceLabel: 'Warm-up preset (Bench press, warm-up sets)' });
    expect(b1?.rest.seconds).toBe(180);
    expect(setsFor(state, ROW)[0]?.rest).toMatchObject({ seconds: 90, source: 'global_default' });
    expect(state.session.activeSetId).toBe(w?.id);
  });

  it('rounds unachievable template loads toward easier and reports it', () => {
    const { input } = startFixture();
    const tpl = input.routine?.exercises[0]?.setTemplates[1];
    if (!tpl) throw new Error('fixture');
    tpl.targetLoad = kg(101);
    const out = startWorkout({ ...input });
    expect(setsFor(out.aggregate, BENCH)[1]?.planned.load).toEqual(kg(100));
    expect(out.warnings).toContainEqual(
      expect.objectContaining({ kind: 'target_rounded', requested: kg(101), planned: kg(100) }),
    );
  });

  it('never plans above the equipment maximum', () => {
    const { input } = startFixture({ benchTarget: 250 });
    const out = startWorkout(input);
    expect(setsFor(out.aggregate, BENCH)[1]?.planned.load).toEqual(kg(187.5));
    expect(out.warnings).toContainEqual(expect.objectContaining({ kind: 'target_rounded', bounded: 'max' }));
  });

  it('missing equipment does not block the workout; it is reported', () => {
    const { input } = startFixture();
    const out = startWorkout({ ...input, gymEquipment: [barbell()] });
    expect(out.warnings).toContainEqual(expect.objectContaining({ kind: 'equipment_not_in_gym' }));
    expect(setsFor(out.aggregate, ROW).length).toBe(2);
  });

  it('produces a schema-valid persisted aggregate', () => {
    expect(SessionAggregateSchema.safeParse(startFixture().state).success).toBe(true);
  });
});

describe('logSet / commitSetAndBeginRest', () => {
  it('commits the actual result, keeps the planned target, starts rest and advances', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    const r = expectOk(reduceSession(state, logCmd(w.id, values(kg(60), 10), 30)));
    const saved = r.state.sets.find((s) => s.id === w.id);
    expect(saved).toMatchObject({ status: 'completed', actual: values(kg(60), 10), version: 2 });
    expect(saved?.planned.load).toEqual(kg(60));
    expect(r.state.restTimer).toMatchObject({ status: 'running', durationS: 60, setId: w.id, kind: 'rest' });
    expect(r.state.restTimer?.deadlineUtc).toBe(at(90).utc);
    expect(r.state.session.activeSetId).toBe(b1.id);
    expect(r.state.session.version).toBe(2);
    expect(r.events.map((e) => e.type)).toEqual(['SetCommitted', 'RestStarted', 'ActiveSetChanged']);
  });

  it('is idempotent: the same operation ID commits exactly once (double tap / voice duplicate)', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const cmd = logCmd(w.id, values(kg(60), 10), 30, 'tap-1');
    const first = apply(state, cmd);
    const second = expectOk(reduceSession(first, { ...cmd, at: at(30.4) }));
    expect(second.duplicate).toBe(true);
    expect(second.state).toBe(first);
    expect(second.events).toEqual([]);
  });

  it('rejects a reused operation ID with different values', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const first = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'op-x'));
    expectError(reduceSession(first, logCmd(w.id, values(kg(60), 9), 31, 'op-x')), 'operation_id_reused');
  });

  it('a second log of the same set with a new operation ID is rejected, not duplicated', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const first = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'tap'));
    expectError(reduceSession(first, logCmd(w.id, values(kg(60), 10), 31, 'voice-turn-7')), 'set_not_pending');
    expect(first.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
  });

  it('validates units and conventions explicitly', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    expectError(reduceSession(state, logCmd(w.id, values(lb(135), 10), 30)), 'unit_mismatch');
    expectError(reduceSession(state, logCmd(w.id, values(kg(60, 'per_hand'), 10), 30)), 'convention_mismatch');
    expectError(reduceSession(state, logCmd(w.id, values(kg(60), null), 30)), 'invalid_values');
    expectError(reduceSession(state, logCmd(w.id, values(null, 10), 30)), 'invalid_values');
  });

  it('logs an off-profile load (what was actually lifted) and flags it', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const next = apply(state, logCmd(w.id, values(kg(61), 10), 30));
    expect(next.sets.find((s) => s.id === w.id)?.flags).toEqual(['off_profile_load']);
  });

  it('P2: logging the next set during rest ends that rest early and starts a new one', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    const resting = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const firstTimer = resting.restTimer;
    const r = expectOk(reduceSession(resting, logCmd(b1.id, values(kg(100), 8), 60)));
    expect(r.events[0]).toMatchObject({ type: 'RestEnded', timerId: firstTimer?.id, reason: 'ended_early' });
    expect(r.state.restTimer).toMatchObject({ setId: b1.id, durationS: 180, status: 'running' });
    expect(r.state.restTimer?.id).not.toBe(firstTimer?.id);
  });

  it('logging after rest expired does not mark it ended early', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    const resting = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const r = expectOk(reduceSession(resting, logCmd(b1.id, values(kg(100), 8), 200)));
    expect(r.events[0]).toMatchObject({ type: 'RestEnded', reason: 'expired' });
  });

  it('refuses to log while paused', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const paused = apply(state, { type: 'pause', at: at(5), opId: 'p1' });
    expectError(reduceSession(paused, logCmd(w.id, values(kg(60), 10), 6)), 'session_paused');
  });
});

describe('timer expiry never commits a set', () => {
  it('tick past the deadline ends rest but changes no set and no active pointer', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const resting = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const r = expectOk(reduceSession(resting, { type: 'tick', at: at(500) }));
    expect(r.events).toEqual([
      expect.objectContaining({ type: 'RestEnded', reason: 'expired', lateByMs: 410_000 }),
    ]);
    expect(r.state.sets).toEqual(resting.sets);
    expect(r.state.session.activeSetId).toBe(resting.session.activeSetId);
    expect(r.state.session.version).toBe(resting.session.version);
    const phase = getSessionPhase(r.state, ms(500));
    expect(phase).toMatchObject({ kind: 'ready', restEnded: { skipped: false, endedAtUtc: at(90).utc } });
  });

  it('a tick before the deadline is a no-op', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const resting = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const r = expectOk(reduceSession(resting, { type: 'tick', at: at(40) }));
    expect(r.state).toBe(resting);
    expect(getSessionPhase(resting, ms(40))).toMatchObject({ kind: 'resting', remainingMs: 50_000 });
  });
});

describe('rest controls', () => {
  const resting = () => {
    const { state } = startFixture();
    const [, b1] = bench(state);
    if (!b1) throw new Error('fixture');
    const s = apply(state, { type: 'set_active_set', at: at(1), opId: 'sa', setId: b1.id, expectedVersion: 1 });
    return apply(s, logCmd(b1.id, values(kg(100), 8), 0)); // 180 s rest
  };

  it('+30 s at 0:20 gives 0:50 and a new timer version', () => {
    const s = resting();
    const timerId = s.restTimer?.id ?? '';
    const r = expectOk(reduceSession(s, { type: 'adjust_rest', at: at(160), opId: 'a1', timerId, deltaS: 30 }));
    expect(r.state.restTimer && restRemainingMs(r.state.restTimer, ms(160))).toBe(50_000);
    expect(r.events).toEqual([expect.objectContaining({ type: 'RestAdjusted', timerVersion: 2 })]);
    expect(r.state.session.version).toBe(s.session.version); // timer nudges don't stale proposals
  });

  it('-30 s at 0:20 ends rest as expired (rest-end cue plays)', () => {
    const s = resting();
    const r = expectOk(
      reduceSession(s, { type: 'adjust_rest', at: at(160), opId: 'a1', timerId: s.restTimer?.id ?? '', deltaS: -30 }),
    );
    expect(r.state.restTimer?.status).toBe('expired');
    expect(r.events.map((e) => e.type)).toEqual(['RestAdjusted', 'RestEnded']);
  });

  it('two separate +30 taps both apply; a retried tap applies once', () => {
    const s = resting();
    const timerId = s.restTimer?.id ?? '';
    const once = apply(s, { type: 'adjust_rest', at: at(10), opId: 't1', timerId, deltaS: 30 });
    const retried = apply(once, { type: 'adjust_rest', at: at(10), opId: 't1', timerId, deltaS: 30 });
    const twice = apply(retried, { type: 'adjust_rest', at: at(11), opId: 't2', timerId, deltaS: 30 });
    expect(retried.restTimer && restRemainingMs(retried.restTimer, ms(10))).toBe(200_000);
    expect(twice.restTimer && restRemainingMs(twice.restTimer, ms(11))).toBe(229_000);
  });

  it('skip ends rest as skipped; further adjustments are rejected', () => {
    const s = resting();
    const timerId = s.restTimer?.id ?? '';
    const skipped = apply(s, { type: 'skip_rest', at: at(20), opId: 'sk', timerId });
    expect(skipped.restTimer?.status).toBe('skipped');
    expect(getSessionPhase(skipped, ms(21))).toMatchObject({ kind: 'ready', restEnded: { skipped: true } });
    expectError(reduceSession(skipped, { type: 'adjust_rest', at: at(21), opId: 'a', timerId, deltaS: 30 }), 'timer_not_running');
  });

  it('rejects controls for an old timer', () => {
    const s = resting();
    expectError(reduceSession(s, { type: 'skip_rest', at: at(20), opId: 'sk', timerId: id(1) }), 'timer_not_found');
  });
});

describe('corrections', () => {
  const afterLog = () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    return { s: apply(state, logCmd(w.id, values(kg(60), 10), 30)), setId: w.id };
  };

  it('changing RPE during rest never touches the rest timer', () => {
    const { s, setId } = afterLog();
    const r = expectOk(
      reduceSession(s, { type: 'correct_set', at: at(40), opId: 'c1', setId, expectedSetVersion: 2, patch: { rpe: 8 } }),
    );
    expect(r.state.restTimer).toEqual(s.restTimer);
    expect(r.state.sets.find((x) => x.id === setId)).toMatchObject({ actual: { rpe: 8, reps: 10 }, edited: true, version: 3 });
    expect(r.state.session.version).toBe(s.session.version + 1);
  });

  it('preserves an audit trail with before and after', () => {
    const { s, setId } = afterLog();
    const next = apply(s, { type: 'correct_set', at: at(40), opId: 'c1', setId, expectedSetVersion: 2, patch: { load: kg(57.5) } });
    const entry = next.audit.find((a) => a.kind === 'corrected');
    expect(entry?.before?.actual?.load).toEqual(kg(60));
    expect(entry?.after?.actual?.load).toEqual(kg(57.5));
    expect(next.audit.map((a) => a.kind)).toEqual(['logged', 'corrected']);
  });

  it('rejects a stale set version', () => {
    const { s, setId } = afterLog();
    const next = apply(s, { type: 'correct_set', at: at(40), opId: 'c1', setId, expectedSetVersion: 2, patch: { reps: 9 } });
    expectError(
      reduceSession(next, { type: 'correct_set', at: at(41), opId: 'c2', setId, expectedSetVersion: 2, patch: { reps: 8 } }),
      'stale_version',
    );
  });

  it('cannot correct a pending set', () => {
    const { s } = afterLog();
    const pending = bench(s)[1];
    expectError(
      reduceSession(s, { type: 'correct_set', at: at(41), opId: 'c', setId: pending?.id ?? '', expectedSetVersion: 1, patch: { reps: 8 } }),
      'set_not_completed',
    );
  });

  it('can change set type and validates the corrected values', () => {
    const { s, setId } = afterLog();
    const next = apply(s, { type: 'correct_set', at: at(40), opId: 'c1', setId, expectedSetVersion: 2, patch: { setType: 'working' } });
    expect(next.sets.find((x) => x.id === setId)?.setType).toBe('working');
    expectError(
      reduceSession(next, { type: 'correct_set', at: at(41), opId: 'c2', setId, expectedSetVersion: 3, patch: { load: lb(135) } }),
      'unit_mismatch',
    );
  });
});

describe('undo', () => {
  it('removes the latest set (audited), cancels its rest and restores it as active with a draft', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const logged = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'tap'));
    const r = expectOk(reduceSession(logged, { type: 'undo_log', at: at(35), opId: 'u1', setId: w.id, expectedSetVersion: 2 }));
    const set = r.state.sets.find((s) => s.id === w.id);
    expect(set).toMatchObject({ status: 'pending', actual: null, draft: values(kg(60), 10), undoCount: 1 });
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(r.state.session.activeSetId).toBe(w.id);
    expect(r.events.map((e) => e.type)).toEqual(['SetUndone', 'RestEnded', 'ActiveSetChanged']);
    expect(r.state.audit.map((a) => a.kind)).toEqual(['logged', 'undone']);
    expect(set && draftOperationId(set)).toBe(`log:${w.id}:1`);
  });

  it('a retried original log after undo does not re-commit the set', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const cmd = logCmd(w.id, values(kg(60), 10), 30, 'tap');
    const undone = apply(apply(state, cmd), { type: 'undo_log', at: at(35), opId: 'u1', setId: w.id, expectedSetVersion: 2 });
    const r = expectOk(reduceSession(undone, cmd));
    expect(r.duplicate).toBe(true);
    // Review M3: a late duplicate must not be reported as "committed".
    expect(r.superseded).toBe(true);
    expect(r.state.sets.find((s) => s.id === w.id)?.status).toBe('pending');
  });

  it('a duplicate of a log that is still in effect is not superseded', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const cmd = logCmd(w.id, values(kg(60), 10), 30, 'tap');
    const r = expectOk(reduceSession(apply(state, cmd), cmd));
    expect(r).toMatchObject({ duplicate: true, superseded: false });
  });

  it('S1: Log → RPE chip during rest → Undo succeeds (guarded on the set version, not the session version)', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'tap'));
    s = apply(s, { type: 'correct_set', at: at(32), opId: 'rpe', setId: w.id, expectedSetVersion: 2, patch: { rpe: 8 } });
    expect(s.session.version).toBe(3);
    const r = expectOk(reduceSession(s, { type: 'undo_log', at: at(34), opId: 'u', setId: w.id, expectedSetVersion: 3 }));
    expect(r.state.sets.find((x) => x.id === w.id)).toMatchObject({ status: 'pending', draft: values(kg(60), 10, { rpe: 8 }) });
    // The version shown before the RPE tap is now stale.
    expectError(reduceSession(s, { type: 'undo_log', at: at(34), opId: 'u2', setId: w.id, expectedSetVersion: 2 }), 'stale_version');
  });

  it('M3: "latest" is by commit order, not by the client timestamp', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    // W logged at t=100, then a delayed voice turn commits B1 stamped t=50.
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 100));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 50));
    expect(latestCommittedSetId(s)).toBe(b1.id);
    expectOk(reduceSession(s, { type: 'undo_log', at: at(110), opId: 'u', setId: b1.id, expectedSetVersion: 2 }));
    expectError(reduceSession(s, { type: 'undo_log', at: at(110), opId: 'u', setId: w.id, expectedSetVersion: 2 }), 'not_latest_set');
  });

  it('rejects stale undo and undo of an older set', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    const two = apply(apply(state, logCmd(w.id, values(kg(60), 10), 30)), logCmd(b1.id, values(kg(100), 8), 120));
    expectError(reduceSession(two, { type: 'undo_log', at: at(130), opId: 'u', setId: b1.id, expectedSetVersion: 1 }), 'stale_version');
    expectError(reduceSession(two, { type: 'undo_log', at: at(130), opId: 'u', setId: w.id, expectedSetVersion: 2 }), 'not_latest_set');
  });
});

describe('supersets', () => {
  const toSuperset = (opts = {}) => {
    const { state } = startFixture(opts);
    const r1 = setsFor(state, ROW)[0];
    if (!r1) throw new Error('fixture');
    return { s: apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: r1.id, expectedVersion: 1 }), r1 };
  };

  it('logging A1 moves to A2 with no rest; logging A2 starts the round rest', () => {
    const { s, r1 } = toSuperset();
    const f1 = setsFor(s, FACE)[0];
    const r2 = setsFor(s, ROW)[1];
    const afterA1 = expectOk(reduceSession(s, logCmd(r1.id, values(kg(50, 'stack'), 12), 10)));
    expect(afterA1.state.restTimer).toBeNull();
    expect(afterA1.state.session.activeSetId).toBe(f1?.id);
    expect(afterA1.events.map((e) => e.type)).toEqual(['SetCommitted', 'ActiveSetChanged']);

    const afterA2 = apply(afterA1.state, logCmd(f1?.id ?? '', values(kg(20, 'stack'), 15), 40));
    expect(afterA2.restTimer).toMatchObject({ kind: 'rest', durationS: 90, status: 'running' });
    expect(afterA2.session.activeSetId).toBe(r2?.id);
  });

  it('uses a configured transition between members', () => {
    const { s, r1 } = toSuperset({ supersetTransitionS: 15 });
    const next = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 12), 10));
    expect(next.restTimer).toMatchObject({ kind: 'transition', durationS: 15 });
  });
});

describe('end of exercise and end of workout', () => {
  it("after an exercise's final set, rest starts normally unless a transition is configured", () => {
    const run = (benchTransitionS: number | null) => {
      const { state } = startFixture({ benchTransitionS });
      const [w, b1, b2] = bench(state);
      let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 0));
      s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 100));
      return apply(s, logCmd(b2?.id ?? '', values(kg(100), 8), 300));
    };
    expect(run(null).restTimer).toMatchObject({ kind: 'rest', durationS: 180 });
    expect(run(30).restTimer).toMatchObject({ kind: 'transition', durationS: 30 });
  });

  it('final set of the workout: no rest, Finish becomes primary', () => {
    const { state } = startFixture();
    const order = [...bench(state), setsFor(state, ROW)[0], setsFor(state, FACE)[0], setsFor(state, ROW)[1], setsFor(state, FACE)[1]];
    let s = state;
    let t = 0;
    for (const set of order) {
      if (!set) throw new Error('fixture');
      const v = set.planned.load?.convention === 'stack' ? values(set.planned.load, 12) : values(set.planned.load, 8);
      s = apply(s, logCmd(set.id, v, (t += 60)));
    }
    const hang = setsFor(s, HANG)[0];
    expect(s.session.activeSetId).toBe(hang?.id);
    const r = expectOk(reduceSession(s, logCmd(hang?.id ?? '', values(null, null, { durationS: 45 }), (t += 300))));
    expect(r.events.map((e) => e.type)).toEqual(['RestEnded', 'SetCommitted', 'ActiveSetChanged', 'AllSetsDone']);
    expect(r.state.restTimer?.status).not.toBe('running');
    expect(r.state.session.activeSetId).toBeNull();
    expect(getSessionPhase(r.state, ms(t + 1))).toEqual({ kind: 'all_done' });
  });
});

describe('timed exercises (Working state)', () => {
  const atHang = () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    return { s: apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: hang.id, expectedVersion: 1 }), hang };
  };

  it('work timer end fills the draft with the planned time but saves nothing', () => {
    const { s, hang } = atHang();
    const working = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w1', setId: hang.id, durationS: 45 });
    expect(getSessionPhase(working, ms(20))).toMatchObject({ kind: 'working', remainingMs: 35_000 });
    const r = expectOk(reduceSession(working, { type: 'tick', at: at(60) }));
    const set = r.state.sets.find((x) => x.id === hang.id);
    expect(set?.status).toBe('pending');
    expect(set?.draft?.durationS).toBe(45);
    expect(r.events).toEqual([expect.objectContaining({ type: 'WorkIntervalEnded', reason: 'completed' })]);
  });

  it('Stop records the elapsed time as the draft', () => {
    const { s, hang } = atHang();
    const working = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w1', setId: hang.id, durationS: 45 });
    const stopped = apply(working, { type: 'stop_work_interval', at: at(48), opId: 'w2', setId: hang.id });
    expect(stopped.sets.find((x) => x.id === hang.id)?.draft?.durationS).toBe(38);
  });

  it('M6: Stop just after the deadline succeeds; the planned time is the draft and nothing is saved', () => {
    const { s, hang } = atHang();
    const working = apply(s, { type: 'start_work_interval', at: at(0), opId: 'w1', setId: hang.id, durationS: 45 });
    const r = expectOk(reduceSession(working, { type: 'stop_work_interval', at: at(46), opId: 'stop', setId: hang.id }));
    expect(r.events).toEqual([expect.objectContaining({ type: 'WorkIntervalEnded', reason: 'completed', elapsedS: 45 })]);
    expect(r.state.workInterval?.status).toBe('completed');
    expect(r.state.sets.find((x) => x.id === hang.id)).toMatchObject({ status: 'pending', draft: { durationS: 45 } });
    // A retried Stop is a duplicate, not an error.
    expect(expectOk(reduceSession(r.state, { type: 'stop_work_interval', at: at(47), opId: 'stop', setId: hang.id })).duplicate).toBe(true);
  });

  it('M6: a rejected command still returns the clock catch-up so the expiry can be persisted', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    const resting = apply(state, logCmd(w.id, values(kg(60), 10), 30)); // deadline at 90
    const r = reduceSession(resting, { type: 'set_active_set', at: at(120), opId: 'x', setId: w.id, expectedVersion: resting.session.version });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('set_not_pending');
    expect(r.state.restTimer).toMatchObject({ status: 'expired', endedAtUtc: at(90).utc });
    expect(r.state.revision).toBe(resting.revision + 1);
    expect(r.events).toEqual([expect.objectContaining({ type: 'RestEnded', reason: 'expired' })]);
    expect(r.state.processedOps.x).toBeUndefined();
    expect(r.state.sets).toEqual(resting.sets);
    // Before the deadline a rejection returns the input state untouched.
    const early = reduceSession(resting, { type: 'set_active_set', at: at(40), opId: 'x', setId: w.id, expectedVersion: resting.session.version });
    expect(!early.ok && early.state).toBe(resting);
  });

  it('cannot log while the work timer runs; cannot start a work timer on a rep set', () => {
    const { s, hang } = atHang();
    const working = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w1', setId: hang.id, durationS: 45 });
    expectError(reduceSession(working, logCmd(hang.id, values(null, null, { durationS: 20 }), 20)), 'work_interval_running');
    const b1 = bench(s)[1];
    expectError(
      reduceSession(s, { type: 'start_work_interval', at: at(10), opId: 'w9', setId: b1?.id ?? '', durationS: 45 }),
      'not_timed_exercise',
    );
  });

  it('pausing freezes the work timer and excludes paused time from elapsed', () => {
    const { s, hang } = atHang();
    let x = apply(s, { type: 'start_work_interval', at: at(0), opId: 'w1', setId: hang.id, durationS: 45 });
    x = apply(x, { type: 'pause', at: at(20), opId: 'p' });
    x = apply(x, { type: 'tick', at: at(200) });
    expect(x.workInterval?.status).toBe('paused');
    x = apply(x, { type: 'resume', at: at(200), opId: 'r' });
    x = apply(x, { type: 'stop_work_interval', at: at(210), opId: 's', setId: hang.id });
    expect(x.sets.find((y) => y.id === hang.id)?.draft?.durationS).toBe(30);
  });
});

describe('pause and resume', () => {
  it('pause at 1:10 left, resume 2 min later: rest resumes at 1:10 and active time excludes the pause', () => {
    const { state } = startFixture();
    const [, b1] = bench(state);
    if (!b1) throw new Error('fixture');
    let s = apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: b1.id, expectedVersion: 1 });
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100)); // deadline at 280
    s = apply(s, { type: 'pause', at: at(210), opId: 'p1' }); // 70 s left
    expect(getSessionPhase(s, ms(250))).toMatchObject({ kind: 'paused', timerRemainingMs: 70_000 });

    // Nothing expires or changes during the pause.
    expect(apply(s, { type: 'tick', at: at(330) })).toBe(s);
    expectError(reduceSession(s, { type: 'skip_rest', at: at(300), opId: 'x', timerId: s.restTimer?.id ?? '' }), 'session_paused');

    s = apply(s, { type: 'resume', at: at(330), opId: 'r1' });
    expect(getSessionPhase(s, ms(330))).toMatchObject({ kind: 'resting', remainingMs: 70_000 });
    expect(getActiveDurationMs(s, ms(400))).toBe(400_000 - 120_000);
  });

  it('pause and resume are not repeatable by accident', () => {
    const { state } = startFixture();
    const paused = apply(state, { type: 'pause', at: at(1), opId: 'p1' });
    expectError(reduceSession(paused, { type: 'pause', at: at(2), opId: 'p2' }), 'session_paused');
    expect(expectOk(reduceSession(paused, { type: 'pause', at: at(2), opId: 'p1' })).duplicate).toBe(true);
    expectError(reduceSession(state, { type: 'resume', at: at(2), opId: 'r' }), 'not_paused');
  });

  it('active duration counts an open pause as paused', () => {
    const { state } = startFixture();
    const paused = apply(state, { type: 'pause', at: at(60), opId: 'p1' });
    expect(getActiveDurationMs(paused, ms(600))).toBe(60_000);
  });
});

describe('finish', () => {
  it('rejects a stale version', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    const s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 30));
    expectError(reduceSession(s, { type: 'finish', at: at(100), opId: 'f', expectedVersion: 1, endedAt: null }), 'stale_version');
  });

  it('marks pending sets skipped with audit, cancels rest, and locks the session', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const r = expectOk(reduceSession(s, { type: 'finish', at: at(40), opId: 'f', expectedVersion: 2, endedAt: null }));
    expect(r.state.session).toMatchObject({ status: 'finished', endedAt: at(40), activeSetId: null });
    expect(r.state.sets.filter((x) => x.status === 'skipped')).toHaveLength(7);
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(r.state.audit.filter((a) => a.kind === 'skipped')).toHaveLength(7);
    expect(r.events.at(-1)).toEqual({ type: 'SessionFinished' });
    expectError(reduceSession(r.state, logCmd(bench(r.state)[1]?.id ?? '', values(kg(100), 8), 50)), 'session_finished');
  });

  it('accepts a corrected end time and still allows corrections afterwards (scenario 5)', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(100), 8), 30));
    const done = apply(s, { type: 'finish', at: at(9000), opId: 'f', expectedVersion: 2, endedAt: at(600) });
    expect(getActiveDurationMs(done, ms(99_999))).toBe(600_000);
    const fixed = apply(done, { type: 'correct_set', at: at(9100), opId: 'c', setId: w.id, expectedSetVersion: 2, patch: { load: kg(95) } });
    expect(fixed.sets.find((x) => x.id === w.id)?.actual?.load).toEqual(kg(95));
  });

  it('rejects an end time before the start', () => {
    const { state } = startFixture();
    expectError(
      reduceSession(state, { type: 'finish', at: at(100), opId: 'f', expectedVersion: 1, endedAt: at(-10) }),
      'invalid_time',
    );
  });

  it('M7: the end time can be neither in the future nor before the last completed set', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 300));
    const finish = (endedAt: ReturnType<typeof at>) =>
      reduceSession(s, { type: 'finish', at: at(1000), opId: 'f', expectedVersion: 2, endedAt });
    expectError(finish(at(1000 + 26 * 3600)), 'invalid_time');
    expectError(finish(at(1001)), 'invalid_time');
    expectError(finish(at(299)), 'invalid_time');
    expectOk(finish(at(300)));
    expectOk(finish(at(1000)));
  });

  it('M7/S5: a chosen end time keeps the tap time in the timing audit', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 300));
    const done = apply(s, { type: 'finish', at: at(5000), opId: 'f', expectedVersion: 2, endedAt: at(480) });
    expect(done.session.endedAt).toEqual(at(480));
    expect(done.timingAudit).toEqual([
      {
        id: 'f:endedAt',
        sessionId: s.session.id,
        opId: 'f',
        field: 'endedAt',
        source: 'finish',
        atUtc: at(5000).utc,
        before: at(5000),
        after: at(480),
      },
    ]);
    // Finishing at the tap time records no timing change.
    expect(apply(s, { type: 'finish', at: at(5000), opId: 'f2', expectedVersion: 2, endedAt: null }).timingAudit).toEqual([]);
  });

  it('S4: Finish is refused while a work timer runs or is paused; after Stop the elapsed draft is kept on the skipped set', () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    let s = apply(state, { type: 'start_work_interval', at: at(10), opId: 'w', setId: hang.id, durationS: 45 });
    const v = s.session.version;
    expectError(reduceSession(s, { type: 'finish', at: at(30), opId: 'f', expectedVersion: v, endedAt: null }), 'work_interval_running');
    const paused = apply(s, { type: 'pause', at: at(30), opId: 'p' });
    expectError(reduceSession(paused, { type: 'finish', at: at(31), opId: 'f', expectedVersion: v, endedAt: null }), 'work_interval_running');
    s = apply(s, { type: 'stop_work_interval', at: at(48), opId: 'stop', setId: hang.id });
    const done = apply(s, { type: 'finish', at: at(50), opId: 'f', expectedVersion: v, endedAt: null });
    expect(done.sets.find((x) => x.id === hang.id)).toMatchObject({ status: 'skipped', actual: null, draft: { durationS: 38 } });
  });

  it('nit 5: a set cannot be logged before the workout started', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    expectError(reduceSession(state, logCmd(w?.id ?? '', values(kg(60), 10), -5)), 'invalid_time');
  });
});

describe('update_session_timing (Edit workout times)', () => {
  const finished = () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 120));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 400));
    return apply(s, { type: 'finish', at: at(4000), opId: 'f', expectedVersion: s.session.version, endedAt: null });
  };

  it('corrects start and end with an audit entry that keeps the previous values', () => {
    const s = finished();
    const r = expectOk(
      reduceSession(s, { type: 'update_session_timing', at: at(5000), opId: 't', expectedVersion: s.session.version, startedAt: at(60), endedAt: at(600) }),
    );
    expect(r.state.session).toMatchObject({ startedAt: at(60), endedAt: at(600), version: s.session.version + 1 });
    expect(r.state.timingAudit.map((e) => [e.field, e.source, e.before?.utc, e.after.utc])).toEqual([
      ['startedAt', 'correction', at(0).utc, at(60).utc],
      ['endedAt', 'correction', at(4000).utc, at(600).utc],
    ]);
    expect(getActiveDurationMs(r.state, ms(99_999))).toBe(540_000);
  });

  it('rejects times outside the logged sets, in the future, or stale', () => {
    const s = finished();
    const v = s.session.version;
    const upd = (startedAt: ReturnType<typeof at> | null, endedAt: ReturnType<typeof at> | null, expectedVersion = v) =>
      reduceSession(s, { type: 'update_session_timing', at: at(5000), opId: 't', expectedVersion, startedAt, endedAt });
    expectError(upd(at(121), null), 'invalid_time'); // after the first set
    expectError(upd(null, at(399)), 'invalid_time'); // before the last set
    expectError(upd(null, at(5001)), 'invalid_time'); // future
    expectError(upd(at(-60), null, v - 1), 'stale_version');
    expectOk(upd(at(-60), null));
  });

  it('the end time can only be edited after Finish; a discarded-style status rejects corrections (nit 4)', () => {
    const { state } = startFixture();
    expectError(
      reduceSession(state, { type: 'update_session_timing', at: at(10), opId: 't', expectedVersion: 1, startedAt: null, endedAt: at(5) }),
      'session_not_finished',
    );
    const discarded = { ...state, session: { ...state.session, status: 'discarded' as const } };
    expectError(
      reduceSession(discarded, { type: 'correct_set', at: at(10), opId: 'c', setId: bench(state)[0]?.id ?? '', expectedSetVersion: 1, patch: { reps: 3 } }),
      'session_finished',
    );
  });
});

describe('drafts and prefill', () => {
  it('save_draft stores unsaved edits without counting them or bumping the version', () => {
    const { state } = startFixture();
    const b1 = bench(state)[1];
    if (!b1) throw new Error('fixture');
    const s = apply(state, { type: 'save_draft', at: at(5), setId: b1.id, values: values(kg(100), 7) });
    expect(s.session.version).toBe(state.session.version);
    expect(s.sets.find((x) => x.id === b1.id)).toMatchObject({ status: 'pending', draft: values(kg(100), 7) });
    expect(prefillDraft(s, b1.id)).toEqual({ values: values(kg(100), 7), source: 'draft' });
  });

  it('prefills from target: load and top of the rep range, no effort', () => {
    const { state } = startFixture();
    const b1 = bench(state)[1];
    expect(prefillDraft(state, b1?.id ?? '')).toEqual({ values: values(kg(100), 8), source: 'target' });
  });

  it('empty-workout style sets fall back to this session, then last session, then empty', () => {
    const { state } = startFixture();
    const [w, b1, b2] = bench(state);
    if (!w || !b1 || !b2) throw new Error('fixture');
    const noTarget = { load: null, reps: null, durationS: null, rpe: null, rir: null };
    let s = { ...state, sets: state.sets.map((x) => (x.id === b2.id ? { ...x, planned: noTarget } : x)) };
    expect(prefillDraft(s, b2.id, [{ index: 2, values: values(kg(97.5), 7, { rpe: 9 }) }])).toEqual({
      values: values(kg(97.5), 7),
      source: 'last_session',
    });
    expect(prefillDraft(s, b2.id)).toEqual({ values: values(null, null), source: 'none' });
    s = apply(s, logCmd(b1.id, values(kg(102.5), 6, { rpe: 9 }), 30));
    expect(prefillDraft(s, b2.id)).toEqual({ values: values(kg(102.5), 6), source: 'this_session' });
  });
});

describe('persistence shape', () => {
  it('stays schema-valid through a full sequence of commands', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, { type: 'correct_set', at: at(35), opId: 'c', setId: w.id, expectedSetVersion: 2, patch: { rpe: 6 } });
    s = apply(s, { type: 'pause', at: at(40), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(50), opId: 'r' });
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 120));
    s = apply(s, { type: 'finish', at: at(200), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const parsed = SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s)));
    expect(parsed.success).toBe(true);
    expect(s.session.gymId).toBe(GYM);
  });
});
