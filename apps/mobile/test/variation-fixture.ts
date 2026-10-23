import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { mainLiftKey, PlanDayVariationSchema, type VariationOp } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { Harness } from './harness';

/**
 * A saved plan-day variation as an older build left it (Ben, 23 Oct, D1: Start no longer saves new ones, but the
 * ones he has still open, rename and delete). Written straight into the training database between launches, as the
 * other on-disk fixtures are; returns the relaunched services.
 */
export async function seedVariation(
  h: Harness,
  s: AppServices,
  v: { id: string; templateRoutineId: string; splitDayId: string; mainLiftExerciseId: string | null; label: string; extras: VariationOp[] },
): Promise<AppServices> {
  const file = s.developer.databaseNames().current;
  await h.forceClose();
  const db = new DatabaseSync(join(h.dir, file));
  const row = db.prepare('SELECT owner_id, version FROM routines WHERE id = ?').get(v.templateRoutineId) as { owner_id: string; version: number } | undefined;
  if (row === undefined) throw new Error('no template');
  const at = h.now().utc;
  const variation = PlanDayVariationSchema.parse({
    id: v.id,
    ownerId: row.owner_id,
    version: 1,
    createdAtUtc: at,
    updatedAtUtc: at,
    splitDayId: v.splitDayId,
    mainLiftExerciseId: v.mainLiftExerciseId,
    label: v.label,
    extras: v.extras,
    basedOn: { routineId: v.templateRoutineId, version: row.version },
    deletedAtUtc: null,
    opIds: [`seed:${v.id}`],
  });
  db.prepare('INSERT INTO plan_day_variations (id, owner_id, split_day_id, main_lift_key, deleted, version, updated_at_utc, data) VALUES (?, ?, ?, ?, 0, 1, ?, ?)').run(variation.id, variation.ownerId, variation.splitDayId, mainLiftKey(variation.mainLiftExerciseId), at, JSON.stringify(variation));
  db.close();
  return (await h.launch()).services;
}
