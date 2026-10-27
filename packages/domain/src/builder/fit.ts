import { bandInsertIndex, canAutoPair, infoOrDefault, pairSlots } from './arrange';
import { BUILDER_TIME, blockSeconds, estimateBuilderMinutes, estimateBuilderSeconds } from './estimate';
import { DEFAULT_FIT_REST_LEVEL } from './rest';
import { makeSlot } from './slot';
import { autoPickClash, BUILDER_SUB_ROLES, subRoleOf } from './similar';
import { BUILDER_SET_RULES, isTimedSlot, setWorkingCount, workingCount } from './set-rows';
import { type BuilderBlock, type BuilderContext, type BuilderGroupName, type BuilderInfoLookup, type BuilderSlot, type BuilderWorkout, type RestLevel } from './types';

/**
 * Fit to the time: the one shared fit (Today's Time control, Your workout's Time, Set up's length, the coach's
 * length change and the workout's `+N min` offer). Shorter, in Ben's 27 Oct order (fit-to-time.md revision 27 Oct;
 * it replaces the 22 Oct revision's "all rests first"), only as far as needed:
 *   (1) accessory rests: down to the level Ben picked in Profile › Training › `Rest when short on time`
 *       (`ctx.fitRestLevel`; default `shortest`, Minimum rest), one level at a time (`BUILDER_REST_LEVELS`: isolation
 *       and round 1:30 → 1:15 → 1:00, compound 2:00 → 1:30 and never lower). Standard rest: no rest step. The main
 *       lift's rests (top, back-off, working) never change for time; Ben's own rests and edited slots stay;
 *   (2) only with Supersets on, pair what the builder may pair (`pairSlots`: never the main lift, a heavy lift, a pair
 *       Ben unlinked or a slot he edited). With Supersets off nothing is ever paired (design review V14);
 *   (b) only when asked (`pushEffort`, the workout's `+N min` offer, workout-table-v3 §5): accessory last sets to
 *       RPE 9. Today and Your workout have no effort step;
 *   (F) rule F (Ben, 27 Oct, `armsCutFirst`): on a day whose main group isn't Arms the arm isolations are cut first in
 *       (3) and (4): trimmed, then left out (already in step 3), before any other accessory loses a set;
 *   (3) accessory sets down to 2, nothing left out: of every way of keeping each accessory at 2+ sets, the one that
 *       fits and keeps the most training value, so the lowest-value sets go first (`FIT_SET_VALUE`: extra 1.5,
 *       isolation 2, abs 2.5, compound 3). Wherever trimming alone fits, nothing is left out. A main sub-role's
 *       exercise (below) loses sets only once every other accessory is at 2 (Ben, 27 Oct: sets before exercises, so
 *       the 24 Oct "others are cut first" now means others' sets first, then others left out);
 *   (4) only then leave out whole accessories: the least training lost (D9; SP2): of every way of keeping each
 *       accessory at 2+ sets or leaving it out, the one that fits and keeps the most training value. Ties: more sets
 *       kept, then more of the time used, then the earlier exercises kept. So it cuts only as far as needed: nothing
 *       it left out or cut could come back and still fit (review todaylean B1), and a compound is never dropped for
 *       want of two isolation sets (design review V15). The main lift is never cut; at least one exercise stays.
 *       (Ben, 24 Oct) Sub-role coverage: on a day whose main group has main sub-roles (`BUILDER_SUB_ROLES`: a Back
 *       day's vertical pull and row) the fit keeps one exercise for each (`subRoleGuards`). Other exercises are cut first; if that isn't enough, those
 *       exercises keep their place and lose sets (down to 2) before anything else they could keep; still too long, the
 *       later main sub-role goes before the earlier one (the row before the vertical pull); only then is coverage given up.
 * Main-lift sets, loads and rests never change for time. Still over → `over`. Length clamped to 15–180.
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
  if (i.group === 'Core') return FIT_SET_VALUE.abs;
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
  /**
   * The warm-ups the caller plans after the fit (`settleWarmups`), so a cut is checked with them: an exercise a cut
   * leaves without its pair partner can need a warm-up of its own. Absent (a started workout's sets): as they are.
   */
  settle?: (w: BuilderWorkout) => BuilderWorkout;
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
  const limitS = opts.minutes * 60 + 29;
  const secs = (w: BuilderWorkout) => estimateBuilderSeconds(w, ctx);
  const over = (w: BuilderWorkout) => secs(w) > limitS;
  const done = (w: BuilderWorkout, steps: BuilderFitStep[], status: BuilderFitStatus): BuilderFitResult => ({ workout: w, steps, status, minutes: estimateBuilderMinutes(w, ctx) });
  let w = cloneW(input);
  const steps: BuilderFitStep[] = [];
  if (!over(w)) return opts.grow ? grow(w, ctx, opts) : done(w, steps, 'fits');

  // (1) Accessory rests, one level at a time, no lower than Ben's `Rest when short on time` (the main lift's never move).
  const restFloor = ctx.fitRestLevel ?? DEFAULT_FIT_REST_LEVEL;
  for (const level of ['shorter', 'shortest'] as const) {
    if (rank(level) > rank(restFloor)) break;
    if (rank(w.restLevel) >= rank(level)) continue;
    steps.push({ kind: 'rest', from: w.restLevel, to: level });
    w = { ...w, restLevel: level };
    if (!over(w)) return done(w, steps, 'fitted');
  }
  // (2) Then, with Supersets on only, pairs (no work lost); never a slot Ben edited.
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

  // With `settle`, a cut that fits only before the warm-ups are planned again (an exercise left alone by its pair
  // partner may need its own) is tried again with that much less room, at most three times; still over, it doesn't fit.
  const settle = opts.settle;
  const settledFit = (limit0: number, run: (limit: number) => ReturnType<typeof leastLostFit>): ReturnType<typeof leastLostFit> => {
    let limit = limit0;
    let r = run(limit);
    for (let tries = 0; settle !== undefined && r.fits; tries += 1) {
      const settled = secs(settle(r.workout));
      if (settled <= limitS) return r;
      if (tries === 3) return { ...r, fits: false };
      // Room for the warm-ups this cut needs (`settled − secs`), and always less than the last try.
      limit = Math.min(limit - (settled - limitS), limitS - (settled - secs(r.workout)));
      r = run(limit);
    }
    return r;
  };
  const valueOf = (s: BuilderSlot) => fitSetValue(s.exerciseId, ctx.info, opts.mainGroup);
  const cutFirst = armsCutFirst(ctx.info, opts.mainGroup);
  const weigh: FitWeigh = { valueOf, cutFirst };
  // (3) Accessory sets down to 2, nothing left out (Ben, 27 Oct): the most value kept, the main sub-roles' sets last
  // (their value is weighed first, as in step 4). Rule F (Ben, 27 Oct): on a day whose main group isn't Arms, the arm
  // isolations are trimmed and left out here, before any other accessory loses a set.
  const from = w;
  const trimmed = settledFit(limitS, (limit) => leastLostFit(from, ctx, limit, weigh, new Map(subRoleGuards(from, ctx.info, opts.mainGroup).map((g) => [g.slotKey, 'kept'])), false));
  if (trimmed.fits) {
    steps.push(...trimmed.steps);
    return done(trimmed.workout, steps, 'fitted');
  }
  // (4) The least training lost: every way of keeping each accessory (2+ sets, or left out) is weighed at once,
  // keeping the main sub-roles' exercises as long as anything else can go (Ben, 24 Oct).
  const best = settledFit(limitS, (limit) => guardedFit(from, ctx, limit, weigh, opts.mainGroup));
  steps.push(...best.steps);
  return done(best.workout, steps, best.fits ? 'fitted' : 'over');
}

/**
 * Rule F (Ben, 27 Oct; redesign-27oct.md §F): on a day whose main group isn't Arms (Chest, Back, Shoulders, Legs; a
 * Push or Pull day by its main lift's group), the arm isolations (biceps, triceps: group `Arms`, role `isolation`) are
 * cut first: trimmed to 2 and then left out before any other accessory (the day's main-group accessories, abs, the
 * rest) loses a set. The predicate is false for every slot on an Arms day or when the main group isn't known (null).
 * An arm compound (close-grip bench, dips) is weighed as before.
 */
export function armsCutFirst(info: BuilderInfoLookup, mainGroup: BuilderGroupName | null): (s: Pick<BuilderSlot, 'exerciseId'>) => boolean {
  if (mainGroup === null || mainGroup === 'Arms') return () => false;
  return (s) => {
    const i = info(s.exerciseId);
    return i !== null && i.group === 'Arms' && i.role === 'isolation';
  };
}

/** How the fit weighs a slot: its value per set, and whether it is cut before everything else (rule F). */
interface FitWeigh {
  valueOf: (s: BuilderSlot) => number;
  cutFirst: (s: Pick<BuilderSlot, 'exerciseId'>) => boolean;
}

/** (Ben, 24 Oct) A slot the fit keeps for its group's main sub-role, in the group's sub-role order. */
export interface SubRoleGuard {
  group: BuilderGroupName;
  role: string;
  slotKey: string;
}

/**
 * The slots that cover each main sub-role of the day's main group (`BUILDER_SUB_ROLES` with `main`: on a Back day a
 * vertical pull, then a row), one per sub-role: a compound of it first when the sub-role asks for one, else the
 * earliest. A sub-role already covered by the main lift or by a slot Ben edited (neither is ever cut) needs no guard;
 * a group with no sub-roles defined has none.
 */
export function subRoleGuards(w: BuilderWorkout, info: BuilderInfoLookup, mainGroup: BuilderGroupName | null): SubRoleGuard[] {
  if (mainGroup === null) return [];
  const slots = allSlots(w);
  const out: SubRoleGuard[] = [];
  for (const r of BUILDER_SUB_ROLES[mainGroup] ?? []) {
    if (!r.main) continue;
    const of = slots.filter((s) => {
      const i = info(s.exerciseId);
      return i !== null && i.group === mainGroup && subRoleOf(i) === r.role;
    });
    if (of.length === 0 || of.some((s) => s.main || s.touched === true)) continue;
    const pick = (r.compound ? of.find((s) => info(s.exerciseId)?.role === 'compound') : undefined) ?? of[0];
    if (pick !== undefined) out.push({ group: mainGroup, role: r.role, slotKey: pick.key });
  }
  return out;
}

/** How the fit treats a guarded slot: `full` keeps every working set, `kept` keeps it at 2 or more. */
type GuardMode = 'full' | 'kept';

/**
 * Step (4) with sub-role coverage (Ben, 24 Oct), in order, the first that fits: the guarded exercises whole (others are
 * cut); then kept with fewer sets (their sets go before anything else's); then without the later sub-roles, one at a
 * time (the row before the vertical pull); then no guard at all (the plain least-lost fit, or the shortest).
 */
function guardedFit(w: BuilderWorkout, ctx: BuilderContext, limitS: number, weigh: FitWeigh, mainGroup: BuilderGroupName | null): ReturnType<typeof leastLostFit> {
  const guards = subRoleGuards(w, ctx.info, mainGroup);
  const levels: Map<string, GuardMode>[] = [];
  if (guards.length > 0) {
    levels.push(new Map(guards.map((g) => [g.slotKey, 'full'])));
    for (let n = guards.length; n >= 1; n -= 1) levels.push(new Map(guards.slice(0, n).map((g) => [g.slotKey, 'kept'])));
  }
  for (const guard of levels) {
    const r = leastLostFit(w, ctx, limitS, weigh, guard);
    if (r.fits) return r;
  }
  return leastLostFit(w, ctx, limitS, weigh, new Map());
}

/** One way to keep a block: what it becomes (null: left out), its seconds with the changeover, the value and sets kept. */
interface BlockChoice {
  block: BuilderBlock | null;
  secs: number;
  value: number;
  /** The value of the guarded slots' sets kept (sub-role coverage): weighed before anything else. */
  guard: number;
  /** (Rule F) The value kept of the slots not cut first: weighed after `guard`, before `value`. */
  held: number;
  sets: number;
  /** Per cuttable slot in the block, its working sets kept (0: left out). */
  counts: number[];
}

interface FitState {
  /** The guarded slots' value kept (`BlockChoice.guard`). */
  guard: number;
  /** (Rule F) The value kept of the slots not cut first (`BlockChoice.held`). */
  held: number;
  value: number;
  sets: number;
  /** Each block's choice (an index into its choices, more kept first). */
  picks: number[];
}

/**
 * `a` keeps more: more of the guarded slots' value (sub-role coverage), then more of the value of what isn't cut first
 * (rule F: the arm isolations on a day whose main group isn't Arms), then more training value, then more sets, then
 * (`secs`, for whole fits) more of the time used, then more of the earlier exercises (picks compared in order).
 */
function keepsMore(a: FitState, b: FitState, secs?: { a: number; b: number }): boolean {
  if (Math.abs(a.guard - b.guard) > 1e-9) return a.guard > b.guard;
  if (Math.abs(a.held - b.held) > 1e-9) return a.held > b.held;
  if (Math.abs(a.value - b.value) > 1e-9) return a.value > b.value;
  if (a.sets !== b.sets) return a.sets > b.sets;
  if (secs !== undefined && secs.a !== secs.b) return secs.a > secs.b;
  for (let i = 0; i < a.picks.length; i += 1) {
    const x = a.picks[i] ?? 0;
    const y = b.picks[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Every way to keep one block: each cuttable slot (not the main lift, not one Ben edited) at 2..n working sets or left
 * out (a slot with fewer than 2 keeps its own or goes); a pair left with one member is that one alone (`removeSlot`).
 * More kept first, so a lower index keeps more of the earlier slot.
 */
function blockChoices(b: BuilderBlock, w: BuilderWorkout, ctx: BuilderContext, weigh: FitWeigh, guard: ReadonlyMap<string, GuardMode>, mayLeaveOut: boolean): BlockChoice[] {
  const { valueOf, cutFirst } = weigh;
  const per = b.slots.map((s) => {
    if (s.main || s.touched === true) return null;
    const n = workingCount(s);
    const mode = guard.get(s.key);
    // A guarded slot (sub-role coverage) is never left out: whole (`full`) or at 2+ sets (`kept`).
    if (mode === 'full') return [n];
    const keep: number[] = [];
    for (let k = n; k >= Math.min(n, FIT_RULES.minAccessorySets); k -= 1) keep.push(k);
    // Step 3 leaves nothing out, except what rule F cuts first (an arm isolation goes before another's set).
    return mode === 'kept' || (!mayLeaveOut && !cutFirst(s)) ? keep : [...keep, 0];
  });
  const out: BlockChoice[] = [];
  const walk = (i: number, counts: number[]): void => {
    if (i === b.slots.length) {
      const slots: BuilderSlot[] = [];
      let value = 0;
      let guarded = 0;
      let held = 0;
      let sets = 0;
      let c = 0;
      const kept: number[] = [];
      for (const [j, s] of b.slots.entries()) {
        const options = per[j];
        if (options === null || options === undefined) {
          slots.push(s);
          continue;
        }
        const k = counts[c] ?? 0;
        c += 1;
        kept.push(k);
        value += k * valueOf(s);
        if (guard.has(s.key)) guarded += k * valueOf(s);
        if (!cutFirst(s)) held += k * valueOf(s);
        sets += k;
        if (k > 0) slots.push(k === workingCount(s) ? s : setWorkingCount(s, k));
      }
      const block = slots.length === 0 ? null : slots.length === 1 && b.slots.length > 1 ? { slots, auto: false } : { ...b, slots };
      out.push({ block, secs: block === null ? 0 : blockSeconds(block, w, ctx) + BUILDER_TIME.betweenS, value, guard: guarded, held, sets, counts: kept });
      return;
    }
    const options = per[i];
    if (options === null || options === undefined) {
      walk(i + 1, counts);
      return;
    }
    for (const k of options) walk(i + 1, [...counts, k]);
  };
  walk(0, []);
  return out;
}

/**
 * Steps (3) and (4) (`mayLeaveOut` false: step 3, sets only), the least training lost (Ben's "the cheapest cut", D9; fit-to-time 23 Oct "the least training lost, not
 * one step at a time", SP2): of every way to keep each cuttable accessory at 2+ sets or leave it out, the one that fits
 * and keeps the most training value (`FIT_SET_VALUE`); ties: more sets kept, then more of the time used, then the
 * earlier exercises kept. Exact, by block (an estimate is a sum over blocks, `estimateBuilderSeconds`), so nothing it
 * left out or cut could come back and still fit. Nothing fits: the shortest it can be (status over). The main lift and
 * Ben's edited slots are never cut; at least one exercise stays.
 */
function leastLostFit(w: BuilderWorkout, ctx: BuilderContext, limitS: number, weigh: FitWeigh, guard: ReadonlyMap<string, GuardMode>, mayLeaveOut = true): { workout: BuilderWorkout; steps: BuilderFitStep[]; fits: boolean } {
  const choices = w.blocks.map((b) => blockChoices(b, w, ctx, weigh, guard, mayLeaveOut));
  // The blocks' seconds (with a changeover each) against the limit: setup is once, and the first block has no changeover.
  const room = limitS - BUILDER_TIME.setupS + BUILDER_TIME.betweenS;
  const minAfter: number[] = new Array<number>(choices.length + 1).fill(0);
  for (let i = choices.length - 1; i >= 0; i -= 1) minAfter[i] = (minAfter[i + 1] ?? 0) + Math.min(...(choices[i] ?? []).map((c) => c.secs));
  // By total seconds, the state that keeps most. States that can't fit any more are dropped as they arise.
  let states = new Map<number, FitState>([[0, { guard: 0, held: 0, value: 0, sets: 0, picks: [] }]]);
  for (const [i, opts] of choices.entries()) {
    const next = new Map<number, FitState>();
    for (const [secs, st] of states) {
      for (const [k, c] of opts.entries()) {
        const total = secs + c.secs;
        if (total + (minAfter[i + 1] ?? 0) > room) continue;
        const cand: FitState = { guard: st.guard + c.guard, held: st.held + c.held, value: st.value + c.value, sets: st.sets + c.sets, picks: [...st.picks, k] };
        const cur = next.get(total);
        if (cur === undefined || keepsMore(cand, cur)) next.set(total, cand);
      }
    }
    states = next;
  }
  let best: { secs: number; st: FitState } | null = null;
  for (const [secs, st] of states) {
    // Total 0: nothing kept (at least one exercise stays).
    if (secs <= 0) continue;
    if (best === null || keepsMore(st, best.st, { a: secs, b: best.secs })) best = { secs, st };
  }
  const fits = best !== null;
  const picks = best?.st.picks ?? shortestPicks(choices);
  const blocks: BuilderBlock[] = [];
  const steps: BuilderFitStep[] = [];
  for (const [i, b] of w.blocks.entries()) {
    const c = choices[i]?.[picks[i] ?? 0];
    if (c === undefined) continue;
    if (c.block !== null) blocks.push(c.block);
    let at = 0;
    for (const s of b.slots) {
      if (s.main || s.touched === true) continue;
      const k = c.counts[at] ?? 0;
      at += 1;
      const n = workingCount(s);
      if (k === 0) steps.push({ kind: 'drop', slotKey: s.key, exerciseId: s.exerciseId });
      else if (k < n) steps.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from: n, to: k });
    }
  }
  return { workout: { ...w, blocks }, steps, fits };
}

/** Nothing fits: each block at its shortest (ties: more kept), keeping at least one exercise. */
function shortestPicks(choices: readonly (readonly BlockChoice[])[]): number[] {
  const shortest = (opts: readonly BlockChoice[], nonEmpty: boolean): number => {
    let at = -1;
    for (const [k, c] of opts.entries()) {
      if (nonEmpty && c.block === null) continue;
      const was = opts[at];
      if (was === undefined || c.secs < was.secs || (c.secs === was.secs && c.value > was.value + 1e-9)) at = k;
    }
    return at;
  };
  const picks = choices.map((opts) => Math.max(0, shortest(opts, false)));
  if (picks.some((k, i) => choices[i]?.[k]?.block != null)) return picks;
  // Everything could go: the one block whose shortest kept form is shortest stays.
  let keep = -1;
  let keepAt = -1;
  for (const [i, opts] of choices.entries()) {
    const k = shortest(opts, true);
    const c = opts[k];
    const was = choices[keep]?.[keepAt];
    if (c !== undefined && (was === undefined || c.secs < was.secs)) {
      keep = i;
      keepAt = k;
    }
  }
  return keep < 0 ? picks : picks.map((k, i) => (i === keep ? keepAt : k));
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

  // A second arm exercise: Arms with exactly one exercise gets another, from the other arm part first (D5: the
  // pushdown gets a curl, as when Biceps and Triceps were groups of their own).
  const arms = allSlots(w).filter((s) => groupOf(s) === 'Arms');
  const armPart = arms.length === 1 && arms[0] !== undefined ? infoOrDefault(ctx.info, arms[0].exerciseId).part : null;
  // (Ben, 23 Oct) Nothing that near-duplicates an exercise in the workout (or a second traps isolation).
  const clashes = (id: string) => autoPickClash(id, allSlots(w).map((s) => s.exerciseId), ctx.info) !== null;
  const armIds = (opts.addCandidates?.arm ?? []).filter((id) => !inWorkout(id) && !clashes(id) && infoOrDefault(ctx.info, id).group === 'Arms');
  const armPick = [...armIds.filter((id) => infoOrDefault(ctx.info, id).part !== armPart), ...armIds.filter((id) => infoOrDefault(ctx.info, id).part === armPart)];
  for (const id of armPick) {
    if (armPart === null || count() >= FIT_RULES.maxExercises) break;
    const next = insertAfterGroup(w, makeSlot(id, { main: false }, ctx), ['Arms'], ctx, opts.supersets);
    if (fits(next.w)) {
      w = next.w;
      steps.push({ kind: 'add', slotKey: next.key, exerciseId: id, why: 'arm' });
    }
    break;
  }
  // Then one more accessory for the day's main group.
  const mg = opts.mainGroup;
  if (mg !== null && count() < FIT_RULES.maxExercises) {
    const id = (opts.addCandidates?.mainGroup ?? []).find((x) => !inWorkout(x) && !clashes(x) && ctx.info(x)?.group === mg);
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
  const isAbs = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId).group === 'Core';
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
    if (opts.supersets && partner === null && arm !== undefined && infoOrDefault(ctx.info, arm.exerciseId).group === 'Arms') {
      const id = opts.armCandidates.find((c) => !present.has(c) && autoPickClash(c, present, ctx.info) === null && infoOrDefault(ctx.info, c).group === 'Arms' && canAutoPair(arm, { exerciseId: c, main: false }, ctx.info));
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
