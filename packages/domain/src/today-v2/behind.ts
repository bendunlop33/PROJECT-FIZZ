/**
 * (Ben, 8 Nov: MS1–MS9, docs/training-guides/missed-sessions.md) Behind on the plan this week: the `N days behind ·
 * Adjust today?` offer. All derived from logs and the plan, never stored (rule 6). Pure.
 *
 * - `weekBehind` (MS1): not-done plan days − training slots left this week (planning day to Sunday).
 * - `behindOfferShown` (MS2): when the offer may show.
 * - `behindPick` (MS4): the not-done days scored as today's base; the top one is the built-in offer (MS6).
 * - `behindCoverageGaps` (MS5): groups a coach proposal leaves at 0 direct sets this week with none later.
 */

/** A not-done plan day as the pick scores it. */
export interface BehindDay {
  key: string;
  name: string;
  /** Its main lift(s) (exercise IDs). */
  mainLiftIds: readonly string[];
  /** Its exercises with their planned working sets (warm-ups and cardio left out). */
  slots: readonly { exerciseId: string; sets: number }[];
}

/**
 * The week's slots. `set`: Set days, with `placed` from `setDaysWeekSlots` (null: no slot) and the plan weekdays (each
 * plan day's scheduled weekday this week, Ben's moves applied). `any`: Any days, N plan days a week.
 * `planningDay`: Mon = 0 … Sun = 6; 7 once a workout is done on Sunday (`upNextPlanningWeekday`).
 */
export type BehindSchedule =
  | { mode: 'set'; planningDay: number; planWeekdays: readonly number[]; placed: ReadonlyMap<string, number | null> }
  | { mode: 'any'; planningDay: number; daysPerWeek: number };

export interface WeekBehind {
  mode: 'set' | 'any';
  /** Behind by k (≥ 1 for the offer). */
  k: number;
  /** Not-done plan days (keys, as given: Up next order). */
  notDone: string[];
  /** Training slots left this week. */
  slots: number;
  /**
   * Set days: the not-done days with a slot (a plan weekday from the planning day on), and the ones that don't fit
   * (the tiles show those as missed). Any days: the first `slots` days in Up next order fit; the rest don't.
   */
  fitting: string[];
  overflow: string[];
  /** Set days: the fitting days placed after the planning day (the week's later days, MS7: left as they are). */
  later: string[];
}

/**
 * MS1. Set days: slots = the plan's own weekdays from the planning day, as this week's days hold them (a day only
 * sits on a rest day when Ben moved it there, so that weekday is a plan weekday too). Any days: ⌈N × days left ÷ 7⌉,
 * capped at days left, days left counting the planning day. `notDone`: not done this week, not skipped, not paused.
 */
export function weekBehind(input: { notDone: readonly string[]; schedule: BehindSchedule }): WeekBehind {
  const s = input.schedule;
  const p = s.planningDay;
  if (s.mode === 'set') {
    const plan = new Set(s.planWeekdays);
    const fitting = input.notDone.filter((key) => {
      const wd = s.placed.get(key) ?? null;
      return wd !== null && wd >= p && wd <= 6 && plan.has(wd);
    });
    const overflow = input.notDone.filter((k) => !fitting.includes(k));
    const later = fitting.filter((k) => (s.placed.get(k) ?? -1) > p);
    return { mode: 'set', k: overflow.length, notDone: [...input.notDone], slots: fitting.length, fitting, overflow, later };
  }
  const daysLeft = Math.max(0, 7 - p);
  const slots = Math.min(daysLeft, Math.ceil((Math.max(0, s.daysPerWeek) * daysLeft) / 7));
  const fitting = input.notDone.slice(0, slots);
  const overflow = input.notDone.slice(slots);
  return { mode: 'any', k: Math.max(0, input.notDone.length - slots), notDone: [...input.notDone], slots, fitting, overflow, later: [] };
}

/**
 * MS4's candidates for today's base: Set days, the not-done days but the ones the week still has later (today's own
 * day and the ones that don't fit); Any days, every not-done day. Up next order kept.
 */
export function behindCandidates(b: WeekBehind): string[] {
  return b.mode === 'set' ? b.notDone.filter((k) => !b.later.includes(k)) : [...b.notDone];
}

/**
 * MS4's later days when `key` is today's: Set days, the days placed after the planning day; Any days, the next
 * slots − 1 in Up next order without the day scored.
 */
export function behindLaterDays(b: WeekBehind, key: string): string[] {
  return b.mode === 'set' ? b.later.filter((k) => k !== key) : b.notDone.filter((k) => k !== key).slice(0, Math.max(0, b.slots - 1));
}

/** MS2: the reasons the offer is not shown (all real facts, rule 6). */
export interface BehindOfferGate {
  today: string;
  /** A deload or lighter week (LW3). */
  lighterWeek: boolean;
  paused: boolean;
  /** A gym workout finished or open today. */
  trainedOrOpenToday: boolean;
  /** Ben chose today's day himself: the picker, `Make next`, `Do today instead`, a move onto today. */
  pickedToday: boolean;
  /** Today's check-in says ill. */
  ill: boolean;
  /** Days since his last gym workout (null: none); ≥ 14 is a return-to-load case (R2). */
  gapDays: number | null;
  /** The local date Ben dismissed it (Skip or ✕); that day it stays hidden. */
  dismissedOn: string | null;
}

export const RETURN_TO_LOAD_GAP_DAYS = 14;

export function behindOfferShown(behind: Pick<WeekBehind, 'k'> | null, g: BehindOfferGate): boolean {
  if (behind === null || behind.k < 1) return false;
  if (g.lighterWeek || g.paused || g.trainedOrOpenToday || g.pickedToday || g.ill) return false;
  if (g.gapDays !== null && g.gapDays >= RETURN_TO_LOAD_GAP_DAYS) return false;
  return g.dismissedOn !== g.today;
}

/** The week's logged facts the pick reads (direct sets, V1/V4; warm-ups and cardio never count). */
export interface BehindWeekFacts {
  /** Direct hard sets this week by group. */
  weekDirect: ReadonlyMap<string, number>;
  /** Main lifts (exercise IDs) trained this week. */
  mainTrained: ReadonlySet<string>;
  /** Direct hard sets yesterday by group. */
  yesterdayDirect: ReadonlyMap<string, number>;
}

export interface BehindScore {
  key: string;
  name: string;
  /** (1) Main lifts that would get their first exposure this week today and aren't on a later day. */
  mainLifts: number;
  /** (2) Direct sets for groups with 0 this week and none on a later day (≤ 8 a group, VC3). */
  uncoveredSets: number;
  uncoveredGroups: string[];
  /** (3) A lead group had ≥ 4 direct sets yesterday (a soft tie-break). */
  yesterday: boolean;
  /** Working sets as planned. */
  sets: number;
}

/** A group gets at most this many direct sets in one session (FQ2/VC3). */
export const BEHIND_GROUP_CAP = 8;
const YESTERDAY_HARD = 4;

function groupSets(d: BehindDay, groupOf: (exerciseId: string) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of d.slots) {
    const g = groupOf(s.exerciseId);
    if (g !== null) out.set(g, (out.get(g) ?? 0) + s.sets);
  }
  return out;
}

/**
 * MS4. Each not-done day (in Up next order) scored as today's base; higher wins, later items only break ties: (1) main
 * lifts, (2) uncovered groups' direct sets, (3) not yesterday's lead groups, (4) Up next order. `later(key)`: the
 * days the week still has after the planning day when `key` is today's (Set days: the fitting days after it; Any days:
 * the next slots − 1 in Up next order).
 */
export function behindPick(input: { days: readonly BehindDay[]; later: (key: string) => readonly BehindDay[]; facts: BehindWeekFacts; groupOf: (exerciseId: string) => string | null }): BehindScore[] {
  const scored = input.days.map((d, i) => {
    const later = input.later(d.key).filter((x) => x.key !== d.key);
    const laterMains = new Set(later.flatMap((x) => x.mainLiftIds));
    const laterGroups = new Set(later.flatMap((x) => [...groupSets(x, input.groupOf).keys()]));
    const mine = groupSets(d, input.groupOf);
    const mainLifts = new Set(d.mainLiftIds.filter((id) => !input.facts.mainTrained.has(id) && !laterMains.has(id))).size;
    const uncovered = [...mine].filter(([g]) => (input.facts.weekDirect.get(g) ?? 0) === 0 && !laterGroups.has(g));
    const uncoveredSets = uncovered.reduce((n, [, sets]) => n + Math.min(BEHIND_GROUP_CAP, sets), 0);
    const top = Math.max(0, ...mine.values());
    const lead = [...mine].filter(([, n]) => n === top && n > 0).map(([g]) => g);
    const yesterday = lead.some((g) => (input.facts.yesterdayDirect.get(g) ?? 0) >= YESTERDAY_HARD);
    const sets = d.slots.reduce((n, s) => n + s.sets, 0);
    return { i, score: { key: d.key, name: d.name, mainLifts, uncoveredSets, uncoveredGroups: uncovered.map(([g]) => g), yesterday, sets } };
  });
  return scored
    .sort((a, b) => b.score.mainLifts - a.score.mainLifts || b.score.uncoveredSets - a.score.uncoveredSets || Number(a.score.yesterday) - Number(b.score.yesterday) || a.i - b.i)
    .map((x) => x.score);
}

/** The built-in offer (MS6): the top day whole, as planned. Null: none, or it is already today's card (status only). */
export function behindBuiltInDay(scores: readonly BehindScore[], cardKey: string | null): BehindScore | null {
  const top = scores[0];
  if (top === undefined || top.key === cardKey) return null;
  return top;
}

/**
 * (Ben, 8 Nov: the coach left biceps out) MS5's coverage check on a coach proposal: the top day's uncovered groups
 * (0 direct sets this week, none later) that the proposal gives no direct set. Never silently dropped: the coach is
 * told, and adds them within the budget or names the trade-off.
 */
export function behindCoverageGaps(uncoveredGroups: readonly string[], proposal: readonly { exerciseId: string; sets: number }[], groupOf: (exerciseId: string) => string | null): string[] {
  const have = new Set(proposal.filter((s) => s.sets > 0).map((s) => groupOf(s.exerciseId)));
  return uncoveredGroups.filter((g) => !have.has(g));
}

/** Today's line: `2 days behind`, `1 day behind`. */
export function behindLine(k: number): string {
  return `${String(k)} ${k === 1 ? 'day' : 'days'} behind`;
}

export const BEHIND_COPY = {
  adjust: 'Adjust today?',
  builtIn: 'Built-in',
  /** The words the coach gets when Ben taps `Adjust today?` (his tap, shown as his message). */
  ask: (k: number) => `${behindLine(k)}. Build today's workout.`,
} as const;

/** Ben's words ask what to do today because he's behind (the tap's words, or his own). */
export function asksBehindToday(words: string): boolean {
  const t = words.toLowerCase().replace(/[’]/g, "'");
  return /\bdays? behind\b/.test(t) || /\b(?:adjust|catch up on) today\b/.test(t) || /\bbest workout (?:for )?today\b/.test(t) || /\bwhat should i (?:do|train) today\b/.test(t);
}
