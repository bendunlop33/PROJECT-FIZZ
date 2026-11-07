import { expect } from 'vitest';
import { analyseImport, buildImportedSession, DEFAULT_ANSWERS, parseFitNotesCsv, planImportRows, starterExercises, type MatchCandidate } from '@fizz/domain';
import { id, idGen, OWNER } from '@fizz/domain/testing';
import type { ImportJob, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import type { Store } from '../src/index';

/**
 * A FitNotes import committed through the store, one workout per date
 * (delete-workouts tests). `jobNo` keeps the IDs of several imports apart.
 */
export async function importWorkouts(
  store: Store,
  opts: { at: ZonedTimestamp; dates?: readonly string[]; jobNo?: number },
): Promise<{ job: ImportJob; sessions: SessionAggregate[] }> {
  const { at: AT } = opts;
  const dates = opts.dates ?? ['2026-10-01', '2026-10-03'];
  const jobNo = opts.jobNo ?? 0;
  const csv = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', ...dates.map((d, i) => `${d},Lat pulldown,Back,${String(40 + i * 2.5)},10,,,`)].join('\n');
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
  const p = parseFitNotesCsv(csv, '2026-10-09');
  if (!p.ok) throw new Error('not parsed');
  const a = analyseImport(p, { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg' }, DEFAULT_ANSWERS);
  const jobId = id(9001 + jobNo);
  const rows = planImportRows(p, a, { jobId, defaultUnit: 'kg' });
  const job: ImportJob = {
    id: jobId,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: AT.utc,
    updatedAtUtc: AT.utc,
    source: 'fitnotes',
    fileName: 'FitNotes_Export_synthetic.csv',
    checksum: ('abcdef0123456789'[jobNo % 16] ?? 'a').repeat(64),
    variant: 'A1-kg',
    header: p.firstLine,
    timezone: AT.tz,
    startedAt: AT,
    operationId: `commit-${String(jobNo)}`,
    mappingVersion: 1,
    answers: DEFAULT_ANSWERS,
    counts: {
      rows: a.rowCount,
      workouts: a.counts.workouts,
      sets: a.counts.sets,
      exercises: a.counts.exercises,
      byResult: { imported: dates.length, skipped_cardio: 0, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: 0, unreadable: 0 },
    },
    dateRange: a.dateRange,
    status: 'committing',
    finishedAt: null,
    revert: null,
  };
  expect(await store.repos.imports.createJob(job, rows, { exercises: [], aliases: [], at: AT, newId: idGen(50_000 + jobNo * 1000) })).toMatchObject({ ok: true });
  const sessions: SessionAggregate[] = [];
  for (const date of dates) {
    const s = buildImportedSession({ ownerId: OWNER, jobId, operationId: job.operationId, tz: AT.tz, gymId: null, importedAtUtc: AT.utc, date, rows });
    expect(await store.repos.imports.commitWorkout(jobId, s)).toBe('written');
    sessions.push(s);
  }
  const fin = await store.repos.imports.finishJob(jobId, 1, AT);
  if (!fin.ok) throw new Error('not finished');
  return { job: fin.job, sessions };
}
