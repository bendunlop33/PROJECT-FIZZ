import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, OWNER, profile, richFinishedSession } from '@fizz/domain/testing';
import { createBackup, openStore, type BackupFile } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * `Count it` (progress.md PG25a): schema 8 stores `durationConfirmedAt` on the
 * session row. Idempotent per opId, versioned (stale refused), survives a
 * relaunch, backed up, and Undo clears it.
 */

const APP = { name: 'GymSmarter', version: '0.1.0', build: '9' };

describe('confirm_session_duration (Count it)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('is stored, a retry after relaunch is a duplicate, a stale sheet is refused, it is backed up, and Undo clears the columns', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await store.repos.profiles.save(profile(), null);
    const done = richFinishedSession();
    await store.repos.sessions.save(done, null);
    const sessionId = done.session.id;
    let service = createSessionService(store.repos, () => 'unused');
    const cmd = { type: 'confirm_session_duration' as const, at: at(90_000), opId: 'count-1', confirmed: true, expectedVersion: done.session.version };
    const saved = await service.dispatch(sessionId, cmd);
    if (!saved.ok) throw new Error(saved.error.code);
    expect(saved.aggregate.session.durationConfirmedAt).toEqual(at(90_000));
    expect(saved.aggregate.session.version).toBe(done.session.version + 1);
    // No set changed.
    expect(saved.aggregate.sets).toEqual(done.sets);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, () => 'unused');
    expect((await store.repos.sessions.get(sessionId))?.session.durationConfirmedAt).toEqual(at(90_000));
    expect(await service.dispatch(sessionId, cmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expect(await service.dispatch(sessionId, { ...cmd, opId: 'count-2' })).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    const backup = JSON.parse((await createBackup(store, { at: at(90_100), app: APP })).text) as BackupFile;
    expect(backup.tables.sessions?.find((r) => r.id === sessionId)).toMatchObject({ duration_confirmed_at_utc: at(90_000).utc, duration_confirmed_at_tz: at(90_000).tz });

    const undone = await service.dispatch(sessionId, { ...cmd, at: at(90_200), opId: 'count-undo', confirmed: false, expectedVersion: saved.aggregate.session.version });
    expect(undone.ok).toBe(true);
    const row = await store.db.driver.getFirst<{ u: string | null; t: string | null }>('SELECT duration_confirmed_at_utc AS u, duration_confirmed_at_tz AS t FROM sessions WHERE id = ?', [sessionId]);
    expect(row).toEqual({ u: null, t: null });
    expect((await store.repos.sessions.get(sessionId))?.session).not.toHaveProperty('durationConfirmedAt');
    // The first Count it is now superseded by its Undo.
    expect(await service.dispatch(sessionId, cmd)).toMatchObject({ ok: true, duplicate: true, superseded: true });
    expect(OWNER).toBe(done.session.ownerId);
    await store.close();
  });

  it('half a column is refused by the table', async () => {
    const store = await openStore(openNodeDriver(':memory:'));
    await store.repos.profiles.save(profile(), null);
    await store.repos.sessions.save(richFinishedSession(), null);
    await expect(store.db.driver.run("UPDATE sessions SET duration_confirmed_at_utc = '2026-10-08T06:00:00.000Z'")).rejects.toThrow();
    await store.close();
  });
});
