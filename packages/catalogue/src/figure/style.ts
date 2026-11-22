/**
 * Guide colours (research §5.5, design-system §2.3): aliases of existing
 * design-system tokens, never `accent` or a status colour. The app builds a
 * `GuideStyle` from its live theme with `guideStyleFromTokens`; the Linux
 * renderer uses the mirror below (Direction D, the provisional default look).
 * `test/figure.test.ts` fails if the mirror drifts from apps/mobile/src/theme/tokens.ts.
 *
 * Guides v2 adds two paints:
 * - `shade`: the darkest neutral of the scheme (`bg.canvas` dark, `text.primary`
 *   light), always at partial opacity, for shading, contours and anatomical lines.
 * - `muscle`: the one guide colour that isn't an alias, `color.guide.muscle`,
 *   for muscle regions only (Ben's request of 9 Oct 2026; ADR 0014). Violet,
 *   because every other hue already means something (accent, done, warning,
 *   pain, danger). The same values in every look.
 *
 * Muscle definition (guides v2 §4.11, design-system §2.3) adds two opaque,
 * derived paints, never new colour values: `faintNeutral` (`color.guide.definition`,
 * an alias of `text.primary`, over `nearBody`) and `faintTint` (`guide.muscle`
 * at 0.18 over `nearBody`). Pre-composited, so faint shapes are drawn at
 * opacity 1 and never stack.
 */
import type { Paint } from './props';

/** The only tokens a guide may use. `accent` and `status.*` are deliberately not among them. */
export const GUIDE_TOKEN_NAMES = ['bg.canvas', 'bg.surface', 'bg.raised', 'border.control', 'text.primary', 'text.secondary', 'text.tertiary'] as const;
export type GuideTokenName = (typeof GUIDE_TOKEN_NAMES)[number];
export type GuideTokens = Record<GuideTokenName, string>;

export type GuideStyle = Record<Paint, string>;
export type GuideScheme = 'dark' | 'light';

/** Paints worked out per scheme rather than one fixed alias each. */
type DerivedPaint = 'shade' | 'muscle' | 'faintNeutral' | 'faintTint';

/** The neutral paints: one alias each, the same in both schemes (research §5.5). */
export const GUIDE_PAINT_TOKENS = {
  background: 'bg.surface',
  nearBody: 'text.secondary',
  farBody: 'border.control',
  implement: 'text.primary',
  trace: 'text.tertiary',
  cable: 'text.tertiary',
  frame: 'border.control',
  frameFill: 'bg.raised',
} as const satisfies Record<Exclude<Paint, DerivedPaint>, GuideTokenName>;

/** `color.guide.shade`: the darkest neutral in each scheme (guides v2 §4.2). */
export const GUIDE_SHADE_TOKEN = { dark: 'bg.canvas', light: 'text.primary' } as const satisfies Record<GuideScheme, GuideTokenName>;

/** `color.guide.muscle` (guides v2 §4.2, GV2): a dedicated violet, the same in look A and look D. */
export const GUIDE_MUSCLE_COLOR = { dark: '#7A4AF0', light: '#9B7BF7' } as const satisfies Record<GuideScheme, string>;

/** `color.guide.definition` (guides v2 §4.11.2): the neutral furthest from the canvas, so faint shapes move the body tone away from it. */
export const GUIDE_DEFINITION_TOKEN = 'text.primary' as const satisfies GuideTokenName;

/**
 * Faint muscle-definition opacity over `nearBody` (design-system
 * `guide.definitionOpacity`, `guide.definitionTintOpacity`).
 */
export const DEFINITION_OPACITY = {
  neutral: { dark: 0.35, light: 0.24 },
  tint: { dark: 0.18, light: 0.18 },
} as const satisfies Record<'neutral' | 'tint', Record<GuideScheme, number>>;

/** Muscle opacities (guides v2 §4.3, design-system `guide.muscleSoftOpacity`). */
export const MUSCLE_OPACITY = {
  strong: 1,
  soft: 0.45,
  softIncreaseContrast: 0.6,
  /** Work-phase emphasis range (§4.9): low outside the phase, high inside. */
  pulse: { strong: [0.8, 1], soft: [0.36, 0.5] },
} as const;

/** WCAG 2 relative luminance of a `#RRGGBB` colour (0 black … 1 white). */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 0;
  const n = parseInt(m[1], 16);
  const ch = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** WCAG 2 contrast ratio of two `#RRGGBB` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `#RRGGBB` of `top` at `alpha` over an opaque `bottom` (for contrast checks of soft regions). */
export function compositeOver(top: string, alpha: number, bottom: string): string {
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const t = rgb(top);
  const b = rgb(bottom);
  return `#${t.map((c, i) => Math.round(c * alpha + (b[i] ?? 0) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Dark or light, from the canvas colour (so callers that only have tokens get the right muscle hue). */
export function schemeOfTokens(tokens: Pick<GuideTokens, 'bg.surface'>): GuideScheme {
  return relativeLuminance(tokens['bg.surface']) < 0.2 ? 'dark' : 'light';
}

export function guideStyleFromTokens(tokens: GuideTokens, scheme: GuideScheme = schemeOfTokens(tokens)): GuideStyle {
  const out = {} as GuideStyle;
  for (const [paint, token] of Object.entries(GUIDE_PAINT_TOKENS) as [Exclude<Paint, DerivedPaint>, GuideTokenName][]) out[paint] = tokens[token];
  out.shade = tokens[GUIDE_SHADE_TOKEN[scheme]];
  out.muscle = GUIDE_MUSCLE_COLOR[scheme];
  // Opaque composites from the live theme (§4.11.6): drawn at opacity 1, so overlapping faint shapes never stack.
  out.faintNeutral = compositeOver(tokens[GUIDE_DEFINITION_TOKEN], DEFINITION_OPACITY.neutral[scheme], out.nearBody);
  out.faintTint = compositeOver(out.muscle, DEFINITION_OPACITY.tint[scheme], out.nearBody);
  return out;
}

/** Mirror of Direction D ("Premium") in apps/mobile/src/theme/tokens.ts. */
export const DIRECTION_D_GUIDE_TOKENS: Record<GuideScheme, GuideTokens> = {
  dark: {
    'bg.canvas': '#0D0C0B',
    'bg.surface': '#181615',
    'bg.raised': '#23201E',
    'border.control': '#75706A',
    'text.primary': '#F3EEE8',
    'text.secondary': '#B5ADA5',
    'text.tertiary': '#948C84',
  },
  light: {
    'bg.canvas': '#F6F3EF',
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
