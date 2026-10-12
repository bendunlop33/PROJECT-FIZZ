import type { Routine } from '@fizz/schemas';

import type { SaveFrom } from '../services/workout-services';

/**
 * The Save sheet's `Edit ›` (routines.md §A2.5, WL-A18): the sheet hides,
 * the workout editor opens on the unsaved copy, and its `Save` writes the
 * workout through `saveFrom` with the sheet's own opId (one write, one
 * Undo). The request and the way back are held here, in memory, because the
 * editor is a root modal over whichever screen opened the sheet and route
 * params can't carry a callback.
 *
 * Settled exactly once: `saved` (the editor's Save landed) or `cancelled`
 * (Cancel, Discard, a swipe-down or anything else that closes the editor),
 * after which the sheet shows again as it was. A force-close loses the
 * request, as it loses the sheet: nothing was written.
 */
export interface SaveEditRequest {
  from: SaveFrom;
  addToRotation: boolean;
  /** The sheet's opId: a Save from the editor and one from the sheet are the same save. */
  opId: string;
}

export type SaveEditOutcome = { kind: 'saved'; routine: Routine } | { kind: 'cancelled' };

const open = new Map<string, { request: SaveEditRequest; settle: (o: SaveEditOutcome) => void }>();

/** Hold a request for the editor; `key` goes in its `saveAs` param. Replaces any earlier one under the same key. */
export function beginSaveEdit(key: string, request: SaveEditRequest, settle: (o: SaveEditOutcome) => void): void {
  open.set(key, { request, settle });
}

/** The editor's read of its request; null when it was already settled (or lost). */
export function saveEditRequest(key: string): SaveEditRequest | null {
  return open.get(key)?.request ?? null;
}

/** Settle once: later calls (the editor's unmount after a Save) do nothing. */
export function settleSaveEdit(key: string, outcome: SaveEditOutcome): boolean {
  const held = open.get(key);
  if (held === undefined) return false;
  open.delete(key);
  held.settle(outcome);
  return true;
}
