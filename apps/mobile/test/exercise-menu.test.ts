import { describe, expect, it } from 'vitest';

import { exerciseMenu, roundExerciseMenu, targetRpeChips, targetRpeMenu, targetRpeScopeMenu } from '../src/workout/exercise-menu';

/** Review S3: a tap must run the action written on the row, in both menu shapes. */
describe('exercise ⋯ menu', () => {
  it('without How to: every row maps to its own action; the two destructive rows are red', () => {
    const m = exerciseMenu(false);
    expect(m.options).toEqual(['Add set', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['add_set', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(m.options[m.cancelButtonIndex]).toBe('Cancel');
  });

  it('with How to: it leads, and nothing below it shifts onto the wrong action', () => {
    const m = exerciseMenu(true);
    expect(m.options).toEqual(['How to', 'Add set', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'add_set', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(m.options[m.cancelButtonIndex]).toBe('Cancel');
  });

  it('with a coach change on the set: Undo coach change sits under How to, not red, and the rows below keep their actions', () => {
    const m = exerciseMenu(true, true);
    expect(m.options).toEqual(['How to', 'Undo coach change', 'Add set', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'undo_coach', 'add_set', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(exerciseMenu(false, true).actionAt(0)).toBe('undo_coach');
  });

  it('mid-workout swap (EL4): Swap exercise under Add set while sets are pending; Undo swap near the top, never red', () => {
    const m = exerciseMenu(true, false, { canSwap: true, canUndoSwap: true });
    expect(m.options).toEqual(['How to', 'Undo swap', 'Add set', 'Swap exercise', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'undo_swap', 'add_set', 'swap', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(exerciseMenu(false, false, { canSwap: false }).options).not.toContain('Swap exercise');
  });

  it('Not at this gym (Ben, 20 Oct) sits under Swap, never red, only when the row uses a gym item', () => {
    const m = exerciseMenu(false, false, { canSwap: true, canMarkNotHere: true });
    expect(m.options.slice(0, 3)).toEqual(['Add set', 'Swap exercise', 'Not at this gym']);
    expect(m.actionAt(2)).toBe('not_at_gym');
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(exerciseMenu(false).options).not.toContain('Not at this gym');
  });

  it('Superset with… and Remove superset (Ben, 19 Oct) sit under Swap, never red, each mapped to its own action', () => {
    const m = exerciseMenu(false, false, { canSwap: true, canSuperset: true, inSuperset: true });
    expect(m.options).toEqual(['Add set', 'Swap exercise', 'Superset with…', 'Remove superset', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.actionAt(2)).toBe('superset_with');
    expect(m.actionAt(3)).toBe('remove_superset');
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise']);
    expect(exerciseMenu(false).options).not.toContain('Superset with…');
    expect(exerciseMenu(false, false, { canSuperset: true }).options).not.toContain('Remove superset');
  });

  it('Remove exercise (nothing logged, §4.6) is the last red row, above Cancel', () => {
    const m = exerciseMenu(false, false, { canSwap: true, canRemove: true });
    expect(m.options.slice(-3)).toEqual(['Skip exercise', 'Remove exercise', 'Cancel']);
    expect(m.actionAt(m.options.indexOf('Remove exercise'))).toBe('remove_exercise');
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Delete this set', 'Skip exercise', 'Remove exercise']);
    expect(exerciseMenu(false).options).not.toContain('Remove exercise');
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

/** Review B1 ("edit anything on the sets"): the current set opens Edit set from ⋯ (Focus and the Table's open row). */
describe('Edit set', () => {
  it('sits above Target RPE and Add set when the exercise has a set not done yet; the rows below keep their actions', () => {
    const m = exerciseMenu(true, false, { canEditSet: true, hasTargetRpe: true });
    expect(m.options).toEqual(['How to', 'Edit set', 'Target RIR', 'Add set', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'edit_set', 'target_rpe', 'add_set', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(exerciseMenu(false).options).not.toContain('Edit set');
  });
});

/** CHANGELOG 2026-10-11 (b): Ben overrides the target RPE for a set, an exercise or today. */
describe('Target RIR', () => {
  it('sits above Add set when the set carries a target; the rows below keep their actions', () => {
    const m = exerciseMenu(true, 'rule', { hasTargetRpe: true });
    expect(m.options).toEqual(['How to', 'Undo change', 'Target RIR', 'Add set', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['how_to', 'undo_coach', 'target_rpe', 'add_set', 'notes', 'add_exercise', 'delete_set', 'skip_exercise', null]);
    expect(exerciseMenu(false, false, { hasTargetRpe: false }).options).not.toContain('Target RIR');
  });

  it('with a swap and a target RPE: Undo swap, then Target RPE, then Add set and Swap exercise; Remove last before Cancel', () => {
    const m = exerciseMenu(false, true, { canUndoSwap: true, hasTargetRpe: true, canSwap: true, canRemove: true });
    expect(m.options).toEqual(['Undo coach change', 'Undo swap', 'Target RIR', 'Add set', 'Swap exercise', 'Notes', 'Add exercise', 'Delete this set', 'Skip exercise', 'Remove exercise', 'Cancel']);
    expect(m.destructiveButtonIndex).toEqual([7, 8, 9]);
  });

  it('RIR 0–4 in half steps (RPE 10–6), the current one ticked; Default only when Ben set his own', () => {
    const rule = targetRpeMenu({ rpe: 8.5, source: 'rule' });
    expect(rule.options).toEqual(['RIR 0', 'RIR 0.5', 'RIR 1', 'RIR 1.5 ✓', 'RIR 2', 'RIR 2.5', 'RIR 3', 'RIR 3.5', 'RIR 4', 'Cancel']);
    expect(rule.valueAt(4)).toBe(8);
    expect(rule.valueAt(rule.cancelButtonIndex)).toBeUndefined();
    expect(rule.valueAt(-1)).toBeUndefined();
    const ben = targetRpeMenu({ rpe: 10, source: 'ben' });
    expect(ben.options.at(-2)).toBe('Default');
    expect(ben.valueAt(ben.options.length - 2)).toBeNull();
  });

  it('Edit set chips match the sheet: the target in force selected; Default only when Ben set his own (review r2 N3)', () => {
    expect(targetRpeChips(null)).toEqual([]);
    const rule = targetRpeChips({ target: { rpe: 8.5, source: 'rule' }, override: null });
    // (Ben, 26 Oct) Labelled as RIR, hardest first; the values stay RPE.
    expect(rule.map((c) => c.label)).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4']);
    expect(rule.filter((c) => c.selected).map((c) => c.value)).toEqual([8.5]);
    const ben = targetRpeChips({ target: { rpe: 10, source: 'ben' }, override: 10 });
    expect(ben.at(-1)).toEqual({ key: 'default', label: 'Default', value: null, selected: false });
    // Tapping Ben's value again keeps it (as in the sheet); Default clears it.
    expect(ben.find((c) => c.value === 10)).toMatchObject({ selected: true, value: 10 });
  });

  it('then this set, this exercise or today', () => {
    const m = targetRpeScopeMenu('set-1', 'ex-1');
    expect(m.options).toEqual(['This set', 'This exercise', 'Today', 'Cancel']);
    expect([0, 1, 2, 3].map((i) => m.scopeAt(i))).toEqual([{ kind: 'set', setId: 'set-1' }, { kind: 'exercise', sessionExerciseId: 'ex-1' }, { kind: 'today' }, null]);
  });

  it('(Ben, 31 Oct) the round page’s ⋯: Swap, Do next, Move to end, Add set, History, Plates, Notes, Skip; each mapped', () => {
    const m = roundExerciseMenu({ canSwap: true, doNext: true, moveToEnd: true, plates: true });
    expect(m.options).toEqual(['Swap exercise', 'Do next', 'Move to end', 'Add set', 'History', 'Plates', 'Notes', 'Skip exercise', 'Cancel']);
    expect(m.options.map((_, i) => m.actionAt(i))).toEqual(['swap', 'do_next', 'move_to_end', 'add_set', 'history', 'plates', 'notes', 'skip_exercise', null]);
    expect(m.destructiveButtonIndex.map((i) => m.options[i])).toEqual(['Skip exercise']);
    // Gone from it: they live on the set, at the end of the list, in the Swap sheet and the name's pop-up.
    for (const gone of ['Edit set', 'Target RIR', 'Delete this set', 'Add exercise', 'Not at this gym', 'How to', 'Move up', 'Move down', 'Superset with next', 'Superset with…', 'Unlink', 'Remove exercise']) expect(m.options).not.toContain(gone);
  });

  it('a done exercise: no Do next / Move to end, no Swap; dumbbells or a stack: no Plates', () => {
    const done = roundExerciseMenu({ canSwap: false, doNext: false, moveToEnd: false, plates: false });
    expect(done.options).toEqual(['Add set', 'History', 'Notes', 'Skip exercise', 'Cancel']);
  });

  it('the current exercise keeps Adjust last before Skip; a pending change shows its Undo', () => {
    const m = roundExerciseMenu({ canSwap: true, doNext: false, moveToEnd: false, plates: false, coachChange: true, canUndoSwap: true, adjust: true });
    expect(m.options).toEqual(['Swap exercise', 'Add set', 'History', 'Notes', 'Undo coach change', 'Undo swap', 'Adjust', 'Skip exercise', 'Cancel']);
    expect(m.actionAt(6)).toBe('adjust');
    expect(m.actionAt(7)).toBe('skip_exercise');
    expect(roundExerciseMenu({ canSwap: false, doNext: false, moveToEnd: false, plates: false, coachChange: 'rule' }).options).toContain('Undo change');
  });
});
