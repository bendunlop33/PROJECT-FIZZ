import type { Load, MuscleGroup, SessionAggregate, SessionExercise, SplitBodyPart, WorkoutSet } from '@fizz/schemas';
import { addDays, localDateOf, localWeekBounds, weekdayIndexOfDate } from '../calendar';
import { aimWithPause, assignPlanWeek, type PlanDayKey, type PlanWeekMerge } from '../session/plan-adapt';
import { formatDuration, loadText, repRangeText } from '../display';
import { loadDirection } from '../equipment';
import { toMs } from '../time';
import { partRootOf } from '../session/gym-switch';

/**
 * The plan tracker, first version (Ben, 19 Oct: "an option to check
 * progress vs plan"; research: plans-and-plan-progress.md proposals 1–3).
 * Pure. Numbers only from what was planned and logged: no scores, no
 * colour-only states, no projected e1RM. Lifting is a rotation, not dates,
 * so nothing is ever called missed (D19).
 *
 * - `plannedVsDone`: per exercise of a finished workout, sets done of
 *   planned, the reps (or times) done against the target, and one word:
 *   `Hit`, `Short` or `Over`.
 * - `consistency`: the last 8 weeks' training days against Ben's
 *   days-a-week aim (none set: workouts per week only), and with a plan, the plan days done
 *   this week.
 * - `exerciseTargetHistory`: per session of one exercise, target against
 *   actual, and `Targets hit 5 of last 6`.
 */

export type PlanVerdict = 'hit' | 'short' | 'over';

/** One word, always shown with the numbers (never colour alone). */
export const PLAN_VERDICT_WORD: Readonly<Record<PlanVerdict, string>> = { hit: 'Hit', short: 'Short', over: 'Over' };

export interface PlannedVsDoneRow {
  sessionExerciseId: string;
  exerciseId: string;
  name: string;
  plannedSets: number;
  doneSets: number;
  /** Reps (or times) done, in set order: `8`, `0:45`. */
  done: string[];
  /** The target: `8`, `8–10`, `0:45`; null when the plan set none (load only). */
  target: string | null;
  verdict: PlanVerdict;
  /** `3/3 sets · 8, 8, 7 of 8`; `· 100 kg planned` after it when the load set the verdict. */
  text: string;
  /**
   * (Design pass, 20 Oct) The Summary's one plan line, the reps already shown above it:
   * `3/3 · of 8`, `3/3 · of 8 · 100 kg planned`, `2/3 · of 8–10 · 1 skipped`.
   */
  short: string;
  /**
   * The planned load when a set's load (not its reps) set the verdict: lighter is `Short`,
   * heavier `Over`. `100 kg`, `22.5 kg each`; null otherwise. Shown so a `Short` with every rep
   * hit isn't a contradiction (review: summary consistency).
   */
  plannedLoad: string | null;
}

export interface PlannedVsDone {
  rows: PlannedVsDoneRow[];
  plannedSets: number;
  doneSets: number;
  /** `14/15 planned sets`. */
  header: string;
  /**
   * (Progress v3) The reps behind This week's `Mon – 92%`: `156 of 170 planned reps`, and what was short or
   * skipped (`Short: Row · Skipped: Curl`), because sets added in the workout can lift the % past a skipped
   * one. Null: nothing planned in reps.
   */
  reps: { planned: number; done: number; text: string; short: string | null } | null;
}

/**
 * (Progress v3, Ben 21 Oct) Reps a finished workout planned and did. Planned: each planned working set's
 * target reps (a single target, stored as min = max, or the low end of a range; there is no other stored
 * single target), warm-ups, other-side companions, sets added in the workout and sets taken out before
 * Start left out; skipped planned sets still count (they score 0). Done: reps of every completed working
 * set, added ones included, a companion not counted twice. Planned null: nothing planned in reps.
 */
export function plannedRepsOf(a: Pick<SessionAggregate, 'sets'>): { planned: number | null; done: number } {
  let planned = 0;
  let any = false;
  let done = 0;
  for (const s of a.sets) {
    if (!isWorking(s)) continue;
    if (s.skippedBy !== 'before_start' && s.planned.addedInWorkout !== true && s.planned.reps !== null) {
      planned += s.planned.reps.min;
      any = true;
    }
    if (s.status === 'completed' && s.actual?.reps != null && s.actual.reps > 0) done += s.actual.reps;
  }
  return { planned: any ? planned : null, done };
}

/** A working set that is one prescribed set (warm-ups, tombstones and other-side companions aren't). */
function isWorking(s: WorkoutSet): boolean {
  return s.setType !== 'warmup' && s.status !== 'deleted' && s.pairedWithSetId === null;
}

/**
 * Part of today's plan: a target of its own, not taken out before the start (`Skip today`), and not a set Ben
 * added during the workout (it copies a planned set's target, but it's done beyond the plan: review S1).
 */
function isPlanned(s: WorkoutSet): boolean {
  return (s.planned.reps !== null || s.planned.durationS !== null) && s.skippedBy !== 'before_start' && s.planned.addedInWorkout !== true;
}

const EPS = 1e-6;

/** The load against the plan: lighter (or more assisted) is short, heavier is over; different units aren't compared. */
function loadVerdict(planned: Load | null, actual: Load | null | undefined): PlanVerdict {
  if (planned === null || actual == null || planned.unit !== actual.unit || planned.convention !== actual.convention) return 'hit';
  const d = actual.value - planned.value;
  if (Math.abs(d) < EPS) return 'hit';
  const easier = loadDirection(planned.convention) === 'assistance' ? d > 0 : d < 0;
  return easier ? 'short' : 'over';
}

function setVerdict(s: WorkoutSet): PlanVerdict {
  if (s.status !== 'completed' || s.actual === null) return 'short';
  const p = s.planned;
  const a = s.actual;
  let v: PlanVerdict = 'hit';
  if (p.reps !== null) {
    const reps = a.reps ?? 0;
    if (reps < p.reps.min) return 'short';
    if (reps > p.reps.max) v = 'over';
  } else if (p.durationS !== null) {
    const d = a.durationS ?? 0;
    if (d < p.durationS) return 'short';
    if (d > p.durationS) v = 'over';
  }
  const l = loadVerdict(p.load, a.load);
  if (l === 'short') return 'short';
  return l === 'over' ? 'over' : v;
}

/** The verdict over sets: any short is `Short`; else any over (or more sets than planned) is `Over`; else `Hit`. */
function combine(verdicts: readonly PlanVerdict[], extraDone: boolean): PlanVerdict {
  if (verdicts.includes('short')) return 'short';
  if (verdicts.includes('over') || extraDone) return 'over';
  return 'hit';
}

function doneText(s: WorkoutSet, ex: Pick<SessionExercise, 'measurement'>): string | null {
  if (s.actual === null) return null;
  if (ex.measurement === 'duration' || (s.actual.reps === null && s.actual.durationS !== null)) return s.actual.durationS === null ? null : formatDuration(s.actual.durationS);
  return s.actual.reps === null ? null : String(s.actual.reps);
}

/** The most common planned target among the sets (`8–10`, `0:45`). */
function targetText(sets: readonly WorkoutSet[]): string | null {
  const counts = new Map<string, number>();
  for (const s of sets) {
    const t = s.planned.reps !== null ? repRangeText(s.planned.reps) : s.planned.durationS !== null ? formatDuration(s.planned.durationS) : null;
    if (t !== null) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [t, c] of counts) if (c > n) [best, n] = [t, c];
  return best;
}

/** One exercise's sets against its plan, or null when nothing on it was planned. */
export function exercisePlanRow(ex: SessionExercise, sets: readonly WorkoutSet[]): PlannedVsDoneRow | null {
  const work = sets.filter((s) => s.sessionExerciseId === ex.id && isWorking(s)).sort((a, b) => a.index - b.index);
  const planned = work.filter(isPlanned);
  if (planned.length === 0) return null;
  const done = work.filter((s) => s.status === 'completed' && s.actual !== null);
  const skipped = work.filter((s) => s.status === 'skipped').length;
  const doneTexts = done.map((s) => doneText(s, ex)).filter((t): t is string => t !== null);
  const verdict = combine(planned.map(setVerdict), done.length > planned.length);
  const target = targetText(planned);
  const results = doneTexts.length === 0 ? '—' : doneTexts.join(', ');
  const plannedLoad = loadSetVerdict(planned, verdict);
  const loadPart = plannedLoad === null ? '' : ` · ${plannedLoad} planned`;
  const count = `${String(done.length)}/${String(planned.length)}`;
  const short = [count, target === null ? null : `of ${target}`, plannedLoad === null ? null : `${plannedLoad} planned`, skipped > 0 ? `${String(skipped)} skipped` : null].filter((x): x is string => x !== null).join(' · ');
  return {
    sessionExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    name: ex.exerciseName,
    plannedSets: planned.length,
    doneSets: done.length,
    done: doneTexts,
    target,
    verdict,
    text: `${count} sets · ${results}${target === null ? '' : ` of ${target}`}${loadPart}`,
    short,
    plannedLoad,
  };
}

/**
 * The planned load to show when the load, not the reps, gave the verdict: the first done set whose
 * reps met the plan but whose load was lighter (`Short`) or heavier (`Over`) than planned. Null otherwise.
 */
function loadSetVerdict(planned: readonly WorkoutSet[], verdict: PlanVerdict): string | null {
  if (verdict === 'hit') return null;
  for (const s of planned) {
    if (s.status !== 'completed' || s.actual === null || s.planned.load === null) continue;
    if (repsVerdict(s) === 'short') continue;
    const l = loadVerdict(s.planned.load, s.actual.load);
    if (l === verdict) return loadText(s.planned.load, s.planned.load.convention);
  }
  return null;
}

/** The reps (or time) alone against the plan. */
function repsVerdict(s: WorkoutSet): PlanVerdict {
  const p = s.planned;
  const a = s.actual;
  if (a === null) return 'short';
  if (p.reps !== null) {
    const reps = a.reps ?? 0;
    return reps < p.reps.min ? 'short' : reps > p.reps.max ? 'over' : 'hit';
  }
  if (p.durationS !== null) {
    const d = a.durationS ?? 0;
    return d < p.durationS ? 'short' : d > p.durationS ? 'over' : 'hit';
  }
  return 'hit';
}

/**
 * `Plan vs done` on the Summary (research proposal 1): one row per
 * exercise that had a plan, in workout order. Null when nothing was
 * planned (an empty start, or a FitNotes import).
 */
export function plannedVsDone(a: Pick<SessionAggregate, 'exercises' | 'sets'>): PlannedVsDone | null {
  const rows = [...a.exercises]
    .filter((e) => e.removed === undefined)
    .sort((x, y) => x.order - y.order)
    .flatMap((e) => {
      const r = exercisePlanRow(e, a.sets);
      return r === null ? [] : [r];
    });
  if (rows.length === 0) return null;
  const plannedSets = rows.reduce((n, r) => n + r.plannedSets, 0);
  const doneSets = rows.reduce((n, r) => n + Math.min(r.doneSets, r.plannedSets), 0);
  const r = plannedRepsOf(a);
  const skipped = rows.filter((x) => x.doneSets === 0).map((x) => x.name);
  const short = rows.filter((x) => x.verdict === 'short' && x.doneSets > 0).map((x) => x.name);
  const shortText = [short.length > 0 ? `Short: ${short.join(', ')}` : null, skipped.length > 0 ? `Skipped: ${skipped.join(', ')}` : null].filter((x): x is string => x !== null).join(' · ');
  const reps = r.planned === null || r.planned <= 0 ? null : { planned: r.planned, done: r.done, text: `${String(r.done)} of ${String(r.planned)} planned reps`, short: shortText === '' ? null : shortText };
  return { rows, plannedSets, doneSets, header: `${String(doneSets)}/${String(plannedSets)} planned sets`, reps };
}

// ---------------------------------------------------------------------------
// Consistency (research proposal 2)

export const CONSISTENCY_WEEKS = 8;

export interface ConsistencyWorkout {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  /** (20 Oct) Working sets per muscle group, for the plan's days done this week; absent: only plan workouts count. */
  groups?: ReadonlyMap<MuscleGroup, number> | undefined;
}

export interface ConsistencyWeek {
  /** Local Monday, `YYYY-MM-DD`. */
  monday: string;
  /** (20 Oct) This week's aim with its paused plan days left out (`aimWithPause`); null with no aim, or every day paused. */
  aim: number | null;
  /** Days of it the plan was paused (0–7). */
  pausedDays: number;
  workouts: number;
  /**
   * Distinct local dates trained: what the days-a-week aim is measured in
   * (two workouts on one day are one day; review plans-19oct S2).
   */
  days: number;
  /** `2/3` (days of the aim) with an aim, else `2` (workouts). */
  text: string;
  /** Null with no aim. */
  atAim: boolean | null;
}

export interface ConsistencyView {
  /** The last 8 full weeks, oldest first. */
  weeks: ConsistencyWeek[];
  thisWeek: ConsistencyWeek;
  aim: number | null;
  /** `Weeks at your aim: 5 of 8`; null with no aim. */
  atAimText: string | null;
  /** With an applied plan: distinct plan days done this week, `3 of 4`. */
  planThisWeek: { done: number; of: number; text: string } | null;
}

export interface ConsistencyInput {
  /** Finished workouts in history (any source), any order. */
  workouts: readonly ConsistencyWorkout[];
  nowMs: number;
  tz: string;
  /** Profile's `Days a week you lift`; null: not set. */
  aim: number | null;
  /** The applied plan's live days (their workout IDs and the finished workouts saved from them), and when it was applied. */
  plan: { days: readonly PlanWeekDay[]; appliedAtUtc: string; /** (28 Oct) Set days: each template's weekday (a mid-week start expects fewer). */ weekdays?: ReadonlyMap<string, number> | null | undefined } | null;
  /**
   * (Ben, 20 Oct) Local dates the plan was paused (`pausedDates`; a running pause's coming days
   * included): they don't count against the aim. Absent: none.
   */
  pausedDates?: ReadonlySet<string>;
}

export interface PlanWeekDay {
  routineId: string;
  createdFromSessionId?: string | null | undefined;
  /** (20 Oct) The day's body parts (`planDayBodyParts`): an off-plan workout that mainly trained them counts it done. */
  bodyParts?: readonly SplitBodyPart[] | undefined;
  /** (28 Oct) Its name, main lift and plan day: variants (Pull A / Pull B) are told apart by the main lift led with. */
  name?: string | undefined;
  mainLiftExerciseId?: string | null | undefined;
  planKey?: PlanDayKey | null | undefined;
  /** (Ben, 30 Oct) Set days: its scheduled weekday (Mon = 0); a variant done on its own weekday is that one. */
  weekday?: number | null | undefined;
}

export interface PlanWeekWorkout {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  /** (20 Oct) Working sets per muscle group; absent: only a plan workout counts. */
  groups?: ReadonlyMap<MuscleGroup, number> | undefined;
  /** (28 Oct) The plan day it was started as (`WorkoutSession.planDay`); absent on older workouts. */
  planDay?: (PlanDayKey & { templateRoutineId?: string | null | undefined }) | null | undefined;
  /** (28 Oct) The lift it led with (`leadLiftOf`); absent: unknown. */
  leadExerciseId?: string | null | undefined;
  /** (28 Oct) Matched by name to variants its lifts don't tell apart (`linkedVariants`): their templates in plan order. */
  variants?: readonly string[] | null | undefined;
}

/** The finished workout is that plan day's: started from its workout (or the workout it was saved from). */
export function dayOf<D extends PlanWeekDay>(days: readonly D[], w: Pick<PlanWeekWorkout, 'sessionId' | 'routineId'>): D | undefined {
  return days.find((d) => d.routineId === w.routineId || (d.createdFromSessionId != null && d.createdFromSessionId === w.sessionId));
}

/**
 * The instant this week's plan count starts: Monday 00:00 local. (Ben, 28 Oct) In the week the plan was applied too:
 * that week's workouts before Apply count by the same rules (a plan day matched by name, lifts or muscles), so a plan
 * started mid-week sees what was already done that week. `appliedAtUtc` is kept for callers; it no longer moves it.
 */
export function planWeekStartMs(input: { appliedAtUtc?: string; nowMs: number; tz: string }): number {
  return localWeekBounds(input.nowMs, input.tz).startMs;
}

/**
 * The plan days done this week (Monday 00:00 local up to now): per day, the time of the workout that did it.
 * (Ben, 28 Oct) One to one (`assignPlanWeek`): a workout fills at most one plan day and a plan day takes at most
 * one workout, so one leg workout never ticks both Legs and Legs B. A plan workout fills its own day; a workout
 * matched by name to variants it doesn't tell apart fills the first free one; any other workout fills one of the
 * days it mainly trained by muscles done (the split rule's threshold, Ben 20 Oct), by the main lift it led with,
 * else plan order. The Progress consistency card's `3 of 4` counts the same.
 */
export function planDaysDoneThisWeek(input: { days: readonly PlanWeekDay[]; appliedAtUtc: string; workouts: readonly PlanWeekWorkout[]; nowMs: number; tz: string; merges?: readonly PlanWeekMerge[] | undefined }): Map<string, string> {
  const done = new Map<string, string>();
  for (const [id, w] of planWeekFills(input)) done.set(id, w.startedAtUtc);
  return done;
}

/** `planDaysDoneThisWeek` with the workout that filled each plan day's template (its session ID too). */
export function planWeekFills<W extends PlanWeekWorkout>(input: { days: readonly PlanWeekDay[]; workouts: readonly W[]; nowMs: number; tz: string; merges?: readonly PlanWeekMerge[] | undefined }): Map<string, W> {
  const from = planWeekStartMs(input);
  const days = input.days.map((d) => ({ routineId: d.routineId, name: d.name ?? d.routineId, bodyParts: d.bodyParts ?? [], createdFromSessionId: d.createdFromSessionId ?? null, mainLiftExerciseId: d.mainLiftExerciseId ?? null, planKey: d.planKey ?? null, weekday: d.weekday ?? null }));
  const week = input.workouts
    .filter((w) => {
      const ms = toMs(w.startedAtUtc);
      return ms >= from && ms <= input.nowMs;
    })
    .map((w) => ({ sessionId: w.sessionId, routineId: w.routineId, startedAtUtc: w.startedAtUtc, groups: w.groups ?? new Map<MuscleGroup, number>(), planDay: w.planDay ?? null, leadExerciseId: w.leadExerciseId ?? null, variants: w.variants ?? null, weekday: weekdayIndexOfDate(localDateOf(toMs(w.startedAtUtc), input.tz)), source: w }));
  const out = new Map<string, W>();
  for (const [id, w] of assignPlanWeek(days, week, input.merges ?? [])) out.set(id, w.source);
  return out;
}

/**
 * (Ben, 28 Oct) A plan started partway through a week expects only the plan days still possible from its start that
 * week, plus the ones already done (`done`): on Set days, the days not done whose weekday is on or after the start's;
 * on Any days, as many of the days not done as there are dates from the start to Sunday. Null: not the plan's first
 * week, or it started on its Monday (the whole week is expected).
 */
export function planFirstWeekExpected(input: { appliedLocalDate: string; monday: string; done: number; notDone: readonly { weekday: number | null }[] }): number | null {
  if (input.appliedLocalDate <= input.monday || input.appliedLocalDate > addDays(input.monday, 6)) return null;
  let from = 0;
  while (from < 7 && addDays(input.monday, from) < input.appliedLocalDate) from += 1;
  const setDays = input.notDone.length > 0 && input.notDone.every((d) => d.weekday !== null);
  const possible = setDays ? input.notDone.filter((d) => (d.weekday ?? -1) >= from).length : Math.min(input.notDone.length, 7 - from);
  return input.done + possible;
}

/** `planFirstWeekExpected` for this week of a plan: its days (`weekdays`: each template's Set days weekday; absent: Any days). */
export function planWeekExpectedNow(input: { days: readonly Pick<PlanWeekDay, 'routineId'>[]; done: ReadonlyMap<string, string>; appliedAtUtc: string; nowMs: number; tz: string; weekdays?: ReadonlyMap<string, number> | null | undefined }): number | null {
  const monday = localWeekBounds(input.nowMs, input.tz).mondayLocalDate;
  const notDone = input.days.filter((d) => !input.done.has(d.routineId)).map((d) => ({ weekday: input.weekdays?.get(d.routineId) ?? null }));
  return planFirstWeekExpected({ appliedLocalDate: localDateOf(toMs(input.appliedAtUtc), input.tz), monday, done: input.done.size, notDone });
}

/** This week's plan days against the plan, its paused days left out: `of` is never below `done`. */
export function planWeekOf(daysInPlan: number, done: number, pausedDays: number): number {
  return Math.max(done, aimWithPause(daysInPlan, pausedDays));
}

/** Of the 7 local dates from `monday`, how many are in `paused`. */
export function pausedInWeek(monday: string, paused: ReadonlySet<string> | undefined): number {
  if (paused === undefined || paused.size === 0) return 0;
  let n = 0;
  for (let i = 0; i < 7; i += 1) if (paused.has(addDays(monday, i))) n += 1;
  return n;
}

function weekOf(monday: string, workouts: number, days: number, aim: number | null, pausedDays = 0): ConsistencyWeek {
  // (Ben, 20 Oct) Paused days don't count against the aim: a fully paused week isn't judged.
  const weekAim = aim === null ? null : aimWithPause(aim, pausedDays);
  const judged = weekAim !== null && weekAim > 0;
  return {
    monday,
    aim: judged ? weekAim : null,
    pausedDays,
    workouts,
    days,
    text: aim === null ? String(workouts) : judged ? `${String(days)}/${String(weekAim)}` : String(days),
    atAim: aim === null || !judged ? null : days >= weekAim,
  };
}

/**
 * `Consistency` on Progress: per local Monday–Sunday week for the last 8
 * full weeks and this week so far, the days trained against the
 * days-a-week aim (with none, workouts per week). With a plan,
 * how many of its days were done this week (since Apply). Counts only.
 */
export function consistency(input: ConsistencyInput): ConsistencyView {
  const { mondayLocalDate } = localWeekBounds(input.nowMs, input.tz);
  const mondays = Array.from({ length: CONSISTENCY_WEEKS }, (_, i) => addDays(mondayLocalDate, -7 * (CONSISTENCY_WEEKS - i)));
  const counts = new Map<string, number>();
  const dates = new Map<string, Set<string>>();
  for (const w of input.workouts) {
    const ms = toMs(w.startedAtUtc);
    if (ms > input.nowMs) continue;
    const monday = localWeekBounds(ms, input.tz).mondayLocalDate;
    counts.set(monday, (counts.get(monday) ?? 0) + 1);
    dates.set(monday, (dates.get(monday) ?? new Set<string>()).add(localDateOf(ms, input.tz)));
  }
  const weekFor = (m: string) => weekOf(m, counts.get(m) ?? 0, dates.get(m)?.size ?? 0, input.aim, pausedInWeek(m, input.pausedDates));
  const weeks = mondays.map(weekFor);
  const thisWeek = weekFor(mondayLocalDate);
  const atAim = weeks.filter((w) => w.atAim === true).length;
  const judged = weeks.filter((w) => w.atAim !== null).length;
  let planThisWeek: ConsistencyView['planThisWeek'] = null;
  const plan = input.plan;
  if (plan !== null && plan.days.length > 0) {
    // The same count as Library › Your plan's `Days this week` (planDaysDoneThisWeek, planWeekOf).
    const done = planDaysDoneThisWeek({ days: plan.days, appliedAtUtc: plan.appliedAtUtc, workouts: input.workouts, nowMs: input.nowMs, tz: input.tz });
    const expected = planWeekExpectedNow({ days: plan.days, done, appliedAtUtc: plan.appliedAtUtc, nowMs: input.nowMs, tz: input.tz, weekdays: plan.weekdays });
    const of = planWeekOf(Math.min(plan.days.length, expected ?? plan.days.length), done.size, thisWeek.pausedDays);
    planThisWeek = { done: done.size, of, text: `${String(done.size)} of ${String(of)}` };
  }
  return { weeks, thisWeek, aim: input.aim, atAimText: input.aim === null ? null : `Weeks at your aim: ${String(atAim)} of ${String(judged)}`, planThisWeek };
}

// ---------------------------------------------------------------------------
// Targets hit per exercise (research proposal 3)

export const TARGETS_HIT_WINDOW = 6;

export interface ExerciseTargetRow {
  sessionId: string;
  /** The row (its first part after a gym switch): one entry per copy when the exercise was done twice (review S1). */
  sessionExerciseId: string;
  startedAtUtc: string;
  tz: string;
  /** `3 × 8–10`; null with no target that day. */
  target: string | null;
  /** `8, 8, 7`. */
  actual: string;
  verdict: PlanVerdict | null;
}

export interface ExerciseTargetHistory {
  /** Newest first. */
  rows: ExerciseTargetRow[];
  /** `Targets hit 5 of last 6`: Hit or Over; sessions with no target don't count. Null when none had one. */
  hitText: string | null;
  hit: number;
  of: number;
}

/**
 * One exercise's target against actual per finished workout (newest
 * first; one row per copy when it was done twice that day), from the sets as planned and logged. A workout with no plan for
 * it (a FitNotes import, an exercise added with no target) shows what was
 * done with no verdict and doesn't count.
 */
export function exerciseTargetHistory(sessions: readonly Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>[], exerciseId: string, limit = 20): ExerciseTargetHistory {
  const newest = [...sessions].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
  const rows: ExerciseTargetRow[] = [];
  for (const a of newest) {
    const live = a.exercises.filter((e) => e.exerciseId === exerciseId && e.removed === undefined).sort((x, y) => x.order - y.order);
    // (Review S1) Each copy of the exercise (the same one twice, 19 Oct) is its own row; parts of
    // one exercise split across gyms stay one row.
    const roots = live.filter((e) => partRootOf(a.exercises, e.id) === e.id);
    for (const root of roots) {
      const parts = live.filter((e) => partRootOf(a.exercises, e.id) === root.id);
      const planRows = parts.map((p) => exercisePlanRow(p, a.sets)).filter((r): r is PlannedVsDoneRow => r !== null);
      const done = parts.flatMap((p) =>
        a.sets
          .filter((s) => s.sessionExerciseId === p.id && isWorking(s) && s.status === 'completed' && s.actual !== null)
          .sort((x, y) => x.index - y.index)
          .map((s) => doneText(s, p))
          .filter((t): t is string => t !== null),
      );
      if (done.length === 0 && planRows.length === 0) continue;
      const planned = planRows.reduce((n, r) => n + r.plannedSets, 0);
      const first = planRows[0];
      rows.push({
        sessionId: a.session.id,
        sessionExerciseId: root.id,
        startedAtUtc: a.session.startedAt.utc,
        tz: a.session.startedAt.tz,
        target: first === undefined ? null : `${String(planned)} × ${first.target ?? '—'}`,
        actual: done.length === 0 ? '—' : done.join(', '),
        verdict: planRows.length === 0 ? null : combine(planRows.map((r) => r.verdict), false),
      });
    }
    if (rows.length >= limit) break;
  }
  const judged = rows.filter((r) => r.verdict !== null).slice(0, TARGETS_HIT_WINDOW);
  const hit = judged.filter((r) => r.verdict !== 'short').length;
  return { rows, hit, of: judged.length, hitText: judged.length === 0 ? null : `Targets hit ${String(hit)} of last ${String(judged.length)}` };
}
