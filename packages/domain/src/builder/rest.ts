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
 * Fit-to-time rest levels (§2.0.2 3a). `shortest` is the spec's
 * (main 3:00→2:00, compound 2:00→1:15, isolation 1:30→1:00, round
 * 1:30→1:00). OPEN (for Ben): `shorter` is not specified; here it is
 * halfway, rounded down to 15 s; the main lift's top set and back-offs move
 * by the same minute as its working sets. Warm-ups and `before a drop`
 * never change.
 */
type RestTable = Record<'top' | 'backoff' | 'workingMain' | 'workingCompound' | 'workingIsolation' | 'round', number>;

export const BUILDER_REST_LEVELS: Readonly<Record<Exclude<RestLevel, 'normal'>, RestTable>> = {
  shorter: { top: 180, backoff: 150, workingMain: 150, workingCompound: 90, workingIsolation: 75, round: 75 },
  shortest: { top: 150, backoff: 120, workingMain: 120, workingCompound: 75, workingIsolation: 60, round: 60 },
};

/** §9 Q7 limits: before a drop 0–1:00; everything else 0:30–6:00; 15 s steps. MERGE NOTE: S1 owns `BUILD_LIMITS.maxRestS` (300 → 360). */
export const BUILDER_REST_LIMITS = {
  stepS: 15,
  beforeDropMinS: 0,
  beforeDropMaxS: 60,
  minS: 30,
  maxS: 360,
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
  return slot.rows.map((row, i) => {
    const next = slot.rows[i + 1];
    const kind: RestKind = next?.type === 'drop' && row.type !== 'warmup' ? 'before_drop' : row.type;
    return slot.restS?.[kind] ?? defaultRestS(kind, role, level, presets);
  });
}

/** `After each round` for a superset block. */
export function roundRestOf(block: BuilderBlock, level: RestLevel, presets?: readonly number[]): number {
  return block.roundRestS ?? defaultRestS('round', 'isolation', level, presets);
}
