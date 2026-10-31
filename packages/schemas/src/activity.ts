import { z } from 'zod';
import { IdSchema, OperationIdSchema, RecordMetaSchema, TimeZoneSchema, UtcTimestampSchema } from './common';
import { LocalDateSchema } from './import';
import { HealthActivityProvenanceSchema } from './health';

/**
 * (Ben, 20 Oct: "Can we add ability to flex ordering and sessions etc
 * subject to week have eg if I did or have planned a long run maybe we swap
 * to a push rather than shoulder and chest separately") Activities outside
 * the gym: a run, ride, swim, sport or other, done or planned, logged by Ben
 * (Today › ＋ Activity) or by the coach when he asks. Your data, owner-scoped
 * (rule 10), in backups. Only what Ben said: a date, a rough duration and/or
 * distance, an effort word. No heart rate, pace zones or load scores (rule 6).
 * (Ben, 27 Oct) Workouts read from Apple Health (a Garmin run) are listed with
 * these as read-only activities (`source: 'health'`, `health` provenance). They
 * are built when listed, never stored here, and never edited (ADR 0035).
 */

export const ActivityKindSchema = z.enum(['run', 'ride', 'swim', 'sport', 'other']);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/** Ben's own effort word. `long`: a long session (for a run, also ≥ 90 min or ≥ 15 km). */
export const ActivityEffortSchema = z.enum(['easy', 'moderate', 'hard', 'long']);
export type ActivityEffort = z.infer<typeof ActivityEffortSchema>;

export const ActivityStatusSchema = z.enum(['done', 'planned']);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ACTIVITY_LIMITS = {
  /** 24 h. */
  maxDurationS: 24 * 3600,
  /** 1,000 km. */
  maxDistanceM: 1_000_000,
  maxOps: 50,
} as const;

/** What Ben said about one activity: what, when, how long or far, how hard. At least one of duration, distance or effort. */
export const ActivityFieldsShapeSchema = z.object({
    kind: ActivityKindSchema,
    status: ActivityStatusSchema,
    /** Local date in `tz`. */
    date: LocalDateSchema,
    durationS: z.int().min(60).max(ACTIVITY_LIMITS.maxDurationS).nullable(),
    distanceM: z.number().min(10).max(ACTIVITY_LIMITS.maxDistanceM).nullable(),
    effort: ActivityEffortSchema.nullable(),
  });
export const ActivityFieldsSchema = ActivityFieldsShapeSchema.refine((f) => f.durationS !== null || f.distanceM !== null || f.effort !== null, { message: 'An activity needs a duration, a distance or an effort' });
export type ActivityFields = z.infer<typeof ActivityFieldsSchema>;

/** The last write and what was there before it: its Undo puts exactly that back (rule 2, 5). */
export const ActivityLastChangeSchema = z.object({
  opId: OperationIdSchema,
  kind: z.enum(['add', 'edit', 'delete']),
  /** The version this write left: Undo only from it. */
  versionAfter: z.int().min(1),
  /** The fields before an edit; null for add and delete. */
  before: ActivityFieldsSchema.nullable(),
});
export type ActivityLastChange = z.infer<typeof ActivityLastChangeSchema>;

export const ActivitySchema = RecordMetaSchema.extend({
  fields: ActivityFieldsSchema,
  tz: TimeZoneSchema,
  /**
   * Who logged it: Ben's sheet, or the coach (when he asked, or his tap on its offer). `health`: read from Apple
   * Health (read-only, never stored in `activities`).
   */
  source: z.enum(['ben', 'coach', 'health']),
  /** Only with `source: 'health'`: where it came from. */
  health: HealthActivityProvenanceSchema.optional(),
  /** Tombstone: a deleted activity is kept so Undo can bring it back. Null: live. */
  deletedAtUtc: UtcTimestampSchema.nullable(),
  lastChange: ActivityLastChangeSchema.nullable(),
  opIds: z.array(OperationIdSchema).max(ACTIVITY_LIMITS.maxOps),
});
export type Activity = z.infer<typeof ActivitySchema>;

// ---------------------------------------------------------------------------
// This week's shape (a week override)

/**
 * What the week's change is made against: the plan in use (at the version
 * read), or Ben's split days when no plan is in use.
 */
export const WeekBasisSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('plan'), planId: IdSchema, planVersion: z.int().min(1) }), z.object({ kind: z.literal('split') })]);
export type WeekBasis = z.infer<typeof WeekBasisSchema>;

/** A plan day (its workout's ID) or a split day (its ID). */
const DayIdSchema = z.string().min(1).max(64);

export const WeekMergeSchema = z.object({
  /** The two days merged into one this week. */
  dayIds: z.tuple([DayIdSchema, DayIdSchema]),
  /** `Push`. */
  name: z.string().trim().min(1).max(30),
  /** The two days' names, for the before/after list. */
  fromNames: z.tuple([z.string().min(1).max(120), z.string().min(1).max(120)]),
});
export type WeekMerge = z.infer<typeof WeekMergeSchema>;

export const WeekSkipSchema = z.object({ dayId: DayIdSchema, name: z.string().min(1).max(120) });
export type WeekSkip = z.infer<typeof WeekSkipSchema>;

/** One row of the before/after list: `Push` with `Chest + Shoulders`, or `Legs` with `After Sat's run`. */
export const WeekRowSchema = z.object({ name: z.string().min(1).max(120), note: z.string().max(80).nullable() });
export type WeekRow = z.infer<typeof WeekRowSchema>;

/**
 * A week override (Ben, 20 Oct): this week only, the remaining days merged
 * or skipped so the week fits around a run. Applied by Ben's tap on the
 * coach's proposal (rule 3); expires at the end of `weekMonday`'s week (next
 * week is the plan as it was). `made`: the merged day's workout per merge,
 * kept out of the rotation and the library; Undo tombstones it. Versioned and
 * idempotent on its op IDs (rule 5). Your data.
 */
export const WeekPlanSchema = RecordMetaSchema.extend({
  status: z.enum(['applied', 'undone']),
  /** Local Monday the override's week starts on. */
  weekMonday: LocalDateSchema,
  tz: TimeZoneSchema,
  basis: WeekBasisSchema,
  merges: z.array(WeekMergeSchema).max(3),
  skips: z.array(WeekSkipSchema).max(3),
  before: z.array(WeekRowSchema).max(7),
  after: z.array(WeekRowSchema).max(7),
  /** The workout made for each merge (same order as `merges`). */
  made: z.array(z.object({ routineId: IdSchema, version: z.int().min(1) })).max(3),
  /** The coach's proposal it applied. */
  proposalActionId: IdSchema,
  appliedOpId: OperationIdSchema,
  undoneAtUtc: UtcTimestampSchema.nullable(),
  opIds: z.array(OperationIdSchema).max(20),
});
export type WeekPlan = z.infer<typeof WeekPlanSchema>;
