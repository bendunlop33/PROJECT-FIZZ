import type { EquipmentInstance, Load, LoadConvention } from '@fizz/schemas';
import { getAchievableLoads } from './equipment';
import { toScaled } from './units';

/**
 * `buildStepCard` (coaching-playbook.md §6, active-workout.md §2.12): the
 * achievable loads either side of a load on one piece of equipment, with the
 * % change, from `getAchievableLoads` only. Pure. Used by `Why?`'s
 * `Equipment` row (`+2.5 kg (+2.5%), the smallest step on this bar.`).
 *
 * `nextUp` is the next **harder** load (more weight; on an assisted machine,
 * less assistance) and `nextDown` the next easier one, so "up" always means
 * progression whatever the convention.
 */
export interface StepCardEntry {
  load: Load;
  /** % change in the number from `current`, one decimal place; null when `current` is 0. */
  pct: number | null;
}

export interface StepCard {
  current: Load;
  nextUp: StepCardEntry | null;
  nextDown: StepCardEntry | null;
  /** Nothing harder is achievable. */
  atMax: boolean;
  /** Nothing easier is achievable. */
  atMin: boolean;
  convention: LoadConvention;
}

/** (to − from) / from × 100 to one decimal place; null when `from` is 0. */
export function pctChange(from: number, to: number): number | null {
  if (toScaled(from) === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/**
 * Null when the load isn't in the equipment's own unit and convention (never
 * converted here), for a bodyweight station, or when the equipment can make
 * no load at all.
 */
export function buildStepCard(eq: EquipmentInstance, current: Load): StepCard | null {
  if (eq.kind === 'bodyweight_station') return null;
  if (current.convention !== eq.loadConvention || current.unit !== eq.unit) return null;
  const { loads, direction, unit, convention } = getAchievableLoads(eq);
  if (loads.length === 0) return null;
  const cur = toScaled(current.value);
  const above = loads.find((l) => toScaled(l) > cur);
  let below: number | undefined;
  for (const l of loads) if (toScaled(l) < cur) below = l;
  const harder = direction === 'resistance' ? above : below;
  const easier = direction === 'resistance' ? below : above;
  const entry = (v: number | undefined): StepCardEntry | null => (v === undefined ? null : { load: { value: v, unit, convention }, pct: pctChange(current.value, v) });
  return { current, nextUp: entry(harder), nextDown: entry(easier), atMax: harder === undefined, atMin: easier === undefined, convention };
}
