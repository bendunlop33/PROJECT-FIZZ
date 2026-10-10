# Data: backup, restore, FitNotes import, export and delete

Status: v0.1 draft, 8 Oct 2026. Designer. Tokens: [design-system.md](design-system.md). App-wide wording for saved/backed-up states: [system-states.md](system-states.md).

Sources: brief §5 (data foundation), §7 (`previewFitNotesImport`, `commitImport`, `exportTrainingData`, `createBackup` / `restoreBackup`), §9; [ADR 0004](../decisions/0004-free-distribution-sidestore.md) (backup and a tested restore before any real workout); [ADR 0005](../decisions/0005-persistence-and-backup.md) (backup format, restore, rollback, modal restore); research `free-ios-install.md` §4 and §8, `ios-platform-feasibility.md` §2.2, §2.8 and §5 (FitNotes formats); `guides/sidestore-windows.md` §6 and §8.

> **Revision 2026-10-08 (consolidation).** Two changes approved by Ben (relayed by the product manager) are applied here, and they supersede the earlier text wherever the two disagree:
> 1. **Backups live in the app by default; off-phone copies are optional.** Automatic backups (after each finished workout, rotating) go to Fizz's own container. No folder is needed. `Save a copy to Files` works any time, and `Also back up off the phone automatically` (off by default) is the only thing that uses `Choose backup folder`. Three durability phrases: `Saved on this phone` · `Backed up on this phone` · `Copy saved to Files` (design-system §7.1). Gentle safeguards replace nagging (§4.1a). Cross-spec proposal X1 is withdrawn; X2 and X3 are applied with the new wording.
> 2. **Two data domains: `Your data` and `Coaching knowledge`** (design-system §7.2). A backup file has two separate sections that restore independently; export offers `My data` or `Coaching knowledge only`; delete offers `Delete my data (keep coaching knowledge)` and `Reset coaching knowledge`.
>
> Also: `profile-and-settings.md` now has a single `Data & backup` row (X3); components moved to design-system (§11 index); `timing.backupOverdue` is retired in favour of `timing.offPhoneReminder`.

> **Revision 2026-10-09 (import from any app, designer).** Ben asked for history import from any format, read by the coach (CHANGELOG 2026-10-09, item 4). New **§9** designs it on top of the FitNotes importer, which stays the deterministic, offline path. The coach reads a file's *layout*, never its numbers; code checks it on every row; anything the file doesn't state is asked, with nothing pre-selected; then the FitNotes preview, commit and Undo run unchanged. Confirmed layouts are saved and reused offline. Changed elsewhere in this file: DX5 (now §9 AI1), the hub's Import rows (§2.1), the intro (§2.5 step 1 → §9.2.1), §3.4's unknown-header state, §4.3, §6, check 16 and P-I1. Research: [ai-import.md](../research/ai-import.md). Only Ben's direction is approved; §9.0's decisions and §9.8's questions are for him.

**Why this matters more than usual.** Fizz is signed with a free Apple ID through SideStore. Deleting the app, or re-signing it with another Apple ID or tool, installs a separate app with an empty database (ADR 0004). Backups on the phone protect against a damaged database or a bad restore, but not against that. Only a copy saved to Files (off the phone) survives it. Fizz says which kind Ben has, every time, and offers a one-tap copy to Files before the moments when it matters (§4.1a), without nagging.

| Part | Milestone |
|---|---|
| Data & backup screen, automatic backups on this phone, `Save a copy to Files`, optional automatic off-phone backups, `Check a backup`, restore by section with preview and Undo restore, `Delete my data` / `Reset coaching knowledge` | First milestone |
| FitNotes import (preview, questions, commit, results, Undo import), import history, portable export (`My data` / `Coaching knowledge only`) | Build step 3 |
| Import from any app (§9): shared row format and saved import layouts, then layouts read by the coach, then notes | After FitNotes is checked on Ben's real file. The coach path also waits for spike S3 (plan-route tool shape, ADR 0012); notes only if Ben has notes |

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
| DX5 | (Revised 9 Oct; now §9 AI1.) An unrecognised header no longer just stops. A saved layout with the same columns imports it offline; otherwise GymSmarter offers `Read with the coach` (§9) when the coach is usable and stops honestly when it isn't. There is still no free column-mapping grid: Ben can change one column's role from a fixed list while seeing worked examples, and the unit is always a separate question. | The original reason still holds: hand mapping invites silent kg/lb misreads. The unit question, the code checks and the worked examples keep that protection. |
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
| Import from any app (§9.1) | Import history, New file layout, Check the layout, notes and Saved import layouts | See §9.1 |
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
6. **Import.** (Revised 9 Oct, §9.) `Import history` (FitNotes, saved layouts, other apps, spreadsheets and notes), `Saved import layouts` (only once one exists), `Past imports`.
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
│ Import history                       › │ §9.2.1
│ Saved import layouts (2)             › │ §9.2.9, once one exists
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

> **Revised 9 Oct (§9).** The intro is now `Import history` (§9.2.1), one entry for every source. A FitNotes file chosen there goes straight to step 2 below, exactly as before, with no coach and no network. The wireframe below is kept for its FitNotes wording, which `Import history` reuses.

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
| Unknown header | (Revised 9 Oct.) A saved layout with the same columns imports it offline (§9.2.7). Otherwise `New file layout` (§9.2.2) offers `Read with the coach`, or shows the honest unavailable state (§9.3.2) with the first line in a monospaced box (max 3 lines, tail ellipsis) and `Share first line` (ADR 0016 difference 3). Nothing guessed | `Read with the coach`, or `Choose another file` |
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
- `Choose CSV file` → system document picker (types: CSV and plain text). The file is copied into the app's cache before reading. Comma, semicolon and tab delimiters are accepted only when the header matches a known format. (Revised 9 Oct: the button is `Choose file` on `Import history`, types CSV, TSV, plain text and Markdown. A header that isn't FitNotes or a saved layout goes to §9.)
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
- `previewFitNotesImport(file)` → `{jobId, format: 'fitnotes_android_csv' | 'fitnotes2_csv' | 'fitnotes_backup' | 'unknown', header, unit, rowCount, dateRange, workouts[], exerciseMatches[{sourceName, setCount, status: 'matched' | 'check' | 'no_match', suggestion?}], conventionQuestions[], unitQuestion?, rpeCandidates[], skipped{cardio[], unreadable[], datesInFizz[], alreadyImported{jobId, count}}, sameFileAs?: jobId, mappingVersion}`. Checksum (SHA-256, the pure implementation from ADR 0005) identifies the same file. (Revised 9 Oct: becomes `previewImport(source)` with a detection result, §9.6. FitNotes detection and analysis are unchanged.)
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
16. The Android header (`Weight (kgs)`, `Comment`) and the FitNotes 2 header (`Weight (kg)`, `Notes`, `Kind`) are detected and named. (Revised 9 Oct.) Any other header goes to a saved layout or `New file layout` (§9); with the coach unavailable it stops with the first line shown and `Share first line`, and sends nothing. (Re-run against Ben's real export before calling this done.)
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
| P-I1 | (Superseded by §9 AI1, pending Ben.) Unknown FitNotes headers stop the import; no manual column mapping (DX5) | Honest; brief v0.2 asks for the real export first |
| P-I2 | Convention questions have no default (DX6) | Rule 6 |
| P-I3 | **Domain decision needed:** can imported sets without an equipment instance count as comparable history ("Last" values, targets) when exercise, unit and convention match? Options: (a) never; (b) yes, labelled `Last (FitNotes, 1 Oct)`; (c) only when Ben assigned a gym and that gym has exactly one instance of the equipment type. Designer recommends (b) | Without it, importing years of history doesn't help the next workout |
| P-I4 | Cardio rows are skipped (listed, never lost) until endurance imports exist (build step 6) | Scope |

### Cross-spec proposals (status after consolidation)
- **X1 (onboarding.md): withdrawn.** Superseded by Ben's approved change: onboarding has no required backup or folder step, only a short skippable explainer (onboarding.md §2.5).
- **X2 (workout-summary.md §2, region 1): applied.** Under `✓ Workout saved on this phone`, one line from `getBackupStatus`: `Backed up on this phone · 19:05` / `Backing up…` / `⚠ Last backup on this phone didn't save. Open Data & backup ›`. Never blocks `Done`, never mentions off-phone copies.
- **X3 (profile-and-settings.md): applied.** One Profile row `Data & backup` with a status line (e.g. `Backed up on this phone · 19:05 · Copy saved to Files 8 Oct`) and, only for a failed backup or the quiet 30-day reminder, an icon + text marker.

---

## 9. Import from any app (AI)

Added 9 Oct 2026 (designer). Ben: "can we leverage AI to interpret historic data so that it can then be transformed into a format that works with the app? … it can come from any format" (CHANGELOG 2026-10-09, item 4). Research: [ai-import.md](../research/ai-import.md) (fact-checked 9 Oct). Builds on ADR 0016 and review r4 (SP1–SP3). Coach routes and failure wording: [ai-connection.md](ai-connection.md) §3 and [system-states.md](system-states.md) §3.2. Binding rules: CLAUDE.md 1, 5, 6, 7, 8, 10.

**How it works.** The coach reads a new file's **layout**, never its numbers. It sees the column names, a summary of each column made on the phone, and 30 rows with notes hidden. It returns a typed layout: which column is what, the date format, and how cells like `3x8` are written. GymSmarter checks that layout on every row and shows Ben worked examples. Anything the file doesn't state for certain is a question with nothing pre-selected: unit, dumbbells, bar, assistance, what `3x8` means, day/month order, and whether these are workouts done or a plan. After that, the FitNotes preview, commit and Undo run unchanged. A layout Ben confirms is saved, so the next file in that layout imports with no coach and no network.

**What "any format" can and can't mean.** AI replaces the per-app column rules. It can't replace the checks or the questions above: no export format records dumbbell or bar conventions, several don't record the unit (research §6), and guessing them would invent data (rule 6). v1 reads text files only: CSV, TSV, semicolon-separated, multi-section CSV (JEFIT), `.txt`, `.md` and pasted text. Not `.xlsx`, PDFs, photos or app databases.

**Never-guess principle (ADR 0016, extended).** Anything that changes a stored value comes only from:
- an exact catalogue name or alias match;
- an explicit answer from Ben, including one saved in a layout he confirmed;
- an explicit word in the file that code has found: a header token such as `(kg)`, a column whose every value is a unit word, or a name word such as `Assisted`.

The coach's layout carries **no load-convention fields at all**. A missing word proves nothing.

### 9.0 Decisions

AI1–AI6 are the research's proposed spec changes, designed here. The rest are new.

| # | Decision | Why |
|---|---|---|
| AI1 | (Replaces DX5.) A file with unknown columns offers `Read with the coach` when the coach is usable, and stops honestly when it isn't. There's no mapping grid: Ben can change one column's role, from a fixed list, while seeing worked examples. The unit is never a column role; it's a separate question or a checked word in the file | Ben's direction. Keeps DX5's protection against kg/lb misreads |
| AI2 | `What is this file?` (`Workouts I did` / `A plan or template`) is always asked, with nothing pre-selected, unless a saved layout holds Ben's answer. A plan imports nothing | Targets read as results would invent history (rule 6). Liftosaur's `Required …` columns and spreadsheet templates are the likely cases |
| AI3 | One question per cell notation (`3x8`, `100x5`, `12/10/8`), each option rendered from a real row of the file | Notation changes stored values |
| AI4 | Workouts are identified by the layout's `Which workout` column, else one per start time, else one per date. **Start times with no time zone are stored as written, marked `time zone not recorded`**, and shown as `18:02 (as in the file)`. Nothing is asked. Workout length isn't imported yet. **Needs a domain decision** on the storage shape | CLAUDE.md asks for UTC plus zone. A zone would be a guess, and asking about it for every file adds taps for little value |
| AI5 | Duplicates use the FitNotes rules for every source. Dates that came in with any import still in effect are always skipped; that also stops an app's export re-importing history it got from another app. Dates with a workout logged in GymSmarter are a question, defaulting to skip. Within one file, several workouts a day are fine | One rule across sources. A Hevy export can contain Ben's imported Strong history |
| AI6 | Provenance says who read each set. `Layout suggested by the coach` means code read the row with a layout Ben checked. `Read by the coach` means the coach copied it from notes and Ben ticked it. Both add the file, row or line and the original text | Rule 6 labelling |
| AI7 | **Consent shows exactly what is sent.** `See exactly what's sent` shows the literal request text: the file data and GymSmarter's fixed instructions. The request carries that text byte for byte (hash-stamped). If anything changes, Ben sees it again before sending | Ben must know what leaves the phone (rules 7 and 8) |
| AI8 | The import uses the coach's chosen route (ai-connection AC1). Limits and errors pause it; nothing switches route on its own. The API-key route shows an estimate and runs `checkPersonalSpendCap` before sending | Rule 7 |
| AI9 | Reading a table never sends notes or comments. Free-text columns go as `[text, 42 chars]`, and their summary has no example values. Ben can hide more columns, but can't reveal a text column on this path | Privacy by default (research F23). Keeps the promise short and true |
| AI10 | **Saved import layouts** are Your data. A layout is used only on an exact column match. A file with added or missing columns is asked about offline. Anything new in the data, such as a new marker, unit word or negative weights, is asked and never absorbed. Ben's earlier answers come back labelled `Your answer last time`: that's his data, not a pre-selection (review r4 SP2) | Offline reuse without silent drift |
| AI11 | **Notes:** one consent covers the text Ben chose. Patterns he confirms are read on the phone; only lines no pattern reads go to the coach, in parts. Sets the coach copied line by line start **unticked**, and `Select all` is one tap | Free text is where numbers and notation get misread. Same pattern as reviewing RPE in comments |
| AI12 | **Values to check**, for every new source, and proposed for FitNotes too (§9.8 Q8): impossible values are unreadable; a load more than double, or less than half, the same exercise's previous workout in the file is a question (`Import as written` / `Skip`) | A jump of about 2.2× is the usual sign of a kg/lb mix-up (research §1) |
| AI13 | `Ask the coach to suggest matches` on the names screen is optional, works for FitNotes imports too, and sends only the unmatched names and the exercise list. Suggestions are `Check`, never `Matched`. They must be real exercises, must not contradict an equipment or one-arm word in the name, and show the dumbbell count (`two dumbbells`) | Applies review r4 S1, S3 and SP3 to the coach |
| AI14 | No text written by the model appears on any screen. Screens show file text (quoted, plain), GymSmarter's own copy, and readings rendered by code from the layout | Rule 8: a file can't talk to Ben through the review screen |
| AI15 | Import requests are outside the coach. They get no tools except the one that carries the layout, and no Your data. Nothing goes into chats or memory. The coach and voice still can't start an import (DX10) | Rules 8 and 10 |
| AI16 | Import, including the coach's reading, waits for an unfinished workout to end (DX4) | One rule. These screens are never used mid-workout |
| AI17 | No "set up the columns yourself" path in v1. A file the coach can't read, or that Ben won't send, stops with `Share first line` for the developer | DX5's concern. Listed as a question for Ben (§9.8 Q5) |

### 9.1 Purpose

| Surface | Question it answers | Single primary action |
|---|---|---|
| Import history (replaces the FitNotes intro) | "Can GymSmarter read my history, and does it need the coach?" | `Choose file` |
| New file layout | "What will be sent to read this file, and where?" | `Read with the coach` |
| Reading the layout | "Is it working, and can I stop it?" | None (`Stop`) |
| Check the layout | "Is every column read the right way?" | `Use this layout` |
| Changed columns | "What are this file's new columns?" | `Continue` |
| Paste text | "Which text do I want to bring in?" | `Continue` |
| Read your notes | "What exactly will be sent, and how much?" | `Send to the coach` |
| Check your notes | "Did my notes come out right?" | `Continue` |
| Saved import layouts | "Which layouts import without the coach?" | None (a list) |

After `Use this layout` or `Continue`, every source goes to the shared preview (§2.5 step 3 with §9.2.6's additions), then commit, results and Undo. These screens are never shown during a workout.

### 9.2 Layout

Design width 390pt; checked at 375 and 430. Counts, dates, loads and money are tabular. Rows are at least `target.min`; primary buttons are `target.primary` in the fixed footer, which sits above the keyboard when one is open. Raw file text uses `type.source` (§9.9).

#### 9.2.0 Flow

```text
Data & backup › Import history ─Choose file / Paste text─► detect (code, on the phone)
 ├─ FitNotes CSV ─────────────────────────────────────────────────────────► Preview (§2.5)
 ├─ saved layout, same columns ─────────────────────────── offline ───────► Preview
 ├─ saved layout, changed columns ─► Changed columns ───── offline ───────► Preview
 ├─ new table ─► New file layout ─Read with the coach─► Reading ─► Check the layout ─► Preview
 ├─ notes / text ─► Read your notes ─Send─► Reading parts ─► Check your notes ─────► Preview
 └─ can't read (.xlsx, PDF, photo, app backup, empty) ─► message, Choose another file
Preview ─Import n workouts─► safeguard (§4.1a) · backup ─► Importing ─► Results (Undo this import)
```

#### 9.2.1 Import history

From Data & backup (`Import history`) or onboarding's Ready screen (`Import training history`).

```
┌────────────────────────────────────────┐
│ ‹ Back         Import history          │
├────────────────────────────────────────┤
│ Bring in workouts from another app, a  │
│ spreadsheet or your notes. You'll see  │
│ what will be imported before anything  │
│ is saved.                              │
│                                        │
│ Works offline                          │ SettingsSectionHeader
│ ✓ FitNotes and FitNotes 2 CSV files    │
│ ✓ Layouts you've saved (2)           › │ → §9.2.9; hidden when none
│                                        │
│ Needs the coach                        │
│ ⓘ Other apps and spreadsheets (CSV)    │
│ ⓘ Workout notes and pasted text        │
│ Coach: ChatGPT plan · connected        │ coach line, §9.3.2
│                                        │
│ For a spreadsheet, export one sheet as │
│ CSV first.                             │
├────────────────────────────────────────┤
│ Paste text                             │ text button, above-left
│ [            Choose file             ] │ PrimaryButton
└────────────────────────────────────────┘
```

- The `Works offline` and `Needs the coach` lines are facts, not buttons (except `Layouts you've saved`).
- The coach line's variants are in §9.3.2. When the coach isn't usable, the line says so and both offline lines stay ticked: `Coach not connected. FitNotes and saved layouts still work.` `Connect ›`.
- With an unfinished workout: `Finish or discard your workout first (Push A).` and both actions are disabled (AI16).

#### 9.2.2 New file layout (consent)

Shown when the file is a table that isn't FitNotes and matches no saved layout.

```
┌────────────────────────────────────────┐
│ Cancel        New file layout          │
├────────────────────────────────────────┤
│ strong_workouts.csv                    │
│ Table · 13 columns · 4,212 rows        │
│                                        │
│ GymSmarter doesn't know this layout    │
│ yet. The coach can read the column     │
│ names and a few rows and suggest how   │
│ to read it. GymSmarter checks that on  │
│ every row, and you confirm it before   │
│ anything is saved.                     │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ↑ What's sent                      │ │ ConsentCard (§9.9)
│ │ • The 13 column names              │ │
│ │ • A summary of each column, made   │ │
│ │   on this phone                    │ │
│ │ • 30 rows, with notes hidden       │ │
│ │ Not sent: the other rows, notes,   │ │
│ │ your history, memories, pain flags │ │
│ │ or gyms.                           │ │
│ │ See exactly what's sent          › │ │ → §9.2.3
│ └────────────────────────────────────┘ │
│ Sent to ChatGPT, using your plan.      │ RouteLine
│ OpenAI handles it under your account's │
│ terms.                                 │
├────────────────────────────────────────┤
│ [        Read with the coach         ] │
└────────────────────────────────────────┘
```

API-key route: the two route lines read `Sent to OpenAI with your API key (paid). About $0.05 (estimate).` and `This month: $1.42 of $5.00.` The estimate includes an allowance for reasoning tokens and is never shown without the word `estimate`.

When the coach isn't usable, the same screen has no `Read with the coach`, no consent card and nothing sent:

```
┌────────────────────────────────────────┐
│ ‹ Back        New file layout          │
├────────────────────────────────────────┤
│ strong_workouts.csv                    │
│ Table · 13 columns · 4,212 rows        │
│                                        │
│ ⊘ Reading a new layout needs the coach │ StatusCard
│ The coach isn't connected. Nothing was │
│ sent.                                  │
│ FitNotes files and layouts you've      │
│ saved import without it.               │
│ Connect the coach ›                    │
│                                        │
│ First line of the file                 │
│ ┌────────────────────────────────────┐ │
│ │ "Workout #";"Date";"Workout Name"; │ │ type.source, max 3 lines
│ │ "Duration (sec)";"Exercise Name";… │ │
│ └────────────────────────────────────┘ │
│ Share first line                       │ for the developer
├────────────────────────────────────────┤
│ [         Choose another file        ] │
└────────────────────────────────────────┘
```

The card's wording for each reason is in §9.3.2.

#### 9.2.3 See exactly what's sent

Large-detent sheet. The text box is the literal request content (AI7), not a description of it.

```
┌────────────────────────────────────────┐
│ What's sent                       Done │
├────────────────────────────────────────┤
│ This is the exact text GymSmarter      │
│ sends. Nothing else is added.          │
│                                        │
│ Example values                         │
│ "Workout #" · numbers          [ On ]  │ switch per column
│ "Date" · dates                 [ On ]  │
│ "Exercise Name" · short text   [ On ]  │
│ "Notes" · notes              ⊘ Hidden  │ never sent
│ "Workout Notes" · notes      ⊘ Hidden  │
│ …                                      │
│ Off: only the column name and counts   │
│ are sent.                              │
│                                        │
│ Your file, as sent                     │
│ ┌────────────────────────────────────┐ │ SentPreview (§9.9)
│ │ 13 columns, separated by ";"       │ │
│ │ 1 "Workout #": 4,212 filled, 412   │ │
│ │   different, numbers 1 to 412      │ │
│ │ …                                  │ │
│ │ Row 2: "1";"2025-03-04 18:02:11";  │ │
│ │ "Push";"3600";"Bench Press         │ │
│ │ (Barbell)";"1";"100";"8";"";       │ │
│ │ "[text, 42 chars]";…               │ │
│ └────────────────────────────────────┘ │
│ 6,812 characters                       │
│                                        │
│ GymSmarter's instructions            › │ fixed, the same every time
└────────────────────────────────────────┘
```

- Code decides a column's kind (numbers, dates, short text, notes) from its values. Notes columns can't be switched on (AI9).
- Switching a column off changes the box and the count at once, and the consent card's third bullet becomes `30 rows, with notes and 2 more columns hidden`.
- `GymSmarter's instructions` opens the fixed instruction text, read-only. It says the file is data, not instructions, and lists the allowed answers.

#### 9.2.4 Reading the layout

```
┌────────────────────────────────────────┐
│ Reading the layout                     │
├────────────────────────────────────────┤
│ strong_workouts.csv                    │
│                                        │
│ ✓ Column summary made on this phone    │ StepRow
│ ✓ Sent to ChatGPT · 6,812 characters   │
│ … Waiting for the coach                │
│ ○ Checking it on all 4,212 rows        │
│                                        │
│ Keep GymSmarter open. If it closes,    │
│ nothing is imported and you can try    │
│ again.                                 │
│                                        │
│ Stop                                   │ text button
└────────────────────────────────────────┘
```

When the checks refuse the layout, the screen shows code's reasons and nothing else:

```
│ ⚠ The coach's layout didn't pass the   │ StatusCard, status.warning
│   checks, so it wasn't used            │
│ • It names a column "Weight" that      │ NoteLines from validateImportSpec
│   isn't in the file.                   │
│ • With it, 61% of rows can be read.    │
│   95% is needed.                       │
│ Nothing was imported.                  │
│ [            Try again             ]   │ SecondaryButton
├────────────────────────────────────────┤
│ [         Choose another file        ] │
```

The checks (research §2.4) are:
- the schema;
- every column it names exists at that position;
- every unit word it points to is in the file, and consistent across all rows;
- its own reading of 3–5 sample rows matches what code gets from its layout;
- a trial run reads at least 95% of rows.

Failures are written by code from a fixed list (§9.5).

#### 9.2.5 Check the layout

Example: a spreadsheet with no unit in it.

```
┌────────────────────────────────────────┐
│ Cancel        Check the layout         │
├────────────────────────────────────────┤
│ Training log.csv                       │
│ Layout suggested by the coach.         │ SourceTag (Coach)
│ GymSmarter checked it on every row.    │
│ ✓ 1,186 of 1,204 rows can be read      │
│ ⓘ 18 rows can't be read              › │
│                                        │
│ Needs your answer (3)                  │
│ ⚠ What is this file?                 › │ SettingsRow, question variant
│ ⚠ Weight unit                        › │
│ ⚠ What "3x8" means                   › │
│                                        │
│ How rows are read                      │ WorkedExample × 3–5 (§9.9)
│ Row 2                                  │
│ 03/11/2025 · Bench · 100 · 3x8 ·       │ file text, type.source
│ [note]                                 │
│ → Mon 3 Nov 2025 · Bench · 100 ? ·     │ reading, rendered by code
│   3x8 ?                                │
│ Row 415                                │
│ 21/11/2025 · Squat · 140 · 5x5         │
│ → Fri 21 Nov 2025 · Squat · 140 ? ·    │
│   5x5 ?                                │
│ ? fills in when you answer.            │
│                                        │
│ Columns (5)                            │ ColumnRoleRow (§9.9)
│ "Date"           Workout date        › │
│   Day first: "21/11/2025" can only be  │
│   21 November.                         │
│ "Exercise"       Exercise            › │
│ "Weight"         Load                › │
│ "Sets x Reps"    Sets and reps       › │
│ "Notes"          Kept as notes       › │
├────────────────────────────────────────┤
│ [  Answer 3 questions to continue    ] │ disabled
└────────────────────────────────────────┘
```

Once answered, the examples read `→ Mon 3 Nov 2025 · Bench · 3 sets × 8 reps at 100 kg` and the primary becomes `Use this layout` (accent).

- **Worked examples** are 3–5 rows chosen by code to cover different patterns: a warm-up marker, a row with RPE, a second workout on one day, a row that can't be read. They're always the file's text, then code's reading.
- **Column roles are a proposal; the properties the file doesn't state are questions.** The coach's roles are shown as already chosen because Ben checks them against the worked examples, and the code checks back them up. Unit, notation, day/month order, plan or done, and markers it couldn't read are questions with nothing selected.
- **Unit with evidence** isn't asked. It shows as a fact on the load column, e.g. `"Weight (kg)"  Load · kg, from the column name`, with `Not right? ›`, which opens the unit question with nothing selected.

**Column role sheet** (tap a column). A fixed list; at most one column per role, except notes.

```
┌────────────────────────────────────────┐
│ Column "Sets x Reps"              Done │
├────────────────────────────────────────┤
│ In your file: 3x8, 5x5, 4x10, 3x12 …   │ file text
│ 1,204 rows filled                      │
│                                        │
│ This column holds                      │
│ ( ) Workout date                       │
│ ( ) Start time, or date and time       │
│ ( ) Which workout                      │
│ ( ) Exercise                           │
│ ( ) Load                               │
│ ( ) Weight unit (kg or lb in each row) │
│ ( ) Reps                               │
│ (•) Sets and reps (like 3x8)           │ the current reading
│ ( ) One set (like 100x8)               │
│ ( ) All sets (like 100x5, 100x5)       │
│ ( ) Set number or set type             │
│ ( ) Effort (RPE)                       │
│ ( ) Notes                              │
│ ( ) Not imported                       │
│                                        │
│ Suggested by the coach: Sets and reps  │
└────────────────────────────────────────┘
```

- Choosing a role another column has moves that column to `Not imported` and says so: `"Reps" is now Not imported.` [Undo].
- `Weight unit` is refused unless every value in the column is a unit word: `Not every value in "Notes" is kg or lb.`
- Every change re-runs the checks, the examples and the counts. Changes are Ben's, so the column's `SourceTag` reads `You`.

**Layout questions** (each one appears only when the file needs it):

```
│ What is this file?                     │
│ GymSmarter imports workouts you did.   │
│ Plans and templates aren't imported.   │
│ ( ) Workouts I did                     │
│ ( ) A plan or template                 │
│ Columns named like targets: "Target    │ only when present (code's word list)
│ reps", "%1RM". They're never imported  │
│ as results.                            │
```

```
│ Weight unit                            │
│ The file doesn't say whether weights   │
│ are kg or lb.                          │
│ Values in your file: 2.5 to 180        │
│ ( ) kg                                 │
│ ( ) lb                                 │
│ Weights are stored as written, in the  │
│ unit you choose. Nothing is converted. │
```

```
│ What "3x8" means                       │
│ 1,204 rows. Row 2: "3x8", weight 100.  │
│ ( ) 3 sets of 8 reps                   │
│     → 100 × 8, 100 × 8, 100 × 8        │
│ ( ) 8 sets of 3 reps                   │
│     → 8 sets of 100 × 3                │
```

```
│ Dates like "03/04/2025"                │
│ No date in the file has a day above    │
│ 12, so the order isn't clear.          │
│ ( ) Day first: 3 Apr 2025              │
│     Dates run 2 Jan – 12 Nov 2025      │
│ ( ) Month first: 4 Mar 2025            │
│     Dates run 1 Feb – 11 Dec 2025      │
```

```
│ Markers in "Set Order"                 │
│ "W"   212 rows   Warm-up            ▾  │ the coach's reading
│ "D"    18 rows   Drop set           ▾  │
│ "F"     6 rows   ⚠ Not answered     ▾  │ no reading: asked
│ Choices: Warm-up · Working set · Drop  │
│ set · To failure · Not a set (skip)    │
```

A `Weight unit` question also appears when a row has values in both a kg and an lb column (`Which one did you enter?`), as for FitNotes 2 (§2.5 step 3c). An `Effort (RPE)` column is imported as RPE only for values from 1 to 10; others are kept as written in the row's original.

#### 9.2.6 Preview (shared), additions for these sources

Same screen as §2.5 step 3. The title becomes `Import preview` for every source. New lines are marked.

```
┌────────────────────────────────────────┐
│ Cancel          Import preview         │
├────────────────────────────────────────┤
│ strong_workouts.csv                    │
│ Layout suggested by the coach, checked │ new: layout line
│ by you                                 │
│ Weights in kg, from the column name    │ new: unit with its source
│ 4,212 rows · 4 Mar 2025 – 1 Oct 2026   │
│                                        │
│ Will import                            │
│ 186 workouts · 4,020 sets              │
│ 31 exercises                           │
│                                        │
│ Needs your answer (4)                  │
│ ⚠ 6 exercise names to check          › │
│ ⚠ Dumbbell weights: each or both?    › │
│ ⚠ Pull-up weights: added or assist?  › │
│ ⚠ 3 values to check                  › │ new (AI12)
│                                        │
│ Will be skipped                        │
│ ⓘ 40 cardio rows (not imported yet)  › │
│ ⓘ 32 rows can't be read              › │
│ ⓘ 212 dates came in with your        › │ AI5
│   FitNotes import on Thu 8 Oct         │
│                                        │
│ Kept as written                        │
│ ⓘ Start times as in the file. It has   │ new (AI4)
│   no time zone.                        │
│ ⓘ 88 notes, kept with their sets     › │
│ Gym: Not recorded                    › │
│                                        │
│ Save this layout             [ On ]    │ new (AI10)
│ Name: strong_workouts                › │
│ Next time, files with these 13 columns │
│ import without the coach.              │
│                                        │
│ Workouts (186)                         │
│ Wed 1 Oct 2026 · 18:02 · Push ·      › │
│ 5 exercises · 18 sets                  │
├────────────────────────────────────────┤
│ [    Answer 4 questions to import    ] │
└────────────────────────────────────────┘
```

- **Values to check** (AI12). Hard limits make a row unreadable, with the reason: more than 1,000 reps; more than 1,500 kg or 3,000 lb; a date before 2000; a date after today (a plan, not a workout). The soft check compares each workout's heaviest working set of an exercise with the previous workout's in the file. A load more than double, or less than half, is listed:

  ```
  │ Values to check (3)                    │
  │ Each is in your file as written. Check │
  │ it before importing.                   │
  │                                        │
  │ Bench Press (Barbell) · 12 Jun 2025    │
  │ 225 × 5. The workout before: 100 × 5.  │ file values, no ratio shown
  │ ( ) Import as written                  │
  │ ( ) Skip these 5 sets                  │
  │ …                                      │
  │ Import all as written                  │ text button
  ```
- **Dumbbells, bars and bodyweight** are the §2.5 step 3b screens, unchanged. A name word found by code is shown as the source, e.g. `Pull Up (Assisted): assistance, from the word "Assisted"`. Every exercise's conversion shows before commit, as ADR 0016 difference 20 does.
- **Exercise names** (§2.5 step 3a) gain one optional button under the unmatched names (AI13):

  ```
  │ 6 names have no match.                 │
  │ [ Ask the coach to suggest matches ]   │ SecondaryButton
  │ Sends these 6 names and GymSmarter's   │
  │ exercise list. Nothing else.           │
  │                                        │
  │ Flat DB Press                 96 sets  │
  │ ? Dumbbell bench press (two dumbbells) │ MatchStatus "Check"
  │   Check · suggested by the coach       │ SourceTag (Coach)
  │ [ Use this ]  [ Choose… ]  [ Add new ] │
  ```
  With the coach unavailable, the button is replaced by the one-line reason (`Coach not connected.`), and the rest of the screen works as before.
- **Save this layout** is on by default and visible. It's saved only when the import commits, and it stays if the import is later undone (like remembered names). `Name ›` opens a one-field sheet with `Save` above the keyboard. The default name is the file name without its extension.

#### 9.2.7 Saved layouts in use

**Same columns.** No coach and no network. The preview's layout line reads:

```
│ strong_workouts_nov.csv                │
│ Layout: strong_workouts · saved 9 Oct  │ SourceTag (Saved layout)
│ Read on this phone. Nothing was sent.  │
│ Weights in kg, from the column name    │
```

Ben's answers from the layout show as answered rows, labelled: `✓ What it is: Workouts I did · your answer last time`. They're changeable until commit. Questions the layout can't answer (new exercise names, their conventions, new markers, values to check) are asked as usual.

**Changed columns.** All the columns holding date, exercise, load and reps are there by exact name, and others were added or removed.

```
┌────────────────────────────────────────┐
│ Cancel        Changed columns          │
├────────────────────────────────────────┤
│ strong_workouts_nov.csv                │
│ Matches your layout "strong_workouts", │
│ with 1 new column.                     │
│                                        │
│ New column "Rest Timer (sec)"          │
│ In your file: 60, 90, 120 …            │
│ 3,880 rows filled                      │
│ This column holds                      │
│ ( ) Not imported                       │ nothing pre-selected
│ ( ) Notes                              │
│ ( ) Something else…                    │ full role list
│                                        │
│ Read the whole file with the coach   › │ optional
├────────────────────────────────────────┤
│ [             Continue               ] │ disabled until answered
└────────────────────────────────────────┘
```

A removed optional column is a line, not a question: `The column "RPE" isn't in this file. Effort won't be imported from it.` If a column for date, exercise, load or reps is missing, the file is a new layout (§9.2.2). At commit, the layout learns the new columns (a new version); older files with the old columns still match.

#### 9.2.8 Notes and pasted text

**Paste text.** Full-screen editor. Pasting uses the iOS edit menu, so no clipboard module is needed.

```
┌────────────────────────────────────────┐
│ Cancel           Paste text            │
├────────────────────────────────────────┤
│ Paste your workout notes.              │
│ ┌────────────────────────────────────┐ │
│ │ Mon 6 Oct                          │ │ multi-line field, type.body
│ │ Bench 3x5 @ 100                    │ │
│ │ Squat 100x5, 105x5, 110x3          │ │
│ │ …                                  │ │
│ └────────────────────────────────────┘ │
│ 38,214 characters · 1,120 lines        │
├────────────────────────────────────────┤ sits on the keyboard
│ [             Continue               ] │
└────────────────────────────────────────┘
```

A `.txt` or `.md` file (for example a note exported from Notes as Markdown) that isn't a table comes straight to the next screen.

**Read your notes (consent).**

```
┌────────────────────────────────────────┐
│ Cancel        Read your notes          │
├────────────────────────────────────────┤
│ Pasted text · 1,120 lines              │
│ 412 lines have numbers                 │
│ Dates found: 2 Mar 2024 – 1 Oct 2026   │ only when code found date headings
│                                        │
│ Send                                   │
│ (•) All of it · 38,214 characters      │
│ ( ) Only some dates…                   │ date range picker
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ↑ What's sent                      │ │ ConsentCard
│ │ The text you chose: about 38,000   │ │
│ │ characters, in up to 14 requests,  │ │
│ │ one at a time.                     │ │
│ │ Not sent: your history, memories,  │ │
│ │ pain flags or gyms.                │ │
│ │ See exactly what's sent          › │ │
│ └────────────────────────────────────┘ │
│ Sent to ChatGPT, using your plan.      │
│ OpenAI handles it under your account's │
│ terms. If you let apps use ChatGPT     │
│ credits after plan limits, OpenAI may  │
│ use them. GymSmarter can't see that    │
│ setting.                               │
│                                        │
│ The coach copies each set with the     │
│ line it came from. GymSmarter drops    │
│ any number that isn't in that line.    │
├────────────────────────────────────────┤
│ [         Send to the coach          ] │
└────────────────────────────────────────┘
```

- `Up to 14 requests` is the most it can take. The first request sends up to 120 lines to find the patterns. Lines those patterns read are then read on the phone, so fewer parts are usually sent. The finished screen says what was actually sent: `Sent 6,200 characters in 3 requests.`
- On the API-key route, the route lines read `Sent to OpenAI with your API key (paid). Up to about $1.20 (estimate).` The cap is checked before each request, and the import pauses at the cap.

**Reading parts.** `ProgressLine` with a count; no animation.

```
┌────────────────────────────────────────┐
│ Reading your notes                     │
├────────────────────────────────────────┤
│ 5 of 14 parts                          │
│ ▓▓▓▓▓▓░░░░░░░░░░░░                     │
│ Parts already read are kept on this    │
│ phone and aren't sent again.           │
│                                        │
│ Keep GymSmarter open. If it closes,    │
│ you can carry on from here.            │
│                                        │
│ Stop                                   │
└────────────────────────────────────────┘
```

Paused (Stop, limit, offline, closed): `Paused at 5 of 14 parts: <reason>.` · `Nothing more is sent until you tap Continue. 9 parts left.` [Continue] [Cancel import].

**Check your notes.**

```
┌────────────────────────────────────────┐
│ Cancel        Check your notes         │
├────────────────────────────────────────┤
│ 412 lines with numbers                 │
│ ✓ 371 read with patterns you confirm   │
│ ⓘ 29 read by the coach, line by line › │ → ticks, below
│ ⓘ 12 not read                        › │
│ ⓘ 4 sets dropped: a number isn't in  › │
│   its line                             │
│                                        │
│ Needs your answer (4)                  │
│ ⚠ What are these notes?              › │ AI2 wording for notes
│ ⚠ Weight unit (lines without one)    › │
│ ⚠ What "3x5 @ 100" means             › │ AI3, one per pattern
│ ⚠ What "100x5" means                 › │
│                                        │
│ Patterns                               │
│ "Bench 3x5 @ 100"        214 lines   › │ file text; tap for examples
│ "Squat 100x5, 105x5"     131 lines   › │
│ "12/10/8"                 26 lines   › │
│ Date headings like "Mon 6 Oct"         │
├────────────────────────────────────────┤
│ [  Answer 4 questions to continue    ] │
└────────────────────────────────────────┘
```

- Patterns come from a fixed list (research §2.1 D). The coach only points at lines; code reads the numbers in them, and Ben's notation answer says which number is which.
- A unit word in a line (`bench 225lbs - 8,8,6`) is that line's unit. Lines without one take Ben's answer.
- Headings without a year ask once: `Your dates have no year. Which year is "Mon 2 Mar" in?` (year picker, nothing selected). Code counts years forward from there and lists any heading whose weekday doesn't fit.
- **Read by the coach, line by line** (AI11):

  ```
  ┌────────────────────────────────────────┐
  │ ‹ Back   Read by the coach (29)   Done │
  ├────────────────────────────────────────┤
  │ The coach read these lines one by one. │
  │ Tick the ones it read right. Only      │
  │ ticked sets are imported.              │
  │                                        │
  │ [ ] Line 212 · Mon 6 Oct 2025          │ ChecklistRow
  │     "bench 100 for 8 then 7"           │ file text
  │     → Bench · 100 × 8, 100 × 7         │ code-rendered
  │ [ ] Line 340 · Thu 23 Oct 2025         │
  │     "rows w/ 30s, 3 sets of 10"        │
  │     → Rows · 30 × 10 (3 sets)          │
  │ …                                      │
  │ Select all (29)                        │ text button
  └────────────────────────────────────────┘
  ```
  Units on these sets come from the line or Ben's unit answer; conventions come from the usual preview questions.
- `12 not read` lists each line with its number and text. `4 sets dropped` shows the line and the number that wasn't in it: `Line 455 "Squat 140x5": 145 isn't in this line.` Neither list can be imported from here; both go into the results CSV.
- `Save this layout` on the preview saves the confirmed patterns and answers as a **Notes** layout. Next time, lines matching them are read offline; other lines still need the coach and a new consent.

#### 9.2.9 Saved import layouts

Data & backup → Import → `Saved import layouts`, or `Layouts you've saved` on Import history.

```
┌────────────────────────────────────────┐
│ ‹ Back    Saved import layouts         │
├────────────────────────────────────────┤
│ 👤 Your data                           │ DomainLabel
│ Files with these exact columns import  │
│ without the coach, on this phone.      │
│                                        │
│ strong_workouts                      › │
│ 13 columns · kg · used twice · 1 Oct   │
│ Training log                         › │
│ 5 columns · lb · used once · 9 Oct     │
│ My notes                             › │
│ Notes · 3 patterns · used once         │
└────────────────────────────────────────┘
```

```
┌────────────────────────────────────────┐
│ ‹ Back         strong_workouts         │
├────────────────────────────────────────┤
│ Name                strong_workouts  › │
│ Suggested by the coach, checked by you │ SourceTag
│ on Thu 9 Oct 2026                      │
│ Used by 2 imports                    › │ → Past imports, filtered
│                                        │
│ Columns (13)                           │
│ "Workout #"         Which workout      │ read-only
│ "Date"              Start time (as in  │
│                     the file)          │
│ "Exercise Name"     Exercise           │
│ "Weight (kg)"       Load · kg, from    │
│                     the column name    │
│ "Reps"              Reps               │
│ "Set Order"         Set number · W D F │
│ "Notes"             Kept as notes      │
│ …                                      │
│                                        │
│ Your answers                           │
│ What it is          Workouts I did   › │
│ Markers  W warm-up · D drop · F to   › │
│          failure                       │
│                                        │
│ Columns are changed while importing a  │
│ file, where you can see the result.    │
│ Changes apply to your next import.     │
│                                        │
│ Delete layout                          │ DangerTextButton
└────────────────────────────────────────┘
```

- Answers open their question screen with Ben's current answer marked. A change makes a new layout version and never alters past imports.
- Column roles aren't edited here, because there's no file to show worked examples from.
- Empty list: `No saved layouts yet. When you import a file the coach read, you can save its layout.`

#### 9.2.10 Results, Past imports and provenance

- Results (§2.5 step 5) add one line under the source: `Layout saved: strong_workouts` (or `Layout: strong_workouts · saved 9 Oct`). For notes: `Sent 6,200 characters in 3 requests.`
- The row-by-row CSV gains `line`, `read_by` (`code` / `coach`) and `layout` columns, and the results `skipped_values_to_check`, `not_read` and `dropped_number_not_in_line`.
- Past imports row: `strong_workouts.csv · Thu 9 Oct · 186 workouts` with a second line, `Layout suggested by the coach · saved as strong_workouts`.
- Each imported set (§2.5 step 3d, and the results' `Imported workouts`) shows:

  ```
  │ 1  100 kg × 8                          │
  │    strong_workouts.csv, row 1,204:     │
  │    Bench Press (Barbell) · 100 · 8     │ text.secondary
  │    Layout suggested by the coach       │ SourceTag
  │                                        │
  │ 1  100 kg × 8                          │
  │    Your notes, line 212:               │
  │    "bench 100 for 8 then 7"            │
  │    Read by the coach · ticked by you   │ SourceTag
  ```

### 9.3 States

#### 9.3.1 Detection (code, on the phone, after `Choose file` or `Continue`)

| Result | How code decides | Shows |
|---|---|---|
| FitNotes | Header equals one of the 7 known headers (ADR 0016) | §2.5 step 3 |
| Saved layout | Header cells, delimiter and section markers equal a saved layout's | Preview with `Layout: <name>` (§9.2.7). Nothing sent |
| Saved layout, changed columns | Same delimiter; the layout's date, exercise, load and reps columns are all present by exact name; other columns added or missing | Changed columns |
| Saved layout damaged | It fails the schema check (a damaged or edited backup) | `Your saved layout "strong_workouts" can't be used because it's damaged.` Then treated as a new table. It can be deleted in Saved import layouts |
| New table | One of `,` `;` or tab gives the same number of cells on at least 95% of lines; at least 2 columns and 2 data rows. Also multi-section files (`### … ###` lines) | New file layout |
| Notes | Not a table, with at least one line that has a digit | Read your notes |
| Spreadsheet file | `.xlsx` or `.numbers` (zip) | `This is a spreadsheet file. Export the sheet as CSV and choose that.` |
| PDF or photo | PDF or image file signature | `GymSmarter can't read PDFs or photos yet. Export a CSV, or paste the text.` |
| App backup | SQLite file signature | Unchanged (§3.4) |
| Nothing to read | Empty, or no line has a digit | `This file has no numbers to import.` |
| Same file again | SHA-256 matches an import still in effect | Unchanged (§3.4, ADR 0016) |

#### 9.3.2 Coach readiness

Source: `getImportCoachStatus` (§9.6), built on `getAiCapabilities`, `resolveInferenceRoute` and `getConnectivity`. The wording matches system-states.md §3.2. Every unavailable state says nothing was sent, offers the fix, and never switches route.

| State | Coach line (Import history) | New file layout / Read your notes | Primary |
|---|---|---|---|
| Ready, ChatGPT plan | `Coach: ChatGPT plan · connected` | Consent (§9.2.2, §9.2.8) | `Read with the coach` / `Send to the coach` |
| Ready, API key | `Coach: your API key (paid) · connected` | Consent with estimate and cap line | Same |
| Not connected (includes ChatGPT sign-in not working on iPhone) | `Coach not connected. FitNotes and saved layouts still work.` `Connect ›` | `⊘ Reading a new layout needs the coach` · `The coach isn't connected. Nothing was sent.` · `Connect the coach ›` | `Choose another file` |
| Offline | `No connection. FitNotes and saved layouts still work.` | `⚠ No connection` · `Reading a new layout needs the internet. Nothing was sent.` | `Read with the coach`, disabled, caption `Needs internet`. It turns back on when the connection returns; nothing is sent until Ben taps |
| Signed out or expired | `ChatGPT disconnected. FitNotes and saved layouts still work.` | `⚠ ChatGPT disconnected` · `Sign in again to read new layouts. Nothing was sent.` `Sign in ›` | `Choose another file` |
| Usage limit reached (429) | `ChatGPT usage limit reached. FitNotes and saved layouts still work.` | `⚠ ChatGPT usage limit reached` · `Nothing was sent. Try again later.` `Manage usage ›`. If a key exists: `Switch coach to your API key (paid) ›` (ai-connection §2.7 confirmation). No reset time | `Choose another file` |
| Usage unavailable (503) | Unchanged | `ChatGPT usage isn't available right now. Try again later.` | `Try again` |
| API cap reached | `Coach paused at your $5.00 cap.` | `Paused: you've reached your $5.00 cap for October.` `Change cap ›` | `Choose another file` |
| Estimate over the cap left | — | `This would go over your $5.00 cap for October.` `Change cap ›` | Disabled |
| Model unavailable | `Coach paused: model unavailable.` | `The model you chose isn't available any more.` `Choose model ›` | `Choose another file` |
| Route can't read layouts (capability flag `importLayouts: false`, from spike S3) | `Reading new layouts doesn't work with the ChatGPT plan yet.` | Same line + `FitNotes files and layouts you've saved still import.` | `Choose another file` |

#### 9.3.3 Reading the layout

| State | Shows | Next |
|---|---|---|
| Sending / waiting / checking | §9.2.4 step rows | Check the layout, or a failure |
| Stopped by Ben | `Stopped. Nothing was imported.` Any late answer is thrown away | New file layout |
| Interrupted (app left or closed) | `Reading was interrupted. Nothing was imported.` | `Read with the coach` |
| Timed out (120 s) | `The coach didn't answer in time. Nothing was imported.` | `Try again` |
| Limit or error mid-request | As §9.3.2, plus `Nothing was imported.` | As §9.3.2 |
| No layout returned (refusal, empty, or not exactly one layout) | `The coach didn't return a layout. Nothing was imported.` | `Try again` |
| Coach found no sets (`unsupported`) | `The coach couldn't find sets in this file. Nothing was imported.` | `Choose another file` |
| Checks failed | §9.2.4, with code's reasons | `Try again` / `Choose another file` |
| Done | — | Check the layout |

`Try again` never runs on its own; each attempt is Ben's tap and sends the same text he saw. A layout that arrived before an interruption is kept by its sample hash and reused rather than sent for again.

#### 9.3.4 Check the layout

| State | Shows | Primary |
|---|---|---|
| Needs answers | §9.2.5 | Disabled `Answer 3 questions to continue` |
| Rechecking | After a role change or answer, the counts line reads `Checking…` (static) until the dry run returns | Disabled |
| Too few rows | `With this layout, 61% of rows can be read. 95% is needed.` | Disabled. Ben changes a role back, or reads with the coach again |
| Role refused | Inline under the role list, e.g. `Not every value in "Notes" is kg or lb.` | Unchanged |
| A plan or template | `GymSmarter imports workouts you did. Nothing will be imported from this file.` | `Choose another file` |
| Ready | Examples complete, no `?` | `Use this layout` |

#### 9.3.5 Notes

| State | Shows | Primary |
|---|---|---|
| Ready to send | §9.2.8 consent | `Send to the coach` |
| Reading | `5 of 14 parts` | None (`Stop`) |
| Paused: stopped / limit / offline / closed / cap | `Paused at 5 of 14 parts: <reason>.` · `Nothing more is sent until you tap Continue. 9 parts left.` | `Continue` (disabled offline) + text button `Cancel import` |
| A part failed (timeout, no answer) | `Part 6 couldn't be read: <reason>. Parts 1–5 are kept.` | `Try part 6 again` |
| Finished | `Sent 6,200 characters in 3 requests.` | → Check your notes |
| Needs answers / ticks | §9.2.8 | Disabled until answered. Unticked sets don't block; they're simply not imported |

#### 9.3.6 Saved import layouts

| State | Shows |
|---|---|
| None | Empty line (§9.2.9); the hub row is hidden |
| List / detail | §9.2.9 |
| Damaged | Row reads `⚠ Can't be used: damaged` with `Delete layout` |
| Deleted | Toast `Layout deleted` [Undo] (5 s) |
| Renamed / answer changed | Toast `Saved. Applies to your next import.` |

#### 9.3.7 Transitions

```text
Import history ─file─► detect ─┬─ FitNotes ─────────────────────────────┐
                               ├─ saved layout ─────────────────────────┤
                               ├─ changed columns ─answer─► ────────────┤
                               ├─ new table ─► New file layout          │
                               │     ├─ coach unusable ─► honest stop   │
                               │     └─ Read ─► Reading ─┬─ fail ─► Try again ─► Reading
                               │                         └─ ok ─► Check the layout ─Use─┤
                               └─ notes ─► consent ─Send─► parts ⇄ paused               │
                                                     └─ done ─► Check your notes ─────┤
                                                                                        ▼
         Preview (questions) ─Import─► safeguard ─► backup ─► Importing ⇄ paused ─► Results ─Undo─► Reverted
                                                     on commit: save layout (if on)
```

### 9.4 Interactions

- **Choose file** → system picker (CSV, TSV, plain text, Markdown). The file is copied to the cache and detected on the phone. Nothing leaves the phone before a consent screen's primary is tapped.
- **Paste text** → editor. `Continue` is enabled once the text has a digit. The field has a size limit, set after measuring on the phone. Over it: `This is too long to paste. Save it as a file and choose that.`
- **See exactly what's sent** → sheet. Column switches change the text and count at once, and `Done` returns to the consent screen with its bullets updated. If the text changes after Ben has seen it, the next `Read` sends the new text: what's sent always equals the sheet's current text (AI7).
- **Read with the coach** → one request with an operation ID, carrying the sample hash. `Stop` cancels it and throws away any late answer.
- **Check the layout** → each question opens its screen, and `Done` returns with `✓` and the answer. Tapping a column opens the role sheet; a role change re-runs the checks and shows `Undo` for one tap. Every change bumps `layoutVersion`; a stale write is refused (rule 5).
- **Use this layout** → `confirmImportLayout` → the shared preview, which is built from the layout's `SourceSetRow`s. `Back` from the preview returns to Check the layout with its answers kept.
- **Preview** → as §4.3. Answers and the layout version are both in the commit's staleness stamp. `Save this layout` and its name can be changed until commit.
- **Notes** → `Send to the coach` sends parts one at a time. `Stop` asks `Stop reading? 5 parts are read and kept. Nothing more is sent.` [Keep reading] [Stop]. `Continue` sends only the parts left. Ticks toggle on tap; `Select all (29)` / `Clear all`.
- **Ask the coach to suggest matches** → one request with the unmatched names and the exercise list (Coaching knowledge). Suggestions arrive as `Check` rows. Suggestions that name an unknown exercise, or contradict an equipment or one-arm word, are dropped by code without comment.
- **Saved import layouts** → rename (one-field sheet, `Save` above the keyboard), change an answer (its question screen), `Delete layout` → alert → toast with `Undo`.
- **Commit, stop, resume, Undo this import**: unchanged (§4.3). Operation IDs are `<operationId>:<workoutKey>`, so the same file with the same layout version gives the same IDs (rule 5).
- **Keyboard:** only the paste editor, layout name and search fields. The footer primary sits on the keyboard.
- **Voice:** none. The coach can explain these screens in chat but can't start, answer or commit an import (DX10, AI15).
- **Backgrounding:** leaving the app during a request may cut it (iOS). The layout path then shows `Reading was interrupted`; notes pause and keep finished parts.

| Action | Undo |
|---|---|
| Column role change | `Undo` on the line, or change it back |
| Layout answer | Change before `Use this layout` or before commit |
| Coach-read set ticked | Untick before commit |
| Import | `Undo this import` (revert, unchanged) |
| Layout saved | Delete it in Saved import layouts |
| Layout deleted | Toast `Undo` |
| Layout renamed or answer changed | Change it again |
| Sending to the coach | None: it can't be unsent. That's why consent comes first, shows the exact text, and is the only way to send |

### 9.5 Copy

| Element | Text |
|---|---|
| Hub rows | `Import history` · `Saved import layouts (2)` · `Past imports (1)` |
| Import history | Title `Import history` · `Bring in workouts from another app, a spreadsheet or your notes. You'll see what will be imported before anything is saved.` · `Works offline` · `FitNotes and FitNotes 2 CSV files` · `Layouts you've saved (2)` · `Needs the coach` · `Other apps and spreadsheets (CSV)` · `Workout notes and pasted text` · `For a spreadsheet, export one sheet as CSV first.` · `Paste text` · `Choose file` |
| Coach line | `Coach: ChatGPT plan · connected` · `Coach: your API key (paid) · connected` · `Coach not connected. FitNotes and saved layouts still work.` · `No connection. FitNotes and saved layouts still work.` · `ChatGPT disconnected. FitNotes and saved layouts still work.` · `ChatGPT usage limit reached. FitNotes and saved layouts still work.` · `Coach paused at your $5.00 cap.` · `Coach paused: model unavailable.` · `Reading new layouts doesn't work with the ChatGPT plan yet.` · `Connect ›` |
| New file layout | Title `New file layout` · `Table · 13 columns · 4,212 rows` · `GymSmarter doesn't know this layout yet. The coach can read the column names and a few rows and suggest how to read it. GymSmarter checks that on every row, and you confirm it before anything is saved.` |
| Consent (table) | `What's sent` · `The 13 column names` · `A summary of each column, made on this phone` · `30 rows, with notes hidden` · `30 rows, with notes and 2 more columns hidden` · `Not sent: the other rows, notes, your history, memories, pain flags or gyms.` · `See exactly what's sent` · `Sent to ChatGPT, using your plan.` · `OpenAI handles it under your account's terms.` · `Sent to OpenAI with your API key (paid). About $0.05 (estimate).` · `This month: $1.42 of $5.00.` · primary `Read with the coach` |
| What's sent sheet | `What's sent` · `This is the exact text GymSmarter sends. Nothing else is added.` · `Example values` · `numbers` / `dates` / `short text` / `notes` · `Hidden` · `Off: only the column name and counts are sent.` · `Your file, as sent` · `6,812 characters` · `GymSmarter's instructions` |
| Unavailable | `Reading a new layout needs the coach` · `The coach isn't connected. Nothing was sent.` · `FitNotes files and layouts you've saved import without it.` · `Connect the coach` · `No connection` · `Reading a new layout needs the internet. Nothing was sent.` · `Needs internet` · `ChatGPT disconnected` · `Sign in again to read new layouts. Nothing was sent.` · `Sign in` · `ChatGPT usage limit reached` · `Nothing was sent. Try again later.` · `Manage usage` · `Switch coach to your API key (paid)` · `ChatGPT usage isn't available right now. Try again later.` · `Paused: you've reached your $5.00 cap for October.` · `This would go over your $5.00 cap for October.` · `Change cap` · `The model you chose isn't available any more.` · `Choose model` · `First line of the file` · `Share first line` · `Choose another file` |
| Reading | `Reading the layout` · `Column summary made on this phone` · `Sent to ChatGPT · 6,812 characters` · `Waiting for the coach` · `Checking it on all 4,212 rows` · `Keep GymSmarter open. If it closes, nothing is imported and you can try again.` · `Stop` |
| Reading failures | `Stopped. Nothing was imported.` · `Reading was interrupted. Nothing was imported.` · `The coach didn't answer in time. Nothing was imported.` · `The coach didn't return a layout. Nothing was imported.` · `The coach couldn't find sets in this file. Nothing was imported.` · `The coach's layout didn't pass the checks, so it wasn't used` · `Try again` |
| Check reasons (code, fixed list) | `It names a column "<name>" that isn't in the file.` · `It uses the column "<name>" for two things.` · `It points to "<word>" as the unit, but that isn't in the column name.` · `It says "<name>" holds units, but not every value is kg or lb.` · `It reads row <n> as <reading>, but its own layout gives <reading>.` · `With it, 61% of rows can be read. 95% is needed.` · `Its marker "<token>" isn't in the file.` · `Its answer wasn't in the expected form.` |
| Check the layout | Title `Check the layout` · `Layout suggested by the coach.` · `GymSmarter checked it on every row.` · `1,186 of 1,204 rows can be read` · `18 rows can't be read` · `How rows are read` · `Row 2` · `? fills in when you answer.` · `Columns (5)` · `Day first: "21/11/2025" can only be 21 November.` · `Load · kg, from the column name` · `Not right?` · `Checking…` · primary `Answer 3 questions to continue` / `Use this layout` |
| Roles | `This column holds` · `Workout date` · `Start time, or date and time` · `Which workout` · `Exercise` · `Load` · `Weight unit (kg or lb in each row)` · `Reps` · `Sets and reps (like 3x8)` · `One set (like 100x8)` · `All sets (like 100x5, 100x5)` · `Set number or set type` · `Effort (RPE)` · `Notes` · `Kept as notes` · `Not imported` · `Suggested by the coach: <role>` · `"Reps" is now Not imported.` · `Not every value in "<name>" is kg or lb.` · `In your file:` · `1,204 rows filled` |
| Layout questions | `What is this file?` · `GymSmarter imports workouts you did. Plans and templates aren't imported.` · `Workouts I did` · `A plan or template` · `Columns named like targets: "Target reps", "%1RM". They're never imported as results.` · `GymSmarter imports workouts you did. Nothing will be imported from this file.` · `Weight unit` · `The file doesn't say whether weights are kg or lb.` · `Values in your file: 2.5 to 180` · `Weights are stored as written, in the unit you choose. Nothing is converted.` · `Rows have values in both the kg and lb columns. Which one did you enter?` · `What "3x8" means` · `3 sets of 8 reps` · `8 sets of 3 reps` · `Dates like "03/04/2025"` · `No date in the file has a day above 12, so the order isn't clear.` · `Day first: 3 Apr 2025` · `Month first: 4 Mar 2025` · `Dates run 2 Jan – 12 Nov 2025` · `Markers in "Set Order"` · `Warm-up` · `Working set` · `Drop set` · `To failure` · `Not a set (skip)` · `Not answered` |
| Preview additions | Title `Import preview` · `Layout suggested by the coach, checked by you` · `Layout: strong_workouts · saved 9 Oct` · `Read on this phone. Nothing was sent.` · `Weights in kg, from the column name` · `Weights in kg, your answer` · `3 values to check` · `212 dates came in with your FitNotes import on Thu 8 Oct` · `Start times as in the file. It has no time zone.` · `18:02 (as in the file)` · `Save this layout` · `Name: strong_workouts` · `Next time, files with these 13 columns import without the coach.` · `your answer last time` |
| Values to check | `Values to check (3)` · `Each is in your file as written. Check it before importing.` · `225 × 5. The workout before: 100 × 5.` · `Import as written` · `Skip these 5 sets` · `Import all as written` · unreadable reasons `More than 1,000 reps` · `Over 1,500 kg` / `Over 3,000 lb` · `Before 2000` · `After today: a plan, not a workout` |
| Names | `6 names have no match.` · `Ask the coach to suggest matches` · `Sends these 6 names and GymSmarter's exercise list. Nothing else.` · `Check · suggested by the coach` · `(two dumbbells)` / `(one dumbbell)` · `Pull Up (Assisted): assistance, from the word "Assisted"` |
| Changed columns | Title `Changed columns` · `Matches your layout "strong_workouts", with 1 new column.` · `New column "Rest Timer (sec)"` · `Something else…` · `Read the whole file with the coach` · `The column "RPE" isn't in this file. Effort won't be imported from it.` · `Your saved layout "strong_workouts" can't be used because it's damaged.` |
| Paste text | Title `Paste text` · `Paste your workout notes.` · `38,214 characters · 1,120 lines` · `This is too long to paste. Save it as a file and choose that.` · `Continue` |
| Notes consent | Title `Read your notes` · `412 lines have numbers` · `Dates found: 2 Mar 2024 – 1 Oct 2026` · `Send` · `All of it · 38,214 characters` · `Only some dates…` · `The text you chose: about 38,000 characters, in up to 14 requests, one at a time.` · `Not sent: your history, memories, pain flags or gyms.` · `If you let apps use ChatGPT credits after plan limits, OpenAI may use them. GymSmarter can't see that setting.` · `The coach copies each set with the line it came from. GymSmarter drops any number that isn't in that line.` · `Up to about $1.20 (estimate).` · primary `Send to the coach` |
| Notes reading | `Reading your notes` · `5 of 14 parts` · `Parts already read are kept on this phone and aren't sent again.` · `Keep GymSmarter open. If it closes, you can carry on from here.` · `Paused at 5 of 14 parts: <reason>.` · `Nothing more is sent until you tap Continue. 9 parts left.` · `Continue` · `Cancel import` · `Stop reading? 5 parts are read and kept. Nothing more is sent.` [Keep reading] [Stop] · `Part 6 couldn't be read: <reason>. Parts 1–5 are kept.` · `Try part 6 again` · `Sent 6,200 characters in 3 requests.` |
| Check your notes | Title `Check your notes` · `412 lines with numbers` · `371 read with patterns you confirm` · `29 read by the coach, line by line` · `12 not read` · `4 sets dropped: a number isn't in its line` · `What are these notes?` · `Workouts I did` / `A plan or template` · `Weight unit (lines without one)` · `What "3x5 @ 100" means` · `Patterns` · `Date headings like "Mon 6 Oct"` · `Your dates have no year. Which year is "Mon 2 Mar" in?` · `Line 455 "Squat 140x5": 145 isn't in this line.` |
| Ticks | Title `Read by the coach (29)` · `The coach read these lines one by one. Tick the ones it read right. Only ticked sets are imported.` · `Line 212 · Mon 6 Oct 2025` · `Select all (29)` · `Clear all` |
| Saved layouts | Title `Saved import layouts` · `Files with these exact columns import without the coach, on this phone.` · `13 columns · kg · used twice · 1 Oct` · `Notes · 3 patterns · used once` · `Suggested by the coach, checked by you on Thu 9 Oct 2026` · `Used by 2 imports` · `Your answers` · `Columns are changed while importing a file, where you can see the result. Changes apply to your next import.` · `Delete layout` · `No saved layouts yet. When you import a file the coach read, you can save its layout.` · `Can't be used: damaged` · toasts `Layout deleted` [Undo] · `Saved. Applies to your next import.` |
| Delete layout alert | `Delete "strong_workouts"?` / `Workouts you imported with it stay. Next time, a file with these columns needs the coach again.` [Cancel] [Delete] |
| Results and provenance | `Layout saved: strong_workouts` · `Layout suggested by the coach · saved as strong_workouts` · `strong_workouts.csv, row 1,204:` · `Layout suggested by the coach` · `Your notes, line 212:` · `Read by the coach · ticked by you` |
| Detection messages | `This is a spreadsheet file. Export the sheet as CSV and choose that.` · `GymSmarter can't read PDFs or photos yet. Export a CSV, or paste the text.` · `This file has no numbers to import.` |
| Onboarding | `Import training history` · `FitNotes, other apps, spreadsheets or notes` |

Spoken cues: none. Targets and actuals: everything on these screens is a recorded actual from the file. Target-like columns are named only to say they aren't imported.

### 9.6 Data needed

Existing, unchanged: `updateImportMapping`, `commitImport(jobId, mappingVersion, operationId)` (its staleness stamp gains the layout's `profileId@version` and spec hash), `revertImport`, `listImportJobs`, `getImportJob`, `getActiveSession`, `getAiCapabilities(userId)`, `resolveInferenceRoute(userId, 'text')`, `checkPersonalSpendCap(requestId, estimate)`, `recordPersonalApiUsage(requestId, actualUsage)`, `getConnectivity()`, and the domain's `analyseImport` and `planImportRows` (they take `SourceSetRow[]` instead of `FitNotesRow[]`).

New contracts, for the developer (research §2.3, §7 and brief change 2):

| Function | Purpose |
|---|---|
| `previewImport(source: {kind: 'file', uri} \| {kind: 'text', text}, operationId)` → `{jobId, detection}`. `detection` is one of `{kind: 'fitnotes', variant}`, `{kind: 'saved_layout', profileId, version}`, `{kind: 'saved_layout_changed', profileId, version, added: ColumnRef[], missing: ColumnRef[]}`, `{kind: 'new_table', delimiter, columns: ColumnRef[], rowCount, firstLine}`, `{kind: 'notes', chars, lines, numberLines, dateRange?}`, or `{kind: 'not_readable', reason: 'empty' \| 'binary' \| 'spreadsheet_file' \| 'pdf_or_image' \| 'app_backup' \| 'no_numbers'}` | Replaces `previewFitNotesImport` (FitNotes analysis unchanged). Detection runs on the phone with no network |
| `getImportCoachStatus(ownerId)` → `{route: 'chatgpt_plan' \| 'api_key' \| null, state: 'ready' \| 'not_connected' \| 'offline' \| 'signed_out' \| 'limit' \| 'unavailable' \| 'cap_reached' \| 'model_unavailable' \| 'route_cannot_read_layouts', capLeftUsd?}` | §9.3.2. Composes existing capability, route and connectivity calls; never picks another route |
| `buildImportSample(jobId, {hiddenColumns: number[]})` → `{sampleHash, dataText, instructionsText, chars, columns: {ref: ColumnRef, kind: 'number' \| 'date' \| 'short_text' \| 'notes', sendValues: boolean}[], estimateUsd?}` | The literal request text for §9.2.3. Notes columns never send values |
| `proposeImportMapping(jobId, sampleHash, operationId)` → `{status: 'proposed', layoutVersion} \| {status: 'rejected', reasons: SpecCheckFailure[]} \| {status: 'unavailable', reason} \| {status: 'failed', reason: 'timeout' \| 'no_layout_returned' \| 'interrupted' \| 'provider_error'}` | Sends exactly `dataText` (hash checked) with one forced output function and no other tools. A completed response without exactly one layout is `no_layout_returned`. Runs `validateImportSpec` before returning `proposed` |
| `validateImportSpec(spec: ImportMappingSpecV1, fileText)` → `{ok: true, dryRun: {readRows, totalRows, unreadable[]}, workedExamples: {row, cells[], reading}[]} \| {ok: false, failures: SpecCheckFailure[]}` | Pure (`packages/domain`). The checks in §9.2.4. `ImportMappingSpecV1` is the research §2.3 sketch: closed vocabulary, **no convention fields** |
| `getLayoutReview(jobId)` → `{layoutVersion, columns: {ref, role, detail?, source: 'coach' \| 'ben' \| 'saved_layout'}[], unit: {kind: 'header_token' \| 'unit_column' \| 'answer' \| 'ask', …}, dryRun, workedExamples, questions: LayoutQuestion[]}` | Drives §9.2.5. `LayoutQuestion` is one of `record_kind`, `unit`, `both_unit_columns`, `date_order`, `year_missing`, `notation{pattern}`, `marker{column, token}` or `new_column{ref}` |
| `updateImportLayout(jobId, change: {kind: 'role', column, role} \| {kind: 'answer', question, answer}, expectedLayoutVersion)` → new `layoutVersion` and review | Stale versions rejected |
| `confirmImportLayout(jobId, expectedLayoutVersion)` → the existing preview analysis | Applies the layout to every row, producing `SourceSetRow[]` |
| `startTextImport(jobId, {range?}, operationId)` / `continueTextImport(jobId, operationId)` / `getTextImportProgress(jobId)` → `{partsDone, partsTotal, charsSent, requestsSent, state: 'reading' \| 'paused' \| 'done', pauseReason?}` | Notes parts, one request at a time. Finished parts are cached with the job and never re-sent |
| `getNotesReview(jobId)` / `setCoachReadSets(jobId, tickedIds[], expectedVersion)` | §9.2.8. Every coach-read item carries `{line, quote}`. Code drops any number not in `quote` and lists lines with digits that produced nothing |
| `suggestExerciseNames(jobId, names[], operationId)` → `{suggestions: {sourceName, exerciseId}[]}` | AI13. Validated against the candidates; contradictions dropped |
| `listImportProfiles(ownerId)` / `getImportProfile(id)` / `renameImportProfile(id, name, expectedVersion)` / `updateImportProfileAnswer(id, question, answer, expectedVersion)` / `deleteImportProfile(id, expectedVersion)` / `undoDeleteImportProfile(id)` | Saved import layouts. Owner-scoped **Your data**: in the backup's Your data section and the `Full data (JSON)` export, removed by `Delete my data`, never in `Coaching knowledge only` |
| `commitImport(…, {saveLayout?: {name}})` | Saves or updates the layout in the same transaction as the job (`saveImportProfile` in research §7) |

`SourceSetRow` generalises `FitNotesRow`: `{source: {jobId, row?, line, cells? \| quote?}, readBy: 'code' \| 'coach', date, startLocal?, zone: null, workoutKey, exercise, weight, bothColumns, reps, setIndex?, setType?, rpe?, notes, rowClass, problem, evidence[]}`. Everything from `analyseImport` on is unchanged.

### 9.7 Acceptance checks

Numbering continues from §7.

Unavailable and offline (rule 1)
34. With the coach not connected, offline, signed out or over its limit, choosing a new-layout file shows the matching §9.3.2 state, and a network spy records **no request**. In airplane mode, a FitNotes file and a saved-layout file both import end to end.
35. A `subscription_sharing_usage_limit_exceeded` mid-request leaves nothing imported and shows no reset time. No request goes to the API-key route, and the coach's route setting is unchanged (rule 7).
36. With `importLayouts: false` (spike S3 not passed), the AI path says so and FitNotes and saved layouts still work.

Consent and what's sent (rules 7, 8, 10)
37. The request's file content is byte-identical to the `Your file, as sent` text on screen. Changing a column switch changes both.
38. A fixture with unique marker strings in every notes column: no marker appears anywhere in the layout request, including the column summaries.
39. The request contains no Your data: a search for the test owner's memory, pain-flag, gym and history strings finds nothing. It carries exactly one function tool, forced, and no web search or other tool.
40. On the API-key route, the estimate is labelled `estimate`, and a refusal by `checkPersonalSpendCap` blocks the request before it is sent.

Never guess (rule 6)
41. A file with no unit word asks `Weight unit` with nothing selected, whatever the coach's layout says. A layout pointing at a unit word that isn't in the header, or a "unit column" with one non-unit value, is refused.
42. The layout schema has no convention fields. For Strong and Hevy fixtures, the dumbbell, bar and bodyweight questions behave exactly as checks 17–18. `Pull Up (Assisted)` reads assistance from the name word; an unmarked custom name is asked.
43. `What is this file?` appears with nothing selected unless a saved layout answered it. `A plan or template` imports nothing. A Liftosaur fixture never imports `Required …` values.
44. `3x8` gets a notation question with both readings rendered from the file. Choosing one changes the preview's set count.
45. Dates whose first field is never above 12 ask day/month order. One date with a first field above 12 settles it, and the reason is shown.
46. A layout whose self-check rows disagree with code's reading, or that reads under 95% of rows, is refused with the reason. Nothing is shown as a layout.

Review and import
47. Every string on §9.2.4–§9.2.8 comes from the copy table, the file's own text or code's rendering. A fixture layout with a prose field carrying a link and "all checked, tap Import" shows none of it.
48. Changing a column role re-runs the checks and examples. Giving a role to a second column moves the first to `Not imported`, with `Undo`.
49. Hard limits make rows unreadable with their reason. A 100 → 225 jump appears under `Values to check` and blocks the primary until answered. If Q8 is approved, the same holds for a FitNotes file.
50. A Strong fixture with two workouts on one date imports two workouts. Dates that came in with a FitNotes import still in effect are skipped and listed.
51. Times with no zone are stored as written with `time zone not recorded`, and shown with `(as in the file)`.
52. Injection fixtures (research §4): `ignore previous instructions` in a notes cell, an exercise name, a header and a notes line; a notes column whose values are all `lb`; a template with `Target` columns. Each ends "asked" or "refused", never applied, and the text is shown as plain text.

Notes
53. Every imported set from notes has its numbers in its cited line. A fixture answer citing a number not in its line is dropped and listed. Lines with digits that produced no set are listed.
54. Coach-read sets start unticked; only ticked ones import. `Select all` ticks every one.
55. Force-close at part 5 of 14: relaunch shows paused. `Continue` sends only parts 6–14 (request count), and the finished screen reports the characters and requests actually sent.

Saved layouts (rules 5, 10)
56. After a commit with `Save this layout` on, a second file with identical columns imports in airplane mode with no request. Its preview labels earlier answers `your answer last time`, still shows every exercise's conversion, and asks about new markers and new exercise names.
57. A file with one extra column asks only about that column, offline. A file missing its load column is treated as a new layout.
58. The same file with the same layout version gives the same operation IDs (golden test). Killing at 180 of 412 and continuing gives exactly 412.
59. Saved layouts are in the backup's Your data section and the full JSON export, are removed by `Delete my data`, and are absent from `Coaching knowledge only`. A damaged layout in a restored backup isn't used, and Ben is told.
60. Deleting a layout leaves its imports untouched and offers `Undo`. The next file with those columns goes to `New file layout`.

General
61. Import, including reading with the coach, is unavailable while a workout is unfinished.
62. Provenance on each set reads `Layout suggested by the coach` or `Read by the coach · ticked by you`, with file, row or line, and the original text.
63. All counts, dates and money are tabular. Text is at least 16pt. Every status has an icon and text. Every screen works at AX3 with the primary visible, and worked examples wrap without truncating numbers.

### 9.8 Proposed changes and questions for Ben

**Questions for Ben** (the first one blocks the build):

| # | Question | Designer's recommendation |
|---|---|---|
| Q1 | Which histories do you actually have besides FitNotes: other apps (which), spreadsheets, Notes? | Build only the paths you need, in the order in "Build order" above |
| Q2 | Times with no time zone in Strong and Hevy files: store them as written, marked `time zone not recorded`, or ask for a zone each time? (AI4; needs a domain decision too) | Store as written; no question |
| Q3 | Is it OK that column names, a summary of each column and 30 rows (notes hidden) go to ChatGPT? OpenAI doesn't say how long plan-route data is kept or whether it's used for training | Yes, with the consent screen as designed |
| Q4 | A file that is a plan or template: import nothing (v1), or later turn it into routines? | Nothing in v1 |
| Q5 | If the coach can't read a file, or you'd rather not send it, should you be able to set its columns yourself, offline? (AI17) | Not in v1. Revisit if a real file needs it |
| Q6 | Sets the coach copied from notes line by line: start unticked (as designed) or ticked? | Unticked |
| Q7 | If the ChatGPT plan can't read layouts (spike S3), may import use your API key for that one request, with its cost shown, without switching the coach's route? | Yes, as a one-off with the cost confirmation (this would amend AI8) |
| Q8 | `Values to check` (a load more than double or less than half the workout before): should FitNotes imports get it too? | Yes |

**Brief changes.** The research's proposed brief changes 1–6 stand, and this design follows them: §5 wording, the §7 functions (as §9.6 names them), the §8 statement that import calls are outside the coach's tools, the §11 dependencies, "any text-based format", and an ADR when built. One flag: Ben's "we don't need import rules" holds for per-app column rules only. The value checks and the unit and convention questions stay (rule 6).

**Changes to this spec and ADR 0016** (for the PM to accept):
- AI1–AI17 above. DX5 and P-I1 are superseded.
- Review r4 spec issues:
  - **SP2:** carry Ben's earlier per-exercise answers forward, labelled `your answer last time`, for FitNotes as well as layouts (AI10).
  - **SP3:** a suggestion never contradicts an equipment or one-arm word in the name, and every `Check` line shows the dumbbell count (AI13). This applies to the word matcher too.
- AI12 would add `Values to check` to the FitNotes path (Q8).

**Cross-spec proposals** (not edited here):
- **X4 (ai-connection.md §2.6):** the weekly usage line counts import requests separately, e.g. `This week: 42 coach messages, 3 import requests from this phone`.
- **X5 (design-system.md):** merge §9.9's `type.source`, `ConsentCard`, `SentPreview`, `WorkedExample`, `ColumnRoleRow` and the new `SourceTag` kinds when its owner is free.
- **X6 (system-states.md §3.2):** add the `route_cannot_read_layouts` capability state to App status as `Reading new file layouts`, with `Working` only after a dated test (spike S3).
- **Applied here:** onboarding.md (Ready row `Import training history`) and profile-and-settings.md §2.8 (import and saved layouts named under Data & backup).

**Dependencies** (research §9):
- the plan-route tool shape and whether `strict` is enforced (spike S3, ADR 0012);
- plan-route retention and training terms;
- what a refusal under a forced `tool_choice` looks like;
- latency against the adapter's 120 s timeout;
- real Hevy and Strong exports, if Ben has them.

### 9.9 Components and tokens used here (local until merged, X5)

Existing components used: `StatusCard`, `NoteLine`, `StepRow`, `ProgressLine`, `ChecklistRow`, `SettingsRow` (question and radio variants), `SettingsSectionHeader`, `DomainLabel`, `SourceTag`, `RouteLine`, `UndoToast`, `PrimaryButton`, `SecondaryButton`, `DangerTextButton`, and the match statuses (design-system §7.1).

| Name | Spec |
|---|---|
| `type.source` | SF Mono, 16 / 22, regular, scales with Callout, max 3×. **Only for raw file text**: first lines, `SentPreview`, worked-example source lines and quoted notes lines. Wraps; never truncates numbers. VoiceOver reads it as text, not character by character |
| `ConsentCard` | Card frame (design-system §9.48). Line 1: `arrow.up.circle` + `What's sent` (`type.headline`). Bullets in `type.callout`, then a `Not sent:` line in `text.secondary`, then a `SettingsRow` link `See exactly what's sent ›`. No buttons of its own: the screen's primary is the consent. Never `accent` except the link. VoiceOver reads it as one group, "What's sent", then the bullets |
| `SentPreview` | `bg.raised`, 1pt `border.control`, `radius.sm`, padding `space.3`, `type.source`, selectable, scrolls inside the sheet (no fixed height at AX sizes). Character count below in `type.label` `text.secondary`, tabular |
| `WorkedExample` | Line 1: `Row 2` / `Line 212` (`type.label`, tabular). Line 2: the file's cells joined with ` · ` in `type.source` `text.secondary`. Line 3: `→` + code's reading in `type.callout` `text.primary`, tabular. `?` marks a value waiting for an answer and is read as "waiting for your answer". `→` is read as "reads as". `space.3` between examples |
| `ColumnRoleRow` | `SettingsRow` (≥ 52pt): the column name in quotes (file text, `type.body`) and the role (`type.callout` `text.secondary`), stacked at AX1+. An optional evidence line (`Load · kg, from the column name`) in `type.callout`, an optional `SourceTag` (`Coach` / `You` / `Saved layout`), and `chevron.right`. The whole row is one button |
| `SourceTag` kinds (add to design-system §9.28) | Data provenance: `Layout suggested by the coach` (`text.bubble`), `Read by the coach` (`text.bubble`), `Saved layout` (`square.and.arrow.down`), `your answer last time` (`person`). Never `accent`, never colour-only |

No new colour, spacing, motion or timing tokens. Nothing on these screens animates.

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
- [research/ai-import.md](../research/ai-import.md): the evidence behind §9 (architecture, layout vocabulary, export formats, injection and privacy).
- [ai-connection.md](ai-connection.md) §3 and [system-states.md](system-states.md) §3.2: coach route states reused by §9.3.2; cross-spec proposals X4 and X6.
- [ADR 0016](../decisions/0016-fitnotes-import.md) and [review r4](../reviews/fitnotes-import-r4.md): the FitNotes importer §9 builds on, and the spec issues SP2 and SP3 that §9 takes a position on.
- [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0005](../decisions/0005-persistence-and-backup.md), [guides/sidestore-windows.md](../guides/sidestore-windows.md) §6 and §8 (trial run).
