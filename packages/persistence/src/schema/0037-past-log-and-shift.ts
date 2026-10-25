/**
 * Schema version 37 (Ben, 25 Oct: "I should be able to freely edit times, e.g. if I want to import a
 * workout historically from the day before or beyond"). Frozen once released.
 *
 * - `sessions.past_log`: `SessionPastLog` JSON (`{ enteredAt }`), a workout entered after the fact
 *   with `Log a past workout`. NULL = logged live (every workout before this migration). Your data:
 *   travels in backups with the session row.
 * - `timing_audit.shift_ms`: on a `startedAt` entry, the offset the whole workout moved by with its
 *   start (sets, pauses, timers), so the times first recorded stay recoverable. NULL = only the
 *   start moved (every entry before this migration).
 * - `session_pauses` may now be updated, but only moved: same workout, same place, same length
 *   (to the millisecond). A pause still can't be shortened, lengthened, dropped or reordered; the
 *   write path moves pauses only by the shift of a timing entry written in the same transaction.
 */
export const MIGRATION_0037 = `
ALTER TABLE sessions ADD COLUMN past_log TEXT CHECK (past_log IS NULL OR json_valid(past_log));
ALTER TABLE timing_audit ADD COLUMN shift_ms INTEGER CHECK (shift_ms IS NULL OR (typeof(shift_ms) = 'integer' AND field = 'startedAt'));
DROP TRIGGER session_pauses_no_update;
CREATE TRIGGER session_pauses_no_update BEFORE UPDATE ON session_pauses
  WHEN NEW.session_id IS NOT OLD.session_id OR NEW.ordinal IS NOT OLD.ordinal
    OR round((julianday(NEW.end_utc) - julianday(NEW.start_utc)) * 86400000.0) IS NOT round((julianday(OLD.end_utc) - julianday(OLD.start_utc)) * 86400000.0)
  BEGIN SELECT RAISE(ABORT, 'session_pauses only move with their workout'); END;
`;
