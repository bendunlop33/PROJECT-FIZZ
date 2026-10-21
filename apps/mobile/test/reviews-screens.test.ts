import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Progress v3 screens (progress-goals.md "Progress v3 (agreed)", prototype progress-simple.html):
 * layout-only checks on the source, since the rendered result goes on Ben's iPhone. The view models are
 * tested in `@fizz/domain` (progress-page.test.ts), the chart geometry in lifts-layout.test.ts.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('Progress v3 screens', () => {
  const charts = read('reviews', 'charts.tsx');
  const section = read('reviews', 'ReviewsSection.tsx');
  const progress = read('screens', 'progress', 'ProgressScreen.tsx');
  const detail = read('screens', 'progress', 'ReviewDetailScreen.tsx');

  it('sits at the top of Progress, above the segments', () => {
    expect(progress.indexOf('<ReviewsSection />')).toBeGreaterThan(-1);
    expect(progress.indexOf('<ReviewsSection />')).toBeLessThan(progress.indexOf('<Segmented'));
  });

  it('one page for every goal: This week → Progress (Lifts, Muscles) → Coach’s changes at the bottom', () => {
    const order = ['<WeekCard', '<LiftsCard', '<MusclesCard', '<ChangesSection'].map((t) => section.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Dropped by the agreed design: goal-ordered sections, the Latest card, the 6-week consistency bars.
    for (const gone of ['goal.sections', 'ReviewCard', 'ConsistencyBlock', 'SetsBars', 'LiftTile', 'd.latest']) expect(code(section) + code(charts)).not.toContain(gone);
  });

  it('a done chip opens that workout’s Summary; a past week opens its review; Past weeks has its screen', () => {
    expect(section).toContain("navigation.navigate('Summary', { sessionId, back: true })");
    expect(section).toContain("screen: 'ProgressReview'");
    expect(section).toContain("screen: 'ProgressPastWeeks'");
    expect(read('navigation', 'AppNavigator.tsx')).toContain('name="ProgressPastWeeks"');
  });

  it('accessibility: VoiceOver summaries on every visual, 44 pt targets around small ones, Dynamic Type stacking', () => {
    expect(charts).toContain('accessibilityLabel={chip.accessibilityLabel}');
    expect(charts).toContain('accessibilityLabel={r.accessibilityLabel}');
    expect(charts).toContain('accessibilityLabel={one === null ? view.chartLabel : one.chartLabel}');
    expect(charts).toContain('accessibilityState={{ expanded: open }}');
    // Lift rows, past-week rows, links: at least 44 pt even where the visual is smaller.
    expect(charts.match(/minHeight: 44/g)?.length).toBeGreaterThanOrEqual(4);
    expect(section.match(/minHeight: 44/g)?.length).toBeGreaterThanOrEqual(2);
    // Large text: chips two a row, muscle rows wrap.
    expect(charts).toContain('const perRow = ax ? 2 : 4;');
    expect(charts).toContain("flexWrap: ax ? 'wrap' : 'nowrap'");
    // No Skia: the table still lists every lift (the chart is skipped, never a blank box).
    expect(charts).toContain('&& Drawing !== null;');
  });

  it('changes: small ones Undo / Redo, structural ones Apply / Keep as is; one op ID per tap; Got it is versioned', () => {
    expect(section).toContain('PROGRESS_COPY.apply');
    expect(section).toContain('PROGRESS_COPY.keep');
    expect(charts).toContain('PROGRESS_COPY.undo');
    expect(charts).toContain('PROGRESS_COPY.redo');
    expect(section).toContain('opId: newUuid()');
    expect(section).toContain('expectedVersion: view.version');
    expect(detail).toContain('<ChangeRow');
  });

  it('the `at this rate` estimate is always labelled `est.`; minimal copy (no rule labels)', () => {
    expect(charts).toContain('one.focus.eta !== null ? (');
    expect(charts).toContain('PROGRESS_COPY.estWord');
    for (const src of [charts, section]) expect(code(src)).not.toMatch(/built-in rule|snapped to|Nothing changes unless/i);
  });

  it('the app reloads screens when a run stores a review or applies its changes', () => {
    expect(read('shell', 'context.tsx')).toContain('services.reviews.subscribe(changed)');
    expect(read('screens', 'TodayScreen.tsx')).toContain("params: { focus: 'reviews', n: (reviewsTaps += 1) }");
    expect(progress).toContain('scroll.current?.scrollTo({ y: 0, animated: false })');
  });
});
