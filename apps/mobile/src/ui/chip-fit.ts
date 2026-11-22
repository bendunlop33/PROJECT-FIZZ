/**
 * (Ben, 2 Nov: "This page formatting is broken") How many equal answer chips fit across a row without a label
 * wrapping mid-word. Pure (no React Native), so it is tested at 320 / 375 / 390 pt and with larger Dynamic Type.
 *
 * Labels are measured with a conservative per-character estimate of SF Pro at the chip's label size (16 pt, medium);
 * the chip's label also shrinks to 85% as a last resort (`adjustsFontSizeToFit`), which covers the semibold selected state. The grid drops to fewer columns (4 → 2 → 1, 7 → 4 → 1, 3 → 1) until the widest label fits
 * on one line; at one column a label that still doesn't fit wraps at word boundaries in a full-width chip.
 */

/** Approximate advance widths in em for SF Pro Text, medium weight. Rounded up. */
function charEm(ch: string): number {
  if (ch === ' ') return 0.28;
  if ('iljI|!.,:;\''.includes(ch)) return 0.27;
  if ('frt()[]/'.includes(ch)) return 0.4;
  if (ch === '-' || ch === '–') return 0.45;
  if (/[0-9]/.test(ch)) return 0.62;
  if (ch === 'm' || ch === 'w') return 0.86;
  if (ch === 'M' || ch === 'W') return 0.96;
  if (/[A-Z]/.test(ch)) return 0.72;
  if (/[a-z]/.test(ch)) return 0.57;
  // ✦ ★ × ＋ − and anything else: a full-ish glyph.
  return 0.9;
}

/** A one-line label's estimated width in points at `fontSize` × `fontScale` (at or over SF Pro's real width; checked against Ben's screenshot). */
export function estimateLabelWidth(label: string, fontSize: number, fontScale: number): number {
  let em = 0;
  for (const ch of label) em += charEm(ch);
  return em * fontSize * fontScale;
}

/** The chip's inline ✦ (11 pt) and its 4 pt gap, before the label. */
export const RECOMMENDED_MARK_WIDTH = 14;

export interface ChipGridInput {
  labels: readonly string[];
  /** Per label: it has the inline ✦ (`RECOMMENDED_MARK_WIDTH`, scaled), else not. */
  marked?: readonly boolean[];
  /** The row's width in points (measured, or the window width less the screen margins before it is). */
  width: number;
  /** The most columns wanted (the number of chips for one row). */
  columns: number;
  /** Dynamic Type scale (`useWindowDimensions().fontScale`), capped at the label token's `maxScale`. */
  fontScale: number;
  gap?: number;
  /** The chip's horizontal padding plus border, each side. */
  inset?: number;
  fontSize?: number;
  maxScale?: number;
}

export interface ChipGrid {
  columns: number;
  /** Every label fits on one line at this column count: render with `numberOfLines={1}`. */
  oneLine: boolean;
}

/** The column counts tried, widest first: full rows only (divisors of the count), plus half (rounded up) from 5 chips. */
export function chipColumnCandidates(count: number, columns: number): number[] {
  const per = Math.max(1, Math.min(columns, count));
  const out = [per];
  for (let c = per - 1; c >= 1; c -= 1) {
    if (count % c === 0 || (count >= 5 && c === Math.ceil(count / 2))) out.push(c);
  }
  return out;
}

/** The inner (label) width of one chip when `columns` share `width`. */
export function chipLabelRoom(width: number, columns: number, gap: number, inset: number): number {
  return (width - gap * (columns - 1)) / columns - 2 * inset;
}

export function chipGrid(p: ChipGridInput): ChipGrid {
  const gap = p.gap ?? 8;
  const inset = p.inset ?? 13;
  const fontSize = p.fontSize ?? 16;
  const scale = Math.min(Math.max(p.fontScale, 0), p.maxScale ?? 3);
  const widest = Math.max(0, ...p.labels.map((l, i) => estimateLabelWidth(l, fontSize, scale) + (p.marked?.[i] === true ? RECOMMENDED_MARK_WIDTH * scale : 0)));
  for (const c of chipColumnCandidates(p.labels.length, p.columns)) {
    if (widest <= chipLabelRoom(p.width, c, gap, inset)) return { columns: c, oneLine: true };
  }
  return { columns: 1, oneLine: false };
}

export interface TableFitInput {
  /** Each row's cells; the first column is the name (wraps at word boundaries), the rest are values on one line. */
  rows: readonly (readonly string[])[];
  /** The table's inner width in points. */
  width: number;
  fontScale: number;
  gap?: number;
  fontSize?: number;
  maxScale?: number;
  /** The share of the width the name column keeps at least. */
  nameShare?: number;
}

/**
 * (Ben, 2 Nov: `Week 6 (est.)` wrapped and clipped) The value columns' widths: each sized to its widest cell (header
 * included) so it stays on one line, the name column taking the rest. When the values would squeeze the name column
 * under `nameShare` (25%) they are scaled down together (the cells then shrink to fit, `adjustsFontSizeToFit`).
 */
export function tableValueWidths(p: TableFitInput): number[] {
  const gap = p.gap ?? 8;
  const fontSize = p.fontSize ?? 16;
  const scale = Math.min(Math.max(p.fontScale, 0), p.maxScale ?? 3);
  const cols = Math.max(0, ...p.rows.map((r) => r.length)) - 1;
  if (cols <= 0) return [];
  const want = Array.from({ length: cols }, (_, i) => Math.ceil(Math.max(0, ...p.rows.map((r) => estimateLabelWidth(r[i + 1] ?? '', fontSize, scale)))));
  const room = Math.max(0, (p.width - gap * cols) * (1 - (p.nameShare ?? 0.25)));
  const total = want.reduce((a, b) => a + b, 0);
  return total <= room ? want : want.map((w) => Math.floor((w * room) / total));
}
