# Setting up Google Drive backup (for Ben)

About 10 minutes, on the laptop, with your own Google account. Do it only once you've decided to try online backup. The feature is parked until then.

**What this does.** It creates a small free "project" in Google's developer console. That project is how GymSmarter is allowed to put backups in a hidden folder in your Google Drive. It only ever reaches your Drive after you sign in on the phone.

**Cost: none.** No card, no billing account, nothing paid. Google's Drive API is free for normal use. Google has said that going *over* its usage limits may be charged from late 2026, but that needs a billing account (you won't have one) and a backup a day is far below the free limits.

**Agents never sign in to your Google account.** You do every step here yourself.

> Google renames console menus often. If a label below doesn't match exactly, look for the nearest equivalent. Note anything that differs in your reply (step 10) so this guide can be fixed.

## Before you start

- Find the app's **installed Bundle ID** on the iPhone: GymSmarter → **Profile → Developer → Capability probe**. Run it and copy the line `Bundle ID installed: com.projectfizz.fizz.XXXXXXXXXX`. (The same ID shows as `App ID …` under **Profile → App status → This install**.) The last part is added by SideStore. You need the whole thing in step 6.

## Steps

1. **Create the project.**
   Go to https://console.cloud.google.com and sign in. Use the project picker at the top, then **New project**. Name it `GymSmarter Backup` and tap **Create**. If asked about billing, **skip it**: don't add a card or billing account.

2. **Turn on the Drive API.**
   With the new project selected: **APIs & Services → Library**. Search for **Google Drive API**, open it and tap **Enable**.

3. **Branding.**
   Go to **Google Auth Platform** (it may say "OAuth consent screen"). Tap **Get started** or **Branding** and fill in:
   - App name: `GymSmarter`
   - User support email: your Gmail address
   - Developer contact email: your Gmail address

   **Leave the logo empty** and don't add a homepage or privacy-policy link. You're not asking Google to verify the brand, and you don't need to. Save.
   - Because of that, Google's sign-in page may show your email or the project instead of "GymSmarter". That's expected and fine.

4. **Audience.**
   Choose user type **External**. You don't need to add test users.

5. **Data access (scopes).**
   Tap **Add or remove scopes**. Find and tick only **`.../auth/drive.appdata`** (described as "See, create, and delete its own configuration data in your Google Drive"). If it's not in the list, paste `https://www.googleapis.com/auth/drive.appdata` into the manual box. Save.
   - It should appear under **non-sensitive scopes**. Note it if it appears anywhere else.
   - Don't add any other scope.

6. **Create the iOS client.**
   Go to **Clients → Create client** and set **Application type: iOS**:
   - Name: `GymSmarter iPhone`
   - Bundle ID: paste the full installed ID from "Before you start"
   - App Store ID, Team ID: leave empty
   - **Don't turn on App Check** (it needs an extra Apple setup we don't use, and it isn't needed)

   Tap **Create**. Google shows a **Client ID** ending in `.apps.googleusercontent.com`. Copy it.
   - An iOS client has **no client secret**. If you see a secret, you picked the wrong type (probably "Desktop" or "Web"). Delete that client and create an iOS one.
   - You don't need to download the plist file it offers.

7. **Publish.**
   Go back to **Audience** and tap **Publish app**, then confirm. The status should read **In production**.
   - This matters: in "Testing", Google signs you out every 7 days and backups would quietly stop.
   - No verification form is needed: Google says apps using only non-sensitive scopes don't have to be verified, and personal-use apps are exempt anyway. If Google asks for verification, a privacy policy or a billing account anyway, stop and note exactly what it says. Don't pay for or submit anything.

8. **Give the build the Client ID.**
   On github.com, open the PROJECT-FIZZ repository and go to **Settings → Secrets and variables → Actions → Variables** tab. Tap **New repository variable** and add:
   - Name: `FIZZ_GOOGLE_IOS_CLIENT_ID`
   - Value: the Client ID from step 6

   It's a **variable**, not a secret. The Client ID isn't secret, but it stays out of the code anyway.

9. **Keep the project.**
   Don't delete the project or the client while you use online backup. If either is deleted, the online backups can't be read any more. Google deletes a client that hasn't been used for 6 months and emails a warning 30 days before. Regular backups count as use. If that email ever arrives, open GymSmarter once.

10. **Reply to the PM** with:
    - "Client ID added as a variable" (or paste the Client ID if you'd rather someone else add it)
    - Did `drive.appdata` show as **non-sensitive**? (yes/no)
    - Did **Publish** go through with no verification, billing or privacy-policy request? (yes/no, and what it said if not)
    - Any menu label that didn't match this guide

## Never send

- Your Google password or any 2-step verification code
- Any **client secret** (an iOS client doesn't have one; nobody will ask you for one)
- Screenshots that show a token or a long code from a sign-in page

## After this

A developer makes a test build. You then run the short phone test in `docs/device-tests/online-backup-spike-plan.md`, which includes signing in with Google once on the phone. Nothing is uploaded from your real data until that test passes and you approve the feature.
