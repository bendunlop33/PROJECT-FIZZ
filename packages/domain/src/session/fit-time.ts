import type { SessionAggregate, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';
import { FIT_MINUTES } from '@fizz/schemas';
import { toIso, toMs } from '../time';
import { estimateRemainingDuration, roundEstimateMinutes, type ResolvedPace } from './duration';
import { formatDuration } from '../display';
import { nextPendingSet } from './order';
import { PACE_SOURCE_LABEL } from './time-left';

/**
 * Fit to time (fit-to-time.md §4): the built-in trim. Pure and offline.
 *
 * `fitPlanToMinutes` only ever marks planned sets `skipped`; it never
 * changes a load, a rep target, rest, the order, or adds anything (FT3,
 * §4.4). Priority (§4.2): tier A (main lifts) is trimmed last and only down
 * to 2 working sets, never skipped; tier B (other compounds) after tier C
 * (everything else). Within a tier, later in today's order goes first. A
 * superset is one unit. Slots Ben edited, and pain-held slots, are left as
 * they are (FT5). Every minute comes from `estimateRemainingDuration` (FT7).
 */

export type FitTier = 'A' | 'B' | 'C';

/** §4.2: main → A; another compound (or one of Ben's priority groups, when set) → B; the rest → C. */
export function fitTier(slot: { main: boolean; compound: boolean; priority?: boolean }): FitTier {
  if (slot.main) return 'A';
  if (slot.compound || slot.priority === true) return 'B';
  return 'C';
}

export interface FitSlot {
  slotKey: string;
  /** The planned rows of this slot (one, or a part root and its parts). */
  sessionExerciseIds: readonly string[];
  tier: FitTier;
  /** Ben added this slot or changed its sets, reps or load today (FT5): never trimmed or skipped. */
  benEdited: boolean;
  /** A pain flag covers it (`HELD`): left as it is. */
  held: boolean;
  /** Today's superset group (after skips); members of one group are one unit. */
  supersetGroup: string | null;
}

export type FitCut = { slotKey: string; kind: 'sets'; from: number; to: number } | { slotKey: string; kind: 'skip' };

export type FitStatus = 'fitted' | 'already_fits' | 'over';

export interface FitResult {
  status: FitStatus;
  /** Unrounded estimates before and after the cuts. */
  beforeSeconds: number;
  afterSeconds: number;
  /** One per slot changed, in today's order. */
  cuts: FitCut[];
  /** The planned sets to mark skipped. */
  skipSetIds: string[];
}

export interface FitInput {
  /** The planner's output after Ben's edits, nothing done yet (or, mid-workout, the pending sets). */
  preview: SessionAggregate;
  slots: readonly FitSlot[];
  minutes: number;
  pace: ResolvedPace;
}

/** Working sets never trimmed below (§4.3), or the slot's own count when it has fewer. */
export const FIT_FLOOR_SETS = 2;

const TIER_RANK: Record<FitTier, number> = { A: 0, B: 1, C: 2 };

interface Unit {
  slots: FitSlot[];
  tier: FitTier;
  position: number;
}

/** Whether a whole number of minutes is one `How long?` can ask for. */
export function validFitMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= FIT_MINUTES.min && minutes <= FIT_MINUTES.max;
}

export function fitPlanToMinutes(input: FitInput): FitResult {
  const { preview, pace } = input;
  const target = input.minutes * 60;
  const cut = new Set<string>();
  const estimate = (): number => estimateRemainingDuration(withSkipped(preview, cut, 'before_start'), { pace }).seconds;
  const fits = (): boolean => estimate() <= target;

  const rowsOf = new Map(input.slots.map((s) => [s.slotKey, new Set(s.sessionExerciseIds)]));
  const pendingOf = (slot: FitSlot): WorkoutSet[] => {
    const rows = rowsOf.get(slot.slotKey) ?? new Set<string>();
    return preview.sets.filter((s) => rows.has(s.sessionExerciseId) && s.status === 'pending' && s.pairedWithSetId === null && !cut.has(s.id)).sort((a, b) => a.index - b.index);
  };
  const companionsOf = (setId: string): string[] => preview.sets.filter((s) => s.pairedWithSetId === setId && s.status === 'pending').map((s) => s.id);
  const workingOf = (slot: FitSlot): WorkoutSet[] => pendingOf(slot).filter((s) => s.setType !== 'warmup');
  const startCount = new Map(input.slots.map((s) => [s.slotKey, workingOf(s).length]));
  const startPending = new Map(input.slots.map((s) => [s.slotKey, pendingOf(s).length]));
  const floorOf = (slot: FitSlot): number => Math.min(FIT_FLOOR_SETS, startCount.get(slot.slotKey) ?? 0);
  const locked = (slot: FitSlot): boolean => slot.benEdited || slot.held;

  const beforeSeconds = estimate();
  if (beforeSeconds <= target) return { status: 'already_fits', beforeSeconds, afterSeconds: beforeSeconds, cuts: [], skipSetIds: [] };

  // Today's order: each slot's first row position.
  const orderOf = new Map(preview.exercises.map((e) => [e.id, e.order]));
  const position = (slot: FitSlot): number => Math.min(...slot.sessionExerciseIds.map((id) => orderOf.get(id) ?? Number.MAX_SAFE_INTEGER));
  const ordered = [...input.slots].filter((s) => (startPending.get(s.slotKey) ?? 0) > 0).sort((a, b) => position(a) - position(b));
  const units: Unit[] = [];
  for (const s of ordered) {
    const last = units.at(-1);
    const lastGroup = last?.slots[0]?.supersetGroup ?? null;
    if (last !== undefined && s.supersetGroup !== null && s.supersetGroup === lastGroup) {
      last.slots.push(s);
      if (TIER_RANK[s.tier] < TIER_RANK[last.tier]) last.tier = s.tier;
    } else {
      units.push({ slots: [s], tier: s.tier, position: position(s) });
    }
  }

  /** The set a trim removes from a slot: the last drop set, else the last back-off, else the last plain working set. Never a top set. */
  const nextToRemove = (slot: FitSlot): WorkoutSet | null => {
    const working = workingOf(slot);
    if (working.length <= floorOf(slot)) return null;
    for (const type of ['drop', 'backoff', 'working'] as const) {
      const s = working.filter((x) => x.setType === type).at(-1);
      if (s !== undefined) return s;
    }
    return null;
  };
  /** One round off a unit: one working set from each member above its floor. */
  const trimUnit = (u: Unit): boolean => {
    let any = false;
    for (const slot of u.slots) {
      if (locked(slot)) continue;
      const s = nextToRemove(slot);
      if (s === null) continue;
      cut.add(s.id);
      for (const c of companionsOf(s.id)) cut.add(c);
      any = true;
    }
    return any;
  };
  const liveSlots = (): number => ordered.filter((s) => pendingOf(s).length > 0).length;
  const skipUnit = (u: Unit): boolean => {
    if (u.tier === 'A' || u.slots.some(locked)) return false;
    const members = u.slots.filter((s) => pendingOf(s).length > 0);
    if (members.length === 0 || liveSlots() - members.length < 1) return false;
    for (const slot of members) for (const s of pendingOf(slot)) {
      cut.add(s.id);
      for (const c of companionsOf(s.id)) cut.add(c);
    }
    return true;
  };
  /** Lowest priority first: later in today's order goes first. */
  const bottomUp = (tier: FitTier): Unit[] => units.filter((u) => u.tier === tier).sort((a, b) => b.position - a.position);
  /** Round-robin, one set per unit per turn, re-estimating after each. True once it fits. */
  const roundRobin = (list: readonly Unit[]): boolean => {
    for (;;) {
      let progress = false;
      for (const u of list) {
        if (!trimUnit(u)) continue;
        progress = true;
        if (fits()) return true;
      }
      if (!progress) return false;
    }
  };

  const done =
    // Pass 1: trim tier C, then tier B.
    roundRobin(bottomUp('C')) ||
    roundRobin(bottomUp('B')) ||
    // Pass 2: skip whole units, tier C then tier B, bottom-up.
    [...bottomUp('C'), ...bottomUp('B')].some((u) => skipUnit(u) && fits()) ||
    // Pass 3: tier A to 2 working sets.
    roundRobin(bottomUp('A'));

  const afterSeconds = estimate();
  const cuts: FitCut[] = [];
  for (const s of ordered) {
    const left = pendingOf(s);
    const from = startCount.get(s.slotKey) ?? 0;
    if (left.length === 0) cuts.push({ slotKey: s.slotKey, kind: 'skip' });
    else if (workingOf(s).length < from) cuts.push({ slotKey: s.slotKey, kind: 'sets', from, to: workingOf(s).length });
  }
  const order = new Map(preview.sets.map((s, i) => [s.id, i]));
  return {
    status: done ? 'fitted' : 'over',
    beforeSeconds,
    afterSeconds,
    cuts,
    skipSetIds: [...cut].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  };
}

/** The aggregate with `setIds` (pending ones only) marked skipped, and the active set moved on if it was one of them. */
export function withSkipped(aggregate: SessionAggregate, setIds: ReadonlySet<string>, by: 'before_start' | 'in_workout'): SessionAggregate {
  if (setIds.size === 0) return aggregate;
  const sets = aggregate.sets.map((s) => (setIds.has(s.id) && s.status === 'pending' ? { ...s, status: 'skipped' as const, skippedBy: by } : s));
  const active = aggregate.session.activeSetId;
  const activeSetId = active !== null && !setIds.has(active) ? active : nextPendingSet(null, aggregate.exercises, sets);
  return { ...aggregate, sets, session: { ...aggregate.session, activeSetId } };
}

const FIVE_MIN_MS = 5 * 60_000;

/** FT8: `Finish by` for a workout started with a fit: start + minutes, rounded up to 5 min, in the start's time zone. */
export function finishByFromFit(startedAt: ZonedTimestamp, minutes: number): ZonedTimestamp {
  const ms = Math.ceil((toMs(startedAt.utc) + minutes * 60_000) / FIVE_MIN_MS) * FIVE_MIN_MS;
  return { utc: toIso(ms), tz: startedAt.tz };
}

/**
 * The minutes a fit shows (FT7): the estimate's own rounding, except that a
 * fit that can't reach its length never reads at or under it (`Shortest:
 * ≈ 50 min` for 47 against 45, not `≈ 45`): it rounds up to the next 5.
 */
export function fitMinutesOf(seconds: number, status: FitStatus, minutes: number): number {
  const rounded = roundEstimateMinutes(seconds);
  if (status !== 'over' || rounded > minutes) return rounded;
  return Math.max(minutes + 1, Math.ceil(seconds / 300) * 5);
}

/** `7 over 45`: whole minutes past the length (at least 1 while over). */
export function overByMinutes(seconds: number, minutes: number): number {
  return Math.max(1, Math.ceil(seconds / 60) - minutes);
}

// ---------------------------------------------------------------------------
// `How long?` (fit-to-time §3.2): what the sheet shows and what its buttons do

/** The sheet's chips (minutes); `Other` opens a wheel of 15–180 in 5-minute steps. */
export const FIT_CHIPS = [30, 45, 60, 75, 90] as const;

/** The `Other` wheel's values. */
export function fitWheelMinutes(): number[] {
  return Array.from({ length: (FIT_MINUTES.max - FIT_MINUTES.min) / FIT_MINUTES.step + 1 }, (_, i) => FIT_MINUTES.min + i * FIT_MINUTES.step);
}

export interface HowLongInput {
  /** The tile's estimate now (with any live fit), unrounded seconds; null when nothing is planned. */
  nowSeconds: number | null;
  /** The tile's minutes (the same number the tile shows). */
  nowMinutes: number | null;
  /** The plan without the live fit (`FitOutcome.beforeSeconds`), or the estimate when there is none: what a new fit starts from. */
  unfittedSeconds: number | null;
  /** The live fit's minutes, or null. */
  fitMinutes: number | null;
  /** What Ben picked in this sheet (a chip or the wheel); null: the default. */
  chosen: number | null;
  /** The coach can be asked (connected and online). */
  coachAvailable: boolean;
  /** The pace the estimate uses, for `ⓘ` (`Your pace`, its source). */
  pace?: ResolvedPace;
}

export interface HowLongSheetView {
  /** `Now ≈ 62 min`. */
  nowText: string | null;
  chips: { minutes: number; text: string; selected: boolean; accessibilityLabel: string }[];
  /** `Other` is selected when the chosen length isn't a chip. */
  other: { selected: boolean; text: string };
  selected: number;
  /** `Trim to 45 min`, or disabled `Fits already` (nothing to cut: nothing is written). */
  trim: { text: string; enabled: boolean; minutes: number };
  /** `Ask coach`, `Ask coach to fill 75 min`; disabled with `Coach offline` under it when the coach can't be reached. */
  ask: { text: string; enabled: boolean; caption: string | null; lengthen: boolean };
  /** `Clear fit`: only with a live fit. */
  clear: boolean;
  /** Behind `ⓘ` (active-workout §2.15.3): `0:50 a set · 0:45 between exercises`, and where it comes from. */
  pace: { text: string; source: string } | null;
}

/**
 * The `How long?` sheet (§3.2). Default: the live fit's length; else the
 * largest chip below the estimate; else the smallest chip. A length at or
 * above the unfitted plan's estimate turns `Trim` into `Fits already`.
 */
export function howLongSheet(i: HowLongInput): HowLongSheetView {
  const base = i.unfittedSeconds ?? i.nowSeconds ?? 0;
  const below = [...FIT_CHIPS].filter((m) => m * 60 < base);
  const selected = i.chosen ?? i.fitMinutes ?? below.at(-1) ?? FIT_CHIPS[0];
  const fitsAlready = base <= selected * 60;
  const lengthen = selected * 60 > base;
  return {
    nowText: i.nowMinutes === null ? null : `Now ≈ ${String(i.nowMinutes)} min`,
    chips: FIT_CHIPS.map((m) => ({ minutes: m, text: String(m), selected: m === selected, accessibilityLabel: `${String(m)} minutes${m === selected ? ', selected' : ''}` })),
    other: { selected: !(FIT_CHIPS as readonly number[]).includes(selected), text: (FIT_CHIPS as readonly number[]).includes(selected) ? 'Other' : String(selected) },
    selected,
    trim: fitsAlready ? { text: 'Fits already', enabled: false, minutes: selected } : { text: `Trim to ${String(selected)} min`, enabled: true, minutes: selected },
    ask: { text: lengthen ? `Ask coach to fill ${String(selected)} min` : 'Ask coach', enabled: i.coachAvailable, caption: i.coachAvailable ? null : 'Coach offline', lengthen },
    clear: i.fitMinutes !== null,
    pace: i.pace === undefined ? null : { text: `${formatDuration(Math.round(i.pace.secondsPerSet))} a set · ${formatDuration(Math.round(i.pace.changeoverSeconds))} between exercises`, source: PACE_SOURCE_LABEL[i.pace.source] },
  };
}

/** One step of the `Other` length (± 5 min), kept within 15–180. */
export function stepFitMinutes(current: number, delta: 5 | -5): number {
  return Math.min(FIT_MINUTES.max, Math.max(FIT_MINUTES.min, current + delta));
}
