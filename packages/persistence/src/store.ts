import type { ProgressionRule, UserProfile } from '@fizz/schemas';
import { toHistorySessions, toMs, type HistorySession, type ProfileRepository, type Repositories, type VersionedRepository } from '@fizz/domain';
import { Database } from './database';
import {
  DocumentRepository,
  PROFILE_SPEC,
  PROGRESSION_RULE_SPEC,
  SqliteEquipment,
  SqliteExercises,
  SqliteGyms,
  SqliteRoutines,
} from './documents';
import type { SqlDriver } from './driver';
import { migrate, MIGRATIONS, type Migration, type MigrationReport } from './migrations';
import { SqliteSessions } from './sessions';

export interface SqliteRepositories extends Repositories {
  gyms: SqliteGyms;
  sessions: SqliteSessions;
}

export function createSqliteRepositories(db: Database): SqliteRepositories {
  return {
    profiles: new DocumentRepository<UserProfile>(db, PROFILE_SPEC) satisfies ProfileRepository,
    gyms: new SqliteGyms(db),
    equipment: new SqliteEquipment(db),
    exercises: new SqliteExercises(db),
    routines: new SqliteRoutines(db),
    progressionRules: new DocumentRepository<ProgressionRule>(db, PROGRESSION_RULE_SPEC) satisfies VersionedRepository<ProgressionRule>,
    sessions: new SqliteSessions(db),
  };
}

export interface Store {
  db: Database;
  repos: SqliteRepositories;
  migration: MigrationReport;
  /**
   * Progression history for one exercise, latest first, ready for
   * `calculateNextTargets` (finished sessions only; sides carried).
   */
  listExerciseHistory(ownerId: string, exerciseId: string): Promise<HistorySession[]>;
  close(): Promise<void>;
}

export interface OpenStoreOptions {
  /** Override the migration list (tests of older schema versions only). */
  migrations?: readonly Migration[];
}

/**
 * Open the training database: WAL journal (research §2.1), migrate to the
 * current schema, then serve repositories through one write queue.
 */
export async function openStore(driver: SqlDriver, options: OpenStoreOptions = {}): Promise<Store> {
  await driver.exec('PRAGMA journal_mode = WAL');
  const migration = await migrate(driver, options.migrations ?? MIGRATIONS);
  const db = new Database(driver);
  const repos = createSqliteRepositories(db);
  return {
    db,
    repos,
    migration,
    async listExerciseHistory(ownerId, exerciseId) {
      const sessions = await repos.sessions.listFinishedWithExercise(ownerId, exerciseId);
      return sessions
        .flatMap((a) => toHistorySessions(a, exerciseId))
        .sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
    },
    close: () => db.close(),
  };
}
