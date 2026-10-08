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

export const UndoLogCommandSchema = z.object({
  type: z.literal('undo_log'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  expectedVersion: z.int().min(1),
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

export const FinishCommandSchema = z.object({
  type: z.literal('finish'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  /** Optional corrected end time (e.g. forgotten Finish); defaults to `at`. */
  endedAt: ZonedTimestampSchema.nullable(),
});

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
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand['type'];
export type CommandOf<T extends SessionCommandType> = Extract<SessionCommand, { type: T }>;
