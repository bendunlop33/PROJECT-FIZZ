/**
 * The movements with an active pain flag, as last read with the workout
 * (`workout.load`). The Lock Screen activity and the spoken cues are built
 * from the workout state alone, outside the screen; they read this so a
 * heavier load carried from the last set (rule 9; 21 Oct) is held back
 * there exactly as the screen holds it back. Unknown until the workout is
 * first read: then only what the session itself records counts.
 */
let current: ReadonlySet<string> | undefined;

export function setActivePainFlagged(exerciseIds: ReadonlySet<string>): void {
  current = new Set(exerciseIds);
}

export function activePainFlagged(): ReadonlySet<string> | undefined {
  return current;
}
