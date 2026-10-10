import type { EquipmentInstance, SessionExercise, WorkoutSession } from '@fizz/schemas';

/**
 * A workout's equipment snapshot after gym switches (gym-switch §4.3, GS-S3).
 * The snapshot is append-only and unique by `(id, version)`: the first entries
 * are the starting gym's items, and each switch (or `[Use changes today]`)
 * appends what it brought. Done sets keep resolving the item they were
 * logged on; everything that plans or steps a load reads only the current
 * gym's part.
 */

/** The snapshot entry a row uses: its pinned version, else the latest entry with that ID. */
export function equipmentOfRow(
  snapshot: readonly EquipmentInstance[],
  row: Pick<SessionExercise, 'equipmentId' | 'equipmentVersion'>,
): EquipmentInstance | null {
  if (row.equipmentId === null) return null;
  let found: EquipmentInstance | null = null;
  for (const e of snapshot) {
    if (e.id !== row.equipmentId) continue;
    if (row.equipmentVersion !== undefined) {
      if (e.version === row.equipmentVersion) return e;
      continue;
    }
    found = e;
  }
  return found;
}

/** Latest entry per ID, in first-seen order. */
function latestPerId(entries: readonly EquipmentInstance[]): EquipmentInstance[] {
  const order: string[] = [];
  const latest = new Map<string, EquipmentInstance>();
  for (const e of entries) {
    if (!latest.has(e.id)) order.push(e.id);
    latest.set(e.id, e);
  }
  return order.map((id) => latest.get(id)).filter((e): e is EquipmentInstance => e !== undefined);
}

/**
 * The equipment Ben can use now: the current gym's items, latest version
 * each. A workout that never switched keeps its whole snapshot (as before).
 */
export function currentGymEquipment(session: Pick<WorkoutSession, 'gymId' | 'gymChanges' | 'equipmentSnapshot'>): EquipmentInstance[] {
  const all = latestPerId(session.equipmentSnapshot);
  if (!session.gymChanges || session.gymChanges.length === 0) return all;
  return all.filter((e) => e.gymId === session.gymId);
}

/** True when the row's equipment belongs to the workout's current gym (or it has none). */
export function rowIsAtCurrentGym(session: Pick<WorkoutSession, 'gymId' | 'gymChanges' | 'equipmentSnapshot'>, row: Pick<SessionExercise, 'equipmentId' | 'equipmentVersion'>): boolean {
  if (row.equipmentId === null) return true;
  const eq = equipmentOfRow(session.equipmentSnapshot, row);
  if (eq === null) return false;
  const current = currentGymEquipment(session).find((e) => e.id === eq.id);
  return current !== undefined && current.version === eq.version;
}

/**
 * Append a gym's items to the snapshot, skipping any `(id, version)` already
 * there. `newerVersionOf` lists IDs that gained a newer version, whose
 * existing rows must be pinned to the version they were using.
 */
export function appendToSnapshot(
  snapshot: readonly EquipmentInstance[],
  entries: readonly EquipmentInstance[],
): { snapshot: EquipmentInstance[]; newerVersionOf: Map<string, number> } {
  const next = [...snapshot];
  const newerVersionOf = new Map<string, number>();
  for (const e of entries) {
    if (next.some((x) => x.id === e.id && x.version === e.version)) continue;
    const prior = equipmentOfRow(next, { equipmentId: e.id });
    if (prior !== null && !newerVersionOf.has(e.id)) newerVersionOf.set(e.id, prior.version);
    next.push(e);
  }
  return { snapshot: next, newerVersionOf };
}
