import { Pressable, View } from 'react-native';

import type { PlanTabChip } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * (Ben, 27 Oct: Library › Plan v2) The block's weeks as chips (≥ 44pt): `3`, `6 · Deload`, ✓ once done. The
 * **selected** week (the list shows it) is filled; the **current** week has a dot under its number, so the two never
 * read as one. Never colour alone: VoiceOver reads `Week 3, current`, and selected as the tab state.
 */
export function WeekChips({ chips, onSelect }: { chips: readonly PlanTabChip[]; onSelect: (week: number) => void }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['1'] }}>
      {chips.map((c) => {
        const tint: 'on.accent' | 'text.secondary' | 'text.primary' = c.selected ? 'on.accent' : c.done || c.current ? 'text.primary' : 'text.secondary';
        return (
          <Pressable
            key={c.week}
            accessibilityRole="tab"
            accessibilityState={{ selected: c.selected }}
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => {
              onSelect(c.week);
            }}
            style={({ pressed }) => ({
              minWidth: 44,
              minHeight: 44,
              paddingHorizontal: theme.space['2'],
              borderRadius: theme.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 2,
              backgroundColor: c.selected ? theme.colors.accent : theme.colors['bg.raised'],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {c.done ? <Icon name="checkmark" color={tint} size={10} weight="bold" /> : null}
            <AppText variant="label" color={tint} numeric>
              {c.label}
            </AppText>
            {c.current ? <View style={{ position: 'absolute', bottom: 5, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.colors[tint] }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
