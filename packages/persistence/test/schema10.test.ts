import { describe, expect, it } from 'vitest';
import { latestVersion, migrate, MIGRATIONS, readUserVersion } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Migration 10 (coach tools, 11 Oct): `coach_actions` takes `log_set` and
 * `correct_set`. 8 and 9 are reserved no-ops on this branch (delete-workouts
 * and workout-library replace them at merge).
 */
const row = (id: string, kind: string) =>
  `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${id}', 'o', 'op-${id}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;

describe('migration 10: coach set actions', () => {
  it('a schema-7 database keeps its coach actions, then takes log_set and correct_set and still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 7);
    await db.run(row('a1', 'update_routine'));
    await expect(db.run(row('a2', 'log_set'))).rejects.toThrow();
    const report = await migrate(db);
    expect(report).toEqual({ from: 7, to: latestVersion(), applied: [8, 9, 10] });
    expect(await readUserVersion(db)).toBe(10);
    expect(await db.getFirst('SELECT kind FROM coach_actions WHERE id = ?', ['a1'])).toEqual({ kind: 'update_routine' });
    await db.run(row('a2', 'log_set'));
    await db.run(row('a3', 'correct_set'));
    await expect(db.run(row('a4', 'delete_set'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    // The op ID stays unique per owner.
    await expect(db.run("INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('a5', 'o', 'op-a1', NULL, NULL, 'log_set', 'committed', 1, 't', 't', '{}')")).rejects.toThrow();
  });
});
