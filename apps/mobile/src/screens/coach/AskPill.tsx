import { Pressable } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * `Ask` (design-system §9.8, coach-sheet §1): bottom-trailing, opens the
 * coach sheet with this page's context. Always one word; the sheet says
 * whether the coach can answer. `bottom`: distance from the bottom of its
 * container (default `space4`); raise it above a toast drawn there.
 */
export function AskPill({ onPress, bottom }: { onPress: () => void; bottom?: number }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask the coach"
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: theme.components.screenMargin,
        bottom: bottom ?? theme.space['4'],
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['1'],
        paddingHorizontal: theme.space['4'],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors['bg.raised'],
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="bubble.left" size={18} color="text.primary" />
      <AppText variant="callout">Ask</AppText>
    </Pressable>
  );
}
