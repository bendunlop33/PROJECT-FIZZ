import type { EquipmentKind, Load, LoadConvention, ProgressWindowDays, WeightUnit } from '@fizz/schemas';
import { weekdayIndexOfDate } from '../calendar';
import { formatMinutes, formatNumber, localDateText, NBSP } from '../display';
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

/**
 * The year a range's dates need: both ends' years when it crosses New Year,
 * the end's year when it lies in another year than `today`, none otherwise.
 * A period's dates are often its only label, so last year's September never
 * reads as this year's (review ben-bugs B1).
 */
function rangeYears(range: DateRange, today: string): { from: string; to: string } {
  const fromYear = range.from.slice(0, 4);
  const toYear = range.to.slice(0, 4);
  if (fromYear !== toYear) return { from: fromYear, to: toYear };
  return { from: '', to: toYear === today.slice(0, 4) ? '' : toYear };
}

/** The dates line under the picker: `12 Sep – 11 Oct`, `1 Sep – 30 Sep 2025`, `13 Oct 2025 – 12 Oct 2026`. */
export function rangeText(range: DateRange, today: string): string {
  const y = rangeYears(range, today);
  const withYear = (date: string, year: string): string => (year === '' ? localDateText(date) : `${localDateText(date)}${NBSP}${year}`);
  return `${withYear(range.from, y.from)} – ${withYear(range.to, y.to)}`;
}

/** The dates line for VoiceOver: `12 September to 11 October`, with years as `rangeText` shows them. */
export function rangeWords(range: DateRange, today: string): string {
  const y = rangeYears(range, today);
  const withYear = (date: string, year: string): string => (year === '' ? dayMonthLong(date) : `${dayMonthLong(date)} ${year}`);
  return `${withYear(range.from, y.from)} to ${withYear(range.to, y.to)}`;
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

/**
 * A bar's dates for lists and VoiceOver: a whole week is `week from 14
 * September`; a part week the window cut says exactly which days it holds
 * (`12 October only`, `14 to 16 August`), so a one-day bar is never read as a
 * week with nothing in it.
 */
export function weekBarDates(w: Pick<WeekCount, 'from' | 'to' | 'partial'>): string {
  if (!w.partial) return `week from ${dayMonthLong(w.from)}`;
  if (w.from === w.to) return `${dayMonthLong(w.from)} only`;
  const left = w.from.slice(0, 7) === w.to.slice(0, 7) ? String(Number(w.from.slice(8, 10))) : dayMonthLong(w.from);
  return `${left} to ${dayMonthLong(w.to)}`;
}

/** The AX list row: `Week from 14 Sep · 2`, `12 Oct only · 1`, `14–16 Aug · 1`. */
export function weekBarListText(w: Pick<WeekCount, 'from' | 'to' | 'partial' | 'count'>): string {
  if (!w.partial) return `Week from ${localDateText(w.from)} · ${String(w.count)}`;
  if (w.from === w.to) return `${localDateText(w.from)} only · ${String(w.count)}`;
  const sameMonth = w.from.slice(0, 7) === w.to.slice(0, 7);
  const left = sameMonth ? String(Number(w.from.slice(8, 10))) : localDateText(w.from);
  return `${left}–${localDateText(w.to)} · ${String(w.count)}`;
}

/** The VoiceOver sentence for `WeekBars`. */
export function weekBarsWords(weeks: readonly WeekCount[]): string {
  return `Sessions per week: ${weeks.map((w) => `${weekBarDates(w)}, ${String(w.count)}`).join('; ')}.`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A month bar's label: `Sep`, or `Sep 25` when the period crosses a year. */
export function monthBarLabel(from: string, withYear: boolean): string {
  const m = MONTH_SHORT[Number(from.slice(5, 7)) - 1] ?? '';
  return withYear ? `${m} ${from.slice(2, 4)}` : m;
}

/** The VoiceOver sentence for month bars: `Sessions per month: September 2025, 12; 1 to 12 October 2026, 3.` */
export function monthBarsWords(months: readonly { from: string; to: string; count: number; partial: boolean }[]): string {
  const name = (d: string) => `${MONTH_LONG[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
  const one = (m: { from: string; to: string; count: number; partial: boolean }) =>
    m.partial ? `${String(Number(m.from.slice(8, 10)))} to ${String(Number(m.to.slice(8, 10)))} ${name(m.from)}, ${String(m.count)}` : `${name(m.from)}, ${String(m.count)}`;
  return `Sessions per month: ${months.map(one).join('; ')}.`;
}

/** "Last 7 days: Tuesday 6 October, 1 workout; Thursday 8 October, 1 workout. Other days none." */
export function dayStripWords(days: readonly DayCount[], head = `Last ${String(days.length)} days`): string {
  const done = days.filter((d) => d.count > 0);
  if (done.length === 0) return `${head}: no workouts.`;
  const list = done.map((d) => `${weekdayDayMonthLong(d.date)}, ${countNoun(d.count, 'workout', 'workouts')}`).join('; ');
  return done.length === days.length ? `${head}: ${list}.` : `${head}: ${list}. Other days none.`;
}

/** A load for VoiceOver: `100 kilograms`, `22.5 kilograms each`, `body weight plus 10 kilograms`, `15 kilograms of assistance`. */
export function massWords(load: Load, equipmentKind: EquipmentKind | null): string {
  const unit = load.unit === 'kg' ? 'kilograms' : 'pounds';
  const mass = `${formatNumber(load.value)} ${unit}`;
  if (load.convention === 'added') {
    // `BW + 10 kg` reads "body weight plus 10 kilograms"; plate-loaded machines read their plates (review N9).
    if (equipmentKind === 'plate_loaded_machine') return `${mass} of plates`;
    return load.value === 0 ? 'body weight' : `body weight plus ${mass}`;
  }
  if (load.convention === 'assistance') return `${mass} of assistance`;
  if (load.convention === 'bodyweight') return 'body weight';
  const suffix = load.convention === 'per_hand' ? ' each' : load.convention === 'stack' ? ' on the stack' : '';
  return `${mass}${suffix}`;
}

/** A load's unit with its convention, for values, axes and estimates: `kg`, `kg each`, `kg stack`, `kg plates`, `kg added`, `kg assist`. */
export function loadUnitText(unit: WeightUnit, convention: LoadConvention, equipmentKind: EquipmentKind | null): string {
  switch (convention) {
    case 'total':
      return unit;
    case 'per_hand':
      return `${unit} each`;
    case 'stack':
      return `${unit} stack`;
    case 'added':
      return equipmentKind === 'plate_loaded_machine' ? `${unit} plates` : `${unit} added`;
    case 'assistance':
      return `${unit} assist`;
    case 'bodyweight':
      return 'reps';
  }
}
