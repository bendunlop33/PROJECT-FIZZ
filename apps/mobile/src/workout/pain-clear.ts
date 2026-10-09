/**
 * One wording for clearing a pain flag, wherever it's done (set card,
 * Profile › Pain flags, Summary; rule 9, review S4): always a confirm first.
 * The Summary also offers Undo, because Next time changes in front of Ben.
 */
export function painClearConfirm(exerciseName: string): { title: string; message: string; confirm: string } {
  return { title: `Clear the pain flag for ${exerciseName}?`, message: 'Its targets can go up again from the next workout.', confirm: 'Clear' };
}

export function painClearedToast(exerciseName: string): { text: string; action: string } {
  return { text: `Pain flag cleared for ${exerciseName}. Next time can go up again.`, action: 'Undo' };
}
