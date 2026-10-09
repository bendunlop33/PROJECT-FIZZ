import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCheckInPatch, clearPainFlag, createSessionService, newCheckIn, newPainFlag } from '@fizz/domain';
import { at, GYM, id, idGen, OWNER, profile, SPLIT_SQUAT } from '@fizz/domain/testing';
import { checkIntegrity, InvalidRecordError, openStore, type Store } from '../src/index';
import { memoryDriver } from './helpers';

let store: Store;
beforeEach(async () => {
  store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
});
afterEach(async () => {
  await store.close();
});

const ci = (n: number, seconds: number) =>
  newCheckIn({ id: id(n), ownerId: OWNER, opId: `op-${n}`, score: 3, reasons: ['tired'], at: at(seconds), localDate: '2026-10-08' });

describe('check-ins (schema 2)', () => {
  it('saves versioned documents and lists recent ones newest first', async () => {
    const a = ci(300, 0);
    const b = ci(301, 60);
    expect(await store.repos.checkIns.save(a, null)).toEqual({ ok: true, version: 1 });
    expect(await store.repos.checkIns.save(b, null)).toEqual({ ok: true, version: 1 });
    // A retried create (same ID) is refused as a conflict, never a second record.
    expect(await store.repos.checkIns.save(a, null)).toMatchObject({ ok: false, error: 'conflict' });
    const patched = applyCheckInPatch(a, { score: 2 }, 'op-x', at(5));
    if (patched.kind !== 'updated') throw new Error(patched.kind);
    expect(await store.repos.checkIns.save(patched.checkIn, 1)).toEqual({ ok: true, version: 2 });
    // A stale write (expected version 1 again) is rejected.
    expect(await store.repos.checkIns.save(patched.checkIn, 1)).toMatchObject({ ok: false, error: 'conflict' });
    expect((await store.repos.checkIns.listSince(OWNER, at(-10).utc)).map((c) => [c.id, c.version])).toEqual([
      [b.id, 1],
      [a.id, 2],
    ]);
    expect((await store.repos.checkIns.listSince(OWNER, at(30).utc)).map((c) => c.id)).toEqual([b.id]);
    await expect(store.repos.checkIns.save({ ...b, note: 'x'.repeat(281), version: 2 }, 1)).rejects.toBeInstanceOf(InvalidRecordError);
  });

  it('links a check-in to exactly one workout, in the session write', async () => {
    const c = ci(300, 0);
    await store.repos.checkIns.save(c, null);
    await store.repos.exercises.save(SPLIT_SQUAT, null);
    const service = createSessionService(store.repos, idGen(50_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 'start-1', at: at(10), checkIn: { kind: 'answered', checkInId: c.id } });
    if (!started.ok) throw new Error(started.error.message);
    expect(await store.repos.checkIns.linkedIds([c.id, id(999)])).toEqual(new Set([c.id]));
    const read = await store.repos.sessions.get(started.aggregate.session.id);
    expect(read?.session.checkIn).toEqual({ kind: 'answered', checkInId: c.id });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('keeps pain flags per exercise and lists only active ones', async () => {
    const f = newPainFlag({ id: id(400), ownerId: OWNER, opId: 'p', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: null, source: 'check_in', checkInId: null, at: at(0) });
    await store.repos.painFlags.save(f, null);
    expect((await store.repos.painFlags.listActive(OWNER)).map((x) => x.id)).toEqual([f.id]);
    await store.repos.painFlags.save(clearPainFlag(f, at(5)), 1);
    expect(await store.repos.painFlags.listActive(OWNER)).toEqual([]);
    expect((await store.repos.painFlags.listByOwner(OWNER)).map((x) => x.status)).toEqual(['cleared']);
  });
});
