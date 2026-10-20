import { z } from 'zod';
import { IdSchema, LoadSchema, MassSchema, OperationIdSchema, RecordMetaSchema, RpeSchema, ZonedTimestampSchema } from './common';
import { LocalDateSchema } from './import';
import { MUSCLE_GROUPS } from './muscle-groups';
import { SplitDayIdSchema } from './routine';

/**
 * Reviews (workout-builder v3 §2.9, §6, §6.1, §6.2; Ben, 20 Oct). Your data
 * (rule 10), stored as their own records. **Facts are separate from coach
 * text**: `facts` are written by code from stored records only (rule 6: no
 * invented signals; an est. max is always flagged `estimate`); `coach` holds
 * what the coach said after the claim check, or why there is none (rule 1:
 * `offline`, `not_connected`, never a canned reply). Proposals a review
 * makes live in `coach_actions` and are referenced by ID.
 *
 * A review re-runs only when its inputs change (`inputsHash`): the new one
 * supersedes the old in one write; one `current` review per subject.
 */

export const ReviewKindSchema = z.enum(['pre_session', 'session', 'post_session', 'weekly', 'block']);
export type ReviewKind = z.infer<typeof ReviewKindSchema>;

/** What a review is about. */
export const ReviewSubjectSchema = z.discriminatedUnion('kind', [
  /** Daily, opening Today (§6.1): readiness for the day's session. */
  z.object({ kind: z.literal('pre_session'), localDate: LocalDateSchema, splitDayId: SplitDayIdSchema.nullable(), draftId: IdSchema.nullable() }),
  /** `Coach review` on Your workout, before Start (§2.9): one builder draft version. */
  z.object({ kind: z.literal('session'), draftId: IdSchema, draftVersion: z.int().min(1) }),
  /** After Finish (Summary). */
  z.object({ kind: z.literal('post_session'), sessionId: IdSchema }),
  /** End of the plan week. */
  z.object({ kind: z.literal('weekly'), weekMonday: LocalDateSchema }),
  /** End of a training block (once blocks exist). */
  z.object({ kind: z.literal('block'), planId: IdSchema, blockId: z.string().min(1).max(64).nullable(), fromDate: LocalDateSchema, toDate: LocalDateSchema }),
]);
export type ReviewSubject = z.infer<typeof ReviewSubjectSchema>;

/** The subject's key (`reviews.subject_key`): one `current` review per (owner, kind, key). */
export function reviewSubjectKey(s: ReviewSubject): string {
  switch (s.kind) {
    case 'pre_session':
      return s.localDate;
    case 'session':
      return s.draftId;
    case 'post_session':
      return s.sessionId;
    case 'weekly':
      return s.weekMonday;
    case 'block':
      return `${s.planId}|${s.blockId ?? '-'}|${s.fromDate}`;
  }
}

const MuscleGroupSchema = z.enum(MUSCLE_GROUPS);
const RangeSchema = z.object({ min: z.int().min(0).max(200), max: z.int().min(0).max(200) }).refine((r) => r.min <= r.max, { message: 'min must be <= max' });

/** The Plan section's lines (§2.9). `actual` / `planned` are counts or minutes as the line says. */
export const ReviewPlanLineSchema = z.enum(['is_next', 'minutes', 'main_lift', 'planned_exercises', 'working_sets']);

/**
 * One fact, from code only, each pointing at stored records. Dated values are
 * actuals; `target` values are targets. No scores (rule 6).
 */
export const ReviewFactSchema = z.discriminatedUnion('kind', [
  /** Working sets per group, vs the plan's and (weekly) the goal range. */
  z.object({ kind: z.literal('group_sets'), group: MuscleGroupSchema, sets: z.int().min(0).max(500), planned: z.int().min(0).max(500).nullable(), range: RangeSchema.nullable() }),
  z.object({ kind: z.literal('sessions_vs_plan'), done: z.int().min(0).max(50), planned: z.int().min(0).max(50) }),
  z.object({ kind: z.literal('plan_line'), line: ReviewPlanLineSchema, ok: z.boolean(), actual: z.number().min(0).max(1000).nullable(), planned: z.number().min(0).max(1000).nullable(), exerciseIds: z.array(IdSchema).max(10) }),
  /** A main lift's recent top sets (actuals), oldest first, with the target where one is set. */
  z.object({
    kind: z.literal('lift_trend'),
    exerciseId: IdSchema,
    points: z.array(z.object({ sessionId: IdSchema, localDate: LocalDateSchema, load: LoadSchema.nullable(), reps: z.int().min(0).max(1000) })).max(12),
    target: LoadSchema.nullable(),
  }),
  /** An estimated max: always labelled an estimate (rule 6). */
  z.object({ kind: z.literal('est_max'), exerciseId: IdSchema, value: MassSchema, estimate: z.literal(true) }),
  z.object({ kind: z.literal('rpe_drift'), exerciseId: IdSchema.nullable(), sessions: z.int().min(1).max(20), meanRpe: z.number().min(1).max(10), targetRpe: RpeSchema }),
  z.object({ kind: z.literal('rep_miss'), exerciseId: IdSchema, sessionId: IdSchema, targetReps: z.int().min(0).max(1000), reps: z.int().min(0).max(1000) }),
  z.object({ kind: z.literal('stalled_lift'), exerciseId: IdSchema, sessions: z.int().min(1).max(20) }),
  z.object({ kind: z.literal('check_in'), checkInId: IdSchema }),
  z.object({ kind: z.literal('activity'), activityId: IdSchema }),
  z.object({ kind: z.literal('pain_flag'), painFlagId: IdSchema, exerciseId: IdSchema.nullable() }),
]);
export type ReviewFact = z.infer<typeof ReviewFactSchema>;

/**
 * The coach's part, kept apart from the facts. `reviewed`: the verdict and
 * lines shown after the claim check (`numbersChecked`: their numbers were
 * checked against the facts), and the proposals/notes it made (coach
 * actions). Otherwise why there's none: the code draft still stands.
 */
export const ReviewCoachSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('reviewed'),
    verdict: z.string().trim().min(1).max(200).nullable(),
    lines: z.array(z.string().trim().min(1).max(300)).max(10),
    actionIds: z.array(IdSchema).max(20),
    numbersChecked: z.boolean(),
  }),
  /** Silent by choice (pre-session with no clear signal, §6.1). */
  z.object({ status: z.literal('silent') }),
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('offline') }),
  z.object({ status: z.literal('not_connected') }),
  z.object({ status: z.literal('failed') }),
]);
export type ReviewCoach = z.infer<typeof ReviewCoachSchema>;

/**
 * Whether the coach's part is settled: `reviewed`, or `silent` by choice. Any other status (`pending`,
 * `offline`, `not_connected`, `failed`) is worth a retry when the coach is reachable (review b3-data S5).
 */
export function reviewCoachSettled(c: ReviewCoach): boolean {
  return c.status === 'reviewed' || c.status === 'silent';
}

export const REVIEW_LIMITS = { maxFacts: 60, maxOpIds: 20, inputsHashMax: 128 } as const;

/** A training review (named apart from `@fizz/catalogue`'s entry `ReviewSchema`; review b3-data N2). */
export const TrainingReviewSchema = RecordMetaSchema.extend({
  subject: ReviewSubjectSchema,
  /** Hash of the inputs it was made from (§6.1: re-run only when they changed). */
  inputsHash: z.string().min(1).max(REVIEW_LIMITS.inputsHashMax),
  facts: z.array(ReviewFactSchema).max(REVIEW_LIMITS.maxFacts),
  coach: ReviewCoachSchema,
  status: z.enum(['current', 'superseded']),
  /** The review that replaced it (status `superseded`). */
  supersededById: IdSchema.nullable(),
  opIds: z.array(OperationIdSchema).min(1).max(REVIEW_LIMITS.maxOpIds),
  createdAt: ZonedTimestampSchema,
}).refine((r) => (r.status === 'superseded') === (r.supersededById !== null), { message: 'Only a superseded review names its successor', path: ['supersededById'] });
export type TrainingReview = z.infer<typeof TrainingReviewSchema>;
