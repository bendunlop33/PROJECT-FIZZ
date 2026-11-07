/**
 * The app's install identity. Single source of truth: app.config.ts, the
 * widget extension, the CI entitlement check and the IPA workflow all read
 * these values from here.
 *
 * NEVER CHANGE BUNDLE_IDENTIFIER AFTER BEN'S FIRST INSTALL (ADR 0004).
 * iOS identifies the app by Team ID + bundle ID. A different bundle ID
 * installs a second, separate app with an empty database; the old data is
 * only reachable through export/restore. The same applies to changing the
 * Apple ID or signing tool used in SideStore. Do not "customise App ID" in
 * SideStore either.
 *
 * If this must change before the first install, change it here only, and
 * update the frozen value in apps/mobile/test/app-identity.test.ts (that test exists to make a change deliberate) on purpose.
 */
export const BUNDLE_IDENTIFIER = 'com.projectfizz.fizz';

/**
 * The name Ben sees: under the home-screen icon, in SideStore, in Settings,
 * on notifications and in the app's own text. Set as CFBundleDisplayName.
 * Safe to change (does not affect identity or data). Approved 9 Oct 2026.
 */
export const DISPLAY_NAME = 'GymSmarter';

/**
 * Internal name: the Expo config `name`, which `expo prebuild` turns into the
 * Xcode project/scheme/target name (non-alphanumerics removed) and so
 * CFBundleName. Never shown to Ben (DISPLAY_NAME overrides it). The IPA
 * workflow (`IOS_PROJECT` env), scripts/ci/check-patched-binaries.sh and the
 * entitlement check use it to find `ios/<name>.xcworkspace` and `<name>.app`.
 * Keep it in step with `IOS_PROJECT` in .github/workflows/ios-ipa.yml.
 */
export const IOS_PROJECT_NAME = 'Fizz';

/** App Group shared with the Live Activity extension (expo-widgets default form). */
export const APP_GROUP_IDENTIFIER = `group.${BUNDLE_IDENTIFIER}`;

/** Bundle ID of the expo-widgets extension (expo-widgets default form). */
export const WIDGET_EXTENSION_BUNDLE_IDENTIFIER = `${BUNDLE_IDENTIFIER}.ExpoWidgetsTarget`;
