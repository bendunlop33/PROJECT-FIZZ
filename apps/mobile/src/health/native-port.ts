import Constants from 'expo-constants';
import type { HealthPort } from '@fizz/providers';

import HealthStore from '../../modules/health-store';

/**
 * Phone binding for Apple Health (ADR 0035): the app's small HealthKit module, or null when this build doesn't
 * include it (Expo Go, an older build). Whether HealthKit works on this install is still checked at runtime
 * (`healthCapability`): SideStore may strip the entitlement.
 */
export function nativeHealthPort(): HealthPort | null {
  const m = HealthStore;
  if (m === null) return null;
  return {
    bundleId: typeof m.bundleId === 'string' ? m.bundleId : '',
    capability: () => m.capability(),
    requestAuthorization: (share, read) => m.requestAuthorization(share, read),
    workoutShareStatus: () => m.workoutShareStatus(),
    saveWorkout: (input) => m.saveWorkout(input),
    deleteWorkout: (uuid) => m.deleteWorkout(uuid),
    deleteAllOwnWorkouts: () => m.deleteAllOwnWorkouts(),
    readWorkouts: (since, until, hr) => m.readWorkouts(since, until, hr),
    readBodyMass: (since) => m.readBodyMass(since),
    readRestingHeartRate: (since) => m.readRestingHeartRate(since),
    readSleep: (since) => m.readSleep(since),
  };
}

/** Built with the HealthKit entitlement (`FIZZ_HEALTHKIT`, read from `extra` as the Live Activity flag is). */
export function healthInBuild(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  return typeof extra === 'object' && extra !== null && (extra as { includeHealthKit?: unknown }).includeHealthKit === true;
}
