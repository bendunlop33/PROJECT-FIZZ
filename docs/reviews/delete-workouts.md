VERDICT: CHANGES NEEDED

# Review: Delete workouts (claude/delete-workouts)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/delete-workouts` (5 commits, 54 files). Checked against
`docs/design/delete-workouts.md` (DW-D1 to DW-D6, §2 to §8, checks DW1 to DW33), CLAUDE.md rules 2, 5, 6 and 10, the
minimal-copy convention, ADR 0005 and the new ADR 0024.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: 195 files, 3836 passed, 1 todo, **1 failed**. The failure is
  `apps/mobile/test/app-services.test.ts` "catches up a backup at launch when the last one was cut short". It is
  pre-existing and caused by load, not by this branch:
  - it passes 3 out of 3 times when run on its own on this branch;
  - it fails the same way in a full run of the base `claude/gracious-knuth-joxqpw` (192 files, 1 failed).
  - Its `idle()` helper only polls `backups.isRunning`, so under CPU contention it can check before the launch backup
    has started. See N6.
- Ad hoc checks (a scratch test, run and then removed, so nothing was committed):
  - Migration 8 on a **populated schema-7 database**: 6 finished workouts with sets and audit rows, foreign keys on.
    It applies `[8]`. Every aggregate reads back equal. `PRAGMA foreign_key_check` is empty and `integrity_check` is
    `ok`. `checkIntegrity` passes. The migrated schema (tables, indexes, triggers) equals a fresh database's schema
    exactly.
  - Delete, then purge at day 40: foreign keys are still clean and `checkIntegrity` still passes. A backup is made
    without error.
  - A backup holding one deleted and one purged workout restores both correctly: the deleted one returns as `deleted`,
    and the purged one stays purged (`isPurged` is true).

## What is good

- **Status, not row delete (DW-D1, rule 2).** `planDeleteWorkouts` and `planRestoreWorkouts` (`packages/domain/src/session/deletion.ts`) are pure.
  - They change only `status` and `deletion`, and bump `version` and `revision`.
  - The operation is recorded in `processed_operations` with a fingerprint of the selection. A retry is a duplicate,
    and an op ID reused for a different selection is refused.
  - All-or-nothing on stale input, with a re-check of `revision` inside the transaction (`sessions.ts:792`).
  - DW6, DW7, DW8 and DW9 are tested on real SQLite.
- **One predicate.** `isInHistory` / `inHistorySql` replaces every `status = 'finished'` reader in domain, persistence
  and the app. I grepped every query on `sessions` and `session_sets`. The SQL readers I found all filter through
  `inHistorySql`, or deliberately count more: `appDates`, `startedFrom` and `revertJob`. These cover
  `listFinishedRefs`, `listRepeatableIds`, `listFinishedBetween*`, `latestFinished`, `countRecords`,
  `finishedWorkoutsDigest`, `countDomainsIn` and `countBackup`.
- **Derived-view test.** The "never had it" comparison (`deleted-workouts.test.ts:182`) checks every reader against a
  store that never held the deleted workout, then checks Restore brings the original back.
- **Coach next-session targets** are refused for a deleted source (`coach.ts:456`).
- **Reducer.** It refuses every command on a deleted workout, with an honest message.
- **Purge trigger exception (ADR 0024).** It is narrow and tested:
  - a finished workout's rows, a deleted workout's rows without a tombstone, a tombstone itself, and a purged ID
    written again are all still refused (`deleted-workouts.test.ts:321`);
  - the purge is one transaction, so a force-close leaves all of it or none (DW22).
- **30-day clock.** It ends at the end of the local day and is tested across a clock change. Past it, a workout is
  neither listed nor restorable, even before the purge runs (DW21, tested in the app with a relaunch).
- **Exports and backups.** `My data` leaves out deleted workouts, their child rows and tombstones (DW18). Backups carry
  the deleted state, and the restored workout goes to Recently deleted (DW27).
- **Import undo.** `Undo this import` reverts deleted workouts too and clears their deletion record (DW25).
- **UI copy** is short and matches §7. The one shortening (`Couldn’t delete.`) is flagged in code and in the ADR.

---

## Blocking

### B1. Migration 8 rebuilds `sessions` from a fixed column list, so a column added by an earlier-merged migration is silently dropped

`packages/persistence/src/schema/0008-deleted-workouts.ts:35-80`

**Scenario.** `claude/progress` also claims migration 8 (`0008-progress.ts`). It runs
`ALTER TABLE sessions ADD COLUMN duration_confirmed_at_utc / _tz`.

1. `claude/progress` merges first, and this branch is renumbered to 9, as ADR 0024 itself anticipates.
2. On Ben's phone, `CREATE TABLE _sessions_v7_copy AS SELECT *` copies the new columns.
3. The new `CREATE TABLE sessions (...)` doesn't have them, and the explicit `INSERT ... SELECT` list leaves them out.
4. Every `Count it` confirmation Ben made is deleted. Nothing errors, and integrity passes, because the columns no
   longer exist.

This is silent loss of Your data on the real database. It goes unnoticed unless whoever renumbers remembers to
hand-merge the DDL. ADR 0024 mentions renumbering, but not this hazard.

**Fix.**
- Make the rebuild fail loudly when `sessions` has a column it doesn't know about. For example, before the copy:
  `SELECT RAISE(ABORT, ...)` via a trigger-free guard such as
  `SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('sessions')) <> 26 THEN ... END`, or a TypeScript `up`
  that checks `PRAGMA table_info` against the frozen list and throws.
- Add a test that adds an extra column at schema 7 and expects the migration to refuse.
- Agree the merge order with the PM. Whichever merges second must add the other's columns to the rebuild, or move its
  `ALTER` after the rebuild.

### B2. Several acceptance checks are neither built nor recorded as divergences

ADR 0024 "Divergences" (`docs/decisions/0024-deleted-workouts-and-purge.md:22`) lists purge timing, `Delete now`
while a workout is active, kept coach records, the copy shortening, and DW28. These are also missing, with nothing said
about them:

| Spec | What's missing | Where |
|---|---|---|
| DW3, §2.3 | **Swipe left → `Delete`** on Past workouts rows. There is only a VoiceOver action. | `PastWorkoutsScreen.tsx:188-199`; `Row` has no swipe (`ui/layout.tsx`) |
| §2.5, DW20 | **Swipe → `Restore`** in Recently deleted. There is only a VoiceOver action. | `RecentlyDeletedScreen.tsx:155-167` |
| §2.1, DW24 | **`Select` in an import's workout list.** Only the single-workout `⋯` is built. | `ImportResultsScreen.tsx` (no select mode) |
| §2.6, §3.4, DW30 | **`Delete set` on finished workouts, `restore_set`, and the Edit history `Restore`.** The reducer still refuses `delete_set` on `finished`; `restore_set` doesn't exist. | `reducer.ts:1606-1617` |
| §6.2, DW26 | **Re-import preview line** `3 are in Recently deleted.` `deletedImportDates` is written and tested but never called. Deduplication itself works through `import_rows`. | `imports.ts:206`; `import-service.ts:303-316` |
| §5, DW16, DW33 | **Coach chip** `Deleted workout`, **memory source** `From a deleted workout`, and the **coach/voice decline** `Delete workouts from Past workouts.` | no occurrences in `apps/` or `packages/` |
| §6.5 | **`verifyBackup` / restore preview** "deleted on their own line". `counts.deletedWorkouts` is computed but never shown. | `backup.ts:171`; no UI reads it |

**Scenario.** Ben tries the spec's documented gesture (swipe on a test session) and nothing happens. Or the PM signs
off DW30 believing the set-level delete exists.

**Fix.** Build them, or add each one to ADR 0024's divergence list so the PM and Ben can approve deferring it. DW30
also depends on DW-Q1, which is still open: say so explicitly.

---

## Should fix

### S1. The restore preview counts deleted workouts as live history; DW28 resurrects them silently

`packages/persistence/src/backup/replace.ts:80`

`fingerprints()` skips only `discarded` and `reverted`, so `deleted` workouts count as workouts in "only on this
phone" and "changed on this phone".

**Scenario 1.** Ben deletes 5 test sessions and then restores a backup made before he logged them. The preview reports
5 workouts that will be lost, although they are already in Recently deleted.

**Scenario 2.** He restores a backup made **before** the delete. The workouts come straight back into history, and
the preview only shows a generic "changed" count. DW28's `Keep deleted` isn't built. The ADR records that, but it is
still Ben's DW-Q4 decision.

**Fix.**
- Skip `deleted` in `fingerprints()`, or count it separately.
- Show the "Recently deleted" line the spec asks for.
- Get Ben's answer on DW-Q4 before merge.

### S2. The DW19 guard is blind to negative lists and to `=== 'deleted'` checks

`packages/persistence/test/deleted-workouts.test.ts:219-256`

The regex only catches comparisons with `'finished'`. `replace.ts:80` (S1) got past it, as did
`coach-service.ts:158` (`status === 'deleted' ? null : a`, which still hands a discarded or reverted workout to the
coach) and `history-services.ts:162` (S5).

**Fix.** Extend the pattern to session-status comparisons with `'discarded'`, `'reverted'` and `'deleted'`, keeping an
allow-list with reasons. Route the two app checks through `isInHistory` / `isRestorable`.

### S3. With VoiceOver on, the Undo toast never goes away

`apps/mobile/src/history/useDeleteToast.ts:33-41`

With VoiceOver on, the timer is skipped "until dismissed". But `Toast` (`ui/workout.tsx:401`) has no dismiss control,
and no screen wires `dismiss`.

**Scenario.** Ben deletes a workout from its Summary with VoiceOver on. `Push A · Thu 8 Oct deleted [Undo]` stays on
Today, a tab root that never unmounts, until the next relaunch. A stray activation of it much later restores the
workout.

**Fix.** Give the toast a dismiss affordance: a close button, and `onAccessibilityEscape` / `accessibilityActions`
`dismiss`. Wire `dismiss` on every screen that renders the delete toast.

### S4. A double activation of Restore or Delete reports a false error

`RecentlyDeletedScreen.tsx:76`, `:162` and `PastWorkoutsScreen.tsx:195`

Each call mints a fresh `newUuid()`.

**Scenario.** Ben double-taps `Restore (2)`.
1. The first call restores both workouts.
2. The second, with a new op ID, is stale and sets `No longer available.` under the success toast, then reloads.

The same happens with the VoiceOver `Delete` action in Past workouts, which shows `Changed since you selected…`.

**Fix.** Hold one op ID per intent, as `SummaryScreen` (`deleteOp`) and `DeletedWorkoutView` already do. For example,
use a ref keyed to the target IDs that is reset on success or stale. Rule 5 is the point of op IDs: a duplicate should
come back as a duplicate, not as an error.

### S5. A reverted (or discarded) imported workout offers `Delete workout`

`apps/mobile/src/services/history-services.ts:162` and `ImportedWorkoutScreen.tsx:41`

`presence()` returns `live` for any status that isn't `deleted`.

**Scenario.** After `Undo this import`, Ben opens one of that import's dates. `⋯` → `Delete workout` is offered.
Tapping it is refused as stale (`Changed since you opened it. Check and try again.`), and trying again does the same:
a dead end.

**Fix.** Return `live` only when `isInHistory`, and add a `hidden` kind for reverted or discarded workouts (no menu).

### S6. Missing tests for the edge cases that matter most

The happy paths are well covered. These aren't covered:

- **Populated schema-7 → 8.** I verified it ad hoc (see "Checks run"). Commit a test that mixes active, finished,
  discarded, reverted and imported workouts, compares `schemaDump` with a fresh database, and runs
  `foreign_key_check` and `checkIntegrity`. Add the B1 guard test alongside it.
- **DW13 and DW14.** A coach D21 target is suspended while its source is deleted, and comes back after Restore only if
  the routine hasn't been started since. A target already used in a later workout is unchanged.
- **DW16.** An open coach proposal whose evidence includes the deleted workout is stale on Apply.
- **DW17.** A pain flag raised in the deleted workout still blocks progression.
- **DW29.** `Delete my data` removes deleted workouts and `purged_sessions`; `Reset coaching knowledge` keeps both.
  This goes through the ADR 0023 rebuild, which now copies `purged_sessions` and deletion columns.
- **Purge of a richer workout.** The purge test uses `largeHistory` sessions with no check-in, offers, next-session
  targets or pain flags. Purge one that has all of them and assert that integrity passes and the kept records still
  read.

### S7. ADR 0024 still needs Ben's approval, and it keeps training values after the purge

ADR 0024 is still **Proposed**, and it amends ADR 0005, so it needs Ben's approval before merge. It also keeps the
coach note and next-session targets of a purged workout. §6.4 says the purge removes the "coach note", and the
tombstone principle is "no training values". After a purge, `next_session_targets` still hold loads and reps derived
from the workout, and the summary-turn message keeps its numbers.

**Fix.** Ben decides. If he keeps them, amend §6.4. If not, remove the source's `coach_offers` (already done),
`next_session_targets` rows, and the summary note under the same tombstone exception.

---

## Nits

- **N1.** `purgeDue` keys its op ID on the UTC date (`history-services.ts`, `purge:${now.utc.slice(0, 10)}`). A
  second launch on the same UTC day returns `duplicate` and skips workouts that became due since. They are already
  hidden, so only their bytes linger a day. Key it on the local date, or don't short-circuit when nothing was purged
  under the key.
- **N2.** In Past workouts, if a write fails and Ben then changes the selection, `confirmSelected` reuses `opId`. If
  the first write had in fact committed, every retry gets `operation_id_reused` and shows `Couldn’t delete.`, with no
  way out short of leaving the screen. Reset the op ID when the selection changes.
- **N3.** `applyPlan` reads every item with `readAggregate`. One unreadable workout fails the whole delete with
  `Couldn’t delete.`, so a corrupt workout, which is the one Ben would most want gone, can't be deleted. It isn't
  listed today, so this is low impact.
- **N4.** After a purge, the imported workout's view shows `Nothing came in on this date.`
  (`ImportedWorkoutScreen.tsx:114`) instead of `This workout was deleted.`, because its `import_rows` are gone and no
  session ID is found. `isPurged` can't be reached from there. Look up the tombstone by job and date, or keep the
  date in the tombstone.
- **N5.** The `navigation.setOptions` effect in `ImportedWorkoutScreen.tsx` has no dependency array, so it runs on
  every render.
- **N6.** The pre-existing flaky test `app-services.test.ts:286` fails under full-suite load on both base and branch.
  Make `idle()` wait for the launch backup to start, or await `ensureBackedUp` through a test hook.
- **N7.** §7 lists `Push A · Thu 8 Oct restored [Undo]`, but after the toast's own Undo, the restored toast has no
  Undo (`useDeleteToast.ts:48`). Recently deleted's restore toast does have one.

---

## Spec issues

- **SP1.** The import counts contradict each other.
  - §5 says an import reads `412 workouts · 3 deleted` while deleted and `412 workouts` on Restore, so the total
    includes deleted workouts.
  - §6.2 says that after deleting all of them it reads `0 workouts · 412 deleted`, so the total excludes them.
  - The code follows §5: `writtenDates` counts every status, so it shows `412 workouts · 412 deleted`.
  - Pick one.
- **SP2.** The footnote `Gone 30 days after deleting.` explains a rule in the main UI, which conflicts with the
  minimal-copy convention and with DW32 ("the only explanation is behind ⓘ"). Each row's `Gone on <date>` already
  says it. Suggest dropping the footnote and keeping only the `ⓘ`.
- **SP3.** §3.1 and §7 use `Couldn’t delete. Nothing was changed.`, a reassurance line banned by the minimal-copy
  audit. Update the spec to `Couldn’t delete.`, as built.
- **SP4.** §3.3 `Delete now` while a workout is in progress ("rows go at once and are marked purge-due") and §6.4
  "never while a workout is unfinished" assume a file-rebuild purge. With the transactional purge in ADR 0024, waiting
  isn't needed. Update the spec if Ben approves the ADR.
- **SP5.** DW30 is an acceptance check, but DW-Q1 (allow `delete_set` on finished workouts) is still an open question.
  Mark DW30 as conditional on DW-Q1.
