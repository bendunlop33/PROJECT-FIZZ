# Review: device spike part A, covering the mobile shell, capability probe, free-provisioning guard and cloud `.ipa` workflow

**Verdict: CHANGES NEEDED**

Reviewed: commits `b70b03b`..`b2b386d` plus `a3f705f` (ADR renumbered to 0007), 8 Oct 2026. The workflow at HEAD also contains `3acb74a` (branch-push trigger), which landed during the review. One finding (B3) comes from that commit and is marked as such.

Specs checked: CLAUDE.md (rule 3 not applied, per ADR 0006), ADR 0001, 0004, 0007, `docs/research/free-ios-install.md` (§1.2, §2, §8 probe list, §9 unknowns), `docs/research/ios-platform-feasibility.md` §2.5, `docs/guides/sidestore-windows.md`, `docs/guides/building-the-ipa.md`.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck root + mobile, eslint, vitest) | Clean. 24 files and 396 tests pass. |
| `npx expo prebuild --platform ios --no-install --clean` (scratch copy, default env) | OK. `Fizz.entitlements` and `ExpoWidgetsTarget.entitlements` each contain only `com.apple.security.application-groups = group.com.projectfizz.fizz`. `node scripts/check-entitlements.ts --prebuild` reports OK. |
| The same prebuild **without** `withFreeProvisioning` | `aps-environment` appears in `Fizz.entitlements` and the check fails with exit 1. This confirms the plugin does real work, runs last, and the check catches the problem. |
| Prebuild with `FIZZ_BUILD_NUMBER=42` | The app and the extension both get `CFBundleVersion` 42. |
| Prebuild with `FIZZ_LIVE_ACTIVITY=0` | No extension. The entitlements dict is empty, and the check passes with a "No entitlements" warning. |
| `expo-modules-autolinking resolve` | `audio-coach` (pod `AudioCoach`) is autolinked. |
| `npx expo export --platform ios` | Metro bundles 931 modules. Workspace packages resolve and there is one React copy (19.2.3, matching RN 0.86.3's peer and Expo's `bundledNativeModules`). |
| Action SHAs, checked with `git ls-remote` | checkout v7.0.1, setup-node v7.1.0, cache v6.1.0 and upload-artifact v7.0.2 all match their pinned SHAs. upload-artifact v7.0.2's `action.yml` has `archive` (single file, name taken from the file). |
| Expo Modules API, read from `node_modules/expo-modules-core` at SDK 57 | These exist with the signatures the Swift module uses: `Record`/`@Field`, `AsyncFunction` with a trailing `Promise`, `.runOnQueue(_:)`, `OnCreate`/`OnDestroy`, `Events`, `sendEvent(_:_:)`, `Promise.reject(_:_:)`. |
| Secrets/logging grep | No credentials and no `console.*` in `apps/mobile` or `scripts`. Signing-material globs are in `.gitignore`. |

Generated `ios/` directories were created only in the scratchpad and have been deleted. Nothing was generated in the repo.

The slice is solid overall. The entitlement guard works and has two layers (strip at prebuild, then check both the prebuild output and the signed binaries). The workflow is pinned, has least-privilege permissions, fails cheaply on Linux first, signs inside-out and packages `Payload/` correctly. The probe model can't be talked into a false PASS: `confirmObservation` only acts on `needs_check`, the S1 stub can't be overwritten, and the rest deadline passes only from a previous launch. All of these are tested. The blocking issues are about whether the first device run produces results Ben can actually use, plus one workflow regression at HEAD.

---

## Blocking

### B1. No App Group probe, so the Live Activity row's most likely failure can't be diagnosed
`apps/mobile/src/probe/model.ts:57-127` (the probe list); `apps/mobile/src/probe/runners.ts:274-298`

`free-ios-install.md` §8 says the probe should report "App Group container readable from the widget" and "installed bundle ID and team suffix". Unknown #3 in §9 asks whether `expo-widgets` still finds its group after the re-signing tool appends `.<TEAMID>`. I checked the installed `expo-widgets` 57.0.23 source:

- The group ID is read from Info.plist: `ios/WidgetsStorage.swift:2` uses `ExpoWidgetsAppGroupIdentifier`, and `ios/Widgets/TimelineProvider.swift:29` calls `fatalError` if that key is missing.
- Prebuild writes the static value `group.com.projectfizz.fizz` into both Info.plists.
- AltStore, and SideStore as its fork, register `group.com.projectfizz.fizz.<TEAMID>` instead (research §1.2 and the AltStore row).

Failure scenario:
1. Ben installs through SideStore.
2. The app's signed entitlements carry `group.com.projectfizz.fizz.ABCDE12345`.
3. `UserDefaults(suiteName: "group.com.projectfizz.fizz")` becomes an unshared local domain, so the extension never sees the layout.
4. The Live Activity is blank or doesn't render. Ben answers "No".

The report then shows `[FAIL] Live Activity` with no evidence of *why*. "The App Group isn't registered at all" and "it's registered under a renamed ID that expo-widgets doesn't know" need different fixes. Telling them apart is the point of the spike.

**Fix (JS only, no native change):** add an `app_group` probe that:
- reads `Paths.appleSharedContainers` from `expo-file-system`. It is already autolinked at 57.0.7; add it as a direct, pinned dependency. Its keys are the App Groups actually present in the signed entitlements, and its values are their container paths;
- compares those keys with `APP_GROUP_IDENTIFIER` (from `Constants.expoConfig`, as the bundle ID already is);
- writes and reads a file in the container;
- reports: configured group, signed groups, match or renamed, and container writable.

Also put the team suffix in the report header: the installed bundle ID minus the configured bundle ID. If reading `ALTAppGroups` from Info.plist is cheap (one `Bundle.main.object(forInfoDictionaryKey:)` in the audio-coach module), include it too.

### B2. Probe results live only in component state: the rest-deadline probe's required force-close, or a tap on Back, wipes every other result
`apps/mobile/src/screens/CapabilityProbeScreen.tsx:49`; `apps/mobile/App.tsx` (the probe screen unmounts on Back); `docs/guides/building-the-ipa.md` §5

`results` is `useState(initialResults)`, and nothing persists it. The guide asks for Notification → Rest deadline ("swipe the app away, reopen it") → Ducking. Failure scenario:
1. Ben runs Notification and confirms "Yes".
2. He runs SQLite, Keychain and TTS, and answers each.
3. He runs Rest deadline and force-closes as told.
4. On reopening, only `rest_deadline` has a result. Every confirmed observation is gone, and the Export he sends shows "not run" for the probes he already did.

Tapping **‹ Back** and returning does the same thing. Answers that need Ben's eyes and ears are the costly ones to repeat, especially the notification-while-locked check and ducking with music.

**Fix:** persist `ProbeResults` in the existing probe DB (`probe_kv`, key `probe_results`). Write it after every `apply`/`confirmObservation`, and load it on mount. The rest-deadline recovery then overwrites only its own row. Validate the stored JSON as untrusted, the same way `recoverProbeRest` already does. At minimum, if this is deferred, add "Tap Export before swiping the app away" to the rest-deadline `howTo` and to the guide.

### B3. (From `3acb74a`, at HEAD) `cancel-in-progress` together with branch-push triggers cancels in-flight macOS builds
`.github/workflows/ios-ipa.yml:23-31`, `:64` (`if:` on `build`)

The concurrency group is `ios-ipa-${{ github.ref }}` with `cancel-in-progress: true`. Branch pushes to `claude/**` now trigger the workflow, and only `[ios-build]` commits run the macOS job.

Failure scenario:
1. An agent pushes `[ios-build]`, and the 15–40 minute macOS build starts.
2. Any agent pushes a docs commit to the same branch. This is routine here: design docs were being edited during this review.
3. The new run joins the same group and cancels the build.
4. The new run's own `build` job is skipped because it has no `[ios-build]`.

The result is no `.ipa`, with the macOS minutes already spent.

**Fix:** don't cancel builds. Either:
- `cancel-in-progress: ${{ !contains(github.event.head_commit.message, '[ios-build]') && !startsWith(github.ref, 'refs/tags/') }}`; or
- give the build its own group keyed on `github.sha`; or
- simply use `cancel-in-progress: false`.

---

## Should fix

### S1. Unknown entitlements only warn, so the "free-provisionable" guarantee is a deny-list
`apps/mobile/plugins/entitlement-rules.mts:37-43, 62-63`

The five families in the brief (push, time-sensitive, Siri, iCloud, Associated Domains) are all covered, stripped and tested, and I found no way for those keys to slip through. Anything else is only a `warning`, and CI goes green.

Failure scenario: a future plugin adds `com.apple.developer.applesignin`, `com.apple.developer.usernotifications.communication`, `com.apple.developer.push-to-talk` or `com.apple.developer.in-app-payments`. None of these is provisionable on a Personal Team, as far as the research's secondary sources indicate. The workflow uploads an `.ipa` that SideStore then refuses to sign, and the warning is buried in the step log.

**Fix:** fail closed. Make any `com.apple.developer.*` key that isn't on an explicit allowlist an error, so a deliberate allowlist edit is needed to add one. Keep the warning only for non-`com.apple.developer` keys. Add a test for one unknown `com.apple.developer.*` key.

### S2. `speak()` deactivates the session per utterance, which breaks overlapping cues and can leave the promise hanging
`apps/mobile/modules/audio-coach/ios/AudioCoachModule.swift:99-119`

There are two problems.

**Overlapping cues.** Suppose two cues are queued: a second `speak` arrives while the first is still talking, or the JS side calls it twice. The first `didFinish` calls `setActive(false, …)` while the synthesizer is still playing the second. That either fails with `AVAudioSession` "busy", which gets reported as `deactivationError` and leaves music ducked, or cuts the second cue.

**Hanging promise.** If the synthesizer never calls back, the promise never settles. That can happen with an empty string, or when an interruption tears down the session. In the probe, `runAudioCoachProbe` then stays RUNNING.

**Fix:**
- Deactivate only when `!synthesizer.isSpeaking` and no completions are pending (keep a counter in `CueDelegate`).
- Reject empty text up front.
- Add a native or JS-side timeout, for example `max(10 s, 0.15 s × characters)`, that resolves `finished: false`.

### S3. The `playAndRecord` path drops Bluetooth output
`AudioCoachModule.swift:159-161`

`.playAndRecord` sets `.defaultToSpeaker` but neither `.allowBluetoothA2DP` nor `.allowBluetoothHFP` (named `.allowBluetooth` before the iOS 26 SDK). Under `playAndRecord`, A2DP output has to be opted into explicitly.

Failure scenario: Ben is wearing AirPods while the voice strip is listening, and the cue plays from the phone's loudspeaker in the gym.

The probe only uses `playback`, so this doesn't affect part A's results. It will matter as soon as voice logging uses this module. **Fix:** add `.allowBluetoothA2DP`. Add HFP only if the mic should come from the headset, and test both routes on device.

### S4. TTS and speech-recognition probes can stick in RUNNING
`apps/mobile/src/probe/runners.ts:186-206` and `:325-367`

- `Speech.speak` has no `onStopped` handler. A phone call or Siri interruption cancels the utterance, `onDone` never fires, and the Run button stays disabled until the screen remounts, which with B2 wipes all results.
- In the speech probe, the 8 s timeout calls `stop()` but never `finish`. If no `end` event follows (a start failure that doesn't emit `error`), the promise never settles.
- `ExpoSpeechRecognitionModule.start` and `Speech.speak` are called inside a Promise executor. A synchronous throw rejects `run()`, which is `void`ed in the screen, so the status stays RUNNING with no message.

**Fix:**
- Add `onStopped` → `fail`/`not_run`.
- After `stop()`, add a 2 s fallback `finish(fromTranscript())`.
- Wrap each runner call in `run()` with try/catch → `fail`.

### S5. The workflow leaves the `GITHUB_TOKEN` in `.git/config` for every later step
`.github/workflows/ios-ipa.yml` (both `actions/checkout` steps)

`npm ci` then runs install scripts from about 1,000 third-party packages with the token readable. It is only `contents: read`, but on a private repo that is still read access to the source. **Fix:** add `persist-credentials: false` to both checkouts. Nothing later in the workflow uses git credentials.

### S6. The probe doesn't exercise what the audio module is for: interruptions, route changes and locked-screen cues
`apps/mobile/src/probe/runners.ts:210-240`; `app.config.ts` (no `UIBackgroundModes`)

The module emits `onInterruption` and `onRouteChange`, but nothing subscribes to them, so the export never records whether they fire. Research §2.5 lists "Bluetooth disconnect during a cue", and S7 includes "with the screen locked". Without the `audio` background mode, the locked-screen half of S7 can't be tested, and the §8 item "background audio session active" isn't covered. These may be planned for part B. If so, say so in the probe's `howTo` or the ADR so the first device report isn't read as complete.

**Minimal fix:** while the probe screen is mounted, subscribe to both events and append them, with timestamps, to the `audio_coach` details.

### S7. A spoken-cue PASS says nothing about the build that saved the rest; the AlarmKit row passes on "denied"
- `rest-probe.ts`: a rest saved by a previous build is reported as PASS after installing a new build. That shows real survival, which is useful, but the report doesn't say which build saved it. **Fix:** store `buildNumber` in `StoredProbeRest` and print "saved by build N".
- `runners.ts:252-259`: `alarmkit` returns `pass` for any authorization string, including `denied`. "Framework present" is what passed, so make that the title, or return `unavailable` or `needs_check` for `denied`, so the totals don't count it as a working alarm path.

---

## Nits

- **N1. The bundle-ID guard checks a value against itself** (`scripts/check-entitlements.ts:179-196, 155-164`). The CI check compares the build against `app-identity.mts`, so a change there plus the one-line test change passes everything. That's acceptable before the first install, which is what ADR 0007 intends. After Ben installs, consider adding a frozen literal in `check-entitlements.ts`, or a committed `installed-identity.json`, that the workflow compares against.
- **N2. Hard-coded Xcode path** (`ios-ipa.yml:35, 76`). `/Applications/Xcode_26.6.app` is hard-coded. If the `macos-26` image moves to 26.7, the job fails at "Select Xcode" with a bare `xcode-select` error. Add `ls /Applications | grep Xcode` to the failure output, or fall back to the newest 26.x.
- **N3. No check that the extension was built** (`ios-ipa.yml:134`). With `FIZZ_LIVE_ACTIVITY=1`, nothing asserts that `PlugIns/ExpoWidgetsTarget.appex` exists. If the extension silently isn't embedded, the build is green and the probe shows a confusing failure. Add `test -d` when the flag is 1.
- **N4. Live Activity is never ended** (`runners.ts:281-285`). It is started without `staleDate` and never ended, so a 0:00 countdown can stay on the Lock Screen for hours. Pass `staleDate = endsAt`, or end it after the duration.
- **N5. Notification probe can't tell where the alert was seen** (`runners.ts:149-152, 154-182`). Foreground presentation is on (`shouldShowBanner: true`), so Ben could see the banner without locking and still answer "Yes" to "while locked". Record `AppState.currentState` from `addNotificationReceivedListener` and append it to the details.
- **N6. Node version floor** (`package.json`). `engines.node` is `>=22.13.0`, but `scripts/check-entitlements.ts` needs 22.18+ (type stripping). Raise the floor to `>=22.18.0`.
- **N7. `stop` return type** (`AudioCoachModule.swift`). `AsyncFunction("stop")` returns the `Bool` from `stopSpeaking`, while the TS type says `Promise<void>`. It's harmless; add `_ =` for clarity.
- **N8. Cache key** (`ios-ipa.yml`). The Pods cache key includes `package-lock.json` (good) but not `FIZZ_LIVE_ACTIVITY`. That's fine today because the pod set is identical. Note it if the extension ever adds pods.

## Things I checked and found correct

- **Plugin ordering.** `withFreeProvisioning` wraps the config, so its mods run after the `plugins` array and after the automatic plugins. I confirmed this empirically: removing it reintroduces `aps-environment`.
- **Entitlement check scope.** The checker scans every `*.entitlements` file outside `Pods/`, so an extension's file written by another plugin is still checked.
- **Signed-binary check.** It reads the actual embedded signatures of the `.app` and every `.appex` (`codesign -d --entitlements - --xml`) plus the built Info.plist, including `CFBundleIdentifier`.
- **Signing order.** Frameworks, then appex (with `ExpoWidgetsTarget/ExpoWidgetsTarget.entitlements`; the path matches what prebuild generates), then the app with `Fizz/Fizz.entitlements`, then `codesign --verify --deep --strict`.
- **Packaging.** The `.ipa` is `Payload/Fizz.app`, zipped with `-y` (symlinks preserved), uploaded with `archive: false` and `if-no-files-found: error`. The build log is uploaded on failure.
- **Workflow basics.** `permissions: contents: read`, no secrets used, timeouts of 15 and 60 minutes, and the Linux gate before macOS.
- **Build size.** Prebuilt RN core and precompiled Expo modules are on by default in the generated Podfile, so build minutes stay reasonable.
- **Probe honesty.** Rest deadline: PASS only when `fromPreviousLaunch`, and the details say force-close can't be told apart from a normal quit. Ducking with no music returns `not_run`, not pass. Speech recognition requires on-device and doesn't fall back to the server. TTS reports that "done" doesn't prove sound. S1 is shown as not implemented.
- **Permissions.** Notification, microphone and speech permissions are requested only when their Run is tapped. AlarmKit is detect-only. Usage strings are present.
- **Stored state.** The stored rest is parsed as untrusted (JSON, shape, then `RestTimerSchema`). Keychain uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The probe DB is separate from workout data.
- **Metro.** It watches the root, resolves root `node_modules` and blocks `.claude/` worktrees. The `react`/`react-dom` overrides leave one React copy.
- **Swift module.** Category and options match research §2.5: `playback` + `.voicePrompt` + `duckOthers` + `interruptSpokenAudioAndMixWithOthers`, deactivated with `notifyOthersOnDeactivation`. AlarmKit is weak-linked and gated by `#if canImport` and `#available(iOS 26.0, *)`. Matching `switch` on an optional enum case is valid Swift. I found no API mismatches against SDK 57 `expo-modules-core`. The module has never been compiled, as its header says. The first CI run is its real test.

## Spec issues

1. **SideStore App Group renaming vs `expo-widgets` (ADR 0004, research §9 #3).** Based on the source reading in B1, Live Activities through SideStore are likely to fail *by construction*, not by chance. `expo-widgets` takes its group from a build-time Info.plist key, while AltStore and SideStore rewrite the signed group to `<group>.<TEAMID>`. If the B1 probe confirms the rename, the options are:
   - a config plugin plus a small native patch that resolves the group at runtime from the signed entitlements, `ALTAppGroups`, or a prefix match;
   - building with the team-suffixed group, which is only possible once the Team ID is known and stable;
   - treating it as an upgrade trigger under ADR 0004.

   This needs Ben's decision once the device result is in. It should be recorded as a known risk in ADR 0007 now.
2. **"One Swift module owns the iOS audio session" (CLAUDE.md stack; research rec. 5) vs the probe's use of `expo-speech` and `expo-speech-recognition`.** Both of these set the session themselves. That's reasonable for a spike whose job is to measure the difference. But the brief should state which module owns the session during recognition. `expo-speech-recognition` will switch to `playAndRecord` on its own unless it is configured not to, which conflicts with the rule as written.
3. **CLAUDE.md rule 3 vs ADR 0006/brief v0.4.** Rule 3 still says "Numerical targets come from deterministic … rules, not the model". This slice doesn't touch it, and per the brief it wasn't assessed. It still needs a CLAUDE.md update approved by Ben.

---

# Re-review after fixes

**Verdict: PASS**

Reviewed on 8 Oct 2026 at `85b3b13`. The fixes actually start at `bf1c92a`, not `c678adf`. B3/S5 are in `bf1c92a`, S1 is in `1b119d6` and B2 is in `02fbc92`, so I reviewed `8b83412..85b3b13` and skipped the docs-only commits `3355e99` and `2ab187d`. The macOS CI run for `85b3b13` is still in progress, so the Swift was judged statically.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Clean: typecheck, eslint, 27 files / 435 tests pass. |
| Prebuild in a scratch copy (default env) + `check-entitlements.ts --prebuild` | OK. `Fizz.entitlements` and `ExpoWidgetsTarget.entitlements` each contain only `com.apple.security.application-groups = [group.com.projectfizz.fizz]`. There is no `UIBackgroundModes`. |
| Prebuild with `FIZZ_BACKGROUND_AUDIO=1` | `UIBackgroundModes = [audio]` is in the app's Info.plist only, not the extension's. The entitlement check still passes. |
| `com.apple.developer.applesignin` injected into the generated `Fizz.entitlements` | The check exits 1 with an "allowlist" error. The guard fails closed. |
| `expo config --type public` | `extra` carries `includeLiveActivity`, `backgroundAudioExperiment: false` and `appGroupIdentifier: group.com.projectfizz.fizz`, which the probe reads at runtime. |
| `expo-modules-autolinking` `apple.js:234` and `expo-modules-core` `AppCodeSignEntitlements` | These confirm the developer's claim that `Paths.appleSharedContainers` is built from **build-time** entitlements. It can't show a SideStore rename. |
| `expo-widgets` `start(props, url?, staleDate?)` | The N4 fix uses the real signature. |
| Logging/secrets grep over the changed files | No `console`/`print`/`NSLog` in app or module code, and no credentials. |

Scratch output was deleted, and no generated files are in the repo.

## Previous findings

| ID | Status | Notes |
|---|---|---|
| B1 App Group probe | **Fixed (better than suggested)** | New native `getAppGroupInfo`, plus pure `analyseAppGroup` with match / renamed / missing / unknown. See the deviation below. |
| B2 Results lost on Back/force-close | **Fixed** | `results-store.ts` holds module-level state and serialises writes to `probe_kv`. The load merges by `atUtc`. Restored rows are validated per row, a saved `running` row comes back as "Interrupted", not as a result, and the S1 stub can't be overwritten. A persist error is shown in red. Tested in `probe-model.test.ts:99-180`. |
| B3 Cancelled builds | **Fixed** | Group `ios-ipa-<ref>-<sha>`, `cancel-in-progress: false`. See the deviation below. |
| S1 Deny-list | **Fixed** | `ALLOWED_ENTITLEMENTS` makes every key not on the list an error, including non-`com.apple.developer` keys, which is stricter than I asked for. Tested with four unknown keys, and I confirmed it end to end above. The allowlist (app-groups, keychain-access-groups, application-identifier, team-identifier, get-task-allow) is minimal, and each entry is justified. |
| S2 Overlapping cues / hang | **Fixed** | A `CueDelegate` map settles each cue once. The session is deactivated only when nothing is pending and the keep-alive is off. Empty text is rejected. A cumulative per-cue timeout is backed by a 30 s JS `withTimeout`. `stop()` settles every queued cue. |
| S3 Bluetooth under playAndRecord | **Fixed** | `.allowBluetoothA2DP` is always set. HFP is opt-in (`bluetoothMicrophone`). |
| S4 Stuck RUNNING | **Fixed** | TTS has `onStopped` and a 20 s backstop. Speech has a 2 s fallback after `stop()`, and sync throws are caught. `run()` wraps everything in try/catch, so it always reaches a terminal state. |
| S5 Persisted token | **Fixed** | `persist-credentials: false` on both checkouts. |
| S6 Interruptions/route/locked | **Fixed** | An `audio_events` row is subscribed while the screen is mounted. There is also an opt-in `locked_cue` row (deviation below). |
| S7 Build provenance / AlarmKit | **Fixed** | `buildNumber` is stored, validated as untrusted, and shown as "saved by build N". `judgeAlarmKitStatus` gives denied → unavailable, notDetermined → not_run, and an unknown state → fail. |
| N2, N3, N4, N5, N6, N7, N8 | **Fixed** | Xcode path check with a listing; `.appex` existence check; `staleDate` plus an end timer; a foreground-delivery note on the notification row; Node `>=22.18.0`; `_ =` on `stopSpeaking`; a cache-key comment. |
| N1 | Deferred, as agreed | Until the first install. |

## Deviations

- **App Group probe reads `embedded.mobileprovision` and `ALTAppGroups` natively: accepted.** It is the right call, because the JS-only route I suggested can't see a rename (verified above). On honesty:
  - A PASS needs the configured group in the installed profile **and** a successful write/read in its container. On iOS, `containerURL` returns nil for a group the binary isn't entitled to.
  - A rename or a missing group is always FAIL.
  - Without a profile, the result can only pass on container access, and it says "Rename could not be checked".
  - Malformed native replies become `unknown`.

  I found no false-PASS path for the **app** side (see F2 for the extension side).
- **Concurrency keyed on ref + SHA with `cancel-in-progress: false`: accepted.** The ADR's reasoning is correct: a per-ref group without cancel still drops a *pending* run. The cost is that a superseded `[ios-build]` still runs to completion, which is acceptable at this volume. Two runs of the same SHA and ref (push plus dispatch) share a group and queue rather than cancel.
- **Default-off `FIZZ_BACKGROUND_AUDIO`: accepted.** It is off unless the checkbox is ticked or `[bg-audio]` is in the message, and the run summary shows whether it was on.
  - The `${{ }}` use of `head_commit.message` is in `env:`, not in a shell line, so it can't be injected.
  - `startKeepAlive` refuses to run without the background mode. Only the probe calls it, and the JS path always calls `stopKeepAlive` in `finally` (but see F3).
  - `UIBackgroundModes` isn't an entitlement, so free provisioning is unaffected.
  - ADR 0007 correctly says this doesn't decide the product feature.

## Swift compile plausibility (iOS 26 SDK, Swift 5.9 language mode)

I found nothing I expect to be a compile error:
- `MainActor.assumeIsolated` (iOS 17+) sits inside `#available(iOS 26.0, *)`, and its `String` result is Sendable.
- `UnsafeMutablePointer.update(repeating:count:)` (SE-0370) exists.
- `scheduleBuffer(_:at:options:)` in a sync context resolves to the completion-handler overload.
- `Data.range(of:in:)` uses the defaulted `options`.
- `try? … as? [String: Any]` flattens.
- The optional-closure call `removeValue(forKey:)?(outcome)` is valid.
- `DispatchTime + Double` is valid.
- Throwing `AsyncFunction` closures are supported.
- `.allowBluetooth` only gives a deprecation warning. `expo-speech-recognition` 57.1.0, which is built in the same project, uses the same symbol (`ExpoSpeechRecognizer.swift:628`).

I expect Sendable warnings, which are not errors in Swift 5 mode, in two places: the `@Sendable` NotificationCenter/`asyncAfter` closures capturing `self`/`utterance`, and `AVSpeechSynthesizerDelegate` conformance on a non-isolated class.

## Blocking

None.

## Follow-ups (non-blocking, most important first)

- **F1. The `audio_events` row can PASS without any interruption being tested** (`apps/mobile/src/probe/model.ts:204-215`).
  - Scenario: the probe's own `configureSession` or speech start causes a `categoryChange` route event, so the row shows PASS and counts in the totals as passed, but interruptions were never tested.
  - The details list each event, so a reader can tell, but the badge overstates it.
  - Fix: give PASS only once an `interruption began` and its `ended` have been seen, and show route-only events as `needs_check`. Or rename the row to "observers fire".
- **F2. App Group PASS covers the app, not the extension** (`apps/mobile/src/probe/app-group.ts:123-126`). The extension gets its own profile from SideStore and could lack the group, or carry a differently renamed one, while the app row passes.
  - Fix: also parse `Bundle.main.builtInPlugInsURL/ExpoWidgetsTarget.appex/embedded.mobileprovision`. It is the same code and cheap.
  - At minimum, add "extension not checked; the Live Activity row is the end-to-end test" to the PASS details.
- **F3. Keep-alive can be orphaned** (`apps/mobile/src/probe/runners.ts:357-361`).
  - Scenario: if `startKeepAlive` exceeds the 30 s JS timeout but then succeeds natively, the catch path skips `stopKeepAlive`. The silent loop then keeps the app alive in the background, and spoken audio (podcasts) stays paused because of `interruptSpokenAudioAndMixWithOthers`.
  - The same applies natively (`AudioCoachModule.swift:201,217`): if `engine.start()` throws after `setActive(true)`, the session stays active.
  - Fix: call `stopKeepAlive` in the outer catch, and in Swift deactivate on the throw path.
- **F4. The locked cue is never ducked, but the report text implies it is** (`apps/mobile/src/probe/locked-cue.ts:35`; `runners.ts:353`; `AudioCoachModule.swift:131-133` skips `applyCategory` while the keep-alive runs).
  - The detail says "no ducking while idle", which suggests ducking happens during the cue. In fact the cue mixes over music at full volume.
  - Fix the wording ("cue is not ducked in this experiment"). A future fix could switch options to `duckOthers` and reactivate around the cue.
- **F5. The cue timeout ignores `rate`** (`AudioCoachModule.swift:149`). `0.15 s/char` with `rate: 0.5` can be shorter than real speech. The timeout path then calls `stopSpeaking` and truncates a genuine cue, which is reported honestly as `timedOut`. Fix: divide the budget by `min(rate, 1)`.
- **F6. A transient read error lets the next write overwrite the saved results** (`apps/mobile/src/probe/results-store.ts:75` vs `:99`). The comment says the saved copy "may still be fine", but `loaded` is set to true, so the next `updateResults` persists fresh rows over it. Fix: keep a `readFailed` flag and skip persisting (with `persistError` shown) until the read succeeds, or retry it.
- **F7. Minor native state issues.**
  - `queueDrainsAt` isn't reset in `stop()`, so later timeouts are only lengthened.
  - `configureSession` (`:115`) applies the category even while a cue or the keep-alive is playing. `speak` already guards against this, and `configureSession` should too.
- **F8. No tests for the impure results store.** Write ordering and the load race in `results-store.ts` are covered only indirectly, through the pure `mergeNewer` and `restoreResults`. Add one test with a fake `putProbeValue`: two quick updates should land in order.

## Spec issues

- Previous items 2 and 3 are unchanged. ADR 0007 now proposes a concrete audio-session ownership rule. That is a good basis for Ben's decision, but it is still "proposed", and CLAUDE.md still says only "one Swift module owns the session".
- Previous item 1 (the SideStore App Group rename) is now recorded in ADR 0007 "Known risks" with options (a)–(c), which resolves my request. Ben's decision waits for the device result.
