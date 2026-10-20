import { describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Migration 25 (20 Oct, ADR 0029): `coach_actions.kind` gains `update_gym`. Every earlier kind and
 * row survives the rebuild, with its indexes and the no-delete trigger.
 */
describe('migration 25 in place on a schema-24 database', () => {
  it('keeps every coach action; the new CHECK takes `update_gym` and refuses unknown kinds; deletes still refused', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 24);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'proposed', 1, 't', 't', '{}')`;
    for (const [rid, kind] of [['a1', 'build_plan'], ['a2', 'edit_today'], ['a3', 'propose_exercise'], ['a4', 'undo']] as const) await db.run(row(rid, kind));
    await expect(db.run(row('a5', 'update_gym'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db)).toEqual({ from: 24, to: 25, applied: [25] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('a5', 'update_gym'));
    await expect(db.run(row('a6', 'not_a_kind'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE tbl_name = 'coach_actions' AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name")).toEqual([
      { name: 'coach_actions_no_delete' },
      { name: 'coach_actions_op' },
      { name: 'coach_actions_owner' },
      { name: 'coach_actions_session' },
      { name: 'coach_actions_turn' },
    ]);
  });
});
