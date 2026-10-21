import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * workout-table-v3 §7 wiring, checked in source (the gestures and sheets
 * themselves need a real iPhone; Ben's checklist): one shared pop-up, Swap
 * sheet and drag for the builder and the workout, today-only commands
 * through services, and no load or progression worked out on a screen.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const workout = read('screens', 'workout', 'WorkoutScreen.tsx');
const table = read('screens', 'workout', 'WorkoutTable.tsx');
const edits = read('screens', 'workout', 'WorkoutEdits.tsx');
const sheets = read('screens', 'workout', 'RoundSheets.tsx');
const builderSheets = read('screens', 'builder', 'BuilderSheets.tsx');
const builderWorkout = read('screens', 'builder', 'BuilderWorkoutScreen.tsx');

describe('one implementation for both pages (§7: "same components, not copies")', () => {
  it('the exercise pop-up and the Swap / Add sheet come from ui/ on both pages', () => {
    for (const src of [builderSheets, edits]) expect(src).toContain('<ExercisePopup');
    expect(builderSheets).toContain("export { SwapSheet } from '../../ui/swap-sheet';");
    expect(edits).toContain("import { SwapSheet } from '../../ui/swap-sheet';");
    expect(builderSheets).not.toContain('InputAccessoryView');
    expect(read('screens', 'builder', 'BuilderParts.tsx')).toContain("from '../../ui/table-parts'");
  });
  it('press-and-hold drag is the shared DragList on Your workout, the round’s set rows and the Workout sheet', () => {
    expect(builderWorkout).toMatch(/<DragList[\s\S]{0,200}allowOnto[\s\S]{0,200}kind: 'drop'/);
    expect(table).toContain('<DragList');
    expect(table).toContain('canDrop={(_from, t) => movable.includes(t.key)}');
    expect(table.match(/useDragHandle\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sheets).toMatch(/<DragList enabled=\{p\.drag !== undefined\} allowOnto/);
    expect(workout).toContain('draggable: (id) => roundDraggable(loaded.aggregate, id)');
    expect(workout).toContain('canDrop: (from, t) => canDropRound(loaded.aggregate, from, t.key, t.edge)');
  });
});

describe('the round page (§7)', () => {
  it('the exercise name opens the pop-up; Swap and Add use the builder’s sheet; the old mid-workout swap sheet is gone', () => {
    expect(workout).toContain('workoutEdits.open(card.sessionExerciseId)');
    expect(workout).toContain('{workoutEdits.node}');
    expect(workout).not.toContain('MidSwapSheet');
    expect(workout).toContain("onAddExercise={shown === rounds.length - 1 ? () => { workoutEdits.openAdd(); } : null}");
    expect(table).toContain('＋ Add exercise');
  });
  it('VoiceOver: set rows have Change type / Move up / Move down / Delete; headers have the exercise’s actions', () => {
    expect(table).toContain("{ name: 'type', label: 'Change type' }");
    expect(table).toContain("{ name: 'move_up', label: 'Move up' }");
    expect(table).toContain("{ name: 'move_down', label: 'Move down' }");
    expect(table).toContain('...(p.exerciseActions?.(ex.sessionExerciseId) ?? [])');
  });
  it('a hold without a drag opens the set’s menu (the fallback), the current set keeping its own items', () => {
    expect(workout).toContain('workoutEdits.setMenu(setId, setMoreItems(focus))');
  });
  it('Ben’s own changes get the builder’s advice with Undo and Why?, never a block', () => {
    expect(edits).toContain('services.workoutEdit.advice(before, after)');
    expect(edits).toContain("secondary: 'Why?'");
    expect(edits).toContain('adviceToast(advice)');
  });
  it('screens work out no load, rounding or progression: they call the domain and services', () => {
    for (const src of [edits, workout, table]) {
      for (const fn of ['builderLoad', 'setRowsFor', 'roundDownHere', 'roundToAvailableLoad', 'expectedLoad', 'warmupGap']) expect(src).not.toContain(fn);
    }
    expect(edits).toContain('popupCellWrite(');
    expect(edits).toContain('addWarmupCommand(');
  });
  it('minimal copy: no rule labels or reassurance', () => {
    for (const src of [edits, read('ui', 'exercise-popup.tsx'), read('ui', 'exercise-popup-model.ts')]) {
      for (const banned of ['built-in rule', 'snapped to', 'Nothing changes', 'Est. 1RM']) expect(src).not.toContain(banned);
    }
  });
});
