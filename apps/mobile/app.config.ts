import { env } from 'node:process';

import type { ExpoConfig } from 'expo/config';
import { APP_GROUP_IDENTIFIER, APP_NAME, BUNDLE_IDENTIFIER, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from './app-identity.mts';
import { withFreeProvisioning } from './plugins/with-free-provisioning.mts';

/**
 * Build-time switches (read by `expo prebuild`, set by the IPA workflow):
 * - FIZZ_BUILD_NUMBER: CFBundleVersion; CI passes the run number so each IPA is newer.
 * - FIZZ_LIVE_ACTIVITY=0: leave out the expo-widgets Live Activity extension,
 *   a fallback if the extension breaks the unsigned build or SideStore signing.
 */
// Expo's global typings declare env values as `any`; narrow them here.
function envString(name: string): string | undefined {
  const value: unknown = env[name];
  return typeof value === 'string' ? value : undefined;
}

const buildNumber = envString('FIZZ_BUILD_NUMBER') ?? '1';
const includeLiveActivity = envString('FIZZ_LIVE_ACTIVITY') !== '0';

const plugins: NonNullable<ExpoConfig['plugins']> = [
  [
    'expo-speech-recognition',
    {
      microphonePermission: 'Fizz uses the microphone when you hold Talk to log a set by voice.',
      speechRecognitionPermission: 'Fizz turns your speech into text on this iPhone to log sets.',
    },
  ],
];
if (includeLiveActivity) {
  plugins.push([
    'expo-widgets',
    {
      bundleIdentifier: WIDGET_EXTENSION_BUNDLE_IDENTIFIER,
      groupIdentifier: APP_GROUP_IDENTIFIER,
      // Free Apple ID: Live Activities are started locally only, never by push.
      enablePushNotifications: false,
      frequentUpdates: false,
      widgets: [],
    },
  ]);
}

const config: ExpoConfig = {
  name: APP_NAME,
  slug: 'fizz',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['ios'],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    buildNumber,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins,
  // Read at runtime by the capability probe (Metro can't import app-identity.mts).
  extra: { includeLiveActivity, appGroupIdentifier: APP_GROUP_IDENTIFIER },
};

// withFreeProvisioning wraps the config directly, so its mods are registered
// before the `plugins` array (and before Expo's automatic plugins such as
// expo-notifications). Expo runs mods newest-first, so it runs LAST and strips
// what the others added. Don't move it into `plugins`.
export default withFreeProvisioning(config);
