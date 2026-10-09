import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GUIDE_PAINT_TOKENS } from '@fizz/catalogue/figure';

import {
  BASE_COLOR_TOKENS,
  CHART_COLOR_ALIASES,
  CURRENT_DIRECTION,
  NAVY_DIRECTION,
  PREMIUM_DIRECTION,
  THEME_DIRECTIONS,
  TYPE_TOKENS,
  directionById,
  resolveTheme,
  tokenNames,
  type ThemeDirection,
} from '../src/theme/tokens';

const DESIGN_SYSTEM = join(import.meta.dirname, '../../../docs/design/design-system.md');

/** Retired names kept only as aliases in design-system §11; they must not be implemented. */
const RETIRED = new Set(['timing.coachFirstToken', 'timing.backupOverdue']);

function referencedTokens(): string[] {
  const text = readFileSync(DESIGN_SYSTEM, 'utf8');
  const re = /`((?:color|type|space|radius|target|timing|haptic|sound|chart|widget|icon|launch)\.[A-Za-z0-9.]+)`/g;
  return [...new Set([...text.matchAll(re)].map((m) => m[1] ?? ''))].filter((t) => t !== '' && !RETIRED.has(t)).sort();
}

/** `color.guide.<paint>` aliases, resolved from the live theme by `guideStyleFromTokens` (ADR 0013). */
const GUIDE_ALIASES = new Set(Object.keys(GUIDE_PAINT_TOKENS).map((p) => `color.guide.${p}`));

const directions: ThemeDirection[] = Object.values(THEME_DIRECTIONS);

describe('theme tokens', () => {
  it('finds tokens in design-system.md (guards against a broken regex)', () => {
    expect(referencedTokens().length).toBeGreaterThan(80);
  });

  it.each(directions.map((d) => [d.id, d] as const))('direction %s implements every token named in design-system.md', (_id, direction) => {
    const names = new Set(tokenNames(direction));
    // `chart.line` etc. are written as shorthand for the colour alias `color.chart.line`.
    // `color.guide.*` (design-system §2.3) live in @fizz/catalogue's GUIDE_PAINT_TOKENS, checked below.
    const missing = referencedTokens().filter((t) => !names.has(t) && !(t.startsWith('chart.') && names.has(`color.${t}`)) && !GUIDE_ALIASES.has(t));
    expect(missing).toEqual([]);
  });

  it('documents every guide colour alias as the catalogue resolves it (design-system §2.3)', () => {
    const text = readFileSync(DESIGN_SYSTEM, 'utf8');
    const documented = Object.fromEntries([...text.matchAll(/^\| `color\.guide\.(\w+)` \| `color\.([\w.]+)` \|/gm)].map((m) => [m[1] ?? '', m[2] ?? '']));
    expect(documented).toEqual(GUIDE_PAINT_TOKENS);
    const names = new Set(tokenNames(CURRENT_DIRECTION));
    for (const alias of Object.values(GUIDE_PAINT_TOKENS)) expect(names.has(`color.${alias}`), alias).toBe(true);
  });

  it.each(directions.map((d) => [d.id, d] as const))('direction %s has a value for every colour in both schemes', (_id, direction) => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const token of BASE_COLOR_TOKENS) {
        expect(direction.colors[scheme][token], `${direction.id} ${scheme} ${token}`).toMatch(/^(#[0-9A-F]{6}|rgba\(\d+, \d+, \d+, 0?\.\d+\))$/);
      }
    }
  });

  it('keeps every text token at 16pt or more (design-system §3)', () => {
    for (const direction of directions) {
      for (const name of TYPE_TOKENS) expect(direction.type[name].size, `${direction.id} ${name}`).toBeGreaterThanOrEqual(16);
    }
  });

  it('uses tabular numerals for every numeric display token', () => {
    for (const direction of directions) {
      for (const name of ['timerDisplay', 'loadDisplay', 'keypad'] as const) expect(direction.type[name].tabular).toBe('always');
    }
  });

  it('caps display sizes and lets the rest scale to accessibility sizes', () => {
    const t = NAVY_DIRECTION.type;
    expect([t.timerDisplay.maxScale, t.loadDisplay.maxScale, t.keypad.maxScale]).toEqual([1.6, 1.8, 1.5]);
    expect([t.title1.maxScale, t.title2.maxScale]).toEqual([2.5, 2.5]);
    for (const n of ['headline', 'body', 'callout', 'label'] as const) expect(t[n].maxScale).toBe(3);
  });

  it('resolves chart colours as aliases, so both schemes switch together', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const theme = resolveTheme(NAVY_DIRECTION, scheme);
      for (const [chart, alias] of Object.entries(CHART_COLOR_ALIASES)) {
        expect(theme.colors[chart as keyof typeof CHART_COLOR_ALIASES]).toBe(theme.colors[alias]);
      }
    }
  });

  it('applies Bold Text, Increase Contrast and keeps one accent', () => {
    const plain = resolveTheme(NAVY_DIRECTION, 'dark');
    const a11y = resolveTheme(NAVY_DIRECTION, 'dark', { boldText: true, increaseContrast: true, reduceMotion: false });
    expect(plain.type.body.fontWeight).toBe('400');
    expect(a11y.type.body.fontWeight).toBe('500');
    expect(a11y.type.title1.fontWeight).toBe('700');
    expect(a11y.colors['text.tertiary']).toBe(plain.colors['text.secondary']);
    expect(a11y.colors['border.divider']).toBe(plain.colors['border.control']);
    expect(a11y.dividerWidth).toBe(2);
    expect(a11y.chart.activeLineWidth).toBe(3);
  });
});

describe('Direction D (Premium)', () => {
  it('is the default look; A is still selectable', () => {
    expect(CURRENT_DIRECTION.id).toBe('D');
    expect(directionById('A').id).toBe('A');
    expect(directionById('D').id).toBe('D');
    expect(directionById('Z').id).toBe('D');
    expect(directionById(null).id).toBe('D');
  });

  it('matches the research values and keeps status colours unchanged', () => {
    expect(PREMIUM_DIRECTION.colors.dark['bg.canvas']).toBe('#0D0C0B');
    expect(PREMIUM_DIRECTION.colors.light.accent).toBe('#1A1714');
    for (const scheme of ['dark', 'light'] as const) {
      for (const token of BASE_COLOR_TOKENS.filter((t) => t.startsWith('status.'))) {
        expect(PREMIUM_DIRECTION.colors[scheme][token]).toBe(NAVY_DIRECTION.colors[scheme][token]);
      }
    }
  });

  it('answers its own risks: chevron links, pill buttons, Semibold titles, tracked caps labels', () => {
    expect(PREMIUM_DIRECTION.components.linkAffordance).toBe('chevron');
    expect(PREMIUM_DIRECTION.components.primaryButtonRadius).toBe('pill');
    expect(PREMIUM_DIRECTION.type.title1.weight).toBe('600');
    const label = resolveTheme(PREMIUM_DIRECTION, 'light').type.sectionLabel;
    expect(label).toMatchObject({ fontSize: 16, fontWeight: '600', uppercase: true, letterSpacing: 1 });
    expect(resolveTheme(NAVY_DIRECTION, 'light').type.sectionLabel.uppercase).toBe(false);
  });
});
