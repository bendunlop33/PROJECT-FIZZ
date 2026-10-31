import type { PlanBuilderAnswers } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct; block-progress.md) Synthetic history for block progress, written through the services as the app
 * writes it (real SQLite, offline): three builder plans applied a block apart, so two past blocks and a current one,
 * each with plan-day workouts of its first day's main lift.
 *
 * - Block 1 · Strength, 4 weeks (Maintain): applied Mon 3 Aug; the main lift 60, 62.5, 65, 67.5 × 5.
 * - Block 2 · Muscle, 4 weeks (Standard: week 4 deload): Mon 7 Sep; 60, 62.5, 65 × 8, then the deload.
 * - Block 3 · Muscle, 6 weeks: Mon 5 Oct; week 1 70 kg at the plan's reps, weeks 2 and 3 70 × 2 (stalled 2 weeks;
 *   two misses in a row at one load, so the built-in rule's stall reset is offered).
 *   The day's first accessory the same: its planned reps, then 2 reps twice. An off-plan lat pulldown in week 3.
 * The clock ends on Wed 21 Oct (block 3's week 3), 18:00 in London.
 */

export const DAY = 86_400_000;
const at = (date: string, hour = 8) => Date.parse(`${date}T${String(hour - 1).padStart(2, '0')}:00:00.000Z`);

export interface BlockBen {
  h: Harness;
  s: AppServices;
  gymId: string;
  /** Each block's plan (oldest first) and the first day's main lift. */
  plans: { planId: string; mainId: string; routineId: string }[];
  /** Block 3's first day's first accessory (straight working sets): stalled too, with the rule's reset offered. */
  accessory: { exerciseId: string; latestSessionId: string };
  /** An off-plan workout in block 3's week 3. */
  offPlanSessionId: string;
}

async function apply(h: Harness, s: AppServices, patch: Partial<PlanBuilderAnswers>): Promise<string> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no plan builder');
  const answers: PlanBuilderAnswers = { ...session.answers, sessions: 3, split: 'ppl', ...patch };
  const built = await s.planBuilder.save(session, answers, null, h.ids());
  if (!built.ok) throw new Error(`plan not built: ${built.reason}`);
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('plan not applied');
  return built.planId;
}

/** The plan's first day (its template) and that day's main lift, as Today reads them. */
async function firstDay(s: AppServices, planId: string): Promise<{ routineId: string; mainId: string }> {
  const d = await s.todaySession.load();
  const day = d?.days.filter((x) => x.planId === planId).sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0))[0];
  const t = day?.templates[0];
  if (t?.routineId == null || t.mainLiftExerciseId === null) throw new Error('no main lift');
  return { routineId: t.routineId, mainId: t.mainLiftExerciseId };
}

/**
 * One plan-day workout: the main lift's first three working sets as `load × reps` (`reps` from the planned rep floor),
 * its other rows left unlogged, finished.
 */
export async function logPlanDay(h: Harness, s: AppServices, gymId: string, routineId: string, mainId: string, load: number, repsOf: (floor: number) => number, accessory?: (floor: number) => number, accessoryIds: string[] = []): Promise<string> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc }, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const ex = started.aggregate.exercises.find((e) => e.exerciseId === mainId);
  if (ex === undefined) throw new Error('main lift not in the workout');
  const sets = started.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup').sort((a, b) => a.index - b.index);
  const floor = sets[0]?.planned.reps?.min ?? 6;
  const reps = repsOf(floor);
  for (const set of sets.slice(0, 3)) {
    h.clockMs += 60_000;
    const values = { load: { value: load, unit: ex.unit, convention: ex.loadConvention }, reps, durationS: null, rpe: 9, rir: null };
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  // (Optional) the day's first other lift with straight working sets: each at its planned load × `accessory(floor)`.
  if (accessory !== undefined) {
    const other = started.aggregate.exercises.filter((e) => e.exerciseId !== mainId && e.measurement === 'reps' && e.loadConvention !== 'bodyweight' && e.loadConvention !== 'assistance').find((e) => started.aggregate.sets.some((x) => x.sessionExerciseId === e.id && x.setType === 'working'));
    if (other === undefined) throw new Error('no loaded accessory');
    const work = started.aggregate.sets.filter((x) => x.sessionExerciseId === other.id && x.setType === 'working').sort((a, b) => a.index - b.index);
    const r0 = accessory(work[0]?.planned.reps?.min ?? 8);
    for (const set of work) {
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: other.unit, convention: other.loadConvention }, reps: r0, durationS: null, rpe: 9, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    accessoryIds.push(other.exerciseId);
  }
  h.clockMs += 60_000;
  const data = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return sessionId;
}

export async function benWithBlocks(opts: Parameters<typeof createHarness>[1] = {}): Promise<BlockBen> {
  const h = createHarness('2026-07-27T07:00:00.000Z', opts);
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const plans: BlockBen['plans'] = [];
  const block = async (monday: string, patch: Partial<PlanBuilderAnswers>, weeks: [number, number][]) => {
    h.clockMs = at(monday);
    const planId = await apply(h, s, patch);
    const { routineId, mainId } = await firstDay(s, planId);
    plans.push({ planId, mainId, routineId });
    for (const [i, [load, reps]] of weeks.entries()) {
      h.clockMs = at(monday, 10) + i * 7 * DAY + DAY;
      await logPlanDay(h, s, gymId, routineId, mainId, load, () => reps);
    }
  };
  await block('2026-08-03', { weeks: 4, effort: 'maintain', focus: 'strength' }, [
    [60, 5],
    [62.5, 5],
    [65, 5],
    [67.5, 5],
  ]);
  await block('2026-09-07', { weeks: 4, effort: 'standard', focus: 'muscle' }, [
    [60, 8],
    [62.5, 8],
    [65, 8],
    [55, 6],
  ]);
  h.clockMs = at('2026-10-05');
  const planId = await apply(h, s, { weeks: 6, effort: 'standard', focus: 'muscle' });
  const { routineId, mainId } = await firstDay(s, planId);
  plans.push({ planId, mainId, routineId });
  let latest = '';
  const accessoryIds: string[] = [];
  for (const [i, missed] of [false, true, true].entries()) {
    h.clockMs = at('2026-10-05', 10) + i * 7 * DAY + DAY;
    // A miss: 2 reps, under the rep range the plan day sets (the rule's stall reset needs two in a row at one load).
    latest = await logPlanDay(h, s, gymId, routineId, mainId, 70, (floor) => (missed ? 2 : floor), (floor) => (missed ? 2 : floor), accessoryIds);
  }
  const accessory = accessoryIds[0];
  if (accessory === undefined) throw new Error('no accessory');
  // An off-plan workout in week 3 too (counts for the block): lat pulldown.
  h.clockMs = at('2026-10-21', 12);
  const offPlan = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 59, reps: 10, rpe: 8 }] }]);
  h.clockMs = at('2026-10-21', 18);
  return { h, s, gymId, plans, accessory: { exerciseId: accessory, latestSessionId: latest }, offPlanSessionId: offPlan };
}
