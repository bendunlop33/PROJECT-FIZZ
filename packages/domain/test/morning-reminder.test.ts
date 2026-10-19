import { describe, expect, it } from 'vitest';

import {
  ALL_WEEKDAYS,
  DEFAULT_MORNING_REMINDER,
  morningReminderSchedule,
  parseMorningReminder,
  predictUpNext,
  reminderBody,
  reminderOn,
  reminderRowLine,
  toggleReminderDay,
  toMs,
  type MorningReminderSettings,
  type ReminderSession,
  type UpNextForecast,
} from '../src';

const TZ = 'Europe/London';
const ON: MorningReminderSettings = { ...DEFAULT_MORNING_REMINDER, on: true };
const day = (title: string, n: number | null = null, of = 4, aboutMinutes: number | null = null): ReminderSession => ({ title, planDay: n === null ? null : { n, of }, aboutMinutes });

const PLAN = [day('Push', 1, 4, 55), day('Pull', 2, 4, 60), day('Legs', 3, 4, 65), day('Upper', 4, 4, 50)];

function forecast(over: Partial<UpNextForecast> = {}): UpNextForecast {
  return { next: PLAN[1] ?? null, paused: false, cycle: { sessions: PLAN, at: 1 }, gymName: 'Main gym', lastStartedUtc: null, ...over };
}

// Tuesday 20 Oct 2026, 06:00 London (BST, UTC+1).
const TUE_6AM = toMs('2026-10-20T05:00:00.000Z');

describe('morningReminderSchedule', () => {
  it('Day 1 is Up next exactly; later days walk the plan forward', () => {
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast());
    expect(r).toHaveLength(7);
    expect(r[0]).toMatchObject({ identifier: 'fizz.morning.2026-10-20', fireAtLocal: { date: '2026-10-20', hour: 7, minute: 0 }, title: 'Today: Pull', body: 'Day 2 of 4 · about 60 min · Main gym' });
    expect(r[0]?.fireAtMs).toBe(toMs('2026-10-20T06:00:00.000Z'));
    expect(r.map((x) => x.title)).toEqual(['Today: Pull', 'Today: Legs', 'Today: Upper', 'Today: Push', 'Today: Pull', 'Today: Legs', 'Today: Upper']);
  });

  it('after today’s time has passed, starts tomorrow with Up next', () => {
    const r = morningReminderSchedule(toMs('2026-10-20T07:30:00.000Z'), TZ, ON, forecast());
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Today: Pull' });
    expect(r).toHaveLength(6);
  });

  it('only on the chosen days, each consuming one predicted session', () => {
    const r = morningReminderSchedule(TUE_6AM, TZ, { ...ON, days: ['mon', 'wed', 'fri'] }, forecast());
    expect(r.map((x) => [x.fireAtLocal.date, x.title])).toEqual([
      ['2026-10-21', 'Today: Pull'],
      ['2026-10-23', 'Today: Legs'],
      ['2026-10-26', 'Today: Upper'],
    ]);
  });

  it('no days chosen, or off, or never set: nothing', () => {
    expect(morningReminderSchedule(TUE_6AM, TZ, { ...ON, days: [] }, forecast())).toEqual([]);
    expect(morningReminderSchedule(TUE_6AM, TZ, { ...ON, on: false }, forecast())).toEqual([]);
    expect(morningReminderSchedule(TUE_6AM, TZ, DEFAULT_MORNING_REMINDER, forecast())).toEqual([]);
  });

  it('a workout already started today before the time: no reminder today', () => {
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ lastStartedUtc: '2026-10-20T04:30:00.000Z' }));
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Today: Pull' });
    // Yesterday's workout doesn't count.
    const y = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ lastStartedUtc: '2026-10-19T17:00:00.000Z' }));
    expect(y[0]?.fireAtLocal.date).toBe('2026-10-20');
  });

  it('paused plan or no Up next: nothing at all (no generic nagging)', () => {
    expect(morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ paused: true }))).toEqual([]);
    expect(morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next: null }))).toEqual([]);
  });

  it('time change to 06:30 moves every reminder', () => {
    const r = morningReminderSchedule(toMs('2026-10-20T05:45:00.000Z'), TZ, { ...ON, hour: 6, minute: 30 }, forecast());
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21', hour: 6, minute: 30 } });
    expect(r[0]?.fireAtMs).toBe(toMs('2026-10-21T05:30:00.000Z'));
    expect(r.every((x) => x.fireAtLocal.hour === 6 && x.fireAtLocal.minute === 30)).toBe(true);
  });

  it('DST: 07:00 local before and after the clocks go back (25 Oct 2026)', () => {
    const r = morningReminderSchedule(toMs('2026-10-23T12:00:00.000Z'), TZ, ON, forecast());
    const byDate = new Map(r.map((x) => [x.fireAtLocal.date, x.fireAtMs]));
    expect(byDate.get('2026-10-24')).toBe(toMs('2026-10-24T06:00:00.000Z'));
    expect(byDate.get('2026-10-25')).toBe(toMs('2026-10-25T07:00:00.000Z'));
    expect(byDate.get('2026-10-26')).toBe(toMs('2026-10-26T07:00:00.000Z'));
  });

  it('local dates follow the phone’s zone', () => {
    // 23:30 UTC Mon is already Tue 10:30 in Sydney: Tuesday’s 07:00 has passed there.
    const r = morningReminderSchedule(toMs('2026-10-19T23:30:00.000Z'), 'Australia/Sydney', ON, forecast());
    expect(r[0]?.fireAtLocal.date).toBe('2026-10-21');
  });

  it('unknown loop: only the exact Up next', () => {
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ cycle: { sessions: [], at: -1 } }));
    expect(r.map((x) => x.title)).toEqual(['Today: Pull']);
  });
});

describe('predictUpNext', () => {
  it('next not in the loop: the walk starts at its first', () => {
    const s = predictUpNext({ next: day('Upper A'), paused: false, cycle: { sessions: [day('Push'), day('Pull')], at: -1 } }, 4);
    expect(s.map((x) => x.title)).toEqual(['Upper A', 'Push', 'Pull', 'Push']);
  });
});

describe('copy and settings', () => {
  it('body leaves out what is unknown', () => {
    expect(reminderBody(day('Pull'), null)).toBe('');
    expect(reminderBody(day('Pull', null, 4, 45), 'Main gym')).toBe('about 45 min · Main gym');
  });

  it('on: Ben’s choice, else on only when notifications are already allowed', () => {
    expect(reminderOn({ on: null }, 'granted')).toBe(true);
    expect(reminderOn({ on: null }, 'undetermined')).toBe(false);
    expect(reminderOn({ on: false }, 'granted')).toBe(false);
    expect(reminderOn({ on: true }, 'denied')).toBe(true);
  });

  it('parses defensively', () => {
    expect(parseMorningReminder(null)).toEqual(DEFAULT_MORNING_REMINDER);
    expect(parseMorningReminder({ on: true, hour: 6, minute: 30, days: ['sun', 'mon', 'xyz'] })).toEqual({ on: true, hour: 6, minute: 30, days: ['mon', 'sun'] });
    expect(parseMorningReminder({ hour: 25, minute: -1 })).toMatchObject({ on: null, hour: 7, minute: 0, days: ALL_WEEKDAYS });
  });

  it('row line and day chips', () => {
    expect(reminderRowLine(ON, true)).toBe('07:00 · Every day');
    expect(reminderRowLine(ON, false)).toBe('Off');
    expect(reminderRowLine({ ...ON, days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, true)).toBe('07:00 · Weekdays');
    expect(reminderRowLine({ ...ON, hour: 6, minute: 30, days: ['mon', 'wed'] }, true)).toBe('06:30 · Mon, Wed');
    expect(toggleReminderDay(['mon', 'wed'], 'tue')).toEqual(['mon', 'tue', 'wed']);
    expect(toggleReminderDay(['mon', 'wed'], 'mon')).toEqual(['wed']);
  });
});
