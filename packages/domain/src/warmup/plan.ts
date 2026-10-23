import { muscleGroupOf, type LoadConvention } from '@fizz/schemas';

/**
 * The one warm-up planner (playbook WU1–WU12, approved by Ben 22 Oct 2026;
 * docs/training-guides/warm-up.md). Pure. The builder, coach drafts, Start
 * (routines, plan days, the coach's workouts) and the active workout's ramp
 * all plan warm-ups here, so the warm-ups Ben sees and the ones stored agree.
 *
 * - WU1 Warm-ups are `warmup` sets with no RPE. They never count, progress or
 *   trigger anything (enforced where sets are counted); planned here only for
 *   sets not yet done, never written over a logged set (rule 2).
 * - WU2 `isWarmed`: an earlier exercise with the same primary muscle group or
 *   movement pattern, or a superset partner already started.
 * - WU3 Band: heavy = R ≤ 6, rep = R ≥ 7, R the first working set's reps.
 * - WU4–WU7 `rawSteps`: the table by class (`warmupClassOf`).
 * - WU8 Snapping down on the gym's achievable loads (`loads`), (a)–(f), then
 *   WU4's gap check. Nothing ever reaches W (rule 4).
 * - WU9 Floor-start lifts: no bar step; plates-on start when known.
 * - WU10 Rep caps, ≤ 25 reps, singles only in the heavy band with R ≤ 3.
 * - WU11 `warmupTimeS`, `planSessionWarmups`: the D17 budget and its cuts.
 * - WU12 `generalWarmupMinutes`: optional easy cardio before a heavy first lift.
 *
 * Loads are numbers in the working load's own unit and convention (total
 * barbell, per dumbbell, stack, plate-loaded `added`); `loads` is what this
 * gym's item can make in that unit and convention, ascending.
 */

// ---------------------------------------------------------------------------
// Classes and the data they come from

/**
 * - `heavy`: the main lift or a heavy compound (a free-bar compound): WU4 (R ≤ 6) / WU5 (R ≥ 7).
 * - `secondary`: other compounds (dumbbells, kettlebells, cables): WU6.
 * - `machine`: a machine compound (plate-loaded, Smith, a `machine-` stack): WU6 when R ≤ 6, else WU7.
 * - `isolation`: WU7's one step.
 * - `weighted_bodyweight`: WU7, bodyweight only.
 * - `bodyweight`: bodyweight or assisted: 0 (WU7's easier-variation step needs data the app lacks; see `warmupClassOf`).
 * - `none`: timed, distance and cardio work: no warm-up sets.
 */
export type WarmupClass = 'heavy' | 'secondary' | 'machine' | 'isolation' | 'weighted_bodyweight' | 'bodyweight' | 'none';

/** What the planner reads about an exercise (an `Exercise` row satisfies it). */
export interface WarmupExerciseFacts {
  catalogueKey?: string | null | undefined;
  family?: string | null | undefined;
  movementPattern?: string | null | undefined;
  mechanic?: 'compound' | 'isolation' | null | undefined;
  primaryMuscles?: readonly string[] | undefined;
  measurement?: string | undefined;
  defaultLoadConvention?: LoadConvention | undefined;
}

/** An exercise as the planner sees it at this gym. */
export interface WarmupProfile {
  cls: WarmupClass;
  /** WU9: a bar lift that starts from the floor (deadlifts, floor rows, cleans). */
  floorStart: boolean;
  /** WU2: the catalogue movement pattern, when it is one WU2 counts. */
  pattern: string | null;
  /** WU2: the primary muscle group (the first primary muscle's group), else a fallback group. */
  group: string | null;
  /** Cardio and running never warm a lifting pattern (WU2). */
  cardio: boolean;
}

/** Patterns WU2 matches on. Others (core, arms, calves, carries, lunges) match by muscle group only. */
const WU2_PATTERNS: ReadonlySet<string> = new Set(['squat', 'hinge', 'horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull']);
const BAR_KINDS: ReadonlySet<string> = new Set(['barbell', 'ez_bar', 'trap_bar']);
const MACHINE_KINDS: ReadonlySet<string> = new Set(['plate_loaded_machine', 'smith_machine']);
/** WU9 fallback list: catalogue families and keys that start from the floor (the catalogue has no flag yet). */
const FLOOR_FAMILIES: ReadonlySet<string> = new Set(['deadlift', 'power_clean', 'clean', 'clean_and_jerk', 'snatch']);
const FLOOR_KEYS: ReadonlySet<string> = new Set(['barbell-bent-over-row', 'barbell-pendlay-row']);

export interface WarmupProfileContext {
  /** The main lift of the workout (WU4/WU5 whatever its equipment). */
  main: boolean;
  /** The item used here (`EquipmentInstance.kind`); null = none or unknown. */
  itemKind: string | null;
  /** The working load's convention here. */
  convention: LoadConvention;
  /** A bodyweight exercise with weight added (dips + 20 kg). */
  bodyweightExercise?: boolean;
  /** Fallbacks when the exercise's catalogue facts are missing (a builder lookup without them). */
  fallback?: { compound?: boolean; group?: string | null; barbell?: boolean };
}

/**
 * `warmupClassOf` (WU4–WU7). Documented fallbacks where the catalogue lacks the data:
 * - "Heavy compound" = a compound on a bar (barbell, trap bar, EZ bar); the main lift is always heavy.
 * - "Machine compound" = plate-loaded or Smith, or a stack exercise whose catalogue key starts `machine-`;
 *   other stack compounds (cable rows, pulldowns) are secondary compounds, as WU6's examples.
 * - Bodyweight and assisted compounds get 0 (WU7's easier variation needs a regression and its gym availability,
 *   which exercise rows don't carry).
 */
export function warmupProfileOf(facts: WarmupExerciseFacts | null, ctx: WarmupProfileContext): WarmupProfile {
  const measurement = facts?.measurement ?? 'reps';
  const pattern = facts?.movementPattern ?? null;
  const cardio = measurement === 'cardio' || pattern === 'conditioning';
  const first = facts?.primaryMuscles?.[0];
  const group = (first === undefined ? null : muscleGroupOf(first)) ?? ctx.fallback?.group ?? null;
  const base = { pattern: pattern !== null && WU2_PATTERNS.has(pattern) ? pattern : null, group, cardio };
  const kind = ctx.itemKind;
  const bar = kind !== null ? BAR_KINDS.has(kind) : ctx.fallback?.barbell === true;
  const family = facts?.family ?? null;
  const key = facts?.catalogueKey ?? null;
  const floorStart = bar && ((family !== null && FLOOR_FAMILIES.has(family)) || (key !== null && FLOOR_KEYS.has(key)));
  const of = (cls: WarmupClass): WarmupProfile => ({ cls, floorStart, ...base });
  if (measurement !== 'reps' || cardio) return of('none');
  if (ctx.convention === 'assistance' || ctx.convention === 'bodyweight') return of('bodyweight');
  if (ctx.convention === 'added' && (ctx.bodyweightExercise === true || facts?.defaultLoadConvention === 'bodyweight')) return of('weighted_bodyweight');
  const compound = facts?.mechanic != null ? facts.mechanic === 'compound' : ctx.fallback?.compound === true;
  if (ctx.main) return of('heavy');
  if (!compound) return of('isolation');
  if (bar) return of('heavy');
  if (kind !== null && (MACHINE_KINDS.has(kind) || (kind === 'weight_stack' && key !== null && key.startsWith('machine-')))) return of('machine');
  return of('secondary');
}

/**
 * WU2: warmed when an earlier exercise in today's workout worked the same primary muscle group or WU2 movement
 * pattern (secondary muscles don't count; cardio never warms), or this is a superset partner of one already started.
 */
export function isWarmed(profile: Pick<WarmupProfile, 'pattern' | 'group'>, earlier: readonly Pick<WarmupProfile, 'pattern' | 'group' | 'cardio'>[], supersetPartnerStarted = false): boolean {
  if (supersetPartnerStarted) return true;
  return earlier.some((e) => !e.cardio && ((e.group !== null && e.group === profile.group) || (e.pattern !== null && e.pattern === profile.pattern)));
}

// ---------------------------------------------------------------------------
// One exercise (WU3–WU10)

export interface WarmupStep {
  /** In the working load's unit and convention. */
  load: number;
  reps: number;
}

/** WU11 cuts, mildest first. `none`: no warm-up sets. */
export type WarmupCut = 'full' | 'no_light' | 'no_bar' | 'short' | 'none';

export interface WarmupPlanInput {
  cls: WarmupClass;
  /** R: the first working set's target reps (per side on unilateral lifts). */
  reps: number;
  /** W: the first working set's load; null = unknown (no warm-up loads can be planned). */
  load: number | null;
  warmed: boolean;
  /** The session's first exercise (WU6's extra 50 % step). */
  firstOfSession: boolean;
  floorStart: boolean;
  /** The empty bar, when the item is a bar (WU4's bar step); null otherwise. */
  barMass: number | null;
  /** What this gym's item makes, ascending, in W's unit and convention (WU8). */
  loads: readonly number[];
  /** WU9: the lightest load with full-diameter plates, when the gym profile records it (it doesn't yet: null). */
  fullPlateStart?: number | null;
  cut?: WarmupCut;
}

const EPS = 1e-6;
const MAX_STEPS = 6;
const MAX_TOTAL_REPS = 25;
const MAX_STEP_REPS = 8;

/** WU3. */
export const heavyBand = (reps: number): boolean => reps <= 6;

type Raw = { pct: number; reps: number } | { load: number; reps: number; bar: true };

/** The class's table rows before snapping (WU4–WU7), with the cut applied. */
function rawSteps(i: WarmupPlanInput, W: number): Raw[] {
  const R = Math.max(1, Math.round(i.reps));
  const cut = i.cut ?? 'full';
  if (cut === 'none') return [];
  const cls = i.cls === 'machine' && !heavyBand(R) ? 'isolation' : i.cls;
  switch (cls) {
    case 'heavy': {
      if (!heavyBand(R)) {
        // WU5. Warmed: the 80 % step only; WU11 cut 3 drops the light step.
        const top = { pct: 0.8, reps: R >= 10 ? 5 : 4 };
        return i.warmed || cut === 'no_light' || cut === 'short' ? [top] : [{ pct: 0.5, reps: 8 }, top];
      }
      // WU4.
      if (i.warmed) return R <= 3 ? [{ pct: 0.6, reps: 3 }, { pct: 0.8, reps: 2 }, { pct: 0.875, reps: 1 }] : [{ pct: 0.6, reps: 3 }, { pct: 0.8, reps: 2 }];
      if (cut === 'short') return R <= 3 ? [{ pct: 0.5, reps: 5 }, { pct: 0.7, reps: 3 }, { pct: 0.85, reps: 1 }] : [{ pct: 0.5, reps: 5 }, { pct: 0.75, reps: 2 }];
      const ladder: Raw[] = R <= 3 ? [{ pct: 0.4, reps: 5 }, { pct: 0.6, reps: 3 }, { pct: 0.75, reps: 2 }, { pct: 0.875, reps: 1 }] : [{ pct: 0.4, reps: 5 }, { pct: 0.6, reps: 3 }, { pct: 0.8, reps: 2 }];
      const bar = i.barMass !== null && !i.floorStart && cut !== 'no_bar' && W >= 3 * i.barMass - EPS;
      return bar && i.barMass !== null ? [{ load: i.barMass, reps: 5, bar: true }, ...ladder] : ladder;
    }
    case 'secondary':
    case 'machine': {
      // WU6 (a machine compound only with R ≤ 6; above, WU7).
      if (i.warmed) return [];
      const steps: Raw[] = R >= 10 ? [{ pct: 0.8, reps: 5 }] : R >= 7 ? [{ pct: 0.8, reps: 4 }] : [{ pct: 0.6, reps: 3 }, { pct: 0.8, reps: 2 }];
      return i.firstOfSession ? [{ pct: 0.5, reps: 8 }, ...steps] : steps;
    }
    case 'isolation':
      return i.warmed ? [] : [{ pct: 0.5, reps: 8 }];
    case 'weighted_bodyweight':
    case 'bodyweight':
    case 'none':
      return [];
  }
}

/**
 * `planWarmups`: one exercise's warm-up sets (WU3–WU10), lightest first, each an achievable load on this gym's item
 * below W. Empty when W is unknown, nothing fits below W, or the class takes none.
 */
export function planWarmups(i: WarmupPlanInput): WarmupStep[] {
  const R = Math.max(1, Math.round(i.reps));
  if (i.cls === 'weighted_bodyweight') {
    // WU7: bodyweight only (no weight added) × min(5, ⌈R/2⌉).
    return i.warmed || i.cut === 'none' ? [] : [{ load: 0, reps: Math.min(5, Math.ceil(R / 2)) }];
  }
  const W = i.load;
  if (W === null || !(W > 0) || i.loads.length === 0) return [];
  const raw = rawSteps(i, W);
  if (raw.length === 0) return [];
  const ladder = [...i.loads].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const min = ladder[0];
  if (min === undefined) return [];
  /** WU8 snap down; (a) below the item's lightest → the lightest. */
  const down = (v: number): number => {
    let best = min;
    for (const l of ladder) if (l <= v + EPS) best = l;
    return best;
  };
  const below = (v: number): number | null => {
    let best: number | null = null;
    for (const l of ladder) if (l <= v + EPS) best = l;
    return best;
  };
  const above = (v: number): number | null => ladder.find((l) => l > v + EPS) ?? null;
  const heavy = heavyBand(R);
  const ladderClass = i.cls === 'heavy';
  const repBandWarmup = !heavy;

  let steps: WarmupStep[] = raw.map((r, k) => {
    if ('bar' in r) return { load: r.load, reps: r.reps };
    let v = r.pct * W;
    // WU9: the first step of a floor lift is at least the plates-on start, when the gym profile records it.
    if (k === 0 && i.floorStart && i.fullPlateStart != null) v = Math.max(v, i.fullPlateStart);
    return { load: down(v), reps: r.reps };
  });
  steps.sort((a, b) => a.load - b.load);

  // (c) the top step: ≤ 85 % of W in the rep band, ≤ 90 % in the heavy band, else the next load down.
  const cap = (heavy ? 0.9 : 0.85) * W;
  const lastOf = (): WarmupStep | undefined => steps[steps.length - 1];
  const top = lastOf();
  if (top !== undefined && top.load > cap + EPS) {
    const b = below(cap);
    if (b === null) steps.pop();
    else top.load = b;
  }
  // (d) WU4/WU5: a last step below 70 % of W goes to the next load up, if that stays within (c) and below W.
  const t2 = lastOf();
  if (ladderClass && t2 !== undefined && t2.load < 0.7 * W - EPS) {
    const up = above(t2.load);
    if (up !== null && up <= cap + EPS && up < W - EPS) t2.load = up;
  }
  steps = tidy(steps, W);
  // (f) rep band: a step before the top step at ≥ 60 % of W is dropped.
  if (repBandWarmup) steps = steps.filter((s, k) => k === steps.length - 1 || s.load < 0.6 * W - EPS);

  // WU4 gap check on snapped loads: a jump > 25 % of W (between steps, or last step → W) gets a midpoint step.
  if (ladderClass && heavy) {
    for (let guard = 0; guard < MAX_STEPS && steps.length < MAX_STEPS && steps.length > 0; guard += 1) {
      const points = [...steps.map((s) => s.load), W];
      let at = -1;
      for (let k = 1; k < points.length; k += 1) {
        if ((points[k] ?? 0) - (points[k - 1] ?? 0) > 0.25 * W + EPS) {
          at = k;
          break;
        }
      }
      if (at < 0) break;
      const lo = steps[at - 1];
      if (lo === undefined) break;
      const mid = down(((points[at - 1] ?? 0) + (points[at] ?? 0)) / 2);
      if (steps.some((s) => Math.abs(s.load - mid) < EPS) || mid >= W - EPS) break;
      steps = tidy([...steps, { load: mid, reps: lo.reps }], W);
    }
  }
  return wu10(steps, W, R, heavy);
}

/** WU8 (b) merge equal loads (larger reps, max 8) and (e) drop any step at or above W; ascending. */
function tidy(steps: readonly WarmupStep[], W: number): WarmupStep[] {
  const out: WarmupStep[] = [];
  for (const s of [...steps].sort((a, b) => a.load - b.load)) {
    if (s.load >= W - EPS) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.abs(prev.load - s.load) < EPS) prev.reps = Math.min(MAX_STEP_REPS, Math.max(prev.reps, s.reps));
    else out.push({ ...s });
  }
  return out;
}

/** WU10: ≤ 8 reps a step; above 50 % of W ≤ max(R, 5); singles only in the heavy band with R ≤ 3; ≤ 25 reps in all. */
function wu10(steps: readonly WarmupStep[], W: number, R: number, heavy: boolean): WarmupStep[] {
  const singles = heavy && R <= 3;
  let out = steps.map((s) => {
    let reps = Math.min(MAX_STEP_REPS, s.reps);
    if (s.load > 0.5 * W + EPS) reps = Math.min(reps, Math.max(R, 5));
    if (!singles) reps = Math.max(2, reps);
    return { load: s.load, reps: Math.max(1, reps) };
  });
  while (out.length > 1 && out.reduce((n, s) => n + s.reps, 0) > MAX_TOTAL_REPS) out = out.slice(1);
  return out.slice(-MAX_STEPS);
}

// ---------------------------------------------------------------------------
// Time and the session budget (WU11, WU12)

/** WU11: Σ(reps × 4 s) + 60 s between steps (the rest before the first working set is D17's). */
export const WARMUP_REP_S = 4;
export const WARMUP_REST_S = 60;
/** D17's approved warm-up allowance for the whole session. */
export const WARMUP_BUDGET_S = 600;
/** WU12's default general warm-up (3–5 min; 3 by default). */
export const GENERAL_WARMUP_MIN = 3;

export function warmupTimeS(steps: readonly WarmupStep[]): number {
  if (steps.length === 0) return 0;
  return steps.reduce((n, s) => n + s.reps * WARMUP_REP_S, 0) + WARMUP_REST_S * (steps.length - 1);
}

/** WU11: rest between warm-up steps, then before the first working set (2 min rep band, 3 min heavy band). */
export function warmupRestS(reps: number, last: boolean): number {
  if (!last) return WARMUP_REST_S;
  return heavyBand(reps) ? 180 : 120;
}

/**
 * WU12: the optional general warm-up (minutes) before the first exercise when it's a main lift or heavy compound;
 * none when cardio or a run ended ≤ 30 min ago. Never presented as injury prevention.
 */
export function generalWarmupMinutes(first: Pick<WarmupProfile, 'cls'> | null, cardioEndedMinutesAgo: number | null = null): number | null {
  if (first?.cls !== 'heavy') return null;
  if (cardioEndedMinutesAgo !== null && cardioEndedMinutesAgo >= 0 && cardioEndedMinutesAgo <= 30) return null;
  return GENERAL_WARMUP_MIN;
}

export interface SessionWarmupItem extends Omit<WarmupPlanInput, 'cut'> {
  /** Warm-ups Ben set himself (or kept): counted in the time, never cut. */
  fixedS?: number;
}

export interface SessionWarmupPlan {
  /** Each item's warm-up sets, in input order. */
  steps: WarmupStep[][];
  cuts: WarmupCut[];
  /** WU12 minutes, or null (none, or cut first). */
  generalMinutes: number | null;
  timeS: number;
  /** Even at WU11's floors the warm-ups exceed the budget (the D17 formula then drops working sets; noted behind `Why?`). */
  overBudget: boolean;
}

/**
 * `planSessionWarmups` (WU11): every exercise's warm-ups; when the session's (general warm-up included) exceed the
 * budget, cut in WU11's order, stopping once it fits: (1) the general warm-up; (2) WU6/WU7 steps, last exercise first;
 * (3) WU5's light step; (4) WU4's bar step, then its short ladder. Floors: a not-warmed heavy-band lift keeps 2 steps,
 * a not-warmed rep-band heavy compound 1.
 */
export function planSessionWarmups(items: readonly SessionWarmupItem[], opts: { budgetS?: number; generalMinutes?: number | null } = {}): SessionWarmupPlan {
  const budget = opts.budgetS ?? WARMUP_BUDGET_S;
  const cuts: WarmupCut[] = items.map(() => 'full');
  let general = opts.generalMinutes ?? null;
  const stepsOf = (k: number): WarmupStep[] => {
    const it = items[k];
    return it === undefined ? [] : planWarmups({ ...it, cut: cuts[k] ?? 'full' });
  };
  const steps = items.map((_, k) => stepsOf(k));
  const fixed = items.reduce((n, it) => n + (it.fixedS ?? 0), 0);
  const total = (): number => fixed + (general ?? 0) * 60 + steps.reduce((n, s) => n + warmupTimeS(s), 0);
  const fits = (): boolean => total() <= budget;
  const order = items.map((_, k) => k).reverse();
  const tryCut = (k: number, cut: WarmupCut): void => {
    if (fits()) return;
    cuts[k] = cut;
    steps[k] = stepsOf(k);
  };
  if (!fits()) general = null;
  // (2) WU6/WU7, last exercise first.
  for (const k of order) {
    const c = items[k]?.cls;
    if (c === 'secondary' || c === 'machine' || c === 'isolation' || c === 'weighted_bodyweight') tryCut(k, 'none');
  }
  // (3) WU5's light step.
  for (const k of order) {
    const it = items[k];
    if (it?.cls === 'heavy' && !heavyBand(it.reps) && !it.warmed) tryCut(k, 'no_light');
  }
  // (4) WU4: the bar step, then the short ladder.
  for (const k of order) {
    const it = items[k];
    if (it?.cls === 'heavy' && heavyBand(it.reps) && !it.warmed) tryCut(k, 'no_bar');
  }
  for (const k of order) {
    const it = items[k];
    if (it?.cls === 'heavy' && heavyBand(it.reps) && !it.warmed) tryCut(k, 'short');
  }
  return { steps, cuts, generalMinutes: general, timeS: total(), overBudget: !fits() };
}

/**
 * `fitWarmupCount`: `n` warm-up loads for a fixed count of warm-ups (a saved workout's, the coach's when Ben asked
 * for a number): the planner's heaviest `n` steps (WU11 cuts the light ones first), and when it has fewer, the
 * rest fill the biggest gaps below W on the same loads (`gapFill`). Lightest first.
 */
export function fitWarmupCount(full: readonly WarmupStep[], n: number, W: number, loads: readonly number[]): WarmupStep[] {
  if (n <= 0) return [];
  const out = full.slice(Math.max(0, full.length - n)).map((s) => ({ ...s }));
  while (out.length < n) {
    const gap = gapFill(out, W, loads);
    if (gap === null) break;
    out.push(gap);
    out.sort((a, b) => a.load - b.load);
  }
  return out;
}

/** The middle of the biggest gap from 0 through the steps up to W, snapped down (WU8), with WU10-safe reps. */
function gapFill(steps: readonly WarmupStep[], W: number, loads: readonly number[]): WarmupStep | null {
  const points = [0, ...steps.map((s) => s.load), W];
  let best: [number, number] | null = null;
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1] ?? 0;
    const b = points[k] ?? 0;
    if (best === null || b - a > best[1] - best[0]) best = [a, b];
  }
  if (best === null) return null;
  const mid = (best[0] + best[1]) / 2;
  let v: number | null = null;
  for (const l of [...loads].sort((x, y) => x - y)) if (l <= mid + EPS) v = l;
  if (v === null || v <= best[0] + EPS || v >= best[1] - EPS) return null;
  const pct = v / W;
  return { load: v, reps: pct < 0.5 ? 8 : pct < 0.7 ? 5 : 3 };
}

/** A nominal working load and a fine ladder: the table's shape before any gym's loads are known. */
const SHAPE_W = 100;
const SHAPE_LOADS: readonly number[] = Array.from({ length: 2 * SHAPE_W + 1 }, (_, k) => k / 2);

/**
 * `warmupShape`: the reps of each warm-up the planner gives an exercise before its working load is known (a
 * coach-built workout is planned before Start fits its loads): the table's steps on a nominal load (`bar`: a
 * barbell's empty-bar step, assumed to fit). With `count` (Ben asked the coach for a number), that many, as
 * `fitWarmupCount` picks them. Start then plans the loads, and reps again, on the gym's real loads.
 */
export function warmupShape(i: Omit<WarmupPlanInput, 'load' | 'loads' | 'barMass' | 'cut'> & { bar: boolean }, count: number | null = null): number[] {
  const full = planWarmups({ ...i, load: SHAPE_W, loads: SHAPE_LOADS, barMass: i.bar ? SHAPE_W / 5 : null });
  const steps = count === null ? full : fitWarmupCount(full, count, SHAPE_W, SHAPE_LOADS);
  return steps.map((s) => s.reps);
}
