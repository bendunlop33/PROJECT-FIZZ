import type { TextFile } from '../backup/backup-service';

/**
 * Preferences that belong to this phone, not to Ben's training data, so they
 * are not in backups: the look (Developer → Look) and whether exercise guides
 * animate (Developer → Exercise guide animations). Pure parse.
 */
export interface DevicePrefs {
  themeDirection: 'A' | 'D' | null;
  /** False: How to shows the guide's still key positions only, no frame loop (a safe mode). */
  guideAnimations: boolean;
  /**
   * The in-app Rest alerts question (premium-feel §3.5), asked once on the
   * first Start: not yet, `Not now`, or answered (Allow → the iOS prompt).
   * Per phone, since notification permission is per phone.
   */
  alertsAsk: AlertsAsk;
}

export type AlertsAsk = 'undetermined' | 'later' | 'answered';

export const DEFAULT_PREFS: DevicePrefs = { themeDirection: null, guideAnimations: true, alertsAsk: 'undetermined' };

export function parsePrefs(text: string | null): DevicePrefs {
  if (text === null) return DEFAULT_PREFS;
  try {
    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) return DEFAULT_PREFS;
    const { themeDirection: dir, guideAnimations, alertsAsk } = json as { themeDirection?: unknown; guideAnimations?: unknown; alertsAsk?: unknown };
    return {
      themeDirection: dir === 'A' || dir === 'D' ? dir : null,
      guideAnimations: guideAnimations !== false,
      alertsAsk: alertsAsk === 'later' || alertsAsk === 'answered' ? alertsAsk : 'undetermined',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** One change on top of the current preferences (before they load, on top of the defaults). */
export function updatePrefs(current: DevicePrefs | null, change: Partial<DevicePrefs>): DevicePrefs {
  return { ...(current ?? DEFAULT_PREFS), ...change };
}

/**
 * The file has loaded: changes Ben made before it did are kept on top of it
 * (review N1), and `save` says whether the merged result must be written.
 */
export function settleLoadedPrefs(loaded: DevicePrefs, early: Partial<DevicePrefs>): { prefs: DevicePrefs; save: boolean } {
  return Object.keys(early).length === 0 ? { prefs: loaded, save: false } : { prefs: updatePrefs(loaded, early), save: true };
}

export async function loadPrefs(file: TextFile): Promise<DevicePrefs> {
  try {
    return parsePrefs(await file.read());
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(file: TextFile, prefs: DevicePrefs): Promise<void> {
  await file.write(JSON.stringify(prefs));
}
