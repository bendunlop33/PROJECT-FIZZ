/**
 * Leaving New file layout or Check the layout (data-import-export §9.2.2,
 * §9.2.5; review r2 S2). `Cancel`, back and the swipe all mean the same:
 * the layout session is dropped and its request closed, so the layout Ben
 * walked away from is never reused (ADR 0026 §6). The one exception is the
 * flow's own hand-off: New file layout replacing itself with Check the
 * layout for the same session. Pure, so the rule is unit-tested; the screens
 * only wire it to `beforeRemove`.
 */

/** The navigation action that removes the screen (`beforeRemove`'s `e.data.action`). */
export interface LeaveAction {
  type: string;
  payload?: object;
}

/** Whether the removing action hands this layout session on to the next screen (keep it). */
export function keepsLayoutSession(action: LeaveAction, layoutId: string): boolean {
  if (action.type !== 'REPLACE') return false;
  const params = (action.payload as { params?: { layoutId?: unknown } } | undefined)?.params;
  return params?.layoutId === layoutId;
}

/** What the screen does as it is removed: drop the session unless the flow hands it on. */
export async function leaveLayoutScreen(layouts: { discard(layoutId: string): Promise<void> }, layoutId: string, action: LeaveAction): Promise<void> {
  if (keepsLayoutSession(action, layoutId)) return;
  await layouts.discard(layoutId);
}
