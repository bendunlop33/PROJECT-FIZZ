import type { MuscleGroup, TrainingSplit } from '@fizz/schemas';
import { avoidLegDays, type LegRunNear } from '../activity';
import type { BuilderPool, GroupCount } from '../builder/build';
import { BUILDER_DEFAULT_MAIN_LIFTS, defaultBuilderMainLift } from '../builder/main-lift';
import { mixForDay } from '../builder/setup';
import type { BuilderGroupName, BuilderInfoLookup } from '../builder/types';
import { isSplitDayName, splitDaysByDue, type SplitWorkout } from '../session/split-up-next';
import { matchSplitDay, nextSplitDay } from '../training-profile';
import type { TodayDay, TodayTemplate } from './session';

/**
 * Today with no plan (workout-builder-v3 §2.0.4 "No plan", rewritten 23 Oct; D7): the day row comes from Profile ›
 * Split, the one split source without a plan. Each split day is a Today day like a plan day, drafted by the same
 * builder rules (`assembleTodayDraft`), so the same day reads the same with or without a plan. Pure.
 *
 * - The day's mix is Set up's for that day (`mixForDay`).
 * - Its main lifts: the one Ben saved for the day (Profile), then the lead group's defaults here
 *   (`BUILDER_DEFAULT_MAIN_LIFTS`), up to `SPLIT_DAY_MAIN_OPTIONS`; Your workout's Main lift row offers them.
 * - Its exercises (they lead every pool): the newest workout that trained that day, so the card starts from his own.
 * - NEXT: the app's Up next resolver when it names a split day, else the day due first (least recently trained, the
 *   run rule), else the day after the last one.
 */

/** Main-lift options per split day (the prototype's two: `Bench`, `Incline`). */
export const SPLIT_DAY_MAIN_OPTIONS = 2;

/** The Today day key of a split day (the builder draft key's `other:<splitDayId>`, planId and dayIndex null). */
export const splitDayKey = (dayId: string): string => `other:${dayId}`;

export interface SplitDayMainInput {
  /** The day's groups in order; the first that isn't Abs leads. */
  groups: readonly BuilderGroupName[];
  /** Ben's saved main lift for the day (Profile), if any. */
  saved: string | null;
  /** Per group, best first: Ben's own then the catalogue, here, not pain-flagged. */
  pool: BuilderPool;
  info: BuilderInfoLookup;
  catalogueKeyOf: (exerciseId: string) => string | null;
  max?: number;
}

/**
 * A split day's main-lift options: Ben's saved one first (when it is a usable exercise), then the lead group's
 * default main lifts in the pool's order, then the builder's own default (`defaultBuilderMainLift`). Empty when the
 * lead group has no compound here (an arms day): honestly no main lift.
 */
export function splitDayMainOptions(input: SplitDayMainInput): string[] {
  const max = input.max ?? SPLIT_DAY_MAIN_OPTIONS;
  const out: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id == null || out.length >= max || out.includes(id) || input.info(id) === null) return;
    out.push(id);
  };
  push(input.saved);
  const lead = input.groups.find((g) => g !== 'Abs');
  if (lead !== undefined) {
    const pool = input.pool(lead);
    for (const key of BUILDER_DEFAULT_MAIN_LIFTS[lead] ?? []) push(pool.find((id) => input.catalogueKeyOf(id) === key && input.info(id)?.group === lead));
  }
  push(defaultBuilderMainLift({ groups: input.groups, pool: input.pool, info: input.info, catalogueKeyOf: input.catalogueKeyOf }));
  return out;
}

export interface TodaySplitDaysInput {
  split: Pick<TrainingSplit, 'days'>;
  /** Profile's main lift per day ID (`TrainingProfile.mainLifts`); else each split day's own. */
  mainLifts?: Readonly<Record<string, string>> | undefined;
  /** The exercises of the newest workout that trained the day, in its order (empty: none). */
  exercisesOf: (dayId: string) => readonly string[];
  pool: BuilderPool;
  info: BuilderInfoLookup;
  catalogueKeyOf: (exerciseId: string) => string | null;
  /** Ben's usual length (Profile). */
  defaultMinutes: number;
}

/** The Profile split's days as Today days, in split order. One template per main-lift option. */
export function todaySplitDays(input: TodaySplitDaysInput): TodayDay[] {
  return input.split.days.map((day) => {
    const mix: GroupCount[] = mixForDay(day.id, day.bodyParts);
    const groups = mix.map((g) => g.group);
    const saved = input.mainLifts?.[day.id] ?? day.mainLiftExerciseId ?? null;
    const mains = splitDayMainOptions({ groups, saved, pool: input.pool, info: input.info, catalogueKeyOf: input.catalogueKeyOf });
    const exerciseIds = [...new Set(input.exercisesOf(day.id))].filter((id) => input.info(id) !== null);
    const absPlan = groups.includes('Abs');
    const templates: TodayTemplate[] = (mains.length > 0 ? mains : [null]).map((id) => {
      const g = id === null ? null : (input.info(id)?.group ?? null);
      // The main lift's group leads (§3.7: the first group keeps at least one).
      const ordered = g === null || !mix.some((x) => x.group === g) ? mix : [...mix.filter((x) => x.group === g), ...mix.filter((x) => x.group !== g)];
      return {
        routineId: null,
        version: null,
        label: id === null ? day.name : (input.info(id)?.name ?? day.name),
        mainLiftExerciseId: id,
        exerciseIds,
        minutes: input.defaultMinutes,
        absPlan,
        supersetsPlan: true,
        groups: ordered.map((x) => ({ ...x })),
      };
    });
    return { key: splitDayKey(day.id), kind: 'split' as const, name: day.name, planId: null, dayIndex: null, splitDayId: day.id, templates };
  });
}

export interface TodaySplitNextInput {
  split: TrainingSplit;
  /**
   * The app's Up next resolver's pick, when it could be read (null: none): its title (`Back`, or the source workout's
   * own name, `Push`) and the muscles its source workout trained (null for a routine).
   */
  upNext: { title: string; groups: ReadonlyMap<MuscleGroup, number> | null } | null;
  /** Finished workouts in the window, as the split rule reads them. */
  workouts: readonly SplitWorkout[];
  /** A long or hard run near today (legs move after the other days). */
  near: LegRunNear | null;
  /** The newest workout's day, for the day after it when no workout matches a day by muscles. */
  lastGroups: Parameters<typeof nextSplitDay>[1];
}

/** NEXT on the no-plan day row: which split day, and why (`resolver`: the app's Up next named it). */
export function todaySplitNext(input: TodaySplitNextInput): { dayId: string; why: 'resolver' | 'due' | 'after_last' } | null {
  const days = input.split.days;
  if (days.length === 0) return null;
  const up = input.upNext;
  // The day it names, else the day its source workout mainly trained (the resolver planned that day from it).
  const named = up === null ? undefined : (days.find((d) => isSplitDayName(up.title, d.name)) ?? (up.groups === null ? undefined : (matchSplitDay(input.split, up.groups) ?? undefined)));
  if (named !== undefined) return { dayId: named.id, why: 'resolver' };
  const due = splitDaysByDue(input.split, input.workouts);
  const order = avoidLegDays(due, (p) => p.day.bodyParts, input.near).order;
  const first = order[0];
  if (first !== undefined) return { dayId: first.day.id, why: 'due' };
  return { dayId: nextSplitDay(input.split, input.lastGroups).id, why: 'after_last' };
}
