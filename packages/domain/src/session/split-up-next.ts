import type { HistoryLike } from '../history-summary';
import type { Exercise, MuscleGroup, SessionAggregate, SplitDay, TrainingSplit } from '@fizz/schemas';

import { toMs } from '../time';
import { lastSplitWorkoutGroups, matchSplitDay, nextSplitDay, workoutGroupsOf } from '../training-profile';
import { normaliseSessionName } from './session-types';

/**
 * Up next by split day (PM decision 18 Oct, pending Ben). Pure.
 *
 * Every finished workout counts, whatever its name or source (coach-built,
 * empty, imported), by the muscles of the exercises actually done. Up next
 * is the split day trained least recently, never a day the last workout
 * trained unless no other day is left. The source workout to plan it from
 * prefers one that wasn't cut short or built shorter than Ben's session
 * length, so a 20-minute workout doesn't become the next plan by default.
 */

/** How far back Up next looks (as the session picker's `OLDER`). */
export const SPLIT_WINDOW_DAYS = 42;

/** A day counts as trained by a workout with at least this share of its split-matched working sets (or as its main day). */
export const SPLIT_DAY_SHARE = 1 / 3;

/** A workout with at least this share of its planned working sets not done (skipped, never logged) was cut short. */
export const CUT_SHORT_SHARE = 0.25;

/** A finished workout, as the split rule reads it. */
export interface SplitWorkout {
  sessionId: string;
  startedAtUtc: string;
  groups: ReadonlyMap<MuscleGroup, number>;
  /** Cut short, or a coach build shorter than Ben's session length: not preferred as a source. */
  short: boolean;
}

const BUILT_MINUTES = /\s·\s(\d{1,3})\smin$/u;

/** `Pull · 20 min` (a coach build's name) → 20; null for any other name. */
export function builtMinutes(name: string): number | null {
  const m = BUILT_MINUTES.exec(name.trim());
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** A coach build's name without its length: `Pull · 20 min` → `Pull`. Other names unchanged. */
export function baseWorkoutName(name: string): string {
  return name.trim().replace(BUILT_MINUTES, '').trim();
}

/** Whether a workout or routine name is a split day's name (`Pull`, `pull`, `Pull · 45 min`). */
export function isSplitDayName(name: string, dayName: string): boolean {
  const a = normaliseSessionName(baseWorkoutName(name));
  return a.length > 0 && a === normaliseSessionName(dayName);
}

/** Planned working sets not done (skipped or never logged) are `CUT_SHORT_SHARE` or more of them. */
export function cutShort(a: Pick<SessionAggregate, 'sets'>): boolean {
  const working = a.sets.filter((s) => s.setType !== 'warmup' && s.status !== 'deleted' && s.pairedWithSetId === null);
  if (working.length === 0) return false;
  const notDone = working.filter((s) => s.status === 'skipped' || s.status === 'pending').length;
  return notDone / working.length >= CUT_SHORT_SHARE;
}

/**
 * The split rule's view of one finished workout. `sessionMinutes`: Ben's
 * session length (Profile), or null when he hasn't saved training details.
 */
export function splitWorkoutOf(a: HistoryLike, exerciseOf: (id: string) => Pick<Exercise, 'primaryMuscles'> | null, sessionMinutes: number | null): SplitWorkout {
  const built = a.session.coachDraft === undefined ? null : builtMinutes(a.session.coachDraft.name);
  return {
    sessionId: a.session.id,
    startedAtUtc: a.session.startedAt.utc,
    groups: workoutGroupsOf(a, exerciseOf),
    short: cutShort(a) || (built !== null && sessionMinutes !== null && built < sessionMinutes),
  };
}

/** The days of `split` a workout trained: its main day, and any day with `SPLIT_DAY_SHARE` of its split-matched working sets. */
export function splitDaysTrained(split: TrainingSplit, groups: ReadonlyMap<MuscleGroup, number>): string[] {
  const main = matchSplitDay(split, groups);
  if (main === null) return [];
  const inSplit = new Set<string>(split.days.flatMap((d) => d.bodyParts));
  let total = 0;
  for (const [g, n] of groups) if (inSplit.has(g)) total += n;
  return split.days.filter((d) => d.id === main.id || d.bodyParts.reduce((s, b) => s + (groups.get(b) ?? 0), 0) / total >= SPLIT_DAY_SHARE).map((d) => d.id);
}

const newestFirst = (ws: readonly SplitWorkout[]): SplitWorkout[] => [...ws].sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc) || (a.sessionId < b.sessionId ? 1 : -1));

export interface SplitDayPick {
  day: SplitDay;
  /** When this day was last trained in the window; null: not in it. */
  lastTrainedUtc: string | null;
}

/**
 * Split days in the order they are due: trained least recently first (never
 * trained in `workouts` first, ties in split order), leaving out the days the
 * newest matching workout trained unless that leaves none. The caller plans
 * the first one it has a plan for. Empty when no workout matches any day
 * (the caller keeps its other rules).
 */
export function splitDaysByDue(split: TrainingSplit, workouts: readonly SplitWorkout[]): SplitDayPick[] {
  const last = new Map<string, string>();
  let lastDays: string[] | null = null;
  for (const w of newestFirst(workouts)) {
    const days = splitDaysTrained(split, w.groups);
    if (days.length === 0) continue;
    lastDays ??= days;
    for (const d of days) if (!last.has(d)) last.set(d, w.startedAtUtc);
  }
  if (lastDays === null) return [];
  const justDone = lastDays;
  const others = split.days.filter((d) => !justDone.includes(d.id));
  const pool = others.length > 0 ? others : split.days;
  const ms = (id: string): number => {
    const at = last.get(id);
    return at === undefined ? Number.NEGATIVE_INFINITY : toMs(at);
  };
  // `sort` is stable: equal days keep split order.
  return [...pool].sort((a, b) => (ms(a.id) === ms(b.id) ? 0 : ms(a.id) < ms(b.id) ? -1 : 1)).map((day) => ({ day, lastTrainedUtc: last.get(day.id) ?? null }));
}

/** The split day due first (`splitDaysByDue`), or null. */
export function upNextSplitDay(split: TrainingSplit, workouts: readonly SplitWorkout[]): SplitDayPick | null {
  return splitDaysByDue(split, workouts)[0] ?? null;
}

/**
 * The workout to plan a split day from: the newest that was mainly that day,
 * else the newest that trained it; a full one (not `short`) before a short
 * one. `primary`: it was mainly that day (so it can be called by the day's
 * name). Null when none trained it.
 */
export function splitDaySource(split: TrainingSplit, day: Pick<SplitDay, 'id'>, workouts: readonly SplitWorkout[]): { sessionId: string; primary: boolean } | null {
  const ranked = newestFirst(workouts).flatMap((w) => {
    if (!splitDaysTrained(split, w.groups).includes(day.id)) return [];
    const primary = matchSplitDay(split, w.groups)?.id === day.id;
    return [{ w, primary }];
  });
  const order = [(x: (typeof ranked)[number]) => x.primary && !x.w.short, (x: (typeof ranked)[number]) => !x.primary && !x.w.short, (x: (typeof ranked)[number]) => x.primary, () => true];
  for (const test of order) {
    const hit = ranked.find(test);
    if (hit !== undefined) return { sessionId: hit.w.sessionId, primary: hit.primary };
  }
  return null;
}

/** Among workouts (any order), the newest full one, else the newest; null when empty. */
export function preferFullSource(workouts: readonly SplitWorkout[]): string | null {
  const sorted = newestFirst(workouts);
  return (sorted.find((w) => !w.short) ?? sorted[0])?.sessionId ?? null;
}

/**
 * The split day to preselect for `Build with coach` (review today-18oct S3): the same day Up next is
 * planned for (`splitDaysByDue`, workouts in the last `SPLIT_WINDOW_DAYS` before `nowUtc`), else the
 * day after the last one (`nextSplitDay`) when no workout in the window matches a day.
 */
export function buildDayFor(split: TrainingSplit, sessions: readonly HistoryLike[], exerciseOf: (id: string) => Pick<Exercise, 'id' | 'name' | 'primaryMuscles'> | null, nowUtc: string): SplitDay {
  const from = toMs(nowUtc) - SPLIT_WINDOW_DAYS * 86_400_000;
  const workouts = sessions.filter((a) => toMs(a.session.startedAt.utc) >= from).map((a) => splitWorkoutOf(a, exerciseOf, null));
  return splitDaysByDue(split, workouts)[0]?.day ?? nextSplitDay(split, lastSplitWorkoutGroups(split, sessions, exerciseOf));
}
