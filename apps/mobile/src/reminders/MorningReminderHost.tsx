import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { toMs } from '@fizz/domain';

import { expoReminderPort } from '../alerts/notifier';
import { useDevicePrefs } from '../device/DevicePrefsContext';
import { morningReminderOf } from '../device/prefs';
import type { AppServices } from '../services/app-services';
import { useDataVersion } from '../shell/context';
import { readUpNextForecast } from './forecast';
import { createMorningReminders } from './morning';

/** Writes come in bursts (a Finish, then its Summary reads): one recompute after they settle. */
const SETTLE_MS = 1500;

/**
 * Keeps the morning reminders in step (Ben, 20 Oct): on launch, return to the
 * foreground (time passed, the zone may have changed), a settings change, and
 * after any write a screen reports (finish, discard, plan Apply/End/Pause,
 * Make next, routine edits, gym switch). Writes during a workout wait for its
 * Finish or Discard, so logging never shares the JS thread with a recompute.
 */
export function MorningReminderHost({ services }: { services: AppServices }) {
  const version = useDataVersion();
  const { prefs } = useDevicePrefs();
  const settings = morningReminderOf(prefs);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsKey = JSON.stringify(settings);

  const reminders = useMemo(
    () =>
      createMorningReminders({
        port: expoReminderPort,
        forecast: () => readUpNextForecast(services),
        settings: () => settingsRef.current,
        nowMs: () => toMs(services.now().utc),
        tz: () => services.now().tz,
      }),
    [services],
  );

  // Launch and settings changes: always.
  useEffect(() => {
    const t = setTimeout(() => void reminders.refresh(), SETTLE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [reminders, settingsKey]);

  // Writes: after they settle, unless a workout is in progress.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      void services.sessions
        .active()
        .catch(() => null)
        .then((active) => (active === null ? reminders.refresh() : undefined));
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [reminders, services, version]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reminders.refresh();
    });
    return () => {
      sub.remove();
    };
  }, [reminders]);

  return null;
}
