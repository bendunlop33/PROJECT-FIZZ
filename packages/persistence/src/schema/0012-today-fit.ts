/**
 * Schema version 12: the coach's fit to time (fit-to-time.md §8, slice C).
 * Frozen once released.
 *
 * Built on the workout-library branch as 8 and renumbered 12 at the merge
 * with main, after 8 (deleted-workouts), 9 (progress), 10 (workout-gaps) and
 * 11 (coach-set-actions). The SQL doesn't depend on the number.
 *
 * Coach actions:
 * - `coach_actions.kind` gains `fit_today` (the coach's fit of today's plan,
 *   applied because Ben asked, with Undo). SQLite can't alter a CHECK, so the
 *   table is rebuilt with the same columns, rows, indexes and trigger, as
 *   migrations 7 and 11 did. The CHECK keeps migration 11's kinds
 *   (`log_set`, `correct_set`, `suggest_memory`).
 *
 * Nothing else: the built-in trim needs no migration (the fit is a draft
 * edit in the draft's JSON; cut sets reuse `skipped_by = 'before_start'`).
 */
export const MIGRATION_0012 = `
CREATE TABLE coach_actions_v12 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v12 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v12 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
