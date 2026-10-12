/**
 * Whether the open row's value tiles fit side by side (active-workout §2A.5,
 * WT-D13, WT40), pure so it's unit-tested at 375 and 390 pt. Tile numerals
 * shrink to fit, down to 28 pt, and are never clipped; when even 28 pt won't
 * fit beside the 52 pt (60 pt at AX1+) − / + buttons, the tiles stack full
 * width. At AX1+ they always stack. The width is measured on device
 * (`onLayout`); `openRowWidth` is the first-frame estimate from the window.
 *
 * Glyph widths are deliberately generous estimates for SF Pro tabular
 * digits, so a number is never clipped at the cost of stacking a little early.
 */

/** `NumberStepper` tile: horizontal padding (2 × space 2). */
export const TILE_PADDING_H = 16;
/** Gap between tiles (space 2). */
export const TILE_GAP = 8;
/** `type.loadDisplay` (D-ActiveSet): 38 pt, scaled with Dynamic Type up to 1.8×. */
export const NUMERAL_BASE = 38;
export const NUMERAL_MAX_SCALE = 1.8;
/** Never below this before the tiles stack (WT-D13). */
export const NUMERAL_MIN = 28;
/** The stacked fallback still shrinks a very long number rather than clip it. */
const NUMERAL_FLOOR = 18;
/** The field's own minimum width and caret room. */
const INPUT_MIN_WIDTH = 36;
const CARET = 6;
/** The ` s` unit after a TIME value: 18 pt, scaled up to 1.4×. */
const UNIT_SIZE = 18;
const UNIT_MAX_SCALE = 1.4;

/** Advance width per point of font size. Tabular digits are one width; `.` is narrow. */
function emPerChar(c: string): number {
  if (c >= '0' && c <= '9') return 0.64;
  if (c === '.' || c === ',') return 0.32;
  return 0.66;
}

/** Width (pt) of a numeral string per 1 pt of font size. */
export function numeralEms(text: string): number {
  let w = 0;
  for (const c of text) w += emPerChar(c);
  return w;
}

export interface TileSpec {
  /** Share of the row when side by side (LOAD 1.35, others 1). */
  flex: number;
  /** The numeral texts the tile may show now (value and its step targets); the longest decides. */
  texts: readonly string[];
  /** A unit after the numeral (` s` on TIME), or null. */
  unit: string | null;
}

export interface TileFitInput {
  /** The open row's content width (measured, or `openRowWidth`). */
  rowWidth: number;
  tiles: readonly TileSpec[];
  /** − / + size: 52 pt, 60 pt at AX1+. */
  stepSize: number;
  /** `useWindowDimensions().fontScale`. */
  fontScale: number;
  /** AX1+: always stacked (§2A.10). */
  ax: boolean;
}

export interface TileFit {
  stacked: boolean;
  /** The numeral's rendered size in pt (Dynamic Type already applied; render with font scaling off). */
  numeralSize: number;
}

const longest = (texts: readonly string[]): string => texts.reduce((a, b) => (numeralEms(b) > numeralEms(a) ? b : a), '');

/** The largest numeral size (pt) that fits a tile of this width; may be below the minimum. */
function maxSizeIn(tileWidth: number, tile: TileSpec, stepSize: number, fontScale: number): number {
  const unitW = tile.unit === null ? 0 : numeralEms(` ${tile.unit}`) * UNIT_SIZE * Math.min(fontScale, UNIT_MAX_SCALE);
  const room = tileWidth - TILE_PADDING_H - 2 * stepSize - unitW;
  if (room < INPUT_MIN_WIDTH) return 0;
  const ems = numeralEms(longest(tile.texts));
  return ems === 0 ? Number.POSITIVE_INFINITY : (room - CARET) / ems;
}

const floorHalf = (n: number): number => Math.floor(n * 2) / 2;

export function tileFit(p: TileFitInput): TileFit {
  const wanted = NUMERAL_BASE * Math.min(p.fontScale, NUMERAL_MAX_SCALE);
  const minimum = Math.min(NUMERAL_MIN, wanted);
  const stackedSize = (): number => {
    const fits = Math.min(...p.tiles.map((t) => maxSizeIn(p.rowWidth, t, p.stepSize, p.fontScale)));
    return floorHalf(Math.max(NUMERAL_FLOOR, Math.min(wanted, fits)));
  };
  if (p.tiles.length === 0) return { stacked: false, numeralSize: floorHalf(wanted) };
  if (p.ax || p.tiles.length === 1) return { stacked: p.ax && p.tiles.length > 1, numeralSize: stackedSize() };
  const totalFlex = p.tiles.reduce((a, t) => a + t.flex, 0);
  const free = p.rowWidth - TILE_GAP * (p.tiles.length - 1);
  const sideBySide = Math.min(...p.tiles.map((t) => maxSizeIn((free * t.flex) / totalFlex, t, p.stepSize, p.fontScale)));
  if (sideBySide >= minimum) return { stacked: false, numeralSize: floorHalf(Math.min(wanted, sideBySide)) };
  return { stacked: true, numeralSize: stackedSize() };
}

/**
 * The open row's content width for a window width, before it's measured:
 * the list's padding (2 × 16), the card body's (2 × 12), the open row's
 * −4 pt bleed each side, and its own padding (15 left, 12 right).
 */
export function openRowWidth(windowWidth: number): number {
  return Math.max(0, windowWidth - 2 * 16 - 2 * 12 + 2 * 4 - 15 - 12);
}

/** The texts a stepper may show: its value (or the `—` placeholder), its step targets, and at least `minDigits` digits. */
export function stepperTexts(value: number | null, down: { enabled: boolean; value?: number }, up: { enabled: boolean; value?: number }, minDigits: number): string[] {
  const steps = [down, up].flatMap((t) => (t.enabled && t.value !== undefined ? [String(t.value)] : []));
  return [value === null ? '—' : String(value), ...steps, '0'.repeat(minDigits)];
}
