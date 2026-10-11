import { z } from 'zod';

import { localStamp } from '../format/dates';

/**
 * The on-phone backup record (data-import-export.md §3.1–§3.2, §4.1).
 *
 * Kept in Fizz's container next to the backup files, NOT in the training
 * database: these are facts about this phone (which files Fizz wrote, when
 * a copy last went to Files), so restoring an old backup must not rewind
 * them. Rotation deletes only files listed here whose name pattern AND
 * recorded SHA-256 still match (DX9); anything else is never deleted.
 */

export const MANIFEST_VERSION = 1;
export const DEFAULT_KEEP = 14;

const UtcSchema = z.iso.datetime({ offset: false });

export const BackupRecordSchema = z.object({
  fileName: z.string().min(1).max(200),
  kind: z.enum(['automatic', 'manual']),
  /**
   * `before_import` / `after_import`: around a FitNotes import commit (data-import-export §3.2, §3.4).
   * `before_delete` / `before_reset`: right before `Delete my data` / `Reset coaching knowledge`, so either can be undone with Restore.
   */
  reason: z.enum(['workout_finished', 'manual', 'catch_up', 'before_import', 'after_import', 'before_delete', 'before_reset']),
  createdAtUtc: UtcSchema,
  tz: z.string().min(1),
  /** SHA-256 of the whole file text, checked again before rotation deletes it. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  textLength: z.int().min(0),
  finishedWorkouts: z.int().min(0),
  loggedSets: z.int().min(0),
  exercises: z.int().min(0),
  /** False when the database had damaged records (ADR 0005 #3): the file can't be restored. */
  integrityOk: z.boolean(),
  integrityIssues: z.int().min(0),
});
export type BackupRecord = z.infer<typeof BackupRecordSchema>;

const AttemptSchema = z.object({ atUtc: UtcSchema, tz: z.string().min(1), ok: z.boolean(), error: z.string().max(500).nullable() });
export type BackupAttempt = z.infer<typeof AttemptSchema>;

export const OffPhoneCopySchema = z.object({
  atUtc: UtcSchema,
  tz: z.string().min(1),
  fileName: z.string().min(1).max(200),
  /** Where Ben put it, as the picker reported (e.g. `iCloud Drive › Fizz backups`). */
  destinationLabel: z.string().max(300),
});
export type OffPhoneCopy = z.infer<typeof OffPhoneCopySchema>;

export const BackupManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  keep: z.int().min(1).max(1000),
  onPhone: z.object({ files: z.array(BackupRecordSchema), lastAttempt: AttemptSchema.nullable() }),
  offPhone: z.object({
    lastCopy: OffPhoneCopySchema.nullable(),
    reminderEnabled: z.boolean(),
    reminderDismissedAtUtc: UtcSchema.nullable(),
  }),
  /** Ben tapped `Mark as done` on the SideStore trial-run line (§4.1). Fizz can't verify it. */
  trialRunDoneAtUtc: UtcSchema.nullable(),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export function emptyManifest(): BackupManifest {
  return {
    version: MANIFEST_VERSION,
    keep: DEFAULT_KEEP,
    onPhone: { files: [], lastAttempt: null },
    offPhone: { lastCopy: null, reminderEnabled: true, reminderDismissedAtUtc: null },
    trialRunDoneAtUtc: null,
  };
}

export type ManifestRead = { manifest: BackupManifest; problem: string | null };

/**
 * Parse the stored manifest. A missing file is a fresh install. A damaged
 * one is reported and replaced by an empty record, which is safe: rotation
 * only deletes files listed in the manifest, so nothing is ever deleted
 * on the strength of a record that couldn't be read.
 */
export function parseManifest(text: string | null): ManifestRead {
  if (text === null) return { manifest: emptyManifest(), problem: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { manifest: emptyManifest(), problem: 'The backup record on this phone is unreadable; it was started again. No backup files were deleted.' };
  }
  const parsed = BackupManifestSchema.safeParse(json);
  if (!parsed.success) {
    return { manifest: emptyManifest(), problem: 'The backup record on this phone is damaged; it was started again. No backup files were deleted.' };
  }
  return { manifest: parsed.data, problem: null };
}

export function serialiseManifest(m: BackupManifest): string {
  return JSON.stringify(m);
}

export const AUTOMATIC_NAME = /^fizz-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?-auto\.json$/;
export const MANUAL_NAME = /^fizz-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.json$/;

/**
 * File names from data-import-export §5: local time in the name, UTC + zone
 * inside the file. `fizz-backup-2026-10-08-1905-auto.json` (automatic) or
 * `fizz-backup-2026-10-08-1912.json` (manual). A clash in the same minute
 * gets `-2`, `-3`, ….
 */
export function backupFileName(ms: number, tz: string, kind: BackupRecord['kind'], taken: ReadonlySet<string>): string {
  const stem = `fizz-backup-${localStamp(ms, tz)}`;
  const suffix = kind === 'automatic' ? '-auto.json' : '.json';
  let name = `${stem}${suffix}`;
  for (let n = 2; taken.has(name); n += 1) name = `${stem}-${String(n)}${suffix}`;
  return name;
}

/**
 * Which automatic files to delete after a new one was written and checked:
 * the oldest beyond `keep`. Manual files, files not written by Fizz and the
 * file just written are never on the list, and neither is the newest backup
 * that passed its integrity check (PM decision SP2): if every newer backup is
 * damaged, the last restorable one stays.
 */
export function planRotation(files: readonly BackupRecord[], keep: number, justWritten: string): BackupRecord[] {
  const newestFirst = (a: BackupRecord, b: BackupRecord) => (a.createdAtUtc < b.createdAtUtc ? 1 : a.createdAtUtc > b.createdAtUtc ? -1 : 0);
  const newestGood = [...files].filter((f) => f.integrityOk).sort(newestFirst)[0]?.fileName ?? null;
  const automatic = files.filter((f) => f.kind === 'automatic' && AUTOMATIC_NAME.test(f.fileName)).sort(newestFirst);
  return automatic.slice(keep).filter((f) => f.fileName !== justWritten && f.fileName !== newestGood);
}
