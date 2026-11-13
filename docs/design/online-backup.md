# Online backup to Google Drive

Status: **v0.1 draft, 12 Oct 2026. Designer. Parked until Ben approves** (backlog row "Online backup to Google Drive's hidden app-data folder", Ben 12 Oct). Nothing here is built.

Tokens: [design-system.md](design-system.md). Extends [data-import-export.md](data-import-export.md) (Data & backup hub §2.1, restore §2.3, status §3.1, delete §4.5) and [onboarding.md](onboarding.md) §4.5 (restore from Welcome). Research: [google-drive-backup.md](../research/google-drive-backup.md) (cited as GD), [online-backup-security.md](../research/online-backup-security.md) (cited as SEC). Decision record: [draft-online-backup.md](../decisions/draft-online-backup.md). Setup: [google-drive-setup-for-ben.md](../guides/google-drive-setup-for-ben.md). Spike: [online-backup-spike-plan.md](../device-tests/online-backup-spike-plan.md).

**What it is.** Ben signs in with Google once. After each finished workout, GymSmarter puts a copy of its newest on-phone backup in Drive's hidden app-data folder. On a new phone he signs in and restores. It is **backup only, not sync**: nothing is ever merged, and nothing is restored without his tap. There is no server of our own.

**What it is not.** It doesn't replace `Save a copy to Files`. The online copies depend on one Google account and one Cloud project that Ben owns. They can't be opened from the Drive website, and they are unreadable if that project's OAuth client is lost (GD §7). The Files copy stays as the independent off-phone copy.

---

## 0. Design decisions

The two research notes disagree in three places. These are the picks; each is open to Ben.

| # | Decision | Why |
|---|---|---|
| OD1 | **One new durability phrase: `Backed up to Google Drive`**, icon `arrow.up.doc` + text (iCloud symbols would mislead). It sits beside the three in design-system §7.1. Never "synced", "in the cloud" or "uploaded". | DX1 keeps Ben sure *where* a copy is. "Google Drive" names the place, as "Files" does. |
| OD2 | **Upload the on-phone file as it is**, byte for byte, so its SHA-256 (already in the backup record) is the check. No second serialisation. | GD rec. 4. One format, one hash, and the Restore pipeline is unchanged. |
| OD3 | **Keep the newest 14 online copies, fixed** (no setting in v1). Three guards: never delete the copy just uploaded, the copy with the most finished workouts, or the newest copy from another phone. | GD said 10, SEC said 14. 14 matches the on-phone default, so there's one number to remember. The guards stop an empty or wrong phone from pushing the good copies out (SEC §6), so the "Start fresh" step SEC proposed isn't needed (OD7). |
| OD4 | **Keychain class `WHEN_UNLOCKED_THIS_DEVICE_ONLY`**, same as ChatGPT. The access token is fetched while the phone is unlocked (right after Finish) and kept in memory for the upload. | SEC §2. v1 has no background task scheduler, so `AFTER_FIRST_UNLOCK` (GD) widens exposure for no gain. Revisit only if BGTaskScheduler is added. |
| OD5 | **Show the signed-in account.** Read it with Drive `about.get` (no extra scope). If the spike shows that call needs more than `drive.appdata`, add `openid email` instead. | Restoring from the wrong Google account is a realistic mistake (SEC §3). GD and SEC differ on how; the spike settles it. |
| OD6 | **Plain JSON online in v1, like Files.** No encryption setting in v1. Each copy's `appProperties` records `enc=none`; a later opt-in recovery-key format would be a separate file format with a cleartext header, so v1 copies never need migrating. | SEC §4: encryption mainly adds one way to lose everything (a lost key). Ben decides; see Q2. |
| OD7 | **No "Start fresh" gate.** A phone with no finished workouts has no on-phone backup, so nothing is owed and nothing uploads. Once it has one, OD3's guards protect the best copy. | Removes one screen and one state from SEC §6 with the same protection. |
| OD8 | **Mobile data on by default** (`Use mobile data` switch). Low Data Mode always waits for Wi-Fi. | A copy is 1–5 MB. The point is a copy soon after the workout; the gym is where Ben finishes. |
| OD9 | **Nothing about online backup appears during a workout, on Today or as a banner.** The summary keeps its one on-phone line (data-import-export X2). The hub card and the Profile row show it. | Logging loop comes first; DX12 "safeguards, not nagging". |
| OD10 | **A copy in Google Drive that holds today's data counts as an off-phone copy** for the 30-day reminder and the §4.1a safeguards. | Otherwise Ben is prompted to save to Files right after a perfectly good online backup. |
| OD11 | **Delete my data deletes the online copies too.** Copies Ben saved to Files are still kept. | Online copies are app-managed Your data (rule 10); Files copies are Ben's own files (ADR 0023). |

---

## 1. Purpose

| Surface | Question it answers | Single primary action |
|---|---|---|
| Data & backup → **Google Drive** section | "Is there a recent copy online, in which account?" | Signed out: `Sign in with Google`. Signed in: none in accent (it runs by itself); `Back up now` is a row |
| Sign-in sheet | "What am I connecting, and what can it see?" | `Sign in with Google` |
| Restore → **Google Drive** group | "Which online copy do I bring back?" | Pick a copy (then the existing preview's `Restore …`) |
| Sign out / Delete online backups | "Remove the connection, the copies, or both." | None in accent; destructive options are red |

None of this is reachable from an active workout, the rest screen or the coach (DX10).

---

## 2. Layout

Design width 390pt; checked at 375 and 430. Dates and counts use tabular numerals. Rows ≥ `target.min` (44pt).

### 2.1 Data & backup hub: changes

Revised region list (new parts in **bold**; the rest is data-import-export §2.1, unchanged):

1. Navigation bar.
2. **Backup status card.** On-phone line, **then a Google Drive line (only when signed in)**, then the Files line. When the Google Drive line is current (OD10), `Save a copy to Files` drops to a `SecondaryButton`; otherwise it stays primary.
3. Backups on this phone (unchanged).
4. **Google Drive** (new section, between "Backups on this phone" and "Off this phone"). Only when the build has a Google client ID (§3.6).
5. Off this phone (Files): unchanged. Its heading becomes `Files`.
6. Restore, Import, Export (unchanged; Restore's choose screen gains a Google Drive group, §2.3).
7. Delete and reset (unchanged rows; Delete's list gains one line, §2.5).

```
┌────────────────────────────────────────┐
│ ‹ Profile      Data & backup           │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ ✓ Backed up on this phone · 19:05  │ │ iphone, status.done
│ │ ✓ Backed up to Google Drive · 19:06│ │ arrow.up.doc, status.done
│ │ ✓ Copy saved to Files · Thu 8 Oct  │ │
│ │ 👤 Your data: 412 workouts · …     │ │
│ │ 📚 Coaching knowledge: 9 rules · … │ │
│ │ [     Save a copy to Files       ] │ │ Secondary when Drive is current
│ └────────────────────────────────────┘ │
│                                        │
│ Backups on this phone                  │
│ After each workout   On · keeps 14   › │
│ …                                      │
│                                        │
│ Google Drive                           │ SectionHeader
│ Back up to Google Drive        [ On ]  │ switch
│ Account          b•••••@gmail.com      │ text.secondary, no chevron
│ Last backup        Today, 19:06        │ tabular
│ Back up now                            │ accent text row
│ Use mobile data                [ On ]  │
│ Restore from Google Drive            › │
│ Sign out                             › │
│                                        │ space.8
│ Delete online backups                  │ DangerTextButton
│                                        │
│ Files                                  │
│ Also back up off the phone auto… [Off] │ (existing rows)
└────────────────────────────────────────┘
```

**Signed out** (or never set up), the section is one row and one note:

```
│ Google Drive                           │
│ Back up to Google Drive              › │ opens the sign-in sheet (§2.2)
```

The account is shown in full on the row (Ben's own phone); the masked form above is only for this document. At AX1+ the value moves under the title.

### 2.2 Sign-in sheet

Medium detent. One line of copy, one primary. `ⓘ` opens the "Why?" text (§5).

```
┌────────────────────────────────────────┐
│ Google Drive                    Cancel │
│                                        │
│ After each workout, a backup goes to a │
│ hidden GymSmarter folder in your       │
│ Google Drive. It can't see your other  │
│ files.                             ⓘ   │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │        Sign in with Google         │ │ PrimaryButton
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

`Sign in with Google` opens the iOS system sheet (`ASWebAuthenticationSession`). iOS shows its own `"GymSmarter" Wants to Use "google.com" to Sign In` prompt; Google's consent page follows. The button is plain text in our style; it is **not** Google's branded button (no Google logo asset).

**Return paths.**
- Success, no copies from another phone: sheet closes, switch is On, card shows `Backing up to Google Drive…`, then `✓ Backed up to Google Drive · 19:06` (the first upload runs straight away if this phone has a backup).
- Success, Drive already holds a copy from **another phone** with more finished workouts than this one: the sheet changes to:

```
│ Google Drive has a backup from another │
│ phone: Thu 8 Oct · 412 workouts.       │
│ [         Restore it              ]    │ PrimaryButton → §2.3 preview
│ Not now                                │ text button
```

`Not now` closes the sheet; backups start as usual (OD3's guards keep that copy).
- Cancelled: sheet stays, nothing changed, no message.
- Failed: one line above the button (§3.2) and the button reads `Try again`.

### 2.3 Restore from Google Drive

**Entry points.** Data & backup → `Restore from Google Drive` (opens the choose screen scrolled to the group); Data & backup → `Restore from a backup`; Welcome → `Restore from a backup` (onboarding §4.5). The Welcome screen keeps **one** restore button; the new phone path is: Welcome → `Restore from a backup` → `Sign in with Google` row → list.

**Step 1: choose** (data-import-export §2.3 step 1, with one new group):

```
┌────────────────────────────────────────┐
│ ‹ Back       Restore from a backup     │
├────────────────────────────────────────┤
│ On this phone                          │ hidden when empty (new phone)
│ Thu 8 Oct, 19:05 · after workout     › │
│                                        │
│ Google Drive · ben@gmail.com           │ group header
│ Today, 19:06 · 412 workouts          › │ tabular
│ Thu 8 Oct, 19:06 · 411 workouts      › │
│ Tue 6 Oct, 18:52 · 410 workouts      › │
│   another phone                        │ 2nd line, only for other installs
│ Show all 14                          › │ after the first 5
│                                        │
│ Choose another file…                 › │
└────────────────────────────────────────┘
```

Google Drive group states (each replaces the rows, header stays):

| State | Rows |
|---|---|
| Signed out | `Sign in with Google ›` (opens §2.2 sheet; on success, the list loads here) |
| Loading | `Loading…` with the system activity indicator |
| Empty | `No backups in this Google account.` + `Use another account ›` |
| Offline | `No internet. Google Drive backups can't be listed.` + `Try again` |
| Reconnect | `Sign in to Google again ›` |
| Failed | `Couldn't list Google Drive backups.` + `Try again` |

`Use another account` signs out (keeping copies) and reopens the sheet with `prefersEphemeralWebBrowserSession = true`, so Google shows the account chooser.

Rows show only date, workout count and, when it isn't this install, `another phone`. No device names (iOS doesn't give them without an entitlement) and nothing personal in file names.

**Step 2: download and check.** Inline, as the existing step 2, with one line first:

```
│ Checking the backup…                   │
│ ✓ Downloaded (1.4 MB)                  │
│ ✓ Checksum matches                     │
│ … Rebuilding a test copy               │
```

The copy downloads to `tmp`, is checked against Drive's `sha256Checksum` (if given), the SHA-256 in its `appProperties`, and the file's own checksums, then the existing `verifyBackup`. It is deleted from `tmp` when the flow ends, on every path.

**Steps 3–6: unchanged.** Preview by section with counts, the "will be replaced" alert, `BlockingCover`, done screen with `Undo restore`. On an empty phone both sections are pre-ticked (data-import-export §2.3). The preview's header line reads `Made Thu 8 Oct 2026, 19:05 · from Google Drive`.

### 2.4 Sign out and Delete online backups

**`Sign out`** → action sheet:

```
Sign out of Google?
[ Sign out, keep online backups ]
[ Sign out and delete online backups ]   red
[ Cancel ]
```

**`Delete online backups`** → alert:

> **Delete 14 online backups?**
> Backups on this phone and in Files are kept. Back up to Google Drive turns off.
> [Cancel] [Delete]

Both deletes show an inline progress row in the section (not a full-screen cover; nothing local changes): `Deleting online backups… 6 of 14`. They list the folder, delete every file in it, and list again to confirm it's empty.

### 2.5 Delete my data: one added line

On the Delete my data screen (data-import-export §2.7), in the "What's removed" list, when signed in:

```
│ • Google Drive backups (14)            │
```

and the alert body gains one sentence: `Google Drive backups are deleted too.` If offline when Ben opens the screen: `• Google Drive backups (14) · deleted when you're back online`.

---

## 3. States

### 3.1 Google Drive line (status card, Profile row)

Decided by `getBackupStatus(…).online` (§6). Screens never compute it. Icon + text always.

| State | Trigger | Card line | Profile row |
|---|---|---|---|
| Off | Never signed in, or switch off | (no line) | (nothing) |
| Backed up | Newest eligible on-phone backup is uploaded and verified | `✓ Backed up to Google Drive · 19:06` | `Google Drive 19:06` appended to the status line |
| Backing up | Upload or verify in progress | `Backing up to Google Drive…` (static ellipsis) | — |
| Waiting: no internet | Owed, no network | `ⓘ Google Drive: waiting for internet` | — |
| Waiting: Wi-Fi | Owed, only mobile data, `Use mobile data` off or Low Data Mode | `ⓘ Google Drive: waiting for Wi-Fi` | — |
| Didn't save | Last attempt failed (5xx, timeout, checksum mismatch), retrying | `⚠ Google Drive backup didn't save` + detail `Last good: Thu 8 Oct` + `Try again` | `⚠ Google Drive` marker |
| Drive full | 403 `storageQuotaExceeded` | `⚠ Google Drive is full` + `Try again` | `⚠ Google Drive` marker |
| Sign in again | `invalid_grant` (revoked, 6 months unused, password-reset policy), or scope missing | `⚠ Sign in to Google again` + `Sign in` | `⚠ Google Drive` marker |
| Paused for workout | Owed while a workout is unfinished | Same as Waiting/Backed up before it; no new line. Uploads after Finish | — |

"Owed" means the newest **eligible** on-phone backup (integrity OK, of this phone's data, not `kept_for_undo` or `after_delete`) has a SHA-256 that isn't in a verified online copy yet. Only the newest is uploaded; older owed files are skipped.

The Waiting states appear only on the hub card, never as warnings: being offline isn't a failure. `Didn't save` shows only after the latest attempt failed, so a retry that succeeds clears it silently.

### 3.2 Sign-in

| State | Display | Next |
|---|---|---|
| Ready | §2.2 | `Sign in with Google` |
| In system sheet | Our sheet dimmed behind iOS's | — |
| Cancelled (Ben closed it, or iOS prompt `Cancel`) | Nothing | Ready |
| No internet | `No internet.` | `Try again` |
| Google error / refused | `Google didn't sign you in. Try again.` + `ⓘ` with the error code | `Try again` |
| Drive access not granted (scope missing from the token response) | `Google didn't give access to Drive. Try again.` Tokens are revoked at once, nothing stored | `Try again` |
| Timed out (5 min, `timing.signInTimeout`) | `Sign-in timed out.` | `Try again` |
| Signed in | Sheet closes, or the "another phone" variant (§2.2) | — |

### 3.3 Upload runs

| Trigger | Condition | Behaviour |
|---|---|---|
| After Finish | On-phone backup for that workout succeeded | Upload starts straight away in the foreground, under a UIKit background task. Never delays the summary or `Done` |
| Other on-phone backups | After import commit, Undo import, restore, Undo restore, reset | Same: newest eligible file only |
| Launch / foreground | Something owed, no workout unfinished, backoff elapsed | Catch-up upload |
| Network returns | App in foreground and something owed | Catch-up upload |
| `Back up now` | Any time outside a workout | Writes a fresh on-phone backup if none covers the data, then uploads it. Ignores backoff |
| Locked mid-upload | Background time runs out | Stops; the resumable session is kept (valid 7 days); resumes on next foreground |
| Force-closed mid-upload | — | On launch: resume the session or start again. Drive file ID is pre-allocated (`generateIds`), so a retry never creates a duplicate |

**Retry backoff** after a failure: 1 min, 5 min, 30 min, then only on the next launch or foreground (`timing.onlineBackupRetry`). 429 and 403 `userRateLimitExceeded` use the same backoff.

**Verify, then rotate.** After upload: compare Drive's `size` and `sha256Checksum` with the local file. If `sha256Checksum` is absent, download and re-hash. Only then is the copy `Backed up to Google Drive`, and only then does rotation run (OD3). Rotation failure is silent (one extra copy is harmless) and retried next time.

### 3.4 Restore

All of data-import-export §3.3 applies. Additions:

| State | Display |
|---|---|
| Download failed | `Couldn't download this backup. Data unchanged.` + `Try again` |
| Downloaded file doesn't match Drive's checksum | `This backup file is damaged (its checksum doesn't match). Data unchanged.` (existing copy) |
| Workout unfinished | Google Drive rows disabled with the existing `Finish or discard your workout first …` |

### 3.5 Sign out, delete, Delete my data

| State | Display |
|---|---|
| Deleting online backups | Inline row `Deleting online backups… 6 of 14` |
| Deleted | Toast `14 online backups deleted` (no Undo: Drive deletes in this folder are permanent; the alert says so by not offering Undo, the Why? says it) |
| Delete offline | `No internet. Nothing was deleted.` |
| Delete partly done | `8 of 14 deleted. Try again to finish.` + `Try again` |
| Sign out, offline | Signed out on this phone at once. Card note on the hub: `ⓘ Google access not removed online` + `Why?` (the Google Account → Third-party access path) |
| Delete my data: online step can't run (offline) | Existing `Deleting didn't finish (Google Drive backups).` line + `Finish deleting`. Only the Google sign-in is kept on the phone until it finishes |
| Delete my data: can't run (sign-in invalid) | `Google Drive backups not deleted` + `Why?` (delete them in drive.google.com → Settings → Manage apps → GymSmarter → Delete hidden app data). The Google sign-in is then removed |

### 3.6 Build and capability

| State | Display |
|---|---|
| Build has no Google client ID | Google Drive section hidden. App status shows `Google Drive backup · Not in this build` |
| Spike not yet passed on this phone | Section shown only in Developer (`Google Drive backup test`) |

### 3.7 Transitions

```
Off ──Sign in──► Signed in ──(owed)──► Backing up ──verified──► Backed up
                     │                      │  └─fail──► Didn't save ──backoff/Try again──► Backing up
                     │                      └─no net / Wi-Fi only──► Waiting ──network──► Backing up
                     ├─invalid_grant (any call)──► Sign in again ──Sign in──► Signed in
                     ├─switch Off──► Signed in, paused (copies kept, no uploads)
                     ├─Sign out (keep)──► Off (copies kept online)
                     ├─Sign out (delete) / Delete online backups──► Deleting ──► Off
                     └─Delete my data──► online step ──► Off (or Finish deleting pending)
```

---

## 4. Interactions

- **Switch `Back up to Google Drive`.** Off → On when signed out opens §2.2. On → Off when signed in: no alert; uploads stop, sign-in and copies stay. Turning it On again uploads anything owed.
- **`Back up now`.** Disabled while backing up or during a workout (`Finish or discard your workout first`).
- **`Use mobile data`.** Takes effect at the next attempt.
- **`Restore from Google Drive`.** As §2.3. Disabled with an unfinished workout (DX4).
- **`Sign out`.** Action sheet §2.4. Order for "and delete": delete copies → confirm empty → revoke token at `oauth2.googleapis.com/revoke` → remove Keychain item. Order for "keep": revoke → remove Keychain item (offline: remove locally, note §3.5).
- **`Delete online backups`.** Alert §2.4. Keeps the sign-in, turns the switch off.
- **Account row.** Not tappable. Long-press copies the address (standard iOS).
- **Gestures.** None beyond standard list and sheet gestures. Sheet swipe-down = `Cancel`.
- **Keyboard.** None. Sign-in happens in the system sheet.
- **Voice and coach.** None. The coach can't start, restore, sign out or delete (DX10). Spoken cues: none.
- **Undo paths.**

| Action | Undo |
|---|---|
| Upload | None needed |
| Switch off | Switch on |
| Sign out (keep) | Sign in again; copies are still there |
| Restore from Google Drive | `Undo restore` / `Undo last restore` (existing) |
| Delete online backups / Sign out and delete | None (permanent in Drive). Confirm alert instead; on-phone and Files copies untouched |
| Rotation | None needed; guards keep the best copies |

---

## 5. Copy

Minimal-copy convention: values and actions; explanations only behind `ⓘ` / `Why?`.

| Element | Text |
|---|---|
| Section header | `Google Drive` |
| Rows | `Back up to Google Drive` · `Account` · `Last backup` · `Back up now` · `Backing up…` · `Use mobile data` · `Restore from Google Drive` · `Sign out` · `Delete online backups` |
| Card lines | `✓ Backed up to Google Drive · 19:06` · `Backing up to Google Drive…` · `ⓘ Google Drive: waiting for internet` · `ⓘ Google Drive: waiting for Wi-Fi` · `⚠ Google Drive backup didn't save` · `Last good: Thu 8 Oct` · `⚠ Google Drive is full` · `⚠ Sign in to Google again` · `ⓘ Google access not removed online` |
| Buttons | `Sign in with Google` · `Try again` · `Sign in` · `Restore it` · `Not now` · `Use another account` · `Show all 14` |
| Sign-in sheet | Title `Google Drive` · `After each workout, a backup goes to a hidden GymSmarter folder in your Google Drive. It can't see your other files.` |
| Sign-in sheet `ⓘ` | `Backups are plain files with your training data and coaching knowledge, like the ones on this phone. They never contain your sign-ins. They don't show in the Drive app. GymSmarter keeps the newest 14. Keep saving a copy to Files too: online backups can't be opened outside GymSmarter.` |
| Another phone | `Google Drive has a backup from another phone: Thu 8 Oct · 412 workouts.` |
| Sign-in errors | `No internet.` · `Google didn't sign you in. Try again.` · `Google didn't give access to Drive. Try again.` · `Sign-in timed out.` |
| Restore group | `Google Drive · ben@gmail.com` · `Today, 19:06 · 412 workouts` · `another phone` · `Loading…` · `No backups in this Google account.` · `No internet. Google Drive backups can't be listed.` · `Couldn't list Google Drive backups.` · `Sign in to Google again` · `Downloaded (1.4 MB)` · `Made Thu 8 Oct 2026, 19:05 · from Google Drive` · `Couldn't download this backup. Data unchanged.` |
| Sign out sheet | `Sign out of Google?` · `Sign out, keep online backups` · `Sign out and delete online backups` · `Cancel` |
| Delete alert | `Delete 14 online backups?` / `Backups on this phone and in Files are kept. Back up to Google Drive turns off.` [Cancel] [Delete] |
| Delete progress / results | `Deleting online backups… 6 of 14` · `14 online backups deleted` · `No internet. Nothing was deleted.` · `8 of 14 deleted. Try again to finish.` |
| Delete my data | `Google Drive backups (14)` · `· deleted when you're back online` · alert sentence `Google Drive backups are deleted too.` · `Deleting didn't finish (Google Drive backups).` · `Google Drive backups not deleted` |
| Why? (not removed online) | `GymSmarter signed out on this phone but couldn't reach Google. To remove its access: Google Account › Security › Third-party apps › GymSmarter › Remove access.` |
| Why? (backups not deleted) | `The Google sign-in no longer works, so GymSmarter can't delete them. In drive.google.com: Settings › Manage apps › GymSmarter › Options › Delete hidden app data.` (menu labels to confirm in the spike) |
| App status | `Google Drive backup` · `Not in this build` / `Working · checked 12 Oct, build 90` / `Not working` |

Values are actual results (dates, counts of finished workouts in each copy). There are no targets on these screens.

Spoken cues: none.

---

## 6. Data needed

Existing (unchanged): `createBackup`, `verifyBackup`, `previewRestore`, `restoreBackup(file, {sections})`, `DatabaseManager.rollback()`, `getActiveSession`, `deleteMyData`, the on-phone backup service (`createBackupService`, manifest, `planRotation`), `backupCovers`.

**Proposed** (contracts for the developer; names open to change):

| Function | Package | Purpose |
|---|---|---|
| `googleAuthorize({clientId, ephemeral})` → `{refreshToken, accessToken, expiresAt, scopes}` | `packages/providers/src/google` + `loopback-auth` `customScheme` mode | PKCE S256, reversed-client-ID redirect, scope check; revokes and fails if `drive.appdata` missing |
| `googleTokenVault` (Keychain service `fizz.google`, one item `{v, refreshToken, scopes, savedAtMs, email}`) and a `TokenRefresher` on it | `providers` / `apps/mobile/src/ai/keychain.ts` | Reuses ADR 0012's refresher; `invalid_grant` → `reconnect`; network/5xx keep tokens. Added to `KEYCHAIN_KEYS` |
| `googleRevoke(token)` | `providers` | Sign out, Delete my data |
| `drive.about()` → `{email}` | `providers` | Account row (OD5) |
| `drive.generateId()` · `drive.uploadResumable({id, name, appProperties, bytes, session?})` · `drive.list()` · `drive.get(id)` · `drive.download(id)` · `drive.delete(id)` | `providers` | `spaces=appDataFolder` only; typed errors (`offline`, `rate_limited`, `quota_full`, `reconnect`, `restart_upload`, `server`) |
| `onlineBackupService` → `runOnlineBackup(trigger, opId)`, `backUpNow()`, `listOnlineCopies()`, `downloadOnlineCopy(id)`, `deleteOnlineCopies()`, `signOut({deleteCopies})` | `apps/mobile/src/backup` | Owed logic, network/cellular gate, workout gate, backoff, verify, rotation |
| `planOnlineRotation(copies, {keep: 14, justUploaded, thisInstall})` | pure, `apps/mobile/src/backup` | OD3 guards; unit-tested |
| `getBackupStatus(ownerId)` gains `online: {state: 'off' \| 'backed_up' \| 'backing_up' \| 'waiting_network' \| 'waiting_wifi' \| 'failed' \| 'quota_full' \| 'reconnect', account?, lastVerified?{atUtc, tz, finishedWorkouts}, lastAttempt?{atUtc, error?}, useMobileData, copiesOnline?}` | `apps/mobile/src/backup/status.ts` | One source for card, Profile row, safeguards (OD10) |
| Backup manifest **v2**: `online: {enabled, useMobileData, installId, lastVerified, lastAttempt, pending?{opId, fileId, sha256, sessionUri?, startedAtUtc}, nextRetryAtUtc}` | `apps/mobile/src/backup/manifest.ts` | Kept in `backup-state.json`, not SQLite, so a restore can't rewind it. v1 → v2 migration adds `online` off |
| `deleteMyData` step `online_backups` | `apps/mobile/src/backup/data-domain-service.ts` | After the swap, before `coach_sign_in`'s Keychain wipe (§3.5; SEC §8) |
| Network state (`expo-network` or a few lines in the Swift module: `NWPathMonitor` `isExpensive`/`isConstrained`) | `apps/mobile` | Wi-Fi/cellular/Low Data Mode gate |

**`appProperties` per copy** (short keys, no personal content): `f=fizz-backup`, `fv` (format version), `sv` (schema version), `sha` (SHA-256), `n` (finished workouts), `d` (finished digest), `i` (install ID), `op` (operation ID), `enc=none`. **File name**: `fizz-backup-<UTC yyyymmddThhmmssZ>-<install ID first 8>.json`.

**Never** stored or logged: access token, refresh token, auth code, PKCE verifier, request headers. Error text shown or saved holds the status code and Google's `reason` only.

---

## 7. Acceptance checks

Setup and sign-in
- **OB1** A build without `FIZZ_GOOGLE_IOS_CLIENT_ID` shows no Google Drive section; App status says `Not in this build`.
- **OB2** `Sign in with Google` opens the system sheet (not a web view); after consent the token response's scope is checked; a token without `drive.appdata` is revoked and nothing is stored.
- **OB3** The requested scope is exactly `https://www.googleapis.com/auth/drive.appdata` (plus `openid email` only if OD5's fallback was taken). A source scan finds no other Google scope string.
- **OB4** Tokens are in Keychain service `fizz.google` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the key is in `KEYCHAIN_KEYS`; no token appears in SQLite, `backup-state.json`, crash notes, any backup or any log (search for the test token values).
- **OB5** The account row shows the signed-in Google address.

Uploads
- **OB6** Finishing a workout online: the summary and `Done` are never delayed (test with a 10 s network delay); the card reads `✓ Backed up to Google Drive · hh:mm` within 30 s on Wi-Fi.
- **OB7** The uploaded file is byte-identical to the newest on-phone backup (SHA-256 equal) and has the `appProperties` in §6.
- **OB8** No copy is marked backed up, and no rotation runs, until the size and checksum are verified (fake a mismatching `sha256Checksum`: state `Didn't save`, nothing deleted, the bad copy removed).
- **OB9** Airplane mode at Finish: on-phone backup succeeds; card shows `ⓘ Google Drive: waiting for internet`; turning the network on with the app open uploads it; nothing appears during the next workout.
- **OB10** `Use mobile data` off on cellular: `waiting for Wi-Fi`; joining Wi-Fi uploads it. Low Data Mode on: waits for Wi-Fi whatever the switch says.
- **OB11** Kill the app mid-upload: relaunch finishes with exactly one new file in the folder (same pre-allocated ID / op ID).
- **OB12** No upload starts while a workout is unfinished, from any trigger.
- **OB13** Backoff: after a 503, attempts at about 1, 5 and 30 min, then only at launch or foreground; `Back up now` ignores backoff.
- **OB14** Two workouts finished offline produce one upload (the newest backup) when back online.

Rotation
- **OB15** With 14 copies, a new verified upload deletes the oldest; never the one just uploaded, the one with the most finished workouts, or the newest from another install (unit tests on `planOnlineRotation` for each guard).
- **OB16** A phone with zero finished workouts never uploads anything.

States and failures
- **OB17** Revoking GymSmarter in the Google account → next attempt shows `⚠ Sign in to Google again` on the card and a marker on the Profile row; signing in clears it and uploads what's owed. Tokens are kept on network and 5xx errors.
- **OB18** A full Drive shows `⚠ Google Drive is full`; on-phone backups are unaffected.
- **OB19** No online-backup text ever appears on Today, the workout screens, rest, the summary, or as a banner or notification (string-placement test).
- **OB20** A Drive copy covering the current data suppresses the 30-day Files reminder and the §4.1a safeguards (OD10); a Drive copy older than the data does not.
- **OB21** Every status has icon + text; dates and counts are tabular; text ≥ 16pt; the section works at AX3; all rows ≥ 44pt.
- **OB22** No string says "sync", "synced", "uploaded" or "in the cloud" (string-table search); the only new durability phrase is `Backed up to Google Drive`.

Restore
- **OB23** New phone (fresh install): Welcome → `Restore from a backup` → `Sign in with Google` → list → preview (both sections ticked) → `Restore both` → Today with the restored data, no setup step. Under 3 minutes for a 412-workout backup on Wi-Fi.
- **OB24** `Undo restore` after a Drive restore brings back the phone's previous data (existing check 13).
- **OB25** A downloaded copy with a changed byte fails at the checksum with `Data unchanged`; the database file hash is unchanged.
- **OB26** The downloaded file is gone from `tmp` after success, failure and cancel.
- **OB27** Restore rows are disabled with an unfinished workout.
- **OB28** Signing in on a phone with fewer workouts than a copy from another install shows the `Google Drive has a backup from another phone` line once.

Sign out and delete (rule 10)
- **OB29** `Sign out, keep online backups`: token revoked online (or the offline note shown), Keychain item gone, copies still listed after signing in again.
- **OB30** `Delete online backups`: re-list shows the folder empty; switch is Off; on-phone and Files copies untouched.
- **OB31** `Delete my data` while online removes every online copy, then revokes, then wipes the Keychain; offline it keeps only the `fizz.google` item, shows `Deleting didn't finish (Google Drive backups)`, and `Finish deleting` online empties the folder then removes the token. The knowledge-only `after_delete` backup is never uploaded.
- **OB32** `Reset coaching knowledge` doesn't touch online copies; the next on-phone backup uploads as usual.
- **OB33** Coach and voice can't trigger any of these actions (tool registry has no such tool).

---

## 8. Questions for Ben

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Keep 14 online copies (fixed)? | 14 |
| Q2 | Online copies plain JSON (like Files), or add the opt-in recovery-key encryption as a later slice? | Plain, no encryption slice |
| Q3 | `Use mobile data` on by default? | On |
| Q4 | Delete my data also deletes the Google Drive copies (OD11)? | Yes |

## 9. Build slices

| # | Slice | Size | Depends on |
|---|---|---|---|
| 0 | **Spike build**: `customScheme` mode in `loopback-auth` (Swift), minimal `providers/google` (authorize, token, refresh, revoke, about, resumable upload, list, get, download, delete), Developer → `Google Drive backup test` with masked export. CI variable `FIZZ_GOOGLE_IOS_CLIENT_ID` read at prebuild | M | Ben's setup guide done |
| 1 | Device spike on Ben's iPhone (spike plan); PM records result, Ben approves the feature, ADR finalised, brief CHANGELOG | S | 0 |
| 2 | `providers/google` hardened: token vault `fizz.google`, shared `TokenRefresher`, typed Drive errors, `generateIds`, resumable resume/restart; unit tests with mocked fetch | M | 1 |
| 3 | `onlineBackupService`: manifest v2 + migration, owed logic, network/cellular/workout gates, triggers (after on-phone backup, launch, foreground, network return), backoff, verify-then-rotate, `planOnlineRotation`; `getBackupStatus.online` | L | 2 |
| 4 | Data & backup UI: Google Drive section, sign-in sheet (incl. "another phone" line), card line, Profile row marker, `Back up now`, `Use mobile data`, Sign out sheet, `Delete online backups`, App status row, OD10 safeguards | M | 3 |
| 5 | Restore from Google Drive: choose-screen group (all states), download to `tmp` + verify, existing preview/restore/Undo, Welcome path | M | 3 |
| 6 | Delete my data `online_backups` step, `Finish deleting`, offline and invalid-token paths; Delete screen line | S | 3 |
| 7 | Device acceptance run (OB checks on the phone, incl. new-phone restore by delete-and-reinstall), review | S | 4–6 |
| later | Opt-in encryption with recovery key (only if Q2 = yes) | M | 7 |
| later | BGTaskScheduler retries (needs OD4 revisited) | S | 7 |

Total about **M–L** (backlog says M; slice 3 is the bulk).

## 10. Proposed design-system additions (apply when approved)

- §7.1 durability table: add `Backed up to Google Drive · 19:06`, icon `arrow.up.doc`, `status.done`; Waiting states `info.circle` + `text.secondary`; failure states `exclamationmark.triangle` + `status.warning`. Keep the "never sync / uploaded / in the cloud" rule.
- `timing.onlineBackupRetry = [60 s, 300 s, 1800 s]`.
- `Files` replaces the `Off this phone (optional)` section heading when the Google Drive section is present.

## 11. Proposed brief changes (Ben approves)

1. Brief §5 Backup row: add "Optional automatic online copy to the owner's own Google Drive app-data folder (`drive.appdata`, no server). Backup only, never sync. Files export remains." (GD §9.1)
2. Brief §7 `createBackup(destination)`: the online destination uploads the existing on-phone snapshot file.
3. ADR 0023 / data-import-export §4.5: add step `online_backups` after the swap and before the Keychain wipe; the Google token alone may stay until online deletion finishes (SEC, proposed change 1).
4. CLAUDE.md "no cross-device sync": add "online backup with manual restore is not sync" so later work doesn't drift into merging (needs Ben; CLAUDE.md isn't edited by agents).
