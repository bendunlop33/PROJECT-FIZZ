import { builderGroupOfMuscleGroup, type LiftTarget, type LoadConvention, type ReviewProposal, type SetType, type TrainingReview, type WeightUnit } from '@fizz/schemas';
import { addDays, daysBetween, localMidnightUtcMs, weekdayIndexOfDate } from '../calendar';
import { formatNumber, NBSP } from '../display';
import { e1rmConventionAllowed, roundEstimate } from '../progress/e1rm';
import { longDate, shortDate } from '../progress/exercise-view';
import { pausedInWeek } from '../progress/plan-tracker';
import { convertMass } from '../units';
import { liftUnitText, verdictOf, weekRangeText } from './views';
import { leadMuscleGroup, reviewWeekCount, type ReviewSession, type WeeklyReviewInput } from './weekly';

/**
 * Progress v3 (agreed with Ben, 21 Oct; `docs/design/progress-goals.md` "Progress v3 (agreed)", prototype
 * `progress-simple.html`). One page for every goal (the goal shapes the coach, not the page):
 * This week → Lifts → Muscles → Coach's changes. Pure view models: screens lay them out and compute
 * nothing. Every number is from stored records (rule 6); an estimated point is flagged and drawn hollow;
 * the `at this rate` date is labelled an estimate and shown only under the agreed conditions. Copy is
 * minimal (values and actions). Every visual carries a VoiceOver summary.
 */

export const PROGRESS_COPY = {
  thisWeek: 'This week',
  sessions: 'Sessions',
  showWeeks: 'Last 4 weeks ▾',
  hideWeeks: 'Hide past weeks ▴',
  progress: 'Progress',
  last8: 'last 8 weeks',
  lifts: 'Lifts',
  topSet: 'Top set',
  est: '○ est.',
  estWord: 'est.',
  edit: 'Edit',
  allLifts: 'All lifts',
  accessories: 'Accessories',
  onTrack: 'On track',
  muscles: 'Muscles',
  atPlan: 'At plan',
  under: 'Under',
  plan: '┄ Plan',
  liftHead: ['Lift', 'Reps', 'Current', 'Target'],
  muscleHead: ['Muscle', 'Sets vs plan', 'Last week'],
  changes: 'Coach’s changes',
  forNextWeek: 'for next week',
  new: 'NEW',
  coach: 'Coach',
  gotIt: 'Got it',
  pastWeeks: 'Past weeks ›',
  undo: 'Undo',
  redo: 'Redo',
  undone: 'Undone',
  skipped: 'Skipped',
  apply: 'Apply',
  keep: 'Keep as is',
  outOfDate: 'Out of date',
  missed: 'missed',
  toDo: 'to do',
  paused: 'paused',
  pausedWeek: 'Paused',
} as const;

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WORKING: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);
const plain = (t: string): string => t.replaceAll(NBSP, ' ');
const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;
const inWeek = (date: string, monday: string): boolean => date >= monday && date <= addDays(monday, 6);

// ---------------------------------------------------------------------------
// This week

export type WeekChipState = 'done' | 'missed' | 'upcoming' | 'paused';

export interface WeekChipView {
  key: string;
  /** The plan day's name, spelled out (`Shoulders`). */
  name: string;
  /** `Mon – 100%` (one line: no-break spaces), `missed`, `to do`, `paused`. */
  line: string;
  state: WeekChipState;
  /** Tap → that workout's Summary; null when not done. */
  sessionId: string | null;
  accessibilityLabel: string;
}

export type WeekSquare = 'done' | 'missed' | 'paused';

export interface PastWeekRowView {
  key: string;
  monday: string;
  /** `6 Oct`. */
  week: string;
  /** One per planned session, in plan order. */
  squares: WeekSquare[];
  /** `3 of 4`, `Paused`, or the workouts with no plan or aim (`2`). */
  right: string;
  /** That week's stored review (tap opens it); null with none. */
  reviewId: string | null;
  accessibilityLabel: string;
}

export interface ThisWeekView {
  /** `13–19 Oct`. */
  range: string;
  /** `3 of 4`, `Paused`, or `2` with no plan or aim. */
  sessions: string;
  /** `2 runs`; null with none. */
  runs: string | null;
  chips: WeekChipView[];
  /** The last 4 weeks, newest first. */
  past: PastWeekRowView[];
  /** VoiceOver for the chip strip. */
  accessibilityLabel: string;
  /** No plan, no aim and nothing logged in 5 weeks: the card isn't shown. */
  empty: boolean;
}

/** Working reps done as a % of the reps planned (can go over 100: extra sets count); null with nothing planned in reps. */
export function percentOfPlan(s: Pick<ReviewSession, 'plannedReps' | 'doneReps'>): number | null {
  if (s.plannedReps === null || s.plannedReps <= 0) return null;
  return Math.round((s.doneReps / s.plannedReps) * 100);
}

function doneChip(key: string, name: string, s: ReviewSession | undefined): WeekChipView {
  if (s === undefined) return { key, name, line: '', state: 'done', sessionId: null, accessibilityLabel: `${name}, done` };
  const d = weekdayIndexOfDate(s.date);
  const pct = percentOfPlan(s);
  const day = DAY[d] ?? '';
  return {
    key,
    name,
    line: pct === null ? day : `${day}${NBSP}–${NBSP}${String(pct)}%`,
    state: 'done',
    sessionId: s.sessionId,
    accessibilityLabel: `${name}, done ${DAY_LONG[d] ?? ''}${pct === null ? '' : `, ${String(pct)}% of planned reps`}`,
  };
}

const LINE: Readonly<Record<Exclude<WeekChipState, 'done'>, string>> = { missed: PROGRESS_COPY.missed, upcoming: PROGRESS_COPY.toDo, paused: PROGRESS_COPY.paused };
const SAID: Readonly<Record<Exclude<WeekChipState, 'done'>, string>> = { missed: 'missed', upcoming: 'to do', paused: 'paused' };
const openChip = (key: string, name: string, state: Exclude<WeekChipState, 'done'>): WeekChipView => ({ key, name, line: LINE[state], state, sessionId: null, accessibilityLabel: `${name}, ${SAID[state]}` });

function weekSessions(input: WeeklyReviewInput, monday: string): ReviewSession[] {
  return input.sessions.filter((s) => inWeek(s.date, monday)).sort((a, b) => a.startedMs - b.startedMs);
}

function pastRow(input: WeeklyReviewInput, monday: string, today: string, reviewIds: ReadonlyMap<string, string>): PastWeekRowView {
  const c = reviewWeekCount(input, monday);
  const week = shortDate(monday, today);
  const said = `Week of ${longDate(monday, today)}`;
  const reviewId = reviewIds.get(monday) ?? null;
  const runs = c.count.runs > 0 ? `, ${plural(c.count.runs, 'run', 'runs')}` : '';
  if (c.plan !== null) {
    if (c.count.planned === null) return { key: monday, monday, week: plain(week), squares: c.plan.days.map(() => 'paused'), right: PROGRESS_COPY.pausedWeek, reviewId, accessibilityLabel: `${said}: paused` };
    let slots = c.count.planned - c.count.done;
    const squares: WeekSquare[] = c.plan.days.map((d) => {
      if (c.done.has(d.routineId)) return 'done';
      if (slots > 0) {
        slots -= 1;
        return 'missed';
      }
      return 'paused';
    });
    const right = `${String(c.count.done)} of ${String(c.count.planned)}`;
    return { key: monday, monday, week: plain(week), squares, right, reviewId, accessibilityLabel: `${said}: ${right} sessions${runs}` };
  }
  if (c.count.planned !== null) {
    const n = Math.min(7, Math.max(c.count.planned, c.count.done));
    const squares: WeekSquare[] = Array.from({ length: n }, (_, i) => (i < c.count.done ? 'done' : 'missed'));
    const right = `${String(c.count.done)} of ${String(c.count.planned)}`;
    return { key: monday, monday, week: plain(week), squares, right, reviewId, accessibilityLabel: `${said}: ${right} sessions${runs}` };
  }
  const squares: WeekSquare[] = Array.from({ length: Math.min(7, c.count.workouts) }, () => 'done');
  return { key: monday, monday, week: plain(week), squares, right: String(c.count.workouts), reviewId, accessibilityLabel: `${said}: ${plural(c.count.workouts, 'workout', 'workouts')}${runs}` };
}

/**
 * This week (`Sessions 3 of 4 · 2 runs`): one chip per planned session, its day and % of planned reps when
 * done; missed (week over) faint, to do and paused as outlines. With no plan, the days-a-week aim; with
 * neither, the workouts done. Plan days aren't dated (the plan is a rotation), so a day not done has no
 * weekday. `past`: the last 4 weeks as one row of squares each.
 */
export function thisWeekView(input: WeeklyReviewInput, opts: { today: string; reviewIds?: ReadonlyMap<string, string> }): ThisWeekView {
  const monday = input.monday;
  const c = reviewWeekCount(input, monday);
  const complete = input.nowMs >= localMidnightUtcMs(addDays(monday, 7), input.tz);
  const sessions = weekSessions(input, monday);
  const chips: WeekChipView[] = [];
  if (c.plan !== null) {
    let slots = c.count.planned === null ? 0 : c.count.planned - c.count.done;
    c.plan.days.forEach((d, i) => {
      const key = `${d.routineId}:${String(i)}`;
      const at = c.done.get(d.routineId);
      if (at !== undefined) chips.push(doneChip(key, d.name, sessions.find((s) => s.startedAtUtc === at)));
      else if (slots > 0) {
        slots -= 1;
        chips.push(openChip(key, d.name, complete ? 'missed' : 'upcoming'));
      } else chips.push(openChip(key, d.name, 'paused'));
    });
  } else {
    sessions.slice(0, 7).forEach((s) => chips.push(doneChip(s.sessionId, s.name ?? 'Workout', s)));
    if (c.count.planned !== null) for (let i = c.count.done; i < Math.min(7, c.count.planned); i += 1) chips.push(openChip(`aim${String(i)}`, 'Workout', complete ? 'missed' : 'upcoming'));
  }
  const fullyPaused = c.plan !== null && c.count.planned === null;
  const sessionsText = fullyPaused ? PROGRESS_COPY.pausedWeek : c.count.planned === null ? String(c.count.workouts) : `${String(c.count.done)} of ${String(c.count.planned)}`;
  const reviewIds = opts.reviewIds ?? new Map<string, string>();
  const past = [1, 2, 3, 4].map((i) => pastRow(input, addDays(monday, -7 * i), opts.today, reviewIds));
  const anyLogged = input.sessions.some((s) => s.date >= addDays(monday, -28) && s.date <= addDays(monday, 6));
  return {
    range: plain(weekRangeText(monday)),
    sessions: sessionsText,
    runs: c.count.runs > 0 ? plural(c.count.runs, 'run', 'runs') : null,
    chips,
    past,
    accessibilityLabel: chips.map((x) => x.accessibilityLabel).join('; '),
    empty: c.plan === null && c.count.planned === null && !anyLogged,
  };
}

// ---------------------------------------------------------------------------
// Lifts

/** Estimates come only from sets of this many reps (singles and long sets never drive one). */
export const LIFT_ESTIMATE_REPS = { min: 3, max: 12 } as const;
/** `at this rate`: only after this many rising weeks, and only for a date within this many days. */
export const LIFT_ETA = { risingWeeks: 4, maxDays: 183 } as const;
/** Lines on the all-lifts chart (dataviz categorical slots 1–3). */
export const LIFT_LINES = 3;
const WEEKS = 8;
/** Columns the focused chart adds after the last week for the dotted `at this rate` line (as the prototype). */
const ETA_COLUMNS = 2;

/**
 * The load at `toReps` from a set of `load × fromReps`, by the app's e1RM formula (Epley,
 * `load × (1 + reps / 30)`), rounded for display (0.5 kg / 1 lb). An estimate, never a target.
 */
export function loadAtReps(load: number, fromReps: number, toReps: number, unit: WeightUnit): number {
  const oneRm = fromReps === 1 ? load : load * (1 + fromReps / 30);
  const at = toReps === 1 ? oneRm : oneRm / (1 + toReps / 30);
  return roundEstimate(at, unit);
}

export interface LiftPointView {
  /** 0–7: the week (oldest first). */
  week: number;
  value: number;
  /** Hollow: converted from another rep count. */
  estimate: boolean;
  /** `100 × 6`, `est. 92.5 × 6 from 100 × 4`. */
  detail: string;
}

export type LiftRepsSource = 'target' | 'plan' | 'picked' | 'logged';

export interface LiftView {
  exerciseId: string;
  name: string;
  /** Reps the lift is tracked at; null for a bodyweight lift (best reps). */
  reps: number | null;
  repsSource: LiftRepsSource | null;
  /** `× 6`; `–` for a bodyweight lift. */
  repsText: string;
  /** `100`, `○ 97.5` (an estimate), `12 reps`, `–`. */
  current: string;
  currentEstimate: boolean;
  target: number | null;
  /** `110` or `–`. */
  targetText: string;
  /** 0–2: its line on the all-lifts chart; null: listed only (an accessory). */
  colour: number | null;
  accessory: boolean;
  /** Loads in kg/lb (false: a bodyweight lift, listed only). */
  chartable: boolean;
  /** Assisted: less assistance is stronger. */
  lowerIsBetter: boolean;
  points: LiftPointView[];
  /** Tracked reps changed in the window: `now × 4` at that week. */
  marker: { week: number; label: string } | null;
  focus: {
    /** `Top set × 6 (target reps) · 100 now`. */
    subtitle: string;
    onTrack: boolean;
    /** `about mid-Nov at this rate` (always shown with `est.`); null when the agreed conditions aren't met. */
    eta: string | null;
    /** `mid-Nov`: the chart's label at the end of the dotted line; null with no eta. */
    etaShort: string | null;
    /** Columns past the last week the dotted line runs to (0 with no eta). */
    etaWeeks: number;
  };
  /** The row's VoiceOver label. */
  accessibilityLabel: string;
  /** The focused chart's VoiceOver label (every week, estimates said). */
  chartLabel: string;
}

export interface LiftsView {
  /** The 8 week labels, oldest first (`25 Aug`). */
  weeks: string[];
  unit: WeightUnit;
  /** Drawn lifts first (colour order), then accessories. */
  lifts: LiftView[];
  /** The all-lifts chart's VoiceOver label. */
  chartLabel: string;
  empty: boolean;
}

export interface LiftsOptions {
  today: string;
  /** The plan's (or split's) main lifts. */
  mains: ReadonlySet<string>;
  /** Reps of each exercise's top set in the plan in use. */
  planReps: ReadonlyMap<string, number>;
  /** The reps Ben picked when adding a lift that isn't in the plan. */
  pickedReps: Readonly<Record<string, number>>;
  /** The plan before the current one: its top-set reps (for the `now × n` marker), and when the current one began. */
  previousPlanReps?: ReadonlyMap<string, number> | null;
  planAppliedDate?: string | null;
  nameOf: (exerciseId: string) => string;
}

interface Candidate {
  load: number;
  reps: number;
}

function newestConvention(sessions: readonly ReviewSession[], exerciseId: string): LoadConvention | null {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const ex = sessions[i]?.exercises.find((e) => e.exerciseId === exerciseId && e.sets.some((s) => WORKING.has(s.setType) && s.load !== null));
    const set = ex?.sets.find((s) => WORKING.has(s.setType) && s.load !== null);
    if (set?.load != null) return set.load.convention;
  }
  return null;
}

function loggedReps(sessions: readonly ReviewSession[], exerciseId: string): number | null {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const sets = sessions[i]?.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((s) => WORKING.has(s.setType) && s.counts && s.reps !== null && s.reps > 0)) ?? [];
    let best: { load: number; reps: number } | null = null;
    for (const s of sets) {
      const load = s.load?.value ?? 0;
      if (best === null || load > best.load) best = { load, reps: s.reps ?? 0 };
    }
    if (best !== null) return Math.max(1, Math.min(LIFT_ESTIMATE_REPS.max, best.reps));
  }
  return null;
}

const nf = (n: number): string => formatNumber(n);

function liftEta(points: readonly LiftPointView[], target: number | null, mondays: readonly string[], today: string): { text: string; short: string; weeks: number } | null {
  if (target === null) return null;
  const real = points.filter((p) => !p.estimate);
  const last4 = real.slice(-LIFT_ETA.risingWeeks);
  if (last4.length < LIFT_ETA.risingWeeks) return null;
  for (let i = 1; i < last4.length; i += 1) if ((last4[i]?.value ?? 0) < (last4[i - 1]?.value ?? 0)) return null;
  const first = last4[0];
  const last = last4.at(-1);
  if (first === undefined || last === undefined || last.value <= first.value || last.value >= target) return null;
  // Least squares over the window's real points (kg or lb a week).
  const n = real.length;
  const mx = real.reduce((m, p) => m + p.week, 0) / n;
  const my = real.reduce((m, p) => m + p.value, 0) / n;
  const sxx = real.reduce((m, p) => m + (p.week - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : real.reduce((m, p) => m + (p.week - mx) * (p.value - my), 0) / sxx;
  if (slope <= 0) return null;
  const weeks = (target - last.value) / slope;
  const date = addDays(mondays[last.week] ?? today, Math.round(weeks * 7));
  if (date <= today || daysBetween(today, date) > LIFT_ETA.maxDays) return null;
  const day = Number(date.slice(8, 10));
  const part = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  const short = `${part}-${MONTH[Number(date.slice(5, 7)) - 1] ?? ''}`;
  return { text: `about ${short} at this rate`, short, weeks: ETA_COLUMNS };
}

/**
 * Lifts (8 weeks, real kg/lb): the top set each week at each lift's reps. Tracked reps: the lift target's,
 * else the plan's top set, else what Ben picked when adding it, else his newest top set's. A week's point is
 * real (filled) when a set reached those reps (the heaviest load for at least them), else estimated (hollow)
 * from the week's best set of 3–12 reps by the e1RM formula. The plan's main lifts are drawn (up to 3);
 * the rest are listed as accessories. `On track` and `about mid-Nov at this rate (est.)` use real points
 * only, after 4 rising weeks, for a date within 6 months.
 */
export function liftsView(input: WeeklyReviewInput, opts: LiftsOptions): LiftsView {
  const unit = input.unit;
  const mondays = Array.from({ length: WEEKS }, (_, i) => addDays(input.monday, -7 * (WEEKS - 1 - i)));
  const from = mondays[0] ?? input.monday;
  const sunday = addDays(input.monday, 6);
  const all = [...input.sessions].filter((s) => s.date <= sunday).sort((a, b) => a.startedMs - b.startedMs);
  const targets = new Map(input.liftTargets.map((t) => [t.exerciseId, t]));
  const ids = [...new Set(input.lifts)];
  const views: Omit<LiftView, 'colour' | 'accessory'>[] = [];
  for (const id of ids) views.push(oneLift(id));

  function repsFor(id: string, target: LiftTarget | null): { reps: number | null; source: LiftRepsSource | null; before: number | null } {
    const plan = opts.planReps.get(id) ?? null;
    const picked = opts.pickedReps[id] ?? null;
    const logged = loggedReps(all, id);
    const otherwise = plan ?? picked ?? logged;
    if (target !== null) return { reps: target.reps, source: 'target', before: otherwise };
    if (plan !== null) return { reps: plan, source: 'plan', before: opts.previousPlanReps?.get(id) ?? null };
    if (picked !== null) return { reps: picked, source: 'picked', before: null };
    return { reps: logged, source: logged === null ? null : 'logged', before: null };
  }

  function oneLift(id: string): Omit<LiftView, 'colour' | 'accessory'> {
    const name = opts.nameOf(id);
    const convention = newestConvention(all, id);
    const lowerIsBetter = convention === 'assistance';
    const chartable = convention !== null && convention !== 'bodyweight';
    const t0 = targets.get(id) ?? null;
    const target = t0 !== null && convention !== null && t0.load.convention === convention ? t0 : null;
    const r = repsFor(id, target);
    const points: LiftPointView[] = [];
    mondays.forEach((m, week) => {
      const sets = all.filter((s) => inWeek(s.date, m)).flatMap((s) => s.exercises.filter((e) => e.exerciseId === id).flatMap((e) => e.sets.map((x) => ({ x, kind: e.equipmentKind }))));
      if (!chartable) {
        let best = 0;
        for (const { x } of sets) if (WORKING.has(x.setType) && x.counts && x.reps !== null && (x.load === null || x.load.convention === 'bodyweight')) best = Math.max(best, x.reps);
        if (best > 0) points.push({ week, value: best, estimate: false, detail: `${String(best)} reps` });
        return;
      }
      const reps = r.reps ?? 1;
      let real: Candidate | null = null;
      let est: (Candidate & { value: number }) | null = null;
      for (const { x, kind } of sets) {
        if (!WORKING.has(x.setType) || !x.counts || x.reps === null || x.reps < 1 || x.load === null || x.load.convention !== convention) continue;
        const v = roundEstimate(convertMass({ value: x.load.value, unit: x.load.unit }, unit).value, unit);
        if (x.reps >= reps) {
          if (real === null || (lowerIsBetter ? v < real.load : v > real.load)) real = { load: v, reps: x.reps };
        } else if (!lowerIsBetter && x.reps >= LIFT_ESTIMATE_REPS.min && x.reps <= LIFT_ESTIMATE_REPS.max && e1rmConventionAllowed(convention, kind)) {
          const value = loadAtReps(v, x.reps, reps, unit);
          if (est === null || value > est.value) est = { load: v, reps: x.reps, value };
        }
      }
      if (real !== null) points.push({ week, value: real.load, estimate: false, detail: `${nf(real.load)}${NBSP}×${NBSP}${String(real.reps)}` });
      else if (est !== null) points.push({ week, value: est.value, estimate: true, detail: `est. ${nf(est.value)}${NBSP}×${NBSP}${String(reps)} from ${nf(est.load)}${NBSP}×${NBSP}${String(est.reps)}` });
    });
    const last = points.at(-1);
    const targetValue = target === null ? null : roundEstimate(convertMass({ value: target.load.value, unit: target.load.unit }, unit).value, unit);
    const eta = chartable && !lowerIsBetter ? liftEta(points, targetValue, mondays, opts.today) : null;
    const unitWord = chartable ? plain(liftUnitText(unit, convention)) : 'reps';
    // The marker: the tracked reps changed inside the window (a new target, a new plan).
    let marker: LiftView['marker'] = null;
    const since = r.source === 'target' ? (target?.setOnDate ?? null) : r.source === 'plan' ? (opts.planAppliedDate ?? null) : null;
    if (r.reps !== null && r.before !== null && r.before !== r.reps && since !== null && since > from && since <= sunday) marker = { week: Math.min(WEEKS - 1, Math.floor(daysBetween(from, since) / 7)), label: `now${NBSP}×${NBSP}${String(r.reps)}` };
    const real = points.filter((p) => !p.estimate);
    const firstReal = real[0];
    const lastReal = real.at(-1);
    const change = firstReal === undefined || lastReal === undefined || real.length < 2 ? null : lastReal.value - firstReal.value;
    const better = change === null ? null : lowerIsBetter ? -change : change;
    const changeWords = change === null || better === null ? null : better === 0 ? 'level in 8 weeks' : `${better > 0 ? 'up' : 'down'} ${nf(Math.abs(change))} ${unitWord} in 8 weeks`;
    const current = last === undefined ? '–' : chartable ? `${last.estimate ? `○${NBSP}` : ''}${nf(last.value)}` : `${String(last.value)}${NBSP}reps`;
    const sourceWord = r.source === 'target' ? ' (target reps)' : r.source === 'plan' ? ' (plan reps)' : '';
    const subtitle = !chartable ? `Best reps${last === undefined ? '' : ` · ${String(last.value)} now`}` : `${PROGRESS_COPY.topSet}${NBSP}×${NBSP}${String(r.reps ?? 1)}${sourceWord}${last === undefined ? '' : ` · ${nf(last.value)} now`}`;
    const accessibilityLabel = [
      name,
      chartable && r.reps !== null ? `${String(r.reps)} reps` : null,
      last === undefined ? 'no sets in 8 weeks' : chartable ? `current ${last.estimate ? 'estimated ' : ''}${nf(last.value)} ${unitWord}` : `best ${String(last.value)} reps`,
      changeWords,
      targetValue === null ? 'no target' : `target ${nf(targetValue)} ${unitWord}`,
    ]
      .filter((x): x is string => x !== null)
      .join(', ');
    const est = points.filter((p) => p.estimate).length;
    const chartLabel = [
      `${name} top set over 8 weeks`,
      points.length === 0 ? 'no sets' : points.map((p) => `${shortDate(mondays[p.week] ?? from, opts.today)} ${p.estimate ? 'estimated ' : ''}${nf(p.value)}`).join(', '),
      est > 0 ? `${String(est)} estimated` : null,
      targetValue === null ? null : `target ${nf(targetValue)}`,
      eta === null ? null : `${eta.text} (estimate)`,
    ]
      .filter((x): x is string => x !== null)
      .join('. ');
    return {
      exerciseId: id,
      name,
      reps: chartable ? r.reps : null,
      repsSource: chartable ? r.source : null,
      repsText: chartable && r.reps !== null ? `×${NBSP}${String(r.reps)}` : '–',
      current,
      currentEstimate: last?.estimate === true,
      target: targetValue,
      targetText: targetValue === null ? '–' : nf(targetValue),
      chartable,
      lowerIsBetter,
      points,
      marker,
      focus: { subtitle: plain(subtitle), onTrack: eta !== null, eta: eta?.text ?? null, etaShort: eta?.short ?? null, etaWeeks: eta?.weeks ?? 0 },
      accessibilityLabel: plain(accessibilityLabel),
      chartLabel: plain(chartLabel),
    };
  }

  // Drawn: the main lifts (up to 3, in order); with none, the first lifts with loads.
  const chartable = views.filter((v) => v.chartable && v.points.length > 0);
  const mains = chartable.filter((v) => opts.mains.has(v.exerciseId));
  const drawn = (mains.length > 0 ? mains : chartable).slice(0, LIFT_LINES).map((v) => v.exerciseId);
  const lifts: LiftView[] = [
    ...drawn.map((id, i) => ({ ...(views.find((v) => v.exerciseId === id) ?? (undefined as never)), colour: i, accessory: false })),
    ...views.filter((v) => !drawn.includes(v.exerciseId)).map((v) => ({ ...v, colour: null, accessory: true })),
  ];
  const drawnViews = lifts.filter((l) => l.colour !== null);
  const chartLabel = `Top sets over 8 weeks: ${drawnViews
    .map((l) => {
      const a = l.points[0];
      const b = l.points.at(-1);
      return a === undefined || b === undefined ? l.name : `${l.name} ${nf(a.value)} to ${nf(b.value)} ${unit}`;
    })
    .join(', ')}`;
  return { weeks: mondays.map((m) => plain(shortDate(m, opts.today))), unit, lifts, chartLabel, empty: lifts.length === 0 };
}

// ---------------------------------------------------------------------------
// Muscles

export const MUSCLE_ROWS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms'] as const;
export type MuscleRow = (typeof MUSCLE_ROWS)[number];

/** The builder group's row (Biceps and Triceps are Arms; Abs isn't a row). */
export function muscleRowOf(exerciseInfo: Parameters<typeof leadMuscleGroup>[0]): MuscleRow | null {
  const g = leadMuscleGroup(exerciseInfo);
  const b = g === null ? null : builderGroupOfMuscleGroup(g);
  if (b === 'Biceps' || b === 'Triceps') return 'Arms';
  if (b === 'Chest' || b === 'Back' || b === 'Shoulders' || b === 'Legs') return b;
  return null;
}

export interface MuscleTrackerBarView {
  /** Null: a paused week (a flat grey stub). */
  value: number | null;
  /** Null: no plan to compare with that week. */
  planned: number | null;
  /** Full colour at or over plan (or with no plan), faded under. */
  atPlan: boolean;
}

export interface MuscleTrackerRowView {
  key: MuscleRow;
  name: string;
  bars: MuscleTrackerBarView[];
  /** The bars' scale top (the row's highest value or plan, + 10%). */
  scaleMax: number;
  /** `9 of 14`, `9`, `Paused`. */
  last: string;
  accessibilityLabel: string;
}

export interface MuscleTrackerView {
  /** 8 complete weeks, oldest first (`25 Aug`), ending last week. */
  weeks: string[];
  rows: MuscleTrackerRowView[];
  empty: boolean;
}

/**
 * Muscles: working sets per week per muscle row against the plan, the 8 complete weeks ending last week.
 * Each exercise's working sets count in full for its first primary muscle's builder group (the builder's
 * one convention), every working set whatever its RPE, warm-ups never. The plan line is the plan's own
 * templates, only in weeks under that plan and not paused.
 */
export function musclesView(input: WeeklyReviewInput, opts: { today: string }): MuscleTrackerView {
  const end = addDays(input.monday, -7);
  const mondays = Array.from({ length: WEEKS }, (_, i) => addDays(end, -7 * (WEEKS - 1 - i)));
  const byWeek = mondays.map((m) => {
    const c = reviewWeekCount(input, m);
    const paused = c.plan !== null && c.count.planned === null;
    const sets = new Map<MuscleRow, number>();
    for (const s of input.sessions) {
      if (!inWeek(s.date, m)) continue;
      for (const e of s.exercises) {
        const row = muscleRowOf(input.info(e.exerciseId));
        const n = e.sets.filter((x) => WORKING.has(x.setType)).length;
        if (row !== null && n > 0) sets.set(row, (sets.get(row) ?? 0) + n);
      }
    }
    let planned: Map<MuscleRow, number> | null = null;
    const plan = c.plan;
    if (plan !== null && !paused && pausedInWeek(m, plan.pausedDates) === 0) {
      const days = new Set(plan.days.map((d) => d.routineId));
      const templates = input.templates.filter((t) => t.planId === plan.planId && days.has(t.routineId));
      if (templates.length > 0) {
        planned = new Map();
        for (const t of templates)
          for (const e of t.exercises) {
            const row = muscleRowOf(input.info(e.exerciseId));
            if (row !== null && e.workingSets > 0) planned.set(row, (planned.get(row) ?? 0) + e.workingSets);
          }
      }
    }
    return { paused, sets, planned };
  });
  const rows = MUSCLE_ROWS.map((key): MuscleTrackerRowView => {
    const bars = byWeek.map((w): MuscleTrackerBarView => {
      if (w.paused) return { value: null, planned: null, atPlan: true };
      const value = w.sets.get(key) ?? 0;
      const planned = w.planned === null ? null : (w.planned.get(key) ?? 0);
      return { value, planned, atPlan: planned === null || value >= planned };
    });
    const top = Math.max(1, ...bars.map((b) => Math.max(b.value ?? 0, b.planned ?? 0)));
    const last = bars.at(-1) ?? { value: 0, planned: null, atPlan: true };
    const judged = bars.filter((b) => b.value !== null && b.planned !== null);
    const ok = judged.filter((b) => b.atPlan).length;
    const lastText = last.value === null ? PROGRESS_COPY.pausedWeek : last.planned === null ? String(last.value) : `${String(last.value)} of ${String(last.planned)}`;
    const said = last.value === null ? `${key}: paused last week.` : `${key}: ${plural(last.value, 'set', 'sets')} last week${last.planned === null ? '' : `, plan ${String(last.planned)}`}.`;
    return {
      key,
      name: key,
      bars,
      scaleMax: top * 1.1,
      last: lastText,
      accessibilityLabel: judged.length === 0 ? said : `${said} At plan in ${String(ok)} of ${String(judged.length)} weeks.`,
    };
  });
  const empty = rows.every((r) => r.bars.every((b) => (b.value ?? 0) === 0 && b.planned === null));
  return { weeks: mondays.map((m) => plain(shortDate(m, opts.today))), rows, empty };
}

// ---------------------------------------------------------------------------
// Coach's changes

/**
 * Whether a weekly proposal is structural (swaps, adds, removes, day moves, order: always asked, Apply /
 * Keep as is; rule 3) or a small change on the same exercises (load, reps, sets: applied for the next
 * sessions, shown with its reason and Undo).
 */
const SMALL_CHANGES: ReadonlySet<ReviewProposal['change']['kind']> = new Set(['template_sets']);

export function isStructuralProposal(p: Pick<ReviewProposal, 'change'>): boolean {
  return !SMALL_CHANGES.has(p.change.kind);
}

export interface ChangeRowView {
  id: string;
  /** `Leg curl`. */
  exercise: string;
  /** `3 sets` (struck through). */
  before: string;
  /** `4 sets`. */
  after: string;
  /** `next Legs`. */
  when: string;
  why: string | null;
  status: ReviewProposal['status'];
  structural: boolean;
  /** Undo while applied by the review (and Ben can Redo an undone one). */
  canUndo: boolean;
  canRedo: boolean;
  /** `Undone`, `Out of date`, `Skipped`; null while applied or open. */
  statusText: string | null;
  accessibilityLabel: string;
}

export interface CoachChangesView {
  reviewId: string;
  version: number;
  /** `w/c 13 Oct` of the reviewed week. */
  week: string;
  /** A new weekly review Ben hasn't dismissed with `Got it`. */
  isNew: boolean;
  /** The coach's sentence; null when it didn't review. */
  note: string | null;
  /** `Coach`, or why not: `Not reviewed · Offline`, `Reviewing…`. */
  tag: string;
  reviewed: boolean;
  /** Small changes already made for the next sessions (and Ben's undone ones). */
  rows: ChangeRowView[];
  /** Structural changes, asked (Apply / Keep as is). */
  asks: ChangeRowView[];
  /** `3 changes for next week`. */
  collapsed: string;
}

export function changeRowView(p: ReviewProposal): ChangeRowView {
  const c = p.change;
  const structural = isStructuralProposal(p);
  const before = plural(c.fromSets, 'set', 'sets');
  const after = plural(c.toSets, 'set', 'sets');
  const when = `next ${c.routineName}`;
  const statusText = p.status === 'undone' ? PROGRESS_COPY.undone : p.status === 'stale' ? PROGRESS_COPY.outOfDate : p.status === 'skipped' ? PROGRESS_COPY.skipped : null;
  const words = p.status === 'undone' ? `${c.exerciseName}: kept ${before}. Undone` : `${c.exerciseName}: ${before} to ${after}, ${when}${p.reason === null ? '' : `. ${p.reason}`}${statusText === null ? '' : `. ${statusText}`}`;
  return {
    id: p.id,
    exercise: c.exerciseName,
    before,
    after,
    when,
    why: p.reason,
    status: p.status,
    structural,
    canUndo: p.status === 'applied' && p.actionId !== null,
    canRedo: p.status === 'undone' && !structural,
    statusText,
    accessibilityLabel: words,
  };
}

/** The newest weekly review as Coach's changes (Progress v3, bottom of the page). */
export function coachChangesView(r: TrainingReview, today: string): CoachChangesView | null {
  if (r.subject.kind !== 'weekly') return null;
  const v = verdictOf(r);
  const all = (r.proposals ?? []).map(changeRowView);
  const rows = all.filter((x) => !x.structural);
  const asks = all.filter((x) => x.structural);
  const made = rows.filter((x) => x.status === 'applied').length + asks.filter((x) => x.status === 'applied').length;
  return {
    reviewId: r.id,
    version: r.version,
    week: plain(`w/c ${shortDate(r.subject.weekMonday, today)}`),
    isNew: r.seenAtUtc === undefined,
    note: v.reviewed ? v.verdict : null,
    tag: v.reviewed ? PROGRESS_COPY.coach : v.verdict,
    reviewed: v.reviewed,
    rows,
    asks,
    collapsed: made === 0 ? 'No changes for next week' : `${plural(made, 'change', 'changes')} for next week`,
  };
}
