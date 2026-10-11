import { z } from 'zod';
import {
  DurationSecondsSchema,
  IdSchema,
  LoadSchema,
  MassSchema,
  OperationIdSchema,
  RecordMetaSchema,
  RepRangeSchema,
  RirSchema,
  RpeSchema,
  UtcTimestampSchema,
} from './common';

export const SetTypeSchema = z.enum(['warmup', 'working', 'top', 'backoff', 'drop']);
export type SetType = z.infer<typeof SetTypeSchema>;

/** A rest duration plus an optional preset name for the editor label. */
export const RestSettingSchema = z.object({
  seconds: DurationSecondsSchema,
  presetName: z.string().min(1).max(60).optional(),
});
export type RestSetting = z.infer<typeof RestSettingSchema>;

export const SetTemplateSchema = z
  .object({
    id: IdSchema,
    setType: SetTypeSchema,
    targetLoad: LoadSchema.nullable(),
    targetReps: RepRangeSchema.nullable(),
    targetDurationS: DurationSecondsSchema.nullable(),
    targetRpe: RpeSchema.nullable(),
    targetRir: RirSchema.nullable(),
    /** Resolution step 1: explicit per-set rest override. */
    restOverrideS: DurationSecondsSchema.nullable(),
  })
  .refine((t) => t.targetReps !== null || t.targetDurationS !== null, {
    message: 'A set template needs a rep target or a duration target',
  });
export type SetTemplate = z.infer<typeof SetTemplateSchema>;

export const RoutineExerciseSchema = z.object({
  id: IdSchema,
  exerciseId: IdSchema,
  /** Preferred equipment instance; null = any compatible / bodyweight. */
  equipmentId: IdSchema.nullable(),
  order: z.int().min(0),
  /** Members sharing a label form a superset; rest starts at the round boundary. */
  supersetGroup: z.string().min(1).max(8).nullable(),
  setTemplates: z.array(SetTemplateSchema).min(1).max(30),
  /** Resolution step 2: rest preset by set type for this routine exercise. */
  restBySetType: z.partialRecord(SetTypeSchema, RestSettingSchema),
  /**
   * Optional transition timer used when moving to a different exercise without
   * a full rest (superset member, or after this exercise's final set).
   */
  transitionRestS: DurationSecondsSchema.nullable(),
  progressionRuleId: IdSchema.nullable(),
  /**
   * A main lift (routines.md WL9): the time fit never skips it. Set when a
   * workout is created or saved; Ben toggles it in the editor. Absent (older
   * workouts): `defaultMain` decides at read time.
   */
  main: z.boolean().optional(),
});
export type RoutineExercise = z.infer<typeof RoutineExerciseSchema>;

export const RoutineSchema = RecordMetaSchema.extend({
  name: z.string().min(1).max(120),
  exercises: z.array(RoutineExerciseSchema).max(40),
  /**
   * The finished workout this routine was saved from (premium-feel §2.6).
   * Optional so routines and backups written before it still parse.
   */
  createdFromSessionId: IdSchema.nullable().optional(),
  /**
   * Tombstone (routines.md §4.8): a deleted routine is kept so Undo can
   * restore it and finished workouts keep their provenance. Absent = live.
   */
  deletedAtUtc: UtcTimestampSchema.nullable().optional(),
  /** The operation that wrote this version, so a retried save, rename or delete is a no-op. */
  lastOpId: OperationIdSchema.optional(),
  /**
   * Who made it (routines.md WL1, RT5): `ben` (made, saved or edited by Ben),
   * `coach` (the workout builder, until Ben edits it) or `imported`. Absent:
   * a routine from before the library (v1.0); its template loads were last
   * time's actuals, which next targets replace, so they read as `Auto`.
   */
  source: z.enum(['ben', 'coach', 'imported']).optional(),
  /** `Duplicate` (routines.md §4.4): the workout it was copied from. */
  createdFromRoutineId: IdSchema.nullable().optional(),
  /**
   * In Ben's rotation (D19, RT9). Absent = in it (every routine was, before
   * the library); a workout saved or made since joins only when Ben says so.
   */
  inRotation: z.boolean().optional(),
  /** Its place in the rotation: when it joined (absent = `createdAtUtc`). `Add to rotation` puts it at the end. */
  rotationAtUtc: UtcTimestampSchema.optional(),
});
export type Routine = z.infer<typeof RoutineSchema>;

const effortCriteria = {
  /** Progress only if every counted set's RPE is at or below this (if RPE was recorded). */
  maxRpeToProgress: RpeSchema.nullable(),
  /** Progress only if every counted set's RIR is at or above this (if RIR was recorded). */
  minRirToProgress: RirSchema.nullable(),
};

const ruleCommon = RecordMetaSchema.extend({
  name: z.string().min(1).max(120),
  /** Preferred increment. Rounded to the equipment's achievable loads. */
  loadIncrement: MassSchema,
  /** Optional starting load when there is no comparable history. */
  startingLoad: MassSchema.nullable(),
  /** Consecutive sessions below the rep floor before a load reduction. Minimum 2. */
  failuresBeforeReduce: z.int().min(2).max(6),
  /** Reduction applied after a repeated trend, as a percentage. */
  reducePercent: z.number().min(1).max(30),
  /** Refuse jumps larger than this (equipment gaps); progress reps instead. */
  maxLoadJump: MassSchema.nullable(),
});

export const DoubleProgressionRuleSchema = ruleCommon.extend({
  method: z.literal('double_progression'),
  repRange: RepRangeSchema,
  workingSets: z.int().min(1).max(10),
  ...effortCriteria,
  /** At the equipment ceiling, reps keep progressing up to this count. Must be >= the top of the rep range. */
  ceilingRepCap: z.int().min(1).max(100),
}).refine((r) => r.ceilingRepCap >= r.repRange.max, {
  message: 'ceilingRepCap must be at least the top of the rep range',
  path: ['ceilingRepCap'],
});
export type DoubleProgressionRule = z.infer<typeof DoubleProgressionRuleSchema>;

export const TopSetBackoffRuleSchema = ruleCommon.extend({
  method: z.literal('top_set_backoff'),
  topSet: z.object({ repRange: RepRangeSchema, ...effortCriteria }),
  backoff: z.object({
    sets: z.int().min(0).max(10),
    percentOfTop: z.number().min(50).max(100),
    repRange: RepRangeSchema,
  }),
  /** Must be >= the top of the top set's rep range. */
  ceilingRepCap: z.int().min(1).max(100),
}).refine((r) => r.ceilingRepCap >= r.topSet.repRange.max, {
  message: 'ceilingRepCap must be at least the top of the top-set rep range',
  path: ['ceilingRepCap'],
});
export type TopSetBackoffRule = z.infer<typeof TopSetBackoffRuleSchema>;

export const ProgressionRuleSchema = z.discriminatedUnion('method', [
  DoubleProgressionRuleSchema,
  TopSetBackoffRuleSchema,
]);
export type ProgressionRule = z.infer<typeof ProgressionRuleSchema>;
