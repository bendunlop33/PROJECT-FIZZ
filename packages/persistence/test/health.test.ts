import { afterEach, describe, expect, it } from 'vitest';
import { addActivity, dismissHealthLink, healthWorkoutOf, healthWriteRecordAfter, linkHealthActivity, planHealthWrites, unlinkHealthActivity } from '@fizz/domain';
import { at, OWNER, profile, richFinishedSession, TZ } from '@fizz/domain/testing';
import { DEFAULT_HEALTH_SETTINGS, type HealthWeightSample, type HealthWorkoutSample } from '@fizz/schemas';

import { createBackup, DatabaseManager, exportDomain, openStore, type Store } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * (Ben, 27 Oct; ADR 0035) Apple Health on SQLite: what was read is local (not backed up, gone with Delete my data),
 * what was written and Ben's links are backed up; activities read from Health list with his and dedupe; writes and
 * links are versioned and idempotent.
 */

const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const WEIGHT_UUID = 'b0000000-0000-4000-8000-000000000001';

const run = (p: Partial<HealthWorkoutSample> = {}): HealthWorkoutSample => ({
  uuid: U1,
  activityType: 37,
  startUtc: '2026-10-07T07:00:00.000Z',
  endUtc: '2026-10-07T08:40:00.000Z',
  tz: TZ,
  durationS: 6000,
  distanceM: 18_000,
  avgHeartRate: null,
  maxHeartRate: null,
  sourceName: 'Garmin Connect',
  sourceBundleId: 'com.garmin.connect.mobile',
  externalId: null,
  ...p,
});
const weight: HealthWeightSample = { uuid: WEIGHT_UUID, kg: 81.6, atUtc: '2026-10-07T06:00:00.000Z', tz: TZ, sourceName: 'Withings', sourceBundleId: 'com.withings' };

async function seeded(): Promise<Store> {
  const store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  return store;
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

describe('Health samples and activities', () => {
  it('a read replaces its window; activities list with Ben’s; own writes and linked ones never show', async () => {
    const store = await seeded();
    const h = store.repos.health;
    expect(await h.replaceSamples(OWNER, 'workout', '2026-10-01T00:00:00.000Z', [run(), run({ uuid: U2, activityType: 50, startUtc: '2026-10-08T07:00:00.000Z', endUtc: '2026-10-08T08:00:00.000Z', durationS: 3600, distanceM: null })])).toBe(2);
    let list = await store.repos.activities.listBetween(OWNER, '2026-10-06', '2026-10-10');
    expect(list.map((a) => [a.id, a.source, a.fields.kind, a.fields.date])).toEqual([
      [U1, 'health', 'run', '2026-10-07'],
      [U2, 'health', 'other', '2026-10-08'],
    ]);
    // A link hides the strength one (it shows on its workout).
    const sid = richFinishedSession().session.id;
    const linked = await h.changeLink(OWNER, U2, (cur) => linkHealthActivity(cur, { ownerId: OWNER, healthUuid: U2, sessionId: sid, by: 'auto', opId: 'auto-1', atUtc: at(0).utc, expectedVersion: null, sessionLinkedElsewhere: false }));
    expect(linked.status).toBe('written');
    list = await store.repos.activities.listBetween(OWNER, '2026-10-06', '2026-10-10');
    expect(list.map((a) => a.id)).toEqual([U1]);
    // Ben's planned run that day pairs with Health's: one item, done.
    const mine = addActivity({ id: '20000000-0000-4000-8000-000000000001', ownerId: OWNER, opId: 'add-1', at: at(0), source: 'ben', fields: { kind: 'run', status: 'planned', date: '2026-10-07', durationS: null, distanceM: null, effort: 'long' } });
    expect((await store.repos.activities.add(OWNER, mine)).status).toBe('written');
    list = await store.repos.activities.listBetween(OWNER, '2026-10-06', '2026-10-10');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: 'ben', fields: { status: 'done', distanceM: 18_000, effort: 'long' }, health: { uuid: U1 } });
    // Ben's own list is unchanged.
    expect((await store.repos.activities.listOwnBetween(OWNER, '2026-10-06', '2026-10-10')).map((a) => a.fields.status)).toEqual(['planned']);
    // A newer read without the run (deleted in Health) drops it.
    await h.replaceSamples(OWNER, 'workout', '2026-10-01T00:00:00.000Z', []);
    expect((await store.repos.activities.listBetween(OWNER, '2026-10-06', '2026-10-10')).map((a) => a.source)).toEqual(['ben']);
  });

  it('a Health activity can’t be stored as an activity', async () => {
    const store = await seeded();
    const forged = addActivity({ id: '20000000-0000-4000-8000-000000000002', ownerId: OWNER, opId: 'x', at: at(0), source: 'ben', fields: { kind: 'run', status: 'done', date: '2026-10-07', durationS: 600, distanceM: null, effort: null } });
    if (forged.kind !== 'write') throw new Error('no write');
    expect(await store.repos.activities.add(OWNER, { ...forged, next: { ...forged.next, source: 'health' } })).toEqual({ status: 'invalid', reason: 'Read from Apple Health' });
  });

  it('the app’s own write (external ID = a workout) is never read back', async () => {
    const store = await seeded();
    await store.repos.sessions.save(richFinishedSession(), null);
    const sid = richFinishedSession().session.id;
    await store.repos.health.replaceSamples(OWNER, 'workout', '2026-10-01T00:00:00.000Z', [run({ activityType: 50, sourceBundleId: 'com.other.team', externalId: sid })]);
    expect(await store.repos.activities.listBetween(OWNER, '2026-10-06', '2026-10-10')).toEqual([]);
  });

  it('settings are versioned; a stale write changes nothing', async () => {
    const store = await seeded();
    const h = store.repos.health;
    expect(await h.settings(OWNER)).toEqual(DEFAULT_HEALTH_SETTINGS);
    const on = await h.updateSettings(OWNER, 0, (s) => ({ ...s, readActivities: true }));
    expect(on).toMatchObject({ ok: true, settings: { readActivities: true, version: 1 } });
    expect(await h.updateSettings(OWNER, 0, (s) => ({ ...s, readWeight: true }))).toMatchObject({ ok: false, settings: { readWeight: false, version: 1 } });
  });
});

describe('Health writes', () => {
  it('records a write once, finds changed workouts by revision, and a purged workout as gone', async () => {
    const store = await seeded();
    const h = store.repos.health;
    const s = richFinishedSession();
    await store.repos.sessions.save(s, null);
    const sid = s.session.id;
    const since = '2000-01-01T00:00:00.000Z';
    const rows = await h.writeRows(OWNER, since);
    expect(rows.toCheck.map((r) => r.sessionId)).toEqual([sid]);
    const cand = { sessionId: sid, inHistory: true, source: s.session.source, startedAtUtc: s.session.startedAt.utc, endedAtUtc: s.session.endedAt?.utc ?? null, pauses: [], recordedAtUtc: s.session.endedAt?.utc ?? '', anyExternalLoad: true, anyDoneSet: true };
    const [op] = planHealthWrites({ settings: { writeWorkouts: true, writeSinceUtc: since }, candidates: [cand], records: [] });
    if (op === undefined) throw new Error('no op');
    const rec = healthWriteRecordAfter(null, op, { kind: 'saved', healthUuid: U1 }, OWNER, at(0).utc);
    if (rec === null) throw new Error('no rec');
    const revision = rows.toCheck[0]?.revision ?? 0;
    expect(await h.saveWrite(rec, null, revision)).toBe('written');
    // The same record again (a replay after a crash between Health and here): stale, nothing doubles.
    expect(await h.saveWrite(rec, null, revision)).toBe('stale');
    expect(await h.writeRows(OWNER, since)).toEqual({ toCheck: [], goneSessionIds: [] });
    expect((await h.writes(OWNER)).map((w) => [w.sessionId, w.healthUuid, w.status])).toEqual([[sid, U1, 'written']]);
    expect(healthWorkoutOf(cand)?.fingerprint).toBe(rec.fingerprint);
    // A record whose workout is gone (purged) is listed as gone.
    const gone = '30000000-0000-4000-8000-000000000009';
    expect(await h.saveWrite({ ...rec, sessionId: gone }, null, 1)).toBe('written');
    expect((await h.writeRows(OWNER, since)).goneSessionIds).toEqual([gone]);
  });
});

describe('Health links', () => {
  it('link, unlink, Not it: versioned and idempotent; one linked activity per workout', async () => {
    const store = await seeded();
    const h = store.repos.health;
    const sid = richFinishedSession().session.id;
    const link = (uuid: string, opId: string) => h.changeLink(OWNER, uuid, async (cur, elsewhere) => linkHealthActivity(cur, { ownerId: OWNER, healthUuid: uuid, sessionId: sid, by: 'ben', opId, atUtc: at(0).utc, expectedVersion: cur?.version ?? null, sessionLinkedElsewhere: await elsewhere(sid) }));
    expect((await link(U1, 'l1')).status).toBe('written');
    expect((await link(U1, 'l1')).status).toBe('replayed');
    expect(await link(U2, 'l2')).toEqual({ status: 'invalid', reason: 'That workout already has a linked activity' });
    expect((await h.linkForWorkout(OWNER, sid))?.healthUuid).toBe(U1);
    const un = await h.changeLink(OWNER, U1, (cur) => (cur === null ? { kind: 'invalid', reason: 'none' } : unlinkHealthActivity(cur, { opId: 'u1', atUtc: at(1).utc, expectedVersion: 1 })));
    expect(un).toMatchObject({ status: 'written', link: { status: 'unlinked', version: 2 } });
    // A stale unlink (the screen read version 1) changes nothing.
    expect((await h.changeLink(OWNER, U1, (cur) => (cur === null ? { kind: 'invalid', reason: 'none' } : unlinkHealthActivity(cur, { opId: 'u2', atUtc: at(1).utc, expectedVersion: 1 })))).status).toBe('stale');
    expect(await h.linkForWorkout(OWNER, sid)).toBeNull();
    expect((await link(U2, 'l3')).status).toBe('written');
    const notIt = await h.changeLink(OWNER, U1.toUpperCase(), (cur) => dismissHealthLink(cur, { ownerId: OWNER, healthUuid: U1, sessionId: sid, opId: 'n1', atUtc: at(2).utc }));
    expect(notIt.status).toBe('stale');
  });
});

describe('backup, export and Delete my data', () => {
  it('backups and exports hold writes and links, not what was read or the switches; Delete my data removes all of it', async () => {
    const d = tempDir();
    cleanups.push(d.cleanup);
    let n = 0;
    const m = await DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `t-${String((n += 1))}.db` });
    const store = m.store;
    await store.repos.profiles.save(profile(), null);
    const h = store.repos.health;
    await h.replaceSamples(OWNER, 'workout', '2026-10-01T00:00:00.000Z', [run()]);
    await h.replaceSamples(OWNER, 'weight', '2024-10-01T00:00:00.000Z', [weight]);
    await h.updateSettings(OWNER, 0, (s) => ({ ...s, readActivities: true, readWeight: true }));
    const sid = richFinishedSession().session.id;
    await h.changeLink(OWNER, U2, (cur) => linkHealthActivity(cur, { ownerId: OWNER, healthUuid: U2, sessionId: sid, by: 'ben', opId: 'l1', atUtc: at(0).utc, expectedVersion: null, sessionLinkedElsewhere: false }));
    const backup = await createBackup(store, { at: at(5), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: '1' } });
    const tables = Object.keys((JSON.parse(backup.text) as { tables: Record<string, unknown> }).tables);
    expect(tables).toEqual(expect.arrayContaining(['health_writes', 'health_links']));
    expect(tables).not.toContain('health_samples');
    expect(tables).not.toContain('health_settings');
    const exported = await exportDomain(store.db, 'your_data');
    expect(Object.keys(exported.tables)).toContain('health_links');
    expect(Object.keys(exported.tables)).not.toContain('health_samples');
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    const after = m.store.repos.health;
    expect(await after.weightSamples(OWNER)).toEqual([]);
    expect(await after.workoutSamples(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).toEqual([]);
    expect(await after.links(OWNER)).toEqual([]);
    expect(await after.settings(OWNER)).toEqual(DEFAULT_HEALTH_SETTINGS);
    await m.close();
  });
});
