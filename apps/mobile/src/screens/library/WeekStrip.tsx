import { Pressable, View } from 'react-native';

import type { PlanWeekBar } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText } from '../../ui';

/**
 * (Ben, 2 Nov: one plan screen) Library › Plan's weeks as a strip of bars, the week number under each: done = filled
 * green (no tick), this week = accent, later = neutral with a solid edge, a deload week still to come dashed with `↓`. Tapping one shows
 * that week's list; an outline marks a picked week that isn't this one (tap this week to go back). Each is 44 pt tall
 * (as wide as the card allows: ≥ 44 pt up to 6 weeks) and
 * says its state to VoiceOver; never colour alone (fill, dash and outline differ in shape, and the label says it).
 */
export function WeekStrip({ weeks, onSelect }: { weeks: readonly PlanWeekBar[]; onSelect: (week: number) => void }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Plan weeks" style={{ flexDirection: 'row', gap: 4, paddingTop: theme.space['1'] }}>
      {weeks.map((w) => {
        const dashed = w.deload && w.state === 'later';
        const fill = w.state === 'done' ? theme.colors['status.done'] : w.state === 'current' ? theme.colors.accent : dashed ? 'transparent' : theme.colors['bg.raised'];
        return (
          <Pressable
            key={w.week}
            testID={`plan-week-${w.state}${w.deload ? '-deload' : ''}${w.selected ? '-picked' : ''}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: w.selected || w.state === 'current' }}
            accessibilityLabel={w.accessibilityLabel}
            onPress={() => {
              onSelect(w.week);
            }}
            style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ alignSelf: 'stretch', padding: 2, borderRadius: 6, borderWidth: 2, borderColor: w.selected ? theme.colors['text.secondary'] : 'transparent' }}>
              <View testID="plan-week-bar" style={{ height: 8, borderRadius: 4, backgroundColor: fill, ...(w.state === 'later' ? { borderWidth: 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: theme.colors['border.control'] } : {}) }} />
            </View>
            <AppText variant="callout" color={w.state === 'current' || w.selected ? 'text.primary' : 'text.tertiary'} numeric numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, ...(w.state === 'current' ? { fontWeight: '600' } : {}) }}>
              {w.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
