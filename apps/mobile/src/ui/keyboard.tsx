import { useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Keyboard, LayoutAnimation, ScrollView, TextInput, View, type KeyboardEvent, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

import { KEYBOARD_CLOSED, keyboardAnimationMs, keyboardInset, revealScrollY, watchKeyboard, type KeyboardState } from './keyboard-state';

export { accessoryAction, bottomBarPadding, keyboardAnimationMs, keyboardInset, revealScrollY, toastBottom, watchKeyboard, type KeyboardState } from './keyboard-state';

function current(): KeyboardState {
  if (!Keyboard.isVisible()) return KEYBOARD_CLOSED;
  return { visible: true, height: Keyboard.metrics()?.height ?? 0 };
}

/** The keyboard as it is now (0.1): visible, and its height with the accessory bar. */
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>(current);
  useEffect(() => {
    const stop = watchKeyboard(Keyboard, setState);
    // A field with autoFocus can raise the keyboard before this subscribes (27 Oct): catch up once.
    const now = current();
    setState((s) => (s.visible === now.visible && s.height === now.height ? s : now));
    return stop;
  }, []);
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
 * The tab bar's height when this view sits on it (a screen inside the tabs), else 0. The keyboard covers the tab
 * bar, so a tab screen's bottom edge is that much above the keyboard's bottom. Only `Screen` asks: a sheet always
 * ends at the screen's bottom, even one presented from a tab screen (it still sees the tabs' context).
 */
export function useTabBarGap(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}

/** The padding a view ending `bottomGap` pt above the screen's bottom needs to clear the keyboard, animated with it. */
export function useKeyboardInset(bottomGap = 0): number {
  const [height, setHeight] = useState(() => current().height);
  useEffect(() => {
    const move = (h: number, duration: number | undefined) => {
      const ms = keyboardAnimationMs(duration);
      if (ms !== null) LayoutAnimation.configureNext({ duration: ms, update: { duration: ms, type: LayoutAnimation.Types.keyboard } });
      setHeight(h);
    };
    // Events can arrive without coordinates (Prefer Cross-Fade Transitions): fall back to the keyboard's metrics.
    const shown = Keyboard.addListener('keyboardWillShow', (e: KeyboardEvent | undefined) => {
      move(Math.max(0, e?.endCoordinates.height || (Keyboard.metrics()?.height ?? 0)), e?.duration);
    });
    const hidden = Keyboard.addListener('keyboardWillHide', (e: KeyboardEvent | undefined) => {
      move(0, e?.duration);
    });
    // An autoFocus field can raise the keyboard before this subscribes: catch up once.
    setHeight(current().height);
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return keyboardInset({ keyboardHeight: height, bottomGap });
}

/**
 * The one keyboard-aware frame for sheets and full screens (keyboard visibility, 27 Oct; was 0.4). Its content is
 * padded up by the keyboard's height (with the accessory / Done bar), so a composer or footer at its bottom sits on
 * the keyboard and a `flex: 1` list above it shrinks. `bottomGap`: how far its bottom edge is above the screen's
 * bottom (a tab screen: `useTabBarGap()`); 0 for a sheet or full screen. The padding moves with the keyboard's own
 * animation. No window measuring: inside a native page sheet Fabric measures from the sheet's top, which left the
 * coach composer under the keyboard (Ben, build 403).
 */
export function SheetKeyboardAvoidingView({ children, style, contentStyle, testID, bottomGap = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; testID?: string; bottomGap?: number }) {
  const inset = useKeyboardInset(bottomGap);
  return (
    <View style={style} {...(testID ? { testID } : {})}>
      <View style={[{ flex: 1 }, contentStyle, { paddingBottom: inset }]}>{children}</View>
    </View>
  );
}

type Measurable = { measureLayout: (relativeTo: Measurable, onSuccess: (x: number, y: number, w: number, h: number) => void, onFail?: () => void) => void };

/**
 * The scroll view inside a `SheetKeyboardAvoidingView` (27 Oct): when the keyboard frame shrinks it, or the keyboard
 * comes up, the focused field in it scrolls into view (`revealScrollY`), so the field Ben is typing in is never left
 * under the keyboard or the pinned footer. Measured relative to its own content, so a page sheet's position doesn't
 * matter. Use plain `automaticallyAdjustKeyboardInsets` only where nothing pins under the scroll (no double inset).
 */
export function KeyboardScrollView({ ref, onLayout, ...rest }: ScrollViewProps & { ref?: Ref<ScrollView> }) {
  const inner = useRef<ScrollView | null>(null);
  const viewport = useRef(0);
  const reveal = useCallback(() => {
    const sv = inner.current;
    const field = TextInput.State.currentlyFocusedInput() as unknown as Measurable | null;
    if (sv === null || field === null || !Keyboard.isVisible()) return;
    const native = sv.getNativeScrollRef() as unknown as Measurable | null;
    const content = (sv as unknown as { getInnerViewRef?: () => Measurable | null }).getInnerViewRef?.() ?? null;
    if (native === null || content === null) return;
    // The content's top relative to the scroll's frame is minus the scroll offset; a field outside this scroll fails to measure.
    content.measureLayout(native, (_cx, cy) => {
      field.measureLayout(content, (_x, y, _w, h) => {
        const to = revealScrollY({ fieldY: y, fieldHeight: h, viewportHeight: viewport.current, scrollY: -cy });
        if (to !== null) sv.scrollTo({ y: to, animated: true });
      }, () => undefined);
    }, () => undefined);
  }, []);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', reveal);
    return () => {
      sub.remove();
    };
  }, [reveal]);
  const setRef = useCallback(
    (v: ScrollView | null) => {
      inner.current = v;
      if (typeof ref === 'function') ref(v);
      else if (ref) (ref as { current: ScrollView | null }).current = v;
    },
    [ref],
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      {...rest}
      ref={setRef}
      onLayout={(e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        const shrank = h < viewport.current;
        viewport.current = h;
        if (shrank) reveal();
        onLayout?.(e);
      }}
    />
  );
}
