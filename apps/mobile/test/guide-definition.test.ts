/**
 * Muscle definition in the app (exercise-guides-v2.md §4.11): the colour
 * hierarchy strong > soft > faint in both looks and schemes (D4), the app's
 * mode and its fallbacks, the bake, and the How to legend (D12–D13).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bakeFrame,
  compositeOver,
  contrastRatio,
  DEFAULT_MUSCLE_DEFINITION,
  DEFINITION_OPACITY,
  GUIDE_DEFINITION_TOKEN,
  GUIDE_TOKEN_NAMES,
  guideStyleFromTokens,
  MUSCLE_OPACITY,
  relativeLuminance,
  type GuideTokens,
} from '@fizz/catalogue/figure';
import { bundledGuides } from '@fizz/catalogue';

import { planOp } from '../src/guide/draw-plan';
import { buildHowToView, bundledHowToSources, howToLayout } from '../src/guide/how-to';
import { guideDefinition, MUSCLE_DEFINITION } from '../src/guide/player-model';
import { resolveTheme, THEME_DIRECTIONS } from '../src/theme/tokens';

const cases = Object.values(THEME_DIRECTIONS).flatMap((d) =>
  (['dark', 'light'] as const).flatMap((scheme) => [false, true].map((increaseContrast) => ({ d, scheme, increaseContrast }))),
);

function styleFor(d: (typeof cases)[number]['d'], scheme: 'dark' | 'light', increaseContrast: boolean) {
  const theme = resolveTheme(d, scheme, { boldText: false, increaseContrast, reduceMotion: false });
  const tokens = {} as GuideTokens;
  for (const n of GUIDE_TOKEN_NAMES) tokens[n] = theme.colors[n];
  return { tokens, style: guideStyleFromTokens(tokens, scheme) };
}

describe('definition colour hierarchy (§4.11.2, D4)', () => {
  it.each(cases.map((c) => [`${c.d.id} ${c.scheme}${c.increaseContrast ? ' + Increase Contrast' : ''}`, c] as const))('%s', (_name, { d, scheme, increaseContrast }) => {
    const { tokens, style } = styleFor(d, scheme, increaseContrast);
    const body = style.nearBody;
    // The faint paints are the composites, worked out from the live theme.
    expect(style.faintNeutral).toBe(compositeOver(tokens[GUIDE_DEFINITION_TOKEN], DEFINITION_OPACITY.neutral[scheme], body));
    expect(style.faintTint).toBe(compositeOver(style.muscle, DEFINITION_OPACITY.tint[scheme], body));
    const soft = compositeOver(style.muscle, increaseContrast ? MUSCLE_OPACITY.softIncreaseContrast : MUSCLE_OPACITY.soft, body);
    const softLow = compositeOver(style.muscle, MUSCLE_OPACITY.pulse.soft[0], body);
    const strong = style.muscle;

    // Neutral: visible at 240 pt in both schemes, still quiet (1.24–1.31 from the body; 1.19 read as no change at 240 pt,
    // visual review of 9 Oct 2026). Tint, Ben's comparison option: 1.12–1.25.
    for (const [faint, lo, hi] of [[style.faintNeutral, 1.24, 1.31], [style.faintTint, 1.12, 1.25]] as const) {
      expect(contrastRatio(faint, body)).toBeGreaterThanOrEqual(lo);
      expect(contrastRatio(faint, body)).toBeLessThanOrEqual(hi);
      // Strong > soft > faint, always: faint stays clearly weaker than soft.
      expect(contrastRatio(strong, body)).toBeGreaterThan(contrastRatio(soft, body));
      expect(contrastRatio(soft, body)).toBeGreaterThan(contrastRatio(faint, body) + 0.2);
    }
    // Floors between the levels (neutral, then tint).
    expect(contrastRatio(soft, style.faintNeutral)).toBeGreaterThanOrEqual(1.6);
    expect(contrastRatio(strong, style.faintNeutral)).toBeGreaterThanOrEqual(2.5);
    expect(contrastRatio(softLow, style.faintNeutral)).toBeGreaterThanOrEqual(1.5);
    expect(contrastRatio(soft, style.faintTint)).toBeGreaterThanOrEqual(1.25);
    expect(contrastRatio(strong, style.faintTint)).toBeGreaterThanOrEqual(1.9);
    // Tint keeps soft steady because its pulse low would sit too close to faint violet.
    expect(contrastRatio(softLow, style.faintTint)).toBeLessThan(1.25);

    // Direction: neutral moves the body tone away from the canvas, violet towards it, so the two can't be confused.
    const canvas = relativeLuminance(style.background);
    const gap = (c: string): number => Math.abs(relativeLuminance(c) - canvas);
    expect(gap(style.faintNeutral)).toBeGreaterThan(gap(body));
    expect(gap(style.faintTint)).toBeLessThan(gap(body));
    expect(gap(strong)).toBeLessThan(gap(body));
  });

  it('the composites match the design-system §2.3 table (look D and look A)', () => {
    const want = { premium: { dark: ['#CBC4BC', '#AA9BB3'], light: ['#47413C', '#635869'] }, navy: { dark: ['#C1CAD4', '#A1A1CA'], light: ['#3C4755', '#595D80'] } } as const;
    for (const d of Object.values(THEME_DIRECTIONS)) {
      const look = d.id === 'D' ? want.premium : want.navy;
      for (const scheme of ['dark', 'light'] as const) {
        const { style } = styleFor(d, scheme, false);
        expect([style.faintNeutral, style.faintTint], `${d.id} ${scheme}`).toEqual(look[scheme]);
      }
    }
  });
});

describe('app mode (§4.11.9)', () => {
  it('ships neutral, the same mode guide:render previews', () => {
    expect(MUSCLE_DEFINITION).toBe('neutral');
    expect(MUSCLE_DEFINITION).toBe(DEFAULT_MUSCLE_DEFINITION);
  });

  it('guideDefinition: M/L tier only; tint falls back to neutral under Increase Contrast or DWC, and to off without muscles', () => {
    const muscles = { primary: ['triceps'], secondary: [] };
    const base = { setting: 'tint' as const, pt: 240, increaseContrast: false, differentiateWithoutColor: false, muscles };
    expect(guideDefinition(base)).toBe('tint');
    expect(guideDefinition({ ...base, pt: 115 })).toBe('off');
    expect(guideDefinition({ ...base, increaseContrast: true })).toBe('neutral');
    expect(guideDefinition({ ...base, differentiateWithoutColor: true })).toBe('neutral');
    expect(guideDefinition({ ...base, muscles: null })).toBe('off');
    expect(guideDefinition({ ...base, setting: 'neutral', muscles: null })).toBe('neutral');
    expect(guideDefinition({ ...base, setting: 'off' })).toBe('off');
  });

  it('faint ops become single Skia gradient fills in the faint colour (round 4: lit end strongest, both ends fade out)', () => {
    const load = bundledGuides().load('cable-triceps-pushdown');
    if (!load.ok) throw new Error('guide');
    const { style } = styleFor(THEME_DIRECTIONS.A, 'dark', false);
    const ops = bakeFrame(load.value.prepared, load.value.camera, 0.2, [], { pt: 240, muscles: { primary: ['triceps'], secondary: [] }, definition: 'neutral' });
    const faint = ops.filter((o) => o.kind === 'path' && o.gradient !== null && o.gradient.stops.every((st) => st.paint === 'faintNeutral'));
    expect(faint.length).toBeGreaterThan(0);
    for (const o of faint) {
      const plan = planOp(o, style);
      expect(plan.layerAlpha).toBeNull();
      expect(plan.steps).toHaveLength(1);
      const step = plan.steps[0];
      expect(step?.draw).toBe('fill');
      expect(step?.draw === 'fill' ? step.gradient?.colors.length : 0).toBe(4);
    }
  });
});

describe('How to legend (§4.11.8, D12–D13)', () => {
  const src = bundledHowToSources();
  const squat = { name: 'Back squat', catalogueKey: 'barbell-back-squat' };

  it('neutral (the app default): the legend and canvas label are unchanged, no definition note', () => {
    const v = buildHowToView(squat, src);
    expect(v.legend.map((l) => l.kind)).toEqual(['most', 'also', 'notShown']);
    expect(v.definitionNote).toBeNull();
    expect(v.guide?.accessibilityLabel).toContain('Highlighted muscles are listed below.');
    expect(buildHowToView(squat, src, { definition: 'neutral' }).legend).toEqual(v.legend);
  });

  it('tint: one line after Also works, no swatch, read by VoiceOver; gone under Increase Contrast, DWC and without the player', () => {
    const v = buildHowToView(squat, src, { definition: 'tint' });
    expect(v.legend.map((l) => l.kind)).toEqual(['most', 'also', 'definition', 'notShown']);
    expect(v.legend[2]).toMatchObject({ label: 'Faint violet:', list: 'other muscles, for reference', swatch: false, accessibilityLabel: 'Faint violet: other muscles, for reference.' });
    expect(v.definitionNote).toBe('Faint violet: other muscles, for reference');
    for (const a11y of [{ increaseContrast: true }, { differentiateWithoutColor: true }]) {
      expect(buildHowToView(squat, src, { definition: 'tint', ...a11y }).definitionNote).toBeNull();
    }
    // The player failed: nothing is drawn, so the standalone legend has no faint-violet line and no Not shown line.
    expect(howToLayout(v, true).standaloneLegend.map((l) => l.kind)).toEqual(['most', 'also']);
  });

  it('no copy on How to calls the faint groups inactive, unused or resting (D13)', () => {
    const source = ['../src/guide/how-to.ts', '../src/guide/MuscleFocusLegend.tsx', '../src/screens/workout/HowToScreen.tsx', '../../../packages/catalogue/src/muscles.ts']
      .map((f) => readFileSync(join(import.meta.dirname, f), 'utf8'))
      .join('\n');
    // Copy is quoted text; comments may name the banned words to forbid them.
    const strings = [...source.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => (m[1] ?? m[2] ?? '').toLowerCase());
    for (const word of ['inactive', 'not used', 'unused', 'resting']) expect(strings.filter((s) => s.includes(word)), word).toEqual([]);
    const tint = buildHowToView(squat, src, { definition: 'tint' });
    for (const l of tint.legend) for (const word of ['inactive', 'unused', 'resting', 'a little']) expect(`${l.label} ${l.list}`.toLowerCase()).not.toContain(word);
  });
});
