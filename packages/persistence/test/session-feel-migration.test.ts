import { describe, expect, it } from 'vitest';
import { reduceSession } from '@fizz/domain';
import { at, profile, richFinishedSession } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore } from '../src/index';
import { memoryDriver } from './helpers';

/** Migration 32: `sessions.feel` (Summary's `How did it feel?`, Ben 21 Oct). */
describe('migration 32 (session feel)', () => {
  it('in place on a schema-31 database: every session row kept, none answered', async () => {
    const db = memoryDriver();
    const at31 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 31) });
    await at31.repos.profiles.save(profile(), null);
    await at31.repos.sessions.save(richFinishedSession(), null);
    const before = await at31.db.read((q) => exportTables(q));
    expect(await migrate(db)).toMatchObject({ from: 31, applied: [32, 33, 34, 35, 36, 37] });
    const at32 = await openStore(db);
    const after = await at32.db.read((q) => exportTables(q));
    expect(after.sessions).toEqual((before.sessions ?? []).map((r) => ({ ...r, feel: null, deload: null, past_log: null })));
    expect((await at32.repos.sessions.get(richFinishedSession().session.id))?.session.feel).toBeUndefined();
    expect((await checkIntegrity(at32.db)).ok).toBe(true);
    await at32.close();
  });

  it('stores, changes and clears it through `set_feel`; malformed JSON is refused by the column', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const s = richFinishedSession();
    await store.repos.sessions.save(s, null);
    const step = async (opId: string, feel: 'easy' | 'good' | 'hard' | null) => {
      const cur = await store.repos.sessions.get(s.session.id);
      if (cur === null) throw new Error('missing');
      const r = reduceSession(cur, { type: 'set_feel', at: at(9000), opId, feel, expectedVersion: cur.session.version });
      if (!r.ok) throw new Error(r.error.code);
      expect((await store.repos.sessions.save({ ...r.state, revision: cur.revision + 1 }, cur.revision)).ok).toBe(true);
      return (await store.repos.sessions.get(s.session.id))?.session.feel;
    };
    expect(await step('f1', 'hard')).toEqual({ value: 'hard', at: at(9000) });
    expect(await step('f2', 'good')).toMatchObject({ value: 'good' });
    expect(await step('f3', null)).toMatchObject({ value: null });
    await expect(store.db.write((tx) => tx.run('UPDATE sessions SET feel = ? WHERE id = ?', ['{bad', s.session.id]))).rejects.toThrow();
    await store.close();
  });
});
