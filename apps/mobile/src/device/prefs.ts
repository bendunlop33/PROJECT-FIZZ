import { DEFAULT_MORNING_REMINDER, parseMorningReminder, type MorningReminderSettings } from '@fizz/domain';

import type { TextFile } from '../backup/backup-service';
import { DEFAULT_VOICE_PREFS, parseVoicePrefs, type VoicePrefs } from '../voice/settings';

/**
 * Preferences that belong to this phone, not to Ben's training data, so they
 * are not in backups: the look (Developer → Look) and whether exercise guides
 * animate (Developer → Exercise guide animations), and display choices
 * such as Profile › `Targets hit`. Pure parse.
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
  /** The workout screen's view (active-workout §4.5): Table by default; Ben's choice sticks on this phone. */
  workoutView: 'table' | 'focus';
  /** The Library tab's last segment (exercise-library EL10): a UI preference, not Your data, not backed up. Plan until Ben picks another (Ben, 23 Oct). */
  librarySegment: 'plan' | 'workouts' | 'exercises';
  /** Settings › Voice: spoken cues, reading coach replies, the voice and its speed (this phone's voices). */
  voice: VoicePrefs;
  /** Profile › `Targets hit` (Ben, 20 Oct): `Targets hit 5 of last 6` on main lifts; off by default. */
  targetsHit: boolean;
  /** Profile › Morning reminder (Ben, 20 Oct): per phone, as notification permission is. Absent: never changed (`morningReminderOf`). */
  morningReminder?: MorningReminderSettings;
}

/** The morning reminder's settings, the defaults until Ben changes one. */
export function morningReminderOf(prefs: Pick<DevicePrefs, 'morningReminder'>): MorningReminderSettings {
  return prefs.morningReminder ?? DEFAULT_MORNING_REMINDER;
}

export type AlertsAsk = 'undetermined' | 'later' | 'answered';

export const DEFAULT_PREFS: DevicePrefs = { themeDirection: null, guideAnimations: true, alertsAsk: 'undetermined', workoutView: 'table', librarySegment: 'plan', voice: DEFAULT_VOICE_PREFS, targetsHit: false };

export function parsePrefs(text: string | null): DevicePrefs {
  if (text === null) return DEFAULT_PREFS;
  try {
    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) return DEFAULT_PREFS;
    const { themeDirection: dir, guideAnimations, alertsAsk, workoutView, librarySegment, voice, targetsHit } = json as { themeDirection?: unknown; guideAnimations?: unknown; alertsAsk?: unknown; workoutView?: unknown; librarySegment?: unknown; voice?: unknown; targetsHit?: unknown };
    const { morningReminder } = json as { morningReminder?: unknown };
    return {
      themeDirection: dir === 'A' || dir === 'D' ? dir : null,
      guideAnimations: guideAnimations !== false,
      alertsAsk: alertsAsk === 'later' || alertsAsk === 'answered' ? alertsAsk : 'undetermined',
      workoutView: workoutView === 'focus' ? 'focus' : 'table',
      librarySegment: librarySegment === 'workouts' || librarySegment === 'exercises' ? librarySegment : 'plan',
      voice: parseVoicePrefs(voice),
      targetsHit: targetsHit === true,
      ...(morningReminder === undefined ? {} : { morningReminder: parseMorningReminder(morningReminder) }),
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

/**
 * This phone's preferences for one app run, owned by `Root`. `onChange`
 * renders. Changes made before the file loads are shown at once, then kept
 * on top of the file and saved (review N1). `clear` (after Delete my data
 * removed the file) forgets what is in memory without writing it; a load
 * still in flight is ignored, so old values never come back (review S2).
 */
export function createPrefsHolder(file: TextFile, onChange: (prefs: DevicePrefs) => void) {
  let current: DevicePrefs | null = null;
  let early: Partial<DevicePrefs> | null = {};
  let cleared = false;
  return {
    async load(): Promise<void> {
      const loaded = await loadPrefs(file);
      if (cleared) return;
      const settled = settleLoadedPrefs(loaded, early ?? {});
      early = null;
      current = settled.prefs;
      onChange(current);
      if (settled.save) await savePrefs(file, current).catch(() => undefined);
    },
    async update(change: Partial<DevicePrefs>): Promise<void> {
      const next = updatePrefs(current, change);
      current = next;
      onChange(next);
      if (early !== null) {
        early = { ...early, ...change };
        return;
      }
      await savePrefs(file, next).catch(() => undefined);
    },
    clear(): void {
      early = null;
      cleared = true;
      current = DEFAULT_PREFS;
      onChange(DEFAULT_PREFS);
    },
  };
}
