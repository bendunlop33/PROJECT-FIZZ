/**
 * Schema version 2 (overnight slice 2, check-in.md §6). Frozen once released.
 *
 * - `check_ins`: pre-workout check-ins (Your data), stored as documents.
 * - `pain_flags`: minimal pain flags (rule 9), stored as documents.
 * - `sessions.check_in`: the session's check-in outcome (`SessionCheckIn`
 *   JSON), and `check_in_id` for an answered one. The partial unique index
 *   means a check-in is linked to at most one workout; the link is written in
 *   the same transaction as the session, so it has one source of truth.
 *
 * Older rows get NULL (sessions recorded before check-ins existed).
 */
export const MIGRATION_0002 = `
ALTER TABLE sessions ADD COLUMN check_in TEXT CHECK (check_in IS NULL OR json_valid(check_in));
ALTER TABLE sessions ADD COLUMN check_in_id TEXT;
CREATE UNIQUE INDEX sessions_check_in ON sessions (check_in_id) WHERE check_in_id IS NOT NULL;

CREATE TABLE check_ins (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX check_ins_owner_recorded ON check_ins (owner_id, recorded_at_utc);

CREATE TABLE pain_flags (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleared')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX pain_flags_owner_exercise ON pain_flags (owner_id, exercise_id);
`;
