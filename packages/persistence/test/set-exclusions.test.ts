import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, dumbbells, GYM, id, idGen, kg, logCmd, OWNER, profile, richFinishedSession, routine, routineExercise, SPLIT_SQUAT, template, values } from '@fizz/domain/testing';
import { CorruptDataError, openStore, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/** Sets that don't count (active-workout §2.13): schema 4 stores Ben's exclusion flags on `session_sets`. */

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

describe('exclusion marks survive a force-close (restart recovery)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('a mark is stored with its audit, a retry after relaunch is a duplicate, and a stale mark is refused', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const setId = started.aggregate.sets[0]?.id ?? '';
    const logged = await service.dispatch(sessionId, logCmd(setId, values(kg(15, 'per_hand'), 10), 60, 'log-1'));
    if (!logged.ok) throw new Error(logged.error.code);
    const mark = { type: 'correct_set' as const, at: at(90), opId: 'mark-1', setId, expectedSetVersion: 2, patch: { exclusions: ['spotted' as const] } };
    const marked = await service.dispatch(sessionId, mark);
    if (!marked.ok) throw new Error(marked.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(120));
    const set = recovered?.state.sets.find((s) => s.id === setId);
    expect(set).toEqual(marked.aggregate.sets.find((s) => s.id === setId));
    expect(set?.exclusions).toEqual(['spotted']);
    expect(recovered?.state.audit.at(-1)).toMatchObject({ kind: 'corrected', opId: 'mark-1', after: { exclusions: ['spotted'] } });

    expect(await service.dispatch(sessionId, mark)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expect(await service.dispatch(sessionId, { ...mark, opId: 'mark-2', patch: { exclusions: [] } })).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    // Undo: a second, versioned correction. The column goes back to NULL.
    const undo = await service.dispatch(sessionId, { ...mark, opId: 'mark-undo', expectedSetVersion: 3, patch: { exclusions: [] } });
    expect(undo.ok).toBe(true);
    const row = await store.db.driver.getFirst<{ exclusions: string | null }>('SELECT exclusions FROM session_sets WHERE id = ?', [setId]);
    expect(row?.exclusions).toBeNull();
    const stored = await store.repos.sessions.get(sessionId);
    expect(stored?.sets.find((s) => s.id === setId)).not.toHaveProperty('exclusions');
    expect(stored?.audit.map((a) => a.kind)).toEqual(['logged', 'corrected', 'corrected']);
    await store.close();
  });
});

describe('the exclusions column', () => {
  let store: Store;
  beforeEach(async () => {
    store = await openStore(memoryDriver());
  });
  afterEach(async () => {
    await store.close();
  });
  const sql = (text: string, params: (string | number | null)[] = []) => store.db.driver.run(text, params);

  it('stores the canonical JSON list; NULL (every set before schema 4) reads as a set that counts', async () => {
    const rich = richFinishedSession();
    await store.repos.sessions.save(rich, null);
    const marked = rich.sets.find((s) => s.exclusions !== undefined);
    expect(marked?.exclusions).toEqual(['spotted', 'technique']);
    const row = await store.db.driver.getFirst<{ exclusions: string | null }>('SELECT exclusions FROM session_sets WHERE id = ?', [marked?.id ?? '']);
    expect(row?.exclusions).toBe('["spotted","technique"]');
    expect(await store.repos.sessions.get(rich.session.id)).toEqual(rich);

    await sql('UPDATE session_sets SET exclusions = NULL');
    const legacy = await store.repos.sessions.get(rich.session.id);
    expect(legacy?.sets.every((s) => !('exclusions' in s))).toBe(true);
  });

  it('rejects anything but a JSON array at the database, and an unknown reason on read', async () => {
    const rich = richFinishedSession();
    await store.repos.sessions.save(rich, null);
    const setId = rich.sets[0]?.id ?? '';
    await expect(sql('UPDATE session_sets SET exclusions = ? WHERE id = ?', ['spotted', setId])).rejects.toThrow();
    await expect(sql('UPDATE session_sets SET exclusions = ? WHERE id = ?', ['{"a":1}', setId])).rejects.toThrow();
    await sql('UPDATE session_sets SET exclusions = ? WHERE id = ?', ['["assisted"]', setId]);
    await expect(store.repos.sessions.get(rich.session.id)).rejects.toBeInstanceOf(CorruptDataError);
  });
});
