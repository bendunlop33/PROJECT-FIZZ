# 0024: Deleted workouts as a status, and the purge as a narrow trigger exception

**Status:** Proposed, 11 Oct 2026 (developer). Design: [delete-workouts.md](../design/delete-workouts.md) (DW-D1, DW-D4, §6.4, DW-Q2). Changes ADR 0005 ("deleting data is deleting database files") for one case: purging a workout Ben deleted 30 days ago. Number and migration 8 may collide with another branch; whichever merges second renumbers before a build reaches the phone.

## Context

Ben asked to "delete old records". The spec makes a delete a reversible status change, restorable for 30 days, then purged so only a tombstone remains. ADR 0005's append-only triggers refuse every `DELETE` of a session's rows, and ADR 0023 removes data only by rebuilding the database file. The spec recommends the ADR 0023 file rebuild for the purge (DW-Q2) and lists a narrow trigger exception as the alternative.

## Decision

1. **`deleted` is a session status** (migration 8 rebuilds `sessions` to widen the `CHECK`), with a deletion record (`deleted_at_utc/tz`, `deleted_by_op_id`, `purge_after_utc`) present exactly when the status is `deleted`. Every SQL reader that already filtered `status = 'finished'` excludes deleted workouts with no further change, and every domain reader goes through one predicate, `isInHistory` (SQL form `inHistorySql`). A source scan test fails if a new reader compares a status with `finished` directly (DW19), and a test on real SQLite runs every reader with one workout deleted and compares against a history that never had it.
2. **Delete and Restore are versioned, all-or-nothing writes** of the session aggregate: version and revision bump, the operation is recorded in `processed_operations` (`delete_workout` / `restore_workout`, with a fingerprint of the selection), so a retry with the same op ID is a duplicate and a reused op ID with a different selection is refused. No set, exercise or audit row changes.
3. **The purge deletes rows inside SQLite, under a narrow exception** instead of a file rebuild. Migration 8 adds `purged_sessions` (tombstone: ID, owner, deleted-at, purged-at, purge op, import job; no training values; append-only) and re-creates the `DELETE` triggers on `sessions`, `session_sets`, `session_exercises`, `set_audit`, `timing_audit`, `processed_operations`, `session_pauses` and `import_rows` with a `WHEN` clause: a row may go only if its session has a tombstone, and a tombstone can be written only for a session whose status is `deleted` (or that isn't stored, as when a backup is loaded). A tombstoned ID can never be inserted again. UPDATE triggers are unchanged. The purge is one transaction: a force-close leaves all of it or none (DW22).
4. **When:** at launch, after the launch backup check, when no workout is unfinished, with a daily op ID. `Delete now` purges at once.

## Why not the file rebuild

- A daily rebuild would replace the single rollback slot, so `Undo last restore` / `Undo last reset` would be lost every time a purge ran (ADR 0023 keeps one generation), and it needs the marker, resume and cover machinery for a change that touches a handful of rows.
- A transaction can't lose a set logged meanwhile, so the "never while a workout is unfinished" rule is kept only because the spec asks for it, not because it is needed.
- The exception is small and testable: tests show the database still refuses deleting a finished workout's rows, a deleted workout's rows without a tombstone, a tombstone, and re-inserting a purged ID.

## Divergences from the spec (for the PM / Ben)

- **Purge timing:** launch only (not "return to foreground"), and not limited to once a day: it is an indexed query that writes nothing when nothing is due. Foreground purge needs an AppState hook in Root; not built.
- **`Delete now` while a workout is unfinished** purges at once (one transaction), instead of marking rows purge-due for later.
- **Coach records and next-session targets of a purged workout are kept** (DW-D6 keeps conversations; targets and coach actions have their own append-only triggers). The purge removes the session's rows, its check-in, its coach offers and its import rows.
- **Copy:** `Couldn’t delete. Nothing was changed.` is banned by the minimal-copy audit (`Nothing was changed`); the app shows `Couldn’t delete.` with `Try again`.

## Consequences

- Backups carry deleted workouts as `deleted` with their dates and tombstones; a restored backup puts them back in Recently deleted with the original clock (past 30 days: never shown, purged at the next launch). `verifyBackup` counts them as `deletedWorkouts`, not in the workout total. Export `My data` leaves them and tombstones out. `Delete my data` removes both (they are Your data).
- Restoring a backup **taken before** the delete brings the workout back as it was in the file (DW28 / DW-Q4 `Keep deleted` isn't built).
- Device checks: migration 8 on the phone's real database (a `sessions` rebuild with foreign keys deferred, as migration 3), time of the launch purge on a large history.
