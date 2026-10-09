import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { toMs } from '@fizz/domain';

import { clearDeliveredWorkoutAlerts, expoNotifier } from '../alerts/notifier';
import { createRestAlertController } from '../alerts/rest-alerts';
import { containerBackupFiles, containerTextFile } from '../device/files';
import { expoDatabaseHost } from '../data/expo-sqlite-host';
import { loadPrefs, savePrefs, type DevicePrefs } from '../device/prefs';
import { appInfo, newUuid, nowZoned } from '../device/runtime';
import { AppNavigator } from '../navigation/AppNavigator';
import type { AppServices } from '../services/app-services';
import { startApp, type StartupOutcome } from '../services/startup';
import { ThemeProvider, TIMING, useTheme, type AvailableDirectionId } from '../theme';
import { MessageScreen, PrimaryButton } from '../ui';
import { AppProvider } from './context';

const BACKUP_MANIFEST = 'backup-state.json';

/** One rest-alert controller for the app run (it remembers what is scheduled). */
const restAlerts = createRestAlertController(expoNotifier);

/**
 * On return to the foreground: delivered workout alerts are stale (the screen
 * shows the truth), and the pending one is reconciled with the workout
 * (lock-screen-and-alerts §4.3). Never blocks anything.
 */
function useForegroundAlerts(services: AppServices) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void clearDeliveredWorkoutAlerts().catch(() => undefined);
      void services.sessions
        .active()
        .then((a) => restAlerts.reconcile(a, toMs(services.now().utc)))
        .catch(() => undefined);
    });
    return () => {
      sub.remove();
    };
  }, [services]);
}

function ForegroundAlerts({ services }: { services: AppServices }) {
  useForegroundAlerts(services);
  return null;
}
const DEVICE_PREFS = 'device-prefs.json';

/** Launch: open the data (DatabaseManager, migrations, recovery), then the app. */
function Launch() {
  const theme = useTheme();
  const [outcome, setOutcome] = useState<StartupOutcome | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setOutcome(null);
    setSlow(false);
    // Under timing.coverDelay nothing extra shows (system-states §2.4).
    const timer = setTimeout(() => {
      if (alive) setSlow(true);
    }, TIMING.coverDelay);
    void startApp({
      host: expoDatabaseHost(),
      newDatabaseName: () => `training-${newUuid()}.db`,
      backupFiles: containerBackupFiles(),
      backupManifest: containerTextFile(BACKUP_MANIFEST),
      now: nowZoned,
      newId: newUuid,
      app: appInfo(),
      restAlerts,
    }).then((o) => {
      clearTimeout(timer);
      if (alive) setOutcome(o);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [attempt]);

  const retry = (
    <PrimaryButton
      label="Try again"
      onPress={() => {
        setAttempt((a) => a + 1);
      }}
    />
  );

  if (outcome === null) {
    return slow ? (
      <MessageScreen title="Opening your training data" lines={['Keep GymSmarter open. If it closes, this carries on next time.']} />
    ) : (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />
    );
  }
  switch (outcome.kind) {
    case 'schema_too_new':
      return (
        <MessageScreen
          title="Your data was saved by a newer GymSmarter"
          lines={['This build can’t open it. Install the newer build in SideStore. Nothing has been changed.', outcome.message]}
        />
      );
    case 'sqlite_too_old':
      return (
        <MessageScreen
          title="GymSmarter can’t open its database on this iPhone"
          lines={[`The database engine is SQLite ${outcome.version}; GymSmarter needs 3.37 or newer. Nothing has been changed.`]}
        />
      );
    case 'open_failed':
      return (
        <MessageScreen
          title="Couldn’t open your training data."
          lines={[outcome.message, 'Nothing has been changed. Your backups on this phone and in Files are untouched; restoring one needs the data to open first, so try again or contact the developer.']}
        >
          {retry}
        </MessageScreen>
      );
    case 'ready': {
      const { services, migration, sqliteVersion, setup, recovery, recoveryError } = outcome;
      const relaunch = () => {
        void services
          .close()
          .catch(() => undefined)
          .finally(() => {
            setAttempt((a) => a + 1);
          });
      };
      return (
        <AppProvider services={services} launch={{ migration, sqliteVersion, recovery, recoveryError, restAlerts, restoreInterrupted: services.restore.interruptedRestore }} relaunch={relaunch}>
          <ForegroundAlerts services={services} />
          <AppNavigator
            setupStep={setup.step}
            setupUnit={setup.profile?.preferredUnit ?? null}
            openWorkout={recovery?.openInto === 'active_workout'}
          />
        </AppProvider>
      );
    }
  }
}

function Themed() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Launch />
    </>
  );
}

export function Root() {
  const prefsFile = useMemo(() => containerTextFile(DEVICE_PREFS), []);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  useEffect(() => {
    void loadPrefs(prefsFile).then(setPrefs);
  }, [prefsFile]);
  const onChangeDirection = useCallback(
    (id: AvailableDirectionId) => {
      const next = { themeDirection: id };
      setPrefs(next);
      void savePrefs(prefsFile, next).catch(() => undefined);
    },
    [prefsFile],
  );
  return (
    <SafeAreaProvider>
      <ThemeProvider savedDirection={prefs?.themeDirection ?? null} onChangeDirection={onChangeDirection}>
        <Themed />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
