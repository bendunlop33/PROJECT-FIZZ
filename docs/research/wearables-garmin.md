# Wearables and Garmin: what's worth reading, and how (read-only)

Researcher. All sources were checked on 2026-10-08. Nothing was installed or signed up for, and no credentials were entered. Labels: **[Doc]** = official documentation, or a tool's own source code or docs. **[Reports]** = forums, vendor blogs, press and third-party guides. **[Inference]** = my reasoning, not yet proven. **Scope (Ben, via coordinator):** read-only from Garmin. Nothing is uploaded or written back to Garmin, Apple Health or Strava.

## Summary

1. **What Ben would actually use:** the most valuable data is his **real runs and rides** (date, sport, duration, distance, average HR). They feed playbook rules C3/C4: protect a key long run, and don't assume fatigue without data. Sleep duration and resting HR are secondary context. The vendor blog's "HRV readiness" pitch is marketing (it ranks its own app first). Body Battery and Training Readiness are not available through any read route open to Ben.
2. **Garmin's developer APIs are closed to him.** The Connect Developer Program is "only for business use". New API access requests have been **paused since about mid-2026, with no reopening date**. It is also cloud-to-cloud, so it would need a server. The Training API and Connect IQ are write routes and are not pursued, per Ben.
3. **HealthKit is probably not available on the current SideStore install.** Apple supports HealthKit on free teams via Xcode, but SideStore's signing code only turns on App Groups and Inter-App Audio. It signs with *profile ∩ app* entitlements, so the HealthKit entitlement is likely dropped. Only a probe on the device can settle this. Even if HealthKit works, Garmin writes workouts, heart rate, resting HR (reported), sleep and energy to Apple Health, but **not HRV, Body Battery or Training Readiness**.
4. **Recommendation:** make **FIT file import the primary route**, not a fallback. It needs no entitlement, no account and no server. Add a cheap read-only HealthKit probe to the next probe build, and build HealthKit reading only if the probe passes. Optional later: live HR over Bluetooth, if Ben's watch model can broadcast it.
5. **Proposed brief changes are included.** They contradict the brief in three places: the "Garmin approval" dependency (it is effectively closed), HealthKit as a near-term route on the free install, and Strava (the MCP is Claude-only, while our coach uses ChatGPT).

## Recommendations

1. **Ask Ben (blocking for phase choice):**
   - Which Garmin watch model, and its firmware version? This decides whether it can broadcast HR over Bluetooth, and which strength and HRV features it has.
   - A screenshot of **Garmin Connect → Settings → Connected Apps → Apple Health** with its toggle list. That is the authoritative list of what his account can write.
   - Which data he cares about: runs and rides only, or also sleep and resting HR, HR during lifts, HRV?
   - Does he use Strava? Does he record strength sessions on the watch too?
2. **Next probe build (cheap, settles the biggest unknown):** add a read-only HealthKit probe.
   - Use `@kingstinct/react-native-healthkit@16.1.0` with plugin options `NSHealthUpdateUsageDescription: false` and `background: false`, so no write key and no background-delivery entitlement.
   - Call `isHealthDataAvailable()`, then `requestAuthorization({ toRead: [workouts, heartRate, restingHeartRate, sleepAnalysis, HRV SDNN] })`, then query the last 14 days.
   - Record three things: whether the permission sheet appears, the exact error (a "Missing com.apple.developer.healthkit entitlement", Code 4, means SideStore stripped it), and which sample types come back with the source "Connect".
3. **Phase 1 (build step 6, or earlier if Ben wants it): FIT import.** Ben exports activities from Garmin Connect on the web, or copies them off the watch over USB on his Windows laptop, and shares them to the app.
   - Parse them with the MIT-licensed `fit-file-parser` (or Garmin's own SDK; see licence note in §2d) in `packages/providers`.
   - Store them as `EnduranceActivity` with full provenance and de-duplicate them.
   - Endurance sports go to the weekly plan and Progress. Strength activities recorded on the watch are only matched to our sessions, as an optional HR summary.
4. **Phase 2 (only if the probe passes): HealthKit read on app open.**
   - Read with anchored queries: non-strength workouts, resting HR and sleep, with the source labelled "Garmin via Apple Health".
   - Don't use background delivery, and never request write access.
   - If the probe fails, HealthKit waits for the paid-programme upgrade trigger already listed in ADR 0004.
5. **Phase 3 (optional, model-dependent): live HR over Bluetooth** from the watch's "Broadcast Heart Rate" mode during a workout.
   - It is display-only, plus a stored per-set average HR with its source.
   - It is not used for progression unless Ben approves a playbook rule for it.
6. **Do not build:**
   - the Garmin Health or Activity API (business-only and paused);
   - unofficial Garmin login libraries (they would put his Garmin password in the app, are a grey area under Garmin's terms, and broke in March 2026);
   - Strava API ingestion (its policy bans AI use);
   - Training API pushes or Connect IQ write apps (Ben: read-only).
7. **Honest display (rule 6):**
   - Show only fields the source actually provided, each with a source tag and import date.
   - HRV, Body Battery, Training Readiness, VO2max and "recovery" show as **Not available from your sources**, never as an estimate.
   - Never show a combined strength + endurance score (concurrent-training C8; design `progress.md` already says so).

---

## 1. What wearable features are valued

### 1a. The SensAI blog (vendor bias flagged)

Source: https://www.sensai.fit/blog/best-ai-workout-app (published 8 May 2026, updated 12 Sep 2026).

- **Bias [Doc, the page itself]:** it is written by SensAI ("we build SensAI"), which ranks itself #1. The ranking uses a "Tier 3 = reads wearable recovery data" test that SensAI designed. SensAI is the only Tier 3 app, so the conclusion follows from the test design. SensAI's App Store rating rests on 30 ratings.
- **What it claims is valuable [Reports, vendor marketing]:**
  - HRV, sleep and resting HR read via HealthKit "from Apple Watch, Garmin, Oura, WHOOP";
  - a daily readiness summary;
  - HRV as a "multi-day trend against your own baseline";
  - a resting HR rise of 5+ bpm as a stress flag (no source given for the threshold);
  - and explicitly *not* "silently swapping your Tuesday session because one HRV reading dipped".
- **What it says of competitors [Reports]:**
  - Fitbod's watch support "covers logging, not recovery".
  - Juggernaut AI has no wearable integration.
  - Dr. Muscle and Alpha Progression have Apple Health sync but read no recovery signals.
  - Arvo and SmartGym have native Apple Watch apps.
- **Evidence it cites:** mostly general app adherence and LLM-plan quality. It cites HRV-guided training studies in endurance athletes (Manresa-Rocamora 2021; a 2025 cyclist trial). None of these studies tests HRV-guided *strength* programming.
- **Key contradiction for Ben [Inference, supported by §2a]:** the blog implies Garmin HRV reaches apps "via HealthKit". Every source I found says Garmin does **not** write HRV to Apple Health. SensAI's own help page routes Garmin through Apple Health (https://www.sensai.fit/help/connect-wearable-to-sensai-apple-health), so for Garmin users its "HRV readiness" probably has no Garmin HRV behind it. I did not verify this in its app.

### 1b. User feedback

Reddit was not reachable from my tools (the domain is blocked to the crawler). I used Garmin forums and press instead. This is a qualitative sample, not a survey.

| Theme | Evidence | Label |
|---|---|---|
| **One record of a lifting session that includes the watch's HR**, instead of running two systems (the phone logger plus a Garmin Strength activity) | Garmin forum request: Hevy on the phone while the watch records HR, merged into one record (top replies +12 and +6, ~14 months old): https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience. Venu 3 thread "no way to connect Hevy with Garmin": https://forums.garmin.com/sports-fitness/healthandwellness/f/venu-3-series/426499/request-for-hevy-integration-with-garmin-connect | Reports |
| Hevy has no Garmin sync. Reportedly Garmin approved only a restricted integration that couldn't push sets, reps or weight, and Hevy declined | the5krunner, 24 Mar 2026: https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/. Hevy's help article (cited in the brief) returned 403 today | Reports |
| Live HR during a workout is shown for reference only, not used to adapt | Fitbod help "Live Heart Rate Tracking": a Garmin watch can broadcast HR, which is "displayed during your workout for your reference … not used to … adjust your workout" (search snippet; the page returned 403 on direct fetch): https://help.fitbod.me/hc/en-us/articles/39224086573207-Live-Heart-Rate-Tracking | Doc (via snippet) |
| Garmin itself is moving into strength (Connect+ live HR and rep counts on the phone; Garmin Fitness Coach plans adjusting to Body Battery and HRV) | the5krunner, above | Reports |
| Users want SpO2, VO2max and respiration in Apple Health, which Garmin doesn't send | https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/254977/request-for-spo2-vo2-max-and-respiration-data-to-be-shared-to-apple-health-app | Reports |
| Garmin data in Apple Health is coarse: HR every ~2 min, steps in 10–15 min blocks; distance mismatches | https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/427363/data-consistency-between-apple-health-and-garmin | Reports |

### 1c. What this means for Ben [Inference]

| Feature | Value for Ben's coach | Available read-only? |
|---|---|---|
| **Actual runs and rides** (sport, start, duration, distance, avg/max HR) | **High.** It turns weekly-plan `Not confirmed` into `Done`, and gives C3/C4 real data ("you ran 21 km yesterday") instead of guesses (brief scenarios 3 and 9) | Yes: FIT (always); HealthKit (if the probe passes) |
| Sleep duration, resting HR | Medium-low. Context for "I feel flat", shown only with its source. No proven rule should change loads from it | HealthKit only (if the probe passes); bulk export JSON (unverified) |
| HR during sets | Low for progression decisions; nice to see | Live via Bluetooth broadcast (model-dependent); coarse via HealthKit/FIT afterwards |
| HRV / readiness / Body Battery / Training Readiness | Unproven for strength decisions. Garmin doesn't expose them through any read route Ben can use | No (bulk export may contain summaries; unverified) |
| Watch-based set logging | Wanted by users, but it is a write/Connect IQ route | Not pursued (Ben) |

Evidence on whether HRV-guided *strength* training beats a plan wasn't in scope. It is a good topic for `training-researcher` before any readiness rule is proposed.

## 2. Feasible routes (iPhone 17, iOS 26.6.1, free Apple ID + SideStore, Garmin watch, model unknown)

### 2a. Apple Health / HealthKit (read-only)

**What Garmin Connect writes to Apple Health.** Garmin's own support FAQ (`support.garmin.com …?faq=lK5FPB9iPF5PXFkIpFlFPA`, the one cited in the brief) returned **HTTP 403** in every locale I tried. The table therefore relies on secondary sources. **Ben's Connected Apps toggle screen is the deciding source.**

| Field | Written by Garmin? | Evidence | Label |
|---|---|---|---|
| Workouts (activities) | **Yes**, without GPS routes | the5krunner (updated 3 Oct 2026): https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/. Apple Discussions quoting Garmin's list, "Workouts (Activities uploaded to Garmin Connect)" (2020) | Reports |
| Heart rate | **Yes**, all-day. For timed activities "may only send high and low" values. Samples ~every 2 min | the5krunner (above); Garmin forum 427363 (above) | Reports |
| Resting heart rate | **Probably yes** | reaction-club guide (Dec 2025, no Garmin citation): https://www.reaction-club.com/guides/garmin-apple-health. Not in the older Garmin list | Reports (weak) |
| Sleep | **Yes**, "sleep analysis". Whether stages come through is unconfirmed | the5krunner; reaction-club says "duration and stages" | Reports |
| Active and resting energy, steps, distance, flights, weight, body fat, BMI, blood pressure, water | Yes | the5krunner | Reports |
| **HRV** | **No** | Constant (vendor, 22 Jul 2026): "HRV … stays inside Garmin Connect": https://trainconstant.com/blog/garmin-apple-health. No source claims it does, except one unreliable page | Reports |
| VO2max | **Conflicting; treat as No until seen** | Guides disagree (search, 8 Oct 2026); there is an open forum request to add it (254977) | Reports |
| Body Battery, Training Readiness, stress, training load/status | **No** | Absent from every list. the5krunner expects "Recovery Data probably won't be sent". Sahha (19 Sep 2026) relies on Apple Health only for "where users have enabled Garmin's write" | Reports + Inference |
| SpO2, respiration | No (one user report says these are the only things missing) | Forum 254977 | Reports |
| Direction | **One-way**, Garmin → Health. Garmin Connect doesn't read from Health | Garmin forum threads (above); the5krunner | Reports |

Also note [Doc]: Apple's HRV type is **SDNN** ("HealthKit uses SDNN heart rate variability"), https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn. Garmin's HRV Status is a different overnight measure (commonly reported as RMSSD [Reports]). Even if a source wrote HRV, the two numbers would not be comparable.

**Read-only HealthKit is supported [Doc].** Source: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data.
- Read and share are permissioned separately per type, and the user can toggle each one individually.
- `NSHealthShareUsageDescription` covers reading; `NSHealthUpdateUsageDescription` covers writing.
- "Your app doesn't know whether someone granted or denied permission to read data." Denied reads simply return no samples.
- New on iOS 26 docs: the user can grant "only a limited window of recent data", which can be discovered via `earliestAuthorizedSampleDate`. "Avoid interpreting the absence of older samples as evidence they don't exist."

Implication for the UI [Inference]: the app must never say "you didn't sleep" or "no runs". It should say "Nothing from Apple Health for this period".

**`@kingstinct/react-native-healthkit` [Doc].**
- Version `16.1.0`; peer dependencies `react >=19`, `react-native >=0.79`, `react-native-nitro-modules >=0.35`. https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest
- Read-only request: `requestAuthorization({ toRead: [...] })`. Workouts are returned as proxies with `getAllStatistics()` and `getWorkoutRoutes()`. "Will not work in Expo Go". https://github.com/kingstinct/react-native-healthkit
- Plugin source (https://raw.githubusercontent.com/kingstinct/react-native-healthkit/master/packages/react-native-healthkit/app.plugin.ts):
  - `NSHealthUpdateUsageDescription` falls back to "… wants to update your health data" unless set to `false`;
  - **background delivery is "Enabled by default; set to `false` to opt out"**, which adds a background-delivery entitlement.
  - **Use `{ NSHealthUpdateUsageDescription: false, background: false }`** for a read-only, minimum-entitlement build.

**Does the HealthKit entitlement survive a free Apple ID + SideStore install?** No direct test report was found. The evidence:

- [Community, earlier research] Free Personal Teams can use HealthKit when built from Xcode on a Mac (LoopDocs keeps "HealthKit DO NOT DELETE"). See `free-ios-install.md` §1.2. Apple's policy therefore isn't the blocker.
- [Doc, source code] SideStore's AltSign maps only `com.apple.security.application-groups` and `inter-app-audio` to App ID features. `com.apple.developer.healthkit` does not appear. https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Capabilities/ALTCapabilities.m (AltStore's upstream copy is the same: https://raw.githubusercontent.com/rileytestut/AltSign/master/AltSign/Capabilities/ALTCapabilities.m)
- [Doc, source code] SideStore's signer starts from `profile.entitlements` and keeps only those the app also declares. https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Signing/ALTSigner.mm
- [Inference] The free profile will only contain HealthKit if the App ID has the HealthKit feature enabled. SideStore never enables it. So the installed app most likely has **no** HealthKit entitlement: it installs and runs, but HealthKit calls fail with the "Missing com.apple.developer.healthkit entitlement" error. This matches the App Group behaviour already seen in `docs/device-tests/2026-10-08-probe-build7.md`, where SideStore rewrote the identifiers it does handle.
- [Reports] One GitHub project note says a free-signed SideStore build can lack the entitlement (search result; the page returned 404 on fetch). Weak.
- **Conclusion:** plan on HealthKit being **unavailable** on the current install route until a probe shows otherwise. Sideloadly's handling is undocumented and is a possible second test. Xcode needs a Mac. The paid programme is the documented fix (already an ADR 0004 upgrade trigger).

**Free-provisioning check [Inference].**
- The probe adds `com.apple.developer.healthkit` (and `…healthkit.access` only if the plugin insists) to the IPA's signature. SideStore filters it out rather than failing the install.
- This is the same filtering mechanism seen with App Groups, but HealthKit itself is **untested**.
- CLAUDE.md already lists HealthKit as a runtime-detected capability flag, so a probe is in scope. Keep `background: false`.

**No-entitlement alternative [Doc, via Apple Support search snippet].** The Health app can "Export All Health Data … in XML format" and share the file (https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios; the page body didn't render, so this comes from the search snippet). [Inference] It contains whatever Garmin wrote, including sleep and resting HR, but it is an all-time file that can be very large, and parsing it on the phone in JavaScript is slow. Treat it as a last-resort, one-off import, not a routine route.

### 2b. Garmin Connect Developer Program (Health / Activity API: pull)

- [Doc] "There are no licensing or maintenance fees … **but it is only for business use**." Access to some metrics "may require a license fee payment or minimum device order quantity for commercial use". All APIs use OAuth 2.0. https://developer.garmin.com/gc-developer-program/program-faq/
- [Doc] The APIs "enable **cloud-to-cloud** based integrations". https://developer.garmin.com/gc-developer-program/overview/
  - Health API: "heart rate, steps, calories, sleep, respiration, body composition … stress, pulse-ox"; "Ping/Pull or Push Architecture"; "Commercial use requires a license fee payment". https://developer.garmin.com/gc-developer-program/health-api/
  - [Inference] Ping and Push both need a public HTTPS endpoint, i.e. a server, which conflicts with the brief's no-server default.
- [Reports] **New applications are paused.**
  - A Garmin email quoted by applicants: "we have temporarily paused the review and approval of new API access requests … unable to provide a specific timeline". Sahha, 19 Sep 2026: https://sahha.ai/blog/garmin-developer-program-paused/
  - Garmin forum, 2026: "New API access requests are paused, with no projected re-opening date"; the application form was removed: https://forums.garmin.com/developer/connect-iq/f/discussion/434542/garmin-connect-developer-program---access-request-rejected-without-notification
  - Garmin's page says only "Stay tuned for more updates on the program" [Doc].
- **Verdict:** not feasible for Ben. He isn't a business, it's paused, and it needs a server. Drop "Garmin approval/partner route" as an open dependency.
- **Training API** (pushes workouts to the watch: https://developer.garmin.com/gc-developer-program/training-api/): **not pursued, per Ben** (it's a write route, and it's under the same pause).
- **Unofficial libraries** (`python-garminconnect`, the deprecated `garth`): [Reports] Garmin changed its login in March 2026, `garth` was deprecated on 27–28 Mar 2026, and Cloudflare TLS fingerprinting now blocks non-browser clients. https://github.com/matin/garth/discussions/222, https://github.com/isllabres/garmin-mcp-server/pull/16. They would also require Ben's Garmin password in the app. **Don't build.**

### 2c. Garmin Connect IQ

**Not pursued, per Ben** (it's a watch-side app; the most-requested uses are set logging and rest timers, which are write/interaction routes). Record for later:
- [Doc] The SDK Manager and the VS Code Monkey C extension support Windows. https://developer.garmin.com/connect-iq/sdk/
- [Reports] A `.prg` can be sideloaded to your own watch over USB into `GARMIN/APPS`. Newer watches use MTP, and sideloaded apps can't use Store settings. https://forums.garmin.com/developer/connect-iq/w/wiki/4/new-developer-faq/revision/19

### 2d. FIT file import (primary route)

**How Ben gets the files:**
- [Reports] The Garmin Connect mobile app doesn't export files. On the **web**, open an activity, then gear icon → "Export File/Export Original" gives a ZIP containing the original FIT. https://support.strava.com/en-us/articles/15402167-exporting-files-from-garmin-connect, https://www.gneta.app/blog/export-garmin-data-guide (vendor, updated 10 Aug 2026)
- [Reports] Bulk: Garmin Account → Data Management → Export Your Data. It's emailed, takes up to days or weeks, and holds FIT files in nested ZIPs under `DI_CONNECT/…Uploaded-Files`. Per Gneta, wellness JSON (e.g. `sleepData.json`) sits under `DI-Connect-Wellness/`, and training status is not included. Unverified; useful for a one-off history import.
- [Inference] He can also copy FIT files straight off the watch over USB (MTP) on his Windows laptop (watch `GARMIN/Activity` folder), with no Garmin account involved.
- [Inference] Whether Garmin Connect's website works in Safari on the iPhone (desktop mode) is untested. If it does, Ben can export and share to our app without the laptop.

**Parsing:**
- [Doc] `fit-file-parser@6.1.2`: MIT licence, one dependency (`buffer`). https://registry.npmjs.org/fit-file-parser/latest
- [Doc] Garmin's `@garmin/fitsdk@21.218.0` is browser-capable (`Stream.fromArrayBuffer`), but its licence is "for Licensee's internal business purposes", treats the software as confidential, and forbids distributing it to third parties. https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/LICENSE.txt
- [Inference] The MIT parser is the cleaner choice. Pin the exact version, and parse untrusted bytes defensively (rule 8).

**Behaviour [Inference]:**
- **Endurance sports:** create `EnduranceActivity` records with:
  - `source: 'garmin_fit'`, the device product and serial from `file_id`, and the original file SHA-256;
  - **de-duplication** on `file_id` (serial + time created), plus the checksum (brief scenario 6).
- **Strength activities recorded on the watch:** never create a second workout. Offer to attach HR stats (avg/max over the overlapping window) to the matching app session, with its source. This follows the brief's "detect overlapping device activities".
- Keep the raw file (or a hash plus the fields used) as provenance.

### 2e. Strava

- [Doc] API Policy, effective 1 Jun 2026: API data and derivatives may not be used "in connection with the development … training, … grounding, evaluation" of AI. That prohibition "does not extend to use of the Strava MCP". Subscribers may use the MCP for "personal use of their own Strava data" and "bring their own AI Application". https://www.strava.com/legal/api_policy
- [Doc] The Strava MCP connector is "launching with Anthropic (Claude)". It is subscribers-only, and trials don't qualify. https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector
- [Inference] Our coach runs on Ben's ChatGPT plan (brief v0.6), and Strava's data would come from his Garmin anyway. So Strava adds nothing that FIT or HealthKit don't, and carries policy risk. **Not a route now.** Don't route Strava data into Apple Health or anywhere else as a workaround (brief rule).

### 2f. Live HR over Bluetooth (optional, read-only)

- [Doc] Garmin manuals, "Broadcasting Heart Rate Data": the watch broadcasts HR to paired devices, and can do so automatically when an activity starts; it "decreases battery life". https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html
- [Reports] Older or cheaper models broadcast only over ANT+, which iPhones can't receive. Newer ones (e.g. Fenix 6 from 2020 firmware) broadcast over Bluetooth Smart too, readable by iPhone apps. DC Rainmaker, 24 Jun 2020: https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html; Zwift, https://www.zwift.com/eu-de/news/21185-do-i-need-a-watch-to-run-on-zwift
- [Inference] CoreBluetooth needs only `NSBluetoothAlwaysUsageDescription` (plus an optional `bluetooth-central` background mode in Info.plist), with no provisioning entitlement, so it is free-provisionable. It could use a React Native BLE library or a small addition to our Swift module. **Model-dependent: ask Ben.**

## 3. Recommendation: phased plan, display and coach use

### Phases (lowest risk first)

| Phase | What | When | Risk | Value |
|---|---|---|---|---|
| 0 | Ask Ben the questions in Recommendation 1. Add the **read-only HealthKit probe** to the next probe build | Now (step 1 spikes) | Very low | Settles the HealthKit route |
| 1 | **FIT import** of endurance activities (+ optional HR attachment for overlapping strength sessions); Profile → Data sources screen | Build step 6 (endurance imports), or earlier if Ben asks | Low; no entitlement or account | High: real runs and rides for C3/C4 and the weekly plan |
| 2 | **HealthKit read** (workouts, resting HR, sleep) on app open, only if the probe passed | After phase 1 | Medium (entitlement, coarse data) | Medium: automatic, no manual export |
| 3 | **Bluetooth live HR** during workouts (display, per-set avg) | Native polish (step 7), if the model supports it | Medium (battery, model) | Low–medium |
| — | Garmin APIs, unofficial login, Strava API, Training API, Connect IQ | Not pursued | — | — |

### What to show in the app [Inference; consistent with `docs/design/progress.md` §2.8 and `weekly-plan.md` WP3]

- **Separate endurance data:** one card per sport, never a combined "fitness" or "load" number (C8).
- **Source labels on every value**, e.g. `Garmin FIT file, imported 3 Oct` or `Garmin via Apple Health, read 8 Oct`. Add the device name when FIT provides it.
- **Profile → Data sources:** one row per source, with an honest status: `Garmin FIT files: last import 3 Oct` · `Apple Health: not available on this install` / `allowed; last read 08:12` · `Live heart rate: watch not paired`. No "Connected to Garmin" wording, since we never connect to Garmin.
- **Unavailable metrics stay unavailable:** no estimates of HRV, Body Battery, Training Readiness, VO2max or recovery. If Ben asks, the coach says Garmin doesn't share them with the app.
- **Readiness stays self-reported** (P11 / brief §12 Today). Sleep and resting HR may be shown as plain facts in context. They are not a score and do not appear on Today by default (a designer decision).

### How it feeds the coach [Inference; rules from `docs/training-guides/concurrent-training.md`]

- **New restricted tools:**
  - `get_endurance_activities(range)` returns imported activities with sport, start, duration, distance, avg HR (if present), `source` and `importedAt`;
  - `get_wellness_observations(range)` returns sleep duration and resting HR with source and missing-data flags.
  - Neither returns derived scores. Both are read-only, so they need no proposal machinery.
- **C3 (protect key sessions):** uses the *planned* key run or ride from the weekly plan. Imported data only confirms what happened. Example: heavy squats planned Thursday and a key long run on Saturday → the coach offers a proposal (move, swap to upper body, or cut leg volume) with Apply/Undo. It never overwrites the run.
- **C4 (day after):** "You ran 21.1 km yesterday (Garmin FIT, imported this morning). Want lighter legs today?" This is offered, not applied (rule 3). With no import and no report, the coach says nothing about fatigue (scenario 9).
- **Actual run load:** weekly summaries list running time and distance from imports, separately from lifting sets. A planned-but-unconfirmed session stays `Not confirmed`.
- **Sleep and resting HR:** cited as facts only, with their source ("Garmin recorded 5 h 10 min of sleep"). They don't trigger load changes unless Ben approves a playbook rule. A readiness rule should first go through `training-researcher`.
- **Imported files are data, not instructions (rule 8):** activity names and notes from FIT files are never treated as commands.

## 4. Unknowns only a real end-to-end test can settle

1. Ben's watch model and firmware, and whether it broadcasts HR over Bluetooth during a Strength or Run activity.
2. Whether the HealthKit entitlement survives SideStore (0.7.0 nightly) signing, and the exact error if not. A second check would be Sideloadly.
3. If HealthKit works: which types Garmin actually writes for Ben's account (the toggle list), whether resting HR, sleep stages and VO2max appear, the HR sample density inside workouts, and how Garmin's Strength activity maps to an Apple workout type.
4. Whether Garmin Connect writes to Apple Health only while its app is open or foregrounded (claimed by one guide, unverified), and whether it backfills history from before the toggle was enabled.
5. Whether Garmin Connect's web export works from Safari on the iPhone, and whether its share sheet hands the ZIP to our app (we need ZIP extraction).
6. How FIT files from Ben's watch represent strength sets (`set` messages) and HR, and how well overlap matching with app sessions works.
7. What Garmin's bulk export contains for sleep and HRV today (it's a one-off; Ben would request it himself).
8. Battery cost of Bluetooth HR broadcast over a 75-minute session.

## Proposed brief changes (for Ben's approval)

1. **Connections → Garmin (contradicts the brief's framing).** Replace with:
   > "Read-only. The app never uploads or writes to Garmin (Ben). The Garmin Connect Developer Program is business-only, cloud-to-cloud (needs a server) and paused for new applicants (Sept 2026), so it is not a route for this personal app. Unofficial login libraries are not used. Primary route: FIT file import. Secondary: Apple Health read, if the capability probe passes. Optional: live HR via the watch's Bluetooth broadcast."
2. **§11 dependencies:** remove "Garmin approval/partner route, source-level data permissions". Add "Ben's watch model; Garmin Connect → Apple Health toggle list; HealthKit probe result on the SideStore install".
3. **Connections → Apple Health:** add a confirmed-field table (workouts, HR, sleep, energy: yes; resting HR: probably; HRV, Body Battery, Training Readiness, stress, SpO2: no; VO2max: unconfirmed). Note that Apple HRV is SDNN and not comparable with Garmin HRV. Note that **HealthKit is likely stripped by SideStore re-signing**, so it is not a near-term route unless the probe passes or Ben upgrades (ADR 0004 trigger). Request read-only: no `toShare`, `NSHealthUpdateUsageDescription: false`, `background: false`.
4. **Connections → Strava:** add "The Strava MCP currently supports Claude only and requires a paid subscription. Our coach uses ChatGPT, and Ben's activities originate on Garmin, so Strava is not a route now."
5. **§5 Data foundation / §6 data model:**
   - Make FIT import (with `file_id` + checksum de-duplication and overlap matching to app sessions) an explicit build step 6 item.
   - Add a `WellnessObservation` entity (metric, value, unit, source, device, sample window, read/import time). `ReadinessEntry` stays self-reported only.
6. **§8 coach tools:** add read-only `get_endurance_activities` and `get_wellness_observations`, which return source and missing flags and no derived scores.
7. **Validation scenarios:** extend 9: "Garmin data is present but HRV, Body Battery and Training Readiness are absent: the coach says they're not available from Ben's sources and doesn't estimate them." Add a scenario: "the same FIT file imported twice, or a watch strength activity overlapping an app session: no duplicate workout".
8. **ADR needed when phase 1 starts:** "Wearable data: read-only, FIT-first; HealthKit behind a capability flag". It records the rejected routes (Garmin APIs, unofficial login, Strava API, Training API, Connect IQ) and why.

No contradiction with CLAUDE.md was found. HealthKit is already a runtime capability flag there, and read-only use fits rules 6–8.

## Sources (all checked 2026-10-08)

- Vendor blog: https://www.sensai.fit/blog/best-ai-workout-app, https://www.sensai.fit/help/connect-wearable-to-sensai-apple-health
- Apple: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data, https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn, https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios
- HealthKit module: https://github.com/kingstinct/react-native-healthkit, https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest, https://raw.githubusercontent.com/kingstinct/react-native-healthkit/master/packages/react-native-healthkit/app.plugin.ts
- SideStore/AltStore signing source: https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Capabilities/ALTCapabilities.m, https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Signing/ALTSigner.mm, https://raw.githubusercontent.com/rileytestut/AltSign/master/AltSign/Capabilities/ALTCapabilities.m, https://raw.githubusercontent.com/rileytestut/AltStore/develop/AltStore/Operations/FetchProvisioningProfilesOperation.swift
- Garmin official: https://developer.garmin.com/gc-developer-program/program-faq/, https://developer.garmin.com/gc-developer-program/overview/, https://developer.garmin.com/gc-developer-program/health-api/, https://developer.garmin.com/gc-developer-program/training-api/, https://developer.garmin.com/connect-iq/sdk/, https://developer.garmin.com/fit/overview/, https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/LICENSE.txt, https://github.com/garmin/fit-javascript-sdk, https://registry.npmjs.org/@garmin/fitsdk/latest, https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html. Garmin support FAQ (403, not read): https://support.garmin.com/en-NZ/?faq=lK5FPB9iPF5PXFkIpFlFPA&productID=125677
- Garmin forums: https://forums.garmin.com/developer/connect-iq/f/discussion/434542/garmin-connect-developer-program---access-request-rejected-without-notification, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/427363/data-consistency-between-apple-health-and-garmin, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/254977/request-for-spo2-vo2-max-and-respiration-data-to-be-shared-to-apple-health-app, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience, https://forums.garmin.com/sports-fitness/healthandwellness/f/venu-3-series/426499/request-for-hevy-integration-with-garmin-connect, https://forums.garmin.com/developer/connect-iq/w/wiki/4/new-developer-faq/revision/19
- Press and third-party: https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/, https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/, https://sahha.ai/blog/garmin-developer-program-paused/, https://trainconstant.com/blog/garmin-apple-health, https://www.reaction-club.com/guides/garmin-apple-health, https://www.gneta.app/blog/export-garmin-data-guide, https://support.strava.com/en-us/articles/15402167-exporting-files-from-garmin-connect, https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html, https://www.zwift.com/eu-de/news/21185-do-i-need-a-watch-to-run-on-zwift, https://github.com/matin/garth/discussions/222, https://github.com/isllabres/garmin-mcp-server/pull/16, https://help.fitbod.me/hc/en-us/articles/39224086573207-Live-Heart-Rate-Tracking (403; search snippet only)
- FIT parser: https://registry.npmjs.org/fit-file-parser/latest
- Strava: https://www.strava.com/legal/api_policy, https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector
- Project docs read: `CLAUDE.md`, `docs/brief/training-app-build-brief.md`, `docs/brief/CHANGELOG.md`, `docs/decisions/0004-free-distribution-sidestore.md`, `docs/research/free-ios-install.md`, `docs/research/ios-platform-feasibility.md`, `docs/training-guides/concurrent-training.md`, `docs/device-tests/2026-10-08-probe-build7.md`, `docs/design/progress.md`, `docs/design/weekly-plan.md`
