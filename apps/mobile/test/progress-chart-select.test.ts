import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChartPointView, ExerciseSelection } from '@fizz/domain';

import { chartAccessibilityAction, chartSelection, isPointSelected } from '../src/progress/trend-select';

/**
 * Review progress-B r3 S1: under weekly bests, an opened workout that isn't
 * its week's best highlights the week's point, but the chart's VoiceOver
 * value, its double-tap and the panel all follow the opened workout; a tap on
 * the highlighted dot shows the week's best rather than clearing.
 */

const point = (sessionId: string, date: string, display: string, words: string): ChartPointView => ({
  sessionId,
  date,
  value: 0,
  display,
  title: date,
  detail: `Est. 1RM  ${display}`,
  notes: [],
  hollow: false,
  breakBefore: false,
  words,
});

// Weekly bests: Mon 2 Jun, Mon 9 Jun (140 × 5), Mon 16 Jun. Ben opened Thu 12 Jun (100 × 5).
const points = [
  point('mon-2', '2025-06-02', '≈163.5 kg', 'Monday 2 June 2025, about 163.5 kilograms.'),
  point('mon-9', '2025-06-09', '≈163.5 kg', 'Monday 9 June 2025, about 163.5 kilograms.'),
  point('mon-16', '2025-06-16', '≈163.5 kg', 'Monday 16 June 2025, about 163.5 kilograms.'),
];
const thursday = point('thu-12', '2025-06-12', '≈116.5 kg', 'Thursday 12 June 2025, estimated one-rep max about 116.5 kilograms, from 100 kilograms by 5.');
const opened: ExerciseSelection = {
  index: 1,
  point: thursday,
  weekBest: { text: 'Week best ≈163.5 kg', words: 'Week best about 163.5 kilograms, Monday 9 June 2025.' },
};

describe('chartSelection', () => {
  it('an opened workout inside a week point: the week is highlighted; the panel, VoiceOver and double-tap are the workout', () => {
    const sel = chartSelection(points, opened, 'thu-12');
    expect(sel?.focus.index).toBe(1);
    expect(sel?.focus.sessionId).toBe('thu-12');
    expect(sel?.panel.sessionId).toBe('thu-12');
    expect(sel?.focus.words).toBe(`${thursday.words} Week best about 163.5 kilograms, Monday 9 June 2025.`);
    expect(sel?.focus.words).not.toContain('Monday 9 June 2025, about');
    expect(sel?.weekBest).toBe('Week best ≈163.5 kg');
  });

  it('a point picked on the chart is its own workout, with no week-best tag', () => {
    const sel = chartSelection(points, opened, 'mon-9');
    expect(sel).toEqual({ focus: { index: 1, sessionId: 'mon-9', words: points[1]?.words }, panel: points[1], weekBest: null });
    expect(chartSelection(points, null, 'mon-16')?.focus.index).toBe(2);
  });

  it('nothing selected, or a workout that isn’t on the chart, selects nothing', () => {
    expect(chartSelection(points, opened, null)).toBeNull();
    expect(chartSelection(points, null, 'thu-12')).toBeNull();
  });
});

describe('chart VoiceOver actions', () => {
  const focus = chartSelection(points, opened, 'thu-12')?.focus ?? null;

  it('double-tap opens the workout in the panel, not the week’s best', () => {
    expect(chartAccessibilityAction('activate', points.length, focus)).toEqual({ kind: 'open', sessionId: 'thu-12' });
    const own = chartSelection(points, opened, 'mon-9')?.focus ?? null;
    expect(chartAccessibilityAction('activate', points.length, own)).toEqual({ kind: 'open', sessionId: 'mon-9' });
    expect(chartAccessibilityAction('activate', points.length, null)).toBeNull();
  });

  it('swipes step from the highlighted point and stop at the ends', () => {
    expect(chartAccessibilityAction('increment', 3, focus)).toEqual({ kind: 'select', index: 2 });
    expect(chartAccessibilityAction('decrement', 3, focus)).toEqual({ kind: 'select', index: 0 });
    expect(chartAccessibilityAction('increment', 3, null)).toEqual({ kind: 'select', index: 0 });
    expect(chartAccessibilityAction('decrement', 3, null)).toEqual({ kind: 'select', index: 2 });
    expect(chartAccessibilityAction('increment', 3, { index: 2, sessionId: 'mon-16', words: '' })).toEqual({ kind: 'select', index: 2 });
    expect(chartAccessibilityAction('increment', 0, focus)).toBeNull();
    expect(chartAccessibilityAction('magicTap', 3, focus)).toBeNull();
  });
});

describe('chart taps', () => {
  it('the highlighted week point stands for another workout: a tap selects it (shows the week’s best) instead of clearing', () => {
    const focus = chartSelection(points, opened, 'thu-12')?.focus ?? null;
    expect(isPointSelected(1, points, focus)).toBe(false);
  });

  it('a point selected as itself: tapping it again clears (§4.2); other points and misses aren’t selected', () => {
    const focus = chartSelection(points, null, 'mon-9')?.focus ?? null;
    expect(isPointSelected(1, points, focus)).toBe(true);
    expect(isPointSelected(0, points, focus)).toBe(false);
    expect(isPointSelected(-1, points, focus)).toBe(false);
    expect(isPointSelected(1, points, null)).toBe(false);
  });
});

describe('wiring', () => {
  const SRC = join(import.meta.dirname, '../src');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

  it('the chart reads and opens its focus; the screen passes the panel’s selection and shows the week-best tag', () => {
    const chart = read('progress/trend-chart.tsx');
    expect(chart).toMatch(/chartAccessibilityAction\(e\.nativeEvent\.actionName, points\.length, focus\)/);
    expect(chart).toMatch(/accessibilityValue: \{ text: `\$\{focus\.words\} Double-tap to open the workout\.` \}/);
    // Design pass 6.3: tap only; tapping the selected point again clears it.
    expect(chart).toMatch(/if \(isPointSelected\(i, points, focus\)\) onSelect\(null\);/);
    expect(chart).not.toMatch(/onResponderMove|onMoveShouldSetResponder/);
    expect(chart).not.toMatch(/points\[selected\]/);
    // (Ben, 26 Oct: one exercise-progress screen) Exercise detail is the Lifts tab's body for one exercise.
    const screen = read('screens/progress/ExerciseDetailScreen.tsx');
    expect(screen).toContain('<ExercisesTab exerciseId={exerciseId} opening={opening} onLoaded={onLoaded} />');
    expect(screen).not.toMatch(/<TrendChart|chartSelection\(/);
  });
});
