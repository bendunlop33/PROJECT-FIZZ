import { Pressable, View } from 'react-native';

import type { LiftTargetLine } from '@fizz/domain';

import { useTheme } from '../theme';
import { AppText, Icon } from '../ui';

/**
 * One lift target as the domain wrote it (Ben approved 20 Oct): `Bench Press 100 kg`, then
 * `est. 1RM 92 kg · was 88 kg on 13 Oct` or `Best: 85 kg × 5 on 17 Oct`, then `8 weeks left · 8 kg
 * to go` or `Hit 2 Dec`. Plain text, no pass/fail colours. Tapping opens the editor.
 */
export function LiftTargetRow({ line, first, onPress }: { line: LiftTargetLine; first: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const body = (
    <View style={{ flex: 1, gap: 2 }}>
      <AppText variant="body" numeric>
        {line.title}
      </AppText>
      {line.hit !== null ? (
        <AppText variant="callout" numeric>
          {line.hit}
        </AppText>
      ) : null}
      {line.detail !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {line.detail}
        </AppText>
      ) : null}
      {line.progress !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {line.progress}
        </AppText>
      ) : null}
    </View>
  );
  const style = { minHeight: 52, flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.space['3'], paddingVertical: theme.space['2'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] };
  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={line.accessibilityLabel} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={line.accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ ...style, opacity: pressed ? 0.7 : 1 })}>
      {body}
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}
