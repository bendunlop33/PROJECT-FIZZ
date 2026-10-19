import { afterEach, describe, expect, it } from 'vitest';
import { analyseImport, applyImportSpec, buildImportedSession, DEFAULT_ANSWERS, fingerprintOf, planImportRows, starterExercises, type MatchCandidate } from '@fizz/domain';
import { id, idGen, OWNER, profile } from '@fizz/domain/testing';
import { EMPTY_LAYOUT_ANSWERS, type ImportJob, type ImportLayoutRequest, type ImportProfile, type ZonedTimestamp } from '@fizz/schemas';
import { checkIntegrity, createBackup, filterDomain, latestVersion, layoutInUse, migrate, MIGRATIONS, openStore, parseBackup, YOUR_DATA_TABLES, type Store } from '../src/index';
import { answerAll, OPTS, specOf, tableOf } from '../../domain/test/layout-fixtures';
import { memoryDriver } from './helpers';

/** Saved import layouts, layout requests and migration 15 (data-import-export §9.6.4; ADR 0026 §5–§7; checks 53, 54, 57). */
const TZ = 'Europe/London';
const AT: ZonedTimestamp = { utc: '2026-10-12T10:00:00.000Z', tz: TZ };
const LATER: ZonedTimestamp = { utc: '2026-10-12T11:00:00.000Z', tz: TZ };
const JOB = id(9101);
const PROFILE = id(9201);
const HASH = 'b'.repeat(64);

const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
async function fresh(): Promise<Store> {
  const s = await openStore(memoryDriver());
  stores.push(s);
  await s.repos.profiles.save(profile(), null);
  for (const e of starterExercises(AT.utc)) await s.repos.exercises.save(e, null);
  return s;
}

const candidates: MatchCandidate[] = starterExercises(AT.utc).map((e) => ({
  exerciseId: e.id,
  name: e.name,
  aliases: [],
  catalogueKey: e.catalogueKey ?? null,
  laterality: e.laterality,
  defaultLoadConvention: e.defaultLoadConvention,
  compatibleEquipment: e.compatibleEquipment,
  implements: e.defaultLoadConvention === 'per_hand' ? 2 : null,
}));

/** The synthetic `3x8` spreadsheet, planned as a layout import (parts 0–2 per row). */
function layoutPlan() {
  const table = tableOf('spreadsheet-sets-x-reps.synthetic.csv');
  const spec = specOf('spreadsheet-sets-x-reps.spec.json');
  const { answers } = answerAll('spreadsheet-sets-x-reps', { unit: 'kg', notation: { '3': 'sets_x_reps' } });
  const rows = applyImportSpec(spec, answers, table, OPTS).rows;
  const ctx = { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set<string>(), importedDates: new Map(), defaultUnit: 'kg' as const };
  const first = analyseImport({ variant: null, rows }, ctx, DEFAULT_ANSWERS);
  const names = Object.fromEntries(first.names.map((n) => [n.key, n.match.exerciseId ? { kind: 'exercise' as const, exerciseId: n.match.exerciseId } : { kind: 'skip' as const }]));
  const a = analyseImport({ variant: null, rows }, ctx, { ...DEFAULT_ANSWERS, names, total: 'total' });
  if (!a.ready) throw new Error('not ready');
  return { table, spec, answers, rows, analysis: a, planned: planImportRows({ rows }, a, { jobId: JOB, defaultUnit: 'kg' }) };
}

function layoutJob(over: Partial<ImportJob> = {}): ImportJob {
  const { analysis: a } = layoutPlan();
  return {
    id: JOB,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: AT.utc,
    updatedAtUtc: AT.utc,
    source: 'layout',
    fileName: 'Training log.csv',
    checksum: 'c'.repeat(64),
    variant: null,
    layout: { kind: 'coach', profileId: null, profileName: null, layoutVersion: 3, specHash: HASH, sampleHash: HASH, instructionsHash: HASH, route: 'chatgpt_plan', model: 'gpt-test', requestsSent: 1, charsSent: 1200, savedProfileId: PROFILE, unit: 'kg', unitSource: 'answer' },
    header: 'Date,Exercise,Weight,Sets x Reps,Notes',
    timezone: TZ,
    startedAt: AT,
    operationId: 'commit-layout-1',
    mappingVersion: 4,
    answers: DEFAULT_ANSWERS,
    counts: { rows: a.rowCount, workouts: a.counts.workouts, sets: a.counts.byResult.imported, exercises: a.counts.exercises, byResult: { imported: a.counts.byResult.imported, skipped_cardio: 0, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: a.counts.byResult.skipped_exercise, unreadable: 0, skipped_value_to_check: 0, skipped_not_a_set: 0, not_read: 0 } },
    dateRange: a.dateRange,
    status: 'committing',
    finishedAt: null,
    revert: null,
    ...over,
  };
}

function savedProfile(over: Partial<ImportProfile> = {}): ImportProfile {
  const { table, spec, answers } = layoutPlan();
  return {
    id: PROFILE,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: AT.utc,
    updatedAtUtc: AT.utc,
    name: 'Training log',
    kind: 'table',
    fingerprint: fingerprintOf(table),
    spec,
    answers,
    seen: { markers: [], negativeNames: [] },
    uses: [JOB],
    provenance: { proposedBy: 'coach', route: 'chatgpt_plan', model: 'gpt-test', specHash: HASH, createdAt: AT, confirmedAt: AT },
    deletedAt: null,
    ...over,
  };
}

function request(over: Partial<ImportLayoutRequest> = {}): ImportLayoutRequest {
  return {
    id: id(9301),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: AT.utc,
    updatedAtUtc: AT.utc,
    operationId: 'layout-op-1',
    sampleHash: HASH,
    fileHash: HASH,
    instructionsHash: HASH,
    sampleJson: null,
    route: 'chatgpt_plan',
    model: 'gpt-test',
    chars: 1200,
    state: 'sent',
    failure: null,
    unavailable: null,
    spec: null,
    reasons: [],
    sentAt: AT,
    finishedAt: null,
    closedAt: null,
    ...over,
  };
}

describe('migration 15 in place on a schema-14 database', () => {
  it('keeps every import row as part 0, takes parts and the new results, and keeps both append-only triggers', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 14);
    await db.run("INSERT INTO import_jobs (id, owner_id, status, checksum, version, updated_at_utc, data) VALUES ('j1', 'o', 'committed', 'x', 1, 't', '{}')");
    const row = (n: number, result: string) =>
      `INSERT INTO import_rows (job_id, row_number, line, local_date, exercise_name, cells, result, detail, session_id, set_id, imported) VALUES ('j1', ${String(n)}, ${String(n)}, '2026-10-01', 'Bench', '["a"]', '${result}', NULL, NULL, NULL, NULL)`;
    await db.run(row(2, 'unreadable'));
    await db.run(row(3, 'skipped_cardio'));
    await expect(db.run(row(4, 'skipped_not_a_set'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM import_rows ORDER BY row_number');
    expect(await migrate(db)).toEqual({ from: 14, to: 19, applied: [15, 16, 17, 18, 19] });
    expect(latestVersion()).toBe(19);
    const after = await db.getAll('SELECT * FROM import_rows ORDER BY row_number');
    expect(after).toEqual(before.map((r) => ({ ...r, part: 0, workout_key: null, start_local: null })));
    await db.run(row(4, 'skipped_not_a_set'));
    await db.run(row(5, 'skipped_value_to_check'));
    await db.run(row(6, 'not_read'));
    // One row, several parts.
    await db.run("INSERT INTO import_rows (job_id, row_number, part, line, local_date, workout_key, start_local, exercise_name, cells, result) VALUES ('j1', 7, 1, 7, '2026-10-01', '2026-10-01', '18:02', 'Bench', '[]', 'unreadable')");
    await expect(db.run("INSERT INTO import_rows (job_id, row_number, part, line, local_date, exercise_name, cells, result) VALUES ('j1', 7, 1, 7, NULL, 'x', '[]', 'unreadable')")).rejects.toThrow();
    await expect(db.run("INSERT INTO import_rows (job_id, row_number, part, line, start_local, exercise_name, cells, result) VALUES ('j1', 8, 0, 8, '6pm', 'x', '[]', 'unreadable')")).rejects.toThrow();
    await expect(db.run("UPDATE import_rows SET detail = 'x' WHERE row_number = 2")).rejects.toThrow(/append-only/);
    await expect(db.run('DELETE FROM import_rows WHERE row_number = 2')).rejects.toThrow(/append-only/);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE tbl_name = 'import_rows' AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name")).toEqual([
      { name: 'import_rows_date' },
      { name: 'import_rows_no_delete' },
      { name: 'import_rows_no_update' },
      { name: 'import_rows_session' },
      { name: 'import_rows_set' },
    ]);
    expect(await db.getAll('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});

describe('a layout import with Save layout on', () => {
  it('stores the job, every part and the layout in one write; parts read back in file order', async () => {
    const s = await fresh();
    const { planned } = layoutPlan();
    expect(await s.repos.imports.createJob(layoutJob(), planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000), profile: { record: savedProfile(), expectedVersion: null } })).toEqual({ ok: true, duplicate: false });
    expect(await s.repos.imports.rows(JOB)).toEqual(planned);
    expect((await s.repos.importProfiles.list(OWNER)).profiles.map((p) => p.name)).toEqual(['Training log']);
    const stored = await s.repos.imports.getJob(JOB);
    expect(stored?.layout?.savedProfileId).toBe(PROFILE);
  });

  it('a stale layout version refuses the whole write: no job, no rows (rule 5)', async () => {
    const s = await fresh();
    const { planned } = layoutPlan();
    await expect(s.repos.imports.createJob(layoutJob(), planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000), profile: { record: savedProfile({ version: 2 }), expectedVersion: 1 } })).rejects.toThrow(/saved layout changed/);
    expect(await s.repos.imports.getJob(JOB)).toBeNull();
    expect(await s.repos.imports.rows(JOB)).toEqual([]);
  });

  it('two workouts on one date are written and resumed by session (writtenSessions)', async () => {
    const s = await fresh();
    const { planned } = layoutPlan();
    await s.repos.imports.createJob(layoutJob(), planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000) });
    const sessions = [...new Set(planned.filter((r) => r.result === 'imported').map((r) => r.sessionId))];
    const first = planned.find((r) => r.sessionId === sessions[0]);
    const agg = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: 'commit-layout-1', tz: TZ, gymId: null, importedAtUtc: AT.utc, date: first?.localDate ?? '', workoutKey: first?.workoutKey ?? '', rows: planned });
    expect(await s.repos.imports.commitWorkout(JOB, agg)).toBe('written');
    expect(await s.repos.imports.commitWorkout(JOB, agg)).toBe('duplicate');
    expect(await s.repos.imports.writtenSessions(JOB)).toEqual(new Set([agg.session.id]));
    expect((await s.repos.imports.rowsOfSession(JOB, agg.session.id)).map((r) => [r.row, r.part])).toEqual(planned.filter((r) => r.sessionId === agg.session.id).map((r) => [r.row, r.part]));
  });
});

describe('saved layouts (AI12; checks 54, 57)', () => {
  it('in use only while one of its imports is in effect', () => {
    expect(layoutInUse(savedProfile(), new Set())).toBe(true);
    expect(layoutInUse(savedProfile(), new Set([JOB]))).toBe(false);
    expect(layoutInUse(savedProfile({ uses: [JOB, id(9102)] }), new Set([JOB]))).toBe(true);
    expect(layoutInUse(savedProfile({ deletedAt: LATER }), new Set())).toBe(false);
  });

  it('Delete layout is soft, with Undo; a stale version is refused', async () => {
    const s = await fresh();
    await s.repos.imports.createJob(layoutJob(), layoutPlan().planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000), profile: { record: savedProfile(), expectedVersion: null } });
    const del = await s.repos.importProfiles.setDeleted(PROFILE, 1, LATER);
    expect(del).toMatchObject({ ok: true, profile: { version: 2, deletedAt: LATER } });
    expect(await s.repos.importProfiles.setDeleted(PROFILE, 1, null)).toEqual({ ok: false, error: 'stale' });
    expect(await s.repos.importProfiles.setDeleted(PROFILE, 2, null)).toMatchObject({ ok: true, profile: { version: 3, deletedAt: null } });
    // The import it was used by is untouched.
    expect((await s.repos.imports.getJob(JOB))?.status).toBe('committing');
  });

  it('a damaged layout (a hand-edited backup) is never used, is listed as damaged, and doesn’t fail the integrity check', async () => {
    const s = await fresh();
    await s.repos.imports.createJob(layoutJob(), layoutPlan().planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000), profile: { record: savedProfile(), expectedVersion: null } });
    await s.db.write((tx) => tx.run("INSERT INTO import_profiles (id, owner_id, version, updated_at_utc, data) VALUES (?, ?, 1, 't', ?)", [id(9202), OWNER, JSON.stringify({ id: id(9202), name: 'Edited by hand', spec: { evil: true } })]));
    const listed = await s.repos.importProfiles.list(OWNER);
    expect(listed.profiles.map((p) => p.id)).toEqual([PROFILE]);
    expect(listed.damaged).toEqual([{ id: id(9202), name: 'Edited by hand' }]);
    expect(await s.repos.importProfiles.get(id(9202))).toBeNull();
    expect((await checkIntegrity(s.db)).ok).toBe(true);
    expect(await s.repos.importProfiles.removeDamaged(PROFILE)).toBe(false);
    expect(await s.repos.importProfiles.removeDamaged(id(9202))).toBe(true);
    expect((await s.repos.importProfiles.list(OWNER)).damaged).toEqual([]);
  });
});

describe('layout requests (§9.3.3, rule 5)', () => {
  it('one per operation ID: a repeat is refused, the stored result is read back', async () => {
    const s = await fresh();
    expect(await s.repos.importProfiles.saveRequest(request(), null)).toEqual({ ok: true });
    expect(await s.repos.importProfiles.saveRequest(request({ id: id(9302) }), null)).toEqual({ ok: false, error: 'duplicate' });
    expect(await s.repos.importProfiles.saveRequest({ ...request(), version: 2, state: 'proposed', spec: specOf('spreadsheet-sets-x-reps.spec.json'), finishedAt: LATER, updatedAtUtc: LATER.utc }, 1)).toEqual({ ok: true });
    expect(await s.repos.importProfiles.saveRequest({ ...request(), version: 2, state: 'failed' }, 1)).toEqual({ ok: false, error: 'stale' });
    expect((await s.repos.importProfiles.request(OWNER, 'layout-op-1'))?.state).toBe('proposed');
    expect((await s.repos.importProfiles.proposedFor(OWNER, HASH, HASH))?.operationId).toBe('layout-op-1');
    expect(await s.repos.importProfiles.proposedFor(OWNER, 'd'.repeat(64), HASH)).toBeNull();
    // Same sample, another file: not reused (review S1).
    expect(await s.repos.importProfiles.proposedFor(OWNER, HASH, 'e'.repeat(64))).toBeNull();
    // Closed (confirmed, cancelled or read again): never reused.
    const proposed = await s.repos.importProfiles.request(OWNER, 'layout-op-1');
    if (!proposed) throw new Error('request');
    expect(await s.repos.importProfiles.saveRequest({ ...proposed, version: 3, closedAt: LATER }, 2)).toEqual({ ok: true });
    expect(await s.repos.importProfiles.proposedFor(OWNER, HASH, HASH)).toBeNull();
  });

  it('a request stored before the file checksum and closing were kept reads with both null, and is never reused', async () => {
    const s = await fresh();
    const older: Record<string, unknown> = { ...request(), state: 'proposed', spec: specOf('spreadsheet-sets-x-reps.spec.json') };
    delete older.fileHash;
    delete older.closedAt;
    expect(await s.repos.importProfiles.saveRequest(older as unknown as ImportLayoutRequest, null)).toEqual({ ok: true });
    expect(await s.repos.importProfiles.request(OWNER, 'layout-op-1')).toMatchObject({ fileHash: null, closedAt: null });
    expect(await s.repos.importProfiles.proposedFor(OWNER, HASH, HASH)).toBeNull();
  });
});

describe('Your data (rule 10; check 57)', () => {
  it('layouts and requests are Your data: in the backup and its Your data section, never in Coaching knowledge only', async () => {
    expect(YOUR_DATA_TABLES).toContain('import_profiles');
    expect(YOUR_DATA_TABLES).toContain('import_layout_requests');
    const s = await fresh();
    await s.repos.imports.createJob(layoutJob(), layoutPlan().planned, { exercises: [], aliases: [], at: AT, newId: idGen(60_000), profile: { record: savedProfile(), expectedVersion: null } });
    await s.repos.importProfiles.saveRequest(request(), null);
    const made = await createBackup(s, { at: LATER, app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    const parsed = await parseBackup(made.text);
    if (!parsed.ok) throw new Error('backup');
    expect(parsed.file.tables.import_profiles).toHaveLength(1);
    expect(parsed.file.tables.import_layout_requests).toHaveLength(1);
    expect(parsed.file.tables.import_rows?.some((r) => r.part === 2)).toBe(true);
    const knowledge = filterDomain(parsed.file.tables, 'coaching_knowledge');
    expect(knowledge.import_profiles).toEqual([]);
    expect(knowledge.import_layout_requests).toEqual([]);
    const mine = filterDomain(parsed.file.tables, 'your_data');
    expect(mine.import_profiles).toHaveLength(1);
  });

  it('EMPTY answers are valid layout answers (a profile can be saved with them)', () => {
    expect(savedProfile({ answers: EMPTY_LAYOUT_ANSWERS }).answers.recordKind).toBeNull();
  });
});
