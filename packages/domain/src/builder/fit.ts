import { bandInsertIndex, canAutoPair, infoOrDefault, pairSlots } from './arrange';
import { estimateBuilderMinutes, estimateBuilderSeconds } from './estimate';
import { makeSlot } from './slot';
import { BUILDER_SET_RULES, isTimedSlot, setWorkingCount, workingCount } from './set-rows';
import { ARM_GROUPS, type BuilderBlock, type BuilderContext, type BuilderGroupName, type BuilderInfoLookup, type BuilderSlot, type BuilderWorkout, type RestLevel } from './types';

/**
 * Fit to the time: the one shared fit (Today's Time control, Your workout's Time, Set up's length, the coach's
 * length change and the workout's `+N min` offer). Shorter follows fit-to-time.md's 22 Oct revision (Ben, 22–23 Oct,
 * D9), only as far as needed:
 *   (a) free savings first: shorter rests, then shortest; then, only with Supersets on, pair what the builder may
 *       pair (`pairSlots`: never the main lift, a heavy lift, a pair Ben unlinked or a slot he edited). With
 *       Supersets off nothing is ever paired (design review V14);
 *   (b) only when asked (`pushEffort`, the workout's `+N min` offer, workout-table-v3 §5): accessory last sets to
 *       RPE 9. Today and Your workout have no effort step;
 *   (c) the cheapest cut, step by step: a set off an exercise (never below 2) or a whole exercise (which saves its
 *       changeover too). When one cut is enough, the one that loses least (unless cheaper cuts per minute would lose
 *       less in all: never a compound for want of two isolation sets, design review V15); otherwise the one that
 *       loses least per minute saved. Value per set (`FIT_SET_VALUE`): compound accessory 3, isolation 2, abs 2.5 (Ben's choice),
 *       extra 1.5 (another group's isolation, or an exercise with no builder group such as cardio). Ties: later in
 *       the workout first, a set before a whole exercise. The main lift is never cut; at least one exercise stays;
 *   (d) sets a later cut made unneeded come back, most valuable first.
 * Main-lift sets and loads never change for time. Still over → `over`. Length clamped to 15–180.
 * Longer (grow): normal rests back first; then exercises (a second arm exercise, then a main-group accessory), then
 * +1 set on accessories (max 4). The plan's own spare minutes stay as a buffer: only time beyond it is filled.
 * Slots Ben edited (`touched`) are never cut, paired or grown.
 * The sets lost are what the week's carry-over offer is made from (`fitCarryOver`).
 */

/*
 * Why a second fit ladder (review S8): `session/fit-time.ts`
 * (`fitPlanToMinutes`) trims a *started session* by marking planned sets
 * `skipped` only (FT3: never changes rests, adds, or drops by band), using
 * the pace-based `estimateRemainingDuration`. The builder fits a *draft*
 * before it starts, with the ladder above and the §3.6 formula. Until S1 lands the Q15 shared time
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

/**
 * Training value of one working set when the fit weighs a cut (fit-to-time 22 Oct revision; abs 2.5 is Ben's
 * choice). `extra`: an isolation of another group than the day's main one, or an exercise with no builder group.
 */
export const FIT_SET_VALUE = { compound: 3, isolation: 2, abs: 2.5, extra: 1.5 } as const;

/** One working set's value for the fit (`FIT_SET_VALUE`); `mainGroup` null: every isolation counts as the day's. */
export function fitSetValue(exerciseId: string, info: BuilderInfoLookup, mainGroup: BuilderGroupName | null): number {
  const i = info(exerciseId);
  if (i === null) return FIT_SET_VALUE.extra;
  if (i.group === 'Abs') return FIT_SET_VALUE.abs;
  if (i.role === 'compound') return FIT_SET_VALUE.compound;
  return mainGroup === null || i.group === mainGroup ? FIT_SET_VALUE.isolation : FIT_SET_VALUE.extra;
}

/** A length clamped to 15–180 whole minutes (NaN → 15). */
export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return FIT_RULES.minMinutes;
  return Math.max(FIT_RULES.minMinutes, Math.min(FIT_RULES.maxMinutes, Math.round(minutes)));
}

export type BuilderFitStep =
  | { kind: 'rest'; from: RestLevel; to: RestLevel }
  /** (22 Oct revision) Supersets on: two singles the fit paired (no work lost). */
  | { kind: 'pair'; slotKeys: readonly string[] }
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
  /** The day's main group (the value of an isolation set, and the main-group accessory when growing). */
  mainGroup: BuilderGroupName | null;
  /** Fill spare time (Today's Time control); false = shrink only. */
  grow: boolean;
  /** Supersets on: the fit may pair singles as a free saving (never when off). */
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
  /**
   * Step (b), accessory last sets to RPE 9 (default false: the 22 Oct fit-to-time revision has no effort step, so
   * Today, Your workout and Set up never push effort for time). The workout's `+N min` offer passes true (its own
   * spec, workout-table-v3 §5).
   */
  pushEffort?: boolean;
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

/** One cut the fit could make: a set off a slot, or the whole slot. */
interface FitCut {
  kind: 'sets' | 'drop';
  slot: BuilderSlot;
  /** The slot's place in the workout (later is cut first on a tie). */
  at: number;
  /** Training lost (`FIT_SET_VALUE` × sets). */
  lost: number;
  /** Seconds the cut saves (> 0). */
  saves: number;
  /**
   * Training seconds it saves (sets, rests and the changeover; warm-ups left out), what "per minute saved" is
   * weighed on: a compound's warm-ups are no reason to drop it first (the prototype's time model; design review V15).
   */
  rateS: number;
  next: BuilderWorkout;
}

/** Ties between two cuts: later in the workout first, then a set before a whole exercise. */
function laterFirst(a: FitCut, b: FitCut): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.kind === 'sets' && b.kind === 'drop';
}

/** The cut that loses least (an enough one); ties `laterFirst`. */
function leastLost(cuts: readonly FitCut[]): FitCut | null {
  let best: FitCut | null = null;
  for (const c of cuts) if (best === null || c.lost < best.lost - 1e-9 || (Math.abs(c.lost - best.lost) <= 1e-9 && laterFirst(c, best))) best = c;
  return best;
}

/** The cut that loses least per second saved; ties `laterFirst`. */
function bestRate(cuts: readonly FitCut[]): FitCut | null {
  let best: FitCut | null = null;
  for (const c of cuts) {
    const x = c.lost / c.rateS;
    const y = best === null ? Infinity : best.lost / best.rateS;
    if (best === null || x < y - 1e-12 || (Math.abs(x - y) <= 1e-12 && laterFirst(c, best))) best = c;
  }
  return best;
}

/** `fitToMinutes`: the ladder above. */
export function fitToMinutes(input: BuilderWorkout, ctx: BuilderContext, rawOpts: BuilderFitOptions): BuilderFitResult {
  const floor = rawOpts.floorMinutes;
  const minutes = floor === undefined || !Number.isFinite(rawOpts.minutes) ? clampMinutes(rawOpts.minutes) : Math.max(floor, Math.min(FIT_RULES.maxMinutes, Math.round(rawOpts.minutes)));
  const opts: BuilderFitOptions = { ...rawOpts, minutes };
  const limitS = opts.minutes * 60 + 29;
  const secs = (w: BuilderWorkout) => estimateBuilderSeconds(w, ctx);
  const over = (w: BuilderWorkout) => secs(w) > limitS;
  const done = (w: BuilderWorkout, steps: BuilderFitStep[], status: BuilderFitStatus): BuilderFitResult => ({ workout: w, steps: tidySteps(steps), status, minutes: estimateBuilderMinutes(w, ctx) });
  let w = cloneW(input);
  const steps: BuilderFitStep[] = [];
  if (!over(w)) return opts.grow ? grow(w, ctx, opts) : done(w, steps, 'fits');

  // (a) Free savings: shorter rests, then shortest.
  for (const level of ['shorter', 'shortest'] as const) {
    if (rank(w.restLevel) >= rank(level)) continue;
    steps.push({ kind: 'rest', from: w.restLevel, to: level });
    w = { ...w, restLevel: level };
    if (!over(w)) return done(w, steps, 'fitted');
  }
  // Then, with Supersets on only, pairs (no work lost); never a slot Ben edited.
  if (opts.supersets) {
    const blocks = pairSlots(w.blocks, ctx.info, { skip: (s) => s.touched === true });
    const made = blocks.filter((b) => b.slots.length > 1 && !w.blocks.includes(b));
    const next: BuilderWorkout = { ...w, blocks };
    if (made.length > 0 && secs(next) < secs(w)) {
      for (const b of made) steps.push({ kind: 'pair', slotKeys: b.slots.map((s) => s.key) });
      w = next;
      if (!over(w)) return done(w, steps, 'fitted');
    }
  }

  const accessories = () => allSlots(w).filter((s) => !s.main && s.touched !== true);
  // (b) Only when asked: each accessory's last working set @ RPE 9.
  const pushed: string[] = [];
  for (const s of opts.pushEffort === true ? accessories() : []) {
    // A timed or cardio set has no effort target to push (22 Oct).
    if (isTimedSlot(s)) continue;
    const rows = s.rows.map((r) => ({ ...r }));
    const last = [...rows].reverse().find((r) => r.type === 'working');
    if (last === undefined || last.rpe === BUILDER_SET_RULES.lastWorkRpe) continue;
    last.rpe = BUILDER_SET_RULES.lastWorkRpe;
    w = replaceSlot(w, s.key, { ...s, rows });
    pushed.push(s.key);
  }
  if (pushed.length > 0) steps.push({ kind: 'effort', slotKeys: pushed });
  if (!over(w)) return done(w, steps, 'fitted');

  // (c) The cheapest cut, one at a time.
  const valueOf = (s: BuilderSlot) => fitSetValue(s.exerciseId, ctx.info, opts.mainGroup);
  const trainingSecs = (x: BuilderWorkout) => secs({ ...x, blocks: x.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => ({ ...s, rows: s.rows.filter((r) => r.type !== 'warmup') })) })) });
  const cutsOf = (x: BuilderWorkout): FitCut[] => {
    const now = secs(x);
    const nowT = trainingSecs(x);
    const slots = allSlots(x);
    const out: FitCut[] = [];
    for (const [at, s] of slots.entries()) {
      if (s.main || s.touched === true) continue;
      const n = workingCount(s);
      const options: Omit<FitCut, 'saves' | 'rateS'>[] = [];
      if (n > FIT_RULES.minAccessorySets) options.push({ kind: 'sets', slot: s, at, lost: valueOf(s), next: replaceSlot(x, s.key, setWorkingCount(s, n - 1)) });
      // Never the last exercise (with no main lift, one stays).
      if (slots.length > 1) options.push({ kind: 'drop', slot: s, at, lost: valueOf(s) * n, next: removeSlot(x, s.key) });
      for (const o of options) {
        const saves = now - secs(o.next);
        const rateS = nowT - trainingSecs(o.next);
        if (saves > 0 && rateS > 0) out.push({ ...o, saves, rateS });
      }
    }
    return out;
  };
  /**
   * Training lost on the per-minute path from `x` until it fits (Infinity: it never does): the least-lost-per-minute
   * cut each step, finishing with an enough cut when one loses no more than that step would.
   */
  const pathLost = (start: BuilderWorkout): number => {
    let x = start;
    let total = 0;
    while (over(x)) {
      const cuts = cutsOf(x);
      const rate = bestRate(cuts);
      if (rate === null) return Infinity;
      const enough = leastLost(cuts.filter((c) => c.saves >= secs(x) - limitS));
      if (enough !== null && enough.lost <= rate.lost + 1e-9) return total + enough.lost;
      total += rate.lost;
      x = rate.next;
    }
    return total;
  };
  while (over(w)) {
    const cuts = cutsOf(w);
    const rate = bestRate(cuts);
    if (rate === null) return done(w, steps, 'over');
    // When one cut is enough, the one that loses least; unless the per-minute cuts lose no more in all (design review
    // V15: a compound isn't dropped for want of a couple of cheaper cuts; on a tie the per-minute path keeps it).
    const enough = leastLost(cuts.filter((c) => c.saves >= secs(w) - limitS));
    const cut = enough !== null && (enough === rate || enough.lost < rate.lost + pathLost(rate.next) - 1e-9) ? enough : rate;
    w = cut.next;
    if (cut.kind === 'drop') {
      steps.push({ kind: 'drop', slotKey: cut.slot.key, exerciseId: cut.slot.exerciseId });
      continue;
    }
    const from = workingCount(cut.slot);
    const key = cut.slot.key;
    const prev = steps.find((x): x is Extract<BuilderFitStep, { kind: 'sets' }> => x.kind === 'sets' && x.slotKey === key);
    if (prev !== undefined) prev.to = from - 1;
    else steps.push({ kind: 'sets', slotKey: key, exerciseId: cut.slot.exerciseId, from, to: from - 1 });
  }
  // (d) Sets a later cut made unneeded come back.
  return done(restoreSets(w, steps, over, (key) => {
    const s = allSlots(w).find((x) => x.key === key);
    return s === undefined ? 0 : valueOf(s);
  }), steps, 'fitted');
}

/** Training sets a fit took from one muscle group, for the week's carry-over offer. */
export interface FitCarryOver {
  group: BuilderGroupName;
  /** 2–4 (`FIT_CARRY`). */
  sets: number;
}

/** The carry-over's bounds (fit-to-time 22 Oct revision, item 3): offered from 2 sets lost, at most 4. */
export const FIT_CARRY = { minSets: 2, maxSets: 4 } as const;

/**
 * `fitCarryOver` (fit-to-time 22 Oct revision, item 3: "the week is protected"): the working sets a fit took, by
 * muscle group (an exercise left out counts all its sets; the main lift is never cut). The group that lost most
 * (2 or more; a tie goes to the day's main group, then the earlier one) is what the next day for that muscle is
 * offered, capped at 4. Pure: never applied by itself; the caller makes it an offer with Apply and Undo. Null: fewer
 * than 2 sets lost in any group.
 */
export function fitCarryOver(before: BuilderWorkout, after: BuilderWorkout, info: BuilderInfoLookup, mainGroup: BuilderGroupName | null): FitCarryOver | null {
  const kept = new Map(allSlots(after).map((s) => [s.key, s]));
  const lost = new Map<BuilderGroupName, number>();
  for (const s of allSlots(before)) {
    const g = info(s.exerciseId)?.group;
    if (s.main || g === undefined) continue;
    const k = kept.get(s.key);
    const n = workingCount(s) - (k === undefined || k.exerciseId !== s.exerciseId ? 0 : workingCount(k));
    if (n > 0) lost.set(g, (lost.get(g) ?? 0) + n);
  }
  let best: FitCarryOver | null = null;
  for (const [group, sets] of lost) if (best === null || sets > best.sets || (sets === best.sets && group === mainGroup)) best = { group, sets };
  return best === null || best.sets < FIT_CARRY.minSets ? null : { group: best.group, sets: Math.min(FIT_CARRY.maxSets, best.sets) };
}

/**
 * After a later cut freed time: give the kept exercises back the sets an earlier cut took, most valuable first (then
 * the earlier exercise), as far as the time allows ("only as far as needed"). Steps are updated to the net change.
 */
function restoreSets(input: BuilderWorkout, steps: BuilderFitStep[], over: (w: BuilderWorkout) => boolean, valueOf: (slotKey: string) => number): BuilderWorkout {
  let w = input;
  const order = new Map(allSlots(input).map((s, i) => [s.key, i]));
  const cuts = steps.filter((st): st is Extract<BuilderFitStep, { kind: 'sets' }> => st.kind === 'sets').sort((a, b) => valueOf(b.slotKey) - valueOf(a.slotKey) || (order.get(a.slotKey) ?? 0) - (order.get(b.slotKey) ?? 0));
  for (let changed = true; changed; ) {
    changed = false;
    for (const st of cuts) {
      if (st.to >= st.from) continue;
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
