/**
 * Schema version 9: Progress (progress.md v1.0, slice A). Frozen once released.
 *
 * Sessions (Your data):
 * - `sessions.duration_confirmed_at_utc` / `_tz`: Ben's `Count it` on a
 *   finished workout over Progress's 4 h cap (PG25a), so it counts in `Time in
 *   gym`. NULL = not confirmed (every workout before this). Written only by
 *   the versioned `confirm_session_duration` command.
 */
export const MIGRATION_0009 = `
ALTER TABLE sessions ADD COLUMN duration_confirmed_at_utc TEXT;
ALTER TABLE sessions ADD COLUMN duration_confirmed_at_tz TEXT CHECK ((duration_confirmed_at_utc IS NULL) = (duration_confirmed_at_tz IS NULL));
`;
