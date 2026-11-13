import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stepRoundCommand } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * SF1–SF3 and SF6 (Ben, 8 Nov) through the app's services on real SQLite: an exercise added after bench is planned
 * for the bench sets before it (SF3's `est.` cushion); moving it first works the built-in target out again; Undo of
 * the move puts the old target back; a target Ben typed is never changed.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;

async function add(s: AppServices, sessionId: string, name: string): Promise<SessionAggregate> {
  const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
  if (!pick) throw new Error(name);
  const r = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
}

const inclineSets = (a: SessionAggregate) => {
  const row = a.exercises.find((e) => e.exerciseName === 'Incline bench press');
  return a.sets.filter((x) => x.sessionExerciseId === row?.id && x.setType !== 'warmup' && x.status !== 'deleted').sort((x, y) => x.index - y.index);
};
const targets = (a: SessionAggregate) => inclineSets(a).map((x) => [x.planned.load?.value ?? null, x.planned.reps?.min ?? null, x.planned.reps?.max ?? null, x.planned.provenance?.estimate === true]);

describe('in-session fatigue in today’s workout', () => {
  it('incline after bench: same load, 1 rep fewer, est.; moved first it plans as it was done; Undo puts it back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // Incline has only ever come first: 60 kg × 9, 9, 9.
    await logWorkout(h, s, gymId, [{ exercise: 'Incline bench press', sets: [1, 2, 3].map(() => ({ load: 60, reps: 9, rpe: 8 })) }]);
    h.clockMs += 2 * DAY;
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    await add(s, sessionId, 'Bench press');
    let a = await add(s, sessionId, 'Incline bench press');
    const bench = a.sets.filter((x) => x.sessionExerciseId === a.exercises.find((e) => e.exerciseName === 'Bench press')?.id && x.setType === 'working');
    expect(bench.length).toBeGreaterThanOrEqual(3);
    // After the bench sets planned before it: 60 kg × 8 est., no load step.
    const after = targets(a);
    expect(after.every(([load, min, max, est]) => load === 60 && min === 8 && max === 8 && est)).toBe(true);

    // Ben moves incline first: its built-in target is worked out again for the new order (no est.).
    const incline = a.exercises.find((e) => e.exerciseName === 'Incline bench press');
    if (!incline) throw new Error('incline');
    const move = stepRoundCommand(a, incline.id, 'up', { opId: 'move-1', at: h.now() });
    if (!move.ok) throw new Error(move.reason);
    const moved = await s.workout.dispatch(sessionId, move.command);
    if (!moved.ok) throw new Error(moved.error.message);
    a = moved.aggregate;
    const first = targets(a);
    // Done first, like its history: the rule as it is (its main-lift range moves the load up), never `est.`.
    expect(first).toEqual([0, 1, 2].map(() => [62.5, 3, 6, false]));

    // Undo of the move: the old order, and the old targets.
    const undone = await s.workout.dispatch(sessionId, { type: 'undo_op', at: h.now(), opId: 'undo-move-1', targetOpId: 'move-1' });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(targets(undone.aggregate)).toEqual(after);

    // A force-close keeps what was planned (it's stored on the sets).
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const data = await s2.workout.load(sessionId);
    if (!data) throw new Error('load');
    expect(targets(data.aggregate)).toEqual(after);
  });

  it('a target Ben typed is never changed by a reorder', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Incline bench press', sets: [1, 2, 3].map(() => ({ load: 60, reps: 9, rpe: 8 })) }]);
    h.clockMs += 2 * DAY;
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    await add(s, sessionId, 'Bench press');
    let a = await add(s, sessionId, 'Incline bench press');
    const set1 = inclineSets(a)[0];
    if (!set1) throw new Error('set');
    const typed = await s.workout.dispatch(sessionId, { type: 'edit_planned_set', at: h.now(), opId: 'edit-1', setId: set1.id, expectedSetVersion: set1.version, patch: { load: { value: 55, unit: 'kg', convention: 'total' } } });
    if (!typed.ok) throw new Error(typed.error.message);
    a = typed.aggregate;
    const before = inclineSets(a).map((x) => x.planned);
    const incline = a.exercises.find((e) => e.exerciseName === 'Incline bench press');
    if (!incline) throw new Error('incline');
    const move = stepRoundCommand(a, incline.id, 'up', { opId: 'move-2', at: h.now() });
    if (!move.ok) throw new Error(move.reason);
    const moved = await s.workout.dispatch(sessionId, move.command);
    if (!moved.ok) throw new Error(moved.error.message);
    expect(inclineSets(moved.aggregate).map((x) => x.planned)).toEqual(before);
    expect(inclineSets(moved.aggregate)[0]?.planned.load?.value).toBe(55);
  });
});
