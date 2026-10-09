import type { RecoveryResult } from '@fizz/domain';
import { DatabaseManager, SchemaTooNewError, type DatabaseHost, type MigrationReport } from '@fizz/persistence';

import { isSqliteVersionSupported, readSqliteVersion } from '../data/expo-driver';
import { createAppServices, type AppServices, type AppServicesDeps } from './app-services';
import type { SetupState } from './app-services';

/**
 * Launch sequence (system-states §3.6–§3.9, flow §4.2). Pure TS: the host and
 * file stores are injected, so this runs on Linux in tests.
 *
 * 1. Open the training database through `DatabaseManager` (orphan clean-up,
 *    migrations; a database from a newer build is never touched).
 * 2. Check the SQLite engine supports the schema (≥ 3.37).
 * 3. Build the services, read setup state, recover an unfinished workout.
 * 4. In the background, without blocking anything: back up if a finished
 *    workout isn't in the newest backup, and run the full integrity check.
 */

export type StartupOutcome =
  | {
      kind: 'ready';
      services: AppServices;
      migration: MigrationReport;
      sqliteVersion: string;
      setup: SetupState;
      recovery: RecoveryResult | null;
    }
  | { kind: 'schema_too_new'; message: string }
  | { kind: 'sqlite_too_old'; version: string }
  | { kind: 'open_failed'; message: string };

export interface StartupDeps extends Omit<AppServicesDeps, 'manager'> {
  host: DatabaseHost;
  /** A new, unique training database file name. */
  newDatabaseName: () => string;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function startApp(deps: StartupDeps): Promise<StartupOutcome> {
  let manager: DatabaseManager;
  try {
    manager = await DatabaseManager.open({ host: deps.host, newName: deps.newDatabaseName });
  } catch (e) {
    if (e instanceof SchemaTooNewError) return { kind: 'schema_too_new', message: e.message };
    return { kind: 'open_failed', message: errorText(e) };
  }
  try {
    const sqliteVersion = await manager.store.db.read(readSqliteVersion);
    if (!isSqliteVersionSupported(sqliteVersion)) {
      await manager.close();
      return { kind: 'sqlite_too_old', version: sqliteVersion };
    }
    const services = createAppServices({ ...deps, manager });
    const setup = await services.setup.getState();
    const recovery = setup.profile ? await services.sessions.recover() : null;
    // Background work: never awaited by the launch. The integrity check reads
    // in small turns so a Log isn't held behind it (review S4). The catch-up
    // backup exports everything in one turn, so it waits while a workout is
    // unfinished; finishing that workout backs up anyway.
    if (recovery?.state.session.status !== 'active') void services.backups.ensureBackedUp().catch(() => null);
    void services.integrity.checkAll().catch(() => null);
    return { kind: 'ready', services, migration: manager.store.migration, sqliteVersion, setup, recovery };
  } catch (e) {
    await manager.close().catch(() => undefined);
    return { kind: 'open_failed', message: errorText(e) };
  }
}
