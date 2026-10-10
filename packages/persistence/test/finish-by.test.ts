import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, dumbbells, GYM, id, idGen, kg, OWNER, profile, richFinishedSession, routine, routineExercise, SPLIT_SQUAT, template } from '@fizz/domain/testing';
import { openStore, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/** `Finish by` (active-workout §2.15.3): schema 5 stores it on the session row. */

async function seed(store: Store): Promise<void> {
  const { repos } = store;
  await repos.profiles.save(profile(), null);
  await repos.equipment.save(dumbbells(), null);
  await repos.exercises.save(SPLIT_SQUAT, null);
  await repos.routines.save(
    routine([
      routineExercise(700, {
        exerciseId: SPLIT_SQUAT.id,
        equipmentId: dumbbells().id,
        setTemplates: [7001, 7002].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
      }),
    ]),
    null,
  );
}

describe('Finish by survives a force-close (restart recovery)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('is stored, a retry after relaunch is a duplicate, a stale sheet is refused, and Not set clears the columns', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const cmd = { type: 'set_finish_by' as const, at: at(60), opId: 'fb-1', finishBy: at(2700), expectedVersion: started.aggregate.session.version };
    const saved = await service.dispatch(sessionId, cmd);
    if (!saved.ok) throw new Error(saved.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(120));
    expect(recovered?.state.session.finishBy).toEqual(at(2700));
    expect(await service.dispatch(sessionId, cmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expect(await service.dispatch(sessionId, { ...cmd, opId: 'fb-2', finishBy: at(3000) })).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    const cleared = await service.dispatch(sessionId, { ...cmd, at: at(130), opId: 'fb-3', finishBy: null, expectedVersion: saved.aggregate.session.version });
    expect(cleared.ok).toBe(true);
    const row = await store.db.driver.getFirst<{ finish_by_utc: string | null; finish_by_tz: string | null }>('SELECT finish_by_utc, finish_by_tz FROM sessions WHERE id = ?', [sessionId]);
    expect(row).toEqual({ finish_by_utc: null, finish_by_tz: null });
    expect((await store.repos.sessions.get(sessionId))?.session).not.toHaveProperty('finishBy');
    await store.close();
  });
});

describe('the finish_by columns', () => {
  let store: Store;
  beforeEach(async () => {
    store = await openStore(memoryDriver());
  });
  afterEach(async () => {
    await store.close();
  });

  it('round-trip the rich session; NULL (every workout before schema 5) reads as not set', async () => {
    const rich = richFinishedSession();
    expect(rich.session.finishBy).toBeDefined();
    await store.repos.sessions.save(rich, null);
    expect(await store.repos.sessions.get(rich.session.id)).toEqual(rich);
    await store.db.driver.run('UPDATE sessions SET finish_by_utc = NULL, finish_by_tz = NULL');
    expect((await store.repos.sessions.get(rich.session.id))?.session).not.toHaveProperty('finishBy');
  });

  it('refuses a time without its zone at the database', async () => {
    const rich = richFinishedSession();
    await store.repos.sessions.save(rich, null);
    await expect(store.db.driver.run('UPDATE sessions SET finish_by_tz = NULL')).rejects.toThrow();
  });
});
