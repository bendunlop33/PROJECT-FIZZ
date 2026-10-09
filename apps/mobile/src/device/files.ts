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
