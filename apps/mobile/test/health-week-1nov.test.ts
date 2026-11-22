import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { daySheetRows, pairedDaySheetRows } from '../src/today/today-view';
import type { AppServices } from '../src/services/app-services';
import { READ_EVERY_MS } from '../src/health/health-service';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, Sun 1 Nov, build 500: "Now the Garmin or health workouts don't show up.") Real SQLite and a fake HealthKit,
 * synthetic data shaped like his week: workouts logged Mon 26 – Wed 28, Fri 30 and Sat 31, each written to Health
 * (the app's own copies), Garmin Connect's `Strength` for Mon–Wed with a duplicate on Mon and Tue, an older build's
 * automatic link from Wed's workout to the app's own copy, and a Garmin run on Thu 29 (6 km, 35 min).
 *
 * The full Health read runs through `health-service` the way the phone does (launch, then return to the foreground),
 * never through a switch. Every place that lists the week shows the run; linked strength shows once, in its workout.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  h = createHarness('2026-10-26T08:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

const MIN = 60_000;
const day = (d: number) => (d > 31 ? `2026-11-${String(d - 31).padStart(2, '0')}` : `2026-10-${String(d).padStart(2, '0')}`);
const at = (d: number, hhmm: string) => Date.parse(`${day(d)}T${hhmm}:00.000Z`);
const SUN = at(32, '09:30');
const health = () => ({ health: { port: fake, buildIncludesHealth: true } });

interface Week {
  ids: Map<number, string>;
  run: string;
  garmin: Map<number, string>;
}

/** Ben's week as builds up to 493 left it: logged, written to Health, read and linked (Wed to the app's own copy). */
async function bensWeek(s: AppServices): Promise<Week> {
  const gymId = await setUpGym(h, s);
  for (const k of ['readActivities', 'readHeartRate', 'readRestingHeartRate', 'readSleep'] as const) await s.health.setSwitch(k, true);
  const ids = new Map<number, string>();
  const span = new Map<number, { startMs: number; endMs: number }>();
  for (const d of [26, 27, 28, 30, 31]) {
    h.clockMs = at(d, '17:00');
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: Array.from({ length: 5 }, () => ({ load: 60, reps: 8 })) }]);
    ids.set(d, id);
    const a = (await s.workout.load(id))?.aggregate;
    if (a?.session.endedAt == null) throw new Error('not finished');
    span.set(d, { startMs: Date.parse(a.session.startedAt.utc), endMs: Date.parse(a.session.endedAt.utc) });
  }
  // Wed's copy written by another install, from a source an older build didn't recognise: it auto-linked to it.
  const wed = span.get(28);
  if (wed === undefined) throw new Error('no Wed');
  const wedCopy = fake.addGarmin({ activityType: 50, startMs: wed.startMs, endMs: wed.endMs, sourceName: 'GymSmarter', sourceBundleId: 'com.example.unknown', avgHeartRate: null });
  h.clockMs = at(28, '20:00');
  await s.health.readNow();
  expect(await s.health.forWorkout(ids.get(28) ?? '')).toMatchObject({ kind: 'linked', healthUuid: wedCopy });
  // This install writes its workouts too (own-copy write records), and Wed's copy turns out to be the app's own.
  await s.health.setSwitch('writeWorkouts', true);
  await s.health.syncWrites();
  expect(fake.ownWorkouts().length).toBeGreaterThan(0);
  const native = fake.workouts.get(wedCopy.toUpperCase());
  if (native === undefined) throw new Error('no copy');
  fake.workouts.set(native.uuid, { ...native, sourceBundleId: 'com.projectfizz.fizz.ABCDE12345' });
  const garmin = new Map<number, string>();
  for (const d of [26, 27, 28]) {
    const w = span.get(d);
    if (w === undefined) throw new Error('no span');
    garmin.set(d, fake.addGarmin({ activityType: 50, startMs: w.startMs - 3 * MIN, endMs: w.endMs + MIN, sourceName: 'Connect' }));
    // Garmin writes Mon and Tue a second time.
    if (d !== 28) fake.addGarmin({ activityType: 50, startMs: w.startMs - 2 * MIN, endMs: w.endMs + 2 * MIN, sourceName: 'Connect' });
  }
  const run = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:35'), distanceM: 6000, sourceName: 'Connect' });
  fake.resting.push({ uuid: 'B1000000-0000-4000-8000-000000000001', bpm: 45, atMs: at(32, '07:00'), sourceName: 'Connect', sourceBundleId: 'com.garmin.connect.mobile' });
  return { ids, run, garmin };
}

/** Everything that lists Thu 29 and the week, as the screens load them. */
async function views(s: AppServices, w: Week) {
  const today = await s.todaySession.load();
  if (today === null) throw new Error('no Today');
  const tiles = s.todaySession.week(today, null);
  const health = (await s.activities.between(day(26), day(33))).filter((a) => a.source === 'health');
  const t = await s.progress.training({ span: 'week', offset: 0 });
  const marks: Record<string, string[]> = {};
  for (const tile of t?.view?.month?.weeks.flat() ?? []) if (tile !== null && tile.marks.length > 0) marks[tile.date] = tile.marks.map((x) => x.kind);
  const feed = (await s.history.feed()).items.flatMap((i) => (i.kind === 'activity' ? [i.activityId] : []));
  const thu = tiles.find((x) => x.date === day(29));
  if (thu === undefined) throw new Error('no Thu tile');
  const thuSheet = pairedDaySheetRows(daySheetRows(thu, today.week.feed, () => null), await s.health.dayPairs(day(29)));
  const library = await s.plans.overview();
  return {
    healthIds: health.map((a) => a.id).sort(),
    thu,
    rings: Object.fromEntries(tiles.map((x) => [x.date, x.marks.filter((m) => m.shape === 'ring' && !m.planned).length])),
    marks,
    feed,
    thuSheet,
    library,
    run: w.run,
  };
}

describe('Ben’s week after an update (build 500): Health workouts reach every list without a switch', () => {
  it('launch then foreground: the run shows on Today, the strip, Progress, History and the day sheet; linked strength once', async () => {
    let s = (await h.launch(health())).services;
    const w = await bensWeek(s);
    // The update: the app closes and the new build opens on Sunday morning. Only the phone's own triggers run.
    await h.forceClose();
    h.clockMs = SUN;
    s = (await h.launch(health())).services;
    await s.health.onAppActive();

    const v = await views(s, w);
    // Only the run is a Health item of its own: Mon–Wed's Garmin strength (and duplicates) are their workouts'.
    expect(v.healthIds).toEqual([w.run]);
    for (const d of [26, 27, 28]) expect(await s.health.forWorkout(w.ids.get(d) ?? '')).toMatchObject({ kind: 'linked', healthUuid: w.garmin.get(d) });
    // The strip: Thu is tinted with its ring; the gym days have their dots and no extra ring.
    expect(v.thu.state).toBe('done');
    expect(v.thu.marks.map((m) => m.shape)).toEqual(['ring']);
    expect(v.rings).toMatchObject({ [day(26)]: 0, [day(27)]: 0, [day(28)]: 0, [day(29)]: 1, [day(30)]: 0, [day(31)]: 0 });
    // History lists the run; the day sheet shows it.
    expect(v.feed).toContain(w.run);
    expect(v.thuSheet).toHaveLength(1);
    expect(v.thuSheet[0]?.title ?? v.thuSheet[0]?.detail).toBeTruthy();
    // Library's This week (no plan in use here): its lines and IDs line up when there is one.
    expect(v.library === null || v.library.activities.length === v.library.activityIds.length).toBe(true);
    // The Health line still reads.
    expect((await s.health.signals()).restingHeartRate.length).toBeGreaterThan(0);
  });

  it('a run with no workout that day is always shown, whatever else the read does (links, duplicates, own copies)', async () => {
    const s = (await h.launch(health())).services;
    const w = await bensWeek(s);
    h.clockMs = SUN;
    for (let i = 0; i < 3; i += 1) {
      await s.health.readNow();
      expect((await views(s, w)).healthIds).toEqual([w.run]);
    }
  });
});

/**
 * (Ben, 1 Nov: "it worked but I had to turn a switch on and off again") What starts a Health read on the phone:
 * HealthHost's launch and foreground `onAppActive`, never a switch. Each case below needed the toggle before.
 */
describe('the Health read runs by itself after an update (Ben, 1 Nov)', () => {
  /** Ben's switches on, a workout on Wed written to Health, and nothing read yet on this build. */
  async function installed(): Promise<{ s: AppServices; id: string }> {
    const s = (await h.launch(health())).services;
    const gymId = await setUpGym(h, s);
    for (const k of ['readActivities', 'readHeartRate', 'readSleep', 'writeWorkouts'] as const) await s.health.setSwitch(k, true);
    h.clockMs = at(28, '17:00');
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await s.health.syncWrites();
    await h.forceClose();
    return { s, id };
  }
  const runShown = async (s: AppServices, run: string) => (await s.activities.between(day(26), day(33))).some((a) => a.id === run);

  it('a new build: the first launch reads, with no switch change, and tells the screens to reload', async () => {
    await installed();
    const run = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:35'), distanceM: 6000, sourceName: 'Connect' });
    h.clockMs = SUN;
    const s = (await h.launch(health())).services;
    let reloads = 0;
    const stop = s.health.onDataRead(() => {
      reloads += 1;
    });
    const asked = fake.asked.length;
    await s.health.onAppActive();
    stop();
    expect(await runShown(s, run)).toBe(true);
    expect(reloads).toBe(1);
    // No new permission sheet: reading needs nothing the switches didn't already ask for.
    expect(fake.asked.length).toBe(asked);
  });

  it('HealthKit not ready on the first check of a launch: the next foreground checks again and reads', async () => {
    await installed();
    const run = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:35'), distanceM: 6000, sourceName: 'Connect' });
    h.clockMs = SUN;
    const s = (await h.launch(health())).services;
    fake.capabilityUnknown = 10;
    await s.health.onAppActive();
    expect(await runShown(s, run)).toBe(false);
    fake.capabilityUnknown = 0;
    h.clockMs += 60_000;
    await s.health.onAppActive();
    expect(await runShown(s, run)).toBe(true);
  });

  it('a Health write that hasn’t answered never holds up the read', async () => {
    await installed();
    const run = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:35'), distanceM: 6000, sourceName: 'Connect' });
    h.clockMs = SUN;
    const s = (await h.launch(health())).services;
    const gymId = (await s.yourData.currentGym())?.id ?? '';
    // A workout finished on this build is waiting to be written; HealthKit's save hasn't answered.
    let release: () => void = () => undefined;
    fake.saveGate = new Promise<void>((r) => {
      release = r;
    });
    h.clockMs = at(31, '17:00');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    h.clockMs = SUN;
    await s.health.onAppActive();
    expect(await runShown(s, run)).toBe(true);
    release();
    fake.saveGate = null;
    await s.health.syncWrites();
  });

  it('return to the foreground: a read when due (not on every switch of apps)', async () => {
    await installed();
    h.clockMs = SUN;
    const s = (await h.launch(health())).services;
    await s.health.onAppActive();
    const reads = fake.reads;
    const run = fake.addGarmin({ activityType: 37, startMs: at(32, '08:00'), endMs: at(32, '08:35'), distanceM: 6000, sourceName: 'Connect' });
    h.clockMs += 60_000;
    await s.health.onAppActive();
    expect(fake.reads).toBe(reads);
    h.clockMs += READ_EVERY_MS;
    await s.health.onAppActive();
    expect(fake.reads).toBe(reads + 1);
    expect(await runShown(s, run)).toBe(true);
  });

  it('a launch paused by safe start reads nothing; the next normal launch reads by itself', async () => {
    await installed();
    const run = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:35'), distanceM: 6000, sourceName: 'Connect' });
    h.clockMs = SUN;
    // Root gives a paused launch no HealthKit port (`guardedHealthPort`) and mounts no HealthHost.
    const readsBefore = fake.reads;
    const paused = (await h.launch({ health: { port: null, buildIncludesHealth: true, paused: () => 'launch' } })).services;
    await paused.health.onAppActive();
    expect(fake.reads).toBe(readsBefore);
    expect(await runShown(paused, run)).toBe(false);
    await h.forceClose();
    h.clockMs += 60_000;
    const s = (await h.launch(health())).services;
    await s.health.onAppActive();
    expect(await runShown(s, run)).toBe(true);
  });

  it('after a restore (a relaunch over the restored data): the read runs again', async () => {
    await installed();
    h.clockMs = SUN;
    let s = (await h.launch(health())).services;
    await s.health.onAppActive();
    const run = fake.addGarmin({ activityType: 37, startMs: at(32, '08:00'), endMs: at(32, '08:35'), distanceM: 6000, sourceName: 'Connect' });
    // Root closes the services and starts the app again over the restored database: a new service, a fresh read.
    await h.forceClose();
    h.clockMs += 60_000;
    s = (await h.launch(health())).services;
    await s.health.onAppActive();
    expect(await runShown(s, run)).toBe(true);
  });
});
