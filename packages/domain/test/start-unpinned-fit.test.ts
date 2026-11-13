import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, Load, SessionAggregate, SetTemplate } from '@fizz/schemas';
import { planRoutineStart, startWorkout, startWorkoutFromSession } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, logCmd, setsFor } from './session-fixture';

/**
 * Retire-overview O1 (rule 4): a workout saved with no item on an exercise whose loads need one (a pushdown Fixed at
 * 400 kg with no stack named) is planned by the shared planner on this gym's item for the exercise's kinds, so every
 * path that plans it (Start, `routines.planned`, Repeat) rounds down and never goes past the item's max.
 */

const PUSHDOWN = exercise(230, 'Triceps pushdown', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const BENCH = exercise(231, 'Bench press');
const DB_PRESS = exercise(232, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const PULLUP = exercise(233, 'Pull-up', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const ASSISTED = exercise(234, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });

function startOne(ex: Exercise, loads: (Load | null)[], gymEquipment: EquipmentInstance[], opts: { lastUsedHere?: string; preferredUnit?: 'kg' | 'lb' } = {}) {
  const templates: SetTemplate[] = loads.map((l, i) => template(7000 + i, { targetLoad: l, targetReps: { min: 10, max: 12 } }));
  const r = routine([routineExercise(700, { exerciseId: ex.id, equipmentId: null, setTemplates: templates })]);
  return startWorkout({
    opId: 'start-o1',
    owner: profile({ preferredUnit: opts.preferredUnit ?? 'kg' }),
    gymId: GYM,
    routine: r,
    exercises: new Map([[ex.id, ex]]),
    gymEquipment,
    at: at(0),
    newId: idGen(),
    ...(opts.lastUsedHere !== undefined ? { lastUsedHere: () => opts.lastUsedHere ?? null } : {}),
  });
}

describe('O1: a saved exercise with no item is planned on this gym’s item (rule 4)', () => {
  it('the reviewer’s probe: pushdown Fixed at 400 kg, no item → the stack’s max (50), never 400, on the stack, with a capped note', () => {
    const cable = stack();
    const out = startOne(PUSHDOWN, [kg(400, 'stack'), kg(400, 'stack')], [cable]);
    expect(out.aggregate.exercises[0]).toMatchObject({ equipmentId: cable.id, loadConvention: 'stack', unit: 'kg' });
    const sets = out.aggregate.sets;
    expect(sets.map((s) => s.planned.load)).toEqual([kg(50, 'stack'), kg(50, 'stack')]);
    for (const s of sets) expect(s.planned.snap).toMatchObject({ outcome: 'capped', intended: kg(400, 'stack'), equipmentId: cable.id });
    expect(out.warnings.map((w) => (w.kind === 'target_rounded' ? [w.setTemplateId, w.bounded] : [w.kind]))).toEqual(sets.map((s) => [out.setTemplateIds[s.id], 'max']));
    // Never extrapolated: no planned load anywhere is above the item's max.
    expect(sets.every((s) => (s.planned.load?.value ?? 0) <= 50)).toBe(true);
  });

  it('a Fixed bench load the plates can’t make is rounded down on this gym’s bar (61.3 → 60, never up to 62.5)', () => {
    const bar = barbell();
    const out = startOne(BENCH, [kg(61.3)], [bar]);
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(bar.id);
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(60));
  });

  it('kg per-hand dumbbells on an lb rack: converted and rounded toward easier (22.5 kg each ≈ 49.6 lb → 45 lb each)', () => {
    const lbRack = dumbbells({ unit: 'lb', loads: [10, 20, 30, 40, 45, 50] });
    const out = startOne(DB_PRESS, [kg(22.5, 'per_hand')], [lbRack]);
    expect(out.aggregate.exercises[0]).toMatchObject({ equipmentId: lbRack.id, unit: 'lb', loadConvention: 'per_hand' });
    expect(out.aggregate.sets[0]?.planned.load).toEqual(lb(45, 'per_hand'));
  });

  it('per-hand dumbbells past the rack’s heaviest pair are capped at it (45 kg each → 30)', () => {
    const rack = dumbbells();
    const out = startOne(DB_PRESS, [kg(45, 'per_hand')], [rack]);
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(30, 'per_hand'));
    expect(out.aggregate.sets[0]?.planned.snap?.outcome).toBe('capped');
  });

  it('assisted: more assistance than the machine gives is dropped (never made harder), reps kept', () => {
    const machine = assisted();
    const out = startOne(ASSISTED, [kg(60, 'assistance')], [machine]);
    const set = out.aggregate.sets[0];
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(machine.id);
    expect(set?.planned.load).toBeNull();
    expect(set?.planned.reps).toEqual({ min: 10, max: 12 });
    expect(set?.planned.snap).toMatchObject({ outcome: 'dropped', reason: 'lightest_is_harder' });
  });

  it('the item this exercise last used here wins over the first stack of its kind (GS3 step 2)', () => {
    const first = stack({ id: id(7801), name: 'Cable A', stackLoads: [5, 10, 15, 20] });
    const second = stack({ id: id(7802), name: 'Cable B', stackLoads: [10, 20, 30, 40, 50, 60, 70, 80] });
    expect(startOne(PUSHDOWN, [kg(400, 'stack')], [first, second]).aggregate.sets[0]?.planned.load).toEqual(kg(20, 'stack'));
    const out = startOne(PUSHDOWN, [kg(400, 'stack')], [first, second], { lastUsedHere: second.id });
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(second.id);
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(80, 'stack'));
  });

  it('none of its kinds at this gym: no load target (reps kept, a note), never the unchecked 400', () => {
    const out = startOne(PUSHDOWN, [kg(400, 'stack')], [barbell()]);
    const set = out.aggregate.sets[0];
    expect(out.aggregate.exercises[0]?.equipmentId).toBeNull();
    expect(set?.planned.load).toBeNull();
    expect(set?.planned.reps).toEqual({ min: 10, max: 12 });
    expect(out.warnings).toEqual([expect.objectContaining({ kind: 'target_dropped', requested: kg(400, 'stack'), reason: 'equipment_not_in_gym' })]);
  });

  it('unchanged: bodyweight work needs no item, and a slot with no load target isn’t given one', () => {
    const bar = barbell();
    const pull = startOne(PULLUP, [null], [bar, stack()]);
    expect(pull.aggregate.exercises[0]).toMatchObject({ equipmentId: null, loadConvention: 'bodyweight' });
    const noLoad = startOne(PUSHDOWN, [null, null], [stack()]);
    expect(noLoad.aggregate.exercises[0]?.equipmentId).toBeNull();
    expect(noLoad.aggregate.sets.every((s) => s.planned.load === null)).toBe(true);
  });

  it('routines.planned’s planner (`planRoutineStart`) plans the same cap as Start', () => {
    const cable = stack();
    const r = routine([routineExercise(710, { exerciseId: PUSHDOWN.id, equipmentId: null, setTemplates: [template(7100, { targetLoad: kg(400, 'stack'), targetReps: { min: 10, max: 12 } })] })]);
    const out = planRoutineStart({ opId: 'plan-o1', owner: profile(), gymId: GYM, routine: { ...r, source: 'ben' }, exercises: new Map([[PUSHDOWN.id, PUSHDOWN]]), gymEquipment: [cable], knownEquipment: new Map(), at: at(0), newId: idGen(20_000) });
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(cable.id);
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(50, 'stack'));
    expect(out.notes.length).toBeGreaterThan(0);
  });

  it('Repeat of a workout logged with no item: last time’s 400 is capped at this gym’s stack (same shared planner)', () => {
    // Logged with no item (as an older app version or a custom row allowed): 400 kg on the stack.
    const logged = startWorkout({ opId: 'src', owner: profile(), gymId: GYM, routine: routine([routineExercise(720, { exerciseId: PUSHDOWN.id, equipmentId: null, setTemplates: [template(7200, { targetLoad: null, targetReps: { min: 10, max: 10 } })] })]), exercises: new Map([[PUSHDOWN.id, PUSHDOWN]]), gymEquipment: [], at: at(0), newId: idGen(30_000) }).aggregate;
    let s: SessionAggregate = apply(logged, logCmd(setsFor(logged, PUSHDOWN.id)[0]?.id ?? '', values(kg(400, 'stack'), 10), 60));
    s = apply(s, { type: 'finish', at: at(300), opId: 'fin-o1', expectedVersion: s.session.version, endedAt: null });
    expect(s.exercises[0]?.equipmentId).toBeNull();
    const cable = stack();
    const out = startWorkoutFromSession({ opId: 'rep-o1', owner: profile(), gymId: GYM, source: s, exercises: new Map([[PUSHDOWN.id, PUSHDOWN]]), gymEquipment: [cable], at: at(86_400), newId: idGen(31_000) });
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(cable.id);
    expect(setsFor(out.aggregate, PUSHDOWN.id)[0]?.planned.load).toEqual(kg(50, 'stack'));
  });

  it('idempotent: the same start twice plans the same item and loads', () => {
    const cable = stack();
    const a = startOne(PUSHDOWN, [kg(400, 'stack')], [cable]);
    const b = startOne(PUSHDOWN, [kg(400, 'stack')], [cable]);
    expect(b.aggregate.sets.map((s) => s.planned)).toEqual(a.aggregate.sets.map((s) => s.planned));
  });
});
