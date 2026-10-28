import { avoidLegDays, type LegRunNear } from '../activity';
import { isSplitBodyPart, matchSplitDay, workoutMuscleGroups } from '../training-profile';
import { addDays, localDateOf, localMidnightUtcMs } from '../calendar';
import { toIso, toMs } from '../time';
import { splitDaysTrained } from './split-up-next';
import { splitNameOf } from './plan-day-link';
import type { Exercise, MuscleGroup, PlanControlUndo, PlanDraft, PlanPause, PlanPin, Routine, SplitBodyPart, TrainingSplit, ZonedTimestamp } from '@fizz/schemas';
import { PLAN_LIMITS } from '@fizz/schemas';

/**
 * A plan that follows what Ben actually does (Ben, 20 Oct: "override the
 * plan by doing what we want without ending the plan … if u skipped legs
 * need to train legs sooner"; "should also be able to pause eg if go on
 * hols"). Pure.
 *
 * - Up next while a plan is in use is the plan day whose body parts were
 *   trained least recently, counting every finished workout (plan day,
 *   coach-built, empty, imported, off-plan) by the muscles actually done:
 *   the split rule (`splitDaysTrained`) with the plan's days as the split.
 *   Never the day(s) the last workout trained unless no other is left.
 *   The plan's days themselves never change.
 * - `Make next` pins one day as Up next until it is done.
 * - Pause: optional `until` date; while paused Up next follows the normal
 *   rules and paused days don't count against the aim. The plan is in use
 *   again on the `until` date (the first open after it writes the resume).
 * - Every pin and pause write is versioned and idempotent on its op ID
 *   (rule 5); `undoPlanControl` puts back the pin and pauses before the
 *   last one (rule 2).
 */

// ---------------------------------------------------------------------------
// A plan day's body parts

/** A day's body part counts when it has at least this share of the day's working sets (else only its biggest). */
export const PLAN_DAY_PART_SHARE = 0.2;

/** A plan day as the adaptive Up next reads it. */
export interface PlanDueDay {
  routineId: string;
  name: string;
  /** Its body parts (`planDayBodyParts`); empty: only its own workouts count for it. */
  bodyParts: readonly SplitBodyPart[];
  createdFromSessionId?: string | null | undefined;
  /**
   * (Workout builder v3 §4.2) Its plan day, (planId, dayIndex) (`planDayOf`): templates of the same
   * plan day (`Chest · bench`, `Chest · incline`) are one day for Up next; a split day the plan uses
   * twice is two days (review b3-data B1). Absent: by routine only.
   */
  planKey?: PlanDayKey | null | undefined;
  /** (28 Oct) Its main lift: tells variants (Pull A / Pull B) apart for a workout off the plan. */
  mainLiftExerciseId?: string | null | undefined;
}

/** A plan day's identity: (planId, dayIndex), as `PlanDayRef`. */
export interface PlanDayKey {
  planId: string;
  dayIndex: number;
}

const sameKey = (a: PlanDayKey | null | undefined, b: PlanDayKey | null | undefined): boolean => a != null && b != null && a.planId === b.planId && a.dayIndex === b.dayIndex;

/** A finished workout as the adaptive Up next reads it. */
export interface PlanDueWorkout {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  /** Working sets done per muscle group (`workoutGroupsOf`). */
  groups: ReadonlyMap<MuscleGroup, number>;
  /** (v3 §4.2) The plan day it was started as (`WorkoutSession.planDay`), and the template it used; absent on older workouts. */
  planDay?: (PlanDayKey & { templateRoutineId?: string | null | undefined }) | null | undefined;
  /** (28 Oct) The lift it led with (`leadLiftOf`: its first exercise with a completed working set); absent: unknown. */
  leadExerciseId?: string | null | undefined;
}

/**
 * A plan day's body parts: from its exercises' primary muscles (working
 * set templates on each exercise's first primary muscle; a part with at
 * least `PLAN_DAY_PART_SHARE` of them, else the biggest), else the split
 * day the plan mapped it to (when that day is in `split`). Empty when
 * neither says (a cardio-only day).
 */
export function planDayBodyParts(routine: Pick<Routine, 'exercises' | 'createdFromPlan'>, exerciseOf: (id: string) => Pick<Exercise, 'primaryMuscles'> | null, split: TrainingSplit | null): SplitBodyPart[] {
  const groups = workoutMuscleGroups(routine.exercises.map((e) => ({ primaryMuscles: exerciseOf(e.exerciseId)?.primaryMuscles ?? [], workingSets: e.setTemplates.filter((t) => t.setType !== 'warmup').length })));
  const parts = [...groups].filter((x): x is [SplitBodyPart, number] => isSplitBodyPart(x[0]));
  const total = parts.reduce((n, [, c]) => n + c, 0);
  if (total > 0) {
    const kept = parts.filter(([, c]) => c / total >= PLAN_DAY_PART_SHARE).map(([g]) => g);
    if (kept.length > 0) return kept;
    const top = [...parts].sort((a, b) => b[1] - a[1])[0];
    return top === undefined ? [] : [top[0]];
  }
  const mapped = routine.createdFromPlan?.splitDayId ?? null;
  const day = mapped === null ? undefined : split?.days.find((d) => d.id === mapped);
  return day === undefined ? [] : [...day.bodyParts];
}

/** The plan's days as a split (one day per plan day with body parts), for the split rule. */
function planSplit(days: readonly PlanDueDay[]): TrainingSplit | null {
  const withParts = days.filter((d) => d.bodyParts.length > 0);
  if (withParts.length === 0) return null;
  return { kind: 'custom', days: withParts.map((d) => ({ id: d.routineId, name: d.name, bodyParts: [...d.bodyParts] })) };
}

/**
 * The plan day this workout was started from (or saved as), if any. (v3
 * §4.2) Or started as: its template (`templateRoutineId`), else its plan
 * day (a `Today only` start has no routine but names its plan and day).
 */
export function ownPlanDay<D extends Pick<PlanDueDay, 'routineId' | 'createdFromSessionId' | 'planKey'>>(days: readonly D[], w: Pick<PlanDueWorkout, 'sessionId' | 'routineId' | 'planDay'>): D | undefined {
  const template = w.planDay?.templateRoutineId ?? null;
  return (
    days.find((d) => d.routineId === w.routineId || (d.createdFromSessionId != null && d.createdFromSessionId === w.sessionId)) ??
    (template === null ? undefined : days.find((d) => d.routineId === template)) ??
    days.find((d) => sameKey(d.planKey, w.planDay))
  );
}

/** The day and every other template of the same plan day (§4.2): one day for Up next. */
function sameDayIds(days: readonly PlanDueDay[], own: PlanDueDay): string[] {
  return days.filter((d) => d.routineId === own.routineId || sameKey(d.planKey, own.planKey)).map((d) => d.routineId);
}

/**
 * The plan days a workout trained, by the split rule with the plan's days as
 * the split (`splitDaysTrained`: the day that got most of its sets, and any
 * with a third of them), plus its own day for a plan workout.
 */
export function planDaysTrained(days: readonly PlanDueDay[], w: PlanDueWorkout): string[] {
  const own = ownPlanDay(days, w);
  const split = planSplit(days);
  const byMuscle = split === null ? [] : splitDaysTrained(split, w.groups);
  return [...new Set([...(own === undefined ? [] : sameDayIds(days, own)), ...byMuscle])];
}

/**
 * The plan days a workout counts as done for, for Up next's order: a plan
 * workout for its own day and the day(s) it mainly trained (the same unless
 * Ben changed it into another day's session), so days that share a muscle
 * (Pull and an Upper day) still take turns; any other workout for every day
 * it trained (`planDaysTrained`).
 */
function planDaysCredited(days: readonly PlanDueDay[], w: PlanDueWorkout): string[] {
  const own = ownPlanDay(days, w);
  if (own === undefined) return planDaysTrained(days, w);
  const split = planSplit(days);
  const main = split === null ? null : (matchSplitDay(split, w.groups) ?? null);
  // Days with the same body parts as its own (`Upper A`, `Upper B`) are the same muscles: trained too.
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const twins = own.bodyParts.length === 0 ? [] : days.filter((d) => same(d.bodyParts, own.bodyParts)).map((d) => d.routineId);
  const mainId = main === null || twins.includes(main.id) ? [] : [main.id];
  return [...new Set([...sameDayIds(days, own), ...twins, ...mainId])];
}

/**
 * The plan days a workout counts as done for: `Your plan` ✓ and clearing a
 * `Make next` pin use this one rule (review plan-adapt S1, S2). A plan
 * workout counts for its own day and the day it mainly trained, when Ben
 * turned it into another day's session (started Pull, did legs: Pull and
 * Legs); any other workout for the days it mainly trained (the split
 * rule's threshold).
 */
export function planDaysDoneBy(days: readonly PlanDueDay[], w: PlanDueWorkout): string[] {
  const own = ownPlanDay(days, w);
  const split = planSplit(days);
  if (own === undefined) return split === null ? [] : splitDaysTrained(split, w.groups);
  const main = split === null ? null : matchSplitDay(split, w.groups);
  const mine = sameDayIds(days, own);
  return main === null || mine.includes(main.id) ? mine : [...mine, main.id];
}

/** This week's merged day (`WeekPlan.merges` with the workout it made): one workout of it does all its days. */
export interface PlanWeekMerge {
  routineId: string;
  dayIds: readonly string[];
}

/** A plan day for this week's count (`assignPlanWeek`). */
export type PlanWeekSlotDay = PlanDueDay;

/** A finished workout for this week's count. */
export interface PlanWeekSlotWorkout extends PlanDueWorkout {
  /**
   * (Ben, 28 Oct) Matched by name to one of several variants (`Pull` → Pull A / Pull B) that its lifts don't tell
   * apart: those days' templates in plan order; it fills the first one not filled yet this week.
   */
  variants?: readonly string[] | null | undefined;
}

/**
 * (Ben, 28 Oct: "one workout counts for two plan days") This week's plan days and the workout that did each, one to
 * one: a workout fills at most one plan day and a plan day takes at most one workout. Pure. In this order:
 *
 * 1. A workout started as a plan day (or from its workout, or linked to it by Ben's answer or clearly by lifts) fills
 *    that day; name or muscle matching never moves it. A second workout of a day already filled fills nothing.
 * 2. A workout matched by name to variants it doesn't tell apart fills the first of them (plan order) not filled yet.
 * 3. Any other workout fills one of the days it mainly trained (the split rule with the plan's days as the split):
 *    the one whose main lift it led with when that day is free, else the first free one in plan order (days with the
 *    same body parts as the day it mostly trained first).
 *
 * A workout of this week's merged day (`merges`) fills each of its days. Within each step, oldest first. Every template of a filled plan day (same plan and day index) is filled with it.
 * Returns each filled template's workout. `workouts`: the week's (the caller picks the window).
 */
export function assignPlanWeek<W extends PlanWeekSlotWorkout>(days: readonly PlanWeekSlotDay[], workouts: readonly W[], merges: readonly PlanWeekMerge[] = []): Map<string, W> {
  const filled = new Map<string, W>();
  const byId = new Map(days.map((d) => [d.routineId, d]));
  const order = new Map(days.map((d, i) => [d.routineId, i]));
  const free = (id: string): boolean => byId.has(id) && !filled.has(id);
  const take = (id: string, w: W): void => {
    const d = byId.get(id);
    if (d === undefined) return;
    for (const x of sameDayIds(days, d)) filled.set(x, w);
  };
  const oldestFirst = [...workouts].sort((a, b) => toMs(a.startedAtUtc) - toMs(b.startedAtUtc) || (a.sessionId < b.sessionId ? -1 : 1));
  const flexible: W[] = [];
  const byMuscle: W[] = [];
  for (const w of oldestFirst) {
    if ((w.variants?.length ?? 0) > 0) {
      flexible.push(w);
      continue;
    }
    // This week's merged day (Chest + Shoulders → Push): a workout of it does each of its days.
    const merge = merges.find((m) => m.routineId === w.routineId);
    if (merge !== undefined) {
      if (merge.dayIds.every(free)) for (const id of merge.dayIds) take(id, w);
      continue;
    }
    const own = ownPlanDay(days, w);
    if (own === undefined) {
      byMuscle.push(w);
      continue;
    }
    if (free(own.routineId)) take(own.routineId, w);
  }
  for (const w of flexible) {
    const id = (w.variants ?? []).find(free);
    if (id !== undefined) take(id, w);
  }
  const split = planSplit(days);
  if (split === null) return filled;
  for (const w of byMuscle) {
    const trained = splitDaysTrained(split, w.groups);
    if (trained.length === 0) continue;
    const main = byId.get(matchSplitDay(split, w.groups)?.id ?? '');
    const same = (d: PlanWeekSlotDay | undefined): boolean => main !== undefined && d !== undefined && d.bodyParts.length === main.bodyParts.length && d.bodyParts.every((x) => main.bodyParts.includes(x));
    const rank = (id: string): number => (same(byId.get(id)) ? 0 : 1000) + (order.get(id) ?? 0);
    const cands = [...trained].sort((a, b) => rank(a) - rank(b)).filter(free);
    const lead = w.leadExerciseId ?? null;
    const id = cands.find((x) => lead !== null && byId.get(x)?.mainLiftExerciseId === lead) ?? cands[0];
    if (id !== undefined) take(id, w);
  }
  return filled;
}

const newestFirst = <W extends Pick<PlanDueWorkout, 'sessionId' | 'startedAtUtc'>>(ws: readonly W[]): W[] => [...ws].sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc) || (a.sessionId < b.sessionId ? 1 : -1));

export interface PlanDuePick<D extends PlanDueDay = PlanDueDay> {
  day: D;
  /** Pinned with `Make next`. */
  pinned: boolean;
  /** When its body parts were last trained (any workout); null: not in `workouts`. */
  lastTrainedUtc: string | null;
}

/**
 * The pin, while its day is still a plan day and no workout since the pin
 * did that day (`planDaysDoneBy`, the ✓ rule: review plan-adapt S2).
 * `workouts` must hold every finished workout since `pin.atUtc` (the callers
 * read from the pin, not a fixed window: review S3).
 */
export function activePin(pin: PlanPin | null | undefined, days: readonly PlanDueDay[], workouts: readonly PlanDueWorkout[]): PlanPin | null {
  if (pin == null || !days.some((d) => d.routineId === pin.routineId)) return null;
  const since = toMs(pin.atUtc);
  const done = workouts.some((w) => toMs(w.startedAtUtc) >= since && planDaysDoneBy(days, w).includes(pin.routineId));
  return done ? null : pin;
}

/**
 * The plan days in the order they are due (Ben, 20 Oct). The pinned day
 * first (`Make next`, until done). Then trained least recently first,
 * counting every workout in `workouts` by the muscles done (an off-plan
 * workout for every day it trained; a plan workout for its own day and the
 * day it mainly trained, so overlapping days still take turns); never the
 * day(s) the newest workout trained unless that leaves none. Ties: the day
 * whose own workout is oldest (so `Upper A` and `Upper B` alternate), then
 * plan order (day 1 before any is done). The caller starts the first it can.
 */
export function planDaysByDue<D extends PlanDueDay>(days: readonly D[], workouts: readonly PlanDueWorkout[], pin?: PlanPin | null): PlanDuePick<D>[] {
  if (days.length === 0) return [];
  const last = new Map<string, number>();
  const lastOwn = new Map<string, number>();
  let justDone: string[] | null = null;
  for (const w of newestFirst(workouts)) {
    const trained = planDaysTrained(days, w);
    const credited = planDaysCredited(days, w);
    const ms = toMs(w.startedAtUtc);
    if (trained.length === 0 && credited.length === 0) continue;
    // The newest workout's days are left out of the pool: never the day(s) just trained.
    justDone ??= credited;
    for (const id of credited) if (!last.has(id)) last.set(id, ms);
  }
  // Each day's newest own workout, oldest first: a plan workout's own day. (Ben, 28 Oct) An off-plan workout that
  // trained variants of one day (Legs, Legs B: the same split word, else the same body parts) counts as one of them, so they still alternate (Legs done
  // off-plan Mon → Legs B next, not Legs again): the one whose main lift it led with, else the one done longest ago
  // (plan order on a tie). Days with their own body parts are left as they were.
  const idx = new Map(days.map((d, i) => [d.routineId, i]));
  const partsKey = (d: PlanDueDay): string => splitNameOf(d.name)?.base ?? [...d.bodyParts].sort().join('+');
  for (const w of [...newestFirst(workouts)].reverse()) {
    const ms = toMs(w.startedAtUtc);
    const own = ownPlanDay(days, w);
    if (own !== undefined) {
      for (const id of sameDayIds(days, own)) lastOwn.set(id, ms);
      continue;
    }
    const cands = planDaysTrained(days, w).flatMap((id) => days.filter((d) => d.routineId === id && d.bodyParts.length > 0));
    const groups = new Map<string, D[]>();
    for (const d of cands) groups.set(partsKey(d), [...(groups.get(partsKey(d)) ?? []), d]);
    for (const twins of groups.values()) {
      if (new Set(twins.map((d) => d.planKey == null ? d.routineId : `${d.planKey.planId}:${String(d.planKey.dayIndex)}`)).size < 2) continue;
      const lead = w.leadExerciseId ?? null;
      const day = twins.find((d) => lead !== null && d.mainLiftExerciseId === lead) ?? [...twins].sort((a, b) => (lastOwn.get(a.routineId) ?? Number.NEGATIVE_INFINITY) - (lastOwn.get(b.routineId) ?? Number.NEGATIVE_INFINITY) || (idx.get(a.routineId) ?? 0) - (idx.get(b.routineId) ?? 0))[0];
      if (day !== undefined) for (const id of sameDayIds(days, day)) lastOwn.set(id, ms);
    }
  }
  const done = justDone ?? [];
  const others = days.filter((d) => !done.includes(d.routineId));
  const pool = others.length > 0 ? others : [...days];
  const at = (m: Map<string, number>, id: string): number => m.get(id) ?? Number.NEGATIVE_INFINITY;
  const order = new Map(days.map((d, i) => [d.routineId, i]));
  const sorted = [...pool].sort((a, b) => at(last, a.routineId) - at(last, b.routineId) || at(lastOwn, a.routineId) - at(lastOwn, b.routineId) || (order.get(a.routineId) ?? 0) - (order.get(b.routineId) ?? 0));
  const pinned = activePin(pin, days, workouts);
  const pinDay = pinned === null ? undefined : days.find((d) => d.routineId === pinned.routineId);
  const pick = (d: D, isPinned: boolean): PlanDuePick<D> => {
    const ms = last.get(d.routineId);
    return { day: d, pinned: isPinned, lastTrainedUtc: ms === undefined ? null : toIso(ms) };
  };
  const rest = sorted.filter((d) => d.routineId !== pinDay?.routineId).map((d) => pick(d, false));
  return pinDay === undefined ? rest : [pick(pinDay, true), ...rest];
}

/** A plan day for `planDaysAhead`: also the working sets per muscle group a workout of it would do. */
export interface PlanAheadDay extends PlanDueDay {
  /** Its planned working sets per muscle group (`planDayGroups`). */
  plannedGroups: ReadonlyMap<MuscleGroup, number>;
}

/** A plan day's planned working sets per muscle group (each exercise's first primary muscle): what doing it would count as. */
export function planDayGroups(routine: Pick<Routine, 'exercises'>, exerciseOf: (id: string) => Pick<Exercise, 'primaryMuscles'> | null): Map<MuscleGroup, number> {
  return workoutMuscleGroups(routine.exercises.map((e) => ({ primaryMuscles: exerciseOf(e.exerciseId)?.primaryMuscles ?? [], workingSets: e.setTemplates.filter((t) => t.setType !== 'warmup').length })));
}

const DAY_MS = 86_400_000;

/**
 * Up next's plan day as the resolver picks it (`planDaysByDue`): a pinned day
 * (`Make next`) first, then, with a long or hard run near (`near`), leg days
 * after the others; the first `canStart` allows. Undefined: none can start.
 */
export function planDayPick<D extends PlanDueDay>(days: readonly D[], workouts: readonly PlanDueWorkout[], pin: PlanPin | null, near: LegRunNear | null, canStart: (d: D) => boolean = () => true): PlanDuePick<D> | undefined {
  const due = planDaysByDue(days, workouts, pin);
  const ordered = [...due.filter((p) => p.pinned), ...avoidLegDays(due.filter((p) => !p.pinned), (p) => p.day.bodyParts, near).order];
  return ordered.find((p) => canStart(p.day));
}

/**
 * Up next's plan days after `firstRoutineId` (Up next now), a prediction
 * (morning reminder, Ben 20 Oct): each predicted day is assumed done as
 * planned, one a day from `fromMs`, and the next is `planDaysByDue` on the
 * workouts so far plus those (a pin is consumed once its day is done), the
 * first `canStart` allows. `workouts`: the window Up next reads now; one older
 * than `windowDays` before a predicted day drops out, as it would by then.
 * `pin`: the live pin (`activePin` on every workout since it). Up to `count`
 * days after the first; fewer when none can start; empty when `firstRoutineId`
 * isn't a plan day.
 *
 * `nearOn(i)` (Ben, 20 Oct): the long or hard run near the date predicted day
 * `i` is reminded on (`legRunNear`, planned or done), if any; leg days then go
 * after the others for that day, as Up next does (a pinned day stays first).
 */
export function planDaysAhead<D extends PlanAheadDay>(input: {
  days: readonly D[];
  workouts: readonly PlanDueWorkout[];
  pin: PlanPin | null;
  firstRoutineId: string;
  count: number;
  fromMs: number;
  windowDays: number;
  canStart?: (d: D) => boolean;
  nearOn?: (i: number) => LegRunNear | null;
}): D[] {
  const first = input.days.find((d) => d.routineId === input.firstRoutineId);
  if (first === undefined) return [];
  const canStart = input.canStart ?? (() => true);
  const done: PlanDueWorkout[] = [];
  const out: D[] = [];
  let last: D = first;
  for (let i = 0; i < input.count; i += 1) {
    const atMs = input.fromMs + i * DAY_MS;
    done.push({ sessionId: `ahead:${String(i)}`, routineId: last.routineId, startedAtUtc: toIso(atMs), groups: last.plannedGroups });
    const windowFrom = atMs + DAY_MS - input.windowDays * DAY_MS;
    const ws = [...input.workouts.filter((w) => toMs(w.startedAtUtc) >= windowFrom), ...done];
    const pick = planDayPick(input.days, ws, input.pin, input.nearOn?.(i) ?? null, canStart);
    if (pick === undefined) break;
    out.push(pick.day);
    last = pick.day;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pause

/** The furthest `until` a pause may name. */
export const PLAN_PAUSE_MAX_DAYS = 366;

/** When a pause ends: Ben's Resume (or the auto-resume write), else the start of its `until` date; +∞ while open-ended. */
export function pauseEndMs(p: Pick<PlanPause, 'untilDate' | 'endedAtUtc'>, tz: string): number {
  const ended = p.endedAtUtc === null ? Number.POSITIVE_INFINITY : toMs(p.endedAtUtc);
  const until = p.untilDate === null ? Number.POSITIVE_INFINITY : localMidnightUtcMs(p.untilDate, tz);
  return Math.min(ended, until);
}

/** The pause running at `nowMs`, if any (one past its `until` date isn't, even before the auto-resume write). */
export function activePause(plan: Pick<PlanDraft, 'status' | 'pauses'> | null, nowMs: number, tz: string): PlanPause | null {
  if (plan === null || plan.status !== 'applied') return null;
  const p = plan.pauses?.at(-1);
  if (p === undefined) return null;
  return toMs(p.fromUtc) <= nowMs && nowMs < pauseEndMs(p, tz) ? p : null;
}

/** The pause whose `until` date has come but which no write has ended yet: the first open after it resumes the plan. */
export function autoResumeDue(plan: Pick<PlanDraft, 'status' | 'pauses'> | null, nowMs: number, tz: string): PlanPause | null {
  if (plan === null || plan.status !== 'applied') return null;
  const p = plan.pauses?.at(-1);
  if (p === undefined || p.endedAtUtc !== null || p.untilDate === null) return null;
  return nowMs >= localMidnightUtcMs(p.untilDate, tz) ? p : null;
}

/**
 * The local dates in [`from`, `to`) (`YYYY-MM-DD`) a plan was (or will be,
 * for a pause still running) paused: from the pause's own date up to the date
 * it ended (Resume) or its `until` date, whichever is first. A pause and
 * Resume on the same day pause no date. `capUtc`: when the plan stopped being
 * in use (`planInUseUntilUtc`); no pause runs past it, so a plan ended or
 * replaced while paused never pauses the weeks after (review plan-adapt B1).
 */
export function pausedDates(pauses: readonly PlanPause[] | undefined, from: string, to: string, tz: string, capUtc: string | null = null): Set<string> {
  const out = new Set<string>();
  const cap = capUtc === null ? null : localDateOf(toMs(capUtc), tz);
  for (const p of pauses ?? []) {
    const start = localDateOf(toMs(p.fromUtc), tz);
    const ends = [p.untilDate, p.endedAtUtc === null ? null : localDateOf(toMs(p.endedAtUtc), tz), cap].filter((x): x is string => x !== null).sort();
    const end = ends[0] ?? null;
    let d = start < from ? from : start;
    for (let i = 0; i < 400 && d < to && (end === null || d < end); i += 1, d = addDays(d, 1)) out.add(d);
  }
  return out;
}

/** When a plan stopped being in use (End, or a newer plan's Apply); null while it is (or never was) in use. */
export function planInUseUntilUtc(plan: Pick<PlanDraft, 'status' | 'ended' | 'supersededBy'>): string | null {
  if (plan.status === 'ended') return plan.ended?.atUtc ?? null;
  if (plan.status === 'superseded') return plan.supersededBy?.atUtc ?? null;
  return null;
}

/**
 * The pauses once the plan stops being in use at `atUtc` (End, or a newer
 * plan's Apply): a running pause is closed then (`endedBy: 'end'`), one past
 * its `until` date at that date (as the auto-resume would have). Unchanged
 * when none is open (review plan-adapt B1).
 */
export function closePausesAt(pauses: readonly PlanPause[], atUtc: string, tz: string): PlanPause[] {
  const last = pauses.at(-1);
  if (last === undefined || last.endedAtUtc !== null) return [...pauses];
  const atMs = toMs(atUtc);
  const end = pauseEndMs(last, tz);
  const closed: PlanPause = atMs < end ? { ...last, endedAtUtc: atUtc, endedBy: 'end' } : { ...last, endedAtUtc: toIso(end), endedBy: 'auto' };
  return [...pauses.slice(0, -1), closed];
}

/** The pauses as before `closePausesAt(…, atUtc)`: the pause it closed at `atUtc` is running again (Undo of End / of the Apply that replaced it). */
export function reopenPausesClosedAt(pauses: readonly PlanPause[], atUtc: string): PlanPause[] {
  const last = pauses.at(-1);
  if (last === undefined || last.endedBy !== 'end' || last.endedAtUtc !== atUtc) return [...pauses];
  return [...pauses.slice(0, -1), { ...last, endedAtUtc: null, endedBy: null }];
}

/** A picked `until` date is after today (local) and within a year; null (until Resume) always is. */
export function validPauseUntil(untilDate: string | null, nowMs: number, tz: string): boolean {
  if (untilDate === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) return false;
  const today = localDateOf(nowMs, tz);
  return untilDate > today && untilDate <= addDays(today, PLAN_PAUSE_MAX_DAYS);
}

// ---------------------------------------------------------------------------
// Writes: Make next, pause, resume, and their Undo

export type PlanControlChange =
  | { kind: 'write'; next: PlanDraft; expectedVersion: number }
  | { kind: 'duplicate'; current: PlanDraft }
  /** The plan isn't as the screen read it, or isn't in use: nothing changes (rule 5). */
  | { kind: 'stale'; current: PlanDraft }
  | { kind: 'invalid'; current: PlanDraft; reason: 'not_a_day' | 'bad_date' | 'not_paused' | 'already_paused' };

interface ControlInput {
  expectedVersion: number;
  opId: string;
  at: ZonedTimestamp;
}

function guard(current: PlanDraft, input: ControlInput): PlanControlChange | null {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'applied' || current.applied === null) return { kind: 'stale', current };
  return null;
}

function control(current: PlanDraft, input: ControlInput, kind: PlanControlUndo['kind'], patch: { pin: PlanPin | null; pauses: PlanPause[] }): PlanControlChange {
  const version = current.version + 1;
  const lastControl: PlanControlUndo = { opId: input.opId, kind, versionAfter: version, before: { pin: current.pin ?? null, pauses: [...(current.pauses ?? [])] } };
  const next: PlanDraft = { ...current, pin: patch.pin, pauses: patch.pauses.slice(-60), lastControl, opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps), version, updatedAtUtc: input.at.utc };
  return { kind: 'write', next, expectedVersion: current.version };
}

/**
 * `Make next` on a plan day (null: unpin): Up next starts it until it is
 * done, another day is pinned or Ben unpins it. `days`: the plan's live
 * days now. Versioned, idempotent; Undo with `undoPlanControl`.
 */
export function pinPlanDay(current: PlanDraft, input: ControlInput & { routineId: string | null; days: readonly Pick<Routine, 'id'>[] }): PlanControlChange {
  const g = guard(current, input);
  if (g !== null) return g;
  if (input.routineId !== null && !input.days.some((d) => d.id === input.routineId)) return { kind: 'invalid', current, reason: 'not_a_day' };
  const pin: PlanPin | null = input.routineId === null ? null : { routineId: input.routineId, opId: input.opId, atUtc: input.at.utc };
  return control(current, input, input.routineId === null ? 'unpin' : 'pin', { pin, pauses: [...(current.pauses ?? [])] });
}

/**
 * `Pause plan` (Ben's tap, or the coach's `pause_plan` when he asks):
 * paused from now until he resumes, or until `untilDate` starts (local).
 * Refused while a pause runs (change it by resuming first) or with an
 * `until` that isn't after today.
 */
export function pausePlan(current: PlanDraft, input: ControlInput & { untilDate: string | null; tz: string }): PlanControlChange {
  const g = guard(current, input);
  if (g !== null) return g;
  const nowMs = toMs(input.at.utc);
  if (!validPauseUntil(input.untilDate, nowMs, input.tz)) return { kind: 'invalid', current, reason: 'bad_date' };
  const pauses = [...(current.pauses ?? [])];
  const last = pauses.at(-1);
  // A pause past its date that the auto-resume write hasn't closed yet: closed now, at its date.
  if (last !== undefined && last.endedAtUtc === null) {
    if (activePause(current, nowMs, input.tz) !== null) return { kind: 'invalid', current, reason: 'already_paused' };
    pauses[pauses.length - 1] = { ...last, endedAtUtc: toIso(Math.min(nowMs, pauseEndMs(last, input.tz))), endedBy: 'auto' };
  }
  pauses.push({ opId: input.opId, fromUtc: input.at.utc, untilDate: input.untilDate, endedAtUtc: null, endedBy: null });
  return control(current, input, 'pause', { pin: current.pin ?? null, pauses });
}

/**
 * `Resume` (or `auto`: the first open on or after the `until` date, ended
 * at that date's start). Refused with no pause running.
 */
export function resumePlan(current: PlanDraft, input: ControlInput & { tz: string; auto?: boolean }): PlanControlChange {
  const g = guard(current, input);
  if (g !== null) return g;
  const nowMs = toMs(input.at.utc);
  const pauses = [...(current.pauses ?? [])];
  const last = pauses.at(-1);
  if (last === undefined || last.endedAtUtc !== null) return { kind: 'invalid', current, reason: 'not_paused' };
  if (input.auto === true) {
    if (autoResumeDue(current, nowMs, input.tz) === null) return { kind: 'invalid', current, reason: 'not_paused' };
    pauses[pauses.length - 1] = { ...last, endedAtUtc: toIso(pauseEndMs(last, input.tz)), endedBy: 'auto' };
    // Not Ben's write: an Undo offered before it is out of date now (rule 5).
    const next: PlanDraft = {
      ...current,
      pauses,
      lastControl: null,
      opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps),
      version: current.version + 1,
      updatedAtUtc: input.at.utc,
    };
    return { kind: 'write', next, expectedVersion: current.version };
  }
  if (activePause(current, nowMs, input.tz) === null) return { kind: 'invalid', current, reason: 'not_paused' };
  pauses[pauses.length - 1] = { ...last, endedAtUtc: input.at.utc, endedBy: 'ben' };
  return control(current, input, 'resume', { pin: current.pin ?? null, pauses });
}

/**
 * Undo of the last `Make next`, pause or resume (`targetOpId`): the pin and
 * pauses before it, only while the plan is still at the version that write
 * left (anything since, stale: nothing changes). Its own op ID; a second
 * Undo of the same write is stale.
 */
export function undoPlanControl(current: PlanDraft, input: ControlInput & { targetOpId: string }): PlanControlChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const last = current.lastControl ?? null;
  if (current.status !== 'applied' || last === null || last.opId !== input.targetOpId || current.version !== input.expectedVersion || last.versionAfter !== current.version) return { kind: 'stale', current };
  const next: PlanDraft = {
    ...current,
    pin: last.before.pin,
    pauses: [...last.before.pauses],
    lastControl: null,
    opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps),
    version: current.version + 1,
    updatedAtUtc: input.at.utc,
  };
  return { kind: 'write', next, expectedVersion: current.version };
}

/** Whole days paused between two instants' local dates, for a per-week count. */
export function pausedDayCount(pauses: readonly PlanPause[] | undefined, from: string, to: string, tz: string): number {
  return pausedDates(pauses, from, to, tz).size;
}

/** An aim of `n` a week with `paused` of its 7 days paused: `n × (7 − paused) / 7`, rounded. */
export function aimWithPause(n: number, paused: number): number {
  const p = Math.min(7, Math.max(0, paused));
  return Math.round((n * (7 - p)) / 7);
}
