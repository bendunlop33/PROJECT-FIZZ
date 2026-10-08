# Routines (list, detail, editor, duplicate, repeat last workout, start)

> **Revision 2026-10-08 (consolidation).** The routine source tag (`Coach` / `Ben` / `Imported`) is the canonical `SourceTag` (design-system §9.28); `RoutineRow`, `SetTemplateRow`, `ReorderRow` and `PlanSegmentControl` are merged into design-system (§9.35, §9.37 area); the row's `Start` is a `SecondaryButton` (§9.2a). Routines are **Your data**; a routine that uses an exercise missing from this phone's coaching knowledge (after a one-section restore) shows `Exercise missing` (data-import-export.md §2.3).

Status: v0.1 draft, 8 Oct 2026. Brief §1 (Routines and plan), §6 (`Routine` / `RoutineExercise`), §7 (`startWorkout`), §12 Page 2. Schemas: `packages/schemas/src/routine.ts` (`SetTemplate`, `RoutineExercise.restBySetType`, `restOverrideS`, `supersetGroup`, `transitionRestS`). Tokens: [design-system.md](design-system.md). Entry from [today.md](today.md). Coach-made routines: [workout-builder.md](workout-builder.md) (WB1, WB8, WB9).

Routines are **prepared once, outside the logging loop**. Nothing here runs between sets. The only routine action inside a workout is the session snapshot taken at Start.

## 1. Purpose

| Screen | Question it answers | Primary |
|---|---|---|
| **Routines list** (the `Routines` segment of the Plan hub) | "Which routine do I want to do, or change?" | None on screen. Each row has a secondary `Start`; row tap opens Detail. Today keeps the app's main `Start workout` |
| **Routine detail** | "What's in this routine, and will it work at this gym?" | `Start workout` |
| **Routine editor** | "Is this routine set up the way I train?" | `Save` |
| **Repeat last workout** | "Can I just do what I did last time?" | `Start workout` |

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| RT1 | **One "Plan" hub** pushed from Today, with a segmented control `Week` · `Routines`. Today's `Other routine` opens it on `Routines`; `Next: …` and `Reschedule` open it on `Week`. Exercise search sits in its nav bar. No fourth tab | Brief §1 keeps three tabs and opens "Routines and plan" from Today. One hub means one back gesture to Today and one place to look |
| RT2 | Each list row has a **secondary `Start` button** (not `PrimaryButton`), so Today → `Other routine` → `Start` is **2 taps**. If the routine has a problem at the selected gym, the row's `Start` opens Detail instead, where the problem is shown | Speed for the common case. Ben never starts a workout with an unseen problem |
| RT3 | Template loads default to **`Auto`** (`targetLoad: null`): next-session targets come from the coach's applied proposals or the built-in rule (ADR 0006). Ben can pin a **Fixed** load per set. Back-off sets can use **`% of top set`** | With coach-led progression a hard-coded template load goes stale after one session. Fixed stays available for Ben's own rules |
| RT4 | **"Repeat last workout"** turns the chosen finished session into a **pending** session with each done set's **actual** as the new **target**. Skipped and deleted sets aren't copied. Progression is not applied. Nothing is marked done | Brief §12: editable targets, never falsely completed sets. Ben asked for "what I did", not "what's next". `Start Push A instead` gives next-time targets |
| RT5 | **Source tags** on rows: `Coach` (made by the workout builder and not yet edited), `Ben` (made or edited by Ben), and later `Imported` (FitNotes, step 3). Editing a coach routine makes it `Ben` (WB8) | Ben asked to see who made each routine. Tag is text + icon, never colour |
| RT6 | Optional **`AMRAP (+)`** flag on a set template. A set with it never raises a coach offer for high effort | programmes.md: planned AMRAP sets are RPE 9–10 by design; ADR 0006 triggers should not fire on them. Needs a `SetTemplate.amrap` field (schema change) |
| RT7 | **`Counts as heavy legs`** routine setting: `Auto` (default), `Yes`, `No`. Auto is decided by `classifySessionLoad` (weekly-plan.md WP4) | The weekly plan's long-run warning needs a deterministic, overridable definition |
| RT8 | **Rest between sides** for unilateral exercises appears under Advanced as `Same as set rest` (default) / `Transition` / `None`, but is **disabled with `Coming later`** until the domain supports it | ADR 0003 follow-up 3 is open. Shown so the gap is visible, not invented |

## 2. Layout

### 2.1 Plan hub, Routines segment (list)

Regions top to bottom: nav bar (back, title, search, `⋯`) · segmented control · quick-start group · `In your plan this week` · `All routines` · `Coach drafts` row · Ask pill.

```
┌────────────────────────────────────────┐
│ ‹ Today          Plan          🔍   ⋯  │ nav bar; 🔍 = exercise library
│        [  Week  |✓Routines ]           │ segmented, 44pt
├────────────────────────────────────────┤
│ Start quickly                          │ type.label, text.secondary
│ ⟲ Repeat last workout                › │ row, 52pt
│   Push A · Tue 6 Oct · 18 sets         │
│ ＋ Empty workout                     › │
│ ✎ New routine  ·  💬 New with coach    │ two text buttons, 44pt+
│                                        │
│ In your plan this week                 │
│ ┌────────────────────────────────────┐ │
│ │ Legs A                [ Start ]    │ │ RoutineRow; Start = secondary
│ │ [👤 Ben] 6 exercises · about 60 min│ │
│ │ Planned Thu 15 · last done 8 Oct   │ │
│ ├────────────────────────────────────┤ │
│ │ Pull A                [ Start ]    │ │
│ │ [👤 Ben] 6 exercises · about 55 min│ │
│ │ ⚠ 1 exercise not at Hotel Gym      │ │ warning: Start opens Detail
│ └────────────────────────────────────┘ │
│                                        │
│ All routines                Sort: Recent│
│ ┌────────────────────────────────────┐ │
│ │ Push A                [ Start ]    │ │
│ │ [👤 Ben] 5 exercises · about 55 min│ │
│ │ Last done Tue 6 Oct                │ │
│ ├────────────────────────────────────┤ │
│ │ Push · 45 min         [ Start ]    │ │
│ │ [💬 Coach] 6 exercises · about 44 min│
│ │ Made 8 Oct                         │ │
│ └────────────────────────────────────┘ │
│ Coach drafts (2)                     › │ workout-builder WB9
│                             ( 💬 Ask ) │
└────────────────────────────────────────┘
```

Row rules (`RoutineRow`):
- Line 1: name (`type.headline`, two lines max) and a `Start` secondary button (`bg.raised`, 1pt `border.control`, `radius.md`, at least 44 × 88).
- Line 2: source tag (RT5), exercise count, `about N min` (`estimateRemainingDuration` at the **selected** gym; always "about").
- Line 3, one of, by priority: a gym problem (`⚠ 1 exercise not at Hotel Gym`), `1 suggested change ›` (open proposals for this routine), `Planned Thu 15 · last done 8 Oct`, `Last done Tue 6 Oct`, or `Not done yet`.
- At AX1+, `Start` moves under line 3, full width of the row.

### 2.2 Routine detail

```
┌────────────────────────────────────────┐
│ ‹ Plan          Push A        Edit  ⋯  │ ⋯: Duplicate, Version history,
├────────────────────────────────────────┤    Delete
│ Push A                                 │ type.title2
│ [👤 Ben] Chest · shoulders · triceps   │ focus derived from catalogue
│ 5 exercises · about 55 min at Main Gym │
│ Planned Mon, Thu · last done 6 Oct     │
│                                        │
│ 💬 1 suggested change for next time  › │ opens change-review (only if open)
│                                        │
│ All values are targets.                │
│ 1 Bench press · Barbell                │
│   2 warm-up + 1 top + 3 back-off       │
│   Top: Auto · 4–6 reps · RPE 8         │
│   Next: 100 kg (built-in rule)         │ what Start will prefill
│   Rest 3:00 top · 2:00 back-off        │
│ 2 Incline DB press · Dumbbells         │
│   3 × 8–10 · Next: 30 kg each          │
│ ┃ Superset A · 3 rounds                │
│ ┃ A1 Cable fly · Cable · 12–15         │
│ ┃   No history: start light, enter     │
│ ┃   your load.                         │
│ ┃ A2 Lateral raise · DB · 12–15        │
│ ┃ Rest 1:30 after each round           │
│ 4 Dead hang · 3 × 0:45                 │
├────────────────────────────────────────┤
│ [            Start workout           ] │ PrimaryButton
└────────────────────────────────────────┘
```

- `Next:` shows what `startWorkout` would prefill today: the coach target if a coach proposal was applied, otherwise the built-in rule's target, with its source in words (`coach` / `built-in rule` / `fixed`). These are **targets**.
- **Gym problems** (from `validateRoutineForGym`) appear as a `GuardNoteList` titled `At Hotel Gym (2)` above `All values are targets.`, for example `⚠ Cable fly: Hotel Gym has no cable station. Swap ›` and `ⓘ Incline DB press: Hotel Gym's dumbbells stop at 25 kg each. Targets will be capped.` `Start workout` is still allowed: the active workout shows the dropped or capped targets as it already does (active-workout §2.11).

### 2.3 Routine editor

Regions: nav bar (`Cancel`, title) · name field · summary line · `Exercises` header with `Reorder` · exercise cards · `+ Add exercise` · `Routine settings` (collapsed) · fixed action bar with `Save`.

```
┌────────────────────────────────────────┐
│ Cancel         Edit routine            │
├────────────────────────────────────────┤
│ Name                                   │
│ ┌────────────────────────────────────┐ │
│ │ Push A                             │ │
│ └────────────────────────────────────┘ │
│ 5 exercises · about 55 min at Main Gym │ updates live
│                                        │
│ Exercises                      Reorder │
│ ┌────────────────────────────────────┐ │
│ │ 1 Bench press · Barbell          ⋯ │ │ ⋯: Replace, Superset with next,
│ │ Set Type      Target       Rest    │ │    Notes, Remove
│ │ 1 W  Warm-up  60 kg × 5    1:00    │ │ SetTemplateRow (tap = edit)
│ │ 2 W  Warm-up  80 kg × 3    1:00    │ │
│ │ 3 T  Top      Auto × 4–6   3:00    │ │
│ │               RPE 8                │ │
│ │ 4 B  Back-off 90% × 6–8    2:30 ●  │ │ ● = this set's own rest
│ │ 5 B  Back-off 90% × 6–8    2:00    │ │
│ │ 6 B  Back-off 90% × 6–8    2:00    │ │
│ │ [+ Warm-up] [+ Working] [+ More ▾] │ │ 44pt buttons; More: Top,
│ │ Rest by set type                 › │ │ Back-off, Drop
│ │ Warm-up 1:00 · Top 3:00 ·          │ │
│ │ Back-off 2:00                      │ │
│ │ Advanced                         ▸ │ │ collapsed
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │┃ Superset A · 3 rounds          ⋯ │ │
│ │┃ A1 Cable fly · Cable              │ │
│ │┃  1–3  Working  Auto × 12–15      │ │ identical sets collapse to a range
│ │┃ A2 Lateral raise · Dumbbells      │ │
│ │┃  1–3  Working  Auto × 12–15      │ │
│ │┃ Between members 0:00 · after each │ │
│ │┃ round 1:30                     › │ │
│ └────────────────────────────────────┘ │
│ ＋ Add exercise                        │ opens exercise library (pick)
│ Routine settings                     ▸ │
├────────────────────────────────────────┤
│ [                Save                ] │ PrimaryButton, above keyboard
└────────────────────────────────────────┘
```

Row rules (`SetTemplateRow`, 52pt minimum):
- Set number, type badge (`W`/`T`/`B`/`D`, none for Working) and the type word, target, rest. Badges follow design-system §7.
- Target text: `60 kg × 5`, `Auto × 4–6`, `90% × 6–8` (back-off, % of the top set's target), `0:45` (timed), `Auto × 8–10 per side` (unilateral), `BW × 10`. Optional effort target on a second line: `RPE 8` or `RIR 2`. `AMRAP` adds `+` after the reps: `Auto × 5+`.
- Rest: the resolved value for that set. A set with its own override shows `●` and the word `own` to VoiceOver ("Rest 2 minutes 30, this set's own rest").
- Identical consecutive sets collapse to one row (`1–3`) with a `Show each set` toggle in the exercise `⋯`.

#### Set template sheet (tap a set row; medium detent)

```
┌────────────────────────────────────────┐
│ Set 4 · Bench press              Done  │
│ Type                                   │
│ [Warm-up][Working][Top][✓Back-off][Drop]│ ParamChips, wrap
│ Load                                   │
│ [ Auto ] [ Fixed ] [✓% of top set ]    │
│ [−]   90 %   [+]                       │ NumberStepper, 5% steps
│ About 90 kg at Main Gym (rounded down) │ from planTemplateLoad, a target
│ Reps                                   │
│ [ Range ✓ ] [ Exact ]                  │
│ [−] 6 [+]   to   [−] 8 [+]             │
│ [ ] AMRAP: last set as many as you can │ RT6
│ Effort target (optional)               │
│ [✓ None ] [ RPE ] [ RIR ]              │
│ Rest after this set                    │
│ (•) Back-off preset · 2:00             │ step 2 source
│ ( ) This set only [ 2:30 ▾ ]           │ restOverrideS (step 1)
│                                        │
│ Delete set                             │ danger text, separated
└────────────────────────────────────────┘
```

- Timed exercises replace `Reps` with `Work time [0:45 ▾]` and make Load optional (`None` for bodyweight holds).
- `% of top set` appears only on back-off sets of an exercise that has a top set. It maps to the exercise's top-set rule (`TopSetBackoffRule.backoff.percentOfTop`), so it's **per exercise**: changing it on one back-off set changes all of them, and the sheet says so (`Applies to all 3 back-off sets.`).
- `Fixed` load uses the `WorkoutKeypad` with feasible step keys from the routine's default gym. A value that gym can't make shows `Not on Main Gym's rack. At Start it rounds down to 27.5 kg each.` A value above the max shows `Main Gym's rack stops at 30 kg each. At Start this is capped.` Saving is allowed; the target is still snapped at Start (ADR 0003 B1).

#### Rest by set type sheet

```
│ Rest by set type · Bench press   Done  │
│ Warm-up   [Warm-up 1:00 ▾]             │ Ben's named presets + Custom
│ Top       [Heavy 3:00 ▾]               │
│ Back-off  [Custom 2:00 ▾]              │
│ Only set types used here are listed.   │
│ Not set here → Bench press default     │
│ (2:00) → your Standard preset (1:30).  │ resolution order, in words
```

Rows map to `RoutineExercise.restBySetType`. Choosing `Use default` clears the entry so resolution falls through (rest-state §4.2).

#### Advanced (per exercise, collapsed by default)

```
│ Advanced                             ▾ │
│ Equipment   Main Gym · Olympic bar   › │ equipmentId; `Any compatible`
│ Built-in rule  Top set + back-off    › │ progressionRuleId (offline
│               4–6 · +2.5 kg            │ fallback, ADR 0006)
│ Move to next exercise  [ 0:30 ▾ ]      │ transitionRestS
│ Rest between sides  Same as set rest   │ RT8: disabled, `Coming later`
│ Notes  Seat 4, pins at 9             › │
```

#### Routine settings (collapsed)

```
│ Routine settings                     ▾ │
│ Counts as heavy legs  [✓Auto][Yes][No] │ RT7
│ Auto: no (2 squat/hinge working sets)  │ classifySessionLoad result
│ Default gym  Main Gym                › │ used for estimates and checks
│ Source  [👤 Ben] · Based on a coach    │ WB8 provenance, read-only
│ workout, 8 Oct ›                       │
```

#### Reorder mode

`Reorder` switches the cards to one-line rows with a drag handle (`line.3.horizontal`) and `Move up` / `Move down` buttons (44pt) on each, so the gesture is never the only way. In this mode `Group` selects 2–4 adjacent rows to make a superset; `Ungroup` on a bracket splits it. `Done` leaves the mode.

### 2.4 Repeat last workout

Opened from the quick-start row. If several workouts finished in the last 14 days, the row shows the newest; `Choose another ›` lists the others.

```
┌────────────────────────────────────────┐
│ ‹ Plan     Repeat Tue 6 Oct            │
├────────────────────────────────────────┤
│ Push A · Main Gym · 16 sets            │
│ Targets are what you did on 6 Oct.     │ type.callout
│ Nothing is marked done. Progression    │
│ isn't applied.                         │
│ Start Push A instead (next targets) ›  │ link, only if it came from a routine
│                                        │
│ All values are targets.                │
│ Bench press · Barbell              ⋯   │ ⋯: Remove, Edit sets
│  W1 Target 60 kg × 5                   │
│  1  Target 100 kg × 8                  │ = 6 Oct actual, now a target
│  2  Target 100 kg × 7                  │
│  3  Target 97.5 kg × 8                 │
│ Incline DB press · Dumbbells       ⋯   │
│  1–3 Target 30 kg each × 9             │
│ Not copied: 2 skipped sets (Cable fly) │ text.secondary
├────────────────────────────────────────┤
│ Save as routine                        │ text button
│ [            Start workout           ] │ PrimaryButton
└────────────────────────────────────────┘
```

- Set rows tap → the same set template sheet (load is Fixed from the actual; Ben can change it).
- Different gym today: each load goes through the same start-time check. Rows show `Rounded down from 37.5 kg each: Hotel Gym's rack stops at 25 kg each.` or `No load target: the 6 Oct load was on a machine.` (convention mismatch, never converted).
- Rest after each set: the rest that set used on 6 Oct is **not** copied; the routine's presets (or the defaults) apply, with `Rest after` shown per exercise.

## 3. States

### 3.1 Routines list

| State | Shows | Notes |
|---|---|---|
| Loading | Nothing for 300 ms, then static grey rows (no shimmer) | Local read; normally < 100 ms |
| Empty (no routines, no history) | `No routines yet.` + text buttons `New routine` · `New with coach` · `Empty workout`. Quick-start shows only `Empty workout` | `Repeat last workout` is hidden until one workout is finished |
| Empty, with history | As above, plus `Repeat last workout` | Common straight after a FitNotes import |
| Normal | §2.1 | — |
| Workout in progress | Banner `Push A is in progress.` [Resume]. Row `Start` buttons hidden; quick-start hidden | One session at a time (WB10). Editing still works (§4.5) |
| Gym problem on a row | Line 3 `⚠ 1 exercise not at Hotel Gym`; `Start` opens Detail | RT2 |
| Suggested change waiting | Line 3 `1 suggested change ›` | Opens change-review.md |
| Offline / coach unavailable | No change, except `New with coach` shows `Coach offline` beneath it and opens the builder's offline frame | Routines are local (rule 1) |
| Database error | `Couldn't open your training data.` [Try again] [Restore from backup] | Same as Today |

### 3.2 Routine detail

| State | Primary | Notes |
|---|---|---|
| Normal | `Start workout` | — |
| Gym problems | `Start workout` | Notes above the list; never blocks |
| Workout in progress (this routine) | `Resume Push A` | — |
| Workout in progress (another) | Disabled `Start workout`, caption `Finish or discard Pull A to start this.` | — |
| No gym selected | `Start workout` | `No gym selected. Loads won't be checked against equipment.` [Add gym] |
| Routine deleted (opened from an old link) | none | `This routine was deleted.` + `Restore` if within the Undo period, else nothing |

### 3.3 Editor

| State | Shows | Primary |
|---|---|---|
| New | Name empty and focused; `Add your first exercise` card with `＋ Add exercise` | Disabled `Add a name` → then disabled `Add an exercise` → `Save` |
| Editing, clean | §2.3 | `Save` (disabled, label `No changes`) |
| Dirty | `Save` enabled | `Save` |
| Coach routine, first edit | Inline note under the name: `Saving your edits makes this your routine. The coach's version stays in its history.` | `Save` |
| Routine in progress today | Inline note: `Push A is in progress. Edits apply from your next workout. Today's workout doesn't change.` | `Save` |
| Validation issue | Inline on the row (e.g. `Reps: the first number must be the smaller one.`). The first invalid field scrolls into view | Disabled `Fix 1 issue` |
| Superset mismatch | Bracket note `A1 has 4 sets, A2 has 3. Round 4 is A1 only.` | `Save` (allowed) |
| Save conflict | Sheet `Push A changed while you were editing` listing the other change (e.g. `Coach target applied for Bench press, 18:40`), with `Keep both` (default; re-applies Ben's edits on the new version when they don't touch the same fields) and `Discard my edits`. When the same field changed, both values show and Ben picks one per field | Rule 5: never overwrite a newer version silently |
| Save failed | `Couldn't save Push A. Your edits are still here.` [Try again] (same opId) | `Save` |

### 3.4 Repeat last workout

| State | Shows |
|---|---|
| Normal | §2.4 |
| Last workout was empty or all skipped | Row hidden; `Choose another ›` still lists older ones |
| Different gym | Per-row check notes; header line `Done at Main Gym. Checked for Hotel Gym.` |
| Workout in progress | `Start workout` disabled with `Finish or discard Pull A to start this.`; `Save as routine` works |

### 3.5 Transitions

```
 Today ─Other routine─► Plan/Routines ─row Start (no problem)──► Active workout
                          │  │  └─row tap──► Detail ─Start workout──► Active workout
                          │  │                 │ Edit
                          │  └─New routine──► Editor ─Save──► Detail (toast + Undo)
                          │                      └─Cancel (dirty → confirm)──► back
                          └─Repeat last workout──► Repeat ─Start──► Active workout
                                                         └─Save as routine──► Editor (prefilled)
```

## 4. Interactions

### 4.1 List
| Element | Tap | Other |
|---|---|---|
| Row | Opens Detail | Long-press (and the row's `⋯` at AX sizes) → `Edit`, `Duplicate`, `Delete`. No swipe-only actions |
| `Start` | `startWorkout(routineId, gymId, opId)`, then Active workout. Disabled 1 s after the tap (`timing.commitGuard`); the opId prevents a second session | With a gym problem: opens Detail (RT2) |
| `Repeat last workout` | Opens §2.4 for the newest finished session | — |
| `Empty workout` | `startWorkout(null, gymId, opId)` → empty state (active-workout §2.10) | — |
| `New routine` | Editor, new | — |
| `New with coach` | Builder's Build sheet (workout-builder §3.1) | — |
| `Sort` | `Recent` (last done, default) · `A–Z` · `Planned first`. Remembered | — |
| `Coach drafts (2)` | Drafts list (workout-builder WB9) | — |
| 🔍 | Exercise library, browse mode ([exercise-library.md](exercise-library.md)) | — |

### 4.2 Detail
- `Start workout` as the list's `Start`. Exercise row tap opens the exercise's history sheet (same as Active workout).
- `Swap ›` on a gym note opens the substitution list ([exercise-library.md](exercise-library.md) §2.5) with scope choices `Today only` (a session-level swap made at Start) or `Change Push A`. The second edits the routine through the editor's normal Save (Ben's own edit; no change-review card).
- `Edit` opens the editor. `⋯` → `Duplicate`, `Version history`, `Delete routine`.

### 4.3 Editor
- **Name:** system keyboard. Return moves focus off the field.
- **Numbers** (loads, reps, %, durations): `WorkoutKeypad` with feasible step keys from the default gym. `Save` is the action bar above the keypad, so the primary is always visible (design-system §9.1). `Next ›` walks load → reps → effort.
- **Add set:** `[+ Warm-up]` and `[+ Working]` copy the last set of that type (or sensible empty targets: `Auto × 8–10`). `[+ More ▾]` offers `Top set`, `Back-off`, `Drop set`. New sets take their type's rest preset.
- **Delete set:** in the set sheet; no confirm (Cancel discards everything until Save). An exercise must keep at least one set; deleting the last one asks `Remove Bench press from Push A?`.
- **Replace exercise** (`⋯`): opens substitutions in editor mode. The new exercise keeps the set types, reps, effort and rest. Loads reset to `Auto` with `Loads reset: DB bench press is in kg each.` (never converted).
- **Superset with next** (`⋯`): makes a superset of this exercise and the next one (label `A`, `B`, … assigned in order). Rest: `Between members` (`transitionRestS`, default 0:00) and `After each round` (the last member's set rest). Max 4 members.
- **Cancel:** with no changes, closes. Dirty: `Discard changes to Push A?` [Discard] [Keep editing].
- **Save:** `updateRoutine(routineId, patch, expectedVersion)` (or `createRoutine`). Toast `✓ Saved Push A` [Undo]. Undo calls `revertRoutine(routineId, previousVersion, expectedVersion)`.
- **Voice:** none in the editor (it's a sit-down task). The coach sheet can be asked "add face pulls to Push A"; that comes back as a change-review card (future template), never as a silent edit.

### 4.4 Duplicate
`⋯` → `Duplicate` calls `duplicateRoutine(routineId, opId)`, which creates `Push A copy` (source `Ben`, provenance `Copied from Push A`) and opens it in the editor with the name selected. Undo: delete the copy.

### 4.5 Start from a routine (session snapshot)
- `startWorkout(routineId, gymId, opId)` copies the routine's current version into the session (`session.source = {kind: 'routine', routineId, routineVersion}`). Targets are planned at Start: coach-applied targets, else built-in rule targets, else Fixed loads; all snapped to the gym's achievable loads (ADR 0003 B1).
- Editing the routine later never changes a session that already started. The editor says so when that routine is in progress (§3.3).
- Open coach proposals for the routine's next session expire when it starts (coach-adjustments §4.6). Today and the list stop showing them.

### 4.6 Repeat last workout
- Rows can be removed (`⋯` → `Remove`) or edited (set sheet). Nothing is saved until `Start workout` or `Save as routine`.
- `Start workout` calls `startWorkoutFromSession(sourceSessionId, edits, gymId, opId)`: a new session whose sets are all **pending**, with `session.source = {kind: 'repeat', sessionId}`.
- `Save as routine` opens the editor prefilled; loads stay Fixed from the actuals until Ben changes them to `Auto`.

### 4.7 Delete
`Delete routine` confirms: `Delete Push A? It's planned on 2 upcoming days. Those days will be cleared. Past workouts keep their records.` (without plans: `Delete Push A? Past workouts keep their records.`) [Delete] [Cancel]. Then toast `Push A deleted` [Undo] (`timing.undoToast`), which restores the routine and its scheduled days. The routine is a tombstone, so finished sessions keep their snapshot and provenance.

### 4.8 Undo paths
| What | Undo |
|---|---|
| Saved edit | Toast [Undo], or `Version history` → pick a version → `Restore this version` (creates a new version; nothing is deleted) |
| Duplicate | Delete the copy |
| Delete | Toast [Undo]; after that, not available (confirmed first) |
| Started by mistake | Active workout `⋯` → `Discard workout` (0 sets: immediate) |
| Repeat: started by mistake | Same; the source session is untouched |

## 5. Copy

All template numbers are **targets**. `Last …` and `Done …` are **actuals**.

| Element | Text |
|---|---|
| Hub | Title `Plan` · segments `Week` · `Routines` |
| Quick start | `Start quickly` · `Repeat last workout` + `Push A · Tue 6 Oct · 18 sets` · `Empty workout` · `New routine` · `New with coach` |
| Sections | `In your plan this week` · `All routines` · `Coach drafts (2)` · `Sort: Recent` / `A–Z` / `Planned first` |
| Row | `6 exercises · about 60 min` · `Planned Thu 15 · last done 8 Oct` · `Last done Tue 6 Oct` · `Not done yet` · `Made 8 Oct` · `⚠ 1 exercise not at Hotel Gym` · `1 suggested change ›` · button `Start` |
| Source tags | `Coach` (`text.bubble` icon) · `Ben` (`person` icon) · `Imported` (`square.and.arrow.down`, step 3) |
| In progress | `Push A is in progress.` [Resume] · `Finish or discard Pull A to start this.` |
| Detail | `All values are targets.` · `Next: 100 kg (built-in rule)` / `Next: 97.5 kg (coach)` / `Next: 60 kg (fixed)` · `No history: start light, enter your load.` · `Rest 3:00 top · 2:00 back-off` · `Rest 1:30 after each round` |
| Detail, gym notes | `At Hotel Gym (2)` · `Cable fly: Hotel Gym has no cable station. Swap ›` · `Incline DB press: Hotel Gym's dumbbells stop at 25 kg each. Targets will be capped.` |
| Primary | `Start workout` · `Resume Push A` · `Save` · `No changes` · `Add a name` · `Add an exercise` · `Fix 1 issue` |
| Editor | `Name` · `Exercises` · `Reorder` / `Done` · `Group` / `Ungroup` · `+ Warm-up` · `+ Working` · `+ More` (`Top set`, `Back-off`, `Drop set`) · `Rest by set type` · `Advanced` · `Routine settings` · `Add exercise` |
| Set sheet | `Type` · `Load` (`Auto`, `Fixed`, `% of top set`) · `About 90 kg at Main Gym (rounded down)` · `Reps` (`Range`, `Exact`) · `AMRAP: last set as many as you can` · `Effort target (optional)` (`None`, `RPE`, `RIR`) · `Rest after this set` · `Back-off preset · 2:00` · `This set only` · `Work time` · `Applies to all 3 back-off sets.` · `Delete set` |
| Auto explained (info button next to `Auto`) | `Auto: the coach's applied target, or the built-in rule's, worked out when you start.` |
| Load warnings | `Not on Main Gym's rack. At Start it rounds down to 27.5 kg each.` · `Main Gym's rack stops at 30 kg each. At Start this is capped.` · `Loads reset: DB bench press is in kg each.` |
| Rest sheet | `Rest by set type · Bench press` · `Only set types used here are listed.` · `Not set here → Bench press default (2:00) → your Standard preset (1:30).` · `Use default` |
| Advanced | `Equipment` (`Any compatible`) · `Built-in rule` · `Move to next exercise` · `Rest between sides` + `Coming later` · `Notes` |
| Superset | `Superset A · 3 rounds` · `Between members` · `After each round` · `A1 has 4 sets, A2 has 3. Round 4 is A1 only.` |
| Routine settings | `Counts as heavy legs` (`Auto`, `Yes`, `No`) · `Auto: no (2 squat/hinge working sets)` · `Default gym` · `Source` |
| Notes in editor | `Saving your edits makes this your routine. The coach's version stays in its history.` · `Push A is in progress. Edits apply from your next workout. Today's workout doesn't change.` |
| Validation | `Reps: the first number must be the smaller one.` · `Add at least one set.` |
| Dialogs | `Discard changes to Push A?` [Discard] [Keep editing] · `Remove Bench press from Push A?` [Remove] [Cancel] · `Delete Push A? It's planned on 2 upcoming days. Those days will be cleared. Past workouts keep their records.` [Delete] [Cancel] |
| Conflict | `Push A changed while you were editing` · `Coach target applied for Bench press, 18:40` · `Keep both` · `Discard my edits` |
| Toasts | `✓ Saved Push A` [Undo] · `Push A deleted` [Undo] · `✓ Restored version 4` |
| Repeat | `Repeat Tue 6 Oct` · `Targets are what you did on 6 Oct.` · `Nothing is marked done. Progression isn't applied.` · `Start Push A instead (next targets) ›` · `Not copied: 2 skipped sets (Cable fly)` · `Done at Main Gym. Checked for Hotel Gym.` · `Choose another ›` · `Save as routine` |
| Errors | `Couldn't open your training data.` [Try again] [Restore from backup] · `Couldn't save Push A. Your edits are still here.` [Try again] |

Spoken: none on these screens. A workout started here uses Active workout's cues.

## 6. Data needed

Existing (brief §4, §7; schemas; other specs):
- `startWorkout(routineId?, gymId, operationId)`, `getActiveSession(userId)`.
- `estimateRemainingDuration(session, assumptions)` run on the routine as a not-yet-started session (as workout-builder WB5).
- `resolveRestPreset` (rest-state §4.2) and the Profile rest presets (`RestSetting` with `presetName`).
- `getAchievableLoads(equipmentId)`, `roundToAvailableLoad(target, equipmentId, 'down')`, `planTemplateLoad` (ADR 0003 B1).
- `calculateNextTargets(history, rule, equipment)` for `Next:` lines; `getComparableHistory` for `Last` and history sheets.
- `rankSubstitutions(exerciseId, gymId, intent)` for Replace and Swap.
- `updateRoutine(routineId, patch, expectedVersion)`, `saveRoutineFromProposal`, `listWorkoutDrafts` (workout-builder §7).
- `getAiCapabilities(userId)` for `New with coach`.

**Proposed new (flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `buildRoutineListView(ownerId, gymId, localDate)` | Rows `{routineId, name, exerciseCount, estimateMin, source, lastDoneDate, plannedDays[], gymIssueCount, openProposalCount}`, `quickStart.lastSession`, `draftsCount`, `activeSession`. Local only |
| `buildRoutineDetailView(routineId, gymId)` | Exercises with set summaries, `next` targets with source (`coach` / `rule` / `fixed` / `none`), gym notes, plan days, open proposals |
| `validateRoutineForGym(routineVersion, gymId, equipmentVersion)` | **Pure, `packages/domain`.** Returns notes: `incompatible_exercise`, `capped`, `rounded`, `convention_mismatch`, `no_achievable_loads`. Same note kinds and wording as `validateGeneratedWorkout` where they overlap |
| `createRoutine(draft, opId)` / `duplicateRoutine(routineId, opId)` | New routine, source `ben`, provenance on duplicate |
| `deleteRoutine(routineId, expectedVersion)` / `restoreRoutine(routineId)` | Tombstone; clears and restores linked scheduled sessions in one transaction |
| `listRoutineVersions(routineId)` / `revertRoutine(routineId, toVersion, expectedVersion)` | Version history; revert creates a new version |
| `buildRepeatSessionDraft(sessionId, gymId)` | Done sets → pending targets (actuals become targets), skipped/deleted excluded, start-time load check notes |
| `startWorkoutFromSession(sourceSessionId, edits, gymId, opId)` | Snapshot like `startWorkout`; `session.source = {kind: 'repeat', sessionId}`; no set is created done |
| `classifySessionLoad(routineVersion)` | **Pure.** Returns `{heavyLegs: boolean, reason}` from catalogue movement patterns and set templates, unless the routine overrides it (RT7). Shared with weekly-plan.md |
| Schema: `SetTemplate.amrap: boolean` (RT6), `Routine.source`, `Routine.defaultGymId`, `Routine.heavyLegsOverride: 'auto' \| 'yes' \| 'no'` (RT7), `Routine.deletedAtUtc` | Not in `routine.ts` yet |

## 7. Acceptance checks

1. From Today, `Other routine` → a row's `Start` reaches Active workout in **2 taps**. Double-tapping `Start` creates one session.
2. A routine with a gym problem at the selected gym shows the `⚠` line, and its row `Start` opens Detail with the note visible instead of starting.
3. Every number on Detail, the editor and Repeat is labelled as a target (`All values are targets.`, `Target …`, `Next: …`). `Last …` values are actuals with a date.
4. `Next:` on Detail equals the first set's prefilled target after `Start workout` (same value, unit and convention) for a coach-applied, a built-in-rule and a Fixed target.
5. Edit Push A while a Push A workout is in progress: the note shows, Save works, and the running workout's sets and targets don't change. The next Push A uses the new version.
6. A back-off set with `90% of top set` and a top target of 100 kg shows `About 90 kg at Main Gym (rounded down)`; on a bar with 2.5 kg steps, a top target of 102.5 kg shows `About 90 kg` (92.25 rounded down), never an unachievable load.
7. A Fixed load of 37.5 kg each on a 30 kg rack saves with the capped warning; at Start the target is 30 kg each.
8. Rest: with presets Warm-up 1:00 and Top 3:00 and a set override of 2:30 on set 4, `resolveRestPreset` returns 1:00 / 3:00 / 2:30 with sources `routine_set_type` / `routine_set_type` / `set_override`, matching the editor.
9. A superset of A1 and A2 with `After each round 1:30` and `Between members 0:00` starts no rest after A1 and 1:30 after A2 in the workout.
10. A timed exercise's sets show `0:45` and the sheet shows `Work time`, never `Reps`.
11. A unilateral exercise shows `per side`; `Rest between sides` is visible but disabled with `Coming later`.
12. `Replace exercise` from barbell to dumbbells resets loads to `Auto` with the reset note; no converted number appears.
13. `Repeat last workout` creates a session in which **no** set is done; targets equal the source session's actuals; skipped sets are listed as not copied; at another gym, loads are rounded down or dropped with notes.
14. Editing a `Coach` routine and saving changes its tag to `Ben` and keeps `Based on a coach workout, 8 Oct ›`.
15. A save conflict (coach target applied while editing) shows the conflict sheet; nothing is overwritten without Ben choosing.
16. `Delete routine` confirms with the planned-day count; Undo within 8 s restores the routine and its planned days; a finished session from that routine still opens with its original exercises.
17. With airplane mode on and no AI, the list, Detail, editor, Repeat and Start all work; only `New with coach` shows `Coach offline`.
18. With the keypad open on any number field in the editor, `Save` is fully visible at 375pt width at default size and at AX3.
19. Every gesture has a button equivalent: Reorder has `Move up` / `Move down`; long-press actions are also in `⋯`.
20. All text is at least 16pt, numbers are tabular, and tags, warnings and set types carry text or icons as well as colour, in dark and light modes.

## Proposed design-system additions

No new colours or timing tokens.

| Component | Spec |
|---|---|
| `RoutineRow` | `bg.surface` row in a grouped list, padding `space.3`, min 76pt. Line 1 `type.headline` + secondary `Start` button (`bg.raised`, 1pt `border.control`, `radius.md`, ≥ 44 × 88, label `type.headline`, `accent` text). Line 2 `TargetSourceTag`-style source tag + `type.callout` `text.secondary`. Line 3 status (`type.callout`; `⚠` uses `status.warning` icon + text). At AX1+ `Start` goes full width under line 3. VoiceOver: "Push A, by Ben, 5 exercises, about 55 minutes, last done 6 October. Start button." |
| Source tag `Ben` | Same frame as `TargetSourceTag` (§7) with the `person` icon. `Imported` uses `square.and.arrow.down`. Never `accent` |
| `SetTemplateRow` | 52pt min, columns: set number + type badge, type word, target (`type.callout`, tabular), rest (tabular). `●` + VoiceOver "own rest" for set overrides. Stacks at AX1+: line 1 number/type, line 2 target, line 3 rest |
| `PlanSegmentControl` | System segmented control, 44pt, labels `Week` / `Routines` (`type.label`) |
| `ReorderRow` | One-line row with drag handle and `Move up` / `Move down` buttons (44 × 44 each, `chevron.up` / `chevron.down`) |

## Cross-links

- [today.md](today.md): `Other routine`, `Empty workout`, `Next: …`, `Reschedule` entry points (RT1)
- [weekly-plan.md](weekly-plan.md): the `Week` segment of the same hub; `classifySessionLoad` for heavy-legs warnings
- [exercise-library.md](exercise-library.md): `Add exercise`, `Replace`, `Swap ›` and the 🔍 browse entry
- [change-review.md](change-review.md): `1 suggested change ›`, coach-proposed template edits
- [workout-builder.md](workout-builder.md): `New with coach`, coach drafts, `Save as routine`, WB8 source rules
- [active-workout.md](active-workout.md): what Start leads to; §2.11 dropped targets; §2.6 supersets; §2.7 timed; §2.9 unilateral
- [rest-state.md](rest-state.md) §4.2: rest resolution order used by the editor
- [coach-adjustments.md](coach-adjustments.md) §4.6: next-time proposals that change `Next:`
- `docs/training-guides/programmes.md`: AMRAP note behind RT6
