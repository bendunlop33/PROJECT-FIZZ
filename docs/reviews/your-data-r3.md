VERDICT: CHANGES NEEDED

# Review round 3: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` (51 files), focused on the round-2 fix commits `3fa0416`,
`f900924` and `76d90fe`. Checked against `docs/design/data-import-export.md` §2.6, §2.7, §3.6, §4.5 and checks 29a,
30, 31, 31a and 33; `docs/design/profile-and-settings.md` §2.8; CLAUDE.md rules 5, 7 and 10 and the minimal-copy
convention; and ADR 0022.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 178 files, 3609 passed, 1 todo.
- I wrote a throwaway probe test to confirm S1 (below). It failed as predicted, and I deleted it. It is not committed.

## Round 2 findings

| Round 2 | Status |
|---|---|
| B1 picked-file copies survive Delete | **Fixed.** `readThenDelete` removes the picker copy in a `finally`. `settings_files` empties `tmp` and `Caches`. The harness models both, and the container-wide personal-string search covers them. The new emptying is broad, and it can now block the Keychain wipe (see B1 and S2). |
| S1 rest alert survives a delete finished at launch | **Fixed.** `cancelAllWorkoutAlerts` works by prefix and throws if an alert is left. The resume test schedules the alert before a force-close. |
| S2 `Continue` leaves data on the phone with dishonest copy | **Fixed** for the main path: step-aware copy, plus a `Finish deleting` line that never swaps. A stale-record bug is new (S1). |
| S3 Reset during an unfinished workout | **Fixed.** Refused with `workout_unfinished` before the backup. The button is disabled with the block line. Tested. |
| S4 tests | **Mostly fixed.** Gaps remain (S3). |
| S5 ADR Proposed / Export JSON-only | **Open, correctly parked.** Recorded in the ADR and CHANGELOG as awaiting Ben (S4). |
| N1 orphan overwrite | **Fixed** (`dropStaleOrphan` before every reuse of the orphan slot, tested). |
| N2–N4 | Fixed. |

## What is good

- Rule 10: every table is classified, and an unclassified table fails against `sqlite_master`. Delete leaves
  owner-less `exercises` and `playbook_candidates` byte-identical. Reset keeps every Your-data row and the knowledge
  exercises those rows use.
- Atomicity: the database part of Delete and Reset is one meta transaction. A resume never swaps twice (`swapped`).
  `Finish deleting` never swaps, and it keeps backups and Undo copies made after `Continue`. An unreadable result is
  never reported as deleted.
- Rule 5: stamp-checked under the manager lock, idempotent by op ID, and the concurrent double tap is tested.
- Rule 7: `KEYCHAIN_KEYS` is the single list, a source scan enforces it, `wipe` reads back, and Reset never touches
  credentials.
- Reset makes a `before_reset` backup. Delete keeps no backup of Ben's data, as the spec requires. The pre-delete
  safety net is still a spec question (Spec issue 1).
- Nothing else of Ben's survives in the container that I could find. I searched every `containerTextFile`, `new File`,
  `SecureStore`, `openDatabase` and App Group write in `apps/mobile/src`. The probe's App Group token and Keychain
  probe key are deleted straight after use. Live Activity is used only by the probe, so no workout Live Activity
  exists to end yet.
- Copy is short. The new lines (`Some of it is still on this phone.`, `Finish deleting`,
  `Finish or discard your workout first (…)`) are values and actions, not explanations.

## Blocking

**B1. The Keychain is wiped last, so any failure in an earlier clean-up step leaves the ChatGPT sign-in on the phone.
The newest step is also the one most likely to fail.**
`apps/mobile/src/backup/data-domain-service.ts:327–336` runs the clean-up as `alerts` → `backups` → `settings_files`
→ `coach_sign_in`, and stops at the first throw. Spec §4.5 puts the credentials **first**: "1. `disconnectAiConnection`
… then delete every Keychain item Fizz owns". ADR 0022 says the code "follows the spec (§4.5 …)", but the order
differs and the ADR doesn't say so.

This matters more since round 2. `settings_files` now calls `emptyTemporaryFiles` (`apps/mobile/src/device/files.ts:108`),
which deletes everything in `tmp` and `Library/Caches` and throws if any entry is left. ADR 0022's own device-check
list warns that iOS may keep files there "that can't be deleted (that would fail the `settings_files` step every time)".
Examples are the NSURLCache `Cache.db`/`fsCachedData` and the Metal shader cache that Skia's renderer creates under
`Caches/<bundle>/`.

- Failure scenario: Ben taps Delete my data. The swap, alerts and backups succeed. `emptyTemporaryFiles` hits an entry
  iOS recreates or protects, so `settings_files` throws. `coach_sign_in` never runs. The relaunch retries, fails the
  same way, and Ben taps `Continue`. `Finish deleting` re-runs from `settings_files` and fails the same way every
  time. The ChatGPT tokens and the registration, which holds the account email, stay in the Keychain indefinitely.
  They survive an uninstall (ios-platform-feasibility). This breaks rule 7 and check 30. The copy is honest ("Some of
  it is still on this phone"), but nothing Ben can do in the app removes them.
- Fix:
  - Make `coach_sign_in` the first clean-up step after the swap. The sign-out already removes tokens locally before
    the bounded network revoke, so moving it costs nothing.
  - Better still, run every remaining step even when an earlier one fails. Record the first failure for the marker
    and the copy, so one stuck file never blocks the others.
  - Do the same in `runLeftover` (`:369–392`).
  - Update ADR 0022 to state the order and why it differs from §4.5 (DB first so a pre-swap failure deletes nothing).
- Test: make `personalFiles.remove` throw always. Assert that after Delete, and after `Continue` plus `Finish deleting`,
  `keychain.items.size === 0` while the outcome still names `settings_files`.

## Should fix

**S1. After `Continue` and a later successful Delete, Data & backup still says deleting didn't finish, and
`Finish deleting` then removes things Ben set up afterwards.**
`remember()` (`data-domain-service.ts:263–266`) keeps earlier `done` entries unchanged. A full Delete never clears an
older entry's `unfinished`. `leftover()` (`:510–514`) returns the newest entry with `unfinished !== null`, which is the
old one. I confirmed this with a probe test. The sequence was: Delete fails at `backups`, `Continue`, log a workout,
then Delete again succeeds. Afterwards `leftover()` returns `{ step: 'backups', … }`.

- Failure scenario: after the second, complete delete, Ben sets up again and signs in to ChatGPT. Data & backup shows
  `Deleting didn't finish: backups on this phone. Some of your data is still on this phone.` That is false (rules 1
  and 6, honesty). If he taps `Finish deleting`, it signs him out of ChatGPT, removes his new `device-prefs.json` and
  `coach-connection.json`, and relaunches. Nothing of the old data was left to remove.
- Fix: when `finishDelete` completes, clear `unfinished` on every earlier `delete_my_data` entry, because a full
  Delete ran every step. Test the sequence above and assert `leftover()` is null.

**S2. `emptyTemporaryFiles` empties all of `tmp` and `Caches` under live frameworks, and fails on anything it can't
remove.**
`apps/mobile/src/device/files.ts:108–124`. The B1 fix is right in principle: Caches can hold NSURLCache copies of
coach API responses, which are Ben's data. But it deletes caches owned by running system frameworks (URL cache, Metal
shader cache) while the app runs, and it treats any survivor as a failure. Beyond B1, it is untested on the device,
and an iOS-owned entry would make every Delete end "unfinished".

- Fix:
  - Keep the B1 behaviour, but treat entries that iOS recreates straight away as removed. Re-check by name only for the
    picker `*-Inbox` directory and files GymSmarter wrote, and report other leftovers without failing the step.
  - Alternatively, run the device check ADR 0022 lists before merge, and narrow the list if it fails.
  - Either way, B1's reordering removes the worst consequence.

**S3. Tests still miss these paths.**

- A clean-up step that always fails before `coach_sign_in`. B1 is untested because the only failing-step tests use
  `backups` and `database`, and in those the Keychain is expected to remain.
- A later successful Delete clearing an earlier `Continue` record (S1).
- `Finish deleting` while a workout is in progress. The `alerts` step skips cancelling
  (`data-domain-service.ts:379`), and `settings_files` removes `device-prefs.json` mid-workout. Assert that the
  workout and its alert survive and the relaunch recovers the workout.
- `readThenDelete` when `file.delete()` throws. The copy is left for Delete, which is fine, but nothing asserts that
  the picked text is still returned.

**S4. ADR 0022 is still Proposed, and four Ben questions are open.**
The four questions are: Export JSON-only, the pre-delete prompt, Reset and candidates, and B12. They are correctly
recorded as awaiting Ben in ADR 0022 "For Ben" and `docs/brief/CHANGELOG.md` (2026-10-11). They need his answer, or an
explicit "merge as is, follow-up slice", before merge. This is not a code defect.

## Nits

- **N1.** The `Finish deleting?` alert (`DataBackupScreen.tsx:74`) has no message. The action also signs out of a
  ChatGPT connection Ben may have made after `Continue`, and removes his look and alert settings (ADR 0022: "including
  any set up since `Continue`"). Use one short line, e.g. `Signs you out of ChatGPT.`, and only when a sign-in exists.
  The alternative is to keep sign-ins made after `atUtc`, as backups are kept.
- **N2.** In `runLeftover`, the `alerts` step (`data-domain-service.ts:379`) skips cancelling when any workout is
  unfinished, then marks the step done. An alert left from the deleted session (a different `fizz.rest.<id>`) is
  never cancelled. Cancel every `fizz.rest.` alert except the active session's identifier.
- **N3.** `deleteLeftoverView` reads `Deleting didn't finish: backups on this phone. Some of your data is still on
  this phone.` The repeated "on this phone" could be shortened to `Deleting didn't finish (backups). Some of your data
  is still on this phone.`
- **N4.** `emptyTemporaryFiles` also removes the app-switcher snapshot only if iOS stores it under `Caches/Snapshots`
  (older iOS). On iOS 17+ it is in `Library/SplashBoard`, which isn't touched. That snapshot can show Ben's last
  screen, such as history, until the next backgrounding. Add it to the device-check list; no code change suggested
  yet.

## Spec issues

1. **Pre-delete safety net (open since round 1).** Delete is irreversible and keeps no backup on the phone.
   `Save a copy to Files first` is the only net. Ben should confirm that this is enough, or approve a
   `No copy off this phone. Save one first?` prompt.
2. **§4.5 step order.** The spec orders Keychain → alerts → one transaction. A database-first order is reasonable,
   because a failure before the swap then deletes nothing. If Ben accepts that, the spec should say so and require
   credentials to be the first step after the swap (B1).
3. **Reset and playbook candidates; custom exercises and aliases (B12); "cached import files" wording.** These are
   unchanged from round 2 and recorded in the CHANGELOG as awaiting Ben.
