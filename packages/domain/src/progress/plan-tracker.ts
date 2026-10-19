import type { Load, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { addDays, localDateOf, localWeekBounds } from '../calendar';
import { formatDuration, repRangeText } from '../display';
import { loadDirection } from '../equipment';
import { toMs } from '../time';

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
  /** `3/3 sets · 8, 8, 7 of 8`. */
  text: string;
}

export interface PlannedVsDone {
  rows: PlannedVsDoneRow[];
  plannedSets: number;
  doneSets: number;
  /** `14/15 planned sets`. */
  header: string;
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
  const doneTexts = done.map((s) => doneText(s, ex)).filter((t): t is string => t !== null);
  const verdict = combine(planned.map(setVerdict), done.length > planned.length);
  const target = targetText(planned);
  const results = doneTexts.length === 0 ? '—' : doneTexts.join(', ');
  return {
    sessionExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    name: ex.exerciseName,
    plannedSets: planned.length,
    doneSets: done.length,
    done: doneTexts,
    target,
    verdict,
    text: `${String(done.length)}/${String(planned.length)} sets · ${results}${target === null ? '' : ` of ${target}`}`,
  };
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
  return { rows, plannedSets, doneSets, header: `${String(doneSets)}/${String(plannedSets)} planned sets` };
}

// ---------------------------------------------------------------------------
// Consistency (research proposal 2)

export const CONSISTENCY_WEEKS = 8;

export interface ConsistencyWorkout {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
}

export interface ConsistencyWeek {
  /** Local Monday, `YYYY-MM-DD`. */
  monday: string;
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
  plan: { days: readonly { routineId: string; createdFromSessionId?: string | null | undefined }[]; appliedAtUtc: string } | null;
}

function weekOf(monday: string, workouts: number, days: number, aim: number | null): ConsistencyWeek {
  return { monday, workouts, days, text: aim === null ? String(workouts) : `${String(days)}/${String(aim)}`, atAim: aim === null ? null : days >= aim };
}

/**
 * `Consistency` on Progress: per local Monday–Sunday week for the last 8
 * full weeks and this week so far, the days trained against the
 * days-a-week aim (with none, workouts per week). With a plan,
 * how many of its days were done this week (since Apply). Counts only.
 */
export function consistency(input: ConsistencyInput): ConsistencyView {
  const { startMs: thisStart, mondayLocalDate } = localWeekBounds(input.nowMs, input.tz);
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
  const weekFor = (m: string) => weekOf(m, counts.get(m) ?? 0, dates.get(m)?.size ?? 0, input.aim);
  const weeks = mondays.map(weekFor);
  const thisWeek = weekFor(mondayLocalDate);
  const atAim = weeks.filter((w) => w.atAim === true).length;
  let planThisWeek: ConsistencyView['planThisWeek'] = null;
  const plan = input.plan;
  if (plan !== null && plan.days.length > 0) {
    const from = Math.max(thisStart, toMs(plan.appliedAtUtc));
    const done = new Set<string>();
    for (const w of input.workouts) {
      const ms = toMs(w.startedAtUtc);
      if (ms < from || ms > input.nowMs) continue;
      const day = plan.days.find((d) => d.routineId === w.routineId || (d.createdFromSessionId != null && d.createdFromSessionId === w.sessionId));
      if (day !== undefined) done.add(day.routineId);
    }
    planThisWeek = { done: done.size, of: plan.days.length, text: `${String(done.size)} of ${String(plan.days.length)}` };
  }
  return { weeks, thisWeek, aim: input.aim, atAimText: input.aim === null ? null : `Weeks at your aim: ${String(atAim)} of ${String(weeks.length)}`, planThisWeek };
}

// ---------------------------------------------------------------------------
// Targets hit per exercise (research proposal 3)

export const TARGETS_HIT_WINDOW = 6;

export interface ExerciseTargetRow {
  sessionId: string;
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
 * first), from the sets as planned and logged. A workout with no plan for
 * it (a FitNotes import, an exercise added with no target) shows what was
 * done with no verdict and doesn't count.
 */
export function exerciseTargetHistory(sessions: readonly Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>[], exerciseId: string, limit = 20): ExerciseTargetHistory {
  const newest = [...sessions].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
  const rows: ExerciseTargetRow[] = [];
  for (const a of newest) {
    const parts = a.exercises.filter((e) => e.exerciseId === exerciseId && e.removed === undefined).sort((x, y) => x.order - y.order);
    if (parts.length === 0) continue;
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
      startedAtUtc: a.session.startedAt.utc,
      tz: a.session.startedAt.tz,
      target: first === undefined ? null : `${String(planned)} × ${first.target ?? '—'}`,
      actual: done.length === 0 ? '—' : done.join(', '),
      verdict: planRows.length === 0 ? null : combine(planRows.map((r) => r.verdict), false),
    });
    if (rows.length >= limit) break;
  }
  const judged = rows.filter((r) => r.verdict !== null).slice(0, TARGETS_HIT_WINDOW);
  const hit = judged.filter((r) => r.verdict !== 'short').length;
  return { rows, hit, of: judged.length, hitText: judged.length === 0 ? null : `Targets hit ${String(hit)} of last ${String(judged.length)}` };
}
