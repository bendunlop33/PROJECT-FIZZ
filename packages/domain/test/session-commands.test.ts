import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate } from '@fizz/schemas';
import {
  buildAddExerciseCommand,
  buildExecutionOrder,
  createMemoryRepositories,
  createSessionService,
  getSessionPhase,
  reduceSession,
  startWorkout,
} from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, OWNER, profile, stack, values } from './fixtures';
import { apply, BENCH, exercises, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const DB_ROW = exercise(220, 'One-arm dumbbell row', {
  compatibleEquipment: ['dumbbells'],
  defaultLoadConvention: 'per_hand',
  laterality: 'unilateral',
  defaultRestS: 75,
});

function emptyWorkout(): SessionAggregate {
  return startWorkout({
    opId: 'start-empty',
    owner: profile(),
    gymId: GYM,
    routine: null,
    exercises: new Map(),
    gymEquipment: [barbell(), dumbbells()],
    at: at(0),
    newId: idGen(20_000),
  }).aggregate;
}

const addBench = (opId = 'add-bench', newId = idGen(30_000)) =>
  buildAddExerciseCommand({ opId, owner: profile(), exercise: exercises.get(BENCH) ?? DB_ROW, equipmentId: barbell().id, at: at(5), newId });

describe('empty workout (review M4)', () => {
  it('opens as empty, not "all done"', () => {
    const s = emptyWorkout();
    expect(s.session.activeSetId).toBeNull();
    expect(getSessionPhase(s, ms(1))).toEqual({ kind: 'empty' });
  });

  it('Add exercise → Log → Add set → Log, end to end', () => {
    let s = emptyWorkout();
    const r = expectOk(reduceSession(s, addBench()));
    s = r.state;
    const first = s.sets[0];
    if (!first) throw new Error('no set');
    expect(s.exercises[0]).toMatchObject({ exerciseName: 'Bench press', unit: 'kg', loadConvention: 'total', order: 0 });
    expect(first).toMatchObject({ status: 'pending', setType: 'working', planned: { load: null, reps: null } });
    expect(first.rest).toMatchObject({ seconds: 120, source: 'exercise_default' });
    expect(s.session.activeSetId).toBe(first.id);
    expect(getSessionPhase(s, ms(6))).toMatchObject({ kind: 'ready', setId: first.id });
    expect(r.events.map((e) => e.type)).toEqual(['ExerciseAdded', 'SetAdded', 'ActiveSetChanged']);

    s = apply(s, logCmd(first.id, values(kg(60), 10), 60));
    expect(getSessionPhase(s, ms(61))).toEqual({ kind: 'all_done' });

    const sx = s.exercises[0]?.id ?? '';
    s = apply(s, { type: 'add_set', at: at(70), opId: 'add-set', sessionExerciseId: sx, newSetId: id(31_000), setType: null });
    expect(s.session.activeSetId).toBe(id(31_000));
    expect(s.sets.find((x) => x.id === id(31_000))).toMatchObject({ index: 1, status: 'pending', rest: first.rest });
    s = apply(s, logCmd(id(31_000), values(kg(62.5), 8), 200));
    expect(s.sets.filter((x) => x.status === 'completed')).toHaveLength(2);
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it('through the service: the exercise snapshot comes from the catalogue and the profile', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
    await repos.exercises.save(DB_ROW, null);
    for (const eq of [barbell(), dumbbells()]) await repos.equipment.save(eq, null);
    const svc = createSessionService(repos, idGen(40_000));
    const started = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 's', at: at(0) });
    if (!started.ok) throw new Error('start');
    const sid = started.aggregate.session.id;
    const noEq = await svc.addExercise(sid, { ownerId: OWNER, exerciseId: DB_ROW.id, equipmentId: null, opId: 'a1', at: at(5) });
    expect(noEq.ok && noEq.aggregate.exercises[0]).toMatchObject({ unit: 'lb', loadConvention: 'per_hand', exerciseName: 'One-arm dumbbell row' });
    const withRack = await svc.addExercise(sid, { ownerId: OWNER, exerciseId: DB_ROW.id, equipmentId: dumbbells().id, opId: 'a2', at: at(6) });
    expect(withRack.ok && withRack.aggregate.exercises[1]).toMatchObject({ unit: 'kg', loadConvention: 'per_hand', order: 1 });
    // A retried add (relaunch regenerates the IDs) is a duplicate, not a second exercise.
    const retry = await svc.addExercise(sid, { ownerId: OWNER, exerciseId: DB_ROW.id, equipmentId: dumbbells().id, opId: 'a2', at: at(7) });
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(retry.ok && retry.aggregate.exercises).toHaveLength(2);
    const missing = await svc.addExercise(sid, { ownerId: OWNER, exerciseId: DB_ROW.id, equipmentId: stack().id, opId: 'a3', at: at(8) });
    expect(missing).toMatchObject({ ok: false, error: { code: 'equipment_not_found' } });
  });
});

describe('add_set', () => {
  it('copies planned values and rest from the exercise’s last set and slots into the execution order', () => {
    const { state } = startFixture();
    const benchEx = state.exercises.find((e) => e.exerciseId === BENCH);
    const s = apply(state, { type: 'add_set', at: at(5), opId: 'as', sessionExerciseId: benchEx?.id ?? '', newSetId: id(32_000), setType: null });
    const added = s.sets.find((x) => x.id === id(32_000));
    const last = setsFor(state, BENCH)[2];
    expect(added).toMatchObject({ index: 3, setType: 'working', planned: last?.planned, rest: last?.rest, status: 'pending' });
    // Not made active while another set is active.
    expect(s.session.activeSetId).toBe(state.session.activeSetId);
    expect(buildExecutionOrder(s.exercises, s.sets).indexOf(id(32_000))).toBe(3);
    expect(s.session.version).toBe(state.session.version + 1);
  });

  it('is idempotent across regenerated set IDs, and rejects an unknown exercise', () => {
    const { state } = startFixture();
    const sx = state.exercises[0]?.id ?? '';
    const once = apply(state, { type: 'add_set', at: at(5), opId: 'as', sessionExerciseId: sx, newSetId: id(32_001), setType: 'warmup' });
    const r = expectOk(reduceSession(once, { type: 'add_set', at: at(6), opId: 'as', sessionExerciseId: sx, newSetId: id(32_002), setType: 'warmup' }));
    expect(r.duplicate).toBe(true);
    expect(r.state.sets).toHaveLength(state.sets.length + 1);
    expectError(reduceSession(state, { type: 'add_set', at: at(5), opId: 'x', sessionExerciseId: id(1), newSetId: id(32_003), setType: null }), 'exercise_not_found');
  });
});

describe('delete_set', () => {
  it('deleting the active pending set moves to the next set and leaves a tombstone', () => {
    const { state } = startFixture();
    const [w, b1] = setsFor(state, BENCH);
    if (!w || !b1) throw new Error('fixture');
    const r = expectOk(reduceSession(state, { type: 'delete_set', at: at(5), opId: 'd', setId: w.id, expectedSetVersion: 1 }));
    expect(r.state.sets.find((x) => x.id === w.id)).toMatchObject({ status: 'deleted', version: 2 });
    expect(r.state.session.activeSetId).toBe(b1.id);
    expect(buildExecutionOrder(r.state.exercises, r.state.sets)).not.toContain(w.id);
    expect(r.state.audit.at(-1)).toMatchObject({ kind: 'deleted', setId: w.id, before: { status: 'pending' }, after: { status: 'deleted' } });
    expect(r.events.map((e) => e.type)).toEqual(['SetDeleted', 'ActiveSetChanged']);
  });

  it('deleting a logged set is explicit, audited, version-checked and leaves rest alone', () => {
    const { state } = startFixture();
    const w = setsFor(state, BENCH)[0];
    if (!w) throw new Error('fixture');
    const logged = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    expectError(reduceSession(logged, { type: 'delete_set', at: at(40), opId: 'd', setId: w.id, expectedSetVersion: 1 }), 'stale_version');
    const r = expectOk(reduceSession(logged, { type: 'delete_set', at: at(40), opId: 'd', setId: w.id, expectedSetVersion: 2 }));
    const tomb = r.state.sets.find((x) => x.id === w.id);
    expect(tomb).toMatchObject({ status: 'deleted', actual: values(kg(60), 10) });
    expect(r.state.audit.at(-1)?.before?.actual).toEqual(values(kg(60), 10));
    expect(r.state.restTimer).toEqual(logged.restTimer);
    expect(r.state.session.activeSetId).toBe(logged.session.activeSetId);
    expectError(reduceSession(r.state, { type: 'delete_set', at: at(41), opId: 'd2', setId: w.id, expectedSetVersion: 3 }), 'set_not_found');
  });

  it('refuses to delete a set whose work timer is running; deleting every set makes the workout empty', () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    const working = apply(state, { type: 'start_work_interval', at: at(1), opId: 'w', setId: hang.id, durationS: 45 });
    expectError(reduceSession(working, { type: 'delete_set', at: at(2), opId: 'd', setId: hang.id, expectedSetVersion: 1 }), 'work_interval_running');

    let s = state;
    for (const set of state.sets) s = apply(s, { type: 'delete_set', at: at(5), opId: `d-${set.id}`, setId: set.id, expectedSetVersion: 1 });
    expect(s.session.activeSetId).toBeNull();
    expect(getSessionPhase(s, ms(6))).toEqual({ kind: 'empty' });
  });
});

describe('skip_exercise', () => {
  it('skips only the pending sets of that exercise, with audit, and moves on', () => {
    const { state } = startFixture();
    const [w] = setsFor(state, BENCH);
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    const benchEx = s.exercises.find((e) => e.exerciseId === BENCH);
    const r = expectOk(reduceSession(s, { type: 'skip_exercise', at: at(40), opId: 'sk', sessionExerciseId: benchEx?.id ?? '' }));
    expect(setsFor(r.state, BENCH).map((x) => x.status)).toEqual(['completed', 'skipped', 'skipped']);
    expect(r.state.session.activeSetId).toBe(setsFor(r.state, ROW)[0]?.id);
    expect(r.state.audit.filter((a) => a.kind === 'skipped')).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ type: 'SetsSkipped' });
    // A repeat with a new opId finds nothing pending and changes nothing.
    expect(expectOk(reduceSession(r.state, { type: 'skip_exercise', at: at(41), opId: 'sk2', sessionExerciseId: benchEx?.id ?? '' })).state).toBe(r.state);
  });

  it('skipping one superset member keeps the other member’s rounds going', () => {
    const { state } = startFixture();
    const r1 = setsFor(state, ROW)[0];
    if (!r1) throw new Error('fixture');
    let s = apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: r1.id, expectedVersion: 1 });
    const face = s.exercises.find((e) => e.exerciseId === FACE);
    s = apply(s, { type: 'skip_exercise', at: at(1), opId: 'sk', sessionExerciseId: face?.id ?? '' });
    s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 12), 30));
    // R1 is now the end of its round (Face pull is skipped), so the round rest starts.
    expect(s.restTimer).toMatchObject({ kind: 'rest', setId: r1.id });
    expect(s.session.activeSetId).toBe(setsFor(s, ROW)[1]?.id);
  });
});

describe('discard', () => {
  it('discards with a version check, cancels timers and locks the session', () => {
    const { state } = startFixture();
    const w = setsFor(state, BENCH)[0];
    if (!w) throw new Error('fixture');
    const s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    expectError(reduceSession(s, { type: 'discard', at: at(40), opId: 'x', expectedVersion: 1, confirmedLoggedSets: 1 }), 'stale_version');
    const r = expectOk(reduceSession(s, { type: 'discard', at: at(40), opId: 'x', expectedVersion: 2, confirmedLoggedSets: 1 }));
    expect(r.state.session).toMatchObject({ status: 'discarded', endedAt: at(40), activeSetId: null });
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(r.events.at(-1)).toEqual({ type: 'SessionDiscarded' });
    expect(getSessionPhase(r.state, ms(41))).toEqual({ kind: 'finished' });
    expectError(reduceSession(r.state, logCmd(setsFor(r.state, BENCH)[1]?.id ?? '', values(kg(100), 8), 50)), 'session_finished');
    expectError(
      reduceSession(r.state, { type: 'correct_set', at: at(50), opId: 'c', setId: w.id, expectedSetVersion: 2, patch: { reps: 9 } }),
      'session_finished',
    );
  });

  it('a discarded workout is no longer the active one', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    const svc = createSessionService(repos, idGen(41_000));
    const started = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 's', at: at(0) });
    if (!started.ok) throw new Error('start');
    await svc.dispatch(started.aggregate.session.id, { type: 'discard', at: at(10), opId: 'x', expectedVersion: 1, confirmedLoggedSets: 0 });
    expect(await svc.recover(OWNER, at(20))).toBeNull();
    const again = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 's2', at: at(30) });
    expect(again.ok).toBe(true);
  });
});

describe('unit and convention of an added exercise follow the equipment', () => {
  it('lb rack → lb per-hand; logging kg on it is a unit mismatch', () => {
    const rack = dumbbells({ unit: 'lb', loads: [10, 20, 30] });
    const s0 = startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: null,
      exercises: new Map(),
      gymEquipment: [rack],
      at: at(0),
      newId: idGen(50_000),
    }).aggregate;
    const cmd = buildAddExerciseCommand({ opId: 'a', owner: profile(), exercise: DB_ROW, equipmentId: rack.id, at: at(1), newId: idGen(51_000) });
    const s = apply(s0, cmd);
    const set = s.sets[0];
    expect(s.exercises[0]).toMatchObject({ unit: 'lb', loadConvention: 'per_hand' });
    expectError(reduceSession(s, logCmd(set?.id ?? '', values(kg(10, 'per_hand'), 8), 10)), 'unit_mismatch');
    expectOk(reduceSession(s, logCmd(set?.id ?? '', values(lb(20, 'per_hand'), 8), 10)));
  });
});
