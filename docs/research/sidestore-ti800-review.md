# Security review: Ti800's SideStore/SideSign fork (-80045 and iloader pairing fix)

Reviewed 27 Oct 2026 by the developer agent, for ADR 0036. SideStore holds Ben's Apple ID password, 2FA session and
signing certificate, so every changed line was read.

## Verdict

**Safe to build from, at the exact SHAs below.** No new network endpoints, no credential or token logging, no
telemetry, no changes to anisette server lists or defaults, no obfuscated code, no binary blobs, no build-script or
dependency changes. The diff does what the release notes say and nothing else. It is unofficial, unreviewed by
SideStore's team, unsigned commits from a single author (`TangYao`), and the -80045 part depends on Apple's current
behaviour, so it may stop working when Apple changes again.

## What was reviewed

| Repo | Base (upstream) | Reviewed head | Commits |
|---|---|---|---|
| github.com/Ti800/SideStore `fix/gsa-80045` | `12ff39c6b6c0ccd8180f0834a893a4bbaf7bcd31` (SideStore `develop`) | **`f4921377291c69e31eb8505eb5d9e5a16abb78d8`** | 7 |
| github.com/Ti800/SideSign `fix/gsa-80045` | `752d1ef602aa792a432ffa1e71646dc1ecf7363c` (SideSign `main` head, our current pin) | **`73ca02de240da894241f53dc57b39fe02d084b16`** | 3 |

- SideStore base `12ff39c6` has the **same tree** (`57aea2e5…`) as the nightly we pin today, `d97ec133`: the two
  upstream commits in between (`4fe37824` "attempt to fix pairing file issues", `d97ec133` "revert the revert") cancel
  out. Both pin SideSign `752d1ef`. So the fork diff is exactly the change on top of what we built in request 2.
- The release tag `fix-gsa-80045-1` points at `d8789df6ec776cea7144384c1f49d3a17a9802f9`, which pins SideSign
  `8404fb964ab09987a450ad7387369caabd8714c5` (Android client info). The branch has one more commit, `f4921377`, which
  only moves the SideSign pin to `73ca02d` ("use windows itunes client info, android is now rejected": GSA started
  answering the Android identity with HTTP 503 on 15 Oct). **We pin the branch head**, not the release, because the
  release's Android identity is what the fork's own author now reports as rejected. Both were reviewed; `73ca02d`'s
  diff includes `8404fb9`'s.
- SideSign `752d1ef` is still SideSign `main`'s head, so the fork misses no upstream SideSign work.
- Not reviewed: the prebuilt `.ipa` on the fork's release page (we build from source), and minimuxer (unchanged
  submodule, still `SideStore/minimuxer`).

## Changes, file by file

### SideStore (10 files, +218 / -48, Swift only)

- `.gitmodules`: SideSign submodule URL `SideStore/SideSign` -> `Ti800/SideSign`, branch `fix/gsa-80045`. The commit
  actually built is the gitlink (`73ca02d`), not the branch. **Concern (low):** if Ti800 force-pushes or deletes the
  branch, the pinned SHA may become unfetchable and the build fails (safe failure, not a silent change).
- `Dependencies/SideSign`: gitlink `752d1ef` -> `73ca02d`.
- `Core/Pairing/CombinedPairingFile.swift` (new, 48 lines): splits iloader's combined plist into a RemotePairing half
  (`public_key`, `private_key`, `identifier`, `alt_irk`) and a Lockdown half, each re-validated with SideStore's own
  `PairingFileParser`. Pure in-memory plist work. No I/O, no network.
- `Core/Pairing/PairingFileManager.swift`: saves both halves of a combined file to SideStore's existing slots
  (atomic writes in the app's Documents); new `importLegacyPairingFileIfPresent()` reads
  `Documents/ALTPairingFile.mobiledevicepairing` on every launch, stores it, deletes the original;
  `recoverPairingStateIfNeeded()` splits combined files left by the old migration and activates a usable slot. Logs
  record **paths and protocol names only, never file contents** (the pairing file holds private keys).
- `AppBootManager.swift`: calls the two functions above before the minimuxer check.
- `MaintenanceManager.swift`: old one-shot legacy migration body removed (moved to boot).
- `PairingFileManagementViewModel.swift`, `PairingViewController.swift`: combined files don't trigger the protocol
  mismatch alert; an import failure now shows an "Import Error" alert instead of looking like a cancel.
- `AppConstants.swift`, `Core/Anisette/AnisetteConfigManager.swift`: on load, the saved client-info string is trimmed
  and, if it is one of the known legacy macOS/Android defaults, replaced with the new default. Header-only strings; no
  credentials involved.

### SideSign (4 files, +287 / -49, Swift only)

- `Constants.swift`: `defaultClientInfo` changes from the macOS identity to
  `<PC> <Windows;6.2(0,0);9200> <com.apple.AuthKit/1 (com.apple.iTunes/12.12.4.1)>` (the Windows iTunes identity
  AltServer-for-Windows and isideload use). Adds `legacyClientInfos` (7 old strings for migration),
  `resyncStatusCode = 434`, `resyncDataKey = "X-Apple-I-MD-DATA"`. No URL or server-list change.
- `DeveloperPortal/Authentication.swift`: on the GSA `init` step only, if Apple answers `Status.hsc == 434` with a SIM
  blob, it resyncs anisette and retries `authenticate` once (guarded by a task-local flag; reset for the post-2FA
  login, same pattern as the existing 2FA retry). The password is passed to the same recursive `authenticate` call
  upstream already uses; it is not logged or sent anywhere new. Non-2xx HTML replies now raise an error naming the
  HTTP status and the anisette **client-info** string (not the Apple ID, password or tokens). The raw auth response
  body was already logged upstream; unchanged.
- `Anisette/RemoteAnisetteDataProvider.swift`: the existing `/v3/get_headers` POST is factored into
  `postV3GetHeaders` (same URL, built from the user's configured anisette server). New `resyncAnisetteHeaders` POSTs
  to that **same** URL with the usual `identifier` and `adi_pb`, plus `sim` (Apple's resync blob), `device_id` and
  `md_lu` (the anisette device and local-user IDs). **Concern (low):** on a 434 those two IDs and the SIM go to the
  anisette server Ben already trusts with his `adi.pb`; nothing about the Apple ID. Only happens on Apple's 434 reply.
  Normal get_headers behaviour is unchanged: a v3 network/HTTP failure still falls through to the existing v1 path.
- `Anisette/AnisetteDataManager.swift`: adds an `NSLock` around the remote cache, remembers the last remote fetch
  context (server URL, identifier, `adi.pb`, anisette data) in memory so a resync uses the same server and identity,
  and trims stray whitespace from user-supplied client info. In-memory only; nothing persisted or sent elsewhere.

### Checked and absent

- New hosts: none. The only URL in either diff is the submodule URL. The default anisette server
  (`https://ani.sidestore.io`) and server list (`https://servers.sidestore.io/servers.json`) are unchanged, as are
  Apple's GSA URLs.
- Credential logging/exfiltration: none. No new `debugLog` prints the Apple ID, password, 2FA code, session token,
  certificate or pairing-file contents.
- Telemetry, analytics, crash reporters: none.
- Obfuscation, base64/hex literals, binary files: none (`git diff --numstat` shows text-only Swift changes).
- Build changes: no change to `Makefile`, `scripts/`, `.github/`, `Package.swift`/`Package.resolved`, Xcode project
  or entitlements.

## HealthKit patch on top

SideSign PR #3 (`74950d37f2333d29cbf3bfc9ca4a60820498c2d3`, from `SideStore/SideSign` `refs/pull/3/head`)
cherry-picks onto `73ca02d` with no conflicts (tested locally; same diff (+8/-3) to `Entitlement.swift` and
`Feature.swift` as on `752d1ef`, `Entitlement.healthKit` already defined).

## Residual risks for Ben

- Third-party, AI-assisted fork, unaffiliated with SideStore. We build from source at fixed SHAs; re-review before
  moving either SHA.
- The Windows client identity is a workaround for Apple's server-side change; Apple may reject it later (the fork has
  already moved Android -> Windows once). Then sign-in fails again; nothing else is affected.
- The resync path is marked "needs proper testing" by its author and only helps with anisette servers that support
  resync. It is a no-op unless Apple replies 434.
