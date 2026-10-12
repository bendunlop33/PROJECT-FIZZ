import { describe, expect, it } from 'vitest';
import { latestVersion, migrate, MIGRATIONS, readUserVersion } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Migration 10 (coach tools, 11 Oct): `coach_actions` takes `log_set`,
 * `correct_set` and `suggest_memory`; `memories` takes `suggested` and
 * `not_saved`; `playbook_candidates` takes `approved` and `rejected`. Each
 * table is rebuilt, so rows, unique indexes and no-delete triggers are
 * checked after it. 8 and 9 are reserved no-ops on this branch
 * (delete-workouts and workout-library replace them at merge, in that order;
 * `scripts/check-migrations.ts` blocks a release until then).
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

  it('coach_actions takes suggest_memory', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 7);
    await expect(db.run(row('s0', 'suggest_memory'))).rejects.toThrow();
    await migrate(db);
    await db.run(row('s1', 'suggest_memory'));
    expect(await db.getFirst('SELECT kind FROM coach_actions WHERE id = ?', ['s1'])).toEqual({ kind: 'suggest_memory' });
  });

  it('memories: rows survive, suggested and not_saved are accepted, one active per key, never deleted', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 7);
    const mem = (id: string, key: string, status: string) =>
      `INSERT INTO memories (id, owner_id, content_key, status, version, updated_at_utc, data) VALUES ('${id}', 'o', '${key}', '${status}', 1, 't', '{"x":1}')`;
    await db.run(mem('m1', 'k1', 'active'));
    await db.run(mem('m2', 'k2', 'forgotten'));
    await expect(db.run(mem('m0', 'k0', 'suggested'))).rejects.toThrow();
    await migrate(db);
    expect(await db.getAll('SELECT id, content_key, status, version, data FROM memories ORDER BY id')).toEqual([
      { id: 'm1', content_key: 'k1', status: 'active', version: 1, data: '{"x":1}' },
      { id: 'm2', content_key: 'k2', status: 'forgotten', version: 1, data: '{"x":1}' },
    ]);
    await db.run(mem('m3', 'k3', 'suggested'));
    await db.run(mem('m4', 'k3', 'suggested'));
    await db.run(mem('m5', 'k3', 'not_saved'));
    await expect(db.run(mem('m6', 'k3', 'deleted'))).rejects.toThrow();
    // memories_one_active: a second active row with the same key is refused; other statuses aren't limited.
    await expect(db.run(mem('m7', 'k1', 'active'))).rejects.toThrow();
    await db.run(mem('m8', 'k1', 'suggested'));
    await expect(db.run("DELETE FROM memories WHERE id = 'm1'")).rejects.toThrow(/tombstoned/);
  });

  it('playbook_candidates: rows survive, approved and rejected are accepted, one open per key, never deleted', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 7);
    const pc = (id: string, key: string, status: string) =>
      `INSERT INTO playbook_candidates (id, content_key, status, version, updated_at_utc, data) VALUES ('${id}', '${key}', '${status}', 1, 't', '{"y":2}')`;
    await db.run(pc('p1', 'k1', 'to_review'));
    await db.run(pc('p2', 'k2', 'withdrawn'));
    await expect(db.run(pc('p0', 'k0', 'approved'))).rejects.toThrow();
    await migrate(db);
    expect(await db.getAll('SELECT id, content_key, status, version, data FROM playbook_candidates ORDER BY id')).toEqual([
      { id: 'p1', content_key: 'k1', status: 'to_review', version: 1, data: '{"y":2}' },
      { id: 'p2', content_key: 'k2', status: 'withdrawn', version: 1, data: '{"y":2}' },
    ]);
    await db.run(pc('p3', 'k3', 'approved'));
    await db.run(pc('p4', 'k4', 'rejected'));
    await expect(db.run(pc('p5', 'k5', 'graded'))).rejects.toThrow();
    // playbook_candidates_one_open: one to_review row per key.
    await expect(db.run(pc('p6', 'k1', 'to_review'))).rejects.toThrow();
    await db.run(pc('p7', 'k1', 'approved'));
    await expect(db.run("DELETE FROM playbook_candidates WHERE id = 'p1'")).rejects.toThrow(/withdrawn, not deleted/);
  });
});

