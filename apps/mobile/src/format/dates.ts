import { localHourUtcMs } from '@fizz/domain';

/**
 * Local date and time wording (design-system §3). Pure: time and zone are
 * arguments, and `locale` defaults to the device's (tests pass 'en-GB').
 */

function parts(ms: number, tz: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).formatToParts(ms)) out[p.type] = p.value;
  return out;
}

/** `19:05` (24-hour unless the locale prefers 12-hour). */
export function formatTime(ms: number, tz: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(ms);
}

/** `Thu 8 Oct` */
export function formatShortDate(ms: number, tz: string, locale?: string): string {
  const p = parts(ms, tz, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday ?? ''} ${p.day ?? ''} ${p.month ?? ''}`.trim();
}

/** `8 Sep` (no weekday), for "since" lines. */
export function formatDayMonth(ms: number, tz: string, locale?: string): string {
  const p = parts(ms, tz, locale, { day: 'numeric', month: 'short' });
  return `${p.day ?? ''} ${p.month ?? ''}`.trim();
}

/**
 * `Wed 1 Oct 2026` for a calendar date with no time or zone (`YYYY-MM-DD`,
 * an imported date-only workout). Never shifted by the phone's zone.
 */
export function formatCalendarDate(date: string, locale?: string): string {
  const p = parts(localHourUtcMs(date, 12, 'UTC'), 'UTC', locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.weekday ?? ''} ${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}`.trim();
}

/** Calendar date in a zone, `YYYY-MM-DD`. */
export function localDateKey(ms: number, tz: string): string {
  const p = parts(ms, tz, 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}`;
}

/** Local `YYYY-MM-DD-HHMM`, for file names. */
export function localStamp(ms: number, tz: string): string {
  const p = parts(ms, tz, 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}-${p.hour ?? ''}${p.minute ?? ''}`;
}

/** `19:05` today, otherwise `Thu 8 Oct, 19:05`. */
export function formatWhen(ms: number, nowMs: number, tz: string, locale?: string): string {
  const time = formatTime(ms, tz, locale);
  return localDateKey(ms, tz) === localDateKey(nowMs, tz) ? time : `${formatShortDate(ms, tz, locale)}, ${time}`;
}

/** `Thursday 8 October` (Today's header; shown in tracked caps). */
export function formatLongDate(ms: number, tz: string, locale?: string): string {
  const p = parts(ms, tz, locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${p.weekday ?? ''} ${p.day ?? ''} ${p.month ?? ''}`.trim();
}
