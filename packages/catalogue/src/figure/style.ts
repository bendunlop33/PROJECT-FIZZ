/**
 * Guide colours (research §5.5): aliases of existing design-system tokens,
 * never `accent`, no new colour values. The app builds a `GuideStyle` from its
 * live theme with `guideStyleFromTokens`; the Linux renderer uses the mirror
 * below (Direction D, the provisional default look). `test/figure-style.test.ts`
 * fails if the mirror drifts from apps/mobile/src/theme/tokens.ts.
 */
import type { Paint } from './props';

/** The only tokens a guide may use. `accent` is deliberately not one of them. */
export const GUIDE_TOKEN_NAMES = ['bg.surface', 'bg.raised', 'border.control', 'text.primary', 'text.secondary', 'text.tertiary'] as const;
export type GuideTokenName = (typeof GUIDE_TOKEN_NAMES)[number];
export type GuideTokens = Record<GuideTokenName, string>;

export type GuideStyle = Record<Paint, string>;

/** Paint → token alias table (research §5.5). */
export const GUIDE_PAINT_TOKENS = {
  background: 'bg.surface',
  nearBody: 'text.secondary',
  farBody: 'border.control',
  implement: 'text.primary',
  trace: 'text.tertiary',
  cable: 'text.tertiary',
  frame: 'border.control',
  frameFill: 'bg.raised',
} as const satisfies Record<Paint, GuideTokenName>;

export function guideStyleFromTokens(tokens: GuideTokens): GuideStyle {
  const out = {} as GuideStyle;
  for (const [paint, token] of Object.entries(GUIDE_PAINT_TOKENS) as [Paint, GuideTokenName][]) out[paint] = tokens[token];
  return out;
}

/** Mirror of Direction D ("Premium") in apps/mobile/src/theme/tokens.ts. */
export const DIRECTION_D_GUIDE_TOKENS: Record<'dark' | 'light', GuideTokens> = {
  dark: {
    'bg.surface': '#181615',
    'bg.raised': '#23201E',
    'border.control': '#75706A',
    'text.primary': '#F3EEE8',
    'text.secondary': '#B5ADA5',
    'text.tertiary': '#948C84',
  },
  light: {
    'bg.surface': '#FFFFFF',
    'bg.raised': '#EEE9E3',
    'border.control': '#857D75',
    'text.primary': '#15120F',
    'text.secondary': '#57504A',
    'text.tertiary': '#6B645D',
  },
};

/** `radius.md` (design-system §4), as a fraction of a 240 pt guide canvas. */
export const GUIDE_CORNER_FRACTION = 12 / 240;
