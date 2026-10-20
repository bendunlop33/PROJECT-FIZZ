import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { unreadableText } from '../src/progress/copy';

/**
 * Review progress-exercises S3–S6: the Exercises tab, its chart, XLabels and
 * FrequencySubRows. The repo has no React renderer in tests, so these read
 * the source for the wiring the review asked for; the values come from the
 * domain and service tests.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('Exercises tab (review S3–S5)', () => {
  const tab = read('screens/progress/ExercisesTab.tsx');
  const chart = read('progress/exercise-line-chart.tsx');
  const screen = read('screens/progress/ProgressScreen.tsx');

  it('S5: shows the unreadable line, the same words as Activity', () => {
    expect(tab).toContain('tab.unreadable > 0 ? <StatusLine');
    expect(tab).toContain('unreadableText(tab.unreadable)');
    expect(screen).toContain('unreadableText(home.unreadable)');
    expect(unreadableText(1)).toBe('1 workout couldn’t be read and isn’t counted.');
    expect(unreadableText(2)).toBe('2 workouts couldn’t be read and aren’t counted.');
  });

  it('prog-measure B1: the TOTAL column carries its own plain unit, not the section’s `kg each`; N1: the ⓘ sits below the header', () => {
    expect(tab).toContain("`TOTAL ${view.table.totalUnit.toUpperCase()}`");
    expect(tab).not.toContain("head('TOTAL', ");
    expect(tab).toMatch(/SESSIONS · \$\{view\.table\.unit\.toUpperCase\(\)\}`\}\s*<\/AppText>\s*\{\/\*[^*]*\*\/\}\s*\{view\.info !== null \? <InfoLine/);
  });

  it('S4: a selected row with no point still shows its readout', () => {
    expect(tab).toContain('readout={selectedRow?.readout ?? null}');
    expect(chart).toContain('point?.readout ?? (selected === null ? null : readout)');
  });

  it('B1: the empty line replaces the chart, and the screen computes no measure itself', () => {
    expect(tab).toMatch(/view\.empty !== null \?[\s\S]*\{view\.empty\}[\s\S]*<ExerciseLineChart/);
    expect(tab).not.toMatch(/sessionE1rm|workingWeight|measureValue/);
  });

  it('S1: the table header uses the view unit (kg each / kg assist), not a bare unit', () => {
    expect(tab).toContain('`SESSIONS · ${view.table.unit.toUpperCase()}`');
  });

  it('S3: a record opens the Exercises tab, not the old detail; the old list route is gone', () => {
    const onRecord = screen.slice(screen.indexOf('onRecord={(r) => {'), screen.indexOf('onRecord={(r) => {') + 400);
    expect(onRecord).toContain("setSegment('exercises')");
    expect(onRecord).not.toContain('ProgressExercise');
    expect(screen).toContain('<ExercisesTab focus={exercisesFocus} />');
    expect(read('navigation/AppNavigator.tsx')).not.toContain('"ProgressExercises"');
    expect(read('navigation/types.ts')).not.toContain('ProgressExercises:');
  });

  it('Y-tick keys stay unique when two ticks format the same (N1)', () => {
    expect(chart).toContain('key={`${String(i)}-${t.label}`}');
  });
});

describe('XLabels and FrequencySubRows (review S6)', () => {
  const src = read('progress/components.tsx');
  const xl = src.slice(src.indexOf('export function XLabels'), src.indexOf('export function XLabels') + 2500);
  const sub = src.slice(src.indexOf('export function FrequencySubRows'), src.indexOf('export function ResumeBar'));

  it('XLabels thins by measured width (guess until measured), and re-measures when the text size changes', () => {
    expect(xl).toContain('thinLabelsByWidth(');
    expect(xl).toContain('guessLabelWidth(l.text)');
    expect(xl).toContain('measured.scale === fontScale');
    expect(xl).toContain('onLayout');
    expect(xl).toContain('numberOfLines={1}');
    expect(xl).toContain('accessibilityElementsHidden');
  });

  it('FrequencySubRows: an empty line, one VoiceOver label per row, the parent table columns', () => {
    expect(sub).toContain('rows.length === 0');
    expect(sub).toContain('{empty}');
    expect(sub).toContain('accessibilityLabel={r.words}');
    expect(sub).toContain('width: FREQUENCY_COLUMNS.sessions');
    expect(sub).toContain('width: FREQUENCY_COLUMNS.sets');
  });
});
