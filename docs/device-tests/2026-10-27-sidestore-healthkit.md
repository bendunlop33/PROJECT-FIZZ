# Device test: Apple Health through a patched SideStore (27 Oct 2026)

ADR 0036. About 30 minutes, phone plus the Windows laptop with iloader. You install a SideStore we built with one
upstream fix that lets a free Apple ID turn on HealthKit, then install GymSmarter again. Record each step as
Pass / Fail / Not run with a note, and screenshot any error.

**Build 3 (27 Oct, amendment to ADR 0036):** after build 2 kept asking for a pairing file and sign-in failed with
**-80045**, the `.ipa` is now built from a reviewed unofficial fork that fixes both (review:
`docs/research/sidestore-ti800-review.md`). Its version ends in **`+f492137`**. Install it with iloader (§3).

**Never delete GymSmarter or SideStore during this test.** Install over the top only.

## 0. Before you start (2 min)

1. GymSmarter › Profile › **Data & backup** › **Save a copy to Files** › iCloud Drive. Check the file exists in Files.
2. LocalDevVPN shows **Connected**, Wi-Fi on.
3. In SideStore › My Apps, note how many days GymSmarter and SideStore have left. Refresh first if under 2 days.

## 1. Which SideStore do you have?

SideStore › **My Apps**: the SideStore row shows its version (also at the bottom of SideStore › **Settings**). Write it
down exactly, then pick the file:

| Your version | Install |
|---|---|
| Contains `healthkit` (our build 1 or 2) | `SideStore-HealthKit.ipa` from the newest run (build 3, `+f492137`) |
| `0.6.4` | **Recommended:** `SideStore-HealthKit.ipa` (moves you to 0.7, see below). Alternative: `SideStore-0.6.4-HealthKit.ipa` keeps you on 0.6.4 |
| `0.7.0-20260911…` (alpha/stable) | `SideStore-HealthKit.ipa` |
| Any other `0.7.0-2026…` (a nightly), or anything newer | **Stop** and send the version. We rebuild from that exact version first; installing an older SideStore over a newer one can lose its data |
| `0.6.3` or older | **Stop** and send the version |

**Why 0.7 is recommended from 0.6.4:** SideStore's own source already offers 0.7.0 as the stable update to 0.6.4, and
0.7 has the fix for Apple's September sign-in change that 0.6.4 lacks (`docs/guides/sidestore-windows.md` §8). 0.6.4
works for you now because SideStore is already signed in; if it ever has to sign in again, 0.6.4 (patched or not)
may fail.

**Moving from 0.6.4 to 0.7:** installing over the top keeps SideStore's data, Apple ID sign-in and pairing file
(SideStore's FAQ: install a test build "via SideStore or iloader and your data should remain", not guaranteed for
unofficial builds). 0.7 needs nothing new on iOS 26 as far as we can tell: the same LocalDevVPN and pairing file as
0.6.4. Risks: SideStore may ask you to sign in again (have your phone ready for the 2FA code); in the worst case
SideStore loses its pairing file and you redo it with iloader on the laptop (§6). GymSmarter and its data aren't
touched by any of this.

## 2. Download (2 min)

1. Open the workflow run link the PM sends (Actions › **SideStore HealthKit (patched)**), green tick.
2. The summary shows each build's refs and version. Under **Artifacts**, tap the `.ipa` from §1. It lands in
   **Files › Downloads** as a plain `.ipa`. (Optional: the matching `…-README.md` lists exact refs and the SHA-256.)

## 3. Install the patched SideStore with iloader (10 min)

1. On the laptop, download `SideStore-HealthKit.ipa` from the run's **Artifacts**. Phone plugged in and unlocked.
2. iloader › **Import IPA** (Import any IPA) › the `.ipa`. It installs over your SideStore.
3. iloader › **Manage Pairing File** › **Place** (into SideStore). Do this after every SideStore install.
4. Phone: LocalDevVPN shows **Connected**.
5. Open SideStore. It should **not** ask for a pairing file (this build reads the file iloader placed when it
   launches). If it asks: swipe SideStore away, reopen once. Still asking: repeat step 3, then reopen. Note which.
6. Sign in with your Apple ID if asked, and enter the 2FA code.
7. Check: SideStore's version contains **`healthkit`** and ends **`+f492137`**; Settings shows your Apple ID; My Apps
   still lists GymSmarter.

**If sign-in fails** (-80045, "invalid server response", or an anisette error), try these in order, signing in again
after each, and note which one worked:

1. SideStore › Settings › User Customizations › **On-Device Anisette**: off.
2. SideStore › Settings › anisette server: pick **`ani.sidestore.zip`** from the list.
3. SideStore › Settings › User Customizations › **Reset adi.pb** › **Reset & Sign Out** (your signing certificate is
   kept), then sign in.

Still failing: screenshot the exact error and stop. Your current GymSmarter keeps working until its expiry date.

## 4. Stop SideStore updating itself (1 min)

1. SideStore › **Settings**: turn off beta updates / update checks if the switch is there.
2. From now on, **never tap Update on SideStore's own row** or accept a SideStore update prompt. An official update
   removes the fix; tell the PM instead and we rebuild.

## 5. Install GymSmarter again (3 min)

A **Refresh is not enough**: the app on the phone was signed without Health and a refresh keeps that.

1. Download the latest GymSmarter `.ipa` (Actions › **iOS IPA**, as usual).
2. SideStore › My Apps › **+** › choose it. It installs over the existing app.
3. Watch for errors mentioning **App ID**, **maximum**, **feature** or **HealthKit**. If one appears, screenshot it
   and stop. **Don't delete any App ID** to make room.
4. Open GymSmarter: your workouts are all there.

## 6. Check Apple Health (2 min)

1. Profile › **Apple Health**.
   - **Switches show:** it worked. Turn on **Workouts**: the iOS Health sheet should appear. Then continue
     `2026-10-27-apple-health.md` from §1.
   - **`Not available on this install`:** the fix didn't take. Report it (below).
2. Next day, or after the next weekly refresh: Apple Health still shows switches.

## What to report

- SideStore version before (§1) and after (§3), and which `.ipa` you used.
- How SideStore installed (My Apps or iloader) and whether you had to sign in again.
- Pairing: did SideStore ask for a pairing file after iloader's **Place**, and did reopening or re-placing fix it.
- Sign-in: worked first time, or which anisette tip (§3) fixed it; any error code (e.g. -80045).
- Any SideStore error text at §3 or §5 (screenshots).
- Profile › Apple Health: switches or `Not available on this install`; whether the Health permission sheet appeared.
- Workouts still all there (yes/no).

## If it fails

- **GymSmarter keeps working either way.** Logging, history and backups don't depend on Health or on which SideStore
  you run. Nothing to undo in GymSmarter.
- **Patched SideStore won't install or misbehaves:** go back to the official SideStore you had: download it from
  github.com/SideStore/SideStore/releases (`0.6.4`, or the alpha) and install it over the top through SideStore
  (My Apps › +) or iloader. Then install GymSmarter again so it's signed by the official SideStore.
- **App ID error at §5:** stop and report; don't delete App IDs (a free account gets 10 per 7 days). We decide next
  steps from the error text.
- **Still `Not available on this install`:** report it. The remaining routes are Xcode on a Mac or the paid
  programme (ADR 0035, Q10). You can stay on the patched SideStore or go back; either is fine.

## Result so far (Ben, 27 Oct 2026, ~01:00)

- Patched build 1 (0.6.4) and 2 (nightly): sign-in failed ("invalid server response", then -80045); build 2 also looped on "pairing file" (nightly can't read iloader's combined file).
- Build 3 (reviewed Ti800 fork + HealthKit, `+f492137`) via iloader Import IPA: pairing configured (Lockdown + RemotePairing), then -80046 at sign-in.
- **What fixed sign-in** (SideStore issue #1693): Settings › User Customizations › On-Device Anisette **off**; Anisette Servers › **SideStore (New)** (new.ani.sidestore.io) and **Enable Auto Rotation off**; Anisette Client Configuration › Remote Server Sync › **Fetch** › **Save as Overrides**; User Customizations › **Reset adi.pb**; sign in once and wait. **Signed in.**
- Next: reinstall GymSmarter (fresh install over the top via SideStore) and check Profile › Apple Health.
