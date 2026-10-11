/**
 * Schema version 10: the coach can log or correct a set when Ben tells it to
 * in chat (backlog §4.3, accepted 11 Oct). Frozen once released.
 *
 * Coach actions:
 * - `coach_actions.kind` gains `log_set` and `correct_set`. The set itself is
 *   written by the workout's own `log_set` / `correct_set` commands in the
 *   same transaction as the record. SQLite can't alter a CHECK, so the table
 *   is rebuilt with the same columns, rows, indexes and trigger (as in 7).
 *
 * Memories (Your data):
 * - `memories.status` gains `suggested` (the coach suggested it; waits for
 *   Ben's Save, never sent to the coach) and `not_saved` (Ben's Not now).
 *   Rebuilt the same way; the one-active-per-key index stays.
 * - `coach_actions.kind` also gains `suggest_memory`.
 *
 * Merge note: versions 8 (delete-workouts) and 9 (workout-library) are being
 * built on other branches. If either rebuilds `coach_actions` with new kinds,
 * this CHECK list must include them too.
 */
export const MIGRATION_0010 = `
CREATE TABLE coach_actions_v10 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v10 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v10 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;

CREATE TABLE memories_v10 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  content_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'forgotten', 'suggested', 'not_saved')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO memories_v10 (id, owner_id, content_key, status, version, updated_at_utc, data)
  SELECT id, owner_id, content_key, status, version, updated_at_utc, data FROM memories;
DROP TABLE memories;
ALTER TABLE memories_v10 RENAME TO memories;
CREATE UNIQUE INDEX memories_one_active ON memories (owner_id, content_key) WHERE status = 'active';
CREATE TRIGGER memories_no_delete BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'memories are tombstoned, not deleted'); END;
`;
