import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/** (Ben, 2 Nov) Migration 43 lets coach records hold a plan-level change and a rest-settings change. */
describe('migration 43 in place on a schema-42 database', () => {
  it('keeps every coach action, takes `propose_plan_change` and `update_rest_settings`, refuses unknown kinds, still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 42);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'update_warmup_prefs'));
    await db.run(row('a2', 'propose_plan_swap'));
    await db.run(row('a5', 'set_exercise_preference'));
    await expect(db.run(row('a3', 'propose_plan_change'))).rejects.toThrow();
    await expect(db.run(row('a4', 'update_rest_settings'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 43)).toEqual({ from: 42, to: 43, applied: [43] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a3', 'propose_plan_change'));
    await db.run(row('a4', 'update_rest_settings'));
    await expect(db.run(row('a6', 'delete_workout'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
  });
});
