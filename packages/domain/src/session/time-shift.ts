import type { RestTimer, SessionAggregate, SessionCommand, SessionPastLog, ZonedTimestamp } from '@fizz/schemas';
import { addDays, clockText, localDateOf, localTimeUtcMs } from '../calendar';
import { toIso, toMs } from '../time';

/**
 * (Ben, 25 Oct: "I should be able to freely edit times, e.g. if I want to import a workout
 * historically from the day before or beyond.") Pure helpers that move a whole workout in time, and
 * the placeholder set times of a workout logged after the fact. Nothing here reads the clock.
 *
 * A shift moves every time on the workout's own timeline by the same offset, so order and durations
 * stay exactly as logged: the start and end, every set's `completedAt`, the open pause and closed
 * pauses, rest and work timers (and rests kept for an untick), `Finish by`, a removed exercise's
 * time and gym changes. Times of edits (audits, processed operations, `lastActivityAtUtc`, feel,
 * `Count it`, a deletion, `pastLog.enteredAt`) are when Ben did something, so they stay. Every
 * stamp keeps its own time zone; logged values and set versions never change.
 */

/** The earliest start a moved or past-logged workout may have (1 Jan 2000 UTC): a guard against a wheel spun to nonsense, not a product limit. */
export const EARLIEST_WORKOUT_MS = 946_684_800_000;

const shiftIso = (iso: string, offsetMs: number): string => toIso(toMs(iso) + offsetMs);
const shiftZoned = (z: ZonedTimestamp, offsetMs: number): ZonedTimestamp => ({ utc: shiftIso(z.utc, offsetMs), tz: z.tz });

function shiftTimer<T extends Pick<RestTimer, 'startedAtUtc' | 'deadlineUtc' | 'endedAtUtc'>>(t: T, offsetMs: number): T {
  return { ...t, startedAtUtc: shiftIso(t.startedAtUtc, offsetMs), deadlineUtc: shiftIso(t.deadlineUtc, offsetMs), endedAtUtc: t.endedAtUtc === null ? null : shiftIso(t.endedAtUtc, offsetMs) };
}

/** The workout with every time on its timeline moved by `offsetMs` (see above). 0 returns the same object. */
export function shiftSessionTimes(state: SessionAggregate, offsetMs: number): SessionAggregate {
  if (offsetMs === 0) return state;
  const s = state.session;
  const restTimer: RestTimer | null =
    state.restTimer === null
      ? null
      : {
          ...shiftTimer(state.restTimer, offsetMs),
          ...(state.restTimer.resumeOnUndo === undefined ? {} : { resumeOnUndo: state.restTimer.resumeOnUndo.map((r) => ({ ...r, timer: shiftTimer(r.timer, offsetMs) })) }),
        };
  return {
    ...state,
    session: {
      ...s,
      startedAt: shiftZoned(s.startedAt, offsetMs),
      endedAt: s.endedAt === null ? null : shiftZoned(s.endedAt, offsetMs),
      pause: s.pause === null ? null : { pausedAtUtc: shiftIso(s.pause.pausedAtUtc, offsetMs) },
      pauses: s.pauses.map((p) => ({ startUtc: shiftIso(p.startUtc, offsetMs), endUtc: shiftIso(p.endUtc, offsetMs) })),
      ...(s.finishBy === undefined ? {} : { finishBy: shiftZoned(s.finishBy, offsetMs) }),
      ...(s.gymChanges === undefined ? {} : { gymChanges: s.gymChanges.map((g) => ({ ...g, at: shiftZoned(g.at, offsetMs) })) }),
    },
    exercises: state.exercises.map((e) => (e.removed === undefined ? e : { ...e, removed: { ...e.removed, at: shiftZoned(e.removed.at, offsetMs) } })),
    sets: state.sets.map((x) => (x.completedAt === null ? x : { ...x, completedAt: shiftZoned(x.completedAt, offsetMs) })),
    restTimer,
    workInterval: state.workInterval === null ? null : shiftTimer(state.workInterval, offsetMs),
  };
}

/**
 * The latest time on the workout's timeline that has already happened (a logged set, a pause's
 * start or end, a finished timer's end): after a shift it must still not be in the future. Null
 * when nothing has happened yet beyond the start. Timer deadlines are left out (a cancelled rest's
 * deadline can lie ahead of its end).
 */
export function latestHappenedMs(state: SessionAggregate): number | null {
  const stamps: number[] = [];
  for (const x of state.sets) if (x.status === 'completed' && x.completedAt !== null) stamps.push(toMs(x.completedAt.utc));
  for (const p of state.session.pauses) stamps.push(toMs(p.endUtc));
  if (state.session.pause !== null) stamps.push(toMs(state.session.pause.pausedAtUtc));
  return stamps.length === 0 ? null : Math.max(...stamps);
}

/** The original time of a stamp now at `utc`, given the timing audit's shifts (provenance; Ben, 25 Oct). */
export function unshiftedMs(utc: string, timingAudit: SessionAggregate['timingAudit']): number {
  return toMs(utc) - timingAudit.reduce((sum, e) => sum + (e.shiftMs ?? 0), 0);
}

/** A workout entered after the fact (`Log a past workout`). */
export function isPastLog(session: { pastLog?: SessionPastLog | undefined }): boolean {
  return session.pastLog !== undefined;
}

/** Placeholder sets sit this far apart in a past log, in the order Ben ticked them. */
export const PAST_LOG_SET_SPACING_MS = 1000;

/**
 * The `completedAt` of a set ticked in a past log: a second after the start or the latest set
 * logged so far (so order is kept and the end can be anywhere after it), in the workout's zone,
 * and never later than `nowMs`.
 */
export function pastLogCompletedAt(state: SessionAggregate, nowMs: number): ZonedTimestamp {
  const startMs = toMs(state.session.startedAt.utc);
  const latest = Math.max(startMs, ...state.sets.flatMap((x) => (x.status === 'completed' && x.completedAt !== null ? [toMs(x.completedAt.utc)] : [])));
  return { utc: toIso(Math.min(nowMs, latest + PAST_LOG_SET_SPACING_MS)), tz: state.session.startedAt.tz };
}

/**
 * A new workout made a past log: started at `startedAt` (the date and time Ben picked), marked with
 * when he entered it. Built by the start path before the single write, so a retry with the same
 * operation ID finds it. The new workout has nothing logged yet, so only the start moves.
 */
export function asPastLog(aggregate: SessionAggregate, startedAt: ZonedTimestamp, enteredAt: ZonedTimestamp): SessionAggregate {
  return { ...aggregate, session: { ...aggregate.session, startedAt, pastLog: { enteredAt } } };
}

/**
 * `Log a past workout`'s first values (Ben, 25 Oct): yesterday, at the time of day his latest
 * workout started (to the 5 minutes), else 18:00, in `tz`. Never in the future.
 */
export function pastLogDefaultStart(nowMs: number, tz: string, latestStartMs: number | null): number {
  const date = addDays(localDateOf(nowMs, tz), -1);
  let hour = 18;
  let minute = 0;
  if (latestStartMs !== null) {
    const [h, m] = clockText(latestStartMs, tz).split(':').map(Number);
    hour = h ?? hour;
    minute = Math.floor((m ?? 0) / 5) * 5;
  }
  return Math.min(nowMs, localTimeUtcMs(date, hour, minute, tz));
}

/** A past log's start: on or before now, after 1 Jan 2000. Null = fine. */
export function pastLogStartRefusal(startMs: number, nowMs: number): 'in_future' | 'too_far_back' | null {
  if (startMs > nowMs) return 'in_future';
  if (startMs < EARLIEST_WORKOUT_MS) return 'too_far_back';
  return null;
}

/** A past log's default end on the Finish sheet: an hour after the start, or a minute after the last set if later, never past now. */
export const PAST_LOG_DEFAULT_MS = 60 * 60_000;
export function pastLogDefaultEnd(startMs: number, lastSetMs: number | null, nowMs: number): number {
  return Math.min(nowMs, Math.max(startMs + PAST_LOG_DEFAULT_MS, (lastSetMs ?? startMs) + 60_000));
}

/**
 * The one-tap Undo of a timing edit (Ben, 25 Oct): the times as they were before operation
 * `editOpId` (read from its timing audit entries, zones and all), on the version it made, with a new
 * operation. A moved start moves the whole workout back (`shift`); an end alone goes back alone.
 * Null: that operation changed nothing. A later edit makes it stale, never applied to newer state.
 */
export function timingUndoCommand(after: SessionAggregate, editOpId: string, opId: string, at: ZonedTimestamp): Extract<SessionCommand, { type: 'update_session_timing' }> | null {
  const s = after.session;
  const start = after.timingAudit.find((e) => e.opId === editOpId && e.field === 'startedAt');
  const end = after.timingAudit.find((e) => e.opId === editOpId && e.field === 'endedAt');
  const base = { type: 'update_session_timing' as const, at, opId, expectedVersion: s.version };
  // A workout with an end (finished) gets its end back too; one still open has none to give.
  if (start?.before) return { ...base, startedAt: start.before, endedAt: s.endedAt === null ? null : (end?.before ?? s.endedAt), ...(start.shiftMs === undefined ? {} : { shift: true as const }) };
  if (end?.before) return { ...base, startedAt: null, endedAt: end.before };
  return null;
}
