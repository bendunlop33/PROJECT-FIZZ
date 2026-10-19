/**
 * Schema version 20: coach-built multi-day plans (Ben, 19 Oct). Frozen once
 * released. (Built alongside the cardio branch; if both add a migration, the
 * merge renumbers this one.)
 *
 * - `plan_drafts`: one row per coach plan (Your data, owner-scoped), a
 *   validated JSON document with lookup columns. Open plans are kept 14
 *   days; an applied plan stays while in use (its Apply record is what Undo
 *   reads); a newer plan's Apply marks it `superseded`. Backups carry it
 *   like every table.
 * - `coach_actions.kind` gains `build_plan` (the coach built a plan, or a
 *   new version of one, because Ben asked; a proposal he applies). SQLite
 *   can't alter a CHECK, so the table is rebuilt with the same columns,
 *   rows, indexes and trigger, as migrations 7, 11–14 and 17–19 did. The
 *   CHECK keeps 19's kinds.
 */
export const MIGRATION_0020 = `
CREATE TABLE plan_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'applied', 'superseded', 'discarded', 'expired')),
  version INTEGER NOT NULL CHECK (version >= 1),
  expires_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX plan_drafts_owner ON plan_drafts (owner_id, status, updated_at_utc);

CREATE TABLE coach_actions_v20 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'build_plan', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v20 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v20 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
