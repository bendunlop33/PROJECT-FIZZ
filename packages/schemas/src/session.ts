import { z } from 'zod';
import {
  DistanceMetresSchema,
  DurationSecondsSchema,
  IdSchema,
  NoteSchema,
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
import { EquipmentInstanceSchema, GymStationSchema } from './equipment';
import { EquipmentKindSchema, LateralitySchema, MeasurementSchema } from './exercise';
import { SetTypeSchema } from './routine';
import { SessionTodayEditsSchema } from './draft';
import { SessionCoachDraftSchema } from './workout-draft';
import { SessionPlanDaySchema } from './plan-day';

/** Values a set can hold: used for actual results and drafts alike. */
export const SetValuesSchema = z.object({
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(1000).nullable(),
  durationS: DurationSecondsSchema.nullable(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
  /**
   * Metres, for distance exercises (sled push, carries). Absent on every
   * other set, and on sets saved before distance existed; writers omit it
   * rather than store null (`withoutEmptyDistance`).
   */
  distanceM: DistanceMetresSchema.nullable().optional(),
});
export type SetValues = z.infer<typeof SetValuesSchema>;

/**
 * A pending set's saved draft: its values, and `loadCarried` when the load
 * is the one Ben's last logged set carried onto this set (active-workout §4.2
 * rule 2a), not one he typed. That load is never his own edit: once the
 * carry ends (Undo of that log) the row shows its target again (review
 * weight-revert CS1, 21 Oct). Absent: the load is as he left it (every draft
 * saved before this existed). Never on a result.
 */
export const DraftValuesSchema = SetValuesSchema.extend({
  loadCarried: z.literal(true).optional(),
});
export type DraftValues = z.infer<typeof DraftValuesSchema>;

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
    /** (ADR 0030) `not_here` because this gym has no bench or rack the exercise needs (its load item may be here). */
    stations: z.array(GymStationSchema).min(1).max(3).optional(),
    /** A pain flag kept the load at or below the target it had (rule 9). */
    painHeld: z.literal(true).optional(),
    /** The equipment and gym the load was fitted to (null: no equipment). */
    equipmentId: IdSchema.nullable(),
    gymId: IdSchema.nullable(),
    by: SnapModeSchema,
  })
  .refine((s) => (s.outcome === 'dropped') === (s.reason !== undefined), { message: 'A dropped target has a reason; other outcomes have none', path: ['reason'] })
  .refine((s) => s.stations === undefined || s.reason === 'not_here', { message: 'Missing stations only explain `not_here`', path: ['stations'] });
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
  /**
   * The `set_rest_after` that set it ("Rest after" sheet, mid-workout): Ben's
   * own rest, which the `+N min` fit never shortens (review build-a R1).
   */
  byOpId: OperationIdSchema.optional(),
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
  /** From a FitNotes import (B7): `Why?` says `FitNotes` instead of a gym. Absent on app history. */
  imported: z.literal(true).optional(),
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
      /** (Review v5offers 6) Rule 8's stall: repeated misses at the same load, even where no easier load exists. */
      stalled: z.literal(true).optional(),
    })
    .optional(),
  step: TargetStepSchema.optional(),
  /**
   * `coach`: the action that set it (its record has the checks), today, next session or (v2 builder,
   * `build`) a coach-built workout's checked load, and the coach's reason.
   */
  coach: z
    .object({
      actionId: IdSchema,
      scope: z.enum(['today', 'next_session', 'build']),
      reason: z.string().max(600).nullable(),
    })
    .optional(),
  /** (workout-builder v2, rule 6) The load is an estimate (`est.`): no comparable history of Ben's own backs it. */
  estimate: z.literal(true).optional(),
  /** (workout-builder v2, BD10) The load is held for pain (`HELD`): a flag on the movement or session pain. Never a step bound or a cap. */
  held: z.literal(true).optional(),
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
  /** Distance target in metres (distance exercises only); absent otherwise. */
  distanceM?: number | null | undefined;
  rpe: number | null;
  rir: number | null;
  /**
   * Ben's own target RPE for this set (CHANGELOG 2026-10-11 "Offers follow
   * the target RPE"), set for the set, its exercise or today with
   * `set_target_rpe`. Wins over `rpe` (the coach's or the routine's) and the
   * built-in rule's value. Absent = not overridden.
   */
  rpeOverride?: number | undefined;
  source?: PlannedSource | undefined;
  /** Absent on targets made before `Why?` existed (shown as `Not recorded`). */
  provenance?: TargetProvenance | undefined;
  snap?: PlannedSnap | undefined;
  /**
   * A bodyweight exercise (catalogue default `bodyweight`; Ben, 18 Oct): an
   * `added` load on its row is weight held or worn, checked against the
   * gym's dumbbells and plates (rule 4). Stamped when the row starts weighted
   * or `set_load_mode` switches it; any set of the row carrying it marks the row.
   */
  bodyweightExercise?: true | undefined;
  /**
   * The target this set had in the other mode before `set_load_mode`
   * switched it (bodyweight or added), put back if Ben switches back while
   * the set still has no load target.
   */
  otherMode?: PlannedSet | undefined;
  /** `gymChanges`: how many gym-change entries the workout had when the coach made this change (Undo is refused after a later one). */
  coach?: { actionId: string; before: PlannedSet; gymChanges?: number | undefined } | undefined;
  /**
   * Ben's own edit of this not-yet-done set (`edit_planned_set`, 14 Oct
   * "edit anything on the sets"): the op that made it, the set's version it
   * left, and everything it replaced, so Undo (`undo_op`) puts exactly that
   * back while nothing has changed since (rule 5).
   */
  edit?: PlannedSetEdit | undefined;
  /**
   * Ben added this set during the workout (`add_set`), so it isn't part of
   * the plan the workout started with: plan vs done counts it as done, not
   * planned (review plans-19oct S1). Absent on every start-time set.
   */
  addedInWorkout?: true | undefined;
}

/** What one `edit_planned_set` replaced on a pending set. */
export interface PlannedSetEdit {
  opId: string;
  /** The set's version right after the edit; Undo is refused once it moved on. */
  version: number;
  before: {
    planned: PlannedSet;
    setType: z.infer<typeof SetTypeSchema>;
    rest: ResolvedRest;
    draft: SetValues | null;
  };
  /**
   * The target values this edit set (21 Oct, weight flicking back): only
   * these leave Ben's draft, and only these replace the screen's unsaved
   * edits. Absent on older records and when no value was set.
   */
  fields?: ('load' | 'reps' | 'durationS' | 'distanceM')[] | undefined;
}

export const PlannedSetSchema: z.ZodType<PlannedSet> = z.object({
  load: LoadSchema.nullable(),
  reps: RepRangeSchema.nullable(),
  durationS: DurationSecondsSchema.nullable(),
  distanceM: DistanceMetresSchema.nullable().optional(),
  rpe: RpeSchema.nullable(),
  rir: RirSchema.nullable(),
  rpeOverride: RpeSchema.optional(),
  source: PlannedSourceSchema.optional(),
  provenance: TargetProvenanceSchema.optional(),
  /** How the load was fitted to the gym's equipment (GS-S1); absent = as intended. */
  snap: PlannedSnapSchema.optional(),
  bodyweightExercise: z.literal(true).optional(),
  addedInWorkout: z.literal(true).optional(),
  get otherMode() {
    return PlannedSetSchema.optional();
  },
  get coach() {
    return z.object({ actionId: IdSchema, before: PlannedSetSchema, gymChanges: z.int().min(0).optional() }).optional();
  },
  get edit() {
    return z
      .object({
        opId: OperationIdSchema,
        version: z.int().min(1),
        before: z.object({ planned: PlannedSetSchema, setType: SetTypeSchema, rest: ResolvedRestSchema, draft: DraftValuesSchema.nullable() }),
        fields: z.array(z.enum(['load', 'reps', 'durationS', 'distanceM'])).max(4).optional(),
      })
      .optional();
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
  draft: DraftValuesSchema.nullable(),
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
  /** Ben's note on this set (Your data). Changed only by `set_note`; never a result, never counted. */
  note: NoteSchema.optional(),
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
  /**
   * (19 Oct, `Superset with…` mid-workout) Rounds this row sits out at the
   * start of its superset, so its first set pairs with the group's next set
   * rather than with a round already done (A3, B1, A4, B2 …). Read only while
   * the row is in a superset. Absent = 0.
   */
  roundOffset: z.int().min(1).max(60).optional(),
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
  /** Ben's note on this exercise in this workout (Your data). Changed only by `set_note`. */
  note: NoteSchema.optional(),
  /**
   * Removed from the workout because it was added by mistake (nothing was
   * logged on it; exercise-library §4.6), or emptied by a swap. Its sets are
   * deleted tombstones; the row stays for the audit and Undo, and every view
   * leaves it out. Absent = in the workout.
   */
  removed: z.object({ opId: OperationIdSchema, at: ZonedTimestampSchema, by: z.enum(['remove', 'swap']) }).optional(),
  /**
   * Mid-workout swap (EL4, B3): this row took over the pending sets of
   * `sessionExerciseId`'s exercise for today, by operation `opId` (its
   * Undo). Done sets stayed on that row.
   */
  swappedFrom: z.object({ sessionExerciseId: IdSchema, opId: OperationIdSchema }).optional(),
});
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;

/** One pending set as it was before a gym change, for Undo (GS-S2). */
export const GymChangeSetBeforeSchema = z.object({
  id: IdSchema,
  sessionExerciseId: IdSchema,
  planned: PlannedSetSchema,
  draft: DraftValuesSchema.nullable(),
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

/**
 * Why a finished workout is in Recently deleted (delete-workouts §6.1, DW-D1).
 * Set only while `status` is `deleted`; cleared by Restore. `purgeAfterUtc`
 * is the end of the local day 30 days after `at` (in `at.tz`): from then the
 * workout is no longer listed or restorable, whether or not the purge has run.
 */
export const SessionDeletionSchema = z.object({
  at: ZonedTimestampSchema,
  opId: OperationIdSchema,
  purgeAfterUtc: UtcTimestampSchema,
});
export type SessionDeletion = z.infer<typeof SessionDeletionSchema>;

/** (Ben, 21 Oct) `How did it feel?` on Summary. */
export const SessionFeelValueSchema = z.enum(['easy', 'good', 'hard']);
export type SessionFeelValue = z.infer<typeof SessionFeelValueSchema>;
/** `value` null: Ben cleared his answer (kept as a value so the cleared state is written over the old one). */
export const SessionFeelSchema = z.object({ value: SessionFeelValueSchema.nullable(), at: ZonedTimestampSchema });
export type SessionFeel = z.infer<typeof SessionFeelSchema>;

/**
 * (PM, 23 Oct) The workout was started in the applied plan's deload week (plan length = block 1): its sets were
 * planned lighter on purpose. Written once, at Start, from the block as derived then (`pbDeloadAtStart`), so a later
 * plan edit or a correction never re-labels it. The built-in rule, next-session targets, lift estimates and the
 * coach's history read skip or label it; Progress volume and history show it as any workout.
 */
export const SessionDeloadSchema = z.object({
  planId: IdSchema,
  /** The block week (1-based) and the block's length when it started. */
  week: z.int().min(1).max(52),
  of: z.int().min(1).max(52),
});
export type SessionDeload = z.infer<typeof SessionDeloadSchema>;

/**
 * (Ben, 25 Oct) "Log a past workout": a workout entered after the fact, at a date and start time
 * Ben picked. No clock runs while it is entered (no rest timer, work timer, pause, Live Activity or
 * alerts), so its sets' `completedAt` are placeholders in the order Ben ticked them, a second apart
 * from the start (never shown as set times, never read as pace). `enteredAt`: when Ben started
 * entering it (the real time), kept as provenance. Written once, at Start.
 */
export const SessionPastLogSchema = z.object({
  enteredAt: ZonedTimestampSchema,
});
export type SessionPastLog = z.infer<typeof SessionPastLogSchema>;

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
   * `deleted`: a finished workout Ben deleted (delete-workouts DW-D1). Out of
   * every derived view like `reverted`, restorable for 30 days (`deletion`).
   */
  status: z.enum(['active', 'finished', 'discarded', 'reverted', 'deleted']),
  /** Present exactly when `status` is `deleted`. */
  deletion: SessionDeletionSchema.optional(),
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
  /** (12 Oct, workout builder §6.3) The coach draft this workout was started from: provenance for `Why?`. Absent = none. */
  coachDraft: SessionCoachDraftSchema.optional(),
  /**
   * (Workout builder v3 §4.2) The plan day this workout was started as: plan, split day, template and
   * variation. Up next credits (planId, splitDayId); absent on older sessions (they fall back to `routineId`).
   */
  planDay: SessionPlanDaySchema.optional(),
  /**
   * Ben confirmed a long workout's time with `Count it` (progress.md PG25a),
   * Your data. A workout over Progress's 4 h cap counts in `Time in gym` only
   * once this is set. Absent = not confirmed. Changes no set and no time.
   */
  durationConfirmedAt: ZonedTimestampSchema.optional(),
  /**
   * (Ben, 21 Oct; workout-builder-v3 §6.2) Summary's one-tap `How did it feel?`: Easy, Good or Hard, as
   * Ben tapped it (Your data; a weekly-review fact, never inferred). Absent or `value: null` = not answered.
   */
  feel: SessionFeelSchema.optional(),
  /** (PM, 23 Oct) Started in the plan's deload week (`SessionDeloadSchema`). Absent = a normal workout. */
  deload: SessionDeloadSchema.optional(),
  /** (Ben, 25 Oct) Entered after the fact with `Log a past workout` (`SessionPastLogSchema`). Absent = logged live. */
  pastLog: SessionPastLogSchema.optional(),
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

const RestTimerCoreSchema = z.object({
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

/**
 * A rest that a log replaced, kept so undoing that log puts it back as it
 * would be now (workout-table-v3 §3, Ben 20 Oct: unticking a set never resets
 * the rest). `timer` is the rest as it was just before the log (running, or
 * paused while the workout is paused), with any −30/+30 already in its
 * deadline; or finished: `skipped`, or `expired` with `endedAtUtc` = its
 * deadline (it had run out, before the log or since), so undo brings back the
 * "Rested" count-up from its original end.
 */
export const ResumableRestSchema = z.object({
  /** Undoing this set's log restores `timer`. */
  afterUndoOfSetId: IdSchema,
  timer: RestTimerCoreSchema.extend({ status: z.enum(['running', 'paused', 'expired', 'skipped']) }).superRefine((t, ctx) => {
    // A finished kept rest has its end and no paused remainder, or undo would show "Ended –".
    if ((t.status === 'expired' || t.status === 'skipped') && (t.endedAtUtc === null || t.remainingMsAtPause !== null)) {
      ctx.addIssue({ code: 'custom', message: 'A finished kept rest needs endedAtUtc and no remainingMsAtPause.', path: ['endedAtUtc'] });
    }
  }),
});
export type ResumableRest = z.infer<typeof ResumableRestSchema>;

/** Most replaced rests kept for undo; older ones are dropped first. */
export const MAX_RESUMABLE_RESTS = 20;
/**
 * Finished kept rests (expired or skipped) are kept only this near the top of
 * the stack (review rest-undo-sp1 S1): undoing a log further back puts no
 * rest back, as before untick restored rests. Keeps the row small, since it
 * is rewritten on every command.
 */
export const MAX_FINISHED_RESUMABLE_DEPTH = 5;

export const RestTimerSchema = RestTimerCoreSchema.extend({
  /**
   * Rests to put back on undo, newest last (a stack: each undo of the latest
   * log pops at most one). Absent = none. A running entry whose deadline
   * has passed is marked expired when next carried forward, not dropped.
   */
  resumeOnUndo: z.array(ResumableRestSchema).min(1).max(MAX_RESUMABLE_RESTS).optional(),
  /**
   * Put back by an undo already finished (workout-table-v3 §3): its end is
   * history, so no rest-end cue, alert or haptic is due for it, also after a
   * relaunch (review rest-undo-sp1 B1). Only on an `expired` or `skipped`
   * timer. Absent = not.
   */
  restoredFinished: z.literal(true).optional(),
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
  /** Ben's own target RPE for the set (`planned.rpeOverride`); absent when none, and on entries written before it existed. */
  targetRpe: RpeSchema.optional(),
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
 *
 * `shiftMs` (Ben, 25 Oct), only on a `startedAt` entry: the whole workout moved by this much with its
 * start (every set's `completedAt`, pauses, rest and work timers), so order and durations stay as
 * logged; each set's earlier time is its time now minus the sum of the later entries' shifts, so the
 * originally recorded times stay recoverable. Absent = only the start moved (the sets stayed).
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
  shiftMs: z.int().optional(),
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
   * (Coach v3, 18 Oct) `move_exercise`: the rows' order before the move,
   * then after it (two halves of equal length), for its Undo.
   * `adjust_pending_targets` in a coach edit: the sets it added.
   */
  createdIds: z.array(IdSchema).max(240).optional(),
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
