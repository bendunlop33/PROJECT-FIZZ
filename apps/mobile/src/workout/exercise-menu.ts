/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
export type ExerciseMenuAction = 'how_to' | 'undo_coach' | 'undo_swap' | 'add_set' | 'swap' | 'notes' | 'add_exercise' | 'delete_set' | 'skip_exercise' | 'remove_exercise';

interface MenuItem {
  action: ExerciseMenuAction | 'cancel';
  label: string;
  destructive: boolean;
}

const HOW_TO: MenuItem = { action: 'how_to', label: 'How to', destructive: false };
/** While the focused set carries a coach change still pending (coach-adjustments §2.7). */
const UNDO_COACH: MenuItem = { action: 'undo_coach', label: 'Undo coach change', destructive: false };
/** While the exercise is today's mid-workout swap and its swap can be undone (EL4). */
const UNDO_SWAP: MenuItem = { action: 'undo_swap', label: 'Undo swap', destructive: false };
const ADD_SET: MenuItem = { action: 'add_set', label: 'Add set', destructive: false };
/** Only while the exercise has a pending set (B3: applies at once with Undo). */
const SWAP: MenuItem = { action: 'swap', label: 'Swap exercise', destructive: false };
const ITEMS: readonly MenuItem[] = [
  { action: 'notes', label: 'Notes', destructive: false },
  { action: 'add_exercise', label: 'Add exercise', destructive: false },
  { action: 'delete_set', label: 'Delete this set', destructive: true },
  { action: 'skip_exercise', label: 'Skip exercise', destructive: true },
];
/** Only while nothing on the exercise is logged (exercise-library §4.6): no confirm, toast with Undo. */
const REMOVE: MenuItem = { action: 'remove_exercise', label: 'Remove exercise', destructive: true };
const CANCEL: MenuItem = { action: 'cancel', label: 'Cancel', destructive: false };

export interface ExerciseMenu {
  /** Labels in sheet order. */
  options: string[];
  /** Rows shown red (iOS takes an array). */
  destructiveButtonIndex: number[];
  cancelButtonIndex: number;
  /** The action for a tapped row; null for Cancel, a dismissal or an unknown index. */
  actionAt: (index: number) => ExerciseMenuAction | null;
}

export interface ExerciseMenuOptions {
  /** The exercise has a pending set to swap (mid-workout swap, EL4). */
  canSwap?: boolean;
  /** The exercise is today's swap and it can still be undone. */
  canUndoSwap?: boolean;
  /** Nothing on the exercise is logged: it can be removed (added by mistake). */
  canRemove?: boolean;
}

export function exerciseMenu(hasHowTo: boolean, hasCoachChange = false, o: ExerciseMenuOptions = {}): ExerciseMenu {
  const items = [...(hasHowTo ? [HOW_TO] : []), ...(hasCoachChange ? [UNDO_COACH] : []), ...(o.canUndoSwap ? [UNDO_SWAP] : []), ADD_SET, ...(o.canSwap ? [SWAP] : []), ...ITEMS, ...(o.canRemove ? [REMOVE] : []), CANCEL];
  return {
    options: items.map((i) => i.label),
    destructiveButtonIndex: items.flatMap((item, i) => (item.destructive ? [i] : [])),
    cancelButtonIndex: items.findIndex((i) => i.action === 'cancel'),
    actionAt: (index) => {
      const action = items[index]?.action;
      return action === undefined || action === 'cancel' ? null : action;
    },
  };
}
