import { describe, expect, it } from 'vitest';
import { applyVariation, buildFromSetup, mixExclusion, mixItUpOfflinePick, mixItUpPick, mixItUpShortlist, mixItUpTarget, type BuilderWorkout, type MixShortlistInput, type VariationOp } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

const ids = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));
const sets = (w: BuilderWorkout, id: string) => w.blocks.flatMap((b) => b.slots).find((s) => s.exerciseId === id)?.rows.filter((r) => r.type !== 'warmup').length;

const chest = (supersets = true) =>
  buildFromSetup(
    {
      minutes: 999,
      mainLiftExerciseId: 'bench',
      supersets,
      groups: [
        { group: 'Chest', count: 3 },
        { group: 'Arms', count: 1 },
        { group: 'Core', count: 1 },
      ],
    },
    pool,
    context(),
  ).workout;

describe('Mix it up (§2.0.2, Ben agreed 20 Oct)', () => {
  it('which one: never the main lift; the accessory done most often lately on this day', () => {
    const w = chest();
    const t = mixItUpTarget({ workout: w, info, recentCountOnDay: new Map([['bench', 9], ['cable_fly', 4], ['incline_db', 2]]), varied: false });
    expect(t?.exerciseId).toBe('cable_fly');
    const mainOnly: BuilderWorkout = { ...w, blocks: w.blocks.slice(0, 1) };
    expect(mixItUpTarget({ workout: mainOnly, info, recentCountOnDay: new Map(), varied: false })).toBeNull();
  });

  it('on Varied, one that repeats another accessory’s angle goes first', () => {
    const ctx = context();
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }] }, pool, ctx).workout;
    expect(ids(w)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly']);
    // machine_press and cable_fly share Mid chest (bench too); the later one wins the tie.
    const t = mixItUpTarget({ workout: w, info, recentCountOnDay: new Map([['incline_db', 5]]), varied: true });
    expect(t?.exerciseId).toBe('cable_fly');
  });

  const base = (over: Partial<MixShortlistInput> = {}): MixShortlistInput => ({
    target: { exerciseId: 'cable_fly', main: false },
    candidates: ['crossover', 'pec_deck', 'incline_db', 'machine_press', 'pushdown', 'cable_fly'],
    info,
    availableHere: () => true,
    painFlagged: () => false,
    lastTwoOnDay: new Set(),
    inWorkout: new Set(['bench', 'incline_db', 'cable_fly', 'pushdown', 'crunch']),
    lastDoneMs: new Map(),
    ...over,
  });

  it('shortlist: same group, different angle, same role, here, not pain-flagged, not in the last 2 sessions, not in the workout', () => {
    expect(mixItUpShortlist(base())).toEqual(['crossover', 'pec_deck']);
    expect(mixExclusion('machine_press', base())).toBe('same_angle');
    expect(mixExclusion('pushdown', base())).toBe('not_same_group');
    expect(mixExclusion('incline_db', base({ target: { exerciseId: 'machine_press', main: false } }))).toBe('in_workout');
    // (Ben, 23 Oct) Incline barbell press near-duplicates the Incline dumbbell press already in: never offered.
    expect(mixExclusion('incline_bb', base({ target: { exerciseId: 'machine_press', main: false } }))).toBe('near_duplicate');
    expect(mixExclusion('incline_bb', base({ target: { exerciseId: 'machine_press', main: false }, inWorkout: new Set(['bench', 'machine_press', 'cable_fly']) }))).toBeNull();
    expect(mixExclusion('pec_deck', base({ painFlagged: (id) => id === 'pec_deck' }))).toBe('pain');
    expect(mixExclusion('pec_deck', base({ availableHere: (id) => id !== 'pec_deck' }))).toBe('not_here');
    expect(mixExclusion('pec_deck', base({ lastTwoOnDay: new Set(['pec_deck']) }))).toBe('recent_on_day');
    expect(mixExclusion('machine_press', base({ target: { exerciseId: 'pec_deck', main: false } }))).toBe('other_role');
  });

  it('offline pick = least recently done (never done first); the main lift has no shortlist', () => {
    const list = mixItUpShortlist(base({ lastDoneMs: new Map([['crossover', 2_000], ['pec_deck', 1_000]]) }));
    expect(list).toEqual(['pec_deck', 'crossover']);
    expect(mixItUpOfflinePick(list)).toBe('pec_deck');
    expect(mixItUpShortlist(base({ lastDoneMs: new Map([['crossover', 2_000]]) }))).toEqual(['pec_deck', 'crossover']);
    expect(mixItUpShortlist(base({ target: { exerciseId: 'bench', main: true } }))).toEqual([]);
    expect(mixItUpOfflinePick([])).toBeNull();
  });
});

describe('applyVariation (§4.3, Q17)', () => {
  const armsSuperset: VariationOp[] = [
    { kind: 'add_slot', after: 'cable_fly', slot: { exerciseId: 'hammer' } },
    { kind: 'pair', a: 'cable_fly', b: 'hammer' },
    { kind: 'set_count', exerciseId: 'pushdown', n: 4 },
    { kind: 'remove_slot', exerciseId: 'crunch' },
  ];

  it('template + extras', () => {
    const r = applyVariation(chest(false), armsSuperset, context());
    expect(r.skipped).toEqual([]);
    expect(ids(r.workout)).toEqual(['bench', 'incline_db', 'cable_fly+hammer', 'pushdown']);
    expect(sets(r.workout, 'pushdown')).toBe(4);
    // Ben's pair, not the builder's.
    expect(r.workout.blocks[2]?.auto).toBe(false);
  });

  it('a template change reaches the variation', () => {
    const ctx = context();
    const t2 = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] }, pool, ctx).workout;
    const r = applyVariation(t2, armsSuperset, ctx);
    expect(ids(r.workout)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly+hammer', 'pushdown']);
  });

  it('an op whose anchor exercise was swapped out of the template is skipped and reported', () => {
    const ctx = context();
    const t = chest(false);
    const swapped: BuilderWorkout = { ...t, blocks: t.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === 'cable_fly' ? { ...s, exerciseId: 'crossover' } : s)) })) };
    const r = applyVariation(swapped, armsSuperset, ctx);
    expect(r.skipped.map((s) => [s.index, s.reason])).toEqual([
      [0, 'anchor_missing'],
      [1, 'anchor_missing'],
    ]);
    expect(ids(r.workout)).toEqual(['bench', 'incline_db', 'crossover', 'pushdown']);
  });

  it('never pairs or removes the main lift; refuses a 5-exercise superset and duplicates', () => {
    const ctx = context();
    const t = chest(false);
    const r = applyVariation(
      t,
      [
        { kind: 'pair', a: 'bench', b: 'cable_fly' },
        { kind: 'remove_slot', exerciseId: 'bench' },
        { kind: 'add_slot', after: 'end', slot: { exerciseId: 'pushdown' } },
        { kind: 'pair', a: 'incline_db', b: 'cable_fly' },
        { kind: 'pair', a: 'incline_db', b: 'pushdown' },
        { kind: 'pair', a: 'incline_db', b: 'crunch' },
        { kind: 'add_slot', after: 'end', slot: { exerciseId: 'curl' } },
        { kind: 'pair', a: 'incline_db', b: 'curl' },
      ],
      ctx,
    );
    expect(r.skipped.map((s) => [s.index, s.reason])).toEqual([
      [0, 'main_lift'],
      [1, 'main_lift'],
      [2, 'already_in_workout'],
      [7, 'superset_full'],
    ]);
    expect(ids(r.workout)).toEqual(['bench', 'incline_db+cable_fly+pushdown+crunch', 'curl']);
  });
});

describe('mixItUpPick (Ben, 23 Oct: ↻ Mix it up on Your workout)', () => {
  const candidates = (g: string): readonly string[] => (g === 'Chest' ? ['crossover', 'pec_deck', 'incline_db', 'machine_press', 'cable_fly'] : g === 'Triceps' ? ['pushdown'] : g === 'Abs' ? ['crunch'] : []);
  const facts = { info, candidates, availableHere: () => true, painFlagged: () => false, lastTwoOnDay: new Set<string>(), lastDoneMs: new Map<string, number>(), varied: false };

  it('the 20 Oct target with its least recently done option; never the main lift', () => {
    const w = chest(false);
    const r = mixItUpPick({ ...facts, workout: w, recentCountOnDay: new Map([['cable_fly', 4]]), lastDoneMs: new Map([['crossover', 2], ['pec_deck', 1]]) });
    expect([r?.slot.exerciseId, r?.exerciseId]).toEqual(['cable_fly', 'pec_deck']);
  });

  it('a target with no fresh option gives way to the next accessory', () => {
    const w = chest(false);
    // Pushdown is done most lately, but nothing else in Triceps here: Cable fly is mixed instead.
    const r = mixItUpPick({ ...facts, workout: w, recentCountOnDay: new Map([['pushdown', 9], ['cable_fly', 1]]) });
    expect(r?.slot.exerciseId).toBe('cable_fly');
    expect(['crossover', 'pec_deck']).toContain(r?.exerciseId);
  });

  it('nothing fresh anywhere: null', () => {
    const w = chest(false);
    expect(mixItUpPick({ ...facts, workout: w, recentCountOnDay: new Map(), painFlagged: () => true })).toBeNull();
  });
});
