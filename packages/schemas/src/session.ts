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
import { SessionCheckInSchema } from './checkin';
import { LocalDateSchema } from './import';
import { EquipmentInstanceSchema } from './equipment';
import { EquipmentKindSchema, LateralitySchema, MeasurementSchema } from './exercise';
import { SetTypeSchema } from './routine';
import { SessionTodayEditsSchema } from './draft';

/** Values a set can hold: used for actual results and drafts alike. */
export const SetValuesSchema = z.object({
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(1000).nullable(),
  durationS: DurationSecondsSchema.nullable(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
});
export type SetValues = z.infer<typeof SetValuesSchema>;

/**
 * How a target was fitted to a gym's equipment (gym-switch.md §6.1, ADR 0019).
 * `restored`: back to the intended target after an earlier fit lowered or
 * dropped it. `dropped`: no load target (reps and time are kept).
 */
export const SnapOutcomeSchema = z.enum(['exact', 'rounded', 'capped', 'converted', 'restored', 'dropped']);
export type SnapOutcome = z.infer<typeof SnapOutcomeSchema>;

/** Why a load target was dropped. `pain_flag`: an active pain flag stops a load coming back (rule 9). */
export const SnapReasonSchema = z.enum(['not_here', 'convention_mismatch', 'unit_not_convertible', 'no_achievable_loads', 'lightest_is_harder', 'pain_flag']);
export type SnapReason = z.infer<typeof SnapReasonSchema>;

/** Which caller of `snapPlanToGym` fitted the target. */
export const SnapModeSchema = z.enum(['start', 'repeat', 'gym_switch', 'equipment_update']);
export type SnapMode = z.infer<typeof SnapModeSchema>;

/**
 * GS-S1: the target as its author set it (`intended`) and how it was fitted
 * here. Written only by `snapPlanToGym`; never changes who set the target
 * (`source`). A later fit always starts from `intended`, never from the
 * fitted load, so switching back restores the plan (gym-switch GS2).
 * `intendedOn` is the equipment the intended target was made for; it never
 * changes on a fit. Absent = the load is exactly the intended target on the
 * row's own equipment.
 */
export const PlannedSnapSchema = z
  .object({
    intended: LoadSchema.nullable(),
    intendedOn: z
      .object({ equipmentId: IdSchema, kind: EquipmentKindSchema, gymId: IdSchema, name: z.string().min(1).max(120) })
      .nullable(),
    outcome: SnapOutcomeSchema,
    reason: SnapReasonSchema.optional(),
    /** A pain flag kept the load at or below the target it had (rule 9). */
    painHeld: z.literal(true).optional(),
    /** The equipment and gym the load was fitted to (null: no equipment). */
    equipmentId: IdSchema.nullable(),
    gymId: IdSchema.nullable(),
    by: SnapModeSchema,
  })
  .refine((s) => (s.outcome === 'dropped') === (s.reason !== undefined), { message: 'A dropped target has a reason; other outcomes have none', path: ['reason'] });
export type PlannedSnap = z.infer<typeof PlannedSnapSchema>;

export const RestSourceSchema = z.enum([
  'set_override',
  'routine_set_type',
  'exercise_default',
  'global_default',
]);
export type RestSource = z.infer<typeof RestSourceSchema>;

/**
 * Where a set's rest came from. `not_recorded`: an imported set whose source
 * file has no rest at all (FitNotes); its seconds are 0 and mean nothing, so
 * rest analytics must skip it (review N6). Never used for a rest timer.
 */
export const SetRestSourceSchema = z.enum([...RestSourceSchema.options, 'not_recorded']);
export type SetRestSource = z.infer<typeof SetRestSourceSchema>;

/** Rest duration resolved and snapshotted when the session starts. */
export const ResolvedRestSchema = z.object({
  seconds: DurationSecondsSchema,
  source: SetRestSourceSchema,
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
 * Why Ben left a logged set out of records and progress (active-workout.md
 * §2.13, AW5). Set only by Ben, never inferred. A flagged set stays in the
 * log and in volume, but isn't used for records, estimated 1RM, progression,
 * comparisons or coach offers (`isSetCountable`).
 * - `spotted`: someone helped with reps.
 * - `pain`: it hurt (also puts a pain flag on the movement, AW7).
 * - `technique`: form broke (`Form broke`).
 * - `other_equipment`: not the usual equipment for this exercise's history.
 */
export const SetExclusionSchema = z.enum(['spotted', 'pain', 'technique', 'other_equipment']);
export type SetExclusion = z.infer<typeof SetExclusionSchema>;

/** At most one of each reason. Order isn't meaningful; writers store the canonical order (`normaliseExclusions`). */
export const SetExclusionsSchema = z
  .array(SetExclusionSchema)
  .max(SetExclusionSchema.options.length)
  .refine((xs) => new Set(xs).size === xs.length, { message: 'Each exclusion reason at most once' });

/**
 * Side of a unilateral set (brief §4: record per side, don't double-count).
 * - `both`: the values are per side and were done on each side ("10 each side").
 * - `left` / `right`: the values are for that side only.
 * Always null on bilateral exercises.
 */
export const SetSideSchema = z.enum(['left', 'right', 'both']);
export type SetSide = z.infer<typeof SetSideSchema>;

/**
 * `Why?` on a set target (active-workout.md §2.12, AW3): what produced the
 * number, written once by whichever path set the target and never
 * recomputed. Owner-scoped (Your data). All text in here is deterministic app
 * text; nothing comes from a model.
 *
 * Sources written today: `plan` (a routine's template, `startWorkout`),
 * `rule` (the built-in rule's next targets, `plannedSetsFromTargets`),
 * `repeat` (a past workout's actual result, routines.md RT4) and `coach`
 * (a coach adjustment of today's sets or the coach's next-session target,
 * ADR 0020 §4). The coach's own reason is the one model-written text here:
 * it is shown in quotes as the coach's words, never as app text. The
 * warm-up, swap and builder sources in the spec are added with the code
 * that sets those targets.
 */
export const TargetSourceSchema = z.enum(['plan', 'rule', 'repeat', 'coach']);
export type TargetSource = z.infer<typeof TargetSourceSchema>;

/** A set the target was built from, as it was when the target was made (an **actual** result). */
export const TargetBasisSetSchema = z.object({
  /** Absent only when the history row had no ID (never for sets logged in the app). */
  setId: IdSchema.optional(),
  /** The set's version then; a later correction bumps it (`Based on 1 Oct before you edited it`). */
  version: z.int().min(1).optional(),
  /** The set's number as the card showed it (`Set 4`, warm-ups included); absent on targets stored before it was. */
  number: z.int().min(1).max(200).optional(),
  setType: SetTypeSchema,
  side: SetSideSchema.nullable(),
  values: SetValuesSchema,
  /** Ben's exclusion flags on the set then (§2.13): listed under `Not used` in `Why?`. */
  exclusions: SetExclusionsSchema.optional(),
});
export type TargetBasisSet = z.infer<typeof TargetBasisSetSchema>;

/** The past workout a target was built from (`Last time`). */
export const TargetBasisSchema = z.object({
  sessionId: IdSchema,
  performedAt: ZonedTimestampSchema,
  routineName: z.string().max(120).nullable(),
  gymId: IdSchema.nullable(),
  equipmentId: IdSchema.nullable(),
  sets: z.array(TargetBasisSetSchema).max(60),
});
export type TargetBasis = z.infer<typeof TargetBasisSchema>;

/** `calculateNextTargets` decisions, stored with the rule's own words. */
export const RuleDecisionSchema = z.enum([
  'insufficient_data',
  'increase_load',
  'increase_reps',
  'hold',
  'hold_after_miss',
  'reduce_load',
  'ceiling_reached',
  'halted_pain',
  'no_feasible_load',
  'unsupported',
]);
export type RuleDecision = z.infer<typeof RuleDecisionSchema>;

/** The load change from the basis to the target, measured on the equipment (`buildStepCard`). */
export const TargetStepSchema = z.object({
  from: LoadSchema,
  to: LoadSchema,
  /** (to − from) / from × 100, one decimal place; null when `from` is 0. */
  pctChange: z.number().nullable(),
  /** `to` is the next achievable load after `from` in that direction. */
  smallest: z.boolean(),
  equipmentKind: EquipmentKindSchema.nullable(),
});
export type TargetStep = z.infer<typeof TargetStepSchema>;

export const TargetProvenanceSchema = z.object({
  source: TargetSourceSchema,
  /** When the target was made. */
  setAt: ZonedTimestampSchema,
  /** `plan`: the routine's name. */
  routineName: z.string().max(120).nullable(),
  /** The load asked for before the equipment fit (template or last time's), if any. */
  requestedLoad: LoadSchema.nullable(),
  basis: TargetBasisSchema.nullable(),
  /** `rule`: the built-in rule's own explanation, as `calculateNextTargets` gave it. */
  rule: z
    .object({
      name: z.string().min(1).max(300),
      decision: RuleDecisionSchema,
      summary: z.string().max(600),
      facts: z.array(z.string().max(600)).max(20),
    })
    .optional(),
  step: TargetStepSchema.optional(),
  /** `coach`: the action that set it (its record has the checks), today or next session, and the coach's reason. */
  coach: z
    .object({
      actionId: IdSchema,
      scope: z.enum(['today', 'next_session']),
      reason: z.string().max(600).nullable(),
    })
    .optional(),
  /** Equipment notes made with the target: rounding, caps, conversions, drops. */
  guardNotes: z.array(z.string().min(1).max(300)).max(10),
});
export type TargetProvenance = z.infer<typeof TargetProvenanceSchema>;

/**
 * Where a planned target came from, so the set card can say so (rule 3:
 * every suggestion is recorded with its reason). Absent = a routine template
 * or none (sessions written before this field existed).
 * - `built_in_rule`: the built-in progression rule's Next time (ADR 0006 fallback).
 * - `repeat`: copied from a past workout's actual result (routines.md RT4).
 * - `coach`: a coach adjustment or the coach's next-session target (ADR 0020 §4).
 */
export const PlannedSourceSchema = z.enum(['built_in_rule', 'repeat', 'coach']);
export type PlannedSource = z.infer<typeof PlannedSourceSchema>;

/**
 * Planned (target) values, retained separately from the actual result.
 * `source: 'coach'` (ADR 0020 §4): a coach adjustment set this pending
 * target; `coach` names the action and keeps the whole target it replaced,
 * for `Plan was …` and for Undo, which puts exactly that back.
 */
export interface PlannedSet {
  load: z.infer<typeof LoadSchema> | null;
  reps: z.infer<typeof RepRangeSchema> | null;
  durationS: number | null;
  rpe: number | null;
  rir: number | null;
  source?: PlannedSource | undefined;
  /** Absent on targets made before `Why?` existed (shown as `Not recorded`). */
  provenance?: TargetProvenance | undefined;
  snap?: PlannedSnap | undefined;
  /** `gymChanges`: how many gym-change entries the workout had when the coach made this change (Undo is refused after a later one). */
  coach?: { actionId: string; before: PlannedSet; gymChanges?: number | undefined } | undefined;
}

export const PlannedSetSchema: z.ZodType<PlannedSet> = z.object({
  load: LoadSchema.nullable(),
  reps: RepRangeSchema.nullable(),
  durationS: DurationSecondsSchema.nullable(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
  source: PlannedSourceSchema.optional(),
  provenance: TargetProvenanceSchema.optional(),
  /** How the load was fitted to the gym's equipment (GS-S1); absent = as intended. */
  snap: PlannedSnapSchema.optional(),
  get coach() {
    return z.object({ actionId: IdSchema, before: PlannedSetSchema, gymChanges: z.int().min(0).optional() }).optional();
  },
});

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
  /**
   * Ben's exclusion flags (§2.13): absent or empty = the set counts. Only on
   * completed sets; changed only by `correct_set` (or `log_set.exclusions`),
   * so every change is versioned and audited, never silent (AW6).
   */
  exclusions: SetExclusionsSchema.optional(),
  /**
   * Why a `skipped` set was skipped (ADR 0022 §4): `before_start` from the
   * Workout overview's `Skip today`. Absent = skipped in the workout (or
   * written before this field existed).
   */
  skippedBy: z.enum(['before_start', 'in_workout']).optional(),
  edited: z.boolean(),
  version: z.int().min(1),
}).refine(
  // A result exists exactly when the set is completed (a deleted tombstone may keep either shape).
  (s) => s.status === 'deleted' || (s.status === 'completed') === (s.actual !== null && s.completedAt !== null),
  { message: 'A completed set has an actual result and completion time; other sets have neither', path: ['status'] },
).refine((s) => s.status === 'completed' || s.status === 'deleted' || (s.exclusions ?? []).length === 0, {
  message: 'Only a logged set can be left out of records',
  path: ['exclusions'],
});
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
  /**
   * GS-S3: which version of `equipmentId` in the session's equipment snapshot
   * this row uses. Absent = the latest entry with that ID. Set only when the
   * snapshot holds more than one version of the item (`[Use changes today]`).
   */
  equipmentVersion: z.int().min(1).optional(),
  /**
   * GS-S4: this row holds the sets of `continuesFromId`'s exercise that moved
   * to other equipment on a gym switch, while the done sets stayed on that
   * row (gym-switch GS6). Shown as one exercise in parts. Absent = not a continuation.
   */
  continuesFromId: IdSchema.optional(),
});
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;

/** One pending set as it was before a gym change, for Undo (GS-S2). */
export const GymChangeSetBeforeSchema = z.object({
  id: IdSchema,
  sessionExerciseId: IdSchema,
  planned: PlannedSetSchema,
  draft: SetValuesSchema.nullable(),
});
export type GymChangeSetBefore = z.infer<typeof GymChangeSetBeforeSchema>;

/**
 * GS-S2: an append-only record of each gym change in a workout (switch, or
 * `[Use changes today]` at the same gym) and each Undo of one. `session.gymId`
 * is the current gym. A change keeps what it replaced (`before`), so Undo
 * restores it exactly, also after a relaunch, and only while the plan still
 * has `afterFingerprint` (nothing logged, corrected or changed since).
 */
/** Gym changes and Undos one workout can record; the reducer refuses one past it (review N5). */
export const MAX_GYM_CHANGES = 50;

export const GymChangeSchema = z.object({
  actionId: z.string().min(1).max(128),
  opId: OperationIdSchema,
  kind: z.enum(['change', 'undo']),
  mode: z.enum(['gym_switch', 'equipment_update']),
  at: ZonedTimestampSchema,
  fromGymId: IdSchema.nullable(),
  toGymId: IdSchema,
  /** For `undo`: the change it reverted. */
  undoOf: z.string().min(1).max(128).optional(),
  afterFingerprint: z.string().min(1).max(64),
  /** Pending sets whose target or equipment changed. */
  changedSetIds: z.array(IdSchema).max(200),
  /** Sets whose edited draft couldn't be set up on the new equipment and was replaced (GS12). */
  draftsReplaced: z.array(IdSchema).max(200),
  /**
   * `change` only: the new gym's equipment list as it was at the change (each item's ID
   * and version). The snapshot is a union of every visit, so this is what says which
   * items are at the gym now (review N3). Absent in older records: every snapshot item
   * of that gym counts.
   */
  equipment: z
    .array(z.object({ id: IdSchema, version: z.int().min(1) }))
    .max(500)
    .optional(),
  /** `change` only: every exercise row and moved set as they were before. */
  before: z
    .object({
      exercises: z.array(SessionExerciseSchema).max(200),
      sets: z.array(GymChangeSetBeforeSchema).max(200),
    })
    .optional(),
});
export type GymChange = z.infer<typeof GymChangeSchema>;

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
  /**
   * The gym the workout was done at (after a mid-workout switch: the current
   * one; `gymChanges` has the history). Null only for imported workouts whose
   * gym wasn't recorded (data-import-export §2.5 step 3c, `Not recorded`).
   */
  gymId: IdSchema.nullable(),
  /** GS-S2: every gym change in this workout, in order. Absent = none. */
  gymChanges: z.array(GymChangeSchema).max(MAX_GYM_CHANGES).optional(),
  /** Operation ID that created the session; makes startWorkout idempotent. */
  startOperationId: OperationIdSchema,
  /**
   * `reverted`: an imported workout hidden by `Undo this import` (DX7). Like
   * `discarded`, it is excluded from history, Progress, "Last" values and
   * targets; the rows are kept.
   */
  status: z.enum(['active', 'finished', 'discarded', 'reverted']),
  source: z.enum(['manual', 'import']),
  /** The import job this workout came in with (imported workouts only). */
  importJobId: IdSchema.optional(),
  /**
   * Set only when the time of day isn't known (imported workouts: FitNotes
   * files have dates only). The calendar date as written in the source; the
   * workout is shown with this date and no time. `startedAt` is then only an
   * ordering anchor (12:00 on that date in `startedAt.tz`) and is never shown.
   */
  localDate: LocalDateSchema.optional(),
  startedAt: ZonedTimestampSchema,
  endedAt: ZonedTimestampSchema.nullable(),
  /**
   * Content version: bumps on set/plan changes (log, correct, undo, active-set
   * change, finish). Proposals bind to this. Timer nudges and pause don't bump it.
   */
  version: z.int().min(1),
  activeSetId: IdSchema.nullable(),
  /**
   * The equipment of every gym this workout used, as saved when it started
   * or switched. Append-only and unique by `(id, version)` (GS-S3), so a
   * done set always resolves the equipment it was logged on.
   */
  equipmentSnapshot: z.array(EquipmentInstanceSchema),
  /** The open pause, if the workout is paused now. */
  pause: PauseStateSchema.nullable(),
  /** Every closed pause, in order, unclipped. */
  pauses: z.array(PauseIntervalSchema),
  lastActivityAtUtc: UtcTimestampSchema,
  /**
   * The pre-workout check-in for this session (check-in.md §6), written in the
   * same transaction as the session. Null for sessions recorded before
   * check-ins existed.
   */
  checkIn: SessionCheckInSchema.nullable(),
  /**
   * Ben's `Finish by` for today (active-workout §2.15.3, AW12), Your data.
   * Absent = not set. Changes only the `Time left` wording (and, from build
   * step 4, whether the coach may offer to shorten); never a set or rest.
   */
  finishBy: ZonedTimestampSchema.optional(),
  /** The pre-start draft's edits this workout was started with (ADR 0022 §4). Absent = none. */
  todayEdits: SessionTodayEditsSchema.optional(),
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
  /** Absent on entries written before exclusions existed, and when none were set (`Set 2 marked: spotted`). */
  exclusions: SetExclusionsSchema.optional(),
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
  /**
   * Rows this operation created (`add_set`: the new set), so a duplicate can
   * tell whether its effect is still in place. Absent for other commands.
   */
  createdIds: z.array(IdSchema).max(4).optional(),
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
