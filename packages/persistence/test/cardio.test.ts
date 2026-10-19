import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildActiveSetView, catalogueExerciseId, createSessionService, stableStringify } from '@fizz/domain';
import { at, exercise, GYM, id, idGen, kg, logCmd, OWNER, profile, routine, routineExercise, template, values } from '@fizz/domain/testing';
import type { Exercise, SessionAggregate } from '@fizz/schemas';
import { createBackup, DatabaseManager, latestVersion, openStore, parseBackup, sha256Hex, type BackupFile, type Store } from '../src/index';
import { nodeDatabaseHost, openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * Schema 20 (cardio, 19 Oct): a cardio row is stored as `duration` +
 * `measures_cardio`; its timer is the stored work interval, so a force-close
 * loses nothing; the four catalogue machines that were `distance` or
 * `duration` become `cardio` in history and in saved exercise rows.
 */

const ROWING_ID = catalogueExerciseId('rowing-erg');
const AIR_BIKE_ID = catalogueExerciseId('air-bike');
const machine = (exerciseId: string, name: string, measurement: Exercise['measurement']): Exercise => ({
  ...exercise(0, name, { measurement, compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', movementPattern: 'conditioning' }),
  id: exerciseId,
  catalogueKey: exerciseId === ROWING_ID ? 'rowing-erg' : 'air-bike',
});
const BENCH = exercise(260, 'Bench press', { compatibleEquipment: [], defaultLoadConvention: 'bodyweight' });
const SLED = exercise(261, 'Sled push', { measurement: 'distance', compatibleEquipment: [], defaultLoadConvention: 'added' });

let dirs: { dir: string; cleanup: () => void }[] = [];
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) d.cleanup();
});
function names(prefix: string): () => string {
  let n = 0;
  return () => `training-${prefix}-${String((n += 1))}`;
}
function dir(): string {
  const d = tempDir();
  dirs.push(d);
  return d.dir;
}

async function seed(store: Store, rower: Exercise, extra: readonly Exercise[] = []): Promise<void> {
  await store.repos.profiles.save(profile(), null);
  for (const e of [BENCH, rower, ...extra]) await store.repos.exercises.save(e, null);
  await store.repos.routines.save(routine([routineExercise(700, { exerciseId: BENCH.id, equipmentId: null, setTemplates: [template(7001, { targetLoad: null, targetReps: { min: 8, max: 10 } })] })]), null);
}

describe('a cardio timer survives a force-close (schema 20)', () => {
  it('start, close, reopen 20 minutes later: the time comes from the stored start; ✓ logs 20:00 · 4,800 m', async () => {
    const path = join(dir(), 'training.db');
    let store = await openStore(openNodeDriver(path));
    const rower = machine(ROWING_ID, 'Rowing machine', 'cardio');
    await seed(store, rower);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sid = started.aggregate.session.id;
    const added = await service.addExercise(sid, { ownerId: OWNER, exerciseId: rower.id, equipmentId: null, opId: 'add-row', at: at(10) });
    if (!added.ok) throw new Error(added.error.code);
    const rowSet = added.aggregate.sets.find((s) => added.aggregate.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === rower.id)?.id ?? '';
    const timer = await service.dispatch(sid, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId: rowSet, durationS: 1 });
    if (!timer.ok) throw new Error(timer.error.code);
    const before: SessionAggregate = timer.aggregate;
    await store.close();

    // Force-close: nothing ran in between. The relaunch reads the stored start.
    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(1300));
    expect(recovered?.state).toEqual(before);
    const s = recovered?.state;
    if (s === undefined) throw new Error('not recovered');
    expect(s.exercises.find((e) => e.exerciseId === rower.id)?.measurement).toBe('cardio');
    expect(s.workInterval).toMatchObject({ setId: rowSet, status: 'running', startedAtUtc: at(100).utc });
    const view = buildActiveSetView({ aggregate: s, nowMs: Date.parse(at(1300).utc), gymName: 'Main', previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });
    expect(view.focus?.setId).toBe(rowSet);
    expect(view.focus?.workTimer?.elapsedMs).toBe(1_200_000);

    const logged = await service.dispatch(sid, logCmd(rowSet, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 4800 }, 1300, 'log-row'));
    if (!logged.ok) throw new Error(`${logged.error.code}: ${logged.error.message}`);
    expect(logged.aggregate.sets.find((x) => x.id === rowSet)?.actual).toMatchObject({ durationS: 1200, distanceM: 4800 });
    // The same ✓ again after another relaunch is a duplicate, not a second set.
    await store.close();
    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(95_000));
    const retry = await service.dispatch(sid, logCmd(rowSet, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 4800 }, 1300, 'log-row'));
    expect(retry.ok && retry.duplicate).toBe(true);

    const created = await createBackup(store, { at: at(1400), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: 'test' } });
    const parsed = await parseBackup(created.text);
    if (!parsed.ok) throw new Error('backup');
    expect(parsed.file.tables.session_exercises?.find((r) => r.exercise_id === rower.id)).toMatchObject({ measurement: 'duration', measures_cardio: 1, measures_distance: null });
    await store.close();
  });
});

describe('migration 21: the four machines become cardio, history included', () => {
  it('a schema-20 backup with a distance row on the rower and a timed air bike restores as cardio; values unchanged; a sled push stays distance', async () => {
    const src = await DatabaseManager.open({ host: nodeDatabaseHost(dir()), newName: names('a') });
    const rowerThen = machine(ROWING_ID, 'Rowing machine', 'distance');
    const bikeThen = machine(AIR_BIKE_ID, 'Air bike', 'duration');
    await seed(src.store, rowerThen, [bikeThen, SLED]);
    const service = createSessionService(src.store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sid = started.aggregate.session.id;
    const setOf = (a: SessionAggregate, exerciseId: string) => a.sets.find((s) => a.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === exerciseId)?.id ?? '';
    let a = started.aggregate;
    for (const [e, op] of [[rowerThen, 'add-row'], [bikeThen, 'add-bike'], [SLED, 'add-sled']] as const) {
      const r = await service.addExercise(sid, { ownerId: OWNER, exerciseId: e.id, equipmentId: null, opId: op, at: at(10) });
      if (!r.ok) throw new Error(r.error.code);
      a = r.aggregate;
    }
    for (const [cmd] of [
      [logCmd(setOf(a, ROWING_ID), values(null, null, { distanceM: 2000 }), 600, 'log-row')],
      [logCmd(setOf(a, AIR_BIKE_ID), values(null, null, { durationS: 300 }), 900, 'log-bike')],
      [logCmd(setOf(a, SLED.id), values(kg(40, 'added'), null, { distanceM: 20 }), 1000, 'log-sled')],
    ] as const) {
      const r = await service.dispatch(sid, cmd);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      a = r.aggregate;
    }
    const created = await createBackup(src.store, { at: at(1100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: 'test' } });
    const parsed = await parseBackup(created.text);
    if (!parsed.ok) throw new Error('backup');
    // The same data as a build before schema 21 would have written it.
    const tables = { ...parsed.file.tables };
    tables.session_exercises = (tables.session_exercises ?? []).map((row) => {
      const copy = { ...row };
      delete copy.measures_cardio;
      return copy;
    });
    expect(tables.session_exercises.find((r) => r.exercise_id === ROWING_ID)).toMatchObject({ measurement: 'reps', measures_distance: 1 });
    const body: Partial<BackupFile> = { ...parsed.file, schemaVersion: 20, tables };
    delete body.checksum;
    const old = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });

    const dst = await DatabaseManager.open({ host: nodeDatabaseHost(dir()), newName: names('b') });
    const out = await dst.restore(old, at(1200));
    expect(out).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(latestVersion()).toBeGreaterThanOrEqual(21);
    const restored = await dst.store.repos.sessions.get(sid);
    if (restored === null) throw new Error('not restored');
    const measurementOf = (exerciseId: string) => restored.exercises.find((e) => e.exerciseId === exerciseId)?.measurement;
    expect(measurementOf(ROWING_ID)).toBe('cardio');
    expect(measurementOf(AIR_BIKE_ID)).toBe('cardio');
    expect(measurementOf(SLED.id)).toBe('distance');
    expect(measurementOf(BENCH.id)).toBe('reps');
    // No set's values changed (rule 2): only how the exercise is measured.
    expect(restored.sets).toEqual(a.sets);
    // Saved catalogue rows follow, versioned.
    expect(await dst.store.repos.exercises.get(ROWING_ID)).toMatchObject({ measurement: 'cardio', version: 2 });
    expect(await dst.store.repos.exercises.get(AIR_BIKE_ID)).toMatchObject({ measurement: 'cardio', version: 2 });
    expect(await dst.store.repos.exercises.get(SLED.id)).toMatchObject({ measurement: 'distance', version: 1 });
  });
});

describe('migration 21 mid-workout: an air-bike timer already running (review S7)', () => {
  it('a schema-20 backup taken with the air bike’s 10-minute timer running restores as a cardio timer that runs past 10:00', async () => {
    const src = await DatabaseManager.open({ host: nodeDatabaseHost(dir()), newName: names('c') });
    const bikeThen = machine(AIR_BIKE_ID, 'Air bike', 'duration');
    await seed(src.store, bikeThen);
    const service = createSessionService(src.store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sid = started.aggregate.session.id;
    const added = await service.addExercise(sid, { ownerId: OWNER, exerciseId: bikeThen.id, equipmentId: null, opId: 'add-bike', at: at(10) });
    if (!added.ok) throw new Error(added.error.code);
    const bikeSet = added.aggregate.sets.find((s) => added.aggregate.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId === AIR_BIKE_ID)?.id ?? '';
    // The old build: a timed set's countdown to its 10:00 target.
    const timer = await service.dispatch(sid, { type: 'start_work_interval', at: at(100), opId: 'start-bike', setId: bikeSet, durationS: 600 });
    if (!timer.ok) throw new Error(timer.error.code);
    expect(timer.aggregate.workInterval).toMatchObject({ durationS: 600, deadlineUtc: at(700).utc });

    const created = await createBackup(src.store, { at: at(200), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: 'test' } });
    const parsed = await parseBackup(created.text);
    if (!parsed.ok) throw new Error('backup');
    const tables = { ...parsed.file.tables };
    tables.session_exercises = (tables.session_exercises ?? []).map((row) => {
      const copy = { ...row };
      delete copy.measures_cardio;
      return copy;
    });
    const body: Partial<BackupFile> = { ...parsed.file, schemaVersion: 20, tables };
    delete body.checksum;
    const old = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });

    const dst = await DatabaseManager.open({ host: nodeDatabaseHost(dir()), newName: names('d') });
    const out = await dst.restore(old, at(300));
    expect(out).toMatchObject({ ok: true, status: 'restored' });
    const after = createSessionService(dst.store.repos, idGen(90_000));
    // Past the old 10:00 deadline: no auto-complete, the timer runs on as cardio.
    const recovered = await after.recover(OWNER, at(800));
    const s = recovered?.state;
    if (s === undefined) throw new Error('not recovered');
    expect(s.exercises.find((e) => e.exerciseId === AIR_BIKE_ID)?.measurement).toBe('cardio');
    expect(recovered?.missedEvents.filter((e) => e.type === 'WorkIntervalEnded')).toEqual([]);
    expect(s.workInterval).toMatchObject({ setId: bikeSet, status: 'running', startedAtUtc: at(100).utc });
    const view = buildActiveSetView({ aggregate: s, nowMs: Date.parse(at(1300).utc), gymName: 'Main', previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });
    expect(view.focus?.workTimer?.elapsedMs).toBe(1_200_000);
    const logged = await after.dispatch(sid, logCmd(bikeSet, { load: null, reps: null, durationS: null, rpe: null, rir: null }, 1300, 'log-bike'));
    if (!logged.ok) throw new Error(`${logged.error.code}: ${logged.error.message}`);
    expect(logged.aggregate.sets.find((x) => x.id === bikeSet)?.actual).toMatchObject({ durationS: 1200 });
  });
});
