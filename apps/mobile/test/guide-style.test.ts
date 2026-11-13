/**
 * Guides v2 colour floors (exercise-guides-v2.md §4.2, §12.1 #5; design-system
 * §2.3): the muscle highlight must stay visible on the canvas and on the body
 * in both looks and both schemes, including under Increase Contrast.
 */
import { describe, expect, it } from 'vitest';

import { compositeOver, contrastRatio, GUIDE_MUSCLE_COLOR, GUIDE_TOKEN_NAMES, guideStyleFromTokens, MUSCLE_OPACITY, type GuideTokens } from '@fizz/catalogue/figure';

import { THEME_DIRECTIONS, resolveTheme } from '../src/theme/tokens';

const cases = Object.values(THEME_DIRECTIONS).flatMap((d) =>
  (['dark', 'light'] as const).flatMap((scheme) => [false, true].map((increaseContrast) => ({ d, scheme, increaseContrast }))),
);

describe('guide muscle colour contrast floors', () => {
  it.each(cases.map((c) => [`${c.d.id} ${c.scheme}${c.increaseContrast ? ' + Increase Contrast' : ''}`, c] as const))('%s', (_name, { d, scheme, increaseContrast }) => {
    const theme = resolveTheme(d, scheme, { boldText: false, increaseContrast, reduceMotion: false });
    const tokens = {} as GuideTokens;
    for (const n of GUIDE_TOKEN_NAMES) tokens[n] = theme.colors[n];
    const style = guideStyleFromTokens(tokens, scheme);
    expect(style.muscle).toBe(GUIDE_MUSCLE_COLOR[scheme]);
    // Strong on the canvas ≥ 3:1; strong against the near body ≥ 2:1 (plus a hue difference: the body is grey).
    expect(contrastRatio(style.muscle, style.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(style.muscle, style.nearBody)).toBeGreaterThanOrEqual(2);
    // Soft (0.45 over the body; 0.60 under Increase Contrast) against the body ≥ 1.4:1.
    const soft = increaseContrast ? MUSCLE_OPACITY.softIncreaseContrast : MUSCLE_OPACITY.soft;
    expect(contrastRatio(compositeOver(style.muscle, soft, style.nearBody), style.nearBody)).toBeGreaterThanOrEqual(1.4);
    // The body's own edge (kept clear by the region inset) stays far above both.
    expect(contrastRatio(style.nearBody, style.background)).toBeGreaterThanOrEqual(4.5);
    // Shade is the darkest neutral of the scheme.
    expect(style.shade).toBe(scheme === 'dark' ? theme.colors['bg.canvas'] : theme.colors['text.primary']);
  });

  it('the muscle hue is neither the accent nor a status colour in any look', () => {
    for (const d of Object.values(THEME_DIRECTIONS)) {
      for (const scheme of ['dark', 'light'] as const) {
        const theme = resolveTheme(d, scheme);
        for (const t of ['accent', 'status.done', 'status.warning', 'status.danger'] as const) expect(theme.colors[t]).not.toBe(GUIDE_MUSCLE_COLOR[scheme]);
      }
    }
  });

  it('contrast helpers follow WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(compositeOver('#FFFFFF', 0.5, '#000000')).toBe('#808080');
  });
});
