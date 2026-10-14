import { z } from 'zod';
import { OperationIdSchema, RecordMetaSchema, UtcTimestampSchema, WeightUnitSchema } from './common';
import type { MuscleGroup } from './muscle-groups';

/**
 * Ben's training details and split (Ben 13 Oct: D5, D7, D8; backlog F19).
 * Your data (rule 10), one document per owner in `training_profiles`
 * (migration 16). Every field is optional: absent means `Not set`, and the
 * coach is told so rather than given a guess (rule 6).
 */

export const GenderSchema = z.enum(['male', 'female']);
export type Gender = z.infer<typeof GenderSchema>;

export const LiftingExperienceSchema = z.enum(['beginner', 'intermediate', 'experienced', 'pro']);
export type LiftingExperience = z.infer<typeof LiftingExperienceSchema>;

export const TrainingGoalSchema = z.enum(['strength', 'muscle', 'both']);
export type TrainingGoal = z.infer<typeof TrainingGoalSchema>;

/** Body parts a split day can list: the muscle groups without forearms (Ben, 12 Oct). */
export const SplitBodyPartSchema = z.enum(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core']);
export type SplitBodyPart = z.infer<typeof SplitBodyPartSchema> & MuscleGroup;
export const SPLIT_BODY_PARTS: readonly SplitBodyPart[] = SplitBodyPartSchema.options;

export const SplitKindSchema = z.enum(['ppl', 'clsb', 'custom']);
export type SplitKind = z.infer<typeof SplitKindSchema>;

export const TRAINING_LIMITS = {
  birthYearMin: 1920,
  heightCmMin: 100,
  heightCmMax: 250,
  weightKgMin: 25,
  weightKgMax: 300,
  checkInWeeksMin: 4,
  checkInWeeksMax: 12,
  checkInWeeksDefault: 6,
  daysMin: 1,
  daysMax: 7,
  sessionMinMin: 15,
  sessionMinMax: 180,
  sessionMinDefault: 45,
  splitDaysMax: 7,
  dayNameMax: 30,
  weightsMax: 1000,
  recentOpsMax: 50,
} as const;

export const SplitDaySchema = z.object({
  /** `push`, `chest` … for a preset day; a generated ID for a custom one. */
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(TRAINING_LIMITS.dayNameMax),
  bodyParts: z.array(SplitBodyPartSchema).min(1).max(SPLIT_BODY_PARTS.length),
  /** Ben's main lift for this day (an exercise ID). Absent: recommended from history. */
  mainLiftExerciseId: z.string().min(1).max(64).optional(),
});
export type SplitDay = z.infer<typeof SplitDaySchema>;

export const TrainingSplitSchema = z.object({
  kind: SplitKindSchema,
  days: z.array(SplitDaySchema).min(1).max(TRAINING_LIMITS.splitDaysMax),
});
export type TrainingSplit = z.infer<typeof TrainingSplitSchema>;

/** One dated bodyweight entry, in the unit Ben typed (kg/lb always explicit). */
export const WeightEntrySchema = z.object({
  id: z.string().min(1).max(128),
  /** Local calendar date, `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().positive().max(700),
  unit: WeightUnitSchema,
  recordedAtUtc: UtcTimestampSchema,
});
export type WeightEntry = z.infer<typeof WeightEntrySchema>;

export const TrainingProfileSchema = RecordMetaSchema.extend({
  about: z.object({
    birthYear: z.int().min(TRAINING_LIMITS.birthYearMin).max(2100).optional(),
    gender: GenderSchema.optional(),
    heightCm: z.number().min(TRAINING_LIMITS.heightCmMin).max(TRAINING_LIMITS.heightCmMax).optional(),
    experience: LiftingExperienceSchema.optional(),
  }),
  weights: z.array(WeightEntrySchema).max(TRAINING_LIMITS.weightsMax),
  goal: TrainingGoalSchema.optional(),
  /** When the goal was last set or confirmed (the check-in counts from here). */
  goalSetAtUtc: UtcTimestampSchema.optional(),
  checkInWeeks: z.int().min(TRAINING_LIMITS.checkInWeeksMin).max(TRAINING_LIMITS.checkInWeeksMax),
  daysPerWeek: z.int().min(TRAINING_LIMITS.daysMin).max(TRAINING_LIMITS.daysMax).optional(),
  sessionMinutes: z.int().min(TRAINING_LIMITS.sessionMinMin).max(TRAINING_LIMITS.sessionMinMax),
  /** Absent: no split chosen yet (the Build card offers the default Push/Pull/Legs). */
  split: TrainingSplitSchema.optional(),
  /** D5: next-time targets for Self-driven sessions. Default off. */
  selfNextTargets: z.boolean(),
  /** Operation IDs already applied, newest last (a repeat is a no-op; rule 5). */
  recentOps: z.array(OperationIdSchema).max(TRAINING_LIMITS.recentOpsMax),
});
export type TrainingProfile = z.infer<typeof TrainingProfileSchema>;

/** A change to the training profile. Each is one versioned write. */
export type TrainingChange =
  | { kind: 'birth_year'; year: number | null }
  | { kind: 'gender'; gender: Gender | null }
  | { kind: 'height'; cm: number | null }
  | { kind: 'experience'; level: LiftingExperience | null }
  | { kind: 'add_weight'; entry: Omit<WeightEntry, 'recordedAtUtc'> }
  | { kind: 'delete_weight'; entryId: string }
  | { kind: 'goal'; goal: TrainingGoal | null }
  | { kind: 'check_in_weeks'; weeks: number }
  | { kind: 'days_per_week'; days: number | null }
  | { kind: 'session_minutes'; minutes: number }
  | { kind: 'preset_split'; split: 'ppl' | 'clsb' }
  | { kind: 'custom_split'; days: readonly { id: string; name: string; bodyParts: readonly SplitBodyPart[] }[] }
  | { kind: 'main_lift'; dayId: string; exerciseId: string | null }
  | { kind: 'self_next_targets'; on: boolean };
