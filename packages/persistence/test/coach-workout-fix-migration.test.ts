import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/** (Ben, 2 Nov) Migration 42 lets coach records hold a past-workout fix (`fix_workout`). */
describe('migration 42 in place on a schema-41 database', () => {
  it('keeps every coach action, takes `fix_workout`, refuses unknown kinds, still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 41);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    await db.run(row('a1', 'update_warmup_prefs'));
    await db.run(row('a2', 'correct_set'));
    await expect(db.run(row('a3', 'fix_workout'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 42)).toEqual({ from: 41, to: 42, applied: [42] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a3', 'fix_workout'));
    await expect(db.run(row('a4', 'delete_workout'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
  });
});
