import { z } from 'zod';
import { IdSchema, OperationIdSchema, TimeZoneSchema, UtcTimestampSchema, ZonedTimestampSchema } from './common';

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
};

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
]);
export type TodayEdit = z.infer<typeof TodayEditSchema>;
export type TodayEditKind = TodayEdit['kind'];

export const DraftStatusSchema = z.enum(['open', 'consumed', 'discarded', 'expired']);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/** Most edits a draft keeps (append-only; a long Reorder session is many `order` edits). */
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
});
export type SessionTodayEdits = z.infer<typeof SessionTodayEditsSchema>;
