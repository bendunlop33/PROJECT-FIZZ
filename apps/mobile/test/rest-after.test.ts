import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** `Rest after` through the services: this set, or the exercise and its future default (rest-state §2.4). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Rest after', () => {
  it('exercise scope changes pending sets now and the default next time; the running rest is untouched', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 40, reps: 10 }, { load: 40, reps: 10 }] }]);
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: null });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'pulldown'))[0];
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add' });
    if (!added.ok) throw new Error('add');
    const sets = added.aggregate.sets;
    expect(sets.map((x) => x.rest.seconds)).toEqual([90, 90]);
    // Log the first set: a 90 s rest starts.
    const first = sets[0];
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${first?.id ?? ''}:0`, setId: first?.id ?? '', values: { load: { value: 45, unit: 'kg', convention: 'stack' }, reps: 10, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error('log');
    const deadline = logged.aggregate.restTimer?.deadlineUtc;

    const r = await s.workout.setRestAfter({ sessionId, setId: sets[1]?.id ?? '', seconds: 120, scope: 'exercise', opId: 'rest-x', expectedVersion: logged.aggregate.session.version });
    expect(r).toMatchObject({ ok: true, defaultSaved: true });
    if (!r.ok) throw new Error('rest');
    expect(r.aggregate.restTimer?.deadlineUtc).toBe(deadline);
    expect(r.aggregate.sets.map((x) => x.rest.seconds)).toEqual([90, 120]);
    expect((await s.yourData.profile())?.exerciseRestS).toEqual({ [pick?.exercise.id ?? '']: 120 });

    // Next workout: the exercise starts with Ben's default.
    const data = await s.workout.load(sessionId);
    await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin', expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    const next = await s.workout.start({ gymId, opId: 'w3', checkIn: null });
    if (!next.ok) throw new Error('start 3');
    const again = await s.workout.addExercise({ sessionId: next.aggregate.session.id, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-3' });
    expect(again.ok && again.aggregate.sets.every((x) => x.rest.seconds === 120)).toBe(true);
  });
});
