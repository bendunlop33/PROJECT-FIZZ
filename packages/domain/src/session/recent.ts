import type { ZonedTimestamp } from '@fizz/schemas';

import { daysBetween, localDateOf, weekdayIndexOfDate } from '../calendar';
import { localDateText, NBSP } from '../display';
import { toMs } from '../time';

/**
 * Today's `Recent` (PM decision 18 Oct, pending Ben): the last few finished
 * workouts, any source, newest first, each as name, short day and set count.
 * Replaces This week, the lift card and the Sessions rows. Pure.
 */

export const RECENT_LIMIT = 5;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Under this many days back a date reads as its weekday (`Sat`). */
const WEEKDAY_WITHIN_DAYS = 6;

/** Dates this many calendar months back or more show their year (as `formatLastDone`). */
const YEAR_AFTER_MONTHS = 11;

/**
 * `Today` · `Yesterday` · `Sat` (2–6 days back) · `12 Oct` · `12 Oct 2025`
 * (11 or more calendar months back). Both dates local `YYYY-MM-DD`.
 */
export function shortRelativeDay(date: string, today: string): string {
  const d = daysBetween(date, today);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= WEEKDAY_WITHIN_DAYS) return WEEKDAY_SHORT[weekdayIndexOfDate(date)] ?? localDateText(date);
  const [y, m] = date.split('-').map(Number);
  const [ny, nm] = today.split('-').map(Number);
  const months = ((ny ?? 0) - (y ?? 0)) * 12 + ((nm ?? 0) - (m ?? 0));
  return months >= YEAR_AFTER_MONTHS ? `${localDateText(date)}${NBSP}${String(y)}` : localDateText(date);
}

/** A finished workout as Past workouts lists it (`RepeatCandidate`'s fields). */
export interface RecentWorkoutInput {
  sessionId: string;
  /** Stored name, else the derived title (`Push`), as Past workouts shows it. */
  title: string;
  startedAtUtc: string;
  tz: string;
  /** Imported workouts have a date only. */
  localDate: string | null;
  /** Completed sets (pairs once). */
  sets: number;
}

export interface RecentWorkoutRow {
  sessionId: string;
  title: string;
  /** `Yesterday`, `Sat`, `12 Oct`. */
  when: string;
  /** `16 sets`. */
  detail: string;
  accessibilityLabel: string;
  /** Same as Past workouts: nothing logged opens the Summary, else the past workout's page. */
  opens: 'summary' | 'repeat';
}

/**
 * Up to `RECENT_LIMIT` rows, newest first (by start; ties by ID). An imported
 * workout's day is its own recorded date; others are in `now`'s zone.
 */
export function recentWorkoutRows(rows: readonly RecentWorkoutInput[], now: ZonedTimestamp, limit = RECENT_LIMIT): RecentWorkoutRow[] {
  const today = localDateOf(toMs(now.utc), now.tz);
  return [...rows]
    .sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc) || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0))
    .slice(0, Math.max(0, limit))
    .map((r) => {
      const when = shortRelativeDay(r.localDate ?? localDateOf(toMs(r.startedAtUtc), now.tz), today);
      const detail = `${String(r.sets)}${NBSP}${r.sets === 1 ? 'set' : 'sets'}`;
      return { sessionId: r.sessionId, title: r.title, when, detail, accessibilityLabel: `${r.title}, ${when}, ${detail.replace(NBSP, ' ')}`, opens: r.sets === 0 ? 'summary' : 'repeat' };
    });
}
