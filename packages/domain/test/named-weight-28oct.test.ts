import { describe, expect, it } from 'vitest';
import type { CoachEditTodayCommand, Exercise, SessionAggregate } from '@fizz/schemas';
import { gymLearnFor, gymLearnToast, namedWeightGymEdit, planGymLearn, startWorkout, typedLoadPlan } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, profile, routine, routineExercise, stack, template } from './fixtures';

/**
 * (Ben, 28 Oct: "if i name a weight specifically it probably means its there") A weight Ben names (to the coach, or
 * typed in a set) that the gym's profile can't make: a dumbbell is added to the rack, a plate total gains the plate
 * it needs. A named weight never raises a machine's max and never teaches a stack (kept as typed only).
 */

const DB = exercise(851, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const ROW = exercise(852, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const BENCH = exercise(853, 'Bench press', { compatibleEquipment: ['barbell'] });
const RACK = dumbbells();
const CABLE = stack({ detailsSource: 'user' } as never);
const BAR = barbell({ maxLoad: 120 });

function start(): SessionAggregate {
  const r = routine([
    routineExercise(860, { exerciseId: DB.id, equipmentId: RACK.id, order: 0, setTemplates: [template(8601, { targetLoad: kg(20, 'per_hand') })] }),
    routineExercise(861, { exerciseId: ROW.id, equipmentId: CABLE.id, order: 1, setTemplates: [template(8611, { targetLoad: kg(40, 'stack') })] }),
    routineExercise(862, { exerciseId: BENCH.id, equipmentId: BAR.id, order: 2, setTemplates: [template(8621, { targetLoad: kg(100) })] }),
  ]);
  return startWorkout({ opId: 'named-start', owner: profile(), gymId: GYM, routine: r, exercises: new Map<string, Exercise>([DB, ROW, BENCH].map((e) => [e.id, e])), gymEquipment: [RACK, CABLE, BAR], at: at(0), newId: idGen(86_000) }).aggregate;
}
const setOf = (a: SessionAggregate, e: Exercise) => {
  const row = a.exercises.find((x) => x.exerciseId === e.id);
  const s = a.sets.find((x) => x.sessionExerciseId === row?.id && x.status === 'pending');
  if (s === undefined) throw new Error('no set');
  return s;
};

describe('the plate a typed or named total needs (add_plate)', () => {
  const noSmall = barbell({ plates: [{ mass: 25, count: 2 }, { mass: 20, count: 4 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] } as never);
  it('102.5 kg with no 1.25 kg plates: a pair of 1.25 kg; the bar then makes it; Undo-able as one gym edit', () => {
    const l = gymLearnFor(noSmall, kg(102.5), null, { typed: true });
    expect(l).toEqual({ kind: 'add_plate', equipmentId: noSmall.id, unit: 'kg', mass: 1.25, count: 2, itemName: noSmall.name });
    if (l === null) throw new Error('no learn');
    expect(gymLearnToast(l, 'Main Gym')).toBe('Main Gym: 1.25 kg plates added');
    const edit = planGymLearn(noSmall, l, at(1).utc, idGen(1));
    const after = edit?.equipment[0]?.after;
    expect(after?.kind === 'barbell' ? after.plates.find((p) => p.mass === 1.25) : null).toEqual({ mass: 1.25, count: 2 });
    expect(gymLearnFor(after ?? noSmall, kg(102.5), null, { typed: true })).toBeNull();
  });
  it('101.25 kg (needs 0.625 kg plates): kept as typed, nothing learned; a suggestion (not typed) never learns a plate', () => {
    expect(gymLearnFor(BAR, kg(101.25), null, { typed: true })).toBeNull();
    expect(gymLearnFor(noSmall, kg(102.5))).toBeNull();
  });
  it('a typed set on the bar: the plate (manual entry learns it too)', () => {
    const a = start();
    expect(typedLoadPlan(a, setOf(a, BENCH).id, 100.5)).toMatchObject({ kind: 'exact', load: kg(100.5), offKit: true, learn: { kind: 'add_plate', mass: 0.25 } });
  });
});

describe('a weight named to the coach (named): dumbbells and plates only; a machine max caps; a stack keeps it as typed', () => {
  it('31 kg each: the rack learns 31; past a bar’s max: nothing (the max still caps); between stack steps: nothing', () => {
    expect(gymLearnFor(RACK, kg(31, 'per_hand'), null, { named: true })).toMatchObject({ kind: 'add_dumbbell', value: 31 });
    expect(gymLearnFor(BAR, kg(130), null, { named: true })).toBeNull();
    expect(gymLearnFor(CABLE, kg(42.5, 'stack'), { id: ROW.id, name: ROW.name }, { named: true })).toBeNull();
    expect(gymLearnFor(CABLE, kg(200, 'stack'), { id: ROW.id, name: ROW.name }, { named: true })).toBeNull();
  });

  it('namedWeightGymEdit: from the edit’s loadAsTyped targets only, one edit per item (two dumbbells, one version step)', () => {
    const a = start();
    const db = setOf(a, DB);
    const row = setOf(a, ROW);
    const command = {
      type: 'coach_edit_today',
      at: at(1),
      opId: 'op-named',
      expectedVersion: a.session.version,
      actionId: '00000000-0000-4000-8000-0000000c0001',
      steps: [
        {
          type: 'adjust_pending_targets',
          at: at(1),
          opId: 'op-named:0',
          expectedVersion: a.session.version,
          actionId: '00000000-0000-4000-8000-0000000c0001',
          changes: [
            { setId: db.id, target: { load: kg(31, 'per_hand'), reps: null }, loadAsTyped: true },
            { setId: row.id, target: { load: kg(42.5, 'stack'), reps: null }, loadAsTyped: true },
          ],
          removeSetIds: [],
          addSets: [
            { newSetId: '00000000-0000-4000-8000-0000000c0002', copyFromSetId: db.id, target: { load: kg(33, 'per_hand'), reps: null }, loadAsTyped: true },
            { newSetId: '00000000-0000-4000-8000-0000000c0003', copyFromSetId: db.id, target: { load: kg(35, 'per_hand'), reps: null } },
          ],
        },
      ],
    } as unknown as CoachEditTodayCommand;
    const edit = namedWeightGymEdit({ aggregate: a, command, items: [RACK, CABLE, BAR], atUtc: at(1).utc, newId: idGen(2) });
    expect(edit?.equipment).toHaveLength(1);
    const after = edit?.equipment[0]?.after;
    expect(after?.kind === 'dumbbells' ? after.loads.filter((x) => x > 30 && x < 34) : []).toEqual([31, 33]);
    // 35 wasn't Ben's (no loadAsTyped): not learned.
    expect(after?.kind === 'dumbbells' ? after.loads.includes(35) : true).toBe(RACK.kind === 'dumbbells' && RACK.loads.includes(35));
    expect(after?.version).toBe(RACK.version + 1);
    expect(edit?.lines).toEqual(['Added 31 kg dumbbells', 'Added 33 kg dumbbells']);
  });
});
