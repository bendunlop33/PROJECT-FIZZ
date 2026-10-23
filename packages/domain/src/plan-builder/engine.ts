import type { PlanBuilderAnswers, PlanGroup, PlanSplit, PlanTarget, PlanWarmups } from '@fizz/schemas';
import { inKitUnit, kitAbove, kitBelow, kitDown, kitHasFormula, pbBackOff, pbMainLine, pbWarmUp, pbWeekOneTop, type PbWarmupSet, type PlanKit } from './loads';
import { generalWarmupMinutes, isWarmed, planSessionWarmupsAs, warmupProfileOf, type SessionWarmupItem, type WarmupExerciseFacts, type WarmupProfile } from '../warmup/plan';
import { pbLiftStart, type PbHistoryOf, type PbKitOf, type PbLiftStart } from './lifts';
import {
  PB_COMPAT,
  PB_CORE,
  PB_CYCLES,
  PB_EFFORT,
  PB_ELIG,
  PB_EX,
  PB_GROUPS,
  PB_HEAVY,
  PB_IND,
  PB_LEG_MUSCLES,
  PB_LEGGY_DAYS,
  PB_LEGGY_SPORTS,
  PB_MAIN_A,
  PB_MAIN_ALT,
  PB_MAIN_B,
  PB_MUSCLES,
  PB_OWN,
  PB_PREF_DAYS,
  PB_PREF_QUESTIONS,
  PB_PRIOR,
  PB_SEC,
  PB_SPLIT_MIN_DAYS,
  PB_SPORT_BANDS,
  PB_TAG_OF,
  type PbDayType,
  type PbExerciseDef,
  type PbMuscle,
  type PbRole,
} from './tables';

/**
 * The plan engine (plan-builder.md §2; the prototype's `build()`), deterministic and offline: the same answers and
 * records always give the same plan. Pure. Steps:
 *
 * 1. Split from the sessions and the split (✦: Profile's when it fits, else by sessions); no heavy legs the day
 *    before a long run or a leg-heavy ★ sport; a repeated day type is an A/B pair.
 * 2. Main lift first on each day (likes, nevers and the gym decide which), week 1 from the 6-rep estimate (D6) with
 *    D4 back-offs.
 * 3. Weekly sets per muscle placed in tiers into days with room (priorities on 2 days → every muscle 2 sets →
 *    priorities and targets to their range → abs → the rest to their range → priorities to the top → the rest to
 *    their aim), at most 8 sets of a muscle a session, borrowing a compatible day for a priority; a top-up pass after.
 * 4. Sets become exercises of 2–4 sets, ranked by the preference score (default × 5 + his rate × his sessions) ÷
 *    (5 + his sessions), so A and B days differ; supersets pair accessories, never the main lift or heavy compounds.
 *
 * 5. (Ben, 23 Oct) Each day's set capacity is the session length less that day's own warm-ups (the shared WU1–WU12
 *    planner over its exercises in order, with the general warm-up when the rules give one, under the plan's Warm-ups
 *    setting) less ~3 min a working set (2.3 with supersets). Choosing exercises changes the warm-ups, so the build
 *    repeats with each day's capacity lowered to what fits until every day fits (bounded, deterministic).
 *
 * Every load is one of the gym's achievable loads for that exercise (rule 4); an exercise held for pain or not usable
 * at the gym is never planned (rule 9).
 */

export interface PlanEngineInput {
  answers: PlanBuilderAnswers;
  /** Profile › Split, for the ✦ split when it fits the sessions; null: none (or Custom). */
  profileSplit: 'ppl' | 'body' | null;
  /** The exercise's item at the selected gym; `bodyweight`: usable with no load; null: not usable here. */
  kitOf: PbKitOf;
  historyOf: PbHistoryOf;
  /** Exercises held for pain (rule 9): never planned. */
  painHeld?: ReadonlySet<string>;
  /** The exercise's catalogue facts for the shared warm-up planner (WU9 floor start); absent: from the key. */
  factsOf?: (key: string) => WarmupExerciseFacts | null;
  nowMs: number;
}

export type PbLoad =
  | { kind: 'kg'; value: number; unit: PlanKit['unit']; convention: PlanKit['convention']; equipmentId: string }
  | { kind: 'bodyweight' }
  | { kind: 'none' };

export interface PbMainPlan {
  top: number | null;
  back: number | null;
  /** Top set reps (Strength 5, else 6). */
  reps: number;
  backs: number;
  backReps: number;
  /** Week 1 is an estimate (est.) or a step lighter. */
  estimate: boolean;
  light: boolean;
  start: PbLiftStart | null;
  warmup: PbWarmupSet[];
}

export interface PbExercise {
  key: string;
  muscle: PbMuscle;
  role: 'main' | PbRole;
  tags: PlanTarget[];
  /** Working sets (main: top + back-offs). */
  sets: number;
  /** Working reps (main: the top set's). */
  reps: number;
  load: PbLoad;
  /** Bodyweight main lift: sets of reps, adding reps week to week. */
  bodyweightMain: boolean;
  main: PbMainPlan | null;
  /** The load has no history of his own behind it (rule 6). */
  estimate: boolean;
  /** Superset label (`A1`, `A2` …), else null. */
  pair: string | null;
  /** `Last time 90 × 12`, `No history yet`: Why? only. */
  why: string;
}

export interface PbDay {
  index: number;
  /** Mon = 0; null on Any days. */
  weekday: number | null;
  focus: PbDayType;
  variant: 'A' | 'B' | null;
  /** Moved off the day before a hard leg session. */
  moved: boolean;
  exercises: PbExercise[];
  /** Working sets this day fits: the session length less this day's warm-ups, ~3 min a set (2.3 with supersets). */
  cap: number;
  /** (Ben, 23 Oct) This day's planned warm-up time (seconds), general warm-up included, under the Warm-ups setting. */
  warmupS: number;
  /** The day's estimated minutes: its warm-ups plus its working sets. */
  minutes: number;
}

export interface PbPlan {
  split: PlanSplit;
  days: PbDay[];
  abs: number;
  /** Sets per week, half sets for indirect work, floored (§2). */
  weekly: Partial<Record<PbMuscle, number>>;
  /** Each counted muscle's range. */
  ranges: Partial<Record<PbMuscle, readonly [number, number]>>;
  /** Muscles below their range (↓): shown, never hidden. */
  short: PbMuscle[];
  /** Where the cycle continues next week (`Rotates · next week starts Legs`); null on a whole cycle. */
  nextWeekStarts: PbDayType | null;
  /** Exercises left out for pain (rule 9). */
  heldForPain: string[];
}

// ---------------------------------------------------------------------------
// Answers → numbers

/** The ✦ split for a number of sessions: Profile's when it fits, else 2 Full body, 3–4 Upper/Lower, 5–7 PPL. */
export function pbSuggestedSplit(sessions: number, profileSplit: 'ppl' | 'body' | null): PlanSplit {
  if (profileSplit !== null && sessions >= PB_SPLIT_MIN_DAYS[profileSplit]) return profileSplit;
  return sessions <= 2 ? 'full' : sessions <= 4 ? 'ul' : 'ppl';
}

export function pbSplitOf(split: PlanSplit, n: number): PbDayType[] {
  const c = PB_CYCLES[split];
  if (split === 'body' && n < 4) return Array.from({ length: n }, () => 'Full body' as const);
  return Array.from({ length: n }, (_, i) => c[i % c.length] ?? 'Full body');
}

/** The day next week starts with, when the week ends mid-cycle. */
export function pbNextWeekStarts(split: PlanSplit, n: number): PbDayType | null {
  const c = PB_CYCLES[split];
  if (n % c.length === 0 || (split === 'body' && n < 4)) return null;
  return c[n % c.length] ?? null;
}

/** Ab sets a week: 10 by default, 14 with Core as a priority or a Fitness focus, 6 on Maintain. */
export function pbAbsAuto(a: Pick<PlanBuilderAnswers, 'effort' | 'priorities' | 'focus'>): number {
  return a.effort === 'maintain' ? 6 : a.priorities.includes('Core') || a.focus === 'fitness' ? 14 : 10;
}

export const pbTargetAim = (a: Pick<PlanBuilderAnswers, 'effort'>): number => (a.effort === 'maintain' ? 4 : a.effort === 'push' ? 8 : 6);

/** Minutes a working set takes with its rest: ~3, 2.3 with supersets (the rest before the first working set included, WU11). */
export const pbSetMinutes = (a: Pick<PlanBuilderAnswers, 'supersets'>): number => (a.supersets ? 2.3 : 3);

/**
 * Working sets that fit a session (Ben, 23 Oct): the session length less that day's warm-up time (`warmupS`, from the
 * day's own warm-ups; no longer a flat 8 minutes), ~3 min a set with rest (2.3 with supersets); at least 2.
 */
export const pbCapSets = (a: Pick<PlanBuilderAnswers, 'minutes' | 'supersets'>, warmupS: number): number => Math.max(2, Math.floor((a.minutes - Math.max(0, warmupS) / 60) / pbSetMinutes(a) + 1e-9));

/** The plan's Warm-ups setting; absent (a plan built before it): `full`. */
export const pbWarmups = (a: Pick<PlanBuilderAnswers, 'warmups'>): PlanWarmups => a.warmups ?? 'full';

const starred = (a: PlanBuilderAnswers): string[] => a.other.filter((o) => o.star).map((o) => o.sport);

const isPri = (a: PlanBuilderAnswers, m: PbMuscle): boolean => a.priorities.some((g: PlanGroup) => PB_GROUPS[g].includes(m));
const isSpec = (a: PlanBuilderAnswers, m: string): boolean => (a.specific as readonly string[]).includes(m);

/** A muscle's weekly range (§2; GA6 with ★ sports). */
export function pbRange(a: PlanBuilderAnswers, m: PbMuscle): readonly [number, number] {
  if ((PB_OWN as readonly string[]).includes(m)) {
    const t = pbTargetAim(a);
    return [t - 2, t + 2];
  }
  if (m === 'Core') {
    const t = pbAbsAuto(a);
    return [t - 2, t + 2];
  }
  const e = starred(a).length > 0 && a.effort !== 'maintain' ? PB_SPORT_BANDS : PB_EFFORT[a.effort];
  if (m === 'Calves' || m === 'Biceps' || m === 'Triceps') return isPri(a, m) ? [e.sm[0] + 4, e.sm[1] + 4] : e.sm;
  return isPri(a, m) ? e.pri : e.oth;
}

/** A priority aims at the top; with a priority picked the rest sit at the bottom; with none, a little above it. */
function aimFor(a: PlanBuilderAnswers, m: PbMuscle): number {
  if ((PB_OWN as readonly string[]).includes(m)) return isSpec(a, m) ? pbTargetAim(a) : 0;
  const [lo, hi] = pbRange(a, m);
  if (isPri(a, m)) return hi;
  return a.priorities.length > 0 ? lo : Math.round(lo + (hi - lo) * 0.35);
}

/** The muscles shown in Sets per week: the nine, plus Glutes, Adductors, Abductors, Forearms when targeted. */
export function pbChartMuscles(a: PlanBuilderAnswers): PbMuscle[] {
  return [...PB_MUSCLES, ...PB_OWN.filter((m) => isSpec(a, m))];
}

// ---------------------------------------------------------------------------
// Preferences

export function pbPrefLikes(a: PlanBuilderAnswers): string[] {
  const out = [...a.likes];
  for (const [id, ans] of Object.entries(a.prefs)) {
    const q = PB_PREF_QUESTIONS.find((x) => x.id === id);
    if (q === undefined || ans === 'either') continue;
    if (typeof ans === 'object') out.push(ans.other);
    else out.push(...q.opts[ans]);
  }
  return out;
}

function prefLosers(a: PlanBuilderAnswers): Set<string> {
  const out = new Set<string>();
  for (const [id, ans] of Object.entries(a.prefs)) {
    const q = PB_PREF_QUESTIONS.find((x) => x.id === id);
    if (q === undefined || ans === 'either') continue;
    q.opts.forEach((o, j) => {
      if (j !== ans) for (const k of o) out.add(k);
    });
  }
  return out;
}

/** Sessions of his own before his evidence and the default weigh the same. */
export const PB_PREF_K = 5;

/**
 * The preference score (§2): never → −1; a like → 2; the listed option he didn't pick → 0.01; else (default × 5 +
 * his rate × his sessions) ÷ (5 + his sessions), his rate = sessions ÷ (sessions + skips).
 */
export function pbPrefScore(key: string, a: PlanBuilderAnswers, historyOf: PbHistoryOf, likes: readonly string[] = pbPrefLikes(a), losers: ReadonlySet<string> = prefLosers(a)): number {
  if (a.never.includes(key)) return -1;
  if (likes.includes(key)) return 2;
  if (losers.has(key)) return 0.01;
  const h = historyOf(key);
  const uses = h?.sessions ?? 0;
  const skips = h?.skips ?? 0;
  const prior = PB_PRIOR[key] ?? 0.5;
  const mine = uses + skips > 0 ? uses / (uses + skips) : 0;
  return (prior * PB_PREF_K + mine * (uses + skips)) / (PB_PREF_K + uses + skips);
}

/** ✦ on a preference question: the option his history favours most, when he has history on any of them. */
export function pbPrefSuggestion(qId: string, historyOf: PbHistoryOf): 0 | 1 | null {
  const q = PB_PREF_QUESTIONS.find((x) => x.id === qId);
  if (q === undefined) return null;
  const sc = q.opts.map((o) => Math.max(...o.map((k) => historyOf(k)?.sessions ?? 0)));
  const best = Math.max(...sc);
  if (!(best > 0)) return null;
  return sc.indexOf(best) === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Days

/** The plan's weekdays: Set days as picked (when they match the sessions), else the usual days for the count. */
export function pbPlanDays(a: Pick<PlanBuilderAnswers, 'schedule' | 'days' | 'sessions'>): number[] {
  if (a.schedule === 'set' && a.days.length === a.sessions) return [...new Set(a.days)].sort((x, y) => x - y);
  return [...(PB_PREF_DAYS[a.sessions] ?? PB_PREF_DAYS[4] ?? [])];
}

/** Days before which heavy legs stay off: the long run (or every run with ★ Running), and leg-heavy or ★ sports. */
function blockedDays(a: PlanBuilderAnswers): Set<number> {
  const hard: number[] = [];
  for (const o of a.other) {
    if (o.sport === 'Running') hard.push(...(o.star ? o.days : [o.longRunDay ?? o.days.at(-1) ?? 6]));
    else if (PB_LEGGY_SPORTS.has(o.sport) || o.star) hard.push(...o.days);
  }
  return new Set(hard.map((d) => (d + 6) % 7));
}

// ---------------------------------------------------------------------------
// The build

interface WorkDay extends Omit<PbDay, 'cap' | 'warmupS' | 'minutes'> {
  load: number;
}

/** Rounds of the capacity loop: each lowers at least one day's capacity, so it ends well before this. */
const PB_CAP_ROUNDS = 8;

export function buildPlanFromAnswers(input: PlanEngineInput): PbPlan {
  const a = input.answers;
  const n = pbPlanDays(a).length;
  // Start from no warm-ups (the most each day could fit); lower each day to what fits with its own warm-ups.
  let caps = Array.from({ length: n }, () => pbCapSets(a, 0));
  let built = buildWithCaps(input, caps);
  let warm = built.days.map((d) => pbDayWarmups(d, a, input));
  for (let round = 1; round < PB_CAP_ROUNDS; round += 1) {
    const fit = warm.map((w) => pbCapSets(a, w.timeS));
    if (fit.every((c, i) => c >= (caps[i] ?? 0))) break;
    caps = caps.map((c, i) => Math.min(c, fit[i] ?? c));
    built = buildWithCaps(input, caps);
    warm = built.days.map((d) => pbDayWarmups(d, a, input));
  }
  const perSet = pbSetMinutes(a);
  return {
    ...built,
    days: built.days.map((d, i) => {
      const w = warm[i];
      const warmupS = w?.timeS ?? 0;
      const sets = d.exercises.reduce((t, e) => t + e.sets, 0);
      // The main lift's warm-ups as the day plans them (its place, the day's budget, the Warm-ups setting).
      const exercises = d.exercises.map((e, k) => (e.role !== 'main' || e.main === null || w === undefined ? e : { ...e, main: { ...e.main, warmup: w.mainSteps(k) ?? e.main.warmup } }));
      return { ...d, exercises, cap: caps[i] ?? pbCapSets(a, warmupS), warmupS, minutes: Math.round(warmupS / 60 + sets * perSet) };
    }),
  };
}

/** One build at fixed per-day capacities (`caps[day index]`). */
function buildWithCaps(input: PlanEngineInput, caps: readonly number[]): Omit<PbPlan, 'days'> & { days: Omit<PbDay, 'cap' | 'warmupS' | 'minutes'>[] } {
  const a = input.answers;
  const pain = input.painHeld ?? new Set<string>();
  const heldForPain = new Set<string>();
  const usable = (key: string): boolean => {
    if (pain.has(key)) {
      heldForPain.add(key);
      return false;
    }
    return input.kitOf(key) !== null;
  };
  const likes = pbPrefLikes(a);
  const losers = prefLosers(a);
  const score = (key: string): number => pbPrefScore(key, a, input.historyOf, likes, losers);
  const ranked = (list: readonly PbExerciseDef[]): PbExerciseDef[] => list.filter((d) => score(d.key) >= 0 && usable(d.key)).sort((x, y) => score(y.key) - score(x.key));

  const split = a.split ?? pbSuggestedSplit(a.sessions, input.profileSplit);
  const weekdays = pbPlanDays(a);
  const names = pbSplitOf(split, weekdays.length);
  const flexible = a.schedule !== 'set';
  const plan: WorkDay[] = weekdays.map((d, i) => ({ index: i, weekday: flexible ? null : d, focus: names[i] ?? 'Full body', variant: null, moved: false, exercises: [], load: 0 }));

  // No heavy legs the day before a long run or a leg-heavy session: swap with a non-leg day. On Any days the usual
  // days stand in for the week (the order still matters).
  const blocked = blockedDays(a);
  const dayOf = (p: WorkDay): number => weekdays[p.index] ?? p.index;
  for (const before of blocked) {
    const legs = plan.find((p) => dayOf(p) === before && PB_LEGGY_DAYS.includes(p.focus));
    const other = plan.find((p) => !blocked.has(dayOf(p)) && !PB_LEGGY_DAYS.includes(p.focus));
    if (legs !== undefined && other !== undefined) {
      const f = legs.focus;
      legs.focus = other.focus;
      other.focus = f;
      legs.moved = true;
    }
  }

  // A/B variations when a day type repeats.
  const seen = new Map<PbDayType, number>();
  for (const p of plan) {
    const n = (seen.get(p.focus) ?? 0) + 1;
    seen.set(p.focus, n);
    const repeats = plan.filter((q) => q.focus === p.focus).length > 1;
    p.variant = PB_MAIN_B[p.focus] !== undefined && repeats ? (n > 1 ? 'B' : 'A') : null;
  }

  const strength = a.focus === 'strength';
  const effortBacks = (a.effort === 'push' ? 1 : 0) - (a.effort === 'maintain' ? 1 : 0);

  const mkMain = (key: string, muscle: PbMuscle): PbExercise => {
    const kit = input.kitOf(key);
    const h = input.historyOf(key);
    if (kit === 'bodyweight' || kit === null || !kitHasFormula(kit)) {
      // Bodyweight (or assisted / added weight) main lift: sets of reps, adding reps week to week.
      const backs = 2 + effortBacks;
      const reps = h?.last?.reps ?? 8;
      const load: PbLoad = kit === null || kit === 'bodyweight' ? { kind: 'bodyweight' } : lastLoadOn(kit, h);
      return { key, muscle, role: 'main', tags: [], sets: backs + 1, reps, load, bodyweightMain: true, main: null, estimate: h?.last == null, pair: null, why: whyOf(h) };
    }
    const start = pbLiftStart(key, input.kitOf, input.historyOf, a.lifts[key], input.nowMs);
    const reps = strength ? 5 : 6;
    const backs = (strength ? 3 : 2) + effortBacks;
    const top = start?.six == null ? null : pbWeekOneTop(kit, start.six, start.light);
    const bo = top === null ? null : pbBackOff(kit, top, reps, 8, a.focus);
    const main: PbMainPlan = { top, back: bo?.back ?? null, reps, backs, backReps: bo?.reps ?? 8, estimate: start?.estimate ?? false, light: start?.light ?? false, start, warmup: top === null ? [] : pbWarmUp(kit, key, top, reps, input.factsOf?.(key) ?? null) };
    const load: PbLoad = top === null ? { kind: 'none' } : { kind: 'kg', value: top, unit: kit.unit, convention: kit.convention, equipmentId: kit.equipmentId };
    return { key, muscle, role: 'main', tags: [], sets: backs + 1, reps, load, bodyweightMain: false, main, estimate: start?.estimate ?? true, pair: null, why: whyOf(h, start) };
  };

  const mkAcc = (key: string, muscle: PbMuscle, role: PbRole, sets: number, tags: readonly PlanTarget[]): PbExercise => {
    const kit = input.kitOf(key);
    const h = input.historyOf(key);
    const lastReps = h?.last?.reps ?? (role === 'c' ? 8 : 12);
    const reps = Math.max(8, Math.min(15, lastReps));
    let load: PbLoad = kit === 'bodyweight' || kit === null ? { kind: 'bodyweight' } : lastLoadOn(kit, h);
    // 15+ reps last time: one achievable step harder (rule 4: never past the item's max; assisted: less assistance).
    if (load.kind === 'kg' && kit !== null && kit !== 'bodyweight' && lastReps >= 15) {
      const up = kit.convention === 'assistance' ? kitBelow(kit, load.value) : kitAbove(kit, load.value);
      if (up !== null) load = { ...load, value: up };
    }
    return { key, muscle, role, tags: [...tags], sets, reps, load, bodyweightMain: false, main: null, estimate: load.kind === 'none', pair: null, why: whyOf(h) };
  };

  const mainOf = (focus: PbDayType, variant: 'A' | 'B' | null): { key: string; muscle: PbMuscle } | null => {
    const mn = (variant === 'B' ? PB_MAIN_B[focus] : undefined) ?? PB_MAIN_A[focus];
    if (mn === null) return null;
    const alts = (PB_MAIN_ALT[mn.key] ?? []).filter((k) => !a.never.includes(k) && usable(k));
    const liked = alts.find((k) => likes.includes(k));
    if (liked !== undefined && !likes.includes(mn.key)) return { key: liked, muscle: mn.muscle };
    if (a.never.includes(mn.key) || !usable(mn.key)) return alts[0] === undefined ? null : { key: alts[0], muscle: mn.muscle };
    return mn;
  };

  for (const p of plan) {
    const mn = mainOf(p.focus, p.variant);
    p.exercises = mn === null ? [] : [mkMain(mn.key, mn.muscle)];
    p.load = p.exercises.reduce((s, e) => s + e.sets, 0);
  }

  const T = Math.max(a.abs ?? pbAbsAuto(a), isSpec(a, 'Obliques') ? pbTargetAim(a) : 0);
  const capOf = (d: Pick<WorkDay, 'index'>): number => caps[d.index] ?? 2;

  // Sets placed per (day, muscle, tag).
  const cnt = new Map<string, number>();
  const key = (d: WorkDay, m: PbMuscle, t = ''): string => `${String(d.index)}|${m}|${t}`;
  for (const d of plan) for (const e of d.exercises) cnt.set(key(d, e.muscle), (cnt.get(key(d, e.muscle)) ?? 0) + e.sets);
  const onDay = (d: WorkDay, m: PbMuscle): number => {
    let s = 0;
    for (const [k, v] of cnt) if (k.startsWith(`${String(d.index)}|${m}|`)) s += v;
    return s;
  };
  const direct = (m: PbMuscle, t: string | null): number => {
    let s = 0;
    for (const [k, v] of cnt) {
      const [, mm, tt] = k.split('|');
      if (mm === m && (t === null || tt === t)) s += v;
    }
    return s;
  };
  const total = (m: PbMuscle, t: string | null): number => direct(m, t) + (t === null ? (PB_IND[m] ?? []).reduce((s, [src, f]) => s + direct(src, null) * f, 0) : 0);
  const compatRank = (m: PbMuscle, focus: PbDayType): number => {
    const l = PB_LEG_MUSCLES.includes(m) ? (['Legs', 'Lower', 'Full body'] as const) : (PB_COMPAT[m] ?? []);
    const i = l.indexOf(focus);
    return i < 0 ? 99 : i;
  };
  const prioritised = (m: PbMuscle): boolean => isPri(a, m) || isSpec(a, m);
  const daysFor = (m: PbMuscle, need2: boolean): WorkDay[] => {
    const E = plan.filter((p) => PB_ELIG[p.focus].includes(m));
    const want = need2 && plan.length >= 2 ? 2 : 1;
    while (E.length < want) {
      const extra = plan
        .filter((p) => !E.includes(p) && !(PB_LEG_MUSCLES.includes(m) && blocked.has(dayOf(p))))
        .sort((x, y) => compatRank(m, x.focus) - compatRank(m, y.focus) || x.load - y.load)[0];
      if (extra === undefined) break;
      E.push(extra);
    }
    return E;
  };
  const muscles: PbMuscle[] = [...PB_MUSCLES.filter((m) => m !== 'Core'), ...PB_OWN.filter((m) => isSpec(a, m))];
  const D = new Map<PbMuscle, WorkDay[]>(muscles.map((m) => [m, daysFor(m, prioritised(m) || a.specific.some((t) => PB_TAG_OF[t] === m))]));
  D.set('Core', plan);
  const mainOn = (d: WorkDay, m: PbMuscle): number => d.exercises.filter((e) => e.role === 'main' && e.muscle === m).reduce((s, e) => s + e.sets, 0);

  const place = (m: PbMuscle, t: string | null, upto: number, onlyDays?: readonly WorkDay[]): void => {
    for (let guard = 0; guard < 60 && total(m, t) < upto; guard += 1) {
      if (onlyDays !== undefined) {
        const d = onlyDays.find((x) => (cnt.get(key(x, m, t ?? '')) ?? 0) - (t !== null ? 0 : mainOn(x, m)) <= 0 && capOf(x) - x.load >= 2);
        if (d === undefined) return;
        const k = key(d, m, t ?? '');
        cnt.set(k, (cnt.get(k) ?? 0) + 2);
        d.load += 2;
        continue;
      }
      const days = D.get(m) ?? [];
      const opts = days
        .map((d) => {
          const has = (cnt.get(key(d, m, t ?? '')) ?? 0) - (t !== null ? 0 : mainOn(d, m));
          const unit = has > 0 ? 1 : 2;
          return { d, unit, room: capOf(d) - d.load };
        })
        .filter((o) => o.room >= o.unit && onDay(o.d, m) + o.unit <= 8)
        .sort((x, y) => (m === 'Core' ? y.room - x.room || onDay(x.d, m) - onDay(y.d, m) : onDay(x.d, m) - onDay(y.d, m) || y.room - x.room));
      // A priority whose own days are full borrows the most compatible, then lightest, other day (up to 3 days).
      if (opts.length === 0 && prioritised(m) && days.length < Math.min(3, plan.length)) {
        const extra = plan
          .filter((p) => !days.includes(p) && !(PB_LEG_MUSCLES.includes(m) && blocked.has(dayOf(p))) && capOf(p) - p.load >= 2)
          .sort((x, y) => compatRank(m, x.focus) - compatRank(m, y.focus) || x.load - y.load)[0];
        if (extra !== undefined) {
          D.set(m, [...days, extra]);
          continue;
        }
      }
      const o = opts[0];
      if (o === undefined) return;
      const k = key(o.d, m, t ?? '');
      cnt.set(k, (cnt.get(k) ?? 0) + o.unit);
      o.d.load += o.unit;
    }
  };

  const small = (m: PbMuscle): boolean => m === 'Calves' || m === 'Biceps' || m === 'Triceps' || (PB_OWN as readonly string[]).includes(m);
  const order = [...muscles].sort((x, y) => (prioritised(y) ? 1 : 0) - (prioritised(x) ? 1 : 0));
  const tagTs = a.specific.filter((t) => PB_TAG_OF[t] !== undefined);
  const rangeLo = (m: PbMuscle): number => pbRange(a, m)[0];
  for (const m of order.filter(prioritised)) place(m, null, 99, (D.get(m) ?? []).slice(0, 2)); // 0 priorities on 2 days
  for (const m of order) place(m, null, Math.min(rangeLo(m), 2)); // 1 every muscle 2 sets
  for (const t of tagTs) {
    const m = PB_TAG_OF[t];
    if (m !== undefined) place(m, t, pbTargetAim(a)); // 2 specific targets
  }
  for (const m of order.filter(prioritised)) place(m, null, (PB_OWN as readonly string[]).includes(m) ? pbTargetAim(a) : rangeLo(m));
  place('Core', null, T); // 3 abs
  for (const m of order.filter((x) => !prioritised(x))) place(m, null, Math.min(rangeLo(m), small(m) ? 2 : 4));
  for (const m of order.filter((x) => !prioritised(x))) place(m, null, rangeLo(m)); // 4
  for (const m of order.filter((x) => isPri(a, x))) place(m, null, aimFor(a, m)); // 5
  for (const m of order.filter((x) => !prioritised(x))) place(m, null, aimFor(a, m)); // 6

  // Sets → exercises of 2–4 sets, rotating each muscle's list so repeat days differ.
  const MAX_EX = 10;
  const seenM = new Map<string, number>();
  const add = (d: WorkDay, m: PbMuscle, def: PbExerciseDef, sets: number): void => {
    const ex = d.exercises.find((e) => e.key === def.key);
    if (ex !== undefined) {
      ex.sets = Math.min(10, ex.sets + sets);
      return;
    }
    if (d.exercises.length >= MAX_EX) {
      const same = d.exercises.find((e) => e.muscle === m && e.role !== 'main');
      if (same !== undefined) same.sets = Math.min(10, same.sets + sets);
      return;
    }
    d.exercises.push(mkAcc(def.key, m, def.role, sets, def.tags ?? []));
  };
  const coreDefs = (): [string, string] => (isSpec(a, 'Obliques') ? [PB_CORE.woodchop, PB_CORE.crunch] : [PB_CORE.crunch, PB_CORE.legRaise]);
  for (const d of plan) {
    const entries = [...cnt].filter(([k]) => k.startsWith(`${String(d.index)}|`)).sort(([x], [y]) => (y.split('|')[2] ? 1 : 0) - (x.split('|')[2] ? 1 : 0));
    for (const [k, v] of entries) {
      const [, mRaw, tRaw] = k.split('|');
      const m = mRaw as PbMuscle;
      const t = tRaw === '' || tRaw === undefined ? null : (tRaw as PlanTarget);
      if (m === 'Core') {
        const [c0, c1] = coreDefs();
        const usableCore = [c0, c1].filter((x) => usable(x) && score(x) >= 0);
        const first = isSpec(a, 'Obliques') ? usableCore[0] : usableCore[d.index % Math.max(1, usableCore.length)];
        const second = usableCore.find((x) => x !== first);
        if (first === undefined) continue;
        const tg = (n: string): PlanTarget[] => (n === PB_CORE.woodchop ? ['Obliques'] : []);
        const parts: [string, number][] = v <= 3 || second === undefined ? [[first, Math.max(2, Math.min(v, 4))]] : [[first, Math.ceil(v / 2)], [second, Math.floor(v / 2)]];
        for (const [n, st] of parts) if (d.exercises.length < MAX_EX) d.exercises.push(mkAcc(n, 'Core', 'i', st, tg(n)));
        continue;
      }
      const main = d.exercises.find((e) => e.role === 'main' && e.muscle === m);
      const s = v - (main !== undefined && t === null ? main.sets : 0);
      if (s <= 0) continue;
      const list = ranked(exOf(m)).filter((x) => !(x.skip ?? []).includes(d.focus) && (t === null || (x.tags ?? []).includes(t)));
      if (list.length === 0) continue;
      const sk = m + (t ?? '');
      const occ = (seenM.get(sk) ?? -1) + 1;
      seenM.set(sk, occ);
      const start = occ % Math.min(2, list.length);
      const rot = [...list.slice(start), ...list.slice(0, start)];
      chunks(s).forEach((c, j) => {
        const def = rot.find((x) => !d.exercises.some((e) => e.key === x.key)) ?? rot[j % rot.length];
        if (def !== undefined) add(d, m, def, c);
      });
    }
    sortDay(a, d);
  }

  // Top-up: a muscle still below its range takes a set wherever a day has room.
  const daySets = (d: WorkDay): number => d.exercises.reduce((s, e) => s + e.sets, 0);
  const chart = pbChartMuscles(a);
  for (let guard = 0; guard < 40; guard += 1) {
    const ws = weeklySetsOf(plan, chart);
    const m = chart.filter((x) => x !== 'Core' && (ws[x] ?? 0) < pbRange(a, x)[0]).sort((x, y) => (ws[x] ?? 0) - pbRange(a, x)[0] - ((ws[y] ?? 0) - pbRange(a, y)[0]))[0];
    if (m === undefined) break;
    const hit = plan
      .flatMap((d) => d.exercises.filter((e) => e.muscle === m && e.role !== 'main' && e.sets < 4 && daySets(d) < capOf(d)).map((e) => [d, e] as const))
      .sort(([x], [y]) => daySets(x) - daySets(y))[0];
    if (hit !== undefined) {
      hit[1].sets += 1;
      continue;
    }
    const d = (D.get(m) ?? []).filter((x) => capOf(x) - daySets(x) >= 2 && x.exercises.length < MAX_EX).sort((x, y) => daySets(x) - daySets(y))[0];
    const def = d === undefined ? undefined : ranked(exOf(m)).find((x) => !(x.skip ?? []).includes(d.focus) && !d.exercises.some((e) => e.key === x.key));
    if (d === undefined || def === undefined) break;
    const e = mkAcc(def.key, m, def.role, 2, def.tags ?? []);
    const ci = d.exercises.findIndex((x) => x.muscle === 'Core');
    d.exercises.splice(ci < 0 ? d.exercises.length : ci, 0, e);
  }

  if (a.supersets) for (const d of plan) pairUp(d.exercises);

  const weekly = weeklySetsOf(plan, chart);
  const ranges = Object.fromEntries(chart.map((m) => [m, pbRange(a, m)])) as Partial<Record<PbMuscle, readonly [number, number]>>;
  return {
    split,
    days: plan.map((d) => ({ index: d.index, weekday: d.weekday, focus: d.focus, variant: d.variant, moved: d.moved, exercises: d.exercises })),
    abs: a.abs ?? pbAbsAuto(a),
    weekly,
    ranges,
    short: chart.filter((m) => (weekly[m] ?? 0) < (ranges[m]?.[0] ?? 0)),
    nextWeekStarts: pbNextWeekStarts(split, plan.length),
    heldForPain: [...heldForPain].sort(),
  };
}

/** A nominal working load and a fine ladder: a time estimate for an exercise whose load isn't known yet (Start fits it). */
const NOMINAL_W = 100;
const NOMINAL_LOADS: readonly number[] = Array.from({ length: 2 * NOMINAL_W + 1 }, (_, k) => k / 2);
const NOMINAL_BAR = 20;

/** The catalogue facts the warm-up planner reads when the catalogue entry isn't given (engine tests; a key only). */
function factsFromKey(key: string, role: PbExercise['role']): WarmupExerciseFacts {
  return { catalogueKey: key, family: /(^|-)deadlift$/.test(key) && !key.includes('romanian') ? 'deadlift' : null, mechanic: role === 'i' ? 'isolation' : 'compound', measurement: 'reps' };
}

export interface PbDayWarmups {
  /** The day's warm-up time (seconds): every exercise's warm-up steps plus the general warm-up, per WU11/WU12. */
  timeS: number;
  /** General warm-up minutes (WU12), or null. */
  generalMinutes: number | null;
  /** The warm-up sets the day plans for its exercise at index `k` (on known loads), else null. */
  mainSteps: (k: number) => PbWarmupSet[] | null;
}

/**
 * (Ben, 23 Oct) A plan day's warm-ups from the shared planner (WU1–WU12), as Start and Today plan them: each exercise in
 * the day's order with its class at this gym, R and W (the main lift's top set; an accessory's planned load), WU2's
 * warmed check against the exercises before it (a superset's second member is warmed), WU6's first-exercise step,
 * WU12's general warm-up before a heavy first lift, all under the plan's Warm-ups setting (`full` within the D17
 * budget, `short` WU11's floors, `none` nothing). An exercise with no known load yet is timed on a nominal load (its
 * steps' reps, which is all the time depends on). Pure.
 */
export function pbDayWarmups(day: Pick<PbDay, 'exercises'>, a: Pick<PlanBuilderAnswers, 'warmups'>, input: Pick<PlanEngineInput, 'kitOf' | 'factsOf'>): PbDayWarmups {
  const mode = pbWarmups(a);
  const items: SessionWarmupItem[] = [];
  const at: number[] = [];
  const nominal: boolean[] = [];
  const barOf: (number | null)[] = [];
  const earlier: WarmupProfile[] = [];
  let first: WarmupProfile | null = null;
  day.exercises.forEach((e, k) => {
    const kit = input.kitOf(e.key);
    if (kit === null) return;
    const facts = input.factsOf?.(e.key) ?? factsFromKey(e.key, e.role);
    const loadable = kit !== 'bodyweight';
    const convention = loadable ? kit.convention : 'bodyweight';
    const profile = warmupProfileOf(facts, {
      main: e.role === 'main',
      itemKind: loadable ? kit.kind : null,
      convention,
      bodyweightExercise: convention === 'added',
      fallback: { compound: e.role !== 'i', group: e.muscle, barbell: loadable && kit.barMass !== null },
    });
    const warmed = isWarmed(profile, earlier, e.pair?.endsWith('2') === true);
    earlier.push(profile);
    if (k === 0) first = profile;
    const R = e.main?.reps ?? e.reps;
    const known = e.main !== null ? e.main.top : e.load.kind === 'kg' ? e.load.value : null;
    const bar = loadable && kit.kind === 'barbell' ? kit.barMass : null;
    const guess = loadable && known === null && profile.cls !== 'none' && profile.cls !== 'bodyweight';
    items.push({
      cls: profile.cls,
      reps: R,
      load: guess ? NOMINAL_W : known,
      warmed,
      firstOfSession: k === 0,
      floorStart: profile.floorStart,
      barMass: guess ? (bar === null ? null : NOMINAL_BAR) : bar,
      loads: guess ? NOMINAL_LOADS : loadable ? kit.loads : [],
    });
    at.push(k);
    nominal.push(guess);
    barOf.push(bar);
  });
  const general = mode === 'full' ? generalWarmupMinutes(first) : null;
  const plan = planSessionWarmupsAs(items, mode, { generalMinutes: general });
  return {
    timeS: plan.timeS,
    generalMinutes: plan.generalMinutes,
    mainSteps: (k) => {
      const i = at.indexOf(k);
      if (i < 0 || nominal[i] === true) return null;
      const bar = barOf[i] ?? null;
      return (plan.steps[i] ?? []).map((st, j) => ({ bar: j === 0 && bar !== null && Math.abs(st.load - bar) < 1e-9, load: st.load, reps: st.reps }));
    },
  };
}

/** A muscle's exercise list (Core has its own pair). */
function exOf(m: PbMuscle): readonly PbExerciseDef[] {
  return m === 'Core' ? [] : PB_EX[m];
}

/** 2–4 set chunks (§2). */
export function chunks(s: number): number[] {
  if (s <= 0) return [];
  if (s <= 4) return [Math.max(2, s)];
  if (s <= 8) return [Math.ceil(s / 2), Math.floor(s / 2)];
  const a = Math.ceil(s / 3);
  const b = Math.ceil((s - a) / 2);
  return [a, b, s - a - b];
}

/** Order: main lift, priorities and targets, compounds, isolations, core last. */
function sortDay(a: PlanBuilderAnswers, d: Pick<PbDay, 'exercises'>): void {
  const imp = (e: PbExercise): number => (e.role === 'main' ? 99 : isPri(a, e.muscle) ? 9 : isSpec(a, e.muscle) || e.tags.some((t) => isSpec(a, t)) ? 8 : e.muscle === 'Core' ? 3 : e.role === 'c' ? 5 : 4);
  const rank = (e: PbExercise): number => (e.role === 'main' ? 0 : e.muscle === 'Core' ? 9 : imp(e) >= 8 ? (e.role === 'c' ? 1 : 2) : e.role === 'c' ? 3 : 4);
  d.exercises.sort((x, y) => rank(x) - rank(y));
}

/**
 * Supersets: accessories paired A1/A2, B1/B2 …; never the main lift or heavy barbell compounds. Each pair's second
 * member moves up to sit right after its first, so the pair is done back to back (and stored adjacent).
 */
function pairUp(list: PbExercise[]): void {
  const free = list.filter((e) => e.role !== 'main' && !PB_HEAVY.has(e.key));
  for (let i = 0; i + 1 < free.length && i / 2 < 3; i += 2) {
    const L = 'ABC'[i / 2] ?? 'C';
    const x = free[i];
    const y = free[i + 1];
    if (x === undefined || y === undefined) break;
    x.pair = `${L}1`;
    y.pair = `${L}2`;
    list.splice(list.indexOf(y), 1);
    list.splice(list.indexOf(x) + 1, 0, y);
  }
}

/** Sets per week: direct sets plus half sets for indirect work (SEC), floored. */
export function weeklySetsOf(days: readonly Pick<PbDay, 'exercises'>[], chart: readonly PbMuscle[]): Partial<Record<PbMuscle, number>> {
  const out: Partial<Record<PbMuscle, number>> = Object.fromEntries(chart.map((m) => [m, 0]));
  for (const d of days)
    for (const e of d.exercises) {
      out[e.muscle] = (out[e.muscle] ?? 0) + e.sets;
      for (const [m, f] of Object.entries(PB_SEC[e.key] ?? {}) as [PbMuscle, number][]) if (m in out) out[m] = (out[m] ?? 0) + e.sets * f;
    }
  for (const m of Object.keys(out) as PbMuscle[]) out[m] = Math.floor(out[m] ?? 0);
  return out;
}

/** Last time's load on this gym's item, snapped down (rule 4); none without history. */
function lastLoadOn(kit: PlanKit, h: ReturnType<PbHistoryOf>): PbLoad {
  const last = h?.last ?? null;
  if (last === null || !(last.value > 0)) return { kind: 'none' };
  const want = inKitUnit(kit, last.value, last.unit);
  // Toward easier on this item: down for resistance, up (more help) on an assisted machine.
  const v = kit.convention === 'assistance' ? (kit.loads.find((l) => l >= want - 1e-9) ?? kit.loads.at(-1) ?? null) : kitDown(kit, want);
  return v === null ? { kind: 'none' } : { kind: 'kg', value: v, unit: kit.unit, convention: kit.convention, equipmentId: kit.equipmentId };
}

function whyOf(h: ReturnType<PbHistoryOf>, start?: PbLiftStart | null): string {
  if (start != null && start.from?.kind === 'similar') return `From ${start.from.fromKey} (est.)`;
  if (start != null && start.from?.kind === 'entered') return 'You entered';
  const last = h?.last ?? null;
  return last === null ? 'No history yet' : `Last time ${String(last.value)} × ${String(last.reps)}`;
}

/** The main lift's line for week 1: `1 × 6 + 2 × 8 · 102.5 / 95`. */
export function pbMainWeekOneLine(e: PbExercise): string {
  if (e.main === null) return `${String(e.sets)} × ${String(e.reps)}`;
  const perHand = e.load.kind === 'kg' && e.load.convention === 'per_hand';
  return pbMainLine(e.main.top, e.main.back, e.main.reps, e.main.backs, e.main.backReps, perHand);
}
