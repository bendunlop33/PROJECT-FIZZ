import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adjustControlView } from '../src/coach/slot-view';
import { cellEditReducer, correctionPatch, doneRowEditing, keypadNext, keypadNextAction, mergeCorrection, openCellTap, type CellEdit } from '../src/workout/table';
import { cardioPairTiles, openRowWidth, tileFit, tileRowLayout } from '../src/workout/tile-fit';

/**
 * Design pass batch 1 (Ben approved 20 Oct): inline set entry in the Workout
 * table. Pure parts are tested directly; the layout is checked in source (no
 * renderer in this lane) and the feel goes on Ben's device checklist.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const table = read('screens', 'workout', 'WorkoutTable.tsx');
const screen = read('screens', 'workout', 'WorkoutScreen.tsx');
const ui = read('ui', 'workout.tsx');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('Next › from weight to reps (1.4)', () => {
  it('weight → reps; a cardio time → its distance; the last field shows Done', () => {
    expect(keypadNext({ field: 'load', has: { reps: true, distance: false }, cardio: false })).toBe('reps');
    expect(keypadNext({ field: 'reps', has: { reps: true, distance: false }, cardio: false })).toBeNull();
    // A loaded timed or distance set has no reps to go to.
    expect(keypadNext({ field: 'load', has: { reps: false, distance: true }, cardio: false })).toBeNull();
    expect(keypadNext({ field: 'time', has: { reps: false, distance: true }, cardio: true })).toBe('distance');
    expect(keypadNext({ field: 'time', has: { reps: false, distance: true }, cardio: false })).toBeNull();
    expect(keypadNext({ field: 'distance', has: { reps: false, distance: true }, cardio: true })).toBeNull();
    expect(keypadNext({ field: null, has: { reps: true, distance: true }, cardio: true })).toBeNull();
  });

  it('Next › picks the right target on the open row, Focus and a done row (review S3)', () => {
    const lifting = { reps: true, distance: false, cardio: false };
    const cardio = { reps: false, distance: true, cardio: true };
    expect(keypadNextAction({ keypad: null, open: lifting, done: null })).toBeNull();
    expect(keypadNextAction({ keypad: { row: 'open', field: 'load' }, open: lifting, done: null })).toEqual({ kind: 'focus_open', field: 'reps' });
    expect(keypadNextAction({ keypad: { row: 'open', field: 'reps' }, open: lifting, done: null })).toBeNull();
    // The open row with no Focus (nothing to move to).
    expect(keypadNextAction({ keypad: { row: 'open', field: 'load' }, open: null, done: null })).toBeNull();
    expect(keypadNextAction({ keypad: { row: 'done', field: 'load' }, open: lifting, done: { ...lifting, setId: 's2' } })).toEqual({ kind: 'done_cell', setId: 's2', field: 'reps' });
    expect(keypadNextAction({ keypad: { row: 'done', field: 'time' }, open: null, done: { ...cardio, setId: 's3' } })).toEqual({ kind: 'focus_done_distance' });
    // A done row's keypad with its editor gone: Done, not a move.
    expect(keypadNextAction({ keypad: { row: 'done', field: 'load' }, open: lifting, done: null })).toBeNull();
  });

  it('a done row: weight typed, Next ›, reps typed → one draft, one opId, one patch (review S3)', () => {
    const actual = { load: { value: 100, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, distanceM: null };
    let c: { setId: string; values: typeof actual | null; opId: string } | null = { setId: 's2', values: null, opId: 'op-1' };
    let edit: CellEdit | null = cellEditReducer(null, { kind: 'tap', setId: 's2', field: 'load', row: 'done' });
    // The weight is typed (each keystroke commits, so leaving the field never loses it).
    c = mergeCorrection(c, c.values ?? actual, { load: { value: 1, unit: 'kg', convention: 'total' } });
    c = mergeCorrection(c, c?.values ?? actual, { load: { value: 102.5, unit: 'kg', convention: 'total' } });
    // Next › moves within the same correction (no save, no new opId).
    const next = keypadNextAction({ keypad: { row: 'done', field: 'load' }, open: null, done: { reps: true, distance: false, cardio: false, setId: 's2' } });
    expect(next).toEqual({ kind: 'done_cell', setId: 's2', field: 'reps' });
    if (next?.kind === 'done_cell') edit = cellEditReducer(edit, { kind: 'tap', setId: next.setId, field: next.field, row: 'done' });
    expect(doneRowEditing(edit)).toEqual({ setId: 's2', field: 'reps', row: 'done' });
    c = mergeCorrection(c, c?.values ?? actual, { reps: 6 });
    expect(c?.opId).toBe('op-1');
    expect(c?.values?.load.value).toBe(102.5);
    // Done sends one correctSet with both changes.
    expect(c?.values ? correctionPatch(actual, c.values) : null).toEqual({ load: { value: 102.5, unit: 'kg', convention: 'total' }, reps: 6 });
    // No correction open: nothing to merge into.
    expect(mergeCorrection(null, actual, { reps: 5 })).toBeNull();
  });

  it('a value cell opens focused; the open one closes', () => {
    expect(openCellTap(null, 'load')).toEqual({ kind: 'focus', field: 'load' });
    expect(openCellTap('load', 'reps')).toEqual({ kind: 'focus', field: 'reps' });
    expect(openCellTap('reps', 'reps')).toEqual({ kind: 'close' });
  });

  it('the screen wires it: the accessory, a focus request per cell tap, Done closes the editor', () => {
    expect(screen).toContain('<NumberAccessory onNext={onKeypadNext} onDone={closeCellEditors} />');
    expect(flat(screen)).toContain('const keypadAction = keypadNextAction({');
    expect(flat(screen)).toContain("else editCell({ kind: 'tap', setId: a.setId, field: a.field, row: 'done' });");
    expect(flat(screen)).toContain('setCorrection((c) => mergeCorrection(c, correctionView.values, patch));');
    expect(flat(screen)).toContain('const t = openCellTap(editingCell, field);');
    expect(flat(screen)).toContain('} else setFocusRequest({ field: t.field });');
    // Focus's tiles report their field too, so Next › works there as well.
    expect(screen.match(/setKeypadField\(\{ row: 'open', field: '(load|time|distance|reps)' \}\);/g)?.length).toBeGreaterThanOrEqual(4);
    // The keypad going down forgets the field.
    expect(flat(screen)).toContain('setKeyboardHeight(0); setKeypadField(null);');
  });

  it('an editor opened while the keypad is up focuses on mount, so the keypad never drops between fields', () => {
    expect(ui).toContain('autoFocus={autoFocus}');
    // Ben, 20 Oct: the open row's in-place cells share these props (the keypad stays up between them).
    expect(table).toContain("const common = { variant: 'cell' as const, autoFocus: p.keypadOpen, onFocus: tileFocus(id)");
    for (const f of ['loadRef', 'repsRef']) expect(table).toContain(`{...common} inputRef={p.${f}}`);
    // A done row's correction opens focused, and reports its field.
    const corr = table.slice(table.indexOf('export function CorrectionEditor'), table.indexOf('function NoteLink('));
    expect(corr).toContain("const cellProps = { variant: 'cell' as const, autoFocus: true");
    expect(corr).toContain("{...cellProps} onFocus={focusOf('load')}");
    expect(corr).toContain("{...cellProps} onFocus={focusOf('reps')}");
  });
});

describe('inline − value + (1.1, 1.2)', () => {
  it('one line ≤ 60 pt: the 52 pt − / + set its height, no vertical padding, label only for VoiceOver', () => {
    const inline = ui.slice(ui.indexOf('if (inline) {'), ui.indexOf('if (flat) {'));
    expect(inline).toContain('minHeight: stepSize ?? theme.target.workout.height');
    expect(inline).toContain('paddingVertical: 0');
    expect(inline).toContain('borderWidth: focused || warning ? 1.5 : 0');
    expect(inline).not.toContain('sectionLabel');
    // The max reason still shows.
    expect(inline).toContain('{up.reason}');
    // The editor's own padding: 4 pt above and below (52 + 8 = 60).
    expect(table).toContain("gap: theme.space['2'], paddingTop: theme.space['1'], paddingBottom: theme.space['1'] }}");
  });
  it('the numeral fits its measured width (no fixed 32 / 40)', () => {
    expect(table).not.toContain('const numeral = p.ax ? 40 : 32;');
    expect(table).not.toContain('numeralSize={numeral}');
  });
  it('the open row and a done row’s correction type in the cell itself (Ben, 20 Oct)', () => {
    const open = table.slice(table.indexOf('export function OpenSetRow'), table.indexOf('function InlineEditor('));
    const corr = table.slice(table.indexOf('export function CorrectionEditor'), table.indexOf('function NoteLink('));
    for (const part of [open, corr]) {
      expect(part).toContain("variant: 'cell' as const");
      expect(part).not.toContain('key="load" variant="inline"');
      expect(part).not.toContain('key="reps" variant="inline"');
    }
  });
});

describe('the cardio pair (1.3)', () => {
  const distance = { value: 5000, down: { enabled: true, value: 4900 }, up: { enabled: true, value: 5100 } };
  for (const width of [375, 430]) {
    it(`at ${String(width)} pt 20:34 and 5000 are never clipped and no − / + overlaps a neighbour`, () => {
      const tiles = cardioPairTiles({ timeText: '20:34', distance });
      expect(tiles[0]?.texts).toContain('20:34');
      for (const flatTheme of [true, false]) {
        const fit = tileFit({ rowWidth: openRowWidth(width), tiles, stepSize: 52, fontScale: 1, ax: false, gap: 8 });
        const layout = tileRowLayout(fit, flatTheme);
        // Side by side only when the numerals fit beside the − / +; otherwise compact (D) or stacked.
        if (!layout.compact && !layout.stacked) expect(fit.numeralSize).toBeGreaterThanOrEqual(28);
        if (!flatTheme) expect(layout.compact).toBe(false);
        expect(fit.numeralSize).toBeGreaterThanOrEqual(28);
      }
    });
  }
  it('stays together in one tile row, with Done on its own row', () => {
    const open = table.slice(table.indexOf('export function OpenSetRow'), table.indexOf('function InlineEditor('));
    expect(open).toContain('<StepperTileRow tiles={cardioPairTiles(');
    expect(open).toContain('stack={stackDone}');
    expect(table).toContain('const column = ax || stack;');
  });
});

describe('the open row reads as a table row (1.5, 1.6)', () => {
  const open = table.slice(table.indexOf('export function OpenSetRow'), table.indexOf('function InlineEditor('));
  it('v3: no target line under the open row; target, rest and the reason are under the exercise’s Why? (workout-table-v3 §2)', () => {
    expect(open).not.toContain("link('⋯'");
    expect(open).not.toContain('TargetWhyLink');
    expect(open).not.toContain('onRestAfter');
    expect(table).toContain('accessibilityLabel="Why this target"');
    // Links that remain (cardio Stop / Resume, a timed set's Log) reach 44 pt by hitSlop, not by height.
    expect(open).toContain('hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}');
    expect(open).not.toContain('minHeight: 44, justifyContent');
  });
  it('Plan was … keeps its own line under the open row, and an estimated target says est. (rules 3 and 6)', () => {
    expect(open).toContain('{f.planWas !== null ? (');
    expect(open).toContain('{f.targetEstimate ? (');
  });
  it('the plates show only while the load is edited, under its editor', () => {
    expect(open).toContain("const plates = f.plateLine !== null && p.editing === 'load' ?");
    expect(flat(open)).toContain('</InlineEditor> </View> ) : null} {plates}');
  });
  it('the open row reads its round label (`1`, `W`, `2L`; v3 numbers working sets) and VoiceOver its full row', () => {
    expect(table).toContain('createContext<{ row: RoundRow; loadHeader: string | null } | null>');
    expect(open).toContain('<NumberCell row={ctx.row} current todayChange={f.adjustedBy} />');
    expect(open).toContain('ctx?.row.accessibilityLabel');
  });
});

describe('keypad-open chrome, header and sheets (1.7–1.10)', () => {
  it('both action bars drop the home-indicator room on the keypad; the toast hides then', () => {
    expect(screen.match(/keypadOpen=\{keypadOpen\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(screen).toContain('{toast && !keypadOpen ? <Toast');
  });
  it('the rest bar collapses to a slim one-line strip while the keypad is open (Ben, 20 Oct)', () => {
    expect(flat(screen)).toContain('<RestBar rest={rest} slim={keypadOpen}');
    expect(table).toContain('export const SLIM_REST_HEIGHT = 32;');
    const slim = flat(table.slice(table.indexOf('if (slim) {'), table.indexOf('const pill = (')));
    expect(slim).toContain('`Rest ${formatDuration(remainingS)}`');
    expect(slim).toContain('minHeight: SLIM_REST_HEIGHT');
    // No −30 / +30 / Skip pills in the strip; the drain keeps running.
    expect(slim).not.toMatch(/onAdjust|onSkip|Pressable/);
    expect(slim).toContain("rest.kind === 'running'");
  });
  it('a long gym name gives way to the workout name', () => {
    const chip = read('screens', 'workout', 'GymSwitch.tsx');
    expect(chip).toContain('flexShrink: 1,\n        minWidth: 0,\n        maxWidth: 120,');
    expect(screen).toContain('style={{ flex: 1, minWidth: 64 }}');
    expect(screen).not.toContain('`Paused · ${formatElapsed(view.elapsedMs)}`');
  });
  it('Adjust is always the one word; the coach state is an icon and the open row’s line', () => {
    const avail = (status: 'ok' | 'offline' | 'not_connected' | 'unavailable') => ({ status }) as Parameters<typeof adjustControlView>[0];
    expect(adjustControlView(avail('ok'))).toMatchObject({ icon: null, accessibilityLabel: 'Adjust', line: null });
    expect(adjustControlView(avail('offline'))).toMatchObject({ icon: 'wifi.slash', accessibilityLabel: 'Adjust, coach offline', line: 'Offline' });
    expect(adjustControlView(avail('not_connected'))).toMatchObject({ icon: 'bolt.slash', accessibilityLabel: 'Adjust, coach not connected', line: 'Not connected' });
    const coach = read('screens', 'workout', 'WorkoutCoach.tsx');
    expect(coach).toContain('<TextButton label="Adjust" tone="secondary"');
    expect(coach).not.toContain('`Adjust · ${view.caption}`');
  });
  it('Rest after: the numeral on its own line, shrinking rather than clipping', () => {
    const sheet = screen.slice(screen.indexOf('function RestAfterSheet('), screen.indexOf('function StartTimeSheet('));
    expect(sheet).toContain('numberOfLines={1} adjustsFontSizeToFit');
    expect(sheet).toContain('<SecondaryButton grow label="−15 s"');
  });
});
