import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { MORNING_REMINDER_PREFIX } from '@fizz/domain';

import type { ReminderPort } from '../reminders/morning';

import { appleSpeaker, voicePrefs } from '../voice/speaker';
import { isWorkoutOnScreen, showMorningReminderInForeground, showRestAlertInForeground } from './presentation';
import { REST_ALERT_PREFIX, type NotifierPort } from './rest-alerts';

/**
 * Phone binding for rest-end notifications (expo-notifications 57).
 * Interruption level `active` (DEP-NOTIF passed on build 7); Time Sensitive
 * isn't available on a free Apple ID. Device test still needed for this
 * build's alerts (lock-screen-and-alerts §7).
 *
 * (Ben, 15 Nov, build 568: no way to log on the Lock Screen at the rest's
 * end) The rest-done alert carries one action, `Log 80 kg × 8`, when the set
 * after the rest can be logged from the Lock Screen (`alert.log`). It runs in
 * the background without unlocking (`opensAppToForeground: false`, no
 * authentication, as the Live Activity's Log): the app turns it into the same
 * versioned, idempotent `log_set` (`live-activity/taps.ts`). One category,
 * re-registered with the button text at each schedule (one rest alert is
 * pending at a time). Reverses P-L4 for this one action.
 */

// With the workout screen on screen, or a spoken cue about to play anywhere
// in the app, the app's own cue is the alert: never also a banner (§4.3;
// voice review S2). Otherwise the banner and sound are the alert (review S1).
Notifications.setNotificationHandler({
  handleNotification: (n) => {
    if (n.request.identifier.startsWith(MORNING_REMINDER_PREFIX)) {
      const morning = showMorningReminderInForeground({ appActive: AppState.currentState === 'active', workoutOnScreen: isWorkoutOnScreen() });
      return Promise.resolve({ shouldShowBanner: morning, shouldShowList: morning, shouldPlaySound: morning, shouldSetBadge: false });
    }
    const show = showRestAlertInForeground({
      isWorkoutAlert: n.request.identifier.startsWith(REST_ALERT_PREFIX),
      appActive: AppState.currentState === 'active',
      workoutOnScreen: isWorkoutOnScreen(),
      spokenCueWillPlay: voicePrefs().cuesOn && appleSpeaker.available(),
    });
    return Promise.resolve({ shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false });
  },
});

/** The rest-done alert's category and its one action (no `:` or `-` in a category ID, per expo-notifications). */
export const REST_LOG_CATEGORY = 'fizz.rest.log';
export const REST_LOG_ACTION = 'fizz.log';

/** Registers the Log action with this alert's text; false when it can't (the alert then goes without it). */
async function registerLogAction(label: string): Promise<boolean> {
  try {
    await Notifications.setNotificationCategoryAsync(REST_LOG_CATEGORY, [{ identifier: REST_LOG_ACTION, buttonTitle: label, options: { opensAppToForeground: false, isAuthenticationRequired: false, isDestructive: false } }]);
    return true;
  } catch {
    return false;
  }
}

export const expoNotifier: NotifierPort = {
  async schedule(alert) {
    const withLog = alert.log !== null && (await registerLogAction(alert.log.label));
    await Notifications.scheduleNotificationAsync({
      identifier: alert.identifier,
      content: {
        title: alert.title,
        body: alert.body,
        sound: true,
        interruptionLevel: 'active',
        ...(withLog && alert.log !== null ? { categoryIdentifier: REST_LOG_CATEGORY, data: { log: alert.log.target } } : {}),
      },
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

/**
 * Phone binding for the morning reminder (Ben, 20 Oct): local notifications
 * only, interruption level `active` like rest alerts (no Time Sensitive, no
 * push). A calendar trigger with local date and time and no zone, so iOS
 * fires it at that wall-clock time in whatever zone the phone is in (DST
 * included). A time inside a spring-forward gap (e.g. 01:30 on the last
 * Sunday of March in London) may not fire that day; accepted, as morning
 * times aren't in the gap (review N2). Device test still needed.
 */
export const expoReminderPort: ReminderPort = {
  permission: getAlertPermission,
  request: requestAlertPermission,
  async pending() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier).filter((id) => id.startsWith(MORNING_REMINDER_PREFIX));
  },
  async schedule(r) {
    const [year, month, day] = r.fireAtLocal.date.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) throw new Error(`Bad reminder date ${r.fireAtLocal.date}`);
    await Notifications.scheduleNotificationAsync({
      identifier: r.identifier,
      content: { title: r.title, body: r.body, sound: true, interruptionLevel: 'active', data: { open: 'today' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, repeats: false, year, month, day, hour: r.fireAtLocal.hour, minute: r.fireAtLocal.minute, second: 0 },
    });
  },
  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },
};

/** A tap on any notification (lock screen or banner) with its identifier; what it opens is `morningTapOpensToday`. */
export function onNotificationTap(onTap: (identifier: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onTap(response.notification.request.identifier);
  });
  return () => {
    sub.remove();
  };
}

/** A `Log …` action chosen on a rest-done alert: the alert's identifier and the Log target it carried. */
export interface RestLogAction {
  identifier: string;
  target: string;
  /** When the app received it (no tap time is given by iOS). */
  atMs: number;
}

function restLogActionOf(response: Notifications.NotificationResponse | null, atMs: number): RestLogAction | null {
  if (response?.actionIdentifier !== REST_LOG_ACTION) return null;
  const req = response.notification.request;
  if (!req.identifier.startsWith(REST_ALERT_PREFIX)) return null;
  const data: unknown = req.content.data;
  const target = typeof data === 'object' && data !== null ? (data as { log?: unknown }).log : undefined;
  return typeof target === 'string' ? { identifier: req.identifier, target, atMs } : null;
}

/**
 * (Ben, 15 Nov) Rest-done `Log …` actions: each one as it arrives, and at subscribe time the one that launched the
 * app in the background (iOS hands it over before JS listens). Idempotence is the Log's own operation ID.
 */
export function onRestLogAction(handle: (action: RestLogAction) => void, nowMs: () => number): () => void {
  try {
    const launched = restLogActionOf(Notifications.getLastNotificationResponse(), nowMs());
    if (launched !== null) {
      Notifications.clearLastNotificationResponse();
      handle(launched);
    }
  } catch {
    // Nothing waiting.
  }
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const a = restLogActionOf(response, nowMs());
    if (a !== null) handle(a);
  });
  return () => {
    sub.remove();
  };
}
