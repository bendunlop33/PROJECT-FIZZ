import { toMs, type RecoveryResult } from '@fizz/domain';
import { DatabaseManager, SchemaTooNewError, type DatabaseHost, type MigrationReport } from '@fizz/persistence';

import { isSqliteVersionSupported, readSqliteVersion } from '../data/expo-driver';
import { createAppServices, type AppServices, type AppServicesDeps } from './app-services';
import type { SetupState } from './app-services';
import type { DeleteStep } from '../backup/data-domain-service';

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
      /**
       * The unfinished workout couldn't be read (e.g. a record that fails
       * validation). Nothing is auto-opened; Today shows a recovery card
       * instead of a blank workout (review workout-loop S2).
       */
      recoveryError: string | null;
      /**
       * A Delete my data that was interrupted was finished at this launch:
       * anything held in memory from before (this phone's prefs) is stale
       * and must not be written back (review S2).
       */
      personalDataCleared: boolean;
      /**
       * That delete removed the ChatGPT sign-in from this phone but couldn't
       * confirm revoking it online: the first-run screen says so (§3.6; review r2 N4).
       */
      signOutNotConfirmed: boolean;
    }
  /**
   * A Delete my data couldn't be finished at launch (review S1). `deleted`:
   * the data is already gone and `step` failed (`Try again`, or `Continue`
   * with `interruptedDelete: 'leave'`); `null`: whether it was deleted
   * couldn't be checked (same actions); `false`: nothing was deleted and
   * the marker is cleared (`Continue` opens the app as it was).
   */
  | { kind: 'delete_unfinished'; deleted: boolean | null; step: DeleteStep | null; message: string }
  | { kind: 'schema_too_new'; message: string }
  | { kind: 'sqlite_too_old'; version: string }
  | { kind: 'open_failed'; message: string };

export interface StartupDeps extends Omit<AppServicesDeps, 'manager'> {
  host: DatabaseHost;
  /** A new, unique training database file name. */
  newDatabaseName: () => string;
  /**
   * `leave`: Ben chose `Continue` after an interrupted delete kept failing;
   * the marker is cleared with the step recorded as unfinished. Default:
   * finish it.
   */
  interruptedDelete?: 'finish' | 'leave';
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
    // A Delete my data that was interrupted is finished before anything is shown (data-import-export check 31).
    let personalDataCleared = false;
    let signOutNotConfirmed = false;
    if (deps.interruptedDelete === 'leave') {
      await services.data.leaveInterrupted().catch(() => null);
    } else {
      const resumed = await services.data.resumeInterrupted();
      if (resumed.kind === 'unfinished' || resumed.kind === 'not_deleted') {
        await services.close().catch(() => undefined);
        return resumed.kind === 'unfinished'
          ? { kind: 'delete_unfinished', deleted: resumed.deleted, step: resumed.step, message: resumed.message }
          : { kind: 'delete_unfinished', deleted: false, step: null, message: resumed.message };
      }
      personalDataCleared = resumed.kind === 'finished';
      signOutNotConfirmed = resumed.kind === 'finished' && resumed.signedOutOnline === false;
    }
    // Coaching knowledge: the starter exercise list (only missing IDs are added).
    await services.coachingKnowledge.ensureStarterExercises().catch(() => 0);
    // Restored data with a profile skips setup, even after a force-close straight after the switch (SP4; review R3).
    await services.setup.skipAfterRestore().catch(() => null);
    const setup = await services.setup.getState();
    let recovery: RecoveryResult | null = null;
    let recoveryError: string | null = null;
    try {
      recovery = setup.profile ? await services.sessions.recover() : null;
    } catch (e) {
      recoveryError = errorText(e);
    }
    // Rest alerts follow the recovered state: one alert for a running rest, none otherwise (flow §4.2).
    if (recovery && deps.restAlerts) void deps.restAlerts.reconcile(recovery.state, toMs(deps.now().utc));
    // Coach turns cut off by a force-close become interrupted before any sheet opens (ADR 0020 §7).
    await services.coach.recover().catch(() => 0);
    // Background work: never awaited by the launch. The integrity check reads
    // in small turns so a Log isn't held behind it (review S4). The catch-up
    // backup exports everything in one turn, so it waits while a workout is
    // unfinished; finishing that workout backs up anyway.
    if (recoveryError === null && recovery?.state.session.status !== 'active') void services.backups.ensureBackedUp().catch(() => null);
    void services.integrity.checkAll().catch(() => null);
    // Progress projections, so the first Progress open after a cold start is quick (review progress-A S4).
    void services.progress.prewarm().catch(() => null);
    return { kind: 'ready', services, migration: manager.store.migration, sqliteVersion, setup, recovery, recoveryError, personalDataCleared, signOutNotConfirmed };
  } catch (e) {
    await manager.close().catch(() => undefined);
    return { kind: 'open_failed', message: errorText(e) };
  }
}
