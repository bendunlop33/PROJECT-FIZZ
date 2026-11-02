import { daysBetween } from './calendar';
import type { LoadDirection } from './equipment';
import { stallResetLoad, STALL_RESET_MAX_PERCENT } from './stall-reset';

/**
 * (Ben, 2 Nov: approved ST1–ST3, docs/training-guides/frequency-and-volume-caps.md §3) The app's one stall
 * definition. Pure. Every caller reads it from here: the built-in rule's next-session targets (7-F,
 * `progression.ts`), Progress › block view (`block-lifts.ts`) and the weekly review (`review/weekly.ts`).
 *
 * - **ST1, miss stall** (playbook rule 8 made exact): the same target missed in **2 consecutive comparable
 *   sessions** with **≥ 7 days from the first miss to the second**. Two misses inside 7 days wait for a third.
 *   One miss is a note only.
 * - **ST2, no-progress stall**: **no new best for ≥ 3 comparable sessions and ≥ 3 weeks** since the last best.
 *   Deload, lead-in, return-ramp, pain-flag and planned light sessions are skipped (they neither count nor break a
 *   run); a lift held at a machine max or rep cap is a `ceiling`, never a stall. Under Maintain only a drop counts.
 * - **ST3, what a stall does**: shown as a label only. When Ben opens a review or asks: one offer, a rep-scheme change
 *   first, then a 5–10% reset (snapped to the equipment's achievable loads, rule 4); 2+ lifts stalled in the same
 *   fortnight (or performance falling across 2+ sessions) → rule 10's deload offer instead. A pain-flagged lift gets
 *   no offer (rule 9). Offers are offers (rule 3): nothing here applies anything.
 */
export const STALL_RULES = {
  /** ST1: consecutive comparable sessions missing the same target. */
  missSessions: 2,
  /** ST1: calendar days from the first miss to the second. */
  missMinDays: 7,
  /** ST2: comparable sessions with no new best. */
  noBestSessions: 3,
  /** ST2: weeks with no new best (distinct trained weeks after the best's own week). */
  noBestWeeks: 3,
  /** ST3: this many lifts stalled within `deloadWindowDays` → the deload offer instead. */
  deloadAfterStalls: 2,
  deloadWindowDays: 14,
} as const;

// ---------------------------------------------------------------------------
// ST1

/** One session in a miss streak: its local calendar date (`YYYY-MM-DD`). */
export interface StallMiss {
  date: string;
}

export interface MissStall {
  stalled: boolean;
  /** Consecutive misses read. */
  misses: number;
  /** Calendar days from the oldest miss in the streak to the newest. */
  spanDays: number;
  /** Enough misses, but they fell within 7 days: one more is needed. */
  waitingForThird: boolean;
}

/**
 * ST1. `missesNewestFirst`: the consecutive comparable sessions that missed the same target, newest first (the
 * caller stops at the first session that didn't miss). `needed`: the rule's `failuresBeforeReduce` (2 by default).
 * A stall needs `needed` misses spanning ≥ 7 days; a run inside 7 days needs one more miss.
 */
export function missStall(missesNewestFirst: readonly StallMiss[], needed: number = STALL_RULES.missSessions): MissStall {
  const n = missesNewestFirst.length;
  const need = Math.max(1, needed);
  const newest = missesNewestFirst[0];
  const oldest = missesNewestFirst[n - 1];
  const spanDays = newest === undefined || oldest === undefined ? 0 : daysBetween(oldest.date, newest.date);
  if (n < need) return { stalled: false, misses: n, spanDays, waitingForThird: false };
  const spread = need === 1 || spanDays >= STALL_RULES.missMinDays;
  const stalled = spread || n >= need + 1;
  return { stalled, misses: n, spanDays, waitingForThird: !stalled };
}

// ---------------------------------------------------------------------------
// ST2

/** One comparable session (or one block week) of a lift, oldest first. */
export interface StallPoint<T> {
  /** The best set (or value) of the point; compared with `compare`. */
  value: T;
  /** Calendar week key: a Monday (`YYYY-MM-DD`) or a block week number. */
  week: string | number;
  /** Sessions this point stands for (a block week with 2 sessions: 2). Default 1. */
  sessions?: number;
  /** Deload, lead-in, return-ramp, pain-flag or planned light: skipped (never counts, never breaks a run). */
  skip?: boolean;
  /** Held at a machine max or the rule's rep cap: a ceiling, not a stall. */
  ceiling?: boolean;
}

export type NoProgressState = 'stalled' | 'ceiling' | 'progressing' | 'too_early';

export interface NoProgressStall {
  state: NoProgressState;
  /** Index (into the input) of the last best, or null with nothing counted. */
  bestIndex: number | null;
  /** Counted sessions after the last best with no new best. */
  sessionsWithoutBest: number;
  /** Distinct trained weeks after the last best's week with no new best. */
  weeksWithoutBest: number;
  /** Indices of the counted points in the current no-best run (for per-week labels). */
  run: number[];
}

export interface NoProgressOptions {
  /** Under a Maintain plan only a drop counts: a held point resets the run (as approved). */
  maintain?: boolean;
}

/** Whether a run of this many sessions and weeks without a best is an ST2 stall. */
export function isNoProgressStall(sessionsWithoutBest: number, weeksWithoutBest: number): boolean {
  return sessionsWithoutBest >= STALL_RULES.noBestSessions && weeksWithoutBest >= STALL_RULES.noBestWeeks;
}

/**
 * ST2. `points` oldest first; `compare(a, b)` > 0 when `a` is the better set (more load at the same or more reps,
 * or more reps at the same load). The first counted point is the base best. A point equal to the best is no new
 * best (it extends the run), except under Maintain, where only a drop does.
 */
export function noProgressStall<T>(points: readonly StallPoint<T>[], compare: (a: T, b: T) => number, opts: NoProgressOptions = {}): NoProgressStall {
  let best: T | null = null;
  let bestIndex: number | null = null;
  let bestWeek: string | number | null = null;
  let run: number[] = [];
  for (const [i, p] of points.entries()) {
    if (p.skip === true) continue;
    if (best === null) {
      best = p.value;
      bestIndex = i;
      bestWeek = p.week;
      continue;
    }
    const c = compare(p.value, best);
    if (c > 0) {
      best = p.value;
      bestIndex = i;
      bestWeek = p.week;
      run = [];
      continue;
    }
    if (opts.maintain === true && c === 0) {
      run = [];
      continue;
    }
    run.push(i);
  }
  const counted = run.map((i) => points[i]).filter((p): p is StallPoint<T> => p !== undefined);
  const sessionsWithoutBest = counted.reduce((s, p) => s + Math.max(1, p.sessions ?? 1), 0);
  const weeksWithoutBest = new Set(counted.map((p) => p.week).filter((w) => w !== bestWeek)).size;
  const latest = [...points].reverse().find((p) => p.skip !== true);
  const base = { bestIndex, sessionsWithoutBest, weeksWithoutBest, run };
  if (bestIndex === null) return { state: 'too_early', ...base };
  if (run.length === 0) return { state: 'progressing', ...base };
  if (!isNoProgressStall(sessionsWithoutBest, weeksWithoutBest)) return { state: 'too_early', ...base };
  return { state: latest?.ceiling === true ? 'ceiling' : 'stalled', ...base };
}

// ---------------------------------------------------------------------------
// ST3

export type StallOffer =
  /** A rep-scheme change or a variation (first). */
  | { kind: 'rep_scheme' }
  /** A 5–10% reset to an achievable load (second; `load` in the lift's own unit and convention). */
  | { kind: 'reset'; load: number }
  /** Rule 10's deload proposal (2+ lifts stalled in a fortnight, or performance falling across 2+ sessions). */
  | { kind: 'deload' };

export interface StallOfferInput {
  /** An active pain flag on the movement: no offer to progress (rule 9; the pain flow only). */
  pain: boolean;
  /** Ben already took (or was shown and applied) a rep-scheme change for this stall. */
  repSchemeTried: boolean;
  /** Other lifts stalled within the last 14 days (this one not counted). */
  otherStallsInFortnight: number;
  /** Performance fell across ≥ 2 sessions (rule 10). */
  performanceFalling?: boolean;
  /** The current working load and the equipment's achievable loads (null: none known), for the reset. */
  current: number | null;
  achievable: readonly number[] | null;
  direction: LoadDirection;
  percent?: number;
}

/**
 * ST3: the one offer for a stalled lift, or null (pain flag; or no easier load exists and the rep scheme was tried).
 * Never applies anything: the caller shows it where Ben opened it (weekly review, Library › Changes) or when he asks.
 */
export function stallOffer(input: StallOfferInput): StallOffer | null {
  if (input.pain) return null;
  if (input.otherStallsInFortnight + 1 >= STALL_RULES.deloadAfterStalls || input.performanceFalling === true) return { kind: 'deload' };
  if (!input.repSchemeTried) return { kind: 'rep_scheme' };
  if (input.current === null) return null;
  const load = stallResetLoad(input.current, input.achievable, input.direction, input.percent ?? STALL_RESET_MAX_PERCENT);
  return load === null ? null : { kind: 'reset', load };
}

/** Lifts whose stall dates (`YYYY-MM-DD`) fall within 14 days of `date`, `date`'s own lift excluded by the caller. */
export function stallsInFortnight(date: string, others: readonly string[]): number {
  return others.filter((d) => Math.abs(daysBetween(d, date)) < STALL_RULES.deloadWindowDays).length;
}
