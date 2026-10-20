import { PLAN_DAY_LIMITS, type VariationOp } from '@fizz/schemas';
import { infoOrDefault, slotsOf } from './arrange';
import { BUILDER_SET_RULES, workingCount } from './set-rows';
import { makeSlot } from './slot';
import type { BuilderBlock, BuilderContext, BuilderInfoLookup, BuilderWorkout } from './types';

/**
 * Templates, the Start prompt and variations (workout-builder-v3 §1.3,
 * §2.8, §4.3, §9 Q11, Q17). Pure.
 *
 * - `workoutFromTemplate`: a plan-day template opened in the builder (no
 *   rebuild: its exercises, order, pairs and set counts; loads from §3.1).
 * - `builderChanges`: what `Use these changes for` lists. Only structure
 *   counts (swap, add, delete, set count, pairs, order): load, reps, RPE and
 *   rest edits don't prompt (Q11; typed kg stays today only, Q6).
 * - `variationExtrasOf`: `Save as new variation` stores the difference from
 *   the template as `VariationOp`s, so a template change reaches it.
 */

/** One template exercise as the builder needs it. `group`: its superset letter, if any. */
export interface TemplateSlotSpec {
  exerciseId: string;
  main: boolean;
  workingSets: number;
  group: string | null;
}

/** `workoutFromTemplate`: consecutive exercises with one superset letter are one round (Ben's own pair). */
export function workoutFromTemplate(specs: readonly TemplateSlotSpec[], ctx: BuilderContext): BuilderWorkout {
  const blocks: BuilderBlock[] = [];
  let prev: string | null = null;
  for (const s of specs) {
    if (ctx.info(s.exerciseId) === null) continue;
    const slot = { ...makeSlot(s.exerciseId, { main: s.main, workingSets: s.workingSets }, ctx), origin: s.exerciseId };
    const last = blocks[blocks.length - 1];
    if (s.group !== null && s.group === prev && last !== undefined && !s.main && !last.slots.some((x) => x.main)) last.slots.push(slot);
    else blocks.push({ slots: [slot], auto: false });
    prev = s.group;
  }
  return { blocks, restLevel: 'normal' };
}

export type BuilderChange =
  | { kind: 'swap'; from: string; to: string }
  | { kind: 'add'; exerciseId: string }
  | { kind: 'delete'; exerciseId: string }
  | { kind: 'sets'; exerciseId: string; from: number; to: number }
  | { kind: 'pair'; a: string; b: string }
  | { kind: 'unpair'; exerciseId: string }
  | { kind: 'order' };

const pairKey = (a: string, b: string): string => (a < b ? `${a}+${b}` : `${b}+${a}`);

function pairsOf(w: BuilderWorkout): Set<string> {
  const out = new Set<string>();
  for (const b of w.blocks) for (let i = 0; i < b.slots.length; i += 1) for (let k = i + 1; k < b.slots.length; k += 1) out.add(pairKey(b.slots[i]?.exerciseId ?? '', b.slots[k]?.exerciseId ?? ''));
  return out;
}

/**
 * The template built afresh, with each slot keyed as the draft's slot that
 * came from it (`origin`), so `builderChanges` reads a swap as a swap.
 */
export function alignToDraft(base: BuilderWorkout, current: BuilderWorkout): BuilderWorkout {
  const keyOf = new Map(slotsOf(current.blocks).flatMap((s) => (s.origin === undefined ? [] : [[s.origin, s.key] as const])));
  return { ...base, blocks: base.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => ({ ...s, key: keyOf.get(s.exerciseId) ?? s.key })) })) };
}

/**
 * `builderChanges`: base (what the plan day opened as) → current. A slot that
 * kept its key but changed exercise is a swap. Empty = no prompt (§2.8).
 */
export function builderChanges(base: BuilderWorkout, current: BuilderWorkout): BuilderChange[] {
  const out: BuilderChange[] = [];
  const b = slotsOf(base.blocks);
  const c = slotsOf(current.blocks);
  const cByKey = new Map(c.map((s) => [s.key, s]));
  const swappedFrom = new Set<string>();
  const swappedTo = new Set<string>();
  for (const s of b) {
    const now = cByKey.get(s.key);
    if (now !== undefined && now.exerciseId !== s.exerciseId) {
      out.push({ kind: 'swap', from: s.exerciseId, to: now.exerciseId });
      swappedFrom.add(s.exerciseId);
      swappedTo.add(now.exerciseId);
    }
  }
  const bIds = new Set(b.map((s) => s.exerciseId));
  const cIds = new Set(c.map((s) => s.exerciseId));
  for (const s of c) if (!bIds.has(s.exerciseId) && !swappedTo.has(s.exerciseId)) out.push({ kind: 'add', exerciseId: s.exerciseId });
  for (const s of b) if (!cIds.has(s.exerciseId) && !swappedFrom.has(s.exerciseId)) out.push({ kind: 'delete', exerciseId: s.exerciseId });
  const bCount = new Map(b.map((s) => [s.exerciseId, workingCount(s)]));
  for (const s of b) {
    const now = cByKey.get(s.key);
    if (now !== undefined && now.exerciseId !== s.exerciseId && workingCount(now) !== workingCount(s)) out.push({ kind: 'sets', exerciseId: now.exerciseId, from: workingCount(s), to: workingCount(now) });
  }
  for (const s of c) {
    const from = bCount.get(s.exerciseId);
    if (from !== undefined && from !== workingCount(s)) out.push({ kind: 'sets', exerciseId: s.exerciseId, from, to: workingCount(s) });
  }
  // Pairs, compared through swaps (a swapped exercise keeps its old one's partner).
  const alias = (id: string): string => {
    const swap = out.find((x): x is Extract<BuilderChange, { kind: 'swap' }> => x.kind === 'swap' && x.to === id);
    return swap?.from ?? id;
  };
  const bp = pairsOf(base);
  const cp = new Set([...pairsOf(current)].map((k) => {
    const [x = '', y = ''] = k.split('+');
    return pairKey(alias(x), alias(y));
  }));
  for (const blk of current.blocks) {
    const first = blk.slots[0];
    if (first === undefined) continue;
    for (const s of blk.slots.slice(1)) if (!bp.has(pairKey(alias(first.exerciseId), alias(s.exerciseId)))) out.push({ kind: 'pair', a: first.exerciseId, b: s.exerciseId });
  }
  const unpaired = new Set<string>();
  for (const k of bp) {
    if (cp.has(k)) continue;
    for (const id of k.split('+')) {
      const now = c.find((s) => alias(s.exerciseId) === id);
      if (now !== undefined && !unpaired.has(now.exerciseId)) {
        const blk = current.blocks.find((x) => x.slots.some((s) => s.exerciseId === now.exerciseId));
        if ((blk?.slots.length ?? 1) === 1) {
          unpaired.add(now.exerciseId);
          out.push({ kind: 'unpair', exerciseId: now.exerciseId });
        }
      }
    }
  }
  // Order of what both have (through swaps), by round.
  const blockOrder = (w: BuilderWorkout, ids: Set<string>, map: (id: string) => string) => w.blocks.map((blk) => blk.slots.map((s) => map(s.exerciseId)).filter((id) => ids.has(id)).sort().join('+')).filter((k) => k !== '');
  const common = new Set([...bIds].filter((id) => [...cIds].some((x) => alias(x) === id)));
  const bo = blockOrder(base, common, (id) => id);
  const co = blockOrder(current, common, alias);
  const sameRounds = (xs: string[], ys: string[]) => xs.filter((k) => ys.includes(k));
  const bx = sameRounds(bo, co);
  const cx = sameRounds(co, bo);
  if (bx.some((k, i) => cx[i] !== k)) out.push({ kind: 'order' });
  return out;
}

/** `Cable fly → Incline barbell press`, `Add Hammer curl`, `Triceps pushdown: 3 → 4 sets` (§2.8). */
export function builderChangeLine(c: BuilderChange, nameOf: (exerciseId: string) => string): string {
  switch (c.kind) {
    case 'swap':
      return `${nameOf(c.from)} → ${nameOf(c.to)}`;
    case 'add':
      return `Add ${nameOf(c.exerciseId)}`;
    case 'delete':
      return `Delete ${nameOf(c.exerciseId)}`;
    case 'sets':
      return `${nameOf(c.exerciseId)}: ${String(c.from)} → ${String(c.to)} sets`;
    case 'pair':
      return `Superset ${nameOf(c.a)} with ${nameOf(c.b)}`;
    case 'unpair':
      return `Unlink ${nameOf(c.exerciseId)}`;
    case 'order':
      return 'New order';
  }
}

export type VariationExtras = { ok: true; extras: VariationOp[] } | { ok: false; reason: 'too_many_changes' };

/**
 * `variationExtrasOf`: template → current as extras (§4.3). Deletes, then
 * adds (each after the exercise before it, else at the end), set counts,
 * then pairs with the round's first exercise. Order alone and a template
 * pair Ben split aren't extras (the ops have no move or unpair); they stay
 * today only.
 */
export function variationExtrasOf(template: BuilderWorkout, current: BuilderWorkout): VariationExtras {
  const t = slotsOf(template.blocks);
  const c = slotsOf(current.blocks);
  const tIds = new Set(t.map((s) => s.exerciseId));
  const cIds = new Set(c.map((s) => s.exerciseId));
  const ops: VariationOp[] = [];
  for (const s of t) if (!cIds.has(s.exerciseId) && !s.main) ops.push({ kind: 'remove_slot', exerciseId: s.exerciseId });
  const placed = new Set([...tIds].filter((id) => cIds.has(id)));
  c.forEach((s, i) => {
    if (tIds.has(s.exerciseId)) return;
    const before = [...c.slice(0, i)].reverse().find((x) => placed.has(x.exerciseId));
    const n = workingCount(s);
    ops.push({ kind: 'add_slot', after: before?.exerciseId ?? 'end', slot: { exerciseId: s.exerciseId, ...(n === BUILDER_SET_RULES.accessorySets ? {} : { workingSets: n }) } });
    placed.add(s.exerciseId);
  });
  const tCount = new Map(t.map((s) => [s.exerciseId, workingCount(s)]));
  for (const s of c) {
    const from = tCount.get(s.exerciseId);
    if (from !== undefined && from !== workingCount(s)) ops.push({ kind: 'set_count', exerciseId: s.exerciseId, n: workingCount(s) });
  }
  const tp = pairsOf(template);
  for (const blk of current.blocks) {
    const first = blk.slots[0];
    if (first === undefined) continue;
    for (const s of blk.slots.slice(1)) if (!tp.has(pairKey(first.exerciseId, s.exerciseId))) ops.push({ kind: 'pair', a: first.exerciseId, b: s.exerciseId });
  }
  if (ops.length > PLAN_DAY_LIMITS.maxVariationOps) return { ok: false, reason: 'too_many_changes' };
  return { ok: true, extras: ops };
}

/** The name field's prefill for `Save as new variation` (§2.8: `arms superset`). */
export function suggestVariationLabel(changes: readonly BuilderChange[], info: BuilderInfoLookup): string {
  const added = changes.flatMap((c) => (c.kind === 'add' ? [c.exerciseId] : c.kind === 'swap' ? [c.to] : []));
  const paired = new Set(changes.flatMap((c) => (c.kind === 'pair' ? [c.a, c.b] : [])));
  const words = [...new Set(added.map((id) => {
    const g = infoOrDefault(info, id).group;
    return g === 'Biceps' || g === 'Triceps' ? 'arms' : g.toLowerCase();
  }))];
  const word = words.length === 1 ? (words[0] ?? 'extras') : words.length === 0 ? null : 'extras';
  if (word === null) return changes.some((c) => c.kind === 'sets') ? 'more sets' : 'variation';
  return added.some((id) => paired.has(id)) ? `${word} superset` : `with ${word}`;
}
