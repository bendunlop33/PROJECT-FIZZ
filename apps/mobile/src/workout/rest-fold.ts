/**
 * The rest-screen fold (D-Rest, audit F8): while a rest runs, the next set's
 * editor is folded behind `Edit <exercise>`. Pure so the screen can't leave a
 * button pointing at a field that isn't drawn (review B1).
 */

/** `time` (a timed set) is entered in the reps field's place. */
export type EntryField = 'load' | 'reps' | 'time';

export interface FoldInput {
  /** The rest timer is running or paused. */
  resting: boolean;
  /** There is a set to edit. */
  hasFocus: boolean;
  /** Ben opened the folded editor during this rest. */
  showNextSet: boolean;
}

/** A rest is on screen while its timer runs or is paused (an ended rest isn't). */
export function isResting(rest: { kind: string } | null): boolean {
  return rest !== null && (rest.kind === 'running' || rest.kind === 'paused');
}

/** Whether the set editor (and so its load and reps fields) is drawn. */
export function editorShown(input: FoldInput): boolean {
  if (!input.hasFocus) return false;
  return !input.resting || input.showNextSet;
}

/**
 * What `Enter load` / `Enter reps` does: open the editor if it's folded, then
 * focus the field once it's drawn. Never a dead button (audit F2).
 */
export function enterAction(field: EntryField, input: FoldInput): { unfold: boolean; focus: EntryField } {
  return { unfold: input.hasFocus && !editorShown(input), focus: field };
}
