/**
 * Press-and-hold drag (workout-builder-v3 §2.3, §9 Q18; workout-table-v3 §7),
 * built once for the builder's Your workout, the workout's set rows and its
 * Workout sheet. Pure, so the gesture rules are tested here; the component
 * (`drag-list.tsx`) only measures and animates.
 *
 * - A still hold (~320 ms, light haptic) starts a drag. A finger that moves
 *   more than 8 pt before the hold fires is a scroll or a swipe, never a drag.
 * - A hold released without moving opens the row's menu (the long-press
 *   fallback: Move up / Move down, Change type, Delete…).
 * - Drop on the top or bottom part of a row = move there; on its middle
 *   (where pairing is allowed) = onto it (superset). Anything else, or a drop
 *   the page refuses, springs back.
 */

export const DRAG = {
  /** The hold before a drag starts (§2.3). */
  holdMs: 320,
  /** Movement before the hold fires that makes it a scroll or a swipe instead. */
  slop: 8,
  /** With pairing allowed: the top and bottom share of a row that mean before / after; the middle is onto. */
  edgeShare: 0.3,
} as const;

export type DropEdge = 'before' | 'after' | 'onto';

export interface DropTarget {
  key: string;
  edge: DropEdge;
}

/** A row's frame in the list (its y and height, from layout). */
export interface DragFrame {
  key: string;
  y: number;
  h: number;
}

export type DragPhase =
  | { kind: 'idle' }
  | { kind: 'pressing'; key: string; x: number; y: number; atMs: number }
  /** The hold fired. `draggable` false: a hold only opens the menu (a done set, a started round); moving cancels it. */
  | { kind: 'armed'; key: string; x: number; y: number; draggable: boolean }
  | { kind: 'dragging'; key: string; startY: number; y: number };

export type DragEvent =
  | { kind: 'down'; key: string; x: number; y: number; atMs: number }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'hold'; atMs: number; draggable: boolean }
  | { kind: 'up' }
  | { kind: 'cancel' };

/** What the component does after an event: nothing, a haptic (hold fired), open the menu, or drop. */
export type DragEffect = { kind: 'none' } | { kind: 'armed'; key: string } | { kind: 'menu'; key: string } | { kind: 'drop'; key: string; y: number } | { kind: 'cancelled' };

/**
 * The gesture as a small state machine. `y` values are the touch's page y; the rows' frames
 * are measured in the same space when the hold fires, so the drop is found against them.
 */
export function dragStep(phase: DragPhase, e: DragEvent): { phase: DragPhase; effect: DragEffect } {
  const none = { kind: 'none' } as const;
  switch (e.kind) {
    case 'down':
      return { phase: { kind: 'pressing', key: e.key, x: e.x, y: e.y, atMs: e.atMs }, effect: none };
    case 'move':
      if (phase.kind === 'pressing') {
        // Moved before the hold fired: a scroll or a swipe, not a drag.
        if (Math.hypot(e.x - phase.x, e.y - phase.y) > DRAG.slop) return { phase: { kind: 'idle' }, effect: none };
        return { phase, effect: none };
      }
      if (phase.kind === 'armed') {
        if (!phase.draggable) return Math.hypot(e.x - phase.x, e.y - phase.y) > DRAG.slop ? { phase: { kind: 'idle' }, effect: { kind: 'cancelled' } } : { phase, effect: none };
        return { phase: { kind: 'dragging', key: phase.key, startY: phase.y, y: e.y }, effect: none };
      }
      if (phase.kind === 'dragging') return { phase: { ...phase, y: e.y }, effect: none };
      return { phase, effect: none };
    case 'hold':
      if (phase.kind === 'pressing' && e.atMs - phase.atMs >= DRAG.holdMs) return { phase: { kind: 'armed', key: phase.key, x: phase.x, y: phase.y, draggable: e.draggable }, effect: { kind: 'armed', key: phase.key } };
      return { phase, effect: none };
    case 'up':
      if (phase.kind === 'armed') return { phase: { kind: 'idle' }, effect: { kind: 'menu', key: phase.key } };
      if (phase.kind === 'dragging') return { phase: { kind: 'idle' }, effect: { kind: 'drop', key: phase.key, y: phase.y } };
      return { phase: { kind: 'idle' }, effect: none };
    case 'cancel':
      return { phase: { kind: 'idle' }, effect: phase.kind === 'dragging' || phase.kind === 'armed' ? { kind: 'cancelled' } : none };
  }
}

/**
 * The rows Ben can see in a box that scrolls (review S2): each frame cut to the box's visible
 * window; a row scrolled out of it is no drop target (its drop line would be drawn where he can't
 * see it). A finger above or below the box then lands before the first or after the last row he
 * can see. No window: every frame as measured.
 */
export function visibleFrames(frames: readonly DragFrame[], window: { y: number; h: number } | null): DragFrame[] {
  if (window === null) return [...frames];
  const top = window.y;
  const bottom = window.y + window.h;
  return frames.flatMap((f) => {
    const y = Math.max(f.y, top);
    const end = Math.min(f.y + f.h, bottom);
    return end - y > 0 ? [{ key: f.key, y, h: end - y }] : [];
  });
}

/**
 * Where a row dragged to `y` would land: the row under the finger and the part of it (before /
 * after; onto in its middle when pairing is allowed). Past the first or last row it is before the
 * first or after the last. Null on the dragged row itself, or where `canDrop` says no.
 */
export function dropTargetAt(frames: readonly DragFrame[], fromKey: string, y: number, o: { allowOnto: boolean; canDrop?: (t: DropTarget) => boolean }): DropTarget | null {
  const sorted = [...frames].sort((a, b) => a.y - b.y);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return null;
  let t: DropTarget;
  if (y < first.y) t = { key: first.key, edge: 'before' };
  else if (y >= last.y + last.h) t = { key: last.key, edge: 'after' };
  else {
    const f = sorted.find((x) => y >= x.y && y < x.y + x.h) ?? last;
    const rel = f.h <= 0 ? 0.5 : (y - f.y) / f.h;
    t = o.allowOnto ? { key: f.key, edge: rel < DRAG.edgeShare ? 'before' : rel > 1 - DRAG.edgeShare ? 'after' : 'onto' } : { key: f.key, edge: rel < 0.5 ? 'before' : 'after' };
  }
  if (t.key === fromKey) return null;
  return o.canDrop === undefined || o.canDrop(t) ? t : null;
}

/** The dragged item's index after a before / after drop, among `keys` in their current order; null for `onto` or a drop that changes nothing. */
export function dropIndex(keys: readonly string[], fromKey: string, t: DropTarget): number | null {
  if (t.edge === 'onto' || !keys.includes(fromKey)) return null;
  const rest = keys.filter((k) => k !== fromKey);
  const at = rest.indexOf(t.key);
  if (at < 0) return null;
  const to = t.edge === 'before' ? at : at + 1;
  return to === keys.indexOf(fromKey) ? null : to;
}
