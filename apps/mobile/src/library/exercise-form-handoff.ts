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
