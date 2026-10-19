import type { SessionAggregate } from '@fizz/schemas';
import { localDateOf } from '../calendar';
import { formatMinutes } from '../display';
import { toMs } from '../time';

/**
 * Started / Ended on the Finish sheet and in a past workout's `Edit times` (Ben, 19 Oct: "Option
 * to change start and end by scrolling when finish workout"). Pure: the bounds the wheels allow,
 * a clamp with a short note, the live duration and whether the wheels need the date. The writes
 * (`finish` with `startedAt`, `update_session_timing`) check the same bounds again; no set changes.
 *
 * - Start: not after the first logged set, not in the future; at most 24 h before it was recorded.
 * - End: not before the last logged set, after the start, not in the future.
 */

const MINUTE = 60_000;
/** How far back a start may move: a forgotten Start, or one entered a day late. */
export const START_BACK_MS = 24 * 3600_000;

export interface WorkoutTimeBounds {
  startMinMs: number;
  /** The latest start: the first logged set, else now (else the end, for a finished workout with nothing logged). */
  startMaxMs: number;
  /** The earliest end, before the start rule: the last logged set, else the start. */
  endMinMs: number;
  endMaxMs: number;
}

export function workoutTimeBounds(state: SessionAggregate, nowMs: number): WorkoutTimeBounds {
  const done = state.sets.flatMap((s) => (s.status === 'completed' && s.completedAt ? [toMs(s.completedAt.utc)] : []));
  const startMs = toMs(state.session.startedAt.utc);
  const first = done.length > 0 ? Math.min(...done) : null;
  const last = done.length > 0 ? Math.max(...done) : null;
  // A workout still paused: the start can't move after the pause (as `update_session_timing`).
  const paused = state.session.pause === null ? nowMs : toMs(state.session.pause.pausedAtUtc);
  return {
    startMinMs: startMs - START_BACK_MS,
    startMaxMs: Math.min(nowMs, paused, first ?? nowMs),
    endMinMs: last ?? startMs,
    endMaxMs: nowMs,
  };
}

export type TimeNote = 'start_after_first_set' | 'start_in_future' | 'start_too_early' | 'end_before_last_set' | 'end_in_future' | 'end_before_start';

/** The short note under the rows after a clamp (minimal copy: the value says the rest). */
export const TIME_NOTE: Readonly<Record<TimeNote, string>> = {
  start_after_first_set: 'Start can’t be after the first set',
  start_in_future: 'Start can’t be in the future',
  start_too_early: 'Start can’t move back more than a day',
  end_before_last_set: 'End can’t be before the last set',
  end_in_future: 'End can’t be in the future',
  end_before_start: 'End must be after the start',
};

export interface ClampedTimes {
  startMs: number;
  endMs: number;
  /** Why a value moved; null when both were inside the bounds. */
  note: TimeNote | null;
}

/** Whole minutes (the wheels have no seconds), kept inside the bounds; the end at least a minute after the start. */
export function clampWorkoutTimes(input: { startMs: number; endMs: number }, b: WorkoutTimeBounds): ClampedTimes {
  let note: TimeNote | null = null;
  let startMs = input.startMs;
  if (startMs > b.startMaxMs) {
    startMs = b.startMaxMs;
    note = b.startMaxMs < b.endMaxMs ? 'start_after_first_set' : 'start_in_future';
  } else if (startMs < b.startMinMs) {
    startMs = b.startMinMs;
    note = 'start_too_early';
  }
  let endMs = input.endMs;
  const endMin = Math.max(b.endMinMs, startMs + MINUTE);
  if (endMs > b.endMaxMs) {
    endMs = b.endMaxMs;
    note ??= 'end_in_future';
  } else if (endMs < endMin) {
    endMs = endMin;
    note ??= b.endMinMs >= startMs + MINUTE ? 'end_before_last_set' : 'end_before_start';
  }
  // Never past now, even when the start is a minute before it.
  if (endMs > b.endMaxMs) endMs = b.endMaxMs;
  return { startMs, endMs, note };
}

/** `1 h 12 min`, `48 min`. */
export function workoutDurationText(startMs: number, endMs: number): string {
  return formatMinutes(Math.max(0, endMs - startMs));
}

/** The rows show the date as well when the workout crosses midnight (or spans days); otherwise the time only. */
export function timesNeedDate(times: { startMs: number; endMs: number }, tz: string): boolean {
  return localDateOf(times.startMs, tz) !== localDateOf(times.endMs, tz);
}

/**
 * A wheel shows the date column whenever the range it allows spans two local dates (review S4), so
 * a start recorded at 00:05 can move back to 23:50 the day before even while both times are on
 * one date. A range within one day keeps the time-only wheel.
 */
export function wheelNeedsDate(minMs: number, maxMs: number, tz: string): boolean {
  return localDateOf(minMs, tz) !== localDateOf(maxMs, tz);
}

/** The same bounds from a finished workout's Summary (`timingBounds`), read again at `nowMs`. */
export function summaryTimeBounds(t: { startLatestUtc: string; endEarliestUtc: string; endLatestUtc: string }, recordedStartUtc: string, nowMs: number): WorkoutTimeBounds {
  return {
    startMinMs: toMs(recordedStartUtc) - START_BACK_MS,
    startMaxMs: Math.min(toMs(t.startLatestUtc), nowMs),
    endMinMs: toMs(t.endEarliestUtc),
    endMaxMs: Math.max(toMs(t.endLatestUtc), nowMs),
  };
}
