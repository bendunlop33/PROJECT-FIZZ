import { describe, expect, it } from 'vitest';
import { GymLocationSchema } from '@fizz/schemas';
import { anyGymHasLocation, gymLocationAction, gymLocationFromFix, haversineMeters, matchGymByLocation, type LocationFix } from '../src/index';

const AT = '2026-11-07T10:00:00.000Z';
/** Battersea Power Station and a gym ~1.2 km away at Clapham Junction. */
const BATTERSEA = { latitude: 51.4817, longitude: -0.1447 };
const CLAPHAM = { latitude: 51.4643, longitude: -0.1704 };

const gym = (id: string, name: string, loc: { latitude: number; longitude: number } | null, archived = false) => ({
  id,
  name,
  ...(loc === null ? {} : { location: { ...loc, accuracyM: 10, setAtUtc: AT } }),
  ...(archived ? { archivedAtUtc: AT } : {}),
});

/** A point `metres` north of `p` (1° latitude ≈ 111.2 km). */
const north = (p: { latitude: number; longitude: number }, metres: number) => ({ latitude: p.latitude + metres / 111_195, longitude: p.longitude });
const fix = (p: { latitude: number; longitude: number }, accuracyM: number | null = 20): LocationFix => ({ ...p, accuracyM });

describe('haversineMeters', () => {
  it('is zero for the same point and symmetric', () => {
    expect(haversineMeters(BATTERSEA, BATTERSEA)).toBe(0);
    expect(haversineMeters(BATTERSEA, CLAPHAM)).toBeCloseTo(haversineMeters(CLAPHAM, BATTERSEA), 6);
  });
  it('matches known distances', () => {
    // London → Paris is about 343.5 km.
    expect(haversineMeters({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 }) / 1000).toBeCloseTo(343.5, 0);
    expect(haversineMeters(BATTERSEA, north(BATTERSEA, 150))).toBeCloseTo(150, 0);
    // Across the antimeridian: 0.2° of longitude at the equator ≈ 22.2 km, not 40,000.
    expect(haversineMeters({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }) / 1000).toBeCloseTo(22.2, 0);
  });
});

describe('matchGymByLocation', () => {
  const gyms = [gym('main', 'Main gym', CLAPHAM), gym('bat', 'Battersea', BATTERSEA), gym('hotel', 'Hotel', null)];

  it('picks the saved gym within 200 m', () => {
    expect(matchGymByLocation(fix(north(BATTERSEA, 120)), gyms)).toMatchObject({ gymId: 'bat', gymName: 'Battersea' });
    expect(matchGymByLocation(fix(north(BATTERSEA, 199)), gyms)?.gymId).toBe('bat');
  });
  it('no match beyond 200 m, with no fix, or with no gym located', () => {
    expect(matchGymByLocation(fix(north(BATTERSEA, 260)), gyms)).toBeNull();
    expect(matchGymByLocation(null, gyms)).toBeNull();
    expect(matchGymByLocation(fix(BATTERSEA), [gym('hotel', 'Hotel', null)])).toBeNull();
  });
  it('a fix less precise than 500 m, or of unknown accuracy, matches nothing', () => {
    expect(matchGymByLocation(fix(BATTERSEA, 501), gyms)).toBeNull();
    expect(matchGymByLocation(fix(BATTERSEA, null), gyms)).toBeNull();
    expect(matchGymByLocation(fix(BATTERSEA, 500), gyms)?.gymId).toBe('bat');
  });
  it('invalid coordinates match nothing', () => {
    expect(matchGymByLocation({ latitude: Number.NaN, longitude: 0, accuracyM: 5 }, gyms)).toBeNull();
    expect(matchGymByLocation({ latitude: 91, longitude: 0, accuracyM: 5 }, gyms)).toBeNull();
  });
  it('the nearest of two gyms in range wins', () => {
    const two = [gym('a', 'A', BATTERSEA), gym('b', 'B', north(BATTERSEA, 100))];
    expect(matchGymByLocation(fix(north(BATTERSEA, 80)), two)?.gymId).toBe('b');
    expect(matchGymByLocation(fix(north(BATTERSEA, 20)), two)?.gymId).toBe('a');
  });
  it('a tie (two gyms at the same spot) picks nothing', () => {
    const twins = [gym('a', 'A', BATTERSEA), gym('b', 'B', BATTERSEA)];
    expect(matchGymByLocation(fix(north(BATTERSEA, 50)), twins)).toBeNull();
  });
  it('archived gyms are never picked', () => {
    expect(matchGymByLocation(fix(BATTERSEA), [gym('bat', 'Battersea', BATTERSEA, true)])).toBeNull();
  });
  it('anyGymHasLocation ignores archived gyms', () => {
    expect(anyGymHasLocation(gyms)).toBe(true);
    expect(anyGymHasLocation([gym('x', 'X', BATTERSEA, true), gym('y', 'Y', null)])).toBe(false);
  });
});

describe('gymLocationAction', () => {
  const match = { gymId: 'bat', gymName: 'Battersea', distanceM: 40 };
  it('before Start: switch Today to the matched gym', () => {
    expect(gymLocationAction(match, { currentGymId: 'main', workoutActive: false })).toEqual({ kind: 'switch_today', gymId: 'bat', gymName: 'Battersea' });
  });
  it('during a workout: only offer', () => {
    expect(gymLocationAction(match, { currentGymId: 'main', workoutActive: true })).toEqual({ kind: 'offer_in_workout', gymId: 'bat', gymName: 'Battersea' });
  });
  it('already at that gym, or no match: nothing', () => {
    expect(gymLocationAction(match, { currentGymId: 'bat', workoutActive: false })).toEqual({ kind: 'none' });
    expect(gymLocationAction(null, { currentGymId: 'main', workoutActive: true })).toEqual({ kind: 'none' });
  });
});

describe('gymLocationFromFix', () => {
  it('saves explicit degrees and metres, rounded, valid for the schema', () => {
    const loc = gymLocationFromFix({ latitude: 51.48171234567, longitude: -0.14471234567, accuracyM: 12.6 }, AT);
    expect(loc).toEqual({ latitude: 51.481712, longitude: -0.144712, accuracyM: 13, setAtUtc: AT });
    expect(GymLocationSchema.safeParse(loc).success).toBe(true);
  });
  it('refuses no fix, a rough fix or bad coordinates', () => {
    expect(gymLocationFromFix(null, AT)).toBeNull();
    expect(gymLocationFromFix(fix(BATTERSEA, 800), AT)).toBeNull();
    expect(gymLocationFromFix(fix(BATTERSEA, null), AT)).toBeNull();
    expect(gymLocationFromFix({ latitude: 0, longitude: 200, accuracyM: 5 }, AT)).toBeNull();
  });
});
