# Review: table stays a table, brief Why?, no FitNotes copy (18 Oct)

Branch `claude/table-18oct`, diff `5237060..HEAD` (commits 8650248, 613a7d8, 24fb007).
Reviewer: independent reviewer agent, 18 Oct 2026.

## Verdict: CHANGES NEEDED

The current set is now a real table row, and the Why? panel is much shorter. But Ben's
main complaint ("when you click on it you lose the table form") still happens on every
row except the current one: tapping a non-current row's KG or REPS cell still opens the
full-screen Edit set. Some FitNotes copy is also still on screen (exercise library, Summary
"Why").

## Checks run

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npx vitest run --maxWorkers=2`: 329 files, 6707 passed, 1 todo.
- The reference mock `F18-mock.local.html` is not in the tree and not in any commit.
- `TodayScreen.tsx` and `EditSetScreen.tsx` are untouched.

## Render paths traced (WorkoutScreen → WorkoutTable)

- **Current row (`state: 'open'`)**: renders as `OpenSetRow`, one row (set / KG / value / ✓), with
  an inline − value + editor under it and one secondary line. It never renders a focused block.
  This is correct.
- **Ring on a pending row**: `selectRow` sends `set_active_set`, and the row becomes the compact
  open row. This is correct.
- **Body or cell of a pending row**: `rowTap` → `edit` → `navigation.navigate('EditSet')`, a full
  screen. **This still leaves the table** (B1).
- **Done row**: `rowTap` → `edit` → `EditSet`, a full screen (B1). Rule 2 is still met because it
  uses the versioned `correctSet` path.
- **Skipped row**: disabled. This is correct.

## Blocking

**B1. Tapping a non-current row still leaves the table.** This was the core of Ben's request.
- **Where:** `apps/mobile/src/workout/table.ts:263-268` (`rowTap`) and
  `apps/mobile/src/screens/workout/WorkoutTable.tsx:329-339`.
- **Spec:** "Tapping the KG or REPS cell of **any** set row edits it in place in that row."
- **Failure scenario:** Ben is on set 2. He taps the KG cell of set 3 (pending) or of set 1
  (done) and gets the full-screen Edit set. That is exactly the "goes into something quite
  focused" behaviour he reported, now on every row except the current one.
- **Why the stated reason doesn't hold:** the developer's "Decision 2" says this needs new
  plan-edit commands. It doesn't. `EditSetScreen` already saves both plan edits on pending sets
  and corrections on done sets through
  `services.workout.correctSet({ expectedSetVersion, patch, opId })`, which is versioned and has
  an Undo toast.
- **Suggested fix:**
  - **Pending row, KG or REPS cell:** run `selectRow`, then open `cellEdit` for that field. This
    reuses the existing `set_active_set` path and needs no new command.
  - **Done row, KG or REPS cell:** open the same inline stepper under that row. Save it with
    `correctSet` (expected set version, a fresh opId per edit, the Undo toast), on Done or on
    close, never per step.
  - **Rest of the row:** the row body or ⋯ keeps opening `EditSet` for type, notes and side.
  - **If Ben wants to keep done rows on the full editor**, record that as his decision. Pending
    rows should still edit in place.

**B2. "FitNotes" is still shown in the exercise library.**
- **Where:** `packages/domain/src/exercise-browse.ts:190` (`lastLine`), rendered as `line3` in
  `apps/mobile/src/screens/library/LibraryScreen.tsx:215-217`.
- **Failure scenario:** for any exercise whose last session was imported, the library row reads
  `Last 100 kg × 8 · 3 Oct · FitNotes`. Item 3 explicitly asked to remove "any other user-visible
  FitNotes … provenance tag".
- **Suggested fix:** drop the `' · FitNotes'` branch, keeping the gym-name branch. Update the
  exercise-browse test.

**B3. The Summary "Next time" Why still shows FitNotes and multi-sentence rule facts.**
- **Where:** `apps/mobile/src/coach/next-time-view.ts:109` builds
  `why: [b.summary, ...b.facts]`, and `SummaryScreen.tsx:711-717` renders each item.
- **The text:** the facts include
  `Last session is from FitNotes (equipment not recorded); its 2 lighter sets before the top set were read as warm-ups.`
  (`packages/domain/src/progression.ts:590`) and
  `No equipment here to check the FitNotes load (…) on, so no load is prescribed; enter your load.`
  (`progression.ts:1010`).
- **Failure scenario:** Ben finishes a workout whose basis was imported, taps Why on the Summary,
  and sees FitNotes plus long sentences. This breaks item 3 and the spirit of item 2. The
  developer moved facts out of the in-workout Why panel because they were too long, but the same
  facts are still printed on the Summary.
- **Suggested fix:** show `briefLine(b.summary)` only, or summary plus at most one short fact
  with the FitNotes wording neutralised (for example "equipment not recorded"). Do this in the
  view model, not in `progression.ts` (the stored facts and coach context stay as they are).

## Should fix

**S1. The pain line now reads "Held … · after target", which can contradict the target.**
- **Where:** `packages/domain/src/session/target-why.ts:356`.
- **What changed:** when the flag came *after* the target was set, the target is not adjusted
  (comment at line 354). It can therefore still contain an increase. The old copy said
  `Since 9 Oct · no increases` plus `Flagged after this target was set`. The new copy says
  `Held · since 9 Oct (shoulder) · after target`.
- **Failure scenario:** a target with an increase is labelled "Held". That is misleading on a
  safety topic (rules 6 and 9).
- **Suggested fix:** use `Held` only when the flag predates the target. Otherwise use
  `Flagged after target · since 9 Oct (shoulder)` or similar.

**S2. Coach reasons are cut silently but still shown in quotation marks.**
- **Where:** `target-why.ts:258`.
- **The problem:** `“${briefLine(reason)}”` shows a cut-down sentence as if it were the coach's
  verbatim words. `briefLine` also cuts at abbreviations ("e.g. ", "approx. ").
- **Suggested fix:** add `…` when text was dropped, or don't quote it.

**S3. The inline editor can reopen by itself after Undo.**
- **Where:** `WorkoutScreen.tsx:193-195`. `cellEdit` is keyed to the set ID but never cleared on
  log.
- **Failure scenario:**
  1. Tap KG on set 2 and step it.
  2. Tap ✓ without Done. The editor hides because the active set changes.
  3. Tap Undo on the toast. Set 2 is active again and its KG editor pops open unasked.
- **Suggested fix:** call `setCellEdit(null)` in `log()` after a successful write, and in
  `selectRow`.

**S4. "Tap elsewhere" doesn't close the editor (spec: "tap elsewhere / Done to close").**
- **Where:** `WorkoutTable.tsx`, `OpenSetRow`.
- **The problem:** only Done, re-tapping the same cell, or a set change closes it. Tapping
  another row navigates away instead.
- **Suggested fix:** close `cellEdit` on scroll-begin, on another row's tap, and on a tap on the
  table background.

**S5. Target RPE isn't a row cell.**
- **Spec:** "every set … is one table row (set no. + type tag, KG, REPS, **RPE if targeted**, ✓)".
- **What was built:** the current row puts `@ 8.5` only in the secondary line, and pending rows
  don't show their target RPE at all (`effort` is null for pending rows in
  `table-view.ts` `rowCore`).
- **Suggested fix:** either add a small `@ 8.5` after the value cell, as done rows show effort,
  or confirm with Ben that the secondary line is enough.

**S6. No tests cover the new table-row behaviour.**
- **What's untested:** `cellEdit` keyed close and reopen, the `focusRequest` table branch, ✓
  using `canLog`, and the `openSetMore` menu items.
- **What exists:** the only new test is `target-brief.test.ts`, covering the domain cell helpers.
- **Suggested fix:** extract the cell-edit state transitions into a pure helper in
  `apps/mobile/src/workout/table.ts` and test them: open, close on Done, close on log, no reopen
  after undo, Enter-load opens the load cell.

**S7. Accessibility labels for cells read awkwardly.**
- **Where:** `WorkoutTable.tsx:900`.
- **The problem:** `loadA11y` reads "Added load BW kg" or "Load — kg" for bodyweight and empty
  loads. ✓ reads only "Log set 2", without the values the big button announces.
- **Suggested fix:** for `BW` say "bodyweight", for `—` say "no load". Give ✓ the same text as
  the bottom button (`Log 82.5 kg × 6`).

**S8. Text size and VoiceOver layout are unverified.**
- **Where:** `WorkoutTable.tsx`, the inline editor.
- **The problem:** the old open row used `tileFit` to shrink or stack the tiles at large text
  sizes. The new inline editor fixes `numeralSize={32}` and puts the stepper and Done side by side
  with no stacking.
- **Risk:** clipping at AX sizes on a narrow iPhone.
- **Suggested fix:** check on device at AX sizes, and stack Done under the stepper when `p.ax`.

## Nits

- **N1.** Dead code: `SOURCE_LABEL` / `(FitNotes)` handling in `fitKeepingTail`
  (`packages/domain/src/session/builder-loads.ts:759-776`). Nothing produces `(FitNotes)` any more.
  `keypadMovesTiles` (`apps/mobile/src/workout/table.ts:71`) is no longer used by the UI.
- **N2.** The Why "Last time" line shows only the top RPE (`100 kg × 8, 8, 7 @ 8`). That reads as
  if every set was RPE 8. Consider `top @ 8`, or the RPE of the cited set.
- **N3.** The Why panel no longer names the gym or equipment of the basis workout. After a gym
  switch, that was the one useful clue to why a load changed. Consider keeping the gym name only
  when it differs from today's.
- **N4.** `home.ts:327` sheet still reads `N imported`, and `home.ts:304` reads
  `No times for imported workouts`. These are factual about missing time data, so they're
  acceptable, but confirm with Ben.
- **N5.** Open-row set column is 48 pt plus 3 pt padding, against 52 pt on other rows, so the
  columns may sit about 1 pt off.
- **N6.** `TodayScreen.tsx:881` still says "FitNotes". It was out of scope on this branch, so it
  must be handled on the TodayScreen branch, or by a one-line follow-up after merge.

## Product-rule check

- **Rule 1 (offline):** no network paths changed. Pass.
- **Rule 2 (completed sets):** ✓ logs only the current row through the one `log()` path, with its
  opId and Undo. Done rows go only through `correctSet` (versioned). Pass. B1's fix must keep this.
- **Rule 5 (versioned writes):** select and correct are unchanged. Pass.
- **Rule 6 (honesty):** `est.` is kept on the target and on builder references. The S1 wording
  is a regression.
- **Rule 8 / coach context:** `training-view.ts` and the coach prompts keep the FitNotes
  provenance. Pass.
- **Minimal copy:** good overall. The Why? panel is now one line per row.

## Spec issues

- **✓ on non-current rows:** the spec asks ✓ to log any row. That conflicts with Ben's earlier
  decision 3/4 ("the ring makes it current, never a log"). The developer kept the earlier
  decision. Ben must pick one, and the result should be recorded in the CHANGELOG.
- **Item 3 scope:** the spec listed specific locations but the intent was "anywhere
  user-visible". B2 and B3 show the list was incomplete. Future specs should say "grep and
  remove all user-visible occurrences outside import and backup" explicitly.
- **Dropped rule facts:** the spec asks for one line per reason, but rule facts such as "1
  lighter set … was not judged" carried honesty-relevant caveats. Now they are only in storage
  and the coach context. Ben should confirm that's acceptable.
