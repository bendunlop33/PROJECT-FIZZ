import { z } from 'zod';
import { IdSchema, OperationIdSchema, RecordMetaSchema, UtcTimestampSchema } from './common';
import { BUILD_LIMITS } from './workout-draft';
import { MainLiftIdSchema, PLAN_DAY_LIMITS, RoutineExerciseSchema, SplitDayIdSchema } from './routine';

/**
 * Plan-day variations and session plan-day provenance (workout-builder v3
 * §4.2, §4.3; Ben, 20 Oct: Q10 = 5, Q17 = template + extras). Your data
 * (rule 10).
 *
 * A variation is keyed by (splitDayId, main lift) and **not by plan**, so a
 * new plan's template with the same key picks it up, and a plan's Undo or
 * End (which delete only the templates the plan made) never touch it.
 * Opening one = the current template + its extras, so a template change
 * reaches every variation.
 */

/**
 * One extra (§4.3). Anchors are exercise IDs; an op whose anchor is gone
 * from the template is skipped and reported, never guessed.
 */
export const VariationOpSchema = z.discriminatedUnion('kind', [
  /** Add a slot after an exercise (or at the end). The slot's set templates are the shape; loads come from the load sources when opened. */
  z.object({ kind: z.literal('add_slot'), after: z.union([IdSchema, z.literal('end')]), slot: RoutineExerciseSchema }),
  /** Pair two exercises as a superset. */
  z.object({ kind: z.literal('pair'), a: IdSchema, b: IdSchema }).refine((o) => o.a !== o.b, { message: 'A pair needs two exercises' }),
  z.object({ kind: z.literal('remove_slot'), exerciseId: IdSchema }),
  /** An exercise's working-set count (warm-ups follow the exercise). */
  z.object({ kind: z.literal('set_count'), exerciseId: IdSchema, n: z.int().min(BUILD_LIMITS.minWorkingSets).max(BUILD_LIMITS.maxWorkingSets) }),
]);
export type VariationOp = z.infer<typeof VariationOpSchema>;

export const VariationLabelSchema = z.string().trim().min(1).max(PLAN_DAY_LIMITS.labelMax);

/**
 * A saved variation: `Chest · bench · arms superset`. Every write bumps
 * `version` and records its op ID (rule 5); delete is a tombstone so Undo
 * puts the same variation back. The limit (5 live per key) and one live
 * label per key are checked in the write transaction.
 */
export const PlanDayVariationSchema = RecordMetaSchema.extend({
  splitDayId: SplitDayIdSchema,
  mainLiftExerciseId: MainLiftIdSchema.nullable(),
  label: VariationLabelSchema,
  extras: z.array(VariationOpSchema).max(PLAN_DAY_LIMITS.maxVariationOps),
  /** The template it was saved against (provenance, `Not applied` lines); absent when saved without one. */
  basedOn: z.object({ routineId: IdSchema, version: z.int().min(1) }).optional(),
  deletedAtUtc: UtcTimestampSchema.nullable(),
  opIds: z.array(OperationIdSchema).min(1).max(PLAN_DAY_LIMITS.maxOpIds),
});
export type PlanDayVariation = z.infer<typeof PlanDayVariationSchema>;

/** The (split day, main lift) a variation hangs off: `plan_day_variations.main_lift_key` uses `-` for none. */
export const NO_MAIN_LIFT_KEY = '-';
export function mainLiftKey(mainLiftExerciseId: string | null): string {
  return mainLiftExerciseId ?? NO_MAIN_LIFT_KEY;
}

/**
 * (§4.2) What plan day a session was started as, written at Start. Up next
 * credits (planId, splitDayId), so a `Today only` start (a draft with no
 * routine) still moves it on. `templateRoutineId` / `templateVersion` are
 * null together (a plan day built from Set up with no template yet).
 * The newest session's `variationId` is the day's last-used variation.
 */
export const SessionPlanDaySchema = z
  .object({
    planId: IdSchema,
    splitDayId: SplitDayIdSchema,
    mainLiftExerciseId: MainLiftIdSchema.nullable().optional(),
    templateRoutineId: IdSchema.nullable(),
    templateVersion: z.int().min(1).nullable(),
    variationId: IdSchema.nullable(),
    blockId: z.string().min(1).max(64).optional(),
    weekN: z.int().min(1).max(52).optional(),
  })
  .refine((p) => (p.templateRoutineId === null) === (p.templateVersion === null), { message: 'A template is named with its version', path: ['templateVersion'] });
export type SessionPlanDay = z.infer<typeof SessionPlanDaySchema>;
