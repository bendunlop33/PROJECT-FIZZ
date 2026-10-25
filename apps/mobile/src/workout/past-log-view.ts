import { clockText, EARLIEST_WORKOUT_MS, localDateOf, localTimeUtcMs, pastLogStartRefusal } from '@fizz/domain';

import { formatShortDate, formatTime } from '../format/dates';

/**
 * `Log a past workout` (Ben, 25 Oct: "I should be able to freely edit times, e.g. if I want to import a
 * workout historically from the day before or beyond"). Pure: the sheet's words and how its Date and
 * Start wheels make one start time in the zone. Minimal copy (Ben, 10 Oct): values and actions only.
 */
export const PAST_LOG_COPY = {
  entry: 'Log a past workout',
  title: 'Log a past workout',
  date: 'Date',
  start: 'Start',
  from: 'Start from',
  empty: 'Empty workout',
  planDays: 'Your plan',
  workouts: 'Saved workouts',
  inFuture: 'Start can’t be in the future',
  tooFarBack: 'Start can’t be before 2000',
  openWorkout: 'Finish the open workout first.',
  failed: 'Couldn’t start. Try again.',
  cancel: 'Cancel',
} as const;

/** `Thu 24 Oct, 18:00`: a past log's date and start in the workout's top bar. */
export function pastLogWhen(startMs: number, tz: string, locale?: string): string {
  return `${formatShortDate(startMs, tz, locale)}, ${formatTime(startMs, tz, locale)}`;
}

/** The Date wheel picked `pickedMs`: that calendar date (in `tz`) at the start's time of day. */
export function withPickedDate(startMs: number, pickedMs: number, tz: string): number {
  const [h, m] = clockText(startMs, tz).split(':').map(Number);
  return localTimeUtcMs(localDateOf(pickedMs, tz), h ?? 0, m ?? 0, tz);
}

/** The Start wheel picked `pickedMs`: the start's date at that time of day (in `tz`), whole minutes. */
export function withPickedTime(startMs: number, pickedMs: number, tz: string): number {
  const [h, m] = clockText(pickedMs, tz).split(':').map(Number);
  return localTimeUtcMs(localDateOf(startMs, tz), h ?? 0, m ?? 0, tz);
}

/** The start kept in range (not in the future, not before 2000) with the note to show, if any. */
export function clampPastStart(startMs: number, nowMs: number): { startMs: number; note: string | null } {
  switch (pastLogStartRefusal(startMs, nowMs)) {
    case 'in_future':
      return { startMs: Math.floor(nowMs / 60_000) * 60_000, note: PAST_LOG_COPY.inFuture };
    case 'too_far_back':
      return { startMs: EARLIEST_WORKOUT_MS, note: PAST_LOG_COPY.tooFarBack };
    case null:
      return { startMs, note: null };
  }
}
