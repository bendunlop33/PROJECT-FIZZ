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
  /** A PB ring: all lifts, the newest point when it is a PB; one lift, every PB. */
  ring: boolean;
  /** `PB · Bench 100 × 6 · week of 13 Oct` (the ring's tap); null with no ring. */
  ringDetail: string | null;
  /** (Ben, 26 Oct) The workout the point's set was done in: a tap opens it. */
  sessionId: string;
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

/** The y-axis's most labels (hang fix, 27 Oct): a huge spread of values draws a capped axis, never an endless loop. */
const MAX_LABELS = 400;

/**
 * `focus`: the one lift shown alone, or null for every drawn lift. `weeks`: the 8 week labels. A line with
 * no points draws nothing; an all-empty chart has no lines (the table still lists the lifts).
 */
export function liftsChartLayout(input: { lifts: readonly LiftView[]; focus: string | null; weeks: readonly string[]; width: number; height?: number; /** Dynamic Type: the y-axis widens so its labels are never cut (Ben, 26 Oct). Absent: 1. */ fontScale?: number }): LiftsChartLayout {
  const W = input.width;
  const H = input.height ?? LIFTS_CHART.height;
  const one = input.focus === null ? null : (input.lifts.find((l) => l.exerciseId === input.focus) ?? null);
  const shown = one !== null ? [one] : input.lifts.filter((l) => l.colour !== null);
  const R = one !== null ? LIFTS_CHART.gutterOne : LIFTS_CHART.gutterAll;
  let L: number = LIFTS_CHART.left;
  const T = LIFTS_CHART.top;
  const B = LIFTS_CHART.bottom;
  const etaCols = one !== null && one.focus.eta !== null && one.target !== null ? one.focus.etaWeeks : 0;
  const cols = WEEKS + etaCols;
  // (Hang fix, 27 Oct) Only finite values scale the axis: an Infinity looped the label loop without end.
  const vals = shown.flatMap((l) => l.points.map((p) => p.value)).concat(shown.flatMap((l) => (l.target === null ? [] : [l.target]))).filter((v) => Number.isFinite(v));
  const step = one !== null ? 5 : 10;
  const min = vals.length === 0 ? 0 : Math.min(...vals);
  const max = vals.length === 0 ? step : Math.max(...vals);
  const lo = Math.floor((min - 1) / step) * step;
  const hi = Math.max(lo + step, Math.ceil((max + 1) / step) * step);
  const x = (i: number) => L + (i * (W - L - R)) / (cols - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const labels: string[] = [];
  for (let v = lo; v <= hi + 1e-9 && labels.length < MAX_LABELS; v += step) labels.push(fmt(v));
  L = liftsAxisLeft(labels, input.fontScale ?? 1);
  const ticks: LiftsChartLayout['ticks'] = [];
  for (let v = lo; v <= hi + 1e-9 && ticks.length < MAX_LABELS; v += step) ticks.push({ y: y(v), label: fmt(v) });
  const lines: ChartLine[] = shown.map((l) => {
    const pts = l.points.map((p, i) => {
      const last = i === l.points.length - 1;
      const ring = p.pb && (one !== null || last);
      return { x: x(p.week), y: y(p.value), estimate: p.estimate, last, detail: p.detail, ring, ringDetail: ring ? p.pbDetail : null, sessionId: p.sessionId };
    });
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

/** The y-axis labels: 11 pt tabular digits (a generous 0.6 em), capped at the ticks' 1.3× Dynamic Type, right-aligned 6 pt from the plot. */
export const LIFTS_AXIS = { digit: 6.6, maxScale: 1.3, gap: 6 } as const;

/** The plot's left edge: the 30 pt default, wider when the longest label at this text size needs it (no `10…`). */
export function liftsAxisLeft(labels: readonly string[], fontScale = 1): number {
  const s = Math.min(LIFTS_AXIS.maxScale, Math.max(1, fontScale));
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return Math.max(LIFTS_CHART.left, Math.ceil(longest * LIFTS_AXIS.digit * s) + LIFTS_AXIS.gap + 1);
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

/** The PB ring nearest a tap within `radius` (`PB · Bench 100 × 6 · week of 13 Oct`); null otherwise. */
export function ringAt(layout: LiftsChartLayout, px: number, py: number, radius = 16): ChartPoint | null {
  let best: { p: ChartPoint; d: number } | null = null;
  for (const l of layout.lines)
    for (const p of l.points) {
      if (!p.ring) continue;
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (best === null || d < best.d) best = { p, d };
    }
  return best !== null && best.d <= radius * radius ? best.p : null;
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

/**
 * The Lifts table's Current / Target cell (review progress-v3b-design S1): the `PB` tag, the number and the
 * load word (`each`, `stack`) wrap onto a second line rather than cut anything off; the number itself is never
 * shortened. Widths are conservative estimates for SF Pro at the table's sizes (13 pt semibold tabular digits,
 * 11 pt suffix, the 9.5 pt bold tag), scaled by Dynamic Type up to `maxScale` (the cell's text cap, as the
 * calendar's: a five-character load fits a 320 pt column whole at it).
 */
export const LIFT_TABLE = { dot: 10, gap: 6, rowPadding: 4, cols: 4, partGap: 4, digit: 8.2, suffixChar: 6.6, tag: 24, maxScale: 1.3 } as const;

export type LiftCellPart = 'pb' | 'number' | 'suffix';

/** One of the four equal columns (name, reps, current, target) of a table `tableWidth` wide. */
export function liftTableColumnWidth(tableWidth: number): number {
  return Math.max(0, (tableWidth - LIFT_TABLE.rowPadding - LIFT_TABLE.dot - LIFT_TABLE.gap * LIFT_TABLE.cols) / LIFT_TABLE.cols);
}

export function liftCellPartWidth(part: LiftCellPart, text: string, fontScale = 1): number {
  const s = Math.min(LIFT_TABLE.maxScale, Math.max(1, fontScale));
  if (part === 'pb') return LIFT_TABLE.tag * s;
  if (part === 'number') return text.length * LIFT_TABLE.digit * s;
  return (text.length + 1) * LIFT_TABLE.suffixChar * s;
}

/** The cell's lines, each right-aligned: greedy, in the order tag, number, suffix; a part too wide alone still gets its own line. */
export function liftCellLines(input: { width: number; number: string; suffix: string | null; pb: boolean; fontScale?: number }): LiftCellPart[][] {
  const parts: { part: LiftCellPart; w: number }[] = [];
  const s = Math.min(LIFT_TABLE.maxScale, input.fontScale ?? 1);
  if (input.pb) parts.push({ part: 'pb', w: liftCellPartWidth('pb', '', s) });
  parts.push({ part: 'number', w: liftCellPartWidth('number', input.number, s) });
  if (input.suffix !== null) parts.push({ part: 'suffix', w: liftCellPartWidth('suffix', input.suffix, s) });
  const lines: LiftCellPart[][] = [];
  let line: LiftCellPart[] = [];
  let used = 0;
  for (const p of parts) {
    const need = line.length === 0 ? p.w : used + LIFT_TABLE.partGap + p.w;
    if (line.length > 0 && need > input.width) {
      lines.push(line);
      line = [p.part];
      used = p.w;
    } else {
      line.push(p.part);
      used = need;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * The Lifts table's name (Ben, 26 Oct: "the text for lift cuts off under the chart"): never cut. It wraps in
 * its column when it fits on two lines there with no word broken; otherwise the row stacks, the name on its
 * own line across the row and the numbers on the line under it, in their columns. 13 pt semibold, a
 * generous 0.58 em a character (spaces included), scaled with Dynamic Type up to the callout's 3×.
 */
export const LIFT_NAME = { char: 7.6, maxLines: 2, maxScale: 3 } as const;

/** Lines `name` needs in `width` (greedy word wrap); Infinity when a word alone is wider than the column. */
export function liftNameLines(name: string, width: number, fontScale = 1): number {
  const s = Math.min(LIFT_NAME.maxScale, Math.max(1, fontScale));
  const ch = LIFT_NAME.char * s;
  if (width <= 0) return Number.POSITIVE_INFINITY;
  let lines = 1;
  let used = 0;
  for (const word of name.split(/\s+/).filter((w) => w.length > 0)) {
    const w = word.length * ch;
    if (w > width) return Number.POSITIVE_INFINITY;
    const need = used === 0 ? w : used + ch + w;
    if (need > width) {
      lines += 1;
      used = w;
    } else used = need;
  }
  return lines;
}

/** The row puts the name on its own line (it can't fit its column on two lines whole). */
export function liftRowStacked(name: string, column: number, fontScale = 1): boolean {
  return liftNameLines(name, column, fontScale) > LIFT_NAME.maxLines;
}

/** The stacked name's width: the table less the row padding, the dot and its gap. */
export function liftStackedNameWidth(tableWidth: number): number {
  return Math.max(0, tableWidth - LIFT_TABLE.rowPadding - LIFT_TABLE.dot - LIFT_TABLE.gap);
}
