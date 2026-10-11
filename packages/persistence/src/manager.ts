import type { Exercise, ZonedTimestamp } from '@fizz/schemas';
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
import { analyseReplace, type ReplaceCounts } from './backup/replace';
import { countDomains, filterDomain, knowledgeExercisesInUse, type DomainCounts } from './data-domains';
import { EXERCISE_SPEC, saveDocumentIn } from './documents';
import type { DatabaseHost, SqlDriver, SqlRow } from './driver';
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
  // Why the orphan exists, so a relaunch can say "A restore was interrupted"
  // only when one really was (data-import-export §3.3).
  sqlMigration(2, 'orphan reason', `ALTER TABLE database_slots ADD COLUMN orphan_reason TEXT CHECK (orphan_reason IN ('restore', 'check', 'dropped'));`),
];

interface Slots {
  current: string;
  previous: string | null;
  orphan: string | null;
}

/** `restore`/`check`: a file being built; `dropped`: a file that fell out of the rollback slot. */
type OrphanReason = 'restore' | 'check' | 'dropped';

/** The last restore or rollback, for `Undo last restore` (data-import-export §2.1, §3.3). */
export interface LastSwitch {
  atUtc: string;
  reason: 'restore' | 'rollback';
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
  /**
   * What is on this phone but not in the backup, so a restore would remove it
   * (`3 workouts on this phone aren't in this backup`). Matched by primary key.
   */
  onlyOnPhone: ReplaceCounts;
  /** On this phone and in the backup with different content: the backup's version replaces it (PM decision on SP3). */
  changedOnPhone: ReplaceCounts;
  /**
   * The data kept for `Undo last restore` is deleted by a restore (review S2):
   * what in it is neither on this phone now nor in the backup. Null when no
   * copy is kept.
   */
  keptForUndo: (ReplaceCounts & { keptSinceUtc: string | null; unreadable: boolean }) | null;
  /**
   * The state this preview was made against (current data and the database
   * slots). `restore` with a different stamp is refused as stale (review S5).
   */
  stamp: string;
}

export type PreviewOutcome = { ok: true; preview: RestorePreview; file: BackupFile } | { ok: false; error: BackupError };

/**
 * `Check a backup` (`verifyBackup`, DX3): the file was rebuilt into a scratch
 * database, migrated and integrity-checked, then thrown away. `restorable:
 * false` means the file is readable but has damaged records.
 */
export type CheckOutcome =
  | { ok: true; preview: RestorePreview; restorable: boolean; issues: readonly { path: string; message: string }[] }
  | { ok: false; error: BackupError };

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

/** What `Delete my data` / `Reset coaching knowledge` are confirmed against (rule 5: never applied to newer state). */
export interface DomainSummary {
  counts: DomainCounts;
  /** Same form as a restore preview's stamp: the current content and the database slots. */
  stamp: string;
}

export type DomainSwitchOutcome =
  | {
      ok: true;
      /** `unchanged`: there was nothing to delete or reset; no file was switched. */
      status: 'switched' | 'unchanged';
      /** The store now in use. Recreate services from it (or relaunch). */
      store: Store;
    }
  | { ok: false; error: BackupError };

class RestoreAbort extends Error {
  constructor(readonly error: BackupError) {
    super(error.message);
  }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Any thrown error (disk full, a file that won't open) becomes a `restore_failed` result: nothing was switched. */
async function failSafe<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: BackupError }> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: { code: 'restore_failed', message: `Restore failed; your current data is unchanged. (${describe(e)})` } };
  }
}

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
    private orphanReason: OrphanReason | null,
    private switched: LastSwitch | null,
    /** A restore was building a file when the app last stopped; the current data is as it was. */
    readonly interruptedRestore: boolean,
  ) {}

  static async open(options: DatabaseManagerOptions): Promise<DatabaseManager> {
    const { host } = options;
    const meta = await host.open(options.metaName ?? 'fizz-meta.db');
    await migrate(meta, META_MIGRATIONS);
    let row = await meta.getFirst(
      'SELECT current_name, previous_name, orphan_name, orphan_reason, switched_at_utc, switch_reason FROM database_slots WHERE id = 1',
    );
    if (!row) {
      const name = options.newName();
      await meta.run('INSERT INTO database_slots (id, current_name) VALUES (1, ?)', [name]);
      row = { current_name: name, previous_name: null, orphan_name: null, orphan_reason: null, switched_at_utc: null, switch_reason: null };
    }
    const slots: Slots = {
      current: String(row.current_name),
      previous: row.previous_name === null ? null : String(row.previous_name),
      orphan: row.orphan_name === null ? null : String(row.orphan_name),
    };
    const storedReason = row.orphan_reason;
    let orphanReason: OrphanReason | null = storedReason === 'restore' || storedReason === 'check' || storedReason === 'dropped' ? storedReason : null;
    const switched: LastSwitch | null =
      typeof row.switched_at_utc === 'string' && (row.switch_reason === 'restore' || row.switch_reason === 'rollback')
        ? { atUtc: row.switched_at_utc, reason: row.switch_reason }
        : null;
    // A restore that crashed midway, or a deletion that didn't finish.
    let interruptedRestore = false;
    if (slots.orphan !== null && slots.orphan !== slots.current && slots.orphan !== slots.previous) {
      interruptedRestore = orphanReason === 'restore';
      if (await quietly(() => host.remove(slots.orphan ?? ''))) {
        await meta.run('UPDATE database_slots SET orphan_name = NULL, orphan_reason = NULL WHERE id = 1');
        slots.orphan = null;
        orphanReason = null;
      }
    }
    const migrations = options.migrations ?? MIGRATIONS;
    const store = await openStore(await host.open(slots.current), { migrations });
    return new DatabaseManager({ host, newName: options.newName, migrations }, meta, slots, store, orphanReason, switched, interruptedRestore);
  }

  /** The store in use now. */
  get store(): Store {
    return this.current;
  }

  get databaseNames(): Readonly<Slots> {
    return { ...this.slots };
  }

  /**
   * `Undo last restore` is possible when an earlier database is kept. `last`
   * is the most recent restore or rollback (null before the first one).
   */
  get rollbackTarget(): { available: boolean; last: LastSwitch | null } {
    return { available: this.slots.previous !== null, last: this.switched };
  }

  /** Verify a backup file and compare it with the current data. Changes nothing. */
  preview(text: string): Promise<PreviewOutcome> {
    return this.exclusive(() => failSafe(() => this.previewNow(text)));
  }

  /**
   * `Check a backup` (DX3): everything a restore does up to the switch
   * (checksum, schema, rebuild, migrate, integrity), in a scratch file that is
   * then removed. Never changes the current database, the rollback target or
   * the last-switch record.
   */
  check(text: string): Promise<CheckOutcome> {
    return this.exclusiveSafe(async (): Promise<CheckOutcome> => {
      const previewed = await this.previewNow(text);
      if (!previewed.ok) return previewed;
      const { preview, file } = previewed;
      const name = this.options.newName();
      const kept = { orphan: this.slots.orphan, reason: this.orphanReason };
      const built = await this.build(file, name, 'check');
      if (!built.ok) {
        if (built.error.code !== 'integrity_failed') return built;
        return { ok: true, preview, restorable: false, issues: built.error.issues ?? [] };
      }
      await quietly(() => built.store.close());
      if (await quietly(() => this.options.host.remove(name))) await quietly(() => this.writeSlots({ ...this.slots, orphan: kept.orphan }, kept.reason));
      return { ok: true, preview, restorable: true, issues: [] };
    });
  }

  /**
   * Restore a backup into a fresh database file, check it, then switch to it in
   * one meta transaction. The database that was current is kept for `rollback`.
   * Any failure before the switch leaves the current database untouched and
   * removes the half-built file.
   *
   * `expectedStamp` is the `stamp` of the preview Ben confirmed. If the data
   * or the kept copy changed since, nothing is switched and the result is
   * `preview_stale` (review S5): rule 5, never applied to newer state.
   */
  restore(text: string, at: ZonedTimestamp, opts: { expectedStamp?: string } = {}): Promise<RestoreOutcome> {
    return this.exclusiveSafe(async (): Promise<RestoreOutcome> => {
      const previewed = await this.previewNow(text);
      if (!previewed.ok) return previewed;
      const { preview, file } = previewed;
      if (opts.expectedStamp !== undefined && opts.expectedStamp !== preview.stamp) {
        return { ok: false, error: { code: 'preview_stale', message: 'Your data changed since this preview. Nothing was changed.' } };
      }
      if (preview.identical) return { ok: true, status: 'unchanged', preview, store: this.current };

      const name = this.options.newName();
      const built = await this.build(file, name, 'restore');
      if (!built.ok) return built;
      const fresh = built.store;
      try {
        await this.writeSlots({ current: name, previous: this.slots.current, orphan: this.slots.previous }, 'dropped', { atUtc: at.utc, reason: 'restore' });
      } catch (e) {
        await quietly(() => fresh.close());
        await quietly(() => this.options.host.remove(name));
        return { ok: false, error: { code: 'restore_failed', message: `Restore failed; your current data is unchanged. (${describe(e)})` } };
      }
      await this.replaceCurrent(fresh);
      return { ok: true, status: 'restored', preview, store: fresh };
    });
  }

  /**
   * Build a backup into a new, empty file and check it. The file is recorded
   * as an orphan first, so a crash leaves it to be removed on the next open.
   * On any failure the file is closed and removed, and nothing else changes.
   */
  private async build(
    file: Pick<BackupFile, 'schemaVersion' | 'tables'>,
    name: string,
    purpose: 'restore' | 'check',
    seed?: readonly Exercise[],
  ): Promise<{ ok: true; store: Store } | { ok: false; error: BackupError }> {
    const { host, migrations } = this.options;
    const notNew: BackupError = { code: 'restore_failed', message: `Restore failed: ${name} is already in use. Nothing was changed.` };
    if (name === this.slots.current || name === this.slots.previous || name === this.slots.orphan) return { ok: false, error: notNew };
    const keptOrphan = { orphan: this.slots.orphan, reason: this.orphanReason };
    let driver: SqlDriver | null = null;
    let fresh: Store | null = null;
    // The file is ours to delete once it's known to be new and empty; the slot is restored once recorded (review S3).
    let owned = false;
    let recorded = false;
    try {
      driver = await host.open(name);
      // Never adopt (and later delete) a file we didn't create: it must be empty.
      if ((await readUserVersion(driver)) !== 0) throw new RestoreAbort(notNew);
      owned = true;
      await this.writeSlots({ ...this.slots, orphan: name }, purpose);
      recorded = true;
      await driver.exec('PRAGMA journal_mode = WAL');
      await migrate(driver, migrations, file.schemaVersion);
      const shape = await checkBackupShape(driver, file);
      if (shape) throw new RestoreAbort(shape);
      await driver.withExclusiveTransaction(async (tx) => {
        await tx.exec('PRAGMA defer_foreign_keys = ON');
        await insertBackupRows(tx, file);
        // Bundled coaching knowledge (a reset): only IDs not already there, validated like any write.
        for (const e of seed ?? []) {
          if (await tx.getFirst('SELECT 1 AS here FROM exercises WHERE id = ?', [e.id])) continue;
          const saved = await saveDocumentIn(tx, EXERCISE_SPEC, e, null);
          if (!saved.ok) throw new Error(`bundled exercise ${e.id} could not be saved`);
        }
      });
      fresh = await openStore(driver, { migrations });
      const integrity = await checkIntegrity(fresh.db, latestVersion(migrations));
      if (!integrity.ok) {
        throw new RestoreAbort({
          code: 'integrity_failed',
          message: `The backup has ${String(integrity.issues.length)} damaged record(s). Nothing was changed.`,
          issues: integrity.issues.map((i) => ({ path: i.id === null ? i.table : `${i.table}.${i.id}`, message: i.message })),
        });
      }
      return { ok: true, store: fresh };
    } catch (e) {
      const closing = fresh ?? driver;
      if (closing !== null) await quietly(() => closing.close());
      if (owned && (await quietly(() => host.remove(name))) && recorded) {
        await quietly(() => this.writeSlots({ ...this.slots, orphan: keptOrphan.orphan }, keptOrphan.reason));
      }
      if (e instanceof RestoreAbort) return { ok: false, error: e.error };
      return { ok: false, error: { code: 'restore_failed', message: `Restore failed; your current data is unchanged. (${describe(e)})` } };
    }
  }

  /**
   * Switch back to the database that was current before the last restore (or
   * rollback). The two swap places, so a rollback can itself be rolled back.
   */
  rollback(at: ZonedTimestamp): Promise<RollbackOutcome> {
    return this.exclusiveSafe(async (): Promise<RollbackOutcome> => {
      const previous = this.slots.previous;
      const missing: BackupError = { code: 'nothing_to_roll_back', message: 'There is no earlier database to go back to.' };
      if (previous === null) return { ok: false, error: missing };
      let driver: SqlDriver | null = null;
      let store: Store | null = null;
      try {
        driver = await this.options.host.open(previous);
        // Opening a missing file creates an empty one; never switch to that.
        if ((await readUserVersion(driver)) === 0) throw new RestoreAbort(missing);
        store = await openStore(driver, { migrations: this.options.migrations });
        const integrity = await checkIntegrity(store.db, latestVersion(this.options.migrations));
        if (!integrity.ok) {
          throw new RestoreAbort({ code: 'integrity_failed', message: 'The earlier database failed its integrity check; staying on the current one.' });
        }
        await this.writeSlots({ current: previous, previous: this.slots.current, orphan: null }, null, { atUtc: at.utc, reason: 'rollback' });
      } catch (e) {
        const closing = store ?? driver;
        if (closing !== null) await quietly(() => closing.close());
        if (e instanceof RestoreAbort) return { ok: false, error: e.error };
        return { ok: false, error: { code: 'restore_failed', message: `Rollback failed; staying on the current database. (${describe(e)})` } };
      }
      await this.replaceCurrent(store);
      return { ok: true, store };
    });
  }

  /** Counts per data domain and the stamp a Delete or Reset confirmation is made against. */
  domainSummary(): Promise<DomainSummary> {
    return this.exclusive(async () => {
      const current = await this.readCurrent();
      return { counts: countDomains(current.tables), stamp: this.stampOf(contentHash(current.schemaVersion, current.tables)) };
    });
  }

  /**
   * `Delete my data` (data-import-export §4.5 step 3; rule 10). Builds a new
   * database holding only Coaching knowledge, checks it, and switches to it
   * in one meta transaction: a force-close before the switch leaves every
   * record as it was, after it leaves none of Ben's (all or nothing).
   * Deleting rows inside SQLite isn't possible by design (append-only
   * triggers, ADR 0005), so deleting is replacing the file.
   *
   * Then the old file and the rollback generation (both hold Ben's data) are
   * removed via `forgetPrevious`, which a relaunch can finish if the app was
   * closed in between. The last-restore record is cleared, so no
   * `Undo last restore` brings the data back.
   *
   * With nothing of Ben's left this is `unchanged` (a repeat, or a resume).
   */
  deleteYourData(opts: { expectedStamp?: string } = {}): Promise<DomainSwitchOutcome> {
    return this.exclusiveSafe(async (): Promise<DomainSwitchOutcome> => {
      const current = await this.readCurrent();
      if (opts.expectedStamp !== undefined && opts.expectedStamp !== this.stampOf(contentHash(current.schemaVersion, current.tables))) {
        return { ok: false, error: { code: 'preview_stale', message: 'Your data changed since you confirmed. Nothing was deleted.' } };
      }
      const any = countDomains(current.tables).yourData.records > 0;
      if (any) {
        const name = this.options.newName();
        const built = await this.build({ schemaVersion: current.schemaVersion, tables: filterDomain(current.tables, 'coaching_knowledge') }, name, 'check');
        if (!built.ok) return built;
        await this.switchTo(built.store, name);
      }
      await this.forgetPreviousNow();
      return { ok: true, status: any ? 'switched' : 'unchanged', store: this.current };
    });
  }

  /**
   * `Reset coaching knowledge` (§4.5). Builds a new database with every Your
   * data row unchanged, the knowledge exercises Ben's records use, and this
   * build's bundled knowledge (`bundled`); anything else in Coaching
   * knowledge (other exercises, playbook candidates) is gone. Switches in one
   * meta transaction and keeps the database it replaced as the rollback
   * generation. `unchanged` when the result would equal the current data.
   */
  resetKnowledge(bundled: readonly Exercise[], opts: { expectedStamp?: string } = {}): Promise<DomainSwitchOutcome> {
    return this.exclusiveSafe(async (): Promise<DomainSwitchOutcome> => {
      const current = await this.readCurrent();
      const currentHash = contentHash(current.schemaVersion, current.tables);
      if (opts.expectedStamp !== undefined && opts.expectedStamp !== this.stampOf(currentHash)) {
        return { ok: false, error: { code: 'preview_stale', message: 'Your data changed since you confirmed. Nothing was reset.' } };
      }
      const inUse = knowledgeExercisesInUse(current.tables);
      const tables = filterDomain(current.tables, 'your_data');
      tables.exercises = [...(tables.exercises ?? []), ...(current.tables.exercises ?? []).filter((r) => r.owner_id === null && inUse.has(String(r.id)))];
      const name = this.options.newName();
      const built = await this.build({ schemaVersion: current.schemaVersion, tables }, name, 'check', bundled);
      if (!built.ok) return built;
      const after = await built.store.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q) }));
      if (contentHash(after.schemaVersion, after.tables) === currentHash) {
        await quietly(() => built.store.close());
        if (await quietly(() => this.options.host.remove(name))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }, null));
        return { ok: true, status: 'unchanged', store: this.current };
      }
      await this.switchTo(built.store, name);
      return { ok: true, status: 'switched', store: built.store };
    });
  }

  /**
   * Remove the rollback generation (after `Delete my data`, it holds Ben's
   * data). Safe to repeat; a relaunch calls it again if the app was closed
   * part-way.
   */
  forgetPrevious(): Promise<void> {
    return this.exclusive(() => this.forgetPreviousNow());
  }

  private async forgetPreviousNow(): Promise<void> {
    const previous = this.slots.previous;
    if (previous !== null) {
      await this.writeSlots({ ...this.slots, previous: null, orphan: previous }, 'dropped', null);
      await this.options.host.remove(previous);
      await this.writeSlots({ ...this.slots, orphan: null }, null);
    } else if (this.switched !== null) {
      await this.writeSlots({ ...this.slots }, this.orphanReason, null);
    }
    const orphan = this.slots.orphan;
    if (orphan !== null && orphan !== this.slots.current) {
      await this.options.host.remove(orphan);
      await this.writeSlots({ ...this.slots, orphan: null }, null);
    }
  }

  /**
   * Switch to a freshly built file in one meta transaction. The old current
   * becomes the rollback generation and the old rollback generation is
   * dropped (as a restore does); the last-restore record is cleared.
   */
  private async switchTo(fresh: Store, name: string): Promise<void> {
    try {
      await this.writeSlots({ current: name, previous: this.slots.current, orphan: this.slots.previous }, 'dropped', null);
    } catch (e) {
      await quietly(() => fresh.close());
      await quietly(() => this.options.host.remove(name));
      throw e;
    }
    await this.replaceCurrent(fresh);
  }

  private async readCurrent(): Promise<{ schemaVersion: number; tables: Record<string, SqlRow[]> }> {
    return this.current.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q) }));
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
    const currentHash = contentHash(current.schemaVersion, current.tables);
    const kept = await this.readKept();
    const replace = analyseReplace({ current, backup: { schemaVersion: file.schemaVersion, tables: file.tables }, kept: kept === 'none' || kept === 'unreadable' ? null : kept });
    const keptSinceUtc = this.switched?.atUtc ?? null;
    const keptForUndo =
      kept === 'none'
        ? null
        : kept === 'unreadable'
          ? { workouts: 0, newestWorkoutUtc: null, otherRecords: 0, keptSinceUtc, unreadable: true }
          : replace.keptForUndo === null
            ? null
            : { ...replace.keptForUndo, keptSinceUtc, unreadable: false };
    return {
      ok: true,
      file,
      preview: {
        backup: { createdAt: file.createdAt, app: file.app, schemaVersion: file.schemaVersion, counts: countBackup(file.tables) },
        current: { schemaVersion: current.schemaVersion, counts: currentCounts },
        identical: file.schemaVersion === current.schemaVersion && contentHash(file.schemaVersion, file.tables) === currentHash,
        needsMigration: file.schemaVersion < latestVersion(this.options.migrations),
        replacesUnfinishedWorkout: currentCounts.unfinishedWorkouts > 0,
        onlyOnPhone: replace.onlyOnPhone,
        changedOnPhone: replace.changedOnPhone,
        keptForUndo,
        stamp: this.stampOf(currentHash),
      },
    };
  }

  /** The state a preview is made against: the current content and which files fill the slots. */
  private stampOf(currentHash: string): string {
    return `${this.slots.current}|${this.slots.previous ?? '-'}|${currentHash}`;
  }

  /**
   * Read the database kept for `Undo last restore`, if any, without changing
   * it. An empty file holds nothing; a file that can't be read is reported as
   * such, so the preview never deletes it without saying so.
   */
  private async readKept(): Promise<{ schemaVersion: number; tables: Record<string, SqlRow[]> } | 'none' | 'unreadable'> {
    const name = this.slots.previous;
    if (name === null) return 'none';
    let driver: SqlDriver | null = null;
    try {
      driver = await this.options.host.open(name);
      const schemaVersion = await readUserVersion(driver);
      if (schemaVersion === 0) return 'none';
      return { schemaVersion, tables: await exportTables(driver) };
    } catch {
      return 'unreadable';
    } finally {
      const d = driver;
      if (d !== null) await quietly(() => d.close());
    }
  }

  /** Close the old store and delete the file that dropped out of the rollback slot. */
  private async replaceCurrent(next: Store): Promise<void> {
    const old = this.current;
    this.current = next;
    await quietly(() => old.close());
    const doomed = this.slots.orphan;
    if (doomed !== null && doomed !== this.slots.current && doomed !== this.slots.previous) {
      if (await quietly(() => this.options.host.remove(doomed))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }, null));
    }
  }

  /** `switched`: record a restore/rollback; `null`: clear the record (delete, reset); omitted: keep it. */
  private async writeSlots(next: Slots, orphanReason: OrphanReason | null, switched?: LastSwitch | null): Promise<void> {
    const reason = next.orphan === null ? null : orphanReason;
    await this.meta.withExclusiveTransaction(async (tx) => {
      if (switched === null) {
        await tx.run(
          'UPDATE database_slots SET current_name = ?, previous_name = ?, orphan_name = ?, orphan_reason = ?, switched_at_utc = NULL, switch_reason = NULL WHERE id = 1',
          [next.current, next.previous, next.orphan, reason],
        );
      } else if (switched) {
        await tx.run(
          'UPDATE database_slots SET current_name = ?, previous_name = ?, orphan_name = ?, orphan_reason = ?, switched_at_utc = ?, switch_reason = ? WHERE id = 1',
          [next.current, next.previous, next.orphan, reason, switched.atUtc, switched.reason],
        );
      } else {
        await tx.run('UPDATE database_slots SET current_name = ?, previous_name = ?, orphan_name = ?, orphan_reason = ? WHERE id = 1', [
          next.current,
          next.previous,
          next.orphan,
          reason,
        ]);
      }
    });
    this.slots = next;
    this.orphanReason = reason;
    if (switched !== undefined) this.switched = switched;
  }

  /** `exclusive`, and an unexpected I/O error becomes `restore_failed` instead of a rejection (review S3). */
  private exclusiveSafe<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: BackupError }> {
    return this.exclusive(() => failSafe(fn));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
}
