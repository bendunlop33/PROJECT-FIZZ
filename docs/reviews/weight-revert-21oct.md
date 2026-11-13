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

## Carry forward (commits 211123a, 40ea4d0; reviewer, 21 Oct)

**Verdict: CHANGES NEEDED**

Scope: "last set carries" (Ben, 21 Oct; active-workout.md §4.2 rule 2a). `carriedLoad` is pure, one path, and every display surface uses it. The stored target is untouched on the log path. Restart, duplicate op ID and Undo of the log are covered. Problems: one common UI path (Edit set) writes the carried value into the stored target, and some edge paths turn a carry into "Ben's own" value or drop it.

### Checks run (in /home/user/wt-weight-revert, HEAD 40ea4d0)

- `npm run typecheck`: pass
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: pass
- `npx vitest run --maxWorkers=2`: 458 files, 8,525 passed, 1 todo (matches the developer)
- Probes (a scratch vitest file outside the repo, using the same fixtures as `last-set-carry.test.ts`, with b2 logged at 105 against 100): results are quoted in the findings below.

### Blocking

**CB1. Edit set on a carried row writes the carried load into the stored target, and Save is enabled before anything changes.**
- Where: `packages/domain/src/session/active-view.ts:1392-1395` (`differs(load, p.load, shownLoad)`) and `:1403` (`changed`).
- Probe: `buildPlannedSetEditView(s, b3.id, {})` returns `patch: { load: 105 kg }, changed: true`. With a reps-only change it returns `patch: { load: 105, reps: 6–6 }`.
- Scenario: Ben logs b2 at 105. He opens Edit set on b3 to change its reps, rest or note (or opens it and taps Save, which is already enabled). `edit_planned_set` stores `load: 105` with `fields: ['load', …]`. Three things go wrong:
  - The stored target becomes 105. This breaks the approved rule that the target record (plan adherence, progression history) keeps 100.
  - `benSetLoad` now reads it as Ben's own choice, so Undo of the b2 log, or logging b3 at 100, no longer moves b3 back.
  - The toast says `Set 3 updated · Undo` for a value he never chose.
- The test at `last-set-carry.test.ts:240` sends a hand-built `{ reps }` patch to the reducer. It skips the sheet, so it can't catch this.
- Fix: when the shown load is a carry (no draft load of Ben's), compare the sheet's load only with the carried load. `patch.load` is set only when `load ≠ carried`, so setting 100 back is still a change. Leave the draft-owned path as it is. Test it through `buildPlannedSetEditView`: an untouched sheet gives `changed: false`; reps-only and rest-only edits put no `load` in the patch; after saving, the stored `planned.load` is still 100 and the carry still follows Undo of b2.

### Should fix

**CS1. A carried load saved inside a draft becomes "Your edit" after the carry ends.**
- Where: `packages/domain/src/session/pending-values.ts:39` (draft load compared with `carry ?? p.load`) and `saveDraftCommand` / `handleSaveDraft`, which store the whole value set.
- Probe: b2 logged at 105. Ben adjusts reps on the open b3, and the debounced save stores `{ load: 105, reps: 6 }`. He then undoes b2 (the 105 was a typo). b3 still shows **105**, as `source: 'draft'` / `Your edit`.
- Scenario: the undo meant to remove 105 leaves it on the next set, labelled as his own.
- Fix: record which draft fields Ben actually typed (per-field ownership, the same direction as SP2), or leave the load out of a saved draft when it equals the carry at save time. Test: save a reps-only draft on a carried row, undo the source log, and the row shows 100.

**CS2. If Ben set the logged set's own target himself, the carry is off.**
- Where: `packages/domain/src/session/carry.ts:81-85` compares the logged actual with `logged.planned.load`, and that already includes Ben's `edit_planned_set`.
- Probe: b1 logged at 100. Ben sets b2's target to 105 in Edit set or the pop-up, then logs 105. b3 shows **100**.
- Scenario: this is the same intent as Ben's example (set 2 at 105 against a 100 plan), reached through the pop-up instead of the keypad, and the later sets fall back to the plan. It is the "flicking back" complaint again.
- Fix: compare with the logged set's target before Ben's own load edits (walk `planned.edit` back past entries whose `fields` include `load`), or treat `benSetLoad(logged.planned)` as a carry source. Add the test.

**CS3. Logging off-target flattens a planned ramp, and logging heavier can make a later set lighter.**
- Where: `carry.ts:85` and `:100`. The carry is absolute and replaces every later target.
- Probe: ramp 100 / 102.5 / 105. Ben logs set 1 at 102.5, then set 2 shows 102.5 and set 3 shows **102.5** (plan 105).
- Scenario: he went heavier than planned, and his top ramp set dropped 2.5 kg. The spec line "a planned ramp (100, 102.5, 105) stays" (§4.2 rule 2a) is only true when every set is logged on target. Ben's wording ("start at his logged weight") is literal, so this needs his call (see SPC1).
- Fix (pending Ben): carry only onto sets whose target equals the logged set's original target, or carry the delta. At least add the ramp-off-target test and correct the spec sentence.

**CS4. The reducer and reconcile work out the carry without pain flags, so they can disagree with the screen.**
- Where: `reducer.ts:1250` (`draftAfterTargetEdit`), `reducer.ts:1319` (no-op check), `active-view.ts:164` (`reconcileDraftEdits`). All three call `carriedLoad` without `painFlagged`.
- Scenario: bench has an active pain flag, and b2 is logged at 105. Ben types 105 on b4 himself (the screen shows `Your edit 105`). He then changes only b4's reps in Edit set. The reducer sees a 105 carry, judges the draft as "nothing of his", and clears it. The row drops to 100 and his typed value is silently lost. The no-op check can also misjudge an Edit set back to 100 on a pain-blocked row.
- Fix: in the reducer and reconcile, where pain flags aren't known, never treat a heavier carry as the baseline (call `carriedLoad` as if the movement were flagged). Keeping a draft equal to a carry does no harm either way. Add a test with a flagged movement.

**CS5. Changelog records the developer's own choices as Ben's decision.**
- Where: `docs/brief/CHANGELOG.md`, the 21 Oct "Last set carries" entry, **Bounds**.
- "Drop sets never carry or receive" and "same gym part only" are developer calls (open item 1). Ben named only warm-ups and "same exercise". CLAUDE.md requires Ben to approve brief changes, so mark these two as pending his confirmation, in the changelog and in §4.2 rule 2a.

### Nits

- **CN1.** The Lock Screen and voice pain cache (`apps/mobile/src/workout/pain-flagged.ts`) is set only on `workout.load` while a session is active, and is never cleared. A flag raised mid-rest outside a set (from the coach chat) can let the lock screen or the spoken cue say the heavier carried load until the next reload (developer open item 2). Refresh it from the pain-flag write path as well, or call `setActivePainFlagged` after a pain-flag change.
- **CN2.** No tests for the edit-history fallbacks (developer open item 4): legacy `edit` records without `fields` (`carry.ts:38`), or a fit-to-time `edit_planned_set` stopping the carry. Add one each.
- **CN3.** Carried values read `Your edit` on the lock screen, the `Next` card and in VoiceOver (developer open item 3). That's acceptable under minimal copy, but it's Ben's call (bare value or `Last set`).
- **CN4.** `s.index < set.index` (`carry.ts:78`) decides "later". Confirm that set moves (`setMoveSteps`) renumber `index`. If they don't, a moved set could receive or miss a carry by its old position.
- **CN5.** Still open from the first review: N1, N4, N5 (the device check now also needs the carry: b2 at 105, then the Next card, lock screen, spoken cue, Edit set on b3, Undo of b2, and a force-close with b3 open), and SP2.

### Spec issues

- **SPC1.** Rule 2a carries an absolute load, which conflicts with planned ramps and pyramids (CS3). Ben to choose: the absolute carry as approved, carry only between sets that share the same original target, or carry the delta.
- **SPC2.** "Target unchanged since Start" (Ben's wording) doesn't cover a target Ben changed himself on the *logged* set (CS2). Ben's intent ("set 2 at 105 against a 100 plan") suggests his own target edit should count as the plan for that comparison. Confirm.
- **SPC3.** Drop sets and the gym-part limit (CS5) need Ben's confirmation.
