import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, dumbbells, exercise, GYM, id, idGen, kg, OWNER, profile, routine, routineExercise, template } from '@fizz/domain/testing';
import { openStore } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/** 18 Oct `+ Weight`: a bodyweight exercise switched to added weight, and its weighted set, survive a force-close; no migration. */
const BACK_EXT = exercise(720, '45° back extension', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', movementPattern: 'hinge' });

describe('added weight survives a restart', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('the row convention, a weighted set and the routine flag come back; a retried switch is a duplicate', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await store.repos.profiles.save(profile(), null);
    await store.repos.equipment.save(dumbbells(), null);
    await store.repos.exercises.save(BACK_EXT, null);
    await store.repos.routines.save(routine([routineExercise(721, { exerciseId: BACK_EXT.id, setTemplates: [7211, 7212].map((n) => template(n, { targetReps: { min: 12, max: 12 } })) })]), null);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const rowId = started.aggregate.exercises[0]?.id ?? '';
    const switchCmd = { type: 'set_load_mode' as const, at: at(10), opId: 'mode-1', expectedVersion: started.aggregate.session.version, sessionExerciseId: rowId, mode: 'added' as const };
    const switched = await service.dispatch(sessionId, switchCmd);
    if (!switched.ok) throw new Error(switched.error.code);
    const first = switched.aggregate.sets[0];
    const logged = await service.dispatch(sessionId, { type: 'log_set', at: at(60), opId: 'log-1', setId: first?.id ?? '', values: { load: kg(10, 'added'), reps: 12, durationS: null, rpe: null, rir: null }, restTimerId: id(9001) });
    if (!logged.ok) throw new Error(logged.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(90));
    expect(recovered?.state.exercises[0]?.loadConvention).toBe('added');
    expect(recovered?.state.sets.find((s) => s.id === first?.id)?.actual?.load).toEqual(kg(10, 'added'));
    expect(await service.dispatch(sessionId, switchCmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });

    // A saved workout keeps `Add weight`.
    const r = routine([routineExercise(722, { exerciseId: BACK_EXT.id, addedWeight: true })]);
    await store.repos.routines.save({ ...r, id: id(301) }, null);
    expect((await store.repos.routines.get(id(301)))?.exercises[0]?.addedWeight).toBe(true);
    await store.close();
  });
});
