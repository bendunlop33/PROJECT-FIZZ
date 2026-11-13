import { sha256Hex } from './sha256';

/** A finished workout as backup coverage sees it: which one, and which stored revision. */
export interface FinishedWorkoutStamp {
  id: string;
  revision: number;
}

/**
 * Which finished workouts a database holds, and at which revision, as one
 * hash of their sorted `id:revision` pairs. A backup covers the data only
 * when this matches:
 * - a count can't tell, because Undo import or restoring a smaller backup
 *   lowers it, so a new workout can leave the count at or below the newest
 *   backup's (backup review B2);
 * - IDs alone can't tell either, because a finished workout still takes
 *   corrections (`correct_set`, `update_session_timing`, `rename_session`),
 *   and each bumps its revision (fix-backup review S1).
 *
 * A record written with the earlier ID-only digest never matches, so the
 * first launch after this change makes one catch-up backup.
 */
export function finishedWorkoutsDigest(workouts: readonly FinishedWorkoutStamp[]): string {
  return sha256Hex(
    workouts
      .map((w) => `${w.id}:${String(w.revision)}`)
      .sort()
      .join('\n'),
  );
}
