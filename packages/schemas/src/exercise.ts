import { z } from 'zod';
import { DurationSecondsSchema, IdSchema, LoadConventionSchema, UtcTimestampSchema } from './common';

/**
 * Equipment kinds an exercise can be done with. The first six are the kinds a
 * gym profile can hold an instance of (`EquipmentInstance['kind']`). The rest
 * (ADR 0010) tag catalogue exercises only: no gym-profile instance schema
 * exists for them yet, so loads for them are logged without equipment
 * feasibility (no snapping, no max) until an equipment slice adds one.
 *
 * `ez_bar` and `trap_bar` are their own kinds (re-review nit, 2026-10-09):
 * each has a bar weight of its own, so an EZ-bar or trap-bar exercise must
 * never be planned on the gym's Olympic `barbell` (rule 4). Until a gym can
 * hold an EZ or trap bar, those exercises log without load checks.
 */
export const EquipmentKindSchema = z.enum([
  'barbell',
  'plate_loaded_machine',
  'dumbbells',
  'weight_stack',
  'assisted_stack',
  'bodyweight_station',
  'kettlebell',
  'sled',
  'erg',
  'medicine_ball',
  'sandbag',
  'band',
  'ez_bar',
  'trap_bar',
]);
export type ExerciseEquipmentKind = z.infer<typeof EquipmentKindSchema>;

/** `reps` sets log a count; `duration` sets log a work time (timed exercises). */
export const MeasurementSchema = z.enum(['reps', 'duration']);
export type Measurement = z.infer<typeof MeasurementSchema>;

/**
 * Measurement as described by the exercise catalogue. Adds `distance` (sled
 * 50 m, farmer's carry, ski/row 1000 m). It is deliberately separate from
 * `MeasurementSchema`: sets can't record a distance yet (no `SetValues`
 * field, reducer check or progression rule), so a distance exercise is not
 * loggable and the catalogue loader doesn't turn it into an `Exercise` row
 * (ADR 0010). Merge the two once distance logging is built.
 */
export const CatalogueMeasurementSchema = z.enum(['reps', 'duration', 'distance']);
export type CatalogueMeasurement = z.infer<typeof CatalogueMeasurementSchema>;

export const LateralitySchema = z.enum(['bilateral', 'unilateral']);
export type Laterality = z.infer<typeof LateralitySchema>;

/**
 * How many dumbbells or kettlebells a `per_hand` exercise is done with
 * (catalogue `implements`; FitNotes import review r3 S1). `1`: one-arm rows,
 * goblet squats, pullovers; a value written for one is that implement's
 * weight. `2`: presses, curls, split squats with one in each hand. Laterality
 * can't tell these apart (a one-arm row and a split squat are both
 * unilateral), so it is recorded on its own, and left out where an exercise
 * is commonly done either way.
 */
export const ImplementCountSchema = z.union([z.literal(1), z.literal(2)]);
export type ImplementCount = z.infer<typeof ImplementCountSchema>;

export const MechanicSchema = z.enum(['compound', 'isolation']);
export type Mechanic = z.infer<typeof MechanicSchema>;

/** Stable kebab-case catalogue key (`barbell-back-squat`). Never reused or renamed. */
export const CatalogueKeySchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'Catalogue keys are lower-case kebab-case' });
export type CatalogueKey = z.infer<typeof CatalogueKeySchema>;

export const ExerciseSchema = z.object({
  id: IdSchema,
  /** Null for catalogue entries; set for custom exercises. */
  ownerId: IdSchema.nullable(),
  source: z.enum(['catalogue', 'custom']),
  name: z.string().min(1).max(120),
  movementPattern: z.string().min(1).max(60),
  primaryMuscles: z.array(z.string().min(1).max(60)).max(20),
  /** Optional (ADR 0010). Same vocabulary as `primaryMuscles`. */
  secondaryMuscles: z.array(z.string().min(1).max(60)).max(20).optional(),
  /**
   * Catalogue key this row was loaded from; `id` is UUIDv5(key). Null or
   * absent for custom exercises (ADR 0010).
   */
  catalogueKey: CatalogueKeySchema.nullable().optional(),
  /** Variant group for substitutions and guide templates, e.g. `squat`, `row`. */
  family: z.string().min(1).max(60).optional(),
  mechanic: MechanicSchema.optional(),
  measurement: MeasurementSchema,
  /** Unilateral exercises are logged per side; volume is not double-counted. */
  laterality: LateralitySchema,
  compatibleEquipment: z.array(EquipmentKindSchema).max(6),
  /** Convention used when no equipment instance is attached. */
  defaultLoadConvention: LoadConventionSchema,
  /** Exercise default rest (resolution step 3). */
  defaultRestS: DurationSecondsSchema.optional(),
  version: z.int().min(1),
  createdAtUtc: UtcTimestampSchema,
  updatedAtUtc: UtcTimestampSchema,
});
export type Exercise = z.infer<typeof ExerciseSchema>;
