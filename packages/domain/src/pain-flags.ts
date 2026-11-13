import type { PainArea, PainFlag } from '@fizz/schemas';
import { daysBetween, localDateOf } from './calendar';
import { dayMonthText } from './display';
import { toMs } from './time';

/**
 * Pain flags without the coach (active-workout.md §2.14; competitor
 * follow-up 8). Pure and deterministic, so all of it works offline with no
 * AI. A flag is a guard (rule 9): nothing here diagnoses or says a movement is
 * safe. Rule 9 as changed on 8 Nov: a flag holds the movement in the workout it
 * was reported in and the movement's next workout, then reads as cleared by
 * itself (`withPainHold`). Ben's `Clear flag` (`clearPainFlag`) clears it
 * early; the coach going ahead because Ben said so uses the same clear.
 *
 * Every sentence the screens show about a flag is built here, so the set
 * card, the rest card, Today, the picker and Profile say the same thing.
 */

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

export const PAIN_NO_INCREASES = 'No increases · clears after next session';
export const PAIN_PROFESSIONAL_TEXT = 'Sharp or lasting pain: see a physio or doctor.';
/** The red-flag line on the check-in pain step: safety, so always visible (minimal-copy D2). */
export const PAIN_RED_FLAG_TEXT = 'Chest pain, faintness or sudden severe pain: stop and get medical help now.';
export const MAY_HURT_TAG = 'May hurt';

const areaWord = (flag: Pick<PainFlag, 'area'>): string | null => (flag.area === null ? null : PAIN_AREA_WORD[flag.area]);

/** `6 Oct`: the day the flag was set, in the zone it was set in. */
export function painFlagDay(flag: Pick<PainFlag, 'reportedAt'>): string {
  return dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz);
}

/** Calendar days since the flag was set (0 on the day). */
export function daysSinceFlag(flag: Pick<PainFlag, 'reportedAt'>, nowMs: number, tz: string): number {
  return Math.max(0, daysBetween(localDateOf(toMs(flag.reportedAt.utc), flag.reportedAt.tz), localDateOf(nowMs, tz)));
}

const daysText = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);

/**
 * The active flag on this exercise, if any (the oldest). Only the exercise Ben flagged is covered; similar movements
 * never are (coach-memory CM5: the app doesn't decide which joints are involved).
 */
export function painFlagCovering(flags: readonly PainFlag[], exerciseId: string): { flag: PainFlag } | null {
  const active = flags.filter((f) => f.exerciseId === exerciseId && f.status === 'active').sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc));
  const first = active[0];
  return first ? { flag: first } : null;
}

// ---------------------------------------------------------------------------
// Copy (active-workout §5, exercise-library §5, today.md §5)

/** `PainFlagNote` under the target line: `Pain flag · clears after next session` (rule 9, 8 Nov). */
export function painNoteText(clearsAfterThis = false): string {
  return `Pain flag · clears after ${clearsAfterThis ? 'this workout' : 'next session'}`;
}

export function painNoteAccessibility(clearsAfterThis = false): string {
  return `Pain flag on this movement. Loads won’t go up. Clears after ${clearsAfterThis ? 'this workout' : 'the next session'}.`;
}

/**
 * Whether the workout `session` is the last one a flag holds (rule 9, 8 Nov): the flag was reported before it started
 * and not in its own check-in, so this workout is the movement's next one after the report.
 */
export function painClearsAfter(flag: Pick<PainFlag, 'reportedAt' | 'checkInId'>, session: { startedAtUtc: string; checkInId: string | null }): boolean {
  if (flag.checkInId !== null && flag.checkInId === session.checkInId) return false;
  return toMs(flag.reportedAt.utc) < toMs(session.startedAtUtc);
}

/** The picker confirm before adding a flagged exercise (EL9). Never says it's safe or unsafe, never suggests a cause. */
export function mayHurtConfirm(flag: Pick<PainFlag, 'exerciseName' | 'area' | 'reportedAt'>): { title: string; message: string; confirm: 'Add anyway'; cancel: 'Choose another' } {
  const area = areaWord(flag);
  return {
    title: `${flag.exerciseName} may hurt`,
    message: `${area === null ? 'Pain' : `${area.charAt(0).toUpperCase()}${area.slice(1)} pain`} flagged ${painFlagDay(flag)}.`,
    confirm: 'Add anyway',
    cancel: 'Choose another',
  };
}

export function mayHurtAccessibility(flag: Pick<PainFlag, 'area'>): string {
  const area = areaWord(flag);
  return `May hurt: you flagged ${area === null ? '' : `${area} `}pain on it.`;
}

/**
 * The clear confirmation (AW10; revises coach-memory §2.7). Default style, not
 * red: clearing isn't destructive. Title and buttons only (minimal copy S11):
 * the toast that follows has Undo.
 */
export function painClearConfirm(flag: Pick<PainFlag, 'exerciseName'>): { title: string; confirm: 'Clear flag'; cancel: 'Keep it' } {
  return {
    title: `Clear the pain flag on ${flag.exerciseName}?`,
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

// ---------------------------------------------------------------------------
// One-session hold (CLAUDE.md rule 9 as changed by Ben, 8 Nov)

/**
 * A workout with the flagged movement in it, as the hold reads it: finished with a completed set of the movement, or
 * the workout in progress with the movement in it. `finishedAtUtc` null: in progress.
 */
export interface PainExposure {
  sessionId: string;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  /** The check-in answered for the workout (`sessions.check_in_id`): a check-in flag's report workout. */
  checkInId: string | null;
}

export interface PainHold {
  /** The workout the pain was reported in (it holds), when that workout has the movement. */
  reportSessionId: string | null;
  /** The movement's next workout after the report (it holds too); null: not started yet. */
  nextSessionId: string | null;
  /** When the hold ended by itself: the next workout's finish. Null while it holds. */
  lapsedAtUtc: string | null;
}

/**
 * Rule 9 (Ben, 8 Nov: "the pain flags are one off, not usual"): a pain flag holds progression for its movement in the
 * workout it was reported in and in the movement's next workout, then clears by itself, unless Ben reports pain again
 * (a new flag, a new hold). Read at read time from the workouts, so flags stored before 8 Nov need no migration: one
 * whose movement has been done in a finished workout since the report reads as cleared. Ben's own `Clear flag` still
 * clears it early. Pure; never diagnoses.
 *
 * The report workout: the one its check-in was answered for, else the one in progress when it was reported. The next
 * workout: the first one of the movement that started after the report.
 */
export function painHoldOf(flag: Pick<PainFlag, 'reportedAt' | 'checkInId'>, exposures: readonly PainExposure[]): PainHold {
  const at = toMs(flag.reportedAt.utc);
  const byStart = [...exposures].sort((a, b) => toMs(a.startedAtUtc) - toMs(b.startedAtUtc) || (a.sessionId < b.sessionId ? -1 : 1));
  const report =
    (flag.checkInId === null ? undefined : byStart.find((e) => e.checkInId === flag.checkInId)) ??
    byStart.find((e) => toMs(e.startedAtUtc) <= at && (e.finishedAtUtc === null || toMs(e.finishedAtUtc) >= at));
  const next = byStart.find((e) => e.sessionId !== report?.sessionId && toMs(e.startedAtUtc) > at && (report === undefined || toMs(e.startedAtUtc) >= toMs(report.startedAtUtc)));
  return { reportSessionId: report?.sessionId ?? null, nextSessionId: next?.sessionId ?? null, lapsedAtUtc: next?.finishedAtUtc ?? null };
}

/**
 * The flag as every reader sees it: an active flag whose hold has run out reads as cleared (`lapsed` says when and
 * after which workout). Anything else is returned as it is.
 */
export function withPainHold(flag: PainFlag, exposures: readonly PainExposure[]): PainFlag {
  if (flag.status !== 'active') return flag;
  const hold = painHoldOf(flag, exposures);
  if (hold.lapsedAtUtc === null || hold.nextSessionId === null) return flag;
  return { ...flag, status: 'cleared', clearedAtUtc: hold.lapsedAtUtc, lapsed: { atUtc: hold.lapsedAtUtc, sessionId: hold.nextSessionId } };
}

/** The workouts a flag held (report and next), for stall checks and the weekly review to skip (rule 9, ST2). Retracted flags held nothing. */
export function painHeldSessionIds(flag: PainFlag, exposures: readonly PainExposure[]): Set<string> {
  if (flag.status === 'retracted') return new Set();
  const hold = painHoldOf(flag, exposures);
  const out = new Set<string>();
  // A flag Ben cleared early held only the workouts started before he cleared it.
  const clearedMs = flag.status === 'cleared' && flag.lapsed === undefined && flag.clearedAtUtc !== null ? toMs(flag.clearedAtUtc) : Number.POSITIVE_INFINITY;
  for (const sid of [hold.reportSessionId, hold.nextSessionId]) {
    const e = exposures.find((x) => x.sessionId === sid);
    if (e !== undefined && toMs(e.startedAtUtc) < clearedMs) out.add(e.sessionId);
  }
  return out;
}

/** Per exercise, every workout a flag held (`painHeldSessionIds`). `exposuresOf` gives one exercise's workouts. */
export function painHeldSessions(flags: readonly PainFlag[], exposuresOf: (exerciseId: string) => readonly PainExposure[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of flags) {
    const ids = painHeldSessionIds(f, exposuresOf(f.exerciseId));
    if (ids.size === 0) continue;
    const cur = out.get(f.exerciseId) ?? new Set<string>();
    for (const id of ids) cur.add(id);
    out.set(f.exerciseId, cur);
  }
  return out;
}

/** `Pain flag · clears after next session` / `… after this workout`, for the flag's own rows (Profile, the pain sheet). */
export function painHoldText(flag: Pick<PainFlag, 'status'>, inNextSession: boolean): string | null {
  if (flag.status !== 'active') return null;
  return inNextSession ? 'Pain flag · clears after this workout' : 'Pain flag · clears after next session';
}

/**
 * Whether `sessionId` (the workout in progress) is the flag's next workout (the last one it holds), from the
 * exposures: then the hold ends with it.
 */
export function isLastHeldSession(flag: Pick<PainFlag, 'reportedAt' | 'checkInId'>, exposures: readonly PainExposure[], sessionId: string): boolean {
  return painHoldOf(flag, exposures).nextSessionId === sessionId;
}
