import type { PainArea, PainFlag, PainFlagReview, ZonedTimestamp } from '@fizz/schemas';
import { addDays, daysBetween, localDateOf } from './calendar';
import { dayMonthText, localDateText } from './display';
import { toMs } from './time';

/**
 * Pain flags without the coach (active-workout.md §2.14; competitor
 * follow-up 8). Pure and deterministic, so all of it works offline with no
 * AI. A flag is a guard (rule 9): nothing here diagnoses, says a movement is
 * safe, or clears a flag. Only Ben's `Clear flag` in the confirmation clears
 * one (`clearPainFlag`, coach-memory CM4); the two-weekly `Still hurts?`
 * check, time and the coach never do.
 *
 * Every sentence the screens show about a flag is built here, so the set
 * card, the rest card, Today, the picker and Profile say the same thing.
 */

/** `timing.painReview` (active-workout §9): the check falls due this many calendar days after the flag was set or last checked. */
export const PAIN_REVIEW_DAYS = 14;

/** Area words in sentences (`shoulder pain`); `other` names no area. */
export const PAIN_AREA_WORD: Readonly<Record<PainArea, string | null>> = {
  shoulder: 'shoulder',
  elbow: 'elbow',
  wrist: 'wrist',
  neck: 'neck',
  back: 'back',
  hip: 'hip',
  knee: 'knee',
  ankle: 'ankle',
  other: null,
};

export const PAIN_NO_INCREASES = 'No increases in load, reps or sets.';
export const PAIN_PROFESSIONAL_TEXT = 'If pain is sharp, keeps coming back or doesn’t settle, see a physio or doctor. The coach can’t diagnose.';
export const MAY_HURT_TAG = 'May hurt';

const areaWord = (flag: Pick<PainFlag, 'area'>): string | null => (flag.area === null ? null : PAIN_AREA_WORD[flag.area]);

/** `6 Oct`: the day the flag was set, in the zone it was set in. */
export function painFlagDay(flag: Pick<PainFlag, 'reportedAt'>): string {
  return dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz);
}

/** Reviews that still count (not undone), oldest first. */
export function liveReviews(flag: Pick<PainFlag, 'reviews'>): PainFlagReview[] {
  return (flag.reviews ?? []).filter((r) => r.undone === undefined);
}

/** When the flag was last checked: its latest live review, else when it was set. */
export function lastPainCheck(flag: Pick<PainFlag, 'reviews' | 'reportedAt'>): ZonedTimestamp {
  return liveReviews(flag).at(-1)?.at ?? flag.reportedAt;
}

/** `YYYY-MM-DD` the next check falls due: 14 calendar days after the last check, in that check's zone. */
export function nextPainCheckDate(flag: Pick<PainFlag, 'reviews' | 'reportedAt'>): string {
  const last = lastPainCheck(flag);
  return addDays(localDateOf(toMs(last.utc), last.tz), PAIN_REVIEW_DAYS);
}

/**
 * The check is due when the flag is active and today (in `tz`) is on or after
 * its due date. Being due changes nothing by itself: no answer keeps it due.
 */
export function isPainCheckDue(flag: Pick<PainFlag, 'status' | 'reviews' | 'reportedAt'>, nowMs: number, tz: string): boolean {
  return flag.status === 'active' && localDateOf(nowMs, tz) >= nextPainCheckDate(flag);
}

/** `getPainFlagChecksDue`: active flags whose check is due, oldest flag first. */
export function painChecksDue<T extends Pick<PainFlag, 'status' | 'reviews' | 'reportedAt'>>(flags: readonly T[], nowMs: number, tz: string): T[] {
  return flags.filter((f) => isPainCheckDue(f, nowMs, tz)).sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc));
}

/** Calendar days since the flag was set (0 on the day). */
export function daysSinceFlag(flag: Pick<PainFlag, 'reportedAt'>, nowMs: number, tz: string): number {
  return Math.max(0, daysBetween(localDateOf(toMs(flag.reportedAt.utc), flag.reportedAt.tz), localDateOf(nowMs, tz)));
}

const daysText = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);

/**
 * The active flag on this exercise, if any: the one whose check is due
 * first, else the oldest. Only the exercise Ben flagged is covered; similar
 * movements never are (coach-memory CM5: the app doesn't decide which joints
 * are involved).
 */
export function painFlagCovering(flags: readonly PainFlag[], exerciseId: string, nowMs: number, tz: string): { flag: PainFlag; checkDue: boolean } | null {
  const active = flags.filter((f) => f.exerciseId === exerciseId && f.status === 'active').sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc));
  const due = active.find((f) => isPainCheckDue(f, nowMs, tz));
  if (due) return { flag: due, checkDue: true };
  const first = active[0];
  return first ? { flag: first, checkDue: false } : null;
}

// ---------------------------------------------------------------------------
// `Still hurts?` answers (versioned and idempotent; the caller checks the version)

export type PainReviewOutcome =
  | { kind: 'recorded'; flag: PainFlag; review: PainFlagReview }
  /** The same operation again (a retry or double tap): nothing more is written. */
  | { kind: 'duplicate'; flag: PainFlag; review: PainFlagReview }
  | { kind: 'not_active' }
  /** Asked only when due; an answer that isn't due (e.g. answered elsewhere already) changes nothing. */
  | { kind: 'not_due' };

/**
 * `recordPainFlagReview(flagId, 'still_hurts', opId)`: keeps the flag and
 * moves the next check 14 days on. It never clears a flag.
 */
export function recordPainFlagReview(flag: PainFlag, answer: PainFlagReview['answer'], opId: string, at: ZonedTimestamp): PainReviewOutcome {
  const same = (flag.reviews ?? []).find((r) => r.opId === opId);
  if (same) return { kind: 'duplicate', flag, review: same };
  if (flag.status !== 'active') return { kind: 'not_active' };
  if (!isPainCheckDue(flag, toMs(at.utc), at.tz)) return { kind: 'not_due' };
  const review: PainFlagReview = { at, answer, opId };
  return {
    kind: 'recorded',
    review,
    flag: { ...flag, reviews: [...(flag.reviews ?? []), review].slice(-200), version: flag.version + 1, updatedAtUtc: at.utc },
  };
}

export type PainReviewUndoOutcome =
  | { kind: 'undone'; flag: PainFlag }
  | { kind: 'duplicate'; flag: PainFlag }
  | { kind: 'not_found' }
  | { kind: 'not_active' }
  /** Undone already by another operation. */
  | { kind: 'already_undone' }
  /** A later answer exists: only the latest can be undone. */
  | { kind: 'not_latest' };

/**
 * Undo on `Pain flag kept · next check …`: the answer is marked undone (kept
 * for the audit), so the check is due again exactly as before.
 */
export function undoPainFlagReview(flag: PainFlag, reviewOpId: string, undoOpId: string, at: ZonedTimestamp): PainReviewUndoOutcome {
  const reviews = flag.reviews ?? [];
  const review = reviews.find((r) => r.opId === reviewOpId);
  if (!review) return { kind: 'not_found' };
  if (review.undone) return review.undone.opId === undoOpId ? { kind: 'duplicate', flag } : { kind: 'already_undone' };
  if (flag.status !== 'active') return { kind: 'not_active' };
  if (liveReviews(flag).at(-1)?.opId !== reviewOpId) return { kind: 'not_latest' };
  return {
    kind: 'undone',
    flag: {
      ...flag,
      reviews: reviews.map((r) => (r.opId === reviewOpId ? { ...r, undone: { atUtc: at.utc, opId: undoOpId } } : r)),
      version: flag.version + 1,
      updatedAtUtc: at.utc,
    },
  };
}

// ---------------------------------------------------------------------------
// Copy (active-workout §5, exercise-library §5, today.md §5)

/** `PainFlagNote` under the target line. */
export function painNoteText(checkDue: boolean): string {
  return `Pain flag: no increases${checkDue ? ' · check due' : ''}`;
}

export function painNoteAccessibility(checkDue: boolean): string {
  return `Pain flag on this movement. Loads won’t go up.${checkDue ? ' Check due.' : ''}`;
}

/** `PainReviewLine`, line 1. */
export function painReviewQuestion(exerciseName: string): string {
  return `${exerciseName}: still hurting?`;
}

/** `PainReviewLine`, line 2: `Pain flag since 6 Oct · 16 days`. */
export function painFlagFact(flag: Pick<PainFlag, 'reportedAt'>, nowMs: number, tz: string): string {
  return `Pain flag since ${painFlagDay(flag)} · ${daysText(daysSinceFlag(flag, nowMs, tz))}`;
}

/** The outcome line after `Still hurts`: `Pain flag kept · next check 3 Nov`. */
export function painKeptText(flag: Pick<PainFlag, 'reviews' | 'reportedAt'>): string {
  return `Pain flag kept · next check ${localDateText(nextPainCheckDate(flag))}`;
}

/**
 * From the second `Still hurts` in a row (4 weeks or more) the outcome adds a
 * line suggesting a professional. It names no condition and no cause (rule 9).
 */
export function painProfessionalNudge(flag: Pick<PainFlag, 'reviews' | 'reportedAt'>, nowMs: number, tz: string): string | null {
  if (liveReviews(flag).length < 2) return null;
  const weeks = Math.max(4, Math.floor(daysSinceFlag(flag, nowMs, tz) / 7));
  return `It’s been ${String(weeks)} weeks. Pain that lasts this long is worth getting checked by a physio or doctor.`;
}

/** The picker confirm before adding a flagged exercise (EL9). Never says it's safe or unsafe, never suggests a cause. */
export function mayHurtConfirm(flag: Pick<PainFlag, 'exerciseName' | 'area' | 'reportedAt'>): { title: string; message: string; confirm: 'Add anyway'; cancel: 'Choose another' } {
  const area = areaWord(flag);
  return {
    title: `${flag.exerciseName} may hurt`,
    message: `You flagged ${area === null ? '' : `${area} `}pain on it on ${painFlagDay(flag)}. Loads won’t go up while the flag is on.`,
    confirm: 'Add anyway',
    cancel: 'Choose another',
  };
}

export function mayHurtAccessibility(flag: Pick<PainFlag, 'area'>): string {
  const area = areaWord(flag);
  return `May hurt: you flagged ${area === null ? '' : `${area} `}pain on it.`;
}

/** The clear confirmation (AW10; revises coach-memory §2.7). Default style, not red: clearing isn't destructive. */
export function painClearConfirm(flag: Pick<PainFlag, 'exerciseName' | 'reportedAt'>): { title: string; message: string; confirm: 'Clear flag'; cancel: 'Keep it' } {
  return {
    title: `Clear the pain flag on ${flag.exerciseName}?`,
    message: `Loads, reps and sets can go up again, starting from your recent sets. Your sets from before ${painFlagDay(flag)} stay in your history as the reference.`,
    confirm: 'Clear flag',
    cancel: 'Keep it',
  };
}

export function painClearedToast(exerciseName: string): { text: string; action: 'Undo' } {
  return { text: `Pain flag cleared for ${exerciseName}`, action: 'Undo' };
}

/** Pain flag sheet heading: `Overhead press · shoulder`. */
export function painFlagHeading(flag: Pick<PainFlag, 'exerciseName' | 'area'>): string {
  const area = areaWord(flag);
  return area === null ? flag.exerciseName : `${flag.exerciseName} · ${area}`;
}

/** `Since 6 Oct (16 days) · you, in a check-in`. Every flag is Ben's own: the coach can't set one by itself. */
export function painFlagSinceText(flag: Pick<PainFlag, 'reportedAt' | 'source'>, nowMs: number, tz: string): string {
  const days = daysSinceFlag(flag, nowMs, tz);
  const who = flag.source === 'check_in' ? 'you, in a check-in' : 'you, during a workout';
  return `Since ${painFlagDay(flag)} (${days === 0 ? 'today' : daysText(days)}) · ${who}`;
}

export type TodayPainCheck =
  | { kind: 'one'; flagId: string; text: string; accessibilityLabel: string }
  /** Several due: the row opens the Pain flags list. */
  | { kind: 'several'; count: number; text: string; accessibilityLabel: string };

/**
 * Today's quiet row (today.md region 4b) while any check is due. The caller
 * hides it while a workout is in progress (the workout asks in place).
 */
export function todayPainCheck(flags: readonly PainFlag[], nowMs: number, tz: string): TodayPainCheck | null {
  const due = painChecksDue(flags, nowMs, tz);
  const first = due[0];
  if (!first) return null;
  if (due.length === 1) {
    const ago = `flagged ${daysText(daysSinceFlag(first, nowMs, tz))} ago`;
    return { kind: 'one', flagId: first.id, text: `Still hurts? ${first.exerciseName} · ${ago}`, accessibilityLabel: `Pain flag check due: ${first.exerciseName}, ${ago}.` };
  }
  return { kind: 'several', count: due.length, text: `Still hurts? ${String(due.length)} pain flags to check`, accessibilityLabel: `Pain flag checks due: ${String(due.length)} flags.` };
}
