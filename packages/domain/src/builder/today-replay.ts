import { BUILD_LIMITS } from '@fizz/schemas';
import { slotsOf, splitInvalidAutoPairs } from './arrange';
import { removeSlot } from './fit';
import type { BuilderFitStep } from './fit';
import type { BuilderBlock, BuilderInfoLookup, BuilderSlot, BuilderWorkout } from './types';

/**
 * Today's options on Your workout (D3; workout-builder-v3 §2.3a, design track 23 Oct; review todaylean S2/S3, FT5).
 * Pure.
 *
 * A control (Main lift, Accessories, Abs, Supersets) loads Today's draft for that choice at today's Time, from the same
 * draft and fit code as Today's card, then Ben's earlier edits are replayed on it, so a control change never quietly
 * undoes them and the rows are what Today would draft for that choice with his edits on top.
 *
 * Ben's edits are:
 * - a slot he deleted (`removed`: Today's slot keys name an exercise for the day, so the same exercise in the new
 *   draft is the one he deleted);
 * - a slot he changed, swapped (same key, another exercise) or added (`touched`): carried as he has it, in the new
 *   draft's slot of that key or exercise, else after the slot it followed in his workout.
 * Not replayed: his order and superset links on slots he didn't change (Today's order and pairs for the choice
 * stand). `skip`: his slots that don't belong to the new choice (the old main lift on a new Main lift; ab exercises on
 * Abs off).
 */
export interface TodayReplayInput {
  /** Today's draft for the new choice (fitted to Time, or before the fit for the record's base). */
  next: BuilderWorkout;
  /** The workout as Ben has it now. */
  current: BuilderWorkout;
  /** Slot keys Ben deleted from Today's drafts today. */
  removed: readonly string[];
  info: BuilderInfoLookup;
  skip?: (s: BuilderSlot) => boolean;
}

const replaceAt = (w: BuilderWorkout, key: string, slot: BuilderSlot): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === key ? slot : s)) })) });

/** `replayTodayEdits`: Ben's edits (see above) on Today's draft for another choice. */
export function replayTodayEdits(i: TodayReplayInput): BuilderWorkout {
  const removed = new Set(i.removed);
  let w: BuilderWorkout = { ...i.next, blocks: i.next.blocks.map((b) => ({ ...b, slots: [...b.slots] })) };
  // 1. What he deleted stays deleted.
  for (const s of slotsOf(i.next.blocks)) if (removed.has(s.key)) w = removeSlot(w, s.key);
  // 2. His own slots, as he has them.
  const order = slotsOf(i.current.blocks).map((s) => s.key);
  const mine = slotsOf(i.current.blocks).filter((s) => s.touched === true && i.skip?.(s) !== true);
  const placed = new Set<string>();
  for (const s of mine) {
    const now = slotsOf(w.blocks);
    const home = now.find((x) => x.key === s.key && !placed.has(x.key)) ?? now.find((x) => x.exerciseId === s.exerciseId && x.main === s.main && x.touched !== true && !placed.has(x.key));
    if (home !== undefined) {
      // His version, in place (a main lift stays the main lift; his slot keeps its own key).
      w = replaceAt(w, home.key, { ...s, main: home.main });
    } else {
      if (now.length >= BUILD_LIMITS.maxExercises) continue;
      const before = order
        .slice(0, order.indexOf(s.key))
        .reverse()
        .find((k) => slotsOf(w.blocks).some((x) => x.key === k));
      const at = before === undefined ? -1 : w.blocks.findIndex((b) => b.slots.some((x) => x.key === before));
      const blocks: BuilderBlock[] = [...w.blocks];
      // Never ahead of the main lift.
      const mainAt = blocks.findIndex((b) => b.slots.some((x) => x.main));
      blocks.splice(Math.max(at, mainAt) + 1, 0, { slots: [{ ...s, main: false }], auto: false });
      w = { ...w, blocks };
    }
    placed.add(s.key);
    // One copy of an exercise: Today's own copy of what he swapped in or added goes.
    for (const x of slotsOf(w.blocks)) if (x.exerciseId === s.exerciseId && x.key !== s.key && !placed.has(x.key) && x.touched !== true && !x.main) w = removeSlot(w, x.key);
  }
  return { ...w, blocks: splitInvalidAutoPairs(w.blocks, i.info) };
}

/**
 * The steps of Today's fit that are still Time's once Ben's edits are replayed: not on a slot he deleted, changed or
 * replaced, and (pairs) only while both slots are there. What `todayTimeFit` makes the record from.
 */
export function replayedFitSteps(steps: readonly BuilderFitStep[], replayedBase: BuilderWorkout): BuilderFitStep[] {
  const base = new Map(slotsOf(replayedBase.blocks).map((s) => [s.key, s]));
  const ours = (key: string, exerciseId: string) => {
    const s = base.get(key);
    return s !== undefined && s.touched !== true && s.exerciseId === exerciseId;
  };
  return steps.filter((st) => {
    switch (st.kind) {
      case 'rest':
      case 'effort':
        return true;
      case 'pair':
        return st.slotKeys.every((k) => base.get(k)?.touched !== true && base.has(k));
      case 'sets':
      case 'drop':
        return ours(st.slotKey, st.exerciseId);
      case 'add':
        // (Review todaylean B3) What the fill added isn't in the draft before it: it is Time's unless Ben's slot has its key.
        return !base.has(st.slotKey) || ours(st.slotKey, st.exerciseId);
    }
  });
}
