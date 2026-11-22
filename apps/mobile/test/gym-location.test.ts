import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LocationFix } from '@fizz/domain';

import type { LocationPermission, LocationPort } from '../src/services/gym-location-service';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 7 Nov; ADR 0041) Gym from GPS through the app's services with a fake location port: a gym's saved
 * location, Today switching before Start (with Undo), a workout only offering, no permission or fix doing nothing,
 * and the location surviving a backup and restore. Nothing is sent anywhere.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const BATTERSEA = { latitude: 51.4817, longitude: -0.1447 };
const CLAPHAM = { latitude: 51.4643, longitude: -0.1704 };

interface FakeLocation extends LocationPort {
  perm: LocationPermission;
  /** What `request()` turns the permission into. */
  answer: LocationPermission;
  next: LocationFix | null;
  requests: number;
  fixes: { precise: boolean; timeoutMs: number }[];
  present: boolean;
}

function fakeLocation(over: Partial<Pick<FakeLocation, 'perm' | 'answer' | 'next' | 'present'>> = {}): FakeLocation {
  const f: FakeLocation = {
    perm: 'undetermined',
    answer: 'granted',
    next: { ...CLAPHAM, accuracyM: 15 },
    requests: 0,
    fixes: [],
    present: true,
    ...over,
    available: () => f.present,
    permission: () => Promise.resolve(f.perm),
    request: () => {
      f.requests += 1;
      f.perm = f.answer;
      return Promise.resolve(f.perm);
    },
    fix: (opts) => {
      f.fixes.push(opts);
      return Promise.resolve(f.next);
    },
  };
  return f;
}

/** Main Gym (default) and Battersea, each with its location saved from a fix there. */
async function twoLocatedGyms(loc: FakeLocation) {
  const { services: s } = await h.launch({ location: loc });
  const mainId = await setUpGym(h, s);
  const batId = h.ids();
  expect(await s.setup.saveGym({ gymId: batId, name: 'Battersea', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
  loc.next = { ...CLAPHAM, accuracyM: 12 };
  expect(await s.gymLocation.setFromCurrentLocation(mainId)).toMatchObject({ ok: true });
  loc.next = { ...BATTERSEA, accuracyM: 8 };
  expect(await s.gymLocation.setFromCurrentLocation(batId)).toMatchObject({ ok: true });
  return { s, mainId, batId };
}

describe('Use current location on a gym', () => {
  it('asks for when-in-use permission the first time only, saves one fix on the gym (versioned), and Clear forgets it', async () => {
    const loc = fakeLocation();
    const { services: s } = await h.launch({ location: loc });
    const mainId = await setUpGym(h, s);
    expect(s.gymLocation.available()).toBe(true);
    const before = await s.gyms.detail(mainId);
    const r = await s.gymLocation.setFromCurrentLocation(mainId);
    if (!r.ok) throw new Error(r.message);
    expect(loc.requests).toBe(1);
    expect(loc.fixes.at(-1)).toMatchObject({ precise: true });
    expect(r.gym.location).toEqual({ latitude: CLAPHAM.latitude, longitude: CLAPHAM.longitude, accuracyM: 15, setAtUtc: h.now().utc });
    const after = await s.gyms.detail(mainId);
    expect(after?.gym.location).toEqual(r.gym.location);
    expect(after?.gym.version).toBe((before?.gym.version ?? 0) + 1);
    // A second time: no second prompt.
    await s.gymLocation.setFromCurrentLocation(mainId);
    expect(loc.requests).toBe(1);
    const cleared = await s.gymLocation.clear(mainId);
    expect(cleared.ok && cleared.gym.location).toBeUndefined();
    expect((await s.gyms.detail(mainId))?.gym.location).toBeUndefined();
  });

  it('denied, no fix or a rough fix: an honest message and nothing saved', async () => {
    const loc = fakeLocation({ answer: 'denied' });
    const { services: s } = await h.launch({ location: loc });
    const mainId = await setUpGym(h, s);
    expect(await s.gymLocation.setFromCurrentLocation(mainId)).toMatchObject({ ok: false, reason: 'denied' });
    loc.perm = 'granted';
    loc.next = null;
    expect(await s.gymLocation.setFromCurrentLocation(mainId)).toMatchObject({ ok: false, reason: 'no_fix' });
    loc.next = { ...CLAPHAM, accuracyM: 900 };
    expect(await s.gymLocation.setFromCurrentLocation(mainId)).toMatchObject({ ok: false, reason: 'no_fix' });
    expect((await s.gyms.detail(mainId))?.gym.location).toBeUndefined();
  });

  it('no location module in this build: the rows are hidden and nothing is asked', async () => {
    const loc = fakeLocation({ present: false });
    const { services: s } = await h.launch({ location: loc });
    const mainId = await setUpGym(h, s);
    expect(s.gymLocation.available()).toBe(false);
    expect(await s.gymLocation.setFromCurrentLocation(mainId)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect(loc.requests + loc.fixes.length).toBe(0);
    // And with no port at all (tests, Expo Go).
    const { services: bare } = await h.launch();
    expect(bare.gymLocation.available()).toBe(false);
  });
});

describe('Today picks the gym Ben is at', () => {
  it('within 200 m of another saved gym before Start: Today’s gym switches, with Undo; Undo isn’t undone by the next open', async () => {
    const loc = fakeLocation();
    const { s, mainId, batId } = await twoLocatedGyms(loc);
    expect((await s.yourData.currentGym())?.id).toBe(mainId);
    loc.next = { latitude: BATTERSEA.latitude + 0.001, longitude: BATTERSEA.longitude, accuracyM: 30 };
    const fixesBefore = loc.fixes.length;
    const r = await s.gymLocation.checkToday();
    expect(r).toEqual({ kind: 'switched', gymId: batId, gymName: 'Battersea', previousGymId: mainId });
    expect(loc.fixes.slice(fixesBefore)).toEqual([{ precise: false, timeoutMs: 4000 }]);
    expect((await s.yourData.currentGym())?.id).toBe(batId);
    // Opening Today again at the same gym: nothing more.
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    // Undo: Main again, and Battersea isn't picked again behind Ben's back.
    if (r.kind !== 'switched') throw new Error('no switch');
    expect(await s.gymLocation.undoToday(r)).toBe(true);
    expect((await s.yourData.currentGym())?.id).toBe(mainId);
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect((await s.yourData.currentGym())?.id).toBe(mainId);
  });

  it('no permission, no fix, too far, a rough fix, or no gym located: nothing, and never a prompt', async () => {
    const loc = fakeLocation();
    const { s, mainId } = await twoLocatedGyms(loc);
    const requests = loc.requests;
    loc.perm = 'denied';
    loc.next = { ...BATTERSEA, accuracyM: 10 };
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    loc.perm = 'undetermined';
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect(loc.requests).toBe(requests);
    loc.perm = 'granted';
    loc.next = null;
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    loc.next = { latitude: BATTERSEA.latitude + 0.01, longitude: BATTERSEA.longitude, accuracyM: 10 };
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    loc.next = { ...BATTERSEA, accuracyM: 800 };
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect((await s.yourData.currentGym())?.id).toBe(mainId);
  });

  it('no gym has a location: no fix is even taken', async () => {
    const loc = fakeLocation({ perm: 'granted' });
    const { services: s } = await h.launch({ location: loc });
    await setUpGym(h, s);
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect(loc.fixes).toHaveLength(0);
  });

  it('during a workout: Today never switches; the workout is offered the gym, and nothing changes until Switch', async () => {
    const loc = fakeLocation();
    const { s, mainId, batId } = await twoLocatedGyms(loc);
    const started = await s.workout.start({ gymId: mainId, opId: 'w', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    loc.next = { ...BATTERSEA, accuracyM: 20 };
    expect(await s.gymLocation.checkToday()).toEqual({ kind: 'none' });
    expect((await s.yourData.currentGym())?.id).toBe(mainId);
    expect(await s.gymLocation.checkWorkout(sessionId)).toEqual({ gymId: batId, gymName: 'Battersea' });
    expect((await s.workout.load(sessionId))?.aggregate.session.gymId).toBe(mainId);
    // `Switch` on the offer is the whole-workout switch.
    const sw = await s.gymSwitch.switchNow(sessionId, batId, 'offer-op');
    expect(sw).toMatchObject({ ok: true, gymName: 'Battersea' });
    expect(await s.gymLocation.checkWorkout(sessionId)).toBeNull();
    // Away from both gyms: no offer.
    loc.next = { latitude: 51.6, longitude: -0.3, accuracyM: 10 };
    expect(await s.gymLocation.checkWorkout(sessionId)).toBeNull();
  });
});

describe('a gym’s location is Your data', () => {
  it('survives a backup and restore, and stays on the gym record', async () => {
    const loc = fakeLocation();
    const { s, batId } = await twoLocatedGyms(loc);
    const saved = (await s.gyms.detail(batId))?.gym.location;
    expect(saved).toMatchObject({ latitude: BATTERSEA.latitude, longitude: BATTERSEA.longitude, accuracyM: 8 });
    // A finished workout writes an automatic backup with both gyms as they are now.
    const mainId = (await s.yourData.currentGym())?.id ?? '';
    await logWorkout(h, s, mainId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await h.settle(s);
    const file = [...h.backupFiles.keys()].filter((n) => n.endsWith('-auto.json')).sort().at(-1);
    if (!file) throw new Error('no backup');
    const text = h.backupFiles.get(file) ?? '';
    expect(text).toContain(String(BATTERSEA.latitude));
    // Cleared afterwards, then restored: the location is back.
    await s.gymLocation.clear(batId);
    expect((await s.gyms.detail(batId))?.gym.location).toBeUndefined();
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await s.gyms.detail(batId))?.gym.location).toEqual(saved);
  });
});
