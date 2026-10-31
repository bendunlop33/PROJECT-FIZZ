import { supersetLabels } from '../superset-labels';
import type { Exercise, Load, PlanDraftStatus, Routine, SessionAggregate, SessionExercise, TrainingGoal, WorkoutSet } from '@fizz/schemas';
import { localDateOf, weekdayOf } from '../calendar';
import { paceText } from '../cardio';
import { cardioValuesText, dayMonthText, formatDistance, formatDuration, formatNumber, loadText, localDateText, repRangeText } from '../display';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { toMs } from '../time';
import { dayOf, exerciseTargetHistory, planDaysDoneThisWeek, plannedVsDone, planWeekExpectedNow, planWeekOf, planWeekStartMs, type PlanWeekDay, type PlanWeekWorkout } from './plan-tracker';

/**
 * Library › Workouts › Your plan (Ben, 19 Oct: "can i see it visually?",
 * "where is the overview of what the goal is"). Pure view models from the
 * applied plan, Ben's training details and his logged workouts: no scores,
 * no projections, nothing called missed (D19). Weeks are Monday–Sunday in
 * Ben's time zone, from Apply on (as the Progress consistency card counts).
 *
 * - `planOverview`: the block: since when, the goal line, each day with
 *   its state (done this week, next per Up next, to do) and when, days this
 *   week, planned sets done this week.
 * - `planDayDetail`: one day: what Start would plan (sets × reps · load)
 *   and what was done last time, with targets hit.
 */

// ---------------------------------------------------------------------------
// This week

/**
 * Planned sets done this week across the plan's workouts (plan vs done):
 * logged planned sets of planned sets, a set Ben added never counting
 * (review plans-19oct S1). `{ planned: 0 }` with none yet.
 */
export function plannedSetsThisWeek(input: { sessions: readonly Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>[]; days: readonly PlanWeekDay[]; appliedAtUtc: string; nowMs: number; tz: string }): { planned: number; done: number } {
  const from = planWeekStartMs(input);
  let planned = 0;
  let done = 0;
  const seen = new Set<string>();
  for (const a of input.sessions) {
    const ms = toMs(a.session.startedAt.utc);
    if (seen.has(a.session.id) || ms < from || ms > input.nowMs) continue;
    if (dayOf(input.days, { sessionId: a.session.id, routineId: a.session.routineId ?? null }) === undefined) continue;
    seen.add(a.session.id);
    const pvd = plannedVsDone(a);
    if (pvd === null) continue;
    planned += pvd.plannedSets;
    done += pvd.doneSets;
  }
  return { planned, done };
}

// ---------------------------------------------------------------------------
// The Your plan block

const GOAL_WORD: Readonly<Record<TrainingGoal, string>> = { strength: 'Strength', muscle: 'Muscle', both: 'Both' };
const WEEKDAY_WORD = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as const;
const WEEKDAY_SAID = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as const;

export const PLAN_OVERVIEW_COPY = {
  label: 'Your plan',
  edit: 'Edit',
  setGoal: 'Set goal',
  next: 'Next',
  daysThisWeek: 'Days this week',
  setsDone: 'Planned sets done',
  askCoach: 'Ask coach to change',
  endPlan: 'End plan',
  endConfirm: 'End this plan?',
  cancel: 'Cancel',
  ended: 'Plan ended',
  undo: 'Undo',
  resumed: 'Plan back in use',
  otherWorkouts: 'Other workouts',
  coachDraft: 'Change my plan: ',
  /** (Ben, 20 Oct) Pause, e.g. on holiday. */
  pause: 'Pause plan',
  pauseUntil: 'Until',
  pauseNoDate: 'Until I resume',
  resume: 'Resume',
  paused: 'Paused',
  pausedUntil: (date: string) => `Paused · until ${date}`,
  pausedToast: 'Plan paused',
  resumedToast: 'Plan resumed',
  /** End plan put back the workouts `Replace my workouts` took out, except these (`Why?`). */
  why: 'Why?',
  notRestored: (n: number, names: readonly string[]) => `${String(n)} ${n === 1 ? 'workout' : 'workouts'} not restored: ${names.join(', ')}`,
} as const;

export type PlanDayState = 'done' | 'next' | 'todo';

export interface PlanOverviewDay {
  routineId: string;
  /** 1-based, in plan order. */
  n: number;
  name: string;
  /** The dot: ✓ done this week, else a ring with its number when it's Up next, else a plain ring. */
  state: PlanDayState;
  /** Up next (the `Next` tag), done this week or not. */
  next: boolean;
  /** `Sat` (done this week), `Last 12 Oct` (done before), or null (never). */
  when: string | null;
  /** (27 Oct) The local date it was done this week (`YYYY-MM-DD`); null: not this week. */
  doneOn: string | null;
  /** (27 Oct) The plan day it is (a builder plan's day index); null: not known. */
  dayIndex: number | null;
  accessibilityLabel: string;
}

export interface PlanOverview {
  planId: string;
  /** The plan's stored version: what `End plan` must find (rule 5). */
  planVersion: number;
  name: string;
  /** `Since 13 Oct` (the Apply's date). */
  since: string;
  /**
   * `Goal: Strength · 4 days a week · 60 min` with `Edit`; with no goal set,
   * the parts that are set (or nothing) with `Set goal`. Both open Profile ›
   * Training details.
   */
  goal: { text: string | null; action: typeof PLAN_OVERVIEW_COPY.edit | typeof PLAN_OVERVIEW_COPY.setGoal };
  days: PlanOverviewDay[];
  /** `3 of 4`. */
  daysThisWeek: { done: number; of: number; text: string };
  /** `92%`; null with no planned sets logged this week yet (the tile hides). */
  setsDone: { pct: number; text: string } | null;
  /** (Ben, 20 Oct) `Paused · until 3 Nov` / `Paused` while paused (no `Next` then); null in use. */
  paused: { text: string; untilDate: string | null } | null;
  /** (Ben, 20 Oct) This week's activities, one small line each: `Run · Sat · long`. Never gym days. */
  activities: string[];
  /** (Ben, 31 Oct) Each line's activity ID, in the same order (a tap opens its sheet); null: none to open. */
  activityIds: (string | null)[];
  /** (Ben, 20 Oct) This week's change Ben applied (`This week: Push (Chest + Shoulders)`), with its Undo; null: none. */
  weekChange: { text: string; weekPlanId: string; version: number } | null;
}

export interface PlanOverviewInput {
  /** The plan Ben is using; anything but `applied` has no block. */
  plan: { id: string; name: string; status: PlanDraftStatus; version: number; appliedAtUtc: string } | null;
  /** The plan's live days in plan order (`dayIndex`: the plan day each is, when known). */
  days: readonly (PlanWeekDay & { name: string; dayIndex?: number | null | undefined })[];
  /** Finished workouts (any order). */
  workouts: readonly (PlanWeekWorkout & { tz: string })[];
  /** Up next's workout when it is one of the plan's days. */
  nextRoutineId: string | null;
  /** Profile › Training details; null: none saved. */
  training: { goal?: TrainingGoal | undefined; daysPerWeek?: number | undefined; sessionMinutes?: number | undefined } | null;
  /** `plannedSetsThisWeek`. */
  sets: { planned: number; done: number };
  /** (20 Oct) The pause running now (`activePause`); absent or null: in use. */
  paused?: { untilDate: string | null } | null;
  /** (20 Oct) Days of this week the plan is paused (`pausedInWeek`): left out of `Days this week`. */
  pausedDaysThisWeek?: number;
  /** (Ben, 29 Oct) Plan days skipped this week (`Skip this week`, not done): out of this week's count. */
  skippedThisWeek?: number;
  /** (Ben, 20 Oct) `weekActivityLine` for each activity this week. */
  activities?: readonly string[];
  /** Each activity's ID, in the same order as `activities`. */
  activityIds?: readonly (string | null)[];
  /** (Ben, 20 Oct) This week's change in use: its days merged or skipped come off `Days this week` (`weekDaysRemoved`). */
  weekChange?: { text: string; weekPlanId: string; version: number; daysRemoved: number; merged?: readonly (readonly string[])[]; /** (28 Oct) Each merge's workout, in `merged` order. */ mergedRoutineIds?: readonly (string | null)[] } | null;
  /** (Ben, 28 Oct) Set days plans: each day's weekday this week (a plan started mid-week expects only the days left). */
  weekdays?: ReadonlyMap<string, number> | null;
  nowMs: number;
  tz: string;
}

export function goalLine(training: PlanOverviewInput['training']): PlanOverview['goal'] {
  const parts: string[] = [];
  if (training?.daysPerWeek !== undefined) parts.push(`${String(training.daysPerWeek)} ${training.daysPerWeek === 1 ? 'day' : 'days'} a week`);
  if (training?.sessionMinutes !== undefined) parts.push(`${String(training.sessionMinutes)} min`);
  const goal = training?.goal;
  if (goal === undefined) return { text: parts.length === 0 ? null : parts.join(' · '), action: PLAN_OVERVIEW_COPY.setGoal };
  return { text: [`Goal: ${GOAL_WORD[goal]}`, ...parts].join(' · '), action: PLAN_OVERVIEW_COPY.edit };
}

/** The Your plan block; null when no plan is in use (ended, superseded, undone) or it has no live days. */
export function planOverview(input: PlanOverviewInput): PlanOverview | null {
  const plan = input.plan;
  if (plan === null || plan.status !== 'applied' || input.days.length === 0) return null;
  const wc = input.weekChange ?? null;
  const merges = (wc?.merged ?? []).flatMap((dayIds, i) => {
    const routineId = wc?.mergedRoutineIds?.[i] ?? null;
    return routineId === null ? [] : [{ routineId, dayIds }];
  });
  const doneThisWeek = planDaysDoneThisWeek({ days: input.days, appliedAtUtc: plan.appliedAtUtc, workouts: input.workouts, nowMs: input.nowMs, tz: input.tz, merges });
  const newest = new Map<string, PlanWeekWorkout & { tz: string }>();
  for (const w of input.workouts) {
    if (toMs(w.startedAtUtc) > input.nowMs) continue;
    const d = dayOf(input.days, w);
    if (d === undefined) continue;
    const prev = newest.get(d.routineId);
    if (prev === undefined || toMs(prev.startedAtUtc) < toMs(w.startedAtUtc)) newest.set(d.routineId, w);
  }
  const paused = input.paused ?? null;
  const nextId = paused === null && input.days.some((d) => d.routineId === input.nextRoutineId) ? input.nextRoutineId : null;
  const days = input.days.map((d, i): PlanOverviewDay => {
    const thisWeek = doneThisWeek.get(d.routineId);
    const last = newest.get(d.routineId);
    const next = d.routineId === nextId;
    const state: PlanDayState = thisWeek !== undefined ? 'done' : next ? 'next' : 'todo';
    const day = thisWeek === undefined ? null : weekdayOf(toMs(thisWeek), input.tz);
    const lastDate = last === undefined ? null : dayMonthText(last.startedAtUtc, input.tz);
    const when = day !== null ? WEEKDAY_WORD[day] : lastDate !== null ? `Last ${lastDate}` : null;
    const said = [
      d.name,
      `day ${String(i + 1)} of ${String(input.days.length)}`,
      ...(next ? ['next'] : []),
      day !== null ? `done ${WEEKDAY_SAID[day]}` : lastDate !== null ? `last done ${lastDate}` : 'not done yet',
    ];
    return { routineId: d.routineId, n: i + 1, name: d.name, state, next, when, doneOn: thisWeek === undefined ? null : localDateOf(toMs(thisWeek), input.tz), dayIndex: d.dayIndex ?? null, accessibilityLabel: said.join(', ') };
  });
  const change = input.weekChange ?? null;
  // This week's merged day counts once (Chest + Shoulders done by one Push workout is one day of this week's).
  const doubled = (change?.merged ?? []).filter((ids) => ids.length > 1 && ids.every((id) => doneThisWeek.has(id))).reduce((n, ids) => n + ids.length - 1, 0);
  const done = doneThisWeek.size - doubled;
  // (Ben, 28 Oct) A plan started partway through this week expects only the days still possible from its start.
  const expected = planWeekExpectedNow({ days: input.days, done: doneThisWeek, appliedAtUtc: plan.appliedAtUtc, nowMs: input.nowMs, tz: input.tz, weekdays: input.weekdays });
  const of = planWeekOf(Math.max(1, Math.min(expected ?? Number.POSITIVE_INFINITY, input.days.length) - (change?.daysRemoved ?? 0) - (input.skippedThisWeek ?? 0)), done, input.pausedDaysThisWeek ?? 0);
  const pct = input.sets.planned > 0 ? Math.round((100 * Math.min(input.sets.done, input.sets.planned)) / input.sets.planned) : null;
  return {
    planId: plan.id,
    planVersion: plan.version,
    name: plan.name,
    since: `Since ${dayMonthText(plan.appliedAtUtc, input.tz)}`,
    goal: goalLine(input.training),
    days,
    daysThisWeek: { done, of, text: `${String(done)} of ${String(of)}` },
    setsDone: pct === null ? null : { pct, text: `${String(pct)}%` },
    paused: paused === null ? null : { text: paused.untilDate === null ? PLAN_OVERVIEW_COPY.paused : PLAN_OVERVIEW_COPY.pausedUntil(localDateText(paused.untilDate)), untilDate: paused.untilDate },
    activities: [...(input.activities ?? [])],
    activityIds: (input.activities ?? []).map((_, i) => input.activityIds?.[i] ?? null),
    weekChange: change === null ? null : { text: change.text, weekPlanId: change.weekPlanId, version: change.version },
  };
}

// ---------------------------------------------------------------------------
// A plan day

export interface PlanDayDetailRow {
  key: string;
  exerciseId: string;
  name: string;
  /** `3 × 6–8 · 85 kg`, `3 × 10–12 · 22.5 kg each`, `1 × 10:00`, `95 kg top, 3 × 6–8 · 85 kg`, `3 sets` (mixed targets). */
  line: string;
  /** `Last 17 Oct: 80 × 12, 12 · Targets hit 5 of last 6`, `est.` (no history; an estimated load), or null. */
  sub: string | null;
  accessibilityLabel: string;
  /** (Ben, 27 Oct) Its superset label (`A1`, `A2`); null: on its own. */
  superset: string | null;
}

export interface PlanDayDetail {
  /** `Day 2 of 4 · Main gym · about 60 min`. */
  header: string;
  rows: PlanDayDetailRow[];
}

type Aggregate = Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>;

export interface PlanDayDetailInput {
  dayN: number;
  of: number;
  gymName: string | null;
  aboutMinutes: number | null;
  /** What Start would create at this gym (the dry run): the planned sets. */
  planned: Aggregate;
  /** Finished workouts with this exercise (any order). */
  history: (exerciseId: string) => readonly Aggregate[];
  /** Whether its line shows `Targets hit` (the setting on and a main lift, `targetsHitShown`). */
  targetsHit: (exerciseId: string) => boolean;
}

/** One prescribed working set (warm-ups, tombstones, sets skipped before the start and other-side companions aren't). */
function isPrescribed(s: WorkoutSet): boolean {
  return s.setType !== 'warmup' && s.status !== 'deleted' && s.skippedBy !== 'before_start' && s.pairedWithSetId === null;
}

/** Each set's planned target as text (reps, time, distance or the cardio values); a set with none is left out. */
function schemeValues(ex: Pick<SessionExercise, 'measurement'>, sets: readonly WorkoutSet[]): string[] {
  if (ex.measurement === 'cardio') return sets.map((s) => cardioValuesText({ durationS: s.planned.durationS, distanceM: s.planned.distanceM ?? null })).filter((x) => x !== '—');
  if (ex.measurement === 'distance') return sets.flatMap((s) => (s.planned.distanceM == null ? [] : [formatDistance(s.planned.distanceM)]));
  if (ex.measurement === 'duration') return sets.flatMap((s) => (s.planned.durationS === null ? [] : [formatDuration(s.planned.durationS)]));
  return sets.flatMap((s) => (s.planned.reps === null ? [] : [repRangeText(s.planned.reps)]));
}

/** The one value every one of `count` sets shares, else null (mixed sets never read as the most common one; review planview S6). */
function sameOf(values: readonly string[], count: number): string | null {
  const first = values[0];
  return first !== undefined && values.length === count && values.every((v) => v === first) ? first : null;
}

/** A logged load, short as the history lines print it (`80`, `+10`, `Assist 20`); the unit only when it isn't the plan's. */
function shortLoad(load: Load | null, unit: string | null): string | null {
  if (load === null || load.convention === 'bodyweight') return null;
  const n = `${formatNumber(load.value)}${unit !== null && load.unit !== unit ? ` ${load.unit}` : ''}`;
  if (load.convention === 'added') return load.value === 0 ? null : `+${n}`;
  if (load.convention === 'assistance') return `Assist ${n}`;
  return n;
}

/** What was done last time: `80 × 12, 12`, `80 × 8, 75 × 10`, `12, 10`, `0:45, 0:40`, `10:00 · 2,450 m · 2:02 /500 m`. */
function doneText(ex: Pick<SessionExercise, 'measurement' | 'exerciseId'>, sets: readonly WorkoutSet[], unit: string | null): string | null {
  const done = sets.filter((s) => s.status === 'completed' && s.actual !== null);
  if (done.length === 0) return null;
  if (ex.measurement === 'cardio') {
    return done
      .map((s) => {
        const v = { durationS: s.actual?.durationS ?? null, distanceM: s.actual?.distanceM ?? null };
        const pace = paceText(v, ex.exerciseId);
        return pace === null ? cardioValuesText(v) : `${cardioValuesText(v)} · ${pace}`;
      })
      .join(', ');
  }
  const groups: { load: string | null; values: string[] }[] = [];
  for (const s of done) {
    const a = s.actual;
    if (a === null) continue;
    const value = ex.measurement === 'duration' ? (a.durationS === null ? null : formatDuration(a.durationS)) : ex.measurement === 'distance' ? (a.distanceM == null ? null : formatDistance(a.distanceM)) : a.reps === null ? null : String(a.reps);
    if (value === null) continue;
    const load = shortLoad(a.load, unit);
    const last = groups.at(-1);
    if (last !== undefined && last.load === load) last.values.push(value);
    else groups.push({ load, values: [value] });
  }
  if (groups.length === 0) return null;
  return groups.map((g) => (g.load === null ? g.values.join(', ') : `${g.load} × ${g.values.join(', ')}`)).join(', ');
}

/** `Day 2 of 4 · Main gym · about 60 min`; the parts not known are left out. */
export function planDayHeader(dayN: number, of: number, gymName: string | null, aboutMinutes: number | null): string {
  return [`Day ${String(dayN)} of ${String(of)}`, gymName, aboutMinutes === null ? null : `about ${String(aboutMinutes)} min`].filter((x): x is string => x !== null).join(' · ');
}

/**
 * A plan day as its screen shows it: per exercise, what Start would plan
 * here (`3 × 6–8 · 85 kg`: the target and load its working sets share; a
 * top set on its own, `95 kg top, 3 × 6–8 · 85 kg`) and a line from his history: last time's sets and, for a main lift with the
 * setting on, `Targets hit 5 of last 6`; with no history, `est.` when the planned load is an estimate
 * (rule 6). Values only.
 */
export function planDayDetail(input: PlanDayDetailInput): PlanDayDetail {
  const header = planDayHeader(input.dayN, input.of, input.gymName, input.aboutMinutes);
  const snapshot = input.planned.session.equipmentSnapshot;
  const rows = [...input.planned.exercises]
    .filter((e) => e.removed === undefined)
    // Skipped today (every working set taken out before the start, review planview S3): not in what Start opens.
    .filter((e) => {
      const own = input.planned.sets.filter((s) => s.sessionExerciseId === e.id && s.setType !== 'warmup' && s.status !== 'deleted');
      return !(own.length > 0 && own.every((s) => s.skippedBy === 'before_start'));
    })
    .sort((a, b) => a.order - b.order);
  const labels = supersetLabels(rows);
  return { header, rows: rows.map((ex, i): PlanDayDetailRow => {
      const sets = input.planned.sets.filter((s) => s.sessionExerciseId === ex.id && isPrescribed(s)).sort((a, b) => a.index - b.index);
      const eq = equipmentOfRow(snapshot, ex);
      const loadsOf = (xs: readonly WorkoutSet[]): string[] => (ex.measurement === 'cardio' ? [] : xs.flatMap((s) => (s.planned.load === null ? [] : [loadText(s.planned.load, ex.loadConvention, eq)])).filter((t) => t !== '—' && t !== 'BW'));
      // Review planview S6: a top set reads on its own (`95 kg top, 3 × 6–8 · 85 kg`); the rest show a target or load only when they share it.
      const tops = sets.filter((s) => s.setType === 'top');
      const rest = sets.filter((s) => s.setType !== 'top');
      const parts: string[] = [];
      if (tops.length > 0) {
        const topLoad = sameOf(loadsOf(tops), tops.length);
        parts.push(topLoad === null ? (tops.length === 1 ? 'Top set' : `${String(tops.length)} top sets`) : `${tops.length === 1 ? '' : `${String(tops.length)} × `}${topLoad} top`);
      }
      if (rest.length > 0 || tops.length === 0) {
        const scheme = sameOf(schemeValues(ex, rest), rest.length);
        const load = sameOf(loadsOf(rest), rest.length);
        const n = String(rest.length);
        parts.push(`${scheme === null ? `${n} ${rest.length === 1 ? 'set' : 'sets'}` : `${n} × ${scheme}`}${load === null ? '' : ` · ${load}`}`);
      }
      const line = parts.join(', ');
      const unit = sets.find((s) => s.planned.load !== null)?.planned.load?.unit ?? null;
      const sub = lastTimeSub(ex.exerciseId, input.history(ex.exerciseId), unit, input.targetsHit(ex.exerciseId)) ?? (sets.some((s) => s.planned.provenance?.estimate === true) ? 'est.' : null);
      return detailRow(ex.id, ex.exerciseId, ex.exerciseName, line, sub, labels[i] ?? null);
    }) };
}

function detailRow(key: string, exerciseId: string, name: string, line: string, sub: string | null, superset: string | null = null): PlanDayDetailRow {
  return { key, exerciseId, name, line, sub, superset, accessibilityLabel: [...(superset === null ? [] : [`${superset}, superset`]), name, line, ...(sub === null ? [] : [sub === 'est.' ? 'estimated load' : sub])].join(', ') };
}

/** `Last 17 Oct: 80 × 12, 12 · Targets hit 5 of last 6` (`Targets hit` only when `withHit`) from his newest finished workout with it, else null. */
function lastTimeSub(exerciseId: string, workouts: readonly Aggregate[], unit: string | null, withHit: boolean): string | null {
  const history = [...workouts].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
  for (const a of history) {
    const parts = a.exercises.filter((e) => e.exerciseId === exerciseId && e.removed === undefined).sort((x, y) => x.order - y.order);
    const logged = parts.flatMap((p) => a.sets.filter((s) => s.sessionExerciseId === p.id && isPrescribed(s)).sort((x, y) => x.index - y.index));
    const text = parts[0] === undefined ? null : doneText(parts[0], logged, unit);
    if (text === null) continue;
    const sub = `Last ${dayMonthText(a.session.startedAt.utc, a.session.startedAt.tz)}: ${text}`;
    const hit = withHit ? exerciseTargetHistory(history, exerciseId).hitText : null;
    return hit === null ? sub : `${sub} · ${hit}`;
  }
  return null;
}

export interface PlanDayTemplateInput {
  dayN: number;
  of: number;
  gymName: string | null;
  /** The plan day's saved workout. */
  routine: Pick<Routine, 'exercises'>;
  exerciseOf: (exerciseId: string) => Pick<Exercise, 'name' | 'measurement'> | null;
  /** Ben's unit: a logged load in another unit shows its unit. */
  unit: string;
  history: (exerciseId: string) => readonly Aggregate[];
  /** Whether its line shows `Targets hit` (the setting on and a main lift, `targetsHitShown`). */
  targetsHit: (exerciseId: string) => boolean;
}

/**
 * (Review planview S2) A plan day with nothing planned at a gym (no gym yet,
 * or this gym can't start it): each exercise's saved sets × target, with no
 * load (a load is only shown once it is snapped to a gym, rule 4), and last
 * time's sets. Values only.
 */
export function planDayFromTemplates(input: PlanDayTemplateInput): PlanDayDetail {
  const sorted = [...input.routine.exercises].sort((a, b) => a.order - b.order);
  const labels = supersetLabels(sorted);
  const rows = sorted.map((re, i): PlanDayDetailRow => {
      const ex = input.exerciseOf(re.exerciseId);
      const name = ex?.name ?? 'Exercise';
      const ts = re.setTemplates.filter((t) => t.setType !== 'warmup');
      const tops = ts.filter((t) => t.setType === 'top');
      const rest = ts.filter((t) => t.setType !== 'top');
      const values = rest.flatMap((t): string[] => {
        if (ex?.measurement === 'cardio') return t.targetDurationS === null ? [] : [cardioValuesText({ durationS: t.targetDurationS, distanceM: t.targetDistanceM ?? null })];
        if (ex?.measurement === 'distance') return t.targetDistanceM == null ? [] : [formatDistance(t.targetDistanceM)];
        if (ex?.measurement === 'duration' || t.targetReps === null) return t.targetDurationS === null ? [] : [formatDuration(t.targetDurationS)];
        return [repRangeText(t.targetReps)];
      });
      const scheme = sameOf(values, rest.length);
      const parts = [...(tops.length === 0 ? [] : [tops.length === 1 ? 'Top set' : `${String(tops.length)} top sets`]), ...(rest.length > 0 || tops.length === 0 ? [scheme === null ? `${String(rest.length)} ${rest.length === 1 ? 'set' : 'sets'}` : `${String(rest.length)} × ${scheme}`] : [])];
      return detailRow(re.id, re.exerciseId, name, parts.join(', '), lastTimeSub(re.exerciseId, input.history(re.exerciseId), input.unit, input.targetsHit(re.exerciseId)), labels[i] ?? null);
    });
  return { header: planDayHeader(input.dayN, input.of, input.gymName, null), rows };
}
