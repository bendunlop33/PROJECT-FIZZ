# 0007: Mobile app shell, iOS identity and the cloud .ipa pipeline

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
- **The free-provisioning guard fails closed** (review S1). Any entitlement key not on `ALLOWED_ENTITLEMENTS` in `plugins/entitlement-rules.mts` is an error, not a warning. Adding a capability means deliberately checking that a free Apple ID can sign it and then editing the allowlist.
- **Builds are never cancelled** (review B3). The workflow's concurrency group is keyed on ref + commit SHA, with `cancel-in-progress: false`. A per-ref group cancelled the first `[ios-build]` run when a docs commit followed it, and even without cancel-in-progress GitHub drops a *pending* run in the same group. Checkouts use `persist-credentials: false`.
- **Live Activity is a build switch** (`FIZZ_LIVE_ACTIVITY=0`, a workflow checkbox), so a broken extension can't block every build.
- **Background audio is an opt-in experiment, default off** (ios-platform-feasibility.md rec. 6; review S6).
  - `FIZZ_BACKGROUND_AUDIO=1` adds `UIBackgroundModes: [audio]`. It is set by the workflow's "Background-audio experiment" checkbox, or by `[bg-audio]` in an `[ios-build]` commit message. The run summary shows whether it was on.
  - Only the probe's "Spoken cue while locked" row uses it. audio-coach loops silence (`startKeepAlive`) so iOS keeps the app running while locked. It refuses to start without the background mode.
  - This doesn't decide the product feature. If the experiment works, "spoken cues while locked" is still an explicit user setting with an honest fallback (notification sound, Live Activity, AlarmKit), and needs Ben's approval as a brief change.
- **One React copy:** root `overrides` pin `react` and `react-dom` to 19.2.3. `@expo/ui`'s web dependency (`vaul`) otherwise pulls React 19.3.0 into the root `node_modules`.
- **No `expo-dev-client` yet.** Release builds embed the JS bundle and work offline at the gym. A dev-client loop needs a reachable dev server, which isn't set up.

## Audio session ownership (review spec issue 2, proposed rule)

CLAUDE.md says one Swift module (`audio-coach`) owns the iOS audio session. Two Expo modules also touch it:
- `expo-speech-recognition` 57.1.0 calls `setCategory` and `setActive(true)` on every `start()`. Without `iosCategory` it uses `playAndRecord`, mode `.measurement`, `defaultToSpeaker` + `allowBluetooth`. It never deactivates the session afterwards.
- `expo-speech` sets up its own session.

**Proposed rule (Ben to approve; the spike is exempt because it measures the difference):**
1. `audio-coach` owns the session category, activation and deactivation at all times. No other code calls `setCategory` or `setActive`.
2. Production spoken cues go through `audio-coach.speak()` only. `expo-speech` stays probe-only.
3. Recognition runs inside a listening window that audio-coach opens and closes:
   - Opening: audio-coach configures `playAndRecord` with `allowBluetoothA2DP`, plus HFP only if the headset mic is wanted. It then starts the recognizer with an **identical** `iosCategory`, so the recognizer's own `setCategory` is a no-op.
   - During the window: cues wait in the queue.
   - Closing (on `end`/`error`): audio-coach reapplies `playback`, then deactivates with `notifyOthersOnDeactivation` so music returns.
4. If a library update changes its session behaviour, the probe's audio rows are the regression check.

## Known risks

- **SideStore may rename the App Group, which may break Live Activities** (review spec issue 1; free-ios-install.md §9 #3).
  - Two sides of the mismatch:
    - `expo-widgets` 57.0.23 reads the group from a build-time Info.plist key (`ExpoWidgetsAppGroupIdentifier`), set to `group.com.projectfizz.fizz`.
    - AltStore-family tools register `<group>.<TEAMID>` instead.
  - If they rename it:
    - `UserDefaults(suiteName:)` in the app and the extension falls back to an unshared domain;
    - the Live Activity renders blank or not at all;
    - `containerURL` for the configured group returns nil.
  - Also, `expo-file-system`'s `Paths.appleSharedContainers` can't show a rename. Its group list is baked in at `pod install` by autolinking from the build-time entitlements.
  - The `app_group` probe therefore reads the installed `embedded.mobileprovision` and `ALTAppGroups`, and reports one of: match, renamed (with suffix), missing, or unknown.
  - If the probe shows a rename, Ben chooses one of:
    - (a) a config plugin plus a small native patch that resolves the group at runtime (signed profile, `ALTAppGroups`, or prefix match);
    - (b) building with the suffixed group, which works only once the Team ID is known and stable;
    - (c) treating it as an upgrade trigger under ADR 0004.
- **The audio-coach Swift module, including the keep-alive and App Group code, has never been compiled.** The first macOS CI run is its compile test. `.allowBluetooth` is used for HFP. It was renamed `.allowBluetoothHFP` in the iOS 26 SDK, and the old name should only warn.

## Consequences
- Native or config changes need a cloud build. JS-only changes do too, until EAS Update or a dev client is set up.
- Local config modules use `.mts` so that Node loads them as ESM with type stripping. Metro doesn't resolve `.mts`, so app code reads the configured bundle ID from `expo-constants` instead of importing it.
- `scripts/check-entitlements.ts` needs Node 22.18+ (built-in type stripping). CI pins 22.22.0.
- **Revisit if:**
  - Expo fixes the `aps-environment` defaults (the guard plugin can stay as a backstop);
  - Ben moves to the paid programme (the push and time-sensitive rules would change then);
  - macOS build times exhaust the free minutes.
