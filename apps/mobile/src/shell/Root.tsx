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
import { createLastTimeCache } from '../live-activity/last-time-cache';
import { lockScreenButtonsAvailable, lockScreenLogAvailable, nativeTapQueue, onLockScreenTap } from '../live-activity/tap-bridge';
import { createLockScreenTapHandler } from '../live-activity/taps';
import { activePainFlagged } from '../workout/pain-flagged';
import { lazyLiveActivityPort } from '../live-activity/lazy-port';
import type { LiveActivityPort } from '../live-activity/controller';
import { guardNativeCall, guardNativeCallAsync, launchSafeMode, nativeFeatureOn, nativeFeaturePause, setLaunchGuardBackground } from '../diagnostics/crash-capture';
import type { HealthPort } from '@fizz/providers';
import { launchSettler } from '../diagnostics/launch-settle';
import { AppBoundary, AppErrorScreen, SafeStartScreen } from './SafeStart';
import { containerBackupFiles, containerTextFile, emptyTemporaryFiles, removeContainerFiles } from '../device/files';
import { createPersonalFiles, DEVICE_PREFS_FILE } from '../device/personal-files';
import { expoDatabaseHost, removeDatabaseFiles } from '../data/expo-sqlite-host';
import { deleteUnfinishedView } from '../backup/data-domain-view';
import { DevicePrefsProvider, useDevicePrefs } from '../device/DevicePrefsContext';
import { createPrefsHolder, DEFAULT_PREFS, type DevicePrefs } from '../device/prefs';
import { afterLaunch, appInfo, deviceTimeZone, newUuid, nowZoned, whenIdle } from '../device/runtime';
import { AppNavigator } from '../navigation/AppNavigator';
import { MorningReminderHost } from '../reminders/MorningReminderHost';
import { HealthHost } from '../health/HealthHost';
import { healthInBuild, nativeHealthPort } from '../health/native-port';
import type { AppServices } from '../services/app-services';
import { startApp, type StartupOutcome } from '../services/startup';
import { ThemeProvider, TIMING, useTheme, type AvailableDirectionId } from '../theme';
import { MessageScreen, PrimaryButton, SecondaryButton } from '../ui';
import { createSpokenCueController } from '../voice/cue-controller';
import { appleSpeaker, setVoicePrefs, voicePrefs } from '../voice/speaker';
import { AppProvider, useDataChanged } from './context';

const BACKUP_MANIFEST = 'backup-state.json';
/** Delete my data's marker and done op IDs (data-import-export §3.6 Interrupted). */
const DATA_LEDGER = 'data-ops.json';

/** Last time for the next set (Ben, 26 Oct): read ahead per workout row, shared by the Live Activity and the rest-done notification. */
const lastTime = createLastTimeCache(nowMs);

/**
 * The workout's Lock Screen Live Activity (lock-screen-and-alerts §2.1): one
 * per workout, driven by the same reconciles as the rest alert. `Until hh:mm`
 * is in the phone's zone now, so it matches the Lock Screen clock.
 */
/**
 * (Launch-crash guard, 27 Oct) On a safe start, or on a build the app has already closed inside ActivityKit, the Live
 * Activity is off for the run: nothing is started, adopted or ended. Otherwise every ActivityKit call is breadcrumbed
 * while it runs, so a native crash inside one is named at the next launch and turns the Live Activity off on this
 * build (the rest notification stays the alert).
 */
const guardedLiveActivityPort: LiveActivityPort = {
  available: () => nativeFeatureOn('live_activity') && lazyLiveActivityPort.available(),
  // (Ben, 28 Oct) Off by the guard on a build that has it: `paused`, not `not_in_build`.
  paused: () => (lazyLiveActivityPort.available() ? nativeFeaturePause('live_activity') : null),
  listIds: () => guardNativeCall('live_activity', () => lazyLiveActivityPort.listIds()),
  start: (props, staleAtMs) => guardNativeCall('live_activity', () => lazyLiveActivityPort.start(props, staleAtMs)),
  update: (id, props, staleAtMs) => guardNativeCallAsync('live_activity', () => lazyLiveActivityPort.update(id, props, staleAtMs)),
  end: (id) => guardNativeCallAsync('live_activity', () => lazyLiveActivityPort.end(id)),
};

/** (Launch-crash guard) Apple Health's HealthKit calls, breadcrumbed the same way; off on a safe start or after a crash in one on this build. */
function guardedHealthPort(): HealthPort | null {
  if (!nativeFeatureOn('health')) return null;
  const p = nativeHealthPort();
  if (p === null) return null;
  const g = <T,>(fn: () => Promise<T>) => guardNativeCallAsync('health', fn);
  return {
    bundleId: p.bundleId,
    capability: () => g(() => p.capability()),
    requestAuthorization: (share, read) => g(() => p.requestAuthorization(share, read)),
    workoutShareStatus: () => g(() => p.workoutShareStatus()),
    saveWorkout: (input) => g(() => p.saveWorkout(input)),
    deleteWorkout: (uuid) => g(() => p.deleteWorkout(uuid)),
    deleteAllOwnWorkouts: () => g(() => p.deleteAllOwnWorkouts()),
    readWorkouts: (since, until, hr) => g(() => p.readWorkouts(since, until, hr)),
    readBodyMass: (since) => g(() => p.readBodyMass(since)),
    readRestingHeartRate: (since) => g(() => p.readRestingHeartRate(since)),
    readSleep: (since) => g(() => p.readSleep(since)),
  };
}

const liveActivity = createLiveActivityController(guardedLiveActivityPort, {
  tz: () => deviceTimeZone(),
  painFlagged: activePainFlagged,
  lastComparable: (state) => lastTime.lookup(state),
  buttons: lockScreenButtonsAvailable,
  log: lockScreenLogAvailable,
  clock: { now: nowMs, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>); } },
});

/**
 * Spoken cues while the app is open (Ben, 19 Oct 2026): driven by the same
 * committed states as the rest alert; in the background the notification
 * stays the alert.
 */
const spokenCues = createSpokenCueController({
  speaker: appleSpeaker,
  clock: { now: nowMs, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>); } },
  appActive: () => AppState.currentState === 'active',
  settings: () => voicePrefs(),
  painFlagged: activePainFlagged,
});

/** One rest-alert controller for the app run (it remembers what is scheduled); the Live Activity and spoken cues follow it. */
const restAlerts = createRestAlertController(expoNotifier, { liveActivity, spokenCues, lastTime });

/**
 * On return to the foreground: delivered workout alerts are stale (the screen
 * shows the truth), and the pending one is reconciled with the workout
 * (lock-screen-and-alerts §4.3). Never blocks anything.
 */
function useForegroundAlerts(services: AppServices) {
  useEffect(() => {
    // Launch: reconcile once, so a Live Activity left by a force-close is adopted or ended (§4.2).
    // The read runs outside the write chain; a commit issued meanwhile wins (review ben-bugs r2 N1).
    const readActive = () => services.sessions.active();
    const now = () => toMs(services.now().utc);
    // "Rest done. Set 2 …" reads the card's values, history included (voice review B1).
    spokenCues.setHistoryReader((state, exId) => services.workout.lastComparableSets(state, exId));
    lastTime.setReader((state, exId) => services.workout.lastComparableSets(state, exId));
    void restAlerts.reconcileFromRead(readActive, now);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void clearDeliveredWorkoutAlerts().catch(() => undefined);
      void restAlerts.reconcileFromRead(readActive, now);
      // (§6.1) Back in the app is an open too: the weekly review runs (cached unless its inputs changed), never during a workout.
      void readActive()
        .then((a) => (a === null ? services.reviews.runOnOpen() : null))
        .catch(() => null);
    });
    return () => {
      sub.remove();
      spokenCues.setHistoryReader(null);
      lastTime.setReader(null);
    };
  }, [services]);
}

/**
 * Lock Screen −15 s / +15 s / Skip (Ben, 26 Oct; lock-screen-and-alerts §4.2):
 * taps queued by the Live Activity are drained on the tap event, at launch
 * and on return to the foreground, through the same write path as the
 * in-app buttons. Nothing happens in builds or iOS versions without them.
 */
function useLockScreenTaps(services: AppServices) {
  const changed = useDataChanged();
  useEffect(() => {
    const taps = createLockScreenTapHandler({
      queue: nativeTapQueue,
      readActive: () => services.sessions.active(),
      dispatch: (sessionId, command) => services.sessions.dispatch(sessionId, command),
      settle: (state) => restAlerts.reconcile(state, toMs(services.now().utc)),
      now: () => services.now(),
      onChanged: changed,
    });
    void taps.drain();
    const off = onLockScreenTap(() => {
      void taps.drain();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void taps.drain();
    });
    return () => {
      off();
      sub.remove();
    };
  }, [services, changed]);
}

function ForegroundAlerts({ services }: { services: AppServices }) {
  useForegroundAlerts(services);
  useLockScreenTaps(services);
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
  // (Launch-crash guard) A safe start: Ben's choice on the safe screen (null: not made yet), and the navigator's
  // remount count after a render error (it then opens at Today).
  const safe = useMemo(() => launchSafeMode(), []);
  const [safeChoice, setSafeChoice] = useState<'resume' | 'today' | null>(null);
  const [navKey, setNavKey] = useState(0);

  // The run settles once a screen has stayed up `LAUNCH_STABLE_MS`, or at once when the app goes to the background.
  const ready = outcome?.kind === 'ready';
  useEffect(() => {
    if (!ready) return;
    // A launch in the background (a Lock Screen button's intent) is no launch Ben sees: settle it at once.
    if (AppState.currentState === 'background') {
      setLaunchGuardBackground(true);
      launchSettler.settleNow();
    } else launchSettler.arm();
    const sub = AppState.addEventListener('change', (s) => {
      setLaunchGuardBackground(s === 'background');
      if (s === 'background') launchSettler.background();
    });
    return () => {
      sub.remove();
    };
  }, [ready]);

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
      // A safe start reconciles no alert or Live Activity at launch (the workout's own commits still do), and
      // doesn't recover the unfinished workout until Ben taps Resume (hang fix, 27 Oct).
      ...(launchSafeMode().safe ? { safe: true } : { restAlerts }),
      idle: () => whenIdle(),
      // (ADR 0032) Launch background work waits a moment, so Today's first read never queues behind it.
      backgroundGate: () => afterLaunch(),
      // The coach over the ChatGPT-plan route (ADR 0020 C5); the same Keychain items and fetch as the connection screen.
      coach: {
        model: () => {
          const { ports } = coachConnectionPorts();
          return createPlanModelPort({ fetch: ports.fetch, vault: ports.vault, settings: ports.settings, nowMs: ports.nowMs });
        },
        connection: () => readTextCoachState(coachConnectionPorts().ports),
      },
      // (ADR 0035) Apple Health: the HealthKit module if this build has it; usable only if the install's signing kept the entitlement.
      // A safe start (or a crash in HealthKit on this build) leaves Health off for the run: `Paused for this launch` /
      // `Paused on this build` (Ben, 28 Oct), never `Not available on this install` (that is a build without Health).
      health: { port: guardedHealthPort(), buildIncludesHealth: healthInBuild(), paused: () => (healthInBuild() ? nativeFeaturePause('health') : null) },
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
    // (Hang fix, 27 Oct) A safe start shows at once, before the data is opened: nothing at boot can leave it blank.
    if (safe.safe) return <SafeStartScreen decision={safe} workout={null} ready={false} onResume={() => undefined} onToday={() => undefined} />;
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
      // A safe start read the unfinished workout without recovering it (`activeWorkout`); a normal one recovered it.
      const inProgress = safe.safe ? outcome.activeWorkout : recovery?.state.session.status === 'active' ? { name: recovery.state.session.routineName ?? null } : null;
      const choosing = safe.safe && safeChoice === null;
      // A safe start opens the workout only when Ben taps Resume; after a render error the navigator opens at Today.
      const openWorkout = navKey === 0 && (safe.safe ? safeChoice === 'resume' && inProgress !== null : recovery?.openInto === 'active_workout');
      return (
        <AppProvider services={services} launch={{ migration, sqliteVersion, recovery, recoveryError, restAlerts, restoreInterrupted: services.restore.interruptedRestore, signOutNotConfirmed }} relaunch={relaunch}>
          {safe.safe ? null : <ForegroundAlerts services={services} />}
          {safe.safe ? null : <MorningReminderHost services={services} />}
          {safe.safe ? null : <HealthHost services={services} />}
          {choosing ? (
            <SafeStartScreen
              decision={safe}
              workout={inProgress}
              ready
              onResume={() => {
                // Resume recovers it now (timers caught up from their stored deadlines), then opens it.
                void services.sessions
                  .recover()
                  .catch(() => null)
                  .finally(() => {
                    setSafeChoice('resume');
                  });
              }}
              onToday={() => {
                setSafeChoice('today');
              }}
            />
          ) : (
            <AppBoundary
              onReset={() => {
                setNavKey((k) => k + 1);
              }}
              fallback={(error, reset) => <AppErrorScreen error={error} onToday={reset} />}
            >
              <AppNavigator key={navKey} setupStep={setup.step} setupUnit={setup.profile?.preferredUnit ?? null} openWorkout={openWorkout} />
            </AppBoundary>
          )}
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
  const holder = useMemo(
    () =>
      createPrefsHolder(containerTextFile(DEVICE_PREFS_FILE), (p) => {
        // The cue controller and speaker read Settings › Voice outside React.
        setVoicePrefs(p.voice);
        setPrefs(p);
      }),
    [],
  );
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
