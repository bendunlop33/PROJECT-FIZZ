import { describe, expect, it } from 'vitest';
import { DraftPlanSchema, type CheckedOnRecord, type LoadConvention, type PlannedSet, type SetType, type WeightUnit } from '@fizz/schemas';
import { builderSourceOfPlanned, fromDraftPlan, plannedAsDraftPlan, slotsOf, type PlannedExerciseSource, type PlannedSetSource } from '../src/index';
import { id } from './fixtures';

/**
 * Review B1 (retire-workout-overview): a library workout or a past one opens on Your workout as the Workout overview
 * planned it (the planner's sets, at this gym), not rebuilt by the builder's §3.1 defaults; what the builder can't
 * hold is left out and named, never dropped silently.
 */

const ex = (n: number, exerciseId: string, over: Partial<PlannedExerciseSource> = {}): PlannedExerciseSource => ({ id: id(n), exerciseId, order: n, supersetGroup: null, equipmentId: id(500 + n), unit: 'kg', loadConvention: 'total', ...over });

const planned = (load: { value: number; unit?: WeightUnit; convention?: LoadConvention } | null, reps: { min: number; max: number } | null, over: Partial<PlannedSet> = {}): PlannedSet => ({
  load: load === null ? null : { value: load.value, unit: load.unit ?? 'kg', convention: load.convention ?? 'total' },
  reps,
  durationS: null,
  rpe: 8,
  rir: null,
  ...over,
});

const set = (exerciseRow: number, index: number, setType: SetType, p: PlannedSet, rest: { seconds: number; source: string } = { seconds: 120, source: 'global_default' }): PlannedSetSource => ({
  sessionExerciseId: id(exerciseRow),
  index,
  setType,
  status: 'pending',
  pairedWithSetId: null,
  planned: p,
  rest,
});

const SQUAT = id(101);
const BENCH = id(102);

const checkedOn = (equipmentId: string | null, unit: WeightUnit, convention: LoadConvention): CheckedOnRecord | null => (equipmentId === null ? null : { equipmentId, kind: 'barbell', convention, unit, barKg: 20 });

function convert(exercises: PlannedExerciseSource[], sets: PlannedSetSource[], opts: { main?: string | null; holds?: (id: string) => boolean } = {}) {
  return plannedAsDraftPlan({ exercises, sets, mainExerciseId: opts.main ?? null, holds: opts.holds ?? (() => true), slotKey: (n) => id(9000 + n), catalogueIdOf: (x) => x, checkedOnOf: checkedOn });
}

describe('plannedAsDraftPlan', () => {
  it('keeps the saved 5 × (3–6) at 100 kg as five working sets, not a top set and back-offs; reps, RPE and the item stand', () => {
    const sets = [0, 1, 2, 3, 4].map((i) => set(1, i, 'working', planned({ value: 100 }, { min: 3, max: 6 }, { provenance: { source: 'rule', setAt: { utc: '2026-10-05T07:00:00.000Z', tz: 'Europe/London' }, routineName: null, requestedLoad: null, basis: null, guardNotes: [] } })));
    const r = convert([ex(1, SQUAT)], sets, { main: SQUAT });
    expect(r.leftOut).toEqual([]);
    expect(DraftPlanSchema.safeParse(r.plan).success).toBe(true);
    const slot = r.plan.slots[0];
    expect(slot?.main).toBe(true);
    expect(slot?.setTemplates.map((t) => [t.setType, t.reps, t.load?.load?.value])).toEqual(Array.from({ length: 5 }, () => ['working', { min: 3, max: 6 }, 100]));
    expect(slot?.builder).toMatchObject({ source: 'rule', repRange: { min: 3, max: 6 }, unit: 'kg', convention: 'total' });
    expect(slot?.checkedOn).toMatchObject({ equipmentId: id(501) });
    // The builder reads it back as five working rows (nothing added, nothing rebuilt).
    const w = fromDraftPlan(r.plan);
    expect(slotsOf(w.blocks)[0]?.rows.map((x) => [x.type, x.load])).toEqual(Array.from({ length: 5 }, () => ['working', 100]));
  });

  it('a Fixed load, a drop set and warm-ups stay as saved; a saved load is named `saved`, not the built-in rule', () => {
    const sets = [
      set(1, 0, 'warmup', planned({ value: 20 }, { min: 10, max: 10 }, { rpe: null })),
      set(1, 1, 'working', planned({ value: 60 }, { min: 8, max: 8 }, { provenance: { source: 'plan', setAt: { utc: '2026-10-05T07:00:00.000Z', tz: 'Europe/London' }, routineName: 'Push A', requestedLoad: null, basis: null, guardNotes: [] } })),
      set(1, 2, 'drop', planned({ value: 45 }, { min: 10, max: 12 })),
    ];
    const r = convert([ex(1, BENCH)], sets);
    const t = r.plan.slots[0]?.setTemplates ?? [];
    expect(t.map((x) => x.setType)).toEqual(['warmup', 'working', 'drop']);
    expect(t[0]?.targetRpe).toBeNull();
    expect(t.map((x) => x.load?.load?.value)).toEqual([20, 60, 45]);
    expect(r.plan.slots[0]?.builder?.source).toBe('saved');
    expect(DraftPlanSchema.safeParse(r.plan).success).toBe(true);
  });

  it('lb loads and per-hand dumbbells keep their unit and convention; an assisted machine keeps assistance', () => {
    const r = convert(
      [ex(1, 'db_press', { unit: 'lb', loadConvention: 'per_hand' }), ex(2, 'assisted_pullup', { loadConvention: 'assistance' })],
      [set(1, 0, 'working', planned({ value: 50, unit: 'lb', convention: 'per_hand' }, { min: 8, max: 10 })), set(2, 0, 'working', planned({ value: 25, convention: 'assistance' }, { min: 6, max: 8 }))],
    );
    expect(r.plan.slots.map((s) => [s.builder?.unit, s.builder?.convention, s.setTemplates[0]?.load?.load])).toEqual([
      ['lb', 'per_hand', { value: 50, unit: 'lb', convention: 'per_hand' }],
      ['kg', 'assistance', { value: 25, unit: 'kg', convention: 'assistance' }],
    ]);
  });

  it('(22 Oct) holds cardio, a timed set and a second copy as saved: time and distance with no reps, each copy its own slot; the pair stays a pair', () => {
    const [ROWER, PLANK, ROW, SKI] = [id(103), id(104), id(105), id(106)];
    const r = convert(
      [ex(1, ROWER, { loadConvention: 'bodyweight' }), ex(2, BENCH, { supersetGroup: 'A' }), ex(3, PLANK, { supersetGroup: 'A', loadConvention: 'bodyweight' }), ex(4, ROW), ex(5, BENCH), ex(6, SKI, { loadConvention: 'bodyweight' })],
      [
        set(1, 0, 'working', planned(null, null, { durationS: 600, distanceM: 2000, rpe: null })),
        set(2, 0, 'working', planned({ value: 60 }, { min: 8, max: 8 })),
        set(3, 0, 'working', planned(null, null, { durationS: 45 })),
        set(3, 1, 'working', planned(null, null, { durationS: 45 })),
        set(4, 0, 'working', planned({ value: 50 }, { min: 10, max: 10 })),
        set(5, 0, 'working', planned({ value: 50 }, { min: 10, max: 10 })),
        set(6, 0, 'working', planned(null, null, { distanceM: 1000, rpe: null })),
      ],
    );
    expect(r.leftOut).toEqual([]);
    expect(DraftPlanSchema.safeParse(r.plan).error?.issues).toBeUndefined();
    expect(r.plan.slots.map((s) => [s.exerciseId, s.supersetGroup])).toEqual([
      [ROWER, null],
      [BENCH, 'A'],
      [PLANK, 'A'],
      [ROW, null],
      [BENCH, null],
      [SKI, null],
    ]);
    const t = (i: number) => r.plan.slots[i]?.setTemplates.map((x) => ({ reps: x.reps, durationS: x.durationS, distanceM: x.distanceM }));
    expect(t(0)).toEqual([{ reps: null, durationS: 600, distanceM: 2000 }]);
    expect(t(2)).toEqual([
      { reps: null, durationS: 45, distanceM: undefined },
      { reps: null, durationS: 45, distanceM: undefined },
    ]);
    expect(t(5)).toEqual([{ reps: null, durationS: null, distanceM: 1000 }]);
    // Two copies of bench: two slots, each with its own sets and key.
    expect(r.plan.slots.filter((s) => s.exerciseId === BENCH).map((s) => s.slotKey)).toEqual([id(9001), id(9004)]);
    // Read back: the rows keep their time and distance (no reps target), so a re-encode stores them as saved.
    const w = fromDraftPlan(r.plan);
    const rows = slotsOf(w.blocks).map((s) => s.rows.map((x) => [x.durationS, x.distanceM]));
    expect(rows[0]).toEqual([[600, 2000]]);
    expect(rows[2]).toEqual([
      [45, undefined],
      [45, undefined],
    ]);
    expect(rows[5]).toEqual([[undefined, 1000]]);
  });

  it('still leaves out and names what it can’t hold: an exercise it doesn’t know, a set with no target; a partner left alone is solo', () => {
    const r = convert(
      [ex(1, 'gone'), ex(2, 'bench', { supersetGroup: 'A' }), ex(3, 'mystery', { supersetGroup: 'A' }), ex(4, 'row')],
      [
        set(1, 0, 'working', planned({ value: 10 }, { min: 8, max: 8 })),
        set(2, 0, 'working', planned({ value: 60 }, { min: 8, max: 8 })),
        set(3, 0, 'working', planned(null, null)),
        set(4, 0, 'working', planned({ value: 50 }, { min: 10, max: 10 })),
      ],
      { holds: (x) => x !== 'gone' },
    );
    expect(r.leftOut).toEqual(['gone', 'mystery']);
    expect(r.plan.slots.map((s) => [s.exerciseId, s.supersetGroup])).toEqual([
      ['bench', null],
      ['row', null],
    ]);
  });

  it('keeps Ben’s own rests (clamped to the builder’s limits); default rests stay the builder’s', () => {
    const r = convert(
      [ex(1, 'bench'), ex(2, 'fly')],
      [set(1, 0, 'working', planned({ value: 60 }, { min: 8, max: 8 }), { seconds: 600, source: 'routine_set_type' }), set(2, 0, 'working', planned({ value: 10 }, { min: 12, max: 12 }), { seconds: 90, source: 'global_default' })],
    );
    expect(r.plan.slots[0]?.builder?.restS).toEqual({ working: 360 });
    expect(r.plan.slots[0]?.setTemplates[0]?.restS).toBe(360);
    expect(r.plan.slots[1]?.builder?.restS).toBeUndefined();
    expect(r.plan.slots[1]?.setTemplates[0]?.restS).toBeNull();
  });

  it('skipped, deleted and other-side companion sets aren’t planned; an exercise past the limits is left out', () => {
    const base = [0, 1].map((i) => set(1, i, 'working', planned({ value: 60 }, { min: 8, max: 8 })));
    const skipped = { ...set(1, 2, 'working', planned({ value: 60 }, { min: 8, max: 8 })), status: 'skipped' };
    const companion = { ...set(1, 3, 'working', planned({ value: 60 }, { min: 8, max: 8 })), pairedWithSetId: id(1) };
    const many = Array.from({ length: 11 }, (_, i) => set(2, i, 'working', planned({ value: 10 }, { min: 12, max: 12 })));
    const r = convert([ex(1, 'bench'), ex(2, 'curl')], [...base, skipped, companion, ...many]);
    expect(r.plan.slots[0]?.setTemplates).toHaveLength(2);
    expect(r.leftOut).toEqual(['curl']);
  });

  it('builderSourceOfPlanned: coach → coach target, rule → rule, the routine’s own or last time’s → saved, no load → none', () => {
    expect(builderSourceOfPlanned('coach', true)).toBe('coach_target');
    expect(builderSourceOfPlanned('rule', true)).toBe('rule');
    expect(builderSourceOfPlanned('plan', true)).toBe('saved');
    expect(builderSourceOfPlanned('repeat', true)).toBe('saved');
    expect(builderSourceOfPlanned(undefined, true)).toBe('saved');
    expect(builderSourceOfPlanned('rule', false)).toBe('none');
  });
});
