# 0005: Local persistence and backup/restore

**Status:** Proposed, 2026-10-08 (developer; for review)

## Context
Build step 2 needs the domain's repository ports (ADR 0002) on local SQLite. ADR 0004 moves a tested backup and restore into the first milestone, before any real workout is logged: on the free SideStore route, deleting the app or changing the signing identity leaves an empty database (research `free-ios-install.md` §4, §8). The code must be testable on Linux before the Expo app exists, and must satisfy review nit 8 (validate persisted rows on read) and third-review follow-up 5 (the history mapper carries `side`).

## Decision

### Package and driver
- New package `packages/persistence` (`@fizz/persistence`). It depends on `@fizz/domain`, `@fizz/schemas` and zod, and has no native npm dependencies.
- `SqlDriver` is a small async port: `exec`, `run`, `getAll`, `getFirst`, `withExclusiveTransaction`, `close`.
  - Tests use `openNodeDriver` over Node's built-in `node:sqlite` (Node ≥ 22.13, already the repo's engine floor). It is exported from `@fizz/persistence/node` only, so it never reaches the app bundle.
  - The expo-sqlite adapter (a thin wrapper over `withExclusiveTransactionAsync`) will be written in `apps/mobile`. Its expected shape and caveats are documented in `driver.ts`.
- `Database` puts every repository call (reads too) through one serialised queue (research §2.1). Each write runs in one exclusive transaction.

### Storage layout (resolves ADR 0002's open question)
- **Documents:** profile, gyms, equipment, exercises, routines and progression rules are stored as their validated record in a JSON `data` column, plus the columns needed for lookups and `version`. On read, the document and the columns must agree.
  - These records are edited as wholes, and equipment kinds differ too much for one column set.
- **Session aggregate:** normalised into `sessions`, `session_pauses`, `session_exercises`, `session_sets`, `rest_timers`, `work_intervals`, `set_audit`, `timing_audit` and `processed_operations`.
  - The actual result of a set (load value, unit and convention; reps; duration; RPE; RIR), its status, type and side are real columns, so history can be queried in SQL.
  - Small nested value objects are JSON: planned values, rest, draft, flags, audit snapshots, equipment snapshot.
- Timestamps are ISO-8601 UTC text, with an IANA zone column wherever the domain has a zoned timestamp.
- Tables are `STRICT`, so a wrong type is an error, not a silent coercion. Enums have `CHECK` constraints, and JSON columns have `json_valid`. This needs SQLite ≥ 3.37.
- A partial unique index allows only one active session per owner. `(owner, startOperationId)` is unique.
- **Append-only at two levels:**
  - Triggers reject UPDATE/DELETE on the audit, timing audit, processed operations and pauses. They also reject DELETE on sessions, session exercises and sets (sets are tombstoned).
  - On save, the repository also checks that every stored audit entry, operation, pause, exercise and set is still present in the same order. If not, it throws `HistoryRewriteError` and rolls back. A buggy caller can't drop history by saving an older aggregate.

### Validation and failure
- Every record is validated with the `@fizz/schemas` schema before it is written (`InvalidRecordError`, nothing written) and after it is read (`CorruptDataError`).
- Decoding passes stored values through unchanged, so the schema rejects bad data rather than having it guessed into a default.
- Aggregates also fail on dangling internal references, e.g. a set pointing at a missing session exercise. Gaps in append-only ordinals count as corruption (a lost row).
- **Foreign keys:**
  - They are declared but not relied on. `withExclusiveTransactionAsync` uses a separate connection, so per-connection `PRAGMA foreign_keys` can't be guaranteed.
  - Where a driver enforces them (node:sqlite does by default), writes defer the checks to commit.
  - `checkIntegrity` runs `PRAGMA foreign_key_check`.

### Migrations
- `PRAGMA user_version`, forward-only, one exclusive transaction per migration that also sets the version. A failed migration leaves the database as it was.
- Migration SQL is frozen: enum lists are spelled out, not read from schemas.
- A database from a newer build is never touched (`SchemaTooNewError`).
- Tests build the schema from empty and from every prior version and compare it with `sqlite_master`. They also cover rollback of a failed migration and a data-carrying later migration.

### Backup format
- `createBackup(store, {at, app})` produces one JSON file:
  - `format: 'fizz-backup'`, `formatVersion: 1`, `createdAt` (UTC + zone), `app` (name, version, build);
  - the database `schemaVersion`, per-table `counts`, and every row of every table, in primary-key order;
  - a SHA-256 checksum over everything else.
  - It returns the text and a suggested file name. Writing it to a user-chosen Files location is `apps/mobile`'s job.
- **Raw rows at the database's own schema version, not a domain-shaped export.** An old backup is restored by building a fresh database at its version, loading the rows, and running the same migrations forward. So there is one migration chain, not two.
  - A human-readable, portable `exportTrainingData` (brief §7, CSV or JSON by entity) stays a separate later slice.
- SHA-256 is a small pure-TypeScript implementation, because `node:crypto` doesn't exist on Hermes. It is tested against `node:crypto`. It detects corruption; it is not a signature.
- Files are data (rule 8):
  - tables must be exactly those of the schema version;
  - unknown columns are rejected;
  - values are bound as parameters;
  - every record must pass the integrity check before the restored database is used.

### Restore and rollback
- `DatabaseManager` owns the current database file. A tiny separate SQLite file (`fizz-meta.db`) records the current, previous and orphan file names.
- **Restore:**
  1. Parse and verify the file. Report a preview with counts, whether it is identical, whether it needs migration, and whether it replaces an unfinished workout.
  2. Build a new file.
  3. Load all rows in one transaction, then migrate.
  4. Run the integrity check.
  5. Switch the pointer in one meta transaction.

  The old file becomes `previous` (one generation is kept for `rollback`, and the older one is deleted). Rollback swaps current and previous, so it can itself be undone.
- **Failure handling:**
  - Any failure before the switch removes the half-built file and leaves the current database untouched.
  - A crash mid-restore leaves an `orphan` that the next open deletes.
  - The manager never adopts or deletes a file it didn't create.
- **Duplicate restore:** restoring a file whose content equals the current database returns `unchanged`. Nothing switches, and the rollback target is kept.
- **Restore is modal:** calls still queued on the replaced store fail ("Database is closed") rather than writing to a non-current database. Callers recreate services from the returned store.

### Shared contract and history
- The repository contract tests moved into `packages/domain/test/repository-contract.ts`, exported as `@fizz/domain/testing`. They run against the in-memory, SQLite in-memory and SQLite WAL-file implementations.
- `toHistorySessions(aggregate, exerciseId)` in `packages/domain`:
  - uses finished sessions only and completed sets only;
  - carries `side`;
  - groups by equipment.

  Progression pairs sides by count, so `pairedWithSetId` isn't needed. An other-side row whose partner was deleted (`getSetPair` is null) counts as a lone side. `Store.listExerciseHistory` returns it latest-first.

## Proposed changes needing the product manager / Ben
1. **ADR 0004 says "SQLite snapshot + JSON export".** I built only the JSON snapshot. It contains every table, so it is a full snapshot. A raw `.db` copy (`VACUUM INTO`) would be a second format to restore and test, so I'd drop it unless the device spike shows a reason.
2. **Brief §7 `createBackup(destination)`.** The package returns the file text and the native layer writes it. Brief §5 (Backup row) says "encrypted backup if credentials/private data warrant it". Backups are unencrypted: they hold training data only, and credentials stay in the Keychain. Ben should confirm he's happy with plain-JSON backups in his Files/iCloud Drive.
3. **A backup of a database that already has a corrupt record can be created, but restoring it is refused.** `createBackup` returns the integrity report so the UI can warn. "Restore and skip damaged records" would be a later, explicit choice, never a default.

## Consequences
- **Measured on Node 22 (Linux, not the phone):**
  - about 3 ms to save, and 2 ms to read, the richest test aggregate, including validation;
  - a 300-session backup is 1.2 MB and takes about 0.4 s to create and 0.15 s to parse.

  Hermes will be slower. Measure on the device before deciding whether save-time validation needs trimming.
- **Must be verified on the real iPhone** (via the expo adapter):
  - `select sqlite_version()` ≥ 3.37 and JSON functions available;
  - WAL plus `withExclusiveTransactionAsync` survive a kill mid-write;
  - `deleteDatabaseAsync` removes `-wal`/`-shm`;
  - restore and rollback across an app relaunch;
  - backup file size and time with a real FitNotes import.
- Deleting data is deleting database files: the triggers deliberately forbid deleting sessions inside SQLite.
- **Open:**
  - the expo-sqlite driver and `DatabaseHost` in `apps/mobile`;
  - the Files picker/share flow and restore preview UI (designer);
  - whether one rollback generation is enough;
  - a `HistoryRepository` port if the coach needs history queries beyond `listExerciseHistory`.
