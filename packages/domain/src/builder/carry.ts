import type { BuilderCarryItem, BuilderSetup, WorkoutDraft } from '@fizz/schemas';
import { slotsOf } from './arrange';
import { applyBuilderEdit } from './edit';
import { FIT_CARRY, type BuilderFitStep } from './fit';
import { setWorkingCount, workingCount } from './set-rows';
import type { BuilderContext, BuilderGroupName, BuilderInfoLookup, BuilderWorkout } from './types';
import { BUILD_LIMITS } from '@fizz/schemas';

/**
 * The carry-over of the sets Time cut (Ben, 23 Oct; fit-to-time 22 Oct revision item 3, review SP3/SP1). Pure.
 *
 * - `carryOverOffer`: what Time's fit took today, by muscle group (an exercise left out counts all its sets, a trimmed
 *   one what it lost; the main lift is never cut; what Ben changed himself since isn't the fit's), routed to each
 *   group's next day in plan order (abs: the next day), at most 4 sets in all, each group 2 or more. It is only ever an
 *   offer: `Carry over` / `✕`, never applied by default.
 * - `carriedItems`: what an answered carry-over still carries: Ben's `carried` items, never more per group than the
 *   fit as it ended took.
 * - `pendingCarryOvers`: the carry-overs that land on a day's next workout: from a workout Ben did (started from that
 *   draft), applied, within 14 days, and that day not done since.
 * - `landCarryOver`: the next workout with them: the sets on that group's first exercise that isn't the main lift (else
 *   the main lift, when it's the group's only one; at most 10 sets), else the exercise they were cut from, added. After that day's own fit: what Ben carried isn't cut again.
 */

/** A plan day as the carry-over routes to it. */
export interface CarryDay {
  dayIndex: number;
  name: string;
  groups: readonly BuilderGroupName[];
}

export type CarryItem = BuilderCarryItem;

/** The sets the fit took, per group, in the order the groups first appear in the workout before the fit. */
export function fitLostByGroup(steps: readonly BuilderFitStep[], base: BuilderWorkout, info: BuilderInfoLookup): { group: BuilderGroupName; sets: number; exerciseId: string }[] {
  const baseSlots = new Map(slotsOf(base.blocks).map((s) => [s.key, s] as const));
  const lost = new Map<BuilderGroupName, { sets: number; top: { exerciseId: string; sets: number } }>();
  const add = (exerciseId: string, n: number): void => {
    const g = info(exerciseId)?.group;
    if (g === undefined || n <= 0) return;
    const was = lost.get(g);
    if (was === undefined) lost.set(g, { sets: n, top: { exerciseId, sets: n } });
    else lost.set(g, { sets: was.sets + n, top: n > was.top.sets ? { exerciseId, sets: n } : was.top });
  };
  for (const st of steps) {
    if (st.kind === 'drop') {
      const s = baseSlots.get(st.slotKey);
      if (s !== undefined && s.main !== true) add(st.exerciseId, workingCount(s));
    } else if (st.kind === 'sets' && st.to < st.from && baseSlots.get(st.slotKey)?.main !== true) add(st.exerciseId, st.from - st.to);
  }
  const order = slotsOf(base.blocks).map((s) => info(s.exerciseId)?.group).filter((g): g is BuilderGroupName => g !== undefined);
  return [...lost.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([group, v]) => ({ group, sets: v.sets, exerciseId: v.top.exerciseId }));
}

/** A group's next day in plan order after `fromDayIndex` (wrapping, never the same day); abs: the next day. Null: none. */
export function carryTargetDay(group: BuilderGroupName, fromDayIndex: number, days: readonly CarryDay[]): CarryDay | null {
  const others = [...days].filter((d) => d.dayIndex !== fromDayIndex).sort((a, b) => a.dayIndex - b.dayIndex);
  const after = [...others.filter((d) => d.dayIndex > fromDayIndex), ...others.filter((d) => d.dayIndex < fromDayIndex)];
  if (group === 'Abs') return after[0] ?? null;
  return after.find((d) => d.groups.includes(group)) ?? null;
}

export interface CarryOfferInput {
  steps: readonly BuilderFitStep[];
  base: BuilderWorkout;
  info: BuilderInfoLookup;
  /** The day's main group: first on a tie. */
  mainGroup: BuilderGroupName | null;
  fromDayIndex: number;
  days: readonly CarryDay[];
}

/** `carryOverOffer`: the offer, most lost first (a tie: the day's main group, then the earlier one), 4 sets in all. */
export function carryOverOffer(input: CarryOfferInput): CarryItem[] {
  const lost = fitLostByGroup(input.steps, input.base, input.info);
  const ranked = lost.map((x, i) => ({ ...x, i })).sort((a, b) => b.sets - a.sets || (a.group === input.mainGroup ? -1 : b.group === input.mainGroup ? 1 : 0) || a.i - b.i);
  const out: CarryItem[] = [];
  let left: number = FIT_CARRY.maxSets;
  for (const x of ranked) {
    const n = Math.min(x.sets, left);
    if (n < FIT_CARRY.minSets) continue;
    const day = carryTargetDay(x.group, input.fromDayIndex, input.days);
    if (day === null) continue;
    out.push({ group: x.group, sets: n, exerciseId: x.exerciseId, toDayIndex: day.dayIndex, toDayName: day.name.slice(0, 60) });
    left -= n;
  }
  return out;
}

/** `+3 Triceps sets on your next Shoulders day` (each item, minimal copy). */
export function carryItemText(x: Pick<CarryItem, 'group' | 'sets' | 'toDayName'>): string {
  return `+${String(x.sets)} ${x.group} ${x.sets === 1 ? 'set' : 'sets'} on your next ${x.toDayName} day`;
}

/** Ben's carried items, each capped by what the fit as it ended took from that group (rule 5: never more than was cut). */
export function carriedItems(carry: BuilderSetup['carryOver'], lost: readonly { group: BuilderGroupName; sets: number }[]): CarryItem[] {
  if (carry === undefined || carry.choice !== 'carried') return [];
  return carry.items.flatMap((x) => {
    const n = Math.min(x.sets, lost.find((l) => l.group === x.group)?.sets ?? 0);
    return n <= 0 ? [] : [{ ...x, sets: n }];
  });
}

/** How long an applied carry-over waits for its day (the builder's drafts last as long). */
export const CARRY_DAYS = 14;

export interface PendingCarryInput {
  /** The started builder drafts with a carry-over, each with what it still carries (`carriedItems`). */
  sources: readonly { draft: Pick<WorkoutDraft, 'sessionId' | 'builderKey'>; items: readonly CarryItem[]; atUtc: string }[];
  /** Workouts (finished or in progress, not discarded): when each started and which plan day it was. */
  sessions: readonly { sessionId: string; startedAtUtc: string; planDay?: { planId: string; dayIndex: number } | undefined }[];
  planId: string;
  dayIndex: number;
  nowUtc: string;
}

/**
 * `pendingCarryOvers`: what lands on the next workout of (planId, dayIndex): each source workout Ben did (its session
 * is in `sessions`) of the same plan, applied within 14 days, whose items go to that day, while that day hasn't been
 * started since the source workout. Several sources add up per group, capped at 4 per group.
 */
export function pendingCarryOvers(input: PendingCarryInput): CarryItem[] {
  const nowMs = Date.parse(input.nowUtc);
  const byGroup = new Map<BuilderGroupName, CarryItem>();
  for (const src of input.sources) {
    if (src.draft.builderKey?.planId !== input.planId || src.draft.sessionId === null) continue;
    if (nowMs - Date.parse(src.atUtc) > CARRY_DAYS * 86_400_000) continue;
    const session = input.sessions.find((s) => s.sessionId === src.draft.sessionId);
    if (session === undefined) continue;
    const done = input.sessions.some((s) => s.sessionId !== session.sessionId && s.planDay?.planId === input.planId && s.planDay.dayIndex === input.dayIndex && s.startedAtUtc > session.startedAtUtc);
    if (done) continue;
    for (const x of src.items) {
      if (x.toDayIndex !== input.dayIndex) continue;
      const was = byGroup.get(x.group);
      byGroup.set(x.group, was === undefined ? x : { ...was, sets: Math.min(FIT_CARRY.maxSets, was.sets + x.sets) });
    }
  }
  return [...byGroup.values()];
}

/**
 * `landCarryOver`: the workout with the carried sets: on the group's first exercise that isn't the main lift (the main
 * lift when it's the group's only one; up to the builder's 10 sets), else the exercise they came from added with that many sets (not when it can't be: not here, the
 * workout at its limit). Returns the workout and the slots it changed.
 */
export function landCarryOver(w: BuilderWorkout, items: readonly CarryItem[], ctx: BuilderContext): { workout: BuilderWorkout; changed: string[] } {
  let workout = w;
  const changed: string[] = [];
  for (const x of items) {
    const inGroup = slotsOf(workout.blocks).filter((s) => ctx.info(s.exerciseId)?.group === x.group);
    // Its first exercise that isn't the main lift; when the main lift is the group's only one, the main lift (more back-offs).
    const slot = inGroup.find((s) => s.main !== true) ?? inGroup[0];
    if (slot !== undefined) {
      const n = Math.min(BUILD_LIMITS.maxWorkingSets, workingCount(slot) + x.sets);
      if (n === workingCount(slot)) continue;
      const next = setWorkingCount(slot, n, ctx.loads(slot.exerciseId));
      workout = { ...workout, blocks: workout.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === slot.key ? next : s)) })) };
      changed.push(slot.key);
      continue;
    }
    if (ctx.info(x.exerciseId) === null) continue;
    const r = applyBuilderEdit(workout, { kind: 'add_exercise', exerciseId: x.exerciseId }, ctx);
    if (!r.ok) continue;
    const added = slotsOf(r.workout.blocks).find((s) => !slotsOf(workout.blocks).some((o) => o.key === s.key));
    if (added === undefined) continue;
    const next = setWorkingCount(added, Math.max(1, Math.min(BUILD_LIMITS.maxWorkingSets, x.sets)), ctx.loads(added.exerciseId));
    workout = { ...r.workout, blocks: r.workout.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === added.key ? next : s)) })) };
    changed.push(added.key);
  }
  return { workout, changed };
}
