import { orderSlots, pairSlots, singlesOf } from './arrange';
import { estimateBuilderMinutes } from './estimate';
import { fitToMinutes, type BuilderFitResult } from './fit';
import { makeSlot } from './slot';
import type { BuilderContext, BuilderExerciseInfo, BuilderGroupName, BuilderSlot, BuilderWorkout } from './types';


/**
 * Recommendations and the build from Set up (workout-builder-v3 §2.2, §2.0.2,
 * §3.7). Pure: exercise pools, muscle facts and loads are injected.
 */

export const BUILDER_VOLUME = {
  /** The recommendation is at most 7 exercises. */
  maxRecommended: 7,
  /** At most 4 exercises per group; extras go to the other groups. */
  maxPerGroup: 4,
  /** MERGE NOTE: S1 owns `BUILD_LIMITS.maxExercises` (10). */
  maxExercises: 10,
  minMinutes: 15,
  maxMinutes: 180,
} as const;

export interface GroupCount {
  group: BuilderGroupName;
  count: number;
}

/** Day mixes [Proto, §3.7], in order (the first group keeps at least one). */
export const BUILDER_DAY_MIXES: Readonly<Record<'chest' | 'back' | 'pull' | 'legs' | 'shoulders' | 'push', readonly GroupCount[]>> = {
  chest: [
    { group: 'Chest', count: 4 },
    { group: 'Triceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
  back: [
    { group: 'Back', count: 4 },
    { group: 'Biceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
  pull: [
    { group: 'Back', count: 4 },
    { group: 'Biceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
  legs: [
    { group: 'Legs', count: 5 },
    { group: 'Abs', count: 1 },
  ],
  shoulders: [
    { group: 'Shoulders', count: 4 },
    { group: 'Triceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
  push: [
    { group: 'Chest', count: 3 },
    { group: 'Shoulders', count: 2 },
    { group: 'Triceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
};

/**
 * The day's mix scaled to `n` exercises (largest remainder; ties to the
 * earlier group; the first group always keeps one), then at most 4 per
 * group with the extra spilled to the later groups in order.
 */
export function scaleMix(mix: readonly GroupCount[], n: number): GroupCount[] {
  const sum = mix.reduce((a, g) => a + g.count, 0);
  if (sum <= 0 || n <= 0) return [];
  const parts = mix.map((g, i) => {
    const q = (g.count * n) / sum;
    return { group: g.group, i, f: Math.floor(q), r: q - Math.floor(q) };
  });
  const first = parts[0];
  if (first !== undefined && first.f === 0) {
    first.f = 1;
    first.r = -1;
  }
  let left = n - parts.reduce((a, p) => a + p.f, 0);
  for (const p of [...parts].sort((a, b) => b.r - a.r || a.i - b.i)) {
    if (left <= 0) break;
    p.f += 1;
    left -= 1;
  }
  const cap = BUILDER_VOLUME.maxPerGroup;
  let spill = 0;
  for (const p of parts) {
    if (p.f > cap) {
      spill += p.f - cap;
      p.f = cap;
    }
  }
  for (const p of parts.slice(1)) {
    while (spill > 0 && p.f < cap) {
      p.f += 1;
      spill -= 1;
    }
  }
  return parts.filter((p) => p.f > 0).map((p) => ({ group: p.group, count: p.f }));
}

/**
 * `recommendBuilderGroups` (§3.7): the most exercises (max 7) that fit the
 * length, with Supersets as set, and the day's mix scaled to that count.
 * `fits(groups)` is the real build + estimate (injected; `recommendForSetup`
 * wires it). At least 1.
 */
export function recommendBuilderGroups(mix: readonly GroupCount[], fits: (groups: GroupCount[]) => boolean, maxExercises: number = BUILDER_VOLUME.maxRecommended): { count: number; groups: GroupCount[] } {
  for (let n = Math.min(maxExercises, BUILDER_VOLUME.maxRecommended); n >= 1; n -= 1) {
    const groups = scaleMix(mix, n);
    if (fits(groups)) return { count: n, groups };
  }
  return { count: 1, groups: scaleMix(mix, 1) };
}

// ---------------------------------------------------------------------------
// Accessories: Focused / Varied (§2.0.2 control 2)

export type AccessoryStyle = 'focused' | 'varied';

/** Focused = 2 accessories × 3 sets; Varied = 3 accessories × 2 sets at different angles [Ben, 20 Oct]. */
export const ACCESSORY_STYLES: Readonly<Record<AccessoryStyle, { accessories: number; sets: number }>> = {
  focused: { accessories: 2, sets: 3 },
  varied: { accessories: 3, sets: 2 },
};

/** The main group's count under a style: the main lift (if any) + the style's accessories, other groups unchanged. */
export function applyAccessoryStyle(groups: readonly GroupCount[], mainGroup: BuilderGroupName, hasMain: boolean, style: AccessoryStyle): GroupCount[] {
  const count = (hasMain ? 1 : 0) + ACCESSORY_STYLES[style].accessories;
  const has = groups.some((g) => g.group === mainGroup);
  const out = groups.map((g) => (g.group === mainGroup ? { ...g, count } : { ...g }));
  return has ? out : [{ group: mainGroup, count }, ...out];
}

// ---------------------------------------------------------------------------
// Build from Set up

export type LegPart = 'quads' | 'hamstrings_glutes' | 'calves';

/** §3.7: a Legs count spreads over the day's parts in this order. */
export const LEG_PART_ORDER: readonly LegPart[] = ['quads', 'hamstrings_glutes', 'quads', 'hamstrings_glutes', 'calves'];

export interface BuilderSetup {
  minutes: number;
  mainLiftExerciseId: string | null;
  supersets: boolean;
  /** In display order; the main lift counts as one of its own group's. */
  groups: readonly GroupCount[];
  /** Today's Accessories control; absent on Set up (group counts rule). */
  accessories?: AccessoryStyle;
  /** A custom day with only some leg parts: exercises come only from these (§2.2). */
  legParts?: readonly LegPart[];
}

/**
 * Exercise candidates per group, best first: Ben's history, then the
 * catalogue; only what this gym has and nothing pain-flagged (§3.7; the
 * service filters with `doableHere` and `painFlagCovering`).
 */
export type BuilderPool = (group: BuilderGroupName) => readonly string[];

/** Pick a group's exercises from its pool. */
function pickFor(group: BuilderGroupName, need: number, pool: BuilderPool, used: Set<string>, ctx: BuilderContext, opts: { varied: boolean; legParts: readonly LegPart[] | undefined; mainInfo: BuilderExerciseInfo | null }): string[] {
  if (need <= 0) return [];
  const candidates = pool(group).filter((id) => !used.has(id) && ctx.info(id) !== null);
  const out: string[] = [];
  const take = (id: string) => {
    out.push(id);
    used.add(id);
  };
  if (group === 'Legs') {
    const allowed = opts.legParts ?? (['quads', 'hamstrings_glutes', 'calves'] as const);
    const seq = LEG_PART_ORDER.filter((p) => allowed.includes(p));
    const mainPart = opts.mainInfo?.group === 'Legs' ? opts.mainInfo.part : null;
    const idx = mainPart === null ? -1 : seq.indexOf(mainPart as LegPart);
    const order = idx >= 0 ? [...seq.slice(0, idx), ...seq.slice(idx + 1)] : seq;
    for (let i = 0; out.length < need && i < order.length * 2; i += 1) {
      const part = order[i % order.length];
      const id = candidates.find((c) => !used.has(c) && ctx.info(c)?.part === part);
      if (id !== undefined) take(id);
    }
    for (const c of candidates) {
      if (out.length >= need) break;
      if (used.has(c)) continue;
      if (opts.legParts !== undefined && !opts.legParts.includes(ctx.info(c)?.part as LegPart)) continue;
      take(c);
    }
    return out;
  }
  if (opts.varied) {
    const angles = new Set<string>(opts.mainInfo?.group === group ? [opts.mainInfo.angle] : []);
    for (const c of candidates) {
      if (out.length >= need) break;
      const a = ctx.info(c)?.angle ?? '';
      if (used.has(c) || angles.has(a)) continue;
      take(c);
      angles.add(a);
    }
  }
  for (const c of candidates) {
    if (out.length >= need) break;
    if (!used.has(c)) take(c);
  }
  return out;
}

export interface BuildResult {
  workout: BuilderWorkout;
  fit: BuilderFitResult;
  /** Groups whose pool ran out (fewer exercises than asked). */
  short: BuilderGroupName[];
}

/**
 * `buildFromSetup`: main lift + each group's picks → `orderSlots` → pairs
 * when Supersets is on → fitted down to the length (`fitToMinutes`, shrink
 * only: Ben's group counts are never grown here). `trim: false` skips the
 * fit (used by the recommendation).
 */
export function buildFromSetup(setup: BuilderSetup, pool: BuilderPool, ctx: BuilderContext, opts: { trim?: boolean } = {}): BuildResult {
  const used = new Set<string>();
  const mainInfo = setup.mainLiftExerciseId === null ? null : ctx.info(setup.mainLiftExerciseId);
  const mainGroup = mainInfo?.group ?? setup.groups[0]?.group ?? null;
  const groups = setup.accessories !== undefined && mainGroup !== null ? applyAccessoryStyle(setup.groups, mainGroup, mainInfo !== null, setup.accessories) : setup.groups;
  const accessorySets = setup.accessories === undefined ? undefined : ACCESSORY_STYLES[setup.accessories].sets;
  const slots: BuilderSlot[] = [];
  if (setup.mainLiftExerciseId !== null && mainInfo !== null) {
    used.add(setup.mainLiftExerciseId);
    slots.push(makeSlot(setup.mainLiftExerciseId, { main: true }, ctx));
  }
  const short: BuilderGroupName[] = [];
  let total = slots.length;
  for (const g of groups) {
    const want = Math.min(BUILDER_VOLUME.maxPerGroup, Math.max(0, Math.round(g.count))) - (mainInfo !== null && g.group === mainGroup ? 1 : 0);
    const room = BUILDER_VOLUME.maxExercises - total;
    const need = Math.min(want, room);
    const ids = pickFor(g.group, need, pool, used, ctx, { varied: setup.accessories === 'varied', legParts: setup.legParts, mainInfo });
    if (ids.length < need) short.push(g.group);
    for (const id of ids) {
      const sets = accessorySets !== undefined && g.group === mainGroup ? accessorySets : undefined;
      slots.push(makeSlot(id, sets === undefined ? { main: false } : { main: false, workingSets: sets }, ctx));
    }
    total += ids.length;
  }
  let blocks = singlesOf(orderSlots(slots, ctx.info));
  if (setup.supersets) blocks = pairSlots(blocks, ctx.info);
  const workout: BuilderWorkout = { blocks, restLevel: 'normal' };
  if (opts.trim === false) {
    const m = estimateBuilderMinutes(workout, ctx);
    return { workout, fit: { workout, steps: [], status: m <= setup.minutes ? 'fits' : 'over', minutes: m }, short };
  }
  const fit = fitToMinutes(workout, ctx, { minutes: setup.minutes, mainGroup, grow: false, supersets: setup.supersets });
  return { workout: fit.workout, fit, short };
}

/** `Recommended for 60 min · 7`: the recommendation for this set-up's day mix, length and Supersets. */
export function recommendForSetup(mix: readonly GroupCount[], setup: Omit<BuilderSetup, 'groups'>, pool: BuilderPool, ctx: BuilderContext): { count: number; groups: GroupCount[] } {
  return recommendBuilderGroups(mix, (groups) => {
    const r = buildFromSetup({ ...setup, groups }, pool, ctx, { trim: false });
    const n = r.workout.blocks.reduce((m, b) => m + b.slots.length, 0);
    return n === groups.reduce((m, g) => m + g.count, 0) && r.fit.minutes <= setup.minutes;
  });
}
