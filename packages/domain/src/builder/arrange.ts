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

/**
 * `orderSlots` (§3.4): main lift first → compounds (alternating parts, so on
 * leg days quads and hinge alternate) → isolations → abs last. Stable
 * within each band.
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
    const k = comp.findIndex((s) => prev === undefined || of(s).part !== of(prev).part);
    const [next] = comp.splice(k < 0 ? 0 : k, 1);
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
 * are left as they are. Pairs the builder makes are `auto`.
 */
export function pairSlots(blocks: readonly BuilderBlock[], info: BuilderInfoLookup): BuilderBlock[] {
  const singles = blocks.filter((b) => b.slots.length === 1 && b.slots[0]?.main === false).map((b) => b.slots[0] as BuilderSlot);
  const abs = singles.filter((s) => isAbs(infoOrDefault(info, s.exerciseId)));
  const rest = singles.filter((s) => !abs.includes(s));
  const partner = new Map<BuilderSlot, BuilderSlot>();
  const taken = new Set<BuilderSlot>();
  for (const ab of abs) {
    const p = [...rest].reverse().find((x) => !taken.has(x) && canPair(x, ab, info).ok);
    if (p !== undefined) {
      partner.set(p, ab);
      taken.add(p).add(ab);
    }
  }
  const left = rest.filter((x) => !taken.has(x));
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    if (a === undefined || taken.has(a)) continue;
    const b = left.find((y, k) => k > i && !taken.has(y) && canPair(a, y, info).ok);
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
