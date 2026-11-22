import type { CheckInScore } from '@fizz/schemas';

/**
 * Small screen-side rules shared across screens (first made for the Workout
 * overview, workout-overview.md, retired 22 Oct). Pure, so they run on
 * Linux. Nothing here computes a target, marker or duration.
 */

/**
 * Where the pre-workout check-in sheet goes when Ben finishes it (§2.2).
 * Over a pre-start page (`mode: 'overview'`: Your workout's check-in) or
 * with no gym to start at, it never starts a workout: `Done`, `Skip`,
 * `Not now`, `Flag n movements`, `Train anyway` and a 4–5 at the score all
 * return to the page, whose Start links the check-in. `Skip workout` is
 * separate: it always closes to Today.
 */
export function checkInSheetEnd(p: { overview: boolean; gymId: string | null }): 'back_to_overview' | 'start_workout' {
  return p.overview || p.gymId === null ? 'back_to_overview' : 'start_workout';
}

/** VoiceOver for a tile: `1 of 5, rough` … `5 of 5, great`. */
export function tileLabel(n: CheckInScore): string {
  return `${String(n)} of 5${n === 1 ? ', rough' : n === 5 ? ', great' : ''}`;
}

/** At AX1 and above (RN font scale ≈ 1.6+): strips and rows stack, the tiles collapse. */
export const AX_FONT_SCALE = 1.6;

/** Where a stat value was seen wrapping in its column (onTextLayout): the window width and font scale then. */
export interface StripWrap {
  width: number;
  fontScale: number;
}

/**
 * Whether the stat strip stacks (OV14; review r2 S2): at AX sizes, or once a
 * value (`≈ 19:05`) was measured wrapping in its column at this width and
 * text size, which can happen from xLarge up. Sticky for that width and
 * scale, so the strip doesn't flip back when the stacked values (full
 * width, one line) report no wrap.
 */
export function statStripStacked(p: { ax: boolean; width: number; fontScale: number; wrappedAt: StripWrap | null }): boolean {
  if (p.ax) return true;
  return p.wrappedAt !== null && p.wrappedAt.width === p.width && p.wrappedAt.fontScale === p.fontScale;
}
