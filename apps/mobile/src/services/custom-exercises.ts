import {
  archivedCustomExercise,
  checkCustomExerciseFields,
  clashLine,
  customExerciseIdOf,
  customFieldsOf,
  editedCustomExercise,
  exerciseNameClash,
  isArchivedExercise,
  newCustomExercise,
} from '@fizz/domain';
import type { SqliteRepositories } from '@fizz/persistence';
import type { CustomExerciseFields, Exercise, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * Ben's own exercises (19 Oct; exercise-library §2.6): create from Library ›
 * ＋ New exercise or the coach's card (Add), edit, delete. Local writes only,
 * no network (rule 1). Rows are `exercises` documents owned by Ben (Your
 * data, rule 10; the same storage FitNotes import's `Add new` uses), so they
 * are in backups, export and Delete my data with the rest of his data.
 *
 * Every write is idempotent by opId and versioned (rule 5): a retried tap
 * replays, a form opened on an older version is refused (`stale`). A name
 * already in his list (the catalogue's or his own, by name or other name)
 * is refused with that exercise, so he uses it instead. Delete hides the
 * exercise from pickers and the coach; its history stays, still named.
 */

export interface CustomExerciseDeps {
  repos: () => SqliteRepositories;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  catalogueExercises: () => readonly Exercise[];
  catalogueAliases: (catalogueKey: string) => readonly string[];
}

export type CustomWriteFailure = { ok: false; reason: 'invalid' | 'clash' | 'stale' | 'locked' | 'missing' | 'failed'; message: string; clash?: { exerciseId: string; name: string } };
export type CustomWrite = { ok: true; exercise: Exercise; duplicate: boolean } | CustomWriteFailure;

export const CUSTOM_COPY = {
  failed: 'Couldn’t save. Try again.',
  stale: 'Changed since. Try again.',
  missing: 'Not found.',
  deleted: (name: string) => `Deleted ${name}`,
} as const;

export interface CustomForm {
  exerciseId: string;
  fields: CustomExerciseFields;
  version: number;
  /** Logged with already: equipment, load, measure and sides stay. */
  locked: boolean;
}

export function createCustomExercises(deps: CustomExerciseDeps) {
  const repos = deps.repos;

  /** Ben's list: his rows (catalogue and custom), then the catalogue's not saved yet. */
  async function list(p: UserProfile): Promise<Exercise[]> {
    const saved = (await repos().exercises.list()).filter((e) => e.ownerId === null || e.ownerId === p.id);
    const have = new Set(saved.map((e) => e.id));
    return [...saved, ...deps.catalogueExercises().filter((e) => !have.has(e.id))];
  }

  async function ownAliases(p: UserProfile): Promise<Map<string, string[]>> {
    const own = new Map<string, string[]>();
    for (const a of await repos().imports.aliases(p.id).catch(() => [])) if (a.target.kind === 'exercise') own.set(a.target.exerciseId, [...(own.get(a.target.exerciseId) ?? []), a.name]);
    return own;
  }

  async function clashFor(p: UserProfile, name: string, selfId: string | null): Promise<{ exerciseId: string; name: string } | null> {
    const own = await ownAliases(p);
    const hit = exerciseNameClash(
      name,
      (await list(p)).map((e) => ({ id: e.id, name: e.name, aliases: [...(e.catalogueKey ? deps.catalogueAliases(e.catalogueKey) : []), ...(own.get(e.id) ?? [])], source: e.source, archived: isArchivedExercise(e) })),
      selfId,
    );
    return hit === null ? null : { exerciseId: hit.id, name: hit.name };
  }

  const clashFailure = (c: { exerciseId: string; name: string }): CustomWriteFailure => ({ ok: false, reason: 'clash', message: clashLine(c.name), clash: c });

  async function mineCustom(p: UserProfile, id: string): Promise<Exercise | null> {
    const e = await repos().exercises.get(id);
    return e !== null && e.source === 'custom' && e.ownerId === p.id ? e : null;
  }

  return {
    /** As Ben types a name: the exercise already in his list with it, if any. Null: none (or couldn't read). */
    async nameClash(name: string, selfId: string | null = null): Promise<{ exerciseId: string; name: string; line: string } | null> {
      try {
        const p = await deps.profile();
        if (!p) return null;
        const c = await clashFor(p, name, selfId);
        return c === null ? null : { ...c, line: clashLine(c.name) };
      } catch {
        return null;
      }
    },

    /** The form for Edit. Null: not one of Ben's own exercises (or deleted). */
    async form(exerciseId: string): Promise<CustomForm | null> {
      try {
        const p = await deps.profile();
        if (!p) return null;
        const e = await mineCustom(p, exerciseId);
        if (e === null || isArchivedExercise(e)) return null;
        return { exerciseId: e.id, fields: customFieldsOf(e), version: e.version, locked: await repos().exercises.hasLoggedSets(e.id) };
      } catch {
        return null;
      }
    },

    /**
     * ＋ New exercise's Save, or Add on the coach's card (`proposalActionId`: the card's own ID, so a
     * double tap, or Add after Edit's Save, saves once).
     */
    async create(req: { fields: CustomExerciseFields; opId: string; proposalActionId?: string }): Promise<CustomWrite> {
      try {
        const p = await deps.profile();
        if (!p) return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
        const checked = checkCustomExerciseFields(req.fields);
        if (!checked.ok) return { ok: false, reason: 'invalid', message: checked.problem };
        const id = customExerciseIdOf(p.id, req.proposalActionId === undefined ? { opId: req.opId } : { proposalActionId: req.proposalActionId });
        const existing = await repos().exercises.get(id);
        if (existing !== null) return existing.ownerId === p.id ? { ok: true, exercise: existing, duplicate: true } : { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
        const clash = await clashFor(p, checked.fields.name, null);
        if (clash !== null) return clashFailure(clash);
        const exercise = newCustomExercise(checked.fields, { id, ownerId: p.id, atUtc: deps.now().utc, opId: req.opId });
        const r = await repos().exercises.save(exercise, null);
        if (!r.ok) {
          const now = await repos().exercises.get(id);
          return now !== null && now.ownerId === p.id ? { ok: true, exercise: now, duplicate: true } : { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
        }
        return { ok: true, exercise, duplicate: false };
      } catch {
        return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
      }
    },

    /** Edit's Save: a new version on the version the form read. */
    async edit(req: { exerciseId: string; fields: CustomExerciseFields; expectedVersion: number; opId: string }): Promise<CustomWrite> {
      try {
        const p = await deps.profile();
        if (!p) return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
        const e = await mineCustom(p, req.exerciseId);
        if (e === null || isArchivedExercise(e)) return { ok: false, reason: 'missing', message: CUSTOM_COPY.missing };
        if (e.lastOpId === req.opId) return { ok: true, exercise: e, duplicate: true };
        if (e.version !== req.expectedVersion) return { ok: false, reason: 'stale', message: CUSTOM_COPY.stale };
        const checked = checkCustomExerciseFields(req.fields);
        if (!checked.ok) return { ok: false, reason: 'invalid', message: checked.problem };
        const clash = await clashFor(p, checked.fields.name, e.id);
        if (clash !== null) return clashFailure(clash);
        const edited = editedCustomExercise(e, checked.fields, { atUtc: deps.now().utc, opId: req.opId, logged: await repos().exercises.hasLoggedSets(e.id) });
        if (!edited.ok) return { ok: false, reason: edited.reason === 'locked' ? 'locked' : 'missing', message: edited.message };
        const r = await repos().exercises.save(edited.exercise, e.version);
        return r.ok ? { ok: true, exercise: edited.exercise, duplicate: false } : { ok: false, reason: 'stale', message: CUSTOM_COPY.stale };
      } catch {
        return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
      }
    },

    /** Delete: hidden from pickers, search and the coach; its workouts keep it. */
    async remove(req: { exerciseId: string; expectedVersion: number; opId: string }): Promise<CustomWrite> {
      try {
        const p = await deps.profile();
        if (!p) return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
        const e = await mineCustom(p, req.exerciseId);
        if (e === null) return { ok: false, reason: 'missing', message: CUSTOM_COPY.missing };
        if (e.lastOpId === req.opId) return { ok: true, exercise: e, duplicate: true };
        if (isArchivedExercise(e)) return { ok: false, reason: 'missing', message: CUSTOM_COPY.missing };
        if (e.version !== req.expectedVersion) return { ok: false, reason: 'stale', message: CUSTOM_COPY.stale };
        const archived = archivedCustomExercise(e, { atUtc: deps.now().utc, opId: req.opId });
        const r = await repos().exercises.save(archived, e.version);
        return r.ok ? { ok: true, exercise: archived, duplicate: false } : { ok: false, reason: 'stale', message: CUSTOM_COPY.stale };
      } catch {
        return { ok: false, reason: 'failed', message: CUSTOM_COPY.failed };
      }
    },
  };
}

export type CustomExercisesService = ReturnType<typeof createCustomExercises>;
