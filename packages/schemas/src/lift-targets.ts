import { z } from 'zod';
import { UtcTimestampSchema, WeightUnitSchema } from './common';

/**
 * Lift targets (Ben approved 20 Oct: "Yeah let's do lift targets as something
 * that can be turned on or off"). Your data (rule 10): kept on the owner's
 * training profile document (`training_profiles`, no new table), so backups,
 * export, restore and Delete my data carry them with the rest of it.
 *
 * A target is a goal Ben set, never a prescription: it isn't snapped to
 * equipment. The only date shown is Progress v3's `about mid-Nov at this rate`, always labelled
 * an estimate, from real top sets only, after 4 rising weeks and within 6 months (Ben, 21 Oct). Whether
 * it's hit is worked out from logged sets each time (`liftTargetStatus`), so a
 * corrected or deleted set is reflected and nothing is stored twice.
 */

export const LIFT_TARGET_LIMITS = {
  /** Ben, 20 Oct: at most three, one per exercise. */
  max: 3,
  repsMax: 30,
  /** kg; anything above is a typo (lb converted first). */
  loadKgMax: 600,
} as const;

/** `one_rm`: "Bench 100 kg" (a single at that weight). `weight_reps`: "Bench 90 kg × 5". */
export const LiftTargetKindSchema = z.enum(['one_rm', 'weight_reps']);
export type LiftTargetKind = z.infer<typeof LiftTargetKindSchema>;

/**
 * Conventions a target can use: load-based ones where heavier is stronger.
 * Assisted and bodyweight exercises have no lift targets.
 */
export const LiftTargetConventionSchema = z.enum(['total', 'per_hand', 'stack', 'added']);
export type LiftTargetConvention = z.infer<typeof LiftTargetConventionSchema>;

const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What Ben had when he set it: the est. 1RM (`one_rm`) or his best set at the target's reps or more (`weight_reps`). */
export const LiftTargetWasSchema = z.object({
  /** Same unit and convention as the target. */
  value: z.number().positive(),
  /** `weight_reps` only: the reps of that best set. */
  reps: z.int().min(1).max(100).optional(),
  /** Local date of the set it came from. */
  date: LocalDateSchema,
  /** True for an est. 1RM (always labelled `est.`). */
  isEstimate: z.boolean(),
});
export type LiftTargetWas = z.infer<typeof LiftTargetWasSchema>;

export const LiftTargetSchema = z.object({
  id: z.string().min(1).max(128),
  exerciseId: z.string().min(1).max(64),
  /** The exercise's name when set (shown if the exercise can't be read). */
  exerciseName: z.string().min(1).max(120),
  kind: LiftTargetKindSchema,
  /** kg/lb and the convention are explicit (per hand for dumbbells, the stack for a machine). */
  load: z.object({
    value: z.number().positive(),
    unit: WeightUnitSchema,
    convention: LiftTargetConventionSchema,
    /** `added` on a plate-loaded machine (`100 kg plates`), not a dip belt (`BW + 20 kg`). */
    plateLoaded: z.boolean().optional(),
  }),
  /** 1 for `one_rm`. */
  reps: z.int().min(1).max(LIFT_TARGET_LIMITS.repsMax),
  /** Optional deadline, a local date. */
  byDate: LocalDateSchema.optional(),
  setAtUtc: UtcTimestampSchema,
  /** Local date it was set (`was … on` and the hit window start). */
  setOnDate: LocalDateSchema,
  /** Null: nothing logged for it yet when it was set. */
  was: LiftTargetWasSchema.nullable(),
  setBy: z.enum(['ben', 'coach']),
});
export type LiftTarget = z.infer<typeof LiftTargetSchema>;
