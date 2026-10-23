import { isWarmed, planSessionWarmupsAs, warmupTimeS, type SessionWarmupItem, type WarmupProfile } from '../warmup/plan';
import { infoOrDefault } from './arrange';
import { slotLoadOf } from './reps';
import { builderWarmupInput, isTimedSlot } from './set-rows';
import type { BuilderContext, BuilderSetRow, BuilderSlot, BuilderWorkout } from './types';

/**
 * `settleWarmups` (WU1–WU12): every slot's warm-ups planned again by the shared planner, in workout order, so a
 * slot's warm-ups follow its place in the workout and its load as they are now:
 * - WU2: warmed by an earlier slot with the same primary muscle group or pattern, or as a superset's later member;
 * - WU6: the workout's first exercise gets the extra 50 % step;
 * - WU11: the session's warm-ups fit the D17 budget (10 min), cut in WU11's order;
 * - (Ben, 23 Oct) the plan's Warm-ups setting (`ctx.warmups`): `short` takes every WU11 cut to its floors, `none`
 *   plans none.
 * Slots Ben set his own warm-ups on (`ownWarmups`, or a warm-up kg he typed), timed slots and slots with no working
 * load keep theirs (their time still counts against the budget). Working sets are never touched. Pure.
 */
export function settleWarmups(w: BuilderWorkout, ctx: Pick<BuilderContext, 'info' | 'loads' | 'warmups'>): BuilderWorkout {
  type Entry = { slot: BuilderSlot; item: SessionWarmupItem | null; fixedS: number; plannable: boolean };
  const entries: Entry[] = [];
  const earlier: WarmupProfile[] = [];
  let first = true;
  for (const block of w.blocks) {
    block.slots.forEach((slot, si) => {
      const info = infoOrDefault(ctx.info, slot.exerciseId);
      const work = slot.rows.find((r) => r.type === 'top') ?? slot.rows.find((r) => r.type !== 'warmup');
      const own = slot.rows.filter((r) => r.type === 'warmup');
      const fixedS = warmupTimeS(own.map((r) => ({ load: r.load ?? 0, reps: r.reps })));
      const keep = slot.ownWarmups === true || own.some((r) => r.typed === true) || isTimedSlot(slot) || work === undefined;
      const load = slotLoadOf(ctx.loads(slot.exerciseId), slot.main);
      const plan = work === undefined ? null : builderWarmupInput({ main: slot.main, role: info.role, barbell: info.barbell, load, reps: work.reps, group: info.group, ...(info.warmup === undefined ? {} : { facts: info.warmup }) }, work.load);
      const sameUnit = plan === null || plan.cls === 'weighted_bodyweight' || load.equipment === null || slot.unit === load.equipment.unit;
      const plannable = !keep && plan !== null && sameUnit && (plan.cls === 'weighted_bodyweight' || work.load != null);
      const warmed = plan !== null && isWarmed(plan.profile, earlier, si > 0);
      if (plan !== null && work !== undefined) earlier.push(plan.profile);
      const item: SessionWarmupItem | null = plan === null || !plannable ? null : { cls: plan.cls, reps: plan.reps, load: plan.load, warmed, firstOfSession: first, floorStart: plan.floorStart, barMass: plan.barMass, loads: plan.loads };
      entries.push({ slot, item, fixedS: plannable ? 0 : fixedS, plannable });
      first = false;
    });
  }
  const items = entries.flatMap((e) => (e.item === null ? [] : [e.item]));
  const fixedS = entries.reduce((n, e) => n + e.fixedS, 0);
  const planned = planSessionWarmupsAs(
    items.map((it, k) => (k === 0 ? { ...it, fixedS } : it)),
    ctx.warmups ?? 'full',
  );
  let k = 0;
  const next = new Map<BuilderSlot, BuilderSlot>();
  for (const e of entries) {
    if (e.item === null) continue;
    const steps = planned.steps[k] ?? [];
    k += 1;
    const weighted = e.item.cls === 'weighted_bodyweight';
    const warm = steps.map((s): BuilderSetRow => ({ type: 'warmup', reps: s.reps, load: weighted ? null : s.load, rpe: null }));
    const rows = [...warm, ...e.slot.rows.filter((r) => r.type !== 'warmup')];
    if (!sameRows(rows, e.slot.rows)) next.set(e.slot, { ...e.slot, rows });
  }
  if (next.size === 0) return w;
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => next.get(s) ?? s) })) };
}

function sameRows(a: readonly BuilderSetRow[], b: readonly BuilderSetRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const o = b[i];
    return o !== undefined && o.type === r.type && o.reps === r.reps && o.load === r.load && o.rpe === r.rpe && o.typed === r.typed && o.repsMax === r.repsMax;
  });
}
