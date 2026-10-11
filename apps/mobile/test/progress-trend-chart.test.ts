import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E1RM_SHEET_LINES } from '../src/progress/copy';
import { axisLabel, dateX, markerX, monthTicks, nearestPointIndex, niceTicks, trendLayout } from '../src/progress/trend-layout';

/**
 * The exercise `TrendChart`'s pure geometry (progress.md §7.1, design-system
 * §9.23): y ticks fit the data (not forced to zero) except for volume bars,
 * month ticks, gap breaks, the nearest point to a tap and marker positions;
 * plus the slice B static checks (no chart library, no animation, copy).
 */

const pts = (xs: [string, number, boolean?][]) => xs.map(([date, value, breakBefore]) => ({ date, value, breakBefore: breakBefore ?? false }));
const base = { from: '2026-04-09', to: '2026-10-08', width: 350, height: 220, bars: false, format: 'number' as const, axisWidth: 44, inset: 10 };

describe('trendLayout', () => {
  it('fits the y range to the data with round ticks, and breaks the line at gaps (check 33)', () => {
    const l = trendLayout({ ...base, points: pts([['2026-04-10', 115], ['2026-05-01', 118], ['2026-06-01', 120, true], ['2026-07-01', 126.5]]) });
    expect(l.segments).toEqual([[0, 1], [2, 3]]);
    const labels = l.yTicks.map((t) => Number(t.label));
    expect(Math.min(...labels)).toBeGreaterThan(100); // not forced to 0
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(5);
    // Higher values sit higher (smaller y), inside the plot.
    expect(l.ys[3]).toBeLessThan(l.ys[0] ?? 0);
    for (const y of l.ys) expect(y).toBeGreaterThanOrEqual(l.plot.y - 1e-6);
    for (const x of l.xs) expect(x).toBeLessThanOrEqual(l.plot.x + l.plot.width + 1e-6);
  });

  it('volume bars start at 0, one per session', () => {
    const l = trendLayout({ ...base, bars: true, points: pts([['2026-05-01', 4000], ['2026-06-01', 4500]]) });
    expect(l.yTicks[0]?.label).toBe('0');
    expect(l.bars).toHaveLength(2);
    expect((l.bars[0]?.y ?? 0) + (l.bars[0]?.height ?? 0)).toBeCloseTo(l.plot.y + l.plot.height);
    expect(l.yTicks.map((t) => t.label)).toContain('2,000');
  });

  it('a single value or a flat line still gets a usable range', () => {
    const l = trendLayout({ ...base, points: pts([['2026-05-01', 100]]) });
    expect(l.yTicks.length).toBeGreaterThan(0);
    expect(Number.isFinite(l.ys[0])).toBe(true);
  });

  it('holds format as m:ss', () => {
    expect(axisLabel(90, 'duration')).toBe('1:30');
    expect(axisLabel(12345, 'number')).toBe('12,345');
    expect(axisLabel(102.5, 'number')).toBe('102.5');
  });

  it('nice ticks use 1, 2, 2.5 or 5 steps', () => {
    expect(niceTicks(112, 128, 4)).toEqual([115, 120, 125]);
    expect(niceTicks(0, 10, 4)).toEqual([0, 5, 10]);
  });
});

describe('ticks, hit testing and markers', () => {
  const plot = { x: 44, width: 296 };

  it('month ticks fall on the first of each month; long ranges thin to quarters or years, January carries the year', () => {
    expect(monthTicks('2026-04-09', '2026-10-08', plot).map((t) => t.label)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    const long = monthTicks('2019-02-03', '2026-10-08', plot).map((t) => t.label);
    expect(long.every((l) => /^\d{4}$/.test(l))).toBe(true);
    const twoYears = monthTicks('2024-10-09', '2026-10-08', plot).map((t) => t.label);
    expect(twoYears).toContain('2025');
  });

  it('the nearest point by date wins; nothing with no points', () => {
    expect(nearestPointIndex([50, 100, 200], 140)).toBe(1);
    expect(nearestPointIndex([50, 100, 200], 160)).toBe(2);
    expect(nearestPointIndex([], 10)).toBe(-1);
  });

  it('a gap marker sits midway between its two sessions; others on their date', () => {
    const mid = markerX({ date: '2026-07-29', from: '2026-07-05' }, '2026-04-09', '2026-10-08', plot);
    expect(mid).toBeCloseTo(dateX('2026-07-17', '2026-04-09', '2026-10-08', plot));
    expect(markerX({ date: '2026-07-29', from: null }, '2026-04-09', '2026-10-08', plot)).toBeCloseTo(dateX('2026-07-29', '2026-04-09', '2026-10-08', plot));
  });
});

describe('slice B static checks', () => {
  const SRC = join(import.meta.dirname, '../src');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

  it('check 40: no chart library; the charts draw with Skia and nothing animates', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.filter((d) => /chart|victory|svg-charts|gifted|recharts|d3/i.test(d))).toEqual([]);
    for (const f of ['progress/TrendCanvas.tsx', 'progress/trend-chart.tsx', 'screens/progress/ExerciseDetailScreen.tsx', 'screens/progress/ExercisesScreen.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/react-native-reanimated|Animated\.|useSharedValue|withTiming|LayoutAnimation/);
    }
  });

  it('check 23: no score, ring, percentage, streak, recovery, readiness or fatigue words on the new screens and sheet', () => {
    const text = [E1RM_SHEET_LINES.join(' '), read('screens/progress/ExerciseDetailScreen.tsx'), read('screens/progress/ExercisesScreen.tsx')].join(' ');
    expect(text).not.toMatch(/recovery|readiness|fatigue|streak|\bscore\b/i);
    expect(E1RM_SHEET_LINES.join(' ')).toMatch(/estimate/);
  });
});
