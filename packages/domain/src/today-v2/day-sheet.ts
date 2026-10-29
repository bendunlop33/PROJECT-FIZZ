import { addDays, weekdayIndexOfDate } from '../calendar';
import { mondayOf } from '../progress/exercise';

/**
 * The day sheet (Ben, 29 Oct: "I don't find it easy to see what the plan for each day is and then change what I plan
 * on doing"; docs/design/day-sheet.md): tap a day on Today's week (or a day row on Library › Plan) and see that day's
 * plan day, its status this week and what can change, this week only. Pure: only what is logged or planned (rule 6).
 *
 * - `weekPlanDays`: each plan day's date and status this week. Done (the day it was done, one workout one plan day),
 *   Skipped, then Set days: Today, Missed (its weekday has gone) or Planned on its weekday; Any days: Today for the
 *   card's day, else Planned one a day after today in plan order (as the tiles place them), or undated.
 * - `daySheetOf`: a date's sheet (or a plan day's, from Library): its title (`Thu · Push B`), status and actions.
 */

export type DayStatus = 'done' | 'today' | 'planned' | 'missed' | 'skipped' | 'rest';

export const DAY_SHEET_COPY = {
  status: { done: 'Done', today: 'Today', planned: 'Planned', missed: 'Missed', skipped: 'Skipped', rest: 'Rest' } satisfies Record<DayStatus, string>,
  start: 'Start',
  doToday: 'Do today instead',
  moveTo: 'Move to…',
  skip: 'Skip this week',
  unskip: 'Unskip',
  edit: 'Edit',
  /** Scope, from Today and the day sheet (default) and from Library (Every week by default). */
  thisWeek: 'This week only',
  everyWeek: 'Every week',
  swap: 'Swap',
  remove: 'Remove',
  add: 'Add exercise',
  done: 'Done',
  undo: 'Undo',
  changed: 'Changed',
  /** Toasts. */
  doingToday: (name: string) => `${name} today`,
  movedTo: (name: string, weekday: string) => `${name} on ${weekday}`,
  skipped: (name: string) => `${name} skipped`,
  unskipped: (name: string) => `${name} back`,
  swapped: 'Swapped',
  removed: 'Removed',
  added: 'Added',
  stale: 'Changed since. Try again.',
} as const;

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const daySheetWeekday = (wd: number): string => SHORT[((wd % 7) + 7) % 7] ?? 'Mon';
const shortOf = (date: string): string => daySheetWeekday(weekdayIndexOfDate(date));

export interface WeekPlanDayInput {
  key: string;
  name: string;
  dayIndex: number | null;
}

export interface WeekPlanDaysInput {
  today: string;
  /** A Set days plan running this week (dates are its weekdays). */
  setDays: boolean;
  days: readonly WeekPlanDayInput[];
  doneOn: Readonly<Record<string, string>>;
  /** Set days: each plan day not done with its date this week (moves applied). */
  plannedOn: Readonly<Record<string, string>>;
  /** Skipped this week (key → its date, or null on Any days). */
  skippedOn: Readonly<Record<string, string | null>>;
  /** Any days: the plan days not done, in plan order. */
  ahead: readonly string[];
  /** Today's card's day (Any days: it holds today). */
  chosenKey: string | null;
}

export interface WeekPlanDay extends WeekPlanDayInput {
  date: string | null;
  status: Exclude<DayStatus, 'rest'>;
}

export function weekPlanDays(input: WeekPlanDaysInput): WeekPlanDay[] {
  const sunday = addDays(mondayOf(input.today), 6);
  // Any days: the card's day today, the rest one a day from tomorrow (`aheadDates`'s rule).
  const anyDate = new Map<string, string>();
  if (!input.setDays) {
    let date = addDays(input.today, 1);
    for (const k of input.ahead) {
      if (k === input.chosenKey) {
        anyDate.set(k, input.today);
        continue;
      }
      if (date > sunday) break;
      anyDate.set(k, date);
      date = addDays(date, 1);
    }
  }
  return input.days.map((d) => {
    const done = input.doneOn[d.key];
    if (done !== undefined) return { ...d, date: done, status: 'done' };
    if (d.key in input.skippedOn) return { ...d, date: input.skippedOn[d.key] ?? null, status: 'skipped' };
    const date = input.setDays ? (input.plannedOn[d.key] ?? null) : (anyDate.get(d.key) ?? null);
    if (date === null) return { ...d, date: null, status: 'planned' };
    return { ...d, date, status: date === input.today ? 'today' : date < input.today ? 'missed' : 'planned' };
  });
}

export type DoTodayAction = { kind: 'swap_days'; withDayIndex: number } | { kind: 'move'; weekday: number } | { kind: 'pick' };

export interface DaySheetActions {
  start: boolean;
  /** `Do today instead`: swap with today's planned day, move to today, or (Any days) put it on Today's card. */
  doToday: DoTodayAction | null;
  /** `Move to…`: the weekdays it can take this week (Set days); empty: not offered. */
  moveTo: { weekday: number; label: string }[];
  skip: boolean;
  unskip: boolean;
  edit: boolean;
}

export interface DaySheetView {
  /** `Thu · Push B`; a day with no plan day: `Thu 29 Oct`. */
  title: string;
  date: string | null;
  status: DayStatus;
  statusText: string;
  /** The plan day the sheet is about; null: none on that date. */
  day: WeekPlanDay | null;
  actions: DaySheetActions;
  accessibilityLabel: string;
}

const NO_ACTIONS: DaySheetActions = { start: false, doToday: null, moveTo: [], skip: false, unskip: false, edit: false };

/**
 * A day's sheet: by `date` (a tile) or by `dayKey` (Library's day row). `doneHere`: a workout (any) was done on the
 * date, so a date with no plan day still reads Done. `dateTitle`: the date's own title (`Thu 29 Oct`).
 */
export function daySheetOf(input: { at: { date: string } | { dayKey: string }; today: string; setDays: boolean; days: readonly WeekPlanDay[]; doneHere: boolean; dateTitle: (date: string) => string }): DaySheetView {
  const byKey = 'dayKey' in input.at ? input.at.dayKey : null;
  const onDate = 'date' in input.at ? input.at.date : null;
  const here = byKey !== null ? input.days.filter((d) => d.key === byKey) : input.days.filter((d) => d.date === onDate);
  // The day still to do first, then a done one, then a skipped one.
  const rank = (d: WeekPlanDay) => (d.status === 'today' || d.status === 'planned' || d.status === 'missed' ? 0 : d.status === 'done' ? 1 : 2);
  const day = [...here].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const date = day?.date ?? onDate;
  if (day === null) {
    const status: DayStatus = input.doneHere ? 'done' : 'rest';
    const title = date === null ? '' : input.dateTitle(date);
    return { title, date, status, statusText: DAY_SHEET_COPY.status[status], day: null, actions: NO_ACTIONS, accessibilityLabel: `${title}, ${DAY_SHEET_COPY.status[status]}` };
  }
  const title = day.date === null ? day.name : `${shortOf(day.date)} · ${day.name}`;
  const open = day.status === 'today' || day.status === 'planned' || day.status === 'missed';
  const todayWd = weekdayIndexOfDate(input.today);
  let doToday: DoTodayAction | null = null;
  if (open && day.status !== 'today') {
    if (!input.setDays) doToday = { kind: 'pick' };
    else {
      const partner = input.days.find((d) => d.key !== day.key && d.status === 'today' && d.dayIndex !== null);
      doToday = partner?.dayIndex != null ? { kind: 'swap_days', withDayIndex: partner.dayIndex } : { kind: 'move', weekday: todayWd };
    }
  }
  // Move to…: Set days, today onwards, never onto a weekday another day still to do holds.
  const held = new Set(input.days.filter((d) => d.key !== day.key && (d.status === 'today' || d.status === 'planned' || d.status === 'missed') && d.date !== null).map((d) => weekdayIndexOfDate(d.date ?? '')));
  const own = day.date === null ? -1 : weekdayIndexOfDate(day.date);
  const moveTo = input.setDays && open && day.dayIndex !== null ? Array.from({ length: 7 - todayWd }, (_, i) => todayWd + i).filter((wd) => wd !== own && !held.has(wd)).map((wd) => ({ weekday: wd, label: daySheetWeekday(wd) })) : [];
  const actions: DaySheetActions = { start: day.status === 'today', doToday, moveTo, skip: open && day.dayIndex !== null, unskip: day.status === 'skipped', edit: open && day.dayIndex !== null };
  const statusText = DAY_SHEET_COPY.status[day.status];
  return { title, date: day.date, status: day.status, statusText, day, actions, accessibilityLabel: `${day.date === null ? '' : `${LONG[weekdayIndexOfDate(day.date)] ?? ''}, `}${day.name}, ${statusText}` };
}

/** The card picker's rows (`Push B ⌄`): the week's plan days with weekday and status, Up next marked. */
export interface WeekPickRow {
  key: string;
  /** `Thu`; '' undated. */
  weekday: string;
  name: string;
  /** `Up next`, `Done`, `Today`, `Planned`, `Missed`, `Skipped`. */
  status: string;
  selected: boolean;
  accessibilityLabel: string;
}

export function weekPickRows(days: readonly WeekPlanDay[], o: { nextKey: string | null; selectedKey: string | null; upNext: string }): WeekPickRow[] {
  return days.map((d) => {
    const weekday = d.date === null ? '' : shortOf(d.date);
    const status = d.key === o.nextKey && d.status !== 'done' ? o.upNext : DAY_SHEET_COPY.status[d.status];
    const selected = d.key === o.selectedKey;
    return { key: d.key, weekday, name: d.name, status, selected, accessibilityLabel: [weekday === '' ? null : (LONG[weekdayIndexOfDate(d.date ?? '')] ?? null), d.name, status, selected ? 'selected' : null].filter((x): x is string => x !== null).join(', ') };
  });
}
