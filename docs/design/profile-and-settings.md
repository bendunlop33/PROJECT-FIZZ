# Profile and settings

> **Revision 2026-10-08 (consolidation).** This file is now the **hub** that places rows; the screens behind several rows are owned by other specs, and duplicated definitions here were removed in their favour:
> - **Pain flags** (§2.3): one list, owned by [coach-memory.md](coach-memory.md) §2.1/§2.6/§2.7 (clearing always asks for confirmation, then offers Undo). Profile → Training → `Pain flags` opens it directly.
> - **Coach reply voice and API keys** (§2.6.2): owned by [ai-connection.md](ai-connection.md) §2.7–§2.9. The separate key sheet here is withdrawn. Canonical calls: `saveApiKey(purpose, key \| {sameAs: 'text'}, capUsd, opId)`, `removeApiKey(purpose)`, `getPersonalUsageSummary(purpose, month)` (replacing `setProviderCredential` / `checkProviderCredential` / `removeProviderCredential`). One Keychain item per distinct key: `Use the same key as text` stores no second copy (this keeps PS3's intent).
> - **Voice & alerts** (§2.6) is regrouped: cue modes (rest-state.md §5), `Talking` (voice.md §2.5), voices, volume, vibration, and `When rest ends` + `Alert check` + `Test rest alert` (lock-screen-and-alerts.md §2.5). `Loud alerts (AlarmKit)` is now `Loud rest alerts` with modes `Off` / `Long rests only (2:00 or more)` / `Every rest`. Settings calls are `getVoiceSettings()` / `saveVoiceSettings(patch, opId)` (voice.md's `setVoicePreferences` folds into it).
> - **Phone capabilities** (§2.10) is merged into **App status** ([system-states.md](system-states.md) §2.4), which adopts this file's evidence rule (`Working` only with a dated source) and `StatusLabel` vocabulary (design-system §7.1). `getInstallInfo()` → `getInstallStatus()`; `runRestAlertTest()` is the one test call.
> - **Attention rows** (§2.1) are `StatusBanner`s chosen by `buildSystemStatus` with the same priority as Today (system-states.md §2.2); signing uses its 72 h / 24 h thresholds.
> - **Data** (§2.8): one `Data & backup` row (data-import-export.md X3). Backups are in the app by default; off-phone copies are optional and never nag (approved by Ben, relayed by the product manager). Data is shown as two domains, **Your data** and **Coaching knowledge** (design-system §7.2).
> - **Coach** section gains `Guides & playbook` ([coaching-playbook.md](coaching-playbook.md)); `What the coach remembers` opens [coach-memory.md](coach-memory.md).
> - A `ResumeBar` (design-system §9.29) sits above the tab bar here while a workout is unfinished (progress.md PG5).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** New Training row **`Check-in`** and screen (§2.4a) for [check-in.md](check-in.md): on/off, every workout or selected days, the "What's up?" threshold (default 3 or lower), the coach-offer threshold (default 2 or lower, or `Never`) and `Also when I pick Tired or Poor sleep`. Saves on change (`saveCheckInSettings`). The coach can't change these (§4.3). Changed: §2.1, §2.4a (new), §4.2, §4.3, §5, §6, check 19.

Status: v0.1 draft, 8 Oct 2026. Tokens: [design-system.md](design-system.md). Gyms: [gym-editor.md](gym-editor.md). First-run values: [onboarding.md](onboarding.md). Coach connection, keys, usage and reply voice: [ai-connection.md](ai-connection.md). Memory and pain flags: [coach-memory.md](coach-memory.md). Backup, restore, import, export, delete and reset: [data-import-export.md](data-import-export.md). Rest-alert layers: [lock-screen-and-alerts.md](lock-screen-and-alerts.md). App status: [system-states.md](system-states.md). This file places their entry rows and status lines.

## 1. Purpose

Profile answers **"How is the app set up for me, and is anything not working?"**

It sits outside the logging loop (brief §12 Page 7), so speed matters less here than honesty and findability. It has **no `PrimaryButton`**. When something needs Ben's attention (no backup, signing about to lapse, rest alerts off), it appears as an attention row at the top, and that row is the main call to action.

Rules that shape every screen here:
- **Settings save as soon as they change** (iOS Settings convention). The exceptions are the API key sheet and anything destructive, which have an explicit button.
- **Status is evidence-based.** A capability reads `Working` only when there's a check or a test result behind it, with its date. Otherwise it reads `Not tested` (CLAUDE.md rules 1 and 6).
- **No paid route switches on by itself** (rule 7). The OpenAI voice is opt-in, shows what it costs and falls back to Apple's voice, saying so.
- **The coach can't change anything on this tab** except what Ben could already say in a workout (cue mode). Credentials, spend limits, permissions, thresholds, pain-flag clearing and data deletion are tap-only.

## 2. Layout

Profile is the third tab. It's an iOS grouped list on `bg.canvas`, with `SettingsRow`s on `bg.surface`. Section headers use `type.label` in `text.secondary`, sentence case. The `Ask` pill floats bottom-trailing (design-system §9.8) with a content inset so it never covers the last row.

### 2.1 Profile (root)

```
┌────────────────────────────────────────┐
│ Profile                                │ type.title2
│ ┌────────────────────────────────────┐ │
│ │ (!) Refresh Fizz in SideStore by   │ │ attention rows (0–2),
│ │     Sat                     How › │ │ StatusBanner (system-states)
│ └────────────────────────────────────┘ │
│ Training                               │
│ ┌────────────────────────────────────┐ │
│ │ Goals & schedule                 › │ │
│ │ Strength · Mon Wed Fri · 60 min    │ │
│ │ Pain flags                       › │ │
│ │ 1 active: Bench press              │ │
│ │ Logging                          › │ │
│ │ kg · RPE after the set             │ │
│ │ Check-in                         › │ │ §2.4a (2026-10-09)
│ │ Every workout · asks what's up at  │ │
│ │ 3 or lower                         │ │
│ │ Rest presets                     › │ │
│ │ 1:00 · 1:30 · 3:00                 │ │
│ └────────────────────────────────────┘ │
│ Gyms                                   │
│ ┌────────────────────────────────────┐ │
│ │ ⌂ Main gym                       › │ │ rows defined in gym-editor §2.1
│ │   Default · 6 items · 3 not checked│ │
│ │ ⌂ Home                           › │ │
│ │ + Add gym                          │ │
│ └────────────────────────────────────┘ │
│ Voice & alerts                         │
│ ┌────────────────────────────────────┐ │
│ │ Voice & alerts                   › │ │
│ │ Set cues · Apple voice             │ │
│ └────────────────────────────────────┘ │
│ Coach                                  │
│ ┌────────────────────────────────────┐ │
│ │ Coach connection                 › │ │ → ai-connection.md
│ │ Not connected                      │ │
│ │ Coach offers                     › │ │ §2.7 here
│ │ On · effort 9.5 · 2 reps short     │ │
│ │ What the coach remembers         › │ │ → coach-memory.md
│ │ 7 confirmed · 2 waiting            │ │
│ │ Guides & playbook                › │ │ → coaching-playbook.md
│ │ 9 rules approved · 5 to review     │ │
│ └────────────────────────────────────┘ │
│ Data                                   │
│ ┌────────────────────────────────────┐ │
│ │ Data & backup                    › │ │ → data-import-export.md
│ │ Backed up on this phone · 19:05    │ │
│ │ Copy saved to Files · 8 Oct        │ │ or: No copy off this phone yet
│ └────────────────────────────────────┘ │
│ App                                    │
│ ┌────────────────────────────────────┐ │
│ │ Appearance               System  › │ │
│ │ App status                       › │ │ → system-states.md §2.4
│ │ 1 not working · 2 not tested       │ │
│ │ About this build                 › │ │
│ │ 0.1.0 (7) · signed until 15 Oct    │ │
│ └────────────────────────────────────┘ │
│                            ( Ask )     │
├────────────────────────────────────────┤
│ ▶ Push A · Rest 1:12        [Resume]   │ ResumeBar, only while a workout is unfinished
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
└────────────────────────────────────────┘
```

Attention rows (revised, consolidation): up to two `StatusBanner`s at the top, chosen by `buildSystemStatus` with the **same priority list as Today** (system-states.md §2.2: data can't be opened, damaged record, signing within 24 h, last on-phone backup didn't save, signing within 72 h, no gym). Notifications denied is shown in App status and Voice & alerts, not here. **Off-phone backup is never an attention row.** The quiet 30-day "no copy off this phone" reminder appears only as a second line on the `Data & backup` row (`ⓘ No copy off this phone since 8 Sep`), dismissible from Data & backup, and can be switched off there.

### 2.2 Goals & schedule

```
┌────────────────────────────────────────┐
│ ‹ Profile      Goals & schedule        │
├────────────────────────────────────────┤
│ Goals                                  │
│ Main focus            Strength       › │
│   Set in setup, 8 Oct                  │ ProvenanceTag
│ Also matters          Endurance      › │
│ Specific goal         HYROX in March › │
│ Lifting regularly     1–3 years      › │
│                                        │
│ Week                                   │
│ Training days         Mon Wed Fri    › │
│ Usual session length  60 min         › │
│                                        │
│ Work around                            │
│ Notes                 Left shoulder, › │
│                       no overhead…     │
│ Pain flags            1 active       › │ → §2.3
│                                        │
│ The coach reads these. It can suggest  │ text.secondary
│ changes in chat, but they only appear  │
│ here after you confirm them.           │
└────────────────────────────────────────┘
```

- Each value opens the same control as onboarding §2.7 (chips, chip grid or text field). Unset values read `Not set` in `text.secondary`.
- Every goal row has a `ProvenanceTag`: `Set in setup, 8 Oct`, `Changed by you, 12 Oct`, or `From coach chat, 14 Oct · you confirmed`. Nothing appears here unconfirmed (brief §8 `saveConfirmedMemory`: "don't silently infer lasting goals").

### 2.3 Pain flags

> **Consolidation:** the canonical Pain flags list, add sheet and clear confirmation are in [coach-memory.md](coach-memory.md) §2.1 (Pain flags section), §2.6 and §2.7. `Profile → Training → Pain flags` opens that same list on its own. The wireframe below is kept for reference only; where it differs (an inline `Clear` with no confirmation), coach-memory.md wins: `Clear…` → confirmation → toast with Undo.

```
┌────────────────────────────────────────┐
│ ‹ Profile      Pain flags              │
├────────────────────────────────────────┤
│ Loads don't go up on these movements   │
│ until you clear them. This isn't a     │
│ diagnosis.                             │
│ ┌────────────────────────────────────┐ │
│ │ (!) Bench press                    │ │ exclamationmark.triangle, warning
│ │     "Left shoulder" · since 8 Oct  │ │
│ │                          [ Clear ] │ │ 44pt text button
│ └────────────────────────────────────┘ │
│ + Flag a movement                      │
└────────────────────────────────────────┘
```

Empty: `No pain flags. Flag a movement here, or tap Pain in a workout.`

### 2.4 Logging

```
┌────────────────────────────────────────┐
│ ‹ Profile      Logging                 │
├────────────────────────────────────────┤
│ Weights in            [ kg | lb ]      │
│ Used for new equipment. Existing       │
│ equipment and past sets keep their     │
│ unit and are never converted.          │
│                                        │
│ Effort                [RPE|RIR| Off ]  │
│ Ask for effort        [ After | Before]│ hidden when Off
│ After the set is the default: it never │
│ delays logging or rest.                │
│                                        │
│ Timed sets                             │
│ Auto-save timed sets          [ Off ]  │
│ When a work timer ends, save the       │ copy from active-workout §2.7
│ planned time as done. You can undo.    │
└────────────────────────────────────────┘
```

### 2.4a Check-in (revision 2026-10-09)

Owned by [check-in.md](check-in.md) §2.8 (wireframe, rules and copy); placed here as a Training row. Rows: switch `Ask how I'm feeling before a workout` (default on) with `One tap before you start. Skip any time.`; `When` radio `Every workout` (default) / `Only on these days` + weekday `ParamChip`s; `Ask "What's up?" when I pick` radio `4 or lower` / `3 or lower` (default) / `2 or lower` / `1 only` / `Never`; `Coach offers a lighter session when I pick` radio `3 or lower` / `2 or lower` (default) / `1 only` / `Never`; switch `Also when I pick Tired or Poor sleep` (default on); explainer `The coach only offers. Nothing changes until you tap Adjust. Without the coach, your check-in is saved and your plan stays the same.`; footer `Check-ins are part of your data. Fizz never turns them into a score.` With the switch off, the other rows are hidden. Root row subtitle: `Every workout · asks what's up at 3 or lower` / `Mon, Wed, Fri · asks what's up at 3 or lower` / `Off`.

### 2.5 Rest presets

```
┌────────────────────────────────────────┐
│ ‹ Profile      Rest presets            │
├────────────────────────────────────────┤
│ Starting points, not advice. Changes   │
│ apply from your next workout.          │
│ ┌────────────────────────────────────┐ │
│ │ Warm-up                    1:00  › │ │
│ │ Standard (default)         1:30  › │ │
│ │ Heavy                      3:00  › │ │
│ │ + Add preset                       │ │
│ └────────────────────────────────────┘ │
│ Default rest          Standard       › │ used when nothing else applies
│                                        │
│ Rest is chosen in this order: the      │ text.secondary, rest-state §4.2
│ set's own setting, the routine's       │
│ preset for that set type, the          │
│ exercise's default, then this default. │
└────────────────────────────────────────┘
```

Tapping a preset opens a small editor: `Name` field and the rest wheel (rest-state.md §2.4, 15 s steps), `Delete preset` (danger text) at the bottom. The default preset can't be deleted until another is the default.

### 2.6 Voice & alerts

One long screen in six groups (revised, consolidation). Every row is at least 52pt; switches use the system control. Each group's **content** is owned by the spec named on its header; this screen only orders them.

```
┌────────────────────────────────────────┐
│ ‹ Profile      Voice & alerts          │
├────────────────────────────────────────┤
│ During workouts        (rest-state §5) │
│ ( ) Quiet                              │
│     Screen, vibration and alert sound. │
│ (•) Set cues                           │
│     Short spoken prompts. No AI, no    │
│     microphone.                        │
│ ( ) Conversation                       │
│     Set cues plus tap-to-talk with the │
│     coach.  (!) Coach not connected  › │ disabled + link when no route
│ Heads-up at 15 seconds left    [ Off ] │
│ Announce each set before you start [ ]│
│ Speak through phone speaker when       │
│ no headphones                  [ Off ] │
│                                        │
│ Talking                  (voice §2.5)  │
│ Talk button      Tap to start        › │ / Hold to talk
│ Use iPhone mic with headphones [ On ]  │
│ Say "done" to log shown values [ Off ] │
│ Listen during rest (mic on in rest) [ ]│ Conversation only
│ Recognition language English (UK)    › │ on-device list
│ Allow Apple's servers if this iPhone   │
│ can't recognise speech itself  [ Off ] │
│ Speak replies to questions I ask by    │
│ voice                          [ On ]  │
│                                        │
│ Voices                                 │
│ Set cues          Serena (Premium)   › │ → §2.6.1
│ Coach replies     Apple voice        › │ → ai-connection §2.8
│ Speaking rate     [Slower|Normal|Faster]│
│ Play a sample                          │ speaks a sample cue now
│                                        │
│ Volume and sound                       │
│ Voice volume      ──────●───  80%      │ relative to media volume
│ Lower music during cues        [ On ]  │
│ Timer sound (Quiet mode)       [ On ]  │
│                                        │
│ Vibration                              │
│ Set saved                      [ On ]  │ haptic.commit
│ Rest ended                     [ On ]  │ haptic.restEnd
│ Steppers and keypad            [ On ]  │ haptic.step
│ Undo                           [ On ]  │ haptic.undo
│                                        │
│ When rest ends   (lock-screen §2.5)    │
│ Notification                     On  › │
│ Loud rest alerts                 Off › │ Off / Long rests only / Every rest
│ Speak while locked (experiment)  Off › │ only in builds that support it
│ Show rest end time on the Lock Screen  │ only when the Live Activity
│                                [ Off ] │ is unavailable
│ Alert check                            │ StatusRows
│ ✓ Notifications allowed, with sound    │
│ ⚠ Lock Screen timer: not working on  › │ → App status detail
│   this install                         │
│ Test rest alert                      › │
└────────────────────────────────────────┘
```

- The cue-mode block is the same list and copy as the `VoiceModePill` menu (rest-state.md §5). Changing it in either place changes both.
- `Talking` follows voice.md §2.5. `Recognition language` lists the locales the phone supports, with `On this phone` or `Needs internet` after each. The default is the phone's locale. The build 7 probe found the recogniser on **en-US** while Ben is in the UK, so when the phone's region and the recognition language differ, the row shows `Your region is UK. English (UK) may recognise you better.` [Use English (UK)].
- `Say "done" to log shown values` has the explanation `Saying "done" or "log it" saves the values on the Log button. Only works when exactly one set is active.` (active-workout.md §4.1).
- `When rest ends`, `Alert check` and `Test rest alert` follow lock-screen-and-alerts.md §2.5 and §3.1, including `Loud rest alerts` (priming sheet from onboarding.md §4.6, then the system prompt; threshold default `timing.loudModeMinRest`, 2:00) and the test (`runRestAlertTest()`, `Lock your phone now.`, `Did the alert arrive?` [Yes] [No]). Each answer is saved as that layer's evidence with the date and build and shown in App status.

#### 2.6.1 Apple voice picker

```
┌────────────────────────────────────────┐
│ ‹ Voice & alerts   Set cue voice       │
├────────────────────────────────────────┤
│ Personal Voice                         │
│   Ben                            [▶] ○ │ only if one exists and is allowed
│ English (UK)                           │
│   Serena · Premium               [▶] ● │ ▶ = sample, 44 × 44
│   Daniel · Enhanced              [▶] ○ │
│   Daniel · Standard              [▶] ○ │
│ Other English                          │
│   …                                    │
│                                        │
│ Premium and Enhanced voices sound more │ text.secondary
│ natural. Download them in iOS Settings │
│ under Accessibility. The app can't     │
│ download voices itself.                │
└────────────────────────────────────────┘
```

- Voices come from the audio-coach module (ADR 0007: production speech goes through `audio-coach.speak()`), grouped by quality as iOS reports it. Voice names here are examples; the list is whatever the phone has.
- `Personal Voice` appears only when iOS reports one. Choosing it the first time shows the priming line, then the system prompt. If none exists: `No Personal Voice on this phone. You can create one in iOS Settings → Accessibility → Personal Voice.`
- Samples speak `Logged 100 kilos for 8. Rest 2 minutes.` at the current volume and rate.
- If the chosen voice is later deleted from the phone, cues use the system default and the row reads `Serena (not on this phone) · using default`.

#### 2.6.2 Coach reply voice (OpenAI opt-in)

> **Consolidation: withdrawn in favour of [ai-connection.md](ai-connection.md) §2.8 (Coach voice) and §2.9 (usage and spend).** `Voices → Coach replies` opens that screen. The two specs agreed on the substance (opt-in, Apple fallback that's announced, never another paid route, key in the Keychain and not in backups, an in-app monthly cap labelled as an estimate); ai-connection's version is canonical because it also covers the text route, separate caps per purpose and `Use the same key as text`. The wireframes below are kept for history only.

```
┌────────────────────────────────────────┐
│ ‹ Voice & alerts   Coach reply voice   │
├────────────────────────────────────────┤
│ (•) Same as set cues (Apple)           │
│     Free. Works offline.               │
│ ( ) OpenAI voice                       │
│     Paid by your OpenAI API key, not   │
│     your ChatGPT plan.                 │
│                                        │
│ ─ shown once OpenAI voice is chosen ─  │
│ API key            sk-…a1b2          › │ → key sheet
│ Voice              <name>            › │ list from packages/providers
│ Play a sample (one paid request)       │
│                                        │
│ Spending                               │
│ This month         $0.42 · 31 replies  │ tabular
│ Recorded by this app from OpenAI's     │ text.secondary
│ usage figures. Your OpenAI bill is the │
│ final amount.                          │
│ Monthly limit in this app              │
│                    $5.00             › │ optional; "None" by default
│ Also set a hard limit on OpenAI's      │
│ website (Limits page).                 │
│                                        │
│ If OpenAI can't be reached, is out of  │
│ credit or the key fails, replies use   │
│ the Apple voice and the app tells you. │
│ It never switches to another paid      │
│ service.                               │
│                                        │
│ Status     ✓ Key checked 8 Oct         │ StatusLabel
└────────────────────────────────────────┘
```

**API key sheet** (medium detent):

```
┌────────────────────────────────────────┐
│ OpenAI API key                  Cancel │
│ ┌────────────────────────────────────┐ │
│ │ sk-••••••••••••••••••••••••        │ │ secure field, paste allowed
│ └────────────────────────────────────┘ │
│ Stored in this phone's Keychain. It    │
│ isn't included in backups, so add it   │
│ again after a restore.                 │
│ Create a key and set a spend limit on  │
│ OpenAI's website first.                │
├────────────────────────────────────────┤
│ [            Save and check          ] │ PrimaryButton, above keyboard
│ Remove key                             │ danger text, only when a key exists
└────────────────────────────────────────┘
```

- `Save and check` stores the key, then makes one free check request (listing models). Results: `✓ Key works.` / `OpenAI rejected this key.` (key not saved) / `Couldn't check the key: no connection. It's saved; it'll be checked before first use.`
- After saving, only the last four characters are ever shown.
- **One key, one Keychain item.** (Consolidation: realised by ai-connection.md's `Use the same key as text`.) If ai-connection.md also offers a personal OpenAI key for text, it must use the same Keychain item. Ben shouldn't enter one key twice, and removing it must say what stops working: `Remove the key? OpenAI voice stops, and so does the coach if it uses this key.`

### 2.7 Coach

- **Coach connection ›** opens [ai-connection.md](ai-connection.md) §2.1/§2.6. The row shows `getAiCapabilities` status only: `Not connected`, `ChatGPT plan · text`, `API key · text`, `Paused: usage limit reached`, `No connection right now`, or `Not available in this build yet`.
- **What the coach remembers ›** opens the Memory list in [coach-memory.md](coach-memory.md) §2.1 (Your data only: memories hold personal facts; general training rules go to the playbook).
- **Guides & playbook ›** opens [coaching-playbook.md](coaching-playbook.md) (Coaching knowledge; Ben's guide files are Your data).
- **Coach offers ›** (this spec; behaviour from coach-adjustments.md §4.7):

```
┌────────────────────────────────────────┐
│ ‹ Profile      Coach offers            │
├────────────────────────────────────────┤
│ Offer to adjust after a hard  [ On ]   │
│ or easy set                            │
│ The coach only offers. Nothing changes │
│ until you tap Adjust.                  │
│                                        │
│ Offer when effort is at least          │
│                 [−]  RPE 9.5  [+]      │ 8.5–10, step 0.5
│ Offer when reps are short by           │
│                 [−]   2 reps  [+]      │ 1–5
│ Offer when effort is at most           │
│                 [−]  RPE 6    [+]      │ 5–7.5, step 0.5
│                                        │
│ Reset to defaults                      │
│                                        │
│ (!) Coach not connected. Offers start  │ only when no route
│ once it is.                            │
└────────────────────────────────────────┘
```

With effort set to RIR, the effort rows read `Offer when RIR is at most [0]` (0–1) and `Offer when RIR is at least [4+]` (3–4+), matching the rest card's chips. With effort `Off`, those two rows are hidden and only the reps row remains. Warm-up and drop sets never trigger offers (coach-adjustments.md §4.2).

### 2.8 Data (revised, consolidation)

One row, `Data & backup`, opening [data-import-export.md](data-import-export.md) §2.1 (X3). Its two status lines come from `getBackupStatus` and always use the three durability phrases (design-system §7.1):
- line 1, on this phone: `Backed up on this phone · 19:05` / `Saved on this phone` (before the first workout) / `⚠ Last backup on this phone didn't save` / `ⓘ Automatic backups are off`;
- line 2, off this phone: `Copy saved to Files · 8 Oct` / `No copy off this phone yet` / quiet reminder `ⓘ No copy off this phone since 8 Sep` (after 30 days, only if the reminder is on).

Behind the row, the hub groups everything by the two data domains (`Your data`, `Coaching knowledge`): backups (two sections, independent restore), export (`My data` / `Coaching knowledge only`), and `Delete my data (keep coaching knowledge)` / `Reset coaching knowledge`. Profile adds no data actions of its own.

### 2.9 Appearance

`System` / `Dark` / `Light` (design-system §2). Applies immediately, including to an open workout.

### 2.10 Phone capabilities → App status

> **Consolidation: merged into App status** ([system-states.md](system-states.md) §2.4). The Profile row is `App status`. What this section adds there: the evidence rule (`Working` only with a dated check, probe or test result; otherwise `Not tested`), the `StatusLabel` vocabulary (design-system §7.1; `Not working` uses `exclamationmark.triangle`), per-row detail screens (what it does, evidence, likely cause, what happens instead, one action) and `Run phone checks`. The wireframe below shows that content, now as App status sections.

```
┌────────────────────────────────────────┐
│ ‹ Profile      Phone capabilities      │
├────────────────────────────────────────┤
│ What works on this phone and install.  │
│ Logging and rest timers never depend   │
│ on any of these.                       │
│                                        │
│ Rest alerts                            │
│ Notification       ✓ Working         › │
│   Tested 8 Oct, build 7                │
│ Time-sensitive     – Not available     │
│   Needs paid Apple signing.            │
│ Lock-screen        ✕ Not working     › │
│ countdown            Checked 8 Oct,    │
│                      build 7           │
│ Loud alerts        ? Not tested      › │
│ (AlarmKit)           Available on iOS  │
│                      26; not set up    │
│ Voice                                  │
│ Spoken cues        ✓ Working           │
│ Lower music        ✓ Working           │
│ Spoken cues while  – Not in this build │
│ locked                                 │
│ Speech recognition ✓ Working ·       › │
│                      English (US)      │
│ Data and security                      │
│ Saved on this phone ✓ Working          │
│ Keychain           ✓ Working           │
│ Health data        – Not in this build │
│                                        │
│ Run phone checks                     › │ → capability probe screen
└────────────────────────────────────────┘
```

Status vocabulary (`StatusLabel`, icon + word, never colour alone):

| Status | Icon | Colour | Meaning |
|---|---|---|---|
| `Working` | `checkmark.circle.fill` | `status.done` | A runtime check passed, or a probe/test passed on this install. The source line gives date and build |
| `Not working` | `exclamationmark.triangle` (consolidation; was `xmark.octagon`) | `status.warning` | A check or test failed on this install. The detail explains the likely cause and the fallback |
| `Not tested` | `questionmark.circle` | `text.secondary` | Supported by iOS, but no test on this install yet |
| `Not available` / `Not in this build` | `minus.circle` | `text.secondary` | Free signing or this build doesn't include it (ADR 0004, ADR 0007) |
| `Off` | `circle` | `text.secondary` | Ben turned it off, or iOS permission is off. The row links to the fix |

Detail screens (tap `›`) show: what it does, the evidence (`Probe: failed 8 Oct, build 7`), the likely cause in plain words, what the app does instead, and one action. For the lock-screen countdown on build 7:

> **Lock-screen countdown: not working**
> The signing tool renamed the app's shared storage group, so the lock-screen countdown can't read the rest timer (likely cause; ADR 0007).
> Instead: the rest-end notification still arrives.
> [Check again]

`Check again` starts a 10 s test countdown and asks `Did you see a countdown on the lock screen?` [Yes] [No], as in §2.6.

### 2.11 About this build

```
┌────────────────────────────────────────┐
│ ‹ Profile      About this build        │
├────────────────────────────────────────┤
│ Version           0.1.0 (build 7)      │ tabular
│ Built             8 Oct 2026 · a1b2c3d │
│ Installed with    SideStore            │
│ App ID            com.projectfizz.fizz │
│                   .<TEAMID>            │
│ Signed until      Thu 15 Oct (7 days)  │
│ If signing lapses, the app won't open  │
│ until you refresh it in SideStore.     │
│ Your data stays on the phone.          │
│                                        │
│ Database          Version 1 · 1.2 MB   │
│                                        │
│ Privacy                                │
│ Your data is stored only on this phone │
│ and in copies you save to Files.       │
│ The coach sends the context it needs   │
│ to the service you connected. Audio    │
│ isn't saved.                           │
│                                        │
│ Copy diagnostics                       │ no keys, no workout data
│ Licences                             › │
└────────────────────────────────────────┘
```

`Signed until` comes from the installed provisioning profile. If it can't be read: `Signed until: unknown`. `Installed with` reads `SideStore` only when the install carries SideStore's markers; otherwise `Unknown`.

## 3. States

### 3.1 Root

| State | Trigger | Display |
|---|---|---|
| Loading | First render; all reads are local | Static grey rows after 300 ms, no shimmer |
| Normal | — | §2.1 |
| Fresh setup with skips | Onboarding skipped the gym | Gyms section `No gym yet. Loads won't be checked against equipment.` + `Add gym`; Data row `Saved on this phone` (no warning: backups start after the first workout) |
| Attention | Any §2.1 attention condition | Up to two rows, highest priority first |
| Workout in progress | Unfinished session | Unchanged list. Changes apply as in §4.2. The Data & backup screens show their own guard (data-import-export.md DX4: restore and import wait until the workout is finished) |
| Offline | No network | Only rows that need the network change: coach connection `No connection right now`; OpenAI voice status `No connection. Replies use the Apple voice.` No banner |
| AI unavailable | `getAiCapabilities` reports no text route | `Coach connection: Not connected`; `Conversation` disabled with `Coach not connected ›`; coach offers note. Everything else unchanged |
| Database error | SQLite read fails | `Couldn't open your training data.` [Try again] [Restore from backup] (same as today.md §3). App rows (Appearance, App status, About) still work |

### 3.2 Voice and alerts

| State | Display |
|---|---|
| Set cues working | Normal |
| Spoken cues failing (TTS error) | Mode row: `(!) Spoken cues aren't working on this phone. Using vibration and sound instead.` (rest-state.md §5) |
| No headphones, speaker option off | Mode row subtitle `Cues · no headphones` while a workout runs |
| Chosen voice missing | `Serena (not on this phone) · using default` |
| Notifications not asked | `Notification  Not set up` [Allow] (shows the priming line from rest-state.md, then the system prompt) |
| Notifications denied | `Notification  Off in iOS Settings` [Open Settings] |
| Loud alerts denied | Switch off; `Turned off in iOS Settings` [Open Settings] |
| Test alert waiting | `Test alert in 0:07. Lock your phone now.` (tabular, counts from a stored deadline) [Cancel test] |
| Test result | `✓ Arrived` or `✕ Didn't arrive`, saved with date and build |

### 3.3 OpenAI coach voice

> Consolidation: canonical states are ai-connection.md §3.3; the table below agrees with it and is kept for reference. Fallback strip wording is voice.md §3.2 (`Using Apple voice: <reason>`).

| State | Status line | Replies use |
|---|---|---|
| Not chosen | — | Apple |
| Chosen, no key | `Add your API key to use OpenAI voice.` [Add key] | Apple |
| Checking key | `Checking the key…` (static icon) | Apple |
| Key works | `✓ Key checked 8 Oct` | OpenAI |
| Key rejected | `(!) OpenAI rejected the key. Using Apple voice.` [Update key] | Apple |
| No connection | `No connection. Using Apple voice.` | Apple |
| Out of credit (OpenAI reports it) | `(!) OpenAI says the account is out of credit. Using Apple voice.` | Apple |
| App limit reached | `(!) This month's limit in the app ($5.00) is reached. Using Apple voice until 1 Nov.` [Change limit] | Apple |
| Usage not reported | Spending line `$0.42 · 31 replies (2 replies had no usage figures)` | — |

The fallback is per reply and automatic **only towards the free Apple voice**. It never moves to another paid route. The workout's voice strip (active-workout.md §2.5) says once per workout, `OpenAI voice unavailable. Using Apple voice.` when a fallback happens.

### 3.4 Transitions

- Profile root → any row → pushed detail; `‹` returns with the root's status lines refreshed.
- Coach connection → ai-connection.md; What the coach remembers / Pain flags → coach-memory.md; Guides & playbook → coaching-playbook.md; Data & backup → data-import-export.md; App status → system-states.md. Returning lands on Profile with fresh status.
- Gyms → gym-editor.md.
- An attention row's action → the owning screen → back to Profile with the row gone once the cause is fixed.

## 4. Interactions

### 4.1 Saving and undo
- Switches, segmented controls, radio lists and steppers save on change with an operation ID (`saveUserProfile`, `saveVoiceSettings`, `saveCoachTriggerThresholds`). Toggling back is the undo; no toast.
- Destructive or bulk actions have an Undo toast or a confirmation:
  - `Reset to defaults` (coach offers): toast `Offer settings reset.` [Undo].
  - Clearing a pain flag: `Clear…` → confirmation → toast `Pain flag cleared for Bench press` [Undo] (coach-memory.md §2.7; clearing is always explicit by Ben).
  - Deleting a rest preset: toast [Undo].
  - Removing an API key: confirmation alert in ai-connection.md §4. No Undo: the key is gone from the Keychain.
- Text fields (goal note, limitation note) save when the field loses focus. Return closes the keyboard.

### 4.2 When changes take effect

| Setting | Effect |
|---|---|
| Cue mode, cue options, voice, rate, volume, music ducking, timer sound, haptics | Immediately, from the next cue or haptic, including mid-workout. A cue already speaking finishes |
| Recognition language | From the next Talk |
| Rest presets, default rest | From the next workout. The current workout keeps its snapshot (`resolveRestPreset` snapshots per session); a running rest is never changed |
| Effort scale / when to ask | From the next set. Saved sets keep the scale they were logged with; values are never converted (brief §6) |
| Weights in | New equipment and new exercises only. Nothing is converted |
| Auto-save timed sets | From the next work timer |
| Coach offers and thresholds | From the next logged or corrected set (`evaluateCoachTrigger` reads them) |
| Check-in settings (2026-10-09) | From the next Start. A workout in progress keeps its check-in and any offer already shown |
| Goals, week, limitations | Next coach turn or workout build |
| Pain flag set or cleared | Immediately; the domain re-checks pending coach changes |
| Appearance | Immediately |
| OpenAI voice choice | From the next coach reply |

### 4.3 Voice and coach
- In a workout, Ben can say "quiet mode", "set cues" or "conversation mode" (through the coach or the cue-mode menu). That's the only setting voice can change.
- The coach's tool registry has no tool that writes credentials, spend limits, permissions, thresholds (including check-in settings, 2026-10-09), pain-flag clearing, backups or deletion. Asking it gets a link: `You can change that in Profile → Voice & alerts ›`.
- No spoken cues play on Profile except `Play a sample`.

### 4.4 Permissions
Profile is the place to see and fix every permission. Each row shows `Allowed`, `Off in iOS Settings` [Open Settings] or `Not set up` [Allow]. `Allow` shows the same priming text as the in-context prompt (onboarding.md §4.6) before the system prompt. Profile never asks for a permission on its own when it opens.

### 4.5 Gestures and keyboard
- No custom gestures. Swipe-back works. Swipe-to-delete on rest presets has a `Delete` button equivalent in the preset editor.
- Steppers have 44 × 44 targets (`target.min`); this tab isn't used mid-set, so `target.workout` isn't required.
- Key entry (ai-connection.md §2.7) keeps `Check and save key` above the keyboard.

## 5. Copy

| Element | Text |
|---|---|
| Title | `Profile` |
| Sections | `Training` · `Gyms` · `Voice & alerts` · `Coach` · `Data` · `App` |
| Attention | From system-states.md §5 (e.g. `Refresh Fizz in SideStore by Sat` [How ›], `Last backup on this phone didn't save`). No off-phone backup wording here |
| Data row | `Data & backup` · `Backed up on this phone · 19:05` · `Saved on this phone` · `Copy saved to Files · 8 Oct` · `No copy off this phone yet` · `No copy off this phone since 8 Sep` |
| Coach rows (added) | `Guides & playbook` (`9 rules approved · 5 to review`) · `What the coach remembers` (`7 confirmed · 2 waiting`) |
| Training rows | `Goals & schedule` · `Pain flags` (`1 active: Bench press` / `None`) · `Logging` (`kg · RPE after the set`) · `Check-in` (`Every workout · asks what's up at 3 or lower` / `Off`; 2026-10-09) · `Rest presets` (`1:00 · 1:30 · 3:00`) |
| Check-in screen (2026-10-09) | As check-in.md §2.8 and §5.3 |
| Goals screen | `Main focus` · `Also matters` · `Specific goal` · `Lifting regularly` · `Training days` · `Usual session length` · `Notes` · `Not set` · footer `The coach reads these. It can suggest changes in chat, but they only appear here after you confirm them.` |
| Provenance | `Set in setup, 8 Oct` · `Changed by you, 12 Oct` · `From coach chat, 14 Oct · you confirmed` |
| Pain flags | `Loads don't go up on these movements until you clear them. This isn't a diagnosis.` · `since 8 Oct` · `Clear` · `Flag a movement` · empty `No pain flags. Flag a movement here, or tap Pain in a workout.` · toast `Pain flag cleared for Bench press. Loads can go up again.` [Undo] |
| Logging | `Weights in` · `Used for new equipment. Existing equipment and past sets keep their unit and are never converted.` · `Effort` `RPE` `RIR` `Off` · `Ask for effort` `After` `Before` · `After the set is the default: it never delays logging or rest.` · `Auto-save timed sets` · `When a work timer ends, save the planned time as done. You can undo.` |
| Rest presets | `Starting points, not advice. Changes apply from your next workout.` · `Standard (default)` · `Add preset` · `Default rest` · `Rest is chosen in this order: the set's own setting, the routine's preset for that set type, the exercise's default, then this default.` · `Delete preset` |
| Cue modes | As rest-state.md §5: `Quiet` / `Screen, vibration and alert sound.` · `Set cues` / `Short spoken prompts. No AI, no microphone.` · `Conversation` / `Set cues plus tap-to-talk with the coach.` · `Coach not connected` |
| Cue options | `Heads-up at 15 seconds left` · `Announce each set before you start` · `Listen during rest (mic on in rest)` · `Speak through phone speaker when no headphones` · `Say "done" to log shown values` / `Saying "done" or "log it" saves the values on the Log button. Only works when exactly one set is active.` |
| Voices | `Set cues` · `Coach replies` · `Same as set cues` · `Speaking rate` `Slower` `Normal` `Faster` · `Recognition language` · `On this phone` / `Needs internet` · `Your region is UK. English (UK) may recognise you better.` [Use English (UK)] · `Play a sample` |
| Voice picker | `Personal Voice` · `Premium` · `Enhanced` · `Standard` · `Premium and Enhanced voices sound more natural. Download them in iOS Settings under Accessibility. The app can't download voices itself.` · `No Personal Voice on this phone. You can create one in iOS Settings → Accessibility → Personal Voice.` · `(not on this phone) · using default` |
| Sample (spoken) | "Logged 100 kilos for 8. Rest 2 minutes." (an example of an **actual** result cue) |
| Volume | `Voice volume` · `Lower music during cues` · `Timer sound (Quiet mode)` |
| Vibration | `Set saved` · `Rest ended` · `Steppers and keypad` · `Undo` |
| Rest alerts | Owned by lock-screen-and-alerts.md §5: `When rest ends` · `Notification` · `Loud rest alerts` (`Off` · `Long rests only (2:00 or more)` · `Every rest`) · `Speak while locked (experiment)` · `Show rest end time on the Lock Screen` · `Alert check` · `Test rest alert` · `Lock your phone now. In 10 seconds you should get the rest alert.` · `Did the alert arrive?` [Yes] [No] |
| Talking | Owned by voice.md §2.5: `Talking` · `Talk button` · `Tap to start, stops when you stop talking` · `Hold to talk` · `Use iPhone mic with headphones` · `Allow Apple's servers if this iPhone can't recognise speech itself` · `Speak replies to questions I ask by voice` |
| Coach voice | `Same as set cues (Apple)` / `Free. Works offline.` · `OpenAI voice` / `Paid by your OpenAI API key, not your ChatGPT plan.` · `API key` · `Voice` · `Play a sample (one paid request)` · `Spending` · `This month` · `Recorded by this app from OpenAI's usage figures. Your OpenAI bill is the final amount.` · `Monthly limit in this app` (`None`) · `Also set a hard limit on OpenAI's website (Limits page).` · fallback paragraph as in §2.6.2 |
| Key sheet | `OpenAI API key` · `Stored in this phone's Keychain. It isn't included in backups, so add it again after a restore.` · `Create a key and set a spend limit on OpenAI's website first.` · `Save and check` · `Remove key` · `Key works.` · `OpenAI rejected this key.` · `Couldn't check the key: no connection. It's saved; it'll be checked before first use.` · `Remove the key? OpenAI voice stops, and so does the coach if it uses this key.` [Remove] [Cancel] |
| Coach voice statuses | §3.3 lines, and in the workout strip `OpenAI voice unavailable. Using Apple voice.` |
| Coach rows | `Coach connection` (`Not connected` · `ChatGPT plan · text` · `API key · text` · `Paused: usage limit reached` · `No connection right now` · `Not available in this build yet`) · `What the coach remembers` · `Coach offers` (`On · effort 9.5 · 2 reps short` / `Off`) |
| Coach offers | `Offer to adjust after a hard or easy set` · `The coach only offers. Nothing changes until you tap Adjust.` · `Offer when effort is at least` · `Offer when reps are short by` · `Offer when effort is at most` · `Offer when RIR is at most` · `Offer when RIR is at least` · `Reset to defaults` · `Coach not connected. Offers start once it is.` · toast `Offer settings reset.` [Undo] |
| Data rows | (Replaced in consolidation by the single `Data & backup` row above.) |
| Appearance | `System` · `Dark` · `Light` |
| Capabilities | `What works on this phone and install. Logging and rest timers never depend on any of these.` · statuses `Working` `Not working` `Not tested` `Not available` `Not in this build` `Off` · `Tested 8 Oct, build 7` · `Needs paid Apple signing.` · `Run phone checks` · detail headings `What it does` · `Evidence` · `Likely cause` · `Instead` · [Check again] · `Did you see a countdown on the lock screen?` [Yes] [No] |
| About | `Version` · `Built` · `Installed with` · `App ID` · `Signed until` (`Thu 15 Oct (7 days)` / `unknown`) · `If signing lapses, the app won't open until you refresh it in SideStore. Your data stays on the phone.` · `Database` · `Privacy` paragraph as in §2.11 · `Copy diagnostics` · `Licences` |

## 6. Data needed

Existing (brief, ADRs, other specs):
- `getAiCapabilities(userId)`: coach row, Conversation availability, coach offers note.
- `checkPersonalSpendCap(requestId, estimate)`, `recordPersonalApiUsage(requestId, actualUsage)` (brief §2): OpenAI voice limit and spending.
- `resolveInferenceRoute(userId, modality)`: returns the Apple voice when OpenAI speech is unavailable; never another paid route.
- `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)`, `clearPainFlag`, `listPainFlags` (coach-memory.md §6, canonical).
- `buildSetCue(event, sessionVersion)` for `Play a sample` (with a fixed sample event), `speakReply(text, preferences)`.
- `runRestAlertTest()` and `getRestAlertCapabilities()` (lock-screen-and-alerts.md §6) for the alert group.
- `getBackupStatus(ownerId)` (data-import-export.md §6, canonical shape) for the Data row.
- `saveApiKey`, `removeApiKey`, `setSpendCap`, `getPersonalUsageSummary(purpose, month)`, `setReplyVoice` (ai-connection.md §6) behind `Coach replies`.
- `buildSystemStatus`, `getInstallStatus()` (system-states.md §7) for attention rows, App status and About.

Proposed new:

| Function | Why |
|---|---|
| `getUserProfile()` / `saveUserProfile(patch, expectedVersion, opId)` | Units, effort scale, effort timing (proposed field `effortPrompt: 'after' \| 'before'`), auto-save timed sets, rest presets, appearance |
| `getTrainingGoals()` / `saveTrainingGoals(…, source)` / `saveAvailability(…)` | Shared with onboarding.md §6; returns provenance per value |
| `getCoachTriggerThresholds()` / `saveCoachTriggerThresholds({enabled, rpeHigh, repsShort, rpeLow, rirHigh, rirLow}, opId)` | Coach offers screen; read by `evaluateCoachTrigger` |
| `getCheckInSettings(ownerId)` / `saveCheckInSettings(patch, expectedVersion, opId)` (2026-10-09) | Check-in screen; `CheckInSettings` shape in check-in.md §6. Read by `shouldAskCheckIn` and `evaluateCheckInOffer` |
| `getVoiceSettings()` / `saveVoiceSettings(patch, opId)` | **Canonical** (absorbs voice.md's `setVoicePreferences`). Cue mode and options, Talking options (`talkMode`, `phoneMicWithHeadphones`, `doneShortcut`, `listenDuringRest`, `serverRecognition`, `speakVoiceReplies`, `locale`), voices, rate, volume, ducking, timer sound, haptic switches, loud-alert mode and threshold |
| `listSpeechVoices()` → `{id, name, locale, quality: 'premium' \| 'enhanced' \| 'default' \| 'personal'}[]` | audio-coach module; includes Personal Voice when authorised |
| `requestPersonalVoiceAccess()` | Personal Voice authorisation |
| `listRecognitionLocales()` → `{locale, onDevice}[]` | Recognition language row |
| (withdrawn) `setProviderCredential` / `checkProviderCredential` / `removeProviderCredential` | Use ai-connection.md's `saveApiKey(purpose, key \| {sameAs: 'text'}, capUsd, opId)` / `removeApiKey(purpose)` (Keychain, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) |
| (withdrawn) `getPersonalUsageSummary({provider, month})` | Use ai-connection.md's `getPersonalUsageSummary(purpose, month)` → `{estimateUsd, capUsd, requests, requestsWithoutUsage, priceTableCheckedAt}` (adds this file's `requestsWithoutUsage`) |
| `getDeviceCapabilities()` → per capability `{status, evidence: {kind: 'runtime' \| 'probe' \| 'user_test', at, build}?, cause?, fallback}` | App status. Aggregates `getRestAlertCapabilities()`, `getVoiceCapabilities()`, `getAiCapabilities()`, `getPermissionStatus()` and stored probe/test results. Never returns `Working` without evidence |
| `runRestAlertTest()` / `recordCapabilityObservation(capability, ok)` | Test rest alert and `Check again` (one name; lock-screen's `runAlertTest` folds into it) |
| (withdrawn) `getInstallInfo()` | Use system-states.md's `getInstallStatus()` (adds `installer`, `builtAt`, `commit` from here) |
| (withdrawn) `getBackupStatus()` shape | Use data-import-export.md §6's `getBackupStatus(ownerId)` |
| `getPermissionStatus(kind)` / `requestPermission(kind)` | Notifications, microphone, speech, AlarmKit, Personal Voice |

## 7. Acceptance checks

1. With airplane mode on and no coach, Profile renders fully. Only the coach connection row, Conversation and the OpenAI voice status mention it, and none shows an error banner.
2. On the build 7 install, App status shows the lock-screen countdown as `Not working` with `Checked 8 Oct, build 7`, time-sensitive alerts as `Not available` (`Needs paid Apple signing.`), AlarmKit as `Not tested`, and spoken cues while locked as `Not in this build`. No row says `Working` without a dated source line.
3. `Conversation` can't be selected while `getAiCapabilities` reports no text route; it shows `Coach not connected ›`.
4. OpenAI voice is never active unless Ben chose `OpenAI voice` **and** a key is saved. Connecting the ChatGPT plan doesn't change the coach reply voice.
5. With OpenAI voice on: airplane mode, a rejected key and a reached app limit each produce an Apple-voice reply and the matching status line. No other provider is called, and the workout strip shows the fallback line once.
6. After saving a key (ai-connection.md), the full key is never displayed again (only `sk-…` and four characters). A backup file made afterwards doesn't contain the key (search the JSON for the key's last 8 characters). With `Use the same key as text` on, the Keychain holds one item.
7. The spending line is labelled as recorded by the app, and the count of replies without usage figures is shown when non-zero.
8. Haptics, timer sound and voice volume are three separate controls: turning off `Rest ended` vibration leaves the timer sound and cues unchanged, and vice versa.
9. Changing the Heavy preset from 3:00 to 2:30 during a workout doesn't change the running rest or the rest of that workout; the next workout's heavy sets rest 2:30.
10. Changing thresholds to RPE 9 makes an RPE 9 working set raise an offer on the next set, with the coach connected. `Reset to defaults` restores 9.5 / 2 / 6 and offers [Undo].
11. Clearing a pain flag needs a tap and a confirmation, shows an Undo toast, and the coach has no tool that can clear it.
12. `Test rest alert` schedules exactly one alert per enabled layer; locking the phone shows it; the answer is stored and shown as evidence with date and build.
13. With signing ending in 60 h, an info attention row appears; at 20 h it's a warning with the time; with more than 72 h left there's none (system-states.md §3.5).
14. With no copy saved to Files, the root shows **no** attention row about backups; the `Data & backup` row reads `Backed up on this phone · …` and `No copy off this phone yet`. After 30 days without a copy (reminder on), the row's second line reads `No copy off this phone since …`; nothing else changes. Nothing about backups appears during a workout.
14a. Every Profile row that shows a durability state uses one of `Saved on this phone`, `Backed up on this phone`, `Copy saved to Files`.
15. Changing `Weights in` to lb doesn't change any existing equipment's unit or any logged set.
16. The recognition language row offers `Use English (UK)` when the phone's region is UK and recognition is English (US).
17. Every row is at least 44pt (52pt for setting rows), all text is at least 16pt at the default size, values wrap under labels at AX1+, every status has an icon and a word, and numbers (times, money, counts) use tabular numerals.
18. Nothing on this tab animates beyond standard navigation and switches.
19. (2026-10-09) The `Check-in` screen saves each change at once; turning it off makes the next `Start workout` open the workout in one tap; choosing `Only on these days` with Mon/Wed/Fri means Tuesday's Start shows no sheet; the coach-offer `Never` option stops the lighter-session offer while check-ins are still recorded.

## 8. Proposals for Ben (brief changes)

| # | Proposal | Reason |
|---|---|---|
| PS1 | (Merged into App status, system-states.md.) Evidence-based capability statuses, and a `Test rest alert` that records whether each layer actually arrived | ADR 0004 makes Live Activity, AlarmKit and time-sensitive alerts runtime flags; build 7 showed some fail. Ben needs to see that honestly, outside the probe screen |
| PS2 | (Merged with system-states.md §3.5.) Show **signing expiry** in About and App status, with banners at 72 h (info) and 24 h (warning) | On the free SideStore route the app stops opening when signing lapses (ADR 0004 weekly refresh) |
| PS3 | (Merged with ai-connection AC3/AC7; see open-decisions.md.) One key entered once by default (`Use the same key as text`), with an optional separate key per purpose; never in backups | Avoids entering the key twice, and backups stay free of credentials (ADR 0005 proposal 2) |
| PS4 | (Merged with ai-connection AC2.) An optional **in-app monthly cap** per purpose, as well as the budget on OpenAI's site | Brief §2 asks for a personal spend cap; v0.6 sets it on OpenAI's dashboard |
| PS5 | (Merged with lock-screen-and-alerts §2.3.) `Loud rest alerts` modes `Off` / `Long rests only (2:00 or more)` / `Every rest` | AlarmKit's full-screen alarm is heavy for short rests (ios-platform-feasibility.md) |
| PS6 | Recognition language as a setting, suggesting English (UK) | The build 7 probe ran in en-US; v0.6 assumes en-GB |
| PS7 | Effort timing (`After` / `Before`) stored on the profile | P3 was adopted ("Ben can switch to before or off") but no spec or schema field holds it yet. The `Before` placement on the set card needs an active-workout.md revision |

## Proposed design-system additions

> **Merged into design-system.md (consolidation):** `SettingsRow` §9.31 (with slider variant), `SettingsSectionHeader` §9.32, `StatusLabel` §7.1/§9.40 (`Not working` now uses `exclamationmark.triangle`), `AttentionRow` → `StatusBanner` §9.12, `SecureKeyField` §9.45, `ProvenanceTag` → `SourceTag` §9.28. Kept below for history.

| Name | Kind | Spec |
|---|---|---|
| `SettingsRow` | Component | Min 52pt, padding `space.3`/`space.4`, `bg.surface`, rows separated by `border.divider` (decorative only; the whole row is the target). Title `type.body` `text.primary`; value or subtitle `type.callout` `text.secondary`, tabular when numeric; optional leading SF Symbol; trailing `chevron.right` (`text.tertiary`) or a system switch. At AX1+ the value moves under the title. Destructive variant: title in `status.danger`, no chevron |
| `SettingsSectionHeader` | Component | `type.label`, `text.secondary`, sentence case, `space.6` above, `space.2` below |
| `StatusLabel` | Component | Icon + word, `type.label`: `Working` (`checkmark.circle.fill`, `status.done`), `Not working` (`xmark.octagon`, `status.warning`), `Not tested` (`questionmark.circle`, `text.secondary`), `Not available` / `Not in this build` (`minus.circle`, `text.secondary`), `Off` (`circle`, `text.secondary`). Optional second line for evidence (`Tested 8 Oct, build 7`) in `type.callout` `text.secondary`. Never colour alone |
| `AttentionRow` | Component | `StatusBanner` (§9.12) used as a tappable row at the top of Profile: max two, warning style, trailing action text in `accent`. Same priority rules as banners (never more than two) |
| `SecureKeyField` | Component | Secure text input, `bg.raised`, 1pt `border.control`, `radius.sm`, min 52pt, paste allowed, never shows the value after save; saved state shows `sk-…a1b2` in `type.body` tabular |
| `SliderRow` | Component | System slider in a `SettingsRow`, value as a percentage at the trailing edge (tabular). VoiceOver adjustable in 10% steps |
| `ProvenanceTag` | Component | As defined in onboarding.md |

No new colour, type, spacing or timing tokens. Note for design-system §6: "Each haptic has its own on/off switch in Profile → Voice & alerts" is implemented by the four `Vibration` rows in §2.6.

## Cross-links

- [design-system.md](design-system.md): §2 appearance modes, §6 haptics and sound, §9.8 `TalkButton`/Ask pill, §9.9 `VoiceModePill`, §9.12 `StatusBanner`.
- [rest-state.md](rest-state.md) §3 (notification priming row), §4.2 (preset order), §5 (cue modes, options and scripts).
- [active-workout.md](active-workout.md) §2.5 (voice strip and the fallback line), §2.7 (`Auto-save timed sets`), §4.1 (`Say "done"` shortcut), §4.6 (`⋯` → `Voice & alerts`, `Rest presets`).
- [coach-adjustments.md](coach-adjustments.md) §4.2, §4.4, §4.5 and §4.7 (triggers, pain flags, threshold settings).
- [workout-builder.md](workout-builder.md) §3.1 and §5.1 (goals, session length, `Choose movements` into Pain flags).
- [today.md](today.md) §3 (Ask pill states, database error with `Restore from backup`).
- [onboarding.md](onboarding.md) (first values, permission priming table, `ProvenanceTag`).
- [gym-editor.md](gym-editor.md) (Gyms section rows and everything behind them).
- [ai-connection.md](ai-connection.md): coach connection, ChatGPT-plan and API-key routes, keys, caps, usage and the coach reply voice.
- [coach-memory.md](coach-memory.md): Memory and Pain flags.
- [coaching-playbook.md](coaching-playbook.md): Guides & playbook.
- [voice.md](voice.md) §2.5: the `Talking` group.
- [lock-screen-and-alerts.md](lock-screen-and-alerts.md) §2.5, §3.1: `When rest ends`, `Alert check`, `Test rest alert`.
- [data-import-export.md](data-import-export.md): backup (on this phone by default, optional copies to Files), check, restore by section, import, export, delete and reset, `getBackupStatus`.
- [system-states.md](system-states.md): App status, attention-row priority, signing expiry.
- [Device probe, build 7](../device-tests/2026-10-08-probe-build7.md), ADR 0004, ADR 0005, ADR 0006, ADR 0007; CHANGELOG v0.6 (voice plan).
