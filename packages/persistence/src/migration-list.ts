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
import { upMigration0008 } from './schema/0008-deleted-workouts';
import { MIGRATION_0009 } from './schema/0009-progress';
import { MIGRATION_0010 } from './schema/0010-workout-gaps';
import { MIGRATION_0011 } from './schema/0011-coach-set-actions';
import { MIGRATION_0012 } from './schema/0012-today-fit';
import { MIGRATION_0013 } from './schema/0013-workout-drafts';
import { MIGRATION_0014 } from './schema/0014-coach-add-exercise';
import { MIGRATION_0015 } from './schema/0015-import-layouts';
import { MIGRATION_0016 } from './schema/0016-training-profiles';
import { MIGRATION_0017 } from './schema/0017-coach-rename-workout';
import { MIGRATION_0018 } from './schema/0018-coach-build-question';
import { MIGRATION_0019 } from './schema/0019-coach-edit-today';
import { MIGRATION_0020 } from './schema/0020-coach-plans';
import { MIGRATION_0021 } from './schema/0021-cardio';
import { MIGRATION_0022 } from './schema/0022-plan-end';
import { MIGRATION_0023 } from './schema/0023-custom-exercises';
import { MIGRATION_0024 } from './schema/0024-superset-rounds';
import { MIGRATION_0025 } from './schema/0025-plan-pause';
import { MIGRATION_0026 } from './schema/0026-coach-update-gym';
import { MIGRATION_0027 } from './schema/0027-coach-lift-targets';

/**
 * A forward-only schema step. `up` runs inside the same exclusive transaction
 * that sets `PRAGMA user_version = version`, so a failed migration leaves the
 * database exactly as it was. Never edit a released migration; add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  /** The SQL an `sqlMigration` runs (kept so the release checks can see an empty one). */
  sql?: string;
  up(tx: SqlExecutor): Promise<void>;
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
  { version: 8, name: 'deleted-workouts', up: upMigration0008 },
  sqlMigration(9, 'progress', MIGRATION_0009),
  sqlMigration(10, 'workout-gaps', MIGRATION_0010),
  sqlMigration(11, 'coach-set-actions', MIGRATION_0011),
  sqlMigration(12, 'today-fit', MIGRATION_0012),
  sqlMigration(13, 'workout-drafts', MIGRATION_0013),
  sqlMigration(14, 'coach-add-exercise', MIGRATION_0014),
  sqlMigration(15, 'import-layouts', MIGRATION_0015),
  sqlMigration(16, 'training-profiles', MIGRATION_0016),
  sqlMigration(17, 'coach-rename-workout', MIGRATION_0017),
  sqlMigration(18, 'coach-build-question', MIGRATION_0018),
  sqlMigration(19, 'coach-edit-today', MIGRATION_0019),
  sqlMigration(20, 'coach-plans', MIGRATION_0020),
  sqlMigration(21, 'cardio', MIGRATION_0021),
  sqlMigration(22, 'plan-end', MIGRATION_0022),
  sqlMigration(23, 'custom-exercises', MIGRATION_0023),
  sqlMigration(24, 'superset-rounds', MIGRATION_0024),
  sqlMigration(25, 'plan-pause', MIGRATION_0025),
  sqlMigration(26, 'coach-update-gym', MIGRATION_0026),
  sqlMigration(27, 'coach-lift-targets', MIGRATION_0027),
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

/**
 * Versions whose SQL is empty: placeholders that must never reach Ben's
 * phone (a database migrated past one never runs the real migration). The
 * iOS build's check job fails while any exists (review gaps S5;
 * `packages/persistence/test/release-migrations.test.ts`). `releaseBlockers`
 * also catches `reserved-` names (review coach-tools B1).
 */
export function emptyMigrations(migrations: readonly Migration[] = MIGRATIONS): number[] {
  return migrations.filter((m) => m.sql !== undefined && m.sql.trim() === '').map((m) => m.version);
}

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.at(-1)?.version ?? 0;
}

