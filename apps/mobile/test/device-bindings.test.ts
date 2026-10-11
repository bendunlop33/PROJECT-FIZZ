import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The phone bindings Delete my data relies on (review S5): the Keychain
 * wipe (expo-secure-store) and removing files from the container
 * (expo-file-system), against in-memory stand-ins. Plus a guard that every
 * SecureStore key in the app is in `KEYCHAIN_KEYS`, so a new item (API keys,
 * ai-connection AC7) can't slip past Delete.
 */

const keychain = new Map<string, string>();
let stuck: string | null = null;
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: (key: string) => Promise.resolve(keychain.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    keychain.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    if (key !== stuck) keychain.delete(key);
    return Promise.resolve();
  },
}));

const disk = new Map<string, string>();
/** What the document picker hands back next (iOS: a copy in tmp/<bundle>-Inbox). */
let picked: string | null = null;
let failRead = false;
/** `File.delete()` throws (e.g. a picked copy iOS won't let go of). */
let failDelete = false;
vi.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: '/C/Documents/SQLite' }));
vi.mock('expo-file-system', () => {
  const pathOf = (parent: unknown, name?: string): string => {
    const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
    return name === undefined ? base : `${base.replace(/\/$/, '')}/${name}`;
  };
  class File {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      this.uri = pathOf(parent, name);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists() {
      return disk.has(this.uri);
    }
    write(text: string) {
      disk.set(this.uri, text);
    }
    get size() {
      return (disk.get(this.uri) ?? '').length;
    }
    text() {
      if (failRead) return Promise.reject(new Error('read failed'));
      return Promise.resolve(disk.get(this.uri) ?? '');
    }
    delete() {
      if (failDelete) throw new Error('delete failed');
      if (this.name.includes('locked')) return;
      disk.delete(this.uri);
    }
    static pickFileAsync() {
      if (picked === null) return Promise.resolve({ canceled: true, result: null });
      return Promise.resolve({ canceled: false, result: new File(picked) });
    }
  }
  class Directory {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      this.uri = pathOf(parent, name);
    }
    private get prefix() {
      return `${this.uri.replace(/\/$/, '')}/`;
    }
    get name() {
      const u = this.uri.replace(/\/$/, '');
      return u.slice(u.lastIndexOf('/') + 1);
    }
    get exists() {
      return [...disk.keys()].some((k) => k.startsWith(this.prefix));
    }
    create() {
      return undefined;
    }
    delete() {
      for (const k of [...disk.keys()]) if (k.startsWith(this.prefix) && !k.includes('locked')) disk.delete(k);
    }
    list() {
      const p = this.prefix;
      const below = [...disk.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
      const files = below.filter((r) => !r.includes('/')).map((r) => new File(p + r));
      const dirs = [...new Set(below.filter((r) => r.includes('/')).map((r) => r.slice(0, r.indexOf('/'))))].map((d) => new Directory(p + d));
      return [...files, ...dirs];
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///C/Documents'), cache: new Directory('file:///C/Library/Caches') } };
});

const { KEYCHAIN_KEYS, keychainVault, wipeKeychain } = await import('../src/ai/keychain');
const { containerBackupFiles, emptyTemporaryFiles, pickBackupFile, pickCsvFile, removeContainerFiles } = await import('../src/device/files');
const { removeDatabaseFiles } = await import('../src/data/expo-sqlite-host');

beforeEach(() => {
  keychain.clear();
  disk.clear();
  stuck = null;
  picked = null;
  failRead = false;
  failDelete = false;
});

describe('wipeKeychain', () => {
  it('deletes every item GymSmarter owns, including the registration', async () => {
    await keychainVault.saveRegistration('{"v":1,"email":"ben@example.com"}');
    await keychainVault.saveTokens('{"v":1}');
    keychain.set('someone-else', 'kept');
    await wipeKeychain();
    for (const key of KEYCHAIN_KEYS) expect(keychain.has(key)).toBe(false);
    expect(keychain.get('someone-else')).toBe('kept');
  });

  it('throws when an item is still there afterwards', async () => {
    await keychainVault.saveTokens('{"v":1}');
    stuck = 'fizz.chatgpt.tokens';
    await expect(wipeKeychain()).rejects.toThrow(/still in the Keychain/);
  });
});

describe('removeContainerFiles and the backup folder', () => {
  it('removes each name, its .tmp twin and matching damaged copies; leaves the rest', async () => {
    for (const n of ['device-prefs.json', 'device-prefs.json.tmp', 'coach-connection.json', 'backup-state.damaged-2026.json', 'training.db', 'data-ops.json']) disk.set(`file:///C/Documents/${n}`, 'x');
    await removeContainerFiles(['device-prefs.json', 'coach-connection.json', 'last-error.json'], /\.damaged-.*\.json$/);
    expect([...disk.keys()].sort()).toEqual(['file:///C/Documents/data-ops.json', 'file:///C/Documents/training.db']);
  });

  it('rejects when a file couldn’t be removed', async () => {
    disk.set('file:///C/Documents/locked.json', 'x');
    await expect(removeContainerFiles(['locked.json'])).rejects.toThrow(/locked\.json/);
  });

  it('lists the backup folder so Delete can remove every file in it', async () => {
    const files = containerBackupFiles();
    await files.write('fizz-backup-2026-10-08-1905-auto.json', '{}');
    await files.write('fizz-backup-2026-10-08-1912.json', '{}');
    disk.set('file:///C/Documents/device-prefs.json', '{}');
    expect((await files.list()).sort()).toEqual(['fizz-backup-2026-10-08-1905-auto.json', 'fizz-backup-2026-10-08-1912.json']);
    for (const n of await files.list()) await files.remove(n);
    expect(await files.list()).toEqual([]);
  });
});

describe('picked files and temporary copies (review r2 B1)', () => {
  const inbox = 'file:///C/tmp/com.bendunlop.fizz-Inbox';

  it('a picked CSV or backup is read, then iOS’s copy in tmp is deleted', async () => {
    picked = `${inbox}/FitNotes_Export.csv`;
    disk.set(picked, 'Date,Exercise\n2026-10-01,Bench press');
    expect(await pickCsvFile()).toEqual({ kind: 'picked', name: 'FitNotes_Export.csv', text: 'Date,Exercise\n2026-10-01,Bench press' });
    expect(disk.has(picked)).toBe(false);

    picked = `${inbox}/fizz-backup.json`;
    disk.set(picked, '{"format":"fizz-backup"}');
    expect(await pickBackupFile()).toMatchObject({ kind: 'picked', text: '{"format":"fizz-backup"}' });
    expect(disk.has(picked)).toBe(false);
  });

  it('the copy is deleted even when reading it fails', async () => {
    picked = `${inbox}/fizz-backup.json`;
    disk.set(picked, '{}');
    failRead = true;
    expect(await pickBackupFile()).toEqual({ kind: 'failed', message: 'read failed' });
    expect(disk.has(picked)).toBe(false);
  });

  it('the picked text is still returned when deleting the copy throws; the copy is left for Delete (review r3 S3)', async () => {
    picked = `${inbox}/FitNotes_Export.csv`;
    disk.set(picked, 'Date,Exercise');
    failDelete = true;
    expect(await pickCsvFile()).toEqual({ kind: 'picked', name: 'FitNotes_Export.csv', text: 'Date,Exercise' });
    expect(disk.has(picked)).toBe(true);
    failDelete = false;
    await emptyTemporaryFiles();
    expect(disk.has(picked)).toBe(false);
  });

  it('emptyTemporaryFiles empties tmp (with the picker inbox) and Caches, and leaves Documents', async () => {
    for (const k of [`${inbox}/old.csv`, 'file:///C/tmp/x.json', 'file:///C/Library/Caches/com.bendunlop.fizz/Cache.db', 'file:///C/Documents/data-ops.json']) disk.set(k, 'x');
    expect(await emptyTemporaryFiles()).toEqual({ systemLeft: [] });
    expect([...disk.keys()]).toEqual(['file:///C/Documents/data-ops.json']);
    // Missing directories are fine.
    await expect(emptyTemporaryFiles()).resolves.toEqual({ systemLeft: [] });
  });

  it('emptyTemporaryFiles throws when a picked file is left in the inbox', async () => {
    disk.set(`${inbox}/locked.csv`, 'x');
    await expect(emptyTemporaryFiles()).rejects.toThrow(/com\.bendunlop\.fizz-Inbox\/locked\.csv/);
  });

  it('emptyTemporaryFiles reports, but doesn’t fail on, entries iOS keeps outside the inbox (review r3 S2)', async () => {
    for (const k of ['file:///C/tmp/locked.json', 'file:///C/Library/Caches/com.bendunlop.fizz/com.apple.metal/locked.data', 'file:///C/Library/Caches/old.json']) disk.set(k, 'x');
    expect(await emptyTemporaryFiles()).toEqual({ systemLeft: ['locked.json', 'com.bendunlop.fizz'] });
    expect(disk.has('file:///C/Library/Caches/old.json')).toBe(false);
  });
});

describe('removeDatabaseFiles', () => {
  it('removes the database with its -wal and -shm, and nothing else; missing is fine', async () => {
    for (const n of ['fizz-probe.db', 'fizz-probe.db-wal', 'fizz-probe.db-shm', 'training-1.db']) disk.set(`file:///C/Documents/SQLite/${n}`, 'x');
    await removeDatabaseFiles('fizz-probe.db');
    expect([...disk.keys()]).toEqual(['file:///C/Documents/SQLite/training-1.db']);
    await expect(removeDatabaseFiles('fizz-probe.db')).resolves.toBeUndefined();
  });

  it('throws when a file is left', async () => {
    disk.set('file:///C/Documents/SQLite/locked.db', 'x');
    await expect(removeDatabaseFiles('locked.db')).rejects.toThrow(/locked\.db/);
  });
});

describe('KEYCHAIN_KEYS', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }

  it('lists every SecureStore key the app uses (the capability probe’s throwaway item aside)', () => {
    const root = join(import.meta.dirname, '../src');
    const users = sources(root).filter((p) => /from 'expo-secure-store'/.test(readFileSync(p, 'utf8')) && !p.includes(join('src', 'probe')));
    expect(users.map((p) => p.slice(root.length + 1))).toEqual(['ai/keychain.ts']);
    const text = readFileSync(join(root, 'ai/keychain.ts'), 'utf8');
    const declared = [...text.matchAll(/const \w+_KEY = '([^']+)'/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect([...KEYCHAIN_KEYS].sort()).toEqual([...declared].sort());
    // Every SecureStore call names one of those constants.
    for (const m of text.matchAll(/SecureStore\.\w+ItemAsync\((\w+)/g)) expect(['key', 'REGISTRATION_KEY', 'TOKENS_KEY']).toContain(m[1]);
  });
});
