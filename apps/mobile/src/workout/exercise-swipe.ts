/**
 * (Ben, 1 Nov, approved C) Swipes on an exercise in the Workout list: left reveals `Later · Swap · Skip` (a full
 * swipe skips, with Undo), right reveals `Add set`. A done exercise only has `Add set`. Pure: which actions a row
 * has, and what a release does. The row (`ui/exercise-swipe.tsx`) draws it; the screen runs the action through the
 * same versioned writes as the menu.
 */

export type ExerciseSwipeAction = 'move_to_end' | 'swap' | 'skip_exercise' | 'add_set';

export interface ExerciseSwipeItem {
  action: ExerciseSwipeAction;
  label: string;
  /** VoiceOver's name for it (the same actions are on the row). */
  accessibilityLabel: string;
}

export interface ExerciseSwipeActions {
  /** Revealed by a swipe left, in order from the row's edge: Later, Swap, Skip. */
  left: ExerciseSwipeItem[];
  /** Revealed by a swipe right: Add set. */
  right: ExerciseSwipeItem[];
}

const LATER: ExerciseSwipeItem = { action: 'move_to_end', label: 'Later', accessibilityLabel: 'Move to end' };
const SWAP: ExerciseSwipeItem = { action: 'swap', label: 'Swap', accessibilityLabel: 'Swap exercise' };
const SKIP: ExerciseSwipeItem = { action: 'skip_exercise', label: 'Skip', accessibilityLabel: 'Skip exercise' };
const ADD_SET: ExerciseSwipeItem = { action: 'add_set', label: 'Add set', accessibilityLabel: 'Add set' };

/**
 * `toEnd`: Move to end would move it (`roundMoves`); `canSwap`: it has sets to swap; `canSkip`: a set not done yet.
 * Done: no left swipe at all; Add set stays (the menu has it for a done exercise too).
 */
export function exerciseSwipeActions(o: { done: boolean; toEnd: boolean; canSwap: boolean; canSkip: boolean }): ExerciseSwipeActions {
  if (o.done) return { left: [], right: [ADD_SET] };
  return { left: [...(o.toEnd ? [LATER] : []), ...(o.canSwap ? [SWAP] : []), ...(o.canSkip ? [SKIP] : [])], right: [ADD_SET] };
}

/** Each revealed button is 72 pt; past 60 % of the row a swipe left is a full swipe (Skip). */
export const EXERCISE_SWIPE = { button: 72, open: 36, full: 0.6 } as const;

export type SwipeRelease = { kind: 'closed' } | { kind: 'open'; side: 'left' | 'right' } | { kind: 'full'; action: ExerciseSwipeAction };

/**
 * A release after a sideways drag of `dx` (negative: left) on a row `width` wide. A full swipe left only skips when
 * Skip is there; otherwise it opens. A swipe toward a side with nothing to show stays closed.
 */
export function swipeRelease(dx: number, width: number, actions: ExerciseSwipeActions): SwipeRelease {
  if (dx < 0) {
    if (actions.left.length === 0) return { kind: 'closed' };
    if (-dx >= width * EXERCISE_SWIPE.full && actions.left.some((a) => a.action === 'skip_exercise')) return { kind: 'full', action: 'skip_exercise' };
    return -dx >= EXERCISE_SWIPE.open ? { kind: 'open', side: 'left' } : { kind: 'closed' };
  }
  if (actions.right.length === 0) return { kind: 'closed' };
  return dx >= EXERCISE_SWIPE.open ? { kind: 'open', side: 'right' } : { kind: 'closed' };
}

/** How far the row follows the finger: no further than its buttons on a side that has them (full swipe: the row). */
export function swipeOffset(dx: number, width: number, actions: ExerciseSwipeActions): number {
  if (dx < 0) {
    if (actions.left.length === 0) return 0;
    const canFull = actions.left.some((a) => a.action === 'skip_exercise');
    return Math.max(dx, canFull ? -width : -actions.left.length * EXERCISE_SWIPE.button);
  }
  return actions.right.length === 0 ? 0 : Math.min(dx, actions.right.length * EXERCISE_SWIPE.button);
}

/** A horizontal drag: the row claims it (a vertical one stays the list's scroll, a still hold stays the drag). */
export function claimsRowSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5;
}
