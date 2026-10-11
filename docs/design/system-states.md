# System states (app-wide), app icon and launch screen

> **Revision 2026-10-08 (consolidation).**
> - **Backups in the app by default (approved by Ben, relayed by the product manager).** Automatic backups go to Fizz's own container; copies to Files are optional. Durability now has three phrases: `Saved on this phone` · `Backed up on this phone` · `Copy saved to Files` (§3.3, design-system §7.1). Today no longer shows "backups not set up" (old T4) or "not backed up for 24 h" (old T6); only a **failed** on-phone backup is a Today banner (T5). The quiet "no copy off this phone in 30 days" reminder is a Settings row only (data-import-export.md §3.1). One-tap `Save a copy to Files first` is offered at risky moments: the How-to-refresh sheet (§3.5) and the `Updated to build N` notice (§3.6) here, plus import and restore (data-import-export.md §4.1a). Nothing about backups ever appears during a workout.
> - **Two data domains** (approved by Ben): App status groups its first section as `Your data` and adds `Coaching knowledge` (design-system §7.2, `DomainLabel`).
> - **App status absorbs Profile's "Phone capabilities"** (profile-and-settings.md §2.10): rows follow the evidence rule (`Working` only with a dated check, probe or test) and the `StatusLabel` vocabulary (design-system §7.1).
> - Placeholder links replaced (profile-and-settings.md, ai-connection.md). Components merged into design-system (§11 index); `StatusRow` is §9.40.

Status: v0.1 draft, 8 Oct 2026. Designer. Tokens: [design-system.md](design-system.md).

This file is the single catalogue of states that aren't owned by one screen: connectivity, coach availability, saving and backup wording, errors, permissions, the 7-day signing expiry, new builds, data integrity and blocking operations. Screen specs show these states in their own layouts; the **wording, priority and surface** come from here. Where a screen spec already defines a string (coach-sheet.md, active-workout.md, today.md, onboarding.md), this file repeats it so there is one list to check, and the screen spec stays the owner of its layout.

Sources: CLAUDE.md rules 1, 5, 6, 7; brief §2, §3, §9; CHANGELOG v0.3 and v0.6; [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0005](../decisions/0005-persistence-and-backup.md), [ADR 0007](../decisions/0007-mobile-shell-identity-and-ipa-pipeline.md); research `free-ios-install.md` §4 and §8; `guides/sidestore-windows.md` §5–§6; [device test build 7](../device-tests/2026-10-08-probe-build7.md).

---

## 1. Purpose

System states answer: **"Is Fizz working, is my training safe, and do I need to do anything?"**

The answer is usually "yes, yes, no", and then the app says nothing. A state appears only when Ben can act on it or when hiding it would mislead him. **Logging never waits on a system state**, except the few blocking operations in §3.8, where writing would be unsafe.

The one dedicated screen here is **App status** (Profile → App status). It has no primary button: each row carries its own action. Everything else is a surface rule.

---

## 2. Layout: surfaces and rules

### 2.1 Surfaces, from quietest to loudest

| # | Surface | Used for | Component |
|---|---|---|---|
| S1 | **Inline at the control** | The state of one feature where it's used: Talk caption `Offline`, `Adjust` caption `Coach offline`, a disabled Send | Existing components (`TalkButton`, `AdjustControl`) |
| S2 | **App status row** | Every current state, always, in one place | `StatusRow` (proposed) |
| S3 | **Profile row marker** | Something in Profile needs attention | Icon + short text on the row, never a dot alone |
| S4 | **StatusBanner** | Today (max 2), the active workout's banner slot (max 2, restricted list), the coach sheet (max 1) | `StatusBanner` (design-system §9.12) |
| S5 | **Local notification** | Only rest/work ends (lock-screen-and-alerts.md) and the signing reminder (§3.5) | — |
| S6 | **Blocking cover** | Only when writing would be unsafe: restore, rollback, delete, database update, data from a newer build, data can't be opened | `BlockingCover` (data-import-export.md) |

Never used for status: system alerts (kept for confirming destructive actions), sheets that open by themselves, toasts for problems that need action (toasts are for completed actions, usually with Undo), and anything full-screen between sets.

### 2.2 Priority

**Today** shows at most two banners, highest priority first. The rest are on App status, and Profile shows a marker.

| Priority | State | Severity |
|---|---|---|
| T1 | Data can't be opened, or data is from a newer build (main card replaced, §3.8) | Blocking |
| T2 | Damaged record found (§3.7) | Warning |
| T3 | Signing runs out within 24 h (§3.5) | Warning |
| T4 | (Removed in consolidation: backups need no setup) | — |
| T5 | Last backup **on this phone** didn't save (e.g. storage full) | Warning |
| T6 | (Removed in consolidation: no "not backed up" nagging; the 30-day off-phone reminder is a Settings row only) | — |
| T7 | Signing runs out within 72 h | Info |
| T8 | No gym selected (today.md) | Info |
| T9 | One-time notices: updated to a new build, restore interrupted, import paused | Info (one launch only) |

**Active workout** banner slot (active-workout.md §2, region 3) may show only: write error, data damage affecting this workout, paused, restored after force-close, the coach being offline **while Ben is using it**, and equipment warnings. **Never shown during a workout:** signing expiry, backups, new builds, permissions, Live Activity or other alert-layer status. These wait until Today.

**Coach sheet** shows at most one banner: the coach state (§3.2).

### 2.3 Wording rules

| # | Rule | Example |
|---|---|---|
| W1 | Say what happened, plainly | `The folder can't be reached.` |
| W2 | Say what still works, especially logging | `Logging and built-in targets still work.` |
| W3 | Claim data is safe only when that's guaranteed by construction (a rolled-back transaction, an untouched file) or checked | `Couldn't X.` already says nothing happened; a data-at-risk failure (database won't open, restore or migration fails) adds `Data unchanged` (minimal-copy audit §1 rule 1); never "everything's fine" after an unknown error |
| W4 | At most one action, named for what it does | [Open Settings], [Back up now], not [OK] |
| W5 | No blame, no "Oops", no exclamation marks | — |
| W6 | Exact dates, times and counts with tabular numerals. If a value is estimated, say "about" | `Signed until Sun 11 Oct, 09:00` / `about Thu 15 Oct` |
| W7 | Never colour alone: icon + text always | `⚠ Last backup on this phone didn't save` |
| W8 | Never say "sync", "synced", "uploaded" or "in the cloud", or a bare "Backed up". Fizz has no sync | `Saved on this phone` / `Backed up on this phone` / `Copy saved to Files` |

### 2.4 Wireframes

Today with two banners (T3 and T5) above the normal content:

```
┌────────────────────────────────────────┐
│ Thu 8 Oct                [⌂ Main Gym ▾]│
│ ┌────────────────────────────────────┐ │
│ │ ⚠ Refresh Fizz in SideStore today, │ │ StatusBanner, warning
│ │   by 21:00                    How ›│ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ⚠ Last backup on this phone didn't │ │
│ │   save: this iPhone is out of      │ │
│ │   space.                  Details ›│ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ Today's plan                       │ │ main card unchanged;
│ │ Push A                             │ │ Start stays the only
│ │ …                                  │ │ primary button
│ │ [         Start workout          ] │ │
│ └────────────────────────────────────┘ │
```

App status (Profile → App status):

```
┌────────────────────────────────────────┐
│ ‹ Profile        App status            │
├────────────────────────────────────────┤
│ 👤 Your data                           │ DomainLabel
│ ✓ Saved on this phone                  │ StatusRow
│   415 workouts · 4,140 sets            │
│ ✓ Backed up on this phone · 19:05    › │ → Data & backup
│ ⓘ No copy off this phone yet         › │ or: ✓ Copy saved to Files · 8 Oct
│ ✓ Last full check: no problems         │
│   Thu 8 Oct                    Check › │
│                                        │
│ 📚 Coaching knowledge                  │ DomainLabel
│ ✓ 9 rules approved · 5 to review     › │ → Guides & playbook
│ ✓ Exercise list: built-in (build 12)   │ or: "+ 3 custom exercises"
│                                        │
│ This install                           │
│ ✓ Signed until Sun 11 Oct, 09:00     › │ → How to refresh
│   Refresh weekly in SideStore          │
│ ✓ Fizz 0.3 · build 12                  │
│   Installed Thu 8 Oct                  │
│ Signing tool                SideStore ›│
│                                        │
│ Coach and voice                        │
│ ⚠ Coach: no connection                 │
│   Using ChatGPT plan when online     › │ → ai-connection.md
│ ✓ Speech: on this phone (English, UK)  │
│ ✓ Spoken cues: Apple voice             │
│                                        │
│ Rest alerts                            │ evidence lines from
│ ✓ Notifications: Working             › │ profile-and-settings §2.10
│   Tested 8 Oct, build 7                │
│ – Time-sensitive: Not available        │
│   Needs paid Apple signing.            │
│ ⚠ Lock Screen timer: Not working     › │ → detail (cause, instead,
│   Checked 8 Oct, build 7               │   Check again)
│ ? Loud rest alerts: Not tested       › │
│ – Speak while locked: Not in this build│
│                                        │
│ Run phone checks                     › │ → capability probe screen
│                                        │
│ Permissions                            │
│ ✓ Notifications                        │
│ ⚠ Microphone: off in iOS Settings      │
│                           Open Settings│
│ – Speech recognition: not asked yet    │
│                                        │
│ Copy status report                     │ accent text button
└────────────────────────────────────────┘
```

`Copy status report` copies a plain-text report (like the probe's `formatReport`): app version and build, installed and configured bundle IDs, signing expiry and its source, each row's state, and timestamps in UTC with the time zone. **No tokens, keys, Apple ID or workout content.**

Blocking cover (shape defined in data-import-export.md as `BlockingCover`), database update example:

```
┌────────────────────────────────────────┐
│                                        │
│        Updating your data for          │
│        build 13                        │
│                                        │
│     … Updating (step 1 of 2)           │ one step per migration
│                                        │
│     Keep Fizz open. If it closes, the  │
│     update carries on next time.       │
│                                        │
└────────────────────────────────────────┘
```

---

## 3. States catalogue

Each row: how it's detected, where it shows (S1–S6 from §2.1), exact copy, the action, and when it clears.

### 3.1 Connectivity

| State | Detected by | Surfaces | Copy | Action | Clears |
|---|---|---|---|---|---|
| Offline | `getConnectivity()` (system network path) | S1 only: Talk `Offline`, `Adjust` `Coach offline`, coach sheet banner, summary coach note, workout builder. **No banner on Today or in the workout**: logging needs no network | Coach sheet: `No connection. The coach needs the internet. Your workout is saved on this phone.` · Summary: `Coach note will be added when you're back online.` · App status: `⚠ Coach: no connection` | None | Network returns (banners clear by themselves; nothing queued is sent on its own, coach-sheet.md CS4) |
| Offline, OpenAI voice selected | Same, while the OpenAI voice route is chosen for coach replies | Voice strip, once per workout; Voice settings | `OpenAI voice isn't available offline. Using the Apple voice.` | None | Network returns |
| Offline, copy saved to iCloud Drive | Same, after a copy to Files is written | Data & backup card | `iCloud uploads it when you're back online.` | None | Network returns |

### 3.2 Coach and AI route

Owned by [coach-sheet.md](coach-sheet.md) §3 and [ai-connection.md](ai-connection.md) §3; repeated here as the single list. Source: `getAiCapabilities(userId).unavailableReason`.

| State | Talk caption (S1) | Coach sheet banner (S4) | App status (S2) | Rules |
|---|---|---|---|---|
| Not connected | `Offline` (`text.bubble` + slash) | `Coach not connected. Logging, targets and rest timers work without it.` [Connect] | `– Coach: not connected` [Connect ›] | No canned replies (rule 1) |
| Offline | `Offline` | `No connection. The coach needs the internet. Your workout is saved on this phone.` | `⚠ Coach: no connection` | — |
| Limit reached (ChatGPT plan) | `Offline` | `ChatGPT usage limit reached. The coach is paused.` [Manage usage] · `Logging and built-in targets still work.` · if an API key exists: `Switch coach to your API key (paid) ›` | `⚠ Coach: ChatGPT usage limit reached` | Never switches route on its own (rule 7). No guessed reset time |
| API spend cap reached | `Offline` | `Paused: you've reached your $5.00 cap for October.` [Change cap] | `⚠ Coach: monthly cap reached` | Cap and spend come from Fizz's own records (ai-connection.md) |
| API key out of credit / rejected | `Offline` | `Your OpenAI API key was rejected (<reason from OpenAI>).` [Check key] | `⚠ Coach: API key rejected` | — |
| Signed out / expired / revoked | `Offline` | `ChatGPT disconnected. Sign in again to use the coach.` [Sign in] | `⚠ Coach: signed out` [Sign in ›] | Old threads stay readable |
| Account not eligible | `Offline` | `This ChatGPT account can't be used by other apps.` [Options] | `⚠ Coach: this account can't be used` | — |
| Model unavailable | `Offline` | `The model you chose isn't available any more.` [Choose model] | `⚠ Coach: model unavailable` | Never picks another model silently |
| Timed out / provider error | unchanged | Per turn: `The coach didn't answer in time. Nothing changed.` / `Couldn't reach the coach. Nothing changed.` [Try again] | unchanged | Nothing applied |
| OpenAI voice failed (key, credit) | unchanged | Voice strip, once per workout: `OpenAI voice isn't available (<reason>). Using the Apple voice.` | `⚠ Spoken replies: Apple voice (OpenAI voice unavailable)` | Never switches to a paid route; falls back to the free one and says so (CHANGELOG v0.6) |
| Voice input unavailable (see §3.4) | `Ask` (`text.bubble`) | — | see §3.4 | Text still works |

### 3.3 Saving and durability wording

The durability ladder. These are the only words used for "where is my data".

| Level | Meaning | Words | Where |
|---|---|---|---|
| Draft | Typed, not logged; kept through a force-close | `Unsaved edit restored` (caption) | Active workout |
| Saving | The SQLite write is in progress (rarely visible) | `Saving…` | Log button |
| Saved | Committed to SQLite on the phone | `Saved` (1 s button guard) · toast `✓ Set 2 saved · 100 kg × 8` · banner `Workout saved on this phone` · status `Saved on this phone` | Active workout, summary, App status |
| Backed up on this phone | Included in an automatic backup file in Fizz's own container. Lost if the app is deleted or re-signed with another Apple ID | `Backed up on this phone · 19:05` | Data & backup, summary line (X2), Profile row, App status |
| Copy saved to Files | Included in a backup file outside the app (Files, iCloud Drive, another provider) | `Copy saved to Files · Thu 8 Oct` | Data & backup, Profile row, App status |
| Waiting for the network | Coach work that will run when online (never a write of Ben's data) | `Coach note will be added when you're back online.` | Summary |

Spoken:
- After a voice or tap commit: "Logged 100 kilos for 8." Only after the commit (brief §3).
- A failed voice log: "Couldn't save that set. It's still on screen."
- Never "saved on your phone; sync pending" (brief §3): there is no sync (§6, P-S1).

### 3.4 Permissions

Each permission is asked in context, with priming first (onboarding.md §4.6). This table covers what happens after.

| Permission / capability | State | Inline (S1) | App status (S2) | Action |
|---|---|---|---|---|
| Notifications | Not asked | First rest: `Alert when rest ends?` [Allow] [Not now] (rest-state.md) | `– Notifications: not asked yet` | [Allow] |
| | Denied | Voice & alerts: `Rest alerts are off in iOS Settings.` | `⚠ Notifications: off in iOS Settings` | [Open Settings] |
| | Sounds off for Fizz | Voice & alerts Alert check | `⚠ Notifications: sounds off for Fizz` | [Open Settings] |
| Microphone | Denied | Talk shows `Ask`; voice strip: `Voice isn't available: microphone is off in iOS Settings` [Settings] (active-workout.md §2.5) | `⚠ Microphone: off in iOS Settings` | [Open Settings] |
| Speech recognition | Denied | Talk shows `Ask`; voice strip: `Voice isn't available: speech recognition is off in iOS Settings` [Settings] | `⚠ Speech recognition: off in iOS Settings` | [Open Settings] |
| On-device speech | Not available for the device language | Talk shows `Ask`; voice strip (voice.md §3.1, owner): `Voice isn't available: speech recognition for English (UK) isn't on this iPhone yet.` [Settings] | `⚠ Speech: not available on this phone for English (UK)` | None. Fizz never sends audio to a server instead (brief v0.2) |
| Live Activities | Off for Fizz in iOS Settings | — | `⚠ Lock Screen timer: Live Activities are off for Fizz in iOS Settings` | [Open Settings] |
| Live Activity (not a permission) | App Group renamed by the signing tool (build 7) | — | `⚠ Lock Screen timer: not working on this install` (lock-screen-and-alerts.md §3.1) | None for Ben; a developer fix (ADR 0007) |
| Loud rest alerts (AlarmKit) | Denied | Switch shows Off with `Turned off in iOS Settings` (onboarding.md) | `⚠ Loud rest alerts: off in iOS Settings` | [Open Settings] |
| Backup folder (only when `Also back up off the phone automatically` is on) | Access lost | Data & backup card (data-import-export.md §3.1) | `⚠ Copy to Files didn't save: the folder can't be reached` | [Choose backup folder] |

Permission rows never appear as banners on Today or in the workout. The feature that needs the permission shows its off state where Ben uses it.

### 3.5 Signing expiry and refresh (free Apple ID, 7 days)

Fizz reads its own signing profile expiry from `embedded.mobileprovision` (the probe already does: `profileExpiresUtc`) at launch and on every return to the foreground. When SideStore refreshes Fizz, the next foreground read picks up the new date and the banners clear.

**Which day to name.** Banners name the **last day Ben can comfortably refresh**: the expiry day if the expiry is at 20:00 or later, otherwise the day before. The exact time is always in the How sheet and App status. Example: expiry Sun 11 Oct 09:00 → `by Sat`.

| Time left | Today (S4) | Notification (S5) | App status (S2) |
|---|---|---|---|
| More than 72 h | Nothing | Scheduled for 19:00 local, two days before the expiry (one per signing period) | `✓ Signed until Sun 11 Oct, 09:00` / `Refresh weekly in SideStore` |
| 72–24 h | Info banner `Refresh Fizz in SideStore by Sat` [How ›] | (fires as scheduled) | `⚠ Signed until Sun 11 Oct, 09:00` |
| Under 24 h | Warning banner `Refresh Fizz in SideStore today, by 21:00` or `… by tomorrow 09:00` [How ›] | — | same, warning |
| Expired | Fizz can't open; nothing can be shown. The reminders above exist so this doesn't happen | — | — |
| Unknown (no profile in the bundle, or unreadable) | Nothing until Ben records a refresh | None | `– Signing date unknown. Refresh weekly in SideStore.` [I refreshed today] |
| Estimated (Ben tapped `I refreshed today`) | Same ladder, with `about`: `Refresh Fizz in SideStore by about Wed` | Same | `Signed until about Thu 15 Oct (estimated from your refresh on 8 Oct)` |

Notification copy: title `Refresh Fizz by Sat`, body `Fizz stops opening on Sun at 09:00 until it's refreshed. Open SideStore on Wi-Fi with LocalDevVPN on.` If Ben refreshes without opening Fizz, this reminder can still arrive, because Fizz only learns the new date when it next opens. The How sheet says so.

How to refresh sheet (from the banner, the notification or App status), steps from `guides/sidestore-windows.md` §5:

```
┌────────────────────────────────────────┐
│ Refresh Fizz                      Done │
│ Signed until Sun 11 Oct, 09:00         │
│                                        │
│ 1  Connect to Wi-Fi.                   │
│ 2  Open LocalDevVPN and tap Connect.   │
│ 3  Open SideStore and go to My Apps.   │
│ 4  Tap the days counter on SideStore,  │
│    then on Fizz.                       │
│ 5  Open Fizz once so it sees the new   │
│    date.                               │
│                                        │
│ If you miss it, Fizz won't open until  │
│ you refresh. Your workouts stay on the │
│ phone. Never delete Fizz to fix it.    │
│                                        │
│ ⓘ Reinstalling with a different Apple  │ safeguard (data-import-export
│ ID or tool starts an empty app.        │ §4.1a); only when there's no
│ [ Save a copy to Files first ]         │ newer copy in Files
│                                        │
│ If you've refreshed but haven't opened │
│ Fizz since, a reminder may still come. │
└────────────────────────────────────────┘
```

With `Signing tool: Sideloadly` (App status), the banner reads `Refresh Fizz with Sideloadly by Sat` and the steps say: `1 Turn on your laptop and connect it to the same Wi-Fi. 2 Open Sideloadly and refresh Fizz. 3 Open Fizz once so it sees the new date.`

**Workouts and expiry.** No expiry banner or interruption appears during a workout. A running app keeps running past expiry, but if it's closed it can't reopen (research §4). That's why the under-24 h banner sits on Today, where Ben sees it before he taps Start.

### 3.6 Builds and updates

| State | Detected by | Surface | Copy | Action |
|---|---|---|---|---|
| Updated to a new build | `buildNumber` differs from the one stored at the last launch | Today info banner, **one launch only** (T9) | `Updated to build 13. Your data carried over: 415 workouts.` (count read from the database). When there's no copy in Files newer than the update, the banner adds `Save a copy to Files?` (safeguard, data-import-export.md §4.1a) | [Save a copy to Files] (optional) |
| Updated, and the database was migrated | Same, plus a migration ran | Same | `Updated to build 13. Your data was updated and carried over: 415 workouts.` | None |
| Database update in progress | Migration takes more than 1 s (`timing.coverDelay`) | S6 cover (§2.4) | `Updating your data for build 13` · `Updating (step 1 of 2)` · `Keep Fizz open. If it closes, the update carries on next time.` | None |
| Database update failed | Migration error. Each migration is one transaction (ADR 0005), so the failed step is undone, but earlier steps in the same update stay applied. Installing the previous build may then hit "data from a newer build" | S6 cover | `This build couldn't finish updating your data.` · `Each step either finished or was undone, so nothing is half-changed. Send the details to the developer; a fixed build is needed.` | [Copy details] |
| Data from a newer build | `SchemaTooNewError` (an older build installed over a newer one) | S6 cover; nothing is written | `Your data was saved by a newer Fizz (build 15). This build (12) can't open it.` · `Install build 15 or newer in SideStore. Nothing has been changed.` | [Copy details] |
| New build available | **Needs an update feed that doesn't exist yet** (`DEP-UPDATE-FEED`, §6 P-S3). Until then, no state | App status only | `Build 14 is ready to install (you have 13).` | [How to install ›] |

How to install sheet (when a feed exists): `1 Save a copy to Files first.` [Save a copy to Files] · `2 Download the .ipa.` · `3 In SideStore, go to My Apps, tap +, choose the file. Keep the App ID it suggests.` · `4 Don't delete Fizz first. The update installs over it and keeps your data.` · `5 Open Fizz. It will say "Updated to build 14".` Never shown during a workout.

### 3.7 Data integrity

Detected when a record fails validation on read (`CorruptDataError`), when `createBackup` returns an integrity report with problems, or when Ben runs `Check all data` (`checkIntegrity`). Fizz never repairs, guesses or skips a damaged record on its own (ADR 0005).

| State | Surface | Copy | Actions |
|---|---|---|---|
| Damaged record in history | Today warning banner (T2); App status | `Fizz found a damaged record (workout on Tue 6 Oct).` | [Details ›] |
| Details screen | Pushed from the banner or App status | `What's damaged:` list (`Workout · Tue 6 Oct · Push A`) · `Fizz won't change or guess damaged records. Your other workouts open normally and you can keep logging.` · `Backups that restore without this damage:` (from `verifyBackup`, newest first) | [Check all data] · [Restore from a backup] · [Copy details] |
| Damage in the unfinished workout | Active workout content replaced by a card; same on Today | `This workout's saved data is damaged, so Fizz can't open it safely.` | [Restore from a backup] · [Copy details] |
| Backup includes damage | Data & backup card (data-import-export.md §3.1) | `Backup saved, but it can't be restored. It includes 1 damaged record (workout on Tue 6 Oct). Your newest good backup: Sun 4 Oct.` | [Details] |
| Check all data, clean | App status row | `✓ Last full check: no problems · Thu 8 Oct` | — |
| Check all data, problems | App status row → Details | `⚠ Last full check: 2 damaged records` | [Details ›] |
| Data can't be opened | Today main card (today.md), Progress (progress.md); App status | `Couldn't open your training data.` | [Try again] · [Restore from a backup] · `Switch back to your previous data` (only when a rollback target exists) · [Copy details] |

"Your other workouts open normally" appears only when `checkIntegrity` has run since the damage was found and reported nothing else (W3); otherwise the line reads `Fizz is checking the rest of your data…` until it has.

### 3.8 Errors

| State | Surface | Copy | Action |
|---|---|---|---|
| Set didn't save | Active workout banner (active-workout.md) | `Set not saved. Try again.` | [Try again] (same operation ID) |
| Finish didn't save | Active workout banner (workout-summary.md) | `Couldn't finish. Try again.` | [Try again] |
| Storage full | Where the write failed | `This iPhone is out of space, so Fizz can't save. Your entry is still here. Free up some space, then try again.` | [Try again] |
| A command failed and rolled back | Where it was tapped (inline line or toast-free row) | `Couldn't <action>: <short reason>.` e.g. `Couldn't delete set 1: it changed since you opened it.` | One relevant action |
| Out of date (version conflict) | Card or row (design-system §9.11) | `Out of date. Your workout changed since this was suggested.` | [Dismiss] |
| Undo rejected | Toast (active-workout.md §4.9) | `Can't undo: set 2 changed` | — |
| Screen error (render crash) | Replaces that screen only | `Something went wrong on this screen. Saved workouts aren't affected.` | [Go to Today] · [Copy details] |
| Restore interrupted | Today info banner, one launch (T9) | `Restore didn't finish · data unchanged` | — |
| Import paused | Today info banner, one launch (T9) | `FitNotes import paused at 180 of 412 workouts.` | [Continue ›] |

"Saved workouts aren't affected" on the screen-error state is true by construction: screens never write to SQLite directly; every write goes through a service in one transaction.

### 3.9 Blocking operations

Only these block logging. Each uses `BlockingCover`; none can be dismissed; each tells Ben what happens if Fizz closes.

| Operation | Title | Close-safety line | Owner |
|---|---|---|---|
| Restore | `Restoring your data` | `Keep Fizz open.` | data-import-export.md |
| Undo restore | `Switching back to your previous data` | same | data-import-export.md |
| Delete all data | `Deleting your data…` | `If Fizz closes, it finishes deleting when it next opens.` | data-import-export.md |
| Database update | `Updating your data for build 13` | `Keep Fizz open. If it closes, the update carries on next time.` | here (§3.6) |
| Data from a newer build | (static, §3.6) | — | here |

While a cover is up: notification taps and `fizz://` links are held and dropped if they no longer apply after the operation; no rest alerts or Live Activity updates are scheduled; voice is stopped.

---

## 4. Interactions

- **Banners** are tappable as a whole (`target.min`), and the trailing action is a text button with its own hit area. Info banners for one-time notices (T9) can be dismissed with an `xmark` (44 × 44); warnings can't be dismissed, they clear when the cause is fixed.
- **[Open Settings]** opens Fizz's page in iOS Settings (`Linking.openSettings()`). On return, the state is re-read at once.
- **[Copy details]** copies the status report (§2.4) plus the specific error, and shows the toast `Copied. Nothing personal is included.` (no workout content, tokens or Apple ID).
- **[I refreshed today]** (unknown expiry only) asks `Did you refresh Fizz in SideStore today?` [Yes] [Cancel], then records an estimate of 7 days, always labelled `about`.
- **Signing tool** row: `SideStore` / `Sideloadly`. Changes only the wording of refresh instructions.
- **Voice:** no system state is spoken, except the failed-log line in §3.3 and the coach's own spoken status when Ben asks it something while it can't answer: "The coach isn't available right now. Your set is saved." (only in Conversation mode, only as the reply to Ben's own question).
- **Undo:** nothing on these surfaces changes training data. Restore and import have their own Undo (data-import-export.md).

---

## 5. Copy (master list)

| Area | Strings |
|---|---|
| Durability | `Unsaved edit restored` · `Saving…` · `Saved` · `✓ Set 2 saved · 100 kg × 8` · `Workout saved on this phone` · `Saved on this phone` · `Backed up on this phone · 19:05` · `Copy saved to Files · Thu 8 Oct` · `No copy off this phone yet` · `Coach note will be added when you're back online.` |
| Offline | `No connection. The coach needs the internet. Your workout is saved on this phone.` · `OpenAI voice isn't available offline. Using the Apple voice.` · `iCloud uploads it when you're back online.` |
| Coach | as §3.2 (owned by coach-sheet.md) |
| Permissions | `Rest alerts are off in iOS Settings.` · `Voice isn't available: microphone is off in iOS Settings` · `Voice isn't available: speech recognition is off in iOS Settings` · `Voice isn't available: speech recognition for English (UK) isn't on this iPhone yet.` · `Lock Screen timer: Live Activities are off for Fizz in iOS Settings` · `Turned off in iOS Settings` · `Open Settings` |
| Signing | `Refresh Fizz in SideStore by Sat` · `Refresh Fizz in SideStore today, by 21:00` · `Refresh Fizz in SideStore by tomorrow 09:00` · `Signed until Sun 11 Oct, 09:00` · `Refresh weekly in SideStore` · `Signing date unknown. Refresh weekly in SideStore.` · `I refreshed today` · `Signed until about Thu 15 Oct (estimated from your refresh on 8 Oct)` · notification `Refresh Fizz by Sat` / `Fizz stops opening on Sun at 09:00 until it's refreshed. Open SideStore on Wi-Fi with LocalDevVPN on.` · How sheet §3.5 |
| Builds | `Updated to build 13. Your data carried over: 415 workouts.` · `Updating your data for build 13` · `Updating (step 1 of 2)` · `Keep Fizz open. If it closes, the update carries on next time.` · `This build couldn't finish updating your data.` · `Each step either finished or was undone, so nothing is half-changed. Send the details to the developer; a fixed build is needed.` · `Your data was saved by a newer Fizz (build 15). This build (12) can't open it.` · `Install build 15 or newer in SideStore. Nothing has been changed.` · `Build 14 is ready to install (you have 13).` |
| Integrity | `Fizz found a damaged record (workout on Tue 6 Oct).` · `Fizz won't change or guess damaged records. Your other workouts open normally and you can keep logging.` · `Fizz is checking the rest of your data…` · `This workout's saved data is damaged, so Fizz can't open it safely.` · `Check all data` · `✓ Last full check: no problems` · `Switch back to your previous data` |
| Errors | §3.8 |
| Backups (Today) | Only: `Last backup on this phone didn't save: this iPhone is out of space.` [Details ›] (T5). The earlier "not set up", "needs a folder" and "not backed up" banners are removed (consolidation) |
| Data domains | `Your data` · `Coaching knowledge` |
| App status | `App status` · section heads `Your data` · `This install` · `Coach and voice` · `Rest alerts` · `Permissions` · `Copy status report` · toast `Copied. Nothing personal is included.` |
| Spoken | "Couldn't save that set. It's still on screen." · "The coach isn't available right now. Your set is saved." |

---

## 6. App icon and launch screen

### 6.1 App icon

**Direction: a weight plate with three rising bubbles.** The plate says strength training; the bubbles say "Fizz". It's simple, original, and built only from design-system colours.

```
┌──────────────────────────┐
│                     ●    │  bubble, 6% of width
│                 ●        │  bubble, 8%
│            ●             │  bubble, 12%
│     ╭────────────╮       │
│   ╭─╯  ╭──────╮  ╰─╮     │  plate: a thick ring,
│   │    │      │    │     │  face-on
│   ╰─╮  ╰──────╯  ╭─╯     │
│     ╰────────────╯       │
└──────────────────────────┘
```

| Property | Value |
|---|---|
| Canvas | 1024 × 1024, full bleed (iOS applies the corner mask), `color.bg.canvas` dark `#0F1620` |
| Plate | A ring in `color.accent` dark `#5AA9FF`: outer diameter 58% of the width, ring width 15%, centred at 44% across and 58% down |
| Bubbles | Three solid `#5AA9FF` circles of 12%, 8% and 6% diameter, rising up and to the right from the ring's top-right edge at about 50°, 4% gaps |
| Never | Text or letters, gradients, gloss, shadows, a dumbbell silhouette, outlines thinner than 6% (they vanish at 29pt) |
| iOS dark icon | Transparent background, mark in `#5AA9FF` |
| iOS tinted icon | Transparent background, mark in white (the system tints it) |
| iOS 26 layered (Liquid Glass) | If the toolchain supports Icon Composer files: background layer = canvas; foreground layer = ring and bubbles. The icon must still read with every system effect off |
| Contrast | Accent on canvas ≈ 7.4:1 (design-system §2) |
| Name under the icon | `Fizz` (`APP_NAME`, ADR 0007) |

Before adopting: view it at 60, 40 and 29pt on Ben's Home Screen next to SideStore, LocalDevVPN and his other fitness apps, and confirm it doesn't resemble any of them. If the smallest bubble disappears at 29pt, that's acceptable; don't draw a separate small icon.

### 6.2 Launch screen

| Property | Value |
|---|---|
| Background | `color.bg.canvas`: `#0F1620` (dark) / `#F5F7FA` (light), following the system appearance |
| Mark | The ring and bubbles only, 96pt wide, centred; `#5AA9FF` (dark) / `#0A63C9` (light) |
| Never | Text, a spinner, a progress bar, an animation, a tagline |
| Hide | As soon as the first screen is ready: Active workout (P6), Today, or onboarding. No minimum display time. The fade out is at most `timing.fast` and removed under Reduce Motion |
| Slow start | If start-up work (database update) takes longer than `timing.coverDelay` (1 s), the launch screen is replaced by the `BlockingCover` for that operation, so Ben sees why |

Expo config (developer note): `splash.backgroundColor` and `splash.dark.backgroundColor`, with a separate light and dark mark image.

---

## 7. Data needed

From existing contracts:
- `getAiCapabilities(userId)` with an `unavailableReason` for §3.2.
- `getActiveSession(userId)`; `DatabaseManager` open results and `checkIntegrity()` (ADR 0005).
- `getBackupStatus(ownerId)`, `verifyBackup(file)` (data-import-export.md).
- `getRestAlertCapabilities()` (lock-screen-and-alerts.md).

**Proposed new functions:**

| Function | Purpose |
|---|---|
| `buildSystemStatus(input, now)` → ordered `SystemState[]` of `{id, severity: 'info' \| 'warning' \| 'blocking', surfaces[], copyKey, params, action?}` | A **pure** function (no React Native imports, like `probe/model.ts`) that applies §2.2 priority and §2.3 wording. Screens render its output and never decide priority themselves. Unit-tested on Linux |
| `getInstallStatus()` → `{profileExpiresUtc \| null, expirySource: 'profile' \| 'estimate' \| 'unknown', installedBundleId, configuredBundleId, appVersion, buildNumber, previousBuildNumber, signingTool, liveActivityInBuild, backgroundAudioInBuild, appGroup: 'match' \| 'renamed' \| 'missing' \| 'unknown'}` | Reuses the `embedded.mobileprovision` reader in `audio-coach` and the probe's App Group check |
| `getConnectivity()` / `onConnectivityChange(cb)` | Network path state for §3.1 |
| `getPermissionStatus(kind)` for `notifications`, `microphone`, `speech`, `onDeviceSpeech(locale)`, `liveActivities`, `alarmKit` | One wrapper; re-read on return to the foreground |
| `DatabaseManager.open()` → `ok \| migrated{fromVersion} \| migrating \| schema_too_new{build} \| open_failed{reason} \| restore_interrupted \| delete_pending` | Drives §3.6–§3.9 at launch |
| `scheduleRefreshReminder(expiryUtc)` | One local notification per signing period (§3.5) |
| `buildStatusReport()` | Plain-text report for `Copy status report` / `Copy details`; no secrets, no workout content |

---

## 8. Acceptance checks

1. With airplane mode on, Today and the active workout show **no** banner; Talk reads `Offline`; the coach sheet shows the `No connection…` banner; App status shows `⚠ Coach: no connection`. Logging a full workout works.
2. With four Today-level states active at once (e.g. T2, T5, T7, T8), Today shows exactly the two highest (T2, T5); all four are on App status; the Profile row shows its marker.
2a. With no copy ever saved to Files, Today, the workout and Profile's attention area show **no** backup banner; the only off-phone signals are the Data & backup card line, the Profile row line and, after 30 days, the quiet reminder line.
3. During a workout, none of these ever appear: signing expiry, backup states, new build, permission states, Live Activity status. Verified by setting each condition mid-workout.
4. With a signing profile expiring in 60 h, Today shows `Refresh Fizz in SideStore by <day>` using the day rule in §3.5; at 20 h the banner is a warning with the time. After a SideStore refresh, returning to Fizz clears it without a relaunch.
5. Exactly one refresh notification is scheduled per signing period, at 19:00 local two days before expiry, and it's rescheduled from the new date after a refresh.
6. With no readable profile, no date is shown; after `I refreshed today`, every date reads `about`.
7. Installing a new build over the old one shows `Updated to build N. Your data carried over: <count> workouts.` once, with the real count.
8. Installing an older build over a newer database shows the newer-build cover, and the database file is byte-identical afterwards.
9. A forced failure in the second of two migrations shows the update-failed cover; the database is at the first migration's version (`user_version`), the failed step left no partial change, and `checkIntegrity` passes.
10. A database update over 1 s shows the `Updating your data…` cover instead of a long launch screen; under 1 s, nothing extra appears.
11. A record corrupted in a test build triggers the T2 banner and the details screen; nothing is repaired or hidden automatically; `Check all data` reports it; `Copy details` contains no workout content.
12. Denying the microphone: Talk shows `Ask`, the strip explains with [Settings], App status shows the row with [Open Settings], and nothing else in the workout changes.
13. Hitting the ChatGPT usage limit with an API key saved: no request goes to the API-key route until Ben taps `Switch coach to your API key (paid)` and confirms (provider log) (rule 7).
14. No string in the app contains "sync", "synced", "uploaded" or "in the cloud" (string-table search).
15. Every state in this file renders with an icon and text; none relies on colour alone; all text is at least 16pt by default and works at AX3.
16. While any `BlockingCover` is up, a notification tap or `fizz://` link doesn't open a workout or write anything.
17. `Copy status report` contains the build, bundle IDs, signing expiry and each row's state, and contains no token, API key, Apple ID or workout values.
18. The launch screen matches the system appearance, shows only the mark, and is gone as soon as the first screen is ready (no minimum time).
19. The app icon, dark icon and tinted icon render correctly on the Home Screen, and the mark is recognisable at 40pt.

---

## 9. Proposed changes (for Ben / the product manager)

| # | Change | Reason |
|---|---|---|
| P-S1 | Brief §3: replace "Say 'saved on your phone; sync pending' when appropriate" with "Say 'Saved on this phone' only after the local commit; 'Backed up' only when a backup file includes it." | There is no sync (CLAUDE.md scope). "Sync pending" would promise something that never happens |
| P-S2 | Add `buildSystemStatus` as the one place for state priority and wording | Keeps nine screens from each deciding what to show |
| P-S3 | `DEP-UPDATE-FEED`: decide whether "new build available" is worth a small public manifest (for example a release JSON in a separate public repo, with no personal data). Until then, the app shows only the post-update confirmation | The repo is private, so the app can't see new builds without a token on the phone |
| P-S4 | Add the signing tool as a setting (SideStore / Sideloadly) | The pairing research (`sidestore-pairing-ios26.md`) recommends Sideloadly as the fallback; refresh wording differs |
| P-S5 | Open question for the developer: with a damaged unfinished workout, the one-active-session index (ADR 0005) blocks starting a new one. Is a "set aside this workout" command needed, or is restore the only path? | Ben could otherwise be unable to train until he restores |

---

## Proposed design-system additions

> **Merged into design-system.md (consolidation):** `StatusRow` §9.40, `StatusBanner` severities §9.12, state icons §9.52, `timing.expiryNotice` / `expiryUrgent` / `expiryReminder` / `coverDelay` §6, icon and launch tokens §2.2. Kept below for history.

No new colours.

| Addition | Spec |
|---|---|
| `StatusRow` | ≥ 52pt row on `bg.surface`: icon (`checkmark.circle.fill` `status.done` · `exclamationmark.triangle` `status.warning` · `minus.circle` `text.secondary` for not set up / off · `info.circle` `text.secondary`), title `type.body`, optional detail `type.callout` `text.secondary`, optional trailing text button (`accent`, ≥ 44 × 44) or `chevron.right`. Used by App status and Voice & alerts' Alert check |
| `StatusBanner` severities | `info` (`info.circle`, `bg.surface` with 1pt `border.control`), `warning` (`exclamationmark.triangle`, `status.warning.subtle`), `danger` (`exclamationmark.octagon`, `status.danger.subtle`; only for writes that failed). Add the priority list in §2.2 and the "never during a workout" list to §9.12 |
| State icons | Offline `wifi.slash` · signing `clock.badge.exclamationmark` · build updated `arrow.down.app` · damaged record `exclamationmark.octagon` · backup states as in data-import-export.md · permission off `slash.circle` |
| `timing.expiryNotice` | 72 h before signing expiry: info banner |
| `timing.expiryUrgent` | 24 h before signing expiry: warning banner with time |
| `timing.expiryReminder` | One notification at 19:00 local, two days before expiry |
| `timing.coverDelay` | 1 s. A start-up operation shorter than this shows no cover |
| App icon and launch | §6 values as named tokens: `icon.canvas` = `color.bg.canvas` (dark), `icon.mark` = `color.accent` (dark); `launch.bg` = `color.bg.canvas`, `launch.mark` = `color.accent` (per appearance); mark proportions as in §6.1 |

## Cross-links

- [coach-sheet.md](coach-sheet.md) §3 and [ai-connection.md](ai-connection.md) §3: owners of the coach states repeated in §3.2.
- [today.md](today.md): banners and the `Couldn't open your training data.` card (T1, T8); P6 auto-open after the launch screen.
- [active-workout.md](active-workout.md): banner slot rules (§2.2 here restricts what may appear), write errors, voice strip permission lines.
- [onboarding.md](onboarding.md) §4.6: permission priming; backup step.
- [data-import-export.md](data-import-export.md): backup states, `BlockingCover`, restore and delete operations, `verifyBackup`.
- [lock-screen-and-alerts.md](lock-screen-and-alerts.md): alert-layer capability states, Alert check, `StatusRow` reuse.
- [workout-summary.md](workout-summary.md) and [progress.md](progress.md): durability wording and the database-error state.
- [profile-and-settings.md](profile-and-settings.md) §2.1, §2.10: hosts the `App status` row (which absorbed Phone capabilities) and the attention rows.
- [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0005](../decisions/0005-persistence-and-backup.md), [ADR 0007](../decisions/0007-mobile-shell-identity-and-ipa-pipeline.md), [guides/sidestore-windows.md](../guides/sidestore-windows.md), [device test build 7](../device-tests/2026-10-08-probe-build7.md).
