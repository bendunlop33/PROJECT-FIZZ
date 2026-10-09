import {
  SessionCommandSchema,
  validate,
  type Exercise,
  type SessionAggregate,
  type SessionCheckIn,
  type ValidationIssue,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { Repositories, SaveResult } from './ports';
import { buildAddExerciseCommand, startWorkout, type AddExerciseInput, type StartWarning } from './session/create';
import { recoverSession, type RecoveryResult } from './session/recovery';
import { reduceSession, type SessionError, type SessionEvent } from './session/reducer';

export type ServiceError =
  | SessionError
  | { code: 'invalid_command'; message: string; issues: ValidationIssue[] }
  | { code: 'not_found'; message: string }
  | { code: 'session_already_active'; message: string; sessionId: string }
  | { code: 'write_conflict'; message: string }
  /** Storage threw (e.g. SQLite full or locked). Nothing was committed by us; retry with the same opId. */
  | { code: 'write_failed'; message: string };

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
}

const MAX_CONFLICT_RETRIES = 2;

const WRITE_FAILED = {
  code: 'write_failed',
  message: "Couldn't save this change. Your entry is still here; try again.",
} as const;

/** Run a save, turning a thrown storage error into a value. */
async function trySave(save: () => Promise<SaveResult>): Promise<SaveResult | 'threw'> {
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
    if (req.routineId !== null && !routine) return { ok: false, error: { code: 'not_found', message: 'Routine not found.' } };

    const exercises = new Map<string, Exercise>();
    for (const rex of routine?.exercises ?? []) {
      const ex = await repos.exercises.get(rex.exerciseId);
      if (ex) exercises.set(ex.id, ex);
    }
    const gymEquipment = await repos.equipment.listByGym(req.gymId);
    const { aggregate, warnings } = startWorkout({
      opId: req.opId,
      owner,
      gymId: req.gymId,
      routine,
      exercises,
      gymEquipment,
      at: req.at,
      newId,
      checkIn: req.checkIn ?? null,
    });
    const saved = await trySave(() => repos.sessions.save(aggregate, null));
    if (saved === 'threw') return { ok: false, error: WRITE_FAILED };
    if (!saved.ok) return { ok: false, error: { code: 'write_conflict', message: 'Could not create the session.' } };
    return { ok: true, aggregate, warnings, duplicate: false };
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

  return { start, dispatch, addExercise, recover };
}

export type SessionService = ReturnType<typeof createSessionService>;
