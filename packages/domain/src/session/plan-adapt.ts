import { isSplitBodyPart, matchSplitDay, workoutMuscleGroups } from '../training-profile';
import { addDays, localDateOf, localMidnightUtcMs } from '../calendar';
import { toIso, toMs } from '../time';
import { splitDaysTrained } from './split-up-next';
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
}

/** A finished workout as the adaptive Up next reads it. */
export interface PlanDueWorkout {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  /** Working sets done per muscle group (`workoutGroupsOf`). */
  groups: ReadonlyMap<MuscleGroup, number>;
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

/** The plan day this workout was started from (or saved as), if any. */
export function ownPlanDay<D extends Pick<PlanDueDay, 'routineId' | 'createdFromSessionId'>>(days: readonly D[], w: Pick<PlanDueWorkout, 'sessionId' | 'routineId'>): D | undefined {
  return days.find((d) => d.routineId === w.routineId || (d.createdFromSessionId != null && d.createdFromSessionId === w.sessionId));
}

/**
 * The plan days a workout trained, by the split rule with the plan's days as
 * the split (`splitDaysTrained`: the day that got most of its sets, and any
 * with a third of them), plus its own day for a plan workout.
 */
export function planDaysTrained(days: readonly PlanDueDay[], w: PlanDueWorkout): string[] {
  const own = ownPlanDay(days, w)?.routineId;
  const split = planSplit(days);
  const byMuscle = split === null ? [] : splitDaysTrained(split, w.groups);
  return [...new Set([...(own === undefined ? [] : [own]), ...byMuscle])];
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
  return [...new Set([own.routineId, ...twins, ...mainId])];
}

/**
 * The plan days a workout counts as done for (`Your plan` ✓): a plan
 * workout counts for its own day only; any other workout for the days it
 * mainly trained (the split rule's threshold).
 */
export function planDaysDoneBy(days: readonly PlanDueDay[], w: PlanDueWorkout): string[] {
  const own = ownPlanDay(days, w);
  if (own !== undefined) return [own.routineId];
  const split = planSplit(days);
  return split === null ? [] : splitDaysTrained(split, w.groups);
}

const newestFirst = <W extends Pick<PlanDueWorkout, 'sessionId' | 'startedAtUtc'>>(ws: readonly W[]): W[] => [...ws].sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc) || (a.sessionId < b.sessionId ? 1 : -1));

export interface PlanDuePick<D extends PlanDueDay = PlanDueDay> {
  day: D;
  /** Pinned with `Make next`. */
  pinned: boolean;
  /** When its body parts were last trained (any workout); null: not in `workouts`. */
  lastTrainedUtc: string | null;
}

/** The pin, while its day is still a plan day and no workout since the pin trained it. */
export function activePin(pin: PlanPin | null | undefined, days: readonly PlanDueDay[], workouts: readonly PlanDueWorkout[]): PlanPin | null {
  if (pin == null || !days.some((d) => d.routineId === pin.routineId)) return null;
  const since = toMs(pin.atUtc);
  const done = workouts.some((w) => toMs(w.startedAtUtc) >= since && planDaysTrained(days, w).includes(pin.routineId));
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
    const own = ownPlanDay(days, w);
    if (own !== undefined && !lastOwn.has(own.routineId)) lastOwn.set(own.routineId, ms);
    if (trained.length === 0 && credited.length === 0) continue;
    // The newest workout's days are left out of the pool: never the day(s) just trained.
    justDone ??= credited;
    for (const id of credited) if (!last.has(id)) last.set(id, ms);
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
 * Resume on the same day pause no date.
 */
export function pausedDates(pauses: readonly PlanPause[] | undefined, from: string, to: string, tz: string): Set<string> {
  const out = new Set<string>();
  for (const p of pauses ?? []) {
    const start = localDateOf(toMs(p.fromUtc), tz);
    const ends = [p.untilDate, p.endedAtUtc === null ? null : localDateOf(toMs(p.endedAtUtc), tz)].filter((x): x is string => x !== null).sort();
    const end = ends[0] ?? null;
    let d = start < from ? from : start;
    for (let i = 0; i < 400 && d < to && (end === null || d < end); i += 1, d = addDays(d, 1)) out.add(d);
  }
  return out;
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
