# Review: Workouts library, slice B (full edit before start), round 3

Branch `claude/workout-library` at `9c27eb2` vs `claude/gracious-knuth-joxqpw`. This round covers the fix commits `9bc6588`, `a57ccce` and `9c27eb2`, made after review r2 (`e2e8316`, `docs/reviews/workout-library-B-r2.md`). I re-checked the rest of slice B wherever a fix touches it.
Spec: `docs/design/overview-today-edits.md` §3 and §11 (TE11–TE17, TE-B1–TE-B14), `routines.md` §A2.5, mockup `docs/design/mockups/workout-library.html`, ADR 0022, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **PASS**

The r2 should-fixes are resolved:
- **S1** is fixed in the domain and tested.
- **S2** is recorded in the spec as built, pending approval.

Nits N1, N2 and N5 are fixed, with unit tests and source checks. N3 and N4 now sit in the spec's open list for Ben. Nothing is blocking.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | **pass**: 203 files, 4019 passed, 1 todo. The 4 new r2 tests also pass when run on their own. |
| Migration | None. The fixes don't touch the schema or SQL. |
| Start paths / preview == Start | The S1 restore lives in `dropUnplanned` (`packages/domain/src/session/today-edits.ts:801-824`). Both `applyTodayEditsToRoutine` (`:867`) and `applyTodayEditsToNext` (`:918`) call it, and every overview, Up next, next-session and Start path plans through those two. No path is left out. |
| Rule 2 / template safety | Not touched. A restored load is a today-only `load` edit, so it never becomes a card line (TE-B8 holds). |
| Rule 5 / idempotency | N2 now retires a write reference to a draft that is gone, so the next write sends the page's version instead of a stale one. Draft writes are still opId-idempotent and version-checked by the service. |
| Offline / AI | No network or provider calls added. |
| Copy | No new strings. |

## Blocking

None.

## Should fix

None.

## Nits

- **N1. The S1 test's scenario can't happen in the app.**
  - **Where:** `packages/domain/test/today-edits-full.test.ts:699-716`.
  - **Problem:** The test is titled and commented as a substitute the app can't plan ("no dumbbells here"). In the app, `todayFor` (`apps/mobile/src/services/workout-services.ts:1491-1499`) leaves a swap without a plan only when the slot or the exercise is gone, because `substituteTargets` always returns a plan.
  - **Effect:** In that case the write path already marks the swap `stale` through `knownExercise` (`workout-services.ts:3013-3018`) and prunes it, so the slot's own load comes back through `resolveTodayEdits` anyway. The `dropUnplanned` restore therefore matters only on reads between the exercise going and the next write. The fix is correct; only the test's framing is wrong.
  - **Fix:** Reword the test to "the substitute exercise was deleted".
- **N2. A restored load's outcome is appended at the end.** In `dropUnplanned` (`today-edits.ts:822`), the restored load's `applied` outcome goes to the end of `outcomes`, not in edit order. Nothing reads outcome order today (`pruneOf` and counts are order-free). Note it only if a consumer starts depending on order.
- **N3. `loadUnchanged` compares against the row at commit time.**
  - **Where:** `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:845`.
  - **Problem:** The check uses `r.editRow` when Ben taps `Set target`, not the row as it was when the keypad opened.
  - **Effect:** If the page re-reads while the keypad is open (for example after a gym switch), an untouched value could be compared against a different fitted value and written. The window is tiny, and the write is still a valid in-frame load of Ben's.
  - **Fix:** Capture the keypad's opening value in the `loadEdit` state and compare against that.

## Spec issues

These are carried from r2 and are now listed in `overview-today-edits.md` "Follow-ups for the PM" items 6–9. They need Ben or the PM to approve them, and then a `docs/brief/CHANGELOG.md` entry if they change the brief:

1. **Draft-conflict toast and card freshness** (§3 table `:179-180`, §11.5 `:473-475`): marked "as built, pending approval".
2. **§11.4 keypad:** the `NumberStepper` sheet is built instead of `WorkoutKeypad`. The `Assist` and minimum or most-assistance note strings are still missing from §11.8.
3. **Typed load on a `HELD` movement** (rule 9): a decision is still needed. Today the typed load replaces the held load and both markers show.
4. **TE-B13 on legacy routines:** built as "drop today-only set counts". Confirm that choice over "convert on first edit".

## Verified r2 fixes

| r2 item | Fix | Test |
|---|---|---|
| S1 | `dropUnplanned` takes `slots` and `edits`. After dropping an unplannable swap, it removes the substitute's load (which waits) and re-applies the latest live load stamped for the slot's base exercise (or unstamped), with an `applied` outcome. | Domain "review r2 S1": 102.5 kg planned on all working sets, `[Ben]` tag and keypad 102.5 total, only the swap pruned, and the DB load not pruned. |
| S2 | Spec §3 table splits a draft-only conflict (`Couldn't save that edit.`) from a plan change (`Targets updated`). §11.5 defines "out of date" as including the draft moving, and covers `Done` closing an unapplied card. Both are marked pending approval. | n/a (docs) |
| N1 | `queuedWriteLive(tappedOn, shownPage, switching)` is checked inside the lane when the queued write's turn comes. A session switch bumps `shownPage`. | Unit test, plus source checks on the in-lane guard and the bump |
| N2 | `writeSeq` and `readSeq` (a WeakMap keyed by page): a read that started after the write and shows no draft, or a different one, retires `wroteDraft`. An earlier read leaves it in place. | Unit cases for expired, replaced, same draft, an earlier read and an unknown read; `nextDraftVersion` then sends null |
| N5 | `loadUnchanged`: `Set target` at the opening value on a row that already has Ben's load writes nothing. A planned row still writes, which is Ben's explicit choice. | Unit test, plus a source check at the call site |
