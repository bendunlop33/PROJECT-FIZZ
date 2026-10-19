import type { Weekday } from '@fizz/schemas';

import { addDays, localDateOf, localTimeUtcMs, weekdayIndexOfDate } from './calendar';
import { toMs } from './time';

/**
 * Morning reminder (Ben, 20 Oct 2026: "Can we have a notification at say 7am
 * which can be changed on what to train each day?"). Pure: from the settings,
 * the clock, the phone's zone and an Up next forecast, the local
 * notifications to have pending for the next `REMINDER_HORIZON_DAYS` days.
 *
 * Day 1 is Up next exactly as Today shows it. Later days are a prediction:
 * Up next walked forward (`predictUpNext`) assuming each reminded session is
 * done. The app recomputes the whole list whenever anything that moves Up
 * next changes, so a wrong guess is replaced before it fires. Nothing is sent
 * with no Up next, with the plan paused, or on a day a workout was already
 * started before the reminder time (rule 6: no generic nagging, no invented
 * content).
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
   * reminded.
   */
  cycle: { sessions: readonly ReminderSession[]; at: number };
  /** The selected gym's name; null: none. */
  gymName: string | null;
  /** When the newest workout (finished or in progress) started; null: none. */
  lastStartedUtc: string | null;
}

/**
 * Up next for the next `count` reminders, assuming each one is done: `next`,
 * then the loop after it. Empty with no Up next or a paused plan.
 */
export function predictUpNext(forecast: Pick<UpNextForecast, 'next' | 'paused' | 'cycle'>, count: number): ReminderSession[] {
  if (forecast.next === null || forecast.paused || count <= 0) return [];
  const out: ReminderSession[] = [forecast.next];
  const { sessions, at } = forecast.cycle;
  if (sessions.length === 0) return out;
  for (let i = 1; out.length < count; i += 1) {
    const s = sessions[(Math.max(at, -1) + i) % sessions.length];
    if (s === undefined) break;
    out.push(s);
  }
  return out;
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

/** `Today: Pull`. */
export function reminderTitle(s: ReminderSession): string {
  return `Today: ${s.title}`;
}

/** `Day 2 of 4 · about 60 min · Main gym`, leaving out what isn't known. */
export function reminderBody(s: ReminderSession, gymName: string | null): string {
  const parts = [s.planDay === null ? null : `Day ${String(s.planDay.n)} of ${String(s.planDay.of)}`, s.aboutMinutes === null ? null : `about ${String(s.aboutMinutes)} min`, gymName];
  return parts.filter((p): p is string => p !== null && p.length > 0).join(' · ');
}

/**
 * The reminders to have pending, soonest first: one per selected day in the
 * next `REMINDER_HORIZON_DAYS` local days whose time is still ahead, skipping
 * today when a workout already started today. Off (`on` not true: resolve
 * a never-set value with `reminderOn` first), no Up next or paused: none.
 */
export function morningReminderSchedule(nowMs: number, tz: string, settings: MorningReminderSettings, forecast: UpNextForecast): PlannedReminder[] {
  if (settings.on !== true || settings.days.length === 0) return [];
  const today = localDateOf(nowMs, tz);
  const trainedToday = forecast.lastStartedUtc !== null && localDateOf(toMs(forecast.lastStartedUtc), tz) === today && toMs(forecast.lastStartedUtc) <= nowMs;
  const slots: { date: string; fireAtMs: number }[] = [];
  for (let d = 0; d < REMINDER_HORIZON_DAYS; d += 1) {
    const date = addDays(today, d);
    const weekday = ALL_WEEKDAYS[weekdayIndexOfDate(date)];
    if (weekday === undefined || !settings.days.includes(weekday)) continue;
    if (d === 0 && trainedToday) continue;
    const fireAtMs = localTimeUtcMs(date, settings.hour, settings.minute, tz);
    if (fireAtMs <= nowMs) continue;
    slots.push({ date, fireAtMs });
  }
  const sessions = predictUpNext(forecast, slots.length);
  return slots.slice(0, sessions.length).map((slot, i) => {
    const s = sessions[i] as ReminderSession;
    return {
      identifier: `${MORNING_REMINDER_PREFIX}${slot.date}`,
      fireAtLocal: { date: slot.date, hour: settings.hour, minute: settings.minute },
      fireAtMs: slot.fireAtMs,
      title: reminderTitle(s),
      body: reminderBody(s, forecast.gymName),
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
