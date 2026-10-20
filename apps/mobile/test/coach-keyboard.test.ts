import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COACH_DONE_ACCESSORY_ID, COACH_TRANSCRIPT_KEYBOARD } from '../src/coach/sheet-view';

/**
 * Build 131: "the keyboard gets stuck on GPT chat, I can't hide it". The coach
 * sheet's field is multiline (Return adds a line), so the keyboard must hide
 * by dragging the conversation down, by a tap outside the field, by a visible
 * `Done` above the keyboard, and on Send, with the newest reply kept in view
 * inside the KeyboardAvoidingView. Source checks (no renderer in this lane);
 * the feel needs a real iPhone (the simulator keyboard differs).
 */

const SRC = join(__dirname, '..', 'src');
const screen = readFileSync(join(SRC, 'screens', 'coach', 'CoachSheetScreen.tsx'), 'utf8');
const ui = readFileSync(join(SRC, 'ui', 'workout.tsx'), 'utf8');

/** The JSX of the conversation's ScrollView (the one with the ref), up to its first child. */
const transcript = screen.slice(screen.indexOf('<ScrollView\n        ref={scroll}'), screen.indexOf('<Pressable accessible={false}'));

describe('coach sheet keyboard (build 131)', () => {
  it('dragging the conversation hides the keyboard (interactive); buttons in it still work on the first tap', () => {
    expect(COACH_TRANSCRIPT_KEYBOARD).toEqual({ keyboardDismissMode: 'interactive', keyboardShouldPersistTaps: 'handled' });
    expect(transcript).toContain('{...COACH_TRANSCRIPT_KEYBOARD}');
    // Nothing after the spread puts the old behaviour back.
    expect(transcript).not.toMatch(/keyboardDismissMode="none"|keyboardShouldPersistTaps="always"/);
  });

  it('a tap on the conversation outside a button hides the keyboard', () => {
    expect(screen).toMatch(/<Pressable accessible=\{false\} onPress=\{\(\) => \{ Keyboard\.dismiss\(\); \}\}/);
  });

  it('a visible Done above the keyboard hides it (the field is multiline, so Return adds a line)', () => {
    expect(screen).toMatch(/<TextField ref=\{field\}[^>]*multiline[^>]*inputAccessoryViewID=\{COACH_DONE_ACCESSORY_ID\}/);
    expect(screen).toContain('<KeyboardDoneAccessory nativeID={COACH_DONE_ACCESSORY_ID} />');
    expect(COACH_DONE_ACCESSORY_ID).not.toBe('fizz-number-done');
    const done = ui.slice(ui.indexOf('export function KeyboardDoneAccessory'));
    expect(done).toContain('accessibilityLabel={action.accessibilityLabel}');
    expect(done).toContain('Keyboard.dismiss()');
  });

  it('Send (and Build) hide the keyboard; the newest reply stays in view when the transcript resizes', () => {
    const send = screen.slice(screen.indexOf('async function send('), screen.indexOf('async function build('));
    expect(send).toContain('Keyboard.dismiss();');
    const build = screen.slice(screen.indexOf('async function build('), screen.indexOf('function openDraft('));
    expect(build).toContain('Keyboard.dismiss();');
    // Design pass 4.1: only while Ben is at the end (or something new was added): `follow` → stickToEnd.
    expect(transcript).toContain('onContentSizeChange={follow}');
    expect(transcript).toContain('onLayout={follow}');
    expect(screen).toContain('followState.thread(threadId);');
    expect(screen).toContain('if (followState.follow(contentCount, starters)) scroll.current?.scrollToEnd({ animated: false });');
    // Offset by where the page sheet starts in the window (design pass 0.4).
    expect(screen).toContain('<SheetKeyboardAvoidingView');
  });
});
