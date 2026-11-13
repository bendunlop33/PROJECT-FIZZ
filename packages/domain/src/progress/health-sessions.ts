import type { Activity } from '@fizz/schemas';
import { HK_STRENGTH_TYPES } from '../health';
import { toMs } from '../time';
import { PROGRESS_DURATION_CAP_MS } from './activity';
import type { ProgressSession } from './projection';

/**
 * (Ben, 3 Nov) A strength workout recorded only in Apple Health (Garmin, a watch) counts as one session in Progress ›
 * Training: the sessions-a-week bars, Sessions and its comparison, A week, the Month calendar, Consistency and Time.
 * It has no sets, loads, muscles or plan day (Health sends none), so it is never a `ProgressSession`: the views that
 * read exercises can't take one. Pure.
 */

/** What session counts and time read: a finished workout, or a Health strength workout counted as a session. */
export type CountedSession = Pick<ProgressSession, 'sessionId' | 'version' | 'name' | 'date' | 'startedMs' | 'durationMs' | 'dateOnly' | 'durationConfirmed'> & {
  /** Present only on a Health strength workout counted as a session. */
  fromHealth?: HealthStrengthSession['fromHealth'];
};

export interface HealthStrengthSession extends CountedSession {
  /** `health:<uuid>`: never a workout ID (nothing can open it as one). */
  sessionId: string;
  version: 1;
  /** Health's label: `Strength`, `Core`, `Cross training`. */
  name: string;
  dateOnly: false;
  durationConfirmed: false;
  fromHealth: {
    /** The activity it shows as (its existing Health sheet): the Health UUID. */
    activityId: string;
    /** `Garmin`. */
    sourceName: string;
    activityType: number;
  };
}

/** The app or imported workouts a Health one is checked against: their day and times. */
export type SessionTimes = Pick<ProgressSession, 'date' | 'startedMs' | 'durationMs' | 'dateOnly'> & { endedAtUtc?: string | null };

/**
 * The Health strength-family workouts that count as sessions of their own, oldest first. `activities` is what every
 * list shows (`activitiesWithHealth`: never the app's own writes, a linked one, or another source's recording of a
 * linked one; two sources of one workout are one). Of those, a done strength-family Health workout counts unless:
 * - Ben kept it apart from a workout himself (`Unlink`, `Not it`: `excludedUuids`);
 * - an app or imported workout the same local day overlaps it at all, or has no times to compare (a date-only import,
 *   or no end): it may be that workout, so it is never counted twice.
 * Time: its recorded start to end; over the 4 h cap it adds no time (it can't be confirmed like a workout).
 */
export function healthStrengthSessions(input: { activities: readonly Activity[]; sessions: readonly SessionTimes[]; excludedUuids?: ReadonlySet<string> }): HealthStrengthSession[] {
  const byDate = new Map<string, SessionTimes[]>();
  for (const s of input.sessions) {
    const list = byDate.get(s.date);
    if (list === undefined) byDate.set(s.date, [s]);
    else list.push(s);
  }
  const out: HealthStrengthSession[] = [];
  const seen = new Set<string>();
  for (const a of input.activities) {
    const h = a.health;
    if (a.source !== 'health' || h === undefined || a.deletedAtUtc !== null || a.fields.status !== 'done') continue;
    if (!h.strength || !HK_STRENGTH_TYPES.has(h.activityType)) continue;
    const uuid = h.uuid.toLowerCase();
    if (seen.has(uuid) || input.excludedUuids?.has(uuid) === true) continue;
    const startMs = toMs(h.startUtc);
    const endMs = toMs(h.endUtc);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const date = a.fields.date;
    const sameDay = byDate.get(date) ?? [];
    const overlaps = sameDay.some((s) => {
      const sEnd = s.endedAtUtc != null ? toMs(s.endedAtUtc) : s.durationMs === null ? null : s.startedMs + s.durationMs;
      if (s.dateOnly || sEnd === null) return true;
      return Math.min(sEnd, endMs) > Math.max(s.startedMs, startMs);
    });
    if (overlaps) continue;
    seen.add(uuid);
    const durationMs = endMs - startMs;
    out.push({
      sessionId: `health:${uuid}`,
      version: 1,
      name: h.label,
      date,
      startedMs: startMs,
      durationMs: durationMs > PROGRESS_DURATION_CAP_MS ? null : durationMs,
      dateOnly: false,
      durationConfirmed: false,
      fromHealth: { activityId: a.id, sourceName: h.sourceName, activityType: h.activityType },
    });
  }
  return out.sort((x, y) => x.startedMs - y.startedMs);
}

/** The Health activity IDs counted as sessions (the calendar shows them as their Health rows). */
export function healthSessionActivityIds(sessions: readonly HealthStrengthSession[]): Set<string> {
  return new Set(sessions.map((s) => s.fromHealth.activityId));
}
