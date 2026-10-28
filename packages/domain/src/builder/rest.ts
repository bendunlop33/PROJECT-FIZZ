import { BUILD_LIMITS, REST_DEFAULT_KEYS, type RestDefaultKey } from '@fizz/schemas';
import { warmupRestS } from '../warmup/plan';
import type { BuilderBlock, BuilderInfoLookup, BuilderSlot, RestKind, RestLevel } from './types';

/**
 * Rest by set type (workout-builder-v3 §3.2, limits §9 Q7). Each set's rest
 * runs AFTER that set: `before_drop` is the rest after the set a drop
 * follows; the drop then rests like a working set. In a superset the only
 * rest is `After each round`, after the round's last exercise.
 */

/** §3.2 defaults, seconds [Ben]. */
export const BUILDER_REST_DEFAULTS = {
  warmup: 60,
  top: 210,
  backoff: 180,
  workingMain: 180,
  workingCompound: 120,
  workingIsolation: 90,
  beforeDrop: 15,
  round: 90,
} as const;

/** §9 Q7 limits (`BUILD_LIMITS`): before a drop 0–1:00; everything else 0:30–6:00; 15 s steps. */
export const BUILDER_REST_LIMITS = {
  stepS: 15,
  beforeDropMinS: 0,
  beforeDropMaxS: BUILD_LIMITS.maxRestBeforeDropS,
  minS: BUILD_LIMITS.minRestS,
  maxS: BUILD_LIMITS.maxRestS,
} as const;

/**
 * (Ben, 28 Oct) Profile › Rest times: the defaults Ben can change (all but `before a drop`). `RestDefaults` holds only
 * the ones he set (seconds); every default reader (`defaultRestS` and everything over it: `restAfterRows`, the
 * estimate, the fit, Today's drafts, Start) uses his value where he set one, else the standard one. A value he set is
 * used exactly as he set it; a standard one still snaps to his rest presets, as before. A rest of his own on a slot
 * still wins, and stored workouts, an open workout and done sets keep theirs.
 */
export type RestDefaults = Readonly<Partial<Record<RestDefaultKey, number>>>;

/** The standard defaults (what `Reset to defaults` goes back to). */
export const STANDARD_REST_DEFAULTS: Readonly<Record<RestDefaultKey, number>> = {
  workingMain: BUILDER_REST_DEFAULTS.workingMain,
  top: BUILDER_REST_DEFAULTS.top,
  backoff: BUILDER_REST_DEFAULTS.backoff,
  workingCompound: BUILDER_REST_DEFAULTS.workingCompound,
  workingIsolation: BUILDER_REST_DEFAULTS.workingIsolation,
  round: BUILDER_REST_DEFAULTS.round,
  warmup: BUILDER_REST_DEFAULTS.warmup,
};

/** Profile › Rest times rows, in order. */
export const REST_DEFAULT_ROWS: readonly { key: RestDefaultKey; label: string }[] = [
  { key: 'workingMain', label: 'Main lift' },
  { key: 'top', label: 'Top set' },
  { key: 'backoff', label: 'Back-off' },
  { key: 'workingCompound', label: 'Compound' },
  { key: 'workingIsolation', label: 'Isolation' },
  { key: 'round', label: 'Superset round' },
  { key: 'warmup', label: 'Warm-up' },
];
export const REST_TIMES_COPY = { title: 'Rest times', reset: 'Reset to defaults', standard: 'Default', own: 'Custom' } as const;

/** Ben's own defaults from his training profile (only those he set), clamped to the limits and onto 15 s. */
export function restDefaultsOf(profile: { restDefaultsS?: Partial<Record<RestDefaultKey, number>> | undefined } | null): RestDefaults {
  const own = profile?.restDefaultsS;
  const out: Partial<Record<RestDefaultKey, number>> = {};
  if (own === undefined) return out;
  for (const key of REST_DEFAULT_KEYS) {
    const v = own[key];
    if (v !== undefined) out[key] = clampBuilderRest('working', v);
  }
  return out;
}

/** Whether Ben set any default (`Reset to defaults` has something to do). */
export function hasOwnRestDefaults(defaults: RestDefaults | undefined): boolean {
  return defaults !== undefined && REST_DEFAULT_KEYS.some((k) => defaults[k] !== undefined);
}

/** One − / + step (15 s) from a rest; null at the limit (the button is off). */
export function stepRestDefault(seconds: number, dir: 1 | -1): number | null {
  const next = clampBuilderRest('working', seconds + dir * BUILDER_REST_LIMITS.stepS);
  return next === seconds ? null : next;
}

/**
 * Fit-to-time rest levels (Ben, 27 Oct; user-facing names `Standard rest` / `Medium rest` / `Minimum rest`,
 * `REST_LEVEL_NAMES`). Accessory rests only: the main lift's top set, back-offs and working sets NEVER change for time
 * (they keep their standard-length values at every level). (Ben, 28 Oct) The shorter levels scale from Ben's
 * values (his own, else the standard ones), snapped to 15 s and never longer than standard: `shorter` (Medium) ×0.8,
 * `shortest` (Minimum) ×⅔; a compound accessory never below 1:30, nothing below 0:30. With the standard defaults that
 * is compound 2:00 → 1:30 → 1:30, isolation and superset round 1:30 → 1:15 → 1:00 (as 27 Oct). Warm-ups and `before a
 * drop` never change.
 */
type RestTable = Record<'top' | 'backoff' | 'workingMain' | 'workingCompound' | 'workingIsolation' | 'round', number>;

const LEVEL_SCALE: Readonly<Record<Exclude<RestLevel, 'normal'>, number>> = { shorter: 0.8, shortest: 2 / 3 };
/** A compound accessory's rest is never shortened below this (Ben, 27 Oct). */
export const COMPOUND_REST_FLOOR_S = 90;

function shortened(standard: number, scale: number, floor: number): number {
  const step = BUILDER_REST_LIMITS.stepS;
  const scaled = Math.round((standard * scale) / step) * step;
  return Math.min(standard, Math.max(floor, BUILDER_REST_LIMITS.minS, scaled));
}

/**
 * The rest table for a level: Ben's own values where he set them (exact), else the standard ones snapped to his
 * presets (`presets`, as before 28 Oct). A shortened value follows its key: from his own value, exact; from a standard
 * one, snapped.
 */
export function restTableOf(level: RestLevel, defaults: RestDefaults = {}, presets?: readonly number[]): RestTable {
  const at = (key: RestDefaultKey, f: (s: number) => number = (s) => s): number => {
    const own = defaults[key];
    return own !== undefined ? f(own) : nearestPreset(f(STANDARD_REST_DEFAULTS[key]), presets);
  };
  const main = { top: at('top'), backoff: at('backoff'), workingMain: at('workingMain') };
  if (level === 'normal') return { ...main, workingCompound: at('workingCompound'), workingIsolation: at('workingIsolation'), round: at('round') };
  const k = LEVEL_SCALE[level];
  return {
    ...main,
    workingCompound: at('workingCompound', (s) => shortened(s, k, COMPOUND_REST_FLOOR_S)),
    workingIsolation: at('workingIsolation', (s) => shortened(s, k, 0)),
    round: at('round', (s) => shortened(s, k, 0)),
  };
}

/** The warm-up default: Ben's own exactly, else the standard snapped to his presets. */
function warmupDefaultS(defaults: RestDefaults | undefined, presets: readonly number[] | undefined): number {
  return defaults?.warmup ?? nearestPreset(STANDARD_REST_DEFAULTS.warmup, presets);
}

/** The standard defaults' shorter levels (kept for readers of the fixed table). */
export const BUILDER_REST_LEVELS: Readonly<Record<Exclude<RestLevel, 'normal'>, RestTable>> = {
  shorter: restTableOf('shorter'),
  shortest: restTableOf('shortest'),
};

/** One Profile › Rest times row: its label, value (`3:00`) and the value each step goes to (null: at the limit). */
export interface RestTimesRow {
  key: RestDefaultKey;
  label: string;
  seconds: number;
  text: string;
  down: number | null;
  up: number | null;
}

/**
 * (Ben, 28 Oct) Profile › Rest times: the seven rows at the values he gets now (his own, else the standard snapped to
 * his presets), and whether `Reset to defaults` has anything to reset.
 */
export function restTimesView(defaults: RestDefaults, presets?: readonly number[]): { rows: RestTimesRow[]; canReset: boolean } {
  const t = restTableOf('normal', defaults, presets);
  const value: Record<RestDefaultKey, number> = { ...t, warmup: warmupDefaultS(defaults, presets) };
  return {
    rows: REST_DEFAULT_ROWS.map(({ key, label }) => ({ key, label, seconds: value[key], text: restClockText(value[key]), down: stepRestDefault(value[key], -1), up: stepRestDefault(value[key], 1) })),
    canReset: hasOwnRestDefaults(defaults),
  };
}

/**
 * (Ben, 28 Oct) What `Rest when short on time` shows under each option: the accessory rests that level gives, from
 * Ben's values, e.g. `Compound 2:00 · Isolation 1:30`.
 */
export function restLevelTimesLine(level: RestLevel, defaults: RestDefaults = {}, presets?: readonly number[]): string {
  const t = restTableOf(level, defaults, presets);
  return `Compound ${restClockText(t.workingCompound)} · Isolation ${restClockText(t.workingIsolation)}`;
}

/** The main lift's rest, shown once on that screen (it never shortens): `Main lift 3:00`. */
export function mainLiftRestLine(defaults: RestDefaults = {}, presets?: readonly number[]): string {
  return `Main lift ${restClockText(restTableOf('normal', defaults, presets).workingMain)}`;
}

/** (Ben, 27 Oct) What Ben reads for each rest level (Profile › Training › `Rest when short on time`, the fit's note). */
export const REST_LEVEL_NAMES: Readonly<Record<RestLevel, string>> = {
  normal: 'Standard rest',
  shorter: 'Medium rest',
  shortest: 'Minimum rest',
};

/** (Ben, 27 Oct) The shortest rest level a time fit may go to when Ben hasn't chosen: `Minimum rest`. */
export const DEFAULT_FIT_REST_LEVEL: RestLevel = 'shortest';

/** A rest Ben sets, clamped to its kind's limits and snapped to 15 s. */
export function clampBuilderRest(kind: RestKind | 'round', seconds: number): number {
  const L = BUILDER_REST_LIMITS;
  const [lo, hi] = kind === 'before_drop' ? [L.beforeDropMinS, L.beforeDropMaxS] : [L.minS, L.maxS];
  const stepped = Math.round((Number.isFinite(seconds) ? seconds : lo) / L.stepS) * L.stepS;
  return Math.min(hi, Math.max(lo, stepped));
}

function nearestPreset(seconds: number, presets: readonly number[] | undefined): number {
  if (presets === undefined || presets.length === 0) return seconds;
  let best = seconds;
  let gap = Infinity;
  for (const p of [...presets].sort((a, b) => a - b)) {
    const d = Math.abs(p - seconds);
    if (d < gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

export type RestRole = 'main' | 'compound' | 'isolation';

/** A slot's role for rest: main lift, compound accessory or isolation. Unknown exercises rest as isolations. */
export function restRoleOf(slot: Pick<BuilderSlot, 'main' | 'exerciseId'>, info: BuilderInfoLookup): RestRole {
  if (slot.main) return 'main';
  return info(slot.exerciseId)?.role === 'compound' ? 'compound' : 'isolation';
}

/**
 * The default rest (seconds) for a kind, role and level, from Ben's defaults (`defaults`; absent: the standard ones);
 * Ben's presets snap it.
 */
export function defaultRestS(kind: RestKind | 'round', role: RestRole, level: RestLevel, presets?: readonly number[], defaults?: RestDefaults): number {
  if (kind === 'before_drop') return BUILDER_REST_DEFAULTS.beforeDrop;
  if (kind === 'warmup') return warmupDefaultS(defaults, presets);
  const table = restTableOf(level, defaults, presets);
  let s: number;
  switch (kind) {
    case 'top':
      s = table.top;
      break;
    case 'backoff':
      s = table.backoff;
      break;
    case 'round':
      s = table.round;
      break;
    case 'working':
    case 'drop':
      s = role === 'main' ? table.workingMain : role === 'compound' ? table.workingCompound : table.workingIsolation;
      break;
  }
  return s;
}

/**
 * Rest after each row of a solo slot (seconds), in row order. Ben's own rest
 * per kind wins over the default and the fit level.
 */
export function restAfterRows(slot: BuilderSlot, info: BuilderInfoLookup, level: RestLevel, presets?: readonly number[], defaults?: RestDefaults): number[] {
  const role = restRoleOf(slot, info);
  const firstWork = slot.rows.find((r) => r.type !== 'warmup');
  return slot.rows.map((row, i) => {
    const next = slot.rows[i + 1];
    const kind: RestKind = next?.type === 'drop' && row.type !== 'warmup' ? 'before_drop' : row.type;
    const own = slot.restS?.[kind];
    if (own !== undefined) return own;
    // (Ben, 27 Oct) The plan day's stored rest: as stored at normal length; a shorter level may shorten an accessory's.
    const plan = slot.planRestS?.[kind];
    if (plan !== undefined) return level === 'normal' || role === 'main' || kind === 'top' || kind === 'backoff' ? plan : Math.min(plan, defaultRestS(kind, role, level, presets, defaults));
    // (WU11) The last warm-up rests 2 min before a rep-band first working set, 3 min before a heavy-band one.
    if (row.type === 'warmup' && next !== undefined && next.type !== 'warmup' && firstWork !== undefined && firstWork.durationS === undefined && firstWork.distanceM === undefined) return nearestPreset(warmupRestS(firstWork.reps, true), presets);
    return defaultRestS(kind, role, level, presets, defaults);
  });
}

/** `After each round` for a superset block. */
export function roundRestOf(block: BuilderBlock, level: RestLevel, presets?: readonly number[], defaults?: RestDefaults): number {
  return block.roundRestS ?? defaultRestS('round', 'isolation', level, presets, defaults);
}

/**
 * (Ben, 23 Oct; §2.9) A slot's working rest as Ben reads it: the rest after its first working set (the top set's, or
 * the working sets'), his own or the default. Null: no working set.
 */
export function workingRestS(slot: BuilderSlot, info: BuilderInfoLookup, level: RestLevel, presets?: readonly number[], defaults?: RestDefaults): number | null {
  const first = slot.rows.find((r) => r.type !== 'warmup');
  if (first === undefined) return null;
  const kind: RestKind = first.type === 'warmup' ? 'working' : first.type;
  return slot.restS?.[kind] ?? defaultRestS(kind, restRoleOf(slot, info), level, presets, defaults);
}

/** `3:00`, `1:30`. */
export function restClockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** (Ben, 27 Oct) Profile › Training › `Rest when short on time`: the row title and its options, in order. */
export const REST_WHEN_SHORT_COPY = { title: 'Rest when short on time' } as const;
export const FIT_REST_LEVEL_OPTIONS: readonly RestLevel[] = ['normal', 'shorter', 'shortest'];

/** Ben's `Rest when short on time` from his training profile (absent or unreadable: Minimum rest). */
export function fitRestLevelOf(profile: { fitRestLevel?: RestLevel | undefined } | null): RestLevel {
  return profile?.fitRestLevel ?? DEFAULT_FIT_REST_LEVEL;
}
