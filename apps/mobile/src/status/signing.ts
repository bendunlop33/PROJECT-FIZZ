import { toMs } from '@fizz/domain';

import { formatShortDate, formatTime, localDateKey } from '../format/dates';
import { TIMING } from '../theme/tokens';

/**
 * Signing expiry (system-states.md §3.5). The free Apple ID signs Fizz for
 * 7 days; the expiry is read from the installed `embedded.mobileprovision`
 * by the audio-coach module. Pure.
 */

export type SigningState = 'ok' | 'notice' | 'urgent' | 'expired' | 'unknown';

export interface SigningStatus {
  state: SigningState;
  expiresUtc: string | null;
  /** Today banner text, or null when there's no banner (> 72 h, unknown). */
  banner: string | null;
  /** App status row: `Signed until Sun 11 Oct, 09:00` / `Signing date unknown…`. */
  line: string;
  detail: string;
}

const DAY_MS = 24 * 3600_000;

/**
 * The last day Ben can comfortably refresh: the expiry day if the expiry is
 * at 20:00 local or later, otherwise the day before (§3.5 "Which day to name").
 */
export function refreshByDay(expiresMs: number, tz: string, locale?: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(expiresMs));
  const day = hour >= 20 ? expiresMs : expiresMs - DAY_MS;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz }).format(day);
}

function parseMs(iso: string | null): number | null {
  if (iso === null) return null;
  try {
    return toMs(iso);
  } catch {
    return null;
  }
}

export function signingStatus(expiresUtc: string | null, nowMs: number, tz: string, locale?: string): SigningStatus {
  const expiresMs = parseMs(expiresUtc);
  if (expiresMs === null) {
    return {
      state: 'unknown',
      expiresUtc: null,
      banner: null,
      line: 'Signing date unknown',
      detail: 'Refresh weekly in SideStore.',
    };
  }
  const left = expiresMs - nowMs;
  const until = `${formatShortDate(expiresMs, tz, locale)}, ${formatTime(expiresMs, tz, locale)}`;
  const line = `Signed until ${until}`;
  if (left <= 0) return { state: 'expired', expiresUtc, banner: null, line: `Signing ended ${until}`, detail: 'Refresh Fizz in SideStore.' };
  if (left < TIMING.expiryUrgent) {
    const sameDay = localDateKey(expiresMs, tz) === localDateKey(nowMs, tz);
    const by = sameDay ? `today, by ${formatTime(expiresMs, tz, locale)}` : `by tomorrow ${formatTime(expiresMs, tz, locale)}`;
    return { state: 'urgent', expiresUtc, banner: `Refresh Fizz in SideStore ${by}`, line, detail: 'Refresh weekly in SideStore.' };
  }
  if (left < TIMING.expiryNotice) {
    return { state: 'notice', expiresUtc, banner: `Refresh Fizz in SideStore by ${refreshByDay(expiresMs, tz, locale)}`, line, detail: 'Refresh weekly in SideStore.' };
  }
  return { state: 'ok', expiresUtc, banner: null, line, detail: 'Refresh weekly in SideStore.' };
}
