import Constants from 'expo-constants';
import { Platform } from 'react-native';

import AudioCoach from '../../modules/audio-coach';
import { createGuardedLoader } from '../guide/guarded-load';
import type { TapQueuePort } from './taps';

/**
 * Phone binding for the Lock Screen rest buttons (Ben, 26 Oct 2026). The
 * buttons are shown only when every part can work, otherwise the activity
 * looks as before and the rest-done notification stays the alert:
 * - the build has the Live Activity extension (`FIZZ_LIVE_ACTIVITY`) and
 *   wasn't built with `FIZZ_LA_BUTTONS=0`;
 * - iOS 17 or later (interactive Live Activities);
 * - the native tap queue is in this build (`AudioCoach.liveActivityTaps`).
 * No entitlement, push or extra App Group is used (ADR 0004).
 */

function extraFlag(name: string): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  return typeof extra === 'object' && extra !== null && (extra as Record<string, unknown>)[name] === true;
}

function iosMajor(): number {
  const v: unknown = Platform.Version;
  return typeof v === 'string' ? Number.parseInt(v, 10) || 0 : typeof v === 'number' ? v : 0;
}

export function lockScreenButtonsAvailable(): boolean {
  return (
    Platform.OS === 'ios' &&
    extraFlag('includeLiveActivity') &&
    extraFlag('liveActivityButtons') &&
    iosMajor() >= 17 &&
    typeof AudioCoach?.liveActivityTaps === 'function' &&
    typeof AudioCoach.ackLiveActivityTaps === 'function'
  );
}

/**
 * (Ben, 27 Oct) `Log` on the Ready state: everything the rest buttons need
 * (it is the same tap queue), and not built with `FIZZ_LA_LOG=0`, the switch
 * to leave Log out on its own if it misbehaves on the phone.
 */
export function lockScreenLogAvailable(): boolean {
  return lockScreenButtonsAvailable() && extraFlag('liveActivityLog');
}

export const nativeTapQueue: TapQueuePort = {
  available: lockScreenButtonsAvailable,
  list: () => AudioCoach?.liveActivityTaps?.() ?? [],
  ack: (ids) => {
    AudioCoach?.ackLiveActivityTaps?.(ids);
  },
};

const loadListener = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load (as lazy-port.ts)
  const mod = require('./expo-port') as { onLiveActivityTap: (listener: () => void) => () => void };
  return mod.onLiveActivityTap;
});

/** Subscribe to tap events; a no-op when expo-widgets can't load. */
export function onLockScreenTap(listener: () => void): () => void {
  if (!lockScreenButtonsAvailable()) return () => undefined;
  const r = loadListener();
  if (!r.ok) return () => undefined;
  try {
    return r.value(listener);
  } catch {
    return () => undefined;
  }
}
