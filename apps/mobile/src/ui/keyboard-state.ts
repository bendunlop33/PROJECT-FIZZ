/**
 * The keyboard's state and the bottom chrome's spacing (design pass, Ben
 * approved 20 Oct; VISUAL-AUDIT batch 0). Pure, so it is tested without a
 * renderer: `watchKeyboard` takes anything shaped like RN's `Keyboard`.
 */

export interface KeyboardState {
  visible: boolean;
  /** The keyboard's height with its accessory bar (`endCoordinates.height`); 0 while it's closed. */
  height: number;
}

export const KEYBOARD_CLOSED: KeyboardState = { visible: false, height: 0 };

export type KeyboardEventName = 'keyboardWillShow' | 'keyboardWillHide';

/** The part of RN's `Keyboard` the hooks use (a fake in tests). */
export interface KeyboardEmitter {
  addListener: (event: KeyboardEventName, listener: (e: { endCoordinates?: { height: number }; duration?: number } | undefined) => void) => { remove: () => void };
}

/**
 * Follows the keyboard (iOS `keyboardWillShow` / `keyboardWillHide`, so the
 * layout moves with it, not after it). Returns the unsubscribe.
 */
export function watchKeyboard(k: KeyboardEmitter, onChange: (s: KeyboardState) => void): () => void {
  const shown = k.addListener('keyboardWillShow', (e) => {
    onChange({ visible: true, height: Math.max(0, e?.endCoordinates?.height ?? 0) });
  });
  const hidden = k.addListener('keyboardWillHide', () => {
    onChange(KEYBOARD_CLOSED);
  });
  return () => {
    shown.remove();
    hidden.remove();
  };
}

/**
 * A bottom bar's bottom padding (0.2): on the keyboard it needs no room for
 * the home indicator (about 34 pt on a Face ID phone), only a small gap.
 */
export function bottomBarPadding(p: { keypadOpen: boolean; insetBottom: number; space2: number; space3: number; minInset?: number }): number {
  return p.keypadOpen ? p.space2 : p.space3 + Math.max(p.insetBottom, p.minInset ?? 0);
}

/**
 * How far the keyboard (with its accessory / `Done` bar) covers a view whose
 * bottom edge is `bottomGap` pt above the bottom of the screen (keyboard
 * visibility, 27 Oct). Every sheet and full screen ends at the screen's
 * bottom (gap 0); a tab screen ends on its tab bar, which the keyboard
 * covers. Pure: worked out from the keyboard's own height, never from where
 * the view thinks it sits in the window. Fabric measures a view inside a
 * native page sheet (rn-screens `modal`, RN `Modal` pageSheet) from the
 * sheet's top, not the screen's, so a measured `keyboardVerticalOffset`
 * came out ~60 pt short there and the coach composer ended up under the
 * keyboard (Ben, build 403). Rounds up: a point too high, never under.
 */
export function keyboardInset(p: { keyboardHeight: number; bottomGap?: number }): number {
  const h = Number.isFinite(p.keyboardHeight) ? p.keyboardHeight : 0;
  const gap = p.bottomGap !== undefined && Number.isFinite(p.bottomGap) ? Math.max(0, p.bottomGap) : 0;
  return Math.max(0, Math.ceil(h - gap));
}

/**
 * The layout animation for a keyboard move: its own duration (clamped to
 * the 10 ms RN accepts), or none when the event has no duration.
 */
export function keyboardAnimationMs(duration: number | null | undefined): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(10, Math.round(duration));
}

/**
 * Where a scroll view should scroll so the focused field shows in its
 * viewport (keyboard visibility, 27 Oct), or null when it already does.
 * `fieldY` is the field's top in the scroll's content; the viewport is the
 * scroll's height after the keyboard frame shrank it. A field taller than the
 * viewport shows from its top (the caret starts there in a new note).
 */
export function revealScrollY(p: { fieldY: number; fieldHeight: number; viewportHeight: number; scrollY: number; margin?: number }): number | null {
  if (![p.fieldY, p.fieldHeight, p.viewportHeight, p.scrollY].every(Number.isFinite) || p.viewportHeight <= 0) return null;
  const m = Math.max(0, p.margin ?? 16);
  const top = p.fieldY - m;
  const bottom = p.fieldY + p.fieldHeight + m;
  if (bottom > p.scrollY + p.viewportHeight) return Math.max(0, Math.round(Math.min(bottom - p.viewportHeight, top)));
  if (top < p.scrollY) return Math.max(0, Math.round(top));
  return null;
}

/**
 * Where a floating toast's host sits (0.6), above its own `space.2` margin:
 * on the measured bottom chrome when there is one, else clear of the home
 * indicator (a tab screen already sits on its tab bar).
 */
export function toastBottom(p: { footerHeight: number | null; insetBottom: number; space2: number; tab?: boolean }): number {
  if (p.footerHeight !== null && p.footerHeight > 0) return p.footerHeight;
  return p.tab === true ? 0 : p.insetBottom + p.space2;
}

/** The number keypad's accessory (0.7): `Next ›` when there is a next field, else `Done`. */
export function accessoryAction(onNext: (() => void) | null | undefined): { label: 'Next ›' | 'Done'; accessibilityLabel: 'Next field' | 'Done' } {
  return onNext ? { label: 'Next ›', accessibilityLabel: 'Next field' } : { label: 'Done', accessibilityLabel: 'Done' };
}
