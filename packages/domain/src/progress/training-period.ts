import { addDays, daysBetween, weekdayIndexOfDate } from '../calendar';
import { NBSP } from '../display';
import type { ActivityRow } from '../activity';
import { countSessions, oneDecimal, timeInGym } from './activity';
import { calendarSessionRow, type CalendarSessionRow } from './calendar-view';
import { countRowSets, type MuscleInfo } from './muscles';
import { mondayOf } from './exercise';
import type { PeriodBarView } from './period-bar';
import { planDayColour, planDayHues, planDayKey, type PlanDayColour } from './plan-day-colours';
import type { ProgressSession } from './projection';
import { countNoun, dayMonth, gymTimeText, gymTimeWords, monthName, weekdayDayMonthLong, WEEKDAY_LETTER } from './text';
import { inRange, type DateRange } from './window';

/**
 * (Redesign v3 C3, C4; Ben 27 Oct) Progress › Training for the period bar's period: the Month calendar (shaded day
 * tiles, one dot per gym session coloured by its plan day, a ring per activity, legend), the Week's 7 days, or the
 * 3M/6M/1Y bar per week; and the totals against the previous period. Only what was logged (rule 6): no planned day is
 * drawn, nothing is estimated. Pure; the screen lays it out.
 */

/** The plan in use: its day names in plan order and the routines each day was made from (older workouts carry only those). */
export interface TrainingPlanDays {
  planId: string;
  days: readonly { dayIndex: number; name: string; routineIds: readonly string[] }[];
}

/** The plan in use's days for the calendar: its version's day names and each routine made for a day (`planDayOf`). */
export function trainingPlanDays(planId: string, dayNames: readonly string[], routines: readonly { id: string; dayIndex: number | null }[]): TrainingPlanDays {
  return {
    planId,
    days: dayNames.map((name, dayIndex) => ({ dayIndex, name, routineIds: routines.filter((r) => r.dayIndex === dayIndex).map((r) => r.id) })),
  };
}

export interface TrainingActivityInput {
  date: string;
  row: ActivityRow;
}

export interface TrainingPeriodInput {
  /** Every finished workout, any order. */
  sessions: readonly ProgressSession[];
  exercises: ReadonlyMap<string, MuscleInfo>;
  gymNames?: Readonly<Record<string, string>>;
  today: string;
  bar: PeriodBarView;
  plan: TrainingPlanDays | null;
  /** Done activities in the bar's whole period (Month and Week only; ignored otherwise). */
  activities?: readonly TrainingActivityInput[];
  /** Ben's days-a-week aim (Profile); null: none, so no week is greyed. */
  aim: number | null;
  /** The first day with anything logged: no delta against a period wholly before it (nothing to compare). */
  earliest: string;
}

export type TileMark = { kind: 'dot'; colour: PlanDayColour } | { kind: 'ring' };

/** What a day tile opens: its one workout or activity, or (several) the day's list under the grid. */
export type TileOpen = { kind: 'session'; sessionId: string } | { kind: 'activity'; activityId: string } | { kind: 'day'; date: string };

export interface DayTile {
  date: string;
  day: number;
  /** `done`: any workout or activity (light green); `future`: after today (faded). */
  state: 'done' | 'empty' | 'future';
  isToday: boolean;
  /** At most `TILE_MARKS_MAX`; `more` counts the rest. */
  marks: TileMark[];
  more: number;
  /** `Tuesday 27 October, today, Push, Run`. */
  words: string;
  open: TileOpen | null;
}

export interface LegendItem {
  key: string;
  label: string;
  mark: TileMark;
}

export interface DayListRow {
  key: string;
  kind: 'session' | 'activity';
  id: string;
  title: string;
  detail: string;
  colour: PlanDayColour | null;
  words: string;
}

export interface TotalItem {
  key: 'sessions' | 'time' | 'sets' | 'per_week';
  value: string;
  label: string;
  /** `+2 vs Sep` (the first item names the period), `+1 h 10`, `−24`; null when there's nothing honest to compare. */
  delta: string | null;
  words: string;
}

export interface WeekBar {
  monday: string;
  count: number;
  /** A finished week under the aim (greyed); null with no aim or for the week in progress. */
  underAim: boolean | null;
  current: boolean;
  words: string;
}

export interface TrainingPeriodView {
  /** Month: Monday-first rows of 7 (null pads days outside the month). */
  month: { weeks: (DayTile | null)[][]; workouts: { label: string; count: number; month: string; words: string } } | null;
  /** Week: the 7 days. */
  week: DayTile[] | null;
  /** 3M/6M/1Y: one bar per Monday–Sunday week starting in the period, up to this week. */
  bars: { weeks: WeekBar[]; max: number; aim: string | null; /** The aim's height, 0–1 of `max` (drawn as a line); null with none. */ aimLine: number | null; first: string; last: string; words: string } | null;
  /** Shown for Month and Week (the dots need it); every colour used plus neutral and the ring, never colour alone. */
  legend: LegendItem[];
  weekdayLetters: readonly string[];
  /** Days with more than one thing: the list a tap shows under the grid. */
  dayRows: Readonly<Record<string, DayListRow[]>>;
  totals: TotalItem[];
  totalsWords: string;
}

export const TILE_MARKS_MAX = 3;

const ACTIVITY_LEGEND = 'Run / other';

/** Working sets: hard and easy, not warm-ups (as the calendar's day rows count them). */
function workingSets(s: ProgressSession): number {
  return s.exercises.reduce((n, ex) => {
    const c = countRowSets(ex);
    return n + c.hard + c.easy;
  }, 0);
}

/** The plan day a workout was, by name; null for a workout that wasn't a plan day. */
export function sessionPlanDayName(s: Pick<ProgressSession, 'planDay' | 'routineId' | 'name'>, plan: TrainingPlanDays | null): string | null {
  if (plan !== null) {
    if (s.planDay !== undefined && s.planDay.planId === plan.planId) {
      const day = plan.days.find((d) => d.dayIndex === s.planDay?.dayIndex);
      if (day !== undefined) return day.name;
    }
    if (s.routineId !== undefined) {
      const day = plan.days.find((d) => d.routineIds.includes(s.routineId ?? ''));
      if (day !== undefined) return day.name;
    }
  }
  // A day of another (older) plan: its own name, so it still gets its day's colour.
  if (s.planDay !== undefined) return s.name !== null && s.name.trim() !== '' ? s.name : null;
  return null;
}

function signedCount(n: number): string {
  return n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '±0';
}

/** `+1 h 10`, `−25 min`, `±0`. */
function signedTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes === 0) return '±0';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${String(m)}${NBSP}min`;
  return m === 0 ? `${sign}${String(h)}${NBSP}h` : `${sign}${String(h)}${NBSP}h ${String(m)}`;
}

export function buildTrainingPeriodView(input: TrainingPeriodInput): TrainingPeriodView {
  const { bar, today } = input;
  const window = bar.window;
  const gymNames = input.gymNames ?? {};
  const planNames = input.plan?.days.map((d) => d.name) ?? [];
  const inWindow = input.sessions.filter((s) => inRange(s.date, window)).sort((a, b) => a.startedMs - b.startedMs);

  // Totals against the whole previous period. Nothing to compare when it lies wholly before the first log.
  const counts = countSessions(input.sessions, window);
  const time = timeInGym(input.sessions, window);
  const comparable = window.previous.to >= input.earliest;
  let sets = 0;
  for (const s of inWindow) sets += workingSets(s);
  let prevSets = 0;
  for (const s of input.sessions) if (inRange(s.date, window.previous)) prevSets += workingSets(s);
  // A time delta only when every workout in both periods has a time (imports have none): never a part-total as a change.
  const timedFully = time.timedCount === time.sessionCount && time.previousTimedCount === counts.previousCount;
  const vs = `vs ${bar.previousLabel}`;
  const sessionsDelta = comparable ? `${signedCount(counts.count - counts.previousCount)} ${vs}` : null;
  const totals: TotalItem[] = [
    { key: 'sessions', value: String(counts.count), label: 'Sessions', delta: sessionsDelta, words: `${countNoun(counts.count, 'session', 'sessions')}${sessionsDelta === null ? '' : `, ${sessionsDelta.replace('−', 'minus ').replace('±0', 'same')}`}` },
    {
      key: 'time',
      value: time.timedCount === 0 ? '—' : gymTimeText(time.totalMs),
      label: 'Time',
      delta: comparable && timedFully && time.sessionCount + counts.previousCount > 0 ? signedTime(time.totalMs - time.previousTotalMs) : null,
      words: time.timedCount === 0 ? 'Time not available' : `Time ${gymTimeWords(time.totalMs)}`,
    },
  ];
  if (bar.span === 'week' || bar.span === 'month') {
    const d = comparable ? signedCount(sets - prevSets) : null;
    totals.push({ key: 'sets', value: String(sets), label: 'Sets', delta: d, words: `${countNoun(sets, 'set', 'sets')}${d === null ? '' : `, ${d.replace('−', 'minus ').replace('±0', 'same')}`}` });
  } else {
    const perWeek = oneDecimal(counts.count / (window.days / 7));
    totals.push({ key: 'per_week', value: perWeek.toFixed(1), label: 'A week', delta: null, words: `${perWeek.toFixed(1)} a week` });
  }
  const totalsWords = totals.map((t) => t.words).join('. ');

  // Day tiles (Month and Week): every session a dot by its plan day, every done activity a ring.
  const hues = planDayHues(planNames);
  const byDate = new Map<string, ProgressSession[]>();
  for (const s of inWindow) {
    const list = byDate.get(s.date);
    if (list === undefined) byDate.set(s.date, [s]);
    else list.push(s);
  }
  const actsByDate = new Map<string, ActivityRow[]>();
  const tiled = bar.span === 'week' || bar.span === 'month';
  for (const a of tiled ? (input.activities ?? []) : []) {
    if (!inRange(a.date, bar.full) || a.row.planned) continue;
    const list = actsByDate.get(a.date);
    if (list === undefined) actsByDate.set(a.date, [a.row]);
    else list.push(a.row);
  }
  const legendNames = new Map<string, string>();
  for (const n of planNames) legendNames.set(planDayKey(n), n);
  const dayRows: Record<string, DayListRow[]> = {};
  const tile = (date: string): DayTile => {
    const ss = byDate.get(date) ?? [];
    const acts = actsByDate.get(date) ?? [];
    const named = ss.map((s) => ({ s, name: sessionPlanDayName(s, input.plan) }));
    const marks: TileMark[] = [];
    for (const { name } of named) {
      const colour = name === null ? 'neutral' : planDayColour(name, planNames);
      if (colour !== 'neutral' && name !== null && !legendNames.has(planDayKey(name))) legendNames.set(planDayKey(name), name);
      marks.push({ kind: 'dot', colour });
    }
    for (let i = 0; i < acts.length; i += 1) marks.push({ kind: 'ring' });
    const future = date > today;
    const any = ss.length + acts.length;
    const parts = [...named.map(({ s, name }) => name ?? sessionTitle(s, input.exercises, gymNames)), ...acts.map((a) => a.title)];
    const words = `${weekdayDayMonthLong(date)}${date === today ? ', today' : ''}${parts.length === 0 ? '' : `, ${parts.join(', ')}`}`;
    let open: TileOpen | null = null;
    if (any === 1) {
      const s = ss[0];
      const a = acts[0];
      open = s !== undefined ? { kind: 'session', sessionId: s.sessionId } : a !== undefined ? { kind: 'activity', activityId: a.activityId } : null;
    } else if (any > 1) {
      open = { kind: 'day', date };
      dayRows[date] = [
        ...named.map(({ s, name }): DayListRow => {
          const row: CalendarSessionRow = calendarSessionRow(s, input.exercises, gymNames);
          return { key: `s:${s.sessionId}`, kind: 'session', id: s.sessionId, title: row.title, detail: row.detail, colour: name === null ? 'neutral' : planDayColour(name, planNames), words: row.words };
        }),
        ...acts.map((a): DayListRow => ({ key: `a:${a.activityId}`, kind: 'activity', id: a.activityId, title: a.title, detail: a.detail, colour: null, words: a.accessibilityLabel })),
      ];
    }
    return {
      date,
      day: Number(date.slice(8, 10)),
      state: future ? 'future' : any > 0 ? 'done' : 'empty',
      isToday: date === today,
      marks: marks.slice(0, TILE_MARKS_MAX),
      more: Math.max(0, marks.length - TILE_MARKS_MAX),
      words,
      open,
    };
  };

  let month: TrainingPeriodView['month'] = null;
  let week: TrainingPeriodView['week'] = null;
  let bars: TrainingPeriodView['bars'] = null;
  if (bar.span === 'month') {
    const first = bar.full.from;
    const length = daysBetween(first, bar.full.to) + 1;
    const weeks: (DayTile | null)[][] = [];
    let row: (DayTile | null)[] = Array.from({ length: weekdayIndexOfDate(first) }, () => null);
    for (let i = 0; i < length; i += 1) {
      row.push(tile(addDays(first, i)));
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length > 0) weeks.push([...row, ...Array.from({ length: 7 - row.length }, () => null)]);
    const name = monthName(first.slice(0, 7));
    month = { weeks, workouts: { label: `${name} workouts`, count: inWindow.length, month: first.slice(0, 7), words: `${name} workouts, ${String(inWindow.length)}` } };
  } else if (bar.span === 'week') {
    week = Array.from({ length: 7 }, (_, i) => tile(addDays(bar.full.from, i)));
  } else {
    bars = weekBars(input.sessions, bar.full, today, input.aim);
  }

  const legend: LegendItem[] = [];
  if (tiled) {
    for (const [key, label] of legendNames) legend.push({ key: `d:${key}`, label, mark: { kind: 'dot', colour: hues.get(key) ?? planDayColour(label, planNames) } });
    // Always shown, so the legend is never empty and never colour alone.
    legend.push({ key: 'neutral', label: planNames.length === 0 ? 'Workout' : 'Other', mark: { kind: 'dot', colour: 'neutral' } });
    legend.push({ key: 'activity', label: ACTIVITY_LEGEND, mark: { kind: 'ring' } });
  }

  return { month, week, bars, legend, weekdayLetters: WEEKDAY_LETTER, dayRows, totals, totalsWords };
}

function sessionTitle(s: ProgressSession, exercises: ReadonlyMap<string, MuscleInfo>, gymNames: Readonly<Record<string, string>>): string {
  return calendarSessionRow(s, exercises, gymNames).title;
}

/** One bar per Monday–Sunday week whose Monday is in `full`, up to this week; weeks under the aim greyed once over. */
export function weekBars(sessions: readonly ProgressSession[], full: DateRange, today: string, aim: number | null): NonNullable<TrainingPeriodView['bars']> {
  const firstMonday = weekdayIndexOfDate(full.from) === 0 ? full.from : addDays(mondayOf(full.from), 7);
  const lastDay = full.to < today ? full.to : today;
  const thisMonday = mondayOf(today);
  const mondays: string[] = [];
  // Bounded (hang fix, 27 Oct): far more weeks than any period holds.
  for (let m = firstMonday; m <= lastDay && mondays.length < 600; m = addDays(m, 7)) mondays.push(m);
  const counts = new Map<string, number>(mondays.map((m) => [m, 0]));
  const end = mondays.length === 0 ? firstMonday : addDays(mondays[mondays.length - 1] ?? firstMonday, 6);
  for (const s of sessions) {
    if (s.date < firstMonday || s.date > end) continue;
    const m = mondayOf(s.date);
    const n = counts.get(m);
    if (n !== undefined) counts.set(m, n + 1);
  }
  const weeks: WeekBar[] = mondays.map((monday) => {
    const count = counts.get(monday) ?? 0;
    const current = monday === thisMonday;
    const underAim = aim === null || aim <= 0 || current ? null : count < aim;
    return { monday, count, underAim, current, words: `Week of ${dayMonth(monday)}: ${countNoun(count, 'session', 'sessions')}${underAim === true ? ', under your aim' : ''}${current ? ', this week' : ''}` };
  });
  const last = weeks[weeks.length - 1];
  const max = Math.max(aim ?? 0, 1, ...weeks.map((w) => w.count));
  return {
    weeks,
    max,
    aim: aim === null || aim <= 0 ? null : `aim ${String(aim)}`,
    aimLine: aim === null || aim <= 0 ? null : aim / max,
    first: weeks[0] === undefined ? '' : dayMonth(weeks[0].monday),
    last: last === undefined ? '' : last.current ? 'this week' : dayMonth(last.monday),
    words: `Sessions per week, ${countNoun(weeks.length, 'week', 'weeks')}${aim === null || aim <= 0 ? '' : `, aim ${String(aim)}`}. ${weeks.map((w) => w.words).join('. ')}`,
  };
}
