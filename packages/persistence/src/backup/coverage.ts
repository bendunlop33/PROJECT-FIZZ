import { sha256Hex } from './sha256';

/**
 * Which finished workouts a database holds, as one hash of their sorted IDs
 * (backup review B2). A backup covers the data only when this matches: a
 * count can't tell, because Undo import or restoring a smaller backup lowers
 * it, so a new workout can leave the count at or below the newest backup's.
 */
export function finishedWorkoutsDigest(ids: readonly string[]): string {
  return sha256Hex([...ids].sort().join('\n'));
}
