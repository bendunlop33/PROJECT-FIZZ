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

/**
 * `orderSlots` (§3.4): main lift first → compounds → isolations → abs last.
 * Stable within each band (the build order: the main group first). Only
 * leg compounds alternate: after a quad lift the next hinge lift moves up,
 * and the other way round (review S6). Other days keep their order.
 */
export function orderSlots<S extends Pick<BuilderSlot, 'exerciseId' | 'main'>>(slots: readonly S[], info: BuilderInfoLookup): S[] {
  const of = (s: S) => infoOrDefault(info, s.exerciseId);
  const main = slots.filter((s) => s.main);
  const rest = slots.filter((s) => !s.main);
  const comp = rest.filter((s) => of(s).role === 'compound' && !isAbs(of(s)));
  const iso = rest.filter((s) => of(s).role !== 'compound' && !isAbs(of(s)));
  const abs = rest.filter((s) => isAbs(of(s)));
  const outC: S[] = [];
  let prev: S | undefined = main[0];
  while (comp.length > 0) {
    const prevPart = prev === undefined ? null : of(prev).part;
    let k = 0;
    if (prevPart !== null && ALTERNATING_PARTS.has(prevPart) && comp[0] !== undefined && of(comp[0]).part === prevPart) {
      const other = comp.findIndex((s) => ALTERNATING_PARTS.has(of(s).part) && of(s).part !== prevPart);
      if (other >= 0) k = other;
    }
    const [next] = comp.splice(k, 1);
    if (next === undefined) break;
    outC.push(next);
    prev = next;
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

/** The first muscle both work; same part (both quads…) counts as shared. */
export function sharedMuscle(x: BuilderExerciseInfo, y: BuilderExerciseInfo): string | null {
  const m = x.muscles.find((v) => y.muscles.includes(v));
  if (m !== undefined) return m;
  if (x.part === y.part) return x.part === x.group ? x.group.toLowerCase() : x.part.replace(/_/g, ' ');
  return null;
}

/**
 * `pairSlots` (§3.5): pairs only. Abs pair with the last accessory that
 * fits; then the remaining single accessories pair in order (each with the
 * first later one that fits). Existing multi-exercise blocks (Ben's pairs)
 * are left as they are, and so is a slot Ben unlinked (`unlinked`): it is
 * never re-paired automatically (review B3). `only`: make only pairs that
 * include one of these slot keys (a newly added exercise), leaving every
 * other single as it is. Pairs the builder makes are `auto`.
 */
export function pairSlots(blocks: readonly BuilderBlock[], info: BuilderInfoLookup, opts: { only?: ReadonlySet<string> } = {}): BuilderBlock[] {
  const singles = blocks.flatMap((b) => {
    const s = b.slots.length === 1 ? b.slots[0] : undefined;
    return s !== undefined && !s.main && s.unlinked !== true ? [s] : [];
  });
  const only = opts.only;
  const allowed = (x: BuilderSlot, y: BuilderSlot): boolean => only === undefined || only.has(x.key) || only.has(y.key);
  const abs = singles.filter((s) => isAbs(infoOrDefault(info, s.exerciseId)));
  const rest = singles.filter((s) => !abs.includes(s));
  const partner = new Map<BuilderSlot, BuilderSlot>();
  const taken = new Set<BuilderSlot>();
  for (const ab of abs) {
    const p = [...rest].reverse().find((x) => !taken.has(x) && allowed(x, ab) && canPair(x, ab, info).ok);
    if (p !== undefined) {
      partner.set(p, ab);
      taken.add(p).add(ab);
    }
  }
  const left = rest.filter((x) => !taken.has(x));
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    if (a === undefined || taken.has(a)) continue;
    const b = left.find((y, k) => k > i && !taken.has(y) && allowed(a, y) && canPair(a, y, info).ok);
    if (b !== undefined) {
      partner.set(a, b);
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
