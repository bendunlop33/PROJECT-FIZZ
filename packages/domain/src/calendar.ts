import type { Weekday } from '@fizz/schemas';

/**
 * Local calendar helpers for a UTC instant read in an IANA zone. Pure: the
 * instant and zone are arguments (no clock reads). Weeks run Monday–Sunday
 * (progress.md PG16).
 */

/** One formatter per zone: building an `Intl.DateTimeFormat` costs far more than using one (Progress reads hundreds of dates). */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string } {
  const out: Record<string, string> = {};
  for (const p of formatterFor(tz).formatToParts(ms)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: (out.weekday ?? '').toLowerCase().slice(0, 3),
  };
}

/** `YYYY-MM-DD` in `tz`. */
export function localDateOf(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function weekdayOf(ms: number, tz: string): Weekday {
  const w = parts(ms, tz).weekday;
  const found = WEEKDAYS.find((d) => d === w);
  if (!found) throw new RangeError(`Unknown weekday ${w}`);
  return found;
}

/** Zone offset (local − UTC) in ms at instant `ms`. */
function offsetMs(ms: number, tz: string): number {
  const p = parts(ms, tz);
  // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of local midnight starting `localDate` (`YYYY-MM-DD`) in `tz`. */
export function localMidnightUtcMs(localDate: string, tz: string): number {
  return localHourUtcMs(localDate, 0, tz);
}

/** The UTC instant of `hour`:00 local time on `localDate` in `tz` (a skipped hour resolves to the instant just after the clock change). */
export function localHourUtcMs(localDate: string, hour: number, tz: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) throw new RangeError(`Bad date ${localDate}`);
  // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
  const naive = Date.UTC(y, m - 1, d, hour);
  // Two passes settle DST transitions (the offset at the guess can differ from the offset at the answer).
  let guess = naive - offsetMs(naive, tz);
  guess = naive - offsetMs(guess, tz);
  return guess;
}

/** The UTC instant of `hour`:`minute` local time on `localDate` in `tz` (a skipped time resolves to the instant just after the clock change). */
export function localTimeUtcMs(localDate: string, hour: number, minute: number, tz: string): number {
  return localHourUtcMs(localDate, hour, tz) + minute * 60_000;
}

/** Add whole days to a `YYYY-MM-DD` date (calendar arithmetic, zone-free). */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Whole calendar days from `from` to `to` (`YYYY-MM-DD`; negative when `to` is earlier). Zone-free. */
export function daysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Monday–Sunday week containing `ms` in `tz`, as UTC bounds [start, end). */
export function localWeekBounds(ms: number, tz: string): { startMs: number; endMs: number; mondayLocalDate: string } {
  const today = localDateOf(ms, tz);
  const back = WEEKDAYS.indexOf(weekdayOf(ms, tz));
  const monday = addDays(today, -back);
  return { startMs: localMidnightUtcMs(monday, tz), endMs: localMidnightUtcMs(addDays(monday, 7), tz), mondayLocalDate: monday };
}

/** `19:40`: the 24-hour local clock time of an instant in `tz` (design-system §3 times). */
export function clockText(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Day of the week of a calendar date (`YYYY-MM-DD`), 0 = Monday … 6 = Sunday. Zone-free. */
export function weekdayIndexOfDate(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  // eslint-disable-next-line no-restricted-globals -- arithmetic on calendar fields, not a clock read
  const sundayFirst = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** `YYYY-MM-DD` plus whole months, the day clamped to the month's length. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = (y ?? 1970) * 12 + ((m ?? 1) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = daysBetween(`${pad4(year)}-${pad2(month)}-01`, month === 12 ? `${pad4(year + 1)}-01-01` : `${pad4(year)}-${pad2(month + 1)}-01`);
  return `${pad4(year)}-${pad2(month)}-${pad2(Math.min(d ?? 1, last))}`;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');
