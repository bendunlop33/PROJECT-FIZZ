/**
 * Schema version 26: the coach can update a gym's equipment (Ben, 20 Oct:
 * "update as we go and train the app for each gym"; ADR 0029). Frozen once
 * released. Written as 25 on its branch; renumbered to 26 on merge because
 * plan-pause took 25 first (its SQL is independent of 25's).
 *
 * - `coach_actions.kind` gains `update_gym` (applied with Undo when Ben said
 *   it, else a card he applies). SQLite can't alter a CHECK, so the table is
 *   rebuilt with the same columns, rows, indexes and trigger, as migrations 7,
 *   11–14, 17–20, 23 and 25 did. The CHECK keeps 25's kinds (incl. `pause_plan`).
 * - The quick gym fields themselves (a gym's `setup` and `missingKinds`, an
 *   item's `notFor`) need no column: they live inside the gym and equipment
 *   documents, optional, so older rows read as before.
 */
export const MIGRATION_0026 = `
CREATE TABLE coach_actions_v26 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'build_plan', 'propose_exercise', 'pause_plan', 'update_gym', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v26 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v26 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
