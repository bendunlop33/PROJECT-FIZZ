import { infoOrDefault, slotsOf, workingCount, type BuilderContext, type BuilderWorkout } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';
import type { CheckedText } from './checked-text';
import { focusSets, ownFocusOf } from './focus';
import type { EditOutcome } from './edit-ops';

/**
 * The builder coach's numbers, checked fact by fact (workout-builder-v3
 * §2.9 "code works out and checks every fact", S7 "a coach sentence with a
 * wrong number is hidden", rule 6; review b3-coach B2). Pure.
 *
 * A number passes only when it equals the fact it NAMES: `<n> working sets`
 * is the workout's total (or the plan's), `<focus or group> … <n>` that
 * focus's or group's count, `<n> exercises` the exercise count (for the
 * named focus or group when one is named), `<n> compound` / `isolation`,
 * `<n> min` the length or estimate, and a load, rep or RPE value only when
 * it belongs to an exercise named in the same clause. Anything else, a bare
 * number, a percentage, a date, is hidden, unless Ben said it himself. The
 * pool is code's facts only: never IDs, slot keys, memories or history
 * text. A sentence that fails is hidden whole and kept for `Why?` →
 * `Not shown`.
 */

type Load = { value: number; unit: WeightUnit };

interface Entity {
  /** Lower-case names as the coach may write them (`mid chest`, `barbell bench press`, `bench press`). */
  names: string[];
  sets: Set<number>;
  exercises: Set<number>;
  reps: Set<number>;
  rpe: Set<number>;
  loads: Load[];
  /**
   * (Weekly review) Estimated values (an est. 1RM, a `was` stored as an estimate): a load that matches
   * only one of these passes only when its sentence calls it an estimate (rule 6; review b3-wave3-truth B1).
   */
  estimates?: Load[];
}

/**
 * (Weekly review) Session and day counts, each checked against the fact it names (review b3-wave3-truth
 * B2): `hard`/`easy`/`good` (or `felt …`) → that feel count; `missed` → planned − done; `stalled` /
 * `no new best` → the stalled count; a bare count → done, planned or workouts.
 */
export interface SessionClaims {
  plain: Set<number>;
  missed: Set<number>;
  stalled: Set<number>;
  feel: { easy: Set<number>; good: Set<number>; hard: Set<number> };
}

export interface ClaimFacts {
  entities: Entity[];
  workingSets: Set<number>;
  exercises: Set<number>;
  compound: Set<number>;
  isolation: Set<number>;
  minutes: Set<number>;
  /** `day 1 of 4`, `5 of 6 planned`. */
  ofPairs: [number, number][];
  /** The plan day's own totals (`plan 60`, `the plan's 19`). */
  plan: Set<number>;
  /** Numbers in Ben's own words: he may be quoted back. */
  ben: Set<number>;
  /** (Weekly review) Session and day counts code gave (`3 sessions`, `2 workouts`), by what they count; absent: none, so any is hidden. */
  sessions?: SessionClaims;
  /** (Weekly review) Run counts code gave (`2 runs`); absent: none. */
  runs?: Set<number>;
}

/** What the plan check adds (§2.9 Plan section): its totals, length and pairs. */
export interface ClaimPlan {
  minutes: number;
  workingSets: number;
  exercises: number;
  /** `[kept, planned]`, `[day, of]`. */
  pairs: [number, number][];
}

export interface ClaimBase {
  ctx: Pick<BuilderContext, 'info'>;
  /** Set up's length and the estimate (and any other length code showed). */
  minutes: readonly number[];
  plan?: ClaimPlan | null;
  /** Ben's words. */
  words?: string;
}

const LB_PER_KG = 2.20462;
const EQUIPMENT_WORDS = /^(barbell|dumbbell|cable|machine|smith|ez-bar|ez bar|kettlebell|seated|standing|incline|decline|flat|weighted|assisted)\s+/;

const lower = (t: string): string => t.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
/** Lower-case, apostrophes and spaces normalised: how the claim check matches names. */
export const claimLower = lower;

export function exerciseNames(name: string): string[] {
  const n = lower(name);
  const out = new Set([n]);
  let m = n;
  // `Barbell bench press` → `bench press`; never down to one generic word.
  while (EQUIPMENT_WORDS.test(m)) {
    m = m.replace(EQUIPMENT_WORDS, '');
    if (m.includes(' ')) out.add(m);
  }
  return [...out];
}

const numbersIn = (t: string): number[] => [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Code's facts for one or more workouts (before and after a change), each counted by code. */
export function claimFacts(workouts: readonly BuilderWorkout[], base: ClaimBase): ClaimFacts {
  const byName = new Map<string, Entity>();
  const entity = (names: readonly string[]): Entity => {
    const key = names[0] ?? '';
    let e = byName.get(key);
    if (e === undefined) {
      e = { names: [...names], sets: new Set(), exercises: new Set(), reps: new Set(), rpe: new Set(), loads: [] };
      byName.set(key, e);
    }
    for (const n of names) if (!e.names.includes(n)) e.names.push(n);
    return e;
  };
  const f: ClaimFacts = { entities: [], workingSets: new Set(), exercises: new Set(), compound: new Set(), isolation: new Set(), minutes: new Set(base.minutes), ofPairs: [], plan: new Set(), ben: new Set(numbersIn(base.words ?? '')) };
  for (const w of workouts) {
    const slots = slotsOf(w.blocks);
    f.workingSets.add(slots.reduce((m, s) => m + workingCount(s), 0));
    f.exercises.add(slots.length);
    const compound = slots.filter((s) => infoOrDefault(base.ctx.info, s.exerciseId).role === 'compound').length;
    f.compound.add(compound);
    f.isolation.add(slots.length - compound);
    for (const [focus, n] of focusSets(slots, base.ctx)) entity([lower(focus)]).sets.add(n);
    const groupSets = new Map<string, number>();
    const groupCount = new Map<string, number>();
    const focusCount = new Map<string, number>();
    for (const s of slots) {
      const i = infoOrDefault(base.ctx.info, s.exerciseId);
      const g = lower(i.group);
      groupSets.set(g, (groupSets.get(g) ?? 0) + workingCount(s));
      groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
      const own = ownFocusOf(i);
      if (own !== null) focusCount.set(lower(own), (focusCount.get(lower(own)) ?? 0) + 1);
      const e = entity(exerciseNames(i.name));
      e.sets.add(workingCount(s));
      for (const r of s.rows) {
        if (r.type === 'warmup') continue;
        e.reps.add(r.reps);
        // A saved range's top (`3–6`) is a fact too (final re-review S2).
        if (r.repsMax !== undefined) e.reps.add(r.repsMax);
        if (r.rpe != null) e.rpe.add(r.rpe);
        if (r.load != null) e.loads.push({ value: r.load, unit: s.unit });
      }
    }
    // A group named the same as a focus (`triceps`, `abs`) is one entity: both counts pass.
    for (const [g, n] of groupSets) entity([g]).sets.add(n);
    for (const [g, n] of groupCount) entity([g]).exercises.add(n);
    for (const [fo, n] of focusCount) entity([fo]).exercises.add(n);
  }
  const p = base.plan;
  if (p != null) {
    f.minutes.add(p.minutes);
    f.workingSets.add(p.workingSets);
    f.exercises.add(p.exercises);
    f.ofPairs.push(...p.pairs);
    for (const v of [p.minutes, p.workingSets, p.exercises]) f.plan.add(v);
  }
  f.entities = [...byName.values()];
  return f;
}

type Kind = 'plan' | 'load' | 'sets' | 'exercises' | 'compound' | 'isolation' | 'minutes' | 'reps' | 'rpe' | 'of' | 'sessions' | 'runs' | 'bare' | 'never';

const AFTER: readonly [RegExp, Kind][] = [
  [/^\s?(?:kgs?|kilos?|lbs?|pounds?)\b/, 'load'],
  [/^\s?%/, 'never'],
  [/^\s?[×x]\s?\d/, 'sets'],
  [/^\s?(?:(?:hard|working|work|total|more|fewer|extra|direct|weekly)\s+)?sets?\b/, 'sets'],
  [/^\s?(?:(?:\w+)\s+)?(?:exercises?|lifts?|movements?)\b/, 'exercises'],
  [/^\s?compounds?\b/, 'compound'],
  [/^\s?isolations?\b/, 'isolation'],
  [/^\s?(?:min|mins|minutes?)\b/, 'minutes'],
  [/^\s?(?:reps?|repetitions?)\b/, 'reps'],
  [/^\s?(?:(?:planned|plan|lifting|gym|training|hard|easy|good)\s+)?(?:sessions?|workouts?|days?)\b/, 'sessions'],
  [/^\s?runs?\b/, 'runs'],
  [/^\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/, 'never'],
  [/^\s?(?:weeks?|days?|months?|years?|sessions?|times?)\b/, 'never'],
];

const WORD_NUMBER: Readonly<Record<string, string>> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.011;
const has = (set: Iterable<number>, n: number): boolean => {
  for (const v of set) if (near(v, n)) return true;
  return false;
};
function loadMatches(loads: readonly Load[], n: number, unit: WeightUnit): boolean {
  return loads.some((l) => {
    if (l.unit === unit) return near(l.value, n);
    const conv = unit === 'kg' ? l.value / LB_PER_KG : l.value * LB_PER_KG;
    return Math.abs(conv - n) <= conv * 0.01;
  });
}

/** Whether every number in one sentence is the fact it names (and an estimated max is called an estimate, rule 6). */
export function claimSentenceOk(sentence: string, f: ClaimFacts): boolean {
  let t = ` ${lower(sentence)} `;
  if (/\b(?:e?1 ?rm|one-rep max|max)\b/.test(t) && !/\b(?:est\.?|estimate[sd]?|estimated)\b/.test(t)) return false;
  const saysEstimate = /\b(?:est\.?|estimate[sd]?|estimated|e?1 ?rm|one-rep max)\b/.test(t);
  t = t
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => ' '.repeat(m.length))
    .replace(/\be?1 ?rm\b/g, (m) => ' '.repeat(m.length))
    // `three exercises`, `ten working sets`: a count in words is a count (not `this one`, `one more set`).
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?=\s(?:(?:working|hard|total|direct)\s)?(?:sets?|exercises?|lifts?|movements?|compounds?|isolations?|min|minutes?|reps?)\b)/g, (m) => (WORD_NUMBER[m] ?? m).padEnd(m.length, ' '))
    // `100kg`, `3x8`, `16sets`: a number is never hidden inside a word.
    .replace(/(\d)([a-z%×])/g, '$1 $2')
    .replace(/([a-z×])(\d)/g, '$1 $2');
  if (!/\d/.test(t)) return true;

  // Entity mentions, longest names first so `mid chest` isn't also `chest`.
  const mentions: { at: number; e: Entity }[] = [];
  let masked = t;
  const names = f.entities.flatMap((e) => e.names.map((n) => ({ n, e }))).sort((a, b) => b.n.length - a.n.length);
  for (const { n, e } of names) {
    const re = new RegExp(`(?<![a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z])`, 'g');
    masked = masked.replace(re, (m, at: number) => {
      mentions.push({ at, e });
      return '#'.repeat(m.length);
    });
  }
  // Clauses: a fact belongs to what its own clause names.
  const cuts = [0, ...[...masked.matchAll(/[,;:()]|\s(?:and|but|while|whereas|plus|vs)\s|\s[–—-]\s/g)].map((m) => m.index), masked.length];
  const clauseOf = (at: number): [number, number] => {
    let lo = 0;
    let hi = masked.length;
    for (const c of cuts) {
      if (c <= at) lo = c;
      else {
        hi = c;
        break;
      }
    }
    return [lo, hi];
  };

  const pairEnds = new Set<number>();
  /** Where a range's top starts → its bottom's kind (`5 × 3–6`: the 6 is reps too; final re-review S2). */
  const rangeTops = new Map<number, Kind>();
  for (const m of masked.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d])/g)) {
    const raw = m[1] ?? '';
    const n = Number(raw);
    const at = m.index;
    const end = at + raw.length;
    // The `4` of `1 of 4` was checked with its pair.
    if (pairEnds.has(at)) continue;
    if (has(f.ben, n)) continue;
    // `8–10 reps`: the bottom of a range takes the unit after its top.
    let after = masked.slice(end, end + 40);
    const range = /^\s?(?:–|-|to)\s?(\d+(?:\.\d+)?)/.exec(after);
    if (range !== null) after = after.slice(range[0].length);
    const before = masked.slice(Math.max(0, at - 12), at);
    let kind: Kind = 'bare';
    const of = /^\s?of\s(\d+)/.exec(masked.slice(end, end + 12));
    const top = rangeTops.get(at);
    if (top !== undefined) kind = top;
    else if (of !== null) {
      kind = 'of';
      pairEnds.add(end + of[0].length - (of[1] ?? '').length);
    }
    else if (/(?:rpe|@)\s?(?:of\s)?$/.test(before)) kind = 'rpe';
    else if (/plan(?:'s)?\s?$/.test(before)) kind = 'plan';
    // `5×8`, `5 x 8` (not the `x` ending `max`).
    else if (/(?:×|(?<![a-z])x)\s?$/.test(before)) kind = 'reps';
    else for (const [re, k] of AFTER) if (re.test(after)) {
      kind = k;
      break;
    }
    if (kind === 'never') return false;
    if (range !== null) rangeTops.set(end + range[0].length - (range[1] ?? '').length, kind);
    const [lo, hi] = clauseOf(at);
    const named = mentions.filter((x) => x.at >= lo && x.at < hi).map((x) => x.e);
    let ok = false;
    switch (kind) {
      case 'of':
        ok = f.ofPairs.some(([a, b]) => near(a, n) && near(b, Number(of?.[1])));
        break;
      case 'load': {
        const unit: WeightUnit = /^\s?(?:lbs?|pounds?)/.test(after) ? 'lb' : 'kg';
        ok = named.some((e) => loadMatches(e.loads, n, unit) || (saysEstimate && loadMatches(e.estimates ?? [], n, unit)));
        break;
      }
      case 'plan':
        ok = has(f.plan, n);
        break;
      case 'reps':
        ok = named.some((e) => has(e.reps, n));
        break;
      case 'rpe':
        ok = named.some((e) => has(e.rpe, n));
        break;
      case 'sets':
        ok = named.length > 0 ? named.some((e) => has(e.sets, n)) : has(f.workingSets, n);
        break;
      case 'exercises':
        ok = named.length > 0 ? named.some((e) => has(e.exercises, n)) : has(f.exercises, n);
        break;
      case 'compound':
        ok = has(f.compound, n);
        break;
      case 'isolation':
        ok = has(f.isolation, n);
        break;
      case 'minutes':
        ok = has(f.minutes, n);
        break;
      case 'sessions': {
        const sc = f.sessions;
        if (sc === undefined) break;
        const clause = masked.slice(lo, hi);
        const feelWord = /^\s?(hard|easy|good)\b/.exec(after)?.[1] ?? (/\b(?:felt|feel|feels|feeling)\b/.test(clause) ? /\b(hard|easy|good)\b/.exec(clause)?.[1] : undefined);
        if (feelWord === 'hard' || feelWord === 'easy' || feelWord === 'good') ok = has(sc.feel[feelWord], n);
        else if (/\b(?:miss(?:ed|es|ing)?|skipped)\b/.test(clause)) ok = has(sc.missed, n);
        else if (/\b(?:stall(?:ed|ing|s)?|no new best|no progress|plateau(?:ed)?)\b/.test(clause)) ok = has(sc.stalled, n);
        else ok = has(sc.plain, n);
        break;
      }
      case 'runs':
        ok = has(f.runs ?? [], n);
        break;
      case 'bare':
        // `Mid chest 7`, `Triceps at 7`: a named focus or group's set count.
        ok = named.some((e) => has(e.sets, n));
        break;
    }
    if (!ok) return false;
  }
  return true;
}

/** Each sentence of the coach's text, checked; a failing sentence is hidden whole. */
export function checkClaims(text: string | null | undefined, f: ClaimFacts): CheckedText {
  const t = (text ?? '').trim();
  if (t === '') return { shown: null, hidden: [] };
  const kept: string[] = [];
  const hidden: string[] = [];
  // `est. 1RM` is one sentence: an abbreviation's full stop doesn't end it.
  for (const s of t.split(/(?<=[.!?])(?<!\b(?:est|approx|e\.g|i\.e)\.)\s+/)) {
    const x = s.trim();
    if (x === '') continue;
    (claimSentenceOk(x, f) ? kept : hidden).push(x);
  }
  return { shown: kept.length === 0 ? null : kept.join(' '), hidden };
}

/** How a proposal's words are checked: against the workout before AND after the change. */
export type TextCheck = (text: string | null, outcome: EditOutcome | null) => CheckedText;

/** The claim check for one snapshot's workout (and, for a proposal, the workout after it). */
export function workoutClaimCheck(before: BuilderWorkout, base: ClaimBase): TextCheck {
  return (text, outcome) => checkClaims(text, claimFacts(outcome === null ? [before] : [before, outcome.workout], outcome === null ? base : { ...base, minutes: [...base.minutes, outcome.minutes, outcome.estimate] }));
}

/** Words with no facts behind them: any number hides its sentence. */
export const NO_NUMBERS: TextCheck = (text) => checkClaims(text, claimFacts([], { ctx: { info: () => null }, minutes: [] }));
