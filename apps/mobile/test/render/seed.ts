import type { PlanBuilderAnswers } from '@fizz/schemas';

import type { AppServices } from '../../src/services/app-services';
import type { TodaySessionData } from '../../src/services/today-session';
import { finishWorkout } from '../finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import type { Launched } from './render-screen';

/**
 * Realistic data for render smoke tests, written through the services as the app writes it (real SQLite, offline):
 * a commercial gym in kg, two weeks of history (barbell, per-hand dumbbells, a stack machine, bodyweight), and a
 * builder plan in use.
 */

export const DAY = 86_400_000;
/** Monday 19 Oct 2026, 08:00 in London. */
export const MONDAY = '2026-10-19T07:00:00.000Z';

export function harness(): Harness {
  return createHarness(MONDAY);
}

export interface Ben {
  launched: Launched;
  s: AppServices;
  gymId: string;
}

/** Set up, with history logged on earlier days; the clock ends back on `MONDAY`. */
export async function benWithHistory(h: Harness): Promise<Ben> {
  const start = h.clockMs;
  h.clockMs = start - 14 * DAY;
  const launched = await h.launch();
  const s = launched.services;
  const gymId = await setUpGym(h, s);
  for (const back of [12, 9, 5, 2]) {
    h.clockMs = start - back * DAY;
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }, { load: 80, reps: 7, rpe: 9 }] },
      { exercise: 'Incline dumbbell press', sets: [{ load: 24, reps: 10, rpe: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 59, reps: 10, rpe: 8 }] },
      { exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }] },
      { exercise: 'Push-up', sets: [{ load: null, reps: 15 }] },
    ]);
  }
  h.clockMs = start;
  return { launched, s, gymId };
}

/** A builder plan in use (4 days, Upper/Lower), applied today. `schedule: 'set'` with `days` gives a Set days plan. */
export async function withPlan(h: Harness, ben: Ben, patch: Partial<PlanBuilderAnswers> = {}): Promise<string> {
  const session = await ben.s.planBuilder.open();
  if (session === null) throw new Error('no plan builder');
  const answers: PlanBuilderAnswers = { ...session.answers, sessions: 4, split: 'ul', ...patch };
  const built = await ben.s.planBuilder.save(session, answers, null, h.ids());
  if (!built.ok) throw new Error(`plan not built: ${built.reason}`);
  const applied = await ben.s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('plan not applied');
  return built.planId;
}

export async function todayData(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Today's plan card committed and started, as Start does. Returns the session ID. */
export async function startPlanDay(h: Harness, ben: Ben): Promise<string> {
  const data = await todayData(ben.s);
  const key = data.nextKey ?? data.days[0]?.key;
  const controls = key === undefined ? undefined : data.initial[key];
  if (key === undefined || controls === undefined) throw new Error('no plan day on Today');
  const c = await ben.s.todaySession.commit(data, { dayKey: key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await ben.s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: ben.gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('plan day not started');
  return r.aggregate.session.id;
}

/** Start today's plan day, log a set and finish it. Returns the session ID. */
export async function doPlanDay(h: Harness, ben: Ben): Promise<string> {
  const id = await startPlanDay(h, ben);
  await finishWorkout(h, ben.s, id);
  return id;
}
