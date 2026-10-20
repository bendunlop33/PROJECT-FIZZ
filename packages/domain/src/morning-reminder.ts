import type { Activity, Weekday } from '@fizz/schemas';

import { legRunNear } from './activity';

import { addDays, localDateOf, localTimeUtcMs, weekdayIndexOfDate } from './calendar';
import { toMs } from './time';

/**
 * Morning reminder (Ben, 20 Oct 2026: "Can we have a notification at say 7am
 * which can be changed on what to train each day?"). Pure: from the settings,
 * the clock, the phone's zone and an Up next forecast, the local
 * notifications to have pending for the next `REMINDER_HORIZON_DAYS` days.
 *
 * Day 1 on today is Up next exactly as Today shows it (`Today: Pull`). Later
 * days are a prediction, worded as one (`Time to train` · `Pull is next`, Ben
 * 20 Oct), made the way Up next itself would pick on that date:
 *
 * - a plan: the service runs the plan's adaptive rule for the reminder dates
 *   (`planDaysAhead` with the run rule per date; `firstOn` for a day 1 that
 *   falls on a later date), so nothing is reordered here;
 * - a rotation (`cycle`): the one after the last picked, and on a day after
 *   or before a long or hard run (planned or done, `legRunNear`) the first
 *   after it that isn't a leg day, as `rotationOrder` + `avoidLegDays` do; the
 *   walk then continues after the session actually picked (review
 *   ben-runs-20oct S1).
 *
 * A pinned session (`Make next`) is never moved (review ben-runs-20oct B2).
 * The app recomputes the whole list whenever anything that moves Up next
 * changes, so a wrong guess is replaced before it fires. Nothing is sent with
 * no Up next, with the plan paused, or on a day a workout was already started
 * before the reminder time (rule 6: no generic nagging, no invented content).
 */

export const REMINDER_HORIZON_DAYS = 7;

export const ALL_WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface MorningReminderSettings {
  /** Null: never set; on once notifications are allowed (`reminderOn`). */
  on: boolean | null;
  hour: number;
  minute: number;
  /** Days it is sent, Monday first. */
  days: readonly Weekday[];
}

export const DEFAULT_MORNING_REMINDER: MorningReminderSettings = { on: null, hour: 7, minute: 0, days: ALL_WEEKDAYS };

/** Whether the reminder is on: Ben's choice, else on when notifications are already allowed (never asks by itself). */
export function reminderOn(settings: Pick<MorningReminderSettings, 'on'>, permission: 'granted' | 'denied' | 'undetermined' | 'unknown'): boolean {
  return settings.on ?? permission === 'granted';
}

/** Anything unreadable falls back to the default, field by field. */
export function parseMorningReminder(raw: unknown): MorningReminderSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_MORNING_REMINDER;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, max: number, dflt: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : dflt);
  const days = Array.isArray(r.days) ? ALL_WEEKDAYS.filter((d) => (r.days as unknown[]).includes(d)) : ALL_WEEKDAYS;
  return {
    on: typeof r.on === 'boolean' ? r.on : null,
    hour: int(r.hour, 23, DEFAULT_MORNING_REMINDER.hour),
    minute: int(r.minute, 59, DEFAULT_MORNING_REMINDER.minute),
    days,
  };
}

/** One session as a reminder names it. */
export interface ReminderSession {
  /** `Pull`. */
  title: string;
  /** `Day 2 of 4` of the plan in use; null: not a plan day. */
  planDay: { n: number; of: number } | null;
  /** `about 60 min` (an estimate); null: unknown. */
  aboutMinutes: number | null;
  /** A leg day (the run rule); absent: unknown, never moved. */
  legs?: boolean;
  /** The workout's ID (telling a predicted day 1 from Up next); absent: compared by title. */
  id?: string;
  /** Pinned with `Make next`: Up next keeps it first, so the run rule never moves it. */
  pinned?: boolean;
}

/** Up next now and what it walks through next, read from the same resolver Today uses. */
export interface UpNextForecast {
  /** Up next as Today shows it; null: none. */
  next: ReminderSession | null;
  /** The plan Up next walks is paused: nothing is sent. */
  paused: boolean;
  /**
   * What Up next moves through, in order, as a loop (the plan's days, the
   * rotation, or the split's days); `at`: where `next` is in it (-1: not in
   * it, so the walk starts at the first). Empty: unknown, so only `next` is
   * reminded. `from`: where the resolver's own order starts (the one after
   * the last workout done) when that differs from `at` (the run rule moved
   * today's pick); a day 1 on a later date starts there. Absent: `at`.
   */
  cycle: { sessions: readonly ReminderSession[]; at: number; from?: number };
  /**
   * With a plan in use (plan-adapt, Ben 20 Oct): the sessions after `next`,
   * in order, from the adaptive rule assuming each is done
   * (`planDaysAhead`, the run rule applied for each reminder date); used
   * instead of `cycle`, in order, never reordered. Absent or null: walk
   * `cycle`.
   */
  ahead?: readonly ReminderSession[] | null;
  /**
   * With a plan and the first reminder on a later date (today's time has
   * passed): Up next as the plan's rule picks it on that date (the run rule
   * for that date, a pin first; review ben-runs-20oct S3). `ahead` then
   * follows it. Absent or null: `next`, never moved.
   */
  firstOn?: ReminderSession | null;
  /** The reminder slots this forecast was predicted for (review N4); absent: computed by the schedule. */
  slots?: readonly ReminderSlot[];
  /** The selected gym's name; null: none. */
  gymName: string | null;
  /** When the newest workout (finished or in progress) started; null: none. */
  lastStartedUtc: string | null;
  /** Live activities around the reminded days (the run rule, `legRunNear`); absent: none read. */
  activities?: readonly Activity[];
}

export interface PlannedReminder {
  /** Stable per local date: rescheduling replaces it. */
  identifier: string;
  /** Local wall-clock time it fires at; the phone follows its own zone (and DST) for it. */
  fireAtLocal: { date: string; hour: number; minute: number };
  /** The same instant in the zone it was planned in (ordering, tests). */
  fireAtMs: number;
  title: string;
  body: string;
}

/** Every morning reminder's identifier starts with this; nothing else is scheduled under it. */
export const MORNING_REMINDER_PREFIX = 'fizz.morning.';

/** `Today: Pull`: day 1, Up next as Today shows it. */
export function reminderTitle(s: ReminderSession): string {
  return `Today: ${s.title}`;
}

/** A predicted day's title (Ben, 20 Oct): neutral, the session is in the body. */
export const PREDICTED_REMINDER_TITLE = 'Time to train';

/**
 * `Day 2 of 4 · about 60 min · Main gym`, leaving out what isn't known; a
 * predicted day leads with `Pull is next`.
 */
export function reminderBody(s: ReminderSession, gymName: string | null, predicted = false): string {
  const parts = [predicted ? `${s.title} is next` : null, s.planDay === null ? null : `Day ${String(s.planDay.n)} of ${String(s.planDay.of)}`, s.aboutMinutes === null ? null : `about ${String(s.aboutMinutes)} min`, gymName];
  return parts.filter((p): p is string => p !== null && p.length > 0).join(' · ');
}

export interface ReminderSlot {
  /** Local date it fires on. */
  date: string;
  fireAtMs: number;
}

/**
 * The days a reminder is due, soonest first: each selected day in the next
 * `REMINDER_HORIZON_DAYS` local days whose time is still ahead, skipping
 * today when a workout already started today. The forecast reads the same
 * list (the plan's days ahead are predicted for these dates).
 */
export function reminderSlots(nowMs: number, tz: string, settings: Pick<MorningReminderSettings, 'hour' | 'minute' | 'days'>, lastStartedUtc: string | null): ReminderSlot[] {
  const today = localDateOf(nowMs, tz);
  const trainedToday = lastStartedUtc !== null && localDateOf(toMs(lastStartedUtc), tz) === today && toMs(lastStartedUtc) <= nowMs;
  const slots: ReminderSlot[] = [];
  for (let d = 0; d < REMINDER_HORIZON_DAYS; d += 1) {
    const date = addDays(today, d);
    const weekday = ALL_WEEKDAYS[weekdayIndexOfDate(date)];
    if (weekday === undefined || !settings.days.includes(weekday)) continue;
    if (d === 0 && trainedToday) continue;
    const fireAtMs = localTimeUtcMs(date, settings.hour, settings.minute, tz);
    if (fireAtMs <= nowMs) continue;
    slots.push({ date, fireAtMs });
  }
  return slots;
}

const same = (a: ReminderSession, b: ReminderSession): boolean => (a.id !== undefined && b.id !== undefined ? a.id === b.id : a.title === b.title);

/**
 * The session for each slot, soonest first (`firm`: Up next exactly, worded
 * `Today: X`). See the module note for how a plan and a rotation are walked.
 * Empty with no Up next or a paused plan.
 */
export function placeReminderSessions(forecast: Pick<UpNextForecast, 'next' | 'paused' | 'cycle' | 'ahead' | 'firstOn' | 'activities'>, slots: readonly ReminderSlot[], today: string): { session: ReminderSession; firm: boolean }[] {
  const next = forecast.next;
  const first = slots[0];
  if (next === null || forecast.paused || first === undefined) return [];
  const onToday = first.date === today;
  if (forecast.ahead != null) {
    const day1 = onToday ? next : (forecast.firstOn ?? next);
    return [day1, ...forecast.ahead].slice(0, slots.length).map((session, i) => ({ session, firm: i === 0 && same(session, next) }));
  }
  const { sessions, at } = forecast.cycle;
  if (sessions.length === 0) return [{ session: next, firm: true }];
  const acts = forecast.activities ?? [];
  const n = sessions.length;
  // The run rule as Up next applies it to a rotation: from `start`, the first that isn't a leg day while a run is near.
  const pickFrom = (start: number, date: string): number => {
    const s0 = sessions[start % n] as ReminderSession;
    if (s0.pinned === true || s0.legs !== true || legRunNear(acts, date) === null) return start % n;
    for (let k = 1; k < n; k += 1) if ((sessions[(start + k) % n] as ReminderSession).legs !== true) return (start + k) % n;
    return start % n;
  };
  const out: { session: ReminderSession; firm: boolean }[] = [];
  let pos: number;
  if (onToday || at < 0) {
    // Up next as Today shows it; one not in the loop is never moved, and the walk starts at the loop's first.
    out.push({ session: next, firm: true });
    pos = at;
  } else {
    pos = pickFrom(forecast.cycle.from ?? at, first.date);
    const s = sessions[pos] as ReminderSession;
    out.push({ session: s, firm: same(s, next) });
  }
  for (let i = 1; i < slots.length; i += 1) {
    pos = pickFrom(pos + 1, (slots[i] as ReminderSlot).date);
    out.push({ session: sessions[pos] as ReminderSession, firm: false });
  }
  return out;
}

/**
 * The reminders to have pending, soonest first: one per slot
 * (`reminderSlots`) while a session is predicted for it. Off (`on` not true:
 * resolve a never-set value with `reminderOn` first), no Up next or paused:
 * none.
 */
export function morningReminderSchedule(nowMs: number, tz: string, settings: MorningReminderSettings, forecast: UpNextForecast): PlannedReminder[] {
  if (settings.on !== true || settings.days.length === 0) return [];
  const slots = forecast.slots ?? reminderSlots(nowMs, tz, settings, forecast.lastStartedUtc);
  const placed = placeReminderSessions(forecast, slots, localDateOf(nowMs, tz));
  return placed.map(({ session: s, firm }, i) => {
    const slot = slots[i] as ReminderSlot;
    return {
      identifier: `${MORNING_REMINDER_PREFIX}${slot.date}`,
      fireAtLocal: { date: slot.date, hour: settings.hour, minute: settings.minute },
      fireAtMs: slot.fireAtMs,
      title: firm ? reminderTitle(s) : PREDICTED_REMINDER_TITLE,
      body: reminderBody(s, forecast.gymName, !firm),
    };
  });
}

/** `07:00`. */
export function reminderTimeText(s: Pick<MorningReminderSettings, 'hour' | 'minute'>): string {
  return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
}

const DAY_SHORT: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function weekdayShort(d: Weekday): string {
  return DAY_SHORT[d];
}

const DAY_LONG: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** `Monday`: a day chip's VoiceOver label (review N1). */
export function weekdayLong(d: Weekday): string {
  return DAY_LONG[d];
}

/** Profile's row: `07:00 · Every day`, `06:30 · Mon, Wed, Fri`, `Weekdays`, or `Off`. */
export function reminderRowLine(settings: MorningReminderSettings, on: boolean): string {
  if (!on) return 'Off';
  const days = ALL_WEEKDAYS.filter((d) => settings.days.includes(d));
  const which =
    days.length === 7 ? 'Every day' : days.length === 0 ? 'No days' : days.length === 5 && !days.includes('sat') && !days.includes('sun') ? 'Weekdays' : days.length === 2 && days.includes('sat') && days.includes('sun') ? 'Weekends' : days.map(weekdayShort).join(', ');
  return `${reminderTimeText(settings)} · ${which}`;
}

/** Toggle one day chip, keeping Monday-first order. */
export function toggleReminderDay(days: readonly Weekday[], day: Weekday): Weekday[] {
  const has = days.includes(day);
  return ALL_WEEKDAYS.filter((d) => (d === day ? !has : days.includes(d)));
}
