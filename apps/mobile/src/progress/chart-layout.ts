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

/**
 * Which week labels to show: first and last always, others only when each
 * label has `minLabelWidth` of room (§9.70). Returns indexes.
 */
export function visibleLabels(count: number, width: number, minLabelWidth: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const slot = width / count;
  const step = Math.max(1, Math.ceil(minLabelWidth / Math.max(1, slot)));
  const out = new Set<number>([0, count - 1]);
  for (let i = step; i < count - 1; i += step) if (count - 1 - i >= step || step === 1) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/** A `FrequencyRow` bar's filled width (0 to the track width). */
export function countBarWidth(fraction: number, trackWidth: number): number {
  if (!(fraction > 0) || trackWidth <= 0) return 0;
  return Math.max(2, Math.min(trackWidth, fraction * trackWidth));
}

/** The room each X label needs before labels are thinned: a month (`Oct`, `Oct 25`), a week's start (`14 Sep`). */
export function barLabelRoom(unit: 'week' | 'month'): number {
  return unit === 'month' ? 44 : 52;
}

/**
 * F15: where a bar's label box sits, centred under the bar but kept inside
 * the chart, so the first and last labels never hang off an edge (60 days
 * read misaligned). The clamp uses the label's own width (`labelWidth`,
 * e.g. `barLabelRoom(kind)`), not the wider box, so a label that fits
 * centred stays over its bar (review S2: 7/14-day edge labels sat ~18 pt
 * off). `align` keeps the text against the edge when clamped.
 */
export function barLabelBox(centreX: number, chartWidth: number, boxWidth: number, labelWidth: number = boxWidth): { left: number; align: 'center' | 'flex-start' | 'flex-end' } {
  const half = Math.min(labelWidth, boxWidth) / 2;
  if (centreX - half < 0) return { left: 0, align: 'flex-start' };
  if (centreX + half > chartWidth) return { left: Math.max(0, chartWidth - boxWidth), align: 'flex-end' };
  return { left: centreX - boxWidth / 2, align: 'center' };
}
