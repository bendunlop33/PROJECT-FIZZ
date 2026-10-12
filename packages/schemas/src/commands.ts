import { z } from 'zod';
import {
  DurationSecondsSchema,
  IdSchema,
  LoadConventionSchema,
  LoadSchema,
  OperationIdSchema,
  RepRangeSchema,
  RpeSchema,
  WeightUnitSchema,
  ZonedTimestampSchema,
} from './common';
import { EquipmentInstanceSchema } from './equipment';
import { EquipmentKindSchema, LateralitySchema, MeasurementSchema } from './exercise';
import { SetTypeSchema } from './routine';
import { PlannedSetSchema, PlannedSnapSchema, ResolvedRestSchema, RuleDecisionSchema, SetExclusionsSchema, SetSideSchema, SetValuesSchema } from './session';

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
  /**
   * Unilateral sets only: which side these values are for. Omit to keep the
   * set's side (`both` by default). Rejected on bilateral exercises.
   */
  side: SetSideSchema.optional(),
  /**
   * Log and mark in one go ("100 for 8, spotted", §2.13). Omit or empty = the
   * set counts. `pain` is refused here (review N3): a Pain mark must also
   * flag the movement (AW7, rule 9), which only the correction service does
   * today. Voice logging adds its own service wrapper before allowing it.
   */
  exclusions: SetExclusionsSchema.refine((xs) => !xs.includes('pain'), { message: 'Mark pain through the correction sheet, which also flags the movement' }).optional(),
  /** ID for the rest timer this commit may start (generated with the draft). */
  restTimerId: IdSchema,
});

export const SaveDraftCommandSchema = z.object({
  type: z.literal('save_draft'),
  ...base,
  setId: IdSchema,
  values: SetValuesSchema,
  /** The side chosen for a unilateral set before it is logged; absent = unchanged. */
  side: SetSideSchema.optional(),
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
  /**
   * `exclusions` replaces the set's whole list (§2.13): `[]` clears it. A
   * patch that only changes exclusions doesn't mark the values `Edited`.
   */
  patch: SetValuesSchema.partial().extend({
    setType: SetTypeSchema.optional(),
    side: SetSideSchema.optional(),
    exclusions: SetExclusionsSchema.optional(),
  }),
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

/**
 * Stop the work timer; elapsed time becomes the set's draft. Allowed while the
 * workout is paused: the interval then ends when the pause began (ADR 0003 R2).
 */
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

/**
 * Add a set to an exercise (the "Add set" control). The new set copies the
 * planned values and rest of the exercise's last set. With `setType`, it copies
 * the last set of that type instead, and is rejected when there is none (no
 * target or rest is invented). `newSetId` is generated by the caller and excluded from the fingerprint, so
 * a retry after relaunch with a regenerated ID is still a duplicate.
 */
export const AddSetCommandSchema = z.object({
  type: z.literal('add_set'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  newSetId: IdSchema,
  setType: SetTypeSchema.nullable(),
  /**
   * After a gym switch, a set added to an exercise whose row is on another
   * gym's equipment goes on a new continuation row at the current gym, with
   * its target fitted by `snapPlanToGym` (gym-switch §4.3). Built by the
   * session service; the row ID is excluded from the fingerprint.
   */
  continuation: z
    .object({
      id: IdSchema,
      equipmentId: IdSchema.nullable(),
      unit: WeightUnitSchema,
      loadConvention: LoadConventionSchema,
      planned: PlannedSetSchema,
    })
    .optional(),
});

/** Catalogue values snapshotted into the session when an exercise is added mid-workout. */
export const ExerciseSnapshotSchema = z.object({
  exerciseId: IdSchema,
  name: z.string().min(1).max(120),
  measurement: MeasurementSchema,
  laterality: LateralitySchema,
  defaultLoadConvention: LoadConventionSchema,
  /** Equipment kinds the exercise can use; the reducer rejects any other. */
  compatibleEquipment: z.array(EquipmentKindSchema).max(6),
});
export type ExerciseSnapshot = z.infer<typeof ExerciseSnapshotSchema>;

/**
 * Add an exercise with one empty working set (empty workout, or "Add exercise").
 * The fingerprint covers only the exercise and equipment IDs, so a retry whose
 * snapshot or rest was re-resolved is still a duplicate. Built by the session service from the catalogue and profile
 * (`buildAddExerciseCommand`); coach and voice tools must go through that
 * service call rather than supplying the snapshot themselves.
 */
export const AddExerciseCommandSchema = z.object({
  type: z.literal('add_exercise'),
  ...base,
  opId: OperationIdSchema,
  newSessionExerciseId: IdSchema,
  newSetId: IdSchema,
  exercise: ExerciseSnapshotSchema,
  /** Must be in the session's equipment snapshot; null = no equipment. */
  equipmentId: IdSchema.nullable(),
  /** Unit used when no equipment is attached (the profile's preferred unit). */
  unit: WeightUnitSchema,
  /** Rest after the new set, resolved by the service. */
  rest: ResolvedRestSchema,
  /**
   * Planned sets (e.g. the built-in rule's Next time, review workout-loop S3).
   * The first item's `id` must be `newSetId`. Absent = one empty working set.
   * Loads must be in the exercise's unit and convention; the service plans
   * them from the equipment, so they are achievable and never above its max.
   */
  plan: z
    .array(z.object({ id: IdSchema, setType: SetTypeSchema, planned: PlannedSetSchema }))
    .min(1)
    .max(20)
    .optional(),
});

/**
 * `Rest after` editor (rest-state §2.4) for sets not yet done: `set` changes
 * this set's rest only; `exercise` changes every pending set of its exercise
 * (the service also saves it as Ben's default for that exercise). Never
 * changes a completed set or a running timer. Versioned on the session.
 */
export const SetRestAfterCommandSchema = z.object({
  type: z.literal('set_rest_after'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  seconds: DurationSecondsSchema.refine((s) => s <= 3600, { message: 'At most an hour' }),
  scope: z.enum(['set', 'exercise']),
  expectedVersion: z.int().min(1),
});

/**
 * `Finish by` in the `Time left` sheet (active-workout §2.15.3,
 * `setSessionFinishBy`): today only, or null for `Not set`. Changes no set,
 * load or rest; versioned on the session so a stale sheet is refused.
 */
export const SetFinishByCommandSchema = z.object({
  type: z.literal('set_finish_by'),
  ...base,
  opId: OperationIdSchema,
  finishBy: ZonedTimestampSchema.nullable(),
  expectedVersion: z.int().min(1),
});

/** Delete a set (pending, skipped or logged). Kept as an audited tombstone. */
export const DeleteSetCommandSchema = z.object({
  type: z.literal('delete_set'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  expectedSetVersion: z.int().min(1),
});

/** Mark every pending set of an exercise skipped ("Skip exercise"). Logged sets are untouched. */
export const SkipExerciseCommandSchema = z.object({
  type: z.literal('skip_exercise'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
});

/**
 * Discard the workout. The UI confirms first when any set is logged
 * (active-workout §4.9); `expectedVersion` makes a stale confirmation fail.
 * `confirmedLoggedSets` is the number of logged sets Ben was told would be
 * discarded (0 when nothing was logged and no prompt was shown). The reducer
 * refuses the discard unless it matches, so no caller can discard logged sets
 * without going through the confirmation (review failure-tests M3).
 */
export const DiscardCommandSchema = z.object({
  type: z.literal('discard'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  confirmedLoggedSets: z.int().min(0),
});

/**
 * Rename the workout (premium-feel §2.6). Allowed while it's active and after
 * it's finished; versioned on the session, so a stale rename is rejected.
 * The routine a workout came from is never renamed by this. Undo is another
 * `rename_session` back to the previous name (null when it had none).
 */
export const RenameSessionCommandSchema = z.object({
  type: z.literal('rename_session'),
  ...base,
  opId: OperationIdSchema,
  /** Null clears a finished workout's name (Undo of naming an unnamed one); its title is then worked out when shown. */
  name: z
    .string()
    .trim()
    .min(1, { message: 'Give it a name' })
    .max(120, { message: 'Keep it under 120 characters' })
    .nullable(),
  expectedVersion: z.int().min(1),
});

/** A pending set's new load and reps target (both explicit; unit and convention in the load), and the coach's target RPE if it set one. */
const TargetValuesSchema = z.object({ load: LoadSchema.nullable(), reps: RepRangeSchema.nullable(), rpe: RpeSchema.nullable().optional() });

/**
 * A coach adjustment of today's pending sets (ADR 0020 §4, coach-adjustments
 * path A), already checked by `validateTodayAdjustment`. Pending sets only;
 * `expectedVersion` rejects it if the workout moved on (rule 5). Each
 * changed set gets `planned.source: 'coach'` and keeps the target it
 * replaced, so Undo puts exactly that back. Rest and done sets never change.
 */
export const AdjustPendingTargetsCommandSchema = z.object({
  type: z.literal('adjust_pending_targets'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  actionId: IdSchema,
  /** The coach's reason from the action record, kept on each changed target's `Why?` (in quotes). */
  reason: z.string().max(600).nullable().optional(),
  /**
   * Set when the built-in rule made the change, not the coach (CA6 revised,
   * build 108 F2): each changed target gets `source: 'built_in_rule'` and a
   * `rule` provenance with these words. Absent: the coach's change.
   */
  rule: z
    .object({
      name: z.string().min(1).max(300),
      decision: RuleDecisionSchema,
      summary: z.string().max(600),
      facts: z.array(z.string().max(600)).max(20),
    })
    .optional(),
  changes: z.array(z.object({ setId: IdSchema, target: TargetValuesSchema })).max(40),
  removeSetIds: z.array(IdSchema).max(12),
  /** New pending sets, copying type and rest from `copyFromSetId`. IDs derive from the opId, so a replay adds the same rows. */
  addSets: z.array(z.object({ newSetId: IdSchema, copyFromSetId: IdSchema, target: TargetValuesSchema })).max(12),
});

/**
 * Undo of one coach adjustment (Ben's tap). Restores the replaced target on
 * sets that are still pending and still carry this action's target, puts
 * back sets it removed and removes sets it added, if they're still pending.
 * Sets logged since stay as they are (`Undone for set 4. Set 3 was already
 * logged.`). Never version-gated: it only touches what this action set.
 */
export const RevertTargetAdjustmentCommandSchema = z.object({
  type: z.literal('revert_target_adjustment'),
  ...base,
  opId: OperationIdSchema,
  actionId: IdSchema,
  removedSetIds: z.array(IdSchema).max(12),
  addedSetIds: z.array(IdSchema).max(12),
});

/** One exercise row's pending sets, fitted to the new gym by `snapPlanToGym` (gym-switch §6.4). */
export const ChangeGymSlotSchema = z.object({
  sessionExerciseId: IdSchema,
  /**
   * ID for a continuation row (GS6), used only when this row keeps done,
   * skipped or excluded sets on its old equipment. Generated by the caller
   * and not part of the fingerprint, like `newSetId`.
   */
  continuationId: IdSchema,
  /** The item at the new gym (in `snapshot`), or null for no equipment. */
  equipmentId: IdSchema.nullable(),
  unit: WeightUnitSchema,
  loadConvention: LoadConventionSchema,
  sets: z
    .array(z.object({ setId: IdSchema, load: LoadSchema.nullable(), snap: PlannedSnapSchema.nullable() }))
    .min(1)
    .max(60),
});
export type ChangeGymSlot = z.infer<typeof ChangeGymSlotSchema>;

/**
 * Apply a gym switch (or `[Use changes today]` at the same gym) to the
 * pending sets, as one transaction (gym-switch §4.3). Built by the session
 * service from a proposal; rejected as stale when the plan's fingerprint
 * changed since (GS7). Completed, skipped and deleted sets are never touched.
 * Every load must be achievable on its slot's equipment (rule 4).
 */
export const ChangeGymCommandSchema = z.object({
  type: z.literal('change_gym'),
  ...base,
  opId: OperationIdSchema,
  /** ID of the `gymChanges` entry this creates (Undo refers to it). */
  actionId: IdSchema,
  mode: z.enum(['gym_switch', 'equipment_update']),
  toGymId: IdSchema,
  /** The target gym's equipment as saved now; appended to the session snapshot. */
  snapshot: z.array(EquipmentInstanceSchema).max(300),
  expected: z.object({ gymId: IdSchema.nullable(), fingerprint: z.string().min(1).max(64) }),
  slots: z.array(ChangeGymSlotSchema).max(100),
});

/** Undo a gym change while nothing has changed since (gym-switch §4.5). */
export const UndoChangeGymCommandSchema = z.object({
  type: z.literal('undo_change_gym'),
  ...base,
  opId: OperationIdSchema,
  actionId: z.string().min(1).max(128),
  expectedFingerprint: z.string().min(1).max(64),
});

/**
 * Ben's own target RPE (CHANGELOG 2026-10-11 "Offers follow the target RPE"):
 * for the focused set, its exercise (every part after a gym switch) or
 * today's whole workout. Only pending working sets change (never a logged
 * set, a warm-up or a drop set); it is stored on each set as
 * `planned.rpeOverride` and wins over the coach's and the built-in rule's
 * target. `rpe: null` clears Ben's override. Versioned (`expectedVersion`)
 * and idempotent (`opId`).
 */
export const TargetRpeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set'), setId: IdSchema }),
  z.object({ kind: z.literal('exercise'), sessionExerciseId: IdSchema }),
  z.object({ kind: z.literal('today') }),
]);
export type TargetRpeScope = z.infer<typeof TargetRpeScopeSchema>;

export const SetTargetRpeCommandSchema = z.object({
  type: z.literal('set_target_rpe'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  scope: TargetRpeScopeSchema,
  rpe: RpeSchema.nullable(),
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
  UpdateSessionTimingCommandSchema,
  AddSetCommandSchema,
  AddExerciseCommandSchema,
  DeleteSetCommandSchema,
  SkipExerciseCommandSchema,
  DiscardCommandSchema,
  SetRestAfterCommandSchema,
  RenameSessionCommandSchema,
  SetFinishByCommandSchema,
  AdjustPendingTargetsCommandSchema,
  RevertTargetAdjustmentCommandSchema,
  ChangeGymCommandSchema,
  UndoChangeGymCommandSchema,
  SetTargetRpeCommandSchema,
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand['type'];
export type CommandOf<T extends SessionCommandType> = Extract<SessionCommand, { type: T }>;
