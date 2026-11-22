import { BUILD_LIMITS, type CheckedOnRecord, type DraftLoadSource, type DraftPlan, type DraftSetTemplate, type DraftSlot, type LoadConvention, type PlannedSet, type SetType, type TargetSource, type WeightUnit } from '@fizz/schemas';
import { setSnapNote } from '../session/snap-text';
import { briefLine } from '../session/target-why';
import { loadDirection } from '../equipment';
import { convertValue, fitHere, roundContextOf } from './loads';
import { settleBackoffs } from './set-rows';
import type { BuilderLoadSourceKind, BuilderSetRow, BuilderSlot, RestKind, SlotLoadInput } from './types';

/**
 * (Review B1, retire-workout-overview) A library workout or a past workout opened on Your workout as the Workout
 * overview planned it: the same planner, at this gym, with nothing rebuilt by the builder's §3.1 defaults. Each
 * exercise keeps its saved set types, reps, target RPE, Fixed loads, its own progression rule's next targets, its
 * preferred item and Ben's own rests; every load is the planner's, already fitted to this gym's items (rule 4) and
 * held on pain (rule 9). Pure.
 *
 * (22 Oct) Cardio, timed sets and an exercise listed twice open as saved: a timed or cardio set keeps its work time and
 * distance (no reps), and each copy of an exercise is its own slot, so Start creates them exactly as the saved workout
 * has them. What the builder still can't hold is left out and named, never dropped silently: an exercise it can't
 * find, a set with no target at all or with both reps and a time or distance, one past the builder's limits (10
 * exercises, 4 warm-ups, 10 working sets, 3 drops). Only the first copy of the main lift is the main slot.
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
  /** The builder can hold this exercise (it knows it; cardio and other non-strength exercises included, 22 Oct). */
  holds: (exerciseId: string) => boolean;
  /** A stable slot key for the n-th slot. */
  slotKey: (n: number) => string;
  catalogueIdOf: (exerciseId: string) => string;
  /** The item the planner put the exercise on, at this gym; null: none (bodyweight, or not found). */
  checkedOnOf: (equipmentId: string | null, unit: WeightUnit, convention: LoadConvention) => CheckedOnRecord | null;
}

export interface PlannedAsDraft {
  plan: DraftPlan;
  /** Exercise IDs left out, in workout order. */
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

/** `Why this weight?`'s line for a load the planner held on pain (rule 9). */
export const PLANNED_HELD_LINE = 'Held · pain';

/**
 * (Retire-overview R3) Why a planned load is what it is, as the overview's `Why?` said it: where it came from (its own
 * rule's line, not the built-in rule's; the coach; the saved workout), held on pain (rule 9), and capped, converted,
 * dropped or rounded at this gym (rule 4). Values only.
 */
export function plannedWhyLines(planned: PlannedSet): string[] {
  const p = planned.provenance;
  const lines: string[] = [];
  const ruleLine = p?.source === 'rule' && p.rule !== undefined ? briefLine(p.rule.summary).replace(/,? because .*$/, '').trim() : '';
  const hasLoad = planned.load !== null;
  if (ruleLine !== '') lines.push(ruleLine.slice(0, 200));
  else if (hasLoad) lines.push(p?.source === 'coach' ? 'Coach target' : p?.source === 'rule' ? (p.rule?.name.slice(0, 200) ?? 'Rule') : 'Saved workout');
  if (p?.held === true || planned.snap?.painHeld === true || (planned.snap?.outcome === 'dropped' && planned.snap.reason === 'pain_flag')) lines.push(PLANNED_HELD_LINE);
  const snap = planned.snap;
  if (snap !== undefined) {
    const note = setSnapNote(snap, planned.load, { gymName: null, equipment: null, unit: planned.load?.unit ?? snap.intended?.unit ?? 'kg' });
    if (note !== null && !(snap.outcome === 'dropped' && snap.reason === 'pain_flag')) lines.push(note.text.slice(0, 200));
    else if (snap.outcome === 'rounded') lines.push('Rounded down');
  }
  return lines.slice(0, 4);
}

const DRAFT_LOAD_SOURCE: Readonly<Record<BuilderLoadSourceKind, DraftLoadSource>> = { coach_target: 'coach', plan: 'plan', rule: 'rule', calc: 'calc', none: 'none', saved: 'plan' };

const clampRest = (kind: RestKind, s: number): number => Math.min(BUILD_LIMITS.maxRestS, Math.max(kind === 'before_drop' ? 0 : BUILD_LIMITS.minRestS, Math.round(s)));

/** A planned set counted in time or distance (a plank, a ride), not reps. */
const timedSet = (p: PlannedSet): boolean => p.reps === null && (p.durationS !== null || p.distanceM != null);

const clampWorkS = (s: number): number => Math.min(BUILD_LIMITS.maxCardioS, Math.max(BUILD_LIMITS.minWorkS, Math.round(s)));

export function plannedAsDraftPlan(input: PlannedAsDraftInput): PlannedAsDraft {
  const slots: DraftSlot[] = [];
  const leftOut: string[] = [];
  const live = [...input.exercises].filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order);
  for (const e of live) {
    const sets = input.sets
      .filter((s) => s.sessionExerciseId === e.id && s.pairedWithSetId === null && s.status !== 'deleted' && s.status !== 'skipped')
      .sort((a, b) => a.index - b.index);
    if (sets.length === 0) continue;
    // A set with neither reps nor a time or distance has no target the builder could keep; one with both (reps and a
    // time or distance) can't be held as saved either (the builder keeps one or the other): named, not cut to reps.
    const noTarget = sets.some((s) => (s.planned.reps === null ? !timedSet(s.planned) : s.planned.durationS !== null || s.planned.distanceM != null));
    const warmups = sets.filter((s) => s.setType === 'warmup').length;
    const drops = sets.filter((s) => s.setType === 'drop').length;
    const working = sets.length - warmups;
    const overLimits = warmups > BUILD_LIMITS.maxWarmups || drops > BUILD_LIMITS.maxDropSets || working > BUILD_LIMITS.maxWorkingSets || working < 1;
    if (!input.holds(e.exerciseId) || noTarget || overLimits || slots.length >= BUILD_LIMITS.maxExercises) {
      leftOut.push(e.exerciseId);
      continue;
    }
    const firstWork = sets.find((s) => s.setType !== 'warmup' && s.planned.load !== null) ?? sets.find((s) => s.planned.load !== null);
    const source = builderSourceOfPlanned(firstWork?.planned.provenance?.source, firstWork !== undefined);
    const whySet = sets.find((s) => s.setType !== 'warmup') ?? sets[0];
    const why = whySet === undefined ? [] : plannedWhyLines(whySet.planned);
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
      // (22 Oct) A timed or cardio set keeps its work time and distance, no reps (as saved).
      const amount: Pick<DraftSetTemplate, 'reps' | 'durationS' | 'distanceM'> = timedSet(s.planned)
        ? { reps: null, durationS: s.planned.durationS === null ? null : clampWorkS(s.planned.durationS), ...(s.planned.distanceM != null ? { distanceM: Math.min(100_000, Math.max(0, s.planned.distanceM)) } : {}) }
        : { reps: { min, max: Math.min(BUILD_LIMITS.maxReps, Math.max(min, reps.max)) }, durationS: null };
      return {
        setType: s.setType,
        ...amount,
        targetRpe: rpe === null ? null : Math.min(BUILD_LIMITS.maxRpe, Math.max(BUILD_LIMITS.minRpe, rpe)),
        restS: ownRest,
        load: {
          load: load === null ? null : { value: load.value, unit: load.unit, convention: load.convention },
          source: load === null ? 'none' : DRAFT_LOAD_SOURCE[source],
          basis: null,
          basisFromCoach: false,
          // The slot's reasons on every loaded set, as the codec writes them back (R3).
          held: load !== null && why.includes(PLANNED_HELD_LINE),
          notes: load === null ? [] : why.slice(1),
          notUsed: null,
        },
      };
    });
    const unit = firstWork?.planned.load?.unit ?? e.unit;
    const convention = firstWork?.planned.load?.convention ?? e.loadConvention;
    const work = setTemplates.filter((t) => t.setType !== 'warmup' && t.reps !== null);
    const repRange = work.length === 0 ? { min: 1, max: 1 } : { min: Math.min(...work.map((t) => t.reps?.min ?? 1)), max: Math.max(...work.map((t) => t.reps?.max ?? 1)) };
    slots.push({
      slotKey: input.slotKey(slots.length),
      exerciseId: e.exerciseId,
      catalogueId: input.catalogueIdOf(e.exerciseId),
      order: slots.length,
      // One main slot: the first copy of the main lift (an exercise listed twice has one main row, as saved).
      main: input.mainExerciseId === e.exerciseId && !slots.some((x) => x.main),
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
        ...(why.length > 0 ? { why } : {}),
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

/**
 * (Retire-overview R2) `Gym changed` on a library or past workout: one slot at the new gym, from what its planner
 * made there (`planned`: the saved workout's own Fixed loads and rule targets, fitted to the new gym's items, rule 4)
 * rather than the builder's §3.1 rules. `base` is the builder's own reload of the slot (`reloadSlotLoads`), used for a
 * kg Ben typed (kept when that weight exists here) and for any set the saved workout has no match for.
 * - A slot Ben didn't edit becomes the planned one (its key, superset and rests kept).
 * - An edited slot keeps his rows (set types, count, reps, RPE); each set takes the planned load of the same type and
 *   position, else `base`'s. If the planned slot is in another unit or convention than `base`, `base` is used.
 * - (Final re-review S3) `sameItem`: the planner fitted its loads to the item the builder's `base` was fitted to. When
 *   it didn't, an edited slot that would take any load from `base` (a kept typed kg, an extra set) is `base` whole, so
 *   every load on the page is fitted to the one item Start plans it on.
 * - (D4, review B1) `load` given: the back-offs follow the top the edited slot keeps (`settleBackoffs`). A saved
 *   back-off was set for the planned top, so a lighter top Ben typed lowers it by the same %, as in Your workout.
 * Returns the slot and whether any load came from `planned` (its item is then the planner's). Pure.
 */
export function slotAtNewGym(slot: BuilderSlot, planned: BuilderSlot, base: BuilderSlot, sameItem: boolean, load?: SlotLoadInput): { slot: BuilderSlot; fromPlanned: boolean } {
  const keep = (s: BuilderSlot): BuilderSlot => {
    const out: BuilderSlot = { ...s, key: slot.key, main: slot.main };
    delete out.restS;
    delete out.unlinked;
    if (slot.restS !== undefined) out.restS = { ...slot.restS };
    else if (s.restS !== undefined) out.restS = { ...s.restS };
    if (slot.unlinked === true) out.unlinked = true;
    if (slot.origin !== undefined) out.origin = slot.origin;
    // (D1) Ben's own structure edits on this slot stay his at the new gym.
    delete out.keep;
    if (slot.keep !== undefined) out.keep = { ...slot.keep };
    return out;
  };
  if (slot.touched !== true) return { slot: keep({ ...planned, rows: planned.rows.map((r) => ({ ...r })) }), fromPlanned: true };
  if (planned.unit !== base.unit || planned.convention !== base.convention) return { slot: base, fromPlanned: false };
  const nth = (rows: readonly BuilderSetRow[], type: BuilderSetRow['type'], k: number): BuilderSetRow | undefined => rows.filter((r) => r.type === type)[k];
  const seen = new Map<BuilderSetRow['type'], number>();
  const used: boolean[] = [];
  /** Sets whose load comes from `base` (fitted to the builder's item). */
  const mixed: boolean[] = [];
  const rows = slot.rows.map((r): BuilderSetRow => {
    const k = seen.get(r.type) ?? 0;
    seen.set(r.type, k + 1);
    const fromBase = nth(base.rows, r.type, k);
    if (r.typed === true && fromBase?.typed === true) {
      if (fromBase.load !== null) mixed.push(true);
      return { ...r, load: fromBase.load, ...(fromBase.roundedFrom === undefined ? {} : { roundedFrom: fromBase.roundedFrom }) };
    }
    const p = nth(planned.rows, r.type, k);
    const plain: BuilderSetRow = { ...r };
    delete plain.typed;
    delete plain.roundedFrom;
    delete plain.backoffFrom;
    if (p !== undefined) {
      used.push(true);
      return { ...plain, load: p.load };
    }
    if (fromBase?.load != null) mixed.push(true);
    return { ...plain, load: fromBase?.load ?? null };
  });
  if (used.length === 0 || (mixed.length > 0 && !sameItem)) return { slot: base, fromPlanned: false };
  const out: BuilderSlot = { ...slot, rows, unit: planned.unit, convention: planned.convention, source: planned.source, anchorE1rm: planned.anchorE1rm, startLight: planned.startLight };
  delete out.why;
  delete out.historyVersion;
  if (planned.why !== undefined) out.why = [...planned.why];
  return { slot: load === undefined ? out : settleBackoffs(out, load, planned), fromPlanned: true };
}

/**
 * (Rule 4) A planned exercise the planner put on no item (a library workout's exercise with no item saved): its
 * loads fitted to the item the builder uses for it at this gym (`load`, as `slotLoadOf` gives it; `checkedOn` that
 * item), rounded down and never past the item's max. A load nothing here can make is dropped (`No load target`).
 * The fit is named in the slot's reasons (`Max here`, `Rounded down`). A slot already on an item, or one with no item
 * here, is returned as it is. Pure.
 */
export function fitPlannedSlotHere(slot: DraftSlot, load: SlotLoadInput, checkedOn: CheckedOnRecord | null): DraftSlot {
  if (slot.checkedOn != null) return slot;
  const ctx = roundContextOf(load);
  if (ctx.equipment === null) return slot;
  const fitLines: string[] = [];
  const add = (l: string) => {
    if (!fitLines.includes(l)) fitLines.push(l);
  };
  let unit = slot.builder?.unit;
  const setTemplates = slot.setTemplates.map((t): DraftSetTemplate => {
    const l = t.load?.load;
    if (t.load === undefined || l == null || l.convention !== ctx.convention) return t;
    const asked = convertValue(l.value, l.unit, ctx.unit);
    const fit = fitHere(asked, { ...ctx, painCap: null });
    if (!fit.ok) {
      add('No load target');
      return { ...t, load: { ...t.load, load: null, source: 'none' } };
    }
    unit = fit.load.unit;
    if (fit.load.bounded !== null && Math.abs(fit.load.value - convertValue(asked, ctx.unit, fit.load.unit)) > 1e-6) add(loadDirection(ctx.convention) === 'resistance' ? 'Max here' : 'Least assistance here');
    else if (fit.load.rounded) add('Rounded down');
    return { ...t, load: { ...t.load, load: { value: fit.load.value, unit: fit.load.unit, convention: l.convention } } };
  });
  const meta = slot.builder;
  const why = [...(meta?.why ?? [])];
  for (const l of fitLines) if (!why.includes(l)) why.push(l);
  const shown = why.slice(0, 4);
  const notes = shown.slice(1);
  return {
    ...slot,
    checkedOn,
    setTemplates: setTemplates.map((t) => (t.load === undefined || t.load.load === null ? t : { ...t, load: { ...t.load, notes } })),
    ...(meta === undefined ? {} : { builder: { ...meta, ...(unit === undefined ? {} : { unit }), ...(shown.length > 0 ? { why: shown } : {}) } }),
  };
}
