/**
 * Undo instead of a confirm alert (copy D4, accepted 11 Oct; ADR 0003 Open):
 * delete set, skip exercise, a correction, remove exercise and a mid-workout
 * swap apply at once and show a toast with `Undo` (`undo_op`). Pure, so the
 * words are tested; the screen formats nothing.
 */

export const UNDO_TOAST = {
  deleted: (setNumber: number): string => `Set ${String(setNumber)} deleted`,
  skipped: (exerciseName: string): string => `${exerciseName} skipped`,
  corrected: (setNumber: number): string => `Set ${String(setNumber)} updated`,
  removed: (exerciseName: string): string => `${exerciseName} removed`,
  swapped: (fromName: string, toName: string): string => `${fromName} → ${toName}`,
  undone: 'Undone',
} as const;

/**
 * What the toast says when an Undo is refused. A stale refusal means
 * something it touched changed since (rule 5): nothing is changed.
 */
export function undoRefusalText(code: string): string {
  if (code === 'stale_version' || code === 'operation_not_found' || code === 'write_conflict') return 'Can’t undo: it changed since';
  if (code === 'work_interval_running') return 'Can’t undo: stop the timer first';
  return 'Undo wasn’t saved. Try again.';
}

/** The opId of an Undo, derived from the operation it undoes, so a double tap or a retry undoes once. */
export function undoOpId(targetOpId: string): string {
  return `undo:${targetOpId}`;
}
