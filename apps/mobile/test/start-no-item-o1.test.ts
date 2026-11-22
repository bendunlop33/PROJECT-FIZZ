import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RoutineExercise, SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Retire-overview O1 (rule 4), on real SQLite, offline: Today's one-tap Start (`workout.start({ routineOf })`, the
 * path at `TodayScreen`'s Start) and `routines.planned` both plan through the shared planner, so a pushdown saved
 * with no item and Fixed at 400 kg is planned on this gym's stack, capped at its max, never 400 kg unchecked.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

function noItemSlot(exerciseId: string, value: number): RoutineExercise {
  return {
    id: h.ids(),
    exerciseId,
    equipmentId: null,
    order: 0,
    supersetGroup: null,
    setTemplates: [0, 1].map(() => ({ id: h.ids(), setType: 'working' as const, targetLoad: { value, unit: 'kg' as const, convention: 'stack' as const }, targetReps: { min: 10, max: 12 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  };
}

const workingLoads = (a: SessionAggregate | undefined, name: string) => {
  const ex = a?.exercises.find((e) => e.exerciseName === name);
  return [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index).map((x) => x.planned.load);
};

async function pushdownWorkout(s: AppServices, gymId: string) {
  const sid = await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 30, reps: 10, rpe: 8 }] }]);
  const pd = (await s.workout.load(sid))?.aggregate.exercises[0];
  if (pd?.equipmentId == null) throw new Error('fixture: pushdown logged on no item');
  const stack = (await s.yourData.equipment(gymId)).find((e) => e.id === pd.equipmentId);
  if (stack === undefined) throw new Error('fixture: no stack');
  h.clockMs += DAY;
  const made = await s.routines.create({ edit: { name: 'No item', exercises: [noItemSlot(pd.exerciseId, 400)] }, opId: 'new-no-item' });
  if (!made.ok) throw new Error(made.message);
  expect(made.routine.exercises[0]?.equipmentId).toBeNull();
  return { routineId: made.routine.id, stack };
}

describe('O1: a saved exercise with no item, on the shared planner', () => {
  it('routines.planned and Today’s one-tap Start plan the stack’s max (capped), on the stack, never 400 kg; a force-close keeps it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { routineId, stack } = await pushdownWorkout(s, gymId);
    const max = stack.kind === 'weight_stack' ? Math.max(...stack.stackLoads) : NaN;
    expect(max).toBeLessThan(400);

    const planned = await s.routines.planned(routineId, gymId);
    const plannedEx = planned?.aggregate.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    expect(plannedEx?.equipmentId).toBe(stack.id);
    const plannedLoads = workingLoads(planned?.aggregate, 'Triceps pushdown');
    expect(plannedLoads).toEqual([0, 1].map(() => ({ value: max, unit: stack.unit, convention: 'stack' })));
    for (const set of planned?.aggregate.sets.filter((x) => x.setType !== 'warmup') ?? []) expect(set.planned.snap?.outcome).toBe('capped');

    // Today's Start (TodayScreen `start({ kind: 'routine' })` → `workout.start({ routineOf })`).
    const started = await s.workout.start({ gymId, opId: 'today-start-o1', checkIn: null, routineOf: routineId });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    expect(workingLoads(started.aggregate, 'Triceps pushdown')).toEqual(plannedLoads);
    expect(started.aggregate.exercises.find((e) => e.exerciseName === 'Triceps pushdown')?.equipmentId).toBe(stack.id);

    // The same tap again (a lost acknowledgement) is the same workout, not a second one.
    const again = await s.workout.start({ gymId, opId: 'today-start-o1', checkIn: null, routineOf: routineId });
    if (again.ok) expect(again.aggregate.session.id).toBe(sessionId);

    // Force-close and relaunch: the stored session still has the capped loads.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const reloaded = (await s2.workout.load(sessionId))?.aggregate;
    expect(workingLoads(reloaded, 'Triceps pushdown')).toEqual(plannedLoads);
    for (const l of workingLoads(reloaded, 'Triceps pushdown')) expect(l?.value ?? 400).toBeLessThanOrEqual(max);
  });

  it('at a gym with no stack, the 400 kg target is dropped (reps kept), never planned unchecked', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { routineId } = await pushdownWorkout(s, gymId);
    const home = h.ids();
    expect((await s.setup.saveGym({ gymId: home, name: 'Home', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    const planned = await s.routines.planned(routineId, home);
    const sets = planned?.aggregate.sets.filter((x) => x.setType !== 'warmup') ?? [];
    expect(sets.length).toBe(2);
    for (const set of sets) {
      expect(set.planned.load).toBeNull();
      expect(set.planned.reps).toEqual({ min: 10, max: 12 });
    }
  });
});
