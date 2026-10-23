import { z } from 'zod';
import { IdSchema, WeightUnitSchema } from './common';

/**
 * The plan builder's answers (plan-builder.md, D7 22–23 Oct): Gym goals, Your
 * week, Check your lifts and Any preferences, as Ben left them. Stored on the
 * plan version the builder made (`PlanDraftVersion.builder`), so the plan can
 * be rebuilt from them (`Goals ›`, `Week ›`, `Start again`). Your data,
 * owner-scoped (rule 10). The deterministic engine (`@fizz/domain`
 * `buildPlanFromAnswers`) reads only these and Ben's own records.
 */

export const PLAN_BUILDER_LIMITS = {
  maxPriorities: 2,
  maxSpecific: 4,
  minSessions: 2,
  maxSessions: 7,
  minMinutes: 15,
  maxMinutes: 180,
  maxOther: 12,
  maxLikes: 30,
} as const;

/** Plan length in weeks (Gym goals). The plan's length is its first block (Q-B1 proposal). */
export const PlanWeeksSchema = z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);
export type PlanWeeks = z.infer<typeof PlanWeeksSchema>;

/** How hard the plan pushes (Ben, 22 Oct: Maintain / Standard / Push). */
export const PlanEffortSchema = z.enum(['maintain', 'standard', 'push']);
export type PlanEffort = z.infer<typeof PlanEffortSchema>;

/** What the lifting builds (Ben, 22 Oct). */
export const PlanFocusSchema = z.enum(['strength', 'muscle', 'balanced', 'fitness']);
export type PlanFocus = z.infer<typeof PlanFocusSchema>;

/** Priority picking groups (D5): rear delts count as Back. */
export const PlanGroupSchema = z.enum(['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core']);
export type PlanGroup = z.infer<typeof PlanGroupSchema>;

/** Specific targets (Ben, 22 Oct; D5): a part that must get trained, about 6 sets a week over 2 days. */
export const PlanTargetSchema = z.enum(['Upper chest', 'Lats', 'Upper back', 'Traps', 'Rear delts', 'Side delts', 'Glutes', 'Adductors', 'Abductors', 'Forearms', 'Obliques']);
export type PlanTarget = z.infer<typeof PlanTargetSchema>;

/** Your week › Split. `ul` Upper/Lower, `ppl`, `body` Chest/Legs/Shoulders/Back, `full` Full body. */
export const PlanSplitSchema = z.enum(['ul', 'ppl', 'body', 'full']);
export type PlanSplit = z.infer<typeof PlanSplitSchema>;

/** A weekday, Monday = 0. */
export const PlanWeekdaySchema = z.int().min(0).max(6);

/** Other training (Your week chips, D7): a sport on its days; `star`: a ★ priority sport. */
export const PlanOtherTrainingSchema = z.object({
  sport: z.string().trim().min(1).max(40),
  days: z.array(PlanWeekdaySchema).max(7),
  star: z.boolean(),
  /** Running only: the long run's day (heavy legs stay off the day before, GA11). */
  longRunDay: PlanWeekdaySchema.nullable().optional(),
});
export type PlanOtherTraining = z.infer<typeof PlanOtherTrainingSchema>;

/**
 * Check your lifts, per main lift (catalogue key): `confirmed` = `Still right` on a stale lift (D6: full weight);
 * `entered` = one recent set Ben typed (Your data, "you entered"); `similar` = estimate from his n-th closest similar
 * lift (always est., a step lighter).
 */
export const PlanLiftCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('confirmed') }),
  z.object({ kind: z.literal('entered'), value: z.number().positive().max(2000), unit: WeightUnitSchema, reps: z.int().min(1).max(30) }),
  z.object({ kind: z.literal('similar'), source: z.int().min(0).max(5) }),
]);
export type PlanLiftCheck = z.infer<typeof PlanLiftCheckSchema>;

/** Any preferences: one question's answer. `0` / `1`: the listed option; `other`: a catalogue key from its own list; `either`: no preference. */
export const PlanPrefAnswerSchema = z.union([z.literal(0), z.literal(1), z.literal('either'), z.object({ other: z.string().min(1).max(80) })]);
export type PlanPrefAnswer = z.infer<typeof PlanPrefAnswerSchema>;

export const PlanBuilderAnswersSchema = z.object({
  weeks: PlanWeeksSchema,
  effort: PlanEffortSchema,
  focus: PlanFocusSchema,
  priorities: z.array(PlanGroupSchema).max(PLAN_BUILDER_LIMITS.maxPriorities),
  specific: z.array(PlanTargetSchema).max(PLAN_BUILDER_LIMITS.maxSpecific),
  sessions: z.int().min(PLAN_BUILDER_LIMITS.minSessions).max(PLAN_BUILDER_LIMITS.maxSessions),
  /** Null: the ✦ split for the sessions (follows the day count until Ben picks one). */
  split: PlanSplitSchema.nullable(),
  /** `any`: Any days (the default); `set`: the days in `days`. */
  schedule: z.enum(['any', 'set']),
  days: z.array(PlanWeekdaySchema).max(7),
  minutes: z.int().min(PLAN_BUILDER_LIMITS.minMinutes).max(PLAN_BUILDER_LIMITS.maxMinutes),
  supersets: z.boolean(),
  /** Ab sets a week; null: the plan's own number (10, 14 with Core or Fitness, 6 on Maintain). */
  abs: z.union([z.literal(0), z.literal(6), z.literal(10), z.literal(14), z.literal(18)]).nullable(),
  other: z.array(PlanOtherTrainingSchema).max(PLAN_BUILDER_LIMITS.maxOther),
  /** Main lifts checked on Check your lifts, by catalogue key. */
  lifts: z.record(z.string().min(1).max(80), PlanLiftCheckSchema),
  /** Extra lifts added on Check your lifts (`＋ Add a lift`), catalogue keys. */
  extraLifts: z.array(z.string().min(1).max(80)).max(8),
  /** Any preferences, by question ID. */
  prefs: z.record(z.string().min(1).max(20), PlanPrefAnswerSchema),
  /** Others I like (catalogue keys). */
  likes: z.array(z.string().min(1).max(80)).max(PLAN_BUILDER_LIMITS.maxLikes),
  /** Never (catalogue keys). */
  never: z.array(z.string().min(1).max(80)).max(PLAN_BUILDER_LIMITS.maxLikes),
});
export type PlanBuilderAnswers = z.infer<typeof PlanBuilderAnswersSchema>;

/** What a builder-made plan version keeps: the answers it was built from and the engine's version. */
export const PlanBuilderRecordSchema = z.object({
  engine: z.literal(1),
  answers: PlanBuilderAnswersSchema,
  /** The gym the loads were checked at (rule 4), when one is set up. */
  gymId: IdSchema.nullable(),
});
export type PlanBuilderRecord = z.infer<typeof PlanBuilderRecordSchema>;
