# Data: backup, restore, FitNotes import, export and delete

Status: v0.1 draft, 8 Oct 2026. Designer. Tokens: [design-system.md](design-system.md). App-wide wording for saved/backed-up states: [system-states.md](system-states.md).

Sources: brief §5 (data foundation), §7 (`previewFitNotesImport`, `commitImport`, `exportTrainingData`, `createBackup` / `restoreBackup`), §9; [ADR 0004](../decisions/0004-free-distribution-sidestore.md) (backup and a tested restore before any real workout); [ADR 0005](../decisions/0005-persistence-and-backup.md) (backup format, restore, rollback, modal restore); research `free-ios-install.md` §4 and §8, `ios-platform-feasibility.md` §2.2, §2.8 and §5 (FitNotes formats); `guides/sidestore-windows.md` §6 and §8.

**Why this matters more than usual.** Fizz is signed with a free Apple ID through SideStore. Deleting the app, or re-signing it with another Apple ID or tool, installs a separate app with an empty database (ADR 0004). A backup that has left the phone is the only way back. So backup and restore are in the first milestone; FitNotes import and portable export are build step 3.

| Part | Milestone |
|---|---|
| Data & backup screen, manual and automatic backups, backup folder, `Check a backup`, restore with preview and Undo restore, delete all data | First milestone |
| FitNotes import (preview, questions, commit, results, Undo import), import history, portable export | Build step 3 |

---

## 0. Design decisions

These go beyond the brief or settle open items. Each is listed again in "Proposed changes" at the end.

| # | Decision | Why |
|---|---|---|
| DX1 | Only two durability words exist in the app: **Saved on this phone** (SQLite commit) and **Backed up** (a backup file written to a folder Ben chose). There is no "sync" wording anywhere. | There is no sync. Ben needs to know whether a copy exists off the phone, and nothing else. |
| DX2 | Automatic backups go to **one folder Ben picks once** in Files (iCloud Drive or another provider). Fizz also keeps its last 3 backups in its own folder, labelled `On this phone only`. | Only a folder outside the app survives deleting the app. The local copies help with a damaged database, not with a deleted app, and the label says so. |
| DX3 | "Tested restore" inside the app is `Check a backup` (`verifyBackup`): rebuild the file into a scratch database, migrate, run the integrity check, compare counts, then throw the copy away. | Restoring a file identical to the current data returns `unchanged` (ADR 0005), which proves less. A real restore with a pointer switch belongs to the device trial run (ADR 0004). Matches onboarding.md §4.3. |
| DX4 | Restore and FitNotes import are unavailable while a workout is unfinished. | Both replace or add history the active workout reads (drafts, "Last" values, timers). Finishing first takes one tap; recovering from a half-restored workout doesn't. |
| DX5 | An unrecognised FitNotes header stops the import. There is no manual column mapping. | The real export hasn't been seen yet (brief v0.2). Letting Ben map columns by hand invites silent misreads (kg vs lb). The fix is a developer adding the variant against his real file. |
| DX6 | Load convention questions (dumbbell each or both, bodyweight added or assisted, barbell total or plates only) have **no pre-selected answer**. One tap answers a whole equipment group, with per-exercise overrides. | The file doesn't record conventions (research §5). Pre-selecting one would be inventing data (rule 6). |
| DX7 | `Undo this import` **reverts** the import's workouts (audited status `reverted`, hidden everywhere). It never deletes rows. | SQLite triggers forbid deleting sessions (ADR 0005); append-only history is the point. |
| DX8 | Backups are plain JSON and never include credentials. The folder step says so in one line. | ADR 0005 open item 2 asks Ben to confirm plain JSON. The copy lets him decide with the facts in front of him. |
| DX9 | Automatic backup files rotate (`Keep: last 14`, editable). Fizz deletes only automatic files it wrote itself (name pattern **and** a checksum it recorded). Manual backups are never deleted. | A year of workouts is ~200 files of ~1 MB each (ADR 0005 measured 1.2 MB per 300 sessions). Never touching a file Fizz didn't write keeps the folder trustworthy. |
| DX10 | Neither the coach nor voice can start a backup, restore, import, export or delete. | These are not in the restricted tool list (brief §8). Imported files are data, never instructions (rule 8). |

---

## 1. Purpose

| Surface | Question it answers | Single primary action |
|---|---|---|
| Data & backup (Profile → Data & backup) | "Is my training safe off this phone?" | `Back up now` |
| Restore | "What will this backup replace, and can I go back?" | `Restore` |
| Check a backup | "Will this file actually restore?" | `Check` |
| FitNotes import | "What will this file add, and is the mapping right?" | `Import 412 workouts` |
| Import results | "What happened to every row?" | `Done` |
| Export | "Get my data out in a format other tools read." | `Export` |
| Delete all data | "Remove everything Fizz holds on this iPhone." | None in accent. `Back up first` is secondary; `Delete everything` is a danger text button |

None of these surfaces is reachable from the active workout. They are never shown between sets.

---

## 2. Layout

Design width 390pt; checked at 375 and 430. All counts, dates and sizes use tabular numerals (design-system §3). All rows are at least `target.min` (44pt); primary buttons are `target.primary`.

### 2.1 Data & backup (hub)

Regions, top to bottom:
1. **Navigation bar.** `‹ Profile` and the title `Data & backup`.
2. **Backup status card.** Status line (icon + text), destination, what the last backup holds, and `Back up now` (primary). Shows the trial-run reminder line until Ben marks it done (§4.1).
3. **Backups.** `After each workout` switch, `Backup folder`, `Keep automatic backups`, `Check a backup`, `Copies on this phone`.
4. **Restore.** `Restore from a backup`; `Undo last restore` only when a rollback target exists.
5. **Import.** `Import from FitNotes`, `Past imports`.
6. **Export.** `Export workouts`.
7. **Delete all data.** Danger text button, separated by `space.8`.

```
┌────────────────────────────────────────┐
│ ‹ Profile      Data & backup           │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ ✓ Backed up · Thu 8 Oct, 19:05     │ │ status.done icon + text
│ │ iCloud Drive › Fizz backups        │ │
│ │ 412 workouts · 4,105 sets          │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │          Back up now           │ │ │ PrimaryButton
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Backups                                │
│ After each workout             [ On ]  │
│ Backup folder                        › │
│   iCloud Drive › Fizz backups          │
│ Keep automatic backups    Last 14    › │
│ Check a backup                       › │
│ Copies on this phone (3)             › │
│                                        │
│ Restore                                │
│ Restore from a backup                › │
│ Undo last restore                    › │ only with a rollback target
│   Brings back your data from before    │
│   Thu 8 Oct, 19:20                     │
│                                        │
│ Import                                 │
│ Import from FitNotes                 › │
│ Past imports (1)                     › │
│                                        │
│ Export                                 │
│ Export workouts                      › │
│                                        │
│                                        │ space.8
│ Delete all data                        │ status.danger text
└────────────────────────────────────────┘
```

Status card variants (icon + text, never colour alone; see §3.1 for triggers):

```
│ ⚠ Not backed up yet                    │ status.warning
│ Choose a folder outside Fizz, then     │
│ back up.                               │
│ [        Choose backup folder        ] │

│ ⚠ 2 workouts aren't backed up          │ status.warning
│ Last backup: Tue 6 Oct, 18:51          │
│ [            Back up now             ] │

│ ⚠ Last backup didn't save              │ status.warning
│ The folder can't be reached. A copy is │
│ kept on this phone until it can be     │
│ saved.                                 │
│ [        Choose backup folder        ] │

│ ⓘ Backed up on this phone only         │ status.warning icon
│ Thu 8 Oct, 19:05. This copy is deleted │
│ with the app.                          │
│ [        Choose backup folder        ] │
```

### 2.2 Backup folder sheet

Opened from `Backup folder ›`, from the status card, or from Today's backup banner (system-states.md). Medium detent.

```
┌────────────────────────────────────────┐
│ Backup folder                   Cancel │
│                                        │
│ Fizz saves a backup here after every   │
│ workout. Pick a folder outside Fizz,   │
│ like iCloud Drive, so it survives if   │
│ the app is deleted.                    │
│                                        │
│ Backups are plain files with your      │
│ training data. They never contain your │
│ coach sign-in or API keys.             │
│                                        │
│ Now: iCloud Drive › Fizz backups       │
│ ┌────────────────────────────────────┐ │
│ │          Choose a folder           │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

`Choose a folder` opens the system folder picker. If the chosen folder is inside Fizz's own container, the sheet shows `That folder is deleted with the app. Choose iCloud Drive or another folder.` (same text as onboarding.md) and keeps the old folder.

### 2.3 Restore

**Step 1: choose.** If a backup folder is reachable, list its Fizz backups newest first; otherwise go straight to the system file picker.

```
┌────────────────────────────────────────┐
│ ‹ Back       Restore from a backup     │
├────────────────────────────────────────┤
│ In iCloud Drive › Fizz backups         │
│ Thu 8 Oct, 19:05 · after workout     › │
│ Tue 6 Oct, 18:51 · after workout     › │
│ Mon 5 Oct, 21:10 · made by you       › │
│ …                                      │
│                                        │
│ Choose another file…                 › │
│                                        │
│ ⓘ Finish or discard your workout first │ only with an unfinished workout
│   (Push A, started 18:02).             │ rows disabled
└────────────────────────────────────────┘
```

**Step 2: checking.** Inline on the same screen, static icons, no spinner beyond the system activity indicator:

```
│ Checking the backup…                   │
│ ✓ File read (1.2 MB)                   │
│ ✓ Checksum matches                     │
│ … Rebuilding a test copy               │
```

**Step 3: preview.** One primary.

```
┌────────────────────────────────────────┐
│ ‹ Back       Restore this backup?      │
├────────────────────────────────────────┤
│ Made Thu 8 Oct 2026, 19:05             │
│ Fizz 0.3 (build 12) · after a workout  │
│ ✓ Checked: complete, no damaged records│
│                                        │
│                  Backup   This phone   │ CountCompareTable
│ Workouts            412          415   │
│ Sets              4,105        4,140   │
│ Routines              6            6   │
│ Gyms                  2            2   │
│ Coach memories       14           15   │
│ Coach chats          31           33   │
│                                        │
│ ⚠ 3 workouts on this phone aren't in   │ status.warning
│   this backup (newest: Sat 10 Oct).    │
│   They'll be replaced.                 │
│ ⓘ This backup is from an older Fizz.   │ only when it needs migration
│   It's updated as it's restored.       │
│ ⓘ Coach sign-in and API keys aren't    │
│   part of backups. Yours stay as they  │
│   are.                                 │
│ ⓘ You can undo this from Data & backup.│
├────────────────────────────────────────┤
│ [              Restore               ] │
└────────────────────────────────────────┘
```

At AX1 and above the count table stacks: one block per row, `Workouts` then `Backup 412 · This phone 415`.

**Step 4: confirm (only when something would be replaced).** System alert:

> **Replace this phone's data?**
> 3 workouts on this phone aren't in the backup from Thu 8 Oct, 19:05. You can undo this from Data & backup.
> [Cancel] [Restore]

When nothing would be lost (the backup contains every workout on the phone, or the phone is empty) there is no alert: the preview's `Restore` is the confirmation.

**Step 5: restoring.** `BlockingCover` (proposed component): full screen, `bg.canvas`, no buttons, no tab bar, no Ask pill.

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│          Restoring your data           │ type.title2
│                                        │
│     ✓ Backup checked                   │
│     ✓ Workouts loaded (412)            │
│     … Checking every record            │ static ellipsis icon
│     ○ Switching to the restored data   │
│                                        │
│     Keep Fizz open. If it closes now,  │
│     your current data stays as it is.  │
│                                        │
└────────────────────────────────────────┘
```

**Step 6: done.**

```
┌────────────────────────────────────────┐
│ ✓ Restored                             │ status.done.subtle banner
├────────────────────────────────────────┤
│ Your data now matches the backup from  │
│ Thu 8 Oct, 19:05.                      │
│ 412 workouts · 4,105 sets · 2 gyms     │
│                                        │
│ Undo restore                           │ accent text button
│                                        │
├────────────────────────────────────────┤
│ [               Done                 ] │
└────────────────────────────────────────┘
```

### 2.4 Check a backup

Same choose screen as §2.3 step 1 (no unfinished-workout restriction: checking never replaces anything). Result:

```
│ ✓ This backup restores                 │ status.done
│ Made Thu 8 Oct, 19:05                  │
│ 412 workouts · 4,105 sets · 6 routines │
│ · 2 gyms · 14 coach memories           │
│ Nothing on this phone was changed.     │
```

```
│ ⚠ This backup won't restore            │ status.warning
│ 2 records are damaged (workouts on     │
│ Mon 5 Oct and Tue 6 Oct).              │
│ Your newest good backup: Sun 4 Oct.    │
│ Nothing on this phone was changed.     │
```

### 2.5 FitNotes import

**Step 1: intro.** From Data & backup, or from onboarding's Ready screen (`Import FitNotes history`, onboarding.md §2.6).

```
┌────────────────────────────────────────┐
│ ‹ Back      Import from FitNotes       │
├────────────────────────────────────────┤
│ Bring in your FitNotes history from a  │
│ CSV export.                            │
│                                        │
│ 1  In FitNotes, export a CSV and save  │
│    it to Files.                        │
│ 2  Choose it here. You'll see what     │
│    will be imported before anything    │
│    is saved.                           │
│                                        │
│ Works with FitNotes (Android) and      │
│ FitNotes 2 (iPhone) CSV files.         │
├────────────────────────────────────────┤
│ [           Choose CSV file          ] │
└────────────────────────────────────────┘
```

No menu paths inside FitNotes are given: they're unverified, and wrong instructions are worse than none.

**Step 2: reading.** `Reading file… 2,000 of 4,212 rows` with a `ProgressLine` (proposed). `Cancel` in the nav bar.

**Step 3: preview.** The core screen. Things that need Ben come first, then what will be skipped, then what is kept as written, then the workouts themselves.

```
┌────────────────────────────────────────┐
│ Cancel        FitNotes import          │
├────────────────────────────────────────┤
│ FitNotes_Export_2026_10_01.csv         │
│ FitNotes (Android) CSV · weights in kg │
│ 4,212 rows · 2 Mar 2019 – 1 Oct 2026   │
│                                        │
│ Will import                            │
│ 412 workouts · 4,105 sets              │
│ 38 exercises                           │
│                                        │
│ Needs your answer (3)                  │
│ ⚠ 4 exercise names to check          › │ ImportQuestionRow
│ ⚠ Dumbbell weights: each or both?    › │
│ ⚠ Pull-up weights: added or assist?  › │
│                                        │
│ Will be skipped                        │
│ ⓘ 86 cardio rows (not imported yet)  › │
│ ⓘ 7 rows can't be read               › │
│ ⓘ 3 dates already have a Fizz        › │
│   workout                              │
│                                        │
│ Kept as written                        │
│ ⓘ 212 comments, kept as notes        › │
│   47 look like effort ratings. Review  │
│ ⓘ FitNotes files have no times. These  │
│   workouts show the date only.         │
│ Gym: Not recorded                    › │
│                                        │
│ Workouts (412)                         │
│ Wed 1 Oct 2026 · 5 exercises · 18 sets›│
│ Mon 29 Sep 2026 · 4 exercises · 15 s… ›│
│ …                                      │
├────────────────────────────────────────┤
│ [    Answer 3 questions to import    ] │ disabled until answered
└────────────────────────────────────────┘
```

Once every question is answered the primary becomes `Import 412 workouts` (accent). The counts update live as answers change (for example, skipping an exercise lowers the set count).

**Step 3a: exercise names.** Matched names are collapsed; names needing Ben are listed first.

```
┌────────────────────────────────────────┐
│ ‹ Back     Check exercise names   Done │
├────────────────────────────────────────┤
│ FitNotes name → Fizz exercise          │
│                                        │
│ Incline DB Press              96 sets  │
│ ? Incline dumbbell press        Check  │ MatchStatus "Check"
│ [ Use this ]  [ Choose… ]  [ Add new ] │
│                                        │
│ Hammer Strength Row           40 sets  │
│ ✕ No match                             │ MatchStatus "No match"
│ [ Choose… ]  [ Add new ]  [ Skip ]     │
│                                        │
│ Skullcrusher                  22 sets  │
│ ? EZ-bar skull crusher          Check  │
│ [ Use this ]  [ Choose… ]  [ Add new ] │
│                                        │
│ Plank                         12 sets  │
│ ✓ Plank (timed)    Matched · Change ›  │ after Ben answered
│                                        │
│ 34 matched by name · Show ›            │
└────────────────────────────────────────┘
```

- `Matched`: the name equals a catalogue name or a saved alias. `Check`: a suggestion based on the name only. `No match`: nothing suggested. No percentages or scores are shown, because the matcher has no calibrated confidence to report.
- `Choose…` opens the exercise picker (exercise-library.md) with a search field prefilled with the FitNotes name.
- `Add new` creates a custom exercise with the FitNotes name; the next sheet asks for its equipment type (needed for the convention questions).
- `Skip` leaves that exercise's rows out; they are listed in the results.
- Every answer is saved as an `ExerciseAlias` (source `fitnotes`), so the next import of a newer file matches it automatically.

**Step 3b: load conventions.** One screen per equipment group that needs it.

```
┌────────────────────────────────────────┐
│ ‹ Back       Dumbbell weights     Done │
├────────────────────────────────────────┤
│ FitNotes doesn't record whether a      │
│ dumbbell weight is one dumbbell or     │
│ both together.                         │
│                                        │
│ For these 9 exercises, "22.5" means:   │
│ ( ) Each dumbbell                      │
│     Imported as 22.5 kg each           │
│ ( ) Both dumbbells together            │
│     Imported as 11.25 kg each          │
│                                        │
│ Example from your file (1 Oct):        │
│ Incline DB Press  22.5 × 10            │
│                                        │
│ Different for some?                    │
│ Incline DB Press          Same ▾       │
│ DB Lateral Raise          Same ▾       │
│ DB Shoulder Press         Same ▾       │
│ …                                      │
└────────────────────────────────────────┘
```

Groups that can be asked (only when the file has rows for them):

| Group | Question | Options (none pre-selected) |
|---|---|---|
| Dumbbells | `For these 9 exercises, "22.5" means:` | `Each dumbbell` / `Both dumbbells together` |
| Barbell | `For these 6 exercises, "100" means:` | `Total, including the bar` / `Plates only (bar not counted)` → then `Bar weight` (20 kg default shown as an editable value, labelled) |
| Bodyweight exercises with a weight | `For Pull-up, "10" means:` · `Values in your file: 0 to 20, none negative` | `Weight added to bodyweight` / `Assistance from a machine` |

Stack and plate-loaded machine exercises aren't asked: their convention follows the matched exercise's equipment (`45 kg stack`, `40 kg plates`) and is shown as text on the preview (`Machines: imported as stack readings or plates added, by exercise`). Weights are never converted between kg and lb.

**Step 3c: other questions** (each appears only when the file needs it):

```
│ Weight unit                            │
│ Rows have values in both the kg and lb │
│ columns. Which did you enter in        │
│ FitNotes?                              │
│ ( ) kg   ( ) lb                        │
│ The other column is kept with each row │
│ as the original.                       │
```

```
│ Effort ratings in comments             │
│ 47 comments look like effort ratings,  │
│ for example "@8" or "RPE 9".           │
│ (•) Keep as notes only                 │ default: nothing extracted
│ ( ) Review and import as RPE           │
```

`Review and import as RPE` opens a list: `"@8 felt heavy" → RPE 8` with a checkbox per row, all unchecked, plus `Select all`. Only checked rows set RPE; the comment is kept either way.

```
│ Dates that already have a workout      │
│ 3 dates already have a workout logged  │
│ in Fizz (newest: Sat 10 Oct).          │
│ (•) Skip those dates                   │ default, same as FitNotes 2
│ ( ) Import them as extra workouts      │
```

```
│ Where were these workouts?             │
│ (•) Not recorded                       │ default: don't assume
│ ( ) All at Main Gym                    │
│ ( ) All at Home                        │
│ "Last" values in a workout only use    │
│ history from matching equipment. With  │
│ "Not recorded", imported sets show in  │
│ your history but may not appear as     │
│ "Last".                                │
```

The last line depends on an open domain decision (§8, P-I3); the copy is final only once that's settled.

**Step 3d: one imported workout** (tap a row under `Workouts`). Read-only. Each set shows the mapped value and the original:

```
│ Wed 1 Oct 2026 · date only             │
│ Bench press (barbell)                  │
│ 1  100 kg × 8                          │
│    FitNotes row 4,180: Flat Barbell    │
│    Bench Press · 100 kgs · 8 · "@8"    │ text.secondary
│ 2  100 kg × 7                          │
│    FitNotes row 4,181: …               │
```

**Step 4: importing.**

```
┌────────────────────────────────────────┐
│ Importing from FitNotes                │
├────────────────────────────────────────┤
│ 180 of 412 workouts                    │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░                     │ ProgressLine, no animation
│                                        │
│ Keep Fizz open. If it closes, you can  │
│ carry on from here.                    │
│                                        │
│ Stop                                   │ text button
└────────────────────────────────────────┘
```

**Step 5: results.**

```
┌────────────────────────────────────────┐
│ ✓ Import finished                      │ status.done.subtle banner
├────────────────────────────────────────┤
│ 412 workouts · 4,105 sets added        │
│ From FitNotes_Export_2026_10_01.csv    │
│                                        │
│ Skipped                                │
│ 86 cardio rows                       › │
│ 7 rows couldn't be read              › │
│ 3 dates already in Fizz              › │
│ 40 sets of Hammer Strength Row       › │
│   (you chose Skip)                     │
│                                        │
│ Save row-by-row results (CSV)          │ accent text button
│ Undo this import                       │ accent text button
├────────────────────────────────────────┤
│ [               Done                 ] │
└────────────────────────────────────────┘
```

Each skipped category lists its rows: `Row 1,204 · 2024-05-03 · Treadmill · 5 km · 25:00 — cardio isn't imported yet`.

### 2.6 Export

```
┌────────────────────────────────────────┐
│ ‹ Back         Export workouts         │
├────────────────────────────────────────┤
│ Format                                 │
│ (•) Spreadsheet (CSV)                  │
│     One row per set. Opens in Numbers, │
│     Excel or Google Sheets.            │
│ ( ) Full data (JSON)                   │
│     Workouts, routines, gyms, coach    │
│     decisions and memories.            │
│ ( ) FitNotes 2 CSV                     │
│     For importing into FitNotes 2.     │
│     Set types, RPE and load            │
│     conventions are lost.              │
│                                        │
│ Range                                  │
│ (•) All time · 412 workouts            │
│ ( ) Last 30 days · 14 workouts         │
│ ( ) Choose dates…                      │
│                                        │
│ Include warm-up sets           [ On ]  │
│                                        │
│ Exports can't be restored into Fizz.   │
│ Use Back up for that.                  │
├────────────────────────────────────────┤
│ [              Export                ] │
└────────────────────────────────────────┘
```

`Export` builds the file, then opens the iOS share sheet (Save to Files, AirDrop, Mail).

### 2.7 Delete all data

```
┌────────────────────────────────────────┐
│ ‹ Back         Delete all data         │
├────────────────────────────────────────┤
│ This removes from this iPhone:         │
│ • 412 workouts and all their sets      │
│ • Routines, gyms and equipment         │
│ • Coach chats and memories             │
│ • Coach sign-in and API keys           │
│ • Settings, scheduled alerts and the   │
│   copy kept to undo a restore          │
│ • Backup copies inside Fizz            │
│                                        │
│ Not removed:                           │
│ • Backups in iCloud Drive › Fizz       │
│   backups. Delete them in Files if you │
│   want them gone.                      │
│ • Anything OpenAI keeps under your own │
│   account.                             │
│                                        │
│ Last backup: Thu 8 Oct, 19:05          │
│ [            Back up first           ] │ secondary button
│                                        │
│                                        │ space.8
│ Delete everything                      │ status.danger text button
└────────────────────────────────────────┘
```

`Delete everything` → system alert:

> **Delete all Fizz data?**
> This can't be undone. Backups in your folder are kept.
> [Cancel] [Delete] (destructive)

---

## 3. States

### 3.1 Backup status (status card, Today banner, summary line)

`getBackupStatus` decides the state; screens never compute it.

| State | Trigger | Card | Elsewhere |
|---|---|---|---|
| Not set up | No backup has ever been written to a folder outside Fizz | `⚠ Not backed up yet` + `Choose backup folder` | Today banner until done (system-states.md, priority T4). Onboarding Ready shows `(!) Not backed up yet` (onboarding.md) |
| Folder needed | A one-off file was saved (onboarding's export picker), but there's no folder Fizz can write to again | `⚠ Automatic backups need a folder` · `Your backup from Thu 8 Oct is saved, but Fizz can't add new ones there.` + `Choose backup folder` | Today banner after the first finished workout that isn't backed up |
| Backed up | The newest backup in the folder includes every finished workout | `✓ Backed up · Thu 8 Oct, 19:05` | Summary line `Backed up · 19:05` (proposed, §8 X2) |
| Backing up | `createBackup` + write in progress (normally < 2 s) | `Backing up…` (static icon); `Back up now` disabled | Summary line `Backing up…` |
| Behind | A finished workout isn't in any folder backup (automatic backups off, or the last attempt failed) | `⚠ 2 workouts aren't backed up` + `Last backup: Tue 6 Oct, 18:51` | Today banner once the oldest unbacked workout is 24 h old (`timing.backupOverdue`) |
| Failed: folder unreachable | Bookmark stale, folder deleted or moved, provider signed out | `⚠ Last backup didn't save` · `The folder can't be reached. A copy is kept on this phone until it can be saved.` + `Choose backup folder` | Today banner (priority T5) |
| Failed: storage full | Write failed for lack of space | `⚠ Last backup didn't save` · `This iPhone is out of space. Free some up, then tap Back up now.` | Today banner |
| On this phone only | Only Fizz's own copies exist | `ⓘ Backed up on this phone only` · `This copy is deleted with the app.` | Same as Not set up |
| Includes damaged records | `createBackup` returned an integrity report with problems (ADR 0005 #3) | `⚠ Backup saved, but it can't be restored` · `It includes 1 damaged record (workout on Tue 6 Oct). Your newest good backup: Sun 4 Oct.` + `Details` | system-states.md data integrity |

The file is written to the folder, and iCloud uploads it later if Ben is offline. The card says `iCloud uploads it when you're back online.` only when the folder is in iCloud Drive and the device is offline; Fizz doesn't claim to know upload status.

### 3.2 Automatic backup

| State | Trigger | Behaviour |
|---|---|---|
| Runs | `SessionFinished` committed and `After each workout` is on | Runs after the summary is shown. Never delays the summary, `Done` or the next workout. Also runs after a FitNotes import commits and after a restore (a snapshot of the restored data) |
| App backgrounded during a run | Ben locks or leaves right after Finish | The write finishes within iOS's short background grace period. If iOS stops it, it runs again on the next launch |
| Workout started during a run | Ben starts again immediately | The backup reads a consistent snapshot through the serialised queue (ADR 0005); logging isn't blocked |
| Off | Ben turned the switch off | Card shows `Automatic backups are off.` under the status. `Behind` applies after 7 days without a manual backup |
| Rotation | More automatic files than `Keep` | Oldest automatic files Fizz wrote are deleted after the new one is written and checked. Manual files are never deleted |

### 3.3 Restore

| State | Display | Next |
|---|---|---|
| Unavailable: workout unfinished | Rows disabled, `Finish or discard your workout first (Push A, started 18:02).` | Finishing re-enables |
| Choosing | §2.3 step 1 | Pick a file |
| Checking | §2.3 step 2 | Preview, or a failure state below |
| Preview | §2.3 step 3 | Restore / Back |
| Identical | Preview replaced by `This backup matches your data on this phone. Nothing to restore.` | `Done` |
| Not a Fizz backup | `This isn't a Fizz backup file. Nothing was changed.` | Choose another |
| Damaged file | `This backup file is damaged (its checksum doesn't match). Nothing was changed.` + `Your newest good backup: Sun 4 Oct` when one is known | Choose another |
| Damaged records | `This backup has 2 damaged records (workouts on Mon 5 Oct and Tue 6 Oct), so it can't be restored. Nothing was changed.` No "skip damaged records" option (ADR 0005 #3) | Choose another |
| From a newer Fizz | `This backup was made by a newer Fizz (build 15). Install build 15 or newer first. Nothing was changed.` | `Done` |
| Restoring | `BlockingCover` (§2.3 step 5). Logging blocked: the database is closed. Alerts cancelled, Live Activity ended | Done, or failed |
| Failed before the switch | `Restore didn't finish: <reason>. Your data is as it was.` | Back to preview |
| Interrupted (app killed) | Next launch, before anything else: `A restore was interrupted. Your data is as it was before.` (StatusBanner, once) | Today |
| Done | §2.3 step 6 | `Done` → Today with fresh services; normal cold-start logic runs (flow §4.2) |
| Undo restore available | `Undo last restore` row with `Brings back your data from before Thu 8 Oct, 19:20` | Rollback |
| After undo | Row reads `Switch back to the restored backup` (rollback swaps; ADR 0005) | Rollback again |

### 3.4 FitNotes import

| State | Display | Primary |
|---|---|---|
| Unavailable: workout unfinished | Intro shows `Finish or discard your workout first.` | Disabled `Choose CSV file` |
| Reading | `Reading file… 2,000 of 4,212 rows` | — |
| Not a CSV / empty | `This file is empty.` or `This isn't a CSV file.` | `Choose another file` |
| FitNotes backup, not CSV | `This looks like a FitNotes backup, not a CSV export. Export a CSV from FitNotes and choose that.` | `Choose another file` |
| Unknown header | `Fizz doesn't recognise this file's columns yet.` + the first line shown in a monospaced box (max 3 lines, tail ellipsis) + `Copy first line` (for the developer). Nothing guessed | `Choose another file` |
| Same file again | `You imported this file on Thu 8 Oct (412 workouts). Nothing new to import.` + `View that import ›` | `Done` |
| Newer export of an earlier file | Preview as normal, plus `ⓘ 312 workouts came in with your import on Thu 8 Oct. They'll be skipped.` Fizz's version always wins, including sets Ben corrected since | as preview |
| Needs answers | §2.5 step 3 | Disabled `Answer 3 questions to import` |
| Ready | All answered | `Import 412 workouts` |
| Backing up first | Commit tapped and a folder is set | `Backing up before import…` then importing |
| Importing | §2.5 step 4 | — |
| Stopped / interrupted | `Import paused at 180 of 412 workouts. The 180 are in your history.` | `Continue import` + text button `Undo this import` |
| Write failed mid-way | `Couldn't save workout 181 (Mon 3 Jun 2024): <reason>. 180 workouts are in. Nothing was half-saved.` | `Try again` + `Undo this import` |
| Finished | §2.5 step 5 | `Done` |
| Reverted | Import history row: `Undone on Fri 9 Oct · 412 workouts hidden` | — |

### 3.5 Export

| State | Display |
|---|---|
| Nothing to export | `No workouts in this range.` `Export` disabled |
| Building | Primary reads `Preparing…` (disabled), `ProgressLine` for > 1 s |
| Ready | iOS share sheet opens |
| Cancelled share | Back on Export, nothing kept |
| Failed | `Couldn't create the file: <reason>.` + `Try again` |

### 3.6 Delete all data

| State | Display |
|---|---|
| Normal | §2.7 |
| Not backed up | The `Last backup` line reads `⚠ Not backed up since Tue 6 Oct (2 workouts since)` |
| Deleting | `BlockingCover`: `Deleting your data…` |
| Coach sign-out failed (offline) | After deleting, one line on the first-run screen: `Fizz couldn't sign out of ChatGPT online. The sign-in was removed from this phone; you can also remove Fizz's access in your ChatGPT account settings.` |
| Interrupted | A marker is written first. The next launch finishes deleting before showing anything, then shows first-run |
| Done | The app opens first-run onboarding (onboarding.md Welcome) |

---

## 4. Interactions

### 4.1 Backup
- `Back up now` → `createBackup` → write to the folder as a **manual** file. Success: card updates; toast `✓ Backed up to iCloud Drive › Fizz backups`. No Undo (harmless).
- `Back up now` long-press or the card's `⋯` → `Save a copy somewhere else…`: writes the same file through the share sheet (AirDrop to the laptop, Mail).
- `After each workout` switch: on by default once a folder is set. Turning it off shows `Automatic backups are off. Fizz will remind you after 7 days.`
- `Backup folder` → sheet §2.2. Changing it doesn't move old files.
- `Keep automatic backups` → `Last 7` / `Last 14` (default) / `Last 30` / `All`. Lowering it shows `Fizz will delete 16 older automatic backups from the folder at the next backup. Backups you made yourself are kept.` [OK] [Cancel].
- `Copies on this phone` lists Fizz's own last 3 copies with dates and `Restore` on each (useful when the database won't open). The header says `These are deleted with the app.`
- **Trial-run reminder.** Until Ben taps `Mark as done`, the card shows: `Before real workouts: do the trial run in the SideStore guide (update over the top, skip a refresh, restore).` [Mark as done]. It stores the date. Fizz can't verify it, so it never claims to.

### 4.2 Restore
- Rows in the choose list open the check, then the preview. `Choose another file…` opens the system picker filtered to JSON.
- `Restore` → alert if needed → cover → done. Before the switch: `cancelObsoleteCues` for every timer, end any Live Activity, cancel AlarmKit alarms.
- No cancel during the cover: the whole operation is a few seconds and a cancel mid-switch adds a failure mode. A crash before the switch leaves current data untouched (ADR 0005).
- `Undo restore` / `Undo last restore` → `Bring back your data from before Thu 8 Oct, 19:20? The restored backup is kept, so you can switch again.` [Cancel] [Undo restore] → same cover with `Switching back…`.
- After any restore or rollback: normal cold-start logic (flow §4.2). An unfinished workout inside the backup is usually older than 6 h, so Today shows the stale-workout card; no timers are rescheduled for deadlines in the past.

### 4.3 Import
- `Choose CSV file` → system document picker (types: CSV and plain text). The file is copied into the app's cache before reading. Comma, semicolon and tab delimiters are accepted only when the header matches a known format.
- The preview is paged: the workouts list loads in pages of 50. A 10,000-row file must show the preview's summary within 5 s on the iPhone 17 (to measure).
- Each `ImportQuestionRow` opens its screen; `Done` returns and the row shows `✓` with the answer (`Dumbbells: each`).
- `Gym` row and all questions can be changed until commit. Changing an answer bumps `mappingVersion`; a commit with an old version is rejected (rule 5).
- `Import 412 workouts` → backup first (if a folder is set) → `commitImport` in batches of one workout each, each batch atomic. Same `operationId` on retry, so a relaunch can't duplicate.
- `Stop` → `Stop importing? 180 workouts are already in your history.` [Keep going] [Stop]. Stopped imports resume from Data & backup → `Past imports` or the intro screen (`Continue import`).
- `Undo this import` → `Undo this import? 412 workouts from FitNotes_Export_2026_10_01.csv will be hidden from history, Progress and targets. Your other workouts aren't touched.` [Cancel] [Undo import]. Calls `revertImport`. If a reverted workout was corrected later, it's still hidden (the import owns it); the toast says `412 workouts hidden. You can import the file again.`
- `Save row-by-row results (CSV)` → share sheet: `row, date, exercise, result, detail` (`imported`, `skipped_cardio`, `skipped_duplicate`, `skipped_date_exists`, `skipped_exercise`, `unreadable`).
- Comments and exercise names are shown as plain text. The coach, when it reads imported history, receives them quoted as data, never as instructions (rule 8).

### 4.4 Export
- Formats:
  - **Spreadsheet (CSV)**, UTF-8 with BOM (so Excel reads it), ISO dates, `.` decimals whatever the locale. Columns: `date, start_local, end_local, timezone, workout, gym, exercise, equipment, set_number, set_type, side, status, load, unit, load_convention, reps, duration_s, rpe, rir, target_load, target_reps, target_source, edited, notes, source, source_row`. Only completed and skipped sets; deleted sets are excluded. Loads are actual results; target columns are labelled `target_*`.
  - **Full data (JSON)** by entity: workouts with sets and audit, routines, gyms and equipment, exercises and aliases, coach proposals and actions (before/after, scope, reason, status), coaching memories, import jobs. Not restorable (backups are).
  - **FitNotes 2 CSV** with the documented import header (`Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind`). Per-dumbbell loads are written as recorded; the lossy note is shown on the option.
- Range `Choose dates…` opens two date pickers; the count updates.

### 4.5 Delete all data
Order, each step idempotent, behind a `deleteInProgress` marker:
1. `disconnectAiConnection` for every connection (revoke where supported; offline is fine), then delete every Keychain item Fizz owns, by listing the known keys.
2. Cancel every scheduled notification and AlarmKit alarm; end every Live Activity; stop audio.
3. Close the database; delete the current and previous database files with their `-wal`/`-shm`, `fizz-meta.db`, local backup copies, the probe database and cached import files.
4. Release the backup folder bookmark.
5. Clear the marker and relaunch into first-run.

### 4.6 Keyboard, voice and undo summary
- Keyboard: only search fields (exercise picker) and date pickers. Primary actions sit in the fixed footer above the keyboard.
- Voice: none. The coach can explain these screens but can't run them (DX10).

| Action | Undo |
|---|---|
| Backup | None needed |
| Folder change | Choose again |
| Retention lowered | Confirmed first; raise it again before the next backup to keep the files |
| Restore | `Undo restore` (one generation) |
| Undo restore | `Switch back to the restored backup` |
| Import | `Undo this import` (revert) |
| Import answers | Change before commit |
| Export | None needed |
| Delete all data | None. `Back up first` and a confirmation instead |

---

## 5. Copy

| Element | Text |
|---|---|
| Hub title | `Data & backup` |
| Status | `✓ Backed up · Thu 8 Oct, 19:05` · `⚠ Not backed up yet` · `⚠ 2 workouts aren't backed up` · `⚠ Last backup didn't save` · `ⓘ Backed up on this phone only` · `⚠ Automatic backups need a folder` · `Backing up…` |
| Status details | `412 workouts · 4,105 sets` · `Last backup: Tue 6 Oct, 18:51` · `The folder can't be reached. A copy is kept on this phone until it can be saved.` · `This copy is deleted with the app.` · `iCloud uploads it when you're back online.` |
| Buttons | `Back up now` · `Choose backup folder` · `Choose a folder` · `Check` · `Restore` · `Undo restore` · `Choose CSV file` · `Import 412 workouts` · `Answer 3 questions to import` · `Export` · `Back up first` · `Delete everything` · `Done` |
| Folder sheet | `Fizz saves a backup here after every workout. Pick a folder outside Fizz, like iCloud Drive, so it survives if the app is deleted.` · `Backups are plain files with your training data. They never contain your coach sign-in or API keys.` · `That folder is deleted with the app. Choose iCloud Drive or another folder.` |
| File names | `fizz-backup-2026-10-08-1905-auto.json` · `fizz-backup-2026-10-08-1912.json` (manual). Local time in the name; UTC + zone inside the file |
| Toasts | `✓ Backed up to iCloud Drive › Fizz backups` · `412 workouts hidden. You can import the file again.` |
| Trial run | `Before real workouts: do the trial run in the SideStore guide (update over the top, skip a refresh, restore).` · `Mark as done` · after: `Trial run done · Fri 9 Oct` |
| Restore preview | `Made Thu 8 Oct 2026, 19:05` · `✓ Checked: complete, no damaged records` · column heads `Backup` / `This phone` · `⚠ 3 workouts on this phone aren't in this backup (newest: Sat 10 Oct). They'll be replaced.` · `ⓘ This backup is from an older Fizz. It's updated as it's restored.` · `ⓘ Coach sign-in and API keys aren't part of backups. Yours stay as they are.` (on a fresh install: `… You'll connect the coach again in Profile.`) · `ⓘ You can undo this from Data & backup.` |
| Restore alert | `Replace this phone's data?` / `3 workouts on this phone aren't in the backup from Thu 8 Oct, 19:05. You can undo this from Data & backup.` [Cancel] [Restore] |
| Restoring cover | `Restoring your data` · `Backup checked` · `Workouts loaded (412)` · `Checking every record` · `Switching to the restored data` · `Keep Fizz open. If it closes now, your current data stays as it is.` |
| Restore done | `✓ Restored` · `Your data now matches the backup from Thu 8 Oct, 19:05.` |
| Restore failures | `This isn't a Fizz backup file. Nothing was changed.` · `This backup file is damaged (its checksum doesn't match). Nothing was changed.` · `This backup has 2 damaged records (…), so it can't be restored. Nothing was changed.` · `This backup was made by a newer Fizz (build 15). Install build 15 or newer first. Nothing was changed.` · `This backup matches your data on this phone. Nothing to restore.` · `Restore didn't finish: <reason>. Your data is as it was.` · `A restore was interrupted. Your data is as it was before.` · `Finish or discard your workout first (Push A, started 18:02).` |
| Undo restore | Row `Undo last restore` + `Brings back your data from before Thu 8 Oct, 19:20` · alert `Bring back your data from before Thu 8 Oct, 19:20? The restored backup is kept, so you can switch again.` · after: `Switch back to the restored backup` |
| Check result | `✓ This backup restores` · `⚠ This backup won't restore` · `Nothing on this phone was changed.` · `Your newest good backup: Sun 4 Oct.` |
| Import intro | `Bring in your FitNotes history from a CSV export.` · `In FitNotes, export a CSV and save it to Files.` · `Choose it here. You'll see what will be imported before anything is saved.` · `Works with FitNotes (Android) and FitNotes 2 (iPhone) CSV files.` |
| Import detection | `FitNotes (Android) CSV · weights in kg` · `FitNotes 2 (iPhone) CSV · weights in lb` · `4,212 rows · 2 Mar 2019 – 1 Oct 2026` |
| Preview headings | `Will import` · `Needs your answer (3)` · `Will be skipped` · `Kept as written` · `Workouts (412)` |
| Skips | `86 cardio rows (not imported yet)` · `7 rows can't be read` · `3 dates already have a Fizz workout` · `312 workouts came in with your import on Thu 8 Oct. They'll be skipped.` |
| Kept as written | `212 comments, kept as notes` · `47 look like effort ratings. Review` · `FitNotes files have no times. These workouts show the date only.` |
| Match status | `Matched` · `Check` · `No match` · buttons `Use this` · `Choose…` · `Add new` · `Skip` · `34 matched by name · Show` |
| Convention questions | `FitNotes doesn't record whether a dumbbell weight is one dumbbell or both together.` · `For these 9 exercises, "22.5" means:` · `Each dumbbell` / `Imported as 22.5 kg each` · `Both dumbbells together` / `Imported as 11.25 kg each` · `Total, including the bar` · `Plates only (bar not counted)` · `Weight added to bodyweight` · `Assistance from a machine` · `Values in your file: 0 to 20, none negative` · `Different for some?` · `Same` |
| Other questions | `Rows have values in both the kg and lb columns. Which did you enter in FitNotes?` · `Keep as notes only` / `Review and import as RPE` · `Skip those dates` / `Import them as extra workouts` · `Not recorded` / `All at Main Gym` |
| Provenance (history set detail) | `Imported from FitNotes on Thu 8 Oct 2026 · row 4,180` · `Original: Flat Barbell Bench Press · 100 kgs · 8 reps · "@8 felt heavy"` |
| Import errors | `This file is empty.` · `This isn't a CSV file.` · `This looks like a FitNotes backup, not a CSV export. Export a CSV from FitNotes and choose that.` · `Fizz doesn't recognise this file's columns yet.` · `Copy first line` · `You imported this file on Thu 8 Oct (412 workouts). Nothing new to import.` |
| Importing | `Importing from FitNotes` · `180 of 412 workouts` · `Keep Fizz open. If it closes, you can carry on from here.` · `Backing up before import…` · `Import paused at 180 of 412 workouts. The 180 are in your history.` · `Continue import` |
| Results | `✓ Import finished` · `412 workouts · 4,105 sets added` · `Save row-by-row results (CSV)` · `Undo this import` · row detail `Row 1,204 · 2024-05-03 · Treadmill · 5 km · 25:00 — cardio isn't imported yet` |
| Undo import alert | `Undo this import?` / `412 workouts from FitNotes_Export_2026_10_01.csv will be hidden from history, Progress and targets. Your other workouts aren't touched.` [Cancel] [Undo import] |
| Export | `Spreadsheet (CSV)` / `One row per set. Opens in Numbers, Excel or Google Sheets.` · `Full data (JSON)` / `Workouts, routines, gyms, coach decisions and memories.` · `FitNotes 2 CSV` / `For importing into FitNotes 2. Set types, RPE and load conventions are lost.` · `Include warm-up sets` · `Exports can't be restored into Fizz. Use Back up for that.` · `No workouts in this range.` · `Preparing…` |
| Delete | list in §2.7 · alert `Delete all Fizz data?` / `This can't be undone. Backups in your folder are kept.` [Cancel] [Delete] · cover `Deleting your data…` |

Spoken cues: none. These screens are never used mid-set.

---

## 6. Data needed

From the brief and ADR 0005:
- `createBackup(store, {at, app})` → `{text, suggestedFileName, integrityReport}`; the native layer writes the file.
- `restoreBackup(file)` via `DatabaseManager`: parse and verify → preview → build → load → migrate → integrity check → pointer switch. Returns `restored | unchanged | failed{reason}`.
- `DatabaseManager.rollback()` for Undo restore (swaps current and previous).
- `checkIntegrity()` (ADR 0005).
- `previewFitNotesImport(file)` → `{jobId, format: 'fitnotes_android_csv' | 'fitnotes2_csv' | 'fitnotes_backup' | 'unknown', header, unit, rowCount, dateRange, workouts[], exerciseMatches[{sourceName, setCount, status: 'matched' | 'check' | 'no_match', suggestion?}], conventionQuestions[], unitQuestion?, rpeCandidates[], skipped{cardio[], unreadable[], datesInFizz[], alreadyImported{jobId, count}}, sameFileAs?: jobId, mappingVersion}`. Checksum (SHA-256, the pure implementation from ADR 0005) identifies the same file.
- `commitImport(jobId, mappingVersion, operationId)` → per-workout batches, per-row results, resumable.
- `exportTrainingData(userId, format: 'csv' | 'json' | 'fitnotes2_csv', range, {includeWarmups})`.
- `getActiveSession(userId)` to block restore and import while a workout is unfinished.
- `disconnectAiConnection(connectionId)` (brief §2) during delete.
- `cancelObsoleteCues`, Live Activity end, AlarmKit cancel (lock-screen-and-alerts.md) before restore and delete.
- Catalogue: exercise picker and alias matching from `packages/catalogue`.

**Proposed new functions** (contracts for the developer):

| Function | Purpose |
|---|---|
| `getBackupStatus(ownerId)` → `{state, lastSuccess?{atUtc, zone, destinationLabel, fileName, counts}, lastAttempt?{atUtc, error?}, autoEnabled, keep, folder?{label, reachable, insideApp}, unbackedWorkouts, localCopies[], trialRunDoneAt?}` | One source for the card, Today banner and summary line |
| `writeBackupFile(folderBookmark, fileName, text)` / `pickBackupFolder()` / `listBackupsInFolder()` / `rotateAutomaticBackups(keep)` | Native Files layer (security-scoped bookmark). Rotation deletes only files whose name and recorded checksum match ones Fizz wrote |
| `verifyBackup(file)` → `{ok, counts, schemaVersion, needsMigration, problems[]}` | ADR 0005 restore steps 1–4, then discard. Also used by onboarding.md |
| `previewRestore(file)` → ADR 0005 preview plus `onlyOnPhone{workouts, newestDate}` and `currentHasUnfinishedWorkout` | Drives the "will be replaced" warning |
| `updateImportMapping(jobId, answers, expectedMappingVersion)` → new `mappingVersion` | Answers to every question; stale versions rejected |
| `revertImport(jobId, expectedVersion, operationId)` | Marks the job's sessions `reverted` (audited); excluded from history, Progress, comparable history and targets |
| `listImportJobs(ownerId)` / `getImportJob(jobId)` | Past imports, resume, row results |
| `deleteAllData(ownerId, confirmation)` | §4.5 sequence behind a marker; resumable |

---

## 7. Acceptance checks

Backup
1. With a folder set, finishing a workout writes `fizz-backup-…-auto.json` to that folder within 10 s, and the summary and `Done` are never delayed by it (test with a write delayed 10 s).
2. With the folder deleted in Files, the next automatic backup shows `⚠ Last backup didn't save`, keeps a copy in Fizz's own folder, and the Today banner appears. Choosing a folder again and tapping `Back up now` clears both.
3. `Back up now` with airplane mode on and the folder in iCloud Drive succeeds and says `iCloud uploads it when you're back online.`
4. A backup file never contains any Keychain value (search the file for the stored token and API key test values).
5. With `Keep: last 14` and 15 automatic files, the oldest automatic file is deleted only after the new one is written; manual files and a file Ben copied into the folder are untouched.
6. Choosing a folder inside Fizz's container shows `That folder is deleted with the app…` and doesn't save it.

Restore
7. With an unfinished workout, restore rows are disabled with the `Finish or discard your workout first` line.
8. The preview counts match the file's `counts` and the current database; a backup missing 3 newer workouts shows the warning and the confirmation alert; one that contains everything shows no alert.
9. Restoring a file identical to the data shows `This backup matches…` and leaves the rollback target unchanged.
10. A file with an edited byte shows the checksum failure; a backup from a higher schema shows the newer-Fizz message; neither changes the database file (compare its hash before and after).
11. During the restore cover, no Log, notification tap or deep link can write; queued writes on the old store fail with "Database is closed" and nothing reaches the new file (ADR 0005).
12. Force-quit during the cover before the switch: on relaunch the old data is intact and `A restore was interrupted…` shows once. Force-quit after the switch: restored data shows.
13. `Undo restore` brings back the previous data; `Switch back to the restored backup` swaps again.
14. After a restore, no rest alert or Live Activity from the replaced data fires.

Check a backup
15. `Check` never changes the database file, its pointer or the rollback target (onboarding.md check 7), and reports the file's counts.

Import
16. The Android header (`Weight (kgs)`, `Comment`) and the FitNotes 2 header (`Weight (kg)`, `Notes`, `Kind`) are detected and named; any other header stops with the first line shown and `Copy first line`. (Re-run against Ben's real export before calling this done.)
17. `Import …` stays disabled until every exercise is matched or skipped and every convention group is answered; no convention option is pre-selected.
18. "Both dumbbells together" on `22.5` imports `11.25 kg each`, and the set's provenance shows the original `22.5`.
19. No kg↔lb conversion happens anywhere in the import; a lb file imports lb values with unit `lb`.
20. RPE is set only for rows Ben checked; every comment is kept as a note either way.
21. Importing the same file twice: the second attempt shows `You imported this file on …` and commits nothing (brief scenario 6). Importing a newer export skips the earlier rows and never overwrites a set corrected in Fizz.
22. Dates with an existing Fizz workout are skipped by default and listed in the results.
23. Kill the app at 180 of 412: relaunch shows `Import paused at 180 of 412…`; `Continue import` finishes with exactly 412 workouts (no duplicates, same operation IDs).
24. Every imported set shows its source file, row number and original values; the import job keeps every source row, so a backup carries them.
25. `Undo this import` hides all 412 workouts from history, Progress, "Last" values and targets, deletes nothing (row counts unchanged), and the file can be imported again.
26. An exercise name or comment containing instruction-like text (`ignore previous instructions`) is stored and shown as text, and reaches the coach only as quoted data.
27. A 10,000-row file shows its preview summary within 5 s on Ben's iPhone, and the workouts list scrolls without loading everything at once.

Export
28. CSV opens in Numbers with correct columns, `.` decimals, ISO dates, units and conventions in their own columns, and no deleted sets; loads are actuals and targets are in `target_*` columns.
29. FitNotes 2 CSV uses exactly the documented header.

Delete
30. After `Delete everything`: the database files (with `-wal`/`-shm`), meta file, previous generation, local copies and every Fizz Keychain item are gone; no notification or alarm remains scheduled; no Live Activity is running; the backup folder's files are untouched; the app shows first-run.
31. Kill the app mid-delete: relaunch finishes the deletion before showing anything.

General
32. All counts and dates use tabular numerals; all text ≥ 16pt at default size; every status has an icon and text; every screen works at AX3 with the primary visible.
33. None of these actions can be triggered by the coach or by voice.

---

## 8. Proposed changes (for Ben / the product manager)

| # | Change | Reason |
|---|---|---|
| P-B1 | ADR 0004 says "SQLite snapshot + JSON export". Adopt ADR 0005's JSON-only snapshot in the design; no raw `.db` copy | One format to restore and test (ADR 0005 #1) |
| P-B2 | Ben confirms plain-JSON backups (ADR 0005 #2); the folder sheet tells him what's in them | He decides with the facts visible |
| P-B3 | Add `verifyBackup`, `previewRestore` (with `onlyOnPhone`), `getBackupStatus`, `revertImport`, `updateImportMapping`, `deleteAllData` to the service contracts (brief §7) | Needed by this spec and onboarding.md |
| P-B4 | Restore and import are blocked while a workout is unfinished (DX4) | Avoids replacing or reshaping history the live workout reads |
| P-B5 | Automatic backups need persistent write access to one folder (security-scoped bookmark). Device test `DEP-FILES`: does the bookmark survive relaunch, a SideStore refresh and an update over the top on a free-signed build, with no iCloud entitlement? **Fallback if not:** automatic backups go to Fizz's own folder (labelled `On this phone only`), and after each workout the summary line offers `Save a copy off the phone` (one tap + the system export picker) | Without it, "automatic backup after each finished workout" (research rec. 4) isn't possible |
| P-I1 | Unknown FitNotes headers stop the import; no manual column mapping (DX5) | Honest; brief v0.2 asks for the real export first |
| P-I2 | Convention questions have no default (DX6) | Rule 6 |
| P-I3 | **Domain decision needed:** can imported sets without an equipment instance count as comparable history ("Last" values, targets) when exercise, unit and convention match? Options: (a) never; (b) yes, labelled `Last (FitNotes, 1 Oct)`; (c) only when Ben assigned a gym and that gym has exactly one instance of the equipment type. Designer recommends (b) | Without it, importing years of history doesn't help the next workout |
| P-I4 | Cardio rows are skipped (listed, never lost) until endurance imports exist (build step 6) | Scope |

### Cross-spec proposals (other designers' files; not edited here)
- **X1 (onboarding.md §2.5, §4.3):** change `Save backup file` (one-off export picker) to `Choose backup folder` (folder picker + bookmark), then write the file there. Same tap count, and automatic backups work from the first workout. Until then, the data area shows `Automatic backups need a folder` after the first finished workout.
- **X2 (workout-summary.md §2, region 1):** under `✓ Workout saved on this phone`, one line from `getBackupStatus`: `Backed up · 19:05` / `Backing up…` / `⚠ Backup didn't save. Open Data & backup ›`. Never blocks `Done`.
- **X3 (profile-and-settings.md):** the Profile list row `Data & backup` carries the attention marker when the backup state is Not set up, Folder needed, Behind or Failed (icon + text, not a dot alone).

---

## Proposed design-system additions

No new colours. All additions reuse existing tokens.

| Addition | Spec |
|---|---|
| `BlockingCover` | Full screen, `bg.canvas`, no nav/tab bar, centred `type.title2` title, a step list (`StepRow`: `checkmark.circle.fill` in `status.done` = done, static `ellipsis` in `text.secondary` = current, `circle` in `text.tertiary` = to do; `type.body`), and one `type.callout` line in `text.secondary`. No buttons unless the state needs them. No animation; Reduce Motion changes nothing. VoiceOver announces the title, then each completed step politely. Used for restore, rollback, delete and database update (system-states.md) |
| `ProgressLine` | Determinate linear bar, 4pt tall, `radius.pill`, fill `accent` on `bg.raised`, always with a text count above (`180 of 412 workouts`, tabular). The bar jumps to each new value without animation. Never indeterminate, never a ring |
| `CountCompareTable` | Label column `type.callout` `text.secondary`; value columns right-aligned `type.callout` tabular `text.primary`; header `type.label`. At AX1+ each row stacks into `Label` / `Backup 412 · This phone 415` |
| `ImportQuestionRow` | 52pt row: status icon + one or two lines `type.body` + `chevron.right`. Unanswered: `exclamationmark.triangle` `status.warning`; answered: `checkmark.circle.fill` `status.done` + answer text in `text.secondary`; info: `info.circle` `text.secondary` |
| Match status styles | `Matched` `checkmark.circle.fill` `status.done`; `Check` `questionmark.circle` `status.warning`; `No match` `xmark.circle` `text.secondary`; `Skipped` `slash.circle` `text.tertiary`. Always icon + word |
| Backup status labels (add to §7 session status table) | `Backed up` `externaldrive.fill.badge.checkmark` `status.done`; `Not backed up` `externaldrive.badge.exclamationmark` `status.warning`; `Backing up` static `ellipsis` `text.secondary`; `On this phone only` `iphone` `status.warning` |
| `timing.backupOverdue` | 24 h after the oldest unbacked finished workout before Today shows `Behind` |
| Danger text button | `type.headline` in `status.danger`, ≥ 44pt hit area, ≥ `space.8` from any other button (already used informally in workout-summary.md; make it a named style) |

## Cross-links

- [onboarding.md](onboarding.md): the first-run backup step and `Restore from a backup` on Welcome call this area's `verifyBackup` and restore flow (X1 above).
- [system-states.md](system-states.md): app-wide durability wording (DX1), the Today banners for backup states, the data-integrity states, and `BlockingCover` use outside this area.
- [lock-screen-and-alerts.md](lock-screen-and-alerts.md): alerts, Live Activities and AlarmKit alarms that restore and delete must cancel.
- [workout-summary.md](workout-summary.md): automatic backup trigger after Finish; proposed backup line (X2); the per-session `Share / export` stays there.
- [today.md](today.md) and [progress.md](progress.md): their `Couldn't open your training data.` [Restore from backup] link opens §2.3 here.
- [exercise-library.md](exercise-library.md): the exercise picker used by `Choose…` in import matching.
- profile-and-settings.md (being written by another designer): the Profile row that opens `Data & backup` (X3).
- [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0005](../decisions/0005-persistence-and-backup.md), [guides/sidestore-windows.md](../guides/sidestore-windows.md) §6 and §8 (trial run).
