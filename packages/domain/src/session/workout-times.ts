import type { SessionAggregate } from '@fizz/schemas';
import { localDateOf } from '../calendar';
import { formatMinutes } from '../display';
import { toMs } from '../time';
import { EARLIEST_WORKOUT_MS, latestHappenedMs } from './time-shift';

/**
 * Started / Ended on the Finish sheet and in a past workout's `Edit times` (Ben, 19 Oct: "Option
 * to change start and end by scrolling when finish workout"). Pure: the bounds the wheels allow,
 * a clamp with a short note, the live duration and whether the wheels need the date. The writes
 * (`finish` with `startedAt`, `update_session_timing`) check the same bounds again; no set changes.
 *
 * - Start: not after the first logged set, not in the future; at most 24 h before it was recorded.
 * - End: not before the last logged set, after the start, not in the future.
 *
 * (Ben, 25 Oct: "freely edit times, e.g. import a workout historically from the day before or
 * beyond") On the Finish sheet, a past workout's `Edit times` and a past log, moving the start moves
 * the whole workout instead (`shiftTimeBounds`, `moveWorkoutTimes`): any past date and time, every
 * set moving with it, the end by the same amount until Ben sets it on its own (after the last set,
 * after the start, not in the future). The live workout's own `Edit workout times` keeps the rule above.
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

export type TimeNote = 'start_after_first_set' | 'start_in_future' | 'start_too_early' | 'start_too_far_back' | 'sets_in_future' | 'end_before_last_set' | 'end_in_future' | 'end_before_start';

/** The short note under the rows after a clamp (minimal copy: the value says the rest). */
export const TIME_NOTE: Readonly<Record<TimeNote, string>> = {
  start_after_first_set: 'Start can’t be after the first set',
  start_in_future: 'Start can’t be in the future',
  start_too_early: 'Start can’t move back more than a day',
  start_too_far_back: 'Start can’t be before 2000',
  sets_in_future: 'Sets can’t move into the future',
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

/**
 * The workout's times as recorded, which a move of the whole workout is measured from (Ben, 25 Oct).
 * `lastSetMs`: the last logged set; `latestMs`: the latest time that has already happened (a set, a
 * pause), which must not move past now (`latestHappenedMs`).
 */
export interface WorkoutTimeline {
  startMs: number;
  lastSetMs: number | null;
  latestMs: number | null;
}

export function timelineOf(state: SessionAggregate): WorkoutTimeline {
  const done = state.sets.flatMap((s) => (s.status === 'completed' && s.completedAt ? [toMs(s.completedAt.utc)] : []));
  return { startMs: toMs(state.session.startedAt.utc), lastSetMs: done.length > 0 ? Math.max(...done) : null, latestMs: latestHappenedMs(state) };
}

/** The same from a finished workout's Summary (`timeline`, read when it was built). */
export function summaryTimeline(startedAtUtc: string, t: { lastSetUtc: string | null; latestUtc: string | null }): WorkoutTimeline {
  return { startMs: toMs(startedAtUtc), lastSetMs: t.lastSetUtc === null ? null : toMs(t.lastSetUtc), latestMs: t.latestUtc === null ? null : toMs(t.latestUtc) };
}

/**
 * Bounds when the start moves the whole workout, with the start now at `startMs`: any start from
 * 2000 until the latest one that keeps every logged set (and pause) out of the future and leaves a
 * minute for the end; the end from the last set (moved with the start) or a minute after the start,
 * until now.
 */
export function shiftTimeBounds(t: WorkoutTimeline, startMs: number, nowMs: number): WorkoutTimeBounds {
  const offset = startMs - t.startMs;
  return {
    startMinMs: EARLIEST_WORKOUT_MS,
    startMaxMs: Math.max(EARLIEST_WORKOUT_MS, Math.min(nowMs - MINUTE, t.startMs + nowMs - (t.latestMs ?? t.startMs))),
    endMinMs: t.lastSetMs === null ? startMs : t.lastSetMs + offset,
    endMaxMs: nowMs,
  };
}

/**
 * A wheel's new value when the start moves the whole workout (Ben, 25 Oct). Moving the start keeps
 * the duration (the end moves by the same amount), then the end is kept after the last set and the
 * start and not in the future. Moving the end changes the end only. Whole minutes, as the wheels.
 */
export function moveWorkoutTimes(which: 'start' | 'end', ms: number, times: { startMs: number; endMs: number }, t: WorkoutTimeline, nowMs: number): ClampedTimes {
  if (which === 'end') return clampWorkoutTimes({ startMs: times.startMs, endMs: ms }, shiftTimeBounds(t, times.startMs, nowMs));
  const any = shiftTimeBounds(t, times.startMs, nowMs);
  let note: TimeNote | null = null;
  let startMs = ms;
  if (startMs > any.startMaxMs) {
    startMs = any.startMaxMs;
    // Stopped by now itself, or by a logged set that would pass now first.
    note = t.latestMs !== null && t.startMs + nowMs - t.latestMs < nowMs - MINUTE ? 'sets_in_future' : 'start_in_future';
  } else if (startMs < EARLIEST_WORKOUT_MS) {
    startMs = EARLIEST_WORKOUT_MS;
    note = 'start_too_far_back';
  }
  const moved = clampWorkoutTimes({ startMs, endMs: times.endMs + (startMs - times.startMs) }, shiftTimeBounds(t, startMs, nowMs));
  return { startMs: moved.startMs, endMs: moved.endMs, note: note ?? moved.note };
}

/**
 * (Ben, 26 Oct; log-past-workout Q-PL1) When Started moves on the Finish sheet, the Summary's or a past workout's
 * `Edit times`: `Move whole workout` (the default, its sets with it, ADR 0033) or `Only the start` (the sets stay
 * where they were; the start stays at or before the first set, within the 19 Oct bounds, `workoutTimeBounds`).
 */
export type StartMove = 'whole' | 'start_only';

export const START_MOVE_LABEL: Readonly<Record<StartMove, string>> = { whole: 'Move whole workout', start_only: 'Only the start' };

/**
 * The choice shows once Started has moved, on a workout with real set times. A past log's set times are
 * placeholders a second apart from its start, so only moving the whole of it means anything there.
 */
export function startMoveShown(startMs: number, recordedStartMs: number, pastLog: boolean): boolean {
  return !pastLog && startMs !== recordedStartMs;
}

/**
 * The times after Ben picks how the moved start applies. To `start_only`: the end goes back to where it was before
 * it moved along with the start, then both are kept in the 19 Oct bounds (`fixed`: not after the first set, at
 * most a day back, the end after the last set). To `whole`: the end moves along with the start again
 * (`moveWorkoutTimes`). Whole minutes, with the short note when something was clamped.
 */
export function switchStartMove(mode: StartMove, times: { startMs: number; endMs: number }, ctx: { timeline: WorkoutTimeline; fixed: WorkoutTimeBounds; nowMs: number }): ClampedTimes {
  const offset = times.startMs - ctx.timeline.startMs;
  if (mode === 'start_only') return clampWorkoutTimes({ startMs: times.startMs, endMs: times.endMs - offset }, ctx.fixed);
  return moveWorkoutTimes('start', times.startMs, { startMs: ctx.timeline.startMs, endMs: times.endMs }, ctx.timeline, ctx.nowMs);
}

/** The write's part for a moved start: `shift: true` moves the whole workout; `Only the start` writes none (19 Oct). */
export function startMoveWrite(mode: StartMove, startMoved: boolean): { shift?: true } {
  return startMoved && mode === 'whole' ? { shift: true } : {};
}
