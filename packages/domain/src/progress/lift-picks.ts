import { addDays } from '../calendar';
import type { ProgressSession } from './projection';

/**
 * Progress › Lifts: which lifts the chip row offers and which one opens (Ben, 26 Oct 2026: "doesn't show
 * main lifts by default"). Pure.
 *
 * - With a plan in use: the plan's main lift for each day, in the plan's day order.
 * - Without one: Ben's most-trained main compound lifts (one per pattern: bench, squat, deadlift, row,
 *   overhead press), most sessions in the last 12 weeks first, ties in that pattern order.
 * - With neither (no compound logged yet): the most recently done exercises.
 *
 * Only lifts with logged history are offered (the tab charts history). The tab opens on the lift asked for
 * (a link from Overview), else Ben's last pick on this phone if it still has history, else the first chip.
 */

/** What the picks read of an exercise (catalogue or Ben's own row). */
export interface LiftPickInfo {
  movementPattern: string;
  mechanic?: 'compound' | 'isolation' | undefined;
}

export const LIFT_PICKS = {
  /** Chips at most (the plan's days, or the compound patterns). */
  max: 6,
  /** Recent history the no-plan ranking counts (12 weeks); all history when nothing is that recent. */
  recentDays: 84,
  /** Recent exercises offered when no compound has been logged. */
  recentMax: 5,
} as const;

/** The main compound patterns, in the order ties are listed: bench, squat, deadlift, row, overhead press. */
export const MAIN_LIFT_PATTERNS = ['horizontal_push', 'squat', 'hinge', 'horizontal_pull', 'vertical_push'] as const;

export type LiftPicksSource = 'picked' | 'plan' | 'history' | 'recent' | 'none';

export interface LiftPicks {
  /** The chips' exercises, in order. */
  ids: string[];
  source: LiftPicksSource;
}

interface Tally {
  exerciseId: string;
  sessions: number;
  sets: number;
  lastMs: number;
}

function tallies(sessions: readonly Pick<ProgressSession, 'startedMs' | 'exercises'>[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const s of sessions) {
    const seen = new Set<string>();
    for (const ex of s.exercises) {
      const working = ex.sets.filter((x) => x.setType !== 'warmup').length;
      if (ex.sets.length === 0) continue;
      const t = out.get(ex.exerciseId) ?? { exerciseId: ex.exerciseId, sessions: 0, sets: 0, lastMs: 0 };
      if (!seen.has(ex.exerciseId)) t.sessions += 1;
      seen.add(ex.exerciseId);
      t.sets += working;
      t.lastMs = Math.max(t.lastMs, s.startedMs);
      out.set(ex.exerciseId, t);
    }
  }
  return out;
}

const byUse = (a: Tally, b: Tally): number => b.sessions - a.sessions || b.sets - a.sets || b.lastMs - a.lastMs || (a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0);

/** A main compound: one of the five patterns, and not marked isolation. */
export function isMainCompound(info: LiftPickInfo | null): boolean {
  if (info === null || info.mechanic === 'isolation') return false;
  return (MAIN_LIFT_PATTERNS as readonly string[]).includes(info.movementPattern);
}

/**
 * The chip row's lifts. `planMains`: the plan in use's main lift per day in day order (null: no plan in
 * use). `today`: Ben's local date.
 */
export function defaultLiftPicks(input: { planMains: readonly string[] | null; sessions: readonly Pick<ProgressSession, 'date' | 'startedMs' | 'exercises'>[]; info: (exerciseId: string) => LiftPickInfo | null; today: string }): LiftPicks {
  const all = tallies(input.sessions);
  if (all.size === 0) return { ids: [], source: 'none' };
  if (input.planMains !== null) {
    const ids = [...new Set(input.planMains)].filter((id) => all.has(id)).slice(0, LIFT_PICKS.max);
    if (ids.length > 0) return { ids, source: 'plan' };
  }
  const from = addDays(input.today, -LIFT_PICKS.recentDays);
  const recentSessions = input.sessions.filter((s) => s.date >= from && s.date <= input.today);
  const counted = recentSessions.some((s) => s.exercises.some((e) => all.has(e.exerciseId) && isMainCompound(input.info(e.exerciseId)))) ? tallies(recentSessions) : all;
  const best = new Map<string, Tally>();
  for (const t of counted.values()) {
    const info = input.info(t.exerciseId);
    if (info === null || !isMainCompound(info)) continue;
    const cur = best.get(info.movementPattern);
    if (cur === undefined || byUse(t, cur) < 0) best.set(info.movementPattern, t);
  }
  const order = (id: string): number => (MAIN_LIFT_PATTERNS as readonly string[]).indexOf(input.info(id)?.movementPattern ?? '');
  const picks = [...best.values()].sort((a, b) => b.sessions - a.sessions || b.sets - a.sets || order(a.exerciseId) - order(b.exerciseId)).map((t) => t.exerciseId);
  if (picks.length > 0) return { ids: picks.slice(0, LIFT_PICKS.max), source: 'history' };
  const recent = [...all.values()].sort((a, b) => b.lastMs - a.lastMs || (a.exerciseId < b.exerciseId ? -1 : 1)).map((t) => t.exerciseId);
  return { ids: recent.slice(0, LIFT_PICKS.recentMax), source: 'recent' };
}

/**
 * (Ben, 26 Oct) One list of tracked lifts for Overview and Lifts: Ben's own picks (Overview's `Edit`, saved as
 * `progress_lifts`) first, in his order, then the defaults (`defaultLiftPicks`), each once, up to `LIFT_PICKS.max`.
 * Only lifts with logged history are offered (the tab charts history), so a pick with nothing logged yet waits.
 * Overview shows the picks alone once he has made any; the Lifts chips add the defaults after them.
 */
export function trackedLiftPicks(input: { picked: readonly string[]; defaults: LiftPicks; logged: (exerciseId: string) => boolean }): LiftPicks {
  const picked = [...new Set(input.picked)].filter((id) => input.logged(id));
  if (picked.length === 0) return input.defaults;
  const ids = [...new Set([...picked, ...input.defaults.ids])].slice(0, LIFT_PICKS.max);
  return { ids, source: 'picked' };
}

/**
 * The lift the tab opens on: the one asked for (a link or a pick this run), else Ben's last pick on this
 * phone while it still has history, else the first chip, else null (nothing logged).
 */
export function liftsTabSelection(input: { requested: string | null; remembered: string | null; picks: readonly string[]; logged: (exerciseId: string) => boolean }): string | null {
  if (input.requested !== null) return input.requested;
  if (input.remembered !== null && input.logged(input.remembered)) return input.remembered;
  return input.picks[0] ?? null;
}

export interface LiftChip {
  exerciseId: string;
  label: string;
  selected: boolean;
}

/** The chip row: the picks in order; a lift opened from elsewhere (not a pick) leads, so it is always in view. */
export function liftChips(picks: readonly string[], selected: string | null, nameOf: (exerciseId: string) => string): LiftChip[] {
  const ids = selected !== null && !picks.includes(selected) ? [selected, ...picks] : [...picks];
  return ids.map((id) => ({ exerciseId: id, label: nameOf(id), selected: id === selected }));
}
