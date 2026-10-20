import { REMINDER_HORIZON_DAYS, rotationRoutines, type PlanOverview, type ReminderSession, type UpNextForecast } from '@fizz/domain';

import type { AppServices } from '../services/app-services';
import type { NextSessionPreview, RoutineRow } from '../services/workout-services';

/**
 * The morning reminder's view of Up next (Ben, 20 Oct): read only through the
 * services Today already uses (`next.preview` at the selected gym, the same
 * resolver as Today's card), plus what Up next walks through after it, only
 * where the resolver itself walks a fixed order:
 *
 * - a plan day (`Day 2 of 4`): the plan's adaptive rule run forward
 *   (`next.planAhead`: the day trained least recently, assuming each named
 *   day is done; a `Make next` pin first until its day is done), since Up
 *   next doesn't walk a plan in day order (plan-adapt, Ben 20 Oct);
 * - a rotation workout (`after`, `only`): the rotation in the resolver's own
 *   order (`rotationRoutines`);
 * - anything else (a split day picked by least-recently-trained muscles, or
 *   the last workout repeated): no walk, so only day 1 is reminded (review
 *   morning-20oct B1: never a session Up next wouldn't name).
 *
 * The walk is a prediction for days 2–7 only; it is recomputed whenever
 * anything that moves Up next changes. Local reads only. Never throws: an
 * unreadable part is left out (an unreadable Up next sends nothing).
 */

const NO_CYCLE: UpNextForecast['cycle'] = { sessions: [], at: -1 };

/** Today's card shows nothing without a gym; neither does the reminder. */
export async function readUpNextForecast(services: AppServices): Promise<UpNextForecast> {
  const gym = await services.yourData.currentGym().catch(() => null);
  const next = gym === null ? null : await services.next.preview(gym.id).catch(() => null);
  const lastStartedUtc = await lastStarted(services);
  if (gym === null || next === null) return { next: null, paused: false, cycle: NO_CYCLE, gymName: gym?.name ?? null, lastStartedUtc };
  const overview = await services.plans.overview().catch(() => null);
  const basis = next.routine?.basis ?? null;
  const exact: ReminderSession = { title: next.title, planDay: basis?.kind === 'plan' ? { n: basis.dayN, of: basis.of } : null, aboutMinutes: next.aboutMinutes };
  const paused = planPaused(overview);
  if (basis?.kind === 'plan') {
    const ahead = paused ? [] : await readPlanAhead(services, next, gym.id).catch(() => []);
    return { next: exact, paused, cycle: NO_CYCLE, ahead, gymName: gym.name, lastStartedUtc };
  }
  const cycle = await readCycle(services, next, gym.id).catch(() => NO_CYCLE);
  return { next: exact, paused, cycle, gymName: gym.name, lastStartedUtc };
}

/**
 * A paused plan sends nothing (review morning-20oct S3): `PlanOverview.paused`
 * (`{ text, untilDate } | null`, the pause running now). Up next itself
 * follows the normal rules while paused, so it can't say.
 */
export function planPaused(overview: PlanOverview | null): boolean {
  return overview !== null && overview.paused !== null;
}

async function lastStarted(services: AppServices): Promise<string | null> {
  const [active, past] = await Promise.all([services.sessions.active().catch(() => null), services.history.pastWorkouts({ limit: 1 }).catch(() => null)]);
  const times = [active?.session.startedAt.utc ?? null, past?.rows[0]?.startedAtUtc ?? null].filter((t): t is string => t !== null);
  return times.sort().at(-1) ?? null;
}

async function minutesOf(services: AppServices, routineId: string, gymId: string): Promise<number | null> {
  return (await services.routines.planned(routineId, gymId).catch(() => null))?.aboutMinutes ?? null;
}

/** The rotation in the order Up next walks it: the domain's own `rotationRoutines` (review N6). */
export function rotationOrder(rows: readonly RoutineRow[]): RoutineRow[] {
  return rotationRoutines(rows.map((r) => ({ ...r, createdAtUtc: r.rotationAtUtc, deletedAtUtc: null })));
}

/** Days 2–7 with a plan: the adaptive rule run forward by the service; unreadable: none (day 1 only). */
async function readPlanAhead(services: AppServices, next: NextSessionPreview, gymId: string): Promise<ReminderSession[]> {
  const first = next.routine?.id;
  if (first === undefined) return [];
  const days = (await services.next.planAhead(gymId, first, REMINDER_HORIZON_DAYS - 1)) ?? [];
  const minutes = new Map<string, number | null>();
  const out: ReminderSession[] = [];
  for (const d of days) {
    if (!minutes.has(d.routineId)) minutes.set(d.routineId, await minutesOf(services, d.routineId, gymId));
    out.push({ title: d.name, planDay: { n: d.dayN, of: d.of }, aboutMinutes: minutes.get(d.routineId) ?? null });
  }
  return out;
}

async function readCycle(services: AppServices, next: NextSessionPreview, gymId: string): Promise<UpNextForecast['cycle']> {
  const basis = next.routine?.basis ?? null;
  if (basis?.kind === 'after' || basis?.kind === 'only') {
    const rows = rotationOrder(await services.routines.list());
    const at = rows.findIndex((r) => r.id === next.routine?.id);
    if (at < 0) return NO_CYCLE;
    const sessions: ReminderSession[] = [];
    for (const r of rows) sessions.push({ title: r.name, planDay: null, aboutMinutes: await minutesOf(services, r.id, gymId) });
    return { sessions, at };
  }
  // A split day (least recently trained, by muscles) or the last workout repeated: the resolver walks no fixed order.
  return NO_CYCLE;
}
