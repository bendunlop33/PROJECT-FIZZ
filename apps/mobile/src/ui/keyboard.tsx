import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, View, type StyleProp, type ViewStyle } from 'react-native';

import { KEYBOARD_CLOSED, watchKeyboard, windowKeyboardOffset, type KeyboardState } from './keyboard-state';

export { accessoryAction, bottomBarPadding, toastBottom, watchKeyboard, windowKeyboardOffset, type KeyboardState } from './keyboard-state';

function initial(): KeyboardState {
  if (!Keyboard.isVisible()) return KEYBOARD_CLOSED;
  return { visible: true, height: Keyboard.metrics()?.height ?? 0 };
}

/** The keyboard as it is now (0.1): visible, and its height with the accessory bar. */
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>(initial);
  useEffect(() => watchKeyboard(Keyboard, setState), []);
  return state;
}

/** True while the keyboard is up (or going up). */
export function useKeyboardVisible(): boolean {
  return useKeyboard().visible;
}

/** The keyboard's height, 0 while it's closed. */
export function useKeyboardHeight(): number {
  return useKeyboard().height;
}

/**
 * A `KeyboardAvoidingView` that works in a page sheet or under a header (0.4):
 * its `keyboardVerticalOffset` is where it starts in the window, measured on
 * layout and again as the keyboard opens. The bottom bar or composer then
 * sits on the keyboard's Done bar (check on device).
 */
export function SheetKeyboardAvoidingView({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y) => {
      setOffset(windowKeyboardOffset(y));
    });
  }, []);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', measure);
    return () => {
      sub.remove();
    };
  }, [measure]);
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style} {...(testID ? { testID } : {})}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={{ flex: 1 }}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
