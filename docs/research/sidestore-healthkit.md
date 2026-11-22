# HealthKit under SideStore on a free Apple ID

Checked 26 Oct 2026. Labels: **[Doc]** official docs, **[Code]** source read, **[Community]** user/maintainer reports,
**[Inference]** my reasoning. Context: ADR 0035, `free-ios-install.md` §1.2, device test `2026-10-27-apple-health.md`
(build 419: `Not available on this install`).

## Summary

1. **Verdict: likely works, with a patched SideStore. It does not work with stock SideStore (any release) or AltStore.** The cause is a missing mapping in the signing library, not an Apple refusal.
2. The entitlement is dropped because SideStore's signer keeps only what the provisioning profile grants. The profile has HealthKit only if the App ID has it, and SideStore never turns HealthKit on because its free-team feature list has App Groups and Inter-App Audio only [Code].
3. An open SideSign PR (#3, 3 Oct 2026) adds that mapping (`HK421J6T7P`). Its author reports HealthKit working through SideStore on a free Apple ID. That is one unreviewed, unmerged on-device report [Community].
4. **Top option:** build SideStore in CI with SideSign PR #3 applied, install it over Ben's SideStore, then install a GymSmarter `.ipa` again over the existing app. A plain refresh won't do it. About half a day of agent work, about 20 minutes for Ben, and a device test. Fallbacks: wait for upstream to merge it, use Xcode on a Mac, or pay for the Developer Program.
5. **Proposed brief/ADR change:** ADR 0035's "Consequences" and Q10 should add "patched SideStore" as a route (see the end).

## Recommendations

- **R1 (do first):** Ben approves a small CI workflow that builds SideStore with SideSign PR #3, then runs the device test below. No new accounts, nothing paid, our app's entitlements unchanged.
- **R2 (no cost, in parallel):** Ben (he already has a GitHub account) can leave a thumbs-up on SideSign PR #3. If it is merged and SideStore's nightly takes the new SideSign, R1 is replaced by switching SideStore to the nightly channel, with no custom build.
- **R3:** Don't patch AltStore Classic, Sideloadly or iloader. None of them maps HealthKit [Code/Doc]. They are listed here only as reasons to rule them out.
- **R4:** If the R1 test fails at "App ID update rejected", HealthKit on Ben's setup needs a Mac (Xcode, LoopDocs) or the paid programme. ADR 0035's runtime flag already handles that case.

## 1. Where the entitlement is lost (source)

The `.ipa` is fine. Our CI ad hoc signs the app with `Fizz.entitlements`, which includes `com.apple.developer.healthkit`
(`.github/workflows/ios-ipa.yml`, "Ad hoc sign with entitlements") [Code].

SideStore `develop` now uses **SideSign**, a Swift rewrite of AltSign added as a submodule (`.gitmodules`: `Dependencies/SideSign`,
https://github.com/SideStore/SideStore/blob/develop/.gitmodules). 0.6.x releases used SideStore's AltSign fork [Doc,
release notes https://github.com/SideStore/SideStore/releases].

| Step | Where | Behaviour |
|---|---|---|
| Entitlement → App ID feature | SideSign `Sources/Models/Feature.swift`, `init?(entitlement:)` | No HealthKit case. `freeFeatures = [.appGroups, .interAppAudio]`. HealthKit isn't even in `paidFeatures` [Code] https://github.com/SideStore/SideSign/blob/main/Sources/Models/Feature.swift |
| Allowed per team | SideSign `Sources/Models/Team.swift` | `.free → Feature.freeFeatures` and `Entitlement.freeEntitlements`. `com.apple.developer.healthkit` is only in `paidEntitlements` [Code] https://github.com/SideStore/SideSign/blob/main/Sources/Models/Entitlement.swift |
| App ID update | SideStore `SideStore/Core/Operations/PipelineOperations/FetchProvisioningProfilesOperation.swift`, `updateFeatures(for:targetAppBundle:team:)` | Maps each entitlement through `ALTFeature(entitlement:)` and keeps it only `if allowedFeatures.contains(feature)`. The rest go to `droppedFeatures`, which is only written to a debug log. Reuses the existing App ID by bundle ID, compares, then `updateAppID` [Code] https://github.com/SideStore/SideStore/blob/develop/SideStore/Core/Operations/PipelineOperations/FetchProvisioningProfilesOperation.swift |
| Signing | SideSign `Sources/CodeSigning/CodeSignerAPI.swift` (and old `ALTSigner.mm`) | Signed entitlements = **profile's entitlements ∩ app's entitlements**. "Never adds keys that the profile lacks" [Code] https://github.com/SideStore/SideSign/blob/main/Sources/CodeSigning/CodeSignerAPI.swift, https://github.com/SideStore/AltSign/blob/master/AltSign/Signing/ALTSigner.mm |
| Old AltSign (0.6.x, AltStore Classic) | `AltSign/Capabilities/ALTCapabilities.m` | `ALTFeatureForEntitlement` maps App Groups and Inter-App Audio only. `ALTFreeDeveloperCanUseEntitlement` excludes HealthKit. Same in Riley Testut's upstream [Code] https://github.com/SideStore/AltSign/blob/master/AltSign/Capabilities/ALTCapabilities.m, https://github.com/rileytestut/AltSign/blob/master/AltSign/Capabilities/ALTCapabilities.m |

Issues and PRs: no SideStore issue or PR mentions HealthKit (searched `healthkit`, 26 Oct). **SideSign PR #3 "Enable HealthKit
capability on App IDs"** (Edris-Rahimi, opened 3 Oct 2026, one commit `74950d3`, no reviews) adds `Feature.healthKit = "HK421J6T7P"`,
maps the entitlement to it, adds it to `freeFeatures` and `paidFeatures`, and adds `.healthKit` to `freeEntitlements`
[Code] https://github.com/SideStore/SideSign/pull/3. No release or nightly includes it [Doc, releases page]. The latest stable is
0.7.0-alpha (15 Sep). Ben's installed SideStore version is **unknown**.

## 2. Does Apple let a free team enable HealthKit on an App ID?

- **[Community] Yes through Xcode.** LoopDocs' free-account guide (Xcode 26.2) has builders delete Push, Siri, Time Sensitive
  and NFC, and says "HealthKit **DO NOT DELETE**", unchecking only Clinical Health Records.
  https://loopkit.github.io/loopdocs/build/build-free-loop/. Xcode's free provisioning uses the same developer-services
  endpoints that AltSign/SideSign wrap [Inference].
- **[Community] Yes through patched SideStore, one report.** In PR #3 the author built SideStore with the patch, used a free
  Apple ID, "Deleted the existing App ID, then installed a HealthKit app through SideStore". The new App ID had HealthKit, the
  entitlement was kept and the Health permission sheet appeared. Not independently verified. The author built "LiveContainer
  and SideStore", so the setup may differ from Ben's plain SideStore.
- **[Doc, not verified by us]** PR #3 cites Apple's capability table
  (https://developer.apple.com/help/account/reference/supported-capabilities-ios) as listing HealthKit for free accounts. Its
  tick marks don't render in our fetches. **Ben could open it in a browser and check the HealthKit row in the "Apple Developer" column (about 1 minute).**
- Feature ID `HK421J6T7P` matches fastlane's portal client [Code]
  https://github.com/fastlane/fastlane/blob/master/spaceship/lib/spaceship/portal/app_service.rb.
- Counter-evidence: an unanswered Apple forum post (Dec 2022) reports Xcode refusing a free account for HealthKit
  https://developer.apple.com/forums/thread/722522 [Community, weak, old].

## 3. Routes without a Mac (ranked)

| # | Route | Works? | Ben's effort | Agent effort | Notes |
|---|---|---|---|---|---|
| 1 | **Patched SideStore (SideSign PR #3), built in our CI** | Likely [Community + Code] | About 20 min once, phone only | About half a day | Steps in §4. Must not take upstream updates while patched |
| 2 | **Upstream merges PR #3, then the SideStore nightly channel** | Likely, if merged | 2 min (Settings › beta updates › nightly) | None | Timing is out of our control. SideStore docs warn nightly data may not carry over https://github.com/SideStore/SideStore-Docs/pull/173.diff |
| 3 | AltStore Classic + AltServer (Windows) | **No** | – | – | Same `ALTCapabilities.m` mapping [Code] |
| 4 | iloader / isideload | **No** | – | – | isideload 0.5.0 TODO: "Proper entitlement handling … just uses the bare minimum" [Doc] https://docs.rs/crate/isideload/latest |
| 5 | Sideloadly | Unknown, probably no | – | – | Entitlement handling undocumented. Closed source, can't patch |
| 6 | xtool (Linux) | Unknown | – | Read its source | Can sign and install IPAs with Apple Developer Services https://github.com/xtool-org/xtool. HealthKit mapping not checked |
| 7 | Sign in CI with Ben's free cert and profile | **Not recommended** | – | – | The profile only has HealthKit if the App ID does (needs route 1 or a Mac first). It is device-bound and lasts 7 days, so Ben's private key would sit in CI secrets and rotate weekly. SideStore re-signs on install anyway [Code] |
| 8 | Run inside LiveContainer | No | – | – | Entitlements come from the LiveContainer host, and data would live in LiveContainer's container. Not pursued [Inference] |

With a Mac: Xcode with Ben's Personal Team (LoopDocs). With money: the paid programme (ADR 0004 upgrade trigger).

## 4. Route 1 in detail

**Code change** (taken whole from PR #3 into SideSign; nothing changes in SideStore itself or in our app):
- `Sources/Models/Feature.swift`: `static let healthKit: Feature = "HK421J6T7P"`, a `case .healthKit: self = .healthKit` in
  `init?(entitlement:)`, and `.healthKit` in `freeFeatures` (and `paidFeatures`).
- `Sources/Models/Entitlement.swift`: add `.healthKit` (already defined as `com.apple.developer.healthkit`) to `freeEntitlements`.
- Leave `healthKitAccess` (clinical records) out. LoopDocs unchecks it for free teams, and our CI already forbids it.
- For a 0.6.x base instead, the same change goes into the AltSign fork: an `ALTFeatureHealthKit = @"HK421J6T7P"` and
  an `ALTEntitlementHealthKit` pair in `ALTCapabilities.m`/`.h`, both mapping functions, and `ALTFreeDeveloperCanUseEntitlement`.

**Build** [Inference, untested]: a new workflow in our repo (e.g. `.github/workflows/sidestore-patched.yml`, manual only) that
checks out SideStore at a pinned stable tag with submodules, points `Dependencies/SideSign` at PR #3's commit `74950d3`, and runs
SideStore's own `scripts/ci/workflow.py build`, which produces `SideStore.ipa`. The workflow needs no fork and no secrets.
**Risk:** SideStore's workflows use a custom `xcode-27` runner label and Xcode 27.2
(https://github.com/SideStore/SideStore/blob/develop/.github/workflows/nightly.yml). GitHub's `macos-26` image may not carry
Xcode 27, so the first run may need a version change.

**Ben's steps** (phone, no computer, if R1's install route works):
1. Make a GymSmarter backup (export) first.
2. Download the patched `SideStore.ipa` and install it through SideStore itself (+ › the `.ipa`). SideStore's docs: "sideload a
   nightly SideStore version via SideStore or AltServer and your data should be the same" [Doc] (SideStore-Docs PR #173 above).
   If that fails, use iloader from any computer ("Import any IPA", then place the pairing file) [Doc] https://github.com/nab138/iloader.
3. Turn off SideStore's beta/auto-update prompts and never accept an upstream SideStore update while relying on this.
4. **Install the GymSmarter `.ipa` again over the existing app.** A *refresh* won't fix it: the installed copy was already
   signed without the entitlement, and the signer keeps only keys the app itself declares [Code + Inference].
5. Profile › Apple Health: switches should appear. Continue the device test from §1.

**Maintenance:** each upstream SideStore release has to be rebuilt with the patch until PR #3 is merged (it is a three-line
diff, so rebasing is cheap). If an unpatched SideStore installs GymSmarter again later, it drops HealthKit, because
`updateFeatures` replaces the App ID's features with its own list [Code]. Data is safe, and the app falls back to
`Not available on this install`.

**Risks:**
- App ID limit (10 per 7 days on free teams, `Team.maximumFreeAppIDs`) [Code]. The patch reuses the existing App ID, so it
  costs nothing unless an App ID has to be deleted and re-created, as the PR author did. Don't delete one unless step 4 fails.
- Apple account: the change only turns on a capability that Xcode also turns on for free teams. Low risk [Inference].
- A custom SideStore is unsigned third-party code holding Ben's Apple ID session. Build only from the pinned upstream tag plus the reviewed diff.
- SideStore is AGPL. Personal, unpublished use is fine [Inference].

## 5. Unknowns that need the device

1. Whether `updateAppID` turns on HealthKit on Ben's **existing** App ID, or whether Apple rejects the change until the App ID is re-created (the PR author deleted his).
2. Whether the free profile then contains `com.apple.developer.healthkit` and our app gets the permission sheet. This also confirms §2.
3. Whether SideStore installs a custom SideStore `.ipa` over itself without losing its pairing or account.
4. Whether the patched SideStore build compiles on GitHub's hosted macOS runner.
5. Whether the next weekly refresh keeps HealthKit. Expected yes, because the App ID keeps the feature [Inference].

## Proposed brief / ADR changes (Ben approves)

- ADR 0035 "Consequences" and `apple-health.md` Q10: add **"patched SideStore (SideSign PR #3)"** as a fourth route next to
  Xcode, paid and none. Correct "SideStore's AltSign" to "SideSign" for SideStore 0.7+.
- `free-ios-install.md` §1.2 HealthKit row: the cause is now confirmed in code. Free-team support is backed by Xcode
  (LoopDocs) and one SideStore report, still to be confirmed on Ben's phone.
- Building a patched SideStore in our CI adds a dependency on third-party code. If adopted, record it in an ADR.
