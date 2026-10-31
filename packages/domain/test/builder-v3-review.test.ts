import { describe, expect, it } from 'vitest';
import {
  buildFromSetup,
  builderSupersetWithNext,
  builderUnlink,
  clampMinutes,
  fitToMinutes,
  makeSlot,
  mergeSetupChange,
  orderSlots,
  pairSlots,
  singlesOf,
  type BuilderBlock,
  type BuilderSetup,
  type BuilderSlot,
  type BuilderWorkout,
  type SetupIdentity,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/** Review b3-rules-20oct: B3 (unlinked pairs stay unlinked), S5 (fit floor), S6 (order). */

const ids = (w: { blocks: readonly BuilderBlock[] }) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));
const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);
const chestGroups = [
  { group: 'Chest', count: 3 },
  { group: 'Arms', count: 1 },
  { group: 'Core', count: 1 },
] as const;
const setup = (over: Partial<BuilderSetup & SetupIdentity> = {}): BuilderSetup & SetupIdentity => ({ dayId: 'chest', mainLiftExerciseId: 'bench', variationId: null, minutes: 60, supersets: true, groups: chestGroups, ...over });

/** Ben unlinks every superset the builder made. */
function unlinkAll(w: BuilderWorkout): BuilderWorkout {
  let blocks: BuilderBlock[] = w.blocks;
  for (;;) {
    const pair = blocks.find((b) => b.slots.length > 1);
    const key = pair?.slots[1]?.key;
    if (key === undefined) return { ...w, blocks };
    blocks = builderUnlink(blocks, key) ?? blocks;
  }
}

describe('B3: Unlink is remembered', () => {
  it('builderUnlink splits the pair in place and marks both; Superset with next clears it', () => {
    const ctx = context();
    const w = buildFromSetup(setup(), pool, ctx).workout;
    expect(ids(w)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
    const crunch = all(w).find((s) => s.exerciseId === 'crunch')?.key ?? '';
    const split = builderUnlink(w.blocks, crunch);
    expect(split && ids({ blocks: split })).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'crunch']);
    expect(split?.slice(3).every((b) => !b.auto && b.slots[0]?.unlinked === true)).toBe(true);
    expect(builderUnlink(w.blocks, all(w)[0]?.key ?? '')).toBeNull();
    // Automatic pairing leaves them alone.
    expect(split && ids({ blocks: pairSlots(split, info) })).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'crunch']);
    // Ben links them again himself: his pair, flags cleared.
    const pushdown = all(w).find((s) => s.exerciseId === 'pushdown')?.key ?? '';
    const again = split === null ? null : builderSupersetWithNext(split, pushdown);
    expect(again && ids({ blocks: again })).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
    expect(again?.[3]).toMatchObject({ auto: false });
    expect(again?.[3]?.slots.some((s) => s.unlinked === true)).toBe(false);
    // Never with the main lift.
    expect(builderSupersetWithNext(w.blocks, all(w)[0]?.key ?? '')).toBeNull();
  });

  it('raising a group count in Set up pairs only the new exercise, never singles Ben unlinked', () => {
    const ctx = context();
    const w = unlinkAll(buildFromSetup(setup(), pool, ctx).workout);
    expect(ids(w)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'crunch']);
    const r = mergeSetupChange(setup(), setup({ groups: [chestGroups[0], { group: 'Arms', count: 2 }, chestGroups[2]] }), w, pool, ctx);
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') return;
    // Only the curl (new; D5's Arms 2 on a chest day is a pushdown and a curl) gets a partner, a single that was
    // never paired; pushdown and crunch (unlinked) stay single. The reported bug paired cable_fly+pushdown and the
    // new one with crunch.
    expect(ids(r.workout)).toEqual(['bench', 'incline_db+curl', 'cable_fly', 'pushdown', 'crunch']);
  });

  it('a new exercise pairs with a single nobody unlinked (abs first, as §3.5); the other singles stay as they are', () => {
    const ctx = context();
    const built = buildFromSetup(setup({ supersets: false }), pool, ctx).workout;
    const r = mergeSetupChange(setup(), setup({ groups: [chestGroups[0], { group: 'Arms', count: 2 }, chestGroups[2]] }), built, pool, ctx);
    expect(r.kind === 'merged' && ids(r.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown', 'curl+crunch']);
  });

  it('filling time with Supersets on pairs only the added exercise', () => {
    const ctx = context();
    const w = unlinkAll(buildFromSetup(setup({ minutes: 60 }), pool, ctx).workout);
    const g = fitToMinutes(w, ctx, { minutes: 90, mainGroup: 'Chest', grow: true, supersets: true, addCandidates: { arm: ['oh_ext'], mainGroup: ['machine_press'] } });
    const added = g.steps.flatMap((s) => (s.kind === 'add' ? [s.exerciseId] : []));
    expect(added.length).toBeGreaterThan(0);
    // Pairs, if any, always include an added exercise; Ben's unlinked singles stay single.
    for (const b of g.workout.blocks.filter((x) => x.slots.length > 1)) expect(b.slots.some((s) => added.includes(s.exerciseId))).toBe(true);
    for (const s of all(w)) {
      const block = g.workout.blocks.find((b) => b.slots.some((x) => x.key === s.key));
      expect(block?.slots.filter((x) => x.unlinked === true && x.key !== s.key)).toEqual([]);
    }
  });

  it('turning Supersets on pairs everything except what Ben unlinked', () => {
    const ctx = context();
    const w = buildFromSetup(setup({ supersets: false }), pool, ctx).workout;
    const fly = all(w).find((s) => s.exerciseId === 'cable_fly');
    const marked: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s === fly ? { ...s, unlinked: true as const } : s)) })) };
    const r = mergeSetupChange(setup({ supersets: false }), setup({ supersets: true }), marked, pool, ctx);
    expect(r.kind === 'merged' && ids(r.workout)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
  });
});

describe('S5: fit floor and length bounds', () => {
  it('with no main lift, one exercise always stays and the result is over, never an empty fitted workout', () => {
    const ctx = context();
    // Each alone is over 15 min even at 2 sets (10 min rests), so the ladder drops exercises down to the floor.
    const slots: BuilderSlot[] = ['incline_db', 'machine_press', 'cable_fly'].map((x) => ({ ...makeSlot(x, { main: false }, ctx), restS: { working: 600 } }));
    const w: BuilderWorkout = { blocks: singlesOf(slots), restLevel: 'normal' };
    const f = fitToMinutes(w, ctx, { minutes: 3, mainGroup: 'Chest', grow: false, supersets: false });
    expect(all(f.workout)).toHaveLength(1);
    expect(f.status).toBe('over');
  });

  it('minutes are clamped to 15–180', () => {
    expect([clampMinutes(3), clampMinutes(15), clampMinutes(60.4), clampMinutes(500), clampMinutes(Number.NaN)]).toEqual([15, 15, 60, 180, 15]);
    const ctx = context();
    const w = buildFromSetup(setup({ minutes: 999 }), pool, ctx).workout;
    expect(fitToMinutes(w, ctx, { minutes: 999, mainGroup: 'Chest', grow: false, supersets: true }).status).toBe('fits');
    const huge = fitToMinutes(w, ctx, { minutes: 999, mainGroup: 'Chest', grow: true, supersets: true });
    expect(huge.minutes).toBeLessThanOrEqual(180);
  });
});

describe('S6: order alternates only leg compounds', () => {
  const s = (exerciseId: string, main = false) => ({ exerciseId, main });

  it('a chest day with a back compound keeps the build order: the chest presses stay together', () => {
    const order = orderSlots([s('bench', true), s('incline_db'), s('lat_pulldown'), s('machine_press'), s('cable_fly')], info).map((x) => x.exerciseId);
    expect(order).toEqual(['bench', 'incline_db', 'lat_pulldown', 'machine_press', 'cable_fly']);
    const push = orderSlots([s('bench', true), s('incline_db'), s('machine_press'), s('lat_pulldown')], info).map((x) => x.exerciseId);
    expect(push).toEqual(['bench', 'incline_db', 'machine_press', 'lat_pulldown']);
  });

  it('legs still alternate quads and hinge', () => {
    const order = orderSlots([s('squat', true), s('leg_press'), s('rdl'), s('hip_thrust'), s('leg_curl')], info).map((x) => x.exerciseId);
    expect(order).toEqual(['squat', 'rdl', 'leg_press', 'hip_thrust', 'leg_curl']);
  });
});
