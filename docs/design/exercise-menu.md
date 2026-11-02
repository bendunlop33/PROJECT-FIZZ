# Exercise menu (in-workout)

Status: **Approved by Ben, 1 Nov 2026: A + C.** Prototype: [prototypes/exercise-menu.html](prototypes/exercise-menu.html) (three frames; B was not chosen). Replaces the round page's `⋯` action sheet (31 Oct, `womenu`). Tokens: [design-system.md](design-system.md). Minimal copy (Ben, 10 Oct).

Ben's question (build 500, Push B, exercise 5 of 5, nothing logged): "Why can't I move this up or down or to the start?"

## A: context menu

**Opening it.** Tap `⋯` on the exercise header, or long-press the header. The header lifts (drawn over its place, 2% larger, with a shadow), the rest dims under the scrim, and a 250 pt menu sits under it, right-aligned (above it when there's no room; when neither fits the card moves up). Opened from the Workout list's `⋯`, it sits near the top. A tap outside closes it. There is no Cancel row.

Only the header long-presses for this menu: a set row's hold stays its own (drag, or the set's menu).

**Order.**

1. `Undo …`, only while something can be undone, with what it undoes: `Undo swap  Rotation ← Face pull`; `Undo coach change` / `Undo change` (the rule's).
2. A row of icon buttons, only the moves that would change the order: **Later** (Move to end), **Now** (Do first), **Up**, **Down**.
3. Swap exercise
4. Add set
5. History
6. Notes, then Plates (bar or plate-loaded only)
7. Adjust (current exercise only)
8. (Revision 2 Nov, Ben: "Yes move to menu.") Separator, then what the name's pop-up had, each only when it applies: How to (has a guide), Add warm-up (not in a superset, something left to warm up for, under 4), Rest with its value (`Rest  3:00`: opens a sheet with rest per set type, or `After each round` for a superset), Superset with next, Unlink (in a superset), Why this weight? (an alert with the stored target's reasons; `Not recorded` when there are none).
9. Separator, then **Skip exercise** (while it has a set to do) and **Remove exercise** (the pop-up's rule: nothing logged, or sets still to do; with logged sets it asks first and keeps them) in red.

The pop-up's Move up / Move down are the icon row's Up / Down (same write). A tap on the exercise name opens nothing (revision 2 Nov); the menu is `⋯` or a long press, and the header's VoiceOver actions are the menu's items in order, plus `Exercise options`. The pop-up stays on Your workout before Start and in the workout editor.

**Moves.** Any exercise with nothing logged moves, the current one included. Nothing moves above an exercise with a set logged, and a started or done exercise never moves. A superset moves as one. `Now` takes it to the first place it can go. When the current exercise moves, or one is put above it, the exercise now in its place becomes current (its first set to do), unless a work timer is running on the current set. The rest timer and every logged set are untouched. Toasts: `<name> moved`, `<name> first`, `<name> moved to end`, each with Undo; Undo also hands the current set back.

**Native or custom.** Custom, in React Native. `@expo/ui` has SwiftUI `ContextMenu`, but its long-press trigger has to host the RN card inside SwiftUI (`RNHostView`), inside our scroll view and round-page swipes, and a tap on `⋯` would need a separate SwiftUI `Menu` without the lift. Neither can be checked in our render tests or without the phone. The app has no blur module, so the backdrop is the translucent scrim (adding `expo-blur` would need a new native build).

## C: swipe in the Workout list

The Workout sheet's rows (`#`, exercise, sets, top set):

- **Swipe left** reveals **Later · Swap · Skip** (only those that apply). A full swipe (60% of the row) skips, with Undo.
- **Swipe right** reveals **Add set** (with Undo).
- A done exercise has no left swipe; Add set stays.

**How it coexists with the other gestures.**

- The round page keeps its swipes: across the card = next / previous round; on a set row = Delete (the row claims the swipe first). Exercise swipes are only in the Workout list, which has no set rows.
- In the Workout list, a still hold (320 ms) arms the drag; once armed the drag takes the touch. A quick sideways drag before the hold is the swipe; a vertical one scrolls.

## VoiceOver

- The exercise header: `Exercise options` opens the menu, plus Move up, Move down, Do first, Move to end (only those that apply) and its other actions.
- Menu rows and icon buttons are buttons with their full names (`Move to end` for Later).
- A Workout list row: `Exercise options`, plus each swipe action (Move to end, Swap exercise, Skip exercise, Add set).

## Open

- Not run on Ben's iPhone: the lift, placement at large text sizes, swipe feel and the full-swipe distance.
- Focus view keeps its own action sheet.
