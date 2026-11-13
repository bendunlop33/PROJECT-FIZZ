import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCheckInPatch, createSessionService, newCheckIn, newPainFlag, type WriteFence } from '@fizz/domain';
import { at, dumbbells, GYM, id, idGen, kg, OWNER, profile, routine, routineExercise, SPLIT_SQUAT, template } from '@fizz/domain/testing';
import { openStore, type Store } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * A start fenced on what its preview was planned from (workout-overview §7,
 * review S3): the inputs are re-read inside the session write's own
 * transaction, so a change that lands after the caller's key check creates
 * nothing.
 */
let store: Store;
const ROUTINE = routine([
  routineExercise(700, {
    exerciseId: SPLIT_SQUAT.id,
    equipmentId: dumbbells().id,
    setTemplates: [7001, 7002].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
  }),
]);
const CHECK_IN = newCheckIn({ id: id(900), ownerId: OWNER, opId: 'ci', score: 4, reasons: [], at: at(0), localDate: '2026-10-08' });

beforeEach(async () => {
  store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  await store.repos.equipment.save(dumbbells(), null);
  await store.repos.exercises.save(SPLIT_SQUAT, null);
  await store.repos.routines.save(ROUTINE, null);
  await store.repos.checkIns.save(CHECK_IN, null);
});
afterEach(async () => {
  await store.close();
});

function fence(over: Partial<WriteFence> = {}): WriteFence {
  return {
    rows: [
      { table: 'routines', id: ROUTINE.id, version: 1 },
      { table: 'check_ins', id: CHECK_IN.id, version: 1 },
      { table: 'profiles', id: OWNER, version: 1 },
    ],
    sets: [
      { kind: 'gym_equipment', gymId: GYM, members: [{ id: dumbbells().id, version: 1 }] },
      { kind: 'active_pain_flags', ownerId: OWNER, members: [] },
    ],
    ...over,
  };
}

const start = (f: WriteFence, opId = 'start-1') =>
  createSessionService(store.repos, idGen(80_000)).startRoutine({ ownerId: OWNER, gymId: GYM, routineId: ROUTINE.id, opId, at: at(10), fence: f });

describe('fenced start', () => {
  it('writes when every pinned row and set is unchanged', async () => {
    const r = await start(fence());
    expect(r.ok).toBe(true);
    expect(await store.repos.sessions.getActive(OWNER)).not.toBeNull();
  });

  it('a check-in edited after the check (version bump) creates nothing', async () => {
    const patched = applyCheckInPatch(CHECK_IN, { score: 2 }, 'op-x', at(5));
    if (patched.kind !== 'updated') throw new Error(patched.kind);
    await store.repos.checkIns.save(patched.checkIn, 1);
    expect(await start(fence())).toMatchObject({ ok: false, error: { code: 'stale_inputs' } });
    expect(await store.repos.sessions.getActive(OWNER)).toBeNull();
  });

  it('a new active pain flag, an equipment edit or a missing row creates nothing', async () => {
    const flag = newPainFlag({ id: id(400), ownerId: OWNER, opId: 'p', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: null, source: 'check_in', checkInId: null, at: at(0) });
    await store.repos.painFlags.save(flag, null);
    expect(await start(fence())).toMatchObject({ ok: false, error: { code: 'stale_inputs' } });
    // The flag pinned: passes the set check, but an equipment version that moved on fails it.
    const withFlag = fence({ sets: [{ kind: 'gym_equipment', gymId: GYM, members: [{ id: dumbbells().id, version: 2 }] }, { kind: 'active_pain_flags', ownerId: OWNER, members: [{ id: flag.id, version: 1 }] }] });
    expect(await start(withFlag)).toMatchObject({ ok: false, error: { code: 'stale_inputs' } });
    // A pinned source workout that doesn't exist (deleted, or never there).
    expect(await start(fence({ rows: [{ table: 'sessions', id: id(999), version: 3 }] }))).toMatchObject({ ok: false, error: { code: 'stale_inputs' } });
    expect(await store.repos.sessions.getActive(OWNER)).toBeNull();
    // Everything as stored now: it starts.
    const fresh = fence({ sets: [{ kind: 'gym_equipment', gymId: GYM, members: [{ id: dumbbells().id, version: 1 }] }, { kind: 'active_pain_flags', ownerId: OWNER, members: [{ id: flag.id, version: 1 }] }] });
    expect((await start(fresh)).ok).toBe(true);
  });

  it('a retry of a start that landed is its duplicate, whatever the fence says (opId first)', async () => {
    const first = await start(fence());
    if (!first.ok) throw new Error(first.error.message);
    const retry = await start(fence({ rows: [{ table: 'routines', id: ROUTINE.id, version: 99 }] }));
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (retry.ok) expect(retry.aggregate.session.id).toBe(first.aggregate.session.id);
  });

  it('the coach’s stored next-session targets (ADR 0021): the same rows start; a row that changed or appeared creates nothing', async () => {
    const SOURCE = id(950);
    const none = fence({ sets: [...fence().sets, { kind: 'next_session_targets', ownerId: OWNER, sourceSessionId: SOURCE, members: [] }] });
    // A row the preview saw that is gone (or never stored) fails the set check.
    const phantom = fence({ sets: [...fence().sets, { kind: 'next_session_targets', ownerId: OWNER, sourceSessionId: SOURCE, members: [{ id: id(951), version: 1 }] }] });
    expect(await start(phantom)).toMatchObject({ ok: false, error: { code: 'stale_inputs' } });
    expect(await store.repos.sessions.getActive(OWNER)).toBeNull();
    expect((await start(none)).ok).toBe(true);
  });
});
