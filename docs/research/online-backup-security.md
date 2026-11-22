# Online backup to Google Drive: security and privacy

Researcher, 12 Oct 2026. Feature is **parked** (backlog: "Online backup to Google Drive's hidden app-data folder", Ben 12 Oct). Nothing here is approved; it is input for Ben's decision and a later design/ADR.

## Summary
1. The design is sound if the scope is **only `drive.appdata`**. Google rates it non-sensitive, and only the creating app can read the folder. It cannot be shared or trashed, and it is hidden from the Drive UI. The Cloud project **must be published "In production"**: in "Testing", refresh tokens die after 7 days and backups would stop without anyone noticing.
2. Store the Google token as its own Keychain item, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, the same class as ChatGPT. Upload after a workout only while the phone is unlocked, and catch up on the next foreground. Keychain survival across a SideStore refresh is likely (same team ID and bundle ID) but **not yet device-tested**.
3. Client-side encryption should be **opt-in, off by default** in v1, with the file format ready for it from day one. If Ben turns it on, use a random 256-bit **recovery key** (cached in the Keychain, saved by Ben outside his Google account), not a passphrase. A key kept only on the phone would make the backup useless once the phone is lost.
4. Restore reuses the existing path: rule-8 parsing, checksum, preview and Undo last restore. Two new guards: a fresh install never uploads or rotates online copies until Ben restores or picks "Start fresh", and rotation never deletes the newest backup that holds the most workouts.
5. **Proposed brief/ADR changes:** ADR 0023's Delete must remove online copies **before** the Keychain wipe, or the app loses the token it needs to delete them. Ben's earlier "plain backups" answer (B2) covered on-phone and Files copies; online copies need their own decision.

## Recommendations (defaults)

| Area | Default | Why (tag) |
|---|---|---|
| Scope | `https://www.googleapis.com/auth/drive.appdata` only. Add `openid email` only if Ben wants the account shown ("Backing up to b…@gmail.com"). | Non-sensitive scope that grants nothing outside the app folder [Doc 1, 2]. The email is display-only [Inference]. |
| OAuth client | iOS client type, PKCE (S256), no client secret, redirect to the reversed-client-ID custom scheme, `ASWebAuthenticationSession` (never a WKWebView) | Loopback is deprecated for iOS clients [Doc 4]. The iOS client uses the reversed client ID scheme [Doc 5]. WKWebView is blocked (`disallowed_useragent`) [Doc 4]. |
| Publishing | Publish the consent screen to **In production**. External user type, personal use, no verification submission. | Testing gives 7-day refresh tokens [Doc 3, 6]. Personal-use apps (<100 users) are exempt from verification [Doc 7], and non-sensitive-only apps don't have to verify [Doc 8]. |
| Token storage | Separate `expo-secure-store` service (e.g. `fizz.google`), one item holding the refresh token, scopes, savedAt and (optional) email. `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Access token kept in memory only. | Rule 7. Matches the ChatGPT vault (ADR 0012). ThisDeviceOnly items don't migrate to a new phone [Doc 9], which is what we want: the new phone signs in again. |
| Upload timing | Queue after `SessionFinished`. Upload when the app is foreground/unlocked; otherwise on the next launch or foreground. | With WHEN_UNLOCKED the token can't be read while the phone is locked [Doc 9]. A backup a few minutes late is fine [Inference]. |
| Encryption | Off by default. Format envelope `encryption: none \| aes-256-gcm-v1` with a `keyId` from v1. Opt-in uses a recovery key. | See §4. |
| Integrity | Keep the existing file SHA-256. Store it in `appProperties`, then compare it with Drive's `sha256Checksum` after upload (or download and re-hash if that field is missing). | [Doc 10]. Same "read back before rotating" rule as ADR 0009. |
| Idempotency | `files.generateIds(space=appDataFolder)` once per backup op, saved with the queued job. Retries reuse the ID, so there are no duplicate files. | [Doc 11]. Rule 5. |
| Rotation | Keep the last 14 automatic copies online. Never delete the newest copy with the most finished workouts. Never rotate from a fresh install until Ben has restored or chosen "Start fresh". | Stops an empty new install from rotating out the good copies [Inference]. |
| Restore | Only on Ben's tap. Download to `tmp`, verify, then the existing preview → restore → `Undo last restore`. Delete the downloaded copy in `finally`. | ADR 0005, ADR 0023, rule 8. |
| Turn off / sign out | Ask "Keep online backups" or "Delete online backups". Delete first if chosen, then revoke the token at `oauth2.googleapis.com/revoke`, then wipe the Keychain item. | [Doc 4, 12]. |
| Delete my data | New step `online_backups` right after the database swap and **before** the Keychain wipe. If it fails (offline), keep only the Google token until `Finish deleting` succeeds, then revoke and wipe. | Rule 10. Without the token the app can't delete the copies [Inference]. |
| Keep Files copy | Online backup doesn't replace "Save a copy to Files". | Google account loss or project loss would take every online copy with it (§7) [Inference]. |

## 1. What Google documents (checked 12 Oct 2026)

**[Doc] App data folder** (page updated 2026-09-03) [Doc 1]:
- "hidden from the user and from other Google Drive apps"; "can't be accessed using the Drive user interface".
- "Only the application that created the data in the `appDataFolder` can access it."
- Requires `drive.appdata`, described as a "non-sensitive scope".
- Files can't be shared (`notSupportedForAppDataFolderFiles`), moved between spaces, or trashed.
- "The application data folder is deleted when a user uninstalls your app from their My Drive." Users can "delete your app's data folder manually".

**[Doc] Scope sensitivity** (updated 2026-09-03) [Doc 2]:
- `drive.appdata`: non-sensitive, "View and manage the app's own configuration data in your Google Drive."
- `drive.file`: non-sensitive.
- `drive` and `drive.readonly`: restricted.

**[Doc] Refresh tokens** (updated 2026-05-26) [Doc 3]:
- They stop working when access is revoked, after six months unused, when the 100-live-tokens-per-account-per-client limit is reached (the oldest is invalidated "without warning"), when time-based access expires, or on admin policy.
- External plus Testing gives a token "expiring in 7 days" unless the only scopes are name/email/profile.

**[Doc] Native-app flow** (updated 2026-09-14) [Doc 4]:
- Loopback redirect is "DEPRECATED for Android, Chrome app and iOS OAuth client types".
- Custom URI schemes "are no longer supported on Android and Chrome apps". iOS is not named in that restriction. The general section says "Custom URI schemes are no longer supported due to the risk of app impersonation." The page is inconsistent, so this is an **open item** (§9).
- PKCE is supported, S256 recommended. `client_secret` "is not applicable" to refresh requests from iOS clients.
- Revoke: `https://oauth2.googleapis.com/revoke`. Revoking an access token also revokes its refresh token.
- App Check (iOS only) uses App Attest. It is optional, and not suggested here because App Attest needs an entitlement that may not be free-provisionable [Inference].

**[Doc] Google Sign-In for iOS** (updated 2026-03-22) [Doc 5]: the reversed client ID (e.g. `com.googleusercontent.apps.1234-abc`) goes in `CFBundleURLSchemes`.

**[Doc] Publishing status** [Doc 6]:
- In Testing, "Authorizations by a test user will expire seven days from the time of consent."
- The 100-user cap and the "unverified app" screen apply to "unapproved sensitive or restricted scopes".

**[Doc] Verification exemptions** [Doc 7, 8]:
- "Personal Use apps … for your personal use (fewer than 100 users)" don't need verification.
- "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process." Brand verification is needed only to show a name and logo.

**[Doc] Expo SDK 57**:
- `expo-secure-store` accessibility classes: ThisDeviceOnly items are "not migrated to a new device when restoring from a backup". iOS data "will persist across app uninstallations" with the same bundle ID, though this "is not guaranteed". Some iOS releases refused values above about 2048 bytes [Doc 9].
- `expo-crypto` 57 has `aesEncryptAsync`/`aesDecryptAsync` (AES-GCM, 16-byte tag on Apple), `AESEncryptionKey.generate/import` and `getRandomBytes(Async)`. It has **no PBKDF2 or other KDF** [Doc 13].

**[Doc] Drive files API**:
- `sha256Checksum`: "Output only… if available". `appProperties` are "private to the requesting app" [Doc 10].
- `files.delete` "Permanently deletes … without moving it to the trash" and accepts `drive.appdata` (updated 2026-05-21) [Doc 12].
- `generateIds` supports `space=appDataFolder` [Doc 11].

## 2. Token storage and the SideStore weekly refresh

- **Class.** `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, as for ChatGPT (device test S1). The more permissive `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` would only help uploads while the phone is locked. Since the upload can wait for the next unlock, that isn't worth widening the window in which the token can be read [Inference].
- **Item shape.** One item `{v, refreshToken, scopes, savedAtMs, email?}`. Keep it small, given the roughly 2 KB limit on some iOS releases [Doc 9]. Reuse the `TokenRefresher` pattern (one refresh in flight per vault, ADR 0012). Google doesn't normally rotate refresh tokens, but the code should save a new one if Google sends it [Inference].
- **Weekly refresh.**
  - [Doc, Apple forum via `free-ios-install.md`] Keychain access follows the application identifier (team ID + bundle ID).
  - [Doc, our device test] SideStore installs as `com.projectfizz.fizz.<TEAMID>`, stable while the Apple ID and SideStore stay the same (`docs/device-tests/2026-10-08-probe-build7.md`).
  - [Inference] So a normal weekly re-sign keeps the item. Changing the Apple ID or signing tool gives a new identity: the app starts empty and Ben signs in again. That is acceptable, because the backups live in Drive, not on the phone.
  - **Not yet proven:** ChatGPT tokens surviving a real SideStore refresh is the cheapest proxy test, and it should be done first (§9).
- **Lapsed signing.** While the app won't open, nothing uploads; it catches up when the app next opens [Inference].
- **Six-month rule.** If Ben doesn't train for 6 months, the token expires [Doc 3]. The status should say "Online backup: sign in again", not fail silently (rule 1 honesty) [Inference].
- **Never** put the Google token in SQLite, `backup-state.json`, crash notes, backups or logs. The access token stays in memory only. Error messages must never include request headers [rule 7].
- **Client ID.** Google doesn't treat installed-app client IDs as secret [Doc 4, no client secret]. Still, keep it out of the repo and supply it through the GitHub Actions build environment. If the reversed scheme has to be in Info.plist (GD §1.2 expects `ASWebAuthenticationSession` not to need it), it is a URL type, not an entitlement, so it stays free-provisionable [Inference; device test §9, spike step 3].

## 3. Least-privilege scope

- `drive.appdata` can read and write only files "your app" created in the hidden folder [Doc 1]. Whether "app" means the OAuth client or the whole Cloud project is not documented (open item G3). It can't see Ben's documents. That is strictly narrower than `drive.file` (visible files the app creates or opens) and far narrower than `drive` (restricted).
- `openid email` is optional. It lets the Data & backup row and the new-phone restore show which account holds the backups. It adds the email to Your data (deleted on sign-out and Delete) [Inference]. Recommendation: include it, because restoring from the wrong Google account is a realistic mistake.
- Ask for nothing else. Use no incremental authorization and no Google Sign-In SDK: the existing `ASWebAuthenticationSession` module already does PKCE, and pulling in GoogleSignIn adds a dependency for no gain [Inference].

## 4. Client-side encryption

**Threats it addresses** [Inference]:
- someone else controlling Ben's Google account (§7);
- Google itself, or legal access to Google;
- a planted or tampered backup (AES-GCM authenticates, the SHA-256 doesn't).

**Threats it doesn't address:** losing the phone (the data is on the phone anyway) and losing access to the backups.

**What is in the file:** sessions, sets, gyms, routines, coach memories, pain flags and settings. There are no credentials (ADR 0005). Pain flags and memories are health-adjacent personal data, but low-value to an attacker [Inference].

| Key option | Survives phone loss? | Risk | Verdict |
|---|---|---|---|
| Random key, Keychain ThisDeviceOnly only | **No.** Gone with the phone, so the backup can't be read | Defeats the whole feature | Reject |
| Keychain synchronizable (iCloud Keychain) | Maybe | Needs iCloud Keychain behaviour on a free-signed app; unknown, and ties recovery to Apple ID | Not recommended (unknown, §9) |
| Passphrase → KDF | Yes, if remembered | Forgotten means lost. A weak one can be brute-forced offline once the file leaks. No KDF in expo-crypto [Doc 13], so PBKDF2 needs CommonCrypto in a Swift module, or a pure-TS scrypt/Argon2 (slow on Hermes) | Second choice |
| **Random 256-bit recovery key** (shown once as grouped base32; Ben stores it), cached on this phone in the Keychain for automatic backups | Yes, if Ben kept the key | Lost key means lost backups. No KDF needed because the key has full entropy. Fits `AESEncryptionKey.import` + `aesEncryptAsync` [Doc 13] | **Recommended, if encryption is on** |

**If Ben turns it on:**
- Show the key once and make him retype the last group before the switch turns on.
- Tell him not to store it in his Google account (Google Password Manager or Drive). A compromised account would then expose both the file and the key.
- Encrypt the whole backup text and keep a cleartext header `{format, formatVersion, encryption, keyId, createdAt, app}`. Restore can then say "This backup needs your recovery key" before decrypting.
- Changing the key re-uploads a fresh backup. Old copies keep their `keyId` and need the old key.

**Why off by default:**
- The main purpose is recovery after phone loss, and encryption adds the one failure mode (a lost key) that makes the backup worthless.
- The folder is already readable only through this project's client [Doc 1].
- The data is low-sensitivity.
- Ben already chose plain local backups (backlog B2).

This is a judgement for Ben, not a finding.

**Build it into v1 anyway:** the envelope field and `keyId`, so turning encryption on later needs no format migration.

## 5. Integrity

- **Existing:** body checksum plus whole-file SHA-256 (`packages/persistence/src/backup/backup.ts`). It detects corruption, not forgery (ADR 0005).
- **Upload:**
  1. Put `sha256`, `formatVersion`, `createdAt`, `opId` and the workout count in `appProperties`.
  2. After upload, read `sha256Checksum` and compare it with the local hash [Doc 10].
  3. If the field is "not available", download and re-hash. About 1.2 MB per 300 workouts (ADR 0005).
  4. Only mark the backup "Backed up online" after that comparison, and only then may rotation delete older copies (mirrors ADR 0009).
- **Restore:** verify the Drive checksum, the file SHA-256 and the internal checksum, then use the existing rule-8 parsing (exact tables, no unknown columns, bound parameters, integrity check). With encryption on, a failed GCM tag is reported as "damaged or wrong key", never partly restored [Inference].

## 6. Restore safety

- Restore is never automatic. On a new phone, first run offers `Restore from Google` next to `Restore from a file`.
- Restore lists the online copies: date, workouts, app version and source device name, with no personal content in file names.
- Then the **existing** flow: download to `tmp` → verify → preview (counts, identical?, needs migration?, replaces an unfinished workout?) → confirm → `DatabaseManager` switch → `Undo last restore` (ADR 0005, data-import-export §2.4, §3). Delete the downloaded copy in `finally` (ADR 0023 picker rule).
- **New guard 1:** a fresh install (no finished workouts, online backups present) doesn't upload or rotate online until Ben restores or taps `Start fresh`. Otherwise its first automatic backup could start pushing good copies out [Inference].
- **New guard 2:** rotation never deletes the newest copy with the highest finished-workout count, so a mistaken Delete or Reset on the phone can't rotate away the last full online copy within 14 workouts [Inference].
- Online upload uses the same `formatVersion` as local backups. When the two-section format (`your_data` / `coaching_knowledge`, ADR 0009 open item) lands, section restore applies here too.

## 7. Google account compromise

What an attacker who controls Ben's Google account could do [Inference unless tagged]:

- **Read the backups.** The folder is hidden from the Drive UI [Doc 1]. But the iOS client ID is not secret and no client secret exists [Doc 4], so an attacker could run the OAuth flow with our client ID, approve it as Ben, and list and download the folder.
  - Takeout probably doesn't include appDataFolder data (unconfirmed; search found only university help pages saying Takeout covers My Drive [Doc 14]).
  - Ben's Google Cloud project probably lives in the same account, so the attacker also controls the project.
  - **Mitigation:** opt-in encryption (§4).
- **Delete the backups.** The folder can be deleted from Drive settings ("Manage apps" → Disconnect, with an option to delete hidden app data; how-to articles only [Doc 15]) or through the API.
  - **Mitigation:** on-phone backups and "Save a copy to Files" stay independent. Online is never the only off-phone copy.
- **Plant a backup.** It would be restored only if Ben picks it. The preview shows counts, and rule 8 parsing applies. With encryption on, GCM rejects it.
- **Recovery steps for Ben** (for a "Why?" sheet, not the main UI):
  1. Secure the Google account.
  2. Remove GymSmarter in Google Account → Third-party access, which revokes tokens [Doc 4, project-level revoke].
  3. Sign in again in the app.
  4. If encryption was on, generate a new key, which re-uploads a fresh backup.

**Related risk:** if the Cloud project is deleted or suspended, the app's identity is gone and the hidden folder becomes unreachable [Inference from "only the application that created the data … can access it", Doc 1]. Ben should never delete that project while relying on it.

**Advanced Protection:** "only verified third-party apps can access sensitive data" [Doc 16]. Whether `drive.appdata` counts is unknown (§9). It only matters if Ben is enrolled.

## 8. Sign-out, turn off, and rule 10 delete

- **Turn off online backup:** a choice between `Keep online backups` and `Delete online backups`.
  - Delete lists and deletes every file in the folder (`files.delete` is permanent [Doc 12]) and re-lists to confirm the folder is empty.
  - Then revoke the token [Doc 4] and wipe the Keychain item.
  - Revoke alone doesn't delete the data. Google documents deletion only for "uninstall your app from their My Drive" or manual deletion [Doc 1].
- **Delete my data (rule 10, ADR 0023):**
  - Online copies hold Your data, so Delete must remove them.
  - Add a step `online_backups` **after the swap and before `coach_sign_in`'s Keychain wipe**. It is bounded at 10 s like the ChatGPT revoke.
  - **On success:** revoke, then wipe.
  - **On failure** (offline, or token invalid):
    - With an offline token: keep only the Google token item and mark the step unfinished (the existing marker and `Finish deleting` path), then retry when online.
    - With an invalid token: Ben must delete the copies in Drive settings → Manage apps → GymSmarter → delete hidden app data [Doc 15]. The app says `Online backups not deleted` with a "Why?" explaining this.
  - The token can only reach the app folder, so keeping it briefly exposes less than keeping the copies [Inference].
  - Don't upload ADR 0023's knowledge-only `after_delete` backup to Google. Online backup is off after Delete.
- **Reset coaching knowledge** changes no Your data, so online copies stay. The next automatic backup uploads as usual.

## 9. Unknowns only a device or end-to-end test can settle

1. Does Google accept the reversed-client-ID custom scheme redirect for an **iOS** client in Oct 2026, given the native-app page's inconsistent wording [Doc 4]? Does the consent screen show the app name, or an "unverified" or "Google hasn't verified" screen, with only non-sensitive scopes and no brand verification?
2. Does the Info.plist URL type survive SideStore re-signing, and does `ASWebAuthenticationSession` return to the app with that scheme? Does the client registration care that the installed bundle ID is `com.projectfizz.fizz.<TEAMID>`?
3. Do Keychain items survive a real SideStore weekly refresh and an update over the top? Check the ChatGPT token first.
4. Is a refresh token issued and still valid after 8+ days with the project In production (proves the Testing trap is avoided)?
5. Upload of a 1–5 MB file over cellular: time, and whether `sha256Checksum` is populated for appDataFolder files.
6. Full restore on a second phone, or after deleting and reinstalling: sign in, list, preview, restore, Undo.
7. Delete my data while offline, then `Finish deleting` online removes every file. Check the folder is empty via a re-list, and check Drive storage in Settings → Manage apps.
8. Whether Advanced Protection (if Ben is enrolled) blocks `drive.appdata`.
9. Whether Google Takeout includes app-data-folder content (affects the compromise analysis).
10. If encryption ships: `expo-crypto` AES-GCM performance and memory on a 5 MB string under Hermes.

## Proposed brief changes (Ben approves)

1. **ADR 0023 / data-import-export §4.5 Delete step order.** Add `online_backups` after the swap and before the Keychain wipe. Allow the Google token to be kept, alone, until online deletion is confirmed or Ben is told how to finish it in Drive settings. This changes "credentials first after the swap" for one item.
2. **Brief §5 Backup row** ("encrypted backup if credentials/private data warrant it"): reword for online copies as "online copies: optional client-side encryption with a recovery key; off by default". Ben's B2 answer (plain files) covered on-phone and Files copies only and should not be assumed for Google Drive.
3. **CLAUDE.md scope** says "no cross-device sync". Online backup with manual restore is consistent with that. Worth a one-line note in the brief that it is backup, not sync, so later work doesn't drift into merging.
4. **Rule 7 wording** is satisfied as is. Add `fizz.google` to the single `KEYCHAIN_KEYS` list that the source scan enforces (review your-data-r3).

## Sources (all checked 12 Oct 2026)

| # | Source | Kind |
|---|---|---|
| 1 | https://developers.google.com/workspace/drive/api/guides/appdata | Doc |
| 2 | https://developers.google.com/workspace/drive/api/guides/api-specific-auth | Doc |
| 3 | https://developers.google.com/identity/protocols/oauth2 | Doc |
| 4 | https://developers.google.com/identity/protocols/oauth2/native-app | Doc |
| 5 | https://developers.google.com/identity/sign-in/ios/start-integrating | Doc |
| 6 | https://support.google.com/cloud/answer/15549945?hl=en | Doc |
| 7 | https://support.google.com/cloud/answer/13464323?hl=en | Doc |
| 8 | https://support.google.com/cloud/answer/13463073?hl=en | Doc |
| 9 | https://docs.expo.dev/versions/latest/sdk/securestore/ (v57.0.0) | Doc |
| 10 | https://developers.google.com/workspace/drive/api/reference/rest/v3/files | Doc |
| 11 | https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds | Doc |
| 12 | https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete | Doc |
| 13 | https://docs.expo.dev/versions/latest/sdk/crypto/ (v57.0.0) | Doc |
| 14 | https://services.udel.edu/TDClient/32/Portal/KB/ArticleDet?ID=1055 ; https://forum.rclone.org/t/google-drive-support-for-hidden-appdatafolder/3602 | Anecdotal / third-party |
| 15 | https://zdnet.com.au/home-and-office/work-life/how-to-disconnect-apps-from-google-drive/ ; https://www.techloy.com/how-to-remove-third-party-access-from-google-drive/ | Third-party how-to |
| 16 | https://support.google.com/accounts/answer/7539956?hl=en | Doc |

Internal: ADR 0005, 0009, 0012, 0023; `docs/device-tests/2026-10-10-chatgpt-signin-s1.md`; `docs/device-tests/2026-10-08-probe-build7.md`; `docs/research/free-ios-install.md`; `packages/providers/src/openai/credentials.ts`; `apps/mobile/modules/loopback-auth/ios/LoopbackAuthModule.swift`; `docs/backlog.md` (B2, online backup row).
