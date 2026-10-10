import { painClearConfirm as confirmCopy, painClearedToast as toastCopy } from '@fizz/domain';
import type { PainFlag } from '@fizz/schemas';

/**
 * One wording for clearing a pain flag, wherever it's done (pain flag sheet,
 * the rest card's `Better…`, Profile › Pain flags, Summary; rule 9): always a
 * confirm first, then a toast with Undo. The copy is AW10
 * (active-workout §2.14.3), built in `@fizz/domain` so every place says the
 * same thing. `Clear flag` is the default style, not red: nothing is deleted.
 */
export function painClearConfirm(flag: Pick<PainFlag, 'exerciseName' | 'reportedAt'>): { title: string; message: string; confirm: string; cancel: string } {
  return confirmCopy(flag);
}

export function painClearedToast(exerciseName: string): { text: string; action: string } {
  return toastCopy(exerciseName);
}
