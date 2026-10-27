import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { keypadCommitKey, workoutMenu } from '../src/workout/table';

/**
 * (Ben, 27 Oct; redesign-27oct.md §E1) The active workout: `Log ✓` on the keypad replaces Done, Finish is always in
 * the top bar (its sheet: the sets done, Finish, Keep going, Discard), and an empty workout uses the same table.
 */

const read = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('keypad: Log ✓ replaces Done', () => {
  it('typing in the open row: `Log ✓`, read as what it logs; off with a hint while a value is missing or Log can’t run', () => {
    expect(keypadCommitKey({ row: 'open', logLabel: 'Log 26 kg each × 8', canLog: true })).toEqual({ kind: 'log', label: 'Log ✓', accessibilityLabel: 'Log 26 kg each × 8', enabled: true, hint: null });
    expect(keypadCommitKey({ row: 'open', logLabel: null, canLog: true, missing: 'reps' })).toMatchObject({ kind: 'log', enabled: false, hint: 'Enter reps' });
    expect(keypadCommitKey({ row: 'open', logLabel: null, canLog: true, missing: 'load' })).toMatchObject({ hint: 'Enter load' });
    // Busy, a guard or a gym switch in the way: off, no hint (the reason shows where it always has).
    expect(keypadCommitKey({ row: 'open', logLabel: 'Log 100 kg × 5', canLog: false })).toMatchObject({ kind: 'log', enabled: false, hint: null });
  });

  it('a done row’s correction is never logged again: `Done` saves it and closes the pad (rule 2: Ben’s own edit)', () => {
    expect(keypadCommitKey({ row: 'done', logLabel: 'Log 100 kg × 5', canLog: true })).toEqual({ kind: 'close', label: 'Done', accessibilityLabel: 'Done', enabled: true, hint: null });
  });

  it('the bar takes the key; the screen logs through the one `log()` (closing the cell first)', () => {
    const bar = read('ui/workout.tsx');
    expect(bar).toContain('commit.onPress();');
    expect(bar).toContain("accessibilityState={{ disabled: !commit.enabled }}");
    const screen = flat(read('screens/workout/WorkoutScreen.tsx'));
    expect(screen).toContain('commit={{ ...keypadCommit, onPress: () => {');
    expect(screen).toContain('closeCellEditors(); void log(); }');
  });
});

describe('Finish always in the top bar', () => {
  it('a Finish button after ⋯ opens the Finish sheet; ⋯ has no Finish of its own', () => {
    const screen = read('screens/workout/WorkoutScreen.tsx');
    const top = screen.slice(screen.indexOf('{/* Top bar'), screen.indexOf('{tableMode || emptyTable ? ('));
    const finish = top.slice(top.indexOf('accessibilityLabel="Finish workout"'));
    expect(finish).toContain('setFinishOpen(true);');
    expect(top.indexOf('label="Workout menu"')).toBeLessThan(top.indexOf('accessibilityLabel="Finish workout"'));
    const base = { view: 'table' as const, paused: false, openEnded: false, ax: false, gymName: 'Main Gym', pastLog: true };
    expect(workoutMenu(base).map((m) => m.label)).not.toContain('Finish workout');
  });
});

describe('Empty workout: the same table', () => {
  it('Table view: the round strip’s one chip, the column header, `No exercises yet`, `＋ Add exercise`; Focus view keeps its own', () => {
    const table = read('screens/workout/WorkoutTable.tsx');
    const page = table.slice(table.indexOf('export function EmptyRoundPage'), table.indexOf('// Timer bar (§1.5), Chat'));
    expect(page).toContain('<RoundStrip');
    expect(page).toContain('<ColumnLabels');
    expect(page).toContain('No exercises yet');
    expect(page).toContain('label="＋ Add exercise"');
    expect(page).toContain('onWorkout={null}');
    const screen = read('screens/workout/WorkoutScreen.tsx');
    expect(screen).toContain("const emptyTable = mode === 'table' && view.phase === 'empty';");
    expect(screen).toContain('{emptyTable ? (\n            <EmptyRoundPage');
  });
});
