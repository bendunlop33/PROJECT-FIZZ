/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
export type ExerciseMenuAction = 'how_to' | 'add_set' | 'add_exercise' | 'delete_set' | 'skip_exercise';

interface MenuItem {
  action: ExerciseMenuAction | 'cancel';
  label: string;
  destructive: boolean;
}

const HOW_TO: MenuItem = { action: 'how_to', label: 'How to', destructive: false };
const ITEMS: readonly MenuItem[] = [
  { action: 'add_set', label: 'Add set', destructive: false },
  { action: 'add_exercise', label: 'Add exercise', destructive: false },
  { action: 'delete_set', label: 'Delete this set', destructive: true },
  { action: 'skip_exercise', label: 'Skip exercise', destructive: true },
  { action: 'cancel', label: 'Cancel', destructive: false },
];

export interface ExerciseMenu {
  /** Labels in sheet order. */
  options: string[];
  /** Rows shown red (iOS takes an array). */
  destructiveButtonIndex: number[];
  cancelButtonIndex: number;
  /** The action for a tapped row; null for Cancel, a dismissal or an unknown index. */
  actionAt: (index: number) => ExerciseMenuAction | null;
}

export function exerciseMenu(hasHowTo: boolean): ExerciseMenu {
  const items = hasHowTo ? [HOW_TO, ...ITEMS] : [...ITEMS];
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
