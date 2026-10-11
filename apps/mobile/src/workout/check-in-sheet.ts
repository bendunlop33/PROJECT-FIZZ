import type { CheckIn, CheckInReason } from '@fizz/schemas';

/**
 * What's up? `Done` (check-in.md §2.3): the reasons and note it saved, and the
 * opId it used. Pure.
 */
export interface ReasonsSubmission {
  key: string;
  opId: string;
}

/**
 * The opId for a `Done`. A retry of the same reasons and note reuses the
 * last one (a duplicate, rule 5); anything else, including going back to an
 * earlier choice after Back from the pain step, is a new write.
 */
export function reasonsSubmission(prev: ReasonsSubmission | null, patch: { reasons: readonly CheckInReason[]; note: string | null }, newId: () => string): ReasonsSubmission {
  const key = JSON.stringify([[...patch.reasons].sort(), patch.note]);
  return prev?.key === key ? prev : { key, opId: newId() };
}

/** Where `Done` goes, from the saved check-in (never the sheet's unsaved state). */
export function afterReasonsStep(saved: Pick<CheckIn, 'reasons'>): 'pain' | 'ill' | 'start' {
  if (saved.reasons.includes('pain')) return 'pain';
  if (saved.reasons.includes('ill')) return 'ill';
  return 'start';
}
