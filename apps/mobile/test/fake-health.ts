import type { HealthNativeBodyMass, HealthNativeRestingHr, HealthNativeSleep, HealthNativeWorkout, HealthPort, HealthSaveRequest } from '@fizz/providers';

/** A fake HealthKit for the app tests (ADR 0035): Garmin workouts, weights, resting HR and sleep, our own writes. */

export const OWN = 'com.projectfizz.fizz';
export const upper = (n: number) => `A${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;

export class FakeHealth implements HealthPort {
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

