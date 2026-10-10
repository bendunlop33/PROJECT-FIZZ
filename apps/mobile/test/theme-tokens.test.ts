import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GUIDE_DEFINITION_TOKEN, GUIDE_MUSCLE_COLOR, GUIDE_PAINT_TOKENS, GUIDE_SHADE_TOKEN } from '@fizz/catalogue/figure';

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
  schemeFor,
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

/**
 * `color.guide.<paint>` colours, resolved from the live theme by
 * `guideStyleFromTokens` (ADR 0013): the neutral aliases, plus guides v2's
 * scheme-dependent `shade` alias, the `muscle` hue (ADR 0014) and the
 * `definition` alias of muscle definition (guides v2 §4.11).
 */
const GUIDE_ALIASES = new Set([...Object.keys(GUIDE_PAINT_TOKENS), 'shade', 'muscle', 'definition'].map((p) => `color.guide.${p}`));

/**
 * Named in design-system.md but specified, not built. Remove each entry when
 * the code adds it; the test below fails once it exists, so this list can't
 * go stale. (Guides v2's `color.guide.muscle` and `color.guide.shade` are built.)
 */
const SPECIFIED_NOT_BUILT = new Set<string>();

const directions: ThemeDirection[] = Object.values(THEME_DIRECTIONS);

describe('theme tokens', () => {
  it('finds tokens in design-system.md (guards against a broken regex)', () => {
    expect(referencedTokens().length).toBeGreaterThan(80);
  });

  it.each(directions.map((d) => [d.id, d] as const))('direction %s implements every token named in design-system.md', (_id, direction) => {
    const names = new Set(tokenNames(direction));
    // `chart.line` etc. are written as shorthand for the colour alias `color.chart.line`.
    // `color.guide.*` (design-system §2.3) live in @fizz/catalogue's GUIDE_PAINT_TOKENS, checked below.
    const missing = referencedTokens().filter((t) => !names.has(t) && !(t.startsWith('chart.') && names.has(`color.${t}`)) && !GUIDE_ALIASES.has(t) && !SPECIFIED_NOT_BUILT.has(t));
    expect(missing).toEqual([]);
  });

  it('lists only tokens that really are specified and not yet built', () => {
    const referenced = new Set(referencedTokens());
    const implemented = new Set([...tokenNames(CURRENT_DIRECTION), ...GUIDE_ALIASES]);
    for (const t of SPECIFIED_NOT_BUILT) {
      expect(referenced.has(t), `${t} is no longer in design-system.md`).toBe(true);
      expect(implemented.has(t), `${t} is built now: remove it from SPECIFIED_NOT_BUILT`).toBe(false);
    }
  });

  it('documents every guide colour alias as the catalogue resolves it (design-system §2.3)', () => {
    const text = readFileSync(DESIGN_SYSTEM, 'utf8');
    const documented = Object.fromEntries([...text.matchAll(/^\| `color\.guide\.(\w+)` \| `color\.([\w.]+)` \|/gm)].map((m) => [m[1] ?? '', m[2] ?? '']));
    expect(documented).toEqual(GUIDE_PAINT_TOKENS);
    const names = new Set(tokenNames(CURRENT_DIRECTION));
    for (const alias of Object.values(GUIDE_PAINT_TOKENS)) expect(names.has(`color.${alias}`), alias).toBe(true);
  });

  it('documents the guide shade alias and the muscle hue as the catalogue resolves them (design-system §2.3, guides v2 §4.2)', () => {
    const text = readFileSync(DESIGN_SYSTEM, 'utf8');
    expect(text).toContain(`| \`color.guide.shade\` (v2) | \`color.${GUIDE_SHADE_TOKEN.dark}\` (dark) / \`color.${GUIDE_SHADE_TOKEN.light}\` (light) |`);
    expect(text).toContain(`| \`color.guide.muscle\` | \`${GUIDE_MUSCLE_COLOR.dark}\` | \`${GUIDE_MUSCLE_COLOR.light}\` |`);
    const names = new Set(tokenNames(CURRENT_DIRECTION));
    for (const alias of Object.values(GUIDE_SHADE_TOKEN)) expect(names.has(`color.${alias}`), alias).toBe(true);
  });

  it('documents the muscle-definition alias as the catalogue resolves it (design-system §2.3, guides v2 §4.11)', () => {
    const text = readFileSync(DESIGN_SYSTEM, 'utf8');
    expect(text).toContain(`| \`color.guide.definition\` (v2.1) | \`color.${GUIDE_DEFINITION_TOKEN}\` (both schemes) |`);
    expect(new Set(tokenNames(CURRENT_DIRECTION)).has(`color.${GUIDE_DEFINITION_TOKEN}`)).toBe(true);
  });

  it.each(directions.map((d) => [d.id, d] as const))('direction %s has a value for every colour in both schemes', (_id, direction) => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const token of BASE_COLOR_TOKENS) {
        expect(direction.colors[scheme][token], `${direction.id} ${scheme} ${token}`).toMatch(/^(#[0-9A-F]{6}|rgba\(\d+, \d+, \d+, 0?\.\d+\))$/);
      }
    }
  });

  it('keeps every text token at 16pt or more (design-system §3), except D’s tracked caps labels (approved mockups)', () => {
    for (const direction of directions) {
      for (const name of TYPE_TOKENS) {
        const t = direction.type[name];
        // D's `TODAY` / `LOAD` / `REST` labels are 12pt tracked caps in Ben's approved D mockups; they still scale with Dynamic Type.
        const min = t.uppercase === true ? 12 : 16;
        expect(t.size, `${direction.id} ${name}`).toBeGreaterThanOrEqual(min);
      }
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
  it('is dark only (audit B3); A follows the system', () => {
    expect(['light', 'dark', null].map((sys) => schemeFor('D', sys))).toEqual(['dark', 'dark', 'dark']);
    expect(['light', 'dark', null].map((sys) => schemeFor('A', sys))).toEqual(['light', 'dark', 'dark']);
  });

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

  it('answers its own risks: underlined links, pill buttons, Semibold titles, tracked caps labels', () => {
    expect(PREMIUM_DIRECTION.components.linkAffordance).toBe('underline');
    expect(PREMIUM_DIRECTION.components.primaryButtonRadius).toBe('pill');
    expect(PREMIUM_DIRECTION.type.title1.weight).toBe('600');
    const label = resolveTheme(PREMIUM_DIRECTION, 'light').type.sectionLabel;
    // Approved D mockups (9 Oct): 12pt, tracked 1.4.
    expect(label).toMatchObject({ fontSize: 12, fontWeight: '600', uppercase: true, letterSpacing: 1.4 });
    expect(PREMIUM_DIRECTION.type.timerDisplay).toMatchObject({ size: 88, weight: '300' });
    expect(PREMIUM_DIRECTION.radius.lg).toBe(20);
    expect(resolveTheme(NAVY_DIRECTION, 'light').type.sectionLabel.uppercase).toBe(false);
  });
});
