/**
 * Schema version 5 (`Finish by`, active-workout.md §2.15.3).
 * Frozen once released.
 *
 * - `sessions.finish_by_utc` / `finish_by_tz`: Ben's `Finish by` time for
 *   that workout (today only, Your data). Both NULL = not set, which is every
 *   workout before this version, so nothing is backfilled. Set and cleared
 *   only by the versioned `set_finish_by` command.
 */
export const MIGRATION_0005 = `
ALTER TABLE sessions ADD COLUMN finish_by_utc TEXT;
ALTER TABLE sessions ADD COLUMN finish_by_tz TEXT CHECK ((finish_by_utc IS NULL) = (finish_by_tz IS NULL));
`;
