import { describe, expect, it } from 'vitest';
import { profile, richFinishedSession } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * (Ben, 2 Nov) Migration 45: `session_exercises.warmup`, a cardio row Ben asked for as a warm-up. Older rows read
 * unmarked; a marked row keeps its mark across a reopen (force-close) and in history.
 */
describe('migration 45 (session warm-up row)', () => {
  it('in place on a schema-44 database: every row kept, none marked', async () => {
    const db = memoryDriver();
    const at44 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 44) });
    await at44.repos.profiles.save(profile(), null);
    await at44.repos.sessions.save(richFinishedSession(), null);
    const before = await at44.db.read((q) => exportTables(q));
    expect(await migrate(db)).toEqual({ from: 44, to: 45, applied: [45] });
    const at45 = await openStore(db);
    const after = await at45.db.read((q) => exportTables(q));
    for (const [t, rows] of Object.entries(before)) {
      if (t === 'session_exercises') expect(after.session_exercises).toEqual(rows.map((r) => ({ ...r, warmup: null })));
      else expect(after[t], t).toEqual(rows);
    }
    const read = await at45.repos.sessions.get(richFinishedSession().session.id);
    expect(read?.exercises.some((e) => e.warmup === true)).toBe(false);
    expect((await checkIntegrity(at45.db)).ok).toBe(true);
    await at45.close();
  });

  it('a marked row is stored, read back after a reopen, and only 1 or NULL is accepted', async () => {
    const db = memoryDriver();
    const s = await openStore(db);
    await s.repos.profiles.save(profile(), null);
    const a = richFinishedSession();
    const first = a.exercises[0];
    if (first === undefined) throw new Error('no exercise');
    const marked = { ...a, exercises: a.exercises.map((e) => (e.id === first.id ? { ...e, warmup: true as const } : e)) };
    await s.repos.sessions.save(marked, null);
    // A reopen on the same database (as after a force-close).
    const again = await openStore(db);
    const read = await again.repos.sessions.get(a.session.id);
    expect(read?.exercises.find((e) => e.id === first.id)?.warmup).toBe(true);
    expect(read?.exercises.filter((e) => e.id !== first.id).every((e) => e.warmup === undefined)).toBe(true);
    await expect(db.run(`UPDATE session_exercises SET warmup = 2 WHERE id = '${first.id}'`)).rejects.toThrow();
    await again.close();
  });
});
