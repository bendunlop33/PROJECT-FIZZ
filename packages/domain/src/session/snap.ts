import type {
  EquipmentInstance,
  ExerciseEquipmentKind,
  Load,
  LoadConvention,
  PlannedSnap,
  RepRange,
  SetType,
  SnapMode,
  SnapOutcome,
  SnapReason,
  WeightUnit,
} from '@fizz/schemas';
import { compareDifficulty, loadDirection, roundToAvailableLoad } from '../equipment';
import { addedWeightEquipment, isWeightedBodyweight } from '../added-weight';
import { isExcludedFor, needsNoEquipment } from '../exercise-equipment';
import { missingStations, stationWords, type GymStation } from '../stations';
import { convertMass, toScaled } from '../units';

/**
 * `snapPlanToGym` (gym-switch.md §6.1, GS1–GS3, ADR 0019): the one pure
 * function that fits a plan's targets to a gym's equipment. Routine Start,
 * Repeat, the mid-workout gym switch and `[Use changes today]` all call it,
 * so one property test guards every way a load target reaches a set.
 *
 * - Equipment is mapped in a fixed order (GS3): the same item; the item this
 *   exercise last used at this gym; the first usable item of the same kind;
 *   the first usable item of another kind the exercise lists; else none
 *   (`not_here`). A slot whose source had no equipment stays `none_needed`.
 * - Each set is fitted from its **intended** target, never from an
 *   already-fitted one (GS2), rounding toward easier, so switching back
 *   restores the plan and refitting twice gives the same result.
 * - Loads come only from the equipment's achievable list: never above a max
 *   (rule 4). A request below the easiest load here is dropped, never
 *   rounded up. No equipment for an equipped plan means no load target, with
 *   the reps and time kept (GS4).
 * - With an active pain flag (switch modes), a target never gets harder than
 *   the one it has now (rule 9).
 * - Swaps are not this function's job (GS5, GS9).
 */

export type SnapMapping = 'same_item' | 'last_used_here' | 'same_kind' | 'other_kind' | 'none_needed' | 'not_here';

/** The equipment an intended target was made for (`planned.snap.intendedOn`, or the row's own item). */
export interface SnapSource {
  id: string;
  kind: ExerciseEquipmentKind;
  name: string;
  gymId: string;
}

export interface SnapExercise {
  id: string;
  name: string;
  /** Kinds the exercise can be done on. Empty = unknown: only the source's kind is assumed. */
  compatibleEquipment: readonly ExerciseEquipmentKind[];
  defaultLoadConvention: LoadConvention;
}

export interface SnapSetInput {
  id: string;
  setType: SetType;
  /** The target as its author set it (`planned.snap.intended`, else the planned load). */
  intended: Load | null;
  /** The target the set has now; null at Start and Repeat. */
  current: Load | null;
  reps: RepRange | null;
  durationS: number | null;
}

export interface SnapSlotInput {
  slotId: string;
  exercise: SnapExercise;
  sourceEquipment: SnapSource | null;
  /** The slot's unit and convention today; kept when no equipment is involved. */
  unit: WeightUnit;
  convention: LoadConvention;
  sets: readonly SnapSetInput[];
}

export interface SnapGym {
  id: string;
  name: string;
  /** `getEquipmentSnapshot`: the gym's items as saved now. */
  equipment: readonly EquipmentInstance[];
  /** Items that can't be used in this workout (busy today, out of order). */
  unusableIds?: ReadonlySet<string>;
}

export interface SnapInput {
  mode: SnapMode;
  slots: readonly SnapSlotInput[];
  gym: SnapGym;
  /** GS3 step 2: the item this exercise last used at this gym, from history. */
  lastUsedHere?: (exerciseId: string) => string | null;
  /** Exercise IDs with an active pain flag. */
  painFlagged?: ReadonlySet<string>;
  /** Unit for a slot that ends up with no equipment. */
  ownerUnit: WeightUnit;
}

export interface SnapSetResult {
  id: string;
  load: Load | null;
  intended: Load | null;
  current: Load | null;
  outcome: SnapOutcome;
  reason?: SnapReason;
  /** The rounding was clamped at the equipment's minimum or maximum. */
  bounded: 'min' | 'max' | null;
  painHeld: boolean;
  /** The load target differs from the one the set has now (switch modes). */
  changed: boolean;
  /** `lightest_is_harder`: the easiest load here. */
  lightest: Load | null;
}

interface TopSet {
  setId: string;
  intended: Load | null;
  current: Load | null;
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
}

/**
 * One note per slot per outcome kind, from fixed text keys (§5), never from a
 * model. `top` is the hardest set in the group (working sets first), which the
 * "last time" and "Plan was" wording names.
 */
export type SnapNote =
  | { kind: 'rounded' | 'capped' | 'converted' | 'restored'; setIds: string[]; top: TopSet }
  | { kind: 'dropped'; reason: SnapReason; setIds: string[]; top: TopSet; lightest: Load | null; equipmentName: string | null }
  | { kind: 'pain'; setIds: string[]; top: TopSet };

export interface SnapSlotResult {
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  equipment: EquipmentInstance | null;
  mapping: SnapMapping;
  unit: WeightUnit;
  convention: LoadConvention;
  sourceEquipment: SnapSource | null;
  /** (ADR 0030) `not_here` because of a missing bench or rack (empty otherwise). */
  stations: GymStation[];
  sets: SnapSetResult[];
  notes: SnapNote[];
}

export interface SnapResult {
  mode: SnapMode;
  gymId: string;
  gymName: string;
  slots: SnapSlotResult[];
}

const SWITCH_MODES: ReadonlySet<SnapMode> = new Set(['gym_switch', 'equipment_update']);

function sameLoad(a: Load | null, b: Load | null): boolean {
  if (a === null || b === null) return a === b;
  return a.unit === b.unit && a.convention === b.convention && toScaled(a.value) === toScaled(b.value);
}

function usableAt(gym: SnapGym): EquipmentInstance[] {
  return gym.equipment.filter((e) => e.availability === 'available' && !(gym.unusableIds?.has(e.id) ?? false));
}

/** GS3: which item at this gym a slot uses. */
export function mapEquipment(
  exercise: SnapExercise,
  source: SnapSource | null,
  gym: SnapGym,
  lastUsedHere: ((exerciseId: string) => string | null) | undefined,
): { equipment: EquipmentInstance | null; mapping: SnapMapping; stations?: GymStation[] } {
  if (source === null || needsNoEquipment({ defaultLoadConvention: exercise.defaultLoadConvention, compatibleEquipment: [...exercise.compatibleEquipment] })) {
    return { equipment: null, mapping: 'none_needed' };
  }
  // (ADR 0030) A bench or rack the exercise needs that this gym is known not to have.
  // The load item may well be here: the reason is the bench or rack (review ben-kit B1).
  const stations = missingStations(exercise.id, gym.equipment);
  if (stations.length > 0) return { equipment: null, mapping: 'not_here', stations };
  const kinds: readonly ExerciseEquipmentKind[] = exercise.compatibleEquipment.length > 0 ? exercise.compatibleEquipment : [source.kind];
  const suits = (e: EquipmentInstance) => kinds.includes(e.kind);
  // (Ben, 20 Oct) An item Ben marked `Not at this gym` for this exercise, or another machine's own stack, is never mapped to it.
  const usable = usableAt(gym).filter((e) => !isExcludedFor(e, exercise.id));
  // (Review quickgym B2) A machine Ben taught its own stack ("Leg extension goes up in 7 kg") always maps to it,
  // before the routine's item or the first stack of the kind (a full gym's Cable station).
  const own = usable.find((e) => e.onlyFor?.includes(exercise.id) === true && suits(e));
  if (own) return { equipment: own, mapping: own.id === source.id ? 'same_item' : 'last_used_here' };
  const same = usable.find((e) => e.id === source.id);
  if (same) return { equipment: same, mapping: 'same_item' };
  const lastId = lastUsedHere?.(exercise.id) ?? null;
  const last = lastId === null ? undefined : usable.find((e) => e.id === lastId && suits(e));
  if (last) return { equipment: last, mapping: 'last_used_here' };
  const sameKind = usable.find((e) => e.kind === source.kind && suits(e));
  if (sameKind) return { equipment: sameKind, mapping: 'same_kind' };
  const otherKind = usable.find((e) => e.kind !== source.kind && suits(e));
  if (otherKind) return { equipment: otherKind, mapping: 'other_kind' };
  return { equipment: null, mapping: 'not_here' };
}

export type LoadFit = { load: Load; bounded: 'min' | 'max' | null; converted: boolean } | { load: null; reason: SnapReason; lightest: Load | null };

/** Rule 2–4 for one load on one item: round toward easier; drop rather than round up. */
export function fitOn(target: Load, eq: EquipmentInstance): LoadFit {
  if (target.convention !== eq.loadConvention) return { load: null, reason: 'convention_mismatch', lightest: null };
  const r = roundToAvailableLoad(target, eq, 'easier');
  if (!r.ok) return { load: null, reason: r.reason === 'convention_mismatch' ? 'convention_mismatch' : 'no_achievable_loads', lightest: null };
  const hardEnd = loadDirection(eq.loadConvention) === 'resistance' ? 'min' : 'max';
  if (!r.exact && r.bounded === hardEnd) return { load: null, reason: 'lightest_is_harder', lightest: r.load };
  return { load: r.load, bounded: r.bounded, converted: r.convertedRequest !== null };
}

/** Without equipment a load is kept only in the slot's own unit and convention (as before; review SP5). */
export function fitWithoutEquipment(target: Load, unit: WeightUnit, convention: LoadConvention): LoadFit {
  if (target.convention !== convention) return { load: null, reason: 'convention_mismatch', lightest: null };
  if (target.unit !== unit) return { load: null, reason: 'unit_not_convertible', lightest: null };
  return { load: target, bounded: null, converted: false };
}

/** `a` is harder than `b` (same convention; units converted). */
function harder(a: Load, b: Load): boolean {
  const bInA = b.unit === a.unit ? b.value : convertMass(b, a.unit).value;
  return compareDifficulty(a.value, bInA, loadDirection(a.convention)) > 0;
}

function fitSet(
  set: SnapSetInput,
  eq: EquipmentInstance | null,
  mapping: SnapMapping,
  unit: WeightUnit,
  convention: LoadConvention,
  mode: SnapMode,
  pain: boolean,
): SnapSetResult {
  const switching = SWITCH_MODES.has(mode);
  const base = { id: set.id, intended: set.intended, current: set.current, painHeld: false };
  const done = (load: Load | null, outcome: SnapOutcome, extra: { reason?: SnapReason; bounded?: 'min' | 'max' | null; painHeld?: boolean; lightest?: Load | null } = {}): SnapSetResult => ({
    ...base,
    load,
    outcome,
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
    bounded: extra.bounded ?? null,
    painHeld: extra.painHeld ?? false,
    changed: switching && !sameLoad(load, set.current),
    lightest: extra.lightest ?? null,
  });

  if (set.intended === null) return done(null, 'exact');
  let fit: LoadFit;
  if (mapping === 'not_here') fit = { load: null, reason: 'not_here', lightest: null };
  else if (eq === null) fit = fitWithoutEquipment(set.intended, unit, convention);
  else fit = fitOn(set.intended, eq);

  let painHeld = false;
  if (pain && switching && fit.load !== null) {
    // Rule 9: a pain flag stops any load going up from what the set has now.
    const cur = set.current;
    if (cur === null) fit = { load: null, reason: 'pain_flag', lightest: null };
    else if (cur.convention !== fit.load.convention) fit = { load: null, reason: 'pain_flag', lightest: null };
    else if (harder(fit.load, cur)) {
      const held = eq === null ? fitWithoutEquipment(cur, unit, convention) : fitOn(cur, eq);
      fit = held.load === null ? { load: null, reason: 'pain_flag', lightest: null } : held;
      painHeld = held.load !== null;
    }
  }

  if (fit.load === null) return done(null, 'dropped', { reason: fit.reason, lightest: fit.lightest });
  const load = fit.load;
  const easyEnd = loadDirection(load.convention) === 'resistance' ? 'max' : 'min';
  let outcome: SnapOutcome;
  if (painHeld) outcome = sameLoad(load, set.intended) ? 'exact' : 'rounded';
  else if (sameLoad(load, set.intended)) outcome = switching && !sameLoad(load, set.current) ? 'restored' : 'exact';
  else if (fit.bounded === easyEnd) outcome = 'capped';
  else if (fit.converted) outcome = 'converted';
  else outcome = 'rounded';
  return done(load, outcome, { bounded: fit.bounded, painHeld });
}

/** Hardest set by intended load, working sets first; ties go to the later set. */
function topOf(sets: readonly SnapSetResult[], inputs: ReadonlyMap<string, SnapSetInput>): TopSet {
  const working = sets.filter((s) => inputs.get(s.id)?.setType !== 'warmup');
  const pool = working.length > 0 ? working : sets;
  const kg = (l: Load | null) => (l === null ? -Infinity : convertMass(l, 'kg').value * (loadDirection(l.convention) === 'assistance' ? -1 : 1));
  let top = pool[0];
  for (const s of pool) if (top === undefined || kg(s.intended) >= kg(top.intended)) top = s;
  const input = top ? inputs.get(top.id) : undefined;
  return {
    setId: top?.id ?? '',
    intended: top?.intended ?? null,
    current: top?.current ?? null,
    load: top?.load ?? null,
    reps: input?.reps ?? null,
    durationS: input?.durationS ?? null,
  };
}

function notesFor(slot: SnapSlotInput, sets: readonly SnapSetResult[], eq: EquipmentInstance | null, stations: readonly GymStation[]): SnapNote[] {
  const inputs = new Map(slot.sets.map((s) => [s.id, s]));
  const notes: SnapNote[] = [];
  for (const kind of ['rounded', 'capped', 'converted', 'restored'] as const) {
    const group = sets.filter((s) => s.outcome === kind && !s.painHeld);
    if (group.length > 0) notes.push({ kind, setIds: group.map((s) => s.id), top: topOf(group, inputs) });
  }
  const reasons = [...new Set(sets.flatMap((s) => (s.outcome === 'dropped' && s.reason !== undefined && s.intended !== null ? [s.reason] : [])))];
  for (const reason of reasons) {
    const group = sets.filter((s) => s.outcome === 'dropped' && s.reason === reason && s.intended !== null);
    const top = topOf(group, inputs);
    notes.push({
      kind: 'dropped',
      reason,
      setIds: group.map((s) => s.id),
      top,
      lightest: group.find((s) => s.id === top.setId)?.lightest ?? group[0]?.lightest ?? null,
      equipmentName: reason === 'not_here' ? (stationWords(stations) ?? slot.sourceEquipment?.name ?? null) : (eq?.name ?? null),
    });
  }
  const painGroup = sets.filter((s) => s.painHeld || s.reason === 'pain_flag');
  if (painGroup.length > 0) notes.push({ kind: 'pain', setIds: painGroup.map((s) => s.id), top: topOf(painGroup, inputs) });
  return notes;
}

export function snapPlanToGym(input: SnapInput): SnapResult {
  const slots = input.slots.map((slot): SnapSlotResult => {
    const { equipment, mapping, stations = [] } = mapEquipment(slot.exercise, slot.sourceEquipment, input.gym, input.lastUsedHere);
    const unit = equipment?.unit ?? (mapping === 'none_needed' ? slot.unit : input.ownerUnit);
    const convention = equipment?.loadConvention ?? (mapping === 'none_needed' ? slot.convention : slot.exercise.defaultLoadConvention);
    const pain = input.painFlagged?.has(slot.exercise.id) ?? false;
    // Weight held or worn on a bodyweight exercise: fitted to the gym's own dumbbells and plates (rule 4).
    const weighted = convention === 'added' && slot.exercise.defaultLoadConvention === 'bodyweight' && isWeightedBodyweight({ loadConvention: convention }, equipment, true);
    const fitEq = weighted ? addedWeightEquipment(usableAt(input.gym), unit, equipment, input.gym.id) : equipment;
    const sets = slot.sets.map((s) => fitSet(s, fitEq, mapping, unit, convention, input.mode, pain));
    return {
      slotId: slot.slotId,
      exerciseId: slot.exercise.id,
      exerciseName: slot.exercise.name,
      equipment,
      mapping,
      unit,
      convention,
      sourceEquipment: slot.sourceEquipment,
      stations,
      sets,
      notes: notesFor(slot, sets, equipment, stations),
    };
  });
  return { mode: input.mode, gymId: input.gym.id, gymName: input.gym.name, slots };
}

/**
 * What a fitted set stores (`planned.snap`, GS-S1). Null when the load is
 * exactly the intended target on the row's own equipment: nothing to explain
 * or restore.
 */
export function plannedSnapOf(set: SnapSetResult, slot: SnapSlotResult, mode: SnapMode, gymId: string): PlannedSnap | null {
  if (set.outcome === 'exact' && !set.painHeld) return null;
  const src = slot.sourceEquipment;
  return {
    intended: set.intended,
    intendedOn: src === null ? null : { equipmentId: src.id, kind: src.kind, gymId: src.gymId, name: src.name },
    outcome: set.outcome,
    ...(set.reason !== undefined ? { reason: set.reason } : {}),
    ...(set.reason === 'not_here' && slot.stations.length > 0 ? { stations: [...slot.stations] } : {}),
    ...(set.painHeld ? { painHeld: true as const } : {}),
    equipmentId: slot.equipment?.id ?? null,
    gymId: slot.equipment?.gymId ?? (slot.mapping === 'none_needed' ? null : gymId),
    by: mode,
  };
}

/** The source of a set's intended target: the equipment it was made for, else the row's own item. */
export function sourceOf(snap: PlannedSnap | undefined, rowEquipment: EquipmentInstance | null): SnapSource | null {
  if (snap !== undefined) return snap.intendedOn === null ? null : { id: snap.intendedOn.equipmentId, kind: snap.intendedOn.kind, name: snap.intendedOn.name, gymId: snap.intendedOn.gymId };
  return rowEquipment === null ? null : { id: rowEquipment.id, kind: rowEquipment.kind, name: rowEquipment.name, gymId: rowEquipment.gymId };
}

/** The target a set's author intended: `planned.snap.intended`, else the planned load. */
export function intendedOf(planned: { load: Load | null; snap?: PlannedSnap | undefined }): Load | null {
  return planned.snap !== undefined ? planned.snap.intended : planned.load;
}
