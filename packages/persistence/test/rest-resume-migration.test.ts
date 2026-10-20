import { describe, expect, it } from 'vitest';
import { apply, kg, logCmd, profile, richFinishedSession, startFixture, values } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore } from '../src/index';
import { memoryDriver } from './helpers';

/** Migration 31: the rest a log replaced is kept with the timer, so Undo can put it back after a force-close. */
describe('migration 31 (rest kept for undo)', () => {
  it('in place on a schema-30 database: every rest timer row kept, with no rest to put back', async () => {
    const db = memoryDriver();
    const at30 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 30) });
    await at30.repos.profiles.save(profile(), null);
    await at30.repos.sessions.save(richFinishedSession(), null);
    const before = await at30.db.read((q) => exportTables(q));
    expect(before.rest_timers?.length).toBe(1);
    expect(await migrate(db)).toMatchObject({ from: 30, applied: [31] });
    const at31 = await openStore(db);
    const after = await at31.db.read((q) => exportTables(q));
    expect(after.rest_timers).toEqual((before.rest_timers ?? []).map((r) => ({ ...r, resume_on_undo: null })));
    expect((await at31.repos.sessions.get(richFinishedSession().session.id))?.restTimer?.resumeOnUndo).toBeUndefined();
    expect((await checkIntegrity(at31.db)).ok).toBe(true);
    await at31.close();
  });

  it('stores and reads back the kept rest; malformed JSON is refused by the column', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const { state } = startFixture();
    const [w, b1] = state.sets;
    if (!w || !b1) throw new Error('fixture');
    const s = apply(apply(state, logCmd(w.id, values(kg(60), 10), 30)), logCmd(b1.id, values(kg(100), 8), 40));
    expect(s.restTimer?.resumeOnUndo).toHaveLength(1);
    await store.repos.sessions.save(s, null);
    expect((await store.repos.sessions.get(s.session.id))?.restTimer).toEqual(s.restTimer);
    await expect(store.db.write((tx) => tx.run("UPDATE rest_timers SET resume_on_undo = '{nope'"))).rejects.toThrow();
    await store.close();
  });
});
