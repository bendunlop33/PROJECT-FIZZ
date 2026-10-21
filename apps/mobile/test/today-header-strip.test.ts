import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTodayStrip } from '@fizz/domain';

import { progressPalette } from '../src/reviews/palette';
import { PREMIUM_DIRECTION, resolveTheme } from '../src/theme/tokens';
import { RUN_TINT, STRIP_LABEL_FIT, stripPillStyle } from '../src/today/strip-style';

/**
 * Today (v2) fixes from Ben's Build B screenshot (21 Oct): the strip's pills (no ✓; done soft green as
 * Progress's chips, planned dashed, cardio its own tint; one centred line that shrinks to fit) and the
 * compact coach in the header (`✦ Coach` pill + mic, 44 pt, honest status word).
 */

const flat = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8').replace(/\s+/g, ' ');

describe('strip pills (§2.0.2 region 3, Ben 21 Oct)', () => {
  for (const scheme of ['dark', 'light'] as const) {
    const theme = resolveTheme(PREMIUM_DIRECTION, scheme);
    const pal = progressPalette(theme);
    it(`${scheme}: done = Progress's soft green; planned = dashed; cardio its own tint; rest text only`, () => {
      expect(stripPillStyle({ kind: 'workout', planned: false }, theme)).toMatchObject({ backgroundColor: pal.doneFill, borderColor: pal.doneEdge, borderStyle: 'solid' });
      for (const kind of ['plan_day', 'today'] as const) {
        expect(stripPillStyle({ kind, planned: true }, theme)).toMatchObject({ backgroundColor: 'transparent', borderStyle: 'dashed', borderWidth: 1 });
      }
      const run = stripPillStyle({ kind: 'activity', planned: false }, theme);
      expect(run).toMatchObject({ backgroundColor: RUN_TINT[scheme].fill, color: RUN_TINT[scheme].text, borderStyle: 'solid' });
      expect(run.backgroundColor).not.toBe(pal.doneFill);
      expect(stripPillStyle({ kind: 'activity', planned: true }, theme)).toMatchObject({ backgroundColor: 'transparent', borderStyle: 'dashed', color: RUN_TINT[scheme].text });
      expect(stripPillStyle({ kind: 'rest', planned: false }, theme)).toMatchObject({ backgroundColor: 'transparent', borderWidth: 0 });
    });
  }

  it('labels are one line and shrink to 75 % instead of `…`; no ✓ in any cell', () => {
    expect(STRIP_LABEL_FIT).toEqual({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 });
    const cells = buildTodayStrip({
      today: '2026-10-21',
      workouts: [
        { sessionId: 'a', localDate: '2026-10-19', title: 'Legs' },
        { sessionId: 'b', localDate: '2026-10-20', title: 'Chest' },
      ],
      activities: [{ activityId: 'r', localDate: '2026-10-23', kind: 'run', status: 'planned', distanceM: 8000, durationS: null, effort: null }],
      chosen: null,
    });
    expect(cells.flatMap((c) => c.items.map((i) => i.text))).toEqual(['Rest', 'Legs', 'Chest', 'Run 8k']);
    expect(cells[1]?.accessibilityLabel).toContain('Legs, done');
    expect(cells[5]?.accessibilityLabel).toContain('Planned');
  });
});

describe('compact coach in the header (§2.0.2, prototype `.askbar.sm` + `.mic`)', () => {
  const bar = flat('ui/coach-ask-bar.tsx');
  const compact = bar.slice(bar.indexOf('if (compact && !inline) {'), bar.indexOf('if (inline && !listening) {'));
  it('a `✦` pill with the short status word (Coach / Offline / No coach) and the shared mic, both 44 pt', () => {
    expect(compact).toContain('minHeight: ICON_SIZE');
    expect(compact).toContain('{listening ? \'Listening…\' : view.short}');
    expect(compact).toContain('accessibilityLabel={listening ? `Listening. ${heard}` : view.accessibilityLabel}');
    expect(compact).toContain('{micButton}');
    expect(compact).toContain('borderRadius: theme.radius.pill');
    // The same mic (on-device dictation, ⊘ when unavailable), round and 44 pt in this layout.
    expect(bar).toContain('width: icons || compact ? ICON_SIZE : BAR_HEIGHT');
    expect(bar).toContain('borderRadius: compact ? ICON_SIZE / 2 : theme.radius.md');
  });
  it('Set up with no coach still gets the typed field (compact never hides the offline fill)', () => {
    expect(bar).toContain('if (compact && !inline) {');
  });
});
