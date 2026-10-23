import { describe, expect, it } from 'vitest';
import { DraftPlanSchema } from '@fizz/schemas';
import {
  addWarmup,
  applyBuilderEdit,
  BUILDER_TIME,
  canAddWarmup,
  estimateBuilderSeconds,
  fitToMinutes,
  fromDraftPlan,
  isTimedSlot,
  makeSlot,
  reloadSlotLoads,
  slotsOf,
  toDraftPlan,
  type BuilderSlot,
  type BuilderWorkout,
  type DraftCodecContext,
} from '../src/index';
import { context, info, lbRack, loadInput, loadsFor, rack } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * (22 Oct, Your workout) Cardio, timed sets and an exercise listed twice open on Your workout as the saved workout
 * has them, and Start creates them as saved. The builder holds a timed or cardio set as its work time and distance
 * (no reps): it round-trips through the draft, counts its time in the estimate, and isn't edited, retyped, ramped or
 * re-derived here. Rep-based slots are unchanged (Today never has timed rows).
 */

const codec: DraftCodecContext = { info, catalogueIdOf: (x) => x, checkedOnOf: () => null };
const [RIDE, PLANK] = [id(201), id(202)];

const timed = (key: string, exerciseId: string, rows: { durationS?: number; distanceM?: number }[]): BuilderSlot => ({
  key,
  exerciseId,
  main: false,
  repRange: { min: 1, max: 1 },
  rows: rows.map((r) => ({ type: 'working' as const, reps: 1, load: null, rpe: null, ...r })),
  unit: 'kg',
  convention: 'bodyweight',
  source: 'none',
  startLight: null,
  anchorE1rm: null,
});

describe('a timed or cardio slot', () => {
  const ctx = context();
  const ride = timed(id(301), RIDE, [{ durationS: 1200, distanceM: 5000 }]);
  const plank = timed(id(302), PLANK, [{ durationS: 45 }, { durationS: 45 }]);
  const row = timed(id(303), id(205), [{ distanceM: 2000 }]);

  it('round-trips through the draft as saved: no reps, its work time and distance; the stored plan is valid', () => {
    const w: BuilderWorkout = { blocks: [{ slots: [ride], auto: false }, { slots: [plank], auto: false }, { slots: [row], auto: false }], restLevel: 'normal' };
    const plan = toDraftPlan(w, codec);
    expect(DraftPlanSchema.safeParse(plan).error?.issues).toBeUndefined();
    expect(plan.slots.map((s) => s.setTemplates.map((t) => [t.reps, t.durationS, t.distanceM ?? null]))).toEqual([[[null, 1200, 5000]], [[null, 45, null], [null, 45, null]], [[null, null, 2000]]]);
    const back = slotsOf(fromDraftPlan(plan).blocks);
    expect(back.map((s) => s.rows.map((r) => [r.durationS ?? null, r.distanceM ?? null]))).toEqual([[[1200, 5000]], [[45, null], [45, null]], [[null, 2000]]]);
    expect(back.every(isTimedSlot)).toBe(true);
  });

  it('counts its work time in the estimate (a 20:00 ride is 20 minutes, not 45 s); a distance alone adds nothing invented; rep slots are unchanged', () => {
    const reps = makeSlot('cable_fly', { main: false, workingSets: 1 }, ctx);
    const solo = (s: BuilderSlot): BuilderWorkout => ({ blocks: [{ slots: [s], auto: false }], restLevel: 'normal' });
    const base = estimateBuilderSeconds(solo({ ...ride, rows: [{ type: 'working', reps: 1, load: null, rpe: null }] }), ctx);
    expect(estimateBuilderSeconds(solo(ride), ctx) - base).toBe(1200 - BUILDER_TIME.setS);
    expect(estimateBuilderSeconds(solo(row), ctx)).toBe(base);
    // A rep-based isolation set: setup + 45 s + its 1:30 rest, as before.
    expect(estimateBuilderSeconds(solo(reps), ctx)).toBe(BUILDER_TIME.setupS + BUILDER_TIME.setS + 90);
  });

  it('isn’t edited, retyped, ramped or given a drop here; its sets can still be added (a copy, with its time) or deleted', () => {
    const w: BuilderWorkout = { blocks: [{ slots: [plank], auto: false }], restLevel: 'normal' };
    expect(applyBuilderEdit(w, { kind: 'edit_row', slotKey: plank.key, index: 0, patch: { kind: 'reps', reps: 10 } }, ctx)).toEqual({ ok: false, reason: 'timed_set' });
    expect(applyBuilderEdit(w, { kind: 'set_type', slotKey: plank.key, index: 0, type: 'top' }, ctx)).toEqual({ ok: false, reason: 'timed_set' });
    expect(applyBuilderEdit(w, { kind: 'add_drop', slotKey: plank.key }, ctx)).toEqual({ ok: false, reason: 'timed_set' });
    expect(applyBuilderEdit(w, { kind: 'add_warmup', slotKey: plank.key }, ctx)).toEqual({ ok: false, reason: 'timed_set' });
    expect(canAddWarmup(plank)).toBe(false);
    expect(addWarmup(plank, ctx)).toEqual({ ok: false, reason: 'timed_set' });
    const more = applyBuilderEdit(w, { kind: 'add_set', slotKey: plank.key }, ctx);
    expect(more.ok && slotsOf(more.workout.blocks)[0]?.rows.map((r) => r.durationS)).toEqual([45, 45, 45]);
    const fewer = applyBuilderEdit(w, { kind: 'delete_set', slotKey: plank.key, index: 1 }, ctx);
    expect(fewer.ok && slotsOf(fewer.workout.blocks)[0]?.rows).toHaveLength(1);
  });

  it('keeps its saved sets when the gym changes (no reps formula to work loads out from)', () => {
    expect(reloadSlotLoads(ride, { role: 'isolation', barbell: false }, loadsFor(RIDE))).toBe(ride);
  });

  it('(rule 4; 22 Oct review) a load it carries (a farmer’s carry) is fitted to the new gym: rounded down, never past its max, in its unit; none here: no load target', () => {
    const carry: BuilderSlot = { ...timed(id(304), id(206), [{ durationS: 60 }, { durationS: 60 }]), convention: 'per_hand', rows: [45, 21].map((load) => ({ type: 'working' as const, reps: 1, load, rpe: null, durationS: 60, typed: true as const })) };
    const here = reloadSlotLoads(carry, { role: 'isolation', barbell: false }, loadInput({ equipment: rack, convention: 'per_hand' }));
    expect(here.rows.map((r) => [r.load, r.durationS, r.typed])).toEqual([
      [40, 60, undefined],
      [20, 60, undefined],
    ]);
    expect([here.unit, here.convention]).toEqual(['kg', 'per_hand']);
    // An lb rack: the same carry in lb, rounded down there.
    const lb = reloadSlotLoads(carry, { role: 'isolation', barbell: false }, loadInput({ equipment: lbRack, convention: 'per_hand', unit: 'lb' }));
    expect(lb.unit).toBe('lb');
    expect(lb.rows.map((r) => r.load)).toEqual([95, 45]);
    // No dumbbells at this gym: nothing here can make it, so no load (never the old gym's).
    expect(reloadSlotLoads(carry, { role: 'isolation', barbell: false }, loadInput({ equipment: null, convention: 'per_hand' })).rows.map((r) => r.load)).toEqual([null, null]);
  });

  it('fit to time: cardio with no builder group is cut first (an extra); its effort isn’t pushed; a timed set keeps its time', () => {
    const bench = makeSlot('bench', { main: true }, ctx);
    const fly = makeSlot('cable_fly', { main: false }, ctx);
    const w: BuilderWorkout = { blocks: [{ slots: [bench], auto: false }, { slots: [fly], auto: false }, { slots: [ride], auto: false }], restLevel: 'normal' };
    const minutes = Math.round(estimateBuilderSeconds(w, ctx) / 60);
    // Rests alone can't save 15 minutes: the ride (no group: an extra, 1.5 a set) is the cheapest cut; the fly and bench stay.
    const r = fitToMinutes(w, ctx, { minutes: minutes - 15, mainGroup: 'Chest', grow: false, supersets: false, pushEffort: true });
    expect(r.steps.filter((s) => s.kind === 'drop').map((s) => s.slotKey)).toEqual([ride.key]);
    expect(slotsOf(r.workout.blocks).map((s) => s.exerciseId)).toEqual(['bench', 'cable_fly']);
    expect(r.steps.flatMap((s) => (s.kind === 'effort' ? s.slotKeys : []))).not.toContain(ride.key);
  });
});

describe('an exercise listed twice', () => {
  it('is two slots with their own keys, sets and loads through the draft; edits name one copy', () => {
    const ctx = context();
    const a = { ...makeSlot('cable_fly', { main: false, workingSets: 2 }, ctx), key: id(401) };
    const b = { ...makeSlot('cable_fly', { main: false, workingSets: 4 }, ctx), key: id(402) };
    const w: BuilderWorkout = { blocks: [{ slots: [a], auto: false }, { slots: [b], auto: false }], restLevel: 'normal' };
    const back = fromDraftPlan(toDraftPlan(w, codec));
    expect(slotsOf(back.blocks).map((s) => [s.key, s.rows.length])).toEqual([
      [id(401), 2],
      [id(402), 4],
    ]);
    const r = applyBuilderEdit(back, { kind: 'add_set', slotKey: id(401) }, ctx);
    expect(r.ok && slotsOf(r.workout.blocks).map((s) => s.rows.length)).toEqual([3, 4]);
  });
});
