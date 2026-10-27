import { BUILD_LIMITS } from '@fizz/schemas';
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

/**
 * Fit-to-time rest levels (Ben, 27 Oct; user-facing names `Standard rest` / `Medium rest` / `Minimum rest`,
 * `REST_LEVEL_NAMES`). Accessory rests only: the main lift's top set, back-offs and working sets NEVER change for time
 * (they keep the normal 3:30 / 3:00 / 3:00 at every level). `shorter` (Medium): compound 2:00 → 1:30, isolation and
 * superset round 1:30 → 1:15. `shortest` (Minimum): isolation and round 1:00; a compound accessory never below 1:30.
 * Warm-ups and `before a drop` never change.
 */
type RestTable = Record<'top' | 'backoff' | 'workingMain' | 'workingCompound' | 'workingIsolation' | 'round', number>;

const MAIN_RESTS = { top: BUILDER_REST_DEFAULTS.top, backoff: BUILDER_REST_DEFAULTS.backoff, workingMain: BUILDER_REST_DEFAULTS.workingMain } as const;

export const BUILDER_REST_LEVELS: Readonly<Record<Exclude<RestLevel, 'normal'>, RestTable>> = {
  shorter: { ...MAIN_RESTS, workingCompound: 90, workingIsolation: 75, round: 75 },
  shortest: { ...MAIN_RESTS, workingCompound: 90, workingIsolation: 60, round: 60 },
};

/** (Ben, 27 Oct) What Ben reads for each rest level (Profile › Training › `Rest when short on time`, the fit's note). */
export const REST_LEVEL_NAMES: Readonly<Record<RestLevel, string>> = {
  normal: 'Standard rest',
  shorter: 'Medium rest',
  shortest: 'Minimum rest',
};

/** (Ben, 27 Oct) The shortest rest level a time fit may go to when Ben hasn't chosen: `Minimum rest`. */
export const DEFAULT_FIT_REST_LEVEL: RestLevel = 'shortest';

/** §9 Q7 limits (`BUILD_LIMITS`): before a drop 0–1:00; everything else 0:30–6:00; 15 s steps. */
export const BUILDER_REST_LIMITS = {
  stepS: 15,
  beforeDropMinS: 0,
  beforeDropMaxS: BUILD_LIMITS.maxRestBeforeDropS,
  minS: BUILD_LIMITS.minRestS,
  maxS: BUILD_LIMITS.maxRestS,
} as const;

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

/** The default rest (seconds) for a kind, role and level; Ben's presets snap it. */
export function defaultRestS(kind: RestKind | 'round', role: RestRole, level: RestLevel, presets?: readonly number[]): number {
  const D = BUILDER_REST_DEFAULTS;
  if (kind === 'before_drop') return D.beforeDrop;
  if (kind === 'warmup') return nearestPreset(D.warmup, presets);
  const table: RestTable = level === 'normal' ? D : BUILDER_REST_LEVELS[level];
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
  return nearestPreset(s, presets);
}

/**
 * Rest after each row of a solo slot (seconds), in row order. Ben's own rest
 * per kind wins over the default and the fit level.
 */
export function restAfterRows(slot: BuilderSlot, info: BuilderInfoLookup, level: RestLevel, presets?: readonly number[]): number[] {
  const role = restRoleOf(slot, info);
  const firstWork = slot.rows.find((r) => r.type !== 'warmup');
  return slot.rows.map((row, i) => {
    const next = slot.rows[i + 1];
    const kind: RestKind = next?.type === 'drop' && row.type !== 'warmup' ? 'before_drop' : row.type;
    const own = slot.restS?.[kind];
    if (own !== undefined) return own;
    // (WU11) The last warm-up rests 2 min before a rep-band first working set, 3 min before a heavy-band one.
    if (row.type === 'warmup' && next !== undefined && next.type !== 'warmup' && firstWork !== undefined && firstWork.durationS === undefined && firstWork.distanceM === undefined) return nearestPreset(warmupRestS(firstWork.reps, true), presets);
    return defaultRestS(kind, role, level, presets);
  });
}

/** `After each round` for a superset block. */
export function roundRestOf(block: BuilderBlock, level: RestLevel, presets?: readonly number[]): number {
  return block.roundRestS ?? defaultRestS('round', 'isolation', level, presets);
}

/**
 * (Ben, 23 Oct; §2.9) A slot's working rest as Ben reads it: the rest after its first working set (the top set's, or
 * the working sets'), his own or the default. Null: no working set.
 */
export function workingRestS(slot: BuilderSlot, info: BuilderInfoLookup, level: RestLevel, presets?: readonly number[]): number | null {
  const first = slot.rows.find((r) => r.type !== 'warmup');
  if (first === undefined) return null;
  const kind: RestKind = first.type === 'warmup' ? 'working' : first.type;
  return slot.restS?.[kind] ?? defaultRestS(kind, restRoleOf(slot, info), level, presets);
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
