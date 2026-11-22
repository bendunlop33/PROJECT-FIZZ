# SideStore "no valid pairing file" on iOS 26.6.1 (SideStore Nightly + iloader)

Researcher agent, 2026-10-08. Every source was checked on 2026-10-08. No accounts, sign-ins or downloads were used. Context: `docs/guides/sidestore-windows.md`.

## Summary

1. **Probable cause (from source code, not yet tested on Ben's phone):** iloader v2.3.6 still writes the old file `ALTPairingFile.mobiledevicepairing`. SideStore Nightly (0.7.0-20260920) no longer reads that file. It converts it once on first launch into two new files, and does not choose which one to use. With nothing chosen, you get "No valid pairing file". Re-placing the file with iloader writes the old name again, and Nightly ignores it, which explains why re-placing changed nothing.
2. **Fix to try first (on the phone, no laptop needed):** SideStore → Settings → **Pairing File Management** → long-press **Remote Pairing File** → **Set as Preferred** → force-quit and reopen SideStore with LocalDevVPN connected. This is a reported workaround (SideStore issue #1617) and fits the code.
3. **Do not** import iloader's file through SideStore's own **Import** button. It contains both kinds of credentials, and Nightly rejects it as "ambiguous" (issues #1608 and #1611 plus the code).
4. **Nothing confirms SideStore working end-to-end on 26.6.x.** There are open, unfixed refresh errors from users on iOS 26.6.1 and 26.7. Sideloadly v0.70.1's release notes include a fix for Apple's sign-in change. AltServer for Windows has not been confirmed fixed.
5. **Recommendation:** try fix 2 once (about 15 minutes). If SideStore can't refresh *itself* afterwards, switch to Sideloadly now, before our app is installed. **Proposed brief changes:** make Sideloadly the named fallback (not AltStore on Windows), and correct the guide's pairing-file steps for Nightly.

## Recommendations

1. Do the "Set as Preferred" fix (§3, Step A). If SideStore's own refresh then succeeds, carry on with SideStore and the trial run in `docs/guides/sidestore-windows.md` §8.
2. If the Remote Pairing card shows **Missing** or **Invalid**, or the fix fails, do Step B (§3) once: a clean reinstall of SideStore Nightly via iloader, then Step A.
3. If SideStore still can't refresh itself after Step B, or shows endpoint or VPN errors with no fix, **stop and switch to Sideloadly.** No app of ours is installed yet, so switching costs nothing now. Once real workouts exist, switching costs a backup and restore.
4. Don't use AltStore Classic with Windows AltServer for now. The last AltServer for Windows in its official release notes is 1.7.4 (March 2026), and users reported the September sign-in error on Windows 1.7.5.
5. Update `docs/guides/sidestore-windows.md` §7. On Nightly, "Delete Stored Pairing → Place" alone no longer takes effect.

**Labels:**
- **[Doc]** official docs.
- **[Release notes]** GitHub or vendor release notes.
- **[Code]** read directly from the public source code on 2026-10-08. This is a documented fact about the code, but not tested on a device.
- **[Reports]** GitHub issues and community posts.
- **[Inference]** my reasoning.
- **[Unverified]** not confirmed.

---

## 1. What's on Ben's phone (best estimate)

- iloader's "SideStore (Nightly)" button downloads the release tagged `nightly` [Code] (https://raw.githubusercontent.com/nab138/iloader/main/src-tauri/src/sideload.rs).
- On 2026-10-08 that release is **0.7.0-20260920.1479+0dd743f7** (built 20 Sep 2026) [Release notes] (https://github.com/SideStore/SideStore/releases/tag/nightly).
- The latest commits on SideStore's `develop` branch are also from 20 Sep, so the code below should match Ben's build [Inference] (https://github.com/SideStore/SideStore/commits/develop).
- iloader's "SideStore (Stable)" button downloads GitHub's "latest" release [Code, same sideload.rs], which today is **0.7.0-alpha** (built 11 Sep, includes the sign-in fix) [Release notes] (https://github.com/SideStore/SideStore/releases/tag/0.7.0-alpha).

## 2. Known causes of "no valid pairing file"

### 2.1 Nightly reworked pairing files; iloader didn't follow (most likely cause for Ben)

**What changed in SideStore Nightly:**
- On 19–20 Sep 2026, Nightly added "dual pairing file support". It also centralised pairing in a "pairing file manager", renamed the pairing files, and added a re-prompt "when loaded pairing isn't the one that is preferred" [Release notes] (https://github.com/SideStore/SideStore/releases/tag/nightly).
- Nightly reads only `PairingFile_Lockdown.plist` and `PairingFile_RemoteRP.plist` in its Documents folder. The old name `ALTPairingFile.mobiledevicepairing` appears only in the reset code (where it's deleted) and in a one-time conversion [Code] (https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/AppConstants.swift, https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Core/Pairing/PairingFileManager.swift).

**The one-time conversion** [Code] (https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/MaintenanceManager.swift):
- It runs once, as a maintenance pass recorded by a counter, not on every launch.
- It copies the old file into each new file, but only if that new file doesn't already exist.
- It then deletes the old file.
- It **does not set a preferred protocol**.

**What Nightly does when loading** [Code, PairingFileManager.swift]:
- It tries the "preferred" protocol first, then the last "active" one.
- If neither is set, it returns nothing, and SideStore asks for a pairing file [Code] (https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/AppBootManager.swift).

**What iloader writes** [Code] (https://raw.githubusercontent.com/nab138/iloader/main/src-tauri/src/pairing.rs):
- iloader v2.3.6 still writes `Documents/ALTPairingFile.mobiledevicepairing` into the app whose display name is exactly "SideStore".
- On iOS 17.4 and later it merges the lockdown and RemotePairing credentials into that one file.
- iloader v2.3.5 (3 Oct) changed how RemotePairing is generated and says it "may help reduce issues with pairing files in SideStore". It did not change the file name [Release notes] (https://github.com/nab138/iloader/releases).

**A user report with the same message:**
- [Reports] SideStore #1617 (24 Sep 2026, Nightly 20260920.1479), after moving from 0.6.x or 0.7.0-alpha: both files showed as "Configured", but Active was unknown and Preferred was None, giving "**No valid pairing file has been loaded.**"
- The fix was to long-press Remote Pairing, choose **Set as Preferred**, and relaunch.
- https://github.com/SideStore/SideStore/issues/1617

**[Inference] Why re-placing didn't help Ben:**
- The first launch converted iloader's file into the two new files, with no preference set.
- Re-placing with iloader writes the old file name again. Nightly never reads that name, the conversion has already run, and it wouldn't overwrite existing files anyway.
- That matches what Ben saw. Not yet confirmed on his phone.

### 2.2 iloader's combined file is rejected by Nightly's own import ("ambiguous")

- [Code] SideStore's parser treats a file containing **both** RemotePairing keys (`private_key`, `public_key`, `identifier`) and lockdown keys (`HostID`, `SystemBUID`, `UDID`, …) as ambiguous, unless a protocol is specified (https://raw.githubusercontent.com/SideStore/minimuxer/12be70dc2627307a16bfd2dc7a009080d5bec909/Common/PairingFile.swift). The error reads: "The pairing file contains credentials for both Remote Pairing and Lockdown protocols."
- The import path in Settings checks the file without specifying a protocol [Code, PairingFileManager.swift].
- [Reports] Users on the same Nightly:
  - #1608 (20 Sep): "the pairing file format is ambiguous" when placing via iloader. https://github.com/SideStore/SideStore/issues/1608
  - #1611 (21 Sep, open): "Unable to add any pairing file through iloader or idevicepair", and "Unable to add pairing files locally using settings local import which contains Lockdown and rppairing". https://github.com/SideStore/SideStore/issues/1611
  - No maintainer reply was visible on either issue (comments are hidden when logged out).

### 2.3 Lockdown vs RemotePairing on iOS 17+

- [Reports] SideStore #1532 (13 Sep, closed): on iOS 17+, connections with a lockdown-only pairing file closed instantly; the RemotePairing file worked. https://github.com/SideStore/SideStore/issues/1532
- [Inference] So **Remote Pairing** is the one to prefer on iOS 26.6.1. Lockdown is the second choice.

### 2.4 Other causes seen recently (less likely for Ben)

- **".rppairing UDID not found":**
  - LiveContainer #1619 (iOS 18.7.9): TLS tunnel timeout during RemotePairing; closed as not planned. https://github.com/LiveContainer/LiveContainer/issues/1619
  - iloader #665 (iOS 27 beta), open. https://github.com/nab138/iloader/issues/665
- **iloader can't read the phone's pairing on the PC** ("device does not have pairing file"): iloader #723, #763, #810, #826. All but one are on iOS 27 or with no iOS version given; none has a visible fix. https://github.com/nab138/iloader/issues?q=pairing. Ben's iloader *placed* the file successfully, so this isn't his problem [Inference].
- **Developer Mode off, or no passcode:** iloader's issue form asks about both [Doc] (https://github.com/nab138/iloader/issues/773). [Unverified] whether either produces this exact message. Worth checking anyway.
- **LocalDevVPN not connected:** this gives VPN or endpoint errors (1414, 27, DeviceEndpointNotInitialized), not a "no valid pairing file" message [Doc] (https://docs.sidestore.io/docs/troubleshooting/error-codes), [Reports] #1623.
- **The pairing file went to the wrong app:** iloader matches apps by display name ("SideStore", or "LiveContainer" with a SideStore subfolder) [Code, pairing.rs]. [Unverified] whether Nightly's display name is exactly "SideStore". iloader listed SideStore under "Place", so it probably is.

### 2.5 Errors likely to come *after* pairing is fixed (iOS 26.6.1 and 26.7)

- [Reports] #1595 (19 Sep, iPhone 14 Pro, **iOS 26.6.1**, 0.7.0 via iloader): after re-placing the pairing files, the user got "TCP port poll failed - device may be unreachable". Re-placing pairing files didn't help. Closed without a visible fix. The user was also running a second VPN ("VPN Super"). https://github.com/SideStore/SideStore/issues/1595
- [Reports] #1623 (26 Sep, **iOS 26.7**, 0.7.0-alpha): "Remote endpoint IP is not configured or reachable", cause DeviceEndpointNotInitialized. Open. https://github.com/SideStore/SideStore/issues/1623
- [Reports] #1631 (3 Oct, 0.7.0): "can't refresh SideStore after installing it from iLoader", "for weeks". Open. https://github.com/SideStore/SideStore/issues/1631
- [Reports] #1460 (2 Sep, 0.6.4): LocalDevVPN 1.3 changed its tunnel IP; setting it back to `10.7.0.0/32` restored refresh. https://github.com/SideStore/SideStore/issues/1460
  - 0.7.0-alpha's notes say it force-clears the override IP because of LocalDevVPN 1.3.0 [Release notes] (https://github.com/SideStore/SideStore/releases).

## 3. Fix steps for iOS 26.6.1, most likely first

Screen and button names are from SideStore's source code [Code] (https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Views/Settings/Advanced/PairingFile/PairingFileManagementView.swift, https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Views/Settings/Advanced/PairingFile/PairingFileManagementViewModel.swift).

- The code lives in an "Advanced" settings folder, and a 18 Sep commit "moved pairing management into own row 'Pairing File Management'" (https://github.com/SideStore/SideStore/commits/develop).
- [Unverified] exactly where that row appears in Settings. Scroll the Settings tab for it.

**Before starting:**
- Wi-Fi on.
- LocalDevVPN connected, with no other VPN or DNS blocker.
- Developer Mode on.
- A passcode set.

### Step A: set the preferred protocol (no laptop)

1. Open SideStore → **Settings** → **Pairing File Management**.
2. Look at the two cards, **Remote Pairing File** and **Lockdown Pairing File**. Each shows **Configured**, **Missing** or **Invalid**. The **ACTIVE PROTOCOL** section shows **Active Protocol** and **Preferred Protocol** (probably "None").
3. If Remote Pairing File says **Configured**: long-press it and choose **Set as Preferred**.
4. Force-quit SideStore (swipe it away in the app switcher). Reopen it with LocalDevVPN connected. [Reports] #1617 says the relaunch was needed.
5. Test: My Apps → tap the day counter on SideStore itself.
6. If it fails with a connection or pairing error: go back, long-press **Lockdown Pairing File** → **Set as Preferred**, relaunch, and test again. [Inference] This is less likely to work on iOS 26 (§2.3).
7. If an alert titled **Protocol Mismatch** appears, choose **Switch to rppairing** [Code: the buttons read "Switch to %@", "Load Only", "Cancel"].

- **Don't** tap **Reset Pairing Files** here [Inference]. It deletes both new files and sets a "reset" flag. iloader can't refill them on Nightly, and SideStore's import would reject iloader's combined file (§2.2). You would end up worse off.
- **Don't** use **Import / Replace File** with iloader's file, for the same reason.

### Step B: clean reinstall (only if both cards are Missing or Invalid, or Step A fails)

Nothing of ours is inside SideStore yet, so deleting it loses only SideStore's own sign-in and settings.

1. On the iPhone, delete **SideStore**. Don't delete LocalDevVPN.
2. On the laptop, open iloader (v2.3.6). Click **Delete Stored Pairing**, select the phone and tap **Trust** on it, then **Install SideStore** → the Nightly option.
3. **Don't open SideStore** until iloader shows that it placed the pairing file. If it doesn't do this automatically: **Manage Pairing File** → **Place** next to SideStore, and wait for "Pairing file placed successfully!" [Doc] (https://docs.sidestore.io/docs/advanced/pairing-file).
4. Trust the developer profile again (Settings → General → VPN & Device Management), connect LocalDevVPN, and open SideStore. The first launch should convert the file.
5. Do Step A.

- [Unverified] that deleting the app also clears the conversion counter. It is stored in SideStore's shared container, which iOS normally removes with the app. If after Step B both cards still say Missing, the conversion didn't run again: go to Step C.

### Step C: last SideStore option, the older "Stable" build (uncertain)

- iloader's **SideStore (Stable)** installs 0.7.0-alpha. That build still reads `ALTPairingFile.mobiledevicepairing`, the file iloader writes [Code] (https://raw.githubusercontent.com/SideStore/SideStore/0.7.0-alpha/SideStore/AppConstants.swift).
- It includes the September sign-in fix [Release notes].
- [Reports] It has its own open problems on iOS 26.6.1 and 26.7 (§2.5).
- [Unverified] whether it handles iloader's combined file on iOS 26.6.1, and whether it can be installed over Nightly without deleting it first.
- I'd only try this if Ben strongly prefers to stay with SideStore.

### What "working" means before moving on

SideStore refreshes **itself** (day counter back to 7) twice, on two different days, with LocalDevVPN connected. Only then install our app. [Inference]

## 4. Is any version combination confirmed working on 26.6.x?

- **SideStore:** **No confirmation found.**
  - The only 26.6.1 report (#1595) got past pairing but couldn't refresh.
  - The 26.7 report (#1623) can't refresh either.
  - #1631 says refresh has failed "for weeks" after installing from iloader.
  - The #1617 reporter got refresh working on Nightly 20260920.1479 after the Set as Preferred fix (plus a port issue), but didn't state an iOS version.
  - SideStore's docs say only "if you are on iOS 26.4+, update to SideStore (nightly)" for error 27 [Doc] (https://docs.sidestore.io/docs/troubleshooting/error-codes).
  - Logged-out viewers can't see issue comments, so successes discussed there (or on Discord) are invisible to this research [Unverified].
- **Reddit:** no indexed 26.6.x threads were found.
- **SideStore Discord:** not publicly indexed.
- **Sideloadly:**
  - [Release notes] v0.70.1, marked "Latest" (undated), fixed "login problems caused by Apple changing the Xcode client identity" and SMS two-factor 401 errors (https://sideloadly.io/changelog). That is the September 2026 sign-in change.
  - [Doc] The site lists iOS 7 to 26+ and free Apple IDs (7-day signing, auto-refresh). On Windows it needs the **web (non-Microsoft Store) versions of iTunes and iCloud** (https://sideloadly.io/).
  - [Unverified] No 26.6.1-specific report was found, for or against.
  - [Reports] iloader, Sideloadly and Impactor users have hit HTTP 429 rate limits from Apple's sign-in servers since the fix. Waiting and retrying is the reported workaround (https://onejailbreak.com/blog/iloader-sideloadly-impactor-apple-id-login-fail-429/, from a search result; the page itself returned 403).
- **AltStore Classic + AltServer for Windows:**
  - [Release notes] AltStore 2.3 (14 Sep 2026) supports iOS 26, with a minimum of iOS 17.4 (https://faq.altstore.io/release-notes/altstore).
  - [Release notes] AltServer's notes list **1.7.4 (Windows, 24 Mar 2026)** as the newest Windows build, with no September sign-in fix (https://faq.altstore.io/release-notes/altserver).
  - [Reports] AltStore #1787 (8 Sep): HTTP 503 on **Windows AltServer 1.7.5**. Closed, with no fix shown (https://github.com/altstoreio/AltStore/issues/1787).
  - [Reports] AltStore said it had "begun porting these changes for Windows AltServer" (https://x.com/altstoreio/status/2096697059306881297).
  - [Unverified] A third-party X post says "AltServer 1.8.b2" fixes it (https://x.com/onejailbreak_/status/2097458909950722558).
  - **Not confirmed working on Windows.**

## 5. Recommendation: keep trying SideStore or switch?

**Try Step A once.** It is cheap, fits the code exactly, and keeps the main advantage of SideStore: refreshing on the phone without the laptop.

**Switch to Sideloadly now** if any of these happen:
- Step A/B doesn't make SideStore show a working pairing;
- SideStore can't refresh itself afterwards;
- refresh shows the endpoint or VPN errors in §2.5.

Reasons [Inference]:
- SideStore's pairing code was rewritten 11 days before Ben installed it, and its partner tool (iloader) hasn't caught up.
- There are several open, unanswered refresh bugs on iOS 26.6.1 and 26.7.
- No success on 26.6.x has been confirmed.
- Our golden rule is one tool forever, so the tool should be stable *before* real data exists. Today switching costs nothing.

**Cost of Sideloadly** [Doc, sideloadly.io]:
- The weekly re-sign needs the Windows laptop on, with Sideloadly running and the phone reachable (USB, or Wi-Fi on the same network).
- [Unverified] how reliable its Wi-Fi auto-refresh is with iOS 26.6.1.

## 6. Unknowns only a real test on Ben's phone can settle

1. Whether Ben's Pairing File Management screen shows both files as Configured with Preferred = None, which would confirm §2.1.
2. Whether Set as Preferred → Remote Pairing gives a working SideStore self-refresh on 26.6.1 with LocalDevVPN 1.3.0.
3. Whether the endpoint and VPN errors in §2.5 then appear.
4. If switching: whether Sideloadly v0.70.1 signs in to Ben's Apple ID without 429/503 errors and installs and refreshes on iOS 26.6.1.
5. Whether the bundle ID stays the same when Sideloadly signs our `.ipa`. Check before real data; the data rules in `sidestore-windows.md` §6 apply to whichever tool is chosen.

## Proposed brief changes (for Ben's approval)

1. **ADR 0004, "Update 2026-10-08":**
   - Name **Sideloadly** (v0.70.1+) as the fallback, rather than "Sideloadly or AltStore Classic". AltServer for Windows has no confirmed fix for the September 2026 sign-in change.
   - Add: "SideStore Nightly (0.7.0-20260920) changed its pairing-file format; iloader v2.3.6 doesn't place the new format. If pairing can't be made to work on Ben's phone, switch to Sideloadly before any real data."
2. **`docs/guides/sidestore-windows.md` §7, "Regenerating the pairing file":** add that on SideStore Nightly 0.7.0+, re-placing with iloader alone doesn't take effect. Use Pairing File Management → Set as Preferred, and don't use Reset Pairing Files or Import with iloader's file. Add the §3 steps here.
3. **`docs/guides/sidestore-windows.md` §3:** iloader's "Stable" now installs 0.7.0-alpha (which has the sign-in fix), not 0.6.4. The "[Unverified]" note there can be resolved.

## Sources (all checked 2026-10-08)

**SideStore releases:**
- https://github.com/SideStore/SideStore/releases
- https://github.com/SideStore/SideStore/releases/tag/nightly
- https://github.com/SideStore/SideStore/releases/tag/0.7.0-alpha
- https://github.com/SideStore/SideStore/commits/develop

**SideStore code:**
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/AppConstants.swift
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/AppBootManager.swift
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/MaintenanceManager.swift
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Core/Pairing/PairingFileManager.swift
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Views/Settings/Advanced/PairingFile/PairingFileManagementView.swift
- https://raw.githubusercontent.com/SideStore/SideStore/develop/SideStore/Views/Settings/Advanced/PairingFile/PairingFileManagementViewModel.swift
- https://raw.githubusercontent.com/SideStore/SideStore/0.7.0-alpha/SideStore/AppConstants.swift
- https://raw.githubusercontent.com/SideStore/minimuxer/12be70dc2627307a16bfd2dc7a009080d5bec909/Common/PairingFile.swift
- https://raw.githubusercontent.com/SideStore/minimuxer/12be70dc2627307a16bfd2dc7a009080d5bec909/Common/PairingProtocol.swift

**SideStore issues:**
- #1460, #1532, #1595, #1608, #1609, #1611, #1617, #1623, #1626, #1631, #1367
- https://github.com/SideStore/SideStore/issues/<number>

**SideStore docs:**
- https://docs.sidestore.io/docs/advanced/pairing-file
- https://docs.sidestore.io/docs/troubleshooting/error-codes

**iloader:**
- https://github.com/nab138/iloader
- https://github.com/nab138/iloader/releases
- https://raw.githubusercontent.com/nab138/iloader/main/src-tauri/src/pairing.rs
- https://raw.githubusercontent.com/nab138/iloader/main/src-tauri/src/sideload.rs
- Issues #665, #773, #775, #826: https://github.com/nab138/iloader/issues?q=pairing

**LiveContainer:**
- https://github.com/LiveContainer/LiveContainer/issues/1619
- https://github.com/LiveContainer/LiveContainer/issues/1629
- https://github.com/LiveContainer/LiveContainer/issues/1651

**Alternatives:**
- https://sideloadly.io/
- https://sideloadly.io/changelog
- https://faq.altstore.io/release-notes/altstore
- https://faq.altstore.io/release-notes/altserver
- https://github.com/altstoreio/AltStore/issues/1787
- https://github.com/altstoreio/AltStore/pull/1790
- https://x.com/altstoreio/status/2096697059306881297
- https://x.com/onejailbreak_/status/2097458909950722558
