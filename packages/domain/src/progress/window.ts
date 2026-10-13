import type { ProgressPeriodKey } from '@fizz/schemas';
import { addDays, addMonths, daysBetween, localDateOf } from '../calendar';

/**
 * Progress periods (Ben, 13 Oct 2026): `1 month` · `3 months` · `6 months` ·
 * `1 year`, each ending today, inclusive (`1 month` on 13 Oct is 14 Sep –
 * 13 Oct), or a custom period picked by month. The previous window is the
 * same number of days immediately before it. Days are local calendar dates
 * (`YYYY-MM-DD`) in the owner's zone (PG16).
 */

export const PROGRESS_PERIODS: readonly { key: ProgressPeriodKey; label: string }[] = [
  { key: '1m', label: '1 month' },
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: '1y', label: '1 year' },
];
export const DEFAULT_PROGRESS_PERIOD: ProgressPeriodKey = '1m';

/** `1 month`, `3 months`, `6 months`, `1 year`. */
export function progressPeriodLabel(key: ProgressPeriodKey): string {
  return PROGRESS_PERIODS.find((p) => p.key === key)?.label ?? '1 month';
}

/** The period in a phrase: `Last month`, `Previous 3 months`, `in the last year`. */
export function progressPeriodPhrase(key: ProgressPeriodKey): string {
  return key === '1m' ? 'month' : key === '1y' ? 'year' : progressPeriodLabel(key);
}

/** Inclusive local dates. */
export interface DateRange {
  from: string;
  to: string;
}

export interface ProgressWindow extends DateRange {
  /** Days in the window, inclusive. */
  days: number;
  /** The preset it came from; null for a custom period. */
  preset: ProgressPeriodKey | null;
  previous: DateRange;
}

/** A window of `days` days ending on `today` (a local date), inclusive. */
export function progressWindow(today: string, days: number): ProgressWindow {
  const from = addDays(today, -(days - 1));
  return { days, preset: null, from, to: today, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
}

/** A preset period ending on `today`: the day after the same date N months ago, to today. */
export function periodProgressWindow(today: string, key: ProgressPeriodKey): ProgressWindow {
  return { ...customProgressWindow(presetProgressRange(today, key)), preset: key };
}

/**
 * A custom period (Ben's 12 Oct request): `from`–`to` inclusive, local dates.
 * The previous window is the same number of days immediately before it, as
 * for the presets. Callers pass a range from `normaliseProgressRange`.
 */
export function customProgressWindow(range: DateRange): ProgressWindow {
  const days = daysBetween(range.from, range.to) + 1;
  return { days, preset: null, from: range.from, to: range.to, previous: { from: addDays(range.from, -days), to: addDays(range.from, -1) } };
}

/** The longest custom period: about three years, enough for the whole FitNotes history and still one bar per month. */
export const PROGRESS_MAX_PERIOD_DAYS = 3 * 366;

/**
 * A chosen period made valid: never past today, reversed dates swapped,
 * and at most `PROGRESS_MAX_PERIOD_DAYS` long (the start moves, the end
 * stays). Dates are `YYYY-MM-DD`; anything else is refused (null).
 */
export function normaliseProgressRange(range: DateRange, today: string): DateRange | null {
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;
  if (!ok(range.from) || !ok(range.to) || !ok(today)) return null;
  // Reversed dates are swapped (review ben-bugs N6), then the end is pulled back to today.
  const [start, end] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
  const to = end > today ? today : end;
  let from = start > to ? to : start;
  if (daysBetween(from, to) + 1 > PROGRESS_MAX_PERIOD_DAYS) from = addDays(to, -(PROGRESS_MAX_PERIOD_DAYS - 1));
  return { from, to };
}

/** A preset's dates ending today, inclusive: the day after the same date N months ago, to today. */
export function presetProgressRange(today: string, preset: ProgressPeriodKey): DateRange {
  const months = preset === '1m' ? 1 : preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
  return { from: addDays(addMonths(today, -months), 1), to: today };
}

/** Custom starts 18 months back (Ben, 13 Oct 2026). */
export const CUSTOM_DEFAULT_MONTHS = 18;

/** `YYYY-MM` of a local date. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * A custom period from the Start and End month pickers: the first day of the
 * start month to the last day of the end month, never past today (reversed
 * months swapped; `normaliseProgressRange` rules apply).
 */
export function customRangeFromMonths(start: string, end: string, today: string): DateRange | null {
  const [a, b] = start <= end ? [start, end] : [end, start];
  const lastDay = addDays(addMonths(`${b}-01`, 1), -1);
  return normaliseProgressRange({ from: `${a}-01`, to: lastDay }, today);
}

/** Custom's defaults: Start = the month 18 months ago, End = this month (so the period ends today). */
export function defaultCustomMonths(today: string): { start: string; end: string } {
  return { start: monthKeyOf(addMonths(today, -CUSTOM_DEFAULT_MONTHS)), end: monthKeyOf(today) };
}

/** The months the pickers scroll through, oldest first: from `earliest`'s month (at most the longest period back) to this month. */
export function pickerMonths(earliest: string, today: string): string[] {
  const floor = monthKeyOf(addDays(today, -(PROGRESS_MAX_PERIOD_DAYS - 1)));
  const lowest = monthKeyOf(earliest) < floor ? floor : monthKeyOf(earliest);
  const out: string[] = [];
  for (let m = `${lowest}-01`; monthKeyOf(m) <= monthKeyOf(today); m = addMonths(m, 1)) out.push(monthKeyOf(m));
  return out;
}

/** The window ending today in `tz` at `nowMs`. */
export function progressWindowAt(nowMs: number, tz: string, key: ProgressPeriodKey): ProgressWindow {
  return periodProgressWindow(localDateOf(nowMs, tz), key);
}

/** `YYYY-MM-DD` strings compare in calendar order. */
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
