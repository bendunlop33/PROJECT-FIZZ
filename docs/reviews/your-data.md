VERDICT: CHANGES NEEDED

# Review: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` (4 commits, 26 files). Checked against
`docs/design/data-import-export.md` §2.6, §2.7, §3.6, §4.4, §4.5 and checks 29a, 30, 31, 31a and 33;
`docs/design/profile-and-settings.md` §2.8; CLAUDE.md rules 5, 7 and 10 and the minimal-copy convention; ADR 0005 and
the new ADR 0022.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 175 files, 3564 passed, 1 todo.

## What is good

- Every table is classified (`packages/persistence/src/data-domains.ts`). An unclassified table throws, and a test
  compares the list with `sqlite_master` (`data-domains.test.ts:141`). A future table can't get past Delete or
  Export unnoticed.
- The database part of Delete is all or nothing. It builds a knowledge-only file, checks its integrity and switches
  the meta pointer in one transaction. The crash test copies the files at every meta write and shows only "all" or
  "none" states (`data-domains.test.ts:225`). That covers the "non-atomic delete" risk at the SQLite level.
- Coaching knowledge rows are byte-identical after Delete (`data-domains.test.ts:193`, `your-data.test.ts:121`).
  Reset leaves every Your-data row identical and keeps the knowledge exercises Ben's records use.
- Rule 5: both actions are confirmed against a content stamp and checked again inside the manager's lock. The
  ledger makes them idempotent by op ID, and a concurrent double tap is tested.
- Rule 7: Delete signs out of ChatGPT (bounded, works offline), deletes both Keychain items by key and checks they
  are gone. Reset never touches credentials. Export doesn't include secrets, because they aren't in SQLite.
- The interrupted-delete marker is written before the swap, and startup finishes the delete before showing anything
  (check 31, tested at `your-data.test.ts:199`).
- Neither the coach nor voice can reach these actions (check 33). No new tool is registered.

## Blocking

**B1. Delete my data leaves a full copy of all of Ben's data on the iPhone (check 30, §2.7, §4.5 step 3, rule 10).**
`apps/mobile/src/backup/data-domain-service.ts:232–243` writes a `before_delete` backup into the app container. This
backup contains every workout, memory, pain flag and check-in. `finishDelete` (`:178–196`) never removes it or any
earlier automatic on-phone backup. The backup manifest `backup-state.json` also survives, with the list of copies,
the last Files copy, the trial-run date and the reminder settings. The test asserts this behaviour
(`apps/mobile/test/your-data.test.ts:133–143`: the backup is still on the phone and restores everything).

- Failure scenario: Ben taps Delete my data so nothing about him is on the phone, for example before lending or
  selling it, or after a bad import. The app opens first-run. `Restore from a backup → Copies on this phone` then
  lists 15 backups with his full history and pain flags, and any of them restores it all.
- Spec conflict: check 30 says "on-phone backups … are gone". §2.7 lists "Backups on this phone" among what is
  removed and says "Backups on this phone hold Ben's data, so they are deleted too". §3.6 shows
  `No copy off this phone. Deleting removes the backups on this phone too.` and puts Save first above it.
- The copy contradicts itself. `DELETE_ALERT` (`apps/mobile/src/backup/data-domain-view.ts:42–46`) says "everything
  about you are removed from this iPhone" and then "A backup is saved on this phone first". The removed list
  (`:27–38`) doesn't say that the on-phone backups are kept.
- ADR 0022 lists this as divergence 1, but its status is "Proposed … Ben to confirm". It isn't in
  `docs/brief/CHANGELOG.md`. CLAUDE.md says to propose the change, not build it. Shipping the unapproved behaviour
  makes the feature's main promise false.
- Fix: follow §4.5. After the swap, delete every Fizz backup file on the phone. Reset the manifest to
  `defaultManifest()`, or remove it. Then write one knowledge-only on-phone backup. Make every step idempotent
  under the existing marker. The safety net is `Save a copy to Files first`, listed first when there is no
  off-phone copy, with the §3.6 line. Change the test so it asserts that no on-phone file contains the owner ID
  after Delete. If Ben approves the divergence instead, record it in the CHANGELOG. The list and alert must then
  say plainly that backups on this phone are kept, and the screen needs a way to remove them, so Delete can still
  meet check 30.

## Should fix

**S1. A resume that fails tells Ben his data is unchanged when it has already been deleted (honesty, rules 1 and 6).**
`apps/mobile/src/services/startup.ts:66–69` returns `open_failed`. `Root.tsx:136–140` always renders it as
"Couldn't open your training data." with the line `Data unchanged · backups untouched`.

- Failure scenario: the swap has happened, then the Keychain wipe keeps failing (`wipeKeychain` throws when an item
  can't be removed). Every launch then shows that his data is unchanged, but it is gone.
- The app is also unusable with no way out (rule 1: logging must keep working). Every retry runs the same
  failing step.
- Fix: return a distinct outcome (`delete_unfinished`) with honest copy: `Deleting your data didn't finish` and
  `Try again`. After the swap has happened, let Ben continue into first-run with a one-line warning naming the
  step that failed, such as the coach sign-in. If the swap hasn't happened yet (`deleteYourData` failed before the
  switch), clear the marker and say `Nothing was deleted`, so a full disk can't brick the app.

**S2. Device prefs can come back after an interrupted or `pending` delete.**
`Root.tsx:188` loads `device-prefs.json` at mount, at the same time as `startApp`. On the resume path the file is
removed afterwards by `personalFiles.remove`, but the in-memory prefs still hold Ben's old values. The next
`update` (`Root.tsx:196–209`) writes them all back.
`DeleteMyDataScreen.tsx:57` resets prefs only when `r.ok`, not for `failed` with `pending: true`, which also
relaunches.

- Fix: have startup report `resumed.ran`, or expose a `personalDataCleared` signal, and reset the Root prefs state
  to `DEFAULT_PREFS` when a delete finished. Alternatively, load prefs only after `startApp` resolves. Add a test.

**S3. A sign-out that times out can rewrite `coach-connection.json` after it was deleted.**
`withTimeout` (`data-domain-service.ts:189`) stops waiting after 10 s, but `disconnectChatGpt` keeps running. It ends
with `clearProviderFailure(ports.settings)` (`packages/providers/src/openai/connection.ts:411`), which loads and
saves the settings file. If the revoke returns after `personalFiles.remove()`, the file is written again.

- Fix: in `deviceCredentials().signOut`, delete the local tokens and settings first and run only the network
  revoke under the timeout. Alternatively, ignore late writes once Delete has started.
- Add a test with a slow (not hanging) sign-out.

**S4. Reset can't be undone from the UI (check 31a, §3.6 "Reset done" toast, §4.6).**
The rollback generation is kept, but there is no `Undo last reset` row or toast. `switchTo` clears `switched`
(`manager.ts:509`), so `rollbackTarget` shows nothing. ADR 0022 divergence 2 is also only "Proposed". Note that
`RESET_ALERT` correctly no longer promises an Undo.

- Fix: add `reset` to the meta `switch_reason` check (a small meta migration) and show `Undo last reset`. Until
  that ships, get Ben's sign-off that the `before_reset` backup is the way back.

**S5. Tests miss several of the edge cases this slice exists for.**

- Nothing checks that no file in the container holds owner data after Delete: on-phone backups, the manifest,
  prefs, coach settings (B1, S2, S3).
- The app-level Reset test (`your-data.test.ts:235–259`) probably exercises only the `unchanged` path: knowledge IDs
  are the same before and after (`:252`), and `r.status` is never asserted. There is no app-level test for Reset
  being stale, the `before_reset` backup failing, or a failed build.
- Nothing tests startup when `resumeInterrupted` fails (S1), or a pending delete whose swap itself failed.
- Check 29a asks for the knowledge export to be searched for "known personal strings". The tests search only for
  the owner ID. Add the gym name, check-in note (`Slept badly`), memory text and pain area.
- The device bindings `wipeKeychain` and `removeContainerFiles` have no test. Mock `expo-secure-store` and
  `expo-file-system`. Also add a test that every `SecureStore` key constant in `apps/mobile/src`, apart from the
  probe, is listed in `KEYCHAIN_KEYS`. API-key items (ai-connection AC7) would otherwise slip past Delete when they
  land.

**S6. Export covers only part of §2.6 and §4.4.**
Only full JSON is offered, with no CSV, FitNotes 2 CSV or date range. It saves through the folder picker, not the
share sheet. With no Your data it still writes an empty file instead of showing the "Nothing to export" state. ADR
0022 records this as not built.

- Fix: either add the "Nothing to export" state now and track the rest as a follow-up, or get Ben to accept JSON
  only for this milestone.

## Nits

- **N1.** `readLedger` (`data-domain-service.ts:153`): if `JSON.parse` fails or the file is damaged, Delete and Reset
  are refused permanently with no recovery. Consider moving the damaged file aside after the user confirms.
- **N2.** The `withTimeout` fallback is `{ revoked: false, hadSession: true }` even when `signOut` rejects before
  reading the vault. Ben is then told that ChatGPT couldn't be signed out when there was no session.
- **N3.** `deleteMyData` returns `duplicate: true` when it finishes an older pending op under a new op ID
  (`:251`). The data was deleted by this tap, so `duplicate` is misleading. Return the pending op ID instead.
- **N4.** Crash-capture files (`LAST_ERROR_FILE`, `GUIDE_OPEN_FILE`) and the probe's `fizz-probe-js.txt` stay in
  Documents after Delete. §4.5 lists the probe database. They hold little personal data, but add them to
  `personalFiles`.
- **N5.** The Reset screen relaunches the app even when `status === 'unchanged'`.
- **N6.** Delete and Reset build from a snapshot taken inside the manager lock. Writes that reach the old store
  between the snapshot and the switch are lost, as with restore (modal by design). For Reset this breaks "Your data
  isn't touched" if anything writes while the cover is up, for example a rest-timer reconcile. Consider a write
  gate on the store while the manager is switching.
- **N7.** Minimal copy: the Export subtitle `Rules and the exercise list. Nothing about you.` is borderline
  reassurance copy. `Rules and the exercise list` is enough.
- **N8.** Delete doesn't cancel Live Activities or AlarmKit alarms, and doesn't stop audio. ADR 0022 records this
  because they aren't wired yet. Add them to `finishDelete` when they land.

## Spec issues

1. **Pre-delete safety net and check 30 conflict.** The spec relies on `Save a copy to Files first` for safety and
   removes all on-phone backups. The developer, and this review's own brief ("missing pre-delete backup"), want a
   pre-delete backup. Both can't be true on the phone. Ben should decide. A middle option: make the pre-delete
   backup a Files copy, prompted when there's no recent one, and keep check 30 as written.
2. **Which domain custom exercises and aliases belong to.** §2.6 (line 578) puts "custom exercise definitions" and
   "aliases" in `Coaching knowledge only`, and check 30 lists "aliases" as kept. Open decision B12 is undecided,
   and `exercise_aliases` are owner-scoped FitNotes mappings (`owner_id NOT NULL`). The code treats both as Your
   data, which is consistent with the restore preview. The spec should say so until B12 is decided.
3. **What Reset does with coach-proposed playbook candidates.** §2.7 says approved and rejected rules "go back to To
   review". The schema has only `to_review` and `withdrawn`, and Reset deletes every candidate, including ones Ben
   stated and hasn't reviewed yet. The spec should state what happens to candidates that aren't in the bundle.
4. **Reset Undo needs a meta-database migration.** ADR 0005's meta schema allows only `restore` and `rollback`. The
   spec's "one rollback generation, same mechanism as Undo restore" understates that.
