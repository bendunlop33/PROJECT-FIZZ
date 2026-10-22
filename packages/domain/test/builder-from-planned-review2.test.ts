import { describe, expect, it } from 'vitest';
import { DraftSetTemplateSchema, DraftSlotBuilderSchema, type DraftPlan, type PlannedSet, type TargetProvenance } from '@fizz/schemas';
import {
  editSetRow,
  fromDraftPlan,
  plannedAsDraftPlan,
  plannedWhyLines,
  PLANNED_HELD_LINE,
  reloadSlotLoads,
  slotAtNewGym,
  slotsOf,
  toDraftPlan,
  type BuilderSlot,
  type DraftCodecContext,
} from '../src/index';
import { info, loadInput } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * Re-review of the Workout overview's retirement (docs/reviews/retire-workout-overview.md):
 * - R1: a saved rep range (3–6) survives Your workout's codec, so Start plans the range Ben saved; a reps edit fixes it.
 * - R2: `Gym changed` on a saved workout takes the planner's loads at the new gym, keeping Ben's edits.
 * - R3: held and capped loads keep their reason; Ben's own rule is explained by its own line.
 */

const AT = { utc: '2026-10-05T07:00:00.000Z', tz: 'Europe/London' };
const prov = (over: Partial<TargetProvenance>): TargetProvenance => ({ source: 'plan', setAt: AT, routineName: null, requestedLoad: null, basis: null, guardNotes: [], ...over });
const planned = (value: number | null, reps: { min: number; max: number }, over: Partial<PlannedSet> = {}): PlannedSet => ({ load: value === null ? null : { value, unit: 'kg', convention: 'total' }, reps, durationS: null, rpe: 8, rir: null, ...over });
const codec: DraftCodecContext = { info, catalogueIdOf: (e) => e, checkedOnOf: () => null };

/** The stored parts these fixes write (the fixture's exercise IDs aren't UUIDs). */
function expectValid(plan: DraftPlan): void {
  for (const slot of plan.slots) {
    expect(DraftSlotBuilderSchema.safeParse({ ...slot.builder, origin: id(1) }).error?.issues ?? []).toEqual([]);
    for (const t of slot.setTemplates) expect(DraftSetTemplateSchema.safeParse(t).error?.issues ?? []).toEqual([]);
  }
}

function open(sets: PlannedSet[], exerciseId = 'bench') {
  return plannedAsDraftPlan({
    exercises: [{ id: id(1), exerciseId, order: 0, supersetGroup: null, equipmentId: null, unit: 'kg', loadConvention: 'total' }],
    sets: sets.map((p, i) => ({ sessionExerciseId: id(1), index: i, setType: 'working' as const, status: 'pending', pairedWithSetId: null, planned: p, rest: { seconds: 120, source: 'global_default' } })),
    mainExerciseId: exerciseId,
    holds: () => true,
    slotKey: (n) => id(9000 + n),
    catalogueIdOf: (x) => x,
    checkedOnOf: () => null,
  }).plan;
}

describe('R1: a saved rep range survives Your workout', () => {
  it('5 × (3–6) @ 100 reads as 3–6 rows; any edit re-encodes the range, not 3 × 3; a reps edit fixes that one set', () => {
    const plan = open([0, 1, 2, 3, 4].map(() => planned(100, { min: 3, max: 6 })));
    const w = fromDraftPlan(plan);
    const squat = slotsOf(w.blocks)[0] as BuilderSlot;
    expect(squat.rows.map((r) => [r.reps, r.repsMax])).toEqual(Array.from({ length: 5 }, () => [3, 6]));
    // Round trip (what any edit on the page does to every slot).
    const again = toDraftPlan(w, codec);
    expect(again.slots[0]?.setTemplates.map((t) => t.reps)).toEqual(Array.from({ length: 5 }, () => ({ min: 3, max: 6 })));
    expectValid(again);
    // Ben sets reps on set 2: that set is his number; the others keep the range.
    const e = editSetRow(squat, 1, { kind: 'reps', reps: 5 }, loadInput());
    if (!e.ok) throw new Error(e.reason);
    expect(e.slot.rows.map((r) => [r.reps, r.repsMax ?? null])).toEqual([[3, 6], [5, null], [3, 6], [3, 6], [3, 6]]);
    const enc = toDraftPlan({ ...w, blocks: [{ slots: [e.slot], auto: false }] }, codec);
    expect(enc.slots[0]?.setTemplates.map((t) => t.reps)).toEqual([{ min: 3, max: 6 }, { min: 5, max: 5 }, { min: 3, max: 6 }, { min: 3, max: 6 }, { min: 3, max: 6 }]);
  });

  it('fixed reps stay fixed (no repsMax)', () => {
    const w = fromDraftPlan(open([planned(60, { min: 8, max: 8 })]));
    expect(slotsOf(w.blocks)[0]?.rows[0]?.repsMax).toBeUndefined();
  });
});

describe('R3: why a planned load is what it is', () => {
  it('held on pain and capped at the machine’s max keep their reason through the codec; Ben’s own rule names its own line', () => {
    const capped = planned(90, { min: 8, max: 10 }, {
      provenance: prov({ source: 'rule', held: true, rule: { name: 'Double progression', decision: 'hold', summary: 'Hold 90 kg until 3 × 10.', facts: [] } }),
      snap: { intended: { value: 120, unit: 'kg', convention: 'total' }, intendedOn: null, outcome: 'capped', equipmentId: id(77), gymId: id(78), by: 'start' },
    });
    const lines = plannedWhyLines(capped);
    expect(lines[0]).toBe('Hold 90 kg until 3 × 10');
    expect(lines).toContain(PLANNED_HELD_LINE);
    expect(lines.some((l) => l.startsWith('Max here'))).toBe(true);
    const plan = open([capped, capped]);
    expect(plan.slots[0]?.builder?.why).toEqual(lines);
    expect(plan.slots[0]?.setTemplates.every((t) => t.load?.held === true)).toBe(true);
    // Round trip keeps it (any edit on the page re-encodes every slot).
    const again = toDraftPlan(fromDraftPlan(plan), codec);
    expect(again.slots[0]?.builder?.why).toEqual(lines);
    expect(again.slots[0]?.setTemplates.map((t) => [t.load?.held, t.load?.notes])).toEqual(plan.slots[0]?.setTemplates.map((t) => [t.load?.held, t.load?.notes]));
    expectValid(again);
  });

  it('a saved load reads `Saved workout`; a coach target `Coach target`; a rounded fit adds `Rounded down`; no load, no source line', () => {
    expect(plannedWhyLines(planned(60, { min: 8, max: 8 }))).toEqual(['Saved workout']);
    expect(plannedWhyLines(planned(60, { min: 8, max: 8 }, { provenance: prov({ source: 'coach' }) }))).toEqual(['Coach target']);
    expect(plannedWhyLines(planned(60, { min: 8, max: 8 }, { snap: { intended: { value: 61, unit: 'kg', convention: 'total' }, intendedOn: null, outcome: 'rounded', equipmentId: null, gymId: null, by: 'start' } }))).toEqual(['Saved workout', 'Rounded down']);
    expect(plannedWhyLines(planned(null, { min: 8, max: 8 }, { snap: { intended: { value: 61, unit: 'kg', convention: 'total' }, intendedOn: null, outcome: 'dropped', reason: 'pain_flag', equipmentId: null, gymId: null, by: 'start' } }))).toEqual([PLANNED_HELD_LINE]);
  });

  it('the builder working the loads out again (gym change) drops the reasons', () => {
    const slot = slotsOf(fromDraftPlan(open([planned(90, { min: 8, max: 10 }, { provenance: prov({ held: true }) })])).blocks)[0] as BuilderSlot;
    expect(slot.why).toBeDefined();
    expect(reloadSlotLoads(slot, { role: 'compound', barbell: true }, loadInput()).why).toBeUndefined();
  });
});

describe('R2: a saved workout at a new gym', () => {
  const at = (load: number, reps = { min: 8, max: 8 }) => slotsOf(fromDraftPlan(open([planned(load, reps), planned(load, reps)])).blocks)[0] as BuilderSlot;

  it('not edited: the planner’s slot at the new gym, with the draft’s key', () => {
    const slot = at(42.5);
    const there = { ...at(40), key: 'other-key', why: ['Saved workout', 'Max here'] };
    const base = { ...slot, rows: slot.rows.map((r) => ({ ...r, load: 77 })) };
    const r = slotAtNewGym(slot, there, base);
    expect(r.fromPlanned).toBe(true);
    expect(r.slot.key).toBe(slot.key);
    expect(r.slot.rows.map((x) => x.load)).toEqual([40, 40]);
    expect(r.slot.why).toEqual(['Saved workout', 'Max here']);
  });

  it('edited: Ben’s rows (an extra set, his reps) with the planner’s loads by type and position; the extra set takes the builder’s; a kg he typed that exists there stays', () => {
    const slot: BuilderSlot = { ...at(42.5), touched: true };
    slot.rows = [...slot.rows, { type: 'working', reps: 6, load: 42.5, rpe: 8 }];
    slot.rows[0] = { ...(slot.rows[0] ?? { type: 'working', reps: 8, load: 42.5, rpe: 8 }), reps: 10 };
    slot.rows[1] = { ...(slot.rows[1] ?? { type: 'working', reps: 8, load: 42.5, rpe: 8 }), load: 50, typed: true };
    const there = at(40);
    const base: BuilderSlot = { ...slot, rows: [{ type: 'working', reps: 10, load: 77, rpe: 8 }, { type: 'working', reps: 8, load: 50, rpe: 8, typed: true }, { type: 'working', reps: 6, load: 70, rpe: 8 }] };
    const r = slotAtNewGym(slot, there, base);
    expect(r.fromPlanned).toBe(true);
    expect(r.slot.rows.map((x) => [x.reps, x.load, x.typed ?? false])).toEqual([[10, 40, false], [8, 50, true], [6, 70, false]]);
  });

  it('a planned slot in another unit or convention than the builder’s: the builder’s reload stands', () => {
    const slot: BuilderSlot = { ...at(42.5), touched: true };
    const there: BuilderSlot = { ...at(90), unit: 'lb' };
    const r = slotAtNewGym(slot, there, slot);
    expect(r).toEqual({ slot, fromPlanned: false });
  });
});
