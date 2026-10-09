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
