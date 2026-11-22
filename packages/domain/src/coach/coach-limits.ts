import { BUILD_LIMITS } from '@fizz/schemas';
import { SESSION_GROUP_CAP } from '../progress/plan-muscles';

/**
 * (Ben, 8 Nov: "If I agree to apply it there shouldn't be any limit"; CLAUDE.md rule 3, CHANGELOG 2026-11-08)
 * The coach's judgement limits, in one place, and the hard data ceilings that stay. Pure.
 *
 * - **Judgement limits** apply to what the coach does on its own (an unprompted offer, a review suggestion, a
 *   pre-session nudge). Once Ben has asked for the change himself (his words this turn, or his Apply on a card), they
 *   don't block or trim it: the change applies and the card says the trade-off in one line (`tradeOffLine`).
 * - **Still enforced, always**: loads achievable on the gym's real equipment and never past a machine's max (rule 4; a
 *   weight Ben names is kept as typed and the gym learns it), done sets never rewritten by the coach (rule 2), Undo,
 *   operation IDs and versions (rule 5), and the data ceilings below.
 */
export const COACH_JUDGEMENT_LIMITS = {
  /** The coach's own load step: at most this share heavier (or less assistance) than the set's target (Ben, 19 Oct: "20% for both"). */
  loadStep: 0.2,
  /** Direct working sets for one muscle group in one session (VC3 / FQ2, Ben 2 Nov). */
  sessionDirectSets: SESSION_GROUP_CAP,
  /** Warm-ups on one exercise (WU4's longest ladder). */
  warmups: BUILD_LIMITS.maxWarmups,
} as const;

/** Data sanity only (never a coaching judgement): what one exercise can hold today, whoever asked. */
export const COACH_HARD_CEILINGS = {
  setsPerExercise: 20,
  warmupsPerExercise: 20,
} as const;

/** `Biceps 12 sets today · above 8 a session`. */
export function volumeTradeOff(group: string, after: number): string {
  return `${group} ${String(after)} sets today · above ${String(COACH_JUDGEMENT_LIMITS.sessionDirectSets)} a session`;
}

/** `Bench press +30% · above the usual 20% step`. */
export function loadStepTradeOff(exerciseName: string, share: number): string {
  return `${exerciseName} +${String(Math.round(share * 100))}% · above the usual ${String(Math.round(COACH_JUDGEMENT_LIMITS.loadStep * 100))}% step`;
}

/** `Squat: going ahead despite the knee flag`. */
export function painGoAheadTradeOff(exerciseName: string, area: string | null): string {
  return `${exerciseName}: going ahead despite the ${area === null || area === '' ? 'pain' : area} flag`;
}

/** `Bench press: 8 warm-ups · more than the usual 6`. */
export function warmupTradeOff(exerciseName: string, count: number): string {
  return `${exerciseName}: ${String(count)} warm-ups · more than the usual ${String(COACH_JUDGEMENT_LIMITS.warmups)}`;
}

/**
 * (Ben, 8 Nov: pain is a one-session hold he can wave through) Does Ben's own message tell the coach to go ahead
 * despite pain? Deterministic, on his words only (the model's `painGoAhead` claim is never trusted alone; rule 9).
 * "go ahead", "do it anyway", "it's fine", "ignore the flag", "push through", "I'm ok". A message that still reports
 * pain getting worse ("it's getting worse", "sharp") never counts.
 */
export function painGoAheadWords(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  const t = text.toLowerCase().replace(/[’']/g, "'");
  if (/\b(?:worse|sharp|stabbing|can't|cannot|cant)\b/.test(t)) return false;
  return /\b(?:go ahead|go for it|do it anyway|anyway|regardless|it'?s fine|its fine|it'?s ok(?:ay)?|i'?m (?:fine|ok(?:ay)?|good)|feels? (?:fine|ok(?:ay)?|good)|ignore (?:the )?(?:pain|flag|hold)|clear (?:the )?(?:pain|flag|hold)|push through|override)\b/.test(t);
}
