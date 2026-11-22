import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import { gymLearnFor, gymLearnToast, planGymLearn, reduceSession, startWorkout, typedLoadPlan } from '../src/index';
import { at, barbell, bodyweightStation, dumbbells, exercise, GYM, idGen, kg, profile, routine, routineExercise, stack, template } from './fixtures';

/**
 * (Ben, 27 Oct: "If I add it it should work") A weight Ben types for a set is kept exactly as typed, never refused
 * or rounded; off the gym's known kit the gym learns it (a dumbbell, a stack's top or step, an item's max). kg on a
 * bodyweight exercise is added weight; one that can't take added weight says so. Suggestions still snap (rule 4).
 */

const DB = exercise(801, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const ROW = exercise(802, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const BENCH = exercise(803, 'Bench press', { compatibleEquipment: ['barbell'] });
const DIP = exercise(804, 'Dip', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });

const RACK = dumbbells();
const CABLE = stack({ detailsSource: 'user' } as never);
const BAR = barbell({ maxLoad: 120 });
const STATION = bodyweightStation();

function start(): SessionAggregate {
  const r = routine([
    routineExercise(810, { exerciseId: DB.id, equipmentId: RACK.id, order: 0, setTemplates: [template(8101, { targetLoad: kg(20, 'per_hand') }), template(8102, { targetLoad: kg(20, 'per_hand') })] }),
    routineExercise(811, { exerciseId: ROW.id, equipmentId: CABLE.id, order: 1, setTemplates: [template(8111, { targetLoad: kg(40, 'stack') })] }),
    routineExercise(812, { exerciseId: BENCH.id, equipmentId: BAR.id, order: 2, setTemplates: [template(8121, { targetLoad: kg(100) })] }),
    routineExercise(813, { exerciseId: DIP.id, equipmentId: STATION.id, order: 3, setTemplates: [template(8131, { targetLoad: null })] }),
  ]);
  return startWorkout({ opId: 'typed-start', owner: profile(), gymId: GYM, routine: r, exercises: new Map<string, Exercise>([DB, ROW, BENCH, DIP].map((e) => [e.id, e])), gymEquipment: [RACK, CABLE, BAR, STATION], at: at(0), newId: idGen(81_000) }).aggregate;
}
const setOf = (a: SessionAggregate, e: Exercise, n = 0) => {
  const row = a.exercises.find((x) => x.exerciseId === e.id);
  const s = a.sets.filter((x) => x.sessionExerciseId === row?.id && x.status === 'pending').sort((x, y) => x.index - y.index)[n];
  if (s === undefined) throw new Error('no set');
  return s;
};

describe('typedLoadPlan: as typed, never rounded', () => {
  const a = start();

  it('on the kit: exact, nothing to learn', () => {
    expect(typedLoadPlan(a, setOf(a, DB).id, 22.5)).toEqual({ kind: 'exact', load: kg(22.5, 'per_hand'), offKit: false, learn: null });
  });

  it('a dumbbell the rack doesn’t list (even well above its top): exact, and the rack learns it', () => {
    const p = typedLoadPlan(a, setOf(a, DB).id, 40);
    expect(p).toMatchObject({ kind: 'exact', load: kg(40, 'per_hand'), offKit: true, learn: { kind: 'add_dumbbell', equipmentId: RACK.id, value: 40 } });
    // Not on the 0.5 grid: still exactly as typed; nothing to learn (no such dumbbell to add).
    expect(typedLoadPlan(a, setOf(a, DB).id, 23.75)).toMatchObject({ kind: 'exact', load: kg(23.75, 'per_hand'), offKit: true, learn: null });
  });

  it('above a confirmed stack’s top: exact, and that machine goes higher', () => {
    expect(typedLoadPlan(a, setOf(a, ROW).id, 60)).toMatchObject({ kind: 'exact', load: kg(60, 'stack'), learn: { kind: 'stack_max', max: 60, exerciseId: ROW.id } });
  });

  it('above a bar’s recorded max: exact, and the max goes up (Ben’s entry is the evidence)', () => {
    expect(typedLoadPlan(a, setOf(a, BENCH).id, 130)).toMatchObject({ kind: 'exact', load: kg(130), offKit: true, learn: { kind: 'raise_max', equipmentId: BAR.id, max: 130 } });
    // Plate maths the plates can't make (no 0.625 kg plates): kept as typed, nothing learned.
    expect(typedLoadPlan(a, setOf(a, BENCH).id, 101.25)).toMatchObject({ kind: 'exact', load: kg(101.25), offKit: true, learn: null });
  });

  it('kg on a bodyweight exercise is added weight; one that can’t take it says so (never `Not at this gym`)', () => {
    expect(typedLoadPlan(a, setOf(a, DIP).id, 10)).toMatchObject({ kind: 'add_weight', load: kg(10, 'added') });
    const dipRow = a.exercises.find((x) => x.exerciseId === DIP.id);
    const onBar: SessionAggregate = { ...a, exercises: a.exercises.map((x) => (x.id === dipRow?.id ? { ...x, equipmentId: BAR.id } : x)) };
    expect(typedLoadPlan(onBar, setOf(a, DIP).id, 10)).toEqual({ kind: 'refused', reason: 'Dip can’t take added weight' });
    expect(typedLoadPlan(a, setOf(a, DB).id, -1)).toMatchObject({ kind: 'refused' });
  });
});

describe('edit_planned_set with loadAsTyped', () => {
  it('Ben’s typed load is saved exactly off the kit; without the flag (a suggestion) it is still refused (rule 4); Undo puts the target back', () => {
    const a = start();
    const s = setOf(a, DB);
    const refused = reduceSession(a, { type: 'edit_planned_set', at: at(10), opId: 'p1', setId: s.id, expectedSetVersion: s.version, patch: { load: kg(23.75, 'per_hand') } });
    expect(refused.ok).toBe(false);
    const r = reduceSession(a, { type: 'edit_planned_set', at: at(10), opId: 'p2', setId: s.id, expectedSetVersion: s.version, patch: { load: kg(23.75, 'per_hand'), loadAsTyped: true } });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.sets.find((x) => x.id === s.id)?.planned.load).toEqual(kg(23.75, 'per_hand'));
    // Replayed: the same.
    const again = reduceSession(r.state, { type: 'edit_planned_set', at: at(10), opId: 'p2', setId: s.id, expectedSetVersion: s.version, patch: { load: kg(23.75, 'per_hand'), loadAsTyped: true } });
    expect(again.ok && again.state.session.version).toBe(r.state.session.version);
    const undo = reduceSession(r.state, { type: 'undo_op', at: at(20), opId: 'u1', targetOpId: 'p2' });
    if (!undo.ok) throw new Error(undo.error.message);
    expect(undo.state.sets.find((x) => x.id === s.id)?.planned.load).toEqual(kg(20, 'per_hand'));
  });
});

describe('the gym learns it', () => {
  const edit = (eq: EquipmentInstance, l: Parameters<typeof planGymLearn>[1]) => planGymLearn(eq, l, '2026-10-27T10:00:00.000Z', () => 'new-item');

  it('a raised max: the item’s maxLoad, versioned; never lower; the toast names the gym', () => {
    const l = gymLearnFor(BAR, kg(130), { id: BENCH.id, name: BENCH.name }, { typed: true });
    if (l === null) throw new Error('no learn');
    const e = edit(BAR, l);
    expect(e?.equipment[0]?.after).toMatchObject({ maxLoad: 130, version: BAR.version + 1 });
    expect(gymLearnFor(BAR, kg(130), null)).toBeNull();
    if (l.kind === 'raise_max') expect(edit(BAR, { ...l, max: 110 })).toBeNull();
    expect(gymLearnToast(l, 'Main Gym')).toBe('Main Gym: Olympic bar to 130 kg');
    expect(gymLearnToast({ kind: 'add_dumbbell', equipmentId: RACK.id, unit: 'kg', value: 27.5 }, 'Main Gym')).toBe('Main Gym: 27.5 kg added');
  });

  it('a machine’s own stack is changed in place (not split again)', () => {
    const own = stack({ onlyFor: [ROW.id], detailsSource: 'user' } as never);
    const l = gymLearnFor(own, kg(60, 'stack'), { id: ROW.id, name: ROW.name }, { typed: true });
    expect(l).toMatchObject({ kind: 'stack_max', max: 60 });
    if (l === null) throw new Error('no learn');
    const e = edit(own, l);
    expect(e?.equipment).toHaveLength(1);
    expect(e?.equipment[0]?.after).toMatchObject({ id: own.id, stackLoads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] });
  });

  it('the typo ceiling stays: a 2250 kg dumbbell is never learned', () => {
    expect(gymLearnFor(RACK, kg(2250, 'per_hand'), null, { typed: true })).toBeNull();
  });
});
