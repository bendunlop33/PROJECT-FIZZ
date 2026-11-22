import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';

import type { DatabaseHost } from '@fizz/persistence';

import { createExpoDatabaseHost, type ExpoDatabaseLike } from './expo-driver';

/** Database files live in expo-sqlite's default directory (inside Fizz's container). */
function databaseFile(name: string): File {
  // Typed as `any` by expo-sqlite; on iOS it is a plain path (…/Documents/SQLite).
  const raw: unknown = defaultDatabaseDirectory;
  if (typeof raw !== 'string') throw new Error('expo-sqlite reported no database directory');
  const dir = raw.startsWith('file:') ? raw : `file://${raw}`;
  return new File(dir, name);
}

/** The real `DatabaseHost` on the phone. */
export function expoDatabaseHost(): DatabaseHost {
  return createExpoDatabaseHost({
    openDatabase: async (name) => {
      const db: ExpoDatabaseLike = await openDatabaseAsync(name);
      return db;
    },
    deleteDatabase: (name) => deleteDatabaseAsync(name),
    fileExists: (name) => Promise.resolve(databaseFile(name).exists),
    deleteFileIfExists: (name) => {
      const file = databaseFile(name);
      if (file.exists) file.delete();
      return Promise.resolve();
    },
  });
}

/**
 * Delete a database's files (with `-wal`/`-shm`) by name, without opening it.
 * Delete my data removes the capability-probe database this way (§4.5 step 3).
 * Missing files are fine; throws if one is left.
 */
export function removeDatabaseFiles(name: string): Promise<void> {
  const names = [name, `${name}-wal`, `${name}-shm`];
  try {
    for (const n of names) {
      const file = databaseFile(n);
      if (file.exists) file.delete();
    }
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
  const left = names.filter((n) => databaseFile(n).exists);
  if (left.length > 0) return Promise.reject(new Error(`Couldn’t delete ${left.join(', ')}`));
  return Promise.resolve();
}
