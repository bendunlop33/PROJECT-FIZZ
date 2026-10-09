# Review: slice 3 (restore, gym editor, repeat, touches, review fixes) and spike S1 (ChatGPT sign-in)

**Verdict: CHANGES NEEDED** (one blocker, B1: Repeat plans loads that today's gym can't make)

Reviewed: `811c3c3..30103be` on `claude/gracious-knuth-joxqpw`. That covers:
- slice 3: restore, Check a backup, Undo restore, the minimal gym editor, Repeat last workout and Past workouts, `set_rest_after`, the plate breakdown, the warm-up ramp, the Summary highlight, default rules by category, and the slice-2 review fixes;
- the 10 exercise guides merge (skimmed only);
- spike S1: `packages/providers`, the `loopback-auth` Swift module, the Developer → ChatGPT sign-in test screen, and ADR 0012.

The re-review of the slice-2 fixes is appended to `workout-loop.md`.

Specs read:
- CLAUDE.md and the brief: "Validation before claiming it is better", §10 additional scenarios, §12 targets.
- `data-import-export.md` §2.3–2.4, §3.3, §4.2, §7.
- `gym-editor.md` (§2.4, §4.9).
- `routines.md` (RT4, §4.6, acceptance 13).
- `onboarding.md` (OB3).
- ADR 0010 amendments 1–2, ADR 0011 (diff), ADR 0012, `provisional-2026-10-09.md`.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, tests, catalogue validate, guide check) | Clean. 70 test files, 850 tests passing. Catalogue validate gives only "dangling variation" warnings. Guide check: 10/10 pass, and all 10 guides are `draft` |
| `expo export --platform ios` (scratchpad) | The Hermes bundle builds (4 MB). Export deleted |
| `expo prebuild --platform ios --no-install --clean` on a scratch copy, then `node scripts/check-entitlements.ts --prebuild` | OK. Both `.entitlements` files hold only `com.apple.security.application-groups`. There is no `UIBackgroundModes` and no `NSLocalNetworkUsageDescription`. ATS has `NSAllowsArbitraryLoads=false` (the Expo default). Autolinking resolves `LoopbackAuth` and `ExpoCrypto`. Scratch copy deleted |
| macOS CI for HEAD (run 37877645717) | Finished while I was reviewing: **success**. The log shows `Installing LoopbackAuth (0.1.0)` and the unsigned `.ipa` built, so the Swift module compiles on the CI Xcode |
| Scratch probes on the real-SQLite harness (outside the repo, deleted) | Confirmed B1, S1, S2, S3 and S5 below. Details are in each finding |
| Grep the diff for `console.*`, secrets, `Math.random` in auth, token fields outside `ai/` | None. The only `oaiapp_…`/`*-SECRET-*` strings are test fixtures. Tokens appear only in `apps/mobile/src/ai/chatgpt-test-ports.ts` (Keychain) |

## What is solid

**Restore engine (`DatabaseManager`)**
- The backup is built into a fresh file that is first recorded as an orphan.
- It is migrated from the backup's version and integrity-checked at the latest version.
- Only then is the current database switched, in one meta transaction. A crash at any point leaves either the old or the new file current, never a half-built one.
- `orphan_reason` separates `restore`, `check` and `dropped`. `A restore was interrupted` shows only for a real restore, and Check leaves the slots, the rollback target and the last-switch record unchanged. Both are tested.
- It never adopts a non-empty file. Rollback refuses an empty or failing previous file. An identical file is `unchanged` and keeps the rollback target.

**Restore flow**
- The service refuses Restore and Undo while a workout is unfinished. The UI rows are disabled too.
- Before the switch, the rest alert is cancelled and pending backups finish (`whenIdle`).
- Services read `manager.store` at call time. `Done` relaunches through the normal cold start.
- The Files picker uses `asCopy: true` (expo-file-system 57), so the original is never touched. It has a 200 MB cap.
- Backup errors are mapped to the spec's wording, and every message says nothing changed.

**Gym editor**
- Every number comes from `@fizz/domain`, including the preview, `Fix n problems`, gaps, unbalanced plates and `Check a load`.
- Saves are versioned by `expectedVersion`. A double tap is a `duplicate`. A save from an editor opened before another change is `stale`, never applied.
- Undo saves a new version.
- The unit locks once a completed set used the item. This is checked in both the UI and the service.
- A workout in progress keeps its equipment snapshot (tested). The toast says `Future workouts use the new setup`, which is honest.
- The plate-loaded copy doesn't estimate machine resistance, and stack numbers are "as printed", which keeps rule 4 truthful.

**Next time is the next plan**
- `nextTargetsFor` is the one function behind the Summary and `addExercise`.
- Planned sets carry `source: 'built_in_rule'`. The reducer rejects planned loads in another unit or convention.
- The category defaults remove the 5×5 load cuts.
- Unspecified pain holds every increase, both for the workout that planned them and for today's.

**Small touches**
- The plate line and the warm-up ramp only round down to loads the bar can make.
- The warm-up is labelled `built-in, not logged` and can be hidden.
- The highlight is like-for-like (same equipment, unit and convention) and only against earlier workouts. No estimate is presented as fact (rule 6).

**S1 providers package**
- State, nonce and verifier are 24–32 bytes from `expo-crypto` (system CSPRNG). PKCE is S256, and the RFC vector is tested.
- The redirect is built only by `loopbackRedirectUri(port)` → `http://127.0.0.1:<port>/auth/callback`.
- State is checked first, including on error callbacks. Issued vs reused client IDs are validated.
- The ID token's `iss`, `aud` (the issued client ID), `exp`, `nonce` and `sub` are checked. The token's subject must match the saved one.
- With no `chatgpt.tokens.use.direct`, nothing is stored.
- Tokens are one Keychain item: `expo-secure-store`, service `fizz.chatgpt`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. They are never in SQLite, backups, exports or logs.
- Disconnect revokes via the discovery document's endpoint and deletes the tokens whatever happens.
- There is no API-key path and nothing ever suggests a paid route (rule 7).
- The request builder forces `store:false`/`stream:true` and rejects forbidden fields.
- The export masks emails and carries no codes or tokens. This is tested.

**S1 Swift module**
- The listener is bound to IPv4 loopback only, and all state is main-queue only.
- Each attempt uses a fresh `NWParameters.tcp`. The request head is capped at 16 KB.
- The log records the path only, never the query. HTML responses use constants only.
- `finishAuth` settles once, then cancels the sheet, the timeout and the background task.
- The background task is ended in its expiration handler.
- It needs no entitlement and compiled in CI.

---

## Blocking

### B1. Repeat at a gym that lacks the equipment keeps the old load as a target, which breaks rule 4. The note also says "Kept as done"
`packages/domain/src/session/repeat.ts:83-95` (the note at `:85`; `templates` keep `targetLoad: a.load` even when `eq` is null)

**What happens.** When the source exercise used equipment and today's gym has nothing usable of that kind, `pickEquipment` returns null. The exercise is then planned with `equipmentId: null` and the **old load unchanged**, so `startWorkout` has no equipment to check it against.

**Probe.** I logged Bench press 100 kg × 5 at the commercial gym, then ran `Repeat` at a dumbbell-only gym. The new session has Bench press with `equipmentId: null` and `planned.load = 100 kg total` (`source: 'repeat'`). The preview says `No Barbell and plates here. Kept as done, loads not checked.`

**What it breaks.**
- CLAUDE.md rule 4: "Loads must be achievable on the selected gym's real equipment."
- The brief's additional scenario: "Home gym has only dumbbells up to 30 kg: no unavailable dumbbell or cable prescriptions."
- routines.md acceptance 13: "at another gym, loads are rounded down or dropped with notes".
- The note's wording "Kept as done" contradicts RT4 ("Nothing is marked done").

**Failure scenario.** At the hotel, Ben taps `Repeat last workout`. The card says `Target (as last time) 100 kg × 5` for a barbell that isn't there. A cable row shows a stack number for a stack that doesn't exist. `domain/test/repeat.test.ts:56` asserts the note but not the load, so it passes.

**Fix.**
- When `sourceEq !== null && eq === null`, plan the set with `targetLoad: null` and keep the reps.
- Note it plainly, e.g. `No barbell here: no load target (last time 100 kg × 5).`
- Assert `planned.load === null` in that test, and add the hotel case to `apps/mobile/test/repeat.test.ts`.
- Separately: an exercise whose source had no equipment correctly mirrors that (unchecked as before). That case is fine.

---

## Should fix (before real workouts or the next slice)

### S1. Today can't open if any finished workout in the past year is unreadable. This is a slice-3 regression of review S2
`apps/mobile/src/screens/TodayScreen.tsx:54`, `apps/mobile/src/services/workout-services.ts:438-454`

**What happens.** Today's loader now includes `s.repeat.candidates(1)`. That function decodes **every** finished session from the last 365 days (`listFinishedBetween` → `readAggregate`). A single record that fails validation throws, so `Promise.all` rejects.

**Probe.** I corrupted one old session. `today.view()` still works, but `repeat.candidates(1)` throws `CorruptDataError`.

**Failure scenario.** A future build tightens a schema; that is the review S2 scenario this slice set out to make harmless. Today then shows only `Couldn't open your training data` with no Start button, so Ben can't start a workout (rule 1). It also costs about one full-aggregate decode per workout in the past year on every Today focus and data change, which works against the brief §12 "one tap to resume".

**Fix.**
- Read only the newest finished session (a `LIMIT` query like `latestFinished`, skipping undecodable rows).
- Catch the failure in the loader (`last: null`), as `planFor` already does.
- Give `PastWorkoutsScreen` the same per-row tolerance.
- Add an `unreadable-records` test that Today still loads.

### S2. A second restore after Undo deletes the switched-away data, with no warning
`packages/persistence/src/manager.ts:277` (`orphan: this.slots.previous`) and `:401-404`; preview `:131-142`

**What happens.** The preview counts only what the **current** database would lose. The database in the rollback slot is deleted with no word.

**Probe.** I ran these steps:
1. Restore A.
2. Log a workout on the restored data.
3. Undo restore.
4. Restore A again.

The preview says `1 workout … isn't in this backup`, meaning the old phone data. Step 4 then deleted `training-2.db`, which held the workout logged in step 2. A further Undo brings back the old data without it.

**Failure scenario.** Ben restores, trains for a week, taps `Undo last restore` by mistake, then restores again. The week's workouts survive only in on-phone backups (Keep 14). If a backup failed or was rotated away, they are gone.

**Fix (pick one).**
- Count the rollback slot's records that aren't in the backup or in the current data, and say so in the preview and the confirm alert (`… and 3 workouts in the data you switched away from will be deleted`).
- Or refuse to drop a rollback slot that holds finished workouts newer than both, until Ben confirms.
- Add a persistence test for the sequence above.

### S3. A thrown error during Restore or Undo leaves Ben behind a full-screen cover with no way out
`apps/mobile/src/screens/data/RestoreScreen.tsx:96-110, 130`, `apps/mobile/src/screens/data/DataBackupScreen.tsx:66`; `manager.ts:298-304` and `:345` (I/O outside `try`)

**What happens.**
- `restore()` and `undo()` are `void`ed with no `catch`.
- `build()` calls `host.open`, `readUserVersion` and `writeSlots` before its `try`.
- `rollback()` calls `host.open(previous)` before its `try`.
- So any I/O error there (disk full, SQLite open failure) rejects the promise. The step stays `restoring` or `undoing`, and `BlockingCover` has no buttons.

**What still holds.** The data is safe: nothing was switched, and the cover's own text is right.

**Failure scenario.** The phone is nearly full, and Restore stays on `Restoring your data…` until Ben force-quits. At worst `build()` leaks its new file, because the orphan slot was never written.

**Fix.**
- Move those calls inside the `try` blocks and return `restore_failed`.
- Also wrap the screen calls in `try/catch` → the `Restore didn't finish: … Your data is as it was.` state (§3.3 "Failed before the switch").

### S4. Summary's `Clear` on a pain flag is one tap, with no confirm and no Undo
`apps/mobile/src/screens/workout/SummaryScreen.tsx:163-178`

**What happens.** The set card (`WorkoutScreen`) and `PainFlagsScreen` both ask `Clear the pain flag for …?` first. On the Summary, the `Clear` text button sits on each flag row and clears it immediately. `Next time` then recomputes with increases.

**Failure scenario.** Ben means to tap `Choose movements` or scroll. Instead he hits `Clear`, and the bench flag he set an hour ago is gone. He sees `Next time … 62.5 kg`, and there is no un-clear (rule 9).

**Fix.** Use the same confirm alert as the other two places, or offer a toast with Undo.

### S5. A restore preview can go stale and still be applied without a fresh confirmation
`apps/mobile/src/screens/data/RestoreScreen.tsx:112-121`, `apps/mobile/src/backup/restore-service.ts:89-96`

**What happens.** The confirm alert is decided from the `prepare()` preview, but `restore(text)` takes no token of the state it previewed.

**Probe.** I prepared a preview with nothing to replace, then logged and finished a workout, then restored. The workout was replaced with no alert (the rollback slot keeps it).

**Failure scenario.** On a fresh phone, Ben opens the preview and is called away. He logs a quick workout from Today, comes back and taps `Restore`. The workout disappears without the `Replace your data?` alert. This is rule 5's "never applied to newer state", for restore.

**Fix.**
- Pass the preview's current-data hash (or the counts and newest-session time) into `restore`.
- If it changed, return `stale` and re-show the preview.

### S6. Undo restore is refused when the restored backup contains an unfinished workout
`apps/mobile/src/backup/restore-service.ts:100-106`

**Probe.** I made a manual backup during a workout (this is allowed), then restored it. `undo()` returns `workout_unfinished` for the workout that came **from the backup**.

**Failure scenario.** Ben restores the wrong copy. To get back, he must discard a workout he didn't start, and the copy just says `Finish or discard your workout first`.

**Fix.** Allow Undo while the only unfinished workout is the one the restore brought in (its ID isn't in the rollback database), or explain it. See SP2.

### S7. S1 items to close before the coach uses this route (not blocking for the Developer-only spike)
- **No JWKS check of the ID token's signature** (`tokens.ts:165-185`). This is acceptable now, because the token comes straight from the token endpoint over TLS and is used only by Developer → ChatGPT sign-in test. ADR 0012 records it, and the step says `Not checked: RS256 signature`. It must be closed before any product screen trusts `email` or `sub`.
- **Refresh is serialized per instance only.** `runModelsStep`, `runResponsesStep` and `runRefreshStep` each create `new TokenRefresher(...)` (`sign-in-test.ts:386, 415, 467`). Today this is safe, because the screen's `run()` allows one action at a time and the orchestrator is sequential. A coach with parallel callers would send a rotated refresh token twice and lose the session. Before the coach, make one shared refresher per vault.
- **Granted tokens are discarded but not revoked** on the `scopes` fail and the different-account paths (`sign-in-test.ts:293-313`). A live refresh token stays granted at OpenAI. Call `revokeRefreshToken` there.

---

## Nits

**Swift module (`LoopbackAuthModule.swift`)**
- **Re-listen failure.** If the one re-listen during sign-in also fails, it lands in the `!settled` branch with `promise == nil` (`:173-179`). So the attempt waits for the 5-minute timeout instead of ending with `The loopback listener stopped during sign-in`.
- **Possible hang on start.** If `NWListener` stays in `.waiting` (`:165`), `startListener` never settles. The screen then stays `Waiting for ChatGPT sign-in`, and `Cancel sign-in` does nothing because `pendingAuth` is nil. Add a JS-side timeout around `startListener`.
- **Spoofed callback.** Any local process can send `GET /auth/callback?...` first. The state check makes this a denial of service only (the run ends with `state_mismatch`), but the step copy could say so.

**Manager orphan bookkeeping**
- **Forgotten file on build.** `build()` overwrites an existing orphan slot (`manager.ts:304`), and `rollback()` sets `orphan: null` (`:355`). A file left from a failed deletion is then forgotten on disk. It is leaked space, not lost data.
- **Empty file after rollback to a missing file.** Rolling back to a missing file creates an empty file, which stays in the `previous` slot (`:345-349`). Every later Undo fails the same way. Clear the slot when the file is empty.

**Restore and Undo screens**
- **Undo on the `done` step.** It relies on the services having switched already; that is fine. The tab bar is live before `Done`, so Today shows the restored data without the cold-start recovery until `Done` is tapped.
- **No error text on undo failure.** `DataBackupScreen` shows `r.error.message` raw (`:72`) rather than `describeBackupError`.

**Repeat**
- **Comment contradicts code.** `repeat.ts` says loads are "never converted", but a kg dumbbell target at an lb gym is converted and rounded (`22.5 kg each` → `45 lb each`, with a note). It is labelled, but the comment, ADR and CLAUDE.md's "kg/lb explicit" should agree on whether Repeat converts.
- **Not recorded as a repeat.** The session doesn't record `session.source = {kind:'repeat', sessionId}` (routines §4.6); only each set's `planned.source` does.

**Gym editor**
- **Unit switch keeps the numbers.** Changing the unit chip on an unlocked item leaves them as they were, so a 20 kg bar becomes a 20 lb bar. Consider asking `Convert values?` or clearing them.
- **`minLoad` can't be edited.** An item whose saved `minLoad` is above a newly entered max can't be saved (`Min is above max.`) with no way to fix it.

**Small touches**
- The volume highlight for per-dumbbell loads reads `… volume: 1,200 kg each`. Use `kg (per dumbbell × reps)` or skip volume for `per_hand`.

**Pain flags and Rest after**
- **No `catch` on the set card's Clear.** The pain `Clear` chain (`WorkoutScreen`) has none.
- **No Undo on Rest after.** The `Rest after → All … sets, and next time` toast changes a future default (the profile's `exerciseRestS`) with no Undo.

**Restore preview**
- `onlyOnPhone` counts only missing IDs. A correction made after the backup (brief scenario 5) is silently reverted. See SP3.

**Docs**
- The morning checklist (`docs/device-tests/morning-checklist.md`) has no S1 section. ADR 0012's device unknowns (127.0.0.1 reachable from the sheet, Local Network prompt, port 1455, app switch, `earliest_refresh_at`) need a row each so the result is recorded.

## Tests

**Covered well:**
- restore, undo, relaunch and check;
- interrupted vs check orphans;
- the gym editor's duplicate, stale, unit lock and snapshot;
- the starter IDs against the catalogue;
- the B1 router;
- prefill, pain holds and rest-after;
- providers (PKCE vector, state-first, scope gate, refresh rotation and errors, export redaction).

**Missing:**
- Repeat with no equipment of that kind (B1).
- Today with an unreadable finished workout (S1).
- Rollback-slot loss (S2).
- A thrown I/O error during restore and rollback (S3).
- Summary clear-confirm (S4).
- A stale restore preview (S5).
- Restore of a backup containing an unfinished workout, then Undo (S6).

---

## Spec issues

- **SP1. Mid-workout corrections (gym-editor §4.9).** A workout in progress keeps its snapshot. When Ben corrects a wrong preset mid-workout (for example, the rack actually goes to 50 kg), today's steppers still stop at the old max until the next workout. Consider an offer: `Use the corrected setup for this workout too?` That would be a proposal that touches only pending sets.
- **SP2. DX4 and Undo right after a restore.** DX4 blocks Undo whenever any workout is unfinished. The spec should exempt an unfinished workout that the restore itself brought in (S6), or tell Ben to discard it.
- **SP3. What a restore "replaces".**
  - §2.3 and acceptance 8 count only records missing from the backup. Records that exist in both but were corrected later are replaced silently.
  - The rollback slot is dropped on the next restore (S2).
  - The spec should say whether both count as "something would be replaced", which triggers the alert.
- **SP4. Restore from Welcome (OB3, onboarding check 10)** is still `Not in this build`. The ADR 0004 recovery path ("new app, restore") therefore means setting up a profile and gym first, which the restore then replaces (`N other records … will be replaced`). This works for the trial run, but the spec says restore comes before setup. Either confirm the deferral or build the Welcome entry before relying on it.
- **SP5. kg↔lb in Repeat.** Repeat converts loads across units, with a note. Decide whether that is wanted, or whether the load should be dropped.

---

# Re-review: fix commits `5c9c17a..5ef92a4`, catalogue batch 02, starter alignment

**Verdict: CHANGES NEEDED** (one blocker, R1: on a fresh install, the restore preview reports records that don't exist as changed or lost)

Reviewed on `claude/gracious-knuth-joxqpw` at `959a6fe` (the merge of `5ef92a4`). That covers:
- the fix commits for B1, S1–S7 and SP2–SP5, including the PM decisions in the commit messages and in the spec edits (`data-import-export.md` §2.3 and §3.3, `onboarding.md` §4.5, `routines.md` §2.4);
- catalogue batch 02 (`6e4f5df`);
- the starter/catalogue alignment (`163bbdb`, `1fef0a4`).

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Clean. 71 test files, 880 tests passing (up from 850). Catalogue validate: 133 valid, 0 errors, 1 warning (`barbell-landmine-press` uses `added` on a barbell), 9 notes (distance entries skipped by the loader). Guide check: 10/10 pass |
| `expo export --platform ios` (scratchpad) | The Hermes bundle builds (1337 modules, 4 MB). Export deleted |
| `expo prebuild --platform ios --no-install --clean` on a scratch copy, then `check-entitlements --prebuild` | OK. Both `.entitlements` files still hold only `com.apple.security.application-groups`. There is no `UIBackgroundModes` and no `NSLocalNetworkUsageDescription`. ATS has `NSAllowsArbitraryLoads=false`. Scratch copy deleted |
| Scratch probes on the real-SQLite harness (outside the repo, deleted) | Confirmed R1 and R2 below. The same-phone S2 sequence counts correctly (`kept: 1 workout, 0 other records`) |

## The original findings

| Finding | Status | Evidence |
|---|---|---|
| **B1** Repeat at a gym without the equipment | **Fixed** | `repeat.ts:98-141`: when `eq === null && sourceEq !== null`, every `targetLoad` is null and the reps are kept. The note now reads `No Olympic bar here: no load target (last time 102.5 kg × 8).` and "Kept as done" is gone. Tests: domain `repeat.test.ts` (the hotel dumbbell-only case asserts `planned.load === null`, the reps, `equipmentId === null` and all sets `pending`); app `repeat.test.ts` (end to end, through `start` and the focus card) |
| **SP5** kg↔lb in Repeat | **Fixed as decided** | A load is converted only through `roundToAvailableLoad(…,'easier')` against today's equipment. It's dropped when it would be clamped up to the minimum (or, on an assistance machine, down to the maximum). With no equipment, a load in another unit is dropped with a note. All four cases are tested, including logging an lb load afterwards |
| **S1** Today depends on a year of decodes | **Fixed** | `listRepeatableIds` uses `LIMIT/OFFSET`; `candidates` decodes only those rows, skipping and counting failures. `repeat.last()` never throws, Today's loader also has `.catch(() => null)`, and the week read uses `listFinishedBetweenReadable`. Past workouts shows the count. Test: `unreadable-records.test.ts` (Today's loader resolves, Start works, `unreadable: 1`, and the limit holds) |
| **S2** Second restore deletes the switched-away data | **Fixed** | `readKept` + `analyseReplace` count what is only in the Undo copy. An unreadable copy is reported, never dropped silently. The warning and the alert both say so. Tests: persistence and app sequences (restore → train → Undo → restore again). My probe of the same sequence gives exact counts. **But see R1 for a fresh install** |
| **SP3** "Replaced" includes changed records | **Fixed as decided** | Records are compared by content at the same schema version and by version stamps across versions. Tested in `backup.test.ts` |
| **S3** Stuck `BlockingCover` on an I/O throw | **Fixed** | `build()` and `rollback()` now open the file and write the slots inside `try`. `exclusiveSafe` turns any throw into `restore_failed`, and the service and both screens catch too. The new file is removed even when the meta write fails (`owned`/`recorded`). Tests: ENOSPC on open, meta write failing and the earlier file not opening. Each returns a value, leaves the slots and data unchanged, and a relaunch leaves nothing behind. Undo errors now use `describeBackupError` |
| **S4** One-tap Clear on the Summary | **Fixed** | The confirm wording is shared (`pain-clear.ts`), and the toast offers Undo. `undoClear` restores the flag as a new version, and only if the version still matches (stale and double-tap Undo are refused). Tested at the service level. The UI itself isn't unit-tested, which is normal for this repo |
| **S5** Stale restore preview | **Fixed** | `stamp = current|previous|contentHash`. A mismatch gives `preview_stale`, nothing switches, and the screen rebuilds the preview with `Your data changed since this preview` and asks for confirmation again. `restore(text, stamp)` requires the stamp at the type level. Tests: persistence and app (a workout logged after the preview is refused, then the restore succeeds after a fresh confirm) |
| **S6 / SP2** Undo blocked by a restored unfinished workout | **Fixed as decided** | `undoBlock` exempts a workout whose `startedAt` and `lastActivityAt` are both at or before the last switch. Tests cover allowed when untouched, blocked once continued, Switch back, and blocked by a workout started after the restore. No data is at risk: Undo swaps files, so the workout stays in the kept copy |
| **S7** S1 spike hardening | **Fixed** (JWKS stays open, as recorded) | There is one in-flight refresh per vault, keyed by a `WeakMap` on the vault. `keychainVault` is a module singleton, so it really is shared. Discarded grants are revoked on both the scope path and the different-account path. Swift: a failed re-listen ends the sign-in, and a 10 s start timeout cancels the listener. JS has a 15 s timeout and stops the listener. Tests cover the shared refresh, the revoke on the scope path and the hung start. The different-account revoke has no test (nit) |
| **SP4** Restore from Welcome | **Built, but see R1 and R2** | |
| Nits: re-listen failure, hang on start, raw undo error text | Fixed | |

## Blocking

### R1. On a fresh install, the restore preview reports changed and "lost" records that don't exist. The Welcome restore then shows the "Replace your data?" alert on an empty phone
`packages/persistence/src/backup/replace.ts:31, :45-75, :131`; seeding is in `apps/mobile/src/services/app-services.ts:136` (run at every launch from `startup.ts:65`)

**What happens.**
- Every launch seeds the 29 starter exercises: ownerless Coaching-knowledge rows whose `createdAtUtc`/`updatedAtUtc` are the time of the **first launch on that install**.
- `analyseReplace` counts `exercises` among the "other records" and compares the whole row. Across schema versions it compares `version`/`updated_at_utc`, which also differ.
- So, against a backup from any other install, all 29 starter rows "differ". The rows from before `163bbdb` also differ in name, pattern and muscles.

**Probe 1.** I made a backup on a harness started 1 Sept, then restored it from Welcome on a fresh harness started 9 Oct. The result:
- `changedOnPhone.otherRecords = 29`;
- the warning `29 other records on this phone differ from the backup's copy (a gym, an exercise or similar was changed since). The backup's version replaces them.`;
- `confirm = "Replace your data on this phone?"`.

This contradicts onboarding §4.5 / the SP4 decision ("nothing is replaced, so there's no alert") and the commit message.

**Probe 2.** After that Welcome restore, I prepared a restore of an older backup from the same old phone. The preview says `The data kept for Undo … holds 29 other records that aren't on this phone or in this backup. This restore deletes that copy, so they're lost unless saved in another backup.` Nothing personal is in that copy. It is the empty install's own starter list, which is reseeded at every launch anyway.

**Why the test passes.** `welcome-restore.test.ts:51` asserts `confirm === null`, but both harnesses default to the same clock (`harness.ts:36`, `2026-10-08T17:00Z`) and the same `idGen(1)` (`harness.ts:44`). So the "other phone" seeds identical starter rows, and the scenario that matters (a reinstall on another day, which is the ADR 0004 recovery path) is never tested.

**Why it blocks.** No data is lost; the error is in the cautious direction. But this is the data-safety UI that S2/SP3 were built to make trustworthy:
- It states false facts ("changed since", "lost") on the exact path the Welcome entry exists for.
- After any Welcome restore, every later restore repeats a false loss warning.
- An alert that cries wolf teaches Ben to tap through the one that matters.
- It also counts Coaching knowledge as "your data on this phone", against rule 10.

**Fix.**
- Limit the replace analysis (`onlyOnPhone`, `changedOnPhone`, `keptForUndo`) to owner-scoped rows. For `exercises`, that means `owner_id IS NOT NULL`, or exclude `source = 'catalogue'`. Ownerless catalogue/starter rows are Coaching knowledge and are reseeded at launch.
- Alternatively, compare ownerless rows without their timestamps. Owner-scoped only is simpler and matches rule 10.
- Make the Welcome test realistic: build the "other phone" with `createHarness('2026-09-01T08:00:00.000Z')` and a distinct ID generator. Assert no warning and no alert. Then assert no false "kept for Undo" warning on a later restore.

## Should fix

### R2. Back from the Welcome restore's `Done` step leaves Ben in first-run setup over his restored data
`apps/mobile/src/navigation/AppNavigator.tsx:180` (`headerShown: true`, no `gestureEnabled: false`/`beforeRemove`); `RestoreScreen.tsx:183-196`

**What happens.**
- After the switch, the `done` step has a header Back button and the swipe-back gesture. Back pops to `SetupScreen`, which is still on its in-memory Welcome step, while the services already read the restored database.
- If Ben taps through setup again:
  - `saveUnits` overwrites the restored profile's unit. My probe went from kg to lb, and `saveUnits` returned ok.
  - `saveGym` is no longer guarded by `inSetup`, because `skipAfterRestore` already set `completedAtUtc`, so it adds a second gym. On the device the IDs are UUIDs; in the harness the shared `idGen` collided and the save failed instead.
  - `onDone` switches to Tabs without the relaunch, so cold-start recovery (an unfinished workout from the backup, rest alerts) doesn't run.

**What still holds.** Nothing is lost.

**Fix.**
- On the `done` and `restoring` steps, hide the back button and disable the gesture, or make Back call `relaunch`. The relaunch then lands on Today, because the restored profile is marked set up.
- Optionally, have `SetupScreen` re-read `setup.getState()` on focus.

### R3. A force-close between the switch and `skipAfterRestore` resumes setup mid-way
`RestoreScreen.tsx:130`

**What happens.** For a backup saved part-way through setup, a kill in that window relaunches at the `gym`/`data` step with the restored profile instead of Today. This is benign: the profile and gym are kept, and finishing setup works. But it isn't the "skips setup" the SP4 decision describes.

**Fix.** Mark the profile set up as part of the restore's own post-switch step, or have `startApp` treat "restored from Welcome" (the last switch reason plus no `completedAtUtc`) as done.

## Nits

**Repeat**
- `missingEquipmentNote` (`repeat.ts:211`) picks the "top" set by the largest `load.value`. On an assistance machine that is the *easiest* set. It also compares values across units and conventions. Use the working set with the fewest reps, or the last working set.

**Catalogue batch 02 (not wired into the app yet; only the starter keys are seeded)**
- `ez-bar-curl`, `ez-bar-skull-crusher` and `trap-bar-deadlift` are `barbell` kind. Once wired, `pickEquipment`/`startWorkout` would plan plates on the gym's Olympic bar, which is the wrong bar weight (rule 4). They need their own kind, or a bar-weight choice, before wiring.
- `barbell-landmine-press` uses `added` on `barbell`. The validator warns about it. The session convention comes from the equipment (`create.ts:155`), so this only matters with no equipment.
- Floor exercises (push-up, squat, plank, dead bug, burpee, glute bridge and others) list `bodyweight_station`:
  - At a gym without one, the picker labels them `Not at this gym · loads won't be checked`.
  - At a gym with a `Pull-up bar`, push-up attaches to the pull-up bar.
  - `163bbdb` brings this to the starter Push-up on fresh installs (it was `[]`).
  - Consider `compatibleEquipment: []` for floor work, or a picker rule that treats `bodyweight` as needing nothing.

**Starter alignment**
- Existing phones keep the old starter rows (`Leg curl`, `shoulder_abduction`, …) and fresh installs get the new ones. `movementPattern` is a free string and nothing in the domain reads it except `ruleCategory`. I checked: no starter's rule category changes. So this is cosmetic, but it feeds R1.

**S7**
- There is no test that the different-account path revokes.

**Earlier nits still open**
- The pain `Clear` chain on the set card has no `catch`.
- `Rest after` has no Undo.
- The morning checklist has no S1 rows.
- The gym editor keeps the numbers on a unit switch, and `minLoad` still can't be edited.

## Tests

The new tests are meaningful regression tests for B1, S1–S7, SP2, SP3 and SP5. Each would fail on the old code. The gaps:
- **Cross-install restore (R1).** The shared harness clock and ID generator hide it, so add a test with distinct clocks and IDs.
- **Back from `Done` on Welcome (R2).** This is navigation, so cover it with a device checklist row if there's no component test.

## Spec issues

- **RS1. What a restore "replaces" (data-import-export §2.3, the SP3 definition).**
  - The definition counts "other records … (gyms, equipment, check-ins and similar)" without saying whether Coaching knowledge counts. Ownerless starter and catalogue rows are Coaching knowledge, and they are reseeded at every launch.
  - Rule 10 says the two kinds of data stay separate in backup/restore and UI.
  - The spec should say the preview counts **Your data** only, which is R1's fix. Once the catalogue is wired, it should also say how a restore treats Coaching-knowledge rows the backup lacks or has older versions of: keep the newer bundled ones, or let the backup's copy win.
- **RS2. Welcome restore exits (onboarding §4.5).** The spec doesn't say what Back does after the switch (R2). Suggested wording: after a restore, the only exits are `Done` (relaunch) and `Undo restore`.
