import { Modal, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * `BlockingCover` (data-import-export §2.3 step 5): full screen, no buttons,
 * no tab bar. Shown while a restore or Undo restore switches databases, so
 * nothing can be logged meanwhile. Static icons only (no spinner animation).
 */
export function BlockingCover({ visible, title, lines }: { visible: boolean; title: string; lines: readonly { text: string; done: boolean }[] }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => undefined}>
      <View
        accessibilityViewIsModal
        accessibilityLiveRegion="polite"
        style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], justifyContent: 'center', paddingHorizontal: theme.space['8'], gap: theme.space['4'] }}
      >
        <AppText variant="title2" align="center" accessibilityRole="header">
          {title}
        </AppText>
        <View style={{ gap: theme.space['2'] }}>
          {lines.map((l) => (
            <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
              <Icon name={l.done ? 'checkmark.circle.fill' : 'ellipsis'} color={l.done ? 'status.done' : 'text.secondary'} size={18} />
              <AppText variant="body">{l.text}</AppText>
            </View>
          ))}
        </View>
        <AppText variant="callout" color="text.secondary" align="center">
          Keep GymSmarter open. If it closes now, your current data stays as it is.
        </AppText>
      </View>
    </Modal>
  );
}
