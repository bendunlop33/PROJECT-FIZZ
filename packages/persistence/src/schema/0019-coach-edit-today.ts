/**
 * Schema version 19: the coach's one tool for today's live workout (Coach v3,
 * ADR 0027, 18 Oct). Frozen once released.
 *
 * - `coach_actions.kind` gains `edit_today` (swaps, adds, removals, moves,
 *   set counts and set targets as one operation; an offer of one is saved as
 *   a `proposed` record that Ben's accept applies). SQLite can't alter a
 *   CHECK, so the table is rebuilt with the same columns, rows, indexes and
 *   trigger, as migrations 7, 11–14, 17 and 18 did. The CHECK keeps 18's kinds.
 */
export const MIGRATION_0019 = `
CREATE TABLE coach_actions_v19 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v19 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v19 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
