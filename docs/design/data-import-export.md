# Data: backup, restore, FitNotes import, export and delete

Status: v0.1 draft, 8 Oct 2026. Designer. Tokens: [design-system.md](design-system.md). App-wide wording for saved/backed-up states: [system-states.md](system-states.md).

Sources: brief §5 (data foundation), §7 (`previewFitNotesImport`, `commitImport`, `exportTrainingData`, `createBackup` / `restoreBackup`), §9; [ADR 0004](../decisions/0004-free-distribution-sidestore.md) (backup and a tested restore before any real workout); [ADR 0005](../decisions/0005-persistence-and-backup.md) (backup format, restore, rollback, modal restore); research `free-ios-install.md` §4 and §8, `ios-platform-feasibility.md` §2.2, §2.8 and §5 (FitNotes formats); `guides/sidestore-windows.md` §6 and §8.

> **Revision 2026-10-08 (consolidation).** Two changes approved by Ben (relayed by the product manager) are applied here, and they supersede the earlier text wherever the two disagree:
> 1. **Backups live in the app by default; off-phone copies are optional.** Automatic backups (after each finished workout, rotating) go to Fizz's own container. No folder is needed. `Save a copy to Files` works any time, and `Also back up off the phone automatically` (off by default) is the only thing that uses `Choose backup folder`. Three durability phrases: `Saved on this phone` · `Backed up on this phone` · `Copy saved to Files` (design-system §7.1). Gentle safeguards replace nagging (§4.1a). Cross-spec proposal X1 is withdrawn; X2 and X3 are applied with the new wording.
> 2. **Two data domains: `Your data` and `Coaching knowledge`** (design-system §7.2). A backup file has two separate sections that restore independently; export offers `My data` or `Coaching knowledge only`; delete offers `Delete my data (keep coaching knowledge)` and `Reset coaching knowledge`.
>
> Also: `profile-and-settings.md` now has a single `Data & backup` row (X3); components moved to design-system (§11 index); `timing.backupOverdue` is retired in favour of `timing.offPhoneReminder`.

**Why this matters more than usual.** Fizz is signed with a free Apple ID through SideStore. Deleting the app, or re-signing it with another Apple ID or tool, installs a separate app with an empty database (ADR 0004). Backups on the phone protect against a damaged database or a bad restore, but not against that. Only a copy saved to Files (off the phone) survives it. Fizz says which kind Ben has, every time, and offers a one-tap copy to Files before the moments when it matters (§4.1a), without nagging.

| Part | Milestone |
|---|---|
| Data & backup screen, automatic backups on this phone, `Save a copy to Files`, optional automatic off-phone backups, `Check a backup`, restore by section with preview and Undo restore, `Delete my data` / `Reset coaching knowledge` | First milestone |
| FitNotes import (preview, questions, commit, results, Undo import), import history, portable export (`My data` / `Coaching knowledge only`) | Build step 3 |

---

## 0. Design decisions

These go beyond the brief or settle open items. Each is listed again in "Proposed changes" at the end.

| # | Decision | Why |
|---|---|---|
| DX1 | (Revised.) Exactly three durability phrases exist: **Saved on this phone** (SQLite commit), **Backed up on this phone** (an automatic backup file in Fizz's container includes it) and **Copy saved to Files** (a backup file exists outside the app). There is no "sync" wording, and never a bare "Backed up". | Ben must always know whether a copy exists off the phone. |
| DX2 | (Revised, approved by Ben.) Automatic backups go to **Fizz's own container** after every finished workout, rotating (`Keep last 14`). Off-phone copies are optional: `Save a copy to Files` any time, and `Also back up off the phone automatically` (off by default), which asks Ben to choose a folder once. | Zero setup to be protected against a damaged database or bad restore; the off-phone copy is Ben's choice, offered at the moments it matters. |
| DX11 | (New, approved by Ben.) A backup file has **two sections**, `Your data` and `Coaching knowledge`, each with its own counts and checksum, and each can be restored on its own. Credentials are in neither. | Ben can reset or restore the general coaching knowledge without touching his history, and the reverse. |
| DX12 | (New.) **Safeguards, not nagging.** A one-tap `Save a copy to Files first` is offered just before risky moments (§4.1a). If no copy has been saved to Files for 30 days, one quiet, dismissible row appears in Data & backup and on the Profile row, and Ben can switch that reminder off. Nothing about backups ever appears during a workout or as a Today banner, except a failed on-phone backup (system-states.md T5). | Matches "approved: non-nagging" and keeps the workout screen clean. |
| DX3 | "Tested restore" inside the app is `Check a backup` (`verifyBackup`): rebuild the file into a scratch database, migrate, run the integrity check, compare counts, then throw the copy away. | Restoring a file identical to the current data returns `unchanged` (ADR 0005), which proves less. A real restore with a pointer switch belongs to the device trial run (ADR 0004). Matches onboarding.md §4.3. |
| DX4 | Restore and FitNotes import are unavailable while a workout is unfinished. | Both replace or add history the active workout reads (drafts, "Last" values, timers). Finishing first takes one tap; recovering from a half-restored workout doesn't. |
| DX5 | An unrecognised FitNotes header stops the import. There is no manual column mapping. | The real export hasn't been seen yet (brief v0.2). Letting Ben map columns by hand invites silent misreads (kg vs lb). The fix is a developer adding the variant against his real file. |
| DX6 | Load convention questions (dumbbell each or both, bodyweight added or assisted, barbell total or plates only) have **no pre-selected answer**. One tap answers a whole equipment group, with per-exercise overrides. | The file doesn't record conventions (research §5). Pre-selecting one would be inventing data (rule 6). |
| DX7 | `Undo this import` **reverts** the import's workouts (audited status `reverted`, hidden everywhere). It never deletes rows. | SQLite triggers forbid deleting sessions (ADR 0005); append-only history is the point. |
| DX8 | Backups are plain JSON and never include credentials. `Save a copy to Files` says so in one line. | ADR 0005 open item 2 asks Ben to confirm plain JSON. The copy lets him decide with the facts in front of him. |
| DX9 | Automatic backup files rotate (`Keep: last 14`, editable), on the phone and, if turned on, in the off-phone folder. Fizz deletes only automatic files it wrote itself (name pattern **and** a checksum it recorded). Copies Ben saved himself are never deleted. | A year of workouts is ~200 files of ~1 MB each (ADR 0005 measured 1.2 MB per 300 sessions). Rotation keeps the phone's storage bounded. |
| DX10 | Neither the coach nor voice can start a backup, restore, import, export or delete. | These are not in the restricted tool list (brief §8). Imported files are data, never instructions (rule 8). |

---

## 1. Purpose

| Surface | Question it answers | Single primary action |
|---|---|---|
| Data & backup (Profile → Data & backup) | "Is my training safe, and is there a copy off this phone?" | `Save a copy to Files` |
| Restore | "What will this backup replace, which part, and can I go back?" | `Restore` |
| Check a backup | "Will this file actually restore?" | `Check` |
| FitNotes import | "What will this file add, and is the mapping right?" | `Import 412 workouts` |
| Import results | "What happened to every row?" | `Done` |
| Export | "Get my data, or the coaching knowledge, out in a format other tools read." | `Export` |
| Delete my data / Reset coaching knowledge | "Remove what Fizz holds about me" / "Put the coaching knowledge back to how this build ships it." | None in accent. `Save a copy to Files first` is secondary; the delete or reset is a `DangerTextButton` |

None of these surfaces is reachable from the active workout. They are never shown between sets.

---

## 2. Layout

Design width 390pt; checked at 375 and 430. All counts, dates and sizes use tabular numerals (design-system §3). All rows are at least `target.min` (44pt); primary buttons are `target.primary`.

### 2.1 Data & backup (hub)

Regions, top to bottom (revised, consolidation):
1. **Navigation bar.** `‹ Profile` and the title `Data & backup`.
2. **Backup status card** (`StatusCard`). Two lines, always both: the on-phone line (`✓ Backed up on this phone · 19:05`) and the off-phone line (`✓ Copy saved to Files · Thu 8 Oct` or `ⓘ No copy off this phone yet`). Then what the last backup holds, per domain, and the primary `Save a copy to Files`. Shows the trial-run reminder line until Ben marks it done (§4.1).
3. **Backups on this phone.** `After each workout` (on by default; turning it off asks for confirmation, §4.1), `Keep automatic backups`, `Copies on this phone`, `Check a backup`.
4. **Off this phone (optional).** `Save a copy to Files`, `Also back up off the phone automatically` (switch, off by default; turning it on asks for a folder), `Backup folder` (only when that switch is on), `Remind me if there's no copy off this phone` (switch, on by default; quiet row after 30 days).
5. **Restore.** `Restore from a backup`; `Undo last restore` only when a rollback target exists.
6. **Import.** `Import from FitNotes`, `Past imports`.
7. **Export.** `Export` (`My data` or `Coaching knowledge only`).
8. **Delete and reset.** Two `DangerTextButton`s, separated by `space.8`: `Delete my data (keep coaching knowledge)` and `Reset coaching knowledge`.

```
┌────────────────────────────────────────┐
│ ‹ Profile      Data & backup           │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ ✓ Backed up on this phone · 19:05  │ │ iphone icon, status.done
│ │ ✓ Copy saved to Files · Thu 8 Oct  │ │ externaldrive icon, status.done
│ │ 👤 Your data: 412 workouts ·       │ │ DomainLabel lines
│ │    4,105 sets                      │ │
│ │ 📚 Coaching knowledge: 9 rules ·   │ │
│ │    412 exercises                   │ │
│ │ ┌────────────────────────────────┐ │ │
│ │ │      Save a copy to Files      │ │ │ PrimaryButton
│ │ └────────────────────────────────┘ │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Backups on this phone                  │
│ After each workout             [ On ]  │
│ Keep automatic backups    Last 14    › │
│ Copies on this phone (14)            › │
│ Check a backup                       › │
│ These are lost if Fizz is deleted or   │ text.secondary
│ re-signed with another Apple ID.       │
│                                        │
│ Off this phone (optional)              │
│ Also back up off the phone             │
│ automatically                  [ Off ] │
│ Remind me if there's no copy           │
│ off this phone                 [ On ]  │
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
│ Export                               › │
│                                        │
│                                        │ space.8
│ Delete my data (keep coaching          │ DangerTextButton
│ knowledge)                             │
│                                        │ space.8
│ Reset coaching knowledge               │ DangerTextButton
└────────────────────────────────────────┘
```

Status card variants (icon + text, never colour alone; see §3.1 for triggers):

```
│ ✓ Backed up on this phone · 19:05      │ status.done
│ ⓘ No copy off this phone yet           │ info.circle, text.secondary
│ Copies on this phone are lost if Fizz  │
│ is deleted or re-signed with another   │
│ Apple ID.                              │
│ [        Save a copy to Files        ] │

│ ⚠ Last backup on this phone didn't     │ status.warning
│   save                                 │
│ This iPhone is out of space. Your      │
│ workouts are still saved on this phone.│
│ [      Back up on this phone now     ] │

│ ⚠ Copy to Files didn't save            │ status.warning (automatic off-phone on)
│ The folder can't be reached. Your      │
│ backups on this phone are fine.        │
│ [        Choose backup folder        ] │

│ ⓘ No copy off this phone since 8 Sep   │ quiet reminder (30 days), dismissible
│ [ Save a copy to Files ]   Not now     │
```

### 2.2 Save a copy to Files, and the backup folder sheet

**`Save a copy to Files`** (any time, and in every safeguard prompt) writes the newest backup through the system export picker. The default location is iCloud Drive when available. One line above the picker: `Backups are plain files with your training data and coaching knowledge. They never contain your coach sign-in or API keys.` If the chosen location is inside Fizz's own container: `That's inside Fizz, so it's lost with the app. Choose iCloud Drive or another folder.` After success, toast `✓ Copy saved to Files · iCloud Drive › Fizz backups`.

**Backup folder sheet** (only for `Also back up off the phone automatically`). Medium detent.

```
┌────────────────────────────────────────┐
│ Back up off the phone automatically    │
│                                 Cancel │
│ After each workout, Fizz also saves a  │
│ copy in a folder you choose, like      │
│ iCloud Drive. It survives if the app   │
│ is deleted.                            │
│                                        │
│ Backups are plain files with your      │
│ training data and coaching knowledge.  │
│ They never contain your coach sign-in  │
│ or API keys.                           │
│ ┌────────────────────────────────────┐ │
│ │       Choose backup folder         │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

`Choose backup folder` opens the system folder picker and stores a security-scoped bookmark. If the folder is inside Fizz's container, the sheet says so and keeps the switch off. Whether the bookmark survives a SideStore refresh is the device test `DEP-FILES` (§8 P-B5); it matters only when this switch is on.

### 2.3 Restore

**Before step 1 (safeguard, §4.1a):** if there's no copy in Files newer than the current data, the screen first offers `Save a copy to Files first` (one tap, `SecondaryButton`) with `Skip` beside it. Restore never waits for it.

**Step 1: choose.** List Fizz's own backups on this phone newest first, then (if automatic off-phone backups are on and the folder is reachable) the folder's backups, then `Choose another file…` (system file picker).

```
┌────────────────────────────────────────┐
│ ‹ Back       Restore from a backup     │
├────────────────────────────────────────┤
│ On this phone                          │
│ Thu 8 Oct, 19:05 · after workout     › │
│ Tue 6 Oct, 18:51 · after workout     › │
│ In iCloud Drive › Fizz backups         │ only when off-phone auto is on
│ Mon 5 Oct, 21:10 · saved by you      › │
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

**Step 3: preview.** One primary. The backup's two sections are listed separately, each with its own checkbox (`ChecklistRow`) and counts (revision: two data domains, DX11). Each section restores on its own: restoring `Your data` never changes `Coaching knowledge`, and the reverse.

Pre-selection: when this phone has no data (fresh install or after `Delete my data`), both sections are ticked. Otherwise **neither is ticked** and the primary reads `Choose what to restore` (disabled) until Ben ticks at least one. A section identical to the phone's shows `Same as this phone` and can't be ticked.

```
┌────────────────────────────────────────┐
│ ‹ Back       Restore this backup?      │
├────────────────────────────────────────┤
│ Made Thu 8 Oct 2026, 19:05             │
│ Fizz 0.3 (build 12) · after a workout  │
│ ✓ Checked: complete, no damaged records│
│                                        │
│ [x] 👤 Your data                       │ DomainLabel + ChecklistRow
│                  Backup   This phone   │ CountCompareTable
│ Workouts            412          415   │
│ Sets              4,105        4,140   │
│ Routines              6            6   │
│ Gyms                  2            2   │
│ Coach memories       14           15   │
│ Coach chats          31           33   │
│ ⚠ 3 workouts on this phone aren't in   │ status.warning
│   this backup (newest: Sat 10 Oct).    │
│   They'll be replaced.                 │
│                                        │
│ [ ] 📚 Coaching knowledge              │
│                  Backup   This phone   │
│ Approved rules        9           11   │
│ Exercises           412          414   │
│ Guide index           2            3   │
│ ⓘ Restoring this replaces approved     │
│   rules and your exercise list. Your   │
│   workouts aren't touched.             │
│                                        │
│ ⓘ This backup is from an older Fizz.   │ only when it needs migration
│   It's updated as it's restored.       │
│ ⓘ Coach sign-in and API keys aren't    │
│   part of backups. Yours stay as they  │
│   are.                                 │
│ ⓘ You can undo this from Data & backup.│
├────────────────────────────────────────┤
│ [        Restore your data           ] │ label names the ticked section(s)
└────────────────────────────────────────┘
```

- Primary label: `Restore your data` · `Restore coaching knowledge` · `Restore both` · disabled `Choose what to restore`.
- **Cross-domain references.** Workouts carry their own exercise snapshot (ADR 0003 M4), so history always shows the right names. If restoring `Your data` alone brings routines or plans that use an exercise this phone's coaching knowledge doesn't have, the preview lists them: `ⓘ 2 exercises in your routines aren't in this phone's exercise list: Landmine press, Hatfield squat. They show as "Exercise missing" until you add them or restore coaching knowledge.` Nothing is added to coaching knowledge silently.
- If restoring `Coaching knowledge` alone would remove an exercise that Ben's data uses, that exercise is **kept** and the preview says `Kept: 3 exercises your workouts use.`

At AX1 and above each count table stacks: one block per row, `Workouts` then `Backup 412 · This phone 415`.

**Step 4: confirm (only when something would be replaced).** System alert:

> **Replace your data on this phone?**
> 3 workouts on this phone aren't in the backup from Thu 8 Oct, 19:05. Coaching knowledge isn't changed. You can undo this from Data & backup.
> [Cancel] [Restore]

(For a coaching-knowledge restore the alert reads `Replace coaching knowledge? 2 approved rules on this phone aren't in the backup. Your data isn't changed.`) When nothing would be lost (the backup contains everything in the ticked sections, or the phone is empty) there is no alert: the preview's primary is the confirmation.

**What counts as "replaced"** (PM decision on review SP3, 2026-10-09). The preview's warnings and the Step 4 alert count, per section:
- records on this phone that the backup doesn't have (`3 workouts on this phone aren't in this backup … They'll be replaced.`);
- records on this phone whose content differs from the backup's copy, such as a workout corrected after the backup was made (`1 workout on this phone differs from the backup's copy, changed since it was made. The backup's version replaces it.`). Content is compared record by record; when the backup is from an older schema it's compared by the version stamps every write bumps;
- data kept only for Undo. A restore replaces the copy kept for `Undo last restore`, so anything in that copy that is neither on this phone nor in the backup is lost with it (review S2): `The data kept for Undo (what you switched away from on Sat 10 Oct, 18:06) holds 1 workout that isn't on this phone or in this backup. This restore deletes that copy, so it's lost unless saved in another backup.` A copy that can't be read is said to be deleted too. Data is never deleted without the preview saying so.

**Only Your data is counted** (PM decision RS1 on the re-review, 2026-10-09; rule 10). The three counts above (on this phone only, changed on this phone, kept only for Undo) cover owner-scoped `Your data` rows: workouts, the profile, gyms, equipment, custom exercises, routines, progression rules, check-ins and pain flags. Shared `Coaching knowledge` rows (the starter list and catalogue exercises, which have no owner) are never counted as replaced, changed or lost, and never trigger the Step 4 alert on their own. They are re-seeded and merged by catalogue key: every launch adds any bundled starter exercise whose catalogue key is missing, and a key that is already present keeps the row it has (so after a restore, the backup's copy of a shared row stays). Each install stamps its own copy with its own first-launch time, so comparing them would report records that don't exist (review R1). How a restore treats newer bundled catalogue rows than the backup's is decided when the full catalogue is wired (open; see RS1 in `docs/reviews/slice-3-and-s1.md`).

Any of these makes the alert appear. The preview is stamped with the state it was made against; if the data or the kept copy changes before `Restore` is tapped, the restore is refused, the preview is rebuilt, and Ben confirms again (review S5).

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
| Barbell | `For these 6 exercises, "100" means:` | `Total as written` only (nothing added). `Plates only` is chosen per exercise, never for the group: see the note below |
| Bodyweight exercises with a weight | `For Pull-up, "10" means:` · `Values in your file: 0 to 20, none negative` | `Weight added to bodyweight` / `Assistance from a machine` |

> **Barbell: plates only is per exercise (PM decision after review r7, 2026-10-10).** No group answer ever adds a bar weight. The barbell group question offers only `Total as written` (the safe answer: nothing added; still not pre-selected, DX6). Below it, every barbell exercise is listed under `Plates only (bar not counted)?` with, for each: the bar it would add (`Bar: Olympic bar (from Bench press)`, taken from the matched exercise's equipment; `Olympic bar` / `EZ bar` / `Trap bar` to change it, `(your choice)` once changed; an exercise with no single bar recorded says `Choose one for plates only`), the conversion (`If plates only: 60 kg → 80 kg total (plates + 20 kg bar)`), what it imports as now, and `Total as written` / `Plates only` with nothing pre-selected. A bar's weight field (`Bar weight`, 20 kg / 45 lb default, editable; EZ and trap bars empty until entered) appears when an exercise uses it. Words in the FitNotes name (`Barbell`, `EZ`, `Hex`, `Trap`, `Olympic`, …) may help suggest which exercise it is, but never decide that a bar is added or which; `Add new` → `Barbell` makes the exercise with the Olympic bar unless Ben chose another bar for it here. Ben's per-exercise answer is remembered with the name, with the exercise, bar and bar weight it was given for; a later import still in effect fills it in, labelled `Your answer last time`, only when all three are the same now (a bar weight still empty is asked), otherwise the row is asked with nothing selected and shows `Last time: plates only + 15 kg Olympic bar. Not filled in: …` as information (review r8 B1, B2); `Undo this import` takes it back. The bar buttons appear once `Plates only` is selected (review r8 S2), and re-mapping a name so its bar changes clears its `Plates only` (review r8 S1). Copy unconfirmed by the designer.

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

Revision (two data domains): the first choice is **what** to export. `My data` (default) shows the format and range choices below. `Coaching knowledge only` exports one JSON file with approved and candidate playbook rules (with grades, sources and Ben's approval record), the exercise catalogue and aliases, custom exercise definitions, default presets and the guide library index metadata (titles, section headings, page numbers; no guide text and no files). It contains **no personal data**: no workouts, memories, pain flags, goals, gyms, conversations or settings. It has no range or warm-up options.

```
┌────────────────────────────────────────┐
│ ‹ Back             Export              │
├────────────────────────────────────────┤
│ What to export                         │
│ (•) 👤 My data                         │
│ ( ) 📚 Coaching knowledge only         │
│     Rules, sources and the exercise    │
│     list. Nothing about you.           │
│                                        │
│ Format                                 │ My data only
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

**Superseded by the two-domain revision.** The screen above is replaced by the two actions below. Doing both (in either order) leaves Fizz as a fresh install.

**Delete my data (keep coaching knowledge)**

```
┌────────────────────────────────────────┐
│ ‹ Back          Delete my data         │
├────────────────────────────────────────┤
│ 👤 This removes from this iPhone:      │ DomainLabel
│ • 412 workouts and all their sets      │
│ • Your profile, goals and week         │
│ • Routines, plans, gyms and equipment  │
│ • Coach chats, memories and pain flags │
│ • Your guide files                     │
│ • Your settings and scheduled alerts   │
│ • Coach sign-in and API keys           │
│ • Backups on this phone, and the copy  │
│   kept to undo a restore               │
│                                        │
│ 📚 Kept: coaching knowledge (approved  │
│ rules, sources, exercise list, guide   │
│ index).                                │
│                                        │
│ Not removed:                           │
│ • Copies you saved to Files. Delete    │
│   them in Files if you want them gone. │
│ • Anything OpenAI keeps under your own │
│   account.                             │
│                                        │
│ Copy saved to Files: Thu 8 Oct         │ or: No copy off this phone
│ [      Save a copy to Files first    ] │ SecondaryButton
│                                        │ space.8
│ Delete my data                         │ DangerTextButton
└────────────────────────────────────────┘
```

Alert: **Delete your data?** / `Your workouts and everything about you are removed from this iPhone. Coaching knowledge is kept. This can't be undone. Copies in Files are kept.` [Cancel] [Delete] (destructive). Afterwards Fizz opens first-run onboarding (Welcome, with `Restore from a backup`). Backups on this phone hold Ben's data, so they are deleted too; the confirmation says so.

**Reset coaching knowledge**

```
┌────────────────────────────────────────┐
│ ‹ Back     Reset coaching knowledge    │
├────────────────────────────────────────┤
│ 📚 This puts coaching knowledge back   │
│ to how Fizz 0.3 (build 12) ships it:   │
│ • Approved and rejected rules go back  │
│   to To review (9 approved now)        │
│ • Your edits to rule wording are       │
│   removed                              │
│ • Exercise list and aliases go back to │
│   the built-in catalogue               │
│ • Guide index is rebuilt from your     │
│   guide files                          │
│                                        │
│ 👤 Not changed: your workouts,         │
│ memories, pain flags, gyms, routines   │
│ and settings.                          │
│ Kept: 3 custom exercises your workouts │
│ or routines use.                       │
│                                        │
│ [      Save a copy to Files first    ] │ SecondaryButton
│                                        │ space.8
│ Reset coaching knowledge               │ DangerTextButton
└────────────────────────────────────────┘
```

Alert: **Reset coaching knowledge?** / `9 approved rules go back to To review and the exercise list returns to the built-in one. Your data isn't changed. You can undo this from Data & backup.` [Cancel] [Reset] (destructive). Reset keeps one rollback generation (the same mechanism as Undo restore), so it can be undone.

---

## 3. States

### 3.1 Backup status (status card, summary line, Profile row)

Revised (consolidation; backups in the app by default). `getBackupStatus` decides the state; screens never compute it. The card always shows **two lines**: on this phone, and off this phone.

**On this phone**

| State | Trigger | Card line | Elsewhere |
|---|---|---|---|
| Backed up on this phone | The newest automatic backup in Fizz's container includes every finished workout | `✓ Backed up on this phone · 19:05` | Summary line `Backed up on this phone · 19:05` (X2) |
| Backing up | `createBackup` + write in progress (normally < 2 s) | `Backing up…` (static icon) | Summary line `Backing up…` |
| Nothing yet | No workout finished yet | `✓ Saved on this phone` · `The first backup runs after your first workout.` | — |
| Failed: storage full | Write failed for lack of space | `⚠ Last backup on this phone didn't save` · `This iPhone is out of space. Your workouts are still saved on this phone.` + `Back up on this phone now` | Today banner (system-states.md T5); never in a workout |
| Automatic backups off | Ben turned `After each workout` off | `ⓘ Automatic backups are off` · `Your workouts are saved on this phone, with no backup copy.` + `Turn on` | Profile row line |
| Includes damaged records | `createBackup` returned an integrity report with problems (ADR 0005 #3) | `⚠ Backup saved, but it can't be restored` · `It includes 1 damaged record (workout on Tue 6 Oct). Your newest good backup: Sun 4 Oct.` + `Details` | system-states.md data integrity |

**Off this phone**

| State | Trigger | Card line | Elsewhere |
|---|---|---|---|
| No copy yet | Nothing ever saved to Files | `ⓘ No copy off this phone yet` | Nothing else. Onboarding's explainer mentions it once |
| Copy saved to Files | The newest off-phone file (manual or automatic) | `✓ Copy saved to Files · Thu 8 Oct` | Profile row line |
| Off-phone copy older than 30 days | `timing.offPhoneReminder`, reminder switch on | `ⓘ No copy off this phone since 8 Sep` + `Save a copy to Files` · `Not now` | One quiet line on the Profile `Data & backup` row. `Not now` hides it for another 30 days; the switch turns it off. **No banner, never in a workout** |
| Automatic off-phone failed | Bookmark stale, folder moved, provider signed out (only when `Also back up off the phone automatically` is on) | `⚠ Copy to Files didn't save` · `The folder can't be reached. Your backups on this phone are fine.` + `Choose backup folder` | Profile row line. No Today banner |

Durability wording is exactly design-system §7.1. The off-phone file is written to the folder; iCloud uploads it later if Ben is offline. The card says `iCloud uploads it when you're back online.` only when the folder is in iCloud Drive and the device is offline.

### 3.2 Automatic backup

| State | Trigger | Behaviour |
|---|---|---|
| Runs | `SessionFinished` committed and `After each workout` is on | Writes to Fizz's container (and also to the off-phone folder if that switch is on). Runs after the summary is shown. Never delays the summary, `Done` or the next workout. Also runs after a FitNotes import commits, after a restore and after a coaching-knowledge reset (a snapshot of the new state) |
| App backgrounded during a run | Ben locks or leaves right after Finish | The write finishes within iOS's short background grace period. If iOS stops it, it runs again on the next launch |
| Workout started during a run | Ben starts again immediately | The backup reads a consistent snapshot through the serialised queue (ADR 0005); logging isn't blocked |
| Off | Ben turned the switch off after the confirmation | Card shows `Automatic backups are off`. No reminder beyond the card and the Profile row |
| Rotation | More automatic files than `Keep` | Oldest automatic files Fizz wrote are deleted after the new one is written and checked, in each location separately. Copies Ben saved himself are never deleted |

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
| Undo with an unfinished workout from the backup | (PM decision on review SP2, 2026-10-09.) Undo stays available when the only unfinished workout came in with the restored data and hasn't been touched since the switch; the row adds `The unfinished workout came with the restored data and stays in it.` A workout started or continued after the switch blocks Undo as DX4 says (`Finish or discard your workout first (Push A)`) | Rollback |
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
| Backing up first | Commit tapped | `Backing up on this phone before import…` then importing. The confirm step before it offers `Save a copy to Files first` (safeguard, §4.1a) |
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

### 3.6 Delete my data / Reset coaching knowledge

| State | Display |
|---|---|
| Normal | §2.7 |
| No copy off this phone | The off-phone line reads `ⓘ No copy off this phone. Deleting removes the backups on this phone too.` and `Save a copy to Files first` is listed first |
| Deleting | `BlockingCover`: `Deleting your data…` (coaching knowledge kept) |
| Resetting | `BlockingCover`: `Resetting coaching knowledge…` · `Your data isn't touched.` |
| Reset done | Toast `Coaching knowledge reset to build 12.` [Undo] (rollback generation) |
| Coach sign-out failed (offline) | After deleting, one line on the first-run screen: `Fizz couldn't sign out of ChatGPT online. The sign-in was removed from this phone; you can also remove Fizz's access in your ChatGPT account settings.` |
| Interrupted | A marker is written first. The next launch finishes deleting before showing anything, then shows first-run |
| Done | The app opens first-run onboarding (onboarding.md Welcome) |

---

## 4. Interactions

### 4.1 Backup (revised, consolidation)
- `Save a copy to Files` (primary) → `createBackup` → system export picker → a **manual** file outside Fizz. Success: the card's off-phone line updates; toast `✓ Copy saved to Files · iCloud Drive › Fizz backups`. No Undo (harmless). The card's `⋯` → `Send a copy…` uses the share sheet (AirDrop to the laptop, Mail).
- `Back up on this phone now` (card `⋯`, and the storage-full state) writes an automatic-style file to Fizz's container.
- `After each workout` switch: on by default, no setup. Turning it off asks `Turn off automatic backups? Your workouts stay saved on this phone, but there'll be no backup copy.` [Turn off] [Cancel].
- `Also back up off the phone automatically`: off by default. Turning it on opens the folder sheet (§2.2); cancelling leaves it off. Changing the folder doesn't move old files.
- `Remind me if there's no copy off this phone`: on by default; controls only the quiet 30-day row (§3.1).
- `Keep automatic backups` → `Last 7` / `Last 14` (default) / `Last 30` / `All`. Lowering it shows `Fizz will delete 16 older automatic backups at the next backup. Copies you saved yourself are kept.` [OK] [Cancel].
- `Copies on this phone` lists Fizz's own automatic backups with dates and `Restore` on each (useful when the database won't open). The header says `These are lost if Fizz is deleted or re-signed with another Apple ID.`
- **Trial-run reminder.** Until Ben taps `Mark as done`, the card shows: `Before real workouts: do the trial run in the SideStore guide (save a copy to Files, update over the top, skip a refresh, restore).` [Mark as done]. It stores the date. Fizz can't verify it, so it never claims to.

### 4.1a Safeguards before risky moments (new, consolidation)

At each of these moments Fizz shows one inline `NoteLine` with a one-tap `SecondaryButton` `Save a copy to Files first` and a `Skip` text button. It shows only when there's no copy in Files newer than the current data. It never blocks the action, never appears during a workout, and is never a banner.

| Moment | Where | Copy |
|---|---|---|
| Before a SideStore reinstall or signing change | The How-to-refresh sheet and any reinstall guidance (system-states.md §3.5), Signing tool setting | `Reinstalling with a different Apple ID or tool starts an empty app. Save a copy to Files first.` |
| Before committing a FitNotes import | Import preview, after `Import 412 workouts` | `Importing adds 412 workouts. Save a copy to Files first?` |
| Before a restore | Restore step 1 (§2.3) | `Restoring replaces data on this phone. Save a copy to Files first?` |
| New build or database update detected | The one-time `Updated to build 13` notice on Today (system-states.md §3.6) | `Fizz was updated. Save a copy to Files?` (shown once with the notice) |
| Before Delete my data / Reset coaching knowledge | Their screens (§2.7) | `Save a copy to Files first` button |

### 4.2 Restore
- Rows in the choose list open the check, then the preview. `Choose another file…` opens the system picker filtered to JSON.
- `Restore` → alert if needed → cover → done. Before the switch: `cancelObsoleteCues` for every timer, end any Live Activity, cancel AlarmKit alarms.
- No cancel during the cover: the whole operation is a few seconds and a cancel mid-switch adds a failure mode. A crash before the switch leaves current data untouched (ADR 0005).
- `Undo restore` / `Undo last restore` → `Bring back your data from before Thu 8 Oct, 19:20? The restored backup is kept, so you can switch again.` [Cancel] [Undo restore] → same cover with `Switching back…`. Undo puts back the whole database as it was before the restore; because a section restore changed only that section, the other section ends up unchanged either way. The row names what was restored (`Undo last restore (your data)`).
- **Restoring one section** (DX11): `restoreBackup(file, {sections: ['your_data']})` builds the new database from the current one plus the backup's chosen section, then runs the same integrity check and pointer switch (ADR 0005). Credentials are never touched.
- After any restore or rollback: normal cold-start logic (flow §4.2). An unfinished workout inside the backup is usually older than 6 h, so Today shows the stale-workout card; no timers are rescheduled for deadlines in the past.

### 4.3 Import
- `Choose CSV file` → system document picker (types: CSV and plain text). The file is copied into the app's cache before reading. Comma, semicolon and tab delimiters are accepted only when the header matches a known format.
- The preview is paged: the workouts list loads in pages of 50. A 10,000-row file must show the preview's summary within 5 s on the iPhone 17 (to measure).
- Each `ImportQuestionRow` opens its screen; `Done` returns and the row shows `✓` with the answer (`Dumbbells: each`).
- `Gym` row and all questions can be changed until commit. Changing an answer bumps `mappingVersion`; a commit with an old version is rejected (rule 5).
- `Import 412 workouts` → safeguard (§4.1a) → backup on this phone → `commitImport` in batches of one workout each, each batch atomic. Same `operationId` on retry, so a relaunch can't duplicate.
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

### 4.5 Delete my data / Reset coaching knowledge
**Delete my data** (`deleteMyData(ownerId, confirmation)`). Order, each step idempotent, behind a `deleteInProgress` marker:
1. `disconnectAiConnection` for every connection (revoke where supported; offline is fine), then delete every Keychain item Fizz owns, by listing the known keys.
2. Cancel every scheduled notification and AlarmKit alarm; end every Live Activity; stop audio.
3. In one transaction, remove every owner-scoped (personal) record; the coaching-knowledge tables are untouched. Then delete the previous database generation (it holds personal data), Fizz's backups on this phone, guide files, the probe database and cached import files. Write one fresh on-phone backup containing coaching knowledge only.
4. Release the backup folder bookmark.
5. Clear the marker and relaunch into first-run.

**Reset coaching knowledge** (`resetCoachingKnowledge(confirmation)`): keep a rollback generation, replace the coaching-knowledge tables with this build's bundle, keep any custom exercise that personal records reference (listed in the confirmation), clear the guide index and re-run `indexGuide` on Ben's guide files, then rebuild coach context. Personal tables are untouched.

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
| Delete my data | None. `Save a copy to Files first` and a confirmation instead |
| Reset coaching knowledge | Toast `Undo` and `Undo last reset` row (one rollback generation) |

---

## 5. Copy

| Element | Text |
|---|---|
| Hub title | `Data & backup` |
| Status, on this phone | `✓ Backed up on this phone · 19:05` · `✓ Saved on this phone` + `The first backup runs after your first workout.` · `⚠ Last backup on this phone didn't save` · `ⓘ Automatic backups are off` · `Backing up…` |
| Status, off this phone | `✓ Copy saved to Files · Thu 8 Oct` · `ⓘ No copy off this phone yet` · `ⓘ No copy off this phone since 8 Sep` · `⚠ Copy to Files didn't save` |
| Status details | `👤 Your data: 412 workouts · 4,105 sets` · `📚 Coaching knowledge: 9 rules · 412 exercises` · `Copies on this phone are lost if Fizz is deleted or re-signed with another Apple ID.` · `The folder can't be reached. Your backups on this phone are fine.` · `This iPhone is out of space. Your workouts are still saved on this phone.` · `iCloud uploads it when you're back online.` |
| Buttons | `Save a copy to Files` · `Save a copy to Files first` · `Skip` · `Back up on this phone now` · `Send a copy…` · `Choose backup folder` · `Check` · `Restore your data` · `Restore coaching knowledge` · `Restore both` · `Choose what to restore` · `Undo restore` · `Choose CSV file` · `Import 412 workouts` · `Answer 3 questions to import` · `Export` · `Delete my data` · `Reset coaching knowledge` · `Done` |
| Settings rows | `Backups on this phone` · `After each workout` · `Keep automatic backups` · `Copies on this phone` · `Off this phone (optional)` · `Also back up off the phone automatically` · `Remind me if there's no copy off this phone` · `Turn off automatic backups? Your workouts stay saved on this phone, but there'll be no backup copy.` [Turn off] [Cancel] |
| Files copy | `Backups are plain files with your training data and coaching knowledge. They never contain your coach sign-in or API keys.` · `That's inside Fizz, so it's lost with the app. Choose iCloud Drive or another folder.` · folder sheet title `Back up off the phone automatically` · `After each workout, Fizz also saves a copy in a folder you choose, like iCloud Drive. It survives if the app is deleted.` |
| Safeguards | as §4.1a |
| File names | `fizz-backup-2026-10-08-1905-auto.json` · `fizz-backup-2026-10-08-1912.json` (manual). Local time in the name; UTC + zone inside the file. One file, two sections (`your_data`, `coaching_knowledge`) |
| Toasts | `✓ Copy saved to Files · iCloud Drive › Fizz backups` · `412 workouts hidden. You can import the file again.` · `Coaching knowledge reset to build 12.` [Undo] |
| Trial run | `Before real workouts: do the trial run in the SideStore guide (save a copy to Files, update over the top, skip a refresh, restore).` · `Mark as done` · after: `Trial run done · Fri 9 Oct` |
| Restore preview | `Made Thu 8 Oct 2026, 19:05` · `✓ Checked: complete, no damaged records` · section heads `Your data` / `Coaching knowledge` · column heads `Backup` / `This phone` · `Same as this phone` · `⚠ 3 workouts on this phone aren't in this backup (newest: Sat 10 Oct). They'll be replaced.` · `ⓘ Restoring this replaces approved rules and your exercise list. Your workouts aren't touched.` · `ⓘ 2 exercises in your routines aren't in this phone's exercise list: Landmine press, Hatfield squat. They show as "Exercise missing" until you add them or restore coaching knowledge.` · `Kept: 3 exercises your workouts use.` · `ⓘ This backup is from an older Fizz. It's updated as it's restored.` · `ⓘ Coach sign-in and API keys aren't part of backups. Yours stay as they are.` (on a fresh install: `… You'll connect the coach again in Profile.`) · `ⓘ You can undo this from Data & backup.` |
| Restore alert | `Replace your data on this phone?` / `3 workouts on this phone aren't in the backup from Thu 8 Oct, 19:05. Coaching knowledge isn't changed. You can undo this from Data & backup.` [Cancel] [Restore] · `Replace coaching knowledge?` / `2 approved rules on this phone aren't in the backup. Your data isn't changed.` |
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
| Convention questions | `FitNotes doesn't record whether a dumbbell weight is one dumbbell or both together.` · `For these 9 exercises, "22.5" means:` · `Each dumbbell` / `Imported as 22.5 kg each` · `Both dumbbells together` / `Imported as 11.25 kg each` · `Total as written` · `Nothing added: imported as 100 kg` · `Plates only (bar not counted)?` · `Bar: Olympic bar (from Bench press)` · `If plates only: 60 kg → 80 kg total (plates + 20 kg bar)` · `Plates only` · `Your answer last time` · `Weight added to bodyweight` · `Assistance from a machine` · `Values in your file: 0 to 20, none negative` · `Different for some?` · `Same` |
| Other questions | `Rows have values in both the kg and lb columns. Which did you enter in FitNotes?` · `Keep as notes only` / `Review and import as RPE` · `Skip those dates` / `Import them as extra workouts` · `Not recorded` / `All at Main Gym` |
| Provenance (history set detail) | `Imported from FitNotes on Thu 8 Oct 2026 · row 4,180` · `Original: Flat Barbell Bench Press · 100 kgs · 8 reps · "@8 felt heavy"` |
| Import errors | `This file is empty.` · `This isn't a CSV file.` · `This looks like a FitNotes backup, not a CSV export. Export a CSV from FitNotes and choose that.` · `Fizz doesn't recognise this file's columns yet.` · `Copy first line` · `You imported this file on Thu 8 Oct (412 workouts). Nothing new to import.` |
| Importing | `Importing from FitNotes` · `180 of 412 workouts` · `Keep Fizz open. If it closes, you can carry on from here.` · `Backing up on this phone before import…` · `Import paused at 180 of 412 workouts. The 180 are in your history.` · `Continue import` |
| Results | `✓ Import finished` · `412 workouts · 4,105 sets added` · `Save row-by-row results (CSV)` · `Undo this import` · row detail `Row 1,204 · 2024-05-03 · Treadmill · 5 km · 25:00 — cardio isn't imported yet` |
| Undo import alert | `Undo this import?` / `412 workouts from FitNotes_Export_2026_10_01.csv will be hidden from history, Progress and targets. Your other workouts aren't touched.` [Cancel] [Undo import] |
| Export | `What to export` · `My data` · `Coaching knowledge only` / `Rules, sources and the exercise list. Nothing about you.` · `Spreadsheet (CSV)` / `One row per set. Opens in Numbers, Excel or Google Sheets.` · `Full data (JSON)` / `Workouts, routines, gyms, coach decisions and memories.` · `FitNotes 2 CSV` / `For importing into FitNotes 2. Set types, RPE and load conventions are lost.` · `Include warm-up sets` · `Exports can't be restored into Fizz. Use Save a copy to Files for that.` · `No workouts in this range.` · `Preparing…` |
| Delete my data | list in §2.7 · alert `Delete your data?` / `Your workouts and everything about you are removed from this iPhone. Coaching knowledge is kept. This can't be undone. Copies in Files are kept.` [Cancel] [Delete] · cover `Deleting your data…` |
| Reset coaching knowledge | list in §2.7 · alert `Reset coaching knowledge?` / `9 approved rules go back to To review and the exercise list returns to the built-in one. Your data isn't changed. You can undo this from Data & backup.` [Cancel] [Reset] · cover `Resetting coaching knowledge…` / `Your data isn't touched.` |

Spoken cues: none. These screens are never used mid-set.

---

## 6. Data needed

From the brief and ADR 0005:
- `createBackup(store, {at, app})` → `{text, suggestedFileName, integrityReport}`; the native layer writes the file. **Revised:** the file holds two sections, `your_data` and `coaching_knowledge`, each with its own `schemaVersion` reference, `counts` and checksum, plus an overall checksum (open-decisions.md, developer section).
- `restoreBackup(file, {sections: ('your_data' | 'coaching_knowledge')[]})` via `DatabaseManager`: parse and verify → preview → build (current database + chosen sections from the file) → load → migrate → integrity check → pointer switch. Returns `restored | unchanged | failed{reason}`.
- `DatabaseManager.rollback()` for Undo restore (swaps current and previous).
- `checkIntegrity()` (ADR 0005).
- `previewFitNotesImport(file)` → `{jobId, format: 'fitnotes_android_csv' | 'fitnotes2_csv' | 'fitnotes_backup' | 'unknown', header, unit, rowCount, dateRange, workouts[], exerciseMatches[{sourceName, setCount, status: 'matched' | 'check' | 'no_match', suggestion?}], conventionQuestions[], unitQuestion?, rpeCandidates[], skipped{cardio[], unreadable[], datesInFizz[], alreadyImported{jobId, count}}, sameFileAs?: jobId, mappingVersion}`. Checksum (SHA-256, the pure implementation from ADR 0005) identifies the same file.
- `commitImport(jobId, mappingVersion, operationId)` → per-workout batches, per-row results, resumable.
- `exportTrainingData(userId, format: 'csv' | 'json' | 'fitnotes2_csv', range, {includeWarmups})` for `My data`; `exportCoachingKnowledge()` → JSON for `Coaching knowledge only` (no owner-scoped records; a test asserts it).
- `getActiveSession(userId)` to block restore and import while a workout is unfinished.
- `disconnectAiConnection(connectionId)` (brief §2) during delete.
- `cancelObsoleteCues`, Live Activity end, AlarmKit cancel (lock-screen-and-alerts.md) before restore and delete.
- Catalogue: exercise picker and alias matching from `packages/catalogue`.

**Proposed new functions** (contracts for the developer):

| Function | Purpose |
|---|---|
| `getBackupStatus(ownerId)` → `{onPhone: {state: 'backed_up' \| 'backing_up' \| 'nothing_yet' \| 'failed' \| 'off', lastSuccess?{atUtc, zone, fileName, counts{yourData, coachingKnowledge}}, lastAttempt?{atUtc, error?}, autoEnabled, keep, localCopies[]}, offPhone: {state: 'none' \| 'saved' \| 'stale' \| 'failed', lastCopy?{atUtc, zone, destinationLabel, kind: 'manual' \| 'automatic'}, autoEnabled, folder?{label, reachable, insideApp}, reminderEnabled, reminderDue}, integrityProblems?, trialRunDoneAt?}` | **Canonical shape** (supersedes the one in profile-and-settings.md). One source for the card, the summary line, the Profile row and safeguards. `offPhone.reminderDue` applies `timing.offPhoneReminder` |
| `writeBackupToContainer(fileName, text)` / `rotateAutomaticBackups(location, keep)` | On-phone automatic backups (Fizz's container). Rotation deletes only files whose name and recorded checksum match ones Fizz wrote |
| `saveBackupToFiles(text, suggestedFileName)` | System export picker; records `offPhone.lastCopy` |
| `setOffPhoneAutoBackup(enabled)` / `pickBackupFolder()` / `writeBackupFile(folderBookmark, fileName, text)` / `listBackupsInFolder()` | Optional automatic off-phone layer (security-scoped bookmark; `DEP-FILES`) |
| `dismissOffPhoneReminder()` / `setOffPhoneReminder(enabled)` | The quiet 30-day row |
| `verifyBackup(file)` → `{ok, sections{yourData, coachingKnowledge}: {counts, problems[]}, schemaVersion, needsMigration}` | ADR 0005 restore steps 1–4, then discard. Also used by onboarding.md (restore from Welcome) and system-states.md |
| `previewRestore(file, sections)` → ADR 0005 preview per section, plus `onlyOnPhone{workouts, newestDate}`, `missingExerciseRefs[]`, `keptExercises[]` and `currentHasUnfinishedWorkout` | Drives the "will be replaced" warnings |
| `updateImportMapping(jobId, answers, expectedMappingVersion)` → new `mappingVersion` | Answers to every question; stale versions rejected |
| `revertImport(jobId, expectedVersion, operationId)` | Marks the job's sessions `reverted` (audited); excluded from history, Progress, comparable history and targets |
| `listImportJobs(ownerId)` / `getImportJob(jobId)` | Past imports, resume, row results |
| `deleteMyData(ownerId, confirmation)` | §4.5 sequence behind a marker; resumable; never touches coaching-knowledge tables (replaces `deleteAllData`) |
| `resetCoachingKnowledge(confirmation)` / `undoKnowledgeReset()` | §4.5; never touches owner-scoped tables |

---

## 7. Acceptance checks

Backup (revised, consolidation)
1. On a fresh install with no setup, finishing a workout writes `fizz-backup-…-auto.json` to Fizz's own container within 10 s; the card reads `✓ Backed up on this phone · hh:mm` and `ⓘ No copy off this phone yet`; the summary and `Done` are never delayed (test with a write delayed 10 s).
2. `Save a copy to Files` to iCloud Drive with airplane mode on succeeds, reads `✓ Copy saved to Files`, and says `iCloud uploads it when you're back online.`
3. No string anywhere says a bare "Backed up", "sync" or "in the cloud"; on-phone and off-phone states always use the three phrases (string-table search).
4. A backup file never contains any Keychain value (search the file for the stored token and API key test values).
5. With `Keep: last 14` and 15 automatic files, the oldest automatic file is deleted only after the new one is written; copies Ben saved himself are untouched.
6. Saving to a location inside Fizz's container shows `That's inside Fizz, so it's lost with the app…`.
6a. With `Also back up off the phone automatically` on and the folder deleted in Files, the card shows `⚠ Copy to Files didn't save` and the on-phone backup still succeeds. No Today banner and nothing during a workout.
6b. With no copy in Files for 30 days, one quiet row appears in Data & backup and on the Profile row; `Not now` hides it for 30 days; switching the reminder off removes it. It never appears as a banner or in a workout.
6c. Each safeguard in §4.1a appears only when there's no newer copy in Files, takes one tap to save, and never blocks the action behind it.
6d. A backup file has `your_data` and `coaching_knowledge` sections with separate counts and checksums.

Restore
7. With an unfinished workout, restore rows are disabled with the `Finish or discard your workout first` line.
8. The preview counts match the file's `counts` and the current database; a backup missing 3 newer workouts shows the warning and the confirmation alert; one that contains everything shows no alert.
9. Restoring a file identical to the data shows `This backup matches…` and leaves the rollback target unchanged.
10. A file with an edited byte shows the checksum failure; a backup from a higher schema shows the newer-Fizz message; neither changes the database file (compare its hash before and after).
11. During the restore cover, no Log, notification tap or deep link can write; queued writes on the old store fail with "Database is closed" and nothing reaches the new file (ADR 0005).
12. Force-quit during the cover before the switch: on relaunch the old data is intact and `A restore was interrupted…` shows once. Force-quit after the switch: restored data shows.
13. `Undo restore` brings back the previous data; `Switch back to the restored backup` swaps again.
13a. Restoring only `Your data` leaves every coaching-knowledge table byte-identical (approved rules, catalogue, aliases); restoring only `Coaching knowledge` leaves every owner-scoped record identical. Missing exercise references are listed in the preview and nothing is added to coaching knowledge silently.
13b. On a non-empty phone neither section is pre-ticked and the primary reads `Choose what to restore`.
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
29a. `Coaching knowledge only` contains no owner-scoped record (no workouts, memories, pain flags, goals, gyms, conversations, settings or guide text); a test searches it for the test owner ID and known personal strings.

Delete and reset
30. After `Delete my data`: every owner-scoped record, the previous generation, on-phone backups, guide files and every Fizz Keychain item are gone; coaching knowledge (approved rules, catalogue, aliases) is unchanged; no notification or alarm remains scheduled; no Live Activity is running; copies in Files are untouched; the app shows first-run.
31. Kill the app mid-delete: relaunch finishes the deletion before showing anything.
31a. `Reset coaching knowledge` returns rules to `To review` and the catalogue to the bundled one, keeps custom exercises that personal records use, leaves every owner-scoped record identical, and can be undone once.

General
32. All counts and dates use tabular numerals; all text ≥ 16pt at default size; every status has an icon and text; every screen works at AX3 with the primary visible.
33. None of these actions can be triggered by the coach or by voice.

---

## 8. Proposed changes (for Ben / the product manager)

| # | Change | Reason |
|---|---|---|
| P-B1 | ADR 0004 says "SQLite snapshot + JSON export". Adopt ADR 0005's JSON-only snapshot in the design; no raw `.db` copy | One format to restore and test (ADR 0005 #1) |
| P-B2 | Ben confirms plain-JSON backups (ADR 0005 #2); the folder sheet tells him what's in them | He decides with the facts visible |
| P-B3 | Add `verifyBackup`, `previewRestore` (with `onlyOnPhone`), `getBackupStatus`, `revertImport`, `updateImportMapping`, `deleteMyData`, `resetCoachingKnowledge`, `exportCoachingKnowledge`, `saveBackupToFiles` to the service contracts (brief §7) | Needed by this spec and onboarding.md |
| P-B4 | Restore and import are blocked while a workout is unfinished (DX4) | Avoids replacing or reshaping history the live workout reads |
| P-B5 | (Revised.) Only matters if Ben turns on `Also back up off the phone automatically`: device test `DEP-FILES` — does the folder bookmark survive relaunch, a SideStore refresh and an update over the top on a free-signed build, with no iCloud entitlement? **If not:** the switch is hidden and `Save a copy to Files` stays the off-phone route | Automatic backups no longer depend on it |
| P-B6 | (Approved by Ben, relayed by the product manager.) Backups in the app by default; off-phone optional with safeguards (DX2, DX12). **For the product manager:** ADR 0004's "Backup … to Files … before any real workout is logged" and the trial run need re-wording to match; the trial run should still save one copy to Files first | Recorded so the ADR and brief can be updated by their owners |
| P-B7 | (Approved by Ben, relayed by the product manager.) Two data domains with independent restore, export and delete (DX11) | Recorded here; brief/CHANGELOG entry is the product manager's |
| P-I1 | Unknown FitNotes headers stop the import; no manual column mapping (DX5) | Honest; brief v0.2 asks for the real export first |
| P-I2 | Convention questions have no default (DX6) | Rule 6 |
| P-I3 | **Domain decision needed:** can imported sets without an equipment instance count as comparable history ("Last" values, targets) when exercise, unit and convention match? Options: (a) never; (b) yes, labelled `Last (FitNotes, 1 Oct)`; (c) only when Ben assigned a gym and that gym has exactly one instance of the equipment type. Designer recommends (b) | Without it, importing years of history doesn't help the next workout |
| P-I4 | Cardio rows are skipped (listed, never lost) until endurance imports exist (build step 6) | Scope |

### Cross-spec proposals (status after consolidation)
- **X1 (onboarding.md): withdrawn.** Superseded by Ben's approved change: onboarding has no required backup or folder step, only a short skippable explainer (onboarding.md §2.5).
- **X2 (workout-summary.md §2, region 1): applied.** Under `✓ Workout saved on this phone`, one line from `getBackupStatus`: `Backed up on this phone · 19:05` / `Backing up…` / `⚠ Last backup on this phone didn't save. Open Data & backup ›`. Never blocks `Done`, never mentions off-phone copies.
- **X3 (profile-and-settings.md): applied.** One Profile row `Data & backup` with a status line (e.g. `Backed up on this phone · 19:05 · Copy saved to Files 8 Oct`) and, only for a failed backup or the quiet 30-day reminder, an icon + text marker.

---

## Proposed design-system additions

> **Merged into design-system.md (consolidation).** `BlockingCover`, `ProgressLine`, `CountCompareTable` (§9.44), `ImportQuestionRow` (now the `SettingsRow` question variant, §9.31), match statuses and durability labels (§7.1), `DangerTextButton` (§9.2b). The backup labels below are superseded by the three durability phrases, and `timing.backupOverdue` is replaced by `timing.offPhoneReminder`. The table is kept for history only.

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

- [onboarding.md](onboarding.md): the backup explainer and `Restore from a backup` on Welcome (this area's restore flow).
- [system-states.md](system-states.md): app-wide durability wording (DX1), the one backup banner left on Today (T5, failed on-phone backup), the data-integrity states, and `BlockingCover` use outside this area.
- [profile-and-settings.md](profile-and-settings.md) §2.8: the `Data & backup` row (X3).
- [workout-summary.md](workout-summary.md): the backup line under the saved banner (X2).
- [design-system.md](design-system.md) §7.1 (durability phrases), §7.2 (data domains), §9.53 `DomainLabel`.
- [lock-screen-and-alerts.md](lock-screen-and-alerts.md): alerts, Live Activities and AlarmKit alarms that restore and delete must cancel.
- [workout-summary.md](workout-summary.md): automatic backup trigger after Finish; proposed backup line (X2); the per-session `Share / export` stays there.
- [today.md](today.md) and [progress.md](progress.md): their `Couldn't open your training data.` [Restore from backup] link opens §2.3 here.
- [exercise-library.md](exercise-library.md): the exercise picker used by `Choose…` in import matching.
- [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0005](../decisions/0005-persistence-and-backup.md), [guides/sidestore-windows.md](../guides/sidestore-windows.md) §6 and §8 (trial run).
