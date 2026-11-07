# 0009: App foundation: expo-sqlite driver, app services, on-phone backups

**Status:** Proposed, 2026-10-09 (developer; for review). Device checks listed below are still open.

## Context
The probe-only shell is replaced by the real app (overnight slice 1). It needs the expo-sqlite driver ADR 0005 left open, one place screens get data from, rule 10's split between Your data and Coaching knowledge, and automatic backups kept in the app (brief v0.7, data-import-export.md DX2/DX9).

## Decision

### Driver and launch
- `apps/mobile/src/data/expo-driver.ts` implements `SqlDriver`/`DatabaseHost` against a small structural interface, so it is tested on Linux against a fake that copies expo-sqlite 57.0.4's behaviour (a second connection per `withExclusiveTransactionAsync`, `BEGIN`/`COMMIT`/`ROLLBACK`). The domain repository contract and a restore/rollback round trip pass through it.
- Read from expo-sqlite's source and handled: the transaction result is carried out through a closure; outer and nested use during a transaction, and leaked transaction executors, are refused; rows are checked to be text/number/null; `deleteDatabaseAsync` only removes the main file and throws when it is missing, so the host also removes `-wal`/`-shm`/`-journal` and is a no-op when missing.
- `startApp` opens `DatabaseManager`, refuses a newer-build database (untouched) and SQLite older than 3.37, recovers an unfinished workout, then in the background catches up a missed backup and runs `checkIntegrity`.

### App services and rule 10
- `createAppServices` is the only entry point for screens (no SQL or domain rules in UI). It reads `manager.store` at call time, so a future restore/rollback needs no rebuild.
- Rule 10 is reflected in the API: `yourData` (profile, gyms, equipment, counts, sessions) and `coachingKnowledge` (exercise list, gym presets). Gym presets live in `packages/domain` as general data; a gym saved from one is Your data, with items marked `detailsSource: 'preset'`.
- **Not yet done (needs a persistence slice):** separate tables or namespaces per domain, and the two-section backup format (`formatVersion: 2`, `your_data` / `coaching_knowledge`, per-section checksums and restore; open-decisions developer §1–2). Today one SQLite file and one backup section hold both. The exercise list is still in the shared `exercises` table.

### Small schema additions (optional JSON fields, no SQL migration)
- `UserProfile.setup` `{gymStep?, completedAtUtc?}` so first run resumes at the right step after a force-close.
- `EquipmentInstance.detailsSource` (`preset` | `user`) and `checkedAtUtc` (gym-editor GE1, approved in the bulk defaults).
- `gyms.createWithEquipment` saves a gym and its equipment in one transaction, idempotent by gym ID.

### Backups on this phone
- Files go to `Documents/backups/` with the spec's names (`fizz-backup-YYYY-MM-DD-HHMM-auto.json`, local time). Each is read back and its SHA-256 compared before rotation deletes anything; rotation keeps the last 14 automatic files and deletes only files whose name pattern **and** recorded checksum match. Manual and unknown files are never deleted.
- The record of which files Fizz wrote, the last attempt and the last copy to Files is `Documents/backup-state.json`, **not** the training database: those are facts about this phone, and restoring an old backup must not rewind them. A damaged record is reported and restarted; because rotation only deletes recorded files, nothing is deleted on its strength.
- A committed `SessionFinished` starts a backup without the finish waiting; runs are queued one at a time; a failure is recorded and shown (`Last backup on this phone didn't save`), never thrown.
- `Save a copy to Files` uses expo-file-system's folder picker (`Directory.pickDirectoryAsync`), writes a fresh backup there and reads it back before saying `Copy saved to Files`. A folder inside Fizz's container is refused.

## Proposed change for Ben / the product manager
- The spec says the system **export** picker ("Save to…", data-import-export §2.2). expo-file-system 57 exposes only a folder picker, so Ben picks a folder (e.g. iCloud Drive › Fizz backups) and taps Open. Alternatives: `expo-sharing`'s share sheet (it can't tell us whether a copy was actually saved, so `Copy saved to Files` couldn't be claimed honestly), or a small Swift addition to audio-coach for `UIDocumentPickerViewController(forExporting:)` (needs a Mac-less compile on CI). Recommendation: keep the folder picker unless the device test finds it awkward.

## Device checks still needed (nothing here is "working" until these pass)
- expo-sqlite on the phone: `sqlite_version()` ≥ 3.37 (App status shows it), WAL plus `withExclusiveTransactionAsync` survive a kill mid-write, `deleteDatabaseAsync` + companion clean-up.
- `globalThis.expo.uuidv4` exists in release builds (a Math.random fallback keeps the app usable if not).
- The folder picker's security scope lets the write and read-back succeed in iCloud Drive and On My iPhone, including offline.
- Automatic backup after Finish completes when the phone is locked right away; otherwise the launch catch-up runs.

## Consequences
- `react-native-screens` and `expo-symbols` (ADR 0008) need a new cloud build before this JS runs.
- The workout screen is a labelled stand-in (finish/discard only) until the logging-loop slice. Finishing or discarding test workouts on the phone leaves real rows (sessions are append-only); delete-my-data isn't built yet.
