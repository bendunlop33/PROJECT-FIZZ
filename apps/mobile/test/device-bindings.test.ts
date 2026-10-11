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
    text() {
      return Promise.resolve(disk.get(this.uri) ?? '');
    }
    delete() {
      if (this.name.includes('locked')) return;
      disk.delete(this.uri);
    }
  }
  class Directory {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      this.uri = pathOf(parent, name);
    }
    get exists() {
      return true;
    }
    create() {
      return undefined;
    }
    list() {
      const prefix = `${this.uri.replace(/\/$/, '')}/`;
      return [...disk.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///Documents') } };
});

const { KEYCHAIN_KEYS, keychainVault, wipeKeychain } = await import('../src/ai/keychain');
const { containerBackupFiles, removeContainerFiles } = await import('../src/device/files');

beforeEach(() => {
  keychain.clear();
  disk.clear();
  stuck = null;
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
    for (const n of ['device-prefs.json', 'device-prefs.json.tmp', 'coach-connection.json', 'backup-state.damaged-2026.json', 'training.db', 'data-ops.json']) disk.set(`file:///Documents/${n}`, 'x');
    await removeContainerFiles(['device-prefs.json', 'coach-connection.json', 'last-error.json'], /\.damaged-.*\.json$/);
    expect([...disk.keys()].sort()).toEqual(['file:///Documents/data-ops.json', 'file:///Documents/training.db']);
  });

  it('rejects when a file couldn’t be removed', async () => {
    disk.set('file:///Documents/locked.json', 'x');
    await expect(removeContainerFiles(['locked.json'])).rejects.toThrow(/locked\.json/);
  });

  it('lists the backup folder so Delete can remove every file in it', async () => {
    const files = containerBackupFiles();
    await files.write('fizz-backup-2026-10-08-1905-auto.json', '{}');
    await files.write('fizz-backup-2026-10-08-1912.json', '{}');
    disk.set('file:///Documents/device-prefs.json', '{}');
    expect((await files.list()).sort()).toEqual(['fizz-backup-2026-10-08-1905-auto.json', 'fizz-backup-2026-10-08-1912.json']);
    for (const n of await files.list()) await files.remove(n);
    expect(await files.list()).toEqual([]);
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
