import { describe, expect, it } from 'vitest';

import type { LiftView } from '@fizz/domain';

import { LIFT_NAME, LIFT_TABLE, LIFTS_AXIS, LIFTS_CHART, liftCellLines, liftCellPartWidth, liftNameLines, liftRowStacked, liftsAxisLeft, liftsChartLayout, liftStackedNameWidth, liftTableColumnWidth, lineAt, pointAt, ringAt } from '../src/reviews/lifts-layout';
import { progressPalette, withAlpha } from '../src/reviews/palette';

/** The Lifts chart's geometry (Progress v3, the prototype's `liftChart`), pure. */

const WEEKS = ['24 Aug', '31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'];
function lift(id: string, values: readonly (number | null)[], more: Partial<LiftView> = {}, pbs: readonly number[] = []): LiftView {
  const points = values.flatMap((v, week) => (v === null ? [] : [{ week, value: v, estimate: false, detail: `${String(v)} × 6`, pb: pbs.includes(week), pbDetail: pbs.includes(week) ? `PB · ${id} ${String(v)} × 6` : null }]));
  return {
    exerciseId: id,
    name: id,
    reps: 6,
    repsSource: 'plan',
    repsText: '× 6',
    current: '100',
    currentEstimate: false,
    latestPb: false,
    loadSuffix: null,
    target: null,
    targetText: '–',
    colour: 0,
    accessory: false,
    chartable: true,
    lowerIsBetter: false,
    points,
    marker: null,
    focus: { subtitle: '', onTrack: false, eta: null, etaShort: null, etaWeeks: 0 },
    accessibilityLabel: id,
    chartLabel: id,
    ...more,
  };
}

describe('Lifts chart layout', () => {
  const bench = lift('bench', [90, 92.5, 92.5, 95, 95, 97.5, 97.5, 100], { target: 110 });
  const squat = lift('squat', [105, 107.5, 107.5, 110, 112.5, 112.5, 115, 117.5], { colour: 1, target: 125 });
  const raise = lift('raise', [10, 10, 12, 12, 12, 12, 12, 12], { colour: null, accessory: true });

  it('all lifts: drawn lifts only, one axis in steps of 10, targets in a right gutter with a guide from the newest point', () => {
    const l = liftsChartLayout({ lifts: [bench, squat, raise], focus: null, weeks: WEEKS, width: 320 });
    expect(l.lines.map((x) => x.key)).toEqual(['bench', 'squat']);
    expect(l.ticks.map((t) => t.label)).toEqual(['80', '90', '100', '110', '120', '130']);
    expect(l.plot).toEqual({ left: 30, right: 320 - LIFTS_CHART.gutterAll, top: 14, bottom: 138 });
    expect(l.lines[0]?.points[0]?.x).toBe(30);
    expect(l.lines[0]?.points[7]?.x).toBe(286);
    expect(l.lines[0]?.gutter).toMatchObject({ label: '110', guideFromX: 286 });
    expect(l.target).toBeNull();
    expect(l.xLabels.map((x) => x.text)).toEqual(['24 Aug', '12 Oct']);
  });

  it('one lift: its own scale (steps of 5), dashed target line, the dotted `at this rate` line two columns on', () => {
    const one = { ...bench, focus: { subtitle: '', onTrack: true, eta: 'about mid-Nov at this rate', etaShort: 'mid-Nov', etaWeeks: 2 } };
    const l = liftsChartLayout({ lifts: [one, squat], focus: 'bench', weeks: WEEKS, width: 320 });
    expect(l.lines.map((x) => x.key)).toEqual(['bench']);
    expect(l.ticks[0]?.label).toBe('85');
    expect(l.ticks.at(-1)?.label).toBe('115');
    expect(l.target?.label).toBe('Target 110');
    expect(l.lines[0]?.gutter).toBeNull();
    expect(l.eta).toMatchObject({ x2: 308, label: 'mid-Nov' });
    expect(l.xLabels.map((x) => x.text)).toEqual(['24 Aug', 'mid-Nov']);
    // Hollow estimates and the newest point come through for drawing.
    expect(l.lines[0]?.points.at(-1)?.last).toBe(true);
  });

  it('taps: a line within 22 pt (a 44 pt target round a thin line), a point within 22 pt; nothing further away', () => {
    const l = liftsChartLayout({ lifts: [bench, squat], focus: null, weeks: WEEKS, width: 320 });
    const p = l.lines[1]?.points[3];
    if (p === undefined) throw new Error('no point');
    expect(lineAt(l, p.x, p.y + 5)).toBe('squat');
    expect(lineAt(l, p.x, 0 - 40)).toBeNull();
    expect(pointAt(l, p.x + 3, p.y)?.detail).toBe('110 × 6');
  });

  it('PB rings: all lifts, only the newest point when it is a PB; one lift, every PB; a ring tap gives its detail', () => {
    const pb = lift('bench', [90, 92.5, 92.5, 95, 95, 97.5, 97.5, 100], {}, [1, 3, 5, 7]);
    const notNewest = lift('squat', [105, 110, 108], { colour: 1 }, [1]);
    const all = liftsChartLayout({ lifts: [pb, notNewest], focus: null, weeks: WEEKS, width: 320 });
    expect(all.lines[0]?.points.map((p) => p.ring)).toEqual([false, false, false, false, false, false, false, true]);
    expect(all.lines[1]?.points.some((p) => p.ring)).toBe(false);
    const one = liftsChartLayout({ lifts: [pb], focus: 'bench', weeks: WEEKS, width: 320 });
    expect(one.lines[0]?.points.filter((p) => p.ring).length).toBe(4);
    const newest = all.lines[0]?.points[7];
    if (newest === undefined) throw new Error('no point');
    expect(ringAt(all, newest.x + 4, newest.y - 4)?.ringDetail).toBe('PB · bench 100 × 6');
    expect(ringAt(all, newest.x - 60, newest.y)).toBeNull();
  });

  it('a gap week is skipped (the line joins the weeks that have points); no points: no line', () => {
    const gappy = lift('g', [100, null, null, 105, null, null, null, 110]);
    const l = liftsChartLayout({ lifts: [gappy, lift('empty', [], { colour: 1 })], focus: null, weeks: WEEKS, width: 320 });
    expect(l.lines[0]?.points.map((x) => x.x)).toEqual([30, 30 + (3 * 256) / 7, 286]);
    expect(l.lines[1]?.points).toEqual([]);
  });

  it('palette: rgba from tokens; dataviz slots as agreed', () => {
    expect(withAlpha('#5CC98A', 0.2)).toBe('rgba(92, 201, 138, 0.2)');
    const p = progressPalette({ scheme: 'dark', colors: { 'status.done': '#5CC98A', 'text.primary': '#F3EEE8' } as never });
    expect(p.lines).toEqual(['#3987e5', '#d95926', '#199e70']);
    expect(p.doneFill).toBe('rgba(92, 201, 138, 0.2)');
    expect(p.dataUnder).toBe('rgba(232, 201, 160, 0.45)');
  });
});

describe('the Lifts table’s Current / Target cell: wrap, never cut the number (review progress-v3b-design S1)', () => {
  // The card's inner width on a 320 pt and a 390 pt phone (20 pt screen margin, the card's 14 pt padding).
  const table = (screen: number) => screen - 2 * 20 - 2 * 14;
  const col320 = liftTableColumnWidth(table(320));
  const col390 = liftTableColumnWidth(table(390));

  it('the column widths match the row (dot, gaps, four equal columns)', () => {
    expect(col320).toBeCloseTo(53.5, 1);
    expect(col390).toBeCloseTo(71, 1);
  });

  it('at 320 pt a stack PB and a per-dumbbell PB wrap: the number always has a line it fits on whole', () => {
    for (const [number, suffix] of [['102.5', 'stack'], ['32.5', 'each'], ['502.5', 'stack']] as const) {
      for (const fontScale of [1, 1.3, 3]) {
        const lines = liftCellLines({ width: col320, number, suffix, pb: true, fontScale });
        expect(lines.flat()).toEqual(['pb', 'number', 'suffix']);
        const numberLine = lines.find((l) => l.includes('number')) ?? [];
        const used = numberLine.reduce((w, p) => w + liftCellPartWidth(p, p === 'number' ? number : p === 'suffix' ? suffix : '', fontScale), 0) + LIFT_TABLE.partGap * (numberLine.length - 1);
        expect(numberLine.length === 1 || used <= col320).toBe(true);
        expect(liftCellPartWidth('number', number, fontScale)).toBeLessThanOrEqual(col320);
      }
    }
    expect(liftCellLines({ width: col320, number: '102.5', suffix: 'stack', pb: true })).toEqual([['pb'], ['number'], ['suffix']]);
    expect(liftCellLines({ width: col320, number: '32.5', suffix: 'each', pb: false })).toEqual([['number'], ['suffix']]);
  });

  it('at 390 pt a short number keeps its word beside it; no PB, no suffix: one line', () => {
    expect(liftCellLines({ width: col390, number: '32.5', suffix: 'each', pb: true })).toEqual([['pb', 'number'], ['suffix']]);
    expect(liftCellLines({ width: col390, number: '100', suffix: null, pb: false })).toEqual([['number']]);
    expect(liftCellLines({ width: col390, number: '60', suffix: 'stack', pb: false })).toEqual([['number', 'suffix']]);
  });
});

describe('Overview › Lifts: no clipped text under the chart at 320–430 pt and large text (Ben, 26 Oct)', () => {
  const table = (screen: number) => screen - 2 * 20 - 2 * 14;
  const WIDTHS = [320, 375, 390, 430];
  // Default, xxxLarge, AX1, AX3, AX5 (the callout's 3× cap).
  const SCALES = [1, 1.353, 1.647, 2.353, 3.118];
  const NAMES = ['Bench press', 'Back squat', 'Deadlift', 'Overhead press', 'Romanian deadlift', 'Incline dumbbell press', 'Bulgarian split squat', 'Smith machine bench press', 'Lat pulldown', 'Barbell row'];
  /** Every word fits the width it is given, at the scale (words never break mid-way). */
  const wordsFit = (name: string, width: number, scale: number) => name.split(' ').every((w) => w.length * LIFT_NAME.char * Math.min(scale, LIFT_NAME.maxScale) <= width);

  it('a name either wraps whole in its column on at most two lines, or the row stacks and the name gets the row’s width', () => {
    for (const screen of WIDTHS)
      for (const scale of SCALES)
        for (const name of NAMES) {
          const col = liftTableColumnWidth(table(screen));
          if (liftRowStacked(name, col, scale)) {
            // Stacked: the whole width; at the largest sizes a long word can still wrap, but nothing is cut (no line limit).
            expect(liftStackedNameWidth(table(screen))).toBeGreaterThan(col * 2);
          } else {
            expect(liftNameLines(name, col, scale), `${name} at ${String(screen)} pt ×${String(scale)}`).toBeLessThanOrEqual(LIFT_NAME.maxLines);
            expect(wordsFit(name, col, scale)).toBe(true);
          }
        }
  });

  it('at 390 pt and default text the usual main lifts wrap in their column; long names stack; at 320 pt, Overhead press stacks', () => {
    const col390 = liftTableColumnWidth(table(390));
    expect(liftNameLines('Bench press', col390)).toBe(2);
    expect(liftNameLines('Deadlift', col390)).toBe(1);
    expect(liftRowStacked('Overhead press', col390)).toBe(false);
    expect(liftRowStacked('Incline dumbbell press', col390)).toBe(true);
    expect(liftRowStacked('Overhead press', liftTableColumnWidth(table(320)))).toBe(true);
    expect(liftNameLines('Bench', 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('the old table cut every two-word name at 390 pt (one line in a quarter of the row)', () => {
    const col390 = liftTableColumnWidth(table(390));
    for (const name of ['Bench press', 'Back squat', 'Overhead press', 'Romanian deadlift']) expect(name.length * LIFT_NAME.char).toBeGreaterThan(col390);
  });

  it('the y-axis widens for its labels at large text (capped 1.3×), so `100` is never `10…`', () => {
    expect(liftsAxisLeft(['80', '90', '100'])).toBe(LIFTS_CHART.left);
    expect(liftsAxisLeft(['80', '90', '100'], 1.3)).toBe(Math.ceil(3 * LIFTS_AXIS.digit * 1.3) + LIFTS_AXIS.gap + 1);
    expect(liftsAxisLeft(['80', '90', '100'], 3)).toBe(liftsAxisLeft(['80', '90', '100'], 1.3));
    for (const scale of SCALES) {
      const left = liftsAxisLeft(['200', '210', '220'], scale);
      // The label box is `left - 6` wide (charts.tsx), the label right-aligned in it.
      expect(3 * LIFTS_AXIS.digit * Math.min(scale, LIFTS_AXIS.maxScale)).toBeLessThanOrEqual(left - LIFTS_AXIS.gap);
    }
    const l = liftsChartLayout({ lifts: [lift('a', [100, 105, 110])], focus: null, weeks: WEEKS, width: 300, fontScale: 1.3 });
    expect(l.plot.left).toBe(liftsAxisLeft(l.ticks.map((t) => t.label), 1.3));
    expect(l.lines[0]?.points[0]?.x).toBe(l.plot.left);
  });
});
