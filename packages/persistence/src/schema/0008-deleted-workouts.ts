/**
 * Schema version 8: deleting finished workouts (delete-workouts.md, ADR 0024).
 * Frozen once released: enum lists are spelled out here.
 *
 * Self-contained so it can be renumbered if another branch also claims 8
 * (whichever merges second renumbers before a build reaches Ben's phone).
 *
 * `sessions` is rebuilt (SQLite can't alter a CHECK in place), with the same
 * columns, rows, indexes and trigger, plus:
 * - `status` gains `deleted` (DW-D1: a status change, never a row delete);
 * - `deleted_at_utc` / `deleted_at_tz` / `deleted_by_op_id` /
 *   `purge_after_utc`: the deletion record, present exactly when the status
 *   is `deleted`. Restore clears them (the session's processed operations
 *   keep both events).
 *
 * `purged_sessions`: one tombstone per purged workout (§6.4): ID, owner,
 * when it was deleted and purged, the purge operation, its import job and an
 * imported workout's date (so its import's date view can say `This workout
 * was deleted.`; review N4). No training values. Append-only.
 *
 * Purge under the append-only triggers (DW-Q2, ADR 0024): the DELETE
 * triggers on a session's rows now allow a delete only when the session has
 * a tombstone, and a tombstone can be written only for a session that is
 * `deleted` (or is no longer stored, as when a backup is loaded). Every
 * other delete is refused exactly as before. UPDATE triggers are unchanged.
 * A session ID with a tombstone can never be written again.
 *
 * Merge-order guard (review B1): the rebuild copies a frozen column list, so
 * a `sessions` column added by any other migration (for example one that
 * merged first and took number 8) would be dropped without an error. `up`
 * therefore reads `PRAGMA table_info(sessions)` first and refuses, rolling
 * the whole migration back, unless the columns are exactly the 26 below.
 * Whoever merges second must add the other branch's columns to this rebuild
 * (and to the list) or move its ALTER after it.
 *
 * The rebuild runs inside the migration's transaction with foreign-key
 * checks deferred to commit, as migration 3 does: the rows are re-inserted
 * into a table named `sessions` (not renamed into place), which is what
 * resolves the child rows' deferred references before the commit checks them.
 */
import type { SqlExecutor } from '../driver';

/** The `sessions` columns at schema 7, in order. Frozen. */
export const SESSIONS_V7_COLUMNS: readonly string[] = [
  'id', 'owner_id', 'routine_id', 'routine_name', 'gym_id', 'start_operation_id', 'status', 'source',
  'started_at_utc', 'started_at_tz', 'ended_at_utc', 'ended_at_tz', 'version', 'revision', 'active_set_id',
  'equipment_snapshot', 'paused_at_utc', 'last_activity_at_utc', 'check_in', 'check_in_id', 'import_job_id',
  'local_date', 'finish_by_utc', 'finish_by_tz', 'gym_changes', 'today_edits',
];

function columnsMessage(unknown: readonly string[], missing: readonly string[]): string {
  const parts = [unknown.length > 0 ? `unknown column(s) ${unknown.join(', ')}` : null, missing.length > 0 ? `missing column(s) ${missing.join(', ')}` : null].filter((p): p is string => p !== null);
  return `Migration 8 (deleted workouts) refuses to rebuild sessions: ${parts.join('; ')}. Add them to the rebuild before shipping.`;
}

/** Thrown when `sessions` isn't the shape this rebuild was written for. Nothing is changed. */
export class UnexpectedSessionsColumnsError extends Error {
  constructor(
    readonly unknown: readonly string[],
    readonly missing: readonly string[],
  ) {
    super(columnsMessage(unknown, missing));
    this.name = 'UnexpectedSessionsColumnsError';
  }
}

export async function upMigration0008(tx: SqlExecutor): Promise<void> {
  const cols = (await tx.getAll<{ name: string }>('PRAGMA table_info(sessions)')).map((c) => c.name);
  const known = new Set(SESSIONS_V7_COLUMNS);
  const present = new Set(cols);
  const unknown = cols.filter((c) => !known.has(c));
  const missing = SESSIONS_V7_COLUMNS.filter((c) => !present.has(c));
  if (unknown.length > 0 || missing.length > 0) throw new UnexpectedSessionsColumnsError(unknown, missing);
  await tx.exec(MIGRATION_0008);
}

export const MIGRATION_0008 = `
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _sessions_v7_copy AS SELECT * FROM sessions;
DROP TABLE sessions;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  routine_id TEXT,
  routine_name TEXT,
  gym_id TEXT,
  start_operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'discarded', 'reverted', 'deleted')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'import')),
  started_at_utc TEXT NOT NULL,
  started_at_tz TEXT NOT NULL,
  ended_at_utc TEXT,
  ended_at_tz TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  active_set_id TEXT,
  equipment_snapshot TEXT NOT NULL CHECK (json_valid(equipment_snapshot)),
  paused_at_utc TEXT,
  last_activity_at_utc TEXT NOT NULL,
  check_in TEXT CHECK (check_in IS NULL OR json_valid(check_in)),
  check_in_id TEXT,
  import_job_id TEXT REFERENCES import_jobs (id),
  local_date TEXT CHECK (local_date IS NULL OR local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  finish_by_utc TEXT,
  finish_by_tz TEXT CHECK ((finish_by_utc IS NULL) = (finish_by_tz IS NULL)),
  gym_changes TEXT CHECK (gym_changes IS NULL OR json_valid(gym_changes)),
  today_edits TEXT CHECK (today_edits IS NULL OR json_valid(today_edits)),
  deleted_at_utc TEXT,
  deleted_at_tz TEXT,
  deleted_by_op_id TEXT,
  purge_after_utc TEXT,
  CHECK ((ended_at_utc IS NULL) = (ended_at_tz IS NULL)),
  CHECK (gym_id IS NOT NULL OR source = 'import'),
  CHECK ((import_job_id IS NOT NULL) = (source = 'import')),
  CHECK (status <> 'reverted' OR import_job_id IS NOT NULL),
  CHECK ((status = 'deleted') = (deleted_at_utc IS NOT NULL)),
  CHECK ((deleted_at_utc IS NULL) = (deleted_at_tz IS NULL) AND (deleted_at_utc IS NULL) = (deleted_by_op_id IS NULL) AND (deleted_at_utc IS NULL) = (purge_after_utc IS NULL))
) STRICT;
INSERT INTO sessions (
  id, owner_id, routine_id, routine_name, gym_id, start_operation_id, status, source,
  started_at_utc, started_at_tz, ended_at_utc, ended_at_tz, version, revision, active_set_id,
  equipment_snapshot, paused_at_utc, last_activity_at_utc, check_in, check_in_id, import_job_id,
  local_date, finish_by_utc, finish_by_tz, gym_changes, today_edits
)
SELECT
  id, owner_id, routine_id, routine_name, gym_id, start_operation_id, status, source,
  started_at_utc, started_at_tz, ended_at_utc, ended_at_tz, version, revision, active_set_id,
  equipment_snapshot, paused_at_utc, last_activity_at_utc, check_in, check_in_id, import_job_id,
  local_date, finish_by_utc, finish_by_tz, gym_changes, today_edits
FROM _sessions_v7_copy;
DROP TABLE _sessions_v7_copy;
CREATE UNIQUE INDEX sessions_start_operation ON sessions (owner_id, start_operation_id);
CREATE UNIQUE INDEX sessions_one_active ON sessions (owner_id) WHERE status = 'active';
CREATE INDEX sessions_owner_started ON sessions (owner_id, started_at_utc);
CREATE UNIQUE INDEX sessions_check_in ON sessions (check_in_id) WHERE check_in_id IS NOT NULL;
CREATE INDEX sessions_import_job ON sessions (import_job_id) WHERE import_job_id IS NOT NULL;
CREATE INDEX sessions_deleted ON sessions (owner_id, purge_after_utc) WHERE status = 'deleted';

CREATE TABLE purged_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  deleted_at_utc TEXT NOT NULL,
  purged_at_utc TEXT NOT NULL,
  purge_op_id TEXT NOT NULL,
  import_job_id TEXT,
  local_date TEXT
) STRICT;
CREATE INDEX purged_sessions_op ON purged_sessions (owner_id, purge_op_id);
CREATE TRIGGER purged_sessions_no_update BEFORE UPDATE ON purged_sessions BEGIN SELECT RAISE(ABORT, 'purged_sessions is append-only'); END;
CREATE TRIGGER purged_sessions_no_delete BEFORE DELETE ON purged_sessions BEGIN SELECT RAISE(ABORT, 'purged_sessions is append-only'); END;
CREATE TRIGGER purged_sessions_only_deleted BEFORE INSERT ON purged_sessions
  WHEN EXISTS (SELECT 1 FROM sessions s WHERE s.id = NEW.session_id AND s.status <> 'deleted')
  BEGIN SELECT RAISE(ABORT, 'only a deleted workout can be purged'); END;

CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions
  WHEN OLD.status <> 'deleted' OR NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'sessions are never deleted; discard instead'); END;
CREATE TRIGGER sessions_not_purged BEFORE INSERT ON sessions
  WHEN EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = NEW.id)
  BEGIN SELECT RAISE(ABORT, 'this workout was purged'); END;

DROP TRIGGER set_audit_no_delete;
CREATE TRIGGER set_audit_no_delete BEFORE DELETE ON set_audit
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'set_audit is append-only'); END;
DROP TRIGGER timing_audit_no_delete;
CREATE TRIGGER timing_audit_no_delete BEFORE DELETE ON timing_audit
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'timing_audit is append-only'); END;
DROP TRIGGER processed_operations_no_delete;
CREATE TRIGGER processed_operations_no_delete BEFORE DELETE ON processed_operations
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'processed_operations is append-only'); END;
DROP TRIGGER session_pauses_no_delete;
CREATE TRIGGER session_pauses_no_delete BEFORE DELETE ON session_pauses
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'session_pauses is append-only'); END;
DROP TRIGGER session_exercises_no_delete;
CREATE TRIGGER session_exercises_no_delete BEFORE DELETE ON session_exercises
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'session exercises are never deleted'); END;
DROP TRIGGER session_sets_no_delete;
CREATE TRIGGER session_sets_no_delete BEFORE DELETE ON session_sets
  WHEN NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'sets are tombstoned, never deleted'); END;
DROP TRIGGER import_rows_no_delete;
CREATE TRIGGER import_rows_no_delete BEFORE DELETE ON import_rows
  WHEN OLD.session_id IS NULL OR NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'import_rows are append-only'); END;
`;
