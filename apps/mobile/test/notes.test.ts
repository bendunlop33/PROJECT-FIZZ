import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exerciseMenu } from '../src/workout/exercise-menu';
import { NOTE_MAX, noteChanged, noteValue, setRowCaption } from '../src/workout/notes';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Notes on an exercise or a set (active-workout §4.4; Your data). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('note helpers', () => {
  it('trims, clears on empty, caps at 500', () => {
    expect(noteValue('  Seat 4 ')).toBe('Seat 4');
    expect(noteValue('   ')).toBeNull();
    expect(noteValue('x'.repeat(NOTE_MAX + 20))).toHaveLength(NOTE_MAX);
    expect(noteChanged(null, '  ')).toBe(false);
    expect(noteChanged('Seat 4', 'Seat 4 ')).toBe(false);
    expect(noteChanged('Seat 4', '')).toBe(true);
    expect(setRowCaption(null, 'Felt easy')).toBe('Felt easy');
    expect(setRowCaption('Hotel gym', 'Felt easy')).toBe('Hotel gym · Felt easy');
    expect(setRowCaption(null, null)).toBeNull();
    expect(exerciseMenu(false).options).toContain('Notes');
  });
});

describe('setNote through the services', () => {
  it('saves notes on an exercise and a set, after Finish too; a stale version is refused; nothing else changes', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    const before = (await s.workout.load(sessionId))?.aggregate;
    if (!before) throw new Error('load');
    const row = before.exercises[0];
    const set = before.sets.find((x) => x.status === 'completed');
    if (!row || !set) throw new Error('fixture');
    const ex = await s.workout.setNote({ sessionId, target: { kind: 'exercise', sessionExerciseId: row.id }, note: 'Bench at 3', expectedVersion: before.session.version, opId: 'n1' });
    if (!ex.ok) throw new Error(ex.error.message);
    const st = await s.workout.setNote({ sessionId, target: { kind: 'set', setId: set.id }, note: 'Grip wider', expectedVersion: ex.aggregate.session.version, opId: 'n2' });
    if (!st.ok) throw new Error(st.error.message);
    const after = (await s.workout.load(sessionId))?.aggregate;
    expect(after?.exercises[0]?.note).toBe('Bench at 3');
    expect(after?.sets.find((x) => x.id === set.id)).toEqual({ ...set, note: 'Grip wider' });
    const stale = await s.workout.setNote({ sessionId, target: { kind: 'set', setId: set.id }, note: 'x', expectedVersion: before.session.version, opId: 'n3' });
    expect(!stale.ok && stale.error.code).toBe('stale_version');
    // The summary still reads the same sets.
    const summary = await s.workout.summary(sessionId);
    expect(summary).not.toBeNull();
  });
});
