import type {
  SetType as SetTemplateType,
  DraftBasis,
  PreStartDraft,
  Routine,
  RoutineExercise,
  SessionAggregate,
  SessionTodayEdits,
  TodayEdit,
  TodayEditRemoved,
  ZonedTimestamp,
} from '@fizz/schemas';
import { MAX_DRAFT_EDITS, MAX_DRAFT_OPS } from '@fizz/schemas';
import { addDays, localDateOf, localMidnightUtcMs } from '../calendar';
import { deriveId } from '../stable';
import { toIso, toMs } from '../time';
import { blockSets, partRootOf } from './gym-switch';
import { nextPendingSet } from './order';
import { startWorkoutFromSession, type RepeatInput, type RepeatOutput } from './repeat';
import { planRoutineStart, type RoutineStartInput, type RoutineStartOutput } from './routines';
import { swapEquipmentId, type SwapPlan } from './swap-plan';

/**
 * Today's edits before Start (overview-today-edits.md, ADR 0022). Pure.
 *
 * - The draft's lifecycle: one open draft per basis, versioned writes with
 *   operation IDs, and the expiry at the next local midnight in the draft's
 *   own time zone (TE5).
 * - `resolveTodayEdits`: which edits still apply to the plan as it is now
 *   (`applied`, `stale` or `redundant`).
 * - `applyTodayEdits`: rewrites the **start input** (the routine or the
 *   source workout, plus the targets) before the unchanged planner runs.
 * - `planWithTodayEdits`: the one path for both the overview's dry run and
 *   Start, so what the page shows is what Start creates (OV3, TE2).
 *
 * Edits never carry a load: a swap's targets come from the substitute's own
 * history (`substituteTargets`), re-planned on every read, so a gym change
 * re-fits them (GS2). No AI is involved anywhere here.
 */

// ---------------------------------------------------------------------------
// Lifecycle

/** `routine:<id>` / `next:<id>`: the key of the one open draft per basis. */
export function draftBasisKey(basis: DraftBasis): string {
  return basis.kind === 'routine' ? `routine:${basis.routineId}` : `next:${basis.sourceSessionId}`;
}

export function sameBasis(a: DraftBasis, b: DraftBasis): boolean {
  return draftBasisKey(a) === draftBasisKey(b);
}

/** The next local midnight in `tz` after `atUtc`, as a UTC instant (TE5). */
export function nextLocalMidnightUtc(atUtc: string, tz: string): string {
  const ms = toMs(atUtc);
  return toIso(localMidnightUtcMs(addDays(localDateOf(ms, tz), 1), tz));
}

/** Open and not yet past its midnight. */
export function draftIsLive(draft: Pick<PreStartDraft, 'status' | 'expiresAtUtc'>, nowUtc: string): boolean {
  return draft.status === 'open' && toMs(nowUtc) < toMs(draft.expiresAtUtc);
}

/** Edits not removed, in the order they were made. */
export function liveEdits(edits: readonly TodayEdit[]): TodayEdit[] {
  return edits.filter((e) => e.removed === null);
}

/** What one draft write asks for. Ben's taps only; nothing here is ever proposed by the coach. */
export type DraftCommand =
  | { type: 'edit'; edit: { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } | { kind: 'order'; slotKeys: readonly string[] } }
  /** Undo one edit (toast `Undo`, `Bring back`): a swap or order it replaced comes back (one step). */
  | { type: 'undo'; editId: string }
  /**
   * Back to the plan on one slot (`Undo swap`, or `<original> · planned` in
   * `Swap again`): the live swap is removed and none it replaced comes back,
   * however many swaps were chained on the slot.
   */
  | { type: 'clear_swap'; slotKey: string }
  /** `Reset today's edits`: every live edit removed; the draft stays open so Undo can restore them. */
  | { type: 'reset' }
  /** `Reset order`. */
  | { type: 'clear_order' }
  /**
   * Bring back removed edits as new copies (Undo of a Reset, an Undo, or a
   * template change's Undo). `keepLive`: an edit whose slot (or the order)
   * already has a newer live edit stays removed, so a later choice of Ben's
   * is never replaced without a word (the template change's Undo).
   */
  | { type: 'restore'; editIds: readonly string[]; keepLive?: boolean };

export interface DraftWriteInput {
  /** The open, unexpired draft for this basis, or null when there is none. */
  current: PreStartDraft | null;
  /** The version the caller saw; null when it saw no draft. */
  expectedVersion: number | null;
  opId: string;
  at: ZonedTimestamp;
  ownerId: string;
  basis: DraftBasis;
  /** The ID a new draft gets (the first edit creates it). */
  newDraftId: string;
  /** The plan's slots now, in plan order (`TodaySlot`), to check the edit against. */
  slots: readonly TodaySlot[];
  /** Edits the latest plan found stale or redundant: marked removed in the same write (ADR 0022 §2). */
  prune?: readonly { editId: string; why: 'stale' | 'redundant' }[];
  command: DraftCommand;
}

export type DraftChange =
  | {
      kind: 'write';
      next: PreStartDraft;
      expectedVersion: number | null;
      /** Edits this write added (the new edit, or restored copies). */
      added: string[];
      /** Edits this write removed (not counting `prune`). */
      removed: string[];
    }
  /** This operation already wrote (a retry): nothing to save. */
  | { kind: 'duplicate'; current: PreStartDraft }
  /** Nothing to change (the edit is already in place, or there is nothing to undo or reset). */
  | { kind: 'unchanged'; current: PreStartDraft | null }
  /** The draft moved since the caller read it (rule 5): nothing is written. */
  | { kind: 'stale'; current: PreStartDraft | null }
  | { kind: 'invalid'; reason: 'slot_gone' | 'last_exercise' | 'bad_order' | 'not_found' | 'too_many' | 'in_plan' };

/** One plan slot as edits see it: its key, its exercise and its superset group (today's, after skips). */
export interface TodaySlot {
  slotKey: string;
  exerciseId: string;
  supersetGroup: string | null;
}

const editIdOf = (opId: string, n: number): string => deriveId(`today-edit:${opId}:${String(n)}`);

/** Whether two edits change the same thing (a newer one replaces an older one). */
function sameTarget(a: TodayEdit, b: Pick<TodayEdit, 'kind'> & { slotKey?: string }): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'order') return true;
  return a.slotKey === b.slotKey;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Supersets stay together: every group's members are next to each other. */
export function keepsGroupsTogether(order: readonly string[], slots: readonly TodaySlot[]): boolean {
  const groupOf = new Map(slots.map((s) => [s.slotKey, s.supersetGroup]));
  const seen = new Set<string>();
  let prev: string | null = null;
  for (const key of order) {
    const g = groupOf.get(key) ?? null;
    if (g !== null && g !== prev && seen.has(g)) return false;
    if (g !== null) seen.add(g);
    prev = g;
  }
  return true;
}

function validOrder(order: readonly string[], slots: readonly TodaySlot[]): boolean {
  const keys = slots.map((s) => s.slotKey);
  return order.length === keys.length && new Set(order).size === order.length && order.every((k) => keys.includes(k)) && keepsGroupsTogether(order, slots);
}

/**
 * One versioned, idempotent draft write (ADR 0022 §3). A repeated `opId`
 * returns the draft as it is; a version that moved writes nothing. The first
 * edit creates the draft (`expectedVersion: null`). Every write moves the
 * expiry to the next local midnight after it, in the write's time zone.
 */
export function applyDraftCommand(input: DraftWriteInput): DraftChange {
  const { current, at, opId } = input;
  if (current !== null && current.opIds.includes(opId)) return { kind: 'duplicate', current };
  if ((current?.version ?? null) !== input.expectedVersion) return { kind: 'stale', current };

  const slotKeys = new Set(input.slots.map((s) => s.slotKey));
  const edits: TodayEdit[] = [...(current?.edits ?? [])];
  const removedAt = (why: TodayEditRemoved['why']): TodayEditRemoved => ({ atUtc: at.utc, opId, why });
  const remove = (editId: string, why: TodayEditRemoved['why']) => {
    const i = edits.findIndex((e) => e.editId === editId);
    const e = edits[i];
    if (e !== undefined && e.removed === null) edits[i] = { ...e, removed: removedAt(why) };
  };
  for (const p of input.prune ?? []) remove(p.editId, p.why);

  const added: string[] = [];
  const removed: string[] = [];
  let n = 0;
  const live = () => liveEdits(edits);
  /** Append a new edit (or a copy of an earlier one), replacing any live edit of the same target. */
  const append = (body: { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } | { kind: 'order'; slotKeys: string[] }, replaces: string | null) => {
    const editId = editIdOf(opId, n);
    n += 1;
    edits.push({ ...body, editId, opId, atUtc: at.utc, replacesEditId: replaces, removed: null });
    added.push(editId);
  };

  const cmd = input.command;
  switch (cmd.type) {
    case 'edit': {
      const e = cmd.edit;
      if (e.kind === 'order') {
        // Today's superset groups: a group left with one member after skips is no longer kept together.
        const skippedNow = new Map(live().flatMap((x) => (x.kind === 'skip' ? [[x.slotKey, x.editId] as const] : [])));
        const keepNow = keptGroups(input.slots, skippedNow);
        const todayGroups = input.slots.map((x) => ({ ...x, supersetGroup: x.supersetGroup !== null && keepNow.has(x.supersetGroup) ? x.supersetGroup : null }));
        if (!validOrder(e.slotKeys, todayGroups)) return { kind: 'invalid', reason: 'bad_order' };
        const prev = live().find((x) => x.kind === 'order');
        const base = input.slots.map((s) => s.slotKey);
        if (prev?.kind === 'order' && sameOrder(prev.slotKeys, e.slotKeys)) return { kind: 'unchanged', current };
        if (prev === undefined && sameOrder(base, e.slotKeys)) return { kind: 'unchanged', current };
        if (prev !== undefined) remove(prev.editId, 'replaced');
        append({ kind: 'order', slotKeys: [...e.slotKeys] }, prev?.editId ?? null);
        break;
      }
      if (!slotKeys.has(e.slotKey)) return { kind: 'invalid', reason: 'slot_gone' };
      const prev = live().find((x) => sameTarget(x, e));
      if (e.kind === 'skip') {
        if (prev !== undefined) return { kind: 'unchanged', current };
        const skipped = new Set(live().flatMap((x) => (x.kind === 'skip' ? [x.slotKey] : [])));
        // The last exercise left can't be skipped: Start always has something to do (§2.2).
        if (input.slots.filter((s) => !skipped.has(s.slotKey) && s.slotKey !== e.slotKey).length === 0) return { kind: 'invalid', reason: 'last_exercise' };
        append({ kind: 'skip', slotKey: e.slotKey }, null);
        break;
      }
      if (prev?.kind === 'swap' && prev.toExerciseId === e.toExerciseId) return { kind: 'unchanged', current };
      // Never an exercise already in today's plan in another slot: targets are planned per exercise (review S5).
      if (exerciseInOtherSlot(input.slots, live(), e.slotKey, e.toExerciseId)) return { kind: 'invalid', reason: 'in_plan' };
      if (prev !== undefined) remove(prev.editId, 'replaced');
      append({ kind: 'swap', slotKey: e.slotKey, toExerciseId: e.toExerciseId }, prev?.editId ?? null);
      break;
    }
    case 'undo': {
      const target = edits.find((x) => x.editId === cmd.editId);
      if (target === undefined) return { kind: 'invalid', reason: 'not_found' };
      if (target.removed !== null) return { kind: 'unchanged', current };
      remove(target.editId, 'undo');
      removed.push(target.editId);
      const was = target.replacesEditId === null ? undefined : edits.find((x) => x.editId === target.replacesEditId);
      // The edit it replaced comes back as a copy, still pointing at the one before it (a chain of swaps undoes one step at a time).
      if (was !== undefined && was.removed?.why === 'replaced') append(bodyOf(was), was.replacesEditId);
      break;
    }
    case 'clear_swap': {
      const sw = live().find((x) => x.kind === 'swap' && x.slotKey === cmd.slotKey);
      if (sw === undefined) return { kind: 'unchanged', current };
      // The edits it replaced stay `replaced`: nothing in the chain comes back.
      remove(sw.editId, 'undo');
      removed.push(sw.editId);
      break;
    }
    case 'reset': {
      const all = live();
      if (all.length === 0) return { kind: 'unchanged', current };
      for (const e of all) {
        remove(e.editId, 'reset');
        removed.push(e.editId);
      }
      break;
    }
    case 'clear_order': {
      const o = live().find((x) => x.kind === 'order');
      if (o === undefined) return { kind: 'unchanged', current };
      remove(o.editId, 'reset');
      removed.push(o.editId);
      break;
    }
    case 'restore': {
      for (const id of cmd.editIds) {
        const e = edits.find((x) => x.editId === id);
        if (e === undefined) return { kind: 'invalid', reason: 'not_found' };
        if (e.removed === null) continue;
        const clash = live().find((x) => sameTarget(x, e.kind === 'order' ? { kind: 'order' } : { kind: e.kind, slotKey: e.slotKey }));
        if (clash !== undefined && (clash.kind === 'skip' || cmd.keepLive === true)) continue;
        if (clash !== undefined) remove(clash.editId, 'replaced');
        append(bodyOf(e), clash?.editId ?? null);
      }
      if (added.length === 0) return { kind: 'unchanged', current };
      break;
    }
  }

  // Only live edits count toward the cap (r1 N1); removed ones (each ↑/↓, Undo, `· planned`) are
  // compacted oldest first, so a long session of moves never locks the draft. A compacted edit can
  // no longer be brought back, which only affects Undo of something hundreds of taps old.
  if (liveEdits(edits).length > MAX_DRAFT_EDITS) return { kind: 'invalid', reason: 'too_many' };
  while (edits.length > MAX_DRAFT_EDITS) {
    const i = edits.findIndex((e) => e.removed !== null && !added.includes(e.editId) && !removed.includes(e.editId));
    if (i < 0) break;
    edits.splice(i, 1);
  }
  const tz = at.tz;
  const next: PreStartDraft = {
    id: current?.id ?? input.newDraftId,
    ownerId: current?.ownerId ?? input.ownerId,
    basis: current?.basis ?? input.basis,
    status: 'open',
    sessionId: null,
    edits,
    opIds: [...(current?.opIds ?? []), opId].slice(-MAX_DRAFT_OPS),
    version: (current?.version ?? 0) + 1,
    createdAt: current?.createdAt ?? at,
    updatedAt: at,
    updatedAtUtc: at.utc,
    tz,
    expiresAtUtc: nextLocalMidnightUtc(at.utc, tz),
  };
  return { kind: 'write', next, expectedVersion: input.expectedVersion, added, removed };
}

/**
 * Mark live edits removed outside a Ben tap on the page (the template change's
 * Apply makes its swap `redundant`, ADR 0022 §2), as one versioned write. Null
 * when none of them is live.
 */
export function markDraftEdits(draft: PreStartDraft, editIds: readonly string[], why: TodayEditRemoved['why'], opId: string, at: ZonedTimestamp): PreStartDraft | null {
  if (draft.opIds.includes(opId)) return null;
  if (!draft.edits.some((e) => editIds.includes(e.editId) && e.removed === null)) return null;
  const edits = draft.edits.map((e) => (!editIds.includes(e.editId) || e.removed !== null ? e : { ...e, removed: { atUtc: at.utc, opId, why } }));
  return { ...draft, edits, opIds: [...draft.opIds, opId].slice(-MAX_DRAFT_OPS), version: draft.version + 1, updatedAt: at, updatedAtUtc: at.utc, tz: at.tz, expiresAtUtc: nextLocalMidnightUtc(at.utc, at.tz) };
}

/**
 * Whether `exerciseId` is already in today's plan in a slot other than
 * `slotKey`: as that slot's own exercise (and not swapped away today), or as
 * the exercise another slot is swapped to.
 */
function exerciseInOtherSlot(slots: readonly TodaySlot[], live: readonly TodayEdit[], slotKey: string, exerciseId: string): boolean {
  const swappedTo = new Map(live.flatMap((x) => (x.kind === 'swap' ? [[x.slotKey, x.toExerciseId] as const] : [])));
  return slots.some((s) => s.slotKey !== slotKey && (swappedTo.get(s.slotKey) ?? s.exerciseId) === exerciseId);
}

function bodyOf(e: TodayEdit): { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } | { kind: 'order'; slotKeys: string[] } {
  switch (e.kind) {
    case 'swap':
      return { kind: 'swap', slotKey: e.slotKey, toExerciseId: e.toExerciseId };
    case 'skip':
      return { kind: 'skip', slotKey: e.slotKey };
    case 'order':
      return { kind: 'order', slotKeys: [...e.slotKeys] };
  }
}

// ---------------------------------------------------------------------------
// Reorder helpers (Do first, ↑ / ↓): a superset always moves as one unit.

/** Units in plan order: a superset group is one unit. */
function units(order: readonly TodaySlot[]): string[][] {
  const out: string[][] = [];
  let prev: string | null = null;
  for (const s of order) {
    const last = out.at(-1);
    if (s.supersetGroup !== null && s.supersetGroup === prev && last !== undefined) last.push(s.slotKey);
    else out.push([s.slotKey]);
    prev = s.supersetGroup;
  }
  return out;
}

/**
 * The full new order after `Do first`, `Move up` or `Move down` on a row
 * (TE10). A superset member moves its whole group. Null when it can't move
 * (already first or last, or the row isn't in the plan).
 */
export function moveSlot(order: readonly TodaySlot[], slotKey: string, how: 'first' | 'up' | 'down'): string[] | null {
  const us = units(order);
  const at = us.findIndex((u) => u.includes(slotKey));
  if (at < 0) return null;
  const to = how === 'first' ? 0 : how === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= us.length || to === at) return null;
  const moved = us.splice(at, 1)[0] ?? [];
  us.splice(to, 0, moved);
  return us.flat();
}

/** Where a row can move: `Do first`, `↑`, `↓` (each unit is a single row or a whole superset). */
export function slotMoves(order: readonly TodaySlot[], slotKey: string): { first: boolean; up: boolean; down: boolean } {
  const us = units(order);
  const at = us.findIndex((u) => u.includes(slotKey));
  return { first: at > 0, up: at > 0, down: at >= 0 && at < us.length - 1 };
}

// ---------------------------------------------------------------------------
// Resolving edits against the plan as it is now

export type EditResult = 'applied' | 'stale' | 'redundant';
export interface EditOutcome {
  editId: string;
  kind: TodayEdit['kind'];
  result: EditResult;
}

export interface ResolvedEdits {
  /** slotKey → the exercise it is swapped to today. */
  swaps: Map<string, { editId: string; toExerciseId: string }>;
  skipped: Map<string, string>;
  /** The edited order (every slot), or null when the order wasn't changed. */
  order: string[] | null;
  orderEditId: string | null;
  outcomes: EditOutcome[];
}

/**
 * Which open edits still apply (ADR 0022 §2). Fixed order: swaps, skips, then
 * the order. A swap or skip whose slot is gone is `stale`; a swap to the
 * slot's own exercise (the template changed to match) is `redundant`; a swap
 * to an exercise another slot already has (the routine gained it since, or
 * an earlier swap took it) is `stale`, since targets are planned per
 * exercise and it would take that slot's (review S5); an
 * order that doesn't list exactly today's slots, or splits a superset, is
 * `stale`. `knownExercise`: whether a swap's exercise can still be found.
 */
export function resolveTodayEdits(slots: readonly TodaySlot[], edits: readonly TodayEdit[], knownExercise: (exerciseId: string) => boolean = () => true): ResolvedEdits {
  const bySlot = new Map(slots.map((s) => [s.slotKey, s]));
  const out: ResolvedEdits = { swaps: new Map(), skipped: new Map(), order: null, orderEditId: null, outcomes: [] };
  const open = liveEdits(edits);
  // Slots swapped away today (their own exercise isn't in today's plan), from every swap that could apply.
  const swappedAway = new Set(open.flatMap((e) => (e.kind === 'swap' && bySlot.has(e.slotKey) && bySlot.get(e.slotKey)?.exerciseId !== e.toExerciseId && knownExercise(e.toExerciseId) ? [e.slotKey] : [])));
  const taken = (slotKey: string, exerciseId: string): boolean =>
    slots.some((s) => s.slotKey !== slotKey && s.exerciseId === exerciseId && !swappedAway.has(s.slotKey)) || [...out.swaps.values()].some((x) => x.toExerciseId === exerciseId);
  for (const e of open) {
    if (e.kind !== 'swap') continue;
    const slot = bySlot.get(e.slotKey);
    const result: EditResult =
      slot === undefined || !knownExercise(e.toExerciseId) ? 'stale' : slot.exerciseId === e.toExerciseId ? 'redundant' : taken(e.slotKey, e.toExerciseId) ? 'stale' : 'applied';
    if (result === 'applied') out.swaps.set(e.slotKey, { editId: e.editId, toExerciseId: e.toExerciseId });
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  dropDuplicateSwaps(slots, open, out);
  for (const e of open) {
    if (e.kind !== 'skip') continue;
    const result: EditResult = bySlot.has(e.slotKey) ? 'applied' : 'stale';
    if (result === 'applied') out.skipped.set(e.slotKey, e.editId);
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  const keep = keptGroups(slots, out.skipped);
  const todayGroups = slots.map((x) => ({ ...x, supersetGroup: x.supersetGroup !== null && keep.has(x.supersetGroup) ? x.supersetGroup : null }));
  for (const e of open) {
    if (e.kind !== 'order') continue;
    const result: EditResult = validOrder(e.slotKeys, todayGroups) ? 'applied' : 'stale';
    // An order moved back to the plan's own is no reorder (not counted, no marker), but stays undoable.
    if (result === 'applied' && !sameOrder(e.slotKeys, slots.map((x) => x.slotKey))) {
      out.order = [...e.slotKeys];
      out.orderEditId = e.editId;
    }
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  return out;
}

/**
 * One exercise is never in two slots (review R2-S1). `swappedAway` above
 * counts a slot whose swap then resolved `stale` (it keeps its own
 * exercise), so another swap could still take that exercise. While any
 * exercise is in two slots today, the latest-made applied swap among them
 * is marked `stale` (its slot goes back to its own exercise, which is checked
 * again on the next pass).
 */
function dropDuplicateSwaps(slots: readonly TodaySlot[], open: readonly TodayEdit[], out: ResolvedEdits): void {
  const madeAt = new Map(open.map((e, i) => [e.editId, i]));
  for (;;) {
    const holders = new Map<string, string[]>();
    for (const s of slots) {
      const ex = out.swaps.get(s.slotKey)?.toExerciseId ?? s.exerciseId;
      holders.set(ex, [...(holders.get(ex) ?? []), s.slotKey]);
    }
    let latest: { slotKey: string; editId: string; at: number } | null = null;
    for (const keys of holders.values()) {
      if (keys.length < 2) continue;
      for (const k of keys) {
        const sw = out.swaps.get(k);
        const at = sw === undefined ? -1 : (madeAt.get(sw.editId) ?? -1);
        if (sw !== undefined && (latest === null || at > latest.at)) latest = { slotKey: k, editId: sw.editId, at };
      }
    }
    // Only the plan's own duplicates (no swap involved) are left: not today's edits to fix.
    if (latest === null) return;
    out.swaps.delete(latest.slotKey);
    const o = out.outcomes.find((x) => x.editId === latest.editId);
    if (o) o.result = 'stale';
  }
}

/** Edits to mark removed on the next write (the plan no longer has a place for them). */
export function pruneOf(outcomes: readonly EditOutcome[]): { editId: string; why: 'stale' | 'redundant' }[] {
  return outcomes.flatMap((o) => (o.result === 'applied' ? [] : [{ editId: o.editId, why: o.result }]));
}

/** `N EDITED` (§2.1): swaps and skips each count; an order change counts once. */
export function editCountOf(r: Pick<ResolvedEdits, 'swaps' | 'skipped' | 'order'>): number {
  return r.swaps.size + r.skipped.size + (r.order === null ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Slots of a basis

/** A source workout's part roots that Start would copy (at least one done set), in order. */
function nextRoots(source: SessionAggregate) {
  return [...source.exercises]
    .sort((a, b) => a.order - b.order)
    .filter((sx) => partRootOf(source.exercises, sx.id) === sx.id)
    .filter((sx) => blockSets(source, sx.id).some((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null));
}

/** Today's slots of a routine or a source workout, before any edit, in plan order. */
export function basisSlots(basis: { kind: 'routine'; routine: Pick<Routine, 'exercises'> } | { kind: 'next'; source: SessionAggregate }): TodaySlot[] {
  if (basis.kind === 'routine') {
    return [...basis.routine.exercises].sort((a, b) => a.order - b.order).map((r) => ({ slotKey: r.id, exerciseId: r.exerciseId, supersetGroup: r.supersetGroup }));
  }
  return nextRoots(basis.source).map((sx) => ({ slotKey: sx.id, exerciseId: sx.exerciseId, supersetGroup: sx.supersetGroup }));
}

/**
 * Today's slots after the edits, in today's order, with today's superset
 * groups (a group left with fewer than two unskipped members loses its
 * bracket, §2.1). This is what `Do first` and Reorder move.
 */
export function editedSlots(slots: readonly TodaySlot[], r: Pick<ResolvedEdits, 'swaps' | 'skipped' | 'order'>): TodaySlot[] {
  const byKey = new Map(slots.map((s) => [s.slotKey, s]));
  const ordered = (r.order ?? slots.map((s) => s.slotKey)).map((k) => byKey.get(k)).filter((s): s is TodaySlot => s !== undefined);
  const keep = keptGroups(slots, r.skipped);
  return ordered.map((s) => ({
    slotKey: s.slotKey,
    exerciseId: r.swaps.get(s.slotKey)?.toExerciseId ?? s.exerciseId,
    supersetGroup: s.supersetGroup !== null && keep.has(s.supersetGroup) ? s.supersetGroup : null,
  }));
}

/** Superset groups with two or more members not skipped today. */
function keptGroups(slots: readonly TodaySlot[], skipped: ReadonlyMap<string, string>): Set<string> {
  const count = new Map<string, number>();
  for (const s of slots) if (s.supersetGroup !== null && !skipped.has(s.slotKey)) count.set(s.supersetGroup, (count.get(s.supersetGroup) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= 2).map(([g]) => g));
}

/**
 * A slot's shape for `substituteTargets` (§6.2): its working-set count and its
 * own sets and reps (a routine's templates; a source workout's done sets).
 * Null when the slot isn't in the basis.
 */
export function substituteSlotOf(
  basis: { kind: 'routine'; routine: Pick<Routine, 'exercises'> } | { kind: 'next'; source: SessionAggregate },
  slotKey: string,
): { workingSets: number; templates: { setType: SetTemplateType; reps: { min: number; max: number } | null; durationS: number | null }[] } | null {
  if (basis.kind === 'routine') {
    const rex = basis.routine.exercises.find((r) => r.id === slotKey);
    if (rex === undefined) return null;
    const templates = rex.setTemplates.map((t) => ({ setType: t.setType, reps: t.targetReps, durationS: t.targetDurationS }));
    return { workingSets: templates.filter((t) => t.setType !== 'warmup').length, templates };
  }
  if (!nextRoots(basis.source).some((sx) => sx.id === slotKey)) return null;
  const done = blockSets(basis.source, slotKey).filter((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null);
  const templates = done.map((s) => {
    const reps = s.actual?.reps ?? null;
    return { setType: s.setType, reps: reps === null ? null : { min: reps, max: reps }, durationS: reps === null ? (s.actual?.durationS ?? null) : null };
  });
  return { workingSets: templates.filter((t) => t.setType !== 'warmup').length, templates };
}

// ---------------------------------------------------------------------------
// The equipment pin a swap starts from

export type { SwapPlan } from './swap-plan';

// ---------------------------------------------------------------------------
// Rewriting the start input

export interface AppliedEdits {
  resolved: ResolvedEdits;
  /** Swapped slots: what they were. */
  swapped: { slotKey: string; fromExerciseId: string; toExerciseId: string }[];
}

/**
 * `applyTodayEdits` for a routine (TE2): the start input with swapped slots
 * re-pointed at the substitute (its own targets, or the slot's sets and reps
 * with no load; never the original's load), today's order and today's
 * superset groups. Never fits a load: the planner does that, unchanged.
 */
export function applyTodayEditsToRoutine(
  input: RoutineStartInput,
  edits: readonly TodayEdit[],
  swaps: ReadonlyMap<string, SwapPlan>,
): { input: RoutineStartInput; applied: AppliedEdits } {
  const slots = basisSlots({ kind: 'routine', routine: input.routine });
  const resolved = resolveTodayEdits(slots, edits);
  // A swap whose plan the caller couldn't build (the exercise is gone) is stale.
  for (const [slotKey, s] of [...resolved.swaps]) {
    if (swaps.get(slotKey)?.exercise.id === s.toExerciseId) continue;
    resolved.swaps.delete(slotKey);
    const o = resolved.outcomes.find((x) => x.editId === s.editId);
    if (o) o.result = 'stale';
  }
  const keep = keptGroups(slots, resolved.skipped);
  const byKey = new Map(input.routine.exercises.map((r) => [r.id, r]));
  const order = resolved.order ?? slots.map((s) => s.slotKey);
  const targets = new Map(input.targets ?? []);
  const exercises = new Map(input.exercises);
  const known = new Map(input.knownEquipment);
  const swapped: AppliedEdits['swapped'] = [];
  const rewritten: RoutineExercise[] = order.flatMap((key, i) => {
    const rex = byKey.get(key);
    if (rex === undefined) return [];
    const supersetGroup = rex.supersetGroup !== null && keep.has(rex.supersetGroup) ? rex.supersetGroup : null;
    const sw = resolved.swaps.get(key);
    const sp = sw === undefined ? undefined : swaps.get(key);
    if (sp === undefined) return [{ ...rex, order: i, supersetGroup }];
    swapped.push({ slotKey: key, fromExerciseId: rex.exerciseId, toExerciseId: sp.exercise.id });
    exercises.set(sp.exercise.id, sp.exercise);
    if (sp.pin !== null) known.set(sp.pin.id, sp.pin);
    // Warm-ups were for the original's loads: a swapped slot has none. The working sets' loads are never carried over.
    const working = rex.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => ({ ...t, targetLoad: null }));
    if (sp.plan !== null && sp.plan.length > 0) targets.set(sp.exercise.id, sp.plan);
    else targets.delete(sp.exercise.id);
    return [{ ...rex, exerciseId: sp.exercise.id, equipmentId: swapEquipmentId(sp), order: i, supersetGroup, progressionRuleId: null, setTemplates: working.length > 0 ? working : rex.setTemplates.map((t) => ({ ...t, targetLoad: null })) }];
  });
  return {
    input: { ...input, routine: { ...input.routine, exercises: rewritten }, exercises, knownEquipment: known, targets },
    applied: { resolved, swapped },
  };
}

/**
 * `applyTodayEdits` for the next session of a non-routine workout: the source
 * workout with today's order and superset groups, and the swapped part roots
 * handed to the planner with their own plans (`RepeatInput.swaps`).
 */
export function applyTodayEditsToNext(input: RepeatInput, edits: readonly TodayEdit[], swaps: ReadonlyMap<string, SwapPlan>): { input: RepeatInput; applied: AppliedEdits } {
  const slots = basisSlots({ kind: 'next', source: input.source });
  const resolved = resolveTodayEdits(slots, edits);
  for (const [slotKey, s] of [...resolved.swaps]) {
    if (swaps.get(slotKey)?.exercise.id === s.toExerciseId) continue;
    resolved.swaps.delete(slotKey);
    const o = resolved.outcomes.find((x) => x.editId === s.editId);
    if (o) o.result = 'stale';
  }
  const keep = keptGroups(slots, resolved.skipped);
  const order = resolved.order ?? slots.map((s) => s.slotKey);
  const rank = new Map(order.map((k, i) => [k, i]));
  const exercises = input.source.exercises.map((sx) => {
    const at = rank.get(sx.id);
    if (at === undefined) return sx;
    const supersetGroup = sx.supersetGroup !== null && keep.has(sx.supersetGroup) ? sx.supersetGroup : null;
    // Only part roots carry the order the planner reads; parts follow their root.
    return { ...sx, order: at, supersetGroup };
  });
  // Parts and rows Start leaves out sort after every root, in their old order.
  const rootCount = order.length;
  const others = exercises.filter((sx) => !rank.has(sx.id)).sort((a, b) => a.order - b.order);
  const reordered = exercises.map((sx) => (rank.has(sx.id) ? sx : { ...sx, order: rootCount + others.indexOf(sx) }));
  const swapped: AppliedEdits['swapped'] = [];
  const planSwaps = new Map<string, SwapPlan>();
  for (const [key, s] of resolved.swaps) {
    const sp = swaps.get(key);
    const from = slots.find((x) => x.slotKey === key);
    if (sp === undefined || from === undefined) continue;
    planSwaps.set(key, sp);
    swapped.push({ slotKey: key, fromExerciseId: from.exerciseId, toExerciseId: s.toExerciseId });
  }
  return {
    input: { ...input, source: { ...input.source, exercises: reordered }, ...(planSwaps.size > 0 ? { swaps: planSwaps } : {}) },
    applied: { resolved, swapped },
  };
}

// ---------------------------------------------------------------------------
// The one planning path for the overview and Start

export type TodayPlanInput = { kind: 'routine'; input: RoutineStartInput } | { kind: 'next'; input: RepeatInput };

export interface TodayEditsInput {
  /** The draft the edits come from (its ID and version go on the session); null with none. */
  draft: { id: string; version: number } | null;
  edits: readonly TodayEdit[];
  /** Plans for swapped slots, by slot key (`substituteTargets`). */
  swaps: ReadonlyMap<string, SwapPlan>;
}

export type TodayPlanOutput = (({ kind: 'routine' } & RoutineStartOutput) | ({ kind: 'next' } & RepeatOutput)) & {
  /** Each session exercise's slot key (routine: `RoutineExercise.id`; next: the source part root). */
  slotOf: Record<string, string>;
  outcomes: EditOutcome[];
  resolved: ResolvedEdits;
  /** Today's slots after the edits, in today's order (for `Do first` and Reorder). */
  slots: TodaySlot[];
  /** Today's slots before any edit (what edits are checked against). */
  baseSlots: TodaySlot[];
};

/**
 * `planWithTodayEdits` (ADR 0022 §2): `applyTodayEdits` on the start input →
 * the existing planner (`planRoutineStart` / `startWorkoutFromSession`, which
 * fit every load with `snapPlanToGym`, mode `start`) → skipped slots' sets
 * marked `skipped` (`skippedBy: 'before_start'`). The overview's dry run and
 * Start both call this, so the page shows exactly what Start creates.
 */
export function planWithTodayEdits(plan: { kind: 'routine'; input: RoutineStartInput }, edits: TodayEditsInput): Extract<TodayPlanOutput, { kind: 'routine' }>;
export function planWithTodayEdits(plan: { kind: 'next'; input: RepeatInput }, edits: TodayEditsInput): Extract<TodayPlanOutput, { kind: 'next' }>;
export function planWithTodayEdits(plan: TodayPlanInput, edits: TodayEditsInput): TodayPlanOutput;
export function planWithTodayEdits(plan: TodayPlanInput, edits: TodayEditsInput): TodayPlanOutput {
  if (plan.kind === 'routine') {
    const baseSlots = basisSlots({ kind: 'routine', routine: plan.input.routine });
    const { input, applied } = applyTodayEditsToRoutine(plan.input, edits.edits, edits.swaps);
    const out = planRoutineStart(input);
    const slotOf: Record<string, string> = {};
    out.aggregate.exercises.forEach((ex, i) => {
      const slotId = out.snap.slots[i]?.slotId;
      if (slotId !== undefined) slotOf[ex.id] = slotId;
    });
    const names = plan.input.exercises;
    const aggregate = finish(out.aggregate, slotOf, applied, edits.draft, (_slot, from) => names.get(from)?.name ?? 'Exercise');
    return { kind: 'routine', ...out, aggregate, slotOf, outcomes: applied.resolved.outcomes, resolved: applied.resolved, slots: editedSlots(baseSlots, applied.resolved), baseSlots };
  }
  const baseSlots = basisSlots({ kind: 'next', source: plan.input.source });
  const { input, applied } = applyTodayEditsToNext(plan.input, edits.edits, edits.swaps);
  const out = startWorkoutFromSession(input);
  const slotOf: Record<string, string> = {};
  out.aggregate.exercises.forEach((ex, i) => {
    const slotId = out.snap.slots[i]?.slotId;
    const root = slotId === undefined ? undefined : out.slotSources[slotId];
    if (root !== undefined) slotOf[ex.id] = root;
  });
  const names = new Map(plan.input.source.exercises.map((sx) => [sx.id, sx.exerciseName]));
  const aggregate = finish(out.aggregate, slotOf, applied, edits.draft, (slot, from) => names.get(slot) ?? plan.input.exercises.get(from)?.name ?? 'Exercise');
  return { kind: 'next', ...out, aggregate, slotOf, outcomes: applied.resolved.outcomes, resolved: applied.resolved, slots: editedSlots(baseSlots, applied.resolved), baseSlots };
}

/** Skipped slots' sets become `skipped` before start; the session records the draft's applied edits. */
function finish(
  aggregate: SessionAggregate,
  slotOf: Readonly<Record<string, string>>,
  applied: AppliedEdits,
  draft: { id: string; version: number } | null,
  nameOf: (slotKey: string, fromExerciseId: string) => string,
): SessionAggregate {
  const skippedRows = new Set(Object.entries(slotOf).flatMap(([sx, key]) => (applied.resolved.skipped.has(key) ? [sx] : [])));
  const sets = aggregate.sets.map((s) => (skippedRows.has(s.sessionExerciseId) && s.status === 'pending' ? { ...s, status: 'skipped' as const, skippedBy: 'before_start' as const } : s));
  const activeSetId = skippedRows.size === 0 ? aggregate.session.activeSetId : nextPendingSet(null, aggregate.exercises, sets);
  const rowOf = new Map(Object.entries(slotOf).map(([sx, key]) => [key, sx]));
  const todayEdits: SessionTodayEdits | null =
    draft === null
      ? null
      : {
          draftId: draft.id,
          draftVersion: draft.version,
          swapped: applied.swapped.flatMap((s) => {
            const sx = rowOf.get(s.slotKey);
            return sx === undefined ? [] : [{ sessionExerciseId: sx, slotKey: s.slotKey, fromExerciseId: s.fromExerciseId, fromExerciseName: nameOf(s.slotKey, s.fromExerciseId).slice(0, 120) }];
          }),
          skipped: [...applied.resolved.skipped.keys()].flatMap((key) => {
            const sx = rowOf.get(key);
            return sx === undefined ? [] : [{ sessionExerciseId: sx, slotKey: key }];
          }),
          reordered: applied.resolved.order !== null,
        };
  return {
    ...aggregate,
    session: { ...aggregate.session, activeSetId, ...(todayEdits !== null ? { todayEdits } : {}) },
    sets,
  };
}
