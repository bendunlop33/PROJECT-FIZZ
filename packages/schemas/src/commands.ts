import { z } from 'zod';
import {
  DurationSecondsSchema,
  IdSchema,
  OperationIdSchema,
  ZonedTimestampSchema,
} from './common';
import { SetTypeSchema } from './routine';
import { SetValuesSchema } from './session';

/**
 * Typed commands for the active-session state machine. Every mutating command
 * carries an operation ID (idempotency) and `at`, the moment it was issued.
 * UI taps, voice turns and coach tools all produce these same commands.
 */
const base = {
  at: ZonedTimestampSchema,
};

export const LogSetCommandSchema = z.object({
  type: z.literal('log_set'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  values: SetValuesSchema,
  /** ID for the rest timer this commit may start (generated with the draft). */
  restTimerId: IdSchema,
});

export const SaveDraftCommandSchema = z.object({
  type: z.literal('save_draft'),
  ...base,
  setId: IdSchema,
  values: SetValuesSchema,
});

export const SetActiveSetCommandSchema = z.object({
  type: z.literal('set_active_set'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  expectedVersion: z.int().min(1),
});

export const CorrectSetCommandSchema = z.object({
  type: z.literal('correct_set'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  /** The set's own version, not the session's. */
  expectedSetVersion: z.int().min(1),
  patch: SetValuesSchema.partial().extend({ setType: SetTypeSchema.optional() }),
});

/**
 * Undo the most recent commit. Guarded on the set's own version (the version
 * the UI currently shows) plus "this set is still the latest commit" by commit
 * order, not on the session version, so Log → RPE chip → Undo works (ADR 0003 S1).
 */
export const UndoLogCommandSchema = z.object({
  type: z.literal('undo_log'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  expectedSetVersion: z.int().min(1),
});

export const AdjustRestCommandSchema = z.object({
  type: z.literal('adjust_rest'),
  ...base,
  opId: OperationIdSchema,
  timerId: IdSchema,
  deltaS: z.int().min(-3600).max(3600),
});

export const SkipRestCommandSchema = z.object({
  type: z.literal('skip_rest'),
  ...base,
  opId: OperationIdSchema,
  timerId: IdSchema,
});

export const StartWorkIntervalCommandSchema = z.object({
  type: z.literal('start_work_interval'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  durationS: DurationSecondsSchema.refine((d) => d > 0, { message: 'Duration must be > 0' }),
});

export const StopWorkIntervalCommandSchema = z.object({
  type: z.literal('stop_work_interval'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
});

export const PauseCommandSchema = z.object({
  type: z.literal('pause'),
  ...base,
  opId: OperationIdSchema,
});

export const ResumeCommandSchema = z.object({
  type: z.literal('resume'),
  ...base,
  opId: OperationIdSchema,
});

/** Observe the clock: expires timers. Never commits a set. */
export const TickCommandSchema = z.object({
  type: z.literal('tick'),
  ...base,
});

/**
 * Finish (`finishWorkout(sessionId, expectedVersion, endedAt?)`). The end time
 * chosen on the finish sheet is part of this one transaction (ADR 0003 S5). It
 * must lie between the last completed set and `at`; when it differs from `at`,
 * the tap time is kept in the timing audit. Rejected while a work timer is
 * running or paused: stop it and Log or leave it first (ADR 0003 S4).
 */
export const FinishCommandSchema = z.object({
  type: z.literal('finish'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  /** Chosen end time (e.g. forgotten Finish: last set + 3 min); null = `at`. */
  endedAt: ZonedTimestampSchema.nullable(),
});

/**
 * Later correction of the workout's start or end time ("Edit workout times").
 * Every change is audited with the previous value. `endedAt` can only be set
 * on a finished workout. Nothing may move outside the logged sets or into the future.
 */
export const UpdateSessionTimingCommandSchema = z
  .object({
    type: z.literal('update_session_timing'),
    ...base,
    opId: OperationIdSchema,
    expectedVersion: z.int().min(1),
    startedAt: ZonedTimestampSchema.nullable(),
    endedAt: ZonedTimestampSchema.nullable(),
  })
  .refine((c) => c.startedAt !== null || c.endedAt !== null, { message: 'Nothing to change' });

export const SessionCommandSchema = z.discriminatedUnion('type', [
  LogSetCommandSchema,
  SaveDraftCommandSchema,
  SetActiveSetCommandSchema,
  CorrectSetCommandSchema,
  UndoLogCommandSchema,
  AdjustRestCommandSchema,
  SkipRestCommandSchema,
  StartWorkIntervalCommandSchema,
  StopWorkIntervalCommandSchema,
  PauseCommandSchema,
  ResumeCommandSchema,
  TickCommandSchema,
  FinishCommandSchema,
  UpdateSessionTimingCommandSchema,
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand['type'];
export type CommandOf<T extends SessionCommandType> = Extract<SessionCommand, { type: T }>;
