import type { ProgressWindowDays } from '@fizz/schemas';
import { addDays, addMonths, daysBetween, localDateOf } from '../calendar';

/**
 * Progress windows (progress.md PG24): `7 days` · `14 days` · `30 days` ·
 * `60 days`, each ending today, inclusive (30 days = today and the 29 days
 * before), or a custom period (Ben, 12 Oct 2026: `From`/`To`, or a preset).
 * The previous window is the same length immediately before it.
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
  /** Days in the window, inclusive (a custom period can be any length). */
  days: number;
  /** The preset it came from; null for a custom period (`From`/`To` or `3 months`, `6 months`, `1 year`). */
  preset: ProgressWindowDays | null;
  previous: DateRange;
}

/** The window ending on `today` (a local date). */
export function progressWindow(today: string, days: ProgressWindowDays): ProgressWindow {
  const from = addDays(today, -(days - 1));
  return { days, preset: days, from, to: today, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
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

export type ProgressPeriodPreset = '3m' | '6m' | '1y';

/** The period sheet's presets, each ending today. */
export const PROGRESS_PERIOD_PRESETS: readonly { key: ProgressPeriodPreset; label: string }[] = [
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: '1y', label: '1 year' },
];

/** `3 months` ending today, inclusive: the day after the same date 3 months ago, to today. */
export function presetProgressRange(today: string, preset: ProgressPeriodPreset): DateRange {
  const months = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
  return { from: addDays(addMonths(today, -months), 1), to: today };
}

/** The period sheet's date steppers: a week or a month earlier or later, kept inside `[min, max]`. */
export function stepPeriodDate(date: string, step: { unit: 'week' | 'month'; by: -1 | 1 }, bounds: DateRange): string {
  const moved = step.unit === 'week' ? addDays(date, 7 * step.by) : addMonths(date, step.by);
  if (moved < bounds.from) return bounds.from;
  if (moved > bounds.to) return bounds.to;
  return moved;
}

/** The window ending today in `tz` at `nowMs`. */
export function progressWindowAt(nowMs: number, tz: string, days: ProgressWindowDays): ProgressWindow {
  return progressWindow(localDateOf(nowMs, tz), days);
}

/** `YYYY-MM-DD` strings compare in calendar order. */
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
