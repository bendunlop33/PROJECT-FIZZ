import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { MOTION, pressFeedback, timerGlyphs, type FadeRise, type PressKind, useTheme } from '../theme';

/**
 * Motion primitives (premium-feel.md §4). React Native's `Animated` with the
 * native driver: opacity and transforms run on the UI thread with no app
 * worklets (ADR 0018), so a motion can't take the logging screen down.
 * Nothing here delays a write or blocks a tap; under Reduce Motion each one
 * becomes what `theme/motion.ts` says.
 */

const EASE_OUT = Easing.out(Easing.cubic);
const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/**
 * Press feedback for a pressable: wrap the pressable in this and pass its
 * `onPressIn`/`onPressOut`. Scales the whole control (background included).
 */
export function usePressScale(kind: PressKind): { style: { transform: { scale: Animated.Value }[] }; onPressIn: () => void; onPressOut: () => void } {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const target = pressFeedback(kind, theme.a11y.reduceMotion).scale;
  useEffect(() => {
    if (theme.a11y.reduceMotion) {
      scale.stopAnimation();
      scale.setValue(1);
    }
  }, [theme.a11y.reduceMotion, scale]);
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => {
      if (target === 1) return;
      Animated.timing(scale, { toValue: target, duration: MOTION.pressIn.durationMs, easing: EASE_OUT, useNativeDriver: true }).start();
    },
    onPressOut: () => {
      if (target === 1 && !theme.a11y.reduceMotion) return;
      Animated.timing(scale, { toValue: 1, duration: MOTION.pressOut.durationMs, easing: EASE_OUT, useNativeDriver: true }).start();
    },
  };
}

/** Pressed opacity for text links and icon buttons (`motion.pressOpacity.text`). */
export const TEXT_PRESSED_OPACITY = pressFeedback('text', false).opacity;

/**
 * Fades (and rises) its children in once, when mounted. `motion` null:
 * appears at once. Remount it (a new `key`) to play it again, e.g. for the
 * Rest ↔ Ready swap. Turning Reduce Motion on mid-way finishes it at once.
 */
export function FadeIn({ motion, children, style, easing = 'out' }: { motion: FadeRise | null; children: ReactNode; style?: StyleProp<ViewStyle>; easing?: 'out' | 'inOut' }) {
  const theme = useTheme();
  const [progress] = useState(() => new Animated.Value(motion === null ? 1 : 0));
  useEffect(() => {
    if (motion === null) return;
    const a = Animated.timing(progress, { toValue: 1, duration: motion.durationMs, delay: motion.delayMs, easing: easing === 'out' ? EASE_OUT : EASE_IN_OUT, useNativeDriver: true });
    a.start();
    return () => {
      a.stop();
    };
    // Plays once per mount.
  }, []);
  useEffect(() => {
    if (theme.a11y.reduceMotion) {
      progress.stopAnimation();
      progress.setValue(1);
    }
  }, [theme.a11y.reduceMotion, progress]);
  const rise = motion?.risePt ?? 0;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** One glyph that cross-fades from its previous character when `changed`. */
function Glyph({ char, changed, textStyle, color }: { char: string; changed: boolean; textStyle: StyleProp<TextStyle>; color: string }) {
  const [prev, setPrev] = useState<string | null>(null);
  const [shown, setShown] = useState(char);
  const fade = useRef(new Animated.Value(1)).current;
  if (char !== shown) {
    setPrev(changed ? shown : null);
    setShown(char);
  }
  useEffect(() => {
    if (prev === null) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const a = Animated.timing(fade, { toValue: 1, duration: MOTION.digit.durationMs, easing: EASE_IN_OUT, useNativeDriver: true });
    a.start(({ finished }) => {
      if (finished) setPrev(null);
    });
    return () => {
      a.stop();
    };
  }, [shown, prev, fade]);
  return (
    <View>
      {prev !== null ? (
        <Animated.Text style={[textStyle, { color, position: 'absolute', left: 0, right: 0, opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>{prev}</Animated.Text>
      ) : null}
      <Animated.Text style={[textStyle, { color, opacity: fade }]}>{shown}</Animated.Text>
    </View>
  );
}

/**
 * The rest numeral (`type.timerDisplay`): one tabular glyph per slot, so
 * nothing moves sideways; only changed glyphs cross-fade (`motion.digit`).
 * `whole` cross-fades every glyph once (±30 s). VoiceOver reads the label,
 * never the glyphs.
 */
export function TimerNumeral({ text, accessibilityLabel, color = 'text.primary', whole = false }: { text: string; accessibilityLabel: string; color?: 'text.primary' | 'text.tertiary'; whole?: boolean }) {
  const theme = useTheme();
  const prevText = useRef<string | null>(null);
  const glyphs = timerGlyphs(prevText.current, text, { reduceMotion: theme.a11y.reduceMotion, whole });
  useEffect(() => {
    prevText.current = text;
  }, [text]);
  const t = theme.type.timerDisplay;
  const textStyle: TextStyle = {
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontWeight: t.fontWeight,
    letterSpacing: t.letterSpacing,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  };
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', justifyContent: 'center' }}>
      {glyphs.map((g, i) => (
        // Keyed by place, so a slot keeps its glyph component and only fades when its own character changes.
        <Glyph key={`${String(glyphs.length)}:${String(i)}`} char={g.char} changed={g.changed} textStyle={textStyle} color={theme.colors[color]} />
      ))}
    </View>
  );
}

/**
 * The finish check (`motion.finish`): the icon is revealed left to right by
 * a cover in the background colour sliding away, then stays. Static under
 * Reduce Motion. Decorative: the words beside it carry the meaning.
 */
export function RevealOnce({ durationMs, size, background, children }: { durationMs: number; size: number; background: string; children: ReactNode }) {
  const [x] = useState(() => new Animated.Value(durationMs > 0 ? 0 : size));
  useEffect(() => {
    if (durationMs <= 0) {
      x.setValue(size);
      return;
    }
    const a = Animated.timing(x, { toValue: size, duration: durationMs, easing: EASE_IN_OUT, useNativeDriver: true });
    a.start();
    return () => {
      a.stop();
      x.setValue(size);
    };
  }, []);
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      {children}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: size, backgroundColor: background, transform: [{ translateX: x }] }} />
    </View>
  );
}

/** A label that fades in after a delay (Summary title in the finish moment). */
export function DelayedFade({ delayMs, durationMs, children }: { delayMs: number; durationMs: number; children: ReactNode }) {
  return <FadeIn motion={durationMs > 0 ? { durationMs, delayMs, risePt: 0 } : null}>{children}</FadeIn>;
}
