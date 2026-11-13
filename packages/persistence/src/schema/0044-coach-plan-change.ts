/**
 * Schema version 44 (Ben, 2 Nov: plan-level coach changes and rest settings). Frozen once released.
 *
 * - `coach_actions.kind` gains `propose_plan_change` (a lighter week, days a week, plan length, Set/Any days or End of
 *   the plan in use: always a proposal Ben applies, with Undo) and `update_rest_settings` (his default rests, `Rest when
 *   short on time` and `Shorten main lift too`, applied when he asks, with Undo). The settings are fields of the
 *   `training_profiles` JSON document and a plan's lighter weeks are in its builder answers (no columns). SQLite can't
 *   alter a CHECK, so the table is rebuilt with the same columns, rows, indexes and trigger, as migration 43 did; the
 *   CHECK keeps 42's and 43's kinds (`set_exercise_preference`, `propose_rebalance`, `fix_workout`).
 */
export const MIGRATION_0044 = `
CREATE TABLE coach_actions_v44 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'build_plan', 'propose_exercise', 'pause_plan', 'update_gym', 'set_lift_target', 'log_activity', 'propose_week', 'propose_workout_edit', 'fill_setup', 'propose_plan_swap', 'update_warmup_prefs', 'set_exercise_preference', 'propose_rebalance', 'fix_workout', 'propose_plan_change', 'update_rest_settings', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v44 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v44 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
