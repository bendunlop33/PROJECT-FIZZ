import { describe, expect, it } from 'vitest';

import { BEHIND_COPY, BEHIND_LONGER_COPY, behindLonger, behindPick, behindTapChoice, type BehindDay, type BehindExtra, type BehindLongerInput } from '../src/index';

/**
 * (Ben, 21 Nov: MS3 amended) The longer choice on Ben's week: Mon Push A done; Pull A and Upper B missed; Thursday.
 * Pull A is today's day (MS4); Legs A is still on Saturday; Legs B is missed too.
 */

const GROUP: Record<string, string> = {
  bench: 'Chest', incline: 'Chest', ohp: 'Shoulders', lateral: 'Shoulders', pushdown: 'Triceps',
  row: 'Back', pulldown: 'Back', cableRow: 'Back', facePull: 'Rear delts', pullUp: 'Back', curl: 'Biceps',
  dbBench: 'Chest', deadlift: 'Hamstrings', legPress: 'Quads', legCurl: 'Hamstrings', calf: 'Calves', legRaise: 'Core',
  squat: 'Quads', rdl: 'Hamstrings', lunge: 'Glutes',
};
const LEGS = new Set(['Quads', 'Hamstrings', 'Glutes', 'Calves']);
const groupOf = (id: string): string | null => GROUP[id] ?? null;
const day = (key: string, mains: string[], slots: [string, number][]): BehindDay => ({ key, name: key, mainLiftIds: mains, slots: slots.map(([exerciseId, sets]) => ({ exerciseId, sets })) });
const pullA = day('Pull A', ['row'], [['row', 3], ['pulldown', 3], ['cableRow', 2], ['facePull', 2], ['curl', 3]]);
const upperB = day('Upper B', ['ohp'], [['ohp', 3], ['pullUp', 3], ['dbBench', 3], ['cableRow', 3], ['lateral', 2], ['curl', 2], ['pushdown', 2]]);
const legsB = day('Legs B', ['deadlift'], [['deadlift', 3], ['legPress', 3], ['legCurl', 3], ['calf', 3], ['legRaise', 3]]);
const legsA = day('Legs A', ['squat'], [['squat', 3], ['rdl', 3], ['lunge', 3], ['calf', 3]]);
const facts = { weekDirect: new Map([['Chest', 6], ['Shoulders', 3], ['Triceps', 3]]), mainTrained: new Set(['bench']), yesterdayDirect: new Map<string, number>() };

/** A stand-in for the builder's estimate: 1 min changeover, 45 s + 2 min rest a set, 4 min of warm-ups on a main lift. */
const MAINS = new Set(['ohp', 'deadlift', 'squat', 'row', 'bench']);
const added = (xs: readonly BehindExtra[]) => xs.reduce((s, x) => s + 60 + x.sets * 165 + (MAINS.has(x.exerciseId) ? 240 : 0), 0);

function input(over: Partial<BehindLongerInput> = {}): BehindLongerInput {
  const scores = behindPick({ days: [pullA, upperB, legsB], later: () => [legsA], facts, groupOf });
  const [top, ...rest] = scores.map((s) => [pullA, upperB, legsB].find((d) => d.key === s.key) as BehindDay);
  return { top: top as BehindDay, others: rest, later: [legsA], facts, groupOf, held: () => false, legsOff: false, isLegs: (id) => LEGS.has(groupOf(id) ?? ''), addedSeconds: added, ...over };
}

describe('MS3 amended (21 Nov): behindLonger', () => {
  it('Ben’s Thursday: Upper B’s main lift first, then the uncovered group (core), within +20 min; back stays at 8', () => {
    const r = behindLonger(input());
    expect(r?.extras).toEqual([
      { exerciseId: 'ohp', sets: 3, dayKey: 'Upper B', reason: 'main', group: 'Shoulders' },
      // The deadlift doesn't fit in what's left (even at 2 sets); leg raises do at 2.
      { exerciseId: 'legRaise', sets: 2, dayKey: 'Legs B', reason: 'uncovered', group: 'Core' },
    ]);
    expect(r?.addedMinutes).toBeLessThanOrEqual(20);
    expect(r?.addedMinutes).toBe(20);
    // Pull-ups (Upper B) never come in: Pull A already gives back 8 sets (and back isn't a gap).
    expect(r?.extras.some((x) => x.exerciseId === 'pullUp')).toBe(false);
  });

  it('the 8-a-group cap trims an extra’s sets', () => {
    const shoulders = day('Shoulders', ['lateral'], [['lateral', 6], ['facePull', 2]]);
    const r = behindLonger(input({ top: shoulders, others: [upperB], later: [] }));
    expect(r?.extras[0]).toMatchObject({ exerciseId: 'ohp', sets: 2 });
  });

  it('nothing fits → no longer option', () => {
    expect(behindLonger(input({ addedSeconds: () => 21 * 60 }))).toBeNull();
    expect(behindLonger(input({ others: [] }))).toBeNull();
  });

  it('a pain hold is left out (rule 9): the deadlift takes the main-lift place', () => {
    const r = behindLonger(input({ held: (id) => id === 'ohp' }));
    expect(r?.extras.map((x) => x.exerciseId)).not.toContain('ohp');
    expect(r?.extras[0]).toMatchObject({ exerciseId: 'deadlift', reason: 'main', sets: 3 });
  });

  it('a long run tomorrow: no leg work added (rule 12)', () => {
    const r = behindLonger(input({ held: (id) => id === 'ohp', legsOff: true }));
    expect(r?.extras.map((x) => x.exerciseId)).toEqual(['legRaise']);
  });

  it('copy and the tap words', () => {
    expect(BEHIND_LONGER_COPY.usual(60)).toBe('Usual · ~60 min');
    expect(BEHIND_LONGER_COPY.longer(78, ['Incline Press', 'Lateral Raise'])).toBe('Longer · ~78 min · + incline press, lateral raise');
    expect(BEHIND_LONGER_COPY.longer(78, ['A', 'B', 'C'])).toBe('Longer · ~78 min · + a, b +1');
    expect(behindTapChoice(BEHIND_COPY.ask(2))).toBe('usual');
    expect(behindTapChoice(BEHIND_LONGER_COPY.askLonger('2 days behind', 18))).toBe('longer');
    expect(behindTapChoice('2 days behind, make it longer')).toBeNull();
  });
});
