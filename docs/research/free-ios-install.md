# Installing the app without the $99/year Apple Developer Program

Researcher. All sources checked 2026-10-08 unless stated. Nothing was installed, built or signed up for, and no Apple ID was entered anywhere. Labels: **[Doc]** = official documentation (Apple, Expo, GitHub, WebKit, or a tool's own docs about itself). **[Community]** = reputable community documentation or source code. **[Anecdote]** = single report, issue or blog. **[Inference]** = my reasoning, not yet proven.

## Summary

1. **Yes, Ben can install and keep using the app for free**, using a free Apple ID ("Personal Team"). Apps signed this way stop opening after **7 days** unless they are re-signed. Limits: 3 apps per device, 10 App IDs per week, no TestFlight or ad hoc installs, no push, no time-sensitive notifications. HealthKit, background audio, speech recognition, local notifications and Keychain appear to work. App Groups, Live Activities and AlarmKit probably work but are **unproven through re-signing tools**.
2. **A computer is still needed, but it does not have to be a Mac.** The `.ipa` can be built in the cloud: on GitHub Actions macOS runners, or (unverified) as an EAS custom build. Ben then signs it with his free Apple ID using SideStore (any OS, computer only for setup, then refreshes on the phone), AltStore Classic or Sideloadly (a Windows PC or Mac that stays on). With no computer at all, the only routes are the paid programme or a PWA.
3. **Workout data survives the weekly refresh and a missed refresh**, as long as the app is never deleted and the signing team and bundle ID stay the same. [Inference, supported by tool docs] **Switching Apple ID, tool or team, including upgrading to the paid programme later, creates a separate app with an empty database.** Export/restore is the only bridge, so a minimal backup must exist before Ben logs real workouts.
4. **Expo Go and a PWA are not good substitutes.** Expo Go for SDK 57 is no longer on the App Store. It also can't load our Swift module, Live Activities or speech recognition, and its data lives inside Expo Go. A PWA can't schedule local notifications, can't run timers or audio reliably while locked, and can't use HealthKit.
5. **Recommendation:** start free (cloud-built IPA + SideStore, or AltStore/Sideloadly if Ben has an always-on PC), and upgrade to the paid programme only on a defined trigger. **Proposed brief changes are included:** resolve the open distribution question, move a minimal backup into the first milestone, keep paid-only capabilities optional and detected at runtime, and add a CI build pipeline.

## Recommendations

1. **First ask Ben two questions:** (a) which computers he has access to (Mac, Windows PC, Linux or Chromebook, or none); (b) his iPhone model and iOS version. The route depends on both. SideStore needs iOS 15+ and AltStore 2.3 needs iOS 17.4+.
2. **If Ben has any computer, start on the free route:**
   - Build an unsigned (ad hoc "-" signed, with entitlements) device `.ipa` on **GitHub Actions macOS** from a private repo.
   - Ben installs it with **SideStore**. Fallback: **AltStore Classic** or **Sideloadly** on a Windows PC or Mac.
   - Ben enters his own Apple ID into the tool himself. Consider a dedicated Apple ID used only for signing, and never change it afterwards (see §4).
3. **If Ben has no computer at all:** the paid programme + EAS (as in `ios-platform-feasibility.md`) is the only native route. Agents run the EAS CLI from this Linux environment; Ben registers the device and installs from a URL on the iPhone.
4. **Before any real workout is logged**, ship a minimal **backup**: an automatic SQLite snapshot plus JSON export to a user-chosen Files location after each finished workout, and a tested restore. This is the only way to cross a team or bundle ID change.
5. **Keep the native config "free-provisionable" while on the free route:**
   - no `aps-environment` (push), no `com.apple.developer.usernotifications.time-sensitive`, no Siri/App Intents entitlements, no Associated Domains;
   - no iCloud entitlement (check whether `expo-document-picker`'s `ios.usesIcloudStorage` adds one, and leave it off unless a device test shows it is needed);
   - Live Activities started with no push type (`expo-widgets` `enablePushNotifications: false`, the default).
6. **Treat Live Activity, AlarmKit, time-sensitive and HealthKit as capability flags** detected at runtime in `packages/providers`. The rest-alert design already falls back to "notification only" (`DEP-LIVE`), so no design rework is needed. The first-milestone acceptance criteria must not depend on them.
7. **Upgrade triggers** (Ben's call and spend; no agent enrols): weekly refreshes keep failing or are a nuisance; Live Activities or App Groups fail under re-signing; Ben wants time-sensitive Focus breakthrough, HealthKit through a tool that drops it, or TestFlight. Follow the migration in §8.

---

## 1. Free Apple ID ("Personal Team") provisioning

### 1.1 Limits

| Fact | Label | Source |
|---|---|---|
| "You can register up to 10 App IDs, which expire after 7 days." | Doc | https://developer.apple.com/support/compare-memberships/ |
| "You can register up to 3 devices, which expire after 7 days." | Doc | same |
| "You can install up to 3 apps per device. Provisioning profiles … will expire 7 days from issuance. You'll need to rebuild and reinstall your app to your device after expiration." | Doc | same |
| Personal Team "allows you to build apps for your personal use on devices owned by you"; it cannot sign for the App Store or enterprise use (2017 Q&A, still current per the Apple forum answer below). | Doc | https://developer.apple.com/library/archive/qa/qa1915/_index.html |
| Apple DTS (May 2024): "The Personal Team feature has significant limitations", pointing to the page above. | Doc (Apple forum) | https://developer.apple.com/forums/thread/755912 |
| "The Capabilities library displays only the capabilities available to the target platform and your program membership." | Doc | https://developer.apple.com/tutorials/data/documentation/xcode/adding-capabilities-to-your-app.md |
| Each app extension uses its own App ID: AltStore computes `requiredAppIDs = 1 + application.appExtensions.count`. | Community (source code) | https://raw.githubusercontent.com/rileytestut/AltStore/develop/AltStore/Operations/FetchProvisioningProfilesOperation.swift |
| The 3-app limit includes the sideloading app itself (SideStore or AltStore). | Doc (tool) | https://docs.sidestore.io/docs/faq, https://faq.altstore.io/altstore-classic/your-altstore.md |

[Inference] Our app = main app + 1 widget extension (Live Activity, and AlarmKit's countdown UI) = 2 App IDs, or 3 with an incoming-share extension. SideStore or AltStore uses at least 1 more. That fits within 10 per week, but leaves little room for experiments with many test bundle IDs.

### 1.2 Capability matrix (free Personal Team)

Apple's official per-membership table (https://developer.apple.com/help/account/reference/supported-capabilities-ios) did **not render its tick marks** in any fetch. The column definitions came through ("Apple Developer: … No cost, but developers can't distribute apps"). The rows below therefore rely on the best available secondary evidence. **Confirm the table in a normal browser before relying on any row marked Inference.**

The best single piece of evidence is LoopDocs' "build with a free account" guide [Community]. Loop is a widely self-built iOS app with HealthKit, widget and watch extensions. It tells free-account builders to **delete** Push Notifications, Siri, Time Sensitive Notifications and NFC Tag Reading, to **keep HealthKit** ("HealthKit DO NOT DELETE"), and to sign all six targets, including the Loop Widget Extension. https://loopkit.github.io/loopdocs/build/build-free-loop/. This is the **Xcode-on-a-Mac** route. Re-signing tools may behave differently.

| Capability | Free team? | Evidence | Label |
|---|---|---|---|
| Local notifications (`expo-notifications`, scheduled) | **Yes.** No entitlement needed. | Local notifications need no push setup (see `ios-platform-feasibility.md` §2.3). A third-party guide lists them as available on free teams: https://zudo-tauri-wisdom.takazudomodular.com/docs/mobile/ios-signing-free-team/ | Doc + Anecdote |
| Time-sensitive notifications | **No.** | LoopDocs removes "Time Sensitive Notifications" for free builds (link above). It is an entitlement (`com.apple.developer.usernotifications.time-sensitive`). | Community |
| Push notifications (APNs) | **No.** | LoopDocs: "free accounts do not have access to Apple Push notifications". https://loopkit.github.io/loopdocs/build/apple-developer/ | Community |
| Background audio mode (`UIBackgroundModes: audio`) | **Very likely yes.** | It is an `Info.plist` key, not a provisioning entitlement. Loop's free build keeps its background modes. | Inference |
| Speech recognition (`SFSpeechRecognizer` / `expo-speech-recognition`) | **Very likely yes.** | Needs only usage-description keys, no entitlement. | Inference |
| Text-to-speech, `AVAudioSession`, custom Swift Expo module | **Yes.** | No entitlement involved. | Inference |
| Keychain (`expo-secure-store`) | **Yes** for the app's own items. | Default access group derives from the application identifier. AltStore 2.0 fixed "resigning apps with wildcard `keychain-access-groups` entitlement". https://faq.altstore.io/release-notes/altstore.md | Community + Inference |
| HealthKit | **Yes via Xcode** (LoopDocs keeps it). **Unknown via SideStore, AltStore or Sideloadly.** | LoopDocs, link above. | Community; re-sign behaviour untested |
| App Groups | **Probably yes, but fragile under re-signing.** | AltStore's code registers App Groups under the user's team and renames them `groupIdentifier + "." + team.identifier`. AltStore's own widget, which ships to free-account users, relies on this. A 5 Oct 2026 issue reports AltStore **skipped** App Group registration because the unsigned IPA carried no entitlements in its signature. The fix was to ad hoc sign each bundle with its entitlements before packaging; device result still pending. https://github.com/kinoko34077/gesture-ime/issues/144, https://github.com/kinoko34077/gesture-ime/pull/145 | Community (code) + Anecdote |
| Widget extension / Live Activities | **Probably yes, local updates only.** | A LoopKit issue (22 Sep 2026) reports that on a Personal Team build with matching App Groups, the Live Activity failed only because it requested `pushType: .token`; with `pushType: nil` it "allows the Live Activity to be created and work normally". https://github.com/LoopKit/Loop/issues/2532. `expo-widgets` needs an App Group ("which widgets require to work") and `enablePushNotifications` defaults to `false`. https://docs.expo.dev/versions/latest/sdk/widgets/ | Anecdote + Doc |
| AlarmKit (iOS 26+) | **Probably yes.** | Apple's guide lists only `NSAlarmKitUsageDescription` plus runtime authorization, with no entitlement. "AlarmKit expects a widget extension if an app supports a countdown presentation." https://developer.apple.com/tutorials/data/documentation/alarmkit/scheduling-an-alarm-with-alarmkit.md | Doc; free-team use is Inference |
| iCloud (CloudKit, iCloud Documents) | **No (likely).** | Listed as unavailable in a third-party guide (zudo link above). Not needed: backups go to a user-chosen Files location. | Anecdote |
| Siri / App Intents entitlements | **No.** | LoopDocs removes Siri. | Community |
| TestFlight, ad hoc, App Store | **No.** | compare-memberships page; QA1915. | Doc |

[Inference] **AlarmKit may partly replace the lost time-sensitive entitlement.** It "overrides both a device's focus and silent mode" (Apple, above) and needs no entitlement. This is untested and makes AlarmKit "loud mode" more valuable on the free route.

### 1.3 Developer Mode

[Doc] iOS 16+ requires Developer Mode for internal-distribution (development- or ad hoc-signed) builds. Without a Mac, turn it on after installing: open the app to trigger the prompt, then go to Settings > Privacy & Security > Developer Mode and restart. https://docs.expo.dev/guides/ios-developer-mode/. [Inference] Free-team apps are development-signed, so the same applies. SideStore's install guide includes a Developer Mode step for some variants. https://docs.sidestore.io/docs/installation/install

## 2. Building the `.ipa` without a Mac and without a paid account

| Route | What it produces | Account needed | Label / source |
|---|---|---|---|
| **EAS Build, standard device profile** | Signed device build | **Paid**. "Device builds need a paid Apple Developer account for signing" (see `ios-platform-feasibility.md` §3). | Doc |
| **EAS Build, `ios.simulator: true`** | Simulator `.app` | None, "without … having an Apple Developer account". **Does not run on an iPhone.** https://docs.expo.dev/build-reference/simulators/ | Doc |
| **EAS custom build (`withoutCredentials: true` + custom YAML)** | Possibly an unsigned device `.ipa` | Expo account only | Unverified. `withoutCredentials`: "EAS CLI won't require you to configure credentials … handy when using EAS Build custom builds" (https://docs.expo.dev/eas/json/). Custom steps can `run` arbitrary commands and `eas/upload_artifact` (https://docs.expo.dev/custom-builds/schema/). No Expo doc describes an unsigned **device** build. EAS Free: 15 iOS builds, low-priority queue, 45-min timeout (https://expo.dev/pricing). Custom-build availability on Free is not stated. |
| **GitHub Actions macOS runner** | Unsigned or ad hoc-signed device `.ipa` via `expo prebuild` + `xcodebuild … CODE_SIGNING_ALLOWED=NO`, then zip `Payload/` | GitHub account | Pattern documented by several community repos, e.g. https://github.com/adro0303/ipa-builder, https://github.com/misaka310/ios-sidestore-deploy, and an Expo-specific write-up (Nov 2025) https://dev.to/oivoodoo/build-unsigned-ios-ipa-to-install-via-sideloadly-236f. [Anecdote] |
| **Codemagic** | Same as GitHub Actions, on a Mac mini M2 | Codemagic account | Personal free tier: "500 free macOS M2 minutes / month", 1 parallel build, 120-min cap. https://codemagic.io/pricing/ [Doc] |

**GitHub Actions allowances [Doc]** (https://docs.github.com/en/billing/concepts/product-billing/github-actions, https://docs.github.com/en/billing/reference/product-usage-included):
- Standard GitHub-hosted runners are **free in public repositories**.
- GitHub Free includes **2,000 minutes/month** for private repositories, reset monthly.
- macOS 3/4-core runners are priced at **$0.062/min** beyond the quota. Artifact storage is 500 MB.
- **How macOS minutes draw down the free quota is not stated on GitHub's current pages.** Third parties disagree:
  - most still cite a **10x** multiplier (≈200 macOS minutes free), e.g. https://cicdpipelinecost.com/github-actions-pricing;
  - one says multipliers no longer exist (https://sengi.run/blog/github-actions-pricing, checked 21 Sep 2026).

[Inference] An Expo prebuild + pods + Release `xcodebuild` probably takes 15–30 min. Even at 10x, that allows roughly 6–12 native builds a month on a private repo. **Weekly refreshes do not need a rebuild**: the tool re-signs the same IPA. JS-only changes can ship through EAS Update (Free: 1,000 MAU, https://expo.dev/pricing) without a native rebuild. Keep the repo **private**, because the brief and docs contain personal details.

**Critical build detail [Anecdote, with source-code support]:** AltStore reads the requested App Groups from the entitlements embedded in the binary's signature. A fully unsigned build (`CODE_SIGNING_ALLOWED=NO`) carries none, so the App Group is never registered and widgets can't share data. Ad hoc sign (`codesign -s - --entitlements …`) the app and each extension with their entitlements before zipping (gesture-ime #144/#145 above). Whether SideStore and Sideloadly behave the same way is unknown.

## 3. Sideloading and re-signing tools (free Apple ID)

| Tool | Computer needed | How the 7-day refresh works | Notes | Source |
|---|---|---|---|---|
| **SideStore** (AltStore fork) | **Windows 8+, macOS, Linux or Chromebook, for the initial install only** (via iloader; Windows needs iTunes/Apple Devices, Linux needs usbmuxd) | **On the iPhone.** SideStore refreshes apps "in the background", or Ben taps the counter. **LocalDevVPN (on-device VPN) must be connected** "any time you wish to install, update, or refresh apps", plus Wi-Fi. | iOS 15+, passcode set. 3 active apps including SideStore; 10 App IDs per week. Pairing file "may expire after you update or reset the device" or randomly, so Ben then needs a computer again (iloader). If SideStore itself expires, the fix is reinstalling via the computer. | https://docs.sidestore.io/docs/faq, https://docs.sidestore.io/docs/installation/prerequisites, https://docs.sidestore.io/docs/installation/install, https://docs.sidestore.io/docs/troubleshooting/common-issues [Doc (tool)] |
| **AltStore Classic** | **Mac or Windows** running **AltServer** | AltStore "will try to automatically refresh your apps throughout the week". It needs the same Wi-Fi as a computer running AltServer (or USB). Leave AltServer running at boot. Background Refresh wakes AltStore periodically. Manual "Refresh All". | Version 2.3 (14 Sep 2026), minimum iOS 17.4. "Limited app entitlements". Free, worldwide. Rewrites the bundle ID to `<bundleID>.<TEAMID>` and App Groups to `<group>.<TEAMID>`. Deactivate/Activate backs up and restores app data. | https://faq.altstore.io/altstore-classic/altserver.md, https://faq.altstore.io/altstore-classic/your-altstore.md, https://faq.altstore.io/altstore-classic/app-ids.md, https://faq.altstore.io/release-notes/altstore.md, https://developer.altstore.io/ [Doc (tool)]; bundle and group renaming from source code [Community] |
| **Sideloadly** | **Windows 7+ or macOS 10.12+** (Linux not listed) | A background daemon on the computer re-signs "every few days". Wi-Fi mode needs the same network (Windows may need Bonjour). [Inference] The computer must be on and reachable. | v0.70.1. Supports iOS up to 26+. Can remove extensions and change bundle ID (leave both alone for us). Entitlement handling not documented. | https://sideloadly.io/ [Doc (tool)] |
| **sign.expo.dev** (by Expo) | Any computer with a WebUSB browser (Chromium, inferred) + USB cable | Manual re-sign about every 7 days | **Installs Expo Go only**, not our app. | https://sign.expo.dev/, https://sign.expo.dev/how-it-works [Doc] |
| **Xcode with Personal Team** | **Mac only** | Rebuild and reinstall weekly from Xcode | Best entitlement fidelity (LoopDocs). A cloud Mac doesn't help, because install needs the phone on USB or the local network. [Inference] | LoopDocs links above |
| **AltStore PAL** | n/a | n/a | **Not a free route.** Apps must be notarised, which needs a **paid** developer account. Available in the EU, Japan and Brazil; UK and Australia "expected later" (no date); New Zealand not announced. **Does not apply to Ben on the free route in any region.** | https://developer.altstore.io/, https://macmagazine.com.br/post/2026/06/18/altstore-pal-loja-alternativa-a-app-store-ja-esta-disponivel-no-brasil/ (18 Jun 2026) [Doc + press] |

Reliability [Anecdote/Inference]:
- **SideStore:** the computer is needed least often, but it has the most moving parts (VPN, pairing file, anisette server). Its troubleshooting page is mostly about those.
- **AltStore and Sideloadly:** depend on a computer being on and on the same Wi-Fi at least once a week. If Ben's PC is a laptop that travels, refreshes can lapse.
- **Security:** all three tools ask for an Apple ID password and talk to Apple's developer services. Ben should enter it himself (agents must not). A dedicated Apple ID used only for signing limits exposure, but it must then be used **permanently** (§4).

**Do re-signing tools preserve extensions and entitlements?**
- [Community] AltStore keeps extensions and registers an App ID per extension.
- [Community] AltStore maps declared entitlements to App ID features and handles App Groups explicitly. Whether HealthKit or other features survive is not documented ("Limited app entitlements").
- [Doc] Sideloadly can strip extensions (optional); its entitlement handling is undocumented.
- [Unknown] SideStore, beyond being an AltStore fork.
- **Only a device test settles this** (§9).

## 4. Does workout data survive expiry and re-signing?

- [Doc, tool] AltStore: expired apps "can no longer be opened". It does not say data is deleted. Deactivate "backs up their data", and re-activating restores it. https://faq.altstore.io/altstore-classic/your-altstore.md
- [Doc, tool] SideStore: data carries over when you sideload the same or an updated IPA over an AltStore/Sideloadly app "without removing the original". https://docs.sidestore.io/docs/faq
- [Doc, Apple forum] An update whose application identifier (Team ID + bundle ID) differs from the installed app is rejected: "application-identifier entitlement string does not match installed application's … rejecting upgrade". A new app identity does not "see" the old app's container or Keychain items. https://developer.apple.com/forums/thread/126589
- [Community, source code] AltStore derives the installed bundle ID from the **team ID** (`<bundleID>.<TEAMID>`). Installing under a different team creates a new bundle ID "to prevent collisions with the previous team". Link in §1.1.

What this means [Inference]:
- **Refresh on time:** data untouched. The app is re-signed in place.
- **Refresh missed:** the app won't launch, but its sandbox, including SQLite, stays on the phone. Refreshing or re-installing the same IPA with the **same tool and Apple ID** should reopen it with data intact. Rest-timer deadlines and an active session recover through the existing force-close logic. **Do not delete the expired app.**
- **Expiry mid-workout:** unclear. Profile checks are thought to happen at launch, so a running app probably keeps running, but a force-close would block relaunch. Refresh before training, e.g. when fewer than 2 days are left.
- **Data loss happens** if Ben deletes the app, or changes Apple ID, signing tool (AltStore and Sideloadly may produce different bundle IDs), or team (**including upgrading to the paid programme**). Then the new install has an empty database, and the old one either blocks the install or sits beside it as a separate app.
- `expo-secure-store` items do not cross identities either, so AI tokens need re-entry after a migration. That is acceptable.

## 5. Expo Go as a no-fee route

- [Doc] The App Store build of Expo Go stops at **SDK 54**; "SDK 55 and later aren't available there". For a physical iPhone with newer SDKs, `eas go` builds Expo Go for TestFlight, which "needs an Apple Developer Program membership". https://docs.expo.dev/troubleshooting/expo-go-version-mismatch.md, https://expo.dev/changelog/expo-go-and-app-store-may-2026.md (4 May 2026)
- [Doc] **sign.expo.dev** installs any Expo Go SDK build with a free Apple ID over USB from the browser. The certificate is valid about 7 days. https://sign.expo.dev/how-it-works
- [Doc] Expo Go is "a limited playground and not useful for building production-grade projects". It loads a project from a dev server signed into the same Expo account. https://docs.expo.dev/get-started/expo-go/, https://docs.expo.dev/workflow/overview/

| Module | In Expo Go? | Source |
|---|---|---|
| `expo-sqlite` | Yes (no SQLCipher) | https://docs.expo.dev/versions/latest/sdk/sqlite/ [Doc] |
| `expo-notifications` (local) | Local "remain available in Expo Go" | https://docs.expo.dev/versions/latest/sdk/notifications/ [Doc] |
| `expo-speech` | Yes | https://docs.expo.dev/versions/latest/sdk/speech/ [Doc] |
| `expo-secure-store` | Yes (no `requireAuthentication` with biometrics) | https://docs.expo.dev/versions/latest/sdk/securestore/ [Doc] |
| `expo-document-picker` | Yes | https://docs.expo.dev/versions/latest/sdk/document-picker/ [Doc] |
| `expo-widgets` (Live Activities) | **No.** "not available in the Expo Go app" | https://docs.expo.dev/versions/latest/sdk/widgets/ [Doc] |
| `expo-speech-recognition` | **No.** The README says a development build is needed | https://github.com/jamsch/expo-speech-recognition [Doc] |
| Custom Swift audio module, AlarmKit, HealthKit | **No.** Expo Go can't load custom native code | Expo Go docs above [Doc] |

Standalone use [Unverified]:
- Expo Go can open a published update and falls back to a cached bundle when offline, according to older Expo docs. That would avoid a dev server at the gym, but the current docs don't confirm it.
- [Inference] All data would live inside Expo Go's container and would be lost if Expo Go is deleted or re-signed under another identity.
- **Verdict:** prototype only. It can test the logging UI, but not the audio module, speech recognition or Live Activities.

## 6. PWA (home-screen web app)

| Need | iOS PWA behaviour | Label / source |
|---|---|---|
| Install | Safari > Share > Add to Home Screen. No computer, no Apple ID, no expiry. Hosting needed (e.g. GitHub Pages, free). | Inference |
| Local storage durability | Home-screen web apps "have their own counter of days of use", so the 7-day script-storage deletion is not expected to hit them (2020). Storage is best-effort and evictable least-recently-used unless `persist()` is granted, which WebKit decides by heuristics such as being a Home Screen web app (2023). | https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/, https://webkit.org/blog/14403/updates-to-storage-policy/ [Doc] |
| Rest-end notification while locked | Web Push works on iOS 16.4+ home-screen apps via APNs **but needs a server to send the push**. No documented local scheduled notification. | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ [Doc]; local scheduling absence is Inference |
| Timers while backgrounded | iOS suspends the page shortly after backgrounding. No Background Sync or Fetch. | https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide [Anecdote] |
| Spoken cues while locked | Reports of audio stopping on lock in installed PWAs. iOS 26 improved but is "still not what it was". | https://dev.to/prototyp/what-we-learned-about-pwas-and-audio-playback-50eh, https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/ [Anecdote] |
| Speech recognition | Safari iOS 14.5+ "Partial support" | https://caniuse.com/speech-recognition [Doc-ish] |
| Keep screen awake during a set | Screen Wake Lock supported on iOS 16.4+ | https://caniuse.com/wake-lock |
| HealthKit, Live Activity, AlarmKit, Keychain | Not available to web apps (brief §Connections already says so) | Doc (brief) / Inference |

**Verdict [Inference]:** usable as a foreground logger with an on-screen rest timer, but it fails the brief's "no missed timer endings" goal without a push server. It would mean a second client codebase. Not recommended, except as a stopgap if Ben has no computer and won't pay.

## 7. Comparison

| Route | Cost | Computer Ben needs | Refresh burden | Lost vs paid | Data-loss risk |
|---|---|---|---|---|---|
| **A. Paid programme + EAS** (baseline) | $99/yr | **None.** Agents run EAS from Linux; Ben installs from a URL | Yearly ad hoc profile, or TestFlight every 90 days | Nothing | Low. Lapse means the app won't open until rebuilt; data stays |
| **B. Free + cloud IPA (GitHub Actions) + SideStore** | $0 | **Any OS, once** for setup, again if the pairing file breaks or SideStore expires | Weekly, on the phone (VPN toggle); automatic background attempts | Push, time-sensitive, TestFlight. Live Activity/App Groups and HealthKit **uncertain** under re-sign. 3-app cap | Medium. Missed refresh = locked until refreshed. Changing tool, Apple ID or team = fresh database |
| **C. Free + cloud IPA + AltStore Classic or Sideloadly** | $0 | **Windows PC or Mac**, on and on the same Wi-Fi weekly | Weekly, automatic if the PC is reachable | Same as B | Same as B |
| **D. Free + Xcode** | $0 | **Mac** | Weekly rebuild from Xcode | Push, time-sensitive, Siri. HealthKit and widgets **kept** (LoopDocs) | Same as B |
| **E. Expo Go via sign.expo.dev** | $0 | Any OS with a WebUSB browser + USB, weekly | Weekly manual re-sign; dev server or cached update | Custom audio module, speech recognition, Live Activity, AlarmKit, HealthKit | High. Data inside Expo Go |
| **F. PWA** | $0 (+ server if push) | None | None | Local notifications, background timers/audio, HealthKit, Live Activity; speech recognition partial | Low–medium (best-effort eviction) |

## 8. Recommendation and the "start free, upgrade later" path

**Recommended [Inference]:** Route **B** if Ben has any computer, or **C** if he has a Windows PC or Mac that stays on at home. Route **A** if he has no computer, or once an upgrade trigger fires. Not E or F, except as throwaway prototypes.

Path:
1. **Spike (build-order step 1)** adds a "free-install spike":
   - a GitHub Actions workflow (private repo) runs `expo prebuild`, then a Release `xcodebuild` for `iphoneos` with signing disabled;
   - ad hoc sign the app and extension with their entitlements, then upload `App.ipa` as an artifact;
   - Ben installs it via SideStore or AltStore;
   - a hidden "capability probe" screen reports: local notification delivered; Live Activity started (push type nil); App Group container readable from the widget; AlarmKit authorization; on-device speech available; background audio session active; Keychain round-trip; installed bundle ID and team suffix.
2. **Milestone 1** includes the minimal backup (Recommendation 4) and a "days until expiry" readout if the app can read its own provisioning profile expiry. It can't if the profile is stripped; otherwise rely on the SideStore or AltStore counter.
3. **Native changes** go through CI rebuilds. **JS changes** go through EAS Update (works without a paid account [Inference]; the update channel is configured at build time).
4. **Upgrade (when triggered):**
   - Ben enrols and agents run EAS with internal distribution;
   - **export** in the old app, install the new app (a different team, so a separate app), **import**, then verify counts and the latest session;
   - only then delete the old app.
   - Reuse the same base bundle ID in `app.json`; the team prefix will differ anyway.
   - Turn on the time-sensitive and push-capable configs only after the switch.

**What changes in the design and build order:**
- Build order step 3 (export/restore) gets a **minimal slice pulled forward into milestone 1**: snapshot export plus a tested restore.
- Step 1 spike gains the CI IPA pipeline and the capability probe. EAS device builds are deferred until the upgrade.
- The rest-alert layers stay as designed, but **time-sensitive is unavailable** on the free route. Live Activity remains `DEP-LIVE`. AlarmKit "loud mode" moves up as the only Focus/silent breakthrough on free. The design fallback "notification only" already exists in `docs/design/rest-state.md`, so no layout change is needed.
- HealthKit (later) needs its own re-sign test before being promised on the free route.
- Development loop: a sideloaded **development** build (`expo-dev-client`) needs a dev server reachable from the phone. That is either Ben's computer, or a tunnel (`npx expo start --tunnel`) from the agents' Linux environment, which is untested. Without either, iterate via preview builds + EAS Update.

## 9. Unknowns only a real end-to-end test can settle

1. Ben's computer access, iPhone model and iOS version.
2. Whether GitHub Actions' current macOS image builds our Expo SDK 57 project unsigned within the free minutes, and how long it takes.
3. Whether SideStore, AltStore and Sideloadly each register the App Group for the main app and widget extension, and whether `expo-widgets` still finds its group after AltStore appends `.<TEAMID>` to the group ID (the group ID may be baked into `Info.plist` at build time).
4. Whether a Live Activity started from a free-team build (no push type) shows and counts down on the Lock Screen and Dynamic Island.
5. Whether AlarmKit authorization and countdown work on a free-team build, and whether AlarmKit breaks through Focus or silent as documented.
6. Whether HealthKit survives each re-signing tool (later phase).
7. Data survival: log a workout, let the app expire (skip one refresh), refresh, and confirm SQLite and an in-progress session survive. Repeat across a manual re-install of a newer IPA.
8. Whether `ios.usesIcloudStorage` (document picker) adds an entitlement that breaks free provisioning, and whether importing from iCloud Drive works without it.
9. SideStore refresh reliability over 4+ weeks: background refresh success rate; how often the pairing file or anisette breaks and a computer is needed.
10. Whether EAS custom builds with `withoutCredentials` can emit a device `.ipa` on the Free plan (an alternative to GitHub Actions).
11. Apple's supported-capabilities table for the free "Apple Developer" column, viewed in a real browser, to replace the secondary evidence in §1.2.

## Proposed brief changes (for Ben's approval)

1. **Resolve the v0.2 "Open" item (distribution):** "Start on a free Apple ID: cloud-built IPA, installed and refreshed weekly with SideStore (or AltStore/Sideloadly with an always-on PC). Upgrade to the Apple Developer Program ($99/yr) when a defined trigger is met (refresh burden, Live Activity/App Group failure, need for time-sensitive alerts, HealthKit or TestFlight). If Ben has no computer, use the paid programme from the start." Record as **ADR 0002 (distribution route)**. This **revises** `ios-platform-feasibility.md` Recommendation 2 ("enrol before the first device build") and CHANGELOG v0.2's line on two EAS build profiles.
2. **Milestone 1 / build order:** move a minimal **backup snapshot + tested restore** from step 3 into the first milestone. Reason: weekly expiry and any team or bundle change can strand data, and export/restore is the only migration path.
3. **§12 Rest state / rest-alert layers:** state that time-sensitive notifications require the paid programme. On the free route the layers are deadline → local notification → Live Activity (if the probe passes) → optional AlarmKit loud mode. The milestone acceptance "no missed timer endings" is judged against the layers actually available.
4. **§5 architecture / CLAUDE.md conventions (Ben to approve; agents must not edit CLAUDE.md):** "Native config must stay free-provisionable until the upgrade: no push, time-sensitive, Siri, iCloud or Associated Domains entitlements. Paid-only capabilities are optional and detected at runtime in `packages/providers`."
5. **§10 step 1 spike:** add "CI unsigned-IPA pipeline (GitHub Actions macOS, private repo) + on-device capability probe", with §9 above as exit criteria.
6. **§11 dependencies:** replace "distribution/developer-account setup" with "which computer Ben can use for sideload setup; a dedicated Apple ID for signing, never changed afterwards".

## Sources (all checked 2026-10-08)

- Apple: https://developer.apple.com/support/compare-memberships/, https://developer.apple.com/help/account/reference/supported-capabilities-ios (tick marks not rendered), https://developer.apple.com/tutorials/data/documentation/xcode/adding-capabilities-to-your-app.md, https://developer.apple.com/library/archive/qa/qa1915/_index.html, https://developer.apple.com/forums/thread/755912, https://developer.apple.com/forums/thread/126589, https://developer.apple.com/tutorials/data/documentation/alarmkit/scheduling-an-alarm-with-alarmkit.md
- Expo: https://docs.expo.dev/eas/json/, https://docs.expo.dev/build-reference/simulators/, https://docs.expo.dev/custom-builds/get-started/, https://docs.expo.dev/custom-builds/schema/, https://expo.dev/pricing, https://docs.expo.dev/get-started/expo-go/, https://docs.expo.dev/workflow/overview/, https://docs.expo.dev/troubleshooting/expo-go-version-mismatch.md, https://expo.dev/changelog/expo-go-and-app-store-may-2026.md, https://sign.expo.dev/, https://sign.expo.dev/how-it-works, https://docs.expo.dev/guides/ios-developer-mode/, module pages for sqlite, notifications, speech, securestore, document-picker, widgets under https://docs.expo.dev/versions/latest/sdk/
- GitHub and CI: https://docs.github.com/en/billing/concepts/product-billing/github-actions, https://docs.github.com/en/billing/reference/product-usage-included, https://codemagic.io/pricing/, https://cicdpipelinecost.com/github-actions-pricing, https://sengi.run/blog/github-actions-pricing
- Sideloading tools: https://docs.sidestore.io/docs/faq, https://docs.sidestore.io/docs/installation/prerequisites, https://docs.sidestore.io/docs/installation/install, https://docs.sidestore.io/docs/troubleshooting/common-issues, https://faq.altstore.io/altstore-classic/your-altstore.md, https://faq.altstore.io/altstore-classic/altserver.md, https://faq.altstore.io/altstore-classic/app-ids.md, https://faq.altstore.io/release-notes/altstore.md, https://developer.altstore.io/, https://raw.githubusercontent.com/rileytestut/AltStore/develop/AltStore/Operations/FetchProvisioningProfilesOperation.swift, https://sideloadly.io/
- Community/anecdotal: https://loopkit.github.io/loopdocs/build/build-free-loop/, https://loopkit.github.io/loopdocs/build/apple-developer/, https://github.com/LoopKit/Loop/issues/2532, https://github.com/kinoko34077/gesture-ime/issues/144, https://github.com/kinoko34077/gesture-ime/pull/145, https://zudo-tauri-wisdom.takazudomodular.com/docs/mobile/ios-signing-free-team/, https://github.com/adro0303/ipa-builder, https://github.com/misaka310/ios-sidestore-deploy, https://dev.to/oivoodoo/build-unsigned-ios-ipa-to-install-via-sideloadly-236f, https://macmagazine.com.br/post/2026/06/18/altstore-pal-loja-alternativa-a-app-store-ja-esta-disponivel-no-brasil/
- Web platform: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/, https://webkit.org/blog/14403/updates-to-storage-policy/, https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/, https://caniuse.com/speech-recognition, https://caniuse.com/wake-lock, https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide, https://dev.to/prototyp/what-we-learned-about-pwas-and-audio-playback-50eh, https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/
