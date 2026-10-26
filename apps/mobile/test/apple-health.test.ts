import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import type { HealthNativeBodyMass, HealthNativeRestingHr, HealthNativeSleep, HealthNativeWorkout, HealthPort, HealthSaveRequest } from '@fizz/providers';

import { healthScreenView, healthTrendViews } from '../src/health/health-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Apple Health end to end over real SQLite and a fake HealthKit (Ben, 27 Oct; ADR 0035; apple-health.md §9):
 * hidden when the install has no HealthKit, a finished workout written once (a retry adopts it), a move rewrites
 * it, a delete deletes it, our own write never comes back as an activity, a Garmin run lands in the week, a Garmin
 * strength workout during a workout links to it, Unlink shows it again, bodyweight from Health, and switches off.
 */

const OWN = 'com.projectfizz.fizz';
const DAY = 86_400_000;
const upper = (n: number) => `A${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;

class FakeHealth implements HealthPort {
  readonly bundleId = OWN;
  status: 'available' | 'missing_entitlement' | 'unsupported' = 'available';
  workouts = new Map<string, HealthNativeWorkout & { syncIdentifier?: string; syncVersion?: number }>();
  weights: HealthNativeBodyMass[] = [];
  resting: HealthNativeRestingHr[] = [];
  sleep: HealthNativeSleep[] = [];
  asked: { share: string[]; read: string[] }[] = [];
  saves = 0;
  failSaves = false;
  private n = 1;

  capability() {
    return Promise.resolve({ status: this.status, message: this.status === 'missing_entitlement' ? 'Missing com.apple.developer.healthkit entitlement.' : '' });
  }
  requestAuthorization(share: string[], read: string[]) {
    this.asked.push({ share, read });
    return Promise.resolve(this.status === 'missing_entitlement' ? { ok: false, message: 'missing_entitlement' } : { ok: true, message: '' });
  }
  workoutShareStatus() {
    return Promise.resolve('authorized' as const);
  }
  saveWorkout(input: HealthSaveRequest) {
    if (this.failSaves) return Promise.reject(new Error('Health is busy'));
    const existing = [...this.workouts.values()].find((w) => w.syncIdentifier === input.syncIdentifier && w.sourceBundleId === OWN);
    if (existing !== undefined && (existing.syncVersion ?? 0) >= input.syncVersion) return Promise.resolve({ uuid: existing.uuid, adopted: true });
    // Health replaces an older version with the same sync identifier.
    if (existing !== undefined) this.workouts.delete(existing.uuid);
    this.saves += 1;
    const uuid = upper(this.n++);
    this.workouts.set(uuid, {
      uuid,
      activityType: input.activityType,
      startMs: input.startMs,
      endMs: input.endMs,
      durationS: (input.endMs - input.startMs) / 1000 - input.pauses.reduce((s, p) => s + (p.endMs - p.startMs) / 1000, 0),
      distanceM: null,
      avgHeartRate: null,
      maxHeartRate: null,
      sourceName: 'GymSmarter',
      sourceBundleId: OWN,
      externalId: input.externalId,
      timeZone: input.timeZone,
      syncIdentifier: input.syncIdentifier,
      syncVersion: input.syncVersion,
    });
    return Promise.resolve({ uuid, adopted: false });
  }
  deleteWorkout(uuid: string) {
    const w = this.workouts.get(uuid.toUpperCase());
    if (w === undefined || w.sourceBundleId !== OWN) return Promise.resolve(0);
    this.workouts.delete(w.uuid);
    return Promise.resolve(1);
  }
  deleteAllOwnWorkouts() {
    let n = 0;
    for (const w of [...this.workouts.values()]) if (w.sourceBundleId === OWN) {
      this.workouts.delete(w.uuid);
      n += 1;
    }
    return Promise.resolve(n);
  }
  readWorkouts(since: number, until: number, heartRate: boolean) {
    return Promise.resolve([...this.workouts.values()].filter((w) => w.startMs >= since && w.startMs <= until).map((w) => ({ ...w, ...(heartRate ? {} : { avgHeartRate: null, maxHeartRate: null }) })));
  }
  readBodyMass(since: number) {
    return Promise.resolve(this.weights.filter((w) => w.atMs >= since));
  }
  readRestingHeartRate(since: number) {
    return Promise.resolve(this.resting.filter((w) => w.atMs >= since));
  }
  readSleep(since: number) {
    return Promise.resolve(this.sleep.filter((w) => w.startMs >= since));
  }
  ownWorkouts() {
    return [...this.workouts.values()].filter((w) => w.sourceBundleId === OWN);
  }
  addGarmin(w: Partial<HealthNativeWorkout> & { startMs: number; endMs: number; activityType: number }) {
    const uuid = upper(500 + this.n++);
    this.workouts.set(uuid, { uuid, durationS: (w.endMs - w.startMs) / 1000, distanceM: null, avgHeartRate: 128, maxHeartRate: 161, sourceName: 'Garmin Connect', sourceBundleId: 'com.garmin.connect.mobile', externalId: null, timeZone: null, ...w });
    return uuid.toLowerCase();
  }
}

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
    expect(feed.items.filter((i) => i.kind === 'activity').map((i) => [i.key, i.kind === 'activity' ? i.fromHealth : null])).toEqual([[`a:${run}`, 'Garmin']]);
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
    expect(sheet?.nearby.map((w) => w.sessionId)).toContain(id);
    expect((await s.health.link({ healthUuid: strength, sessionId: id, opId: 'link-1' })).ok).toBe(true);
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    // The Health activity is read-only.
    const a = await s.activities.get(run);
    expect(a?.source).toBe('health');
    expect((await s.activities.remove({ activityId: run, expectedVersion: 1, opId: 'rm' })).ok).toBe(false);
  });

  it('a weak overlap is asked about; `Not it` is never asked again', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs += 60_000;
    const start = h.clockMs;
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    // Started 10 minutes after the workout ended: near, but no overlap.
    const uuid = fake.addGarmin({ activityType: 50, startMs: h.clockMs + 10 * 60_000, endMs: h.clockMs + 50 * 60_000 });
    h.clockMs += 60 * 60_000;
    expect(start).toBeLessThan(h.clockMs);
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    const q = await s.health.forWorkout(id);
    expect(q).toMatchObject({ kind: 'question', candidates: [{ healthUuid: uuid }] });
    expect((await s.health.notIt({ healthUuid: uuid, sessionId: id, opId: 'not-it' })).ok).toBe(true);
    await s.health.readNow();
    expect(await s.health.forWorkout(id)).toEqual({ kind: 'none' });
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
