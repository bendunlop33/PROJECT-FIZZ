import { toMs } from '@fizz/domain';

/**
 * The rest-screen fold (D-Rest, audit F8): while a rest runs, the next set's
 * editor is folded behind `Edit <exercise>`. Pure so the screen can't leave a
 * button pointing at a field that isn't drawn (review B1).
 */

/** `time` (a timed set) is entered in the reps field's place. */
export type EntryField = 'load' | 'reps' | 'time';

export interface FoldInput {
  /** The rest timer is running or paused. */
  resting: boolean;
  /** There is a set to edit. */
  hasFocus: boolean;
  /** Ben opened the folded editor during this rest. */
  showNextSet: boolean;
}

/** A rest is on screen while its timer runs or is paused (an ended rest isn't). */
export function isResting(rest: { kind: string } | null): boolean {
  return rest !== null && (rest.kind === 'running' || rest.kind === 'paused');
}

/** Whether the set editor (and so its load and reps fields) is drawn. */
export function editorShown(input: FoldInput): boolean {
  if (!input.hasFocus) return false;
  return !input.resting || input.showNextSet;
}

/**
 * What `Enter load` / `Enter reps` does: open the editor if it's folded, then
 * focus the field once it's drawn. Never a dead button (audit F2).
 */
export function enterAction(field: EntryField, input: FoldInput): { unfold: boolean; focus: EntryField } {
  return { unfold: input.hasFocus && !editorShown(input), focus: field };
}

/**
 * What the slot below the rest panel draws (premium-feel §4.3, review B1).
 * The editor always goes through one wrapper keyed by its set, so when a rest
 * ends with the editor already open, React keeps it mounted: the keyboard,
 * focus and a half-typed `62.` survive. It fades in only when it appears
 * because the rest ended (`animateOnMount`), never when Ben opens it during
 * rest and never on the screen's first draw.
 */
export type EditorSlot = { kind: 'none' } | { kind: 'link' } | { kind: 'editor'; key: string; animateOnMount: boolean };

export function editorSlot(input: FoldInput & { setId: string | null; drawn: boolean }): EditorSlot {
  if (!input.hasFocus || input.setId === null) return { kind: 'none' };
  if (!editorShown(input)) return { kind: 'link' };
  return { kind: 'editor', key: `editor:${input.setId}`, animateOnMount: input.drawn && !input.resting };
}

/** How long `READY` holds at the rest deadline before the editor swaps in (premium-feel §4.3). */
export const READY_HOLD_MS = 600;

type RestLike = { kind: 'running'; timerId: string; deadlineUtc: string } | { kind: 'ended'; timerId: string; skipped: boolean } | { kind: 'paused' };

/**
 * Rest end → Ready (premium-feel §4.3): when a running rest reaches its end
 * on screen, `READY` and `0:00` hold for `READY_HOLD_MS`, then the editor
 * swaps in. Not for Skip (it swaps at once), and not when Ben comes back to
 * the app well after the deadline (straight to Ready). Returns the time the
 * hold ends, or null for no hold. Logging is never held: Log stays live.
 */
export function readyHoldUntil(prev: RestLike | null, current: RestLike | null, nowMs: number): number | null {
  if (prev?.kind !== 'running' || current?.kind !== 'ended') return null;
  if (current.skipped || current.timerId !== prev.timerId) return null;
  let deadlineMs: number;
  try {
    deadlineMs = toMs(prev.deadlineUtc);
  } catch {
    return null;
  }
  if (nowMs - deadlineMs > 2_000) return null;
  return nowMs + READY_HOLD_MS;
}
