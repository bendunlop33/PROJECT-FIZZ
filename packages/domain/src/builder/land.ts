import type { StructuralOp } from '../coach/structural';
import { slotsOf } from './arrange';
import { applyBuilderEdit } from './edit';
import type { BuilderBlock, BuilderContext, BuilderWorkout } from './types';

/**
 * (Ben, 23 Oct, D8) The coach's next-workout change Ben applied in chat (`propose_next_workout_change`), landed on
 * that workout's Your workout draft as today-only edits, with Undo. Pure.
 *
 * The ops were checked against the plan the next workout starts from (the routine's or the source workout's slots);
 * the draft's slots are its own, so each op is matched by exercise: a swap and a removal by the exercise they name,
 * a new order by the exercises it lists (the draft's other rounds keep their places). All or nothing: when one op
 * can't be made here (the exercise isn't in this draft any more, the new one is already in it, the builder refuses
 * it), nothing lands and the reason says which.
 */

export type LandRefusal = 'not_in_workout' | 'already_in_workout' | 'last_exercise' | 'not_here';

export type LandResult = { ok: true; workout: BuilderWorkout; changed: string[] } | { ok: false; reason: LandRefusal };

export function landStructuralOps(w: BuilderWorkout, ops: readonly StructuralOp[], ctx: BuilderContext): LandResult {
  let workout = w;
  const changed = new Set<string>();
  for (const op of ops) {
    switch (op.change) {
      case 'swap': {
        const slot = slotsOf(workout.blocks).find((x) => x.exerciseId === op.fromExerciseId);
        if (slot === undefined) return { ok: false, reason: 'not_in_workout' };
        const r = applyBuilderEdit(workout, { kind: 'swap', slotKey: slot.key, exerciseId: op.toExerciseId }, ctx);
        if (!r.ok) return { ok: false, reason: r.reason === 'already_in_workout' ? 'already_in_workout' : 'not_here' };
        workout = r.workout;
        for (const k of r.changed) changed.add(k);
        break;
      }
      case 'remove': {
        const all = slotsOf(workout.blocks);
        const slot = all.find((x) => x.exerciseId === op.exerciseId);
        if (slot === undefined) return { ok: false, reason: 'not_in_workout' };
        if (all.length <= 1) return { ok: false, reason: 'last_exercise' };
        const r = applyBuilderEdit(workout, { kind: 'delete_exercise', slotKey: slot.key }, ctx);
        if (!r.ok) return { ok: false, reason: 'not_here' };
        workout = r.workout;
        for (const k of r.changed) changed.add(k);
        break;
      }
      case 'reorder': {
        const ids = op.exerciseIds;
        if (ids === undefined) return { ok: false, reason: 'not_in_workout' };
        const r = reorderRounds(workout, ids);
        if (r === null) return { ok: false, reason: 'not_in_workout' };
        workout = r;
        break;
      }
    }
  }
  return { ok: true, workout, changed: [...changed] };
}

/**
 * The rounds holding the listed exercises, put in the listed order in the places those rounds took; every other
 * round stays where it is. Null when an exercise listed isn't in the workout.
 */
function reorderRounds(w: BuilderWorkout, exerciseIds: readonly string[]): BuilderWorkout | null {
  const roundOf = (id: string): number => w.blocks.findIndex((b) => b.slots.some((x) => x.exerciseId === id));
  const rounds: number[] = [];
  for (const id of exerciseIds) {
    const i = roundOf(id);
    if (i < 0) return null;
    if (!rounds.includes(i)) rounds.push(i);
  }
  const places = [...rounds].sort((a, b) => a - b);
  const blocks: BuilderBlock[] = [...w.blocks];
  places.forEach((place, n) => {
    const from = w.blocks[rounds[n] ?? place];
    if (from !== undefined) blocks[place] = from;
  });
  return { ...w, blocks };
}
