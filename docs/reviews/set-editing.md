# Review: set editing, rest screen Last/Next, set pager, workout chat chips

Branch `claude/set-editing` (6 commits, `55c8b40..dbd6d22`) vs `claude/gracious-knuth-joxqpw`.
Trigger: Ben, build 151, 14 Oct: "I should be able to edit anything on the sets", plus backlog F7/F8 and new workout chips.

## Verdict: CHANGES NEEDED

The domain work is solid. `edit_planned_set` is versioned on the set and idempotent on `opId`.
It checks loads against the equipment, kg/lb and convention. Undo restores exactly what the
edit replaced and is refused once the set has moved on. `add_set` with `afterSetId` (insert)
moves later sets down by position only, and its Undo works. Everything survives a force-close.
Tests cover pending vs done, stale versions, idempotency, per-hand dumbbells, stacks, assisted
machines, warm-up type changes for volume and records, and a restart round-trip.

The UI does not yet give Ben what he asked for: the **current** set still can't be opened in
Edit set. Separately, viewing another set leaves an active Log button for a set whose values
aren't on screen.

Checks run in `/home/user/wt-sets`:
- `npm run typecheck`: pass
- `npm run lint`: pass
- `npx vitest run --maxWorkers=2`: 321 files, 6551 passed, 1 todo

---

## Blocking

### B1. The current set has no way into Edit set, so "edit anything on the sets" is not met
- `apps/mobile/src/workout/table.ts:269` (`case 'open': return { kind: 'none' }`)
- `apps/mobile/src/screens/workout/WorkoutScreen.tsx:2486` (`tappable = status === 'done' || status === 'pending'`; the Focus row for the current set is `active`)
- `apps/mobile/src/screens/workout/WorkoutScreen.tsx:2133` (`ViewedSetCard`, which has the only Edit outside rest, renders only when `away`)

**Scenario.** Ben is on Bench set 2 (the current set), not resting, and wants to mark it as a
Top set, or add a set right after it, or give it a note.
- Table: tapping the open row does nothing.
- Focus: the "Sets" list row for the current set isn't tappable, and the pager at "Now" has no Edit.

His only options are the inline load and reps fields, plus the ⋯ menu (Target RPE, Delete,
Rest after through ›). Set type, Insert set after and a per-set note can't be reached for the
set he is about to do. The workaround is to log it and then correct it, which turns a plan
change into a versioned correction of a result. This is the exact case in Ben's request, and
the brief lists "from Focus … Edit next set".

**Fix.** Give the current set an Edit entry. Any one of these would work:
- `Edit` on the pager when `atCurrent`
- an `Edit set` item in the open row's ⋯ menu
- a tap on the `active` Focus row that routes to `EditSet`

`EditSetScreen` already routes a pending set to `PlannedSetEdit`, and `isCurrent` hides `Do
next`, so only the entry point is missing. Add a source-check test for it alongside the
existing `set-pager.test.ts` / `set-editing.test.ts` wiring tests.

### B2. When viewing another set, Log stays live for a set whose values are hidden, and "Enter …" becomes a dead button
- `apps/mobile/src/screens/workout/WorkoutScreen.tsx:2154` (`setEditor && !away` hides the current set's editor)
- `apps/mobile/src/screens/workout/WorkoutScreen.tsx:1308-1323` (`primary` is unchanged while away)

**Scenario 1.** Mid-workout, Ben swipes to "Squat · Set 3 of 4 · Later 140 kg × 5". The
editor for the current Bench set disappears, but the action bar still reads "Log 100 kg × 8".
He taps it believing he is logging the set on screen, and Bench set 2 is logged instead.
This keeps the "viewing never changes what Log logs" rule, but he logs values he can't see
next to a card for a different set. Undo exists, but logging the wrong set during a workout is
the failure that ends with a corrected history.

**Scenario 2.** The primary action is `enter` (a field is missing) and Ben is away. Tapping
"Enter load" sets `showNextSet` and a focus request for an editor that `!away` keeps
unmounted. Nothing happens, which breaks audit F2 ("never a dead button").

**Fix.** While `away`, make the primary action return to the current set. Either relabel it
"Back to Set 2" and reset `viewing`, or keep Log but name the set and exercise ("Log Bench
set 2 · 100 kg × 8"). Route `enter` through `nextViewing({kind:'now'})` before unfolding.
Unit-test the primary-action choice as a pure function of `(view.primary, away)`.

---

## Should fix

### S1. A typed off-equipment load shows one number but saves another
`apps/mobile/src/screens/workout/PlannedSetEdit.tsx:121,151`

Ben types 101 kg on a barbell. The stepper keeps showing 101 with a warning tint, but Save
sends the snapped 100 (the `view.text` line shows 100). Rule 4 holds, because only an
achievable load is saved, but what Ben sees is not what gets saved.

**Fix.** On blur or Save, replace the typed value with the snapped one, the way the done-set
editor handles it. Alternatively, show the snapped value in the field with a short
`→ 100 kg` behind the warning.

### S2. `snapPlannedLoad` turns a failed fit into "no load" (clears the target)
`packages/domain/src/session/active-view.ts:1103-1105`

If `roundToAvailableLoad` returns `ok: false` (convention mismatch between row and equipment,
or no achievable loads), the function returns `null`. The view then builds `patch.load = null`
and Save wipes the set's load target. There are two related problems:
- For a `bodyweight_station` it returns the typed value unchanged, but the reducer's
  `isLoadAchievable` only accepts 0 there, so Save is refused with a generic message.

**Fix.** On failure, return the stored load (or `undefined`, meaning "no change") and never
`null`. Make the bodyweight-station branch agree with `isLoadAchievable`. Add tests for both.

### S3. In Focus, only the thin pager strip responds to swipes
`apps/mobile/src/screens/workout/SetPager.tsx:65`

On Focus (not resting), `Swipeable` wraps only the 44 pt pager header. Swiping on the set card
or the `ViewedSetCard` does nothing. F7 asks for swipe "on Focus/active set". The ‹ › buttons
cover it functionally, but mid-set the swipe target is easy to miss.

**Fix.** Wrap the focus card and `ViewedSetCard` in the same `Swipeable`. `claimsDrag` already
leaves vertical scrolling alone.

### S4. Errors from a refused plan edit disappear straight away
`apps/mobile/src/screens/workout/EditSetScreen.tsx:72`

`PlannedSetEdit` is keyed on `aggregate.revision`. On a refused save, `setError(...)` and then
`onStale()` reloads, the revision changes, and the component remounts with `error = null`. The
"This set changed since it was shown. Showing the latest." line (`set-edit.ts`) never shows.
The same applies to refused Insert, Delete and Do next.

**Fix.** Keep the error in `EditSetScreen`, or key on `setId` alone and reset the edits when
`view.setVersion` changes.

### S5. Undo of an earlier plan edit is lost after a later edit is undone
`packages/domain/src/session/reducer.ts:1132,1148`

Edit A, then edit B, then Undo B. The set goes back to A's values, but A's `edit` record was
removed from `before.planned`, so A's Undo toast (if still visible) fails as stale. This is
conservative and so safe under rule 5, but the toast promises an Undo that won't work.

**Fix.** Keep the previous `edit` record inside `before.planned`, so undoing B restores A's
record and its version. Alternatively, accept the behaviour and dismiss older edit toasts when
a new edit is saved. Either way, add a test.

---

## Nits

- **N1.** `UNDO_TOAST.added(view.setNumber + 1)` (`PlannedSetEdit.tsx:103`, `EditSetScreen.tsx:178`) is wrong when the set has an other-side row. The insert goes after the pair, so the new set is number + 2.
- **N2.** Inserting after a done set that has later done sets renumbers those done sets in the display (`setDisplayNumbers`) and puts a pending set between results. Positions only, so not a rule-2 problem, but consider restricting "Insert set after" to after the last done set, or saying "Added as Set N".
- **N3.** `workoutChatContext` keeps `offTarget` true until the next log, even after Ben has adjusted the remaining sets. "Adjust the rest?" then stays first. Consider clearing it when a coach or Ben edit lands on that exercise after the logged set.
- **N4.** The `too_hard` / `too_easy` structured chip inputs are now unreachable from the workout sheet. Remove them or keep them on purpose.
- **N5.** Long exercise names make chips like "− Set Single-arm dumbbell row" wide. Check wrapping on a real iPhone at AX sizes.
- **N6.** The pager's VoiceOver element has a swipe hint, but no `accessibilityActions` for increment/decrement (adjustable). The ‹ › buttons cover it, so this is optional.
- **N7.** `afterSetId` is silently ignored on the continuation path (`!atCurrentGym`). That is fine, but worth a comment in the schema doc.

## Rules checked

- **Rule 2:** Logged sets are refused by `edit_planned_set` (`set_not_pending`) and go through `correct_set` with Undo. Insert never touches a logged set's values or version (tested). OK.
- **Rule 4:** The reducer checks unit, convention and `isLoadAchievable` (stack max, rack pairs, assisted, per-hand). OK, apart from S2.
- **Rule 5:** Set-version guard, `opId` idempotency, `operation_id_reused`, and supersede on a later edit or Undo. Undo is refused once the set has changed. OK.
- **Rule 3:** Ben's edit drops the coach marker so coach Undo can't revert it, and Undo of Ben's edit brings the coach target back. Tested. OK.
- **Rule 1 / honest AI:** Chips appear only when the coach can answer; otherwise only Pain (deterministic) shows. OK.
- **Rule 6, security:** Nothing new.
- **Durability:** Persistence test covers edit, insert, Undo records, retry after relaunch, and the reindexed sets after a restart. OK.
- **Minimal copy:** OK ("Last set", "Next", "Later", "Now", "Make current", "Table").

## Spec issues

- **SP1.** The brief says "Edit next set" from Focus/rest. The branch removed the inline "Edit next set" unfold. The Next block's `Edit` now opens the plan editor, which replaces the draft and Ben's in-progress values, and marks the target as his own (dropping the rule's or coach's `Why?`). That is reasonable, but it changes what the old link did (editing what will be logged, inline, during rest). Ben should confirm he wants a plan edit there rather than the inline editor.
- **SP2.** The chip list drops the old "Too hard", "Too easy" and "Machine busy". The brief's list doesn't include them, so this follows the spec, but "Machine busy" was a real workout case. Ben should confirm it is meant to go (Swap <exercise> partly covers it).
