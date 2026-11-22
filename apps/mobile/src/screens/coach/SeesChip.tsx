import { Pressable } from 'react-native';

import { seesChipParts } from '../../coach/sheet-view';
import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * The coach sheet's `Sees:` chip (Ben, 15 Nov, build 568: `Sees: Push B · Dumbbell shoulder press (live)` wrapped to
 * two lines and overlapped the reply above it). Always one line: the label's middle is cut with an ellipsis, the
 * `(live)` / `(draft)` tag stays whole, and the pill never grows past the footer's width, so it can't spill into the
 * transcript.
 */
export function SeesChip({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const { main, tag } = seesChipParts(label);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="What the coach can see"
      accessibilityHint={label}
      onPress={onPress}
      style={{ alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'] }}
    >
      <Icon name="eye" size={16} />
      <AppText variant="label" numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1 }}>
        {main}
      </AppText>
      {tag === null ? null : (
        <AppText variant="label" numberOfLines={1} style={{ flexShrink: 0 }}>
          {tag}
        </AppText>
      )}
    </Pressable>
  );
}
