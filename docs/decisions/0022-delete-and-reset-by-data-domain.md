# 0022: Delete my data and Reset coaching knowledge as database file swaps

**Status:** Proposed, 2026-10-11 (developer). Ben to confirm the two divergences below. Built and tested on Linux (real SQLite through the node driver and the expo-sqlite stand-in); not yet run on the iPhone.

## Context
data-import-export §2.6, §2.7, §3.6 and §4.5 (CLAUDE.md rule 10) ask for `Export: My data / Coaching knowledge only`, `Delete my data (keep coaching knowledge)` and `Reset coaching knowledge`, atomic and resumable after a force-close. The schema's append-only triggers forbid deleting sessions, sets, audits, coach records, memories and playbook candidates inside SQLite (ADR 0005: "deleting data is deleting database files"). Dropping the triggers would need a migration and would weaken the history guarantees for every other write.

## Decision
- **Every table is assigned to a domain** in `packages/persistence/src/data-domains.ts`. `exercises` is split by `owner_id` (no owner: Coaching knowledge; an owner: Your data, the same rule as the restore preview). A test compares the list with `sqlite_master`, so a new table fails until it is classified.
- **Delete** builds a new database file with only the Coaching-knowledge rows, integrity-checks it, and switches the `fizz-meta.db` pointer in one transaction (the restore mechanism). It then removes the old file and the rollback generation and clears the last-restore record. A force-close before the switch leaves all of Ben's data; after it, none. The app keeps a marker (`data-ops.json`) from just before the switch, and the next launch finishes the rest before anything is shown: the old files, rest alerts, ChatGPT sign-out (bounded, offline is fine), every Keychain item by key, and the Your-data files outside SQLite (`coach-connection.json`, `device-prefs.json`).
- **Reset** builds a new file with every Your-data row, the knowledge exercises Ben's records use, and the bundled starter list. It switches in one transaction and keeps the old file as the rollback generation. It never touches credentials.
- Both are confirmed against a **stamp** of the current data (rule 5, the restore preview's stamp) and are idempotent by **op ID** (the ledger remembers the last 20).
- **Export** writes one domain as JSON (`format: 'fizz-export'`, JSON columns opened) through the Files folder picker, then reads it back.
- No training-schema migration. The meta database is unchanged.

## Divergences from the spec (for Ben)
1. **A backup on this phone is made right before Delete and kept** (reason `before_delete`), so an accidental delete can be restored. §4.5 step 3 says Delete removes the on-phone backups and writes a knowledge-only one. Here the existing on-phone backups are kept and rotate as usual, and the alert says `A backup is saved on this phone first.` Reset also backs up first (`before_reset`).
2. **No `Undo last reset` row or toast yet.** The rollback generation is kept, but `fizz-meta.db`'s `switch_reason` only allows `restore` and `rollback`. Showing `Undo last reset` needs a meta-database migration. Until then the `before_reset` backup is the way back.

## Consequences
- Delete and Reset copy the whole database once (about 1.2 MB per 300 workouts, ADR 0005). Time on the phone is to be measured.
- Custom exercises (an owner) are deleted with Your data and untouched by Reset. Open decision B12 would make them Coaching knowledge; this is a one-line change in `domainOf`.
- **Not built:** CSV and FitNotes 2 CSV export, export ranges, the iOS share sheet (export uses the folder picker), guide files and the guide index (not in the app yet), saved import layouts (no table yet; the import's `exercise_aliases` are Your data and deleted), cancelling AlarmKit alarms and Live Activities (not wired yet; only the rest notification is cancelled), releasing a backup-folder bookmark (not stored yet).
- **Device checks:** Keychain items gone after Delete (including after a reinstall), `deleteDatabaseAsync` removes `-wal`/`-shm` for the old files, a force-close during the cover finishes on relaunch, and the folder-picker export to iCloud Drive.
