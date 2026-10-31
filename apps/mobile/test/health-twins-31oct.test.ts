import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct, build 493: Wed's `Strength · 50 min · Garmin` showed apart from his paired workout, with no Pair;
 * Tue's too: "These should link".) Real SQLite and a fake HealthKit, synthetic data of the same shape:
 * - a linked Garmin workout and Garmin's second copy of it (or a watch's twin): one item everywhere, recorded in the link;
 * - a second strength session that day that doesn't overlap: apart, with `Same workout` (no free workout) from the
 *   day sheet and the activity's sheet; its Undo;
 * - an automatic link to a workout that turns out to be the app's own copy (another install's bundle) or is gone from
 *   Health: moved to the real Garmin workout on the next read, versioned; Unpair still works.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  h = createHarness('2026-10-28T18:04:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

const MIN = 60_000;
const WED = '2026-10-28';

async function wednesday(): Promise<{ s: AppServices; id: string; startMs: number; endMs: number }> {
  const { services: s } = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
  const gymId = await setUpGym(h, s);
  h.clockMs = Date.parse('2026-10-28T18:04:00.000Z');
  const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: Array.from({ length: 6 }, () => ({ load: 60, reps: 8 })) }]);
  const a = (await s.workout.load(id))?.aggregate;
  if (a?.session.endedAt == null) throw new Error('not finished');
  return { s, id, startMs: Date.parse(a.session.startedAt.utc), endMs: Date.parse(a.session.endedAt.utc) };
}

async function read(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.readNow();
}

/** Health strength items shown for Wed (Today, the week, Progress and History all read `activities.between`). */
const wedHealth = async (s: AppServices) => (await s.activities.between(WED, '2026-10-29')).filter((a) => a.source === 'health').map((a) => a.id);

describe('one session recorded twice is one item (Ben, 31 Oct)', () => {
  it('a linked Garmin workout and Garmin’s duplicate: shown once; the duplicate is recorded in the link; a re-read changes nothing', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    const g = fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    await read(s);
    const linked = await s.health.forWorkout(id);
    expect(linked).toMatchObject({ kind: 'linked', healthUuid: g, line: expect.stringContaining('Paired with Garmin') as unknown });
    // Garmin writes it again later.
    h.clockMs += 60 * MIN;
    const dup = fake.addGarmin({ activityType: 50, startMs: startMs - 2 * MIN, endMs: endMs + 2 * MIN, sourceName: 'Connect' });
    await read(s);
    expect(await wedHealth(s)).toEqual([]);
    const pairs = await s.health.dayPairs(WED);
    expect(pairs.unpaired).toEqual({});
    expect(Object.values(pairs.paired).map((p) => p.healthUuid)).toEqual([g]);
    // Recorded as part of the link (versioned); reading again writes nothing more.
    const after = await s.health.forWorkout(id);
    if (after.kind !== 'linked') throw new Error('not linked');
    expect(after.linkVersion).toBe(2);
    await read(s);
    const again = await s.health.forWorkout(id);
    expect(again.kind === 'linked' ? again.linkVersion : null).toBe(2);
    // Its own sheet says it is the paired workout's (no Pair across).
    expect((await s.health.activity(dup))?.paired ?? (await s.health.activity(dup))?.same).toBeTruthy();
  });

  it('a duplicate from another source (a watch’s twin): shown once too', async () => {
    const { s, startMs, endMs } = await wednesday();
    fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    await read(s);
    fake.addGarmin({ activityType: 50, startMs: startMs + MIN, endMs: endMs, sourceName: 'Apple Watch', sourceBundleId: 'com.apple.health.watch', avgHeartRate: null });
    await read(s);
    expect(await wedHealth(s)).toEqual([]);
    expect((await s.health.dayPairs(WED)).unpaired).toEqual({});
  });

  it('two copies before the first read: one auto-link, not none', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    fake.addGarmin({ activityType: 50, startMs: startMs - 2 * MIN, endMs: endMs + 2 * MIN, sourceName: 'Connect' });
    await read(s);
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    expect(await wedHealth(s)).toEqual([]);
  });

  it('a second session that day that doesn’t overlap: apart, Same workout from its sheet joins the link; Undo splits it again', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    const g = fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    await read(s);
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    // Later that evening, another Garmin strength session.
    const evening = fake.addGarmin({ activityType: 50, startMs: endMs + 120 * MIN, endMs: endMs + 160 * MIN, sourceName: 'Connect' });
    h.clockMs = endMs + 200 * MIN;
    await read(s);
    expect(await wedHealth(s)).toEqual([evening]);
    expect((await s.health.dayPairs(WED)).same?.[evening]?.map((x) => [x.sessionId, x.linkUuid])).toEqual([[id, g]]);
    const sheet = await s.health.activity(evening);
    expect(sheet).toMatchObject({ pair: [], paired: null });
    const [same] = sheet?.same ?? [];
    if (same === undefined) throw new Error('no Same workout');
    const r = await s.health.sameWorkout({ healthUuid: evening, linkUuid: same.linkUuid, expectedVersion: same.linkVersion, opId: 'same-1' });
    if (!r.ok) throw new Error(r.message);
    expect(await wedHealth(s)).toEqual([]);
    // The same op again: nothing more (rule 5); a stale Undo is refused.
    expect(await s.health.sameWorkout({ healthUuid: evening, linkUuid: same.linkUuid, expectedVersion: same.linkVersion, opId: 'same-1' })).toMatchObject({ ok: true, version: r.version });
    expect((await s.health.notSameWorkout({ healthUuid: evening, linkUuid: same.linkUuid, expectedVersion: r.version - 1, opId: 'undo-stale' })).ok).toBe(false);
    expect((await s.health.notSameWorkout({ healthUuid: evening, linkUuid: same.linkUuid, expectedVersion: r.version, opId: 'undo-1' })).ok).toBe(true);
    expect(await wedHealth(s)).toEqual([evening]);
    // A relaunch reads the same.
    await h.forceClose();
    const { services: s2 } = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
    expect(await wedHealth(s2)).toEqual([evening]);
  });
});

describe('an automatic link to the wrong Health workout moves to the real one (Ben, 31 Oct)', () => {
  it('linked to a copy that turns out to be the app’s own (another install’s bundle): the Garmin workout links; Unpair works', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    // First read: only the copy, from a source not recognised then; it auto-links.
    const copy = fake.addGarmin({ activityType: 50, startMs, endMs, sourceName: 'GymSmarter', sourceBundleId: 'com.example.unknown', avgHeartRate: null });
    await read(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: copy });
    // It is another install's copy (a SideStore suffix); the Garmin workout arrives.
    const native = fake.workouts.get(copy.toUpperCase());
    if (native === undefined) throw new Error('no copy');
    fake.workouts.set(copy.toUpperCase(), { ...native, sourceBundleId: 'com.projectfizz.fizz.ABCDE12345' });
    const g = fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    h.clockMs += 60 * MIN;
    await read(s);
    const now = await s.health.forWorkout(id);
    expect(now).toMatchObject({ kind: 'linked', healthUuid: g });
    expect(await wedHealth(s)).toEqual([]);
    if (now.kind !== 'linked') throw new Error('not linked');
    expect((await s.health.unlink({ healthUuid: g, expectedVersion: now.linkVersion, opId: 'unpair-1' })).ok).toBe(true);
    expect(await wedHealth(s)).toEqual([g]);
    // Unpaired by Ben: never auto-linked again; Pair is offered from its sheet.
    await read(s);
    expect((await s.health.forWorkout(id)).kind).not.toBe('linked');
    expect((await s.health.activity(g))?.pair.map((w) => w.sessionId)).toEqual([id]);
  });

  it('linked to a watch workout since deleted from Health: the overlapping Garmin workout links', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    const watch = fake.addGarmin({ activityType: 50, startMs, endMs, sourceName: 'Apple Watch', sourceBundleId: 'com.apple.health.watch' });
    await read(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: watch });
    fake.workouts.delete(watch.toUpperCase());
    const g = fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    h.clockMs += 60 * MIN;
    await read(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: g });
    expect(await wedHealth(s)).toEqual([]);
  });

  it('a real third-party link is kept: the overlapping one is its duplicate', async () => {
    const { s, id, startMs, endMs } = await wednesday();
    const watch = fake.addGarmin({ activityType: 50, startMs, endMs, sourceName: 'Apple Watch', sourceBundleId: 'com.apple.health.watch' });
    await read(s);
    fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN, sourceName: 'Connect' });
    h.clockMs += 60 * MIN;
    await read(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: watch });
    expect(await wedHealth(s)).toEqual([]);
  });
});
