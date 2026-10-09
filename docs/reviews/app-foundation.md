# Review: app foundation (navigation, theme, expo-sqlite driver, startup, app services, on-phone backups, Profile, first run, Today placeholder)

**Verdict: CHANGES NEEDED**

Reviewed: commits `9e09fe7`..`55ddc46` on `claude/gracious-knuth-joxqpw`, 9 Oct 2026. I focused on the code commits. The catalogue batch and the research and design docs were only checked where the code relies on them.
Read: CLAUDE.md (rules 1, 5, 7 and 10 in particular), ADR 0008, ADR 0009, `onboarding.md`, `profile-and-settings.md`, `data-import-export.md`, `system-states.md`, `today.md`, `design-system.md`, `thirdspace-visual-reference.md`. I also read expo-sqlite 57.0.4 and expo-file-system 57.0.7 native sources in `node_modules` to check the driver's and file layer's assumptions.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, test) | Clean. 36 files, 562 tests, all passing |
| `expo prebuild --platform ios --no-install --clean` in a scratch copy, then `node scripts/check-entitlements.ts --prebuild` | OK. `Fizz.entitlements` and `ExpoWidgetsTarget.entitlements` each contain only `com.apple.security.application-groups = [group.com.projectfizz.fizz]`. Info.plist has no `UIBackgroundModes`, no `UIFileSharingEnabled`, and ATS stays at Expo's default. Scratch copy deleted |
| `expo export --platform ios` (output to scratchpad) | Hermes bytecode bundle builds (3.5 MB). No `node:` imports reach the app, so `@fizz/persistence`'s root export is phone-safe |
| `npm ls` for navigation packages | One copy each of `@react-navigation/native` 7.5.0, `react-native-screens` 4.26.2 and `react-native-safe-area-context` 5.7.0 |
| Scratch repro tests (not committed, deleted) | Confirmed B2, S1 and S2 below: two profiles after a concurrent `saveUnits`; `planRotation` deleting the only good backup; a manifest read error wiping `trialRunDoneAtUtc` and the file records |
| WCAG contrast for Direction D (both schemes, script) | All text tokens ≥ 4.5:1 on canvas, surface and raised. Lowest: `text.tertiary` on `bg.raised` 4.83 (light) and 4.89 (dark). `border.control` ≥ 3.3:1. `status.done` (light) is 4.17 on `bg.raised`, but it is only used for icons (3:1 needed), never for text |
| Secrets and logging grep over the diff | No `console.*`, keys or tokens. Nothing in plain storage except the backup manifest and device prefs, which hold no credentials |

## What is solid

- **expo-sqlite driver.** It matches expo-sqlite 57.0.4 as written: `withExclusiveTransactionAsync` opens a new connection, runs `BEGIN`, then `COMMIT` or `ROLLBACK` and rethrows. The result is carried out through a closure. Outer use, nested use and leaked transaction executors all throw. Row values are checked, unsafe bigints are rejected, and blobs are refused. `remove` is a no-op when the file is missing and also deletes `-wal`, `-shm` and `-journal`. I checked the native side: `deleteDatabaseAsync` refuses any cached connection to that path and throws when the file is missing, as the adapter assumes. expo-sqlite bundles SQLite 3.50.3.
- **Manifest outside the database.** `Documents/backup-state.json` is outside the training DB, so a restore can't rewind it. Writes go to a temp file and are then moved into place, and a read falls back to the temp file. The damaged-manifest path deletes nothing.
- **Write, verify, rotate.** Each file is read back and its SHA-256 compared before any rotation. Rotation deletes a file only when it matches the automatic name pattern **and** the recorded checksum. Manual and unknown files are never deleted. A failure is recorded and shown, never thrown. Runs are serialised and all manifest writers share one queue.
- **Startup.** A database from a newer build gives `schema_too_new` and `user_version` is untouched (tested). A cold start with an unfinished workout under 6 h opens into the workout. The catch-up backup and integrity check run in the background.
- **First run.** A force-close on Step 3 resumes there with one gym (tested). A double tap on `Save gym` within one visit saves one gym (tested). The step is derived from stored data.
- **Honest states.** Every not-built feature is shown as a disabled row labelled `Not in this build yet`: Restore, Check, Import, Export, the exercise list, playbook rules and Progress. App status shows `Working` only with a dated probe pass. Durability uses the three approved phrases. There's no AI anywhere, and no canned coach text.
- **Theme.** All tokens are present (tested against design-system.md). Direction D is the default and A can be chosen. D's affordance risks are handled in code: `TextButton` gets a chevron and underline in D, `ChoiceCard` shows a check icon plus a 2pt border, `ChecklistRow` changes shape, and tab icons switch to filled. Bold Text and Increase Contrast are read live. Icons scale with Dynamic Type up to 2×.
- **Device safety.** `AudioCoach` is loaded with `requireOptionalNativeModule`, so a missing module gives an honest "unknown". `newUuid` falls back to `Math.random` when `globalThis.expo.uuidv4` is absent, so launch never blocks.

---

## Blocking

### B1. Going Back over a saved gym in first run creates a second gym
`apps/mobile/src/screens/setup/SetupScreen.tsx:187-193`, `apps/mobile/src/screens/setup/GymSetupFlow.tsx:42`, `apps/mobile/src/services/app-services.ts:137-160`

The gym ID is "chosen once per visit" by `useState(newUuid)` inside `GymSetupFlow`. Step 3 offers `Back` once a gym is saved (`gym !== null`), and going back remounts `GymSetupFlow` with a **new** ID.

Failure scenario: Ben goes to Step 2, picks Commercial, taps `Save gym`, reaches Step 3, taps `Back` (perhaps to check what he ticked), then taps `Continue` and `Save gym` again. `createWithEquipment` sees a new gym ID, so a second "Main gym" is saved with a second set of equipment. It isn't the default because `existing.every(g => g.id === req.gymId)` is false. Ready then describes the second gym from `onSaved`, while `currentGym()` and Today use the first. Nothing in this build can archive or delete a gym, so the duplicate stays in Your data and in every backup.

This breaks onboarding §3.4 ("Going back over a saved gym edits that gym (`updateGym`), it never creates a second one"), the intent of acceptance check 5, and rule 5 (idempotent writes). The same Back path also lets Ben tap `Skip for now` after a gym was saved. Ready then shows `No gym yet` while a gym exists.

Fix:
- Hold the gym ID in `SetupScreen` state (or derive it from the saved gym) so it survives Back.
- Until `updateGym` exists, don't re-save over a saved gym. Back over a saved gym should show the saved gym read-only (`Main gym · 4 items (4 not checked)`, `Edit it later in the gym editor`). Alternatively, `saveGym` should return a distinct `already_saved` result that the UI states honestly.
- Don't simply reuse the ID. `createWithEquipment` would then return `duplicate: true`, silently ignore the edited checklist, and Ready would describe a checklist that was never saved.
- Add a service-level test for "second saveGym with a different ID after one is saved during setup", and a component-level test if the harness allows.

### B2. Rotation can delete the newest backup that can still be restored
`apps/mobile/src/backup/manifest.ts:409-414`, `apps/mobile/src/backup/backup-service.ts:155-175`

`planRotation` keeps the 14 newest automatic files whatever their `integrityOk`. If the database has a damaged record, every new automatic backup is written with `integrityOk: false`, which is correct and shown as `Backup saved, but it can't be restored`. After 14 finished workouts, rotation deletes the last good one. My scratch repro has 1 good backup plus 14 newer damaged ones, and `planRotation` returns the good one for deletion.

This is realistic, not only for disk corruption. A later build that tightens a zod schema makes old records fail `decode` in `checkIntegrityWith`. From then on every backup is "damaged", and two weeks of training silently removes every restorable on-phone copy. That is exactly the case on-phone backups exist for (data-import-export intro: "Backups on the phone protect against a damaged database or a bad restore"). Restore isn't in this build, so Ben can't act on the T2 banner in the app, which makes the 14-workout window more likely to pass.

Fix: in `planRotation`, never select the newest record with `integrityOk: true`. Damaged files may count toward `keep`, but the newest good one is always kept on top. Add a test with 1 good and 15 damaged files. See Spec issue SP2.

---

## Should fix (not blocking, but before real workouts or before the logging slice builds on it)

### S1. `setup.saveUnits` isn't idempotent: concurrent calls create two profiles (rule 5)
`apps/mobile/src/services/app-services.ts:119-130`

The service reads "is there a profile?" in one queued `read` and then saves in a separate `write`, with a fresh `deps.newId()` each call. Two calls that overlap both see `null` and both insert. My repro gets **2 profiles** from `Promise.all([saveUnits('kg'), saveUnits('kg')])`. The UI's `busy` state guard makes a real double tap unlikely, but onboarding §4.1 asks for "an operation ID, so … a double tap never saves twice". The profile ID is the stable owner ID that everything else hangs off, so a stray second profile sits in every backup and changes `getProfile` only through the `createdAtUtc` tie-break.

Fix: create the profile inside one `db.write` that returns the existing profile if any. Alternatively, have the screen choose the profile ID once, as `gymId` and `opId` already work. Add a concurrent test.

### S2. A manifest *read error* overwrites the stored record
`apps/mobile/src/backup/backup-service.ts:99-110, 148, 176, 234-238`

`loadManifest` treats a thrown read as an empty manifest, and the next run saves that empty-based manifest. My repro confirms that after one failed read, `trialRunDoneAtUtc` goes back to `null` and the earlier file records are gone. `offPhone.lastCopy` and `reminderDismissedAtUtc` go the same way. No files are deleted (good), but the status starts saying `No copy off this phone yet` and the trial-run line comes back. The forgotten automatic files then pile up and are never rotated. A *damaged* manifest is likewise replaced without keeping a copy, so there's nothing to diagnose later.

Fix:
- On a read **error**, don't write a new manifest. Record the attempt in memory and skip rotation.
- On a **parse** failure, rename the bad file to `backup-state.damaged-<utc>.json` before starting again.
- Clear `manifestProblem` after a successful save.

### S3. Backup writes silently overwrite an existing file with the same name
`apps/mobile/src/backup/backup-service.ts:120, 225`, `apps/mobile/src/device/files.ts:21-25, 103-107`

`backupFileName` only avoids names already in the manifest, and `saveCopyTo` passes an empty set. `File.write` calls `String.write(to:atomically:false)`, which truncates and replaces any existing file.

Failure scenario: the manifest was reset (S2), or Fizz was killed between writing a file and saving the manifest. A backup in the same local minute then overwrites that unrecorded file. A crash during the non-atomic overwrite leaves neither copy. In Files, a second `Save a copy to Files` in the same minute into the same folder replaces the first. That's low harm, but it isn't the "never deletes non-Fizz files" guarantee.

Fix: before writing, check `exists` and step to the next `-2`, `-3` suffix, both on the phone and in the picked folder.

### S4. Launch work holds the single database queue (flag for the logging slice)
`apps/mobile/src/services/startup.ts:346-347`, `packages/persistence/src/integrity.ts:73-75`

`checkIntegrity` runs `PRAGMA integrity_check`, `foreign_key_check`, a decode of every document and `readAggregate` for every session, all inside **one** `db.read`. `ensureBackedUp` → `createBackup` then exports every table and runs integrity again, also on the queue. Every write waits behind both, and that includes the first `Log` after a cold start that reopens an unfinished workout. With hundreds of sessions, each a native bridge round trip, this is seconds on the phone.

It's harmless in this build because there's no logging yet. Before the logging slice ships, either skip the launch integrity check and catch-up backup while a workout is active, or split the check into chunks so the queue is released between them.

### S5. Cold-start recovery makes `Workout` the root of the stack (flag for the workout screens)
`apps/mobile/src/navigation/AppNavigator.tsx:120`, `apps/mobile/src/screens/WorkoutPlaceholderScreen.tsx:325-328`

With `openWorkout`, the root stack's only route is `Workout`. `Minimise` can't go back, so it `navigate('Tabs')` and **pushes** Tabs above the full-screen modal. Today is then a card over the workout. The iOS back swipe reveals the workout, and `Resume` pops Tabs.

Fix before building Active set on this: start with `[Tabs, Workout]` (`initialState`, or `reset` after mount) so Minimise always pops back to Today.

### S6. `services.manager` is a back door around the service layer (rule 10 API, "no SQL in UI")
`apps/mobile/src/services/app-services.ts:220`

ADR 0009 says `createAppServices` is the only entry point for screens. Returning `manager` gives screens `manager.store.repos` and `manager.store.db`, which means direct repository and SQL access with no Your data / Coaching knowledge split. Only `DeveloperScreen` uses it, for `databaseNames`. Expose `developer.databaseNames()` instead and drop `manager` from the returned object, so the workout screens can't reach past the services.

---

## Nits

- **N1. The SQLite version check can't be reached** (`startup.ts:331-341`). `DatabaseManager.open` creates `STRICT` tables (meta and training) before the check runs, so SQLite older than 3.37 fails as `open_failed` with a raw syntax error and never shows the dedicated screen. This is moot in practice because SQLite 3.50.3 is bundled. If the check is kept, run it on the meta driver before any migration.
- **N2. "Untouched" newer database** (`packages/persistence/src/store.ts:66`, `manager.ts:191-198`). `openStore` runs `PRAGMA journal_mode = WAL` and `open` clears orphan files *before* `migrate` reads `user_version`. The newer-build path also never closes the meta and training connections. system-states acceptance 8 ("byte-identical afterwards") is only tested through `user_version`. Read `user_version` first and close both drivers on `SchemaTooNewError`. The `schema_too_new` screen also lacks `[Copy details]` and the build numbers from the spec.
- **N3. Integrity status doesn't refresh** (`shell/system-banners.ts:12`, `AppStatusScreen.tsx:75-76`). The launch check finishes without telling anyone, so the T2 banner shows only after some later change. If the check throws, App status says `Checking every record…` forever. Notify listeners when it completes, and show `Couldn't run the check` on failure.
- **N4. Errors are mislabelled** (`backup-service.ts:75-79`). `describeWriteError` wraps every failure, including a database export error or `Database is closed` after a future restore, as `The file couldn't be written (…)`.
- **N5. `isInsideApp` uses a string prefix** (`device/files.ts:62-79`). Picker URLs often come back as `/private/var/...` while `Paths.document` is `/var/...`. This is moot today because Fizz's Documents folder isn't visible in Files. Compare resolved paths if that ever changes.
- **N6. Theme flash** (`shell/Root.tsx:120-124`). The theme renders with D before the saved look loads, so a phone set to A flashes D at launch. Wait for prefs, as the launch already waits for data.
- **N7. Labels**:
  - ADR 0009 says `yourData` includes sessions, but `services.sessions` is a top-level sibling.
  - `yourData.counts()` returns the exercise count, which is Coaching knowledge. The UI does place it correctly.
  - `backup-service.ts:22-23` points to `container-files.ts`; the file is `device/files.ts`.
- **N8. Placeholder patterns not to copy** (`WorkoutPlaceholderScreen.tsx:342-354`). On `stale_version` it shows an error but doesn't reload the aggregate, so every retry fails the same way. Discarding with nothing logged has no Undo toast (today.md §4).
- **N9. A mismatched file stays forever** (`backup-service.ts:166-170`). A file whose checksum no longer matches is kept and re-read on every run, and it still counts toward `keep`, so only 13 real automatic backups remain. Move it out of the automatic list once it's found mismatched.
- **N10. Undated passes** (`status/capabilities.ts:62-63`). `pass` without `atUtc` still says `Working`. Require a date, as the comment and the test name say.
- **N11. `ensureBackedUp` depends on `this`** (`backup-service.ts:214`). It breaks if the method is destructured. Call the closure-scoped function instead.
- **N12. A missing database file is recreated empty** (pre-existing in `manager.ts:198`). If the current training file is ever missing, `open` creates an empty one and the app shows first run, not "data can't be opened". Only noted here; it belongs to ADR 0005's follow-up.

## Tests that are missing

The suite is good on the happy paths and on driver semantics. These cases from this review aren't covered:
- Back over a saved gym during setup (B1).
- Rotation when the newer backups are damaged (B2).
- Concurrent `saveUnits` (S1).
- A manifest read error, as distinct from a parse error (S2).
- A name clash with an unrecorded file (S3).
- Navigation state after cold-start recovery (S5).

`fake-expo-sqlite.ts` also doesn't model expo's native connection cache: opening the same path twice shares one ref-counted connection. Nothing relies on that today, but a comment would stop a later test from assuming separate connections.

---

## Spec issues

- **SP1. No-gym start conflicts with the schema.** today.md §3 says that with no gym "the start button stays enabled", but `Session.gymId` is required (`packages/schemas/src/session.ts:151`) and `startWorkout` loads that gym's equipment. The build disables the button and explains why, which is honest. Onboarding's skip copy (`loads won't be checked against equipment`) suggests Ben can still log without a gym. Ben should choose: allow `gymId: null` with "loads not checked", or change today.md and the skip copy to say a gym is needed to start.
- **SP2. The rotation rule needs a "newest good backup" guarantee.** data-import-export DX9 and §3.2 define rotation only by name, checksum and count. The same spec assumes "Your newest good backup: Sun 4 Oct" always exists (lines 321, 727, 760). Add: "Rotation never deletes the newest backup that passed its integrity check."
- **SP3. Back over a saved gym needs an interim rule.** onboarding §3.4 depends on `updateGym`, which comes with the gym editor (not built). The spec should say what Back over a saved gym does until then, for example read-only "Gym saved".
- **SP4. Export picker or folder picker.** ADR 0009's proposal to use the folder picker instead of the export picker (data-import-export §2.2) needs Ben's decision. Device risk: expo-file-system checks `FileSystemUtilities.permissions` for every write and read outside the container. Whether a picked iCloud or On My iPhone folder passes is unverified. If it fails, the feature reports the failure honestly, but the device check in ADR 0009 is load-bearing.

## Notes for the developer building workout screens now

Don't build on:
- `Workout` as the root route (S5).
- `services.manager` (S6).
- The placeholder's finish and discard handling (N8).

Expect logging to wait behind the launch integrity check and catch-up backup until S4 is addressed. Everything else is safe to build on: `useScreenData` with `changed()`, `sessions.startEmpty({gymId, opId})` with the opId kept until success, `afterCommand` triggering backups, and the UI kit.

---

## Re-review of the fixes (9 Oct 2026, commits `c93eba5`..`52bb75c`, checked at `2eb78b4`)

**Result: B1, B2, S1–S4, S6 and N8 are fixed. S5 is fixed at launch only. The remaining S5 pushes are now tracked as B1 in [workout-loop.md](workout-loop.md).** `npm run check` passes: 48 files, 689 tests.

| Item | Status | Evidence |
|---|---|---|
| B1 Back over a saved gym | Fixed | Step 2 shows `Gym saved` read-only with Continue (`SetupScreen.tsx:163-187`). The service refuses a second gym ID while setup is open (`app-services.ts:180-183`), and `skipGym` after a save keeps the gym. Tested. Residual: after a force-close on Step 3, the local `gym` state is empty, so Back shows the gym chooser again. `Save gym` is then refused with an honest message. No duplicate is created; it's just a dead end. |
| B2 Rotation keeps the newest good backup | Fixed | `planRotation` never selects the newest `integrityOk` record (`manifest.ts:125-130`). Tested with 1 good and 15 damaged backups. |
| S1 Concurrent `saveUnits` | Fixed | The check and the insert run in one write transaction (`app-services.ts:148-165`). A concurrent test creates exactly one profile. |
| S2 Manifest read error | Fixed | A read error makes the run non-writable: nothing is written over the record and nothing is rotated, and the run is kept in memory. A parse failure keeps `backup-state.damaged-<utc>.json` first. `manifestProblem` clears after a successful save. Tested. |
| S3 Name clashes | Fixed | `freeName` checks the manifest **and** that the file exists, both on the phone and in the picked folder. Tested. |
| S4 Launch work holds the queue | Fixed | `checkIntegrity` reads in turns (engine checks, then each table, then 10 sessions per turn). A test shows a write landing before the check ends. The catch-up backup is skipped while a workout is unfinished. Residual: the backup after Finish still exports in one turn, so an immediate second workout's first Log can wait behind it. |
| S5 Workout as the root route | Partly fixed | The launch stack is `[Tabs, Workout]` (`initial-state.ts`, tested), so Minimise pops. But `navigate('Tabs', …)` from Summary `Done` and from in-workout Discard **pushes** a new Tabs in React Navigation 7. See workout-loop B1. |
| S6 `services.manager` back door | Fixed | Removed. The Developer screen uses `developer.databaseNames()`. |
| N8 Placeholder patterns | Fixed | `stale_version` reloads in `WorkoutScreen.run`, `FinishSheet.onStale` and Today's discard. Discarding with 0 sets logged has no Undo, per today.md's 2026-10-08 revision. |

The other nits (N1–N7, N9–N12) were out of scope for this pass and remain open.
