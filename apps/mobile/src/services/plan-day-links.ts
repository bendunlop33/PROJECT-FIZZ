import { liveRoutines, linkPlanDaysOf, linkRefs, planLinksFor, planRoutines, SPLIT_WINDOW_DAYS, toIso, toMs, type HistoryWorkout, type PlanLinkEntry } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { Exercise, PlanDraft, Routine } from '@fizz/schemas';

/**
 * (Ben, 28 Oct) How imported and past-logged workouts count towards the plan in use (`planLinksFor`): every reader of
 * the plan's progress (Up next, this week's days, Library › Plan, the week circles, Today's week and header) reads a
 * linked workout as its plan day's. Read from the workouts since the plan was applied (and Up next's 42-day window),
 * kept per state of the database. A failed read is no links (the plan reads as before; never a guess).
 */

const DAY = 86_400_000;
const memo = new WeakMap<object, { key: string; links: Promise<ReadonlyMap<string, PlanLinkEntry>> }>();

/** What the links read: the repositories. */
export type PlanLinksStore = { repos: Pick<Store['repos'], 'routines' | 'sessions' | 'exercises'> };

export interface PlanLinksInput {
  ownerId: string;
  plan: PlanDraft | null;
  nowMs: number;
  /** The plan's templates (`planRoutines`); absent: read. */
  templates?: readonly Routine[];
  /** Exercise facts for a derived title; absent: Ben's exercise rows (every exercise a workout used is one). */
  exerciseOf?: (id: string) => Exercise | null;
  /** The workouts to read; absent: read (the plan's span and the 42-day window), kept while history and the plan hold. */
  sessions?: readonly HistoryWorkout[];
}

export async function readPlanLinks(store: PlanLinksStore, input: PlanLinksInput): Promise<ReadonlyMap<string, PlanLinkEntry>> {
  const plan = input.plan;
  if (plan === null || plan.applied === null) return new Map();
  try {
    const templates = input.templates ?? planRoutines(plan, liveRoutines(await store.repos.routines.listByOwner(input.ownerId)));
    const days = linkPlanDaysOf(plan, templates);
    if (days.length === 0) return new Map();
    const fromMs = Math.min(toMs(plan.applied.atUtc), input.nowMs - SPLIT_WINDOW_DAYS * DAY) - 7 * DAY;
    const read = async (): Promise<ReadonlyMap<string, PlanLinkEntry>> => {
      const sessions = input.sessions ?? (await store.repos.sessions.listFinishedBetweenReadable(input.ownerId, toIso(fromMs), toIso(input.nowMs + 1))).sessions;
      let exerciseOf = input.exerciseOf;
      if (exerciseOf === undefined) {
        const rows = new Map((await store.repos.exercises.list()).map((e) => [e.id, e] as const));
        exerciseOf = (id) => rows.get(id) ?? null;
      }
      return planLinksFor({ plan, days, workouts: sessions, exerciseOf });
    };
    if (input.sessions !== undefined) return await read();
    // Kept while history (`historyStamp`), the plan (its version) and its days hold, within the hour.
    const stamp = await store.repos.sessions.historyStamp(input.ownerId);
    const key = [input.ownerId, plan.id, String(plan.version), stamp, toIso(input.nowMs).slice(0, 13), ...days.map((d) => `${d.routineId}:${String(d.dayIndex)}:${d.name}:${d.mainLiftExerciseId ?? '-'}:${d.exerciseIds.join('+')}`)].join('|');
    const owner = store.repos.sessions;
    const was = memo.get(owner);
    if (was?.key === key) return await was.links;
    const links = read();
    memo.set(owner, { key, links });
    links.catch(() => {
      if (memo.get(owner)?.links === links) memo.delete(owner);
    });
    return await links;
  } catch {
    return new Map();
  }
}

/**
 * Ben's finished-workout refs of any source (`listFinishedRefs` with imports) as the plan reads them (`linkRefs`): a
 * linked workout carries its plan day's template; an imported one that isn't linked is left out, as before.
 */
export async function planRefs(store: PlanLinksStore, input: PlanLinksInput, limit: number): Promise<Awaited<ReturnType<Store['repos']['sessions']['listFinishedRefs']>>> {
  const refs = await store.repos.sessions.listFinishedRefs(input.ownerId, limit, { includeImported: true });
  return linkRefs(refs, await readPlanLinks(store, input));
}
