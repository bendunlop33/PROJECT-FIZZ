import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { isWorkoutOnScreen, showRestAlertInForeground } from './presentation';
import { REST_ALERT_PREFIX, type NotifierPort } from './rest-alerts';

/**
 * Phone binding for rest-end notifications (expo-notifications 57).
 * Interruption level `active` (DEP-NOTIF passed on build 7); Time Sensitive
 * isn't available on a free Apple ID. No actions on the notification (P-L4).
 * Device test still needed for this build's alerts (lock-screen-and-alerts §7).
 */

// With the workout screen on screen, the app's own cue is the alert: never
// also a banner (§4.3). Minimised to Today or Profile, the banner and sound
// are the alert (review S1).
Notifications.setNotificationHandler({
  handleNotification: (n) => {
    const show = showRestAlertInForeground({
      isWorkoutAlert: n.request.identifier.startsWith(REST_ALERT_PREFIX),
      appActive: AppState.currentState === 'active',
      workoutOnScreen: isWorkoutOnScreen(),
    });
    return Promise.resolve({ shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false });
  },
});

export const expoNotifier: NotifierPort = {
  async schedule(alert) {
    await Notifications.scheduleNotificationAsync({
      identifier: alert.identifier,
      content: { title: alert.title, body: alert.body, sound: true, interruptionLevel: 'active' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alert.fireAtMs },
    });
  },
  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },
  async cancelAllWorkoutAlerts(keep) {
    const workoutAlerts = async () => (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith(REST_ALERT_PREFIX) && n.identifier !== keep);
    for (const n of await workoutAlerts()) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    await clearDeliveredWorkoutAlerts(keep);
    const left = await workoutAlerts();
    if (left.length > 0) throw new Error(`${String(left.length)} scheduled alert(s) couldn’t be cancelled`);
  },
};

export type AlertPermission = 'granted' | 'denied' | 'undetermined';

export async function getAlertPermission(): Promise<AlertPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.status === Notifications.PermissionStatus.GRANTED) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asked in context, at the first rest (rest-state.md §3), never at launch. */
export async function requestAlertPermission(): Promise<AlertPermission> {
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return p.status === Notifications.PermissionStatus.GRANTED ? 'granted' : 'denied';
}

/** On return to the foreground, delivered workout alerts are stale: remove them (§4.3). */
export async function clearDeliveredWorkoutAlerts(keep?: string): Promise<void> {
  const shown = await Notifications.getPresentedNotificationsAsync();
  for (const n of shown) {
    if (n.request.identifier.startsWith(REST_ALERT_PREFIX) && n.request.identifier !== keep) await Notifications.dismissNotificationAsync(n.request.identifier);
  }
}
