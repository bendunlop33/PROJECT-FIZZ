# Garmin live data: Amalgama, LiveTrack, Bluetooth HR (read-only)

Researcher. All sources checked on **2026-10-09**. Nothing was signed up for and no credentials were entered. **Ben's personal Amalgama URL was not fetched, used or recorded.** Only generic, token-free paths were probed. Extends `docs/research/wearables-garmin.md` (§2b-2 there covers Amalgama's OAuth; not repeated here).

Labels: **[Doc]** official docs or a vendor's own pages/terms. **[Code]** open-source code read directly. **[Reports]** forums, press, third-party guides. **[Inference]** my reasoning, unproven.

## Summary

1. **The only genuinely live, on-device, no-account route is the watch's own Bluetooth heart-rate broadcast.** It uses the standard BLE Heart Rate service and Core Bluetooth needs no entitlement, so it works on the free SideStore install. It gives HR only, about once a second, with no internet. Recent Forerunner, fēnix, epix and Venu models broadcast over Bluetooth; some older or cheaper ones are ANT+ only, which an iPhone can't receive.
2. **Amalgama is not live.** Its "live link" is a personal ChatGPT-Action URL in front of Garmin's official partner API, which delivers data only after the watch syncs to Garmin Connect. No public schema, privacy policy or terms exist. Garmin's partner agreement restricts licensees from exposing the API to unapproved third-party apps. ChatGPT custom-GPT actions are being retired on 11 Dec 2026. It could serve as an optional, after-the-fact sync for activities and wellness data, behind FIT import. It is not a live feed.
3. **LiveTrack polling is not recommended.** It uses an undocumented JSON API behind CSRF and anti-bot checks. It needs the Garmin Connect app and mobile data. User reports suggest it doesn't run for indoor and non-GPS activities, which would include a gym strength session.
4. **Ranking:** (1) BLE HR for live use, (2) FIT import afterwards (unchanged), (3) Amalgama as an opt-in experiment only after Ben shares the redacted schema, (4) LiveTrack, not pursued. Connect IQ is excluded because it puts an app on the watch.
5. **Proposed brief changes are included.** They add BLE HR as the live route, with a `bluetooth-central` background mode, and record Amalgama and LiveTrack as non-live or rejected routes.

## Recommendations

1. **Ask Ben (blocking):** his exact watch model and firmware. Then a 5-minute check, with no app needed: on the watch, open Broadcast Heart Rate and see whether a generic iPhone BLE HR app (any "heart rate monitor" app) or the Zwift app on his phone lists the watch.
2. **Build (step 7 native polish, or earlier as a spike): live HR over BLE.**
   - Use a small Core Bluetooth reader. Prefer a ~150-line Swift Expo module of our own; see §3e for why not `react-native-ble-plx`.
   - Scan for service `0x180D`, subscribe to `0x2A37`, parse the 8-bit or 16-bit HR, and parse RR intervals only if they are flagged present.
   - Add `NSBluetoothAlwaysUsageDescription` and `UIBackgroundModes: bluetooth-central`. Update `scripts/check-entitlements.ts` to allow `bluetooth-central`; it is an Info.plist key, not an entitlement.
   - **Display and store only what's measured:** live bpm; per-set average and maximum, with sample count and coverage; HR at rest end. Source label: "Garmin watch (Bluetooth), live". Gaps show as gaps.
   - No calories, no HRV, no "recovery" or readiness score (rule 6). HR never drives progression without a playbook rule Ben has approved.
3. **Keep FIT import as the authoritative after-the-fact record** (`wearables-garmin.md`). If Ben also records a watch Strength activity, its FIT file later supplies the full HR series, matched to the app session.
4. **Amalgama: don't build yet.** If Ben wants it, he copies the action's OpenAPI schema from his GPT editor, **with the UUID redacted**, into a note for us. Then a one-off spike from the phone tests:
   - whether a plain HTTPS GET from iOS works (IP allowlisting to OpenAI ranges is possible);
   - which fields come back, and how fresh they are after a sync.
   - **If built:** store the URL in the Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); never log it, export it, back it up or send it to the coach. Make read-only GETs at most once per app open. Label everything "Garmin via Amalgama (third party)".
   - Plan for it to stop working after 11 Dec 2026.
5. **Do not build:** LiveTrack scraping or polling; Connect IQ watch apps (they write to the watch); HR-based "rest readiness" scores. A Ben-set HR threshold cue is at most an opt-in experiment; first send "HR-guided rest" to `training-researcher` (evidence is thin, §5).
6. **Security note for Ben:** his Amalgama URL works like a password. Anyone holding it can read his Garmin data. He should keep it out of chats and screenshots. If it has leaked, he can revoke Amalgama in Garmin Connect (Settings → Connected Apps; the menu path is [Inference], not verified).

---

## 1. garmin.amalgama.co and the "live link"

### 1a. What it is

- [Doc, observed] The site's only public page is a login page titled "Log In | Garmin Integration Platform", "Powered by Amalgama". Its copy reads: "Authorise Garmin Connect™ once and your activities, history and AI endpoints are ready in seconds." https://garmin.amalgama.co/
- [Doc, observed] `/garmin_oauth/start` returns a 302 to `connect.garmin.com/oauth2Confirm` with Amalgama's own `client_id`, PKCE S256 and `redirect_uri=https://garmin.amalgama.co/garmin_oauth/callback`. Garmin's OAuth2 PKCE spec lists the same endpoint (https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf). Already in `wearables-garmin.md` §2b-2.
- [Inference, strong] Amalgama is an **approved Garmin Connect Developer Program partner** using the official Health/Activity API. It does not log in with Ben's password. Its `robots.txt` is the Rails default template and `/up` returns an empty 200 (a Rails health check), which is weak evidence of a small Rails app.
- [Doc] Amalgama is a "Welltech" product consultancy (Brooklyn and Buenos Aires). Its main site doesn't mention this platform. https://amalgama.co/
- **"Live link" [Inference]:** the coordinator reports that Ben's integration has the form `https://garmin.amalgama.co/api/v1/chatgpt-action/<personal-UUID>`. So the "live link" is a **personal ChatGPT-Action endpoint**: a capability URL whose UUID is the only credential. It is not a Garmin LiveTrack link. Nothing public says otherwise.

### 1b. Public documentation probed (all token-free)

All of these returned **404**: `/privacy`, `/privacy-policy`, `/privacy_policy`, `/terms`, `/docs`, `/api-docs`, `/api/v1/docs`, `/dashboard`, `/live_links`, `/openapi.json`, `/openapi.yaml`, `/api/v1/openapi.json`, `/.well-known/ai-plugin.json`, `/api/v1/chatgpt-action`, `/api/v1/chatgpt-action/openapi.json`, `/api/v1/chatgpt-action/openapi.yaml` and `/api/v1/chatgpt-action/schema`.

Searches for "amalgama" with "chatgpt-action", "live link", GPT Store or GitHub found nothing (e.g. the overview guide https://www.gneta.app/blog/connect-garmin-to-chatgpt-claude, 10 Aug 2026, doesn't list it).

**Unknown from public sources:**
- endpoints and fields;
- rate limits;
- cost;
- retention;
- whether Amalgama stores data or proxies it on demand;
- who operates the service and under what terms.

The schema is almost certainly visible to Ben in his GPT's Action editor [Inference].

### 1c. What data could be behind it (bounded by Garmin's partner API)

- [Doc] The Health API covers "heart rate, steps, calories, sleep, respiration, body composition" and "detailed stress, pulse-ox, and epoch summaries". Image labels show Intensity Minutes, **Body Battery** and Blood Pressure. https://developer.garmin.com/gc-developer-program/health-api/
- [Reports] One integrator lists HRV among Garmin partner data types. https://openwearables.io/docs/providers/garmin-api-integration.md
- [Doc] The Activity API provides "detailed fitness data captured during an activity" and FIT/GPX/TCX files. Its tiles include Strength Training. https://developer.garmin.com/gc-developer-program/activity-api/
- [Doc] **Timing:** "end-users sync their device with Garmin Connect to upload device data, at which point it is accessible via the API." No live or LiveTrack data is mentioned on either page.
- [Reports] Partner backfill is typically about one month, one day per request, and the user must enable it on the consent screen (openwearables, above).
- [Inference] So Amalgama can at best be **near-real-time after sync**: an activity appears minutes after it is saved and synced. It cannot show HR during a set.

### 1d. Garmin's partner terms relevant to a "bridge"

[Doc] Garmin Connect Developer Program Agreement, FRM-0952 Rev. B (PDF metadata 3 Mar 2026). This copy names "Garmin China Shanghai RHQ" as the party, so the global version may differ. https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf

- §5.2(o): the licensee shall not "make available … the API or any features or functionality of the API to any third party … including … developing a Licensee application programming interface to provide End User Data to third-party websites, software applications, platforms, services, or products that have not been approved by Garmin in writing."
- §5.2(e): no "provide access to the API … without Garmin's prior written permission".
- §4.2: Garmin may "rescind or suspend any License Key" at any time. §9.2: it may terminate on 30 days' notice.
- §15.8: licensees must not request users' Garmin login credentials. This is consistent with Amalgama using OAuth.
- §15.10: an "AI Transparency Statement" is required in the licensee's privacy policy if data is processed by AI. **No Amalgama privacy policy was found.**
- §6.4: displaying Garmin data to third parties requires Garmin attribution.

[Inference] Whether ChatGPT, or our app, counts as an "approved" destination under §5.2(o) is Amalgama's question, not something Ben can verify. The risk falls on Amalgama's licence, so for us it shows up as **reliability risk**: the bridge could be cut off without notice. The brief already says "an existing third-party integration does not grant our new app access" (brief, Connections → Garmin).

### 1e. ChatGPT custom-GPT actions are being retired

- [Reports] OpenAI is replacing custom GPTs with plugins. Existing GPTs "remain usable until December 11" 2026, with deferrals to 11 Feb 2027 for some Enterprise workspaces. **"GPT custom actions do not transfer through the migration workflow"**; they must be rebuilt as a connector or a custom MCP server. https://mixed-news.com/en/openai-retiring-custom-gpts-what-carries-over-to-plugins/ (18 Sep 2026); https://www.edtechinnovationhub.com/news/openai-to-retire-custom-gpts-in-december-as-creators-move-to-plugins (1 Oct 2026). OpenAI's help article (https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts) returned 403; the dates above come from press coverage and its search snippet.
- [Inference] Amalgama may keep, change or drop `/api/v1/chatgpt-action/` after December. Building on it means building on an endpoint whose original purpose ends in about nine weeks.
- [Doc] OpenAI publishes GPT Action egress IPs (`chatgpt-connectors.json`) for providers to allowlist. https://developers.openai.com/api/docs/guides/ip-addresses. [Inference] If Amalgama allowlists them, calls from Ben's iPhone would fail. Only a test settles this.

### 1f. Evaluation: "our app calls Ben's Amalgama URL (from the Keychain)"

| Criterion | Assessment |
|---|---|
| On-device feasibility | [Inference] Yes if it accepts a plain HTTPS GET or POST from any client: React Native `fetch`, no server. Unknown: IP allowlisting, required headers, method. |
| Freshness | [Doc + Inference] **Not live.** Data appears only after the watch syncs to Garmin Connect, plus Amalgama's own delay (unknown). Fine for "yesterday's run" or last night's sleep; useless during a set. |
| Data richness | [Inference] Potentially richer than HealthKit (Body Battery, stress, perhaps HRV), bounded by the Health/Activity API and Amalgama's schema. Unknown until Ben shares the schema. |
| Reliability | Medium-low [Inference]. It uses the official API (better than the unofficial login route). But it is an undocumented third-party service with no terms, its licence could be suspended (§1d), and its stated purpose (GPT Actions) ends 11 Dec 2026 (§1e). |
| Privacy | [Inference] Amalgama **already** holds Ben's Garmin access, since he authorised it. Our app reading it adds no new party, but it puts a bearer secret on the phone and makes us depend on Amalgama's handling of his health data, which has no published policy. |
| Terms | Ben's own use of his own URL is not obviously prohibited. Nothing public governs it. The Garmin-side question (§5.2(o)) is Amalgama's. |
| Rule fit | Rule 7: the URL is a credential (Keychain, never in the repo, logs or backups). Rule 8: JSON fields such as activity names are data, never instructions. Rule 6: label the source; never fill gaps. |
| Verdict | **Optional experiment, rank 3**, only after the schema is reviewed and a spike succeeds. Never the only route for anything; FIT import stays primary. |

## 2. Garmin LiveTrack

### 2a. How it works (documented)

- [Doc] A safety feature. "the Forerunner watch must be connected to the Garmin Connect app using Bluetooth technology" and "Your paired phone must be equipped with a data plan and be in an area of network coverage where data is available." Followers are invited "using email or social media, allowing them to view your live data on a web page." https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-48572BAF-6C56-4238-82A9-CDB9E2188F05-3526.html
- [Doc] Contacts must first be set up in the Garmin Connect app. **Auto Start** "start[s] a LiveTrack session each time you start this type of activity"; "Extend LiveTrack" adds 24 h of viewing (Edge 540 manual). https://www8.garmin.com/manuals/webhelp/GUID-17DE938E-466A-4746-BDBF-7A6FC1B3A32C/EN-GB/GUID-5B654CCE-ADFB-4886-879A-75FDE6D154FE.html
- [Doc] Garmin's blog (3 Aug 2017): followers see time, distance, speed and elevation, plus ANT+ sensor data such as HR or cadence; AutoStart applies to "all future timed activities". https://www.garmin.com/en-US/blog/fitness/use-garmin-livetrack-track-activities-real-time/
- [Doc] LiveTrack Terms of Use: only the device owner may invite viewers; "you must not use the Services to stalk, harass…". **No clause on automated access was found** in them. https://static.garmincdn.com/livetrack/en/LiveTrack_tou.htm. Garmin's consumer Terms of Use page rendered no body text (https://www.garmin.com/en-US/legal/terms-of-use/).

### 2b. Strength and gym activities

- [Reports] "In the settings for indoor Padel livetrack isn't available, only for outdoor padel" (FR965, over 3 years old). Another user says the toggle is effectively global. https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-965/342578/livetrack-per-activity-profile
- [Reports] A fēnix 7 user reports that LiveTrack doesn't trigger for an indoor activity with GPS off (search summary of a Garmin forum thread). Manuals describe LiveTrack under GPS activities (e.g. vívoactive 3 "Turning On LiveTrack for GPS Activities").
- [Inference] A Strength activity, which is indoor with no GPS, most likely **cannot** start LiveTrack. Unconfirmed; only Ben's watch can settle it.

### 2c. The JSON behind livetrack.garmin.com

[Code] `aikrana/ha-garmin-livetrack-monitor`, `scripts/garmin-livetrack-check.sh` (release v1.0.3 about 5 months ago) https://raw.githubusercontent.com/aikrana/ha-garmin-livetrack-monitor/main/scripts/garmin-livetrack-check.sh:
- Link format: `https://livetrack.garmin.com/session/<sid>/token/<token>`.
- `GET /` scrapes a `csrf-token` meta tag. Then `GET /api/sessions/<sid>?token=<token>` returns `userDisplayName`, `postTrackPointFrequency`, `start` and `end`. Then `GET /api/sessions/<sid>/track-points/common?token=<token>` returns `trackPoints`.
- Headers: `livetrack-csrf-token`, `referer`. The script uses **`cloudscraper`** ("handles … anti-bot challenge").

Other projects:
- [Doc, README] The same integration exposes heart rate, cadence, power, speed, pace, distance, altitude and position; "Not all attributes will be populated for every activity". The default poll is 6 s. Sessions are discovered from **LiveTrack emails via IMAP**. "access protections have shifted multiple times over the years". https://github.com/aikrana/ha-garmin-livetrack-monitor
- [Doc, README] "Garmin blocks direct API clients, so the extractor uses Chromium to make same-origin API requests." https://github.com/Johannes11833/GarminLiveTrack-Server
- [Reports] Older path shapes (`/services/session/{id}/token/{token}`) and a GraphQL `trackPointsBySessionId` query have both been used before. The API has changed several times. Search summaries of https://github.com/renarsvilnis/garmin-livetrack and https://community.home-assistant.io/t/garmin-livetrack-tracking-package/552793. The renarsvilnis repo notes "1 reading every 4 seconds" (about 2015).

**Rate limits:** none documented. One integration throttles to the session's own `postTrackPointFrequency` [Code].

### 2d. Could our app poll a pasted LiveTrack link? [Inference]

- **Technically plausible but awkward.**
  - Ben adds himself as a recipient, copies the link from the email, and shares it to our app.
  - Our app would need a hidden `WKWebView` loading the LiveTrack page to pass the anti-bot checks, then call the JSON API same-origin, every 5–10 s.
  - No password is involved; the session token in the URL is the capability.
- **Practical issues:**
  - It needs the Garmin Connect app connected and **mobile data in the gym**.
  - Data goes watch → phone → Garmin cloud → back to the same phone, so it lags by seconds or more. Freezes and dropouts are reported in crowds (search summary of a Wareable guide, https://www.wareable.com/garmin/how-to-set-up-use-garmin-livetrack-safety-feature).
  - It probably **doesn't run for strength activities** (§2b).
  - It costs extra battery on both the phone and the watch.
  - Every Garmin change breaks it, and it relies on circumventing anti-bot protection, which is hard to square with any terms even though the LiveTrack terms are silent.
- **Verdict: not pursued.** Everything useful in it for a gym session (HR) comes more directly, faster and offline via BLE broadcast.

## 3. Bluetooth HR broadcast

### 3a. Which watches

- [Doc] FR965 manual: "Health & Wellness > Wrist Heart Rate > Broadcast Heart Rate"; "Broadcasting heart rate data decreases battery life"; you can set activities to "broadcast your heart rate data automatically when you begin an activity". The manual doesn't name the radio. https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html
- [Doc, partner sheet] Myzone × Garmin compatibility sheet (PDF dated about Jun/Jul 2026): "Any Garmin watch with Bluetooth HR Broadcasting … can connect in real time", listing:
  - **Forerunner 245, 255, 265, 745, 945, 955, 965, 970**;
  - **Fenix 6, 7, 7 Pro, 8, 8 Pro**; Epix Gen 2 and Pro;
  - **Venu 2, 2 Plus, 3, 4**; Vivoactive 4 and 5; Enduro 2 and 3; MARQ Gen 2; Tactix 7 and 8.

  It adds that "Older … and entry-level models such as Forerunner 45, Vivofit, Vivosmart series may not support Bluetooth Broadcasting." https://www.myzone.org/hubfs/Garmin%20Integration/myzone-Garmin-Device-Compatability-Overview.pdf
- **Conflicts:**
  - TrainerRoad (updated 13 Aug 2026): "Broadcast mode is ONLY via ANT+ for most of the Garmin watches", naming only the FR245/945 as Bluetooth. https://support.trainerroad.com/hc/en-us/articles/16027042835099-How-to-Use-Broadcast-Mode-to-Sync-Heart-Rate-Data-from-Garmin-Watches-to-TrainerRoad
  - A forum user says the Vivoactive 4 is ANT+-only (search summary).
- [Reports] Real-world BLE evidence:
  - FR965 broadcasting to an iPad (Zwift, Rouvy) had dropouts; Garmin staff: "Software version 19.18 is now live and includes this fix" (thread about 2023). https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-965/349393/broadcast-heart-rate-drops-every-few-minutes
  - fēnix 8 "only appear[s] as a bluetooth (BT) device" (Oct 2024 – Jan 2025). https://forums.zwift.com/t/garmin-zwift-hub-hr-broadcast-issues/637353
- [Reports] DC Rainmaker (24 Jun 2020): two concurrent BLE connections worked and a third failed. Older firmware had a bug where "Broadcast in workout" sent ANT+ only; the workaround was the controls-menu toggle. https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html. Some watches use a "Virtual Run" BLE profile instead (https://www.dcrainmaker.com/2020/04/garmin-wearable-broadcasting.html, 9 Apr 2020).
- [Reports] Standalone broadcast can lock the watch screen on the broadcast page (FR645 user, search summary). Broadcasting from inside an activity avoided FR965 dropouts for one user.
- **ANT+:** [Reports] iPhones have no ANT+ radio ("both the iPhone and iPad are Bluetooth only", Zwift forum search summary). An ANT+-only watch can't feed our app without a bridge. Not pursued.

### 3b. What it gives

- [Doc] The standard Heart Rate Service (Bluetooth SIG, HRS 1.0): "exposes heart rate and other data from a Heart Rate Sensor intended for fitness applications." https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/
- [Reports] It uses service `0x180D` and characteristic `0x2A37` (notify). The flags byte selects 8-bit or 16-bit HR, with optional fields after it. https://docs.simpleble.org/recipes/heart-rate-monitor, https://github.com/adafruit/Adafruit_CircuitPython_BLE_Heart_Rate/blob/master/adafruit_ble_heart_rate.py
- **RR intervals: assume none.**
  - [Reports] Welltory (27 Jan 2022): "Garmin watches with HRV function, are not supported for measurements". https://help.welltory.com/articles/3358282
  - A Connect IQ forum post says RR isn't exposed to apps (search summary).
  - [Inference] Parse RR only if the flag is set. Never compute HRV from wrist-optical broadcast.
- [Inference] Data: HR roughly every 1 s, live, with no internet, no account and no Garmin servers. It is one-way read: we only subscribe. Nothing is written to the watch, which matches Ben's read-only rule.

### 3c. iOS and free provisioning

- [Doc] `NSBluetoothAlwaysUsageDescription`: "This key is required if your app uses the device's Bluetooth interface." https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription
- [Doc, archived 2013 guide] Without a Core Bluetooth background mode the app is suspended and "unable to perform Bluetooth-related tasks". With `bluetooth-central` "the system wakes it up … when a peripheral sends updated characteristic values". https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- [Doc, repo] `UIBackgroundModes` is an Info.plist key, not an entitlement. Our own review confirmed this for `audio` (`docs/reviews/mobile-shell-spike.md`: "`UIBackgroundModes` isn't an entitlement, so free provisioning is unaffected").
- [Inference] BLE HR therefore works on the free Apple ID + SideStore install. `scripts/check-entitlements.ts` must allow `bluetooth-central`. Phones are normally locked between sets, so `bluetooth-central` is needed unless the audio keep-alive is already running.

### 3d. Battery

- [Doc] On the watch, broadcasting "decreases battery life" (FR965 manual). DC Rainmaker judged the effect negligible (2020) [Reports].
- [Inference] On the phone, a single 1 Hz BLE notification stream is small next to screen and audio use. To be measured over a 75-minute session.

### 3e. Library choice

- [Doc] `react-native-ble-plx@3.5.1` (MIT; npm registry) has a documented Expo config plugin (`modes: ['central']`, `bluetoothAlwaysPermission`) and does not work in Expo Go. https://registry.npmjs.org/react-native-ble-plx/latest, https://github.com/dotintent/react-native-ble-plx
- [Reports] A fork claims upstream is "effectively unmaintained for modern React Native / Expo stacks" and targets Expo SDK 57+ / RN 0.86+ on TurboModules. https://cdn.jsdelivr.net/npm/@sfourdrinier/react-native-ble-plx@3.9.2/README.md. Expo SDK 55+ is New-Architecture-only. https://docs.expo.dev/guides/new-architecture.md
- [Inference] We need one service, one characteristic and no writes. A small Swift Expo module (Core Bluetooth central, about 150 lines) avoids a third-party dependency of uncertain New-Architecture status. It also sits next to our existing Swift audio module pattern. The developer decides, and records it in an ADR if a dependency is added.

## 4. Other live options (brief)

- **Connect IQ.** [Doc] The iOS Mobile SDK lets a phone app talk to a Monkey C app *on the watch*, relayed through Garmin Connect Mobile. https://github.com/garmin/connectiq-companion-app-sdk-ios, https://developer.garmin.com/connect-iq/core-topics/mobile-sdk-for-ios. [Reports] The Connect IQ BLE module is central-only, so a watch app can't advertise its own HR service (feature request CIQQA-4732, search summary of https://forums.garmin.com/developer/connect-iq/i/bug-reports/feature-request-support-ble-gap-broadcaster-short-burst-advertising-in-toybox-bluetoothlowenergy).
  - Any Connect IQ route means installing our own app on the watch, which **Ben has ruled out** (no writing to Garmin). It also adds nothing over the built-in broadcast for HR. Not pursued.
- **Unofficial Garmin Connect login.** Not live either (post-sync data). Already evaluated in `wearables-garmin.md` §2b-3.
- **HealthKit.** Not live for Garmin: Garmin writes HR to Apple Health about every 2 min, after sync (`wearables-garmin.md` §2a). It is probably unavailable on SideStore anyway.

## 5. What live data is useful in a strength app

| Use | Value | Evidence / rule | Label |
|---|---|---|---|
| Live bpm on Active set and Rest screens | Low-medium: reassurance, conditioning work | Display only, like Fitbod ("displayed … for your reference … not used to … adjust", `wearables-garmin.md` §1b) | Inference |
| Per-set average and peak HR, HR at rest end, stored with source and coverage | Medium for review and for the coach's context ("your HR was 158 after that set") | Facts only (rule 6) | Inference |
| Cardio and conditioning in-app (bike, rower, finishers): live HR, time above a Ben-set threshold | Medium | Zones only from values Ben enters. We don't receive Garmin's zones via BLE | Inference |
| **HR-based "rest readiness"** (start the next set when HR < X) | **Unproven** | One small trial (15 bodybuilders) found more reps with a fixed 3-min rest than with rest to 60% of age-predicted max HR; no HR-target benefit shown. https://research.uok.ac.ir/_Pages/ResearchEn.aspx?Id=15919. Buskard et al. 2017 compared HR-based vs fixed 60 s rest (results not read). https://www.asep.org/asep/asep/JEPonlineFEBRUARY2017_Andrew_Buskard.pdf. Current playbook rest guidance is time-based (`docs/training-guides/evidence-core.md` §6) | Reports + Inference |
| HRV, recovery, readiness or calories from live HR | **Don't.** No RR intervals from the watch; any estimate would be invented (rule 6) | — | Inference |

Coach use [Inference]: HR facts may be cited when Ben asks, or as context for a clear signal (rule 3). They never trigger adjustments by themselves without an approved playbook rule.

## 6. Ranking

| Rank | Route | Live? | On-device, no server? | Account or secret | Permitted | Reliability | Use |
|---|---|---|---|---|---|---|---|
| **1** | **BLE HR broadcast** | **Yes (~1 s)** | Yes, offline | None | Yes (standard BLE; no entitlement) | High if the model supports BLE | Live HR during lifts and cardio |
| **2** | FIT import (existing plan) | No (after the workout) | Yes | None | Yes | Very high | Authoritative activity record, full HR series |
| 3 | Amalgama action URL | No (after sync; minutes at best) | Yes, if it accepts phone requests | Bearer-URL secret; a third party holds Garmin access | Unclear (no terms; Garmin §5.2(o) is Amalgama's risk) | Medium-low; GPT actions retire 11 Dec 2026 | Optional experiment: auto-sync of activities and wellness |
| 4 | LiveTrack polling | Partly (seconds, GPS activities only) | Needs a web view plus mobile data | Session token per link | Grey (anti-bot circumvention) | Low; breaks repeatedly | Not pursued |
| — | Connect IQ companion | Yes | Needs Garmin Connect Mobile | — | Yes, but writes an app to the watch | — | Excluded by Ben |

## 7. Unknowns only a real test can settle

1. Whether Ben's watch model and firmware broadcasts over **BLE** (not ANT+ only), in both standalone and in-activity modes, and whether it drops out over 60–90 minutes.
2. Whether the broadcast includes RR intervals (expected: no).
3. Whether iOS delivers HR notifications while the phone is locked, with `bluetooth-central` only and with the audio keep-alive. Reconnect behaviour after the watch leaves range.
4. Watch and phone battery cost over a 75-minute session.
5. Whether a Strength activity on Ben's watch can start LiveTrack at all (only matters if LiveTrack is ever reconsidered).
6. Amalgama: the schema (from Ben, redacted); whether calls from the iPhone succeed (IP allowlist, headers); freshness after a sync; which fields exist (HRV? Body Battery? FIT?); and what happens to the endpoint after 11 Dec 2026.

## Proposed brief changes (for Ben's approval)

1. **Connections → Garmin:** add
   > "Live data: the only live route is the watch's standard Bluetooth heart-rate broadcast (read-only, on-device, no account), used for display and per-set HR facts. Garmin LiveTrack is not used (undocumented API behind anti-bot checks, needs mobile data, likely unavailable for indoor strength activities). Third-party Garmin bridges (e.g. Amalgama's ChatGPT-action URL) deliver data only after the watch syncs. They are optional, labelled third-party, store their URL in the Keychain, and never replace FIT import."
2. **Stack / CLAUDE.md native-config line:** add "Bluetooth HR uses Core Bluetooth (`NSBluetoothAlwaysUsageDescription`, `UIBackgroundModes: bluetooth-central`); no entitlement, so it stays free-provisionable". `check-entitlements` allows `bluetooth-central`. **This touches CLAUDE.md, so it is flagged for Ben; agents must not edit it.**
3. **Build order:** move "live HR over Bluetooth (display-only)" from step 7 to a **step 1–2 feasibility spike** if Ben wants live data soon. It is cheap and independent of Garmin's cloud.
4. **§6 data model:** add `HeartRateSample` (session, set ID, timestamp UTC, bpm, source device, contact flag) and per-set `hrAvg`/`hrMax`/`hrCoverage` derived fields, labelled as measured. No HRV or readiness fields from this source.
5. **Validation scenario:** "Watch HR broadcast drops mid-rest: the app shows `Heart rate: no signal`, keeps logging, stores the gap as missing, and never interpolates."
6. **Playbook:** "HR-guided rest" goes to `training-researcher` before any rule is proposed. Until then, rest stays time-based.
7. **ADR when BLE HR starts:** "Live HR via standard BLE HR service; own Swift module vs react-native-ble-plx; LiveTrack and Amalgama rejected as live routes".

No conflict with CLAUDE.md was found beyond item 2, which is an addition, not a contradiction. This updates `wearables-garmin.md`: Amalgama is now known to expose a per-user ChatGPT-action URL, and Garmin agreement §5.2(o) is now quoted.

## Sources (all checked 2026-10-09)

- Amalgama: https://garmin.amalgama.co/ (and the token-free paths listed in §1b, all 404 except `/robots.txt` and `/up`), https://garmin.amalgama.co/garmin_oauth/start (302 observed, not followed), https://amalgama.co/
- Garmin developer: https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf, https://developer.garmin.com/gc-developer-program/health-api/, https://developer.garmin.com/gc-developer-program/activity-api/, https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf, https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/, https://openwearables.io/docs/providers/garmin-api-integration.md, https://www.gneta.app/blog/connect-garmin-to-chatgpt-claude
- OpenAI: https://developers.openai.com/api/docs/guides/ip-addresses, https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts (403; snippet), https://mixed-news.com/en/openai-retiring-custom-gpts-what-carries-over-to-plugins/, https://www.edtechinnovationhub.com/news/openai-to-retire-custom-gpts-in-december-as-creators-move-to-plugins
- LiveTrack: https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-48572BAF-6C56-4238-82A9-CDB9E2188F05-3526.html, https://www8.garmin.com/manuals/webhelp/GUID-17DE938E-466A-4746-BDBF-7A6FC1B3A32C/EN-GB/GUID-5B654CCE-ADFB-4886-879A-75FDE6D154FE.html, https://www.garmin.com/en-US/blog/fitness/use-garmin-livetrack-track-activities-real-time/, https://static.garmincdn.com/livetrack/en/LiveTrack_tou.htm, https://www.garmin.com/en-US/legal/terms-of-use/ (no body), https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-965/342578/livetrack-per-activity-profile, https://raw.githubusercontent.com/aikrana/ha-garmin-livetrack-monitor/main/scripts/garmin-livetrack-check.sh, https://github.com/aikrana/ha-garmin-livetrack-monitor, https://newreleases.io/project/github/aikrana/ha-garmin-livetrack-monitor/release/v1.0.2, https://github.com/Johannes11833/GarminLiveTrack-Server, https://github.com/renarsvilnis/garmin-livetrack (search summary), https://www.wareable.com/garmin/how-to-set-up-use-garmin-livetrack-safety-feature (search summary)
- BLE HR: https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html, https://www.myzone.org/hubfs/Garmin%20Integration/myzone-Garmin-Device-Compatability-Overview.pdf, https://support.trainerroad.com/hc/en-us/articles/16027042835099-How-to-Use-Broadcast-Mode-to-Sync-Heart-Rate-Data-from-Garmin-Watches-to-TrainerRoad, https://www.pocket-lint.com/how-to-broadcast-heart-rate-on-garmin-device/, https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html, https://www.dcrainmaker.com/2020/04/garmin-wearable-broadcasting.html, https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-965/349393/broadcast-heart-rate-drops-every-few-minutes, https://forums.zwift.com/t/garmin-zwift-hub-hr-broadcast-issues/637353, https://help.welltory.com/articles/3358282, https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/, https://docs.simpleble.org/recipes/heart-rate-monitor, https://github.com/adafruit/Adafruit_CircuitPython_BLE_Heart_Rate/blob/master/adafruit_ble_heart_rate.py
- iOS and libraries: https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription, https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html, https://registry.npmjs.org/react-native-ble-plx/latest, https://github.com/dotintent/react-native-ble-plx, https://cdn.jsdelivr.net/npm/@sfourdrinier/react-native-ble-plx@3.9.2/README.md, https://docs.expo.dev/guides/new-architecture.md
- Connect IQ: https://github.com/garmin/connectiq-companion-app-sdk-ios, https://developer.garmin.com/connect-iq/core-topics/mobile-sdk-for-ios, https://forums.garmin.com/developer/connect-iq/i/bug-reports/feature-request-support-ble-gap-broadcaster-short-burst-advertising-in-toybox-bluetoothlowenergy (search summary)
- Rest-interval evidence: https://research.uok.ac.ir/_Pages/ResearchEn.aspx?Id=15919 (search summary), https://www.asep.org/asep/asep/JEPonlineFEBRUARY2017_Andrew_Buskard.pdf (not read)
- Project docs read: `CLAUDE.md`, `docs/brief/training-app-build-brief.md` (Connections), `docs/research/wearables-garmin.md`, `docs/reviews/mobile-shell-spike.md`, `docs/decisions/0007-mobile-shell-identity-and-ipa-pipeline.md`, `docs/training-guides/evidence-core.md`
