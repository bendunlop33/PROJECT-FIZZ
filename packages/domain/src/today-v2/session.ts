import { adviseBuilder, type BuilderAdvice } from '../builder/advise';
import { infoOrDefault } from '../builder/arrange';
import { buildFromSetup, type AccessoryStyle, type BuilderPool, type GroupCount } from '../builder/build';
import { estimateBuilderMinutes } from '../builder/estimate';
import { absOff, clampMinutes, fitToMinutes, type BuilderFitResult } from '../builder/fit';
import { mixItUpShortlist, mixItUpTarget } from '../builder/mix';
import { workingCount } from '../builder/set-rows';
import { makeSlot } from '../builder/slot';
import { ARM_GROUPS, type BuilderContext, type BuilderGroupName, type BuilderWorkout } from '../builder/types';

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
}

export interface TodayDay {
  /** `plan:<planId>:<dayIndex>` or `other:<id>`. */
  key: string;
  kind: 'plan' | 'other';
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
  advice: BuilderAdvice[];
  mainGroup: BuilderGroupName | null;
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
}

/** The groups to build: the template's, with Abs in when it is on (and kept for `absOff` when the plan has them). */
function groupsFor(t: TodayTemplate, absOn: boolean): GroupCount[] {
  const groups = t.groups.filter((g) => g.group !== 'Abs' || absOn || t.absPlan).map((g) => ({ ...g }));
  if (absOn && !groups.some((g) => g.group === 'Abs')) groups.push({ group: 'Abs', count: 1 });
  return groups;
}

/** Arm exercises to add, best first: the arm group with one exercise first. */
function armCandidates(w: BuilderWorkout, pool: BuilderPool, ctx: BuilderContext): string[] {
  const have = (g: BuilderGroupName) => w.blocks.reduce((n, b) => n + b.slots.filter((s) => infoOrDefault(ctx.info, s.exerciseId).group === g).length, 0);
  const order = [...ARM_GROUPS].sort((a, b) => Number(have(b) === 1) - Number(have(a) === 1));
  return [...new Set(order.flatMap((g) => pool(g)))];
}

/** Build (untrimmed), abs off, then the mix swap. */
function build(input: TodayAssembleInput, t: TodayTemplate, c: TodayControls, absOn: boolean): Built {
  const { ctx, pool } = input;
  const groups = groupsFor(t, absOn);
  const r = buildFromSetup({ minutes: c.minutes, mainLiftExerciseId: t.mainLiftExerciseId, supersets: c.supersets, groups, accessories: c.accessories }, pool, ctx, { trim: false });
  let workout = r.workout;
  if (!absOn && groups.some((g) => g.group === 'Abs')) workout = absOff(workout, ctx, { supersets: c.supersets, armCandidates: armCandidates(workout, pool, ctx) }).workout;
  return applyMix(workout, input, c);
}

function applyMix(workout: BuilderWorkout, input: TodayAssembleInput, c: TodayControls): Built {
  const { ctx, mix } = input;
  const target = mixItUpTarget({ workout, info: ctx.info, recentCountOnDay: mix.recentCountOnDay, varied: c.accessories === 'varied' });
  if (target === null) return { workout, mix: null, mixOptions: 0 };
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
  if (c.mix <= 0 || shortlist.length === 0) return { workout, mix: null, mixOptions: shortlist.length };
  const k = ((Math.round(c.mix) - 1) % shortlist.length) + 1;
  const pick = shortlist[k - 1];
  if (pick === undefined) return { workout, mix: null, mixOptions: shortlist.length };
  const slot = makeSlot(pick, { main: false, workingSets: workingCount(target) }, ctx);
  const blocks = workout.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === target.key ? slot : s)) }));
  return { workout: { ...workout, blocks }, mix: { slotKey: slot.key, fromExerciseId: target.exerciseId, toExerciseId: pick, k, n: shortlist.length }, mixOptions: shortlist.length };
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
    // The accessory Mix it up swapped out stays out for today (the fill never brings it back).
    addCandidates: {
      arm: armCandidates(built.workout, input.pool, input.ctx).filter((id) => id !== built.mix?.fromExerciseId),
      mainGroup: mainGroup === null ? [] : input.pool(mainGroup).filter((id) => id !== built.mix?.fromExerciseId),
    },
  });
  return {
    template: t,
    workout: fit.workout,
    fit,
    minutes: fit.minutes,
    exerciseCount: slotCount(fit.workout),
    absOn,
    planBufferMin,
    mix: built.mix !== null && fit.workout.blocks.some((b) => b.slots.some((s) => s.key === built.mix?.slotKey)) ? built.mix : null,
    mixOptions: built.mixOptions,
    advice: adviseBuilder(fit.workout.blocks, input.ctx.info),
    mainGroup,
  };
}
