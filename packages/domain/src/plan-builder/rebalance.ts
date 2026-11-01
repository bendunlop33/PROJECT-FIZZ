import type { DraftSetTemplate, DraftSlot, MuscleGroup, PlanDayDraft, PlanDraft } from '@fizz/schemas';

import { deriveId } from '../stable';
import { PRESET_SPLITS } from '../training-profile';
import { pbResizeSlot, pbSlotSets, pbWeekDaysOf, type PbEditBlock } from './edit';

import { directMuscleGroup, MUSCLE_FLAG_CEILING, muscleSetCredits, muscleStatus, PLAN_MUSCLE_GROUPS, type MuscleSetTotals } from '../progress/muscle-sets';
import { muscleFlags, plannedMuscleSets, PLAN_MUSCLES_COPY, rangesOf, type InfoOf, type MuscleFlag, type MuscleGoalInput, type PlanMuscleDay, type PlanMuscleRow } from '../progress/plan-muscles';

/**
 * (Ben, 1 Nov: "You need to look at it holistically") **Rebalance**: one proposal for the whole plan that brings every
 * muscle group's direct sets into the range that applies, without any day growing past its minutes. Pure and
 * deterministic; the coach can explain it, code makes sure of it. docs/design/plan-muscles.md §5.
 *
 * Every group is looked at together on the typical week (direct, assisted, the applicable range; `directRange`), and
 * each candidate change is simulated on the whole plan: it is taken only when the group it is for gets closer to its
 * range and **no other group leaves its range**. In this order (Ben, 1 Nov):
 *
 * 1. **Trim an overshoot**: a group above **20** direct sets a week (`MUSCLE_FLAG_CEILING`; no approved rule calls
 *    11–20 too much) loses sets from its own accessories (never a main lift; never below 2 sets a row; a row goes only
 *    when the excess is at least its sets), largest first. A day with no room for a gap fill may also give up sets
 *    from a group above its target, on that day only, never taking it below its target.
 * 2. **Swap**: an accessory for one of its alternatives (the caller's, already checked for the gym, pain flags and
 *    not-preferred) when that covers a low group with no time added and keeps the other groups in range.
 * 3. **Superset**: the new isolation paired with a non-competing accessory on the day (no muscle group in common,
 *    after the day's last main lift), which costs less time than straight sets.
 * 4. **Add sets** as straight sets, only as a last resort.
 *
 * A low group's sets go to the days of its own split day (Biceps with Back on the pull days, `PRESET_SPLITS`), else
 * the days that already train it (direct or assisted), at most two days (Ben's own example:
 * "Add curls to Pull A and Pull B"), split as evenly as possible, at the end of the day (after every main lift: no
 * arm isolation before a main lift, rule G order). Sized towards the **lower edge** of its range, at most **+2 sets
 * per group per proposal** (rule 1 / V5); the rest of the gap stays flagged.
 *
 * Time (approved rule 1: sets that fit ≈ (minutes − 10) ÷ 3): a day's estimate is 10 min + 3 min per straight working
 * set, or 2.3 per set inside a superset (the plan builder's own pace, `pbSetMinutes`). A change that would take a day
 * past its `minutes` is never made; a day already over keeps every set it has and gets none added.
 */

export const REBALANCE_TIME = {
  /** Rule 1: the minutes a session spends outside working sets (warm-ups, setup). */
  overheadMin: 10,
  /** Rule 1: about 3 minutes a working set with its rest. */
  setMin: 3,
  /** The plan builder's pace for a set inside a superset (`pbSetMinutes`). */
  supersetSetMin: 2.3,
  /** Never trimmed below this many working sets a row. */
  minRowSets: 2,
  /** A low group's new sets go to at most this many days. */
  maxDays: 2,
  /** Added sets per group per proposal (rule 1 / V5: grow by 1–2 sets); the rest of the gap stays visible. */
  maxAddPerGroup: 2,
} as const;

export type RebalanceOp =
  | { id: string; kind: 'trim'; dayIndex: number; key: string; exerciseId: string; from: number; to: number; group: MuscleGroup }
  | { id: string; kind: 'swap'; dayIndex: number; key: string; fromExerciseId: string; toExerciseId: string; sets: number; group: MuscleGroup }
  | { id: string; kind: 'add'; dayIndex: number; key: string; exerciseId: string; sets: number; supersetWith: string | null; group: MuscleGroup };

export interface RebalancePorts {
  infoOf: InfoOf;
  /** Exercises to cover a low group with, best first (lead group = the group), already usable here, not held for pain and not not-preferred. */
  isolationsFor: (group: MuscleGroup) => readonly string[];
  /** An exercise's alternatives, best first, already checked the same way. */
  alternativesOf: (exerciseId: string) => readonly string[];
}

export interface RebalanceInput extends MuscleGoalInput {
  days: readonly PlanMuscleDay[];
  ports: RebalancePorts;
}

export interface RebalanceResult {
  ops: RebalanceOp[];
  days: PlanMuscleDay[];
  before: MuscleSetTotals;
  after: MuscleSetTotals;
  flagsBefore: MuscleFlag[];
  flagsAfter: MuscleFlag[];
  minutesBefore: Map<number, number>;
  minutesAfter: Map<number, number>;
}

/** A day's estimate in minutes, to 0.1 (rule 1 and the builder's superset pace); screens round it. */
export function rebalanceDayMinutes(d: Pick<PlanMuscleDay, 'rows'>): number {
  let m = REBALANCE_TIME.overheadMin;
  for (const r of d.rows) m += r.sets * (r.superset === null ? REBALANCE_TIME.setMin : REBALANCE_TIME.supersetSetMin);
  return Math.round(m * 10) / 10;
}

/** How far a group is from its range (0 inside). */
function gapOf(totals: MuscleSetTotals, g: MuscleGoalInput, m: MuscleGroup): number {
  const r = rangesOf(totals, g).get(m) ?? null;
  if (r === null) return 0;
  const d = totals.get(m)?.direct ?? 0;
  return d < r.min ? r.min - d : d > Math.max(r.max, MUSCLE_FLAG_CEILING) ? d - Math.max(r.max, MUSCLE_FLAG_CEILING) : 0;
}

/** Groups in range under `before` that would leave it under `after`. */
function breaks(before: MuscleSetTotals, after: MuscleSetTotals, g: MuscleGoalInput, except: MuscleGroup): boolean {
  const rb = rangesOf(before, g);
  const ra = rangesOf(after, g);
  return PLAN_MUSCLE_GROUPS.some((m) => {
    if (m === except) return false;
    const b = rb.get(m) ?? null;
    const a = ra.get(m) ?? null;
    if (a === null || b === null) return false;
    const wasIn = muscleStatus(before.get(m)?.direct ?? 0, b) === 'in';
    const nowIn = muscleStatus(after.get(m)?.direct ?? 0, a) === 'in';
    return wasIn && !nowIn;
  });
}

const lastMainOrder = (d: PlanMuscleDay): number => Math.max(-1, ...d.rows.filter((r) => r.main).map((r) => r.order));

const SUPERSET_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

function freeLabel(d: PlanMuscleDay): string | null {
  const used = new Set(d.rows.map((r) => r.superset).filter((x): x is string => x !== null));
  return SUPERSET_LABELS.find((l) => !used.has(l)) ?? null;
}

function groupsOf(infoOf: InfoOf, exerciseId: string): Set<MuscleGroup> {
  return new Set(muscleSetCredits(infoOf(exerciseId)).keys());
}

export function rebalancePlan(input: RebalanceInput): RebalanceResult {
  const { ports } = input;
  const original = input.days.map((d) => ({ ...d, rows: d.rows.map((r) => ({ ...r })) }));
  let days: PlanMuscleDay[] = original.map((d) => ({ ...d, rows: d.rows.map((r) => ({ ...r })) }));
  const ops: RebalanceOp[] = [];
  const totals = (ds: readonly PlanMuscleDay[]) => plannedMuscleSets(ds, ports.infoOf);
  const before = totals(original);
  const flagsBefore = muscleFlags(before, input);
  const dayOf = (ds: readonly PlanMuscleDay[], i: number) => ds.find((d) => d.dayIndex === i);
  const replaceDay = (ds: readonly PlanMuscleDay[], next: PlanMuscleDay) => ds.map((d) => (d.dayIndex === next.dayIndex ? next : d));
  let seq = 0;
  const nextId = (kind: string) => `${kind}-${String((seq += 1))}`;

  // 1. Trim overshoots.
  for (const f of muscleFlags(totals(days), input).filter((x) => x.status === 'above')) {
    for (;;) {
      const now = totals(days);
      // Only above the 20-a-week ceiling (no approved rule calls 11–20 too much).
      const excess = (now.get(f.group)?.direct ?? 0) - Math.max(rangesOf(now, input).get(f.group)?.max ?? Infinity, MUSCLE_FLAG_CEILING);
      if (excess <= 0) break;
      const rows = days
        .filter((d) => d.skipped !== true)
        .flatMap((d) => d.rows.filter((r) => !r.main && directMuscleGroup(ports.infoOf(r.exerciseId)) === f.group).map((r) => ({ d, r })))
        .sort((a, b) => b.r.sets - a.r.sets || b.r.order - a.r.order || b.d.dayIndex - a.d.dayIndex);
      let step: { d: PlanMuscleDay; r: PlanMuscleRow; to: number } | null = null;
      for (const c of rows) {
        const to = c.r.sets > REBALANCE_TIME.minRowSets ? c.r.sets - 1 : excess >= c.r.sets ? 0 : null;
        if (to === null) continue;
        const nd: PlanMuscleDay = { ...c.d, rows: to === 0 ? c.d.rows.filter((x) => x.key !== c.r.key) : c.d.rows.map((x) => (x.key === c.r.key ? { ...x, sets: to } : x)) };
        const trial = replaceDay(days, nd);
        if (breaks(now, totals(trial), input, f.group)) continue;
        step = { ...c, to };
        break;
      }
      if (step === null) break;
      const s = step;
      const prev = ops.find((o): o is Extract<RebalanceOp, { kind: 'trim' }> => o.kind === 'trim' && o.dayIndex === s.d.dayIndex && o.key === s.r.key);
      if (prev !== undefined) prev.to = s.to;
      else ops.push({ id: nextId('trim'), kind: 'trim', dayIndex: s.d.dayIndex, key: s.r.key, exerciseId: s.r.exerciseId, from: s.r.sets, to: s.to, group: f.group });
      days = replaceDay(days, { ...s.d, rows: s.to === 0 ? s.d.rows.filter((x) => x.key !== s.r.key) : s.d.rows.map((x) => (x.key === s.r.key ? { ...x, sets: s.to } : x)) });
    }
  }

  // 2–4. Cover low groups, the biggest gap first.
  for (const f of muscleFlags(totals(days), input).filter((x) => x.status === 'below')) {
    // 2. Swap, no time added.
    for (;;) {
      const now = totals(days);
      const gap = gapOf(now, input, f.group);
      if (gap <= 0) break;
      let best: { day: PlanMuscleDay; row: PlanMuscleRow; to: string; gap: number; trial: PlanMuscleDay[] } | null = null;
      for (const d of days) {
        if (d.skipped === true) continue;
        for (const r of [...d.rows].sort((a, b) => a.order - b.order)) {
          if (r.main || ops.some((o) => o.dayIndex === d.dayIndex && o.key === r.key)) continue;
          for (const to of ports.alternativesOf(r.exerciseId)) {
            if (to === r.exerciseId || d.rows.some((x) => x.exerciseId === to) || (d.avoid ?? []).includes(to)) continue;
            const trial = replaceDay(days, { ...d, rows: d.rows.map((x) => (x.key === r.key ? { ...x, exerciseId: to } : x)) });
            const after = totals(trial);
            const g2 = gapOf(after, input, f.group);
            if (g2 >= gap || breaks(now, after, input, f.group)) continue;
            if (best === null || g2 < best.gap) best = { day: d, row: r, to, gap: g2, trial };
          }
        }
      }
      if (best === null) break;
      ops.push({ id: nextId('swap'), kind: 'swap', dayIndex: best.day.dayIndex, key: best.row.key, fromExerciseId: best.row.exerciseId, toExerciseId: best.to, sets: best.row.sets, group: f.group });
      days = best.trial;
    }

    // 3–4. A new isolation: superset first, straight sets last; never past a day's minutes.
    const now = totals(days);
    const range = rangesOf(now, input).get(f.group) ?? null;
    const gapNow = range === null ? 0 : Math.ceil(range.min - (now.get(f.group)?.direct ?? 0) - 1e-9);
    const need = Math.min(gapNow, REBALANCE_TIME.maxAddPerGroup);
    if (need <= 0) continue;
    // The days that train it (direct or assisted), then the days of its own preset split day (Back and Biceps are Pull,
    // PRESET_SPLITS): biceps work goes to the pull days.
    const kin = PRESET_SPLITS.ppl.find((x) => (x.bodyParts as readonly string[]).includes(f.group))?.bodyParts ?? [];
    const trains = days
      .filter((d) => d.skipped !== true)
      .map((d) => {
        let credit = 0;
        let near = 0;
        for (const r of d.rows) {
          const c = muscleSetCredits(ports.infoOf(r.exerciseId));
          credit += ((c.get(f.group)?.assisted ?? 0) + (c.get(f.group)?.direct ?? 0)) * r.sets;
          const lead = directMuscleGroup(ports.infoOf(r.exerciseId));
          if (lead !== null && lead !== f.group && (kin as readonly string[]).includes(lead)) near += r.sets;
        }
        return { d, credit, near };
      })
      .filter((x) => x.credit > 0 || x.near > 0)
      .sort((a, b) => b.near - a.near || b.credit - a.credit || a.d.dayIndex - b.d.dayIndex)
      .slice(0, REBALANCE_TIME.maxDays)
      .map((x) => x.d)
      .sort((a, b) => a.dayIndex - b.dayIndex);
    const targets = trains.length > 0 ? trains : days.filter((d) => d.skipped !== true).sort((a, b) => rebalanceDayMinutes(a) - rebalanceDayMinutes(b) || a.dayIndex - b.dayIndex).slice(0, 1);
    const pick = ports.isolationsFor(f.group).find((id) => directMuscleGroup(ports.infoOf(id)) === f.group && targets.every((d) => !d.rows.some((r) => r.exerciseId === id) && !(d.avoid ?? []).includes(id)));
    if (pick === undefined) continue;
    const n = Math.min(targets.length, need);
    const shares = Array.from({ length: n }, (_, i) => Math.floor(need / n) + (i < need % n ? 1 : 0));
    let left = need;
    targets.slice(0, n).forEach((t, i) => {
      if (left <= 0) return;
      const want = Math.min(left, shares[i] ?? 0);
      const base = dayOf(days, t.dayIndex);
      const orig = dayOf(original, t.dayIndex);
      if (base === undefined || orig === undefined) return;
      const pickGroups = groupsOf(ports.infoOf, pick);
      const after = lastMainOrder(base);
      const partner = [...base.rows]
        .sort((a, b) => b.order - a.order)
        .find((r) => !r.main && r.superset === null && r.order > after && [...groupsOf(ports.infoOf, r.exerciseId)].every((g) => !pickGroups.has(g)));
      const label = freeLabel(base);
      const order = Math.max(-1, ...base.rows.map((r) => r.order)) + 1;
      const key = `rebalance:${pick}:${String(t.dayIndex)}`;
      const cap = orig.minutes === null ? rebalanceDayMinutes(orig) : Math.max(orig.minutes, 0);
      const attempt = (day: PlanMuscleDay): { sets: number; day: PlanMuscleDay; with: string | null } | null => {
        for (let sets = want; sets >= 1; sets -= 1) {
          const tries: { day: PlanMuscleDay; with: string | null }[] = [];
          if (partner !== undefined && label !== null && day.rows.some((r) => r.key === partner.key)) {
            tries.push({ day: { ...day, rows: [...day.rows.map((r) => (r.key === partner.key ? { ...r, superset: label } : r)), { key, exerciseId: pick, sets, main: false, order, superset: label }] }, with: partner.key });
          }
          tries.push({ day: { ...day, rows: [...day.rows, { key, exerciseId: pick, sets, main: false, order, superset: null }] }, with: null });
          const ok = tries.find((x) => rebalanceDayMinutes(x.day) <= cap && !breaks(totals(days), totals(replaceDay(days, x.day)), input, f.group));
          if (ok !== undefined) return { sets, ...ok };
        }
        return null;
      };
      let work = base;
      const freed: Extract<RebalanceOp, { kind: 'trim' }>[] = [];
      let got = attempt(work);
      // No room: free minutes on the same day from a group above its target (never below its target, never a main
      // lift, never below 2 sets a row), one set at a time.
      while (got === null) {
        const now = totals(replaceDay(days, work));
        const ranges = rangesOf(now, input);
        const row = [...work.rows]
          .filter((r) => {
            const h = directMuscleGroup(ports.infoOf(r.exerciseId));
            const rh = h === null ? null : (ranges.get(h) ?? null);
            return !r.main && r.sets > REBALANCE_TIME.minRowSets && h !== null && h !== f.group && rh !== null && (now.get(h)?.direct ?? 0) - 1 >= rh.max;
          })
          .sort((a, b) => b.sets - a.sets || b.order - a.order)[0];
        if (row === undefined) break;
        const prev = freed.find((o) => o.key === row.key);
        if (prev !== undefined) prev.to = row.sets - 1;
        else freed.push({ id: nextId('trim'), kind: 'trim', dayIndex: t.dayIndex, key: row.key, exerciseId: row.exerciseId, from: row.sets, to: row.sets - 1, group: directMuscleGroup(ports.infoOf(row.exerciseId)) ?? f.group });
        work = { ...work, rows: work.rows.map((r) => (r.key === row.key ? { ...r, sets: r.sets - 1 } : r)) };
        got = attempt(work);
      }
      if (got === null) return;
      days = replaceDay(days, got.day);
      ops.push(...freed, { id: nextId('add'), kind: 'add', dayIndex: t.dayIndex, key, exerciseId: pick, sets: got.sets, supersetWith: got.with, group: f.group });
      left -= got.sets;
    });
  }
  const after = totals(days);
  return {
    ops,
    days,
    before,
    after,
    flagsBefore,
    flagsAfter: muscleFlags(after, input),
    minutesBefore: new Map(original.map((d) => [d.dayIndex, rebalanceDayMinutes(d)])),
    minutesAfter: new Map(days.map((d) => [d.dayIndex, rebalanceDayMinutes(d)])),
  };
}

// ---------------------------------------------------------------------------
// Applying it: the plan's own weeks (the Changes review's Apply / Undo, `applyPlanEdit`)

/** What a new isolation's slot looks like (the caller's: its catalogue key and reps). */
export interface RebalanceNewSlot {
  catalogueId: string;
  /** The builder's accessory band (8–12, `pbAtWeek`) unless the caller knows better. */
  reps: { min: number; max: number };
}

function withoutLoad(t: DraftSetTemplate): DraftSetTemplate {
  const out = { ...t };
  delete out.load;
  return out;
}

/** Plain working sets for a new slot: no load (the workout plans it from Ben's history on the day's kit, rule 4). */
function newSlotTemplates(sets: number, reps: { min: number; max: number }): DraftSetTemplate[] {
  return Array.from({ length: Math.max(1, Math.min(10, sets)) }, () => ({ setType: 'working' as const, reps: { ...reps }, durationS: null, targetRpe: null, restS: null }));
}

/**
 * One week's days with the accepted ops: a trim resizes (or drops) the exercise's slot, a swap puts the alternative
 * in the slot (its sets, reps, rest and place kept; its old load dropped so the workout plans the new one), an add puts
 * a new slot at the end of the day, paired with its superset mate when it has one. An op that no longer fits the day
 * (the exercise isn't there, or already is) changes nothing. Pure.
 */
export function pbRebalanceDays(days: readonly PlanDayDraft[], ops: readonly RebalanceOp[], ctx: { planId: string; slotOf: (exerciseId: string) => RebalanceNewSlot | null; mateOf: (op: Extract<RebalanceOp, { kind: 'add' }>) => string | null }): PlanDayDraft[] {
  return days.map((d) => {
    const mine = ops.filter((o) => o.dayIndex === d.index);
    if (mine.length === 0) return d;
    let slots: DraftSlot[] = [...d.plan.slots].sort((a, b) => a.order - b.order);
    for (const o of mine) {
      if (o.kind === 'trim') {
        slots = o.to === 0 ? slots.filter((s) => s.exerciseId !== o.exerciseId || s.main) : slots.map((s) => (s.exerciseId === o.exerciseId && !s.main ? { ...s, setTemplates: pbResizeSlot(s.setTemplates, o.to) } : s));
      } else if (o.kind === 'swap') {
        const to = ctx.slotOf(o.toExerciseId);
        if (to === null || slots.some((s) => s.exerciseId === o.toExerciseId)) continue;
        slots = slots.map((s) => {
          if (s.exerciseId !== o.fromExerciseId || s.main) return s;
          // The old exercise's builder state, checked history and loads don't carry over to another exercise.
          const next: DraftSlot = { ...s, exerciseId: o.toExerciseId, catalogueId: to.catalogueId, checkedOn: null, setTemplates: s.setTemplates.map((t) => withoutLoad(t)) };
          delete next.builder;
          delete next.checkedHistoryVersion;
          return next;
        });
      } else {
        const add = ctx.slotOf(o.exerciseId);
        if (add === null || slots.some((s) => s.exerciseId === o.exerciseId)) continue;
        const mate = ctx.mateOf(o);
        const mateSlot = mate === null ? undefined : slots.find((s) => s.exerciseId === mate && s.supersetGroup === null && !s.main);
        const used = new Set(slots.map((s) => s.supersetGroup).filter((x): x is string => x !== null));
        const label = mateSlot === undefined ? null : (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].find((l) => !used.has(l)) ?? null);
        const slot: DraftSlot = { slotKey: deriveId(`rebalance-slot:${ctx.planId}:${String(d.index)}:${o.exerciseId}`), exerciseId: o.exerciseId, catalogueId: add.catalogueId, order: slots.length, main: false, supersetGroup: label, setTemplates: newSlotTemplates(o.sets, add.reps), checkedOn: null };
        if (label !== null && mateSlot !== undefined) {
          // The pair sits together: the new slot straight after its mate.
          const at = slots.indexOf(mateSlot);
          slots = [...slots.slice(0, at), { ...mateSlot, supersetGroup: label }, slot, ...slots.slice(at + 1)];
        } else slots = [...slots, slot];
      }
    }
    slots = slots.map((s, i) => ({ ...s, order: i }));
    return slots.length === 0 ? d : { ...d, plan: { ...d.plan, slots } };
  });
}

/**
 * Every block week's days for `applyPlanEdit`: done weeks as they are, this week's days already done as they are (rule 2),
 * and the rest with the accepted ops, from this week to the end of the block.
 */
export function pbRebalanceWeekDays(
  plan: Pick<PlanDraft, 'weekVersions' | 'applied' | 'currentVersion' | 'versions'>,
  weeks: number,
  block: PbEditBlock,
  ops: readonly RebalanceOp[],
  ctx: Parameters<typeof pbRebalanceDays>[2] & {
    /** A week's day as its workout runs it now (`pbDayAsWorkout`: Ben's own template edits kept); absent: as stored. */
    asWorkout?: (w: number, day: PlanDayDraft) => PlanDayDraft;
  },
): PlanDayDraft[][] {
  const done = new Set(block.doneThisWeek);
  return Array.from({ length: weeks }, (_, i) => {
    const w = i + 1;
    const days = pbWeekDaysOf(plan, w);
    if (w < block.week) return days;
    const mine = w === block.week ? ops.filter((o) => !done.has(o.dayIndex)) : ops;
    const live = ctx.asWorkout === undefined ? days : days.map((d) => (mine.some((o) => o.dayIndex === d.index) ? (ctx.asWorkout?.(w, d) ?? d) : d));
    return pbRebalanceDays(live, mine, ctx);
  });
}

/** One op as a Changes line: `Pull A: + Dumbbell curl 2 (superset with Cable crunch)`, `Pull B: Lat pulldown 4 → 3`. */
export function rebalanceOpText(o: RebalanceOp, dayName: string, nameOf: (id: string) => string, mateName: string | null): string {
  if (o.kind === 'trim') return o.to === 0 ? `${dayName}: − ${nameOf(o.exerciseId)}` : `${dayName}: ${nameOf(o.exerciseId)} ${String(o.from)} → ${String(o.to)}`;
  if (o.kind === 'swap') return `${dayName}: ${nameOf(o.fromExerciseId)} → ${nameOf(o.toExerciseId)}`;
  return `${dayName}: + ${nameOf(o.exerciseId)} ${String(o.sets)}${mateName === null ? '' : ` (superset with ${mateName})`}`;
}

/** The typical days with only these ops (Ben skipped some lines): what the card's totals and day lengths read then. */
export function rebalanceDaysWith(days: readonly PlanMuscleDay[], ops: readonly RebalanceOp[]): PlanMuscleDay[] {
  return days.map((d) => {
    let rows = d.rows.map((r) => ({ ...r }));
    for (const o of ops.filter((x) => x.dayIndex === d.dayIndex)) {
      if (o.kind === 'trim') rows = o.to === 0 ? rows.filter((r) => r.key !== o.key) : rows.map((r) => (r.key === o.key ? { ...r, sets: o.to } : r));
      else if (o.kind === 'swap') rows = rows.map((r) => (r.key === o.key ? { ...r, exerciseId: o.toExerciseId } : r));
      else {
        const label = o.supersetWith === null ? null : (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].find((l) => !rows.some((r) => r.superset === l)) ?? null);
        if (label !== null) rows = rows.map((r) => (r.key === o.supersetWith ? { ...r, superset: label } : r));
        rows.push({ key: o.key, exerciseId: o.exerciseId, sets: o.sets, main: false, order: Math.max(-1, ...rows.map((r) => r.order)) + 1, superset: label });
      }
    }
    return { ...d, rows };
  });
}

/** A plan version's days as Plan › Muscles rows (each slot's working sets; warm-ups never count). */
export function planMuscleDaysOf(days: readonly PlanDayDraft[]): PlanMuscleDay[] {
  return days.map((d) => ({ dayIndex: d.index, name: d.name, minutes: d.minutes, rows: [...d.plan.slots].sort((a, b) => a.order - b.order).map((s) => ({ key: s.slotKey, exerciseId: s.exerciseId, sets: pbSlotSets(s), main: s.main, order: s.order, superset: s.supersetGroup })) }));
}

/**
 * (Ben, 1 Nov: "the coach should have caught" it) The deterministic check on a proposed or built plan: each group out
 * of its range on the plan's typical week, one line each (`Biceps 2/wk · below 4–8`). Shown on the plan card and fed
 * back to the coach (its guard notes) so it can adjust before replying. Never blocks the plan: Ben's own choices stand.
 */
export function planMuscleGapLines(days: readonly PlanDayDraft[], g: MuscleGoalInput, infoOf: InfoOf): string[] {
  return muscleFlags(plannedMuscleSets(planMuscleDaysOf(days), infoOf), g).map((f) => PLAN_MUSCLES_COPY.gap(f));
}
