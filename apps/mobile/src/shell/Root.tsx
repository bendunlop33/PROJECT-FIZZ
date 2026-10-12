import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { toMs } from '@fizz/domain';
import { readTextCoachState } from '@fizz/providers';

import { coachConnectionPorts, deviceCredentials } from '../ai/coach-connection-ports';
import { clearDeliveredWorkoutAlerts, expoNotifier } from '../alerts/notifier';
import { createPlanModelPort } from '../coach/plan-model-port';
import { createRestAlertController } from '../alerts/rest-alerts';
import { nowMs } from '../clock';
import { createLiveActivityController } from '../live-activity/controller';
import { lazyLiveActivityPort } from '../live-activity/lazy-port';
import { containerBackupFiles, containerTextFile, emptyTemporaryFiles, removeContainerFiles } from '../device/files';
import { createPersonalFiles, DEVICE_PREFS_FILE } from '../device/personal-files';
import { expoDatabaseHost, removeDatabaseFiles } from '../data/expo-sqlite-host';
import { deleteUnfinishedView } from '../backup/data-domain-view';
import { DevicePrefsProvider, useDevicePrefs } from '../device/DevicePrefsContext';
import { createPrefsHolder, DEFAULT_PREFS, type DevicePrefs } from '../device/prefs';
import { appInfo, deviceTimeZone, newUuid, nowZoned, whenIdle } from '../device/runtime';
import { AppNavigator } from '../navigation/AppNavigator';
import type { AppServices } from '../services/app-services';
import { startApp, type StartupOutcome } from '../services/startup';
import { ThemeProvider, TIMING, useTheme, type AvailableDirectionId } from '../theme';
import { MessageScreen, PrimaryButton, SecondaryButton } from '../ui';
import { AppProvider } from './context';

const BACKUP_MANIFEST = 'backup-state.json';
/** Delete my data's marker and done op IDs (data-import-export §3.6 Interrupted). */
const DATA_LEDGER = 'data-ops.json';

/**
 * The workout's Lock Screen Live Activity (lock-screen-and-alerts §2.1): one
 * per workout, driven by the same reconciles as the rest alert. `Until hh:mm`
 * is in the phone's zone now, so it matches the Lock Screen clock.
 */
const liveActivity = createLiveActivityController(lazyLiveActivityPort, {
  tz: () => deviceTimeZone(),
  clock: { now: nowMs, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>); } },
});

/** One rest-alert controller for the app run (it remembers what is scheduled); the Live Activity follows it. */
const restAlerts = createRestAlertController(expoNotifier, { liveActivity });

/**
 * On return to the foreground: delivered workout alerts are stale (the screen
 * shows the truth), and the pending one is reconciled with the workout
 * (lock-screen-and-alerts §4.3). Never blocks anything.
 */
function useForegroundAlerts(services: AppServices) {
  useEffect(() => {
    // Launch: reconcile once, so a Live Activity left by a force-close is adopted or ended (§4.2).
    void services.sessions
      .active()
      .then((a) => restAlerts.reconcile(a, toMs(services.now().utc)))
      .catch(() => undefined);
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

/** Launch: open the data (DatabaseManager, migrations, recovery), then the app. */
function Launch() {
  const theme = useTheme();
  const { clear: clearPrefs } = useDevicePrefs();
  const [outcome, setOutcome] = useState<StartupOutcome | null>(null);
  const [slow, setSlow] = useState(false);
  // `leave`: Continue after an interrupted delete kept failing (S1).
  const [attempt, setAttempt] = useState<{ n: number; interruptedDelete: 'finish' | 'leave' }>({ n: 0, interruptedDelete: 'finish' });

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
      idle: () => whenIdle(),
      // The coach over the ChatGPT-plan route (ADR 0020 C5); the same Keychain items and fetch as the connection screen.
      coach: {
        model: () => {
          const { ports } = coachConnectionPorts();
          return createPlanModelPort({ fetch: ports.fetch, vault: ports.vault, settings: ports.settings, nowMs: ports.nowMs });
        },
        connection: () => readTextCoachState(coachConnectionPorts().ports),
      },
      dataLedger: containerTextFile(DATA_LEDGER),
      credentials: deviceCredentials(),
      interruptedDelete: attempt.interruptedDelete,
      // Your-data files outside SQLite: coach connection settings, this phone's look and alert answers,
      // crash notes, damaged copies kept aside, the capability-probe database, and picked-file copies in tmp.
      personalFiles: createPersonalFiles({ removeDocuments: removeContainerFiles, removeDatabaseFiles, emptyTemporary: emptyTemporaryFiles }),
    }).then((o) => {
      clearTimeout(timer);
      if (!alive) return;
      // Prefs read before an interrupted delete finished are stale: never write them back (S2).
      if (o.kind === 'ready' && o.personalDataCleared) clearPrefs();
      setOutcome(o);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [attempt, clearPrefs]);

  const relaunchWith = (interruptedDelete: 'finish' | 'leave') => {
    setAttempt((a) => ({ n: a.n + 1, interruptedDelete }));
  };
  const retry = (
    <PrimaryButton
      label="Try again"
      onPress={() => {
        relaunchWith('finish');
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
          lines={['This build can’t open it. Install the newer build in SideStore. Data unchanged.', outcome.message]}
        />
      );
    case 'sqlite_too_old':
      return (
        <MessageScreen
          title="GymSmarter can’t open its database on this iPhone"
          lines={[`The database engine is SQLite ${outcome.version}; GymSmarter needs 3.37 or newer. Data unchanged.`]}
        />
      );
    case 'delete_unfinished': {
      const view = deleteUnfinishedView(outcome);
      return (
        <MessageScreen title={view.title} lines={view.lines}>
          {view.retry ? retry : null}
          {view.retry ? (
            <SecondaryButton
              label="Continue"
              onPress={() => {
                relaunchWith('leave');
              }}
            />
          ) : (
            <PrimaryButton
              label="Continue"
              onPress={() => {
                relaunchWith('finish');
              }}
            />
          )}
        </MessageScreen>
      );
    }
    case 'open_failed':
      return (
        <MessageScreen
          title="Couldn’t open your training data."
          lines={[outcome.message, 'Data unchanged · backups untouched']}
        >
          {retry}
        </MessageScreen>
      );
    case 'ready': {
      const { services, migration, sqliteVersion, setup, recovery, recoveryError, signOutNotConfirmed } = outcome;
      const relaunch = () => {
        void services
          .close()
          .catch(() => undefined)
          .finally(() => {
            relaunchWith('finish');
          });
      };
      return (
        <AppProvider services={services} launch={{ migration, sqliteVersion, recovery, recoveryError, restAlerts, restoreInterrupted: services.restore.interruptedRestore, signOutNotConfirmed }} relaunch={relaunch}>
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
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const holder = useMemo(() => createPrefsHolder(containerTextFile(DEVICE_PREFS_FILE), setPrefs), []);
  useEffect(() => {
    void holder.load();
  }, [holder]);
  const update = useCallback(
    (change: Partial<DevicePrefs>) => {
      void holder.update(change);
    },
    [holder],
  );
  const onChangeDirection = useCallback(
    (id: AvailableDirectionId) => {
      update({ themeDirection: id });
    },
    [update],
  );
  // Delete my data removed `device-prefs.json`: forget what is in memory without writing it (S2).
  const clear = useCallback(() => {
    holder.clear();
  }, [holder]);
  const prefsValue = useMemo(() => ({ prefs: prefs ?? DEFAULT_PREFS, update, clear }), [prefs, update, clear]);
  return (
    <SafeAreaProvider>
      <DevicePrefsProvider value={prefsValue}>
        <ThemeProvider savedDirection={prefs?.themeDirection ?? null} onChangeDirection={onChangeDirection}>
          <Themed />
        </ThemeProvider>
      </DevicePrefsProvider>
    </SafeAreaProvider>
  );
}
