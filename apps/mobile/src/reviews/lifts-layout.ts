import type { LiftView } from '@fizz/domain';

/**
 * The Lifts chart's geometry (Progress v3; the prototype `progress-simple.html` `liftChart`): pure, so it is
 * tested on Linux and the Skia canvas only draws what it is given. All lifts: one line per drawn lift in
 * real kg/lb on one axis (steps of 10), targets as short bars in a right gutter with a faint guide from the
 * newest point. One lift: its own scale (steps of 5), its target as a dashed line, and with an `at this
 * rate` estimate a dotted line to the target two columns past the last week.
 */

export interface ChartPoint {
  x: number;
  y: number;
  estimate: boolean;
  last: boolean;
  /** `100 × 6`, `est. 92.5 × 6 from 100 × 4`. */
  detail: string;
}

export interface ChartLine {
  key: string;
  colour: number;
  points: ChartPoint[];
  /** All lifts: the target's gutter bar and number, and the faint guide from the newest point. */
  gutter: { y: number; label: string; guideFromX: number } | null;
}

export interface LiftsChartLayout {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  ticks: { y: number; label: string }[];
  lines: ChartLine[];
  /** One lift: its target as a dashed line, labelled. */
  target: { y: number; label: string } | null;
  /** One lift: the dotted `at this rate` line (estimate). */
  eta: { x1: number; y1: number; x2: number; y2: number; label: string } | null;
  /** One lift: where its tracked reps changed (`now × 4`). */
  marker: { x: number; label: string } | null;
  /** The first and last week (or the eta's) under the axis. */
  xLabels: { x: number; text: string; anchor: 'start' | 'end' }[];
}

export const LIFTS_CHART = { height: 160, left: 30, top: 14, bottom: 22, gutterAll: 34, gutterOne: 12 } as const;
const WEEKS = 8;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * `focus`: the one lift shown alone, or null for every drawn lift. `weeks`: the 8 week labels. A line with
 * no points draws nothing; an all-empty chart has no lines (the table still lists the lifts).
 */
export function liftsChartLayout(input: { lifts: readonly LiftView[]; focus: string | null; weeks: readonly string[]; width: number; height?: number }): LiftsChartLayout {
  const W = input.width;
  const H = input.height ?? LIFTS_CHART.height;
  const one = input.focus === null ? null : (input.lifts.find((l) => l.exerciseId === input.focus) ?? null);
  const shown = one !== null ? [one] : input.lifts.filter((l) => l.colour !== null);
  const R = one !== null ? LIFTS_CHART.gutterOne : LIFTS_CHART.gutterAll;
  const L = LIFTS_CHART.left;
  const T = LIFTS_CHART.top;
  const B = LIFTS_CHART.bottom;
  const etaCols = one !== null && one.focus.eta !== null && one.target !== null ? one.focus.etaWeeks : 0;
  const cols = WEEKS + etaCols;
  const vals = shown.flatMap((l) => l.points.map((p) => p.value)).concat(shown.flatMap((l) => (l.target === null ? [] : [l.target])));
  const step = one !== null ? 5 : 10;
  const min = vals.length === 0 ? 0 : Math.min(...vals);
  const max = vals.length === 0 ? step : Math.max(...vals);
  const lo = Math.floor((min - 1) / step) * step;
  const hi = Math.max(lo + step, Math.ceil((max + 1) / step) * step);
  const x = (i: number) => L + (i * (W - L - R)) / (cols - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks: LiftsChartLayout['ticks'] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push({ y: y(v), label: fmt(v) });
  const lines: ChartLine[] = shown.map((l) => {
    const pts = l.points.map((p, i) => ({ x: x(p.week), y: y(p.value), estimate: p.estimate, last: i === l.points.length - 1, detail: p.detail }));
    const lastPt = pts.at(-1);
    const gutter = one === null && l.target !== null && lastPt !== undefined ? { y: y(l.target), label: fmt(l.target), guideFromX: lastPt.x } : null;
    return { key: l.exerciseId, colour: l.colour ?? 0, points: pts, gutter };
  });
  const target = one !== null && one.target !== null ? { y: y(one.target), label: `Target ${fmt(one.target)}` } : null;
  const lastOne = lines[0]?.points.at(-1);
  const eta = etaCols > 0 && one !== null && one.target !== null && lastOne !== undefined ? { x1: lastOne.x, y1: lastOne.y, x2: x(cols - 1), y2: y(one.target), label: one.focus.etaShort ?? '' } : null;
  const marker = one?.marker != null ? { x: x(one.marker.week), label: one.marker.label } : null;
  const xLabels: LiftsChartLayout['xLabels'] = [{ x: x(0), text: input.weeks[0] ?? '', anchor: 'start' }];
  if (eta !== null) xLabels.push({ x: W - R, text: eta.label, anchor: 'end' });
  else xLabels.push({ x: x(WEEKS - 1), text: input.weeks[WEEKS - 1] ?? '', anchor: 'end' });
  return { width: W, height: H, plot: { left: L, right: W - R, top: T, bottom: H - B }, ticks, lines, target, eta, marker, xLabels };
}

const dist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
};

/** The line nearest a tap, within `radius` (22 pt: a 44 pt target around a thin line); null otherwise. */
export function lineAt(layout: LiftsChartLayout, px: number, py: number, radius = 22): string | null {
  let best: { key: string; d: number } | null = null;
  for (const l of layout.lines) {
    const pts = l.points;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[i + 1] ?? a;
      if (a === undefined || b === undefined) continue;
      const d = dist2(px, py, a.x, a.y, b.x, b.y);
      if (best === null || d < best.d) best = { key: l.key, d };
    }
  }
  return best !== null && best.d <= radius * radius ? best.key : null;
}

/** The point nearest a tap within `radius` (its detail, for `est. 97.5 × 6 from 100 × 4`); null otherwise. */
export function pointAt(layout: LiftsChartLayout, px: number, py: number, radius = 22): ChartPoint | null {
  let best: { p: ChartPoint; d: number } | null = null;
  for (const l of layout.lines)
    for (const p of l.points) {
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (best === null || d < best.d) best = { p, d };
    }
  return best !== null && best.d <= radius * radius ? best.p : null;
}
