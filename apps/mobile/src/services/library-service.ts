import {
  buildAddDestinations,
  buildExerciseBrowseView,
  buildExerciseInfoView,
  currentGymEquipment,
  defaultSlotShape,
  deriveId,
  equipmentForExercise,
  EXERCISE_EQUIPMENT_WORD,
  gymAvailability,
  isDeleted,
  isInRotation,
  lastActualByExercise,
  liveRoutines,
  NO_DISTANCE_IN_WORKOUTS,
  localDateOf,
  mayHurtAccessibility,
  mayHurtConfirm,
  painFlagCovering,
  addExercise as addSlot,
  rotationRoutines,
  storedWorkoutName,
  toMs,
  type AddDestinations,
  type AddShape,
  type BrowseEntry,
  type CommandOutcome,
  type ExerciseBrowseView,
  type ExerciseDetailView,
  type ExerciseFilters,
  type ExerciseInfoView,
  type ExerciseKnowledgeInput,
  type ProgressSession,
  type ResumeBar,
  type SlotShapeInput,
} from '@fizz/domain';
import type { SqliteRepositories } from '@fizz/persistence';
import type { Exercise, Gym, PainFlag, Routine, SessionAggregate, SessionCommand, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import { buildHowToView, bundledHowToSources, hasHowTo, type HowToSources } from '../guide/how-to';

/**
 * The Library tab's Exercises (exercise-library §9): browse, Exercise
 * detail and `Add to a workout`. Local reads and writes only; nothing here
 * waits on a network or the coach (rule 1). The catalogue, its aliases and
 * the how-to are Coaching knowledge; history, pain flags and workouts are
 * Your data, and the detail keeps them apart (rule 10).
 *
 * Writes: adding to the workout in progress is the workout's own
 * `addExercise` (new pending sets only; idempotent by opId; rule 2), and
 * its Undo is `remove_exercise`. Adding to a saved workout is the editor's
 * versioned `update` (expectedVersion, an `update_routine` record, so Undo
 * is `revert` and survives a force-close; rule 5).
 */

export interface LibraryServiceDeps {
  repos: () => SqliteRepositories;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  currentGym: () => Promise<Gym | null>;
  catalogueExercises: () => readonly Exercise[];
  catalogueAliases: (catalogueKey: string) => readonly string[];
  /** Progress's finished workouts (one cache), gym names, today and the ResumeBar. */
  history: () => Promise<{ sessions: readonly ProgressSession[]; gymNames: Record<string, string>; today: string; resume: ResumeBar | null } | null>;
  /** Progress's own detail for the exercise (default series), so the numbers match Progress (EL-B7). */
  progressDetail: (exerciseId: string) => Promise<ExerciseDetailView | null>;
  addToSession: (req: { sessionId: string; exerciseId: string; equipmentId: string | null; opId: string; shape: AddShape }) => Promise<CommandOutcome>;
  dispatch: (sessionId: string, command: SessionCommand) => Promise<CommandOutcome>;
  updateRoutine: (req: { routineId: string; edit: { name: string; exercises: Routine['exercises'] }; expectedVersion: number; opId: string }) => Promise<
    { ok: true; routine: Routine; actionId: string | null } | { ok: false; reason: string; message: string }
  >;
  revertRoutine: (req: { actionId: string; opId: string }) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Saved workouts with when each was last done (the Workouts list's rows). */
  routineRows: () => Promise<readonly { id: string; lastDone: { atUtc: string } | null }[]>;
  newId: () => string;
  howTo?: () => HowToSources;
}

export interface LibraryBrowse {
  view: ExerciseBrowseView;
  resume: ResumeBar | null;
}

export interface LibraryDetail {
  view: ExerciseInfoView;
  exercise: Pick<Exercise, 'id' | 'name' | 'measurement' | 'laterality'>;
  /** How to's route (`▷ Play`, `Full how-to ›`); null when there is nothing to show. */
  howTo: { catalogueKey: string; name: string } | null;
  /** `Progress and records ›` on the same series; null with no history. */
  progress: { exerciseId: string; seriesId: string } | null;
  /** EL9: asked before adding. Null when no active flag covers it. */
  mayHurt: ReturnType<typeof mayHurtConfirm> | null;
  /** The Add sheet's starting shape (§10.1). */
  defaultShape: SlotShapeInput;
  /** `Target RPE` / `Target RIR`; null hides the row (effort scale off). */
  effortScale: 'rpe' | 'rir' | null;
  resume: ResumeBar | null;
}

export interface LibraryDestinations {
  destinations: AddDestinations;
  /**
   * The workout in progress can't do it at its gym (§4.2): asked before an
   * add there (`Main Gym has no cable station. Add Cable fly anyway?`).
   */
  notAtGym: string | null;
}

/** The Add sheet's shape as the screen sends it: the `SetShapeControl` values, `repsTouched` when Ben changed `Reps`. */
export interface LibraryAddShape {
  workingSets: number;
  warmups: number;
  reps: { min: number; max: number } | null;
  durationS: number | null;
  effort: { scale: 'rpe' | 'rir'; value: number | null };
  repsTouched: boolean;
}

export type LibraryAddTarget = { kind: 'session'; sessionId: string } | { kind: 'routine'; routineId: string; expectedVersion: number };

export type LibraryUndo = { kind: 'session'; sessionId: string; sessionExerciseId: string } | { kind: 'routine'; actionId: string };

export type LibraryAddWrite = { ok: true; toast: string; undo: LibraryUndo | null } | { ok: false; reason: 'stale' | 'already' | 'failed' | 'missing' | 'distance'; message: string };

export const LIBRARY_ADD_COPY = {
  added: (name: string) => `Added to ${name}`,
  changed: (name: string) => `${name} changed. Try again.`,
  failed: 'Couldn’t add it. Try again.',
  already: 'Already in it',
  removed: (name: string) => `Removed from ${name}`,
  cantUndo: (name: string) => `Can’t undo: ${name} changed since.`,
} as const;

const KIND_NOUN: Partial<Record<Exercise['compatibleEquipment'][number], string>> = {
  barbell: 'barbell',
  dumbbells: 'dumbbells',
  weight_stack: 'cable station',
  assisted_stack: 'assisted machine',
  plate_loaded_machine: 'plate-loaded machine',
  bodyweight_station: 'bar or station',
};

export function createLibraryService(deps: LibraryServiceDeps) {
  const repos = deps.repos;
  const sources = () => (deps.howTo ? deps.howTo() : bundledHowToSources());

  /** Every exercise Ben can look up: his saved rows (catalogue and custom), then the catalogue's not saved yet. */
  async function allExercises(p: UserProfile): Promise<Exercise[]> {
    const saved = (await repos().exercises.list().catch(() => [] as Exercise[])).filter((e) => e.ownerId === null || e.ownerId === p.id);
    const have = new Set(saved.map((e) => e.id));
    return [...saved, ...deps.catalogueExercises().filter((e) => !have.has(e.id))];
  }

  async function aliasIndex(p: UserProfile): Promise<(e: Exercise) => string[]> {
    const own = new Map<string, string[]>();
    for (const a of await repos().imports.aliases(p.id).catch(() => [])) if (a.target.kind === 'exercise') own.set(a.target.exerciseId, [...(own.get(a.target.exerciseId) ?? []), a.name]);
    return (e) => {
      const self = e.name.trim().toLowerCase();
      return [...new Set([...(e.catalogueKey ? deps.catalogueAliases(e.catalogueKey) : []), ...(own.get(e.id) ?? [])])].filter((n) => n.trim().toLowerCase() !== self);
    };
  }

  async function activeFlags(p: UserProfile): Promise<PainFlag[]> {
    return repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
  }

  async function exerciseById(id: string): Promise<Exercise | null> {
    return (await repos().exercises.get(id).catch(() => null)) ?? deps.catalogueExercises().find((e) => e.id === id) ?? null;
  }

  async function gymWithEquipment(): Promise<{ id: string; name: string; equipment: Awaited<ReturnType<SqliteRepositories['equipment']['listByGym']>> } | null> {
    const gym = await deps.currentGym().catch(() => null);
    if (gym === null) return null;
    return { id: gym.id, name: gym.name, equipment: await repos().equipment.listByGym(gym.id).catch(() => []) };
  }

  async function activeSession(p: UserProfile): Promise<SessionAggregate | null> {
    const a = await repos().sessions.getActive(p.id).catch(() => null);
    return a !== null && a.session.status === 'active' ? a : null;
  }

  const sessionName = (a: SessionAggregate): string => storedWorkoutName(a.session) ?? 'Workout';

  return {
    /** Library › Exercises (§9.3): every exercise, search (EL1), filters (EL2), recent first. Null: couldn't read. */
    async browse(req: { query: string; filters: ExerciseFilters }): Promise<LibraryBrowse | null> {
      try {
        const p = await deps.profile();
        if (!p) return null;
        const [all, aliasesOf, flags, gym, hist] = await Promise.all([allExercises(p), aliasIndex(p), activeFlags(p), gymWithEquipment(), deps.history()]);
        const at = deps.now();
        const nowMs = toMs(at.utc);
        const src = sources();
        const entries: BrowseEntry[] = all.map((exercise) => {
          const covering = painFlagCovering(flags, exercise.id, nowMs, at.tz);
          return {
            exercise,
            aliases: aliasesOf(exercise),
            hasGuide: exercise.catalogueKey != null && src.guides.keys.has(exercise.catalogueKey),
            painFlag: covering === null ? null : { since: localDateOf(toMs(covering.flag.reportedAt.utc), covering.flag.reportedAt.tz), accessibilityLabel: mayHurtAccessibility(covering.flag) },
          };
        });
        const sessions = hist?.sessions ?? [];
        // Recently done: newest first, each once.
        const recentIds: string[] = [];
        for (const s of [...sessions].sort((a, b) => b.startedMs - a.startedMs)) for (const e of s.exercises) if (e.sets.length > 0 && !recentIds.includes(e.exerciseId)) recentIds.push(e.exerciseId);
        const view = buildExerciseBrowseView({
          entries,
          query: req.query,
          filters: req.filters,
          gym,
          recentIds,
          last: lastActualByExercise(sessions),
          gymNames: hist?.gymNames ?? {},
          today: hist?.today ?? localDateOf(nowMs, p.timezone),
        });
        return { view, resume: hist?.resume ?? null };
      } catch {
        return null;
      }
    },

    /** Exercise detail (§9.4). Null: not found or couldn't read. */
    async detail(exerciseId: string): Promise<LibraryDetail | null> {
      try {
        const p = await deps.profile();
        if (!p) return null;
        const exercise = await exerciseById(exerciseId);
        if (exercise === null || (exercise.ownerId !== null && exercise.ownerId !== p.id)) return null;
        const at = deps.now();
        const [aliasesOf, flags, gym, hist, progress, routines] = await Promise.all([
          aliasIndex(p),
          activeFlags(p),
          deps.currentGym().catch(() => null),
          deps.history(),
          deps.progressDetail(exerciseId).catch(() => null),
          repos().routines.listByOwner(p.id).catch(() => [] as Routine[]),
        ]);
        const src = sources();
        const key = exercise.catalogueKey ?? null;
        const how = key === null ? null : buildHowToView({ name: exercise.name, catalogueKey: key }, src);
        const poster = how?.guide ? { catalogueKey: key as string, draftLabel: how.guide.draftLabel, accessibilityLabel: how.guide.accessibilityLabel } : null;
        const knowledge: ExerciseKnowledgeInput = {
          poster,
          legend: (how?.legend ?? []).filter((l) => l.kind === 'most' || l.kind === 'also').map((l) => ({ label: l.label, list: l.list })),
          execution: how?.execution ?? [],
          avoid: how?.avoid ?? [],
          hasFullHowTo: hasHowTo(key, src),
        };
        const covering = painFlagCovering(flags, exercise.id, toMs(at.utc), at.tz);
        const usedIn = liveRoutines(routines)
          .filter((r) => r.exercises.some((e) => e.exerciseId === exercise.id))
          .map((r) => ({ routineId: r.id, name: r.name }));
        const view = buildExerciseInfoView({
          exercise,
          aliases: aliasesOf(exercise),
          knowledge,
          sessions: hist?.sessions ?? [],
          progress,
          painFlag: covering === null ? null : { flagId: covering.flag.id, since: localDateOf(toMs(covering.flag.reportedAt.utc), covering.flag.reportedAt.tz) },
          usedIn,
          gymName: gym?.name ?? null,
          today: hist?.today ?? localDateOf(toMs(at.utc), p.timezone),
        });
        return {
          view,
          exercise: { id: exercise.id, name: exercise.name, measurement: exercise.measurement, laterality: exercise.laterality },
          howTo: knowledge.hasFullHowTo && key !== null ? { catalogueKey: key, name: exercise.name } : null,
          progress: progress === null ? null : { exerciseId: exercise.id, seriesId: progress.seriesId },
          mayHurt: covering === null ? null : mayHurtConfirm({ ...covering.flag, exerciseName: exercise.name }),
          defaultShape: defaultSlotShape(exercise),
          effortScale: p.effortScale === 'off' ? null : p.effortScale,
          resume: hist?.resume ?? null,
        };
      } catch {
        return null;
      }
    },

    /** The Add sheet's rows (§9.5). Null: couldn't read. */
    async destinations(exerciseId: string): Promise<LibraryDestinations | null> {
      try {
        const p = await deps.profile();
        if (!p) return null;
        const exercise = await exerciseById(exerciseId);
        if (exercise === null) return null;
        const active = await activeSession(p);
        const live = liveRoutines(await repos().routines.listByOwner(p.id));
        const rotation = rotationRoutines(live).map((r) => r.id);
        const lastDone = new Map<string, number>();
        for (const r of await deps.routineRows().catch(() => [])) if (r.lastDone !== null) lastDone.set(r.id, toMs(r.lastDone.atUtc));
        const destinations = buildAddDestinations({
          exerciseId,
          measurement: exercise.measurement,
          session:
            active === null
              ? null
              : { id: active.session.id, name: sessionName(active), version: active.session.version, exerciseIds: active.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId), routineId: active.session.routineId ?? null },
          routines: live.map((r) => ({ id: r.id, name: r.name, version: r.version, exerciseIds: r.exercises.map((e) => e.exerciseId), rotationIndex: isInRotation(r) && rotation.includes(r.id) ? rotation.indexOf(r.id) : null, lastDoneMs: lastDone.get(r.id) ?? null })),
        });
        let notAtGym: string | null = null;
        if (active !== null && gymAvailability(exercise, currentGymEquipment(active.session)) === 'not_at_gym') {
          const gymName = (await repos().gyms.get(active.session.gymId ?? '').catch(() => null))?.name ?? 'This gym';
          const kind = exercise.compatibleEquipment[0];
          const noun = kind === undefined ? 'equipment' : (KIND_NOUN[kind] ?? EXERCISE_EQUIPMENT_WORD[kind].toLowerCase());
          notAtGym = `${gymName} has no ${noun}. Add ${exercise.name} anyway?`;
        }
        return { destinations, notAtGym };
      } catch {
        return null;
      }
    },

    /**
     * `Add to <workout>` (§9.5, EL14). Idempotent by `opId`. The workout in
     * progress gets the exercise at the end with N new pending sets (its own
     * history's targets; no done set changes). A saved workout gets a slot
     * with the shape and `Auto` loads in a new version, refused when it
     * changed since the sheet read it (rule 5).
     */
    async addToWorkout(req: { exerciseId: string; shape: LibraryAddShape; to: LibraryAddTarget; opId: string }): Promise<LibraryAddWrite> {
      try {
        const p = await deps.profile();
        if (!p) return { ok: false, reason: 'failed', message: LIBRARY_ADD_COPY.failed };
        const exercise = await exerciseById(req.exerciseId);
        if (exercise === null) return { ok: false, reason: 'missing', message: LIBRARY_ADD_COPY.failed };
        const sh = req.shape;
        if (req.to.kind === 'session') {
          const before = await repos().sessions.get(req.to.sessionId);
          if (before === null || before.session.status !== 'active') return { ok: false, reason: 'missing', message: LIBRARY_ADD_COPY.failed };
          const name = sessionName(before);
          const mine = (a: SessionAggregate) => a.exercises.filter((e) => e.exerciseId === exercise.id && e.removed === undefined);
          const had = new Set(mine(before).map((e) => e.id));
          // A retry of an add that landed is the same add (the reducer replays the opId).
          if (had.size > 0 && !(req.opId in before.processedOps)) return { ok: false, reason: 'already', message: LIBRARY_ADD_COPY.already };
          const equipment = equipmentForExercise(exercise, currentGymEquipment(before.session))[0] ?? null;
          const shape: AddShape = {
            workingSets: sh.workingSets,
            warmups: sh.warmups,
            ...(sh.repsTouched && sh.reps !== null ? { reps: sh.reps } : {}),
            ...(sh.repsTouched && sh.durationS !== null ? { durationS: sh.durationS } : {}),
            ...(sh.effort.value !== null ? { effort: sh.effort } : {}),
          };
          const r = await deps.addToSession({ sessionId: before.session.id, exerciseId: exercise.id, equipmentId: equipment?.id ?? null, opId: req.opId, shape });
          if (!r.ok) return { ok: false, reason: 'failed', message: LIBRARY_ADD_COPY.failed };
          const row = mine(r.aggregate).find((e) => !had.has(e.id)) ?? mine(r.aggregate).at(-1);
          return { ok: true, toast: LIBRARY_ADD_COPY.added(name), undo: row === undefined ? null : { kind: 'session', sessionId: before.session.id, sessionExerciseId: row.id } };
        }
        // A saved workout has no distance target: never saved as reps (review library-browse S1).
        if (exercise.measurement === 'distance') return { ok: false, reason: 'distance', message: NO_DISTANCE_IN_WORKOUTS };
        const routine = await repos().routines.get(req.to.routineId);
        if (routine === null || routine.ownerId !== p.id || isDeleted(routine)) return { ok: false, reason: 'missing', message: LIBRARY_ADD_COPY.failed };
        // A retried opId that landed is the same save (the update replays it).
        if (routine.lastOpId !== req.opId) {
          if (routine.version !== req.to.expectedVersion) return { ok: false, reason: 'stale', message: LIBRARY_ADD_COPY.changed(routine.name) };
          if (routine.exercises.some((e) => e.exerciseId === exercise.id)) return { ok: false, reason: 'already', message: LIBRARY_ADD_COPY.already };
        }
        // Slot and set IDs come from the opId, so a retry builds the same version.
        let n = 0;
        const ids = () => deriveId(`library-add:${req.opId}:${String((n += 1))}`);
        const slotShape: SlotShapeInput = { workingSets: sh.workingSets, warmups: sh.warmups, reps: sh.reps, durationS: sh.durationS, targetRpe: sh.effort.scale === 'rpe' ? sh.effort.value : null, targetRir: sh.effort.scale === 'rir' ? sh.effort.value : null };
        const exercises = routine.lastOpId === req.opId ? routine.exercises : addSlot(routine.exercises, { id: exercise.id, measurement: exercise.measurement }, ids, slotShape).map((e) => (e.exerciseId === exercise.id && e.main === undefined ? { ...e, main: false } : e));
        const r = await deps.updateRoutine({ routineId: routine.id, edit: { name: routine.name, exercises }, expectedVersion: routine.lastOpId === req.opId ? routine.version : req.to.expectedVersion, opId: req.opId });
        if (!r.ok) return { ok: false, reason: r.reason === 'stale' ? 'stale' : 'failed', message: r.reason === 'stale' ? LIBRARY_ADD_COPY.changed(routine.name) : LIBRARY_ADD_COPY.failed };
        return { ok: true, toast: LIBRARY_ADD_COPY.added(routine.name), undo: r.actionId === null ? null : { kind: 'routine', actionId: r.actionId } };
      } catch {
        return { ok: false, reason: 'failed', message: LIBRARY_ADD_COPY.failed };
      }
    },

    /**
     * The add toast's `Undo`: the workout in progress removes the row while
     * none of its sets is logged (`remove_exercise`; a logged set is real and
     * stays); a saved workout goes back to the version before, while it is
     * still at the version the add made.
     */
    async undoAdd(req: { undo: LibraryUndo; opId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        const u = req.undo;
        if (u.kind === 'routine') {
          const r = await deps.revertRoutine({ actionId: u.actionId, opId: req.opId });
          return r.ok ? { ok: true } : { ok: false, message: r.message };
        }
        const a = await repos().sessions.get(u.sessionId);
        if (a === null) return { ok: false, message: LIBRARY_ADD_COPY.failed };
        const r = await deps.dispatch(u.sessionId, { type: 'remove_exercise', at: deps.now(), opId: req.opId, sessionExerciseId: u.sessionExerciseId, expectedVersion: a.session.version });
        return r.ok ? { ok: true } : { ok: false, message: LIBRARY_ADD_COPY.cantUndo(sessionName(a)) };
      } catch {
        return { ok: false, message: LIBRARY_ADD_COPY.failed };
      }
    },
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
