import type { EquipmentInstance, PlateCount, WeightUnit } from '@fizz/schemas';
import { getAchievableLoads } from '../equipment';
import { toScaled } from '../units';

/**
 * WU8 amendment, simple warm-up loads (Ben, 1 Nov; docs/training-guides/warm-up.md). Pure.
 *
 * Warm-ups use easy-to-load numbers, not calculated jumps:
 * - bars (total load): the empty bar, then the bar + multiples of 10 kg (20 lb), so 20 → 30, 40, 60, 80 on a 20 kg bar
 *   (45 → 65, 85, 105, 135… on a 45 lb bar); a working load ≥ 100 kg (220 lb) first tries 20 kg (40 lb) steps
 *   (`coarse`), kept only when WU4's gaps allow it. At most 2 plate sizes a side when the inventory can do it;
 * - dumbbells (per hand): multiples of 5 kg (10 lb) the rack has;
 * - stacks, plate-loaded and Smith machines: multiples of 10 kg (20 lb), or the stack's own step when bigger.
 * `simpleWarmupLoads` lists the simple loads this item can make (always a subset of its achievable loads, so rule 4
 * holds); the planner rounds each step to the nearest of them within one `step`, else snaps down as before.
 */
export interface SimpleWarmupLoads {
  /** The grid step in the item's unit. */
  step: number;
  /** Simple loads this item makes, ascending (a subset of `getAchievableLoads`). */
  loads: readonly number[];
  /** Bars: the 20 kg (40 lb) ladder, tried when W ≥ `from`. */
  coarse: { from: number; step: number; loads: readonly number[] } | null;
}

const BAR_STEP: Record<WeightUnit, number> = { kg: 10, lb: 20 };
const BAR_COARSE_STEP: Record<WeightUnit, number> = { kg: 20, lb: 40 };
const BAR_COARSE_FROM: Record<WeightUnit, number> = { kg: 100, lb: 220 };
const DB_STEP: Record<WeightUnit, number> = { kg: 5, lb: 10 };
const MACHINE_STEP: Record<WeightUnit, number> = { kg: 10, lb: 20 };
/** At most this many plate sizes on each side of a bar for a warm-up (when the inventory can do it). */
export const SIMPLE_MAX_PLATE_SIZES = 2;

const onGrid = (v: number, base: number, step: number): boolean => {
  const n = (toScaled(v) - toScaled(base)) / toScaled(step);
  return n >= 0 && Number.isInteger(n);
};

/** Whether `perSide` (scaled) can be made with at most `SIMPLE_MAX_PLATE_SIZES` plate sizes from the bar's pairs. */
export function fewPlateSizes(perSideScaled: number, plates: readonly PlateCount[]): boolean {
  if (perSideScaled === 0) return true;
  const pairs = plates.map((p) => ({ m: toScaled(p.mass), n: Math.floor(p.count / 2) })).filter((p) => p.m > 0 && p.n > 0);
  for (let a = 0; a < pairs.length; a += 1) {
    const A = pairs[a];
    if (A === undefined) continue;
    for (let na = 1; na <= A.n && na * A.m <= perSideScaled; na += 1) {
      const rest = perSideScaled - na * A.m;
      if (rest === 0) return true;
      for (let b = a + 1; b < pairs.length; b += 1) {
        const B = pairs[b];
        if (B !== undefined && rest % B.m === 0 && rest / B.m <= B.n) return true;
      }
    }
  }
  return false;
}

function stackStep(stackLoads: readonly number[]): number {
  let min = Infinity;
  for (let k = 1; k < stackLoads.length; k += 1) {
    const d = (stackLoads[k] ?? 0) - (stackLoads[k - 1] ?? 0);
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : 0;
}

/** The simple loads this item makes for warm-ups; null for items the amendment doesn't cover (kettlebells, assisted, bodyweight). */
export function simpleWarmupLoads(eq: EquipmentInstance): SimpleWarmupLoads | null {
  const all = getAchievableLoads(eq).loads;
  const u = eq.unit;
  switch (eq.kind) {
    case 'barbell':
    case 'ez_bar':
    case 'trap_bar': {
      const bar = eq.barMass;
      const ok = (v: number, step: number): boolean => onGrid(v, bar, step) && fewPlateSizes((toScaled(v) - toScaled(bar)) / 2, eq.plates);
      return {
        step: BAR_STEP[u],
        loads: all.filter((v) => ok(v, BAR_STEP[u])),
        coarse: { from: BAR_COARSE_FROM[u], step: BAR_COARSE_STEP[u], loads: all.filter((v) => ok(v, BAR_COARSE_STEP[u])) },
      };
    }
    case 'dumbbells':
      return { step: DB_STEP[u], loads: all.filter((v) => onGrid(v, 0, DB_STEP[u])), coarse: null };
    case 'weight_stack': {
      const step = Math.max(MACHINE_STEP[u], stackStep(eq.stackLoads));
      return { step, loads: all.filter((v) => onGrid(v, 0, step)), coarse: null };
    }
    case 'plate_loaded_machine':
    case 'smith_machine':
      return { step: MACHINE_STEP[u], loads: all.filter((v) => onGrid(v, 0, MACHINE_STEP[u])), coarse: null };
    case 'kettlebell':
    case 'assisted_stack':
    case 'bodyweight_station':
    case 'bench':
    case 'rack':
      return null;
  }
}

/** `simpleWarmupLoads` when Ben's `Simple warm-up weights` is on (the default), else null (the 22 Oct snapping). */
export function simpleWarmupLoadsIf(eq: EquipmentInstance | null, on: boolean): SimpleWarmupLoads | null {
  return on && eq !== null ? simpleWarmupLoads(eq) : null;
}
