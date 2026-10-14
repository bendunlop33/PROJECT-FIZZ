import { z } from 'zod';
import { IdSchema, LoadConventionSchema, LoadSchema, OperationIdSchema, RepRangeSchema, RpeSchema, TimeZoneSchema, UtcTimestampSchema, WeightUnitSchema, ZonedTimestampSchema } from './common';
import { SetTypeSchema } from './routine';
import { SplitBodyPartSchema } from './training-profile';

/**
 * Coach-built workouts (workout-builder.md v2.1). The coach proposes the
 * structure and (v2, Ben 12 Oct: B6 reversed) a working load per exercise
 * with a short basis, through the typed `propose_workout` tool; code checks
 * it (`checkWorkoutProposal`, `checkProposedLoad`) and stores a
 * `WorkoutDraft` version. A missing or rejected load falls back to the
 * built-in rule (BD6). Minutes come from the estimate and the fit, never
 * from the model (BD11). A draft is Your data, owner-scoped, kept 14 days (BD4).
 */

/** §8.3 limits. The tool's argument schema is wider so the checks can clamp and say so (WB13); these are what a draft may hold. */
export const BUILD_LIMITS = {
  maxExercises: 10,
  maxWarmups: 4,
  minWorkingSets: 1,
  maxWorkingSets: 10,
  minReps: 1,
  maxReps: 50,
  minWorkS: 5,
  maxWorkS: 600,
  minRpe: 5,
  maxRpe: 10,
  minRestS: 30,
  maxRestS: 300,
  minSuperset: 2,
  maxSuperset: 4,
  messageMax: 240,
} as const;

/** How long a coach draft is kept (BD4). */
export const COACH_DRAFT_DAYS = 14;

/**
 * A build's focus (§4.1). `coach_picks` = no focus (a text request that names
 * none). The Build card's chips are the Settings split's days (F19):
 * Push/Pull/Legs, Chest/Legs/Shoulders/Back, or a custom day (`split_day`,
 * named by the request's `day`).
 */
export const BuildFocusSchema = z.enum(['coach_picks', 'push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'chest', 'shoulders', 'back', 'split_day']);
export type BuildFocus = z.infer<typeof BuildFocusSchema>;

/** The Build card's length chips (§4.1), in minutes. */
export const BUILD_LENGTH_CHIPS = [30, 45, 60, 75, 90] as const;

// ---------------------------------------------------------------------------
// The tool (`propose_workout`, §8.3)

/**
 * A working load the coach proposes (§8.3). `basis` is data (≤ 60
 * characters), checked by `checkBasis`; `from` is the model's claim (code
 * re-derives `est.` itself). Bodyweight exercises send a null load.
 */
export const LoadProposalSchema = z.strictObject({
  value: z.number().positive().max(2000),
  unit: WeightUnitSchema,
  convention: z.enum(['total', 'per_hand', 'stack', 'added', 'assistance']),
  basis: z.string().max(60),
  from: z.enum(['own_history', 'personal_ratio', 'related_lift', 'estimate']),
  relatedCatalogueId: z.string().min(1).max(80).nullable(),
});
export type LoadProposal = z.infer<typeof LoadProposalSchema>;

/**
 * One exercise in the model's proposal. Strict: an extra field (a `weight`,
 * `minutes`, `gymId`, `equipmentId`, `exerciseName` …) fails the call (BD1,
 * WB3); the tool-call parser never drops it. Optional values are `null`
 * (strict function calling needs every field present; `load` may be absent
 * in calls made before v2, read as null).
 *
 * The number bounds here are only parse bounds: values outside §8.3 are
 * clamped by `checkWorkoutProposal` with a check line, so Ben sees what
 * changed (WB13).
 */
export const ProposedExerciseSchema = z.strictObject({
  /** Must be in the context's usable list (the selected gym's exercises). */
  catalogueId: z.string().min(1).max(80),
  warmups: z.int().min(0).max(100).nullable(),
  workingSets: z.int().min(0).max(100),
  /** Exactly one of `reps` / `workSeconds`. */
  reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }).nullable(),
  workSeconds: z.int().min(0).max(36_000).nullable(),
  /** Working sets' target RPE, 5–10 in half steps. Null: the built-in rule's (BD7). */
  targetRpe: z.number().min(0).max(20).nullable(),
  /** One top set before the working sets, with its own reps, RPE and (v2) load. */
  topSet: z.strictObject({ reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }), targetRpe: z.number().min(0).max(20).nullable(), load: LoadProposalSchema.nullable().optional() }).nullable(),
  /** (v2, BD6) The working (back-off) sets' load; null = no opinion → the built-in rule. */
  load: LoadProposalSchema.nullable().optional(),
  /** Snapped to Ben's nearest rest preset. */
  restSeconds: z.int().min(0).max(3600).nullable(),
  /** Adjacent members share a letter. */
  superset: z.enum(['A', 'B', 'C']).nullable(),
});
export type ProposedExercise = z.infer<typeof ProposedExerciseSchema>;

/**
 * `ask_build_question` (workout-builder v2.1 BD17, §8.4): one clarifying
 * question with 2–4 tap answers. No `goal` topic (code-only, BD20), no
 * length, no pain. The parse bounds are wider than the rules so
 * `checkBuildQuestion` can refuse with a reason; the card shows only what
 * passed (≤ 80 characters, 2–4 answers of ≤ 24).
 */
export const BuildQuestionTopicSchema = z.enum(['main_lift', 'split', 'equipment_today', 'other']);
export type BuildQuestionTopic = z.infer<typeof BuildQuestionTopicSchema>;

export const AskBuildQuestionArgsSchema = z.strictObject({
  topic: BuildQuestionTopicSchema,
  question: z.string().min(1).max(200),
  /** `main_lift`: a catalogueId on each (code shows the catalogue name); others: null. */
  answers: z.array(z.strictObject({ label: z.string().min(1).max(60), catalogueId: z.string().min(1).max(80).nullable() })).min(1).max(8),
});
export type AskBuildQuestionArgs = z.infer<typeof AskBuildQuestionArgsSchema>;

/** Most clarifying questions per build request (BD17). */
export const MAX_BUILD_QUESTIONS = 2;

export const ProposeWorkoutArgsSchema = z.strictObject({
  /** Ignored for display (the name is code-made, BD2); kept in `rawArgs`. */
  name: z.string().max(120).nullable(),
  exercises: z.array(ProposedExerciseSchema).min(1).max(BUILD_LIMITS.maxExercises),
  /** Shown under the card after the claim check; at most 240 characters. */
  message: z.string().max(BUILD_LIMITS.messageMax),
});
export type ProposeWorkoutArgs = z.infer<typeof ProposeWorkoutArgsSchema>;

// ---------------------------------------------------------------------------
// The checked plan (`DraftPlan`, §8.2): routine-shaped, with checked loads (v2)

/**
 * A set template's checked load (v2, BD6): what `checkProposedLoad` decided.
 * `coach`: from Ben's own history; `coach_est`: an estimate (`est.`);
 * `rule`: planned by the built-in rule at plan time (`Rule`); `none`: no
 * load possible (`— · start light`). `basis` is code's reason line, built
 * from real reference sets and the final load (review r2 B1r); in drafts
 * written before that, `basisFromCoach: true` marks it as the coach's text.
 * `coachNote` is the coach's own basis when it passed `checkBasis` (data,
 * shown only behind `Why?` as `Coach's note`).
 */
export const DraftLoadSchema = z.object({
  load: LoadSchema.nullable(),
  source: z.enum(['coach', 'coach_est', 'rule', 'none']),
  basis: z.string().max(80).nullable(),
  /** Drafts before r3 only (`basis` is the coach's text); written `false` now. */
  basisFromCoach: z.boolean(),
  coachNote: z.string().max(80).nullable().optional(),
  held: z.boolean(),
  notes: z.array(z.string().min(1).max(200)).max(8),
  /** A coach basis that failed the check (`Why?` → `NOT USED`). */
  notUsed: z.string().max(80).nullable(),
});
export type DraftLoad = z.infer<typeof DraftLoadSchema>;

/** The item a slot's load was checked on (B7). */
export const CheckedOnSchema = z.object({
  equipmentId: IdSchema,
  kind: z.enum(['barbell', 'plate_loaded_machine', 'dumbbells', 'weight_stack', 'assisted_stack', 'bodyweight_station']),
  convention: LoadConventionSchema,
  unit: WeightUnitSchema,
  barKg: z.number().nonnegative().nullable(),
});
export type CheckedOnRecord = z.infer<typeof CheckedOnSchema>;

export const DraftSetTemplateSchema = z
  .object({
    setType: SetTypeSchema,
    reps: RepRangeSchema.nullable(),
    durationS: z.int().min(BUILD_LIMITS.minWorkS).max(BUILD_LIMITS.maxWorkS).nullable(),
    /** Working and top sets: the coach's (or the rule's, BD7). Warm-ups: null. */
    targetRpe: RpeSchema.nullable(),
    restS: z.int().min(0).max(BUILD_LIMITS.maxRestS).nullable(),
    /** (v2) The checked load; absent on warm-ups and on drafts made before v2 (the rule plans those). */
    load: DraftLoadSchema.optional(),
  })
  .refine((t) => (t.reps === null) !== (t.durationS === null), { message: 'A set has reps or a work time, not both' });
export type DraftSetTemplate = z.infer<typeof DraftSetTemplateSchema>;

export const DraftSlotSchema = z.object({
  /** Stable for the draft's life: today's edits point at it (ADR 0022). Kept across versions for the same exercise. */
  slotKey: IdSchema,
  /** Ben's exercise (the catalogue entry resolved to his list). */
  exerciseId: IdSchema,
  /** The catalogue entry the coach named (provenance). */
  catalogueId: z.string().min(1).max(80),
  order: z.int().min(0),
  main: z.boolean(),
  supersetGroup: z.string().min(1).max(8).nullable(),
  setTemplates: z.array(DraftSetTemplateSchema).min(1).max(BUILD_LIMITS.maxWarmups + BUILD_LIMITS.maxWorkingSets + 1),
  /** (v2, B7) The item the loads were checked on; null/absent: none (older drafts re-check as `Rule`). */
  checkedOn: CheckedOnSchema.nullable().optional(),
  /** (v2, B5) The comparable history's version when checked. */
  checkedHistoryVersion: z.string().min(1).max(64).nullable().optional(),
});
export type DraftSlot = z.infer<typeof DraftSlotSchema>;

export const DraftPlanSchema = z.object({ slots: z.array(DraftSlotSchema).min(1).max(BUILD_LIMITS.maxExercises) });
export type DraftPlan = z.infer<typeof DraftPlanSchema>;

/** A check written by code (BD9), never by the model. `leftOut`: the exercise isn't in the draft. */
export const BuildCheckSchema = z.object({
  kind: z.enum(['unknown', 'not_here_swapped', 'not_here_left_out', 'pain', 'duplicate', 'ungrouped', 'clamped', 'rest_snapped', 'rpe_missing', 'reps_changed', 'shape', 'load', 'main_kept']),
  catalogueId: z.string().max(80).nullable(),
  exerciseId: IdSchema.nullable(),
  /** App text, e.g. `Overhead press left out · shoulder flagged 6 Oct`. */
  text: z.string().min(1).max(200),
  leftOut: z.boolean(),
});
export type BuildCheck = z.infer<typeof BuildCheckSchema>;

export const BuildRequestOriginSchema = z.enum(['chip', 'card', 'text', 'voice']);

/** The split day a Build card chip asked for (F19): its name and body parts. */
export const BuildDaySchema = z.object({
  name: z.string().trim().min(1).max(30),
  bodyParts: z.array(SplitBodyPartSchema).min(1).max(10),
});
export type BuildDay = z.infer<typeof BuildDaySchema>;

export const WorkoutDraftVersionSchema = z.object({
  n: z.int().min(1),
  parentN: z.int().min(1).nullable(),
  status: z.enum(['current', 'replaced']),
  actionId: IdSchema,
  turnId: z.string().min(1).max(64),
  request: z.object({
    /** Ben's words, quoted: data, never instructions (rule 8). */
    text: z.string().max(4000),
    minutes: z.int().min(15).max(180),
    focus: BuildFocusSchema,
    gymId: IdSchema.nullable(),
    origin: BuildRequestOriginSchema,
    /** (F19) The split day chosen on the Build card; absent on older drafts and text requests. */
    day: BuildDaySchema.optional(),
  }),
  /** The model's arguments as received (data). */
  rawArgs: z.string().max(40_000),
  plan: DraftPlanSchema,
  /** The length the overview fits to (BD11): from Ben's words or chips, never the model's. */
  fitMinutes: z.int().min(15).max(180),
  checks: z.array(BuildCheckSchema).max(60),
  /** The coach's message after the claim check (null when it was hidden). */
  rationale: z.string().max(BUILD_LIMITS.messageMax).nullable(),
  contextHash: z.string().min(1).max(128),
  equipmentVersion: z.string().min(1).max(128),
  createdAt: ZonedTimestampSchema,
});
export type WorkoutDraftVersion = z.infer<typeof WorkoutDraftVersionSchema>;

export const WorkoutDraftStatusSchema = z.enum(['open', 'started', 'discarded', 'expired']);
export type WorkoutDraftStatus = z.infer<typeof WorkoutDraftStatusSchema>;

/** Most operation IDs remembered for idempotency. */
export const MAX_WORKOUT_DRAFT_OPS = 200;
/** Most versions kept (each `Make it shorter` is one). */
export const MAX_WORKOUT_DRAFT_VERSIONS = 20;

/**
 * A coach-built workout before it's started (§8.2). `status` is `open`
 * until started, discarded or expired; a draft saved to Workouts stays open
 * (`routineId` set) so Ben may still start it. Every write bumps `version`
 * and records its `opId` (rule 5).
 */
export const WorkoutDraftSchema = z
  .object({
    id: IdSchema,
    ownerId: IdSchema,
    status: WorkoutDraftStatusSchema,
    /** Code-made: `Push · 45 min` (BD2). */
    name: z.string().min(1).max(120),
    currentVersion: z.int().min(1),
    versions: z.array(WorkoutDraftVersionSchema).min(1).max(MAX_WORKOUT_DRAFT_VERSIONS),
    sessionId: IdSchema.nullable(),
    startedAtUtc: UtcTimestampSchema.nullable(),
    routineId: IdSchema.nullable(),
    /** Discard is a status; Undo restores `open` (toast). */
    discardedAtUtc: UtcTimestampSchema.nullable(),
    opIds: z.array(OperationIdSchema).max(MAX_WORKOUT_DRAFT_OPS),
    createdAt: ZonedTimestampSchema,
    tz: TimeZoneSchema,
    /** Created + 14 days (BD4). */
    expiresAtUtc: UtcTimestampSchema,
    version: z.int().min(1),
    updatedAtUtc: UtcTimestampSchema,
  })
  .refine((d) => d.versions.some((v) => v.n === d.currentVersion && v.status === 'current'), { message: 'The current version must exist', path: ['currentVersion'] })
  .refine((d) => (d.status === 'started') === (d.sessionId !== null), { message: 'Only a started draft names its session', path: ['sessionId'] });
export type WorkoutDraft = z.infer<typeof WorkoutDraftSchema>;

/** A session started from a coach draft (§6.3): provenance for `Why?`. */
export const SessionCoachDraftSchema = z.object({ draftId: IdSchema, version: z.int().min(1), name: z.string().min(1).max(120) });
export type SessionCoachDraft = z.infer<typeof SessionCoachDraftSchema>;
