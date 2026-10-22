import { BUILD_LIMITS, type CheckedOnRecord, type DraftLoadSource, type DraftPlan, type DraftSetTemplate, type DraftSlot, type LoadConvention, type PlannedSet, type SetType, type TargetSource, type WeightUnit } from '@fizz/schemas';
import type { BuilderLoadSourceKind, RestKind } from './types';

/**
 * (Review B1, retire-workout-overview) A library workout or a past workout opened on Your workout as the Workout
 * overview planned it: the same planner, at this gym, with nothing rebuilt by the builder's §3.1 defaults. Each
 * exercise keeps its saved set types, reps, target RPE, Fixed loads, its own progression rule's next targets, its
 * preferred item and Ben's own rests; every load is the planner's, already fitted to this gym's items (rule 4) and
 * held on pain (rule 9). Pure.
 *
 * What the builder can't hold is left out and named, never dropped silently: an exercise it has no slot for (cardio,
 * carries, forearms), one with a timed or distance set, a second copy of an exercise already in the workout, one past
 * the builder's limits (10 exercises, 4 warm-ups, 10 working sets, 3 drops).
 */

/** One exercise of the planned workout, as `plannedAsDraftPlan` reads it (a `SessionAggregate`'s rows). */
export interface PlannedExerciseSource {
  id: string;
  exerciseId: string;
  order: number;
  supersetGroup: string | null;
  equipmentId: string | null;
  unit: WeightUnit;
  loadConvention: LoadConvention;
  removed?: unknown;
}

export interface PlannedSetSource {
  sessionExerciseId: string;
  index: number;
  setType: SetType;
  status: string;
  pairedWithSetId: string | null;
  planned: PlannedSet;
  rest: { seconds: number; source: string };
}

export interface PlannedAsDraftInput {
  exercises: readonly PlannedExerciseSource[];
  sets: readonly PlannedSetSource[];
  /** The workout's main lift (a library workout's `main`); null: none. */
  mainExerciseId: string | null;
  /** The builder has a slot for this exercise (`BuilderInfoLookup` not null). */
  holds: (exerciseId: string) => boolean;
  /** A stable slot key for the n-th slot. */
  slotKey: (n: number) => string;
  catalogueIdOf: (exerciseId: string) => string;
  /** The item the planner put the exercise on, at this gym; null: none (bodyweight, or not found). */
  checkedOnOf: (equipmentId: string | null, unit: WeightUnit, convention: LoadConvention) => CheckedOnRecord | null;
}

export interface PlannedAsDraft {
  plan: DraftPlan;
  /** Exercise IDs left out, in workout order (a second copy is listed again). */
  leftOut: string[];
}

/** Rests Ben set himself (a set, the routine's set type, the exercise): kept as the slot's own; the defaults stay the builder's. */
const OWN_REST = new Set(['set_override', 'routine_set_type', 'exercise_default']);

const REST_KIND: Readonly<Record<SetType, RestKind>> = { warmup: 'warmup', working: 'working', top: 'top', backoff: 'backoff', drop: 'drop' };

/** Where a slot's working load came from, as the builder's `Why this weight?` names it. */
export function builderSourceOfPlanned(source: TargetSource | undefined, hasLoad: boolean): BuilderLoadSourceKind {
  if (!hasLoad) return 'none';
  switch (source) {
    case 'coach':
      return 'coach_target';
    case 'rule':
      return 'rule';
    case 'plan':
    case 'repeat':
    case undefined:
      return 'saved';
  }
}

const DRAFT_LOAD_SOURCE: Readonly<Record<BuilderLoadSourceKind, DraftLoadSource>> = { coach_target: 'coach', plan: 'plan', rule: 'rule', calc: 'calc', none: 'none', saved: 'plan' };

const clampRest = (kind: RestKind, s: number): number => Math.min(BUILD_LIMITS.maxRestS, Math.max(kind === 'before_drop' ? 0 : BUILD_LIMITS.minRestS, Math.round(s)));

export function plannedAsDraftPlan(input: PlannedAsDraftInput): PlannedAsDraft {
  const slots: DraftSlot[] = [];
  const leftOut: string[] = [];
  const seen = new Set<string>();
  const live = [...input.exercises].filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order);
  for (const e of live) {
    const sets = input.sets
      .filter((s) => s.sessionExerciseId === e.id && s.pairedWithSetId === null && s.status !== 'deleted' && s.status !== 'skipped')
      .sort((a, b) => a.index - b.index);
    if (sets.length === 0) continue;
    const timed = sets.some((s) => s.planned.reps === null || s.planned.durationS !== null || s.planned.distanceM != null);
    const warmups = sets.filter((s) => s.setType === 'warmup').length;
    const drops = sets.filter((s) => s.setType === 'drop').length;
    const working = sets.length - warmups;
    const overLimits = warmups > BUILD_LIMITS.maxWarmups || drops > BUILD_LIMITS.maxDropSets || working > BUILD_LIMITS.maxWorkingSets || working < 1;
    if (!input.holds(e.exerciseId) || timed || seen.has(e.exerciseId) || overLimits || slots.length >= BUILD_LIMITS.maxExercises) {
      leftOut.push(e.exerciseId);
      continue;
    }
    seen.add(e.exerciseId);
    const firstWork = sets.find((s) => s.setType !== 'warmup' && s.planned.load !== null) ?? sets.find((s) => s.planned.load !== null);
    const source = builderSourceOfPlanned(firstWork?.planned.provenance?.source, firstWork !== undefined);
    const restS: Partial<Record<RestKind, number>> = {};
    for (const s of sets) {
      const kind = REST_KIND[s.setType];
      if (OWN_REST.has(s.rest.source) && restS[kind] === undefined && e.supersetGroup === null) restS[kind] = clampRest(kind, s.rest.seconds);
    }
    const setTemplates: DraftSetTemplate[] = sets.map((s, i) => {
      const reps = s.planned.reps ?? { min: 1, max: 1 };
      const min = Math.min(BUILD_LIMITS.maxReps, Math.max(BUILD_LIMITS.minReps, reps.min));
      const load = s.planned.load;
      const beforeDrop = sets[i + 1]?.setType === 'drop' && s.setType !== 'warmup';
      const ownRest = OWN_REST.has(s.rest.source) && e.supersetGroup === null ? clampRest(beforeDrop ? 'before_drop' : REST_KIND[s.setType], beforeDrop ? Math.min(BUILD_LIMITS.maxRestBeforeDropS, s.rest.seconds) : s.rest.seconds) : null;
      const rpe = s.setType === 'warmup' ? null : (s.planned.rpeOverride ?? s.planned.rpe);
      return {
        setType: s.setType,
        reps: { min, max: Math.min(BUILD_LIMITS.maxReps, Math.max(min, reps.max)) },
        durationS: null,
        targetRpe: rpe === null ? null : Math.min(BUILD_LIMITS.maxRpe, Math.max(BUILD_LIMITS.minRpe, rpe)),
        restS: ownRest,
        load: {
          load: load === null ? null : { value: load.value, unit: load.unit, convention: load.convention },
          source: load === null ? 'none' : DRAFT_LOAD_SOURCE[source],
          basis: null,
          basisFromCoach: false,
          held: false,
          notes: [],
          notUsed: null,
        },
      };
    });
    const unit = firstWork?.planned.load?.unit ?? e.unit;
    const convention = firstWork?.planned.load?.convention ?? e.loadConvention;
    const work = setTemplates.filter((t) => t.setType !== 'warmup');
    const repRange = { min: Math.min(...work.map((t) => t.reps?.min ?? 1)), max: Math.max(...work.map((t) => t.reps?.max ?? 1)) };
    slots.push({
      slotKey: input.slotKey(slots.length),
      exerciseId: e.exerciseId,
      catalogueId: input.catalogueIdOf(e.exerciseId),
      order: slots.length,
      main: input.mainExerciseId === e.exerciseId,
      supersetGroup: e.supersetGroup,
      setTemplates,
      checkedOn: input.checkedOnOf(e.equipmentId, unit, convention),
      builder: {
        repRange,
        unit,
        convention,
        source,
        anchorE1rm: null,
        startLight: null,
        origin: e.exerciseId,
        ...(Object.keys(restS).length > 0 ? { restS } : {}),
      },
    });
  }
  // A superset with one exercise left (its partner left out) is a solo exercise; one past the builder's size is split.
  const size = new Map<string, number>();
  for (const s of slots) if (s.supersetGroup !== null) size.set(s.supersetGroup, (size.get(s.supersetGroup) ?? 0) + 1);
  const fixed = slots.map((s) => {
    const n = s.supersetGroup === null ? 0 : (size.get(s.supersetGroup) ?? 0);
    return n < BUILD_LIMITS.minSuperset || n > BUILD_LIMITS.maxSuperset ? { ...s, supersetGroup: null } : s;
  });
  return { plan: { slots: fixed }, leftOut };
}
