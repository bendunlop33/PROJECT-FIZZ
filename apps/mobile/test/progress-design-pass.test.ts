import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { axisWidthFor, MIN_AXIS_WIDTH, TICK_MAX_SCALE } from '../src/progress/axis-width';

/**
 * Design pass batch 6, Progress (Ben approved 20 Oct): the consistency card
 * fits 8 weeks, chart axes fit their labels, charts select on tap only, and
 * tabs and tables read at large text. The rendered result goes on Ben's
 * device checklist.
 */

const SRC = join(__dirname, '..', 'src');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const read = (...p: string[]) => flat(readFileSync(join(SRC, ...p), 'utf8'));

describe('6.3 axis width', () => {
  it('never below 44pt; wide enough for `102.5` and `12,000`; capped scale', () => {
    expect(axisWidthFor(['0', '50', '100'], 1)).toBe(MIN_AXIS_WIDTH);
    expect(axisWidthFor(['100', '102.5'], 1)).toBeGreaterThanOrEqual(46);
    expect(axisWidthFor(['0', '6,000', '12,000'], 1)).toBeGreaterThan(axisWidthFor(['102.5'], 1));
    // Text size beyond the cap doesn't widen it further.
    expect(axisWidthFor(['12,000'], 3)).toBe(axisWidthFor(['12,000'], TICK_MAX_SCALE));
  });

  it('a measured width wins over the estimate; a chart can keep a narrower minimum', () => {
    expect(axisWidthFor(['12,000'], 1, 50)).toBe(58);
    expect(axisWidthFor(['2', '4'], 1, null, 24)).toBe(24);
  });

  it('charts use it, with no ellipsis on the ticks, and select on tap only', () => {
    for (const f of ['exercise-line-chart.tsx', 'trend-chart.tsx']) {
      const src = read('progress', f);
      expect(src).toContain('useAxisWidth(');
      expect(src).toContain('{axis.measure}');
      expect(src).toContain('maxFontSizeMultiplier={TICK_MAX_SCALE}');
      expect(src).not.toMatch(/onStartShouldSetResponder|onResponderGrant|onMoveShouldSetResponder/);
      expect(src).toContain('<Pressable accessible={false}');
    }
    expect(read('progress', 'components.tsx')).toContain('useAxisWidth(chart.yTicks.map((v) => String(v)), ACTIVITY_LINE_DIMS.axisWidth)');
  });
});

describe('6.1, 6.2 Progress screen', () => {
  const screen = read('screens', 'progress', 'ProgressScreen.tsx');
  // (Redesign v3 C3) Consistency lives on Training's Month view.
  const training = read('screens', 'progress', 'TrainingTab.tsx');
  it('8 equal columns with one-line capped labels; stacked rows at AX', () => {
    expect(training).toContain("style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }}");
    expect(training).toContain('numberOfLines={1} maxFontSizeMultiplier={1.3}');
    expect(training).toContain('{w.rowLabel}');
    expect(training).toContain('<ConsistencyCard ax={ax}');
  });
  it('one tap on a search result opens it', () => {
    expect(screen).toContain('keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"');
  });
});

describe('6.4–6.6', () => {
  it('TOP SET has the most room and shrinks rather than cut', () => {
    const tab = read('screens', 'progress', 'ExercisesTab.tsx');
    expect(tab).toContain("head('TOP SET', { flex: 1.6 })");
    expect(tab).toContain('adjustsFontSizeToFit minimumFontScale={0.8} style={{ flex: 1.6 }}');
  });
  it('Segmented: radio rows at AX, labels fit below it', () => {
    const c = read('progress', 'components.tsx');
    expect(c).toContain('accessibilityRole="radiogroup"');
    expect(c).toContain('adjustsFontSizeToFit minimumFontScale={0.85}');
  });
  it('(Ben, 26 Oct) Exercise detail is the Lifts body: the same Measure and Period dropdowns (one period set), no chips, Exercise info', () => {
    const d = read('screens', 'progress', 'ExerciseDetailScreen.tsx');
    const tab = read('screens', 'progress', 'ExercisesTab.tsx');
    expect(d).not.toMatch(/<Chip\b|ChipScroll|view\.ranges|<DropdownButton/);
    expect(d).toContain('<ExercisesTab exerciseId={exerciseId}');
    expect(tab).toContain('accessibilityLabel={`Measure, ${view.measureLabel}`}');
    expect(tab).toContain('<PeriodPicker');
    // No chip row for one exercise; the measure list shares the more-than-one guard with its button.
    expect(tab).toContain('lifts: only !== null ? null : (');
    expect(tab).toContain('view.measures.length > 1 ? (');
    expect(d).toMatch(/<TextButton\s+label="Exercise info"/);
  });
});
