import type { StripItem } from '@fizz/domain';

import { progressPalette, withAlpha } from '../reviews/palette';
import type { ResolvedTheme } from '../theme';

/**
 * The 7-day strip's pills (workout-builder-v3 §2.0.2 region 3, Ben 21 Oct; prototypes/today-v2.html
 * `.pip`): a done session is a soft-green pill (the Progress chips' green, `progressPalette`), a planned
 * day or the chosen session today a dashed outline, cardio its own tint (dashed when planned), Rest text
 * only. No `✓`. Colour is never the only signal (fill vs dashed outline; VoiceOver says done / Planned).
 * Pure, so it is tested without a renderer.
 */

/** Cardio's tint: the prototype's `--run` / `--run-sub` (not a design-system token yet, like Progress's palette). */
export const RUN_TINT = { dark: { text: '#7FB2E5', fill: '#172636' }, light: { text: '#1F5F99', fill: '#E3EEF8' } } as const;

/**
 * One line, centred, shrinking to fit rather than cut off (§2.0.2 region 3). The text grows with Dynamic Type
 * only up to `maxFontSizeMultiplier` (the column is fixed; accessibility sizes get the 7-row list instead).
 */
export const STRIP_LABEL_FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75, maxFontSizeMultiplier: 1.1 } as const;

/**
 * The strip's geometry (review today-fix-21oct B2): the prototype's `.pip` (9.5 px, −0.02 em) at about 10 pt,
 * slightly tight, with 1 pt of pill padding, so `Shoulders` fits a 375 pt column at the shrink floor.
 */
export const STRIP_LAYOUT = {
  /** Gap between the seven cells, and the divider before Monday. */
  cellGap: 2,
  divider: 1,
  /** Each cell's and each pill's horizontal padding, and the pill's border; today's cell has the accent outline. */
  cellPadding: 1,
  todayBorder: 1,
  pillPadding: 1,
  pillBorder: 1,
  fontSize: 10,
  lineHeight: 13,
  letterSpacing: -0.2,
} as const;

/** The width a pill's label has in one column: the screen less its margins, gaps and divider, over seven, less paddings and borders. */
export function stripLabelBudget(screenWidth: number, screenMargin: number, today = false): number {
  const L = STRIP_LAYOUT;
  const cell = (screenWidth - 2 * screenMargin - 6 * L.cellGap - L.divider) / 7;
  return cell - 2 * L.cellPadding - 2 * L.pillPadding - 2 * L.pillBorder - (today ? 2 * L.todayBorder : 0);
}

/**
 * Advance widths (em) of SF Pro Text Regular, rounded up: an estimate for checking the column budget in tests
 * (no renderer). Unknown characters count as wide.
 */
const ADVANCE: Readonly<Record<string, number>> = {
  ' ': 0.27, '·': 0.28, '.': 0.27, '-': 0.4, ...Object.fromEntries([...'0123456789'].map((d) => [d, 0.6])),
  a: 0.55, b: 0.6, c: 0.55, d: 0.6, e: 0.57, f: 0.36, g: 0.6, h: 0.58, i: 0.25, j: 0.25, k: 0.53, l: 0.25, m: 0.88, n: 0.58, o: 0.59, p: 0.6, q: 0.6, r: 0.38, s: 0.52, t: 0.36, u: 0.58, v: 0.53, w: 0.79, x: 0.52, y: 0.53, z: 0.52,
  A: 0.66, B: 0.65, C: 0.7, D: 0.71, E: 0.6, F: 0.57, G: 0.72, H: 0.73, I: 0.26, J: 0.5, K: 0.66, L: 0.55, M: 0.86, N: 0.74, O: 0.75, P: 0.63, Q: 0.75, R: 0.65, S: 0.62, T: 0.6, U: 0.72, V: 0.65, W: 0.95, X: 0.64, Y: 0.62, Z: 0.61,
};

/** A label's estimated width in points at `fontSize`, with the strip's letter spacing. */
export function estimateLabelWidth(text: string, fontSize: number, letterSpacing: number = STRIP_LAYOUT.letterSpacing): number {
  const chars = [...text];
  return chars.reduce((w, ch) => w + (ADVANCE[ch] ?? 0.8) * fontSize, 0) + letterSpacing * chars.length;
}

/** Whether a label fits its column without `…` at the largest text the strip allows, after shrinking to the floor. */
export function stripLabelFits(text: string, screenWidth: number, screenMargin: number, today = false): boolean {
  const largest = STRIP_LAYOUT.fontSize * STRIP_LABEL_FIT.maxFontSizeMultiplier;
  const floor = largest * STRIP_LABEL_FIT.minimumFontScale;
  return estimateLabelWidth(text, floor, STRIP_LAYOUT.letterSpacing * STRIP_LABEL_FIT.minimumFontScale) <= stripLabelBudget(screenWidth, screenMargin, today);
}

export interface StripPillStyle {
  backgroundColor: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor: string;
  color: string;
}

export function stripPillStyle(item: Pick<StripItem, 'kind' | 'planned'>, theme: Pick<ResolvedTheme, 'colors' | 'scheme'>): StripPillStyle {
  const pal = progressPalette(theme);
  const run = RUN_TINT[theme.scheme];
  const none = 'transparent';
  switch (item.kind) {
    case 'workout':
      return { backgroundColor: pal.doneFill, borderWidth: 1, borderStyle: 'solid', borderColor: pal.doneEdge, color: theme.colors['text.primary'] };
    case 'activity':
      return item.planned
        ? { backgroundColor: none, borderWidth: 1, borderStyle: 'dashed', borderColor: run.text, color: run.text }
        : { backgroundColor: run.fill, borderWidth: 1, borderStyle: 'solid', borderColor: withAlpha(run.text, 0.4), color: run.text };
    case 'plan_day':
    case 'today':
      return { backgroundColor: none, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['text.tertiary'], color: theme.colors['text.secondary'] };
    case 'rest':
      return { backgroundColor: none, borderWidth: 0, borderStyle: 'solid', borderColor: none, color: theme.colors['text.tertiary'] };
  }
}
