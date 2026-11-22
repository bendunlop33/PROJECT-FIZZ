import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { correctionToastText, UNDO_TOAST, undoOpId, undoRefusalText } from '../src/workout/undo-op';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Undo instead of confirm alerts (copy D4, accepted 11 Oct): delete set, skip
 * exercise and corrections apply at once; the toast's Undo is `undo_op`
 * through the services on real SQLite, refused once anything changed since.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

async function benchToday(s: AppServices, gymId: string): Promise<{ sessionId: string; aggregate: SessionAggregate }> {
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const ex = added.aggregate.exercises[0];
  const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex?.id ?? '', newSetId: h.ids(), setType: null });
  if (!r.ok) throw new Error(r.error.message);
  const first = r.aggregate.sets.find((x) => x.status === 'pending');
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  return { sessionId, aggregate: logged.aggregate };
}

describe('Undo copy (D4)', () => {
  it('reads as values, not explanations', () => {
    expect(UNDO_TOAST.deleted(2)).toBe('Set 2 deleted');
    expect(UNDO_TOAST.skipped('Bench press')).toBe('Bench press skipped');
    expect(UNDO_TOAST.corrected(1)).toBe('Set 1 updated');
    expect(undoRefusalText('stale_version')).toBe('Can’t undo: it changed since');
    expect(undoRefusalText('failed')).toBe('Undo wasn’t saved. Try again.');
    expect(undoOpId('abc')).toBe('undo:abc');
  });

  it('the workout and correction screens no longer confirm delete or skip', () => {
    const screen = readFileSync(join(__dirname, '../src/screens/workout/WorkoutScreen.tsx'), 'utf8');
    const edit = readFileSync(join(__dirname, '../src/screens/workout/EditSetScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/Alert\.alert\(`Delete set/);
    expect(screen).not.toMatch(/Alert\.alert\(`Skip the/);
    expect(edit).not.toMatch(/Alert\./);
    expect(edit).not.toContain('The edit log keeps a record');
  });
});

describe('undoOp through the services', () => {
  it('delete a logged set → Undo puts it back; a second Undo is a duplicate, not a second change', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchToday(s, gymId);
    const done = aggregate.sets.find((x) => x.status === 'completed');
    if (!done) throw new Error('fixture');
    const del = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: 'del-1', setId: done.id, expectedSetVersion: done.version });
    expect(del.ok).toBe(true);
    const u = await s.workout.undoOp({ sessionId, targetOpId: 'del-1' });
    expect(u.ok).toBe(true);
    const after = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === done.id);
    expect(after).toMatchObject({ status: 'completed', actual: done.actual });
    // A double tap is the same opId: a duplicate, still ok, nothing else changes.
    expect((await s.workout.undoOp({ sessionId, targetOpId: 'del-1' })).ok).toBe(true);
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === done.id)?.version).toBe(after?.version);
  });

  it('a correction → Undo restores the values; refused once the set was corrected again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchToday(s, gymId);
    const done = aggregate.sets.find((x) => x.status === 'completed');
    if (!done) throw new Error('fixture');
    const fix = await s.workout.correctSet({ sessionId, setId: done.id, expectedSetVersion: done.version, patch: { reps: 6 }, opId: 'fix-1' });
    if (!fix.ok) throw new Error(fix.message);
    const again = await s.workout.correctSet({ sessionId, setId: done.id, expectedSetVersion: done.version + 1, patch: { reps: 5 }, opId: 'fix-2' });
    expect(again.ok).toBe(true);
    expect(await s.workout.undoOp({ sessionId, targetOpId: 'fix-1' })).toEqual({ ok: false, message: 'Can’t undo: it changed since' });
    const u = await s.workout.undoOp({ sessionId, targetOpId: 'fix-2' });
    expect(u.ok && u.aggregate.sets.find((x) => x.id === done.id)?.actual?.reps).toBe(6);
  });

  it('skip exercise → Undo returns its sets to pending', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchToday(s, gymId);
    const ex = aggregate.exercises[0];
    const skip = await s.workout.dispatch(sessionId, { type: 'skip_exercise', at: h.now(), opId: 'skip-1', sessionExerciseId: ex?.id ?? '' });
    if (!skip.ok) throw new Error(skip.error.message);
    const skipped = skip.aggregate.sets.filter((x) => x.status === 'skipped').map((x) => x.id);
    expect(skipped.length).toBeGreaterThan(0);
    const u = await s.workout.undoOp({ sessionId, targetOpId: 'skip-1' });
    expect(u.ok && u.aggregate.sets.filter((x) => x.status === 'pending').map((x) => x.id).sort()).toEqual([...skipped].sort());
  });
});

describe('Edit set: the correction keeps its Undo when the note fails (review gaps N7)', () => {
  it('says the note wasn’t saved, and nothing else changes', () => {
    expect(correctionToastText(UNDO_TOAST.corrected(2), true)).toBe('Set 2 updated · note not saved');
    expect(correctionToastText(UNDO_TOAST.corrected(2), false)).toBe('Set 2 updated');
  });
});

describe('backup Keep failure line (review gaps N4)', () => {
  it('is the short failure line', async () => {
    const { KEEP_SAVE_FAILED } = await import('../src/backup/status');
    expect(KEEP_SAVE_FAILED).toBe('Couldn’t save that. Try again.');
  });
});
