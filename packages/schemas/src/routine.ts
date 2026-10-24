import { z } from 'zod';
import {
  DistanceMetresSchema,
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
    /** Cardio (19 Oct): the distance to aim for, in metres, next to the time; absent on every other set. */
    targetDistanceM: DistanceMetresSchema.nullable().optional(),
    targetRpe: RpeSchema.nullable(),
    targetRir: RirSchema.nullable(),
    /** Resolution step 1: explicit per-set rest override. */
    restOverrideS: DurationSecondsSchema.nullable(),
  })
  .refine((t) => t.targetReps !== null || t.targetDurationS !== null || (t.targetDistanceM !== null && t.targetDistanceM !== undefined), {
    message: 'A set template needs a rep target, a duration target or a distance target',
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
  /**
   * A bodyweight exercise done with weight held or worn (Ben, 18 Oct): its
   * sets log the added mass (`added`). Absent or false: bodyweight.
   */
  addedWeight: z.boolean().optional(),
  /**
   * When Ben last changed this slot's structure in the editor (its exercise,
   * set types, count, reps, work time or Fixed loads; routines.md WL7). A
   * rename or a rotation toggle doesn't count. A coach next-session target
   * set before it supplies loads only (Ben's later edit wins). Absent: not
   * changed since the workout was made.
   */
  structureChangedAtUtc: UtcTimestampSchema.optional(),
});
export type RoutineExercise = z.infer<typeof RoutineExerciseSchema>;

/**
 * (19 Oct, plans) A saved workout made by a coach plan's Apply: which plan, day and version. Up next
 * and the plan tracker read it; Undo of the Apply removes the workout. Absent on every other workout.
 */
export const RoutinePlanLinkSchema = z.object({
  planId: IdSchema,
  dayIndex: z.int().min(0).max(6),
  versionN: z.int().min(1),
  splitDayId: z.string().min(1).max(64).nullable(),
  /** When Apply made it: a slot not changed since takes the plan's checked loads on its first workout. */
  atUtc: UtcTimestampSchema,
});
export type RoutinePlanLink = z.infer<typeof RoutinePlanLinkSchema>;

/** Plan-day limits (workout-builder v3 §4.2, §4.3; Ben, 20 Oct, Q10). */
export const PLAN_DAY_LIMITS = {
  minMinutes: 15,
  maxMinutes: 180,
  /** Live saved variations per (split day, main lift) (Q10). */
  maxVariations: 5,
  labelMax: 40,
  /** Extras one variation holds (added slots, pairs, removals, set counts). */
  maxVariationOps: 20,
  /** Operation IDs a variation remembers for idempotency. */
  maxOpIds: 50,
} as const;

/** A split day ID as the Profile split stores it (`chest`, `push`, or a generated ID). */
export const SplitDayIdSchema = z.string().min(1).max(64);
/** A main lift as the Profile stores it (`SplitDay.mainLiftExerciseId`): an exercise ID. */
export const MainLiftIdSchema = z.string().min(1).max(64);

/** A plan day's index in its plan (0-based, as `RoutinePlanLink.dayIndex` and `PlanApplied.made[].dayIndex`). */
export const PlanDayIndexSchema = z.int().min(0).max(6);

/**
 * (Workout builder v3 §4.2) A plan-day template: which plan day (plan and
 * day index), its split day, and main lift it is, with its own length.
 * One live template per (planId, dayIndex, main lift), enforced inside the
 * write transaction (`routines_plan_day`, migration 30). A plan day is its
 * **index**, not its split day: a plan can use a split day twice
 * (Push/Pull/Legs/Push), and each is its own day (review b3-data B1).
 * `splitDayId` is the variation key (§4.3: variations are shared by split
 * day and main lift, across plans and repeated days). `blockId` / `weekN`
 * are room for training blocks (§6), unused until then.
 */
export const RoutinePlanDaySchema = z.object({
  planId: IdSchema,
  dayIndex: PlanDayIndexSchema,
  splitDayId: SplitDayIdSchema,
  mainLiftExerciseId: MainLiftIdSchema.nullable(),
  minutes: z.int().min(PLAN_DAY_LIMITS.minMinutes).max(PLAN_DAY_LIMITS.maxMinutes),
  blockId: z.string().min(1).max(64).optional(),
  weekN: z.int().min(1).max(52).optional(),
});
export type RoutinePlanDay = z.infer<typeof RoutinePlanDaySchema>;

/** The text key of a template (planId, dayIndex, main lift), as the unique index `routines_plan_day` holds it. */
export function planDayTemplateKey(p: Pick<RoutinePlanDay, 'planId' | 'dayIndex' | 'mainLiftExerciseId'>): string {
  return `${p.planId}|${String(p.dayIndex)}|${p.mainLiftExerciseId ?? '-'}`;
}

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
  /** (12 Oct, workout-builder BD12) The coach draft it was saved from: `Based on a coach workout ›`. */
  createdFromDraft: z.object({ draftId: IdSchema, version: z.int().min(1) }).optional(),
  /** (19 Oct) The coach plan whose Apply made it. */
  createdFromPlan: RoutinePlanLinkSchema.optional(),
  /**
   * (Ben, 20 Oct) A merged day made for one week only by a week override's Apply (`WeekPlan`): out of
   * the rotation and the library; Up next starts it that week only. Absent on every other workout.
   */
  createdForWeek: z.object({ weekPlanId: IdSchema, weekMonday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
  /**
   * In Ben's rotation (D19, RT9). Absent = in it (every routine was, before
   * the library); a workout saved or made since joins only when Ben says so.
   */
  inRotation: z.boolean().optional(),
  /** Its place in the rotation: when it joined (absent = `createdAtUtc`). `Add to rotation` puts it at the end. */
  rotationAtUtc: UtcTimestampSchema.optional(),
  /**
   * (Workout builder v3 §4.2) A plan-day template: plan, split day, main lift and minutes. Absent on
   * every other workout, and on plan workouts made before it (their key is derived when read from
   * `createdFromPlan`, never written on read: `planDayKeyOf`).
   */
  planDay: RoutinePlanDaySchema.optional(),
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
  /**
   * Refuse jumps bigger than this percentage of the current load; progress
   * reps instead (playbook 7-F: "if that jump is > ~10%"). Resistance loads
   * only: an assisted machine's real load (bodyweight minus assistance) isn't
   * known, so its steps are never measured this way. Absent = no limit.
   */
  maxLoadJumpPercent: z.number().min(1).max(100).optional(),
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
