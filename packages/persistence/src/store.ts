import type { ProgressionRule, UserProfile } from '@fizz/schemas';
import { toHistorySessions, toMs, type HistorySession, type ProfileRepository, type Repositories, type VersionedRepository } from '@fizz/domain';
import { finishedWorkoutsDigest } from './backup/coverage';
import { Database } from './database';
import {
  DocumentRepository,
  PROFILE_SPEC,
  PROGRESSION_RULE_SPEC,
  SqliteCheckIns,
  SqliteEquipment,
  SqliteExercises,
  SqlitePainFlags,
  SqliteGyms,
  SqliteRoutines,
} from './documents';
import type { SqlDriver } from './driver';
import { migrate, MIGRATIONS, type Migration, type MigrationReport } from './migrations';
import { SqliteImports } from './imports';
import { SqliteImportProfiles } from './import-profiles';
import { SqliteCoachStore } from './coach';
import { SqliteDrafts } from './drafts';
import { SqliteWorkoutDrafts } from './workout-drafts';
import { SqlitePlanDrafts } from './plan-drafts';
import { SqliteTrainingProfiles } from './training-profiles';
import { SqliteActivities, SqliteWeekPlans } from './activities';
import { SqliteSessions } from './sessions';
import { inHistorySql } from './sql';

export interface SqliteRepositories extends Repositories {
  gyms: SqliteGyms;
  equipment: SqliteEquipment;
  sessions: SqliteSessions;
  checkIns: SqliteCheckIns;
  painFlags: SqlitePainFlags;
  imports: SqliteImports;
  /** Saved import layouts and layout requests (ADR 0026). */
  importProfiles: SqliteImportProfiles;
  coach: SqliteCoachStore;
  drafts: SqliteDrafts;
  /** Coach-built workout drafts (workout-builder §8.2). */
  workoutDrafts: SqliteWorkoutDrafts;
  planDrafts: SqlitePlanDrafts;
  /** Training details and split (migration 16). */
  trainingProfiles: SqliteTrainingProfiles;
  /** (Ben, 20 Oct) Runs, rides, swims and sport (migration 26). */
  activities: SqliteActivities;
  /** (Ben, 20 Oct) This week's shape applied from the coach's proposal (migration 26). */
  weekPlans: SqliteWeekPlans;
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
    checkIns: new SqliteCheckIns(db),
    painFlags: new SqlitePainFlags(db),
    imports: new SqliteImports(db),
    importProfiles: new SqliteImportProfiles(db),
    coach: new SqliteCoachStore(db),
    drafts: new SqliteDrafts(db),
    workoutDrafts: new SqliteWorkoutDrafts(db),
    planDrafts: new SqlitePlanDrafts(db),
    trainingProfiles: new SqliteTrainingProfiles(db),
    activities: new SqliteActivities(db),
    weekPlans: new SqliteWeekPlans(db),
  };
}

/** Cheap record counts for status lines (App status, Data & backup). */
export interface RecordCounts {
  finishedWorkouts: number;
  unfinishedWorkouts: number;
  loggedSets: number;
  gyms: number;
  exercises: number;
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
  countRecords(): Promise<RecordCounts>;
  /** `finishedWorkoutsDigest` of the finished workouts now, by ID and revision (backup coverage, B2, S1). */
  finishedWorkoutsDigest(): Promise<string>;
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
        .flatMap((a) => toHistorySessions(a, exerciseId, { identity: true }))
        .sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
    },
    countRecords: () =>
      db.read(async (q) => {
        const row = await q.getFirst<Record<keyof RecordCounts, number>>(
          `SELECT
             (SELECT count(*) FROM sessions WHERE ${inHistorySql()}) AS finishedWorkouts,
             (SELECT count(*) FROM sessions WHERE status = 'active') AS unfinishedWorkouts,
             (SELECT count(*) FROM session_sets s JOIN sessions p ON p.id = s.session_id
                WHERE s.status = 'completed' AND ${inHistorySql('p')}) AS loggedSets,
             (SELECT count(*) FROM gyms) AS gyms,
             (SELECT count(*) FROM exercises) AS exercises`,
        );
        return {
          finishedWorkouts: row?.finishedWorkouts ?? 0,
          unfinishedWorkouts: row?.unfinishedWorkouts ?? 0,
          loggedSets: row?.loggedSets ?? 0,
          gyms: row?.gyms ?? 0,
          exercises: row?.exercises ?? 0,
        };
      }),
    finishedWorkoutsDigest: () =>
      db.read(async (q) => finishedWorkoutsDigest(await q.getAll<{ id: string; revision: number }>(`SELECT id, revision FROM sessions WHERE ${inHistorySql()}`))),
    close: () => db.close(),
  };
}
