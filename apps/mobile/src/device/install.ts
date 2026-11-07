import * as Application from 'expo-application';
import Constants from 'expo-constants';

import AudioCoach from '../../modules/audio-coach';
import { withTimeout } from '../probe/runners';

/**
 * `getInstallStatus` (system-states.md §7), the parts this build can read.
 * Signing expiry comes from the installed `embedded.mobileprovision`, read by
 * the audio-coach module (the same reader the probe uses). Without that
 * module (an older build) the date is honestly unknown.
 */
export interface InstallStatus {
  appVersion: string;
  buildNumber: string;
  installedBundleId: string;
  configuredBundleId: string;
  profileExpiresUtc: string | null;
  expirySource: 'profile' | 'unknown';
  expiryNote: string | null;
}

function configuredGroup(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const group = typeof extra === 'object' && extra !== null ? (extra as { appGroupIdentifier?: unknown }).appGroupIdentifier : undefined;
  return typeof group === 'string' && group.length > 0 ? group : null;
}

export async function readInstallStatus(): Promise<InstallStatus> {
  const base = {
    appVersion: Application.nativeApplicationVersion ?? 'unknown',
    buildNumber: Application.nativeBuildVersion ?? 'unknown',
    installedBundleId: Application.applicationId ?? 'unknown',
    configuredBundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? 'unknown',
  };
  if (AudioCoach === null) {
    return { ...base, profileExpiresUtc: null, expirySource: 'unknown', expiryNote: 'The signing reader isn’t in this build.' };
  }
  try {
    const group = configuredGroup();
    const info = await withTimeout(AudioCoach.getAppGroupInfo(group === null ? [] : [group]), 10_000, 'getAppGroupInfo');
    if (!info.profileFound) return { ...base, profileExpiresUtc: null, expirySource: 'unknown', expiryNote: 'No signing profile in the installed app.' };
    const expires = typeof info.profileExpiresUtc === 'string' ? info.profileExpiresUtc : null;
    return { ...base, profileExpiresUtc: expires, expirySource: expires === null ? 'unknown' : 'profile', expiryNote: null };
  } catch (e) {
    return { ...base, profileExpiresUtc: null, expirySource: 'unknown', expiryNote: e instanceof Error ? e.message : String(e) };
  }
}
