import {
  SessionCommandSchema,
  validate,
  type Exercise,
  type SessionAggregate,
  type ValidationIssue,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { Repositories } from './ports';
import { startWorkout, type StartWarning } from './session/create';
import { recoverSession, type RecoveryResult } from './session/recovery';
import { reduceSession, type SessionError, type SessionEvent } from './session/reducer';

export type ServiceError =
  | SessionError
  | { code: 'invalid_command'; message: string; issues: ValidationIssue[] }
  | { code: 'not_found'; message: string }
  | { code: 'session_already_active'; message: string; sessionId: string }
  | { code: 'write_conflict'; message: string };

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
}

const MAX_CONFLICT_RETRIES = 2;

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
    });
    const saved = await repos.sessions.save(aggregate, null);
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
      if (!result.ok) return { ok: false, error: result.error };
      if (result.state === current) {
        return { ok: true, aggregate: current, events: result.events, duplicate: result.duplicate, superseded: result.superseded };
      }
      const saved = await repos.sessions.save(result.state, current.revision);
      if (saved.ok) return { ok: true, aggregate: result.state, events: result.events, duplicate: false, superseded: false };
    }
    return { ok: false, error: { code: 'write_conflict', message: 'The workout kept changing; try again.' } };
  }

  /** Cold-start recovery: restore the unfinished session (if any) without committing anything. */
  async function recover(ownerId: string, at: ZonedTimestamp): Promise<RecoveryResult | null> {
    const stored = await repos.sessions.getActive(ownerId);
    if (!stored) return null;
    const result = recoverSession(stored, at);
    if (result.state.revision !== stored.revision) {
      const saved = await repos.sessions.save(result.state, stored.revision);
      if (!saved.ok) return recoverSession((await repos.sessions.get(stored.session.id)) ?? stored, at);
    }
    return result;
  }

  return { start, dispatch, recover };
}

export type SessionService = ReturnType<typeof createSessionService>;
