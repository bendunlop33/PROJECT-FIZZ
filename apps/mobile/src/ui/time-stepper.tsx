import { Pressable, View, type AccessibilityActionEvent } from 'react-native';

import { TODAY_V2_COPY } from '@fizz/domain';

import { useTheme } from '../theme';
import { TIME_LABELS } from '../today/today-view';
import { AppText } from './Text';

const HIT = { top: 5, bottom: 5, left: 4, right: 4 } as const;

/**
 * The Time control `[−] 45 min [+]` (workout-builder-v3 §2.0.2 control 3), one for Today's card and Your workout
 * (22 Oct, Ben: "add option to reduce time"): 5-minute steps, a 34 pt circle with a 5 pt slop each side, and one
 * adjustable VoiceOver element for the value. It shows a length and reports a step; the page's service fits the
 * workout to it.
 */
export function TimeStepper({ minutes, onStep }: { minutes: number; onStep: (d: -1 | 1) => void }) {
  const theme = useTheme();
  const btn = (d: -1 | 1) => (
    <Pressable accessibilityRole="button" accessibilityLabel={d < 0 ? TIME_LABELS.less : TIME_LABELS.more} hitSlop={HIT} onPress={() => { onStep(d); }} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="label">{d < 0 ? '−' : '+'}</AppText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      {btn(-1)}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={TIME_LABELS.value(minutes)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
      >
        <AppText variant="label" numeric style={{ minWidth: 64, textAlign: 'center' }}>
          {TODAY_V2_COPY.minutesValue(minutes)}
        </AppText>
      </View>
      {btn(1)}
    </View>
  );
}
