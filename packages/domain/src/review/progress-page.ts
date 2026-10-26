import { type SessionAggregate, type LiftTarget, type MuscleGroup, type LoadConvention, type ReviewProposal, type SetExclusion, type SetType, type TrainingReview, type WeightUnit } from '@fizz/schemas';
import { addDays, daysBetween, localDateOf, localMidnightUtcMs, weekdayIndexOfDate } from '../calendar';
import { formatNumber, NBSP } from '../display';
import { deriveId, stableStringify } from '../stable';
import { isSetCountable } from '../exclusions';
import { e1rmConventionAllowed, roundEstimate } from '../progress/e1rm';
import { longDate, shortDate } from '../progress/exercise-view';
import { pausedInWeek } from '../progress/plan-tracker';
import { toMs } from '../time';
import { convertMass } from '../units';
import { isPlatesAddedKind } from '../plates-added';
import { liftUnitText, REVIEW_COPY, verdictOf, weekRangeText } from './views';
import { leadMuscleGroup, reviewSessionOf, reviewWeekCount, type ReviewActivity, type ReviewSession, type WeeklyReviewInput } from './weekly';
import { HISTORY_STATUS } from '../session/deletion';

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
  last5: 'Last 5 weeks',
  week: 'Week',
  month: 'Month',
  thisWk: 'This wk',
  sessions: 'Sessions',
  calendarKey: ['Done', 'Missed', 'Planned', 'Cardio'],
  trends: 'Trends',
  last8: 'last 8 weeks',
  lifts: 'Lifts',
  topSet: 'Top set',
  pbKey: '◎ PB',
  pb: 'PB',
  newBest: 'New best',
  est: '○ est.',
  estWord: 'est.',
  edit: 'Edit',
  allLifts: 'All lifts',
  allLiftsLink: 'All lifts ›',
  openLift: (name: string): string => `Open ${name} ›`,
  details: 'Details ›',
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
  skip: 'Skip',
  outOfDate: 'Out of date',
  heldPain: 'Held · pain',
  notApplied: 'Not applied',
  /** Coach's changes collapsed with changes still waiting for Apply / Skip (review v5offers 3). */
  toReview: (n: number) => `${String(n)} to review`,
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

/** A finished workout on its calendar day: the session's letter (`C`), its name for VoiceOver. */
export interface CalendarSessionMark {
  letter: string;
  name: string;
}

export interface CalendarCellView {
  /** Local date. */
  date: string;
  /** Workouts done that day (soft green with the letter); empty: rest (or cardio only). */
  done: CalendarSessionMark[];
  /** A cardio activity done that day (a small dot). */
  cardio: boolean;
}

/** A planned session not done this week. Plan days carry no weekday, so it is never put on a day (rule 6). */
export interface CalendarOpenMark extends CalendarSessionMark {
  /** `missed`: the week is over; `planned`: still to come. */
  state: 'missed' | 'planned';
}

export interface CalendarRowView {
  key: string;
  monday: string;
  /** `This wk` or `6 Oct`. */
  label: string;
  now: boolean;
  /** Fully paused: outlined, empty, `Paused` on the right. */
  paused: boolean;
  /** Monday to Sunday. */
  cells: CalendarCellView[];
  /** Planned sessions not done, listed after the row with no day. */
  open: CalendarOpenMark[];
  /** `3 of 4`, `Paused`, or the workouts with no plan or aim (`2`). */
  right: string;
  /** That week's stored review (tap opens it); null with none. */
  reviewId: string | null;
  /** `Week of 6 October: 3 of 4 sessions; Mon Chest, Tue cardio, …; Legs missed`. */
  accessibilityLabel: string;
}

export interface MonthCalendarView {
  /** `This wk` first, then the 4 weeks before it. */
  rows: CalendarRowView[];
  /** `5 weeks on plan`: complete plan weeks in a row with sessions done ≥ planned (paused weeks skipped); null with none. */
  weeksOnPlan: string | null;
}

export interface ThisWeekView {
  /** `13–19 Oct`. */
  range: string;
  /** `3 of 4`, `Paused`, or `2` with no plan or aim. */
  sessions: string;
  /** `2 cardio`; null with none. */
  cardio: string | null;
  chips: WeekChipView[];
  /** Month: the last 5 weeks as a calendar. */
  month: MonthCalendarView;
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

/** Activities counted as cardio on Progress (Ben, 21 Oct: `cardio`, not `runs`): runs, rides and swims done. */
const CARDIO: ReadonlySet<ReviewActivity['kind']> = new Set(['run', 'ride', 'swim']);
const cardioDates = (input: WeeklyReviewInput, monday: string): string[] => input.activities.filter((a) => a.status === 'done' && CARDIO.has(a.kind) && inWeek(a.date, monday)).map((a) => a.date);

/**
 * One letter per plan day for the calendar (`C`, `B`, `S`, `L`): the name's first letter; when two days share
 * it, that letter and the first letter that tells them apart (`Push`, `Pull` → `Ps`, `Pl`; `Upper A`, `Upper B`
 * → `UA`, `UB`); numbered if even that clashes.
 */
export function planDayLetters(names: readonly string[]): string[] {
  const squash = (n: string): string => n.trim().replace(/\s+/g, '') || 'W';
  const first = (n: string): string => squash(n)[0]?.toUpperCase() ?? 'W';
  const out = names.map((n) => {
    const peers = names.filter((m) => first(m) === first(n) && squash(m) !== squash(n));
    if (peers.length === 0) return first(n);
    const t = squash(n);
    for (let k = 1; k < t.length; k += 1) if (peers.every((m) => squash(m)[k] !== t[k])) return `${first(n)}${t[k] ?? ''}`;
    return first(n);
  });
  return out.map((l, i) => (out.filter((x) => x === l).length > 1 ? `${l}${String(out.slice(0, i + 1).filter((x) => x === l).length)}` : l));
}

function calendarRow(input: WeeklyReviewInput, monday: string, now: boolean, today: string, reviewIds: ReadonlyMap<string, string>): CalendarRowView {
  const c = reviewWeekCount(input, monday);
  const complete = input.nowMs >= localMidnightUtcMs(addDays(monday, 7), input.tz);
  const sessions = weekSessions(input, monday);
  const cardio = new Set(cardioDates(input, monday));
  const label = now ? PROGRESS_COPY.thisWk : plain(shortDate(monday, today));
  const said = now ? 'This week' : `Week of ${longDate(monday, today)}`;
  const reviewId = now ? null : (reviewIds.get(monday) ?? null);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const paused = c.plan !== null && c.count.planned === null;
  if (paused) return { key: monday, monday, label, now, paused, cells: dates.map((date) => ({ date, done: [], cardio: false })), open: [], right: PROGRESS_COPY.pausedWeek, reviewId, accessibilityLabel: `${said}: paused` };
  // Each finished workout on the day it was logged: a plan day's letter when it counted for one, else its own name's.
  const letters = c.plan === null ? [] : planDayLetters(c.plan.days.map((d) => d.name));
  const byStart = new Map<string, CalendarSessionMark>();
  c.plan?.days.forEach((d, i) => {
    const at = c.done.get(d.routineId);
    if (at !== undefined && !byStart.has(at)) byStart.set(at, { letter: letters[i] ?? 'W', name: d.name });
  });
  // A plan day done twice in the week keeps its plan letter the second time (review progress-v3b-design N4).
  const byRoutine = new Map<string, CalendarSessionMark>();
  c.plan?.days.forEach((d, i) => {
    if (!byRoutine.has(d.routineId)) byRoutine.set(d.routineId, { letter: letters[i] ?? 'W', name: d.name });
  });
  const cells: CalendarCellView[] = dates.map((date) => ({
    date,
    done: sessions.filter((s) => s.date === date).map((s) => byStart.get(s.startedAtUtc) ?? (s.routineId === null ? undefined : byRoutine.get(s.routineId)) ?? { letter: planDayLetters([s.name ?? 'Workout'])[0] ?? 'W', name: s.name ?? 'Workout' }),
    cardio: cardio.has(date),
  }));
  // Planned sessions not done: no weekday to put them on, so listed after the row (never on an invented day).
  const open: CalendarOpenMark[] = [];
  if (c.plan !== null && c.count.planned !== null) {
    let slots = c.count.planned - c.count.done;
    c.plan.days.forEach((d, i) => {
      if (c.done.has(d.routineId) || slots <= 0) return;
      slots -= 1;
      open.push({ letter: letters[i] ?? 'W', name: d.name, state: complete ? 'missed' : 'planned' });
    });
  }
  const right = c.count.planned === null ? String(c.count.workouts) : `${String(c.count.done)} of ${String(c.count.planned)}`;
  const days = cells.flatMap((cell, i) => [...cell.done.map((m) => `${DAY[i] ?? ''} ${m.name}`), ...(cell.cardio ? [`${DAY[i] ?? ''} cardio`] : [])]);
  const count = c.count.planned === null ? plural(c.count.workouts, 'workout', 'workouts') : `${right} sessions`;
  const words = [`${said}: ${count}`, days.join(', '), open.map((o) => `${o.name} ${o.state}`).join(', ')].filter((x) => x !== '');
  return { key: monday, monday, label, now, paused, cells, open, right, reviewId, accessibilityLabel: words.join('; ') };
}

/**
 * Complete plan weeks in a row, newest first from last week, where sessions done ≥ planned. A paused week
 * neither adds nor breaks; a short week (or a week with no plan) simply ends the count. Reads back at most
 * `maxWeeks` (the history loaded), so it can understate, never overstate.
 */
export function weeksOnPlan(input: WeeklyReviewInput, maxWeeks: number): number {
  let n = 0;
  for (let i = 1; i <= maxWeeks; i += 1) {
    const c = reviewWeekCount(input, addDays(input.monday, -7 * i));
    if (c.plan === null) break;
    if (c.count.planned === null || c.count.planned <= 0) continue;
    if (c.count.done < c.count.planned) break;
    n += 1;
  }
  return n;
}

/**
 * This week (`Sessions 3 of 4 · 2 cardio`): one chip per planned session, its day and % of planned reps when
 * done; missed (week over) faint, to do and paused as outlines. With no plan, the days-a-week aim; with
 * neither, the workouts done. Plan days aren't dated (the plan is a rotation), so a day not done has no
 * weekday. `month`: this week and the 4 before as a calendar, and `n weeks on plan`.
 */
export function thisWeekView(input: WeeklyReviewInput, opts: { today: string; reviewIds?: ReadonlyMap<string, string>; /** Weeks of history loaded (caps `weeks on plan`). */ historyWeeks?: number }): ThisWeekView {
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
  const rows = [0, 1, 2, 3, 4].map((i) => calendarRow(input, addDays(monday, -7 * i), i === 0, opts.today, reviewIds));
  const onPlan = weeksOnPlan(input, opts.historyWeeks ?? 20);
  const cardio = cardioDates(input, monday).length;
  const anyLogged = input.sessions.some((s) => s.date >= addDays(monday, -28) && s.date <= addDays(monday, 6));
  return {
    range: plain(weekRangeText(monday)),
    sessions: sessionsText,
    cardio: cardio > 0 ? `${String(cardio)} cardio` : null,
    chips,
    month: { rows, weeksOnPlan: onPlan > 0 ? `${plural(onPlan, 'week', 'weeks')} on plan` : null },
    accessibilityLabel: chips.map((x) => x.accessibilityLabel).join('; '),
    empty: c.plan === null && c.count.planned === null && !anyLogged,
  };
}

// ---------------------------------------------------------------------------
// Lifts

/** Estimates come only from sets of this many reps (singles and long sets never drive one). */
export const LIFT_ESTIMATE_REPS = { min: 3, max: 12 } as const;
/** `at this rate`: only after this many rising weeks (the newest within `recentWeeks`), and only for a date within this many days. */
export const LIFT_ETA = { risingWeeks: 4, recentWeeks: 2, maxDays: 183 } as const;
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
  /** A real top set heavier (assisted: less assistance) than every earlier real one at the tracked reps, same machine. */
  pb: boolean;
  /** `PB · Bench 100 × 6 · week of 13 Oct`; null when not a PB. */
  pbDetail: string | null;
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
  /** The newest point is a PB (the table's `PB` tag; a ring on the all-lifts chart). */
  latestPb: boolean;
  /** The load convention, said (CLAUDE.md): `each` (per dumbbell), `stack`, `assist`, `added`; null for a barbell total or bodyweight. */
  loadSuffix: string | null;
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
  /**
   * Older history of the tracked lifts (before `input.sessions` reach back; `liftHistorySessions`), so a PB is
   * heavier than every earlier real top set, not only the loaded window. Overlaps are ignored.
   */
  earlier?: readonly ReviewSession[];
  /**
   * Lifts whose older history couldn't be read: no PB is claimed for them (no ring, tag or `New best`), since
   * an older, heavier set may be missing (rule 6; review progress-v3b-design S2).
   */
  historyUnknown?: ReadonlySet<string>;
}

interface Candidate {
  load: number;
  reps: number;
}

/** The lift's newest loaded working row: its load convention, and its machine for the same-machine rule. */
function newestRow(sessions: readonly ReviewSession[], exerciseId: string): { convention: LoadConvention; equipmentId: string | null; machine: boolean } | null {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const exs = sessions[i]?.exercises.filter((e) => e.exerciseId === exerciseId) ?? [];
    for (let j = exs.length - 1; j >= 0; j -= 1) {
      const ex = exs[j];
      const set = ex?.sets.find((s) => WORKING.has(s.setType) && s.load !== null);
      if (ex === undefined || set?.load == null) continue;
      const c = set.load.convention;
      // Stacks (and assisted stacks) and plate-loaded machines differ machine to machine: only the same one compares.
      return { convention: c, equipmentId: ex.equipmentId ?? null, machine: c === 'stack' || c === 'assistance' || isPlatesAddedKind(ex.equipmentKind) };
    }
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

/**
 * `On track` / `about mid-Nov at this rate` (est.): only when the lift's 4 most recent points are all real,
 * never falling and rising overall (no newer point, estimated or lower, after them), the newest within the
 * last 2 weeks, and the date within 6 months. Projected from the newest point along those points' trend.
 */
function liftEta(points: readonly LiftPointView[], target: number | null, mondays: readonly string[], today: string): { text: string; short: string; weeks: number } | null {
  if (target === null) return null;
  const run = points.slice(-LIFT_ETA.risingWeeks);
  if (run.length < LIFT_ETA.risingWeeks || run.some((p) => p.estimate)) return null;
  for (let i = 1; i < run.length; i += 1) if ((run[i]?.value ?? 0) < (run[i - 1]?.value ?? 0)) return null;
  const first = run[0];
  const last = run.at(-1);
  if (first === undefined || last === undefined || last.value <= first.value || last.value >= target) return null;
  if (last.week < WEEKS - LIFT_ETA.recentWeeks) return null;
  // Least squares over the run (kg or lb a week).
  const n = run.length;
  const mx = run.reduce((m, p) => m + p.week, 0) / n;
  const my = run.reduce((m, p) => m + p.value, 0) / n;
  const sxx = run.reduce((m, p) => m + (p.week - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : run.reduce((m, p) => m + (p.week - mx) * (p.value - my), 0) / sxx;
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
  const pool = withEarlier(all, opts.earlier);
  const targets = new Map(input.liftTargets.map((t) => [t.exerciseId, t]));
  const ids = [...new Set(input.lifts)];
  const views: Omit<LiftView, 'colour' | 'accessory'>[] = [];
  for (const id of ids) views.push(oneLift(id));

  function oneLift(id: string): Omit<LiftView, 'colour' | 'accessory'> {
    const name = opts.nameOf(id);
    const t = liftTermsOf(all, id, targets.get(id) ?? null, opts);
    const { newest, convention, lowerIsBetter, chartable, target } = t;
    const r = t.tracked;
    const points: LiftPointView[] = [];
    // Each real point's top set: the workout it was done in (a PB is judged against everything before it).
    const topAt = new Map<number, number>();
    mondays.forEach((m, week) => {
      const rows = liftRows(all.filter((s) => inWeek(s.date, m)), id, newest);
      if (!chartable) {
        let best = 0;
        for (const { x } of rows) if (WORKING.has(x.setType) && x.counts && x.reps !== null && (x.load === null || x.load.convention === 'bodyweight')) best = Math.max(best, x.reps);
        if (best > 0) points.push({ week, value: best, estimate: false, detail: `${String(best)} reps`, pb: false, pbDetail: null });
        return;
      }
      const reps = r.reps ?? 1;
      const { real, est } = bestSets(rows, t, reps, unit);
      if (real !== null) {
        topAt.set(week, real.at);
        points.push({ week, value: real.load, estimate: false, detail: `${nf(real.load)}${NBSP}×${NBSP}${String(real.reps)}`, pb: false, pbDetail: null });
      }
      else if (est !== null) points.push({ week, value: est.value, estimate: true, detail: `est. ${nf(est.value)}${NBSP}×${NBSP}${String(reps)} from ${nf(est.load)}${NBSP}×${NBSP}${String(est.reps)}`, pb: false, pbDetail: null });
    });
    // PBs: a real point whose top set beats every real set at these reps done before it (that week's earlier
    // workouts and history before the window included), so the chart and the Summary's `New best` agree.
    const loadSuffix = suffixOf(convention);
    if (chartable && opts.historyUnknown?.has(id) !== true) {
      const rows = liftRows(pool, id, newest);
      for (const p of points) {
        const at = topAt.get(p.week);
        if (p.estimate || at === undefined) continue;
        const best = bestSets(rows.filter((x) => x.at < at), t, r.reps ?? 1, unit).real?.load;
        if (best !== undefined && (lowerIsBetter ? p.value < best : p.value > best)) {
          p.pb = true;
          p.pbDetail = plain(`${PROGRESS_COPY.pb} · ${name} ${withSuffix(p.detail, loadSuffix)} · week of ${shortDate(mondays[p.week] ?? from, opts.today)}`);
        }
      }
    }
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
    const latestPb = last?.pb === true;
    const sourceWord = r.source === 'target' ? ' (target reps)' : r.source === 'plan' ? ' (plan reps)' : '';
    const subtitle = !chartable ? `Best reps${last === undefined ? '' : ` · ${String(last.value)} now`}` : `${PROGRESS_COPY.topSet}${NBSP}×${NBSP}${String(r.reps ?? 1)}${sourceWord}${last === undefined ? '' : ` · ${nf(last.value)} now`}`;
    const accessibilityLabel = [
      name,
      chartable && r.reps !== null ? `${String(r.reps)} reps` : null,
      last === undefined ? 'no sets in 8 weeks' : chartable ? `current ${last.estimate ? 'estimated ' : ''}${nf(last.value)} ${unitWord}${latestPb ? ', a personal best' : ''}` : `best ${String(last.value)} reps`,
      changeWords,
      targetValue === null ? 'no target' : `target ${nf(targetValue)} ${unitWord}`,
    ]
      .filter((x): x is string => x !== null)
      .join(', ');
    const est = points.filter((p) => p.estimate).length;
    const pbs = points.filter((p) => p.pb).length;
    const chartLabel = [
      `${name} top set over 8 weeks`,
      points.length === 0 ? 'no sets' : points.map((p) => `${shortDate(mondays[p.week] ?? from, opts.today)} ${p.estimate ? 'estimated ' : ''}${nf(p.value)}${p.pb ? ' personal best' : ''}`).join(', '),
      est > 0 ? `${String(est)} estimated` : null,
      pbs > 0 ? plural(pbs, 'personal best', 'personal bests') : null,
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
      latestPb,
      loadSuffix: chartable ? loadSuffix : null,
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

  // Main lifts are the plan's (in order), drawn up to 3 when they have points; every other lift is an accessory
  // (listed, never drawn). A main lift with no sets in the window stays a main row (`–`, no line). With no
  // plan or split main lifts at all, the lifts shown are the main ones.
  const isMain = (id: string): boolean => (opts.mains.size === 0 ? true : opts.mains.has(id));
  const mainViews = views.filter((v) => isMain(v.exerciseId));
  const drawn = mainViews.filter((v) => v.chartable && v.points.length > 0).slice(0, LIFT_LINES).map((v) => v.exerciseId);
  const lifts: LiftView[] = [
    ...mainViews.map((v) => ({ ...v, colour: drawn.includes(v.exerciseId) ? drawn.indexOf(v.exerciseId) : null, accessory: false })).sort((a, b) => (a.colour ?? LIFT_LINES) - (b.colour ?? LIFT_LINES)),
    ...views.filter((v) => !isMain(v.exerciseId)).map((v) => ({ ...v, colour: null, accessory: true })),
  ];
  const drawnViews = lifts.filter((l) => l.colour !== null);
  const chartLabel = `Top sets over 8 weeks: ${drawnViews
    .map((l) => {
      const a = l.points[0];
      const b = l.points.at(-1);
      return a === undefined || b === undefined ? l.name : `${l.name} ${nf(a.value)} to ${nf(b.value)} ${unit}${l.latestPb ? ', latest a personal best' : ''}`;
    })
    .join(', ')}`;
  return { weeks: mondays.map((m) => plain(shortDate(m, opts.today))), unit, lifts, chartLabel, empty: lifts.length === 0 };
}

/** `each`, `stack`, `assist`, `added`; null for a barbell total (or bodyweight). */
function suffixOf(convention: LoadConvention | null): string | null {
  switch (convention) {
    case 'per_hand':
      return 'each';
    case 'stack':
      return 'stack';
    case 'assistance':
      return 'assist';
    case 'added':
      return 'added';
    case 'total':
    case 'bodyweight':
    case null:
      return null;
  }
}

/** `32.5 × 10` → `32.5 each × 10`. */
function withSuffix(detail: string, suffix: string | null): string {
  if (suffix === null) return detail;
  const at = detail.indexOf(`${NBSP}×`);
  return at < 0 ? detail : `${detail.slice(0, at)}${NBSP}${suffix}${detail.slice(at)}`;
}

/**
 * The loaded window plus older history, each workout once: history entries of one workout (one per tracked
 * lift) are merged into one, so a workout older than the window shows every lift's `New best` (review
 * progress-v3b-design N2).
 */
function withEarlier(all: readonly ReviewSession[], earlier: readonly ReviewSession[] | undefined): ReviewSession[] {
  if (earlier === undefined || earlier.length === 0) return [...all];
  const seen = new Set(all.map((s) => s.sessionId));
  const older = new Map<string, ReviewSession>();
  for (const s of earlier) {
    if (seen.has(s.sessionId)) continue;
    const had = older.get(s.sessionId);
    older.set(s.sessionId, had === undefined ? s : { ...had, exercises: [...had.exercises, ...s.exercises.filter((e) => !had.exercises.some((x) => x.exerciseId === e.exerciseId))] });
  }
  return [...older.values(), ...all].sort((a, b) => a.startedMs - b.startedMs);
}

interface TrackedReps {
  reps: number | null;
  source: LiftRepsSource | null;
  /** The reps before the current source took over (the `now × n` marker). */
  before: number | null;
}

interface LiftTerms {
  newest: ReturnType<typeof newestRow>;
  convention: LoadConvention | null;
  lowerIsBetter: boolean;
  chartable: boolean;
  /** The lift target in use (same load convention), else null. */
  target: LiftTarget | null;
  tracked: TrackedReps;
}

/**
 * A lift's terms (shared by the chart and the Summary's `New best`): its newest load convention and machine,
 * and the reps it is tracked at: the lift target's, else the plan's top set, else what Ben picked when adding
 * it, else his newest top set's.
 */
function liftTermsOf(sessions: readonly ReviewSession[], id: string, t0: LiftTarget | null, opts: Pick<LiftsOptions, 'planReps' | 'pickedReps' | 'previousPlanReps'>): LiftTerms {
  const newest = newestRow(sessions, id);
  const convention = newest?.convention ?? null;
  const target = t0 !== null && convention !== null && t0.load.convention === convention ? t0 : null;
  const plan = opts.planReps.get(id) ?? null;
  const picked = opts.pickedReps[id] ?? null;
  const logged = loggedReps(sessions, id);
  const otherwise = plan ?? picked ?? logged;
  let tracked: TrackedReps;
  if (target !== null) tracked = { reps: target.reps, source: 'target', before: otherwise };
  else if (plan !== null) tracked = { reps: plan, source: 'plan', before: opts.previousPlanReps?.get(id) ?? null };
  else if (picked !== null) tracked = { reps: picked, source: 'picked', before: null };
  else tracked = { reps: logged, source: logged === null ? null : 'logged', before: null };
  return { newest, convention, lowerIsBetter: convention === 'assistance', chartable: convention !== null && convention !== 'bodyweight', target, tracked };
}

type LiftRow = { x: ReviewSession['exercises'][number]['sets'][number]; kind: ReviewSession['exercises'][number]['equipmentKind']; /** The workout's start. */ at: number };

/** A lift's sets in these workouts; stacks and plate-loaded machines only on the newest one's machine. */
function liftRows(sessions: readonly ReviewSession[], id: string, newest: ReturnType<typeof newestRow>): LiftRow[] {
  return sessions.flatMap((s) => s.exercises.filter((e) => e.exerciseId === id && (newest?.machine !== true || (e.equipmentId ?? null) === newest.equipmentId)).flatMap((e) => e.sets.map((x) => ({ x, kind: e.equipmentKind, at: s.startedMs }))));
}

/**
 * The real top set at `reps` (the heaviest load, or least assistance, for at least those reps; for a 1-rep
 * track, a single) and, failing that, the best estimate from a 3–12-rep set. Loads in `unit`, rounded.
 */
function bestSets(rows: readonly LiftRow[], t: Pick<LiftTerms, 'convention' | 'lowerIsBetter'>, reps: number, unit: WeightUnit): { real: (Candidate & { at: number }) | null; est: (Candidate & { value: number }) | null } {
  let real: (Candidate & { at: number }) | null = null;
  let est: (Candidate & { value: number }) | null = null;
  const { convention, lowerIsBetter } = t;
  if (convention === null) return { real, est };
  for (const { x, kind, at } of rows) {
    if (!WORKING.has(x.setType) || !x.counts || x.reps === null || x.reps < 1 || x.load === null || x.load.convention !== convention) continue;
    const v = roundEstimate(convertMass({ value: x.load.value, unit: x.load.unit }, unit).value, unit);
    // A 1-rep top set is a single; any other set only estimates it (review progress-v3-data S1).
    if (reps === 1 ? x.reps === 1 : x.reps >= reps) {
      if (real === null || (lowerIsBetter ? v < real.load : v > real.load)) real = { load: v, reps: x.reps, at };
    } else if (!lowerIsBetter && x.reps >= LIFT_ESTIMATE_REPS.min && x.reps <= LIFT_ESTIMATE_REPS.max && e1rmConventionAllowed(convention, kind)) {
      const value = loadAtReps(v, x.reps, reps, unit);
      if (est === null || value > est.value) est = { load: v, reps: x.reps, value };
    }
  }
  return { real, est };
}

export interface NewBestView {
  exerciseId: string;
  /** `New best · Bench 100 × 6`. */
  text: string;
  accessibilityLabel: string;
}

/**
 * The Summary's PB moment (Progress v3, Ben 21 Oct): the tracked lifts whose real top set in this workout, at
 * their tracked reps, beats every earlier real one (same definition as the Lifts chart's PB ring; assisted:
 * less assistance; same machine for stacks and plate-loaded). A lift's first ever top set isn't a PB (nothing
 * to beat). Bodyweight lifts and estimates never are.
 */
export function sessionNewBests(input: WeeklyReviewInput, opts: Pick<LiftsOptions, 'planReps' | 'pickedReps' | 'nameOf' | 'earlier' | 'historyUnknown'>, sessionId: string): NewBestView[] {
  const unit = input.unit;
  const pool = withEarlier([...input.sessions].sort((a, b) => a.startedMs - b.startedMs), opts.earlier);
  const at = pool.findIndex((s) => s.sessionId === sessionId);
  const session = pool[at];
  if (session === undefined) return [];
  const upTo = pool.slice(0, at + 1);
  const earlier = pool.slice(0, at);
  const targets = new Map(input.liftTargets.map((t) => [t.exerciseId, t]));
  const out: NewBestView[] = [];
  for (const id of [...new Set(input.lifts)]) {
    if (!session.exercises.some((e) => e.exerciseId === id) || opts.historyUnknown?.has(id) === true) continue;
    const t = liftTermsOf(upTo, id, targets.get(id) ?? null, opts);
    if (!t.chartable || t.tracked.reps === null) continue;
    const reps = t.tracked.reps;
    const now = bestSets(liftRows([session], id, t.newest), t, reps, unit).real;
    const before = bestSets(liftRows(earlier, id, t.newest), t, reps, unit).real;
    if (now === null || before === null || !(t.lowerIsBetter ? now.load < before.load : now.load > before.load)) continue;
    const name = opts.nameOf(id);
    const suffix = suffixOf(t.convention);
    const set = withSuffix(`${nf(now.load)}${NBSP}×${NBSP}${String(now.reps)}`, suffix);
    out.push({ exerciseId: id, text: `${PROGRESS_COPY.newBest} · ${name} ${set}`, accessibilityLabel: plain(`New best: ${name}, ${nf(now.load)} ${liftUnitText(unit, t.convention)} for ${String(now.reps)} reps`) });
  }
  return out;
}

/** What `liveNewBestSets` needs besides the workout: the review's input and the Summary's options, read once. */
export interface LiveBestsContext {
  input: WeeklyReviewInput;
  opts: Pick<LiftsOptions, 'planReps' | 'pickedReps' | 'earlier' | 'historyUnknown'>;
}

/**
 * (Ben, 26 Oct; competitor pass 4 #2) The sets of the workout in progress that are a new best the moment they are
 * logged, by exactly the Summary's `New best` (`sessionNewBests`): a tracked lift, at its tracked reps, a real set
 * (never an estimate, rule 6) heavier (assisted: less assistance) than every earlier real one in history and every
 * set before it today; the same machine for stacks and plate-loaded; a lift's first ever top set isn't one; a lift
 * whose older history couldn't be read claims none. Set IDs; pure.
 */
export function liveNewBestSets(ctx: LiveBestsContext, aggregate: SessionAggregate): Set<string> {
  const out = new Set<string>();
  const { input, opts } = ctx;
  const live = reviewSessionOf({ ...aggregate, session: { ...aggregate.session, status: HISTORY_STATUS } }, input.tz, input.nowMs);
  if (live === null) return out;
  const earlier = withEarlier([...input.sessions].filter((x) => x.sessionId !== live.sessionId).sort((a, b) => a.startedMs - b.startedMs), opts.earlier).filter((x) => x.sessionId !== live.sessionId && x.startedMs <= live.startedMs);
  const upTo = [...earlier, live];
  const targets = new Map(input.liftTargets.map((t) => [t.exerciseId, t]));
  const removed = new Set(aggregate.exercises.filter((e) => e.removed !== undefined).map((e) => e.id));
  for (const id of new Set(input.lifts)) {
    if (!live.exercises.some((e) => e.exerciseId === id) || opts.historyUnknown?.has(id) === true) continue;
    const t = liftTermsOf(upTo, id, targets.get(id) ?? null, opts);
    if (!t.chartable || t.tracked.reps === null || t.convention === null) continue;
    const reps = t.tracked.reps;
    const before = bestSets(liftRows(earlier, id, t.newest), t, reps, input.unit).real;
    if (before === null) continue;
    let best = before.load;
    const rows = aggregate.exercises.filter((e) => e.exerciseId === id && !removed.has(e.id) && (t.newest?.machine !== true || (e.equipmentId ?? null) === t.newest.equipmentId));
    const sets = aggregate.sets
      .filter((x) => rows.some((e) => e.id === x.sessionExerciseId) && x.status === 'completed' && x.actual !== null)
      .sort((a, b) => (a.completedAt?.utc ?? '').localeCompare(b.completedAt?.utc ?? '') || a.index - b.index);
    for (const x of sets) {
      const load = x.actual?.load ?? null;
      const r = x.actual?.reps ?? null;
      if (!WORKING.has(x.setType) || !isSetCountable(x, 'record') || r === null || r < 1 || load === null || load.convention !== t.convention) continue;
      if (reps === 1 ? r !== 1 : r < reps) continue;
      const v = roundEstimate(convertMass({ value: load.value, unit: load.unit }, input.unit).value, input.unit);
      if (t.lowerIsBetter ? v < best : v > best) {
        out.add(x.id);
        best = v;
      }
    }
  }
  return out;
}

/**
 * Older history of one lift (`listExerciseHistory`) as review workouts, for PBs beyond the loaded window. Only
 * what a PB needs: the sets, their load, reps and whether they count, and the machine.
 */
export function liftHistorySessions(exerciseId: string, history: readonly { sessionId: string; performedAtUtc: string; equipmentId: string | null; tz?: string; sets: readonly { setType: SetType; load: ReviewSession['exercises'][number]['sets'][number]['load']; reps: number | null; exclusions?: readonly SetExclusion[] }[] }[], tz: string): ReviewSession[] {
  return history.map((h) => {
    const ms = toMs(h.performedAtUtc);
    return {
      sessionId: h.sessionId,
      name: null,
      date: localDateOf(ms, h.tz ?? tz),
      startedMs: ms,
      startedAtUtc: h.performedAtUtc,
      routineId: null,
      template: null,
      feel: null,
      plannedReps: null,
      doneReps: 0,
      exercises: [{ exerciseId, name: '', equipmentKind: null, equipmentId: h.equipmentId, plannedWorking: 0, sets: h.sets.map((x) => ({ setType: x.setType, load: x.load, reps: x.reps, rpe: null, targetRpe: null, counts: isSetCountable(x, 'record') })) }],
    };
  });
}

// ---------------------------------------------------------------------------
// Muscles

/**
 * (D5, Ben 22–23 Oct) Muscles counts by the detailed list, in this order. A broad group (Legs, Arms) is exactly the
 * sum of its rows, so it has no row of its own. Glutes count as Hamstrings (the builder's `Hamstrings & glutes`),
 * rear delts as Back, hip flexors as Core, shins as Calves; forearm work counts in no row.
 */
export const MUSCLE_ROWS = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Calves', 'Biceps', 'Triceps', 'Core'] as const;
export type MuscleRow = (typeof MUSCLE_ROWS)[number];

const ROW_OF_GROUP = {
  Chest: 'Chest',
  Back: 'Back',
  Shoulders: 'Shoulders',
  Quads: 'Quads',
  Hamstrings: 'Hamstrings',
  Glutes: 'Hamstrings',
  Calves: 'Calves',
  Biceps: 'Biceps',
  Triceps: 'Triceps',
  Core: 'Core',
  Forearms: null,
} as const satisfies Record<MuscleGroup, MuscleRow | null>;

/** A muscle group's counting row (`Glutes` → `Hamstrings`); null for Forearms. */
export function muscleRowOfGroup(g: MuscleGroup): MuscleRow | null {
  return ROW_OF_GROUP[g];
}

/** The counting row an exercise's working sets go to: its lead muscle group's (`leadMuscleGroup`), or null. */
export function muscleRowOf(exerciseInfo: Parameters<typeof leadMuscleGroup>[0]): MuscleRow | null {
  const g = leadMuscleGroup(exerciseInfo);
  return g === null ? null : muscleRowOfGroup(g);
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
 * templates, only in weeks under that plan and not paused; a week with a stored review keeps that review's plan.
 */
/**
 * A stored weekly review's planned sets per muscle row (its `group_sets` facts: the week's plan as it was
 * when reviewed). Null: the review had no plan line that week (no plan, paused, another plan's week).
 */
export function musclePlanOfReview(r: Pick<TrainingReview, 'facts'>): Map<MuscleRow, number> | null {
  const out = new Map<MuscleRow, number>();
  let any = false;
  for (const f of r.facts) {
    if (f.kind !== 'group_sets' || f.planned === null) continue;
    any = true;
    const row = muscleRowOfGroup(f.group);
    if (row !== null) out.set(row, (out.get(row) ?? 0) + f.planned);
  }
  return any ? out : null;
}

export function musclesView(input: WeeklyReviewInput, opts: { today: string; /** Each reviewed week's stored plan (`musclePlanOfReview`), by its Monday: past weeks keep the plan they had. */ storedPlans?: ReadonlyMap<string, ReadonlyMap<MuscleRow, number> | null> }): MuscleTrackerView {
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
    let planned: ReadonlyMap<MuscleRow, number> | null = null;
    const plan = c.plan;
    const stored = opts.storedPlans;
    // A reviewed week keeps the plan it was reviewed against (an auto +1 set or a later edit never re-judges it); live templates only for a week with no review.
    if (stored?.has(m) === true) planned = paused ? null : (stored.get(m) ?? null);
    else if (plan !== null && !paused && pausedInWeek(m, plan.pausedDates) === 0) {
      const days = new Set(plan.days.map((d) => d.routineId));
      const templates = input.templates.filter((t) => t.planId === plan.planId && days.has(t.routineId));
      if (templates.length > 0) {
        const live = new Map<MuscleRow, number>();
        for (const t of templates)
          for (const e of t.exercises) {
            const row = muscleRowOf(input.info(e.exerciseId));
            if (row !== null && e.workingSets > 0) live.set(row, (live.get(row) ?? 0) + e.workingSets);
          }
        planned = live;
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
 * Skip; rule 3) or a change on the same exercises (sets). A change on the same exercises is applied for the
 * next sessions by the review itself only when it is CA8-small (`autoApplicable`), shown with its reason and
 * Undo; any other one is asked too (Ben, 23 Oct, D2).
 */
const SMALL_CHANGES: ReadonlySet<ReviewProposal['change']['kind']> = new Set(['template_sets']);

export function isStructuralProposal(p: Pick<ReviewProposal, 'change'>): boolean {
  return !SMALL_CHANGES.has(p.change.kind);
}

/**
 * Why a weekly change waits for Ben's Apply (Ben, 23 Oct, D2: the coach never applies unasked changes;
 * coach-adjustments CA8 decides what is small). Empty: small, so the review applies it itself.
 * - `structural`: swaps, adds, removes, day moves, order (rule 3).
 * - `no_reason`: the number check hid its reason; an automatic change is never made without its why
 *   (review progress-v3-design B3).
 * - `added_sets`: more working sets. Nobody asked in a weekly review, so an added set is always Ben's to
 *   apply (D2; CA8: +1 only when Ben asked).
 * - `sets_step`: the count moves by more than one (CA8).
 * - `stall`: the reviewed week flags this lift as stalled (`stalled_lift`), so any change to it is a stall
 *   response (playbook rule 8: resets are proposals; D2: stall resets always need Apply).
 * - `from_edits`: code's own (§6.1, the same edit repeated). It is Ben's own structure, kept for next time only
 *   by his Apply (D1; rule 3; workout-builder-v3 §6.1 "suggests"), never by the review (review v5offers B1).
 * - `offered`: stored as an offer (`ReviewProposal.offer`): once it waited for Ben's Apply it stays an offer,
 *   whatever a later run's facts say (review v5offers 4).
 */
export type WeeklyOfferReason = 'structural' | 'no_reason' | 'added_sets' | 'sets_step' | 'stall' | 'from_edits' | 'offered';

export interface WeeklyChangeContext {
  /** Exercises the reviewed week flags as stalled (`stalledOfReview`). */
  stalled: ReadonlySet<string>;
}

type ClassifiedProposal = Pick<ReviewProposal, 'change' | 'reason' | 'source'> & Partial<Pick<ReviewProposal, 'offer'>>;

export function weeklyOfferReasons(p: ClassifiedProposal, ctx: WeeklyChangeContext): WeeklyOfferReason[] {
  const out: WeeklyOfferReason[] = [];
  if (isStructuralProposal(p)) out.push('structural');
  if (p.reason === null) out.push('no_reason');
  const delta = p.change.toSets - p.change.fromSets;
  if (delta > 0) out.push('added_sets');
  if (Math.abs(delta) > 1) out.push('sets_step');
  if (ctx.stalled.has(p.change.exerciseId)) out.push('stall');
  if (p.source === 'code') out.push('from_edits');
  if (p.offer === true) out.push('offered');
  return out;
}

/**
 * A proposal as a review stores it (D2; review v5offers 4): marked `offer` when it waits for Ben's Apply under
 * `ctx` (the facts of the review it belongs to), so a later run never re-classifies it as small and applies it.
 * The mark is never removed.
 */
export function withOfferMark<P extends ClassifiedProposal>(p: P, ctx: WeeklyChangeContext): P {
  if (p.offer === true || weeklyOfferReasons(p, ctx).length === 0) return p;
  return { ...p, offer: true };
}

/** The lifts a stored weekly review flags as stalled (its `stalled_lift` facts: code's, from stored records). */
export function stalledOfReview(r: Pick<TrainingReview, 'facts'>): Set<string> {
  const out = new Set<string>();
  for (const f of r.facts) if (f.kind === 'stalled_lift') out.add(f.exerciseId);
  return out;
}

/**
 * Whether the review applies this change itself (rule 3, Progress v3, narrowed by D2 on 23 Oct): only the
 * coach's CA8-small change with its reason, which for a plan day's working sets means one set fewer on a lift
 * that isn't stalled, never stored as an offer. Everything else (code's own included) is an offer (Apply /
 * Skip), never written before Ben's tap.
 */
export function autoApplicable(p: ClassifiedProposal, ctx: WeeklyChangeContext): boolean {
  return weeklyOfferReasons(p, ctx).length === 0;
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
  /** Waits for Ben's Apply (D2): structural, or not CA8-small (`weeklyOfferReasons`). Never applied by the review itself. */
  offer: boolean;
  /** Undo while applied (and Ben can Redo an undone one). */
  canUndo: boolean;
  canRedo: boolean;
  /** Not made yet: Apply / Skip (an offer, or a small change not applied yet). */
  canApply: boolean;
  /** `Not applied` (a small change the review hasn't applied yet), `Undone`, `Out of date`, `Skipped`; null while applied or offered. */
  statusText: string | null;
  accessibilityLabel: string;
}

export interface CoachChangesView {
  reviewId: string;
  version: number;
  /** `w/c 13 Oct` of the reviewed week. */
  week: string;
  /** The section label's right side: `for next week`, or the week when this review is older than the latest reviewable week. */
  right: string;
  /** Whether this review is for the latest reviewable week (its changes are next week's). */
  current: boolean;
  /** A new weekly review Ben hasn't dismissed with `Got it` (or acted on every change of). */
  isNew: boolean;
  /** The coach's sentence; null when it didn't review. */
  note: string | null;
  /** `Coach`, or why not: `Not reviewed · Offline`, `Reviewing…`. */
  tag: string;
  reviewed: boolean;
  /** Small changes already made for the next sessions (and Ben's undone ones). */
  rows: ChangeRowView[];
  /** Changes asked (Apply / Skip): every offer (structural, not CA8-small, a stall response), and any small one not made. */
  asks: ChangeRowView[];
  /** `3 changes for next week`, `1 change for next week · 1 to review`, `1 to review`, `No changes for next week`. */
  collapsed: string;
  /** What Ben saw (the coach's words and the changes, not their statuses): `Got it` still marks it after a status-only update. */
  contentKey: string;
}

/**
 * (Ben, 23 Oct) The scope of a weekly change to a plan day's template: every future workout of that day (rule 2:
 * an honest scope). One plain word takes an `s` (`future Pulls`); anything else reads `future Legs days`,
 * `future Push A days`.
 */
export function futureDaysText(routineName: string): string {
  const n = routineName.trim();
  return /^[A-Za-z]+$/.test(n) && !/s$/i.test(n) ? `future ${n}s` : `future ${n} days`;
}

export function changeRowView(p: ReviewProposal, opts: { painFlagged?: ReadonlySet<string>; stalled?: ReadonlySet<string> } = {}): ChangeRowView {
  const c = p.change;
  const structural = isStructuralProposal(p);
  const offer = !autoApplicable(p, { stalled: opts.stalled ?? new Set() });
  const before = plural(c.fromSets, 'set', 'sets');
  const after = plural(c.toSets, 'set', 'sets');
  // (Ben, 23 Oct) Apply changes the plan day's template: every future workout of that day, never just the next one.
  const when = futureDaysText(c.routineName);
  // A change held by a pain flag names it (rule 9; review build-b-21oct S3), never `Out of date`: refused for
  // pain, or still open on a movement flagged since.
  // Only while the flag is active (review progress-v3b S1/S3): once Ben clears it, a change held for it reads
  // `Out of date` (a re-run may offer it again); a change refused because the plan moved never reads as pain.
  const flagged = opts.painFlagged?.has(c.exerciseId) === true;
  const pain = flagged && (p.status === 'open' || (p.status === 'stale' && p.held === 'pain'));
  // An open small change isn't in the plan yet (the review is still applying it, its apply failed, or it is an
  // older week's): never drawn as made (review progress-v3-design B1). An open offer is simply asked (D2).
  const statusText = pain
    ? PROGRESS_COPY.heldPain
    : p.status === 'undone'
      ? PROGRESS_COPY.undone
      : p.status === 'stale'
        ? PROGRESS_COPY.outOfDate
        : p.status === 'skipped'
          ? PROGRESS_COPY.skipped
          : p.status === 'open' && !offer
            ? PROGRESS_COPY.notApplied
            : null;
  const said = statusText === PROGRESS_COPY.heldPain ? 'Held for a pain flag' : statusText;
  const words = p.status === 'undone' ? `${c.exerciseName}: kept ${before}. Undone` : `${c.exerciseName}: ${before} to ${after}, ${when}${p.reason === null ? '' : `. ${p.reason}`}${said === null ? '' : `. ${said}`}`;
  return {
    id: p.id,
    exercise: c.exerciseName,
    before,
    after,
    when,
    why: p.reason,
    status: p.status,
    structural,
    offer,
    canUndo: p.status === 'applied' && p.actionId !== null,
    canRedo: p.status === 'undone' && !structural && opts.painFlagged?.has(c.exerciseId) !== true,
    canApply: p.status === 'open' && !pain,
    statusText,
    accessibilityLabel: words,
  };
}

/**
 * (Review v5offers B2) What a change row's buttons do, in order: one mapping for every screen, so a button can only
 * ever call the action its label names. Open and answerable: Apply, Skip. Applied: Undo. Undone: Redo (a Redo, never
 * an Apply: the row isn't open, and Apply refuses anything that isn't). Nothing else has a button.
 */
export type ChangeTap = 'apply' | 'skip' | 'undo' | 'redo';

export function changeRowTaps(row: Pick<ChangeRowView, 'status' | 'canApply' | 'canUndo' | 'canRedo'>): ChangeTap[] {
  if (row.status === 'open') return row.canApply ? ['apply', 'skip'] : [];
  const out: ChangeTap[] = [];
  if (row.canUndo) out.push('undo');
  if (row.canRedo) out.push('redo');
  return out;
}

/** A change row's button label (`Apply`, `Skip`, `Undo`, `Redo`). */
export const CHANGE_TAP_LABEL: Readonly<Record<ChangeTap, string>> = { apply: PROGRESS_COPY.apply, skip: PROGRESS_COPY.skip, undo: PROGRESS_COPY.undo, redo: PROGRESS_COPY.redo };

/** A stable key of what a review shows Ben (coach words, changes), statuses left out. */
export function changesContentKey(r: Pick<TrainingReview, 'coach' | 'proposals'>): string {
  const coach = r.coach.status === 'reviewed' ? { s: r.coach.status, v: r.coach.verdict, l: r.coach.lines } : { s: r.coach.status };
  return deriveId(`changes:${stableStringify({ coach, proposals: (r.proposals ?? []).map((p) => ({ id: p.id, change: p.change, reason: p.reason })) })}`);
}

export interface CoachChangesOptions {
  /** Whether the review is for the latest reviewable week (default true). An older one isn't `for next week`. */
  current?: boolean;
  /** Proposals Ben acted on himself (Undo, Redo, Apply, Skip). When every change is his, the section collapses. */
  actedOn?: ReadonlySet<string>;
  /** Exercises with an active pain flag: their changes read `Held · pain` (rule 9). */
  painFlagged?: ReadonlySet<string>;
  /** The coach is being asked right now (review build-b-21oct S2): `Reviewing…`, not the last result. */
  reviewing?: boolean;
}

/** The newest weekly review as Coach's changes (Progress v3, bottom of the page). */
export function coachChangesView(r: TrainingReview, today: string, opts: CoachChangesOptions = {}): CoachChangesView | null {
  if (r.subject.kind !== 'weekly') return null;
  const v = verdictOf(r);
  const current = opts.current ?? true;
  const proposals = r.proposals ?? [];
  const stalled = stalledOfReview(r);
  const all = proposals.map((p) => changeRowView(p, opts.painFlagged === undefined ? { stalled } : { painFlagged: opts.painFlagged, stalled }));
  // Offers stay with the asks once answered (Apply → Undo there; Skip → `Skipped`), as structural ones did.
  const rows = all.filter((x) => !x.offer && x.status !== 'open');
  const asks = all.filter((x) => x.offer || x.status === 'open');
  const made = all.filter((x) => x.status === 'applied').length;
  // Still waiting for Ben (Apply / Skip): never hidden behind `No changes` once the section collapses (review v5offers 3).
  const waiting = all.filter((x) => x.status === 'open' && x.canApply).length;
  const week = plain(`w/c ${shortDate(r.subject.weekMonday, today)}`);
  const acted = opts.actedOn ?? new Set<string>();
  const allActed = proposals.length > 0 && proposals.every((p) => acted.has(p.id));
  const madeText = made === 0 ? null : current ? `${plural(made, 'change', 'changes')} for next week` : plural(made, 'change', 'changes');
  const parts = [madeText, waiting === 0 ? null : PROGRESS_COPY.toReview(waiting)].filter((x): x is string => x !== null);
  const changes = parts.length > 0 ? parts.join(' · ') : current ? 'No changes for next week' : 'No changes';
  return {
    reviewId: r.id,
    version: r.version,
    week,
    right: current ? PROGRESS_COPY.forNextWeek : week,
    current,
    isNew: current && r.seenAtUtc === undefined && !allActed,
    note: v.reviewed ? v.verdict : null,
    tag: opts.reviewing === true && !v.reviewed ? REVIEW_COPY.reviewing : v.reviewed ? PROGRESS_COPY.coach : v.verdict,
    reviewed: v.reviewed,
    rows,
    asks,
    collapsed: changes,
    contentKey: changesContentKey(r),
  };
}
