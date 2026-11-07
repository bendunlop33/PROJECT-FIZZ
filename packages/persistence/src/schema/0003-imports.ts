/**
 * Schema version 3 (FitNotes import, data-import-export §2.5, §3.4, §4.3).
 * Frozen once released: enum lists are spelled out here.
 *
 * New tables (all Your data, owner-scoped; rule 10):
 * - `import_jobs`: one document per committed import (file checksum, answers,
 *   planned counts, status). At most one `committing` job per owner.
 * - `import_rows`: every source row of a job, as written, with what happened
 *   to it and the set it became (check 24). Append-only: never updated or
 *   deleted.
 * - `exercise_aliases`: Ben's answers for source exercise names, so the next
 *   import matches them (one per owner, source and name key).
 *
 * `sessions` is rebuilt (SQLite can't alter a CHECK or NOT NULL in place):
 * - `status` gains `reverted` (Undo import hides a workout, DX7; rows are kept);
 * - `gym_id` may be NULL, for imported workouts whose gym wasn't recorded
 *   (a CHECK keeps it required for workouts logged in the app);
 * - `import_job_id` links an imported workout to its job; only imported
 *   workouts can be `reverted`;
 * - `local_date` marks a date-only workout (FitNotes has no time of day).
 *
 * The rebuild runs inside the migration's transaction with foreign-key checks
 * deferred to commit: the copy is re-inserted under the same name, which
 * resolves the child rows' references before the commit checks them (when a
 * connection enforces foreign keys at all; expo-sqlite's transaction
 * connection doesn't by default). A lost row would fail the commit and leave
 * the database at version 2.
 */
export const MIGRATION_0003 = `
PRAGMA defer_foreign_keys = ON;

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('committing', 'committed', 'reverted')),
  checksum TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX import_jobs_owner ON import_jobs (owner_id, checksum);
CREATE UNIQUE INDEX import_jobs_one_committing ON import_jobs (owner_id) WHERE status = 'committing';
CREATE TRIGGER import_jobs_no_delete BEFORE DELETE ON import_jobs BEGIN SELECT RAISE(ABORT, 'import jobs are never deleted; undo the import instead'); END;

CREATE TABLE import_rows (
  job_id TEXT NOT NULL REFERENCES import_jobs (id),
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  line INTEGER NOT NULL CHECK (line >= 1),
  local_date TEXT,
  exercise_name TEXT NOT NULL,
  cells TEXT NOT NULL CHECK (json_valid(cells)),
  result TEXT NOT NULL CHECK (result IN ('imported', 'skipped_cardio', 'skipped_unsupported', 'skipped_duplicate', 'skipped_date_exists', 'skipped_exercise', 'unreadable')),
  detail TEXT,
  session_id TEXT,
  set_id TEXT,
  imported TEXT CHECK (imported IS NULL OR json_valid(imported)),
  PRIMARY KEY (job_id, row_number),
  CHECK ((result = 'imported') = (imported IS NOT NULL AND session_id IS NOT NULL AND set_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX import_rows_set ON import_rows (set_id) WHERE set_id IS NOT NULL;
CREATE INDEX import_rows_session ON import_rows (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX import_rows_date ON import_rows (local_date, result);
CREATE TRIGGER import_rows_no_update BEFORE UPDATE ON import_rows BEGIN SELECT RAISE(ABORT, 'import_rows are append-only'); END;
CREATE TRIGGER import_rows_no_delete BEFORE DELETE ON import_rows BEGIN SELECT RAISE(ABORT, 'import_rows are append-only'); END;

CREATE TABLE exercise_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('fitnotes')),
  name_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX exercise_aliases_name ON exercise_aliases (owner_id, source, name_key);

CREATE TABLE _sessions_v2_copy AS SELECT * FROM sessions;
DROP TABLE sessions;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  routine_id TEXT,
  routine_name TEXT,
  gym_id TEXT,
  start_operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'discarded', 'reverted')),
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
  CHECK ((ended_at_utc IS NULL) = (ended_at_tz IS NULL)),
  CHECK (gym_id IS NOT NULL OR source = 'import'),
  CHECK ((import_job_id IS NOT NULL) = (source = 'import')),
  CHECK (status <> 'reverted' OR import_job_id IS NOT NULL)
) STRICT;
INSERT INTO sessions (
  id, owner_id, routine_id, routine_name, gym_id, start_operation_id, status, source,
  started_at_utc, started_at_tz, ended_at_utc, ended_at_tz, version, revision, active_set_id,
  equipment_snapshot, paused_at_utc, last_activity_at_utc, check_in, check_in_id
)
SELECT
  id, owner_id, routine_id, routine_name, gym_id, start_operation_id, status, source,
  started_at_utc, started_at_tz, ended_at_utc, ended_at_tz, version, revision, active_set_id,
  equipment_snapshot, paused_at_utc, last_activity_at_utc, check_in, check_in_id
FROM _sessions_v2_copy;
DROP TABLE _sessions_v2_copy;
CREATE UNIQUE INDEX sessions_start_operation ON sessions (owner_id, start_operation_id);
CREATE UNIQUE INDEX sessions_one_active ON sessions (owner_id) WHERE status = 'active';
CREATE INDEX sessions_owner_started ON sessions (owner_id, started_at_utc);
CREATE UNIQUE INDEX sessions_check_in ON sessions (check_in_id) WHERE check_in_id IS NOT NULL;
CREATE INDEX sessions_import_job ON sessions (import_job_id) WHERE import_job_id IS NOT NULL;
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions are never deleted; discard instead'); END;
`;
