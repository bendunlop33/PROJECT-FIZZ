import {
  SessionCommandSchema,
  validate,
  type EquipmentInstance,
  type Exercise,
  type SessionAggregate,
  type SessionCheckIn,
  type ValidationIssue,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { FencedResult, Repositories, SaveResult, WriteFence } from './ports';
import { buildAddExerciseCommand, startWorkout, type AddExerciseInput, type SetFit, type StartWarning } from './session/create';
import { recoverSession, type RecoveryResult } from './session/recovery';
import type { RepeatInput, RepeatNote, RepeatOutput } from './session/repeat';
import { isDeleted, type RoutineStartInput } from './session/routines';
import { planWithTodayEdits, type EditOutcome, type ResolvedEdits, type TodayEditsInput, type TodaySlot } from './session/today-edits';
import type { ShapeBefore } from './session/today-shape';
import { reduceSession, type SessionError, type SessionEvent } from './session/reducer';

export type ServiceError =
  | SessionError
  | { code: 'invalid_command'; message: string; issues: ValidationIssue[] }
  | { code: 'not_found'; message: string }
  | { code: 'session_already_active'; message: string; sessionId: string }
  | { code: 'write_conflict'; message: string }
  /** Storage threw (e.g. SQLite full or locked). Nothing was committed by us; retry with the same opId. */
  | { code: 'write_failed'; message: string }
  /** A fenced start found an input it was planned from changed before the write (workout-overview §7). Nothing was written. */
  | { code: 'stale_inputs'; message: string };

export type CommandOutcome =
  | {
      ok: true;
      aggregate: SessionAggregate;
      events: SessionEvent[];
      duplicate: boolean;
      /** See `ReduceResult.superseded`: the duplicate's effect is no longer in place. */
      superseded: boolean;
    }
  | { ok: false; error: ServiceError };

export type StartOutcome =
  | { ok: true; aggregate: SessionAggregate; warnings: StartWarning[]; duplicate: boolean }
  | { ok: false; error: ServiceError };

export interface StartRequest {
  ownerId: string;
  gymId: string;
  routineId: string | null;
  opId: string;
  at: ZonedTimestamp;
  /** Check-in outcome stored on the new session (same write). */
  checkIn?: SessionCheckIn | null;
  /** GS3 step 2: the item an exercise last used at this gym (from history). */
  lastUsedHere?: (exerciseId: string) => string | null;
}

const MAX_CONFLICT_RETRIES = 2;

/** What a plan with today's edits says about them (ADR 0022): the overview's rows and stale/redundant edits. */
export interface TodayPlanInfo {
  slotOf: Record<string, string>;
  /** A saved workout's plan: each planned set's template in the workout (absent for a next session). */
  setTemplateIds?: Record<string, string>;
  outcomes: EditOutcome[];
  resolved: ResolvedEdits;
  slots: TodaySlot[];
  baseSlots: TodaySlot[];
  /** Each slot as planned before today's sets, reps and load (§11). */
  plannedShape: Record<string, ShapeBefore>;
}

const NO_EDITS: TodayEditsInput = { draft: null, edits: [], swaps: new Map() };

const STALE_INPUTS = { code: 'stale_inputs', message: 'What this start was planned from changed. Nothing was saved.' } as const;

const WRITE_FAILED = {
  code: 'write_failed',
  message: 'Couldn’t save. Try again.',
} as const;

/** Run a save, turning a thrown storage error into a value. */
async function trySave<R extends SaveResult | FencedResult>(save: () => Promise<R>): Promise<R | 'threw'> {
  try {
    return await save();
  } catch {
    return 'threw';
  }
}

/**
 * In-process application service for the active session: validate the
 * command, load the aggregate, reduce, save atomically. No network, no AI.
 * Retrying after a write conflict is safe because commands are idempotent.
 */
export function createSessionService(repos: Repositories, newId: () => string) {
  async function start(req: StartRequest): Promise<StartOutcome> {
    const existing = await repos.sessions.findByStartOperation(req.ownerId, req.opId);
    if (existing) return { ok: true, aggregate: existing, warnings: [], duplicate: true };

    const active = await repos.sessions.getActive(req.ownerId);
    if (active) {
      return {
        ok: false,
        error: { code: 'session_already_active', message: 'Finish or resume the unfinished workout first.', sessionId: active.session.id },
      };
    }
    const owner = await repos.profiles.get(req.ownerId);
    if (!owner) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
    const routine = req.routineId === null ? null : await repos.routines.get(req.routineId);
    if (req.routineId !== null && !routine) return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };

    const exercises = new Map<string, Exercise>();
    for (const rex of routine?.exercises ?? []) {
      const ex = await repos.exercises.get(rex.exerciseId);
      if (ex) exercises.set(ex.id, ex);
    }
    const gymEquipment = await repos.equipment.listByGym(req.gymId);
    // The items a routine is pinned to, from any gym: one not here is mapped by its kind (gym-switch GS3).
    const routineEquipment = new Map<string, EquipmentInstance>();
    for (const rex of routine?.exercises ?? []) {
      if (rex.equipmentId === null || routineEquipment.has(rex.equipmentId)) continue;
      const eq = await repos.equipment.get(rex.equipmentId);
      if (eq) routineEquipment.set(eq.id, eq);
    }
    const gym = await repos.gyms.get(req.gymId);
    const { aggregate, warnings } = startWorkout({
      opId: req.opId,
      owner,
      gymId: req.gymId,
      routine,
      exercises,
      gymEquipment,
      routineEquipment,
      at: req.at,
      newId,
      checkIn: req.checkIn ?? null,
      ...(gym ? { gymName: gym.name } : {}),
      ...(req.lastUsedHere ? { lastUsedHere: req.lastUsedHere } : {}),
    });
    const saved = await trySave(() => repos.sessions.save(aggregate, null));
    if (saved === 'threw') return { ok: false, error: WRITE_FAILED };
    if (!saved.ok) return { ok: false, error: { code: 'write_conflict', message: 'Could not create the session.' } };
    return { ok: true, aggregate, warnings, duplicate: false };
  }

  /**
   * `startWorkoutFromSession` (routines.md §4.6): a new session whose targets
   * are a finished session's actuals. Idempotent by `opId`, one active
   * session at a time, like `start`. `preview: true` builds it without saving.
   * An imported workout is refused (`imported_not_repeatable`; review r2 B1).
   */
  async function startFromSession(
    req: StartRequest & {
      sourceSessionId: string;
      preview?: boolean;
      /** "Start next session" (audit B2): next targets per exercise ID, and a name. */
      targets?: RepeatInput['targets'];
      name?: string;
      /** Preview only: fit to this equipment instead of the gym's (the typical gym Start will save, workout-overview §8). */
      gymEquipment?: readonly EquipmentInstance[];
      /** What the caller's preview was planned from, re-checked inside the write. */
      fence?: WriteFence;
      /** Today's edits from the pre-start draft (ADR 0022); the overview's dry run and Start pass the same. */
      today?: TodayEditsInput;
    },
  ): Promise<
    | { ok: true; aggregate: SessionAggregate; notes: RepeatNote[]; notCopied: RepeatOutput['notCopied']; duplicate: boolean; fits: Record<string, SetFit>; today: TodayPlanInfo | null }
    | { ok: false; error: ServiceError | { code: 'nothing_to_repeat'; message: string } | { code: 'imported_not_repeatable'; message: string } }
  > {
    if (!req.preview) {
      const existing = await repos.sessions.findByStartOperation(req.ownerId, req.opId);
      if (existing) return { ok: true, aggregate: existing, notes: [], notCopied: [], duplicate: true, fits: {}, today: null };
      const active = await repos.sessions.getActive(req.ownerId);
      if (active) {
        return { ok: false, error: { code: 'session_already_active', message: 'Finish or resume the unfinished workout first.', sessionId: active.session.id } };
      }
    }
    const owner = await repos.profiles.get(req.ownerId);
    const source = await repos.sessions.get(req.sourceSessionId);
    if (!owner) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
    if (!source || source.session.ownerId !== req.ownerId || source.session.status !== 'finished') {
      return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };
    }
    // An imported (FitNotes) workout has no equipment to check its loads on, and P-I3 is open:
    // it's never repeated, so nothing unchecked becomes today's target (rule 4; review r2 B1).
    if (source.session.source === 'import') {
      return { ok: false, error: { code: 'imported_not_repeatable', message: 'Workouts imported from FitNotes can’t be repeated yet.' } };
    }
    const exercises = new Map<string, Exercise>();
    for (const ex of source.exercises) {
      const e = await repos.exercises.get(ex.exerciseId);
      if (e) exercises.set(e.id, e);
    }
    const gym = await repos.gyms.get(req.gymId);
    const out = planWithTodayEdits({ kind: 'next', input: {
      opId: req.opId,
      owner,
      gymId: req.gymId,
      source,
      exercises,
      gymEquipment: req.preview && req.gymEquipment ? req.gymEquipment : await repos.equipment.listByGym(req.gymId),
      at: req.at,
      newId,
      checkIn: req.checkIn ?? null,
      ...(req.targets ? { targets: req.targets } : {}),
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(gym ? { gymName: gym.name } : {}),
      ...(req.lastUsedHere ? { lastUsedHere: req.lastUsedHere } : {}),
    } }, req.today ?? NO_EDITS);
    const today: TodayPlanInfo = { slotOf: out.slotOf, outcomes: out.outcomes, resolved: out.resolved, slots: out.slots, baseSlots: out.baseSlots, plannedShape: out.plannedShape };
    if (out.empty) return { ok: false, error: { code: 'nothing_to_repeat', message: 'That workout has no logged sets to repeat.' } };
    if (req.preview) return { ok: true, aggregate: out.aggregate, notes: out.notes, notCopied: out.notCopied, duplicate: false, fits: out.fits, today };
    const saved = await trySave(() => repos.sessions.save(out.aggregate, null, req.fence));
    if (saved === 'threw') return { ok: false, error: WRITE_FAILED };
    if (!saved.ok) return { ok: false, error: saved.error === 'stale_inputs' ? STALE_INPUTS : { code: 'write_conflict', message: 'Could not create the session.' } };
    return { ok: true, aggregate: out.aggregate, notes: out.notes, notCopied: out.notCopied, duplicate: false, fits: out.fits, today };
  }

  /**
   * Start a routine (premium-feel §2.6): its structure, with `targets` (next
   * targets from its last workout) where given, checked on this gym's
   * equipment. Idempotent by `opId`; one active session at a time.
   * `preview: true` builds it without saving (the routine sheet, Today).
   */
  async function startRoutine(
    req: Omit<StartRequest, 'routineId'> & {
      routineId: string;
      preview?: boolean;
      targets?: RoutineStartInput['targets'];
      /** Preview only: fit to this equipment instead of the gym's (workout-overview §8, no gym yet). */
      gymEquipment?: readonly EquipmentInstance[];
      /** What the caller's preview was planned from, re-checked inside the write. */
      fence?: WriteFence;
      /** Today's edits from the pre-start draft (ADR 0022). */
      today?: TodayEditsInput;
    },
  ): Promise<{ ok: true; aggregate: SessionAggregate; notes: RepeatNote[]; duplicate: boolean; fits: Record<string, SetFit>; today: TodayPlanInfo | null } | { ok: false; error: ServiceError | { code: 'nothing_to_start'; message: string } }> {
    if (!req.preview) {
      const existing = await repos.sessions.findByStartOperation(req.ownerId, req.opId);
      if (existing) return { ok: true, aggregate: existing, notes: [], duplicate: true, fits: {}, today: null };
      const active = await repos.sessions.getActive(req.ownerId);
      if (active) {
        return { ok: false, error: { code: 'session_already_active', message: 'Finish or resume the unfinished workout first.', sessionId: active.session.id } };
      }
    }
    const owner = await repos.profiles.get(req.ownerId);
    if (!owner) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
    const routine = await repos.routines.get(req.routineId);
    if (!routine || routine.ownerId !== req.ownerId || isDeleted(routine)) return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };
    const exercises = new Map<string, Exercise>();
    for (const rex of routine.exercises) {
      const ex = await repos.exercises.get(rex.exerciseId);
      if (ex) exercises.set(ex.id, ex);
    }
    // Ben's other gyms: to find the same kind of equipment here when the routine's item is elsewhere.
    const knownEquipment = new Map<string, EquipmentInstance>();
    for (const g of await repos.gyms.listByOwner(req.ownerId)) for (const e of await repos.equipment.listByGym(g.id)) knownEquipment.set(e.id, e);
    // The routine's own items too (as Start does), so a note names the item even when its gym isn't listed.
    for (const rex of routine.exercises) {
      if (rex.equipmentId === null || knownEquipment.has(rex.equipmentId)) continue;
      const eq = await repos.equipment.get(rex.equipmentId);
      if (eq) knownEquipment.set(eq.id, eq);
    }
    const gym = await repos.gyms.get(req.gymId);
    const out = planWithTodayEdits({ kind: 'routine', input: {
      opId: req.opId,
      owner,
      gymId: req.gymId,
      routine,
      exercises,
      gymEquipment: req.preview && req.gymEquipment ? req.gymEquipment : await repos.equipment.listByGym(req.gymId),
      knownEquipment,
      at: req.at,
      newId,
      checkIn: req.checkIn ?? null,
      ...(req.targets ? { targets: req.targets } : {}),
      ...(gym ? { gymName: gym.name } : {}),
      ...(req.lastUsedHere ? { lastUsedHere: req.lastUsedHere } : {}),
    } }, req.today ?? NO_EDITS);
    const today: TodayPlanInfo = { slotOf: out.slotOf, setTemplateIds: out.setTemplateIds, outcomes: out.outcomes, resolved: out.resolved, slots: out.slots, baseSlots: out.baseSlots, plannedShape: out.plannedShape };
    if (out.aggregate.exercises.length === 0) return { ok: false, error: { code: 'nothing_to_start', message: 'This workout has no exercises to start.' } };
    if (req.preview) return { ok: true, aggregate: out.aggregate, notes: out.notes, duplicate: false, fits: out.fits, today };
    const saved = await trySave(() => repos.sessions.save(out.aggregate, null, req.fence));
    if (saved === 'threw') return { ok: false, error: WRITE_FAILED };
    if (!saved.ok) return { ok: false, error: saved.error === 'stale_inputs' ? STALE_INPUTS : { code: 'write_conflict', message: 'Could not create the session.' } };
    return { ok: true, aggregate: out.aggregate, notes: out.notes, duplicate: false, fits: out.fits, today };
  }

  async function dispatch(sessionId: string, rawCommand: unknown): Promise<CommandOutcome> {
    const parsed = validate(SessionCommandSchema, rawCommand);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'invalid_command', message: 'Command failed validation.', issues: parsed.issues } };
    }
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      const current = await repos.sessions.get(sessionId);
      if (!current) return { ok: false, error: { code: 'not_found', message: 'Session not found.' } };
      const result = reduceSession(current, parsed.value);
      if (!result.ok) {
        // Keep any timer expiry observed before the rejection (review M6). A
        // conflict here is harmless: whoever wrote first has caught up too.
        if (result.state !== current) await trySave(() => repos.sessions.save(result.state, current.revision));
        return { ok: false, error: result.error };
      }
      if (result.state === current) {
        return { ok: true, aggregate: current, events: result.events, duplicate: result.duplicate, superseded: result.superseded };
      }
      const saved = await trySave(() => repos.sessions.save(result.state, current.revision));
      // The write may or may not have landed; a retry with the same opId is safe either way.
      if (saved === 'threw') return { ok: false, error: WRITE_FAILED };
      if (saved.ok) return { ok: true, aggregate: result.state, events: result.events, duplicate: false, superseded: false };
    }
    return { ok: false, error: { code: 'write_conflict', message: 'The workout kept changing; try again.' } };
  }

  /**
   * Add a catalogue exercise to the session (empty workout, or "Add exercise").
   * Resolves the exercise and profile so the command carries a trusted snapshot.
   */
  async function addExercise(
    sessionId: string,
    req: {
      ownerId: string;
      exerciseId: string;
      equipmentId: string | null;
      opId: string;
      at: ZonedTimestamp;
      plan?: AddExerciseInput['plan'] | undefined;
      exerciseRestS?: number | null | undefined;
    },
  ): Promise<CommandOutcome> {
    const owner = await repos.profiles.get(req.ownerId);
    if (!owner) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
    const exercise = await repos.exercises.get(req.exerciseId);
    if (!exercise) return { ok: false, error: { code: 'not_found', message: 'Exercise not found.' } };
    return dispatch(sessionId, buildAddExerciseCommand({ ...req, owner, exercise, newId }));
  }

  /** Cold-start recovery: restore the unfinished session (if any) without committing anything. */
  async function recover(ownerId: string, at: ZonedTimestamp): Promise<RecoveryResult | null> {
    const stored = await repos.sessions.getActive(ownerId);
    if (!stored) return null;
    const result = recoverSession(stored, at);
    if (result.state.revision !== stored.revision) {
      // If storage throws, the caught-up state is still shown; it is re-derived from deadlines on the next read.
      const saved = await trySave(() => repos.sessions.save(result.state, stored.revision));
      if (saved !== 'threw' && !saved.ok) {
        return recoverSession((await repos.sessions.get(stored.session.id)) ?? stored, at);
      }
    }
    return result;
  }

  return { start, startFromSession, startRoutine, dispatch, addExercise, recover };
}

export type SessionService = ReturnType<typeof createSessionService>;
