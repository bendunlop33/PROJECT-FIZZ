import { describe, expect, it } from 'vitest';
import { apply, at, kg, logCmd, profile, richFinishedSession, startFixture, values } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore } from '../src/index';
import { beforeSchema31, memoryDriver } from './helpers';

/** Migration 31: the rest a log replaced is kept with the timer, so Undo can put it back after a force-close. */
describe('migration 31 (rest kept for undo)', () => {
  it('in place on a schema-30 database: every rest timer row kept, with no rest to put back', async () => {
    const db = memoryDriver();
    const at30 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 30) });
    await at30.repos.profiles.save(profile(), null);
    await at30.repos.sessions.save(beforeSchema31(richFinishedSession()), null);
    const before = await at30.db.read((q) => exportTables(q));
    expect(before.rest_timers?.length).toBe(1);
    expect(await migrate(db)).toMatchObject({ from: 30, applied: [31] });
    const at31 = await openStore(db);
    const after = await at31.db.read((q) => exportTables(q));
    expect(after.rest_timers).toEqual((before.rest_timers ?? []).map((r) => ({ ...r, resume_on_undo: null, restored_finished: null })));
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

  it('stores and reads back a kept rest that had already finished (expired, ended at its deadline)', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const { state } = startFixture();
    const [w, b1] = state.sets;
    if (!w || !b1) throw new Error('fixture');
    // W's 60 s rest ran out at 1:30; B1 logged at 2:00.
    const s = apply(apply(state, logCmd(w.id, values(kg(60), 10), 30)), logCmd(b1.id, values(kg(100), 8), 120));
    expect(s.restTimer?.resumeOnUndo?.[0]?.timer).toMatchObject({ status: 'expired', endedAtUtc: s.restTimer?.resumeOnUndo?.[0]?.timer.deadlineUtc });
    await store.repos.sessions.save(s, null);
    expect((await store.repos.sessions.get(s.session.id))?.restTimer).toEqual(s.restTimer);
    // Undone: back finished, marked so no late end cue speaks after a relaunch (review rest-undo-sp1 B1).
    const back = apply(s, { type: 'undo_log', at: at(125), opId: 'undo', setId: b1.id, expectedSetVersion: 2 });
    expect(back.restTimer).toMatchObject({ status: 'expired', restoredFinished: true });
    await store.repos.sessions.save(back, s.session.version);
    expect((await store.repos.sessions.get(s.session.id))?.restTimer).toEqual(back.restTimer);
    const rows = await store.db.read((q) => q.getAll('SELECT restored_finished FROM rest_timers'));
    expect(rows).toEqual([{ restored_finished: 1 }]);
    await expect(store.db.write((tx) => tx.run('UPDATE rest_timers SET restored_finished = 0'))).rejects.toThrow();
    await store.close();
  });
});
