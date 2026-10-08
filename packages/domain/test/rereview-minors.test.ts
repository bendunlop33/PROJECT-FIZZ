import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import {
  buildAddExerciseCommand,
  createMemoryRepositories,
  createSessionService,
  latestCommittedSetId,
  reduceSession,
  startWorkout,
} from '../src/index';
import { at, barbell, dumbbells, GYM, id, idGen, kg, OWNER, profile, values } from './fixtures';
import { apply, BENCH, exercises, expectError, expectOk, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const bench = (s: SessionAggregate) => setsFor(s, BENCH);

describe('re-review minor 1: deleting the active set moves forward, not back', () => {
  it('jump past the warm-up, log B1, delete B2 (active): the active set becomes R1, not W', () => {
    const { state } = startFixture();
    const [w, b1, b2] = bench(state);
    const r1 = setsFor(state, ROW)[0];
    if (!w || !b1 || !b2 || !r1) throw new Error('fixture');
    let s = apply(state, { type: 'set_active_set', at: at(1), opId: 'jump', setId: b1.id, expectedVersion: 1 });
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 60));
    expect(s.session.activeSetId).toBe(b2.id);
    const r = expectOk(reduceSession(s, { type: 'delete_set', at: at(70), opId: 'd', setId: b2.id, expectedSetVersion: 1 }));
    expect(r.state.session.activeSetId).toBe(r1.id);
    expect(r.events).toContainEqual({ type: 'ActiveSetChanged', setId: r1.id });
    // The skipped-over warm-up is still pending and reachable later by wrap-around.
    expect(r.state.sets.find((x) => x.id === w.id)?.status).toBe('pending');
  });
});

describe('re-review minor 2: add_set with a set type copies that type, never another', () => {
  it('"Add warm-up" after working sets copies the warm-up target and rest, not 100 kg and the Heavy rest', () => {
    const { state } = startFixture();
    const [w] = bench(state);
    const sx = state.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    const s = apply(state, { type: 'add_set', at: at(5), opId: 'aw', sessionExerciseId: sx, newSetId: id(80_001), setType: 'warmup' });
    const added = s.sets.find((x) => x.id === id(80_001));
    expect(added).toMatchObject({ setType: 'warmup', index: 3, planned: w?.planned, rest: { seconds: 60 } });
    expect(added?.planned.load).toEqual(kg(60));
  });

  it('a type the exercise has no set of is refused rather than invented', () => {
    const { state } = startFixture();
    const sx = state.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    expectError(
      reduceSession(state, { type: 'add_set', at: at(5), opId: 'at', sessionExerciseId: sx, newSetId: id(80_002), setType: 'top' }),
      'set_not_found',
    );
  });

  it('without a type, the last live set is copied as before', () => {
    const { state } = startFixture();
    const [, , b2] = bench(state);
    const sx = state.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    const s = apply(state, { type: 'add_set', at: at(5), opId: 'a', sessionExerciseId: sx, newSetId: id(80_003), setType: null });
    expect(s.sets.find((x) => x.id === id(80_003))).toMatchObject({ setType: 'working', planned: b2?.planned, rest: b2?.rest });
  });
});

describe('re-review minor 3: deleting the latest logged set ends the undo window', () => {
  it('after Log W, Log B1, Delete B1, Undo does not revert W', () => {
    const { state } = startFixture();
    const [w, b1] = bench(state);
    if (!w || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 300));
    s = apply(s, { type: 'delete_set', at: at(310), opId: 'd', setId: b1.id, expectedSetVersion: 2 });
    expect(latestCommittedSetId(s)).toBeNull();
    expectError(reduceSession(s, { type: 'undo_log', at: at(315), opId: 'u', setId: w.id, expectedSetVersion: 2 }), 'not_latest_set');
  });

  it('deleting a pending set does not end it', () => {
    const { state } = startFixture();
    const [w, , b2] = bench(state);
    if (!w || !b2) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, { type: 'delete_set', at: at(40), opId: 'd', setId: b2.id, expectedSetVersion: 1 });
    expect(latestCommittedSetId(s)).toBe(w.id);
    expectOk(reduceSession(s, { type: 'undo_log', at: at(45), opId: 'u', setId: w.id, expectedSetVersion: 2 }));
  });
});

describe('re-review minor 4: superseded for undo_log and delete_set duplicates', () => {
  it('a repeated undo after the set was logged again reports superseded', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    if (!w) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30, 'l1'));
    const undo = { type: 'undo_log' as const, at: at(35), opId: 'u1', setId: w.id, expectedSetVersion: 2 };
    s = apply(s, undo);
    expect(expectOk(reduceSession(s, undo))).toMatchObject({ duplicate: true, superseded: false });
    s = apply(s, logCmd(w.id, values(kg(60), 10), 40, 'l2'));
    expect(expectOk(reduceSession(s, { ...undo, at: at(41) }))).toMatchObject({ duplicate: true, superseded: true });
  });

  it('a repeated delete while the set is still deleted is not superseded', () => {
    const { state } = startFixture();
    const b2 = bench(state)[2];
    const del = { type: 'delete_set' as const, at: at(5), opId: 'd', setId: b2?.id ?? '', expectedSetVersion: 1 };
    const s = apply(state, del);
    expect(expectOk(reduceSession(s, del))).toMatchObject({ duplicate: true, superseded: false });
  });
});

describe('re-review minors 5 and 6: add_exercise retries and equipment compatibility', () => {
  const empty = () =>
    startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: null,
      exercises: new Map(),
      gymEquipment: [barbell(), dumbbells()],
      at: at(0),
      newId: idGen(81_000),
    }).aggregate;
  const benchEx = exercises.get(BENCH);
  if (!benchEx) throw new Error('fixture');

  it('a retry whose unit or rest was re-resolved is a duplicate, not operation_id_reused', () => {
    const s = apply(
      empty(),
      buildAddExerciseCommand({ opId: 'a', owner: profile(), exercise: benchEx, equipmentId: null, at: at(5), newId: idGen(82_000) }),
    );
    const retry = buildAddExerciseCommand({
      opId: 'a',
      owner: profile({ preferredUnit: 'lb' }),
      exercise: { ...benchEx, defaultRestS: 200 },
      equipmentId: null,
      at: at(9),
      newId: idGen(83_000),
    });
    expect(expectOk(reduceSession(s, retry)).duplicate).toBe(true);
    // A different exercise or equipment under the same opId is still refused.
    expectError(reduceSession(s, { ...retry, equipmentId: barbell().id }), 'operation_id_reused');
  });

  it('a barbell exercise on a dumbbell rack is refused', () => {
    const cmd = buildAddExerciseCommand({ opId: 'a', owner: profile(), exercise: benchEx, equipmentId: dumbbells().id, at: at(5), newId: idGen(84_000) });
    expectError(reduceSession(empty(), cmd), 'equipment_incompatible');
    const ok = buildAddExerciseCommand({ opId: 'b', owner: profile(), exercise: benchEx, equipmentId: barbell().id, at: at(5), newId: idGen(85_000) });
    expectOk(reduceSession(empty(), ok));
  });

  it('through the service too', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    await repos.exercises.save(benchEx, null);
    for (const eq of [barbell(), dumbbells()]) await repos.equipment.save(eq, null);
    const svc = createSessionService(repos, idGen(86_000));
    const started = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 's', at: at(0) });
    if (!started.ok) throw new Error('start');
    const out = await svc.addExercise(started.aggregate.session.id, { ownerId: OWNER, exerciseId: benchEx.id, equipmentId: dumbbells().id, opId: 'a', at: at(5) });
    expect(out).toMatchObject({ ok: false, error: { code: 'equipment_incompatible' } });
  });
});

describe('re-review minor 8: Undo while a work timer runs on another set', () => {
  it('is refused until the timer is stopped', () => {
    const { state } = startFixture();
    const w = bench(state)[0];
    const hang = setsFor(state, HANG)[0];
    if (!w || !hang) throw new Error('fixture');
    let s = apply(state, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, { type: 'start_work_interval', at: at(40), opId: 'wi', setId: hang.id, durationS: 45 });
    const undo = { type: 'undo_log' as const, at: at(50), opId: 'u', setId: w.id, expectedSetVersion: 2 };
    expectError(reduceSession(s, undo), 'work_interval_running');
    s = apply(s, { type: 'stop_work_interval', at: at(55), opId: 'stop', setId: hang.id });
    const r = expectOk(reduceSession(s, { ...undo, at: at(56) }));
    expect(r.state.session.activeSetId).toBe(w.id);
  });
});
