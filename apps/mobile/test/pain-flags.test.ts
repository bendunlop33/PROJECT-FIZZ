import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Review workout-loop S7: pain flags can be chosen from the Summary and cleared later (rule 9). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('pain flags after the toast', () => {
  it('Summary → Choose movements flags them; only those hold; Clear lets them progress again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }, { exercise: 'Lat pulldown', sets: [1, 2].map(() => ({ load: 40, reps: 10, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const withPain = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'] }, ci.checkIn.version, h.ids());
    if (!withPain.ok) throw new Error('reasons');
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'answered', checkInId: ci.checkIn.id } });
    if (!started.ok) throw new Error('start');
    // Log the second workout through the normal path, then finish it.
    await s.workout.dispatch(started.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'd', expectedVersion: started.aggregate.session.version });
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }, { exercise: 'Lat pulldown', sets: [1, 2].map(() => ({ load: 40, reps: 10, rpe: 8 })) }]);
    let sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.map((r) => [r.exerciseName, r.decision])).toEqual([
      ['Bench press', 'increase_load'],
      ['Lat pulldown', 'increase_load'],
    ]);

    // Flag Bench press from a check-in that mentioned pain (the Summary's sheet does this).
    const latest = await s.checkIns.get(ci.checkIn.id);
    if (!latest || !sum) throw new Error('fixture');
    const bench = sum.exercises.find((e) => e.name === 'Bench press');
    const flagged = await s.pain.flagFromCheckIn({ checkIn: latest, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: null, opId: 'flag-1' });
    expect(flagged.ok).toBe(true);
    sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision).toBe('halted_pain');
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Lat pulldown')?.decision).toBe('increase_load');
    expect((await s.pain.active()).map((f) => f.exerciseName)).toEqual(['Bench press']);

    // Profile → Pain flags → Clear.
    expect(await s.pain.clear((await s.pain.active()).map((f) => f.id))).toBe(true);
    expect(await s.pain.active()).toEqual([]);
    sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision).toBe('increase_load');
  });
});
