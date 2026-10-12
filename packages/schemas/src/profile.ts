import { z } from 'zod';
import { RecordMetaSchema, TimeZoneSchema, UtcTimestampSchema, WeightUnitSchema } from './common';
import { RestSettingSchema } from './routine';

/** Progress windows, in days, each ending today (progress.md PG24). */
export const ProgressWindowDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)]);
export type ProgressWindowDays = z.infer<typeof ProgressWindowDaysSchema>;

/** Progress's muscle grouping (PG26, PG27). */
export const ProgressGroupingSchema = z.enum(['body_part', 'ppl']);
export type ProgressGrouping = z.infer<typeof ProgressGroupingSchema>;

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
   * Ben's own rest default per exercise ID (`Rest after` → this exercise,
   * rest-state §2.4). Resolution step 3, before the catalogue's default.
   * Your data: the catalogue row is shared knowledge and never edited.
   */
  exerciseRestS: z.record(z.string().min(1).max(64), z.int().min(0).max(3600)).optional(),
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
  /**
   * Progress's last window and muscle grouping (progress.md PG24, §6.4), so
   * the tab opens as Ben left it. Absent = `30 days`, `Body parts`.
   */
  progress: z
    .object({
      window: ProgressWindowDaysSchema.optional(),
      grouping: ProgressGroupingSchema.optional(),
    })
    .optional(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;
