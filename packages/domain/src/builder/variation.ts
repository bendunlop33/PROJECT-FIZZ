import { BUILDER_MAX_SUPERSET } from './arrange';
import { removeSlot } from './fit';
import { setWorkingCount } from './set-rows';
import { makeSlot } from './slot';
import type { BuilderBlock, BuilderContext, BuilderWorkout } from './types';

/**
 * Variations (workout-builder-v3 §1.3, §4.3, §9 Q17): a variation is the plan
 * day's template plus its extras, so a template change reaches every
 * variation. An op whose anchor exercise is gone is skipped and reported
 * (`Not applied: Hammer curl with Cable fly · Add anyway`).
 *
 * MERGE NOTE: S1 (schemas) owns `VariationOp`; this mirrors §4.3. The slot
 * an `add_slot` carries is reduced here to what the builder needs.
 */

export interface VariationSlotSpec {
  exerciseId: string;
  workingSets?: number;
}

export type VariationOp =
  /** `after`: an exercise ID, or `'end'` to append (§4.3). */
  | { kind: 'add_slot'; after: string; slot: VariationSlotSpec }
  | { kind: 'pair'; a: string; b: string }
  | { kind: 'remove_slot'; exerciseId: string }
  | { kind: 'set_count'; exerciseId: string; n: number };

export type VariationSkipReason = 'anchor_missing' | 'already_in_workout' | 'main_lift' | 'superset_full' | 'already_paired' | 'max_exercises';

export interface SkippedOp {
  index: number;
  op: VariationOp;
  reason: VariationSkipReason;
}

export interface VariationResult {
  workout: BuilderWorkout;
  skipped: SkippedOp[];
}

const MAX_EXERCISES = 10;

/** `applyVariation`: the template with the variation's extras applied in order. */
export function applyVariation(template: BuilderWorkout, ops: readonly VariationOp[], ctx: BuilderContext): VariationResult {
  let w: BuilderWorkout = { ...template, blocks: template.blocks.map((b) => ({ ...b, slots: [...b.slots] })) };
  const skipped: SkippedOp[] = [];
  const findSlot = (exerciseId: string) => {
    for (const [bi, b] of w.blocks.entries()) {
      const s = b.slots.find((x) => x.exerciseId === exerciseId);
      if (s !== undefined) return { bi, s };
    }
    return null;
  };
  ops.forEach((op, index) => {
    const skip = (reason: VariationSkipReason) => skipped.push({ index, op, reason });
    switch (op.kind) {
      case 'add_slot': {
        if (findSlot(op.slot.exerciseId) !== null) return skip('already_in_workout');
        if (w.blocks.reduce((m, b) => m + b.slots.length, 0) >= MAX_EXERCISES) return skip('max_exercises');
        const at = op.after === 'end' ? w.blocks.length - 1 : (findSlot(op.after)?.bi ?? null);
        if (at === null) return skip('anchor_missing');
        const slot = makeSlot(op.slot.exerciseId, op.slot.workingSets === undefined ? { main: false } : { main: false, workingSets: op.slot.workingSets }, ctx);
        const blocks = [...w.blocks];
        blocks.splice(at + 1, 0, { slots: [slot], auto: false });
        w = { ...w, blocks };
        return;
      }
      case 'pair': {
        const a = findSlot(op.a);
        const b = findSlot(op.b);
        if (a === null || b === null) return skip('anchor_missing');
        if (a.s.main || b.s.main) return skip('main_lift');
        if (a.bi === b.bi) return skip('already_paired');
        const target = w.blocks[a.bi];
        if (target === undefined || target.slots.length + 1 > BUILDER_MAX_SUPERSET) return skip('superset_full');
        const moved = b.s;
        const blocks: BuilderBlock[] = [];
        for (const [bi, blk] of w.blocks.entries()) {
          if (bi === a.bi) blocks.push({ slots: [...blk.slots, moved], auto: false });
          else if (bi === b.bi) {
            const rest = blk.slots.filter((s) => s !== moved);
            if (rest.length > 0) blocks.push({ ...blk, slots: rest, auto: rest.length > 1 ? blk.auto : false });
          } else blocks.push(blk);
        }
        w = { ...w, blocks };
        return;
      }
      case 'remove_slot': {
        const f = findSlot(op.exerciseId);
        if (f === null) return skip('anchor_missing');
        if (f.s.main) return skip('main_lift');
        w = removeSlot(w, f.s.key);
        return;
      }
      case 'set_count': {
        const f = findSlot(op.exerciseId);
        if (f === null) return skip('anchor_missing');
        const next = setWorkingCount(f.s, op.n);
        w = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s === f.s ? next : s)) })) };
        return;
      }
    }
  });
  return { workout: w, skipped };
}
