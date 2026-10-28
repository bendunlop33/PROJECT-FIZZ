import { WARMUP_REP_S, warmupTimeS } from '../warmup/plan';
import { PACE_DEFAULT, type BuilderPace } from './pace';
import { restAfterRows, roundRestOf } from './rest';
import type { BuilderBlock, BuilderInfoLookup, BuilderSlot, BuilderWorkout } from './types';

/**
 * Time estimate (workout-builder-v3 §3.6, §9 Q15–Q16):
 * `2 min setup + every exercise + 1 min between exercises`;
 * - solo: warm-ups (WU11, 23 Oct: `warmupTimeS`, reps × 4 s + 60 s between
 *   steps, then the rest before the first working set, `warmupRestS`: 2 min
 *   in the rep band, 3 min in the heavy band; Ben's own warm-up rest wins) +
 *   each set (45 s + its rest);
 * - superset: its warm-ups + rounds × (45 s per exercise + rest after the
 *   round). No switch time inside a round (Q16).
 * "Between exercises" is between blocks (a superset is one station).
 * (Q15) Today and time left should read these same constants; wiring
 * `duration.ts` / `time-left.ts` to them belongs to the Today (v2) stream.
 */
export const BUILDER_TIME = {
  setupS: 120,
  betweenS: 60,
  setS: 45,
} as const;

const T = BUILDER_TIME;

export interface EstimateContext {
  info: BuilderInfoLookup;
  restPresetsS?: readonly number[];
  /**
   * (Ben, 28 Oct) Ben's own pace (`learnPace`): seconds per set, rest overrun and changeover in place of 45 s, ×1 and
   * 60 s. Absent: the defaults (so a context without it times exactly as before).
   */
  pace?: BuilderPace;
}

/** The pace an estimate uses: Ben's (`ctx.pace`) or the defaults. */
export function paceOf(ctx: Pick<EstimateContext, 'pace'>): BuilderPace {
  return ctx.pace ?? PACE_DEFAULT;
}

/** A planned rest as Ben actually takes it (`restScale`), whole seconds. */
const restAsTaken = (s: number, pace: BuilderPace): number => (pace.restScale === 1 ? s : Math.round(s * pace.restScale));

/**
 * (WU11, Ben approved WU1–WU12 22 Oct) A slot's warm-ups: the shared planner's warm-up time (`warmupTimeS`: Σ reps ×
 * 4 s + 60 s between steps, or Ben's own warm-up rest between them), plus the rest after the last warm-up before the
 * first working set (`restAfterRows`: `warmupRestS`, 2 min rep band / 3 min heavy band, unless Ben set his own).
 */
function warmupSeconds(slot: BuilderSlot, ctx: EstimateContext, w: BuilderWorkout): number {
  const idx = slot.rows.flatMap((r, i) => (r.type === 'warmup' ? [i] : []));
  const last = idx[idx.length - 1];
  if (last === undefined) return 0;
  const steps = idx.map((i) => ({ load: slot.rows[i]?.load ?? 0, reps: slot.rows[i]?.reps ?? 0 }));
  const own = slot.restS?.warmup;
  const ladder = own === undefined ? warmupTimeS(steps) : steps.reduce((m, s) => m + s.reps * WARMUP_REP_S, 0) + own * (steps.length - 1);
  return ladder + restAsTaken(restAfterRows(slot, ctx.info, w.restLevel, ctx.restPresetsS)[last] ?? 0, paceOf(ctx));
}

/**
 * (22 Oct) What a timed set takes beyond a set's `setS`: its work time past 45 s (a 20:00 ride counts 20 minutes). A
 * distance alone has no time to count (none is invented). Zero for every rep-based set, so their estimate is unchanged.
 */
function timedExtraS(slot: BuilderSlot, setS: number): number {
  return slot.rows.reduce((m, r) => (r.type === 'warmup' || r.durationS === undefined ? m : m + Math.max(0, r.durationS - setS)), 0);
}

/** Seconds for one block (solo or superset). */
export function blockSeconds(block: BuilderBlock, w: BuilderWorkout, ctx: EstimateContext): number {
  const pace = paceOf(ctx);
  const warm = block.slots.reduce((m, s) => m + warmupSeconds(s, ctx, w), 0);
  const timed = block.slots.reduce((m, s) => m + timedExtraS(s, pace.setS), 0);
  const only = block.slots.length === 1 ? block.slots[0] : undefined;
  if (only !== undefined) {
    const rests = restAfterRows(only, ctx.info, w.restLevel, ctx.restPresetsS);
    return warm + timed + only.rows.reduce((m, r, i) => (r.type === 'warmup' ? m : m + pace.setS + restAsTaken(rests[i] ?? 0, pace)), 0);
  }
  const rounds = Math.max(0, ...block.slots.map((s) => s.rows.filter((r) => r.type !== 'warmup').length));
  return warm + timed + rounds * (pace.setS * block.slots.length + restAsTaken(roundRestOf(block, w.restLevel, ctx.restPresetsS), pace));
}

/** The changeover between two blocks (`betweenS`, or Ben's own, `ctx.pace`). */
export function betweenSecondsOf(ctx: Pick<EstimateContext, 'pace'>): number {
  return paceOf(ctx).betweenS;
}

/** Estimated seconds for the whole workout; 0 when it's empty. */
export function estimateBuilderSeconds(w: BuilderWorkout, ctx: EstimateContext): number {
  const blocks = w.blocks.filter((b) => b.slots.length > 0);
  if (blocks.length === 0) return 0;
  return T.setupS + betweenSecondsOf(ctx) * (blocks.length - 1) + blocks.reduce((m, b) => m + blockSeconds(b, w, ctx), 0);
}

/** `about N min`: the estimate rounded to the minute. */
export function estimateBuilderMinutes(w: BuilderWorkout, ctx: EstimateContext): number {
  return Math.round(estimateBuilderSeconds(w, ctx) / 60);
}
