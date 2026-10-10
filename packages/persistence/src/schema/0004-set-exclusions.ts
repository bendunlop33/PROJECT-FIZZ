/**
 * Schema version 4 (sets that don't count, active-workout.md §2.13).
 * Frozen once released.
 *
 * - `session_sets.exclusions`: Ben's exclusion flags on a logged set
 *   (`SetExclusion[]` JSON in canonical order: spotted, pain, technique,
 *   other_equipment). NULL = none, which is every set before this version,
 *   so nothing is backfilled and every existing set still counts. Changed
 *   only by a versioned `correct_set` (AW6); the audit rows keep each
 *   change in their before/after snapshots, so no audit column is needed.
 */
export const MIGRATION_0004 = `
ALTER TABLE session_sets ADD COLUMN exclusions TEXT CHECK (exclusions IS NULL OR (json_valid(exclusions) AND json_type(exclusions) = 'array'));
`;
