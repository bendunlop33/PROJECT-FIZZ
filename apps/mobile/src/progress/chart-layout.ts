/**
 * Pure geometry for Progress's small charts (progress.md §7.1; design-system
 * §4.1 `chart.weekBars`, §9.70). The Skia component only draws these
 * rectangles; text sits in native views at the returned positions, so Dynamic
 * Type and VoiceOver work as everywhere else.
 */

export interface WeekBarsDims {
  height: number;
  maxBarWidth: number;
  gap: number;
  radius: number;
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** A 0 bar: drawn as a 2pt stub in `chart.grid`, so the week reads as empty, not missing. */
  zero: boolean;
  /** Centre, for the count above and the label under. */
  centreX: number;
}

export const ZERO_STUB = 2;

/**
 * Bars spread over `width`: each `(width − gaps) ÷ count` wide, at most
 * `maxBarWidth`, centred in its slot. Heights scale from 0 to `max` (the view
 * model passes max(3, largest) so one session never fills the plot).
 */
export function weekBarsLayout(counts: readonly number[], width: number, max: number, dims: WeekBarsDims): BarRect[] {
  const n = counts.length;
  if (n === 0 || width <= 0) return [];
  const slot = width / n;
  const barWidth = Math.max(1, Math.min(dims.maxBarWidth, (width - dims.gap * (n - 1)) / n));
  const scale = max > 0 ? dims.height / max : 0;
  return counts.map((c, i) => {
    const centreX = slot * i + slot / 2;
    const h = c <= 0 ? ZERO_STUB : Math.max(ZERO_STUB, Math.min(dims.height, c * scale));
    return { x: centreX - barWidth / 2, y: dims.height - h, width: barWidth, height: h, zero: c <= 0, centreX };
  });
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
