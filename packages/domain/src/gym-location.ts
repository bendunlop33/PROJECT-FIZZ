import type { Gym, GymLocation } from '@fizz/schemas';

/**
 * (Ben, 7 Nov; ADR 0041) Picking the gym from one when-in-use location fix.
 * Pure: the app takes the fix (expo-location, behind a port) and these decide
 * what it means. Coordinates never leave the phone and never reach the coach.
 */

/** A saved gym counts as "here" within this distance of the fix. */
export const GYM_MATCH_RADIUS_M = 200;
/** A fix less precise than this can't tell gyms apart: no match. */
export const GYM_MATCH_MAX_ACCURACY_M = 500;
/** Two gyms closer to the fix than this to each other's distance are a tie: nothing is picked. */
export const GYM_MATCH_TIE_M = 1;

const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** One location fix: degrees and the horizontal accuracy in metres (null when iOS gives none). */
export interface LocationFix extends LatLon {
  accuracyM: number | null;
}

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validFix(fix: LocationFix): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracyM !== null &&
    Number.isFinite(fix.accuracyM) &&
    fix.accuracyM >= 0 &&
    fix.accuracyM <= GYM_MATCH_MAX_ACCURACY_M
  );
}

export interface GymMatch {
  gymId: string;
  gymName: string;
  distanceM: number;
}

/**
 * The saved gym Ben is at: the nearest live gym with a location within
 * `radiusM` of the fix. No match when the fix is missing, invalid or too
 * imprecise (accuracy unknown or worse than 500 m), when no gym is near, or
 * when the two nearest are a tie (the app can't tell, so it does nothing).
 */
export function matchGymByLocation(
  fix: LocationFix | null,
  gyms: readonly Pick<Gym, 'id' | 'name' | 'location' | 'archivedAtUtc'>[],
  opts: { radiusM?: number } = {},
): GymMatch | null {
  if (fix === null || !validFix(fix)) return null;
  const radius = opts.radiusM ?? GYM_MATCH_RADIUS_M;
  const near = gyms
    .filter((g): g is typeof g & { location: GymLocation } => g.location !== undefined && g.archivedAtUtc === undefined)
    .map((g) => ({ gymId: g.id, gymName: g.name, distanceM: haversineMeters(fix, g.location) }))
    .filter((m) => m.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM);
  const first = near[0];
  if (first === undefined) return null;
  const second = near[1];
  if (second !== undefined && second.distanceM - first.distanceM < GYM_MATCH_TIE_M) return null;
  return first;
}

/**
 * What a match means where Ben is (Ben, 7 Nov): before Start, Today switches to
 * that gym (with Undo); during a workout the app only offers it; the gym
 * already in use, or no match, does nothing.
 */
export type GymLocationAction = { kind: 'none' } | { kind: 'switch_today'; gymId: string; gymName: string } | { kind: 'offer_in_workout'; gymId: string; gymName: string };

export function gymLocationAction(match: GymMatch | null, ctx: { currentGymId: string | null; workoutActive: boolean }): GymLocationAction {
  if (match === null || match.gymId === ctx.currentGymId) return { kind: 'none' };
  return ctx.workoutActive ? { kind: 'offer_in_workout', gymId: match.gymId, gymName: match.gymName } : { kind: 'switch_today', gymId: match.gymId, gymName: match.gymName };
}

/** Whether any live gym has a saved location (else no fix is ever taken). */
export function anyGymHasLocation(gyms: readonly Pick<Gym, 'location' | 'archivedAtUtc'>[]): boolean {
  return gyms.some((g) => g.location !== undefined && g.archivedAtUtc === undefined);
}

/**
 * The location to save on a gym from `Use current location`: rounded to 6
 * decimals (about 0.1 m) and whole metres of accuracy. Null when the fix is
 * unusable or too imprecise to match against later (the same 500 m bar).
 */
export function gymLocationFromFix(fix: LocationFix | null, atUtc: string): GymLocation | null {
  if (fix === null || !validFix(fix) || fix.accuracyM === null) return null;
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { latitude: round6(fix.latitude), longitude: round6(fix.longitude), accuracyM: Math.round(fix.accuracyM), setAtUtc: atUtc };
}
