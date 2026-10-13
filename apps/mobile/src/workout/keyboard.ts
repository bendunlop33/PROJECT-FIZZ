/**
 * F5 (Ben, 13 Oct): "the keyboard stays up on a working set". The Focus and
 * Table lists close the number pad when Ben drags them (`interactive`, as the
 * coach sheet) and buttons in them still work on the first tap (`handled`).
 * A tap outside a field (in the Table, another row: `runRowTap`), Log, and
 * the `Done` bar above the pad close it too.
 */
export const WORKOUT_KEYBOARD = { keyboardDismissMode: 'interactive', keyboardShouldPersistTaps: 'handled' } as const;
