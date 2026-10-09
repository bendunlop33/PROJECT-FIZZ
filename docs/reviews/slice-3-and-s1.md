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
