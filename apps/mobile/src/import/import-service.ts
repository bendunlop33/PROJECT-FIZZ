import { bundledCatalogue, toExerciseRow, type CatalogueEntry } from '@fizz/catalogue';
import {
  aliasesToSave,
  analyseImport,
  applyAnswerChange,
  buildImportedSession,
  catalogueExerciseId,
  conventionForKind,
  DEFAULT_ANSWERS,
  importResultsCsv,
  localDateOf,
  newExercisesToCreate,
  parseFitNotesCsv,
  planImportRows,
  searchCandidates,
  stableStringify,
  toMs,
  type AnswerChange,
  type FitNotesRow,
  type ImportAnalysis,
  type ImportContext,
  type MatchCandidate,
} from '@fizz/domain';
import { sha256Hex, type AliasToSave, type Store } from '@fizz/persistence';
import {
  ImportAnswersSchema,
  validate,
  type Exercise,
  type FitNotesVariant,
  type Gym,
  type ImportAnswers,
  type ImportJob,
  type ImportRow,
  type SessionAggregate,
  type UserProfile,
  type WeightUnit,
  type ZonedTimestamp,
} from '@fizz/schemas';

/**
 * FitNotes import (data-import-export.md §2.5, §3.4, §4.3). Orchestration
 * only: parsing, matching, the preview, the plan and the imported workouts
 * are pure domain functions (`@fizz/domain` import module); storage is
 * `@fizz/persistence` (`SqliteImports`). No React Native here, so the whole
 * flow runs on Linux against real SQLite files.
 *
 * - Nothing is saved until `commit`: the preview lives in memory.
 * - Unavailable while a workout is unfinished (DX4), and one unfinished
 *   import at a time.
 * - Every answer bumps `mappingVersion`; a commit with an older version, or
 *   against data that changed since the preview (a workout logged, another
 *   import), is refused and the preview rebuilt (rule 5).
 * - Commit: back up on this phone first, then the job and every source row
 *   in one transaction, then one workout per transaction, oldest first. The
 *   same job and operation IDs on a retry or after a force-close can't
 *   duplicate anything (check 23).
 * - `revert` hides the import's workouts and deletes nothing (DX7).
 * - The file is data, never instructions (rule 8). The coach and voice can't
 *   reach any of this (DX10).
 */

export interface ImportServiceDeps {
  store: () => Store;
  now: () => ZonedTimestamp;
  newId: () => string;
  profile: () => Promise<UserProfile | null>;
  activeWorkout: () => Promise<SessionAggregate | null>;
  /** On-phone backup around a commit; never throws. */
  backUpOnPhone: (reason: 'before_import' | 'after_import') => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Bundled catalogue entries; defaults to the shipped catalogue (read on first use, not at launch). */
  catalogue?: () => readonly CatalogueEntry[];
}

/** The unfinished workout that blocks import and undo (DX4). */
export interface ImportBlock {
  title: string;
  startedAtUtc: string;
  tz: string;
}

export interface ImportDraft {
  draftId: string;
  fileName: string;
  variant: FitNotesVariant;
  firstLine: string;
  mappingVersion: number;
  answers: ImportAnswers;
  analysis: ImportAnalysis;
  /** Zone the dates are read in (the phone's now). */
  tz: string;
  gyms: Pick<Gym, 'id' | 'name'>[];
}

export type OpenResult =
  | { kind: 'empty' | 'not_csv' | 'fitnotes_backup' | 'no_profile' }
  | { kind: 'body_tracker' | 'unknown_header'; firstLine: string }
  /** The same file came in before (and wasn't undone): nothing new to import (check 21). */
  | { kind: 'same_file'; job: ImportJob; written: number }
  | { kind: 'preview'; draft: ImportDraft };

export type AnswerResult =
  | { ok: true; draft: ImportDraft }
  | { ok: false; reason: 'stale'; draft: ImportDraft }
  | { ok: false; reason: 'invalid'; message: string; draft: ImportDraft }
  | { ok: false; reason: 'not_found' };

export interface CommitHooks {
  onProgress?: (written: number, total: number) => void;
  /** Checked between workouts (`Stop`). */
  shouldStop?: () => boolean;
}

export type WriteResult =
  | { ok: true; jobId: string; status: 'finished' | 'stopped'; written: number; total: number }
  | { ok: false; reason: 'undone'; jobId: string; written: number; total: number }
  /** A workout couldn't be saved; the ones before it are in, nothing was half-saved (§3.4). */
  | { ok: false; reason: 'write_failed'; jobId: string; written: number; total: number; date: string; message: string };

export type CommitResult =
  | WriteResult
  | { ok: false; reason: 'stale'; draft: ImportDraft }
  | { ok: false; reason: 'not_found' | 'not_ready' }
  | { ok: false; reason: 'workout_unfinished'; block: ImportBlock }
  | { ok: false; reason: 'another_import'; job: ImportJob }
  | { ok: false; reason: 'backup_failed'; message: string };

export type RevertResult =
  | { ok: true; job: ImportJob; workouts: number; duplicate: boolean }
  | { ok: false; reason: 'workout_unfinished'; block: ImportBlock }
  | { ok: false; reason: 'busy' | 'stale' | 'not_found' | 'already_undone' };

export type JobState = 'running' | 'paused' | 'finished' | 'undone';

export interface PastImport {
  job: ImportJob;
  /** Workouts written so far (any status). */
  written: number;
  total: number;
  state: JobState;
}

export interface ImportedSetProvenance {
  fileName: string;
  importedAt: ZonedTimestamp;
  variant: FitNotesVariant;
  row: ImportRow;
  header: string;
}

/** Catalogue and app exercises a name can map to (rule 10: the catalogue is Coaching knowledge, read-only here). */
export function buildCandidates(
  dbExercises: readonly Exercise[],
  entries: readonly CatalogueEntry[],
  ownerId: string,
  atUtc: string,
): { candidates: MatchCandidate[]; catalogueRows: Map<string, Exercise>; exercises: Map<string, Exercise> } {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const exercises = new Map<string, Exercise>();
  const catalogueRows = new Map<string, Exercise>();
  const candidates: MatchCandidate[] = [];
  const add = (e: Exercise, aliases: readonly string[]) => {
    exercises.set(e.id, e);
    candidates.push({
      exerciseId: e.id,
      name: e.name,
      aliases,
      catalogueKey: e.catalogueKey ?? null,
      laterality: e.laterality,
      defaultLoadConvention: e.defaultLoadConvention,
      compatibleEquipment: e.compatibleEquipment,
    });
  };
  for (const e of dbExercises) {
    if (e.measurement !== 'reps' || (e.ownerId !== null && e.ownerId !== ownerId)) continue;
    add(e, e.catalogueKey ? (byKey.get(e.catalogueKey)?.aliases ?? []) : []);
  }
  for (const entry of entries) {
    if (exercises.has(catalogueExerciseId(entry.key))) continue;
    const row = toExerciseRow(entry, atUtc);
    if (!row.ok || row.exercise.measurement !== 'reps') continue;
    catalogueRows.set(row.exercise.id, row.exercise);
    add(row.exercise, entry.aliases);
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name) || (a.exerciseId < b.exerciseId ? -1 : 1));
  return { candidates, catalogueRows, exercises };
}

interface Draft {
  id: string;
  ownerId: string;
  fileName: string;
  checksum: string;
  variant: FitNotesVariant;
  firstLine: string;
  rows: FitNotesRow[];
  tz: string;
  defaultUnit: WeightUnit;
  ctx: ImportContext;
  /** What the preview was checked against (rule 5). */
  ctxStamp: string;
  candidates: MatchCandidate[];
  catalogueRows: Map<string, Exercise>;
  answers: ImportAnswers;
  mappingVersion: number;
  analysis: ImportAnalysis;
}

export function createImportService(deps: ImportServiceDeps) {
  const drafts = new Map<string, Draft>();
  const running = new Set<string>();
  const repos = () => deps.store().repos;
  const entries = () => (deps.catalogue ? deps.catalogue() : bundledCatalogue().catalogue.entries);

  async function block(): Promise<ImportBlock | null> {
    const a = await deps.activeWorkout().catch(() => null);
    if (!a) return null;
    return { title: a.session.routineName ?? 'Workout', startedAtUtc: a.session.startedAt.utc, tz: a.session.startedAt.tz };
  }

  async function gymsOf(ownerId: string): Promise<Pick<Gym, 'id' | 'name'>[]> {
    return (await repos().gyms.listByOwner(ownerId)).filter((g) => g.archivedAtUtc === undefined).map((g) => ({ id: g.id, name: g.name }));
  }

  /** The data the preview depends on, re-read (exercise list, remembered names, dates in the app, earlier imports). */
  async function loadContext(ownerId: string, defaultUnit: WeightUnit, rows: readonly FitNotesRow[]) {
    const at = deps.now();
    const built = buildCandidates(await repos().exercises.list(), entries(), ownerId, at.utc);
    const aliases = new Map((await repos().imports.aliases(ownerId)).map((a) => [a.nameKey, a.target]));
    const appDates = await repos().imports.appDates(ownerId);
    const importedDates = await repos().imports.importedDates(ownerId);
    const ctx: ImportContext = { ownerId, candidates: built.candidates, aliases, appDates, importedDates, defaultUnit };
    const fileDates = new Set(rows.map((r) => r.date).filter((d): d is string => d !== null));
    const stamp = stableStringify({
      candidates: built.candidates.map((c) => [c.exerciseId, c.name, c.defaultLoadConvention]),
      aliases: [...aliases.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
      appDates: [...appDates].filter((d) => fileDates.has(d)).sort(),
      importedDates: [...importedDates.entries()].filter(([d]) => fileDates.has(d)).map(([d, e]) => [d, e.jobId]).sort(),
    });
    return { ctx, stamp, candidates: built.candidates, catalogueRows: built.catalogueRows };
  }

  async function view(d: Draft): Promise<ImportDraft> {
    return {
      draftId: d.id,
      fileName: d.fileName,
      variant: d.variant,
      firstLine: d.firstLine,
      mappingVersion: d.mappingVersion,
      answers: d.answers,
      analysis: d.analysis,
      tz: d.tz,
      gyms: await gymsOf(d.ownerId),
    };
  }

  async function writtenCount(jobId: string): Promise<number> {
    return (await repos().imports.writtenDates(jobId)).size;
  }

  function stateOf(job: ImportJob, written: number): JobState {
    if (job.status === 'reverted') return 'undone';
    if (job.status === 'committed') return 'finished';
    return running.has(job.id) ? 'running' : written >= job.counts.workouts ? 'finished' : 'paused';
  }

  /** Write the job's remaining workouts, oldest first, one transaction each. */
  async function writeWorkouts(job: ImportJob, hooks: CommitHooks): Promise<WriteResult> {
    running.add(job.id);
    try {
      const rows = await repos().imports.rows(job.id);
      const dates = [...new Set(rows.filter((r) => r.result === 'imported').map((r) => r.localDate ?? ''))].filter((d) => d !== '').sort();
      const total = dates.length;
      const done = await repos().imports.writtenDates(job.id);
      let written = dates.filter((d) => done.has(d)).length;
      hooks.onProgress?.(written, total);
      for (const date of dates) {
        if (done.has(date)) continue;
        if (hooks.shouldStop?.()) return { ok: true, jobId: job.id, status: 'stopped', written, total };
        const aggregate = buildImportedSession({
          ownerId: job.ownerId,
          jobId: job.id,
          operationId: job.operationId,
          tz: job.timezone,
          gymId: job.answers.gymId,
          importedAtUtc: job.startedAt.utc,
          date,
          rows,
        });
        let outcome: Awaited<ReturnType<Store['repos']['imports']['commitWorkout']>>;
        try {
          outcome = await repos().imports.commitWorkout(job.id, aggregate);
        } catch (e) {
          return { ok: false, reason: 'write_failed', jobId: job.id, written, total, date, message: e instanceof Error ? e.message : String(e) };
        }
        if (outcome === 'job_not_committing') return { ok: false, reason: 'undone', jobId: job.id, written, total };
        written += 1;
        hooks.onProgress?.(written, total);
      }
      const current = await repos().imports.getJob(job.id);
      if (current?.status === 'committing') {
        const fin = await repos().imports.finishJob(job.id, current.version, deps.now());
        if (fin.ok && !fin.duplicate) void deps.backUpOnPhone('after_import');
      }
      return { ok: true, jobId: job.id, status: 'finished', written, total };
    } finally {
      running.delete(job.id);
    }
  }

  const service = {
    /** Import and Undo import are unavailable while a workout is unfinished (DX4). */
    blockedBy: block,

    /** The import still being written, if any: `Import paused at 180 of 412` (§3.4). */
    async paused(): Promise<PastImport | null> {
      const p = await deps.profile();
      if (!p) return null;
      const job = await repos().imports.committingJob(p.id);
      if (!job) return null;
      const written = await writtenCount(job.id);
      return { job, written, total: job.counts.workouts, state: stateOf(job, written) };
    },

    /**
     * Read a chosen file and build its preview. Nothing is saved. The file
     * kind is decided from its content, never its name.
     */
    async open(file: { name: string; text: string }): Promise<OpenResult> {
      const p = await deps.profile();
      if (!p) return { kind: 'no_profile' };
      const at = deps.now();
      const today = localDateOf(toMs(at.utc), at.tz);
      const parsed = parseFitNotesCsv(file.text, today);
      if (!parsed.ok) {
        const f = parsed.file;
        switch (f.kind) {
          case 'empty':
          case 'not_csv':
          case 'fitnotes_backup':
            return { kind: f.kind };
          case 'body_tracker':
          case 'unknown_header':
            return { kind: f.kind, firstLine: f.firstLine };
        }
      }
      const checksum = sha256Hex(file.text);
      const earlier = (await repos().imports.listJobs(p.id)).find((j) => j.checksum === checksum && j.status !== 'reverted');
      if (earlier) return { kind: 'same_file', job: earlier, written: await writtenCount(earlier.id) };
      const loaded = await loadContext(p.id, p.preferredUnit, parsed.rows);
      const id = deps.newId();
      const d: Draft = {
        id,
        ownerId: p.id,
        fileName: file.name.slice(0, 255) || 'FitNotes export.csv',
        checksum,
        variant: parsed.variant,
        firstLine: parsed.firstLine,
        rows: parsed.rows,
        tz: at.tz,
        defaultUnit: p.preferredUnit,
        ctx: loaded.ctx,
        ctxStamp: loaded.stamp,
        candidates: loaded.candidates,
        catalogueRows: loaded.catalogueRows,
        answers: DEFAULT_ANSWERS,
        mappingVersion: 1,
        analysis: analyseImport(parsed, loaded.ctx, DEFAULT_ANSWERS),
      };
      drafts.set(id, d);
      return { kind: 'preview', draft: await view(d) };
    },

    async draft(draftId: string): Promise<ImportDraft | null> {
      const d = drafts.get(draftId);
      return d ? view(d) : null;
    },

    /** `Cancel`: the preview is dropped; nothing was saved. */
    discard(draftId: string): void {
      drafts.delete(draftId);
    },

    /** Change one answer. A change against an older preview is refused (rule 5). */
    async answer(draftId: string, expectedMappingVersion: number, change: AnswerChange): Promise<AnswerResult> {
      const d = drafts.get(draftId);
      if (!d) return { ok: false, reason: 'not_found' };
      if (d.mappingVersion !== expectedMappingVersion) return { ok: false, reason: 'stale', draft: await view(d) };
      const next = validate(ImportAnswersSchema, applyAnswerChange(d.answers, change));
      if (!next.ok) return { ok: false, reason: 'invalid', message: next.issues[0]?.message ?? 'That answer isn’t valid', draft: await view(d) };
      const picked = change.kind === 'name' && change.answer?.kind === 'exercise' ? change.answer.exerciseId : null;
      if (picked !== null && !d.candidates.some((c) => c.exerciseId === picked)) {
        return { ok: false, reason: 'invalid', message: 'That exercise isn’t in the list', draft: await view(d) };
      }
      if (change.kind === 'gym' && change.gymId !== null && !(await gymsOf(d.ownerId)).some((g) => g.id === change.gymId)) {
        return { ok: false, reason: 'invalid', message: 'That gym isn’t one of yours', draft: await view(d) };
      }
      d.answers = next.value;
      d.mappingVersion += 1;
      d.analysis = analyseImport({ variant: d.variant, rows: d.rows }, d.ctx, d.answers);
      return { ok: true, draft: await view(d) };
    },

    /** `Choose…`: exercises matching a query (names and catalogue names). */
    searchExercises(draftId: string, query: string): MatchCandidate[] {
      const d = drafts.get(draftId);
      return d ? searchCandidates(d.candidates, query) : [];
    },

    candidate(draftId: string, exerciseId: string): MatchCandidate | null {
      return drafts.get(draftId)?.candidates.find((c) => c.exerciseId === exerciseId) ?? null;
    },

    /** One date's rows with their fates (§2.5 step 3d), in file order. */
    previewRows(draftId: string, date: string): { row: FitNotesRow; fate: ImportAnalysis['fates'][number] }[] {
      const d = drafts.get(draftId);
      if (!d) return [];
      return d.rows.flatMap((row, i) => {
        const fate = d.analysis.fates[i];
        return row.date === date && fate ? [{ row, fate }] : [];
      });
    },

    /** Rows of the preview with a given result (`Will be skipped` lists). */
    previewRowsWith(draftId: string, results: readonly string[]): { row: FitNotesRow; fate: ImportAnalysis['fates'][number] }[] {
      const d = drafts.get(draftId);
      if (!d) return [];
      return d.rows.flatMap((row, i) => {
        const fate = d.analysis.fates[i];
        return fate && results.includes(fate.result) ? [{ row, fate }] : [];
      });
    },

    /**
     * `Import 412 workouts`. Refused while a workout is unfinished (DX4),
     * while another import is unfinished, for an older preview, or when the
     * data it was checked against changed (the preview is rebuilt; rule 5).
     * Backs up on this phone first. `operationId` is chosen once per tap.
     */
    async commit(draftId: string, mappingVersion: number, operationId: string, hooks: CommitHooks = {}): Promise<CommitResult> {
      const d = drafts.get(draftId);
      if (!d) {
        // A retry after the job was created resumes it (same operation ID).
        const job = await repos().imports.getJob(draftId);
        if (job?.status === 'committing' && job.operationId === operationId) return service.resume(job.id, hooks);
        return { ok: false, reason: 'not_found' };
      }
      if (d.mappingVersion !== mappingVersion) return { ok: false, reason: 'stale', draft: await view(d) };
      const b = await block();
      if (b) return { ok: false, reason: 'workout_unfinished', block: b };
      const other = await repos().imports.committingJob(d.ownerId);
      if (other) return { ok: false, reason: 'another_import', job: other };
      const fresh = await loadContext(d.ownerId, d.defaultUnit, d.rows);
      if (fresh.stamp !== d.ctxStamp) {
        d.ctx = fresh.ctx;
        d.ctxStamp = fresh.stamp;
        d.candidates = fresh.candidates;
        d.catalogueRows = fresh.catalogueRows;
        d.mappingVersion += 1;
        d.analysis = analyseImport({ variant: d.variant, rows: d.rows }, d.ctx, d.answers);
        return { ok: false, reason: 'stale', draft: await view(d) };
      }
      if (!d.analysis.ready) return { ok: false, reason: 'not_ready' };

      const backup = await deps.backUpOnPhone('before_import');
      if (!backup.ok) return { ok: false, reason: 'backup_failed', message: backup.error };

      const at = deps.now();
      const rows = planImportRows({ rows: d.rows }, d.analysis, { jobId: d.id, defaultUnit: d.defaultUnit });
      const a = d.analysis;
      const dates = rows.map((r) => r.localDate).filter((x): x is string => x !== null).sort();
      const job: ImportJob = {
        id: d.id,
        ownerId: d.ownerId,
        version: 1,
        createdAtUtc: at.utc,
        updatedAtUtc: at.utc,
        source: 'fitnotes',
        fileName: d.fileName,
        checksum: d.checksum,
        variant: d.variant,
        header: d.firstLine.slice(0, 4000),
        timezone: d.tz,
        startedAt: at,
        operationId,
        mappingVersion: d.mappingVersion,
        answers: d.answers,
        counts: {
          rows: a.rowCount,
          workouts: a.counts.workouts,
          sets: a.counts.byResult.imported,
          exercises: a.counts.exercises,
          byResult: {
            imported: a.counts.byResult.imported,
            skipped_cardio: a.counts.byResult.skipped_cardio,
            skipped_unsupported: a.counts.byResult.skipped_unsupported,
            skipped_duplicate: a.counts.byResult.skipped_duplicate,
            skipped_date_exists: a.counts.byResult.skipped_date_exists,
            skipped_exercise: a.counts.byResult.skipped_exercise,
            unreadable: a.counts.byResult.unreadable,
          },
        },
        dateRange: dates.length === 0 ? null : { first: dates[0] ?? '', last: dates.at(-1) ?? '' },
        status: 'committing',
        finishedAt: null,
        revert: null,
      };
      const used = new Set(rows.flatMap((r) => (r.imported ? [r.imported.exerciseId] : [])));
      const exercises: Exercise[] = [
        ...newExercisesToCreate(a).map(
          (n): Exercise => ({
            id: n.exerciseId,
            ownerId: d.ownerId,
            source: 'custom',
            name: n.name,
            movementPattern: 'other',
            primaryMuscles: [],
            catalogueKey: null,
            measurement: 'reps',
            laterality: n.laterality,
            compatibleEquipment: n.newKind === null ? [] : [n.newKind],
            defaultLoadConvention: n.newKind === null ? n.convention : conventionForKind(n.newKind),
            version: 1,
            createdAtUtc: at.utc,
            updatedAtUtc: at.utc,
          }),
        ),
        ...[...d.catalogueRows.values()].filter((e) => used.has(e.id)),
      ];
      const aliases: AliasToSave[] = aliasesToSave(a).map((x) => ({ name: x.name, nameKey: x.key, target: x.target }));
      const created = await repos().imports.createJob(job, rows, { exercises, aliases, at, newId: deps.newId });
      if (!created.ok) {
        const running = await repos().imports.committingJob(d.ownerId);
        if (created.error === 'another_import_running' && running) return { ok: false, reason: 'another_import', job: running };
        return { ok: false, reason: 'not_found' };
      }
      drafts.delete(d.id);
      const stored = (await repos().imports.getJob(d.id)) ?? job;
      return writeWorkouts(stored, hooks);
    },

    /** `Continue import` after Stop or a force-close (check 23). */
    async resume(jobId: string, hooks: CommitHooks = {}): Promise<CommitResult> {
      const b = await block();
      if (b) return { ok: false, reason: 'workout_unfinished', block: b };
      const job = await repos().imports.getJob(jobId);
      if (!job) return { ok: false, reason: 'not_found' };
      if (job.status === 'reverted') return { ok: false, reason: 'undone', jobId, written: await writtenCount(jobId), total: job.counts.workouts };
      if (running.has(jobId)) return { ok: true, jobId, status: 'stopped', written: await writtenCount(jobId), total: job.counts.workouts };
      return writeWorkouts(job, hooks);
    },

    /**
     * `Undo this import` (`revertImport`): its workouts are hidden from
     * history, Progress, "Last" values and targets; nothing is deleted (DX7).
     * Refused while it is being written, or while a workout is unfinished (DX4).
     */
    async revert(jobId: string, expectedVersion: number, operationId: string): Promise<RevertResult> {
      if (running.has(jobId)) return { ok: false, reason: 'busy' };
      const b = await block();
      if (b) return { ok: false, reason: 'workout_unfinished', block: b };
      const r = await repos().imports.revertJob(jobId, expectedVersion, operationId, deps.now());
      if (r.ok) return { ok: true, job: r.job, workouts: r.workouts ?? 0, duplicate: r.duplicate };
      if (r.error === 'wrong_status') return { ok: false, reason: 'already_undone' };
      return { ok: false, reason: r.error };
    },

    /** `Past imports`, newest first. */
    async list(): Promise<PastImport[]> {
      const p = await deps.profile();
      if (!p) return [];
      const jobs = await repos().imports.listJobs(p.id);
      const out: PastImport[] = [];
      for (const job of jobs) {
        const written = await writtenCount(job.id);
        out.push({ job, written, total: job.counts.workouts, state: stateOf(job, written) });
      }
      return out;
    },

    /** One import with every source row (results, §2.5 step 5). */
    async job(jobId: string): Promise<(PastImport & { rows: ImportRow[] }) | null> {
      const job = await repos().imports.getJob(jobId);
      if (!job) return null;
      const written = await writtenCount(job.id);
      return { job, written, total: job.counts.workouts, state: stateOf(job, written), rows: await repos().imports.rows(job.id) };
    },

    /** `Save row-by-row results (CSV)`. */
    async resultsCsv(jobId: string): Promise<{ fileName: string; text: string } | null> {
      const job = await repos().imports.getJob(jobId);
      if (!job) return null;
      const stem = job.fileName.replace(/\.csv$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
      return { fileName: `${stem}-import-results.csv`, text: importResultsCsv(await repos().imports.rows(jobId)) };
    },

    /** Where an imported set came from (check 24); null for a set logged in the app. */
    async provenance(setId: string): Promise<ImportedSetProvenance | null> {
      const p = await repos().imports.provenance(setId);
      if (!p) return null;
      return { fileName: p.job.fileName, importedAt: p.job.startedAt, variant: p.job.variant, row: p.row, header: p.job.header };
    },
  };
  return service;
}

export type ImportService = ReturnType<typeof createImportService>;
