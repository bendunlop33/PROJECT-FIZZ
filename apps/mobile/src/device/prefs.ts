import type { TextFile } from '../backup/backup-service';

/**
 * Preferences that belong to this phone, not to Ben's training data, so they
 * are not in backups: currently only the look (Developer → Look). Pure parse.
 */
export interface DevicePrefs {
  themeDirection: 'A' | 'D' | null;
}

export const DEFAULT_PREFS: DevicePrefs = { themeDirection: null };

export function parsePrefs(text: string | null): DevicePrefs {
  if (text === null) return DEFAULT_PREFS;
  try {
    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) return DEFAULT_PREFS;
    const dir = (json as { themeDirection?: unknown }).themeDirection;
    return { themeDirection: dir === 'A' || dir === 'D' ? dir : null };
  } catch {
    return DEFAULT_PREFS;
  }
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
