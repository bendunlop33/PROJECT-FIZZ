# Delete workouts

> **New, 11 Oct 2026.** Ben asked to "delete old records". Today a finished or imported workout can't be removed: Past workouts is read-only, Summary has no delete, and a finished workout refuses `delete_set` (reducer: "A finished workout accepts only corrections and timing edits"). This spec adds:
> - deleting one past workout (Summary, Past workout, Past workouts swipe, an imported workout);
> - deleting several at once (Select in Past workouts and in an import's workout list);
> - deleting one wrong set in a finished workout, with Undo;
> - **Recently deleted**: restore for 30 days, then purge.
>
> In-progress workouts keep `Discard workout` (active-workout.md). Whole imports keep `Undo this import` (data-import-export.md DX7). The coach and voice can't delete (DX10 extended).
>
> Items marked **For Ben** or **For the developer** are in §9.

Decisions:

| # | Decision | Why |
|---|---|---|
| DW-D1 | Deleting a workout is a **status change** (`finished` → `deleted`, audited, versioned). It isn't a row delete. Purge after 30 days is a separate step (§6.4). | Rule 2: completed sets are never silently changed, and an explicit delete must be reversible. ADR 0005 triggers forbid row deletes, and `reverted` already works this way (DX7). |
| DW-D2 | **One workout: no alert.** The tap on `Delete workout` is the confirmation. It lives behind a menu or swipe, never as a bare button, and it is followed by an Undo toast plus 30 days in Recently deleted. | iOS pattern (Mail, Photos): if a delete can be undone, it doesn't need an alert. Two deliberate taps are enough when the result is recoverable for 30 days. |
| DW-D3 | **Several workouts: one confirmation sheet** that names the count and the date range, then the same Undo toast. | A selection can include something Ben didn't mean to tick. The date range is how he spots that. |
| DW-D4 | **Deleted means gone from every derived view** (§5) the moment it's saved, and **back everywhere** on Restore. Nothing derived is stored, so nothing needs repair. | Progress spec §6: everything is recomputed from the history projection. |
| DW-D5 | **Completed sets in other workouts never change.** Deleting a workout can change future targets, records and Up next. It never rewrites another workout's actuals or a target that was already used. | Rule 2. |
| DW-D6 | **Pain flags, coach memories and conversations raised during a deleted workout are kept.** | Safety (rule 9). These records are managed in their own places. |

---

## 1. Purpose

| Surface | Question it answers | Single primary action |
|---|---|---|
| Delete one workout (Summary / Past workout `⋯`, swipe) | "This one shouldn't be in my history." | `Delete workout` |
| Select in Past workouts / an import's workouts | "Clear out these test or junk sessions." | `Delete (n)` |
| Delete set in a finished workout | "That set is wrong and can't be corrected; it didn't happen." | `Delete set` |
| Recently deleted | "Can I get that back?" | `Restore` |

---

## 2. Layout

### 2.1 Entry points

| Where | How | Notes |
|---|---|---|
| Summary (just finished, any time before `Done`) | Title-row `⋯` → `Delete workout` (destructive item, last in menu, separated) | Same menu as `Share / export` and `Reopen workout` |
| Past workout (history-mode summary, from Calendar / chart / record / Past workouts) | Nav-bar `⋯` → `Delete workout` | `Edit` stays the nav-bar text button. `⋯` sits beside it |
| Past workouts list (Today → `Past workouts`) | Swipe left on a row → `Delete` (no full-swipe). Or nav-bar `Select` | Swipe is never the only way. VoiceOver gets a `Delete` custom action |
| Imported workout (Data & backup → Past imports → an import → a date) | Nav-bar `⋯` → `Delete workout` | Past workouts doesn't list imported workouts yet (P-I3). See §9 DW-Q3 |
| An import's workout list | Nav-bar `Select` | For "a bad imported day" or a few rows. The whole file still uses `Undo this import` |
| Edit workout (finished) → a set → Edit set | `Delete set` (`DangerTextButton`, already built for the active workout) | Now allowed on finished workouts (§9 DW-Q1) |
| Recently deleted | Past workouts footer row (only when there is something to show) and Data & backup row | §2.5 |

Not entry points: Today, the active workout, the coach sheet and voice. In Calendar day lists, a long-press opens a context menu with `Delete workout`. It's a shortcut only; the Past workout `⋯` is the way to do it.

### 2.2 Summary / Past workout menu

```
┌────────────────────────────────────────┐
│ ‹ Calendar     Push A          Edit  ⋯ │
│ Thu 8 Oct · Main Gym · 18:02–19:04     │
│                      ┌───────────────┐ │
│                      │ Share / export│ │
│                      │ Reopen workout│ │ (summary, ≤ 30 min only)
│                      ├───────────────┤ │
│                      │ 🗑 Delete     │ │ status.danger text + trash icon
│                      │   workout     │ │
│                      └───────────────┘ │
│ …                                      │
```

Tap `Delete workout`. The workout is deleted, the screen pops (Past workout) or goes to Today (Summary, same as `Done`), and the destination shows the toast:

```
│ ┌────────────────────────────────────┐ │
│ │ 🗑 Push A · Thu 8 Oct deleted [Undo]│ │ UndoToast, timing.undoToast (8 s)
│ └────────────────────────────────────┘ │
```

### 2.3 Past workouts list

(Ben, 25 Oct) `＋ Log a past workout` sits at the top of the list (hidden while selecting); it opens [log-past-workout.md](log-past-workout.md) §3.

Normal (current screen; the lead text is trimmed per CLAUDE.md minimal copy):

```
┌────────────────────────────────────────┐
│ ‹ Today      Past workouts      Select │
│                                        │
│ Thu 8 Oct · Push A                   › │
│ Bench press, Incline DB press, …       │
│ Main Gym · 16 sets                     │
│ ────────────────────────────────────── │
│ Tue 6 Oct · Pull A                   › │
│ …                                      │
│                                        │
│ Recently deleted (3)                 › │ only when non-empty
└────────────────────────────────────────┘
```

Swipe left on a row:

```
│ Thu 8 Oct · Push A          │ Delete  │ status.danger fill, white label,
│ Bench press, Incline …      │   🗑    │ 74pt wide, full row height
```

Full-swipe is off: Ben has to tap `Delete`. A sweaty thumb scrolling the list must never delete.

Select mode (nav-bar `Select` → `Cancel`; title becomes the count):

```
┌────────────────────────────────────────┐
│ Select all     3 selected       Cancel │
│                                        │
│ ◉ Thu 8 Oct · Push A                   │ 44pt circle, accent when on
│   Main Gym · 16 sets                   │
│ ○ Tue 6 Oct · Pull A                   │
│ ◉ Mon 5 Oct · Test                     │
│ ◉ Mon 5 Oct · Empty workout            │
│ …                                      │
├────────────────────────────────────────┤
│                         Delete (3)     │ bottom toolbar, DangerTextButton,
└────────────────────────────────────────┘ disabled at 0
```

- Whole row toggles. A drag down the circles extends the selection (iOS multi-select gesture), and a tap on each row also works.
- `Select all` selects only what's loaded (the list pages). The label switches to `Deselect all`.
- Rows show date, title, gym, set count: the same fields as normal mode, so test sessions are recognisable (`0 sets`, `Empty workout`).

### 2.4 Confirm sheet (several)

An iOS action sheet anchored to the toolbar:

```
┌────────────────────────────────────────┐
│        Delete 3 workouts?              │
│        Mon 5 Oct – Thu 8 Oct           │ message: range (tabular)
│        1 imported                      │ only if any are imported
│ ────────────────────────────────────── │
│        Delete 3 workouts               │ destructive
├────────────────────────────────────────┤
│        Cancel                          │
└────────────────────────────────────────┘
```

When all the workouts are on one day, the message is that date alone (`Mon 5 Oct`). A range that spans years shows them (`28 Dec 2025 – 3 Jan 2026`). After the tap, select mode ends and the toast reads `3 workouts deleted` [Undo].

### 2.5 Recently deleted

Reached from the Past workouts footer row and from Data & backup → `Recently deleted (3) ›`. That row sits in the Your data group under the counts and is always present: with nothing deleted it reads `Recently deleted` with value `None` and isn't tappable.

```
┌────────────────────────────────────────┐
│ ‹ Back      Recently deleted    Select │
│                                        │
│ Thu 8 Oct · Push A                   › │
│ Main Gym · 16 sets                     │
│ Gone on 9 Nov                          │ text.secondary, actual date
│ ────────────────────────────────────── │
│ Thu 2 May 2024 · FitNotes            › │
│ 12 sets · Imported                     │
│ Gone on 10 Nov                         │
│                                        │
│ Gone 30 days after deleting. ⓘ        │ one footnote line, text.tertiary
└────────────────────────────────────────┘
```

- Sorted by deletion time, newest first. Each row shows the workout's own date (date-only for imports), title, gym and set count, and `Gone on <date>` (deleted + 30 days, local).
- Swipe left: `Restore` (accent fill). Tap a row: the read-only Past workout, with a sticky footer `[ Restore ]` (`PrimaryButton`) and no `Edit`, `⋯` or Repeat.
- Select mode toolbar: `Restore (n)` (accent text, leading) · `Delete now (n)` (`DangerTextButton`, trailing).
- `ⓘ` opens one line: `Older backups still hold them until they rotate out.`

### 2.6 Delete a set in a finished workout

Edit workout (workout-summary §4) → set row → Edit set. This is the existing sheet; `Delete set` is now enabled for finished workouts.

```
│ Edit set 2 · Bench press         ✕     │
│ Done at 18:21                          │
│ [−] 100 kg [+]   [−] 8 [+]             │
│ …                                      │
│ [          Save changes          ]     │
│                                        │
│ Delete set                             │ DangerTextButton, space.8 below
```

Alert: `Delete set 2?` / `100 kg × 8` [Cancel] [Delete]. Then toast `Set 2 deleted` [Undo]. Edit history lists `9 Oct 07:12 · Set 2 deleted: 100 kg × 8` with a trailing `Restore` text button, available until the workout itself is purged.

---

## 3. States

### 3.1 Past workouts / an import's workouts

| State | Shown |
|---|---|
| Normal | List, `Select`, swipe |
| Empty | `No finished workouts yet.` (existing). `Select` hidden. The Recently deleted row is still shown if non-empty |
| Select, none ticked | `Select all` · `Select workouts` (title) · `Cancel`. `Delete` disabled |
| Select, n ticked | `n selected`; `Delete (n)` enabled |
| Deleting | Local write, normally under 100 ms; no spinner. Rows animate out (fade, or none under Reduce Motion) |
| Stale | Any selected workout changed since the list loaded (edited, restored, reverted by an import undo). Nothing is deleted (all-or-nothing). StatusLine `ⓘ Changed since you selected. Check and try again.`; the list reloads and the selection keeps the IDs that still exist and are finished |
| Write failed | `⚠ Couldn't delete. Nothing was changed.` [Try again] (same op ID) |
| Workout in progress | Deleting past workouts is allowed. Today's active session has its own snapshot and isn't touched. Only the purge waits (§6.4) |
| Offline / AI unavailable | No difference. Everything here is local |

### 3.2 Summary / Past workout

| State | Behaviour |
|---|---|
| Normal | `⋯` includes `Delete workout` |
| Coach note still loading | Delete is allowed. The pending note is attached when it arrives, stays hidden with the workout and comes back on Restore |
| Coach next-time targets saved from this workout (D21) | They stop applying while the workout is deleted; `Next time` falls back to whatever the remaining history gives (coach target from an earlier workout or built-in rule). On Restore they apply again **only if** that routine hasn't been started since. Otherwise they stay as history |
| Applied proposal from this workout (template change) | **Not** undone by deleting: a template change is its own action with its own Undo (change-review.md). Deleting a workout never edits a routine |
| Opened while deleted (old link, notification, coach chip) | Read-only with banner `🗑 Deleted · gone on 9 Nov` and footer `[ Restore ]` |
| Opened after purge | `This workout was deleted.` and nothing else. No data shown |
| `Reopen workout` window | Not offered on a deleted workout. Restore first |

### 3.3 Recently deleted

| State | Shown |
|---|---|
| Normal | §2.5 |
| Empty (from Data & backup only) | `Nothing deleted in the last 30 days.` |
| Restore stale | The workout was purged or reverted meanwhile: `ⓘ No longer available.` and the row goes |
| Restoring | Instant; toast `Push A · Thu 8 Oct restored` [Undo] (deletes it again with the original 30-day clock reset to now) |
| Import undone | Workouts of an undone import leave this list: `reverted` takes precedence (§6.2) |
| Delete now | Alert `Delete 2 workouts now?` / `This can't be undone.` [Cancel] [Delete now]. Purge runs (§6.4); if it has to wait (a workout is in progress), rows go at once and are marked purge-due, so they can't be restored |

### 3.4 Transitions

```
            finished ──Delete (one tap / sheet)──► deleted ──30 days / Delete now──► purged
               ▲                                   │  │                           (tombstone only)
               └──────Undo toast / Restore─────────┘  │
                                                      └──Undo this import──► reverted
finished ──Undo this import──► reverted   (as today; leaves Recently deleted)
active ──Discard──► discarded            (unchanged; never in Recently deleted)

set: completed ──Delete set──► deleted ──Undo / Restore (edit history)──► completed
```

---

## 4. Interactions

| Element | Action |
|---|---|
| `⋯` → `Delete workout` | `deleteWorkouts({items: [{sessionId, expectedVersion}], opId})`. On success: pop / go to Today, toast with Undo. On stale: stay, reload, `ⓘ Changed since you opened it. Check and try again.` |
| Swipe → `Delete` | Same call for that row; the row animates out; toast |
| `Select` | Enters select mode; swipe actions are disabled while in it |
| `Delete (n)` | Opens the confirm sheet (§2.4). `Delete n workouts` → one `deleteWorkouts` call with all items (one transaction, all-or-nothing). Toast `n workouts deleted` [Undo] |
| Toast `Undo` | `restoreWorkouts` for exactly that op's items (the op's ID ties them together). After the toast, the same is possible from Recently deleted |
| Recently deleted `Restore` / swipe / `Restore (n)` | `restoreWorkouts({items: [{sessionId, expectedDeletionVersion}], opId})`. No confirm. Toast with Undo |
| `Delete now (n)` | Alert, then `purgeDeletedWorkouts({sessionIds, opId})` |
| `Delete set` | Existing alert, then `delete_set` (now accepted for `finished`). Toast [Undo] → `restore_set` |
| Edit history `Restore` | `restore_set` with the set's expected version. Stale: `ⓘ Changed since. Check and try again.` |
| VoiceOver | Rows expose custom actions `Delete` (Past workouts) / `Restore` (Recently deleted). Select-mode rows are toggle buttons ("Thu 8 Oct, Push A, selected"). The toast stays until dismissed (`timing.undoToast`) |
| Voice / coach | Not supported (DX10). "Delete that workout" is matched by the voice grammar and answered `Delete workouts from Past workouts.` (spoken and shown in the voice strip). The coach declines the same way and has no delete tool |
| Keyboard | None on these screens. Edit set keeps its `NumberAccessory`; `Delete set` is below the keypad area, never inside the accessory bar |

Undo paths, summarised:
1. Toast `Undo` (8 s; until dismissed with VoiceOver).
2. Recently deleted → `Restore`, for 30 days.
3. A restore of a backup taken before the delete brings the workout back only if Ben chooses so in the restore preview (§6.5).
4. Sets: toast `Undo`, then Edit history `Restore`.

---

## 5. What each derived view does

All of these read the one history projection (`toHistorySessions` and its siblings), which admits only `finished` sessions. `deleted` joins `discarded` and `reverted` as excluded. No view filters on its own. One predicate (`isInHistory(session)`) is used everywhere, and a test enumerates the readers.

| View | While deleted | On Restore |
|---|---|---|
| Today `Done today` | Gone if it was today's only workout; Today goes back to Up next | Back |
| Up next / D19 rotation (`services.next.preview`) | Computed from the latest **remaining** finished workout. Deleting the latest Push A makes Push A Up next again. An open pre-start draft (ADR 0022) is kept as it is | Recomputed |
| Session picker (other branch) / `Start from…` | Not listed | Listed |
| Repeat / Past workouts | Not listed. A Repeat screen already open on it shows `This workout was deleted.` and disables Start. An active workout already started from it is unaffected | Listed |
| Next-time targets (`calculateNextTargets`, coach D21 targets) | Built-in targets use the remaining history. Coach targets saved after this workout are suspended (§3.2). Targets already used in a later workout stay as they were (rule 2) | Recomputed; suspended coach targets come back if their routine hasn't been started since |
| "Last" values and comparisons (`getComparableHistory`) | Use the previous comparable session | Back |
| Progress: weekly consistency, sets per muscle, trends, chart points | Recomputed without it | Recomputed |
| Records and estimated 1RM | Recomputed. If the record was set in it, the next-best becomes the record; no "record removed" note | Recomputed |
| Week review card | A review that counted it shows `Out of date` (the existing correction state) | `Out of date` again (the review saw a different week); no auto-regeneration |
| Calendar | Glyph and day-list row gone | Back |
| Coach context (`buildCoachContext`), "What the coach can see" counts | Excluded. A conversation that attached it keeps its text; the attachment chip reads `Deleted workout`. An open coach proposal whose evidence includes it is rejected as stale on Apply (rule 5) | Included again; stale proposals stay stale |
| Coach memories, pain flags, check-in | Memories and pain flags stay (DW-D6). A memory's source line reads `From a deleted workout`. The check-in linked to it is hidden with it | Back as before |
| Exports (`My data` JSON, CSV, per-workout share) | Excluded, including Recently deleted | Included |
| Data & backup counts | `412 workouts` excludes it. A separate row `Recently deleted (3)` | Counted |
| Import counts (Past imports) | `412 workouts · 3 deleted` | `412 workouts` |
| Restore preview counts | Recently deleted shown on its own line (§6.5) | — |

---

## 6. Data, imports, backups

### 6.1 Records

- Session: status `deleted`, with `deletion = {at (UTC + tz), opId, purgeAfter}`. Version and storage revision bump (so a stale copy can't be saved over it). Audit events `session_deleted` / `session_restored`.
- Restore sets status back to `finished` and clears `deletion`; the audit keeps both events.
- Idempotent by op ID: retrying `deleteWorkouts` with the same op ID returns the same result. A second delete of an already-deleted session in a new op is refused as stale.

### 6.2 Imports

- A single imported workout is deleted exactly like any other. Its `import_rows` stay linked to it for provenance.
- `Undo this import` covers every workout in the import, including deleted ones. They become `reverted` and leave Recently deleted. The undo alert adds one line when it applies: `Includes 3 in Recently deleted.`
- Restoring a deleted imported workout whose import has since been undone isn't possible (it's not listed).
- The same file imported again while some of its workouts are in Recently deleted: those dates are treated as already in the app and aren't added again. The preview line reads `3 are in Recently deleted.` with `Recently deleted ›`. After purge they're no longer in the app, so a re-import offers them as new.
- Deleting every workout of an import one by one doesn't revert the import. The import still reads `0 workouts · 412 deleted`, and `Undo this import` stays available.

### 6.3 Your data

- Deleted workouts and tombstones are Your data (rule 10). `Delete my data` removes them with everything else. `Reset coaching knowledge` doesn't touch them.
- Export `My data` leaves out deleted workouts and tombstones. **For the developer:** the JSON export is a table dump today (ADR 0023); it needs the history predicate for sessions and their children.

### 6.4 Purge (30 days)

- A workout is **restorable until `deletion.at + 30 days`** (local end of that day). After that it is no longer listed or restorable, whatever happens to its bytes.
- The purge removes the session, its sets, set events, check-in, coach note, edit audit values and its `import_rows` values. What remains is a **tombstone**: session ID, owner, deleted-at, purged-at, source import job ID. It holds no training values. The tombstone stops a later restore from bringing the workout back (§6.5).
- When: on launch or return to foreground, at most once a day, never while a workout is unfinished, after that day's automatic backup check. It runs silently, with no banner.
- **For the developer / Ben (DW-Q2):** the append-only triggers (ADR 0005) forbid deleting these rows. Recommended: purge rebuilds the database file without the purge-due rows and switches to it, using the ADR 0023 Delete mechanism (stamp, integrity check, one switch, resumable marker). That keeps the triggers intact for every other write. The alternative is a migration with a narrow trigger exception for purge-due sessions.

### 6.5 Backups and restore

- Backups copy every table, so they **carry the deleted state** and the deletion date. A workout in Recently deleted is in the next backup as `deleted`, not as live history.
- Restoring a backup that holds a workout as `deleted`: it returns to Recently deleted with its **original** dates. If its 30 days are over, it is purge-due at once and never shown. A restore never resets the clock and never brings a deleted workout back to history.
- Restoring a backup **taken before** the delete (the workout is live in the file): the restore preview compares with the phone's deletions and tombstones and shows one line in the Your data section, `3 workouts you deleted since this backup` with a choice `Keep deleted` (default, selected) / `Bring back`. `Keep deleted` carries the phone's deletion records into the restored data: deleted ones go to Recently deleted with their original clock, and purged ones are purged again. If the phone's data can't be read (the usual reason to restore), there is nothing to compare, and the line doesn't appear.
- `Undo last restore` puts back the file as it was, deletions included.
- Older backups (on the phone and in Files) keep the full workout as `deleted` until they rotate out (DX9). Copies Ben saved himself are never edited. The `ⓘ` in Recently deleted says so in one line.
- Check a backup (`verifyBackup`) counts deleted workouts on their own line, not in the workout total.

---

## 7. Copy

| Element | Text |
|---|---|
| Menu item | `Delete workout` (trash icon, destructive) |
| Swipe action | `Delete` |
| Nav bar | `Select` · `Cancel` · `Select all` / `Deselect all` · title `Select workouts` / `3 selected` |
| Toolbar | `Delete (3)` |
| Confirm sheet | Title `Delete 3 workouts?` · message `Mon 5 Oct – Thu 8 Oct` (+ line `1 imported` when any) · `Delete 3 workouts` · `Cancel` |
| Toasts | `Push A · Thu 8 Oct deleted` [Undo] · `3 workouts deleted` [Undo] · `Push A · Thu 8 Oct restored` [Undo] · `2 workouts restored` [Undo] · `Set 2 deleted` [Undo] · `Set 2 restored` |
| Past workouts footer | `Recently deleted (3) ›` |
| Data & backup row | `Recently deleted` · value `3` / `None` |
| Recently deleted | Title `Recently deleted` · row line `Gone on 9 Nov` · footnote `Gone 30 days after deleting.` · `ⓘ` → `Older backups still hold them until they rotate out.` · empty `Nothing deleted in the last 30 days.` · swipe `Restore` · toolbar `Restore (2)` · `Delete now (2)` · footer button `Restore` |
| Delete now alert | `Delete 2 workouts now?` / `This can't be undone.` [Cancel] [Delete now] |
| Deleted workout opened | Banner `🗑 Deleted · gone on 9 Nov` · `Restore` · after purge `This workout was deleted.` |
| Delete set alert | `Delete set 2?` / `100 kg × 8` (actual) [Cancel] [Delete]. This replaces the current body text, which explains a rule |
| Edit history | `9 Oct 07:12 · Set 2 deleted: 100 kg × 8` · `Restore` |
| Errors | `Changed since you selected. Check and try again.` · `Changed since you opened it. Check and try again.` · `Couldn't delete. Nothing was changed.` · `No longer available.` |
| Import | Undo alert extra line `Includes 3 in Recently deleted.` · import counts `412 workouts · 3 deleted` · re-import preview `3 are in Recently deleted.` |
| Restore preview | `3 workouts you deleted since this backup` · `Keep deleted` · `Bring back` |
| Coach / memory | Chip `Deleted workout` · memory source `From a deleted workout` |
| Voice reply | `Delete workouts from Past workouts.` |

All loads shown in these lines are **actual results** (what was logged), never targets. Dates use the workout's own timezone; `Gone on` uses the phone's.

---

## 8. Data needed

New (for `packages/domain` / `packages/persistence`; names proposed):

| Function | Notes |
|---|---|
| `deleteWorkouts({ownerId, items: {sessionId, expectedVersion}[], opId, at})` | One transaction, all-or-nothing. Refuses `active`, `discarded`, `reverted`, already `deleted` (stale). Returns `{deleted: SessionRef[], undoToken}` |
| `restoreWorkouts({ownerId, items: {sessionId, expectedDeletionVersion}[], opId, at})` | Refuses purge-due or reverted (stale). Also used by the toast Undo |
| `listRecentlyDeleted(ownerId, now)` | Rows with date, title, gym, set count, imported flag, `restorableUntil`. Excludes purge-due |
| `buildDeleteConfirmView(selection)` (pure) | `{count, firstDate, lastDate, importedCount}` for the sheet. The UI never computes the range |
| `purgeDeletedWorkouts({ownerId, sessionIds?, opId, now})` | Purge-due ones by default; explicit IDs for `Delete now`. Resumable; §6.4 |
| `isInHistory(session)` (pure) | The one predicate every reader uses (§5) |
| Commands `delete_set` on `finished` sessions; `restore_set {setId, expectedSetVersion, opId}` | The reducer's finished-session allow-list gains both. Deleted sets are already excluded from summaries and exports |

Existing, now honouring `isInHistory`: `toHistorySessions`, `buildWorkoutSummary`, `getComparableHistory`, `calculateNextTargets`, `services.next.preview`, `repeat.candidates`, `getWeeklyTrainingSummary`, `summariseVolume`, records / e1RM, `getChartMarkers`, `buildCoachContext`, `getDecisionEvidence`, `revertImport`, `previewRestore`, `verifyBackup`, `getBackupStatus` counts, `deleteMyData`, the My data export, the session picker.

---

## 9. Open items

| ID | For | Item |
|---|---|---|
| DW-Q1 | Ben / developer | Allow `delete_set` on finished workouts, which the reducer refuses today. Recommended: yes. Correcting to 0 reps isn't the same as "didn't happen". Needs `restore_set` too (Edit set currently says "no Undo yet") |
| DW-Q2 | Developer (ADR) | How to purge under append-only triggers: file rebuild (recommended, ADR 0023 mechanism) or a narrow trigger exception. Either way needs an ADR, because ADR 0005 and DX7 say "never deletes rows" |
| DW-Q3 | Ben | Past workouts leaves imported workouts out (P-I3, because Repeat can't trust their loads). Proposal: list them with an `Imported` tag, open the imported view (not Repeat), and allow Select/Delete. Until then, imported days are deleted from the import's workout list |
| DW-Q4 | Ben | Restore preview default `Keep deleted` (§6.5). Recommended. The alternative is that a restore brings back whatever the file holds |
| DW-Q5 | Design-system owner | §9.2b says a `DangerTextButton` is "always followed by a confirmation". Amend: "…unless the action is listed in Recently deleted, in which case the Undo toast replaces the alert". Add `SelectionToolbar` (bottom bar in select mode: one leading action, one trailing; 44pt; `DangerTextButton` for destructive) and the `Deleted` banner variant of `StatusLine` |
| DW-Q6 | Brief | Brief §2 ("offer backup and deletion") covers Your-data deletion only. Add: "past workouts can be deleted one at a time or in bulk, restorable for 30 days". Ben approves; CHANGELOG entry by the PM |

---

## 10. Acceptance checks

**Entry and speed**
- **DW1.** From a Past workout, `⋯` → `Delete workout` deletes in two taps with no alert, and returns to the previous screen showing `Push A · Thu 8 Oct deleted` [Undo] for 8 s (until dismissed with VoiceOver on).
- **DW2.** The just-finished Summary's `⋯` offers `Delete workout`. Using it lands on Today, which shows Up next (not `Done today`), with the Undo toast.
- **DW3.** In Past workouts, swipe left shows `Delete`. A full-length swipe does **not** delete. VoiceOver exposes `Delete` as a custom action.
- **DW4.** `Select`, tick 3 workouts across two weeks, `Delete (3)`: the sheet reads `Delete 3 workouts?` with the correct first–last dates and `1 imported` when one is imported. `Cancel` changes nothing.
- **DW5.** An in-progress workout never shows `Delete workout`, isn't listed in Past workouts, and still uses `Discard workout`.

**Versioning and integrity (rules 2, 5)**
- **DW6.** Deleting changes only the session's status and deletion record. Every set row's values and versions are unchanged (compare before and after). The audit has `session_deleted` with the op ID.
- **DW7.** Retrying `deleteWorkouts` with the same op ID returns the same result and writes nothing new.
- **DW8.** Select 3, then correct a set in one of them from another screen, then confirm: nothing is deleted, `Changed since you selected…` shows, and the list reloads.
- **DW9.** Toast Undo restores exactly the workouts of that op, with the same IDs, values and versions + 1. A later delete's toast doesn't undo the earlier one.

**Derived views (§5)**
- **DW10.** Delete the workout holding the bench press record: Progress records and estimated 1RM show the next-best, labelled as an estimate. Restore: the original record returns.
- **DW11.** Delete the most recent Push A: Up next becomes Push A again (D19), the session picker and Repeat don't list it, and "Last" values on the next Push A come from the previous Push A.
- **DW12.** Built-in next-time targets after deleting equal the targets computed from a history that never had that workout (property test).
- **DW13.** A coach D21 target saved after the deleted workout isn't used while it's deleted. After Restore, it's used again only if Push A hasn't been started since.
- **DW14.** A target already used in a later workout stays the same after the earlier workout is deleted (rule 2).
- **DW15.** Weekly sets per muscle, consistency and chart points recompute. A week review that counted the workout shows `Out of date`.
- **DW16.** The coach context and "What the coach can see" counts leave it out. An open proposal citing it is rejected as stale on Apply.
- **DW17.** A pain flag set during the deleted workout is still active, and progression for that movement is still blocked.
- **DW18.** `My data` export (JSON and CSV) and a per-workout share leave out deleted workouts. Data & backup shows `412 workouts` and `Recently deleted 3` separately.
- **DW19.** A test lists every reader of sessions and fails if one doesn't go through `isInHistory`.

**Recently deleted and purge**
- **DW20.** A deleted workout appears in Recently deleted with `Gone on <deleted + 30 days>`. Restore (swipe, row footer or `Restore (n)`) puts it back everywhere in DW10–DW18.
- **DW21.** With the clock set to day 31, it's no longer listed or restorable, even before the purge has run. After the purge, opening an old link shows only `This workout was deleted.`, and the database holds only the tombstone (no load, reps or notes).
- **DW22.** The purge never runs while a workout is unfinished. A force-close during the purge resumes on launch without losing anything logged since.
- **DW23.** `Delete now` asks once (`This can't be undone.`), and the workouts can't be restored afterwards.

**Imports**
- **DW24.** One imported workout can be deleted from its imported view and from Select in the import's list. Restore puts it back with its `import_rows` provenance intact.
- **DW25.** `Undo this import` with 3 of its workouts in Recently deleted: the alert includes `Includes 3 in Recently deleted.`; afterwards all are `reverted`, and Recently deleted no longer lists them.
- **DW26.** Re-importing the same file while 3 of its workouts are in Recently deleted doesn't add those 3, and the preview says `3 are in Recently deleted.`.

**Backups and Your data**
- **DW27.** A backup made after a delete restores that workout to Recently deleted with its original deletion date, not to history. If its 30 days are over at restore time, it's never shown.
- **DW28.** Restoring a backup taken before the delete shows `3 workouts you deleted since this backup` with `Keep deleted` selected. Keeping it leaves them deleted (or purged). `Bring back` restores them to history.
- **DW29.** `Delete my data` removes deleted workouts and tombstones. `Reset coaching knowledge` leaves them untouched.

**Sets**
- **DW30.** In a finished workout, `Delete set` → `Delete` removes the set from totals, summary, Progress and export, with toast [Undo]. Edit history shows `Set 2 deleted: 100 kg × 8` with `Restore`, which brings it back with its original values.

**Accessibility and copy**
- **DW31.** Every control is at least 44pt. The selection circles, `Delete (n)` and `Restore` work at AX5 Dynamic Type, and dates and counts use tabular numerals. Deleted and restored states use text or an icon as well as colour.
- **DW32.** No screen in this flow explains rules in its main UI. The only explanation is behind `ⓘ` in Recently deleted.
- **DW33.** The coach and voice can't delete. "Delete that workout" gets `Delete workouts from Past workouts.` and nothing changes.
