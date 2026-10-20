import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { WORKOUT_KEYBOARD } from '../src/workout/keyboard';
import { runRowTap } from '../src/workout/table';

/**
 * F5 (Ben, 13 Oct): "the keyboard stays up on a working set". Source checks (no
 * renderer in this lane), as the coach sheet's (build 131); the feel needs a real iPhone.
 */

const SRC = join(__dirname, '..', 'src');
const screen = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
const table = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutTable.tsx'), 'utf8');
const ui = readFileSync(join(SRC, 'ui', 'workout.tsx'), 'utf8');

describe('workout keyboard (F5)', () => {
  it('dragging Focus or the Table closes the number pad; buttons still work on the first tap', () => {
    expect(WORKOUT_KEYBOARD).toEqual({ keyboardDismissMode: 'interactive', keyboardShouldPersistTaps: 'handled' });
    expect(screen).toContain('{...WORKOUT_KEYBOARD}');
    expect(table).toContain('{...WORKOUT_KEYBOARD}');
  });

  it('a tap outside a field on Focus closes it', () => {
    expect(screen.replace(/\s+/g, ' ')).toContain('<Pressable accessible={false} onPress={() => { Keyboard.dismiss(); }}');
  });

  it('in the Table, tapping another row closes it before selecting or editing (review S3)', () => {
    for (const [state, part, action] of [['pending', 'marker', 'select'], ['pending', 'row', 'edit'], ['done', 'row', 'edit']] as const) {
      const calls: string[] = [];
      const h = { dismissKeyboard: vi.fn(() => calls.push('dismiss')), edit: vi.fn(() => calls.push('edit')), select: vi.fn(() => calls.push('select')), selectEdit: vi.fn(), correct: vi.fn() };
      expect(runRowTap({ state, setId: 's1' }, h, part).kind).toBe(action);
      expect(calls).toEqual(['dismiss', action]);
      expect(h[action]).toHaveBeenCalledWith('s1');
    }
    // The open and skipped rows do nothing, and leave the pad as it is.
    for (const state of ['open', 'skipped'] as const) {
      const h = { dismissKeyboard: vi.fn(), edit: vi.fn(), select: vi.fn(), selectEdit: vi.fn(), correct: vi.fn() };
      expect(runRowTap({ state, setId: 's1' }, h).kind).toBe('none');
      expect(h.dismissKeyboard).not.toHaveBeenCalled();
    }
    expect(table).toContain('runRowTap(row, {');
  });

  it('Log closes it', () => {
    const log = screen.slice(screen.indexOf('async function log()'), screen.indexOf("type: 'log_set'"));
    expect(log).toContain('Keyboard.dismiss();');
  });

  it('every number field has the visible Done bar, rendered on the workout screen', () => {
    expect(ui).toMatch(/keyboardType=\{decimals \? 'decimal-pad' : 'number-pad'\}\s*inputAccessoryViewID=\{NUMBER_ACCESSORY_ID\}/);
    // With Next › from the weight to the reps, and Done closing the editor too (design pass 1.4).
    expect(screen).toContain('<NumberAccessory onNext={onKeypadNext} onDone={closeCellEditors} />');
  });
});

describe('the table stays a table (18 Oct; review B1, S3, S4, S6)', () => {
  const fn = (name: string) => screen.slice(screen.indexOf(name), screen.indexOf('\n  }\n', screen.indexOf(name)));
  it('a pending or done row’s cell edits in place: no navigation from a cell tap', () => {
    const tap = fn('function cellTap(');
    expect(tap).toContain("void selectRow(tap.setId).then((ok) => {");
    // A pending row's cell opens with its field focused (design pass 1.4).
    expect(tap).toContain('if (ok) setFocusRequest({ field: tap.field });');
    expect(tap).toContain("row: 'done' });");
    expect(tap).not.toContain('navigate(');
    expect(screen).toContain('onCellTap={cellTap}');
  });
  it('a done row’s correction is one versioned correctSet with its opId, sent on close, with Undo (rule 2)', () => {
    const save = fn('async function saveCorrection(');
    expect(save).toContain('expectedSetVersion: v.setVersion');
    expect(save).toContain('opId: c.opId');
    expect(save).toContain('if (patch === null) return;');
    expect(save).toContain('toastUndoOp(UNDO_TOAST.corrected(v.setNumber), c.opId, session.id)');
  });
  it('a Log and a select close the editor, so an Undo never reopens it', () => {
    expect(fn('async function log(')).toContain("editCell({ kind: 'logged' });");
    expect(fn('async function selectRow(')).toContain("editCell({ kind: 'selected' });");
  });
  it('a drag or a tap below the rows closes it', () => {
    expect(table.replace(/\s+/g, ' ')).toContain('onScrollBeginDrag={() => { props.onUserScroll(); props.onTapElsewhere(); }}');
    expect(table).toContain('accessible={false} onPress={props.onTapElsewhere}');
    expect(screen).toContain('onTapElsewhere={closeCellEditors}');
  });
  it('✓ on the open row logs only when Log can, and says what it logs', () => {
    expect(table).toContain('disabled={!p.canLog}');
    expect(table).toContain('accessibilityLabel={`Set ${String(f.setNumber)}, ${plainSpaces(p.timedLogLabel ?? f.logLabel ?? \'Log\')}`}');
  });
  it('⋯ keeps copy last, the full set editor and Focus', () => {
    const more = fn('function openSetMore(');
    for (const label of ['Copy last', "'Edit set'", "'Focus view'"]) expect(more).toContain(label);
  });
});
