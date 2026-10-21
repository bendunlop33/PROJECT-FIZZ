# Review: workout v3 §7 "Same editing as the builder" (branch claude/wo-v3b-21oct)

Reviewer lens: whether the workout matches the builder and spec §7. That means every builder edit works mid-workout through the same shared components, drag works in both screens, every gesture has an accessible alternative, copy stays minimal, and nothing breaks in the v3 round page or the builder.

Diff: `f8220ad..a434299` (7 commits, 38 files).

## Verdict: **CHANGES NEEDED**

There is one blocking bug. In the exercise pop-up, an edit can land on the wrong set, and that wrong set can be a logged one, which breaks rule 2. The rest of the work is in good shape:
- The pop-up, Swap sheet, table parts and drag are single implementations in `apps/mobile/src/ui/`. The builder files re-export them (`BuilderParts.tsx`, `BuilderSheets.tsx:12,98-99`), so there are no copies.
- The new commands carry operation IDs, are versioned, refuse stale versions and have Undo, including after a reload.
- Done sets are protected in `reorder_sets`, `add_warmup`, rest by type and Remove.

## Checks run

- `npm run typecheck`: clean (exit 0).
- Targeted vitest (`--maxWorkers=2`): 9 files and 141 tests passed. Files: `workout-edits`, `builder-v3-draft`, `workout-edit-views`, `workout-edit-service`, `workout-edit-wiring`, `builder-screens`, `exercise-menu`, `workout-inline-entry`, `workout-keyboard`.
- I did not re-run lint, the migration check or the full suite. The developer reports all of them clean, apart from the last commit, which only had a targeted run.

## Blocking

**B1. The pop-up maps a typed value to the wrong set when the exercise has skipped sets, and can correct a logged set Ben never touched (rule 2).**
- **Where:** `apps/mobile/src/workout/exercise-popup.ts:55-73` and `apps/mobile/src/ui/exercise-popup.tsx:75-105`.
- **Cause:** `sessionPopupView` sets `index: i`, where `i` is the row's position in `p.exercise.rows`. That list includes skipped rows (`rounds.ts:141`), but `flatMap` then drops skipped rows from `view.rows`. `ExercisePopup` looks rows up by position: `commit` uses `view.rows[row]`, `step` uses `view.rows[focus.row]`, and `goNext` uses the row count. Once a skipped row comes before other rows, the index and the position no longer match.
- **Failure scenario:**
  1. Bench: Set 1 is logged, then ⋯ Skip exercise (Set 2 is skipped).
  2. Ben changes his mind and taps ＋ Set twice, giving pending Set 3 and Set 4.
  3. He makes Set 4 current and logs it.
  4. He opens the pop-up and types 10 into Set 3's Reps.
  5. `commit(2, …)` reads `view.rows[2]`, which is the logged Set 4. A `correct_set` is sent that changes Set 4's logged reps to 10, and the toast reads "Set 4 corrected".
  6. Other layouts fail differently: the edit goes to another pending set's target, or `view.rows[i]` is undefined and the edit is silently dropped. The −/+ keyboard bar steps the wrong row's kg in the same way.
- **Fix:**
  - Set `index` to the row's position in the filtered list: filter first, then map with the new index.
  - Or, more robustly, make `ExercisePopup` key everything by `row.key` (set ID): drafts, refs, focus, `commit`, `step` and `goNext`.
  - Add a view-model test with a skipped set in the middle, plus a component-level test that `commit` resolves the row by key.

## Should fix

**S1. Unlink mid-workout removes the superset from rounds already done. Spec §7 and the task say it should only affect the remaining rounds.**
- **Where:** `WorkoutEdits.tsx:178`, which calls `split_superset` (`reducer.ts` `handleSplitSuperset`). That clears `supersetGroup` on every member.
- **Failure scenario:**
  1. 3a/3b are done for 2 of 3 rounds, and Ben taps Unlink.
  2. The round strip, the Workout sheet, the Summary and history now show rounds 1–2 as two separate exercises.
- **What is right:** the logged numbers are untouched. The developer raised this as Decision 1.
- **Fix:** either
  - (a) Ben accepts the behaviour and the spec is amended, or
  - (b) record the split round, for example as a `splitFromRound` / `roundOffset` marker on the members. Done rounds then keep their grouping and only later rounds run singly.

  Also add a reducer test that logs the partner's set after the unlink and checks what Log moves to next. The current test (`workout-edits.test.ts:355`) stops at the active set right after the split, so "the half-done round finishes first" is only half proven.

**S2. In a set box that scrolls, drag can drop onto rows Ben can't see.**
- **Where:** `drag-list.tsx:92-96` measures every registered row with `measureInWindow`, including rows scrolled out of the clipped box (`WorkoutTable.tsx:419,434`). `dropTargetAt` then hit-tests against those frames.
- **Failure scenario:**
  1. The box shows 3 of 6 rows, so Sets 4–6 are clipped below it. In window coordinates they sit under the next exercise's header and the Up next line.
  2. Ben drags Set 3 a little past the bottom of the box.
  3. It drops "before Set 5". No drop line is visible, because the line is drawn inside the clipped content.
  4. The set moves somewhere he never saw. There is Undo, and only pending sets move.
- **Fix:** clip the frames to the box's visible rectangle, measuring the box with `measureInWindow` when the hold fires. Treat a finger above or below the box as before the first or after the last *visible* row, or add the slow edge auto-scroll the builder spec proposes (Decision 7). Add a `dropTargetAt` test with clipped frames.

**S3. The Remove confirmation doesn't bind the count Ben confirmed.**
- **Where:** `WorkoutEdits.tsx:193-201`. `go()` rebuilds the command from the state at send time (`removeExerciseCommand(now, …)`), so `confirmedLoggedSets` is always the current count. The reducer check that refuses a confirmation for logged sets that changed since (`reducer.ts`, `handleRemoveExercise`) can therefore never fire from the UI, which defeats the rule 5 design.
- **Fix:** capture `logged` when the alert is shown and send `{ ...command, confirmedLoggedSets: logged }`. Add a hook-level test.

**S4. Edits to pending sets in the pop-up have no Undo, but the same edits on the round page do.**
- **Where:**
  - Kg, Reps and RPE on a pending set: `WorkoutEdits.tsx:356-360` returns only the note.
  - Rest steppers: `WorkoutEdits.tsx:393-397` passes `toast: null`.
- **Detail:** the round page's own target edits show "Set 3 updated · Undo" (`PlannedSetEdit.tsx:25`). The task lists Undo for each of these today-only commands.
- **Fix:** call `undoToast(UNDO_TOAST.correctedNamed(row.spokenName), opId)` after a successful `edit_planned_set`. For the rest stepper, which repeats while held, show one coalesced "Rest 2:00 · Undo" toast on release, or accept no toast and record that decision.

**S5. Some actions are offered even though they will always be refused.**
- **Superset with next:** `supersetNextCommand` (`workout-edits.ts:132-141`) doesn't check whether both sides are already in different supersets, but `link_superset` refuses that case (`reducer.ts` "already in a superset"). The button, ⋯ item and VoiceOver action show and then fail.
- **Remove on a finished exercise:** with nothing left to do, `canRemove: round !== undefined || …` (`WorkoutScreen.tsx:1065,1130`) still offers Remove. Ben gets a confirm dialog, then "Nothing left to remove".
- **Workout sheet "onto" drop:** `canDropRound`'s pairing (`pairWithCommand`, `workout-edits.ts:147-151`) highlights done rounds as drop targets, then the drop is refused (`set_not_pending`).
- **Builder drag:** there is no `canDrop` (`BuilderWorkoutScreen.tsx:593`), so dropping onto the main lift highlights and then springs back.
- **Fix:** mirror the reducer's preconditions in these probes so they return null. The builder can pass `canDrop` from `dropBuilderSlot(...) !== null`.

**S6. Mid-workout kg rounding is inconsistent between the pop-up and the table.**
- **Detail:** a kg typed in the pop-up rounds toward easier (`snapTypedLoadEasier`). The same cell on the round page rounds to nearest (`snapPlannedLoad`). Typing 101 gives 100 in the pop-up but 102.5 inline, for the same set.
- **Fix:** pick one rule for both workout entry points (the builder's "toward easier" fits §7 parity), or document why they differ.

**S7. Missing tests for the edge cases above.**
- B1: a skipped row in the middle.
- S1: the next log after an unlink.
- S2: clipped frames.
- S3: the bound confirmation.
- Remove with logged sets on a **superset member**: what happens to the partner's remaining rounds and `roundOffset`.
- `add_warmup` when the only pending sets sit *before* a done set. The probe (`canAddWarmupNow`) says yes, but the reducer refuses with `set_not_pending` (`reducer.ts` `handleAddWarmup`, `i > lastDone`), so the button is enabled and then fails.

## Nits

- N1. `drag-logic.ts:304`: `arm` re-checks `atMs - phase.atMs >= 320` against `nowMs()`. If the native long-press timer fires a millisecond early, the hold arms nothing and the tap is already consumed, so nothing happens. Trust the long press, or allow a few ms of tolerance.
- N2. The pop-up header columns are fixed at 56 pt, but the cells have a `minWidth` of 52 (`exercise-popup.tsx:206,127`). At larger Dynamic Type sizes the columns drift out of line. Use one shared width constant.
- N3. Workout sheet rows have no custom VoiceOver actions (Move up/down, Superset with next). These are only reachable through the row's ⋯ button. That is acceptable, but rows on the round page do have them, so add them here for consistency.
- N4. The table ⋯ menu now has up to about 18 items (`exercise-menu.ts`). Consider removing duplicates, for example Superset with… next to Superset with next, and Add exercise, which is now also under the last round and in the Workout sheet.
- N5. At accessibility text sizes, the open row's `Now: <plates>` line used to sit in the name sheet (removed with `openExerciseSheet`). ⋯ Plates shows only today's targets, so the current set's plate line is no longer reachable at AX sizes.
- N6. `pick()` names the toast by finding the first live row with that `exerciseId` (`WorkoutEdits.tsx:238`). Use the result's `toName`, which `swapExercise` already returns.
- N7. `warmupGap` now filters out warm-ups heavier than the top load, a quiet change to builder behaviour (`edit.ts`). That's fine, but mention it in the builder test.

## Spec issues

1. **Spec §9 Q18 conflicts with this task.** The builder spec says drag ships "only once tested on Ben's iPhone". This task turned it on in the builder's Your workout before any device test. Either keep it behind a device pref until Ben has tried it, or Ben amends Q18.
2. **"Unlink only for the remaining rounds" (§7) can't be represented** with today's exercise-level `supersetGroup`. Ben should choose between S1(a) and S1(b).
3. **Header drag "in the round card" (§7) has nothing to reorder against,** because the card shows one round (Decision 2). The spec should limit header drag to the Workout sheet.
4. **The type-change rules differ between the builder and the workout** (Decision 4). In the builder, picking Top set re-labels the old top as Back-off and recalculates. In the workout it does neither. §7 says "same functionality", so the spec should say which rule applies mid-workout. For a done set, keeping the numbers is right (rule 2). For pending sets, the builder rule may be what Ben expects.
5. **Spec §4 still says reorder, Swap and Add come from the "existing OverviewEditSheets",** which this branch replaces with drag and the builder's sheet. Update §4.

## Device checks still needed (from the developer, agreed)

- Does the hold beat ScrollView scrolling, the row's swipe-to-Delete and the round swipe?
- Does `scrollEnabled` turn off in time to stop native scrolling?
- Are the drop lines in the right place, and does the haptic fire?
- Does the keyboard bar work inside the pop-up?
- Does the toast show in the pop-up footer?
