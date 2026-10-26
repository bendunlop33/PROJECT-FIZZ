import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LIFTS_CHART_HEIGHT, LIFTS_TAB_SECTIONS, liftsChartBottom } from '../src/progress/lifts-tab-layout';

/**
 * Progress › Lifts layout (Ben, 26 Oct 2026: "you have to scroll down too much to see the charts"). The repo
 * has no React renderer in tests: the order is a tested constant the screen renders from, and the source is
 * read for the wiring. The chart's on-screen position goes on Ben's iPhone.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Visible content height under the status bar and above the tab bar (pt). */
const IPHONE = { se: 667 - 20 - 49, mini: 812 - 50 - 83, pro: 852 - 59 - 83, max: 932 - 59 - 83 } as const;

describe('Progress › Lifts: the chart near the top', () => {
  it('the chips come first and the chart straight under them; controls, stats, trailing and sessions follow', () => {
    expect(LIFTS_TAB_SECTIONS).toEqual(['lifts', 'chart', 'controls', 'stats', 'trailing', 'sessions']);
    expect(LIFTS_TAB_SECTIONS.indexOf('chart')).toBe(LIFTS_TAB_SECTIONS.indexOf('lifts') + 1);
  });

  it('the whole chart is in view on opening the tab on every iPhone from the SE up; the old order pushed it past the SE’s fold', () => {
    for (const h of Object.values(IPHONE)) expect(liftsChartBottom()).toBeLessThanOrEqual(h);
    expect(liftsChartBottom(['lifts', 'controls', 'stats', 'chart'])).toBeGreaterThan(IPHONE.se);
  });

  it('the height used is the chart’s own', () => {
    expect(read('progress/exercise-line-chart.tsx')).toContain(`const HEIGHT = ${String(LIFTS_CHART_HEIGHT)};`);
  });

  it('the screen renders its sections in that order and computes nothing itself', () => {
    const tab = read('screens/progress/ExercisesTab.tsx');
    expect(tab).toContain('{LIFTS_TAB_SECTIONS.map((k) => (');
    expect(tab).toContain('const sections: Record<LiftsTabSection, React.ReactNode> = {');
    // The chips come from the service (the plan's main lifts, else his main compounds); his pick is remembered on this phone.
    expect(tab).toContain('chips={tab.lifts.chips}');
    expect(tab).toContain('remembered: prefs.liftsExercise ?? null');
    expect(tab).toContain('update({ liftsExercise: id })');
    expect(tab).not.toMatch(/defaultLiftPicks|liftsTabSelection|listProgressExercises/);
    // The chip row scrolls sideways, so a long name is never cut; `More` opens the searchable list.
    expect(tab).toContain('<ScrollView horizontal');
    expect(tab).toContain('accessibilityLabel="More exercises"');
  });
});

describe('Overview › Lifts card: the lift names under the chart are never cut (Ben, 26 Oct)', () => {
  const charts = read('reviews/charts.tsx');
  it('the name has no one-line limit; a long name stacks the row; the axis and key make room at large text', () => {
    expect(charts).toContain('const stacked = tableWidth > 0 && liftRowStacked(l.name, column, fontScale);');
    expect(charts).not.toContain("numberOfLines={1} style={[PROGRESS_TEXT.table, { flex: 1, fontWeight: '600' }]}");
    expect(charts).toContain("<AppText variant=\"callout\" style={[PROGRESS_TEXT.table, { flex: 1, fontWeight: '600' }]}>");
    expect(charts).toContain('weeks: view.weeks, width: Math.max(width, 1), fontScale });');
    expect(charts).toContain('width: layout.plot.left - 6');
    expect(charts).toContain("style={[PROGRESS_TEXT.key, { flexShrink: 1 }]}");
  });
});
