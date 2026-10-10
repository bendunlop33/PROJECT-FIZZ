import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyseImport,
  buildImportedSession,
  DEFAULT_ANSWERS,
  parseFitNotesCsv,
  planImportRows,
  rememberedAnswer,
  starterExercises,
  type MatchCandidate,
} from '@fizz/domain';
import { id, idGen, OWNER, profile, richFinishedSession } from '@fizz/domain/testing';
import type { Exercise, ExerciseAlias, ImportJob, ImportRow, ZonedTimestamp } from '@fizz/schemas';
import {
  checkIntegrity,
  createBackup,
  DatabaseManager,
  latestVersion,
  migrate,
  MIGRATIONS,
  openStore,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/** FitNotes import storage: job + rows in one write, resumable workouts, revert hides and keeps (DX7, checks 21–25). */
const TZ = 'Europe/London';
const AT: ZonedTimestamp = { utc: '2026-10-09T10:00:00.000Z', tz: TZ };
const LATER: ZonedTimestamp = { utc: '2026-10-09T11:00:00.000Z', tz: TZ };
const JOB = id(9001);
const OP = 'commit-1';
const CSV = [
  'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time',
  '2026-10-01,Lat pulldown,Back,40,10,,,',
  '2026-10-01,Lat pulldown,Back,45,8,,,',
  '2026-10-03,Lat pulldown,Back,47.5,8,,,',
  '2026-10-03,Treadmill,Cardio,,,5,km,0:25:00',
].join('\n');

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
const LAT = candidates.find((c) => c.name === 'Lat pulldown')?.exerciseId ?? '';

function planned(jobId = JOB): { job: ImportJob; rows: ImportRow[] } {
  const p = parseFitNotesCsv(CSV, '2026-10-09');
  if (!p.ok) throw new Error('not parsed');
  const ctx = { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set<string>(), importedDates: new Map(), defaultUnit: 'kg' as const };
  const a = analyseImport(p, ctx, DEFAULT_ANSWERS);
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
    operationId: OP,
    mappingVersion: 1,
    answers: DEFAULT_ANSWERS,
    counts: { rows: a.rowCount, workouts: a.counts.workouts, sets: a.counts.sets, exercises: a.counts.exercises, byResult: { imported: 3, skipped_cardio: 1, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: 0, unreadable: 0 } },
    dateRange: a.dateRange,
    status: 'committing',
    finishedAt: null,
    revert: null,
  };
  return { job, rows };
}

const sessionFor = (job: ImportJob, rows: readonly ImportRow[], date: string) =>
  buildImportedSession({ ownerId: OWNER, jobId: job.id, operationId: job.operationId, tz: TZ, gymId: null, importedAtUtc: job.startedAt.utc, date, rows });

async function importAll(store: Store): Promise<{ job: ImportJob; rows: ImportRow[] }> {
  const { job, rows } = planned();
  expect(await store.repos.imports.createJob(job, rows, { exercises: [], aliases: [{ name: 'Lat pulldown', nameKey: 'lat pulldown', target: { kind: 'exercise', exerciseId: LAT } }], at: AT, newId: idGen(50_000) })).toEqual({ ok: true, duplicate: false });
  for (const date of ['2026-10-01', '2026-10-03']) expect(await store.repos.imports.commitWorkout(job.id, sessionFor(job, rows, date))).toBe('written');
  return { job, rows };
}

let store: Store;
beforeEach(async () => {
  store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  for (const e of starterExercises(AT.utc)) await store.repos.exercises.save(e, null);
});
afterEach(async () => {
  await store.close();
});

describe('import jobs and rows', () => {
  it('writes the job, every source row and the remembered names in one go; the same call again is a duplicate', async () => {
    const { job, rows } = planned();
    const extras = { exercises: [], aliases: [{ name: 'Lat pulldown', nameKey: 'lat pulldown', target: { kind: 'exercise' as const, exerciseId: LAT } }], at: AT, newId: idGen(50_000) };
    expect(await store.repos.imports.createJob(job, rows, extras)).toEqual({ ok: true, duplicate: false });
    expect(await store.repos.imports.createJob(job, rows, extras)).toEqual({ ok: true, duplicate: true });
    expect(await store.repos.imports.createJob({ ...job, operationId: 'other' }, rows, extras)).toEqual({ ok: false, error: 'conflict' });
    expect((await store.repos.imports.rows(job.id)).map((r) => [r.row, r.result])).toEqual([
      [2, 'imported'],
      [3, 'imported'],
      [4, 'imported'],
      [5, 'skipped_cardio'],
    ]);
    expect((await store.repos.imports.aliases(OWNER)).map((a) => [a.nameKey, a.target])).toEqual([['lat pulldown', { kind: 'exercise', exerciseId: LAT }]]);
    // One unfinished import at a time.
    const second = planned(id(9002));
    expect(await store.repos.imports.createJob({ ...second.job, operationId: 'commit-2' }, second.rows, { ...extras, newId: idGen(60_000) })).toEqual({ ok: false, error: 'another_import_running' });
  });

  it('remembers each import’s answer for a name (its exercise and dumbbell answer), versioned; what an undone import taught can be ignored (review r4 S2, r5 S2)', async () => {
    const ROW = candidates.find((c) => c.name === 'One-arm dumbbell row')?.exerciseId ?? '';
    const target = { kind: 'exercise' as const, exerciseId: ROW };
    const alias = () => store.repos.imports.aliases(OWNER).then((list) => list.find((a) => a.nameKey === 'one arm db row'));
    // One import after another: each finishes before the next starts (one unfinished import at a time).
    const commit = async (
      n: number,
      aliases: { name: string; nameKey: string; target: typeof target; perHand?: 'one' | 'each' | 'both' | null; total?: { reading: 'total' | 'plates_only'; bar?: 'barbell' | 'ez_bar' | 'trap_bar' } | null }[],
    ) => {
      const { job, rows } = planned(id(9100 + n));
      const extras = { exercises: [], aliases, at: AT, newId: idGen(70_000 + n * 100) };
      expect(await store.repos.imports.createJob({ ...job, operationId: `commit-${String(n)}` }, rows, extras)).toMatchObject({ ok: true, duplicate: false });
      // The same commit again (a retry) adds nothing.
      expect(await store.repos.imports.createJob({ ...job, operationId: `commit-${String(n)}` }, rows, extras)).toMatchObject({ ok: true, duplicate: true });
      expect(await store.repos.imports.finishJob(job.id, 1, LATER)).toMatchObject({ ok: true });
      return job.id;
    };
    const first = await commit(1, [{ name: 'One Arm DB Row', nameKey: 'one arm db row', target, perHand: 'one' }]);
    expect(await alias()).toMatchObject({ target, perHand: 'one', version: 1, jobId: first, uses: [{ jobId: first, target, perHand: 'one' }] });
    // A newer import that uses the name but says nothing about its dumbbells: its use is recorded; the answer is kept.
    const second = await commit(2, [{ name: 'One Arm DB Row', nameKey: 'one arm db row', target }]);
    expect(await alias()).toMatchObject({ perHand: 'one', version: 2, jobId: second });
    // A different answer.
    const third = await commit(3, [{ name: 'One Arm DB Row', nameKey: 'one arm db row', target, perHand: 'both' }]);
    expect(await alias()).toMatchObject({ perHand: 'both', version: 3, jobId: third });
    // Cleared: the name is still remembered, the dumbbell answer isn't.
    const fourth = await commit(4, [{ name: 'One Arm DB Row', nameKey: 'one arm db row', target, perHand: null }]);
    const cleared = await alias();
    expect(cleared).toMatchObject({ target, version: 4 });
    expect(cleared?.perHand).toBeUndefined();
    // Every import's use is kept, oldest first, so a reader can leave out an undone import's (`rememberedAnswer`).
    expect(cleared?.uses).toEqual([
      { jobId: first, target, perHand: 'one' },
      { jobId: second, target },
      { jobId: third, target, perHand: 'both' },
      { jobId: fourth, target, perHand: null },
    ]);
    expect(rememberedAnswer(cleared as ExerciseAlias, new Set([fourth]))).toEqual({ target, perHand: 'both', total: null });
    expect(rememberedAnswer(cleared as ExerciseAlias, new Set([third, fourth]))).toEqual({ target, perHand: 'one', total: null });
    // A barbell answer with the bar Ben chose is kept with the use the same way (PM decision after review r7).
    const fifth = await commit(5, [{ name: 'One Arm DB Row', nameKey: 'one arm db row', target, total: { reading: 'plates_only', bar: 'trap_bar' } }]);
    const withTotal = await alias();
    expect(withTotal?.uses?.at(-1)).toEqual({ jobId: fifth, target, total: { reading: 'plates_only', bar: 'trap_bar' } });
    expect(rememberedAnswer(withTotal as ExerciseAlias, new Set())).toEqual({ target, perHand: null, total: { reading: 'plates_only', bar: 'trap_bar' } });
    expect(rememberedAnswer(withTotal as ExerciseAlias, new Set([fifth]))?.total).toBeNull();
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('an import never changes an exercise that is already stored, whatever it says (review r6 B1)', async () => {
    const custom = (equipment: 'dumbbells' | 'barbell', at: string): Exercise => ({
      id: id(8800),
      ownerId: OWNER,
      source: 'custom',
      name: 'Zottman Curl',
      movementPattern: 'other',
      primaryMuscles: [],
      catalogueKey: null,
      measurement: 'reps',
      laterality: 'bilateral',
      compatibleEquipment: [equipment],
      defaultLoadConvention: equipment === 'dumbbells' ? 'per_hand' : 'total',
      version: 1,
      createdAtUtc: at,
      updatedAtUtc: at,
    });
    const commit = async (n: number, e: Exercise) => {
      const { job, rows } = planned(id(9200 + n));
      expect(await store.repos.imports.createJob({ ...job, operationId: `commit-${String(n)}` }, rows, { exercises: [e], aliases: [], at: AT, newId: idGen(80_000 + n * 100) })).toMatchObject({ ok: true });
      expect(await store.repos.imports.finishJob(job.id, 1, LATER)).toMatchObject({ ok: true });
    };
    await commit(1, custom('dumbbells', AT.utc));
    // The same answer again changes nothing.
    await commit(2, custom('dumbbells', LATER.utc));
    expect(await store.repos.exercises.get(id(8800))).toMatchObject({ version: 1, defaultLoadConvention: 'per_hand' });
    // Other equipment under the same ID (never sent by the importer, which gives each equipment its own ID): still unchanged.
    await commit(3, custom('barbell', LATER.utc));
    expect(await store.repos.exercises.get(id(8800))).toMatchObject({ version: 1, compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', updatedAtUtc: AT.utc });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('source rows are append-only at the database level', async () => {
    const { job } = await importAll(store);
    await expect(store.db.write((tx) => tx.run("UPDATE import_rows SET result = 'unreadable' WHERE job_id = ?", [job.id]))).rejects.toThrow('append-only');
    await expect(store.db.write((tx) => tx.run('DELETE FROM import_rows WHERE job_id = ?', [job.id]))).rejects.toThrow('append-only');
    await expect(store.db.write((tx) => tx.run('DELETE FROM import_jobs WHERE id = ?', [job.id]))).rejects.toThrow('never deleted');
  });

  it('writes each workout once (resumable batches: a retry is a duplicate), finished and date-only', async () => {
    const { job, rows } = await importAll(store);
    expect(await store.repos.imports.commitWorkout(job.id, sessionFor(job, rows, '2026-10-01'))).toBe('duplicate');
    expect(await store.repos.imports.writtenDates(job.id)).toEqual(new Set(['2026-10-01', '2026-10-03']));
    const history = await store.listExerciseHistory(OWNER, LAT);
    expect(history.map((h) => [h.performedAtUtc, h.sets.map((s) => s.load?.value)])).toEqual([
      ['2026-10-03T11:00:00.000Z', [47.5]],
      ['2026-10-01T11:00:00.000Z', [40, 45]],
    ]);
    const stored = await store.repos.sessions.get(sessionFor(job, rows, '2026-10-01').session.id);
    expect(stored?.session).toMatchObject({ status: 'finished', source: 'import', importJobId: job.id, localDate: '2026-10-01', gymId: null, endedAt: null });
    expect(await store.countRecords()).toMatchObject({ finishedWorkouts: 2, loggedSets: 3 });
    const done = await store.repos.imports.finishJob(job.id, 1, LATER);
    expect(done).toMatchObject({ ok: true, duplicate: false, job: { status: 'committed', version: 2, finishedAt: LATER } });
    expect(await store.repos.imports.finishJob(job.id, 1, LATER)).toMatchObject({ ok: true, duplicate: true });
  });

  it('shows where each imported set came from (check 24)', async () => {
    const { job, rows } = await importAll(store);
    const setId = rows[1]?.setId ?? '';
    expect(await store.repos.imports.provenance(setId)).toMatchObject({
      job: { fileName: 'FitNotes_Export_synthetic.csv' },
      row: { row: 3, cells: ['2026-10-01', 'Lat pulldown', 'Back', '45', '8', '', '', ''], imported: { load: { value: 45, unit: 'kg', convention: 'stack' } } },
    });
    expect(await store.repos.imports.provenance(id(1234))).toBeNull();
    expect((await store.repos.imports.importedDates(OWNER)).get('2026-10-01')).toEqual({ jobId: job.id, fileName: job.fileName, startedAtUtc: AT.utc, tz: TZ });
  });

  it('imported workouts are history, never Repeat candidates, and are counted as left out (review r2 B1)', async () => {
    await importAll(store);
    expect(await store.repos.sessions.listRepeatableIds(OWNER, 10)).toEqual([]);
    expect(await store.repos.sessions.countImportedFinished(OWNER)).toBe(2);
    const history = await store.listExerciseHistory(OWNER, LAT);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => h.imported && h.gymId === null && h.equipmentId === null)).toBe(true);
  });

  it('Undo import hides every workout everywhere, deletes nothing, and is versioned and idempotent (DX7, check 25)', async () => {
    const { job, rows } = await importAll(store);
    const before = await store.db.read(async (q) => ({
      sessions: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM sessions'))?.n,
      sets: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM session_sets'))?.n,
      rows: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM import_rows'))?.n,
    }));
    expect(await store.repos.imports.revertJob(job.id, 7, 'undo-1', LATER)).toEqual({ ok: false, error: 'stale' });
    const undo = await store.repos.imports.revertJob(job.id, 1, 'undo-1', LATER);
    expect(undo).toMatchObject({ ok: true, duplicate: false, workouts: 2, job: { status: 'reverted', version: 2, revert: { at: LATER, opId: 'undo-1', workouts: 2 } } });
    expect(await store.repos.imports.revertJob(job.id, 1, 'undo-1', LATER)).toMatchObject({ ok: true, duplicate: true, workouts: 2 });
    expect(await store.repos.imports.revertJob(job.id, 2, 'undo-2', LATER)).toEqual({ ok: false, error: 'wrong_status' });

    expect(await store.listExerciseHistory(OWNER, LAT)).toEqual([]);
    expect(await store.countRecords()).toMatchObject({ finishedWorkouts: 0, loggedSets: 0 });
    expect(await store.repos.sessions.listRepeatableIds(OWNER, 10)).toEqual([]);
    expect(await store.repos.sessions.countImportedFinished(OWNER)).toBe(0);
    expect(await store.repos.sessions.latestFinished(OWNER)).toBeNull();
    const after = await store.db.read(async (q) => ({
      sessions: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM sessions'))?.n,
      sets: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM session_sets'))?.n,
      rows: (await q.getFirst<{ n: number }>('SELECT count(*) AS n FROM import_rows'))?.n,
    }));
    expect(after).toEqual(before);
    const hidden = await store.repos.sessions.get(sessionFor(job, rows, '2026-10-01').session.id);
    expect(hidden?.session).toMatchObject({ status: 'reverted', version: 2 });
    expect(hidden?.revision).toBe(2);
    // A copy loaded before the undo can't be saved over it.
    const stale = sessionFor(job, rows, '2026-10-03');
    expect(await store.repos.sessions.save(stale, stale.revision)).toMatchObject({ ok: false, error: 'conflict' });
    // An undone import gets no more workouts, and its dates no longer count as imported.
    expect(await store.repos.imports.commitWorkout(job.id, sessionFor(job, rows, '2026-10-03'))).toBe('job_not_committing');
    expect((await store.repos.imports.importedDates(OWNER)).size).toBe(0);
  });

  it('the database refuses a workout logged in the app with no gym, or a reverted one', async () => {
    const own = richFinishedSession();
    expect(await store.repos.sessions.save(own, null)).toMatchObject({ ok: true });
    await expect(store.db.write((tx) => tx.run("UPDATE sessions SET status = 'reverted' WHERE id = ?", [own.session.id]))).rejects.toThrow(/CHECK/);
    await expect(store.db.write((tx) => tx.run('UPDATE sessions SET gym_id = NULL WHERE id = ?', [own.session.id]))).rejects.toThrow(/CHECK/);
    expect((await store.repos.imports.appDates(OWNER)).size).toBe(1);
  });

  it('integrity checks every import record and reports a damaged row', async () => {
    await importAll(store);
    const ok = await checkIntegrity(store.db);
    expect(ok.ok).toBe(true);
    expect(ok.checked).toMatchObject({ import_jobs: 1, import_rows: 4, exercise_aliases: 1 });
    await store.db.write(async (tx) => {
      await tx.exec('DROP TRIGGER import_rows_no_update');
      await tx.run("UPDATE import_rows SET cells = '[1]' WHERE row_number = 2");
    });
    const bad = await checkIntegrity(store.db);
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => [i.table, i.id])).toEqual([['import_rows', `${JOB}#2`]]);
  });
});

describe('schema 3 migration (sessions rebuilt)', () => {
  it('carries every workout and its children forward from schema 2, with foreign keys intact', async () => {
    const driver = memoryDriver();
    await migrate(driver, MIGRATIONS, 2);
    const v2 = await openStore(driver, { migrations: MIGRATIONS.slice(0, 2) });
    // Write at schema 2 through raw SQL (the repositories speak schema 3).
    const s = richFinishedSession().session;
    await v2.db.write(async (tx) => {
      await tx.run(
        `INSERT INTO sessions (id, owner_id, routine_id, routine_name, gym_id, start_operation_id, status, source, started_at_utc, started_at_tz,
           ended_at_utc, ended_at_tz, version, revision, active_set_id, equipment_snapshot, paused_at_utc, last_activity_at_utc, check_in, check_in_id)
         VALUES (?, ?, NULL, NULL, ?, 'start-1', 'finished', 'manual', ?, ?, ?, ?, 3, 9, NULL, '[]', NULL, ?, NULL, NULL)`,
        [s.id, s.ownerId, s.gymId, s.startedAt.utc, s.startedAt.tz, s.startedAt.utc, s.startedAt.tz, s.startedAt.utc],
      );
      await tx.run('INSERT INTO session_pauses (session_id, ordinal, start_utc, end_utc) VALUES (?, 0, ?, ?)', [s.id, s.startedAt.utc, s.startedAt.utc]);
    });
    const report = await migrate(driver);
    expect(report).toMatchObject({ from: 2, to: latestVersion(), applied: [3, 4] });
    expect(await driver.getAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(await driver.getFirst('SELECT id, status, gym_id, revision, import_job_id, local_date FROM sessions')).toEqual({ id: s.id, status: 'finished', gym_id: s.gymId, revision: 9, import_job_id: null, local_date: null });
    expect(await driver.getFirst('SELECT count(*) AS n FROM session_pauses')).toEqual({ n: 1 });
    await expect(driver.run('DELETE FROM sessions')).rejects.toThrow('never deleted');
    await driver.close();
  });
});

describe('backups carry import data (check 24)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('restores the job, every source row and the hidden state', async () => {
    const { job } = await importAll(store);
    await store.repos.imports.revertJob(job.id, 1, 'undo-1', LATER);
    const backup = await createBackup(store, { at: LATER, app: { name: 'test', version: '0', build: null } });
    expect(backup.integrity.ok).toBe(true);
    let n = 0;
    const manager = await DatabaseManager.open({ host: nodeDatabaseHost(dir), newName: () => `db-${String(++n)}.db` });
    const out = await manager.restore(backup.text, LATER);
    expect(out).toMatchObject({ ok: true, status: 'restored' });
    expect((await manager.store.repos.imports.rows(job.id)).length).toBe(4);
    expect(await manager.store.repos.imports.getJob(job.id)).toMatchObject({ status: 'reverted' });
    expect(await manager.store.countRecords()).toMatchObject({ finishedWorkouts: 0 });
    await manager.close();
  });
});
