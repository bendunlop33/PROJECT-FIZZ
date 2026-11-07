import { z } from 'zod';

/** Stable record ID. Generated on device before the local write (brief §6). */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/**
 * Operation ID used for idempotent writes. Free-form so that callers can use a
 * UUID, a voice turn ID, or the deterministic per-set draft ID from the domain.
 */
export const OperationIdSchema = z.string().min(1).max(128);
export type OperationId = z.infer<typeof OperationIdSchema>;

/** ISO-8601 instant in UTC, always with a trailing `Z`. */
export const UtcTimestampSchema = z.iso.datetime({ offset: false });
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

/**
 * Zones already checked (perf, 23 Oct): building an `Intl.DateTimeFormat` per timestamp was the single largest
 * cost of reading Ben's history (every set's zoned times are validated; ~18 s on ~800 workouts in Node, more on
 * Hermes). A zone's validity never changes while the app runs.
 */
const zoneChecks = new Map<string, boolean>();

function isValidTimeZone(tz: string): boolean {
  const known = zoneChecks.get(tz);
  if (known !== undefined) return known;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  if (zoneChecks.size < 1000) zoneChecks.set(tz, ok);
  return ok;
}

/** IANA time zone, e.g. `Pacific/Auckland`. */
export const TimeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, { message: 'Unknown IANA time zone' });
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/** A UTC instant together with the time zone it should be interpreted in. */
export const ZonedTimestampSchema = z.object({
  utc: UtcTimestampSchema,
  tz: TimeZoneSchema,
});
export type ZonedTimestamp = z.infer<typeof ZonedTimestampSchema>;

/** Every persisted record carries owner, version and audit timestamps (brief §6). */
export const RecordMetaSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  version: z.int().min(1),
  createdAtUtc: UtcTimestampSchema,
  updatedAtUtc: UtcTimestampSchema,
});
export type RecordMeta = z.infer<typeof RecordMetaSchema>;

export const WeightUnitSchema = z.enum(['kg', 'lb']);
export type WeightUnit = z.infer<typeof WeightUnitSchema>;

/**
 * How a load number is read. Always stored next to the number.
 * - `total`: whole implement, e.g. barbell including the bar.
 * - `per_hand`: one dumbbell/kettlebell; a pair is two of these.
 * - `stack`: the pin/selector reading on a machine. Not a free-weight equivalent.
 * - `added`: plates added to a plate-loaded machine. Not the true resistance.
 * - `assistance`: assisted machine; a larger number means an easier set.
 * - `bodyweight`: no external load recorded (value is always 0). Weighted
 *   dips or pull-ups record the added mass with `added` instead.
 */
export const LoadConventionSchema = z.enum([
  'total',
  'per_hand',
  'stack',
  'added',
  'assistance',
  'bodyweight',
]);
export type LoadConvention = z.infer<typeof LoadConventionSchema>;

/** A plain mass with an explicit unit (e.g. a plate, a rule increment). */
export const MassSchema = z.object({
  value: z.number().nonnegative(),
  unit: WeightUnitSchema,
});
export type Mass = z.infer<typeof MassSchema>;

/** A load as lifted: number, unit and convention are inseparable. */
export const LoadSchema = z
  .object({
    value: z.number().nonnegative(),
    unit: WeightUnitSchema,
    convention: LoadConventionSchema,
  })
  .refine((l) => l.convention !== 'bodyweight' || l.value === 0, {
    message: 'Bodyweight loads carry no external value',
    path: ['value'],
  });
export type Load = z.infer<typeof LoadSchema>;

/** RPE 1–10 in half steps. Kept separate from RIR; the two are never summed. */
export const RpeSchema = z
  .number()
  .min(1)
  .max(10)
  .refine((v) => Number.isInteger(v * 2), { message: 'RPE uses half steps' });
export type Rpe = z.infer<typeof RpeSchema>;

/** Reps in reserve, 0–10, as entered by the user. */
export const RirSchema = z.int().min(0).max(10);
export type Rir = z.infer<typeof RirSchema>;

export const RepRangeSchema = z
  .object({ min: z.int().min(0), max: z.int().min(0) })
  .refine((r) => r.min <= r.max, { message: 'min must be <= max', path: ['min'] });
export type RepRange = z.infer<typeof RepRangeSchema>;

/** Rest or work duration in whole seconds. */
export const DurationSecondsSchema = z.int().min(0).max(4 * 3600);

/** A distance in metres (sled push, carries, erg pieces): at most 100 km, to the centimetre. */
export const DistanceMetresSchema = z.number().min(0).max(100_000);

/** A note Ben wrote on an exercise or a set (Your data): trimmed text, 1–500 characters. */
export const NoteSchema = z.string().trim().min(1).max(500);
