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

## App Group: resolved at runtime (SideStore rename)

**Status:** implemented for the build after build 7, 8 Oct 2026; Ben to confirm. This takes option (a) from the earlier "Known risks" entry.

**What build 7 showed** (`docs/device-tests/2026-10-08-probe-build7.md`):
- SideStore signed the app with `group.com.projectfizz.fizz.<TEAMID>` and listed it in `ALTAppGroups`. The renamed group's container was writable.
- `expo-widgets` read the build-time group (`group.com.projectfizz.fizz`), found no container, and no Live Activity appeared.

**How `expo-widgets` 57.0.23 reads the group** (checked in `node_modules`):
- Everything shared goes through `WidgetsStorage` (`ios/WidgetsStorage.swift`): `public static var appGroupIdentifier` is read once from the Info.plist key `ExpoWidgetsAppGroupIdentifier`, and `static let defaults = UserDefaults(suiteName: appGroupIdentifier)`.
- The app side (layout written by `LiveActivityFactory`, `WidgetObject`, the `widgetsDirectory` constant) and the extension side (`getLiveActivityNodes`, `EntryView`, `AppIntent`) all use `WidgetsStorage`.
- `TimelineProvider` also reads the Info.plist key, but only nil-checks it; `parseTimeline` ignores the value it is passed.
- The app and the extension both compile the same pod source. The extension target links it through `use_expo_modules_widgets!`.

**Route chosen: a pinned patch with `patch-package`** (`patches/expo-widgets+57.0.23.patch`, root `postinstall: patch-package --error-on-fail --error-on-warn`, `patch-package` 8.0.1 pinned).
- The patch changes one file. `appGroupIdentifier` is initialised by `FizzAppGroupResolver.resolve()`, which runs once per process (app and extension) and tries, in order:
  1. `ALTAppGroups` in that bundle's own Info.plist;
  2. in the extension only, `ALTAppGroups` in the parent app's Info.plist, as a fallback in case a signing tool only updates the app;
  3. the configured build-time group.
- From `ALTAppGroups` it takes only the configured group or `<configured>.<suffix>`, and only if `containerURL` resolves, which means this binary is entitled to it. The app and the extension therefore pick the same group whenever both are entitled to it.
- It writes its choice (group, source, bundle ID, build number, time) to that group's shared defaults under `fizz.appGroupResolution.app` or `.extension`. The probe reads both records.
- Alternatives considered:
  - A config plugin that injects code into the generated extension `index.swift`. This covers only the extension; the app side would also need a native shim that sets `WidgetsStorage.appGroupIdentifier` before first use, and that ordering is fragile.
  - Our own shim module. It would duplicate `WidgetsStorage`.
  - Building with the suffixed group (option b). This needs the Team ID baked in, and breaks if the Apple ID changes.
- Guards against the patch silently not applying:
  - `scripts/test/native-patches.test.ts`, run by `npm run check`, fails in these cases: the patch isn't applied; `expo-widgets` isn't 57.0.23; another file reads the Info.plist key for real use; or `expo-widgets` ships a `prebuilds/` xcframework. Expo's Podfile turns on `EXPO_USE_PRECOMPILED_MODULES` by default, and a precompiled binary would ignore the patched source. Today `expo-widgets` has no prebuilds, so it is compiled from source.
  - `patch-package --error-on-warn` fails `npm ci` if the installed version differs from the patch.
  - The macOS job runs `scripts/ci/check-patched-binaries.sh`, and checks that `NSSupportsLiveActivities` is true.
    - The script looks for strings only the patch contains: the `parentAltAppGroups` literal and the `FizzAppGroupResolver` type name.
    - It searches every Mach-O the app and the extension run, not just their main executables. That includes other Mach-O files in the bundle, such as an Xcode debug dylib, and the `@rpath` libraries they load, resolved through `LC_RPATH`.
    - It prints what it searched, and diagnostics on failure.
    - Build 8's first version grepped only each bundle's main executable. It passed for the app but failed for the extension, and the reason isn't known yet: the extension does link ExpoWidgets statically (`use_expo_modules_widgets!`).
- **Upgrade rule:** when `expo-widgets` changes, re-read its group handling and remake the patch, or drop it if upstream resolves the group at runtime. Worth proposing upstream.

**Does SideStore update `ALTAppGroups` in the extension too?**
- AltStore's source says yes ([Community] `rileytestut/AltStore` develop):
  - `FetchProvisioningProfilesOperation` registers an App ID per extension. It registers `<group>.<TEAMID>` for every group in that extension's own signed entitlements, and assigns the group to that App ID.
  - `ResignAppOperation.prepareAppBundle` runs `prepare(_:)` on the app and on every bundle in `PlugIns/`. Each bundle's `ALTAppGroups` is set from its **own** profile's `application-groups`.
  - Extension bundle IDs keep the parent prefix (`com.projectfizz.fizz.<TEAMID>.ExpoWidgetsTarget`).
- SideStore is a fork. Its source files couldn't be fetched from this environment, but the build-7 app-side result matches AltStore's behaviour. The probe now checks the extension on the device, so this doesn't rest on the source reading.
- This depends on CI ad hoc signing the `.appex` with `ExpoWidgetsTarget.entitlements`, which it already does. Without that, the tool sees no groups to register.

**Other things that could block the Live Activity on a free account:**
- `NSSupportsLiveActivities` must be on the **app** target. `expo-widgets` sets it there, and CI now asserts it.
- The extension could be missing from the installed app. SideStore has a remove-extensions operation (`RemoveAppExtensionsOperation`) to save App IDs on free accounts. The probe now reports whether `PlugIns/ExpoWidgetsTarget.appex` is present.
- The extension's App ID counts against the 10-per-week limit (research §1.2).
- AltStore counts extensions against the 3-active-apps limit only below iOS 13.5, so this doesn't apply on iOS 26.
- Live Activities can be switched off in Settings. The probe reports `areActivitiesEnabled`.
- Push type must be nil. This is already the case (`enablePushNotifications: false`).
- Rendering inside the extension (the widget JS runtime, memory) is untested. The Live Activity row is the end-to-end check.

**Probe:** the `app_group` row PASSes only if both of these hold:
- the app can write the group's container (the configured group, or the renamed group the app resolved at runtime);
- the extension is present, its own `embedded.mobileprovision` includes that group (review F2), and its runtime record from this build names the same group.

The extension's record exists only after the extension has run, so the row says "run Live Activity, then App Group again" until it has. A rename that is handled is reported as "renamed (handled at runtime)".

## Known risks

- **The App Group fix above has not run on a device yet.** The next build is its test. If the extension's record never appears even though the countdown shows, or the countdown still doesn't show, the fallbacks are option (b) (build with the suffixed group) or (c) (an upgrade trigger under ADR 0004).
- `expo-file-system`'s `Paths.appleSharedContainers` can't show a rename. Its group list is baked in at `pod install` by autolinking from the build-time entitlements. Production code that needs the shared container must use the runtime-resolved group, not this list.
- **Swift written without a Mac.** The audio-coach module compiled and ran in build 7. These have not been compiled yet, and the next macOS CI run is their compile test:
  - the `expo-widgets` patch;
  - the audio-coach additions: extension evidence, `requestAlarmKitAuthorization`, and the keep-alive and timeout fixes.

  `.allowBluetooth` is used for HFP. It was renamed `.allowBluetoothHFP` in the iOS 26 SDK, and the old name should only warn.

## Consequences
- Native or config changes need a cloud build. JS-only changes do too, until EAS Update or a dev client is set up.
- Local config modules use `.mts` so that Node loads them as ESM with type stripping. Metro doesn't resolve `.mts`, so app code reads the configured bundle ID from `expo-constants` instead of importing it.
- `scripts/check-entitlements.ts` needs Node 22.18+ (built-in type stripping). CI pins 22.22.0.
- **Revisit if:**
  - Expo fixes the `aps-environment` defaults (the guard plugin can stay as a backstop);
  - Ben moves to the paid programme (the push and time-sensitive rules would change then);
  - macOS build times exhaust the free minutes.
