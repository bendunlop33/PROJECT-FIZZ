import { addDays, clockText, daysBetween, weekdayIndexOfDate } from '../calendar';
import { formatMinutes, NBSP } from '../display';
import { countRowSets, type MuscleInfo } from './muscles';
import type { ProgressSession } from './projection';
import { monthName, monthTitle, countNoun, weekdayDayMonth, weekdayDayMonthLong } from './text';
import { deriveWorkoutTitle } from '../session/first-run';
import { toMs } from '../time';

/**
 * The Calendar segment (progress.md §2.5, §3.3): a Monday-first month grid
 * with a mark on workout days and the day list for a selected day. Finished
 * workouts only, plus the unfinished one (never counted, PG33). Discarded and
 * reverted workouts aren't shown. Pure.
 */

export interface CalendarSessionRow {
  sessionId: string;
  kind: 'finished' | 'in_progress' | 'unfinished';
  /** `Push A · Main Gym` · `Imported`. */
  title: string;
  /** `18:02–19:04 · 54 min · 16 sets` · `22 sets` · `Resume ›`. */
  detail: string;
  imported: boolean;
  words: string;
}

export interface CalendarDayView {
  date: string;
  day: number;
  isToday: boolean;
  /** Finished workouts that day. */
  count: number;
  words: string;
}

export interface CalendarMonthView {
  month: string;
  title: string;
  previousMonth: string;
  nextMonth: string;
  /** Rows of 7 (Mon–Sun); null pads days outside the month. */
  weeks: (CalendarDayView | null)[][];
  /** Day lists by date (only dates with something to list). */
  days: Readonly<Record<string, CalendarSessionRow[]>>;
  /** Today if it is in this month, else the latest day with a workout, else null. */
  defaultSelected: string | null;
  /** `No workouts in October.`; null when the month has one. */
  empty: string | null;
}

export interface CalendarActive {
  sessionId: string;
  date: string;
  name: string | null;
  /** Under 6 h old: `In progress`; older: `Unfinished`. */
  fresh: boolean;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = (y ?? 1970) * 12 + ((m ?? 1) - 1) + by;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function workingSets(s: ProgressSession): number {
  return s.exercises.reduce((n, ex) => {
    const c = countRowSets(ex);
    return n + c.hard + c.easy;
  }, 0);
}

export function calendarSessionRow(s: ProgressSession, exercises: ReadonlyMap<string, MuscleInfo>, gymNames: Readonly<Record<string, string>>): CalendarSessionRow {
  const sets = countNoun(workingSets(s), 'set', 'sets');
  const name =
    s.name !== null && s.name.trim() !== ''
      ? s.name
      : deriveWorkoutTitle(s.exercises.flatMap((e) => {
          const i = exercises.get(e.exerciseId);
          return i ? [{ movementPattern: i.movementPattern, primaryMuscles: [...i.primaryMuscles] }] : [];
        }));
  // Imported workouts read like any other (Ben, 12 Oct): named from their exercises; date only, so no times.
  if (s.source === 'import') {
    const gym = s.gymId === null ? null : (gymNames[s.gymId] ?? null);
    return { sessionId: s.sessionId, kind: 'finished', title: gym === null ? name : `${name} · ${gym}`, detail: sets, imported: true, words: `${name}${gym === null ? '' : `, ${gym}`}. ${sets}. Opens the workout.` };
  }
  const gym = s.gymId === null ? null : (gymNames[s.gymId] ?? null);
  const parts: string[] = [];
  if (s.endedAtUtc !== null) parts.push(`${clockText(s.startedMs, s.tz)}–${clockText(toMs(s.endedAtUtc), s.tz)}`);
  if (s.durationMs !== null) parts.push(formatMinutes(s.durationMs));
  parts.push(sets);
  return {
    sessionId: s.sessionId,
    kind: 'finished',
    title: gym === null ? name : `${name} · ${gym}`,
    detail: parts.join(' · '),
    imported: false,
    words: `${name}${gym === null ? '' : `, ${gym}`}. ${parts.join(', ').replaceAll(NBSP, ' ')}. Opens the workout.`,
  };
}

export function buildCalendarMonthView(input: {
  sessions: readonly ProgressSession[];
  exercises: ReadonlyMap<string, MuscleInfo>;
  gymNames?: Readonly<Record<string, string>>;
  month: string;
  today: string;
  active?: CalendarActive | null;
}): CalendarMonthView {
  const { month, today } = input;
  const gymNames = input.gymNames ?? {};
  const first = `${month}-01`;
  const next = shiftMonth(month, 1);
  const length = daysBetween(first, `${next}-01`);
  const days: Record<string, CalendarSessionRow[]> = {};
  const counts = new Map<string, number>();
  const inMonth = input.sessions.filter((s) => monthOf(s.date) === month).sort((a, b) => a.startedMs - b.startedMs);
  for (const s of inMonth) {
    (days[s.date] ??= []).push(calendarSessionRow(s, input.exercises, gymNames));
    counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
  }
  const active = input.active ?? null;
  if (active !== null && monthOf(active.date) === month) {
    const title = active.name ?? 'Workout';
    (days[active.date] ??= []).push(
      active.fresh
        ? { sessionId: active.sessionId, kind: 'in_progress', title, detail: 'In progress · Resume ›', imported: false, words: `${title}, in progress. Resumes the workout.` }
        : { sessionId: active.sessionId, kind: 'unfinished', title, detail: 'Unfinished · Finish on Today ›', imported: false, words: `${title}, unfinished. Opens Today.` },
    );
  }
  const weeks: (CalendarDayView | null)[][] = [];
  let row: (CalendarDayView | null)[] = Array.from({ length: weekdayIndexOfDate(first) }, () => null);
  for (let i = 0; i < length; i += 1) {
    const date = addDays(first, i);
    const n = counts.get(date) ?? 0;
    row.push({
      date,
      day: i + 1,
      isToday: date === today,
      count: n,
      words: `${weekdayDayMonthLong(date)}${date === today ? ', today' : ''}${n === 0 ? '' : `, ${countNoun(n, 'workout', 'workouts')}`}`,
    });
    if (row.length === 7) {
      weeks.push(row);
      row = [];
    }
  }
  if (row.length > 0) weeks.push([...row, ...Array.from({ length: 7 - row.length }, () => null)]);
  const workoutDates = [...counts.keys()].sort();
  return {
    month,
    title: monthTitle(month),
    previousMonth: shiftMonth(month, -1),
    nextMonth: next,
    weeks,
    days,
    defaultSelected: monthOf(today) === month ? today : (workoutDates.at(-1) ?? null),
    empty: inMonth.length === 0 ? `No workouts in ${monthName(month)}.` : null,
  };
}

/** `Nothing logged on Tue 6 Oct.` */
export function nothingLoggedText(date: string): string {
  return `Nothing logged on ${weekdayDayMonth(date)}.`;
}
