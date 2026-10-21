import { z } from 'zod';
import { IdSchema, LoadSchema, MassSchema, OperationIdSchema, RecordMetaSchema, RpeSchema, UtcTimestampSchema, ZonedTimestampSchema } from './common';
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
  /**
   * A lift's recent best sets (actuals), oldest first, with the target where one is set. (Weekly, §6.2)
   * `metric`: what the line plots: `e1rm` (each point's `estimate`, always labelled an estimate),
   * `best_set` (the load), or `reps` (bodyweight). `lowerIsBetter`: an assisted lift (less assistance is
   * stronger). `was`: what Ben had when he set the target. Absent on session reviews.
   */
  z.object({
    kind: z.literal('lift_trend'),
    exerciseId: IdSchema,
    points: z.array(z.object({ sessionId: IdSchema, localDate: LocalDateSchema, load: LoadSchema.nullable(), reps: z.int().min(0).max(1000), estimate: z.number().min(0).max(5000).optional() })).max(12),
    target: LoadSchema.nullable(),
    metric: z.enum(['e1rm', 'best_set', 'reps']).optional(),
    lowerIsBetter: z.boolean().optional(),
    targetReps: z.int().min(1).max(100).nullable().optional(),
    was: z.object({ value: z.number().min(0).max(5000), isEstimate: z.boolean() }).nullable().optional(),
  }),
  /** An estimated max: always labelled an estimate (rule 6). */
  z.object({ kind: z.literal('est_max'), exerciseId: IdSchema, value: MassSchema, estimate: z.literal(true) }),
  /** `targetRpe`: the sessions' own target; null when none was logged (never assumed, rule 6; review b3-coach S4). */
  z.object({ kind: z.literal('rpe_drift'), exerciseId: IdSchema.nullable(), sessions: z.int().min(1).max(20), meanRpe: z.number().min(1).max(10), targetRpe: RpeSchema.nullable() }),
  z.object({ kind: z.literal('rep_miss'), exerciseId: IdSchema, sessionId: IdSchema, targetReps: z.int().min(0).max(1000), reps: z.int().min(0).max(1000) }),
  z.object({ kind: z.literal('stalled_lift'), exerciseId: IdSchema, sessions: z.int().min(1).max(20) }),
  z.object({ kind: z.literal('check_in'), checkInId: IdSchema }),
  z.object({ kind: z.literal('activity'), activityId: IdSchema }),
  z.object({ kind: z.literal('pain_flag'), painFlagId: IdSchema, exerciseId: IdSchema.nullable() }),
  /**
   * (Weekly, §6.2 Goal, Ben 21 Oct) One plan week's consistency: plan days done vs planned (null: no plan
   * in use and no days-a-week aim that week), workouts and runs logged. Counts only, never a score.
   */
  z.object({ kind: z.literal('week_sessions'), weekMonday: LocalDateSchema, done: z.int().min(0).max(50), planned: z.int().min(0).max(50).nullable(), workouts: z.int().min(0).max(50), runs: z.int().min(0).max(50) }),
  /** (Weekly) This week's day dots: a plan day (or a workout with no plan) and whether it was done. Missed days are named, not scored. */
  z.object({ kind: z.literal('week_day'), name: z.string().trim().min(1).max(60), done: z.boolean(), localDate: LocalDateSchema.nullable() }),
  /** (Weekly) Runs Ben logged (only his own activities, rule 6); distance only when every run had one. */
  z.object({ kind: z.literal('runs'), count: z.int().min(0).max(50), distanceM: z.number().min(0).max(5_000_000).nullable() }),
  /** (Weekly) `How did it feel?` taps on this week's Summaries (Ben's own words, never inferred). */
  z.object({ kind: z.literal('feel'), easy: z.int().min(0).max(50), good: z.int().min(0).max(50), hard: z.int().min(0).max(50) }),
  /**
   * (Weekly, §6.1 feedback loop) The same edit repeated on a plan-day template: the last `sessions`
   * workouts from it all did `toSets` working sets of the exercise against the template's `fromSets`.
   */
  z.object({ kind: z.literal('template_edit'), routineId: IdSchema, exerciseId: IdSchema, sessions: z.int().min(2).max(20), fromSets: z.int().min(0).max(30), toSets: z.int().min(0).max(30) }),
  /**
   * (Weekly) The week's status as code worked it out, read back as stored (review b3-wave3-truth B4):
   * `complete` false for a review made before the week ended (Sunday evening), so nothing is missed yet;
   * `basis` what `planned` counts (plan days, the days-a-week aim, or nothing). `missed` is planned − done
   * once the week is over, never more; `missedNames` only when no day of the week was paused (plan days
   * aren't dated, pauses are, so with a pause which day was missed can't be said), at most `missed` of them.
   */
  z.object({ kind: z.literal('week_status'), complete: z.boolean(), basis: z.enum(['plan', 'aim', 'none']), missed: z.int().min(0).max(50), missedNames: z.array(z.string().trim().min(1).max(60)).max(7) }),
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
  /** `atUtc`: when the call failed; the same inputs aren't asked again for a while (review b3-wave3-truth S4). */
  z.object({ status: z.literal('failed'), atUtc: UtcTimestampSchema.optional() }),
]);
export type ReviewCoach = z.infer<typeof ReviewCoachSchema>;

/**
 * Whether the coach's part is settled: `reviewed`, or `silent` by choice. Any other status (`pending`,
 * `offline`, `not_connected`, `failed`) is worth a retry when the coach is reachable (review b3-data S5).
 */
export function reviewCoachSettled(c: ReviewCoach): boolean {
  return c.status === 'reviewed' || c.status === 'silent';
}

export const REVIEW_LIMITS = { maxFacts: 60, maxOpIds: 20, inputsHashMax: 128, maxProposals: 4 } as const;

/**
 * (Weekly, §6.1, §6.2) A plan tweak the review offers with Apply / Skip: code's own (a repeated edit,
 * `source: 'code'`) or the coach's, checked by code. Only a working-set count on one exercise of a
 * plan-day template (no loads, so nothing to snap; rule 4 is untouched). Applied through the routine's
 * versioned write with an `update_routine` record (`actionId`, so Undo restores the version before);
 * refused when the template moved past `expectedVersion` (rule 5).
 */
export const ReviewProposalSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.enum(['code', 'coach']),
  change: z.object({
    kind: z.literal('template_sets'),
    routineId: IdSchema,
    routineName: z.string().min(1).max(120),
    expectedVersion: z.int().min(1),
    exerciseId: IdSchema,
    exerciseName: z.string().min(1).max(120),
    fromSets: z.int().min(0).max(30),
    toSets: z.int().min(1).max(30),
  }),
  /** Why, in words already checked by the claim check (null: none shown). */
  reason: z.string().trim().min(1).max(300).nullable(),
  status: z.enum(['open', 'applied', 'skipped', 'undone', 'stale']),
  /** The `update_routine` record Apply wrote (Undo's target). */
  actionId: IdSchema.nullable(),
});
export type ReviewProposal = z.infer<typeof ReviewProposalSchema>;

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
  /** (Weekly) Plan tweaks offered with Apply / Skip. Absent: none (every review before them). */
  proposals: z.array(ReviewProposalSchema).max(REVIEW_LIMITS.maxProposals).optional(),
  /**
   * (Weekly, Progress v3) When Ben tapped `Got it` on Coach's changes: the section shows one line after it,
   * and `NEW` until it. Absent: not seen.
   */
  seenAtUtc: UtcTimestampSchema.optional(),
}).refine((r) => (r.status === 'superseded') === (r.supersededById !== null), { message: 'Only a superseded review names its successor', path: ['supersededById'] });
export type TrainingReview = z.infer<typeof TrainingReviewSchema>;
