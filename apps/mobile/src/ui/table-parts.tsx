import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';

import { useTheme } from '../theme';
import { AppText } from './Text';
import { Icon } from './Icon';

/**
 * Table parts shared by the builder and the active workout (workout-builder-v3
 * §2.2–§2.7, workout-table-v3 §7; Direction D tokens). Every gesture has a
 * VoiceOver action and a button elsewhere (the pop-up), and every target is
 * at least 44 pt.
 */

/**
 * `[−] value [+]`, 44 pt buttons; holding repeats (§2.2 Length). VoiceOver
 * reads one adjustable element (swipe up / down).
 */
export function Stepper({ label, valueText, onStep, canMinus, canPlus, repeat = false }: { label: string; valueText: string; onStep: (delta: number) => void; canMinus: boolean; canPlus: boolean; repeat?: boolean }) {
  const theme = useTheme();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The latest `onStep` (its page state), so a held button keeps adding from the value now (review S5).
  const step = useRef(onStep);
  step.current = onStep;
  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const hold = (delta: number) => {
    if (!repeat) return;
    stop();
    timer.current = setInterval(() => {
      step.current(delta);
    }, 120);
  };
  const btn = (delta: number, enabled: boolean, glyph: string, name: string) => (
    <Pressable
      accessibilityElementsHidden
      importantForAccessibility="no"
      disabled={!enabled}
      onPress={() => {
        onStep(delta);
      }}
      onLongPress={() => {
        hold(delta);
      }}
      onPressOut={stop}
      accessibilityLabel={name}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors['bg.raised'], opacity: !enabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      <AppText variant="headline" color="text.primary">
        {glyph}
      </AppText>
    </Pressable>
  );
  const actions: AccessibilityActionInfo[] = [
    ...(canPlus ? [{ name: 'increment' as const }] : []),
    ...(canMinus ? [{ name: 'decrement' as const }] : []),
  ];
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={actions}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === 'increment') onStep(1);
        if (e.nativeEvent.actionName === 'decrement') onStep(-1);
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
    >
      {btn(-1, canMinus, '−', `Less ${label}`)}
      <AppText variant="callout" numeric align="center" style={{ minWidth: 84 }}>
        {valueText}
      </AppText>
      {btn(1, canPlus, '+', `More ${label}`)}
    </View>
  );
}

const REVEAL = 88;

/**
 * A row that swipes (§2.3): left reveals `Delete`, right reveals `Swap`.
 * A finger that moves less than 8 pt, or more up/down than across, is a tap
 * or a scroll. The same actions are VoiceOver actions on the row.
 */
export function SwipeRow({
  children,
  onPress,
  leftAction,
  rightAction,
  accessibilityLabel,
  actions,
  onAction,
  container = false,
  holdProps,
}: {
  children: ReactNode;
  onPress: () => void;
  /**
   * The row holds its own accessible controls (the pop-up's set rows: reps,
   * kg and RPE fields): it isn't one VoiceOver element, so they stay
   * reachable; its label and actions belong on a child (review B6).
   */
  container?: boolean;
  /** Revealed by a swipe left (on the right edge): `Delete`. */
  leftAction?: { label: string; onPress: () => void };
  /** Revealed by a swipe right (on the left edge): `Swap`. */
  rightAction?: { label: string; onPress: () => void };
  accessibilityLabel: string;
  actions: readonly { name: string; label: string }[];
  onAction: (name: string) => void;
  /** The press-and-hold drag's handle (`useDragHandle`), on the row's own press. */
  holdProps?: { delayLongPress?: number; onLongPress?: () => void };
}) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState<'left' | 'right' | null>(null);
  const settle = (to: number) => {
    if (theme.a11y.reduceMotion) x.setValue(to);
    else Animated.timing(x, { toValue: to, duration: theme.timing.fast, useNativeDriver: true }).start();
  };
  const close = () => {
    setOpen(null);
    settle(0);
  };
  // The current actions (a set row becomes deletable after `+ Set`): the responder is made once.
  const sides = useRef({ left: leftAction, right: rightAction });
  sides.current = { left: leftAction, right: rightAction };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const lo = sides.current.left === undefined ? 0 : -REVEAL;
        const hi = sides.current.right === undefined ? 0 : REVEAL;
        x.setValue(Math.max(lo, Math.min(hi, g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -REVEAL / 2 && sides.current.left !== undefined) {
          setOpen('left');
          settle(-REVEAL);
        } else if (g.dx > REVEAL / 2 && sides.current.right !== undefined) {
          setOpen('right');
          settle(REVEAL);
        } else {
          setOpen(null);
          settle(0);
        }
      },
      onPanResponderTerminate: () => {
        setOpen(null);
        settle(0);
      },
    }),
  ).current;
  return (
    <View style={{ overflow: 'hidden' }}>
      {leftAction !== undefined && open === 'left' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={leftAction.label}
          onPress={() => {
            close();
            leftAction.onPress();
          }}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: REVEAL, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors['status.danger'] }}
        >
          <AppText variant="headline" color="on.accent">
            {leftAction.label}
          </AppText>
        </Pressable>
      ) : null}
      {rightAction !== undefined && open === 'right' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rightAction.label}
          onPress={() => {
            close();
            rightAction.onPress();
          }}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: REVEAL, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent }}
        >
          <AppText variant="headline" color="on.accent">
            {rightAction.label}
          </AppText>
        </Pressable>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        <Pressable
          {...(container
            ? { accessible: false }
            : {
                accessibilityRole: 'button' as const,
                accessibilityLabel,
                accessibilityActions: actions.map((a) => ({ name: a.name, label: a.label })),
                onAccessibilityAction: (e: AccessibilityActionEvent) => {
                  onAction(e.nativeEvent.actionName);
                },
              })}
          {...(holdProps ?? {})}
          onPress={() => {
            if (open !== null) close();
            else onPress();
          }}
          style={({ pressed }) => ({ minHeight: 52, backgroundColor: pressed ? theme.colors['bg.raised'] : theme.colors['bg.surface'] })}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A settings-style row: `Day   Chest ›` (§2.2). */
export function ValueRow({ label, value, onPress, hint }: { label: string; value: string; onPress: () => void; hint?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="body" color="text.secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </AppText>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

/** The grouped table on Set up and in sheets (16 pt corners, dividers). */
export function Table({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, overflow: 'hidden' }}>{children}</View>;
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: theme.dividerWidth, backgroundColor: theme.colors['border.divider'], marginLeft: theme.space['4'] }} />;
}

/** A sheet's list row: title and an optional second line, ≥ 44 pt. */
export function ChoiceRow({
  title,
  line,
  selected = false,
  tag,
  tags,
  dimmed = false,
  accessibilityLabel,
  onPress,
  disabled = false,
}: {
  title: string;
  line?: string | null;
  selected?: boolean;
  tag?: string | null;
  /** (Ben, 25 Oct) Several short tags: `May hurt` (warning), `Yours`, `Not at Main Gym` (secondary). */
  tags?: readonly { text: string; tone: 'warning' | 'secondary' }[];
  /** Shown faded but still tappable (the Swap sheet's `Not at Main Gym` rows). */
  dimmed?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, tag, ...(tags ?? []).map((t) => t.text), line].filter((x): x is string => typeof x === 'string' && x.length > 0).join(', ')}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], justifyContent: 'center', backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent', opacity: disabled || dimmed ? 0.5 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="body" style={{ flex: 1 }}>
          {selected ? `● ${title}` : title}
        </AppText>
        {tag != null ? (
          <AppText variant="label" color="status.warning">
            {tag}
          </AppText>
        ) : null}
        {(tags ?? []).map((t) => (
          <AppText key={t.text} variant="label" color={t.tone === 'warning' ? 'status.warning' : 'text.secondary'}>
            {t.text}
          </AppText>
        ))}
      </View>
      {line != null && line.length > 0 ? (
        <AppText variant="label" color="text.secondary">
          {line}
        </AppText>
      ) : null}
    </Pressable>
  );
}
