import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';

import { ALL_WEEKDAYS, clockText, localDateOf, localTimeUtcMs, reminderOn, reminderTimeText, toggleReminderDay, toMs, weekdayShort, type MorningReminderSettings } from '@fizz/domain';

import { expoReminderPort, type AlertPermission } from '../../alerts/notifier';
import { dateAt } from '../../clock';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { morningReminderOf } from '../../device/prefs';
import { NOTIFICATIONS_OFF_LINE, showNotificationsOff, turnReminderOn } from '../../reminders/morning';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Group, Icon, Row, Screen, StatusLine, TEXT_PRESSED_OPACITY, TextButton } from '../../ui';

/**
 * Profile › Morning reminder (Ben, 20 Oct 2026): "Today: Pull" at a time he
 * picks, on the days he picks. Saved on this phone. iOS is asked for
 * notification permission only when he turns it on.
 */
export function MorningReminderScreen() {
  const theme = useTheme();
  const services = useServices();
  const { prefs, update } = useDevicePrefs();
  const settings = morningReminderOf(prefs);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  const [wheelOpen, setWheelOpen] = useState(false);

  // Read again on every visit: Ben may have changed it in iPhone Settings.
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

  const on = reminderOn(settings, permission);
  const save = (patch: Partial<MorningReminderSettings>) => {
    update({ morningReminder: { ...settings, ...patch } });
  };

  async function toggle(next: boolean) {
    if (!next) {
      save({ on: false });
      return;
    }
    save({ on: true });
    setPermission(await turnReminderOn(expoReminderPort).catch((): AlertPermission => 'denied'));
  }

  const now = services.now();
  const tz = now.tz;
  const wheelMs = localTimeUtcMs(localDateOf(toMs(now.utc), tz), settings.hour, settings.minute, tz);

  return (
    <Screen>
      <View style={{ gap: theme.space['2'] }}>
        <Group>
          <Row
            title="Morning reminder"
            trailing={
              <Switch
                accessibilityLabel="Morning reminder"
                value={on}
                onValueChange={(v) => void toggle(v)}
                trackColor={{ true: theme.colors.accent, false: theme.colors['bg.raised'] }}
              />
            }
          />
          {on ? (
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Time ${reminderTimeText(settings)}`}
                accessibilityState={{ expanded: wheelOpen }}
                onPress={() => {
                  setWheelOpen((o) => !o);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
              >
                <AppText variant="body" style={{ flex: 1 }}>
                  Time
                </AppText>
                <AppText variant="body" numeric color={wheelOpen ? 'accent' : 'text.primary'}>
                  {reminderTimeText(settings)}
                </AppText>
                <Icon name={wheelOpen ? 'chevron.up' : 'chevron.down'} color="text.tertiary" size={14} />
              </Pressable>
              {wheelOpen ? (
                <DateTimePicker
                  value={dateAt(wheelMs)}
                  mode="time"
                  display="spinner"
                  timeZoneName={tz}
                  themeVariant={theme.scheme}
                  onValueChange={(_e, date) => {
                    const [h, m] = clockText(date.getTime(), tz).split(':').map(Number);
                    if (h !== undefined && m !== undefined) save({ hour: h, minute: m });
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </Group>
        {showNotificationsOff(on, permission) ? (
          <StatusLine icon="bell.slash" tone="warning" text={NOTIFICATIONS_OFF_LINE} action={<TextButton label="Open Settings" onPress={() => void Linking.openSettings()} />} />
        ) : null}
      </View>

      {on ? (
        <View style={{ flexDirection: 'row', gap: theme.space['1'] }} accessibilityLabel="Days">
          {ALL_WEEKDAYS.map((d) => (
            <Chip
              key={d}
              grow
              label={weekdayShort(d)}
              selected={settings.days.includes(d)}
              onPress={() => {
                save({ days: toggleReminderDay(settings.days, d) });
              }}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
