import { BUILD_LIMITS, type LoadConvention, type SetType, type WeightUnit } from '@fizz/schemas';
import { compareDifficulty, isBarLoaded, loadDirection } from '../equipment';
import { backoffLoad, lowerWithTop } from './backoff';
import { builderLoad, convertValue, fitHere, formulaApplies, loadForSet, loadFrameOf, roundContextOf, roundDownHere, type RoundContext } from './loads';
import type { BuilderLoadSourceKind, BuilderRole, BuilderSetRow, BuilderSlot, RepRangeT, RoundedLoad, SlotLoadInput } from './types';

/**
 * Per-set rows (workout-builder-v3 §2.4, §3.1, §3.3). Pure.
 *
 * - Main lift: warm-up ramp (bar × 10 on a barbell, then 50 % × 5, 70 % × 3,
 *   85 % × 1 of the top set, each rounded down; a step no heavier than the
 *   one before is skipped; max 4), one Top set at the bottom of the range
 *   @ RPE 8, back-offs at the top of the range @ RPE 8. A back-off's load is
 *   worked out from its reps and RPE inside the focus's band below the top
 *   (D4, `backoffLoad`), so never at or above it; a lower top (a pain hold,
 *   a lighter top Ben types) lowers the back-offs by the same %.
 * - Compound accessory: one warm-up, 60 % × 8. Isolation: none.
 * - Others: working sets at the bottom of the range @ RPE 8, the last @ RPE 9
 *   at the same load.
 * - Drop: top of the range + 2 reps, RPE 9, about 78 % of the set before.
 * - One Top set per exercise; a type change recalculates that set.
 */
export const BUILDER_SET_RULES = {
  mainRange: { min: 6, max: 8 },
  accessoryRange: { min: 8, max: 12 },
  mainSets: 4,
  accessorySets: 3,
  workRpe: 8,
  lastWorkRpe: 9,
  barWarmupReps: 10,
  ramp: [
    { pct: 0.5, reps: 5 },
    { pct: 0.7, reps: 3 },
    { pct: 0.85, reps: 1 },
  ],
  compoundWarmup: { pct: 0.6, reps: 8 },
  dropPct: 0.78,
  dropRepsOver: 2,
  dropRpe: 9,
  maxWarmups: BUILD_LIMITS.maxWarmups,
  /** Working sets including drops (§4.7). */
  maxWorkingSets: BUILD_LIMITS.maxWorkingSets,
  maxDrops: BUILD_LIMITS.maxDropSets,
  /** Edit ranges, as `@fizz/schemas` (RPE 1–10 in 0.5 steps; reps 1–100). */
  minRpe: 1,
  maxRpe: 10,
  minReps: 1,
  maxReps: 100,
} as const;

const R = BUILDER_SET_RULES;

export interface SetRowsInput {
  main: boolean;
  role: BuilderRole;
  /** Loaded on a barbell (bar × 10 warm-up when the item is bar-loaded). */
  barbell: boolean;
  /** Non-warm-up sets. Main lift: 1 top set + the rest back-offs. */
  workingSets: number;
  repRange: RepRangeT;
  load: SlotLoadInput;
}

export interface SetRowsResult {
  rows: BuilderSetRow[];
  /** Unit and convention of every row's load (the item's; review B1). */
  unit: WeightUnit;
  convention: LoadConvention;
  source: BuilderLoadSourceKind;
  anchorE1rm: number | null;
  estimate: boolean;
  startLight: number | null;
}

const roundCtx = (load: SlotLoadInput): RoundContext => roundContextOf(load);
const warmCtx = (load: SlotLoadInput): RoundContext => ({ ...roundContextOf(load), painCap: null });
const rounded = (v: number | null, ctx: RoundContext): number | null => (v === null ? null : (roundDownHere(v, ctx)?.value ?? null));

/** `setRowsFor`: the rows the builder makes for one exercise. */
export function setRowsFor(input: SetRowsInput): SetRowsResult {
  const n = Math.max(1, Math.min(R.maxWorkingSets, Math.round(input.workingSets)));
  const { min, max } = input.repRange;
  const work = builderLoad(input.load, { reps: min, rpe: R.workRpe });
  const ctx = roundCtx(input.load);
  const topLoad = rounded(work.working, ctx);
  // (D4) The band is measured from the top as worked out here; a pain hold that lowers the top lowers the back-offs by the same %.
  const topHere = rounded(work.working, { ...ctx, painCap: null });
  const backoff = rounded(backoffHere({ anchorE1rm: work.anchorE1rm, working: work.working, reps: max, rpe: R.workRpe }, topHere, topLoad, input.load), ctx);
  const working: BuilderSetRow[] = input.main
    ? [
        { type: 'top', reps: min, load: topLoad, rpe: R.workRpe },
        ...Array.from({ length: n - 1 }, (): BuilderSetRow => ({ type: 'backoff', reps: max, load: backoff, rpe: R.workRpe })),
      ]
    : Array.from({ length: n }, (_, i): BuilderSetRow => ({ type: 'working', reps: min, load: topLoad, rpe: i === n - 1 ? R.lastWorkRpe : R.workRpe }));
  const warmups = warmupsFor(input, topLoad);
  // No load came out (no item here, below its lightest): say so, not the source's name (review B2).
  const loaded = working.some((r) => r.load !== null);
  const startLight = loaded ? null : (work.startLight ?? (input.load.startLightCeiling === null ? null : convertValue(input.load.startLightCeiling, input.load.unit, work.unit)));
  return {
    rows: [...warmups, ...working],
    unit: work.unit,
    convention: work.convention,
    source: loaded ? work.source : 'none',
    anchorE1rm: loaded ? work.anchorE1rm : null,
    estimate: loaded && work.estimate,
    startLight,
  };
}

/**
 * (D4) A back-off's load before rounding: from its reps and RPE inside the focus's band below `topHere` (the top as
 * worked out here), then, when today's top (`topNow`: pain-held, or Ben's lighter kg) is lower, lower by the same %.
 * No formula (assisted, added weight): the working kg, as before.
 */
function backoffHere(set: { anchorE1rm: number | null; working: number | null; reps: number; rpe: number }, topHere: number | null, topNow: number | null, load: SlotLoadInput): number | null {
  const raw = backoffLoad({ ...set, top: topHere, focus: load.mainFocus });
  return set.anchorE1rm === null ? raw : lowerWithTop(raw, topHere, topNow);
}

/** Warm-ups from the rounded working (top) load. None without a load, or for assisted lifts. */
export function warmupsFor(input: Pick<SetRowsInput, 'main' | 'role' | 'barbell' | 'load'>, top: number | null): BuilderSetRow[] {
  const frame = loadFrameOf(input.load);
  // Warm-ups ramp on a real item with the reps/RPE formula: not assisted, added weight or bodyweight.
  if (top === null || frame.kind !== 'item' || frame.added || !formulaApplies(frame.convention) || loadDirection(frame.convention) !== 'resistance') return [];
  const ctx = warmCtx(input.load);
  const out: BuilderSetRow[] = [];
  if (input.main) {
    const eq = frame.equipment;
    let prev = 0;
    if (input.barbell && isBarLoaded(eq) && eq.barMass < top) {
      out.push({ type: 'warmup', reps: R.barWarmupReps, load: eq.barMass, rpe: null });
      prev = eq.barMass;
    }
    for (const step of R.ramp) {
      if (out.length >= R.maxWarmups) break;
      const k = roundDownHere(top * step.pct, ctx)?.value ?? null;
      if (k === null || k <= prev + 1e-9 || k >= top - 1e-9) continue;
      out.push({ type: 'warmup', reps: step.reps, load: k, rpe: null });
      prev = k;
    }
    return out;
  }
  if (input.role !== 'compound') return [];
  const k = roundDownHere(top * R.compoundWarmup.pct, ctx)?.value ?? null;
  return k === null || k >= top - 1e-9 ? [] : [{ type: 'warmup', reps: R.compoundWarmup.reps, load: k, rpe: null }];
}

// ---------------------------------------------------------------------------
// Edits (§2.4): type change, reps/RPE/kg edit, set count, drop

export type SetRowEditRefusal =
  | 'keep_one_set'
  | 'one_top_set_only'
  | 'drop_needs_set_before'
  | 'max_drops'
  | 'max_sets'
  | 'no_such_set'
  /** RPE outside 1–10 or not in 0.5 steps (review S4). */
  | 'rpe_out_of_range'
  /** Reps outside 1–100 (review S4). */
  | 'reps_out_of_range'
  /** A typed kg that is negative or not a number. */
  | 'load_out_of_range'
  /** A typed kg the item can't make without going harder (below a stack's lightest, more assistance than it has): `lightest` is the easiest load here (review S3). */
  | 'lightest_is_harder'
  /** No item here to load (an equipped lift whose item isn't at this gym). */
  | 'not_loadable'
  /** (22 Oct) A timed or cardio set (a library workout's plank, a ride): shown and started as saved, not edited here. */
  | 'timed_set';

export type SetRowEdit =
  | {
      ok: true;
      slot: BuilderSlot;
      rounded: RoundedLoad | null;
      /** A typed kg heavier than the pain hold: kept, shown with `May hurt` (§2.3, review S2). */
      mayHurt?: true;
    }
  | { ok: false; reason: SetRowEditRefusal; lightest?: number };

const validRpe = (rpe: number): boolean => Number.isFinite(rpe) && rpe >= R.minRpe && rpe <= R.maxRpe && Math.abs(rpe * 2 - Math.round(rpe * 2)) < 1e-9;
const validReps = (reps: number): boolean => Number.isFinite(reps) && Math.round(reps) >= R.minReps && Math.round(reps) <= R.maxReps;

const workRows = (rows: readonly BuilderSetRow[]): BuilderSetRow[] => rows.filter((r) => r.type !== 'warmup');

/** (22 Oct) A set counted in time or distance (a plank, a ride), not reps. */
export function isTimedRow(r: Pick<BuilderSetRow, 'durationS' | 'distanceM'>): boolean {
  return r.durationS !== undefined || r.distanceM !== undefined;
}

/**
 * (22 Oct) A slot with a timed or cardio set: Your workout shows it, counts its time and starts it exactly as saved;
 * its sets aren't edited, retyped, ramped or re-derived here (set count, delete, move, swap and remove still work).
 */
export function isTimedSlot(slot: Pick<BuilderSlot, 'rows'>): boolean {
  return slot.rows.some(isTimedRow);
}
const topLoadOf = (slot: BuilderSlot): number | null => {
  const t = slot.rows.find((r) => r.type === 'top') ?? workRows(slot.rows)[0];
  return t?.load ?? null;
};

/** Recalculate one row's kg from its type, reps and RPE (never a typed kg). */
function recalcLoad(slot: BuilderSlot, i: number, load: SlotLoadInput, working: number | null): number | null {
  const row = slot.rows[i];
  if (row === undefined) return null;
  const ctx = roundCtx(load);
  if (row.type === 'warmup') return null;
  if (row.type === 'drop') {
    const before = slot.rows[i - 1]?.load ?? null;
    return before === null ? null : rounded(before * R.dropPct, ctx);
  }
  // (D4) A back-off from its reps and RPE, inside the band below the slot's top set as it is now.
  if (row.type === 'backoff') return rounded(backoffLoad({ anchorE1rm: slot.anchorE1rm, working, reps: row.reps, rpe: row.rpe ?? R.workRpe, top: topNowOf(slot, load, working), focus: load.mainFocus }), ctx);
  return rounded(loadForSet(slot.anchorE1rm, working, row.reps, row.rpe ?? R.workRpe), ctx);
}

/**
 * (D4) The slot's top set's kg now: its load, or (a set just made Top, not worked out yet) its load from its reps and
 * RPE. Null with no Top set (no band then) or no formula.
 */
function topNowOf(slot: BuilderSlot, load: SlotLoadInput, working: number | null): number | null {
  const t = slot.rows.find((r) => r.type === 'top');
  if (t === undefined) return null;
  if (t.load !== null || t.typed === true) return t.load;
  return rounded(loadForSet(slot.anchorE1rm, working, t.reps, t.rpe ?? R.workRpe), roundCtx(load));
}

/** The slot's working kg for the no-formula case: its top set, else its first working set. */
function workingLoadOf(slot: BuilderSlot): number | null {
  return topLoadOf(slot);
}

/**
 * `changeSetType`: one Top set per exercise (choosing Top set on another set
 * turns the old one into a Back-off), and the changed set is recalculated
 * with its type's reps and RPE. At least one non-warm-up set stays.
 */
export function changeSetType(slot: BuilderSlot, index: number, type: SetType, load: SlotLoadInput): SetRowEdit {
  const row = slot.rows[index];
  if (row === undefined) return { ok: false, reason: 'no_such_set' };
  if (isTimedSlot(slot)) return { ok: false, reason: 'timed_set' };
  if (row.type === type) return { ok: true, slot, rounded: null };
  if (type === 'warmup' && workRows(slot.rows).length <= 1) return { ok: false, reason: 'keep_one_set' };
  if (type === 'drop') {
    const before = slot.rows[index - 1];
    if (before === undefined || before.type === 'warmup') return { ok: false, reason: 'drop_needs_set_before' };
    if (slot.rows.filter((r) => r.type === 'drop').length >= R.maxDrops) return { ok: false, reason: 'max_drops' };
  }
  const { min, max } = slot.repRange;
  const rows = slot.rows.map((r) => ({ ...r }));
  const ctx = roundCtx(load);
  const working = workingLoadOf(slot);
  const fresh = (t: SetType): BuilderSetRow => {
    switch (t) {
      case 'top':
      case 'working':
        return { type: t, reps: min, load: null, rpe: R.workRpe };
      case 'backoff':
        return { type: t, reps: max, load: null, rpe: R.workRpe };
      case 'drop':
        return { type: t, reps: max + R.dropRepsOver, load: null, rpe: R.dropRpe };
      case 'warmup':
        return { type: t, reps: R.ramp[0].reps, load: null, rpe: null };
    }
  };
  if (type === 'top') {
    const old = rows.findIndex((r) => r.type === 'top');
    if (old >= 0) rows[old] = fresh('backoff');
  }
  rows[index] = fresh(type);
  let next: BuilderSlot = { ...slot, rows, touched: true };
  // Recalculate the changed row and any old top set turned back-off (warm-up from the top set).
  next = {
    ...next,
    rows: next.rows.map((r, i) => {
      if (r.load !== null || r.typed === true) return r;
      if (r.type === 'warmup') return { ...r, load: working === null ? null : rounded(working * R.ramp[0].pct, { ...ctx, painCap: null }) };
      return { ...r, load: recalcLoad(next, i, load, working) };
    }),
  };
  return { ok: true, slot: next, rounded: null };
}

/** A typed `load` is in the slot's unit unless `unit` says otherwise. */
export type RowPatch = { kind: 'reps'; reps: number } | { kind: 'rpe'; rpe: number } | { kind: 'load'; value: number; unit?: WeightUnit };

/**
 * `editSetRow`: reps or RPE recalculates kg unless Ben typed kg in that set
 * (or the lift has no formula: assisted and added weight keep their kg). A
 * typed kg is rounded down to what this gym can load; `rounded` says if it
 * moved (for `Why?`). A typed kg is never capped by the pain hold: it
 * stays, with `mayHurt` (§2.3). Below the item's lightest load, or out of
 * range, the edit is refused and nothing changes.
 */
export function editSetRow(slot: BuilderSlot, index: number, patch: RowPatch, load: SlotLoadInput): SetRowEdit {
  const row = slot.rows[index];
  if (row === undefined) return { ok: false, reason: 'no_such_set' };
  if (isTimedRow(row)) return { ok: false, reason: 'timed_set' };
  const rows = slot.rows.map((r) => ({ ...r }));
  const cur = rows[index] ?? row;
  switch (patch.kind) {
    case 'load': {
      if (!Number.isFinite(patch.value) || patch.value < 0) return { ok: false, reason: 'load_out_of_range' };
      const ctx = roundCtx(load);
      const value = convertValue(patch.value, patch.unit ?? slot.unit, ctx.unit);
      const r = fitHere(value, { ...ctx, painCap: null });
      if (!r.ok) return r.reason === 'lightest_is_harder' ? { ok: false, reason: 'lightest_is_harder', ...(r.lightest === null ? {} : { lightest: r.lightest }) } : { ok: false, reason: 'not_loadable' };
      const plain: BuilderSetRow = { ...cur, load: r.load.value, typed: true };
      delete plain.roundedFrom;
      rows[index] = { ...plain, ...(r.load.rounded ? { roundedFrom: convertValue(value, ctx.unit, slot.unit) } : {}) };
      // (D4, HT8) A lighter top: the back-offs drop by the same %, rounded down (Ben's own kg kept). A heavier one leaves them.
      // A saved workout's own back-offs (no formula anchor) drop the same way; assisted and added weight keep theirs.
      if (row.type === 'top' && row.load !== null && formulaApplies(ctx.convention)) lowerBackoffs(rows, row.load, convertValue(r.load.value, r.load.unit, slot.unit), ctx);
      const cap = ctx.painCap ?? null;
      const mayHurt = cap !== null && compareDifficulty(r.load.value, cap, loadDirection(ctx.convention)) > 0;
      return { ok: true, slot: { ...slot, rows, touched: true }, rounded: r.load, ...(mayHurt ? { mayHurt: true as const } : {}) };
    }
    case 'reps': {
      if (!validReps(patch.reps)) return { ok: false, reason: 'reps_out_of_range' };
      // Ben set the reps: a saved range on this set becomes his number (R1).
      const fixed: BuilderSetRow = { ...cur, reps: Math.round(patch.reps) };
      delete fixed.repsMax;
      rows[index] = fixed;
      break;
    }
    case 'rpe':
      if (row.type === 'warmup' || !validRpe(patch.rpe)) return { ok: false, reason: 'rpe_out_of_range' };
      rows[index] = { ...cur, rpe: patch.rpe };
      break;
  }
  const next: BuilderSlot = { ...slot, rows, touched: true };
  const keep = row.typed === true || row.type === 'warmup' || !formulaApplies(load.convention) || slot.anchorE1rm === null;
  if (!keep) next.rows[index] = { ...(next.rows[index] ?? cur), load: recalcLoad(next, index, load, workingLoadOf(slot)) };
  return { ok: true, slot: next, rounded: null };
}

/**
 * (D4, HT8) Today's top lowered from `from` to `to` (the slot's unit): each back-off Ben didn't type drops by the same
 * %, rounded down here, and a drop set after a lowered set follows it (~78 %). In place; nothing moves when `to` isn't
 * lower.
 */
function lowerBackoffs(rows: BuilderSetRow[], from: number, to: number, ctx: RoundContext): void {
  if (!(to < from)) return;
  const moved = new Set<number>();
  rows.forEach((r, i) => {
    if (r.type === 'backoff' && r.typed !== true && r.load !== null) {
      rows[i] = { ...r, load: rounded(lowerWithTop(r.load, from, to), ctx) };
      moved.add(i);
    } else if (r.type === 'drop' && r.typed !== true && moved.has(i - 1)) {
      const before = rows[i - 1]?.load ?? null;
      rows[i] = { ...r, load: before === null ? null : rounded(before * R.dropPct, ctx) };
      moved.add(i);
    }
  });
}

/**
 * `setWorkingCount`: add copies of the last working set (not a drop; a Top
 * set copies as a Back-off), placed before any drops at the end so a drop
 * still follows the last set; or remove from the end (trailing drops first,
 * never the Top set, so a drop never loses the set it follows). 1–10 sets,
 * drops included. Straight working sets keep the last one @ RPE 9.
 */
export function setWorkingCount(slot: BuilderSlot, n: number, load?: SlotLoadInput): BuilderSlot {
  const target = Math.max(1, Math.min(R.maxWorkingSets, Math.round(n)));
  const rows = slot.rows.map((r) => ({ ...r }));
  let work = workRows(rows);
  while (work.length < target) {
    const last = [...work].reverse().find((r) => r.type !== 'drop');
    const copy: BuilderSetRow =
      last === undefined ? { type: 'working', reps: slot.repRange.min, load: null, rpe: R.workRpe } : last.type === 'top' ? backoffFromTop(slot, last, load) : { ...last };
    let at = rows.length;
    while (at > 0 && rows[at - 1]?.type === 'drop') at -= 1;
    rows.splice(at, 0, copy);
    work = workRows(rows);
  }
  while (work.length > target) {
    const drop = [...work].reverse().find((r) => r.type !== 'top') ?? work[work.length - 1];
    if (drop === undefined) break;
    rows.splice(rows.indexOf(drop), 1);
    work = workRows(rows);
  }
  return { ...slot, rows: lastAtNine(rows) };
}

/**
 * A Top set copied as a Back-off (`setWorkingCount`): with the slot's load inputs, its kg is worked out by the back-off
 * rule below the top (D4), not the top's own kg; without them (or no formula), a copy as before.
 */
function backoffFromTop(slot: BuilderSlot, top: BuilderSetRow, load: SlotLoadInput | undefined): BuilderSetRow {
  const copy: BuilderSetRow = { ...top, type: 'backoff' };
  if (load === undefined || slot.anchorE1rm === null || top.load === null || !formulaApplies(load.convention)) return copy;
  delete copy.typed;
  delete copy.roundedFrom;
  return { ...copy, load: rounded(backoffLoad({ anchorE1rm: slot.anchorE1rm, working: top.load, reps: top.reps, rpe: top.rpe ?? R.workRpe, top: top.load, focus: load.mainFocus }), roundCtx(load)) };
}

/** Straight working sets with default effort: all @ 8 and the last @ 9 (§3.1.4). Ben's own RPEs are left alone. */
function lastAtNine(rows: BuilderSetRow[]): BuilderSetRow[] {
  const straight = rows.filter((r) => r.type === 'working');
  if (straight.length === 0 || rows.some((r) => r.type === 'top') || straight.some((r) => r.rpe !== R.workRpe && r.rpe !== R.lastWorkRpe)) return rows;
  const last = straight[straight.length - 1];
  return rows.map((r) => (r.type !== 'working' ? r : { ...r, rpe: r === last ? R.lastWorkRpe : R.workRpe }));
}

/** Working (non-warm-up) sets in a slot. */
export function workingCount(slot: Pick<BuilderSlot, 'rows'>): number {
  return workRows(slot.rows).length;
}

/** `＋ drop`: a drop set after the last set, ~78 % of it, rounded down. Max 3 per exercise, 10 sets in all. */
export function addDropSet(slot: BuilderSlot, load: SlotLoadInput): SetRowEdit {
  if (isTimedSlot(slot)) return { ok: false, reason: 'timed_set' };
  if (slot.rows.filter((r) => r.type === 'drop').length >= R.maxDrops) return { ok: false, reason: 'max_drops' };
  if (workingCount(slot) >= R.maxWorkingSets) return { ok: false, reason: 'max_sets' };
  const before = slot.rows[slot.rows.length - 1];
  if (before === undefined || before.type === 'warmup') return { ok: false, reason: 'drop_needs_set_before' };
  const kg = before.load === null ? null : rounded(before.load * R.dropPct, roundCtx(load));
  const row: BuilderSetRow = { type: 'drop', reps: slot.repRange.max + R.dropRepsOver, load: kg, rpe: R.dropRpe };
  return { ok: true, slot: { ...slot, rows: [...slot.rows, row], touched: true }, rounded: null };
}

/**
 * (Rule 4) A timed or cardio slot at another gym: its times and distances as saved; a load it carries (a weighted
 * plank, a carry) rounded down to what this gym's item makes, never past its max, and held on pain (rule 9). A load
 * nothing here can make, or in another convention, is dropped (no load target), never kept from the old gym. Pure.
 */
function timedLoadsHere(slot: BuilderSlot, load: SlotLoadInput): BuilderSlot {
  if (!slot.rows.some((r) => r.load !== null)) return slot;
  const ctx = roundCtx(load);
  const same = ctx.convention === slot.convention;
  const rows = slot.rows.map((r): BuilderSetRow => {
    if (r.load === null) return r;
    const plain: BuilderSetRow = { ...r, load: same ? rounded(convertValue(r.load, slot.unit, ctx.unit), ctx) : null };
    delete plain.typed;
    delete plain.roundedFrom;
    return plain;
  });
  return { ...slot, rows, unit: ctx.unit, convention: ctx.convention };
}

/**
 * `reloadSlotLoads` (§2.3 `Gym changed`): one slot's loads worked out again
 * on another gym's item, keeping Ben's rows (types, reps, RPE, set count).
 * Every calculated load is re-derived and rounded down there; a kg Ben
 * typed stays when that exact weight exists there, else it's recalculated;
 * warm-ups are made again from the new top set. Pure.
 */
export function reloadSlotLoads(slot: BuilderSlot, info: Pick<SetRowsInput, 'role' | 'barbell'>, load: SlotLoadInput): BuilderSlot {
  // (22 Oct) A timed or cardio slot keeps its saved sets: there is no reps formula to work its loads out from.
  if (isTimedSlot(slot)) return timedLoadsHere(slot, load);
  const fresh = setRowsFor({ main: slot.main, role: info.role, barbell: info.barbell, workingSets: workingCount(slot), repRange: slot.repRange, load });
  const ctx = roundCtx(load);
  const typedHere = (v: number): boolean => {
    const r = fitHere(convertValue(v, slot.unit, ctx.unit), { ...ctx, painCap: null });
    return r.ok && Math.abs(r.load.value - convertValue(v, slot.unit, r.load.unit)) < 1e-6;
  };
  const next: BuilderSlot = { ...slot, unit: fresh.unit, convention: fresh.convention, source: fresh.source, anchorE1rm: fresh.anchorE1rm, startLight: fresh.startLight };
  delete next.historyVersion;
  // Worked out again here: what it was opened on no longer explains these loads (R3).
  delete next.why;
  if (load.historyVersion != null) next.historyVersion = load.historyVersion;
  const work = builderLoad(load, { reps: slot.repRange.min, rpe: R.workRpe });
  const kept = (r: BuilderSetRow): boolean => r.typed === true && r.load !== null && slot.unit === fresh.unit && slot.convention === fresh.convention && typedHere(r.load);
  const byFormula = (r: BuilderSetRow, c: RoundContext): number | null => rounded(loadForSet(work.anchorE1rm, work.working, r.reps, r.rpe ?? R.workRpe), c);
  // (D4) Back-offs: the band is measured from the top set as worked out here; today's top (Ben's kg kept here, or a
  // pain hold) lower than that lowers them by the same %.
  const topRow = slot.rows.find((r) => r.type === 'top');
  const topHere = topRow === undefined ? null : byFormula(topRow, { ...ctx, painCap: null });
  const topNow = topRow === undefined ? null : kept(topRow) ? topRow.load : byFormula(topRow, ctx);
  const rows: BuilderSetRow[] = [];
  for (const r of slot.rows) {
    if (r.type === 'warmup') continue;
    if (kept(r)) {
      rows.push({ ...r });
      continue;
    }
    const before = rows[rows.length - 1];
    const kg =
      r.type === 'drop'
        ? before?.load == null
          ? null
          : rounded(before.load * R.dropPct, ctx)
        : r.type === 'backoff'
          ? rounded(backoffHere({ anchorE1rm: work.anchorE1rm, working: work.working, reps: r.reps, rpe: r.rpe ?? R.workRpe }, topHere, topNow, load), ctx)
          : byFormula(r, ctx);
    const plain: BuilderSetRow = { ...r, load: fresh.source === 'none' ? null : kg };
    delete plain.typed;
    delete plain.roundedFrom;
    rows.push(plain);
  }
  const top = (rows.find((x) => x.type === 'top') ?? rows[0])?.load ?? null;
  // Warm-ups follow the new top set (none if Ben had removed them).
  const warm = slot.rows.some((x) => x.type === 'warmup') ? warmupsFor({ main: slot.main, role: info.role, barbell: info.barbell, load }, top) : [];
  next.rows = [...warm, ...rows];
  return next;
}
