import { z } from 'zod';
import { DistanceMetresSchema, IdSchema, LoadSchema, OperationIdSchema, RepRangeSchema, TimeZoneSchema, UtcTimestampSchema, ZonedTimestampSchema } from './common';

/**
 * The pre-start draft (ADR 0022, overview-today-edits.md): today's edits to a
 * workout that hasn't started yet (Swap today, Skip today, Do first,
 * Reorder). Your data, owner-scoped (rule 10); never in coach context.
 *
 * Edits store **intent** (which slot, which exercise, which order), never a
 * load, so a gym change or a routine edit re-plans them (GS2). The list is
 * append-only: Undo, Reset and a replacing edit mark an edit `removed`; a
 * restored edit is a new copy. Every write bumps `version` and records its
 * `opId`, so a retry is a no-op and a stale version writes nothing (rule 5).
 */

/** What the draft edits: a routine, or the next session of a non-routine workout. */
export const DraftBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('routine'), routineId: IdSchema }),
  z.object({ kind: z.literal('next'), sourceSessionId: IdSchema }),
  /** (12 Oct, workout-builder BD2) A coach-built workout draft: today's edits on it follow the same rules; the coach draft itself lasts 14 days. */
  z.object({ kind: z.literal('coach_draft'), draftId: IdSchema }),
]);
export type DraftBasis = z.infer<typeof DraftBasisSchema>;

export const TodayEditRemovedSchema = z.object({
  atUtc: UtcTimestampSchema,
  opId: OperationIdSchema,
  why: z.enum(['undo', 'reset', 'replaced', 'stale', 'redundant']),
});
export type TodayEditRemoved = z.infer<typeof TodayEditRemovedSchema>;

const editBase = {
  editId: IdSchema,
  opId: OperationIdSchema,
  atUtc: UtcTimestampSchema,
  /** A newer swap on the same slot (or a newer order) replaces the older one; Undo brings that one back. */
  replacesEditId: IdSchema.nullable(),
  removed: TodayEditRemovedSchema.nullable(),
  /** Who made it (overview-today-edits §11.9): absent = Ben. A coach edit (fit-to-time, slice C) also names its action. */
  author: z.enum(['ben', 'coach']).optional(),
  actionId: IdSchema.optional(),
};

/** Today's edit limits (TE17): working sets per exercise, added exercises, reps, work time. */
/** `maxCardioS` (review cardio S1): a cardio row's time today, up to the cardio timer's cap (4 h). */
export const TODAY_EDIT_LIMITS = { minSets: 1, maxSets: 10, maxAdded: 6, minReps: 1, maxReps: 50, minWorkS: 5, maxWorkS: 600, maxCardioS: 14_400 } as const;

/** `How long?` (fit-to-time §3.2): the session length a fit aims at, in whole minutes (the wheel steps by 5). */
export const FIT_MINUTES = { min: 15, max: 180, step: 5 } as const;

/**
 * One edit. `slotKey`: the routine's `RoutineExercise.id`, or the source
 * workout's part-root `SessionExercise.id` (never an array position).
 * The union is closed in this version; a later target edit (a lighter start
 * after a break, once its playbook rules are approved) is a new variant.
 */
export const TodayEditSchema = z.discriminatedUnion('kind', [
  z.object({ ...editBase, kind: z.literal('swap'), slotKey: IdSchema, toExerciseId: IdSchema }),
  z.object({ ...editBase, kind: z.literal('skip'), slotKey: IdSchema }),
  z.object({ ...editBase, kind: z.literal('order'), slotKeys: z.array(IdSchema).min(1).max(40) }),
  /** §11 (TE12): an exercise added at the end for today; `slotKey` is the new row's own key. */
  /** `workingSets` (2026-10-12, exercise-library §10.2): the Pick one sheet's `Sets` count; absent = the default shape's (TE16). */
  z.object({ ...editBase, kind: z.literal('add'), slotKey: IdSchema, exerciseId: IdSchema, workingSets: z.int().min(TODAY_EDIT_LIMITS.minSets).max(TODAY_EDIT_LIMITS.maxSets).optional() }),
  /** The slot's working-set count today (warm-ups follow the exercise). */
  z.object({ ...editBase, kind: z.literal('sets'), slotKey: IdSchema, workingSets: z.int().min(TODAY_EDIT_LIMITS.minSets).max(TODAY_EDIT_LIMITS.maxSets) }),
  /**
   * Every working set's reps (a range or exact), or work time, today: exactly one of the two.
   * A cardio row's edit (review cardio S1) always carries `distanceM` (null: no distance target)
   * and may hold a time up to `maxCardioS`, or a distance alone; any other row's has no `distanceM`.
   */
  z.object({
    ...editBase,
    kind: z.literal('reps'),
    slotKey: IdSchema,
    reps: RepRangeSchema.nullable(),
    durationS: z.int().min(TODAY_EDIT_LIMITS.minWorkS).max(TODAY_EDIT_LIMITS.maxCardioS).nullable(),
    distanceM: DistanceMetresSchema.nullable().optional(),
  }),
  /**
   * Ben's own target load today (TE13): his *intended* load, convention
   * explicit, fitted on every read like any intended load (never past a
   * max, toward easier). The one edit that carries a number.
   * `exerciseId`: the exercise it was typed for (the slot's exercise then). It
   * applies only while the slot holds that exercise, so a swap never carries
   * it onto another exercise in another convention (review B1). Absent on
   * edits from before it was recorded: the slot's own exercise.
   */
  z.object({ ...editBase, kind: z.literal('load'), slotKey: IdSchema, load: LoadSchema, exerciseId: IdSchema.optional() }),
  /**
   * Fit to time (fit-to-time FT4): the length today should fit, as intent.
   * Ben's (no `author`, or `ben`): the built-in trim re-runs on every read,
   * after the planner. The coach's (`author: 'coach'`, with `actionId`): the
   * coach's own `skip` / `sets` / `add` edits with the same `actionId` are
   * the fit, and the built-in trim doesn't run. One live at a time.
   * `minutes: null` (12 Oct, workout-builder BD11): "no fit today", so
   * `Clear fit` can override the length a coach draft was built for.
   */
  z.object({ ...editBase, kind: z.literal('fit'), minutes: z.int().min(FIT_MINUTES.min).max(FIT_MINUTES.max).nullable() }),
]).superRefine((e, ctx) => {
  if (e.author === 'coach' && e.actionId === undefined) ctx.addIssue({ code: 'custom', message: 'A coach edit names its action', path: ['actionId'] });
  if (e.kind !== 'reps') return;
  const cardio = e.distanceM !== undefined;
  if (cardio ? e.reps !== null || (e.durationS === null && e.distanceM === null) : (e.reps === null) === (e.durationS === null)) ctx.addIssue({ code: 'custom', message: 'A reps edit has reps or a work time, not both', path: ['reps'] });
  if (!cardio && e.durationS !== null && e.durationS > TODAY_EDIT_LIMITS.maxWorkS) ctx.addIssue({ code: 'custom', message: 'A work time is at most 10:00', path: ['durationS'] });
  if (e.reps !== null && (e.reps.min < TODAY_EDIT_LIMITS.minReps || e.reps.max > TODAY_EDIT_LIMITS.maxReps)) ctx.addIssue({ code: 'custom', message: 'Reps are 1–50', path: ['reps'] });
});
export type TodayEdit = z.infer<typeof TodayEditSchema>;
export type TodayEditKind = TodayEdit['kind'];

export const DraftStatusSchema = z.enum(['open', 'consumed', 'discarded', 'expired']);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/** Most edits a draft keeps. Only live edits count toward it; removed ones are compacted oldest first (a long Reorder session is many `order` edits). */
export const MAX_DRAFT_EDITS = 400;
/** Most operation IDs remembered for idempotency. */
export const MAX_DRAFT_OPS = 400;

export const PreStartDraftSchema = z
  .object({
    id: IdSchema,
    ownerId: IdSchema,
    basis: DraftBasisSchema,
    status: DraftStatusSchema,
    /** Set when Start consumed it. */
    sessionId: IdSchema.nullable(),
    edits: z.array(TodayEditSchema).max(MAX_DRAFT_EDITS),
    /** Operations already applied (a repeated `opId` returns the draft as it is). */
    opIds: z.array(OperationIdSchema).max(MAX_DRAFT_OPS),
    version: z.int().min(1),
    createdAt: ZonedTimestampSchema,
    updatedAt: ZonedTimestampSchema,
    /** `updatedAt.utc`, for the document store's version column. */
    updatedAtUtc: UtcTimestampSchema,
    /** The time zone of the latest write: the day the edits are for. */
    tz: TimeZoneSchema,
    /** The next local midnight in `tz` after the latest write: the draft is closed from then on. */
    expiresAtUtc: UtcTimestampSchema,
  })
  .refine((d) => d.updatedAtUtc === d.updatedAt.utc, { message: 'updatedAtUtc must equal updatedAt.utc', path: ['updatedAtUtc'] })
  .refine((d) => (d.status === 'consumed') === (d.sessionId !== null), { message: 'Only a consumed draft names its session', path: ['sessionId'] });
export type PreStartDraft = z.infer<typeof PreStartDraftSchema>;

/**
 * What a session started from a draft keeps of it (`WorkoutSession.todayEdits`,
 * ADR 0022 §4): the edits that applied, for history and `Why?`. Absent on every
 * other session.
 */
export const SessionTodayEditsSchema = z.object({
  draftId: IdSchema,
  draftVersion: z.int().min(1),
  swapped: z
    .array(
      z.object({
        sessionExerciseId: IdSchema,
        slotKey: IdSchema,
        fromExerciseId: IdSchema,
        fromExerciseName: z.string().min(1).max(120),
      }),
    )
    .max(40),
  skipped: z.array(z.object({ sessionExerciseId: IdSchema, slotKey: IdSchema })).max(40),
  /** The order was changed before Start. */
  reordered: z.boolean(),
  /** §11: exercises added before Start. Absent on sessions from before slice B. */
  added: z.array(z.object({ sessionExerciseId: IdSchema, slotKey: IdSchema })).max(40).optional(),
  /** §11: rows whose sets, reps or load Ben changed before Start. */
  edited: z
    .array(z.object({ sessionExerciseId: IdSchema, slotKey: IdSchema, kinds: z.array(z.enum(['sets', 'reps', 'load'])).min(1).max(3) }))
    .max(40)
    .optional(),
  /** Fit to time (fit-to-time §6): the fit live at Start and what it cut or added. Absent: no fit. */
  fitted: z
    .object({
      minutes: z.int().min(FIT_MINUTES.min).max(FIT_MINUTES.max),
      by: z.enum(['built_in', 'coach']),
      cuts: z
        .array(
          z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('sets'), slotKey: IdSchema, from: z.int().min(0).max(40), to: z.int().min(0).max(40) }),
            z.object({ kind: z.literal('skip'), slotKey: IdSchema }),
            z.object({ kind: z.literal('add'), slotKey: IdSchema }),
          ]),
        )
        .max(40),
    })
    .optional(),
});
export type SessionTodayEdits = z.infer<typeof SessionTodayEditsSchema>;
