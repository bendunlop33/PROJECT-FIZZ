/**
 * Schema version 1. Frozen once released: enum lists are spelled out here
 * rather than read from `@fizz/schemas`, so a later schema change can't
 * silently alter what this migration does. Change things in a new migration.
 *
 * Layout (ADR 0005):
 * - Profile, gyms, equipment, exercises, routines and progression rules are
 *   documents: the validated record as JSON in `data`, plus the columns needed
 *   for lookups and optimistic concurrency (`version`). Reads check that the
 *   columns and the document agree.
 * - The session aggregate is normalised: one row per session, exercise, set,
 *   pause, audit entry and processed operation, with real columns for what we
 *   query (status, set type, side, the actual result) and JSON only for small
 *   nested value objects (planned values, rest, drafts, equipment snapshot).
 * - Timestamps are ISO-8601 UTC text, with an IANA zone column wherever the
 *   domain has a zoned timestamp.
 * - History is append-only at the database level: triggers reject UPDATE and
 *   DELETE on audit, timing audit, processed operations and pauses, and DELETE
 *   on sessions, session exercises and sets (sets are tombstoned, not deleted).
 */
export const MIGRATION_0001 = `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE gyms (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX gyms_owner ON gyms (owner_id);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  gym_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('barbell', 'plate_loaded_machine', 'dumbbells', 'weight_stack', 'assisted_stack', 'bodyweight_station')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX equipment_gym ON equipment (gym_id);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE routines (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX routines_owner ON routines (owner_id);

CREATE TABLE progression_rules (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  routine_id TEXT,
  routine_name TEXT,
  gym_id TEXT NOT NULL,
  start_operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'discarded')),
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
  CHECK ((ended_at_utc IS NULL) = (ended_at_tz IS NULL))
) STRICT;
CREATE UNIQUE INDEX sessions_start_operation ON sessions (owner_id, start_operation_id);
-- At most one unfinished workout per owner (ports.ts: getActive).
CREATE UNIQUE INDEX sessions_one_active ON sessions (owner_id) WHERE status = 'active';
CREATE INDEX sessions_owner_started ON sessions (owner_id, started_at_utc);

CREATE TABLE session_pauses (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  PRIMARY KEY (session_id, ordinal)
) STRICT;

CREATE TABLE session_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  measurement TEXT NOT NULL CHECK (measurement IN ('reps', 'duration')),
  laterality TEXT NOT NULL CHECK (laterality IN ('bilateral', 'unilateral')),
  equipment_id TEXT,
  load_convention TEXT NOT NULL CHECK (load_convention IN ('total', 'per_hand', 'stack', 'added', 'assistance', 'bodyweight')),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
  sort_order INTEGER NOT NULL,
  superset_group TEXT,
  transition_rest_s INTEGER,
  progression_rule_id TEXT
) STRICT;
CREATE INDEX session_exercises_exercise ON session_exercises (exercise_id);

CREATE TABLE session_sets (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  session_exercise_id TEXT NOT NULL REFERENCES session_exercises (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  set_index INTEGER NOT NULL CHECK (set_index >= 0),
  set_type TEXT NOT NULL CHECK (set_type IN ('warmup', 'working', 'top', 'backoff', 'drop')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'deleted')),
  side TEXT CHECK (side IN ('left', 'right', 'both')),
  paired_with_set_id TEXT REFERENCES session_sets (id),
  planned TEXT NOT NULL CHECK (json_valid(planned)),
  rest TEXT NOT NULL CHECK (json_valid(rest)),
  has_actual INTEGER NOT NULL CHECK (has_actual IN (0, 1)),
  actual_load_value REAL,
  actual_load_unit TEXT CHECK (actual_load_unit IN ('kg', 'lb')),
  actual_load_convention TEXT CHECK (actual_load_convention IN ('total', 'per_hand', 'stack', 'added', 'assistance', 'bodyweight')),
  actual_reps INTEGER,
  actual_duration_s INTEGER,
  actual_rpe REAL,
  actual_rir INTEGER,
  draft TEXT CHECK (draft IS NULL OR json_valid(draft)),
  completed_at_utc TEXT,
  completed_at_tz TEXT,
  completed_by_op_id TEXT,
  undo_count INTEGER NOT NULL CHECK (undo_count >= 0),
  flags TEXT NOT NULL CHECK (json_valid(flags)),
  edited INTEGER NOT NULL CHECK (edited IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  CHECK ((actual_load_value IS NULL) = (actual_load_unit IS NULL) AND (actual_load_unit IS NULL) = (actual_load_convention IS NULL)),
  CHECK (has_actual = 1 OR (actual_load_value IS NULL AND actual_reps IS NULL AND actual_duration_s IS NULL AND actual_rpe IS NULL AND actual_rir IS NULL)),
  CHECK ((completed_at_utc IS NULL) = (completed_at_tz IS NULL))
) STRICT;
CREATE INDEX session_sets_session ON session_sets (session_id);
CREATE INDEX session_sets_exercise ON session_sets (session_exercise_id);

CREATE TABLE rest_timers (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rest', 'transition')),
  duration_s INTEGER NOT NULL,
  source TEXT CHECK (source IN ('set_override', 'routine_set_type', 'exercise_default', 'global_default')),
  started_at_utc TEXT NOT NULL,
  deadline_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'expired', 'skipped', 'ended_early', 'cancelled')),
  remaining_ms_at_pause INTEGER,
  ended_at_utc TEXT,
  version INTEGER NOT NULL CHECK (version >= 1)
) STRICT;

CREATE TABLE work_intervals (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  set_id TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  started_at_utc TEXT NOT NULL,
  deadline_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'stopped', 'cancelled')),
  remaining_ms_at_pause INTEGER,
  paused_ms INTEGER NOT NULL CHECK (paused_ms >= 0),
  ended_at_utc TEXT
) STRICT;

CREATE TABLE set_audit (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logged', 'corrected', 'undone', 'skipped', 'deleted')),
  at_utc TEXT NOT NULL,
  before TEXT CHECK (before IS NULL OR json_valid(before)),
  after TEXT CHECK (after IS NULL OR json_valid(after)),
  PRIMARY KEY (session_id, ordinal),
  UNIQUE (session_id, id)
) STRICT;

CREATE TABLE timing_audit (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('startedAt', 'endedAt')),
  source TEXT NOT NULL CHECK (source IN ('finish', 'correction')),
  at_utc TEXT NOT NULL,
  before_utc TEXT,
  before_tz TEXT,
  after_utc TEXT NOT NULL,
  after_tz TEXT NOT NULL,
  PRIMARY KEY (session_id, ordinal),
  UNIQUE (session_id, id),
  CHECK ((before_utc IS NULL) = (before_tz IS NULL))
) STRICT;

CREATE TABLE processed_operations (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  op_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  command_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  at_utc TEXT NOT NULL,
  created_ids TEXT CHECK (created_ids IS NULL OR json_valid(created_ids)),
  PRIMARY KEY (session_id, op_id),
  UNIQUE (session_id, ordinal)
) STRICT;

CREATE TRIGGER set_audit_no_update BEFORE UPDATE ON set_audit BEGIN SELECT RAISE(ABORT, 'set_audit is append-only'); END;
CREATE TRIGGER set_audit_no_delete BEFORE DELETE ON set_audit BEGIN SELECT RAISE(ABORT, 'set_audit is append-only'); END;
CREATE TRIGGER timing_audit_no_update BEFORE UPDATE ON timing_audit BEGIN SELECT RAISE(ABORT, 'timing_audit is append-only'); END;
CREATE TRIGGER timing_audit_no_delete BEFORE DELETE ON timing_audit BEGIN SELECT RAISE(ABORT, 'timing_audit is append-only'); END;
CREATE TRIGGER processed_operations_no_update BEFORE UPDATE ON processed_operations BEGIN SELECT RAISE(ABORT, 'processed_operations is append-only'); END;
CREATE TRIGGER processed_operations_no_delete BEFORE DELETE ON processed_operations BEGIN SELECT RAISE(ABORT, 'processed_operations is append-only'); END;
CREATE TRIGGER session_pauses_no_update BEFORE UPDATE ON session_pauses BEGIN SELECT RAISE(ABORT, 'session_pauses is append-only'); END;
CREATE TRIGGER session_pauses_no_delete BEFORE DELETE ON session_pauses BEGIN SELECT RAISE(ABORT, 'session_pauses is append-only'); END;
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions are never deleted; discard instead'); END;
CREATE TRIGGER session_exercises_no_delete BEFORE DELETE ON session_exercises BEGIN SELECT RAISE(ABORT, 'session exercises are never deleted'); END;
CREATE TRIGGER session_sets_no_delete BEFORE DELETE ON session_sets BEGIN SELECT RAISE(ABORT, 'sets are tombstoned, never deleted'); END;
`;
