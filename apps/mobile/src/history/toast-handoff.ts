import type { DeleteItem } from '@fizz/domain';

/**
 * The Undo toast after a delete lands on the screen Ben returns to (§2.2:
 * a Past workout pops, the Summary goes to Today). The deleting screen
 * hands it off here; the next screen that shows a toast takes it once.
 * In memory only: after a force-close, Recently deleted is the way back.
 */
export interface DeleteToast {
  text: string;
  /** What `Undo` restores: exactly this operation's workouts, at their deleted versions (DW9). */
  undo: readonly DeleteItem[];
  /** The restored toast's text, for after Undo. */
  restoredText: string;
}

let pending: DeleteToast | null = null;

export function handOffDeleteToast(t: DeleteToast): void {
  pending = t;
}

export function takeDeleteToast(): DeleteToast | null {
  const t = pending;
  pending = null;
  return t;
}
