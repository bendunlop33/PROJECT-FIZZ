VERDICT: CHANGES NEEDED

# Review round 2: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` (8 commits, 43 files), with a focus on the three fix commits
after `docs/reviews/your-data.md` (`3f049ec`, `a3d7c6c`, `df8cf8a`). Checked against `docs/design/data-import-export.md`
§2.6, §2.7, §3.6, §4.5, §4.6 and checks 29a, 30, 31, 31a and 33; `docs/design/profile-and-settings.md` §2.8; CLAUDE.md
rules 5, 7 and 10 and the minimal-copy convention; and ADR 0022 as revised.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 178 files, 3589 passed, 1 todo.

## Round 1 findings

| Round 1 | Status |
|---|---|
| B1 on-phone backups survive Delete | **Fixed.** `wipeOnPhone` deletes every file in the backup folder, recorded or not, resets the manifest and writes one `after_delete` knowledge-only backup. The test searches every modelled container file for the owner ID, gym name, check-in note and record IDs. |
| S1 dishonest `open_failed` after a failed resume | **Fixed.** `delete_unfinished` tells apart `Nothing was deleted` and `Your data is deleted. <step> didn't finish.`, with `Try again` and `Continue`. (See S2 for what `Continue` leaves behind.) |
| S2 prefs written back | **Fixed.** `createPrefsHolder.clear()` ignores a load still in flight, and the screen and launch paths both call it. Tested. |
| S3 late sign-out rewrites settings | **Fixed.** The tokens leave the Keychain first. The revoke only does network I/O. A slow-revoke test proves nothing is written back. |
| S4 no Undo last reset | **Fixed.** Meta migration 3 widens the CHECK. Reset and undo_reset swap places. The row and the done alert offer Undo. Migration test included. |
| S5 tests | **Mostly fixed.** Gaps remain (S4 below). |
| S6 Export scope | **Partly fixed.** `Nothing to export` state done. JSON-only is still waiting on Ben (S5). |
| N1–N5, N7 | Fixed. |
| N6 write window during a switch, N8 Live Activity/AlarmKit/audio | Recorded in ADR 0022 as not built. N6 now matters for Reset (S3). |

## What is good

- Every table is classified, and an unclassified table fails a test against `sqlite_master`. `playbook_candidates` (no
  owner) and owner-less `exercises` are the only Coaching knowledge. Delete leaves both byte-identical (tested at app
  and persistence level).
- The database part of Delete is all or nothing (one meta transaction), and the crash test copies files at every meta
  write. The `swapped` flag means a resume never swaps over data logged after a `Continue`.
- Rule 5: both actions are confirmed against a content stamp and re-checked under the manager lock. They are
  idempotent by op ID: a concurrent double tap and a second op that finishes an earlier pending one are both tested.
- Rule 7: `KEYCHAIN_KEYS` is the single list. A test scans `apps/mobile/src` for SecureStore keys. `wipeKeychain`
  reads back and throws if an item is still there. Reset never touches credentials.
- Rule 10: Reset keeps every Your-data row identical and keeps the knowledge exercises Ben's records refer to.
- Check 33: no coach tool or voice path reaches these actions.
- Copy is short and honest. `Your data isn't touched` and `Coaching knowledge kept` are spec text.

## Blocking

**B1. Copies of Ben's files picked for import or restore survive Delete (check 30, §4.5 step 3 "cached import files").**
`apps/mobile/src/device/files.ts:165` (`pickBackupFile`) and `:189` (`pickCsvFile`) call `File.pickFileAsync`. On iOS
this is `UIDocumentPickerViewController(forOpeningContentTypes:, asCopy: true)`
(`node_modules/expo-file-system/ios/FilePickingUtils.swift:79`), which copies the chosen file into the app's own
`tmp/<bundle>-Inbox`. The code's own comments say so ("iOS hands back a temporary copy"). Nothing deletes that copy:
not the picker, the import or restore flows, `personalFiles.remove` (`Root.tsx:102–107`), or `wipeOnPhone`. ADR 0022's
"Not built" list doesn't mention it.

- Failure scenario: Ben imports his FitNotes CSV (years of sets and notes) and later restores or checks a backup JSON
  picked from Files (every workout, memory, pain flag and check-in). He then taps Delete my data, and the app opens
  first-run. Both full copies are still inside the GymSmarter container until iOS happens to purge `tmp`. They show
  up in a device backup or a container download from Xcode and Finder. This is exactly the "nothing about me is on
  this phone" promise that `DELETE_ALERT` makes.
- Fix:
  - In `pickCsvFile` and `pickBackupFile`, delete `picked.result` right after `text()`, in a `finally`, so the copy
    goes even when the read fails.
  - In Delete's `settings_files` step, also empty the picker's inbox, `tmp` and `Paths.cache`. All of these are
    GymSmarter's own. Tolerate a missing directory, and throw if a file is left.
  - Add `cached import and restore files` to ADR 0022's clean-up list.
  - Extend the harness so `containerFiles()` models a picked-file copy, then assert that `filesHolding(h, personal)`
    is still empty after Delete.

## Should fix

**S1. A rest alert can survive a Delete that is finished at launch (checks 30 and 31).**
`data-domain-service.ts:301` cancels alerts with `restAlerts.reconcile(null, …)`. After a relaunch the controller
knows nothing: `current` is null, and with `state === null`, `known` is null
(`apps/mobile/src/alerts/rest-alerts.ts:96`). So no cancel is issued. `resumeInterrupted` runs before the recovery
reconcile (`startup.ts:89`), so nothing else cancels it either. `reconcile` also swallows notifier errors into
`lastError` (`rest-alerts.ts:108`), so the `alerts` step can never fail. The `Cancelling scheduled alerts` label can
therefore never be shown, even when cancelling really failed.

- Failure scenario: a rest is running. Ben taps Delete, and the app is killed after the swap but before step 4. On
  relaunch the resume finishes and the app shows first-run. The scheduled `Next: Bench press · 100 kg × 6–8 target`
  notification still fires for a workout that no longer exists.
- Fix: give the notifier port a `cancelAllWorkoutAlerts()`. Cancel every scheduled notification with the `fizz.rest.`
  prefix, or all of them, since GymSmarter schedules nothing else. Also clear delivered ones
  (`clearDeliveredWorkoutAlerts` already exists). Call it from the `alerts` step and let it throw.
- Test: schedule an alert, run the delete up to the swap, force-close, relaunch, and assert `h.pending.size === 0`.

**S2. `Continue` after an unfinished delete can leave Ben's data on the phone for good, and the copy says it is
deleted.**
`leaveInterrupted` (`data-domain-service.ts:415`) records the failed step as `unfinished`, but nothing ever reads it.
No row, no retry and no later launch surfaces it. Depending on the step, what stays behind is:

- `database`: the old database file with every record, kept in the `previous` slot with the switch record cleared,
  so no Undo row either.
- `backups`: the old backup files.
- `coach_sign_in`: the Keychain registration, which holds the account email.

Meanwhile `deleteUnfinishedView` (`data-domain-view.ts:107`) says `Your data is deleted.` For `database` and
`backups` that is false in the sense Ben cares about: the data is still on this iPhone (rules 1 and 6, honesty).

- Fix:
  - Make the line depend on the step. For `database` or `backups`, say `Your data is removed from the app. A copy is
    still on this phone.`
  - Surface `unfinished` on Data & backup as one warning line with `Finish deleting`. That action re-runs only the
    remaining clean-up (`forgetPrevious`, `wipeOnPhone` minus new backups, `wipe`), never the swap.
  - Alternatively, keep retrying the leftover clean-up quietly at each launch, since it never touches new data.
- Test: a `leave` after a `backups` failure, followed by a later successful clean-up.

**S3. Reset isn't blocked while a workout is unfinished (DX4), so a set logged during the switch can be lost.**
`resetCoachingKnowledge` (`data-domain-service.ts:426`) has no unfinished-workout check, unlike Restore, Undo restore
and Import. It snapshots every Your-data row under the manager lock, but store writes don't take that lock (round 1
N6). Any write that reaches the old file between the snapshot and the switch is dropped. With a live workout, such a
write is a completed set, which breaks rule 2 and "Your data isn't touched". Undo is also blocked by DX4 until the
workout ends (`ResetKnowledgeScreen.tsx:41`), so the done alert's `Undo` fails at once with `Finish or discard your
workout first`.

- Fix: refuse Reset while a workout is unfinished, with the same block and copy as Restore. It only changes Coaching
  knowledge, so finishing first costs nothing. Alternatively, add the write gate ADR 0022 already lists.
- Test: start a workout, then Reset, and assert `workout_unfinished`.

**S4. Tests still miss parts of this slice.**

- The harness's `containerFiles()` models only backups, the manifest and the ledger. It doesn't model
  `device-prefs.json`, `coach-connection.json`, crash notes, the probe database, picker copies (B1) or leftover
  database files. "No file holds personal strings" therefore covers less than it claims.
- `removeDatabaseFiles` (`expo-sqlite-host.ts`) has no test.
- No test covers the resume path with a scheduled alert (S1), `leave` after a `backups` or `database` failure (S2), or
  Reset during an unfinished workout (S3).
- `finishDelete` when `domainSummary` itself fails after a failed swap (`left === null`, `:279–283`) is untested
  (see N2).

**S5. ADR 0022 is still "Proposed", and Export is JSON-only (§2.6, §4.4).**
The remaining divergences are scope gaps that ADR 0022 records honestly: no CSV or FitNotes 2 CSV, no ranges, and the
folder picker instead of the share sheet. They still need Ben's acceptance before merge, or a tracked follow-up slice.
Get that answer, set the ADR status, and record any brief or spec change in `docs/brief/CHANGELOG.md`.

## Nits

- **N1.** `forgetPreviousNow` (`packages/persistence/src/manager.ts:520`) overwrites `orphan` with `previous`. If
  `replaceCurrent`'s quiet removal of the old rollback file had failed, that file name is dropped from the slots. The
  file then stays on disk untracked with Ben's data. Remove an existing orphan first, or refuse to overwrite one.
- **N2.** After a failed swap, if `domainSummary` also throws (`left === null`), the outcome is `deleted: true` with
  `swapped` still false. Ben is told his data is deleted when nobody knows. Say `Couldn't check whether your data was
  deleted` and keep `Try again`.
- **N3.** `Root.tsx:98` has a stale duplicate comment ("Your-data files outside SQLite: coach connection settings
  and…") above `interruptedDelete`.
- **N4.** When a delete finishes at launch, `signedOutOnline: false` is recorded but never shown. §3.6 puts this line
  on the first-run screen. On the normal path it is an alert before relaunch, which is fine.
- **N5.** `wipeOnPhone` writes the fresh `after_delete` backup inside the `backups` step. If that backup fails it is
  recorded, not thrown, which is right. The status card then shows a failed backup on first run with no explanation.
  Acceptable, but worth a device check.
- **N6.** The Reset list reads `N rules to review removed`. The spec says approved and rejected rules go back to To
  review (see spec issue 2).

## Spec issues

1. **Pre-delete safety net (still open from round 1).** The spec relies on `Save a copy to Files first`, listed first
   when there is no off-phone copy, and the code follows it. Nothing makes Ben take a copy before an irreversible
   delete. Ben should confirm that this is enough, or approve a prompt ("No copy off this phone. Save one first?")
   before the alert.
2. **Reset and playbook candidates.** §2.7 and §3.6 talk about approved and rejected rules going back to To review and
   rule-wording edits being removed. The schema has only `to_review` and `withdrawn`, and no approved rules exist yet,
   so Reset deletes every candidate, including ones Ben stated. The spec should say what Reset does with candidates
   until approval ships.
3. **Custom exercises and aliases (B12).** §2.6 and check 30 treat aliases and custom exercise definitions as
   Coaching knowledge. The code treats owner-scoped `exercise_aliases` and owned `exercises` as Your data, which is
   consistent with the restore preview. Until B12 is decided, the spec should match the code.
4. **§4.5 step 3's "cached import files"** should also name restore and check-a-backup picker copies (B1). Both put a
   full copy of Ben's data in the container.
