import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/** ADR 0039 (Ben, 29 Oct): migration 39 lets coach records hold a Your workout change and a Set up fill. */
describe('migration 39 in place on a schema-38 database', () => {
  it('keeps every coach action, takes `propose_workout_edit` and `fill_setup`, refuses unknown kinds, still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 38);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'proposed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'propose_week'));
    await db.run(row('a2', 'edit_today'));
    await expect(db.run(row('a3', 'propose_workout_edit'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 39)).toEqual({ from: 38, to: 39, applied: [39] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a3', 'propose_workout_edit'));
    await db.run(row('a4', 'fill_setup'));
    await db.run(row('a5', 'log_activity'));
    await expect(db.run(row('a6', 'delete_workout'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    // The op ID stays unique per owner.
    await expect(db.run(row('a3', 'fill_setup').replace("'a3', 'o', 'op-a3'", "'a9', 'o', 'op-a3'"))).rejects.toThrow();
  });
});
