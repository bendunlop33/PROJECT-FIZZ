import { env } from 'node:process';

import type { ExpoConfig } from 'expo/config';
import { APP_GROUP_IDENTIFIER, BUNDLE_IDENTIFIER, DISPLAY_NAME, IOS_PROJECT_NAME, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from './app-identity.mts';
import { withFreeProvisioning } from './plugins/with-free-provisioning.mts';
import { withHealthKit } from './plugins/with-healthkit.mts';

/**
 * Build-time switches (read by `expo prebuild`, set by the IPA workflow):
 * - FIZZ_BUILD_NUMBER: CFBundleVersion; CI passes the run number so each IPA is newer.
 * - FIZZ_LIVE_ACTIVITY=0: leave out the expo-widgets Live Activity extension,
 *   a fallback if the extension breaks the unsigned build or SideStore signing.
 * - FIZZ_LA_BUTTONS=0: leave the Live Activity's −15 s / +15 s / Skip buttons
 *   out (Ben, 26 Oct; on by default), a fallback if they misbehave on the phone.
 *   They need no entitlement; the app hides them below iOS 17 or without the
 *   native tap queue.
 * - FIZZ_HEALTHKIT=0: leave the HealthKit entitlement out (ADR 0035; on by default). The app then shows
 *   Apple Health as `Not available on this install`, exactly as when SideStore strips the entitlement.
 * - FIZZ_BACKGROUND_AUDIO=1: opt-in experiment (default OFF). Adds
 *   UIBackgroundModes "audio" so the probe can test a spoken cue while locked
 *   (ios-platform-feasibility.md rec. 6; ADR 0007). Not a product decision.
 */
// Expo's global typings declare env values as `any`; narrow them here.
function envString(name: string): string | undefined {
  const value: unknown = env[name];
  return typeof value === 'string' ? value : undefined;
}

const buildNumber = envString('FIZZ_BUILD_NUMBER') ?? '1';
const includeLiveActivity = envString('FIZZ_LIVE_ACTIVITY') !== '0';
const backgroundAudioExperiment = envString('FIZZ_BACKGROUND_AUDIO') === '1';
const liveActivityButtons = includeLiveActivity && envString('FIZZ_LA_BUTTONS') !== '0';
const includeHealthKit = envString('FIZZ_HEALTHKIT') !== '0';

const plugins: NonNullable<ExpoConfig['plugins']> = [
  [
    'expo-speech-recognition',
    {
      microphonePermission: `${DISPLAY_NAME} uses the microphone when you hold Talk to log a set by voice.`,
      speechRecognitionPermission: `${DISPLAY_NAME} turns your speech into text on this iPhone to log sets.`,
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
  // Internal: becomes the Xcode project name. Ben sees DISPLAY_NAME (CFBundleDisplayName).
  name: IOS_PROJECT_NAME,
  slug: 'fizz',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // D (the default look) is dark only (first-run audit B3): system alerts, sheets and the keyboard match it.
  userInterfaceStyle: 'dark',
  platforms: ['ios'],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    buildNumber,
    supportsTablet: false,
    infoPlist: {
      // Home-screen, SideStore and Settings name; the Xcode project stays IOS_PROJECT_NAME.
      CFBundleDisplayName: DISPLAY_NAME,
      ITSAppUsesNonExemptEncryption: false,
      // Shown by the AlarmKit permission prompt (probe "Request permission").
      // AlarmKit needs no entitlement (free-ios-install.md, AlarmKit row).
      NSAlarmKitUsageDescription: `${DISPLAY_NAME} can sound an alarm when your rest ends, even in silent mode or a Focus.`,
      // (Ben, 27 Oct; ADR 0035) Shown by the Health permission sheet when Ben turns a switch on in Profile › Apple Health.
      NSHealthShareUsageDescription: `${DISPLAY_NAME} reads your bodyweight and the workouts other apps save to Health, such as runs from Garmin, to show them with your training.`,
      NSHealthUpdateUsageDescription: `${DISPLAY_NAME} saves your finished gym workouts to Health as strength training.`,
      ...(backgroundAudioExperiment ? { UIBackgroundModes: ['audio'] } : {}),
    },
  },
  plugins,
  // Read at runtime by the capability probe (Metro can't import app-identity.mts).
  extra: { includeLiveActivity, liveActivityButtons, backgroundAudioExperiment, includeHealthKit, appGroupIdentifier: APP_GROUP_IDENTIFIER, displayName: DISPLAY_NAME },
};

// withFreeProvisioning wraps the config directly, so its mods are registered
// before the `plugins` array (and before Expo's automatic plugins such as
// expo-notifications). Expo runs mods newest-first, so it runs LAST and strips
// what the others added. Don't move it into `plugins`.
export default withFreeProvisioning(includeHealthKit ? withHealthKit(config) : config);
