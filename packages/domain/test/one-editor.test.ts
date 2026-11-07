import { describe, expect, it } from 'vitest';
import type { RoutineExercise } from '@fizz/schemas';

import { dropRoutineSlot, normaliseRoutineExercises, slotRestOf, stepSlotRest, typedFixedLoad, updateSet } from '../src/index';
import { id, kg, lb, routineExercise, template } from './fixtures';
import { BENCH, FACE, HANG, ROW } from './session-fixture';

/**
 * (Ben, 23 Oct: one editor) The domain parts of editing a saved workout on Your workout's page: drag a row to
 * move or superset it, a typed Kg cell pinned and rounded to this gym (rule 4), rest steps per set type, and a
 * set's target effort and cardio distance.
 */

const list = (): RoutineExercise[] =>
  normaliseRoutineExercises([
    routineExercise(10, { exerciseId: BENCH }),
    routineExercise(11, { exerciseId: ROW }),
    routineExercise(12, { exerciseId: FACE, supersetGroup: 'A' }),
    routineExercise(13, { exerciseId: HANG, supersetGroup: 'A' }),
  ]);
const shape = (l: readonly RoutineExercise[] | null) => (l === null ? null : l.map((e) => `${e.exerciseId === BENCH ? 'bench' : e.exerciseId === ROW ? 'row' : e.exerciseId === FACE ? 'face' : 'hang'}${e.supersetGroup === null ? '' : `:${e.supersetGroup}`}`));

describe('dropRoutineSlot (drag on the one editor)', () => {
  it('before / after a plain row moves it there as its own round', () => {
    expect(shape(dropRoutineSlot(list(), id(11), id(10), 'before'))).toEqual(['row', 'bench', 'face:A', 'hang:A']);
    expect(shape(dropRoutineSlot(list(), id(10), id(11), 'after'))).toEqual(['row', 'bench', 'face:A', 'hang:A']);
  });

  it('before / after a superset goes around the whole round; leaving a superset leaves the partner alone', () => {
    expect(shape(dropRoutineSlot(list(), id(10), id(13), 'after'))).toEqual(['row', 'face:A', 'hang:A', 'bench']);
    expect(shape(dropRoutineSlot(list(), id(10), id(13), 'before'))).toEqual(['row', 'bench', 'face:A', 'hang:A']);
    expect(shape(dropRoutineSlot(list(), id(13), id(10), 'before'))).toEqual(['hang', 'bench', 'row', 'face']);
  });

  it('onto a row makes or joins a superset; up to 4; onto its own round or itself does nothing', () => {
    expect(shape(dropRoutineSlot(list(), id(10), id(11), 'onto'))).toEqual(['row:A', 'bench:A', 'face:B', 'hang:B']);
    expect(shape(dropRoutineSlot(list(), id(10), id(12), 'onto'))).toEqual(['row', 'face:A', 'hang:A', 'bench:A']);
    expect(dropRoutineSlot(list(), id(12), id(13), 'onto')).toBeNull();
    expect(dropRoutineSlot(list(), id(12), id(12), 'before')).toBeNull();
    // A drop that changes nothing springs back.
    expect(dropRoutineSlot(list(), id(10), id(11), 'before')).toBeNull();
    const five = normaliseRoutineExercises([10, 11, 12, 13, 14].map((n, i) => routineExercise(n, { exerciseId: id(500 + n), supersetGroup: i < 4 ? 'A' : null })));
    expect(dropRoutineSlot(five, id(14), id(10), 'onto')).toBeNull();
  });
});

describe('typedFixedLoad (a typed Kg cell; Ben, 27 Oct: kept as typed)', () => {
  it('kept exactly as typed, between steps and past a max; per-hand, lb, assisted and stacks keep their own', () => {
    const f = { unit: 'kg' as const, convention: 'per_hand' as const };
    expect(typedFixedLoad(27.5, f)).toEqual({ load: kg(27.5, 'per_hand'), note: null });
    expect(typedFixedLoad(26, f)).toEqual({ load: kg(26, 'per_hand'), note: null });
    expect(typedFixedLoad(37.5, f)).toEqual({ load: kg(37.5, 'per_hand'), note: null });
    expect(typedFixedLoad(101.3, { unit: 'kg', convention: 'total' }).load).toEqual(kg(101.3));
    expect(typedFixedLoad(42, { unit: 'lb', convention: 'per_hand' }).load).toEqual(lb(42, 'per_hand'));
    expect(typedFixedLoad(60, { unit: 'kg', convention: 'assistance' }).load).toEqual(kg(60, 'assistance'));
    expect(typedFixedLoad(12, { unit: 'kg', convention: 'stack' }).load).toEqual(kg(12, 'stack'));
  });

  it('never negative', () => {
    expect(typedFixedLoad(-5, { unit: 'kg', convention: 'total' }).load.value).toBe(0);
  });
});

describe('rest per set type and a set’s own targets', () => {
  const ctx = { exerciseName: 'Bench press', exerciseDefaultRestS: 150, globalDefault: { seconds: 120 } };
  it('resolves workout → exercise → default; a step writes the workout’s own; 0:00–15:00', () => {
    const l = list();
    expect(slotRestOf(l[0] as RoutineExercise, 'working', ctx)).toEqual({ seconds: 150, own: false });
    const up = stepSlotRest(l, id(10), 'working', 1, ctx);
    expect(slotRestOf(up[0] as RoutineExercise, 'working', ctx)).toEqual({ seconds: 165, own: true });
    expect(slotRestOf(up[0] as RoutineExercise, 'working', { ...ctx, exerciseDefaultRestS: null })).toEqual({ seconds: 165, own: true });
    const zero = [{ ...(l[0] as RoutineExercise), restBySetType: { working: { seconds: 0 } } }];
    expect(stepSlotRest(zero, id(10), 'working', -1, ctx)).toEqual(zero);
    const max = [{ ...(l[0] as RoutineExercise), restBySetType: { working: { seconds: 900 } } }];
    expect(stepSlotRest(max, id(10), 'working', 1, ctx)).toEqual(max);
  });

  it('updateSet writes target RPE / RIR and a cardio distance (null clears it)', () => {
    const l = [routineExercise(20, { exerciseId: BENCH, setTemplates: [template(201)] })];
    const rpe = updateSet(l, id(20), id(201), { targetRpe: 8.5, targetRir: null });
    expect(rpe[0]?.setTemplates[0]).toMatchObject({ targetRpe: 8.5, targetRir: null });
    const far = updateSet(l, id(20), id(201), { targetDistanceM: 5000 });
    expect(far[0]?.setTemplates[0]?.targetDistanceM).toBe(5000);
    const cleared = updateSet(far, id(20), id(201), { targetDistanceM: null });
    expect(cleared[0]?.setTemplates[0] && 'targetDistanceM' in cleared[0].setTemplates[0]).toBe(false);
  });
});
