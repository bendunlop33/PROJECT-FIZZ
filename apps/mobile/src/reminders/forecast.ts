import { rotationRoutines, type PlanOverview, type ReminderSession, type UpNextForecast } from '@fizz/domain';

import type { AppServices } from '../services/app-services';
import type { NextSessionPreview, RoutineRow } from '../services/workout-services';

/**
 * The morning reminder's view of Up next (Ben, 20 Oct): read only through the
 * services Today already uses (`next.preview` at the selected gym, the same
 * resolver as Today's card), plus what Up next walks through after it, only
 * where the resolver itself walks a fixed order:
 *
 * - a plan day (`Day 2 of 4`): the plan's days in order (`plans.overview`);
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
  const cycle = await readCycle(services, next, overview, gym.id).catch(() => NO_CYCLE);
  return { next: exact, paused: planPaused(overview), cycle, gymName: gym.name, lastStartedUtc };
}

/**
 * A paused plan sends nothing. MERGE GATE (review morning-20oct S3): the pause
 * lands with `claude/plan-adapt-20oct`, as `PlanOverview.paused`
 * (`{ text, untilDate } | null`); Up next itself carries no pause there (it
 * falls back to the normal rules). Until then the field is absent and this is
 * false. On merge, check the field is still `paused` and add a paused-plan
 * test on the real services (the field is read untyped until then).
 */
export function planPaused(overview: PlanOverview | null): boolean {
  const read: object | null = overview;
  const paused = read !== null && 'paused' in read ? read.paused : undefined;
  return paused !== undefined && paused !== null && paused !== false;
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

async function readCycle(services: AppServices, next: NextSessionPreview, overview: PlanOverview | null, gymId: string): Promise<UpNextForecast['cycle']> {
  const basis = next.routine?.basis ?? null;
  if (basis?.kind === 'plan') {
    if (overview === null) return NO_CYCLE;
    const of = overview.days.length;
    const sessions: ReminderSession[] = [];
    for (const d of overview.days) sessions.push({ title: d.name, planDay: { n: d.n, of }, aboutMinutes: await minutesOf(services, d.routineId, gymId) });
    return { sessions, at: basis.dayN - 1 };
  }
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
