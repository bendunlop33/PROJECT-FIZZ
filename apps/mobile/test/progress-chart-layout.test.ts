import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { activityLineLayout, barLabelBox, barLabelRoom, countBarWidth, visibleLabels } from '../src/progress/chart-layout';
import { nearestPointIndex } from '../src/progress/trend-layout';

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

  it('x labels thin to fit: first and last always, the rest only with room', () => {
    expect(visibleLabels(5, 300, barLabelRoom('week'))).toEqual([0, 1, 2, 3, 4]);
    const weeks = visibleLabels(27, 300, barLabelRoom('week'));
    expect(weeks[0]).toBe(0);
    expect(weeks.at(-1)).toBe(26);
    expect(weeks.length).toBeLessThan(8);
    for (let i = 1; i < weeks.length - 1; i += 1) expect(((weeks[i] ?? 0) - (weeks[i - 1] ?? 0)) * (300 / 27)).toBeGreaterThanOrEqual(barLabelRoom('week'));
    expect(visibleLabels(19, 300, barLabelRoom('month')).length).toBeLessThan(19);
    expect(visibleLabels(1, 300, 60)).toEqual([0]);
  });

  it('labels never hang off either edge and stay over their point', () => {
    expect(barLabelBox(10, 330, 60)).toEqual({ left: 0, align: 'flex-start' });
    expect(barLabelBox(320, 330, 60)).toEqual({ left: 270, align: 'flex-end' });
    expect(barLabelBox(165, 330, 60)).toEqual({ left: 135, align: 'center' });
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
});
