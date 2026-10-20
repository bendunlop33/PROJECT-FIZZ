/**
 * A chart's y-axis width (design pass 6.3, 20 Oct): wide enough for its widest tick label, so
 * `102.5` and `12,000` render in full instead of `10…`. Before the labels are measured, an
 * estimate from their length at the capped tick scale; never below the old 44pt.
 */

/** The tick labels' text-size cap (about 1.3×): the axis stays a quiet frame at large text. */
export const TICK_MAX_SCALE = 1.3;
export const MIN_AXIS_WIDTH = 44;
/** Room between the labels and the plot. */
export const AXIS_GAP = 8;
/** A tabular digit at the label size (13pt), with some room for `,` and `.`. */
const CHAR_WIDTH = 7.6;

/** `min`: the chart's own narrowest axis (the activity line's counts need only 24pt). */
export function axisWidthFor(labels: readonly string[], fontScale: number, measured: number | null = null, min = MIN_AXIS_WIDTH): number {
  const scale = Math.min(Math.max(fontScale, 1), TICK_MAX_SCALE);
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  const text = measured ?? longest * CHAR_WIDTH * scale;
  return Math.ceil(Math.max(min, text + AXIS_GAP));
}
