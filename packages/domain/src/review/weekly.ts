import {
  BUILDER_GROUPS,
  builderGroupOfMuscleGroup,
  isBuilderStrength,
  muscleGroupOf,
  type ActivityKind,
  type BuilderMuscleInfo,
  type EquipmentKind,
  type LiftTarget,
  type Load,
  type LoadConvention,
  type MuscleGroup,
  type ReviewFact,
  type SessionAggregate,
  type SessionFeelValue,
  type SetType,
  type TrainingGoal,
  type WeightUnit,
} from '@fizz/schemas';
import { addDays, localDateOf, localHourUtcMs, localMidnightUtcMs, localWeekBounds } from '../calendar';
import { isSetCountable } from '../exclusions';
import { e1rmConventionAllowed, estimateOneRepMax, roundEstimate } from '../progress/e1rm';
import { planDaysDoneThisWeek, planWeekOf, pausedInWeek, type PlanWeekDay } from '../progress/plan-tracker';
import { toProgressSession } from '../progress/projection';
import { isInHistory } from '../session/deletion';
import { toMs } from '../time';
import { convertMass } from '../units';

/**
 * The weekly review's facts (workout-builder-v3 §6, §6.1, §6.2; Ben 20–21 Oct). Pure, from stored
 * records only (rule 6: no scores, no recovery numbers, no predictions; an est. 1RM is always flagged an
 * estimate). The coach adds judgement on top; it never supplies a number.
 *
 * - **Consistency first** (Ben, 21 Oct): plan days done vs planned for the week (the same count as
 *   Progress's consistency card and Library › Your plan: `planDaysDoneThisWeek`, `planWeekOf`, paused
 *   days left out), and the last 6 weeks the same way. With no plan, Profile's days-a-week aim is the
 *   plan; with neither, workouts only. Runs are counted separately. Missed plan days are named, never scored.
 * - **Sets per muscle**, by the builder's one counting convention (workout-builder-v3 §3.7,
 *   `builderGroupOf`): each exercise's completed working sets count in full for the group of its first
 *   primary muscle that has a builder group; secondary muscles get nothing. Against the plan's planned
 *   sets and the goal range (playbook V4, Coaching knowledge).
 * - **Lifts Ben chose** (default: the plan's main lifts; up to 6): a trend of est. 1RM (labelled), best
 *   set, or reps for bodyweight work; an assisted lift is better with less assistance. The lift target,
 *   when one is set, is a level line with was → now → target. Never a projection or a predicted date.
 * - **Flags**: lifts with no progress over 3 sessions; RPE against the sessions' own targets; Ben's
 *   `How did it feel?`; and (§6.1 feedback loop) the same edit repeated on a plan-day template.
 */

export const WEEKLY_REVIEW = {
  /** Weeks in the consistency bars (this one included). */
  weeks: 6,
  /** Points on a lift's trend line. */
  liftPoints: 12,
  /** How far back a lift's trend (and the stall check) reads. */
  trendWeeks: 16,
  /** No new best over this many sessions: a stalled lift (§6.1). */
  stalledSessions: 3,
  /** The same edit in this many newest workouts from a template suggests updating it (§6.1). */
  repeatedEdit: 2,
  /** Lifts on Progress › Reviews (Ben, 21 Oct). */
  maxLifts: 6,
  /** Sunday from this local hour reviews the week now ending (§6.1 "Sunday evening"). */
  sundayEveningHour: 18,
  /** A template tweak keeps an exercise between these working sets, changing it by at most `maxStep`. */
  setsMin: 1,
  setsMax: 8,
  maxStep: 2,
} as const;
const W = WEEKLY_REVIEW;

/**
 * Weekly working sets per muscle group by goal (playbook-v1 rule 1 / volume-by-frequency V4; Coaching
 * knowledge). Muscle: priority groups 10–20, the rest 6–10, so a group is low under 6 and high over 20;
 * strength: other groups 4–10. `both` uses the muscle band. [Proposal, for Ben to confirm the bands.]
 */
export const WEEKLY_SET_RANGE: Readonly<Record<TrainingGoal, { min: number; max: number }>> = {
  muscle: { min: 6, max: 20 },
  strength: { min: 4, max: 10 },
  both: { min: 6, max: 20 },
};

// ---------------------------------------------------------------------------
// Inputs

const WORKING: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

export interface ReviewSet {
  setType: SetType;
  load: Load | null;
  reps: number | null;
  rpe: number | null;
  /** The set's own target RPE when it had one (never assumed). */
  targetRpe: number | null;
  /** False when Ben marked it (`Spotted`, `Pain`, `Form broke`, `Other equipment`): never a best. */
  counts: boolean;
}

export interface ReviewExercise {
  exerciseId: string;
  name: string;
  equipmentKind: EquipmentKind | null;
  /** Completed sets with a result, in order. */
  sets: readonly ReviewSet[];
  /** Working sets the workout was set up with (Ben's edits before Start included): the template comparison. */
  plannedWorking: number;
}

export interface ReviewSession {
  sessionId: string;
  name: string | null;
  /** Local date (Ben's zone, or an import's own date). */
  date: string;
  startedMs: number;
  startedAtUtc: string;
  routineId: string | null;
  /** The plan-day template it was started from (§4.2), if any. */
  template: { routineId: string } | null;
  feel: SessionFeelValue | null;
  exercises: readonly ReviewExercise[];
}

/** A finished workout as the review reads it (corrections applied; null when it isn't in history). */
export function reviewSessionOf(a: SessionAggregate, ownerTz: string, nowMs: number): ReviewSession | null {
  if (!isInHistory(a.session)) return null;
  const p = toProgressSession(a, ownerTz, nowMs);
  if (p === null) return null;
  const targetRpe = new Map<string, number>();
  for (const s of a.sets) if (s.planned.rpe != null) targetRpe.set(s.id, s.planned.rpe);
  const planned = new Map<string, number>();
  for (const s of a.sets) {
    if (s.setType === 'warmup' || s.status === 'deleted' || s.pairedWithSetId !== null || s.skippedBy === 'before_start') continue;
    planned.set(s.sessionExerciseId, (planned.get(s.sessionExerciseId) ?? 0) + 1);
  }
  const removed = new Set(a.exercises.filter((e) => e.removed !== undefined).map((e) => e.id));
  return {
    sessionId: p.sessionId,
    name: p.name,
    date: p.date,
    startedMs: p.startedMs,
    startedAtUtc: p.startedAtUtc,
    routineId: a.session.routineId ?? null,
    template: a.session.planDay?.templateRoutineId != null ? { routineId: a.session.planDay.templateRoutineId } : null,
    feel: a.session.feel?.value ?? null,
    exercises: p.exercises
      .filter((e) => !removed.has(e.sessionExerciseId))
      .map((e) => ({
        exerciseId: e.exerciseId,
        name: e.exerciseName,
        equipmentKind: e.equipmentKind,
        plannedWorking: planned.get(e.sessionExerciseId) ?? 0,
        sets: e.sets.map((s) => ({ setType: s.setType, load: s.load, reps: s.reps, rpe: s.rpe, targetRpe: targetRpe.get(s.setId) ?? null, counts: isSetCountable(s, 'record') })),
      })),
  };
}

export interface ReviewPlanDay extends PlanWeekDay {
  name: string;
}

/** A plan Ben had in use (now or before): its days, when it was applied, until when, its paused dates. */
export interface ReviewPlan {
  planId: string;
  appliedAtUtc: string;
  /** Ended or superseded at; null while in use. */
  untilUtc: string | null;
  days: readonly ReviewPlanDay[];
  pausedDates: ReadonlySet<string>;
}

/** A plan-day template of the plan in use now. */
export interface ReviewTemplate {
  planId: string;
  routineId: string;
  name: string;
  version: number;
  exercises: readonly { exerciseId: string; name: string; workingSets: number }[];
}

export interface ReviewActivity {
  id: string;
  date: string;
  kind: ActivityKind;
  status: 'done' | 'planned';
  distanceM: number | null;
}

export interface WeeklyReviewInput {
  /** The plan week reviewed (local Monday). */
  monday: string;
  nowMs: number;
  tz: string;
  /** Finished workouts (any order), reaching back at least `trendWeeks`. */
  sessions: readonly ReviewSession[];
  plans: readonly ReviewPlan[];
  /** Profile's days a week; null: not set. */
  aim: number | null;
  goal: TrainingGoal | null;
  /** Muscles and kind per exercise (catalogue or Ben's own). */
  info: (exerciseId: string) => BuilderMuscleInfo | null;
  /** The lifts Ben chose (or the plan's main lifts), in order; capped at 6. */
  lifts: readonly string[];
  /** Lift targets in use (the setting on); empty otherwise. */
  liftTargets: readonly LiftTarget[];
  activities: readonly ReviewActivity[];
  templates: readonly ReviewTemplate[];
  /** Exercises with an active pain flag: never a tweak (rule 9). */
  painFlagged: ReadonlySet<string>;
  /** Ben's unit: a lift's trend is in it unless its target says otherwise. */
  unit: WeightUnit;
}

// ---------------------------------------------------------------------------
// Facts

export interface ReviewWeekCount {
  monday: string;
  /** Plan days done (with a plan), days trained (with an aim only), else workouts. */
  done: number;
  /** Null with no plan in use and no aim. */
  planned: number | null;
  workouts: number;
  runs: number;
}

export interface LiftPoint {
  sessionId: string;
  date: string;
  /** What the line plots: the est. 1RM, the set's load, or reps. */
  value: number;
  /** The set behind it (load in the trend's unit). */
  load: Load | null;
  reps: number;
}

export type LiftMetric = 'e1rm' | 'best_set' | 'reps';

export interface LiftTrend {
  exerciseId: string;
  name: string;
  metric: LiftMetric;
  /** Null for reps. */
  unit: WeightUnit | null;
  convention: LoadConvention | null;
  /** Assisted: less assistance is stronger. */
  lowerIsBetter: boolean;
  /** Oldest first, at most 12. */
  points: LiftPoint[];
  target: { value: number; reps: number; kind: LiftTarget['kind'] } | null;
  was: { value: number; isEstimate: boolean } | null;
  /** The newest point's value; null with none. */
  now: number | null;
}

export interface GroupSets {
  group: MuscleGroup;
  sets: number;
  /** The plan's working sets for the week; null with no plan, or a part-paused week. */
  planned: number | null;
  range: { min: number; max: number } | null;
}

export interface TemplateEdit {
  routineId: string;
  routineName: string;
  expectedVersion: number;
  exerciseId: string;
  exerciseName: string;
  sessions: number;
  fromSets: number;
  toSets: number;
}

export interface WeeklyFacts {
  monday: string;
  /** The week is over (false: reviewed on Sunday evening, or a live view of this week). */
  complete: boolean;
  basis: 'plan' | 'aim' | 'none';
  /** This week: same shape as `weeks`' last entry. */
  week: ReviewWeekCount;
  /** Day dots: each plan day (done or not), else each workout done. */
  days: { name: string; done: boolean; date: string | null }[];
  /**
   * Plan days not done, named: only once the week is over, at most `missedCount`, and only when no day of
   * the week was paused (plan days aren't dated, pauses are; review b3-wave3-truth B4, SP1).
   */
  missed: string[];
  /** Plan days missed (planned − done) once the week is over; 0 before then or with no plan. */
  missedCount: number;
  /** The last 6 weeks, oldest first, this one last. */
  weeks: ReviewWeekCount[];
  groups: GroupSets[];
  lifts: LiftTrend[];
  runs: { count: number; distanceM: number | null };
  rpe: { sessions: number; mean: number; target: number | null } | null;
  stalled: { exerciseId: string; name: string; sessions: number }[];
  feel: { easy: number; good: number; hard: number };
  edits: TemplateEdit[];
  /** Any finished workout up to the week's end. */
  hasHistory: boolean;
  /** Workouts in the week. */
  workoutIds: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The week a review is due for on this open (§6.1): from Sunday evening, this week; otherwise the week just ended. */
export function weeklyReviewWeek(nowMs: number, tz: string): string {
  const { mondayLocalDate } = localWeekBounds(nowMs, tz);
  const sunday = addDays(mondayLocalDate, 6);
  return nowMs >= localHourUtcMs(sunday, W.sundayEveningHour, tz) ? mondayLocalDate : addDays(mondayLocalDate, -7);
}

/** The muscle group the builder credits an exercise's sets to: the first primary muscle with a builder group. */
export function leadMuscleGroup(info: BuilderMuscleInfo | null): MuscleGroup | null {
  if (info === null || !isBuilderStrength(info)) return null;
  for (const m of info.primaryMuscles) {
    const g = muscleGroupOf(m);
    if (g !== null && builderGroupOfMuscleGroup(g) !== null) return g;
  }
  return null;
}

/** First-primary-muscle groups of a workout (as Up next and the plan count, `workoutGroupsOf`). */
function workoutGroups(s: ReviewSession, info: WeeklyReviewInput['info']): Map<MuscleGroup, number> {
  const out = new Map<MuscleGroup, number>();
  for (const e of s.exercises) {
    const first = info(e.exerciseId)?.primaryMuscles[0];
    const g = first === undefined ? null : muscleGroupOf(first);
    const n = e.sets.filter((x) => x.setType !== 'warmup').length;
    if (g !== null && n > 0) out.set(g, (out.get(g) ?? 0) + n);
  }
  return out;
}

function weekBounds(monday: string, tz: string): { startMs: number; endMs: number } {
  return { startMs: localMidnightUtcMs(monday, tz), endMs: localMidnightUtcMs(addDays(monday, 7), tz) };
}

const inWeek = (s: ReviewSession, monday: string): boolean => s.date >= monday && s.date <= addDays(monday, 6);

function planFor(plans: readonly ReviewPlan[], startMs: number, endMs: number): ReviewPlan | null {
  let best: ReviewPlan | null = null;
  for (const p of plans) {
    const from = toMs(p.appliedAtUtc);
    const until = p.untilUtc === null ? Infinity : toMs(p.untilUtc);
    if (from >= endMs || until <= startMs || p.days.length === 0) continue;
    if (best === null || from > toMs(best.appliedAtUtc)) best = p;
  }
  return best;
}

function weekCount(input: WeeklyReviewInput, monday: string): { count: ReviewWeekCount; plan: ReviewPlan | null; done: Map<string, string> } {
  const { startMs, endMs } = weekBounds(monday, input.tz);
  const sessions = input.sessions.filter((s) => inWeek(s, monday));
  const runs = input.activities.filter((a) => a.status === 'done' && a.kind === 'run' && a.date >= monday && a.date <= addDays(monday, 6)).length;
  const plan = planFor(input.plans, startMs, endMs);
  if (plan !== null) {
    const workouts = sessions.map((s) => ({ sessionId: s.sessionId, routineId: s.routineId, startedAtUtc: s.startedAtUtc, groups: workoutGroups(s, input.info) }));
    const done = planDaysDoneThisWeek({ days: plan.days, appliedAtUtc: plan.appliedAtUtc, workouts, nowMs: Math.min(input.nowMs, endMs - 1), tz: input.tz });
    const paused = pausedInWeek(monday, plan.pausedDates);
    const planned = paused >= 7 ? null : planWeekOf(plan.days.length, done.size, paused);
    return { count: { monday, done: done.size, planned, workouts: sessions.length, runs }, plan, done };
  }
  const days = new Set(sessions.map((s) => s.date)).size;
  // An aim stays the aim: 4 days against 3 reads `4 of 3`, as the consistency card's `4/3` (review b3-wave3-truth S2).
  if (input.aim !== null && input.aim > 0) return { count: { monday, done: days, planned: input.aim, workouts: sessions.length, runs }, plan: null, done: new Map() };
  return { count: { monday, done: sessions.length, planned: null, workouts: sessions.length, runs }, plan: null, done: new Map() };
}

// ---- lifts

interface Candidate {
  sessionId: string;
  date: string;
  value: number;
  load: Load | null;
  reps: number;
}

/** The trend's terms for a lift: its newest load convention and the unit it is shown in. */
function liftTerms(sessions: readonly ReviewSession[], exerciseId: string, target: LiftTarget | null, unit: WeightUnit): { convention: LoadConvention | null; unit: WeightUnit; kind: EquipmentKind | null } {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const ex = sessions[i]?.exercises.find((e) => e.exerciseId === exerciseId);
    const set = ex?.sets.find((s) => WORKING.has(s.setType) && s.load !== null);
    if (ex !== undefined && set?.load != null) return { convention: set.load.convention, unit: target?.load.unit ?? unit, kind: ex.equipmentKind };
  }
  return { convention: null, unit: target?.load.unit ?? unit, kind: null };
}

function metricFor(convention: LoadConvention | null, kind: EquipmentKind | null, target: LiftTarget | null): { metric: LiftMetric; lowerIsBetter: boolean; minReps: number } {
  if (convention === null || convention === 'bodyweight') return { metric: 'reps', lowerIsBetter: false, minReps: 1 };
  if (convention === 'assistance') return { metric: 'best_set', lowerIsBetter: true, minReps: 1 };
  if (target?.kind === 'weight_reps') return { metric: 'best_set', lowerIsBetter: false, minReps: target.reps };
  if (e1rmConventionAllowed(convention, kind)) return { metric: 'e1rm', lowerIsBetter: false, minReps: 1 };
  return { metric: 'best_set', lowerIsBetter: false, minReps: 1 };
}

/** One session's point for a lift, or null when it had no set that counts in these terms. */
function sessionPoint(s: ReviewSession, exerciseId: string, terms: { convention: LoadConvention | null; unit: WeightUnit }, m: { metric: LiftMetric; lowerIsBetter: boolean; minReps: number }): Candidate | null {
  let best: Candidate | null = null;
  for (const ex of s.exercises) {
    if (ex.exerciseId !== exerciseId) continue;
    for (const set of ex.sets) {
      if (!WORKING.has(set.setType) || !set.counts || set.reps === null || set.reps < 1) continue;
      let c: Candidate;
      if (m.metric === 'reps') {
        if (set.load !== null && set.load.convention !== 'bodyweight') continue;
        c = { sessionId: s.sessionId, date: s.date, value: set.reps, load: set.load, reps: set.reps };
      } else {
        if (set.load === null || set.load.convention !== terms.convention || set.reps < m.minReps) continue;
        const v = convertMass({ value: set.load.value, unit: set.load.unit }, terms.unit).value;
        const load: Load = { value: roundEstimate(v, terms.unit), unit: terms.unit, convention: set.load.convention };
        if (m.metric === 'e1rm') {
          const e = estimateOneRepMax({ value: v, unit: terms.unit, convention: set.load.convention }, set.reps, ex.equipmentKind);
          if (!e.eligible) continue;
          c = { sessionId: s.sessionId, date: s.date, value: e.value, load, reps: set.reps };
        } else c = { sessionId: s.sessionId, date: s.date, value: load.value, load, reps: set.reps };
      }
      if (best === null) best = c;
      else {
        const better = m.lowerIsBetter ? c.value < best.value || (c.value === best.value && c.reps > best.reps) : c.value > best.value || (c.value === best.value && c.reps > best.reps);
        if (better) best = c;
      }
    }
  }
  return best;
}

const EPS = 1e-6;

/** No new best in the last `n` points against every point before them (needs at least `n + 1`). */
export function isStalled(values: readonly number[], lowerIsBetter: boolean, n: number = W.stalledSessions): boolean {
  if (values.length < n + 1) return false;
  const before = values.slice(0, -n);
  const last = values.slice(-n);
  const best = lowerIsBetter ? Math.min(...before) : Math.max(...before);
  return last.every((v) => (lowerIsBetter ? v >= best - EPS : v <= best + EPS));
}

function liftSeries(input: WeeklyReviewInput, exerciseId: string, endDate: string, target: LiftTarget | null): { trend: Omit<LiftTrend, 'name'>; all: Candidate[] } | null {
  const from = addDays(endDate, -7 * W.trendWeeks + 1);
  const sessions = input.sessions.filter((s) => s.date >= from && s.date <= endDate && s.exercises.some((e) => e.exerciseId === exerciseId)).sort((a, b) => a.startedMs - b.startedMs);
  if (sessions.length === 0) return null;
  const terms = liftTerms(sessions, exerciseId, target, input.unit);
  // A target in other terms (another convention) isn't drawn against this line.
  const t = target !== null && terms.convention === target.load.convention ? target : null;
  const m = metricFor(terms.convention, terms.kind, t);
  const all = sessions.map((s) => sessionPoint(s, exerciseId, terms, m)).filter((c): c is Candidate => c !== null);
  if (all.length === 0) return null;
  const points = all.slice(-W.liftPoints);
  const last = points.at(-1);
  return {
    all,
    trend: {
      exerciseId,
      metric: m.metric,
      unit: m.metric === 'reps' ? null : terms.unit,
      convention: m.metric === 'reps' ? null : terms.convention,
      lowerIsBetter: m.lowerIsBetter,
      points,
      target: t === null ? null : { value: t.load.value, reps: t.reps, kind: t.kind },
      was: t?.was == null ? null : { value: t.was.value, isEstimate: t.was.isEstimate },
      now: last?.value ?? null,
    },
  };
}

/** A chosen lift with no sets in the trend window: no points, its target (if any) still named. */
function emptyTrend(exerciseId: string, name: string, target: LiftTarget | null, unit: WeightUnit): LiftTrend {
  return {
    exerciseId,
    name,
    metric: target === null || target.kind === 'weight_reps' ? 'best_set' : 'e1rm',
    unit: target?.load.unit ?? unit,
    convention: target?.load.convention ?? null,
    lowerIsBetter: false,
    points: [],
    target: target === null ? null : { value: target.load.value, reps: target.reps, kind: target.kind },
    was: target?.was == null ? null : { value: target.was.value, isEstimate: target.was.isEstimate },
    now: null,
  };
}

const nameIn = (sessions: readonly ReviewSession[], exerciseId: string): string => {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const e = sessions[i]?.exercises.find((x) => x.exerciseId === exerciseId);
    if (e !== undefined) return e.name;
  }
  return 'Exercise';
};

// ---- the facts

export function weeklyFacts(input: WeeklyReviewInput): WeeklyFacts {
  const monday = input.monday;
  const sunday = addDays(monday, 6);
  const { endMs } = weekBounds(monday, input.tz);
  const complete = input.nowMs >= endMs;
  const sessions = [...input.sessions].filter((s) => s.date <= sunday).sort((a, b) => a.startedMs - b.startedMs);
  const scoped: WeeklyReviewInput = { ...input, sessions };
  const thisWeek = sessions.filter((s) => inWeek(s, monday));

  // Consistency.
  const mondays = Array.from({ length: W.weeks }, (_, i) => addDays(monday, -7 * (W.weeks - 1 - i)));
  const counted = mondays.map((m) => weekCount(scoped, m));
  const current = counted.at(-1) ?? weekCount(scoped, monday);
  const basis: WeeklyFacts['basis'] = current.plan !== null ? 'plan' : current.count.planned !== null ? 'aim' : 'none';
  const days =
    current.plan !== null
      ? current.plan.days.map((d) => {
          const at = current.done.get(d.routineId);
          return { name: d.name, done: at !== undefined, date: at === undefined ? null : localDateOf(toMs(at), input.tz) };
        })
      : thisWeek.slice(0, 7).map((s) => ({ name: s.name ?? 'Workout', done: true, date: s.date }));
  const missedCount = complete && current.plan !== null && current.count.planned !== null ? Math.max(0, current.count.planned - current.count.done) : 0;
  const pausedNow = current.plan === null ? 0 : pausedInWeek(monday, current.plan.pausedDates);
  const missed = missedCount > 0 && pausedNow === 0 ? days.filter((d) => !d.done).map((d) => d.name).slice(0, missedCount) : [];

  // Sets per muscle: the builder's convention.
  const sets = new Map<MuscleGroup, number>();
  for (const s of thisWeek) {
    for (const e of s.exercises) {
      const g = leadMuscleGroup(input.info(e.exerciseId));
      const n = e.sets.filter((x) => WORKING.has(x.setType)).length;
      if (g !== null && n > 0) sets.set(g, (sets.get(g) ?? 0) + n);
    }
  }
  const planned = new Map<MuscleGroup, number>();
  const plan = current.plan;
  const pausedDays = plan === null ? 0 : pausedInWeek(monday, plan.pausedDates);
  // The plan's sets only from that plan's own templates: a week under an older plan has no plan line, never `plan 0` (review b3-wave3-truth S5).
  const dayIds = new Set(plan?.days.map((d) => d.routineId) ?? []);
  const planTemplates = plan === null ? [] : input.templates.filter((t) => t.planId === plan.planId && dayIds.has(t.routineId));
  if (planTemplates.length > 0 && pausedDays === 0) {
    for (const t of planTemplates) {
      for (const e of t.exercises) {
        const g = leadMuscleGroup(input.info(e.exerciseId));
        if (g !== null && e.workingSets > 0) planned.set(g, (planned.get(g) ?? 0) + e.workingSets);
      }
    }
  }
  const range = input.goal === null ? null : WEEKLY_SET_RANGE[input.goal];
  const order = (g: MuscleGroup): number => {
    const b = builderGroupOfMuscleGroup(g);
    return (b === null ? 99 : BUILDER_GROUPS.indexOf(b)) * 20 + ['Quads', 'Hamstrings', 'Glutes', 'Calves'].indexOf(g);
  };
  const groups: GroupSets[] = [...new Set([...sets.keys(), ...planned.keys()])]
    .sort((a, b) => order(a) - order(b))
    .map((g) => ({ group: g, sets: sets.get(g) ?? 0, planned: planTemplates.length === 0 || pausedDays > 0 ? null : (planned.get(g) ?? 0), range }));

  // Lifts Ben chose.
  const targets = new Map(input.liftTargets.map((t) => [t.exerciseId, t]));
  const lifts: LiftTrend[] = [];
  for (const id of [...new Set(input.lifts)].slice(0, W.maxLifts)) {
    const target = targets.get(id) ?? null;
    const r = liftSeries(scoped, id, sunday, target);
    // A chosen lift with no sets in the window stays, empty (review b3-wave3-ux S3): never dropped without a word.
    lifts.push(r !== null ? { ...r.trend, name: nameIn(sessions, id) } : emptyTrend(id, nameIn(sessions, id), target, input.unit));
  }

  // Stalled: any lift done this week (and the chosen ones) with no new best over its last 3 sessions, the last one this week.
  const stalled: WeeklyFacts['stalled'] = [];
  const doneIds = [...new Set([...thisWeek.flatMap((s) => s.exercises.map((e) => e.exerciseId)), ...input.lifts])];
  for (const id of doneIds) {
    const r = liftSeries(scoped, id, sunday, null);
    if (r === null) continue;
    const lastDate = r.all.at(-1)?.date ?? '';
    if (lastDate < monday) continue;
    if (isStalled(r.all.map((c) => c.value), r.trend.lowerIsBetter)) stalled.push({ exerciseId: id, name: nameIn(sessions, id), sessions: W.stalledSessions });
  }

  // RPE against the sets' own targets: with any target, only the sets that had one are compared, so a set
  // with no target never reads as drift (review b3-wave3-truth B3); with none, the plain mean, no target.
  const rated: { rpe: number; target: number | null; sessionId: string }[] = [];
  for (const s of thisWeek)
    for (const e of s.exercises)
      for (const x of e.sets) if (WORKING.has(x.setType) && x.rpe !== null) rated.push({ rpe: x.rpe, target: x.targetRpe, sessionId: s.sessionId });
  const targeted = rated.filter((x) => x.target !== null);
  const compared = targeted.length > 0 ? targeted : rated;
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rpe =
    compared.length === 0
      ? null
      : {
          sessions: new Set(compared.map((x) => x.sessionId)).size,
          mean: round1(mean(compared.map((x) => x.rpe))),
          target: targeted.length === 0 ? null : Math.round(mean(targeted.map((x) => x.target ?? 0)) * 2) / 2,
        };

  // Runs Ben logged.
  const weekRuns = input.activities.filter((a) => a.status === 'done' && a.kind === 'run' && a.date >= monday && a.date <= sunday);
  const runs = { count: weekRuns.length, distanceM: weekRuns.length > 0 && weekRuns.every((a) => a.distanceM !== null) ? weekRuns.reduce((m, a) => m + (a.distanceM ?? 0), 0) : null };

  const feel = { easy: 0, good: 0, hard: 0 };
  for (const s of thisWeek) if (s.feel !== null) feel[s.feel] += 1;

  return {
    monday,
    complete,
    basis,
    week: current.count,
    days,
    missed,
    missedCount,
    weeks: counted.map((c) => c.count),
    groups,
    lifts,
    runs,
    rpe,
    stalled,
    feel,
    edits: repeatedEdits(input, thisWeek, sessions),
    hasHistory: sessions.length > 0,
    workoutIds: thisWeek.map((s) => s.sessionId),
  };
}

/**
 * (§6.1 feedback loop) The same edit repeated: the newest `repeatedEdit` workouts from a template (the
 * newest this week) all set an exercise up with the same working sets, other than the template's. Never
 * for a pain-flagged exercise (rule 9), never outside 1–8 sets.
 */
function repeatedEdits(input: WeeklyReviewInput, thisWeek: readonly ReviewSession[], sessions: readonly ReviewSession[]): TemplateEdit[] {
  const out: TemplateEdit[] = [];
  const weekIds = new Set(thisWeek.map((s) => s.sessionId));
  for (const t of input.templates) {
    const from = sessions.filter((s) => s.template?.routineId === t.routineId).sort((a, b) => b.startedMs - a.startedMs).slice(0, W.repeatedEdit);
    if (from.length < W.repeatedEdit || !weekIds.has(from[0]?.sessionId ?? '')) continue;
    const seen = new Set<string>();
    for (const e of t.exercises) {
      if (seen.has(e.exerciseId) || input.painFlagged.has(e.exerciseId)) continue;
      seen.add(e.exerciseId);
      const counts = from.map((s) => s.exercises.find((x) => x.exerciseId === e.exerciseId)?.plannedWorking ?? null);
      const k = counts[0];
      if (k == null || counts.some((c) => c !== k) || k === e.workingSets || k < W.setsMin || k > W.setsMax) continue;
      out.push({ routineId: t.routineId, routineName: t.name, expectedVersion: t.version, exerciseId: e.exerciseId, exerciseName: e.name, sessions: from.length, fromSets: e.workingSets, toSets: k });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stored facts (`ReviewFact[]`, code only)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clampInt = (n: number, max: number): number => Math.max(0, Math.min(max, Math.round(n)));

/** The facts as stored on the review (rule 6; the schema's limits). IDs that aren't stored IDs are left out. */
export function weeklyReviewFacts(f: WeeklyFacts): ReviewFact[] {
  const out: ReviewFact[] = [];
  if (f.week.planned !== null) out.push({ kind: 'sessions_vs_plan', done: clampInt(f.week.done, 50), planned: clampInt(f.week.planned, 50) });
  for (const w of f.weeks) out.push({ kind: 'week_sessions', weekMonday: w.monday, done: clampInt(w.done, 50), planned: w.planned === null ? null : clampInt(w.planned, 50), workouts: clampInt(w.workouts, 50), runs: clampInt(w.runs, 50) });
  for (const d of f.days.slice(0, 7)) out.push({ kind: 'week_day', name: d.name.slice(0, 60), done: d.done, localDate: d.date });
  const missedCount = clampInt(f.missedCount, 50);
  out.push({ kind: 'week_status', complete: f.complete, basis: f.basis, missed: missedCount, missedNames: f.missed.slice(0, Math.min(7, missedCount)).map((n) => n.slice(0, 60)) });
  for (const g of f.groups) out.push({ kind: 'group_sets', group: g.group, sets: clampInt(g.sets, 500), planned: g.planned === null ? null : clampInt(g.planned, 500), range: g.range });
  for (const l of f.lifts) {
    if (!UUID.test(l.exerciseId)) continue;
    const points = l.points.filter((p) => UUID.test(p.sessionId)).map((p) => ({ sessionId: p.sessionId, localDate: p.date, load: p.load, reps: clampInt(p.reps, 1000), ...(l.metric === 'e1rm' ? { estimate: p.value } : {}) }));
    out.push({
      kind: 'lift_trend',
      exerciseId: l.exerciseId,
      points,
      target: l.target === null || l.unit === null || l.convention === null ? null : { value: l.target.value, unit: l.unit, convention: l.convention },
      metric: l.metric,
      lowerIsBetter: l.lowerIsBetter,
      targetReps: l.target?.reps ?? null,
      was: l.was,
    });
  }
  for (const s of f.stalled) if (UUID.test(s.exerciseId)) out.push({ kind: 'stalled_lift', exerciseId: s.exerciseId, sessions: s.sessions });
  if (f.rpe !== null) out.push({ kind: 'rpe_drift', exerciseId: null, sessions: Math.max(1, Math.min(20, f.rpe.sessions)), meanRpe: Math.min(10, Math.max(1, f.rpe.mean)), targetRpe: f.rpe.target });
  if (f.runs.count > 0) out.push({ kind: 'runs', count: clampInt(f.runs.count, 50), distanceM: f.runs.distanceM });
  if (f.feel.easy + f.feel.good + f.feel.hard > 0) out.push({ kind: 'feel', easy: f.feel.easy, good: f.feel.good, hard: f.feel.hard });
  for (const e of f.edits) if (UUID.test(e.routineId) && UUID.test(e.exerciseId)) out.push({ kind: 'template_edit', routineId: e.routineId, exerciseId: e.exerciseId, sessions: Math.min(20, Math.max(2, e.sessions)), fromSets: clampInt(e.fromSets, 30), toSets: clampInt(e.toSets, 30) });
  return out.slice(0, 60);
}

/** Whether there is anything to review for the week: a workout, a run, or a plan or aim to count against. */
export function weeklyReviewWorthwhile(f: WeeklyFacts): boolean {
  return f.hasHistory && (f.week.workouts > 0 || f.runs.count > 0 || f.week.planned !== null);
}

