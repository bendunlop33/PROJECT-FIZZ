/**
 * Schema version 34 (PM decision, 23 Oct): a workout started in the applied
 * plan's deload week. Frozen once released.
 *
 * - `sessions.deload`: `SessionDeload` JSON (`{ planId, week, of }`), written
 *   once at Start from the block as derived then. NULL = a normal workout
 *   (every workout before this migration). Your data: the column travels in
 *   backups with the rest of the session row. The built-in rule, next-session
 *   targets, lift estimates and the coach's history read skip or label these
 *   workouts; Progress volume and history show them as any other.
 */
export const MIGRATION_0034 = `
ALTER TABLE sessions ADD COLUMN deload TEXT CHECK (deload IS NULL OR json_valid(deload));
`;
