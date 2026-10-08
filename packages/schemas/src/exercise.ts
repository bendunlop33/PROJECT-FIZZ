import { z } from 'zod';
import { DurationSecondsSchema, IdSchema, LoadConventionSchema, UtcTimestampSchema } from './common';

export const EquipmentKindSchema = z.enum([
  'barbell',
  'plate_loaded_machine',
  'dumbbells',
  'weight_stack',
  'assisted_stack',
  'bodyweight_station',
]);

/** `reps` sets log a count; `duration` sets log a work time (timed exercises). */
export const MeasurementSchema = z.enum(['reps', 'duration']);
export type Measurement = z.infer<typeof MeasurementSchema>;

export const ExerciseSchema = z.object({
  id: IdSchema,
  /** Null for catalogue entries; set for custom exercises. */
  ownerId: IdSchema.nullable(),
  source: z.enum(['catalogue', 'custom']),
  name: z.string().min(1).max(120),
  movementPattern: z.string().min(1).max(60),
  primaryMuscles: z.array(z.string().min(1).max(60)).max(20),
  measurement: MeasurementSchema,
  /** Unilateral exercises are logged per side; volume is not double-counted. */
  laterality: z.enum(['bilateral', 'unilateral']),
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
