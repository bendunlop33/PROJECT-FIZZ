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
import { analyseReplace, keptOnly, type ReplaceCounts } from './backup/replace';
import { timeSlicer, type Slicer } from './backup/slice';
import { countDomains, countDomainsIn, exportDomain, filterDomain, knowledgeExercisesInUse, type DataDomain, type DomainCounts, type DomainExport } from './data-domains';
import { EXERCISE_SPEC, saveDocumentIn } from './documents';
import type { DatabaseHost, SqlDriver, SqlRow } from './driver';
import { discardOpenDrafts } from './drafts';
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
  // `Undo last reset` (data-import-export §3.6, check 31a): a Reset coaching
  // knowledge switch is recorded like a restore. SQLite can't change a CHECK
  // in place, so the one-row table is rebuilt (ADR 0023).
  sqlMigration(
    3,
    'reset switch reason',
    `CREATE TABLE database_slots_v3 (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       current_name TEXT NOT NULL,
       previous_name TEXT,
       orphan_name TEXT,
       switched_at_utc TEXT,
       switch_reason TEXT CHECK (switch_reason IN ('restore', 'rollback', 'reset', 'undo_reset')),
       orphan_reason TEXT CHECK (orphan_reason IN ('restore', 'check', 'dropped'))
     ) STRICT;
     INSERT INTO database_slots_v3 (id, current_name, previous_name, orphan_name, switched_at_utc, switch_reason, orphan_reason)
       SELECT id, current_name, previous_name, orphan_name, switched_at_utc, switch_reason, orphan_reason FROM database_slots;
     DROP TABLE database_slots;
     ALTER TABLE database_slots_v3 RENAME TO database_slots;`,
  ),
];

interface Slots {
  current: string;
  previous: string | null;
  orphan: string | null;
}

/** `restore`/`check`: a file being built; `dropped`: a file that fell out of the rollback slot. */
type OrphanReason = 'restore' | 'check' | 'dropped';

/**
 * The last switch that can be undone, for `Undo last restore` / `Undo last
 * reset` (data-import-export §2.1, §3.3, §3.6). `rollback` undid a restore;
 * `undo_reset` undid a Reset coaching knowledge.
 */
export type SwitchReason = 'restore' | 'rollback' | 'reset' | 'undo_reset';
const SWITCH_REASONS: readonly string[] = ['restore', 'rollback', 'reset', 'undo_reset'] satisfies readonly SwitchReason[];

export interface LastSwitch {
  atUtc: string;
  reason: SwitchReason;
}

export interface DatabaseManagerOptions {
  host: DatabaseHost;
  /** A new, unique database file name, e.g. `training-<uuid>.db`. */
  newName: () => string;
  /** Default `fizz-meta.db`. */
  metaName?: string;
  /** Override the migration list (tests of older schema versions only). */
  migrations?: readonly Migration[];
  /** Pauses long preview/check/restore work so the JS thread stays responsive (backup review B1). Default: 8 ms slices. */
  slice?: Slicer;
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
  /** Workouts deleted on this phone since the backup was made, which the restore brings back to history (delete-workouts §6.5, DW28). */
  deletedSinceBackup: number;
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

/**
 * Your data in the copy kept for Undo that isn't on this phone (review r5
 * B1). `unreadable`: the copy couldn't be read, so what's in it is unknown.
 */
export type KeptCopyLoss = ReplaceCounts & { keptSinceUtc: string | null; unreadable: boolean };

/** What `Delete my data` / `Reset coaching knowledge` are confirmed against (rule 5: never applied to newer state). */
export interface DomainSummary {
  counts: DomainCounts;
  /**
   * What `Reset coaching knowledge` would delete with the copy kept for Undo
   * (review r5 B1): null when that copy holds nothing that isn't on this
   * phone. Reset is refused (`kept_copy_at_risk`) unless confirmed with it.
   */
  keptForUndo: KeptCopyLoss | null;
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
  /**
   * The last backup text that parsed and verified, with its content hash
   * (backup review B1): Check, the restore preview and Restore of the same
   * file parse and hash it once. Parsing depends only on the text.
   */
  private verified: { text: string; file: BackupFile; contentHash: string } | null = null;

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
      typeof row.switched_at_utc === 'string' && typeof row.switch_reason === 'string' && SWITCH_REASONS.includes(row.switch_reason)
        ? { atUtc: row.switched_at_utc, reason: row.switch_reason as SwitchReason }
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
    const store = await openStore(await host.open(slots.current), { migrations, slice: options.slice ?? timeSlicer() });
    return new DatabaseManager(
      { host, newName: options.newName, migrations, slice: options.slice ?? timeSlicer() },
      meta,
      slots,
      store,
      orphanReason,
      switched,
      interruptedRestore,
    );
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

  /**
   * Drop the cached checked backup (its text and parsed tables can be tens of
   * MB), e.g. when the restore screen closes (fix-backup review N2). The next
   * Check parses the file again.
   */
  forgetChecked(): void {
    this.verified = null;
  }

  /** Whether a checked backup is cached (tests). */
  get holdsCheckedBackup(): boolean {
    return this.verified !== null;
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
      this.verified = null;

      await this.dropStaleOrphan();
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
      const { slice } = this.options;
      const shape = await checkBackupShape(driver, file, slice);
      if (shape) throw new RestoreAbort(shape);
      await driver.withExclusiveTransaction(async (tx) => {
        await tx.exec('PRAGMA defer_foreign_keys = ON');
        await insertBackupRows(tx, file, slice);
        // Bundled coaching knowledge (a reset): only IDs not already there, validated like any write.
        for (const e of seed ?? []) {
          if (await tx.getFirst('SELECT 1 AS here FROM exercises WHERE id = ?', [e.id])) continue;
          const saved = await saveDocumentIn(tx, EXERCISE_SPEC, e, null);
          if (!saved.ok) throw new Error(`bundled exercise ${e.id} could not be saved`);
        }
      });
      fresh = await openStore(driver, { migrations, slice: this.options.slice });
      // A restored phone never starts from an old pre-start draft (ADR 0022 §5): every open one is discarded.
      // Only for a restore: Reset and Delete build with `check` and keep Your-data rows as they are (review r4 S1).
      if (purpose === 'restore') await discardOpenDrafts(fresh.db);
      const integrity = await checkIntegrity(fresh.db, latestVersion(migrations), slice);
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
      const last = this.switched?.reason;
      if (last === 'reset' || last === 'undo_reset') return this.swapKnowledge(previous, last === 'reset' ? 'undo_reset' : 'reset', at);
      let driver: SqlDriver | null = null;
      let store: Store | null = null;
      try {
        driver = await this.options.host.open(previous);
        // Opening a missing file creates an empty one; never switch to that.
        if ((await readUserVersion(driver)) === 0) throw new RestoreAbort(missing);
        store = await openStore(driver, { migrations: this.options.migrations, slice: this.options.slice });
        // As after a restore (ADR 0022 §5): the database switched to never starts from its old pre-start drafts (review N4).
        await discardOpenDrafts(store.db, at.utc);
        const integrity = await checkIntegrity(store.db, latestVersion(this.options.migrations), this.options.slice);
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

  /**
   * `Undo last reset` and redoing it (data-import-export §3.6, check 31a;
   * review r5 B1, S1) change Coaching knowledge only: a new file is built
   * from every Your-data row on this phone now plus the other database's
   * Coaching knowledge (and any knowledge exercise Ben's records use that
   * it lacks), then switched to. Anything logged since the reset stays. The
   * file switched away from becomes the copy kept for the next Undo; the one
   * it replaces was an earlier state of this same data and is dropped.
   */
  private async swapKnowledge(other: string, reason: 'reset' | 'undo_reset', at: ZonedTimestamp): Promise<RollbackOutcome> {
    const missing: BackupError = { code: 'nothing_to_roll_back', message: 'There is no earlier database to go back to.' };
    const theirs = await this.readFile(other);
    if (theirs === null) return { ok: false, error: missing };
    const current = await this.readCurrent();
    const tables = filterDomain(current.tables, 'your_data');
    const knowledge = filterDomain(theirs.tables, 'coaching_knowledge');
    for (const [table, rows] of Object.entries(knowledge)) tables[table] = [...(tables[table] ?? []), ...rows];
    const have = new Set((knowledge.exercises ?? []).map((r) => String(r.id)));
    const inUse = await knowledgeExercisesInUse(current.tables, this.options.slice);
    tables.exercises = [...(tables.exercises ?? []), ...(current.tables.exercises ?? []).filter((r) => r.owner_id === null && inUse.has(String(r.id)) && !have.has(String(r.id)))];
    await this.dropStaleOrphan();
    const name = this.options.newName();
    const built = await this.build({ schemaVersion: current.schemaVersion, tables }, name, 'check');
    if (!built.ok) return built.error.code === 'integrity_failed' ? { ok: false, error: { code: 'integrity_failed', message: 'The earlier coaching knowledge failed its integrity check; staying on the current one.' } } : built;
    await this.switchTo(built.store, name, { atUtc: at.utc, reason });
    return { ok: true, store: built.store };
  }

  /** A kept database file's content at the current schema (migrated on open); null when it's missing or empty. */
  private async readFile(name: string): Promise<{ schemaVersion: number; tables: Record<string, SqlRow[]> } | null> {
    const driver = await this.options.host.open(name);
    let store: Store | null = null;
    try {
      // Opening a missing file creates an empty one; never read that as data.
      if ((await readUserVersion(driver)) === 0) return null;
      store = await openStore(driver, { migrations: this.options.migrations, slice: this.options.slice });
      return await store.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q, this.options.slice) }));
    } finally {
      const closing = store ?? driver;
      await quietly(() => closing.close());
    }
  }

  /**
   * Counts per data domain only, from SQL (your-data-merge S3): no stamp, no
   * read of the copy kept for Undo. For the Export screen; the Delete and
   * Reset confirmations need `domainSummary`.
   */
  domainCounts(): Promise<DomainCounts> {
    return this.exclusive(() => this.current.db.read((q) => countDomainsIn(q)));
  }

  /**
   * One domain's rows for an export, read in pages and shaped in slices
   * (your-data-merge S1). Doesn't take the manager lock, as before: only the
   * paged read holds the store queue.
   */
  exportDomain(domain: DataDomain): Promise<DomainExport> {
    return exportDomain(this.current.db, domain, this.options.slice);
  }

  /** Counts per data domain and the stamp a Delete or Reset confirmation is made against. */
  domainSummary(): Promise<DomainSummary> {
    return this.exclusive(async () => {
      const current = await this.readCurrent();
      return {
        counts: countDomains(current.tables),
        keptForUndo: await this.lostWithKeptCopy(current),
        stamp: this.stampOf(await contentHash(current.schemaVersion, current.tables, this.options.slice)),
      };
    });
  }

  /**
   * Run `fn` on the copy kept for Undo, opened (and migrated) on its own and
   * closed again, e.g. to back it up before Reset drops it (review r5 B1).
   * Null when no copy is kept or it can't be opened.
   */
  withKeptCopy<T>(fn: (store: Store) => Promise<T>): Promise<{ value: T } | null> {
    return this.exclusive(async () => {
      const name = this.slots.previous;
      if (name === null) return null;
      let driver: SqlDriver | null = null;
      let store: Store | null = null;
      try {
        driver = await this.options.host.open(name);
        if ((await readUserVersion(driver)) === 0) return null;
        store = await openStore(driver, { migrations: this.options.migrations, slice: this.options.slice });
      } catch {
        const closing = store ?? driver;
        if (closing !== null) await quietly(() => closing.close());
        return null;
      }
      try {
        return { value: await fn(store) };
      } finally {
        const s = store;
        await quietly(() => s.close());
      }
    });
  }

  /**
   * What dropping the copy kept for Undo would lose (review r5 B1): Your
   * data in it that isn't on this phone. A copy kept by Reset or its Undo
   * is an earlier state of this data (every Your-data row was copied), so
   * only records gone from this phone count; a copy kept by a restore is
   * another history, so changed records count too, as the restore preview
   * counts them.
   */
  private async lostWithKeptCopy(current: { schemaVersion: number; tables: Record<string, SqlRow[]> }): Promise<KeptCopyLoss | null> {
    const kept = await this.readKept();
    if (kept === 'none') return null;
    const keptSinceUtc = this.switched?.atUtc ?? null;
    if (kept === 'unreadable') return { workouts: 0, newestWorkoutUtc: null, otherRecords: 0, keptSinceUtc, unreadable: true };
    const reason = this.switched?.reason;
    const lost = await keptOnly({ current, kept, match: reason === 'reset' || reason === 'undo_reset' ? 'absent' : 'either' }, this.options.slice);
    return lost.workouts + lost.otherRecords > 0 ? { ...lost, keptSinceUtc, unreadable: false } : null;
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
      if (opts.expectedStamp !== undefined && opts.expectedStamp !== this.stampOf(await contentHash(current.schemaVersion, current.tables, this.options.slice))) {
        return { ok: false, error: { code: 'preview_stale', message: 'Your data changed since you confirmed. Nothing was deleted.' } };
      }
      const any = countDomains(current.tables).yourData.records > 0;
      // A checked backup held in memory is Ben's data too: drop it with the rest.
      this.verified = null;
      if (any) {
        await this.dropStaleOrphan();
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
   * With `at`, the switch is recorded so `Undo last reset` is offered (check 31a).
   *
   * The copy kept for Undo before this Reset is dropped. When it holds Your
   * data that isn't on this phone (`domainSummary().keptForUndo`, e.g. the
   * pre-restore data of `Undo last restore`), Reset is refused with
   * `kept_copy_at_risk` unless `dropKeptCopy` says Ben confirmed with that
   * named (and the caller backed it up): review r5 B1.
   */
  resetKnowledge(
    bundled: readonly Exercise[],
    opts: { expectedStamp?: string; at?: ZonedTimestamp; dropKeptCopy?: boolean } = {},
  ): Promise<DomainSwitchOutcome> {
    return this.exclusiveSafe(async (): Promise<DomainSwitchOutcome> => {
      const current = await this.readCurrent();
      const currentHash = await contentHash(current.schemaVersion, current.tables, this.options.slice);
      if (opts.expectedStamp !== undefined && opts.expectedStamp !== this.stampOf(currentHash)) {
        return { ok: false, error: { code: 'preview_stale', message: 'Your data changed since you confirmed. Nothing was reset.' } };
      }
      const inUse = await knowledgeExercisesInUse(current.tables, this.options.slice);
      const tables = filterDomain(current.tables, 'your_data');
      tables.exercises = [...(tables.exercises ?? []), ...(current.tables.exercises ?? []).filter((r) => r.owner_id === null && inUse.has(String(r.id)))];
      await this.dropStaleOrphan();
      const name = this.options.newName();
      const built = await this.build({ schemaVersion: current.schemaVersion, tables }, name, 'check', bundled);
      if (!built.ok) return built;
      const after = await built.store.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q, this.options.slice) }));
      if ((await contentHash(after.schemaVersion, after.tables, this.options.slice)) === currentHash) {
        await quietly(() => built.store.close());
        if (await quietly(() => this.options.host.remove(name))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }, null));
        return { ok: true, status: 'unchanged', store: this.current };
      }
      if (opts.dropKeptCopy !== true && (await this.lostWithKeptCopy(current)) !== null) {
        await quietly(() => built.store.close());
        if (await quietly(() => this.options.host.remove(name))) await quietly(() => this.writeSlots({ ...this.slots, orphan: null }, null));
        return { ok: false, error: { code: 'kept_copy_at_risk', message: 'The copy kept for Undo holds data that isn’t on this phone. Nothing was reset.' } };
      }
      await this.switchTo(built.store, name, opts.at ? { atUtc: opts.at.utc, reason: 'reset' } : null);
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

  /**
   * An orphan left by a failed quiet removal (`replaceCurrent`) is removed
   * before anything else is written to the orphan slot, so its name is never
   * overwritten and the file left on disk untracked (review r2 N1). Throws if
   * it can't be removed.
   */
  private async dropStaleOrphan(): Promise<void> {
    const stale = this.slots.orphan;
    if (stale !== null && stale !== this.slots.current && stale !== this.slots.previous) {
      await this.options.host.remove(stale);
      await this.writeSlots({ ...this.slots, orphan: null }, null);
    }
  }

  private async forgetPreviousNow(): Promise<void> {
    await this.dropStaleOrphan();
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
   * dropped (as a restore does). `switched`: the record for Undo (a reset),
   * or null to clear it (delete).
   */
  private async switchTo(fresh: Store, name: string, switched: LastSwitch | null = null): Promise<void> {
    try {
      await this.writeSlots({ current: name, previous: this.slots.current, orphan: this.slots.previous }, 'dropped', switched);
    } catch (e) {
      await quietly(() => fresh.close());
      await quietly(() => this.options.host.remove(name));
      throw e;
    }
    await this.replaceCurrent(fresh);
  }

  private async readCurrent(): Promise<{ schemaVersion: number; tables: Record<string, SqlRow[]> }> {
    return this.current.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q, this.options.slice) }));
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      this.verified = null;
      await this.current.close();
      await this.meta.close();
    });
  }

  /** Parse and verify once per backup text (B1). */
  private async verify(text: string): Promise<{ ok: true; file: BackupFile; contentHash: string } | { ok: false; error: BackupError }> {
    const cached = this.verified;
    if (cached !== null && cached.text === text) return { ok: true, file: cached.file, contentHash: cached.contentHash };
    const { slice, migrations } = this.options;
    const parsed = await parseBackup(text, migrations, slice);
    if (!parsed.ok) return parsed;
    const hash = await contentHash(parsed.file.schemaVersion, parsed.file.tables, slice);
    this.verified = { text, file: parsed.file, contentHash: hash };
    return { ok: true, file: parsed.file, contentHash: hash };
  }

  private async previewNow(text: string): Promise<PreviewOutcome> {
    const { slice } = this.options;
    const verified = await this.verify(text);
    if (!verified.ok) return verified;
    const { file } = verified;
    const current = await this.current.db.read(async (q) => ({ schemaVersion: await readUserVersion(q), tables: await exportTables(q, slice) }));
    const currentCounts = countBackup(current.tables);
    const currentHash = await contentHash(current.schemaVersion, current.tables, slice);
    const kept = await this.readKept();
    const replace = await analyseReplace(
      { current, backup: { schemaVersion: file.schemaVersion, tables: file.tables }, kept: kept === 'none' || kept === 'unreadable' ? null : kept },
      slice,
    );
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
        identical: file.schemaVersion === current.schemaVersion && verified.contentHash === currentHash,
        needsMigration: file.schemaVersion < latestVersion(this.options.migrations),
        replacesUnfinishedWorkout: currentCounts.unfinishedWorkouts > 0,
        onlyOnPhone: replace.onlyOnPhone,
        changedOnPhone: replace.changedOnPhone,
        keptForUndo,
        deletedSinceBackup: replace.deletedSinceBackup,
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
      return { schemaVersion, tables: await exportTables(driver, this.options.slice) };
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
