import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildActiveSetView, buildAddExerciseCommand, buildSetEditView, NBSP, reduceSession, startWorkout, type ActiveViewInput, type FocusView } from '@fizz/domain';
import { apply, assisted, at, BENCH, dumbbells, exercise, GYM, idGen, kg, lb, logCmd, ms, profile, setsFor, startFixture, values } from '@fizz/domain/testing';
import type { EquipmentInstance, Exercise, SessionAggregate, SetValues } from '@fizz/schemas';

import { cellEditReducer, cellInputA11y, cellKeypadBar, correctionPatch, doneRowEditing, editsInPlace, keypadNextAction, mergeCorrection, openCellTap, openRowEditing, type CellFields } from '../src/workout/table';

/**
 * Ben, 20 Oct (screenshot: UPPER BODY, Dumbbell rear-delt fly, row
 * `3 | 7.5 | 12 | @ 9 | ✓`): tapping KG opened a second full-width
 * `− 7.5 + Done` line under the row while the cell still showed 7.5. Now the
 * tapped cell is the field itself and − + Next Done ride the keypad bar.
 * No renderer in this lane: the behaviour is in pure functions run on real
 * domain views; the layout is checked in source; the feel is on Ben's device.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const table = read('screens', 'workout', 'WorkoutTable.tsx');
const screen = read('screens', 'workout', 'WorkoutScreen.tsx');
const ui = read('ui', 'workout.tsx');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function emptyWith(ex: Exercise, eq: EquipmentInstance, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(71_000);
  const state = startWorkout({ opId: 'start-c', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(0), newId: ids }).aggregate;
  return apply(state, buildAddExerciseCommand({ opId: 'add-c', owner, exercise: ex, equipmentId: eq.id, at: at(1), newId: ids }));
}
function focusOf(aggregate: SessionAggregate, over: Partial<ActiveViewInput> = {}): FocusView {
  const v = buildActiveSetView({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null, ...over });
  if (!v.focus) throw new Error('no focus');
  return v.focus;
}
const fieldsOf = (f: FocusView): CellFields => ({ load: f.loadField, reps: f.reps, duration: f.duration, distance: f.distance });
const lifting = { reps: true, distance: false, cardio: false };

describe('the tapped cell is the field (Ben, 20 Oct)', () => {
  it('KG, REPS, TIME and DIST edit in place; only cardio’s two-value TIME · DIST cell keeps its pair', () => {
    for (const field of ['load', 'reps', 'time', 'distance'] as const) expect(editsInPlace({ field, cardio: false })).toBe(true);
    expect(editsInPlace({ field: 'load', cardio: true })).toBe(true);
    expect(editsInPlace({ field: 'time', cardio: true })).toBe(false);
    expect(editsInPlace({ field: 'distance', cardio: true })).toBe(false);
  });

  it('tap KG: that cell becomes the field, value selected, decimal pad, accent border; no second editor line', () => {
    // The tap opens the open row's KG cell (and focuses it).
    expect(openCellTap(null, 'load')).toEqual({ kind: 'focus', field: 'load' });
    const edit = cellEditReducer(null, { kind: 'enter', setId: 's3', field: 'load' });
    expect(openRowEditing(edit, 's3')).toBe('load');
    // The cell variant: the TextInput itself, selected on focus, decimal pad for loads, 2 pt accent border.
    const cell = ui.slice(ui.indexOf('if (cellVariant) {'), ui.indexOf('if (inline) {'));
    expect(cell).toContain('borderWidth: 2');
    expect(cell).toContain("theme.colors['status.warning'] : theme.colors.accent");
    expect(cell).not.toContain('TileStep');
    expect(ui).toContain('selectTextOnFocus');
    expect(ui).toContain("keyboardType={decimals ? 'decimal-pad' : 'number-pad'}");
    // The open row draws it in the cell, not under the row.
    const open = table.slice(table.indexOf('export function OpenSetRow'), table.indexOf('function InlineEditor('));
    expect(open).toContain('const field = on && editsInPlace({ field: id, cardio }) ? inPlace(id) : null;');
    expect(open).not.toMatch(/p\.editing === 'load' && f\.loadField\) \{\s*editor =/);
    expect(open).not.toMatch(/p\.editing === 'reps' && f\.reps\) \{\s*editor =/);
    // The load cell's field is a decimal field; reps whole numbers.
    expect(open).toMatch(/key="load" \{\.\.\.common\}[^\n]*value=\{l\.value\} decimals /);
    expect(open).toMatch(/key="reps" \{\.\.\.common\}[^\n]*decimals=\{false\}/);
  });

  it('a done row’s cell is the field too; at AX sizes (one block row) it sits under the row', () => {
    expect(table).toContain('cellEditor={p.rowEditor?.setId === r.setId && p.rowEditor.inCell && !p.ax ? p.rowEditor.node : null}');
    expect(table).toContain('{p.rowEditor?.setId === r.setId && (!p.rowEditor.inCell || p.ax) ? <View>{p.rowEditor.node}</View> : null}');
    const row = table.slice(table.indexOf('export function TableSetRow'), table.indexOf('export interface OpenSetRowProps'));
    expect(flat(row)).toContain('if (on && cellEditor !== null) {');
    const corr = table.slice(table.indexOf('export function CorrectionEditor'), table.indexOf('function NoteLink('));
    // Single values return the cell field alone: no InlineEditor (no second line, no row Done).
    expect(corr).toMatch(/return <NumberStepper key="load" \{\.\.\.cellProps\}/);
    expect(corr).toMatch(/return <NumberStepper key="reps" \{\.\.\.cellProps\}/);
    expect(screen).toContain('inCell: editsInPlace({ field: doneEdit.field, cardio: correctionCardio }),');
  });

  it('VoiceOver: the cell reads `Set 3 weight, 7.5 kg each`, with no dead swipe actions (the bar’s − / + step)', () => {
    expect(cellInputA11y({ stepName: 'Set 3', field: 'load', value: 7.5, unitText: 'kg each' })).toBe('Set 3 weight, 7.5 kg each');
    expect(cellInputA11y({ stepName: 'Set 3', field: 'reps', value: 12 })).toBe('Set 3 reps, 12');
    expect(cellInputA11y({ stepName: 'Set A2', field: 'load', value: 20, unitText: 'kg', assisted: true })).toBe('Set A2 assistance, 20 kg');
    expect(cellInputA11y({ stepName: 'Set 1', field: 'time', value: 45 })).toBe('Set 1 time, 45 seconds');
    expect(cellInputA11y({ stepName: 'Set 2', field: 'distance', value: 20 })).toBe('Set 2 distance, 20 metres');
    expect(cellInputA11y({ stepName: 'Set 4', field: 'load', value: null, unitText: 'kg' })).toBe('Set 4 weight, none');
    expect(cellInputA11y({ stepName: 'Set 5', field: 'load', value: 45, unitText: 'lb each' })).toBe('Set 5 weight, 45 lb each');
    expect(cellInputA11y({ stepName: 'Warm-up', field: 'reps', value: 10 })).toBe('Warm-up reps, 10');
    expect(ui).toContain('accessibilityLabel={fieldLabel ?? ');
    // VoiceOver focuses RN's native text field, so actions on the cell never fire: none are declared.
    expect(ui).not.toContain("name: 'increment'");
    expect(ui).not.toContain('onAccessibilityAction');
  });
});

describe('the keypad bar: − + Next › Done', () => {
  it('per-hand dumbbells (kg): − / + are one rack step; + stops at the rack max with its reason', () => {
    const db = dumbbells();
    const fly = exercise(230, 'Dumbbell rear-delt fly', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(fly, db);
    const setId = focusOf(s).setId;
    const f = focusOf(s, { edits: { setId, values: values(kg(7.5, 'per_hand'), 12) } });
    const bar = cellKeypadBar({ field: 'load', fields: fieldsOf(f), cardio: false, next: keypadNextAction({ keypad: { row: 'open', field: 'load' }, open: lifting, done: null }) });
    expect(bar?.down).toEqual(f.loadField?.down);
    expect(bar?.up).toEqual(f.loadField?.up);
    expect(bar?.up.enabled && bar.up.value).toBe(10);
    expect(bar?.down.enabled && bar.down.value).toBe(5);
    expect(plain(bar?.increaseLabel)).toBe('Increase weight to 10 kg each');
    expect(bar?.limit).toBeNull();
    // Next › goes from the weight to the reps.
    expect(bar?.next).toEqual({ kind: 'focus_open', field: 'reps' });
    // Never past the rack's max.
    const atMax = focusOf(s, { edits: { setId, values: values(kg(30, 'per_hand'), 12) } });
    const top = cellKeypadBar({ field: 'load', fields: fieldsOf(atMax), cardio: false, next: null });
    expect(top?.up.enabled).toBe(false);
    expect(plain(top?.limit)).toBe('Rack maximum 30 kg each');
    expect(top?.increaseLabel).toBe('Increase weight');
  });

  it('lb stays lb', () => {
    const db = dumbbells({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35, 40, 45, 50] });
    const press = exercise(231, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(press, db, 'lb');
    const f = focusOf(s, { edits: { setId: focusOf(s).setId, values: values(lb(45, 'per_hand'), 10) } });
    const bar = cellKeypadBar({ field: 'load', fields: fieldsOf(f), cardio: false, next: null });
    expect(plain(bar?.increaseLabel)).toBe('Increase weight to 50 lb each');
    expect(plain(bar?.decreaseLabel)).toBe('Decrease weight to 40 lb each');
  });

  it('assisted machine: + reads More assistance (easier)', () => {
    const a = assisted();
    const pull = exercise(232, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const s = emptyWith(pull, a);
    const f = focusOf(s, { edits: { setId: focusOf(s).setId, values: values(kg(20, 'assistance'), 6) } });
    const bar = cellKeypadBar({ field: 'load', fields: fieldsOf(f), cardio: false, next: null });
    expect(plain(bar?.increaseLabel)).toBe('More assistance (easier) to Assist 25 kg');
    expect(plain(bar?.decreaseLabel)).toBe('Less assistance (harder) to Assist 15 kg');
  });

  it('reps step by 1; on the last field there is no Next ›, only Done', () => {
    const db = dumbbells();
    const fly = exercise(233, 'Dumbbell rear-delt fly', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(fly, db);
    const f = focusOf(s, { edits: { setId: focusOf(s).setId, values: values(kg(7.5, 'per_hand'), 12) } });
    const bar = cellKeypadBar({ field: 'reps', fields: fieldsOf(f), cardio: false, next: keypadNextAction({ keypad: { row: 'open', field: 'reps' }, open: lifting, done: null }) });
    expect(bar?.up.enabled && bar.up.value).toBe(13);
    expect(bar?.down.enabled && bar.down.value).toBe(11);
    expect(bar?.increaseLabel).toBe('Increase reps to 13');
    expect(bar?.next).toBeNull();
  });

  it('no bar when nothing is edited, or for cardio’s pair (its tiles keep their own − / +)', () => {
    const f = { load: null, reps: null, duration: { value: 600, down: { enabled: true as const, value: 570, label: '9:30' }, up: { enabled: true as const, value: 630, label: '10:30' } }, distance: { value: 2000, down: { enabled: true as const, value: 1900, label: '1900' }, up: { enabled: true as const, value: 2100, label: '2100' } } };
    expect(cellKeypadBar({ field: null, fields: f, cardio: false, next: null })).toBeNull();
    expect(cellKeypadBar({ field: 'time', fields: f, cardio: true, next: null })).toBeNull();
    expect(cellKeypadBar({ field: 'distance', fields: f, cardio: true, next: null })).toBeNull();
    // A timed set's own time cell does get the bar.
    expect(cellKeypadBar({ field: 'time', fields: f, cardio: false, next: null })?.increaseLabel).toBe('Increase time to 10:30');
  });

  it('the screen draws the bar on the keypad under Log, and its keys run the row’s own handlers', () => {
    const chrome = flat(screen.slice(screen.indexOf('<ActionBar talk={<CoachAskBar'), screen.indexOf('<ToastHost')));
    expect(chrome).toContain('{cellBar !== null ? ( <CellKeypadBarView');
    // One home-indicator gap only: the Log bar drops its own when the cell bar sits under it (review S2).
    expect(chrome).toContain('keypadOpen={keypadOpen || cellBar !== null} />');
    expect(chrome).toContain('onDone={closeCellEditors}');
    expect(chrome).toContain('runKeypadNext(cellBar.next)');
    expect(chrome).toContain('stepCell(cellBar.field, v);');
    // − / + go through the same handlers as typing (editLoad snaps / clamps as before; a correction only drafts).
    expect(flat(screen)).toContain('onLoad: (v: number | null) => { editLoad(focus, v); },');
    expect(flat(screen)).toContain('onLoad={openInput.onLoad}');
    expect(flat(screen)).toContain('{...correctionInput}');
    // Bar keys: labelled, 44 pt, Done closes the keypad first.
    const bar = flat(ui.slice(ui.indexOf('export function CellKeypadBarView'), ui.indexOf('/** D tile − / +')));
    expect(bar).toContain("textKey('Next ›', 'Next field', onNext)");
    expect(bar).toContain("textKey('Done', 'Done', () => { Keyboard.dismiss(); onDone(); })");
    expect(bar).toContain("stepKey('−', down, decreaseLabel)");
    expect(bar).toContain("stepKey('+', up, increaseLabel)");
    expect(bar).toContain('minHeight: theme.target.min.height');
    // A cell field has no InputAccessoryView of its own (Fabric never attaches one to a field mounted later).
    expect(ui).toContain('{...(cellVariant ? {} : { inputAccessoryViewID: NUMBER_ACCESSORY_ID })}');
  });
});

describe('Log follows what is typed or stepped; completed sets never change silently', () => {
  it('a + step on the bar is the value Log logs', () => {
    const db = dumbbells();
    const fly = exercise(234, 'Dumbbell rear-delt fly', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(fly, db);
    const setId = focusOf(s).setId;
    let draft: SetValues = values(kg(7.5, 'per_hand'), 12);
    let f = focusOf(s, { edits: { setId, values: draft } });
    expect(plain(f.logLabel)).toBe('Log 7.5 kg each × 12');
    const bar = cellKeypadBar({ field: 'load', fields: fieldsOf(f), cardio: false, next: null });
    if (!bar?.up.enabled) throw new Error('up');
    draft = { ...draft, load: kg(bar.up.value, 'per_hand') };
    f = focusOf(s, { edits: { setId, values: draft } });
    expect(plain(f.logLabel)).toBe('Log 10 kg each × 12');
    // Typed reps (each keystroke is a draft edit) show in Log too.
    f = focusOf(s, { edits: { setId, values: { ...draft, reps: 10 } } });
    expect(plain(f.logLabel)).toBe('Log 10 kg each × 10');
  });

  it('a done row: stepping or typing only drafts; Done sends one versioned correctSet, unchanged sends none, a stale version is refused', () => {
    const { state } = startFixture();
    const warm = setsFor(state, BENCH)[0];
    if (!warm) throw new Error('set');
    const logged = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
    const before = logged.sets.find((x) => x.id === warm.id);
    const edit = buildSetEditView(logged, warm.id, null);
    if (!edit || !before?.actual) throw new Error('edit');
    // Tap the done row's KG: its cell is the field, with the bar's steps from `buildSetEditView`.
    const cellEdit = cellEditReducer(null, { kind: 'tap', setId: warm.id, field: 'load', row: 'done' });
    expect(doneRowEditing(cellEdit)).toEqual({ setId: warm.id, field: 'load', row: 'done' });
    const bar = cellKeypadBar({ field: 'load', fields: { load: edit.loadField, reps: edit.reps, duration: edit.duration, distance: edit.distance }, cardio: false, next: keypadNextAction({ keypad: { row: 'done', field: 'load' }, open: null, done: { ...lifting, setId: warm.id } }) });
    expect(bar?.next).toEqual({ kind: 'done_cell', setId: warm.id, field: 'reps' });
    if (!bar?.up.enabled) throw new Error('up');
    // Nothing changes on a step: only the draft.
    let c: { setId: string; values: SetValues | null; opId: string } | null = { setId: warm.id, values: null, opId: 'fix-1' };
    c = mergeCorrection(c, edit.values, { load: kg(bar.up.value) });
    expect(logged.sets.find((x) => x.id === warm.id)).toEqual(before);
    // Stepped back to what was logged: no write at all.
    expect(correctionPatch(before.actual, { ...edit.values, load: kg(60) })).toBeNull();
    const patch = correctionPatch(before.actual, c?.values ?? edit.values);
    expect(patch).toEqual({ load: kg(bar.up.value) });
    // One versioned write on Done; a stale version is refused, never applied to newer state.
    const ok = reduceSession(logged, { type: 'correct_set', at: at(40), opId: 'fix-1', setId: warm.id, expectedSetVersion: edit.setVersion, patch: patch ?? {} });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const again = reduceSession(ok.state, { type: 'correct_set', at: at(41), opId: 'fix-2', setId: warm.id, expectedSetVersion: edit.setVersion, patch: { reps: 9 } });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('stale_version');
    // The screen still saves only on close (Done, a tap elsewhere), never per step.
    expect(flat(screen)).toContain('function closeCellEditors() { if (correction !== null) void saveCorrection();');
  });
});
