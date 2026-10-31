# Wearables and Garmin: what's worth reading, and how (read-only)

Researcher. Sources checked on 2026-10-08; the Amalgama and unofficial-route additions (§2b-2, §2b-3) on 2026-10-09. Nothing was installed or signed up for, and no credentials were entered. Labels: **[Doc]** = official documentation, or a tool's own source code or docs. **[Reports]** = forums, vendor blogs, press and third-party guides. **[Inference]** = my reasoning, not yet proven. **Scope (Ben, via coordinator):** read-only from Garmin. Nothing is uploaded or written back to Garmin, Apple Health or Strava.

## Summary

1. **What Ben would actually use:** the most valuable data is his **real runs and rides** (date, sport, duration, distance, HR). They feed playbook rules C3/C4: protect a key long run, and don't assume fatigue without data. Sleep and resting HR are secondary. The vendor blog's "HRV readiness" pitch is marketing (it ranks its own app first).
2. **The site Ben found (garmin.amalgama.co) uses Garmin's official partner OAuth.** Its "Sign in" button redirects to `connect.garmin.com/oauth2Confirm` with its own `client_id` and PKCE, exactly as in Garmin's Developer Program spec. That proves an *approved business* can connect. It doesn't open a route for Ben: the programme is business-only, paused for new applicants, and its token exchange needs a client secret, so a server.
3. **The unofficial route works today but is fragile and probably against Garmin's terms.** Libraries such as `python-garminconnect` log in as Garmin's own mobile app. They expose what Apple Health lacks: original FIT files, HRV status, Body Battery, Training Readiness, training status and load, VO2max and stress.
   - It could probably run on the iPhone with no server [Inference].
   - It broke in March 2026 (about 2–3 weeks), again in June, and has two auth issues open now (28 Sep and 7 Oct).
   - It means Ben's Garmin login and a long-lived refresh token, with a risk of temporary account lockouts.
4. **HealthKit is probably not available on the current SideStore install.** SideStore's signing code only turns on App Groups and Inter-App Audio. Only a device probe can confirm this. Even if HealthKit works, Garmin writes workouts, HR (coarse), sleep and energy there, but not HRV, Body Battery or Training Readiness.
5. **Recommendation:** in order of value for risk:
   1. **FIT import** first (no account, no entitlement, no server);
   2. a **HealthKit probe** now;
   3. the **unofficial read-only connector only as an opt-in experiment, if Ben explicitly accepts the risks**, behind a read-only allowlist with FIT import as the fallback;
   4. Bluetooth live HR later.

   **Proposed brief changes** are included; they contradict the brief on the Garmin dependency, HealthKit timing and Strava.

## Recommendations

1. **Ask Ben (blocking for phase choice):**
   - Watch model and firmware. This decides Bluetooth HR broadcast and which HRV/readiness features exist.
   - A screenshot of **Garmin Connect → Settings → Connected Apps → Apple Health** toggles.
   - Which data he cares about: runs and rides; sleep and resting HR; HR during lifts; HRV, Body Battery or Training Readiness.
   - Does he use Strava? Does he also record strength sessions on the watch?
   - **For the unofficial route only:** does he accept a likely Garmin-terms breach on his own account, occasional breakage, temporary login lockouts, and a refresh token in the Keychain? Does his Garmin account use MFA?
2. **Next probe build:** add a read-only HealthKit probe.
   - Use `@kingstinct/react-native-healthkit@16.1.0` with `NSHealthUpdateUsageDescription: false` and `background: false`.
   - Call `requestAuthorization({ toRead: [...] })`.
   - Record whether the permission sheet appears, the exact error, and which types arrive from "Connect".
3. **Phase 1: FIT import** (build step 6, or earlier if Ben wants it). Garmin Connect web export, or copying from the watch over USB, then share to the app. Parse with MIT `fit-file-parser`, store as `EnduranceActivity` with provenance, and de-duplicate by `file_id` plus checksum.
4. **Phase 2a (if the probe passes): HealthKit read** on app open: non-strength workouts, resting HR and sleep, labelled "Garmin via Apple Health".
5. **Phase 2b (only with Ben's explicit go-ahead): an experimental unofficial Garmin connector.** Spike it first.
   - **Login:** Ben types his password into Garmin's own SSO page in a web view; the app never stores the password.
   - **Tokens:** store only the refresh token in the Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
   - **Read-only by construction:** a hard-coded allowlist of GET endpoints, with tests that reject any other method or path.
   - **Rate:** at most one sync per app open and no more often than every 15 minutes. Back off on 429 and never retry login automatically.
   - **Labels:** label everything "Garmin Connect (unofficial)". On any failure, show "Garmin sync unavailable, use FIT import" honestly.
   - Garmin-derived scores (Body Battery, Training Readiness) appear only if Ben opts in, labelled as Garmin's estimates. They never feed progression without an approved playbook rule.
6. **Phase 3 (model-dependent): live HR over Bluetooth**, display-only.
7. **Do not build:**
   - the Garmin Developer Program APIs (business-only, paused, need a server);
   - routing data through Amalgama or any other third-party Garmin bridge (no published privacy policy or API found; it would add a remote dependency holding Ben's health data);
   - the Strava API;
   - the Training API or Connect IQ (write routes; Ben said read-only).
8. **Honest display (rule 6):** show only fields a source provided, with source and date. Never estimate missing metrics, and never show a combined strength + endurance score.

---

## 1. What wearable features are valued

### 1a. The SensAI blog (vendor bias flagged)

Source: https://www.sensai.fit/blog/best-ai-workout-app (published 8 May 2026, updated 12 Sep 2026).

- **Bias [Doc, the page itself]:** it is written by SensAI ("we build SensAI"), which ranks itself #1. The ranking uses a "Tier 3 = reads wearable recovery data" test that SensAI designed, and SensAI is the only Tier 3 app. Its App Store rating rests on 30 ratings.
- **Claims [Reports, marketing]:**
  - HRV, sleep and resting HR "via HealthKit" from Apple Watch, Garmin, Oura and WHOOP;
  - a daily readiness summary;
  - HRV as a multi-day trend;
  - a resting-HR rise of 5+ bpm as a stress flag (unsourced);
  - and it says it does *not* silently swap sessions on one HRV dip.
- **Competitors per the blog [Reports]:**
  - Fitbod's watch support "covers logging, not recovery".
  - Juggernaut AI has no wearable integration.
  - Dr. Muscle and Alpha Progression sync with Apple Health but read no recovery data.
  - Arvo and SmartGym have native Apple Watch apps.
- **Evidence it cites:** general app adherence, LLM-plan quality, and HRV-guided *endurance* studies. Nothing on HRV-guided strength programming.
- **Contradiction [Inference, see §2a]:** for Garmin, SensAI routes data through Apple Health (https://www.sensai.fit/help/connect-wearable-to-sensai-apple-health). Garmin doesn't write HRV there, so its "HRV readiness" probably has no Garmin HRV behind it. Unverified in its app.

### 1b. User feedback

Reddit was not reachable from my tools, so this draws on Garmin forums and press. It is qualitative.

| Theme | Evidence | Label |
|---|---|---|
| One lifting record that includes the watch's HR, instead of two systems | https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience (+12/+6); https://forums.garmin.com/sports-fitness/healthandwellness/f/venu-3-series/426499/request-for-hevy-integration-with-garmin-connect | Reports |
| Hevy reportedly declined a restricted Garmin integration that couldn't push sets, reps or weight | https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/ | Reports |
| Fitbod shows a Garmin's broadcast HR "for your reference", not for adaptation | https://help.fitbod.me/hc/en-us/articles/39224086573207-Live-Heart-Rate-Tracking (search snippet; page returned 403) | Doc (snippet) |
| Garmin's own push into strength (Connect+ live HR; Fitness Coach adjusting to Body Battery and HRV) | the5krunner, above | Reports |
| Requests for SpO2, VO2max and respiration in Apple Health | https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/254977/request-for-spo2-vo2-max-and-respiration-data-to-be-shared-to-apple-health-app | Reports |
| Coarse Garmin data in Apple Health (HR about every 2 min) | https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/427363/data-consistency-between-apple-health-and-garmin | Reports |
| Demand for Garmin data in AI chats (many community MCP servers built on the unofficial library) | https://forums.garmin.com/developer/connect-iq/f/discussion/437274/feature-request-mcp-integration-to-enable-claude-ai-access-to-garmin-connect-data-to-the-garmin-product-and-developer-teams; https://glama.ai/mcp/servers/Taxuspt/garmin_mcp | Reports |

### 1c. What this means for Ben [Inference]

| Feature | Value for Ben's coach | FIT import | HealthKit (if probe passes) | Unofficial Garmin |
|---|---|---|---|---|
| Actual runs and rides | **High** (C3/C4, plan `Done`, scenarios 3 and 9) | Yes, full detail | Yes, summary, coarse HR | Yes, list + original FIT |
| Sleep, resting HR | Medium-low context | No (bulk export JSON, unverified) | Yes (sleep), probably (RHR) | Yes |
| HR during sets | Low for decisions | After the fact (watch strength activity) | Coarse | Via FIT |
| HRV status, Body Battery, Training Readiness, training status/load, VO2max, stress | Unproven for strength decisions; Garmin's proprietary estimates | No | **No** | **Yes** |
| Watch set logging | Wanted, but a write route | — | — | Not pursued (Ben) |

Whether HRV-guided *strength* training beats a fixed plan is a question for `training-researcher` before any readiness rule is proposed.

## 2. Feasible routes (iPhone 17, iOS 26.6.1, free Apple ID + SideStore, Garmin watch model unknown)

### 2a. Apple Health / HealthKit (read-only)

**What Garmin Connect writes to Apple Health.** Garmin's support FAQ returned HTTP 403, so this table relies on secondary sources. Ben's Connected Apps toggles are the deciding source.

| Field | Written? | Evidence | Label |
|---|---|---|---|
| Workouts (no GPS route) | **Yes** | https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/ (updated 3 Oct 2026) | Reports |
| Heart rate | **Yes**, all-day, about every 2 min. Timed activities may get only high and low values | the5krunner; forum 427363 | Reports |
| Resting heart rate | **Probably** | https://www.reaction-club.com/guides/garmin-apple-health (Dec 2025) | Reports (weak) |
| Sleep | **Yes** (stages unconfirmed) | the5krunner | Reports |
| Energy, steps, distance, flights, weight, body fat, BMI, BP, water | Yes | the5krunner | Reports |
| **HRV** | **No** | https://trainconstant.com/blog/garmin-apple-health (vendor, 22 Jul 2026) | Reports |
| VO2max | Conflicting; treat as No | forum 254977; guides disagree | Reports |
| Body Battery, Training Readiness, stress, training load/status | **No** | Absent from every list; the5krunner expects recovery data won't be sent; https://sahha.ai/blog/garmin-developer-program-paused/ | Reports + Inference |
| SpO2, respiration | No | forum 254977 | Reports |
| Direction | One-way, Garmin → Health | forums; the5krunner | Reports |

Apple's HRV type is SDNN [Doc]: https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn. Garmin's HRV Status is a different overnight measure, so the two are not comparable.

**Read-only HealthKit [Doc]:** https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- Read and share permissions are separate.
- `NSHealthShareUsageDescription` covers reading; `NSHealthUpdateUsageDescription` covers writing.
- The app can't tell whether a read was denied.
- The user may grant only a recent window of history ("avoid interpreting the absence of older samples as evidence they don't exist").

**`@kingstinct/react-native-healthkit@16.1.0` [Doc]:**
- Peer dependencies: `react >=19`, `react-native >=0.79`, `react-native-nitro-modules >=0.35`. Not usable in Expo Go.
- Read-only request: `requestAuthorization({ toRead })`.
- Plugin source:
  - `NSHealthUpdateUsageDescription` gets a default unless set to `false`;
  - background delivery is "Enabled by default; set to `false` to opt out".
- Sources: https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest, https://github.com/kingstinct/react-native-healthkit, https://raw.githubusercontent.com/kingstinct/react-native-healthkit/master/packages/react-native-healthkit/app.plugin.ts

**HealthKit under a free Apple ID + SideStore install:**
- [Community] Free teams *can* use HealthKit via Xcode (LoopDocs; see `free-ios-install.md` §1.2).
- [Doc, source code] SideStore's AltSign maps only App Groups and `inter-app-audio` to App ID features; HealthKit is absent. https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Capabilities/ALTCapabilities.m
- [Doc, source code] The signer keeps only entitlements that are in both the profile and the app. https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Signing/ALTSigner.mm
- [Inference] The app will install, but HealthKit calls will likely fail with "Missing com.apple.developer.healthkit entitlement" (Code 4). This matches the App Group behaviour in `docs/device-tests/2026-10-08-probe-build7.md`. Needs the probe.

**Fallback with no entitlement [Doc, via Apple Support snippet]:** Health app → Export All Health Data (XML). https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios. [Inference] It is all-time and large, so it suits a one-off import only.

### 2b. Garmin's official partner API, the Amalgama site, and the unofficial route

#### 2b-1. Garmin Connect Developer Program (official)

- [Doc] "only for business use"; OAuth 2.0; some metrics carry fees. https://developer.garmin.com/gc-developer-program/program-faq/
- [Doc] The APIs are "cloud-to-cloud". https://developer.garmin.com/gc-developer-program/overview/
- [Doc] Health API: "Ping/Pull or Push"; "Commercial use requires a license fee payment". https://developer.garmin.com/gc-developer-program/health-api/
- [Doc] OAuth2 PKCE spec (https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf):
  - authorisation `GET https://connect.garmin.com/oauth2Confirm` with `client_id`, `code_challenge`, `code_challenge_method=S256`, `redirect_uri` and `state`;
  - token `POST https://connectapi.garmin.com/di-oauth2-service/oauth/token` with **`client_secret` required**;
  - example response `expires_in: 86400` and `refresh_token_expires_in: 7775998` (about 90 days). The prose says access tokens "expire three months after they are created", which is internally inconsistent; the example values suggest a 24 h access token and about 90 days for the refresh token;
  - users choose permissions on the consent screen (`ACTIVITY_EXPORT`, `HEALTH_EXPORT`, …).
- [Reports] New access requests are **paused** with no timeline (Garmin email quoted by applicants). https://sahha.ai/blog/garmin-developer-program-paused/ (19 Sep 2026); https://forums.garmin.com/developer/connect-iq/f/discussion/434542/garmin-connect-developer-program---access-request-rejected-without-notification
- **Verdict:** closed to Ben. He isn't a business, it's paused, and the client secret means a server.

#### 2b-2. How garmin.amalgama.co connects

- [Doc, observed 2026-10-09] The home page is a login page, "Garmin Integration Platform … Powered by Amalgama", with one button, "Sign in with Garmin Connect™". Its copy: "Authorise Garmin Connect™ once and your activities, history and AI endpoints are ready in seconds." https://garmin.amalgama.co/
- [Doc, observed] `GET https://garmin.amalgama.co/garmin_oauth/start` returns **302** to `https://connect.garmin.com/oauth2Confirm?response_type=code&client_id=10ee7244-…&code_challenge=…&code_challenge_method=S256&redirect_uri=https://garmin.amalgama.co/garmin_oauth/callback&state=…`. I did not follow it or sign in.
- [Inference, strong] This exactly matches Garmin's partner OAuth2 PKCE spec above, so Amalgama holds a **Garmin Connect Developer Program client ID**: it is an approved partner using the official API. It does **not** use garth or python-garminconnect: those log in through `sso.garmin.com` with Garmin's own app client IDs, not a consent screen with a third-party `client_id`. The token exchange needs Amalgama's client secret, which lives on its server.
- [Doc] Amalgama is a "Welltech" product consultancy with offices in Brooklyn and Buenos Aires. Its main site doesn't mention the Garmin platform. https://amalgama.co/
- `/privacy` on the Garmin subdomain returned 404. No FAQ, terms, API docs or source were found. https://amalgama.co/privacy-policy/ exists for the consultancy (not read).
- **What it proves:** an approved business can offer Garmin sign-in; it says nothing about personal access. **Could Ben use Amalgama as a bridge?** Not recommended [Inference]:
  - Ben would need an account there (agents must not create one);
  - Amalgama's server would hold his Garmin tokens and data;
  - no privacy policy, terms or API documentation for the platform was found;
  - it would be a remote dependency our app can't control;
  - and it is unclear whether Garmin's partner agreement lets Amalgama pass data on to another app.

  Revisit only if Amalgama publishes terms, a privacy policy and a documented personal export API.

#### 2b-3. The unofficial route, evaluated (read-only use)

**What it is [Doc, source code]:**
- `python-garminconnect` 0.3.x is described as "an unofficial client for Garmin's web services". https://github.com/cyberjunky/python-garminconnect
- Its login code (https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client.py) presents itself as **Garmin's own apps**:
  - mobile SSO `POST sso.garmin.com/mobile/api/login` with `clientId=GCM_IOS_DARK` and an iPhone Safari User-Agent;
  - fallbacks: the SSO embed widget (`/sso/embed`, `/sso/signin`) and the desktop portal (`/portal/api/login`);
  - the service ticket is exchanged at `https://diauth.garmin.com/di-oauth2-service/oauth/token` using Garmin's client IDs (`GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2`, …, `GARMIN_CONNECT_MOBILE_IOS_DI`) with an empty secret;
  - API calls go to `https://connectapi.garmin.com` with `Authorization: Bearer`;
  - TLS impersonation through `curl_cffi` (targets `safari_ios`, `safari`, `chrome120`, …) with deliberate 3–20 s delays "anti-WAF".

**Auth now [Doc + Reports]:**
- **The OAuth1 path is dead.** `garth` used the OAuth1 "preauthorized" exchange, whose often-quoted token lasted about a year. That figure is not re-verified here, and the path no longer works for new logins. garth was deprecated on 27 Mar 2026: "Garmin recently changed their auth flow, breaking the mobile auth approach". https://github.com/matin/garth/discussions/222
- **Current tokens:** DI OAuth2 access and refresh tokens. "DI tokens auto-refresh indefinitely as long as the refresh token remains valid." The library refreshes when the JWT `exp` is within 900 s, and on a 401.
  - Lifetimes are not stated. [Inference] If they match the partner spec, expect about 24 h access and about 90 days refresh. Each refresh issues a new refresh token, so a regular user would rarely need to sign in again. To be measured.
- **MFA** is supported: a `MFA_REQUIRED` response leads to email or SMS code verification, and `resume_login()` completes it.
- **Logout** "does not revoke a token that has already been issued". Revoke in Garmin account settings.
- **Token handling:** "Treat the token file like a password: the refresh token can provide persistent account access."

**Data exposed [Doc, source code `garminconnect/__init__.py`]:**

| Data | Endpoint / method | In Apple Health? |
|---|---|---|
| Activity list | `/activitylist-service/activities/search/activities` | Workouts only |
| **Original FIT file** | `/download-service/files/activity/{id}` (also TCX, GPX, CSV export) | **No** |
| Heart rate (daily) | `get_heart_rates` → `/wellness-service/wellness/dailyHeartRate/…` | Yes (coarse) |
| Resting HR | `get_rhr_day` | Probably |
| **HRV** | `get_hrv_data` → `/hrv-service/hrv/{date}` | **No** |
| Sleep (Garmin detail and score) | `get_sleep_data` → `/wellness-service/wellness/dailySleepData/…` | Partial (sleep analysis only) |
| **Body Battery** | `get_body_battery` | **No** |
| **Training Readiness** | `get_training_readiness` → `/metrics-service/metrics/trainingreadiness/{date}` | **No** |
| **Training status / load** | `get_daily_training_status`; training-load methods (0.3.17) | **No** |
| **VO2max** | `get_max_metrics` → `/metrics-service/metrics/maxmet/…` | Unconfirmed / No |
| **Stress** | `get_stress_data` | **No** |
| Endurance score, race predictions | `get_endurance_score`, `get_race_predictions` | **No** |

The library also has write methods (upload, edit, delete, schedule, weigh-ins…). **Our adapter would implement none of them** (Ben: read-only).

**On-device in React Native/TypeScript, or a server? [Inference]**
- Nothing in the flow needs a server. It is plain HTTPS form POSTs and JSON GETs with an empty client secret, which React Native `fetch` (NSURLSession on iOS) can do.
- Cloudflare TLS fingerprinting is the main obstacle for *Python*: issue #444 says a valid token gets 403 with plain `requests`, while `curl_cffi` works. https://github.com/cyberjunky/python-garminconnect/issues/444
  - The library's preferred impersonation target is `safari_ios`. Requests from a real iPhone use Apple's own TLS stack, so they plausibly look *more* genuine than Python does.
  - This is unproven, and the request headers would still mimic Garmin's app.
- **A safer login design:** load Garmin's SSO embed widget in a web view (`react-native-webview`), let Ben type his password and MFA code into Garmin's page, capture the `ticket=ST-…` from the success page, then exchange it at `diauth`. The app never sees or stores the password.
  - Untested. The `service_url` must match the one used at login.
- **No maintained TypeScript library exists.**
  - npm `garmin-connect` was last published as **1.6.2 on 2024-01-17**. It uses OAuth1 (`oauth-1.0a`), MFA is still on its to-do list, and it depends on Node-oriented packages. https://registry.npmjs.org/garmin-connect, https://github.com/Pythe1337N/garmin-connect
  - We would port and maintain a small read-only client ourselves, and track Python fixes by hand.

**Garmin's terms and account risk:**
- [Doc] The Garmin Connect Developer Program Agreement prohibits using the API to build an application "that uses any robot, spider, site search or other retrieval application or device to scrape, retrieve or index services provided by Garmin". https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf (via search snippet; this binds licensed developers, not consumers).
- **Garmin's consumer Terms of Use could not be retrieved** (https://www.garmin.com/en-US/legal/terms-of-use/ rendered no body). I can't quote a consumer clause. Ben can read it himself before deciding.
- [Reports] Third-party projects describe the route as "against Garmin Connect's terms of service" or a "grey zone" (https://ghurt.org/garmin-api-for-personal-use, search summary). [Inference] Logging in with Garmin's own app client IDs and spoofed app headers to get around bot protection is hard to square with any normal terms. Treat it as **likely not permitted**, even though it only reads Ben's own data.
- [Reports] **Account risk:** one forum user reports an **account-level 429 on API login for 48+ hours** after a few failed attempts, while web and mobile still worked. https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273. No reports of permanent bans were found, which doesn't prove there are none.

**Breakage record 2025–2026 [Doc: GitHub issues and releases]:**
- Aug 2025: garth #137, 401 on `sso/signin` despite correct credentials. https://github.com/matin/garth/issues/137
- **Mar 2026: major break.** Login change plus Cloudflare 429s; garth deprecated (27–28 Mar). python-garminconnect issues #332, #337, #344 and #350 were closed by **11–13 Apr 2026** after it switched to its own multi-strategy login. That is about 2–3 weeks with no new logins. https://github.com/cyberjunky/python-garminconnect/issues/337
- Jun 2026: #369 "Token is not active" since about 1 Jun; #372 401 on token generation (closed 9 Jul and 13 Jun).
- Aug–Sep 2026: MFA fixes (#386, #416); a migration break for garth-token users (#439, fixed 29 Sep).
- **Open now:** #444 (28 Sep 2026: valid token gets 403 unless the TLS fingerprint is impersonated) and #453 (7 Oct 2026: first SSO request returns 429). https://github.com/cyberjunky/python-garminconnect/issues?q=is%3Aissue+login+OR+429+OR+auth+OR+cloudflare
- Releases 0.3.8–0.3.17 (27 Jul – 29 Sep 2026) include several auth and endpoint fixes, e.g. a new header Garmin's goal service requires (0.3.16). https://github.com/cyberjunky/python-garminconnect/releases
- [Inference] Expect a disruption every 1–3 months, sometimes lasting weeks. Our TypeScript port would lag behind the Python fixes.

**Credential handling (if built) [Inference; satisfies rule 7]:**
- The password is typed only into Garmin's page in the web view, never stored, never logged, and never sent to the coach.
- Store only the refresh token (plus the access token in memory) with `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (see `ios-platform-feasibility.md` §2.2). Exclude it from backups and exports.
- A Disconnect button deletes the Keychain items and tells Ben to revoke the session in Garmin account settings (the library notes there's no programmatic revoke).
- Never retry login automatically after a 429 or 401. Show "Garmin sign-in needed" and offer FIT import.
- Garmin data sent to the coach goes to OpenAI as context. That is Ben's call, and it should be stated in the Data sources screen.

**Honest ranking for Ben (read-only) [Inference]:**

| Route | Data richness | Automatic? | Reliability | Permitted? | Setup and risk | Rank |
|---|---|---|---|---|---|---|
| **FIT import** (Garmin web export / USB from the watch) | Full activity detail incl. per-second HR; no wellness | Manual | Very high (file format is stable) | Yes (his own export) | None | **1: build first** |
| **HealthKit** (Garmin → Apple Health) | Workouts, coarse HR, sleep, probably RHR; **no** HRV, readiness, Body Battery | Yes | High *if* the entitlement works; likely blocked on SideStore | Yes (official) | Probe needed; paid programme fixes it | **2: probe now; build if it passes** |
| **Unofficial Garmin Connect (on-device)** | Richest: original FIT + HRV, Body Battery, Readiness, training status, VO2max, sleep detail | Yes | Low–medium (breaks every 1–3 months; two auth issues open now) | Likely against Garmin's terms; Ben's account at risk of lockouts | Ben's login in a web view; refresh token in Keychain; we maintain a TypeScript port | **3: opt-in experiment only, with Ben's explicit acceptance** |
| Bluetooth live HR | Live HR only | During workouts | Model-dependent | Yes | Battery | 4: later |
| Official partner API / Amalgama bridge | Rich | Yes | High | Yes for partners; not for Ben | Business-only, paused, server; third party holds data | Not feasible / not recommended |

### 2c. Garmin Connect IQ

Not pursued, per Ben (a watch-side app or write route). For the record: the SDK supports Windows (https://developer.garmin.com/connect-iq/sdk/), and `.prg` files can be sideloaded over USB (https://forums.garmin.com/developer/connect-iq/w/wiki/4/new-developer-faq/revision/19).

### 2d. FIT file import (primary route)

- **Getting the files:**
  - [Reports] The mobile app can't export files. On the web, the activity's gear menu → Export File/Original gives a ZIP with the FIT. https://support.strava.com/en-us/articles/15402167-exporting-files-from-garmin-connect, https://www.gneta.app/blog/export-garmin-data-guide (vendor, updated 10 Aug 2026)
  - Bulk export (Account → Data Management) holds FIT files in nested ZIPs, with wellness JSON reportedly under `DI-Connect-Wellness/` (unverified).
  - [Inference] He could also copy files from the watch's `GARMIN/Activity` folder over USB on his Windows laptop.
- **Parsing:**
  - [Doc] `fit-file-parser@6.1.2` (MIT): https://registry.npmjs.org/fit-file-parser/latest.
  - Garmin's `@garmin/fitsdk@21.218.0` is licensed for "internal business purposes", treated as confidential, with no redistribution: https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/LICENSE.txt. Prefer the MIT parser.
- **Behaviour [Inference]:**
  - Endurance activities → `EnduranceActivity`, de-duplicated by `file_id` plus SHA-256.
  - Watch strength activities never create a second workout; at most, attach an HR summary to the overlapping app session.
  - Raw values are kept as provenance.
  - **The same parser serves the unofficial route's FIT downloads**, so building Phase 1 first is no wasted work.

### 2e. Strava

- [Doc] Policy (effective 1 Jun 2026) bans using API data in connection with AI development, "training … grounding, evaluation", except via the Strava MCP for subscribers' "personal use of their own Strava data". https://www.strava.com/legal/api_policy
- [Doc] The MCP launched "with Anthropic (Claude)" and is for paid subscribers only. https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector
- [Inference] Our coach is ChatGPT and Ben's data starts at Garmin, so Strava is not a route now.

### 2f. Live HR over Bluetooth (optional)

- [Doc] Garmin manuals: the watch can broadcast HR, automatically at activity start, at a cost in battery. https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html
- [Reports] Some models broadcast only over ANT+, which an iPhone can't receive; newer ones also use Bluetooth. https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html, https://www.zwift.com/eu-de/news/21185-do-i-need-a-watch-to-run-on-zwift
- [Inference] CoreBluetooth needs only Info.plist keys, so it is free-provisionable.

## 3. Recommendation: phased plan, display and coach use

### Phases

| Phase | What | When | Risk | Value |
|---|---|---|---|---|
| 0 | Ask Ben the Recommendation 1 questions; **HealthKit read-only probe** | Now | Very low | Settles HealthKit |
| 1 | **FIT import** + Data sources screen | Build step 6, or earlier on request | Low | High |
| 2a | **HealthKit read** (if the probe passed) | After phase 1 | Medium | Medium |
| 2b | **Unofficial Garmin connector, experimental** (only if Ben accepts the risks). First a spike on the iPhone: web-view login, ticket exchange, one GET for the activity list and one FIT download. Build only if the spike passes | After phase 1; Ben's decision | High (terms, breakage, account lockouts) | High *while it works*; FIT import stays the fallback |
| 3 | Bluetooth live HR | Step 7 | Medium | Low–medium |

### What to show in the app [Inference; consistent with `docs/design/progress.md` §2.8 and `weekly-plan.md` WP3]

- One card per sport; no combined strength + endurance number (C8).
- A source tag on every value: `Garmin FIT file, imported 3 Oct` · `Garmin via Apple Health` · `Garmin Connect (unofficial), synced 08:12`.
- **Profile → Data sources:** honest status per source. The unofficial row also says "Unofficial; may stop working; uses your Garmin sign-in" and has Disconnect.
- **Garmin-derived scores** (Body Battery, Training Readiness, HRV status, training status) are hidden by default.
  - With phase 2b and Ben's opt-in, show them as `Garmin's estimate` with source and date. This is not invented data (rule 6), but `progress.md` currently rules source-derived metrics out, so it needs a **designer decision and Ben's approval**.
  - We never compute our own readiness or recovery score.
- Readiness stays self-reported (P11).

### How it feeds the coach [Inference; rules from `docs/training-guides/concurrent-training.md`]

- **Read-only tools:**
  - `get_endurance_activities(range)`, with source and import time;
  - `get_wellness_observations(range)` for sleep and resting HR, plus Garmin scores only if opted in, each with source and `kind: 'garmin_estimate'`.
  - Neither returns any derived score of ours.
- **C3:** a planned key long run on Saturday and heavy legs on Thursday → the coach offers a proposal (Apply/Undo). It never overwrites the run.
- **C4:** "You ran 21.1 km yesterday (Garmin FIT, imported this morning). Want lighter legs today?" It offers and doesn't apply. With no data, it makes no fatigue claim (scenario 9).
- **Garmin's scores** may be quoted as Garmin's figures when relevant ("Garmin's Training Readiness this morning: 32, low"). They don't change loads unless Ben approves a playbook rule, after `training-researcher` grades the evidence.
- Imported data and FIT text fields are data, not instructions (rule 8).

## 4. Unknowns only a real end-to-end test can settle

1. Watch model, firmware, and Bluetooth HR broadcast during Strength and Run activities.
2. Whether HealthKit survives SideStore signing, and the exact error if not (Sideloadly as a second check).
3. If HealthKit works: the exact types Garmin writes for Ben's account, HR density, how the Strength activity is mapped, and whether old data is backfilled.
4. Whether Garmin Connect writes to Apple Health only while its app is open (claimed, unverified).
5. Whether Garmin Connect web export works in Safari on the iPhone, and how a shared ZIP reaches our app.
6. How FIT files from Ben's watch encode strength sets and HR; how well overlap matching works.
7. Bulk-export wellness JSON contents.
8. Bluetooth broadcast battery cost.
9. **Unofficial route:**
   - whether the web-view login (embed widget) plus DI exchange works from the iPhone, with and without MFA;
   - whether `connectapi` accepts iOS `fetch` without TLS impersonation (Cloudflare);
   - the real access and refresh token lifetimes;
   - how often a re-login is needed over 4+ weeks;
   - whether any login triggers a 429 lockout on Ben's account;
   - what Garmin's consumer Terms of Use say (Ben to read).
10. Whether Amalgama offers a personal export API, and under what terms (only if Ben wants to pursue it; no account is to be created by agents).

## Proposed brief changes (for Ben's approval)

1. **Connections → Garmin (contradicts the current framing).** Replace with:
   > "Read-only; the app never writes to Garmin. The Garmin Connect Developer Program (used by partner sites such as garmin.amalgama.co) is business-only, server-based and paused for new applicants, so it is not a route. Primary: FIT import. Secondary: Apple Health read, if the probe passes. Optional, experimental, Ben's explicit opt-in: an on-device unofficial Garmin Connect reader. It is read-only by allowlist, labelled unofficial, and stores no password; it is likely contrary to Garmin's terms and may break at any time; FIT import is always the fallback. Optional later: Bluetooth live HR."
2. **§11 dependencies:** remove "Garmin approval/partner route". Add "watch model; Apple Health toggle list; HealthKit probe result; Ben's decision on the unofficial connector".
3. **Connections → Apple Health:** add the field table; note that Apple HRV (SDNN) isn't comparable with Garmin's; HealthKit is likely stripped by SideStore; request read-only (`toRead` only, `NSHealthUpdateUsageDescription: false`, `background: false`).
4. **Connections → Strava:** "The MCP is Claude-only and subscriber-only; our coach is ChatGPT and Ben's data starts at Garmin, so Strava is not a route now."
5. **§5/§6 data model:** FIT import with `file_id` + checksum de-duplication and overlap matching. A `WellnessObservation` entity (metric, value, unit, source, `kind: measured | garmin_estimate`, device, window, read time). `ReadinessEntry` stays self-reported.
6. **§8 coach tools:** read-only `get_endurance_activities` and `get_wellness_observations`.
7. **Design (`progress.md` §2.8):** decide whether opted-in Garmin estimates may be displayed with an "estimate" label. They currently can't be.
8. **Validation:**
   - extend scenario 9: "Garmin scores absent, or the unofficial sync is broken → the coach says so and doesn't estimate";
   - add "the same FIT file twice, or a watch strength activity overlapping an app session → no duplicate";
   - add "unofficial sync returns 429/401 → no automatic re-login; FIT import offered".
9. **ADR at phase 1:** "Wearable data: read-only, FIT-first; HealthKit behind a capability flag; unofficial Garmin connector only as an opt-in experiment". It records the rejected routes and the reasons.

No contradiction with CLAUDE.md was found. Rule 7 (protected credentials) shapes the unofficial-route design.

## Sources (checked 2026-10-08; Amalgama/unofficial items 2026-10-09)

- Vendor blog: https://www.sensai.fit/blog/best-ai-workout-app, https://www.sensai.fit/help/connect-wearable-to-sensai-apple-health
- Apple: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data, https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn, https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios
- HealthKit module: https://github.com/kingstinct/react-native-healthkit, https://registry.npmjs.org/@kingstinct/react-native-healthkit/latest, https://raw.githubusercontent.com/kingstinct/react-native-healthkit/master/packages/react-native-healthkit/app.plugin.ts
- SideStore/AltStore source: https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Capabilities/ALTCapabilities.m, https://raw.githubusercontent.com/SideStore/AltSign/master/AltSign/Signing/ALTSigner.mm, https://raw.githubusercontent.com/rileytestut/AltSign/master/AltSign/Capabilities/ALTCapabilities.m, https://raw.githubusercontent.com/rileytestut/AltStore/develop/AltStore/Operations/FetchProvisioningProfilesOperation.swift
- Garmin official: https://developer.garmin.com/gc-developer-program/program-faq/, https://developer.garmin.com/gc-developer-program/overview/, https://developer.garmin.com/gc-developer-program/health-api/, https://developer.garmin.com/gc-developer-program/training-api/, https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf, https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf (snippet), https://www.garmin.com/en-US/legal/terms-of-use/ (no body rendered), https://developer.garmin.com/connect-iq/sdk/, https://developer.garmin.com/fit/overview/, https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/LICENSE.txt, https://github.com/garmin/fit-javascript-sdk, https://registry.npmjs.org/@garmin/fitsdk/latest, https://www8.garmin.com/manuals-apac/webhelp/forerunner965/EN-SG/GUID-6A7D55B6-EBC0-4235-8970-FE3795630EEF-8656.html, https://support.garmin.com/en-NZ/?faq=lK5FPB9iPF5PXFkIpFlFPA&productID=125677 (403)
- Amalgama: https://garmin.amalgama.co/, https://garmin.amalgama.co/garmin_oauth/start (302 observed, not followed), https://garmin.amalgama.co/privacy (404), https://amalgama.co/
- Unofficial libraries: https://github.com/cyberjunky/python-garminconnect, https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/README.md, https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client.py, https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/__init__.py, https://github.com/cyberjunky/python-garminconnect/releases, https://github.com/cyberjunky/python-garminconnect/issues?q=is%3Aissue+login+OR+429+OR+auth+OR+cloudflare, https://github.com/cyberjunky/python-garminconnect/issues/337, https://github.com/cyberjunky/python-garminconnect/issues/444, https://github.com/matin/garth/discussions/222, https://github.com/matin/garth/issues/137, https://github.com/isllabres/garmin-mcp-server/pull/16, https://github.com/Pythe1337N/garmin-connect, https://registry.npmjs.org/garmin-connect, https://ghurt.org/garmin-api-for-personal-use, https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273
- Garmin forums: https://forums.garmin.com/developer/connect-iq/f/discussion/434542/garmin-connect-developer-program---access-request-rejected-without-notification, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/427363/data-consistency-between-apple-health-and-garmin, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/254977/request-for-spo2-vo2-max-and-respiration-data-to-be-shared-to-apple-health-app, https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience, https://forums.garmin.com/sports-fitness/healthandwellness/f/venu-3-series/426499/request-for-hevy-integration-with-garmin-connect, https://forums.garmin.com/developer/connect-iq/f/discussion/437274/feature-request-mcp-integration-to-enable-claude-ai-access-to-garmin-connect-data-to-the-garmin-product-and-developer-teams, https://forums.garmin.com/developer/connect-iq/w/wiki/4/new-developer-faq/revision/19
- Press and third-party: https://the5krunner.com/2025/06/20/garmin-to-add-health-connect-support-to-apple/, https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/, https://sahha.ai/blog/garmin-developer-program-paused/, https://trainconstant.com/blog/garmin-apple-health, https://www.reaction-club.com/guides/garmin-apple-health, https://www.gneta.app/blog/export-garmin-data-guide, https://support.strava.com/en-us/articles/15402167-exporting-files-from-garmin-connect, https://dcrainmaker.com/2020/06/tidbit-bluetooth-broadcasting.html, https://www.zwift.com/eu-de/news/21185-do-i-need-a-watch-to-run-on-zwift, https://glama.ai/mcp/servers/Taxuspt/garmin_mcp, https://help.fitbod.me/hc/en-us/articles/39224086573207-Live-Heart-Rate-Tracking (snippet)
- FIT parser: https://registry.npmjs.org/fit-file-parser/latest
- Strava: https://www.strava.com/legal/api_policy, https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector
- Project docs read: `CLAUDE.md`, `docs/brief/training-app-build-brief.md`, `docs/brief/CHANGELOG.md`, `docs/decisions/0004-free-distribution-sidestore.md`, `docs/research/free-ios-install.md`, `docs/research/ios-platform-feasibility.md`, `docs/training-guides/concurrent-training.md`, `docs/device-tests/2026-10-08-probe-build7.md`, `docs/design/progress.md`, `docs/design/weekly-plan.md`
