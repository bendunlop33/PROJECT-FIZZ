/**
 * Schema version 35 (perf, 23 Oct): an index on `session_exercises (session_id)`.
 * Every workout read selects its exercises by session; without it each read scanned
 * the whole table (~5k rows on Ben's imported history), so Today, Your workout and
 * the plan builder slowed with every workout logged. Index only: no data changes,
 * nothing in backups changes. Frozen once released.
 */
export const MIGRATION_0035 = `
CREATE INDEX IF NOT EXISTS session_exercises_session ON session_exercises (session_id, ordinal);
`;
