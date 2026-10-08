import type { ZonedTimestamp } from '@fizz/schemas';
import {
  checkBackupShape,
  contentHash,
  countBackup,
  exportTables,
  insertBackupRows,
  parseBackup,
  type AppInfo,
  type BackupCounts,
  type BackupError,
  type BackupFile,
} from './backup/backup';
import type { DatabaseHost, SqlDriver } from './driver';
import { checkIntegrity } from './integrity';
import { latestVersion, migrate, MIGRATIONS, readUserVersion, sqlMigration, type Migration } from './migrations';
import { openStore, type Store } from './store';

/**
 * A tiny separate database that records which training database file is
 * current. Switching files is one SQLite transaction here, so a crash leaves
 * either the old or the new file current, never neither.
 * - `previous_name`: kept for rollback (one generation).
 * - `orphan_name`: a file being built or awaiting deletion; removed on next open.
 */
const META_MIGRATIONS: readonly Migration[] = [
  sqlMigration(
    1,
    'database slots',
    `CREATE TABLE database_slots (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       current_name TEXT NOT NULL,
       previous_name TEXT,
       orphan_name TEXT,
       switched_at_utc TEXT,
       switch_reason TEXT CHECK (switch_reason IN ('restore', 'rollback'))
     ) STRICT;`,
  ),
];

interface Slots {
  current: string;
  previous: string | null;
  orphan: string | null;
}

export interface DatabaseManagerOptions {
  host: DatabaseHost;
  /** A new, unique database file name, e.g. `training-<uuid>.db`. */
  newName: () => string;
  /** Default `fizz-meta.db`. */
  metaName?: string;
  /** Override the migration list (tests of older schema versions only). */
  migrations?: readonly Migration[];
}

export interface RestorePreview {
  backup: { createdAt: ZonedTimestamp; app: AppInfo; schemaVersion: number; counts: BackupCounts };
  current: { schemaVersion: number; counts: BackupCounts };
  /** Restoring would change nothing (same schema version and identical content). */
  identical: boolean;
  /** The backup is from an older schema and will be migrated forward after loading. */
  needsMigration: boolean;
  /** The current database has an unfinished workout that the restore would replace. */
  replacesUnfinishedWorkout: boolean;
}

export type PreviewOutcome = { ok: true; preview: RestorePreview; file: BackupFile } | { ok: false; error: BackupError };

export type RestoreOutcome =
  | {
      ok: true;
      /** `unchanged`: the backup matches the current data; nothing was switched (duplicate restore). */
      status: 'restored' | 'unchanged';
      preview: RestorePreview;
      /** The store now in use. Recreate services from `store.repos`. */
      store: Store;
    }
  | { ok: false; error: BackupError };

export type RollbackOutcome = { ok: true; store: Store } | { ok: false; error: BackupError };

class RestoreAbort extends Error {
  constructor(readonly error: BackupError) {
    super(error.message);
  }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function quietly(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

/**
 * Owns the current training database and the restore/rollback lifecycle.
 *
 * Restore is modal: the UI blocks logging while it runs. Any repository call
 * still queued on the old store when it is replaced fails with "Database is
 * closed" rather than writing to a database that is no longer current. After
 * a restore or rollback, recreate services from the returned `store`.
 */
export class DatabaseManager {
  private lock: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly options: Required<Omit<DatabaseManagerOptions, 'metaName'>>,
    private readonly meta: SqlDriver,
    private slots: Slots,
    private current: Store,
  ) {}

  static async open(options: DatabaseManagerOptions): Promise<DatabaseManager> {
    const { host } = options;
    const meta = await host.open(options.metaName ?? 'fizz-meta.db');
    await migrate(meta, META_MIGRATIONS);
    let row = await meta.getFirst('SELECT current_name, previous_name, orphan_name FROM database_slots WHERE id = 1');
    if (!row) {
      const name = options.newName();
      await meta.run('INSERT INTO database_slots (id, current_name) VALUES (1, ?)', [name]);
      row = { current_name: name, previous_name: null, orphan_name: null };
    }
    const slots: Slots = {
      current: String(row.current_name),
      previous: row.previous_name === null ? null : String(row.previous_name),
      orphan: row.orphan_name === null ? null : String(row.orphan_name),
    };
    // A restore that crashed midway, or a deletion that didn't finish.
    if (slots.orphan !== null && slots.orphan !== slots.current && slots.orphan !== slots.previous) {
      if (await quietly(() => host.remove(slots.orphan ?? ''))) {
        await meta.run('UPDATE database_slots SET orphan_name = NULL WHERE id = 1');
        slots.orphan = null;
      }
    }
    const migrations = options.migrations ?? MIGRATIONS;
    const store = await openStore(await host.open(slots.current), { migrations });
    return new DatabaseManager({ host, newName: options.newName, migrations }, meta, slots, store);
  }

  /** The store in use now. */
  get store(): Store {
    return this.current;
  }

  get databaseNames(): Readonly<Slots> {
    return { ...this.slots };
  }

  /** Verify a backup file and compare it with the current data. Changes nothing. */
  preview(text: string): Promise<PreviewOutcome> {
    return this.exclusive(() => this.previewNow(text));
  }

  /**
   * Restore a backup into a fresh database file, check it, then switch to it in
   * one meta transaction. The database that was current is kept for `rollback`.
   * Any failure before the switch leaves the current database untouched and
   * removes the half-built file.
   */
  restore(text: string, at: ZonedTimestamp): Promise<RestoreOutcome> {
    return this.exclusive(async () => {
      const previewed = await this.previewNow(text);
      if (!previewed.ok) return previewed;
      const { preview, file } = previewed;
      if (preview.identical) return { ok: true, status: 'unchanged', preview, store: this.current };

      const { host, migrations } = this.options;
      const name = this.options.newName();
      const notNew: BackupError = { code: 'restore_failed', message: `Restore failed: ${name} is already in use. Nothing was changed.` };
      if (name === this.slots.current || name === this.slots.previous || name === this.slots.orphan) return { ok: false, error: notNew };
      // Never adopt (and later delete) a file we didn't create: it must be empty.
      const driver = await host.open(name);
      if ((await readUserVersion(driver)) !== 0) {
        await quietly(() => driver.close());
        return { ok: false, error: notNew };
      }
      await this.writeSlots({ ...this.slots, orphan: name });
      let fresh: Store | null = null;
      try {
        await driver.exec('PRAGMA journal_mode = WAL');
        await migrate(driver, migrations, file.schemaVersion);
        const shape = await checkBackupShape(driver, file);
        if (shape) throw new RestoreAbort(shape);
        await driver.withExclusiveTransaction(async (tx) => {
          await tx.exec('PRAGMA defer_foreign_keys = ON');
          await insertBackupRows(tx, file);
        });
        fresh = await openStore(driver, { migrations });
        const integrity = await checkIntegrity(fresh.db, latestVersion(migrations));
        if (!integrity.ok) {
          throw new RestoreAbort({
            code: 'integrity_failed',
            message: `The backup has ${integrity.issues.length} damaged record(s). Nothing was changed.`,
            issues: integrity.issues.map((i) => ({ path: i.id === null ? i.table : `${i.table}.${i.id}`, message: i.message })),
          });
        }
        await this.writeSlots({ current: name, previous: this.slots.current, orphan: this.slots.previous }, at, 'restore');
      } catch (e) {
        const closing = fresh ?? driver;
        await quietly(() => closing.close());
        if (await quietly(() => host.remove(name))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }));
        if (e instanceof RestoreAbort) return { ok: false, error: e.error };
        return { ok: false, error: { code: 'restore_failed', message: `Restore failed; your current data is unchanged. (${describe(e)})` } };
      }
      await this.replaceCurrent(fresh);
      return { ok: true, status: 'restored', preview, store: fresh };
    });
  }

  /**
   * Switch back to the database that was current before the last restore (or
   * rollback). The two swap places, so a rollback can itself be rolled back.
   */
  rollback(at: ZonedTimestamp): Promise<RollbackOutcome> {
    return this.exclusive(async () => {
      const previous = this.slots.previous;
      const missing: BackupError = { code: 'nothing_to_roll_back', message: 'There is no earlier database to go back to.' };
      if (previous === null) return { ok: false, error: missing };
      const driver = await this.options.host.open(previous);
      let store: Store | null = null;
      try {
        // Opening a missing file creates an empty one; never switch to that.
        if ((await readUserVersion(driver)) === 0) throw new RestoreAbort(missing);
        store = await openStore(driver, { migrations: this.options.migrations });
        const integrity = await checkIntegrity(store.db, latestVersion(this.options.migrations));
        if (!integrity.ok) {
          throw new RestoreAbort({ code: 'integrity_failed', message: 'The earlier database failed its integrity check; staying on the current one.' });
        }
        await this.writeSlots({ current: previous, previous: this.slots.current, orphan: null }, at, 'rollback');
      } catch (e) {
        const closing = store ?? driver;
        await quietly(() => closing.close());
        if (e instanceof RestoreAbort) return { ok: false, error: e.error };
        return { ok: false, error: { code: 'restore_failed', message: `Rollback failed; staying on the current database. (${describe(e)})` } };
      }
      await this.replaceCurrent(store);
      return { ok: true, store };
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      await this.current.close();
      await this.meta.close();
    });
  }

  private async previewNow(text: string): Promise<PreviewOutcome> {
    const parsed = parseBackup(text, this.options.migrations);
    if (!parsed.ok) return parsed;
    const { file } = parsed;
    const current = await this.current.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q) }));
    const currentCounts = countBackup(current.tables);
    return {
      ok: true,
      file,
      preview: {
        backup: { createdAt: file.createdAt, app: file.app, schemaVersion: file.schemaVersion, counts: countBackup(file.tables) },
        current: { schemaVersion: current.schemaVersion, counts: currentCounts },
        identical:
          file.schemaVersion === current.schemaVersion &&
          contentHash(file.schemaVersion, file.tables) === contentHash(current.schemaVersion, current.tables),
        needsMigration: file.schemaVersion < latestVersion(this.options.migrations),
        replacesUnfinishedWorkout: currentCounts.unfinishedWorkouts > 0,
      },
    };
  }

  /** Close the old store and delete the file that dropped out of the rollback slot. */
  private async replaceCurrent(next: Store): Promise<void> {
    const old = this.current;
    this.current = next;
    await quietly(() => old.close());
    const doomed = this.slots.orphan;
    if (doomed !== null && doomed !== this.slots.current && doomed !== this.slots.previous) {
      if (await quietly(() => this.options.host.remove(doomed))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }));
    }
  }

  private async writeSlots(next: Slots, at?: ZonedTimestamp, reason?: 'restore' | 'rollback'): Promise<void> {
    await this.meta.withExclusiveTransaction(async (tx) => {
      if (at && reason) {
        await tx.run(
          'UPDATE database_slots SET current_name = ?, previous_name = ?, orphan_name = ?, switched_at_utc = ?, switch_reason = ? WHERE id = 1',
          [next.current, next.previous, next.orphan, at.utc, reason],
        );
      } else {
        await tx.run('UPDATE database_slots SET current_name = ?, previous_name = ?, orphan_name = ? WHERE id = 1', [
          next.current,
          next.previous,
          next.orphan,
        ]);
      }
    });
    this.slots = next;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
}
