import { restAfterRows, roundRestOf, defaultRestS, restRoleOf } from './rest';
import type { BuilderBlock, BuilderInfoLookup, BuilderSlot, BuilderWorkout } from './types';

/**
 * Time estimate (workout-builder-v3 §3.6, §9 Q15–Q16):
 * `2 min setup + every exercise + 1 min between exercises`;
 * - solo: warm-ups (each 30 s + its rest, then +1 min after the last) +
 *   each set (45 s + its rest);
 * - superset: its warm-ups + rounds × (45 s per exercise + rest after the
 *   round). No switch time inside a round (Q16).
 * "Between exercises" is between blocks (a superset is one station).
 * MERGE NOTE (Q15): Today and time left should read these same constants.
 */
export const BUILDER_TIME = {
  setupS: 120,
  betweenS: 60,
  setS: 45,
  warmupSetS: 30,
  afterWarmupsS: 60,
} as const;

const T = BUILDER_TIME;

export interface EstimateContext {
  info: BuilderInfoLookup;
  restPresetsS?: readonly number[];
}

function warmupSeconds(slot: BuilderSlot, ctx: EstimateContext, w: BuilderWorkout): number {
  const n = slot.rows.filter((r) => r.type === 'warmup').length;
  if (n === 0) return 0;
  const rest = slot.restS?.warmup ?? defaultRestS('warmup', restRoleOf(slot, ctx.info), w.restLevel, ctx.restPresetsS);
  return n * (T.warmupSetS + rest) + T.afterWarmupsS;
}

/** Seconds for one block (solo or superset). */
export function blockSeconds(block: BuilderBlock, w: BuilderWorkout, ctx: EstimateContext): number {
  const warm = block.slots.reduce((m, s) => m + warmupSeconds(s, ctx, w), 0);
  const only = block.slots.length === 1 ? block.slots[0] : undefined;
  if (only !== undefined) {
    const rests = restAfterRows(only, ctx.info, w.restLevel, ctx.restPresetsS);
    return warm + only.rows.reduce((m, r, i) => (r.type === 'warmup' ? m : m + T.setS + (rests[i] ?? 0)), 0);
  }
  const rounds = Math.max(0, ...block.slots.map((s) => s.rows.filter((r) => r.type !== 'warmup').length));
  return warm + rounds * (T.setS * block.slots.length + roundRestOf(block, w.restLevel, ctx.restPresetsS));
}

/** Estimated seconds for the whole workout; 0 when it's empty. */
export function estimateBuilderSeconds(w: BuilderWorkout, ctx: EstimateContext): number {
  const blocks = w.blocks.filter((b) => b.slots.length > 0);
  if (blocks.length === 0) return 0;
  return T.setupS + T.betweenS * (blocks.length - 1) + blocks.reduce((m, b) => m + blockSeconds(b, w, ctx), 0);
}

/** `about N min`: the estimate rounded to the minute. */
export function estimateBuilderMinutes(w: BuilderWorkout, ctx: EstimateContext): number {
  return Math.round(estimateBuilderSeconds(w, ctx) / 60);
}
