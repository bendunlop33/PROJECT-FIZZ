/**
 * Schema version 6: coach v1 storage (ADR 0020 §9). Frozen once released.
 *
 * **Numbering:** was 4, then 5; main took 4 (active-set follow-ups) and 5
 * (gym switch), so coach is 6. It doesn't touch either one's tables.
 *
 * Your data (owner-scoped; rule 10):
 * - `coach_threads`: conversations (documents).
 * - `coach_turns`: one row per request; `running` at launch means the app was
 *   closed mid-turn and becomes `interrupted` (restart recovery).
 * - `coach_messages`: Ben's input and the coach's checked reply, append-only.
 * - `coach_actions`: every `ActionRecord`, written in the same transaction as
 *   the change it describes. `op_id` is unique per owner, so a replayed tool
 *   call finds the record instead of writing twice (rule 5). Never deleted;
 *   only `undoneBy` changes, with the version.
 * - `memories`: facts Ben asked the coach to remember. At most one active
 *   memory per content key; forgetting is a tombstone (`forgotten`).
 *
 * Coaching knowledge (no owner; rule 10):
 * - `playbook_candidates`: general rules to review; never used until approved.
 *
 * - `next_session_targets` (C8, added before release): the coach's target per
 *   exercise for the next workout from a finished one (D21). One row per
 *   source workout and exercise; status changes are versioned, never deleted.
 *
 * Offers (CA4) are kept in memory per workout in v1; structural proposals
 * are not built yet.
 */
export const MIGRATION_0006 = `
CREATE TABLE coach_threads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX coach_threads_owner ON coach_threads (owner_id, updated_at_utc);
CREATE TRIGGER coach_threads_no_delete BEFORE DELETE ON coach_threads BEGIN SELECT RAISE(ABORT, 'coach threads are never deleted by the app'); END;

CREATE TABLE coach_turns (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES coach_threads (id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed', 'cancelled')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX coach_turns_thread ON coach_turns (thread_id);
CREATE INDEX coach_turns_running ON coach_turns (owner_id) WHERE status = 'running';
CREATE TRIGGER coach_turns_no_delete BEFORE DELETE ON coach_turns BEGIN SELECT RAISE(ABORT, 'coach turns are never deleted'); END;

CREATE TABLE coach_messages (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES coach_threads (id),
  turn_id TEXT NOT NULL REFERENCES coach_turns (id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  role TEXT NOT NULL CHECK (role IN ('ben', 'coach')),
  created_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX coach_messages_order ON coach_messages (thread_id, ordinal);
CREATE INDEX coach_messages_turn ON coach_messages (turn_id);
CREATE TRIGGER coach_messages_no_update BEFORE UPDATE ON coach_messages BEGIN SELECT RAISE(ABORT, 'coach messages are append-only'); END;
CREATE TRIGGER coach_messages_no_delete BEFORE DELETE ON coach_messages BEGIN SELECT RAISE(ABORT, 'coach messages are append-only'); END;

CREATE TABLE coach_actions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;

CREATE TABLE memories (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  content_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'forgotten')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX memories_one_active ON memories (owner_id, content_key) WHERE status = 'active';
CREATE TRIGGER memories_no_delete BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'memories are tombstoned, not deleted'); END;

CREATE TABLE playbook_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  content_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('to_review', 'withdrawn')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX playbook_candidates_one_open ON playbook_candidates (content_key) WHERE status = 'to_review';
CREATE TRIGGER playbook_candidates_no_delete BEFORE DELETE ON playbook_candidates BEGIN SELECT RAISE(ABORT, 'playbook candidates are withdrawn, not deleted'); END;

CREATE TABLE next_session_targets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('saved', 'undone', 'proposed', 'applied', 'not_applied')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX next_session_targets_one ON next_session_targets (owner_id, source_session_id, exercise_id);
CREATE INDEX next_session_targets_action ON next_session_targets (action_id);
CREATE TRIGGER next_session_targets_no_delete BEFORE DELETE ON next_session_targets BEGIN SELECT RAISE(ABORT, 'next-session targets are never deleted'); END;
`;
