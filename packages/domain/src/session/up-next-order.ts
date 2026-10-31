/**
 * (Ben, 31 Oct) Up next and this week's Set days dates. Pure.
 *
 * Up next ("the plan needs to be able to adapt based on what you've actually done … Surely I should do the one that
 * I trained the longest ago"), for Set days and Any days alike:
 * 1. the plan day not done this week whose split type was trained longest ago (every workout of that type counts:
 *    plan, off-plan, imported; `planDaysTypeLastTrained`);
 * 2. ties (the same last-trained date, or never trained): Set days by the schedule (the planning day's own day first,
 *    then the earliest scheduled), Any days by plan order;
 * 3. trained today: the planning day is tomorrow (`upNextPlanningWeekday`);
 * 4. every day done this week: the least recently trained overall; a day skipped this week only after those;
 * 5. a day Ben picks himself (the picker, `Make next`) still wins: the caller puts a pin first.
 *
 * The week's dates (`setDaysWeekSlots`): the schedule (Ben's moves applied), then what he actually did (a plan day
 * done on a weekday scheduled for another is a swap for this week), then Up next on the planning day.
 */

/** A plan day as Up next orders it. */
export interface UpNextOrderItem {
  /** Its type last trained (local `YYYY-MM-DD`); null: not in the window. */
  lastTrained: string | null;
  /** `open`: not done this week; `done`; `skipped` (Skip this week). */
  state: 'open' | 'done' | 'skipped';
  /** Smaller first among ties (`setDaysTieRank`, or plan order on Any days). */
  tie: number;
}

const GROUP: Record<UpNextOrderItem['state'], number> = { open: 0, done: 1, skipped: 2 };

/** The days in Up next's order (rules 1, 2 and 4 above); the first is Up next unless a pin wins. */
export function upNextOrder<T>(items: readonly T[], of: (t: T) => UpNextOrderItem): T[] {
  return items
    .map((t, i) => ({ t, i, o: of(t) }))
    .sort((a, b) => {
      const g = GROUP[a.o.state] - GROUP[b.o.state];
      if (g !== 0) return g;
      const la = a.o.lastTrained ?? '';
      const lb = b.o.lastTrained ?? '';
      if (la !== lb) return la < lb ? -1 : 1;
      return a.o.tie - b.o.tie || a.i - b.i;
    })
    .map((x) => x.t);
}

/** Set days ties: the day scheduled on the planning day first, then by scheduled weekday; no weekday last. */
export function setDaysTieRank(weekday: number | null, planningDay: number): number {
  if (weekday === null) return 100;
  return weekday === planningDay ? -1 : weekday;
}

/** A plan day for `setDaysWeekSlots`. */
export interface WeekSlotDay<K> {
  key: K;
  /** Its scheduled weekday this week (Ben's moves applied; Mon = 0); null: none. */
  weekday: number | null;
  /** The weekday it was done this week; null: not done. */
  doneOn: number | null;
  skipped?: boolean;
}

/**
 * (Ben, 31 Oct) Each plan day's weekday this week as the tiles, the day sheet, Library › Plan and Up next's ties read
 * it. Done days: the weekday they were done. Then:
 * - **What he did** (implicit swap, this week only, never stored): a plan day done on a weekday scheduled for another
 *   day still to do is a swap; that day takes the done day's own slot if it is still ahead and free, else the next
 *   free day (no plan day on it, nothing done) from the planning day to Sunday, else none (null: genuinely missed).
 * - **Up next** (`upNext`, absent for the ties): it is the day on the planning day (`upNextPlanningWeekday`). The day
 *   that held that slot takes Up next's slot if it is ahead, else the next free day, else none. A planning day with
 *   no plan day on it keeps its rest day unless Up next's own day has passed.
 * Skipped days and days with no weekday are left as they are. Plan order breaks every tie. Pure.
 */
export function setDaysWeekSlots<K>(input: { days: readonly WeekSlotDay<K>[]; planningDay: number; upNext?: K | null }): Map<K, number | null> {
  const p = input.planningDay;
  const slot = new Map<K, number | null>(input.days.map((d) => [d.key, d.doneOn ?? d.weekday] as const));
  const doneDays = new Set(input.days.flatMap((d) => (d.doneOn === null ? [] : [d.doneOn])));
  const open = (d: WeekSlotDay<K>) => d.doneOn === null && d.skipped !== true;
  const holderOf = (wd: number, except: K) => input.days.find((d) => d.key !== except && open(d) && slot.get(d.key) === wd);
  const free = (wd: number, except: K) => !doneDays.has(wd) && holderOf(wd, except) === undefined;
  const nextFree = (except: K): number | null => {
    for (let wd = Math.max(0, p); wd <= 6; wd += 1) if (free(wd, except)) return wd;
    return null;
  };
  const rehome = (d: WeekSlotDay<K>, preferred: number | null) => {
    slot.set(d.key, null);
    slot.set(d.key, preferred !== null && preferred >= p && free(preferred, d.key) ? preferred : nextFree(d.key));
  };
  // What he did: done days in the order they were done.
  for (const x of [...input.days].filter((d) => d.doneOn !== null).sort((a, b) => (a.doneOn ?? 0) - (b.doneOn ?? 0))) {
    const y = input.days.find((d) => d.key !== x.key && open(d) && slot.get(d.key) === x.doneOn);
    if (y !== undefined) rehome(y, x.weekday);
  }
  // Up next on the planning day.
  const u = input.upNext == null ? undefined : input.days.find((d) => d.key === input.upNext && open(d));
  if (u !== undefined && p <= 6 && slot.get(u.key) !== p) {
    const was = slot.get(u.key) ?? null;
    const h = holderOf(p, u.key);
    if (h !== undefined) {
      slot.set(u.key, p);
      rehome(h, was);
    } else if (!doneDays.has(p) && (was === null || was < p)) slot.set(u.key, p);
  }
  return slot;
}
