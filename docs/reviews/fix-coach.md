VERDICT: CHANGES NEEDED

# Review: coach bug fixes (`claude/fix-coach`)

Reviewer: independent `reviewer` agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/fix-coach`, 7 commits (`d953653`..`adfe622`), one per bug in the coach bug list (7 bugs).

## Summary

- Five of the seven bugs are fixed at the root. Each has a regression test that fails when its fix is removed (checked by mutation; see the table):
  - Bug 1: CA4 offers with coach-sourced targets.
  - Bug 2: Offline that never clears, and the skipped review.
  - Bug 3: a rename drops the coach's targets.
  - Bug 4: Try again.
  - Bug 7: Undo all.
- **One blocker.** The Undo all fix (bug 7) now undoes row by row and never marks the coach's `set_next_session_targets` action as undone. This is a regression. Before this branch, the first Undo all set `undoneBy`. Now the coach sheet's card for that review still says `Applied` and offers Undo after Undo all. Tapping it gives "Couldn't undo: it changed since". That is the same stale live Undo that bug 6 fixed for the workout banner, and it now affects the Summary's main Undo path.
- The UI fixes for bugs 5 and 6 look correct, but no test exercises the wiring. The tests call the new helpers and the store directly, and the store already replayed identical op IDs before this branch. If the screens went back to `newUuid()` op IDs, or the hook's re-read were removed, every test would still pass.
- Minimal copy: no new reassurance or rule-explaining copy. The only new visible strings are the existing `Rule` tag and `Same targets`. The coach's stale target sits behind `Why?`. `minimal-copy.test.ts` passes.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npx vitest run --testTimeout=120000` | Exit 0. 178 files, 3644 passed, 1 todo |
| Mutation: bug 1. `checkOffer` set back to `source === 'coach' ? a.session.version : null` | `RPE 10 on sets 1 and 2 … offers once` fails ✔ |
| Mutation: bug 2a. Offline made sticky again | `Offline clears by itself after a short while` fails ✔ |
| Mutation: bug 2b. `runSummaryTurn` gate set back to `status !== 'ok'` | **All tests pass** ✘ (see S2) |
| Mutation: bug 2c. Skipped run kept in `summaryRuns` | `a review skipped while not connected isn't cached` fails ✔ |
| Mutation: bug 3a. Store commit check set back to `sourceVersion` | `rename while the review is running` fails ✔ |
| Mutation: bug 3b. `withCoachTargets` set back to `sourceVersion` | Both rename tests fail ✔ |
| Mutation: bug 4a. Any summary turn blocks a re-run | `a summary review cut off by a force-close runs again` fails ✔ |
| Mutation: bug 4b. Outcome row input set to null | Both Try again tests fail ✔ |
| Mutation: bug 7. Revert of `adfe622` | The Undo all regression test and the `coach-views` test fail ✔ |
| Bugs 5 and 6 | The UI wiring is not covered (S1) |
| Probe: Undo all, then the sheet card | Throwaway test, deleted afterwards. After `undoNextTargets` the action has `undoneBy: null` and `cardView` shows `Applied` with `canUndo: true`. Calling `coach.undo(actionId, undoOpId(actionId))` returns `not_possible`, "it changed since" (B1) |

The worktree was clean after each mutation (`git checkout -- apps packages`).

## Per-bug verdict

| # | Bug | Root fix? | Test fails without fix? |
|---|---|---|---|
| 1 | CA4 re-offers on coach-sourced sets | Yes. `todayAdjustmentIds` counts only `planned.coach`, which only `adjust_pending_sets` sets. `lastAdjustedVersion` takes the session version from the saved record's `entityVersions` `after`, and skips undone and uncommitted actions (`coach-service.ts` checkOffer, `trigger.ts:166-187`) | Yes |
| 2 | Offline sticks; review skipped and cached | Yes, with a timed lapse (`OFFLINE_HOLD_MS`, `coach-service.ts:148`). The review now runs when Offline. Skipped and failed runs are no longer cached (`:372`, `:388`). The workout re-reads availability on each log | Partly (S2) |
| 3 | A rename or time edit drops the targets | Yes. `nextTargetSourceBasis` hashes the sets' id, status and version. Rename and timing edits don't touch sets (`reducer.ts:888-921`); `correct_set` does. It is used in the store commit, `withCoachTargets`, the overview and the Summary (stale rows show as `Rule`). Older rows fall back to `sourceVersion` | Yes |
| 4 | Try again dead or wrong | Yes. Each outcome row carries its own turn's Ben input. A summary input calls `runSummaryTurn`, which now re-runs a turn that isn't completed | Yes |
| 5 | Double-tap Undo reports a failure | Yes. The op ID is now `undo:${actionId}` (`executors.ts`), and Next-time taps use `next-tap:${id}:${version}:${tap}` | **No** (S1) |
| 6 | Banner keeps a live Undo after the sheet's Undo | Yes. `syncAdjustment` re-reads the record on each workout reload (`WorkoutCoach.tsx:67-80`) | Helper only (S1) |
| 7 | Second Undo all does nothing | Yes for the rows, but it introduced B1 | Yes |

## Blocking

### B1. Undo all leaves the coach's Summary action shown as `Applied`, with an Undo that can't work (regression from `adfe622`)

**Where:** `apps/mobile/src/coach/coach-service.ts:473-484` (`undoNextTargets`) and `apps/mobile/src/screens/workout/SummaryScreen.tsx:465`. Card state comes from `apps/mobile/src/coach/sheet-view.ts:108,129` (`undoneBy`). The store's revert is `packages/persistence/src/coach.ts:526`.

**Failure scenario:**

1. The review saves targets for Bench and Pulldown.
2. Ben taps **Undo all** on the Summary. Both rows go to `undone`.
3. Ben opens Ask the coach from the Summary. The review's card still reads `Applied` with a live Undo.
4. He taps it. `revertIn` finds no `saved` or `applied` rows and returns `changed_since`, so the card shows "Couldn't undo: it changed since."

On the base branch, the first Undo all called `coach.undo(actionId)`, which set `undoneBy`, so the card showed `Undone`. I confirmed this sequence with a throwaway harness test (see the probe row above). This breaks rule 2's Undo promise and the honesty rule: one surface says the change is undone and another says it is applied. Bug 6 was fixed for exactly this pattern.

**Fix:** in `undoNextTargets`, when all the live rows share one `actionId` and that action's `undoneBy` is null, call the store's `undo` with `undoOpId(actionId)`. That reverts every row and marks the action undone in one transaction. Fall back to per-row taps only when the action is already undone (the bug 7 path). Alternatively, make `cardView` for `set_next_session_targets` derive `canUndo` and the status word from whether any of its rows are still live. Add a test: Undo all, then the summary-thread card is `Undone` and `canUndo` is false.

## Should fix

### S1. Bugs 5 and 6: the screen wiring that is the fix isn't tested

**Where:**
- `apps/mobile/test/coach-regressions.test.ts:226-260` calls `s.coach.undo(…, undoOpId(...))` twice. The store's opId replay (`persistence/src/coach.ts` `undo()`, `actionByOp`) already did this on the base branch, so the test proves nothing about the UI.
- `:262-284` tests `syncAdjustment` and `slotView`, not the `useEffect` in `WorkoutCoach.tsx:67-80`.

**Failure scenario:** someone puts `newUuid()` back into `WorkoutCoach.tsx`'s `undo`, `CoachSheetScreen.tsx:232` or `SummaryScreen.tsx` `tapNext`, or drops the re-read effect. Every test still passes, and the double-tap bug is back.

**Fix:** add source checks in the style of `workout-overview-screen.test.ts`:
- The three Undo and tap call sites use `undoOpId` or `nextTargetTapOpId`, and no `newUuid()` is passed as an undo or tap op ID.
- `WorkoutCoach.tsx` calls `syncAdjustment` in an effect that depends on `workout`.

### S2. "The review runs when Offline" is not tested

**Where:** `apps/mobile/test/coach-regressions.test.ts:69-83`. `logWorkout` advances the clock past `OFFLINE_HOLD_MS` before `runSummaryTurn`, so the status is already `ok`.

**Failure scenario:** putting the gate at `coach-service.ts:372` back to `a.status !== 'ok'` passes every test. A finish within a minute of a dropped request would then skip the review again. That case is the original bug 2 scenario.

**Fix:** in that test, call `runSummaryTurn` while `availability()` is still `offline` (assert that first), and expect the model to be called.

### S3. Undo all isn't atomic; a partial failure says "Couldn't undo." after some rows were undone

**Where:** `coach-service.ts:473-484` and `SummaryScreen.tsx:465-471`.

**Failure scenario:** with two live rows, the second row's write fails (`changed_since` from a race, or a SQLite error). The first row is already `undone`, but the toast says "Couldn't undo." Ben then sees one row undone, one not, and a failure message.

**Fix:** do the rows in one store transaction (this falls out of the B1 fix when the action-level undo is used). Otherwise, report the result per row and only toast when nothing changed.

## Nits

### N1. A summary Try again that can't run gives no feedback

**Where:** `CoachSheetScreen.tsx:217-231`.

**Scenario:** if the coach is `not_connected`, the live row flashes and disappears, and nothing says why. Pre-existing banners probably cover it. Consider showing the same status line `send` would show.

### N2. A retried summary turn can overwrite Ben's choices on rows from the failed attempt

**Scenario:** a summary turn commits targets and then fails (for example, the network drops before the reply). Ben undoes a row, then taps Try again. The new review's commit rewrites the rows to `saved` (`persistence/src/coach.ts`, `next_session_targets`), and the first action's card can no longer revert them (`changed_since`). This is rare and only follows Ben's explicit retry. Worth a comment, or skipping rows Ben has touched.

### N3. The overview preview isn't tested after a rename

The rename tests cover `start` only. `overviewCoachOf` (`overview.ts:632`) and `workout-services.ts:2388` now pass `sourceBasis`, but no test renames and then builds the overview. Add one assertion to the rename test.

### N4. `offerAfterLog` now reads the keychain-backed connection on every log

**Where:** `WorkoutCoach.tsx:136-140`.

This runs off the logging path, so it is harmless. If it ever shows up in profiling, cache it for a few seconds.

## Rules check

| Rule | Result |
|---|---|
| 1 | Logging is untouched. Offline status now lapses (see Spec issues). |
| 2 | B1 is the only finding. |
| 3 | Bug 1's fix restores "never adjusts constantly". |
| 4, 9 | No change to snapping or pain gating. `withCoachTargets` still checks `painToday` and flagged exercises before the basis. |
| 5 | Op IDs are deterministic per intent. Stale writes are still refused, now on a content basis that a correction still invalidates. `sourceVersion` is kept for old rows. |
| 6 | Stale coach rows now show the rule's target, which removes the rename dishonesty. |
| 7, 8, 10 | Nothing touched. |

No secrets, and no new logging of health data.

## Spec issues

- **`docs/design/coach-sheet.md:302`, the Offline banner "clears by itself when the network returns".** The app has no reachability source (no NetInfo). The fix assumes the network is back 60 s after the last failure, so for up to a minute the status can read `Offline` while the network is fine. After that it can read `ok` while the network is still down, until the next request fails. That is a reasonable stand-in, but it doesn't match the spec. Ben or the designer should either accept a timed lapse in the spec or approve adding a reachability module (an ADR for the dependency).
