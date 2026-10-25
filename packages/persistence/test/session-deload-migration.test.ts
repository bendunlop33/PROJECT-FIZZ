import { describe, expect, it } from 'vitest';
import { toHistorySessions } from '@fizz/domain';
import { at, profile, richFinishedSession } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore } from '../src/index';
import { memoryDriver } from './helpers';

const DELOAD = { planId: '00000000-0000-4000-8000-000000009100', week: 6, of: 6 };

/** Migration 34: `sessions.deload` (PM, 23 Oct: deload-week sets don't count as normal history). */
describe('migration 34 (session deload)', () => {
  it('in place on a schema-33 database: every session row kept, none marked', async () => {
    const db = memoryDriver();
    const at33 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 33) });
    await at33.repos.profiles.save(profile(), null);
    await at33.repos.sessions.save(richFinishedSession(), null);
    const before = await at33.db.read((q) => exportTables(q));
    expect(await migrate(db)).toMatchObject({ from: 33, to: 36, applied: [34, 35, 36] });
    const at34 = await openStore(db);
    const after = await at34.db.read((q) => exportTables(q));
    for (const [t, rows] of Object.entries(before)) {
      if (t === 'sessions') expect(after.sessions).toEqual(rows.map((r) => ({ ...r, deload: null, past_log: null })));
      else if (t === 'timing_audit') expect(after.timing_audit).toEqual(rows.map((r) => ({ ...r, shift_ms: null })));
      else expect(after[t]).toEqual(rows);
    }
    expect((await at34.repos.sessions.get(richFinishedSession().session.id))?.session.deload).toBeUndefined();
    expect((await checkIntegrity(at34.db)).ok).toBe(true);
    await at34.close();
  });

  it('stores the mark, keeps it across a reopen (force-close) and into history; malformed JSON is refused', async () => {
    const db = memoryDriver();
    const store = await openStore(db);
    await store.repos.profiles.save(profile(), null);
    const s = richFinishedSession();
    await store.repos.sessions.save({ ...s, session: { ...s.session, deload: DELOAD } }, null);
    expect((await store.db.read((q) => exportTables(q))).sessions?.[0]?.deload).toBe(JSON.stringify(DELOAD));

    // A fresh store on the same database (what a relaunch reads).
    const reopened = await openStore(db);
    const got = await reopened.repos.sessions.get(s.session.id);
    expect(got?.session.deload).toEqual(DELOAD);
    const exerciseId = got?.exercises[0]?.exerciseId ?? '';
    expect(toHistorySessions(got ?? s, exerciseId)[0]?.deload).toBe(true);
    expect((await reopened.listExerciseHistory(s.session.ownerId, exerciseId))[0]?.deload).toBe(true);
    await expect(reopened.db.write((tx) => tx.run('UPDATE sessions SET deload = ? WHERE id = ?', ['{bad', s.session.id]))).rejects.toThrow();
    // An unrelated later write (a finished workout's feel) keeps the mark.
    const cur = await reopened.repos.sessions.get(s.session.id);
    if (cur === null) throw new Error('missing');
    expect((await reopened.repos.sessions.save({ ...cur, session: { ...cur.session, feel: { value: 'easy', at: at(9000) } }, revision: cur.revision + 1 }, cur.revision)).ok).toBe(true);
    expect((await reopened.repos.sessions.get(s.session.id))?.session.deload).toEqual(DELOAD);
    await reopened.close();
  });
});
