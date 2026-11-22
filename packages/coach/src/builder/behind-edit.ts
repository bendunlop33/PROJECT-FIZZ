import { BEHIND_GROUP_CAP, behindCoverageGaps } from '@fizz/domain';

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
  /**
   * (Ben, 21 Nov: MS3 amended) The longer choice, when there is one: the extra minutes it may add (`BEHIND_LONGER`) and
   * how many exercises the rules picked (`behindLonger`). Used only on the Longer tap.
   */
  longer?: { maxAddedMinutes: number; extras: number } | null;
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

function directByGroup(slots: readonly BehindSlot[], groupOf: (exerciseId: string) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of slots) {
    const g = groupOf(s.exerciseId);
    if (g !== null && s.sets > 0) out.set(g, (out.get(g) ?? 0) + s.sets);
  }
  return out;
}

/**
 * `longer`: Ben tapped the offer's Longer choice (21 Nov): up to `rules.longer.maxAddedMinutes` over his usual length
 * and the rules' extras on top of the 2 swaps; the 8-a-group cap holds (only his explicit yes goes past it).
 */
export function checkBehindEdit(shape: BehindEditShape, rules: BehindEditRules, opts: { askedMore: boolean; coverageAsked: boolean; longer?: boolean }): BehindEditVerdict & { coverageAsked: boolean } {
  const problems: string[] = [];
  if (!opts.askedMore) {
    const longer = opts.longer === true ? (rules.longer ?? null) : null;
    const most = shape.minutesBefore + (longer?.maxAddedMinutes ?? 0);
    if (shape.minutesAfter > most) problems.push(longer === null ? `his usual length is ${String(shape.minutesBefore)} min` : `at most ${String(most)} min (his usual ${String(shape.minutesBefore)} + ${String(longer.maxAddedMinutes)})`);
    const main = shape.before.find((s) => s.main);
    if (main !== undefined && !shape.after.some((s) => s.main && s.exerciseId === main.exerciseId && s.sets > 0)) problems.push('keep the day’s main lift');
    const had = new Set(shape.before.map((s) => s.exerciseId));
    const added = new Set(shape.after.filter((s) => !had.has(s.exerciseId) && s.sets > 0).map((s) => s.exerciseId));
    const swaps = BEHIND_MAX_SWAPPED_IN + (longer?.extras ?? 0);
    if (added.size > swaps) problems.push(`at most ${String(swaps)} exercises from other days`);
    // MS3: ≤ 8 direct sets a group in the session (a day planned past it keeps its own count).
    const before = directByGroup(shape.before, rules.groupOf);
    const over = [...directByGroup(shape.after, rules.groupOf)].filter(([g, n]) => n > Math.max(BEHIND_GROUP_CAP, before.get(g) ?? 0)).map(([g]) => g);
    if (over.length > 0) problems.push(`at most ${String(BEHIND_GROUP_CAP)} direct sets for ${over.join(', ')}`);
  }
  if (problems.length > 0) return { kind: 'refuse', line: `Not proposed: ${problems.join('; ')}. Call again within these.`, coverageAsked: opts.coverageAsked };
  const gaps = rules.uncovered.length === 0 ? [] : behindCoverageGaps(rules.uncovered, shape.after, rules.groupOf);
  if (gaps.length > 0 && !opts.coverageAsked) return { kind: 'refuse', line: `Not proposed: ${gaps.join(', ')} get 0 sets this week and none later. Keep them, or call again as it is and name the trade-off.`, coverageAsked: true };
  return { kind: 'ok', notes: gaps.length === 0 ? [] : [`None this week: ${gaps.join(', ')}`], coverageAsked: opts.coverageAsked };
}
