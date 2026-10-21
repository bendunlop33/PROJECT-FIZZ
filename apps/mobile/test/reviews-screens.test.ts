import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Progress › Reviews screens (workout-builder-v3 §6.2): layout-only checks on the source, since the
 * rendered result goes on Ben's iPhone. The view models are tested in `@fizz/domain`.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

describe('Progress › Reviews screens', () => {
  const charts = read('reviews', 'charts.tsx');
  const section = read('reviews', 'ReviewsSection.tsx');
  const progress = read('screens', 'progress', 'ProgressScreen.tsx');

  it('Reviews sits at the top of Progress, above the segments', () => {
    expect(progress.indexOf('<ReviewsSection />')).toBeGreaterThan(-1);
    expect(progress.indexOf('<ReviewsSection />')).toBeLessThan(progress.indexOf('<Segmented'));
  });

  it('every chart has a VoiceOver summary and a table view; states carry a mark, not colour alone', () => {
    expect(charts).toContain('accessibilityLabel={view.words}');
    expect(charts).toContain('accessibilityLabel={chart.words}');
    expect(charts.match(/<TableToggle /g)?.length).toBe(3);
    expect(charts).toContain('r.mark');
    expect(charts).toContain("accessibilityLabel={d.accessibilityLabel}");
  });

  it('no projection or predicted date anywhere in the Reviews UI (lift-targets rule, rule 6)', () => {
    // Code and copy only: the doc comments say there is none.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    for (const src of [charts, section]) expect(code(src)).not.toMatch(/projection|predict|at this rate|on track/i);
    // The lift target is a level line only.
    expect(charts).toContain('targetColor=');
  });

  it('proposals are offers: Apply and Skip, Undo after Apply, one op ID per tap', () => {
    expect(section).toContain('REVIEW_COPY.apply');
    expect(section).toContain('REVIEW_COPY.skip');
    expect(section).toContain('REVIEW_COPY.undo');
    expect(section).toContain('opId: newUuid()');
  });

  it('Summary carries `How did it feel?`; Today’s nudge links to Reviews', () => {
    expect(read('screens', 'workout', 'SummaryScreen.tsx')).toContain('<FeelRow sessionId={sessionId} />');
    expect(read('screens', 'TodayScreen.tsx')).toContain("onReviews: () => {");
  });

  it('review fixes (b3-wave3 UX): label once, table falls back with no chart engine, Sets table words, screens told when a run stores a review, Today lands on Reviews', () => {
    // B3: the line under the title is the view model's `header` (pinned in the domain tests), never metric + now.
    expect(charts).toContain('{chart.empty ?? chart.header}');
    expect(charts).not.toContain('`${chart.metric} · ${chart.now}`');
    // S5: no Skia, the table (never a blank box).
    expect(charts).toContain('table || !canvas.ok ?');
    // S8: words, not codes.
    expect(charts).toContain('r.statusWord');
    // S4: no fixed 96 pt label that cuts names off.
    expect(charts).not.toContain('width: 96 }');
    // S2: one full chart, the rest tiles.
    expect(section).toContain('<LiftsBlock charts={section.charts} />');
    // B2: the app reloads screens when a run stores a review.
    expect(read('shell', 'context.tsx')).toContain('services.reviews.subscribe(changed)');
    // S9: Today's link scrolls Progress to Reviews.
    expect(read('screens', 'TodayScreen.tsx')).toContain("params: { focus: 'reviews', n: (reviewsTaps += 1) }");
    expect(progress).toContain('scroll.current?.scrollTo({ y: 0, animated: false })');
  });
});
