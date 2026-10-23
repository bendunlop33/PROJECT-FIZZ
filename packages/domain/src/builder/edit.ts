import type { SetType } from '@fizz/schemas';
import { adviseAfter, adviseBuilder, type BuilderAdvice } from './advise';
import { BUILDER_MAX_SUPERSET, builderSupersetWithNext, builderUnlink, slotsOf } from './arrange';
import { BUILDER_VOLUME } from './build';
import { removeSlot } from './fit';
import { roundContextOf, roundDownHere } from './loads';
import { clampBuilderRest } from './rest';
import { addDropSet, BUILDER_SET_RULES, changeSetType, editSetRow, isTimedSlot, setWorkingCount, workingCount, type RowPatch, type SetRowEditRefusal } from './set-rows';
import { makeSlot } from './slot';
import type { BuilderBlock, BuilderContext, BuilderSetRow, BuilderSlot, BuilderWorkout, RestKind, RoundedLoad } from './types';
import { slotLoadOf } from './reps';

/**
 * Ben's own edits on Your workout and the exercise pop-up
 * (workout-builder-v3 §2.3–§2.5). Pure. Each returns the new workout, the
 * slots it changed (their revisions move, §4.4) and, for moves, pairs,
 * swaps and adds, the first NEW "not recommended" item (§3.8): his change
 * stays; the UI shows the advice with Undo.
 */

export type BuilderEditOp =
  | { kind: 'delete_exercise'; slotKey: string }
  | { kind: 'swap'; slotKey: string; exerciseId: string }
  | { kind: 'add_exercise'; exerciseId: string }
  | { kind: 'move'; slotKey: string; dir: 'up' | 'down' }
  | { kind: 'superset_next'; slotKey: string }
  | { kind: 'unlink'; slotKey: string }
  | { kind: 'set_type'; slotKey: string; index: number; type: SetType }
  | { kind: 'edit_row'; slotKey: string; index: number; patch: RowPatch }
  | { kind: 'delete_set'; slotKey: string; index: number }
  | { kind: 'add_warmup'; slotKey: string }
  | { kind: 'add_set'; slotKey: string }
  | { kind: 'add_drop'; slotKey: string }
  | { kind: 'rest'; slotKey: string; restKind: RestKind | 'round'; seconds: number }
  /**
   * Press-and-hold drag (§2.3, §9 Q18; workout-table-v3 §7): dropped on the top or bottom edge
   * of another row = move there (as its own round); on its middle = superset with that row's round.
   */
  | { kind: 'drop'; slotKey: string; targetKey: string; edge: 'before' | 'after' | 'onto' };

export type BuilderEditRefusal =
  | SetRowEditRefusal
  | 'no_such_exercise'
  | 'unknown_exercise'
  | 'max_exercises'
  | 'already_in_workout'
  | 'cannot_move'
  | 'cannot_superset'
  | 'not_in_superset'
  | 'max_warmups'
  | 'no_load'
  | 'no_gap';

export type BuilderEditResult =
  | {
      ok: true;
      workout: BuilderWorkout;
      /** Slot keys whose content changed (a new slot included; a removed one too). */
      changed: string[];
      advice: BuilderAdvice | null;
      /** A typed kg that moved to what this gym can load (`Why?` names the item). */
      rounded?: RoundedLoad | null;
      mayHurt?: true;
    }
  | { ok: false; reason: BuilderEditRefusal; lightest?: number };

/** Ops that are Ben's moves (§2.3 "When Ben's own change is not recommended"). */
const ADVISED: ReadonlySet<BuilderEditOp['kind']> = new Set(['swap', 'add_exercise', 'move', 'superset_next', 'drop']);

const find = (w: BuilderWorkout, key: string): { bi: number; si: number; slot: BuilderSlot } | null => {
  for (const [bi, b] of w.blocks.entries()) {
    const si = b.slots.findIndex((s) => s.key === key);
    const slot = b.slots[si];
    if (slot !== undefined) return { bi, si, slot };
  }
  return null;
};

const replace = (w: BuilderWorkout, key: string, next: BuilderSlot): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === key ? next : s)) })) });

/** `applyBuilderEdit`: one of Ben's edits, or why it can't be made (nothing changes). */
export function applyBuilderEdit(w: BuilderWorkout, op: BuilderEditOp, ctx: BuilderContext): BuilderEditResult {
  const r = edit(w, op, ctx);
  if (!r.ok || !ADVISED.has(op.kind)) return r;
  return { ...r, advice: adviseAfter(adviseBuilder(w.blocks, ctx.info), adviseBuilder(r.workout.blocks, ctx.info)) };
}

function edit(w: BuilderWorkout, op: BuilderEditOp, ctx: BuilderContext): BuilderEditResult {
  const done = (workout: BuilderWorkout, changed: string[], extra: Partial<Extract<BuilderEditResult, { ok: true }>> = {}): BuilderEditResult => ({ ok: true, workout, changed, advice: null, ...extra });
  if (op.kind === 'add_exercise') {
    if (ctx.info(op.exerciseId) === null) return { ok: false, reason: 'unknown_exercise' };
    const all = slotsOf(w.blocks);
    if (all.length >= BUILDER_VOLUME.maxExercises) return { ok: false, reason: 'max_exercises' };
    if (all.some((s) => s.exerciseId === op.exerciseId)) return { ok: false, reason: 'already_in_workout' };
    const slot: BuilderSlot = { ...makeSlot(op.exerciseId, { main: false, workingSets: BUILDER_SET_RULES.accessorySets }, ctx), touched: true };
    return done({ ...w, blocks: [...w.blocks, { slots: [slot], auto: false }] }, [slot.key]);
  }
  const at = find(w, op.slotKey);
  if (at === null) return { ok: false, reason: 'no_such_exercise' };
  const { slot } = at;
  const load = () => slotLoadOf(ctx.loads(slot.exerciseId), slot.main);
  const touched = (s: BuilderSlot): BuilderSlot => ({ ...s, touched: true });
  switch (op.kind) {
    case 'delete_exercise':
      return done(removeSlot(w, slot.key), [slot.key]);
    case 'swap': {
      if (ctx.info(op.exerciseId) === null) return { ok: false, reason: 'unknown_exercise' };
      if (op.exerciseId !== slot.exerciseId && slotsOf(w.blocks).some((s) => s.exerciseId === op.exerciseId)) return { ok: false, reason: 'already_in_workout' };
      // Keeps the position, superset and set count; loads are worked out for the new exercise (§2.5).
      let next: BuilderSlot = { ...makeSlot(op.exerciseId, { main: slot.main, workingSets: workingCount(slot) }, ctx), key: slot.key, touched: true };
      for (let d = slot.rows.filter((x) => x.type === 'drop').length; d > 0; d -= 1) {
        const dropped = addDropSet(next, ctx.loads(op.exerciseId));
        if (dropped.ok) next = dropped.slot;
      }
      if (slot.restS !== undefined) next.restS = { ...slot.restS };
      if (slot.unlinked === true) next.unlinked = true;
      if (slot.origin !== undefined) next.origin = slot.origin;
      return done(replace(w, slot.key, next), [slot.key]);
    }
    case 'move': {
      const moved = moveBuilderSlot(w.blocks, at.bi, at.si, op.dir);
      return moved === null ? { ok: false, reason: 'cannot_move' } : done({ ...w, blocks: moved }, []);
    }
    case 'superset_next': {
      const blocks = builderSupersetWithNext(w.blocks, slot.key);
      if (blocks === null) return { ok: false, reason: 'cannot_superset' };
      const keys = (blocks.find((b) => b.slots.some((s) => s.key === slot.key))?.slots ?? []).map((s) => s.key);
      return done({ ...w, blocks }, keys);
    }
    case 'drop': {
      const blocks = dropBuilderSlot(w.blocks, slot.key, op.targetKey, op.edge);
      if (blocks === null) return { ok: false, reason: op.edge === 'onto' ? 'cannot_superset' : 'cannot_move' };
      const keys = op.edge === 'onto' ? (blocks.find((b) => b.slots.some((s) => s.key === slot.key))?.slots ?? []).map((s) => s.key) : [];
      return done({ ...w, blocks }, keys);
    }
    case 'unlink': {
      const block = w.blocks[at.bi];
      const blocks = builderUnlink(w.blocks, slot.key);
      if (blocks === null) return { ok: false, reason: 'not_in_superset' };
      return done({ ...w, blocks }, (block?.slots ?? []).map((s) => s.key));
    }
    case 'set_type': {
      const r = changeSetType(slot, op.index, op.type, load());
      return r.ok ? done(replace(w, slot.key, touched(r.slot)), [slot.key]) : { ok: false, reason: r.reason };
    }
    case 'edit_row': {
      const r = editSetRow(slot, op.index, op.patch, load());
      if (!r.ok) return { ok: false, reason: r.reason, ...(r.lightest === undefined ? {} : { lightest: r.lightest }) };
      return done(replace(w, slot.key, touched(r.slot)), [slot.key], { rounded: r.rounded, ...(r.mayHurt === true ? { mayHurt: true as const } : {}) });
    }
    case 'delete_set': {
      const row = slot.rows[op.index];
      if (row === undefined) return { ok: false, reason: 'no_such_set' };
      if (row.type !== 'warmup' && workingCount(slot) <= 1) return { ok: false, reason: 'keep_one_set' };
      const rows = slot.rows.filter((_, i) => i !== op.index);
      // A drop never follows a warm-up: a drop left first becomes a working set.
      const first = rows.findIndex((x) => x.type !== 'warmup');
      const fixed = rows.map((x, i): BuilderSetRow => (i === first && x.type === 'drop' ? { ...x, type: 'working' } : x));
      return done(replace(w, slot.key, touched({ ...slot, rows: fixed })), [slot.key]);
    }
    case 'add_set': {
      if (workingCount(slot) >= BUILDER_SET_RULES.maxWorkingSets) return { ok: false, reason: 'max_sets' };
      return done(replace(w, slot.key, touched(setWorkingCount(slot, workingCount(slot) + 1))), [slot.key]);
    }
    case 'add_drop': {
      const r = addDropSet(slot, load());
      return r.ok ? done(replace(w, slot.key, touched(r.slot)), [slot.key]) : { ok: false, reason: r.reason };
    }
    case 'add_warmup': {
      const r = addWarmup(slot, ctx);
      return r.ok ? done(replace(w, slot.key, touched(r.slot)), [slot.key]) : r;
    }
    case 'rest': {
      const seconds = clampBuilderRest(op.restKind, op.seconds);
      if (op.restKind === 'round') {
        const block = w.blocks[at.bi];
        if (block === undefined || block.slots.length < 2) return { ok: false, reason: 'not_in_superset' };
        const blocks = w.blocks.map((b, i): BuilderBlock => (i === at.bi ? { ...b, roundRestS: seconds } : b));
        return done({ ...w, blocks }, block.slots.map((s) => s.key));
      }
      return done(replace(w, slot.key, touched({ ...slot, restS: { ...slot.restS, [op.restKind]: seconds } })), [slot.key]);
    }
  }
}

/**
 * `Move up` / `Move down` (§2.4): inside a superset the exercise changes
 * place with its neighbour (3a ↔ 3b); a single, or a superset's first or
 * last member moving out of it, moves the whole round past the next one.
 * Null when there's nowhere to go.
 */
export function moveBuilderSlot(blocks: readonly BuilderBlock[], bi: number, si: number, dir: 'up' | 'down'): BuilderBlock[] | null {
  const block = blocks[bi];
  if (block === undefined) return null;
  const step = dir === 'up' ? -1 : 1;
  const inside = si + step;
  if (block.slots.length > 1 && inside >= 0 && inside < block.slots.length) {
    const slots = [...block.slots];
    const a = slots[si];
    const b = slots[inside];
    if (a === undefined || b === undefined) return null;
    slots[si] = b;
    slots[inside] = a;
    return blocks.map((x, i) => (i === bi ? { ...x, slots } : x));
  }
  const to = bi + step;
  const other = blocks[to];
  if (other === undefined) return null;
  const out = [...blocks];
  out[bi] = other;
  out[to] = block;
  return out;
}

/**
 * A dragged row dropped on another (§2.3 drag; Q18): it leaves its own superset (a partner left on
 * its own stands alone; both are marked `unlinked`, as `Unlink` does), then either goes in as its
 * own round before or after the target's round, or (`onto`) joins the target's round as Ben's own
 * superset (`auto: false`). Null for a drop on itself, a drop that changes nothing, or a superset
 * the rules don't allow (the main lift, more than 4; Q5): the row springs back.
 */
export function dropBuilderSlot(blocks: readonly BuilderBlock[], slotKey: string, targetKey: string, edge: 'before' | 'after' | 'onto'): BuilderBlock[] | null {
  if (slotKey === targetKey) return null;
  const from = blocks.findIndex((b) => b.slots.some((s) => s.key === slotKey));
  const fromBlock = blocks[from];
  const slot = fromBlock?.slots.find((s) => s.key === slotKey);
  if (fromBlock === undefined || slot === undefined) return null;
  const targetBlock = blocks.find((b) => b.slots.some((s) => s.key === targetKey));
  if (targetBlock === undefined) return null;
  if (edge === 'onto' && targetBlock === fromBlock) return null;
  const wasPaired = fromBlock.slots.length > 1;
  const mark = (s: BuilderSlot): BuilderSlot => (wasPaired ? { ...s, unlinked: true } : s);
  const rest = fromBlock.slots.filter((s) => s.key !== slotKey);
  const left: BuilderBlock | null = rest.length === 0 ? null : rest.length === 1 && rest[0] !== undefined ? { slots: [mark(rest[0])], auto: false } : { ...fromBlock, slots: rest, auto: false };
  const without: BuilderBlock[] = blocks.flatMap((b) => (b === fromBlock ? (left === null ? [] : [left]) : [b]));
  const at = without.findIndex((b) => b.slots.some((s) => s.key === targetKey));
  const target = without[at];
  if (target === undefined) return null;
  const out = [...without];
  if (edge === 'onto') {
    const slots = [...target.slots, slot];
    if (slots.some((s) => s.main) || slots.length > BUILDER_MAX_SUPERSET) return null;
    const joined = slots.map((s) => {
      if (s.unlinked !== true) return s;
      const c = { ...s };
      delete c.unlinked;
      return c;
    });
    out.splice(at, 1, { ...target, slots: joined, auto: false });
  } else {
    out.splice(edge === 'before' ? at : at + 1, 0, { slots: [mark(slot)], auto: false });
  }
  const shape = (bs: readonly BuilderBlock[]) => bs.map((b) => b.slots.map((s) => s.key).join('+')).join('|');
  return shape(out) === shape(blocks) ? null : out;
}


/** Whether `＋ Warm-up` can add one (§2.4: disabled at 4, or with no load to ramp to). */
export function canAddWarmup(slot: BuilderSlot): boolean {
  return !isTimedSlot(slot) && slot.rows.filter((r) => r.type === 'warmup').length < BUILDER_SET_RULES.maxWarmups && slot.rows.some((r) => r.type !== 'warmup' && r.load !== null);
}

/**
 * The warm-up `＋ Warm-up` adds (§2.4), shared by the builder and the
 * active workout (workout-table-v3 §7): the middle of the biggest gap in the
 * ramp (from nothing, through the warm-ups there are, up to the first
 * working load), rounded DOWN by `roundDown` to what the gym can load; reps
 * by how close it sits to the working load. Null when no load fits in the gap.
 */
export function warmupGap(warmLoads: readonly number[], top: number, roundDown: (value: number) => number | null): { load: number; reps: number } | null {
  if (!(top > 0)) return null;
  const points = [0, ...[...warmLoads].filter((l) => l < top).sort((a, b) => a - b), top];
  let best: [number, number] | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] ?? 0;
    const b = points[i] ?? 0;
    if (best === null || b - a > best[1] - best[0]) best = [a, b];
  }
  if (best === null) return null;
  const k = roundDown((best[0] + best[1]) / 2);
  if (k === null || k <= best[0] + 1e-9 || k >= best[1] - 1e-9) return null;
  const pct = k / top;
  return { load: k, reps: pct < 0.4 ? 10 : pct < 0.6 ? 5 : pct < 0.8 ? 3 : 1 };
}

/**
 * `＋ Warm-up` (§2.4): fills the biggest gap in the ramp, from nothing (or
 * the lightest warm-up) up to the first working load, rounded DOWN to what
 * this gym can load. Reps by how close it sits to the working load. Max 4.
 */
export function addWarmup(slot: BuilderSlot, ctx: BuilderContext): { ok: true; slot: BuilderSlot } | { ok: false; reason: 'max_warmups' | 'no_load' | 'no_gap' | 'timed_set' } {
  if (isTimedSlot(slot)) return { ok: false, reason: 'timed_set' };
  const warm = slot.rows.filter((r) => r.type === 'warmup');
  if (warm.length >= BUILDER_SET_RULES.maxWarmups) return { ok: false, reason: 'max_warmups' };
  const top = slot.rows.find((r) => r.type !== 'warmup')?.load ?? null;
  if (top === null || top <= 0) return { ok: false, reason: 'no_load' };
  const rc = { ...roundContextOf(ctx.loads(slot.exerciseId)), painCap: null };
  const gap = warmupGap(
    warm.map((r) => r.load ?? 0),
    top,
    (v) => roundDownHere(v, rc)?.value ?? null,
  );
  if (gap === null) return { ok: false, reason: 'no_gap' };
  const row: BuilderSetRow = { type: 'warmup', reps: gap.reps, load: gap.load, rpe: null };
  const rest = slot.rows.filter((r) => r.type !== 'warmup');
  const ramp = [...warm, row].sort((a, b) => (a.load ?? 0) - (b.load ?? 0));
  return { ok: true, slot: { ...slot, rows: [...ramp, ...rest] } };
}
