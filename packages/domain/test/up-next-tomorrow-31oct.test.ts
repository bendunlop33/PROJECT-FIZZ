import { describe, expect, it } from 'vitest';
import { aheadDates, buildWeekTiles, finishedGymWorkoutOn, setDaysUpNextOrder, upNextPlanningWeekday } from '../src/index';

/**
 * (Ben, 31 Oct: "Yes") Once a gym workout is finished today, Up next plans from tomorrow. Ben's Set days week: Mon Push
 * A, Tue Pull A, Wed Legs, Thu Push B, Fri Pull B, Sat Legs B.
 */
describe('Up next plans from tomorrow after a finished workout (Ben, 31 Oct)', () => {
  const wd: Record<string, number> = { pushA: 0, pullA: 1, legs: 2, pushB: 3, pullB: 4, legsB: 5 };
  // Least recently trained first (D19's order), as the caller passes it.
  const order = ['pushB', 'pullB', 'legs', 'pullA', 'pushA', 'legsB'];
  const run = (today: number, done: string[], finishedToday: boolean) => setDaysUpNextOrder(order, { weekdayOf: (t) => wd[t] ?? null, done: (t) => done.includes(t), today, finishedToday });
  const weekDone = ['legs', 'pullA', 'pushA', 'legsB'];

  it('Fri before training: today’s scheduled day (Pull B)', () => {
    expect(run(4, weekDone, false)[0]).toBe('pullB');
  });
  it('Fri after Legs B: Saturday’s Legs B is done, so the earliest missed day up to today (Push B Thu), then Pull B', () => {
    expect(run(4, weekDone, true).slice(0, 2)).toEqual(['pushB', 'pullB']);
  });
  it('tomorrow’s scheduled day first when it isn’t done', () => {
    // Wed after Legs: Thursday’s Push B, not Mon’s missed Push A.
    expect(run(2, ['legs'], true)).toEqual(['pushB', 'pushA', 'pullA', 'pullB', 'legsB', 'legs']);
  });
  it('the next scheduled day when tomorrow is done and nothing was missed', () => {
    // Mon after Push A, Pull A already done early: Wed’s Legs.
    expect(run(0, ['pushA', 'pullA'], true)[0]).toBe('legs');
  });
  it('every day done: least recently trained (D19)', () => {
    expect(run(5, order, true)).toEqual(order);
  });
  it('Sunday after a workout: every day not done is a missed one, earliest first', () => {
    expect(upNextPlanningWeekday(6, true)).toBe(7);
    expect(run(6, ['pushA', 'pullA', 'legs', 'legsB'], true).slice(0, 2)).toEqual(['pushB', 'pullB']);
  });
  it('no finished workout today (absent flag): today’s order, unchanged', () => {
    expect(setDaysUpNextOrder(order, { weekdayOf: (t) => wd[t] ?? null, done: (t) => weekDone.includes(t), today: 4 })[0]).toBe('pullB');
    expect(upNextPlanningWeekday(4, false)).toBe(4);
  });
});

describe('finishedGymWorkoutOn (Ben, 31 Oct)', () => {
  const tz = 'Europe/London';
  it('a workout finished today counts; an open one does not', () => {
    expect(finishedGymWorkoutOn([{ startedAtUtc: '2026-10-30T17:00:00.000Z', endedAtUtc: '2026-10-30T18:00:00.000Z' }], '2026-10-30', tz)).toBe(true);
    expect(finishedGymWorkoutOn([{ startedAtUtc: '2026-10-30T17:00:00.000Z', endedAtUtc: null }], '2026-10-30', tz)).toBe(false);
  });
  it('by the local date it started: one from last night (local) is yesterday’s', () => {
    // 23:30 Thu in London (GMT after 25 Oct), finished after midnight.
    expect(finishedGymWorkoutOn([{ startedAtUtc: '2026-10-29T23:30:00.000Z', endedAtUtc: '2026-10-30T00:20:00.000Z' }], '2026-10-30', tz)).toBe(false);
    expect(finishedGymWorkoutOn([], '2026-10-30', tz)).toBe(false);
  });
});

describe('Tiles after a finished workout today (Ben, 31 Oct)', () => {
  const today = '2026-10-28';
  const done = [{ sessionId: 's', localDate: today, title: 'Push', dayName: 'Push' }];
  it('today’s tile has no planned ring once he has trained, unless he picks another session', () => {
    const t = buildWeekTiles({ today, workouts: done, activities: [], chosen: 'Pull' });
    expect(t[2]?.marks.map((m) => m.shape)).toEqual(['dot']);
    const picked = buildWeekTiles({ today, workouts: done, activities: [], chosen: 'Pull', chosenPicked: true });
    expect(picked[2]?.marks.map((m) => `${m.shape}:${String(m.planned)}`)).toEqual(['dot:false', 'ring:true']);
  });
  it('an activity today is not a workout: today’s day is still ringed', () => {
    const t = buildWeekTiles({ today, workouts: [], activities: [{ activityId: 'r', localDate: today, kind: 'run', status: 'done', distanceM: 5000, durationS: 1500, effort: null }], chosen: 'Push' });
    expect(t[2]?.marks.some((m) => m.shape === 'ring' && m.colour === 'push')).toBe(true);
  });
  it('Any days: Up next leads the days left from tomorrow, today gets none', () => {
    const t = buildWeekTiles({ today, workouts: done, activities: [], ahead: ['Pull', 'Legs', 'Upper'], chosen: null, upNext: 'Legs' });
    expect(t.slice(2, 6).map((x) => `${x.date.slice(8)} ${x.items.map((i) => i.text).join(',')}`)).toEqual(['28 Push', '29 Legs', '30 Pull', '31 Upper']);
  });
  it('Up next is only moved after a workout today; before it, plan order', () => {
    const t = buildWeekTiles({ today, workouts: [], activities: [], ahead: ['Pull', 'Legs', 'Upper'], chosen: 'Legs', upNext: 'Legs' });
    expect(t.slice(2, 5).map((x) => x.items.map((i) => i.text).join(','))).toEqual(['Legs', 'Pull', 'Upper']);
    expect(aheadDates(today, ['Pull', 'Legs'], null, 'Legs').map((d) => d.name)).toEqual(['Legs', 'Pull']);
  });
});
