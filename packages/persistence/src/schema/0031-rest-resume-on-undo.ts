/**
 * Schema version 31 (written on branch `claude/rest-undo-20oct`; renumber on
 * merge if another branch took 31 first, its SQL is independent): unticking a
 * set never resets the rest (workout-table-v3 §3, Ben 20 Oct). Frozen once
 * released.
 *
 * - `rest_timers.resume_on_undo`: JSON array of the rests a log replaced
 *   (`ResumableRest[]`, newest last), so undoing that log puts the rest back
 *   (running to its original deadline, or finished at its original end),
 *   also after a force-close. NULL = none (every
 *   row before this migration).
 * - `rest_timers.restored_finished`: 1 when an undo put the rest back already
 *   finished (`RestTimer.restoredFinished`), so no late rest-end cue speaks
 *   for it after a relaunch. NULL = not.
 */
export const MIGRATION_0031 = `
ALTER TABLE rest_timers ADD COLUMN resume_on_undo TEXT CHECK (resume_on_undo IS NULL OR json_valid(resume_on_undo));
ALTER TABLE rest_timers ADD COLUMN restored_finished INTEGER CHECK (restored_finished IS NULL OR restored_finished = 1);
`;
