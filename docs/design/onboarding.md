# Onboarding (first-run setup)

Status: v0.1 draft, 8 Oct 2026. Tokens: [design-system.md](design-system.md). Gym details: [gym-editor.md](gym-editor.md). Settings that onboarding writes are edited later in [profile-and-settings.md](profile-and-settings.md).

## 1. Purpose

Onboarding answers **"What does the app need before I can log my first set safely?"**

Its single primary action on every step is **`Continue`**. The whole flow ends on Today, where `Start empty workout` is one tap away.

The brief (§1) lists seven first-run items: goals and priorities, experience, weekly availability, session length, units, first gym and optional limitations, with the AI connection skippable. It also says onboarding must be "short enough to start logging immediately" and that richer questions "can follow when they affect a decision". ADR 0004 adds a tested backup before any real workout is logged.

Those two needs pull against each other, so this spec splits the flow:

- **Essentials (3 steps, required path):** how you log (units and rest presets), first gym, and a first backup with a test restore. These are the only things that change what the logging screen does or whether data survives.
- **About your training (optional, 3 short steps):** goals and priorities, experience, week and session length, and limitations. These only feed the coach, the workout builder and the built-in rules' defaults. They're offered once at the end of Essentials and can be done later from Profile.
- **Coach connection (optional, 1 step):** a single skippable card linking to the coach area.

This is a change to the brief's ordering, not its content. See §8 (proposal OB1).

**Permissions are never asked during onboarding.** Each one is asked the first time a feature needs it (§4.6).

## 2. Layout

Every step uses the same frame, top to bottom:

1. **Top bar (44pt).** `Back` (left, text button) and, on optional steps only, `Skip` (right, text button). The step counter sits centred: `Step 2 of 3` (`type.label`, `text.secondary`). There's no progress bar or ring.
2. **Title** (`type.title2`) and one line of explanation (`type.callout`, `text.secondary`).
3. **Content (scrolls).** Choice cards, chips or fields.
4. **Bottom bar (fixed).** `PrimaryButton` `Continue` (or the step's specific label). It sits on `bg.surface` with a top `border.divider`, like the workout `ActionBar` but without the Talk button. When the keyboard is open, the bar sits directly above it.

The flow has no tab bar and no Ask pill. Onboarding is a full-screen stack presented over the tab shell. It's dismissed only by finishing or by restoring a backup.

### 2.1 Welcome

```
┌────────────────────────────────────────┐
│                                        │
│ Set up your training log               │ type.title2
│                                        │
│ Takes about 2 minutes. Everything is   │ type.body, text.secondary
│ saved on this phone. Nothing needs an  │
│ account or the internet.               │
│                                        │
│ You'll set:                            │
│  1  Units and rest times               │
│  2  Your gym's equipment               │
│  3  A backup, so nothing is lost       │
│                                        │
│ Coach, goals and history import are    │
│ optional and can come later.           │
│                                        │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │              Set up                │ │ PrimaryButton
│ └────────────────────────────────────┘ │
│        Restore from a backup           │ text button, accent, 44pt
└────────────────────────────────────────┘
```

`Restore from a backup` is placed here on purpose. Under ADR 0004, changing the signing tool or Apple ID installs a new, empty app, and the documented fix is "backup, new app, restore". Ben must be able to restore **before** he's asked to set anything up again.

### 2.2 Step 1 of 3: How you log

```
┌────────────────────────────────────────┐
│                Step 1 of 3             │
│ How you log                            │
│ You can change these any time in       │
│ Profile.                               │
│                                        │
│ Weights in                             │
│ ┌─────────────────┐ ┌─────────────────┐│
│ │ ✓ Kilograms (kg)│ │  Pounds (lb)    ││ segmented, 52pt
│ └─────────────────┘ └─────────────────┘│
│ Picked from your phone's region.       │ text.secondary
│ Each piece of equipment keeps its own  │
│ unit, so a kg gym and a lb gym both    │
│ work.                                  │
│                                        │
│ Rest times                             │
│ Starting points, not advice. Edit them │
│ to match how you train.                │
│ ┌────────────────────────────────────┐ │
│ │ Warm-up                    1:00  › │ │ tap → wheel picker
│ │ Standard (default)         1:30  › │ │
│ │ Heavy                      3:00  › │ │
│ └────────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- This is where "the onboarding shows them once" (rest-state.md §4.2) happens. The source wording `Starting points, not advice` matches the brief's "UI examples, not an individual training prescription".
- Tapping a preset opens the same wheel picker as the rest duration editor (rest-state.md §2.4): minutes and seconds in 15 s steps, `Done`.
- The unit default is a preference default from the locale (en-GB gives kg), not personal data, so preselecting it doesn't break the "don't prefill as if confirmed" rule. The caption says where it came from.

### 2.3 Step 2 of 3: Your gym (starting point)

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 2 of 3             │
│ Where do you train most?               │
│ Pick the closest match. You'll check   │
│ the equipment next.                    │
│                                        │
│ Gym name                               │
│ ┌────────────────────────────────────┐ │
│ │ Main gym                           │ │ text field, prefilled, editable
│ └────────────────────────────────────┘ │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ( ) Commercial gym                 │ │ ChoiceCard
│ │     Barbells, dumbbells, cables,   │ │
│ │     machines                       │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Home: dumbbells and a bench    │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Home: barbell, rack and plates │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Hotel or small gym             │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Start empty                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Skip for now: loads won't be checked   │ text button, text.secondary
│ against equipment                      │
├────────────────────────────────────────┤
│ [             Continue               ] │ disabled until a card is chosen
└────────────────────────────────────────┘
```

### 2.4 Step 2 of 3 (continued): Check the equipment

The preset becomes a **draft checklist** (brief §4: "Offer presets as draft equipment lists, then let the user confirm and customise them"). Nothing is saved until `Save gym`.

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 2 of 3             │
│ Main gym: what's there?                │
│ Draft from "Commercial gym". Untick    │
│ anything this gym doesn't have.        │
│                                        │
│ [x] Barbell and plates               › │ › opens detail editor
│     Typical values, not checked        │ ProvenanceTag
│ [x] Dumbbells                        › │
│     Typical values, not checked        │
│ [x] Cable station (weight stack)     › │
│     Typical values, not checked        │
│ [x] Adjustable bench                   │ no numbers needed
│ [x] Squat rack with safeties           │
│ [x] Pull-up bar                        │
│ [ ] Assisted pull-up / dip machine   › │
│ [ ] Plate-loaded machines            › │
│ [ ] Selectorised machines            › │
│ + Add something else                   │
│                                        │
│ You can check the numbers at the gym.  │
│ Until then they're marked "not         │
│ checked".                              │
├────────────────────────────────────────┤
│ [             Save gym               ] │
└────────────────────────────────────────┘
```

- Each checkbox row is at least 52pt tall. The whole row toggles; the `›` area (44 × 44, separated by `space.2`) opens that item's detail editor from [gym-editor.md](gym-editor.md) §2.4 with the preset values filled in.
- Saving a detail editor marks that item `Checked by you` and removes its `not checked` tag.
- `Save gym` calls `createGym` then `addEquipment` for each ticked item, in one transaction (proposed `createGymFromDraft`, §6). Ticked items keep `detailsSource: 'preset'` until Ben saves their details (gym-editor.md §8, proposal GE1).

### 2.5 Step 3 of 3: Back up

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 3 of 3             │
│ Protect your training data             │
│                                        │
│ Your workouts live only on this phone. │
│ If the app is deleted, or reinstalled  │
│ with a different Apple ID or signing   │
│ tool, they're gone unless you have a   │
│ backup.                                │
│                                        │
│ 1  Save a backup file                  │
│    Choose iCloud Drive or another      │
│    folder outside this app.            │
│ 2  Test it                             │
│    The app reads the file back and     │
│    rebuilds a copy to check it. Your   │
│    data isn't replaced.                │
│                                        │
├────────────────────────────────────────┤
│ [         Save backup file           ] │
│          Back up later                 │ text button, text.secondary
└────────────────────────────────────────┘
```

After the file is saved, the same screen updates in place:

```
│ ✓ Saved: fizz-backup-2026-10-08.json   │ status.done icon + text
│   iCloud Drive › Training              │
│   Checking it…                         │ static ellipsis icon, no spinner
```

then:

```
│ ✓ Saved: fizz-backup-2026-10-08.json   │
│ ✓ Test passed. This file restores 1    │
│   gym, 6 equipment items and your      │
│   settings.                            │
├────────────────────────────────────────┤
│ [             Continue               ] │
```

### 2.6 Ready

```
┌────────────────────────────────────────┐
│ You're ready to log                    │
│                                        │
│ ✓ Units: kg · Rest 1:00 / 1:30 / 3:00  │
│ ✓ Main gym · 6 items (3 not checked)   │
│ ✓ Backed up · test passed              │
│                                        │
│ Optional, any time                     │
│ ┌────────────────────────────────────┐ │
│ │ About your training            ›   │ │ goals, week, limitations
│ │ About 1 minute. Helps the coach    │ │
│ │ and workout builder.               │ │
│ ├────────────────────────────────────┤ │
│ │ Connect the coach              ›   │ │ → §2.8
│ │ Not connected. Logging works       │ │
│ │ without it.                        │ │
│ ├────────────────────────────────────┤ │
│ │ Import FitNotes history        ›   │ │ → data area
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ [            Go to Today             ] │
└────────────────────────────────────────┘
```

Each optional row returns to this screen when finished or skipped, with its line changed to a done state (`✓ Goals saved`, `✓ Coach connected (text)`, `Import started` or `Skipped`).

### 2.7 About your training (optional, 3 steps)

Shown only when Ben taps `About your training`. Every field starts **empty**. Nothing is prefilled from history or guessed (brief §1).

**Step 1 of 3: Goals**

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 1 of 3       Skip  │
│ What are you training for?             │
│                                        │
│ Main focus                             │
│ [ Strength ] [ Muscle ] [ Maintain ]   │ ParamChip, single select
│                                        │
│ Also matters (optional)                │
│ [ Strength ] [ Muscle ] [ Endurance ]  │ multi-select; main focus hidden
│ [ General fitness ]                    │
│                                        │
│ Anything specific? (optional)          │
│ ┌────────────────────────────────────┐ │
│ │ e.g. 140 kg squat, HYROX in March  │ │ placeholder in text.tertiary
│ └────────────────────────────────────┘ │
│                                        │
│ How long have you lifted regularly?    │
│ (optional)                             │
│ [ Under 1 year ] [ 1–3 years ]         │
│ [ Over 3 years ]                       │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

Experience is asked in years, not as "beginner/advanced" labels, so the answer is a fact rather than a self-rating.

**Step 2 of 3: Your week**

```
│ Which days can you usually train?      │
│ (optional)                             │
│ [Mon][Tue][Wed][Thu][Fri][Sat][Sun]    │ 7 chips, 44pt min, wrap at AX
│ [ ] It changes week to week            │
│                                        │
│ Usual session length                   │
│ [ 30 min ] [ 45 min ] [ 60 min ]       │
│ [ 75 min ] [ 90 min ]                  │
```

The session length is what workout-builder.md §3.1 reads as the default `Length` chip. Time-of-day windows aren't asked here; they come with the calendar (build step 6).

**Step 3 of 3: Anything to work around?**

```
│ Anything to work around? (optional)    │
│ ┌────────────────────────────────────┐ │
│ │ e.g. left shoulder, no overhead    │ │
│ │ pressing                           │ │
│ └────────────────────────────────────┘ │
│ The coach reads this. It doesn't       │
│ diagnose anything.                     │
│                                        │
│ Stop load increases on a movement      │
│ (optional)                             │
│ + Choose movements                     │ → exercise picker, multi-select
│                                        │
│ Pain flags hold loads until you clear  │
│ them in Profile.                       │
├────────────────────────────────────────┤
│ [           Save and finish          ] │
```

`Choose movements` sets a pain flag on each chosen movement (`setPainFlag(exerciseId, true, note)`), the same flag as the `Pain` chip in the workout (coach-adjustments.md §4.5). The free-text note alone never sets a flag; CLAUDE.md rule 9 and workout-builder.md §5.1 treat text as context, and only an explicit choice blocks increases.

### 2.8 Connect the coach (optional)

```
┌────────────────────────────────────────┐
│ ‹ Back                           Skip  │
│ Connect the coach (optional)           │
│                                        │
│ The coach can adjust your sets when    │
│ you ask, build workouts and review     │
│ sessions. Logging, rest timers and the │
│ built-in progression rules work        │
│ without it.                            │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Use my ChatGPT plan              › │ │
│ │ Not tested on iPhone yet.          │ │ honest status from capabilities
│ ├────────────────────────────────────┤ │
│ │ Use my own API key               › │ │
│ │ Paid separately by you.            │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ [              Not now               ] │
└────────────────────────────────────────┘
```

- Both rows hand over to the coach area spec (owned by another designer). Onboarding only shows the entry and the status text from `getAiCapabilities`. When the coach flow finishes or is cancelled, Ben comes back here, then to Ready.
- The primary on this step is `Not now`, because skipping is the expected path for a first run.
- No route is ever chosen automatically, and no paid route is suggested as a fallback for the plan route (rule 7).

## 3. States

### 3.1 Flow states

| State | Trigger | What Ben sees |
|---|---|---|
| First launch | The database opens and has no `UserProfile` | Welcome |
| Resumed mid-setup | Relaunch with `onboardingState` not `done` | The first incomplete Essentials step. Saved steps aren't asked again. No "welcome back" screen |
| Database error | SQLite can't be opened | Not onboarding. Today's database error state (`Couldn't open your training data.` [Try again] [Restore from backup], today.md §3) |
| Restored from Welcome | `restoreBackup` succeeds and the restored data has a profile | Onboarding closes and Today opens (or Active workout if the restored backup had an unfinished session under 6 h old: flow §4.2) |
| Restored, no profile in the file | The backup predates setup | Onboarding continues at Step 1, with any restored gyms listed on Step 2 as `Use Main gym (from your backup)` |
| Restore cancelled or failed | Picker cancelled, or the data area's restore reports an error | Back on Welcome. The data area's error message shows as a `StatusBanner`. Nothing changed |
| Essentials done | Step 3 finished or `Back up later` chosen | Ready |
| Done | `Go to Today` | Today (No plan state, or No gym if the gym was skipped). `onboardingState = done` |

### 3.2 Step states

| Step | State | Display | Primary |
|---|---|---|---|
| 1 How you log | Normal | Unit preselected from region, presets shown | `Continue` (always enabled) |
| 2 Gym, starting point | No card chosen | Cards unselected | `Continue` disabled, label `Choose a starting point` |
| 2 Gym, starting point | Name empty | Field shows inline `Give the gym a name` (`status.warning` border + text) | `Continue` disabled |
| 2 Gym, checklist | Normal | Ticked items with `not checked` tags | `Save gym` |
| 2 Gym, checklist | Nothing ticked | Hint `Nothing ticked. Logging still works, but loads won't be checked.` | `Save empty gym` |
| 2 Gym, checklist | Item detail invalid | The item's row shows `(!) Needs fixing: max is below the bar weight` (validator text) | `Save gym` disabled until fixed or unticked |
| 2 Gym | Skipped | `Skip for now…` tapped | Goes to Step 3. Ready shows `No gym yet` with `Add gym ›` |
| 3 Backup | Not started | §2.5 | `Save backup file` |
| 3 Backup | Picker open | System document picker (export) | n/a |
| 3 Backup | Picker cancelled | `No backup saved yet.` under the steps | `Save backup file` |
| 3 Backup | Saved inside the app's own folder | Warning: `That folder is deleted with the app. Choose iCloud Drive or another folder.` (`status.warning`) | `Choose another folder` (the file stays; the warning stays on Ready) |
| 3 Backup | Checking | `Checking it…` (static icon) | Disabled `Checking…` |
| 3 Backup | Test passed | §2.5 passed view | `Continue` |
| 3 Backup | Test failed | `(!) The test didn't pass: <reason from verifyBackup>. Your data on this phone is fine.` | `Try again` + text button `Back up later` |
| 3 Backup | Write failed | `Couldn't save the file: <system reason>. Your data on this phone is fine.` | `Try again` |
| 3 Backup | Later chosen | Confirmation alert (§4.4) | Ready shows `(!) Not backed up yet` |
| About you | Any field empty | Valid; empty means "not set" | `Continue` always enabled |
| Coach | Offline | Both rows show `No connection. You can connect later in Profile.` and are disabled | `Not now` |
| Coach | Route unavailable in this build | Row shows `Not available in this build yet` and is disabled | `Not now` |

### 3.3 Offline, AI unavailable, loading

- **Offline:** every Essentials step works. Saving to iCloud Drive while offline still writes the file; the Files app uploads it later. The passed line adds `iCloud uploads it when you're back online.` when the destination is iCloud Drive and the network is down.
- **AI unavailable:** only §2.8 changes. Nothing else mentions AI.
- **Loading:** all reads are local. If a step's data takes over 300 ms, static grey blocks show (no shimmer), as on Today.

### 3.4 Transitions

```
Welcome ─Set up─► Step 1 ─► Step 2 (start) ─► Step 2 (checklist) ─Save gym─► Step 3 ─► Ready ─Go to Today─► Today
   │                          └─Skip for now──────────────────────────────►┘          │
   └─Restore from a backup─► data area restore ─ok─► Today                            ├─► About you (3) ─► Ready
                                                └─cancel/fail─► Welcome               ├─► Connect coach ─► Ready
                                                                                      └─► Import FitNotes (data area) ─► Ready
```

`Back` on any step returns to the previous step with its saved values. Going back over a saved gym edits that gym (`updateGym`), it never creates a second one.

## 4. Interactions

### 4.1 General
- One primary per step, fixed at the bottom, always above the keyboard.
- Text fields use the system keyboard. Return moves to the next field. On the last field Return closes the keyboard; it never submits the step.
- Chips and cards toggle on tap. Tapping a selected single-select chip again clears it (ParamChip behaviour).
- No swipe gestures are needed. The system back-swipe works as `Back`.
- Every step writes when `Continue` is tapped, with an operation ID, so a force-close never loses a finished step and a double tap never saves twice.

### 4.2 Gym steps
- Preset choice calls `buildPresetDraft(presetId, unit)` (proposed). Changing the preset after visiting the checklist asks `Replace the checklist with the "Home: dumbbells" draft? Your changes to it will be lost.` [Replace] [Keep mine].
- `+ Add something else` opens the add-equipment sheet from gym-editor.md §2.3.
- `Start empty` goes straight to Step 3 after creating a gym with no equipment. Ready shows `Main gym · no equipment yet`.

### 4.3 Backup step
- `Save backup file` calls `createBackup(store, {at, app})` (ADR 0005), then opens the system export picker with the suggested file name. The default folder is iCloud Drive when available.
- After the picker returns a URL, the app checks whether that URL is inside its own container. If it is, it shows the "deleted with the app" warning.
- The test calls `verifyBackup(file)` (proposed, data area): ADR 0005 restore steps 1–4 (parse, checksum, build a new file, load, migrate, integrity check), then it **throws the built copy away**. It never switches the database pointer. This proves the file restores without replacing anything. A plain `restoreBackup` of identical content would return `unchanged` and prove less.
- The result line uses the counts from the verify report. It never says "all your data": it lists what the file contains.

### 4.4 Skipping the backup
`Back up later` shows a confirmation alert:

> **Skip the backup?**
> Until you back up, deleting or reinstalling the app loses everything you log.
> [Back up now] [Skip]

`Back up now` is the bold (preferred) action. After Skip, Ready shows `(!) Not backed up yet` with `Back up ›`, and Profile shows its attention row (profile-and-settings.md §3.2).

### 4.5 Restore from Welcome
`Restore from a backup` opens the data area's restore flow (file picker, then preview with counts and the "replaces" warning, then Restore). Onboarding doesn't define that UI. It only defines the entry and the two exits in §3.1.

### 4.6 Permission priming (in context, never up front)

No system permission prompt appears during onboarding. Each permission is asked once, at the moment its feature is first used, with a one-line explanation **before** the system prompt. If Ben says no, the feature shows an honest off state and a way to iOS Settings; nothing else breaks.

| Permission | Asked when | Priming (in-app, before the system prompt) | If denied |
|---|---|---|---|
| Notifications | First rest of the first workout (rest-state.md §3, `Notifications not allowed` row), or Profile → Voice & alerts → `Allow` | `Get an alert when rest ends while your phone is locked?` [Allow] [Not now]. Defined in rest-state.md | Rest still runs on screen. Profile: `Rest alerts are off in iOS Settings` [Open Settings] |
| Microphone + Speech recognition | First tap on Talk, or first time Ben picks `Conversation` or turns on `Listen during rest` | In the voice strip: `Talk uses the microphone. Speech is turned into text on this phone, and the audio isn't saved.` [Continue] [Not now]. Then the two system prompts in a row | Talk shows `Ask` (text). Strip: `Voice isn't available: microphone is off in iOS Settings` [Settings] (active-workout.md §2.5) |
| Loud alerts (AlarmKit) | Ben turns on `Loud rest alerts` in Profile | Sheet: `Loud alerts ring even in silent mode and Focus, with a full-screen alarm. Best for long rests.` [Turn on] [Cancel] | The switch returns to off with `Turned off in iOS Settings` |
| Personal Voice | Ben chooses `Personal Voice` in the voice picker | `iOS will ask to let this app use your Personal Voice for spoken cues.` [Continue] [Cancel] | The row reads `Not allowed in iOS Settings` |
| Files | Never asked. The system document picker needs no permission | n/a | n/a |
| Location | **Never asked.** Gyms use a typed label (brief §4: coordinates optional, not required) | n/a | n/a |

"Not now" on any priming doesn't trigger the system prompt, so the one-time iOS prompt is kept for when Ben actually wants the feature.

### 4.7 Voice equivalents
None. Voice isn't set up during onboarding and no microphone is opened.

### 4.8 Undo
- Every value is editable afterwards in Profile, so no step has an Undo toast.
- `Back` revisits any Essentials step before Ready.
- A gym created here can be edited, duplicated or archived in the gym editor.
- Pain flags set here are cleared in Profile → Pain flags.

## 5. Copy

| Element | Text |
|---|---|
| Welcome title | `Set up your training log` |
| Welcome body | `Takes about 2 minutes. Everything is saved on this phone. Nothing needs an account or the internet.` |
| Welcome list | `You'll set:` `Units and rest times` · `Your gym's equipment` · `A backup, so nothing is lost` |
| Welcome footer | `Coach, goals and history import are optional and can come later.` |
| Welcome actions | `Set up` · `Restore from a backup` |
| Step counter | `Step 1 of 3` (Essentials) · `Step 1 of 3` (About your training) |
| Step 1 title | `How you log` / `You can change these any time in Profile.` |
| Unit | `Weights in` · `Kilograms (kg)` · `Pounds (lb)` · `Picked from your phone's region.` · `Each piece of equipment keeps its own unit, so a kg gym and a lb gym both work.` |
| Rest | `Rest times` · `Starting points, not advice. Edit them to match how you train.` · `Warm-up 1:00` · `Standard (default) 1:30` · `Heavy 3:00` |
| Step 2 title | `Where do you train most?` / `Pick the closest match. You'll check the equipment next.` |
| Gym name | Label `Gym name`, default `Main gym`. Error `Give the gym a name` |
| Presets | `Commercial gym` (`Barbells, dumbbells, cables, machines`) · `Home: dumbbells and a bench` · `Home: barbell, rack and plates` · `Hotel or small gym` · `Start empty` |
| Skip gym | `Skip for now: loads won't be checked against equipment` |
| Checklist title | `Main gym: what's there?` / `Draft from "Commercial gym". Untick anything this gym doesn't have.` |
| Item tag | `Typical values, not checked` · after saving details: `Checked by you` |
| Checklist footer | `You can check the numbers at the gym. Until then they're marked "not checked".` |
| Checklist primary | `Save gym` · `Save empty gym` |
| Step 3 title | `Protect your training data` |
| Step 3 body | `Your workouts live only on this phone. If the app is deleted, or reinstalled with a different Apple ID or signing tool, they're gone unless you have a backup.` |
| Step 3 list | `Save a backup file` / `Choose iCloud Drive or another folder outside this app.` · `Test it` / `The app reads the file back and rebuilds a copy to check it. Your data isn't replaced.` |
| Step 3 results | `Saved: <file name>` · `Checking it…` · `Test passed. This file restores 1 gym, 6 equipment items and your settings.` · `iCloud uploads it when you're back online.` |
| Step 3 problems | `No backup saved yet.` · `That folder is deleted with the app. Choose iCloud Drive or another folder.` · `The test didn't pass: <reason>. Your data on this phone is fine.` · `Couldn't save the file: <reason>. Your data on this phone is fine.` |
| Skip backup alert | `Skip the backup?` / `Until you back up, deleting or reinstalling the app loses everything you log.` [Back up now] [Skip] |
| Ready title | `You're ready to log` |
| Ready lines | `Units: kg · Rest 1:00 / 1:30 / 3:00` · `Main gym · 6 items (3 not checked)` · `Backed up · test passed` / `Not backed up yet` / `No gym yet` |
| Ready optional | `About your training` (`About 1 minute. Helps the coach and workout builder.`) · `Connect the coach` (`Not connected. Logging works without it.`) · `Import FitNotes history` |
| Ready primary | `Go to Today` |
| Goals | `What are you training for?` · `Main focus` · `Strength` `Muscle` `Maintain` · `Also matters (optional)` · `Endurance` `General fitness` · `Anything specific? (optional)` · `How long have you lifted regularly? (optional)` · `Under 1 year` `1–3 years` `Over 3 years` |
| Week | `Which days can you usually train? (optional)` · `It changes week to week` · `Usual session length` · `30 min` … `90 min` |
| Limits | `Anything to work around? (optional)` · `The coach reads this. It doesn't diagnose anything.` · `Stop load increases on a movement (optional)` · `Choose movements` · `Pain flags hold loads until you clear them in Profile.` · primary `Save and finish` |
| Coach | `Connect the coach (optional)` · `The coach can adjust your sets when you ask, build workouts and review sessions. Logging, rest timers and the built-in progression rules work without it.` · `Use my ChatGPT plan` · `Use my own API key` (`Paid separately by you.`) · primary `Not now` |
| Coach statuses | From `getAiCapabilities`: `Not tested on iPhone yet.` · `Not available in this build yet` · `No connection. You can connect later in Profile.` |
| Microphone priming | `Talk uses the microphone. Speech is turned into text on this phone, and the audio isn't saved.` [Continue] [Not now] |

No spoken cues anywhere in onboarding.

## 6. Data needed

Existing (brief or ADRs):
- `createGym(profile)`, `updateGym(id, patch)`, `addEquipment(gymId, equipment)` (brief §4).
- `getAchievableLoads(equipment)` for the detail editors' preview (gym-editor.md).
- `createBackup(store, {at, app})` (ADR 0005), and `restoreBackup(file)` through the data area's flow.
- `setPainFlag(exerciseId, true, note?)` (coach-adjustments.md §6).
- `getAiCapabilities(userId)` for the coach card. `beginAiConnection(userId, mode)` belongs to the coach area.

Proposed new:

| Function | Why |
|---|---|
| `getOnboardingState(ownerId)` → `{state: 'not_started' \| 'essentials' \| 'done', completedSteps[], backup: {lastVerifiedAt?, destinationKind?}}` | Resume after a force-close, and the Ready summary |
| `saveUserProfile(patch, expectedVersion, opId)` | Units, rest presets, goals, experience, session length. `UserProfile` today only has `preferredUnit`, `defaultRest`, `restPresets` and `effortScale` (packages/schemas `profile.ts` notes goals come later) |
| `saveTrainingGoals({primary, secondary[], note?, experienceYears?}, source: 'setup' \| 'profile')` | Stored with provenance and date (brief §2: "editable saved goals … with provenance and dates"). The coach reads them as confirmed by Ben |
| `saveAvailability({days[], varies, sessionMinutes})` | Writes an `AvailabilityRule` (brief §6) with its effective date |
| `listGymPresets()` / `buildPresetDraft(presetId, unit)` | Preset drafts with every value tagged `detailsSource: 'preset'` (gym-editor.md proposal GE1) |
| `createGymFromDraft(draft, opId)` | `createGym` + `addEquipment` × n in one transaction, so a force-close can't leave half a gym |
| `verifyBackup(file)` → `{ok, counts, schemaVersion, needsMigration, problems[]}` | ADR 0005 restore steps 1–4 without the pointer switch. Owned by the data area; listed here because onboarding depends on it |
| `isInsideAppContainer(url)` | The "deleted with the app" warning |

## 7. Acceptance checks

1. A fresh install opens on Welcome. No system permission prompt appears anywhere in onboarding (check notifications, microphone, speech, location and AlarmKit are all "not determined" afterwards).
2. From Welcome to Today with the `Commercial gym` preset, backup to iCloud Drive and no optional steps takes at most **8 taps**, not counting typing and navigating inside the Files picker: Set up, Continue, preset card, Continue, Save gym, Save backup file, Continue, Go to Today. Today then needs one tap for `Start empty workout`.
3. With airplane mode on and no AI, all three Essentials steps complete. The coach card shows the offline text and nothing else mentions AI.
4. Force-quit on Step 3 and relaunch: the app opens on Step 3, the units and gym are already saved, and there's exactly one gym.
5. Double-tapping `Save gym` creates one gym with one set of equipment.
6. Preset items saved without opening their details show `Typical values, not checked` in the gym editor. Opening and saving an item changes it to `Checked by you`.
7. The backup test never replaces the database: after a passed test, the database file and its pointer are unchanged and the restore rollback target is untouched.
8. Saving the backup into the app's own folder shows the "deleted with the app" warning, and Ready and Profile both show that the backup isn't safe.
9. `Back up later` shows the confirmation alert, and afterwards Ready and Profile show `Not backed up yet`.
10. `Restore from a backup` on Welcome, using a backup with a profile, lands on Today without showing any setup step. Cancelling the picker returns to Welcome with nothing changed.
11. The About-your-training fields all start empty. Skipping all three saves nothing; the workout builder then shows `No goals set` (workout-builder.md).
12. Choosing `Bench press` under `Stop load increases` creates an active pain flag visible in Profile → Pain flags. Typing "shoulder" in the free-text field alone creates no flag.
13. Every step's primary button stays fully visible with the keyboard open at 375pt width and at AX3.
14. All text is at least 16pt at the default size; durations and counts use tabular numerals; every selected chip or card shows a check icon as well as colour.
15. The choice of `Use my ChatGPT plan` or `Use my own API key` is never made for Ben, and `Not now` leaves `getAiCapabilities` reporting no route.

## 8. Proposals for Ben (brief changes)

| # | Brief says | Proposal | Reason |
|---|---|---|---|
| OB1 | §1 First-run setup lists goals, experience, availability, session length, units, first gym, limitations | Split into **Essentials** (units + rest presets, first gym, backup with test) and an optional **About your training** block (goals, experience, week, length, limitations), offered on the Ready screen and in Profile | Only the Essentials change what logging does or whether data survives. The brief already says onboarding must be short and that richer questions can follow |
| OB2 | ADR 0004: tested restore before real data | Onboarding's backup step runs a **verify** (rebuild a copy, integrity check, discard) rather than a real restore, through a new `verifyBackup` | Restoring identical content returns `unchanged` (ADR 0005), so it doesn't exercise the restore path. Verify does, without risk |
| OB3 | (not covered) | `Restore from a backup` on the Welcome screen | A signing-tool or Apple ID change gives an empty app (ADR 0004). Restore must come before setup |
| OB4 | (not covered) | No permissions during onboarding; each asked in context (§4.6). Location never asked | Matches the brief's honest-status rule and keeps setup short |

## Proposed design-system additions

| Name | Kind | Spec |
|---|---|---|
| `OnboardingFrame` | Component | Top bar (`Back`, centred `Step n of m` in `type.label`/`text.secondary`, optional `Skip`), title `type.title2`, explanation `type.callout`/`text.secondary`, scrolling content, fixed bottom bar with one `PrimaryButton` (same padding and keyboard behaviour as `ActionBar` §9.1, no Talk button). No progress bar |
| `ChoiceCard` | Component | Single- or multi-select card for presets and coach routes: `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.4`, min height 60. Selected: 2pt `accent` border, `accent.subtle` fill, `checkmark.circle.fill` icon before the title (never colour alone). Disabled: `text.secondary` title and a reason line |
| `ChecklistRow` | Component | Checkbox row (`checkmark.square.fill` / `square`), 52pt min, whole row toggles; optional trailing `›` button 44 × 44 separated by `space.2`, with non-overlapping hit areas; optional second line for a `ProvenanceTag` |
| `ProvenanceTag` | Component | Same frame as `TargetSourceTag` (§7): `type.label`, `text.secondary` on `bg.raised`, `radius.sm`. Texts: `Typical values, not checked` (icon `questionmark.circle`), `Checked by you` (icon `checkmark`), `Set in setup, 8 Oct`. Never `accent` |
| `StepResultLine` | Component | Icon + one or two lines `type.callout`: done (`checkmark.circle.fill`, `status.done`), working (static `ellipsis`, `text.secondary`), problem (`exclamationmark.triangle`, `status.warning`). No spinner animation |

No new colour, type, spacing or timing tokens.

## Cross-links

- [design-system.md](design-system.md): `PrimaryButton`, `ParamChip`, `StatusBanner`, number and duration formats.
- [gym-editor.md](gym-editor.md): presets, checklist items, detail editors, `detailsSource` (GE1).
- [profile-and-settings.md](profile-and-settings.md): where every onboarding value is edited later; the backup attention row; permissions status.
- [rest-state.md](rest-state.md) §2.4, §3 and §4.2: rest preset wheel, notification priming row, preset resolution.
- [today.md](today.md) §3: No plan, No gym and Database error states that onboarding hands over to.
- [active-workout.md](active-workout.md) §2.5: voice strip states used by microphone priming.
- [coach-adjustments.md](coach-adjustments.md) §4.5: pain flags.
- [workout-builder.md](workout-builder.md) §3.1: reads session length and goals.
- Coach area spec (another designer): ChatGPT-plan sign-in and API-key routes behind §2.8.
- Data area spec (another designer): restore flow, `verifyBackup`, FitNotes import, backup reminders.
- ADR 0004 (backup before real data, signing-tool risk), ADR 0005 (backup format, restore steps), ADR 0006 (built-in rules work with no coach).
