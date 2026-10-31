import { BUILD_LIMITS, type BuilderSetup } from '@fizz/schemas';
import { slotsOf } from './arrange';
import { fromDraftPlan, toDraftPlan, type DraftCodecContext } from './codec';
import { estimateBuilderMinutes, estimateBuilderSeconds } from './estimate';
import { clampMinutes, FIT_RULES, fitToMinutes, type BuilderFitStep } from './fit';
import { workingCount } from './set-rows';
import { carriedSets, withCarriedBack, withoutCarried, type CarriedHold } from './carried';
import type { BuilderBlock, BuilderContext, BuilderGroupName, BuilderSlot, BuilderWorkout } from './types';

/**
 * Your workout's Time control (22 Oct, Ben: "add option to reduce time"; fit-to-time.md, 22 Oct revision). Pure.
 *
 * - The fit is Today's built-in one (`fitToMinutes`, shrink only; fit-to-time 22 Oct revision): shorter rests first,
 *   then, only with Supersets on, pairs; then the cheapest cut by training lost per minute (a set, never below 2, or
 *   a whole exercise), never the main lift. With Supersets off no superset is made (design review V14); no effort is
 *   pushed (kept sets keep their own RPE), and nothing is ever added or raised.
 * - It works on today's draft only and keeps the workout as it was before the first Time change (`base`): every
 *   step fits from that, so more time brings back what it cut, up to the original, never more. At or above the
 *   length it had then, the original is back as it was.
 * - Ben's edits after a fit stay: a slot he touched keeps his version (fit-to-time FT5), a slot he deleted stays
 *   deleted, his order and pairs stand; only what the fit cut comes back. A slot he touched after the fit cut its sets
 *   (an RPE, a rep) keeps his version at every shorter length, never longer than he left it (review R1); the sets the
 *   fit took from it are held and come back at the length before the first Time change, or with Undo, never past the
 *   original count (review: an edit doesn't lock in a cut).
 */

export interface BuilderTimeFit {
  /** The workout before the first Time change (with its rest level). */
  base: BuilderWorkout;
  /** Its length then: at or above it, the original is back. */
  fromMinutes: number;
  /** Slots the fit left out, in no particular order (they come back when the time allows). */
  dropped: readonly string[];
  /** Working sets the fit took from each slot it kept (slot key → sets); they come back even if Ben edits the slot later. */
  cut?: Readonly<Record<string, number>>;
  /** (22 Oct revision) Singles the fit paired (Supersets on), each pair's slot keys; they stand alone again when it's undone. */
  paired?: readonly (readonly string[])[];
  /**
   * (Review todaylean B3) Today's card filled above the plan's length: `base` is the plan day's draft before the fill,
   * `fromMinutes` the plan's length. `added`: exercises the fill added (they go at or below the plan's length, and
   * the Start prompt never sees them); `raised`: working sets it added to a plan slot; `filledTo`: the Time it filled to.
   */
  added?: readonly { slotKey: string; why: 'arm' | 'main_group' | 'arm_partner' }[];
  raised?: Readonly<Record<string, number>>;
  filledTo?: number;
}

/** A fill record (Today's Time above the plan's length), not a cut. */
export const isFillRecord = (fit: Pick<BuilderTimeFit, 'filledTo'> | null | undefined): boolean => fit?.filledTo !== undefined;

/** Working sets Ben's version of a slot keeps once the fill's `raised` sets go: only sets above the plan's count. */
function lessRaised(fit: Pick<BuilderTimeFit, 'raised'>, was: BuilderSlot, s: BuilderSlot): BuilderSlot {
  const raised = fit.raised?.[s.key] ?? 0;
  const now = workingCount(s);
  const plan = workingCount(was);
  if (raised <= 0 || now <= plan || was.exerciseId !== s.exerciseId) return s;
  let off = now - Math.max(plan, now - raised);
  const rows = [...s.rows];
  for (let i = rows.length - 1; i >= 0 && off > 0; i -= 1) {
    if (rows[i]?.type === 'warmup' || rows[i]?.type === 'drop') continue;
    rows.splice(i, 1);
    off -= 1;
  }
  return { ...s, rows };
}

/**
 * Working sets a touched slot gets back: the fit's cut, never past the original count (or Ben's own count, if he
 * added sets himself). Zero for an untouched slot (its rows come back whole) or another exercise.
 */
function setsBack(fit: Pick<BuilderTimeFit, 'cut'>, was: BuilderSlot, s: BuilderSlot): number {
  const cut = fit.cut?.[s.key] ?? 0;
  if (cut <= 0 || s.touched !== true || was.exerciseId !== s.exerciseId) return 0;
  const now = workingCount(s);
  return Math.max(0, Math.min(now + cut, Math.max(now, workingCount(was))) - now);
}

/** `back` of the original's working sets after Ben's count, in place: a set before his trailing drops, a drop last. */
function withSetsBack(s: BuilderSlot, was: BuilderSlot, back: number): BuilderSlot {
  const now = workingCount(s);
  const extra = was.rows.filter((r) => r.type !== 'warmup').slice(now, now + back);
  const rows = s.rows.map((r) => ({ ...r }));
  for (const r of extra) {
    let at = rows.length;
    if (r.type !== 'drop') while (at > 0 && rows[at - 1]?.type === 'drop') at -= 1;
    rows.splice(at, 0, { ...r });
  }
  return { ...s, rows };
}

/**
 * A dropped slot whose exercise Ben has put back himself (added it again, or swapped another exercise to it): it
 * doesn't come back a second time, and the detail doesn't list it (review N3).
 */
function readded(fit: Pick<BuilderTimeFit, 'base'>, current: BuilderWorkout, dropped: BuilderSlot): boolean {
  const baseSlots = new Map(slotsOf(fit.base.blocks).map((s) => [s.key, s]));
  return slotsOf(current.blocks).some((s) => s.exerciseId === dropped.exerciseId && baseSlots.get(s.key)?.exerciseId !== s.exerciseId);
}

/**
 * The workout with what the fit cut put back (`fit.base` with Ben's later edits): an untouched slot gets its sets
 * back (the fit changes only rows), a dropped slot returns to its superset when what's left of it still is that
 * superset (and Ben didn't unlink it), else as its own round after the slot before it in the original order. Rests
 * go back to the original level. At most `maxExercises`.
 * `hold`: a slot Ben touched since the fit stays as he has it, the sets the fit took from it held back (what a
 * shorter Time fits from; review R1). Without it they're added back (the whole original: Undo, the full length).
 */
export function unfitWorkout(fit: Pick<BuilderTimeFit, 'base' | 'dropped' | 'cut' | 'paired' | 'added' | 'raised'>, current: BuilderWorkout, opts: { hold?: boolean } = {}): BuilderWorkout {
  const baseSlots = new Map(slotsOf(fit.base.blocks).map((s) => [s.key, s]));
  // (Review todaylean B3) What Today's fill added goes, unless Ben has made it his (touched it).
  const added = new Set((fit.added ?? []).map((a) => a.slotKey));
  let blocks: BuilderBlock[] = current.blocks
    .map((b) => ({ ...b, slots: b.slots.filter((s) => !(added.has(s.key) && !baseSlots.has(s.key) && s.touched !== true)) }))
    .filter((b) => b.slots.length > 0)
    .map((b) => ({
    ...b,
    slots: b.slots.map((s) => {
      const was = baseSlots.get(s.key);
      if (was === undefined || was.exerciseId !== s.exerciseId) return s;
      if (s.touched !== true) return { ...s, rows: was.rows.map((r) => ({ ...r })) };
      // Sets the fill added to a slot Ben edited since are the fill's, not his.
      if (fit.raised !== undefined) return lessRaised(fit, was, s);
      if (opts.hold === true) return s;
      // Ben's version, with the sets the fit took added back as they were (the original's, from his count on).
      const back = setsBack(fit, was, s);
      return back === 0 ? s : withSetsBack(s, was, back);
    }),
  }));
  // Pairs the fit made stand alone again, in place (only while still exactly that builder pair).
  for (const keys of fit.paired ?? []) blocks = blocks.flatMap((b) => (madePair(b, keys) ? b.slots.map((x): BuilderBlock => ({ slots: [x], auto: false })) : [b]));
  const order = slotsOf(fit.base.blocks).map((s) => s.key);
  const dropped = new Set(fit.dropped);
  const present = () => new Set(blocks.flatMap((b) => b.slots.map((s) => s.key)));
  for (const key of order) {
    const slot = baseSlots.get(key);
    if (slot === undefined || !dropped.has(key) || present().has(key) || readded(fit, current, slot)) continue;
    if (blocks.reduce((n, b) => n + b.slots.length, 0) >= BUILD_LIMITS.maxExercises) break;
    const home = fit.base.blocks.find((b) => b.slots.some((s) => s.key === key));
    const mates = new Set((home?.slots ?? []).map((s) => s.key));
    const at = home !== undefined && home.slots.length > 1 ? blocks.findIndex((b) => b.slots.length > 0 && b.slots.length < BUILD_LIMITS.maxSuperset && b.slots.every((s) => mates.has(s.key) && s.unlinked !== true)) : -1;
    const target = blocks[at];
    if (home !== undefined && target !== undefined) {
      const slots = [...target.slots, slot].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      // A pair the fit split back to one: the pair's own kind and `After each round` again.
      const again: Partial<BuilderBlock> = target.slots.length === 1 ? { auto: home.auto, ...(home.roundRestS === undefined ? {} : { roundRestS: home.roundRestS }) } : {};
      blocks = blocks.map((b, i) => (i === at ? { ...b, ...again, slots } : b));
      continue;
    }
    const before = order
      .slice(0, order.indexOf(key))
      .reverse()
      .find((k) => present().has(k));
    const after = before === undefined ? -1 : blocks.findIndex((b) => b.slots.some((s) => s.key === before));
    blocks = [...blocks.slice(0, after + 1), { slots: [slot], auto: false }, ...blocks.slice(after + 1)];
  }
  return { ...current, blocks, restLevel: fit.base.restLevel };
}

/** A block that is still exactly the builder pair a fit made of these slots. */
const madePair = (b: BuilderBlock, keys: readonly string[]): boolean => b.auto && b.slots.length === keys.length && b.slots.every((x) => keys.includes(x.key));

export interface WorkoutTimeFitInput {
  current: BuilderWorkout;
  /** The live fit, if any. */
  fit: BuilderTimeFit | null;
  /** The length before the first Time change (the set-up's; at or above it, the original is back). */
  minutes: number;
  /** The length asked for. */
  to: number;
  ctx: BuilderContext;
  mainGroup: BuilderGroupName | null;
  supersets: boolean;
  /**
   * (Ben, 28 Oct) An explicit `+`: past the workout as it is without Time's changes, it is made longer by the longer
   * ladder (`fitToMinutes` grow: rests, accessory sets, main-lift sets, exercises), today's draft only.
   */
  grow?: boolean;
  /** Exercises `+` may add, best first (the day's main group, then the secondary group's). Absent: none. */
  addCandidates?: { arm: readonly string[]; mainGroup: readonly string[] };
}

export interface WorkoutTimeFitOutcome {
  workout: BuilderWorkout;
  /** The fit now live; null: nothing cut (the original stands). */
  fit: BuilderTimeFit | null;
  minutes: number;
  /** Even with every cut allowed the estimate is over the length (`⚠ Over 30 min`). */
  over: boolean;
  /** (Ben, 28 Oct) `+` asked and nothing more could be added (`Nothing more to add`); nothing changed. */
  full?: true;
}

/**
 * The sets a fit kept, with their own effort targets: fewer sets re-mark the last straight set @ RPE 9 (the builder's
 * default-effort convention, `setWorkingCount`), which would raise a saved workout's own target. The kept rows are the
 * fitted copy's in order (a fit only removes rows), so each takes back its own RPE, Ben's included. Nothing else changes.
 */
function keepEffort(fitted: BuilderWorkout, base: BuilderWorkout): BuilderWorkout {
  const was = new Map(slotsOf(base.blocks).map((s) => [s.key, s]));
  const same = (a: BuilderSlot['rows'][number], b: BuilderSlot['rows'][number]) => a.type === b.type && a.reps === b.reps && a.load === b.load && a.durationS === b.durationS;
  const fix = (s: BuilderSlot): BuilderSlot => {
    const orig = was.get(s.key);
    if (orig === undefined || orig.rows === s.rows) return s;
    let k = 0;
    const rows = s.rows.map((r) => {
      while (k < orig.rows.length && !same(orig.rows[k] ?? r, r)) k += 1;
      const o = orig.rows[k];
      k += 1;
      return o === undefined || o.rpe === r.rpe ? r : { ...r, rpe: o.rpe };
    });
    return { ...s, rows };
  };
  return { ...fitted, blocks: fitted.blocks.map((b) => ({ ...b, slots: b.slots.map(fix) })) };
}

/**
 * The working sets held back from each slot Ben touched (slot key → sets): its count in `original` (the whole
 * workout) less its count in `work` (his version). Only a touched slot of the same exercise in both.
 */
export function heldSets(original: BuilderWorkout, work: BuilderWorkout): Record<string, number> {
  const was = new Map(slotsOf(original.blocks).map((s) => [s.key, s]));
  const out: Record<string, number> = {};
  for (const s of slotsOf(work.blocks)) {
    const o = was.get(s.key);
    if (s.touched !== true || o === undefined || o.exerciseId !== s.exerciseId) continue;
    const n = workingCount(o) - workingCount(s);
    if (n > 0) out[s.key] = n;
  }
  return out;
}

export interface WorkoutRefitInput {
  /** The whole workout: what the length before the first Time change (or Undo) brings back, Ben's edits kept. */
  original: BuilderWorkout;
  /**
   * The same workout with each slot Ben touched since a fit as he has it (`unfitWorkout(…, { hold: true })`): what a
   * shorter Time fits from. Without a fit, or with nothing held, the same as `original`.
   */
  work: BuilderWorkout;
  /** The length before the first Time change (at or above it, `original` is back). */
  fromMinutes: number;
  /** The length asked for. */
  to: number;
  ctx: BuilderContext;
  mainGroup: BuilderGroupName | null;
  supersets: boolean;
}

/**
 * Time on a workout as two copies (`original`, `work`): at or above `fromMinutes` the original; shorter, Today's
 * built-in fit on `work`, so a slot Ben touched keeps his version and never gets longer for less time (review R1).
 * The sets held from his slots stay in the record's `cut` (the note lists them; the full length or Undo brings them
 * back). Used by `fitWorkoutToTime`, and by the service when a change (Set up, Gym changed) is made to both copies.
 */
export function refitWorkoutToTime(i: WorkoutRefitInput): WorkoutTimeFitOutcome {
  // (Review ben-8-decisions S3) Carried-over sets aren't Time's to cut: the fit runs without them, then they go back.
  const { workout: work, held } = withoutCarried(i.work, i.ctx);
  const original = withoutCarried(i.original, i.ctx).workout;
  if (work === i.work && original === i.original) return refitBare(i);
  return withHeldBack(refitBare({ ...i, original, work }), held, i.ctx);
}

function refitBare(i: WorkoutRefitInput): WorkoutTimeFitOutcome {
  const to = clampMinutes(i.to);
  const fromMinutes = clampMinutes(i.fromMinutes);
  if (to >= fromMinutes) return { workout: i.original, fit: null, minutes: to, over: false };
  const held = heldSets(i.original, i.work);
  const r = fitToMinutes(i.work, i.ctx, { minutes: to, mainGroup: i.mainGroup, grow: false, supersets: i.supersets });
  if (r.steps.length === 0 && Object.keys(held).length === 0) return { workout: i.original, fit: null, minutes: to, over: r.status === 'over' };
  // The fit never cuts a touched slot (fit.ts), so its own cuts and the held sets never share a key.
  const cut: Record<string, number> = { ...held };
  for (const st of r.steps) if (st.kind === 'sets' && st.from > st.to) cut[st.slotKey] = st.from - st.to;
  const dropped = r.steps.flatMap((s) => (s.kind === 'drop' ? [s.slotKey] : []));
  const paired = r.steps.flatMap((s) => (s.kind === 'pair' ? [[...s.slotKeys]] : []));
  return { workout: keepEffort(r.workout, i.work), fit: { base: i.original, fromMinutes, dropped, cut, ...(paired.length === 0 ? {} : { paired }) }, minutes: to, over: r.status === 'over' };
}

/**
 * The whole original for a copy changed only by adding, removing or pairing exercises (a Set up merge into `work`):
 * each exercise it kept takes the original's rows back (with what the fit holds from Ben's), at the original's rests.
 */
export function withOriginalRows(original: BuilderWorkout, changed: BuilderWorkout): BuilderWorkout {
  const was = new Map(slotsOf(original.blocks).map((s) => [s.key, s]));
  const rowsOf = (s: BuilderSlot): BuilderSlot => {
    const o = was.get(s.key);
    return o === undefined || o.exerciseId !== s.exerciseId ? s : { ...s, rows: o.rows.map((r) => ({ ...r })) };
  };
  return { ...changed, restLevel: original.restLevel, blocks: changed.blocks.map((b) => ({ ...b, slots: b.slots.map(rowsOf) })) };
}

/** `fitWorkoutToTime`: Your workout at a new length (see the module comment). */
export function fitWorkoutToTime(i: WorkoutTimeFitInput): WorkoutTimeFitOutcome {
  const filled = i.fit?.filledTo !== undefined;
  // (Review todaylean B3) A fill is live and Time is still at or above what it filled to: it stays as it is (an explicit
  // `+` grows on, Ben 28 Oct).
  if (i.grow !== true && i.fit?.filledTo !== undefined && clampMinutes(i.to) >= i.fit.filledTo) return { workout: i.current, fit: i.fit, minutes: clampMinutes(i.to), over: false };
  // (Review ben-8-decisions S3) Carried-over sets aren't Time's to cut: the fit runs without them, then they go back.
  const { workout: current, held } = withoutCarried(i.current, i.ctx);
  const fit = i.fit === null ? null : { ...i.fit, base: withoutCarried(i.fit.base, i.ctx).workout };
  const original = fit === null ? current : unfitWorkout(fit, current);
  const work = fit === null ? current : unfitWorkout(fit, current, { hold: true });
  const fromMinutes = fit?.fromMinutes ?? i.minutes;
  // (Ben, 28 Oct) Longer than the workout without Time's changes: `+` makes it longer (a shorter Time on a live fill
  // fills less), from the original each time, so the same Time always gives the same workout.
  const to = clampMinutes(i.to);
  if ((i.grow === true || (filled && to > fromMinutes)) && to * 60 - 30 > estimateBuilderSeconds(original, i.ctx)) {
    // `+` on a live fill grows on from the workout as it is (each tap adds to the last); otherwise from the original.
    const r = i.grow === true && fit !== null && filled ? growWorkout(current, to, i, fit) : growWorkout(original, to, i, null);
    return held.length === 0 ? r : withHeldBack(r, held, i.ctx);
  }
  const r = refitBare({ original, work, fromMinutes, to: i.to, ctx: i.ctx, mainGroup: i.mainGroup, supersets: i.supersets });
  return held.length === 0 ? r : withHeldBack(r, held, i.ctx);
}

/**
 * (Ben, 28 Oct) `+` on Your workout: the original grown to `to` by the longer ladder (`fitToMinutes` grow), recorded as
 * a fill (`added`, `raised`, `filledTo`) with the original as `base` and its own length as `fromMinutes` (at or below
 * it the original is back: the note's Undo), so a shorter
 * Time, the note's Undo and Start read it as Time's (today only; the plan day and saved workout never change). Nothing
 * could be added: the original as it is, `full`.
 */
function growWorkout(from: BuilderWorkout, to: number, i: WorkoutTimeFitInput, live: BuilderTimeFit | null): WorkoutTimeFitOutcome {
  const g = fitToMinutes(from, i.ctx, { minutes: to, mainGroup: i.mainGroup, grow: true, supersets: i.supersets, addCandidates: i.addCandidates ?? { arm: [], mainGroup: [] } });
  if (g.steps.length === 0) return live === null ? { workout: from, fit: null, minutes: clampMinutes(i.minutes), over: false, ...(g.full === true ? { full: true as const } : {}) } : { workout: from, fit: live, minutes: live.filledTo ?? to, over: false, ...(g.full === true ? { full: true as const } : {}) };
  const added = [...(live?.added ?? []), ...g.steps.flatMap((st) => (st.kind === 'add' ? [{ slotKey: st.slotKey, why: st.why }] : []))];
  const isAdded = new Set(added.map((a) => a.slotKey));
  const raised: Record<string, number> = { ...(live?.raised ?? {}) };
  for (const st of g.steps) if (st.kind === 'sets' && st.to > st.from && !isAdded.has(st.slotKey)) raised[st.slotKey] = (raised[st.slotKey] ?? 0) + st.to - st.from;
  const base = live?.base ?? from;
  const fromMinutes = live?.fromMinutes ?? clampMinutes(estimateBuilderMinutes(from, i.ctx));
  const fit: BuilderTimeFit = { base, fromMinutes, dropped: [], ...(added.length === 0 ? {} : { added }), ...(Object.keys(raised).length === 0 ? {} : { raised }), filledTo: to };
  return { workout: g.workout, fit, minutes: to, over: false };
}

/** A fit's outcome with the carried sets back on it, and its minutes as they now are. */
function withHeldBack(r: WorkoutTimeFitOutcome, held: readonly CarriedHold[], ctx: BuilderContext): WorkoutTimeFitOutcome {
  return { ...r, workout: withCarriedBack(r.workout, held, ctx) };
}

/**
 * (Review todaylean B2, B3) Today's card fitted to its Time, as the record Your workout's Time keeps: the draft before
 * the fit (`base`), the length at which nothing is cut (the plan day's, or the draft's own when it is longer), and what
 * the fit left out, cut and paired. So Your workout opened from Today shows Time's note and Undo, more Time brings the
 * plan day's workout back, and Start (and the Summary) never take Time's cuts for Ben's. A card Time filled (above the
 * plan's length, `minutes`) keeps what the fill added and raised, with the plan day's draft as `base` and the plan's
 * length as `fromMinutes`: Time at or below it gives the plan day back, and Start never offers the fill (D1).
 * Null when the fit changed nothing.
 */
export function todayTimeFit(unfitted: BuilderWorkout, steps: readonly BuilderFitStep[], planMinutes: number, ctx: Pick<BuilderContext, 'info' | 'restDefaultsS'>, minutes?: number): BuilderTimeFit | null {
  const rank = (l: BuilderWorkout['restLevel']) => (l === 'normal' ? 0 : l === 'shorter' ? 1 : 2);
  const grew = steps.some((st) => st.kind === 'add' || (st.kind === 'sets' && st.to > st.from) || (st.kind === 'rest' && rank(st.to) < rank(st.from)));
  const shrank = steps.some((st) => st.kind === 'drop' || st.kind === 'pair' || st.kind === 'effort' || (st.kind === 'sets' && st.to < st.from) || (st.kind === 'rest' && rank(st.to) > rank(st.from)));
  if (grew) {
    const added = steps.flatMap((st) => (st.kind === 'add' ? [{ slotKey: st.slotKey, why: st.why }] : []));
    const isAdded = new Set(added.map((a) => a.slotKey));
    const raised: Record<string, number> = {};
    for (const st of steps) if (st.kind === 'sets' && st.to > st.from && !isAdded.has(st.slotKey)) raised[st.slotKey] = (raised[st.slotKey] ?? 0) + st.to - st.from;
    const fromMinutes = clampMinutes(planMinutes);
    return { base: unfitted, fromMinutes, dropped: [], ...(added.length === 0 ? {} : { added }), ...(Object.keys(raised).length === 0 ? {} : { raised }), filledTo: Math.max(fromMinutes, clampMinutes(minutes ?? planMinutes)) };
  }
  if (!shrank) return null;
  const cut: Record<string, number> = {};
  for (const st of steps) if (st.kind === 'sets' && st.from > st.to) cut[st.slotKey] = (cut[st.slotKey] ?? 0) + st.from - st.to;
  const dropped = steps.flatMap((st) => (st.kind === 'drop' ? [st.slotKey] : []));
  const paired = steps.flatMap((st) => (st.kind === 'pair' ? [[...st.slotKeys]] : []));
  const fromMinutes = Math.max(clampMinutes(planMinutes), clampMinutes(estimateBuilderMinutes(unfitted, ctx)));
  return { base: unfitted, fromMinutes, dropped, ...(Object.keys(cut).length === 0 ? {} : { cut }), ...(paired.length === 0 ? {} : { paired }) };
}

type StoredTimeFit = NonNullable<BuilderSetup['timeFit']>;

/** A live fit as the set-up stores it (`timeFit`). */
export function timeFitToStored(fit: BuilderTimeFit, codec: DraftCodecContext): StoredTimeFit {
  return {
    base: toDraftPlan(fit.base, codec),
    ...(fit.base.restLevel === 'normal' ? {} : { baseRestLevel: fit.base.restLevel }),
    fromMinutes: fit.fromMinutes,
    dropped: [...fit.dropped],
    ...(fit.cut === undefined || Object.keys(fit.cut).length === 0 ? {} : { cut: { ...fit.cut } }),
    ...(fit.paired === undefined || fit.paired.length === 0 ? {} : { paired: fit.paired.map((p) => [...p]) }),
    ...(fit.added === undefined || fit.added.length === 0 ? {} : { added: fit.added.map((a) => ({ ...a })) }),
    ...(fit.raised === undefined || Object.keys(fit.raised).length === 0 ? {} : { raised: { ...fit.raised } }),
    ...(fit.filledTo === undefined ? {} : { filledTo: fit.filledTo }),
  };
}

/** The stored record (`timeFit`) as the builder's fit. */
export function timeFitFromStored(t: StoredTimeFit): BuilderTimeFit {
  return {
    base: fromDraftPlan(t.base, t.baseRestLevel ?? 'normal'),
    fromMinutes: t.fromMinutes,
    dropped: t.dropped,
    ...(t.cut === undefined ? {} : { cut: t.cut }),
    ...(t.paired === undefined ? {} : { paired: t.paired }),
    ...(t.added === undefined ? {} : { added: t.added }),
    ...(t.raised === undefined ? {} : { raised: t.raised }),
    ...(t.filledTo === undefined ? {} : { filledTo: t.filledTo }),
  };
}

/**
 * What a live fit changed against the original, now (Ben's later edits counted): shorter rests, pairs it made (still
 * as it made them), fewer sets on a slot he didn't touch, exercises it left out. For the note after Time and the detail behind it.
 */
export function timeFitChanges(fit: BuilderTimeFit, current: BuilderWorkout): BuilderFitStep[] {
  const now = new Map(slotsOf(current.blocks).map((s) => [s.key, s]));
  const out: BuilderFitStep[] = [];
  if (fit.base.restLevel !== current.restLevel) out.push({ kind: 'rest', from: fit.base.restLevel, to: current.restLevel });
  // Pairs the fit made that still stand as it made them.
  for (const keys of fit.paired ?? []) if (current.blocks.some((x) => madePair(x, keys))) out.push({ kind: 'pair', slotKeys: [...keys] });
  for (const was of slotsOf(fit.base.blocks)) {
    const s: BuilderSlot | undefined = now.get(was.key);
    if (s === undefined) {
      if (fit.dropped.includes(was.key) && !readded(fit, current, was)) out.push({ kind: 'drop', slotKey: was.key, exerciseId: was.exerciseId });
      continue;
    }
    if (s.exerciseId !== was.exerciseId) continue;
    // (Review ben-8-decisions S3) Carried-over sets are neither the fit's nor Ben's: counted out on both sides.
    const to = workingCount(s) - carriedSets(s);
    // A slot Ben touched since: only what the fit took (his own changes aren't the fit's).
    const from = s.touched === true ? to + setsBack(fit, was, s) : workingCount(was) - carriedSets(was);
    if (to < from) out.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from, to });
    // (Review todaylean B3) Sets Today's fill added to a slot Ben hasn't touched.
    else if (to > from && s.touched !== true && (fit.raised?.[s.key] ?? 0) > 0) out.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from, to });
  }
  // What Today's fill added that is still there as it added it.
  const inBase = new Set(slotsOf(fit.base.blocks).map((s) => s.key));
  for (const a of fit.added ?? []) {
    const s = now.get(a.slotKey);
    if (s !== undefined && s.touched !== true && !inBase.has(a.slotKey)) out.push({ kind: 'add', slotKey: a.slotKey, exerciseId: s.exerciseId, why: a.why });
  }
  return out;
}

/** The Time control's 5-minute steps (as Today's): down to the 5 below, up to the 5 above; 15–180. */
export function stepTimeMinutes(minutes: number, dir: -1 | 1): number {
  const m = Math.round(minutes);
  const next = dir < 0 ? Math.floor((m - 1) / 5) * 5 : Math.ceil((m + 1) / 5) * 5;
  return Math.max(FIT_RULES.minMinutes, Math.min(FIT_RULES.maxMinutes, next));
}

/**
 * (Ben, 27 Oct: "if I add an exercise without changing the time it changes the time automatically") What the Time
 * control shows on Today's card, Your workout and the workout editor: the live estimate of the workout on the page
 * (`estimateBuilderMinutes`, the one estimate the plan and Today use), never the length Time last fitted to.
 */
export interface LiveTime {
  /** The estimate, in minutes: the number shown. */
  minutes: number;
  /** The estimate is past the length (Ben's own edits are never cut to hold it): the number shows in the warning tone. */
  over: boolean;
  /** What `−` / `+` fit to; null: nothing to step to (a limit). */
  less: number | null;
  more: number | null;
}

/**
 * The live Time control (`LiveTime`). `estimate`: the workout's estimate in minutes; `length`: the length it is held to
 * (the plan's, or the one Time last fitted to); `floor`: the length a `−` must go below to cut anything (default
 * `length`). Your workout's fit cuts only below the length before the first Time change (`refitWorkoutToTime`), so
 * there it is the lower of the two; the workout editor's fit works from the list on the page, so with no live fit it is
 * the estimate itself.
 *
 * `−` / `+` step from the estimate to the next 5-minute step (`stepTimeMinutes`), past the floor (`−`) or the length
 * (`+`) so every tap moves something: an estimate just under its length (a fit can't land on the minute) would step to
 * where it already is, and one over it (Ben's own edits) to a length the fit gives back uncut. Pure.
 */
export function liveTime(i: { estimate: number; length: number; floor?: number; growFromEstimate?: boolean; cutLive?: boolean }): LiveTime {
  const estimate = Math.max(0, Math.round(i.estimate));
  const length = clampMinutes(i.length);
  const floor = clampMinutes(i.floor ?? length);
  // An empty workout (0) has nothing to time: the steps go from the length.
  const from = estimate === 0 ? length : estimate;
  let less = stepTimeMinutes(from, -1);
  if (less >= floor) less = stepTimeMinutes(floor, -1);
  let more = stepTimeMinutes(from, 1);
  // (Ben, 28 Oct) Your workout's `+` makes the workout itself longer (`fitWorkoutToTime` grow): it steps from the
  // estimate, never past the length first. Elsewhere `+` goes past the length (a fit there only gives back cuts).
  // At least 3 minutes more, so a fit that landed just under its step (34 of 35) still moves on a tap.
  if (i.growFromEstimate === true && estimate > 0) {
    // While a cut is live (`cutLive`), past the length too: more Time first gives back what it cut, and a cut that
    // landed under its length would otherwise be asked for the same length again.
    const up = Math.max(stepTimeMinutes(estimate + 2, 1), i.cutLive === true ? stepTimeMinutes(length, 1) : 0);
    return { minutes: estimate, over: estimate > length, less: less < floor ? less : null, more: up > estimate ? up : null };
  }
  if (more <= length) more = stepTimeMinutes(length, 1);
  return { minutes: estimate, over: estimate > length, less: less < floor ? less : null, more: more > length ? more : null };
}
