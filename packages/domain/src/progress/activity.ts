import { addDays, addMonths, daysBetween, weekdayIndexOfDate } from '../calendar';
import type { ProgressSession } from './projection';
import { inRange, type DateRange, type ProgressWindow } from './window';

/**
 * Sessions and time in gym over a Progress window (progress.md PG24, PG24a,
 * PG24b, PG25). Pure. Every finished workout counts as a session, logged or
 * imported (their dates are real); only workouts with real times add time.
 */

export interface WeekCount {
  /** First date of this bar inside the window (the label: `12 Sep`, not the Monday before it). */
  from: string;
  to: string;
  count: number;
  /** The bar covers less than a whole Monday–Sunday week (the window cut it). */
  partial: boolean;
}

export interface MonthCount {
  /** First date of this bar inside the window. */
  from: string;
  to: string;
  count: number;
  /** The window cut the month. */
  partial: boolean;
}

/**
 * Activity-over-time granularity (Ben, 13 Oct 2026): `1 month` to `6 months`
 * (and custom periods as long) are weekly points; `1 year` and longer custom
 * periods are monthly. Six months is at most 184 days and a year at least
 * 365, so 186 keeps every preset on its unit whatever today's date.
 */
export const WEEKLY_POINTS_MAX_DAYS = 186;

/** (Hang fix, 27 Oct) Loop bounds above any real window (the longest period is 3 years: 157 weeks), a month's days plus slack, axis ticks. */
const MAX_BUCKETS = 400;
const MAX_BUCKET_DAYS = 40;
const MAX_AXIS_TICKS = 20;

export type ActivityGranularity = 'week' | 'month';

export function activityGranularity(days: number): ActivityGranularity {
  return days <= WEEKLY_POINTS_MAX_DAYS ? 'week' : 'month';
}

export interface SessionCounts {
  count: number;
  previousCount: number;
  /** Sessions a week, one decimal; windows of 14 days or more only. */
  perWeek: number | null;
  /** Periods up to `WEEKLY_POINTS_MAX_DAYS`: one point per Monday–Sunday week overlapping the window. The counts add up to `count`. */
  weeks: WeekCount[] | null;
  /** Longer periods: one point per calendar month overlapping the window (same rules as weeks). */
  months: MonthCount[] | null;
  /** The latest workout on or before the window's last day, for `Last workout: Fri 14 Aug`; null if none. */
  lastSessionDate: string | null;
}

/** One decimal, half up (`3.3`). */
export function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function countBy(sessions: readonly ProgressSession[], range: DateRange): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) if (inRange(s.date, range)) out.set(s.date, (out.get(s.date) ?? 0) + 1);
  return out;
}

export function countSessions(sessions: readonly ProgressSession[], window: ProgressWindow): SessionCounts {
  const byDate = countBy(sessions, window);
  const count = [...byDate.values()].reduce((a, b) => a + b, 0);
  const previousCount = [...countBy(sessions, window.previous).values()].reduce((a, b) => a + b, 0);
  let lastSessionDate: string | null = null;
  for (const s of sessions) if (s.date <= window.to && (lastSessionDate === null || s.date > lastSessionDate)) lastSessionDate = s.date;

  const totalDays = daysBetween(window.from, window.to) + 1;
  let weeks: WeekCount[] | null = null;
  let months: MonthCount[] | null = null;
  if (activityGranularity(totalDays) === 'month') {
    months = [];
    let from = window.from;
    // (Hang fix, 27 Oct) Bounded: dates that don't advance (an odd stored date) never loop without end.
    for (let guard = 0; from <= window.to && guard < MAX_BUCKETS; guard += 1) {
      const monthEnd = addDays(addMonths(`${from.slice(0, 8)}01`, 1), -1);
      const to = monthEnd < window.to ? monthEnd : window.to;
      let n = 0;
      for (let d = from, i = 0; d <= to && i < MAX_BUCKET_DAYS; d = addDays(d, 1), i += 1) n += byDate.get(d) ?? 0;
      months.push({ from, to, count: n, partial: from.slice(8, 10) !== '01' || to !== monthEnd });
      from = addDays(to, 1);
    }
  } else {
    weeks = [];
    let from = window.from;
    for (let guard = 0; from <= window.to && guard < MAX_BUCKETS; guard += 1) {
      const sunday = addDays(from, 6 - weekdayIndexOfDate(from));
      const to = sunday < window.to ? sunday : window.to;
      let n = 0;
      for (let d = from, i = 0; d <= to && i < MAX_BUCKET_DAYS; d = addDays(d, 1), i += 1) n += byDate.get(d) ?? 0;
      weeks.push({ from, to, count: n, partial: weekdayIndexOfDate(from) !== 0 || to !== sunday });
      from = addDays(to, 1);
    }
  }
  return {
    count,
    previousCount,
    perWeek: window.days >= 14 ? oneDecimal(count / (totalDays / 7)) : null,
    weeks,
    months,
    lastSessionDate,
  };
}

/** Sessions over this are left out of time until Ben confirms or edits them (PG25). */
export const PROGRESS_DURATION_CAP_MS = 4 * 60 * 60 * 1000;

export interface LeftOutSession {
  sessionId: string;
  /** The session's version, for `Count it` (stale versions are refused). */
  version: number;
  name: string | null;
  date: string;
  /** Null when there is no end time. */
  durationMs: number | null;
}

export interface TimeInGym {
  /** Sum over timed sessions in the window. 0 when none. */
  totalMs: number;
  /** Mean per timed session (O-PG3 default); null when no session was timed, so it reads `—`, never `0 min`. */
  avgMs: number | null;
  timedCount: number;
  /** Every session in the window, timed or not. */
  sessionCount: number;
  previousTotalMs: number;
  previousTimedCount: number;
  excluded: {
    /** Workouts with a date only (FitNotes): no times exist (ADR 0016). */
    imported: number;
    noEnd: LeftOutSession[];
    /** Over `PROGRESS_DURATION_CAP_MS` and not confirmed (`Count it`), newest first. */
    overCap: LeftOutSession[];
  };
}

type TimeKind = { kind: 'timed'; ms: number } | { kind: 'imported' } | { kind: 'no_end' } | { kind: 'over_cap'; ms: number };

/** How one session counts for time (PG25). A confirmed long session counts in full. */
export function sessionTimeKind(s: ProgressSession): TimeKind {
  if (s.dateOnly) return { kind: 'imported' };
  if (s.durationMs === null) return { kind: 'no_end' };
  if (s.durationMs > PROGRESS_DURATION_CAP_MS && !s.durationConfirmed) return { kind: 'over_cap', ms: s.durationMs };
  return { kind: 'timed', ms: s.durationMs };
}

export function timeInGym(sessions: readonly ProgressSession[], window: ProgressWindow): TimeInGym {
  let totalMs = 0;
  let timedCount = 0;
  let sessionCount = 0;
  let previousTotalMs = 0;
  let previousTimedCount = 0;
  let imported = 0;
  const noEnd: LeftOutSession[] = [];
  const overCap: LeftOutSession[] = [];
  const leftOut = (s: ProgressSession, durationMs: number | null): LeftOutSession => ({ sessionId: s.sessionId, version: s.version, name: s.name, date: s.date, durationMs });
  for (const s of sessions) {
    const kind = sessionTimeKind(s);
    if (inRange(s.date, window)) {
      sessionCount += 1;
      switch (kind.kind) {
        case 'timed':
          totalMs += kind.ms;
          timedCount += 1;
          break;
        case 'imported':
          imported += 1;
          break;
        case 'no_end':
          noEnd.push(leftOut(s, null));
          break;
        case 'over_cap':
          overCap.push(leftOut(s, kind.ms));
          break;
      }
    } else if (inRange(s.date, window.previous) && kind.kind === 'timed') {
      previousTotalMs += kind.ms;
      previousTimedCount += 1;
    }
  }
  const newestFirst = (a: LeftOutSession, b: LeftOutSession) => b.date.localeCompare(a.date) || a.sessionId.localeCompare(b.sessionId);
  return {
    totalMs,
    avgMs: timedCount === 0 ? null : totalMs / timedCount,
    timedCount,
    sessionCount,
    previousTotalMs,
    previousTimedCount,
    excluded: { imported, noEnd: noEnd.sort(newestFirst), overCap: overCap.sort(newestFirst) },
  };
}

/**
 * The activity chart's Y gridlines: whole session counts from 0, 1, 2, 5 or
 * 10 apart, at most four steps, the top at or above `largest` (never under 3,
 * so one session never fills the plot).
 */
export function countAxisTicks(largest: number): number[] {
  // (Hang fix, 27 Oct) A count that isn't a finite number (Infinity looped without end) draws the empty axis.
  const max = Number.isFinite(largest) ? Math.max(3, Math.ceil(largest)) : 3;
  let step = 1;
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
    step = s;
    if (Math.ceil(max / s) <= 4) break;
  }
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top && out.length <= MAX_AXIS_TICKS; v += step) out.push(v);
  return out;
}
