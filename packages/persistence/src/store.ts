import type { ProgressionRule, UserProfile } from '@fizz/schemas';
import { sortNewestFirst, type HistorySession, type ProfileRepository, type Repositories, type VersionedRepository } from '@fizz/domain';
import { finishedWorkoutsDigest } from './backup/coverage';
import type { Slicer } from './backup/slice';
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
import { migrate, MIGRATIONS, type Migration, type MigrationBackfills, type MigrationReport } from './migrations';
import { hasSummaryTables, staleHistorySummaries } from './history-summaries';
import { checkHistorySummariesWith, rebuildHistorySummariesIn, refreshStaleHistorySummariesIn, type SummaryCheck, type SummaryRebuild } from './summary-repair';
import { SqliteImports } from './imports';
import { SqliteImportProfiles } from './import-profiles';
import { SqliteCoachStore } from './coach';
import { SqliteDrafts } from './drafts';
import { SqliteWorkoutDrafts } from './workout-drafts';
import { SqlitePlanDrafts } from './plan-drafts';
import { SqliteTrainingProfiles } from './training-profiles';
import { SqliteActivities, SqliteWeekPlans } from './activities';
import { SqlitePlanDayVariations, SqliteReviews } from './plan-days';
import { SqliteSessions } from './sessions';
import { inHistorySql } from './sql';

export interface SqliteRepositories extends Repositories {
  gyms: SqliteGyms;
  equipment: SqliteEquipment;
  /** Routines, with the plan-day template writes (workout builder v3 §4.2). */
  routines: SqliteRoutines;
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
  /** (Workout builder v3, migration 30) Saved plan-day variations, keyed by split day and main lift. */
  planDayVariations: SqlitePlanDayVariations;
  /** (Workout builder v3, migration 30) Pre-session, session, post-session, weekly and block reviews. */
  reviews: SqliteReviews;
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
    planDayVariations: new SqlitePlanDayVariations(db),
    reviews: new SqliteReviews(db),
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
  /** `listExerciseHistory` for many exercises in one read (each workout decoded once). */
  listExerciseHistories(ownerId: string, exerciseIds: readonly string[]): Promise<Map<string, HistorySession[]>>;
  countRecords(): Promise<RecordCounts>;
  /** `finishedWorkoutsDigest` of the finished workouts now, by ID and revision (backup coverage, B2, S1). */
  finishedWorkoutsDigest(): Promise<string>;
  /**
   * (ADR 0032) What the open-time refresh of the history summaries did (missing or stale ones rebuilt from the
   * workouts: after a restore, a reset, a summary format change, or a write that bypassed the repositories).
   */
  summaryRefresh: SummaryRebuild;
  /** (ADR 0032) The full consistency check: every workout's stored history summary against one recomputed from it. Reads only. */
  checkHistorySummaries(sessionIds?: readonly string[]): Promise<SummaryCheck>;
  /** (ADR 0032) Rewrite the history summaries of `sessionIds` (default: every one the check finds wrong) from their workouts. */
  repairHistorySummaries(sessionIds?: readonly string[]): Promise<SummaryRebuild>;
  close(): Promise<void>;
}

export interface OpenStoreOptions {
  /** Override the migration list (tests of older schema versions only). */
  migrations?: readonly Migration[];
  /**
   * (ADR 0032) Rebuilding history summaries on open (migration 36's backfill, after a restore or a reset) pauses
   * between workouts with this, so the JS thread stays responsive. Default: one go.
   */
  slice?: Slicer;
}

/**
 * Open the training database: WAL journal (research §2.1), migrate to the
 * current schema, then serve repositories through one write queue.
 */
/** Workouts per queue turn of the summaries' consistency check. */
const SUMMARY_CHECK_TURN = 10;
const macrotaskYield = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * (ADR 0032) Migration 36's backfill: every stored workout's history summary, in the migration's own transaction.
 * Exported for the migration tests.
 */
export const MIGRATION_BACKFILLS: MigrationBackfills = {
  36: (tx) => refreshStaleHistorySummariesIn(tx),
};

/** `MIGRATION_BACKFILLS`, sliced (a launch after the update shows its cover meanwhile). */
const backfillsSliced = (slice: Slicer | undefined): MigrationBackfills => (slice === undefined ? MIGRATION_BACKFILLS : { 36: (tx) => refreshStaleHistorySummariesIn(tx, slice) });

export async function openStore(driver: SqlDriver, options: OpenStoreOptions = {}): Promise<Store> {
  await driver.exec('PRAGMA journal_mode = WAL');
  const migration = await migrate(driver, options.migrations ?? MIGRATIONS, undefined, backfillsSliced(options.slice));
  const db = new Database(driver);
  // (ADR 0032) Summaries missing or stale (one query when there are none) are rebuilt before anything reads them.
  const stale = await db.read(async (q) => ((await hasSummaryTables(q)) ? staleHistorySummaries(q) : { missing: [], orphans: [] }));
  const summaryRefresh =
    stale.missing.length + stale.orphans.length === 0 ? { written: 0, removed: 0, unreadable: [] } : await db.write((tx) => refreshStaleHistorySummariesIn(tx, options.slice));
  const repos = createSqliteRepositories(db);
  // (Perf, 23 Oct) Each exercise's history while the owner's history is as it was (`historyStamp`): a Your workout
  // edit, a Today read or a set logged doesn't re-read years of workouts. Callers get their own array.
  let memo: { ownerId: string; stamp: string; writes: number; byExercise: Map<string, readonly HistorySession[]> } | null = null;
  async function historiesOf(ownerId: string, exerciseIds: readonly string[]): Promise<Map<string, HistorySession[]>> {
    const unique = [...new Set(exerciseIds)];
    // No write at all since the stamp was read: it still holds (the stamp query is skipped).
    const writes = db.writeCount;
    const stamp = memo !== null && memo.ownerId === ownerId && memo.writes === writes ? memo.stamp : await repos.sessions.historyStamp(ownerId);
    if (memo === null || memo.ownerId !== ownerId || memo.stamp !== stamp) memo = { ownerId, stamp, writes, byExercise: new Map() };
    else memo.writes = writes;
    const kept = memo;
    const missing = unique.filter((id) => !kept.byExercise.has(id));
    if (missing.length > 0) {
      // (ADR 0032) From the stored per-exercise summaries: nothing is decoded while they are current.
      const byExercise = await repos.sessions.listLiftHistories(ownerId, missing);
      for (const id of missing) {
        kept.byExercise.set(
          id,
          sortNewestFirst(byExercise.get(id) ?? [], (h) => h.performedAtUtc),
        );
      }
    }
    const out = new Map<string, HistorySession[]>();
    for (const id of unique) out.set(id, [...(kept.byExercise.get(id) ?? [])]);
    return out;
  }

  /** (ADR 0032) The consistency check a few workouts per queue turn (`SUMMARY_CHECK_TURN`), so writes and taps aren't held behind it. */
  async function checkInTurns(sessionIds?: readonly string[]): Promise<SummaryCheck> {
    const ids = sessionIds ?? (await db.read(async (q) => ((await hasSummaryTables(q)) ? (await q.getAll<{ id: string }>(`SELECT id FROM sessions WHERE ${inHistorySql()} ORDER BY id`)).map((r) => r.id) : [])));
    const out: SummaryCheck = { ok: true, checked: 0, missing: [], differing: [], orphans: [], unreadable: [] };
    for (let i = 0; i < ids.length; i += SUMMARY_CHECK_TURN) {
      const part = await db.read((q) => checkHistorySummariesWith(q, ids.slice(i, i + SUMMARY_CHECK_TURN), { orphans: false }));
      out.checked += part.checked;
      out.missing.push(...part.missing);
      out.differing.push(...part.differing);
      out.unreadable.push(...part.unreadable);
      await (options.slice ?? macrotaskYield)();
    }
    out.orphans = await db.read(async (q) => ((await hasSummaryTables(q)) ? (await staleHistorySummaries(q)).orphans : []));
    out.ok = out.missing.length === 0 && out.differing.length === 0 && out.orphans.length === 0;
    return out;
  }

  return {
    db,
    repos,
    migration,
    async listExerciseHistory(ownerId, exerciseId) {
      return (await historiesOf(ownerId, [exerciseId])).get(exerciseId) ?? [];
    },
    listExerciseHistories: historiesOf,
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
    summaryRefresh,
    checkHistorySummaries: (sessionIds) => checkInTurns(sessionIds),
    async repairHistorySummaries(sessionIds) {
      const ids =
        sessionIds ??
        (await (async () => {
          const c = await checkInTurns();
          return [...c.missing, ...c.differing, ...c.orphans];
        })());
      const r = await db.write((tx) => rebuildHistorySummariesIn(tx, ids));
      repos.sessions.summariesChanged();
      memo = null;
      return r;
    },
    finishedWorkoutsDigest: () =>
      db.read(async (q) => finishedWorkoutsDigest(await q.getAll<{ id: string; revision: number }>(`SELECT id, revision FROM sessions WHERE ${inHistorySql()}`))),
    close: () => db.close(),
  };
}
