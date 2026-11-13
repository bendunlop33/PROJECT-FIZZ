import { requireOptionalNativeModule, type NativeModule } from 'expo';

/** HealthKit as this install sees it (ADR 0035). */
export interface NativeHealthCapability {
  status: 'available' | 'unsupported' | 'missing_entitlement' | 'unknown';
  message: string;
}

export interface NativeHealthWorkout {
  uuid: string;
  activityType: number;
  startMs: number;
  endMs: number;
  durationS: number;
  distanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  activeKcal: number | null;
  sourceName: string;
  sourceBundleId: string;
  externalId: string | null;
  timeZone: string | null;
}

export interface NativeBodyMass {
  uuid: string;
  kg: number;
  atMs: number;
  sourceName: string;
  sourceBundleId: string;
}

export interface NativeRestingHr {
  uuid: string;
  bpm: number;
  atMs: number;
  sourceName: string;
  sourceBundleId: string;
}

export interface NativeSleep {
  uuid: string;
  value: number;
  startMs: number;
  endMs: number;
  sourceName: string;
  sourceBundleId: string;
}

export interface NativeSaveWorkout {
  activityType: number;
  startMs: number;
  endMs: number;
  pauses: { startMs: number; endMs: number }[];
  syncIdentifier: string;
  syncVersion: number;
  externalId: string;
  timeZone: string;
}

export type NativeHealthType = 'workout' | 'bodyMass' | 'heartRate' | 'activeEnergyBurned' | 'restingHeartRate' | 'sleepAnalysis' | 'distanceWalkingRunning' | 'distanceCycling' | 'distanceSwimming';

declare class HealthStoreNativeModule extends NativeModule {
  readonly bundleId: string;
  capability(): Promise<NativeHealthCapability>;
  requestAuthorization(share: NativeHealthType[], read: NativeHealthType[]): Promise<{ ok: boolean; message: string }>;
  workoutShareStatus(): Promise<'notDetermined' | 'denied' | 'authorized'>;
  saveWorkout(input: NativeSaveWorkout): Promise<{ uuid: string; adopted: boolean }>;
  deleteWorkout(uuid: string): Promise<number>;
  deleteAllOwnWorkouts(): Promise<number>;
  readWorkouts(sinceMs: number, untilMs: number, heartRate: boolean): Promise<NativeHealthWorkout[]>;
  readBodyMass(sinceMs: number): Promise<NativeBodyMass[]>;
  readRestingHeartRate(sinceMs: number): Promise<NativeRestingHr[]>;
  readSleep(sinceMs: number): Promise<NativeSleep[]>;
}

/** null when this build doesn't include the module (Expo Go, an older build): Apple Health is then not available. */
const HealthStore: HealthStoreNativeModule | null = requireOptionalNativeModule<HealthStoreNativeModule>('HealthStore');

export default HealthStore;
