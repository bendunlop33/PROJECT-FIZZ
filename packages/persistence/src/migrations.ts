import type { SqlDriver, SqlExecutor } from './driver';
import { SchemaTooNewError } from './errors';
import { latestVersion, MIGRATIONS, type Migration } from './migration-list';

export * from './migration-list';

function assertWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration list is malformed: entry ${i} has version ${m.version}, expected ${i + 1}`);
  });
}

export async function readUserVersion(q: SqlExecutor): Promise<number> {
  const row = await q.getFirst<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: number[];
}

/**
 * Data a migration derives with domain code (ADR 0032: migration 36's history summaries), run inside that
 * migration's transaction straight after its SQL. Kept out of the migration list so it stays free of domain code
 * (the release check loads it under plain Node).
 */
export type MigrationBackfills = Readonly<Record<number, (tx: SqlExecutor) => Promise<unknown>>>;

/**
 * Bring the database up to `target` (default: the latest), one transaction per
 * migration. Refuses to touch a database from a newer build, and never goes
 * backwards.
 */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = latestVersion(migrations),
  backfills: MigrationBackfills = {},
): Promise<MigrationReport> {
  assertWellFormed(migrations);
  const latest = latestVersion(migrations);
  const from = await readUserVersion(driver);
  if (from > latest) throw new SchemaTooNewError(from, latest);
  if (target > latest || target < 0) throw new RangeError(`No migration to version ${target}`);
  if (target < from) throw new RangeError(`Migrations are forward-only (database is at ${from}, asked for ${target})`);

  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= from || m.version > target) continue;
    await driver.withExclusiveTransaction(async (tx) => {
      // Re-check inside the transaction: another connection may have migrated meanwhile.
      const current = await readUserVersion(tx);
      if (current >= m.version) return;
      if (current !== m.version - 1) throw new Error(`Database at version ${current} can't take migration ${m.version}`);
      await m.up(tx);
      await backfills[m.version]?.(tx);
      await tx.exec(`PRAGMA user_version = ${String(m.version)}`);
      applied.push(m.version);
    });
  }
  return { from, to: await readUserVersion(driver), applied };
}
