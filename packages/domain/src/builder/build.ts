import { BUILD_LIMITS, BUILDER_FOCI } from '@fizz/schemas';
import { infoOrDefault, orderSlots, pairSlots, singlesOf } from './arrange';
import { estimateBuilderMinutes } from './estimate';
import { settleWarmups } from './warmups';
import { FIT_RULES, fitToMinutes, type BuilderFitResult } from './fit';
import { isAutoPickInfo } from './info';
import { autoPickClash, BUILDER_SUB_ROLES, subRoleOf } from './similar';
import { makeSlot } from './slot';
import { KG_PER_LB } from '../units';
import type { ArmPart, BuilderContext, BuilderExerciseInfo, BuilderGroupName, BuilderSlot, BuilderWorkout } from './types';


/**
 * Recommendations and the build from Set up (workout-builder-v3 §2.2, §2.0.2,
 * §3.7). Pure: exercise pools, muscle facts and loads are injected.
 */

export const BUILDER_VOLUME = {
  /** The recommendation is at most 7 exercises. */
  maxRecommended: 7,
  /** At most 4 exercises per group; extras go to the other groups. */
  maxPerGroup: 4,
  maxExercises: BUILD_LIMITS.maxExercises,
  minMinutes: FIT_RULES.minMinutes,
  maxMinutes: FIT_RULES.maxMinutes,
} as const;

export interface GroupCount {
  group: BuilderGroupName;
  count: number;
}

/** Day mixes [Proto, §3.7], in order (the first group keeps at least one). Arms picks triceps first on pressing days (D5). */
export const BUILDER_DAY_MIXES: Readonly<Record<'chest' | 'back' | 'pull' | 'legs' | 'shoulders' | 'push', readonly GroupCount[]>> = {
  chest: [
    { group: 'Chest', count: 4 },
    { group: 'Arms', count: 1 },
    { group: 'Core', count: 1 },
  ],
  back: [
    { group: 'Back', count: 4 },
    { group: 'Arms', count: 1 },
    { group: 'Core', count: 1 },
  ],
  pull: [
    { group: 'Back', count: 4 },
    { group: 'Arms', count: 1 },
    { group: 'Core', count: 1 },
  ],
  legs: [
    { group: 'Legs', count: 5 },
    { group: 'Core', count: 1 },
  ],
  shoulders: [
    { group: 'Shoulders', count: 4 },
    { group: 'Arms', count: 1 },
    { group: 'Core', count: 1 },
  ],
  push: [
    { group: 'Chest', count: 3 },
    { group: 'Shoulders', count: 2 },
    { group: 'Arms', count: 1 },
    { group: 'Core', count: 1 },
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

/** The arm parts the builder picks by itself (forearm work is Swap / Add only). */
export type PickedArmPart = Exclude<ArmPart, 'forearms'>;

/**
 * (D5, Ben 22–23 Oct) An Arms count alternates its parts: triceps first on a pressing day (the day's lead group is
 * Chest or Shoulders), biceps first otherwise. `armParts` (a custom day's chosen parts, or a pre-D5 stored
 * `Biceps` / `Triceps` row) keeps only those.
 */
export function armPartOrder(leadGroup: BuilderGroupName | null, armParts?: readonly PickedArmPart[]): PickedArmPart[] {
  const first: PickedArmPart[] = leadGroup === 'Chest' || leadGroup === 'Shoulders' ? ['triceps', 'biceps'] : ['biceps', 'triceps'];
  return armParts === undefined || armParts.length === 0 ? first : first.filter((p) => armParts.includes(p));
}

/** The group a day leads with: the main lift's, else its first group that isn't Arms or Core. */
export function leadGroupOf(setup: Pick<BuilderSetup, 'groups'>, mainInfo: Pick<BuilderExerciseInfo, 'group'> | null): BuilderGroupName | null {
  return mainInfo?.group ?? setup.groups.find((g) => g.group !== 'Arms' && g.group !== 'Core')?.group ?? setup.groups[0]?.group ?? null;
}

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
  /** (D5) A custom day with only some arm parts (or a pre-D5 `Biceps` / `Triceps` row): Arms picks only these. */
  armParts?: readonly PickedArmPart[];
}

/**
 * Exercise candidates per group, best first: Ben's history, then the
 * catalogue; only what this gym has and nothing pain-flagged (§3.7; the
 * service filters with `doableHere` and `painFlagCovering`).
 */
export type BuilderPool = (group: BuilderGroupName) => readonly string[];

/**
 * Pick a group's exercises from its pool (Ben, 23 Oct): never a near-duplicate of one already in the workout (the
 * main lift and earlier groups' picks included) and at most one traps isolation (`autoPickClash`); an uncovered
 * sub-role before a second exercise for a covered one, in the pool's order; on Back a vertical pull and a row first
 * (`BUILDER_SUB_ROLES`, a compound of each first), before shrugs or rear-delt work.
 */
function pickFor(group: BuilderGroupName, need: number, pool: BuilderPool, used: Set<string>, ctx: BuilderContext, opts: { varied: boolean; legParts: readonly LegPart[] | undefined; armOrder: readonly PickedArmPart[]; mainInfo: BuilderExerciseInfo | null }): string[] {
  if (need <= 0) return [];
  const candidates = pool(group).filter((id) => !used.has(id) && isAutoPickInfo(ctx.info(id)));
  const out: string[] = [];
  const take = (id: string) => {
    out.push(id);
    used.add(id);
  };
  /** Free to go in: not in yet, and no near-duplicate (or second traps isolation) of anything in. */
  const free = (id: string): boolean => !used.has(id) && autoPickClash(id, used, ctx.info) === null;
  if (group === 'Legs') {
    const allowed = opts.legParts ?? (['quads', 'hamstrings_glutes', 'calves'] as const);
    const seq = LEG_PART_ORDER.filter((p) => allowed.includes(p));
    const mainPart = opts.mainInfo?.group === 'Legs' ? opts.mainInfo.part : null;
    const idx = mainPart === null ? -1 : seq.indexOf(mainPart as LegPart);
    const order = idx >= 0 ? [...seq.slice(0, idx), ...seq.slice(idx + 1)] : seq;
    for (let i = 0; out.length < need && i < order.length * 2; i += 1) {
      const part = order[i % order.length];
      const id = candidates.find((c) => free(c) && ctx.info(c)?.part === part);
      if (id !== undefined) take(id);
    }
    for (const c of candidates) {
      if (out.length >= need) break;
      if (!free(c)) continue;
      if (opts.legParts !== undefined && !opts.legParts.includes(ctx.info(c)?.part as LegPart)) continue;
      take(c);
    }
    return out;
  }
  if (group === 'Arms') {
    // Alternate the parts in the day's order (D5), then any other arm exercise of an allowed part.
    const parts = opts.armOrder;
    for (let i = 0; out.length < need && i < parts.length * BUILDER_VOLUME.maxPerGroup; i += 1) {
      const part = parts[i % parts.length];
      const id = candidates.find((c) => free(c) && ctx.info(c)?.part === part);
      if (id !== undefined) take(id);
    }
    for (const c of candidates) {
      if (out.length >= need) break;
      if (free(c) && parts.includes(ctx.info(c)?.part as PickedArmPart)) take(c);
    }
    return out;
  }
  // Sub-roles: the main lift's (when it is this group's) is covered already.
  const role = (id: string): string => subRoleOf(infoOrDefault(ctx.info, id));
  const covered = new Set<string>(opts.mainInfo?.group === group ? [subRoleOf(opts.mainInfo)] : []);
  const takeRole = (id: string) => {
    take(id);
    covered.add(role(id));
  };
  // 1. Back: a vertical pull and a row first (a compound of each first), then rear delts.
  for (const r of BUILDER_SUB_ROLES[group] ?? []) {
    if (out.length >= need) break;
    if (covered.has(r.role)) continue;
    const of = candidates.filter((c) => free(c) && role(c) === r.role);
    const id = (r.compound ? of.find((c) => ctx.info(c)?.role === 'compound') : undefined) ?? of[0];
    if (id !== undefined) takeRole(id);
  }
  // 2. Any other uncovered sub-role of the group (its focus headings, and traps; Varied: any other angle), in pool order.
  const roles = new Set<string>([...BUILDER_FOCI[group], 'Traps']);
  for (const c of candidates) {
    if (out.length >= need) break;
    if (free(c) && (opts.varied || roles.has(role(c))) && !covered.has(role(c))) takeRole(c);
  }
  // 3. Then the pool's order.
  for (const c of candidates) {
    if (out.length >= need) break;
    if (free(c)) takeRole(c);
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
 * `buildFromSetup`: main lift + each group's picks → `orderSlots` (main
 * lift first; with none, the heaviest heavy compound first) → pairs when
 * Supersets is on (never the main lift or a heavy lift) → fitted down to the length (`fitToMinutes`, shrink
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
  const armOrder = armPartOrder(leadGroupOf(setup, mainInfo), setup.armParts);
  let total = slots.length;
  for (const g of groups) {
    const want = Math.min(BUILDER_VOLUME.maxPerGroup, Math.max(0, Math.round(g.count))) - (mainInfo !== null && g.group === mainGroup ? 1 : 0);
    const room = BUILDER_VOLUME.maxExercises - total;
    const need = Math.min(want, room);
    const ids = pickFor(g.group, need, pool, used, ctx, { varied: setup.accessories === 'varied', legParts: setup.legParts, armOrder, mainInfo });
    if (ids.length < need) short.push(g.group);
    for (const id of ids) {
      const sets = accessorySets !== undefined && g.group === mainGroup ? accessorySets : undefined;
      slots.push(makeSlot(id, sets === undefined ? { main: false } : { main: false, workingSets: sets }, ctx));
    }
    total += ids.length;
  }
  let blocks = singlesOf(orderSlots(slots, ctx.info, { load: (id) => totalLoadKg(id, ctx) }));
  if (setup.supersets) blocks = pairSlots(blocks, ctx.info);
  // (WU1–WU12) Warm-ups for each slot's place in the workout (WU2) before the time fit counts them.
  const workout: BuilderWorkout = settleWarmups({ blocks, restLevel: 'normal' }, ctx);
  if (opts.trim === false) {
    const m = estimateBuilderMinutes(workout, ctx);
    return { workout, fit: { workout, steps: [], status: m <= setup.minutes ? 'fits' : 'over', minutes: m }, short };
  }
  const fitted = fitToMinutes(workout, ctx, { minutes: setup.minutes, mainGroup, grow: false, supersets: setup.supersets });
  // The fit may reorder, pair or drop slots: warm-ups follow the final order.
  const settled = settleWarmups(fitted.workout, ctx);
  const fit = settled === fitted.workout ? fitted : { ...fitted, workout: settled, minutes: estimateBuilderMinutes(settled, ctx) };
  return { workout: fit.workout, fit, short };
}

/** An exercise's est. max in kg when it is a whole-bar load (total convention); null otherwise (for "heaviest first"). */
function totalLoadKg(exerciseId: string, ctx: BuilderContext): number | null {
  const l = ctx.loads(exerciseId);
  if (l.convention !== 'total' || l.e1rm === null) return null;
  return l.unit === 'kg' ? l.e1rm : l.e1rm * KG_PER_LB;
}

/** `Recommended for 60 min · 7`: the recommendation for this set-up's day mix, length and Supersets. */
export function recommendForSetup(mix: readonly GroupCount[], setup: Omit<BuilderSetup, 'groups'>, pool: BuilderPool, ctx: BuilderContext): { count: number; groups: GroupCount[] } {
  return recommendBuilderGroups(mix, (groups) => {
    const r = buildFromSetup({ ...setup, groups }, pool, ctx, { trim: false });
    const n = r.workout.blocks.reduce((m, b) => m + b.slots.length, 0);
    return n === groups.reduce((m, g) => m + g.count, 0) && r.fit.minutes <= setup.minutes;
  });
}
