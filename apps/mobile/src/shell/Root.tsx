import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { containerBackupFiles, containerTextFile } from '../device/files';
import { expoDatabaseHost } from '../data/expo-sqlite-host';
import { loadPrefs, savePrefs, type DevicePrefs } from '../device/prefs';
import { appInfo, newUuid, nowZoned } from '../device/runtime';
import { AppNavigator } from '../navigation/AppNavigator';
import { startApp, type StartupOutcome } from '../services/startup';
import { ThemeProvider, TIMING, useTheme, type AvailableDirectionId } from '../theme';
import { MessageScreen, PrimaryButton } from '../ui';
import { AppProvider } from './context';

const BACKUP_MANIFEST = 'backup-state.json';
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
      <MessageScreen title="Opening your training data" lines={['Keep Fizz open. If it closes, this carries on next time.']} />
    ) : (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />
    );
  }
  switch (outcome.kind) {
    case 'schema_too_new':
      return (
        <MessageScreen
          title="Your data was saved by a newer Fizz"
          lines={['This build can’t open it. Install the newer build in SideStore. Nothing has been changed.', outcome.message]}
        />
      );
    case 'sqlite_too_old':
      return (
        <MessageScreen
          title="Fizz can’t open its database on this iPhone"
          lines={[`The database engine is SQLite ${outcome.version}; Fizz needs 3.37 or newer. Nothing has been changed.`]}
        />
      );
    case 'open_failed':
      return (
        <MessageScreen title="Couldn’t open your training data." lines={[outcome.message, 'Restore from a backup isn’t in this build yet.']}>
          {retry}
        </MessageScreen>
      );
    case 'ready': {
      const { services, migration, sqliteVersion, setup, recovery } = outcome;
      return (
        <AppProvider services={services} launch={{ migration, sqliteVersion }}>
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
