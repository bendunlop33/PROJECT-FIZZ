import { BUILD_LIMITS } from '@fizz/schemas';
import type { BuilderBlock, BuilderExerciseInfo, BuilderInfoLookup, BuilderSlot } from './types';

/**
 * Order and pairing (workout-builder-v3 §3.4, §3.5). Pure; muscle facts come
 * from the injected lookup.
 */

/** What the rules assume for an exercise the lookup doesn't know: a lone isolation sharing nothing. */
export function infoOrDefault(info: BuilderInfoLookup, exerciseId: string): BuilderExerciseInfo {
  return (
    info(exerciseId) ?? {
      exerciseId,
      name: exerciseId,
      group: 'Chest',
      role: 'isolation',
      heavy: false,
      part: `unknown:${exerciseId}`,
      muscles: [],
      angle: '',
      barbell: false,
    }
  );
}

const isAbs = (i: BuilderExerciseInfo): boolean => i.group === 'Abs';

/** Leg parts that alternate on leg days (§3.4: quads and hinge). */
const ALTERNATING_PARTS: ReadonlySet<string> = new Set(['quads', 'hamstrings_glutes']);

/** Options for `orderSlots`. */
export interface OrderOptions {
  /**
   * A comparable working-load size per exercise (e.g. est. max in kg, total
   * convention), for "heaviest first" among heavy lifts when there is no
   * main lift. Null = unknown (keeps the build order).
   */
  load?: (exerciseId: string) => number | null;
}

/**
 * `orderSlots` (§3.4): main lift first → compounds → isolations → abs last.
 * Within compounds, heavy lifts (§3.5: marked, or a compound on a barbell,
 * trap bar, Smith or plate-loaded machine) come before the rest. With no
 * main lift, the heavy lifts are ordered heaviest first (on a bar first,
 * then the bigger known load), so the lift that would be the main lift
 * leads the workout. Otherwise stable within each band (the build order:
 * the main group first). Only leg compounds alternate, inside each band:
 * after a quad lift the next hinge lift moves up, and the other way round
 * (review S6).
 */
export function orderSlots<S extends Pick<BuilderSlot, 'exerciseId' | 'main'>>(slots: readonly S[], info: BuilderInfoLookup, opts: OrderOptions = {}): S[] {
  const of = (s: S) => infoOrDefault(info, s.exerciseId);
  const main = slots.filter((s) => s.main);
  const rest = slots.filter((s) => !s.main);
  const comp = rest.filter((s) => of(s).role === 'compound' && !isAbs(of(s)));
  const iso = rest.filter((s) => of(s).role !== 'compound' && !isAbs(of(s)));
  const abs = rest.filter((s) => isAbs(of(s)));
  let heavy = comp.filter((s) => of(s).heavy);
  const light = comp.filter((s) => !of(s).heavy);
  if (main.length === 0) {
    const size = (s: S) => opts.load?.(s.exerciseId) ?? -1;
    heavy = heavy
      .map((s, i) => ({ s, i }))
      .sort((a, b) => Number(of(b.s).barbell) - Number(of(a.s).barbell) || size(b.s) - size(a.s) || a.i - b.i)
      .map((x) => x.s);
  }
  const outC: S[] = [];
  let prev: S | undefined = main[0];
  for (const band of [heavy, light]) {
    const left = [...band];
    while (left.length > 0) {
      const prevPart = prev === undefined ? null : of(prev).part;
      let k = 0;
      if (prevPart !== null && ALTERNATING_PARTS.has(prevPart) && left[0] !== undefined && of(left[0]).part === prevPart) {
        const other = left.findIndex((s) => ALTERNATING_PARTS.has(of(s).part) && of(s).part !== prevPart);
        if (other >= 0) k = other;
      }
      const [next] = left.splice(k, 1);
      if (next === undefined) break;
      outC.push(next);
      prev = next;
    }
  }
  return [...main, ...outC, ...iso, ...abs];
}

export type PairRefusal = 'main' | 'heavy_pair' | 'abs_heavy' | 'shared_muscle';

export interface PairCheck {
  ok: boolean;
  reason: PairRefusal | null;
  /** The shared muscle, for the advice line. */
  muscle: string | null;
}

/**
 * `canPair` (§3.5): never the main lift, two heavy lifts, abs with a heavy
 * lift, or two exercises that share a muscle. Quads, hamstrings/glutes and
 * calves count as different muscles here (the part), one group for counts.
 */
export function canPair(a: Pick<BuilderSlot, 'exerciseId' | 'main'>, b: Pick<BuilderSlot, 'exerciseId' | 'main'>, info: BuilderInfoLookup): PairCheck {
  if (a.main || b.main) return { ok: false, reason: 'main', muscle: null };
  const x = infoOrDefault(info, a.exerciseId);
  const y = infoOrDefault(info, b.exerciseId);
  if (x.heavy && y.heavy) return { ok: false, reason: 'heavy_pair', muscle: null };
  if ((isAbs(x) && y.heavy) || (isAbs(y) && x.heavy)) return { ok: false, reason: 'abs_heavy', muscle: null };
  const shared = sharedMuscle(x, y);
  if (shared !== null) return { ok: false, reason: 'shared_muscle', muscle: shared };
  return { ok: true, reason: null, muscle: null };
}

/**
 * `canAutoPair`: what the builder itself may pair (Supersets on, a merge,
 * filling time, Mix it up, abs off). `canPair` plus: a heavy lift is never
 * paired with anything (Ben, 21 Oct: the heavy compounds stand alone, like
 * the main lift). Ben's own pairs are checked with `canPair` (advice only).
 */
export function canAutoPair(a: Pick<BuilderSlot, 'exerciseId' | 'main'>, b: Pick<BuilderSlot, 'exerciseId' | 'main'>, info: BuilderInfoLookup): boolean {
  if (infoOrDefault(info, a.exerciseId).heavy || infoOrDefault(info, b.exerciseId).heavy) return false;
  return canPair(a, b, info).ok;
}

/**
 * Builder-made pairs (`auto`) that no longer pass `canAutoPair` (a swap put
 * a heavy lift or a shared muscle into one) split back into singles, in
 * place. Ben's own pairs stay.
 */
export function splitInvalidAutoPairs(blocks: readonly BuilderBlock[], info: BuilderInfoLookup): BuilderBlock[] {
  return blocks.flatMap((b) => {
    if (!b.auto || b.slots.length < 2) return [b];
    const ok = b.slots.every((x, i) => b.slots.every((y, k) => k <= i || canAutoPair(x, y, info)));
    return ok ? [b] : b.slots.map((s): BuilderBlock => ({ slots: [s], auto: false }));
  });
}

/**
 * §3.4 band of one exercise: main lift 0, heavy compound 1, other compound 2,
 * isolation 3, abs 4.
 */
export function builderOrderRank(s: Pick<BuilderSlot, 'exerciseId' | 'main'>, info: BuilderInfoLookup): number {
  if (s.main) return 0;
  const i = infoOrDefault(info, s.exerciseId);
  if (isAbs(i)) return 4;
  if (i.role !== 'compound') return 3;
  return i.heavy ? 1 : 2;
}

/**
 * A block's band: the main lift's 0; else its best slot's, except that abs
 * paired with an isolation are the abs band (4: a new isolation goes before
 * that pair, review builder-order B1). Abs paired with a compound (the only
 * partner that fitted) stay in that compound's band.
 */
export function builderBlockRank(b: BuilderBlock, info: BuilderInfoLookup): number {
  if (b.slots.some((s) => s.main)) return 0;
  const best = Math.min(...b.slots.map((s) => builderOrderRank(s, info)));
  return best === 3 && b.slots.some((s) => isAbs(infoOrDefault(info, s.exerciseId))) ? 4 : best;
}

/**
 * `bandInsertIndex`: where a new single goes (an index for `splice`) so the
 * §3.4 bands hold. Starts after the last block with one of `groups` (abs
 * excluded; none, or no groups: before the first block holding abs, else
 * the end; abs: the end),
 * then moves up past blocks of a later band (never above the main lift) and
 * down past blocks of an earlier one. Used by every path that adds an
 * exercise: filling time, Set up group counts, the coach's `add`.
 */
export function bandInsertIndex(blocks: readonly BuilderBlock[], slot: Pick<BuilderSlot, 'exerciseId' | 'main'>, info: BuilderInfoLookup, groups: readonly string[] = []): number {
  const g = (s: BuilderSlot) => infoOrDefault(info, s.exerciseId).group;
  let at = -1;
  blocks.forEach((b, i) => {
    if (b.slots.some((s) => groups.includes(g(s)) && g(s) !== 'Abs')) at = i;
  });
  const rank = builderOrderRank(slot, info);
  if (at < 0) {
    const abs = rank === 4 ? -1 : blocks.findIndex((b) => builderBlockRank(b, info) === 4);
    at = (abs < 0 ? blocks.length : abs) - 1;
  }
  // A heavy barbell lift goes ahead of heavy lifts on other equipment (§3.4 (b): with no main lift, a bar lift leads).
  const bar = rank === 1 && infoOrDefault(info, slot.exerciseId).barbell;
  const passes = (blk: BuilderBlock): boolean => {
    const r = builderBlockRank(blk, info);
    if (r > rank) return true;
    return r === rank && bar && !blk.slots.some((s) => s.main || infoOrDefault(info, s.exerciseId).barbell);
  };
  while (at >= 0) {
    const b = blocks[at];
    if (b === undefined || !passes(b)) break;
    at -= 1;
  }
  for (;;) {
    const b = blocks[at + 1];
    if (b === undefined || builderBlockRank(b, info) >= rank) break;
    at += 1;
  }
  return at + 1;
}

/** The first muscle both work; same part (both quads…) counts as shared. */
export function sharedMuscle(x: BuilderExerciseInfo, y: BuilderExerciseInfo): string | null {
  const m = x.muscles.find((v) => y.muscles.includes(v));
  if (m !== undefined) return m;
  if (x.part === y.part) return x.part === x.group ? x.group.toLowerCase() : x.part.replace(/_/g, ' ');
  return null;
}

/**
 * `pairSlots` (§3.5): pairs only (`canAutoPair`: never the main lift or a
 * heavy lift). Abs pair with the last accessory that
 * fits; then the remaining single accessories pair in order (each with the
 * first later one that fits). Existing multi-exercise blocks (Ben's pairs)
 * are left as they are, and so is a slot Ben unlinked (`unlinked`): it is
 * never re-paired automatically (review B3). `only`: make only pairs that
 * include one of these slot keys (a newly added exercise), leaving every
 * other single as it is. `skip`: singles never paired (the time fit leaves a
 * slot Ben edited as he has it). Pairs the builder makes are `auto`.
 */
export function pairSlots(blocks: readonly BuilderBlock[], info: BuilderInfoLookup, opts: { only?: ReadonlySet<string>; skip?: (s: BuilderSlot) => boolean } = {}): BuilderBlock[] {
  const singles = blocks.flatMap((b) => {
    const s = b.slots.length === 1 ? b.slots[0] : undefined;
    return s !== undefined && !s.main && s.unlinked !== true && !infoOrDefault(info, s.exerciseId).heavy && opts.skip?.(s) !== true ? [s] : [];
  });
  const only = opts.only;
  const allowed = (x: BuilderSlot, y: BuilderSlot): boolean => only === undefined || only.has(x.key) || only.has(y.key);
  const abs = singles.filter((s) => isAbs(infoOrDefault(info, s.exerciseId)));
  const rest = singles.filter((s) => !abs.includes(s));
  const partner = new Map<BuilderSlot, BuilderSlot>();
  const taken = new Set<BuilderSlot>();
  for (const ab of abs) {
    const p = [...rest].reverse().find((x) => !taken.has(x) && allowed(x, ab) && canAutoPair(x, ab, info));
    if (p !== undefined) {
      partner.set(p, ab);
      taken.add(p).add(ab);
    }
  }
  const left = rest.filter((x) => !taken.has(x));
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    if (a === undefined || taken.has(a)) continue;
    const b = left.find((y, k) => k > i && !taken.has(y) && allowed(a, y) && canAutoPair(a, y, info));
    if (b !== undefined) {
      // The pair sits where its earlier-band member is, that one first (a new compound joining an
      // isolation stays in the compound band; review builder-order B1).
      const [lead, mate] = builderOrderRank(b, info) < builderOrderRank(a, info) ? [b, a] : [a, b];
      partner.set(lead, mate);
      taken.add(a).add(b);
    }
  }
  const out: BuilderBlock[] = [];
  for (const b of blocks) {
    const s = b.slots[0];
    if (b.slots.length !== 1 || s === undefined) {
      out.push(b);
      continue;
    }
    const mate = partner.get(s);
    if (mate !== undefined) out.push({ slots: [s, mate], auto: true });
    else if (!taken.has(s)) out.push(b);
  }
  return out;
}

/** Most exercises in one superset (§4.7 `maxSuperset`). */
export const BUILDER_MAX_SUPERSET = BUILD_LIMITS.maxSuperset;

const clearUnlinked = (s: BuilderSlot): BuilderSlot => {
  if (s.unlinked !== true) return s;
  const out = { ...s };
  delete out.unlinked;
  return out;
};

/**
 * `Unlink` (§2.4 pop-up): the slot leaves its superset and stands alone right
 * after it. It (and a partner left alone) is marked `unlinked`, so later
 * automatic pairing (Supersets, a merge, filling time) never re-pairs it.
 * Null when the slot isn't in a superset.
 */
export function builderUnlink(blocks: readonly BuilderBlock[], slotKey: string): BuilderBlock[] | null {
  const at = blocks.findIndex((b) => b.slots.length > 1 && b.slots.some((s) => s.key === slotKey));
  const block = blocks[at];
  const slot = block?.slots.find((s) => s.key === slotKey);
  if (block === undefined || slot === undefined) return null;
  const rest = block.slots.filter((s) => s.key !== slotKey);
  const left: BuilderBlock = rest.length === 1 && rest[0] !== undefined ? { slots: [{ ...rest[0], unlinked: true }], auto: false } : { ...block, slots: rest, auto: false };
  const out = [...blocks];
  out.splice(at, 1, left, { slots: [{ ...slot, unlinked: true }], auto: false });
  return out;
}

/**
 * `Superset with next` (§2.4 pop-up): Ben's own pair (`auto: false`) of this
 * slot's block and the next one. Clears `unlinked`. Null when there's no
 * next block, either holds the main lift, or it would pass 4 exercises.
 */
export function builderSupersetWithNext(blocks: readonly BuilderBlock[], slotKey: string): BuilderBlock[] | null {
  const at = blocks.findIndex((b) => b.slots.some((s) => s.key === slotKey));
  const a = blocks[at];
  const b = blocks[at + 1];
  if (a === undefined || b === undefined) return null;
  const slots = [...a.slots, ...b.slots];
  if (slots.some((s) => s.main) || slots.length > BUILDER_MAX_SUPERSET) return null;
  const out = [...blocks];
  out.splice(at, 2, { slots: slots.map(clearUnlinked), auto: false, ...(a.roundRestS === undefined ? {} : { roundRestS: a.roundRestS }) });
  return out;
}

/** Split the builder's own pairs back into single exercises, in place (Ben's pairs stay). */
export function unpairAuto(blocks: readonly BuilderBlock[]): BuilderBlock[] {
  return blocks.flatMap((b) => (b.auto && b.slots.length > 1 ? b.slots.map((s): BuilderBlock => ({ slots: [s], auto: false })) : [b]));
}

/** Every slot in order. */
export function slotsOf(blocks: readonly BuilderBlock[]): BuilderSlot[] {
  return blocks.flatMap((b) => b.slots);
}

/** Singles in `orderSlots` order. */
export function singlesOf(slots: readonly BuilderSlot[]): BuilderBlock[] {
  return slots.map((s) => ({ slots: [s], auto: false }));
}
