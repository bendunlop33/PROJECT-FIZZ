import { describe, expect, it } from 'vitest';
import { aheadDates, buildWeekTiles, finishedGymWorkoutOn, setDaysTieRank, setDaysWeekSlots, upNextOrder, upNextPlanningWeekday } from '../src/index';

/**
 * (Ben, 31 Oct) Up next = the least recently trained type among the plan days left this week; the schedule breaks
 * ties; from tomorrow once he has trained today. Ben's Set days week: Mon Push A, Tue Pull A, Wed Legs, Thu Push B,
 * Fri Pull B, Sat Legs B. Done: Legs Mon 26, Pull A Tue 27, Push A Wed 28, Legs B Fri 30.
 */
const WD: Record<string, number> = { pushA: 0, pullA: 1, legs: 2, pushB: 3, pullB: 4, legsB: 5 };
const KEYS = ['pushA', 'pullA', 'legs', 'pushB', 'pullB', 'legsB'];
const TYPE: Record<string, string> = { pushA: 'push', pushB: 'push', pullA: 'pull', pullB: 'pull', legs: 'legs', legsB: 'legs' };

/** `last`: each type's last-trained date; `done`/`skipped`: keys; `p`: the planning weekday. */
function order(last: Record<string, string>, done: string[], p: number, skipped: string[] = [], weekday: (k: string) => number | null = (k) => WD[k] ?? null) {
  return upNextOrder(KEYS, (k) => ({ lastTrained: last[TYPE[k] ?? ''] ?? null, state: skipped.includes(k) ? 'skipped' : done.includes(k) ? 'done' : 'open', tie: setDaysTieRank(weekday(k), p) }));
}

describe('Up next: least recently trained of the days left this week (Ben, 31 Oct)', () => {
  const sat = { legs: '2026-10-30', pull: '2026-10-27', push: '2026-10-28' };
  const weekDone = ['legs', 'pullA', 'pushA', 'legsB'];
  it('Ben’s Sat 31: Pull B (pull last Tue) before Push B (push last Wed), whatever the schedule says', () => {
    expect(order(sat, weekDone, upNextPlanningWeekday(5, false)).slice(0, 2)).toEqual(['pullB', 'pushB']);
  });
  it('Fri 30 before training: Legs B (legs last Mon); after Legs B: Pull B', () => {
    const fri = { legs: '2026-10-26', pull: '2026-10-27', push: '2026-10-28' };
    expect(order(fri, ['legs', 'pullA', 'pushA'], upNextPlanningWeekday(4, false))[0]).toBe('legsB');
    expect(order(sat, weekDone, upNextPlanningWeekday(4, true))[0]).toBe('pullB');
  });
  it('ties (never trained, or the same date): the planning day’s own day first, then the earliest scheduled', () => {
    expect(order({}, [], 3)).toEqual(['pushB', 'pushA', 'pullA', 'legs', 'pullB', 'legsB']);
    const same = { push: '2026-10-28', pull: '2026-10-28', legs: '2026-10-28' };
    expect(order(same, ['pushA'], 4)[0]).toBe('pullB');
    // Trained today (Thu): Friday plans first.
    expect(order({}, [], upNextPlanningWeekday(3, true))[0]).toBe('pullB');
  });
  it('Any days: plan order breaks ties', () => {
    expect(upNextOrder(['a', 'b', 'c'], (k) => ({ lastTrained: null, state: 'open', tie: ['a', 'b', 'c'].indexOf(k) }))).toEqual(['a', 'b', 'c']);
  });
  it('every day done: least recently trained overall; a skipped day only after those', () => {
    const all = order({ legs: '2026-10-30', pull: '2026-10-27', push: '2026-10-28' }, KEYS.filter((k) => k !== 'pushB'), 6, ['pushB']);
    expect(all.slice(0, 2)).toEqual(['pullA', 'pullB']);
    expect(all.at(-1)).toBe('pushB');
  });
  it('the planning weekday: tomorrow once trained today; Sunday after a workout is past the week', () => {
    expect(upNextPlanningWeekday(4, true)).toBe(5);
    expect(upNextPlanningWeekday(6, true)).toBe(7);
    expect(upNextPlanningWeekday(4, false)).toBe(4);
  });
});

describe('This week’s Set days slots: what he did, then Up next on the planning day (Ben, 31 Oct)', () => {
  const day = (key: string, weekday: number | null, doneOn: number | null = null) => ({ key, weekday, doneOn });
  const names = (m: Map<string, number | null>) => Object.fromEntries([...m].map(([k, v]) => [k, v]));
  it('Ben’s week: Push B moved to Fri (Pull B to Thu), Legs B done Fri: Fri is Legs B’s, Push B takes Sat (Legs B’s own slot)', () => {
    const days = [day('pushA', 0, 0), day('pullA', 1, 1), day('legs', 2, 0), day('pushB', 4), day('pullB', 3), day('legsB', 5, 4)];
    // The ties' view (no Up next) on Sat morning.
    expect(names(setDaysWeekSlots({ days, planningDay: 5 }))).toMatchObject({ legsB: 4, pushB: 5, pullB: 3 });
    // Up next Pull B (missed Thu) is Saturday’s; Push B goes to the next free day, Sunday.
    expect(names(setDaysWeekSlots({ days, planningDay: 5, upNext: 'pullB' }))).toMatchObject({ legsB: 4, pullB: 5, pushB: 6 });
  });
  it('the displaced day’s own slot passed and no free day left: none (genuinely missed)', () => {
    const days = [day('a', 0), day('b', 1, 0), day('c', 2), day('d', 3), day('e', 4), day('f', 5), day('g', 6)];
    // b done Mon on a’s slot; b’s own Tue has passed (today Wed) and Wed–Sun are all held.
    expect(setDaysWeekSlots({ days, planningDay: 2 }).get('a')).toBeNull();
  });
  it('the displaced day takes the done day’s own slot when still ahead', () => {
    const days = [day('push', 0), day('pull', 2), day('legs', 4, 0)];
    expect(names(setDaysWeekSlots({ days, planningDay: 1 }))).toEqual({ push: 4, pull: 2, legs: 0 });
  });
  it('a planning day with no plan day keeps its rest day unless Up next’s own day has passed', () => {
    const days = [day('push', 0, 0), day('pull', 3), day('legs', 1)];
    // Wed (rest), Up next Pull (Thu, ahead): rest day stays. Up next Legs (Tue, passed): on Wed.
    expect(setDaysWeekSlots({ days, planningDay: 2, upNext: 'pull' }).get('pull')).toBe(3);
    expect(setDaysWeekSlots({ days, planningDay: 2, upNext: 'legs' }).get('legs')).toBe(2);
  });
  it('Up next already on the planning day, skipped days and undated days: unchanged', () => {
    const days = [day('a', 2), { ...day('b', 3), skipped: true }, day('c', null)];
    expect(names(setDaysWeekSlots({ days, planningDay: 2, upNext: 'a' }))).toEqual({ a: 2, b: 3, c: null });
  });
  it('Sunday after a workout (planning day 7): only what he did moves anything', () => {
    const days = [day('a', 5), day('b', 6, 5)];
    expect(names(setDaysWeekSlots({ days, planningDay: 7, upNext: 'a' }))).toEqual({ a: null, b: 5 });
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
