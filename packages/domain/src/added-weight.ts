import type { EquipmentInstance, LoadConvention, PlateLoadedMachine, WeightUnit } from '@fizz/schemas';
import { getAchievableLoads } from './equipment';
import { toScaled, fromScaled } from './units';

/**
 * Weight held or worn on a bodyweight exercise (Ben, 18 Oct: "make a body
 * weight eg lower back extensions to be including weight"). The set records
 * the added mass only (`convention: 'added'`), never a bodyweight-inclusive
 * number (rule 6). What can be added comes from the gym's own dumbbells and
 * plates, in the row's unit (never converted, never invented: rule 4).
 *
 * `bodyweightExercise`: the catalogue's default convention for the exercise
 * is `bodyweight`. A row with no equipment already in `added` is otherwise
 * ambiguous (a sled push, or a leg press whose machine isn't here, reads the
 * same), so it is only treated as weighted bodyweight when this says so.
 */

type Row = { loadConvention: LoadConvention };
type Kind = Pick<EquipmentInstance, 'kind'> | null;

/** The row can switch between bodyweight and added weight. */
export function canAddWeight(row: Row, equipment: Kind, bodyweightExercise = false): boolean {
  if (row.loadConvention !== 'bodyweight' && row.loadConvention !== 'added') return false;
  if (equipment !== null) return equipment.kind === 'bodyweight_station';
  return row.loadConvention === 'bodyweight' || bodyweightExercise;
}

/** A bodyweight exercise logged with added weight: its loads are checked against the gym's dumbbells and plates. */
export function isWeightedBodyweight(row: Row, equipment: Kind, bodyweightExercise = false): boolean {
  return row.loadConvention === 'added' && canAddWeight(row, equipment, bodyweightExercise);
}

/**
 * Masses Ben can hold or wear here: each dumbbell (bounded by the rack's
 * min/max) and each plate size the gym has, in `unit`. Ascending, no zero.
 */
export function addedWeightItems(gymEquipment: readonly EquipmentInstance[], unit: WeightUnit): number[] {
  const scaled = new Set<number>();
  for (const eq of gymEquipment) {
    if (eq.availability !== 'available' || eq.unit !== unit) continue;
    if (eq.kind === 'dumbbells') for (const v of getAchievableLoads(eq).loads) scaled.add(toScaled(v));
    if (eq.kind === 'barbell' || eq.kind === 'plate_loaded_machine') for (const p of eq.plates) if (p.count > 0) scaled.add(toScaled(p.mass));
  }
  return [...scaled].filter((s) => s > 0).sort((a, b) => a - b).map(fromScaled);
}

/**
 * The added-weight options as an equipment item, so the shared rounding and
 * stepping code (`roundToAvailableLoad`, `stepLoad`, `isLoadAchievable`)
 * applies unchanged: one of each item, combinable, never more than the
 * heaviest single item, and 0 (nothing added; all a gym with nothing to
 * add can make). For load checks only; display keeps the row's real item.
 */
export function addedWeightEquipment(
  gymEquipment: readonly EquipmentInstance[],
  unit: WeightUnit,
  base: EquipmentInstance | null,
  gymId: string | null,
): PlateLoadedMachine {
  const items = addedWeightItems(gymEquipment, unit);
  const heaviest = items[items.length - 1];
  const stamp = base?.updatedAtUtc ?? '1970-01-01T00:00:00.000Z';
  return {
    id: base?.id ?? `added-weight:${gymId ?? 'none'}`,
    ownerId: base?.ownerId ?? 'added-weight',
    version: base?.version ?? 1,
    createdAtUtc: base?.createdAtUtc ?? stamp,
    updatedAtUtc: stamp,
    gymId: base?.gymId ?? gymId ?? 'none',
    name: base?.name ?? 'Added weight',
    unit,
    movementTags: [],
    availability: 'available',
    kind: 'plate_loaded_machine',
    loadConvention: 'added',
    loadingSides: 1,
    plates: items.map((mass) => ({ mass, count: 1 })),
    ...(heaviest === undefined ? {} : { maxLoad: heaviest }),
  };
}

/**
 * The item a row's loads are checked against: the added-weight options for a
 * weighted bodyweight row, else the row's own item.
 */
export function loadCheckEquipment(
  row: Row & { unit: WeightUnit },
  equipment: EquipmentInstance | null,
  gymEquipment: readonly EquipmentInstance[],
  gymId: string | null,
  bodyweightExercise = false,
): EquipmentInstance | null {
  if (!isWeightedBodyweight(row, equipment, bodyweightExercise)) return equipment;
  return addedWeightEquipment(gymEquipment, row.unit, equipment, gymId);
}

/**
 * `+ Weight` / back to bodyweight for a row: null when the row can't switch,
 * or is bodyweight and the gym has nothing to add.
 */
export function addWeightToggle(
  row: Row & { unit: WeightUnit },
  equipment: Kind,
  gymEquipment: readonly EquipmentInstance[],
  bodyweightExercise = false,
): { on: boolean } | null {
  if (!canAddWeight(row, equipment, bodyweightExercise)) return null;
  const on = row.loadConvention === 'added';
  if (!on && addedWeightItems(gymEquipment, row.unit).length === 0) return null;
  return { on };
}

/**
 * The row is a bodyweight exercise by the session's own record: a set of it
 * carries `planned.bodyweightExercise` (stamped at start or by
 * `set_load_mode`). Lets the reducer check added weight without the
 * catalogue, and keeps a sled push or a leg press whose machine is missing
 * (also `added`, no item) out of it.
 */
export function rowMarkedBodyweight(sets: readonly { sessionExerciseId: string; planned: { bodyweightExercise?: true | undefined } }[], sessionExerciseId: string): boolean {
  return sets.some((s) => s.sessionExerciseId === sessionExerciseId && s.planned.bodyweightExercise === true);
}
