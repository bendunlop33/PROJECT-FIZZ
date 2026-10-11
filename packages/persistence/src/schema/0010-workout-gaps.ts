/**
 * Schema version 10: workout gaps (backlog §4.1; active-workout §4.4,
 * exercise-library §4.6, ADR 0011). Frozen once released. ALTERs only, so it
 * can't clash with a table rebuild in another branch's migration (8 and 9
 * are taken by the delete-workouts and workout-library branches; on this
 * branch they are placeholders, see `migrations.ts`).
 *
 * - `session_exercises.note`, `session_sets.note`: Ben's notes (Your data).
 *   NULL = none, every row before this version.
 * - `session_exercises.removed`: `{opId, at, by}` JSON when the exercise
 *   left the workout (added by mistake, or emptied by a swap). NULL = in it.
 * - `session_exercises.swapped_from`: `{sessionExerciseId, opId}` JSON on
 *   the row a mid-workout swap created. NULL = not a swap.
 * - `session_exercises.measures_distance`: 1 on a distance exercise. The
 *   `measurement` column's CHECK predates distance and SQLite can't alter
 *   it (a rebuild would also drop migration 8's triggers), so a distance
 *   row stores `measurement = 'reps'` with this flag set; the reader maps
 *   the pair back to `distance`.
 * - `session_sets.actual_distance_m`: metres logged (distance sets). NULL =
 *   none. Drafts and targets carry distance inside their JSON already.
 */
export const MIGRATION_0010 = `
ALTER TABLE session_exercises ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500);
ALTER TABLE session_exercises ADD COLUMN removed TEXT CHECK (removed IS NULL OR json_valid(removed));
ALTER TABLE session_exercises ADD COLUMN swapped_from TEXT CHECK (swapped_from IS NULL OR json_valid(swapped_from));
ALTER TABLE session_exercises ADD COLUMN measures_distance INTEGER CHECK (measures_distance IS NULL OR (measures_distance = 1 AND measurement = 'reps'));
ALTER TABLE session_sets ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500);
ALTER TABLE session_sets ADD COLUMN actual_distance_m REAL CHECK (actual_distance_m IS NULL OR (actual_distance_m >= 0 AND has_actual = 1));
`;
