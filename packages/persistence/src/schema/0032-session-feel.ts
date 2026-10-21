/**
 * Schema version 32 (written on branch `claude/b3-wave3-21oct`; renumber on
 * merge if another branch took 32 first, its SQL is independent): Summary's
 * one-tap `How did it feel?` (Ben, 21 Oct; workout-builder-v3 §6.2), a
 * weekly-review fact. Frozen once released.
 *
 * - `sessions.feel`: `SessionFeel` JSON (`{ value: easy|good|hard, at }`),
 *   written only by the versioned `set_feel` command. NULL = not answered
 *   (every workout before this migration). Your data: the column travels in
 *   backups with the rest of the session row.
 */
export const MIGRATION_0032 = `
ALTER TABLE sessions ADD COLUMN feel TEXT CHECK (feel IS NULL OR json_valid(feel));
`;
