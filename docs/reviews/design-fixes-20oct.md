# Review: design pass, 20 Oct (`claude/design-fixes-20oct`)

**Verdict: CHANGES NEEDED**

Scope: `6a995e5..b2b0b56`, which is batches 0–6 plus nits (105 files). The audit file was deleted, so I checked each item against the plan text "GymSmarter: visual and input fix plan", a copy of which is in the session scratchpad, and against the developer summaries and commit messages.

## Checks run

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run`: pass, 392 files, 7574 tests passed, 1 todo.
- Nothing has run on an iPhone. All layout and keyboard claims below are from reading the code, not from a device.

## What holds up

- **Batch 0.**
  - The keyboard hooks are pure and tested.
  - `bottomBarPadding` drops the home-indicator room on the keypad.
  - The `SheetKeyboardAvoidingView` offset math is right for a page sheet. KAV overlap = (view's window bottom) − keyboard top, and that includes the Coach sheet's `paddingTop`.
  - `Screen` uses the KAV only with a footer, and `automaticallyAdjustKeyboardInsets` only without one.
  - `BottomCard` now scrolls its content, with a pinned `footer`. Every sheet that already had its own ScrollView opts out (`scroll={false}`).
  - `ToastHost` reports 0 height when it is empty.
- **Inline entry (batch 1).**
  - `NumberStepper` commits on every keystroke (`onChangeText → onChange`). So `Next ›` unmounting the load field never loses the typed weight.
  - A done-row correction keeps one draft (`correction.values`) across `Next ›`. Done or a tap elsewhere still sends one versioned `correctSet` with its opId (rule 2, rule 5).
  - `keypadNext`, `openCellTap` and `openRowLabel` are pure and tested.
  - The superset row reads `A2`, and VoiceOver hears the member tag.
- **No [Ben] item slipped in.**
  - The slim RestBar was not built.
  - Tap-outside-to-commit on the reps sheet was not built. The scrim only reads `Close` now.
  - `LibraryScreen` is untouched.
  - Exercise detail only has the approved 6.6 part, with no headerRight or dropdowns.
  - There is no theme or type-token change.
  - Birth year still uses the stepper.
  - Resume was not promoted on the stale card.
- **Fixed-load seed (5.1).**
  - It is pure domain code that snaps with `roundToAvailableLoad(…, 'easier')`, so it never goes past an item's max.
  - It handles a per-hand rack max, lb→kg, assisted, and a different convention falling back.
  - All of these are tested (rule 4).
- **Plan line (3.1/3.2).**
  - `plannedLoad` is only added when the load, not the reps, gave the verdict.
  - It is tested for kg, lb, per-hand, stack and assisted.
- **Honest status (rule 1).**
  - `Adjust` keeps an icon and a VoiceOver label for offline or not connected, and the open row shows the word.
  - The coach route line is still visible while the keyboard is up (rule 7).
  - The disabled build chip still says `Needs the coach`.
- **Other.**
  - The workout editor's two Save buttons share the `busy` guard and an opId, so a double tap stays idempotent.
  - No secrets were added. `VISUAL-AUDIT.local.md` was never committed.

## Blocking

### B1. The open row's one line cuts off `Plan was …` (rule 3) and, at large text, the target and `est.` (rule 6)
`apps/mobile/src/screens/workout/WorkoutTable.tsx:1044` and `:1133–1137`

`target`, `planWas` and `pace` are now joined into one `numberOfLines={1}` text. That text shrinks to whatever room the fixed-size `Rest 2:00 ›` and `Why?` links leave.

**Failure:**
- On a 375pt phone at default text size, the line has about 295pt after the 48pt indent and padding. The links and gaps take about 140pt, which leaves roughly 155pt for the text.
- After a coach "lighter" change, the text is `3–6 @ 8.5 · est. · Plan was 100 kg × 6–8`, about 40 characters or about 300pt. It renders as `3–6 @ 8.5 · est. · Plan w…`.
- The "Plan was" value is the visible before/after for a change the coach applied to today's sets. Rule 3 says applied changes must stay visible, and before this branch it had its own line.
- At AX1 (the audit's own test size) `Rest 2:00 ›` + `Why?` take about 245pt. The target, including `est.`, is reduced to a few characters. At AX3 the links alone are wider than the row, so the target disappears and `Why?` overflows. An estimate must stay labelled (rule 6).
- VoiceOver still gets everything (`leadA11y`), so this affects sighted users only.

**Fix:**
- Keep `planWas` on its own line under the sub-line, as before. It only appears after a change, so the normal row stays one line.
- Let the sub-line wrap when `p.ax` is true. Alternatively, put the links on a second line at AX.
- Never truncate `est.`. One way is to render the estimate marker as its own non-shrinking text.
- Add a test that `planWas` isn't inside the `numberOfLines={1}` text.

### B2. Typing into reps `To` silently rewrites `From`
`apps/mobile/src/screens/routines/WorkoutEditorScreen.tsx:912–913`, `apps/mobile/src/workout/set-shape-view.ts:118`

`clampRepRange` runs on every keystroke, because `NumberStepper` calls `onChange` from `onChangeText`. The field also has `selectTextOnFocus`.

**Failure:**
- The template has 8–10. Ben taps To and types `12`.
- The first keystroke `1` gives `{min: 8, max: 1}`, which clamps to `{min: 1, max: 1}`.
- The second keystroke gives `{min: 1, max: 12}`.
- The template is now 1–12 instead of 8–12. Backspacing To to empty does the same, because null clamps to 1, which pulls `From` down to 1.
- There is no warning, and the old "first number must be the smaller one" line was removed. If Ben saves without noticing, every future session targets 1–12 reps, and the built-in progression reads that range.

**Fix:**
- Don't push the other end while typing. Clamp only on blur or end-editing, and on ± steps. The domain function can stay as it is.
- Alternatively, keep the typed value in local state until blur.
- Add a test that types `1`, `12` into To on 8–10 and expects 8–12.

## Should fix

### S1. Double keyboard inset in Edit set and planned-set edit
`apps/mobile/src/screens/workout/EditSetScreen.tsx:212–214`, `apps/mobile/src/screens/workout/PlannedSetEdit.tsx:137–139`

Both screens wrap a ScrollView in `SheetKeyboardAvoidingView` (padding) and also set `automaticallyAdjustKeyboardInsets` on it.

RN's inset is computed from the ScrollView's frame when `keyboardWillChangeFrame` fires, which is before the KAV's padding shrinks the view. So the content gets roughly a keyboard-height of extra bottom inset on top of the shrink. The result is a large blank overscroll, and the note field can be scrolled up away from the keyboard.

`Screen` (`layout.tsx:40`) deliberately avoids exactly this, and audit item 0.3's AC says "No double inset". Item 2.1 asked for both, which is a spec conflict (see Spec issues).

**Fix:** drop `automaticallyAdjustKeyboardInsets` here, because the KAV already lifts the ActionBar. Then check on device that the note field scrolls into view.

### S2. The coach transcript can open an older conversation at its top
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:129–130, 621, 641–646`

`atBottom` and `shownCount` are component refs and are not reset when the thread changes.

**Failure:**
- Ben scrolls up in thread A (`atBottom = false`), opens Conversations, and picks thread B, which has fewer rows than A.
- `added` is false and `atBottom` is false, so `follow()` never scrolls to the end.
- Thread B shows its oldest messages and Ben has to scroll down.

**Fix:** when `threadId` changes (including New conversation), reset `atBottom.current = true` and `shownCount.current = 0`. Add a test of `stickToEnd` driven by thread-change state.

### S3. The new tests are mostly source-string checks
`apps/mobile/test/workout-inline-entry.test.ts`, `keyboard-chrome.test.ts`, `workout-sheets-fit.test.ts`, `*-design-pass.test.ts`

Most new assertions are `toContain('<exact JSX>')` on source text. They break on reformatting and don't exercise behaviour. They missed B1 and B2.

The input flows have no behavioural tests:
- typing in the reps steppers;
- `Next ›` on a done row keeping the load draft and sending one `correctSet`;
- the thread switch in S2.

**Fix:** pull the `onKeypadNext` decision and the correction-draft merge into pure helpers, as was done for `keypadNext`, and test them. Add the B2 typing test.

### S4. Where the toast sits inside a keyboard-avoiding `Screen` needs a device check
`apps/mobile/src/ui/layout.tsx:60`

`ToastHost` is absolutely positioned with `bottom = footerHeight`, inside the KAV whose bottom padding equals the keyboard height.

Under Yoga 3, absolute insets are measured from the padding box. A toast shown with the keyboard up, such as the equipment editor's `Saved` + Undo after tapping Save, may then sit behind the keyboard. WorkoutScreen hides toasts while the keypad is up, but `Screen` does not.

**Fix:** add it to the device checklist. If it reproduces, add the keyboard height to `bottom` or hide the toast while the keyboard is up.

### S5. (nit) The stale card shows two near-identical times
`apps/mobile/src/screens/TodayScreen.tsx:455–457`

The lines are `Last set logged at 19:20` and `Ended about 19:24`. The second is the first plus a pad. Under the minimal-copy rule, one line is enough. **Fix:** drop the "Last set" line when `endedAboutUtc` is set.

### S6. (nit) The assisted load steppers' VoiceOver wording
`apps/mobile/src/ui/workout.tsx:227–229`

The inline load editor's label is now `${label} ${unitText}`, for example `Assist kg`. The `label === 'Assist'` branch never matches. VoiceOver reads "Decrease assist kg" rather than "Less assistance (harder)", and the visible label is gone, so nothing else explains the direction. This is pre-existing (it was `ASSIST KG`), but more noticeable now.

**Fix:** match with `startsWith('Assist')`, or pass a `kind`.

### S7. (nit) The playbook status depends on its own string
`apps/mobile/src/screens/profile/AppStatusScreen.tsx:108`

The icon and tone are chosen by `endsWith('none yet')`. **Fix:** have `playbookStatusLine` return `{ text, count }`.

### S8. (nit) Exercise detail chips scroll sideways with no hint
`apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:274, 288`

Chips that are off-screen have no indicator. **Fix:** add a trailing fade, or check on device that the last range chip stays visible at 375pt.

## Spec issues

1. **Audit item 2.1 conflicts with 0.3.** Item 2.1 asks for KAV + `automaticallyAdjustKeyboardInsets`, while 0.3's AC says "no double inset". The developer followed 2.1 literally (S1). The audit should have said one or the other.
2. **Audit item 1.5 asks for `numberOfLines={1}` with `planWas` inline**, but the audit tests at AX1. The two can't both hold (B1). It also reverses WT39 (the plate line hidden with the keypad) without a **[Ben]** tag. 1.9 (WT22), 3.3 (the warm-up stat) and 6.3 (drag-to-scrub) also change approved specs without one.
   - The CHANGELOG entry records them as part of "Ben approved 20 Oct", and the design docs are updated.
   - It would be safer to list these four reversals explicitly in the CHANGELOG so Ben sees them, rather than leaving them only in the stage summaries.
3. **The audit was deleted before review.** The CHANGELOG is the only committed record of what was approved. A short committed list of the audit item numbers, each marked done, pending Ben or not done, would make later reviews traceable.
4. **The stale card nit (Resume primary) conflicts with today.md's ≥ 6 h rule.** The developer correctly held it as pending Ben.

## Device checklist additions (on top of the developer's list)

- Open row after a coach "lighter" change at the default size and at AX1: is `Plan was …` fully visible? (B1)
- Workout editor set sheet: on 8–10, type `12` into To. From must stay 8. (B2)
- Edit set: focus the note. Is there a large blank gap under the content when scrolling? (S1)
- Equipment editor: tap Save with the keyboard up. Is the `Saved` + Undo toast visible? (S4)
