import { describe, expect, it } from 'vitest';

import { behindBuiltInDay, behindCoverageGaps, behindLine, behindOfferShown, behindPick, buildWeekTiles, setDaysWeekSlots, weekBehind, type BehindDay, type BehindOfferGate } from '../src/index';

/**
 * (Ben, 8 Nov: MS1–MS9, docs/training-guides/missed-sessions.md §3) Ben's week: a five-day Set days plan, Mon Push A,
 * Tue Pull A, Wed Upper B, Thu Legs B, Sat Legs A. Push A done Monday; Pull A and Upper B missed; today is Thursday.
 */

const GROUP: Record<string, string> = {
  bench: 'Chest', incline: 'Chest', ohp: 'Shoulders', lateral: 'Shoulders', pushdown: 'Triceps',
  row: 'Back', pulldown: 'Back', cableRow: 'Back', facePull: 'Rear delts', pullUp: 'Back', curl: 'Biceps',
  dbBench: 'Chest', deadlift: 'Hamstrings', legPress: 'Quads', legCurl: 'Hamstrings', calf: 'Calves', legRaise: 'Core',
  squat: 'Quads', rdl: 'Hamstrings', lunge: 'Glutes',
};
const groupOf = (id: string): string | null => GROUP[id] ?? null;
const day = (key: string, mains: string[], slots: [string, number][]): BehindDay => ({ key, name: key, mainLiftIds: mains, slots: slots.map(([exerciseId, sets]) => ({ exerciseId, sets })) });
const pullA = day('Pull A', ['row'], [['row', 3], ['pulldown', 3], ['cableRow', 2], ['facePull', 2], ['curl', 3]]);
const upperB = day('Upper B', ['ohp'], [['ohp', 3], ['pullUp', 3], ['dbBench', 3], ['cableRow', 3], ['lateral', 2], ['curl', 2], ['pushdown', 2]]);
const legsB = day('Legs B', ['deadlift'], [['deadlift', 3], ['legPress', 3], ['legCurl', 3], ['calf', 3], ['legRaise', 3]]);
const legsA = day('Legs A', ['squat'], [['squat', 3], ['rdl', 3], ['lunge', 3], ['calf', 3]]);
const pushA = day('Push A', ['bench'], [['bench', 3], ['incline', 3], ['ohp', 0], ['lateral', 3], ['pushdown', 3]]);

const WEEKDAY: Record<string, number> = { 'Push A': 0, 'Pull A': 1, 'Upper B': 2, 'Legs B': 3, 'Legs A': 5 };
const THU = 3;
function slotsOf(upNext: string | null) {
  return setDaysWeekSlots({ days: Object.entries(WEEKDAY).map(([key, wd]) => ({ key, weekday: wd, doneOn: key === 'Push A' ? 0 : null })), planningDay: THU, upNext });
}
const notDone = ['Pull A', 'Upper B', 'Legs B', 'Legs A'];

describe('MS1 weekBehind', () => {
  it('Set days, Ben’s Thursday: 4 not done, slots Thu and Sat → 2 behind; Legs B no longer goes onto Friday (a rest day)', () => {
    const placed = slotsOf('Pull A');
    expect(placed.get('Pull A')).toBe(3);
    expect(placed.get('Legs B')).toBeNull();
    const b = weekBehind({ notDone, schedule: { mode: 'set', planningDay: THU, planWeekdays: Object.values(WEEKDAY), placed } });
    expect(b).toMatchObject({ mode: 'set', k: 2, slots: 2, fitting: ['Pull A', 'Legs A'], overflow: ['Upper B', 'Legs B'] });
    expect(behindLine(b.k)).toBe('2 days behind');
    expect(behindLine(1)).toBe('1 day behind');
  });

  it('Set days without an Up next on today: Legs B keeps Thursday; still 2 behind', () => {
    const b = weekBehind({ notDone, schedule: { mode: 'set', planningDay: THU, planWeekdays: Object.values(WEEKDAY), placed: slotsOf(null) } });
    expect(b).toMatchObject({ k: 2, fitting: ['Legs B', 'Legs A'] });
  });

  it('a rest day the reflow borrows for Up next is not a slot (Friday, Up next Pull A)', () => {
    const placed = setDaysWeekSlots({ days: Object.entries(WEEKDAY).map(([key, wd]) => ({ key, weekday: wd, doneOn: key === 'Push A' ? 0 : null })), planningDay: 4, upNext: 'Pull A' });
    expect(placed.get('Pull A')).toBe(4);
    const b = weekBehind({ notDone, schedule: { mode: 'set', planningDay: 4, planWeekdays: Object.values(WEEKDAY), placed } });
    expect(b.k).toBe(3);
  });

  it('a day Ben moved onto a rest day himself fits there', () => {
    const days = Object.entries(WEEKDAY).map(([key, wd]) => ({ key, weekday: key === 'Upper B' ? 4 : wd, doneOn: key === 'Push A' ? 0 : null, movedTo: key === 'Upper B' ? 4 : null }));
    const placed = setDaysWeekSlots({ days, planningDay: THU, upNext: 'Pull A' });
    const b = weekBehind({ notDone, schedule: { mode: 'set', planningDay: THU, planWeekdays: days.flatMap((d) => [d.weekday]), placed } });
    expect(placed.get('Upper B')).toBe(4);
    expect(b).toMatchObject({ k: 1, overflow: ['Legs B'] });
  });

  it('Any days: the pace rule, ⌈N × days left ÷ 7⌉ capped at days left', () => {
    // Thursday: 4 days left, ⌈5 × 4 ÷ 7⌉ = 3 slots, 4 not done → 1 behind.
    expect(weekBehind({ notDone, schedule: { mode: 'any', planningDay: THU, daysPerWeek: 5 } })).toMatchObject({ mode: 'any', k: 1, slots: 3, overflow: ['Legs A'] });
    // 6-day pace edge on Saturday: 2 days left, ⌈6 × 2 ÷ 7⌉ = 2; 2 not done → not behind.
    expect(weekBehind({ notDone: ['a', 'b'], schedule: { mode: 'any', planningDay: 5, daysPerWeek: 6 } }).k).toBe(0);
    // Sunday after a workout (planning day 7): no days left.
    expect(weekBehind({ notDone: ['a'], schedule: { mode: 'any', planningDay: 7, daysPerWeek: 3 } })).toMatchObject({ k: 1, slots: 0 });
  });
});

describe('MS2 behindOfferShown', () => {
  const g: BehindOfferGate = { today: '2026-11-05', lighterWeek: false, paused: false, trainedOrOpenToday: false, pickedToday: false, ill: false, gapDays: 3, dismissedOn: null };
  it('shown when behind ≥ 1 and nothing excludes it', () => {
    expect(behindOfferShown({ k: 2 }, g)).toBe(true);
    expect(behindOfferShown({ k: 0 }, g)).toBe(false);
    expect(behindOfferShown(null, g)).toBe(false);
  });
  it('never in a deload or lighter week, paused, after training today, when he picked today, ill, or a ≥ 14-day gap', () => {
    for (const patch of [{ lighterWeek: true }, { paused: true }, { trainedOrOpenToday: true }, { pickedToday: true }, { ill: true }, { gapDays: 14 }]) expect(behindOfferShown({ k: 2 }, { ...g, ...patch })).toBe(false);
    expect(behindOfferShown({ k: 2 }, { ...g, gapDays: 13 })).toBe(true);
  });
  it('dismissed today: gone for the day, back tomorrow', () => {
    expect(behindOfferShown({ k: 2 }, { ...g, dismissedOn: '2026-11-05' })).toBe(false);
    expect(behindOfferShown({ k: 2 }, { ...g, today: '2026-11-06', dismissedOn: '2026-11-05' })).toBe(true);
  });
});

describe('MS4 behindPick and MS6 built-in day', () => {
  // Push A on Monday: chest, shoulders, triceps; bench trained.
  const facts = { weekDirect: new Map([['Chest', 6], ['Shoulders', 3], ['Triceps', 3]]), mainTrained: new Set(['bench']), yesterdayDirect: new Map<string, number>() };
  const later = (key: string) => (key === 'Legs A' ? [] : [legsA]);
  it('Ben’s week → Pull A (back 8 + biceps 3 + rear delts 2 = 13), then Upper B (back 6 + biceps 2), then Legs B (core 3)', () => {
    const scores = behindPick({ days: [pullA, upperB, legsB], later, facts, groupOf });
    expect(scores.map((s) => s.key)).toEqual(['Pull A', 'Upper B', 'Legs B']);
    expect(scores[0]).toMatchObject({ mainLifts: 1, uncoveredSets: 13, uncoveredGroups: ['Back', 'Rear delts', 'Biceps'], sets: 13 });
    expect(scores[1]).toMatchObject({ mainLifts: 1, uncoveredSets: 13 - 5 });
    // Legs B: deadlift and core (Legs A has neither); quads, hamstrings and calves are on Saturday.
    expect(scores[2]).toMatchObject({ mainLifts: 1, uncoveredGroups: ['Core'], uncoveredSets: 3 });
  });
  it('main lifts first: a day whose main lift is on a later day loses it', () => {
    const s = behindPick({ days: [legsA], later: () => [day('x', ['squat'], [])], facts, groupOf });
    expect(s[0]?.mainLifts).toBe(0);
  });
  it('yesterday only breaks ties; Up next order last', () => {
    const a = day('A', [], [['row', 4]]);
    const b = day('B', [], [['curl', 4]]);
    const y = { ...facts, yesterdayDirect: new Map([['Back', 4]]) };
    expect(behindPick({ days: [a, b], later: () => [], facts: y, groupOf }).map((s) => s.key)).toEqual(['B', 'A']);
    expect(behindPick({ days: [a, b], later: () => [], facts, groupOf }).map((s) => s.key)).toEqual(['A', 'B']);
  });
  it('built-in: the top day whole (Pull A, 13 sets); none when it is already today’s card', () => {
    const scores = behindPick({ days: [legsB, pullA, upperB], later, facts, groupOf });
    expect(behindBuiltInDay(scores, 'Legs B')).toMatchObject({ key: 'Pull A', sets: 13 });
    expect(behindBuiltInDay(scores, 'Pull A')).toBeNull();
  });
  it('pushA unused groups are covered (sanity: chest done Monday never counts as uncovered)', () => {
    expect(behindPick({ days: [pushA], later: () => [], facts, groupOf })[0]?.uncoveredGroups).toEqual([]);
  });
});

describe('MS5 coverage check (Ben, 8 Nov: biceps left out)', () => {
  it('a proposal without curls leaves Biceps uncovered; with curls, nothing', () => {
    expect(behindCoverageGaps(['Back', 'Biceps'], [{ exerciseId: 'row', sets: 3 }, { exerciseId: 'pulldown', sets: 3 }], groupOf)).toEqual(['Biceps']);
    expect(behindCoverageGaps(['Back', 'Biceps'], [{ exerciseId: 'row', sets: 3 }, { exerciseId: 'curl', sets: 2 }], groupOf)).toEqual([]);
  });
});

describe('Week tiles agree with the count (MS1 flag 1)', () => {
  it('Ben’s Thursday: Pull A today, Legs A Saturday, Upper B and Legs B missed on their own days, Friday plain', () => {
    const placed = slotsOf('Pull A');
    const b = weekBehind({ notDone, schedule: { mode: 'set', planningDay: THU, planWeekdays: Object.values(WEEKDAY), placed } });
    const date = (wd: number) => `2026-11-0${String(2 + wd)}`;
    const tiles = buildWeekTiles({
      today: '2026-11-05',
      workouts: [{ sessionId: 's1', localDate: '2026-11-02', title: 'Push A', dayName: 'Push A' }],
      activities: [],
      plannedDays: notDone.map((n) => ({ localDate: date(placed.get(n) ?? WEEKDAY[n] ?? 0), name: n })),
      missed: b.overflow.map((n) => ({ localDate: date(WEEKDAY[n] ?? 0), name: n })),
      chosen: 'Pull A',
    });
    const missedMarks = tiles.flatMap((t) => t.marks.filter((m) => m.shape === 'missed'));
    expect(missedMarks).toHaveLength(b.k);
    expect(tiles[2]?.accessibilityLabel).toBe('Wednesday 4: Upper B, missed');
    expect(tiles[3]?.accessibilityLabel).toBe("Today, Thursday 5: Pull A, today's workout. Legs B, missed");
    expect(tiles[4]).toMatchObject({ state: 'plain', marks: [] });
    expect(tiles[5]?.accessibilityLabel).toBe('Saturday 7: Legs A, Planned');
  });
});
