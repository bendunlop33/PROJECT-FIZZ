import { bandInsertIndex, canAutoPair, infoOrDefault, pairSlots } from './arrange';
import { estimateBuilderMinutes, estimateBuilderSeconds } from './estimate';
import { makeSlot } from './slot';
import { BUILDER_SET_RULES, setWorkingCount, workingCount } from './set-rows';
import { ARM_GROUPS, type BuilderBlock, type BuilderContext, type BuilderGroupName, type BuilderSlot, type BuilderWorkout, type RestLevel } from './types';

/**
 * Fit to the time (workout-builder-v3 §2.0.2 control 3, §3.6, §9 Q16).
 * Shorter: only as far as needed, in order —
 *   (a) shorter rests, then shortest;
 *   (b) push effort: accessory last sets to RPE 9;
 *   (c) fewer accessory sets, last exercise first, not below 2;
 *   (d) drop exercises: abs → the other group's isolations → accessory
 *       isolations → compounds; never the main lift.
 * Main-lift sets and loads never change for time; with no main lift, at
 * least one exercise stays. Still over → `over`. Length clamped to 15–180.
 * Longer (grow): normal rests back first; then exercises (a second arm
 * exercise, then a main-group accessory), then +1 set on accessories (max
 * 4). The plan's own spare minutes stay as a buffer: only time beyond it is
 * filled. Slots Ben edited (`touched`) are never cut or grown.
 */

/*
 * Why a second fit ladder (review S8): `session/fit-time.ts`
 * (`fitPlanToMinutes`) trims a *started session* by marking planned sets
 * `skipped` only (FT3: never changes rests, adds, or drops by band), using
 * the pace-based `estimateRemainingDuration`. The builder fits a *draft*
 * before it starts, with Ben's §2.0.2 ladder (rest levels, sets, drops by
 * band, growing) and the §3.6 formula. Until S1 lands the Q15 shared time
 * constants, the two estimates can differ for the same workout; S1/S8 own
 * the "Today, builder and time left agree" check and the decision whether
 * `fitPlanToMinutes` is kept for mid-session trims or retired.
 */
export const FIT_RULES = {
  minAccessorySets: 2,
  maxAccessorySets: 4,
  maxExercises: 7,
  /** Length bounds (§2.0.2, §4.7): a length outside is clamped. */
  minMinutes: 15,
  maxMinutes: 180,
} as const;

/** A length clamped to 15–180 whole minutes (NaN → 15). */
export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return FIT_RULES.minMinutes;
  return Math.max(FIT_RULES.minMinutes, Math.min(FIT_RULES.maxMinutes, Math.round(minutes)));
}

export type BuilderFitStep =
  | { kind: 'rest'; from: RestLevel; to: RestLevel }
  | { kind: 'effort'; slotKeys: string[] }
  | { kind: 'sets'; slotKey: string; exerciseId: string; from: number; to: number }
  | { kind: 'drop'; slotKey: string; exerciseId: string }
  | { kind: 'add'; slotKey: string; exerciseId: string; why: 'arm' | 'main_group' | 'arm_partner' };

export type BuilderFitStatus = 'fits' | 'fitted' | 'over';

export interface BuilderFitResult {
  workout: BuilderWorkout;
  steps: BuilderFitStep[];
  /** `fits`: nothing needed; `fitted`: changed to fit; `over`: still over at the minimum. */
  status: BuilderFitStatus;
  /** The estimate after fitting (`about N min`). */
  minutes: number;
}

export interface BuilderFitOptions {
  minutes: number;
  /** The day's main group (for "the other group's isolations" and the main-group accessory). */
  mainGroup: BuilderGroupName | null;
  /** Fill spare time (Today's Time control); false = shrink only. */
  grow: boolean;
  supersets: boolean;
  /** The plan's own spare minutes (plan length − plan estimate), kept when growing. */
  planBufferMin?: number;
  /** Exercises to add when growing, best first (gym-available, not pain-flagged, injected). */
  addCandidates?: { arm: readonly string[]; mainGroup: readonly string[] };
  /**
   * Lowest length allowed (default `FIT_RULES.minMinutes`). The workout's
   * `+N min` fit (workout-table-v3 §5) fits only the sets left, which can
   * be shorter than a whole workout's 15 min.
   */
  floorMinutes?: number;
}

const cloneW = (w: BuilderWorkout): BuilderWorkout => ({ restLevel: w.restLevel, blocks: w.blocks.map((b) => ({ ...b, slots: [...b.slots] })) });
const allSlots = (w: BuilderWorkout): BuilderSlot[] => w.blocks.flatMap((b) => b.slots);

function replaceSlot(w: BuilderWorkout, key: string, next: BuilderSlot): BuilderWorkout {
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === key ? next : s)) })) };
}

/** Remove a slot; a pair it leaves with one member becomes a single. */
export function removeSlot(w: BuilderWorkout, key: string): BuilderWorkout {
  const blocks: BuilderBlock[] = [];
  for (const b of w.blocks) {
    const slots = b.slots.filter((s) => s.key !== key);
    if (slots.length === 0) continue;
    blocks.push(slots.length === 1 && b.slots.length > 1 ? { slots, auto: false } : { ...b, slots });
  }
  return { ...w, blocks };
}

/** `fitToMinutes`: the ladder above. */
export function fitToMinutes(input: BuilderWorkout, ctx: BuilderContext, rawOpts: BuilderFitOptions): BuilderFitResult {
  const floor = rawOpts.floorMinutes;
  const minutes = floor === undefined || !Number.isFinite(rawOpts.minutes) ? clampMinutes(rawOpts.minutes) : Math.max(floor, Math.min(FIT_RULES.maxMinutes, Math.round(rawOpts.minutes)));
  const opts: BuilderFitOptions = { ...rawOpts, minutes };
  const over = (w: BuilderWorkout) => estimateBuilderSeconds(w, ctx) > opts.minutes * 60 + 29;
  const done = (w: BuilderWorkout, steps: BuilderFitStep[], status: BuilderFitStatus): BuilderFitResult => ({ workout: w, steps: tidySteps(steps), status, minutes: estimateBuilderMinutes(w, ctx) });
  let w = cloneW(input);
  const steps: BuilderFitStep[] = [];
  if (!over(w)) return opts.grow ? grow(w, ctx, opts) : done(w, steps, 'fits');

  // (a) shorter rests, then shortest.
  for (const level of ['shorter', 'shortest'] as const) {
    if (rank(w.restLevel) >= rank(level)) continue;
    steps.push({ kind: 'rest', from: w.restLevel, to: level });
    w = { ...w, restLevel: level };
    if (!over(w)) return done(w, steps, 'fitted');
  }

  const accessories = () => allSlots(w).filter((s) => !s.main && s.touched !== true);
  // (b) push effort: each accessory's last working set @ RPE 9.
  const pushed: string[] = [];
  for (const s of accessories()) {
    const rows = s.rows.map((r) => ({ ...r }));
    const last = [...rows].reverse().find((r) => r.type === 'working');
    if (last === undefined || last.rpe === BUILDER_SET_RULES.lastWorkRpe) continue;
    last.rpe = BUILDER_SET_RULES.lastWorkRpe;
    w = replaceSlot(w, s.key, { ...s, rows });
    pushed.push(s.key);
  }
  if (pushed.length > 0) steps.push({ kind: 'effort', slotKeys: pushed });

  // (c) fewer accessory sets, last exercise first, not below 2.
  for (;;) {
    const s = [...accessories()].reverse().find((x) => workingCount(x) > FIT_RULES.minAccessorySets);
    if (s === undefined) break;
    const from = workingCount(s);
    w = replaceSlot(w, s.key, setWorkingCount(s, from - 1));
    const last = steps[steps.length - 1];
    if (last?.kind === 'sets' && last.slotKey === s.key) last.to = from - 1;
    else steps.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from, to: from - 1 });
    if (!over(w)) return done(w, steps, 'fitted');
  }

  // (d) drop exercises: abs → other group's isolations → accessory isolations → compounds.
  const band = (s: BuilderSlot): number => {
    const i = infoOrDefault(ctx.info, s.exerciseId);
    if (i.group === 'Abs') return 0;
    if (i.role === 'isolation') return i.group !== opts.mainGroup ? 1 : 2;
    return 3;
  };
  // Never below the main lift, or one exercise when there's none (§3.6; review S5).
  for (let b = 0; b <= 3; b += 1) {
    for (;;) {
      if (allSlots(w).length <= 1) return done(w, steps, 'over');
      const s = [...accessories()].reverse().find((x) => band(x) === b);
      if (s === undefined) break;
      w = removeSlot(w, s.key);
      steps.push({ kind: 'drop', slotKey: s.key, exerciseId: s.exerciseId });
      if (!over(w)) return done(restoreSets(w, steps, over), steps, 'fitted');
    }
  }
  return done(w, steps, 'over');
}

/**
 * After a drop freed time: give the remaining accessories back the sets step
 * (c) took, first exercise first, as far as the time allows ("only as far
 * as needed"). Steps are updated to the net change.
 */
function restoreSets(input: BuilderWorkout, steps: BuilderFitStep[], over: (w: BuilderWorkout) => boolean): BuilderWorkout {
  let w = input;
  for (let changed = true; changed; ) {
    changed = false;
    for (const st of steps) {
      if (st.kind !== 'sets' || st.to >= st.from) continue;
      const s = allSlots(w).find((x) => x.key === st.slotKey);
      if (s === undefined) continue;
      const next = replaceSlot(w, s.key, setWorkingCount(s, st.to + 1));
      if (over(next)) continue;
      w = next;
      st.to += 1;
      changed = true;
    }
  }
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const st = steps[i];
    if (st?.kind === 'sets' && st.to === st.from) steps.splice(i, 1);
  }
  return w;
}

/** A slot that was cut and then dropped reports only the drop. */
function tidySteps(steps: readonly BuilderFitStep[]): BuilderFitStep[] {
  const dropped = new Set(steps.flatMap((s) => (s.kind === 'drop' ? [s.slotKey] : [])));
  return steps.filter((s) => !(s.kind === 'sets' && dropped.has(s.slotKey)));
}

const rank = (l: RestLevel): number => (l === 'normal' ? 0 : l === 'shorter' ? 1 : 2);

/** Longer than needed: rests back, then exercises, then sets, within the time beyond the plan's buffer. */
function grow(input: BuilderWorkout, ctx: BuilderContext, opts: BuilderFitOptions): BuilderFitResult {
  const limitS = (opts.minutes - Math.max(0, opts.planBufferMin ?? 0)) * 60 + 29;
  const fits = (w: BuilderWorkout) => estimateBuilderSeconds(w, ctx) <= limitS;
  let w = input;
  const steps: BuilderFitStep[] = [];
  // Rests back toward normal.
  for (const level of ['normal', 'shorter'] as const) {
    if (rank(w.restLevel) <= rank(level)) break;
    const next = { ...w, restLevel: level };
    if (fits(next)) {
      steps.push({ kind: 'rest', from: w.restLevel, to: level });
      w = next;
      break;
    }
  }
  const inWorkout = (id: string) => allSlots(w).some((s) => s.exerciseId === id);
  const count = () => allSlots(w).length;
  const groupOf = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId).group;

  // A second arm exercise: an arm group with exactly one exercise gets another.
  const armGroups = ARM_GROUPS.filter((g) => allSlots(w).filter((s) => groupOf(s) === g).length === 1);
  for (const id of opts.addCandidates?.arm ?? []) {
    if (armGroups.length === 0 || count() >= FIT_RULES.maxExercises) break;
    const g = infoOrDefault(ctx.info, id).group;
    if (inWorkout(id) || !ARM_GROUPS.includes(g)) continue;
    const next = insertAfterGroup(w, makeSlot(id, { main: false }, ctx), armGroups, ctx, opts.supersets);
    if (fits(next.w)) {
      w = next.w;
      steps.push({ kind: 'add', slotKey: next.key, exerciseId: id, why: 'arm' });
    }
    break;
  }
  // Then one more accessory for the day's main group.
  const mg = opts.mainGroup;
  if (mg !== null && count() < FIT_RULES.maxExercises) {
    const id = (opts.addCandidates?.mainGroup ?? []).find((x) => !inWorkout(x) && ctx.info(x)?.group === mg);
    if (id !== undefined) {
      const next = insertAfterGroup(w, makeSlot(id, { main: false }, ctx), [mg], ctx, opts.supersets);
      if (fits(next.w)) {
        w = next.w;
        steps.push({ kind: 'add', slotKey: next.key, exerciseId: id, why: 'main_group' });
      }
    }
  }
  // Then +1 set on accessories, round by round, max 4.
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of allSlots(w)) {
      if (s.main || s.touched === true || workingCount(s) >= FIT_RULES.maxAccessorySets) continue;
      const from = workingCount(s);
      const next = replaceSlot(w, s.key, setWorkingCount(s, from + 1));
      if (!fits(next)) continue;
      w = next;
      changed = true;
      const prev = steps.find((x): x is Extract<BuilderFitStep, { kind: 'sets' }> => x.kind === 'sets' && x.slotKey === s.key);
      if (prev !== undefined) prev.to = from + 1;
      else steps.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from, to: from + 1 });
    }
  }
  return { workout: w, steps, status: steps.length === 0 ? 'fits' : 'fitted', minutes: estimateBuilderMinutes(w, ctx) };
}

/** Insert a new single where the §3.4 bands put it (`bandInsertIndex`); with Supersets on, pair only the new one (review B3). */
function insertAfterGroup(w: BuilderWorkout, slot: BuilderSlot, groups: readonly BuilderGroupName[], ctx: BuilderContext, supersets: boolean): { w: BuilderWorkout; key: string } {
  const blocks = [...w.blocks];
  blocks.splice(bandInsertIndex(blocks, slot, ctx.info, groups), 0, { slots: [slot], auto: false });
  return { w: { ...w, blocks: supersets ? pairSlots(blocks, ctx.info, { only: new Set([slot.key]) }) : blocks }, key: slot.key };
}

// ---------------------------------------------------------------------------
// Abs off (§2.0.2 control 4 + "freed time is filled")

export interface AbsOffResult {
  workout: BuilderWorkout;
  removed: string[];
  /** The arm partner put in the abs' place (supersets on), if any. */
  partner: { slotKey: string; exerciseId: string } | null;
}

/**
 * `absOff`: removes the ab exercises and splits their supersets. With
 * Supersets on, an arm exercise that was paired with abs gets an arm
 * partner in the same slot (pushdown + curl), so the time stays about the
 * same. `armCandidates`: best first, injected.
 */
export function absOff(w: BuilderWorkout, ctx: BuilderContext, opts: { supersets: boolean; armCandidates: readonly string[] }): AbsOffResult {
  const isAbs = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId).group === 'Abs';
  const removed = w.blocks.flatMap((b) => b.slots.filter(isAbs).map((s) => s.key));
  let partner: AbsOffResult['partner'] = null;
  const present = new Set(w.blocks.flatMap((b) => b.slots.map((s) => s.exerciseId)));
  const blocks: BuilderBlock[] = [];
  for (const b of w.blocks) {
    const kept = b.slots.filter((s) => !isAbs(s));
    if (kept.length === 0) continue;
    if (kept.length === b.slots.length) {
      blocks.push(b);
      continue;
    }
    const arm = kept.length === 1 ? kept[0] : undefined;
    if (opts.supersets && partner === null && arm !== undefined && ARM_GROUPS.includes(infoOrDefault(ctx.info, arm.exerciseId).group)) {
      const id = opts.armCandidates.find((c) => !present.has(c) && ARM_GROUPS.includes(infoOrDefault(ctx.info, c).group) && canAutoPair(arm, { exerciseId: c, main: false }, ctx.info));
      if (id !== undefined) {
        const slot = makeSlot(id, { main: false, workingSets: workingCount(arm) }, ctx);
        partner = { slotKey: slot.key, exerciseId: id };
        present.add(id);
        blocks.push({ slots: [arm, slot], auto: true });
        continue;
      }
    }
    blocks.push(kept.length === 1 ? { slots: kept, auto: false } : { ...b, slots: kept });
  }
  return { workout: { ...w, blocks }, removed, partner };
}
