# Building the app file (.ipa)

This guide covers how to get a new copy of the app built in the cloud, and how to download it so SideStore can install it. Installing with SideStore is covered in `docs/guides/sidestore-windows.md` §4.

You don't need a Mac. GitHub builds the app on one of its Macs and gives you a single file ending in `.ipa`.

> **Status (2026-10-08): the cloud build has not run yet.** It was written and checked on Linux, but the first real build on GitHub's Mac will be its first test. If that first build fails, a developer fixes it. You don't need to do anything.

## Before you start

- You need to be signed in to GitHub with access to the PROJECT-FIZZ repository, on the laptop or on the iPhone in Safari.
- Each build uses GitHub's free monthly build minutes. Mac minutes run out much faster than normal ones, and GitHub's pages don't say exactly how much faster. Spending is capped at $0, so if the minutes run out, builds just stop until the monthly reset. Nothing is charged.
- You **don't** need a new build for the weekly SideStore refresh. SideStore re-signs the copy you already have. Only build when there's a new version of the app.

## 1. Start a build

1. Open the repository on github.com and tap **Actions**.
2. In the list on the left, choose **iOS IPA**.
3. Tap **Run workflow**.
4. Leave the branch as it is, unless a developer told you to pick a different one.
5. Leave **Include the Live Activity extension** ticked. Untick it only if a developer asks. It's the fallback if the Lock Screen countdown stops the app building or installing.
6. Tap the green **Run workflow** button.

The build has two stages:

- **Check**, which takes a few minutes. It runs the tests and the safety checks.
- **Build unsigned .ipa**, on a Mac. We don't know yet how long this takes, probably 15–40 minutes.

You can close the page and come back later.

Developers can also start a build by pushing a tag that starts with `ios-v` (for example `ios-v0.1.0`).

## 2. Download the .ipa

1. Open the finished run. It shows a green tick.
2. At the top there's a short summary with the version, the build number and the **Bundle ID**.
3. Scroll to **Artifacts** and tap the file, for example `Fizz-0.1.0-build12.ipa`.

It downloads as a plain `.ipa`, not a zip. The build is set up to upload the file unzipped, so on the iPhone you'll find it straight away in **Files > Downloads**.

Each file is kept for **30 days** and is then deleted automatically. If you might want an older version later, save a copy in Files.

Then install it with SideStore: **My Apps > +**, then choose the `.ipa`. The full steps are in `sidestore-windows.md` §4. To update, install the new `.ipa` over the existing app. **Never delete the app first.** Deleting it deletes your workouts.

## 3. The one rule: the app's identity never changes

iOS knows the app by its **Bundle ID**, currently `com.projectfizz.fizz`, together with the Apple ID that signed it. If either of these changes, iOS installs a separate app with an empty database, and your history is stuck in the old one until you do a backup and restore.

- **Developers:** the Bundle ID is set in one place, `apps/mobile/app-identity.mts`. A test fails if it changes, and so does the build's safety check. Don't change it after the first install.
- **You:**
  - always use the same Apple ID in SideStore;
  - don't use SideStore's option to customise the App ID;
  - don't install the app with a different tool (iloader, Sideloadly, AltStore) without a backup first.

**Before the first install,** check you're happy with `com.projectfizz.fizz`. After that it's permanent.

## 4. If a build fails

Open the failed run and look for the step with the red cross.

| Failed step | What it means |
|---|---|
| **Check** | A test or code check failed. It's a developer fix, and no Mac minutes were used. |
| **Entitlement check** | The app asked for something a free Apple ID can't sign, for example push notifications. Or the Bundle ID changed. It's a developer fix. This check stops the build before you get an app that SideStore would refuse. |
| **Build (Release…)** | The Mac couldn't compile the app. The build log is attached under Artifacts as `xcodebuild-log` for a developer. |
| **Ad hoc sign** | Signing the file for SideStore failed. It's a developer fix. |

If builds keep failing only because of the Live Activity extension, run it again with **Include the Live Activity extension** unticked. The app works without it, and the probe screen will show Live Activity as "unavailable".

## 5. After installing: the capability probe

The first builds are test builds. On the home screen, tap **Developer: capability probe**. Each row tests one thing the app depends on and shows one of these results:

- PASS
- FAIL
- UNAVAILABLE
- NEEDS CHECK: the app can't tell by itself whether it worked. It asks you a yes/no question, for example whether you heard the cue.

Most rows explain what to do. These three need you to do something:

- **Notification:** tap Run and lock the phone straight away.
- **Rest deadline:** tap Run, swipe the app away, reopen it and go back to the probe.
- **Ducking:** start music in another app first.

Results are saved on the phone as you go, including your yes/no answers. Going back to the home screen, or swiping the app away for the rest-deadline test, doesn't lose them. If saving ever fails, the probe screen says so in red: tap **Export** straight away in that case.

Tap **Export** to send the results as text, for example to Notes or by email, so a developer can read them. The export includes every saved result, with the time each one was recorded.

## Until the workflow is on the main branch

GitHub only shows the **Run workflow** button for workflows that exist on the default branch (`main`). Until this branch is merged, a build runs when Claude pushes a commit whose message contains `[ios-build]` to a `claude/...` branch. Other pushes run only the cheap Linux checks. You'll find the `.ipa` under that run on the Actions tab, in the same way as described above.
