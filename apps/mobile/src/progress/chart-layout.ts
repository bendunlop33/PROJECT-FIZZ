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
  /** The window cut this week (or month): drawn lighter, so a one-day bar never reads as an empty week. */
  partial: boolean;
}

/** How much of the bar colour a part week keeps (the rest is the card behind it). */
export const PARTIAL_BAR_MIX = 0.45;

/** `#RRGGBB` `fg` over `bg` at `amount` (0–1), as an opaque `#RRGGBB`. Anything else returns `fg`. */
export function mixHex(fg: string, bg: string, amount: number): string {
  const parse = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const a = parse(fg);
  const b = parse(bg);
  if (a === null || b === null) return fg;
  const t = Math.max(0, Math.min(1, amount));
  return `#${a.map((v, i) => Math.round(v * t + (b[i] ?? 0) * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}

export const ZERO_STUB = 2;

/**
 * Bars spread over `width`: each `(width − gaps) ÷ count` wide, at most
 * `maxBarWidth`, centred in its slot. Heights scale from 0 to `max` (the view
 * model passes max(3, largest) so one session never fills the plot).
 */
export function weekBarsLayout(counts: readonly number[], width: number, max: number, dims: WeekBarsDims, partial: readonly boolean[] = []): BarRect[] {
  const n = counts.length;
  if (n === 0 || width <= 0) return [];
  const slot = width / n;
  const barWidth = Math.max(1, Math.min(dims.maxBarWidth, (width - dims.gap * (n - 1)) / n));
  const scale = max > 0 ? dims.height / max : 0;
  return counts.map((c, i) => {
    const centreX = slot * i + slot / 2;
    const h = c <= 0 ? ZERO_STUB : Math.max(ZERO_STUB, Math.min(dims.height, c * scale));
    return { x: centreX - barWidth / 2, y: dims.height - h, width: barWidth, height: h, zero: c <= 0, centreX, partial: partial[i] === true };
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

/**
 * F15: the room each bar label needs before labels are thinned: a day's
 * letter or date (`M`, `14`), a month (`Oct`, `Oct 25`), a week's start (`14 Sep`).
 */
export function barLabelRoom(kind: 'days' | 'weeks' | 'months'): number {
  return kind === 'days' ? 22 : kind === 'months' ? 44 : 52;
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

/** F15: a count shows above a bar only when there was a session (zero bars stay a quiet stub). */
export function showsBarCount(count: number): boolean {
  return count > 0;
}
