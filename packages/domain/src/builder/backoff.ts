import type { TrainingGoal } from '@fizz/schemas';
import { loadForSet } from './loads';
import type { MainFocus } from './types';

/**
 * Back-off loads (Ben, D4, 22–23 Oct; set-structures SS4, history-targets HT8). Pure.
 *
 * - A back-off's load is worked out from its own reps and target RPE (the anchor's e1RM, Epley with RIR = 10 − RPE,
 *   as every other set: `loadForSet`), then rounded down to what this gym can load. Not a fixed 90 % or 95 %.
 * - Sanity band below the top set, by main focus: Strength 2–8 %, Balanced 4–10 %, Muscle 8–15 %. A worked-out load
 *   outside it is moved to its nearest edge, so a back-off is never at or above the top set.
 * - When today's top is lowered (Ben types a lighter top, the coach lowers it, a pain hold), the back-offs drop by
 *   the same %, rounded down (`lowerWithTop`). Raising the top never raises them.
 * - Assisted and added-weight lifts have no formula: their back-offs keep the working kg, as before (§3.1.6).
 */

/** How far below the top set a back-off may sit, as shares of the top (D4). */
export const BACKOFF_BANDS: Readonly<Record<MainFocus, { min: number; max: number }>> = {
  strength: { min: 0.02, max: 0.08 },
  balanced: { min: 0.04, max: 0.1 },
  muscle: { min: 0.08, max: 0.15 },
};

/** No focus set: Balanced (the middle band). */
export const DEFAULT_MAIN_FOCUS: MainFocus = 'balanced';

/** The band's focus from Ben's goal (Profile › training): strength → Strength, muscle → Muscle, both or not set → Balanced. */
export function mainFocusOf(goal: TrainingGoal | null | undefined): MainFocus {
  if (goal === 'strength') return 'strength';
  if (goal === 'muscle') return 'muscle';
  return DEFAULT_MAIN_FOCUS;
}

/** Float noise from the formula never pushes a load down a step. */
const tidy = (n: number): number => Math.round(n * 1000) / 1000;

export interface BackoffInput {
  /** The anchor's e1RM; null = no formula (assisted, added weight): the back-off keeps `working`. */
  anchorE1rm: number | null;
  /** The working kg, used when there's no formula. */
  working: number | null;
  reps: number;
  rpe: number;
  /** The top set's load the band is measured from (in the same unit); null = no top set: the formula's load as is. */
  top: number | null;
  focus?: MainFocus | undefined;
}

/**
 * `backoffLoad`: one back-off's load before rounding: from its reps and RPE, held inside the focus's band below `top`.
 * Round it down on the item (`roundDownHere`) after.
 */
export function backoffLoad(input: BackoffInput): number | null {
  const raw = loadForSet(input.anchorE1rm, input.working, input.reps, input.rpe);
  if (raw === null || input.anchorE1rm === null || input.top === null || !Number.isFinite(input.top) || input.top <= 0) return raw;
  const band = BACKOFF_BANDS[input.focus ?? DEFAULT_MAIN_FOCUS];
  const highest = input.top * (1 - band.min);
  const lowest = input.top * (1 - band.max);
  return tidy(Math.min(highest, Math.max(lowest, raw)));
}

/**
 * `lowerWithTop`: a back-off load when the top it was worked out from (`from`) is lowered to `to`: the same % lower.
 * Unchanged when the top isn't lower (raising the top never raises a back-off) or either is unknown.
 */
export function lowerWithTop(load: number | null, from: number | null, to: number | null): number | null {
  if (load === null || from === null || to === null || !(from > 0) || !(to < from)) return load;
  return tidy((load * to) / from);
}
