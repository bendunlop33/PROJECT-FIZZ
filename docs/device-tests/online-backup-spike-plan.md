# Device spike G: Google Drive online backup (plan)

Status: **plan, 12 Oct 2026.** Runs only after Ben approves trying it and has done [google-drive-setup-for-ben.md](../guides/google-drive-setup-for-ben.md). Modelled on S1 ([2026-10-10-chatgpt-signin-s1.md](2026-10-10-chatgpt-signin-s1.md)). Settles the unknowns in GD §8 and SEC §9 before any product build. Spec: [online-backup.md](../design/online-backup.md); draft decision: [draft-online-backup.md](../decisions/draft-online-backup.md).

**Uses test files only.** The spike uploads generated files named `fizz-spike-*.json`, never Ben's real backup, and deletes them at the end.

## What the build needs (spec slice 0, size M)

- `loopback-auth` Swift module: a `customScheme` callback mode (no listener).
- `packages/providers/src/google`: authorize (PKCE S256), token, refresh, revoke, `about.get`, `generateIds`, resumable upload, get, list, download, delete. All with `spaces=appDataFolder`.
- CI: `FIZZ_GOOGLE_IOS_CLIENT_ID` read at prebuild. A workflow checkbox **Add Google URL type** (off by default) adds the reversed client ID to `CFBundleURLTypes`, like the background-audio experiment checkbox.
- Developer → **Google Drive backup test** screen. It has one row per step with `Not run` / `Passed` / `Failed` + one detail line, and the buttons `Run test`, `Refresh only`, `Clean up` and `Export result`. Later steps show `Skipped` after a failure.
- The export masks the email (`b•••@gmail.com`) and never contains tokens, codes, state, verifier or headers (unit-tested, as S1).

## Steps (on Ben's iPhone, SideStore build)

| # | Step | Pass | If it fails |
|---|---|---|---|
| 1 | Config shown: build number, installed bundle ID, client ID (first 6 + last 4 characters) | All three present | No client ID: the CI variable is missing; fix and rebuild |
| 2 | `Run test` → the system sheet opens and iOS shows its "wants to use google.com" prompt → Google consent page | Consent asks only for "its own configuration data in your Google Drive", with no "unverified app" / "Google hasn't verified" screen. Record what name it shows (without brand verification it may not say **GymSmarter**; that is not a failure). **Note any warning screen (G1)** | `disallowed_useragent`: the module isn't using `ASWebAuthenticationSession`, which is a bug. `redirect_uri` / "custom scheme not supported" error: **route A fails** → record the exact text; switch to the Desktop + loopback fallback (draft decision §1) |
| 3 | After `Allow`, the sheet closes and returns to the app | Callback received; time recorded. Build without the URL type (G2) | Google shows success but the sheet doesn't return: rebuild with **Add Google URL type** ticked and repeat. Pass then = URL type needed (record it) |
| 4 | Code exchange, no client secret | `refresh_token` present, `expires_in` present, granted scope **exactly** `drive.appdata` | `client_secret is missing`: wrong client type (Desktop). Recreate as iOS |
| 5 | Registered vs installed bundle ID | Pass even though Google has the suffixed ID; record whether Google cares (Ben may optionally edit the client to the unsuffixed ID and repeat steps 2–4) | Google rejects a mismatch: record it. The setup guide's "use the installed ID" stays mandatory, and an Apple-ID change will need a client edit |
| 6 | `about.get` with `drive.appdata` alone | Email returned | 403 insufficient scope: take the spec's OD5 fallback (`openid email`) |
| 7 | `generateIds(space=appDataFolder)` then a resumable upload of a 1 MB test file, Wi-Fi | 200/201; time recorded | Record status and Google `reason` |
| 8 | Same with a 5 MB test file on **mobile data** (Ben turns Wi-Fi off) | Finishes; time recorded | Record it |
| 9 | `files.get`: `size`, `sha256Checksum`, `appProperties` | Size matches; record whether `sha256Checksum` is present; `appProperties` come back unchanged | No checksum: the product downloads and re-hashes (already in the spec) |
| 10 | `files.list(spaces=appDataFolder)` | Both test files listed, newest first | — |
| 11 | Download the 5 MB file and re-hash | SHA-256 equals the local file's | Record it |
| 12 | Start a 5 MB upload, then **lock the phone at once** for 60 s, then unlock | Record whether it finished while locked. If not: on unlock the session resumes (308 → continue), with no duplicate file | A duplicate appears: the `generateIds` / resume logic is wrong; fix before the product build |
| 13 | Force-close GymSmarter, reopen, `Refresh only` | Token read from the Keychain; refresh returns a new access token | Keychain item missing: record the accessibility class used |
| 14 | `Clean up`: delete every `fizz-spike-*` file, then re-list | Folder empty | Record it |
| 15 | Revoke the token, then `Refresh only` | `invalid_grant` is classified as **Sign in to Google again**; the Keychain item is removed | Misclassified: fix the error mapping |
| 16 | Sign in again (steps 2–4) and leave it signed in | Pass | — |

## Later checks (same build, no new test file)

| # | When | Check | Settles |
|---|---|---|---|
| L1 | **8 or more days after step 16** | `Refresh only` works | The Production status avoids the 7-day Testing expiry |
| L2 | After the next SideStore weekly refresh | `Refresh only` works without signing in | The Keychain item survives re-signing (check the ChatGPT sign-in at the same time) |
| L3 | Any time, on the laptop | drive.google.com → Settings → **Manage apps**: GymSmarter is listed. Record the exact menu labels for deleting hidden app data (for the spec's Why? text). Don't delete | Copy accuracy, SEC §8 |
| L4 | Optional, only if Ben is enrolled in Advanced Protection | Steps 2–4 succeed | Whether `drive.appdata` is allowed |
| L5 | Optional (needs a second iOS client and variable `FIZZ_GOOGLE_IOS_CLIENT_ID_B`) | Upload with client A, then list with client B | **G3**: whether the folder belongs to the project (B sees it) or to the client (B doesn't). If per-client, losing the client loses the online copies, and keeping a Files copy matters more |

## Console checks (G4, during the setup guide)

- `drive.appdata` listed as non-sensitive.
- Publish to Production asked for no billing account, privacy policy or verification.

## Result and what it decides

- **Pass** = steps 1–16 pass with route A, plus L1 and L2 within two weeks. This unblocks spec slices 2–7 once Ben approves the feature.
- **Route A fails at step 2 or 3** (even with the URL type): rebuild with the Desktop + loopback fallback and re-run steps 2–16. The draft decision is updated; the Desktop client's secret goes in as a GitHub Actions secret that Ben adds himself (never pasted in chat or committed). This needs Ben's go-ahead and a short extra guide.
- **L1 fails:** check the publishing status, then re-run. If it still fails, the feature is not viable without weekly sign-ins; report to Ben.
- **L2 fails:** the spec adds a "Sign in to Google again after a SideStore refresh" state, and Ben decides whether that's acceptable.

Record the result as `docs/device-tests/<date>-google-drive-g.md` in the S1 format: build, iOS version, PASS or FAIL per step, times, the scope granted, whether a checksum was present, whether the URL type was needed, and any warning screens. Never include tokens or the full email.
