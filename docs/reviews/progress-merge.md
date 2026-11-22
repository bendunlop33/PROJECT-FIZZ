# Review: merging main into Progress (`claude/progress`)

Branch `claude/progress` at `85d1644`, the merge of main `c91a724` (delete workouts, session picker, FitNotes import names) into Progress head `68db541`. Main is an ancestor, so `git diff claude/gracious-knuth-joxqpw HEAD` is exactly what merging into main adds.
Spec: `docs/design/progress.md` (v1.0), `docs/design/delete-workouts.md` §5 (DW-D4, DW10–DW19), ADR 0024. Previous reviews: `progress-A*.md`, `progress-B*.md`, `delete-workouts*.md`.
Reviewer: independent. No source code was edited.

## Verdict: **PASS**

The migration numbering is correct and safe on a populated schema-8 database. Every Progress read leaves deleted workouts out. No main feature is lost, and the Progress features are intact. Typecheck, lint and the full test suite are clean. Nothing is blocking. Two should-fix items and four nits are listed below. None of them needs another review round.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx vitest run --testTimeout=180000` | **217 files passed. 4187 tests passed, 1 todo.** This was the first complete run, at load average about 12 on a shared machine. No timing-budget test flaked. |
| Scratch migration probe | A temporary test, deleted after the run, built a populated store: 6 finished workouts, 2 of them deleted and 1 of those purged (tombstone). I copied it into a database migrated to **8** (main's schema) and ran `migrate()`. The result was `{from: 8, applied: [9]}`. The schema dump is identical to a fresh database's, `foreign_key_check` is empty, every exported row is unchanged, `checkIntegrity` is ok, and `listFinishedRevisions` returns only the 4 workouts in history. The deleted one still reads back as `deleted`. |
| CI history | `gh run list --workflow ios-ipa.yml`: the last 30 IPA builds were all on `claude/gracious-knuth-joxqpw`. None was on `claude/progress`, so no phone holds Progress's old "schema 8 = Count it" database (see N2). |

## Checked and fine

- **Migration numbering.** Main's 1–8 are unchanged, and 8 is still `deleted-workouts` (the guarded rebuild). Progress's Count-it columns are now migration 9 (`schema/0009-progress.ts`), two `ALTER TABLE … ADD COLUMN`s, with a pairing CHECK that existing NULL rows satisfy. `assertWellFormed` passes. The 0008 column guard still rejects the Progress columns if they ever came first (`deleted-workouts-edges.test.ts:83`). Migration tests now expect `MIGRATIONS.slice(n)` rather than a hard-coded `[8]`.
- **Backups.** A restore builds at the file's schema and migrates forward (`manager.ts:413`), so a schema-8 backup from main restores into 9. The schema-1 and schema-5 restore fixtures strip the new columns. `progress-duration.test.ts` covers the round trip of `duration_confirmed_at_*`.
- **Deleted workouts in Progress.**
  - `listFinishedRevisions` filters with `inHistorySql()` (`sessions.ts:834`), and `toProgressSession` returns null unless `isInHistory` (`projection.ts:90`).
  - The revision cache is rebuilt from that list on every pass, so a delete drops the workout and a restore re-reads it.
  - The DW19 source scans (`deleted-workouts.test.ts:220`, `:274`) walk `packages/domain/src` and `apps/mobile/src`, including the new `progress/` directories, and pass.
  - `progress-deleted-workouts.test.ts` covers sessions, time in gym, muscle frequency, records, Est. 1RM, the calendar and the Exercises list, plus restore and the case where the home empties.
  - Workout overview `hasHistory` uses main's `pasts`, which is already history-only.
- **Count it vs deletion.** `handleConfirmDuration` refuses any status but `finished`, and it is versioned and idempotent. A Time sheet left open on a workout deleted elsewhere is refused with a message, not applied.
- **Coach.** `isGeneralEntry` covers `today`, `progress` and `progress_exercise` in `sessionOf`, `resolveThread`, `recentActionsScope` and `painChoices`. Main's in-history check in `sessionOf` is kept. `openedFrom` is a frame only and carries no numbers (rule 6).
- **Main features.**
  - Past workouts, Recently deleted, Repeat and the session picker routes are all registered (`AppNavigator.tsx:297–300`).
  - Today and the Workout overview still open Past workouts.
  - The import screens and `import-service.ts` are byte-identical to main.
  - The old `ProgressScreen` was deleted in favour of `screens/progress/ProgressScreen.tsx`. Main's delete Undo toast is ported to both the Progress home and exercise detail.
  - `app-services` wires both `history` and `progress`.
- **Rule 7 and rule 10.** No new credentials or logging. `durationConfirmedAt` is in `sessions` (Your data), and the window and grouping are in the profile (Your data).

## Blocking

None.

## Should fix

**S1. Exercise detail drops the delete Undo toast when the deleted workout was the exercise's last one.**
`apps/mobile/src/screens/progress/ExerciseDetailScreen.tsx:126-135`.
- **Scenario.** Ben opens Bench press history from a Summary (`ExerciseProgress`) or from the Progress tab, taps a point, opens its Summary and deletes the workout. If it was his only Bench press workout:
  1. Summary hands the toast off.
  2. Exercise detail's `useDeleteToast` takes it on focus (`takeDeleteToast` empties the handoff).
  3. The data reload then returns `view === null`.
  4. The early return renders only "No finished workouts with this exercise yet." with no `DeleteToastView`.
- **Result.** The Undo is consumed but never shown, and the only way back is Recently deleted. This is a DW1 miss, and it was introduced by the merge's port of the toast. The error early return at `:119` has the same gap, and so does the loading blank at `:135`, briefly.
- **Fix.** Render the toast overlay in every branch, the way the Progress home does (`ProgressScreen.tsx:206-235`). For example, wrap the three early returns in a container that also renders `{deleted.toast ? <DeleteToastView state={deleted} /> : null}`. Add a view-model or harness test showing that deleting the only workout for an exercise still offers Undo.

**S2. No committed test of a populated schema-8 database migrating to 9.**
`packages/persistence/test/deleted-workouts-edges.test.ts:110` covers 7 → 8 → 9 on a populated database. No committed test starts at **8** (the schema on Ben's phone today) with deleted and purged workouts present. My scratch probe passed, so this is coverage, not a bug.
- **Fix.** Add the same `copyInto(driver, old, 8)` case with a deleted and a purged workout. Assert `applied: [9]`, a schema dump equal to a fresh database's, unchanged rows, a clean integrity check, and that `listFinishedRevisions` leaves the deleted ones out.

## Nits

**N1. Stale "schema 8" comments.** `packages/persistence/test/backup.test.ts:500` and `:608` say "…or schema 8 (Progress's Count it)", and `packages/persistence/test/progress-duration.test.ts:10` says "schema 8 stores `durationConfirmedAt`". All three should say 9. (`drafts.test.ts:470` already says 9.)

**N2. No guard against a database from a pre-merge Progress build.** Before the merge, Progress's Count it was migration 8 (`6a8fb10`). If a device ever ran a `claude/progress` IPA, its database is at user_version 8 with `duration_confirmed_at_*` and without the deleted-workouts columns. This build would then run migration 9, and the duplicate-column error would stop launch. CI history shows no such build, so this is a nit. Before any branch build reaches the phone, either confirm that this can't happen or give migration 9 a check like 0008's that names the problem.

**N3. Old Progress's "imported, not listed" link is gone from Progress.** Main's placeholder Progress screen linked to Past imports when imported workouts weren't listed. The new Progress home doesn't, but the same line is still on Past workouts (`PastWorkoutsScreen.tsx:75`). This is intended by progress.md, so it's only noted here.

**N4. The `ExerciseDetailParams.sessionId` opening for a since-deleted workout isn't tested.** This would be a home record or calendar entry whose workout is deleted while detail is open. The service falls back to the default series, because the session is absent from `ctx.sessions`. That looks correct, but no test covers it.

## Spec issues

None found in this merge.
