import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { toMs } from '@fizz/domain';

import { expoReminderPort } from '../alerts/notifier';
import { useDevicePrefs } from '../device/DevicePrefsContext';
import { morningReminderOf } from '../device/prefs';
import type { AppServices } from '../services/app-services';
import { useDataVersion } from '../shell/context';
import { readUpNextForecast } from './forecast';
import { createMorningReminders, createReminderTriggers, type ReminderPort } from './morning';

/** Writes come in bursts (a Finish, then its Summary reads): one recompute after they settle. */
const SETTLE_MS = 1500;

/**
 * Keeps the morning reminders in step (Ben, 20 Oct): on launch, return to the
 * foreground (time passed, the zone may have changed), a settings change, and
 * after any write a screen reports (start, finish, discard, plan
 * Apply/End/Pause, Make next, routine edits, gym switch). During a workout a
 * refresh only takes today's reminder off (`createMorningReminders`), so
 * logging never shares the JS thread with a forecast. Glue only: the event
 * rules are `createReminderTriggers`.
 */
export function MorningReminderHost({ services, port = expoReminderPort }: { services: AppServices; port?: ReminderPort }) {
  const version = useDataVersion();
  const { prefs } = useDevicePrefs();
  const settings = morningReminderOf(prefs);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsKey = JSON.stringify(settings);

  const triggers = useMemo(() => {
    const reminders = createMorningReminders({
      port,
      forecast: () => readUpNextForecast(services),
      settings: () => settingsRef.current,
      nowMs: () => toMs(services.now().utc),
      tz: () => services.now().tz,
      workoutActive: async () => (await services.sessions.active()) !== null,
    });
    return createReminderTriggers({ refresh: (o) => reminders.refresh(o), settleMs: SETTLE_MS, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => {
        clearTimeout(t as ReturnType<typeof setTimeout>);
      },
    });
  }, [services, port]);

  useEffect(() => {
    triggers.launched();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') triggers.foreground();
    });
    return () => {
      sub.remove();
      triggers.dispose();
    };
  }, [triggers]);

  const firstSettings = useRef(true);
  useEffect(() => {
    if (firstSettings.current) {
      firstSettings.current = false;
      return;
    }
    triggers.settingsChanged();
  }, [triggers, settingsKey]);

  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    triggers.dataChanged();
  }, [triggers, version]);

  return null;
}
