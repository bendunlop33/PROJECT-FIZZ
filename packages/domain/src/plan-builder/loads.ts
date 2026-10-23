import type { GymEquipmentKind, LoadConvention, PlanFocus, WeightUnit } from '@fizz/schemas';
import { convertMass } from '../units';
import { PB_BACKOFF_BAND, pbIsFloorLift } from './tables';

/**
 * Loads for the plan builder (plan-builder.md §1a, §2, D4, D6; WU1–WU12). Pure. Every load the engine plans is one
 * of the selected gym's achievable loads for that exercise (`PlanKit.loads`, from `getAchievableLoads`), so it is
 * never above the item's max and never between plates (rule 4). Per-hand dumbbells move one dumbbell at a time.
 */

/** One exercise's item at the gym: its achievable loads, ascending, in its own unit and convention. */
export interface PlanKit {
  equipmentId: string;
  kind: GymEquipmentKind;
  unit: WeightUnit;
  convention: LoadConvention;
  /** Ascending, never empty for a loadable item. */
  loads: readonly number[];
  /** A bar's own mass (the empty-bar warm-up), else null. */
  barMass: number | null;
}

const EPS = 1e-9;

/** Whether the reps/RPE formula applies (resistance loads): not assisted, added weight or bodyweight. */
export function kitHasFormula(kit: PlanKit | null): boolean {
  return kit !== null && kit.loads.length > 0 && (kit.convention === 'total' || kit.convention === 'per_hand' || kit.convention === 'stack');
}

/** The heaviest achievable load at or below `x`; null when `x` is below the lightest. */
export function kitDown(kit: PlanKit, x: number): number | null {
  let out: number | null = null;
  for (const l of kit.loads) if (l <= x + EPS) out = l;
  return out;
}

/** The lightest achievable load above `x`; null at the max. */
export function kitAbove(kit: PlanKit, x: number): number | null {
  for (const l of kit.loads) if (l > x + EPS) return l;
  return null;
}

/** The heaviest achievable load below `x`; null when none. */
export function kitBelow(kit: PlanKit, x: number): number | null {
  let out: number | null = null;
  for (const l of kit.loads) if (l < x - EPS) out = l;
  return out;
}

/** The nearest achievable load (a tie goes to the lighter). */
export function kitNearest(kit: PlanKit, x: number): number | null {
  let best: number | null = null;
  for (const l of kit.loads) if (best === null || Math.abs(l - x) < Math.abs(best - x) - EPS) best = l;
  return best;
}

/** A mass in the kit's unit. */
export function inKitUnit(kit: PlanKit, value: number, unit: WeightUnit): number {
  return unit === kit.unit ? value : convertMass({ value, unit }, kit.unit).value;
}

/** Epley, labelled est. wherever it is shown (rule 6). */
export const pbE1rm = (kg: number, reps: number): number => kg * (1 + reps / 30);

/** The weight for 6 reps at the same effort as `kg × reps` (§1a), nearest achievable. */
export function pbAt6(kit: PlanKit, kg: number, reps: number): number | null {
  return reps === 6 ? kitNearest(kit, kg) : kitNearest(kit, pbE1rm(kg, reps) / 1.2);
}

/** A weight for `reps` from an est. 1RM, nearest achievable (What to expect). */
export function pbAtReps(kit: PlanKit, e1rm: number, reps: number): number | null {
  return kitNearest(kit, e1rm / (1 + reps / 30));
}

/**
 * The week-1 top set (§1a, D6): the 6-rep estimate, one achievable step lighter when the lift is estimated, or stale
 * and not confirmed with `Still right`. Never "last weight + a step". Null when no achievable load fits.
 */
export function pbWeekOneTop(kit: PlanKit, six: number, light: boolean): number | null {
  const at = kitDown(kit, six);
  if (at === null) return null;
  return light ? kitBelow(kit, at) : at;
}

export type BackoffResult = { back: number; reps: number };

/**
 * D4 back-off (Ben, 22–23 Oct; SS4; review B2): from its reps and effort against the top (RIR-adjusted Epley, top and
 * back-offs @ RPE 8), snapped down to an achievable load inside the focus's band below the top; the next achievable
 * load up when that is inside the band; with none inside it, the achievable load nearest the band that is below the
 * top (a tie: the lighter); never the top itself. A top with no achievable load below it keeps its load and the
 * back-offs do one rep fewer.
 */
export function pbBackOff(kit: PlanKit, top: number, topReps: number, backReps: number, focus: PlanFocus, topRpe = 8, backRpe = 8): BackoffResult {
  const raw = (top * (30 + topReps + 10 - topRpe)) / (30 + backReps + 10 - backRpe);
  const [lo, hi] = PB_BACKOFF_BAND[focus];
  const L = top * (1 - hi) - EPS;
  const U = top * (1 - lo) + EPS;
  const target = Math.min(U, Math.max(L, raw));
  const down = kitDown(kit, target) ?? kit.loads[0] ?? null;
  const near = [down, down === null ? null : kitAbove(kit, down)].filter((x): x is number => x !== null && x > 0 && x < top - EPS);
  const inBand = near.find((x) => x >= L && x <= U);
  if (inBand !== undefined) return { back: inBand, reps: backReps };
  const off = (x: number): number => (x < L ? L - x : x - U);
  const best = [...near].sort((a, b) => off(a) - off(b) || a - b)[0];
  if (best !== undefined) return { back: best, reps: backReps };
  // Nothing below the top within reach of the band: the achievable load just below the top, else the top itself, one rep fewer.
  const below = kitBelow(kit, top);
  return below === null ? { back: top, reps: Math.max(1, backReps - 1) } : { back: below, reps: backReps };
}

/** A deload's −10 % on the back-offs (SS4, HT8): the same factor, snapped down, kept below the new top. */
export function pbLowerBackOff(kit: PlanKit, back: number, factor: number, newTop: number): number {
  if (!(factor < 1)) return back;
  const down = kitDown(kit, back * factor);
  const belowTop = kitBelow(kit, newTop);
  const pick = down === null ? belowTop : belowTop === null ? down : Math.min(down, belowTop);
  return pick ?? kit.loads[0] ?? back;
}

export interface PbWarmupSet {
  /** The empty bar (`bar × 5`), else a load. */
  bar: boolean;
  load: number;
  reps: number;
}

/**
 * Warm-ups (WU1–WU12, approved 22 Oct): a ladder from the first working set's load `W` and reps `R`, snapped down to
 * real loads (WU8); floor lifts skip the empty bar (WU9); dumbbells start at 40 %. Never counted as sets.
 */
export function pbWarmUp(kit: PlanKit, key: string, W: number, R: number): PbWarmupSet[] {
  if (!kitHasFormula(kit)) return [];
  const db = kit.convention === 'per_hand';
  const floor = pbIsFloorLift(key);
  const steps: [number, number][] = R <= 6 ? [[0.4, 5], [0.6, 3], [0.8, 2]] : [[0.5, 8], [0.8, R >= 10 ? 5 : 4]];
  const min = kit.loads[0] ?? 0;
  const out: PbWarmupSet[] = [];
  if (!db && !floor && R <= 6 && kit.barMass !== null) out.push({ bar: true, load: kit.barMass, reps: 5 });
  for (const [p, r] of steps) out.push({ bar: false, load: Math.max(min, kitDown(kit, W * p) ?? min), reps: r });
  return out;
}

/** `bar × 5 · 40 × 5 · 60 × 3 · 80 × 2` (` each` on dumbbells). */
export function pbWarmUpText(sets: readonly PbWarmupSet[], perHand: boolean): string {
  return sets.map((s) => (s.bar ? `bar × ${String(s.reps)}` : `${fmt(s.load)}${perHand ? ' each' : ''} × ${String(s.reps)}`)).join(' · ');
}

/** A load as shown: `102.5`, `24`. */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** The shared main-lift line (V1): `1 × 6 + 2 × 8 · 102.5 / 95` (` each` on dumbbells). */
export function pbMainLine(top: number | null, back: number | null, reps: number, backs: number, backReps: number, perHand: boolean): string {
  const scheme = `1 × ${String(reps)}${backs > 0 ? ` + ${String(backs)} × ${String(backReps)}` : ''}`;
  if (top === null) return scheme;
  return `${scheme} · ${fmt(top)}${backs > 0 && back !== null ? ` / ${fmt(back)}` : ''}${perHand ? ' each' : ''}`;
}
