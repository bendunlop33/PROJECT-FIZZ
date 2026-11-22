import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { ReportMeta } from './probe/model';

export function reportMeta(): ReportMeta {
  return {
    appVersion: Application.nativeApplicationVersion ?? 'unknown',
    buildNumber: Application.nativeBuildVersion ?? 'unknown',
    installedBundleId: Application.applicationId ?? 'unknown',
    // From the embedded app config, i.e. app-identity.mts at build time.
    configuredBundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? 'unknown',
    osVersion: String(Platform.Version),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
