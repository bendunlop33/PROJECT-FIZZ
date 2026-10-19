/**
 * Schema version 22: `End plan` (Ben, 19 Oct: Library › Workouts › Your
 * plan). Frozen once released.
 *
 * - `plan_drafts.status` gains `ended`: Ben ended the plan in use; its days
 *   left the rotation, its workouts and history stay, and Undo makes it
 *   `applied` again. SQLite can't alter a CHECK, so the table is rebuilt
 *   with the same columns, rows and index, as migrations 7, 11–14 and
 *   17–20 did. Every row keeps its status.
 */
export const MIGRATION_0022 = `
CREATE TABLE plan_drafts_v22 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'applied', 'superseded', 'discarded', 'expired', 'ended')),
  version INTEGER NOT NULL CHECK (version >= 1),
  expires_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO plan_drafts_v22 (id, owner_id, status, version, expires_at_utc, updated_at_utc, data)
  SELECT id, owner_id, status, version, expires_at_utc, updated_at_utc, data FROM plan_drafts;
DROP TABLE plan_drafts;
ALTER TABLE plan_drafts_v22 RENAME TO plan_drafts;
CREATE INDEX plan_drafts_owner ON plan_drafts (owner_id, status, updated_at_utc);
`;
