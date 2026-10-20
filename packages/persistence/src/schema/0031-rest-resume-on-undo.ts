/**
 * Schema version 31 (written on branch `claude/rest-undo-20oct`; renumber on
 * merge if another branch took 31 first, its SQL is independent): unticking a
 * set never resets the rest (workout-table-v3 §3, Ben 20 Oct). Frozen once
 * released.
 *
 * - `rest_timers.resume_on_undo`: JSON array of the live rests a log replaced
 *   (`ResumableRest[]`, newest last), so undoing that log puts the rest back
 *   with its original deadline, also after a force-close. NULL = none (every
 *   row before this migration).
 */
export const MIGRATION_0031 = `
ALTER TABLE rest_timers ADD COLUMN resume_on_undo TEXT CHECK (resume_on_undo IS NULL OR json_valid(resume_on_undo));
`;
