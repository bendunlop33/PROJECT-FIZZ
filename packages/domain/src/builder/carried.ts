import { BUILD_LIMITS } from '@fizz/schemas';
import { setWorkingCount, workingCount } from './set-rows';
import type { BuilderContext, BuilderSlot, BuilderWorkout } from './types';

/**
 * (Ben, 23 Oct; review ben-8-decisions S3) Carried-over sets are the app's change on the landing day, made after that
 * day's own fit, so Time never cuts them again: on Today's card (they land after its fit) and on Your workout (Time
 * fits the workout without them and puts them back after). Pure.
 *
 * - `carriedSets`: the working sets a slot holds from a carry-over (never more than it has).
 * - `withoutCarried`: the workout with the carried sets taken off (a slot that is only carried sets goes), and what
 *   was taken, to put back with `withCarriedBack`.
 * - `withCarriedBack`: the carried sets back on their slots after a fit (a slot the fit left out comes back with
 *   only its carried sets), marked again.
 */

export interface CarriedHold {
  slot: BuilderSlot;
  sets: number;
  /** The slot was only the carried sets (the exercise was added by the carry-over). */
  whole: boolean;
}

export function carriedSets(slot: Pick<BuilderSlot, 'rows' | 'carried'>): number {
  const n = slot.carried ?? 0;
  return n <= 0 ? 0 : Math.min(n, workingCount(slot));
}

export function withoutCarried(w: BuilderWorkout, ctx?: Pick<BuilderContext, 'loads'>): { workout: BuilderWorkout; held: CarriedHold[] } {
  const held: CarriedHold[] = [];
  const blocks = w.blocks
    .map((b) => ({
      ...b,
      slots: b.slots.flatMap((s): BuilderSlot[] => {
        const n = carriedSets(s);
        if (n <= 0) {
          if (s.carried === undefined) return [s];
          const out = { ...s };
          delete out.carried;
          return [out];
        }
        const whole = n >= workingCount(s);
        held.push({ slot: s, sets: n, whole });
        if (whole) return [];
        const out = setWorkingCount(s, workingCount(s) - n, ctx?.loads(s.exerciseId));
        delete out.carried;
        return [out];
      }),
    }))
    .filter((b) => b.slots.length > 0);
  const marked = w.blocks.some((b) => b.slots.some((s) => s.carried !== undefined));
  return marked ? { workout: { ...w, blocks }, held } : { workout: w, held };
}

export function withCarriedBack(w: BuilderWorkout, held: readonly CarriedHold[], ctx: Pick<BuilderContext, 'loads'>): BuilderWorkout {
  if (held.length === 0) return w;
  let blocks = w.blocks.map((b) => ({ ...b, slots: [...b.slots] }));
  for (const h of held) {
    const at = blocks.findIndex((b) => b.slots.some((s) => s.key === h.slot.key));
    // On the slot when it's there (a slot the fit left out and Time brought back, too); else back as it was.
    if (at >= 0) {
      blocks = blocks.map((b, i) =>
        i !== at
          ? b
          : {
              ...b,
              slots: b.slots.map((s) => (s.key !== h.slot.key ? s : { ...setWorkingCount(s, Math.min(BUILD_LIMITS.maxWorkingSets, workingCount(s) + h.sets), ctx.loads(s.exerciseId)), carried: h.sets })),
            },
      );
      continue;
    }
    // Left out by the fit (or added by the carry-over): back with its carried sets only.
    const slot = h.whole ? { ...h.slot, carried: h.sets } : { ...setWorkingCount(h.slot, h.sets, ctx.loads(h.slot.exerciseId)), carried: h.sets };
    blocks.push({ slots: [slot], auto: false });
  }
  return { ...w, blocks };
}

/**
 * (Ben, 23 Oct) The coach's set count for next time on each slot that has one (`SlotLoadInput.coachSets`): the plan day
 * as the next workout will be planned (Start uses the same count). Bounded 1 to the builder's 10 working sets;
 * nothing for a pain-flagged exercise (the service leaves `coachSets` out). Returns the workout and the slots changed.
 */
export function withCoachSetCounts(w: BuilderWorkout, ctx: Pick<BuilderContext, 'loads'>): { workout: BuilderWorkout; changed: string[] } {
  const changed: string[] = [];
  const blocks = w.blocks.map((b) => ({
    ...b,
    slots: b.slots.map((s) => {
      const load = ctx.loads(s.exerciseId);
      const n = load.coachSets;
      if (n === undefined || n === null || load.painCap !== null) return s;
      const to = Math.max(1, Math.min(BUILD_LIMITS.maxWorkingSets, Math.round(n)));
      if (to === workingCount(s)) return s;
      changed.push(s.key);
      return setWorkingCount(s, to, load);
    }),
  }));
  return changed.length === 0 ? { workout: w, changed } : { workout: { ...w, blocks }, changed };
}
