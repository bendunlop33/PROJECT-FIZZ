VERDICT: CHANGES NEEDED

# Review: weight flicks back to the preset (claude/weight-revert-21oct)

Reviewer: independent reviewer agent, 21 Oct 2026.
Scope: `claude/weight-revert-21oct` at `d7bacd4` against `39b91f3`: `8dff114` (domain), `26669e1` (screen), `d7bacd4` (pop-up). `ae2e21e` (warm-up training guide) is also in the range. It is unrelated and not reviewed.
Ben's report (Build B, 21 Oct, Back workout, Barbell row, after a coach `edit_today`): "If I change the weights from pre set then it keeps flicking back to before".
Read against: CLAUDE.md rules 2–5, active-workout.md §4.2, coach-adjustments.md §4.3 and workout-table-v3 §7.

## Checks run (in /home/user/wt-weight-revert)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `NODE_OPTIONS=--max-old-space-size=6144 npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | 454 files, 8,473 passed, 1 todo. The developer reported 455 files / 8,476; see N3. |
| New and changed tests alone (`weight-revert.test.ts`, `weight-revert-wiring.test.ts`, `workout-edit-views.test.ts`) | 3 files, 35 passed |
| Throwaway probe (`apps/mobile/test/zz-review-scratch.test.ts`, deleted, not committed) | (a) Draft 105 kg × 8 on Bench set 2, then pop-up reps → 6 via `popupCellWrite` + `edit_planned_set`. Table load cell `105` → **`100`**; `reconcileDraftEdits` → `null`. (b) Draft 105 on set 3, then log sets 1 and 2. Table row `105`, rest `Next` card `restSetsView(s).next.value` = **`"100 kg × 6–8"`**, lock screen `line2` = **`"Target 100 kg × 6–8"`**. |

What's good: R1 (`shownPlanned` in the table, Focus list, pop-up and Edit set sheet) is the right shape. It is pure and unit- and convention-safe (lb, per-hand and stack drafts are ignored). The `save_draft` version check is backward compatible. Dropping `data` from the debounced save's dependencies removes the "save on every refresh" loop. `save_draft` doesn't bump the set version, so a versioned draft doesn't refuse its own next save.

## Blocking

**B1. Changing one field in the exercise pop-up wipes Ben's other draft field, so his weight flicks back to the preset.**
- Where: `apps/mobile/src/workout/exercise-popup.ts:187-190` and `:205` (the patch carries only the edited field) with `packages/domain/src/session/reducer.ts:1295` (`draft: valuesTouched ? null : set.draft`) and `packages/domain/src/session/active-view.ts:157` (reconcile then drops the screen's edits).
- Scenario: Ben types 105 kg on Barbell row set 2. The draft is saved, and with R1 the pop-up and the table now show 105. He opens the pop-up and changes that row's reps to 6. `edit_planned_set {reps}` clears the whole draft, so the load goes back to the 100 kg preset, the screen's edits are reconciled to `null`, and the row shows `100 × 6`. My probe confirms this. The reverse also happens: typing a kg over a reps-only draft drops the reps. The branch's own test (`workout-edit-views.test.ts:+238-250`) writes a kg over a 105 × 7 draft and never checks that the 7 reps are gone. This is the reported bug, now triggered by the newly visible pop-up value, and it breaks rule 2/3 ("Ben's own edits must stick").
- Fix: when `popupCellWrite` writes a pending row's target, fold Ben's other draft fields (`pendingOwnValues`) into the patch, so the result is what he sees with one field changed. The alternative is for `handleEditPlannedSet` to clear only the draft fields the patch touched. Add a test in both directions (reps over a weight draft, weight over a reps draft), checking the table cell and `reconcileDraftEdits`.

**B2. Other surfaces still draw the preset over Ben's saved draft: the rest-screen `Next` card, the lock screen / Live Activity and the next-exercise line.**
- Where: `packages/domain/src/session/set-glance.ts:64` (`restSetsView` → `RestSetBlocks next`, `WorkoutScreen.tsx:1951`), `packages/domain/src/session/lock-screen.ts:58`, `packages/domain/src/session/active-view.ts:753` (`next.target`) and `:1067` (`upNextLine` only uses the draft when the target has no load).
- Scenario: Ben opens set 3, types 105, goes back and logs set 2. During rest, the table row for set 3 reads 105 and the Log label for set 3 reads `Log 105 kg × 8`, but the `Next` card under the timer reads `100 kg × 6–8`, and so does the lock screen (`Target 100 kg × 6–8`, spoken "target 100 kilograms"). My probe confirms this. The rest screen is one of the named edit paths, so this is the same "flick back" on another surface. The developer's report says "every view of a pending set now shows Ben's draft values", which is not true.
- Fix: route these through `shownPlanned(set, ex)` as well. Word them as "your edit", not "Target"/"Coach target", when `pendingOwnValues` is non-empty. Add tests for `restSetsView`, `buildLockScreenContent` and `upNextLine` with a draft.

## Should fix

**S1. `reconcileDraftEdits` treats any `edit_planned_set` as "Ben's own newer target", including ones that don't touch values.**
- Where: `packages/domain/src/session/active-view.ts:157`. The comment says "with values", but the code only checks `set.draft === null && planned.edit.version === set.version`.
- Scenario: Ben types 105 on the open row, then within the 300 ms debounce changes that row's set type (`WorkoutEdits.tsx:300`, patch `{setType}`) or its target RPE or rest from the pop-up. The draft isn't stored yet, so it is still `null`. The reducer keeps the (null) draft, reconcile drops the screen's edits, and 105 flicks back to 100.
- Fix: record in the edit (or detect from `before.planned` vs `planned`) whether values were touched, and drop the edits only then. Add a test.

**S2. A refused draft save is swallowed with no reload, so a stale screen can lose the typed value without any message.**
- Where: `WorkoutScreen.tsx:583` (`void services.workout.dispatch(...)`) and `apps/mobile/src/workout/table.ts:210` (`selectRowFlow` goes on to select after a failed save).
- Scenario: the store moves on for this set without the screen reloading (any write path that doesn't call `reload`). Ben types 105 and the versioned save is refused as `stale_version`. Nothing re-reads, so reconcile never re-bases. He taps another row, `selectRowFlow`'s save is refused again, the select still lands, the edits are cleared (`WorkoutScreen.tsx:519`) and set 2 shows the preset. Before this branch that save would have landed. Rule 5 is met, but the user's value is lost silently.
- Fix: on `stale_version` from either save, `reload()` so that `reconcileDraftEdits` re-bases (or drops) the edits and the save re-sends. In `selectRowFlow`, don't select over a refused draft save until after that reload.

**S3. The screen-wiring tests are string matches on the source.**
- Where: `apps/mobile/test/weight-revert-wiring.test.ts`. They check that certain lines of text exist, not how the screen behaves. Nothing exercises the reconcile → setEdits → debounce → save loop, or the clearing of edits when focus changes, with a timer or race.
- Fix: pull the screen's edit lifecycle into a pure reducer or hook-free helper (edits × incoming data × timer) and test the sequences: coach change mid-debounce, Edit set mid-debounce, row switch within 300 ms, stale save → reload.

## Nits

- **N1.** The middle commit `26669e1` fails its own wiring test (the developer reported this). Squash it or reorder the commits so every commit is green.
- **N2.** In `popupCellWrite`, retyping exactly Ben's drafted value (e.g. 105 over a 105 draft) is a `planned` write with `Set N updated · Undo`, and it drops any reps draft (see B1). Treat a value equal to `shownPlanned` as `unchanged`.
- **N3.** The test count differs from the developer's report (454 files / 8,473 here vs 455 / 8,476). All tests passed here; please confirm which file was extra in the developer's run.
- **N4.** The builder path (`BuilderWorkoutScreen.tsx:98-120`) is unchanged and has no test that Ben's edited load survives a focus `reload` that runs `changeGym` or `reloadPlanDay`. The developer's claim that it "can't overwrite" is plausible for `reloadPlanDay` (silent only when unedited). `changeGym` re-snaps loads on every focus while `gymChanged` is true, which is untested. Add a test, or check it on the device.
- **N5.** Device check not done. Build B steps: type a weight and switch rows; pop-up reps over a typed weight (B1); rest `Next` card and lock screen (B2); coach `edit_today` mid-edit; Edit set; force-close within 300 ms.

## Spec issues

- **SP1 (R3, likely what Ben meant).** active-workout.md §4.2 rule 2 has the target win over "this session's last set". So after Ben logs set 2 at 105 against a 100 preset, set 3 opens at 100 again. That is a literal "keeps flicking back to before", and this branch doesn't change it. It needs Ben's decision: either carry his last logged load onto later sets whose target hasn't changed since Start, or offer `Use 105 for remaining sets` with Undo. Then update §4.2 and add the `session.test.ts` case. Until then, the bug as reported is probably not fixed.
- **SP2.** coach-adjustments.md §4.3 keeps Ben's *whole* draft when the coach changes targets. If he only touched reps, his draft still carries the old load, so the open row shows the pre-coach weight over the coach's new one. Per-field draft ownership (only the fields Ben changed are his) would fix this, and B1's fix moves in the same direction. Ben decides; record it in §4.3.

## Fixes (developer, 21 Oct)

- **B1 fixed (reducer and screen, per field).** `edit_planned_set` now records the value fields it set (`planned.edit.fields`, optional in the schema, so older records still read) and replaces only those in Ben's draft (`draftWithNewTarget`, `pending-values.ts`). His other typed values stay. If nothing of his is left, the draft is cleared, so setting the preset back over a 105 draft still shows 100. `reconcileDraftEdits` does the same for the screen's unsaved edits: the touched fields take the new target and the rest stay. Tests: `weight-revert.test.ts` (B1 block: reps over a weight draft, weight over a reps draft, target equal to his edit) and `workout-edit-views.test.ts` (pop-up writes in both directions, checking the table cell and the pop-up row).
- **B2 fixed.** New `shownTargetShort` (Ben's draft over the target, worded `Your edit 105 kg × 6–8`). It now drives the rest `Next` card (`setGlance`, VoiceOver `your edit`), the lock screen / Live Activity (`line2`; spoken as "your edit 105 kilograms" via `lockScreenTargetWords`), the next-exercise line (`focus.next.target`) and the rest up-next line. Tests cover each one. Kg/lb and convention safety is unchanged: a per-hand draft on a stack row still reads `Target 50`.
- **S1 fixed.** Reconcile drops or replaces only the fields the edit set. A type, target-RPE or rest change touches none, so the typed weight is kept and re-based.
- **S2 fixed.** The debounced save moved into `apps/mobile/src/workout/draft-saver.ts`; a `stale_version` refusal reloads, and reconcile then re-bases and re-saves. `selectRowFlow` takes `rebase`: on a stale draft save it re-reads, saves the re-based edits and only then selects. If the re-read or the second save fails, the row isn't switched and the refusal is shown (not quiet).
- **S3 fixed.** `apps/mobile/test/draft-edits-lifecycle.test.ts` (8 tests, fake timers) drives the screen's wiring (reconcile → edits → saver → `selectRowFlow`) through these sequences: coach change mid-debounce, pop-up reps mid-debounce, set type mid-debounce, Edit set 110 mid-debounce (no stale save back), row switch within 300 ms, stale debounced save → reload → re-save, stale save on a row switch, and a failed re-read. The wiring source test was updated to the new saver.
- **B2 knock-on (for review):** after `Undo` of a logged set, the set is pending again with what Ben logged as its draft (Log already prefilled it, and the table showed it). The lock screen now shows it too: `Your edit 60 kg × 8` instead of `Target 3–6 reps`. `live-activity.test.ts` was updated for this; it still checks the same activity, Ready, no countdown and no second start.
- **N2 fixed.** `popupCellWrite` compares with what the row shows (`shownPlanned`), so retyping Ben's own 105 or 7 is `unchanged`.
- **Not done:** N1 (history not rewritten; the fix commit is green), N4 (builder `changeGym` reload test), N5 (device check). SP1 and SP2 still need Ben's decision; B1's per-field ownership covers the same ground as SP2 for his own edits, but not for coach changes (§4.3 is unchanged).
