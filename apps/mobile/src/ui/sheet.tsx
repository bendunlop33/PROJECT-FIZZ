import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';

/**
 * A plain RN Modal bottom card (premium-feel §7.1): its content is there
 * from the first frame, so it can never show blank (the native form-sheet
 * detents did on device, D2). The scrim closes it. The card rides above the
 * keyboard, so a sheet's primary button stays visible while typing.
 */
export function BottomCard({ visible, onClose, onDismissed, children, closeLabel = 'Close' }: { visible: boolean; onClose: () => void; onDismissed?: () => void; children: ReactNode; closeLabel?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={theme.a11y.reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose} {...(onDismissed ? { onDismiss: onDismissed } : {})}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={closeLabel} accessibilityRole="button" onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.scrim }} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors['bg.surface'],
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            paddingHorizontal: theme.components.screenMargin,
            paddingTop: theme.space['6'],
            paddingBottom: theme.space['4'] + insets.bottom,
            gap: theme.space['4'],
            maxHeight: '90%',
          }}
        >
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
