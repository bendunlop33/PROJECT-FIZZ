/**
 * Schema version 13: coach-built workout drafts (workout-builder.md v1.0
 * §8.2). Frozen once released.
 *
 * - `workout_drafts`: one row per coach draft (Your data, owner-scoped),
 *   a validated JSON document with lookup columns. Kept 14 days, then
 *   `expired` (BD4). Backups carry it like every table; a restore keeps
 *   restored drafts `open` on their own 14-day clock.
 * - `coach_actions.kind` gains `build_workout` (the coach built a draft, or
 *   a new version of one, because Ben asked). SQLite can't alter a CHECK,
 *   so the table is rebuilt with the same columns, rows, indexes and
 *   trigger, as migrations 7, 11 and 12 did. The CHECK keeps 12's kinds.
 * - `sessions.coach_draft`: the draft a workout was started from
 *   (provenance for `Why?`, §6.3). Null on every other workout.
 */
export const MIGRATION_0013 = `
CREATE TABLE workout_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'started', 'discarded', 'expired')),
  version INTEGER NOT NULL CHECK (version >= 1),
  expires_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX workout_drafts_owner ON workout_drafts (owner_id, status, expires_at_utc);

CREATE TABLE coach_actions_v13 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v13 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v13 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;

ALTER TABLE sessions ADD COLUMN coach_draft TEXT CHECK (coach_draft IS NULL OR json_valid(coach_draft));
`;
