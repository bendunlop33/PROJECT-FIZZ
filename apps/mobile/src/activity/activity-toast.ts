import { ACTIVITY_COPY } from '@fizz/domain';

import type { ActivityOutcome } from '../services/week-services';

/** What the activity sheet did, for the caller's toast with Undo. */
export type ActivitySaved = { kind: 'added' | 'edited' | 'deleted'; activityId: string; opId: string; /** A remove's own words (`Run cancelled`); else the default. */ text?: string };

export interface ActivityToast {
  text: string;
  action?: string;
  onAction?: () => void;
}

/**
 * (Ben, 20 Oct; review B2) The toast after the activity sheet saved, the same
 * on Today and Progress › Calendar: `Activity saved` / `Activity deleted` /
 * `Run cancelled`
 * with Undo of exactly that write. One op ID per toast, so a double tap on
 * Undo is one Undo (rule 5); an Undo that fails shows its message.
 */
export function activitySavedToast(
  saved: ActivitySaved,
  deps: {
    undo: (req: { activityId: string; targetOpId: string; opId: string }) => Promise<ActivityOutcome>;
    newOpId: () => string;
    changed: () => void;
    show: (t: ActivityToast | null) => void;
  },
): ActivityToast {
  const undoOp = deps.newOpId();
  return {
    text: saved.text ?? (saved.kind === 'deleted' ? ACTIVITY_COPY.deleted : ACTIVITY_COPY.saved),
    action: ACTIVITY_COPY.undo,
    onAction: () => {
      deps.show(null);
      void deps.undo({ activityId: saved.activityId, targetOpId: saved.opId, opId: undoOp }).then((u) => {
        deps.changed();
        if (!u.ok) deps.show({ text: u.message });
      });
    },
  };
}
