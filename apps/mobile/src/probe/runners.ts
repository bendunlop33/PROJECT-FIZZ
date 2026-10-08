import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as SQLite from 'expo-sqlite';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';

import AudioCoach from '../../modules/audio-coach';
import { isoUtc, nowMs } from '../clock';
import { restCountdownActivity } from '../live-activity/RestCountdownActivity';
import { analyseAppGroup, parseNativeAppGroupInfo } from './app-group';
import type { ResultUpdate } from './model';
import { PROBE_CONTEXTUAL_STRINGS, describeTranscript } from './speech-probe';

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

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function runNotificationProbe(now: number): Promise<ResultUpdate> {
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== Notifications.PermissionStatus.GRANTED && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    if (perm.status !== Notifications.PermissionStatus.GRANTED) {
      return { status: 'fail', summary: 'Notification permission not granted', details: [`status=${perm.status}`] };
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: 'Fizz probe', body: `Rest over (scheduled ${NOTIFICATION_DELAY_S} s ahead)`, sound: true },
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
      ],
    };
  } catch (e) {
    return { status: 'fail', summary: `Scheduling failed: ${errorText(e)}`, details: [] };
  }
}

// ---------- expo-speech ----------

export function runTtsProbe(): Promise<ResultUpdate> {
  return new Promise((resolve) => {
    const startedAt = nowMs();
    Speech.speak('Rest over. Next set, bench press, one hundred kilos for eight.', {
      language: 'en-US',
      onDone: () => {
        resolve({
          status: 'needs_check',
          summary: `expo-speech reported done after ${((nowMs() - startedAt) / 1000).toFixed(1)} s`,
          details: [
            '"Done" does not prove sound was heard: in silent mode iOS reports done with no sound (Expo docs)',
            'Note the silent-switch position for this run',
          ],
        });
      },
      onError: (error: Error) => {
        resolve({ status: 'fail', summary: `expo-speech error: ${error.message}`, details: [] });
      },
    });
  });
}

// ---------- audio-coach (ducking) ----------

export async function runAudioCoachProbe(): Promise<ResultUpdate> {
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'audio-coach native module is not in this build', details: [] };
  }
  try {
    const before = AudioCoach.getSessionState();
    await AudioCoach.configureSession({ category: 'playback', duckOthers: true, interruptSpokenAudioAndMixWithOthers: true });
    const result = await AudioCoach.speak('Rest over. Next set, bench press, one hundred kilos for eight.', {
      language: 'en-US',
      deactivateAfter: true,
    });
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

// ---------- AlarmKit (detect only) ----------

export async function runAlarmKitProbe(): Promise<ResultUpdate> {
  if (AudioCoach === null) {
    return { status: 'unavailable', summary: 'Cannot detect: audio-coach native module is not in this build', details: [] };
  }
  try {
    const status = await AudioCoach.getAlarmKitStatus();
    if (status === 'unsupportedOS') return { status: 'unavailable', summary: 'AlarmKit needs iOS 26 or later', details: [] };
    if (status === 'notInSDK') return { status: 'unavailable', summary: 'Built with an SDK that has no AlarmKit', details: [] };
    return {
      status: 'pass',
      summary: `AlarmKit framework present; authorization: ${status}`,
      details: [
        'Detection only. Scheduling an alarm needs a native module and NSAlarmKitUsageDescription (follow-up)',
        'Whether a SideStore-signed app may schedule alarms is still unproven',
      ],
    };
  } catch (e) {
    return { status: 'fail', summary: `AlarmKit detection error: ${errorText(e)}`, details: [] };
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
    const native =
      AudioCoach === null ? null : parseNativeAppGroupInfo(await AudioCoach.getAppGroupInfo([configuredGroup]));
    const result = analyseAppGroup({ configuredGroup, expoSharedContainers: Object.keys(shared), jsWriteRead, native });
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
    const instance = factory.start({
      startedAtMs: now,
      endsAtMs: now + LIVE_ACTIVITY_DURATION_S * 1000,
      nextLabel: 'Next: Bench press 100 kg × 8',
    });
    return {
      status: 'needs_check',
      summary: `Started a ${LIVE_ACTIVITY_DURATION_S / 60}-minute countdown. Lock the phone to check`,
      details: [`Activity ID ${instance.getId()}`, 'Started locally with no push token (free Apple ID)'],
    };
  } catch (e) {
    return {
      status: 'fail',
      summary: `Live Activity did not start: ${errorText(e)}`,
      details: ['Check Settings > Fizz > Live Activities is on. Under SideStore the App Group may not be registered'],
    };
  }
}

// ---------- Speech recognition ----------

export const RECOGNITION_LOCALE = 'en-US';
const RECOGNITION_TIMEOUT_MS = 8000;

export async function runSpeechRecognitionProbe(onPartial: (text: string) => void): Promise<ResultUpdate> {
  try {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return { status: 'unavailable', summary: 'Speech recognition is not available on this device', details: [] };
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      return {
        status: 'unavailable',
        summary: 'On-device recognition not supported; not falling back to Apple servers',
        details: [`Locale ${RECOGNITION_LOCALE}`],
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
    const finish = (update: ResultUpdate) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subs.forEach((s) => {
        s.remove();
      });
      resolve(update);
    };
    const fromTranscript = (): ResultUpdate =>
      latest.trim().length === 0
        ? { status: 'fail', summary: 'Nothing was transcribed', details: [`Locale ${RECOGNITION_LOCALE}`] }
        : { status: 'needs_check', summary: 'Transcript captured', details: [...describeTranscript(latest), `Locale ${RECOGNITION_LOCALE}`] };

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
    const timer = setTimeout(() => {
      ExpoSpeechRecognitionModule.stop();
    }, RECOGNITION_TIMEOUT_MS);

    ExpoSpeechRecognitionModule.start({
      lang: RECOGNITION_LOCALE,
      interimResults: true,
      requiresOnDeviceRecognition: true,
      contextualStrings: [...PROBE_CONTEXTUAL_STRINGS],
      addsPunctuation: false,
    });
  });
}
