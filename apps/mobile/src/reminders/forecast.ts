import { isSplitDayName, type ReminderSession, type UpNextForecast } from '@fizz/domain';

import type { AppServices } from '../services/app-services';
import type { NextSessionPreview } from '../services/workout-services';

/**
 * The morning reminder's view of Up next (Ben, 20 Oct): read only through the
 * services Today already uses (`next.preview` at the selected gym, the same
 * resolver as Today's card), plus what Up next walks through after it:
 *
 * - a plan day (`Day 2 of 4`): the plan's days in order (`plans.overview`);
 * - a rotation workout: the rotation in order (`routines.list`);
 * - otherwise: the split's days in order from the day due (`training.buildCard`).
 *
 * The walk is a prediction for days 2–7 only; it is recomputed whenever
 * anything that moves Up next changes. Local reads only. Never throws: an
 * unreadable part is left out (an unreadable Up next sends nothing).
 */

/** Today's card shows nothing without a gym; neither does the reminder. */
export async function readUpNextForecast(services: AppServices): Promise<UpNextForecast> {
  const gym = await services.yourData.currentGym().catch(() => null);
  const next = gym === null ? null : await services.next.preview(gym.id).catch(() => null);
  const lastStartedUtc = await lastStarted(services);
  if (gym === null || next === null) return { next: null, paused: false, cycle: { sessions: [], at: -1 }, gymName: gym?.name ?? null, lastStartedUtc };
  const basis = next.routine?.basis ?? null;
  const exact: ReminderSession = { title: next.title, planDay: basis?.kind === 'plan' ? { n: basis.dayN, of: basis.of } : null, aboutMinutes: next.aboutMinutes };
  const cycle = await readCycle(services, next, gym.id).catch(() => ({ sessions: [] as ReminderSession[], at: -1 }));
  return { next: exact, paused: pausedOf(next), cycle, gymName: gym.name, lastStartedUtc };
}

/**
 * A paused plan sends nothing. Up next doesn't report a pause yet (it is being
 * added on another branch); when it does, it is read here and only here.
 */
function pausedOf(next: NextSessionPreview): boolean {
  return (next as NextSessionPreview & { paused?: unknown }).paused === true;
}

async function lastStarted(services: AppServices): Promise<string | null> {
  const [active, past] = await Promise.all([services.sessions.active().catch(() => null), services.history.pastWorkouts({ limit: 1 }).catch(() => null)]);
  const times = [active?.session.startedAt.utc ?? null, past?.rows[0]?.startedAtUtc ?? null].filter((t): t is string => t !== null);
  return times.sort().at(-1) ?? null;
}

async function minutesOf(services: AppServices, routineId: string, gymId: string): Promise<number | null> {
  return (await services.routines.planned(routineId, gymId).catch(() => null))?.aboutMinutes ?? null;
}

async function readCycle(services: AppServices, next: NextSessionPreview, gymId: string): Promise<UpNextForecast['cycle']> {
  const basis = next.routine?.basis ?? null;
  if (basis?.kind === 'plan') {
    const plan = await services.plans.overview();
    if (plan === null) return { sessions: [], at: -1 };
    const of = plan.days.length;
    const sessions: ReminderSession[] = [];
    for (const d of plan.days) sessions.push({ title: d.name, planDay: { n: d.n, of }, aboutMinutes: await minutesOf(services, d.routineId, gymId) });
    return { sessions, at: basis.dayN - 1 };
  }
  if (basis?.kind === 'after' || basis?.kind === 'only') {
    const rows = (await services.routines.list()).filter((r) => r.inRotation).sort((a, b) => (a.rotationAtUtc < b.rotationAtUtc ? -1 : a.rotationAtUtc > b.rotationAtUtc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sessions: ReminderSession[] = [];
    for (const r of rows) sessions.push({ title: r.name, planDay: null, aboutMinutes: await minutesOf(services, r.id, gymId) });
    return { sessions, at: rows.findIndex((r) => r.id === next.routine?.id) };
  }
  // By split day: the split's days in order, from the one Up next is planned for (by name, else the day due).
  const card = await services.training.buildCard();
  const sessions = card.days.map((d) => ({ title: d.day.name, planDay: null, aboutMinutes: null }));
  const byName = card.days.findIndex((d) => isSplitDayName(next.title, d.day.name));
  return { sessions, at: byName >= 0 ? byName : card.days.findIndex((d) => d.id === card.nextDayId) };
}
