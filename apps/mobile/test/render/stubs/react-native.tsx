/**
 * A JS stand-in for `react-native` in render smoke tests (ADR 0037). The real package ships Flow source and
 * native bindings, so it can't load under Node. Components render as host elements named after the RN component
 * (`View`, `Text`, …) with their props, so a test can find text and press handlers; APIs are inert. Only what the
 * app imports is here: an import of anything else fails loudly (vitest names the missing export).
 */
import { createElement, forwardRef, useImperativeHandle, type ReactNode, type Ref } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };

function host(name: string, methods: Record<string, (...args: unknown[]) => unknown> = {}) {
  const C = forwardRef(function Host(props: Props, ref: Ref<unknown>) {
    useImperativeHandle(ref, () => ({ ...noopMethods, ...methods }), []);
    return createElement(name, props, props.children);
  });
  C.displayName = name;
  return C;
}

const noop = () => undefined;
const sub = () => ({ remove: noop });
const noopMethods = {
  measure: (cb: (...a: number[]) => void) => {
    cb(0, 0, 393, 100, 0, 0);
  },
  measureInWindow: (cb: (...a: number[]) => void) => {
    cb(0, 0, 393, 100);
  },
  measureLayout: noop,
  focus: noop,
  blur: noop,
  setNativeProps: noop,
};

export const View = host('View');
export const Text = host('Text');
export const ScrollView = host('ScrollView', { scrollTo: noop, scrollToEnd: noop, flashScrollIndicators: noop, getScrollResponder: noop });
export const TextInput = host('TextInput', { clear: noop, isFocused: () => false });
export const Switch = host('Switch');
export const ActivityIndicator = host('ActivityIndicator');
export const InputAccessoryView = host('InputAccessoryView');
export const Image = host('Image');
export const KeyboardAvoidingView = host('KeyboardAvoidingView');

export const Pressable = forwardRef(function Pressable(props: Props, ref: Ref<unknown>) {
  useImperativeHandle(ref, () => noopMethods, []);
  const { children, style } = props;
  return createElement(
    'Pressable',
    { ...props, style: typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style },
    typeof children === 'function' ? (children as (s: { pressed: boolean }) => ReactNode)({ pressed: false }) : children,
  );
});

export function Modal(props: Props) {
  return props.visible === false ? null : createElement('Modal', props, props.children);
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten)) as Record<string, unknown>;
  return style !== null && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}
const absoluteFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };
export const StyleSheet = { create: <T,>(s: T): T => s, flatten, compose: (a: unknown, b: unknown) => [a, b], hairlineWidth: 1 / 3, absoluteFill, absoluteFillObject: absoluteFill };

export const Platform = { OS: 'ios', Version: '26.0', isPad: false, isTV: false, constants: {}, select: (o: Record<string, unknown>) => o.ios ?? o.native ?? o.default };

const WINDOW = { width: 393, height: 852, scale: 3, fontScale: 1 };
export const Dimensions = { get: () => WINDOW, addEventListener: sub };
export const useWindowDimensions = () => WINDOW;
export const PixelRatio = { get: () => 3, getFontScale: () => 1, roundToNearestPixel: (x: number) => x, getPixelSizeForLayoutSize: (x: number) => x * 3 };
export const useColorScheme = () => 'light';

export const AppState = { currentState: 'active', isAvailable: true, addEventListener: sub };
export const Keyboard = { addListener: sub, dismiss: noop, isVisible: () => false, metrics: () => undefined, scheduleLayoutAnimation: noop };
export const LayoutAnimation = {
  configureNext: noop,
  create: () => ({}),
  easeInEaseOut: noop,
  linear: noop,
  spring: noop,
  Presets: { easeInEaseOut: {}, linear: {}, spring: {} },
  Types: {},
  Properties: {},
};
export const Linking = { openURL: () => Promise.resolve(), canOpenURL: () => Promise.resolve(true), openSettings: () => Promise.resolve(), getInitialURL: () => Promise.resolve(null), addEventListener: sub };
export const Alert = { alert: noop, prompt: noop };
export const ActionSheetIOS = { showActionSheetWithOptions: noop, showShareActionSheetWithOptions: noop, dismissActionSheet: noop };
export const Share = { share: () => Promise.resolve({ action: 'dismissedAction' }), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' };
const no = () => Promise.resolve(false);
export const AccessibilityInfo = {
  isReduceMotionEnabled: no,
  isBoldTextEnabled: no,
  isScreenReaderEnabled: no,
  isReduceTransparencyEnabled: no,
  isGrayscaleEnabled: no,
  isInvertColorsEnabled: no,
  prefersCrossFadeTransitions: no,
  isDarkerSystemColorsEnabled: no,
  addEventListener: sub,
  announceForAccessibility: noop,
  announceForAccessibilityWithOptions: noop,
  setAccessibilityFocus: noop,
  sendAccessibilityEvent: noop,
};
export const PanResponder = { create: () => ({ panHandlers: {} }) };

// Animated: values hold a number; animations never run (a smoke test needs the tree, not the motion).
class AnimatedValue {
  constructor(private v = 0) {}
  setValue(v: number) {
    this.v = v;
  }
  setOffset = noop;
  flattenOffset = noop;
  extractOffset = noop;
  addListener = () => 'listener';
  removeListener = noop;
  removeAllListeners = noop;
  stopAnimation(cb?: (v: number) => void) {
    cb?.(this.v);
  }
  resetAnimation(cb?: (v: number) => void) {
    cb?.(this.v);
  }
  interpolate() {
    return new AnimatedValue(this.v);
  }
  __getValue() {
    return this.v;
  }
}
class AnimatedValueXY {
  x = new AnimatedValue();
  y = new AnimatedValue();
  setValue = noop;
  getLayout = () => ({ left: this.x, top: this.y });
  getTranslateTransform = () => [{ translateX: this.x }, { translateY: this.y }];
  stopAnimation = noop;
}
const animation = () => ({ start: noop, stop: noop, reset: noop });
const combine = () => new AnimatedValue();
export const Animated = {
  Value: AnimatedValue,
  ValueXY: AnimatedValueXY,
  timing: animation,
  spring: animation,
  decay: animation,
  parallel: animation,
  sequence: animation,
  stagger: animation,
  loop: animation,
  delay: animation,
  event: () => noop,
  add: combine,
  subtract: combine,
  multiply: combine,
  divide: combine,
  modulo: combine,
  diffClamp: combine,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  ScrollView: host('Animated.ScrollView', { scrollTo: noop, scrollToEnd: noop }),
  Image: host('Animated.Image'),
  createAnimatedComponent: <T,>(c: T) => c,
};

const ease = (t: number) => t;
const wrap = () => ease;
export const Easing = {
  linear: ease,
  ease,
  quad: ease,
  cubic: ease,
  sin: ease,
  circle: ease,
  exp: ease,
  bounce: ease,
  poly: wrap,
  elastic: wrap,
  back: wrap,
  bezier: wrap,
  step0: ease,
  step1: ease,
  in: wrap,
  out: wrap,
  inOut: wrap,
};
