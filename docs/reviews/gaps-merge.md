# Review: merging main into workout gaps (`claude/gaps`)

Branch `claude/gaps` at `90c59ae`. This is the merge of main `741b72d` (coach fallback and target RPE, session picker, delete workouts, Progress, import names) into gaps head `cad1967` (gaps r3 PASS).
Main's tip `claude/gracious-knuth-joxqpw` is `20dabb2`, one commit past the merge base. That commit only touches `docs/device-tests/test-build-2026-10-10.md`, so `git diff claude/gracious-knuth-joxqpw HEAD` is what the merge adds, minus that doc line.
Spec: `docs/design/active-workout.md`, `exercise-library.md` §4.6 and EL4, `coach-adjustments.md` §4.8, `delete-workouts.md` §5, `progress.md` v1.0, and brief CHANGELOG 2026-10-11 (target RPE). Previous rounds: `gaps.md`, `gaps-r2.md`, `gaps-r3.md`, `progress-merge-r2.md`, `target-rpe-r3.md`.
Reviewer: independent. I edited no source code.

## Verdict: **PASS**

- **Migrations.** Numbering is correct and the in-place upgrade is safe.
- **Nothing lost.** No feature from either side is lost.
- **Deleted workouts.** Every history read the gaps code uses leaves deleted workouts out.
- **Target RPE.** It is applied consistently across swap, Undo, Edit set and the coach context.
- **Checks.** Typecheck, lint and the full suite are clean.

Nothing is blocking. There is one should-fix (cross-feature: Progress doesn't know distance sets exist), plus a few nits and two spec issues. None of them needs another review round.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean (exit 0) |
| `npm run lint` | clean (exit 0) |
| `npx vitest run --testTimeout=180000` | **231 files passed. 4406 tests passed, 1 todo.** This was the first complete run. No timing-budget test flaked. |

## Checks

### 1. Migration 10: numbering and in-place safety

- **Migrations 8 and 9 match main exactly.** `git diff claude/gracious-knuth-joxqpw HEAD -- packages/persistence/src/schema/0008* 0009*` is empty. The gaps branch's empty placeholders `reserved-delete-workouts` and `reserved-workout-library` are gone from `migrations.ts`, and so is the MERGE NOTE. `MIGRATIONS` is 1…10 in order.
- **Migration 10 is ALTERs only** (`0010-workout-gaps.ts:22-29`), on `session_exercises` and `session_sets`. It doesn't touch the `sessions` table that migration 8 rebuilds, so migration 8's frozen-column guard (`SESSIONS_V7_COLUMNS`, `UnexpectedSessionsColumnsError`) and its triggers are not affected. Every new column is nullable, and each CHECK allows NULL, so existing rows pass. The two CHECKs that reference other columns (`measures_distance … measurement = 'reps'`, `actual_distance_m … has_actual = 1`) are valid in SQLite on ADD COLUMN.
- **New test** `deleted-workouts-edges.test.ts:191-240`. It builds a populated schema-9 database with deleted, purged and Count-it workouts. Results:
  - Only `[10]` is applied.
  - The schema dump equals a fresh database's.
  - `foreign_key_check` is empty and `integrity_check` is ok.
  - Every row is unchanged, and the new columns are NULL on old rows.
  - The deleted and purged state and `durationConfirmedAt` survive.
  - A `set_note` lands in the new column.
- **Existing paths updated.** The 7→latest and 8→latest tests now expect `[8, 9, 10]` and `[9, 10]`.
- **Placeholder guard.** `release-migrations.test.ts` runs in the everyday suite and in `ios-ipa.yml:86`.
- **No placeholder build shipped.** No commit on the gaps side of the merge base carries `[ios-build]`. So no phone can hold a database at version 10 with the empty 8 and 9. If a backup like that existed, `checkBackupShape` would refuse it on column mismatch rather than load it.

### 2. No feature lost on either side

- **Files.** No file from either parent is missing in HEAD. The only `D` against `cad1967` is `apps/mobile/src/screens/ProgressScreen.tsx`, which main moved to `screens/progress/`.
- **Changed lines.** I checked line by line for the 26 files both sides changed: every line either parent added is present in HEAD, or is replaced by a combined line that keeps both intents. Examples:
  - The reducer's finished-workout allowlist now has `confirm_session_duration`, `set_note` and `undoesCorrection` (`reducer.ts:2058`).
  - `describe`'s title keeps main's `EMPTY_WORKOUT_TITLE` and uses `liveExercises` (`workout-services.ts:2193`).
  - `buildSetEditView` takes main's options object, which now also carries `setType` (`active-view.ts:859-913`).
  - The exercise menu has both sets of actions, in the order the commit message gives (`exercise-menu.test.ts:72-76`).
  - The `correct_set` patch type carries both `setType` and `targetRpe` (`workout-services.ts:1697`).
- **Docs.** They merged cleanly: CHANGELOG, coach-adjustments, delete-workouts and progress come from main, and active-workout and exercise-library come from gaps.

### 3. Deleted workouts excluded

- **Persistence.** Every history query in `sessions.ts` (`:669-887`) goes through `inHistorySql`. The gaps code reaches history only through those queries: `historyFor`, `lastUsedFor`, `swapCandidates` (`workout-services.ts:1929-1990`), `listFinishedRefs` and Repeat. So swap candidates, `Last` and `lastUsedHere` never draw on a deleted workout.
- **Other readers.** `time-left.ts` now imports `isInHistory` (merged). `toProgressSession` returns null for anything not in history.
- **Removed rows.** These are the gaps side's own data. The coach's `workoutView` filters them out (`context.ts:173-175`). Summary and Progress count only rows with sets that are not deleted, so a removed row contributes nothing.

### 4. Target RPE applied consistently

- **Swap.**
  - The reducer strips `rpeOverride` from every substitute set (`reducer.ts`, `withRpeOverride(x.planned, undefined)`), and so does `buildSwapExerciseCommand` (`mid-swap.ts`). A forged command can't carry an override; this is tested.
  - Ben's override stays on the replaced sets, which become tombstones. `restoreAudited` brings them back on Undo swap with the override intact; this is tested.
  - The substitute gets its target from its own plan, the coach, or the rule. `ruleTargetRpes` covers it because `load()` re-reads `exerciseInfo` after the swap reload (`WorkoutScreen.tsx:807`), and the coach's `ruleRpesOf` reads fresh.
- **Undo of a correction.** `snapshot()` records `targetRpe` (`reducer.ts:205`). Undo puts it back only when the correction changed it (`reducer.ts:1722`). Tested.
- **Edit set.**
  - The target RPE row follows the edited type (`active-view.ts:888-892`). The reducer clears the override when the type becomes warm-up or drop (`reducer.ts:555-575`). Tested.
  - F4 re-runs the offer check on a type change (`EditSetScreen.tsx:123`).
  - Edit set and Delete set return with `returnToWorkout`.
- **Coach.** The coach context, `adjust_pending_sets` and the offer check all resolve through `targetRpeOf` with the same rule map.

## Blocking

None.

## Should fix (non-blocking)

**S1. Progress ignores distance sets: a sled push or carry logs fine but shows no data in Progress, under a wrong series label.**
`packages/domain/src/progress/projection.ts:93-108`, `packages/domain/src/progress/exercise.ts:62, 65-71, 195`.
Gaps added `measurement: 'distance'`, and main's Progress was written without it. Neither side's tests cross the two.
- The cause:
  - `ProgressSet` has no `distanceM`, so the metres are dropped in the projection.
  - `seriesIdOf` files a distance series under `'reps'`.
  - `seriesKind` gives `added_bodyweight` for a sled push logged with `added` and no equipment, so the label reads `BW + …`. It gives `load` (with e1RM and volume) for one logged with `total`.
  - Every metric needs `reps ≥ 1` (`exercise.ts:195`, `:254`).
- Failure: Ben logs Sled push 40 kg × 25 m three times. It appears in Progress → Exercises, but no metric in its detail has a single point (all need reps), and the series is labelled as weighted-bodyweight or e1RM. This is from reading the code, not run on a device. The muscle-frequency hard-set counts do include those sets, so the two views disagree.
- Nothing is invented, so rule 6 holds. But this is a feature that silently doesn't reach Progress.
- Fix: carry `distanceM` in `ProgressSet`, and give distance its own series kind (`distance`, with a metric such as longest distance or distance at load), or leave distance series out of the Exercises list until there is one. Add a projection and series test with a distance set. See spec issue 1.

## Nits

- **N1.** Summary title and Past workouts title disagree after a remove or swap. `workout-services.ts:2043-2070` builds `exerciseInfo` from every row, removed ones included, and titles the Summary with `deriveWorkoutTitle(Object.values(exerciseInfo))`. Past workouts and the picker use `liveExercises` (`:2193`, `:2900`). Example: Squat added by mistake and removed, then Bench done. The Summary says `Full body` and Past workouts says `Push`. This was already on the gaps side (`cad1967`), but the merge commit message says removed rows are left out of titles. Fix: loop over `liveExercises(aggregate.exercises)` for `exerciseInfo` and for the `length > 0` guard.
- **N2.** The empty-title fallbacks are inconsistent. At `workout-services.ts:1613` and `:2900` the guard is `aggregate.exercises.length > 0`, but the title uses `liveExercises`. When every row was removed, `titleFor([])` gives `Workout`, while `describe` (`:2193`) gives `Empty workout`. Use the live count in the guard.
- **N3.** Undo of a correction can change a finished workout's target RPE. `handleCorrectSet` refuses `targetRpe` on a finished workout (review target-rpe r2 N2), but `undo_op` of a correction is allowed after Finish (`reducer.ts:2055-2058`) and restores `before.targetRpe` (`:1722`). Example: during the workout Ben corrects a set and sets RPE 10, finishes, then taps that correction's Undo if it is still offered. The finished set's target RPE goes back to none. Likewise, a type change to warm-up on a finished workout clears the override (`:557`). Both are coherent, but they contradict the stated "a finished workout keeps its targets". Either restore only `actual`, type and exclusions when `status !== 'active'`, or reword the rule.
- **N4.** Today-scope target RPE and Undo swap. `set_target_rpe` with scope `today`, applied after a swap, covers only live pending sets. If Ben then taps Undo swap, the original sets come back with their older override (or none), not the today value he chose after the swap. This is a rare edge case. Either document it, or re-apply the latest today-scope value on restore.

## Spec issues

1. **`progress.md` v1.0 has no distance measurement.** Its series kinds (§6.3) are load, assisted, added bodyweight, bodyweight and timed. Distance sets were approved for workout gaps (backlog §4.1) after it was written. Ben needs to decide what Progress shows for distance work (S1).
2. **The swap and target RPE rule exists only in the merge commit message.** The rule: the substitute takes its own target, Ben's override stays on the replaced sets and comes back with Undo. `coach-adjustments.md` §4.8 covers added exercises only, and `active-workout.md` and `exercise-library.md` EL4 don't mention target RPE. Add one line to EL4 (or §4.8) so the next change doesn't undo it.
