import { z } from 'zod';
import {
  IdSchema,
  LoadConventionSchema,
  LoadSchema,
  OperationIdSchema,
  RecordMetaSchema,
  RepRangeSchema,
  RpeSchema,
  UtcTimestampSchema,
  ZonedTimestampSchema,
} from './common';
import { PainAreaSchema, type PainFlag } from './checkin';
import { DraftBasisSchema } from './draft';
import { CoachEditTodayCommandSchema, type SessionCommand } from './commands';
import { CustomExerciseFieldsSchema, EquipmentKindSchema, LateralitySchema, MeasurementSchema, MuscleSchema, type Exercise } from './exercise';
import { RoutineExerciseSchema, RoutineSchema } from './routine';
import { AskBuildQuestionArgsSchema, BuildQuestionTopicSchema, ProposeWorkoutArgsSchema, type WorkoutDraft } from './workout-draft';
import { ProposePlanArgsSchema, type PlanDraft } from './plan-draft';
import { ActivityEffortSchema, ActivityFieldsShapeSchema, ActivityKindSchema, ActivityStatusSchema, WeekBasisSchema, WeekMergeSchema, WeekRowSchema, WeekSkipSchema, type Activity } from './activity';
import { LocalDateSchema } from './import';

/**
 * Coach v1 contracts (ADR 0020 §2, coach-contract.md §6). Tool arguments are
 * the shapes the model must send; action records are what the app saved. The
 * app renders every change line from an `ActionRecord`, never from model text.
 *
 * Tool argument objects are strict and use `nullable` rather than optional
 * fields, so their JSON Schema is valid for strict function calling.
 */

// ---------------------------------------------------------------------------
// Registry vocabulary

/** There is deliberately no `delete` or `overwrite` effect (coach-contract CC6). */
export const ToolEffectSchema = z.enum(['read', 'append', 'versioned_update', 'propose']);
export type ToolEffect = z.infer<typeof ToolEffectSchema>;

/**
 * What a turn must contain before the tool is offered to the model.
 * `ben_request` is satisfied by Ben's own message or by tapping `Adjust`
 * on an offer (CA1), never by tool output, imported text or context.
 */
export const ToolNeedSchema = z.enum([
  'none',
  'ben_request',
  'ben_pain_words',
  'ben_named_target',
  'summary_turn',
  'structural_signal',
]);
export type ToolNeed = z.infer<typeof ToolNeedSchema>;

/** `workout`: during an active workout; `summary`: the one post-workout turn; `general`: anything else. */
export const CoachTurnKindSchema = z.enum(['general', 'workout', 'summary']);
export type CoachTurnKind = z.infer<typeof CoachTurnKindSchema>;

/** What a write tool may touch. Finished sessions and done sets are not in this list. */
export const CoachEntityKindSchema = z.enum([
  'pending_set_target',
  'next_session_target',
  'proposal',
  'pain_flag',
  'memory',
  'playbook_candidate',
  /** (11 Oct) A set Ben told the coach to log, or a logged set he told it to correct: values only, never deleted. */
  'logged_set',
  /** (12 Oct, workout builder) A coach-built workout draft: a new draft or a new version of one; never a template or a session. */
  'workout_draft',
  /**
   * (12 Oct) An exercise the coach added to today's workout because Ben asked
   * (`add_exercise_today`): a new row with pending sets only, through the
   * workout's own `add_exercise` command; Undo takes it out while nothing on it is done.
   */
  'session_exercise',
  /** (14 Oct) The live workout's own name (`rename_workout`), through the workout's `rename_session` command; Undo names it back. */
  'session_name',
  /** (14 Oct, workout builder v2) A clarifying question card in the thread (`ask_build_question`); it changes nothing else. */
  'build_question',
  /** (19 Oct, plans) A coach-built multi-day plan: a proposal Ben applies; never a routine or the rotation directly. */
  'plan_draft',
  /** (19 Oct) A new exercise for Ben's list: a proposal card; saved only when he taps Add (rule 3). */
  'custom_exercise',
  /** (Ben, 20 Oct) The plan in use paused or resumed (`pause_plan`), only when Ben asked; Undo puts it back. */
  'plan_pause',
  /** (Ben, 20 Oct) A run, ride, swim or sport Ben told the coach about (`log_activity`): added when he asked, else offered; Undo removes it. */
  'activity',
  /** (Ben, 20 Oct) This week's days reshaped around a run (`propose_week`): a proposal Ben applies; this week only. */
  'week_plan',
]);
export type CoachEntityKind = z.infer<typeof CoachEntityKindSchema>;

export const CapabilitySectionSchema = z.enum(['read', 'when_you_ask', 'after_workout', 'suggest_only']);
export type CapabilitySection = z.infer<typeof CapabilitySectionSchema>;

// ---------------------------------------------------------------------------
// Tool arguments (v1 subset of coach-contract §6.1, ADR 0020 §2)

const reason = z.string().min(1).max(240);
/** A short quote of Ben's own words from this turn. Checked by the gate, never trusted alone. */
const quote = z.string().min(1).max(400);

/**
 * (Coach v3, ADR 0027, 18 Oct) The model's reading of whether Ben asked for a change to today's
 * workout (rule 3): `benAsked` true with `benQuote`, his words copied verbatim from this turn's
 * message. Code checks the quote against his message (`verifyAsked`); a claim it can't find is
 * never trusted. Null or absent: no claim (code's own reading decides).
 */
const askClaim = {
  benAsked: z.boolean().nullable().optional(),
  benQuote: z.string().max(200).nullable().optional(),
};

/**
 * A set target. Unit and convention are always explicit. In tool arguments a
 * null field means "keep the current value"; in action records it means the
 * set has no target for that field.
 */
export const CoachTargetSchema = z.strictObject({
  load: LoadSchema.nullable(),
  reps: RepRangeSchema.nullable(),
  /**
   * Target RPE for the set (CHANGELOG 2026-10-11 "Offers follow the target
   * RPE"): the coach's recommendation. Null or absent = keep the set's
   * current target (Ben's own override always stays).
   */
  rpe: RpeSchema.nullable().optional(),
});
export type CoachTarget = z.infer<typeof CoachTargetSchema>;

export const EmptyArgsSchema = z.strictObject({});

export const GetRecentTrainingArgsSchema = z.strictObject({
  exerciseId: IdSchema,
  sessions: z.int().min(1).max(10),
});

/** "How am I doing?": workouts, what was done and whether the main lifts moved, over the last `weeks`. */
export const GetTrainingOverviewArgsSchema = z.strictObject({
  weeks: z.int().min(1).max(12),
});

export const GetGymEquipmentArgsSchema = z.strictObject({
  /** Null = everything used in the current or last workout. */
  exerciseId: IdSchema.nullable(),
  /** (Coach v3) One of Ben's saved gyms by name; null = the gym in context. */
  gymName: z.string().max(80).nullable().optional(),
});

/** (Coach v3) An exercise's records: heaviest logged set, most reps, best estimated 1RM (labelled an estimate). */
export const GetExerciseRecordsArgsSchema = z.strictObject({
  exerciseId: IdSchema,
});

/** (Coach v3) Ben's last finished workouts, every exercise's sets as logged. */
export const GetRecentSessionsArgsSchema = z.strictObject({
  count: z.int().min(1).max(10),
});

/**
 * (Coach v3, Ben 18 Oct: "gauge itself whether it's needed") Mid-workout turns start light; the
 * coach calls this once when the question needs more thought. The next step runs at a higher
 * reasoning effort on Ben's main model. Changes nothing.
 */
export const ThinkHarderArgsSchema = z.strictObject({
  why: z.string().max(120),
});

export const GetProgressionTargetsArgsSchema = z.strictObject({
  exerciseId: IdSchema,
});

/** Exercises that could replace one in the plan at this gym (for a swap proposal). */
export const GetSubstitutionsArgsSchema = z.strictObject({
  exerciseId: IdSchema,
});

/**
 * (19 Oct, Ben: "Why can't I add it") Search every exercise usable here, not only the capped list in
 * the prompt: by name or other name, a muscle, an equipment word. At most 20 results. Read only.
 */
export const FindExercisesArgsSchema = z.strictObject({
  query: z.string().max(80),
  muscle: z.string().max(40).nullable(),
  equipment: z.string().max(40).nullable(),
});
export type FindExercisesArgs = z.infer<typeof FindExercisesArgsSchema>;

/**
 * (19 Oct, Ben: "Why can't the chat function make exercises not in the catalogue") A new exercise for
 * Ben's list, only after find_exercises found nothing like it. A card he checks: nothing is saved until
 * he taps Add. loadConvention null: the equipment's usual one; laterality null: both sides together.
 */
export const ProposeExerciseArgsSchema = z.strictObject({
  name: z.string().min(1).max(80),
  equipment: EquipmentKindSchema,
  loadConvention: LoadConventionSchema.nullable(),
  primaryMuscles: z.array(MuscleSchema).min(1).max(3),
  measurement: MeasurementSchema,
  laterality: LateralitySchema.nullable(),
  /** (Review exlist S3) Set only after Ben said his exercise is not the one find_exercises or a refusal named: that catalogueId. */
  differentFrom: z.string().max(80).nullable().optional(),
  reason,
});
export type ProposeExerciseArgs = z.infer<typeof ProposeExerciseArgsSchema>;

/**
 * (Ben, 20 Oct: "should also be able to pause eg if go on hols") Pause the plan in use ("I'm on holiday
 * till 3 Nov") or resume it ("I'm back, resume my plan"). Only when Ben asks; it applies at once with
 * Undo. `until`: the local date (`YYYY-MM-DD`) the plan is back in use on, or null until he resumes; a
 * date Ben said outright wins over this one (code reads his words).
 */
export const PausePlanArgsSchema = z.strictObject({
  action: z.enum(['pause', 'resume']),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  reason,
});
export type PausePlanArgs = z.infer<typeof PausePlanArgsSchema>;

/**
 * (Ben, 20 Oct) Log a run, ride, swim, sport or other activity Ben told the coach about, done or
 * planned ("18 km run yesterday", "long run Saturday"). Only what he said: no invented pace, heart
 * rate or effort (rule 6). `date`: local `YYYY-MM-DD` from his words and today's date (a day he
 * said outright wins, code reads his words). Applied at once with Undo when he asked to log it;
 * otherwise saved as an offer he taps to log (rule 3).
 */
export const LogActivityArgsSchema = z.strictObject({
  kind: ActivityKindSchema,
  status: ActivityStatusSchema,
  date: LocalDateSchema,
  /** Rough minutes, as he said them; null when he gave none. */
  durationMin: z.int().min(1).max(24 * 60).nullable(),
  /** Kilometres, as he said them; null when he gave none. */
  distanceKm: z.number().min(0.01).max(1000).nullable(),
  /** His own effort word; `long` for a long session; null when he gave none. */
  effort: ActivityEffortSchema.nullable(),
  reason,
});
export type LogActivityArgs = z.infer<typeof LogActivityArgsSchema>;

/**
 * (Ben, 20 Oct: "maybe we swap to a push rather than shoulder and chest separately") This week only:
 * merge two of the week's remaining days into one ("Chest" + "Shoulders" → "Push") and/or skip one,
 * so the week fits around a run. Day IDs are YOUR DATA week.remaining[].id. Always a proposal: Ben
 * taps Apply (rule 3); next week is the plan as it was.
 */
export const ProposeWeekArgsSchema = z.strictObject({
  merges: z
    .array(z.strictObject({ dayIds: z.array(z.string().min(1).max(64)).length(2), name: z.string().min(1).max(30) }))
    .max(3),
  skips: z.array(z.string().min(1).max(64)).max(3),
  message: z.string().max(400),
});
export type ProposeWeekArgs = z.infer<typeof ProposeWeekArgsSchema>;

/**
 * (11 Oct, coach tools) Log a pending set with the values Ben said in this
 * turn ("log 100 for 8"). Unit and convention are the exercise's own; the
 * numbers must be in Ben's words. Same `log_set` command as the Log button.
 */
export const LogSetArgsSchema = z.strictObject({
  /** The session version the coach read (rule 5). */
  baseVersion: z.int().min(1),
  setId: IdSchema,
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(100),
  rpe: z.number().min(1).max(10).multipleOf(0.5).nullable(),
});
export type LogSetArgs = z.infer<typeof LogSetArgsSchema>;

/**
 * (11 Oct, coach tools) Correct a logged set's values when Ben says which set
 * and what it was ("set 2 was 95"). Null keeps a value. Same `correct_set`
 * command as the correction sheet; never a mark or a delete.
 */
export const CorrectSetArgsSchema = z.strictObject({
  baseVersion: z.int().min(1),
  setId: IdSchema,
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(100).nullable(),
  rpe: z.number().min(1).max(10).multipleOf(0.5).nullable(),
});
export type CorrectSetArgs = z.infer<typeof CorrectSetArgsSchema>;

/**
 * (12 Oct) Add an exercise to today's workout when Ben asks ("add 3 sets of
 * lateral raises", "put in some curls"). Structure only: the app plans the
 * loads from Ben's history on this gym's equipment (no history: blank, B6),
 * through the workout's own `add_exercise` command. Wide bounds here; the
 * domain check clamps with a note, like `propose_workout`.
 */
export const AddExerciseTodayArgsSchema = z.strictObject({
  /** The session version the coach read (rule 5). */
  baseVersion: z.int().min(1),
  /** From `addable` in the context: a catalogue ID or Ben's own exercise's ID. */
  exerciseId: z.string().min(1).max(80),
  workingSets: z.int().min(0).max(100),
  /** Rep range for a reps exercise; null = the built-in rule's range. */
  reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }).nullable(),
  /** Work time for a timed or cardio exercise. */
  workSeconds: z.int().min(0).max(36_000).nullable(),
  /** Cardio only (19 Oct): a distance to aim for, in metres; null = none. Absent on calls made before it. */
  distanceMetres: z.number().min(0).max(100_000).nullable().optional(),
  /** Working sets' target RPE, 5–10 in half steps; null = the usual target. */
  targetRpe: z.number().min(0).max(20).nullable(),
  /** Straight after this exercise of today's workout; null = at the end. */
  afterSessionExerciseId: IdSchema.nullable(),
  /** In a superset with this exercise of today's workout (it must have a set left); null = none. */
  supersetWithSessionExerciseId: IdSchema.nullable(),
  /** (19 Oct) Ben's load for every working set, in his unit (0 = no weight); null or absent = planned from his history. */
  load: z.number().min(0).max(1000).nullable().optional(),
  reason,
  ...askClaim,
});
export type AddExerciseTodayArgs = z.infer<typeof AddExerciseTodayArgsSchema>;

/**
 * (14 Oct) Rename the live workout when Ben asks ("change the name of the
 * workout to Chest day"). The workout's own `rename_session` command,
 * versioned on the session (rule 5); the routine keeps its name.
 */
export const RenameWorkoutArgsSchema = z.strictObject({
  /** The session version the coach read (rule 5). */
  baseVersion: z.int().min(1),
  name: z.string().min(1).max(120),
  ...askClaim,
});
export type RenameWorkoutArgs = z.infer<typeof RenameWorkoutArgsSchema>;

/**
 * (Coach v3, ADR 0027, 18 Oct) One change to today's live workout in `edit_today`. IDs are
 * the workout's (`sessionExerciseId`, `setId`) or, for a new exercise, one from YOUR DATA
 * `addable` (`exerciseId`, `toExerciseId`). Only sets not done yet change (rule 2); the app
 * checks and fits every number (rule 4) and refuses the whole edit if any op is refused.
 */
export const EditTodayOpSchema = z.discriminatedUnion('op', [
  /** A pending set's target (load, reps, target RPE; null keeps a value). */
  z.strictObject({ op: z.literal('set'), setId: IdSchema, target: CoachTargetSchema }),
  /** The exercise's working sets today, done ones included: more adds pending sets like its last one, fewer removes pending ones from the end. */
  z.strictObject({ op: z.literal('set_count'), sessionExerciseId: IdSchema, workingSets: z.int().min(0).max(20) }),
  /** The exercise's pending sets move to another exercise (done sets stay). */
  z.strictObject({ op: z.literal('swap'), sessionExerciseId: IdSchema, toExerciseId: z.string().min(1).max(80) }),
  /** A new exercise with pending sets; the app plans its loads from Ben's history on this gym's equipment. */
  z.strictObject({
    op: z.literal('add'),
    exerciseId: z.string().min(1).max(80),
    workingSets: z.int().min(0).max(100),
    reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }).nullable(),
    workSeconds: z.int().min(0).max(36_000).nullable(),
    /** Cardio only (19 Oct): a distance to aim for, in metres, next to `workSeconds`; null = none. Absent on calls made before it. */
    distanceMetres: z.number().min(0).max(100_000).nullable().optional(),
    targetRpe: z.number().min(0).max(20).nullable(),
    afterSessionExerciseId: IdSchema.nullable(),
    supersetWithSessionExerciseId: IdSchema.nullable(),
    /** (19 Oct) A load for every working set in Ben's unit, as Ben asked ("at 0"); 0 = no weight; null = planned from his history. Absent on calls made before it. */
    load: z.number().min(0).max(1000).nullable().optional(),
  }),
  /** The exercise's pending sets go (a row with nothing done leaves the workout; otherwise its rest is skipped). */
  z.strictObject({ op: z.literal('remove'), sessionExerciseId: IdSchema }),
  /** The exercise (with its superset) goes straight after another one, or first (null). */
  z.strictObject({ op: z.literal('move'), sessionExerciseId: IdSchema, afterSessionExerciseId: IdSchema.nullable() }),
  /** (19 Oct) Two exercises already in today's workout become a superset (sets alternate). Either order: the one further along stays put, the other joins after it. */
  z.strictObject({ op: z.literal('superset'), sessionExerciseId: IdSchema, withSessionExerciseId: IdSchema }),
  /** (19 Oct) The exercise's superset is taken apart (each member back to its own sets). */
  z.strictObject({ op: z.literal('split_superset'), sessionExerciseId: IdSchema }),
]);
export type EditTodayOp = z.infer<typeof EditTodayOpSchema>;

export const EditTodayArgsSchema = z.strictObject({
  /** The session version the coach read (rule 5). */
  baseVersion: z.int().min(1),
  ops: z.array(EditTodayOpSchema).min(1).max(12),
  reason,
  ...askClaim,
});
export type EditTodayArgs = z.infer<typeof EditTodayArgsSchema>;

export const GetRecentActionsArgsSchema = z.strictObject({
  limit: z.int().min(1).max(10),
});

export const PendingSetChangeSchema = z.strictObject({
  setId: IdSchema,
  target: CoachTargetSchema,
});
export type PendingSetChange = z.infer<typeof PendingSetChangeSchema>;

export const ExerciseAdjustmentSchema = z.strictObject({
  sessionExerciseId: IdSchema,
  sets: z.array(PendingSetChangeSchema).max(20),
  /** At most one extra pending set per exercise (CA2). */
  addSet: CoachTargetSchema.nullable(),
  /** At most one pending set removed per exercise. */
  removeSetId: IdSchema.nullable(),
});
export type ExerciseAdjustment = z.infer<typeof ExerciseAdjustmentSchema>;

export const AdjustPendingSetsArgsSchema = z.strictObject({
  /** The session version the coach read. A newer session rejects the call as stale (rule 5). */
  baseVersion: z.int().min(1),
  exercises: z.array(ExerciseAdjustmentSchema).min(1).max(12),
  reason,
  ...askClaim,
});
export type AdjustPendingSetsArgs = z.infer<typeof AdjustPendingSetsArgsSchema>;

export const NextSessionTargetSchema = z.strictObject({
  exerciseId: IdSchema,
  target: CoachTargetSchema,
  /** Working sets for next time; null = keep the count. */
  sets: z.int().min(1).max(12).nullable(),
  reason,
});
export type NextSessionTarget = z.infer<typeof NextSessionTargetSchema>;

export const SetNextSessionTargetsArgsSchema = z.strictObject({
  sourceSessionId: IdSchema,
  sourceVersion: z.int().min(1),
  targets: z.array(NextSessionTargetSchema).min(1).max(20),
});
export type SetNextSessionTargetsArgs = z.infer<typeof SetNextSessionTargetsArgsSchema>;

export const StructuralChangeSchema = z.discriminatedUnion('change', [
  z.strictObject({ change: z.literal('swap'), fromExerciseId: IdSchema, toExerciseId: IdSchema }),
  z.strictObject({ change: z.literal('add'), exerciseId: IdSchema, afterExerciseId: IdSchema.nullable() }),
  z.strictObject({ change: z.literal('remove'), exerciseId: IdSchema }),
  z.strictObject({ change: z.literal('reorder'), exerciseIds: z.array(IdSchema).min(2).max(20) }),
]);
export type StructuralChange = z.infer<typeof StructuralChangeSchema>;

export const StructuralSignalKindSchema = z.enum([
  'variety_request',
  'goal_changed',
  'schedule_changed',
  'equipment_changed',
  'pain_flag',
]);
export type StructuralSignalKind = z.infer<typeof StructuralSignalKindSchema>;

export const ProposeNextWorkoutChangeArgsSchema = z.strictObject({
  sourceSessionId: IdSchema,
  sourceVersion: z.int().min(1),
  changes: z.array(StructuralChangeSchema).min(1).max(6),
  reason,
});
export type ProposeNextWorkoutChangeArgs = z.infer<typeof ProposeNextWorkoutChangeArgsSchema>;

export const SetPainFlagArgsSchema = z.strictObject({
  exerciseIds: z.array(IdSchema).min(1).max(10),
  area: PainAreaSchema.nullable(),
  /** Ben's words from this turn; the gate checks the turn itself, not this field. */
  quote,
});
export type SetPainFlagArgs = z.infer<typeof SetPainFlagArgsSchema>;

export const SaveMemoryArgsSchema = z.strictObject({
  text: z.string().min(1).max(200),
  quote,
});
export type SaveMemoryArgs = z.infer<typeof SaveMemoryArgsSchema>;

export const ForgetMemoryArgsSchema = z.strictObject({
  memoryId: IdSchema,
  expectedVersion: z.int().min(1),
});
export type ForgetMemoryArgs = z.infer<typeof ForgetMemoryArgsSchema>;

export const AddPlaybookCandidateArgsSchema = z.strictObject({
  text: z.string().min(1).max(400),
  statedBy: z.enum(['ben', 'coach']),
});
export type AddPlaybookCandidateArgs = z.infer<typeof AddPlaybookCandidateArgsSchema>;

/** Every v1 tool name. Anything else the model calls is `Not allowed`. */
export const CoachToolNameSchema = z.enum([
  'get_active_session',
  'get_recent_training',
  'get_training_overview',
  'get_gym_equipment',
  'get_progression_targets',
  'get_substitutions',
  /** (19 Oct) Search every exercise usable at the gym (the prompt's list is capped). */
  'find_exercises',
  'get_recent_actions',
  /** (Coach v3) Records per exercise, the e1RM labelled an estimate. */
  'get_exercise_records',
  /** (Coach v3) The last finished workouts with their sets. */
  'get_recent_sessions',
  /** (Coach v3) One step at a higher reasoning effort, once per turn. */
  'think_harder',
  'adjust_pending_sets',
  /** (12 Oct) Add an exercise to today's workout when Ben asks; applied at once with Undo. */
  'add_exercise_today',
  /** (14 Oct) Rename the live workout when Ben asks; applied at once with Undo. */
  'rename_workout',
  /**
   * (Coach v3, 18 Oct) One general tool for today's live workout: swap, add, remove, move, set count
   * and set targets. Replaces `adjust_pending_sets` and `add_exercise_today` on live-workout turns.
   */
  'edit_today',
  'log_set',
  'correct_set',
  'set_next_session_targets',
  'propose_next_workout_change',
  'set_pain_flag',
  'save_memory',
  'suggest_memory',
  'forget_memory',
  'add_playbook_candidate',
  /** (12 Oct) The workout builder's tool (workout-builder BD1); v2: structure and checked loads, never minutes. */
  'propose_workout',
  /** (14 Oct, workout builder v2 BD17) One clarifying question before a build; at most 2 per build request. */
  'ask_build_question',
  /** (19 Oct) A multi-day plan Ben asked for: every day at once, as a proposal he applies. */
  'propose_plan',
  /** (19 Oct) A new exercise for Ben's list, as a card he adds or edits. */
  'propose_exercise',
  /** (Ben, 20 Oct) Pause or resume the plan in use when Ben asks ("I'm on holiday till 3 Nov"); applied at once with Undo. */
  'pause_plan',
  /** (Ben, 20 Oct) A run, ride, swim or sport: logged when Ben asks ("18 km run yesterday"), else offered. */
  'log_activity',
  /** (Ben, 20 Oct) This week's remaining days merged or skipped around a run: a proposal Ben applies. */
  'propose_week',
]);
export type CoachToolName = z.infer<typeof CoachToolNameSchema>;

/** The argument schema of each tool, by name. */
export const COACH_TOOL_ARGS = {
  get_active_session: EmptyArgsSchema,
  get_recent_training: GetRecentTrainingArgsSchema,
  get_training_overview: GetTrainingOverviewArgsSchema,
  get_gym_equipment: GetGymEquipmentArgsSchema,
  get_progression_targets: GetProgressionTargetsArgsSchema,
  get_substitutions: GetSubstitutionsArgsSchema,
  find_exercises: FindExercisesArgsSchema,
  get_recent_actions: GetRecentActionsArgsSchema,
  get_exercise_records: GetExerciseRecordsArgsSchema,
  get_recent_sessions: GetRecentSessionsArgsSchema,
  think_harder: ThinkHarderArgsSchema,
  adjust_pending_sets: AdjustPendingSetsArgsSchema,
  add_exercise_today: AddExerciseTodayArgsSchema,
  rename_workout: RenameWorkoutArgsSchema,
  edit_today: EditTodayArgsSchema,
  log_set: LogSetArgsSchema,
  correct_set: CorrectSetArgsSchema,
  set_next_session_targets: SetNextSessionTargetsArgsSchema,
  propose_next_workout_change: ProposeNextWorkoutChangeArgsSchema,
  set_pain_flag: SetPainFlagArgsSchema,
  save_memory: SaveMemoryArgsSchema,
  suggest_memory: SaveMemoryArgsSchema,
  forget_memory: ForgetMemoryArgsSchema,
  add_playbook_candidate: AddPlaybookCandidateArgsSchema,
  propose_workout: ProposeWorkoutArgsSchema,
  ask_build_question: AskBuildQuestionArgsSchema,
  propose_plan: ProposePlanArgsSchema,
  propose_exercise: ProposeExerciseArgsSchema,
  pause_plan: PausePlanArgsSchema,
  log_activity: LogActivityArgsSchema,
  propose_week: ProposeWeekArgsSchema,
} as const satisfies Record<CoachToolName, z.ZodType>;

// ---------------------------------------------------------------------------
// Fit to time: the coach's answer to `Ask coach` on `How long?` (fit-to-time §5)

/**
 * The one function the coach calls to fit today's plan (fit-to-time §5.2).
 * Not a chat-turn tool: it is the only tool of its own request, sent when
 * Ben taps `Ask coach`. Flat and closed for strict mode (every field
 * present, `null` when unused). The app validates every edit
 * (`validateTodayFit`); the model's minutes, if it gives any, are ignored.
 */
export const TODAY_FIT_TOOL_NAME = 'fit_today';

export const TodayFitEditArgsSchema = z.strictObject({
  kind: z.enum(['skip', 'sets', 'add', 'swap', 'superset', 'reps', 'load', 'rest']),
  /** The plan slot (`slotKey` from the context); null for `add` and `superset`. */
  slotKey: z.string().max(64).nullable(),
  /** `add`: Ben's exercise to add; `swap`: the exercise to swap to. */
  exerciseId: z.string().max(64).nullable(),
  /** `sets`: the working-set count today. */
  workingSets: z.int().min(0).max(20).nullable(),
  /** `superset`: the slots to pair. */
  slotKeys: z.array(z.string().max(64)).max(6).nullable(),
  /** `load`, `rest` or `reps`: the number the model asked for (always refused in a fit). */
  value: z.number().nullable(),
});
export type TodayFitEditArgs = z.infer<typeof TodayFitEditArgsSchema>;

export const TodayFitArgsSchema = z.strictObject({
  /** One or two sentences for `Why?`. */
  reason: z.string().max(240),
  edits: z.array(TodayFitEditArgsSchema).max(24),
});
export type TodayFitArgs = z.infer<typeof TodayFitArgsSchema>;

/** A parsed, validated tool call: a discriminated union on `tool`. */
export type CoachToolCall = {
  [K in CoachToolName]: { tool: K; args: z.infer<(typeof COACH_TOOL_ARGS)[K]> };
}[CoachToolName];

// ---------------------------------------------------------------------------
// Guard notes (written by the domain validators, never by the model)

export const GuardNoteKindSchema = z.enum([
  'snapped',
  'capped',
  'converted',
  'pain_blocked',
  /** Ben mentioned pain on this movement in this turn; no pain flag exists (review B1). */
  'pain_mentioned',
  'pain_unspecified',
  'lighter_no_increase',
  'no_achievable_load',
  'no_equipment',
  'convention_mismatch',
  'completed_set_dropped',
  'not_pending',
  'unknown_target',
  'invalid_reps',
  'too_many_sets',
  'structural_dropped',
  /** The coach's target RPE wasn't used: Ben set his own for the set (review target-rpe S2). */
  'rpe_overridden',
  /** (12 Oct) A workout-builder check (`checkWorkoutProposal`, BD9): left out, swapped, clamped or filled in. */
  'build_check',
]);
export type GuardNoteKind = z.infer<typeof GuardNoteKindSchema>;

export const GuardNoteSchema = z.object({
  kind: GuardNoteKindSchema,
  setIds: z.array(IdSchema).max(40),
  /** App text, e.g. `Rounded to 97.5 kg: nearest your bar and plates allow.` */
  text: z.string().min(1).max(300),
});
export type GuardNote = z.infer<typeof GuardNoteSchema>;

// ---------------------------------------------------------------------------
// Action records (coach-contract §6)

export const ActionStatusSchema = z.enum(['committed', 'proposed', 'rejected', 'stale', 'failed']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** One pending set's target before and after (targets only; never an actual). */
export const SetTargetChangeSchema = z.object({
  setId: IdSchema,
  /** 1-based position in the exercise, as shown on the set card. */
  setNumber: z.int().min(1),
  before: CoachTargetSchema.nullable(),
  after: CoachTargetSchema.nullable(),
});
export type SetTargetChange = z.infer<typeof SetTargetChangeSchema>;

export const ExerciseTargetChangesSchema = z.object({
  sessionExerciseId: IdSchema,
  exerciseName: z.string().min(1).max(120),
  changes: z.array(SetTargetChangeSchema).max(40),
});
export type ExerciseTargetChanges = z.infer<typeof ExerciseTargetChangesSchema>;

export const NextTargetRowSchema = z.object({
  exerciseId: IdSchema,
  exerciseName: z.string().min(1).max(120),
  before: CoachTargetSchema.nullable(),
  after: CoachTargetSchema,
  setsBefore: z.int().min(0).nullable(),
  setsAfter: z.int().min(0).nullable(),
  /** CA8: `small` is saved by default, `bigger` is a proposal. */
  size: z.enum(['small', 'bigger']),
});
export type NextTargetRow = z.infer<typeof NextTargetRowSchema>;

export const StructuralChangeLineSchema = z.object({
  change: z.enum(['swap', 'add', 'remove', 'reorder', 'edit']),
  /** App text, e.g. `Cable fly → Pec deck`. */
  text: z.string().min(1).max(200),
});

/** One checked structural change, by plan slot (routine slot or the source workout's part root). */
export const StructuralOpSchema = z.discriminatedUnion('change', [
  z.object({ change: z.literal('swap'), slotKey: IdSchema, fromExerciseId: IdSchema, fromName: z.string().min(1).max(120), toExerciseId: IdSchema, toName: z.string().min(1).max(120) }),
  z.object({ change: z.literal('remove'), slotKey: IdSchema, exerciseId: IdSchema, name: z.string().min(1).max(120) }),
  z.object({ change: z.literal('reorder'), slotKeys: z.array(IdSchema).min(2).max(40), names: z.array(z.string().max(120)).max(40) }),
]);
export type StructuralOpRecord = z.infer<typeof StructuralOpSchema>;

export const ActionDetailSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('adjust_pending_sets'),
    sessionId: IdSchema,
    exercises: z.array(ExerciseTargetChangesSchema).max(12),
  }),
  /**
   * (12 Oct) An exercise added to today's workout from chat. `sessionExerciseId`:
   * the new row (Undo takes it out with `undo_op` while none of its sets is done).
   * `target`: the first working set's target as saved (load null = blank, no history
   * on that equipment, B6). App text names only, never model words.
   */
  z.object({
    kind: z.literal('add_exercise_today'),
    sessionId: IdSchema,
    sessionExerciseId: IdSchema,
    exerciseId: IdSchema.nullable(),
    exerciseName: z.string().min(1).max(120),
    sets: z.int().min(0).max(20),
    target: CoachTargetSchema.nullable(),
    durationS: z.int().min(0).max(36_000).nullable(),
    /** Cardio (review S3): the distance target in metres; absent otherwise and on records made before it. */
    distanceM: z.number().min(0).max(100_000).optional(),
    equipmentName: z.string().min(1).max(120).nullable(),
    afterName: z.string().min(1).max(120).nullable(),
    supersetWithName: z.string().min(1).max(120).nullable(),
  }),
  /** (14 Oct) The live workout renamed from chat: the name before (null: none) and after, for Undo. */
  z.object({
    kind: z.literal('rename_workout'),
    sessionId: IdSchema,
    before: z.string().min(1).max(120).nullable(),
    after: z.string().min(1).max(120),
  }),
  /**
   * (Coach v3, ADR 0027, 18 Oct) The coach's change to today's live workout (`edit_today`): swaps,
   * adds, removals, moves, set counts and set targets, as one operation (`coach_edit_today`).
   * `lines`: app text, one per structural change (`Bench press → Dumbbell bench press`).
   * `exercises`: set targets and counts before and after (as `adjust_pending_sets`). `names`: every
   * exercise the edit touched, for the claim check. `command`: exactly what applies (and, on an
   * offer, what Ben's accept applies, with no model call), or null on a refusal. `proposalId`: on
   * the record of Ben's accept, the offer it applied. Undo is `revert_coach_edit` on the command.
   */
  z.object({
    kind: z.literal('edit_today'),
    sessionId: IdSchema,
    baseVersion: z.int().min(1),
    lines: z.array(StructuralChangeLineSchema).max(24),
    exercises: z.array(ExerciseTargetChangesSchema).max(24),
    names: z.array(z.string().min(1).max(120)).max(48),
    /** Each added exercise as saved (in the order of the `add` lines): its first working set's target, for the card. */
    added: z
      .array(
        z.object({
          exerciseName: z.string().min(1).max(120),
          sets: z.int().min(0).max(20),
          target: CoachTargetSchema.nullable(),
          durationS: z.int().min(0).max(36_000).nullable(),
          /** Cardio (review S3): the distance target in metres; absent otherwise. */
          distanceM: z.number().min(0).max(100_000).optional(),
          afterName: z.string().min(1).max(120).nullable(),
          supersetWithName: z.string().min(1).max(120).nullable(),
        }),
      )
      .max(12)
      .optional(),
    command: CoachEditTodayCommandSchema.nullable(),
    proposalId: IdSchema.optional(),
  }),
  /** (11 Oct) A set logged from chat: what was saved, and the set's version after, for Undo (`undo_log`). */
  z.object({
    kind: z.literal('log_set'),
    sessionId: IdSchema,
    setId: IdSchema,
    exerciseName: z.string().min(1).max(120),
    setNumber: z.int().min(1),
    values: z.object({ load: LoadSchema.nullable(), reps: z.int().min(0).max(100).nullable(), rpe: z.number().min(1).max(10).nullable() }),
    setVersionAfter: z.int().min(1).nullable(),
  }),
  /** (11 Oct) A logged set corrected from chat: before and after values, and the set's version after, for Undo. */
  z.object({
    kind: z.literal('correct_set'),
    sessionId: IdSchema,
    setId: IdSchema,
    exerciseName: z.string().min(1).max(120),
    setNumber: z.int().min(1),
    before: z.object({ load: LoadSchema.nullable(), reps: z.int().min(0).max(100).nullable(), rpe: z.number().min(1).max(10).nullable() }),
    after: z.object({ load: LoadSchema.nullable(), reps: z.int().min(0).max(100).nullable(), rpe: z.number().min(1).max(10).nullable() }),
    setVersionAfter: z.int().min(1).nullable(),
  }),
  z.object({
    kind: z.literal('set_next_session_targets'),
    sourceSessionId: IdSchema,
    /** `Push A`, or the workout's title when there is no routine. */
    workoutLabel: z.string().min(1).max(120),
    rows: z.array(NextTargetRowSchema).max(20),
  }),
  z.object({
    kind: z.literal('propose_next_workout_change'),
    sourceSessionId: IdSchema,
    workoutLabel: z.string().min(1).max(120),
    changes: z.array(StructuralChangeLineSchema).min(1).max(6),
    /** App text after `Because:`. */
    because: z.string().min(1).max(200),
    /**
     * (11 Oct, coach tools) What the next workout starts from: the routine, or
     * the next session built from `sourceSessionId`. Absent on records made
     * before structural proposals were built.
     */
    basis: DraftBasisSchema.optional(),
    /** The basis's version when proposed: the routine's version, or the source workout's. A later version makes the card `Out of date`. */
    basisVersion: z.int().min(1).optional(),
    /** The checked changes, by plan slot (`structuralDraftEdits` turns them into draft edits on Apply). */
    ops: z.array(StructuralOpSchema).max(6).optional(),
    /** Exercise names before and after, in order. */
    before: z.array(z.string().min(1).max(120)).max(40).optional(),
    after: z.array(z.string().min(1).max(120)).max(40).optional(),
    /**
     * On Ben's own records about a proposal (author `ben`): the proposal's
     * action ID. `committed` = Apply (undoable until the next workout
     * starts), `rejected` = Not now.
     */
    proposalId: IdSchema.optional(),
  }),
  /**
   * Ben changed a routine from today's edits (`Change Push A too ›`, ADR 0022;
   * overview-today-edits TE4): one slot's exercise replaced through a
   * change-review card. `before`/`after` are the slot as it was and as Apply
   * left it, so Undo puts exactly `before` back while the routine is still at
   * `versionAfter`. `draft`: the pre-start draft edit Apply made redundant.
   */
  z.object({
    kind: z.literal('update_routine'),
    routineId: IdSchema,
    routineName: z.string().min(1).max(120),
    /** Up to 6 for a one-slot change or an editor save; `Update Push A` (§11.5) lists one line per checked edit. */
    changes: z.array(StructuralChangeLineSchema).min(1).max(40),
    /** A one-slot change (`Change Push A too ›`); absent for an editor save. */
    slot: z.object({ before: RoutineExerciseSchema, after: RoutineExerciseSchema }).optional(),
    /**
     * An editor save (routines.md WL10): the whole workout as it was, so
     * `Undo` (also after a force-close) restores it while the workout is
     * still at `versionAfter`.
     */
    before: RoutineSchema.optional(),
    versionBefore: z.int().min(1),
    versionAfter: z.int().min(2),
    /**
     * The draft edits the change made redundant (marked so in the same
     * write; Undo brings them back). `editId` is the first; `editIds`, when
     * present, is every one (`Update Push A`, overview-today-edits §11.5).
     */
    draft: z.object({ id: IdSchema, editId: IdSchema, editIds: z.array(IdSchema).min(1).max(80).optional() }).nullable(),
  }),
  z.object({
    kind: z.literal('set_pain_flag'),
    flagIds: z.array(IdSchema).max(10),
    exerciseNames: z.array(z.string().min(1).max(120)).min(1).max(10),
    area: PainAreaSchema.nullable(),
  }),
  z.object({ kind: z.literal('save_memory'), memoryId: IdSchema, text: z.string().min(1).max(200) }),
  /** (11 Oct) A memory the coach suggested: `proposed`; Ben's Save or Not now changes the memory, not this record. */
  z.object({ kind: z.literal('suggest_memory'), memoryId: IdSchema, text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('forget_memory'), memoryId: IdSchema, text: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal('add_playbook_candidate'),
    candidateId: IdSchema,
    text: z.string().min(1).max(400),
    /** (12 Oct) The memory suggestion Ben sent here with `Add to playbook` (CM9 split). */
    fromMemoryId: IdSchema.optional(),
  }),
  /**
   * Fit to time (fit-to-time §5): the coach's fit of today's plan, applied at
   * once because Ben asked (rule 3), today only. `editIds`: the draft edits
   * it wrote (the fit and its skips, sets and adds; one `actionId`), so Undo
   * removes exactly those. `lines`, `rejected` and `suggestions` are app
   * text: what changed, what the checks refused, and the swaps offered as a
   * `Today only` card (never applied without Apply).
   */
  z.object({
    kind: z.literal('fit_today'),
    workoutLabel: z.string().min(1).max(120),
    minutes: z.int().min(15).max(180),
    beforeMinutes: z.int().min(0).max(600),
    afterMinutes: z.int().min(0).max(600),
    draftId: IdSchema,
    fitEditId: IdSchema,
    editIds: z.array(IdSchema).min(1).max(40),
    lines: z.array(z.string().min(1).max(200)).max(40),
    rejected: z.array(z.object({ text: z.string().min(1).max(200), why: z.string().min(1).max(40) })).max(40),
    suggestions: z.array(z.object({ slotKey: IdSchema, toExerciseId: IdSchema, text: z.string().min(1).max(200) })).max(6),
  }),
  /**
   * (12 Oct, workout builder) The coach built a workout draft, or a new
   * version of one (BD16), because Ben asked. App text and counts only; the
   * card reads the draft itself. `lines`: the `diffDraftVersions` lines
   * against the parent version (empty for a first version).
   */
  z.object({
    kind: z.literal('build_workout'),
    draftId: IdSchema,
    versionN: z.int().min(1),
    parentN: z.int().min(1).nullable(),
    name: z.string().min(1).max(120),
    exerciseCount: z.int().min(0).max(40),
    leftOut: z.int().min(0).max(40),
    gymName: z.string().min(1).max(120).nullable(),
    lines: z.array(StructuralChangeLineSchema).max(40),
  }),
  /**
   * (14 Oct, workout builder v2 BD17) A clarifying question the coach asked
   * before building, after `checkBuildQuestion` passed it. Status
   * `proposed` while it waits for Ben's tap. App-checked text: the question
   * (≤ 80), 2–4 answers (≤ 24; `main_lift` answers are catalogue names with
   * their IDs). Nothing else is written.
   */
  z.object({
    kind: z.literal('build_question'),
    topic: BuildQuestionTopicSchema,
    question: z.string().min(1).max(80),
    answers: z.array(z.object({ label: z.string().min(1).max(24), catalogueId: z.string().min(1).max(80).nullable() })).min(2).max(4),
    /** The split day the question is about (`main_lift` saves go to this day), when there is one. */
    day: z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(30) }).nullable(),
  }),
  /**
   * (19 Oct, plans) The coach built a multi-day plan, or a new version of one, because Ben asked.
   * A proposal: nothing changes until Ben applies it (the plan document records Apply and Undo).
   * App text and counts only; the card reads the plan itself.
   */
  z.object({
    kind: z.literal('build_plan'),
    planId: IdSchema,
    versionN: z.int().min(1),
    parentN: z.int().min(1).nullable(),
    name: z.string().min(1).max(120),
    days: z.array(z.object({ name: z.string().min(1).max(30), exerciseCount: z.int().min(0).max(40), leftOut: z.int().min(0).max(40) })).max(7),
    gymName: z.string().min(1).max(120).nullable(),
  }),
  /**
   * (19 Oct) The coach proposed a new exercise for Ben's list. `proposed` until he acts: Add saves it
   * as `exerciseId` (one exercise per card, so a double tap saves once); Edit opens the form with
   * these fields. Checked fields only (a convention that fits the equipment); the card reads the
   * exercise row for whether it was added.
   */
  z.object({
    kind: z.literal('propose_exercise'),
    exerciseId: IdSchema,
    fields: CustomExerciseFieldsSchema,
  }),
  /**
   * (Ben, 20 Oct) The plan in use paused (until `untilDate`, or until Ben resumes: null) or resumed,
   * because Ben asked. `versionAfter`: the plan's version the write left (Undo only from it).
   */
  z.object({
    kind: z.literal('pause_plan'),
    planId: IdSchema,
    planName: z.string().min(1).max(120),
    action: z.enum(['pause', 'resume']),
    untilDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    versionAfter: z.int().min(1).nullable(),
  }),
  /**
   * (Ben, 20 Oct) An activity the coach logged (committed: `activityId` names it) or offered (proposed:
   * the fields Ben's tap logs). `versionAfter`: the activity's version the write left (Undo only from it).
   */
  z.object({
    kind: z.literal('log_activity'),
    activityId: IdSchema.nullable(),
    /** What was (or would be) logged; a refused call keeps what it could read (possibly no duration, distance or effort). */
    fields: ActivityFieldsShapeSchema,
    versionAfter: z.int().min(1).nullable(),
    /** Ben's tap on an offer: the offer it logged. */
    proposalId: IdSchema.optional(),
  }),
  /**
   * (Ben, 20 Oct) This week reshaped around a run: a proposal (always), with the before/after list and
   * scope `This week`. `factsKey`: what the week looked like when proposed (plan version, workouts and
   * activities this week); Apply is refused as stale when it changed (rule 5).
   */
  z.object({
    kind: z.literal('propose_week'),
    weekMonday: LocalDateSchema,
    basis: WeekBasisSchema,
    merges: z.array(WeekMergeSchema).max(3),
    skips: z.array(WeekSkipSchema).max(3),
    before: z.array(WeekRowSchema).max(7),
    after: z.array(WeekRowSchema).max(7),
    factsKey: z.string().min(1).max(256),
  }),
  z.object({
    kind: z.literal('undo'),
    undoneActionId: IdSchema,
    /** What was undone, rendered from the original record: `the change to sets 3–4`. */
    what: z.string().min(1).max(200),
    /** Restored targets of sets still pending; empty when only a memory or flag was undone. */
    restored: z.array(ExerciseTargetChangesSchema).max(12),
    /** Set numbers that were logged since, so stayed as they were (CA `Undo partly possible`). */
    alreadyLogged: z.array(z.int().min(1)).max(40),
  }),
]);
export type ActionDetail = z.infer<typeof ActionDetailSchema>;
export type ActionKind = ActionDetail['kind'];

export const EntityVersionSchema = z.object({
  entity: z.string().min(1).max(60),
  id: IdSchema,
  before: z.int().min(0).nullable(),
  after: z.int().min(0).nullable(),
});

export const ActionRecordSchema = z.object({
  actionId: IdSchema,
  /** The coach turn that made it. Null for Ben's own taps (e.g. Undo from a banner). */
  turnId: z.string().min(1).max(64).nullable(),
  /** Idempotency key: a repeated call with the same opId returns this record. */
  opId: OperationIdSchema,
  status: ActionStatusSchema,
  author: z.enum(['coach', 'ben', 'checks']),
  detail: ActionDetailSchema,
  /** Why a `rejected` / `stale` / `failed` action didn't happen, as app text. */
  failure: z.string().min(1).max(200).nullable(),
  /** The coach's reason, after the claim check. (Coach v3) Up to 600: a build's message is its reason. */
  reason: z.string().max(600).nullable(),
  evidenceRefs: z.array(z.string().min(1).max(120)).max(40),
  guardNotes: z.array(GuardNoteSchema).max(40),
  entityVersions: z.array(EntityVersionSchema).max(60),
  undoneBy: z.object({ actionId: IdSchema, atUtc: UtcTimestampSchema }).nullable(),
  createdAt: ZonedTimestampSchema,
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;

/** A model sentence the claim check hid, kept for `Why?` → `Not shown` (CC9). Your data. */
export const HiddenLineSchema = z.object({
  turnId: z.string().min(1).max(64),
  sentence: z.string().min(1).max(2000),
  /** (Coach v3) `unverified_number`: a number not found in anything the coach was given. */
  reason: z.enum(['no_action', 'not_committed', 'mismatch', 'numbers_differ', 'unknown_token', 'unverified_number']),
  /** App text, e.g. `No change was saved in this reply.` */
  detail: z.string().min(1).max(300),
  atUtc: UtcTimestampSchema,
});
export type HiddenLine = z.infer<typeof HiddenLineSchema>;

// ---------------------------------------------------------------------------
// The coach's structured reply (PM decision 10 Oct: honesty is structural)

/**
 * The only way a model step can end a turn: a strict function call whose
 * arguments are this object. `message` is advice, explanation or a question,
 * never a report of a change; every change Ben sees is a card rendered from
 * the committed `ActionRecord`. `offer` marks a coach-raised offer to adjust
 * today's remaining sets (CLAUDE.md rule 3: it waits for Ben's accept), so
 * the engine knows structurally, not from the words, that a bare "yes" next
 * accepts it.
 */
export const COACH_REPLY_TOOL_NAME = 'reply';

export const CoachOfferKindSchema = z.enum(['adjust_today']);
export type CoachOfferKind = z.infer<typeof CoachOfferKindSchema>;

export const CoachReplySchema = z.strictObject({
  message: z.string().max(4000),
  offer: CoachOfferKindSchema.nullable(),
});
export type CoachReply = z.infer<typeof CoachReplySchema>;

// ---------------------------------------------------------------------------
// Coach storage (ADR 0020 §9; all Your data except playbook candidates)

/** A conversation. Owner-scoped; v1 keeps every thread. */
export const CoachThreadSchema = RecordMetaSchema.extend({
  /** The workout the thread was opened from, if any. */
  sessionId: IdSchema.nullable(),
  /** The thread list's title: the first words of Ben's first message (app text). */
  title: z.string().min(1).max(80),
});
export type CoachThread = z.infer<typeof CoachThreadSchema>;

export const CoachTurnStatusSchema = z.enum(['running', 'completed', 'interrupted', 'failed', 'cancelled']);
export type CoachTurnStatus = z.infer<typeof CoachTurnStatusSchema>;

export const CoachTurnErrorSchema = z.enum([
  'usage_limit',
  'not_eligible',
  'auth_expired',
  'model_gone',
  'unavailable',
  'network',
  'timeout',
  'cancelled',
  'no_reply',
  'too_many_steps',
]);
export type CoachTurnError = z.infer<typeof CoachTurnErrorSchema>;

/** One line of the turn's tool log (`ToolSummaryLine`, `Why?` → `Not used`). App text. */
export const ToolLogLineSchema = z.object({
  tool: z.string().min(1).max(80),
  outcome: z.enum(['read', 'committed', 'proposed', 'rejected', 'stale', 'failed', 'not_allowed', 'invalid_args', 'replayed']),
  text: z.string().min(1).max(300),
  actionId: IdSchema.nullable(),
});
export type ToolLogLine = z.infer<typeof ToolLogLineSchema>;

/**
 * One request to the coach and what came of it. A turn still `running` at
 * launch was cut off by a force-close and becomes `interrupted` (restart
 * recovery); its committed actions are in `coach_actions` either way.
 */
export const CoachTurnSchema = RecordMetaSchema.extend({
  threadId: IdSchema,
  kind: CoachTurnKindSchema,
  status: CoachTurnStatusSchema,
  error: CoachTurnErrorSchema.nullable(),
  model: z.string().min(1).max(120),
  /** `buildCoachContext().contextHash`, so `What the coach can see` can show what was sent. */
  contextHash: z.string().min(1).max(128),
  startedAt: ZonedTimestampSchema,
  endedAtUtc: UtcTimestampSchema.nullable(),
  toolLog: z.array(ToolLogLineSchema).max(40),
});
export type CoachTurn = z.infer<typeof CoachTurnSchema>;

/** Ben's words (or chip) in a turn, saved before the request is sent. */
export const BenInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('words'), text: z.string().min(1).max(4000), spoken: z.boolean() }),
  z.object({
    kind: z.literal('chip'),
    chip: z.enum(['too_hard', 'too_easy', 'pain', 'lighter_session']),
    /** An offer's `Adjust` (CA1): the exercise row the offer was about; only it may change (review S1). */
    sessionExerciseId: IdSchema.optional(),
  }),
  z.object({ kind: z.literal('accept_offer'), offer: CoachOfferKindSchema }),
  /** The post-workout summary turn: no words from Ben (ADR 0020 C8). */
  z.object({ kind: z.literal('summary') }),
]);
export type BenInput = z.infer<typeof BenInputSchema>;

/** What a coach message shows, in order. Every change line is rendered from a saved record at display time. */
export const CoachShownItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sentence'), text: z.string().min(1).max(2000) }),
  /** A `[[ref]]` the coach cited; rendered from the record when shown. */
  z.object({ kind: z.literal('action_line'), actionId: IdSchema }),
]);
export type CoachShownItem = z.infer<typeof CoachShownItemSchema>;

/** Append-only. A coach message holds only what passed the checks; hidden lines are kept beside it (CC9). */
export const CoachMessageSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  threadId: IdSchema,
  turnId: IdSchema,
  /** Order within the thread. */
  ordinal: z.int().min(0),
  createdAt: ZonedTimestampSchema,
  body: z.discriminatedUnion('role', [
    z.object({ role: z.literal('ben'), input: BenInputSchema }),
    z.object({
      role: z.literal('coach'),
      items: z.array(CoachShownItemSchema).max(200),
      /** Cards: every action this turn committed or proposed, rendered from the record. */
      actionIds: z.array(IdSchema).max(40),
      /** `ClaimCheckNote` or the fixed no-change line (app text). */
      note: z.string().min(1).max(300).nullable(),
      offer: CoachOfferKindSchema.nullable(),
      hiddenLines: z.array(HiddenLineSchema).max(200),
      /** False when the reply was cut off (Stop, stall, force-close): no sentence is padded. */
      complete: z.boolean(),
    }),
  ]),
});
export type CoachMessage = z.infer<typeof CoachMessageSchema>;

/** A personal fact Ben asked the coach to remember (coach-memory, v1 subset). Your data. */
export const MemorySchema = RecordMetaSchema.extend({
  text: z.string().min(1).max(200),
  /** `appendContentKeys`: a live memory with the same key is the same memory. */
  contentKey: z.string().min(1).max(160),
  /**
   * `active`: confirmed, sent to the coach. `forgotten`: tombstone.
   * (11 Oct, coach tools) `suggested`: the coach suggested it; waits for Ben's
   * Save and is never sent to the coach (CM1). `not_saved`: Ben tapped Not now.
   */
  status: z.enum(['active', 'forgotten', 'suggested', 'not_saved']),
  /** Ben's words that asked for it (quoted data). */
  quote: z.string().min(1).max(400),
  createdByActionId: IdSchema,
  /** (11 Oct) Where it came from: Ben asked the coach (absent on older rows), the coach suggested it, or Ben added it in Memory. */
  source: z.enum(['ben_asked', 'coach_suggested', 'ben_added']).optional(),
  /** (11 Oct) Ben's edits, oldest first: the text before each edit. */
  edits: z.array(z.object({ before: z.string().min(1).max(200), atUtc: UtcTimestampSchema })).max(20).optional(),
  /** (12 Oct) A `not_saved` suggestion Ben sent to the playbook (CM9 `Add to playbook`), not `Not now`. */
  closedAs: z.literal('playbook').optional(),
});
export type Memory = z.infer<typeof MemorySchema>;

/**
 * A general training rule waiting for Ben's review. Coaching knowledge: no
 * owner, never in Your data, never used by the coach until approved (CM9).
 */
export const PlaybookCandidateSchema = z.object({
  id: IdSchema,
  version: z.int().min(1),
  createdAtUtc: UtcTimestampSchema,
  updatedAtUtc: UtcTimestampSchema,
  text: z.string().min(1).max(400),
  contentKey: z.string().min(1).max(160),
  statedBy: z.enum(['ben', 'coach']),
  /**
   * `to_review`: waiting for Ben, never used. `withdrawn`: undone.
   * (11 Oct, coach tools; B8: the app records which rules Ben approved)
   * `approved`: sent to the coach as Coaching knowledge, labelled not
   * evidence-graded. `rejected`: not used and not offered again in the same words.
   */
  status: z.enum(['to_review', 'withdrawn', 'approved', 'rejected']),
  createdByActionId: IdSchema,
  /** (11 Oct) When Ben last approved or rejected it. */
  decidedAtUtc: UtcTimestampSchema.optional(),
});
export type PlaybookCandidate = z.infer<typeof PlaybookCandidateSchema>;

/**
 * One exercise's coach target for the next session of a workout (ADR 0020
 * §5, D21, coach-adjustments CA8/CA10). Your data. One row per source
 * workout and exercise; the action that set it is the audit.
 * - `saved`: a small change, used by default (`nextTargetsOf` prefers it).
 * - `undone`: Ben undid it; the built-in rule's target is used. `Use coach target` puts it back.
 * - `proposed`: a bigger change; the built-in rule is used until Ben taps Apply.
 * - `applied`: a bigger change Ben applied.
 * - `not_applied`: Ben tapped Not now.
 * A row is only used while the source workout's sets are unchanged
 * (`sourceBasis`; rows saved before it existed: `sourceVersion`; a rename
 * or a time edit doesn't count) and until a workout is started from it.
 * `usedBySessionId` is worked out
 * when the row is read: the workout started from this source that exists
 * and isn't discarded (review S2, S3); null while there is none.
 */
export const NextSessionTargetRecordSchema = RecordMetaSchema.extend({
  sourceSessionId: IdSchema,
  sourceVersion: z.int().min(1),
  /** `nextTargetSourceBasis` of the source workout when saved: its sets as they stood. Absent on rows saved before it existed. */
  sourceBasis: z.string().min(1).max(80).optional(),
  exerciseId: IdSchema,
  exerciseName: z.string().min(1).max(120),
  actionId: IdSchema,
  target: CoachTargetSchema,
  /** Working sets next time; null keeps the count. */
  sets: z.int().min(1).max(12).nullable(),
  /** The built-in rule's target for comparison (`Built-in rule would be …`). */
  builtIn: CoachTargetSchema.nullable(),
  builtInSets: z.int().min(0).max(40).nullable(),
  size: z.enum(['small', 'bigger']),
  status: z.enum(['saved', 'undone', 'proposed', 'applied', 'not_applied']),
  /** The coach's reason (claim-checked), shown behind `Why?`. */
  reason: z.string().max(240).nullable(),
  guardNotes: z.array(GuardNoteSchema).max(20),
  /** Load change from the last working target, in %, from the saved values. */
  pctChange: z.number().nullable(),
  usedBySessionId: IdSchema.nullable(),
});
export type NextSessionTargetRecord = z.infer<typeof NextSessionTargetRecordSchema>;
export type NextSessionTargetStatus = NextSessionTargetRecord['status'];

// ---------------------------------------------------------------------------
// Store contract (implemented by `@fizz/persistence`, used by `@fizz/coach`)

/**
 * One coach write: the `ActionRecord` and the change it describes, committed
 * in one transaction. Idempotent on the record's `opId`, and for the append
 * kinds on the content (an active memory with the same key, an open playbook
 * candidate with the same text, an active flag on the same exercise).
 */
export type CoachWrite =
  /** A record with no other change: a proposal, or a rejected / stale / failed outcome. */
  | { kind: 'record'; action: ActionRecord }
  | { kind: 'save_memory'; action: ActionRecord; memory: Memory }
  /** (11 Oct) A coach suggestion: a `suggested` memory, refused when the same text is already saved or waiting. */
  | { kind: 'suggest_memory'; action: ActionRecord; memory: Memory }
  | { kind: 'forget_memory'; action: ActionRecord; memoryId: string; expectedVersion: number; atUtc: string }
  | { kind: 'pain_flags'; action: ActionRecord; flags: readonly PainFlag[] }
  | { kind: 'playbook_candidate'; action: ActionRecord; candidate: PlaybookCandidate }
  /**
   * Next-session targets (D21): the rows, replacing earlier rows for the same
   * source and exercise. Refused as stale when the source workout changed or
   * a workout has started since it ended (CA10).
   */
  | { kind: 'next_session_targets'; action: ActionRecord; rows: readonly NextSessionTargetRecord[]; sourceVersion: number; sourceBasis: string }
  /**
   * Today's pending sets (`adjust_pending_sets`): the session command runs
   * through the reducer inside the same transaction as the record, so the
   * targets and their record are saved together or not at all (rule 5).
   */
  /**
   * `expectedSessionVersion`: refused as stale when the workout moved on since the caller read it (checked inside the write, review N3).
   * `saveExercise` (coach add, review S3): a catalogue exercise not yet in Ben's exercises, saved in the same
   * transaction as the command, so a refused or stale add leaves no exercise row behind (audit F4).
   */
  | { kind: 'session_command'; action: ActionRecord; sessionId: string; command: SessionCommand; expectedSessionVersion?: number; saveExercise?: Exercise; saveExercises?: readonly Exercise[] }
  /**
   * (12 Oct, workout builder) A coach draft and its record, in one write.
   * `expectedVersion`: null creates the draft; otherwise the draft's version
   * the new version was built on (a newer one refuses it as stale, rule 5).
   */
  | { kind: 'workout_draft'; action: ActionRecord; draft: WorkoutDraft; expectedVersion: number | null }
  /** (19 Oct) A coach plan and its record, in one write; `expectedVersion` as for a draft. */
  | { kind: 'plan_draft'; action: ActionRecord; plan: PlanDraft; expectedVersion: number | null }
  /** (Ben, 20 Oct) The plan in use paused or resumed (`pause_plan`) and its record, in one write on the version read (rule 5). */
  | { kind: 'plan_control'; action: ActionRecord; plan: PlanDraft; expectedVersion: number }
  /** (Ben, 20 Oct) An activity the coach logged and its record, in one write (`expectedVersion` null: new). */
  | { kind: 'activity'; action: ActionRecord; activity: Activity; expectedVersion: number | null };

export type CoachWriteResult =
  | { status: 'written'; action: ActionRecord }
  /** Nothing new was written: the same opId, or the same live content, already exists. */
  | { status: 'replayed'; action: ActionRecord }
  /** Nothing was written; the caller records the outcome as its own `rejected` / `stale` record. */
  | { status: 'conflict'; reason: 'stale_version' | 'missing' | 'already_exists' };

export type CoachUndoResult =
  | { status: 'written' | 'replayed'; undo: ActionRecord; target: ActionRecord }
  | { status: 'not_possible'; reason: 'missing' | 'not_committed' | 'already_undone' | 'changed_since' | 'gym_changed' | 'unsupported' };
