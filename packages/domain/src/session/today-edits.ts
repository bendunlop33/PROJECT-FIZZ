import type {
  SetType as SetTemplateType,
  DraftBasis,
  Load,
  RepRange,
  PreStartDraft,
  Routine,
  RoutineExercise,
  SessionAggregate,
  SessionTodayEdits,
  TodayEdit,
  TodayEditRemoved,
  ZonedTimestamp,
} from '@fizz/schemas';
import { MAX_DRAFT_EDITS, MAX_DRAFT_OPS, TODAY_EDIT_LIMITS } from '@fizz/schemas';
import { addDays, localDateOf, localMidnightUtcMs } from '../calendar';
import { deriveId } from '../stable';
import { toIso, toMs } from '../time';
import { estimateRemainingDuration, planPace, type ResolvedPace } from './duration';
import { finishByFromFit, fitPlanToMinutes, fitTier, validFitMinutes, withSkipped, type FitCut, type FitSlot, type FitStatus } from './fit-time';
import { blockSets, partRootOf } from './gym-switch';
import { nextPendingSet } from './order';
import { startWorkoutFromSession, type RepeatInput, type RepeatOutput } from './repeat';
import { defaultMain, mainFlags, planRoutineStart, type RoutineStartInput, type RoutineStartOutput } from './routines';
import { addedSlotShape, type ShapeBefore, type SlotShape } from './today-shape';
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
 * Edits are intent: a swap's or an added exercise's targets come from its
 * own history (`substituteTargets` / `addTargets`), re-planned on every
 * read, so a gym change re-fits them (GS2). The one number an edit carries is
 * Ben's own `load` (§11, TE13): his intended load, fitted on every read like
 * any intended load. No AI is involved anywhere here.
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

/** One edit's own fields (what Ben chose), without its bookkeeping. */
export type TodayEditBody =
  | { kind: 'swap'; slotKey: string; toExerciseId: string }
  | { kind: 'skip'; slotKey: string }
  | { kind: 'order'; slotKeys: readonly string[] }
  /** §11: an exercise added at the end; `slotKey` is the new row's own key. */
  | { kind: 'add'; slotKey: string; exerciseId: string }
  | { kind: 'sets'; slotKey: string; workingSets: number }
  | { kind: 'reps'; slotKey: string; reps: RepRange | null; durationS: number | null }
  /** `exerciseId`: set by `applyDraftCommand` to the slot's exercise when the load is typed (review B1); a caller's value is ignored. */
  | { kind: 'load'; slotKey: string; load: Load; exerciseId?: string }
  /** Fit to time (fit-to-time FT4): Ben's `Trim to 45 min`. */
  | { kind: 'fit'; minutes: number };

/** Who made a stored edit, kept when an edit is copied back (Undo, restore). Ben's taps never set it. */
type Authorship = { author?: 'ben' | 'coach'; actionId?: string };

/** The §11 edits on one slot that a newer one of the same kind replaces, and `Use planned` clears. */
export type ShapeEditKind = 'sets' | 'reps' | 'load';

/** What one draft write asks for. Ben's taps only; nothing here is ever proposed by the coach. */
export type DraftCommand =
  | { type: 'edit'; edit: TodayEditBody }
  /** `Use planned` (reps, load), or a stepper back at the planned count: the slot's edit of that kind is removed. */
  | { type: 'clear'; kind: ShapeEditKind; slotKey: string }
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
  /** `Clear fit` (fit-to-time §3.2): the live fit removed, and a coach fit's own edits with it. */
  | { type: 'clear_fit' }
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
  | { kind: 'invalid'; reason: 'slot_gone' | 'last_exercise' | 'bad_order' | 'not_found' | 'too_many' | 'in_plan' | 'added' | 'out_of_range' };

/** One plan slot as edits see it: its key, its exercise and its superset group (today's, after skips). */
export interface TodaySlot {
  slotKey: string;
  exerciseId: string;
  supersetGroup: string | null;
}

const editIdOf = (opId: string, n: number): string => deriveId(`today-edit:${opId}:${String(n)}`);

/**
 * Whether two edits change the same thing (a newer one replaces an older
 * one). A load is per slot and per exercise (review B1): Ben's bench load
 * and his DB bench load on the same slot are two different choices.
 * `exerciseOf`: a load edit's exercise (its own, else the slot's planned one).
 */
function sameTarget(a: TodayEdit, b: Pick<TodayEdit, 'kind'> & { slotKey?: string; exerciseId?: string | undefined }, exerciseOf: (e: TodayEdit) => string | null): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'order' || a.kind === 'fit') return true;
  if (a.slotKey !== b.slotKey) return false;
  return a.kind !== 'load' || exerciseOf(a) === (b.exerciseId ?? null);
}

/** A load edit's exercise: the one it was typed for, else (an edit from before that was recorded) the slot's own. */
function loadExerciseOf(e: Extract<TodayEdit, { kind: 'load' }>, baseExercise: (slotKey: string) => string | null): string | null {
  return e.exerciseId ?? baseExercise(e.slotKey);
}

/** Today's added slots (live `add` edits), after the plan's own, in the order they were added. */
function addedSlotsOf(live: readonly TodayEdit[]): TodaySlot[] {
  return live.flatMap((e) => (e.kind === 'add' ? [{ slotKey: e.slotKey, exerciseId: e.exerciseId, supersetGroup: null }] : []));
}

/** Whether a §11 value is inside the limits (TE17). */
function inRange(e: TodayEditBody): boolean {
  const L = TODAY_EDIT_LIMITS;
  switch (e.kind) {
    case 'sets':
      return Number.isInteger(e.workingSets) && e.workingSets >= L.minSets && e.workingSets <= L.maxSets;
    case 'reps':
      if ((e.reps === null) === (e.durationS === null)) return false;
      if (e.reps !== null) return Number.isInteger(e.reps.min) && Number.isInteger(e.reps.max) && e.reps.min >= L.minReps && e.reps.max <= L.maxReps && e.reps.min <= e.reps.max;
      return e.durationS !== null && Number.isInteger(e.durationS) && e.durationS >= L.minWorkS && e.durationS <= L.maxWorkS;
    case 'load':
      return Number.isFinite(e.load.value) && e.load.value >= 0 && e.load.value <= 2000;
    case 'fit':
      return validFitMinutes(e.minutes);
    case 'swap':
    case 'skip':
    case 'order':
    case 'add':
      return true;
  }
}

/** The live edits a coach fit made (same `actionId`), the fit edit itself included. */
function fitCompanions(live: readonly TodayEdit[], fit: TodayEdit): TodayEdit[] {
  if (fit.kind !== 'fit' || fit.author !== 'coach' || fit.actionId === undefined) return [fit];
  return live.filter((x) => x.editId === fit.editId || (x.author === 'coach' && x.actionId === fit.actionId));
}

/** Two §11 edits on one slot ask for the same thing. */
function sameShapeValue(a: TodayEdit, b: TodayEditBody): boolean {
  if (a.kind === 'sets' && b.kind === 'sets') return a.workingSets === b.workingSets;
  if (a.kind === 'reps' && b.kind === 'reps') return a.durationS === b.durationS && (a.reps === null || b.reps === null ? a.reps === b.reps : a.reps.min === b.reps.min && a.reps.max === b.reps.max);
  if (a.kind === 'load' && b.kind === 'load') return a.load.value === b.load.value && a.load.unit === b.load.unit && a.load.convention === b.load.convention;
  return false;
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
  const append = (body: TodayEditBody, replaces: string | null, by: Authorship = {}) => {
    const editId = editIdOf(opId, n);
    n += 1;
    edits.push(withBase(body, { editId, opId, atUtc: at.utc, replacesEditId: replaces, removed: null }, by));
    added.push(editId);
  };
  /** Bring back an earlier edit as a new copy (who made it is kept). */
  const appendCopy = (e: TodayEdit, replaces: string | null) => {
    append(bodyOf(e), replaces, authorshipOf(e));
  };
  // Today's slots: the plan's own, then the exercises added today (§11).
  const plannedKeys = new Set(input.slots.map((s) => s.slotKey));
  const allSlots = () => [...input.slots, ...addedSlotsOf(live())];
  /** The slot's own exercise (planned, or the one added today), before any swap. */
  const baseExercise = (slotKey: string): string | null =>
    input.slots.find((x) => x.slotKey === slotKey)?.exerciseId ?? addedSlotsOf(live()).find((x) => x.slotKey === slotKey)?.exerciseId ?? null;
  /** The exercise the slot holds now (after today's live swap). */
  const exerciseNow = (slotKey: string): string | null => {
    const sw = live().find((x) => x.kind === 'swap' && x.slotKey === slotKey);
    return sw?.kind === 'swap' ? sw.toExerciseId : baseExercise(slotKey);
  };
  const exerciseOf = (e: TodayEdit): string | null => (e.kind === 'load' ? loadExerciseOf(e, baseExercise) : null);

  const cmd = input.command;
  switch (cmd.type) {
    case 'edit': {
      // Ben's tap: whatever the caller sent, the edit is his (a coach fit is written by `applyCoachFit`).
      const e = bodyOf(withBase(cmd.edit, { editId: '', opId, atUtc: at.utc, replacesEditId: null, removed: null }));
      if (!inRange(e)) return { kind: 'invalid', reason: 'out_of_range' };
      if (e.kind === 'fit') {
        const prev = live().find((x) => x.kind === 'fit');
        if (prev?.kind === 'fit' && prev.author !== 'coach' && prev.minutes === e.minutes) return { kind: 'unchanged', current };
        // One fit at a time (FT2): a coach fit goes with all its edits; Undo brings it back.
        if (prev !== undefined) for (const x of fitCompanions(live(), prev)) remove(x.editId, 'replaced');
        append({ kind: 'fit', minutes: e.minutes }, prev?.editId ?? null);
        break;
      }
      if (e.kind === 'order') {
        // Today's superset groups: a group left with one member after skips is no longer kept together.
        const slotsNow = allSlots();
        const skippedNow = new Map(live().flatMap((x) => (x.kind === 'skip' ? [[x.slotKey, x.editId] as const] : [])));
        const keepNow = keptGroups(slotsNow, skippedNow);
        const todayGroups = slotsNow.map((x) => ({ ...x, supersetGroup: x.supersetGroup !== null && keepNow.has(x.supersetGroup) ? x.supersetGroup : null }));
        if (!validOrder(e.slotKeys, todayGroups)) return { kind: 'invalid', reason: 'bad_order' };
        const prev = live().find((x) => x.kind === 'order');
        const base = slotsNow.map((s) => s.slotKey);
        if (prev?.kind === 'order' && sameOrder(prev.slotKeys, e.slotKeys)) return { kind: 'unchanged', current };
        if (prev === undefined && sameOrder(base, e.slotKeys)) return { kind: 'unchanged', current };
        if (prev !== undefined) remove(prev.editId, 'replaced');
        append({ kind: 'order', slotKeys: [...e.slotKeys] }, prev?.editId ?? null);
        break;
      }
      if (e.kind === 'add') {
        if (live().some((x) => x.kind === 'add' && x.slotKey === e.slotKey)) return { kind: 'unchanged', current };
        if (plannedKeys.has(e.slotKey) || edits.some((x) => x.editId === e.slotKey)) return { kind: 'invalid', reason: 'in_plan' };
        if (addedSlotsOf(live()).length >= TODAY_EDIT_LIMITS.maxAdded) return { kind: 'invalid', reason: 'too_many' };
        // Never an exercise already in today's plan (targets are planned per exercise, as for a swap).
        if (exerciseInOtherSlot(allSlots(), live(), e.slotKey, e.exerciseId)) return { kind: 'invalid', reason: 'in_plan' };
        append({ kind: 'add', slotKey: e.slotKey, exerciseId: e.exerciseId }, null);
        break;
      }
      if (!allSlots().some((x) => x.slotKey === e.slotKey)) return { kind: 'invalid', reason: 'slot_gone' };
      // A load is for the exercise the slot holds now (review B1).
      const body: TodayEditBody = e.kind === 'load' ? { kind: 'load', slotKey: e.slotKey, load: { ...e.load }, ...stampOf(exerciseNow(e.slotKey)) } : e;
      const prev = live().find((x) => sameTarget(x, body, exerciseOf));
      if (e.kind === 'sets' || e.kind === 'reps' || e.kind === 'load') {
        if (prev !== undefined && sameShapeValue(prev, body)) return { kind: 'unchanged', current };
        if (prev !== undefined) remove(prev.editId, 'replaced');
        append(body, prev?.editId ?? null);
        break;
      }
      // An added exercise is taken out with `Remove` (its add's Undo), never skipped or swapped (§11.3).
      if (!plannedKeys.has(e.slotKey)) return { kind: 'invalid', reason: 'added' };
      if (e.kind === 'skip') {
        if (prev !== undefined) return { kind: 'unchanged', current };
        const skipped = new Set(live().flatMap((x) => (x.kind === 'skip' ? [x.slotKey] : [])));
        // The last exercise left can't be skipped: Start always has something to do (§2.2).
        if (allSlots().filter((s) => !skipped.has(s.slotKey) && s.slotKey !== e.slotKey).length === 0) return { kind: 'invalid', reason: 'last_exercise' };
        append({ kind: 'skip', slotKey: e.slotKey }, null);
        break;
      }
      if (prev?.kind === 'swap' && prev.toExerciseId === e.toExerciseId) return { kind: 'unchanged', current };
      // Never an exercise already in today's plan in another slot: targets are planned per exercise (review S5).
      if (exerciseInOtherSlot(allSlots(), live(), e.slotKey, e.toExerciseId)) return { kind: 'invalid', reason: 'in_plan' };
      if (prev !== undefined) remove(prev.editId, 'replaced');
      append({ kind: 'swap', slotKey: e.slotKey, toExerciseId: e.toExerciseId }, prev?.editId ?? null);
      break;
    }
    case 'undo': {
      const target = edits.find((x) => x.editId === cmd.editId);
      if (target === undefined) return { kind: 'invalid', reason: 'not_found' };
      if (target.removed !== null) return { kind: 'unchanged', current };
      // A coach fit's Undo takes every edit it made (fit-to-time §5.3).
      for (const x of fitCompanions(live(), target)) {
        if (x.editId === target.editId) continue;
        remove(x.editId, 'undo');
        removed.push(x.editId);
      }
      remove(target.editId, 'undo');
      removed.push(target.editId);
      // `Remove` on an added exercise takes its sets, reps and load with it, so the toast's Undo (a restore of `removed`) brings them all back.
      if (target.kind === 'add') {
        for (const x of live()) {
          if ((x.kind === 'sets' || x.kind === 'reps' || x.kind === 'load' || x.kind === 'skip' || x.kind === 'swap') && x.slotKey === target.slotKey) {
            remove(x.editId, 'undo');
            removed.push(x.editId);
          }
        }
      }
      const was = target.replacesEditId === null ? undefined : edits.find((x) => x.editId === target.replacesEditId);
      // The edit it replaced comes back as a copy, still pointing at the one before it (a chain of swaps undoes one step at a time).
      if (was !== undefined && was.removed?.why === 'replaced') {
        appendCopy(was, was.replacesEditId);
        // A coach fit comes back with the edits that went with it (FT2).
        if (was.kind === 'fit' && was.author === 'coach' && was.actionId !== undefined) {
          const opOf = was.removed.opId;
          for (const x of edits.filter((y) => y.editId !== was.editId && y.author === 'coach' && y.actionId === was.actionId && y.removed?.why === 'replaced' && y.removed.opId === opOf)) appendCopy(x, x.replacesEditId);
        }
      }
      break;
    }
    case 'clear': {
      // A load: the one for the exercise the slot holds now (another exercise's stays with it, review B1).
      const e = live().find((x) => x.kind === cmd.kind && x.slotKey === cmd.slotKey && (x.kind !== 'load' || exerciseOf(x) === exerciseNow(cmd.slotKey)));
      if (e === undefined) return { kind: 'unchanged', current };
      // Back to the plan on that slot: nothing it replaced comes back.
      remove(e.editId, 'undo');
      removed.push(e.editId);
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
    case 'clear_fit': {
      const f = live().find((x) => x.kind === 'fit');
      if (f === undefined) return { kind: 'unchanged', current };
      for (const x of fitCompanions(live(), f)) {
        remove(x.editId, 'undo');
        removed.push(x.editId);
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
        const clash = live().find((x) => sameTarget(x, e.kind === 'order' || e.kind === 'fit' ? { kind: e.kind } : { kind: e.kind, slotKey: e.slotKey, exerciseId: exerciseOf(e) ?? undefined }, exerciseOf));
        if (clash !== undefined && (clash.kind === 'skip' || clash.kind === 'add' || cmd.keepLive === true)) continue;
        if (clash !== undefined) for (const x of fitCompanions(live(), clash)) remove(x.editId, 'replaced');
        appendCopy(e, clash?.editId ?? null);
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

function bodyOf(e: TodayEdit): TodayEditBody {
  switch (e.kind) {
    case 'fit':
      return { kind: 'fit', minutes: e.minutes };
    case 'swap':
      return { kind: 'swap', slotKey: e.slotKey, toExerciseId: e.toExerciseId };
    case 'skip':
      return { kind: 'skip', slotKey: e.slotKey };
    case 'order':
      return { kind: 'order', slotKeys: [...e.slotKeys] };
    case 'add':
      return { kind: 'add', slotKey: e.slotKey, exerciseId: e.exerciseId };
    case 'sets':
      return { kind: 'sets', slotKey: e.slotKey, workingSets: e.workingSets };
    case 'reps':
      return { kind: 'reps', slotKey: e.slotKey, reps: e.reps === null ? null : { ...e.reps }, durationS: e.durationS };
    case 'load':
      return { kind: 'load', slotKey: e.slotKey, load: { ...e.load }, ...stampOf(e.exerciseId ?? null) };
  }
}

const stampOf = (exerciseId: string | null): { exerciseId?: string } => (exerciseId === null ? {} : { exerciseId });

type EditBase = Pick<TodayEdit, 'editId' | 'opId' | 'atUtc' | 'replacesEditId' | 'removed'>;

/** A coach edit's author and action (absent on Ben's). */
function authorshipOf(e: TodayEdit): Authorship {
  return e.author === 'coach' && e.actionId !== undefined ? { author: 'coach', actionId: e.actionId } : {};
}

/** A stored edit from its fields and bookkeeping. Ben's unless `by` names the coach (a coach fit, fit-to-time §5.2). */
function withBase(body: TodayEditBody, base: EditBase, by: Authorship = {}): TodayEdit {
  const who = by.author === 'coach' && by.actionId !== undefined ? { author: 'coach' as const, actionId: by.actionId } : {};
  switch (body.kind) {
    case 'order':
      return { ...base, ...who, kind: 'order', slotKeys: [...body.slotKeys] };
    case 'fit':
      return { ...base, ...who, kind: 'fit', minutes: body.minutes };
    case 'swap':
      return { ...base, ...who, kind: 'swap', slotKey: body.slotKey, toExerciseId: body.toExerciseId };
    case 'skip':
      return { ...base, ...who, kind: 'skip', slotKey: body.slotKey };
    case 'add':
      return { ...base, ...who, kind: 'add', slotKey: body.slotKey, exerciseId: body.exerciseId };
    case 'sets':
      return { ...base, ...who, kind: 'sets', slotKey: body.slotKey, workingSets: body.workingSets };
    case 'reps':
      return { ...base, ...who, kind: 'reps', slotKey: body.slotKey, reps: body.reps === null ? null : { ...body.reps }, durationS: body.durationS };
    case 'load':
      return { ...base, ...who, kind: 'load', slotKey: body.slotKey, load: { ...body.load }, ...(body.exerciseId !== undefined ? { exerciseId: body.exerciseId } : {}) };
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
  /** The edited order (every slot, added ones included), or null when the order wasn't changed. */
  order: string[] | null;
  orderEditId: string | null;
  /** §11: exercises added today, by their new slot key, in the order they were added. */
  added: Map<string, { editId: string; exerciseId: string }>;
  /** §11: each slot's working-set count, reps or work time, and Ben's load today. */
  sets: Map<string, { editId: string; workingSets: number }>;
  reps: Map<string, { editId: string; reps: RepRange | null; durationS: number | null }>;
  /** Ben's load on a slot while it holds the exercise the load was typed for (`exerciseId`, review B1). */
  loads: Map<string, { editId: string; load: Load; exerciseId: string | null }>;
  /** The live fit (fit-to-time FT4): Ben's built-in trim, or the coach's fit (`actionId`). Null: none. */
  fit: { editId: string; minutes: number; by: 'built_in' | 'coach'; actionId: string | null } | null;
  /** Edits the coach made (a coach fit's), by edit ID: they are the fit, not Ben's edits (`N EDITED`, FT5, the template card). */
  coachEdits: Set<string>;
  outcomes: EditOutcome[];
}

/** No edits at all. */
export function noResolvedEdits(): ResolvedEdits {
  return { swaps: new Map(), skipped: new Map(), order: null, orderEditId: null, added: new Map(), sets: new Map(), reps: new Map(), loads: new Map(), fit: null, coachEdits: new Set(), outcomes: [] };
}

/**
 * An order edit against today's slots (§11): the plan's own slots must all
 * be there, once each (else it is stale, as in v0.2). Added exercises are
 * looser: one taken out since is dropped, one added since goes at the end
 * (`Add` never rewrites the order edit). Null: stale.
 */
function normaliseOrder(order: readonly string[], planned: readonly string[], added: readonly string[], everAdded: ReadonlySet<string>): string[] | null {
  const live = new Set([...planned, ...added]);
  const kept = order.filter((k) => live.has(k));
  if (order.some((k) => !live.has(k) && !everAdded.has(k))) return null;
  if (planned.some((k) => !kept.includes(k))) return null;
  return [...kept, ...added.filter((k) => !kept.includes(k))];
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
  const out: ResolvedEdits = noResolvedEdits();
  // The fit first (FT4): the newest live one. A coach edit whose coach fit isn't the live one is left over: stale.
  const fits = liveEdits(edits).filter((e): e is Extract<TodayEdit, { kind: 'fit' }> => e.kind === 'fit');
  const liveFit = fits.at(-1);
  if (liveFit !== undefined) {
    const coach = liveFit.author === 'coach' && liveFit.actionId !== undefined;
    out.fit = { editId: liveFit.editId, minutes: liveFit.minutes, by: coach ? 'coach' : 'built_in', actionId: coach ? (liveFit.actionId ?? null) : null };
  }
  for (const f of fits) out.outcomes.push({ editId: f.editId, kind: 'fit', result: f === liveFit ? 'applied' : 'redundant' });
  const orphan = (e: TodayEdit): boolean => e.kind !== 'fit' && e.author === 'coach' && (out.fit?.by !== 'coach' || e.actionId !== out.fit.actionId);
  for (const e of liveEdits(edits)) if (orphan(e)) out.outcomes.push({ editId: e.editId, kind: e.kind, result: 'stale' });
  const open = liveEdits(edits).filter((e) => e.kind !== 'fit' && !orphan(e));
  for (const e of open) if (e.author === 'coach') out.coachEdits.add(e.editId);
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
  // Added exercises (§11, TE12: after swaps): never one already in today's plan, at most six.
  const inPlanNow = (exerciseId: string): boolean => slots.some((s) => (out.swaps.get(s.slotKey)?.toExerciseId ?? s.exerciseId) === exerciseId) || [...out.added.values()].some((a) => a.exerciseId === exerciseId);
  for (const e of open) {
    if (e.kind !== 'add') continue;
    const result: EditResult = bySlot.has(e.slotKey) || out.added.has(e.slotKey) || !knownExercise(e.exerciseId) || inPlanNow(e.exerciseId) || out.added.size >= TODAY_EDIT_LIMITS.maxAdded ? 'stale' : 'applied';
    if (result === 'applied') out.added.set(e.slotKey, { editId: e.editId, exerciseId: e.exerciseId });
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  const all = [...slots, ...[...out.added].map(([slotKey, a]) => ({ slotKey, exerciseId: a.exerciseId, supersetGroup: null }))];
  const allKeys = new Set(all.map((x) => x.slotKey));
  for (const e of open) {
    if (e.kind !== 'skip') continue;
    const result: EditResult = bySlot.has(e.slotKey) ? 'applied' : 'stale';
    if (result === 'applied') out.skipped.set(e.slotKey, e.editId);
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  const keep = keptGroups(slots, out.skipped);
  const todayGroups = all.map((x) => ({ ...x, supersetGroup: x.supersetGroup !== null && keep.has(x.supersetGroup) ? x.supersetGroup : null }));
  const everAdded = new Set(edits.flatMap((e) => (e.kind === 'add' ? [e.slotKey] : [])));
  const plannedKeys = slots.map((x) => x.slotKey);
  const addedKeys = [...out.added.keys()];
  for (const e of open) {
    if (e.kind !== 'order') continue;
    const order = normaliseOrder(e.slotKeys, plannedKeys, addedKeys, everAdded);
    const result: EditResult = order !== null && validOrder(order, todayGroups) ? 'applied' : 'stale';
    // An order moved back to the plan's own is no reorder (not counted, no marker), but stays undoable.
    if (result === 'applied' && order !== null && !sameOrder(order, [...plannedKeys, ...addedKeys])) {
      out.order = order;
      out.orderEditId = e.editId;
    }
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  // Sets, reps and load (TE12: last): on any slot of today's, added ones included.
  const baseOf = (slotKey: string): string | null => bySlot.get(slotKey)?.exerciseId ?? out.added.get(slotKey)?.exerciseId ?? null;
  const nowOf = (slotKey: string): string | null => out.swaps.get(slotKey)?.toExerciseId ?? baseOf(slotKey);
  for (const e of open) {
    if (e.kind !== 'sets' && e.kind !== 'reps' && e.kind !== 'load') continue;
    const result: EditResult = allKeys.has(e.slotKey) ? 'applied' : 'stale';
    // A load typed for another exercise than the slot holds now (a swap since, or an Undo of one) waits,
    // neither applied nor pruned: it is back when the slot holds that exercise again (review B1).
    if (result === 'applied' && e.kind === 'load' && loadExerciseOf(e, baseOf) !== nowOf(e.slotKey)) continue;
    if (result === 'applied') {
      if (e.kind === 'sets') out.sets.set(e.slotKey, { editId: e.editId, workingSets: e.workingSets });
      else if (e.kind === 'reps') out.reps.set(e.slotKey, { editId: e.editId, reps: e.reps, durationS: e.durationS });
      else out.loads.set(e.slotKey, { editId: e.editId, load: e.load, exerciseId: loadExerciseOf(e, baseOf) });
    }
    out.outcomes.push({ editId: e.editId, kind: e.kind, result });
  }
  return out;
}

/** Today's slot shapes from the §11 edits (`sets`, `reps`, `load`), by slot key. */
export function shapesOf(r: Pick<ResolvedEdits, 'sets' | 'reps' | 'loads'>): Map<string, SlotShape> {
  const out = new Map<string, SlotShape>();
  const at = (k: string): SlotShape => {
    const cur = out.get(k) ?? {};
    out.set(k, cur);
    return cur;
  };
  for (const [k, v] of r.sets) at(k).workingSets = v.workingSets;
  for (const [k, v] of r.reps) at(k).reps = { reps: v.reps, durationS: v.durationS };
  for (const [k, v] of r.loads) at(k).load = v.load;
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

/** `N EDITED` (§2.1, §11.3): each slot with any live edit of Ben's counts once; an order change counts once. A fit (Ben's or the coach's) reads `FITTED` instead. */
export function editCountOf(r: Pick<ResolvedEdits, 'swaps' | 'skipped' | 'order'> & Partial<Pick<ResolvedEdits, 'added' | 'sets' | 'reps' | 'loads' | 'coachEdits'>>): number {
  const coach = r.coachEdits ?? new Set<string>();
  const keys = <V extends { editId: string } | string>(m: ReadonlyMap<string, V> | undefined): string[] =>
    [...(m ?? new Map<string, V>())].flatMap(([k, v]) => (coach.has(typeof v === 'string' ? v : v.editId) ? [] : [k]));
  const slots = new Set<string>([...keys(r.swaps), ...keys(r.skipped), ...keys(r.added), ...keys(r.sets), ...keys(r.reps), ...keys(r.loads)]);
  return slots.size + (r.order === null ? 0 : 1);
}

/**
 * The resolved edits without the coach's (a coach fit's skips, sets and
 * adds): what a template change can carry. A fit is today only (rule 2);
 * only Ben's own edits go to `Update Push A`.
 */
export function benOnly(r: ResolvedEdits): ResolvedEdits {
  if (r.coachEdits.size === 0) return r;
  const keep = <V extends { editId: string } | string>(m: ReadonlyMap<string, V>): Map<string, V> => new Map([...m].filter(([, v]) => !r.coachEdits.has(typeof v === 'string' ? v : v.editId)));
  return { ...r, swaps: keep(r.swaps), skipped: keep(r.skipped), added: keep(r.added), sets: keep(r.sets), reps: keep(r.reps), loads: keep(r.loads) };
}

/** Slots Ben himself edited today (FT5: the built-in trim leaves them alone): added, or sets, reps or load changed. */
export function benEditedSlots(r: Pick<ResolvedEdits, 'added' | 'sets' | 'reps' | 'loads' | 'coachEdits'>): Set<string> {
  const out = new Set<string>();
  for (const m of [r.added, r.sets, r.reps, r.loads] as ReadonlyMap<string, { editId: string }>[]) for (const [k, v] of m) if (!r.coachEdits.has(v.editId)) out.add(k);
  return out;
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
export function editedSlots(slots: readonly TodaySlot[], r: Pick<ResolvedEdits, 'swaps' | 'skipped' | 'order'> & Partial<Pick<ResolvedEdits, 'added'>>): TodaySlot[] {
  const all = [...slots, ...[...(r.added ?? new Map<string, { exerciseId: string }>())].map(([slotKey, a]) => ({ slotKey, exerciseId: a.exerciseId, supersetGroup: null }))];
  const byKey = new Map(all.map((s) => [s.slotKey, s]));
  const ordered = (r.order ?? all.map((s) => s.slotKey)).map((k) => byKey.get(k)).filter((s): s is TodaySlot => s !== undefined);
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
/**
 * Swaps and adds whose plan the caller couldn't build (the exercise is gone)
 * are stale, and so is anything on an added slot that went with it.
 */
function dropUnplanned(resolved: ResolvedEdits, swaps: ReadonlyMap<string, SwapPlan>, adds: ReadonlyMap<string, SwapPlan>, slots: readonly TodaySlot[], edits: readonly TodayEdit[]): void {
  const stale = (editId: string) => {
    const o = resolved.outcomes.find((x) => x.editId === editId);
    if (o) o.result = 'stale';
  };
  for (const [slotKey, s] of [...resolved.swaps]) {
    if (swaps.get(slotKey)?.exercise.id === s.toExerciseId) continue;
    resolved.swaps.delete(slotKey);
    stale(s.editId);
    // The slot is back on its own exercise: a load typed for the substitute waits (review B1).
    const l = resolved.loads.get(slotKey);
    if (l !== undefined && l.exerciseId === s.toExerciseId) {
      resolved.loads.delete(slotKey);
      const at = resolved.outcomes.findIndex((o) => o.editId === l.editId);
      if (at >= 0) resolved.outcomes.splice(at, 1);
    }
    // ...and Ben's load for the slot's own exercise, which waited while the swap held, applies again (review r2 S1).
    const base = slots.find((x) => x.slotKey === slotKey)?.exerciseId ?? null;
    const own = liveEdits(edits).filter((e): e is Extract<TodayEdit, { kind: 'load' }> => e.kind === 'load' && e.slotKey === slotKey && (e.exerciseId ?? base) === base).at(-1);
    if (base !== null && own !== undefined) {
      resolved.loads.set(slotKey, { editId: own.editId, load: own.load, exerciseId: base });
      if (!resolved.outcomes.some((o) => o.editId === own.editId)) resolved.outcomes.push({ editId: own.editId, kind: 'load', result: 'applied' });
    }
  }
  for (const [slotKey, a] of [...resolved.added]) {
    if (adds.get(slotKey)?.exercise.id === a.exerciseId) continue;
    resolved.added.delete(slotKey);
    stale(a.editId);
    for (const m of [resolved.sets, resolved.reps, resolved.loads] as Map<string, { editId: string }>[]) {
      const e = m.get(slotKey);
      if (e === undefined) continue;
      m.delete(slotKey);
      stale(e.editId);
    }
    if (resolved.order !== null) resolved.order = resolved.order.filter((k) => k !== slotKey);
  }
}

/** An added exercise as a routine slot (§11, TE16): its own targets' shape, else the default shape; never a load from another exercise. */
function addedRoutineExercise(slotKey: string, sp: SwapPlan, order: number): RoutineExercise {
  const plan = sp.plan ?? [];
  const shapes =
    plan.length > 0
      ? plan.filter((p) => p.setType !== 'warmup').map((p) => ({ setType: p.setType, reps: p.planned.reps, durationS: p.planned.durationS }))
      : addedSlotShape(sp.exercise, sp.pin?.kind ?? null).templates;
  return {
    id: slotKey,
    exerciseId: sp.exercise.id,
    equipmentId: swapEquipmentId(sp),
    order,
    supersetGroup: null,
    setTemplates: shapes.map((t, i) => ({ id: deriveId(`today-add:${slotKey}:${String(i)}`), setType: t.setType, targetLoad: null, targetReps: t.reps, targetDurationS: t.durationS, targetRpe: null, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  };
}

export function applyTodayEditsToRoutine(
  input: RoutineStartInput,
  edits: readonly TodayEdit[],
  swaps: ReadonlyMap<string, SwapPlan>,
  adds: ReadonlyMap<string, SwapPlan> = new Map(),
): { input: RoutineStartInput; applied: AppliedEdits } {
  const slots = basisSlots({ kind: 'routine', routine: input.routine });
  const resolved = resolveTodayEdits(slots, edits);
  dropUnplanned(resolved, swaps, adds, slots, edits);
  const keep = keptGroups(slots, resolved.skipped);
  const byKey = new Map(input.routine.exercises.map((r) => [r.id, r]));
  const order = resolved.order ?? [...slots.map((s) => s.slotKey), ...resolved.added.keys()];
  const targets = new Map(input.targets ?? []);
  const exercises = new Map(input.exercises);
  const known = new Map(input.knownEquipment);
  const swapped: AppliedEdits['swapped'] = [];
  const rewritten: RoutineExercise[] = order.flatMap((key, i) => {
    const rex = byKey.get(key);
    const add = resolved.added.has(key) ? adds.get(key) : undefined;
    if (rex === undefined && add !== undefined) {
      exercises.set(add.exercise.id, add.exercise);
      if (add.pin !== null) known.set(add.pin.id, add.pin);
      if (add.plan !== null && add.plan.length > 0) targets.set(add.exercise.id, add.plan);
      else targets.delete(add.exercise.id);
      return [addedRoutineExercise(key, add, i)];
    }
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
    input: { ...input, routine: { ...input.routine, exercises: rewritten }, exercises, knownEquipment: known, targets, shape: shapesOf(resolved) },
    applied: { resolved, swapped },
  };
}

/**
 * `applyTodayEdits` for the next session of a non-routine workout: the source
 * workout with today's order and superset groups, and the swapped part roots
 * handed to the planner with their own plans (`RepeatInput.swaps`).
 */
export function applyTodayEditsToNext(
  input: RepeatInput,
  edits: readonly TodayEdit[],
  swaps: ReadonlyMap<string, SwapPlan>,
  adds: ReadonlyMap<string, SwapPlan> = new Map(),
): { input: RepeatInput; applied: AppliedEdits } {
  const slots = basisSlots({ kind: 'next', source: input.source });
  const resolved = resolveTodayEdits(slots, edits);
  dropUnplanned(resolved, swaps, adds, slots, edits);
  const keep = keptGroups(slots, resolved.skipped);
  const order = resolved.order ?? [...slots.map((s) => s.slotKey), ...resolved.added.keys()];
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
  const added = [...resolved.added.keys()].flatMap((key) => {
    const plan = adds.get(key);
    return plan === undefined ? [] : [{ slotKey: key, rank: rank.get(key) ?? order.length, plan }];
  });
  return {
    input: { ...input, source: { ...input.source, exercises: reordered }, ...(planSwaps.size > 0 ? { swaps: planSwaps } : {}), ...(added.length > 0 ? { added } : {}), shape: shapesOf(resolved) },
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
  /** Plans for added exercises, by their slot key (`addTargets`, §11). */
  adds?: ReadonlyMap<string, SwapPlan>;
  /**
   * What a fit needs besides the plan (fit-to-time §4.1): the pace the TIME
   * tile uses (`planPace` of Ben's recent workouts; absent: the defaults) and
   * which exercises a pain flag holds (left as they are). Read only when the
   * draft has a live fit.
   */
  fit?: { pace?: ResolvedPace; held?: (exerciseId: string) => boolean };
}

/** One line of a fit (fit-to-time §3.3): a slot trimmed, skipped, or (coach, longer) added. */
export type FitLine = FitCut | { slotKey: string; kind: 'add' };

/** The live fit as planned (fit-to-time §3.3, §6). Minutes are `estimateRemainingDuration`'s, unrounded. */
export interface FitOutcome {
  editId: string;
  minutes: number;
  by: 'built_in' | 'coach';
  actionId: string | null;
  status: FitStatus;
  beforeSeconds: number;
  afterSeconds: number;
  lines: FitLine[];
  /** The planned sets the built-in trim marked skipped (empty for a coach fit, whose edits are planned). */
  skipSetIds: string[];
  /** A slot Ben edited (or brought back) stays out of the trim: the card reads `≈ 52 min · 7 over 45`. */
  benKept: boolean;
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
  /** Each slot as planned before today's sets, reps and load (§11), by slot key: what the steppers step from. */
  plannedShape: Record<string, ShapeBefore>;
  /** The live fit, applied (fit-to-time FT4); null with none. */
  fit: FitOutcome | null;
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
    const { input, applied } = applyTodayEditsToRoutine(plan.input, edits.edits, edits.swaps, edits.adds);
    const out = planRoutineStart(input);
    const slotOf: Record<string, string> = {};
    out.aggregate.exercises.forEach((ex, i) => {
      const slotId = out.snap.slots[i]?.slotId;
      if (slotId !== undefined) slotOf[ex.id] = slotId;
    });
    const names = plan.input.exercises;
    const finished = finish(out.aggregate, slotOf, applied, edits.draft, (_slot, from) => names.get(from)?.name ?? 'Exercise');
    const plannedShape = out.shapedFrom ?? {};
    const mains = mainFlags([...plan.input.routine.exercises].sort((a, b) => a.order - b.order), (x) => compoundOf(x, input.exercises, edits));
    const mainOf = new Map(baseSlots.map((b, i) => [b.slotKey, mains[i] ?? false]));
    const fitted = applyFit(plan, edits, { aggregate: finished, slotOf, resolved: applied.resolved, plannedShape, mainOf, exercises: input.exercises, at: plan.input.at });
    return { kind: 'routine', ...out, aggregate: fitted.aggregate, slotOf, outcomes: applied.resolved.outcomes, resolved: applied.resolved, slots: editedSlots(baseSlots, applied.resolved), baseSlots, plannedShape, fit: fitted.fit };
  }
  const baseSlots = basisSlots({ kind: 'next', source: plan.input.source });
  const { input, applied } = applyTodayEditsToNext(plan.input, edits.edits, edits.swaps, edits.adds);
  const out = startWorkoutFromSession(input);
  const slotOf: Record<string, string> = {};
  out.aggregate.exercises.forEach((ex, i) => {
    const slotId = out.snap.slots[i]?.slotId;
    const root = slotId === undefined ? undefined : out.slotSources[slotId];
    if (root !== undefined) slotOf[ex.id] = root;
  });
  const names = new Map(plan.input.source.exercises.map((sx) => [sx.id, sx.exerciseName]));
  const finished = finish(out.aggregate, slotOf, applied, edits.draft, (slot, from) => names.get(slot) ?? plan.input.exercises.get(from)?.name ?? 'Exercise');
  const plannedShape = out.shapedFrom ?? {};
  // A history basis has no stored `Main`: the WL9 rule at read (fit-to-time §4.2).
  const mains = defaultMain(baseSlots, (x) => compoundOf(x, plan.input.exercises, edits));
  const mainOf = new Map(baseSlots.map((b, i) => [b.slotKey, mains[i] ?? false]));
  const fitted = applyFit(plan, edits, { aggregate: finished, slotOf, resolved: applied.resolved, plannedShape, mainOf, exercises: plan.input.exercises, at: plan.input.at });
  return { kind: 'next', ...out, aggregate: fitted.aggregate, slotOf, outcomes: applied.resolved.outcomes, resolved: applied.resolved, slots: editedSlots(baseSlots, applied.resolved), baseSlots, plannedShape, fit: fitted.fit };
}

/** Catalogue `mechanic` (Coaching knowledge), from the plan's exercises or a swap's or add's own. Unknown: not compound. */
function compoundOf(exerciseId: string, exercises: ReadonlyMap<string, { mechanic?: string | undefined }>, edits: TodayEditsInput): boolean {
  const ex = exercises.get(exerciseId) ?? [...edits.swaps.values(), ...(edits.adds?.values() ?? [])].find((p) => p.exercise.id === exerciseId)?.exercise;
  return ex?.mechanic === 'compound';
}

/**
 * The live fit on the planned preview (fit-to-time FT4, §4, §5): Ben's runs
 * the built-in trim after the planner (cut sets marked `skipped`,
 * `before_start`); the coach's is already in the plan as its own edits, and
 * its `before` is the same plan without them. Either sets `Finish by` (FT8)
 * and goes on the session's `todayEdits.fitted`.
 */
function applyFit(
  plan: TodayPlanInput,
  edits: TodayEditsInput,
  p: {
    aggregate: SessionAggregate;
    slotOf: Readonly<Record<string, string>>;
    resolved: ResolvedEdits;
    plannedShape: Readonly<Record<string, ShapeBefore>>;
    mainOf: ReadonlyMap<string, boolean>;
    exercises: ReadonlyMap<string, { mechanic?: string | undefined }>;
    at: ZonedTimestamp;
  },
): { aggregate: SessionAggregate; fit: FitOutcome | null } {
  const live = p.resolved.fit;
  if (live === null) return { aggregate: p.aggregate, fit: null };
  const pace = edits.fit?.pace ?? planPace([]);
  const target = live.minutes * 60;
  const rowsBySlot = new Map<string, string[]>();
  for (const ex of [...p.aggregate.exercises].sort((a, b) => a.order - b.order)) {
    const key = p.slotOf[ex.id] ?? ex.id;
    rowsBySlot.set(key, [...(rowsBySlot.get(key) ?? []), ex.id]);
  }
  const benEdited = benEditedSlots(p.resolved);
  let aggregate = p.aggregate;
  let fit: FitOutcome;
  if (live.by === 'built_in') {
    const slots: FitSlot[] = [...rowsBySlot].map(([slotKey, rows]) => {
      const row = p.aggregate.exercises.find((e) => e.id === rows[0]);
      const exerciseId = row?.exerciseId ?? '';
      return {
        slotKey,
        sessionExerciseIds: rows,
        // An added exercise is never a main lift.
        tier: fitTier({ main: !p.resolved.added.has(slotKey) && (p.mainOf.get(slotKey) ?? false), compound: compoundOf(exerciseId, p.exercises, edits) }),
        benEdited: benEdited.has(slotKey),
        held: edits.fit?.held?.(exerciseId) ?? false,
        supersetGroup: row?.supersetGroup ?? null,
      };
    });
    const r = fitPlanToMinutes({ preview: p.aggregate, slots, minutes: live.minutes, pace });
    aggregate = withSkipped(p.aggregate, new Set(r.skipSetIds), 'before_start');
    fit = { editId: live.editId, minutes: live.minutes, by: 'built_in', actionId: null, status: r.status, beforeSeconds: r.beforeSeconds, afterSeconds: r.afterSeconds, lines: r.cuts, skipSetIds: r.skipSetIds, benKept: r.status === 'over' && benEdited.size > 0 };
  } else {
    // Before: the same plan without the coach's edits (FT7: both numbers from the estimate).
    const without = { ...edits, edits: edits.edits.filter((e) => e.kind !== 'fit' && !(e.author === 'coach' && e.actionId === live.actionId)) };
    const before = estimateRemainingDuration(planWithTodayEdits(plan, without).aggregate, { pace }).seconds;
    const after = estimateRemainingDuration(p.aggregate, { pace }).seconds;
    const lines: FitLine[] = [];
    for (const key of rowsBySlot.keys()) {
      const sk = p.resolved.skipped.get(key);
      const st = p.resolved.sets.get(key);
      const ad = p.resolved.added.get(key);
      if (sk !== undefined && p.resolved.coachEdits.has(sk)) lines.push({ slotKey: key, kind: 'skip' });
      else if (ad !== undefined && p.resolved.coachEdits.has(ad.editId)) lines.push({ slotKey: key, kind: 'add' });
      else if (st !== undefined && p.resolved.coachEdits.has(st.editId)) lines.push({ slotKey: key, kind: 'sets', from: p.plannedShape[key]?.workingSets ?? st.workingSets, to: st.workingSets });
    }
    fit = { editId: live.editId, minutes: live.minutes, by: 'coach', actionId: live.actionId, status: after <= target ? 'fitted' : 'over', beforeSeconds: before, afterSeconds: after, lines, skipSetIds: [], benKept: false };
  }
  const todayEdits = aggregate.session.todayEdits;
  const fitted = { minutes: live.minutes, by: live.by, cuts: fit.lines.map((l) => ({ ...l })) };
  return {
    aggregate: { ...aggregate, session: { ...aggregate.session, finishBy: finishByFromFit(p.at, live.minutes), ...(todayEdits !== undefined ? { todayEdits: { ...todayEdits, fitted } } : {}) } },
    fit,
  };
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
          ...addedAndEdited(applied.resolved, rowOf),
        };
  return {
    ...aggregate,
    session: { ...aggregate.session, activeSetId, ...(todayEdits !== null ? { todayEdits } : {}) },
    sets,
  };
}

/** `SessionTodayEdits.added` / `edited` (§11.9), only when there are any (older sessions have neither). */
function addedAndEdited(r: ResolvedEdits, rowOf: ReadonlyMap<string, string>): Pick<SessionTodayEdits, 'added' | 'edited'> {
  const added = [...r.added.keys()].flatMap((key) => {
    const sx = rowOf.get(key);
    return sx === undefined ? [] : [{ sessionExerciseId: sx, slotKey: key }];
  });
  const keys = new Set([...r.sets.keys(), ...r.reps.keys(), ...r.loads.keys()]);
  const edited = [...keys].flatMap((key) => {
    const sx = rowOf.get(key);
    if (sx === undefined) return [];
    const kinds = [r.sets.has(key) ? ('sets' as const) : null, r.reps.has(key) ? ('reps' as const) : null, r.loads.has(key) ? ('load' as const) : null].filter((k): k is 'sets' | 'reps' | 'load' => k !== null);
    return [{ sessionExerciseId: sx, slotKey: key, kinds }];
  });
  return { ...(added.length > 0 ? { added } : {}), ...(edited.length > 0 ? { edited } : {}) };
}
