import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Routines through the app services on real SQLite (premium-feel §2.6,
 * acceptance checks 4–7): Save as routine from a finished workout, Undo,
 * the routine's row and Up next, starting a routine with next targets,
 * rotation by what was done last, renaming a routine and a workout, and
 * force-close recovery of a routine's workout.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const DAY = 86_400_000;

describe('Save as routine, then start it', () => {
  it('saves one routine per tap (idempotent), leaves the workout unchanged, and Undo deletes it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    const before = await s.workout.load(sessionId);

    expect(await s.routines.checkName('')).toEqual({ ok: false, message: 'Give it a name' });
    const [a, b] = await Promise.all([s.routines.saveFromSession({ sessionId, name: 'Push A', opId: 'save-1' , addToRotation: true }), s.routines.saveFromSession({ sessionId, name: 'Push A', opId: 'save-1' })]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok) return;
    const rows = await s.routines.list();
    expect(rows.map((r) => [r.name, r.exercises, r.sets])).toEqual([['Push A', 1, 2]]);
    // The workout it came from counts as done from this routine.
    expect(rows[0]?.lastDone?.atUtc).toBe(before?.aggregate.session.startedAt.utc);
    // Saving changed nothing on the finished workout (its version isn't bumped).
    expect((await s.workout.load(sessionId))?.aggregate).toEqual(before?.aggregate);
    expect(await s.routines.checkName('push a')).toEqual({ ok: true, name: 'push a', note: 'You already have Push A.' });

    // Undo = delete (a tombstone); a retry of the same delete is a duplicate; restore brings it back.
    const del = await s.routines.remove({ routineId: a.routine.id, expectedVersion: a.routine.version, opId: 'del-1' });
    expect(del).toMatchObject({ ok: true, duplicate: false });
    expect(await s.routines.remove({ routineId: a.routine.id, expectedVersion: a.routine.version, opId: 'del-1' })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.routines.list()).toEqual([]);
    // A stale version is refused, never applied to newer state.
    expect(await s.routines.rename({ routineId: a.routine.id, name: 'X', expectedVersion: 1, opId: 'ren-stale' })).toMatchObject({ ok: false, stale: true });
    if (!del.ok) return;
    expect(await s.routines.restore({ routineId: a.routine.id, expectedVersion: del.routine.version, opId: 'undo-1' })).toMatchObject({ ok: true });
    expect((await s.routines.list()).map((r) => r.name)).toEqual(['Push A']);
  });

  it('Up next is the routine; Start uses its last workout’s next targets; an added exercise never joins the routine; force-close recovers it', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);

    h.clockMs += 2 * DAY;
    const next = await s.next.preview(gymId);
    expect(next).toMatchObject({ title: 'Push A', routine: { id: saved.routine.id, basis: { kind: 'only' } }, sourceSessionId: first });
    // Muscles and an estimate on the hero, always worded `about` (active-workout §2.15).
    expect(next?.aboutMinutes).toBeGreaterThan(0);
    const targetLine = plain(next?.targets[0]?.line);
    expect(targetLine.startsWith('Target ')).toBe(true);
    const sheet = await s.routines.preview(saved.routine.id, gymId);
    expect(sheet?.source).toBe('built_in_rule');
    expect(sheet?.targets.map((t) => plain(t.line))).toEqual(next?.targets.map((t) => plain(t.line)));

    const started = await s.workout.start({ gymId, opId: 'start-routine', checkIn: null, routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const again = await s.workout.start({ gymId, opId: 'start-routine', checkIn: null, routineOf: saved.routine.id });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    const agg = started.aggregate;
    expect(agg.session).toMatchObject({ routineId: saved.routine.id, routineName: 'Push A' });
    // What Start created is what Up next said (acceptance check 3).
    const bench = agg.sets.filter((x) => x.setType !== 'warmup');
    expect(bench.every((x) => x.planned.source === 'built_in_rule')).toBe(true);
    expect(targetLine).toContain(`${String(bench.length)} sets`);
    expect(bench[0]?.planned.reps).not.toBeNull();

    // Add an exercise mid-workout, log one set per exercise, force-close, relaunch, finish.
    const sessionId = agg.session.id;
    const picks = await s.workout.pickerExercises(sessionId, 'Barbell row');
    const row = picks.find((p) => p.exercise.name === 'Barbell row');
    if (!row) throw new Error('no row');
    const added = await s.workout.addExercise({ sessionId, exerciseId: row.exercise.id, equipmentId: row.equipment[0]?.id ?? null, opId: 'add-row' });
    expect(added.ok).toBe(true);
    const firstSet = bench[0];
    if (!firstSet) throw new Error('no set');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${firstSet.id}:0`, setId: firstSet.id, values: { load: firstSet.planned.load, reps: firstSet.planned.reps?.min ?? 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    await h.forceClose();
    s = (await h.launch()).services;
    const resumed = await s.workout.load();
    expect(resumed?.aggregate.session).toMatchObject({ id: sessionId, routineId: saved.routine.id });
    h.clockMs += 60_000;
    expect((await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-2', expectedVersion: resumed?.aggregate.session.version ?? 0, endedAt: null })).ok).toBe(true);
    await h.settle(s);

    // The routine is unchanged: the next start has only its own exercises.
    h.clockMs += 2 * DAY;
    const third = await s.routines.preview(saved.routine.id, gymId);
    expect(third?.targets.map((t) => t.exerciseName)).toEqual(['Bench press']);
    expect((await s.routines.list())[0]?.lastDone?.atUtc).toBe(resumed?.aggregate.session.startedAt.utc);
  });
});

describe('rotation and names', () => {
  it('with three routines and Pull A done last, Up next is the routine after it; a non-routine workout keeps its own next session', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const names = ['Push A', 'Pull A', 'Legs A'];
    const exercisesFor = ['Bench press', 'Barbell row', 'Back squat'];
    const ids: string[] = [];
    for (const [i, name] of names.entries()) {
      h.clockMs += DAY;
      const sid = await logWorkout(h, s, gymId, [{ exercise: exercisesFor[i] ?? '', sets: [{ load: 40, reps: 8 }] }]);
      const r = await s.routines.saveFromSession({ sessionId: sid, name, opId: `save-${name}`, addToRotation: true });
      if (!r.ok) throw new Error(r.message);
      ids.push(r.routine.id);
    }
    // Legs A (saved from the latest workout) was done last: Up next wraps round to Push A.
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Push A', routine: { basis: { kind: 'after', routineName: 'Legs A' } } });
    // Do Pull A: Up next is Legs A.
    h.clockMs += DAY;
    const started = await s.workout.start({ gymId, opId: 'pull', checkIn: null, routineOf: ids[1] ?? '' });
    if (!started.ok) throw new Error(started.error.message);
    const set = started.aggregate.sets[0];
    if (!set) throw new Error('no set');
    h.clockMs += 60_000;
    await s.workout.dispatch(started.aggregate.session.id, { type: 'log_set', at: h.now(), opId: 'l', setId: set.id, values: { load: set.planned.load, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    const v = (await s.workout.load())?.aggregate.session.version ?? 0;
    await s.workout.dispatch(started.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'f', expectedVersion: v, endedAt: null });
    h.clockMs += DAY;
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Legs A', routine: { id: ids[2], basis: { kind: 'after', routineName: 'Pull A' } } });
    // A workout not from a routine: Up next is its next session again.
    h.clockMs += DAY;
    const free = await logWorkout(h, s, gymId, [{ exercise: 'Deadlift', sets: [{ load: 100, reps: 5 }] }]);
    expect(await s.next.preview(gymId)).toMatchObject({ routine: null, sourceSessionId: free });
  });

  it('renaming a routine never renames past workouts; renaming a workout never renames the routine; both undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const r = await s.routines.saveFromSession({ sessionId: sid, name: 'Push A', opId: 'save' , addToRotation: true });
    if (!r.ok) throw new Error(r.message);
    const renamed = await s.routines.rename({ routineId: r.routine.id, name: 'Push B', expectedVersion: r.routine.version, opId: 'ren' });
    expect(renamed).toMatchObject({ ok: true, routine: { name: 'Push B', version: 2 } });

    const before = (await s.workout.load(sid))?.aggregate.session;
    const w = await s.workout.dispatch(sid, { type: 'rename_session', at: h.now(), opId: 'ren-w', name: 'Chest day', expectedVersion: before?.version ?? 0 });
    expect(w.ok).toBe(true);
    expect((await s.workout.summary(sid))?.title).toBe('Chest day');
    expect((await s.routines.list())[0]?.name).toBe('Push B');
    if (!w.ok) return;
    const undo = await s.workout.dispatch(sid, { type: 'rename_session', at: h.now(), opId: 'undo-ren-w', name: before?.routineName ?? 'Workout', expectedVersion: w.aggregate.session.version });
    expect(undo.ok).toBe(true);
  });
});
