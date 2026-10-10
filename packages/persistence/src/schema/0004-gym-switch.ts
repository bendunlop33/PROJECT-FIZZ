/**
 * Schema version 4 (mid-workout gym switch, gym-switch.md §6.5, ADR 0017).
 * Frozen once released.
 *
 * - `sessions.gym_changes`: the workout's gym changes and their Undo records
 *   (`GymChange[]` JSON, GS-S2). NULL = no change (every workout before this).
 * - `session_exercises.continues_from_id`: a continuation row holding an
 *   exercise's sets that moved to another gym's equipment, while its done sets
 *   stayed on the row it continues (GS6, GS-S4). NULL = not a continuation.
 * - `session_exercises.equipment_version`: which version of the item the row
 *   uses when the workout's equipment snapshot holds more than one (GS-S3).
 *   NULL = the latest.
 *
 * Planned targets keep how they were fitted inside the existing `planned`
 * JSON (`planned.snap`, GS-S1), so no column is needed for it.
 */
export const MIGRATION_0004 = `
ALTER TABLE sessions ADD COLUMN gym_changes TEXT CHECK (gym_changes IS NULL OR json_valid(gym_changes));
ALTER TABLE session_exercises ADD COLUMN continues_from_id TEXT REFERENCES session_exercises (id);
ALTER TABLE session_exercises ADD COLUMN equipment_version INTEGER CHECK (equipment_version IS NULL OR equipment_version >= 1);
`;
