import type { DraftedBase, DraftPlan, DraftSlot } from '@fizz/schemas';
import { stableStringify } from '../stable';

/**
 * (Ben, 23 Oct; workout-builder-v3 §2.9) A builder version's drafted baseline: what code (or the coach, once Ben
 * applied it) drafted, before Ben's own edits. Coach review diffs the workout against it so the coach can critique
 * what Ben changed himself. Pure.
 *
 * Ben's in-place edits never move it. A write that isn't his edit moves only what it changed:
 * - `adoptChangedSlots`: a coach apply or landed coach changes. Each slot the write changed takes its new content
 *   (added, removed or replaced), so the coach's change never reads as Ben's; his own earlier edits on other slots
 *   still do.
 * - `adoptUneditedSlots`: a gym change. Slots Ben hadn't edited take their new loads at this gym; slots he had edited
 *   keep the baseline they were drafted with.
 */

/** A slot's content as `withSlotRevs` compares it: its revision and place left out (a move alone is no change to it). */
function contentOf(s: DraftSlot): string {
  return stableStringify({ ...s, order: 0, rev: 0 });
}

const byKey = (p: DraftPlan): Map<string, DraftSlot> => new Map(p.slots.map((s) => [s.slotKey, s]));

/** The baseline with `pick(key)` deciding each slot of `after` (and the baseline's slots `after` no longer has). */
function rebased(base: DraftedBase, before: DraftPlan, after: DraftPlan, adopt: (key: string, was: DraftSlot | undefined, now: DraftSlot | undefined, b: DraftSlot | undefined) => boolean): DraftPlan {
  const b = byKey(base.plan);
  const pre = byKey(before);
  const post = byKey(after);
  const out: DraftSlot[] = [];
  const seen = new Set<string>();
  // The baseline's own order first, then any slot the write added (in its place in `after`).
  for (const s of base.plan.slots) {
    seen.add(s.slotKey);
    const now = post.get(s.slotKey);
    if (adopt(s.slotKey, pre.get(s.slotKey), now, s)) {
      if (now !== undefined) out.push(now);
    } else out.push(s);
  }
  for (const s of after.slots) {
    if (seen.has(s.slotKey) || b.has(s.slotKey)) continue;
    if (adopt(s.slotKey, pre.get(s.slotKey), s, undefined)) out.push(s);
  }
  return { slots: out };
}

/**
 * A coach write (`before` → `after`): every slot it changed, added or removed takes its new state in the baseline;
 * the rest keep theirs. `minutes` moves when the write changed the length.
 */
export function adoptChangedSlots(base: DraftedBase | null | undefined, before: DraftPlan, after: DraftPlan, minutes?: { before: number; after: number }): DraftedBase | null {
  if (base == null) return null;
  const changed = (was: DraftSlot | undefined, now: DraftSlot | undefined): boolean => (was === undefined) !== (now === undefined) || (was !== undefined && now !== undefined && contentOf(was) !== contentOf(now));
  const plan = rebased(base, before, after, (_k, was, now) => changed(was, now));
  const m = minutes !== undefined && minutes.before !== minutes.after ? minutes.after : base.minutes;
  return { plan, minutes: m };
}

/** A gym change (`before` → `after`): slots Ben hadn't edited (as drafted in `before`) take their new state. */
export function adoptUneditedSlots(base: DraftedBase | null | undefined, before: DraftPlan, after: DraftPlan): DraftedBase | null {
  if (base == null) return null;
  const plan = rebased(base, before, after, (_k, was, now, b) => was !== undefined && now !== undefined && b !== undefined && contentOf(was) === contentOf(b));
  return { plan, minutes: base.minutes };
}
