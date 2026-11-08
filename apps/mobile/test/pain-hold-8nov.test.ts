import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Rule 9 as changed by Ben on 8 Nov, through the app's services on real SQLite: a pain flag holds its movement in
 * the workout it was reported in and the movement's next one, then reads as cleared by itself; pain reported again is
 * a new hold; Ben's own clear still works early. Nothing is migrated: the hold is read from the workouts.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const BENCH = (reps: number) => ({ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps, rpe: 8 })) });

describe('one-session pain hold', () => {
  it('holds through the next bench workout, clears after it, and a new report holds again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [BENCH(6)]);
    h.clockMs += DAY;
    // Reported between workouts (a check-in on its own).
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const bench = (await s.workout.pickerExercises('none', 'bench')).find((p) => p.exercise.name === 'Bench press');
    const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exercise.id ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'flag-1' });
    const flagId = flagged.ok ? flagged.flagIds?.[0] : undefined;
    if (!flagId) throw new Error('flag');
    expect((await s.pain.active()).map((f) => f.id)).toEqual([flagId]);

    // The next bench workout is held; once it's finished the flag reads as cleared by itself.
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [BENCH(6)]);
    expect(await s.pain.active()).toEqual([]);
    const after = await s.pain.get(flagId);
    expect(after?.status).toBe('cleared');
    expect(typeof after?.lapsed?.sessionId).toBe('string');
    // Survives a relaunch: it's read from the workouts, nothing written.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await s2.pain.active()).toEqual([]);

    // Pain again: a new flag, a new hold.
    h.clockMs += DAY;
    const ci2 = await s2.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci2.ok) throw new Error('check-in');
    const again = await s2.pain.flagFromCheckIn({ checkIn: ci2.checkIn, exercises: [{ id: bench?.exercise.id ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'flag-2' });
    expect(again.ok).toBe(true);
    expect((await s2.pain.active()).map((f) => f.id)).toEqual(again.ok ? (again.flagIds ?? []) : []);
  });

  it('Ben clears it early with the existing control', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const bench = (await s.workout.pickerExercises('none', 'bench')).find((p) => p.exercise.name === 'Bench press');
    const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exercise.id ?? '', name: 'Bench press' }], area: null, opId: 'flag-1' });
    const flagId = flagged.ok ? flagged.flagIds?.[0] : undefined;
    if (!flagId) throw new Error('flag');
    const v = (await s.pain.get(flagId))?.version ?? -1;
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: v })).toMatchObject({ ok: true });
    expect(await s.pain.active()).toEqual([]);
  });
});
