import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDevicePrefs } from '../device/DevicePrefsContext';
import { useTheme } from '../theme';
import { AppText, PrimaryButton, TextButton } from '../ui';
import { createAfterDismiss } from '../workout/after-dismiss';
import { shouldAskOnStart } from './ask';
import { getAlertPermission, requestAlertPermission } from './notifier';

/**
 * `Rest alerts` (premium-feel §3.5): asked once, in context, on the first
 * Start, before the check-in. Either answer continues the same Start. A
 * plain RN Modal bottom card, not a native-stack form sheet: form-sheet
 * detents rendered blank on device (commit aa1ee3d, D2), and this card has
 * its content from the first frame.
 */
export function useStartAlertsAsk(): { ensureAsked: () => Promise<void>; sheet: ReactNode } {
  const { prefs, update } = useDevicePrefs();
  const [visible, setVisible] = useState(false);
  const resume = useRef<(() => void) | null>(null);
  const [afterDismiss] = useState(() => createAfterDismiss());

  const ensureAsked = useCallback(async () => {
    if (prefs.alertsAsk !== 'undetermined') return;
    const permission = await getAlertPermission().catch(() => 'unknown' as const);
    if (!shouldAskOnStart(permission, prefs.alertsAsk)) return;
    await new Promise<void>((resolve) => {
      resume.current = resolve;
      setVisible(true);
    });
  }, [prefs.alertsAsk]);

  const answer = (allow: boolean) => {
    update({ alertsAsk: allow ? 'answered' : 'later' });
    // Continue only once the card has gone, so the next sheet (check-in) or the workout presents cleanly.
    afterDismiss.arm(() => {
      const go = resume.current;
      resume.current = null;
      if (!go) return;
      if (allow) void requestAlertPermission().catch(() => 'denied' as const).finally(go);
      else go();
    });
    setVisible(false);
  };

  return { ensureAsked, sheet: <AlertsAskCard visible={visible} onAllow={() => { answer(true); }} onLater={() => { answer(false); }} onDismissed={afterDismiss.dismissed} /> };
}

function AlertsAskCard({ visible, onAllow, onLater, onDismissed }: { visible: boolean; onAllow: () => void; onLater: () => void; onDismissed: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={theme.a11y.reduceMotion ? 'fade' : 'slide'} onRequestClose={onLater} onDismiss={onDismissed}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* The scrim is part of the card's modal; tapping it is `Not now` (the Start still continues). */}
        <Pressable accessibilityLabel="Not now" accessibilityRole="button" onPress={onLater} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.scrim }} />
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
          }}
        >
          <AppText variant="title2" accessibilityRole="header">
            Rest alerts
          </AppText>
          <AppText variant="body">Alert when rest ends?</AppText>
          <PrimaryButton label="Allow" onPress={onAllow} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Not now" tone="secondary" onPress={onLater} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
