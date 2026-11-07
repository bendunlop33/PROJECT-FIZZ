# Review: workout-table-v3 §7 "Same editing as the builder" — data-integrity lens

- Branch: `claude/wo-v3b-21oct` (f8220ad..a434299, 7 commits)
- Reviewer lens: rules 2, 4, 5, 9; superset unlink with done sets; reorder of started rounds; Undo across force-close; rest timer / untick / fit-to-time interplay; history kept on remove.
- Date: 21 Oct 2026

## Verdict: **CHANGES NEEDED**

One blocking set-order bug (B1), plus one where the confirm-before-remove does not protect against stale state (B2). The core commands are otherwise sound: `reorder_sets`, `add_warmup`, `set_rest_after` by type and `remove_exercise` with `confirmedLoggedSets` refuse stale versions, ignore duplicate opIds, never touch a completed set's values or version, and Undo survives a JSON reload.

## What I ran

- `npm run typecheck`: clean.
- Targeted vitest (`workout-edits`, `builder-v3-draft`, `workout-edit-views`, `workout-edit-service`, `workout-edit-wiring`, `exercise-menu`, `builder-screens`, `workout-inline-entry`, `workout-keyboard`): 9 files, 141 passed.
- All of `packages/domain/test/`: 148 files, 3129 passed.
- I wrote temporary probe tests (`packages/domain/test/zz-probe.test.ts`, now deleted) for: a warm-up added in a superset, remove-rest on a superset member, an onto-drop past a started round, a reorder around an out-of-order logged set, an `add_warmup` retry with the same opId, untick after remove-rest then Undo, and reorder idempotency. B1 and S1 come from these probes. The rest behaved correctly.
- I did not run lint, `check:migrations` or the full suite. The developer reports them clean, but before a434299 for the full suite.

## Blocking

### B1. `＋ Warm-up` on a superset member breaks the superset's round pairing
`packages/domain/src/session/workout-edits.ts:247-285` (`addWarmupCommand`, no superset check), `packages/domain/src/session/reducer.ts:2055-2105` (`handleAddWarmup`), and the pairing itself at `packages/domain/src/session/order.ts:53,127` (`roundUnits` counts a warm-up as a round).

**Scenario (probe, start fixture):** superset A is Cable row ×2 and Face pull ×2. Open the Cable row pop-up and tap `＋ Warm-up`. The reducer adds a 25 kg stack warm-up, and the execution order becomes:
`Row warm-up 25 → Face 20 → Row 50 → Face 20 → Row 50 (alone)`
It used to be `Row 50 → Face 20 → Row 50 → Face 20`. Every round is now off by one: the warm-up pairs with Face's first working set, and Row's last working set runs on its own. The round page, the rest after each round and the "next" cue all follow this wrong order. Since the warm-up also becomes the active set (`reducer.ts:2098-2101`), it happens straight away. `canAddWarmup` in the pop-up (`apps/mobile/src/workout/exercise-popup.ts:119`) offers the button for superset members.

**Fix:** either (a) refuse `add_warmup` and set `canAddWarmup: false` when the row has `supersetGroup !== null` (simplest; give the refusal its own `POPUP_REFUSAL` text), or (b) make `roundUnits` put warm-ups before round 1 so they don't count as rounds, and test that the pairing is unchanged. Add a reducer test with the superset fixture that checks `buildExecutionOrder` after the warm-up.

### B2. Remove with logged sets: the confirmation is recomputed at tap time, so it can't go stale
`apps/mobile/src/screens/workout/WorkoutEdits.tsx:189-202`

The Alert says "Keeps N logged sets" using a count from `current()` when the dialog opens. But `go` calls `removeExerciseCommand(now, …)` again when Ben confirms, which takes `confirmedLoggedSets` and `expectedVersion` from the state at that moment. The reducer check added for this (`reducer.ts`, "Asked about logged sets that are gone since… rule 5") can never fire from the UI, because the command always matches the current state.

**Scenario:** the dialog is open and says "Keeps 2 logged sets". Before Ben confirms, the state changes underneath it: a lock-screen or Live Activity Log, a pending coach apply, or a queued `inTurn` write such as an untick. The command sent then deletes whatever is pending at that point, at the new version, under a count Ben never saw. If the count dropped to 0, it sends a full `remove_exercise` with no confirmation at all.

**Fix:** build the command once, when the dialog opens: `const { command, loggedSets } = removeExerciseCommand(a, …)` with the opId generated then. On confirm, send exactly that command (its `expectedVersion` and `confirmedLoggedSets`), and show the stale refusal if it fails. Add a test: open, change state, confirm → `stale_version`.

## Should fix

### S1. A drop onto another round (superset) can move a round past a started one
`packages/domain/src/session/workout-edits.ts:147-151, 165` (`pairWithCommand` / `dropRoundCommand` with `onto`)

The edge drop and Move up/down refuse to cross a started round (`roundMoveTargets`), but the onto drop has no such check. `link_superset` moves the lagging side so it sits right after the leading side.

**Scenario (probe):** Bench is not started, the superset Row+Face is started (Ben swiped ahead and logged Row 1), and Dead hang is not started. Ben drags Dead hang onto Bench. Rounds go from `[Bench, Row+Face*, Hang]` to `[Bench+Hang, Row+Face*]`: Hang has moved above the started round. That contradicts §7 ("only rounds not yet started move; done ones stay put") and what the same drag's edge drop allows.

**Fix:** in `pairWithCommand`, refuse when the row that moves (the lag side; mirror `supersetLinkSides`, or simply require every round strictly between source and target to be not started) would cross a started round. `canDropRound` then makes the drop spring back.

### S2. Unlink with done rounds rewrites how history groups those rounds
`apps/mobile/src/screens/workout/WorkoutEdits.tsx:178`, `packages/domain/src/session/reducer.ts:2546` (`handleSplitSuperset` clears `supersetGroup` on every member)

§7 says: "A superset with a done set can't be unlinked mid-round (only for the remaining rounds)." The build splits the whole superset. As the developer says (decision 1), rounds already done stop showing as a superset on the round page and in history. The logged numbers are untouched, but the record of how they were done changes after the fact. That matters for rule 2's intent and for a later "save as routine" or Repeat (`session/repeat.ts` reads `supersetGroup`). `supersetMidRound` (`workout-edits.ts:189`) is exported and tested but never called, so the "finishes the round first" behaviour relies only on `activeSetId` staying put.

**Fix:** either record the split at a round boundary, for example a `splitFromRound` on the rows that history and the round view read, or take the spec question to Ben (see Spec issues). At minimum, wire `supersetMidRound` or delete it.

### S3. A superset's "After each round" rest is labelled as a saved default that doesn't exist
`packages/domain/src/session/workout-edits.ts:310` sends `scope: 'exercise'`. `reducer.ts:1545` then labels the rest `"<name> default (yours)"` with `source: 'exercise_default'`. The pop-up goes through `services.workout.dispatch` and not `setRestAfter`, so nothing is saved to the profile. That is correct (today only), but the rest's provenance now says something false (rule 6). Ben's Why? and the source line will say a default exists.

**Fix:** use `scope: 'type'` per set type on the last member, or add a `round` scope labelled `After each round (yours)` with source `set_override`.

### S4. Test gaps on the integrity paths
- No test changes a **logged** set's Type through the pop-up path (`WorkoutEdits.tsx:256-273` → `correct_set { setType }`) and checks that `actual` is byte-identical, that it is audited, and that Undo restores the old type. This is the §7 "label and counting only" promise.
- No SQLite round-trip for `reorder_sets` or `add_warmup` index shifts. The domain "relaunch" uses JSON (`workout-edits.test.ts` `reload`). Reorders change `index` without bumping set versions, so a persistence test should prove the order survives `repos.sessions.get` after a restart.
- No pain-flag test for Add/Swap loads (`workout-edit-service.ts:67-77`, `builderPlan`). Nothing tests that a pain-flagged exercise's builder load stays at or below the pain cap, or that the fallback path (`built === null`) does the same (rule 9).
- No test for B1 or S1 (superset plus warm-up, onto-drop past a started round), and none for B2's stale confirm.

## Nits

- N1. `supersetNextCommand` (`workout-edits.ts:132`) enables "Superset with next" when both rounds are already supersets, or when the result would exceed the builder's 4-member cap. The reducer then refuses ("already in a superset"), or allows more than 4. Check `a.supersetGroup && b.supersetGroup` and `BUILDER_MAX_SUPERSET` in the helper so the button reflects the rule.
- N2. `snapTypedLoadEasier` on an assisted machine past maximum assistance returns `undefined`, which the pop-up shows as `Lighter than this gym can load` (`exercise-popup.ts:183`). For assistance that is the wrong word. Use a convention-aware refusal.
- N3. `add_warmup` steals the active set when Ben had deliberately made a later set of the same exercise current (`reducer.ts:2098-2101`, `active.index >= from`). Consider moving active only when it was the first pending set, matching `reorder_sets`.
- N4. `edit()` / `dropSet` work out the command from `current()` when it runs, not from the state the drag started on (`WorkoutEdits.tsx:132-152`). A drop index computed against the rendered `movable` list can land differently if the list changed. It's low risk because writes are serialised, but the drag could pass the version it rendered and let the reducer refuse.
- N5. `setType` on a logged set ignores `r.duplicate` and always shows the Undo toast (`WorkoutEdits.tsx:272`), unlike `editCell`.
- N6. The full suite wasn't re-run after a434299. Run it once before merging.

## Checked and fine

- `reorder_sets`: only pending, non-companion sets. Pending sets take the slots pending sets held, so done or skipped sets keep their index, values and version. It's versioned, a duplicate opId is a no-op, and Undo is refused once anything moved or was logged. It works after a reload.
- `add_warmup`: the load must be makeable on the row's item (`isLoadAchievable`), and the unit and convention must match. It is never placed before a done set. A retry with the same opId and a new `newSetId` is a duplicate. Undo deletes it only while it is pending.
- `remove_exercise` with logged sets: the logged sets and the row stay (history kept), and the pending sets become audited tombstones. Undo restores them, also after an untick of a logged set. Without `confirmedLoggedSets` it is refused.
- `set_rest_after` by type: pending sets of that type only. Completed sets and the running timer are untouched.
- Round moves: Move up/down and edge drag refuse started or parted rounds and never cross a started one. `move_exercise` moves the whole superset block.
- Pop-up kg on a pending set rounds toward easier and never past the maximum (resistance and assisted). On a logged set it is a versioned `correct_set` with the value as typed, not rounded.
- Fit-to-time Undo after a reorder or warm-up: deleted sets keep their slot (`add_warmup` shifts tombstones too), and `reorder_sets` doesn't bump versions, so fit Undo still applies cleanly.
- Mid-workout rest edits go through `dispatch`, not `setRestAfter`, so nothing is saved beyond today (but see S3).

## Spec issues

- **§7 superset unlink wording.** "A superset with a done set can't be unlinked mid-round (only for the remaining rounds)" can be read two ways. One: the unlink waits for the round boundary, and done rounds stay a superset in history. Two: unlink is allowed, finishes the round, and done rounds are regrouped (what was built). Ben should choose. I'd suggest the first reading: history should show what was done.
- **§7 "press and hold the exercise header, then drag in the round card".** With one round on screen (v3 round page) this drag has nowhere to go. The developer skipped it (decision 2). The spec should drop it, or say it means the Workout sheet only.
- **Warm-ups inside supersets** (B1) aren't covered in either the builder spec or workout-table-v3. The builder can also produce a superset slot with warm-ups, which then hits the same `roundUnits` pairing when the workout starts. The spec should say whether warm-ups in a superset run before round 1 or are allowed at all.
