import type { TrendLayout } from './trend-layout';

/**
 * Pure geometry for Progress's small charts (progress.md §7.1; design-system
 * §9.70). The Skia component only draws these shapes; text sits in native views at the returned positions, so Dynamic
 * Type and VoiceOver work as everywhere else.
 */

export interface ActivityLineDims {
  height: number;
  /** Room on the leading edge for the Y labels. */
  axisWidth: number;
  /** Room at the trailing edge so the last point (and its ring) isn't clipped. */
  inset: number;
  /** Room above the top gridline for its label and the selected ring. */
  top: number;
}

export const ACTIVITY_LINE_DIMS: ActivityLineDims = { height: 132, axisWidth: 24, inset: 8, top: 10 };

/**
 * The activity line (Ben, 13 Oct 2026): one point per week or month, evenly
 * spaced, joined by one line (always a line, never bars or dots), from 0 at
 * the bottom to the top Y tick. Returned in `TrendCanvas`'s shape so the same
 * Skia drawing serves both charts.
 */
export function activityLineLayout(counts: readonly number[], yTicks: readonly number[], width: number, dims: ActivityLineDims): TrendLayout {
  const plot = { x: dims.axisWidth, y: dims.top, width: Math.max(1, width - dims.axisWidth - dims.inset), height: Math.max(1, dims.height - dims.top) };
  const top = Math.max(1, yTicks[yTicks.length - 1] ?? 1, ...counts);
  const yOf = (v: number) => plot.y + plot.height - (Math.max(0, v) / top) * plot.height;
  const n = counts.length;
  const xs = counts.map((_, i) => (n <= 1 ? plot.x + plot.width / 2 : plot.x + (i * plot.width) / (n - 1)));
  return {
    plot,
    xs,
    ys: counts.map(yOf),
    segments: n === 0 ? [] : [counts.map((_, i) => i)],
    yTicks: yTicks.map((v) => ({ y: yOf(v), label: String(v) })),
    months: [],
    bars: [],
  };
}

/** A `FrequencyRow` bar's filled width (0 to the track width). */
export function countBarWidth(fraction: number, trackWidth: number): number {
  if (!(fraction > 0) || trackWidth <= 0) return 0;
  return Math.max(2, Math.min(trackWidth, fraction * trackWidth));
}

/** A label of measured `width` centred under `x`, kept inside the chart: its left and right edges. */
export function measuredLabelBox(x: number, width: number, chartWidth: number): { left: number; right: number } {
  const left = Math.max(0, Math.min(chartWidth - width, x - width / 2));
  return { left, right: left + width };
}

/**
 * X labels thinned by their measured widths (device fix, 14 Oct 2026: at
 * `1 year`, `Aug 26` and `Oct 26` collided). First and last always show;
 * the others, left to right, only where they clear the last kept label and
 * the final one by `gap`. If even the first and last would touch, only the
 * last shows (the current end of the period). Returns indexes, ascending.
 */
export function thinLabelsByWidth(xs: readonly number[], widths: readonly number[], chartWidth: number, gap = 8): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const box = (i: number) => measuredLabelBox(xs[i] ?? 0, widths[i] ?? 0, chartWidth);
  if (n === 1) return [0];
  const last = box(n - 1);
  if (box(0).right + gap > last.left) return [n - 1];
  const out = [0];
  let prevRight = box(0).right;
  for (let i = 1; i < n - 1; i += 1) {
    const b = box(i);
    if (b.left >= prevRight + gap && b.right + gap <= last.left) {
      out.push(i);
      prevRight = b.right;
    }
  }
  out.push(n - 1);
  return out;
}

/** A width guess for a label not yet measured: generous, so nothing overlaps before the first layout. */
export function guessLabelWidth(text: string): number {
  return text.length * 9 + 4;
}
