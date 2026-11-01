import type { MuscleGroup } from '@fizz/schemas';

import { directMuscleGroup, muscleSetCredits, muscleStatus, PLAN_MUSCLE_GROUPS, type MuscleSetTotals } from '../progress/muscle-sets';
import { muscleFlags, plannedMuscleSets, rangesOf, type InfoOf, type MuscleFlag, type MuscleGoalInput, type PlanMuscleDay, type PlanMuscleRow } from '../progress/plan-muscles';

/**
 * (Ben, 1 Nov: "You need to look at it holistically") **Rebalance**: one proposal for the whole plan that brings every
 * muscle group's direct sets into the range that applies, without any day growing past its minutes. Pure and
 * deterministic; the coach can explain it, code makes sure of it. docs/design/plan-muscles.md §5.
 *
 * Every group is looked at together on the typical week (direct, assisted, the applicable range; `directRange`), and
 * each candidate change is simulated on the whole plan: it is taken only when the group it is for gets closer to its
 * range and **no other group leaves its range**. In this order (Ben, 1 Nov):
 *
 * 1. **Trim an overshoot**: a group above its range loses sets from its own accessories (never a main lift; never
 *    below 2 sets a row; a row goes only when the excess is at least its sets), largest first. It also makes room.
 * 2. **Swap**: an accessory for one of its alternatives (the caller's, already checked for the gym, pain flags and
 *    not-preferred) when that covers a low group with no time added and keeps the other groups in range.
 * 3. **Superset**: the new isolation paired with a non-competing accessory on the day (no muscle group in common,
 *    after the day's last main lift), which costs less time than straight sets.
 * 4. **Add sets** as straight sets, only as a last resort.
 *
 * A low group's sets go to the days that already train it (direct or assisted), at most two days (Ben's own example:
 * "Add curls to Pull A and Pull B"), split as evenly as possible, at the end of the day (after every main lift: no
 * arm isolation before a main lift, rule G order). Sized to reach the **lower edge** of its range, never more.
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
  return d < r.min ? r.min - d : d > r.max ? d - r.max : 0;
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
      const excess = (now.get(f.group)?.direct ?? 0) - (rangesOf(now, input).get(f.group)?.max ?? Infinity);
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
            if (to === r.exerciseId || d.rows.some((x) => x.exerciseId === to)) continue;
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
    const need = range === null ? 0 : Math.ceil(range.min - (now.get(f.group)?.direct ?? 0) - 1e-9);
    if (need <= 0) continue;
    const trains = days
      .filter((d) => d.skipped !== true)
      .map((d) => ({ d, credit: d.rows.reduce((s, r) => s + ((muscleSetCredits(ports.infoOf(r.exerciseId)).get(f.group)?.assisted ?? 0) + (muscleSetCredits(ports.infoOf(r.exerciseId)).get(f.group)?.direct ?? 0)) * r.sets, 0) }))
      .filter((x) => x.credit > 0)
      .sort((a, b) => b.credit - a.credit || a.d.dayIndex - b.d.dayIndex)
      .slice(0, REBALANCE_TIME.maxDays)
      .map((x) => x.d)
      .sort((a, b) => a.dayIndex - b.dayIndex);
    const targets = trains.length > 0 ? trains : days.filter((d) => d.skipped !== true).sort((a, b) => rebalanceDayMinutes(a) - rebalanceDayMinutes(b) || a.dayIndex - b.dayIndex).slice(0, 1);
    const pick = ports.isolationsFor(f.group).find((id) => directMuscleGroup(ports.infoOf(id)) === f.group && targets.every((d) => !d.rows.some((r) => r.exerciseId === id)));
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
      for (let sets = want; sets >= 1; sets -= 1) {
        const tries: { day: PlanMuscleDay; with: string | null }[] = [];
        if (partner !== undefined && label !== null) {
          tries.push({ day: { ...base, rows: [...base.rows.map((r) => (r.key === partner.key ? { ...r, superset: label } : r)), { key, exerciseId: pick, sets, main: false, order, superset: label }] }, with: partner.key });
        }
        tries.push({ day: { ...base, rows: [...base.rows, { key, exerciseId: pick, sets, main: false, order, superset: null }] }, with: null });
        const ok = tries.find((x) => rebalanceDayMinutes(x.day) <= cap && !breaks(totals(days), totals(replaceDay(days, x.day)), input, f.group));
        if (ok === undefined) continue;
        days = replaceDay(days, ok.day);
        ops.push({ id: nextId('add'), kind: 'add', dayIndex: t.dayIndex, key, exerciseId: pick, sets, supersetWith: ok.with, group: f.group });
        left -= sets;
        return;
      }
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
