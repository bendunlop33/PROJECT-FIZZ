/**
 * Schema version 16: training details and split (Ben 13 Oct: D5, D7, D8; F19).
 * Frozen once released.
 *
 * - `training_profiles`: one row per owner (Your data, rule 10), a validated
 *   JSON document: about you (birth year, gender, height, experience), dated
 *   weights, goal and check-in weeks, days a week, session length, the split
 *   with each day's main lift, and the Self next-time targets switch.
 *   Versioned; repeated operation IDs are no-ops (rule 5). Backups, export
 *   and Delete my data carry it like every Your-data table.
 */
export const MIGRATION_0016 = `
CREATE TABLE training_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX training_profiles_owner ON training_profiles (owner_id);
`;
