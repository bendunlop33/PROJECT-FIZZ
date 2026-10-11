import type { ProgressWindowDays } from '@fizz/schemas';
import { addDays, localDateOf } from '../calendar';

/**
 * Progress windows (progress.md PG24): `7 days` · `14 days` · `30 days` ·
 * `60 days`, each ending today, inclusive (30 days = today and the 29 days
 * before). The previous window is the same length immediately before it.
 * Days are local calendar dates (`YYYY-MM-DD`) in the owner's zone (PG16).
 */

export const PROGRESS_WINDOWS: readonly ProgressWindowDays[] = [7, 14, 30, 60];
export const DEFAULT_PROGRESS_WINDOW: ProgressWindowDays = 30;

/** Inclusive local dates. */
export interface DateRange {
  from: string;
  to: string;
}

export interface ProgressWindow extends DateRange {
  days: ProgressWindowDays;
  previous: DateRange;
}

/** The window ending on `today` (a local date). */
export function progressWindow(today: string, days: ProgressWindowDays): ProgressWindow {
  const from = addDays(today, -(days - 1));
  return { days, from, to: today, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
}

/** The window ending today in `tz` at `nowMs`. */
export function progressWindowAt(nowMs: number, tz: string, days: ProgressWindowDays): ProgressWindow {
  return progressWindow(localDateOf(nowMs, tz), days);
}

/** `YYYY-MM-DD` strings compare in calendar order. */
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
