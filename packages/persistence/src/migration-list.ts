/**
 * The migration list on its own (no runtime imports beyond the SQL), so the
 * release check (`scripts/check-migrations.ts`) can load it under plain Node.
 * `migrate()` lives in `migrations.ts`.
 */
import type { SqlExecutor } from './driver';
import { MIGRATION_0001 } from './schema/0001-initial';
import { MIGRATION_0002 } from './schema/0002-check-ins';
import { MIGRATION_0003 } from './schema/0003-imports';
import { MIGRATION_0004 } from './schema/0004-active-set';
import { MIGRATION_0005 } from './schema/0005-gym-switch';
import { MIGRATION_0006 } from './schema/0006-coach';
import { MIGRATION_0007 } from './schema/0007-pre-start-drafts';
import { MIGRATION_0010 } from './schema/0010-coach-set-actions';

/**
 * A forward-only schema step. `up` runs inside the same exclusive transaction
 * that sets `PRAGMA user_version = version`, so a failed migration leaves the
 * database exactly as it was. Never edit a released migration; add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  up(tx: SqlExecutor): Promise<void>;
  /** The SQL an `sqlMigration` runs (kept so the release check can see an empty one). */
  sql?: string;
}

export function sqlMigration(version: number, name: string, sql: string): Migration {
  return { version, name, sql, up: (tx) => tx.exec(sql) };
}

/** The app's migrations, in order. The last one's `version` is the current schema version. */
export const MIGRATIONS: readonly Migration[] = [
  sqlMigration(1, 'initial', MIGRATION_0001),
  sqlMigration(2, 'check-ins', MIGRATION_0002),
  sqlMigration(3, 'imports', MIGRATION_0003),
  sqlMigration(4, 'active-set', MIGRATION_0004),
  sqlMigration(5, 'gym-switch', MIGRATION_0005),
  sqlMigration(6, 'coach', MIGRATION_0006),
  sqlMigration(7, 'pre-start-drafts', MIGRATION_0007),
  // RESERVED, branch claude/coach-tools only: 8 (delete-workouts) and 9 (workout-library) are built on
  // other branches and replace these no-ops at merge. Required merge order: 8, then 9, then 10.
  // `npm run check:migrations` (run by the iOS build workflow) fails while either placeholder is
  // here, so no .ipa can ship them: a phone at version 10 would never run the real 8 and 9.
  sqlMigration(8, 'reserved-delete-workouts', ''),
  sqlMigration(9, 'reserved-workout-library', ''),
  sqlMigration(10, 'coach-set-actions', MIGRATION_0010),
];

/** A placeholder migration: reserved for another branch, so it must never reach a device or a backup. */
export const RESERVED_MIGRATION_PREFIX = 'reserved-';

/**
 * Migrations that must not ship (review coach-tools B1): a `reserved-` name or
 * empty SQL. `migrate()` only checks `user_version`, so a build that runs a
 * placeholder would mark the database past the real migration for good.
 * Empty when the list is releasable.
 */
export function releaseBlockers(migrations: readonly Migration[] = MIGRATIONS): { version: number; name: string; why: 'reserved' | 'empty' }[] {
  const out: { version: number; name: string; why: 'reserved' | 'empty' }[] = [];
  for (const m of migrations) {
    if (m.name.startsWith(RESERVED_MIGRATION_PREFIX)) out.push({ version: m.version, name: m.name, why: 'reserved' });
    else if (m.sql !== undefined && m.sql.trim() === '') out.push({ version: m.version, name: m.name, why: 'empty' });
  }
  return out;
}

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.at(-1)?.version ?? 0;
}

