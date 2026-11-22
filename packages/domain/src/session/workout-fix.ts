import type { ActionDetail, SessionAggregate, SessionCommand, ZonedTimestamp } from '@fizz/schemas';

import { clockText, localDateOf, localMidnightUtcMs, localTimeUtcMs } from '../calendar';
import { toIso, toMs } from '../time';
import { isInHistory, shortDateText } from './deletion';
import { reduceSession } from './reducer';

/**
 * (Ben, 2 Nov) Fixing a past workout from the coach (`propose_workout_fix`): pure pieces the app's checks and the
 * store's Apply share. A move is the workout's own `update_session_timing` with `shift` (Summary's Edit times: the sets
 * move with the start, order and lengths as logged), checked here by the reducer itself before it is proposed. Delete
 * and Health pairing reuse History's delete plan and the day sheet's link changes unchanged; only their card text and
 * op IDs live here.
 */

export type WorkoutFixDetail = Extract<ActionDetail, { kind: 'fix_workout' }>;

/** The op ID of Ben's Apply on a fix proposal: the same on a double tap or after a restart (rule 5). */
export const workoutFixApplyOpId = (proposalId: string): string => `workout-fix:${proposalId}`;

/** `Tue 28 Oct · 18:04–19:02` in the workout's own zone; a date-only workout (an import) shows its date alone. */
export function workoutWhenText(w: { startedAt: ZonedTimestamp; endedAt: ZonedTimestamp | null; localDate?: string | undefined }): string {
  const tz = w.startedAt.tz;
  const startMs = toMs(w.startedAt.utc);
  const date = shortDateText(w.localDate ?? localDateOf(startMs, tz));
  if (w.localDate !== undefined) return date;
  const end = w.endedAt === null ? '' : `–${clockText(toMs(w.endedAt.utc), tz)}`;
  return `${date} · ${clockText(startMs, tz)}${end}`;
}

/** `18:04` → [18, 4]; null when it isn't a clock time. */
function parseClock(text: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : [h, min];
}

export type WorkoutMovePlan =
  | { ok: true; startedAt: ZonedTimestamp; endedAt: ZonedTimestamp | null; before: string; after: string }
  /** One short line for the coach and the card (`Only a finished workout can move`). */
  | { ok: false; line: string };

/**
 * A finished workout moved to `date` (its local day; null keeps the day), starting at `start` (`HH:MM`; null keeps the
 * time of day) and ending at `end` (null keeps its length). In the workout's own timezone (UTC + zone, as stored).
 * Checked with the reducer's own rules (not in the future, sets never after the end) on the workout as it is now.
 */
export function planWorkoutMove(agg: SessionAggregate, req: { date: string | null; start: string | null; end: string | null }, at: ZonedTimestamp): WorkoutMovePlan {
  const s = agg.session;
  if (s.localDate !== undefined) return { ok: false, line: 'An imported workout keeps its date' };
  if (!isInHistory(s) || s.endedAt === null) return { ok: false, line: 'Only a finished workout can move' };
  const tz = s.startedAt.tz;
  const startMs = toMs(s.startedAt.utc);
  const day = localDateOf(startMs, tz);
  const newDay = req.date ?? day;
  let newStartMs: number;
  if (req.start === null) {
    // The same clock time on the new day (seconds kept): the day's local midnights apart, so a DST change is right.
    newStartMs = startMs + (localMidnightUtcMs(newDay, tz) - localMidnightUtcMs(day, tz));
  } else {
    const c = parseClock(req.start);
    if (c === null) return { ok: false, line: `${req.start} isn’t a time` };
    newStartMs = localTimeUtcMs(newDay, c[0], c[1], tz);
  }
  let endedAt: ZonedTimestamp | null = null;
  if (req.end !== null) {
    const c = parseClock(req.end);
    if (c === null) return { ok: false, line: `${req.end} isn’t a time` };
    let endMs = localTimeUtcMs(newDay, c[0], c[1], tz);
    // An end past midnight (start 23:10, end 00:20) is the next morning.
    if (endMs <= newStartMs) endMs = localTimeUtcMs(localDateOf(newStartMs + 86_400_000, tz), c[0], c[1], tz);
    endedAt = { utc: toIso(endMs), tz };
  }
  const startedAt: ZonedTimestamp = { utc: toIso(newStartMs), tz };
  const probe = reduceSession(agg, moveCommand({ sessionVersion: s.version, startedAt, endedAt }, 'workout-fix:check', at));
  if (!probe.ok) return { ok: false, line: probe.error.message.replace(/\.$/, '') };
  const moved = probe.state.session;
  if (moved.startedAt.utc === s.startedAt.utc && moved.endedAt?.utc === s.endedAt.utc) return { ok: false, line: `Already ${workoutWhenText(s)}` };
  return { ok: true, startedAt: moved.startedAt, endedAt: moved.endedAt, before: workoutWhenText(s), after: workoutWhenText(moved) };
}

/** The move as the workout's own command (Summary's Edit times with `shift`), on the version proposed. */
export function moveCommand(m: { sessionVersion: number; startedAt: ZonedTimestamp; endedAt: ZonedTimestamp | null }, opId: string, at: ZonedTimestamp): Extract<SessionCommand, { type: 'update_session_timing' }> {
  return { type: 'update_session_timing', at, opId, expectedVersion: m.sessionVersion, startedAt: m.startedAt, endedAt: m.endedAt, shift: true };
}

/**
 * Two app workouts recorded as one (Ben, 2 Nov: "these two strength sessions are the same workout"): the store can't
 * merge two workouts' sets, so the coach offers to delete the duplicate instead. The line it is told.
 */
export const WORKOUT_MERGE_UNSUPPORTED = 'Two app workouts can’t be merged; propose deleting the duplicate instead';
