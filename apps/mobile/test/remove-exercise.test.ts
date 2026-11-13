import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Remove an exercise added by mistake (exercise-library §4.6) through the
 * app's services on real SQLite: only while nothing on it is logged, no
 * confirm, it leaves every view, and Undo brings it back.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('remove exercise', () => {
  it('leaves the workout and its title; Undo brings it back; refused once a set is logged', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const add = async (name: string) => {
      const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
      const r = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
      return r.aggregate;
    };
    await add('Bench press');
    const a = await add('Lat pulldown');
    const lat = a.exercises.find((e) => e.exerciseName === 'Lat pulldown');
    if (!lat) throw new Error('lat');
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    expect(s.workout.view(data, h.clockMs, null).exercises.map((e) => e.name)).toEqual(['Bench press', 'Lat pulldown']);

    const rm = await s.workout.dispatch(sessionId, { type: 'remove_exercise', at: h.now(), opId: 'rm-1', sessionExerciseId: lat.id, expectedVersion: a.session.version });
    if (!rm.ok) throw new Error(rm.error.message);
    const after = await s.workout.load(sessionId);
    if (!after) throw new Error('load');
    expect(s.workout.view(after, h.clockMs, null).exercises.map((e) => e.name)).toEqual(['Bench press']);
    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'rm-1' });
    if (!undone.ok) throw new Error(undone.message);
    const back = await s.workout.load(sessionId);
    if (!back) throw new Error('load');
    expect(s.workout.view(back, h.clockMs, null).exercises.map((e) => e.name)).toEqual(['Bench press', 'Lat pulldown']);

    // Bench has a logged set: Remove is refused (skip or delete sets instead), and not offered.
    const bench = back.aggregate.exercises.find((e) => e.exerciseName === 'Bench press');
    const set = back.aggregate.sets.find((x) => x.sessionExerciseId === bench?.id && x.status === 'pending');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: set?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const refused = await s.workout.dispatch(sessionId, { type: 'remove_exercise', at: h.now(), opId: 'rm-2', sessionExerciseId: bench?.id ?? '', expectedVersion: logged.aggregate.session.version });
    expect(!refused.ok && refused.error.code).toBe('exercise_logged');
  });
});
