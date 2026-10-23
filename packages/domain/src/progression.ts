import type {
  EquipmentInstance,
  Load,
  SetExclusion,
  LoadConvention,
  Measurement,
  ProgressionRule,
  RepRange,
  Rir,
  Rpe,
  SetSide,
  SetType,
  WeightUnit,
} from '@fizz/schemas';
import {
  getAchievableLoads,
  isLoadAchievable,
  loadDirection,
  roundToAvailableLoad,
  type LoadDirection,
} from './equipment';
import { allLeftOutFact, isSetCountable } from './exclusions';
import { stallResetLoad } from './stall-reset';
import { toMs } from './time';
import { convertMass, convertMassExactly, fromScaled, toScaled } from './units';
import type { RuleReps } from './rep-range';

export interface HistorySet {
  setType: SetType;
  /**
   * Unilateral side, as on `WorkoutSet.side`: `both` = done on each side,
   * `left`/`right` = that side only, null = bilateral (or no side recorded).
   */
  side: SetSide | null;
  load: Load | null;
  reps: number | null;
  rpe: Rpe | null;
  rir: Rir | null;
  /** Timed sets: the work time logged. Absent on rep sets. */
  durationS?: number;
  /** Distance sets: the metres logged. Absent on other sets. */
  distanceM?: number;
  /** The stored set and its version (sets logged in the app), so `Why?` can tell when it was edited later. */
  setId?: string;
  version?: number;
  /** The set's number as the card showed it (`Set 4`, warm-ups included), for `Why?` `Not used`. */
  number?: number;
  /**
   * Ben's exclusion flags (active-workout §2.13). A flagged set is left out
   * of progression, comparisons and records (`isSetCountable`), but it is
   * still history: it shows with its words wherever it appears.
   */
  exclusions?: readonly SetExclusion[];
}

/**
 * One past session of this exercise, as actually performed (corrections
 * applied). `sets` holds completed sets only: a set skipped at Finish is simply
 * absent, so a session where everything was skipped has no counted sets.
 */
export interface HistorySession {
  sessionId: string;
  performedAtUtc: string;
  equipmentId: string | null;
  /** The workout's gym; null when it wasn't recorded (an imported workout). */
  gymId: string | null;
  /**
   * Imported from FitNotes (B7, approved 11 Oct 2026; ADR 0016 P-I3 option
   * (b)). Imported history has no equipment instance, so it matches on
   * exercise, unit and load convention alone (`matchesEquipment`), and only
   * its working sets count (`comparableSetsOf`). It is always labelled
   * FitNotes where it shows (`Last (FitNotes, 1 Oct)`), and every target made
   * from it is still fitted to today's real equipment (rule 4).
   */
  imported: boolean;
  sets: readonly HistorySet[];
  /** The workout's time zone and routine name, for `Why?` (`after Push A, 1 Oct`). */
  tz?: string;
  routineName?: string | null;
  /**
   * (Review B2, 19 Oct) A second copy of the exercise in that workout (`extraCopies`), e.g. a
   * superset with itself at 0: its own sets, kept in history, never a basis for next time or `Last`.
   */
  copy?: true;
}

/**
 * B7: whether a history session can be compared with an exercise done on
 * `equipmentId`. Logged history needs the same equipment instance; imported
 * (FitNotes) history has none recorded, so it matches any (unit and
 * convention are still checked by each caller). A second copy from the
 * same workout (`copy`) is never compared: the main copy plans next time.
 */
export function matchesEquipment(h: Pick<HistorySession, 'imported' | 'equipmentId' | 'copy'>, equipmentId: string | null, alsoComparable?: ReadonlySet<string>): boolean {
  if (h.copy === true) return false;
  return h.imported || h.equipmentId === equipmentId || (h.equipmentId !== null && alsoComparable?.has(h.equipmentId) === true);
}

/**
 * The sets of a history session that a comparison or target reads. Logged
 * history: every set, as logged (warm-ups are flagged). Imported history:
 * FitNotes has no warm-up flag, so a ramp (`60 × 10, 80 × 5, 100 × 5,
 * 100 × 5`) arrives as all working sets. Only the lighter sets **before** the
 * session's hardest set (heaviest for resistance, least assistance for
 * assisted), per unit and convention, are read as a warm-up ramp and left
 * out. The hardest set and everything after it are kept, so back-off sets
 * and descending pyramids (`100 × 5, 90 × 8, 80 × 10`) count as the working
 * sets they are (review import-progress B2; reading (a), provisional until
 * Ben confirms).
 *
 * Import-progress r4 S1: working sets followed by one heavier set
 * (`20 × 10 ×3, 22.5 × 6`) are not a ramp. The sets just before the first
 * hardest set are kept as working sets (`workingRunBeforeTop`) when they are
 * 2 or more in a row at one load, more than the sets at the hardest load,
 * each with at least as many reps as the first hardest set, and (resistance)
 * at least 80% of its load. A real ramp (`20 × 10, 20 × 10, 60 × 5, 80 × 3,
 * 100 × 5`, or `80 × 3, 80 × 3, 100 × 5`) still reads as a ramp. Sets with no
 * load (or bodyweight) are kept when nothing in the session has a load.
 * Nothing stored changes: this is how history is read.
 */
export function comparableSetsOf<T extends Pick<HistorySet, 'setType' | 'load'> & { reps?: number | null }>(h: { imported: boolean; sets: readonly T[] }): T[] {
  if (!h.imported) return [...h.sets];
  const loaded = h.sets.filter((x) => x.load !== null && x.load.convention !== 'bodyweight');
  if (loaded.length === 0) return h.sets.filter((x) => x.setType !== 'warmup');
  const keyOf = (l: Load) => `${l.unit}|${l.convention}`;
  /** Per unit and convention: the hardest load and where it first appears. */
  const hardest = new Map<string, { v: number; at: number }>();
  loaded.forEach((x, at) => {
    if (x.load === null) return;
    const key = keyOf(x.load);
    const v = toScaled(x.load.value);
    const prev = hardest.get(key);
    const resist = loadDirection(x.load.convention) === 'resistance';
    if (prev === undefined || (resist ? v > prev.v : v < prev.v)) hardest.set(key, { v, at });
  });
  /** Per unit and convention: where the kept sets start. */
  const startAt = new Map<string, number>();
  for (const [key, top] of hardest) startAt.set(key, workingRunBeforeTop(loaded, key, top, keyOf));
  return loaded.filter((x, at) => {
    if (x.setType === 'warmup' || x.load === null) return false;
    const start = startAt.get(keyOf(x.load));
    return start !== undefined && at >= start;
  });
}

/**
 * r4 S1: where the kept sets of one unit and convention start. The first
 * hardest set, or the start of a run of working sets just before it (see
 * `comparableSetsOf`). Indices are into `loaded`.
 */
function workingRunBeforeTop(
  loaded: readonly (Pick<HistorySet, 'setType' | 'load'> & { reps?: number | null })[],
  key: string,
  top: { v: number; at: number },
  keyOf: (l: Load) => string,
): number {
  const same = loaded.map((x, at) => ({ x, at })).filter(({ x }) => x.load !== null && keyOf(x.load) === key && x.setType !== 'warmup');
  const p = same.findIndex(({ at }) => at === top.at);
  if (p < 1) return top.at;
  const sv = (i: number) => toScaled((same[i]?.x.load as Load).value);
  const runLoad = sv(p - 1);
  let first = p - 1;
  while (first > 0 && sv(first - 1) === runLoad) first -= 1;
  const run = same.slice(first, p);
  const atTop = same.filter((_, i) => sv(i) === top.v).length;
  const topReps = same[p]?.x.reps;
  if (run.length < 2 || run.length <= atTop || topReps === undefined || topReps === null) return top.at;
  if (!run.every(({ x }) => x.reps !== undefined && x.reps !== null && x.reps >= topReps)) return top.at;
  const convention = (same[p]?.x.load as Load).convention;
  if (loadDirection(convention) === 'resistance' && runLoad * 100 < top.v * 80) return top.at;
  return run[0]?.at ?? top.at;
}

/** How the sets kept from a FitNotes session (`comparableSetsOf`) are judged (`readFitNotesWorkingSets`). */
export interface FitNotesReading<T> {
  /**
   * The working load: the kept load with the most sets. A tie goes to the
   * easiest only when the tied loads have one set each; otherwise to the
   * hardest (r4 B1). Null when no kept set has a load.
   */
  reference: Load | null;
  /** The sets the rule judges, in session order: the sets at the reference, plus the harder sets when they aren't a lone top set. */
  judged: T[];
  /** Harder sets than the reference, fewer than the sets at it (a top set before back-offs): context, never judged. */
  context: T[];
  /** Harder sets than the reference that are judged with it (they aren't fewer than the sets at it, e.g. a pyramid). */
  harderJudged: T[];
  /** Easier sets than the reference (a finisher or drop set): never judged and never the planned load. */
  easier: T[];
}

/**
 * Import-progress r3 B1 (provisional until Ben confirms; ADR 0016): which
 * load is the working load of a FitNotes session, read from the sets
 * `comparableSetsOf` kept (ramp already left out). The reference is the load
 * with the most sets. Ties go to the easiest only when the tied loads have one
 * set each (a top single and one back-off, r2 B1); a tie of 2 or more sets
 * goes to the hardest, so equal-count finishers, burnouts and drop-set
 * triplets are never the working load (r4 B1). So:
 * - working sets then a lighter finisher (`20 × 10 ×3, 12 × 15`, or
 *   `20 × 10 ×3, 12 × 15 ×3`): 20, and the finisher is left out;
 * - a top single then back-offs (`22 × 4, 18 × 9 ×3`): 18, and the top single
 *   is context because it is fewer than the sets at 18 (r2 B1);
 * - a descending pyramid (`24 × 6, 20 × 8, 16 × 10`): 16, and the harder sets
 *   are judged with it because they aren't fewer than the sets at 16.
 * Sets in another unit or convention than the reference are in none of the
 * lists (the rule leaves such a session out). Logged-in-app history is never
 * read this way.
 */
export function readFitNotesWorkingSets<T extends Pick<HistorySet, 'load'>>(kept: readonly T[]): FitNotesReading<T> {
  const loadOf = (x: T): Load | null => (x.load !== null && x.load.convention !== 'bodyweight' ? x.load : null);
  const loaded = kept.filter((x) => loadOf(x) !== null);
  if (loaded.length === 0) return { reference: null, judged: [...kept], context: [], harderJudged: [], easier: [] };
  const kindOf = (l: Load) => `${l.unit}|${l.convention}`;
  const groups = new Map<string, { load: Load; n: number }>();
  for (const x of loaded) {
    const l = loadOf(x) as Load;
    const key = `${kindOf(l)}|${String(toScaled(l.value))}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { load: l, n: 1 });
  }
  let best: { load: Load; n: number } | null = null;
  for (const g of groups.values()) {
    if (best === null || g.n > best.n) best = g;
    else if (g.n === best.n && kindOf(g.load) === kindOf(best.load)) {
      const dir = loadDirection(g.load.convention);
      // r4 B1: single sets tie to the easiest (a top single then one back-off); 2+ to the hardest.
      if (g.n === 1 ? harder(best.load.value, g.load.value, dir) : harder(g.load.value, best.load.value, dir)) best = g;
    }
  }
  const ref = (best as { load: Load; n: number }).load;
  const dir = loadDirection(ref.convention);
  const sameKind = loaded.filter((x) => kindOf(loadOf(x) as Load) === kindOf(ref));
  const v = (x: T) => (loadOf(x) as Load).value;
  const atRef = sameKind.filter((x) => toScaled(v(x)) === toScaled(ref.value));
  const harderSets = sameKind.filter((x) => harder(v(x), ref.value, dir));
  const easier = sameKind.filter((x) => harder(ref.value, v(x), dir));
  const contextOnly = harderSets.length < atRef.length;
  return {
    reference: { value: fromScaled(toScaled(ref.value)), unit: ref.unit, convention: ref.convention },
    judged: sameKind.filter((x) => atRef.includes(x) || (!contextOnly && harderSets.includes(x))),
    context: contextOnly ? harderSets : [],
    harderJudged: contextOnly ? [] : harderSets,
    easier,
  };
}

/**
 * The working sets to plan from a FitNotes session's kept sets
 * (`comparableSetsOf`): the sets the rule judges (`readFitNotesWorkingSets`).
 * A lone top set kept as context and a lighter finisher aren't planned at
 * the new load (import-progress r3 S1; ADR 0016), so Ben isn't asked for
 * more sets than he did at the working load.
 */
export function fitNotesJudgedCount(kept: readonly Pick<HistorySet, 'load'>[]): number {
  return readFitNotesWorkingSets(kept).judged.length;
}

/**
 * r4 B1: the working sets to plan from a FitNotes session, from its kept sets
 * and `total` sets (`importedWorkingSetCount`). Lighter finishers are never
 * the planned load, so they never lift the count either: 2 working sets plus
 * 2 finishers plan 2, and drop-set triplets plan 3, not 9.
 */
export function fitNotesPlannedSets(kept: readonly Pick<HistorySet, 'load'>[], total: number, floor: number): number {
  const r = readFitNotesWorkingSets(kept);
  return importedWorkingSetCount(r.judged.length, total - r.easier.length, floor);
}

/**
 * B1 / B2 (review import-progress): how many working sets to plan from a
 * FitNotes session read through `comparableSetsOf` and
 * `readFitNotesWorkingSets` (`comparable`, the judged sets, of its
 * `total` sets). The same reading as the load, so a ramp never plans every
 * set at the top load; and the reading never takes the count below the
 * built-in default (`floor`), so a top single followed by nothing doesn't
 * plan one set. A session with fewer sets than the default keeps its own
 * count (2 sets done, 2 planned). At most 10: the rule's own `workingSets`
 * cap, since a FitNotes session with no warm-up flag can hold many more rows
 * than working sets; in-app counts are logged deliberately and aren't capped.
 */
export function importedWorkingSetCount(comparable: number, total: number, floor: number): number {
  return Math.min(10, Math.max(comparable, Math.min(floor, total), 1));
}

/** Active pain flag for this movement. Set and cleared explicitly by the user. */
export interface PainStatus {
  active: boolean;
  reportedAtUtc: string | null;
}

export interface NextTargetsInput {
  exerciseName: string;
  /** Duration (timed) exercises aren't progressed yet; they return `unsupported`. */
  measurement: Measurement;
  history: readonly HistorySession[];
  rule: ProgressionRule;
  /** Equipment the next session will use. Null = no equipment profile (bodyweight or unchecked). */
  equipment: EquipmentInstance | null;
  /** Unit and convention when no equipment is attached; ignored otherwise. */
  unit: WeightUnit;
  convention: LoadConvention;
  pain: PainStatus;
  /**
   * The caller fits these loads to a gym's equipment afterwards (Start next
   * session from a FitNotes workout: `snapPlanToGym` maps an item by kind,
   * rounds toward easier and never above a max, or drops the load). Without
   * it, a load built on FitNotes history with no equipment here to check it
   * is not prescribed (B7, ADR 0016 P-I3; rule 4).
   */
  fitLater?: boolean;
  /**
   * (Builder loads, 21 Oct) Other equipment items whose logged history is
   * comparable with `equipment` (same kind, and for a bar the same bar mass:
   * `comparableSessions` in `session/substitutes`). Without it only the same
   * item compares (`matchesEquipment`), so a row logged on another bar of the
   * same mass was skipped and older, lighter history planned the load.
   */
  comparableEquipmentIds?: ReadonlySet<string>;
  /**
   * (Ben, 23 Oct; review v5offers SP2) Ben applied the rule's own stall reset on the Summary (`Reset to … · Apply`). Only
   * then does a stall lower the load (`reduce_load`); otherwise the rule holds and offers the reset (`resetOffer`).
   */
  acceptReset?: boolean;
}

export type ProgressionDecision =
  | 'insufficient_data'
  | 'increase_load'
  | 'increase_reps'
  | 'hold'
  | 'hold_after_miss'
  | 'reduce_load'
  | 'ceiling_reached'
  | 'halted_pain'
  /** The equipment can't make any load (e.g. its min is above every position): nothing is prescribed. */
  | 'no_feasible_load'
  | 'unsupported';

export interface TargetSet {
  setType: SetType;
  load: Load | null;
  reps: RepRange;
}

export interface NextTargets {
  decision: ProgressionDecision;
  sets: TargetSet[];
  /**
   * `checked`: every load is achievable on the equipment. `unchecked`: no
   * equipment profile. `infeasible`: the equipment can't make any load (e.g. its
   * min is above every position), so no load is prescribed.
   */
  loadFeasibility: 'checked' | 'unchecked' | 'not_applicable' | 'infeasible';
  rule: { id: string; version: number; method: ProgressionRule['method']; name: string };
  explanation: { summary: string; facts: string[] };
  /** Comparable sessions used, latest first. */
  basedOnSessionIds: string[];
  /** (Reps from history, 21 Oct) The reps the rule used and the one count to plan (`nextTargetsFor`). */
  reps?: RuleReps;
  /**
   * (Review v5offers 6) Playbook rule 8's stall: the miss streak reached `failuresBeforeReduce` at the same load,
   * whether the rule could reduce (`reduce_load`) or no easier load exists (`hold_after_miss` at the lightest load).
   * Absent otherwise.
   */
  stalled?: true;
  /**
   * (Ben, 23 Oct; review v5offers SP2) The rule's stall reset, offered and not applied: the load it would reset to
   * (playbook rule 8 / 7-F), for the Summary's `Reset to … ?` with `Apply` / `Skip`. Present only on a stall the rule
   * could reduce and Ben hasn't applied (`acceptReset`); the plan itself holds.
   */
  resetOffer?: Load;
}

interface Criteria {
  repRange: RepRange;
  maxRpeToProgress: Rpe | null;
  minRirToProgress: Rir | null;
}

/** One side of a unilateral exercise in one session: its own sets plus `both` sets. */
interface SideEval {
  sets: number;
  minReps: number;
  allHitTop: boolean;
  effortOk: boolean;
}

interface SessionEval {
  /** From a FitNotes import (B7). */
  imported: boolean;
  sessionId: string;
  performedAtUtc: string;
  /** Completed sets of the counted type (working, or top for top-set rules), as logged rows. */
  loggedSets: number;
  /**
   * Prescribed sets completed. Bilateral: one per row. Unilateral (review R4):
   * a `both` set counts once and a left + right pair counts once, never twice.
   */
  prescribedDone: number;
  /** Per-side evaluation when any counted set is `left` or `right`; null otherwise. */
  sides: { left: SideEval; right: SideEval } | null;
  /** Sided and unsided sets are mixed, so sides can't be paired; never progresses. */
  unpairable: boolean;
  /** Completed sets of other types (e.g. back-offs when no top set was logged). */
  otherSets: number;
  /** Sets of the counted type Ben left out of progress (§2.13); not in `loggedSets`. */
  leftOut: number;
  /**
   * The load the rule plans from. Logged in the app: the easiest counted load
   * (lowest resistance / most assistance). FitNotes: the working load
   * (`readFitNotesWorkingSets`). Null for bodyweight or no sets.
   */
  load: number | null;
  /**
   * (Builder-loads review S4) A builder-format session (top set + back-offs): the
   * easiest back-off load, planned from with the same step as the top set so
   * the other working sets never all jump to the top set's load. Null otherwise.
   */
  backoffLoad: number | null;
  /** Sets judged for the range and effort (FitNotes: `readFitNotesWorkingSets`; in the app: every counted set). */
  judgedSets: number;
  /** FitNotes: harder sets kept as context, judged with the working load, and easier sets left out. Zero in the app. */
  contextSets: number;
  harderJudged: number;
  easierLeftOut: number;
  /**
   * r4 B1: FitNotes, when harder sets are judged with the working load and
   * every judged set reached the top of the range: the hardest judged load,
   * which an increase starts from (never below a load Ben did at the top).
   * Null otherwise.
   */
  increaseFrom: number | null;
  minReps: number;
  /** (Reps from history, 21 Oct) Reps of the judged sets, as logged. */
  judgedReps: number[];
  /** Every judged set reached the top of the range (false when nothing was counted). */
  allHitTop: boolean;
  /**
   * A set at the planned load fell below the range. FitNotes: only sets at
   * the working load, so a harder set is never a miss at the load planned
   * below it (r2 B1), and a finisher never hides a miss at the working load (r3 B1).
   */
  anyBelowFloor: boolean;
  effortOk: boolean;
  missingEffort: number;
}

interface Ctx {
  input: NextTargetsInput;
  unit: WeightUnit;
  convention: LoadConvention;
  direction: LoadDirection;
  facts: string[];
  /** Set when the equipment can't produce any load, so no load can be prescribed. */
  infeasible: boolean;
}

/**
 * Human-readable load. A null load reads as "bodyweight" only when the
 * convention says so (bodyweight, or weighted bodyweight with nothing added);
 * otherwise it is "no load", never a bodyweight claim (review R3).
 */
export function formatLoad(load: Load | null, convention?: LoadConvention): string {
  if (load === null) return convention === 'bodyweight' || convention === 'added' ? 'bodyweight' : 'no load';
  if (load.convention === 'bodyweight') return 'bodyweight';
  const n = `${fromScaled(toScaled(load.value))} ${load.unit}`;
  switch (load.convention) {
    case 'per_hand':
      return `${n} each`;
    case 'stack':
      return `${n} stack`;
    case 'added':
      return `${n} added`;
    case 'assistance':
      return `assist ${n}`;
    case 'total':
      return n;
  }
}

const range = (r: RepRange) => (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);
const day = (utc: string) => utc.slice(0, 10);

function asLoad(ctx: Ctx, value: number | null): Load | null {
  if (value === null) return null;
  return { value: fromScaled(toScaled(value)), unit: ctx.unit, convention: ctx.convention };
}

function fmt(ctx: Ctx, value: number | null): string {
  return formatLoad(asLoad(ctx, value), ctx.convention);
}

function pushFact(ctx: Ctx, fact: string): void {
  if (!ctx.facts.includes(fact)) ctx.facts.push(fact);
}

function countedTypes(rule: ProgressionRule): SetType[] {
  return rule.method === 'double_progression' ? ['working'] : ['top'];
}

/**
 * (Builder loads, 21 Oct; Ben: "it knew my history but wasn't using it") A
 * workout made in the builder logs a main lift as a top set and back-offs,
 * never `working`. Double progression read such a session as having no
 * counted sets, so it planned from the newest older session with working
 * sets (often lighter FitNotes history). An in-app session with no working
 * sets but a top set is now judged on its top and back-off sets and planned
 * from its top set.
 */
const BUILDER_FORMAT_TYPES: readonly SetType[] = ['top', 'backoff'];

function builderFormatSets(rule: ProgressionRule, s: Pick<HistorySession, 'imported'>, kept: readonly Pick<HistorySet, 'setType'>[]): boolean {
  return rule.method === 'double_progression' && !s.imported && !kept.some((x) => x.setType === 'working') && kept.some((x) => x.setType === 'top');
}

/** Sets that must be completed before the rule may progress (review B2, ADR 0003 S3). */
function requiredSets(rule: ProgressionRule): number {
  return rule.method === 'double_progression' ? rule.workingSets : 1;
}

/**
 * Ben, 19 Oct ("imported targets - say 3 sets of imported history"): when
 * the latest comparable session is from FitNotes, 3 judged sets of imported
 * history are enough for the rule to judge it, even when the rule asks for
 * more sets than that session had.
 *
 * What counts: the judged working sets (`readFitNotesWorkingSets`: the sets
 * at the working load, plus harder sets judged with it; never a ramp
 * warm-up, a lone top set kept as context or a lighter finisher) summed over
 * the recent run of comparable imported sessions: the latest and the ones
 * before it, back to the first in-app one, and only those within
 * `IMPORTED_HISTORY_DAYS` days of the latest (review limits-19oct S1: years
 * of old FitNotes sets never release a one-set hold). The latest session's
 * own judged sets still decide: every one must reach the top of the range
 * within the effort limit. So `2 × 10` with an imported `2 × 9` a week
 * earlier (4 sets) progresses; a lone imported `2 × 10` (2 sets) holds, and
 * so does `1 × 10` with 2 sets from months before. In-app history is
 * unchanged: it needs the rule's sets.
 */
export const MIN_IMPORTED_SETS = 3;
/** An earlier imported session counts toward `MIN_IMPORTED_SETS` only within this many days of the latest. */
export const IMPORTED_HISTORY_DAYS = 28;

/** Judged sets (pairs, when sided) in the recent run of imported sessions from the latest (`MIN_IMPORTED_SETS`). */
function importedHistorySets(sessions: readonly SessionEval[]): number {
  const latest = sessions[0];
  if (latest === undefined) return 0;
  const from = toMs(latest.performedAtUtc) - IMPORTED_HISTORY_DAYS * 86_400_000;
  let n = 0;
  for (const s of sessions) {
    if (!s.imported || toMs(s.performedAtUtc) < from) break;
    if (!s.unpairable) n += s.prescribedDone;
  }
  return n;
}

/**
 * The sets the latest session must have for the rule to judge it: the rule's
 * own (`requiredSets`), or, from FitNotes with `MIN_IMPORTED_SETS` judged
 * sets of imported history, the sets that session had (Ben, 19 Oct).
 */
function setsToJudge(rule: ProgressionRule, sessions: readonly SessionEval[]): { required: number; importedHistory: number | null } {
  const ruleSets = requiredSets(rule);
  const latest = sessions[0];
  if (latest === undefined || !latest.imported || latest.unpairable || latest.prescribedDone === 0 || latest.prescribedDone >= ruleSets) return { required: ruleSets, importedHistory: null };
  const n = importedHistorySets(sessions);
  return n >= MIN_IMPORTED_SETS ? { required: latest.prescribedDone, importedHistory: n } : { required: ruleSets, importedHistory: null };
}

function countedLabel(rule: ProgressionRule, n: number): string {
  const noun = rule.method === 'double_progression' ? 'working set' : 'top set';
  return n === 1 ? noun : `${noun}s`;
}

function criteriaOf(rule: ProgressionRule): Criteria {
  return rule.method === 'double_progression'
    ? { repRange: rule.repRange, maxRpeToProgress: rule.maxRpeToProgress, minRirToProgress: rule.minRirToProgress }
    : rule.topSet;
}

/** Latest first; equal timestamps are ordered by session ID so input order never matters. */
function byRecency(a: HistorySession, b: HistorySession): number {
  const d = toMs(b.performedAtUtc) - toMs(a.performedAtUtc);
  if (d !== 0) return d;
  return a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0;
}

/** Every set within the rule's effort limits (sets without a recorded effort pass). */
function effortWithin(sets: readonly HistorySet[], criteria: Criteria): boolean {
  return sets.every(
    (x) =>
      !(criteria.maxRpeToProgress !== null && x.rpe !== null && x.rpe > criteria.maxRpeToProgress) &&
      !(criteria.minRirToProgress !== null && x.rir !== null && x.rir < criteria.minRirToProgress),
  );
}

function evalSide(sets: readonly HistorySet[], criteria: Criteria): SideEval {
  const reps = sets.map((x) => x.reps ?? 0);
  return {
    sets: sets.length,
    minReps: reps.length === 0 ? 0 : Math.min(...reps),
    allHitTop: reps.length > 0 && reps.every((r) => r >= criteria.repRange.max),
    effortOk: effortWithin(sets, criteria),
  };
}

/** Keep only like-for-like sessions: same equipment instance, unit and convention. */
function comparableSessions(ctx: Ctx): SessionEval[] {
  const { input } = ctx;
  const types = countedTypes(input.rule);
  const criteria = criteriaOf(input.rule);
  const wantedEquipment = input.equipment?.id ?? null;
  const out: SessionEval[] = [];
  let excluded = 0;

  // B7: imported (FitNotes) history counts on any equipment, read from its working sets only.
  /** The latest comparable session, when it came from FitNotes: how many lighter sets were read as a warm-up ramp. */
  let latestFitNotes: { rampDropped: number } | null = null;
  for (const s of [...input.history].sort(byRecency)) {
    const kept = comparableSetsOf(s);
    const builderFormat = builderFormatSets(input.rule, s, kept);
    const sessionTypes = builderFormat ? BUILDER_FORMAT_TYPES : types;
    const typed = kept.filter((x) => sessionTypes.includes(x.setType) && x.reps !== null);
    // §2.13: a set Ben marked (spotted, pain, form broke, other equipment) is
    // left out here, including the unit check (a flagged set on other
    // equipment doesn't make the session incomparable).
    const counted = typed.filter((x) => isSetCountable(x, 'progression'));
    const mismatched = counted.some(
      (x) =>
        x.load !== null &&
        x.load.convention !== 'bodyweight' &&
        (x.load.unit !== ctx.unit || x.load.convention !== ctx.convention),
    );
    if (!matchesEquipment(s, wantedEquipment, input.comparableEquipmentIds) || mismatched || (s.imported && typed.length === 0)) {
      excluded += 1;
      continue;
    }
    if (s.imported && out.length === 0) latestFitNotes = { rampDropped: s.sets.length - comparableSetsOf(s).length };
    const loads = counted.map((x) => (x.load === null || x.load.convention === 'bodyweight' ? null : x.load.value));
    const numeric = loads.filter((l): l is number => l !== null);
    const easiest =
      numeric.length === 0 ? null : ctx.direction === 'resistance' ? Math.min(...numeric) : Math.max(...numeric);
    // Builder format: planned from the top set (the hardest top load), judged on top and back-offs.
    const topLoads = builderFormat ? counted.filter((x) => x.setType === 'top' && x.load !== null && x.load.convention !== 'bodyweight').map((x) => x.load?.value ?? 0) : [];
    const topLoad = topLoads.length === 0 ? null : ctx.direction === 'resistance' ? Math.max(...topLoads) : Math.min(...topLoads);
    const backLoads = builderFormat ? counted.filter((x) => x.setType === 'backoff' && x.load !== null && x.load.convention !== 'bodyweight').map((x) => x.load?.value ?? 0) : [];
    const backoffLoad = backLoads.length === 0 ? null : ctx.direction === 'resistance' ? Math.min(...backLoads) : Math.max(...backLoads);
    // Import-progress r3 B1: a FitNotes session is planned from its working load
    // (the load with the most sets, ties to the easiest) and judged on the sets
    // there, plus harder sets unless they are a lone top set. Lighter finishers
    // are never judged or planned from.
    const reading = s.imported ? readFitNotesWorkingSets(counted) : null;
    const judged = reading ? reading.judged : counted;
    const planLoad = reading ? (reading.reference?.value ?? null) : builderFormat && topLoad !== null ? topLoad : easiest;
    const atPlan = reading
      ? judged.filter((x) => !reading.harderJudged.includes(x))
      : builderFormat && topLoad !== null
        ? counted.filter((x) => x.load !== null && toScaled(x.load.value) === toScaled(topLoad))
        : counted;
    const reps = judged.map((x) => x.reps ?? 0);
    const allHitTop = reps.length > 0 && reps.every((r) => r >= criteria.repRange.max);
    let increaseFrom: number | null = null;
    if (reading && reading.harderJudged.length > 0 && allHitTop) {
      for (const x of reading.harderJudged) {
        const l = x.load?.value ?? null;
        if (l !== null && (increaseFrom === null || harder(l, increaseFrom, ctx.direction))) increaseFrom = l;
      }
    }
    const wantsEffort = criteria.maxRpeToProgress !== null || criteria.minRirToProgress !== null;
    let missingEffort = 0;
    for (const x of judged) {
      const recorded = (criteria.maxRpeToProgress !== null && x.rpe !== null) || (criteria.minRirToProgress !== null && x.rir !== null);
      if (wantsEffort && !recorded) missingEffort += 1;
    }
    const sided = counted.some((x) => x.side === 'left' || x.side === 'right');
    const unpairable = sided && counted.some((x) => x.side === null);
    // r3 S1: only judged sets count toward the rule's sets (a lone top set kept as
    // context, or a finisher left out, never makes up a 3-set rule).
    const left = judged.filter((x) => x.side === 'left');
    const right = judged.filter((x) => x.side === 'right');
    const both = judged.filter((x) => x.side === 'both');
    const eval_: SessionEval = {
      sessionId: s.sessionId,
      imported: s.imported,
      performedAtUtc: s.performedAtUtc,
      loggedSets: counted.length,
      otherSets: (s.imported ? comparableSetsOf(s).length : s.sets.length) - typed.length,
      leftOut: typed.length - counted.length,
      prescribedDone: sided ? both.length + Math.min(left.length, right.length) : judged.length,
      sides: sided ? { left: evalSide([...both, ...left], criteria), right: evalSide([...both, ...right], criteria) } : null,
      unpairable,
      load: planLoad,
      backoffLoad: builderFormat && topLoad !== null && backoffLoad !== null && harder(topLoad, backoffLoad, ctx.direction) ? backoffLoad : null,
      judgedSets: judged.length,
      contextSets: reading?.context.length ?? 0,
      harderJudged: reading?.harderJudged.length ?? 0,
      easierLeftOut: reading?.easier.length ?? 0,
      increaseFrom,
      minReps: reps.length === 0 ? 0 : Math.min(...reps),
      judgedReps: reps,
      allHitTop,
      anyBelowFloor: atPlan.some((x) => (x.reps ?? 0) < criteria.repRange.min),
      effortOk: effortWithin(judged, criteria),
      missingEffort,
    };
    out.push(eval_);
  }
  if (latestFitNotes !== null) {
    const n = latestFitNotes.rampDropped;
    pushFact(ctx, `Last session is from FitNotes (equipment not recorded)${n > 0 ? `; its ${n} lighter set${n === 1 ? '' : 's'} before the top set ${n === 1 ? 'was' : 'were'} read as warm-ups` : ''}.`);
  }
  const latest = out[0];
  if (latest?.imported === true && latest.load !== null) {
    const hard = ctx.direction === 'resistance' ? 'heavier' : 'less-assisted';
    const easy = ctx.direction === 'resistance' ? 'lighter' : 'more-assisted';
    const at = fmt(ctx, latest.load);
    const sets = (n: number) => `${n} set${n === 1 ? '' : 's'}`;
    if (latest.contextSets > 0) {
      const n = latest.contextSets;
      pushFact(ctx, `${n} ${hard} top set${n === 1 ? ' was' : 's were'} kept as context; reps were judged on the ${sets(latest.judgedSets)} at ${at}.`);
    }
    if (latest.harderJudged > 0) {
      // r4 N1: word it from the counts, never "no load had most of the sets".
      const n = latest.harderJudged;
      const atRef = latest.judgedSets - n;
      pushFact(ctx, `The ${n} ${hard} set${n === 1 ? ' was' : 's were'} judged too, with the ${sets(atRef)} at ${at}.`);
    }
    if (latest.easierLeftOut > 0) {
      const n = latest.easierLeftOut;
      pushFact(ctx, `${n} ${easy} set${n === 1 ? '' : 's'} than ${at} (a finisher or drop set) ${n === 1 ? 'was' : 'were'} not judged.`);
    }
  }
  if (excluded > 0) {
    pushFact(
      ctx,
      `${excluded} earlier session${excluded === 1 ? ' was' : 's were'} left out because the equipment, unit or load convention differs.`,
    );
  }
  return out;
}

function harder(a: number, b: number, d: LoadDirection): boolean {
  return d === 'resistance' ? toScaled(a) > toScaled(b) : toScaled(a) < toScaled(b);
}

/**
 * The load to prescribe when holding at the historical load `value`. If that
 * load isn't on the equipment any more, round toward easier and say so. If the
 * equipment can't make any load, prescribe none (never the raw, unachievable value).
 */
function feasibleHold(ctx: Ctx, value: number | null): number | null {
  const eq = ctx.input.equipment;
  if (value === null) return null;
  if (eq === null) {
    // Review failure-tests M2: with no equipment profile there is nothing to snap to, so a
    // logged 0 would be planned as "0 kg each" or "assist 0 kg". Only `added` has a real zero.
    if (toScaled(value) <= 0 && ctx.convention !== 'added') {
      pushFact(ctx, `Last load was ${formatLoad({ value, unit: ctx.unit, convention: ctx.convention })}, which isn't a load to plan; enter your load.`);
      return null;
    }
    return value;
  }
  const load = { value, unit: ctx.unit, convention: ctx.convention };
  if (isLoadAchievable(load, eq)) return value;
  const r = roundToAvailableLoad(load, eq, 'easier');
  if (!r.ok) {
    ctx.infeasible = true;
    pushFact(ctx, `${eq.name} has no achievable loads with its current settings (check its min and max), so no load is prescribed.`);
    return null;
  }
  pushFact(ctx, `Last load ${formatLoad(load)} is no longer available on ${eq.name}; using ${formatLoad(r.load)}.`);
  return r.load.value;
}

type Step =
  | { kind: 'load'; value: number }
  | { kind: 'at_max' }
  /** Assisted: none left (`next` false), or, with no machine profile, the next step would leave none (`next` true). */
  | { kind: 'no_assistance_left'; next: boolean }
  | { kind: 'jump_too_big'; next: number; limit: string }
  | { kind: 'no_loads' };

function nextHarderLoad(ctx: Ctx, current: number): Step {
  const rule = ctx.input.rule;
  const inc = convertMass(rule.loadIncrement, ctx.unit).value;
  const desired = ctx.direction === 'resistance' ? current + inc : Math.max(0, current - inc);
  const eq = ctx.input.equipment;
  if (eq === null) {
    if (!harder(desired, current, ctx.direction)) return { kind: 'no_assistance_left', next: false };
    // Competitor-failure pack (b): never "assist 0 kg". With no machine profile there's no
    // smaller step to check, so the assistance is held and reps progress instead (as at the max).
    if (ctx.direction === 'assistance' && toScaled(desired) <= 0) return { kind: 'no_assistance_left', next: true };
    return { kind: 'load', value: desired };
  }
  const loads = getAchievableLoads(eq).loads;
  if (loads.length === 0) return { kind: 'no_loads' };
  const candidates = loads.filter((l) => harder(l, current, ctx.direction));
  if (candidates.length === 0) return { kind: 'at_max' };
  const rounded = roundToAvailableLoad({ value: desired, unit: ctx.unit, convention: ctx.convention }, eq, 'nearest');
  let chosen: number;
  if (rounded.ok && harder(rounded.load.value, current, ctx.direction)) chosen = rounded.load.value;
  else chosen = ctx.direction === 'resistance' ? Math.min(...candidates) : Math.max(...candidates);

  if (rule.maxLoadJump !== null) {
    const maxJump = convertMass(rule.maxLoadJump, ctx.unit).value;
    if (Math.abs(toScaled(chosen) - toScaled(current)) > toScaled(maxJump)) {
      return { kind: 'jump_too_big', next: chosen, limit: `${fromScaled(toScaled(maxJump))} ${ctx.unit}` };
    }
  }
  // Playbook 7-F: more than ~10% heavier is too big a step; reps progress instead. Resistance only.
  const pct = rule.maxLoadJumpPercent;
  if (pct !== undefined && ctx.direction === 'resistance' && toScaled(current) > 0) {
    if ((toScaled(chosen) - toScaled(current)) * 100 > toScaled(current) * pct) {
      return { kind: 'jump_too_big', next: chosen, limit: `${String(pct)}%` };
    }
  }
  return { kind: 'load', value: chosen };
}

/**
 * The stall reset (7-F / ADR 0006, playbook rule 8): the achievable load nearest the rule's cut inside the 5–10% band,
 * or one step easier when the kit has nothing in the band (Ben, 23 Oct; `stallResetLoad`).
 */
function reducedLoad(ctx: Ctx, current: number): number | null {
  const eq = ctx.input.equipment;
  return stallResetLoad(current, eq === null ? null : getAchievableLoads(eq).loads, ctx.direction, ctx.input.rule.reducePercent);
}

/** Equipment that can make no load: say so plainly and prescribe nothing (review R3). */
function noFeasibleLoad(ctx: Ctx, eq: EquipmentInstance | null, criteria: Criteria): PrimaryDecision {
  ctx.infeasible = true;
  const eqName = eq?.name ?? 'This equipment';
  pushFact(ctx, `${eqName} has no achievable loads with its current settings (check its min and max), so no load is prescribed.`);
  return {
    decision: 'no_feasible_load',
    load: null,
    reps: criteria.repRange,
    summary: `${eqName} can't make any load with its current min/max settings, so no ${ctx.input.exerciseName} target is set. Fix the equipment profile.`,
  };
}

interface PrimaryDecision {
  decision: ProgressionDecision;
  load: number | null;
  reps: RepRange;
  summary: string;
  /** The miss streak reached `failuresBeforeReduce` at the same load (`NextTargets.stalled`). */
  stalled?: true;
  /** The reset offered and not applied (`NextTargets.resetOffer`). */
  resetTo?: number;
}

/** Starting point when there is no usable history. */
function startingPoint(ctx: Ctx, criteria: Criteria, lead: string): PrimaryDecision {
  const { input } = ctx;
  const rule = input.rule;
  let start: number | null = null;
  if (rule.startingLoad !== null && ctx.convention !== 'bodyweight') {
    if (input.equipment) {
      const value = convertMass(rule.startingLoad, ctx.unit).value;
      const r = roundToAvailableLoad({ value, unit: ctx.unit, convention: ctx.convention }, input.equipment, 'easier');
      if (r.ok) start = r.load.value;
      else {
        ctx.infeasible = true;
        pushFact(ctx, `${input.equipment.name} has no achievable loads with its current settings, so no starting load is prescribed.`);
      }
    } else {
      // Same rule as planned loads (ADR 0003): convert only when exact, never approximate silently.
      const exact = convertMassExactly(rule.startingLoad, ctx.unit);
      if (exact) start = exact.value;
      else pushFact(ctx, `The rule's starting load is in ${rule.startingLoad.unit} and doesn't convert exactly to ${ctx.unit}, so it isn't used.`);
    }
  }
  return {
    decision: 'insufficient_data',
    load: start,
    reps: criteria.repRange,
    summary:
      start === null
        ? `${lead} Pick a load you can do for ${range(criteria.repRange)} reps.`
        : `${lead} Starting at ${fmt(ctx, start)} for ${range(criteria.repRange)} reps.`,
  };
}

function decidePrimary(ctx: Ctx, sessions: SessionEval[], criteria: Criteria): PrimaryDecision {
  const { input } = ctx;
  const rule = input.rule;
  const name = input.exerciseName;
  const latest = sessions[0];
  // The most recent session in which anything counted was performed: the load reference.
  const reference = sessions.find((s) => s.loggedSets > 0);

  if (input.pain.active) {
    const held = reference ? feasibleHold(ctx, reference.load) : null;
    const when = input.pain.reportedAtUtc ? ` on ${day(input.pain.reportedAtUtc)}` : '';
    pushFact(ctx, 'Targets are not increased while a pain flag is active. Clear the flag when you are ready.');
    return {
      decision: 'halted_pain',
      load: held,
      reps: criteria.repRange,
      summary: `Progression for ${name} is paused because pain was reported${when}. Targets are not increased.`,
    };
  }

  const eq = input.equipment;
  if (eq !== null && ctx.convention !== 'bodyweight' && getAchievableLoads(eq).loads.length === 0) {
    return noFeasibleLoad(ctx, eq, criteria);
  }

  if (!latest) return startingPoint(ctx, criteria, `No comparable ${name} history yet.`);

  const { required, importedHistory } = setsToJudge(rule, sessions);
  const when = day(latest.performedAtUtc);
  if (importedHistory !== null) {
    const n = latest.prescribedDone;
    pushFact(ctx, `Judged on the ${n} ${countedLabel(rule, n)} on ${when}: ${importedHistory} sets of imported history are enough.`);
  }
  if (latest.loggedSets === 0 && latest.leftOut > 0) {
    pushFact(ctx, allLeftOutFact(when));
  } else if (latest.loggedSets === 0) {
    // Review minor 7: say "no top set" when back-off (or other) sets were logged.
    const why = latest.otherSets === 0 ? 'all skipped' : rule.method === 'double_progression' ? 'only other set types' : 'no top set';
    pushFact(ctx, `No ${countedLabel(rule, 2)} were logged on ${when} (${why}); holding.`);
  } else if (latest.unpairable) {
    pushFact(ctx, `Some ${name} sets on ${when} have a left or right side and others have none, so the sides can't be compared; holding.`);
  } else if (latest.sides !== null && latest.prescribedDone < required) {
    const { left, right } = latest.sides;
    const behind = left.sets === right.sets ? '' : `: the ${left.sets < right.sets ? 'left' : 'right'} side is behind`;
    const lead = latest.prescribedDone === 0 ? 'None' : `Only ${latest.prescribedDone}`;
    pushFact(
      ctx,
      `${lead} of ${required} ${countedLabel(rule, required)} had both sides logged on ${when} (left ${left.sets}, right ${right.sets}${behind}); holding.`,
    );
  } else if (latest.prescribedDone < required) {
    const verb = latest.prescribedDone === 1 ? 'was' : 'were';
    pushFact(
      ctx,
      // r4 S1: FitNotes sets are read (ramp, context, finisher), so say "judged", never "logged".
      latest.imported
        ? `Only ${latest.prescribedDone} of ${required} ${countedLabel(rule, required)} ${verb} judged on ${when}; holding.`
        : latest.leftOut > 0
        ? `Only ${latest.prescribedDone} of ${required} ${countedLabel(rule, required)} counted on ${when} (${latest.leftOut} left out); holding.`
        : `Only ${latest.prescribedDone} of ${required} ${countedLabel(rule, required)} ${verb} logged on ${when}; holding.`,
    );
  }
  if (!reference) {
    return startingPoint(ctx, criteria, `No completed ${name} sets to compare yet.`);
  }

  const L = reference.load;
  const lastText = fmt(ctx, L);
  // Review failure-tests-r2 S2: with no equipment profile, a logged 0 on a load with no real zero
  // (total, each, stack) isn't a reference to build on: never plan 0 + one step (a "2.5 kg barbell").
  if (L !== null && (input.equipment ?? null) === null && ctx.direction === 'resistance' && ctx.convention !== 'added' && ctx.convention !== 'bodyweight' && toScaled(L) <= 0) {
    return startingPoint(ctx, criteria, `Last load was ${formatLoad({ value: L, unit: ctx.unit, convention: ctx.convention })}, which isn't a load to plan.`);
  }
  const complete = latest.prescribedDone >= required && !latest.unpairable;
  if (complete && latest.sides !== null) {
    // Review R4: the load goes up only when both sides qualify; say which side lagged.
    const ok = (x: SideEval) => x.allHitTop && x.effortOk;
    const { left, right } = latest.sides;
    if (ok(left) !== ok(right)) {
      const [good, lagName, lag] = ok(left) ? ['left', 'right', right] : ['right', 'left', left];
      // Third review follow-up 1: name what the lagging side actually missed.
      const top = `${criteria.repRange.max}+ reps`;
      const lagText = !lag.allHitTop
        ? `the ${lagName} side didn't (lowest ${lag.minReps} reps)`
        : `the ${lagName} side reached ${top} with effort above the limit`;
      pushFact(
        ctx,
        `The ${good} side reached ${top} on every set within the effort limit, but ${lagText}; the load goes up only when both sides do.`,
      );
    }
  }
  if (latest.missingEffort > 0) {
    pushFact(ctx, `Effort wasn't recorded for ${latest.missingEffort} set${latest.missingEffort === 1 ? '' : 's'}; reps alone were used.`);
  }

  if (complete && latest.allHitTop && latest.effortOk) {
    // r3 B1: from FitNotes, count the sets actually judged.
    const n = latest.judgedSets;
    const judgedText = n === 1 ? 'the 1 judged set' : `all ${n} judged sets`;
    // r4 B1: harder sets judged and all at the top: the increase starts from the hardest of them.
    const base = latest.increaseFrom ?? L;
    const baseText = fmt(ctx, base);
    const hardest = ctx.direction === 'resistance' ? 'the heaviest' : 'the least-assisted';
    const which = !latest.imported
      ? `every counted set reached ${criteria.repRange.max}+ reps at ${lastText}`
      : latest.increaseFrom !== null
        ? `${judgedText} reached ${criteria.repRange.max}+ reps, ${hardest} at ${baseText}`
        : `${judgedText} reached ${criteria.repRange.max}+ reps at ${lastText}`;
    pushFact(ctx, `Last session: ${which}.`);
    const cap = rule.ceilingRepCap;
    /** Progress reps at the held load. All text names the prescribed load, never the historical one. */
    const repStep = (reasonFor: (target: string) => string): PrimaryDecision => {
      const held = feasibleHold(ctx, base);
      const target = fmt(ctx, held);
      const reason = reasonFor(target);
      const n = Math.max(latest.minReps + 1, criteria.repRange.max + 1);
      if (n > cap) {
        return {
          decision: 'ceiling_reached',
          load: held,
          reps: { min: Math.min(criteria.repRange.max, cap), max: cap },
          summary: `${name} has reached the rep cap (${cap}) at ${target} because ${reason}. Consider a substitution or another set.`,
        };
      }
      return {
        decision: 'increase_reps',
        load: held,
        reps: { min: n, max: n },
        summary: `Add a rep: aim for ${n} at ${target}, because ${reason}.`,
      };
    };
    if (base === null) return repStep(() => 'there is no external load to add');
    const step = nextHarderLoad(ctx, base);
    const eqName = input.equipment?.name ?? 'this equipment';
    switch (step.kind) {
      case 'load': {
        const verb = ctx.direction === 'resistance' ? 'Increase' : 'Reduce assistance';
        return {
          decision: 'increase_load',
          load: step.value,
          reps: criteria.repRange,
          summary: `${verb} to ${fmt(ctx, step.value)} for ${range(criteria.repRange)} reps.`,
        };
      }
      case 'at_max': {
        // Only reached when L is at or beyond the hardest load, so the held load is that hardest load.
        const where = ctx.direction === 'resistance' ? 'the heaviest' : 'the least-assisted';
        return repStep((target) => `${target} is ${where} load available on ${eqName}`);
      }
      case 'no_assistance_left':
        return repStep(() => (step.next ? 'the next step would leave no assistance' : 'there is no assistance left to remove'));
      case 'jump_too_big':
        return repStep(
          () =>
            `the next available load, ${fmt(ctx, step.next)}, is a bigger jump than the rule allows (${step.limit})`,
        );
      case 'no_loads':
        // Unreachable: handled before any history is read. Kept so the switch stays exhaustive.
        return noFeasibleLoad(ctx, input.equipment ?? null, criteria);
    }
  }

  if (latest.loggedSets > 0 && latest.anyBelowFloor) {
    let streak = 0;
    for (const s of sessions) {
      const sameLoad = (s.load === null && L === null) || (s.load !== null && L !== null && toScaled(s.load) === toScaled(L));
      if (s.loggedSets === 0 || !s.anyBelowFloor || !sameLoad) break;
      streak += 1;
    }
    const needed = rule.failuresBeforeReduce;
    const stalled = streak >= needed && L !== null;
    if (stalled) {
      const reduced = reducedLoad(ctx, L);
      if (reduced !== null) {
        pushFact(ctx, `${streak} sessions in a row fell below ${criteria.repRange.min} reps at ${lastText}.`);
        if (input.acceptReset === true) {
          return {
            decision: 'reduce_load',
            load: reduced,
            reps: criteria.repRange,
            summary: `Repeated misses at ${lastText}: reduce to ${fmt(ctx, reduced)} and build back up.`,
            stalled: true,
          };
        }
        // (Ben, 23 Oct; review v5offers SP2) A reset is an offer: the rule holds until Ben applies it.
        const held = feasibleHold(ctx, L);
        return {
          decision: 'hold_after_miss',
          load: held,
          reps: criteria.repRange,
          summary: `${held === L ? 'Repeat' : 'Use'} ${fmt(ctx, held)} for ${range(criteria.repRange)} reps, or reset to ${fmt(ctx, reduced)}.`,
          stalled: true,
          resetTo: reduced,
        };
      }
      pushFact(ctx, 'No easier load is available on this equipment.');
    } else {
      pushFact(
        ctx,
        `One session below ${criteria.repRange.min} reps is treated as a bad day, not a trend (${streak} of ${needed} needed to reduce).`,
      );
    }
    const held = feasibleHold(ctx, L);
    const sameAsLast = held === L;
    return {
      decision: 'hold_after_miss',
      load: held,
      reps: criteria.repRange,
      summary: `${sameAsLast ? 'Repeat' : 'Use'} ${fmt(ctx, held)} for ${range(criteria.repRange)} reps.`,
      // Stalled at the easiest load this equipment has (review v5offers 6): still rule 8's stall.
      ...(stalled ? { stalled: true as const } : {}),
    };
  }

  if (complete && latest.allHitTop && !latest.effortOk) {
    pushFact(ctx, 'Reps reached the top of the range, but effort was above the rule’s limit.');
  }
  const held = feasibleHold(ctx, L);
  return {
    decision: 'hold',
    load: held,
    reps: criteria.repRange,
    summary: `Stay at ${fmt(ctx, held)} and work toward ${criteria.repRange.max} reps on every set.`,
  };
}

/**
 * (Builder-loads review S4) When the session the rule planned from was a
 * top set + back-offs: the other working sets' load, the last back-off load
 * moved by the same step as the top set (rounded toward easier, never harder
 * than the first set). Null otherwise: every set takes the first set's load.
 */
function builderFormatOtherLoad(ctx: Ctx, sessions: readonly SessionEval[], first: number | null): Load | null {
  const from = sessions.find((s) => s.loggedSets > 0);
  if (first === null || from === undefined || from.backoffLoad === null || from.load === null) return null;
  let raw = from.backoffLoad + (first - from.load);
  if (harder(raw, first, ctx.direction)) raw = first;
  if (!(raw > 0)) return null;
  const eq = ctx.input.equipment;
  if (eq) {
    const r = roundToAvailableLoad({ value: raw, unit: ctx.unit, convention: ctx.convention }, eq, 'easier');
    if (!r.ok) return null;
    pushFact(ctx, `The other sets follow your back-offs (${fmt(ctx, from.backoffLoad)}), moved by the same step: ${formatLoad(r.load)}.`);
    return r.load;
  }
  return asLoad(ctx, raw);
}

/**
 * (Reps from history, 21 Oct) The newest comparable session the rule would
 * plan from (the same reading as `calculateNextTargets`: like-for-like
 * equipment, FitNotes working sets, builder-format top + back-offs): its
 * judged reps, the load it plans from, and whether every judged set was
 * within the rule's effort limit (sets without a recorded effort pass).
 * Null when there's none.
 */
export function latestJudgedSession(input: NextTargetsInput): { reps: number[]; load: number | null; direction: LoadDirection; effortOk: boolean } | null {
  const unit = input.equipment?.unit ?? input.unit;
  const convention = input.equipment?.loadConvention ?? input.convention;
  const ctx: Ctx = { input, unit, convention, direction: loadDirection(convention), facts: [], infeasible: false };
  const ref = comparableSessions(ctx).find((s) => s.loggedSets > 0);
  return ref === undefined ? null : { reps: ref.judgedReps, load: ref.load, direction: ctx.direction, effortOk: ref.effortOk };
}

/**
 * Deterministic next-session targets with an inspectable explanation
 * (brief §3, §7). Loads are always achievable on the given equipment and never
 * above its maximum; at the ceiling, reps progress instead. Progress needs every
 * prescribed counted set completed at the top of the range; otherwise hold. One
 * poor session holds; only a repeated trend reduces. An active pain flag halts
 * progression. The output does not depend on the order of `history`.
 */
export function calculateNextTargets(input: NextTargetsInput): NextTargets {
  const unit = input.equipment?.unit ?? input.unit;
  const convention = input.equipment?.loadConvention ?? input.convention;
  const ctx: Ctx = { input, unit, convention, direction: loadDirection(convention), facts: [], infeasible: false };
  const rule = input.rule;
  const ruleRef = { id: rule.id, version: rule.version, method: rule.method, name: rule.name };
  const unsupported = (summary: string): NextTargets => ({
    decision: 'unsupported',
    sets: [],
    loadFeasibility: 'not_applicable',
    rule: ruleRef,
    explanation: { summary, facts: [] },
    basedOnSessionIds: [],
  });

  if (input.measurement === 'duration') {
    return unsupported(`Time-based progression isn't supported yet, so ${input.exerciseName} targets stay as planned.`);
  }
  if (input.measurement === 'cardio') {
    // Cardio (19 Oct): never progressed by load or reps; next time repeats last time's time and distance.
    return unsupported(`${input.exerciseName} isn't progressed: next time repeats your last time and distance.`);
  }
  if (input.measurement === 'distance') {
    return unsupported(`Distance-based progression isn't supported yet, so ${input.exerciseName} targets stay as planned.`);
  }
  if (rule.method === 'top_set_backoff' && ctx.direction === 'assistance') {
    return unsupported('Top-set/back-off rules are not supported on assisted machines. Use double progression instead.');
  }

  const criteria = criteriaOf(rule);
  const sessions = comparableSessions(ctx);
  const decided = decidePrimary(ctx, sessions, criteria);
  // B7 (P-I3): a load built on FitNotes history needs equipment here to be checked on; with none, none is prescribed.
  const fromFitNotes = sessions.find((s) => s.loggedSets > 0)?.imported === true;
  const unchecked = fromFitNotes && input.equipment === null && input.fitLater !== true && convention !== 'bodyweight' && decided.load !== null;
  if (unchecked) pushFact(ctx, `No equipment here to check the FitNotes load (${fmt(ctx, decided.load)}) on, so no load is prescribed; enter your load.`);
  const primary = unchecked ? { ...decided, load: null, summary: `Pick a load you can do for ${range(criteria.repRange)} reps.` } : decided;
  const primaryLoad = asLoad(ctx, primary.load);

  const sets: TargetSet[] = [];
  if (rule.method === 'double_progression') {
    const otherLoad = builderFormatOtherLoad(ctx, sessions, primary.load) ?? primaryLoad;
    for (let i = 0; i < rule.workingSets; i += 1) sets.push({ setType: 'working', load: i === 0 ? primaryLoad : otherLoad, reps: primary.reps });
  } else {
    sets.push({ setType: 'top', load: primaryLoad, reps: primary.reps });
    let backoff: Load | null = null;
    if (primary.load !== null) {
      const raw = (primary.load * rule.backoff.percentOfTop) / 100;
      if (input.equipment) {
        const r = roundToAvailableLoad({ value: raw, unit, convention }, input.equipment, 'easier');
        if (r.ok) backoff = r.load;
        else ctx.infeasible = true;
      } else {
        backoff = asLoad(ctx, raw);
      }
      if (backoff) {
        pushFact(ctx, `Back-off sets use ${rule.backoff.percentOfTop}% of the top set, rounded down to ${formatLoad(backoff)}.`);
      }
    }
    for (let i = 0; i < rule.backoff.sets; i += 1) sets.push({ setType: 'backoff', load: backoff, reps: rule.backoff.repRange });
  }

  const anyLoad = sets.some((s) => s.load !== null && s.load.convention !== 'bodyweight');
  const resetOffer = primary.resetTo === undefined || unchecked ? null : asLoad(ctx, primary.resetTo);
  return {
    decision: primary.decision,
    sets,
    loadFeasibility: ctx.infeasible ? 'infeasible' : !anyLoad ? 'not_applicable' : input.equipment ? 'checked' : 'unchecked',
    rule: ruleRef,
    explanation: { summary: primary.summary, facts: ctx.facts },
    basedOnSessionIds: sessions.map((s) => s.sessionId),
    ...(primary.stalled === true ? { stalled: true as const } : {}),
    ...(resetOffer !== null ? { resetOffer } : {}),
  };
}
