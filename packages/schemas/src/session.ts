import { z } from 'zod';
import {
  DurationSecondsSchema,
  IdSchema,
  LoadConventionSchema,
  LoadSchema,
  OperationIdSchema,
  RepRangeSchema,
  RirSchema,
  RpeSchema,
  UtcTimestampSchema,
  WeightUnitSchema,
  ZonedTimestampSchema,
} from './common';
import { EquipmentInstanceSchema } from './equipment';
import { LateralitySchema, MeasurementSchema } from './exercise';
import { SetTypeSchema } from './routine';

/** Values a set can hold: used for actual results and drafts alike. */
export const SetValuesSchema = z.object({
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(1000).nullable(),
  durationS: DurationSecondsSchema.nullable(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
});
export type SetValues = z.infer<typeof SetValuesSchema>;

/** Planned (target) values, retained separately from the actual result. */
export const PlannedSetSchema = z.object({
  load: LoadSchema.nullable(),
  reps: RepRangeSchema.nullable(),
  durationS: DurationSecondsSchema.nullable(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
});
export type PlannedSet = z.infer<typeof PlannedSetSchema>;

export const RestSourceSchema = z.enum([
  'set_override',
  'routine_set_type',
  'exercise_default',
  'global_default',
]);
export type RestSource = z.infer<typeof RestSourceSchema>;

/** Rest duration resolved and snapshotted when the session starts. */
export const ResolvedRestSchema = z.object({
  seconds: DurationSecondsSchema,
  source: RestSourceSchema,
  sourceLabel: z.string().max(200),
});
export type ResolvedRest = z.infer<typeof ResolvedRestSchema>;

/**
 * `deleted` is a tombstone: the row is kept (with its values) for the audit and
 * a later undo, but it is excluded from execution order, history and volume.
 */
export const SetStatusSchema = z.enum(['pending', 'completed', 'skipped', 'deleted']);
export type SetStatus = z.infer<typeof SetStatusSchema>;

/** `off_profile_load`: actual load isn't achievable on the snapshotted equipment. */
export const SetFlagSchema = z.enum(['off_profile_load']);
export type SetFlag = z.infer<typeof SetFlagSchema>;

/**
 * Side of a unilateral set (brief §4: record per side, don't double-count).
 * - `both`: the values are per side and were done on each side ("10 each side").
 * - `left` / `right`: the values are for that side only.
 * Always null on bilateral exercises.
 */
export const SetSideSchema = z.enum(['left', 'right', 'both']);
export type SetSide = z.infer<typeof SetSideSchema>;

export const WorkoutSetSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  sessionExerciseId: IdSchema,
  /** 0-based position within the session exercise. */
  index: z.int().min(0),
  setType: SetTypeSchema,
  status: SetStatusSchema,
  side: SetSideSchema.nullable(),
  /**
   * Set only on an other-side companion: the unilateral set whose single-side
   * (left or right) log created this row. The pair is one prescribed set (review R4).
   */
  pairedWithSetId: IdSchema.nullable(),
  planned: PlannedSetSchema,
  rest: ResolvedRestSchema,
  actual: SetValuesSchema.nullable(),
  /** Unsaved edits; never counted as a result. */
  draft: SetValuesSchema.nullable(),
  completedAt: ZonedTimestampSchema.nullable(),
  completedByOpId: OperationIdSchema.nullable(),
  /** Number of times a logged result was undone; drives the next draft opId. */
  undoCount: z.int().min(0),
  flags: z.array(SetFlagSchema),
  edited: z.boolean(),
  version: z.int().min(1),
}).refine(
  // A result exists exactly when the set is completed (a deleted tombstone may keep either shape).
  (s) => s.status === 'deleted' || (s.status === 'completed') === (s.actual !== null && s.completedAt !== null),
  { message: 'A completed set has an actual result and completion time; other sets have neither', path: ['status'] },
);
export type WorkoutSet = z.infer<typeof WorkoutSetSchema>;

export const SessionExerciseSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  exerciseId: IdSchema,
  /** Snapshot so history survives catalogue renames. */
  exerciseName: z.string().min(1).max(120),
  measurement: MeasurementSchema,
  /** Snapshot: unilateral sets carry a `side`. */
  laterality: LateralitySchema,
  equipmentId: IdSchema.nullable(),
  loadConvention: LoadConventionSchema,
  unit: WeightUnitSchema,
  order: z.int().min(0),
  supersetGroup: z.string().min(1).max(8).nullable(),
  transitionRestS: DurationSecondsSchema.nullable(),
  progressionRuleId: IdSchema.nullable(),
});
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;

export const PauseStateSchema = z.object({
  pausedAtUtc: UtcTimestampSchema,
});
export type PauseState = z.infer<typeof PauseStateSchema>;

/**
 * A closed pause, stored as recorded and never clipped (review R1, ADR 0003).
 * Duration counts only the part of each pause that overlaps the session's
 * current start→end window, so a corrected start or end time can't subtract
 * pauses that happened outside it.
 */
export const PauseIntervalSchema = z.object({
  startUtc: UtcTimestampSchema,
  /** Never before `startUtc` (the reducer closes pauses at max(start, now)). */
  endUtc: UtcTimestampSchema,
});
export type PauseInterval = z.infer<typeof PauseIntervalSchema>;

export const WorkoutSessionSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  routineId: IdSchema.nullable(),
  routineName: z.string().max(120).nullable(),
  gymId: IdSchema,
  /** Operation ID that created the session; makes startWorkout idempotent. */
  startOperationId: OperationIdSchema,
  status: z.enum(['active', 'finished', 'discarded']),
  source: z.enum(['manual', 'import']),
  startedAt: ZonedTimestampSchema,
  endedAt: ZonedTimestampSchema.nullable(),
  /**
   * Content version: bumps on set/plan changes (log, correct, undo, active-set
   * change, finish). Proposals bind to this. Timer nudges and pause don't bump it.
   */
  version: z.int().min(1),
  activeSetId: IdSchema.nullable(),
  equipmentSnapshot: z.array(EquipmentInstanceSchema),
  /** The open pause, if the workout is paused now. */
  pause: PauseStateSchema.nullable(),
  /** Every closed pause, in order, unclipped. */
  pauses: z.array(PauseIntervalSchema),
  lastActivityAtUtc: UtcTimestampSchema,
});
export type WorkoutSession = z.infer<typeof WorkoutSessionSchema>;

export const TimerStatusSchema = z.enum([
  'running',
  'paused',
  'expired',
  'skipped',
  'ended_early',
  'cancelled',
]);
export type TimerStatus = z.infer<typeof TimerStatusSchema>;

export const RestTimerSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  /** The set whose commit started this timer. */
  setId: IdSchema,
  kind: z.enum(['rest', 'transition']),
  durationS: DurationSecondsSchema,
  source: RestSourceSchema.nullable(),
  startedAtUtc: UtcTimestampSchema,
  deadlineUtc: UtcTimestampSchema,
  status: TimerStatusSchema,
  remainingMsAtPause: z.int().min(0).nullable(),
  endedAtUtc: UtcTimestampSchema.nullable(),
  version: z.int().min(1),
});
export type RestTimer = z.infer<typeof RestTimerSchema>;

export const WorkIntervalSchema = z.object({
  setId: IdSchema,
  durationS: DurationSecondsSchema,
  startedAtUtc: UtcTimestampSchema,
  deadlineUtc: UtcTimestampSchema,
  status: z.enum(['running', 'paused', 'completed', 'stopped', 'cancelled']),
  remainingMsAtPause: z.int().min(0).nullable(),
  /** Paused time inside this interval, excluded from elapsed work. */
  pausedMs: z.int().min(0),
  endedAtUtc: UtcTimestampSchema.nullable(),
});
export type WorkInterval = z.infer<typeof WorkIntervalSchema>;

export const SetSnapshotSchema = z.object({
  status: SetStatusSchema,
  setType: SetTypeSchema,
  side: SetSideSchema.nullable(),
  actual: SetValuesSchema.nullable(),
  version: z.int().min(1),
});
export type SetSnapshot = z.infer<typeof SetSnapshotSchema>;

/** Append-only audit of every change to a set's result. */
export const SetAuditEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: IdSchema,
  setId: IdSchema,
  opId: OperationIdSchema,
  kind: z.enum(['logged', 'corrected', 'undone', 'skipped', 'deleted']),
  atUtc: UtcTimestampSchema,
  before: SetSnapshotSchema.nullable(),
  after: SetSnapshotSchema.nullable(),
});
export type SetAuditEntry = z.infer<typeof SetAuditEntrySchema>;

/**
 * Append-only audit of session timing changes. The first entry for a field
 * keeps the originally recorded value in `before` (review M7, ADR 0003 S5).
 * - `finish`: Finish was confirmed with a chosen end time; `before` is the tap time.
 * - `correction`: a later `update_session_timing` edit.
 */
export const SessionTimingAuditEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: IdSchema,
  opId: OperationIdSchema,
  field: z.enum(['startedAt', 'endedAt']),
  source: z.enum(['finish', 'correction']),
  atUtc: UtcTimestampSchema,
  before: ZonedTimestampSchema.nullable(),
  after: ZonedTimestampSchema,
});
export type SessionTimingAuditEntry = z.infer<typeof SessionTimingAuditEntrySchema>;

export const ProcessedOperationSchema = z.object({
  opId: OperationIdSchema,
  commandType: z.string().min(1),
  fingerprint: z.string(),
  atUtc: UtcTimestampSchema,
});
export type ProcessedOperation = z.infer<typeof ProcessedOperationSchema>;

/**
 * Everything needed to restore an active workout after a force-close. The
 * SQLite adapter persists this across normalized tables in one transaction.
 */
export const SessionAggregateSchema = z.object({
  session: WorkoutSessionSchema,
  exercises: z.array(SessionExerciseSchema),
  sets: z.array(WorkoutSetSchema),
  restTimer: RestTimerSchema.nullable(),
  workInterval: WorkIntervalSchema.nullable(),
  audit: z.array(SetAuditEntrySchema),
  timingAudit: z.array(SessionTimingAuditEntrySchema),
  processedOps: z.record(z.string(), ProcessedOperationSchema),
  /** Storage revision: bumps on every persisted change (optimistic concurrency). */
  revision: z.int().min(0),
});
export type SessionAggregate = z.infer<typeof SessionAggregateSchema>;
