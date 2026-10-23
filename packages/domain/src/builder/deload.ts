import { deloadSetCount } from '../plan-builder/weeks';
import { DELOAD_LOAD_SHARE, fitHere, roundContextOf } from './loads';
import { slotLoadOf } from './reps';
import { isTimedSlot, setWorkingCount, workingCount } from './set-rows';
import type { BuilderContext, BuilderSetRow, BuilderSlot, BuilderWorkout } from './types';

/**
 * (Ben, 23 Oct: plan length = block 1; training-blocks §2.3, §4.4, Q3) A deload week's draft. Pure.
 *
 * The applied plan's deload week (`SlotLoadInput.deload`) drafts every session lighter: the loads come out ~10 %
 * lighter through `builderLoad`, and here each slot gets one working set fewer, never below 2 (a main lift keeps its
 * top set and loses a back-off), and no working set aims above RPE 7. It runs on the drafter's workout before Time's
 * fit (so a deload week fits the lighter draft), on Today's card, Your workout and Start alike. Only today's draft is
 * touched: plan-day templates and completed sets never are (rule 2). The sets it takes off count as today's cut
 * (`todayCut`, as Time's), so `Keep for next time?` never reads them as Ben's change.
 */

/** A deload week's top RPE for working sets (training-blocks §4.4). */
export const DELOAD_MAX_RPE = 7;

export function withDeloadSets(w: BuilderWorkout, ctx: Pick<BuilderContext, 'loads'>): { workout: BuilderWorkout; changed: string[] } {
  const changed: string[] = [];
  const blocks = w.blocks.map((b) => ({
    ...b,
    slots: b.slots.map((s): BuilderSlot => {
      const load = ctx.loads(s.exerciseId);
      if (load.deload !== true || isTimedSlot(s)) return s;
      const n = workingCount(s);
      const to = deloadSetCount(n);
      let out = to === n ? s : setWorkingCount(s, to, load);
      const rows = out.rows.map((r) => (r.type === 'warmup' || r.rpe === null || r.rpe <= DELOAD_MAX_RPE ? r : { ...r, rpe: DELOAD_MAX_RPE }));
      const cut = n - workingCount(out);
      if (cut === 0 && rows.every((r, i) => r === out.rows[i])) return s;
      out = { ...out, rows, ...(cut > 0 ? { todayCut: (s.todayCut ?? 0) + cut } : {}) };
      changed.push(s.key);
      return out;
    }),
  }));
  return changed.length === 0 ? { workout: w, changed } : { workout: { ...w, blocks }, changed };
}

/**
 * A deload week's loads on a workout whose loads weren't worked out from the slot's inputs (a library or past workout
 * opened as Start's planner planned it): every working load Ben didn't type ~10 % lighter, rounded down on the slot's
 * item (never below its lightest load, never past its max: rule 4). Assisted lifts and bodyweight keep theirs. Loads
 * the builder works out (`builderLoad`) are lighter already and never go through this.
 */
export function withDeloadLoads(w: BuilderWorkout, ctx: Pick<BuilderContext, 'loads'>): { workout: BuilderWorkout; changed: string[] } {
  const changed: string[] = [];
  const blocks = w.blocks.map((b) => ({
    ...b,
    slots: b.slots.map((s): BuilderSlot => {
      const load = ctx.loads(s.exerciseId);
      if (load.deload !== true || isTimedSlot(s) || (s.convention !== 'total' && s.convention !== 'per_hand' && s.convention !== 'stack' && s.convention !== 'added')) return s;
      const round = roundContextOf(slotLoadOf(load, s.main));
      if (round.convention !== s.convention || round.unit !== s.unit) return s;
      const rows = s.rows.map((r): BuilderSetRow => {
        if (r.type === 'warmup' || r.typed === true || r.load === null || r.load <= 0) return r;
        const fit = fitHere(r.load * DELOAD_LOAD_SHARE, round);
        const to = fit.ok ? fit.load.value : fit.reason === 'lightest_is_harder' && fit.lightest !== null && fit.lightest < r.load ? fit.lightest : r.load;
        if (to >= r.load) return r;
        // A back-off set against its top (`backoffFrom`) keeps that record: the lighter top lowers it by the same %.
        return { ...r, load: to };
      });
      if (rows.every((r, i) => r === s.rows[i])) return s;
      changed.push(s.key);
      return { ...s, rows, anchorE1rm: s.anchorE1rm === null ? null : s.anchorE1rm * DELOAD_LOAD_SHARE };
    }),
  }));
  return changed.length === 0 ? { workout: w, changed } : { workout: { ...w, blocks }, changed };
}
