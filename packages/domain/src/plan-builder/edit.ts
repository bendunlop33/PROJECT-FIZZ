import {
  PLAN_LIMITS,
  type DraftSetTemplate,
  type DraftSlot,
  type PlanBuilderAnswers,
  type PlanDayAt,
  type PlanDayDraft,
  type PlanDayMove,
  type PlanDraft,
  type PlanDraftVersion,
  type PlanEditUndo,
  type Routine,
  type RoutineExercise,
  type SetTemplate,
  type ZonedTimestamp,
} from '@fizz/schemas';
import { deriveId } from '../stable';
import { toIso, toMs } from '../time';
import { planDayOf, planName, routineExerciseOfSlot, routineFromPlanDay } from '../session/coach-plan';
import { isDeleted } from '../session/routines';
import { pbPlanDays } from './engine';

/**
 * Editing a running plan (Ben, 22 Oct; 22–23 Oct D7; 26 Oct. plan-builder.md "Editing a running plan"; prototype
 * `diffItems`, `compose`, `planFor`, `changesCard`). Pure.
 *
 * - `pbDiffDays`: each difference between the plan's days as they are and the days rebuilt from Ben's new answers, as
 *   one item (`+ Hammer curl 2`, `Lat pulldown 3 → 4`, `− Leg curl`; a day whose focus changed is one whole-day item;
 *   a day added or gone is one item).
 * - `pbComposeDays`: the days with only the accepted items (rejected ones left as they were).
 * - `pbEditPreview`: every block week as it will be: done weeks and this week's done workouts never change (rule 2);
 *   weeks outside the chosen scope (`this week onwards`, `from week N`, `only week N`) stay as they are.
 * - `applyPlanEdit`: one versioned, idempotent write (rule 5): the new versions, each week's version, and the plan's
 *   workouts made to match the version that plans their next session (the week now, or next week for a day done this
 *   week), every change recorded for Undo. Stale is refused.
 * - `undoPlanEdit`: the plan and its workouts exactly as before, only while nothing changed since.
 * - `syncPlanWeek`: when a new block week starts, the plan's workouts follow that week's version (a change scoped
 *   `from week N` or `only week N` takes effect, or ends). Idempotent; nothing else moves.
 * - `movePlanDay` / `undoMovePlanDay`: `Move day` on a Set days plan, this week only.
 *
 * Loads: a kept exercise keeps its plan load; an added one takes the rebuild's (checked at the gym, rule 4); in the
 * workouts they are `Auto` (next-time targets from what Ben lifts).
 */

// ---------------------------------------------------------------------------
// Versions per week

/** The version that plans block week `w` (1-based): the week map's, else the applied version (else the current one). */
export function pbWeekVersionOf(plan: Pick<PlanDraft, 'weekVersions' | 'applied' | 'currentVersion'>, w: number): number {
  const map = plan.weekVersions;
  if (map !== undefined && map.length > 0) return map[Math.max(0, Math.min(map.length - 1, w - 1))] ?? plan.currentVersion;
  return plan.applied?.versionN ?? plan.currentVersion;
}

export function pbVersionOf(plan: Pick<PlanDraft, 'versions'>, n: number): PlanDraftVersion | null {
  return plan.versions.find((v) => v.n === n) ?? null;
}

/** The days of the version that plans week `w`. */
export function pbWeekDaysOf(plan: Pick<PlanDraft, 'weekVersions' | 'applied' | 'currentVersion' | 'versions'>, w: number): PlanDayDraft[] {
  return pbVersionOf(plan, pbWeekVersionOf(plan, w))?.days ?? [];
}

/** Working sets of a slot (top + back-offs, or working sets): warm-ups never count. */
export function pbSlotSets(slot: Pick<DraftSlot, 'setTemplates'>): number {
  return slot.setTemplates.filter((t) => t.setType !== 'warmup').length;
}

// ---------------------------------------------------------------------------
// The Changes card

export type PbChangeItem =
  | { id: string; kind: 'add'; dayIndex: number; exerciseId: string; sets: number; text: string }
  | { id: string; kind: 'remove'; dayIndex: number; exerciseId: string; text: string }
  | { id: string; kind: 'sets'; dayIndex: number; exerciseId: string; from: number; to: number; text: string }
  | { id: string; kind: 'focus'; dayIndex: number; text: string }
  | { id: string; kind: 'day'; dayIndex: number; text: string }
  | { id: string; kind: 'gone'; dayIndex: number; text: string };

export const PB_EDIT_COPY = {
  changes: 'Changes',
  none: 'None yet',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  accept: '✓ Accept',
  reject: '✕ Reject',
  applyTo: 'Apply to',
  thisWeekOn: 'This week onwards',
  fromWeek: (w: number) => `From week ${String(w)}`,
  onlyWeek: (w: number) => `Only week ${String(w)}`,
  counted: (n: number, of: number) => `${String(n)} of ${String(of)}`,
  apply: 'Apply changes',
  applied: 'Plan updated',
  undone: 'Changes undone',
  editPlan: 'Edit plan',
  moveDay: 'Move day',
  doToday: 'Do today ›',
  moved: (day: string, weekday: string) => `${day} on ${weekday} this week`,
  tooShort: (w: number) => `Already in week ${String(w)}`,
  changedSince: 'Changed since. Nothing undone.',
} as const;

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const pbWeekdayName = (d: number): string => WEEKDAY[((d % 7) + 7) % 7] ?? 'Mon';

const dayLabel = (d: Pick<PlanDayDraft, 'index' | 'name'>): string => `${String(d.index + 1)} · ${d.name}`;

/**
 * Each difference between `base` (the plan's days now) and `next` (the rebuild), one item each, in day order. A day
 * whose name changed (its focus or variation) is one whole-day item; a day added or gone is one item.
 */
export function pbDiffDays(base: readonly PlanDayDraft[], next: readonly PlanDayDraft[], nameOf: (exerciseId: string) => string): PbChangeItem[] {
  const out: PbChangeItem[] = [];
  const byIndex = new Map(base.map((d) => [d.index, d]));
  const nextIdx = new Set(next.map((d) => d.index));
  for (const d of [...next].sort((a, b) => a.index - b.index)) {
    const o = byIndex.get(d.index);
    if (o === undefined) {
      out.push({ id: `${String(d.index)}|day`, kind: 'day', dayIndex: d.index, text: `${dayLabel(d)}: new day` });
      continue;
    }
    if (o.name !== d.name) {
      out.push({ id: `${String(d.index)}|focus`, kind: 'focus', dayIndex: d.index, text: `${dayLabel(d)}: was ${o.name}` });
      continue;
    }
    for (const s of [...d.plan.slots].sort((a, b) => a.order - b.order)) {
      const x = o.plan.slots.find((y) => y.exerciseId === s.exerciseId);
      if (x === undefined) out.push({ id: `${String(d.index)}|+${s.exerciseId}`, kind: 'add', dayIndex: d.index, exerciseId: s.exerciseId, sets: pbSlotSets(s), text: `${d.name}: + ${nameOf(s.exerciseId)} ${String(pbSlotSets(s))}` });
      else if (pbSlotSets(x) !== pbSlotSets(s)) out.push({ id: `${String(d.index)}|=${s.exerciseId}`, kind: 'sets', dayIndex: d.index, exerciseId: s.exerciseId, from: pbSlotSets(x), to: pbSlotSets(s), text: `${d.name}: ${nameOf(s.exerciseId)} ${String(pbSlotSets(x))} → ${String(pbSlotSets(s))}` });
    }
    for (const x of [...o.plan.slots].sort((a, b) => a.order - b.order)) {
      if (!d.plan.slots.some((s) => s.exerciseId === x.exerciseId)) out.push({ id: `${String(d.index)}|-${x.exerciseId}`, kind: 'remove', dayIndex: d.index, exerciseId: x.exerciseId, text: `${d.name}: − ${nameOf(x.exerciseId)}` });
    }
  }
  for (const o of [...base].sort((a, b) => a.index - b.index)) if (!nextIdx.has(o.index)) out.push({ id: `${String(o.index)}|gone`, kind: 'gone', dayIndex: o.index, text: `${dayLabel(o)}: removed` });
  return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

/** A slot's set templates resized to `to` working sets (main lifts: the top set and `to − 1` back-offs). */
export function pbResizeSlot<T extends Pick<DraftSetTemplate, 'setType'>>(templates: readonly T[], to: number): T[] {
  const warm = templates.filter((t) => t.setType === 'warmup');
  const work = templates.filter((t) => t.setType !== 'warmup');
  const n = Math.max(1, Math.min(10, to));
  const top = work.find((t) => t.setType === 'top');
  if (top !== undefined) {
    const backs = work.filter((t) => t.setType === 'backoff');
    const like = backs.at(-1) ?? { ...top, setType: 'backoff' };
    return [...warm, top, ...Array.from({ length: n - 1 }, (_, i) => backs[i] ?? like)];
  }
  const first = work[0];
  if (first === undefined) return [...templates];
  return [...warm, ...Array.from({ length: n }, (_, i) => work[i] ?? work.at(-1) ?? first)];
}

/** Where `slot` goes among `slots`: before the first of `next`'s later slots that is there, else last. */
function insertAt(slots: readonly { exerciseId: string }[], nextOrder: readonly string[], exerciseId: string): number {
  const at = nextOrder.indexOf(exerciseId);
  for (const id of nextOrder.slice(at + 1)) {
    const k = slots.findIndex((s) => s.exerciseId === id);
    if (k >= 0) return k;
  }
  return slots.length;
}

const ordered = (d: Pick<PlanDayDraft, 'plan'>): DraftSlot[] => [...d.plan.slots].sort((a, b) => a.order - b.order);

/**
 * `base` with only the accepted items (prototype `compose`): a whole-day item takes the rebuilt day; the rest one by
 * one. Items that don't fit this base (an exercise already there, or not there to remove) change nothing.
 */
export function pbComposeDays(base: readonly PlanDayDraft[], next: readonly PlanDayDraft[], items: readonly PbChangeItem[], rejected: ReadonlySet<string>): PlanDayDraft[] {
  const acc = items.filter((it) => !rejected.has(it.id));
  const byIndex = new Map(base.map((d) => [d.index, d]));
  const out: PlanDayDraft[] = [];
  for (const nd of next) {
    const b = byIndex.get(nd.index);
    const mine = acc.filter((it) => it.dayIndex === nd.index);
    if (b === undefined) {
      if (mine.some((it) => it.kind === 'day')) out.push(nd);
      continue;
    }
    if (mine.some((it) => it.kind === 'focus') && b.name !== nd.name) {
      out.push(nd);
      continue;
    }
    let slots = ordered(b);
    const nextOrder = ordered(nd).map((s) => s.exerciseId);
    for (const it of mine) {
      if (it.kind === 'add') {
        const s = nd.plan.slots.find((x) => x.exerciseId === it.exerciseId);
        if (s === undefined || slots.some((x) => x.exerciseId === it.exerciseId)) continue;
        const k = insertAt(slots, nextOrder, it.exerciseId);
        slots = [...slots.slice(0, k), { ...s, supersetGroup: null }, ...slots.slice(k)];
      } else if (it.kind === 'remove') {
        slots = slots.filter((x) => x.exerciseId !== it.exerciseId);
      } else if (it.kind === 'sets') {
        slots = slots.map((x) => (x.exerciseId === it.exerciseId ? { ...x, setTemplates: pbResizeSlot(x.setTemplates, it.to) } : x));
      }
    }
    // A superset whose mate left is no longer one.
    const groups = new Map<string, number>();
    for (const s of slots) if (s.supersetGroup !== null) groups.set(s.supersetGroup, (groups.get(s.supersetGroup) ?? 0) + 1);
    slots = slots.map((s, i) => ({ ...s, order: i, ...(s.supersetGroup !== null && (groups.get(s.supersetGroup) ?? 0) < 2 ? { supersetGroup: null } : {}) }));
    if (slots.length === 0) continue;
    out.push({ ...b, plan: { ...b.plan, slots } });
  }
  const nextIdx = new Set(next.map((d) => d.index));
  for (const b of base) if (!nextIdx.has(b.index) && !acc.some((it) => it.kind === 'gone' && it.dayIndex === b.index)) out.push(b);
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Scope and the weeks

/** `This week onwards` is `from` the current week. */
export type PbEditScope = { kind: 'from'; week: number } | { kind: 'only'; week: number };

export function pbScopeHas(scope: PbEditScope, w: number): boolean {
  return scope.kind === 'from' ? w >= scope.week : w === scope.week;
}

/** Where the plan is: the block week now and the plan days done in it. */
export interface PbEditBlock {
  /** 1-based; never past the plan's length here (a done block isn't edited). */
  week: number;
  doneThisWeek: readonly number[];
}

export interface PbEditPreviewInput {
  plan: Pick<PlanDraft, 'weekVersions' | 'applied' | 'currentVersion' | 'versions'>;
  /** The plan's length now (its current answers). */
  weeksNow: number;
  /** The length the new answers ask for. */
  weeks: number;
  next: readonly PlanDayDraft[];
  block: PbEditBlock;
  rejected: ReadonlySet<string>;
  scope: PbEditScope;
  nameOf: (exerciseId: string) => string;
}

export interface PbEditPreview {
  /** Every change against the plan as it is this week (the Changes card's lines). */
  items: PbChangeItem[];
  accepted: number;
  /** Each block week's days as they will be (1…`weeks`). */
  weekDays: PlanDayDraft[][];
  /** Weeks whose days change. */
  changed: number[];
  /** The scope can't be met: the plan is already past the new length. */
  tooShort: boolean;
}

const sameDays = (a: readonly PlanDayDraft[], b: readonly PlanDayDraft[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The plan's days for week `w`, past its old end: its last week's. */
function prevDays(plan: PbEditPreviewInput['plan'], weeksNow: number, w: number): PlanDayDraft[] {
  return pbWeekDaysOf(plan, Math.min(w, weeksNow));
}

export function pbEditPreview(input: PbEditPreviewInput): PbEditPreview {
  const cur = input.block.week;
  const ref = prevDays(input.plan, input.weeksNow, cur);
  const items = pbDiffDays(ref, input.next, input.nameOf);
  const done = new Set(input.block.doneThisWeek);
  const weekDays: PlanDayDraft[][] = [];
  const changed: number[] = [];
  for (let w = 1; w <= input.weeks; w += 1) {
    const prev = prevDays(input.plan, input.weeksNow, w);
    if (w < cur || !pbScopeHas(input.scope, w) || w > input.weeks) {
      weekDays.push(prev);
      continue;
    }
    let days = pbComposeDays(prev, input.next, items, input.rejected);
    // This week's done workouts never change (rule 2): those days stay as they were this week.
    if (w === cur && done.size > 0) {
      const before = new Map(prev.map((d) => [d.index, d]));
      days = days.flatMap((d) => (done.has(d.index) ? (before.has(d.index) ? [before.get(d.index) as PlanDayDraft] : []) : [d]));
      for (const d of prev) if (done.has(d.index) && !days.some((x) => x.index === d.index)) days.push(d);
      days.sort((a, b) => a.index - b.index);
    }
    if (!sameDays(days, prev)) changed.push(w);
    weekDays.push(days);
  }
  return { items, accepted: items.filter((it) => !input.rejected.has(it.id)).length, weekDays, changed, tooShort: input.weeks < cur };
}

// ---------------------------------------------------------------------------
// Making the plan's workouts match a version

export type PlanEditChange =
  | { kind: 'write'; next: PlanDraft; expectedVersion: number; create: Routine[]; update: { next: Routine; expectedVersion: number }[] }
  | { kind: 'duplicate'; current: PlanDraft }
  | { kind: 'stale'; current: PlanDraft }
  /** Nothing to write (no accepted change, or the week already matches). */
  | { kind: 'nothing'; current: PlanDraft }
  | { kind: 'changed_since'; current: PlanDraft; names: string[] }
  | { kind: 'invalid'; current: PlanDraft; reason: 'done_week' | 'too_short' | 'too_many_versions' | 'not_running' };

/** The version each plan day's next session is planned from: this week's, or next week's for a day done this week. */
export function pbDayTargets(plan: Pick<PlanDraft, 'weekVersions' | 'applied' | 'currentVersion' | 'versions'>, weeks: number, block: PbEditBlock): Map<number, number | null> {
  const done = new Set(block.doneThisWeek);
  const out = new Map<number, number | null>();
  const nowN = pbWeekVersionOf(plan, block.week);
  const nextN = pbWeekVersionOf(plan, Math.min(weeks, block.week + 1));
  const idx = new Set<number>();
  for (const n of [nowN, nextN]) for (const d of pbVersionOf(plan, n)?.days ?? []) idx.add(d.index);
  for (const i of idx) {
    const n = done.has(i) ? nextN : nowN;
    out.set(i, (pbVersionOf(plan, n)?.days ?? []).some((d) => d.index === i) ? n : null);
  }
  return out;
}

/** Which version's day each plan day's workouts match now (absent: the applied version's, for a day Apply made). */
export function pbDaysAtOf(plan: Pick<PlanDraft, 'daysAt' | 'applied'>): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const m of plan.applied?.made ?? []) out.set(m.dayIndex, plan.applied?.versionN ?? null);
  for (const d of plan.daysAt ?? []) out.set(d.dayIndex, d.versionN);
  return out;
}

interface RoutineWrites {
  create: Routine[];
  update: Map<string, { next: Routine; expectedVersion: number }>;
  snapshots: PlanEditUndo['routines'];
  made: { dayIndex: number; routineId: string; version: number }[];
}

function snap(r: Routine): NonNullable<PlanEditUndo['routines'][number]['before']> {
  return {
    name: r.name,
    exercises: r.exercises,
    ...(r.createdFromPlan === undefined ? {} : { createdFromPlan: r.createdFromPlan }),
    ...(r.planDay === undefined ? {} : { planDay: r.planDay }),
    deletedAtUtc: r.deletedAtUtc ?? null,
  };
}

/** A routine written by this edit: its newest content, version bumped once, the before snapshot kept once. */
function touch(w: RoutineWrites, stored: Routine, patch: Partial<Routine>, opId: string, at: ZonedTimestamp): void {
  const prior = w.update.get(stored.id);
  const base = prior?.next ?? stored;
  const next: Routine = { ...base, ...patch, version: stored.version + 1, updatedAtUtc: at.utc, lastOpId: `${opId}:r` };
  w.update.set(stored.id, { next, expectedVersion: stored.version });
  if (!w.snapshots.some((s) => s.routineId === stored.id)) w.snapshots.push({ routineId: stored.id, versionAfter: next.version, before: snap(stored) });
}

/** A day's exercise changes (add, remove, sets) onto one of its workouts; Ben's own changes to other rows stay. */
function patchExercises(exercises: readonly RoutineExercise[], from: PlanDayDraft, to: PlanDayDraft, planId: string, toN: number, opId: string, atUtc: string): RoutineExercise[] {
  let out = [...exercises].sort((a, b) => a.order - b.order);
  const toOrder = ordered(to).map((s) => s.exerciseId);
  for (const x of from.plan.slots) if (!to.plan.slots.some((s) => s.exerciseId === x.exerciseId)) out = out.filter((e) => e.exerciseId !== x.exerciseId);
  for (const s of ordered(to)) {
    const x = from.plan.slots.find((y) => y.exerciseId === s.exerciseId);
    if (x === undefined) {
      if (out.some((e) => e.exerciseId === s.exerciseId)) continue;
      const k = insertAt(out, toOrder, s.exerciseId);
      const row: RoutineExercise = { ...routineExerciseOfSlot(planId, toN, s, k), supersetGroup: null, structureChangedAtUtc: atUtc };
      out = [...out.slice(0, k), row, ...out.slice(k)];
    } else if (pbSlotSets(x) !== pbSlotSets(s)) {
      out = out.map((e) => {
        if (e.exerciseId !== s.exerciseId) return e;
        const resized = pbResizeSlot<SetTemplate>(e.setTemplates, pbSlotSets(s)).map((t, i) => ({ ...t, id: deriveId(`plan-edit-set:${e.id}:${opId}:${String(i)}`) }));
        return { ...e, setTemplates: resized, structureChangedAtUtc: atUtc };
      });
    }
  }
  return out.map((e, i) => ({ ...e, order: i }));
}

/** The workouts of plan day `i` (live), the one Apply made (or the edit's own) first. */
function dayRoutines(plan: PlanDraft, routines: readonly Routine[], i: number, live: boolean): Routine[] {
  const madeIds = new Set((plan.applied?.made ?? []).filter((m) => m.dayIndex === i).map((m) => m.routineId));
  const mine = routines.filter((r) => (live ? !isDeleted(r) : true) && (madeIds.has(r.id) || (planDayOf(r)?.planId === plan.id && planDayOf(r)?.dayIndex === i)));
  return mine.sort((a, b) => (madeIds.has(a.id) === madeIds.has(b.id) ? (a.id < b.id ? -1 : 1) : madeIds.has(a.id) ? -1 : 1));
}

/** A plan day's workout ID when an edit adds the day: from the plan and the day, so a retry (or a later re-add) finds it. */
export const planEditRoutineIdFor = (planId: string, dayIndex: number): string => deriveId(`plan-edit-day:${planId}:${String(dayIndex)}`);

/**
 * The plan's workouts made to match `targets` (version per day; null: the day isn't in the plan), from what they match
 * now (`daysAt`). Writes go into `w`; returns the new mirror list.
 */
function syncRoutines(plan: PlanDraft, routines: readonly Routine[], targets: ReadonlyMap<number, number | null>, w: RoutineWrites, opId: string, at: ZonedTimestamp): PlanDayAt[] {
  const now = pbDaysAtOf(plan);
  const all = new Set([...now.keys(), ...targets.keys()]);
  const out: PlanDayAt[] = [];
  const current = (r: Routine): Routine => w.update.get(r.id)?.next ?? r;
  for (const i of [...all].sort((a, b) => a - b)) {
    const from = now.get(i) ?? null;
    const to = targets.has(i) ? (targets.get(i) ?? null) : from;
    out.push({ dayIndex: i, versionN: to });
    if (from === to) continue;
    const fromDay = from === null ? null : (pbVersionOf(plan, from)?.days.find((d) => d.index === i) ?? null);
    const toDay = to === null ? null : (pbVersionOf(plan, to)?.days.find((d) => d.index === i) ?? null);
    const live = dayRoutines(plan, routines, i, true);
    if (toDay === null || to === null) {
      for (const r of live) touch(w, r, { deletedAtUtc: at.utc }, opId, at);
      continue;
    }
    const link = { planId: plan.id, dayIndex: i, versionN: to, splitDayId: toDay.splitDayId, atUtc: at.utc };
    const whole = (r: Routine): Partial<Routine> => {
      const made = routineFromPlanDay({ plan, versionN: to, day: toDay, id: r.id, opId, at, rotationAtUtc: at.utc });
      return { name: made.name, exercises: made.exercises, createdFromPlan: link, deletedAtUtc: null, ...(r.planDay === undefined ? {} : { planDay: { ...r.planDay, splitDayId: toDay.splitDayId ?? r.planDay.splitDayId, mainLiftExerciseId: made.exercises.find((e) => e.main === true)?.exerciseId ?? null } }) };
    };
    if (fromDay === null || live.length === 0) {
      // The day (back) in the plan: its own workout again, or a new one.
      const any = dayRoutines(plan, routines, i, false)[0] ?? routines.find((r) => r.id === planEditRoutineIdFor(plan.id, i));
      if (any !== undefined) {
        touch(w, any, whole(current(any)), opId, at);
        continue;
      }
      const id = planEditRoutineIdFor(plan.id, i);
      const r = routineFromPlanDay({ plan, versionN: to, day: toDay, id, opId, at, rotationAtUtc: toIso(toMs(at.utc) + i) });
      w.create.push({ ...r, lastOpId: `${opId}:r` });
      w.made.push({ dayIndex: i, routineId: id, version: r.version });
      w.snapshots.push({ routineId: id, versionAfter: r.version, before: null });
      continue;
    }
    if (fromDay.name !== toDay.name) {
      // A whole-day change: the day's own workout takes the new day; its other templates (another main lift) go.
      const [head, ...rest] = live;
      if (head !== undefined) touch(w, head, whole(current(head)), opId, at);
      for (const r of rest) touch(w, r, { deletedAtUtc: at.utc }, opId, at);
      continue;
    }
    for (const r of live) {
      const c = current(r);
      const exercises = patchExercises(c.exercises, fromDay, toDay, plan.id, to, opId, at.utc);
      if (JSON.stringify(exercises) === JSON.stringify(c.exercises)) continue;
      touch(w, r, { exercises }, opId, at);
    }
  }
  return out;
}

/** Versions nothing names any more are dropped (oldest first) to stay inside the limit. */
function pruned(plan: PlanDraft, keep: ReadonlySet<number>): PlanDraftVersion[] | null {
  let versions = [...plan.versions];
  while (versions.length > PLAN_LIMITS.maxVersions) {
    const k = versions.findIndex((v) => !keep.has(v.n) && v.n !== plan.currentVersion);
    if (k < 0) return null;
    versions = [...versions.slice(0, k), ...versions.slice(k + 1)];
  }
  return versions;
}

function referenced(plan: PlanDraft): Set<number> {
  const s = new Set<number>([plan.currentVersion]);
  if (plan.applied !== null) s.add(plan.applied.versionN);
  for (const n of plan.weekVersions ?? []) s.add(n);
  for (const d of plan.daysAt ?? []) if (d.versionN !== null) s.add(d.versionN);
  const e = plan.lastEdit;
  if (e != null) {
    s.add(e.before.currentVersion);
    for (const n of e.before.weekVersions ?? []) s.add(n);
    for (const d of e.before.daysAt ?? []) if (d.versionN !== null) s.add(d.versionN);
  }
  return s;
}

function remember(opIds: readonly string[], opId: string): string[] {
  return [...opIds, opId].slice(-PLAN_LIMITS.maxOps);
}

function writes(): RoutineWrites {
  return { create: [], update: new Map(), snapshots: [], made: [] };
}

// ---------------------------------------------------------------------------
// Apply changes

export interface PlanEditApplyInput {
  expectedVersion: number;
  opId: string;
  at: ZonedTimestamp;
  /** The new answers (every version this edit writes keeps them). */
  answers: PlanBuilderAnswers;
  gymId: string | null;
  equipmentVersion: string;
  /** Each block week's days as previewed (`pbEditPreview.weekDays`). */
  weekDays: readonly (readonly PlanDayDraft[])[];
  /** Each new accessory slot's week-1 reps (the rebuild's `startReps`). */
  startReps: Readonly<Record<string, number>>;
  block: PbEditBlock;
  /** Ben's workouts as stored (inside the write). */
  routines: readonly Routine[];
}

function builderAnswersOf(plan: PlanDraft): PlanBuilderAnswers | null {
  return pbVersionOf(plan, plan.currentVersion)?.builder?.answers ?? null;
}

/**
 * `Apply changes` on a running plan. Done weeks never change (refused if asked to); each distinct week's days not
 * already a version become one new version with the new answers; the newest is current (it carries the plan's
 * length and effort). The plan's workouts follow the version for each day's next session. Undo puts it all back.
 */
export function applyPlanEdit(current: PlanDraft, input: PlanEditApplyInput): PlanEditChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion) return { kind: 'stale', current };
  if (current.status !== 'applied' || current.applied === null) return { kind: 'invalid', current, reason: 'not_running' };
  const nowAnswers = builderAnswersOf(current);
  const weeksNow = nowAnswers?.weeks ?? input.weekDays.length;
  const cur = input.block.week;
  if (input.weekDays.length < cur) return { kind: 'invalid', current, reason: 'too_short' };
  for (let w = 1; w < cur; w += 1) if (!sameDays(input.weekDays[w - 1] ?? [], pbWeekDaysOf(current, Math.min(w, weeksNow)))) return { kind: 'invalid', current, reason: 'done_week' };
  const answersChanged = JSON.stringify(nowAnswers) !== JSON.stringify(input.answers);
  const top = Math.max(...current.versions.map((v) => v.n));
  const curV = pbVersionOf(current, pbWeekVersionOf(current, cur));
  if (curV === null) return { kind: 'stale', current };
  // A kept slot keeps its start reps; a new slot takes the rebuild's.
  const startReps = { ...input.startReps, ...(curV.builder?.startReps ?? {}) };
  const added: PlanDraftVersion[] = [];
  const mint = (days: readonly PlanDayDraft[]): number => {
    const same = added.find((v) => sameDays(v.days, days));
    if (same !== undefined) return same.n;
    const n = top + added.length + 1;
    added.push({
      ...curV,
      n,
      parentN: curV.n,
      status: 'current',
      actionId: deriveId(`plan-edit-action:${input.opId}:${String(n)}`),
      turnId: 'plan-builder',
      request: { text: '', gymId: input.gymId, origin: 'builder' },
      rawArgs: '',
      days: [...days],
      checks: [],
      rationale: null,
      contextHash: 'plan-builder',
      equipmentVersion: input.equipmentVersion.slice(0, 128) || 'none',
      createdAt: input.at,
      builder: { engine: 1, answers: input.answers, gymId: input.gymId, ...(Object.keys(startReps).length === 0 ? {} : { startReps }) },
    });
    return n;
  };
  const map: number[] = [];
  let anyDays = false;
  for (let w = 1; w <= input.weekDays.length; w += 1) {
    const days = input.weekDays[w - 1] ?? [];
    const was = pbWeekVersionOf(current, Math.min(w, weeksNow));
    if (w < cur || sameDays(days, pbVersionOf(current, was)?.days ?? [])) {
      map.push(was);
      continue;
    }
    if (days.length === 0) return { kind: 'invalid', current, reason: 'done_week' };
    anyDays = true;
    map.push(mint(days));
  }
  if (!anyDays && !answersChanged) return { kind: 'nothing', current };
  // The plan's own answers (length, effort) changed with no day change: one version for them, this week's days.
  if (added.length === 0) mint(curV.days);
  const newest = added.at(-1);
  if (newest === undefined) return { kind: 'nothing', current };
  const versions = [...current.versions.map((v) => (v.status === 'current' ? { ...v, status: 'replaced' as const } : v)), ...added.map((v) => ({ ...v, status: v.n === newest.n ? ('current' as const) : ('replaced' as const) }))];
  const before: PlanEditUndo['before'] = { weekVersions: current.weekVersions ?? null, daysAt: current.daysAt ?? null, currentVersion: current.currentVersion, name: current.name };
  let next: PlanDraft = { ...current, versions, currentVersion: newest.n, weekVersions: map };
  const w = writes();
  const targets = pbDayTargets(next, input.weekDays.length, input.block);
  const daysAt = syncRoutines(next, input.routines, targets, w, input.opId, input.at);
  const dayCount = new Set(daysAt.filter((d) => d.versionN !== null).map((d) => d.dayIndex)).size;
  next = {
    ...next,
    daysAt,
    name: planName(Math.max(1, dayCount)),
    applied: { ...current.applied, made: [...current.applied.made, ...w.made.filter((m) => !current.applied?.made.some((x) => x.routineId === m.routineId))] },
    lastEdit: { opId: input.opId, versionAfter: current.version + 1, before, added: added.map((v) => v.n), routines: w.snapshots },
    opIds: remember(current.opIds, input.opId),
    version: current.version + 1,
    updatedAtUtc: input.at.utc,
  };
  const kept = pruned(next, referenced(next));
  if (kept === null) return { kind: 'invalid', current, reason: 'too_many_versions' };
  next = { ...next, versions: kept };
  return { kind: 'write', next, expectedVersion: current.version, create: w.create, update: [...w.update.values()] };
}

/** Undo of `Apply changes`: the plan and its workouts exactly as before, only while nothing changed since (rule 2, 5). */
export function undoPlanEdit(current: PlanDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp; routines: readonly Routine[] }): PlanEditChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const e = current.lastEdit ?? null;
  if (current.version !== input.expectedVersion || e === null || e.versionAfter !== current.version || current.status !== 'applied' || current.applied === null) return { kind: 'stale', current };
  const byId = new Map(input.routines.map((r) => [r.id, r]));
  const changed: string[] = [];
  const update: { next: Routine; expectedVersion: number }[] = [];
  for (const s of e.routines) {
    const r = byId.get(s.routineId);
    if (r === undefined) continue;
    if (r.version !== s.versionAfter) {
      changed.push(r.name);
      continue;
    }
    const next: Routine = { ...r, version: r.version + 1, updatedAtUtc: input.at.utc, lastOpId: `${input.opId}:r` };
    if (s.before === null) next.deletedAtUtc = input.at.utc;
    else {
      next.name = s.before.name;
      next.exercises = s.before.exercises;
      next.deletedAtUtc = s.before.deletedAtUtc;
      if (s.before.createdFromPlan === undefined) delete next.createdFromPlan;
      else next.createdFromPlan = s.before.createdFromPlan;
      if (s.before.planDay === undefined) delete next.planDay;
      else next.planDay = s.before.planDay;
    }
    update.push({ next, expectedVersion: r.version });
  }
  if (changed.length > 0) return { kind: 'changed_since', current, names: [...new Set(changed)] };
  const drop = new Set(e.added);
  const versions = current.versions.filter((v) => !drop.has(v.n)).map((v) => ({ ...v, status: v.n === e.before.currentVersion ? ('current' as const) : ('replaced' as const) }));
  const createdIds = new Set(e.routines.filter((s) => s.before === null).map((s) => s.routineId));
  const next: PlanDraft = {
    ...current,
    versions,
    currentVersion: e.before.currentVersion,
    name: e.before.name,
    applied: { ...current.applied, made: current.applied.made.filter((m) => !createdIds.has(m.routineId)) },
    lastEdit: null,
    opIds: remember(current.opIds, input.opId),
    version: current.version + 1,
    updatedAtUtc: input.at.utc,
  };
  if (e.before.weekVersions === null) delete next.weekVersions;
  else next.weekVersions = e.before.weekVersions;
  if (e.before.daysAt === null) delete next.daysAt;
  else next.daysAt = e.before.daysAt;
  return { kind: 'write', next, expectedVersion: current.version, create: [], update };
}

/**
 * A new block week: the plan's workouts follow the version for each day's next session (a change `from week N` or
 * `only week N` starts or ends). Idempotent on (plan, week, targets): nothing to do is `nothing`.
 */
export function syncPlanWeek(current: PlanDraft, input: { at: ZonedTimestamp; block: PbEditBlock; weeks: number; routines: readonly Routine[] }): PlanEditChange {
  if (current.status !== 'applied' || current.applied === null || current.weekVersions === undefined) return { kind: 'nothing', current };
  const targets = pbDayTargets(current, input.weeks, input.block);
  const now = pbDaysAtOf(current);
  if ([...targets].every(([i, n]) => (now.get(i) ?? null) === n)) return { kind: 'nothing', current };
  const opId = deriveId(`plan-week-sync:${current.id}:${String(current.version)}:${String(input.block.week)}:${[...targets].map(([i, n]) => `${String(i)}=${String(n)}`).join(',')}`);
  if (current.opIds.includes(opId)) return { kind: 'duplicate', current };
  const w = writes();
  const daysAt = syncRoutines(current, input.routines, targets, w, opId, input.at);
  const next: PlanDraft = {
    ...current,
    daysAt,
    applied: { ...current.applied, made: [...current.applied.made, ...w.made.filter((m) => !current.applied?.made.some((x) => x.routineId === m.routineId))] },
    opIds: remember(current.opIds, opId),
    version: current.version + 1,
    updatedAtUtc: input.at.utc,
  };
  return { kind: 'write', next, expectedVersion: current.version, create: w.create, update: [...w.update.values()] };
}

// ---------------------------------------------------------------------------
// Move day (Set days plans, this week only)

/** Each plan day's weekday in week `w` (Set days plans), moves applied; null on Any days. */
export function pbWeekdaysOf(answers: Pick<PlanBuilderAnswers, 'schedule' | 'days' | 'sessions'>, moves: readonly PlanDayMove[] | undefined, w: number, dayIndexes: readonly number[]): Map<number, number> | null {
  if (answers.schedule !== 'set') return null;
  const base = pbPlanDays(answers);
  const out = new Map<number, number>();
  for (const i of dayIndexes) {
    const d = base[i];
    if (d !== undefined) out.set(i, d);
  }
  for (const m of moves ?? []) if (m.week === w && out.has(m.dayIndex)) out.set(m.dayIndex, m.weekday);
  return out;
}

export type PlanMoveChange = { kind: 'write'; next: PlanDraft; expectedVersion: number } | { kind: 'duplicate'; current: PlanDraft } | { kind: 'stale'; current: PlanDraft } | { kind: 'invalid'; current: PlanDraft };

/**
 * `Move day`: plan day `dayIndex` on `weekday` in block week `week` only (Legs → Sat). Refused when the day is done
 * this week, the weekday holds another plan day, or the plan isn't on Set days.
 */
export function movePlanDay(current: PlanDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp; block: PbEditBlock; dayIndex: number; weekday: number }): PlanMoveChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'applied') return { kind: 'stale', current };
  const a = builderAnswersOf(current);
  const days = pbWeekDaysOf(current, input.block.week).map((d) => d.index);
  const map = a === null ? null : pbWeekdaysOf(a, current.moves, input.block.week, days);
  if (map === null || !map.has(input.dayIndex) || input.block.doneThisWeek.includes(input.dayIndex)) return { kind: 'invalid', current };
  if ([...map].some(([i, d]) => i !== input.dayIndex && d === input.weekday)) return { kind: 'invalid', current };
  const before = current.moves ?? [];
  const moves = [...before.filter((m) => !(m.week === input.block.week && m.dayIndex === input.dayIndex)), { week: input.block.week, dayIndex: input.dayIndex, weekday: input.weekday }].slice(-84);
  const version = current.version + 1;
  return { kind: 'write', next: { ...current, moves, lastMove: { opId: input.opId, versionAfter: version, before }, opIds: remember(current.opIds, input.opId), version, updatedAtUtc: input.at.utc }, expectedVersion: current.version };
}

export function undoMovePlanDay(current: PlanDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp }): PlanMoveChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const m = current.lastMove ?? null;
  if (current.version !== input.expectedVersion || m === null || m.versionAfter !== current.version) return { kind: 'stale', current };
  const version = current.version + 1;
  return { kind: 'write', next: { ...current, moves: m.before, lastMove: null, opIds: remember(current.opIds, input.opId), version, updatedAtUtc: input.at.utc }, expectedVersion: current.version };
}
