import type {
  EquipmentInstance,
  Load,
  LoadConvention,
  ProgressionRule,
  RepRange,
  Rir,
  Rpe,
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
import { convertMass, fromScaled, toScaled } from './units';

export interface HistorySet {
  setType: SetType;
  load: Load | null;
  reps: number | null;
  rpe: Rpe | null;
  rir: Rir | null;
}

/** One past session of this exercise, as actually performed (corrections applied). */
export interface HistorySession {
  sessionId: string;
  performedAtUtc: string;
  equipmentId: string | null;
  sets: readonly HistorySet[];
}

/** Active pain flag for this movement. Set and cleared explicitly by the user. */
export interface PainStatus {
  active: boolean;
  reportedAtUtc: string | null;
}

export interface NextTargetsInput {
  exerciseName: string;
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
  | 'unsupported';

export interface TargetSet {
  setType: SetType;
  load: Load | null;
  reps: RepRange;
}

export interface NextTargets {
  decision: ProgressionDecision;
  sets: TargetSet[];
  /** `checked`: every load is achievable on the equipment. `unchecked`: no equipment profile. */
  loadFeasibility: 'checked' | 'unchecked' | 'not_applicable';
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

interface SessionEval {
  sessionId: string;
  performedAtUtc: string;
  /** Easiest counted load (lowest resistance / most assistance); null for bodyweight. */
  load: number | null;
  minReps: number;
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
}

export function formatLoad(load: Load | null): string {
  if (load === null || load.convention === 'bodyweight') return 'bodyweight';
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

function asLoad(ctx: Ctx, value: number | null): Load | null {
  if (value === null) return null;
  return { value: fromScaled(toScaled(value)), unit: ctx.unit, convention: ctx.convention };
}

function countedTypes(rule: ProgressionRule): SetType[] {
  return rule.method === 'double_progression' ? ['working'] : ['top'];
}

function criteriaOf(rule: ProgressionRule): Criteria {
  return rule.method === 'double_progression'
    ? { repRange: rule.repRange, maxRpeToProgress: rule.maxRpeToProgress, minRirToProgress: rule.minRirToProgress }
    : rule.topSet;
}

/** Keep only like-for-like sessions: same equipment instance, unit and convention. */
function comparableSessions(ctx: Ctx): SessionEval[] {
  const { input } = ctx;
  const types = countedTypes(input.rule);
  const criteria = criteriaOf(input.rule);
  const wantedEquipment = input.equipment?.id ?? null;
  const out: SessionEval[] = [];
  let excluded = 0;

  const sorted = [...input.history].sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  for (const s of sorted) {
    const counted = s.sets.filter((x) => types.includes(x.setType) && x.reps !== null);
    if (counted.length === 0) continue;
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
    let effortOk = true;
    let missingEffort = 0;
    for (const x of counted) {
      const rpeLimit = criteria.maxRpeToProgress;
      const rirLimit = criteria.minRirToProgress;
      if (rpeLimit !== null && x.rpe !== null && x.rpe > rpeLimit) effortOk = false;
      if (rirLimit !== null && x.rir !== null && x.rir < rirLimit) effortOk = false;
      const recorded = (rpeLimit !== null && x.rpe !== null) || (rirLimit !== null && x.rir !== null);
      if (wantsEffort && !recorded) missingEffort += 1;
    }
    out.push({
      sessionId: s.sessionId,
      performedAtUtc: s.performedAtUtc,
      load: easiest,
      minReps: Math.min(...reps),
      allHitTop: reps.every((r) => r >= criteria.repRange.max),
      anyBelowFloor: reps.some((r) => r < criteria.repRange.min),
      effortOk,
      missingEffort,
    });
  }
  if (excluded > 0) {
    ctx.facts.push(
      `${excluded} earlier session${excluded === 1 ? ' was' : 's were'} left out because the equipment, unit or load convention differs.`,
    );
  }
  return out;
}

function harder(a: number, b: number, d: LoadDirection): boolean {
  return d === 'resistance' ? toScaled(a) > toScaled(b) : toScaled(a) < toScaled(b);
}

/** Make sure a held load is still achievable (equipment may have changed); round toward easier if not. */
function feasibleHold(ctx: Ctx, value: number | null): number | null {
  const eq = ctx.input.equipment;
  if (value === null || eq === null) return value;
  const load = { value, unit: ctx.unit, convention: ctx.convention };
  if (isLoadAchievable(load, eq)) return value;
  const r = roundToAvailableLoad(load, eq, 'easier');
  if (!r.ok) return value;
  ctx.facts.push(`${formatLoad(load)} is no longer available on ${eq.name}; using ${formatLoad(r.load)}.`);
  return r.load.value;
}

type Step = { kind: 'load'; value: number } | { kind: 'ceiling'; reason: string };

function nextHarderLoad(ctx: Ctx, current: number): Step {
  const rule = ctx.input.rule;
  const inc = convertMass(rule.loadIncrement, ctx.unit).value;
  const desired = ctx.direction === 'resistance' ? current + inc : Math.max(0, current - inc);
  const eq = ctx.input.equipment;
  const currentLoad = asLoad(ctx, current);
  if (eq === null) {
    if (!harder(desired, current, ctx.direction)) return { kind: 'ceiling', reason: 'no assistance left to remove' };
    return { kind: 'load', value: desired };
  }
  const loads = getAchievableLoads(eq).loads;
  const candidates = loads.filter((l) => harder(l, current, ctx.direction));
  if (candidates.length === 0) {
    const where = ctx.direction === 'resistance' ? 'the heaviest' : 'the least-assisted';
    return { kind: 'ceiling', reason: `${formatLoad(currentLoad)} is ${where} load available on ${eq.name}` };
  }
  const rounded = roundToAvailableLoad({ value: desired, unit: ctx.unit, convention: ctx.convention }, eq, 'nearest');
  let chosen: number;
  if (rounded.ok && harder(rounded.load.value, current, ctx.direction)) chosen = rounded.load.value;
  else chosen = ctx.direction === 'resistance' ? Math.min(...candidates) : Math.max(...candidates);

  if (rule.maxLoadJump !== null) {
    const maxJump = convertMass(rule.maxLoadJump, ctx.unit).value;
    if (Math.abs(toScaled(chosen) - toScaled(current)) > toScaled(maxJump)) {
      return {
        kind: 'ceiling',
        reason: `the next available load, ${formatLoad(asLoad(ctx, chosen))}, is a bigger jump than the rule allows (${fromScaled(toScaled(maxJump))} ${ctx.unit})`,
      };
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

interface PrimaryDecision {
  decision: ProgressionDecision;
  load: number | null;
  reps: RepRange;
  summary: string;
}

function decidePrimary(ctx: Ctx, sessions: SessionEval[], criteria: Criteria): PrimaryDecision {
  const { input } = ctx;
  const rule = input.rule;
  const name = input.exerciseName;
  const latest = sessions[0];

  if (input.pain.active) {
    const held = latest ? feasibleHold(ctx, latest.load) : null;
    const when = input.pain.reportedAtUtc ? ` on ${input.pain.reportedAtUtc.slice(0, 10)}` : '';
    ctx.facts.push('Targets are not increased while a pain flag is active. Clear the flag when you are ready.');
    return {
      decision: 'halted_pain',
      load: held,
      reps: criteria.repRange,
      summary: `Progression for ${name} is paused because pain was reported${when}. Targets are not increased.`,
    };
  }

  if (!latest) {
    let start: number | null = null;
    if (rule.startingLoad !== null && ctx.convention !== 'bodyweight') {
      const value = convertMass(rule.startingLoad, ctx.unit).value;
      start = value;
      if (input.equipment) {
        const r = roundToAvailableLoad({ value, unit: ctx.unit, convention: ctx.convention }, input.equipment, 'easier');
        start = r.ok ? r.load.value : null;
      }
    }
    return {
      decision: 'insufficient_data',
      load: start,
      reps: criteria.repRange,
      summary:
        start === null
          ? `No comparable ${name} history yet. Pick a load you can do for ${range(criteria.repRange)} reps.`
          : `No comparable ${name} history yet. Starting at ${formatLoad(asLoad(ctx, start))} for ${range(criteria.repRange)} reps.`,
    };
  }

  const L = latest.load;
  const lastText = formatLoad(asLoad(ctx, L));
  if (latest.missingEffort > 0) {
    ctx.facts.push(`Effort wasn't recorded for ${latest.missingEffort} set${latest.missingEffort === 1 ? '' : 's'}; reps alone were used.`);
  }

  if (latest.allHitTop && latest.effortOk) {
    ctx.facts.push(`Last session: every counted set reached ${criteria.repRange.max}+ reps at ${lastText}.`);
    const cap = rule.ceilingRepCap;
    const repStep = (reason: string): PrimaryDecision => {
      const n = Math.max(latest.minReps + 1, criteria.repRange.max + 1);
      if (n > cap) {
        return {
          decision: 'ceiling_reached',
          load: feasibleHold(ctx, L),
          reps: { min: criteria.repRange.max, max: cap },
          summary: `${name} has reached the rep cap (${cap}) at ${lastText} because ${reason}. Consider a substitution or another set.`,
        };
      }
      return {
        decision: 'increase_reps',
        load: feasibleHold(ctx, L),
        reps: { min: n, max: n },
        summary: `Add a rep: aim for ${n} at ${lastText}, because ${reason}.`,
      };
    };
    if (L === null) return repStep('there is no external load to add');
    const step = nextHarderLoad(ctx, L);
    if (step.kind === 'ceiling') return repStep(step.reason);
    const verb = ctx.direction === 'resistance' ? 'Increase' : 'Reduce assistance';
    return {
      decision: 'increase_load',
      load: step.value,
      reps: criteria.repRange,
      summary: `${verb} to ${formatLoad(asLoad(ctx, step.value))} for ${range(criteria.repRange)} reps.`,
    };
  }

  if (latest.anyBelowFloor) {
    let streak = 0;
    for (const s of sessions) {
      const sameLoad = (s.load === null && L === null) || (s.load !== null && L !== null && toScaled(s.load) === toScaled(L));
      if (!s.anyBelowFloor || !sameLoad) break;
      streak += 1;
    }
    const needed = rule.failuresBeforeReduce;
    if (streak >= needed && L !== null) {
      const reduced = reducedLoad(ctx, L);
      if (reduced !== null) {
        ctx.facts.push(`${streak} sessions in a row fell below ${criteria.repRange.min} reps at ${lastText}.`);
        return {
          decision: 'reduce_load',
          load: reduced,
          reps: criteria.repRange,
          summary: `Repeated misses at ${lastText}: reduce to ${formatLoad(asLoad(ctx, reduced))} and build back up.`,
        };
      }
      ctx.facts.push('No easier load is available on this equipment.');
    } else {
      ctx.facts.push(
        `One session below ${criteria.repRange.min} reps is treated as a bad day, not a trend (${streak} of ${needed} needed to reduce).`,
      );
    }
    return {
      decision: 'hold_after_miss',
      load: feasibleHold(ctx, L),
      reps: criteria.repRange,
      summary: `Repeat ${lastText} for ${range(criteria.repRange)} reps.`,
    };
  }

  if (latest.allHitTop && !latest.effortOk) {
    ctx.facts.push('Reps reached the top of the range, but effort was above the rule’s limit.');
  }
  return {
    decision: 'hold',
    load: feasibleHold(ctx, L),
    reps: criteria.repRange,
    summary: `Stay at ${lastText} and work toward ${criteria.repRange.max} reps on every set.`,
  };
}

/**
 * Deterministic next-session targets with an inspectable explanation
 * (brief §3, §7). Loads are always achievable on the given equipment and never
 * above its maximum; at the ceiling, reps progress instead. One poor session
 * holds; only a repeated trend reduces. An active pain flag halts progression.
 */
export function calculateNextTargets(input: NextTargetsInput): NextTargets {
  const unit = input.equipment?.unit ?? input.unit;
  const convention = input.equipment?.loadConvention ?? input.convention;
  const ctx: Ctx = { input, unit, convention, direction: loadDirection(convention), facts: [] };
  const rule = input.rule;
  const ruleRef = { id: rule.id, version: rule.version, method: rule.method, name: rule.name };

  if (rule.method === 'top_set_backoff' && ctx.direction === 'assistance') {
    return {
      decision: 'unsupported',
      sets: [],
      loadFeasibility: 'not_applicable',
      rule: ruleRef,
      explanation: {
        summary: 'Top-set/back-off rules are not supported on assisted machines. Use double progression instead.',
        facts: [],
      },
      basedOnSessionIds: [],
    };
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
        backoff = r.ok ? r.load : null;
      } else {
        backoff = asLoad(ctx, raw);
      }
      if (backoff) {
        ctx.facts.push(`Back-off sets use ${rule.backoff.percentOfTop}% of the top set, rounded down to ${formatLoad(backoff)}.`);
      }
    }
    for (let i = 0; i < rule.backoff.sets; i += 1) sets.push({ setType: 'backoff', load: backoff, reps: rule.backoff.repRange });
  }

  const anyLoad = sets.some((s) => s.load !== null && s.load.convention !== 'bodyweight');
  return {
    decision: primary.decision,
    sets,
    loadFeasibility: !anyLoad ? 'not_applicable' : input.equipment ? 'checked' : 'unchecked',
    rule: ruleRef,
    explanation: { summary: primary.summary, facts: ctx.facts },
    basedOnSessionIds: sessions.map((s) => s.sessionId),
  };
}
