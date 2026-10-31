/**
 * Schema version 7: today's edits before Start (ADR 0022, overview-today-edits).
 * Frozen once released.
 *
 * Your data (owner-scoped; rule 10), never in coach context:
 * - `pre_start_drafts`: the saved pre-start draft (Swap today, Skip today,
 *   Do first, Reorder) as a validated document. At most one `open` draft per
 *   owner and basis (`routine:<id>` / `next:<sourceSessionId>`). Versioned;
 *   every write bumps the version. `expires_at_utc` is the next local
 *   midnight in the draft's time zone: a later read or Start treats it as
 *   closed. A session created by any path consumes the draft it was started
 *   from and discards every other open draft, in the same transaction.
 *
 * Sessions:
 * - `sessions.today_edits`: the applied edits a workout was started with
 *   (`SessionTodayEdits` JSON). NULL = none (every workout before this).
 * - `session_sets.skipped_by`: `before_start` for a set skipped on the
 *   overview; NULL = skipped in the workout, or not skipped.
 *
 * Coach actions:
 * - `coach_actions.kind` gains `update_routine` (Ben's `Change Push A too ›`
 *   through a change-review card, TE4). SQLite can't alter a CHECK, so the
 *   table is rebuilt with the same columns, rows, indexes and trigger.
 */
export const MIGRATION_0007 = `
CREATE TABLE pre_start_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  basis_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'consumed', 'discarded', 'expired')),
  version INTEGER NOT NULL CHECK (version >= 1),
  expires_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX pre_start_drafts_one_open ON pre_start_drafts (owner_id, basis_key) WHERE status = 'open';
CREATE INDEX pre_start_drafts_owner ON pre_start_drafts (owner_id, status);

ALTER TABLE sessions ADD COLUMN today_edits TEXT CHECK (today_edits IS NULL OR json_valid(today_edits));
ALTER TABLE session_sets ADD COLUMN skipped_by TEXT CHECK (skipped_by IS NULL OR skipped_by IN ('before_start', 'in_workout'));

CREATE TABLE coach_actions_v7 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v7 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v7 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
