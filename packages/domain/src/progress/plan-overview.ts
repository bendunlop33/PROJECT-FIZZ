import type { Load, PlanDraftStatus, SessionAggregate, SessionExercise, TrainingGoal, WorkoutSet } from '@fizz/schemas';
import { weekdayOf } from '../calendar';
import { paceText } from '../cardio';
import { cardioValuesText, dayMonthText, formatDistance, formatDuration, formatNumber, loadText, repRangeText } from '../display';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { toMs } from '../time';
import { dayOf, exerciseTargetHistory, planDaysDoneThisWeek, plannedVsDone, planWeekStartMs, type PlanWeekDay, type PlanWeekWorkout } from './plan-tracker';

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
}

export interface PlanOverviewInput {
  /** The plan Ben is using; anything but `applied` has no block. */
  plan: { id: string; name: string; status: PlanDraftStatus; version: number; appliedAtUtc: string } | null;
  /** The plan's live days in plan order. */
  days: readonly (PlanWeekDay & { name: string })[];
  /** Finished workouts (any order). */
  workouts: readonly (PlanWeekWorkout & { tz: string })[];
  /** Up next's workout when it is one of the plan's days. */
  nextRoutineId: string | null;
  /** Profile › Training details; null: none saved. */
  training: { goal?: TrainingGoal | undefined; daysPerWeek?: number | undefined; sessionMinutes?: number | undefined } | null;
  /** `plannedSetsThisWeek`. */
  sets: { planned: number; done: number };
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
  const doneThisWeek = planDaysDoneThisWeek({ days: input.days, appliedAtUtc: plan.appliedAtUtc, workouts: input.workouts, nowMs: input.nowMs, tz: input.tz });
  const newest = new Map<string, PlanWeekWorkout & { tz: string }>();
  for (const w of input.workouts) {
    if (toMs(w.startedAtUtc) > input.nowMs) continue;
    const d = dayOf(input.days, w);
    if (d === undefined) continue;
    const prev = newest.get(d.routineId);
    if (prev === undefined || toMs(prev.startedAtUtc) < toMs(w.startedAtUtc)) newest.set(d.routineId, w);
  }
  const nextId = input.days.some((d) => d.routineId === input.nextRoutineId) ? input.nextRoutineId : null;
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
    return { routineId: d.routineId, n: i + 1, name: d.name, state, next, when, accessibilityLabel: said.join(', ') };
  });
  const done = doneThisWeek.size;
  const of = input.days.length;
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
  };
}

// ---------------------------------------------------------------------------
// A plan day

export interface PlanDayDetailRow {
  key: string;
  exerciseId: string;
  name: string;
  /** `3 × 6–8 · 85 kg`, `3 × 10–12 · 22.5 kg each`, `1 × 10:00`. */
  line: string;
  /** `Last 17 Oct: 80 × 12, 12 · Targets hit 5 of last 6`, `est.` (no history; an estimated load), or null. */
  sub: string | null;
  accessibilityLabel: string;
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
}

/** One prescribed working set (warm-ups, tombstones, sets skipped before the start and other-side companions aren't). */
function isPrescribed(s: WorkoutSet): boolean {
  return s.setType !== 'warmup' && s.status !== 'deleted' && s.skippedBy !== 'before_start' && s.pairedWithSetId === null;
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

function schemeOf(ex: Pick<SessionExercise, 'measurement'>, sets: readonly WorkoutSet[]): string | null {
  if (ex.measurement === 'cardio') {
    const t = mostCommon(sets.map((s) => cardioValuesText({ durationS: s.planned.durationS, distanceM: s.planned.distanceM ?? null })).filter((x) => x !== '—'));
    return t;
  }
  if (ex.measurement === 'distance') return mostCommon(sets.flatMap((s) => (s.planned.distanceM == null ? [] : [formatDistance(s.planned.distanceM)])));
  if (ex.measurement === 'duration') return mostCommon(sets.flatMap((s) => (s.planned.durationS === null ? [] : [formatDuration(s.planned.durationS)])));
  return mostCommon(sets.flatMap((s) => (s.planned.reps === null ? [] : [repRangeText(s.planned.reps)])));
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

/**
 * A plan day as its screen shows it: per exercise, what Start would plan
 * here (`3 × 6–8 · 85 kg`, the most common target and load of its working
 * sets) and a line from his history: last time's sets and `Targets hit 5 of
 * last 6`; with no history, `est.` when the planned load is an estimate
 * (rule 6). Values only.
 */
export function planDayDetail(input: PlanDayDetailInput): PlanDayDetail {
  const header = [`Day ${String(input.dayN)} of ${String(input.of)}`, input.gymName, input.aboutMinutes === null ? null : `about ${String(input.aboutMinutes)} min`].filter((x): x is string => x !== null).join(' · ');
  const snapshot = input.planned.session.equipmentSnapshot;
  const rows = [...input.planned.exercises]
    .filter((e) => e.removed === undefined)
    .sort((a, b) => a.order - b.order)
    .map((ex): PlanDayDetailRow => {
      const sets = input.planned.sets.filter((s) => s.sessionExerciseId === ex.id && isPrescribed(s)).sort((a, b) => a.index - b.index);
      const scheme = schemeOf(ex, sets);
      const eq = equipmentOfRow(snapshot, ex);
      const loads = ex.measurement === 'cardio' ? [] : sets.flatMap((s) => (s.planned.load === null ? [] : [loadText(s.planned.load, ex.loadConvention, eq)])).filter((t) => t !== '—' && t !== 'BW');
      const load = mostCommon(loads);
      const n = String(sets.length);
      const line = `${scheme === null ? `${n} ${sets.length === 1 ? 'set' : 'sets'}` : `${n} × ${scheme}`}${load === null ? '' : ` · ${load}`}`;
      const unit = sets.find((s) => s.planned.load !== null)?.planned.load?.unit ?? null;
      const history = [...input.history(ex.exerciseId)].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
      let sub: string | null = null;
      for (const a of history) {
        const parts = a.exercises.filter((e) => e.exerciseId === ex.exerciseId && e.removed === undefined).sort((x, y) => x.order - y.order);
        const logged = parts.flatMap((p) => a.sets.filter((s) => s.sessionExerciseId === p.id && isPrescribed(s)).sort((x, y) => x.index - y.index));
        const text = parts[0] === undefined ? null : doneText(parts[0], logged, unit);
        if (text === null) continue;
        sub = `Last ${dayMonthText(a.session.startedAt.utc, a.session.startedAt.tz)}: ${text}`;
        break;
      }
      if (sub !== null) {
        const hit = exerciseTargetHistory(history, ex.exerciseId).hitText;
        if (hit !== null) sub = `${sub} · ${hit}`;
      } else if (sets.some((s) => s.planned.provenance?.estimate === true)) sub = 'est.';
      return { key: ex.id, exerciseId: ex.exerciseId, name: ex.exerciseName, line, sub, accessibilityLabel: [ex.exerciseName, line, ...(sub === null ? [] : [sub === 'est.' ? 'estimated load' : sub])].join(', ') };
    });
  return { header, rows };
}
