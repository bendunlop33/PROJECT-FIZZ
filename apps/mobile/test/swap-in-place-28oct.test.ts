import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resumeRows } from '@fizz/domain';

import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct, Push (A) at 18:48: "If I swap exercises in plan on day the old still shows here") A mid-workout swap
 * of Triceps pushdown for another pushdown left `Triceps pushdown 0 of 0 sets` on Today's in-progress list: the old
 * row is out of the workout (`removed`, its pending sets moved), but the list showed it. Real SQLite, offline: the
 * substitute takes the old one's place, the old row is never listed, done sets elsewhere are untouched (rule 2), and
 * Undo brings the old row back.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('a swap mid-workout replaces the exercise in place', () => {
  it('Today’s in-progress list: Bench press, the substitute where Triceps pushdown was, Lateral raise; no `0 of 0 sets` row', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const add = async (name: string, sets: number) => {
      const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
      if (pick === undefined) throw new Error(`no ${name}`);
      const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
      if (!added.ok) throw new Error(added.error.message);
      const row = added.aggregate.exercises.at(-1);
      if (row === undefined) throw new Error('row');
      for (let i = added.aggregate.sets.filter((x) => x.sessionExerciseId === row.id).length; i < sets; i += 1) {
        const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: row.id, newSetId: h.ids(), setType: null });
        if (!r.ok) throw new Error(r.error.message);
      }
      return row;
    };
    const bench = await add('Bench press', 2);
    const pushdown = await add('Triceps pushdown', 2);
    await add('Lateral raise', 2);
    // A bench set done (it must never change).
    const a0 = (await s.workout.load(sessionId))?.aggregate;
    const benchSet = a0?.sets.find((x) => x.sessionExerciseId === bench.id && x.status === 'pending');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-bench', setId: benchSet?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);

    const sheet = await s.workout.swapCandidates(sessionId, pushdown.id);
    const choice = sheet?.rows.find((r) => r.mayHurt === null);
    if (choice === undefined) throw new Error('no substitute');
    const swapped = await s.workout.swapExercise({ sessionId, sessionExerciseId: pushdown.id, exerciseId: choice.exerciseId, opId: 'swap-pushdown' });
    if (!swapped.ok) throw new Error(swapped.error.message);

    const rows = resumeRows(swapped.aggregate, null);
    expect(rows.map((r) => r.name)).toEqual(['Bench press', choice.name, 'Lateral raise']);
    expect(rows.some((r) => r.total === 0 && r.done === 0)).toBe(false);
    expect(rows.find((r) => r.name === choice.name)?.text).toMatch(/^0 of [1-9]\d* sets?$/);
    // Today's own read of the open workout says the same.
    const view = await s.today.view();
    const main = view?.main;
    expect(main?.kind === 'resume' ? main.rows.map((r) => r.name) : null).toEqual(['Bench press', choice.name, 'Lateral raise']);
    // The done bench set is as logged (rule 2).
    expect(swapped.aggregate.sets.find((x) => x.id === benchSet?.id)).toEqual(logged.aggregate.sets.find((x) => x.id === benchSet?.id));
    // A force-close reads the same.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = (await s2.workout.load(sessionId))?.aggregate;
    expect(again === undefined ? null : resumeRows(again, null).map((r) => r.name)).toEqual(['Bench press', choice.name, 'Lateral raise']);
    // Undo: the old exercise back where it was, the substitute gone.
    const u = await s2.workout.undoOp({ sessionId, targetOpId: 'swap-pushdown' });
    if (!u.ok) throw new Error(u.message);
    expect(resumeRows(u.aggregate, null).map((r) => r.name)).toEqual(['Bench press', 'Triceps pushdown', 'Lateral raise']);
  });
});
