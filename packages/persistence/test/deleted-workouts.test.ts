import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyseImport,
  buildImportedSession,
  buildLiftHighlight,
  DEFAULT_ANSWERS,
  parseFitNotesCsv,
  pastExercisesOf,
  planImportRows,
  purgeAfterUtc,
  starterExercises,
  toHistorySessions,
  toMs,
  type MatchCandidate,
} from '@fizz/domain';
import { HISTORY_EXERCISES, id, idGen, largeHistory, OWNER, profile } from '@fizz/domain/testing';
import type { ImportJob, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import {
  checkIntegrity,
  countDomains,
  countDomainsIn,
  createBackup,
  DatabaseManager,
  exportDomain,
  exportTables,
  openStore,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * Deleting finished workouts on real SQLite (delete-workouts.md): the
 * status change and its audit, idempotency and stale refusals, every
 * derived reader, Recently deleted, the purge and its tombstone, imports,
 * exports, and the backup round trip.
 */

const TZ = 'Europe/London';
const z = (utc: string): ZonedTimestamp => ({ utc, tz: TZ });
const NOW = z('2026-10-09T07:12:00.000Z');
const DAY_31 = z('2026-11-09T00:00:00.000Z');
const BENCH = HISTORY_EXERCISES[0]?.id ?? '';

let store: Store;
let history: SessionAggregate[];

beforeEach(async () => {
  store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  for (const e of HISTORY_EXERCISES) await store.repos.exercises.save(e, null);
  history = largeHistory({ weeks: 2, perWeek: 3 });
  for (const a of history) expect(await store.repos.sessions.save(a, null)).toMatchObject({ ok: true });
});
afterEach(async () => {
  await store.close();
});

const latest = () => history.at(-1) as SessionAggregate;
const item = (a: SessionAggregate) => ({ sessionId: a.session.id, expectedVersion: a.session.version });

async function del(list: readonly SessionAggregate[], opId = 'del-1', at = NOW) {
  const out = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: list.map(item), opId, at });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out;
}

/** Raw rows of a session's tables, to compare before and after. */
async function rowsOf(sessionId: string) {
  return store.db.read(async (q) => ({
    sets: await q.getAll('SELECT * FROM session_sets WHERE session_id = ? ORDER BY id', [sessionId]),
    exercises: await q.getAll('SELECT * FROM session_exercises WHERE session_id = ? ORDER BY id', [sessionId]),
    audit: await q.getAll('SELECT * FROM set_audit WHERE session_id = ? ORDER BY ordinal', [sessionId]),
  }));
}

describe('deleteWorkouts and restoreWorkouts on SQLite', () => {
  it('changes only the status and deletion record; every set row and version is unchanged; the operation is recorded (DW6)', async () => {
    const a = latest();
    const before = await rowsOf(a.session.id);
    const out = await del([a]);
    expect(out).toEqual({ ok: true, duplicate: false, refs: [{ sessionId: a.session.id, version: a.session.version + 1 }] });
    expect(await rowsOf(a.session.id)).toEqual(before);
    const stored = await store.repos.sessions.get(a.session.id);
    expect(stored?.session).toMatchObject({ status: 'deleted', deletion: { at: NOW, opId: 'del-1', purgeAfterUtc: purgeAfterUtc(NOW) } });
    expect(stored?.revision).toBe(a.revision + 1);
    expect(stored?.processedOps['del-1']).toMatchObject({ commandType: 'delete_workout' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('a retry with the same operation ID writes nothing new (DW7)', async () => {
    const a = latest();
    await del([a]);
    const digest = await store.finishedWorkoutsDigest();
    const stored = await store.repos.sessions.get(a.session.id);
    const again = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a)], opId: 'del-1', at: NOW });
    expect(again).toEqual({ ok: true, duplicate: true, refs: [{ sessionId: a.session.id, version: a.session.version + 1 }] });
    expect(await store.repos.sessions.get(a.session.id)).toEqual(stored);
    expect(await store.finishedWorkoutsDigest()).toBe(digest);
  });

  it('a workout changed since it was selected refuses the whole delete (DW8); an already-deleted one in a new operation is stale', async () => {
    const [a, b, c] = history;
    if (!a || !b || !c) throw new Error('fixture');
    // `b` was corrected from another screen after the list loaded.
    const set = b.sets.find((s) => s.status === 'completed');
    const fixed = await store.repos.sessions.save(
      { ...b, session: { ...b.session, version: b.session.version + 1 }, sets: b.sets.map((s) => (s.id === set?.id ? { ...s, version: s.version + 1, edited: true } : s)), revision: b.revision + 1 },
      b.revision,
    );
    expect(fixed).toMatchObject({ ok: true });
    const out = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a), item(b), item(c)], opId: 'del-sel', at: NOW });
    expect(out).toEqual({ ok: false, error: { code: 'stale', sessionIds: [b.session.id] } });
    for (const x of [a, b, c]) expect((await store.repos.sessions.get(x.session.id))?.session.status).toBe('finished');

    await del([a], 'del-a');
    const second = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version + 1 }], opId: 'del-a-2', at: NOW });
    expect(second).toMatchObject({ ok: false, error: { code: 'stale' } });
  });

  it('Undo restores exactly that operation’s workouts with the same values and version + 1; a later delete’s Undo leaves the earlier one (DW9)', async () => {
    const [a, b, c] = history;
    if (!a || !b || !c) throw new Error('fixture');
    const before = await rowsOf(a.session.id);
    const first = await del([a, b], 'del-first');
    const second = await del([c], 'del-second');
    const undo = await store.repos.sessions.restoreWorkouts({
      ownerId: OWNER,
      items: second.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })),
      opId: 'undo-second',
      at: z('2026-10-09T07:12:05.000Z'),
    });
    expect(undo).toMatchObject({ ok: true, refs: [{ sessionId: c.session.id, version: c.session.version + 2 }] });
    expect((await store.repos.sessions.get(c.session.id))?.session.status).toBe('finished');
    expect((await store.repos.sessions.get(a.session.id))?.session.status).toBe('deleted');
    const restored = await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: first.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })), opId: 'undo-first', at: NOW });
    expect(restored.ok).toBe(true);
    const back = await store.repos.sessions.get(a.session.id);
    expect(back?.session.status).toBe('finished');
    expect(back?.session.deletion).toBeUndefined();
    expect(back?.session.version).toBe(a.session.version + 2);
    expect(await rowsOf(a.session.id)).toEqual(before);
    expect(Object.keys(back?.processedOps ?? {})).toEqual(expect.arrayContaining(['del-first', 'undo-first']));
  });

  it('Restore after the 30 days is refused, and a stale restore version too (DW21)', async () => {
    const a = latest();
    const out = await del([a]);
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: ref.version }], opId: 'r-late', at: DAY_31 })).toMatchObject({ ok: false, error: { code: 'stale' } });
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: ref.version - 1 }], opId: 'r-stale', at: NOW })).toMatchObject({ ok: false, error: { code: 'stale' } });
  });
});

describe('every derived reader leaves a deleted workout out, and has it back on Restore (§5, DW10–DW19)', () => {
  /** Every reader of finished workouts in the store, as one comparable snapshot. */
  async function readers() {
    const s = store.repos.sessions;
    const ids = (list: readonly SessionAggregate[]) => list.map((a) => a.session.id);
    const withBench = await s.listFinishedWithExercise(OWNER, BENCH);
    return {
      listFinishedWithExercise: ids(withBench),
      listFinishedBetween: ids(await s.listFinishedBetween(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')),
      listFinishedBetweenReadable: ids((await s.listFinishedBetweenReadable(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).sessions),
      latestFinished: (await s.latestFinished(OWNER))?.session.id ?? null,
      listRepeatableIds: await s.listRepeatableIds(OWNER, 100),
      listFinishedRefs: (await s.listFinishedRefs(OWNER, 100)).map((r) => r.sessionId),
      listExerciseHistory: (await store.listExerciseHistory(OWNER, BENCH)).map((h) => [h.sessionId, h.sets.length]),
      countRecords: await store.countRecords(),
      digest: await store.finishedWorkoutsDigest(),
      countDomainsIn: (await countDomainsIn(store.db.driver)).yourData.workouts,
      // Workouts and sets only: `records` counts every Your-data row, deleted ones included (Delete my data removes them).
      countDomains: (({ workouts, sets }) => ({ workouts, sets }))(countDomains(await store.db.read((q) => exportTables(q))).yourData),
      lastValues: pastExercisesOf(withBench, BENCH),
      liftHighlight: buildLiftHighlight(withBench),
    };
  }

  it('deleting the latest workout recomputes every view as if it never existed; Restore brings back the original', async () => {
    const original = await readers();
    const a = latest();
    // What the views would be if the workout had never been logged.
    const never = await openStore(memoryDriver());
    await never.repos.profiles.save(profile(), null);
    for (const e of HISTORY_EXERCISES) await never.repos.exercises.save(e, null);
    for (const x of history.slice(0, -1)) await never.repos.sessions.save(x, null);
    const s = store;
    store = never;
    const expected = await readers();
    store = s;
    await never.close();

    const out = await del([a]);
    const deleted = await readers();
    expect({ ...deleted, digest: null, countDomainsIn: deleted.countDomainsIn }).toEqual({ ...expected, digest: null });
    expect(deleted.digest).toBe(expected.digest);
    expect(deleted.latestFinished).toBe(history.at(-2)?.session.id);
    expect(deleted.listRepeatableIds).not.toContain(a.session.id);
    // Restore: every view as it was, except the digest (the revision moved on, so a backup is due).
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: ref.sessionId, expectedVersion: ref.version }], opId: 'res', at: NOW })).ok).toBe(true);
    const back = await readers();
    expect({ ...back, digest: null }).toEqual({ ...original, digest: null });
    expect(back.digest).not.toBe(original.digest);
  });

  it('toHistorySessions of the stored deleted aggregate is empty (records, e1RM and next targets read only through it)', async () => {
    const a = latest();
    await del([a]);
    const stored = await store.repos.sessions.get(a.session.id);
    if (!stored) throw new Error('gone');
    expect(toHistorySessions(stored, BENCH)).toEqual([]);
  });

  it('no reader compares a session status with `finished` except through the one predicate (DW19)', () => {
    const root = join(__dirname, '..', '..', '..');
    const dirs = ['packages/domain/src', 'packages/persistence/src', 'packages/coach/src', 'packages/schemas/src', 'packages/providers/src', 'apps/mobile/src'];
    // Allowed, each for a reason: the predicate itself; the reducer's command guard (a state machine, not a reader);
    // frozen migration DDL; `startedFrom` (was a routine started since, active included) and `appDates` (dates of
    // workouts logged in the app, active included), which deliberately count more than history.
    const allowed: Record<string, RegExp> = {
      'packages/domain/src/session/deletion.ts': /./,
      'packages/domain/src/session/reducer.ts': /./,
      'packages/persistence/src/coach.ts': /status IN \('active', 'finished'\)/,
      // `revertJob` is a writer: Undo this import hides finished and deleted workouts alike (§6.2).
    'packages/persistence/src/imports.ts': /status IN \('active', 'finished'\)|status IN \('finished', 'deleted'\)/,
    };
    const pattern = /status\s*(?:===|!==|=|<>)\s*'finished'|status\s+IN\s*\([^)]*'finished'/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'schema' && name !== 'generated') walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const rel = relative(root, path);
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!pattern.test(line)) return;
            const allow = allowed[rel];
            if (allow?.test(line)) return;
            offenders.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
          });
      }
    };
    for (const d of dirs) walk(join(root, d));
    expect(offenders).toEqual([]);
  });
});

describe('Recently deleted and the purge (§2.5, §6.4)', () => {
  it('lists deleted workouts newest deletion first until the end of their 30 days, then never (DW20, DW21)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a], 'del-a', NOW);
    await del([b], 'del-b', z('2026-10-10T09:00:00.000Z'));
    expect((await store.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).map((x) => x.session.id)).toEqual([b.session.id, a.session.id]);
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(2);
    // Day 31 for `a`: gone from the list even though the purge hasn't run.
    expect((await store.repos.sessions.listRecentlyDeleted(OWNER, DAY_31.utc)).map((x) => x.session.id)).toEqual([b.session.id]);
  });

  it('the purge removes every row of a purge-due workout and leaves only a tombstone with no training values (DW21)', async () => {
    const a = latest();
    const keep = history[0] as SessionAggregate;
    await del([a], 'del-a', NOW);
    await del([keep], 'del-keep', z('2026-10-20T09:00:00.000Z'));
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-early', at: NOW })).toEqual({ ok: true, duplicate: false, purged: [] });
    const out = await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-1', at: DAY_31 });
    expect(out).toEqual({ ok: true, duplicate: false, purged: [a.session.id] });
    expect(await store.repos.sessions.get(a.session.id)).toBeNull();
    expect(await store.repos.sessions.isPurged(a.session.id)).toBe(true);
    expect((await store.repos.sessions.get(keep.session.id))?.session.status).toBe('deleted');
    const left = await store.db.read(async (q) => {
      const n: Record<string, unknown> = {};
      for (const t of ['session_sets', 'session_exercises', 'set_audit', 'timing_audit', 'processed_operations', 'session_pauses', 'rest_timers', 'work_intervals']) {
        n[t] = (await q.getFirst<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE session_id = ?`, [a.session.id]))?.n;
      }
      n.tombstone = await q.getFirst('SELECT * FROM purged_sessions WHERE session_id = ?', [a.session.id]);
      return n;
    });
    expect(left).toEqual({
      session_sets: 0,
      session_exercises: 0,
      set_audit: 0,
      timing_audit: 0,
      processed_operations: 0,
      session_pauses: 0,
      rest_timers: 0,
      work_intervals: 0,
      tombstone: { session_id: a.session.id, owner_id: OWNER, deleted_at_utc: NOW.utc, purged_at_utc: DAY_31.utc, purge_op_id: 'purge-1', import_job_id: null },
    });
    // The same operation again changes nothing.
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-1', at: DAY_31 })).toEqual({ ok: true, duplicate: true, purged: [a.session.id] });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('Delete now purges named workouts at once; a workout that isn’t deleted is refused and nothing is purged (DW23)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a]);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'now-x', at: NOW, sessionIds: [a.session.id, b.session.id] })).toEqual({
      ok: false,
      error: { code: 'stale', sessionIds: [b.session.id] },
    });
    expect((await store.repos.sessions.get(a.session.id))?.session.status).toBe('deleted');
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'now-1', at: NOW, sessionIds: [a.session.id] })).toMatchObject({ ok: true, purged: [a.session.id] });
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version + 1 }], opId: 'r', at: NOW })).toMatchObject({
      ok: false,
      error: { code: 'stale' },
    });
  });

  it('the database still refuses every other delete: finished workouts, their rows, tombstones, and a purged ID written again', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    const tryRun = (sql: string, params: string[]) => store.db.write((tx) => tx.run(sql, params));
    await expect(tryRun('DELETE FROM session_sets WHERE session_id = ?', [b.session.id])).rejects.toThrow(/tombstoned/);
    await expect(tryRun('DELETE FROM sessions WHERE id = ?', [b.session.id])).rejects.toThrow(/never deleted/);
    // A tombstone can't be written for a workout that isn't deleted.
    await expect(tryRun("INSERT INTO purged_sessions VALUES (?, ?, 'x', 'x', 'op', NULL)", [b.session.id, OWNER])).rejects.toThrow(/only a deleted workout/);
    // A deleted workout without a tombstone still can't lose rows.
    await del([a]);
    await expect(tryRun('DELETE FROM set_audit WHERE session_id = ?', [a.session.id])).rejects.toThrow(/append-only/);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [a.session.id] });
    await expect(tryRun('DELETE FROM purged_sessions WHERE session_id = ?', [a.session.id])).rejects.toThrow(/append-only/);
    // A purged workout can't come back by being saved again.
    await expect(store.repos.sessions.save(a, null)).rejects.toThrow(/purged/);
  });
});

describe('imports (§6.2)', () => {
  const AT: ZonedTimestamp = { utc: '2026-10-09T10:00:00.000Z', tz: TZ };
  const CSV = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', '2026-10-01,Lat pulldown,Back,40,10,,,', '2026-10-03,Lat pulldown,Back,47.5,8,,,'].join('\n');

  async function importTwo(): Promise<{ job: ImportJob; sessions: SessionAggregate[] }> {
    for (const e of starterExercises(AT.utc)) await store.repos.exercises.save(e, null).catch(() => undefined);
    const candidates: MatchCandidate[] = starterExercises(AT.utc).map((e) => ({
      exerciseId: e.id,
      name: e.name,
      aliases: [],
      catalogueKey: e.catalogueKey ?? null,
      laterality: e.laterality,
      defaultLoadConvention: e.defaultLoadConvention,
      compatibleEquipment: e.compatibleEquipment,
      implements: null,
    }));
    const p = parseFitNotesCsv(CSV, '2026-10-09');
    if (!p.ok) throw new Error('not parsed');
    const a = analyseImport(p, { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg' }, DEFAULT_ANSWERS);
    const jobId = id(9001);
    const rows = planImportRows(p, a, { jobId, defaultUnit: 'kg' });
    const job: ImportJob = {
      id: jobId,
      ownerId: OWNER,
      version: 1,
      createdAtUtc: AT.utc,
      updatedAtUtc: AT.utc,
      source: 'fitnotes',
      fileName: 'FitNotes_Export_synthetic.csv',
      checksum: 'a'.repeat(64),
      variant: 'A1-kg',
      header: p.firstLine,
      timezone: TZ,
      startedAt: AT,
      operationId: 'commit-1',
      mappingVersion: 1,
      answers: DEFAULT_ANSWERS,
      counts: { rows: a.rowCount, workouts: a.counts.workouts, sets: a.counts.sets, exercises: a.counts.exercises, byResult: { imported: 2, skipped_cardio: 0, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: 0, unreadable: 0 } },
      dateRange: a.dateRange,
      status: 'committing',
      finishedAt: null,
      revert: null,
    };
    expect(await store.repos.imports.createJob(job, rows, { exercises: [], aliases: [], at: AT, newId: idGen(50_000) })).toMatchObject({ ok: true });
    const sessions: SessionAggregate[] = [];
    for (const date of ['2026-10-01', '2026-10-03']) {
      const s = buildImportedSession({ ownerId: OWNER, jobId, operationId: job.operationId, tz: TZ, gymId: null, importedAtUtc: AT.utc, date, rows });
      expect(await store.repos.imports.commitWorkout(jobId, s)).toBe('written');
      sessions.push(s);
    }
    const fin = await store.repos.imports.finishJob(jobId, 1, AT);
    if (!fin.ok) throw new Error('not finished');
    return { job: fin.job, sessions };
  }

  it('one imported workout deletes and restores with its import rows intact (DW24); counts read `· 1 deleted`', async () => {
    const { job, sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    const rowsBefore = await store.repos.imports.rows(job.id);
    expect(await store.repos.sessions.countImportedFinished(OWNER)).toBe(2);
    const out = await del([first]);
    expect(await store.repos.sessions.countImportedFinished(OWNER)).toBe(1);
    expect(await store.repos.imports.jobWorkoutCounts(job.id, NOW.utc)).toEqual({ finished: 1, deleted: 1 });
    expect(await store.repos.imports.rows(job.id)).toEqual(rowsBefore);
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: ref.sessionId, expectedVersion: ref.version }], opId: 'r', at: NOW })).ok).toBe(true);
    expect(await store.repos.imports.jobWorkoutCounts(job.id, NOW.utc)).toEqual({ finished: 2, deleted: 0 });
    expect(await store.repos.imports.rows(job.id)).toEqual(rowsBefore);
  });

  it('Undo this import reverts deleted workouts too, and they leave Recently deleted (DW25)', async () => {
    const { job, sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    await del([first]);
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(1);
    const undone = await store.repos.imports.revertJob(job.id, job.version, 'undo-import', NOW);
    expect(undone).toMatchObject({ ok: true, workouts: 2 });
    expect((await store.repos.sessions.get(first.session.id))?.session).toMatchObject({ status: 'reverted' });
    expect((await store.repos.sessions.get(first.session.id))?.session.deletion).toBeUndefined();
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(0);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('a deleted imported date still counts as imported; after the purge a re-import offers it as new (DW26)', async () => {
    const { sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    await del([first]);
    expect([...(await store.repos.imports.importedDates(OWNER)).keys()].sort()).toEqual(['2026-10-01', '2026-10-03']);
    expect([...(await store.repos.imports.deletedImportDates(OWNER))]).toEqual(['2026-10-01']);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: DAY_31 });
    expect([...(await store.repos.imports.importedDates(OWNER)).keys()]).toEqual(['2026-10-03']);
    expect([...(await store.repos.imports.deletedImportDates(OWNER))]).toEqual([]);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });
});

describe('exports and backups (§6.3, §6.5)', () => {
  it('My data leaves out deleted workouts, their rows and tombstones (DW18)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a, b]);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [b.session.id] });
    const mine = await exportDomain(store.db, 'your_data');
    const text = JSON.stringify(mine);
    expect(text).not.toContain(a.session.id);
    expect(text).not.toContain(b.session.id);
    expect(mine.tables.purged_sessions).toBeUndefined();
    expect(mine.tables.sessions).toHaveLength(history.length - 2);
  });

  it('a backup carries the deleted state and its dates; the restored workout is in Recently deleted, not history (DW27)', async () => {
    const { dir, cleanup } = tempDir();
    try {
      let n = 0;
      const manager = await DatabaseManager.open({ host: nodeDatabaseHost(dir), newName: () => `t-${String(++n)}.db` });
      const s = manager.store;
      await s.repos.profiles.save(profile(), null);
      for (const x of history) await s.repos.sessions.save(x, null);
      const [a, b] = history;
      if (!a || !b) throw new Error('fixture');
      expect((await s.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a)], opId: 'del-a', at: NOW })).ok).toBe(true);
      expect((await s.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(b)], opId: 'del-b', at: NOW })).ok).toBe(true);
      await s.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [b.session.id] });
      const made = await createBackup(s, { at: NOW, app: { name: 'GymSmarter', version: '0.1.0', build: null } });
      expect(made.counts).toMatchObject({ finishedWorkouts: history.length - 2, deletedWorkouts: 1 });

      // Restored into a fresh phone: the deleted workout is deleted, with its original clock; the purged one stays purged.
      const { dir: dir2, cleanup: cleanup2 } = tempDir();
      try {
        const phone = await DatabaseManager.open({ host: nodeDatabaseHost(dir2), newName: () => `p-${String(++n)}.db` });
        const restored = await phone.restore(made.text, z('2026-10-12T08:00:00.000Z'));
        expect(restored).toMatchObject({ ok: true, status: 'restored' });
        const r = phone.store.repos.sessions;
        expect((await r.get(a.session.id))?.session).toMatchObject({ status: 'deleted', deletion: { at: NOW, opId: 'del-a', purgeAfterUtc: purgeAfterUtc(NOW) } });
        expect((await r.listRecentlyDeleted(OWNER, '2026-10-12T08:00:00.000Z')).map((x) => x.session.id)).toEqual([a.session.id]);
        expect(await r.listRepeatableIds(OWNER, 100)).not.toContain(a.session.id);
        expect(await r.get(b.session.id)).toBeNull();
        expect(await r.isPurged(b.session.id)).toBe(true);
        // Past its 30 days at restore time: never shown, and the next purge removes it.
        expect(await r.listRecentlyDeleted(OWNER, DAY_31.utc)).toEqual([]);
        expect(await r.purgeDeleted({ ownerId: OWNER, opId: 'after-restore', at: DAY_31 })).toMatchObject({ purged: [a.session.id] });
        expect((await checkIntegrity(phone.store.db)).ok).toBe(true);
        await phone.close();
      } finally {
        cleanup2();
      }
      await manager.close();
    } finally {
      cleanup();
    }
  });
});

describe('time', () => {
  it('fixture sanity: the history ends before NOW', () => {
    expect(toMs(latest().session.startedAt.utc)).toBeLessThan(toMs(NOW.utc));
  });
});
