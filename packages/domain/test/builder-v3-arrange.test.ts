import { describe, expect, it } from 'vitest';
import { adviseAfter, adviseBuilder, canPair, orderSlots, pairSlots, singlesOf, unpairAuto, type BuilderBlock, type BuilderSlot } from '../src/index';
import { info } from './builder-v3-fixture';

const slot = (exerciseId: string, main = false): BuilderSlot => ({ key: exerciseId, exerciseId, main, repRange: { min: 8, max: 12 }, rows: [], source: 'none', anchorE1rm: null });
const names = (blocks: readonly BuilderBlock[]) => blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));

describe('orderSlots (§3.4)', () => {
  it('main lift → compounds → isolations → abs last', () => {
    const out = orderSlots([slot('crunch'), slot('cable_fly'), slot('pushdown'), slot('incline_db'), slot('bench', true), slot('machine_press')], info);
    expect(out.map((s) => s.exerciseId)).toEqual(['bench', 'incline_db', 'machine_press', 'cable_fly', 'pushdown', 'crunch']);
  });

  it('legs: compounds alternate quads and hinge after the main lift', () => {
    const out = orderSlots([slot('leg_press'), slot('hip_thrust'), slot('leg_curl'), slot('rdl'), slot('squat', true), slot('calf')], info);
    expect(out.map((s) => s.exerciseId)).toEqual(['squat', 'hip_thrust', 'leg_press', 'rdl', 'leg_curl', 'calf']);
  });
});

describe('canPair / pairSlots (§3.5)', () => {
  it('never the main lift, two heavy lifts, abs with a heavy lift, or a shared muscle', () => {
    expect(canPair(slot('bench', true), slot('crunch'), info).reason).toBe('main');
    expect(canPair(slot('rdl'), slot('hip_thrust'), info).reason).toBe('heavy_pair');
    expect(canPair(slot('rdl'), slot('crunch'), info).reason).toBe('abs_heavy');
    expect(canPair(slot('lat_pulldown'), slot('assisted_pullup'), info)).toEqual({ ok: false, reason: 'shared_muscle', muscle: 'lats' });
    // Same part (both quads) is a shared muscle even with different words.
    expect(canPair(slot('leg_ext'), slot('leg_press'), info).reason).toBe('shared_muscle');
    expect(canPair(slot('pushdown'), slot('crunch'), info).ok).toBe(true);
    expect(canPair(slot('pushdown'), slot('curl'), info).ok).toBe(true);
    // Quads and hamstrings are different muscles for pairing.
    expect(canPair(slot('leg_ext'), slot('leg_curl'), info).ok).toBe(true);
  });

  it('abs pair with the last accessory that fits; the rest pair in order; pairs only; main stays alone', () => {
    const blocks = pairSlots(singlesOf([slot('bench', true), slot('incline_db'), slot('cable_fly'), slot('pushdown'), slot('crunch')]), info);
    expect(names(blocks)).toEqual(['bench', 'incline_db', 'cable_fly', 'pushdown+crunch']);
    expect(blocks[3]?.auto).toBe(true);
    expect(blocks.every((b) => b.slots.length <= 2)).toBe(true);
  });

  it('legs: abs skip the heavy lifts and pair with leg curl; no abs + heavy pair', () => {
    const blocks = pairSlots(singlesOf([slot('squat', true), slot('rdl'), slot('leg_press'), slot('leg_curl'), slot('crunch')]), info);
    expect(names(blocks)).toEqual(['squat', 'rdl', 'leg_press', 'leg_curl+crunch']);
  });

  it("Ben's own pairs are kept; unpairAuto splits only the builder's", () => {
    const own: BuilderBlock = { slots: [slot('cable_fly'), slot('curl')], auto: false };
    const blocks = pairSlots([{ slots: [slot('bench', true)], auto: false }, own, { slots: [slot('pushdown')], auto: false }, { slots: [slot('crunch')], auto: false }], info);
    expect(names(blocks)).toEqual(['bench', 'cable_fly+curl', 'pushdown+crunch']);
    expect(names(unpairAuto(blocks))).toEqual(['bench', 'cable_fly+curl', 'pushdown', 'crunch']);
  });
});

describe('adviseBuilder (§3.8)', () => {
  it('isolation before a compound for the same muscle, with the reason and the fix', () => {
    const a = adviseBuilder(singlesOf([slot('bench', true), slot('cable_fly'), slot('incline_db')]), info);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'isolation_first', muscle: 'chest', reason: 'It tires your chest before the heavier lift.', fix: { kind: 'move_first', slotKey: 'incline_db', label: 'Move Incline dumbbell press first' } });
  });

  it('superset checks: heavy pair, abs with heavy, shared muscle', () => {
    const blocks: BuilderBlock[] = [
      { slots: [slot('rdl'), slot('hip_thrust')], auto: false },
      { slots: [slot('leg_press'), slot('crunch')], auto: false },
      { slots: [slot('lat_pulldown'), slot('assisted_pullup')], auto: false },
    ];
    const a = adviseBuilder(blocks, info);
    expect(a.map((x) => [x.kind, x.reason])).toEqual([
      ['heavy_pair', 'Two heavy lifts back to back: both get weaker and form slips.'],
      ['abs_heavy', 'Ab work between sets tires the bracing that protects your lower back.'],
      ['shared_muscle', 'Both work your lats, so the second one suffers.'],
    ]);
    expect(a[0]?.fix).toEqual({ kind: 'unlink', slotKey: 'hip_thrust', label: 'Unlink Hip thrust' });
  });

  it('a recommended workout has no advice; after an edit only the new item is reported', () => {
    const good = pairSlots(singlesOf([slot('bench', true), slot('incline_db'), slot('cable_fly'), slot('pushdown'), slot('crunch')]), info);
    const before = adviseBuilder(good, info);
    expect(before).toEqual([]);
    const edited: BuilderBlock[] = [good[0] as BuilderBlock, { slots: [slot('incline_db'), slot('cable_fly')], auto: false }, good[3] as BuilderBlock];
    const fresh = adviseAfter(before, adviseBuilder(edited, info));
    expect(fresh?.kind).toBe('shared_muscle');
    expect(adviseAfter(adviseBuilder(edited, info), adviseBuilder(edited, info))).toBeNull();
  });
});
