/**
 * The active workout's set table columns (Ben, 26 Oct; workout-table-v3 §2):
 * `SET | PREVIOUS | KG | REPS | RIR | ✓`, sized for 320–430 pt windows and
 * Dynamic Type. Pure, so the widths and text fit are unit-tested; the round
 * page draws with exactly these widths and font sizes (scaling already
 * applied, so the cells render with font scaling off and never clip).
 *
 * - SET, RIR and ✓ are fixed; PREVIOUS, KG and REPS share the rest by what
 *   their longest text needs.
 * - Too narrow at the base sizes: every flexible font shrinks together, down
 *   to a floor (values 14 pt, PREVIOUS 10 pt). If PREVIOUS still can't fit,
 *   it leaves its column and stacks under the row (`stackPrevious`), and KG
 *   and REPS take its room.
 * - Accessibility sizes (font scale ≥ `AX_FONT_SCALE`): block rows (one row
 *   per set, its values on a line, PREVIOUS on a line under it).
 *
 * Glyph widths are generous estimates for SF Pro tabular digits, so text is
 * never clipped at the cost of shrinking or stacking a little early.
 */
import { AX_FONT_SCALE } from './screen-rules';

/** Page padding (2 × 16) and card padding (2 × 12) around the table. */
export const TABLE_INSET = 56;
export const SET_COL_W = 36;
export const RIR_COL_W = 32;
export const TICK_COL_W = 40;
export const COL_GAP = 4;
/** Narrow windows (below 360 pt) tighten the fixed columns. */
const NARROW = { set: 34, rir: 28, tick: 36, gap: 3 } as const;

/** `type.rowValue` 19 pt (max 3×), PREVIOUS 12 pt (max 1.3×); the floors before stacking. */
export const VALUE_FONT = 19;
export const PREVIOUS_FONT = 12;
export const PREVIOUS_MAX_SCALE = 1.3;
export const VALUE_FONT_FLOOR = 14;
/** SET (`10`, `W`) at callout 16 pt, up to 1.3×; RIR at 15 pt, up to 1.4×. */
export const SET_FONT = 16;
export const SET_MAX_SCALE = 1.3;
export const RIR_FONT = 15;
export const RIR_MAX_SCALE = 1.4;
export const PREVIOUS_FONT_FLOOR = 10;
/** A boxed cell's inner padding (2 × 4) plus its border. */
const BOX_PAD = 11;

/** Advance width per point of font size (generous for SF Pro tabular digits). */
export function textEms(text: string): number {
  let w = 0;
  for (const c of text) {
    if (c >= '0' && c <= '9') w += 0.64;
    else if (c === '.' || c === ',') w += 0.32;
    else if (c === ' ' || c === ' ') w += 0.3;
    else if (c === '×') w += 0.62;
    else if (c === '—' || c === '–') w += 0.9;
    else if (c === '@') w += 0.9;
    else w += 0.66;
  }
  return w;
}

/** The text that needs the most room ('' for none). */
export function widestText(texts: readonly string[]): string {
  let best = '';
  for (const t of texts) if (textEms(t) > textEms(best)) best = t;
  return best;
}

const longest = (texts: readonly string[]): number => texts.reduce((m, t) => Math.max(m, textEms(t)), 0);

export interface SetColumnsInput {
  /** `useWindowDimensions().width`. */
  windowWidth: number;
  /** `useWindowDimensions().fontScale`. */
  fontScale: number;
  /** The exercise has a load column (not bodyweight or cardio). */
  hasLoad: boolean;
  /** The exercise has an RIR column (reps sets; not timed, distance or cardio). Default true. */
  hasRir?: boolean;
  /** The texts the columns show now (every row's PREVIOUS, KG and REPS), so the longest decides. */
  texts: { previous: readonly string[]; load: readonly string[]; value: readonly string[] };
}

export interface SetColumns {
  /** Accessibility sizes: block rows, no column header. */
  blockRows: boolean;
  /** The table's content width. */
  width: number;
  set: number;
  previous: number;
  load: number;
  value: number;
  rir: number;
  tick: number;
  gap: number;
  /** KG / REPS / RIR numerals, pt (Dynamic Type applied: render with font scaling off). */
  valueFont: number;
  /** PREVIOUS text, pt. */
  previousFont: number;
  /** SET label and RIR value, pt. */
  setFont: number;
  rirFont: number;
  /** PREVIOUS doesn't fit even at its floor: a small line under the row instead (its column is 0). */
  stackPrevious: boolean;
}

export function setColumns(p: SetColumnsInput): SetColumns {
  const width = Math.max(0, p.windowWidth - TABLE_INSET);
  const narrow = p.windowWidth < 360;
  const scale = Math.max(1, p.fontScale);
  const gap = narrow ? NARROW.gap : COL_GAP;
  const tick = narrow ? NARROW.tick : TICK_COL_W;
  // SET holds `10` (or `W`, `2L`) at 16 pt; RIR holds `1.5` at its own size (it never grows past 1.4×).
  const setFont = SET_FONT * Math.min(scale, SET_MAX_SCALE);
  const rirFont = RIR_FONT * Math.min(scale, RIR_MAX_SCALE);
  const set = Math.max(narrow ? NARROW.set : SET_COL_W, Math.ceil(textEms('10L') * setFont + 2));
  const rir = p.hasRir === false ? 0 : Math.max(narrow ? NARROW.rir : RIR_COL_W, Math.ceil(textEms('1.5') * rirFont + 6));
  const valueBase = VALUE_FONT * Math.min(scale, 3);
  const previousBase = PREVIOUS_FONT * Math.min(scale, PREVIOUS_MAX_SCALE);
  const blockRows = p.fontScale >= AX_FONT_SCALE;

  const loadEms = p.hasLoad ? Math.max(longest(p.texts.load), textEms('000')) : 0;
  const valueEms = Math.max(longest(p.texts.value), textEms('00'));
  const prevEms = Math.max(longest(p.texts.previous), textEms('—'));
  const loadPad = p.hasLoad ? BOX_PAD : 0;

  const layout = (withPrevious: boolean) => {
    const gaps = gap * ((p.hasLoad ? 5 : 4) - (withPrevious ? 0 : 1) - (rir === 0 ? 1 : 0));
    const room = Math.max(0, width - set - rir - tick - gaps);
    const need = (vf: number, pf: number) => (withPrevious ? prevEms * pf : 0) + loadEms * vf + loadPad + valueEms * vf + BOX_PAD;
    // The largest shared shrink (≤ 1) that fits; PREVIOUS no smaller than its floor, KG / REPS take what's left.
    const k = Math.min(1, room / Math.max(1, need(valueBase, previousBase)));
    const pf = withPrevious ? Math.max(PREVIOUS_FONT_FLOOR, previousBase * k) : previousBase;
    const vf = Math.min(valueBase, (room - (withPrevious ? prevEms * pf : 0) - loadPad - BOX_PAD) / Math.max(0.01, loadEms + valueEms));
    const used = need(vf, pf);
    const extra = Math.max(0, room - used);
    // Spare room goes to KG and REPS (the boxes Ben taps), PREVIOUS keeps what it needs plus a little.
    const prevW = withPrevious ? prevEms * pf + extra * 0.2 : 0;
    const share = withPrevious ? extra * 0.8 : extra;
    const loadNeed = loadEms * vf + loadPad;
    const valueNeed = valueEms * vf + BOX_PAD;
    const total = Math.max(0.01, loadNeed + valueNeed);
    return {
      fits: used <= room + 0.5 && vf >= VALUE_FONT_FLOOR - 0.01,
      previous: prevW,
      load: p.hasLoad ? loadNeed + (share * loadNeed) / total : 0,
      value: valueNeed + (share * valueNeed) / total,
      valueFont: vf,
      previousFont: pf,
    };
  };

  const inline = layout(true);
  const chosen = inline.fits ? inline : layout(false);
  const r = (x: number) => Math.floor(x * 10) / 10;
  return {
    blockRows,
    width,
    set,
    previous: r(chosen.previous),
    load: r(chosen.load),
    value: r(chosen.value),
    rir,
    tick,
    gap,
    valueFont: r(Math.max(VALUE_FONT_FLOOR, chosen.valueFont)),
    previousFont: r(inline.fits ? inline.previousFont : Math.max(PREVIOUS_FONT_FLOOR, previousBase)),
    stackPrevious: !inline.fits,
    setFont: r(setFont),
    rirFont: r(rirFont),
  };
}

/** Whether `text` fits `width` pt at `font` pt (the same estimate the layout uses). */
export function textFits(text: string, width: number, font: number): boolean {
  return textEms(text) * font <= width + 0.5;
}

/** A boxed value cell's text room: its column less padding and border. */
export function boxTextRoom(columnWidth: number): number {
  return Math.max(0, columnWidth - BOX_PAD);
}
