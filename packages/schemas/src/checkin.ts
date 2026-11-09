import { z } from 'zod';
import { IdSchema, OperationIdSchema, RecordMetaSchema, UtcTimestampSchema, ZonedTimestampSchema } from './common';

/**
 * Pre-workout check-in (check-in.md §6). A record of what Ben said, never a
 * measurement: it is stored and shown as given, never averaged or scored, and
 * the built-in progression rules ignore it. Your data (owner-scoped).
 */

export const CheckInScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type CheckInScore = z.infer<typeof CheckInScoreSchema>;

export const CheckInReasonSchema = z.enum(['tired', 'poor_sleep', 'sore_training', 'stressed', 'ill', 'pain', 'other']);
export type CheckInReason = z.infer<typeof CheckInReasonSchema>;

export const CHECK_IN_NOTE_MAX = 280;

/** Values a history entry can hold (score, note, reason list, flag IDs). */
const HistoryValueSchema = z.union([z.number(), z.string(), z.array(z.string()), z.null()]);

export const CheckInHistoryEntrySchema = z.object({
  atUtc: UtcTimestampSchema,
  opId: OperationIdSchema,
  field: z.enum(['score', 'reasons', 'note', 'painFlagIds', 'outcome', 'deleted']),
  from: HistoryValueSchema,
  to: HistoryValueSchema,
});
export type CheckInHistoryEntry = z.infer<typeof CheckInHistoryEntrySchema>;

/**
 * `started` is not stored: a check-in is linked to a workout by the session
 * row (`WorkoutSession.checkIn`), written in the same transaction as the
 * session, so the link has one source of truth. `outcome` records only what
 * happened instead of starting.
 */
export const CheckInOutcomeSchema = z.enum(['not_started', 'skipped_workout', 'rescheduled']);
export type CheckInOutcome = z.infer<typeof CheckInOutcomeSchema>;

export const CheckInSchema = RecordMetaSchema.extend({
  score: CheckInScoreSchema,
  reasons: z.array(CheckInReasonSchema).max(7).refine((r) => new Set(r).size === r.length, { message: 'Each reason appears once' }),
  /** Ben's own words, as typed (rule 8: data, never instructions). */
  note: z.string().max(CHECK_IN_NOTE_MAX).optional(),
  /** Labels the score was given against. */
  scale: z.object({ version: z.literal(1), low: z.literal('rough'), high: z.literal('great') }),
  recordedAt: ZonedTimestampSchema,
  /** Local calendar date in `recordedAt.tz`. */
  localDate: z.iso.date(),
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tap') }),
    z.object({ kind: z.literal('voice'), transcript: z.string().max(2000) }),
  ]),
  outcome: CheckInOutcomeSchema,
  /** Pain flags set from this check-in's pain step. */
  painFlagIds: z.array(IdSchema).max(40),
  /** Operation that created the record (`recordCheckIn` is idempotent per opId). */
  createdByOpId: OperationIdSchema,
  /** Later updates already applied, so a retried update is a no-op (bounded). */
  appliedOps: z.array(OperationIdSchema).max(50),
  history: z.array(CheckInHistoryEntrySchema).max(200),
  deletedAtUtc: UtcTimestampSchema.optional(),
});
export type CheckIn = z.infer<typeof CheckInSchema>;

/** How a session relates to the check-in (stored on the session row). */
export const SessionCheckInSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answered'), checkInId: IdSchema }),
  z.object({ kind: z.literal('skipped'), atUtc: UtcTimestampSchema }),
  /**
   * `when_i_choose` (Ben, 23 Oct): Start doesn't ask; Ben is assumed fine and nothing is recorded. The
   * check-in stays one quiet tap away in the workout until the first working set is logged.
   */
  z.object({ kind: z.literal('not_asked'), reason: z.enum(['off', 'not_a_check_in_day', 'when_i_choose']) }),
  /** Created by a path that couldn't ask (none in this build). */
  z.object({ kind: z.literal('pending') }),
]);
export type SessionCheckIn = z.infer<typeof SessionCheckInSchema>;

export const WeekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Check-in settings (check-in.md §2.8). Not persisted yet: the defaults are used. */
/**
 * When Start asks the check-in (check-in.md §2.8). (Ben, 26 Oct) Saved on the training profile
 * (`checkInSchedule`, Your data) from Profile › Training › Check-in.
 */
export const CheckInScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('when_i_choose') }),
  z.object({ kind: z.literal('every_workout') }),
  z.object({ kind: z.literal('days'), weekdays: z.array(WeekdaySchema).max(7) }),
]);
export type CheckInSchedule = z.infer<typeof CheckInScheduleSchema>;

export const CheckInSettingsSchema = z.object({
  enabled: z.boolean(),
  /**
   * `when_i_choose` (Ben, 23 Oct; the default): never asked on Start. The check-in is offered quietly in
   * the workout until the first working set is logged, and stays editable on the Summary.
   */
  schedule: CheckInScheduleSchema,
  /** Ask "What's up?" at or below this score; null = never. */
  askReasonsAtOrBelow: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  /** The coach offers a lighter session at or below this score; null = never. */
  offerAtOrBelow: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  offerOnTiredOrPoorSleep: z.boolean(),
});
export type CheckInSettings = z.infer<typeof CheckInSettingsSchema>;

/**
 * Minimal pain flag (coach-memory.md CM4; rule 9). Rule 9 as changed by Ben
 * on 8 Nov: a flag holds progression for that movement in the workout it was
 * reported in and in the movement's next workout, then clears by itself
 * (read at read time, `withPainHold`), unless pain is reported again. Ben can
 * clear it early. Never a diagnosis.
 */
export const PainAreaSchema = z.enum(['shoulder', 'elbow', 'wrist', 'neck', 'back', 'hip', 'knee', 'ankle', 'other']);
export type PainArea = z.infer<typeof PainAreaSchema>;

/**
 * One answer to the retired two-weekly `Still hurts?` check (active-workout.md
 * §2.14.2; removed by Ben, 9 Nov: flags clear by themselves after one more
 * session). Still parsed so flags and backups saved before then stay valid;
 * nothing reads or writes it now.
 */
export const PainFlagReviewSchema = z.object({
  at: ZonedTimestampSchema,
  answer: z.enum(['still_hurts']),
  /** The operation that recorded it: a retry with the same ID is a no-op. */
  opId: OperationIdSchema,
  undone: z.object({ atUtc: UtcTimestampSchema, opId: OperationIdSchema }).optional(),
});
export type PainFlagReview = z.infer<typeof PainFlagReviewSchema>;

export const PainFlagSchema = RecordMetaSchema.extend({
  exerciseId: IdSchema,
  /** Snapshot, so the flag still reads well if the catalogue changes. */
  exerciseName: z.string().min(1).max(120),
  area: PainAreaSchema.nullable(),
  /** `coach`: set by the coach's `set_pain_flag` from Ben's own words in a turn (ADR 0020). */
  source: z.enum(['check_in', 'workout', 'coach']),
  checkInId: IdSchema.nullable(),
  reportedAt: ZonedTimestampSchema,
  /**
   * `retracted` (review B2, 2026-10-10): Ben took a flag back with Undo
   * right after setting it (a mistaken `Pain` tick or check-in answer). It
   * is as if the flag never existed: not active, never a `Before flag`
   * reference, not listed, and never a return-to-load guard. Kept as a
   * document (never deleted) for the audit; it can't become active again.
   * `cleared` is stored only by Ben's explicit `Clear flag`; a flag whose
   * one-session hold ran out reads as `cleared` with `lapsed` (8 Nov).
   */
  status: z.enum(['active', 'cleared', 'retracted']),
  clearedAtUtc: UtcTimestampSchema.nullable(),
  createdByOpId: OperationIdSchema,
  /** When and by which operation the flag was retracted; present only on `retracted` flags. */
  retracted: z.object({ atUtc: UtcTimestampSchema, opId: OperationIdSchema }).optional(),
  /**
   * Legacy (9 Oct–9 Nov): answers to the retired `Still hurts?` check. Kept
   * only so older flags and backups parse; ignored.
   */
  reviews: z.array(PainFlagReviewSchema).max(200).optional(),
  /**
   * (Rule 9, 8 Nov) The hold ran out by itself: the movement's next workout after the report (`sessionId`) finished
   * at `atUtc`. Derived when the flag is read (`withPainHold`), with `status: 'cleared'`; absent otherwise.
   */
  lapsed: z.object({ atUtc: UtcTimestampSchema, sessionId: IdSchema }).optional(),
});
export type PainFlag = z.infer<typeof PainFlagSchema>;
