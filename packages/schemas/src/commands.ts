import { z } from 'zod';
import {
  DurationSecondsSchema,
  IdSchema,
  NoteSchema,
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
import { PlannedSetSchema, PlannedSnapSchema, ResolvedRestSchema, RuleDecisionSchema, SessionFeelValueSchema, SetExclusionsSchema, SetSideSchema, SetValuesSchema } from './session';

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
   * `targetRpe` is Ben's own target RPE for this set (`planned.rpeOverride`,
   * CHANGELOG 2026-10-11 (b) "Edit set"): the plan he meant, so an offer
   * judged against the wrong target clears. `null` clears it. It never
   * touches the logged values and doesn't mark them `Edited`.
   */
  patch: SetValuesSchema.partial().extend({
    setType: SetTypeSchema.optional(),
    side: SetSideSchema.optional(),
    exclusions: SetExclusionsSchema.optional(),
    targetRpe: RpeSchema.nullable().optional(),
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
  /**
   * (Ben, 19 Oct: "change start and end by scrolling when finish workout")
   * A corrected start time, chosen on the Finish sheet; absent = unchanged.
   * Checked like `update_session_timing` (not after the first logged set) and audited.
   */
  startedAt: ZonedTimestampSchema.optional(),
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
   * `Insert set after` (14 Oct): the new set goes straight after this live
   * set of the same exercise (after its other side, when it has one) and
   * copies its type, target and rest; later sets move down one place (their
   * values and versions are untouched). Absent: at the end, as before.
   */
  afterSetId: IdSchema.optional(),
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
  /**
   * (12 Oct, coach `add_exercise_today`) Where the new row goes: straight
   * after this live row. Absent = at the end.
   */
  afterSessionExerciseId: IdSchema.optional(),
  /**
   * (12 Oct, coach `add_exercise_today`) Superset the new row with this live
   * row (which must still have a pending set): it joins that row's group, or
   * both get a new group letter, and it goes after the group's last member.
   * Wins over `afterSessionExerciseId`. Undo (`undo_op`) takes the row out
   * and ungroups a member left on its own.
   */
  supersetWithSessionExerciseId: IdSchema.optional(),
});

/**
 * `Rest after` editor (rest-state §2.4) for sets not yet done: `set` changes
 * this set's rest only; `exercise` changes every pending set of its exercise
 * (the service also saves it as Ben's default for that exercise); `type`
 * (workout-table-v3 §7, the exercise pop-up's rest per set type) changes the
 * pending sets of its exercise with the same set type as `setId`, today only;
 * `round` (the pop-up's `After each round` in a superset) changes every pending
 * set of the superset's last member, today only (nothing saved as a default).
 * Never changes a completed set or a running timer. Versioned on the session.
 */
export const SetRestAfterCommandSchema = z.object({
  type: z.literal('set_rest_after'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  seconds: DurationSecondsSchema.refine((s) => s <= 3600, { message: 'At most an hour' }),
  scope: z.enum(['set', 'exercise', 'type', 'round']),
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

/**
 * `Count it` on Progress's Time sheet (progress.md PG25a), and its Undo
 * (`confirmed: false`): a finished workout over the 4 h cap counts in `Time
 * in gym`. Changes no set and no time; versioned and idempotent like every
 * correction.
 */
export const ConfirmSessionDurationCommandSchema = z.object({
  type: z.literal('confirm_session_duration'),
  ...base,
  opId: OperationIdSchema,
  confirmed: z.boolean(),
  expectedVersion: z.int().min(1),
});

/**
 * (Ben, 21 Oct) Summary's `How did it feel?` (Easy / Good / Hard), and its change or clear (null). Only on
 * a finished workout; changes no set and no time; versioned and idempotent like `rename_session`.
 */
export const SetFeelCommandSchema = z.object({
  type: z.literal('set_feel'),
  ...base,
  opId: OperationIdSchema,
  feel: SessionFeelValueSchema.nullable(),
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
 * Swap an exercise mid-workout, picked by Ben (exercise-library EL4, B3:
 * applies at once with Undo). Only the row's **pending** sets move: each is
 * deleted (an audited tombstone) and a new pending set is made on a new row
 * for the substitute, with the same set type and rest and a target fitted by
 * the shared fit (`fitSwap`, rule 4). Done and skipped sets stay on the
 * original row. A row left with no live set is marked removed. Built by the
 * session service; generated IDs are excluded from the fingerprint.
 * Undo is `undo_op` on this command's opId.
 */
export const SwapExerciseCommandSchema = z.object({
  type: z.literal('swap_exercise'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  expectedVersion: z.int().min(1),
  newSessionExerciseId: IdSchema,
  exercise: ExerciseSnapshotSchema,
  /** At the current gym; null = no equipment (bodyweight, or nothing here). */
  equipmentId: IdSchema.nullable(),
  unit: WeightUnitSchema,
  loadConvention: LoadConventionSchema,
  /** One per pending set of the row, in its order: the new set's ID, the set it replaces and its target. */
  sets: z.array(z.object({ newSetId: IdSchema, fromSetId: IdSchema, planned: PlannedSetSchema })).min(1).max(60),
});

/**
 * Remove an exercise added by mistake (exercise-library §4.6): allowed only
 * while none of its sets is logged. Its sets become deleted tombstones and
 * the row is marked removed, so it leaves every view. No confirm; Undo is
 * `undo_op` on this opId.
 */
export const RemoveExerciseCommandSchema = z.object({
  type: z.literal('remove_exercise'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  expectedVersion: z.int().min(1),
  /**
   * (workout-table-v3 §7, `Remove` from `⋯`) An exercise with logged sets:
   * the number of logged sets Ben was asked about (the UI asks first). When
   * it matches, the sets not done yet are deleted (audited tombstones) and
   * the logged ones stay on the row, in history (rule 2); the row stays.
   * Absent or not matching: refused as `exercise_logged`, as before.
   */
  confirmedLoggedSets: z.int().min(1).optional(),
});

/**
 * (workout-table-v3 §7, press-and-hold drag of a set row) The exercise's
 * sets not done yet in a new order. `setIds` must be exactly its pending
 * sets (an other-side row stays with its partner and isn't listed); they
 * take the places pending sets held, so done and skipped sets keep their
 * logged order (rule 2). No value or set version changes. Versioned on the
 * session (rule 5); Undo (`undo_op`) puts the old order back while nothing
 * moved since.
 */
export const ReorderSetsCommandSchema = z.object({
  type: z.literal('reorder_sets'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  setIds: z.array(IdSchema).min(2).max(60),
  expectedVersion: z.int().min(1),
});

/**
 * (workout-table-v3 §7, the exercise pop-up's `＋ Warm-up`) A pending
 * warm-up set, placed in the ramp by load: before the first pending set
 * heavier than it (or the first pending working set), never before a set
 * already done. The target is worked out by the service (`warmupGap`) and
 * must be achievable on the row's equipment (rule 4). Versioned on the
 * session; Undo (`undo_op`) takes it out again while it's still pending.
 * `newSetId` is excluded from the fingerprint, like `add_set`.
 */
export const AddWarmupCommandSchema = z.object({
  type: z.literal('add_warmup'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  newSetId: IdSchema,
  planned: PlannedSetSchema,
  restS: DurationSecondsSchema.refine((x) => x <= 3600, { message: 'At most an hour' }),
  expectedVersion: z.int().min(1),
});

/**
 * Undo of an earlier operation, from its toast (copy D4, ADR 0003 Open):
 * `delete_set`, `skip_exercise`, `correct_set`, `remove_exercise`,
 * `swap_exercise` and `add_exercise` (12 Oct: takes the added row out, only
 * while none of its sets is logged or skipped). Puts back exactly what that operation changed, from the
 * audit and the rows it touched, and only while none of them has changed
 * since (each set's version must still be the one the operation left):
 * otherwise it's refused as `stale_version` and nothing changes (rule 5).
 * A set logged since a swap stays (it's real).
 */
export const UndoOpCommandSchema = z.object({
  type: z.literal('undo_op'),
  ...base,
  opId: OperationIdSchema,
  targetOpId: OperationIdSchema,
});

/**
 * A note on an exercise or a set (active-workout §4.4 `Notes`; Your data).
 * Null clears it. Allowed during and after the workout; changes no value,
 * target or rest. Versioned on the session.
 */
export const SetNoteCommandSchema = z.object({
  type: z.literal('set_note'),
  ...base,
  opId: OperationIdSchema,
  target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('exercise'), sessionExerciseId: IdSchema }), z.object({ kind: z.literal('set'), setId: IdSchema })]),
  note: NoteSchema.nullable(),
  expectedVersion: z.int().min(1),
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

/**
 * Ben's own edit of a set not done yet (14 Oct, "I should be able to edit
 * anything on the sets"): its target load (in the row's unit and convention,
 * achievable on its equipment, rule 4), reps (exact = min = max, or a
 * range), time or distance, set type, target RPE and rest after it. Only a
 * pending set; a logged set goes through `correct_set` (rule 2). Guarded on
 * the set's own version (rule 5) and idempotent (`opId`). The edit replaces
 * the coach's or the rule's marker on that set (it's Ben's target now) and
 * the set's unsaved draft, and keeps everything it replaced on the set, so
 * Undo (`undo_op`) puts exactly that back. A type changed to a warm-up or
 * drop set has no target RPE.
 */
export const EditPlannedSetCommandSchema = z.object({
  type: z.literal('edit_planned_set'),
  ...base,
  opId: OperationIdSchema,
  setId: IdSchema,
  expectedSetVersion: z.int().min(1),
  patch: z
    .object({
      load: LoadSchema.nullable().optional(),
      reps: RepRangeSchema.nullable().optional(),
      durationS: DurationSecondsSchema.nullable().optional(),
      distanceM: z.number().min(0).max(100_000).nullable().optional(),
      setType: SetTypeSchema.optional(),
      targetRpe: RpeSchema.nullable().optional(),
      restS: DurationSecondsSchema.refine((x) => x <= 3600, { message: 'At most an hour' }).optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Nothing to change' }),
});

/**
 * `+ Weight` on a bodyweight exercise (Ben, 18 Oct): the row is logged with
 * the mass held or worn (`added`) for the rest of today, or back to
 * bodyweight. Only sets not done yet change (their load target and unsaved
 * load); a logged set keeps what it was logged as (rule 2). Versioned on the
 * session (rule 5) and idempotent (`opId`).
 */
export const SetLoadModeCommandSchema = z.object({
  type: z.literal('set_load_mode'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  sessionExerciseId: IdSchema,
  mode: z.enum(['added', 'bodyweight']),
});

/**
 * (Coach v3, ADR 0027, 18 Oct) Move a live row (with its whole superset, when
 * it is in one) to straight after another live row, or first. Only a row with
 * a set not done yet; no set changes (rule 2). Versioned on the session (rule
 * 5); Undo (`undo_op`) puts the rows back in their old order while nothing
 * was moved since.
 */
export const MoveExerciseCommandSchema = z.object({
  type: z.literal('move_exercise'),
  ...base,
  opId: OperationIdSchema,
  sessionExerciseId: IdSchema,
  /** Straight after this live row (after its whole superset); null = first. */
  afterSessionExerciseId: IdSchema.nullable(),
  expectedVersion: z.int().min(1),
});

/**
 * `Superset with…` on a live row (Ben, 19 Oct): `sessionExerciseId` joins
 * `withSessionExerciseId`'s superset (or both get a new group letter) and
 * moves to straight after that superset's last member. Both need a set not
 * done yet. Only rows and order change, never a set (rule 2). Versioned on
 * the session (rule 5) and idempotent (`opId`); Undo (`undo_op`) puts the row
 * back where it was and out of the group while nothing moved since.
 */
export const LinkSupersetCommandSchema = z.object({
  type: z.literal('link_superset'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  sessionExerciseId: IdSchema,
  withSessionExerciseId: IdSchema,
});

/**
 * `Remove superset` (Ben, 19 Oct): every member of `sessionExerciseId`'s
 * superset goes back to a single exercise, in the same order. No set changes
 * (rule 2). Versioned and idempotent; Undo (`undo_op`) groups them again while
 * they are still as the split left them.
 */
export const SplitSupersetCommandSchema = z.object({
  type: z.literal('split_superset'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  sessionExerciseId: IdSchema,
});

/** One step of a coach edit: the workout's own commands, checked by the planner (`planCoachEdit`). */
export const CoachEditStepSchema = z.discriminatedUnion('type', [
  AdjustPendingTargetsCommandSchema,
  SwapExerciseCommandSchema,
  AddExerciseCommandSchema,
  RemoveExerciseCommandSchema,
  SkipExerciseCommandSchema,
  MoveExerciseCommandSchema,
  LinkSupersetCommandSchema,
  SplitSupersetCommandSchema,
]);
export type CoachEditStep = z.infer<typeof CoachEditStepSchema>;

/** The operation ID of step `index` of a coach edit (each step is recorded as its own operation, for Undo). */
export function coachEditStepOpId(opId: string, index: number): string {
  return `${opId}:${String(index)}`;
}

/**
 * (Coach v3, ADR 0027, 18 Oct) The coach's `edit_today`: several changes to
 * today's workout (swap, add, remove, move, set count, set targets) as one
 * operation. All or nothing, one version bump (rule 5: refused when the
 * workout moved on since `expectedVersion`). Each step is the workout's own
 * command, run in order with the step's opId `coachEditStepOpId(opId, i)`
 * (its own guards apply: pending sets only, achievable loads). Steps'
 * `expectedVersion`s are set by the reducer as it goes. `actionId`: the coach
 * record; the target step (`adjust_pending_targets`) carries the same one.
 * Undo is `revert_coach_edit`.
 */
export const CoachEditTodayCommandSchema = z.object({
  type: z.literal('coach_edit_today'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  actionId: IdSchema,
  steps: z.array(CoachEditStepSchema).min(1).max(24),
});
export type CoachEditTodayCommand = z.infer<typeof CoachEditTodayCommandSchema>;

/**
 * Undo of one coach edit (Ben's tap): each step undone in reverse order with
 * its own Undo, all or nothing, one version bump. Refused when any of it
 * changed since (a set done on an added exercise, a row moved again), so
 * nothing is half undone. Target changes come back only on sets still pending
 * (a set logged since stays, as for `revert_target_adjustment`).
 */
export const RevertCoachEditCommandSchema = z.object({
  type: z.literal('revert_coach_edit'),
  ...base,
  opId: OperationIdSchema,
  targetOpId: OperationIdSchema,
  actionId: IdSchema,
});

/**
 * One step of a time fit (workout-table-v3 §5): the workout's own commands,
 * each with its own Undo (`undo_op`): a set's rest or target RPE
 * (`edit_planned_set`), a set taken out (`delete_set`), an exercise's
 * remaining sets skipped (`skip_exercise`).
 */
export const FitTodayStepSchema = z.discriminatedUnion('type', [EditPlannedSetCommandSchema, DeleteSetCommandSchema, SkipExerciseCommandSchema]);
export type FitTodayStep = z.infer<typeof FitTodayStepSchema>;

/**
 * (workout-table-v3 §5, b3 merge) `+N min` → the builder's fit ladder over
 * the sets not done yet (shorter rests → RPE 9 → fewer sets → drop an
 * exercise, never the main lift), applied only when Ben taps Apply (rule 3).
 * All or nothing, one version bump, refused once the workout moved on
 * (rule 5). Each step is recorded with `coachEditStepOpId(opId, i)`; Undo is
 * `undo_op` on `opId` (each step's own Undo, last first; a set logged since
 * keeps what it was logged with, rule 2). `minutes`: the length it fitted to.
 */
export const FitTodayToTimeCommandSchema = z.object({
  type: z.literal('fit_today_to_time'),
  ...base,
  opId: OperationIdSchema,
  expectedVersion: z.int().min(1),
  minutes: z.int().min(1).max(600),
  steps: z.array(FitTodayStepSchema).min(1).max(120),
});
export type FitTodayToTimeCommand = z.infer<typeof FitTodayToTimeCommandSchema>;

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
  ConfirmSessionDurationCommandSchema,
  SetFeelCommandSchema,
  SetFinishByCommandSchema,
  AdjustPendingTargetsCommandSchema,
  RevertTargetAdjustmentCommandSchema,
  ChangeGymCommandSchema,
  UndoChangeGymCommandSchema,
  SwapExerciseCommandSchema,
  RemoveExerciseCommandSchema,
  UndoOpCommandSchema,
  SetNoteCommandSchema,
  SetTargetRpeCommandSchema,
  EditPlannedSetCommandSchema,
  SetLoadModeCommandSchema,
  MoveExerciseCommandSchema,
  LinkSupersetCommandSchema,
  SplitSupersetCommandSchema,
  CoachEditTodayCommandSchema,
  RevertCoachEditCommandSchema,
  FitTodayToTimeCommandSchema,
  ReorderSetsCommandSchema,
  AddWarmupCommandSchema,
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand['type'];
export type CommandOf<T extends SessionCommandType> = Extract<SessionCommand, { type: T }>;
