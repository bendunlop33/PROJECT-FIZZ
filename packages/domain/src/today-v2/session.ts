import { adviseBuilder, type BuilderAdvice } from '../builder/advise';
import { infoOrDefault, pairSlots, slotsOf, splitInvalidAutoPairs } from '../builder/arrange';
import { buildFromSetup, type AccessoryStyle, type BuilderPool, type GroupCount } from '../builder/build';
import { estimateBuilderMinutes } from '../builder/estimate';
import { absOff, clampMinutes, fitToMinutes, type BuilderFitResult, type BuilderFitStep } from '../builder/fit';
import { mixItUpShortlist, mixItUpTarget } from '../builder/mix';
import { workingCount } from '../builder/set-rows';
import { makeSlot } from '../builder/slot';
import { type BuilderBlock, type BuilderContext, type BuilderGroupName, type BuilderSlot, type BuilderWorkout, type RestKind } from '../builder/types';
import { landCarryOver, type CarryItem } from '../builder/carry';
import { withCoachSetCounts } from '../builder/carried';
import { withDeloadSets } from '../builder/deload';
import { settleWarmups } from '../builder/warmups';

/**
 * Today (v2), workout-builder-v3 §2.0 and its 20 Oct additions: today's
 * session drafted from the chosen plan day (or an Other session) and the
 * five controls, with the Wave 1 builder rules. Pure; the app service
 * injects the exercises, pools, loads and history facts.
 *
 * The plan day's TEMPLATE decides which exercises (they lead every pool, in
 * template order), its length, and whether abs are in by default; the
 * controls decide how many and how long:
 *   1. Main lift: one chip per main-lift template.
 *   2. Accessories: Focused (2 × 3 sets) / Varied (3 × 2 sets, different
 *      angles) for the main group (`ACCESSORY_STYLES`).
 *   3. Time: ± 5 min (15–180). Shorter trims (rests, effort, sets, drops,
 *      never the main lift); longer or freed time fills (a second arm
 *      exercise, a main-group accessory, then sets). The plan's own spare
 *      minutes stay a buffer.
 *   4. Abs: the plan's by default; off removes them and splits their pair
 *      (with Supersets on, the arm exercise gets an arm partner).
 *   5. Supersets on/off.
 * `↻ Mix it up` (today only) swaps one accessory for a shortlist pick.
 */

/** One main-lift template of a plan day (or an Other session's main-lift option). */
export interface TodayTemplate {
  /** The plan-day template (a routine); null for an Other session. */
  routineId: string | null;
  version: number | null;
  /** The chip: `Bench`. */
  label: string;
  mainLiftExerciseId: string | null;
  /** The template's exercises in order: they lead every pool. */
  exerciseIds: readonly string[];
  /** The plan's length for this day. */
  minutes: number;
  /** The template has an ab exercise. */
  absPlan: boolean;
  /** The template pairs exercises (Supersets' default). */
  supersetsPlan: boolean;
  /** The day's mix: the template's groups (main group first), or the Other session's preset. */
  groups: readonly GroupCount[];
  /**
   * (Ben, 27 Oct: "If I add superset it doesn't then change the plan") A plan day's exercises as stored, in order: its
   * set counts and superset pairs. At the plan's own controls Today drafts exactly these (`assembleTodayDraft`), so a
   * superset, order or set count in the plan day reaches Today, Your workout and the workout. Absent: an Other session
   * (drafted from `groups`).
   */
  slots?: readonly TodayTemplateSlot[];
}

/** One stored exercise of a plan day (`TodayTemplate.slots`). */
export interface TodayTemplateSlot {
  exerciseId: string;
  /** Working sets as stored (1–10). */
  workingSets: number;
  /** Its superset letter in the plan day; null: on its own. */
  group: string | null;
  /**
   * (Ben, 27 Oct) The plan day's stored reps for its straight working sets (`8–10`), drafted as stored; absent: the
   * builder's (a timed exercise, or a main lift with a top set, whose top / back-off shape the builder plans).
   */
  reps?: { min: number; max: number };
  /** (Ben, 27 Oct) The plan day's stored rests per kind (seconds), drafted as the slot's `planRestS`. */
  restS?: Partial<Record<RestKind, number>>;
}

export interface TodayDay {
  /** `plan:<planId>:<dayIndex>` or `other:<id>`. */
  key: string;
  kind: 'plan' | 'split' | 'other';
  /** `Chest`. */
  name: string;
  planId: string | null;
  dayIndex: number | null;
  /** The split day (variation key) or the Other session's ID (`full_body`, `upper`, `push`). */
  splitDayId: string;
  templates: readonly TodayTemplate[];
}

export interface TodayControls {
  mainLiftExerciseId: string | null;
  accessories: AccessoryStyle;
  minutes: number;
  /** null: the plan's. */
  abs: boolean | null;
  supersets: boolean;
  /** 0: as drafted; k ≥ 1: the k-th pick of the shortlist (cycles). */
  mix: number;
}

export const TODAY_TIME = { stepMin: 5, minMinutes: 15, maxMinutes: 180 } as const;

/** Facts `↻ Mix it up` reads (Your data and the gym, injected). */
export interface TodayMixFacts {
  /** Candidates of a group (Ben's list, then the catalogue). */
  candidates: (group: BuilderGroupName) => readonly string[];
  recentCountOnDay: ReadonlyMap<string, number>;
  lastTwoOnDay: ReadonlySet<string>;
  lastDoneMs: ReadonlyMap<string, number>;
  availableHere: (exerciseId: string) => boolean;
  painFlagged: (exerciseId: string) => boolean;
}

export interface TodayAssembleInput {
  day: TodayDay;
  controls: TodayControls;
  ctx: BuilderContext;
  /** Per group, best first: the template's, then Ben's history, then the catalogue (here, not pain-flagged). */
  pool: BuilderPool;
  mix: TodayMixFacts;
  /**
   * (§2.0.2 Mix it up rule 3) The coach's order of the shortlist (its pick first, `mixPick`); used only when it
   * is exactly code's shortlist, else code's order (least recently done first) stands.
   */
  mixOrder?: readonly string[];
  /**
   * (Ben, 23 Oct; fit-to-time SP3) Sets Ben carried over to this day from a workout Time cut (`pendingCarryOvers`):
   * added after this day's own fit, so they aren't cut again.
   */
  carry?: readonly CarryItem[];
  /**
   * (Ben, 27 Oct) The Accessories style the plan day opens with (Today's default for Ben's goal). A template with stored
   * `slots` is drafted as stored while Accessories is this one; another style rebuilds its accessories by group.
   * Absent: any style drafts the stored slots.
   */
  planAccessories?: AccessoryStyle;
  /** (Ben, 27 Oct) An exercise Today can put in the workout here (known, at this gym, not pain-flagged); absent: all. */
  usable?: (exerciseId: string) => boolean;
}

export interface TodayMix {
  slotKey: string;
  fromExerciseId: string;
  toExerciseId: string;
  /** `Another (k/n)`. */
  k: number;
  n: number;
}

export interface TodayDraft {
  template: TodayTemplate;
  workout: BuilderWorkout;
  /**
   * The same draft before Time's fit (review todaylean B2): what Your workout's Time brings back, so a card Today
   * fitted is committed with its fit record (`timeFit.base`), never as if the fit were the plan.
   */
  unfitted: BuilderWorkout;
  fit: BuilderFitResult;
  /** `about N min`. */
  minutes: number;
  exerciseCount: number;
  absOn: boolean;
  /** The time the plan's own draft leaves spare (kept, not filled). */
  planBufferMin: number;
  /** The swap shown, or null. */
  mix: TodayMix | null;
  /** How many fresh options there are for `↻ Mix it up` (0: the row is hidden). */
  mixOptions: number;
  /** Code's shortlist for `↻ Mix it up` (least recently done first) and the accessory it swaps out: the coach picks from it. */
  mixShortlist: string[];
  mixFromExerciseId: string | null;
  advice: BuilderAdvice[];
  mainGroup: BuilderGroupName | null;
  /** (Ben, 23 Oct) The carried-over sets that landed on this draft (`carry`); empty: none. */
  carried: CarryItem[];
}

/** The template for the main lift chosen (the first when it isn't one of the day's). */
export function templateFor(day: TodayDay, mainLiftExerciseId: string | null): TodayTemplate | null {
  return day.templates.find((t) => t.mainLiftExerciseId === mainLiftExerciseId) ?? day.templates[0] ?? null;
}

/**
 * The controls a day opens with: its template's main lift (the last-used
 * one is passed in), accessories from the goal (Strength → Focused,
 * Muscle/Both → Varied; none set: Focused), the plan's length, abs and
 * supersets as the plan has them.
 */
export function defaultTodayControls(day: TodayDay, opts: { mainLiftExerciseId?: string | null; goal?: 'strength' | 'muscle' | 'both' | null } = {}): TodayControls {
  const t = templateFor(day, opts.mainLiftExerciseId ?? day.templates[0]?.mainLiftExerciseId ?? null);
  return {
    mainLiftExerciseId: t?.mainLiftExerciseId ?? null,
    accessories: opts.goal === 'muscle' || opts.goal === 'both' ? 'varied' : 'focused',
    minutes: clampMinutes(t?.minutes ?? 60),
    abs: null,
    supersets: t?.supersetsPlan ?? true,
    mix: 0,
  };
}

/** `Time −/+`: 5-minute steps within 15–180. */
export function stepTodayMinutes(minutes: number, delta: -1 | 1): number {
  return Math.max(TODAY_TIME.minMinutes, Math.min(TODAY_TIME.maxMinutes, Math.round(minutes / TODAY_TIME.stepMin) * TODAY_TIME.stepMin + delta * TODAY_TIME.stepMin));
}

/** Abs on/off as Ben left it: `null` again when it matches the plan (so `plan: on/off` hides). */
export function toggleTodayAbs(controls: TodayControls, template: Pick<TodayTemplate, 'absPlan'>): TodayControls {
  const on = !(controls.abs ?? template.absPlan);
  return { ...controls, abs: on === template.absPlan ? null : on };
}

/** Changing the main lift, accessories or day resets Mix it up (today only). */
export function withTodayControl<K extends keyof TodayControls>(controls: TodayControls, key: K, value: TodayControls[K]): TodayControls {
  const resetsMix = key === 'mainLiftExerciseId' || key === 'accessories';
  return { ...controls, [key]: value, ...(resetsMix ? { mix: 0 } : {}) };
}

const slotCount = (w: BuilderWorkout): number => w.blocks.reduce((n, b) => n + b.slots.length, 0);

interface Built {
  workout: BuilderWorkout;
  mix: TodayMix | null;
  mixOptions: number;
  /** Code's shortlist and the accessory it replaces (for the coach's pick); empty / null when none. */
  mixShortlist: string[];
  mixFromExerciseId: string | null;
}

/** The groups to build: the template's, with Abs in when it is on (and kept for `absOff` when the plan has them). */
function groupsFor(t: TodayTemplate, absOn: boolean): GroupCount[] {
  const groups = t.groups.filter((g) => g.group !== 'Core' || absOn || t.absPlan).map((g) => ({ ...g }));
  if (absOn && !groups.some((g) => g.group === 'Core')) groups.push({ group: 'Core', count: 1 });
  return groups;
}

/** Arm exercises to add, best first: an arm part the workout doesn't have yet first (D5: Arms = biceps + triceps). */
function armCandidates(w: BuilderWorkout, pool: BuilderPool, ctx: BuilderContext): string[] {
  const have = new Set(w.blocks.flatMap((b) => b.slots.map((s) => infoOrDefault(ctx.info, s.exerciseId)).filter((i) => i.group === 'Arms').map((i) => i.part)));
  const ids = pool('Arms');
  return [...ids.filter((id) => !have.has(infoOrDefault(ctx.info, id).part)), ...ids.filter((id) => have.has(infoOrDefault(ctx.info, id).part))];
}

/**
 * (Ben, 27 Oct) The plan day as stored: its exercises in order, each with its stored working sets, and its superset
 * pairs (Supersets off splits them; on, for a day with none, pairs as the builder does). An exercise Today can't use
 * here (another gym's, or pain-flagged) gives way to its group's next pick in the same place and pair, else leaves; the
 * main lift stays (a pain-flagged one is held, as the group draft holds it). Null: no stored slots.
 */
export function storedTemplateWorkout(t: TodayTemplate, c: Pick<TodayControls, 'supersets'>, input: Pick<TodayAssembleInput, 'ctx' | 'pool' | 'usable'>): BuilderWorkout | null {
  const stored = t.slots;
  if (stored === undefined || stored.length === 0) return null;
  const { ctx, pool } = input;
  const usable = input.usable ?? (() => true);
  const taken = new Set(stored.map((x) => x.exerciseId));
  const placed: { slot: BuilderSlot; group: string | null }[] = [];
  for (const x of stored) {
    const main = t.mainLiftExerciseId !== null && x.exerciseId === t.mainLiftExerciseId;
    let id: string | null = x.exerciseId;
    if (!main && (ctx.info(x.exerciseId) === null || !usable(x.exerciseId))) {
      const g = ctx.info(x.exerciseId)?.group ?? null;
      id = g === null ? null : (pool(g).find((y) => !taken.has(y) && usable(y)) ?? null);
      if (id !== null) taken.add(id);
    }
    if (id === null || ctx.info(id) === null || placed.some((p) => p.slot.exerciseId === id)) continue;
    // (Ben, 27 Oct) The stored reps and rests come with the exercise as stored (not a substitute picked here).
    const same = id === x.exerciseId;
    const made = makeSlot(id, { main, workingSets: Math.max(1, Math.min(10, Math.round(x.workingSets))), ...(same && x.reps !== undefined ? { repRange: x.reps } : {}) }, ctx);
    placed.push({ slot: same && x.restS !== undefined && Object.keys(x.restS).length > 0 ? { ...made, planRestS: { ...x.restS } } : made, group: x.group });
  }
  if (placed.length === 0) return null;
  // The main lift leads (it names the day); the rest keep their stored order.
  const mainAt = placed.findIndex((p) => p.slot.main);
  if (mainAt > 0) placed.unshift(...placed.splice(mainAt, 1));
  let blocks: BuilderBlock[] = [];
  for (const p of placed) {
    const last = blocks[blocks.length - 1];
    const lastGroup = last === undefined ? null : (placed.find((q) => q.slot === last.slots[0])?.group ?? null);
    if (c.supersets && p.group !== null && last !== undefined && lastGroup === p.group && !p.slot.main && !last.slots.some((s) => s.main)) last.slots.push(p.slot);
    else blocks.push({ slots: [p.slot], auto: false });
  }
  blocks = blocks.map((b) => ({ ...b, slots: [...b.slots] }));
  if (c.supersets && !t.supersetsPlan) blocks = pairSlots(blocks, ctx.info);
  return settleWarmups({ blocks, restLevel: 'normal' }, ctx);
}

/** (Ben, 27 Oct) Another Accessories style keeps the plan day's main lift as stored (only the accessories change). */
function withStoredMainSets(w: BuilderWorkout, t: TodayTemplate, ctx: BuilderContext): BuilderWorkout {
  const n = t.slots?.find((x) => x.exerciseId === t.mainLiftExerciseId)?.workingSets;
  if (n === undefined) return w;
  const differs = (s: BuilderSlot): boolean => s.main && s.exerciseId === t.mainLiftExerciseId && workingCount(s) !== n;
  if (!w.blocks.some((b) => b.slots.some(differs))) return w;
  const blocks = w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (differs(s) ? { ...makeSlot(s.exerciseId, { main: true, workingSets: n }, ctx), key: s.key } : s)) }));
  return settleWarmups({ ...w, blocks }, ctx);
}

/** Build (untrimmed), abs off, then the mix swap. */
function build(input: TodayAssembleInput, t: TodayTemplate, c: TodayControls, absOn: boolean): Built {
  const { ctx, pool } = input;
  const groups = groupsFor(t, absOn);
  // (Ben, 27 Oct) A plan day with stored exercises is drafted as stored at the plan's Accessories; another style rebuilds.
  const asStored = input.planAccessories === undefined || c.accessories === input.planAccessories ? storedTemplateWorkout(t, c, input) : null;
  let workout0 = asStored ?? withStoredMainSets(buildFromSetup({ minutes: c.minutes, mainLiftExerciseId: t.mainLiftExerciseId, supersets: c.supersets, groups, accessories: c.accessories }, pool, ctx, { trim: false }).workout, t, ctx);
  // Abs on for a stored day without them: the group's first pick, on its own at the end.
  if (asStored !== null && absOn && !slotsOf(workout0.blocks).some((s) => infoOrDefault(ctx.info, s.exerciseId).group === 'Core')) {
    const id = pool('Core').find((x) => !slotsOf(workout0.blocks).some((s) => s.exerciseId === x));
    if (id !== undefined) workout0 = settleWarmups({ ...workout0, blocks: [...workout0.blocks, { slots: [makeSlot(id, { main: false }, ctx)], auto: false }] }, ctx);
  }
  // (Ben, 23 Oct) The coach's set count for next time (a small change, or one Ben applied on the Summary), as Start plans it.
  let workout = withCoachSetCounts(workout0, ctx).workout;
  // (Ben, 23 Oct: plan length = block 1) The plan's deload week: a set fewer and RPE ≤ 7 (loads are lighter already).
  workout = withDeloadSets(workout, ctx).workout;
  if (!absOn && groups.some((g) => g.group === 'Core')) workout = absOff(workout, ctx, { supersets: c.supersets, armCandidates: armCandidates(workout, pool, ctx) }).workout;
  return applyMix(workout, input, c);
}

function applyMix(workout: BuilderWorkout, input: TodayAssembleInput, c: TodayControls): Built {
  const { ctx, mix } = input;
  const target = mixItUpTarget({ workout, info: ctx.info, recentCountOnDay: mix.recentCountOnDay, varied: c.accessories === 'varied' });
  if (target === null) return { workout, mix: null, mixOptions: 0, mixShortlist: [], mixFromExerciseId: null };
  const group = infoOrDefault(ctx.info, target.exerciseId).group;
  const inWorkout = new Set(workout.blocks.flatMap((b) => b.slots.map((s) => s.exerciseId)));
  const shortlist = mixItUpShortlist({
    target,
    candidates: mix.candidates(group),
    info: ctx.info,
    availableHere: mix.availableHere,
    painFlagged: mix.painFlagged,
    lastTwoOnDay: mix.lastTwoOnDay,
    inWorkout,
    lastDoneMs: mix.lastDoneMs,
  });
  const facts = { mixShortlist: shortlist, mixFromExerciseId: target.exerciseId };
  if (c.mix <= 0 || shortlist.length === 0) return { workout, mix: null, mixOptions: shortlist.length, ...facts };
  const o = input.mixOrder;
  const order = o !== undefined && o.length === shortlist.length && shortlist.every((id) => o.includes(id)) ? o : shortlist;
  const k = ((Math.round(c.mix) - 1) % order.length) + 1;
  const pick = order[k - 1];
  if (pick === undefined) return { workout, mix: null, mixOptions: shortlist.length, ...facts };
  const slot = makeSlot(pick, { main: false, workingSets: workingCount(target) }, ctx);
  // The pick takes the target's place; a builder pair it can't join (a heavy lift, a shared muscle) splits.
  const blocks = splitInvalidAutoPairs(
    workout.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === target.key ? slot : s)) })),
    ctx.info,
  );
  return { workout: { ...workout, blocks }, mix: { slotKey: slot.key, fromExerciseId: target.exerciseId, toExerciseId: pick, k, n: shortlist.length }, mixOptions: shortlist.length, ...facts };
}

/**
 * (Ben, 23 Oct, D1; review batch23 B1, B3) What Keep for next time needs from Today's card: each exercise the plan day
 * has is marked as the template's (`origin`), so a swap Ben makes on Your workout reads as a swap of it; and the
 * working sets Today's Time took from a slot (`todayCut`), so a set Ben adds back isn't a new set count for the plan.
 * Sets Time added (a longer day) aren't a cut. Nothing else changes.
 */
export function withTemplateMarks(w: BuilderWorkout, templateExerciseIds: readonly string[], steps: readonly BuilderFitStep[]): BuilderWorkout {
  const planned = new Set(templateExerciseIds);
  const first = new Map<string, number>();
  for (const st of steps) if (st.kind === 'sets' && !first.has(st.slotKey)) first.set(st.slotKey, st.from);
  const mark = (s: BuilderSlot): BuilderSlot => {
    const out: BuilderSlot = { ...s };
    if (out.origin === undefined && planned.has(s.exerciseId)) out.origin = s.exerciseId;
    const was = first.get(s.key);
    const cut = was === undefined ? 0 : was - workingCount(s);
    // A deload week's set already off this slot (`withDeloadSets`) stays counted as today's.
    if (cut > 0) out.todayCut = (s.todayCut ?? 0) + cut;
    return out;
  };
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map(mark) })) };
}

/**
 * `assembleTodayDraft`: the card's workout for a day and its controls. The
 * plan's own draft (its abs, its supersets, its length, no mix) is estimated
 * first: its spare minutes are the buffer the fill keeps.
 */
export function assembleTodayDraft(input: TodayAssembleInput): TodayDraft | null {
  const t = templateFor(input.day, input.controls.mainLiftExerciseId);
  if (t === null) return null;
  const c: TodayControls = { ...input.controls, minutes: clampMinutes(input.controls.minutes) };
  const absOn = c.abs ?? t.absPlan;
  const mainInfo = t.mainLiftExerciseId === null ? null : input.ctx.info(t.mainLiftExerciseId);
  const mainGroup = mainInfo?.group ?? t.groups[0]?.group ?? null;

  const planBuilt = build(input, t, { ...c, minutes: clampMinutes(t.minutes), abs: null, supersets: t.supersetsPlan, mix: 0 }, t.absPlan);
  const planBufferMin = Math.max(0, clampMinutes(t.minutes) - estimateBuilderMinutes(planBuilt.workout, input.ctx));

  const built = build(input, t, c, absOn);
  const fit = fitToMinutes(built.workout, input.ctx, {
    minutes: c.minutes,
    mainGroup,
    grow: true,
    supersets: c.supersets,
    planBufferMin,
    settle: (x) => settleWarmups(x, input.ctx),
    // The accessory Mix it up swapped out stays out for today (the fill never brings it back).
    addCandidates: {
      arm: armCandidates(built.workout, input.pool, input.ctx).filter((id) => id !== built.mix?.fromExerciseId),
      mainGroup: mainGroup === null ? [] : input.pool(mainGroup).filter((id) => id !== built.mix?.fromExerciseId),
    },
  });
  const marked = withTemplateMarks(fit.workout, t.exerciseIds, fit.steps);
  // (Ben, 23 Oct) Sets carried over to this day land after its own fit (never cut again), and on the draft before it.
  const carry = input.carry ?? [];
  const landed = carry.length === 0 ? { workout: marked, changed: [] } : landCarryOver(marked, carry, input.ctx);
  // (WU1–WU12) Warm-ups planned by the shared planner for each exercise's place in today's workout.
  const workout = settleWarmups(landed.workout, input.ctx);
  const unfitted = withTemplateMarks(carry.length === 0 ? built.workout : landCarryOver(built.workout, carry, input.ctx).workout, t.exerciseIds, []);
  const minutes = landed.changed.length === 0 && workout === landed.workout ? fit.minutes : estimateBuilderMinutes(workout, input.ctx);
  return {
    template: t,
    workout,
    unfitted,
    fit: { ...fit, workout, minutes },
    minutes,
    exerciseCount: slotCount(workout),
    absOn,
    planBufferMin,
    mix: built.mix !== null && workout.blocks.some((b) => b.slots.some((s) => s.key === built.mix?.slotKey)) ? built.mix : null,
    mixOptions: built.mixOptions,
    mixShortlist: built.mixShortlist,
    mixFromExerciseId: built.mixFromExerciseId,
    advice: adviseBuilder(workout.blocks, input.ctx.info),
    mainGroup,
    carried: landed.changed.length === 0 ? [] : [...carry],
  };
}
