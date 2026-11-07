# Draft: Online backup to the owner's Google Drive app-data folder

**Status:** Draft, 12 Oct 2026 (designer). **Parked** until Ben approves the feature and spike G (online-backup-spike-plan.md) passes on his iPhone. Gets an ADR number when it is accepted; the PM numbers it.

Inputs: [google-drive-backup.md](../research/google-drive-backup.md) (GD), [online-backup-security.md](../research/online-backup-security.md) (SEC), spec [online-backup.md](../design/online-backup.md), ADR 0004, 0005, 0009, 0012, 0023.

## Context

GymSmarter is free-signed through SideStore (ADR 0004). Deleting the app, or re-signing it with another Apple ID or tool, gives an empty app. On-phone backups (ADR 0005/0009) don't survive that; only `Save a copy to Files` does, and it depends on Ben remembering. Ben asked (12 Oct) how an automatic online backup into his own Google account would be built: sign in once, back up after each workout into Drive's hidden app-data folder, restore on a new phone. Backup only, not sync; no server of our own.

Constraints: no paid Apple programme, so no iCloud, push or Associated Domains entitlements (CLAUDE.md); no HTTP layer or server of ours; credentials only in protected storage (rule 7); logging never waits for the network (rule 1); Your data kept separate and deletable (rule 10).

## Decision (proposed)

1. **OAuth route: Google iOS client + PKCE + reversed-client-ID custom scheme, no SDK.**
   - Ben creates an **iOS** OAuth client in his own Google Cloud project. It has no secret.
   - Redirect `com.googleusercontent.apps.<ID>:/oauth2redirect`, caught by `ASWebAuthenticationSession(callback: .customScheme(…))`.
   - The existing `apps/mobile/modules/loopback-auth` module gains a `customScheme` mode (the loopback listener is skipped). The presentation anchor, timeout and cancel handling are reused. No new native module, no entitlement; a `CFBundleURLTypes` entry only if the spike shows it's needed (an Info.plist key, still free-provisionable).
   - PKCE S256, fresh state per attempt, granted-scope check, `prefersEphemeralWebBrowserSession = false` (reuses Safari's Google login), `true` for "Use another account".
   - **Fallback** if Google rejects custom schemes for iOS clients at runtime: a Desktop client with the existing loopback listener (proven by S1). Its client secret then has to be supplied through CI, never committed (rule 7): Ben would paste it himself into a GitHub Actions **secret**, never send it in chat. This needs a separate guide and Ben's go-ahead; the current setup guide never asks for a secret. Google documents loopback only for desktop OSes, so this is a fallback, not the plan.
   - Rejected: the Google Sign-In SDK and `expo-web-browser` (extra dependency, or needs an `expo.scheme` the app doesn't have; GD §1.2); universal-link callback (needs Associated Domains).
2. **Scope: `https://www.googleapis.com/auth/drive.appdata` only.** It's non-sensitive, and it reaches only files this project wrote to the hidden folder. The account is shown with Drive `about.get`. `openid email` is added only if the spike shows `about.get` needs more.
3. **Consent screen published "In production"**, External user type, no logo, no verification submission (not mandatory for non-sensitive-only apps; without brand verification the consent page may not show the app name). "Testing" would make refresh tokens die after 7 days and backups stop silently. Personal use with only a non-sensitive scope needs no verification (GD §1.3).
4. **Tokens.** One Keychain item in service `fizz.google` (`{v, refreshToken, scopes, savedAtMs, email}`), `WHEN_UNLOCKED_THIS_DEVICE_ONLY` like ChatGPT (ADR 0012). The access token is in memory only. It reuses `TokenRefresher` (one refresh in flight per vault; `invalid_grant` means "Sign in to Google again"; network and 5xx keep the token). It is listed in `KEYCHAIN_KEYS`. Revoke at `oauth2.googleapis.com/revoke` on sign-out and Delete. `AFTER_FIRST_UNLOCK` (GD) is rejected while v1 has no background task scheduler (SEC §2).
5. **Client ID** is not a secret but is kept out of the repo: GitHub Actions repository variable `FIZZ_GOOGLE_IOS_CLIENT_ID`, read at prebuild into `extra`. With no value, the feature is hidden.
6. **What is uploaded:** the newest eligible on-phone backup file, byte for byte (ADR 0005/0009 format and SHA-256). Resumable upload for every size, `parents: ["appDataFolder"]`, file ID pre-allocated with `files.generateIds` per operation (rule 5), short `appProperties` (format, schema version, SHA-256, finished-workout count and digest, install ID, op ID, `enc=none`).
7. **Verify, then rotate.** A copy counts only after Drive's size and `sha256Checksum` match, or after a download and re-hash if the checksum is absent. Then keep the newest **14**, never deleting the copy just uploaded, the copy with the most finished workouts, or the newest copy from another install.
8. **When:** in the foreground right after the on-phone backup that Finish (and import, restore, reset) already makes, under a UIKit background task. Catch-up on launch, foreground and network return, with backoff 1/5/30 min. Never while a workout is unfinished. Mobile data allowed by default; Low Data Mode waits for Wi-Fi. No BGTaskScheduler in v1.
9. **Restore:** list, download to `tmp`, verify, then the **unchanged** ADR 0005 pipeline (preview by section, pointer switch, `Undo last restore`). Never automatic. The downloaded file is data, not instructions (rule 8), and is deleted on every path.
10. **Encryption: none in v1.** Online copies are plain JSON, like the on-phone and Files copies (Ben's B2 answer covered those; online needs his own answer, spec Q2). Why:
    - the folder is readable only through this project's client;
    - the data is low-value to an attacker;
    - a lost key would make the backup worthless, which defeats its purpose (SEC §4).

    If Ben later wants encryption, it is an opt-in random 256-bit **recovery key** (not a passphrase, and never only on the phone), shipped as a separate wrapper format with a cleartext header. v1 copies then need no migration.
11. **Rule 10.** Online copies are Your data. `Delete my data` gets a step `online_backups` after the database swap and **before** the Keychain wipe. Offline, only the Google token item is kept until `Finish deleting` succeeds. If the token is invalid, Ben is told how to delete the copies in Drive settings. The knowledge-only `after_delete` backup is never uploaded. `Reset coaching knowledge` doesn't touch online copies.
12. **Files stays.** `Save a copy to Files` and its safeguards remain. A current Drive copy satisfies the 30-day reminder and the pre-risk safeguards.

## Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| **iCloud** (CloudKit or the app's iCloud Drive container) | Rejected | Needs the iCloud entitlement and a container ID, which a free Apple ID can't provision. That means the paid Apple Developer Program, which CLAUDE.md and ADR 0004 rule out. (`Save a copy to Files` → iCloud Drive already works without an entitlement, but it's manual or bookmark-based.) |
| **Our own server** (any host + database or object store) | Rejected | Out of scope: CLAUDE.md's architecture is in-process with no HTTP layer, and it is single-user and personal. A server adds hosting, auth, patching, cost and a place where Ben's data sits that he doesn't own. Ben preferred Google Drive over an own server (backlog, 12 Oct). |
| **Firebase** (Auth + Cloud Storage or Firestore) | Rejected | It's effectively a server we'd operate: security rules, a Firebase SDK in the app, and Ben's data in a project bucket rather than his own Drive. New Cloud Storage for Firebase buckets have required the pay-as-you-go Blaze plan since late 2024 (not re-checked today). Firestore's 1 MiB document limit doesn't fit a 1–5 MB snapshot without chunking. Nothing it offers is needed here. |
| **Google Drive, `drive.file` scope** (visible folder) | Not chosen | Ben asked for the hidden folder. Visible files could be opened from drive.google.com even if the OAuth client were lost (a real plus, GD §7), but Ben could move or edit them by accident, and it's a broader grant. Revisit if spike G3 shows the folder is tied to one client. |
| **Google Drive through Files** (the Drive app's File Provider + the existing `Also back up off the phone automatically` bookmark) | Not chosen, noted | No OAuth code at all. But it depends on the unproven `DEP-FILES` bookmark test, on the Google Drive app being installed and signed in, and on that app uploading in its own time. The status could only say "saved to the folder", never that the copy reached Drive. A possible zero-code fallback if this feature is dropped. |
| **Google Sign-In SDK** | Rejected | Dependency and SDK UI for something the existing module already does (PKCE in `ASWebAuthenticationSession`). |
| **Desktop client + loopback** | Fallback only | Proven pattern (S1), but deprecated by Google for iOS clients, and it needs a client secret in the build. |

## Consequences

- One Cloud project and one OAuth client become something Ben must keep. Six months without token use deletes an unused client (with a 30-day warning email). Regular backups count as use.
- If the project or client is lost and the folder is per-client (G3), online copies become unreadable. Files copies are the mitigation, and the spec keeps them.
- New Keychain item, new manifest version (v2, `online` section), one new durability phrase in the design system, one new Delete step.
- A new `.ipa` build is needed (the Swift module change). The client ID arrives as a CI variable.
- The 7-day "Testing" trap is covered in the setup guide (step 7). The 100-refresh-tokens-per-account-per-client limit is documented in GD §1.3; it only matters if Ben signs in 100+ times.

## Open (settled by the spike, not by this record)

G1 the consent screen in Production with only `drive.appdata` (any warning?); G2 the custom-scheme callback on a SideStore build with and without `CFBundleURLTypes`, the bundle-ID check against the suffixed ID, `about.get` with this scope alone, whether `sha256Checksum` is populated, upload time on cellular, a refresh 8+ days later; G3 whether a second client in the same project can read the folder; G4 that publishing needs no billing or verification. Also: Keychain survival across a SideStore weekly refresh (ChatGPT token first), and Advanced Protection if Ben is enrolled.

## Proposed brief / ADR changes (Ben approves)

- Brief §5 Backup row and §7 `createBackup(destination)`: see spec §11.
- ADR 0023 step order: `online_backups` between the swap and the Keychain wipe.
- CLAUDE.md scope note: "online backup with manual restore is not sync" (Ben edits CLAUDE.md).
