import { describe, expect, it } from 'vitest';

import { weekScheduleLines, type WeekScheduleDay } from '../src';

/**
 * (Ben, 11 Nov, build 564) "Why did you give me pull on Tuesday?": the coach answered "I can't verify why it was
 * originally placed there". The week's schedule is the app's own rules; the coach reads it as one line a day.
 */

const MON = '2026-11-09';
const day = (d: Partial<WeekScheduleDay> & { name: string }): WeekScheduleDay => ({ own: null, movedTo: null, slot: null, doneOn: null, skipped: false, missed: false, lastTrained: null, ...d });

describe('weekScheduleLines', () => {
  it('Set days, Wed 11 Nov: Push A done Mon, Pull A scheduled Tue and missed (Garmin strength that day), Legs A moved by Ben, Arms Up next', () => {
    const lines = weekScheduleLines({
      mode: 'set',
      monday: MON,
      today: 2,
      doneToday: false,
      upNext: 'Arms',
      pinned: false,
      days: [
        day({ name: 'Push A', own: 0, slot: 0, doneOn: 0, lastTrained: '2026-11-09' }),
        day({ name: 'Pull A', own: 1, slot: 1, missed: true, lastTrained: '2026-11-06', health: 'Strength 47 min (Garmin)' }),
        day({ name: 'Legs A', own: 3, movedTo: 5, slot: 5, lastTrained: '2026-11-04' }),
        day({ name: 'Arms', own: 4, slot: 2, lastTrained: '2026-11-05' }),
      ],
    });
    expect(lines).toEqual([
      'Push A: done Mon 9 Nov',
      'Pull A: scheduled Tue 10 Nov · missed: nothing logged that day and no free plan day left this week; Health has Strength 47 min (Garmin) that day, not logged in the app: offer Today › Log a past workout',
      'Legs A: moved by Ben from Thu to Sat 14 Nov',
      'Arms: Wed 11 Nov: Up next (scheduled Fri)',
      "Today's card: Up next = Arms: the day not done this week whose type was trained longest ago, schedule breaks ties (last trained: Pull A 6 Nov, Arms 5 Nov); Legs A moved later by Ben, so after the others.",
    ]);
  });

  it('a day displaced by what Ben did, a skipped day, a day done on another weekday; a pin', () => {
    const lines = weekScheduleLines({
      mode: 'set',
      monday: MON,
      today: 1,
      doneToday: true,
      upNext: 'Legs',
      pinned: true,
      days: [
        day({ name: 'Pull', own: 0, slot: 1, doneOn: 1 }),
        day({ name: 'Push', own: 1, slot: 3 }),
        day({ name: 'Legs', own: 2, slot: 2 }),
        day({ name: 'Upper', own: 4, slot: 4, skipped: true }),
      ],
    });
    expect(lines).toEqual(['Pull: done Tue 10 Nov (scheduled Mon)', 'Push: Thu 12 Nov, moved from Tue: Ben did Pull on Tue', 'Legs: scheduled Wed 11 Nov · Up next', 'Upper: skipped this week by Ben', "Today's card: Up next = Legs, picked by Ben (Make next)."]);
  });

  it('a passed day not done yet still placed (not missed) says so; no Health note on a future day', () => {
    const lines = weekScheduleLines({
      mode: 'set',
      monday: MON,
      today: 3,
      doneToday: false,
      upNext: 'A',
      pinned: false,
      days: [day({ name: 'A', own: 1, slot: 1, health: 'Strength 40 min (Garmin)' }), day({ name: 'B', own: 5, slot: 5, health: 'x' })],
    });
    expect(lines[0]).toBe('A: scheduled Tue 10 Nov · not done · Up next; Health has Strength 40 min (Garmin) that day, not logged in the app: offer Today › Log a past workout');
    expect(lines[1]).toBe('B: scheduled Sat 14 Nov');
  });

  it('Any days: no dates; Up next by last trained, plan order breaks ties; trained today plans from tomorrow', () => {
    const lines = weekScheduleLines({
      mode: 'any',
      monday: MON,
      today: 2,
      doneToday: true,
      upNext: 'Lower',
      pinned: false,
      days: [day({ name: 'Upper', doneOn: 2, lastTrained: '2026-11-11' }), day({ name: 'Lower', lastTrained: null }), day({ name: 'Full', lastTrained: '2026-11-06' })],
    });
    expect(lines).toEqual([
      'Upper: done Wed 11 Nov',
      'Lower: to do (Any days: no dates), Up next',
      'Full: to do (Any days: no dates)',
      "Today's card: Up next = Lower (trained today, so from tomorrow): the day not done this week whose type was trained longest ago, plan order breaks ties (last trained: Lower not recently, Full 6 Nov).",
    ]);
  });
});
