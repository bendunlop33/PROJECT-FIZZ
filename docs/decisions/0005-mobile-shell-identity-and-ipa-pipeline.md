# 0005: Mobile app shell, iOS identity and the cloud .ipa pipeline

**Status:** Proposed, 2026-10-08. Ben to confirm the bundle ID before the first install.

## Context
ADR 0004 chose a free Apple ID + SideStore, with a GitHub Actions build of an unsigned `.ipa`. Building step 1 of the device spike raised these points:
- the app needs a permanent identity;
- two Expo modules add a push entitlement on their own;
- the pipeline has to stay within free minutes.

## Decision
- **Identity:** the bundle ID is `com.projectfizz.fizz`. It is defined once, in `apps/mobile/app-identity.mts`. The following all read it from there:
  - `app.config.ts`;
  - the widget extension ID (`<id>.ExpoWidgetsTarget`) and App Group (`group.<id>`);
  - the CI check.

  A test freezes the value, and the CI check fails if the built app's ID differs. It never changes after the first install.
- **Free-provisioning guard:** a local config plugin (`plugins/with-free-provisioning.mts`) strips forbidden entitlements after every other plugin has run. It is applied directly to the config so that it runs last. It is needed because:
  - expo-notifications 57.0.22 always adds `aps-environment`;
  - expo-widgets 57.0.23 also adds it even when `enablePushNotifications` is false, which contradicts its docs.

  `scripts/check-entitlements.ts` uses the same rule list (`plugins/entitlement-rules.mts`) to check twice:
  - the prebuild output;
  - the entitlements embedded in the signed `.app`/`.appex`.
- **Pipeline:**
  - A Linux job runs first: `npm run check`, prebuild, and the entitlement check. A failure there spends no macOS minutes.
  - A macOS 26 job (Xcode 26.6) then builds Release for `iphoneos` with signing off. It ad hoc signs the app inside-out with its entitlements, so that SideStore can see the App Group (free-ios-install.md §2), and checks the result again.
  - The `.ipa` is uploaded unzipped (`upload-artifact` v7.0.2, `archive: false`).
  - Actions are pinned to commit SHAs. CocoaPods is cached.
- **Live Activity is a build switch** (`FIZZ_LIVE_ACTIVITY=0`, a workflow checkbox), so a broken extension can't block every build.
- **One React copy:** root `overrides` pin `react` and `react-dom` to 19.2.3. `@expo/ui`'s web dependency (`vaul`) otherwise pulls React 19.3.0 into the root `node_modules`.
- **No `expo-dev-client` yet.** Release builds embed the JS bundle and work offline at the gym. A dev-client loop needs a reachable dev server, which isn't set up.

## Consequences
- Native or config changes need a cloud build. JS-only changes do too, until EAS Update or a dev client is set up.
- Local config modules use `.mts` so that Node loads them as ESM with type stripping. Metro doesn't resolve `.mts`, so app code reads the configured bundle ID from `expo-constants` instead of importing it.
- `scripts/check-entitlements.ts` needs Node 22.18+ (built-in type stripping). CI pins 22.22.0.
- **Revisit if:**
  - Expo fixes the `aps-environment` defaults (the guard plugin can stay as a backstop);
  - Ben moves to the paid programme (the push and time-sensitive rules would change then);
  - macOS build times exhaust the free minutes.
