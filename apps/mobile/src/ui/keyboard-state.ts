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
  addListener: (event: KeyboardEventName, listener: (e: { endCoordinates?: { height: number } } | undefined) => void) => { remove: () => void };
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
 * A KeyboardAvoidingView in a page sheet or under a header (0.4): RN works
 * out the overlap from the view's frame in its parent, so it needs the view's
 * top in the window as `keyboardVerticalOffset`.
 */
export function windowKeyboardOffset(windowY: number | null | undefined): number {
  return typeof windowY === 'number' && Number.isFinite(windowY) ? Math.max(0, Math.round(windowY)) : 0;
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
