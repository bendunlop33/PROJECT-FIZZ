import { describe, expect, it } from 'vitest';
import { latestVersion, migrate, MIGRATIONS } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Migration 14 (12 Oct): `coach_actions.kind` gains `add_exercise_today`.
 * The table is rebuilt in place on a schema-13 database: every row of every
 * earlier kind is kept, the indexes and the no-delete trigger come back.
 */
describe('migration 14 in place on a schema-13 database', () => {
  it('keeps every coach action, takes `add_exercise_today`, refuses unknown kinds, and still refuses deletes', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 13);
    const row = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    const kinds = ['adjust_pending_sets', 'log_set', 'correct_set', 'set_next_session_targets', 'propose_next_workout_change', 'set_pain_flag', 'save_memory', 'suggest_memory', 'forget_memory', 'add_playbook_candidate', 'update_routine', 'fit_today', 'build_workout', 'undo'];
    for (const [i, kind] of kinds.entries()) await db.run(row(`a${String(i)}`, kind));
    // At 13 the old CHECK refuses the new kind.
    await expect(db.run(row('n1', 'add_exercise_today'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 14)).toEqual({ from: 13, to: 14, applied: [14] });
    expect(latestVersion()).toBeGreaterThanOrEqual(14);
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(row('n1', 'add_exercise_today'));
    await expect(db.run(row('n2', 'not_a_kind'))).rejects.toThrow();
    // The opId stays unique per owner.
    await expect(db.run(row('n3', 'add_exercise_today').replace("'op-n3'", "'op-n1'"))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'n1'")).rejects.toThrow(/never deleted/);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE tbl_name = 'coach_actions' AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name")).toEqual([
      { name: 'coach_actions_no_delete' },
      { name: 'coach_actions_op' },
      { name: 'coach_actions_owner' },
      { name: 'coach_actions_session' },
      { name: 'coach_actions_turn' },
    ]);
  });
});
