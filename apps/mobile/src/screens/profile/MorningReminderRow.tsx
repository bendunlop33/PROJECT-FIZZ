import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

import { reminderOn, reminderRowLine } from '@fizz/domain';

import { expoReminderPort, type AlertPermission } from '../../alerts/notifier';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { morningReminderOf } from '../../device/prefs';
import { onAppActive, watchPermission } from '../../reminders/morning';
import { Row } from '../../ui';

/** Profile's `Morning reminder` row: `07:00 · Every day` or `Off` (Ben, 20 Oct). */
export function MorningReminderRow({ onPress }: { onPress: () => void }) {
  const { prefs } = useDevicePrefs();
  const settings = morningReminderOf(prefs);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  useFocusEffect(useCallback(() => watchPermission({ read: () => expoReminderPort.permission(), onActive: onAppActive(AppState), set: setPermission }), []));
  return <Row title="Morning reminder" icon="bell" subtitle={settings.on === null && permission === 'unknown' ? null : reminderRowLine(settings, reminderOn(settings, permission))} onPress={onPress} />;
}
