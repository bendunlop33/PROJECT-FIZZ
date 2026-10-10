import { describe, expect, it } from 'vitest';

import { exerciseMenu } from '../src/workout/exercise-menu';

/** Review S3: a tap must run the action written on the row, in both menu shapes. */
describe('exercise ⋯ menu', () => {
  it('without How to: every row maps to its own action; the two destructive rows are red', () => {
    const m = exerciseMenu(false);
    expect(m.options).toEqual(['Add set', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['add_set', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(m.options[m.cancelButtonIndex]).toBe('Cancel');
  });

  it('with How to: it leads, and nothing below it shifts onto the wrong action', () => {
    const m = exerciseMenu(true);
    expect(m.options).toEqual(['How to', 'Add set', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'add_set', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(m.options[m.cancelButtonIndex]).toBe('Cancel');
  });

  it('with a coach change on the set: Undo coach change sits under How to, not red, and the rows below keep their actions', () => {
    const m = exerciseMenu(true, true);
    expect(m.options).toEqual(['How to', 'Undo coach change', 'Add set', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'undo_coach', 'add_set', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(exerciseMenu(false, true).actionAt(0)).toBe('undo_coach');
  });

  it('the bottom rows sit the same distance from the thumb in both shapes', () => {
    const a = exerciseMenu(false).options;
    const b = exerciseMenu(true).options;
    expect(b.slice(-a.length)).toEqual(a);
  });

  it('a dismissal or an out-of-range index does nothing (never a destructive action)', () => {
    for (const m of [exerciseMenu(false), exerciseMenu(true)]) {
      expect(m.actionAt(-1)).toBeNull();
      expect(m.actionAt(m.options.length)).toBeNull();
      expect(m.actionAt(m.cancelButtonIndex)).toBeNull();
      expect(m.actionAt(Number.NaN)).toBeNull();
    }
  });
});
