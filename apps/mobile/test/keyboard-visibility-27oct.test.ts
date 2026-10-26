import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { keyboardAnimationMs, keyboardInset, revealScrollY } from '../src/ui/keyboard-state';

/**
 * Keyboard visibility (Ben, build 403, 26 Oct): "Check across all texts that when type can see what typing", and
 * "why can't I search when I add exercise". The coach sheet's composer sat under the keyboard: in a native page
 * sheet Fabric measures a view from the sheet's top, so the measured `keyboardVerticalOffset` came out short by
 * the sheet's top inset. One shared frame now pads by the keyboard's own height. The layout itself needs a real
 * iPhone (docs/reviews/keyboard-visibility-27oct.md); the math is tested here and the wiring is checked in source.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : tsxFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

const ALL = tsxFiles(SRC).map((p) => ({ path: relative(SRC, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }));

/** A text field of any kind: the shared `TextField`, a raw `TextInput`, or the number tile / cell (`NumberStepper`). */
const INPUT = /<(TextField|TextInput|NumberStepper)\b/;
/**
 * The shared keyboard-aware frames: `SheetKeyboardAvoidingView` (sheets, full screens, the workout), `Screen` and
 * its `StepFrame` (a footer rides on the keyboard, the focused field scrolls into view), `BottomCard` (bottom
 * sheets), or a scroll with native `automaticallyAdjustKeyboardInsets` where nothing is pinned under it.
 */
const FRAME = /<SheetKeyboardAvoidingView\b|<Screen[\s>]|<StepFrame\b|<BottomCard\b|\bautomaticallyAdjustKeyboardInsets\b/;

/** Files with a field but no frame of their own: who frames them. Each host must have a frame. */
const FRAMED_BY: Record<string, { why: string; hosts: string[] }> = {
  'ui/layout.tsx': { why: 'defines TextField; Screen in the same file is the frame', hosts: [] },
  'ui/workout.tsx': { why: 'defines NumberStepper', hosts: [] },
  'ui/coach-ask-bar.tsx': { why: 'the inline field (Set up, no coach) shows only where onSubmit is passed', hosts: ['screens/builder/BuilderSetupScreen.tsx'] },
  'screens/progress/ExercisesTab.tsx': { why: 'Lifts search and Other, inside Progress and Exercise detail', hosts: ['screens/progress/ProgressScreen.tsx', 'screens/progress/ExerciseDetailScreen.tsx'] },
  'screens/workout/WorkoutTable.tsx': { why: 'table cells, inside the workout', hosts: ['screens/workout/WorkoutScreen.tsx'] },
};

describe('keyboard inset math', () => {
  it('pads a sheet or full screen by the keyboard’s full height (accessory bar included)', () => {
    expect(keyboardInset({ keyboardHeight: 336 })).toBe(336);
    // 375 pt (iPhone SE / mini class) and 430 pt (Pro Max) keyboards with the 44 pt Done bar.
    expect(keyboardInset({ keyboardHeight: 260 + 44 })).toBe(304);
    expect(keyboardInset({ keyboardHeight: 346 + 44 })).toBe(390);
    expect(keyboardInset({ keyboardHeight: 0 })).toBe(0);
  });
  it('a tab screen sits on the tab bar, which the keyboard covers', () => {
    expect(keyboardInset({ keyboardHeight: 380, bottomGap: 83 })).toBe(297);
    expect(keyboardInset({ keyboardHeight: 50, bottomGap: 83 })).toBe(0);
    expect(keyboardInset({ keyboardHeight: 300, bottomGap: -10 })).toBe(300);
  });
  it('rounds up (a point too high, never under) and ignores junk', () => {
    expect(keyboardInset({ keyboardHeight: 335.2 })).toBe(336);
    expect(keyboardInset({ keyboardHeight: Number.NaN })).toBe(0);
    expect(keyboardInset({ keyboardHeight: 300, bottomGap: Number.NaN })).toBe(300);
  });
  it('the build-403 case: the sheet’s top inset no longer matters', () => {
    // The old offset came from where Fabric thought the view sat (the sheet's top, ~0) instead of the screen's
    // (~60 pt down), so the padding was the keyboard's height less ~60: the composer (~68 pt) sat under it.
    const keyboard = 336;
    const oldPadding = keyboard - 60;
    expect(keyboardInset({ keyboardHeight: keyboard }) - oldPadding).toBe(60);
  });
  it('animates with the keyboard’s own duration', () => {
    expect(keyboardAnimationMs(250)).toBe(250);
    expect(keyboardAnimationMs(3)).toBe(10);
    expect(keyboardAnimationMs(0)).toBeNull();
    expect(keyboardAnimationMs(undefined)).toBeNull();
    expect(keyboardAnimationMs(Number.NaN)).toBeNull();
  });
});

describe('the focused field scrolls into view', () => {
  it('scrolls down just enough for a field below the viewport, with a margin', () => {
    expect(revealScrollY({ fieldY: 600, fieldHeight: 52, viewportHeight: 400, scrollY: 0 })).toBe(268);
    expect(revealScrollY({ fieldY: 600, fieldHeight: 52, viewportHeight: 400, scrollY: 0, margin: 0 })).toBe(252);
  });
  it('scrolls up for a field above it', () => {
    expect(revealScrollY({ fieldY: 100, fieldHeight: 52, viewportHeight: 400, scrollY: 300 })).toBe(84);
    expect(revealScrollY({ fieldY: 5, fieldHeight: 52, viewportHeight: 400, scrollY: 300 })).toBe(0);
  });
  it('leaves a visible field alone', () => {
    expect(revealScrollY({ fieldY: 100, fieldHeight: 52, viewportHeight: 400, scrollY: 0 })).toBeNull();
  });
  it('a field taller than the viewport shows from its top', () => {
    expect(revealScrollY({ fieldY: 500, fieldHeight: 600, viewportHeight: 300, scrollY: 0 })).toBe(484);
  });
  it('does nothing before the viewport is measured', () => {
    expect(revealScrollY({ fieldY: 600, fieldHeight: 52, viewportHeight: 0, scrollY: 0 })).toBeNull();
    expect(revealScrollY({ fieldY: Number.NaN, fieldHeight: 52, viewportHeight: 300, scrollY: 0 })).toBeNull();
  });
});

describe('every text field is in a keyboard-aware frame', () => {
  const withInputs = ALL.filter((f) => INPUT.test(f.src));
  it('finds the inputs (the audit list in docs/reviews/keyboard-visibility-27oct.md)', () => {
    expect(withInputs.length).toBeGreaterThanOrEqual(25);
  });
  for (const f of withInputs) {
    it(f.path, () => {
      const allowed = FRAMED_BY[f.path];
      if (allowed === undefined) {
        expect(FRAME.test(f.src), `${f.path} has a text field but no shared keyboard-aware frame`).toBe(true);
        return;
      }
      for (const h of allowed.hosts) expect(FRAME.test(read(h)), `${h} hosts ${f.path} (${allowed.why})`).toBe(true);
    });
  }
  it('the coach bar’s inline field is only used where a frame hosts it', () => {
    for (const f of ALL.filter((x) => /<CoachAskBar\b[^>]*?onSubmit=/s.test(x.src.replace(/\n/g, ' ')))) {
      expect(FRAMED_BY['ui/coach-ask-bar.tsx']?.hosts, f.path).toContain(f.path);
    }
  });
  it('no screen uses RN’s KeyboardAvoidingView or a window-measured offset any more', () => {
    for (const f of ALL) {
      expect(f.src, f.path).not.toMatch(/<KeyboardAvoidingView\b/);
      expect(f.src, f.path).not.toContain('keyboardVerticalOffset');
    }
    const k = read('ui', 'keyboard.tsx');
    expect(k).not.toContain('measureInWindow');
    expect(k).toContain('const inset = useKeyboardInset(bottomGap);');
    expect(k).toContain("paddingBottom: inset");
  });
  it('a scroll under a pinned footer reveals the focused field (no double inset)', () => {
    const layout = read('ui', 'layout.tsx');
    const screen = layout.slice(layout.indexOf('export function Screen('), layout.indexOf('export function BottomBar('));
    expect(screen).toContain('<KeyboardScrollView');
    expect(screen).toContain('automaticallyAdjustKeyboardInsets={!footer}');
    expect(screen).toContain('bottomGap: tabBarGap');
    expect(read('ui', 'sheet.tsx')).toContain('<KeyboardScrollView style={{ flexShrink: 1 }}');
    expect(read('ui', 'sheet.tsx')).toContain('<SheetKeyboardAvoidingView');
    for (const f of [['screens', 'workout', 'EditSetScreen.tsx'], ['screens', 'workout', 'PlannedSetEdit.tsx'], ['screens', 'library', 'ExerciseFormScreen.tsx']]) {
      const s = read(...f);
      expect(s, f.join('/')).toContain('<KeyboardScrollView');
      expect(s, f.join('/')).not.toMatch(/<ScrollView\s/);
    }
  });
  it('the workout uses the shared frame', () => {
    const w = read('screens', 'workout', 'WorkoutScreen.tsx');
    expect(w).toContain("<SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>");
  });
});

describe('the coach sheets: the composer sits on the keyboard, the latest message stays in view', () => {
  for (const f of [['screens', 'coach', 'CoachSheetScreen.tsx'], ['screens', 'coach', 'BuilderCoachSheet.tsx']]) {
    const s = read(...f);
    const name = f.join('/');
    it(name, () => {
      const frame = s.lastIndexOf('<SheetKeyboardAvoidingView');
      const end = s.lastIndexOf('</SheetKeyboardAvoidingView>');
      const list = s.indexOf('<ScrollView', frame);
      const composer = s.indexOf('accessibilityLabel="Message to the coach"', frame);
      // The transcript, then the composer, both inside the one frame: the list shrinks and the composer rides up.
      expect(frame).toBeGreaterThan(-1);
      expect(list).toBeGreaterThan(frame);
      expect(composer).toBeGreaterThan(list);
      expect(end).toBeGreaterThan(composer);
      // The frame alone lifts it: no native inset on the transcript as well (it would count twice).
      expect(s.slice(frame, end)).not.toContain('automaticallyAdjustKeyboardInsets');
    });
  }
  it('the builder sheet keeps its last turn in view when the keyboard shrinks the list', () => {
    expect(read('screens', 'coach', 'BuilderCoachSheet.tsx')).toContain('onLayout={() => scroll.current?.scrollToEnd({ animated: false })}');
  });
  it('the coach sheet follows the end on a resize while Ben is there', () => {
    const s = read('screens', 'coach', 'CoachSheetScreen.tsx').replace(/\s+/g, ' ');
    expect(s).toContain('onLayout={(e) => { transcript.current.viewportHeight = e.nativeEvent.layout.height; follow(); }}');
  });
});

describe('every Add exercise opens the one shared picker with search at the top', () => {
  it('the picker’s search is pinned in the header, above the list, and nowhere else in the sheet', () => {
    const s = read('ui', 'swap-sheet.tsx');
    const header = s.slice(s.indexOf('header={'), s.indexOf('footer={<TextButton'));
    expect(header).toContain('accessibilityLabel={PICKER_COPY.search}');
    expect(header).toContain('onChangeText={picker.onQuery}');
    expect(s.match(/<TextField\b/g)?.length).toBe(1);
    const sheet = read('ui', 'sheet.tsx');
    // The header renders before the scrolling content.
    expect(sheet.indexOf('{header}')).toBeGreaterThan(-1);
    expect(sheet.indexOf('{header}')).toBeLessThan(sheet.indexOf('<KeyboardScrollView'));
  });
  const HOSTS: [string, RegExp][] = [
    ['screens/builder/EditWorkoutScreen.tsx', /onAdd=\{\(\) => void openSwap\(null\)\}/],
    ['screens/builder/BuilderWorkoutScreen.tsx', /onAdd=\{\(\) => void openSwap\(null\)\}/],
    ['screens/workout/WorkoutEdits.tsx', /const openAdd = \(\) => openSheet\(\{ mode: 'add' \}/],
  ];
  for (const [path, entry] of HOSTS) {
    it(path, () => {
      const s = read(...path.split('/'));
      expect(s).toMatch(entry);
      expect(s).toContain('<SwapSheet');
      expect(s.replace(/\s+/g, ' ')).toMatch(/<SwapSheet[^]*?picker=\{\{ view: pickerView, query: picker\.query, onQuery: picker\.setQuery/);
    });
  }
  it('the workout’s every Add exercise (bar, Next row, round sheet, table, coach) goes to WorkoutEdits’ picker', () => {
    const w = read('screens', 'workout', 'WorkoutScreen.tsx');
    const adds = [...w.matchAll(/'Add exercise'|"Add exercise"|onAddExercise=/g)].length;
    expect(adds).toBeGreaterThanOrEqual(4);
    // Every add in the workout calls the one openAdd; nothing else opens a list of exercises.
    expect([...w.matchAll(/workoutEdits\.openAdd\(\)/g)].length).toBeGreaterThanOrEqual(adds);
    expect(read('screens', 'workout', 'RoundSheets.tsx')).toContain('onPress={p.onAddExercise}');
  });
  it('no other add-exercise list without search: every SwapSheet host is listed', () => {
    const hosts = ALL.filter((f) => f.src.includes('<SwapSheet')).map((f) => f.path).sort();
    expect(hosts).toEqual(HOSTS.map(([p]) => p).sort());
  });
});
