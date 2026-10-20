import type { SetType } from '@fizz/schemas';
import { isBarLoaded, loadDirection } from '../equipment';
import { builderLoad, formulaApplies, loadForSet, roundDownHere, type RoundContext } from './loads';
import type { BuilderLoadSourceKind, BuilderRole, BuilderSetRow, BuilderSlot, RepRangeT, RoundedLoad, SlotLoadInput } from './types';

/**
 * Per-set rows (workout-builder-v3 §2.4, §3.1, §3.3). Pure.
 *
 * - Main lift: warm-up ramp (bar × 10 on a barbell, then 50 % × 5, 70 % × 3,
 *   85 % × 1 of the top set, each rounded down; a step no heavier than the
 *   one before is skipped; max 4), one Top set at the bottom of the range
 *   @ RPE 8, back-offs at the top of the range @ RPE 8.
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
  maxWarmups: 4,
  /** Working sets including drops (§4.7). */
  maxWorkingSets: 10,
  maxDrops: 3,
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
  source: BuilderLoadSourceKind;
  anchorE1rm: number | null;
  estimate: boolean;
  startLight: number | null;
}

const roundCtx = (load: SlotLoadInput): RoundContext => ({ unit: load.unit, convention: load.convention, equipment: load.equipment, painCap: load.painCap });
const warmCtx = (load: SlotLoadInput): RoundContext => ({ unit: load.unit, convention: load.convention, equipment: load.equipment });
const rounded = (v: number | null, ctx: RoundContext): number | null => (v === null ? null : (roundDownHere(v, ctx)?.value ?? null));

/** `setRowsFor`: the rows the builder makes for one exercise. */
export function setRowsFor(input: SetRowsInput): SetRowsResult {
  const n = Math.max(1, Math.min(R.maxWorkingSets, Math.round(input.workingSets)));
  const { min, max } = input.repRange;
  const work = builderLoad(input.load, { reps: min, rpe: R.workRpe });
  const ctx = roundCtx(input.load);
  const topLoad = rounded(work.working, ctx);
  const working: BuilderSetRow[] = input.main
    ? [
        { type: 'top', reps: min, load: topLoad, rpe: R.workRpe },
        ...Array.from({ length: n - 1 }, (): BuilderSetRow => ({ type: 'backoff', reps: max, load: rounded(loadForSet(work.anchorE1rm, work.working, max, R.workRpe), ctx), rpe: R.workRpe })),
      ]
    : Array.from({ length: n }, (_, i): BuilderSetRow => ({ type: 'working', reps: min, load: topLoad, rpe: i === n - 1 ? R.lastWorkRpe : R.workRpe }));
  const warmups = warmupsFor(input, topLoad);
  return { rows: [...warmups, ...working], source: work.source, anchorE1rm: work.anchorE1rm, estimate: work.estimate, startLight: work.startLight };
}

/** Warm-ups from the rounded working (top) load. None without a load, or for assisted lifts. */
export function warmupsFor(input: Pick<SetRowsInput, 'main' | 'role' | 'barbell' | 'load'>, top: number | null): BuilderSetRow[] {
  if (top === null || loadDirection(input.load.convention) !== 'resistance') return [];
  const ctx = warmCtx(input.load);
  const out: BuilderSetRow[] = [];
  if (input.main) {
    const eq = input.load.equipment;
    let prev = 0;
    if (input.barbell && eq !== null && isBarLoaded(eq) && eq.barMass < top) {
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

export type SetRowEditRefusal = 'keep_one_set' | 'one_top_set_only' | 'drop_needs_set_before' | 'max_drops' | 'max_sets' | 'no_such_set';

export type SetRowEdit = { ok: true; slot: BuilderSlot; rounded: RoundedLoad | null } | { ok: false; reason: SetRowEditRefusal };

const workRows = (rows: readonly BuilderSetRow[]): BuilderSetRow[] => rows.filter((r) => r.type !== 'warmup');
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
  return rounded(loadForSet(slot.anchorE1rm, working, row.reps, row.rpe ?? R.workRpe), ctx);
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

export type RowPatch = { kind: 'reps'; reps: number } | { kind: 'rpe'; rpe: number } | { kind: 'load'; value: number };

/**
 * `editSetRow`: reps or RPE recalculates kg unless Ben typed kg in that set
 * (or the lift has no formula: assisted and added weight keep their kg). A
 * typed kg is rounded down to what this gym can load; `rounded` says if it
 * moved (for `Why?`).
 */
export function editSetRow(slot: BuilderSlot, index: number, patch: RowPatch, load: SlotLoadInput): SetRowEdit {
  const row = slot.rows[index];
  if (row === undefined) return { ok: false, reason: 'no_such_set' };
  const rows = slot.rows.map((r) => ({ ...r }));
  const cur = rows[index] ?? row;
  switch (patch.kind) {
    case 'load': {
      const r = roundDownHere(patch.value, roundCtx(load));
      rows[index] = { ...cur, load: r?.value ?? null, typed: true };
      return { ok: true, slot: { ...slot, rows, touched: true }, rounded: r };
    }
    case 'reps':
      rows[index] = { ...cur, reps: Math.max(1, Math.round(patch.reps)) };
      break;
    case 'rpe':
      rows[index] = { ...cur, rpe: patch.rpe };
      break;
  }
  const next: BuilderSlot = { ...slot, rows, touched: true };
  const keep = row.typed === true || row.type === 'warmup' || !formulaApplies(load.convention) || slot.anchorE1rm === null;
  if (!keep) next.rows[index] = { ...(next.rows[index] ?? cur), load: recalcLoad(next, index, load, workingLoadOf(slot)) };
  return { ok: true, slot: next, rounded: null };
}

/**
 * `setWorkingCount`: add copies of the last working set (a Top set copies as
 * a Back-off) or remove from the end (never the Top set). 1–10 sets, drops
 * included. Straight working sets keep the last one @ RPE 9.
 */
export function setWorkingCount(slot: BuilderSlot, n: number): BuilderSlot {
  const target = Math.max(1, Math.min(R.maxWorkingSets, Math.round(n)));
  const rows = slot.rows.map((r) => ({ ...r }));
  let work = workRows(rows);
  while (work.length < target) {
    const last = work[work.length - 1];
    const copy: BuilderSetRow = last === undefined ? { type: 'working', reps: slot.repRange.min, load: null, rpe: R.workRpe } : { ...last, type: last.type === 'top' ? 'backoff' : last.type === 'drop' ? 'working' : last.type };
    rows.push(copy);
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
  if (slot.rows.filter((r) => r.type === 'drop').length >= R.maxDrops) return { ok: false, reason: 'max_drops' };
  if (workingCount(slot) >= R.maxWorkingSets) return { ok: false, reason: 'max_sets' };
  const before = slot.rows[slot.rows.length - 1];
  if (before === undefined || before.type === 'warmup') return { ok: false, reason: 'drop_needs_set_before' };
  const kg = before.load === null ? null : rounded(before.load * R.dropPct, roundCtx(load));
  const row: BuilderSetRow = { type: 'drop', reps: slot.repRange.max + R.dropRepsOver, load: kg, rpe: R.dropRpe };
  return { ok: true, slot: { ...slot, rows: [...slot.rows, row], touched: true }, rounded: null };
}
