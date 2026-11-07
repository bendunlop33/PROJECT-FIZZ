import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/** (Ben, 30 Oct) Migration 40 lets coach records hold a plan-wide swap proposal. */
describe('migration 40 in place on a schema-39 database', () => {
  it('keeps every coach action, takes `propose_plan_swap`, refuses unknown kinds, still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 39);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'proposed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'propose_week'));
    await db.run(row('a2', 'fill_setup'));
    await expect(db.run(row('a3', 'propose_plan_swap'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 40)).toEqual({ from: 39, to: 40, applied: [40] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a3', 'propose_plan_swap'));
    await db.run(row('a4', 'propose_workout_edit'));
    await expect(db.run(row('a6', 'delete_workout'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    await expect(db.run(row('a3', 'fill_setup').replace("'a3', 'o', 'op-a3'", "'a9', 'o', 'op-a3'"))).rejects.toThrow();
  });
});
