import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import {
  createMemoryRepositories,
  createSessionService,
  draftOperationId,
  getSessionPhase,
  recoverSession,
  STALE_SESSION_MS,
  type Repositories,
} from '../src/index';
import { at, barbell, GYM, id, idGen, kg, ms, OWNER, profile, stack, values } from './fixtures';
import { apply, BENCH, exercises, HANG, logCmd, setsFor, startFixture } from './session-fixture';

/** Simulate a force-close: the only thing that survives is what was persisted. */
const persistAndReload = (s: SessionAggregate): SessionAggregate => JSON.parse(JSON.stringify(s)) as SessionAggregate;

describe('recoverSession (cold start)', () => {
  const resting = () => {
    const { state } = startFixture();
    const b1 = setsFor(state, BENCH)[1];
    if (!b1) throw new Error('fixture');
    const s = apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: b1.id, expectedVersion: 1 });
    return apply(s, logCmd(b1.id, values(kg(100), 8), 100)); // 180 s rest, deadline at 280
  };

  it('reopened within the rest: shows the true remaining time, not the full preset', () => {
    const r = recoverSession(persistAndReload(resting()), at(110));
    expect(r.openInto).toBe('active_workout');
    expect(r.notices).toEqual([{ kind: 'restored' }]);
    expect(getSessionPhase(r.state, ms(110))).toMatchObject({ kind: 'resting', remainingMs: 170_000 });
    expect(r.missedEvents).toEqual([]);
  });

  it('reopened after the deadline: Ready with "Rest ended at" and no live cue', () => {
    const r = recoverSession(persistAndReload(resting()), at(600));
    expect(r.notices).toContainEqual({ kind: 'rest_ended_while_closed', endedAtUtc: at(280).utc });
    expect(r.missedEvents).toEqual([expect.objectContaining({ type: 'RestEnded', reason: 'expired', lateByMs: 320_000 })]);
    expect(getSessionPhase(r.state, ms(600))).toMatchObject({ kind: 'ready', restEnded: { endedAtUtc: at(280).utc } });
    expect(r.state.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
  });

  it('a stale (>= 6 h) unfinished workout opens on Today', () => {
    const r = recoverSession(persistAndReload(resting()), at(100 + STALE_SESSION_MS / 1000));
    expect(r.openInto).toBe('today');
    expect(r.notices[0]).toEqual({ kind: 'stale_workout', lastActivityAtUtc: at(100).utc });
  });

  it('a paused workout comes back exactly as left', () => {
    const paused = apply(resting(), { type: 'pause', at: at(210), opId: 'p' });
    const r = recoverSession(persistAndReload(paused), at(4000));
    expect(getSessionPhase(r.state, ms(4000))).toMatchObject({ kind: 'paused', timerRemainingMs: 70_000 });
    expect(r.missedEvents).toEqual([]);
  });

  it('restores an unsaved draft edit without marking the set done', () => {
    const s = resting();
    const b2 = setsFor(s, BENCH)[2];
    if (!b2) throw new Error('fixture');
    const edited = apply(s, { type: 'save_draft', at: at(120), setId: b2.id, values: values(kg(100), 7) });
    const r = recoverSession(persistAndReload(edited), at(130));
    expect(r.notices).toContainEqual({ kind: 'unsaved_edit_restored', setId: b2.id });
    expect(r.state.sets.find((x) => x.id === b2.id)).toMatchObject({ status: 'pending', draft: values(kg(100), 7) });
  });

  it('a work timer that ended while closed fills the planned time as a draft only', () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    let s = apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: hang.id, expectedVersion: 1 });
    s = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w', setId: hang.id, durationS: 45 });
    const r = recoverSession(persistAndReload(s), at(300));
    expect(r.notices).toContainEqual({ kind: 'work_timer_ended_while_closed', setId: hang.id });
    expect(r.state.sets.find((x) => x.id === hang.id)).toMatchObject({ status: 'pending', draft: { durationS: 45 } });
  });

  it('killed during the Log write: retrying with the persisted draft opId commits exactly once', () => {
    const { state } = startFixture();
    const w = setsFor(state, BENCH)[0];
    if (!w) throw new Error('fixture');
    const opId = draftOperationId(w);

    // Case 1: the transaction did not commit; the draft opId is recomputed from persisted state.
    const beforeWrite = persistAndReload(state);
    const reopId = draftOperationId(beforeWrite.sets.find((x) => x.id === w.id) ?? w);
    expect(reopId).toBe(opId);
    const once = apply(beforeWrite, logCmd(w.id, values(kg(60), 10), 40, reopId));
    expect(once.sets.filter((x) => x.status === 'completed')).toHaveLength(1);

    // Case 2: the transaction committed; the retry is a duplicate.
    const afterWrite = persistAndReload(apply(state, logCmd(w.id, values(kg(60), 10), 30, opId)));
    const retry = apply(afterWrite, logCmd(w.id, values(kg(60), 10), 40, opId));
    expect(retry).toEqual(afterWrite);
  });
});

describe('session service over repository ports', () => {
  async function seed(): Promise<Repositories> {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
    for (const ex of exercises.values()) await repos.exercises.save(ex, null);
    const routine = startFixture().input.routine;
    if (!routine) throw new Error('fixture');
    await repos.routines.save(routine, null);
    return repos;
  }

  const startReq = (opId = 'start-1') => ({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId, at: at(0) });

  it('startWorkout is idempotent by operation ID, and only one session can be active', async () => {
    const repos = await seed();
    const svc = createSessionService(repos, idGen());
    const a = await svc.start(startReq());
    const b = await svc.start(startReq());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.duplicate).toBe(true);
      expect(b.aggregate.session.id).toBe(a.aggregate.session.id);
    }
    const c = await svc.start(startReq('start-2'));
    expect(c).toMatchObject({ ok: false, error: { code: 'session_already_active' } });
  });

  it('validates untrusted command input before it reaches the reducer', async () => {
    const repos = await seed();
    const svc = createSessionService(repos, idGen());
    const started = await svc.start(startReq());
    if (!started.ok) throw new Error('start');
    const out = await svc.dispatch(started.aggregate.session.id, { type: 'log_set', opId: 'x', setId: 'not-a-uuid' });
    expect(out).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
  });

  it('duplicate log through the service saves one set; a new service instance (restart) sees it', async () => {
    const repos = await seed();
    const svc = createSessionService(repos, idGen());
    const started = await svc.start(startReq());
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    const w = setsFor(started.aggregate, BENCH)[0];
    if (!w) throw new Error('fixture');
    const cmd = logCmd(w.id, values(kg(60), 10), 30, draftOperationId(w));
    const first = await svc.dispatch(sessionId, cmd);
    const second = await svc.dispatch(sessionId, cmd);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);

    const restarted = createSessionService(repos, idGen(50_000));
    const recovered = await restarted.recover(OWNER, at(45));
    expect(recovered?.openInto).toBe('active_workout');
    expect(recovered?.state.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
    expect(recovered && getSessionPhase(recovered.state, ms(45))).toMatchObject({ kind: 'resting', remainingMs: 45_000 });
  });

  it('retries safely after a write conflict', async () => {
    const repos = await seed();
    const svc = createSessionService(repos, idGen());
    const started = await svc.start(startReq());
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;

    // Another writer (e.g. a voice turn) commits a pause between our read and write.
    const realSave = repos.sessions.save.bind(repos.sessions);
    let interfered = false;
    repos.sessions.save = async (agg, expected) => {
      if (!interfered) {
        interfered = true;
        const current = await repos.sessions.get(sessionId);
        if (current) await realSave(apply(current, { type: 'pause', at: at(1), opId: 'other' }), current.revision);
      }
      return realSave(agg, expected);
    };
    const w = setsFor(started.aggregate, BENCH)[0];
    const out = await svc.dispatch(sessionId, logCmd(w?.id ?? '', values(kg(60), 10), 30));
    // The retry re-reads state, sees the pause and rejects the log rather than overwriting it.
    expect(out).toMatchObject({ ok: false, error: { code: 'session_paused' } });
    const stored = await repos.sessions.get(sessionId);
    expect(stored?.session.pause).not.toBeNull();
    expect(stored?.sets.every((s) => s.status === 'pending')).toBe(true);
  });

  it('recover returns null when there is no unfinished workout', async () => {
    const repos = await seed();
    expect(await createSessionService(repos, idGen()).recover(OWNER, at(0))).toBeNull();
  });
});
