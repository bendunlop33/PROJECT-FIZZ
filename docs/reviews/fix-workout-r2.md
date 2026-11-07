# Review r2: fix-workout (branch `claude/fix-workout` vs `claude/gracious-knuth-joxqpw`)

**Verdict: PASS** (no blocking findings; two should-fix items below)

Round 1 (`docs/reviews/fix-workout.md`) found B1 (the ordering guard compared `session.version`), S1 (the test relied on a regex tripwire), S2 (a rejected read dropped its side data) and nits N1-N3. Round 2 commits: `7a24af8` (order by `aggregate.revision`, `withCommandResult`), `4d12cf2` (start a routine saved from a split exercise at each gym).

## Checks run

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npx vitest run --testTimeout=120000`: 178 files, 3640 passed, 1 todo, 0 failed

## Does each bug have a test that fails without the fix?

| Bug | Test | Fails without fix? | Root fix? |
|---|---|---|---|
| 1. Save as routine lists a split exercise twice | `packages/domain/test/gym-switch.test.ts` "Save as routine keeps a split exercise as one entry…" | Yes (verified in round 1: length 2 with `routines.ts` reverted). Round 2 adds a start-at-each-gym check (round-1 N2), and it passes | Yes. Walks part roots with `blockSets`, the same as `repeat.ts` |
| 2. A slow reload overwrites a just-logged set | `apps/mobile/test/load-order.test.ts` | Yes. With `load-order.ts` swapped for the round-1 guard (`session.version` and the rest-timer special case), 4 of the 8 tests fail: pause with no rest, work timer start/stop, side data on a rejected read, and command-result merge. The tripwire fails with the screen reverted | Yes. `revision` is bumped by `reduceSession` on every changed command (`reducer.ts:1637`), including the clock catch-up on a rejected command (`:1629`), and `sessions.save` is revision-checked (`persistence/src/sessions.ts:594-596`). Every `setData` in `WorkoutScreen.tsx` now goes through `newerWorkoutData` or `withCommandResult` (lines 153, 425, 497, 642, 696, 1531, 1585, 1597) |
| 3. The unilateral side is lost on minimise or restart | `packages/domain/test/unilateral.test.ts` "the side chosen before logging is saved with the draft" | Yes (verified in round 1) | Yes. No change since round 1 |

Round-1 items: B1 fixed. S1 fixed (behaviour is tested through `withCommandResult`, and the tripwire is now whitespace-tolerant and documented as a tripwire). S2 changed, see S1 below. N1 changed, see N1 below. N2 covered by a test. N3 unchanged and fine.

## Blocking

None.

## Should fix

**S1. A rejected stale read now puts its aggregate-derived fields on top of the newer workout.**
`apps/mobile/src/workout/load-order.ts:19` (`return { ...incoming, aggregate: a }`).
`load()` (`apps/mobile/src/services/workout-services.ts:1504-1531`) derives `gymName` (from `aggregate.session.gymId`), `previous` (keyed by `session_exercise` id), `title` (from the exercises) and `checkIn` from the aggregate it read in that same call. When the incoming read is older by revision, those fields describe the older aggregate, but they are now combined with the newer one.
Failure scenario: a focus or foreground `reload()` (R1) starts, then Ben confirms a gym switch. `applySwitch` waits for its own `reload()` (R2, `WorkoutScreen.tsx:774`), and R2 shows Hotel. R1 resolves after R2: its revision is lower, so the screen keeps R2's aggregate (at Hotel) but takes R1's `gymName` ("Main"). The gym chip (`:1409`), the off-profile warning "Not on X at Main" and the snap note then name the wrong gym until the next reload. The same thing happens after `undoSwitch` (`:792`), and for `previous` and `title` after an exercise is added. In round 1 the whole `current` was kept, so this is a small regression in the opposite direction from the one S2 targeted. The new test (`load-order.test.ts`, "a rejected stale read still brings its fresh side data") asserts this behaviour by checking that `gymName` comes from the stale read.
The window is narrow (two reads in flight, and the older one resolves last), and it is display-only and corrects itself on the next reload, so this is not blocking.
Fix: decide side data by when each read started, not by its revision. For example, keep a `loadSeq` ref that `reload()` captures before its await, and store the sequence with the data. Take the aggregate-derived fields (`gymName`, `previous`, `title`, `checkIn`) together with the aggregate that wins, and take the independent fields (`painFlags`, `painFlagged`, `gymNames`, `effortScale`, `recentPace`) from the read that started last. Alternatively, keep `current` wholesale as round 1 did and accept that a pain-flag change waits for the next reload. Update the test so that it asserts `gymName` follows the winning aggregate.

**S2. The `operation_id_reused` banner tells Ben a saved set was not saved, and retrying can never succeed.**
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:537`.
This error code only happens when the screen shows a set as pending after it has already been logged under the same opId (`log:${set.id}:${undoCount}`) and Ben has changed a value. The set is already stored, so "Set not saved. Try again." is false. A retry sends the same opId with the same new fingerprint, so it fails again. `run()` reloads only on `stale_version` and `write_conflict` (`:500`), so the stale view stays until the next focus or foreground. With the round-2 guard this should now be very rare, which is why it isn't blocking, but the copy shouldn't say something untrue (rule 1 honesty).
Fix: in `run()`, treat `operation_id_reused` like `stale_version` and call `reload()`. For the banner, either show nothing (the reload shows the saved set) or use the shortest true word, for example "Already saved".

## Nits

**N1.** `apps/mobile/src/workout/load-order.ts:30-31`: when `current` is `null` (the reload found no active workout, for example because it was finished or discarded from another path), a late command result for that workout is shown again through `fallback`. This is very unlikely on one device. Return `current` when it is `null` and the workout is no longer active, or leave a comment saying the case is accepted.

**N2.** `packages/domain/test/gym-switch.test.ts` (N2 test): the routine is pinned to `hotelRack` (the last part), and starting it at Main resolves to `mainRack` through the start-time fit. That's correct, and it's good that the test pins it down. The comment "Main's rack holds 32.5" could also say that the Main start goes through substitution, not through the pinned item, so a later reader doesn't take it for pinning.

## Rules 1-10, other flows, copy

- Rule 1 (offline, honest status): unaffected. Everything is local. See S2 for one untrue line of copy that can be reached.
- Rule 2 (completed sets): unchanged since round 1. `save_draft` rejects non-pending sets before handling the side.
- Rule 4 (equipment): the new test shows a routine template held to the Hotel rack's 20 kg maximum. Nothing is extrapolated.
- Rule 5 (idempotent and versioned): opId handling in the reducer is unchanged. The duplicate-log path now shows the saved state without a second haptic, toast or coach check. Ordering uses the stored revision, which is monotonic for each session.
- Rule 9: pain-flag display after `painOutcome` is not blocked by the guard, because a pain-flag write doesn't bump the workout's revision, so the newer read is adopted. See S1 for the opposite ordering.
- Rules 3, 6-8 and 10: not touched.
- Other flows: Summary, Repeat, next-session targets, backup and the import formats are unchanged. No schema or format change in round 2.
- Copy: no new user-facing strings apart from the reused "Set not saved. Try again." (S2).

## Spec issues

None found.
