import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clampRepRange, repRangeInput, repRangeOnBlur, repRangeWhileTyping } from '../src/workout/set-shape-view';

/**
 * Design pass batch 5 (Ben approved 20 Oct): Today rows, the workout editor
 * and its set sheet. The Fixed-load seed is tested in the domain
 * (routine-editor.test.ts); the rest are source checks, with how they sit
 * on the keypad on Ben's device checklist.
 */

const SRC = join(__dirname, '..', 'src');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const editor = flat(readFileSync(join(SRC, 'screens', 'routines', 'WorkoutEditorScreen.tsx'), 'utf8'));
const today = flat(readFileSync(join(SRC, 'screens', 'TodayScreen.tsx'), 'utf8'));
const rowText = flat(readFileSync(join(SRC, 'ui', 'row-text.tsx'), 'utf8'));

describe('5.2 reps From ≤ To by clamping, not an error sentence', () => {
  it('the end moved pushes the other; 1–100', () => {
    expect(clampRepRange({ min: 12, max: 10 }, 'min')).toEqual({ min: 12, max: 12 });
    expect(clampRepRange({ min: 8, max: 6 }, 'max')).toEqual({ min: 6, max: 6 });
    expect(clampRepRange({ min: 0, max: 150 }, 'min')).toEqual({ min: 1, max: 100 });
    expect(clampRepRange({ min: null, max: 10 }, 'min')).toEqual({ min: 1, max: 10 });
  });

  // Review B2: NumberStepper sends every keystroke, so clamping each one rewrote From.
  const field = (start: { min: number; max: number }, exact = false) => {
    let saved = start;
    const writes: { min: number; max: number }[] = [];
    const input = repRangeInput({ get: () => saved, exact: () => exact, set: (r) => { saved = r; writes.push(r); } });
    return { input, saved: () => saved, writes };
  };

  it('typing 1, 12 into To on 8–10 saves 8–12 and never touches From', () => {
    const f = field({ min: 8, max: 10 });
    f.input.type('max', 1);
    expect(f.saved()).toEqual({ min: 8, max: 10 });
    f.input.type('max', 12);
    expect(f.saved()).toEqual({ min: 8, max: 12 });
    f.input.settle();
    expect(f.saved()).toEqual({ min: 8, max: 12 });
    expect(f.writes.every((w) => w.min === 8)).toBe(true);
  });

  it('clearing To keeps the saved range; blur restores it', () => {
    const f = field({ min: 8, max: 10 });
    f.input.type('max', null);
    f.input.settle();
    expect(f.saved()).toEqual({ min: 8, max: 10 });
    expect(f.writes).toEqual([]);
  });

  it('a To left below From clamps only on blur', () => {
    const f = field({ min: 8, max: 10 });
    f.input.type('max', 5);
    expect(f.saved()).toEqual({ min: 8, max: 10 });
    f.input.settle();
    expect(f.saved()).toEqual({ min: 5, max: 5 });
  });

  it('From typed past To pushes To on blur; ± steps clamp at once', () => {
    const f = field({ min: 8, max: 10 });
    f.input.type('min', 1);
    f.input.type('min', 12);
    f.input.settle();
    expect(f.saved()).toEqual({ min: 12, max: 12 });
    const g = field({ min: 8, max: 8 });
    g.input.step('max', 7);
    expect(g.saved()).toEqual({ min: 7, max: 7 });
    // A step after typing drops the held draft: blur doesn't re-apply it.
    const h = field({ min: 8, max: 10 });
    h.input.type('max', 3);
    h.input.step('max', 11);
    h.input.settle();
    expect(h.saved()).toEqual({ min: 8, max: 11 });
  });

  it('exact reps follow the typed number; the pure parts', () => {
    const f = field({ min: 8, max: 8 }, true);
    f.input.type('min', 1);
    f.input.type('min', 12);
    f.input.settle();
    expect(f.saved()).toEqual({ min: 12, max: 12 });
    expect(repRangeWhileTyping({ min: 8, max: 10 }, 'max', 0, false)).toBeNull();
    expect(repRangeWhileTyping({ min: 8, max: 10 }, 'max', 101, false)).toBeNull();
    expect(repRangeWhileTyping({ min: 8, max: 10 }, 'min', 9, false)).toEqual({ min: 9, max: 10 });
    expect(repRangeOnBlur({ min: 8, max: 10 }, 'max', 150, false)).toEqual({ min: 8, max: 100 });
  });

  it('the sheet no longer shows the error sentence and reps steppers are compact', () => {
    expect(editor).not.toContain('Reps: the first number must be the smaller one.');
    expect(editor).toContain("compact {...focus} {...step(r.max, 1)}");
  });
});

describe('5.1, 5.2, 5.3 editor', () => {
  it('Auto → Fixed starts from the last logged load, snapped (fixedLoadSeed)', () => {
    expect(editor).toContain('fixedLoadSeed(info?.lastLoad ?? null, frame, item)');
  });

  it('a focused stepper scrolls into view after the keypad shows', () => {
    expect(editor).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(editor).toContain("<Reps value={t.targetReps} onFocus={reveal('reps')}");
    expect(editor).toContain("onFocus={reveal('load')}");
    expect(editor).toContain('style={{ flexGrow: 0, flexShrink: 1 }}');
  });

  it('exercise header: name on 2 lines + ⋯; Main and Add weight on a chip row under it', () => {
    const header = editor.slice(editor.indexOf('Design pass 5.3'));
    expect(header).toContain('numberOfLines={2}');
    expect(header.indexOf('accessibilityLabel={`More, ')).toBeLessThan(header.indexOf('<ChipRow>'));
    expect(header.indexOf('<ChipRow>')).toBeLessThan(header.indexOf('label={EDITOR_COPY.main}'));
  });

  it('nits: header Save, interactive dismiss, name autofocus only when empty, add-exercise search ready', () => {
    expect(editor).toContain('<TextButton label={EDITOR_COPY.save} disabled={primary.disabled || busy}');
    expect(editor).toContain("autoFocus={(isNew && name.trim() === '') || selectName === true}");
    expect(editor).toContain('autoFocus clearButtonMode="while-editing"');
    expect(editor).not.toContain('maxHeight: 420');
    expect(editor).toContain("paddingBottom: theme.space['3'] + (keyboardUp ? 0 : insets.bottom)");
  });
});

describe('5.4 Today rows stack at AX; the detail shrinks right-aligned below it', () => {
  it('RowText', () => {
    expect(rowText).toContain('fontScale >= AX_FONT_SCALE');
    expect(rowText).toContain("style={{ flexShrink: 1, textAlign: 'right' }}");
    // Today (v2), workout-builder-v3 §2.0.9: Recent and the routine rows are superseded (the strip and the day
    // control); the Resume detail rows keep RowText.
    expect(today.match(/<RowText /g)?.length).toBe(1);
    expect(today).not.toMatch(/<AppText variant="body" numberOfLines=\{1\} style=\{\{ flex: 1 \}\}>\s*\{row\.title\}/);
  });

  it('the stale card’s end time is a hero line; Finish is one word', () => {
    expect(today).toContain('`Ended about ${formatTime(toMs(main.endedAboutUtc), zoned.tz)}`');
    // Review S5: no second, near-identical time beside it.
    expect(today).toContain('main.lastSetAtUtc && !main.endedAboutUtc ? `Last set logged at');
    expect(today).not.toContain('Finish (ended about');
  });
});
