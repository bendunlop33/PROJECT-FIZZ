import { behindCoverageGaps } from '@fizz/domain';

/**
 * (Ben, 8 Nov: MS1–MS9, docs/training-guides/missed-sessions.md) Today's `N days behind · Adjust today?` lands on
 * Your workout as the top missed day, and the coach's change to it is one `propose_workout_edit` card (Apply / Skip,
 * Undo). The checks MS3 and MS5 put on that change, in code. Pure.
 *
 * - MS5 (always): a group the top day covers with 0 direct sets this week and none later is never silently left
 *   out: sent back once with the list, then the card names it (`None this week: Biceps`).
 * - MS3 (unless Ben asked for more, CLAUDE.md rule 3 8 Nov): his usual length (no longer than the day as it opened),
 *   the top day's main lift kept, at most 2 exercises swapped in from other missed days.
 */

export interface BehindSlot {
  exerciseId: string;
  /** Working sets. */
  sets: number;
  main: boolean;
}

export interface BehindEditShape {
  before: readonly BehindSlot[];
  after: readonly BehindSlot[];
  minutesBefore: number;
  minutesAfter: number;
}

export interface BehindEditRules {
  /** The top day's groups nothing else this week covers (`behind.uncovered`). */
  uncovered: readonly string[];
  groupOf: (exerciseId: string) => string | null;
}

/** MS3: at most this many exercises brought in from other missed days. */
export const BEHIND_MAX_SWAPPED_IN = 2;

/**
 * Ben's words go past the behind tap's ask ("make it longer", "add both days", "do 75 min"): his ask wins over MS3's
 * bounds (rule 3, 8 Nov). The tap's own words and "what should I do today, I'm behind" don't.
 */
export function asksBeyondBehind(words: string): boolean {
  const t = words.toLowerCase();
  return /\b(?:more|longer|extra|both|all (?:of )?(?:them|the days|days)|everything|whole|merge|combine|\d+\s*(?:min|mins|minutes)|an hour|swap (?:in )?(?:three|four|3|4))\b/.test(t);
}

export type BehindEditVerdict = { kind: 'ok'; notes: string[] } | { kind: 'refuse'; line: string };

export function checkBehindEdit(shape: BehindEditShape, rules: BehindEditRules, opts: { askedMore: boolean; coverageAsked: boolean }): BehindEditVerdict & { coverageAsked: boolean } {
  const problems: string[] = [];
  if (!opts.askedMore) {
    if (shape.minutesAfter > shape.minutesBefore) problems.push(`his usual length is ${String(shape.minutesBefore)} min`);
    const main = shape.before.find((s) => s.main);
    if (main !== undefined && !shape.after.some((s) => s.main && s.exerciseId === main.exerciseId && s.sets > 0)) problems.push('keep the day’s main lift');
    const had = new Set(shape.before.map((s) => s.exerciseId));
    const added = new Set(shape.after.filter((s) => !had.has(s.exerciseId) && s.sets > 0).map((s) => s.exerciseId));
    if (added.size > BEHIND_MAX_SWAPPED_IN) problems.push(`at most ${String(BEHIND_MAX_SWAPPED_IN)} exercises from other days`);
  }
  if (problems.length > 0) return { kind: 'refuse', line: `Not proposed: ${problems.join('; ')}. Call again within these.`, coverageAsked: opts.coverageAsked };
  const gaps = rules.uncovered.length === 0 ? [] : behindCoverageGaps(rules.uncovered, shape.after, rules.groupOf);
  if (gaps.length > 0 && !opts.coverageAsked) return { kind: 'refuse', line: `Not proposed: ${gaps.join(', ')} get 0 sets this week and none later. Keep them, or call again as it is and name the trade-off.`, coverageAsked: true };
  return { kind: 'ok', notes: gaps.length === 0 ? [] : [`None this week: ${gaps.join(', ')}`], coverageAsked: opts.coverageAsked };
}
