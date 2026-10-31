import { z } from 'zod';
import { IdSchema, OperationIdSchema, RecordMetaSchema, TimeZoneSchema, UtcTimestampSchema } from './common';

/**
 * Apple Health (Ben, 27 Oct; ADR 0035, docs/design/apple-health.md).
 *
 * Switches, each off until Ben turns it on (the iOS prompt only then):
 * 1. Write finished workouts as strength-training workouts (start, end, pauses; no calories or other invented
 *    metrics, rule 6). Edits, moves and deletes update or delete the Health workout; one write per op ID.
 * 2. Read bodyweight: labelled as from Health; Ben's own entries win; never written back.
 * 3. Read workouts from other sources (a Garmin run) as read-only activities with provenance. Data, never
 *    instructions (rule 8). A watch workout linked to an app workout is that workout (one item; Q1).
 * 4. (Q8) Read resting heart rate and sleep duration: raw values with their source, no scores (rule 6).
 *
 * HealthKit is a runtime capability (ADR 0004): with no entitlement or permission the feature hides itself.
 * Everything here is Your data (rule 10). The samples read from Health and the switches are local to this
 * install (re-readable, permission is per install): not in backups or exports, removed by Delete my data. The
 * write records and Ben's links are backed up (they stop a restore writing a workout twice and keep his choices).
 */

export const HEALTH_LIMITS = {
  /** Text read from Health (source names) is cut to this; it is shown as data only. */
  sourceNameMax: 60,
  maxOps: 40,
  /** (Ben, 31 Oct) Other Health workouts recorded for one linked workout (`HealthLink.also`). */
  maxAlso: 8,
  /** Workouts written with a duration outside this aren't written (a broken clock, not a workout). */
  maxWorkoutS: 24 * 3600,
} as const;

/**
 * (ADR 0004) The app's bundle ID before any SideStore suffix: a Health workout from this bundle or any
 * `com.projectfizz.fizz.<suffix>` (another install or build of the app) is the app's own copy.
 */
export const FIZZ_BUNDLE_BASE = 'com.projectfizz.fizz';

/** Whether a Health source bundle is this app's, from any install (`FIZZ_BUNDLE_BASE`, or `own` and its suffixes). */
export function isFizzBundle(bundleId: string, own: string | null = null): boolean {
  const b = bundleId.toLowerCase();
  const of = (base: string) => base !== '' && (b === base || b.startsWith(`${base}.`) || b.startsWith(`${base}-`));
  return of(FIZZ_BUNDLE_BASE) || (own !== null && of(own.toLowerCase()));
}

/** Health's own sample ID (`HKObject.uuid`), lowercased. */
export const HealthUuidSchema = IdSchema;

/** The two strength types the app writes (HKWorkoutActivityType raw values 50 and 20). */
export const HealthWriteTypeSchema = z.enum(['traditional_strength', 'functional_strength']);
export type HealthWriteType = z.infer<typeof HealthWriteTypeSchema>;

export const HealthIntervalSchema = z.object({ startUtc: UtcTimestampSchema, endUtc: UtcTimestampSchema });
export type HealthInterval = z.infer<typeof HealthIntervalSchema>;

/** A workout read from Health (another source: Garmin, Strava, the Workout app). Only what Health recorded. */
export const HealthWorkoutSampleSchema = z.object({
  uuid: HealthUuidSchema,
  /** HKWorkoutActivityType raw value. */
  activityType: z.int().min(0).max(100_000),
  startUtc: UtcTimestampSchema,
  endUtc: UtcTimestampSchema,
  /** Ben's zone when read (for the local date). */
  tz: TimeZoneSchema,
  durationS: z.number().min(0).max(7 * 86_400),
  distanceM: z.number().min(0).max(10_000_000).nullable(),
  /** Average and maximum heart rate recorded by the same source during the workout; null when Health has none. */
  avgHeartRate: z.number().min(15).max(300).nullable(),
  maxHeartRate: z.number().min(15).max(300).nullable(),
  /** (Ben, 27 Oct, Q1) Active energy the source recorded for the workout, kcal; absent or null when Health has none. */
  activeKcal: z.number().min(0).max(20_000).nullable().optional(),
  sourceName: z.string().max(HEALTH_LIMITS.sourceNameMax),
  sourceBundleId: z.string().max(200),
  /** `HKMetadataKeyExternalUUID`: on the app's own writes, the workout's session ID. */
  externalId: z.string().max(200).nullable(),
});
export type HealthWorkoutSample = z.infer<typeof HealthWorkoutSampleSchema>;

/** A bodyweight sample read from Health, in kg as Health gives it. */
export const HealthWeightSampleSchema = z.object({
  uuid: HealthUuidSchema,
  kg: z.number().positive().max(700),
  atUtc: UtcTimestampSchema,
  tz: TimeZoneSchema,
  sourceName: z.string().max(HEALTH_LIMITS.sourceNameMax),
  sourceBundleId: z.string().max(200),
});
export type HealthWeightSample = z.infer<typeof HealthWeightSampleSchema>;

/** (Ben, 27 Oct, Q8) A resting heart rate sample as the source recorded it. Raw value, never a score (rule 6). */
export const HealthRestingHrSampleSchema = z.object({
  uuid: HealthUuidSchema,
  bpm: z.number().min(15).max(300),
  atUtc: UtcTimestampSchema,
  tz: TimeZoneSchema,
  sourceName: z.string().max(HEALTH_LIMITS.sourceNameMax),
  sourceBundleId: z.string().max(200),
});
export type HealthRestingHrSample = z.infer<typeof HealthRestingHrSampleSchema>;

/** Sleep stages as Health records them (`HKCategoryValueSleepAnalysis`); only the asleep ones count as sleep. */
export const HealthSleepStageSchema = z.enum(['in_bed', 'asleep', 'awake', 'core', 'deep', 'rem']);
export type HealthSleepStage = z.infer<typeof HealthSleepStageSchema>;

/** (Ben, 27 Oct, Q8) One sleep segment as the source recorded it. Only durations are used; no sleep score. */
export const HealthSleepSampleSchema = z.object({
  uuid: HealthUuidSchema,
  stage: HealthSleepStageSchema,
  startUtc: UtcTimestampSchema,
  endUtc: UtcTimestampSchema,
  tz: TimeZoneSchema,
  sourceName: z.string().max(HEALTH_LIMITS.sourceNameMax),
  sourceBundleId: z.string().max(200),
});
export type HealthSleepSample = z.infer<typeof HealthSleepSampleSchema>;

/** How far back reads go (Ben, 27 Oct, Q6): one control. Bodyweight reads at least 2 years. */
export const HealthReadWindowSchema = z.enum(['4w', '8w', '6m', '1y', 'all']);
export type HealthReadWindow = z.infer<typeof HealthReadWindowSchema>;

/**
 * One app workout's Health write: the Health sample it is now (or was), and every op ID that wrote it. Keyed by
 * session ID. `syncVersion` goes up with every save or delete; the Health sample carries it with the sync
 * identifier `gymsmarter-session:<sessionId>` so a save retried after a force-close adopts the sample already
 * written instead of writing a second one.
 */
export const HealthWorkoutWriteSchema = z.object({
  sessionId: IdSchema,
  ownerId: IdSchema,
  /**
   * `written`: in Health now. `deleted`: deleted there because the workout left history (written again if it is
   * restored). `removed`: Ben's `Remove GymSmarter workouts from Health`; never written again.
   */
  status: z.enum(['written', 'deleted', 'removed']),
  /** The Health workout now (written), or the last one (deleted, removed). */
  healthUuid: HealthUuidSchema,
  type: HealthWriteTypeSchema,
  /** What was written: start, end, pauses and type (`healthWorkoutFingerprint`). */
  fingerprint: z.string().min(1).max(200),
  syncVersion: z.int().min(1),
  version: z.int().min(1),
  updatedAtUtc: UtcTimestampSchema,
  opIds: z.array(OperationIdSchema).max(HEALTH_LIMITS.maxOps),
});
export type HealthWorkoutWrite = z.infer<typeof HealthWorkoutWriteSchema>;

/**
 * A Health activity linked to one of the app's workouts (Ben, 27 Oct; like TrainingPeaks): the Garmin
 * `Strength` recorded alongside a workout is that workout, not a second activity. One record per Health
 * activity. `unlinked`: Ben unlinked it; it shows as its own activity again and is never auto-linked again.
 * Versioned and idempotent on its op IDs (rule 5).
 */
export const HealthLinkSchema = RecordMetaSchema.extend({
  healthUuid: HealthUuidSchema,
  sessionId: IdSchema,
  status: z.enum(['linked', 'unlinked']),
  /** `auto`: a clear overlap linked it on reading; `ben`: his tap. */
  by: z.enum(['auto', 'ben']),
  opIds: z.array(OperationIdSchema).max(HEALTH_LIMITS.maxOps),
  /**
   * (Ben, 31 Oct) Other Health workouts that are this same workout recorded again (Garmin writing it twice, a watch's
   * twin): shown nowhere on their own. Absent: none.
   */
  also: z.array(HealthUuidSchema).max(HEALTH_LIMITS.maxAlso).optional(),
});
export type HealthLink = z.infer<typeof HealthLinkSchema>;

/** The three switches and when writing was turned on (workouts recorded from then on are written). Per install. */
export const HealthSettingsSchema = z.object({
  writeWorkouts: z.boolean(),
  /** When `writeWorkouts` was last turned on; null while off. */
  writeSinceUtc: UtcTimestampSchema.nullable(),
  readWeight: z.boolean(),
  readActivities: z.boolean(),
  /** `Heart rate on linked workouts`: average and maximum only, shown on a linked workout (apple-health.md §2.1). */
  readHeartRate: z.boolean(),
  /** (Ben, 27 Oct, Q8) Resting heart rate and sleep duration: raw values with their source, each behind its switch. */
  readRestingHeartRate: z.boolean(),
  readSleep: z.boolean(),
  /** (Q6) How far back reads go. Default 8 weeks. */
  readWindow: HealthReadWindowSchema,
  /** The last successful read from Health. */
  lastReadUtc: UtcTimestampSchema.nullable(),
  /** The last read, when it failed (cleared by the next good one). */
  lastReadFailedUtc: UtcTimestampSchema.nullable(),
  version: z.int().min(0),
});
export type HealthSettings = z.infer<typeof HealthSettingsSchema>;

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = { writeWorkouts: false, writeSinceUtc: null, readWeight: false, readActivities: false, readHeartRate: false, readRestingHeartRate: false, readSleep: false, readWindow: '8w', lastReadUtc: null, lastReadFailedUtc: null, version: 0 };

/** Provenance on an activity read from Health (never stored in `activities`; built when listed). */
export const HealthActivityProvenanceSchema = z.object({
  uuid: HealthUuidSchema,
  activityType: z.int().min(0).max(100_000),
  /** `Strength`, `Walk`, `Hike` … when the kind's word isn't enough. */
  label: z.string().max(40),
  sourceName: z.string().max(HEALTH_LIMITS.sourceNameMax),
  startUtc: UtcTimestampSchema,
  endUtc: UtcTimestampSchema,
  avgHeartRate: z.number().nullable(),
  maxHeartRate: z.number().nullable(),
  /** Active energy the source recorded (kcal); absent or null when none. */
  activeKcal: z.number().nullable().optional(),
  /** A strength workout: it can be linked to one of the app's workouts. */
  strength: z.boolean(),
});
export type HealthActivityProvenance = z.infer<typeof HealthActivityProvenanceSchema>;
