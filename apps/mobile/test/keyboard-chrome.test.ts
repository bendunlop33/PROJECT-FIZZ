import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { accessoryAction, bottomBarPadding, KEYBOARD_CLOSED, toastBottom, watchKeyboard, windowKeyboardOffset, type KeyboardEmitter, type KeyboardEventName } from '../src/ui/keyboard-state';

/**
 * Design pass batch 0 (Ben approved 20 Oct): shared keyboard and bottom
 * chrome. The keyboard hooks run on a fake `Keyboard`; the layout itself
 * needs a real iPhone (Ben's checklist), so the wiring is checked in source.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

function fakeKeyboard() {
  const listeners = new Map<KeyboardEventName, ((e: { endCoordinates?: { height: number } } | undefined) => void)[]>();
  const removed: KeyboardEventName[] = [];
  const k: KeyboardEmitter = {
    addListener: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return {
        remove: () => {
          removed.push(event);
          listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
        },
      };
    },
  };
  const emit = (event: KeyboardEventName, height?: number) => {
    for (const l of listeners.get(event) ?? []) l(height === undefined ? undefined : { endCoordinates: { height } });
  };
  return { k, emit, removed, count: () => [...listeners.values()].reduce((n, l) => n + l.length, 0) };
}

describe('keyboard hooks (0.1)', () => {
  it('follow keyboardWillShow / keyboardWillHide with the height', () => {
    const f = fakeKeyboard();
    const onChange = vi.fn();
    const stop = watchKeyboard(f.k, onChange);
    f.emit('keyboardWillShow', 336);
    expect(onChange).toHaveBeenLastCalledWith({ visible: true, height: 336 });
    f.emit('keyboardWillHide');
    expect(onChange).toHaveBeenLastCalledWith(KEYBOARD_CLOSED);
    // A show without coordinates still says it's up.
    f.emit('keyboardWillShow');
    expect(onChange).toHaveBeenLastCalledWith({ visible: true, height: 0 });
    stop();
    expect(f.count()).toBe(0);
    expect(f.removed.sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);
    f.emit('keyboardWillShow', 300);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('the hooks use it on the real Keyboard', () => {
    const k = read('ui', 'keyboard.tsx');
    expect(k).toContain('useEffect(() => watchKeyboard(Keyboard, setState), [])');
    expect(k).toContain('export function useKeyboardVisible()');
    expect(k).toContain('export function useKeyboardHeight()');
  });
});

describe('bottom bars on the keyboard (0.2)', () => {
  it('drop the home-indicator room while the keypad is open', () => {
    expect(bottomBarPadding({ keypadOpen: false, insetBottom: 34, space2: 8, space3: 12 })).toBe(46);
    expect(bottomBarPadding({ keypadOpen: true, insetBottom: 34, space2: 8, space3: 12 })).toBe(8);
    expect(bottomBarPadding({ keypadOpen: false, insetBottom: 0, space2: 8, space3: 12, minInset: 16 })).toBe(28);
  });
  it('ActionBar takes keypadOpen; BottomBar and BottomCard follow the keyboard themselves', () => {
    expect(read('ui', 'workout.tsx')).toContain('paddingBottom: bottomBarPadding({ keypadOpen,');
    expect(read('ui', 'layout.tsx')).toContain('paddingBottom: bottomBarPadding({ keypadOpen: keyboard,');
    expect(read('ui', 'sheet.tsx')).toContain("paddingBottom: theme.space['4'] + (keyboard ? 0 : insets.bottom)");
  });
});

describe('Screen and sheets avoid the keyboard (0.3–0.5)', () => {
  const layout = read('ui', 'layout.tsx');
  it('Screen: a footer rides on the keyboard, taps work first time, a drag closes it, floating hides', () => {
    expect(layout).toContain('const Frame = footer ? SheetKeyboardAvoidingView : View;');
    expect(layout).toContain('keyboardShouldPersistTaps="handled"');
    expect(layout).toContain('keyboardDismissMode="interactive"');
    // No double inset: the scroll insets itself only when the frame doesn't move.
    expect(layout).toContain('automaticallyAdjustKeyboardInsets={!footer}');
    expect(layout).toContain('const showFloating = floating !== undefined && floating !== null && !keyboard;');
  });
  it('a sheet’s KeyboardAvoidingView is offset by where it starts in the window', () => {
    expect(windowKeyboardOffset(54.4)).toBe(54);
    expect(windowKeyboardOffset(-3)).toBe(0);
    expect(windowKeyboardOffset(undefined)).toBe(0);
    expect(windowKeyboardOffset(Number.NaN)).toBe(0);
    expect(read('ui', 'keyboard.tsx')).toContain('keyboardVerticalOffset={offset}');
    for (const f of [['screens', 'coach', 'CoachSheetScreen.tsx'], ['screens', 'library', 'ExerciseFormScreen.tsx'], ['screens', 'routines', 'WorkoutEditorScreen.tsx'], ['screens', 'workout', 'ExercisePickerScreen.tsx'], ['screens', 'workout', 'EditSetScreen.tsx'], ['screens', 'workout', 'PlannedSetEdit.tsx']]) {
      const s = read(...f);
      expect(s, f.join('/')).toContain('<SheetKeyboardAvoidingView');
      expect(s, f.join('/')).not.toContain('<KeyboardAvoidingView behavior="padding"');
    }
  });
  it('BottomCard scrolls its content and pins a footer', () => {
    const sheet = read('ui', 'sheet.tsx');
    expect(sheet).toContain('<ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled"');
    expect(sheet).toContain('{footer !== undefined && footer !== null ?');
    // The split day sheet's Save, Remove and Cancel stay visible with the keyboard up.
    expect(read('screens', 'profile', 'SplitScreen.tsx').replace(/\s+/g, ' ')).toMatch(/footer=\{ sheet\?\.kind === 'lift'.*<PrimaryButton label=\{C\.save\}/);
  });
});

describe('toasts float (0.6)', () => {
  it('sit on the measured footer, else clear of the home indicator, or on the tab bar', () => {
    expect(toastBottom({ footerHeight: 92, insetBottom: 34, space2: 8 })).toBe(92);
    expect(toastBottom({ footerHeight: null, insetBottom: 34, space2: 8 })).toBe(42);
    expect(toastBottom({ footerHeight: 0, insetBottom: 34, space2: 8 })).toBe(42);
    expect(toastBottom({ footerHeight: null, insetBottom: 34, space2: 8, tab: true })).toBe(0);
  });
  it('ToastHost is absolutely placed and the screens use it', () => {
    expect(read('ui', 'workout.tsx')).toContain("style={{ position: 'absolute', left: 0, right: 0, bottom }}");
    expect(read('ui', 'layout.tsx')).toContain('<ToastHost bottom={toastBottom({ footerHeight: footer ? footerHeight : null');
    for (const f of [['screens', 'workout', 'WorkoutScreen.tsx'], ['screens', 'workout', 'WorkoutOverviewScreen.tsx'], ['screens', 'repeat', 'PastWorkoutsScreen.tsx'], ['screens', 'routines', 'WorkoutsScreen.tsx']]) {
      expect(read(...f), f.join('/')).toContain('<ToastHost bottom=');
    }
    expect(read('screens', 'gym', 'EquipmentEditorScreen.tsx')).toContain('toast={toast ?');
  });
});

describe('the number accessory (0.7)', () => {
  it('shows Next › when there is a next field, else Done', () => {
    expect(accessoryAction(() => undefined)).toEqual({ label: 'Next ›', accessibilityLabel: 'Next field' });
    expect(accessoryAction(null)).toEqual({ label: 'Done', accessibilityLabel: 'Done' });
    expect(accessoryAction(undefined)).toEqual({ label: 'Done', accessibilityLabel: 'Done' });
  });
  it('Next keeps the keypad up; Done closes it, then runs onDone', () => {
    const ui = read('ui', 'workout.tsx');
    const acc = ui.slice(ui.indexOf('export function KeyboardDoneAccessory'), ui.indexOf('/** D tile'));
    expect(acc.replace(/\s+/g, ' ')).toContain('if (onNext) { // Moves to the next field; the keypad stays up. onNext(); return; }');
    expect(acc.replace(/\s+/g, ' ')).toContain('Keyboard.dismiss(); onDone?.();');
  });
  it('the note sheet has its own Done and asks before dropping a changed note', () => {
    const note = read('screens', 'workout', 'NoteSheet.tsx');
    expect(note).toContain('inputAccessoryViewID={NOTE_DONE_ACCESSORY_ID}');
    expect(note).toContain("Alert.alert('Discard note?'");
  });
});
