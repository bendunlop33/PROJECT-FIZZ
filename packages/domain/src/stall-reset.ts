import type { LoadDirection } from './equipment';
import { toScaled } from './units';

/**
 * Playbook rule 8's stall reset band: 5–10% easier than the current load
 * (Ben, 23 Oct). On an assisted machine "easier" is more assistance.
 */
export const STALL_RESET_MIN_PERCENT = 5;
export const STALL_RESET_MAX_PERCENT = 10;

/** The reset percentage a rule asks for, held inside rule 8's band. */
export function stallResetPercent(requested: number = STALL_RESET_MAX_PERCENT): number {
  return Math.min(STALL_RESET_MAX_PERCENT, Math.max(STALL_RESET_MIN_PERCENT, requested));
}

/** The easier load `percent` away from `current` (lighter; more assistance when assisted). */
function easierBy(current: number, percent: number, direction: LoadDirection): number {
  return direction === 'resistance' ? current * (1 - percent / 100) : current * (1 + percent / 100);
}

/** How much easier `load` is than `current`, in scaled units (positive = easier). */
function easing(current: number, load: number, direction: LoadDirection): number {
  const d = toScaled(current) - toScaled(load);
  return direction === 'resistance' ? d : -d;
}

/**
 * (Ben, 23 Oct; ADR 0006 amendment) The stall reset load, pure.
 *
 * `achievable` is the equipment's achievable loads in the same unit and
 * convention as `current`, or null with no equipment profile (the exact cut is
 * used). Of the achievable loads 5–10% easier than `current`, the one nearest
 * the target cut (`percent`, held in the band; default 10%) wins, ties to the
 * deeper cut. With none in the band (coarse kit), the nearest easier load:
 * one step down, never more. Null when nothing easier exists.
 *
 * Example: 60 kg on a 2.5 kg-step bar → 55 kg (54–57 is the band), not 52.5.
 */
export function stallResetLoad(
  current: number,
  achievable: readonly number[] | null,
  direction: LoadDirection,
  percent: number = STALL_RESET_MAX_PERCENT,
): number | null {
  const pct = stallResetPercent(percent);
  const target = easierBy(current, pct, direction);
  if (achievable === null) return easing(current, target, direction) > 0 ? target : null;
  const easier = achievable.filter((l) => easing(current, l, direction) > 0);
  if (easier.length === 0) return null;
  const lo = easing(current, easierBy(current, STALL_RESET_MIN_PERCENT, direction), direction);
  const hi = easing(current, easierBy(current, STALL_RESET_MAX_PERCENT, direction), direction);
  const inBand = easier.filter((l) => {
    const e = easing(current, l, direction);
    return e >= lo && e <= hi;
  });
  if (inBand.length > 0) {
    const t = easing(current, target, direction);
    let best = inBand[0] as number;
    for (const l of inBand) {
      const d = Math.abs(easing(current, l, direction) - t);
      const bestD = Math.abs(easing(current, best, direction) - t);
      if (d < bestD || (d === bestD && easing(current, l, direction) > easing(current, best, direction))) best = l;
    }
    return best;
  }
  // Coarse kit: nothing in the band, so one step easier (the nearest easier load).
  let nearest = easier[0] as number;
  for (const l of easier) if (easing(current, l, direction) < easing(current, nearest, direction)) nearest = l;
  return nearest;
}

/** Whether `load` is inside rule 8's 5–10% band below `current`. */
export function isInStallResetBand(current: number, load: number, direction: LoadDirection): boolean {
  const e = easing(current, load, direction);
  const lo = easing(current, easierBy(current, STALL_RESET_MIN_PERCENT, direction), direction);
  const hi = easing(current, easierBy(current, STALL_RESET_MAX_PERCENT, direction), direction);
  return e >= lo && e <= hi;
}

/** Whether `load` is more than 10% easier than `current` (deeper than rule 8's band). */
export function deeperThanStallResetBand(current: number, load: number, direction: LoadDirection): boolean {
  return easing(current, load, direction) > easing(current, easierBy(current, STALL_RESET_MAX_PERCENT, direction), direction);
}
