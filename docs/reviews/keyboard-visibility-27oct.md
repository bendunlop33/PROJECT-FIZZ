# Keyboard visibility and Add-exercise search (27 Oct)

Ben's report on build 403 (26 Oct): in the Coach sheet with the keyboard up, only the
`Done` bar shows and the text field is hidden behind the keyboard. "Check across all
texts that when type can see what typing." Also: "why can't I search when I add exercise".

Branch `claude/kbd-27oct`. Status: built and tested in source. **Not yet checked on a
device.** The layout needs Ben's iPhone (checklist below).

## What was wrong

1. **Coach composer under the keyboard (root cause).** `SheetKeyboardAvoidingView` set RN's
   `KeyboardAvoidingView` `keyboardVerticalOffset` from `measureInWindow`. Under Fabric that
   measurement comes from the shadow tree. For a screen presented as a native page sheet
   (rn-screens `presentation: 'modal'`), the sheet's top inset (about 60 pt below the status
   bar) isn't part of the shadow tree, so the offset was about 60 pt short. The view was
   padded by the keyboard height minus 60 pt, which left the composer (about 68 pt with its
   padding) under the keyboard, with only the accessory `Done` bar showing. The same frame
   was used by Edit set, Planned set edit and the custom exercise form, all of them modal
   sheets, so they were exposed to the same bug. `autoFocus` in the builder coach sheet made
   it worse: the keyboard opened before the offset had been measured.
2. **Add exercise had no visible search.** The shared picker (`SwapSheet`) put the search
   field below `In this workout`, `Recent`, `Suggested` and the chip rows. On Add, those
   sections pushed it off the first screen of the sheet. Every Add path already opened this
   one picker, so the search was there but out of view. **No add path used a different list
   without search.**
3. **Progress › Lifts search and `Other`, and the Library search:** these scroll views had no
   keyboard insets, so a field low on the page could end up under the keyboard.
4. **Fields under a pinned footer** (Screen with a footer, Edit set, Planned set, Exercise
   form, bottom cards): the scroll view shrank, but nothing scrolled the focused field back
   into view.

## What changed

- `apps/mobile/src/ui/keyboard-state.ts`: pure `keyboardInset({ keyboardHeight, bottomGap })`
  (the keyboard height including the accessory bar, less a tab bar's height, rounded up),
  `keyboardAnimationMs`, and `revealScrollY` (where a scroll view should move so the focused
  field is visible). `windowKeyboardOffset` is removed.
- `apps/mobile/src/ui/keyboard.tsx`: `SheetKeyboardAvoidingView` is now the single shared
  frame. It pads its content by `useKeyboardInset(bottomGap)` and animates with the
  keyboard's own duration. It doesn't measure the window. `useTabBarGap()` gives the tab bar
  height inside the tabs. `KeyboardScrollView` scrolls the focused field into view when the
  keyboard opens or the viewport shrinks. It measures relative to its own content, so the
  sheet's position doesn't matter.
- `Screen` (with a footer) gets `bottomGap` set to the tab bar height and uses
  `KeyboardScrollView`. `BottomCard` uses the shared frame and `KeyboardScrollView`, and has
  a new pinned `header` slot. `WorkoutScreen` uses the shared frame instead of RN's
  `KeyboardAvoidingView`.
- Edit set, Planned set edit and Exercise form scroll with `KeyboardScrollView`.
- The builder coach sheet scrolls to the latest turn when the keyboard shrinks the list. The
  main coach sheet already did this through `follow()` on layout.
- `SwapSheet`: the title and search are pinned at the top, above everything that scrolls.
  The chips, Recent, Suggested and results scroll below them. The search and filter logic
  (`exercise-picker.ts`, `exercise-picker-service.ts`) is unchanged; that fix is on
  `claude/coachcardio-27oct`.
- Progress, Exercise detail and Library scroll views have `automaticallyAdjustKeyboardInsets`.
- Tests: `apps/mobile/test/keyboard-visibility-27oct.test.ts` covers the inset and reveal
  math, plus a source check that every `.tsx` with a `TextField`, `TextInput` or
  `NumberStepper` sits in a shared frame (`SheetKeyboardAvoidingView`, `Screen`, `StepFrame`,
  `BottomCard`, or native `automaticallyAdjustKeyboardInsets`) or in an allow-listed
  component whose hosts have one. It also checks that there's no RN `KeyboardAvoidingView` or
  `keyboardVerticalOffset` anywhere, that the coach composer comes after the transcript
  inside the frame, and that every Add exercise goes to the one picker with search in its
  pinned header.

## Inputs audited

| Where | Field(s) | Frame | Before | Now |
|---|---|---|---|---|
| Coach sheet (Today, Your workout, workout) | composer | shared frame, native modal | **hidden under keyboard** | sits on keyboard, list shrinks |
| Builder coach sheet (Your workout ✦ type) | composer (autoFocus) | shared frame, native modal | **hidden under keyboard** | sits on keyboard, last turn in view |
| Edit set (modal) | load, reps, time, distance, note | shared frame + reveal | footer and bottom fields short by ~60 pt | fixed |
| Planned set edit | steppers, note | shared frame + reveal | same as Edit set | fixed |
| Exercise form (Library New/Edit, modal) | name | shared frame + reveal | same | fixed |
| Workout (full screen) table cells + keypad bar, open-row tiles, cardio distance | numbers | shared frame (was RN KAV, same math) | OK | unchanged behaviour |
| Exercise pop-up (set fields + bar) | numbers | BottomCard | OK | + reveal |
| Add / Swap / Superset exercise picker | search | BottomCard header | **search off-screen under lists** | pinned at top |
| Note sheet, Name sheet (rename / save as), Save workout | text | BottomCard | OK | + reveal |
| Set shape sheets | numbers | BottomCard | OK | + reveal |
| Lift target sheet | weight | BottomCard | OK | + reveal |
| Activity sheet (Today ＋) | time, distance | BottomCard | OK | + reveal (no edit to the sheet: health branch) |
| Memory, Split day name, Training details (birth year, weight) | text/number | BottomCard | OK | + reveal |
| Library search, Library sheet | search | tab scroll / BottomCard | no insets | native insets |
| Progress › Lifts `More` search, `Other` sessions | search, number | tab scroll / modal scroll | **no insets** | native insets |
| Check-in (all steps, note) | note, numbers | native insets in scroll | OK | unchanged |
| Gym setup / Add gym (name) | text | StepFrame → Screen | measured offset (OK outside modals; Add gym is a modal) | shared frame |
| Gym equipment editor | numbers, names | Screen + footer (Profile tab) | no reveal under footer | tab-bar gap + reveal |
| Import preview, choose, question (paste and name fields) | text | Screen | OK | + reveal where a footer is pinned |
| Builder Set up coach bar (no coach: inline field) | text | Screen | OK | unchanged |
| Rename / rep range / work time / distance prompts | text | `Alert.prompt` (system) | OK | unchanged |
| Coach connection / API key | none typed in-app (sign-in is a web flow) | Screen | n/a | n/a |

## Add exercise entry points traced

All of them open the one shared picker (`SwapSheet` with `useExercisePicker` and
`usePickerView`):

- Your workout (`BuilderWorkoutScreen`): `＋ Add exercise` → `openSwap(null)`
- Saved workout and plan day editor (`EditWorkoutScreen`, used for templates, plan days,
  New, Duplicate, Save as): `＋ Add exercise` → `openSwap(null)`
- Active workout: the action bar's `Add exercise`, the Next row's `Add exercise`, the
  round sheet's `＋ Add exercise`, the table's add under the last round, the empty state
  button and the coach's add → `workoutEdits.openAdd()` → `SwapSheet`
- Superset with… → the same sheet, with `In this workout` first
- Progress › Exercises `More` is a history picker (choose which lift to view), not an
  add. It has its own search at the top.

None of these paths was missing search. The search was there in every one, but sat below
the lists. Pinning it at the top fixes all paths at once.

## Device checklist for Ben (375 pt SE/mini class and 430 pt Pro Max if available)

1. Your workout → tap ✦ / type: the Coach sheet opens with the keyboard. The text field sits
   directly above the `Done` bar, and what you type is visible. Send a message: the newest
   message stays in view above the field.
2. Today → ✦ Coach → tap the field: same as step 1. Scroll up in a long chat, then tap the
   field: the list stays where you left it, and the field is visible.
3. In a workout → ✦ → type: same. `Back to workout` stays visible.
4. Edit a logged set (Summary or the workout's ⋯ → Edit): tap the note, then load and reps.
   Each field is visible above the keyboard, and the `Save` bar sits on the `Done` bar.
5. Library → ＋ New exercise: the name field and `Save` are visible while typing.
6. Add exercise from Your workout, a saved workout's editor and an active workout: `Search`
   is at the top as soon as the sheet opens. Type "bike": the results update as you type,
   and the field stays visible above the keyboard. (Exercise bike being found at all
   depends on the search fix on `claude/coachcardio-27oct`.)
7. Profile › gym › equipment: tap the lowest number field. It scrolls into view above the
   keyboard, and `Save` sits on the keyboard, not hidden behind the tab bar or keyboard.
8. Add gym (from Profile): the name field and `Save gym` are visible while typing.
9. Note sheet, rename, Save as workout, lift target, activity time and distance, memory,
   split day name, birth year and weight: each field is visible while typing.
10. Progress › Lifts › More: type in Search, then `Other` under the period. Both stay above
    the keyboard.
11. Check-in note: visible while typing at both sheet heights.
12. With Larger Text (AX sizes) on, repeat steps 1 and 4.
13. Settings › Accessibility › Motion › Prefer Cross-Fade Transitions on: repeat step 1.
    The field must not end up under the keyboard.

If any field is too high (a gap above the keyboard), that's the safe direction of error.
Note where it happens; a field under the keyboard is the bug.

## Open

- Device verification is still needed. The fix depends on the keyboard being docked at the
  bottom of the screen, which is always the case on iPhone. iPad floating or split
  keyboards are out of scope.
- If a tab screen ever hides its tab bar while the keyboard is up, its `Screen` footer would
  sit one tab-bar height above the keyboard (safe, but with a gap).
