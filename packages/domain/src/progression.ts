import type {
  EquipmentInstance,
  Load,
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
import { toMs } from './time';
import { convertMass, convertMassExactly, fromScaled, toScaled } from './units';

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
   * Imported from FitNotes. Until P-I3 is decided (ADR 0016), imported
   * history is never comparable: it doesn't feed `Last`, targets, the summary
   * comparison or a highlight, whatever its equipment (review r2 B1). It
   * isn't enough that it has no equipment: an exercise with no equipment on
   * either side would otherwise match it.
   */
  imported: boolean;
  sets: readonly HistorySet[];
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
  /** Easiest counted load (lowest resistance / most assistance); null for bodyweight or no sets. */
  load: number | null;
  minReps: number;
  /** Every counted set reached the top of the range (false when nothing was counted). */
  allHitTop: boolean;
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

/** Sets that must be completed before the rule may progress (review B2, ADR 0003 S3). */
function requiredSets(rule: ProgressionRule): number {
  return rule.method === 'double_progression' ? rule.workingSets : 1;
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

  // Imported history isn't comparable (P-I3 open; review r2 B1): left out before anything is counted.
  for (const s of input.history.filter((h) => !h.imported).sort(byRecency)) {
    const counted = s.sets.filter((x) => types.includes(x.setType) && x.reps !== null);
    const mismatched = counted.some(
      (x) =>
        x.load !== null &&
        x.load.convention !== 'bodyweight' &&
        (x.load.unit !== ctx.unit || x.load.convention !== ctx.convention),
    );
    if (s.equipmentId !== wantedEquipment || mismatched) {
      excluded += 1;
      continue;
    }
    const loads = counted.map((x) => (x.load === null || x.load.convention === 'bodyweight' ? null : x.load.value));
    const numeric = loads.filter((l): l is number => l !== null);
    const easiest =
      numeric.length === 0 ? null : ctx.direction === 'resistance' ? Math.min(...numeric) : Math.max(...numeric);
    const reps = counted.map((x) => x.reps ?? 0);
    const wantsEffort = criteria.maxRpeToProgress !== null || criteria.minRirToProgress !== null;
    let missingEffort = 0;
    for (const x of counted) {
      const recorded = (criteria.maxRpeToProgress !== null && x.rpe !== null) || (criteria.minRirToProgress !== null && x.rir !== null);
      if (wantsEffort && !recorded) missingEffort += 1;
    }
    const left = counted.filter((x) => x.side === 'left');
    const right = counted.filter((x) => x.side === 'right');
    const both = counted.filter((x) => x.side === 'both');
    const sided = left.length + right.length > 0;
    const unpairable = sided && counted.some((x) => x.side === null);
    out.push({
      sessionId: s.sessionId,
      performedAtUtc: s.performedAtUtc,
      loggedSets: counted.length,
      otherSets: s.sets.length - counted.length,
      prescribedDone: sided ? both.length + Math.min(left.length, right.length) : counted.length,
      sides: sided ? { left: evalSide([...both, ...left], criteria), right: evalSide([...both, ...right], criteria) } : null,
      unpairable,
      load: easiest,
      minReps: reps.length === 0 ? 0 : Math.min(...reps),
      allHitTop: reps.length > 0 && reps.every((r) => r >= criteria.repRange.max),
      anyBelowFloor: reps.some((r) => r < criteria.repRange.min),
      effortOk: effortWithin(counted, criteria),
      missingEffort,
    });
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
  | { kind: 'jump_too_big'; next: number; maxJump: number }
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
      return { kind: 'jump_too_big', next: chosen, maxJump };
    }
  }
  return { kind: 'load', value: chosen };
}

function reducedLoad(ctx: Ctx, current: number): number | null {
  const pct = ctx.input.rule.reducePercent / 100;
  const eq = ctx.input.equipment;
  const desired = ctx.direction === 'resistance' ? current * (1 - pct) : current * (1 + pct);
  if (eq === null) return harder(current, desired, ctx.direction) ? desired : null;
  const loads = getAchievableLoads(eq).loads;
  const easier = loads.filter((l) => harder(current, l, ctx.direction));
  if (easier.length === 0) return null;
  const rounded = roundToAvailableLoad({ value: desired, unit: ctx.unit, convention: ctx.convention }, eq, 'easier');
  if (rounded.ok && harder(current, rounded.load.value, ctx.direction)) return rounded.load.value;
  // The percentage was smaller than the equipment step: use the next easier load.
  return ctx.direction === 'resistance' ? Math.max(...easier) : Math.min(...easier);
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

  const required = requiredSets(rule);
  const when = day(latest.performedAtUtc);
  if (latest.loggedSets === 0) {
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
    pushFact(
      ctx,
      `Only ${latest.prescribedDone} of ${required} ${countedLabel(rule, required)} ${latest.prescribedDone === 1 ? 'was' : 'were'} logged on ${when}; holding.`,
    );
  }
  if (!reference) {
    return startingPoint(ctx, criteria, `No completed ${name} sets to compare yet.`);
  }

  const L = reference.load;
  const lastText = fmt(ctx, L);
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
    pushFact(ctx, `Last session: every counted set reached ${criteria.repRange.max}+ reps at ${lastText}.`);
    const cap = rule.ceilingRepCap;
    /** Progress reps at the held load. All text names the prescribed load, never the historical one. */
    const repStep = (reasonFor: (target: string) => string): PrimaryDecision => {
      const held = feasibleHold(ctx, L);
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
    if (L === null) return repStep(() => 'there is no external load to add');
    const step = nextHarderLoad(ctx, L);
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
            `the next available load, ${fmt(ctx, step.next)}, is a bigger jump than the rule allows (${fromScaled(toScaled(step.maxJump))} ${ctx.unit})`,
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
    if (streak >= needed && L !== null) {
      const reduced = reducedLoad(ctx, L);
      if (reduced !== null) {
        pushFact(ctx, `${streak} sessions in a row fell below ${criteria.repRange.min} reps at ${lastText}.`);
        return {
          decision: 'reduce_load',
          load: reduced,
          reps: criteria.repRange,
          summary: `Repeated misses at ${lastText}: reduce to ${fmt(ctx, reduced)} and build back up.`,
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
  if (rule.method === 'top_set_backoff' && ctx.direction === 'assistance') {
    return unsupported('Top-set/back-off rules are not supported on assisted machines. Use double progression instead.');
  }

  const criteria = criteriaOf(rule);
  const sessions = comparableSessions(ctx);
  const primary = decidePrimary(ctx, sessions, criteria);
  const primaryLoad = asLoad(ctx, primary.load);

  const sets: TargetSet[] = [];
  if (rule.method === 'double_progression') {
    for (let i = 0; i < rule.workingSets; i += 1) sets.push({ setType: 'working', load: primaryLoad, reps: primary.reps });
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
  return {
    decision: primary.decision,
    sets,
    loadFeasibility: ctx.infeasible ? 'infeasible' : !anyLoad ? 'not_applicable' : input.equipment ? 'checked' : 'unchecked',
    rule: ruleRef,
    explanation: { summary: primary.summary, facts: ctx.facts },
    basedOnSessionIds: sessions.map((s) => s.sessionId),
  };
}
