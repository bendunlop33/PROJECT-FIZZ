# Online backup to Ben's own Google Drive (app-data folder)

Researcher, 12 Oct 2026. Status: **research only; build parked until Ben approves** (backlog, "Online backup to Google Drive", Ben 12 Oct).
All sources were checked on 2026-10-12. **Adversarial re-check (12 Oct):** the 7-day Testing expiry, `drive.appdata` as non-sensitive, the unverified-screen/100-user-cap scope rule, the non-sensitive verification exemption, Drive API pricing and the 6-month client deletion were re-read on the primary pages and hold; wording fixed where noted. Still **unverifiable from docs**: whether Google checks the iOS bundle ID at runtime, whether custom schemes still work for new iOS clients, whether the folder is per-client or per-project (G3), whether appdata counts against Drive storage, and whether publishing asks for anything (G4). The SideStore `.<TEAMID>` bundle-ID suffix rests on one device observation plus AltStore source, not on SideStore docs. Each claim is tagged **[Doc]** (official documentation), **[Community]** (forums, third-party write-ups), **[Repo]** (this repository or Ben's device tests) or **[Inference]** (my reasoning, unproven).

## Summary

1. It can be built with no server and no SDK. Use a Google **iOS** OAuth client, PKCE and a reversed-client-ID redirect caught by `ASWebAuthenticationSession`. That means extending the existing `loopback-auth` Swift module with a custom-scheme mode. Google has deprecated loopback for iOS clients, and Google iOS clients have no secret.
2. The 7-day refresh-token expiry in "Testing" is real [Doc]. Avoid it by publishing the consent screen to **In production**. `drive.appdata` is classed **non-sensitive** [Doc], so the unverified-app screen and the 100-user cap should not apply [Inference]. Ben is also covered by the "personal use" exemption from verification [Doc].
3. The Drive API costs $0 at this usage, and the docs ask for no billing account [Doc]. Backups go into the hidden `appDataFolder` with resumable uploads, and the newest N copies are kept by listing and deleting. A workout costs a few hundred quota units against a 325,000-per-user-per-minute limit.
4. Upload in the foreground after Finish, from the on-phone backup that already exists. Hold a UIKit background task while it runs, and retry from a persistent queue on launch or foreground. BGTaskScheduler is possible without entitlements (Info.plist keys only), but it is optional. Keychain items must be readable after first unlock if background retries are ever added.
5. Unknowns only a device or console test can settle: whether Google checks the bundle ID or rejects custom schemes for iOS clients at runtime, whether a Production app with only non-sensitive scopes still shows a warning, and whether a second OAuth client in the same project can read the first client's `appDataFolder`. **Proposed brief changes** are included (§9).

## Recommendations

1. **Client and redirect.** Use an iOS client type. The redirect is `com.googleusercontent.apps.<ID>:/oauth2redirect`. Add a `callback: .customScheme(...)` mode to `apps/mobile/modules/loopback-auth`, so there is no new native module and no Info.plist URL type is needed [Inference, test]. Request only `https://www.googleapis.com/auth/drive.appdata`, so no granular-consent checkbox appears [Doc]. Show the connected account through Drive `about.get` (`user.emailAddress`) rather than adding `openid email` [Inference, test that `about.get` works with this scope alone]. The fallback, only if the device test fails, is a Desktop client with the existing loopback listener.
2. **Publishing status.** Set **In production**, user type External, scope `drive.appdata` only, with no logo. Ben signs in once after publishing. Tokens issued while the app was in Testing are not relied on.
3. **Tokens.** Store them in a new Keychain service (e.g. `fizz.google`), not the ChatGPT one. Use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` rather than `WHEN_UNLOCKED_…`, so a retry while the phone is locked can still refresh [Inference]. *(Superseded: the draft decision keeps `WHEN_UNLOCKED_THIS_DEVICE_ONLY` because v1 has no locked-phone background task; SEC §2.)* Refresh on demand. Treat `invalid_grant` as "Reconnect Google"; network and 5xx errors keep the tokens. This is the same rule as ADR 0012's `TokenRefresher`, and the code can be shared. Disconnect calls `https://oauth2.googleapis.com/revoke`.
4. **Upload.** Reuse the newest on-phone backup file (ADR 0005/0009 format, with its SHA-256) instead of serialising again. Use one resumable upload path for every size, with `parents:["appDataFolder"]`. Put the backup's SHA-256, `formatVersion`, `schemaVersion`, `finishedWorkouts`, `finishedDigest` and an install ID in `appProperties`. Verify `size` (and `sha256Checksum` if Drive returns it) before deleting older copies.
5. **Retention.** Keep the newest **10 online copies** (proposal; Ben decides), separate from the on-phone `Keep` setting. Delete older copies only after a verified upload. Never delete the last copy that covers the newest finished workout.
6. **When it runs.** Start a foreground upload after the on-phone backup that Finish already triggers. Wrap it in `beginBackgroundTask`. Keep a persistent "pending online backup" flag, retried on launch and foreground with backoff, and never while a workout is active. Leave BGTaskScheduler out of v1. Logging never waits for the network (rule 1).
7. **Restore.** Sign in on the new phone, list `appDataFolder`, preview, and then run the existing restore pipeline unchanged (parse, verify, build new file, migrate, integrity check, pointer switch). Cloud files are data (rule 8).
8. **Keep "Save a copy to Files".** The online copy depends on one Google project and one OAuth client that Ben controls, so it is not the only off-phone copy (§7, risks).
9. **Before any build, run spikes G1 to G4 (§8).** G1 can be done in a desktop browser plus `curl`. G2 needs the phone.

---

## 1. OAuth for a native iOS app without an SDK

### 1.1 What Google documents

| Topic | Finding | Tag / source |
|---|---|---|
| Page scope | "OAuth 2.0 for iOS & Desktop Apps", last updated 2026-09-14 | [Doc] https://developers.google.com/identity/protocols/oauth2/native-app |
| Loopback | "The loopback IP address redirect option is DEPRECATED for **Android**, **Chrome app** and **iOS** OAuth client types." Loopback is for the **Desktop app** type ("macOS, Linux, and Windows desktop") | [Doc] same page |
| Custom URI scheme | The same page has a callout: "Custom URI schemes are no longer supported due to the risk of app impersonation." Its redirect table still lists the `com.googleusercontent.apps.123:redirect_uri_path` form | [Doc] same page. The wording is ambiguous; see next row |
| Custom scheme restriction scope | Google's announcement restricts custom schemes for **new Android clients** (off by default; can be re-enabled under Advanced Settings) and **Chrome extensions**. iOS is not named | [Doc] https://developers.googleblog.com/en/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/ |
| iOS still uses the reversed client ID | Google Sign-In for iOS (last updated 2026-03-22): "For iOS and macOS apps the OAuth client ID application type must be configured as iOS". Add "a custom URL scheme based on the reversed client ID" | [Doc] https://developers.google.com/identity/sign-in/ios/start-integrating |
| No SDK needed | AppAuth's Google guide: choose iOS, and the redirect is `com.googleusercontent.apps.IDENTIFIER:/oauth2redirect/google` ("only a single slash"). "Google's iOS clients do not have a secret." | [Doc, OpenID Foundation] https://github.com/openid/AppAuth-iOS/blob/master/Examples/README-Google.md |
| iOS client fields | Bundle ID (required), App Store ID and Team ID (optional). Team ID is required only for App Check, and the bundle ID can't be edited once App Check is on | [Doc] native-app page; https://support.google.com/cloud/answer/15549257 |
| Runtime bundle-ID check | Neither page describes Google checking the bundle ID at runtime. The only attestation is the optional **App Check** (Apple App Attest), and requests aren't blocked until App Check is enforced | [Doc] native-app page. "No runtime check without App Check" is [Inference] |
| PKCE | Supported. Verifier 43–128 chars. S256 recommended; `plain` is the default if the method is omitted | [Doc] native-app page |
| Endpoints | Authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, revoke `https://oauth2.googleapis.com/revoke`. `client_secret` "Optional"; "refresh tokens are always returned for installed applications" | [Doc] native-app page |
| Embedded web views | WKWebView is refused (`disallowed_useragent`). Use the system browser or SDK; `SFSafariViewController` is listed | [Doc] native-app page |
| Desktop secret | A Desktop client gets a secret, shown once and then hashed. Developers report `client_secret is missing` when they omit it with PKCE | [Doc] https://support.google.com/cloud/answer/15549257 ; [Community] https://discuss.google.dev/t/google-auth-platform-question-about-desktop-app-client-and-secret/178938 , https://discuss.google.dev/t/desktop-oauth-pkce-exchange-returns-invalid-request-after-successful-loopback-callback-with-no-client-secret/390526 |
| Unused clients deleted | Clients with no token activity or settings change for 6 months are deleted automatically. An email warns 30 days before. Deleted clients are "typically recoverable at least 30 days" after deletion (re-checked 12 Oct) | [Doc] https://support.google.com/cloud/answer/15549257 |

### 1.2 Redirect options compared

| Option | Works with free provisioning? | Effect of SideStore's bundle-ID suffix | Verdict |
|---|---|---|---|
| **A. iOS client + reversed-client-ID custom scheme** (`com.googleusercontent.apps.<ID>:/oauth2redirect`), caught by `ASWebAuthenticationSession(callback: .customScheme(...))` | Yes. No entitlement. A `CFBundleURLTypes` entry is an Info.plist key, not an entitlement, and is probably not even needed (below) | None on the redirect, because the scheme comes from the client ID, not the bundle ID. The iOS client's registered bundle ID would differ from the installed one unless Ben enters the suffixed ID. SideStore installs as `com.projectfizz.fizz.<TEAMID>` [Repo, `docs/device-tests/2026-10-08-probe-build7.md`]. Entering the installed ID removes any doubt | **Recommended** |
| B. iOS client + bundle-ID scheme (`com.projectfizz.fizz.<TEAMID>:/…`) | Yes | It depends on the suffixed ID, so it changes if the Apple ID or team changes | No. A has no such dependency |
| C. **Desktop** client + loopback `http://127.0.0.1:<port>` (existing `loopback-auth` listener, proven by the ChatGPT S1 test) | Yes [Repo, `docs/device-tests/2026-10-10-chatgpt-signin-s1.md`] | None | **Fallback only.** Google documents loopback for desktop OSes and deprecates it for iOS clients. It needs the Desktop client secret in the app (not confidential, but rule 7 then requires it to stay out of the repo, e.g. as a CI secret) |
| D. Universal links / `https` callback (`.https(host:path:)`, iOS 17.4+) | **No.** It needs the Associated Domains entitlement, which CLAUDE.md forbids, and a web host | n/a | Excluded |
| E. iOS client + loopback | Deprecated by Google for iOS clients [Doc] | n/a | Excluded |

**Does the scheme need registering?** Apple: `ASWebAuthenticationSession` "ensures that only the calling app's session receives the authentication callback, even when more than one app registers the same callback URL scheme" [Doc] https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession (via its JSON at `developer.apple.com/tutorials/data/…`). `init(url:callbackURLScheme:…)` is deprecated in favour of `init(url:callback:…)`. [Inference] The session matches the callback itself, so no `CFBundleURLTypes` entry is needed. Adding one would be harmless (an Info.plist key, not an entitlement). This is part of device test G2.

**SideStore / App Groups.** This feature needs no App Group and no extension. SideStore's App Group renaming (`free-ios-install.md` §6) does not affect it [Inference].

**Why not `expo-web-browser` `openAuthSessionAsync`?** It does use `ASWebAuthenticationSession` [Doc] https://docs.expo.dev/versions/latest/sdk/webbrowser/ . However, its docs say the redirect must use the app's `expo.scheme`, and this app has none. ADR 0012 already chose to have its own module drive the sheet. Adding a `customScheme` mode to `loopback-auth`, with the listener skipped, reuses the presentation anchor, timeout and cancel handling [Repo, `LoopbackAuthModule.swift`]. Expo's Google guide only lists the native SDK wrappers (`@react-native-google-signin/google-signin`, `react-native-nitro-google-signin`) [Doc] https://docs.expo.dev/guides/google-authentication/ (updated 2026-09-17). Those add a dependency and Google Sign-In UI that this feature doesn't need.

**Session options.** Use `prefersEphemeralWebBrowserSession = false`, so Safari's existing Google login is reused and sign-in takes one tap [Inference]. iOS shows its "wants to use google.com to sign in" prompt.

### 1.3 Token lifetime and the "Testing" trap

- **Confirmed [Doc]:** "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days". The exception is when only `openid`/`email`/`profile` are requested. https://developers.google.com/identity/protocols/oauth2 . The same rule appears in https://support.google.com/cloud/answer/15549945 ("Manage App Audience"): test-user authorisations "expire seven days from the time of consent".
- Other refresh-token killers [Doc, same page]: Ben revokes access, **6 months unused**, the per-account limit of 100 refresh tokens per client (the oldest is silently dropped), and a password change only when Gmail scopes are held (not our case).
- Access-token lifetime isn't stated on that page ("limited lifetimes"). It is usually 3,600 s [Inference/Community]; use `expires_in` from the response.
- **To avoid weekly re-sign-in, publish to "In production".** The production rules [Doc] https://support.google.com/cloud/answer/15549945 , https://support.google.com/cloud/answer/7454865 , https://support.google.com/cloud/answer/13464323 :
  - the unverified-app screen and the 100-new-user lifetime cap apply when the app requests **sensitive or restricted** scopes before verification;
  - "If the app is for your personal use (fewer than 100 users)", verification is not needed;
  - brand verification is needed only when an External, published app shows a logo or display name, and apps used by "a few users, all of whom are known personally to you" are exempt. https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
  - [Doc, re-checked 12 Oct] https://support.google.com/cloud/answer/13463073 : "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process." Showing an app **name and logo** on the consent screen needs the lighter brand verification, and the Audience page says a project "may be subject to verification before its name and logo are displayed". So without brand verification the consent page may not show "GymSmarter" [Doc]; what it shows instead is not documented (spike step 2 records it).
  - [Inference] With only `drive.appdata` (non-sensitive), a Production app should show the normal consent screen with no unverified-app warning and no cap. If a warning does appear, Ben can click through ("Advanced → Go to …") and the personal-use exemption still covers him. Device test G2 checks this.
  - [Inference, unverified] Refresh tokens issued while the app was still in Testing may keep their 7-day expiry, so Ben should sign in after publishing.

## 2. The `drive.appdata` scope

| Item | Finding | Tag / source |
|---|---|---|
| Classification | `drive.appdata` / `drive.appfolder`: **Non-sensitive**, "Recommended" ("View and manage the app's own configuration data in your Google Drive"). `drive` and `drive.readonly` are Restricted | [Doc] https://developers.google.com/workspace/drive/api/guides/api-specific-auth |
| Verification | Not mandatory for apps using only non-sensitive scopes; personal use (under 100 users) is also exempt. Brand verification is only needed to display a name and logo | [Doc, re-checked 12 Oct] https://support.google.com/cloud/answer/13463073 ; https://support.google.com/cloud/answer/13464323 |
| 100-user cap | It applies to unverified apps that request sensitive or restricted scopes, or to Testing (100 listed test users). It covers the project's lifetime and can't be reset. It doesn't bind Ben either way | [Doc] https://support.google.com/cloud/answer/15549945 , https://support.google.com/cloud/answer/7454865 |
| Unverified-app screen | Shown for sensitive or restricted scopes without verification. Not expected for non-sensitive only | [Doc]; non-sensitive behaviour is [Inference] |
| Granular consent | With a single non-sign-in scope, "there is no checkbox in the consent screen". Apps must still check the granted `scope` in the token response | [Doc] https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions (updated 2026-05-26) |
| Folder behaviour | Hidden from the user and from other apps. It can't be shared, moved between spaces or **trashed** (deletes are permanent). It is created on first write. The user can delete it manually, and it is deleted when the user uninstalls the app from My Drive | [Doc] https://developers.google.com/workspace/drive/api/guides/appdata (updated 2026-09-03) |
| Counts against Ben's Drive storage | Not stated on the official page. Community sources say it does, and that it is visible and deletable via drive.google.com → Settings → Manage apps → "Delete hidden app data" | [Community] https://forum.rclone.org/t/google-drive-support-for-hidden-appdatafolder/3602 ; the menu labels are unverified |
| Who can read it | "Only the app that created the data can access it" (appdata guide). **Unverified:** whether "app" means the OAuth client or the Cloud project. That matters if the client is ever deleted or a second client is added | [Doc] + open question G3 |

## 3. Drive API usage

- **Upload types** [Doc] https://developers.google.com/workspace/drive/api/guides/manage-uploads (updated 2026-09-03):
  - `uploadType=media` and `multipart` are for files of 5 MB or less;
  - `resumable` is for files over 5 MB or with "a high chance of network interruption … such as when creating a file from a mobile app";
  - the session URI expires after one week of inactivity;
  - `308` means continue, `404` means restart, and `5xx` means resume or retry. Any `4xx` (including 403) during a resumable upload means restart.
  - The endpoint is `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`, with metadata `{name, parents:["appDataFolder"], appProperties:{…}}`.
- **Expected size** [Repo, ADR 0005]: about 1.2 MB for 300 sessions on Node, so years of history may pass 5 MB. **Use resumable only.** The overhead is one extra request, and there is a single code path [Inference].
- **Listing** [Doc] https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list : `spaces=appDataFolder`, `orderBy=createdTime desc` (fine for small collections), `pageSize` up to 1000, `fields=files(id,name,size,createdTime,appProperties,sha256Checksum)`.
- **File metadata** [Doc] https://developers.google.com/workspace/drive/api/reference/rest/v3/files : `appProperties` are "private to the requesting app". `sha256Checksum` is returned "if available". `md5Checksum` is set for binary content. No size limits for `appProperties` are stated on that page, so keep them short [Inference].
- **Quotas and price** [Doc] https://developers.google.com/workspace/drive/api/guides/limits (updated 2026-09-11):
  - 1,000,000 quota units per minute per project, and 325,000 per minute per user per project;
  - costs are list = 100, read = 5, edit = 50, download = 200 and "other actions, such as `files.generateIds`" = 5 units; create, delete and upload are not named individually (re-checked 12 Oct);
  - "no limit to the number of requests you can make per day";
  - "All standard use of the Google Drive API is available at no additional cost". Only *exceeding* quota "is planned to incur charges to your Google Cloud billing account later in 2026", with at least 90 days' notice, and usage under a daily threshold of 400,000,000 units per project "isn't billed" (re-checked 12 Oct). A project with no billing account has nothing to charge [Inference];
  - users may upload 750 GB per day;
  - the docs ask for 403 `userRateLimitExceeded` and 429 to be handled with exponential backoff.
  - **$0 for Ben** [Inference from the Doc]. Per workout this is about 1 list, 1 create, a few deletes and 1 metadata read, a few hundred units. The docs nowhere require a billing account, and this research didn't open the console to confirm (G4).
- **Retention.** After a verified upload, list the folder, sort newest first, keep N, and `files.delete` the rest (permanent). Never delete a file whose `finishedDigest` is the newest one. Name files `fizz-backup-<UTC>-<installId>.json`, so that if both an old and a new phone upload during a migration, the copies are easy to tell apart [Inference].

## 4. iOS background constraints and offline queueing

- **Foreground plus a short background extension.** The `loopback-auth` module already uses `UIApplication.beginBackgroundTask` [Repo]. A 1 to 5 MB upload normally finishes within that window [Inference]. If time runs out, the pending flag stays and the upload resumes (resumable session URI, valid for 1 week) or restarts later.
- **BGTaskScheduler without entitlements.** It needs the Background Modes capability (`UIBackgroundModes`: `fetch` and/or `processing`) and `BGTaskSchedulerPermittedIdentifiers`. Apple names no separate entitlement. Tasks run when the system chooses, and their launch handlers must be registered at launch [Doc] https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app .
  - `expo-background-task` adds `processing` and `com.expo.modules.backgroundtask.processing` through prebuild. Its minimum interval is 15 minutes (12 h default), it runs only on a physical device with network and battery, and it stops after a force-quit [Doc] https://docs.expo.dev/versions/latest/sdk/background-task/ .
  - [Inference] These are Info.plist keys, like the `UIBackgroundModes: audio` experiment already in `app.config.ts`, so they should survive `with-free-provisioning`. A SideStore-signed device test would confirm. **Not needed for v1.**
- **BGContinuedProcessingTask (iOS 26).** It starts in the foreground "only in response to someone's action, such as tapping a button" and shows a system Live Activity with progress. Only GPU use needs an entitlement [Doc] https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados . It would fit a manual "Back up now" or a large restore, but adds UI for little gain. Not recommended for v1.
- **Background URLSession uploads** are another option with no entitlement [Inference; not researched in depth]. Deferred.
- **Keychain accessibility.** A background task can run while the phone is locked. `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, used for the ChatGPT tokens [Repo, ADR 0012], would block the Google refresh token there. Use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` for the Google item [Inference based on Apple's accessibility classes; not re-fetched today].
- **Offline queue.** Keep one durable record, not a queue of files. It holds "online copy owed for finishedDigest X", the last success time and the last error. On launch, foreground or after Finish: if signed in, the network is available, no workout is active and something is owed, upload the newest on-phone backup. Back off on failure (e.g. 1 min, 5 min, 30 min, then the next launch). Status shows `Online copy · Thu 8 Oct` or `Not backed up online` (design-system §7 icons; minimal copy).

## 5. What Ben sets up in Google Cloud Console (once, about 10 minutes)

Ben does this himself with his Google account. Agents must not sign in. Labels are as of the 2025–26 "Google Auth Platform" console. [Inference] They may differ slightly.

1. Go to https://console.cloud.google.com → **Create project** (e.g. "GymSmarter Backup"). Don't add a billing account.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform → Get started / Branding:** set the app name ("GymSmarter"), the user support email (Ben's) and the developer contact email (Ben's). Leave the logo empty, since a logo triggers brand verification.
4. **Audience:** set user type **External**. Optionally add Ben as a test user while testing.
5. **Data access → Add or remove scopes:** add `https://www.googleapis.com/auth/drive.appdata` only. It should appear under non-sensitive scopes.
6. **Clients → Create client → iOS:** name it "GymSmarter iPhone". For **Bundle ID**, enter the *installed* ID shown on the app's capability probe (`com.projectfizz.fizz.<TEAMID>`). Leave App Store ID and Team ID empty, and **don't enable App Check**: App Attest needs an entitlement that free provisioning can't add [Inference]. Copy the **Client ID** and the **iOS URL scheme**.
7. **Audience → Publish app → confirm "In production".** No verification submission is needed.
8. Give the developer the Client ID. The ID isn't a secret (iOS clients are public), but keep it out of the repo anyway: use a GitHub Actions repository variable (e.g. `FIZZ_GOOGLE_IOS_CLIENT_ID`) that is read at prebuild into `extra`.
9. Keep the project. Don't delete the client. Regular backups count as token activity, which prevents the 6-month auto-delete [Doc]. If the 30-day deletion warning email ever arrives, use the app once or edit the client.

## 6. Design implications (inference, for the designer and developer)

- Put a **Profile → Backups → Online copy** row with `Connect Google Drive`. When connected it shows the account (Drive `about.get`), the last online copy, `Back up now` and `Disconnect` (which revokes and keeps the cloud files). Add a separate `Delete online copies`. Keep the copy minimal.
- **Rule 10 / ADR 0023.** Online copies contain **Your data**. "Delete all my data" should offer to delete online copies too, and must say plainly if they can't be deleted while offline.
- **Rule 7.** Tokens go only in Keychain, and the client ID comes from CI. Use no paid route; Drive is free.
- **Rule 1.** Nothing in the logging path waits on Google. An AI-style "connecting…" never blocks Finish.
- **Encryption.** It would match ADR 0005 to leave online copies as plain JSON (Ben was asked to confirm plain JSON for Files). Client-side encryption with a Keychain key would make restore on a new phone impossible, and a passphrase is another thing to lose. This is Ben's decision; the default is unencrypted, the same as Files.

## 7. Risks

- **The OAuth client or project is lost.** If `appDataFolder` is per client (G3) and the client is deleted (6 months idle, 30-day restore) or the project is deleted, the online copies can't be read by any new client. They can't be downloaded via the Drive UI either, only deleted [Doc + Inference]. Mitigation: keep the Files copies, and test G3.
- **Apple ID or team change.** The bundle ID suffix changes. If Google doesn't check the bundle ID (G2), nothing breaks. Otherwise, edit the iOS client's bundle ID (Google only says it *can't* be edited once App Check is on, so editing without App Check is [Inference]) or add a second client, which depends on G3.
- **Google rejects custom schemes for iOS clients** (the ambiguous callout in §1.1). Then use option C (Desktop + loopback) with the CI-held Desktop secret.

## 8. Spikes before build (only real tests settle these)

| ID | Where | What it settles |
|---|---|---|
| G1 | Laptop browser + `curl` (Ben runs it with his own account) | With an iOS client, can an authorisation URL using `redirect_uri=com.googleusercontent.apps.<ID>:/oauth2redirect`, PKCE S256 and `scope=drive.appdata` reach consent? Is there any warning in Production? Does the token exchange work without a secret? Is `expires_in` present and is a `refresh_token` returned? |
| G2 | Ben's iPhone, SideStore build | `ASWebAuthenticationSession(.customScheme)` returns the callback with no `CFBundleURLTypes` entry. Google accepts it even if the registered bundle ID is the unsuffixed `com.projectfizz.fizz` (tests the runtime bundle-ID check). A resumable upload of a real backup works, list/delete work, and `about.get` works with `drive.appdata` alone. A refresh more than 7 days after sign-in still works (proves Production avoids the 7-day expiry). The Keychain read works while locked if background retries are added |
| G3 | `curl` with two clients in the same project | Can client B list files that client A wrote to `appDataFolder`? This decides the client-loss risk |
| G4 | Console | Production publishing needs no billing account, privacy-policy URL or verification for a non-sensitive-only app |

## 9. Proposed brief changes (Ben approves; not applied)

1. **Brief §5, Backup row** ("Versioned export/restore to a user-selected destination"). Add: "Optional automatic online copy to the owner's own Google Drive app-data folder (`drive.appdata`, no server). Backup only, no sync. Files export remains." This sits within CLAUDE.md's "no cross-device sync" because it is restore-only. It needs no new entitlement.
2. **Brief §7 `createBackup(destination)`.** Note that the online destination uploads the existing on-phone snapshot file rather than creating a new one.
3. **A new ADR at build time** (e.g. `docs/decisions/00NN-google-drive-online-backup.md`) for these decisions: iOS client + custom scheme over loopback; Keychain `AFTER_FIRST_UNLOCK` for this item, which differs from ADR 0012's `WHEN_UNLOCKED` for ChatGPT; and the online retention rule.

## Sources (all checked 2026-10-12)

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/identity/sign-in/ios/start-integrating
- https://developers.googleblog.com/en/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/
- https://github.com/openid/AppAuth-iOS/blob/master/Examples/README-Google.md
- https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://support.google.com/cloud/answer/15549945 (Manage App Audience)
- https://support.google.com/cloud/answer/7454865 (Unverified apps)
- https://support.google.com/cloud/answer/13464323 (When is verification not needed)
- https://support.google.com/cloud/answer/15549257 (Manage OAuth Clients)
- https://developers.googleblog.com/en/usability-and-safety-updates-to-google-auth-platform/
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/limits
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files and …/files/list
- https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession
- https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app
- https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados
- https://docs.expo.dev/versions/latest/sdk/background-task/
- https://docs.expo.dev/versions/latest/sdk/webbrowser/
- https://docs.expo.dev/guides/google-authentication/
- [Community] https://discuss.google.dev/t/google-auth-platform-question-about-desktop-app-client-and-secret/178938 ; https://discuss.google.dev/t/desktop-oauth-pkce-exchange-returns-invalid-request-after-successful-loopback-callback-with-no-client-secret/390526 ; https://forum.rclone.org/t/google-drive-support-for-hidden-appdatafolder/3602
- [Repo] `docs/device-tests/2026-10-08-probe-build7.md`, `docs/device-tests/2026-10-10-chatgpt-signin-s1.md`, ADR 0005, ADR 0012, `apps/mobile/app-identity.mts`, `apps/mobile/modules/loopback-auth/ios/LoopbackAuthModule.swift`, `apps/mobile/src/backup/backup-service.ts`
