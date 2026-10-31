/**
 * Schema version 15: import from any app (data-import-export §9, ADR 0026 §7).
 * Frozen once released: enum lists are spelled out here.
 *
 * New tables (Your data, owner-scoped; rule 10):
 * - `import_profiles`: saved import layouts (AI12). Soft-deleted with Undo;
 *   a row that fails the schema is never used (check 57), so it isn't part
 *   of the strict integrity check and can't stop the app opening.
 * - `import_layout_requests`: one row per layout request, by operation ID
 *   (a repeat returns the stored result and sends nothing) and sample hash
 *   (a spec that arrived before an interruption is reused).
 *
 * `import_rows` is rebuilt (SQLite can't alter a CHECK or a primary key):
 * - `part`: which set of a packed or wide row (`3x8`, `Set 1…Set 4`); the
 *   key becomes `(job_id, row_number, part)` and every existing row is part 0;
 * - `workout_key` and `start_local`: the workout a layout row belongs to and
 *   its start time as written (no zone, AI6); NULL for FitNotes rows;
 * - `result` gains `skipped_value_to_check`, `skipped_not_a_set`, `not_read`.
 * Rows are copied unchanged; the indexes and both append-only triggers
 * (the purge-aware delete trigger of migration 8) come back as they were.
 */
export const MIGRATION_0015 = `
CREATE TABLE import_rows_v15 (
  job_id TEXT NOT NULL REFERENCES import_jobs (id),
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  part INTEGER NOT NULL DEFAULT 0 CHECK (part >= 0 AND part <= 63),
  line INTEGER NOT NULL CHECK (line >= 1),
  local_date TEXT,
  workout_key TEXT,
  start_local TEXT CHECK (start_local IS NULL OR start_local GLOB '[0-2][0-9]:[0-5][0-9]'),
  exercise_name TEXT NOT NULL,
  cells TEXT NOT NULL CHECK (json_valid(cells)),
  result TEXT NOT NULL CHECK (result IN ('imported', 'skipped_cardio', 'skipped_unsupported', 'skipped_duplicate', 'skipped_date_exists', 'skipped_exercise', 'unreadable', 'skipped_value_to_check', 'skipped_not_a_set', 'not_read')),
  detail TEXT,
  session_id TEXT,
  set_id TEXT,
  imported TEXT CHECK (imported IS NULL OR json_valid(imported)),
  PRIMARY KEY (job_id, row_number, part),
  CHECK ((result = 'imported') = (imported IS NOT NULL AND session_id IS NOT NULL AND set_id IS NOT NULL))
) STRICT;
INSERT INTO import_rows_v15 (job_id, row_number, part, line, local_date, workout_key, start_local, exercise_name, cells, result, detail, session_id, set_id, imported)
  SELECT job_id, row_number, 0, line, local_date, NULL, NULL, exercise_name, cells, result, detail, session_id, set_id, imported FROM import_rows;
DROP TABLE import_rows;
ALTER TABLE import_rows_v15 RENAME TO import_rows;
CREATE UNIQUE INDEX import_rows_set ON import_rows (set_id) WHERE set_id IS NOT NULL;
CREATE INDEX import_rows_session ON import_rows (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX import_rows_date ON import_rows (local_date, result);
CREATE TRIGGER import_rows_no_update BEFORE UPDATE ON import_rows BEGIN SELECT RAISE(ABORT, 'import_rows are append-only'); END;
CREATE TRIGGER import_rows_no_delete BEFORE DELETE ON import_rows
  WHEN OLD.session_id IS NULL OR NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = OLD.session_id)
  BEGIN SELECT RAISE(ABORT, 'import_rows are append-only'); END;

CREATE TABLE import_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX import_profiles_owner ON import_profiles (owner_id);

CREATE TABLE import_layout_requests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  sample_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sent', 'proposed', 'rejected', 'failed', 'unavailable')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX import_layout_requests_op ON import_layout_requests (owner_id, operation_id);
CREATE INDEX import_layout_requests_sample ON import_layout_requests (owner_id, sample_hash);
`;
