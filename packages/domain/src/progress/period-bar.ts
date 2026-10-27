import type { ProgressPeriodKey } from '@fizz/schemas';
import { addDays, addMonths, daysBetween } from '../calendar';
import { localDateText, NBSP } from '../display';
import { mondayOf } from './exercise';
import { dayMonthLong, monthName, monthTitle, rangeText, rangeWords } from './text';
import type { DateRange, ProgressWindow } from './window';

/**
 * (Redesign v3 C2, Ben 27 Oct) Progress's one period bar: `Week | Month | 3M | 6M | 1Y` with `‹ ›` to step back and
 * forward a whole period at a time. Lifts, Training and Body all follow it. Periods are calendar-aligned: a Monday–Sunday
 * week, a calendar month, or the 3, 6 or 12 calendar months ending in the month stepped to. The period showing now is
 * counted up to today; the previous period (`vs Sep`) is the whole period before it. Pure.
 */

export type PeriodSpan = 'week' | 'month' | '3m' | '6m' | '1y';

export const PERIOD_SPANS: readonly { key: PeriodSpan; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
];

export const DEFAULT_PERIOD_SPAN: PeriodSpan = 'month';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const SPAN_MONTHS: Readonly<Record<Exclude<PeriodSpan, 'week'>, number>> = { month: 1, '3m': 3, '6m': 6, '1y': 12 };
/** The old Progress preset nearest each span (the coach's entry carries the dates too). */
const SPAN_PRESET: Readonly<Record<PeriodSpan, ProgressPeriodKey>> = { week: '1m', month: '1m', '3m': '3m', '6m': '6m', '1y': '1y' };

export interface PeriodBarView {
  span: PeriodSpan;
  /** 0 = the period holding today; −1 the one before, and so on. Never above 0. */
  offset: number;
  /** The whole period, inclusive (a future part included for the current one). */
  full: DateRange;
  /** What is counted: `full` up to today; `previous` is the whole period before. */
  window: ProgressWindow;
  /** `October 2026` · `20 Oct – 26 Oct` · `Aug – Oct 2026` · `Nov 2025 – Oct 2026`. */
  title: string;
  /** The counted dates under a several-month title (`1 Aug – 27 Oct`); null for a week or a month. */
  datesLine: string | null;
  /** VoiceOver for the title and dates. */
  words: string;
  /** What a delta is against: `Sep`, `last week`, `13 Oct – 19 Oct`, `May – Jul`. */
  previousLabel: string;
  /** Records' empty line: `in October`, `this week`, `in Aug – Oct`. */
  phrase: string;
  canBack: boolean;
  canForward: boolean;
  /** The nearest old preset, for the coach's entry (which also gets the dates). */
  preset: ProgressPeriodKey;
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function lastOfMonth(date: string): string {
  return addDays(addMonths(firstOfMonth(date), 1), -1);
}

/** The whole period `offset` steps from the one holding `today`. */
export function periodRange(today: string, span: PeriodSpan, offset: number): DateRange {
  if (span === 'week') {
    const from = addDays(mondayOf(today), 7 * offset);
    return { from, to: addDays(from, 6) };
  }
  const n = SPAN_MONTHS[span];
  const endMonth = addMonths(firstOfMonth(today), n * offset);
  return { from: addMonths(endMonth, -(n - 1)), to: lastOfMonth(endMonth) };
}

const shortMonth = (date: string): string => MONTH_SHORT[Number(date.slice(5, 7)) - 1] ?? '';

/** `Aug – Oct 2026`, `Nov 2025 – Oct 2026`. */
function monthsTitle(r: DateRange): string {
  const y1 = r.from.slice(0, 4);
  const y2 = r.to.slice(0, 4);
  return y1 === y2 ? `${shortMonth(r.from)} – ${shortMonth(r.to)} ${y2}` : `${shortMonth(r.from)} ${y1} – ${shortMonth(r.to)} ${y2}`;
}

function monthsWords(r: DateRange): string {
  return `${monthName(r.from.slice(0, 7))} ${r.from.slice(0, 4)} to ${monthName(r.to.slice(0, 7))} ${r.to.slice(0, 4)}`;
}

/**
 * The bar for `span` stepped `offset` periods back from today. `earliest`: the first day with anything logged (or
 * today): `‹` stops at the period holding it, so stepping never walks into years of empty periods.
 */
export function periodBar(input: { today: string; span: PeriodSpan; offset: number; earliest?: string }): PeriodBarView {
  const { today, span } = input;
  const offset = Math.min(0, Math.trunc(input.offset)) + 0;
  const full = periodRange(today, span, offset);
  const prev = periodRange(today, span, offset - 1);
  const to = full.to < today ? full.to : today;
  const from = full.from;
  const window: ProgressWindow = { from, to, days: daysBetween(from, to) + 1, preset: null, previous: prev };
  const earliest = input.earliest ?? today;
  let title: string;
  let datesLine: string | null = null;
  let words: string;
  let previousLabel: string;
  let phrase: string;
  if (span === 'week') {
    title = rangeText(full, today);
    words = `Week of ${rangeWords(full, today)}`;
    previousLabel = offset === 0 ? 'last week' : rangeText(prev, today);
    phrase = offset === 0 ? 'this week' : `in ${title}`;
  } else if (span === 'month') {
    title = monthTitle(full.from.slice(0, 7));
    words = title;
    previousLabel = prev.from.slice(0, 4) === full.from.slice(0, 4) ? shortMonth(prev.from) : `${shortMonth(prev.from)}${NBSP}${prev.from.slice(0, 4)}`;
    phrase = `in ${monthName(full.from.slice(0, 7))}`;
  } else {
    title = monthsTitle(full);
    datesLine = `${localDateText(window.from)} – ${localDateText(window.to)}`;
    words = `${monthsWords(full)}, ${dayMonthLong(window.from)} to ${dayMonthLong(window.to)}`;
    previousLabel = prev.from.slice(0, 4) === prev.to.slice(0, 4) && prev.to.slice(0, 4) === full.to.slice(0, 4) ? `${shortMonth(prev.from)} – ${shortMonth(prev.to)}` : monthsTitle(prev);
    phrase = `in ${monthsTitle(full)}`;
  }
  return {
    span,
    offset,
    full,
    window,
    title,
    datesLine,
    words,
    previousLabel,
    phrase,
    canBack: full.from > earliest,
    canForward: offset < 0,
    preset: SPAN_PRESET[span],
  };
}

/**
 * A span change keeps the place: the offset whose period holds the last counted day of the one showing (so stepping
 * back to September then picking Week shows September's last week).
 */
export function offsetHolding(today: string, span: PeriodSpan, date: string): number {
  const d = date > today ? today : date;
  if (span === 'week') return Math.min(0, Math.floor(daysBetween(mondayOf(today), mondayOf(d)) / 7)) + 0;
  const n = SPAN_MONTHS[span];
  const months = (Number(d.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + (Number(d.slice(5, 7)) - Number(today.slice(5, 7)));
  return Math.min(0, Math.ceil(months / n)) + 0;
}
