import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';

import { haptic } from '../device/haptics';
import { useTheme, type ColorToken } from '../theme';
import { claimsRowSwipe, EXERCISE_SWIPE, swipeOffset, swipeRelease, type ExerciseSwipeAction, type ExerciseSwipeActions, type ExerciseSwipeItem } from '../workout/exercise-swipe';
import { AppText } from './Text';

/**
 * (Ben, 1 Nov, approved C) An exercise row in the Workout list that swipes: left reveals `Later · Swap · Skip`
 * (a full swipe skips), right reveals `Add set`. The rules are `workout/exercise-swipe.ts` (tested); the same
 * actions are VoiceOver actions on the row itself (the caller puts them there). Only a sideways drag is claimed:
 * a vertical one stays the list's scroll, and a still hold stays the drag (its `DragItem` takes the touch once
 * the hold fires). Needs a real iPhone check (feel, the full-swipe distance).
 */
export function ExerciseSwipeRow({ actions, onAction, children }: { actions: ExerciseSwipeActions; onAction: (action: ExerciseSwipeAction) => void; children: ReactNode }) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const [open, setOpen] = useState<'left' | 'right' | null>(null);
  const settle = (to: number) => {
    if (theme.a11y.reduceMotion) x.setValue(to);
    else Animated.timing(x, { toValue: to, duration: theme.timing.fast, useNativeDriver: true }).start();
  };
  // The responder is made once; the actions and the handler change with the workout.
  const latest = useRef({ actions, onAction, open });
  latest.current = { actions, onAction, open };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => claimsRowSwipe(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        const base = latest.current.open === 'left' ? -latest.current.actions.left.length * EXERCISE_SWIPE.button : latest.current.open === 'right' ? latest.current.actions.right.length * EXERCISE_SWIPE.button : 0;
        x.setValue(swipeOffset(base + g.dx, width.current, latest.current.actions));
      },
      onPanResponderRelease: (_e, g) => {
        const { actions: a, open: was } = latest.current;
        const base = was === 'left' ? -a.left.length * EXERCISE_SWIPE.button : was === 'right' ? a.right.length * EXERCISE_SWIPE.button : 0;
        const r = swipeRelease(base + g.dx, width.current, a);
        if (r.kind === 'full') {
          haptic('step');
          setOpen(null);
          settle(0);
          latest.current.onAction(r.action);
        } else if (r.kind === 'open') {
          setOpen(r.side);
          settle(r.side === 'left' ? -a.left.length * EXERCISE_SWIPE.button : a.right.length * EXERCISE_SWIPE.button);
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
  const tone = (a: ExerciseSwipeAction): ColorToken => (a === 'skip_exercise' ? 'status.danger' : a === 'swap' || a === 'add_set' ? 'accent' : 'text.tertiary');
  const button = (item: ExerciseSwipeItem) => (
    <Pressable
      key={item.action}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      onPress={() => {
        setOpen(null);
        settle(0);
        onAction(item.action);
      }}
      style={{ width: EXERCISE_SWIPE.button, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors[tone(item.action)] }}
    >
      <AppText variant="label" color="on.accent" style={{ fontWeight: '600' }}>
        {item.label}
      </AppText>
    </Pressable>
  );
  return (
    <View
      style={{ overflow: 'hidden' }}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
    >
      {/* Behind the row, so a drag shows them as it goes; tappable (and read) only once that side is open. */}
      {(['left', 'right'] as const).map((side) =>
        actions[side].length > 0 ? (
          <View
            key={side}
            pointerEvents={open === side ? 'auto' : 'none'}
            accessibilityElementsHidden={open !== side}
            importantForAccessibility={open === side ? 'auto' : 'no-hide-descendants'}
            style={{ position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', ...(side === 'left' ? { right: 0 } : { left: 0 }) }}
          >
            {actions[side].map(button)}
          </View>
        ) : null,
      )}
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: theme.colors['bg.surface'] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
