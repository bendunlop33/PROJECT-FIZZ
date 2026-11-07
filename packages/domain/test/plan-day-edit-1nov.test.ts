import { describe, expect, it } from 'vitest';
import type { RoutineExercise, SetTemplate } from '@fizz/schemas';
import { applyPlanDayEdit, planDayEditPreview } from '../src/index';

/** (Ben, 1 Nov, build 500) One plan day changed every week: order, sets, reps, RPE, main mark. Pure. */

const t = (id: string, setType: SetTemplate['setType'] = 'working', reps = { min: 8, max: 12 }): SetTemplate => ({ id, setType, targetLoad: null, targetReps: reps, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null });
const row = (id: string, exerciseId: string, order: number, sets: number, over: Partial<RoutineExercise> = {}): RoutineExercise => ({
  id,
  exerciseId,
  equipmentId: null,
  order,
  supersetGroup: null,
  setTemplates: [t(`${id}-w`, 'warmup'), ...Array.from({ length: sets }, (_, i) => t(`${id}-${String(i)}`))],
  restBySetType: {},
  transitionRestS: null,
  progressionRuleId: null,
  ...over,
});
const PRESS = 'press';
const INCLINE = 'incline';
const BENCH = 'bench';
const RAISE = 'raise';
const pushB = (): RoutineExercise[] => [row('r1', PRESS, 0, 3, { main: true }), row('r2', INCLINE, 1, 3), row('r3', BENCH, 2, 2), row('r4', RAISE, 3, 2)];

describe('planDayEditPreview + applyPlanDayEdit', () => {
  it('bench first and secondary press: the new order by row, then each change; warm-ups untouched', () => {
    const p = planDayEditPreview(pushB(), { order: [BENCH, PRESS, INCLINE, RAISE], changes: [{ exerciseId: PRESS, sets: 2, reps: null, targetRpe: 7, main: false, load: null }] });
    if (p.kind !== 'ok') throw new Error(p.kind);
    expect(p.edit).toEqual({ order: ['r3', 'r1', 'r2', 'r4'], rows: [{ rowId: 'r1', sets: 2, targetRpe: 7, main: false }] });
    const out = applyPlanDayEdit(pushB(), p.edit, (r, n) => `${r}-new-${String(n)}`);
    expect(out.map((r) => [r.exerciseId, r.order])).toEqual([[BENCH, 0], [PRESS, 1], [INCLINE, 2], [RAISE, 3]]);
    const press = out.find((r) => r.exerciseId === PRESS);
    expect(press?.main).toBe(false);
    expect(press?.setTemplates.map((x) => [x.setType, x.targetRpe])).toEqual([['warmup', 8], ['working', 7], ['working', 7]]);
    // Every other row as it was.
    expect(out.find((r) => r.exerciseId === INCLINE)?.setTemplates).toEqual(pushB()[1]?.setTemplates);
  });

  it('more sets copy the last working set with the IDs given; reps change on working sets only', () => {
    const p = planDayEditPreview(pushB(), { order: null, changes: [{ exerciseId: BENCH, sets: 4, reps: { min: 6, max: 8 }, targetRpe: null, main: null, load: null }] });
    if (p.kind !== 'ok') throw new Error(p.kind);
    const bench = applyPlanDayEdit(pushB(), p.edit, (r, n) => `${r}-new-${String(n)}`).find((r) => r.exerciseId === BENCH);
    expect(bench?.setTemplates.map((x) => [x.id, x.targetReps])).toEqual([
      ['r3-w', { min: 8, max: 12 }],
      ['r3-0', { min: 6, max: 8 }],
      ['r3-1', { min: 6, max: 8 }],
      ['r3-new-2', { min: 6, max: 8 }],
      ['r3-new-3', { min: 6, max: 8 }],
    ]);
  });

  it('refuses an order that misses or adds an exercise, a change to an exercise not in the day, a split superset, and no change', () => {
    expect(planDayEditPreview(pushB(), { order: [BENCH, PRESS, INCLINE], changes: [] })).toEqual({ kind: 'order_mismatch', missing: [RAISE], extra: [] });
    expect(planDayEditPreview(pushB(), { order: [BENCH, PRESS, INCLINE, RAISE, 'curl'], changes: [] })).toEqual({ kind: 'order_mismatch', missing: [], extra: ['curl'] });
    expect(planDayEditPreview(pushB(), { order: null, changes: [{ exerciseId: 'curl', sets: 2, reps: null, targetRpe: null, main: null, load: null }] })).toEqual({ kind: 'not_in_day', exerciseIds: ['curl'] });
    const paired = pushB().map((r) => (r.id === 'r2' || r.id === 'r3' ? { ...r, supersetGroup: 'A' } : r));
    expect(planDayEditPreview(paired, { order: [BENCH, PRESS, INCLINE, RAISE], changes: [] })).toEqual({ kind: 'splits_superset' });
    expect(planDayEditPreview(pushB(), { order: [PRESS, INCLINE, BENCH, RAISE], changes: [{ exerciseId: PRESS, sets: 3, reps: null, targetRpe: 8, main: true, load: null }] })).toEqual({ kind: 'no_change' });
  });

  it('a load Ben named goes on the working sets as typed (kg, per hand)', () => {
    const p = planDayEditPreview(pushB(), { order: null, changes: [{ exerciseId: BENCH, sets: null, reps: null, targetRpe: null, main: null, load: { value: 30, unit: 'kg', convention: 'per_hand' } }] });
    if (p.kind !== 'ok') throw new Error(p.kind);
    const bench = applyPlanDayEdit(pushB(), p.edit, (r, n) => `${r}-${String(n)}`).find((r) => r.exerciseId === BENCH);
    expect(bench?.setTemplates.map((x) => x.targetLoad)).toEqual([null, { value: 30, unit: 'kg', convention: 'per_hand' }, { value: 30, unit: 'kg', convention: 'per_hand' }]);
  });
});
