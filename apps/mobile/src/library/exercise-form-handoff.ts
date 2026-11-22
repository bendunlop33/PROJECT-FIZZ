/**
 * (19 Oct) The coach card's `Edit` opens the exercise form over the sheet; a
 * Save there is Ben's Add. The form leaves the added name here and the sheet
 * takes it when it is back in focus, then sends `Added <name>.` as Ben's
 * message (as a tapped question answer does), so the coach carries on.
 */
let added: { actionId: string; name: string } | null = null;

export function handOffAdded(actionId: string, name: string): void {
  added = { actionId, name };
}

export function takeAdded(): { actionId: string; name: string } | null {
  const a = added;
  added = null;
  return a;
}

/** Ben's message after Add (his tap, in words). */
export const addedMessage = (name: string): string => `Added ${name}.`;

/**
 * (Ben, 25 Oct) `＋ Add your own` on the Swap / Add sheet opens this form; a Save leaves the new exercise here under
 * the sheet's token, and the sheet comes back (when its screen is in focus again) searching for it, so Ben picks
 * it there with the same checks as any row (rule 9 `May hurt`, rule 4 `Not at Main Gym`). Nothing is swapped or
 * added by the form itself.
 */
let created: { token: string; exerciseId: string; name: string } | null = null;

export function handOffCreated(token: string, exerciseId: string, name: string): void {
  created = { token, exerciseId, name };
}

/** The exercise saved for `token`, once; null when none (the form was cancelled, or another sheet's). */
export function takeCreated(token: string): { exerciseId: string; name: string } | null {
  if (created === null || created.token !== token) return null;
  const c = created;
  created = null;
  return { exerciseId: c.exerciseId, name: c.name };
}
