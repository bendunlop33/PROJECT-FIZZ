import { z } from 'zod';
import { RecordMetaSchema, TimeZoneSchema, WeightUnitSchema } from './common';
import { RestSettingSchema } from './routine';

/**
 * Minimal single-owner profile for logging. `id` doubles as the stable owner ID;
 * goals, availability and coaching style are added in later slices.
 */
export const UserProfileSchema = RecordMetaSchema.extend({
  timezone: TimeZoneSchema,
  preferredUnit: WeightUnitSchema,
  /** Resolution step 4: global default rest. */
  defaultRest: RestSettingSchema,
  /** Named presets offered in the editor (e.g. Warm-up 60, Standard 90, Heavy 180). */
  restPresets: z.array(RestSettingSchema.required({ presetName: true })).max(20),
  effortScale: z.enum(['rpe', 'rir', 'off']),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;
