import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, dumbbells, GYM, id, idGen, kg, OWNER, profile, routine, routineExercise, SPLIT_SQUAT, template } from '@fizz/domain/testing';
import { openStore, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

const INSERTED = id(7999);

/** 14 Oct "edit anything on the sets": a pending set's edit, its Undo record and an inserted set survive a force-close. */

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

describe('editing sets survives a restart', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('an edit, an inserted set and their Undo records come back after relaunch; a retry is a duplicate', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const [first, second] = started.aggregate.sets;
    if (!first || !second) throw new Error('no sets');
    const editCmd = { type: 'edit_planned_set' as const, at: at(30), opId: 'edit-1', setId: second.id, expectedSetVersion: second.version, patch: { load: kg(17.5, 'per_hand'), reps: { min: 6, max: 6 }, setType: 'top' as const, restS: 150 } };
    const edited = await service.dispatch(sessionId, editCmd);
    if (!edited.ok) throw new Error(edited.error.code);
    const inserted = await service.dispatch(sessionId, { type: 'add_set', at: at(40), opId: 'ins-1', sessionExerciseId: first.sessionExerciseId, newSetId: INSERTED, setType: null, afterSetId: first.id });
    if (!inserted.ok) throw new Error(inserted.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(60));
    expect(recovered?.state.sets).toEqual(inserted.aggregate.sets);
    expect(recovered?.state.sets.find((s) => s.id === second.id)?.planned.edit?.opId).toBe('edit-1');

    expect(await service.dispatch(sessionId, editCmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    const undone = await service.dispatch(sessionId, { type: 'undo_op', at: at(70), opId: 'undo:edit-1', targetOpId: 'edit-1' });
    if (!undone.ok) throw new Error(undone.error.code);
    expect(undone.aggregate.sets.find((s) => s.id === second.id)).toMatchObject({ planned: second.planned, setType: second.setType, rest: second.rest });
    const undoInsert = await service.dispatch(sessionId, { type: 'undo_op', at: at(80), opId: 'undo:ins-1', targetOpId: 'ins-1' });
    expect(undoInsert.ok && undoInsert.aggregate.sets.find((s) => s.id === INSERTED)?.status).toBe('deleted');
    await store.close();
  });
});
