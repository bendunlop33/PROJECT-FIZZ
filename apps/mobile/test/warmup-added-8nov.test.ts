import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkCoachAdd, equipmentOfRow, isLoadAchievable, type CommandOutcome } from '@fizz/domain';
import type { SessionAggregate, WorkoutSet } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Ben's report (8 Nov, live Pull B, build 552): barbell rows added mid-workout after pull-ups got one 50 kg warm-up
 * before 97.5 kg working sets, and 97.5 × 6 when his recent rows were 95 × 10 at RIR 2. On real SQLite, no network
 * and no coach model: every path that adds or swaps an exercise into a running workout (the ＋ Add sheet, the picker
 * and library's add, Swap, the coach's add) plans its working targets from his own history as a secondary lift (the
 * compound range, reps from history, never the 3–6 main-lift range) and its warm-ups with the shared planner at its
 * place (WU1–WU12, PL1). Ben, 9 Nov: pull-ups don't warm a barbell row (only the same movement pattern does), so
 * rows after logged pull-ups get the full cold ladder, as before them. Loads are
 * achievable on the gym's kit (rule 4); logged sets never change (rule 2); everything survives a force-close.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-11-01T16:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = (r: CommandOutcome): SessionAggregate => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
};

const ROWS = [1, 2, 3].map(() => ({ load: 95, reps: 10, rpe: 8 }));

/** Two Pull days of history (pull-ups, then rows at 95 × 10, RIR 2), then today's workout with pull-ups first. */
async function pullB(opts: { logPullups: boolean; dumbbellRow?: boolean }): Promise<{ s: AppServices; sessionId: string; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  for (let day = 0; day < 2; day += 1) {
    await logWorkout(h, s, gymId, [
      { exercise: 'Pull-up', sets: [{ load: null, reps: 8, rpe: 8 }, { load: null, reps: 8, rpe: 8 }] },
      { exercise: 'Barbell row', sets: ROWS },
      ...(opts.dumbbellRow === true ? [{ exercise: 'One-arm dumbbell row', sets: [{ load: 30, reps: 10, rpe: 8 }, { load: 30, reps: 10, rpe: 8 }] }] : []),
    ]);
    h.clockMs += 3 * DAY;
  }
  const st = await s.workout.start({ gymId, opId: 'start-pull-b', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!st.ok) throw new Error(st.error.message);
  const sessionId = st.aggregate.session.id;
  const pu = (await s.workout.pickerExercises(sessionId, 'Pull-up')).find((p) => p.exercise.name === 'Pull-up');
  const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pu?.exercise.id ?? '', equipmentId: pu?.equipment[0]?.id ?? null, opId: 'add-pullups' }));
  if (opts.logPullups) {
    const first = a.sets.find((x) => x.setType !== 'warmup' && x.status === 'pending');
    h.clockMs += 60_000;
    ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-pu-1', setId: first?.id ?? '', values: { load: null, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
  }
  return { s, sessionId, gymId };
}

const rowOf = (a: SessionAggregate, name: string) => a.exercises.find((e) => e.exerciseName === name && e.removed === undefined);
const setsOf = (a: SessionAggregate, name: string): WorkoutSet[] => {
  const row = rowOf(a, name);
  return a.sets.filter((x) => x.sessionExerciseId === row?.id && x.status !== 'deleted').sort((x, y) => x.index - y.index);
};
const warm = (a: SessionAggregate, name: string) => setsOf(a, name).filter((x) => x.setType === 'warmup').map((x) => [x.planned.load?.value ?? null, x.planned.reps?.min ?? null]);
const working = (a: SessionAggregate, name: string) => setsOf(a, name).filter((x) => x.setType !== 'warmup');

/** Rule 4 and the shape every path must have: warm-ups first, climbing, achievable, below W; the top one at 70–90 % of W. */
function rampsUp(a: SessionAggregate, name: string): void {
  const row = rowOf(a, name);
  if (row === undefined) throw new Error(`no ${name}`);
  const eq = equipmentOfRow(a.session.equipmentSnapshot, row);
  const sets = setsOf(a, name);
  const W = working(a, name)[0]?.planned.load?.value ?? null;
  expect(W).not.toBeNull();
  const warmups = sets.filter((x) => x.setType === 'warmup');
  expect(warmups.length).toBeGreaterThan(0);
  expect(sets.slice(0, warmups.length).every((x) => x.setType === 'warmup')).toBe(true);
  let prev = 0;
  for (const x of warmups) {
    const v = x.planned.load?.value ?? 0;
    expect(v).toBeGreaterThan(prev);
    expect(v).toBeLessThan(W ?? 0);
    if (eq !== null && x.planned.load !== null) expect(isLoadAchievable(x.planned.load, eq)).toBe(true);
    prev = v;
  }
  expect(prev / (W ?? 1)).toBeGreaterThanOrEqual(0.7);
  expect(prev / (W ?? 1)).toBeLessThanOrEqual(0.9);
}

/** His rows were 95 × 10 at RIR 2: today's are about that or the rule's next step, never heavier at 3–6 reps. */
function fromHistory(a: SessionAggregate, sets = 3): void {
  const work = working(a, 'Barbell row');
  expect(work).toHaveLength(sets);
  for (const x of work) {
    expect(x.planned.load?.value ?? 0).toBeGreaterThanOrEqual(95);
    expect(x.planned.load?.value ?? 0).toBeLessThanOrEqual(97.5);
    expect(x.planned.reps?.max ?? 0).toBeGreaterThanOrEqual(9);
  }
}

describe('an exercise added mid-workout plans its targets and warm-ups like a planned one (8 Nov)', () => {
  it('＋ Add exercise (the sheet) after logged pull-ups: rows from his 95 × 10 history; the full cold ramp (Ben, 9 Nov: pull-ups don’t warm rows)', async () => {
    const { s, sessionId } = await pullB({ logPullups: true });
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null, group: 'Back' });
    const row = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Barbell row');
    if (row === undefined) throw new Error('no barbell row in the sheet');
    const before = await s.workout.load(sessionId);
    const a = ok(await s.workoutEdit.add(sessionId, row.exerciseId, 'add-row'));
    fromHistory(a);
    expect(warm(a, 'Barbell row')).toEqual([[50, 8], [80, 4]]);
    rampsUp(a, 'Barbell row');
    // The pull-up Ben logged is untouched (rule 2).
    expect(setsOf(a, 'Pull-up').filter((x) => x.status === 'completed')).toEqual(setsOf(before?.aggregate as SessionAggregate, 'Pull-up').filter((x) => x.status === 'completed'));
    // Idempotent, and stored: the same after a force-close.
    const again = await s.workoutEdit.add(sessionId, row.exerciseId, 'add-row');
    expect(again.ok && again.duplicate).toBe(true);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const back = await s2.workout.load(sessionId);
    expect(warm(back?.aggregate as SessionAggregate, 'Barbell row')).toEqual([[50, 8], [80, 4]]);
  });

  it('cold (pull-ups not logged yet): the full WU5 ladder, 50 × 8 then 80 × 4, never a lone light step', async () => {
    const { s, sessionId } = await pullB({ logPullups: false });
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null, group: 'Back' });
    const row = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Barbell row');
    const a = ok(await s.workoutEdit.add(sessionId, row?.exerciseId ?? '', 'add-row-cold'));
    expect(warm(a, 'Barbell row')).toEqual([[50, 8], [80, 4]]);
    rampsUp(a, 'Barbell row');
  });

  it('the picker’s and library’s add (no builder plan): the rule as a secondary lift (6–10 from his history, not 3–6), with the planner’s warm-up', async () => {
    const { s, sessionId } = await pullB({ logPullups: true });
    const pick = (await s.workout.pickerExercises(sessionId, 'Barbell row')).find((p) => p.exercise.name === 'Barbell row');
    const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'pick-row' }));
    fromHistory(a);
    for (const x of working(a, 'Barbell row')) expect(x.planned.reps).toEqual({ min: 6, max: 10 });
    rampsUp(a, 'Barbell row');
    expect(warm(a, 'Barbell row')).toHaveLength(2);
  });

  it('Swap mid-workout: a dumbbell row’s warm-ups don’t carry over; barbell row gets its own from the planner; Undo brings the dumbbell row back', async () => {
    const { s, sessionId } = await pullB({ logPullups: true, dumbbellRow: true });
    const pick = (await s.workout.pickerExercises(sessionId, 'One-arm dumbbell row')).find((p) => p.exercise.name === 'One-arm dumbbell row');
    const added = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-db' }));
    // Secondary compound, back warm (WU6): no warm-ups; give it Ben's own one light warm-up to show it doesn't carry.
    const db = rowOf(added, 'One-arm dumbbell row');
    const withWarm = ok(await s.workout.dispatch(sessionId, { type: 'add_warmup', at: h.now(), opId: 'db-warm', sessionExerciseId: db?.id ?? '', newSetId: h.ids(), planned: { load: { value: 10, unit: 'kg', convention: 'per_hand' }, reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null }, restS: 60, expectedVersion: added.session.version }));
    expect(setsOf(withWarm, 'One-arm dumbbell row').filter((x) => x.setType === 'warmup')).toHaveLength(1);
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: db?.id ?? '', group: 'Back' });
    const to = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Barbell row');
    if (to === undefined) throw new Error('no barbell row to swap to');
    const r = await s.workoutEdit.swap(sessionId, db?.id ?? '', to.exerciseId, 'swap-row');
    const a = ok(r);
    // A swap keeps the row's set count (the dumbbell row's two).
    fromHistory(a, working(withWarm, 'One-arm dumbbell row').length);
    expect(warm(a, 'Barbell row')).toEqual([[50, 8], [80, 4]]);
    rampsUp(a, 'Barbell row');
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const undone = await s2.workout.undoOp({ sessionId, targetOpId: 'swap-row' });
    if (!undone.ok) throw new Error(undone.message);
    const u = undone.aggregate;
    expect(setsOf(u, 'One-arm dumbbell row').map((x) => [x.setType, x.status])).toEqual(setsOf(withWarm, 'One-arm dumbbell row').map((x) => [x.setType, x.status]));
    expect(setsOf(u, 'Barbell row').filter((x) => x.status === 'pending')).toEqual([]);
  });

  it('the coach’s add (its service reads and the domain check, no model): history targets and the planner’s warm-up, in one versioned write', async () => {
    const { s, sessionId } = await pullB({ logPullups: true });
    const a0 = (await s.workout.load(sessionId))?.aggregate;
    if (a0 === undefined) throw new Error('no workout');
    const pick = (await s.workout.pickerExercises(sessionId, 'Barbell row', { withCatalogue: true })).find((p) => p.exercise.name === 'Barbell row');
    const inputs = await s.workout.coachAddInputs(pick?.exercise.id ?? '', a0);
    if (inputs === null) throw new Error('no inputs');
    expect(inputs.substitute.warmups).toBeDefined();
    const check = checkCoachAdd({
      aggregate: a0,
      args: { baseVersion: a0.session.version, exerciseId: pick?.exercise.id ?? '', workingSets: 3, reps: null, workSeconds: null, distanceMetres: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load: null, reason: 'Ben asked for rows' },
      exercise: inputs.exercise,
      history: inputs.history,
      substitute: inputs.substitute,
      owner: inputs.owner,
      sameMovementIds: inputs.sameMovementIds,
      opId: 'coach-add-row',
      at: h.now(),
    });
    if (check.status !== 'ok') throw new Error(check.status);
    const a = ok(await s.workout.dispatch(sessionId, check.command));
    fromHistory(a);
    rampsUp(a, 'Barbell row');
    // A stale coach write is refused (rule 5): the workout moved on since it was read.
    const stale = checkCoachAdd({ ...{ aggregate: a, args: { baseVersion: a0.session.version, exerciseId: pick?.exercise.id ?? '', workingSets: 3, reps: null, workSeconds: null, distanceMetres: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load: null, reason: 'again' } }, exercise: inputs.exercise, history: inputs.history, substitute: inputs.substitute, owner: inputs.owner, opId: 'coach-add-row-2', at: h.now() });
    expect(stale.status).toBe('stale');
  });
});
