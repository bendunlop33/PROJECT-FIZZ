import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { reminderOn, reminderRowLine } from '@fizz/domain';

import { expoReminderPort, type AlertPermission } from '../../alerts/notifier';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { morningReminderOf } from '../../device/prefs';
import { Row } from '../../ui';

/** Profile's `Morning reminder` row: `07:00 · Every day` or `Off` (Ben, 20 Oct). */
export function MorningReminderRow({ onPress }: { onPress: () => void }) {
  const { prefs } = useDevicePrefs();
  const settings = morningReminderOf(prefs);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void expoReminderPort
        .permission()
        .then((p) => {
          if (alive) setPermission(p);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  return <Row title="Morning reminder" icon="bell" subtitle={settings.on === null && permission === 'unknown' ? null : reminderRowLine(settings, reminderOn(settings, permission))} onPress={onPress} />;
}
