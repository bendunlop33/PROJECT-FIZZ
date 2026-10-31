# Installing and looking after the app with SideStore (Windows laptop + iPhone 17)

The app is called **GymSmarter**. "The app" below means GymSmarter.

For Ben. Written 2026-10-08 by the researcher agent. Every source was checked on 2026-10-08. Nothing was downloaded, signed up for or signed in to while writing this.

## Summary

1. **Setup:** on the laptop, install Apple's iTunes and then **iloader**. On the iPhone, install **LocalDevVPN** from the App Store. iloader puts SideStore on the phone and creates the "pairing file". After that, the phone does almost everything itself.
2. **Weekly:** with Wi-Fi and LocalDevVPN on, tap the "7 DAYS" counter in SideStore. If you miss it, the app won't open but your data stays on the phone. Refresh, and it opens again.
3. **Golden rules:** never delete the app; always use the same Apple ID and only SideStore; install updates over the top; keep backups off the phone.
4. **Current warning (Sept–Oct 2026):** Apple changed its sign-in servers in early September 2026, and SideStore 0.6.4 and older cannot sign in. Only the newer 0.7.0 alpha/nightly builds include the fix. Separately, people on iOS 26.4+ have reported "not connected to Wi-Fi/VPN" refresh errors. Do the trial run in step 8 **before** logging real workouts.
5. **Brief impact:** this guide proposes small changes to ADR 0004 (see "Proposed brief changes"). Nothing in it overturns the free SideStore route.

## Recommendations

1. Before installing, decide which Apple ID will do the signing, and use it **forever** (§9).
2. Use the most recent SideStore build that iloader offers which includes the September 2026 sign-in fix (0.7.0 or later). Check the SideStore releases page on the day you install (§3).
3. Do a "throwaway" trial before trusting the app with real workouts (§8): install, log a test set, update over the top, skip a refresh, then recover.
4. Install the app, and every update, **only through SideStore**, never through iloader. Keep the app's default ID when SideStore asks.
5. Refresh on the same day each week, for example Sunday evening at home. Don't wait for background refresh.
6. Hold off on major iOS updates (for example iOS 27) until SideStore is known to work on them. If you do update, expect to regenerate the pairing file.

**How to read the labels:**
- **[Doc]** means SideStore's or another tool's own docs say so.
- **[Release notes]** means the GitHub release pages say so.
- **[Reports]** means GitHub issues or community guides: real experience, but not guaranteed.
- **[Unverified]** means my best understanding, not yet tested on your phone.

---

## 1. What you need before you start

- Your iPhone 17 on iOS 26, with a **passcode set**. The VPN and SideStore need one. [Doc] https://docs.sidestore.io/docs/installation/prerequisites
- A **Wi-Fi** connection. Mobile data is not enough. [Doc] same page.
- The Huawei laptop running **64-bit Windows** (Windows 8 or newer, not "Windows on Arm"). [Doc] same page.
  - To check, press Win+R, type `control /name microsoft.system`, and look at "System type". It must say "64-bit operating system, x64-based processor".
- A USB cable that carries data between the laptop and the iPhone (USB-C to USB-C, or USB-C to USB-A).
- The Apple ID you will sign with, its password, and access to its two-factor codes.

## 2. Downloads

### On the Windows laptop

1. **iTunes from Apple's website.** SideStore recommends this over the Microsoft Store version. If neither works, try Apple's **Apple Devices** app instead. [Doc] https://docs.sidestore.io/docs/installation/prerequisites. This installs the driver that lets Windows talk to the iPhone. iloader's site also lists iTunes as the Windows requirement. [Doc] https://iloader.app/
2. **iloader** (the MSI installer is recommended), from **https://iloader.app/** or **https://github.com/nab138/iloader/releases** only. iloader says no other download source is official. [Doc] https://iloader.app/, https://github.com/nab138/iloader
   - Latest version on 2026-10-08: **v2.3.6** (6 Oct). Versions from v2.3.2 onwards include the fix for Apple's September sign-in change. [Release notes] https://github.com/nab138/iloader/releases
   - **iloader replaces jitterbugpair.** SideStore's current docs use iloader for both installing SideStore and the pairing file. They no longer mention jitterbugpair. [Doc] https://docs.sidestore.io/docs/advanced/pairing-file
3. Run the iloader installer.

### On the iPhone

4. **LocalDevVPN** (free, by Coxson Engineering LLC) from the App Store: https://apps.apple.com/us/app/localdevvpn/id6755608044. Version 1.3.0 on 2026-10-08. Its App Store privacy label says "Data Not Collected". [Doc]
   - Open it, tap **Connect**, and allow the VPN configuration when iOS asks. [Doc] https://docs.sidestore.io/docs/installation/prerequisites
   - The VPN is "local": it only loops back to your own phone, with no outside server. [Doc] https://docs.sidestore.io/docs/faq
   - **StosVPN and WireGuard are the old method.** SideStore's troubleshooting page says to switch from them to LocalDevVPN. [Doc] https://docs.sidestore.io/docs/troubleshooting/common-issues

## 3. Install SideStore (once)

**First, the September 2026 sign-in problem.**
- [Release notes] SideStore marks 0.6.4 "DO NOT USE: sign-in is broken on 0.6.4 and before", because Apple changed its servers. 0.7.0-alpha (11 Sep 2026) adds the "fixes for 503 during sign-in". https://github.com/SideStore/SideStore/releases/tag/0.6.4, https://github.com/SideStore/SideStore/releases/tag/0.7.0-alpha
- [Reports] At least one user still could not sign in on an early 0.7.0 nightly (different error). https://github.com/SideStore/SideStore/issues/1537
- [Unverified] Which build iloader's "SideStore (Stable)" button installs today. If it installs 0.6.4 or older, sign-in will fail. In that case choose the nightly option in iloader, which is what an iOS 26 community guide also recommends. https://fr0stb1rd.is-a.dev/posts/ios-26-unlimited-sideload-sidestore-livecontainer/
- SideStore's own docs site doesn't mention any of this yet. Its release-notes page stops at 0.6.2.

**Steps** ([Doc] https://docs.sidestore.io/docs/installation/install unless marked):

1. Check that the laptop's **date and time are correct** (set automatically). Wrong time causes sign-in errors 3021 and 1100. [Doc] https://docs.sidestore.io/docs/troubleshooting/error-codes
2. Plug the iPhone into the laptop. On the phone, tap **Trust** and enter your passcode.
3. Open **iloader** and accept any update it offers.
4. Sign in to iloader with your **signing Apple ID** (§9).
   - Type it carefully: the sign-in is case-sensitive.
   - It does not have to be the Apple ID signed in on the phone.
   - Enter the two-factor code when asked.
5. Select your iPhone in iloader.
6. Click **Install SideStore**. Pick the build that includes the sign-in fix (see above).
7. On the iPhone, go to **Settings > General > VPN & Device Management**. Under "Developer App", tap your Apple ID, then **Trust**, and confirm.
8. Turn on **Developer Mode** at **Settings > Privacy & Security > Developer Mode** (at the very bottom).
   - The phone restarts. Afterwards, confirm with **Turn On** and enter your passcode.
   - If iOS shows "Allow & Restart" first, do that.
   - Developer Mode is required for development-signed apps on iOS 16+. [Doc] https://docs.expo.dev/guides/ios-developer-mode/
9. Open **LocalDevVPN** and tap **Connect**.
10. Open **SideStore** and sign in with the **same Apple ID** you used in iloader.
11. Go to **My Apps** and tap the **"7 DAYS"** counter next to SideStore.
    - If SideStore asks to revoke the old certificate or create a new one, tap **Yes / Refresh Now**.
    - The phone jumps to the Home Screen and shows a notification. SideStore is usable again within seconds.
    - This step matters: it switches SideStore from iloader's internal ID to its own. Do it **before** installing any app. [Doc] https://docs.sidestore.io/docs/faq

**The pairing file:** iloader creates it and places it in SideStore during the install. It lets SideStore talk to iOS's installer through LocalDevVPN with no computer. [Doc] https://docs.sidestore.io/docs/advanced/pairing-file. To make a new one later, see §7.

## 4. Install the app

### Getting the `.ipa` onto the phone

The app, **GymSmarter**, is built by GitHub Actions and attached to each build run as an "artifact", a file named like `GymSmarter-0.1.0-build12.ipa`.

**Option A: on the phone (easiest)**
1. In Safari, sign in to GitHub. The repo is private, so you need read access. [Doc] https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
2. Open the repo's **Actions** tab, then the latest successful build. Under **Artifacts**, tap `GymSmarter-<version>-build<N>.ipa` to download it.
3. If it arrives as a `.zip`, open **Files > Downloads** and tap the zip to expand it. You should now have a file ending in `.ipa`.
   - Artifacts have traditionally been zipped. Since Feb 2026, GitHub can serve them unzipped if the workflow is set up that way, which a developer change can do. [Doc] https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/
4. Artifacts are kept for **90 days** by default, so install or save the file before then. [Doc] GitHub page above.

**Option B: from the laptop**
1. Download the artifact on the laptop the same way, then unzip it.
2. Move the `.ipa` to the phone using any of:
   - iCloud Drive (save it into the iCloud Drive folder on Windows via iCloud for Windows), or
   - emailing the file to yourself and opening it on the iPhone, or
   - iTunes file sharing.
3. On the phone, save it into **Files**.
- **Do not install the app with iloader's "Import IPA" button.** Apps installed by different tools can end up with different IDs. iOS would then treat it as a different app with its own empty data. [Doc, about app IDs] https://docs.sidestore.io/docs/faq [Unverified] whether iloader would actually produce a different ID for our app. It isn't worth the risk.

### Installing it with SideStore

1. Turn on Wi-Fi and connect **LocalDevVPN**.
2. Open SideStore, go to **My Apps**, tap **+**, and choose the `.ipa` in Files.
   - [Release notes] SideStore 0.6.3+ supports installing IPAs from My Apps and lets you customise the App ID there. https://github.com/SideStore/SideStore/releases/tag/0.6.3
   - **Leave the App ID as the default.** Changing it creates a different app.
3. Wait for the install to finish. If it seems stuck near the end, go to the Home Screen and let it finish. [Doc] https://docs.sidestore.io/docs/troubleshooting
4. Open **GymSmarter** once to check it starts. (Builds made before the rename show as "Fizz". Installing a GymSmarter build over the top just renames the same app; your data stays.)

### Installing an update without losing data

1. Get the new `.ipa` (same steps as above).
2. **Do not delete the old app.**
3. In SideStore, install the new `.ipa` the same way (**My Apps > +**). SideStore installs it over the top. SideStore's docs say data stays when you sideload "the same or an updated IPA" without removing the original. [Doc] https://docs.sidestore.io/docs/faq
4. Before updating, make a backup in the app, once the backup feature exists (§6).
- Small updates that only change JavaScript may later arrive inside the app without a new `.ipa`. The developer will say when that is set up. [Unverified]
- If iOS ever says the app "cannot be installed" because it doesn't match: stop. Do not delete anything. Tell the developer. It usually means the build's ID changed. [Doc, Apple forum] https://developer.apple.com/forums/thread/126589

## 5. The weekly refresh

**Why it's needed:** free Apple ID signing lasts **7 days**. After that, iOS won't open the app until it is re-signed. [Doc] https://developer.apple.com/support/compare-memberships/

**How to refresh (about 1 minute, at home on Wi-Fi):**
1. Connect **LocalDevVPN**.
2. Open SideStore and go to **My Apps**.
3. Tap the day counter on **SideStore**, then on **GymSmarter** (or use "Refresh All" if your build has it).
4. Check that both counters show 7 days.

[Doc] https://docs.sidestore.io/docs/installation/install, https://docs.sidestore.io/docs/faq

**Background refresh:**
- SideStore also tries to refresh in the background. [Doc] https://docs.sidestore.io/docs/faq
- It can only succeed when Wi-Fi **and** LocalDevVPN are on. [Doc] https://docs.sidestore.io/docs/troubleshooting/error-codes
- Treat it as a bonus, not the plan. [Inference]

**Habit:** pick a fixed day. Also refresh if the app shows **2 days or fewer** before a training day. [Inference] An app that expires mid-workout probably keeps running, but would not reopen after a force-close.

### If you miss it

**If the app expired but SideStore still opens:**
1. Connect Wi-Fi and LocalDevVPN, open SideStore, and refresh the app.
2. It should open again with your workouts intact. [Unverified, but consistent with the docs] Data lives in the app's storage on the phone. Expiry blocks launching; it doesn't wipe data. https://docs.sidestore.io/docs/troubleshooting says to "re-sideload the apps without deleting them first", because the data should be kept.
3. **Do not delete the expired app.**

**If SideStore itself expired and won't open:**
1. Use the laptop. Plug in the phone, open iloader, and reinstall SideStore with the same Apple ID. [Doc] https://docs.sidestore.io/docs/troubleshooting/common-issues
2. Open SideStore, sign in, and refresh SideStore (§3, step 11).
3. Look in My Apps.
   - If the app is listed, refresh it.
   - If it isn't, install the **same or newer** `.ipa` over the top (§4). Don't delete first.

**If an app "disappeared" from My Apps:** refresh SideStore. Then re-sideload the IPA without deleting anything. [Doc] https://docs.sidestore.io/docs/troubleshooting

**Last resort, not for our app:** the docs' "full reset" says to delete SideStore **and every app it installed**. That would wipe the app's data. Only consider it after a fresh backup exists off the phone, and after talking to the developer. [Doc] https://docs.sidestore.io/docs/troubleshooting/common-issues

## 6. Rules that protect your workout data

1. **Never delete the app.** Deleting it deletes its database. That includes when it is expired, broken, or iOS offers "Offload/Delete".
   - Also turn off **Settings > Apps > App Store > Offload Unused Apps**. [Unverified] whether iOS offloads sideloaded apps, but it costs nothing to turn off.
2. **Never change the signing Apple ID.** A different Apple ID means a different developer team. iOS then treats the app as a separate app with an empty database. [Doc + inference] https://developer.apple.com/forums/thread/126589 and `docs/research/free-ios-install.md` §4.
3. **Never change the signing tool.** Use SideStore only: not AltStore, not Sideloadly, and not iloader for the app itself.
4. **Never change the App ID** when SideStore offers to.
5. **Keep backups off the phone.** Once the app's Backup feature exists (planned for the first milestone, see ADR 0004):
   - back up after each session, or at least weekly;
   - keep a copy somewhere other than the phone, for example iCloud Drive or the laptop;
   - before any risky step (iOS update, SideStore reinstall, pairing-file fix), make a fresh backup.
   - **Until a restore has been tested, don't log workouts you can't afford to lose.**
6. **Only update iOS on purpose.** iOS updates can break the pairing file [Doc] https://docs.sidestore.io/docs/advanced/pairing-file. They have also broken SideStore before: the iOS 26.4 VPN reports in §8. Before a new major version (iOS 27), check that people report SideStore working on it.

## 7. When SideStore breaks

Work down this list and try a refresh after each step ([Doc] https://docs.sidestore.io/docs/troubleshooting/common-issues):

**"Not connected to Wi-Fi and/or VPN" (errors 27, 1414) or AFC connection failure:**
1. Make sure Wi-Fi is on and LocalDevVPN shows Connected.
2. Turn off any DNS blocker or other VPN.
3. Try again; pressing the button a couple of times sometimes works.
4. Restart SideStore, then restart LocalDevVPN.
5. Regenerate the pairing file (below).
- For error 27 on **iOS 26.4 or later**, the error-codes page says to update to SideStore nightly. [Doc] https://docs.sidestore.io/docs/troubleshooting/error-codes
- 0.6.3's release notes say: if you're on 26.4+ and seeing VPN errors, "Please Reinstall With iloader". [Release notes] https://github.com/SideStore/SideStore/releases/tag/0.6.3

**Sign-in fails (503, freezes, error codes):**
1. Update SideStore to a build with the September 2026 fix (§3).
2. In SideStore Settings, switch the **anisette server** and try a few. [Doc] https://docs.sidestore.io/docs/troubleshooting, https://docs.sidestore.io/docs/advanced/anisette
3. Check the date and time.
4. Error 1102: accept Apple's developer terms by signing in once at developer.apple.com (you do this yourself). [Doc] https://docs.sidestore.io/docs/troubleshooting/error-codes

**No two-factor code arrives:** on iOS 18.1+, turn off Wi-Fi and mobile data, then go to **Settings > [your name] > Sign-In & Security > Get Verification Code**. [Doc] https://docs.sidestore.io/docs/troubleshooting. This only works if the signing Apple ID is the one signed in on the phone. Otherwise the code comes by SMS or to another device.

**SideStore hangs during install:**
1. Update SideStore or restart it.
2. Clear the cache.
3. Switch the anisette server.
4. Reset adi.pb and sign out and back in.
5. Restart the phone.
6. Regenerate the pairing file.
7. Reinstall SideStore with iloader.

[Doc] https://docs.sidestore.io/docs/troubleshooting/common-issues

**Regenerating the pairing file** (needed after some iOS updates or resets, "or at random"). [Doc] https://docs.sidestore.io/docs/advanced/pairing-file
1. Plug the phone into the laptop and open iloader (update it if asked).
2. Click **Delete Stored Pairing**.
3. Select the phone and tap **Trust** on the phone.
4. Click **Manage Pairing File**, then **Place** next to SideStore.
5. Wait for the green "Pairing file placed successfully!".
6. If it still fails, restart the phone and the laptop and repeat. Then ask on the SideStore Discord (https://dis.sidestore.io/).
- iloader questions go to the idevice Discord, not SideStore's. [Doc] https://docs.sidestore.io/docs/installation/install

None of these steps should delete the app. If any instruction anywhere says to delete the app, stop and back up first.

## 8. Known pitfalls on iOS 26, limits, and a trial run

### iOS 26 status on 2026-10-08

- **Sign-in:** broken on SideStore 0.6.4 and older since Apple's early-September change. 0.7.0-alpha/nightly includes the fix. [Release notes] https://github.com/SideStore/SideStore/releases
  - [Reports] One explanation is that Apple now rejects sign-ins that identify themselves as Xcode. https://github.com/altstoreio/AltStore/pull/1790
  - iloader v2.3.2 fixed the same 503 problem. https://github.com/nab138/iloader/releases
- **iOS 26.4+ VPN errors:** [Reports] several users on 26.4–26.4.2 got "not on Wi-Fi/VPN" errors even with both on. In some cases, regenerating the pairing file didn't help.
  - https://github.com/SideStore/SideStore/issues/1194, https://github.com/SideStore/SideStore/issues/1237, https://github.com/nab138/iloader/issues/489
  - Those issues show no maintainer fix. The documented advice is "reinstall with iloader" and "use nightly" (§7).
  - **[Unverified]** whether this is fixed on the latest iOS 26 release. A Wikipedia snapshot lists 26.7, 14 Sep 2026, as the latest; not confirmed.
- **iOS 27:** [Reports] a September 2026 report on iOS 27.0 shows the same VPN error with SideStore 0.6.4. https://github.com/LiveContainer/LiveContainer/issues/1566 [Unverified] how the newest builds behave on iOS 27. Stay on iOS 26 until this is clear.
- **Docs lag:** SideStore's docs site doesn't mention iOS 26 or the sign-in break. GitHub releases and issues are more current.

### Limits on a free Apple ID

- **3 active apps per device, including SideStore.** That leaves room for our app plus one other. App Store apps, including LocalDevVPN, don't count. [Doc] https://docs.sidestore.io/docs/faq, https://developer.apple.com/support/compare-memberships/
- **10 App IDs per 7 days.** Each new app uses one, and each app **extension** (a widget, for example) uses another. [Doc] Apple page above; [community source code] `docs/research/free-ios-install.md` §1.1
  - Hitting the limit gives error **1009**. You can't delete App IDs; they free up 7 days after last use. [Doc] https://docs.sidestore.io/docs/troubleshooting/error-codes
  - [Inference] Normal life (SideStore + our app + its widget) uses about 3. Updating the same app shouldn't use new ones. Repeatedly installing test builds with different IDs would.
  - SideStore 0.6.2 added an option to "reuse the main App ID profile for extensions" to save IDs. [Release notes] https://github.com/SideStore/SideStore/releases. **Leave it off** unless the developer says otherwise. [Unverified] whether it breaks the widget and Live Activity's shared storage.
- **Certificates:** if SideStore asks to revoke a certificate, saying yes is normal. [Doc] https://docs.sidestore.io/docs/installation/install
  - [Inference] Apps signed with the old certificate may then stop opening until refreshed. Refresh everything straight afterwards.
  - iloader can view and revoke certificates. Don't revoke things there casually. [Doc] https://github.com/nab138/iloader
- **No push notifications or time-sensitive alerts** on a free Apple ID. Rest-timer alerts use local notifications. [Doc/Community] `docs/research/free-ios-install.md` §1.2

### Trial run before real data (strongly recommended)

1. Install the app (§4) and log a test workout.
2. Make a backup (once that feature exists) and copy it off the phone.
3. Install a newer build over the top. Check the test workout is still there.
4. Let the app expire (skip one refresh). Check it won't open. Refresh it, and check the workout is still there.
5. Restore from the backup into the app.
6. Note how often refreshes and the pairing file gave trouble over the first 4 weeks. That decides whether the free route is good enough.

These match the open questions in `docs/research/free-ios-install.md` §9.

## 9. Apple ID safety

**What happens to your Apple ID:**
- **Password:** [Doc] iloader says it signs in using Apple's SRP protocol, sending your password and two-factor code to **Apple**. https://iloader.app/
  - The SideStore docs don't explain where SideStore sends or stores your password. [Unverified]
  - Upstream AltStore says credentials go "only to Apple", and reportedly keeps them in the phone's Keychain. https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
  - SideStore is a fork of AltStore, but that doesn't prove SideStore does the same.
- **"Anisette" server:** to sign in, SideStore and iloader get "anisette" data from a server that imitates a Mac.
  - SideStore says no account information is sent to that server. [Doc] https://docs.sidestore.io/docs/advanced/anisette, https://docs.sidestore.io/docs/faq
  - **Expect to see fake Macs** (for example an "iMac" or "MacBook Pro") in your Apple ID's device list. They come from anisette and aren't real devices. [Doc] https://docs.sidestore.io/docs/faq
- **Lock-out risk:** heavily shared old anisette servers have caused Apple ID lock-outs. SideStore 0.4.0+ uses v3 servers and says lock-outs are now unlikely. [Doc] https://docs.sidestore.io/docs/advanced/anisette
- **Both tools are open source.** iloader's builds come from GitHub Actions so they can be matched to the code. iloader's developer takes no responsibility for account problems. [Doc] https://iloader.app/

**Your main Apple ID or a dedicated one?** SideStore's docs suggest a separate "burner" Apple ID. [Doc] https://docs.sidestore.io/docs/advanced/anisette, https://docs.sidestore.io/docs/troubleshooting

| | Main Apple ID | Dedicated Apple ID |
|---|---|---|
| If something goes wrong (lock-out, leak) | Affects iCloud, purchases and photos | Only affects signing |
| Two-factor codes | Arrive on your iPhone easily | May come by SMS or another device. Fiddlier [Unverified how smoothly SideStore handles SMS codes; iloader fixed SMS bugs in v2.2.10] |
| Effort | None | Create it once, keep its password safe, accept developer terms once |
| Risk of losing access | Low (you use it daily) | Higher (rarely used, easy to forget). **Losing it means a new app with an empty database** |

**Whichever you choose, it is permanent.** A different Apple ID = a different app = an empty database. The only bridge is backup and restore. Store the password in your password manager and keep its recovery details current. Agents never enter, see or store this Apple ID.

---

## Proposed brief changes (for Ben's approval)

1. **ADR 0004, Consequences:** note that SideStore's stable line (0.6.4 and older) can't sign in since September 2026, and the fix is only in 0.7.0 alpha/nightly. Also note the iOS 26.4+ VPN-detection reports.
   - **Name a fallback now, before real data exists:** Sideloadly or AltStore Classic on the Windows laptop. Both need the laptop on and on the same Wi-Fi each week.
   - Once real workouts are logged, switching tools means backup → new app → restore. So the tool should be finally confirmed by the trial run in §8, not before.
2. **CI (developer task):** upload the `.ipa` artifact unzipped (`actions/upload-artifact` v7 with `archive: false`) so the phone gets an `.ipa` directly. Never change the bundle ID between builds. [Doc] https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/
3. **Milestone 1 acceptance:** add the §8 trial run (update over the top, missed refresh, restore) as an explicit exit criterion before Ben logs real workouts.

## Sources (all checked 2026-10-08)

- SideStore docs: https://docs.sidestore.io/docs/intro, https://docs.sidestore.io/docs/installation/prerequisites, https://docs.sidestore.io/docs/installation/install, https://docs.sidestore.io/docs/faq, https://docs.sidestore.io/docs/advanced/pairing-file, https://docs.sidestore.io/docs/advanced/anisette, https://docs.sidestore.io/docs/troubleshooting, https://docs.sidestore.io/docs/troubleshooting/common-issues, https://docs.sidestore.io/docs/troubleshooting/error-codes, https://docs.sidestore.io/docs/release-notes
- SideStore GitHub: https://github.com/SideStore/SideStore, https://github.com/SideStore/SideStore/releases, https://github.com/SideStore/SideStore/releases/tag/0.7.0-alpha, https://github.com/SideStore/SideStore/releases/tag/0.6.4, https://github.com/SideStore/SideStore/releases/tag/0.6.3, issues #1194, #1237, #1537
- iloader: https://iloader.app/, https://github.com/nab138/iloader, https://github.com/nab138/iloader/releases, https://github.com/nab138/iloader/issues/489
- LocalDevVPN: https://apps.apple.com/us/app/localdevvpn/id6755608044
- Other reports: https://github.com/LiveContainer/LiveContainer/issues/1566, https://github.com/altstoreio/AltStore/pull/1790, https://fr0stb1rd.is-a.dev/posts/ios-26-unlimited-sideload-sidestore-livecontainer/, https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
- Apple, Expo, GitHub: https://developer.apple.com/support/compare-memberships/, https://developer.apple.com/forums/thread/126589, https://docs.expo.dev/guides/ios-developer-mode/, https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts, https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/
