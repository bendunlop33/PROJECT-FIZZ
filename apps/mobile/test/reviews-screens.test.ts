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
});
