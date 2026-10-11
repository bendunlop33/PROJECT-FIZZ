import type { PersonalFilesPort } from '../backup/data-domain-service';
import { GUIDE_OPEN_FILE, LAST_ERROR_FILE } from '../diagnostics/error-record';
import { PROBE_DB_NAME } from '../probe/model';

/**
 * Your-data files outside SQLite and the backup folder, removed by Delete my
 * data's `settings_files` step (data-import-export §4.5 step 3, check 30).
 * Pure: the file operations are injected, so the harness runs the same list
 * against an in-memory container.
 */

/** Coach connection settings (model choice, pauses). */
export const COACH_SETTINGS_FILE = 'coach-connection.json';
/** This phone's look and alert answers. */
export const DEVICE_PREFS_FILE = 'device-prefs.json';

/** Small files in Documents that hold Ben's settings or notes about his use. */
export const PERSONAL_DOCUMENTS: readonly string[] = [COACH_SETTINGS_FILE, DEVICE_PREFS_FILE, LAST_ERROR_FILE, GUIDE_OPEN_FILE];
/** Damaged copies kept aside (`*.damaged-<time>.json`). */
export const DAMAGED_COPY = /\.damaged-.*\.json$/;

export interface ContainerFileOps {
  /** Remove these Documents files (and `.tmp` twins) and any matching `matching`. Missing is fine; throws if one is left. */
  removeDocuments(names: readonly string[], matching: RegExp): Promise<void>;
  /** Remove a database's files (`-wal`, `-shm` too) without opening it. Throws if one is left. */
  removeDatabaseFiles(name: string): Promise<void>;
  /**
   * Empty `tmp` (where iOS puts the copy of a file picked for import, restore
   * or Check a backup) and Caches. Throws if anything that was there is left.
   */
  emptyTemporary(): Promise<void>;
}

export function createPersonalFiles(ops: ContainerFileOps): PersonalFilesPort {
  return {
    async remove() {
      await ops.removeDocuments(PERSONAL_DOCUMENTS, DAMAGED_COPY);
      // The capability probe's database.
      await ops.removeDatabaseFiles(PROBE_DB_NAME);
      // Picked CSV and backup copies (review r2 B1).
      await ops.emptyTemporary();
    },
  };
}
