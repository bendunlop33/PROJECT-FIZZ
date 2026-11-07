import { describe, expect, it } from 'vitest';

import { ActivitySchema, type Activity } from '@fizz/schemas';

import {
  addActivity,
  ALL_WEEKDAYS,
  DEFAULT_MORNING_REMINDER,
  morningReminderSchedule,
  PREDICTED_REMINDER_TITLE,
  parseMorningReminder,
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
const day = (title: string, n: number | null = null, of = 4, aboutMinutes: number | null = null, legs?: boolean): ReminderSession => ({ title, planDay: n === null ? null : { n, of }, aboutMinutes, ...(legs === undefined ? {} : { legs }) });

const PLAN = [day('Push', 1, 4, 55, false), day('Pull', 2, 4, 60, false), day('Legs', 3, 4, 65, true), day('Upper', 4, 4, 50, false)];
const T = PREDICTED_REMINDER_TITLE;

function longRun(date: string, status: 'planned' | 'done' = 'planned'): Activity {
  const c = addActivity({ id: `00000000-0000-4000-8000-${date.replaceAll('-', '').padStart(12, '0')}`, ownerId: '00000000-0000-4000-8000-000000000001', fields: { kind: 'run', status, date, durationS: null, distanceM: null, effort: 'long' }, source: 'ben', opId: `run-${date}`, at: { utc: '2026-10-19T08:00:00.000Z', tz: TZ } });
  if (c.kind !== 'write') throw new Error(c.kind);
  return ActivitySchema.parse(c.next);
}

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
    // (Ben, 20 Oct) Predicted days: `Time to train`, the session leads the body.
    expect(r.map((x) => x.title)).toEqual(['Today: Pull', T, T, T, T, T, T]);
    expect(r.slice(1).map((x) => x.body.split(' · ')[0])).toEqual(['Legs is next', 'Upper is next', 'Push is next', 'Pull is next', 'Legs is next', 'Upper is next']);
    expect(r[1]?.body).toBe('Legs is next · Day 3 of 4 · about 65 min · Main gym');
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
      ['2026-10-23', T],
      ['2026-10-26', T],
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

describe('the run rule on predicted days (Ben, 20 Oct)', () => {
  it('no legs the day after or before a long run, planned or done; a rotation walks on from the one picked', () => {
    // Up next Pull (Tue); Legs would come Wed. A long run planned Thu: Wed is the day before, so Upper is picked, and
    // the rotation goes on after Upper (review ben-runs-20oct S1: Up next is the one after the last done).
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ activities: [longRun('2026-10-22')] }));
    expect(r.map((x) => [x.fireAtLocal.date, x.body.split(' · ')[0]])).toEqual([
      ['2026-10-20', 'Day 2 of 4'],
      ['2026-10-21', 'Upper is next'],
      ['2026-10-22', 'Push is next'],
      // Fri is the day after the run: Pull isn't a leg day anyway.
      ['2026-10-23', 'Pull is next'],
      ['2026-10-24', 'Legs is next'],
      ['2026-10-25', 'Upper is next'],
      ['2026-10-26', 'Push is next'],
    ]);
    // A long run planned Tue (today) counts on its date unless cancelled: Wed is the day after.
    const after = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ activities: [longRun('2026-10-20')] }));
    expect(after[1]?.body.split(' · ')[0]).toBe('Upper is next');
    // Planned for Mon (yesterday), done: today's Up next (day 1) is never moved here (Up next applies the rule).
    const done = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next: PLAN[2] ?? null, cycle: { sessions: PLAN, at: 2 }, activities: [longRun('2026-10-19', 'done')] }));
    expect(done[0]?.title).toBe('Today: Legs');
  });

  it('day 1 on a later date is a prediction too: moved and worded as one; unknown legs never move', () => {
    // 07:30: today's time has passed, so day 1 is Wed; a long run Thu makes Wed the day before.
    const r = morningReminderSchedule(toMs('2026-10-20T07:30:00.000Z'), TZ, ON, forecast({ next: PLAN[2] ?? null, cycle: { sessions: PLAN, at: 2 }, activities: [longRun('2026-10-22')] }));
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: T });
    expect(r[0]?.body.split(' · ')[0]).toBe('Upper is next');
    const unknown = [day('Push'), day('Pull'), day('Legs')];
    const u = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next: unknown[1] ?? null, cycle: { sessions: unknown, at: 1 }, activities: [longRun('2026-10-22')] }));
    expect(u[1]?.body).toBe('Legs is next · Main gym');
  });

  it('every day a leg day: legs anyway', () => {
    const legs = [day('Legs A', null, 4, null, true), day('Legs B', null, 4, null, true)];
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next: legs[0] ?? null, cycle: { sessions: legs, at: 0 }, activities: [longRun('2026-10-22')] }));
    expect(r[1]?.body).toBe('Legs B is next · Main gym');
  });
});

describe('where each reminder starts (review ben-runs-20oct)', () => {
  it('next not in the loop: Up next first, then the loop from its first', () => {
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next: day('Upper A'), cycle: { sessions: [day('Push'), day('Pull')], at: -1 } }));
    expect(r.slice(0, 4).map((x) => x.title === T ? x.body : x.title)).toEqual(['Today: Upper A', 'Push is next · Main gym', 'Pull is next · Main gym', 'Push is next · Main gym']);
  });

  it('a rotation day 1 on a later date starts where the resolver’s own order does (`from`)', () => {
    // Today the run rule passed over Legs (Up next Upper, at 3; the order starts at Legs, 2). At 07:30 day 1 is Wed,
    // with no run near Wed: Legs, worded as a prediction.
    const r = morningReminderSchedule(toMs('2026-10-20T07:30:00.000Z'), TZ, ON, forecast({ next: PLAN[3] ?? null, cycle: { sessions: PLAN, at: 3, from: 2 } }));
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: T });
    expect(r.slice(0, 3).map((x) => x.body.split(' · ')[0])).toEqual(['Legs is next', 'Upper is next', 'Push is next']);
  });

  it('a pinned leg day is never moved, on day 1 or in a rotation (B2)', () => {
    const pinned = { ...day('Legs', 3, 4, 65, true), id: 'legs', pinned: true };
    const late = toMs('2026-10-20T07:30:00.000Z');
    // A plan: day 1 Wed, a long run Thu. The service predicted Wed (`firstOn`) with the pin first.
    const plan = morningReminderSchedule(late, TZ, ON, forecast({ next: pinned, cycle: { sessions: [], at: -1 }, ahead: [PLAN[0] as ReminderSession], firstOn: pinned, activities: [longRun('2026-10-22')] }));
    expect(plan[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Today: Legs' });
    // No `firstOn` (unreadable): day 1 stays Up next, never moved.
    const unread = morningReminderSchedule(late, TZ, ON, forecast({ next: pinned, cycle: { sessions: [], at: -1 }, ahead: [], activities: [longRun('2026-10-22')] }));
    expect(unread.map((x) => x.title)).toEqual(['Today: Legs']);
    // A rotation session marked pinned isn't passed over either.
    const loop = [PLAN[0], PLAN[1], pinned, PLAN[3]] as ReminderSession[];
    const rot = morningReminderSchedule(late, TZ, ON, forecast({ next: pinned, cycle: { sessions: loop, at: 2 }, activities: [longRun('2026-10-22')] }));
    expect(rot[0]).toMatchObject({ title: 'Today: Legs' });
  });

  it('a plan: `ahead` in order, never reordered here; a later day 1 is `firstOn` (S3)', () => {
    const late = toMs('2026-10-20T07:30:00.000Z');
    const next = { ...(PLAN[2] as ReminderSession), id: 'legs' };
    const upper = { ...(PLAN[3] as ReminderSession), id: 'upper' };
    const push = { ...(PLAN[0] as ReminderSession), id: 'push' };
    // Up next Legs; Wed is the day before a long run, so the service picked Upper for Wed, then Legs on Thu.
    const r = morningReminderSchedule(late, TZ, ON, forecast({ next, ahead: [next, push], firstOn: upper, activities: [longRun('2026-10-22')] }));
    expect(r.map((x) => [x.title, x.body.split(' · ')[0]])).toEqual([
      [T, 'Upper is next'],
      [T, 'Legs is next'],
      [T, 'Push is next'],
    ]);
    // Day 1 on today: Up next exactly, whatever `firstOn` says; a short `ahead` reminds fewer days.
    expect(morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next, ahead: [push], firstOn: upper })).map((x) => x.title)).toEqual(['Today: Legs', T]);
    expect(morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ next, ahead: [], paused: true }))).toEqual([]);
  });

  it('uses the slots the forecast was predicted for (N4)', () => {
    const slots = [{ date: '2026-10-22', fireAtMs: toMs('2026-10-22T06:00:00.000Z') }];
    const r = morningReminderSchedule(TUE_6AM, TZ, ON, forecast({ slots }));
    expect(r.map((x) => x.identifier)).toEqual(['fizz.morning.2026-10-22']);
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
