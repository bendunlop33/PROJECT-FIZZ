import { describe, expect, it } from 'vitest';

import { exerciseMenu, targetRpeMenu, targetRpeScopeMenu } from '../src/workout/exercise-menu';

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

/** CHANGELOG 2026-10-11 (b): Ben overrides the target RPE for a set, an exercise or today. */
describe('Target RPE', () => {
  it('sits above Add set when the set carries a target; the rows below keep their actions', () => {
    const m = exerciseMenu(true, 'rule', true);
    expect(m.options).toEqual(['How to', 'Undo change', 'Target RPE', 'Add set', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'undo_coach', 'target_rpe', 'add_set', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(exerciseMenu(false, false, false).options).not.toContain('Target RPE');
  });

  it('values 6–10 in half steps, the current one ticked; Default only when Ben set his own', () => {
    const rule = targetRpeMenu({ rpe: 8.5, source: 'rule' });
    expect(rule.options).toEqual(['RPE 6', 'RPE 6.5', 'RPE 7', 'RPE 7.5', 'RPE 8', 'RPE 8.5 ✓', 'RPE 9', 'RPE 9.5', 'RPE 10', 'Cancel']);
    expect(rule.valueAt(4)).toBe(8);
    expect(rule.valueAt(rule.cancelButtonIndex)).toBeUndefined();
    expect(rule.valueAt(-1)).toBeUndefined();
    const ben = targetRpeMenu({ rpe: 10, source: 'ben' });
    expect(ben.options.at(-2)).toBe('Default');
    expect(ben.valueAt(ben.options.length - 2)).toBeNull();
  });

  it('then this set, this exercise or today', () => {
    const m = targetRpeScopeMenu('set-1', 'ex-1');
    expect(m.options).toEqual(['This set', 'This exercise', 'Today', 'Cancel']);
    expect([0, 1, 2, 3].map((i) => m.scopeAt(i))).toEqual([{ kind: 'set', setId: 'set-1' }, { kind: 'exercise', sessionExerciseId: 'ex-1' }, { kind: 'today' }, null]);
  });
});
