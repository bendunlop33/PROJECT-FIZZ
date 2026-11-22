/**
 * (Ben, 28 Oct: "time estimate learns my real pace") Ben's own pace for the one time estimate
 * (`estimateBuilderSeconds`): his typical seconds per set, how far his rests run over the planned rest, and his
 * changeover between exercises, fitted from his own logged timestamps. Pure.
 *
 * - Only workouts logged live count: an imported workout (no times) or one entered with `Log a past workout` (its
 *   times are made up) never does. Paused time is taken out of every gap.
 * - Gaps: consecutive completed sets of the same exercise are one set plus the planned rest before the next
 *   (`gap ≈ setS + restScale × rest`); the gap to the next exercise's first set is the rest, the changeover and that
 *   set (`gap ≈ restScale × rest + betweenS + setS`). A gap under 20 s (sets logged in a batch) or far past its rest
 *   (`3 × rest + 5 min`; a changeover over 20 min) is an outlier and left out.
 * - Seconds per set needs rests of different lengths to tell it from the rest: with them (a spread of at least 20 s)
 *   a least-squares line; without, the default 45 s stays and only the rest overrun is fitted (the median).
 * - Blended with the defaults until there is enough: weight `n / 3` for `n` timed workouts (the 12 newest in the last
 *   60 days), full from 3. Each value is capped (`PACE_RULES`), so one odd week can't make the estimate silly.
 * It is an estimate (rule 6): nothing is invented, and with no timed workouts it is the defaults exactly.
 */

export interface BuilderPace {
  /** Seconds a set takes (default 45). */
  setS: number;
  /** Actual rest ÷ planned rest (default 1). */
  restScale: number;
  /** Seconds between two exercises (default 60). */
  betweenS: number;
  /** How many timed workouts it was fitted from (0: the defaults). */
  workouts: number;
}

export const PACE_DEFAULT: BuilderPace = { setS: 45, restScale: 1, betweenS: 60, workouts: 0 };

export const PACE_RULES = {
  /** Timed workouts for full weight (fewer blend with the defaults). */
  fullAt: 3,
  maxWorkouts: 12,
  windowDays: 60,
  setS: { min: 30, max: 75 },
  restScale: { min: 0.85, max: 1.5 },
  betweenS: { min: 30, max: 180 },
  /** Fewer usable gaps than this: that value stays the default. */
  minGaps: 6,
  minChanges: 3,
  /** A gap shorter than this is sets logged in a batch, not a pace. */
  minGapS: 20,
  /** A changeover longer than this isn't one (a phone call, a forgotten log). */
  maxChangeS: 20 * 60,
  /** Planned rests must differ by this much (standard deviation) before seconds per set is fitted. */
  minRestSpreadS: 20,
} as const;

/** One completed set as the pace reads it. */
export interface PaceSet {
  /** The workout's exercise row (a change of row is a changeover). */
  rowId: string;
  completedAtMs: number;
  /** The planned rest after it in seconds; null when not recorded (an imported set). */
  restS: number | null;
}

/** One finished workout as the pace reads it. */
export interface PaceWorkout {
  source: 'manual' | 'import';
  /** Entered with `Log a past workout`: its times are made up. */
  pastLog: boolean;
  startedAtMs: number;
  /** Closed pauses (taken out of the gaps). */
  pauses: readonly { fromMs: number; toMs: number }[];
  sets: readonly PaceSet[];
}

const clamp = (x: number, r: { min: number; max: number }): number => Math.max(r.min, Math.min(r.max, x));

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

const pausedBetween = (w: PaceWorkout, a: number, b: number): number => w.pauses.reduce((m, p) => m + Math.max(0, Math.min(b, p.toMs) - Math.max(a, p.fromMs)), 0);

interface Gaps {
  within: { gapS: number; restS: number }[];
  change: { gapS: number; restS: number }[];
}

/** One workout's usable gaps (see the module comment); null: it can't be timed. */
export function paceGaps(w: PaceWorkout): Gaps | null {
  if (w.source !== 'manual' || w.pastLog) return null;
  const sets = [...w.sets].filter((s) => Number.isFinite(s.completedAtMs)).sort((a, b) => a.completedAtMs - b.completedAtMs);
  const out: Gaps = { within: [], change: [] };
  for (let i = 1; i < sets.length && i < 400; i += 1) {
    const a = sets[i - 1];
    const b = sets[i];
    if (a === undefined || b === undefined) continue;
    const gapS = (b.completedAtMs - a.completedAtMs - pausedBetween(w, a.completedAtMs, b.completedAtMs)) / 1000;
    if (gapS < PACE_RULES.minGapS) continue;
    if (a.rowId === b.rowId) {
      if (a.restS === null || a.restS <= 0 || gapS > 3 * a.restS + 300) continue;
      out.within.push({ gapS, restS: a.restS });
    } else {
      if (gapS > PACE_RULES.maxChangeS) continue;
      out.change.push({ gapS, restS: a.restS ?? 0 });
    }
  }
  return out.within.length + out.change.length === 0 ? null : out;
}

/**
 * Ben's pace from his workouts (any order; only the 12 newest timed ones in the 60 days before `nowMs` count). With
 * none it is `PACE_DEFAULT`.
 */
export function learnPace(workouts: readonly PaceWorkout[], nowMs: number): BuilderPace {
  const fromMs = nowMs - PACE_RULES.windowDays * 86_400_000;
  const timed = [...workouts]
    .filter((w) => w.startedAtMs >= fromMs && w.startedAtMs <= nowMs)
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .map(paceGaps)
    .filter((g): g is Gaps => g !== null)
    .slice(0, PACE_RULES.maxWorkouts);
  const n = timed.length;
  if (n === 0) return PACE_DEFAULT;
  const within = timed.flatMap((g) => g.within);
  const change = timed.flatMap((g) => g.change);
  let setS = PACE_DEFAULT.setS;
  let restScale = PACE_DEFAULT.restScale;
  if (within.length >= PACE_RULES.minGaps) {
    const meanR = within.reduce((m, x) => m + x.restS, 0) / within.length;
    const meanG = within.reduce((m, x) => m + x.gapS, 0) / within.length;
    const varR = within.reduce((m, x) => m + (x.restS - meanR) ** 2, 0) / within.length;
    const fitted = varR >= PACE_RULES.minRestSpreadS ** 2 ? lineFit(within, meanR, meanG, varR) : null;
    if (fitted !== null) {
      setS = fitted.setS;
      restScale = fitted.restScale;
    } else {
      restScale = median(within.map((x) => (x.gapS - PACE_DEFAULT.setS) / x.restS)) ?? PACE_DEFAULT.restScale;
    }
  }
  setS = clamp(setS, PACE_RULES.setS);
  restScale = clamp(restScale, PACE_RULES.restScale);
  let betweenS = PACE_DEFAULT.betweenS;
  if (change.length >= PACE_RULES.minChanges) betweenS = median(change.map((x) => x.gapS - restScale * x.restS - setS)) ?? betweenS;
  betweenS = clamp(betweenS, PACE_RULES.betweenS);
  // Blend with the defaults until there are enough timed workouts.
  const k = Math.min(1, n / PACE_RULES.fullAt);
  const mix = (own: number, d: number) => d + k * (own - d);
  return {
    setS: Math.round(mix(setS, PACE_DEFAULT.setS)),
    restScale: Math.round(mix(restScale, PACE_DEFAULT.restScale) * 100) / 100,
    betweenS: Math.round(mix(betweenS, PACE_DEFAULT.betweenS)),
    workouts: n,
  };
}

/** `gap = setS + restScale × rest` by least squares; null when the line is outside the caps (then the median is used). */
function lineFit(xs: readonly { gapS: number; restS: number }[], meanR: number, meanG: number, varR: number): { setS: number; restScale: number } | null {
  const cov = xs.reduce((m, x) => m + (x.restS - meanR) * (x.gapS - meanG), 0) / xs.length;
  const restScale = cov / varR;
  const setS = meanG - restScale * meanR;
  const inside = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;
  return inside(restScale, PACE_RULES.restScale) && inside(setS, PACE_RULES.setS) ? { setS, restScale } : null;
}
