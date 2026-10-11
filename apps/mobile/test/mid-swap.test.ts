import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workoutView } from '@fizz/coach';
import { currentGymEquipment, isLoadAchievable } from '@fizz/domain';

import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Swap an exercise mid-workout (exercise-library EL4, B3 accepted 11 Oct)
 * through the app's services on real SQLite: the Swap sheet ranks for the
 * pending sets only, a pick applies at once, logged sets stay, every target
 * can be made on this gym's items, and Undo puts the sets back.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('mid-workout swap', () => {
  it('Swap sheet → pick → logged set stays, pending sets move fitted to the gym → Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' });
    if (!added.ok) throw new Error(added.error.message);
    const row = added.aggregate.exercises[0];
    if (!row) throw new Error('row');
    for (let i = 0; i < 2; i += 1) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: `add-set-${String(i)}`, sessionExerciseId: row.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
    }
    const before = (await s.workout.load(sessionId))?.aggregate;
    const first = before?.sets.filter((x) => x.sessionExerciseId === row.id && x.status === 'pending').sort((a, b) => a.index - b.index)[0];
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const pendingBefore = logged.aggregate.sets.filter((x) => x.sessionExerciseId === row.id && x.status === 'pending').length;

    const sheet = await s.workout.swapCandidates(sessionId, row.id);
    expect(sheet?.plannedName).toBe('Bench press');
    expect(sheet?.rows.length).toBeGreaterThan(0);
    expect(sheet?.rows.some((r) => r.exerciseId === row.exerciseId)).toBe(false);
    const choice = sheet?.rows.find((r) => r.mayHurt === null);
    if (!choice) throw new Error('no candidate');

    const swapped = await s.workout.swapExercise({ sessionId, sessionExerciseId: row.id, exerciseId: choice.exerciseId, opId: 'swap-1' });
    if (!swapped.ok) throw new Error(swapped.error.message);
    expect(swapped).toMatchObject({ fromName: 'Bench press', toName: choice.name });
    const a = swapped.aggregate;
    // The logged bench set is untouched (rule 2).
    expect(a.sets.find((x) => x.id === first?.id)).toEqual(logged.aggregate.sets.find((x) => x.id === first?.id));
    const newRow = a.exercises.find((e) => e.swappedFrom?.opId === 'swap-1');
    const moved = a.sets.filter((x) => x.sessionExerciseId === newRow?.id);
    expect(moved).toHaveLength(pendingBefore);
    // Every target can be made on this gym's items (rule 4).
    const eq = currentGymEquipment(a.session).find((e) => e.id === newRow?.equipmentId);
    for (const m of moved) if (m.planned.load !== null && eq) expect(isLoadAchievable(m.planned.load, eq)).toBe(true);
    // The coach sees the workout as it is now.
    expect(workoutView(a, 'Main Gym').exercises.map((e) => e.name)).toEqual(['Bench press', choice.name]);

    // A retry after a crash is a duplicate, not a second swap.
    const retry = await s.workout.swapExercise({ sessionId, sessionExerciseId: row.id, exerciseId: choice.exerciseId, opId: 'swap-1' });
    expect(retry.ok && retry.duplicate).toBe(true);

    const u = await s.workout.undoOp({ sessionId, targetOpId: 'swap-1' });
    if (!u.ok) throw new Error(u.message);
    expect(u.aggregate.sets.filter((x) => x.sessionExerciseId === row.id && x.status === 'pending')).toHaveLength(pendingBefore);
    expect(workoutView(u.aggregate, 'Main Gym').exercises.map((e) => e.name)).toEqual(['Bench press']);
    // Nothing left to swap on a row with no pending set.
    expect(await s.workout.swapCandidates(sessionId, newRow?.id ?? '')).toBeNull();
  });
});
