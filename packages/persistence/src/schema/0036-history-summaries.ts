/**
 * Schema version 36 (ADR 0032, Ben-approved 24 Oct): the stored per-workout history summary, so the first history
 * read after a launch (Today, Set up a plan, progression) reads one small row per workout instead of decoding every
 * workout's nine tables.
 *
 * Derived Your data, rebuildable from the workouts at any time:
 * - `history_summaries`: one row per workout in history (status `finished`), at the workout's storage `revision`.
 *   `data` is `HistorySummary.workout` (the workout as history reads it); `lifts` is each exercise's progression
 *   history from it (`toHistorySessions(…, { identity: true })`), by exercise ID; both JSON.
 * - `history_summary_exercises`: which exercises each summary has, so a per-exercise read finds its workouts from an
 *   index without reading any workout.
 *
 * Written in the same transaction as every save of the workout (`writeAggregate`; a workout leaving history loses
 * its rows), removed with a purge. Not in backups: a restore, a reset or `Delete my data` rebuilds them on open.
 * `format` is `HISTORY_SUMMARY_FORMAT`; a row of another format, or at another revision, is never read (the reader
 * decodes the workout instead) and is rebuilt on the next open.
 *
 * The migration creates the tables; its backfill (every stored workout in history) runs in the same transaction,
 * from the store (`migrationBackfills`), so this list stays free of domain code. Frozen once released.
 */
export const MIGRATION_0036 = `
CREATE TABLE history_summaries (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  owner_id TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  revision INTEGER NOT NULL,
  format INTEGER NOT NULL,
  data TEXT NOT NULL,
  lifts TEXT NOT NULL
);
CREATE INDEX history_summaries_owner_started ON history_summaries (owner_id, started_at_utc);

CREATE TABLE history_summary_exercises (
  session_id TEXT NOT NULL REFERENCES history_summaries (session_id),
  exercise_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  PRIMARY KEY (session_id, exercise_id)
);
CREATE INDEX history_summary_exercises_exercise ON history_summary_exercises (owner_id, exercise_id, started_at_utc, session_id);
`;
