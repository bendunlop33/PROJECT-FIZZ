import { z } from 'zod';
import { WeightUnitSchema } from './common';
import { BUILDER_GROUPS } from './builder-groups';

/**
 * Workout builder v3 coach tools (workout-builder-v3.md §5, §6.1; Ben,
 * 20 Oct). Each is the one function of its own request, like `fit_today`:
 * the model must call it, code checks every field and works out every
 * number (minutes from the estimate, loads snapped down, counts recounted),
 * and nothing is written from the model's words alone.
 *
 * Strict for function calling: every object closed, every field present
 * (`null` when unused). The number bounds here are parse bounds only, wide
 * enough that the checks can clamp and say so; the builder's own limits
 * (`BUILD_LIMITS`) apply in the checks.
 */

export const BUILDER_COACH_TOOL = {
  fillSetup: 'fill_setup',
  proposeWorkoutEdit: 'propose_workout_edit',
  reviewWorkout: 'review_workout',
  mixPick: 'mix_pick',
  preSessionNudge: 'pre_session_nudge',
} as const;
export type BuilderCoachToolName = (typeof BUILDER_COACH_TOOL)[keyof typeof BUILDER_COACH_TOOL];

/** A slot key or an exercise ID from the context (code resolves it; an unknown one is refused). */
const RefSchema = z.string().min(1).max(80);
const coachText = (max: number) => z.string().max(max);

/**
 * One edit to today's workout, by slot key (from the context). The model
 * names WHAT; code decides the numbers it doesn't name (loads from the
 * reps/RPE formula, rest, warm-ups) and checks the ones it does.
 */
export const BuilderEditOpSchema = z.discriminatedUnion('op', [
  /** Swap an exercise for another one this gym has; position, superset and set count stay. */
  z.strictObject({ op: z.literal('swap'), slotKey: RefSchema, toExerciseId: RefSchema }),
  /** Add an exercise after a slot (null: at the end, before abs). */
  z.strictObject({ op: z.literal('add'), exerciseId: RefSchema, afterSlotKey: RefSchema.nullable(), workingSets: z.int().min(0).max(30).nullable() }),
  z.strictObject({ op: z.literal('remove'), slotKey: RefSchema }),
  /** Working sets (warm-ups follow the exercise). */
  z.strictObject({ op: z.literal('sets'), slotKey: RefSchema, workingSets: z.int().min(0).max(30) }),
  /** Reps for the working sets. */
  z.strictObject({ op: z.literal('reps'), slotKey: RefSchema, reps: z.int().min(0).max(200) }),
  /** Target RPE for the working sets. */
  z.strictObject({ op: z.literal('rpe'), slotKey: RefSchema, rpe: z.number().min(0).max(20) }),
  /**
   * The working load: a step `heavier` / `lighter`, or a `value` in `unit`.
   * Code checks it (`checkProposedLoad` ceilings, pain hold) and rounds down
   * to what this gym can load.
   */
  z.strictObject({ op: z.literal('load'), slotKey: RefSchema, direction: z.enum(['heavier', 'lighter']).nullable(), value: z.number().min(0).max(2000).nullable(), unit: WeightUnitSchema.nullable() }),
  /** Move a slot (its whole superset) before another; null: to the end. */
  z.strictObject({ op: z.literal('move'), slotKey: RefSchema, beforeSlotKey: RefSchema.nullable() }),
  /** Superset two slots (the second moves next to the first). Never the main lift. */
  z.strictObject({ op: z.literal('superset'), slotKey: RefSchema, withSlotKey: RefSchema }),
  z.strictObject({ op: z.literal('unlink'), slotKey: RefSchema }),
  /** The length; code fits the workout to it (§3.6) and works out the minutes. */
  z.strictObject({ op: z.literal('minutes'), minutes: z.int().min(0).max(600) }),
]);
export type BuilderEditOp = z.infer<typeof BuilderEditOpSchema>;
export type BuilderEditOpKind = BuilderEditOp['op'];

/** Most edits in one proposal or suggestion. */
export const BUILDER_COACH_LIMITS = {
  maxOps: 8,
  maxSuggestionOps: 4,
  maxSuggestions: 4,
  maxNotes: 4,
  replyMax: 600,
  verdictMax: 120,
  reasonMax: 200,
  noteMax: 120,
  nudgeLineMax: 160,
} as const;
const L = BUILDER_COACH_LIMITS;

/**
 * `fill_setup` (Set up, §2.6): applied at once with an Undo toast. Code
 * checks the day exists, minutes from Ben's own words win
 * (`buildMinutesFor`), the main lift is one of the day's options, counts
 * 1–4 (0 removes the group).
 */
export const FillSetupArgsSchema = z.strictObject({
  /** One of the context's day IDs. */
  dayId: RefSchema.nullable(),
  minutes: z.int().min(0).max(600).nullable(),
  /** One of the day's main-lift options (catalogue or exercise ID), or `none`. */
  mainLiftCatalogueId: RefSchema.nullable(),
  supersets: z.boolean().nullable(),
  groups: z
    .array(z.strictObject({ group: z.enum(BUILDER_GROUPS), delta: z.int().min(-10).max(10).nullable(), count: z.int().min(0).max(10).nullable() }))
    .max(BUILDER_GROUPS.length)
    .nullable(),
  /** A short answer when Ben asked a question instead (shown after the number check). */
  reply: coachText(L.replyMax).nullable(),
});
export type FillSetupArgs = z.infer<typeof FillSetupArgsSchema>;

/**
 * `propose_workout_edit` (Your workout, §2.6): a proposal with code-made
 * before/after lines, Apply / Skip. `reply`: the coach's words (the reason,
 * or an answer when `ops` is empty), shown after the number check.
 */
export const ProposeWorkoutEditArgsSchema = z.strictObject({
  ops: z.array(BuilderEditOpSchema).max(L.maxOps),
  reply: coachText(L.replyMax),
});
export type ProposeWorkoutEditArgs = z.infer<typeof ProposeWorkoutEditArgsSchema>;

/** A `For next <day> day` note: words (`Include abs`) or a next-session target for one lift. */
export const ReviewNoteArgsSchema = z.strictObject({
  text: coachText(L.noteMax).nullable(),
  target: z.strictObject({ exerciseId: RefSchema, value: z.number().min(0).max(2000), unit: WeightUnitSchema, reps: z.int().min(0).max(100).nullable() }).nullable(),
});
export type ReviewNoteArgs = z.infer<typeof ReviewNoteArgsSchema>;

/**
 * `review_workout` (Coach review, §2.9): the coach writes the verdict,
 * suggestions and notes; code supplies every fact and checks the numbers in
 * the text (a sentence with a number not in the facts is hidden).
 */
export const ReviewWorkoutArgsSchema = z.strictObject({
  verdict: coachText(L.verdictMax),
  suggestions: z.array(z.strictObject({ ops: z.array(BuilderEditOpSchema).min(1).max(L.maxSuggestionOps), reason: coachText(L.reasonMax) })).max(L.maxSuggestions),
  nextNotes: z.array(ReviewNoteArgsSchema).max(L.maxNotes),
});
export type ReviewWorkoutArgs = z.infer<typeof ReviewWorkoutArgsSchema>;

/** `mix_pick` (`↻ Mix it up`, §2.0.2): one exercise from the code's shortlist, with a one-line reason. */
export const MixPickArgsSchema = z.strictObject({
  exerciseId: RefSchema,
  reason: coachText(L.reasonMax),
});
export type MixPickArgs = z.infer<typeof MixPickArgsSchema>;

/**
 * `pre_session_nudge` (§6.1): asked only when code found a clear signal.
 * The coach judges whether to say anything (`speak`) and writes one line;
 * the offer that goes with it is code's, applied only on Ben's Apply (rule 3).
 */
export const PreSessionNudgeArgsSchema = z.strictObject({
  speak: z.boolean(),
  line: coachText(L.nudgeLineMax).nullable(),
});
export type PreSessionNudgeArgs = z.infer<typeof PreSessionNudgeArgsSchema>;

export const BUILDER_COACH_TOOL_ARGS = {
  fill_setup: FillSetupArgsSchema,
  propose_workout_edit: ProposeWorkoutEditArgsSchema,
  review_workout: ReviewWorkoutArgsSchema,
  mix_pick: MixPickArgsSchema,
  pre_session_nudge: PreSessionNudgeArgsSchema,
} as const satisfies Record<BuilderCoachToolName, z.ZodType>;

export type BuilderCoachToolArgs = { [K in BuilderCoachToolName]: z.infer<(typeof BUILDER_COACH_TOOL_ARGS)[K]> };
