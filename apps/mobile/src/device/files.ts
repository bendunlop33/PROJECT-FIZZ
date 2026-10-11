import { Directory, File, Paths } from 'expo-file-system';

import type { BackupFileStore, CopyDestination, TextFile } from '../backup/backup-service';

/**
 * Phone bindings for files in Fizz's own container (expo-file-system 57).
 * Everything here is "on this phone": lost if the app is deleted or
 * re-signed with another Apple ID (data-import-export.md §2.1).
 */

const BACKUP_DIR_NAME = 'backups';

function backupDir(): Directory {
  const dir = new Directory(Paths.document, BACKUP_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function containerBackupFiles(): BackupFileStore {
  return {
    write(name, text) {
      const file = new File(backupDir(), name);
      file.write(text);
      return Promise.resolve();
    },
    async read(name) {
      const file = new File(backupDir(), name);
      return file.exists ? file.text() : null;
    },
    remove(name) {
      const file = new File(backupDir(), name);
      if (file.exists) file.delete();
      return Promise.resolve();
    },
    list() {
      return Promise.resolve(
        backupDir()
          .list()
          .filter((e) => e instanceof File)
          .map((f) => f.name),
      );
    },
  };
}

/**
 * A small JSON file in Documents, replaced by writing a temporary file and
 * moving it over the old one. If Fizz is killed between the two steps, the
 * temporary file is read instead.
 */
export function containerTextFile(name: string): TextFile {
  const main = () => new File(Paths.document, name);
  const temp = () => new File(Paths.document, `${name}.tmp`);
  return {
    async read() {
      const m = main();
      if (m.exists) return m.text();
      const t = temp();
      return t.exists ? t.text() : null;
    },
    async write(text) {
      const t = temp();
      t.write(text);
      await t.move(main(), { overwrite: true });
    },
    async keepDamagedCopy(suffix) {
      const m = main();
      const copyName = `${name.replace(/\.json$/, '')}.damaged-${suffix}.json`;
      if (m.exists) new File(Paths.document, copyName).write(await m.text());
      return copyName;
    },
  };
}

/**
 * Remove small files from Documents: each name and its `.tmp` twin, and any
 * file whose name matches `matching` (e.g. damaged copies kept aside). Used
 * by Delete my data for Your-data files outside SQLite. Missing files are
 * fine; a file still there afterwards throws.
 */
export function removeContainerFiles(names: readonly string[], matching?: RegExp): Promise<void> {
  const doomed = names.flatMap((n) => [n, `${n}.tmp`]);
  if (matching) {
    for (const e of new Directory(Paths.document).list()) {
      if (e instanceof File && matching.test(e.name)) doomed.push(e.name);
    }
  }
  for (const n of doomed) {
    const f = new File(Paths.document, n);
    if (f.exists) f.delete();
  }
  const left = doomed.filter((n) => new File(Paths.document, n).exists);
  if (left.length > 0) return Promise.reject(new Error(`Couldn’t delete ${left.join(', ')}`));
  return Promise.resolve();
}

/** The app's `tmp` directory (no `Paths` entry in expo-file-system 57; it sits beside Documents). */
function tmpDirectory(): Directory {
  return new Directory(`${containerRoot()}tmp/`);
}

/**
 * Delete my data: empty `tmp` (the document picker's copies of imported CSVs
 * and picked backups, review r2 B1) and Caches. Both are GymSmarter's own;
 * a missing directory is fine. Throws if anything that was there is left.
 * Needs a device test: iOS may keep files of its own in either.
 */
export function emptyTemporaryFiles(): Promise<void> {
  const left: string[] = [];
  for (const dir of [tmpDirectory(), Paths.cache]) {
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {
        // Counted below.
      }
      if (entry.exists) left.push(entry.name);
    }
  }
  if (left.length > 0) return Promise.reject(new Error(`Couldn’t delete ${left.join(', ')}`));
  return Promise.resolve();
}

/** `Documents/` as a file URI with a trailing slash, for "is this inside Fizz?" checks. */
function containerRoot(): string {
  const doc = Paths.document.uri;
  // …/Data/Application/<UUID>/Documents/ → …/Data/Application/<UUID>/
  return doc.replace(/Documents\/?$/, '');
}

/** Human label for a picked folder, e.g. `iCloud Drive › Fizz backups`. */
export function folderLabel(uri: string): string {
  const decoded = decodeURIComponent(uri).replace(/\/+$/, '');
  const name = decoded.slice(decoded.lastIndexOf('/') + 1);
  if (decoded.includes('/Mobile Documents/')) return `iCloud Drive › ${name}`;
  if (decoded.includes('/File Provider Storage/')) return `On My iPhone › ${name}`;
  return name;
}

export function isInsideApp(uri: string): boolean {
  return decodeURIComponent(uri).startsWith(decodeURIComponent(containerRoot()));
}

export type PickOutcome = { kind: 'picked'; destination: CopyDestination } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/**
 * `Save a copy to Files`: the system folder picker (UIDocumentPicker for a
 * folder, security-scoped). Needs a device test (`DEP-FILES` for bookmarks;
 * a one-off write like this one is the simpler case).
 */
export async function pickBackupFolder(): Promise<PickOutcome> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // expo-file-system rejects a dismissed picker; treat that as a cancel, show nothing.
    if (/cancel/i.test(text)) return { kind: 'cancelled' };
    return { kind: 'failed', message: text };
  }
  return {
    kind: 'picked',
    destination: {
      label: folderLabel(dir.uri),
      insideApp: isInsideApp(dir.uri),
      write(name, text) {
        const file = new File(dir, name);
        file.write(text);
        return Promise.resolve();
      },
      async read(name) {
        const file = new File(dir, name);
        return file.exists ? file.text() : null;
      },
    },
  };
}

/**
 * Read the copy iOS made of a picked file (`UIDocumentPickerViewController`
 * `asCopy: true` puts it in `tmp/<bundle>-Inbox`), then delete it, even when
 * the read fails: it can hold Ben's whole history (review r2 B1). The
 * original in Files is untouched. A copy that can't be deleted here is
 * removed by Delete my data (`emptyTemporaryFiles`).
 */
async function readThenDelete(file: File, maxBytes: number, tooLarge: string): Promise<PickedFile> {
  try {
    if (file.size > maxBytes) return { kind: 'failed', message: tooLarge };
    return { kind: 'picked', name: file.name, text: await file.text() };
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Left for Delete my data's clean-up; the read itself succeeded or already failed.
    }
  }
}

export type PickedFile = { kind: 'picked'; name: string; text: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** Backups are well under this; anything bigger isn't a Fizz backup and isn't read into memory. */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

/**
 * `Choose another file…` (Restore / Check a backup): the system document
 * picker filtered to JSON. iOS hands back a copy in the app's `tmp`, so the
 * original in Files is never changed; the copy is deleted once read (review r2 B1). The text is data, never instructions (rule 8).
 * Needs a device test (iCloud Drive, On My iPhone, offline).
 */
export async function pickBackupFile(): Promise<PickedFile> {
  try {
    const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'public.json', 'text/plain'] });
    if (picked.canceled) return { kind: 'cancelled' };
    return await readThenDelete(picked.result, MAX_BACKUP_BYTES, 'That file is too large to be a GymSmarter backup.');
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(text)) return { kind: 'cancelled' };
    return { kind: 'failed', message: text };
  }
}

/** A FitNotes export of 10,000 rows is under 1 MB; anything this big isn't one and isn't read into memory. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/**
 * `Choose CSV file` (data-import-export §4.3): the system document picker
 * for CSV and plain text. iOS hands back a copy in the app's `tmp`, so the
 * original in Files is never changed; the copy is deleted once read (review r2 B1). The text is data, never
 * instructions (rule 8); its kind is decided from the content, not the name.
 * Needs a device test (iCloud Drive, On My iPhone, a file emailed from FitNotes 2).
 */
export async function pickCsvFile(): Promise<PickedFile> {
  try {
    const picked = await File.pickFileAsync({ mimeTypes: ['text/csv', 'text/comma-separated-values', 'text/plain', 'text/*'] });
    if (picked.canceled) return { kind: 'cancelled' };
    return await readThenDelete(picked.result, MAX_IMPORT_BYTES, 'That file is too large to be a FitNotes export.');
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(text)) return { kind: 'cancelled' };
    return { kind: 'failed', message: text };
  }
}
