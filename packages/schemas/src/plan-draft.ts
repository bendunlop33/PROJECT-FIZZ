import { z } from 'zod';
import { IdSchema, OperationIdSchema, TimeZoneSchema, UtcTimestampSchema, ZonedTimestampSchema } from './common';
import { BUILD_LIMITS, BuildCheckSchema, BuildFocusSchema, BuildRequestOriginSchema, DraftPlanSchema, ProposedExerciseSchema } from './workout-draft';

/**
 * Coach-built multi-day plans (Ben, 19 Oct: "Can it build plans across
 * multiple days as well not just single workouts?"). The coach proposes
 * every day at once through the typed `propose_plan` tool; each day is the
 * same shape as a `propose_workout` draft and goes through the same checks
 * (`checkWorkoutProposal`, `checkProposedLoad`). The result is a
 * `PlanDraft`: a proposal Ben applies (rule 3: a structural change is a
 * proposal with Apply and Undo). Apply saves each day as a saved workout in
 * his rotation; Undo puts his previous setup back (rule 5: versioned and
 * idempotent; a stale Apply or Undo changes nothing). Your data, owner-scoped.
 *
 * Not in v1: calendar dates, multi-week blocks, deloads.
 */

export const PLAN_LIMITS = {
  minDays: 1,
  maxDays: 7,
  dayNameMax: 30,
  /** Each open plan is kept this long, as a coach draft (BD4). An applied plan stays while it is in use. */
  openDays: 14,
  maxVersions: 10,
  maxOps: 200,
} as const;

// ---------------------------------------------------------------------------
// The tool (`propose_plan`)

/**
 * One day of the model's plan: a `propose_workout` draft plus its name and
 * the split day it is (Profile's split), when it is one. Strict, like the
 * workout tool: an extra field fails the call.
 */
export const ProposedPlanDaySchema = z.strictObject({
  /** The day's name ("Push", "Upper A"). Code uses the split day's own name when `splitDayId` names one. */
  dayName: z.string().min(1).max(60),
  /** One of `plan.splitDays[].id`, or null for a day that isn't one of them. */
  splitDayId: z.string().min(1).max(64).nullable(),
  /** The day's focus, as `propose_workout`'s. Null: the split day's (or the coach's pick). */
  focus: BuildFocusSchema.exclude(['split_day']).nullable(),
  /** This day's length when Ben asked for one for it ("legs can be 75"); null: the plan's. */
  minutes: z.int().min(15).max(180).nullable(),
  exercises: z.array(ProposedExerciseSchema).min(1).max(BUILD_LIMITS.maxExercises),
});
export type ProposedPlanDay = z.infer<typeof ProposedPlanDaySchema>;

export const ProposePlanArgsSchema = z.strictObject({
  days: z.array(ProposedPlanDaySchema).min(PLAN_LIMITS.minDays).max(PLAN_LIMITS.maxDays),
  /** The coach's reasons, numbers checked like a workout draft's message. */
  message: z.string().max(BUILD_LIMITS.messageMax),
  /** Every day's length when Ben asked for one ("60 min each"); null: his session length. Code checks it. */
  minutes: z.int().min(15).max(180).nullable().optional(),
  /** One of Ben's saved gyms by name; null: the selected gym. */
  gymName: z.string().min(1).max(120).nullable().optional(),
});
export type ProposePlanArgs = z.infer<typeof ProposePlanArgsSchema>;

// ---------------------------------------------------------------------------
// The stored plan

/** One checked day: its name, split day, length and a `DraftPlan` (the same checked slots as a workout draft). */
export const PlanDayDraftSchema = z.object({
  index: z.int().min(0).max(PLAN_LIMITS.maxDays - 1),
  name: z.string().trim().min(1).max(PLAN_LIMITS.dayNameMax),
  /** The split day it maps to (Up next plans split days); null when it maps to none. */
  splitDayId: z.string().min(1).max(64).nullable(),
  focus: BuildFocusSchema,
  minutes: z.int().min(15).max(180),
  plan: DraftPlanSchema,
  checks: z.array(BuildCheckSchema).max(60),
});
export type PlanDayDraft = z.infer<typeof PlanDayDraftSchema>;

/** A check about the plan as a whole (code text): a day dropped, a split day used twice, a name changed. */
export const PlanCheckSchema = z.object({
  kind: z.enum(['day_dropped', 'day_renamed', 'split_unknown', 'split_repeated', 'too_many_days', 'same_muscles_in_a_row']),
  dayIndex: z.int().min(0).max(PLAN_LIMITS.maxDays - 1).nullable(),
  text: z.string().min(1).max(200),
});
export type PlanCheck = z.infer<typeof PlanCheckSchema>;

export const PlanDraftVersionSchema = z.object({
  n: z.int().min(1),
  parentN: z.int().min(1).nullable(),
  status: z.enum(['current', 'replaced']),
  actionId: IdSchema,
  turnId: z.string().min(1).max(64),
  request: z.object({
    /** Ben's words, quoted: data, never instructions (rule 8). */
    text: z.string().max(4000),
    gymId: IdSchema.nullable(),
    origin: BuildRequestOriginSchema,
  }),
  /** The model's arguments as received (data). */
  rawArgs: z.string().max(80_000),
  days: z.array(PlanDayDraftSchema).min(PLAN_LIMITS.minDays).max(PLAN_LIMITS.maxDays),
  checks: z.array(PlanCheckSchema).max(20),
  rationale: z.string().max(BUILD_LIMITS.messageMax).nullable(),
  rationaleNumbersChecked: z.literal(true).optional(),
  contextHash: z.string().min(1).max(128),
  equipmentVersion: z.string().min(1).max(128),
  createdAt: ZonedTimestampSchema,
});
export type PlanDraftVersion = z.infer<typeof PlanDraftVersionSchema>;

/** `Replace my workouts` takes the other workouts out of the rotation; `Add alongside` keeps them in it. */
export const PlanApplyModeSchema = z.enum(['replace', 'add']);
export type PlanApplyMode = z.infer<typeof PlanApplyModeSchema>;

/**
 * What Apply did, so Undo restores exactly the setup before it (rule 2, 5):
 * the workouts it made (one per day, at the version Apply wrote) and the
 * workouts it took out of the rotation (their place and versions).
 */
export const PlanAppliedSchema = z.object({
  mode: PlanApplyModeSchema,
  versionN: z.int().min(1),
  opId: OperationIdSchema,
  atUtc: UtcTimestampSchema,
  made: z.array(z.object({ dayIndex: z.int().min(0).max(PLAN_LIMITS.maxDays - 1), routineId: IdSchema, version: z.int().min(1) })).min(1).max(PLAN_LIMITS.maxDays),
  rotationOff: z
    .array(z.object({ routineId: IdSchema, name: z.string().min(1).max(120), rotationAtUtc: UtcTimestampSchema.nullable(), versionBefore: z.int().min(1), versionAfter: z.int().min(2) }))
    .max(40),
  /**
   * Plans that were applied before this one and that this Apply ended
   * (`superseded`), at the version it left them, so this Apply's Undo puts
   * them back as the plan in use (review plans-19oct S3). Absent: none.
   */
  superseded: z.array(z.object({ planId: IdSchema, versionAfter: z.int().min(2) })).max(8).optional(),
});
export type PlanApplied = z.infer<typeof PlanAppliedSchema>;

/**
 * `superseded`: was applied, then a newer plan's Apply ended it (its workouts stay as Ben's workouts).
 * `ended` (Ben, 19 Oct: Library › Your plan › `End plan`): Ben ended it; its days left the rotation, its
 * workouts and history stay. Undo of End makes it `applied` again (migration 22).
 */
export const PlanDraftStatusSchema = z.enum(['open', 'applied', 'superseded', 'discarded', 'expired', 'ended']);
export type PlanDraftStatus = z.infer<typeof PlanDraftStatusSchema>;

/**
 * What `End plan` did, so its Undo puts exactly that back (rule 2, 5): the
 * plan's workouts it took out of the rotation, their places and versions.
 * A day Ben had already taken out of the rotation isn't listed.
 */
export const PlanEndedSchema = z.object({
  opId: OperationIdSchema,
  atUtc: UtcTimestampSchema,
  rotationOff: z.array(z.object({ routineId: IdSchema, rotationAtUtc: UtcTimestampSchema.nullable(), versionBefore: z.int().min(1), versionAfter: z.int().min(2) })).max(PLAN_LIMITS.maxDays),
  /**
   * (Ben, 20 Oct: option B) The workouts `Replace my workouts` took out of the rotation that End put
   * back in their places, at the versions End left them (its Undo takes them out again). Absent on
   * plans ended before 20 Oct.
   */
  restored: z.array(z.object({ routineId: IdSchema, versionBefore: z.int().min(1), versionAfter: z.int().min(2) })).max(40).optional(),
  /** Those End couldn't put back: Ben deleted or changed them since Apply (`N workouts not restored`). */
  notRestored: z.array(z.object({ routineId: IdSchema, name: z.string().min(1).max(120) })).max(40).optional(),
});
export type PlanEnded = z.infer<typeof PlanEndedSchema>;

/** A local calendar date, `YYYY-MM-DD`. */
const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * (Ben, 20 Oct) `Make next`: a plan day pinned as Up next until it is done
 * (a workout from it, or one that mainly trained its body parts, after
 * `atUtc`), or another day is pinned, or Ben unpins it.
 */
export const PlanPinSchema = z.object({ routineId: IdSchema, opId: OperationIdSchema, atUtc: UtcTimestampSchema });
export type PlanPin = z.infer<typeof PlanPinSchema>;

/**
 * (Ben, 20 Oct: "should also be able to pause eg if go on hols") One pause
 * of the plan in use. Paused from `fromUtc` until Ben resumes
 * (`endedAtUtc`) or, with `untilDate`, until that local date starts (the
 * plan is in use again on it). While paused, Up next follows the normal
 * rules and the paused days don't count against the aim.
 */
export const PlanPauseSchema = z.object({
  opId: OperationIdSchema,
  fromUtc: UtcTimestampSchema,
  /** Local date the plan is back in use on (`2026-11-03`); null: until Resume. */
  untilDate: LocalDateSchema.nullable(),
  /** Resumed early by Ben (or the auto-resume write on the first open after `untilDate`). */
  endedAtUtc: UtcTimestampSchema.nullable(),
  endedBy: z.enum(['ben', 'auto']).nullable().optional(),
});
export type PlanPause = z.infer<typeof PlanPauseSchema>;

/** The last `Make next` / pause / resume write and the pin and pauses before it: its Undo puts exactly those back (rule 2, 5). */
export const PlanControlUndoSchema = z.object({
  opId: OperationIdSchema,
  kind: z.enum(['pin', 'unpin', 'pause', 'resume']),
  /** The plan's version this write left: Undo only from it. */
  versionAfter: z.int().min(2),
  before: z.object({ pin: PlanPinSchema.nullable(), pauses: z.array(PlanPauseSchema).max(60) }),
});
export type PlanControlUndo = z.infer<typeof PlanControlUndoSchema>;

/**
 * A coach-built plan (Your data). `open` until applied, discarded or
 * expired; Undo of an Apply makes it `open` again (its workouts gone, the
 * rotation as it was). Every write bumps `version` and records its `opId`.
 */
export const PlanDraftSchema = z
  .object({
    id: IdSchema,
    ownerId: IdSchema,
    status: PlanDraftStatusSchema,
    /** Code-made: `4-day plan`. */
    name: z.string().min(1).max(120),
    currentVersion: z.int().min(1),
    versions: z.array(PlanDraftVersionSchema).min(1).max(PLAN_LIMITS.maxVersions),
    applied: PlanAppliedSchema.nullable(),
    /** The last Undo of an Apply (provenance; the plan is `open` again). */
    undoneAtUtc: UtcTimestampSchema.nullable(),
    /** The newer plan whose Apply ended this one (status `superseded`); absent or null otherwise. */
    supersededBy: z.object({ planId: IdSchema, opId: OperationIdSchema, atUtc: UtcTimestampSchema }).nullable().optional(),
    /** Ben's `End plan` (status `ended`); absent or null otherwise. */
    ended: PlanEndedSchema.nullable().optional(),
    /** (20 Oct) `Make next`; absent or null: none (Up next adapts). */
    pin: PlanPinSchema.nullable().optional(),
    /** (20 Oct) Every pause, oldest first; the last may still be running. Absent: never paused. */
    pauses: z.array(PlanPauseSchema).max(60).optional(),
    /** (20 Oct) The last pin or pause write, for its Undo. */
    lastControl: PlanControlUndoSchema.nullable().optional(),
    opIds: z.array(OperationIdSchema).max(PLAN_LIMITS.maxOps),
    createdAt: ZonedTimestampSchema,
    tz: TimeZoneSchema,
    /** Created + 14 days while open; an applied plan doesn't expire. */
    expiresAtUtc: UtcTimestampSchema,
    version: z.int().min(1),
    updatedAtUtc: UtcTimestampSchema,
  })
  .refine((d) => d.versions.some((v) => v.n === d.currentVersion && v.status === 'current'), { message: 'The current version must exist', path: ['currentVersion'] })
  .refine((d) => (d.status === 'applied' || d.status === 'superseded' || d.status === 'ended') === (d.applied !== null), { message: 'Only an applied plan names what it made', path: ['applied'] })
  .refine((d) => (d.status === 'superseded') === ((d.supersededBy ?? null) !== null), { message: 'Only a superseded plan names the plan that ended it', path: ['supersededBy'] })
  .refine((d) => (d.status === 'ended') === ((d.ended ?? null) !== null), { message: 'Only an ended plan records its End', path: ['ended'] });
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
