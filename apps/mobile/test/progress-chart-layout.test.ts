import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { activityLineLayout, countBarWidth, guessLabelWidth, measuredLabelBox, thinLabelsByWidth } from '../src/progress/chart-layout';
import { nearestPointIndex, trendLayout } from '../src/progress/trend-layout';

const DIMS = { height: 132, axisWidth: 24, inset: 8, top: 10 };

describe('activity line geometry (Ben, 13 Oct 2026)', () => {
  it('evenly spaces points across the plot, 0 at the bottom, the top Y tick at the top, one joined line', () => {
    const l = activityLineLayout([0, 3, 1, 2], [0, 1, 2, 3], 332, DIMS);
    expect(l.plot).toEqual({ x: 24, y: 10, width: 300, height: 122 });
    expect(l.xs).toEqual([24, 124, 224, 324]);
    expect(l.ys).toEqual([132, 10, 132 - 122 / 3, 132 - (2 * 122) / 3]);
    expect(l.segments).toEqual([[0, 1, 2, 3]]);
    expect(l.yTicks.map((t) => t.label)).toEqual(['0', '1', '2', '3']);
    expect(l.yTicks[0]?.y).toBe(132);
    expect(l.yTicks.at(-1)?.y).toBe(10);
    expect(l.bars).toEqual([]);
  });

  it('few points are still a line (two points join); one point sits in the middle', () => {
    expect(activityLineLayout([1, 2], [0, 1, 2, 3], 332, DIMS).segments).toEqual([[0, 1]]);
    const one = activityLineLayout([2], [0, 1, 2, 3], 332, DIMS);
    expect(one.xs).toEqual([174]);
    expect(activityLineLayout([], [0, 1, 2, 3], 332, DIMS).segments).toEqual([]);
  });

  it('a tap picks the nearest point', () => {
    const l = activityLineLayout([0, 3, 1, 2], [0, 1, 2, 3], 332, DIMS);
    expect(nearestPointIndex(l.xs, 30)).toBe(0);
    expect(nearestPointIndex(l.xs, 180)).toBe(2);
    expect(nearestPointIndex(l.xs, 400)).toBe(3);
  });

  it('x labels thin by measured width: never overlap, first and last always (1 year on device: "Aug 26Oct 26")', () => {
    // 13 monthly points across a 330 pt chart, each label ~44 pt wide (`Oct 25` … `Oct 26`).
    const xs = Array.from({ length: 13 }, (_, i) => 24 + (i * 298) / 12);
    const widths = xs.map(() => 44);
    const shown = thinLabelsByWidth(xs, widths, 330);
    expect(shown[0]).toBe(0);
    expect(shown.at(-1)).toBe(12);
    expect(shown.length).toBeLessThan(13);
    const boxes = shown.map((i) => measuredLabelBox(xs[i] ?? 0, widths[i] ?? 0, 330));
    for (let k = 1; k < boxes.length; k += 1) expect(boxes[k]?.left ?? 0).toBeGreaterThanOrEqual((boxes[k - 1]?.right ?? 0) + 8);
    // The second-to-last never crowds the last (the device bug: the last label is pulled in from the edge).
    expect(shown).not.toContain(11);
  });

  it('wide labels keep fewer; roomy ones keep all; one label shows; first and last touching keep the last', () => {
    const xs = [10, 110, 210, 310];
    expect(thinLabelsByWidth(xs, [30, 30, 30, 30], 330)).toEqual([0, 1, 2, 3]);
    expect(thinLabelsByWidth(xs, [60, 60, 60, 60], 330)).toEqual([0, 1, 2, 3]);
    expect(thinLabelsByWidth(xs, [90, 90, 90, 90], 330)).toEqual([0, 3]);
    const wide = thinLabelsByWidth(xs, [120, 120, 120, 120], 330);
    expect(wide).toEqual([0, 3]);
    expect(thinLabelsByWidth([50], [40], 100)).toEqual([0]);
    expect(thinLabelsByWidth([], [], 100)).toEqual([]);
    expect(thinLabelsByWidth([10, 20], [60, 60], 70)).toEqual([1]);
  });

  it('labels never hang off either edge and stay centred under their point when they fit', () => {
    expect(measuredLabelBox(10, 40, 330)).toEqual({ left: 0, right: 40 });
    expect(measuredLabelBox(320, 40, 330)).toEqual({ left: 290, right: 330 });
    expect(measuredLabelBox(165, 40, 330)).toEqual({ left: 145, right: 185 });
    expect(guessLabelWidth('Oct 26')).toBeGreaterThan(44);
  });

  it('count bar: 0 is empty, small values stay visible, never past the track', () => {
    expect(countBarWidth(0, 200)).toBe(0);
    expect(countBarWidth(0.001, 200)).toBe(2);
    expect(countBarWidth(0.5, 200)).toBe(100);
    expect(countBarWidth(1.2, 200)).toBe(200);
  });

  it('every period draws the line; only AX sizes get a list; no bar or dot chart is left', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'progress', 'components.tsx'), 'utf8');
    const fn = src.slice(src.indexOf('export function ActivityChart'), src.indexOf('function PointList'));
    expect(fn).toContain('return <ActivityLine chart={chart} />;');
    expect(src).not.toContain('function WeekBars');
    expect(src).not.toContain('function DayList');
  });

  it('Exercises tab: the trailing average shares the line’s scale and widens it; no gap breaks; two points still join', () => {
    const base = { from: '2026-04-15', to: '2026-10-14', width: 330, height: 260, bars: false, format: 'number' as const, axisWidth: 44, inset: 10 };
    const points = [
      { date: '2026-05-01', value: 100, breakBefore: false },
      { date: '2026-09-01', value: 110, breakBefore: false },
    ];
    const l = trendLayout({ ...base, points, overlay: [90, 105] });
    expect(l.segments).toEqual([[0, 1]]);
    expect(l.overlayYs).toHaveLength(2);
    // 90 sits below 100 on screen (larger y), inside the plot.
    expect(l.overlayYs?.[0] ?? 0).toBeGreaterThan(l.ys[0] ?? 0);
    expect(l.overlayYs?.[0] ?? 0).toBeLessThanOrEqual(l.plot.y + l.plot.height);
    expect(l.yTicks.length).toBeGreaterThanOrEqual(3);
    expect(trendLayout({ ...base, points }).overlayYs).toEqual([]);
  });

  it('a lift target (Ben, 20 Oct) above every point widens the scale so its dotted line is inside the plot; none on bars', () => {
    const base = { from: '2026-04-15', to: '2026-10-14', width: 330, height: 260, bars: false, format: 'number' as const, axisWidth: 44, inset: 10 };
    const points = [
      { date: '2026-05-01', value: 90, breakBefore: false },
      { date: '2026-09-01', value: 95, breakBefore: false },
    ];
    const l = trendLayout({ ...base, points, target: 120 });
    expect(l.targetY).toBeDefined();
    expect(l.targetY ?? -1).toBeGreaterThanOrEqual(l.plot.y);
    expect(l.targetY ?? 0).toBeLessThan(Math.min(...l.ys));
    expect(trendLayout({ ...base, points }).targetY).toBeUndefined();
    expect(trendLayout({ ...base, points, bars: true, target: 120 }).targetY).toBeUndefined();
  });
});
