/**
 * Schema version 4 (active-set follow-ups, active-workout.md §2.13 and
 * §2.15.3). Frozen once released.
 *
 * One migration for both columns (review B1.4): it was two (4 and 5) while
 * unreleased; folding them leaves one number to move if another unreleased
 * branch (gym switch) also claims version 4. Whichever branch merges second
 * renumbers its migration before any build reaches Ben's phone.
 *
 * - `session_sets.exclusions`: Ben's exclusion flags on a logged set
 *   (`SetExclusion[]` JSON in canonical order: spotted, pain, technique,
 *   other_equipment). NULL = none, which is every set before this version,
 *   so nothing is backfilled and every existing set still counts. Changed
 *   only by a versioned `correct_set` (AW6); the audit rows keep each
 *   change in their before/after snapshots, so no audit column is needed.
 * - `sessions.finish_by_utc` / `finish_by_tz`: Ben's `Finish by` time for
 *   that workout (today only, Your data). Both NULL = not set, which is every
 *   workout before this version, so nothing is backfilled. Set and cleared
 *   only by the versioned `set_finish_by` command.
 * - `pain_flags.status` also allows `retracted` (review B2): a flag Ben took
 *   back with Undo right after setting it. SQLite can't alter a CHECK, so the
 *   table is rebuilt with the same columns, rows and index; no row changes.
 */
export const MIGRATION_0004 = `
ALTER TABLE session_sets ADD COLUMN exclusions TEXT CHECK (exclusions IS NULL OR (json_valid(exclusions) AND json_type(exclusions) = 'array'));
ALTER TABLE sessions ADD COLUMN finish_by_utc TEXT;
ALTER TABLE sessions ADD COLUMN finish_by_tz TEXT CHECK ((finish_by_utc IS NULL) = (finish_by_tz IS NULL));
CREATE TABLE pain_flags_v4 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleared', 'retracted')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO pain_flags_v4 (id, owner_id, exercise_id, status, version, updated_at_utc, data)
  SELECT id, owner_id, exercise_id, status, version, updated_at_utc, data FROM pain_flags;
DROP TABLE pain_flags;
ALTER TABLE pain_flags_v4 RENAME TO pain_flags;
CREATE INDEX pain_flags_owner_exercise ON pain_flags (owner_id, exercise_id);
`;
