import { z } from 'zod';
import { OperationIdSchema, RecordMetaSchema, UtcTimestampSchema, WeightUnitSchema } from './common';
import type { MuscleGroup } from './muscle-groups';
import { LIFT_TARGET_LIMITS, LiftTargetSchema, type LiftTarget } from './lift-targets';
import { CheckInScheduleSchema, type CheckInSchedule } from './checkin';

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
  weightsMax: 20000,
  recentOpsMax: 50,
  /** Lifts shown on Progress › Reviews (Ben, 21 Oct: up to 6). */
  progressLiftsMax: 6,
  /** (Ben, 26 Oct) Pinned exercise notes: one per exercise and gym (or every gym), each at most `pinnedNoteMax` characters. */
  pinnedNotesMax: 300,
  pinnedNoteMax: 500,
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

/**
 * (Ben, 26 Oct) A pinned exercise note: Ben's own words (seat and pin settings) shown every time the exercise is in
 * a workout, at one gym (`gymId`) or at every gym (null). Your data (rule 10); shown as typed and never read as an
 * instruction by anything (rule 8); never in the coach's context.
 */
export const PinnedNoteSchema = z.object({
  exerciseId: z.string().min(1).max(64),
  gymId: z.string().min(1).max(64).nullable(),
  text: z.string().trim().min(1).max(TRAINING_LIMITS.pinnedNoteMax),
  updatedAtUtc: UtcTimestampSchema,
});
export type PinnedNote = z.infer<typeof PinnedNoteSchema>;

/**
 * (Ben, 27 Oct) Profile › Training › `Rest when short on time`: how far a time fit may shorten accessory rests.
 * `normal` Standard rest (never), `shorter` Medium rest, `shortest` Minimum rest (the default). The builder's rest
 * levels (`RestLevel`); the main lift's rests never change for time whichever is picked.
 */
export const FitRestLevelSchema = z.enum(['normal', 'shorter', 'shortest']);
export type FitRestLevel = z.infer<typeof FitRestLevelSchema>;

/**
 * (Ben, 28 Oct) Profile › Rest times: the default rests Ben can change, by key (as `BUILDER_REST_DEFAULTS` in the
 * domain): main lift working sets, top set, back-off, compound accessory, isolation, superset round, warm-up.
 */
export const REST_DEFAULT_KEYS = ['workingMain', 'top', 'backoff', 'workingCompound', 'workingIsolation', 'round', 'warmup'] as const;
export const RestDefaultKeySchema = z.enum(REST_DEFAULT_KEYS);
export type RestDefaultKey = z.infer<typeof RestDefaultKeySchema>;
/**
 * Rest times' limits: the builder's (`BUILD_LIMITS.minRestS` / `maxRestS`, 0:30–6:00, 15 s steps). Literal here, not
 * imported: `workout-draft` imports this module (a test checks they agree).
 */
export const REST_DEFAULT_LIMITS = { minS: 30, maxS: 360, stepS: 15 } as const;

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
  /**
   * The last custom split's days, kept while a preset is in use so picking
   * Custom again restores them (profile-settings review B2). Absent: none yet.
   */
  customDays: z.array(SplitDaySchema).min(1).max(TRAINING_LIMITS.splitDaysMax).optional(),
  /**
   * Ben's main lift per split day ID, kept across split changes so switching
   * back restores them (review B2). Absent on older rows: read from `split`.
   */
  mainLifts: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),
  /** D5: next-time targets for Self-driven sessions. Default off. */
  selfNextTargets: z.boolean(),
  /** (Ben, 20 Oct) The Lift targets setting. Absent: off (every lift-target view hidden, the coach doesn't see them). */
  liftTargetsOn: z.boolean().optional(),
  /** (Ben, 20 Oct) At most 3, one per exercise. Absent: none. Kept while the setting is off. */
  liftTargets: z.array(LiftTargetSchema).max(LIFT_TARGET_LIMITS.max).optional(),
  /**
   * (Ben, 21 Oct; workout-builder-v3 §6.2 Goal) The lifts Progress › Reviews draws trend lines for: any
   * exercises he logs, at most 6, in his order. Absent: the plan's main lifts. Your data (rule 10).
   */
  progressLifts: z.array(z.string().min(1).max(64)).max(TRAINING_LIMITS.progressLiftsMax).optional(),
  /**
   * (Progress v3, Ben 21 Oct) The reps Ben picked for a lift he added that isn't in the plan, by exercise ID
   * (1–30). Lifts with a target or in the plan are tracked at those reps instead. Absent: none picked.
   */
  progressLiftReps: z.record(z.string().min(1).max(64), z.int().min(1).max(30)).optional(),
  /**
   * (Ben, 26 Oct) Profile › Training › Check-in: when Start asks `How are you feeling?`. Absent: `Only when I
   * choose` (the 23 Oct default). Your data (rule 10).
   */
  checkInSchedule: CheckInScheduleSchema.optional(),
  /** (Ben, 27 Oct) `Rest when short on time`. Absent: `shortest` (Minimum rest). Your data (rule 10). */
  fitRestLevel: FitRestLevelSchema.optional(),
  /**
   * (Ben, 28 Oct) Profile › Rest times: Ben's own default rests (seconds), only those he changed from the standard
   * ones. Absent: the standard defaults. Your data (rule 10).
   */
  restDefaultsS: z.partialRecord(RestDefaultKeySchema, z.int().min(REST_DEFAULT_LIMITS.minS).max(REST_DEFAULT_LIMITS.maxS)).optional(),
  /** (Ben, 26 Oct) Pinned exercise notes, one per exercise and gym (null gym: every gym). Absent: none. */
  pinnedNotes: z.array(PinnedNoteSchema).max(TRAINING_LIMITS.pinnedNotesMax).optional(),
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
  /** (Ben, 27 Oct) Correct one of his entries: value, unit and date (Undo is the same change back). */
  | { kind: 'edit_weight'; entryId: string; value: number; unit: WeightEntry['unit']; date: string }
  | { kind: 'goal'; goal: TrainingGoal | null }
  | { kind: 'check_in_weeks'; weeks: number }
  | { kind: 'days_per_week'; days: number | null }
  | { kind: 'session_minutes'; minutes: number }
  | { kind: 'preset_split'; split: 'ppl' | 'clsb' }
  | { kind: 'custom_split'; days: readonly { id: string; name: string; bodyParts: readonly SplitBodyPart[] }[] }
  | { kind: 'main_lift'; dayId: string; exerciseId: string | null }
  | { kind: 'self_next_targets'; on: boolean }
  /** (Ben, 20 Oct) The Lift targets setting. */
  | { kind: 'lift_targets_on'; on: boolean }
  /** A target for its exercise, replacing that exercise's one (max 3 exercises). */
  | { kind: 'set_lift_target'; target: LiftTarget }
  | { kind: 'remove_lift_target'; exerciseId: string }
  /** (Ben, 21 Oct) The lifts Progress › Reviews shows (up to 6, in order); an empty list goes back to the plan's main lifts. */
  /** `reps`: the reps to track a lift at that isn't in the plan (asked once when adding it; Progress v3). */
  | { kind: 'progress_lifts'; exerciseIds: readonly string[]; reps?: Readonly<Record<string, number>> }
  /** (Ben, 26 Oct) Profile › Training › Check-in. `days` needs at least one weekday. */
  | { kind: 'check_in_schedule'; schedule: CheckInSchedule }
  /** (Ben, 27 Oct) Profile › Training › `Rest when short on time`. */
  | { kind: 'fit_rest_level'; level: FitRestLevel }
  /** (Ben, 28 Oct) Profile › Rest times: one default rest (0:30–6:00, 15 s steps). */
  | { kind: 'rest_default'; key: RestDefaultKey; seconds: number }
  /** (Ben, 28 Oct) Profile › Rest times › `Reset to defaults`. */
  | { kind: 'reset_rest_defaults' }
  /** (Ben, 26 Oct) Pin a note on an exercise (at one gym, or every gym with `gymId` null), replacing that pin. */
  | { kind: 'pin_note'; exerciseId: string; gymId: string | null; text: string }
  /** (Ben, 26 Oct) Unpin it (the text is kept as today's note by the caller when Ben asks). */
  | { kind: 'unpin_note'; exerciseId: string; gymId: string | null };
