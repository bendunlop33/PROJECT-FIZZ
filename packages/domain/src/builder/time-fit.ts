import { BUILD_LIMITS } from '@fizz/schemas';
import { slotsOf } from './arrange';
import { clampMinutes, FIT_RULES, fitToMinutes, type BuilderFitStep } from './fit';
import { workingCount } from './set-rows';
import type { BuilderBlock, BuilderContext, BuilderGroupName, BuilderSlot, BuilderWorkout } from './types';

/**
 * Your workout's Time control (22 Oct, Ben: "add option to reduce time"; fit-to-time.md, 22 Oct revision). Pure.
 *
 * - The fit is Today's built-in one (`fitToMinutes`, shrink only): shorter rests first, then fewer accessory sets
 *   (never below 2), then whole exercises (abs and no-group extras first, compounds last), never the main lift. No
 *   supersets are made (Supersets off is a hard rule, design review V14), no effort is pushed (the 22 Oct revision
 *   has no effort step; kept sets keep their own RPE), and nothing is ever added or raised.
 * - It works on today's draft only and keeps the workout as it was before the first Time change (`base`): every
 *   step fits from that, so more time brings back what it cut, up to the original, never more. At or above the
 *   length it had then, the original is back as it was.
 * - Ben's edits after a fit stay: a slot he touched keeps his version (fit-to-time FT5), a slot he deleted stays
 *   deleted, his order and pairs stand; only what the fit cut comes back. A slot he touched after the fit cut its sets
 *   (an RPE, a rep) still gets the cut sets back, up to the original count (review: an edit doesn't lock in a cut).
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
 * The workout with what the fit cut put back (`fit.base` with Ben's later edits): an untouched slot gets its sets
 * back (the fit changes only rows), a dropped slot returns to its superset when what's left of it still is that
 * superset (and Ben didn't unlink it), else as its own round after the slot before it in the original order. Rests
 * go back to the original level. At most `maxExercises`.
 */
export function unfitWorkout(fit: Pick<BuilderTimeFit, 'base' | 'dropped' | 'cut'>, current: BuilderWorkout): BuilderWorkout {
  const baseSlots = new Map(slotsOf(fit.base.blocks).map((s) => [s.key, s]));
  let blocks: BuilderBlock[] = current.blocks.map((b) => ({
    ...b,
    slots: b.slots.map((s) => {
      const was = baseSlots.get(s.key);
      if (was === undefined || was.exerciseId !== s.exerciseId) return s;
      if (s.touched !== true) return { ...s, rows: was.rows.map((r) => ({ ...r })) };
      // Ben's version, with the sets the fit took added back as they were (the original's, from his count on).
      const back = setsBack(fit, was, s);
      return back === 0 ? s : withSetsBack(s, was, back);
    }),
  }));
  const order = slotsOf(fit.base.blocks).map((s) => s.key);
  const dropped = new Set(fit.dropped);
  const present = () => new Set(blocks.flatMap((b) => b.slots.map((s) => s.key)));
  for (const key of order) {
    const slot = baseSlots.get(key);
    if (slot === undefined || !dropped.has(key) || present().has(key)) continue;
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
}

export interface WorkoutTimeFitOutcome {
  workout: BuilderWorkout;
  /** The fit now live; null: nothing cut (the original stands). */
  fit: BuilderTimeFit | null;
  minutes: number;
  /** Even with every cut allowed the estimate is over the length (`⚠ Over 30 min`). */
  over: boolean;
}

/**
 * The sets a fit kept, with their own effort targets: fewer sets re-mark the last straight set @ RPE 9 (the builder's
 * default-effort convention, `setWorkingCount`), which would raise a saved workout's own target. The kept rows are the
 * original's in order (a fit only removes rows), so each takes back its original RPE. Nothing else changes.
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

/** `fitWorkoutToTime`: Your workout at a new length (see the module comment). */
export function fitWorkoutToTime(i: WorkoutTimeFitInput): WorkoutTimeFitOutcome {
  const to = clampMinutes(i.to);
  const base = i.fit === null ? i.current : unfitWorkout(i.fit, i.current);
  const fromMinutes = i.fit?.fromMinutes ?? clampMinutes(i.minutes);
  if (to >= fromMinutes) return { workout: base, fit: null, minutes: to, over: false };
  const r = fitToMinutes(base, i.ctx, { minutes: to, mainGroup: i.mainGroup, grow: false, supersets: i.supersets, pushEffort: false, noGroupFirst: true });
  if (r.steps.length === 0) return { workout: base, fit: null, minutes: to, over: r.status === 'over' };
  const cut: Record<string, number> = {};
  for (const st of r.steps) if (st.kind === 'sets' && st.from > st.to) cut[st.slotKey] = st.from - st.to;
  return { workout: keepEffort(r.workout, base), fit: { base, fromMinutes, dropped: r.steps.flatMap((s) => (s.kind === 'drop' ? [s.slotKey] : [])), cut }, minutes: to, over: r.status === 'over' };
}

/**
 * What a live fit changed against the original, now (Ben's later edits counted): shorter rests, fewer sets on a slot
 * he didn't touch, exercises it left out. For the note after Time and the detail behind it.
 */
export function timeFitChanges(fit: BuilderTimeFit, current: BuilderWorkout): BuilderFitStep[] {
  const now = new Map(slotsOf(current.blocks).map((s) => [s.key, s]));
  const out: BuilderFitStep[] = [];
  if (fit.base.restLevel !== current.restLevel) out.push({ kind: 'rest', from: fit.base.restLevel, to: current.restLevel });
  for (const was of slotsOf(fit.base.blocks)) {
    const s: BuilderSlot | undefined = now.get(was.key);
    if (s === undefined) {
      if (fit.dropped.includes(was.key)) out.push({ kind: 'drop', slotKey: was.key, exerciseId: was.exerciseId });
      continue;
    }
    if (s.exerciseId !== was.exerciseId) continue;
    const to = workingCount(s);
    // A slot Ben touched since: only what the fit took (his own changes aren't the fit's).
    const from = s.touched === true ? to + setsBack(fit, was, s) : workingCount(was);
    if (to < from) out.push({ kind: 'sets', slotKey: s.key, exerciseId: s.exerciseId, from, to });
  }
  return out;
}

/** The Time control's 5-minute steps (as Today's): down to the 5 below, up to the 5 above; 15–180. */
export function stepTimeMinutes(minutes: number, dir: -1 | 1): number {
  const m = Math.round(minutes);
  const next = dir < 0 ? Math.floor((m - 1) / 5) * 5 : Math.ceil((m + 1) / 5) * 5;
  return Math.max(FIT_RULES.minMinutes, Math.min(FIT_RULES.maxMinutes, next));
}
