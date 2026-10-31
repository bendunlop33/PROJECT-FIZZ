import { Pressable, View } from 'react-native';

import type { PlanWeekCircle } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * (Redesign 27 Oct, D1) The plan's weeks as circles spread evenly across the header card: done = green ✓, this week =
 * filled with its number, later = outlined with its number, `Deload` under a deload week. Tapping one shows that
 * week's list (a ring marks a picked week that isn't this one). Each is ≥ 44 pt and says its state to VoiceOver;
 * never colour alone (✓, fill and outline differ in shape too).
 */
export function WeekCircles({ circles, onSelect }: { circles: readonly PlanWeekCircle[]; onSelect: (week: number) => void }) {
  const theme = useTheme();
  const size = 36;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Plan weeks" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: theme.space['1'] }}>
      {circles.map((c) => {
        const fill = c.state === 'done' ? theme.colors['status.done'] : c.state === 'current' ? theme.colors.accent : 'transparent';
        const border = c.state === 'later' ? theme.colors['border.control'] : fill;
        return (
          <Pressable
            key={c.week}
            accessibilityRole="radio"
            accessibilityState={{ checked: c.selected || c.state === 'current' }}
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => {
              onSelect(c.week);
            }}
            style={({ pressed }) => ({ width: 44, minHeight: 44, alignItems: 'center', gap: 2, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, alignItems: 'center', justifyContent: 'center', borderWidth: c.selected ? 2 : 0, borderColor: theme.colors['text.secondary'] }}>
              <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: border, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
                {c.text === null ? (
                  <Icon name="checkmark" color="on.accent" size={16} weight="bold" />
                ) : (
                  <AppText variant="body" numeric color={c.state === 'current' ? 'on.accent' : 'text.secondary'} style={{ fontSize: 16, lineHeight: 20, fontWeight: c.state === 'current' ? '600' : '500' }}>
                    {c.text}
                  </AppText>
                )}
              </View>
            </View>
            {c.caption !== null ? (
              <AppText variant="label" color="text.tertiary" style={{ fontSize: 11, lineHeight: 13 }}>
                {c.caption}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
