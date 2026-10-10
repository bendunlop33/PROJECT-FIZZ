import type {
  EquipmentInstance,
  ExerciseEquipmentKind,
  Load,
  TargetBasis,
  TargetBasisSet,
  TargetProvenance,
  TargetStep,
  ZonedTimestamp,
} from '@fizz/schemas';
import { formatNumber, loadText, NBSP } from './display';
import { isSetCountable } from './exclusions';
import { loadDirection } from './equipment';
import type { HistorySession, NextTargets, TargetSet } from './progression';
import type { StartWarning } from './session/create';
import { buildStepCard, pctChange } from './step-card';
import { toScaled } from './units';

/**
 * Writers for `TargetProvenance` (active-workout.md §2.12, AW3): each path
 * that sets a target records, at that moment, what produced it. `Why?` later
 * reads only this; it never runs a rule again. Every string here is fixed
 * app text filled in by code.
 */

/** What the equipment is called in a step sentence: `the smallest step on this bar`. */
export function equipmentNoun(kind: ExerciseEquipmentKind | null): string {
  switch (kind) {
    case 'barbell':
    case 'ez_bar':
    case 'trap_bar':
      return 'bar';
    case 'dumbbells':
      return 'rack';
    case 'weight_stack':
      return 'stack';
    case 'assisted_stack':
    case 'plate_loaded_machine':
      return 'machine';
    case 'bodyweight_station':
      return 'station';
    case 'kettlebell':
    case 'sled':
    case 'erg':
    case 'medicine_ball':
    case 'sandbag':
    case 'band':
    case null:
      return 'equipment';
  }
}

/** Why a load is the hardest here: `Capped at 30 kg each: the heaviest dumbbell here.` */
function maxPhrase(kind: EquipmentInstance['kind']): string {
  switch (kind) {
    case 'barbell':
      return 'the most this bar and your plates make here';
    case 'plate_loaded_machine':
      return 'the most your plates make on this machine';
    case 'dumbbells':
      return 'the heaviest dumbbell here';
    case 'weight_stack':
      return 'the top of this stack';
    case 'assisted_stack':
      return 'the least assistance this machine gives';
    case 'bodyweight_station':
      return 'the only load here';
  }
}

const loadWord = (l: Load, eq: EquipmentInstance | null): string => loadText(l, l.convention, eq);

/** The basis sets as they are now (actual results), warm-ups left out. */
function basisSets(h: HistorySession): TargetBasisSet[] {
  return h.sets
    .filter((s) => s.setType !== 'warmup')
    .map((s) => ({
      ...(s.setId !== undefined ? { setId: s.setId } : {}),
      ...(s.version !== undefined ? { version: s.version } : {}),
      ...(s.number !== undefined ? { number: s.number } : {}),
      setType: s.setType,
      side: s.side,
      values: { load: s.load, reps: s.reps, durationS: null, rpe: s.rpe, rir: s.rir },
      ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: [...s.exclusions] } : {}),
    }));
}

/**
 * The comparable workout the rule's targets rest on: the most recent of
 * `basedOnSessionIds` that has any non-warm-up set at this equipment (a
 * workout where everything was skipped can't be the basis of a load). A
 * workout whose sets Ben all left out of progress (§2.13) isn't the basis
 * either: the rule held on the workout before it.
 */
export function ruleBasis(result: NextTargets, history: readonly HistorySession[], equipmentId: string | null, fallbackTz: string): TargetBasis | null {
  for (const id of result.basedOnSessionIds) {
    const h = history.find((x) => x.sessionId === id && x.equipmentId === equipmentId && !x.imported);
    if (!h) continue;
    const sets = basisSets(h);
    if (!sets.some((s) => isSetCountable(s, 'progression'))) continue;
    return {
      sessionId: h.sessionId,
      performedAt: { utc: h.performedAtUtc, tz: h.tz ?? fallbackTz },
      routineName: h.routineName ?? null,
      gymId: h.gymId,
      equipmentId: h.equipmentId,
      sets,
    };
  }
  return null;
}

/** Easiest load of the basis sets of one set type (the rule's reference load), else of all of them. */
function referenceLoad(basis: TargetBasis, setType: TargetSet['setType']): Load | null {
  const loads = (sets: readonly TargetBasisSet[]) => sets.map((s) => s.values.load).filter((l): l is Load => l !== null && l.convention !== 'bodyweight');
  // Flagged sets (§2.13) never set the reference load.
  const counted = basis.sets.filter((s) => isSetCountable(s, 'progression'));
  const own = loads(counted.filter((s) => s.setType === setType));
  const pool = own.length > 0 ? own : loads(counted);
  const first = pool[0];
  if (first === undefined) return null;
  const easier = (a: Load, b: Load) => (loadDirection(a.convention) === 'resistance' ? toScaled(a.value) < toScaled(b.value) : toScaled(a.value) > toScaled(b.value));
  let best = first;
  for (const l of pool) if (l.unit === best.unit && l.convention === best.convention && easier(l, best)) best = l;
  return best;
}

/** The load change from `from` to `to`, measured on the equipment when there is one. */
export function targetStep(from: Load, to: Load, eq: EquipmentInstance | null): TargetStep | null {
  if (from.unit !== to.unit || from.convention !== to.convention || toScaled(from.value) === toScaled(to.value)) return null;
  const card = eq === null ? null : buildStepCard(eq, from);
  const harder = loadDirection(to.convention) === 'resistance' ? toScaled(to.value) > toScaled(from.value) : toScaled(to.value) < toScaled(from.value);
  const neighbour = card === null ? null : harder ? card.nextUp : card.nextDown;
  return {
    from,
    to,
    pctChange: pctChange(from.value, to.value),
    smallest: neighbour !== null && toScaled(neighbour.load.value) === toScaled(to.value),
    equipmentKind: eq?.kind ?? null,
  };
}

/** `+2.5 kg (+2.5%), the smallest step on this bar.` / `2.5 kg less assistance on this machine.` */
export function stepText(step: TargetStep): string {
  const { from, to } = step;
  const each = to.convention === 'per_hand' ? `${NBSP}each` : '';
  const amount = `${formatNumber(Math.abs(to.value - from.value))}${NBSP}${to.unit}${each}`;
  const noun = equipmentNoun(step.equipmentKind);
  const up = toScaled(to.value) > toScaled(from.value);
  if (loadDirection(to.convention) === 'assistance') {
    const tail = step.equipmentKind === null ? '.' : step.smallest ? `, the smallest step on this ${noun}.` : ` on this ${noun}.`;
    return `${amount} ${up ? 'more' : 'less'} assistance${tail}`;
  }
  const sign = up ? '+' : '−';
  const pct = step.pctChange === null ? '' : ` (${sign}${formatNumber(Math.abs(step.pctChange))}%)`;
  const tail = step.equipmentKind === null ? '.' : step.smallest ? `, the smallest step${up ? '' : ' down'} on this ${noun}.` : ` on this ${noun}.`;
  return `${sign}${amount}${pct}${tail}`;
}

export interface RuleProvenanceInput {
  result: NextTargets;
  history: readonly HistorySession[];
  equipment: EquipmentInstance | null;
  /** When the targets are planned into the workout. */
  at: ZonedTimestamp;
}

/** Provenance for one planned set from the built-in rule's next targets (`plannedSetsFromTargets`). */
export function ruleTargetProvenance(input: RuleProvenanceInput, target: TargetSet): TargetProvenance {
  const { result, equipment: eq } = input;
  const basis = ruleBasis(result, input.history, eq?.id ?? null, input.at.tz);
  const from = basis === null ? null : referenceLoad(basis, target.setType);
  const step = from !== null && target.load !== null ? targetStep(from, target.load, eq) : null;
  const guardNotes: string[] = [];
  if (result.loadFeasibility === 'unchecked') guardNotes.push('Not checked against equipment: this exercise has no equipment set up at this gym.');
  if (eq !== null && target.load !== null && (result.decision === 'increase_reps' || result.decision === 'ceiling_reached')) {
    const card = buildStepCard(eq, target.load);
    if (card?.atMax) guardNotes.push(`Capped at ${loadWord(target.load, eq)}: ${maxPhrase(eq.kind)}.`);
  }
  return fitProvenance({
    source: 'rule',
    setAt: input.at,
    routineName: null,
    requestedLoad: null,
    basis,
    rule: { name: result.rule.name, decision: result.decision, summary: result.explanation.summary, facts: [...result.explanation.facts] },
    ...(step !== null ? { step } : {}),
    guardNotes,
  });
}

/**
 * The equipment note for a template load that was fitted or dropped at start
 * (`planTemplateLoad`). `was` names where the load came from: `Plan` for a
 * routine, `Last time` for a copied set, `Target` for a built-in rule target (Start next session).
 */
export function startWarningNote(w: Extract<StartWarning, { kind: 'target_rounded' | 'target_dropped' }>, eq: EquipmentInstance | null, was: 'Plan' | 'Last time' | 'Target'): string {
  const noun = equipmentNoun(eq?.kind ?? null);
  const requested = loadWord(w.requested, eq);
  if (w.kind === 'target_rounded') {
    const planned = loadWord(w.planned, eq);
    // `bounded` is numeric: on an assisted machine the top is the most assistance (the easiest).
    const what = loadDirection(w.planned.convention) === 'assistance' ? ' assistance' : '';
    const gives = what === '' ? 'makes' : 'gives';
    if (w.bounded === 'max') return `Capped at ${planned}: the most${what} this ${noun} ${gives}. ${was} was ${requested}.`;
    if (w.bounded === 'min') return `Set to ${planned}: the least${what} this ${noun} ${gives}. ${was} was ${requested}.`;
    if (w.converted) return `Rounded from ${requested} to ${planned} to match this ${noun}.`;
    // `planTemplateLoad` and Repeat only ever round toward easier.
    return `Rounded to ${planned}, the nearest easier load this ${noun} makes. ${was} was ${requested}.`;
  }
  switch (w.reason) {
    case 'convention_mismatch':
      return `No load target: ${was.toLowerCase()} was ${requested}, a different kind of load, so it isn’t converted.`;
    case 'unit_not_convertible':
      return `No load target: ${was.toLowerCase()} was ${requested}, and there’s no equipment here to check it in another unit.`;
    case 'no_achievable_loads':
      return `No load target: ${eq?.name ?? 'This equipment'} can’t make any load as set up.`;
  }
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Keeps a provenance inside its schema's bounds (long names, many facts), so
 * explaining a target can never make the write that sets it fail. Text past
 * a bound is cut with an ellipsis; nothing is reworded.
 */
export function fitProvenance(p: TargetProvenance): TargetProvenance {
  return {
    ...p,
    ...(p.rule
      ? {
          rule: {
            ...p.rule,
            name: clip(p.rule.name, 300),
            summary: clip(p.rule.summary, 600),
            facts: p.rule.facts.slice(0, 20).map((f) => clip(f, 600)),
          },
        }
      : {}),
    routineName: p.routineName === null ? null : clip(p.routineName, 120),
    basis: p.basis === null ? null : { ...p.basis, routineName: p.basis.routineName === null ? null : clip(p.basis.routineName, 120), sets: p.basis.sets.slice(0, 60) },
    guardNotes: p.guardNotes
      .filter((n) => n !== '')
      .slice(0, 10)
      .map((n) => clip(n, 300)),
  };
}

export interface PlanProvenanceInput {
  routineName: string;
  at: ZonedTimestamp;
  requested: Load | null;
  warning: Extract<StartWarning, { kind: 'target_rounded' | 'target_dropped' }> | null;
  equipment: EquipmentInstance | null;
}

/** Provenance for a set planned from a routine template (`startWorkout`). */
export function planTargetProvenance(input: PlanProvenanceInput): TargetProvenance {
  return fitProvenance({
    source: 'plan',
    setAt: input.at,
    routineName: input.routineName,
    requestedLoad: input.requested,
    basis: null,
    guardNotes: input.warning === null ? [] : [startWarningNote(input.warning, input.equipment, 'Plan')],
  });
}
