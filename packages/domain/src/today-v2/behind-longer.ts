import { BEHIND_GROUP_CAP, type BehindDay, type BehindWeekFacts } from './behind';

/**
 * (Ben, 21 Nov: MS3 amended, docs/brief/CHANGELOG.md "2026-11-21") `Adjust today?`'s second choice: **a bit longer
 * (+15–20 min)**. On top of today's day (MS4's pick, whichever it is) the most important pieces of the other missed
 * days: their main lifts first, then one exercise for each group with no direct sets this week, none on a later day
 * and none in today's day. Pure; the time comes from the caller's estimate of the real workout (`addedSeconds`, the
 * builder's `estimateBuilderSeconds` with warm-ups as the planner plans them).
 *
 * Kept: ≤ 8 direct sets a group in the session (FQ2/VC3; only Ben's explicit yes goes past it), pain holds (rule 9),
 * no leg work while a long or hard run is near (rule 12), at most the other day's planned sets. Never applied by
 * itself: it is an option on the offer (rule 3).
 */

/** The extra time the longer choice may add (minutes). */
export const BEHIND_LONGER = { maxMinutes: 20, minMinutes: 15 } as const;
/** An extra exercise is never cut below this many sets to fit (its planned count if smaller). */
const MIN_EXTRA_SETS = 2;

export interface BehindExtra {
  exerciseId: string;
  /** Working sets (the other day's planned count, or fewer to fit the cap or the time). */
  sets: number;
  /** The missed day it comes from. */
  dayKey: string;
  /** `main`: that day's main lift (first exposure this week); `uncovered`: a group with no sets this week and none later. */
  reason: 'main' | 'uncovered';
  group: string | null;
}

export interface BehindLongerInput {
  /** Today's day (MS4's pick). */
  top: BehindDay;
  /** The other missed days, best first (MS4's order). */
  others: readonly BehindDay[];
  /** The days the week still has after today (they keep their own work, MS7). */
  later: readonly BehindDay[];
  facts: Pick<BehindWeekFacts, 'weekDirect' | 'mainTrained'>;
  groupOf: (exerciseId: string) => string | null;
  /** Pain-flagged (rule 9) or not doable at this gym. */
  held: (exerciseId: string) => boolean;
  /** A long or hard run yesterday or tomorrow (rule 12): no leg work is added. */
  legsOff: boolean;
  isLegs: (exerciseId: string) => boolean;
  /** Seconds the extras add to today's workout (the builder's estimate, warm-ups included). */
  addedSeconds: (extras: readonly BehindExtra[]) => number;
}

export interface BehindLonger {
  extras: BehindExtra[];
  /** `+18 min`. */
  addedMinutes: number;
}

function groupTotals(d: BehindDay, groupOf: (id: string) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of d.slots) {
    const g = groupOf(s.exerciseId);
    if (g !== null && s.sets > 0) out.set(g, (out.get(g) ?? 0) + s.sets);
  }
  return out;
}

/** The longer option's extras, or null when nothing useful fits (then the offer has the usual choice only). */
export function behindLonger(input: BehindLongerInput): BehindLonger | null {
  const { top, groupOf } = input;
  const budgetS = BEHIND_LONGER.maxMinutes * 60;
  const inToday = new Set(top.slots.filter((s) => s.sets > 0).map((s) => s.exerciseId));
  const perGroup = groupTotals(top, groupOf);
  const laterMains = new Set(input.later.flatMap((d) => d.mainLiftIds));
  const laterGroups = new Set(input.later.flatMap((d) => [...groupTotals(d, groupOf).keys()]));
  const planned = (d: BehindDay, id: string) => d.slots.find((s) => s.exerciseId === id)?.sets ?? 0;

  type Candidate = Omit<BehindExtra, 'sets'> & { planned: number };
  const candidates: Candidate[] = [];
  // (1) Main lifts: first exposure this week, none later.
  for (const d of input.others) {
    for (const id of d.mainLiftIds) {
      if (input.facts.mainTrained.has(id) || laterMains.has(id) || top.mainLiftIds.includes(id)) continue;
      const sets = planned(d, id);
      if (sets > 0) candidates.push({ exerciseId: id, planned: sets, dayKey: d.key, reason: 'main', group: groupOf(id) });
    }
  }
  // (2) Groups with no direct sets this week, none later, none today: the day's first exercise of each.
  for (const d of input.others) {
    const seen = new Set<string>();
    for (const s of d.slots) {
      const g = groupOf(s.exerciseId);
      if (g === null || s.sets < 1 || seen.has(g)) continue;
      seen.add(g);
      if ((input.facts.weekDirect.get(g) ?? 0) > 0 || laterGroups.has(g)) continue;
      candidates.push({ exerciseId: s.exerciseId, planned: s.sets, dayKey: d.key, reason: 'uncovered', group: g });
    }
  }

  const chosen: BehindExtra[] = [];
  const covered = new Set<string>();
  for (const c of candidates) {
    if (inToday.has(c.exerciseId) || chosen.some((x) => x.exerciseId === c.exerciseId)) continue;
    if (input.held(c.exerciseId) || (input.legsOff && input.isLegs(c.exerciseId))) continue;
    // A group today's day or an earlier extra already gives sets isn't a gap any more.
    if (c.reason === 'uncovered' && c.group !== null && ((perGroup.get(c.group) ?? 0) > 0 || covered.has(c.group))) continue;
    const room = c.group === null ? c.planned : BEHIND_GROUP_CAP - (perGroup.get(c.group) ?? 0);
    const most = Math.min(c.planned, room);
    const least = Math.min(c.planned, MIN_EXTRA_SETS);
    for (let sets = most; sets >= least && sets >= 1; sets--) {
      const extra: BehindExtra = { exerciseId: c.exerciseId, sets, dayKey: c.dayKey, reason: c.reason, group: c.group };
      if (input.addedSeconds([...chosen, extra]) > budgetS) continue;
      chosen.push(extra);
      if (c.group !== null) {
        perGroup.set(c.group, (perGroup.get(c.group) ?? 0) + sets);
        covered.add(c.group);
      }
      break;
    }
  }
  if (chosen.length === 0) return null;
  return { extras: chosen, addedMinutes: Math.round(input.addedSeconds(chosen) / 60) };
}

/** Extras named on the Longer row before `+N` (the full list is in the proposal). */
const NAMED_EXTRAS = 2;

export const BEHIND_LONGER_COPY = {
  usual: (minutes: number | null) => (minutes === null ? 'Usual' : `Usual · ~${String(minutes)} min`),
  longer: (minutes: number | null, names: readonly string[]) => {
    const shown = names.slice(0, NAMED_EXTRAS).map((n) => n.toLowerCase());
    const more = names.length > NAMED_EXTRAS ? ` +${String(names.length - NAMED_EXTRAS)}` : '';
    return [minutes === null ? 'Longer' : `Longer · ~${String(minutes)} min`, `+ ${shown.join(', ')}${more}`].join(' · ');
  },
  /** The words the coach gets when Ben taps Longer (his tap, shown as his message). */
  askLonger: (line: string, addedMinutes: number) => `${line}. Build today's workout, a bit longer (+${String(addedMinutes)} min).`,
} as const;

/** Which of the offer's two taps these words are (the exact tap words only; his own words are his own ask). */
export function behindTapChoice(words: string): 'usual' | 'longer' | null {
  const t = words.trim();
  if (/^\d+ days? behind\. Build today's workout\.$/.test(t)) return 'usual';
  if (/^\d+ days? behind\. Build today's workout, a bit longer \(\+\d+ min\)\.$/.test(t)) return 'longer';
  return null;
}
