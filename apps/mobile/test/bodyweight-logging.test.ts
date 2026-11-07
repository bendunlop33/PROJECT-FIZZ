import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Logging a bodyweight exercise needs no gym equipment instance (slice-3 re-review nit). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('bodyweight exercises in a workout', () => {
  it('at a gym with a pull-up bar, a push-up is offered with no equipment and logs on none', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    expect((await s.yourData.equipment(gymId)).some((e) => e.kind === 'bodyweight_station')).toBe(true);
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Push-up', sets: [{ load: null, reps: 20 }] }]);
    const done = await s.workout.load(id);
    const ex = done?.aggregate.exercises[0];
    expect(ex).toMatchObject({ exerciseName: 'Push-up', equipmentId: null, loadConvention: 'bodyweight' });
    expect(done?.aggregate.sets.filter((x) => x.status === 'completed').map((x) => x.actual?.reps)).toEqual([20]);
  });

  it('at a dumbbell-only home gym (no bodyweight station) push-ups and pull-ups log, labelled Bodyweight', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'home_dumbbells');
    expect((await s.yourData.equipment(gymId)).some((e) => e.kind === 'bodyweight_station')).toBe(false);
    const id = await logWorkout(h, s, gymId, [
      { exercise: 'Push-up', sets: [{ load: null, reps: 15 }] },
      { exercise: 'Pull-up', sets: [{ load: null, reps: 6 }] },
    ]);
    const done = await s.workout.load(id);
    expect(done?.aggregate.exercises.map((e) => [e.exerciseName, e.equipmentId])).toEqual([
      ['Push-up', null],
      ['Pull-up', null],
    ]);
    expect(done?.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(2);
  });
});
