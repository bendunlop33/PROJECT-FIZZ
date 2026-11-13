import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/** (Ben, 1 Nov) Migration 41 lets coach records hold a warm-up settings change (`update_warmup_prefs`). */
describe('migration 41 in place on a schema-40 database', () => {
  it('keeps every coach action, takes `update_warmup_prefs`, refuses unknown kinds, still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 40);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'propose_plan_swap'));
    await db.run(row('a2', 'set_lift_target'));
    await expect(db.run(row('a3', 'update_warmup_prefs'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 41)).toEqual({ from: 40, to: 41, applied: [41] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a3', 'update_warmup_prefs'));
    await expect(db.run(row('a6', 'delete_workout'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
  });
});
