import { describe, expect, it } from 'vitest';

import type { PlannedSet, RoutineExercise } from '@fizz/schemas';

import {
  addExercise,
  defaultSlotShape,
  editorSummaryLine,
  EFFORT_CHOICES,
  setSlotReps,
  setSlotTargetRpe,
  setWarmupCount,
  setWorkingSetCount,
  shapeAddPlan,
  slotShapeOf,
  workingSetTotal,
  type PlannedEntry,
} from '../src/index';
import { exercise, idGen, kg, lb, routineExercise, template } from './fixtures';

/**
 * `Sets [−] 3 [+]` everywhere an exercise is planned (exercise-library §10,
 * routines WL11): the default shape, the editor's steppers, warm-ups apart,
 * reps and target RPE for the plain working sets (`Mixed`), and the plan for
 * an exercise added to a running workout (only its own new sets; rule 2).
 */

const NB = ' ';
const BENCH = exercise(1, 'Bench press', { movementPattern: 'horizontal_push', mechanic: 'compound', family: 'bench_press' });
const FLY = exercise(2, 'Cable fly', { movementPattern: 'horizontal_push', mechanic: 'isolation', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const ROW = exercise(3, 'One-arm dumbbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
const PLANK = exercise(4, 'Plank', { movementPattern: 'core', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', measurement: 'duration' });
const PULLUP = exercise(5, 'Assisted pull-up', { movementPattern: 'vertical_pull', mechanic: 'compound', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });

describe('defaultSlotShape (§10.1)', () => {
  it('3 working sets, no warm-ups, the built-in rule’s reps for the exercise, no target RPE; timed is 0:45', () => {
    expect(defaultSlotShape(BENCH)).toEqual({ workingSets: 3, warmups: 0, reps: { min: 3, max: 6 }, durationS: null, targetRpe: null });
    expect(defaultSlotShape(FLY).reps).toEqual({ min: 8, max: 12 });
    expect(defaultSlotShape(ROW).reps).toEqual({ min: 6, max: 10 });
    expect(defaultSlotShape(PULLUP).reps).toEqual({ min: 6, max: 10 });
    expect(defaultSlotShape(PLANK)).toMatchObject({ reps: null, durationS: 45 });
  });

  it('the bar’s count is used and clamped to 1–10', () => {
    expect(defaultSlotShape(BENCH, { workingSets: 4 }).workingSets).toBe(4);
    expect(defaultSlotShape(BENCH, { workingSets: 0 }).workingSets).toBe(1);
    expect(defaultSlotShape(BENCH, { workingSets: 14 }).workingSets).toBe(10);
  });
});

describe('editor: addExercise with a shape (EL-B17, EL-B20)', () => {
  it('adds N working sets with the shape’s reps and RPE, warm-ups before them, loads Auto', () => {
    const list = addExercise([], { id: FLY.id, measurement: 'reps' }, idGen(), { ...defaultSlotShape(FLY, { workingSets: 4 }), warmups: 1, targetRpe: 8 });
    const sets = list[0]?.setTemplates ?? [];
    expect(sets.map((t) => t.setType)).toEqual(['warmup', 'working', 'working', 'working', 'working']);
    expect(sets.filter((t) => t.setType === 'working').every((t) => t.targetReps?.min === 8 && t.targetReps.max === 12 && t.targetRpe === 8 && t.targetLoad === null)).toBe(true);
    expect(new Set(sets.map((t) => t.id)).size).toBe(sets.length);
    const timed = addExercise([], { id: PLANK.id, measurement: 'duration' }, idGen(), defaultSlotShape(PLANK, { workingSets: 2 }));
    expect(timed[0]?.setTemplates.map((t) => [t.targetReps, t.targetDurationS])).toEqual([[null, 45], [null, 45]]);
  });

  it('without a shape it is the old three `Auto × 8–10` (callers that don’t pass one are unchanged)', () => {
    const list = addExercise([], { id: BENCH.id, measurement: 'reps' }, idGen());
    expect(list[0]?.setTemplates.map((t) => t.targetReps)).toEqual([{ min: 8, max: 10 }, { min: 8, max: 10 }, { min: 8, max: 10 }]);
  });
});

function slot(sets: Parameters<typeof template>[1][], n = 600): RoutineExercise {
  return routineExercise(n, { exerciseId: BENCH.id, setTemplates: sets.map((s, i) => template(n * 10 + i, s)) });
}

describe('Sets / Warm-ups steppers (§10.5, EL-B17, EL-B18)', () => {
  it('+ appends copies of the last non-warm-up set (not its own rest), − removes from the end; warm-ups are never counted', () => {
    const s = slot([{ setType: 'warmup', targetLoad: kg(60) }, { targetLoad: kg(100), targetReps: { min: 6, max: 8 }, targetRpe: 8, restOverrideS: 240 }]);
    let list = setWorkingSetCount([s], s.id, 3, idGen());
    const after = list[0]?.setTemplates ?? [];
    expect(after.map((t) => t.setType)).toEqual(['warmup', 'working', 'working', 'working']);
    expect(after.slice(2).every((t) => t.targetLoad?.value === 100 && t.targetRpe === 8 && t.restOverrideS === null)).toBe(true);
    expect(slotShapeOf(list[0] as RoutineExercise)).toMatchObject({ workingSets: 3, warmups: 1, setsDown: 2, setsUp: 4 });
    list = setWorkingSetCount(list, s.id, 1, idGen());
    expect(list[0]?.setTemplates.map((t) => t.id)).toEqual([s.setTemplates[0]?.id, s.setTemplates[1]?.id]);
    expect(slotShapeOf(list[0] as RoutineExercise).setsDown).toBeNull();
  });

  it('limits: 1–10 working, 0–5 warm-ups; a slot already above 10 may only go down; other sets never reorder', () => {
    const big = slot(Array.from({ length: 12 }, () => ({})));
    expect(slotShapeOf(big)).toMatchObject({ workingSets: 12, setsUp: null, setsDown: 11 });
    expect(setWorkingSetCount([big], big.id, 13, idGen())[0]?.setTemplates).toHaveLength(12);
    expect(setWorkingSetCount([big], big.id, 11, idGen())[0]?.setTemplates).toHaveLength(11);
    const s = slot([{}]);
    expect(setWorkingSetCount([s], s.id, 0, idGen())[0]?.setTemplates).toHaveLength(1);
    expect(setWorkingSetCount([s], s.id, 25, idGen())[0]?.setTemplates).toHaveLength(10);
    let w = setWarmupCount([s], s.id, 9, 'reps', idGen());
    expect(slotShapeOf(w[0] as RoutineExercise)).toMatchObject({ warmups: 5, warmupsUp: null, workingSets: 1 });
    w = setWarmupCount(w, s.id, 0, 'reps', idGen());
    expect(w[0]?.setTemplates).toEqual(s.setTemplates);
  });

  it('a new warm-up goes before the first working set, as `Auto × 5` when there is none to copy', () => {
    const s = slot([{}, {}]);
    const out = setWarmupCount([s], s.id, 1, 'reps', idGen())[0]?.setTemplates ?? [];
    expect(out[0]).toMatchObject({ setType: 'warmup', targetLoad: null, targetReps: { min: 5, max: 5 } });
    expect(out.slice(1)).toEqual(s.setTemplates);
  });

  it('only the edited slot changes', () => {
    const a = slot([{}], 600);
    const b = slot([{}], 601);
    const out = setWorkingSetCount([a, b], a.id, 4, idGen());
    expect(out[1]).toBe(b);
  });
});

describe('Reps and Target RPE (§10.5, EL-B19)', () => {
  it('plain working sets change together; a top/back-off slot reads Mixed; RIR clears RPE', () => {
    const s = slot([{ setType: 'warmup', targetReps: { min: 5, max: 5 } }, { setType: 'top', targetReps: { min: 4, max: 6 } }, { setType: 'backoff', targetReps: { min: 6, max: 8 } }, { setType: 'backoff', targetReps: { min: 6, max: 8 } }]);
    expect(slotShapeOf(s)).toMatchObject({ workingSets: 3, warmups: 1, reps: 'mixed', hasSpecialSets: true });
    const plainSlot = slot([{ targetReps: { min: 8, max: 10 } }, { targetReps: { min: 8, max: 10 } }], 700);
    let list = setSlotReps([plainSlot], plainSlot.id, { reps: { min: 6, max: 8 } });
    list = setSlotTargetRpe(list, plainSlot.id, 8);
    expect(slotShapeOf(list[0] as RoutineExercise)).toMatchObject({ reps: { min: 6, max: 8 }, targetRpe: 8, hasSpecialSets: false });
    list = setSlotTargetRpe(list, plainSlot.id, 2, 'rir');
    expect(slotShapeOf(list[0] as RoutineExercise)).toMatchObject({ targetRpe: null, targetRir: 2 });
    const mixed = slot([{ setType: 'top', targetReps: { min: 4, max: 6 } }, { targetReps: { min: 8, max: 10 } }], 800);
    // Plain working sets only: the top set keeps its own reps.
    const changed = setSlotReps([mixed], mixed.id, { reps: { min: 10, max: 12 } })[0]?.setTemplates ?? [];
    expect(changed.map((t) => t.targetReps)).toEqual([{ min: 4, max: 6 }, { min: 10, max: 12 }]);
  });

  it('a Fixed load or a set’s own rest opens `Each set` by default; the effort choices are the sheet’s', () => {
    expect(slotShapeOf(slot([{ targetLoad: lb(135) }])).hasSpecialSets).toBe(true);
    expect(slotShapeOf(slot([{ restOverrideS: 90 }])).hasSpecialSets).toBe(true);
    expect(slotShapeOf(slot([{}, {}])).hasSpecialSets).toBe(false);
    expect(EFFORT_CHOICES.rpe).toEqual([6, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
    expect(EFFORT_CHOICES.rir).toEqual([0, 1, 2, 3, 4]);
  });

  it('the summary line counts working sets (`16 sets`), warm-ups left out', () => {
    const list = [slot([{ setType: 'warmup' }, {}, {}], 600), slot([{}, {}, {}], 601)];
    expect(workingSetTotal(list)).toBe(5);
    expect(editorSummaryLine(2, 30, 'Main gym', 5).replaceAll(NB, ' ')).toBe('2 exercises · 5 sets · ≈ 30 min at Main gym');
    expect(editorSummaryLine(1, null, null, 1)).toBe('1 exercise · 1 set');
  });
});

// ---------------------------------------------------------------------------

const planned = (over: Partial<PlannedSet> = {}): PlannedSet => ({ load: null, reps: null, durationS: null, rpe: null, rir: null, ...over });

describe('shapeAddPlan: an exercise added to a running workout (§10.2, EL-B21, EL-B22; rule 2)', () => {
  const history: PlannedEntry[] = [
    { setType: 'working', planned: planned({ load: kg(20, 'stack'), reps: { min: 12, max: 15 }, source: 'built_in_rule' }) },
    { setType: 'working', planned: planned({ load: kg(20, 'stack'), reps: { min: 12, max: 15 }, source: 'built_in_rule' }) },
    { setType: 'working', planned: planned({ load: kg(22.5, 'stack'), reps: { min: 12, max: 15 }, source: 'built_in_rule' }) },
  ];

  it('N pending working sets from its own targets: fewer cut from the end, more copy the last', () => {
    expect(shapeAddPlan(history, { workingSets: 2 }).map((p) => p.planned.load?.value)).toEqual([20, 20]);
    expect(shapeAddPlan(history, { workingSets: 4 }).map((p) => p.planned.load?.value)).toEqual([20, 20, 22.5, 22.5]);
    expect(shapeAddPlan(history, { workingSets: 3 })).toEqual(history);
  });

  it('no plan (empty workout, timed): N empty working sets, never one; no load invented', () => {
    const out = shapeAddPlan(null, { workingSets: 3 });
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.setType === 'working' && p.planned.load === null)).toBe(true);
  });

  it('per-hand and lb loads are copied as they are (never converted); assisted keeps its convention', () => {
    const db: PlannedEntry[] = [{ setType: 'working', planned: planned({ load: lb(45, 'per_hand'), reps: { min: 8, max: 10 } }) }];
    expect(shapeAddPlan(db, { workingSets: 2 }).map((p) => p.planned.load)).toEqual([lb(45, 'per_hand'), lb(45, 'per_hand')]);
    const as: PlannedEntry[] = [{ setType: 'working', planned: planned({ load: kg(30, 'assistance'), reps: { min: 6, max: 10 } }) }];
    expect(shapeAddPlan(as, { workingSets: 3 }).every((p) => p.planned.load?.convention === 'assistance')).toBe(true);
  });

  it('the Library sheet’s warm-ups, reps and target RPE apply to the new sets only', () => {
    const out = shapeAddPlan(history, { workingSets: 3, warmups: 1, reps: { min: 10, max: 12 }, effort: { scale: 'rpe', value: 8 } });
    expect(out.map((p) => p.setType)).toEqual(['warmup', 'working', 'working', 'working']);
    expect(out[0]?.planned).toMatchObject({ load: null, reps: { min: 5, max: 5 } });
    expect(out.slice(1).every((p) => p.planned.reps?.min === 10 && p.planned.rpe === 8 && p.planned.load !== null)).toBe(true);
    // The input isn't mutated.
    expect(history[0]?.planned.rpe).toBeNull();
  });
});
