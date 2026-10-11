import type { ProgressWindowDays } from '@fizz/schemas';
import { weekdayIndexOfDate } from '../calendar';
import { formatMinutes, localDateText, NBSP } from '../display';
import type { DayCount, WeekCount } from './activity';
import type { DateRange } from './window';

/**
 * Progress words and numbers (progress.md §5; design-system §3). Pure.
 * Minimal copy: values and the fewest words, nothing about how rules work.
 */

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** `12 Sep`. */
export const dayMonth = localDateText;

/** `Fri 14 Aug`. */
export function weekdayDayMonth(date: string): string {
  return `${WEEKDAY_SHORT[weekdayIndexOfDate(date)] ?? ''} ${localDateText(date)}`;
}

/** `12 September` (VoiceOver). */
export function dayMonthLong(date: string): string {
  const [, m, d] = date.split('-');
  return `${String(Number(d))} ${MONTH_LONG[Number(m) - 1] ?? ''}`;
}

/** `Thursday 8 October` (VoiceOver). */
export function weekdayDayMonthLong(date: string): string {
  return `${WEEKDAY_LONG[weekdayIndexOfDate(date)] ?? ''} ${dayMonthLong(date)}`;
}

/** `October 2026` from `2026-10`. */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_LONG[Number(m) - 1] ?? ''} ${y ?? ''}`;
}

/** `October` from `2026-10`. */
export function monthName(month: string): string {
  return MONTH_LONG[Number(month.split('-')[1]) - 1] ?? '';
}

/** The dates line under the picker: `12 Sep – 11 Oct`. */
export function rangeText(range: DateRange): string {
  return `${localDateText(range.from)} – ${localDateText(range.to)}`;
}

/** `30 days`. */
export function windowLabel(days: ProgressWindowDays): string {
  return `${String(days)} days`;
}

/** Time totals: `57 min`, `6 h 39 min`; from 100 h whole hours (`104 h`). */
export function gymTimeText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 100 * 60) return `${String(Math.round(minutes / 60))}${NBSP}h`;
  return formatMinutes(ms);
}

/** `6 hours 39 minutes` (VoiceOver). */
export function gymTimeWords(ms: number): string {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? '1 hour' : `${String(h)} hours`;
  const mins = m === 1 ? '1 minute' : `${String(m)} minutes`;
  if (h === 0) return mins;
  return m === 0 ? hours : `${hours} ${mins}`;
}

/** Sets in halves: `8½`, `½`, `14`. */
export function setsText(sets: number): string {
  const whole = Math.floor(sets);
  const half = sets - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${String(whole)}½`;
}

/** `8 and a half sets`, `1 set`, `a half set` (VoiceOver). */
export function setsWords(sets: number): string {
  const whole = Math.floor(sets);
  const half = sets - whole >= 0.5;
  if (!half) return whole === 1 ? '1 set' : `${String(whole)} sets`;
  if (whole === 0) return 'half a set';
  return `${String(whole)} and a half sets`;
}

export function countNoun(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** `3.3` (per-week columns). */
export function perWeekText(n: number): string {
  return n.toFixed(1);
}

/** `Week from 14 Sep · 2` style lists and the VoiceOver sentence for `WeekBars`. */
export function weekBarsWords(weeks: readonly WeekCount[]): string {
  return `Sessions per week: ${weeks.map((w) => `from ${dayMonthLong(w.from)}, ${String(w.count)}`).join('; ')}.`;
}

/** "Last 7 days: Tuesday 6 October, 1 workout; Thursday 8 October, 1 workout. Other days none." */
export function dayStripWords(days: readonly DayCount[]): string {
  const done = days.filter((d) => d.count > 0);
  const head = `Last ${String(days.length)} days`;
  if (done.length === 0) return `${head}: no workouts.`;
  const list = done.map((d) => `${weekdayDayMonthLong(d.date)}, ${countNoun(d.count, 'workout', 'workouts')}`).join('; ');
  return done.length === days.length ? `${head}: ${list}.` : `${head}: ${list}. Other days none.`;
}
