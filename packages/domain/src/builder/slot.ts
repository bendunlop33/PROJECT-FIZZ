import { infoOrDefault } from './arrange';
import { slotLoadOf, slotRepRange } from './reps';
import { BUILDER_SET_RULES, setRowsFor } from './set-rows';
import { BUILD_LIMITS } from '@fizz/schemas';
import { CARDIO_DEFAULT_S } from '../cardio';
import type { BuilderContext, BuilderSlot, RepRangeT } from './types';

/** `makeSlot`: one exercise's slot with the default shape (§3.1.9), reps from history (`slotRepRange`), and its rows and loads. */
export function makeSlot(exerciseId: string, opts: { main: boolean; workingSets?: number; /** (Ben, 27 Oct) A plan day's stored reps. */ repRange?: RepRangeT | null }, ctx: BuilderContext): BuilderSlot {
  const info = infoOrDefault(ctx.info, exerciseId);
  const sets = opts.workingSets ?? (opts.main ? BUILDER_SET_RULES.mainSets : BUILDER_SET_RULES.accessorySets);
  const load = slotLoadOf(ctx.loads(exerciseId), opts.main);
  // Reps from history (21 Oct): a slot's reps follow Ben's last session of this exercise through the built-in rule;
  // (Ben, 27 Oct) a plan day's stored reps are drafted as stored.
  const repRange = slotRepRange(opts.main, load, opts.repRange ?? null);
  const r = setRowsFor({ main: opts.main, role: info.role, barbell: info.barbell, workingSets: sets, repRange, load, group: info.group, ...(info.warmup === undefined ? {} : { facts: info.warmup }) });
  const hv = load.historyVersion ?? null;
  return { key: ctx.newKey(exerciseId), exerciseId, main: opts.main, repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm, ...(hv === null ? {} : { historyVersion: hv }) };
}


/** A timed hold's work time when none is asked (battle ropes, mountain climbers). */
export const TIMED_DEFAULT_S = 30;

/**
 * (Ben, 27 Oct) A slot for an exercise with no builder group (`BuilderContext.extra`). Cardio or a timed hold: `sets`
 * working sets of `workS` seconds (default 10:00 cardio, 0:30 a hold; clamped to the builder's limits), stored, shown
 * and started as a library workout's ride is (22 Oct: `isTimedSlot`). Rep work (box jumps, wall balls): `sets` sets of
 * its built-in reps. Never a planned load, RPE or warm-up: Ben logs what he does.
 */
export function makeExtraSlot(exerciseId: string, opts: { workS: number | null; sets?: number }, ctx: BuilderContext): BuilderSlot {
  const x = ctx.extra?.(exerciseId) ?? null;
  const load = ctx.loads(exerciseId);
  const base = { key: ctx.newKey(exerciseId), exerciseId, main: false, source: 'none' as const, startLight: null, anchorE1rm: null };
  if (x?.measurement === 'reps') {
    const range = x.repRange ?? { ...BUILDER_SET_RULES.accessoryRange };
    const sets = Math.max(BUILD_LIMITS.minWorkingSets, Math.min(BUILD_LIMITS.maxWorkingSets, Math.round(opts.sets ?? BUILDER_SET_RULES.accessorySets)));
    return { ...base, repRange: { ...range }, rows: Array.from({ length: sets }, () => ({ type: 'working' as const, reps: range.min, ...(range.max > range.min ? { repsMax: range.max } : {}), load: null, rpe: null })), unit: load.unit, convention: load.convention };
  }
  const cardio = (x?.measurement ?? 'cardio') === 'cardio';
  const max = cardio ? BUILD_LIMITS.maxCardioS : BUILD_LIMITS.maxWorkS;
  const workS = Math.min(max, Math.max(BUILD_LIMITS.minWorkS, Math.round(opts.workS ?? (cardio ? CARDIO_DEFAULT_S : TIMED_DEFAULT_S))));
  const sets = Math.max(1, Math.min(BUILD_LIMITS.maxWorkingSets, Math.round(opts.sets ?? 1)));
  return { ...base, repRange: { min: 1, max: 1 }, rows: Array.from({ length: sets }, () => ({ type: 'working' as const, reps: 1, load: null, rpe: null, durationS: workS })), unit: load.unit, convention: 'bodyweight' };
}
