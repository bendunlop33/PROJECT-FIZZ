import { requireOptionalNativeModule } from 'expo';

import type { LocationFix } from '@fizz/domain';
import type * as ExpoLocationModule from 'expo-location';

import type { LocationPermission, LocationPort } from '../services/gym-location-service';

/**
 * Phone binding for the gym-from-GPS check (Ben, 7 Nov; ADR 0041): expo-location, when-in-use only.
 * Capability-detected: a build without the native module (Expo Go, an older IPA) gets `available() === false`
 * and the app hides the GPS rows. expo-location is imported only after the check, since its JS throws on import
 * without the native module. Never background location, never region monitoring, never "Always".
 */

type ExpoLocation = typeof ExpoLocationModule;

let loaded: Promise<ExpoLocation | null> | null = null;

function hasNative(): boolean {
  try {
    return requireOptionalNativeModule('ExpoLocation') !== null;
  } catch {
    return false;
  }
}

function load(): Promise<ExpoLocation | null> {
  loaded ??= hasNative() ? import('expo-location').catch(() => null) : Promise.resolve(null);
  return loaded;
}

function permissionOf(status: string): LocationPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve(null);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

export function expoLocationPort(): LocationPort {
  return {
    available: hasNative,
    async permission() {
      const L = await load();
      if (L === null) return 'denied';
      return permissionOf((await L.getForegroundPermissionsAsync()).status);
    },
    async request() {
      const L = await load();
      if (L === null) return 'denied';
      return permissionOf((await L.requestForegroundPermissionsAsync()).status);
    },
    async fix({ precise, timeoutMs }): Promise<LocationFix | null> {
      const L = await load();
      if (L === null) return null;
      const position = await withTimeout(L.getCurrentPositionAsync({ accuracy: precise ? L.Accuracy.High : L.Accuracy.Balanced }), timeoutMs);
      if (position === null) return null;
      const { latitude, longitude, accuracy } = position.coords;
      return { latitude, longitude, accuracyM: accuracy ?? null };
    },
  };
}
