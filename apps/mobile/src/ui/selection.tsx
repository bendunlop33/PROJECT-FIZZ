import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { Icon } from './Icon';
import { AppText } from './Text';

/**
 * Select mode (delete-workouts §2.3, DW-Q5): a row whose whole width
 * toggles it, with a 44pt selection circle (accent when on). The state is
 * also in words for VoiceOver (`…, selected`), never colour alone.
 */
export function SelectRow({ title, lines, selected, onToggle, accessibilityLabel }: { title: string; lines: readonly string[]; selected: boolean; onToggle: () => void; accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onToggle}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 52, paddingVertical: theme.space['3'], paddingHorizontal: theme.space['4'] }}>
        <View style={{ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} color={selected ? 'accent' : 'text.tertiary'} size={24} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" numeric>
            {title}
          </AppText>
          {lines.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

/** `SelectionToolbar` (DW-Q5): the bottom bar in select mode, one leading and one trailing action, each ≥ 44pt. */
export function SelectionToolbar({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: theme.space['3'],
        backgroundColor: theme.components.barOnCanvas ? theme.colors['bg.canvas'] : theme.colors['bg.surface'],
        borderTopWidth: theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        paddingHorizontal: theme.space['4'],
        paddingTop: theme.space['2'],
        paddingBottom: theme.space['2'] + insets.bottom,
      }}
    >
      <View>{leading}</View>
      <View>{trailing}</View>
    </View>
  );
}
