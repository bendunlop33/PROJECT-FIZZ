import { describe, expect, it } from 'vitest';
import type { FillSetupArgs } from '@fizz/schemas';
import { checkFillSetup, parseSetupWords, type SetupCoachContext } from '../src/index';

/** Set up from words (§2.6, §9 Q4; S6 "pull, 50 minutes, no supersets" fills three rows). */

const ctx = (): SetupCoachContext => ({
  days: [
    { id: 'chest', name: 'Chest', mainLifts: [{ exerciseId: 'bench', catalogueId: 'barbell-bench-press', name: 'Barbell bench press' }, { exerciseId: 'incline_bb', catalogueId: 'incline-barbell-press', name: 'Incline barbell press' }] },
    { id: 'back', name: 'Back', mainLifts: [{ exerciseId: 'row', catalogueId: null, name: 'Barbell row' }] },
    { id: 'legs', name: 'Legs', mainLifts: [{ exerciseId: 'squat', catalogueId: null, name: 'Back squat' }] },
    { id: 'push', name: 'Push', mainLifts: [{ exerciseId: 'bench', catalogueId: null, name: 'Barbell bench press' }] },
    { id: 'pull', name: 'Pull', mainLifts: [{ exerciseId: 'row', catalogueId: null, name: 'Barbell row' }] },
  ],
  current: {
    dayId: 'chest',
    minutes: 60,
    mainLiftExerciseId: 'bench',
    supersets: true,
    groups: [
      { group: 'Chest', count: 4 },
      { group: 'Arms', count: 1 },
      { group: 'Core', count: 1 },
    ],
  },
  recommend: (s) => (s.dayId === 'pull' || s.dayId === 'back' ? [{ group: 'Back', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] : [{ group: 'Chest', count: 4 }]),
});

const none: FillSetupArgs = { dayId: null, minutes: null, mainLiftCatalogueId: null, supersets: null, groups: null, reply: null };

describe('offline Set up parser (no coach bubble, §9 Q4)', () => {
  it('“pull, 50 minutes, no supersets” fills day, length and supersets; the toast names all three', () => {
    const c = ctx();
    const words = 'pull, 50 minutes, no supersets';
    const args = parseSetupWords(words, c);
    expect(args).toMatchObject({ dayId: 'pull', minutes: 50, supersets: false });
    const fill = args === null ? null : checkFillSetup(args, c, words);
    expect(fill?.toast).toBe('Pull · 50 min · supersets off');
    expect(fill?.changed).toEqual(['day', 'minutes', 'main_lift', 'supersets', 'groups']);
    expect(fill?.next).toMatchObject({ dayId: 'pull', minutes: 50, mainLiftExerciseId: 'row', supersets: false });
    expect(fill?.next.groups).toEqual([{ group: 'Back', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }]);
  });

  it('groups: add arms, no abs; “add chest” is not a day change', () => {
    const c = ctx();
    const args = parseSetupWords('add arms and no abs', c);
    expect(args?.dayId).toBeNull();
    const fill = args === null ? null : checkFillSetup(args, c, 'add arms and no abs');
    expect(fill?.next.groups).toEqual([{ group: 'Chest', count: 4 }, { group: 'Arms', count: 2 }]);
    expect(fill?.toast).toBe('+1 Arms · no Core');
    expect(parseSetupWords('add chest', c)?.dayId ?? null).toBeNull();
  });

  it('D5 (Ben, 22–23 Oct): a part Ben names is +1 on its broad group', () => {
    const c = ctx();
    for (const [words, group] of [
      ['add biceps', 'Arms'],
      ['add triceps', 'Arms'],
      ['add curls', 'Arms'],
      ['add hamstrings', 'Legs'],
      ['add calves', 'Legs'],
      ['add core', 'Core'],
      ['add obliques', 'Core'],
    ] as const) {
      expect(parseSetupWords(words, c)?.groups, words).toEqual([{ group, delta: 1, count: null }]);
    }
    const fill = checkFillSetup(parseSetupWords('add biceps', c) ?? none, c, 'add biceps');
    expect(fill?.next.groups).toEqual([{ group: 'Chest', count: 4 }, { group: 'Arms', count: 2 }, { group: 'Core', count: 1 }]);
    expect(fill?.toast).toBe('+1 Arms');
  });

  it('main lift from the day’s options; words with nothing in them are not understood', () => {
    const c = ctx();
    const args = parseSetupWords('incline today', c);
    expect(args?.mainLiftCatalogueId).toBe('incline_bb');
    expect(args === null ? null : checkFillSetup(args, c, 'incline today')?.toast).toBe('Incline barbell press');
    expect(parseSetupWords('hello there', c)).toBeNull();
  });
});

describe('checkFillSetup (the coach’s fill_setup)', () => {
  it('Ben’s stated minutes win over the model’s; limits clamp with a note', () => {
    const c = ctx();
    expect(checkFillSetup({ ...none, minutes: 40 }, c, 'make it 45 minutes')?.next.minutes).toBe(45);
    const long = checkFillSetup({ ...none, minutes: 400 }, c, 'as long as you like');
    expect(long?.next.minutes).toBe(180);
    expect(long?.notes).toEqual(['Length 180 min (limit 15–180)']);
  });

  it('an unknown day or a main lift not of the day is refused; nothing else changes', () => {
    const c = ctx();
    expect(checkFillSetup({ ...none, dayId: 'arms' }, c, 'arms')).toBeNull();
    const r = checkFillSetup({ ...none, mainLiftCatalogueId: 'squat', supersets: false }, c, 'squat, no supersets');
    expect(r?.next.mainLiftExerciseId).toBe('bench');
    expect(r?.notes).toEqual(["Not changed: that main lift isn't one of Chest's"]);
    expect(r?.toast).toBe('supersets off');
    // A catalogue ID resolves to Ben's exercise; `none` takes the main lift off.
    expect(checkFillSetup({ ...none, mainLiftCatalogueId: 'incline-barbell-press' }, c, '')?.next.mainLiftExerciseId).toBe('incline_bb');
    expect(checkFillSetup({ ...none, mainLiftCatalogueId: 'none' }, c, '')?.toast).toBe('no main lift');
  });

  it('counts 0–4 per group; at most 10 exercises', () => {
    const c = ctx();
    const r = checkFillSetup({ ...none, groups: [{ group: 'Arms', delta: null, count: 9 }, { group: 'Shoulders', delta: 3, count: null }, { group: 'Back', delta: null, count: 4 }] }, c, '');
    expect(r?.notes).toContain('Arms: 4 (limit 0–4)');
    const total = r?.next.groups.reduce((m, g) => m + g.count, 0) ?? 0;
    expect(total).toBeLessThanOrEqual(10);
  });
});

describe('a day change brings the main lift Set up opens that day with (review builder-order S2)', () => {
  it('a plan day whose template has no main lift: none, as tapping the day opens it; the lifts stay offered', () => {
    const base = ctx();
    const c: SetupCoachContext = { ...base, days: base.days.map((d) => (d.id === 'push' ? { ...d, defaultMainLiftExerciseId: null } : d)) };
    const fill = checkFillSetup({ ...none, dayId: 'push' }, c, 'push day');
    expect(fill?.next).toMatchObject({ dayId: 'push', mainLiftExerciseId: null });
    // None is the day's own default, so the toast doesn't call it out.
    expect(fill?.toast).toBe('Push');
    const named = checkFillSetup({ ...none, dayId: 'push', mainLiftCatalogueId: 'bench' }, c, 'push day with bench');
    expect(named?.next.mainLiftExerciseId).toBe('bench');
  });

  it('no default given: the first of the day’s lifts, as before', () => {
    expect(checkFillSetup({ ...none, dayId: 'pull' }, ctx(), 'pull')?.next.mainLiftExerciseId).toBe('row');
  });
});
