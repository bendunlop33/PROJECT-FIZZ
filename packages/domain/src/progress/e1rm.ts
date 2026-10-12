import type { EquipmentKind, LoadConvention, WeightUnit } from '@fizz/schemas';

/**
 * Estimated one-rep max (progress.md PG11). Epley: `load × (1 + reps / 30)`,
 * and 1 rep is the load itself. Only from sets of 1–10 reps on load-based
 * conventions: `total`, `per_hand` (the per-dumbbell value), `stack`, and
 * `added` on a plate-loaded machine. Never for assistance, bodyweight,
 * bodyweight + added (a dip belt: the body is most of the load) or timed sets.
 * Rounded to 0.5 kg / 1 lb for display, never snapped to equipment (it isn't
 * a target), and always shown as an estimate (`≈`, `Est.`).
 */

export const E1RM_MAX_REPS = 10;

export type E1rmResult =
  | { eligible: true; value: number; unit: WeightUnit; convention: LoadConvention; isEstimate: true }
  | { eligible: false; reason: 'convention' | 'reps' | 'no_load' };

/** True for conventions where more load means a stronger lift and the load is the whole resistance. */
export function e1rmConventionAllowed(convention: LoadConvention, equipmentKind: EquipmentKind | null): boolean {
  switch (convention) {
    case 'total':
    case 'per_hand':
    case 'stack':
      return true;
    case 'added':
      return equipmentKind === 'plate_loaded_machine';
    case 'assistance':
    case 'bodyweight':
      return false;
  }
}

/** Display rounding: nearest 0.5 kg or 1 lb. */
export function roundEstimate(value: number, unit: WeightUnit): number {
  const step = unit === 'kg' ? 0.5 : 1;
  return Math.round(value / step) * step;
}

export function estimateOneRepMax(
  load: { value: number; unit: WeightUnit; convention: LoadConvention } | null,
  reps: number | null,
  equipmentKind: EquipmentKind | null = null,
): E1rmResult {
  if (load === null) return { eligible: false, reason: 'no_load' };
  if (!e1rmConventionAllowed(load.convention, equipmentKind)) return { eligible: false, reason: 'convention' };
  if (reps === null || !Number.isInteger(reps) || reps < 1 || reps > E1RM_MAX_REPS) return { eligible: false, reason: 'reps' };
  if (load.value <= 0) return { eligible: false, reason: 'no_load' };
  const raw = reps === 1 ? load.value : load.value * (1 + reps / 30);
  return { eligible: true, value: roundEstimate(raw, load.unit), unit: load.unit, convention: load.convention, isEstimate: true };
}
