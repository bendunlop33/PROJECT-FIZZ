# iOS platform feasibility: Expo stack, distribution without a Mac, FitNotes CSV

Researcher, checked 2026-10-08. All sources were read on 2026-10-08 unless stated. Nothing was installed, built or signed up for. Labels: **[Doc]** = official documentation. **[Anecdote]** = forum, review or third-party report. **[Inference]** = my reasoning, not yet proven.

## Summary

1. The Expo stack is feasible for every capability in scope. Use **Expo SDK 57** (stable, `expo@57.0.27`). SDK 58 is still beta and has breaking changes.
2. The hard part is **audio while the phone is locked.** A suspended app cannot speak at the end of a rest. Notification sounds are muted by the silent switch and Focus. Expo's audio, speech and speech-recognition modules each change the shared iOS audio session. Plan for one small custom Swift Expo module that owns the audio session, plus a layered rest alert: Live Activity, local notification and optional AlarmKit.
3. Ben can install the app without a Mac. EAS cloud builds, the **$99/year Apple Developer Program** and either ad hoc (internal) installs or TestFlight internal testing all work. A development build needs a computer running the dev server, so gym use needs a separate standalone "preview" build.
4. **Recommendation: stay on React Native + Expo, not native SwiftUI.** Without a Mac, SwiftUI loses Xcode, previews and the debugger. The native-only gaps are small and can be covered with local Swift Expo modules.
5. **Proposed brief changes are included** (see the end): layered rest alerts, an audio-session module in the spike, two build types and the developer-account dependency, the FitNotes source question, and SDK pinning.

## Recommendations

1. **Pin Expo SDK 57** for build-order step 1. Upgrade to SDK 58 only after it is stable. Its scene-lifecycle change and `File.write()` becoming async are breaking changes [Doc: SDK 58 beta].
2. **Enrol in the Apple Developer Program ($99/year) before the first device build.** It is required for EAS device builds, ad hoc installs, HealthKit, push, App Groups (needed by Live Activities) and TestFlight. This is Ben's decision and spend; no agent should enrol.
3. **Ship two build profiles.** `development` (dev client plus a dev server on Ben's computer) is for building. `preview` (internal distribution, standalone JS bundle) is for real gym sessions. Optionally add TestFlight internal testing later.
4. **Rest timer = persisted deadline plus layered alerts:**
   - (a) In-app countdown computed from the deadline.
   - (b) One scheduled local notification with a custom short sound and the `timeSensitive` interruption level.
   - (c) A Live Activity whose countdown is rendered by the system (`Text` `timerInterval` or `date` with `dateStyle="timer"`).
   - (d) Optional AlarmKit timer on iOS 26+ when Ben wants an alert that breaks through silent mode and Focus.
   - Test which combination Ben actually likes. Do not schedule everything at once by default.
5. **Add a local Swift Expo module (`modules/audio-coach`) to the build-order step 1 spike.** It owns the `AVAudioSession` category and options (`playback` or `playAndRecord`, `duckOthers` + `interruptSpokenAudioAndMixWithOthers`), speaks via `AVSpeechSynthesizer`, and handles interruptions and route changes. Do not let `expo-audio`, `expo-speech` and `expo-speech-recognition` each change the session independently.
6. **Background spoken cues are an explicit opt-in "keep audio alive during workout" experiment, not a promise.** If it fails or drains the battery, fall back to notification sound or haptic, plus AlarmKit.
7. **Speech input:** start with `expo-speech-recognition@57.1.0` (`SFSpeechRecognizer`, `requiresOnDeviceRecognition: true`, `contextualStrings` for exercise names). Evaluate a custom `SpeechAnalyzer` module (iOS 26+, on-device) only if accuracy on numbers like "one fifteen" is poor.
8. **HealthKit later:** `@kingstinct/react-native-healthkit@16.1.0` + `react-native-nitro-modules`, read-only scopes, added when step 6/7 begins.
9. **FitNotes:** first ask Ben which app he uses (original Android FitNotes or FitNotes 2 on iOS) and get a real export. Build the importer against that file, not against the header below.

---

## 1. Platform baseline

| Fact | Label | Source |
|---|---|---|
| Expo SDK 57 published 30 Jun 2026; React Native 0.86, React 19.2. | Doc | https://expo.dev/changelog/sdk-57 |
| `expo` npm `latest` tag = 57.0.27. | Doc | https://registry.npmjs.org/expo/latest |
| SDK 58 is beta (15 Sep 2026, React Native 0.88 RC, "built for iOS 27"). No stable announcement on the changelog as of 8 Oct. | Doc | https://expo.dev/changelog/sdk-58-beta, https://expo.dev/changelog |
| Apps built with the iOS 27 SDK must use the UIKit scene life cycle. SDK 57 adds opt-in `ios.enableSceneSupport`; SDK 58 makes it the default. EAS `latest` image currently ships Xcode 26.6. | Doc | sdk-57 and sdk-58-beta changelogs above |

[Inference] Building on SDK 57 with Xcode 26.x avoids the iOS 27 scene requirement for now. Plan one SDK upgrade before moving to Xcode 27.

## 2. Capability matrix

Legend: **Expo module** = first-party, works in a development build. **Community module** = third-party, needs a development build. **Custom native** = we write Swift via the Expo Modules API. Expo Go is not a valid test for any of these.

| Capability | Route | Status | Real-device tests needed |
|---|---|---|---|
| Local SQLite, transactions, migrations | `expo-sqlite` (SDK 57) | Expo module, supported | Force-close during a write; WAL recovery; migration on upgrade |
| Secure credential storage | `expo-secure-store` | Expo module, supported | Token size; behaviour after reinstall; data deletion |
| Rest deadline + local notification | `expo-notifications` (local only) | Expo module, supported. Time-sensitive needs an entitlement. | Silent switch, Focus, headphones, force-close, lock screen |
| Live Activity / Dynamic Island countdown | `expo-widgets` + `@expo/ui/swift-ui` | Expo module, **stable since SDK 56** | Countdown accuracy; behaviour after force-close; Ben's iPhone model |
| Breakthrough timer alarm (optional) | AlarmKit (iOS 26+) via community Nitro module or custom module | Community or custom native | Authorization flow; sound; whether it is too intrusive |
| TTS cues while music plays (foreground) | `expo-speech` or custom module | Expo module works; reliable ducking likely needs a custom module | Ducking and restore with Apple Music and Spotify; Bluetooth |
| TTS cues while locked or backgrounded | Audio background mode + active session | Feasible only if the app stays alive. Not guaranteed. | Battery; reliability over a 60–90 min session |
| On-device speech recognition | `expo-speech-recognition` (community) or custom `SpeechAnalyzer` module | Community module, or custom native | Numeric accuracy in a noisy gym; offline; en-NZ/en-AU locale |
| HealthKit read | `@kingstinct/react-native-healthkit` | Community module, Expo config plugin | Permission sheet; Garmin-to-Apple Health fields actually present |
| CSV import | `expo-document-picker` + `expo-file-system` | Expo module, supported | Files app, iCloud Drive and email attachment sources |
| Export / share | `expo-sharing` (+ `expo-file-system`) | Expo module, supported | Save to Files; AirDrop; large files |

### 2.1 Local SQLite (`expo-sqlite`)

Source: https://docs.expo.dev/versions/latest/sdk/sqlite/ (v57 reference).

- [Doc] `withTransactionAsync` "is not exclusive and can be interrupted by other async queries". Any query that runs while it is active joins the transaction. `withExclusiveTransactionAsync` limits the transaction to queries in its scope; other writes may fail with `database is locked`.
- [Doc] Migrations: the documented pattern is `PRAGMA user_version` inside `SQLiteProvider` `onInit`. Expo has no migration framework.
- [Doc] WAL is recommended: "Enable WAL journal mode when you create a new database".
- [Doc] Optional SQLCipher encryption via the `useSQLCipher` config-plugin option, which needs a rebuild. "SQLCipher is not supported on Expo Go."
- [Doc] Use prepared statements; `execAsync` does not escape parameters.
- [Doc, SDK 58 beta] libSQL support is removed. We don't need it.

Design implications [Inference]:
- Wrap every service write (`commitSetAndBeginRest`, `applyCoachProposal`, import commits) in `withExclusiveTransactionAsync`, and serialise writes through one queue in `packages/domain`'s persistence adapter. This prevents a voice turn and a tap from interleaving.
- Keep migrations as ordered, numbered SQL files with a test that applies them all to an empty database. This logic is pure TypeScript and testable on Linux with a Node SQLite driver. The real device is still the authoritative test.
- SQLCipher is optional. The data is personal training data, not credentials. Decide during the spike whether file-level iOS Data Protection is enough.

Real-device tests: kill the app mid-transaction, relaunch, and check there is no partial set; check the WAL file is recovered; check a schema migration runs on an app update with existing data.

### 2.2 Secure credential storage (`expo-secure-store`)

Source: https://docs.expo.dev/versions/latest/sdk/securestore/

- [Doc] iOS stores values in the Keychain (`kSecClassGenericPassword`). Default accessibility is `WHEN_UNLOCKED`. `*_THIS_DEVICE_ONLY` variants are not migrated to a new device from a backup.
- [Doc] Size: "some iOS releases refused values above roughly 2048 bytes"; Expo does not enforce a limit.
- [Doc] iOS values "will persist across app uninstallations when the app is reinstalled with the same bundle ID". The docs say not to rely on this.
- [Doc] `requireAuthentication` (Face ID) needs the config plugin's `faceIDPermission`, and keys are invalidated when biometrics change.

Design implications [Inference]:
- Use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for OAuth and API tokens.
- Store large token bundles as separate keys, or store only the refresh token.
- The "delete my data" flow must delete Keychain items explicitly, because they can survive an uninstall.
- This satisfies CLAUDE.md rule 7.

### 2.3 Rest timers that survive backgrounding and force-close

Brief §9 and §12 already require stored deadlines. This section covers what can alert Ben when the app is not running.

**Local notifications** (`expo-notifications`, https://docs.expo.dev/versions/latest/sdk/notifications/):
- [Doc] Supports one-off `TIME_INTERVAL` and `DATE` triggers. Local notifications work without push setup.
- [Doc, SDK 58 beta] Foreground notifications are shown by default unless a handler says otherwise. This is a behaviour change to handle at upgrade.
- [Doc, Apple] Once scheduled, "the system begins tracking the trigger conditions … When the trigger condition is met, the system delivers your notification." https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/add(_:withcompletionhandler:)
  - [Inference] Delivery therefore does not depend on our process, so it should survive force-close. This must be confirmed on the device.
- [Doc, Apple] Custom sounds must be under 30 s and in `aiff`/`wav`/`caf`; otherwise the default sound plays. https://developer.apple.com/documentation/usernotifications/unnotificationsound
- [Doc, Apple] `timeSensitive` "breaks through system notification controls" such as Focus and Notification Summary. Users can turn it off. https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive
  - [Anecdote] It requires the `com.apple.developer.usernotifications.time-sensitive` entitlement, set via `ios.entitlements` in the app config and enabled on the App ID. https://developer.apple.com/forums/thread/691183, https://support.cordial.com/hc/en-us/articles/30143397162893
- [Anecdote, Apple engineer] Limit of 64 pending local notification requests per app. Irrelevant here, since we only keep 1–2 per rest. https://developer.apple.com/forums/thread/811171
- [Anecdote] Developers of other gym apps report that the rest-end chime is suppressed in silent mode, and users suspect the iOS Fitness Focus. https://strongsplit.userjot.com/board/p/rest-period-over-notification, https://support.stronglifts.com/article/39-timer

**AlarmKit** (iOS 26+), https://developer.apple.com/documentation/alarmkit:
- [Doc] Supports countdown timers. An alarm "overrides both a device's focus and silent mode". It requires `NSAlarmKitUsageDescription` and user authorization. "AlarmKit expects a widget extension if an app supports a countdown presentation." https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit
- [Anecdote] There is no Expo module. A community `react-native-nitro-ios-alarm-kit` claims timer support and Expo compatibility; its maintenance is unverified. https://github.com/Gautham495/react-native-nitro-ios-alarm-kit
- [Inference] AlarmKit's full-screen alarm may be too heavy for every 90 s rest. It fits better as an opt-in "loud mode" or for long rests.

Proposed alert strategy [Inference, needs the device spike]:

| Layer | Survives backgrounding | Survives force-close | Silent switch | Focus |
|---|---|---|---|---|
| In-app countdown from stored deadline | No (recomputed on resume) | No (recomputed on relaunch) | n/a | n/a |
| Local notification, custom sound | Yes | Expected yes (test) | Sound muted (anecdote) | Muted unless time-sensitive and allowed |
| Live Activity countdown | Yes (system renders) | Unverified (test) | Visual only | Visual only |
| AlarmKit timer (opt-in) | Yes | Expected yes (test) | Overrides (doc) | Overrides (doc) |
| Spoken cue via kept-alive audio session (opt-in) | Only if session stays alive | No | Plays (`playback` category) | Plays |

When the deadline is adjusted (+30 s, skip, new set), cancel and reschedule every layer under the same timer version (brief `adjustRestTimer`, `cancelObsoleteCues`).

### 2.4 Live Activities and Dynamic Island (`expo-widgets`)

Sources: https://docs.expo.dev/versions/latest/sdk/widgets/, https://expo.dev/blog/ios-widgets-and-live-activities-in-expo, https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/text/, https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities

- [Doc] "Starting with SDK 56, expo-widgets is stable" (blog, 18 Jun 2026). The "latest" reference page still carried an alpha banner on some pages, so expect minor API churn.
- [Doc] UI is declared in a `'widget'` component using only `@expo/ui/swift-ui` components. No hooks, app state or async work are allowed there. Supported regions: `banner` (Lock Screen), `compactLeading`, `compactTrailing`, `minimal`, and the `expanded*` regions.
- [Doc] From JavaScript: `start(props, url?)`, `instance.update(props)`, `instance.end(...)`, and `getInstances()` to recover after relaunch. The widget extension target and App Group are generated by Continuous Native Generation.
- [Doc] `@expo/ui` `Text` supports `timerInterval`/`countsDown`/`pauseTime` (iOS 16+) and `date` + `dateStyle="timer"`, documented as "especially useful in widgets and Live Activities". The system can therefore animate the countdown without the app running.
- [Doc, SDK 58 beta] Adds `staleDate` for Live Activities.
- [Doc, Apple] A Live Activity runs up to 8 h (up to 12 h on the Lock Screen), carries at most 4 KB of data, and "can't access the network". Updates come from the app or from ActivityKit push. Apple notes the app may be stopped or crash while an activity is active, and says to check for active activities on next launch.

Implications [Inference]:
- The Live Activity cannot change itself to "Ready, next set: 95 kg × 8" when the rest ends unless the app is running or a push arrives. We have no server, so no push.
  - Design the banner to show the deadline countdown and the next set from the start, so nothing needs to change at expiry.
  - Use `staleDate` once on SDK 58.
- On launch, reconcile `getInstances()` against the active session in SQLite, ending orphans and restoring the current one. This covers force-close recovery.
- Live Activities need the paid program (App Groups); see §3.

Real-device tests: countdown accuracy over a 3-minute rest with the phone locked; behaviour after force-quitting the app mid-rest; tap-through deep link back to the active set; Ben's iPhone model (Dynamic Island exists only on some models; the Lock Screen banner works on all supported ones).

### 2.5 Audio: spoken cues, ducking, headphones, routes, background speech

Sources: https://docs.expo.dev/versions/latest/sdk/audio/, https://docs.expo.dev/versions/latest/sdk/speech/, https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/interruptspokenaudioandmixwithothers

Documented facts:
- [Doc] `expo-audio` `setAudioModeAsync` supports:
  - `interruptionMode` (`doNotMix` | `duckOthers` | `mixWithOthers`), `shouldPlayInBackground`, `playsInSilentMode` and `allowsRecording`.
  - Config plugin `enableBackgroundPlayback` (default true), which adds the iOS `audio` background mode.
  - No route-change event is documented. The docs only say "audio automatically stops if headphones/Bluetooth audio devices are disconnected".
- [Doc] `expo-speech`:
  - `useApplicationAudioSession` (iOS): set it to `false` and "the system creates a separate audio session to automatically manage speech, interruptions, and mixing and ducking".
  - "On iOS physical devices, `expo-speech` won't produce sound if the device is in silent mode."
  - The docs say nothing about background speech.
- [Doc, Apple] For "occasional and spoken" audio "such as … an exercise app", Apple recommends `interruptSpokenAudioAndMixWithOthers` together with `duckOthers`. Deactivate with `notifyOthersOnDeactivation` so music resumes at full volume. `expo-audio` does not expose `interruptSpokenAudioAndMixWithOthers`.
- [Doc] `expo-speech-recognition` changes the session to `playAndRecord` with `measurement` mode when it starts, and its README warns this "can cause problems in multimedia apps". https://github.com/jamsch/expo-speech-recognition

Anecdotal reports:
- [Anecdote] An Expo SDK 54 developer reports music does not duck during TTS when combining a track player, `duckOthers` toggling and `playAndRecord` switching. https://replit.discourse.group/t/expo-sdk-54-testflight-how-to-duck-background-music-during-tts-without-breaking-voice-input/11535
- [Anecdote] Apple forum threads report `AVSpeechSynthesizer` in the background sometimes queues until the app returns to the foreground, or pauses on lock, even with the audio background mode on. A workaround is playing a short silent clip. https://developer.apple.com/forums/thread/27097
- [Anecdote] A `Timer` does not fire while suspended (same forum results).

Inferences:
- Three Expo or community modules each changing one shared `AVAudioSession` is the main audio risk. A ~200-line Swift Expo module (https://docs.expo.dev/modules/get-started/, created with `create-expo-module --local` into `modules/`) gives us one owner of the session. It would:
  - set the category and options;
  - activate the session only around a cue, then deactivate with `notifyOthersOnDeactivation`;
  - speak via `AVSpeechSynthesizer`;
  - expose interruption and route-change events (`AVAudioSession.routeChangeNotification`, `interruptionNotification`) to JavaScript.
  This fits `packages/providers` capability detection.
- Speaking at rest-end while the screen is locked requires the process to be alive. The only general-purpose way for a gym app is an active audio session for the whole workout. That means quiet or silent playback with `mixWithOthers` and the audio background mode. This is the "keep-alive" pattern.
  - App Store guideline 2.5.4 limits background modes to their intended purpose (https://developer.apple.com/app-store/review/guidelines/). That does not gate a privately installed ad hoc build, but it signals that the pattern is fragile and could change.
  - Make it an explicit opt-in "Spoken cues while locked" setting with an honest fallback, as brief §12 already anticipates.
- Silent switch: the `playback` category plays in silent mode, which Ben probably wants for cues, but notification sounds do not.

Real-device tests:
- Spotify and Apple Music each with AirPods and with phone speaker. Check that music ducks, the cue is intelligible, and music volume is restored afterwards.
- Phone call mid-cue.
- Bluetooth disconnect during a cue.
- Siri invoked.
- Silent switch on and off.
- Lock screen during a 3-minute rest with keep-alive on and off.
- Battery drain over a 75-minute session with keep-alive on.
- Switching from TTS to recognition and back with music playing.

### 2.6 Speech recognition (push-to-talk)

- [Doc, Apple] `SFSpeechRecognizer` is described as "a network-based service" with per-device and per-app daily limits and "a one-minute limit on audio duration". `supportsOnDeviceRecognition` indicates offline capability. Apple says "Don't send … health … data". https://developer.apple.com/documentation/speech/sfspeechrecognizer
- [Doc, Apple] `SpeechAnalyzer` / `SpeechTranscriber` are available on iOS 26.0+. They need model assets installed via `AssetInventory`, and the system limits concurrent analyzers. https://developer.apple.com/documentation/speech/speechanalyzer
- [Anecdote, third-party] `SpeechAnalyzer` runs fully on-device but does not yet offer `SFSpeechRecognizer`'s custom-vocabulary feature. https://blakecrosley.com/blog/speech-framework-vs-sfspeechrecognizer
- [Doc, community module] `expo-speech-recognition` 57.1.0 (16 Sep 2026) officially supports SDK 57. It offers `requiresOnDeviceRecognition`, `contextualStrings`, `supportsOnDeviceRecognition()`, `interimResults`, `iosTaskHint` and an `iosCategory` override, and uses `SFSpeechRecognizer` on iOS. It needs a development build. https://github.com/jamsch/expo-speech-recognition, https://github.com/jamsch/expo-speech-recognition/releases
- [Inference] Neither engine returns confidence for every number on iOS. The README lists word confidence as Android-only. Brief §3's "never invent a confidence value" therefore matters: show the transcript and the parsed candidate instead.

Recommendation [Inference]:
- Use push-to-talk with `requiresOnDeviceRecognition: true` (privacy and offline use) and `contextualStrings` seeded with the active exercise names and "kilos", "RPE" and so on. Utterances are short, well under the one-minute limit.
- If on-device accuracy on loads is poor, spike a `SpeechAnalyzer` Swift module, or route audio to a separately funded provider. That is never automatic (CLAUDE.md rule 7).

Real-device tests: 30 realistic utterances ("one fifteen for four at ten", "one hundred and two point five") in a noisy gym, online and in airplane mode; Ben's locale (en-NZ, assumed) versus en-US; first-run model download.

### 2.7 HealthKit read (later)

- [Doc] There is no first-party Expo HealthKit module. The Expo forum says it is "on our list … not scheduled" (old thread). https://forums.expo.io/t/apple-healthkit-support/135
- [Doc, community module] `@kingstinct/react-native-healthkit` 16.1.0:
  - peer dependencies `react-native >=0.79`, `react-native-nitro-modules >=0.35`;
  - Expo config plugin sets `NSHealthShareUsageDescription`/`NSHealthUpdateUsageDescription` and optional `background: true` delivery;
  - "will not work in Expo Go";
  - supports query, save and subscribe for quantity, category and workout types.
  https://github.com/kingstinct/react-native-healthkit, https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest
- [Doc, Apple] HealthKit is a capability configured on the App ID. The tier table (https://developer.apple.com/help/account/reference/supported-capabilities-ios) did not render in my fetch.
  - [Inference] Expect it to need the paid program, consistent with "To build more advanced app capabilities … you'll need to be an Apple Developer Program member" (https://developer.apple.com/support/compare-memberships/).
- [Inference] Which Garmin fields reach Apple Health is still the brief's open question. HealthKit cannot return Garmin-only metrics (Body Battery, Training Readiness) that Garmin never writes there. Request read-only scopes for workouts, heart rate, resting heart rate, HRV and sleep, and show "not available" for anything absent (CLAUDE.md rule 6).

### 2.8 File import and export/share

- [Doc] `expo-document-picker` `getDocumentAsync({ type, multiple, copyToCacheDirectory })` returns `uri`, `name`, `size`, `mimeType` and `lastModified`. iCloud Drive browsing needs `ios.usesIcloudStorage: true`. https://docs.expo.dev/versions/latest/sdk/document-picker/
- [Doc] `expo-sharing` `shareAsync(url, { UTI })` opens the iOS share sheet. It also has **experimental** support for receiving shared files via a generated share extension (`useIncomingShare()`). This would let Ben "Open in…" a FitNotes CSV from Mail or Drive. https://docs.expo.dev/versions/latest/sdk/sharing/
- [Doc, SDK 58 beta] `expo-file-system` `File.write()` becomes async.
- [Inference] Treat file content as untrusted data (CLAUDE.md rule 8). Parse with a strict CSV parser in `packages/domain` or `packages/schemas`, compute a SHA-256 checksum for duplicate detection (brief scenario 6), and never execute or interpolate imported values into SQL.

Real-device tests: pick from Files, iCloud Drive, Google Drive and a Mail attachment; a 5+ year history file (size and time to preview); export to Files and AirDrop to a computer.

## 3. Installing a personal build without a Mac

Documented facts:
- [Doc] EAS Build "makes it possible to trigger iOS builds from non-macOS platforms" (macOS, Windows, Linux). Device builds need a paid Apple Developer account for signing. Local builds need Xcode, and a local build is "the only way to install a development build on an iPhone without a paid Apple Developer account", which is not an option without a Mac. https://docs.expo.dev/develop/development-builds/create-a-build/
- [Doc] Apple Developer Program: **$99 USD/year**. https://developer.apple.com/programs/
- [Doc] A free Apple account (Xcode personal team) gets profiles that "expire 7 days from issuance", a limit of 3 devices, and needs Xcode. https://developer.apple.com/support/compare-memberships/
- [Doc] EAS internal distribution uses ad hoc provisioning:
  - it "requires a paid Apple Developer account", up to 100 iPhones per year;
  - register a device with `eas device:create` (URL or QR code captures the UDID), then rebuild;
  - install from an EAS URL;
  - new devices can take 24–72 h to process on new memberships.
  https://docs.expo.dev/build/internal-distribution/
- [Doc] iOS 16+ requires Developer Mode for internal-distribution builds. Without a Mac, install the build, open it to trigger the prompt, then turn it on in Settings > Privacy & Security > Developer Mode and restart. https://docs.expo.dev/guides/ios-developer-mode/
  - Apple says Developer Mode does not affect App Store or TestFlight installs. https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device
- [Doc] TestFlight: each build is testable for 90 days from upload. Internal testers (up to 100 team members) appear not to need Beta App Review. Apple's wording is ambiguous; check the build status. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- [Anecdote, Apple forums] Ad hoc provisioning profiles last at most one year and are capped by the remaining membership period. An installed app stops launching once its profile expires and must be rebuilt or re-signed. https://developer.apple.com/forums/thread/115245
- [Doc] EAS free plan: "15 Android and 15 iOS builds" (the page does not say whether this is monthly), low priority queue (waits can exceed 90 min), 45-minute timeout. Starter plan is $19/month. https://expo.dev/pricing

Recommended setup [Inference]:

| Build | Profile | Distribution | JS source | Use |
|---|---|---|---|---|
| Development | `development` (`expo-dev-client`) | Internal (ad hoc) | Dev server (`npx expo start`) on Ben's computer, same Wi-Fi or tunnel | Building and debugging |
| Preview | `preview` | Internal (ad hoc) | Bundled in the app | Real gym sessions, offline |
| Optional | `production` | TestFlight internal | Bundled | If Ben prefers no Developer Mode and no UDIDs; rebuild every 90 days or less |

Ongoing obligations:
- Renew the membership yearly. If it lapses, profiles stop working and **the app may not launch**. SQLite data stays in the sandbox but is unreachable until a newly signed build is installed over the top, so export regularly.
- Rebuild before the ad hoc profile or TestFlight build expires.
- Rebuild whenever native modules or config change. JS-only changes can use EAS Update; check its current free-tier limits before relying on it (not checked).

Important: uninstalling the app deletes the SQLite database [Inference, standard iOS sandbox behaviour]. Installing a new build *over* the existing app (same bundle ID) keeps it. Brief §5 export/restore is therefore the real backup.

## 4. Native SwiftUI or React Native + Expo?

Where native SwiftUI would be meaningfully better [Inference]:
- Direct control of `AVAudioSession`, `AVSpeechSynthesizer`, `SpeechAnalyzer`, AlarmKit and ActivityKit, with no bridge and no module conflicts.
- App Intents and Siri: Expo's `expo-app-intents` is new and "in alpha" in SDK 58 beta.
- A watchOS app: React Native does not target watchOS, so a Watch app would be Swift whatever we choose.
- Live Activity UI built with full SwiftUI rather than the `@expo/ui` subset.

Why it is still not the better choice for Ben now [Inference]:
1. **No Mac.** SwiftUI development without Xcode means no previews, no simulator, no debugger, and builds only via remote macOS CI (GitHub Actions macOS runners or similar; not assessed here). Expo is documented to build iOS from Linux or Windows via EAS, and the Expo dev client gives fast reload on the phone.
2. **The core is platform-neutral TypeScript.** Domain rules, schemas, the coach tool registry, imports and progression all live in `packages/*` and can be unit-tested on Linux by agents and CI. That is most of the code, and the part that matters most for CLAUDE.md rules 2–5.
3. **The native gaps are narrow and bridgeable.** Audio session and TTS, optional `SpeechAnalyzer` and optional AlarmKit are each small Swift files in a local Expo module. Live Activities are covered by stable `expo-widgets`. We keep the native escape hatch without a full rewrite.
4. **Scope.** A personal app with no App Store review benefits more from fast iteration than from native polish.

**Recommendation: stay on React Native + Expo development builds.** Revisit the choice if any of these happen:
- The audio spike fails even with a custom session module.
- A Watch app becomes core rather than "later".
- Ben gets a Mac and prefers Swift.

Record this in an ADR when the spike concludes.

## 5. FitNotes CSV format (UNVERIFIED until checked against Ben's real export)

**First unknown: which FitNotes?** There are two:
- the original Android FitNotes (`com.github.jamesgay.fitnotes`; CSV and `.fitnotes` backup);
- **FitNotes 2** for iOS (https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016), which imports Android backups and CSVs and exports its own CSV, backup database and "Android DB format".
https://www.getfitnotes.com/docs/migrate-from-android.html, https://www.getfitnotes.com/docs/backup-export.html

FitNotes 2's App Store notes say its CSV format has changed between versions [Doc, App Store listing].

**Android FitNotes CSV export**, as reproduced by a third-party importer [Anecdote]:

```
Date,Exercise,Category,Weight (kgs),Weight (lbs),Reps,Distance,Distance Unit,Time,Comment
2026-03-02,Squat (Barbell),Legs,100,,5,,,,felt good
```
Source: https://kinoku.app/import-format

The same source implies files may carry only one of `Weight (kgs)` or `Weight (lbs)`. My unverified recollection is that the header follows the app's unit setting; confirm against Ben's file.

**FitNotes 2 (iOS) CSV import header**, from the official help [Doc]:

```
Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind
```
- Dates are `YYYY-mm-dd` in ascending order. Weight and distance have at most 2 decimals.
- Distance units: `m, km, cm, in, ft, yd, mi`. Time is `HH:MM:ss` or `MM:SS`.
- `Kind` combines `w`/`r`/`d`/`t`.
- If a workout already exists on a date, that date is skipped on import.
https://www.getfitnotes.com/docs/migrate-from-other-apps.html

Note the differences from the Android format: `kgs` vs `kg`, `Comment` vs `Notes`, and the added `Kind` column. The *export* header of FitNotes 2 was not found publicly.

**RPE:** neither format shows an RPE or RIR column [Doc/Anecdote above]. [Inference] Ben's RPE history, if any, is probably free text in `Comment`/`Notes`, such as "@8". The importer should:
- keep the raw comment as provenance;
- offer an *optional* reviewed extraction of patterns like `RPE 8` / `@8`, shown in the import preview as uncertain;
- never silently set effort fields.

**Other observations [Inference]:**
- Rows have no time of day and no workout ID. Sessions must be grouped by `Date`, so two sessions on one day merge. Set order is row order. Rest times are absent.
- Exercise names follow FitNotes' catalogue, such as "Flat Barbell Bench Press". Map them via `ExerciseAlias` with preview and uncertainty flags (brief §5).
- Load convention is not recorded. Dumbbell rows are probably per hand, but this cannot be proven from the file. Ask once per exercise during the preview.
- The Android `.fitnotes` backup is reportedly a database file (https://fileinfo.com/extension/fitnotes). It might preserve more metadata, such as set order, exercise types and possibly per-set timestamps. Evaluate it only if Ben has one and the CSV loses something he cares about. Unverified.

## 6. Unknowns that only a real end-to-end test can settle

1. Ben's iPhone model and iOS version. These decide Dynamic Island, AlarmKit and `SpeechAnalyzer` (iOS 26+) availability.
2. Whether scheduled local notifications and the Live Activity countdown behave correctly after force-quit mid-rest.
3. Whether the notification sound is audible with the silent switch on, with AirPods connected, and in the Fitness Focus.
4. Whether the keep-alive audio session reliably delivers spoken rest-end cues while locked for a 60–90 min session, and how much battery it costs.
5. Whether music ducks and restores correctly with Ben's music app when one module owns the session, including switching to recognition and back.
6. On-device recognition accuracy for loads, reps and RPE in a gym, in Ben's locale and offline.
7. Whether `withExclusiveTransactionAsync` and WAL give clean recovery after a kill during `commitSetAndBeginRest`.
8. Whether the time-sensitive entitlement is granted on the App ID via EAS credentials without manual portal steps.
9. The actual FitNotes export: source app, header, units, comment content and file size.
10. Whether Garmin data written to Apple Health includes the fields Ben cares about (HealthKit phase only).
11. Whether TestFlight internal builds need any review in practice, if that route is chosen.

## Proposed brief changes (for Ben's approval)

1. **§5 / §10 step 1 (spike scope):** add "a local Swift Expo module that owns the iOS audio session (category, ducking with `interruptSpokenAudioAndMixWithOthers`, interruption and route events, TTS)". Make the spike's exit criteria the real-device tests in §2.5. Reason: Expo modules each change the shared session, and Apple's exercise-app guidance needs an option `expo-audio` does not expose.
2. **§12 Rest state:** replace "Use supported notifications and Live Activity for background cues" with the layered strategy above:
   - deadline, then a local notification (custom sound, time-sensitive), then a Live Activity countdown rendered by the system;
   - optional AlarmKit "loud mode" (iOS 26+);
   - optional "spoken cues while locked" keep-alive mode with an honest fallback.
   Add explicitly that notification sounds may be silent in silent mode or Focus.
3. **§11 dependencies / CLAUDE.md build order:**
   - Add "Apple Developer Program membership ($99/yr) is required before any device build, Live Activity or HealthKit work; renew yearly; ad hoc profiles last up to 1 year, TestFlight builds 90 days."
   - Add the distinction between a **development** build (needs the dev server) and a **preview** build (standalone, for the gym).
   - Note that "Private installation/development build" in the scope table should read "private installation (development + preview builds)".
4. **§5 Data foundation / §11:** replace "A representative FitNotes export" with "confirm which FitNotes app (Android original or FitNotes 2 iOS) and obtain a real CSV, plus a `.fitnotes` backup if available". State that RPE is not expected as a column and should come only from reviewed comment parsing.
5. **§5 architecture table:** pin "Expo SDK 57 (React Native 0.86); upgrade to 58 after stable", and record it in an ADR alongside the "stay on Expo, not SwiftUI" decision and its revisit triggers.
6. **§3 voice:** refine "local/offline recognition is not guaranteed" to: "on-device recognition is available via `SFSpeechRecognizer` (`requiresOnDeviceRecognition`) and, on iOS 26+, `SpeechAnalyzer` via a custom module; accuracy for numeric logging must be measured".

No contradiction with CLAUDE.md was found. CLAUDE.md lists "lock-screen timers" under build step 7 (native polish), while this research suggests the notification and Live Activity layers belong in the first design milestone (force-close recovery and no missed timer endings, brief §12). Flagging this for Ben to decide.

## Sources (all checked 2026-10-08)

- Expo: https://expo.dev/changelog, https://expo.dev/changelog/sdk-57, https://expo.dev/changelog/sdk-58-beta, https://registry.npmjs.org/expo/latest, https://expo.dev/pricing, https://expo.dev/blog/ios-widgets-and-live-activities-in-expo
- Expo docs: https://docs.expo.dev/versions/latest/sdk/sqlite/, https://docs.expo.dev/versions/latest/sdk/securestore/, https://docs.expo.dev/versions/latest/sdk/notifications/, https://docs.expo.dev/versions/latest/sdk/widgets/, https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/text/, https://docs.expo.dev/versions/latest/sdk/audio/, https://docs.expo.dev/versions/latest/sdk/speech/, https://docs.expo.dev/versions/latest/sdk/document-picker/, https://docs.expo.dev/versions/latest/sdk/sharing/, https://docs.expo.dev/modules/overview/, https://docs.expo.dev/modules/get-started/, https://docs.expo.dev/build/internal-distribution/, https://docs.expo.dev/develop/development-builds/create-a-build/, https://docs.expo.dev/guides/ios-developer-mode/
- Apple: https://developer.apple.com/documentation/usernotifications/unnotificationsound, https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive, https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/add(_:withcompletionhandler:), https://developer.apple.com/documentation/alarmkit, https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit, https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities, https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/interruptspokenaudioandmixwithothers, https://developer.apple.com/documentation/speech/sfspeechrecognizer, https://developer.apple.com/documentation/speech/speechanalyzer, https://developer.apple.com/programs/, https://developer.apple.com/support/compare-memberships/, https://developer.apple.com/help/account/reference/supported-capabilities-ios, https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/, https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device, https://developer.apple.com/app-store/review/guidelines/
- Apple forums (anecdotal): https://developer.apple.com/forums/thread/811171, https://developer.apple.com/forums/thread/691183, https://developer.apple.com/forums/thread/27097, https://developer.apple.com/forums/thread/115245
- Community modules: https://github.com/jamsch/expo-speech-recognition, https://github.com/jamsch/expo-speech-recognition/releases, https://registry.npmjs.org/expo-speech-recognition/latest, https://github.com/kingstinct/react-native-healthkit, https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest, https://github.com/Gautham495/react-native-nitro-ios-alarm-kit, https://forums.expo.io/t/apple-healthkit-support/135
- Anecdotal feedback: https://strongsplit.userjot.com/board/p/rest-period-over-notification, https://support.stronglifts.com/article/39-timer, https://replit.discourse.group/t/expo-sdk-54-testflight-how-to-duck-background-music-during-tts-without-breaking-voice-input/11535, https://support.cordial.com/hc/en-us/articles/30143397162893, https://blakecrosley.com/blog/speech-framework-vs-sfspeechrecognizer
- FitNotes: https://www.getfitnotes.com/docs/migrate-from-other-apps.html, https://www.getfitnotes.com/docs/migrate-from-android.html, https://www.getfitnotes.com/docs/backup-export.html, https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016, https://kinoku.app/import-format, https://fileinfo.com/extension/fitnotes
