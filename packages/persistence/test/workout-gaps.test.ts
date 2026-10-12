import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSwapExerciseCommand, createSessionService } from '@fizz/domain';
import { at, dumbbells, exercise, GYM, id, idGen, kg, logCmd, OWNER, profile, routine, routineExercise, SPLIT_SQUAT, template, values } from '@fizz/domain/testing';
import { createBackup, openStore, parseBackup, readUserVersion, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/** Schema 10 (workout gaps): notes, removed and swapped rows, distance sets survive a force-close and a backup. */

const GOBLET = exercise(250, 'Goblet squat', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const SLED = exercise(251, 'Sled push', { measurement: 'distance', compatibleEquipment: [], defaultLoadConvention: 'added' });
const PLANK = exercise(252, 'Plank', { measurement: 'duration', compatibleEquipment: [], defaultLoadConvention: 'bodyweight' });

async function seed(store: Store): Promise<void> {
  const { repos } = store;
  await repos.profiles.save(profile(), null);
  await repos.equipment.save(dumbbells(), null);
  for (const e of [SPLIT_SQUAT, GOBLET, SLED, PLANK]) await repos.exercises.save(e, null);
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

describe('workout gaps survive a force-close (schema 10)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('swap, notes, a removed exercise and a distance set read back exactly; Undo works after relaunch', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    expect(await store.db.read((q) => readUserVersion(q))).toBe(13);
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sid = started.aggregate.session.id;
    const ok = async (cmd: Parameters<typeof service.dispatch>[1]) => {
      const r = await service.dispatch(sid, cmd);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      return r.aggregate;
    };
    const first = started.aggregate.sets[0]?.id ?? '';
    let a = await ok(logCmd(first, values(kg(15, 'per_hand'), 10), 60, 'log-1'));
    const row = a.exercises[0]?.id ?? '';
    a = await ok({ type: 'set_note', at: at(70), opId: 'note-ex', target: { kind: 'exercise', sessionExerciseId: row }, note: 'Bench at 3', expectedVersion: a.session.version });
    a = await ok({ type: 'set_note', at: at(71), opId: 'note-set', target: { kind: 'set', setId: first }, note: 'Left knee fine', expectedVersion: a.session.version });

    const swap = buildSwapExerciseCommand({ aggregate: a, sessionExerciseId: row, plan: { exercise: GOBLET, pin: null, plan: null }, gymName: 'Main', ownerUnit: 'kg', opId: 'swap-1', at: at(80), newId: idGen(81_000) });
    if (!swap.ok) throw new Error(swap.reason);
    a = await ok(swap.command);
    const added = await service.addExercise(sid, { ownerId: OWNER, exerciseId: SLED.id, equipmentId: null, opId: 'add-sled', at: at(90) });
    if (!added.ok) throw new Error(added.error.code);
    a = added.aggregate;
    const sledSet = a.sets.find((s) => a.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === SLED.id)?.id ?? '';
    a = await ok(logCmd(sledSet, values(kg(40, 'added'), null, { distanceM: 25 }), 120, 'log-sled'));
    const plank = await service.addExercise(sid, { ownerId: OWNER, exerciseId: PLANK.id, equipmentId: null, opId: 'add-plank', at: at(130) });
    if (!plank.ok) throw new Error(plank.error.code);
    const plankRow = plank.aggregate.exercises.find((e) => e.exerciseId === PLANK.id)?.id ?? '';
    a = await ok({ type: 'remove_exercise', at: at(131), opId: 'rm-plank', sessionExerciseId: plankRow, expectedVersion: plank.aggregate.session.version });
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(140));
    expect(recovered?.state).toEqual(a);
    const s = recovered?.state;
    expect(s?.exercises.find((e) => e.id === row)).toMatchObject({ note: 'Bench at 3' });
    expect(s?.exercises.find((e) => e.exerciseId === GOBLET.id)?.swappedFrom).toEqual({ sessionExerciseId: row, opId: 'swap-1' });
    expect(s?.exercises.find((e) => e.exerciseId === SLED.id)?.measurement).toBe('distance');
    expect(s?.sets.find((x) => x.id === sledSet)?.actual).toMatchObject({ distanceM: 25, load: kg(40, 'added') });
    expect(s?.exercises.find((e) => e.id === plankRow)?.removed).toMatchObject({ by: 'remove', opId: 'rm-plank' });

    // A retry of the swap after relaunch is a duplicate; its Undo still works, once.
    const retry = await service.dispatch(sid, swap.command);
    expect(retry.ok && retry.duplicate).toBe(true);
    const undone = await service.dispatch(sid, { type: 'undo_op', at: at(150), opId: 'undo-swap', targetOpId: 'swap-1' });
    if (!undone.ok) throw new Error(undone.error.code);
    expect(undone.aggregate.sets.filter((x) => x.sessionExerciseId === row).map((x) => x.status)).toEqual(['completed', 'pending']);
    const again = await service.dispatch(sid, { type: 'undo_op', at: at(151), opId: 'undo-swap-2', targetOpId: 'swap-1' });
    expect(again.ok).toBe(false);

    // A backup carries the new columns, and restores them.
    const created = await createBackup(store, { at: at(160), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: 'test' } });
    const parsed = await parseBackup(created.text);
    if (!parsed.ok) throw new Error('backup');
    const tables = parsed.file.tables;
    expect(tables.session_exercises?.some((r) => r.note === 'Bench at 3' && r.measures_distance === null)).toBe(true);
    expect(tables.session_exercises?.some((r) => r.measures_distance === 1 && r.measurement === 'reps')).toBe(true);
    expect(tables.session_sets?.some((r) => r.actual_distance_m === 25 && r.note === null)).toBe(true);
    expect(tables.session_sets?.some((r) => r.note === 'Left knee fine')).toBe(true);
    await store.close();
  });
});
