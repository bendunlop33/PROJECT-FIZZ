import type { SqlDriver, SqlExecutor } from './driver';
import { SchemaTooNewError } from './errors';
import { MIGRATION_0001 } from './schema/0001-initial';
import { MIGRATION_0002 } from './schema/0002-check-ins';
import { MIGRATION_0003 } from './schema/0003-imports';
import { MIGRATION_0004 } from './schema/0004-gym-switch';

/**
 * A forward-only schema step. `up` runs inside the same exclusive transaction
 * that sets `PRAGMA user_version = version`, so a failed migration leaves the
 * database exactly as it was. Never edit a released migration; add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  up(tx: SqlExecutor): Promise<void>;
}

export function sqlMigration(version: number, name: string, sql: string): Migration {
  return { version, name, up: (tx) => tx.exec(sql) };
}

/** The app's migrations, in order. The last one's `version` is the current schema version. */
export const MIGRATIONS: readonly Migration[] = [
  sqlMigration(1, 'initial', MIGRATION_0001),
  sqlMigration(2, 'check-ins', MIGRATION_0002),
  sqlMigration(3, 'imports', MIGRATION_0003),
  sqlMigration(4, 'gym-switch', MIGRATION_0004),
];

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.at(-1)?.version ?? 0;
}

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
 * Bring the database up to `target` (default: the latest), one transaction per
 * migration. Refuses to touch a database from a newer build, and never goes
 * backwards.
 */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = latestVersion(migrations),
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
      await tx.exec(`PRAGMA user_version = ${String(m.version)}`);
      applied.push(m.version);
    });
  }
  return { from, to: await readUserVersion(driver), applied };
}
