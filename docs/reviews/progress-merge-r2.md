# Review r2: merging main into Progress (`claude/progress`)

Branch `claude/progress` at `638942c`. That is the merge `85d1644` (main `c91a724` into Progress), plus the two fixes from `progress-merge.md`:
- `b302276`: the delete Undo toast now shows in every state of Exercise detail (S1).
- `638942c`: a test of migration 9 on a populated schema-8 database (S2).

Main (`claude/gracious-knuth-joxqpw`) is an ancestor, so `git diff claude/gracious-knuth-joxqpw HEAD` is exactly what the merge adds.
Spec: `docs/design/progress.md` v1.0, `docs/design/delete-workouts.md` §5 (DW10–DW19), ADR 0024. Previous round: `progress-merge.md`.
Reviewer: independent. I edited no source code.

## Verdict: **PASS**

Both should-fix items from r1 are fixed and tested. I re-checked migration safety, the deleted-workout exclusion in Progress reads, main's features and Progress's features. Typecheck, lint and the full suite are clean. Nothing is blocking. Four nits remain, and none of them needs another round.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean (exit 0) |
| `npm run lint` | clean (exit 0) |
| `npx vitest run --testTimeout=180000` | **217 files passed. 4190 tests passed, 1 todo.** That is 3 more than r1: the two S1 tests and the S2 test. The suite passed on the first complete run, with another worktree's suite running at the same time. No timing test flaked. |
| CI history | `gh run list --workflow ios-ipa.yml --limit 50`: all 50 builds are on `claude/gracious-knuth-joxqpw`. None is on `claude/progress`, so N2 below is still only a nit. |

## r1 findings, re-checked

**S1 (fixed).** `ExerciseDetailScreen.tsx:120-153`.
- The toast overlay is now built once, before the first early return. The error, empty ("No finished workouts with this exercise yet.") and loading branches each render `{deleteToast}`, and so does the normal chart layout (`:509`).
- All hooks (`useDeleteToast`, `useState`, `useScreenData`, effects) still run before any early return, so the hook order is unchanged.
- After Undo, `useDeleteToast` calls `changed()`. That bumps the app version, and `useScreenData` reloads on focus with `version` in its dependencies. The empty state then returns to the chart. `selectedId` still names the restored workout, so the panel reopens on it.
- Tests (`apps/mobile/test/progress-deleted-workouts.test.ts:111-140`):
  - A service-level case: deleting the exercise's only workout makes `exerciseDetail` return `view: null`, and Restore brings back an identical view.
  - A source scan: exactly one `<DeleteToastView`, and `{deleteToast}` appears in every render branch.

**S2 (fixed).** `packages/persistence/test/deleted-workouts-edges.test.ts:145-189`.
- Fixture: a mixed store (finished, active, discarded, imported and reverted workouts) with one workout deleted and one purged. It is copied into a database migrated to **8**. `copyInto` inserts only the columns that exist at 8.
- Asserted results:
  - `migrate()` applies only `[9]`.
  - The schema dump equals a fresh database's.
  - `foreign_key_check` is empty and `integrity_check` is ok.
  - Every table's rows are unchanged, `checkIntegrity` passes, and the record counts match.
  - `listFinishedRevisions` returns the 6 workouts in history and leaves out both the deleted and the purged ones.
  - Recently deleted lists only the deleted one, and `isPurged` is true for the purged one.
- This is what my r1 scratch probe checked, now committed.

## Checked again and fine

- **Migration numbering.** Main's 1–8 are unchanged, and 8 is still the guarded `deleted-workouts` rebuild. Progress is migration 9 (`schema/0009-progress.ts`): two `ADD COLUMN`s, with a pairing CHECK that existing NULL rows satisfy. 0008's unknown-column guard is still tested (`deleted-workouts-edges.test.ts:83`).
- **Deleted workouts in every Progress read.** `progress-service.ts` reads sessions in only two places:
  - `listFinishedRevisions`, which filters with `inHistorySql()` (`sessions.ts:834`).
  - `sessions.get(ref.id)` for the ids that list returns. `toProgressSession` returns null for anything not in history (`projection.ts:90`), so a workout deleted between the two reads drops out.
  The cache is rebuilt from the list on every pass. The DW19 source scans cover the new `progress/` directories.
- **Count it vs delete/restore.** `planDeleteWorkouts` and `planRestoreWorkouts` (`packages/domain/src/session/deletion.ts:169-190`) spread the session. `writeAggregate` and `sessionRow` write `duration_confirmed_at_*`, so a confirmed duration survives delete and Undo. `confirm_session_duration` refuses any status but `finished`.
- **Main features kept.**
  - The only file deleted is the old placeholder `screens/ProgressScreen.tsx`, which `screens/progress/ProgressScreen.tsx` replaces.
  - Past workouts, Recently deleted, Repeat and the session picker are still registered in `AppNavigator.tsx`.
  - The Summary and Workout overview changes only add the exercise-history entry and `editTimes`.
  - `app-services` wires `history` and `progress` side by side.
  - The import screens and the import service are unchanged from main.
- **Progress features.** The home, Muscles, Exercises and Exercise detail stack is in place. So are the `ExerciseProgress` modal, the prewarm at startup and after a finished workout, and the serialised versioned profile writes for window and grouping. The Progress suites (domain, persistence, mobile, perf) all pass.
- **Rules 7 and 10.** No credentials, secrets or new logging. `durationConfirmedAt` (sessions) and the Progress settings (profile) are Your data.

## Blocking

None.

## Should fix

None.

## Nits

**N1. Stale "schema 8" comments (carried from r1 N1).**
- Where: `packages/persistence/test/backup.test.ts:500` and `:608` ("…or schema 8 (Progress's Count it)"), and `packages/persistence/test/progress-duration.test.ts:10` ("schema 8 stores `durationConfirmedAt`").
- Fix: all three should say 9.

**N2. No guard for a database from a pre-merge Progress build (carried from r1 N2).**
- Scenario: a device that ran a `claude/progress` IPA from before `85d1644` would be at user_version 8, with the Count-it columns and without the deleted-workouts columns.
- Result: 0008's guard is skipped because the database is already at 8. Migration 9's `ADD COLUMN` would then fail with a duplicate-column error and stop launch.
- Risk: CI shows no such build ever existed, so the risk is theoretical.
- Fix: before any branch IPA reaches the phone, either keep it that way or add a 0008-style check to 9 that names the problem.

**N3. The S1 screen test is a source scan.**
- Where: `progress-deleted-workouts.test.ts:128-139`. It splits the source text on `if (` / `return (`.
- Problem: it proves `{deleteToast}` is present in the text, not that it renders. A reformat could break the test, or let a wrong branch pass.
- Context: there is no React Native render harness in the repo, so this is acceptable for now. A render test would be the better fix once one exists.

**N4. Two edges are correct but untested.**
- **Count it across delete and restore.** A confirmed duration should still count in Time in gym after a delete followed by Undo. The spread in `deletion.ts` keeps it, but no test covers it.
- **A `sessionId` for a since-deleted workout (r1 N4).** This is `ExerciseDetailParams.sessionId` pointing at a workout that has since been deleted. The service falls back to the default series, but no test covers it.

## Spec issues

None found.
