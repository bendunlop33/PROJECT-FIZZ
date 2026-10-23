import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, Load, SessionAggregate, SetTemplate } from '@fizz/schemas';
import { convertMassExactly, planTemplateLoad, prefillDraft, reduceSession, startWorkout } from '../src/index';
import {
  at,
  barbell,
  dumbbells,
  exercise,
  GYM,
  id,
  idGen,
  kg,
  lb,
  profile,
  routine,
  routineExercise,
  stack,
  template,
  values,
} from './fixtures';
import { expectOk } from './session-fixture';

const BENCH = exercise(210, 'Bench press');
const DB_PRESS = exercise(211, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const LAT = exercise(212, 'Lat pulldown', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const ROW_ANY = exercise(213, 'Row (any)', { compatibleEquipment: ['weight_stack', 'barbell'], defaultLoadConvention: 'total' });

function start(opts: {
  ex: Exercise;
  equipmentId: string | null;
  targetLoad: Load;
  gymEquipment: EquipmentInstance[];
  preferredUnit?: 'kg' | 'lb';
}) {
  const tpl: SetTemplate = template(6001, { targetLoad: opts.targetLoad, targetReps: { min: 8, max: 8 } });
  const r = routine([routineExercise(600, { exerciseId: opts.ex.id, equipmentId: opts.equipmentId, setTemplates: [tpl] })]);
  return startWorkout({
    opId: 'start',
    owner: profile({ preferredUnit: opts.preferredUnit ?? 'kg' }),
    gymId: GYM,
    routine: r,
    exercises: new Map([[opts.ex.id, opts.ex]]),
    gymEquipment: opts.gymEquipment,
    at: at(0),
    newId: idGen(),
  });
}

/** Tap the prefilled Log without editing anything. */
function oneTapLog(state: SessionAggregate, history: { index: number; values: ReturnType<typeof values> }[] = []) {
  const set = state.sets[0];
  if (!set) throw new Error('fixture');
  const draft = prefillDraft(state, set.id, history);
  const result = reduceSession(state, {
    type: 'log_set',
    at: at(30),
    opId: 'log-1',
    setId: set.id,
    values: draft.values,
    restTimerId: id(9_000),
  });
  return { draft, result, set };
}

describe('startWorkout normalises planned loads (review B1)', () => {
  it('row 1: lb template on kg equipment whose conversion lands exactly uses the rounded kg load', () => {
    const bar = barbell();
    const out = start({ ex: BENCH, equipmentId: bar.id, targetLoad: lb(220.462), gymEquipment: [bar] });
    const ex = out.aggregate.exercises[0];
    expect(ex).toMatchObject({ unit: 'kg', loadConvention: 'total' });
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(100));
    expect(out.warnings).toEqual([
      expect.objectContaining({ kind: 'target_rounded', requested: lb(220.462), planned: kg(100), converted: true }),
    ]);
    const { result, draft } = oneTapLog(out.aggregate);
    expect(draft.values.load).toEqual(kg(100));
    expect(expectOk(result).state.sets[0]?.status).toBe('completed');
  });

  // Rows 2/2b: an exercise that lists no equipment kinds (nothing to map an item by), so its load stays unchecked in the
  // slot's own unit (review SP5). An unpinned exercise with kinds is mapped to this gym's item instead (O1, below).
  const NO_KINDS = exercise(215, 'Odd press', { compatibleEquipment: [], defaultLoadConvention: 'total' });

  it('row 2: no equipment, owner prefers lb, kg template that does not convert exactly: no planned load, warned', () => {
    const out = start({ ex: NO_KINDS, equipmentId: null, targetLoad: kg(100), gymEquipment: [], preferredUnit: 'lb' });
    expect(out.aggregate.exercises[0]).toMatchObject({ unit: 'lb', loadConvention: 'total' });
    expect(out.aggregate.sets[0]?.planned.load).toBeNull();
    expect(out.warnings).toEqual([
      { kind: 'target_dropped', setTemplateId: id(6001), requested: kg(100), reason: 'unit_not_convertible' },
    ]);
    // No history: the draft has no load, so Log is disabled ("Enter load"), never a unit_mismatch.
    const empty = oneTapLog(out.aggregate);
    expect(empty.draft.values.load).toBeNull();
    // With lb history the draft falls through to it and the one-tap Log is accepted.
    const withHistory = oneTapLog(out.aggregate, [{ index: 0, values: values(lb(225), 8) }]);
    expect(withHistory.draft.values.load).toEqual(lb(225));
    expect(expectOk(withHistory.result).state.sets[0]?.actual?.load).toEqual(lb(225));
  });

  it('row 2b: no equipment, a template in another unit is dropped even when it converts exactly (gym-switch §6.1 rule 1, as Repeat; review SP5)', () => {
    const out = start({ ex: NO_KINDS, equipmentId: null, targetLoad: kg(45.359237), gymEquipment: [], preferredUnit: 'lb' });
    expect(out.aggregate.sets[0]?.planned.load).toBeNull();
    expect(out.warnings).toEqual([{ kind: 'target_dropped', setTemplateId: id(6001), requested: kg(45.359237), reason: 'unit_not_convertible' }]);
    // Nothing unchecked is planned: Ben enters an lb load and it logs.
    const withHistory = oneTapLog(out.aggregate, [{ index: 0, values: values(lb(100), 8) }]);
    expect(expectOk(withHistory.result).state.sets[0]?.actual?.load).toEqual(lb(100));
  });

  it('row 3: a total-convention template on a per-hand rack is never converted and never shown unbounded', () => {
    const rack = dumbbells();
    const out = start({ ex: DB_PRESS, equipmentId: rack.id, targetLoad: kg(30), gymEquipment: [rack] });
    expect(out.aggregate.exercises[0]).toMatchObject({ loadConvention: 'per_hand' });
    expect(out.aggregate.sets[0]?.planned.load).toBeNull();
    expect(out.warnings).toEqual([
      { kind: 'target_dropped', setTemplateId: id(6001), requested: kg(30), reason: 'convention_mismatch' },
    ]);
    // History in the wrong convention is not copied in either.
    const wrongHistory = oneTapLog(out.aggregate, [{ index: 0, values: values(kg(30), 8) }]);
    expect(wrongHistory.draft.values.load).toBeNull();
    const rightHistory = oneTapLog(out.aggregate, [{ index: 0, values: values(kg(22.5, 'per_hand'), 8) }]);
    expect(expectOk(rightHistory.result).state.sets[0]?.actual?.load).toEqual(kg(22.5, 'per_hand'));
  });

  it('row 4: equipment missing at this gym (hotel gym): the pin maps to another kind the exercise lists, and the stack template is dropped, not relabelled as total (GS3 step 4)', () => {
    const cable = stack();
    const bar = barbell();
    const out = start({ ex: ROW_ANY, equipmentId: cable.id, targetLoad: kg(40, 'stack'), gymEquipment: [bar] });
    expect(out.aggregate.exercises[0]).toMatchObject({ equipmentId: bar.id, loadConvention: 'total', unit: 'kg' });
    expect(out.aggregate.sets[0]?.planned.load).toBeNull();
    expect(out.aggregate.sets[0]?.planned.snap).toMatchObject({ outcome: 'dropped', reason: 'convention_mismatch', intended: kg(40, 'stack') });
    expect(out.warnings).toEqual([
      expect.objectContaining({ kind: 'equipment_not_in_gym' }),
      { kind: 'target_dropped', setTemplateId: id(6001), requested: kg(40, 'stack'), reason: 'convention_mismatch' },
    ]);
    const { result } = oneTapLog(out.aggregate);
    expect(result.ok).toBe(false); // empty load: Log disabled, not a convention_mismatch
    if (!result.ok) expect(result.error.code).toBe('invalid_values');
  });

  it('a pin found nowhere, on an exercise that lists no equipment kinds: the load is dropped, reps kept, with a Why? note (review S2, rule 4)', () => {
    const NO_KINDS = exercise(214, 'Mystery press', { compatibleEquipment: [], defaultLoadConvention: 'total' });
    const out = start({ ex: NO_KINDS, equipmentId: id(4242), targetLoad: kg(137.3), gymEquipment: [barbell()] });
    const set = out.aggregate.sets[0];
    expect(out.aggregate.exercises[0]?.equipmentId).toBeNull();
    expect(set?.planned.load).toBeNull();
    expect(set?.planned.reps).toEqual({ min: 8, max: 8 });
    // Not kept as an intended target either: no gym could ever check it, so a later switch can't restore it unchecked.
    expect(set?.planned.snap).toBeUndefined();
    expect(out.warnings).toEqual([
      { kind: 'equipment_not_in_gym', routineExerciseId: id(600), equipmentId: id(4242), substituteId: null },
      { kind: 'target_dropped', setTemplateId: id(6001), requested: kg(137.3), reason: 'equipment_not_in_gym' },
    ]);
    expect(set?.planned.provenance?.guardNotes.map((n) => n.replaceAll('\u00a0', ' '))).toEqual(['No load target: plan was 137.3 kg, and this gym has nothing of that kind to check it on.']);
  });

  it('every planned load matches its session exercise unit and convention across mixed inputs', () => {
    const rack = dumbbells({ unit: 'lb', loads: [10, 20, 30, 40, 50] });
    const cases: [Exercise, string | null, Load][] = [
      [DB_PRESS, rack.id, kg(20, 'per_hand')],
      [DB_PRESS, rack.id, lb(35, 'per_hand')],
      [LAT, null, lb(100, 'stack')],
      [BENCH, null, kg(60)],
    ];
    for (const [ex, eqId, load] of cases) {
      const out = start({ ex, equipmentId: eqId, targetLoad: load, gymEquipment: [rack], preferredUnit: 'kg' });
      const sx = out.aggregate.exercises[0];
      const planned = out.aggregate.sets[0]?.planned.load;
      if (planned) expect({ unit: planned.unit, convention: planned.convention }).toEqual({ unit: sx?.unit, convention: sx?.loadConvention });
    }
  });

  it('equipment with no achievable loads drops the target instead of keeping an unchecked one', () => {
    const broken = stack({ minLoad: 60, maxLoad: 70 }); // stack tops out at 50
    expect(planTemplateLoad(id(1), kg(40, 'stack'), { unit: 'kg', convention: 'stack', equipment: broken })).toEqual({
      load: null,
      warning: { kind: 'target_dropped', setTemplateId: id(1), requested: kg(40, 'stack'), reason: 'no_achievable_loads' },
    });
  });
});

describe('convertMassExactly', () => {
  it('converts only when exact at display precision', () => {
    expect(convertMassExactly({ value: 45.359237, unit: 'kg' }, 'lb')).toEqual({ value: 100, unit: 'lb' });
    expect(convertMassExactly({ value: 0, unit: 'kg' }, 'lb')).toEqual({ value: 0, unit: 'lb' });
    expect(convertMassExactly({ value: 100, unit: 'kg' }, 'lb')).toBeNull();
    expect(convertMassExactly({ value: 20, unit: 'lb' }, 'kg')).toBeNull();
    expect(convertMassExactly({ value: 20, unit: 'lb' }, 'lb')).toEqual({ value: 20, unit: 'lb' });
  });
});
