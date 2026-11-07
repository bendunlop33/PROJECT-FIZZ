import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Heaviest-set line through the app services (premium-feel §5.1, acceptance
 * 16–17): read after the write, only after 3 earlier comparable workouts,
 * and a duplicate log op doesn't make a second record.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

async function logOneBench(s: Awaited<ReturnType<typeof setUp>>['s'], gymId: string, load: number) {
  const started = await s.workout.start({ gymId, opId: `start-rec-${String(h.clockMs)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  if (!pick) throw new Error('no bench');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const ex = added.aggregate.exercises.at(-1);
  const set = added.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.id).sort((a, b) => a.index - b.index)[0];
  if (!ex || !set) throw new Error('no set');
  h.clockMs += 60_000;
  const cmd = { type: 'log_set' as const, at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values: { load: { value: load, unit: ex.unit, convention: ex.loadConvention }, reps: 5, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() };
  const r = await s.workout.dispatch(sessionId, cmd);
  if (!r.ok) throw new Error(r.error.message);
  // The same op again (a double tap or retry) is a duplicate, not a second set.
  const again = await s.workout.dispatch(sessionId, cmd);
  expect(again.ok).toBe(true);
  return { sessionId, setId: set.id };
}

describe('setRecord', () => {
  it('no record before 3 earlier comparable workouts; then the heaviest set is one', async () => {
    const { s, gymId } = await setUp();
    for (const load of [60, 62.5]) {
      await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load, reps: 5 }] }]);
      h.clockMs += 86_400_000;
    }
    const early = await logOneBench(s, gymId, 70);
    expect(await s.workout.setRecord(early.sessionId, early.setId)).toBeNull();
    const data = await s.workout.load(early.sessionId);
    await s.workout.dispatch(early.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    await h.settle(s);
    h.clockMs += 86_400_000;

    const heavier = await logOneBench(s, gymId, 72.5);
    const rec = await s.workout.setRecord(heavier.sessionId, heavier.setId);
    expect(rec?.kind).toBe('heaviest');
    expect(rec?.text).toMatch(/^Heaviest bench press set at .+ so far$/);

    // An unknown set reads as no record, never an error.
    expect(await s.workout.setRecord(heavier.sessionId, 'missing-set')).toBeNull();
  });

  it('a context read before the write decides the record with no read after it (review S1)', async () => {
    const { s, gymId } = await setUp();
    for (const load of [60, 62.5, 65]) {
      await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load, reps: 5 }] }]);
      h.clockMs += 86_400_000;
    }
    const started = await s.workout.start({ gymId, opId: 'start-ctx', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    if (!pick) throw new Error('no bench');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const ex = added.aggregate.exercises.at(-1);
    if (!ex) throw new Error('no exercise');
    const more = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
    if (!more.ok) throw new Error(more.error.message);
    const sets = more.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
    const [first, second] = sets;
    if (!first || !second) throw new Error('no sets');

    const ctx = await s.workout.recordContext(sessionId, first.id);
    if (ctx === null) throw new Error('no context');
    h.clockMs += 60_000;
    const values = (load: number) => ({ load: { value: load, unit: ex.unit, convention: ex.loadConvention }, reps: 5, durationS: null, rpe: null, rir: null });
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${first.id}:0`, setId: first.id, values: values(67.5), restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
    const quick = s.workout.recordOf(ctx, r.aggregate, first.id);
    expect(quick?.kind).toBe('heaviest');
    expect(quick).toEqual(await s.workout.setRecord(sessionId, first.id));

    // A context for another set doesn't fit: the caller reads it again.
    expect(s.workout.recordOf(ctx, r.aggregate, second.id)).toBeUndefined();

    // The same load again in this workout isn't a second record (earlier sets today count).
    const ctx2 = await s.workout.recordContext(sessionId, second.id);
    if (ctx2 === null) throw new Error('no context');
    h.clockMs += 60_000;
    const r2 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${second.id}:0`, setId: second.id, values: values(67.5), restTimerId: h.ids() });
    if (!r2.ok) throw new Error(r2.error.message);
    expect(s.workout.recordOf(ctx2, r2.aggregate, second.id)).toBeNull();
  });
});
