import { describe, expect, it } from 'vitest';

import { countBarWidth, visibleLabels, weekBarsLayout, ZERO_STUB } from '../src/progress/chart-layout';

const DIMS = { height: 64, maxBarWidth: 28, gap: 8, radius: 4 };

describe('WeekBars geometry (design-system §9.70)', () => {
  it('scales 0..max, caps bar width, centres bars in their slots, and draws 0 as a stub', () => {
    const bars = weekBarsLayout([1, 2, 0, 3, 2], 300, 3, DIMS);
    expect(bars.map((b) => b.width)).toEqual([28, 28, 28, 28, 28]);
    expect(bars.map((b) => Math.round(b.height))).toEqual([21, 43, ZERO_STUB, 64, 43]);
    expect(bars[2]?.zero).toBe(true);
    expect(bars.map((b) => b.centreX)).toEqual([30, 90, 150, 210, 270]);
    for (const b of bars) expect(b.y + b.height).toBe(64);
  });

  it('narrow widths shrink bars to fit with the gap; nothing for no width', () => {
    const bars = weekBarsLayout(Array.from({ length: 9 }, () => 1), 120, 3, DIMS);
    expect(bars[0]?.width).toBeCloseTo((120 - 64) / 9);
    expect(weekBarsLayout([1], 0, 3, DIMS)).toEqual([]);
  });

  it('labels: first and last always, others when there is room', () => {
    expect(visibleLabels(5, 300, 50)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleLabels(9, 300, 60)).toEqual([0, 2, 4, 6, 8]);
    expect(visibleLabels(1, 300, 60)).toEqual([0]);
  });

  it('count bar: 0 is empty, small values stay visible, never past the track', () => {
    expect(countBarWidth(0, 200)).toBe(0);
    expect(countBarWidth(0.001, 200)).toBe(2);
    expect(countBarWidth(0.5, 200)).toBe(100);
    expect(countBarWidth(1.2, 200)).toBe(200);
  });
});
