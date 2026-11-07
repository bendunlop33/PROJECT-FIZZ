import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import type { HealthPort } from '@fizz/providers';

import { healthScreenView, healthTrendViews } from '../src/health/health-view';
import type { AppServices } from '../src/services/app-services';
import { FakeHealth, OWN, upper } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Apple Health end to end over real SQLite and a fake HealthKit (Ben, 27 Oct; ADR 0035; apple-health.md §9):
 * hidden when the install has no HealthKit, a finished workout written once (a retry adopts it), a move rewrites
 * it, a delete deletes it, our own write never comes back as an activity, a Garmin run lands in the week, a Garmin
 * strength workout during a workout links to it, Unlink shows it again, bodyweight from Health, and switches off.
 */

const DAY = 86_400_000;

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  // Tuesday 27 Oct 2026, 18:00 in London.
  h = createHarness('2026-10-27T18:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

async function launch(port: HealthPort | null = fake, buildIncludesHealth = true): Promise<AppServices> {
  const { services } = await h.launch({ health: { port, buildIncludesHealth } });
  return services;
}

describe('hidden when this install has no HealthKit (ADR 0004)', () => {
  it.each([
    ['no module in the build', null, true],
    ['built without the entitlement', 'fake', false],
    ['SideStore stripped the entitlement', 'missing', true],
  ] as const)('%s: `Not available on this install`, no switches; logging works', async (_name, port, inBuild) => {
    if (port === 'missing') fake.status = 'missing_entitlement';
    const s = await launch(port === null ? null : fake, inBuild);
    const gymId = await setUpGym(h, s);
    const v = await s.health.screen(true);
    expect(v).toMatchObject({ available: false, line: 'Not available on this install', save: [], read: [] });
    expect(await s.health.setSwitch('writeWorkouts', true)).toEqual({ ok: false, message: 'Not available on this install' });
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    await s.health.syncWrites();
    expect(fake.saves).toBe(0);
    expect(await s.health.forWorkout(id)).toEqual({ kind: 'none' });
  });

  it('Profile’s line before anything is on is `Off`', async () => {
    const s = await launch();
    await setUpGym(h, s);
    expect((await s.health.screen(true)).line).toBe('Off');
  });
});

describe('writing workouts', () => {
  it('asks iOS only for its type; writes a finished workout once; a move rewrites it; a delete deletes it; a restore writes it back', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    // History from before writing was turned on stays out.
    const old = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    h.clockMs += 60_000;
    expect(await s.health.setSwitch('writeWorkouts', true)).toEqual({ ok: true });
    expect(fake.asked).toEqual([{ share: ['workout'], read: [] }]);
    h.clockMs += DAY;
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 82.5, reps: 8 }] }]);
    await s.health.syncWrites();
    await s.health.syncWrites();
    expect(fake.saves).toBe(1);
    const [written] = fake.ownWorkouts();
    expect(written).toMatchObject({ activityType: 50, externalId: id });
    expect(fake.ownWorkouts().some((w) => w.externalId === old)).toBe(false);

    // Moved back a day: one copy, at the new times.
    const before = (await s.workout.load(id))?.aggregate;
    if (before === undefined) throw new Error('load');
    const start = toMs(before.session.startedAt.utc);
    const moved = await s.workout.dispatch(id, { type: 'update_session_timing', at: h.now(), opId: 'move-1', expectedVersion: before.session.version, startedAt: { utc: toIso(start - DAY), tz: 'Europe/London' }, endedAt: null, shift: true });
    if (!moved.ok) throw new Error(moved.error.message);
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(1);
    expect(fake.ownWorkouts()[0]?.startMs).toBe(start - DAY);

    // Deleted: gone from Health. Restored: written again (one copy).
    const del = await s.history.deleteWorkouts([{ sessionId: id, expectedVersion: moved.aggregate.session.version }], 'del-1');
    expect(del.ok).toBe(true);
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(0);
    const after = (await s.workout.load(id))?.aggregate;
    const restored = await s.history.restoreWorkouts([{ sessionId: id, expectedVersion: after?.session.version ?? 0 }], 'restore-1');
    expect(restored.ok).toBe(true);
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(1);
  });

  it('a force-close between Health’s save and the app’s record writes nothing twice (the retry adopts it)', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await s.health.setSwitch('writeWorkouts', true);
    h.clockMs += 60_000;
    // Pause the watcher's writes: log the workout, then put in Health what the killed run had saved.
    fake.failSaves = true;
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    await s.health.syncWrites();
    fake.failSaves = false;
    const a = (await s.workout.load(id))?.aggregate;
    if (a === undefined) throw new Error('load');
    const uuid = upper(900);
    fake.workouts.set(uuid, { uuid, activityType: 50, startMs: toMs(a.session.startedAt.utc), endMs: toMs(a.session.endedAt?.utc ?? ''), durationS: 60, distanceM: null, avgHeartRate: null, maxHeartRate: null, sourceName: 'GymSmarter', sourceBundleId: OWN, externalId: id, timeZone: null, syncIdentifier: `gymsmarter-session:${id}`, syncVersion: 1 });
    await s.health.syncWrites();
    await s.health.syncWrites();
    expect(fake.saves).toBe(0);
    expect(fake.ownWorkouts().map((w) => w.uuid)).toEqual([uuid]);
    // Recorded: a later move replaces that very sample.
    const moved = await s.workout.dispatch(id, { type: 'update_session_timing', at: h.now(), opId: 'mv', expectedVersion: a.session.version, startedAt: { utc: toIso(toMs(a.session.startedAt.utc) - 3_600_000), tz: 'Europe/London' }, endedAt: null, shift: true });
    expect(moved.ok).toBe(true);
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(1);
    expect(fake.ownWorkouts()[0]?.uuid).not.toBe(uuid);
  });

  it('a failed write is counted and retried on the next sync', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await s.health.setSwitch('writeWorkouts', true);
    h.clockMs += 60_000;
    fake.failSaves = true;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    await s.health.syncWrites();
    expect((await s.health.screen()).save[0]).toMatchObject({ detail: '1 not saved to Health', retry: true });
    fake.failSaves = false;
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(1);
    expect((await s.health.screen()).save[0]?.detail).toBeNull();
  });

  it('`Remove GymSmarter workouts from Health` removes only ours, and they aren’t written again', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await s.health.setSwitch('writeWorkouts', true);
    h.clockMs += 60_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    await s.health.syncWrites();
    const garmin = fake.addGarmin({ activityType: 37, startMs: h.clockMs - 5 * DAY, endMs: h.clockMs - 5 * DAY + 3_600_000 });
    expect(await s.health.removeAllOwn()).toEqual({ ok: true, count: 1 });
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(0);
    expect(fake.workouts.has(garmin.toUpperCase())).toBe(true);
  });
});

describe('reading activities and linking', () => {
  it('a Garmin run lands in the week, labelled; our own write never comes back; a Garmin strength workout during a workout links to it; Unlink shows it again', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await s.health.setSwitch('writeWorkouts', true);
    h.clockMs += 60_000;
    const sessionStart = h.clockMs;
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] }]);
    await s.health.syncWrites();
    const end = h.clockMs;
    // Garmin recorded the same session (strength) and, yesterday, a 16 km run.
    const strength = fake.addGarmin({ activityType: 50, startMs: sessionStart - 60_000, endMs: end + 60_000 });
    const run = fake.addGarmin({ activityType: 37, startMs: sessionStart - DAY, endMs: sessionStart - DAY + 90 * 60_000, distanceM: 16_000 });
    expect(await s.health.setSwitch('readActivities', true)).toEqual({ ok: true });
    await s.health.readNow();
    const today = toIso(h.clockMs).slice(0, 10);
    const list = await s.activities.between('2026-10-20', '2026-11-03');
    expect(list.map((a) => [a.id, a.source, a.fields.kind])).toEqual([[run, 'health', 'run']]);
    const rows = await s.activities.recent();
    expect(rows.find((r) => r.activityId === run)).toMatchObject({ title: 'Run', fromHealth: 'Garmin' });
    expect(today).toBe('2026-10-27');

    // Q1: the watch's workout is Health's record now; the app's own copy goes.
    expect(fake.ownWorkouts()).toHaveLength(1);
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(0);
    // History and Recent: the run with its source; the linked Garmin strength once, as the workout, with its mark.
    const feed = await s.history.feed();
    const workoutItem = feed.items.find((i) => i.kind === 'workout' && i.sessionId === id);
    expect(workoutItem).toMatchObject({ linkedSource: 'Garmin' });
    expect(feed.items.flatMap((i) => (i.kind === 'activity' ? [[i.key, i.fromHealth]] : []))).toEqual([[`a:${run}`, 'Garmin']]);
    // The coach sees the linked workout's recorded data (Q4): HR only while its switch is on.
    expect(await s.health.coachLinked(id)).toMatchObject({ source: 'Garmin', type: 'Strength', avgHeartRate: null, maxHeartRate: null });
    await s.health.setSwitch('readHeartRate', true);
    await s.health.readNow();
    expect(await s.health.coachLinked(id)).toMatchObject({ avgHeartRate: 128, maxHeartRate: 161 });
    // The linked activity shows on the workout, not as its own item.
    const linked = await s.health.forWorkout(id);
    expect(linked).toMatchObject({ kind: 'linked', healthUuid: strength, line: expect.stringContaining('Garmin') as unknown });
    if (linked.kind !== 'linked') throw new Error('not linked');
    const un = await s.health.unlink({ healthUuid: strength, expectedVersion: linked.linkVersion, opId: 'unlink-1' });
    expect(un.ok).toBe(true);
    expect((await s.activities.between('2026-10-20', '2026-11-03')).map((a) => a.id).sort()).toEqual([run, strength].sort());
    // History offers the one-tap Link chip on the freed strength workout.
    const freed = (await s.history.feed()).items.find((i) => i.kind === 'activity' && i.activityId === strength);
    expect(freed?.kind === 'activity' ? freed.linkTo?.sessionId : null).toBe(id);
    // Unlinked: both as they were, the app's copy written back.
    await s.health.syncWrites();
    expect(fake.ownWorkouts()).toHaveLength(1);
    // Never auto-linked again after a new read; the Summary offers it as a one-tap Link; ⋯ lists it too.
    await s.health.readNow();
    expect((await s.health.forWorkout(id)).kind).toBe('none');
    expect((await s.health.linkChoices(id)).map((c) => c.healthUuid)).toEqual([strength]);
    // Ben links it by hand from the activity's sheet.
    const sheet = await s.health.activity(strength);
    expect(sheet?.pair.map((w) => w.sessionId)).toContain(id);
    expect((await s.health.link({ healthUuid: strength, sessionId: id, opId: 'link-1' })).ok).toBe(true);
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    // The Health activity is read-only.
    const a = await s.activities.get(run);
    expect(a?.source).toBe('health');
    expect((await s.activities.remove({ activityId: run, expectedVersion: 1, opId: 'rm' })).ok).toBe(false);
  });

  it('times off by an hour still auto-link (one each that day); `Use watch times` moves the workout with Undo, never silently', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs += 60_000;
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    const before = (await s.workout.load(id))?.aggregate;
    if (before === undefined) throw new Error('load');
    // The watch was started an hour before the app's log and stopped 50 min later.
    const wStart = toMs(before.session.startedAt.utc) - 3_600_000;
    const uuid = fake.addGarmin({ activityType: 50, startMs: wStart, endMs: wStart + 50 * 60_000 });
    h.clockMs += 60 * 60_000;
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    const v = await s.health.forWorkout(id);
    expect(v).toMatchObject({ kind: 'linked', healthUuid: uuid, useWatchTimes: true });
    // Nothing moved until Ben taps.
    expect((await s.workout.load(id))?.aggregate.session.startedAt.utc).toBe(before.session.startedAt.utc);
    const r = await s.health.useWatchTimes(id, 'watch-times-1');
    if (!r.ok) throw new Error(r.message);
    const moved = (await s.workout.load(id))?.aggregate.session;
    expect(moved?.startedAt.utc).toBe(toIso(wStart));
    expect(moved?.endedAt?.utc).toBe(toIso(wStart + 50 * 60_000));
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', useWatchTimes: false });
    expect((await r.undo()).ok).toBe(true);
    expect((await s.workout.load(id))?.aggregate.session.startedAt.utc).toBe(before.session.startedAt.utc);
  });

  it('two gym sessions the same day: nothing automatic; one tap links the chosen one; `Not it` is never offered again', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs += 60_000;
    const am = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    const amEnd = h.clockMs;
    h.clockMs += 4 * 3_600_000;
    const pm = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    const uuid = fake.addGarmin({ activityType: 50, startMs: amEnd - 10 * 60_000, endMs: amEnd + 20 * 60_000 });
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    expect(await s.health.forWorkout(am)).toMatchObject({ kind: 'question', candidates: [{ healthUuid: uuid }] });
    expect(await s.health.forWorkout(pm)).toMatchObject({ kind: 'question', candidates: [{ healthUuid: uuid }] });
    expect((await s.health.notIt({ healthUuid: uuid, sessionId: pm, opId: 'not-it' })).ok).toBe(true);
    expect(await s.health.forWorkout(pm)).toEqual({ kind: 'none' });
    // Still linkable by hand from ⋯ (the record only stops offers).
    expect((await s.health.linkChoices(am)).map((c) => c.healthUuid)).toEqual([uuid]);
    expect((await s.health.link({ healthUuid: uuid, sessionId: am, opId: 'link-am' })).ok).toBe(true);
    expect(await s.health.forWorkout(am)).toMatchObject({ kind: 'linked', healthUuid: uuid });
  });

  it('turning reads off forgets what was read', async () => {
    const s = await launch();
    await setUpGym(h, s);
    fake.addGarmin({ activityType: 37, startMs: h.clockMs - DAY, endMs: h.clockMs - DAY + 1_800_000, distanceM: 5000 });
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    expect(await s.activities.between('2026-10-20', '2026-11-03')).toHaveLength(1);
    await s.health.setSwitch('readActivities', false);
    expect(await s.activities.between('2026-10-20', '2026-11-03')).toHaveLength(0);
  });
});

describe('bodyweight', () => {
  it('Health’s bodyweight shows in Training details and the coach input, labelled; never written back', async () => {
    const s = await launch();
    await setUpGym(h, s);
    fake.weights = [{ uuid: 'B0000000-0000-4000-8000-000000000001', kg: 81.6, atMs: h.clockMs - DAY, sourceName: 'Withings', sourceBundleId: 'com.withings' }];
    await s.health.setSwitch('readWeight', true);
    await s.health.readNow();
    const snap = await s.training.snapshot();
    expect(snap?.healthWeights.map((w) => w.kg)).toEqual([81.6]);
    const input = await s.training.coachInput();
    expect(input?.healthWeights).toHaveLength(1);
    expect(fake.asked.at(-1)).toEqual({ share: [], read: ['bodyMass'] });
    expect(fake.saves).toBe(0);
  });
});

describe('resting heart rate and sleep (Q8) and how far back (Q6)', () => {
  it('raw values with their source, for Progress and the coach; the window is one control', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const day = (n: number) => h.clockMs - n * DAY;
    fake.resting = [0, 1, 2].map((n) => ({ uuid: `C000000${String(n)}-0000-4000-8000-000000000000`, bpm: 50 + n, atMs: day(n) - 6 * 3_600_000, sourceName: 'Garmin Connect', sourceBundleId: 'g' }));
    fake.sleep = [1, 2].map((n) => ({ uuid: `D000000${String(n)}-0000-4000-8000-000000000000`, value: 3, startMs: day(n) - 12 * 3_600_000, endMs: day(n) - 5 * 3_600_000, sourceName: 'Apple Watch', sourceBundleId: 'w' }));
    expect((await s.health.setSwitch('readRestingHeartRate', true)).ok).toBe(true);
    expect((await s.health.setSwitch('readSleep', true)).ok).toBe(true);
    expect(fake.asked.map((a) => a.read)).toEqual([['restingHeartRate'], ['sleepAnalysis']]);
    await s.health.readNow();
    const sig = await s.health.signals();
    expect(sig.restingHeartRate.map((d) => d.value)).toEqual([52, 51, 50]);
    expect(sig.sleep.map((d) => d.value)).toEqual([420, 420]);
    const trends = healthTrendViews(sig, 'en-GB');
    expect(trends.map((t) => [t.title, t.source])).toEqual([
      ['Resting heart rate', 'Garmin · Apple Health'],
      ['Sleep', 'Apple Watch · Apple Health'],
    ]);
    const input = await s.training.coachInput();
    expect(input?.healthSignals?.restingHeartRate).toHaveLength(3);
    expect(await s.health.setReadWindow('4w')).toEqual({ ok: true });
    expect((await s.health.screen()).window.value).toBe('4w');
    await s.health.setSwitch('readSleep', false);
    expect((await s.health.signals()).sleep).toEqual([]);
  });
});

describe('the settings view', () => {
  it('states from apple-health.md §4', () => {
    const base = { settings: { writeWorkouts: true, writeSinceUtc: '2026-10-27T10:00:00.000Z', readWeight: false, readActivities: true, readHeartRate: false, readRestingHeartRate: false, readSleep: false, readWindow: '8w' as const, lastReadUtc: '2026-10-27T06:42:00.000Z', lastReadFailedUtc: null, version: 3 }, shareStatus: 'authorized' as const, notSaved: 0, readCounts: { workouts: 0, weights: 0 }, sources: [], reading: false, newOnLastRead: 3, written: 2, nowMs: toMs('2026-10-27T08:00:00.000Z'), tz: 'Europe/London', locale: 'en-GB' };
    const v = healthScreenView({ ...base, capability: 'available' });
    expect(v.line).toBe('On · last read 06:42');
    expect(v.lastRead).toBe('Last read 06:42 · 3 new');
    expect(v.read.find((r) => r.key === 'readActivities')?.detail).toBe('Nothing from Health yet');
    expect(healthScreenView({ ...base, capability: 'available', shareStatus: 'denied' }).save[0]).toMatchObject({ detail: 'Off in Health', retry: false });
    expect(healthScreenView({ ...base, capability: 'available', reading: true }).line).toBe('Reading…');
    expect(healthScreenView({ ...base, capability: 'available', settings: { ...base.settings, lastReadFailedUtc: '2026-10-27T07:50:00.000Z' } }).line).toBe('Last read failed · 07:50');
    expect(healthScreenView({ ...base, capability: 'not_on_this_install' })).toMatchObject({ available: false, why: 'This install’s signing doesn’t include Health.' });
  });
});

describe('Health uses (Ben, 27 Oct; gym first)', () => {
  it('Progress › Training: last night’s sleep and this morning’s RHR vs its 28-day median; nothing with Health off', async () => {
    const s = await launch();
    await setUpGym(h, s);
    // 28 mornings at 54, today (27 Oct) at 58; one night 22:40 → 04:50 (crossing midnight) ending this morning.
    fake.resting = Array.from({ length: 29 }, (_, i) => ({ uuid: `C${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`, bpm: i === 0 ? 58 : 54, atMs: Date.parse('2026-10-27T07:00:00.000Z') - i * DAY, sourceName: 'Garmin Connect', sourceBundleId: 'g' }));
    fake.sleep = [
      { uuid: 'D0000001-0000-4000-8000-000000000000', value: 3, startMs: Date.parse('2026-10-26T22:40:00.000Z'), endMs: Date.parse('2026-10-26T23:59:00.000Z'), sourceName: 'Garmin Connect', sourceBundleId: 'g' },
      { uuid: 'D0000002-0000-4000-8000-000000000000', value: 4, startMs: Date.parse('2026-10-27T00:00:00.000Z'), endMs: Date.parse('2026-10-27T04:51:00.000Z'), sourceName: 'Garmin Connect', sourceBundleId: 'g' },
    ];
    expect((await s.health.lastNight()).line).toBeNull();
    await s.health.setSwitch('readRestingHeartRate', true);
    await s.health.setSwitch('readSleep', true);
    await s.health.readNow();
    const r = await s.health.lastNight();
    expect(r.line?.text.replaceAll(' ', ' ')).toBe('Sleep 6h 10m · RHR 58 ↑4');
    expect(r.line?.sources).toEqual(['Garmin']);
    await s.health.setSwitch('readRestingHeartRate', false);
    await s.health.setSwitch('readSleep', false);
    expect((await s.health.lastNight()).line).toBeNull();
  });

  it('the week card and the weekly review count every other activity once, Ben’s and Garmin’s, after lifting', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    // A Garmin walk and a Garmin rowing session this week (Mon 26 Oct), and a strength workout linked to nothing.
    fake.addGarmin({ activityType: 52, startMs: Date.parse('2026-10-26T08:00:00.000Z'), endMs: Date.parse('2026-10-26T08:45:00.000Z') });
    fake.addGarmin({ activityType: 35, startMs: Date.parse('2026-10-26T12:00:00.000Z'), endMs: Date.parse('2026-10-26T12:20:00.000Z') });
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    const week = (await s.reviews.progress())?.week;
    expect(week?.activities?.all.map((t) => t.replaceAll(' ', ' '))).toEqual(['1 walk 45 min', '1 cardio 20 min']);
    expect(week?.activities?.fromHealth).toBe(true);
    expect(week?.health).toBeNull();
  });
});

describe('bodyweight card (Ben, 27 Oct)', () => {
  it('＋ Weight, edit and delete, each with Undo; a double tap writes once; a stale card is refused; Health merges in, his entry wins', async () => {
    const s = await launch();
    await setUpGym(h, s);
    let card = await s.bodyweight.card('3m');
    expect(card?.view.empty).toBe(true);
    const v1 = card?.version ?? 1;
    expect(await s.bodyweight.log({ value: 82.4, unit: 'kg', date: '2026-10-27', opId: 'tap-1', expectedVersion: v1 })).toEqual({ ok: true });
    // The same tap again (a double tap or a retry): one entry.
    expect(await s.bodyweight.log({ value: 82.4, unit: 'kg', date: '2026-10-27', opId: 'tap-1', expectedVersion: v1 })).toEqual({ ok: true });
    card = await s.bodyweight.card('3m');
    expect(card?.mine).toHaveLength(1);
    // A second sheet still on the old version is refused.
    expect(await s.bodyweight.log({ value: 90, unit: 'kg', date: '2026-10-26', opId: 'tap-2', expectedVersion: v1 })).toEqual({ ok: false, message: 'Changed since. Try again.' });
    // The latest entry is what the coach reads.
    expect((await s.training.coachInput())?.profile?.weights.at(-1)?.value).toBe(82.4);

    // Edit to lb, then Undo it (the same change back, on the newer version).
    const v2 = card?.version ?? 0;
    expect(await s.bodyweight.edit({ entryId: 'tap-1', value: 181, unit: 'lb', date: '2026-10-27', opId: 'e1', expectedVersion: v2 })).toEqual({ ok: true });
    card = await s.bodyweight.card('3m');
    expect(card?.view.latest?.replaceAll(' ', ' ')).toBe('82.1 kg · 27 Oct');
    expect(await s.bodyweight.edit({ entryId: 'tap-1', value: 82.4, unit: 'kg', date: '2026-10-27', opId: 'e2', expectedVersion: card?.version ?? 0 })).toEqual({ ok: true });

    // Health's reading on the same day doesn't replace his; another day's does show.
    fake.weights = [
      { uuid: 'B0000000-0000-4000-8000-000000000001', kg: 83.5, atMs: Date.parse('2026-10-27T06:00:00.000Z'), sourceName: 'Withings', sourceBundleId: 'com.withings' },
      { uuid: 'B0000000-0000-4000-8000-000000000002', kg: 83, atMs: Date.parse('2026-10-20T06:00:00.000Z'), sourceName: 'Withings', sourceBundleId: 'com.withings' },
    ];
    await s.health.setSwitch('readWeight', true);
    await s.health.readNow();
    card = await s.bodyweight.card('1m');
    expect(card?.view.points.map((p) => [p.date, p.value, p.from])).toEqual([
      ['2026-10-20', 83, 'health'],
      ['2026-10-27', 82.4, 'you'],
    ]);
    expect(card?.view.source).toBe('Withings · Apple Health');
    expect(card?.view.change?.replaceAll(' ', ' ')).toBe('−0.6 kg');

    // Delete, then Undo: the same entry back.
    const entry = card?.mine[0];
    if (entry === undefined || card === null) throw new Error('no entry');
    expect(await s.bodyweight.remove({ entryId: entry.id, opId: 'd1', expectedVersion: card.version })).toEqual({ ok: true });
    const after = await s.bodyweight.card('1m');
    expect(after?.mine).toEqual([]);
    expect(await s.bodyweight.restore({ entry, opId: 'u1', expectedVersion: after?.version ?? 0 })).toEqual({ ok: true });
    expect((await s.bodyweight.card('1m'))?.mine.map((w) => w.id)).toEqual(['tap-1']);
  });

  it('a lb owner logs in lb; the card shows lb', async () => {
    const s = await launch();
    await s.setup.saveUnits('lb');
    const card = await s.bodyweight.card('all');
    expect(await s.bodyweight.log({ value: 181.5, unit: 'lb', date: '2026-10-25', opId: 'lb-1', expectedVersion: card?.version ?? 1 })).toEqual({ ok: true });
    expect((await s.bodyweight.card('all'))?.view.latest?.replaceAll(' ', ' ')).toBe('181.5 lb · 25 Oct');
  });
});
