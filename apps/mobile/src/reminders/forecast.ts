import { addDays, localDateOf, REMINDER_HORIZON_DAYS, reminderSlots, rotationRoutines, type MorningReminderSettings, type PlanOverview, type ReminderSession, type UpNextForecast } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import type { AppServices } from '../services/app-services';
import type { NextSessionPreview, PlanAheadRow, RoutineRow } from '../services/workout-services';

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
 *
 * The run rule (Ben, 20 Oct): with `at` (the clock, zone and settings the
 * schedule uses), the plan's days are predicted for the reminder dates
 * themselves (`reminderSlots`, passed on as `slots`), so a long or hard run
 * (planned or done) next to one keeps legs off it. When the first reminder
 * falls on a later date, the plan's day 1 is predicted for that date too
 * (`firstOn`; a `Make next` pin stays first). For a rotation each session
 * says whether it is a leg day, whether it is pinned, and where the
 * resolver's own order starts (`from`), and the activities around the dates
 * come along for the domain's walk.
 */

/** What the schedule will be computed with: the forecast predicts for the same reminder dates. */
export interface ForecastAt {
  nowMs: number;
  tz: string;
  settings: Pick<MorningReminderSettings, 'hour' | 'minute' | 'days'>;
}

const NO_CYCLE: UpNextForecast['cycle'] = { sessions: [], at: -1 };

/** Today's card shows nothing without a gym; neither does the reminder. */
export async function readUpNextForecast(services: AppServices, at: ForecastAt | null = null): Promise<UpNextForecast> {
  const gym = await services.yourData.currentGym().catch(() => null);
  const next = gym === null ? null : await services.next.preview(gym.id).catch(() => null);
  const lastStartedUtc = await lastStarted(services);
  if (gym === null || next === null) return { next: null, paused: false, cycle: NO_CYCLE, gymName: gym?.name ?? null, lastStartedUtc };
  const slots = at === null ? [] : reminderSlots(at.nowMs, at.tz, at.settings, lastStartedUtc);
  const dates = slots.map((x) => x.date);
  const activities = await activitiesAround(services, dates);
  const overview = await services.plans.overview().catch(() => null);
  const basis = next.routine?.basis ?? null;
  const legIds = next.routine === null ? new Set<string>() : await services.next.legDayIds([next.routine.id]).catch(() => new Set<string>());
  const exact: ReminderSession = { title: next.title, planDay: basis?.kind === 'plan' ? { n: basis.dayN, of: basis.of } : null, aboutMinutes: next.aboutMinutes, ...(next.routine === null ? {} : { id: next.routine.id, legs: legIds.has(next.routine.id) }) };
  const paused = planPaused(overview);
  const withSlots = at === null ? {} : { slots };
  if (basis?.kind === 'plan') {
    const today = at === null ? null : localDateOf(at.nowMs, at.tz);
    const firstOn = dates[0] !== undefined && dates[0] !== today ? dates[0] : null;
    const plan = paused ? null : await readPlanAhead(services, next, gym.id, dates.slice(1), firstOn).catch(() => null);
    return { next: plan?.pinned === true ? { ...exact, pinned: true } : exact, paused, cycle: NO_CYCLE, ahead: plan?.ahead ?? [], firstOn: plan?.first ?? null, gymName: gym.name, lastStartedUtc, activities, ...withSlots };
  }
  const cycle = await readCycle(services, next, gym.id).catch(() => NO_CYCLE);
  return { next: exact, paused, cycle, gymName: gym.name, lastStartedUtc, activities, ...withSlots };
}

/** Live activities from the day before the first reminder date to the day after the last (the run rule). */
async function activitiesAround(services: AppServices, dates: readonly string[]): Promise<Activity[]> {
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) return [];
  return services.activities.between(addDays(first, -1), addDays(last, 2)).catch(() => []);
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

/**
 * Days 2–7 with a plan: the adaptive rule run forward by the service; with `firstOn`, day 1 predicted for that
 * date too. Unreadable: none (day 1 only, unmoved).
 */
async function readPlanAhead(services: AppServices, next: NextSessionPreview, gymId: string, dates: readonly string[], firstOn: string | null): Promise<{ pinned: boolean; first: ReminderSession | null; ahead: ReminderSession[] } | null> {
  const firstId = next.routine?.id;
  if (firstId === undefined) return null;
  const r = await services.next.planAhead(gymId, firstId, REMINDER_HORIZON_DAYS - 1, dates, firstOn);
  if (r === null) return null;
  const minutes = new Map<string, number | null>();
  const session = async (d: PlanAheadRow): Promise<ReminderSession> => {
    if (!minutes.has(d.routineId)) minutes.set(d.routineId, await minutesOf(services, d.routineId, gymId));
    return { id: d.routineId, title: d.name, planDay: { n: d.dayN, of: d.of }, aboutMinutes: minutes.get(d.routineId) ?? null, legs: d.legs, ...(d.pinned ? { pinned: true } : {}) };
  };
  const first = r.first === null ? null : await session(r.first);
  const ahead: ReminderSession[] = [];
  for (const d of r.days) ahead.push(await session(d));
  return { pinned: r.firstPinned, first, ahead };
}

async function readCycle(services: AppServices, next: NextSessionPreview, gymId: string): Promise<UpNextForecast['cycle']> {
  const basis = next.routine?.basis ?? null;
  if (basis?.kind === 'after' || basis?.kind === 'only') {
    const rows = rotationOrder(await services.routines.list());
    const at = rows.findIndex((r) => r.id === next.routine?.id);
    if (at < 0) return NO_CYCLE;
    const legIds = await services.next.legDayIds(rows.map((r) => r.id)).catch(() => new Set<string>());
    const sessions: ReminderSession[] = [];
    for (const r of rows) sessions.push({ id: r.id, title: r.name, planDay: null, aboutMinutes: await minutesOf(services, r.id, gymId), legs: legIds.has(r.id) });
    // Where the resolver's order starts: the one after the workout last done (`after`), which the run rule may have
    // passed over today (review ben-runs-20oct S1).
    // By name, so only when exactly one workout in the rotation has it.
    const lastName = basis.kind === 'after' ? basis.routineName : null;
    const done = rows.filter((r) => r.name === lastName).length === 1 ? rows.findIndex((r) => r.name === lastName) : -1;
    return { sessions, at, ...(done >= 0 ? { from: (done + 1) % rows.length } : {}) };
  }
  // A split day (least recently trained, by muscles) or the last workout repeated: the resolver walks no fixed order.
  return NO_CYCLE;
}
