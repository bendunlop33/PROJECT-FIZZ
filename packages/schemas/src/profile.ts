import { z } from 'zod';
import { RecordMetaSchema, TimeZoneSchema, UtcTimestampSchema, WeightUnitSchema } from './common';
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
  /**
   * First-run progress (onboarding.md §3.1), so a force-close resumes at the
   * first unfinished step. Absent on profiles written before it existed; a
   * restored profile without it resumes setup where that backup left it.
   */
  setup: z
    .object({
      /** Step 2: a gym was saved, or Ben chose "Skip for now". */
      gymStep: z.enum(['saved', 'skipped']).optional(),
      /** `Go to Today` on Ready. */
      completedAtUtc: UtcTimestampSchema.optional(),
    })
    .optional(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;
