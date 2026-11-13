/**
 * Schema version 24: supersets made mid-workout (Ben, 19 Oct: "I want the
 * option to add superset to an existing set"). Frozen once released. If
 * another branch takes number 24 first, this one is renumbered on merge (its
 * SQL is independent of theirs).
 *
 * - `session_exercises.round_offset`: the rounds a row sits out at the start
 *   of its superset, so a row paired after some sets are done starts in the
 *   group's current round (A3, B1, A4, B2 …). NULL = 0 (every row before
 *   this migration, and every row of a superset planned before Start).
 */
export const MIGRATION_0024 = `
ALTER TABLE session_exercises ADD COLUMN round_offset INTEGER CHECK (round_offset IS NULL OR (round_offset >= 1 AND round_offset <= 60));
`;
