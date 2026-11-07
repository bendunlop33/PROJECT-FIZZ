import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workoutView } from '@fizz/coach';
import { currentGymEquipment, isLoadAchievable } from '@fizz/domain';

import { exerciseMenu } from '../src/workout/exercise-menu';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

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

describe('swap after pain (B5, rule 9; review gaps B1)', () => {
  /** DB bench last done 30 kg each × 10 on every set (the rule would go up); today's Bench set 1 logged, then maybe marked pain or flagged. */
  async function benchThenSwap(pain: boolean | 'flag') {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const db = 'Dumbbell bench press';
    // As many sets as today's slot can have, so the rule's set count is met.
    await logWorkout(h, s, gymId, [{ exercise: db, sets: Array.from({ length: 6 }, () => ({ load: 30, reps: 10 })) }]);
    h.clockMs += 3 * 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-pain', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' });
    if (!added.ok) throw new Error(added.error.message);
    const row = added.aggregate.exercises[0];
    if (!row) throw new Error('row');
    for (let i = 0; i < 3; i += 1) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: `add-set-${String(i)}`, sessionExerciseId: row.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
    }
    const first = (await s.workout.load(sessionId))?.aggregate.sets.filter((x) => x.sessionExerciseId === row.id && x.status === 'pending').sort((a, b) => a.index - b.index)[0];
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    if (pain === 'flag') {
      // An active flag on Bench through the pain-flag service (review gaps r2 N2); nothing on DB bench.
      const flagged = await s.pain.flagMovement({ exerciseId: row.exerciseId, exerciseName: 'Bench press', opId: 'flag-1' });
      if (!flagged.ok) throw new Error('flag');
    } else if (pain) {
      const set = logged.aggregate.sets.find((x) => x.id === first?.id);
      const r = await s.workout.correctSet({ sessionId, setId: set?.id ?? '', expectedSetVersion: set?.version ?? 0, patch: { exclusions: ['pain'] }, opId: 'pain-1' });
      if (!r.ok) throw new Error('pain');
    }
    const sheet = await s.workout.swapCandidates(sessionId, row.id);
    const choice = sheet?.rows.find((r) => r.name === db);
    if (!sheet || !choice) throw new Error(`no ${db}: ${(sheet?.rows ?? []).map((r) => r.name).join(', ')}`);
    const swapped = await s.workout.swapExercise({ sessionId, sessionExerciseId: row.id, exerciseId: choice.exerciseId, opId: 'swap-pain' });
    if (!swapped.ok) throw new Error(swapped.error.message);
    const newRow = swapped.aggregate.exercises.find((e) => e.swappedFrom?.opId === 'swap-pain');
    const moved = swapped.aggregate.sets.filter((x) => x.sessionExerciseId === newRow?.id);
    return { sheet, choice, moved };
  }

  it('Bench marked pain → swap to DB bench: the sheet says so and the new sets stay at 30 kg each', async () => {
    const { sheet, choice, moved } = await benchThenSwap(true);
    expect(sheet.painHeld).toBe(true);
    expect(choice.targetText.replace(/\s/g, ' ')).toMatch(/^30 kg each × /);
    expect(moved.length).toBeGreaterThan(0);
    for (const m of moved) {
      expect(m.planned.load).toEqual({ value: 30, unit: 'kg', convention: 'per_hand' });
      expect(m.planned.reps?.max ?? 0).toBeLessThanOrEqual(10);
    }
  });

  it('an active flag on Bench (not a marked set) carries the same way through the service', async () => {
    const { sheet, choice, moved } = await benchThenSwap('flag');
    expect(sheet.painHeld).toBe(true);
    expect(choice.targetText.replace(/\s/g, ' ')).toMatch(/^30 kg each × /);
    expect(moved.length).toBeGreaterThan(0);
    for (const m of moved) expect(m.planned.load).toEqual({ value: 30, unit: 'kg', convention: 'per_hand' });
  });

  it('with no pain the same history goes up', async () => {
    const { sheet, moved } = await benchThenSwap(false);
    expect(sheet.painHeld).toBe(false);
    expect(moved.some((m) => (m.planned.load?.value ?? 0) > 30)).toBe(true);
  });
});

describe('Swap exercise with only the other side of a pair left (review gaps r2 S1)', () => {
  it('Left-only log on the last set: no Swap exercise in the menu, and swapCandidates is null', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-uni', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'One-arm dumbbell row')).find((p) => p.exercise.name === 'One-arm dumbbell row');
    if (!pick) throw new Error('no One-arm dumbbell row');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: 'add-row' });
    if (!added.ok) throw new Error(added.error.message);
    const row = added.aggregate.exercises[0];
    if (!row) throw new Error('row');
    const pending = () => s.workout.load(sessionId).then((d) => (d?.aggregate.sets ?? []).filter((x) => x.sessionExerciseId === row.id && x.status === 'pending').sort((a, b) => a.index - b.index));
    const one = { load: { value: 20, unit: 'kg' as const, convention: 'per_hand' as const }, reps: 10, durationS: null, rpe: null, rir: null };
    // Log every set but the last as both sides, then the last one Left only.
    for (let left = await pending(), i = 0; left.length > 1; left = await pending(), i += 1) {
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log-${String(i)}`, setId: left[0]?.id ?? '', values: one, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    const last = (await pending())[0];
    h.clockMs += 60_000;
    const lefty = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-left', setId: last?.id ?? '', values: one, restTimerId: h.ids(), side: 'left' });
    if (!lefty.ok) throw new Error(lefty.error.message);

    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    const v = s.workout.view(data, h.clockMs, null);
    // The Right side is still pending, so the old count said "swap".
    expect(v.exercises.find((e) => e.sessionExerciseId === row.id)?.pendingSets).toBe(1);
    expect(v.focus?.sessionExerciseId).toBe(row.id);
    expect(v.focus?.swappable).toBe(false);
    expect(exerciseMenu(false, false, { canSwap: v.focus?.swappable ?? false, canRemove: v.focus?.removable ?? false }).options).not.toContain('Swap exercise');
    expect(await s.workout.swapCandidates(sessionId, row.id)).toBeNull();
  });
});
