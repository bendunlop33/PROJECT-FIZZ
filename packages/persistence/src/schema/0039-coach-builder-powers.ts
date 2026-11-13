/**
 * Schema version 39 (ADR 0039, Ben 29 Oct: "Can we make the coach across chats have broader and more homogenous edit
 * rights?"). Frozen once released.
 *
 * - `coach_actions.kind` gains `propose_workout_edit` (a change to Your workout before Start, from any chat: a
 *   proposal with Apply / Skip) and `fill_setup` (today's Set up filled from Ben's words). Migration 30 left these
 *   for the coach slice. SQLite can't alter a CHECK, so the table is rebuilt with the same columns, rows, indexes
 *   and trigger, as migration 28 did; the CHECK keeps 28's kinds.
 */
export const MIGRATION_0039 = `
CREATE TABLE coach_actions_v39 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'build_plan', 'propose_exercise', 'pause_plan', 'update_gym', 'set_lift_target', 'log_activity', 'propose_week', 'propose_workout_edit', 'fill_setup', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v39 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v39 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
