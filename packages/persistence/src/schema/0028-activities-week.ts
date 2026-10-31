/**
 * Schema version 28: activities and this week's shape (Ben, 20 Oct: "Can we
 * add ability to flex ordering and sessions etc subject to week have eg if I
 * did or have planned a long run maybe we swap to a push rather than
 * shoulder and chest separately"). Frozen once released. Written as 26 on
 * its branch; renumbered to 28 on merge because the quick gym's `update_gym`
 * took 26 and lift targets' `set_lift_target` took 27 first. Both also
 * rebuild `coach_actions`, so the CHECK below lists 27's kinds (incl.
 * `pause_plan`, `update_gym` and `set_lift_target`) plus this one's.
 *
 * - `activities`: a run, ride, swim, sport or other activity, done or planned
 *   (Your data, owner-scoped): a validated JSON document plus its owner,
 *   local date and a deleted flag (a tombstone, so Undo can bring it back).
 * - `week_plans`: a week override Ben applied from the coach's proposal
 *   (merged or skipped days, this week only), with the proposal it applied.
 * - `coach_actions.kind` gains `log_activity` and `propose_week`. SQLite
 *   can't alter a CHECK, so the table is rebuilt with the same columns, rows,
 *   indexes and trigger, as migrations 7, 11–14, 17–20 and 23–27 did. The
 *   CHECK keeps 27's kinds.
 */
export const MIGRATION_0028 = `
CREATE TABLE activities (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX activities_owner_date ON activities (owner_id, deleted, local_date);

CREATE TABLE week_plans (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  week_monday TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'undone')),
  proposal_action_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX week_plans_owner_week ON week_plans (owner_id, week_monday);
CREATE UNIQUE INDEX week_plans_proposal ON week_plans (owner_id, proposal_action_id);

CREATE TABLE coach_actions_v28 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  turn_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('adjust_pending_sets', 'add_exercise_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'build_question', 'edit_today', 'build_plan', 'propose_exercise', 'pause_plan', 'update_gym', 'set_lift_target', 'log_activity', 'propose_week', 'undo')),
  status TEXT NOT NULL CHECK (status IN ('committed', 'proposed', 'rejected', 'stale', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO coach_actions_v28 (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data)
  SELECT id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data FROM coach_actions;
DROP TABLE coach_actions;
ALTER TABLE coach_actions_v28 RENAME TO coach_actions;
CREATE UNIQUE INDEX coach_actions_op ON coach_actions (owner_id, op_id);
CREATE INDEX coach_actions_turn ON coach_actions (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX coach_actions_session ON coach_actions (session_id, created_at_utc) WHERE session_id IS NOT NULL;
CREATE INDEX coach_actions_owner ON coach_actions (owner_id, created_at_utc);
CREATE TRIGGER coach_actions_no_delete BEFORE DELETE ON coach_actions BEGIN SELECT RAISE(ABORT, 'coach actions are never deleted'); END;
`;
