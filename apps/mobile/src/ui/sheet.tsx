import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { KeyboardScrollView, SheetKeyboardAvoidingView, useKeyboardVisible } from './keyboard';

/**
 * A plain RN Modal bottom card (premium-feel §7.1): its content is there
 * from the first frame, so it can never show blank (the native form-sheet
 * detents did on device, D2). The scrim closes it. The card rides above the
 * keyboard; its content scrolls when it doesn't fit (0.5), and `footer`
 * stays pinned under it, so a sheet's Save is always visible while typing.
 * `scroll={false}`: the sheet scrolls its own list (it keeps its buttons fixed).
 */
export function BottomCard({
  visible,
  onClose,
  onDismissed,
  children,
  header,
  footer,
  closeLabel = 'Close',
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  onDismissed?: () => void;
  children: ReactNode;
  /** (27 Oct) Pinned above the scrolling content: a title and a search field stay in view while the list scrolls and the keyboard is up. */
  header?: ReactNode;
  /** Pinned under the scrolling content (Save, Remove, Cancel). */
  footer?: ReactNode;
  closeLabel?: string;
  scroll?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return (
    <Modal visible={visible} transparent animationType={theme.a11y.reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose} {...(onDismissed ? { onDismiss: onDismissed } : {})}>
      <SheetKeyboardAvoidingView style={{ flex: 1 }} contentStyle={{ justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={closeLabel} accessibilityRole="button" onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.scrim }} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors['bg.surface'],
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            paddingHorizontal: theme.components.screenMargin,
            paddingTop: theme.space['6'],
            // On the keyboard there is no home indicator to clear.
            paddingBottom: theme.space['4'] + (keyboard ? 0 : insets.bottom),
            gap: theme.space['4'],
            maxHeight: '90%',
          }}
        >
          {header !== undefined && header !== null ? <View style={{ gap: theme.space['3'] }}>{header}</View> : null}
          {scroll ? (
            <KeyboardScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ gap: theme.space['4'] }}>
              {children}
            </KeyboardScrollView>
          ) : (
            children
          )}
          {footer !== undefined && footer !== null ? <View style={{ gap: theme.space['2'] }}>{footer}</View> : null}
        </View>
      </SheetKeyboardAvoidingView>
    </Modal>
  );
}
