import { describe, expect, it } from 'vitest';
import { landStructuralOps, workoutFromTemplate, type BuilderWorkout, type StructuralOp } from '../src/index';
import { context } from './builder-v3-fixture';

/**
 * (Ben, 23 Oct, D8) The coach's next-workout change, applied in chat, lands on Your workout: each op matched by
 * exercise (the draft's slots aren't the plan's), all or nothing.
 */

const ids = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));
const ctx = context();
// Bench, incline DB, cable fly + pushdown (Ben's pair), curl.
const workout = (): BuilderWorkout =>
  workoutFromTemplate(
    [
      { exerciseId: 'bench', main: true, workingSets: 3, group: null },
      { exerciseId: 'incline_db', main: false, workingSets: 3, group: null },
      { exerciseId: 'cable_fly', main: false, workingSets: 3, group: 'A' },
      { exerciseId: 'pushdown', main: false, workingSets: 3, group: 'A' },
      { exerciseId: 'curl', main: false, workingSets: 2, group: null },
    ],
    ctx,
  );
const swap = (from: string, to: string): StructuralOp => ({ change: 'swap', slotKey: `plan-${from}`, fromExerciseId: from, fromName: from, toExerciseId: to, toName: to });

describe('landStructuralOps', () => {
  it('a swap keeps the slot’s place, superset and set count; the changed slot is named', () => {
    const w = workout();
    const fly = w.blocks[2]?.slots[0];
    const r = landStructuralOps(w, [swap('cable_fly', 'pec_deck')], ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(ids(r.workout)).toEqual(['bench', 'incline_db', 'pec_deck+pushdown', 'curl']);
    expect(r.changed).toEqual([fly?.key]);
    expect(r.workout.blocks[2]?.slots[0]?.rows.filter((x) => x.type !== 'warmup')).toHaveLength(3);
  });

  it('a removal, then a new order of the plan’s exercises; rounds not listed keep their places', () => {
    const ops: StructuralOp[] = [
      { change: 'remove', slotKey: 'plan-incline', exerciseId: 'incline_db', name: 'Incline' },
      { change: 'reorder', slotKeys: ['p1', 'p2', 'p3'], names: ['Fly', 'Bench', 'Pushdown'], exerciseIds: ['cable_fly', 'bench'] },
    ];
    const r = landStructuralOps(workout(), ops, ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(ids(r.workout)).toEqual(['cable_fly+pushdown', 'bench', 'curl']);
  });

  it('all or nothing: an exercise no longer in the workout, or one already in it, lands nothing', () => {
    expect(landStructuralOps(workout(), [swap('pec_deck', 'crossover')], ctx)).toEqual({ ok: false, reason: 'not_in_workout' });
    expect(landStructuralOps(workout(), [swap('cable_fly', 'pec_deck'), swap('incline_db', 'pec_deck')], ctx)).toEqual({ ok: false, reason: 'already_in_workout' });
    // An older record's new order (no exercises named) can't be matched.
    expect(landStructuralOps(workout(), [{ change: 'reorder', slotKeys: ['a', 'b'], names: ['A', 'B'] }], ctx)).toEqual({ ok: false, reason: 'not_in_workout' });
  });

  it('never removes the last exercise', () => {
    const one = workoutFromTemplate([{ exerciseId: 'bench', main: true, workingSets: 3, group: null }], ctx);
    expect(landStructuralOps(one, [{ change: 'remove', slotKey: 'x', exerciseId: 'bench', name: 'Bench' }], ctx)).toEqual({ ok: false, reason: 'last_exercise' });
  });
});
