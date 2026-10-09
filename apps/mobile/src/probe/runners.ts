import * as Notifications from 'expo-notifications';

import '../alerts/notifier';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as SQLite from 'expo-sqlite';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { widgetsDirectory } from 'expo-widgets';

import AudioCoach from '../../modules/audio-coach';
import { isoUtc, nowMs } from '../clock';
import { restCountdownActivity } from '../live-activity/RestCountdownActivity';
import { judgeAlarmKitStatus } from './alarmkit';
import { analyseAppGroup, parseNativeAppGroupInfo } from './app-group';
import { LOCKED_CUE_DELAY_S, judgeLockedCue } from './locked-cue';
import type { ResultUpdate } from './model';
import { PROBE_CONTEXTUAL_STRINGS, chooseRecognitionLocale, describeTranscript, type LocaleChoice } from './speech-probe';

/**
 * Native probe runners. Each returns what it actually observed. Anything that
 * needs Ben's eyes or ears comes back as "needs_check". These are spike code,
 * deliberately separate from the real persistence package.
 */

/** Not for security: probe-only IDs. RestTimer IDs must be UUIDs (schemas IdSchema). */
export function probeUuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)] ?? '8';
    else out += hex[Math.floor(Math.random() * 16)] ?? '0';
  }
  return out;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Rejects if `p` hasn't settled in `ms`; a backstop for native calls. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} did not respond within ${Math.round(ms / 1000)} s`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const NATIVE_CALL_TIMEOUT_MS = 30_000;

// ---------- SQLite ----------

const PROBE_DB_NAME = 'fizz-probe.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Separate probe database; never the workout database. */
export function probeDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(PROBE_DB_NAME);
    await db.execAsync(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS probe_kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at_utc TEXT NOT NULL);',
    );
    return db;
  })();
  return dbPromise;
}

// The exclusive-transaction `txn` is a SQLiteDatabase subclass, so helpers take either.
async function kvPut(db: SQLite.SQLiteDatabase, key: string, value: string, atUtc: string) {
  await db.runAsync(
    'INSERT INTO probe_kv (key, value, updated_at_utc) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc',
    [key, value, atUtc],
  );
}

async function kvGet(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM probe_kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function getProbeValue(key: string): Promise<string | null> {
  return kvGet(await probeDb(), key);
}

export async function putProbeValue(key: string, value: string, atUtc: string): Promise<void> {
  const db = await probeDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await kvPut(txn, key, value, atUtc);
  });
}

export async function runSqliteProbe(atUtc: string): Promise<ResultUpdate> {
  try {
    const db = await probeDb();
    const journal = await db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode');
    const token = probeUuid();
    // Holder object: TypeScript can't see assignments made inside the callback.
    const seen: { inside: string | null } = { inside: null };
    await db.withExclusiveTransactionAsync(async (txn) => {
      await kvPut(txn, 'sqlite_probe', token, atUtc);
      seen.inside = await kvGet(txn, 'sqlite_probe');
    });
    const readInside = seen.inside;
    const readAfter = await kvGet(db, 'sqlite_probe');

    // Rollback check: a failing exclusive transaction must leave the value unchanged.
    let rolledBack = false;
    try {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await kvPut(txn, 'sqlite_probe', 'must-not-persist', atUtc);
        throw new Error('deliberate rollback');
      });
    } catch {
      rolledBack = (await kvGet(db, 'sqlite_probe')) === token;
    }

    const details = [
      `Database: ${PROBE_DB_NAME}, journal_mode=${journal?.journal_mode ?? 'unknown'}`,
      `Read inside transaction: ${readInside === token ? 'match' : 'MISMATCH'}`,
      `Read after commit: ${readAfter === token ? 'match' : 'MISMATCH'}`,
      `Failed transaction rolled back: ${rolledBack ? 'yes' : 'NO'}`,
    ];
    const ok = readInside === token && readAfter === token && rolledBack;
    return { status: ok ? 'pass' : 'fail', summary: ok ? 'Write, read and rollback behaved' : 'Mismatch, see details', details };
  } catch (e) {
    return { status: 'fail', summary: `SQLite error: ${errorText(e)}`, details: [] };
  }
}

// ---------- Secure store ----------

export async function runSecureStoreProbe(): Promise<ResultUpdate> {
  const key = 'fizz.probe.secure';
  const value = probeUuid();
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { status: 'unavailable', summary: 'SecureStore reports it is not available', details: [] };
    }
    await SecureStore.setItemAsync(key, value, options);
    const read = await SecureStore.getItemAsync(key, options);
    await SecureStore.deleteItemAsync(key, options);
    const afterDelete = await SecureStore.getItemAsync(key, options);
    const ok = read === value && afterDelete === null;
    return {
      status: ok ? 'pass' : 'fail',
      summary: ok ? 'Keychain round-trip and delete worked' : 'Keychain value mismatch',
      details: [
        'Accessibility: WHEN_UNLOCKED_THIS_DEVICE_ONLY',
        `Read back: ${read === value ? 'match' : 'MISMATCH'}`,
        `Deleted: ${afterDelete === null ? 'yes' : 'NO'}`,
      ],
    };
  } catch (e) {
    return { status: 'fail', summary: `Keychain error: ${errorText(e)}`, details: [] };
  }
}

// ---------- Local notification ----------

export const NOTIFICATION_DELAY_S = 15;

// The app has one notification handler (alerts/notifier.ts); it shows every
// notification except a rest alert while the app is in the foreground.

/**
 * Called with an extra detail after the runner has returned (the notification
 * arrives up to NOTIFICATION_DELAY_S later).
 */
export type LateDetail = (line: string) => void;

export async function runNotificationProbe(now: number, onLateDetail: LateDetail): Promise<ResultUpdate> {
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== Notifications.PermissionStatus.GRANTED && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    if (perm.status !== Notifications.PermissionStatus.GRANTED) {
      return { status: 'fail', summary: 'Notification permission not granted', details: [`status=${perm.status}`] };
    }
    // iOS only hands the notification to the app when it's in the foreground,
    // so this fires only if Ben did NOT lock the phone in time.
    const sub = Notifications.addNotificationReceivedListener(() => {
      sub.remove();
      clearTimeout(stopListening);
      onLateDetail(
        `Delivered while the app was ${AppState.currentState === 'active' ? 'in the foreground (active)' : `in state "${AppState.currentState}"`}: a banner seen now does not prove delivery while locked`,
      );
    });
    const stopListening = setTimeout(() => {
      sub.remove();
    }, (NOTIFICATION_DELAY_S + 120) * 1000);
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: 'GymSmarter probe', body: `Rest over (scheduled ${NOTIFICATION_DELAY_S} s ahead)`, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: NOTIFICATION_DELAY_S, repeats: false },
    });
    const ios = perm.ios;
    return {
      status: 'needs_check',
      summary: `Scheduled for ${NOTIFICATION_DELAY_S} s. Lock the phone now`,
      details: [
        `Notification ID ${id}`,
        `Due at ${isoUtc(now + NOTIFICATION_DELAY_S * 1000)}`,
        `iOS settings: alert=${String(ios?.allowsAlert)}, sound=${String(ios?.allowsSound)}, lockScreen=${String(ios?.allowsDisplayOnLockScreen)}`,
        'Interruption level: active (time-sensitive needs the paid programme)',
        'Sound may be silent with the silent switch on or in a Focus',
        'If the app sees the notification arrive in the foreground, a note is added below',
      ],
    };
  } catch (e) {
    return { status: 'fail', summary: `Scheduling failed: ${errorText(e)}`, details: [] };
  }
}

// ---------- expo-speech ----------

const TTS_TIMEOUT_MS = 20_000;

export function runTtsProbe(): Promise<ResultUpdate> {
  return new Promise((resolve) => {
    const startedAt = nowMs();
    let settled = false;
    const finish = (update: ResultUpdate) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(update);
    };
    // Always reach a terminal state, even if expo-speech never calls back.
    const timer = setTimeout(() => {
      void Speech.stop();
      finish({ status: 'fail', summary: `expo-speech did not report done within ${TTS_TIMEOUT_MS / 1000} s`, details: [] });
    }, TTS_TIMEOUT_MS);
    try {
      Speech.speak('Rest over. Next set, bench press, one hundred kilos for eight.', {
        language: 'en-US',
        onDone: () => {
          finish({
            status: 'needs_check',
            summary: `expo-speech reported done after ${((nowMs() - startedAt) / 1000).toFixed(1)} s`,
            details: [
              '"Done" does not prove sound was heard: in silent mode iOS reports done with no sound (Expo docs)',
              'Note the silent-switch position for this run',
            ],
          });
        },
        // A call, Siri or another app's audio can stop the utterance; onDone never fires then.
        onStopped: () => {
          finish({ status: 'not_run', summary: 'The cue was stopped before it finished (interruption?). Run again', details: [] });
        },
        onError: (error: Error) => {
          finish({ status: 'fail', summary: `expo-speech error: ${error.message}`, details: [] });
        },
      });
    } catch (e) {
      finish({ status: 'fail', summary: `expo-speech threw: ${errorText(e)}`, details: [] });
    }
  });
}

// ---------- audio-coach (ducking) ----------

export async function runAudioCoachProbe(): Promise<ResultUpdate> {
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'audio-coach native module is not in this build', details: [] };
  }
  try {
    const before = AudioCoach.getSessionState();
    await withTimeout(
      AudioCoach.configureSession({ category: 'playback', duckOthers: true, interruptSpokenAudioAndMixWithOthers: true }),
      NATIVE_CALL_TIMEOUT_MS,
      'configureSession',
    );
    const result = await withTimeout(
      AudioCoach.speak('Rest over. Next set, bench press, one hundred kilos for eight.', { language: 'en-US', deactivateAfter: true }),
      NATIVE_CALL_TIMEOUT_MS,
      'speak',
    );
    const details = [
      `Other audio playing at start: ${result.otherAudioWasPlaying ? 'yes' : 'no'}`,
      `Category ${result.category}, options duckOthers + interruptSpokenAudioAndMixWithOthers`,
      `Output route: ${before.outputs.map((o) => `${o.portType} (${o.portName})`).join(', ') || 'none'}`,
      `Cue outcome: ${result.outcome}${result.queuedBehind > 0 ? ` (queued behind ${result.queuedBehind})` : ''}`,
      `Session deactivated with notifyOthersOnDeactivation: ${
        result.deactivated ? 'yes' : `no (${result.deactivationError ?? result.deactivationSkipped ?? 'unknown'})`
      }`,
      'playback category is expected to play with the silent switch on',
    ];
    if (!result.finished) {
      return {
        status: 'fail',
        summary: result.outcome === 'timedOut' ? 'Cue never reported finishing (timed out)' : 'Cue was cancelled before it finished',
        details,
      };
    }
    if (!result.otherAudioWasPlaying) {
      return {
        status: 'not_run',
        summary: 'Cue spoken, but no music was playing, so ducking was not tested. Start music and run again',
        details,
      };
    }
    return { status: 'needs_check', summary: 'Cue spoken over music', details };
  } catch (e) {
    return { status: 'fail', summary: `audio-coach error: ${errorText(e)}`, details: [] };
  }
}

// ---------- Locked cue (opt-in background-audio experiment) ----------

export function backgroundAudioInBuild(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  return (
    typeof extra === 'object' && extra !== null && (extra as { backgroundAudioExperiment?: unknown }).backgroundAudioExperiment === true
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `recentEvents` returns audio events seen since a given time (from the screen's subscription). */
export async function runLockedCueProbe(recentEvents: (sinceMs: number) => string[]): Promise<ResultUpdate> {
  if (!backgroundAudioInBuild()) {
    return {
      status: 'unavailable',
      summary: 'This build was made without the background-audio experiment (FIZZ_BACKGROUND_AUDIO=1)',
      details: ['Default off by design; see ADR 0007'],
    };
  }
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'audio-coach native module is not in this build', details: [] };
  }
  const coach = AudioCoach;
  const startedAt = nowMs();
  try {
    // duckOthers off: the keep-alive holds the session for the whole wait, and
    // audio-coach doesn't change the category while it runs, so the cue itself
    // isn't ducked either (review F4; a later version could duck around the cue).
    await withTimeout(
      coach.configureSession({ category: 'playback', duckOthers: false, interruptSpokenAudioAndMixWithOthers: true }),
      NATIVE_CALL_TIMEOUT_MS,
      'configureSession',
    );
    const keepAlive = await withTimeout(coach.startKeepAlive(), NATIVE_CALL_TIMEOUT_MS, 'startKeepAlive');
    if (!keepAlive.started) {
      return { status: 'fail', summary: `Keep-alive did not start: ${keepAlive.reason ?? 'unknown'}`, details: [] };
    }
    try {
      const dueAt = startedAt + LOCKED_CUE_DELAY_S * 1000;
      await sleep(LOCKED_CUE_DELAY_S * 1000);
      const firedAt = nowMs();
      const appStateAtCue = AppState.currentState;
      const result = await withTimeout(
        coach.speak('Rest over. Next set, bench press, one hundred kilos for eight.', { language: 'en-US', deactivateAfter: false }),
        NATIVE_CALL_TIMEOUT_MS,
        'speak',
      );
      return judgeLockedCue({
        appStateAtCue,
        latenessMs: Math.max(0, firedAt - dueAt),
        outcome: result.outcome,
        otherAudioWasPlaying: result.otherAudioWasPlaying,
        keepAliveCategory: keepAlive.category ?? null,
        events: recentEvents(startedAt),
      });
    } finally {
      await coach.stopKeepAlive().catch(() => undefined);
    }
  } catch (e) {
    // e.g. startKeepAlive hit the JS timeout but then succeeded natively: never
    // leave the silent loop running (it keeps the app awake and podcasts paused).
    // Native calls run in order on the main queue, so this runs after the start.
    await coach.stopKeepAlive().catch(() => undefined);
    return { status: 'fail', summary: `Locked-cue experiment error: ${errorText(e)}`, details: recentEvents(startedAt) };
  }
}

// ---------- AlarmKit (permission only; scheduling is a follow-up) ----------

export async function runAlarmKitProbe(): Promise<ResultUpdate> {
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'Cannot detect: audio-coach native module is not in this build', details: [] };
  }
  try {
    return judgeAlarmKitStatus(await AudioCoach.getAlarmKitStatus(), 'read');
  } catch (e) {
    return { status: 'fail', summary: `AlarmKit detection error: ${errorText(e)}`, details: [] };
  }
}

/** Shows the iOS AlarmKit permission prompt (Ben tapped Request permission). */
export async function requestAlarmKitPermission(): Promise<ResultUpdate> {
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'Cannot request: audio-coach native module is not in this build', details: [] };
  }
  try {
    // No timeout: the promise waits for Ben to answer the system prompt.
    return judgeAlarmKitStatus(await AudioCoach.requestAlarmKitAuthorization(), 'requested');
  } catch (e) {
    return { status: 'fail', summary: `AlarmKit permission request failed: ${errorText(e)}`, details: [] };
  }
}

// ---------- App Group ----------

function configuredAppGroup(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const group = typeof extra === 'object' && extra !== null ? (extra as { appGroupIdentifier?: unknown }).appGroupIdentifier : undefined;
  return typeof group === 'string' && group.length > 0 ? group : null;
}

export async function runAppGroupProbe(): Promise<ResultUpdate> {
  if (!liveActivityIncludedInBuild()) {
    return {
      status: 'unavailable',
      summary: 'This build was made without the Live Activity extension, so it has no App Group',
      details: [],
    };
  }
  const configuredGroup = configuredAppGroup();
  if (configuredGroup === null) {
    return { status: 'fail', summary: 'No App Group identifier in the embedded app config', details: [] };
  }
  try {
    let shared: Record<string, { uri: string }>;
    let sharedError: string | null = null;
    try {
      shared = Paths.appleSharedContainers;
    } catch (e) {
      shared = {};
      sharedError = errorText(e);
    }
    let jsWriteRead: { ok: boolean; error?: string } | null = null;
    const container = shared[configuredGroup];
    if (container !== undefined) {
      try {
        const file = new File(container.uri, 'fizz-probe-js.txt');
        const token = probeUuid();
        file.write(token);
        const back = await file.text();
        file.delete();
        jsWriteRead = { ok: back === token };
      } catch (e) {
        jsWriteRead = { ok: false, error: errorText(e) };
      }
    }
    // expo-widgets reads this native constant when it is imported (at app start),
    // which runs the patched runtime group resolution in the app and records it.
    const expoWidgetsDirectory: unknown = widgetsDirectory;
    const native =
      AudioCoach === null
        ? null
        : parseNativeAppGroupInfo(
            await withTimeout(AudioCoach.getAppGroupInfo([configuredGroup]), NATIVE_CALL_TIMEOUT_MS, 'getAppGroupInfo'),
          );
    const result = analyseAppGroup({
      configuredGroup,
      buildNumber: Application.nativeBuildVersion ?? 'unknown',
      expoSharedContainers: Object.keys(shared),
      jsWriteRead,
      expoWidgetsDirectory: typeof expoWidgetsDirectory === 'string' ? expoWidgetsDirectory : null,
      native,
    });
    return sharedError === null
      ? result
      : { ...result, details: [...(result.details ?? []), `Paths.appleSharedContainers error: ${sharedError}`] };
  } catch (e) {
    return { status: 'fail', summary: `App Group probe error: ${errorText(e)}`, details: [] };
  }
}

// ---------- Live Activity ----------

export const LIVE_ACTIVITY_DURATION_S = 120;

export function liveActivityIncludedInBuild(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  return typeof extra === 'object' && extra !== null && (extra as { includeLiveActivity?: unknown }).includeLiveActivity === true;
}

export async function runLiveActivityProbe(now: number): Promise<ResultUpdate> {
  if (!liveActivityIncludedInBuild()) {
    return { status: 'unavailable', summary: 'This build was made without the Live Activity extension', details: [] };
  }
  try {
    const factory = restCountdownActivity();
    for (const old of factory.getInstances()) await old.end('immediate');
    const endsAtMs = now + LIVE_ACTIVITY_DURATION_S * 1000;
    // staleDate: the system can de-emphasise it once the countdown is over, so a
    // 0:00 timer doesn't sit on the Lock Screen looking live. The next Run (or
    // the timer below, if the app is still running) ends it.
    const instance = factory.start(
      { startedAtMs: now, endsAtMs, nextLabel: 'Next: Bench press 100 kg × 8' },
      undefined,
      // eslint-disable-next-line no-restricted-globals -- converting an injected time, not reading the clock
      new Date(endsAtMs),
    );
    setTimeout(() => {
      void instance.end('default').catch(() => undefined);
    }, (LIVE_ACTIVITY_DURATION_S + 30) * 1000);
    return {
      status: 'needs_check',
      summary: `Started a ${LIVE_ACTIVITY_DURATION_S / 60}-minute countdown. Lock the phone to check`,
      details: [`Activity ID ${instance.getId()}`, 'Started locally with no push token (free Apple ID)'],
    };
  } catch (e) {
    return {
      status: 'fail',
      summary: `Live Activity did not start: ${errorText(e)}`,
      details: ['Check Settings > GymSmarter > Live Activities is on. Run App Group for the extension and App Group evidence'],
    };
  }
}

// ---------- Speech recognition ----------

const RECOGNITION_TIMEOUT_MS = 8000;
const RECOGNITION_END_GRACE_MS = 2000;

/** Device locales in preference order, e.g. ["en-GB"]. */
function deviceLocaleTags(): string[] {
  try {
    return getLocales()
      .map((l) => l.languageTag)
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

async function recognitionLocale(): Promise<{ choice: LocaleChoice; line: string }> {
  const deviceTags = deviceLocaleTags();
  let supported: string[] | null;
  try {
    const listed = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    supported = listed.locales.length > 0 ? listed.locales : null;
  } catch {
    supported = null;
  }
  const choice = chooseRecognitionLocale(deviceTags, supported);
  return {
    choice,
    line: `Locale ${choice.locale}: ${choice.reason}. Device locales: ${deviceTags.length > 0 ? deviceTags.join(', ') : 'unknown'}`,
  };
}

export async function runSpeechRecognitionProbe(onPartial: (text: string) => void): Promise<ResultUpdate> {
  let locale: { choice: LocaleChoice; line: string };
  try {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return { status: 'unavailable', summary: 'Speech recognition is not available on this device', details: [] };
    }
    locale = await recognitionLocale();
    // expo-speech-recognition checks this for the device's default locale, not the chosen one.
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      return {
        status: 'unavailable',
        summary: 'On-device recognition not supported; not falling back to Apple servers',
        details: [locale.line, 'Checked for the device default locale'],
      };
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      return { status: 'fail', summary: 'Microphone or speech permission not granted', details: [`status=${perm.status}`] };
    }
  } catch (e) {
    return { status: 'fail', summary: `Speech setup error: ${errorText(e)}`, details: [] };
  }

  return new Promise((resolve) => {
    let latest = '';
    let settled = false;
    const subs: { remove: () => void }[] = [];
    const cleanup: (() => void)[] = [];
    const finish = (update: ResultUpdate) => {
      if (settled) return;
      settled = true;
      cleanup.forEach((c) => {
        c();
      });
      subs.forEach((s) => {
        s.remove();
      });
      resolve(update);
    };
    const fromTranscript = (): ResultUpdate =>
      latest.trim().length === 0
        ? { status: 'fail', summary: 'Nothing was transcribed', details: [locale.line] }
        : { status: 'needs_check', summary: 'Transcript captured', details: [...describeTranscript(latest), locale.line] };

    subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (ev) => {
        latest = ev.results[0]?.transcript ?? latest;
        onPartial(latest);
        if (ev.isFinal) finish(fromTranscript());
      }),
      ExpoSpeechRecognitionModule.addListener('error', (ev) => {
        finish({ status: 'fail', summary: `Recognition error: ${ev.error}`, details: [ev.message] });
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        finish(fromTranscript());
      }),
    );
    // After stop(), wait briefly for "end"; settle anyway if it never comes.
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // Settled by the fallback below.
      }
      fallback = setTimeout(() => {
        finish(fromTranscript());
      }, RECOGNITION_END_GRACE_MS);
    }, RECOGNITION_TIMEOUT_MS);
    cleanup.push(() => {
      clearTimeout(timer);
      clearTimeout(fallback);
    });

    try {
      ExpoSpeechRecognitionModule.start({
        lang: locale.choice.locale,
        interimResults: true,
        requiresOnDeviceRecognition: true,
        contextualStrings: [...PROBE_CONTEXTUAL_STRINGS],
        addsPunctuation: false,
      });
    } catch (e) {
      finish({ status: 'fail', summary: `Recognition did not start: ${errorText(e)}`, details: [] });
    }
  });
}
