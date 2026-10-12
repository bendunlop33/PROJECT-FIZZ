import { addDays, daysBetween } from '@fizz/domain';

/**
 * Pure geometry for the exercise `TrendChart` (progress.md §7.1,
 * design-system §9.23): scales, y ticks, month ticks, gap-broken segments,
 * volume bars, marker positions and the nearest point to a tap. The Skia
 * canvas only draws what this returns; every label is a native `Text` placed
 * at these positions (Dynamic Type, Bold Text, VoiceOver).
 */

export interface TrendLayoutPoint {
  date: string;
  value: number;
  breakBefore: boolean;
}

export interface TrendLayoutInput {
  points: readonly TrendLayoutPoint[];
  /** The chart range (x domain), inclusive local dates. */
  from: string;
  to: string;
  width: number;
  height: number;
  /** Volume: bars from 0; otherwise a line whose y range fits the data. */
  bars: boolean;
  format: 'number' | 'duration';
  /** Room on the leading edge for the y labels. */
  axisWidth: number;
  /** Room left at the trailing edge so the last point (and its ring) isn't clipped. */
  inset: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrendLayout {
  plot: Rect;
  xs: number[];
  ys: number[];
  /** Runs of point indexes joined by the line; a gap starts a new run (PG12). */
  segments: number[][];
  yTicks: { y: number; label: string }[];
  months: { x: number; label: string }[];
  bars: Rect[];
}

/** A y value as an axis label: `120`, `102.5`, `12,000`, or `1:30` for holds. */
export function axisLabel(v: number, format: 'number' | 'duration'): string {
  if (format === 'duration') {
    const s = Math.max(0, Math.round(v));
    return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
  }
  const rounded = Math.round(v * 100) / 100;
  const [whole, frac] = String(Math.abs(rounded)).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '−' : ''}${grouped}${frac === undefined ? '' : `.${frac}`}`;
}

/** 3–4 round tick values covering [min, max] (steps of 1, 2, 2.5 or 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  const raw = (max - min) / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  // The largest round step that still gives at least 3 ticks inside [min, max].
  const steps = [10, 5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1].map((m) => m * mag);
  const ticksFor = (step: number) => {
    const first = Math.ceil(min / step - 1e-9) * step;
    const out: number[] = [];
    for (let v = first; v <= max + 1e-9 && out.length < 8; v += step) out.push(Math.round(v * 1000) / 1000 || 0);
    return out;
  };
  const out = ticksFor(steps.find((st) => ticksFor(st).length >= 3) ?? (steps[steps.length - 1] as number));
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The x of a local date inside the plot. */
export function dateX(date: string, from: string, to: string, plot: Pick<Rect, 'x' | 'width'>): number {
  const span = Math.max(1, daysBetween(from, to));
  const t = Math.min(1, Math.max(0, daysBetween(from, date) / span));
  return plot.x + t * plot.width;
}

/** First-of-month ticks inside (from, to]; thinned so labels get ≥ `minGap` of room. January carries its year when the range spans years. */
export function monthTicks(from: string, to: string, plot: Pick<Rect, 'x' | 'width'>, minGap = 44): { x: number; label: string }[] {
  const out: { date: string; x: number }[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < 1200; i += 1) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
    if (date > to) break;
    out.push({ date, x: dateX(date, from, to, plot) });
  }
  if (out.length === 0) return [];
  const spansYears = from.slice(0, 4) !== to.slice(0, 4);
  const per = out.length > 1 ? (out[out.length - 1]?.x ?? 0) - (out[0]?.x ?? 0) : plot.width;
  const step = out.length > 1 ? Math.max(1, Math.ceil(minGap / Math.max(1, per / (out.length - 1)))) : 1;
  // Long ranges keep quarter, half-year or year starts so the ticks stay meaningful.
  const keep: readonly number[] | null = step >= 12 ? [1] : step >= 6 ? [1, 7] : step >= 3 ? [1, 4, 7, 10] : null;
  return out
    .filter((t, i) => (keep === null ? i % step === 0 : keep.includes(Number(t.date.slice(5, 7)))))
    .map((t) => {
      const month = Number(t.date.slice(5, 7));
      return { x: t.x, label: spansYears && month === 1 ? t.date.slice(0, 4) : (MONTHS[month - 1] ?? '') };
    });
}

export function trendLayout(input: TrendLayoutInput): TrendLayout {
  const plot: Rect = { x: input.axisWidth, y: 8, width: Math.max(1, input.width - input.axisWidth - input.inset), height: Math.max(1, input.height - 16) };
  const values = input.points.map((p) => p.value);
  let lo = values.length > 0 ? Math.min(...values) : 0;
  let hi = values.length > 0 ? Math.max(...values) : 1;
  if (input.bars) lo = 0;
  if (hi - lo < 1e-9) {
    const pad = Math.max(1, Math.abs(hi) * 0.05);
    lo = input.bars ? 0 : lo - pad;
    hi += pad;
  } else if (!input.bars) {
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  } else {
    hi += (hi - lo) * 0.08;
  }
  const ticks = niceTicks(lo, hi, 4);
  if (ticks.length > 0 && !input.bars) {
    lo = Math.min(lo, ticks[0] ?? lo);
    hi = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  }
  const yOf = (v: number) => plot.y + plot.height - ((v - lo) / Math.max(1e-9, hi - lo)) * plot.height;
  const xs = input.points.map((p) => dateX(p.date, input.from, input.to, plot));
  const ys = input.points.map((p) => yOf(p.value));
  const segments: number[][] = [];
  input.points.forEach((p, i) => {
    if (i === 0 || p.breakBefore) segments.push([i]);
    else segments[segments.length - 1]?.push(i);
  });
  const span = Math.max(1, daysBetween(input.from, input.to));
  const barWidth = Math.max(2, Math.min(12, (plot.width / Math.max(1, input.points.length)) * 0.6, (plot.width / span) * 5));
  const bars = input.bars
    ? input.points.map((p, i) => {
        const top = yOf(p.value);
        const base = yOf(0);
        return { x: (xs[i] ?? 0) - barWidth / 2, y: top, width: barWidth, height: Math.max(1, base - top) };
      })
    : [];
  return {
    plot,
    xs,
    ys,
    segments,
    yTicks: ticks.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).map((v) => ({ y: yOf(v), label: axisLabel(v, input.format) })),
    months: monthTicks(input.from, input.to, plot),
    bars,
  };
}

/** The point nearest to a tap's x (the whole plot is the hit area, §4.2). −1 with no points. */
export function nearestPointIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let dist = Infinity;
  xs.forEach((px, i) => {
    const d = Math.abs(px - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** A marker's x in the lane: a gap sits midway between its two sessions; others on their date. */
export function markerX(m: { date: string; from: string | null }, from: string, to: string, plot: Pick<Rect, 'x' | 'width'>): number {
  if (m.from === null) return dateX(m.date, from, to, plot);
  const mid = addDays(m.from, Math.round(daysBetween(m.from, m.date) / 2));
  return dateX(mid, from, to, plot);
}
