# Routines (list, detail, editor, duplicate, repeat last workout, start)

> **Revision 2026-10-08 (consolidation).** The routine source tag (`Coach` / `Ben` / `Imported`) is the canonical `SourceTag` (design-system §9.28); `RoutineRow`, `SetTemplateRow`, `ReorderRow` and `PlanSegmentControl` are merged into design-system (§9.35, §9.37 area); the row's `Start` is a `SecondaryButton` (§9.2a). Routines are **Your data**; a routine that uses an exercise missing from this phone's coaching knowledge (after a one-section restore) shows `Exercise missing` (data-import-export.md §2.3).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** A routine row's `Start`, `Empty workout` and `Repeat last workout` → `Start workout` go through the same check-in gate as Today ([check-in.md](check-in.md) §2.1): with a check-in due, the `CheckInSheet` appears before the session is created, and `startWorkout` / `startWorkoutFromSession` take `opts.checkIn`. With check-ins off or not due, nothing changes.

> **Revision 2026-10-09 (gym switch and re-snap, competitor follow-up 6; closes review B1 by design).** Repeat, routine Start and the routine detail's gym notes now fit every load with **`snapPlanToGym`**. That is the same pure function as the mid-workout gym switch ([gym-switch.md](gym-switch.md) GS1, §6), so Repeat can't drift from the switch again: B1 happened because Repeat had its own path.
> - Repeat's preview gets a `GymChip` (`Checked for [Hotel · Lisbon ▾]`) that re-checks the preview without starting (GS10).
> - A row whose equipment isn't here gets `Swap ›` (Ben's own swap, draft only).
> - Notes use the shared wording.
> - Each set stores what Repeat planned (`planned.snap`, with last time's actual as the intended target), so a later switch back restores it.
> - `startWorkout` also maps equipment with the shared rules. Today, a routine pinned to an item the selected gym lacks keeps its Fixed load unchecked: the same rule-4 gap as B1, not yet reachable because routines aren't wired.
>
> Changed: §2.2, §2.4, §3.4, §4.5, §4.6, §5, §6, checks 13 and 21–25.

> **Revision 2026-10-09 evening (Ben's decisions D19 and D21).**
> - **Rotation (D19; [weekly-plan.md](weekly-plan.md) WP14).** Routines aren't placed on weekdays any more. The list's `In your plan this week` section becomes **`Your rotation`**, in order from Next, with `▶ Next` on the first row. Row and detail lines say a routine's place in the rotation (`Next in your rotation`, `2nd in your rotation`) instead of planned days. New **RT9**: `Add to rotation` / `Remove from rotation` in a routine's `⋯`; the order is edited in Plan → Week → `Edit rotation`. Starting any routine is fine: the rotation carries on from it. Deleting a routine takes it out of the rotation (Undo puts it back).
> - **Coach targets by default (D21; [coach-adjustments.md](coach-adjustments.md) CA8).** `Next:` on the detail is the coach's next-session target from the last time this routine was done (saved by default, with Undo on that summary), otherwise the built-in rule's, otherwise the Fixed load. `Auto` is explained the same way. `1 suggested change ›` now only means a bigger target change or a structural change (swap, add, remove, order), which still needs Apply.
> - Changed: §2.1 (wireframe, row rules), §2.2, RT3, new RT9, §3.1, §4.1, §4.5, §4.7, §5, §6, checks 4, 16 and new 26–30.

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
| RT3 | Template loads default to **`Auto`** (`targetLoad: null`): next-session targets come from the coach's next-session targets (saved by default since D21, coach-adjustments CA8) or, without one, the built-in rule (ADR 0006). Ben can pin a **Fixed** load per set; a Fixed load is never changed by the coach or the rule. Back-off sets can use **`% of top set`** | With coach-led progression a hard-coded template load goes stale after one session. Fixed stays available for Ben's own rules |
| RT4 | **"Repeat last workout"** turns the chosen finished session into a **pending** session with each done set's **actual** as the new **target**. Skipped and deleted sets aren't copied. Progression is not applied. Nothing is marked done | Brief §12: editable targets, never falsely completed sets. Ben asked for "what I did", not "what's next". `Start Push A instead` gives next-time targets |
| RT5 | **Source tags** on rows: `Coach` (made by the workout builder and not yet edited), `Ben` (made or edited by Ben), and later `Imported` (FitNotes, step 3). Editing a coach routine makes it `Ben` (WB8) | Ben asked to see who made each routine. Tag is text + icon, never colour |
| RT6 | Optional **`AMRAP (+)`** flag on a set template. A set with it never raises a coach offer for high effort | programmes.md: planned AMRAP sets are RPE 9–10 by design; ADR 0006 triggers should not fire on them. Needs a `SetTemplate.amrap` field (schema change) |
| RT7 | **`Counts as heavy legs`** routine setting: `Auto` (default), `Yes`, `No`. Auto is decided by `classifySessionLoad` (weekly-plan.md WP4) | The weekly plan's long-run warning needs a deterministic, overridable definition |
| RT8 | **Rest between sides** for unilateral exercises appears under Advanced as `Same as set rest` (default) / `Transition` / `None`, but is **disabled with `Coming later`** until the domain supports it | ADR 0003 follow-up 3 is open. Shown so the gap is visible, not invented |
| RT9 | (9 Oct evening, D19) **Rotation membership lives on the routine; order lives in the rotation.** A routine's `⋯` has `Add to rotation` (added at the end) or `Remove from rotation`, applied at once with Undo. Reordering is only in Plan → Week → `Edit rotation` (weekly-plan §2.4), so there's one place to see the whole order. A coach-made routine joins the rotation only when Ben adds it | Two quick actions where Ben already is, one place for order. Coach routines never slip into the rotation by themselves (rule 3: structural changes need Ben) |

## 2. Layout

### 2.1 Plan hub, Routines segment (list)

Regions top to bottom: nav bar (back, title, search, `⋯`) · segmented control · quick-start group · `Your rotation` (revised 9 Oct evening; was `In your plan this week`) · `All routines` (those not in the rotation) · `Coach drafts` row · Ask pill.

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
│ Your rotation              Edit order ›│ → weekly-plan §2.4
│ ┌────────────────────────────────────┐ │
│ │ ▶ Next  Legs A        [ Start ]    │ │ RoutineRow; Start = secondary
│ │ [👤 Ben] 6 exercises · about 60 min│ │
│ │ After Pull A on Wed 14             │ │ basis (actual)
│ ├────────────────────────────────────┤ │
│ │ 2  Push A             [ Start ]    │ │
│ │ [👤 Ben] 5 exercises · about 55 min│ │
│ │ Last done Mon 12                   │ │
│ ├────────────────────────────────────┤ │
│ │ 3  Pull A             [ Start ]    │ │
│ │ [👤 Ben] 6 exercises · about 55 min│ │
│ │ ⚠ 1 exercise not at Hotel Gym      │ │ warning: Start opens Detail
│ └────────────────────────────────────┘ │
│                                        │
│ All routines                Sort: Recent│ routines not in the rotation
│ ┌────────────────────────────────────┐ │
│ │ Push B                [ Start ]    │ │
│ │ [👤 Ben] 5 exercises · about 55 min│ │
│ │ Last done Tue 22 Sep               │ │
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
- Line 1 in `Your rotation` (9 Oct evening) starts with the position from Next: `▶ Next` (icon + word) or `2`, `3` (tabular). No dates; the order comes from `getNextInRotation`.
- Line 3, one of, by priority: a gym problem (`⚠ 1 exercise not at Hotel Gym`), `1 suggested change ›` (open bigger or structural proposals for this routine), on the Next row the basis (`After Pull A on Wed 14`, `Start of your rotation`), `Last done Tue 6 Oct`, or `Not done yet`.
- Starting a routine that isn't Next is one tap, as before; the rotation then carries on from it (weekly-plan WP14). The row doesn't warn about it: the routine sheet in Plan → Week says `Starting it now makes Pull A next.` for anyone who wants to check.
- At AX1+, `Start` moves under line 3, full width of the row.

### 2.2 Routine detail

```
┌────────────────────────────────────────┐
│ ‹ Plan          Push A        Edit  ⋯  │ ⋯: Duplicate, Version history,
├────────────────────────────────────────┤    Add to / Remove from rotation,
                                              Delete
│ Push A                                 │ type.title2
│ [👤 Ben] Chest · shoulders · triceps   │ focus derived from catalogue
│ 5 exercises · about 55 min at Main Gym │
│ 2nd in your rotation · last done 6 Oct │ revised 9 Oct evening (D19)
│                                        │
│ 💬 1 suggested change              › │ opens change-review (only if open;
│                                        │ bigger or structural changes)
│                                        │
│ All values are targets.                │
│ 1 Bench press · Barbell                │
│   2 warm-up + 1 top + 3 back-off       │
│   Top: Auto · 4–6 reps · RPE 8         │
│   Next: 97.5 kg (coach)                │ what Start will prefill (D21)
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

- `Next:` shows what `startWorkout` would prefill today, with its source in words: the coach's next-session target from the last time this routine was done (saved by default since D21, coach-adjustments CA8: `coach`), otherwise the built-in rule's (`built-in rule`), or a Fixed load (`fixed`). These are **targets**. If Ben undid the coach's target on that summary, the built-in rule's shows.
- (9 Oct evening, D19) The place line reads `Next in your rotation · after Pull A on Wed 14`, `2nd in your rotation · last done 6 Oct`, or `Not in your rotation · last done 22 Sep`. `⋯` adds `Add to rotation` / `Remove from rotation` (RT9).
- **Gym problems** (from `validateRoutineForGym`) appear as a `GuardNoteList` titled `At Hotel Gym (2)` above `All values are targets.`, for example `⚠ Cable fly: Hotel Gym has no cable station. Swap ›` and `ⓘ Incline DB press: Hotel Gym's dumbbells stop at 25 kg each. Targets will be capped.` `Start workout` is still allowed: the active workout shows the dropped or capped targets as it already does (active-workout §2.11). (2026-10-09) `validateRoutineForGym` is a thin wrapper over `snapPlanToGym` (mode `start`, [gym-switch.md](gym-switch.md) §6.2), so these notes are exactly what Start will plan.

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
│ Push A · done at Main Gym · 16 sets    │
│ Checked for [⌂ Main Gym ▾]             │ GymChip (2026-10-09): re-checks only
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
- **One function (2026-10-09).** Every load on this preview comes from `snapPlanToGym` (mode `repeat`), the function the mid-workout gym switch uses ([gym-switch.md](gym-switch.md) §6.1). Last time's actual is the **intended** target. The fitted load is what Start plans, and both are stored on the set (`planned.snap`). The rules below are that function's rules, not Repeat's own.
- **Gym chip (GS10).** `Checked for [⌂ Main Gym ▾]` opens the gym switcher (`Choose gym`). Choosing a gym calls `buildRepeatSessionDraft(sessionId, gymId)` again and replaces the preview's rows and notes. Nothing is started or saved, and Ben's row edits on this preview are kept where the exercise still exists. With a different gym, the header line reads `Done at Main Gym. Checked for Hotel · Lisbon.` (§3.4).
- **Different gym today:** each load is rounded toward easier to what this gym can make, never past its max. Notes (`NoteLine`, shared wording with the switch card): `Max here 20 kg each · last time 30 kg each` · `Rounded · last time 32.5 kg each` · `No load target · different equipment here · last time 60 kg plates` (convention mismatch, never converted).
- **No equipment of that kind here (review B1):** the load target is dropped and the reps kept: `⚠ No load target · no olympic bar here · last time 100 kg × 5` with a trailing `Swap ›`. `Swap ›` opens the Swap sheet (exercise-library §2.5) at this gym; choosing a substitute replaces the row **in this draft only**, with targets from the substitute's own history, fitted the same way, or none. Repeat never swaps by itself. A load is never planned without equipment to check it on, and nothing says "kept as done" or "kept as planned".
- **kg↔lb** (PM decision on review SP5): a load is converted only when the converted value rounds **toward easier** to a load today's equipment can make (`Converted from 22.5 kg each`). If the easiest load here is harder than last time's (`No load target · lightest here is above 5 kg each`), or there's no equipment to check a converted load on, the load is dropped with a note.
- **Later switch.** If Ben starts here and then switches gym mid-workout, the switch fits from the same intended targets (last time's actuals). Switching back to the gym Repeat was done at restores them (gym-switch GS2).
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
| Suggested change waiting | Line 3 `1 suggested change ›` | Opens change-review.md. (9 Oct evening, D21) Only bigger target changes and structural changes; the coach's small next-session targets are already saved |
| No rotation (9 Oct evening) | `Your rotation` section reads `No rotation yet.` + `Set up your rotation ›` (weekly-plan §2.4); every routine is under `All routines` | Starting any routine still works |
| Routine not in the rotation (9 Oct evening) | Listed under `All routines`; detail place line `Not in your rotation · last done …` | `⋯` → `Add to rotation` |
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
| Gym changed on the preview (2026-10-09) | Rows and notes rebuilt for the chosen gym; the header chip shows it. No session exists yet. Ben's row edits are kept where the exercise still exists |
| Equipment not here (2026-10-09) | Row `Target 5 reps · no load target` + `⚠ No load target · no olympic bar here · last time 100 kg × 5` `Swap ›` |
| Chosen gym has no equipment (2026-10-09) | Every loaded row has no load target; one header note `Hotel · Lisbon has no equipment set up yet.` `Add equipment ›` (gym-editor §2.3 as a sheet; the preview re-checks after `Save`) |
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
| `Sort` (applies to `All routines`) | `Recent` (last done, default) · `A–Z`. Remembered. (9 Oct evening: `Planned first` withdrawn; the rotation section is always in rotation order) | — |
| `Edit order ›` (9 Oct evening) | Plan → Week → `Edit rotation` (weekly-plan §2.4) | — |
| Row `⋯` → `Add to rotation` / `Remove from rotation` (9 Oct evening, RT9) | `updateRotation(rotationId, routineIds[], expectedVersion, opId)`. Toast `Push B added to your rotation` / `Push B removed from your rotation` [Undo] | Also in the detail's `⋯` |
| `Coach drafts (2)` | Drafts list (workout-builder WB9) | — |
| 🔍 | Exercise library, browse mode ([exercise-library.md](exercise-library.md)) | — |

### 4.2 Detail
- `Start workout` as the list's `Start`. Exercise row tap opens the exercise's history sheet (same as Active workout).
- `Swap ›` on a gym note: superseded by the Workout overview's `Swap today` ([overview-today-edits.md](overview-today-edits.md), 11 Oct 2026). A today-only swap is stored in the pre-start draft and made at Start. `Change Push A too ›` opens a Ben-authored change-review card (scope `Push A from now on`, before → after, Apply, Undo), not the editor's Save (rule 2; TE4). The editor's own `Replace exercise` (§4.3) is unchanged.
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
- `startWorkout(routineId, gymId, opId)` copies the routine's current version into the session (`session.source = {kind: 'routine', routineId, routineVersion}`). Targets are planned at Start: Fixed loads where Ben pinned them; otherwise the coach's next-session targets (saved by default since D21), else built-in rule targets; all snapped to the gym's achievable loads (ADR 0003 B1).
- (2026-10-09) **Equipment at another gym.** A routine exercise pinned to an item (`Advanced → Equipment`) that the selected gym doesn't have is mapped with the shared rules (gym-switch GS3): the item this exercise last used at this gym, else the same kind, else another compatible kind, else none. With none, the load target is dropped and the reps kept. Start goes through `snapPlanToGym` (mode `start`), never an ID-only lookup that leaves a Fixed load unchecked. (2026-10-10, PM decision on merge review S1) **One rule everywhere:** routine Start from a row or from Up next, plain Start, Repeat and the gym switch all use GS3 as written (same kind first, then another kind the exercise lists). Routine Start has no equipment pick of its own; it passes the routine's item and unfitted loads to the shared fit, so the planned target is kept and a later switch back to a gym that has the item restores it.
- Editing the routine later never changes a session that already started. The editor says so when that routine is in progress (§3.3).
- (Revised 9 Oct evening, D21) The coach's small next-session targets from the last time this routine was done are already saved; Start plans them (Undo was on that summary; in the workout, `Why?` → `Use built-in rule`, active-workout AW4). Open coach **proposals** for this routine (bigger target changes, structural changes) expire when it starts (change-review CR8). Today and the list stop showing them.
- (9 Oct evening, D19) Finishing a workout started here (with at least one working set) moves the rotation on: Next becomes the routine after this one, if this one is in the rotation (weekly-plan WP14).

### 4.6 Repeat last workout
- Rows can be removed (`⋯` → `Remove`) or edited (set sheet). Nothing is saved until `Start workout` or `Save as routine`.
- `Start workout` calls `startWorkoutFromSession(sourceSessionId, edits, gymId, opId)`: a new session whose sets are all **pending**, with `session.source = {kind: 'repeat', sessionId}`. Each set stores `planned.snap` from the same `snapPlanToGym` result the preview showed, so the set card's notes match the preview's (2026-10-09).
- The header `GymChip` (2026-10-09) re-checks the preview for another gym (§2.4). `Swap ›` on a `not_here` note replaces that row in the draft. Neither starts anything.
- `Save as routine` opens the editor prefilled; loads stay Fixed from the actuals until Ben changes them to `Auto`.

### 4.7 Delete
`Delete routine` confirms: `Delete Push A? It will be taken out of your rotation. Past workouts keep their records.` (not in the rotation: `Delete Push A? Past workouts keep their records.`) [Delete] [Cancel]. Then toast `Push A deleted` [Undo] (`timing.undoToast`), which restores the routine and its place in the rotation. (Revised 9 Oct evening, D19; was "planned on 2 upcoming days".) The routine is a tombstone, so finished sessions keep their snapshot and provenance.

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
| Sections | `Your rotation` · `Edit order ›` · `All routines` · `Coach drafts (2)` · `Sort: Recent` / `A–Z` · `No rotation yet.` · `Set up your rotation ›` (revised 9 Oct evening) |
| Row | `▶ Next` · `6 exercises · about 60 min` · `After Pull A on Wed 14` · `Start of your rotation` · `Last done Tue 6 Oct` · `Not done yet` · `Made 8 Oct` · `⚠ 1 exercise not at Hotel Gym` · `1 suggested change ›` · button `Start` |
| Rotation (9 Oct evening) | `Next in your rotation · after Pull A on Wed 14` · `2nd in your rotation · last done 6 Oct` · `Not in your rotation · last done 22 Sep` · `Add to rotation` · `Remove from rotation` · toasts `Push B added to your rotation` / `Push B removed from your rotation` [Undo] |
| Source tags | `Coach` (`text.bubble` icon) · `Ben` (`person` icon) · `Imported` (`square.and.arrow.down`, step 3) |
| In progress | `Push A is in progress.` [Resume] · `Finish or discard Pull A to start this.` |
| Detail | `All values are targets.` · `Next: 100 kg (built-in rule)` / `Next: 97.5 kg (coach)` / `Next: 60 kg (fixed)` · `No history: start light, enter your load.` · `Rest 3:00 top · 2:00 back-off` · `Rest 1:30 after each round` |
| Detail, gym notes | `At Hotel Gym (2)` · `Cable fly: Hotel Gym has no cable station. Swap ›` · `Incline DB press: Hotel Gym's dumbbells stop at 25 kg each. Targets will be capped.` |
| Primary | `Start workout` · `Resume Push A` · `Save` · `No changes` · `Add a name` · `Add an exercise` · `Fix 1 issue` |
| Editor | `Name` · `Exercises` · `Reorder` / `Done` · `Group` / `Ungroup` · `+ Warm-up` · `+ Working` · `+ More` (`Top set`, `Back-off`, `Drop set`) · `Rest by set type` · `Advanced` · `Routine settings` · `Add exercise` |
| Set sheet | `Type` · `Load` (`Auto`, `Fixed`, `% of top set`) · `About 90 kg at Main Gym (rounded down)` · `Reps` (`Range`, `Exact`) · `AMRAP: last set as many as you can` · `Effort target (optional)` (`None`, `RPE`, `RIR`) · `Rest after this set` · `Back-off preset · 2:00` · `This set only` · `Work time` · `Applies to all 3 back-off sets.` · `Delete set` |
| Auto explained (info button next to `Auto`) | `Auto: the coach's target from the last time you did this routine, or the built-in rule's when there isn't one. Worked out when you start.` (revised 9 Oct evening, D21) |
| Load warnings | `Not on Main Gym's rack. At Start it rounds down to 27.5 kg each.` · `Main Gym's rack stops at 30 kg each. At Start this is capped.` · `Loads reset: DB bench press is in kg each.` |
| Rest sheet | `Rest by set type · Bench press` · `Only set types used here are listed.` · `Not set here → Bench press default (2:00) → your Standard preset (1:30).` · `Use default` |
| Advanced | `Equipment` (`Any compatible`) · `Built-in rule` · `Move to next exercise` · `Rest between sides` + `Coming later` · `Notes` |
| Superset | `Superset A · 3 rounds` · `Between members` · `After each round` · `A1 has 4 sets, A2 has 3. Round 4 is A1 only.` |
| Routine settings | `Counts as heavy legs` (`Auto`, `Yes`, `No`) · `Auto: no (2 squat/hinge working sets)` · `Default gym` · `Source` |
| Notes in editor | `Saving your edits makes this your routine. The coach's version stays in its history.` · `Push A is in progress. Edits apply from your next workout. Today's workout doesn't change.` |
| Validation | `Reps: the first number must be the smaller one.` · `Add at least one set.` |
| Dialogs | `Discard changes to Push A?` [Discard] [Keep editing] · `Remove Bench press from Push A?` [Remove] [Cancel] · `Delete Push A? It will be taken out of your rotation. Past workouts keep their records.` [Delete] [Cancel] |
| Conflict | `Push A changed while you were editing` · `Coach target applied for Bench press, 18:40` · `Keep both` · `Discard my edits` |
| Toasts | `✓ Saved Push A` [Undo] · `Push A deleted` [Undo] · `✓ Restored version 4` |
| Repeat | `Repeat Tue 6 Oct` · `Push A · done at Main Gym · 16 sets` · `Checked for` + gym chip · `Targets: as on 6 Oct` · `Start Push A instead (next targets) ›` · `Not copied: 2 skipped sets (Cable fly)` · `Done at Main Gym. Checked for Hotel Gym.` · `Choose another ›` · `Save as routine` |
| Repeat gym notes (2026-10-09; same wording as gym-switch.md §5, "last time" = a past **actual** used as the **target**) | `No load target · no olympic bar here · last time 100 kg × 5` `Swap ›` · `Max here 20 kg each · last time 30 kg each` · `Rounded · last time 32.5 kg each` · `Converted from 22.5 kg each` · `No load target · lightest here is above 5 kg each` · `No load target · different equipment here · last time 60 kg plates` · `Hotel · Lisbon has no equipment set up yet.` `Add equipment ›` |
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
| `buildRoutineListView(ownerId, gymId, localDate)` | Rows `{routineId, name, exerciseCount, estimateMin, source, lastDoneDate, rotation?: {positionFromNext, isNext, basis?}, gymIssueCount, openProposalCount}`, `quickStart.lastSession`, `draftsCount`, `activeSession`. (Revised 9 Oct evening: `rotation` from `getNextInRotation`, weekly-plan §6, replaces `plannedDays[]`.) Local only |
| `buildRoutineDetailView(routineId, gymId)` | Exercises with set summaries, `next` targets with source (`coach` / `rule` / `fixed` / `none`; `coach` = the saved D21 target from the last time this routine was done), gym notes, rotation place (replaces plan days), open proposals |
| `updateRotation(rotationId, routineIds[], expectedVersion, opId)` (9 Oct evening) | Weekly-plan §6; used by `Add to rotation` / `Remove from rotation` (RT9) |
| `validateRoutineForGym(routineVersion, gymId, equipmentVersion)` | **Pure, `packages/domain`.** Returns notes: `incompatible_exercise`, `capped`, `rounded`, `convention_mismatch`, `no_achievable_loads`. Same note kinds and wording as `validateGeneratedWorkout` where they overlap. (2026-10-09) A thin wrapper over `snapPlanToGym` (mode `start`, gym-switch §6.1); `incompatible_exercise` is its `not_here` |
| `createRoutine(draft, opId)` / `duplicateRoutine(routineId, opId)` | New routine, source `ben`, provenance on duplicate |
| `deleteRoutine(routineId, expectedVersion)` / `restoreRoutine(routineId)` | Tombstone; removes the routine from the rotation and restores it to the same position, in one transaction (revised 9 Oct evening; was linked scheduled sessions) |
| `listRoutineVersions(routineId)` / `revertRoutine(routineId, toVersion, expectedVersion)` | Version history; revert creates a new version |
| `buildRepeatSessionDraft(sessionId, gymId)` | Done sets → pending targets (actuals become targets), skipped/deleted excluded, start-time load check notes. (2026-10-09) The loads and notes come from `snapPlanToGym` (mode `repeat`; intended = last time's actual). This replaces `repeat.ts`'s own `pickEquipment` and drop branches (gym-switch §6.6) |
| `startWorkoutFromSession(sourceSessionId, edits, gymId, opId)` | Snapshot like `startWorkout`; `session.source = {kind: 'repeat', sessionId}`; no set is created done. (2026-10-09) Writes `planned.snap` per set from the same result as the preview |
| `startWorkout` equipment mapping (2026-10-09) | Uses `snapPlanToGym` (mode `start`) with the gym-switch GS3 mapping. Never keeps a load when the pinned item isn't at the selected gym |
| `classifySessionLoad(routineVersion)` | **Pure.** Returns `{heavyLegs: boolean, reason}` from catalogue movement patterns and set templates, unless the routine overrides it (RT7). Shared with weekly-plan.md |
| Schema: `SetTemplate.amrap: boolean` (RT6), `Routine.source`, `Routine.defaultGymId`, `Routine.heavyLegsOverride: 'auto' \| 'yes' \| 'no'` (RT7), `Routine.deletedAtUtc` | Not in `routine.ts` yet |

## 7. Acceptance checks

1. From Today, `Other routine` → a row's `Start` reaches Active workout in **2 taps**. Double-tapping `Start` creates one session.
2. A routine with a gym problem at the selected gym shows the `⚠` line, and its row `Start` opens Detail with the note visible instead of starting.
3. Every number on Detail, the editor and Repeat is labelled as a target (`All values are targets.`, `Target …`, `Next: …`). `Last …` values are actuals with a date.
4. `Next:` on Detail equals the first set's prefilled target after `Start workout` (same value, unit and convention) for a coach target saved by default after the last Push A (D21), a built-in-rule target (coach offline, no coach target, or Ben undid it) and a Fixed target.
5. Edit Push A while a Push A workout is in progress: the note shows, Save works, and the running workout's sets and targets don't change. The next Push A uses the new version.
6. A back-off set with `90% of top set` and a top target of 100 kg shows `About 90 kg at Main Gym (rounded down)`; on a bar with 2.5 kg steps, a top target of 102.5 kg shows `About 90 kg` (92.25 rounded down), never an unachievable load.
7. A Fixed load of 37.5 kg each on a 30 kg rack saves with the capped warning; at Start the target is 30 kg each.
8. Rest: with presets Warm-up 1:00 and Top 3:00 and a set override of 2:30 on set 4, `resolveRestPreset` returns 1:00 / 3:00 / 2:30 with sources `routine_set_type` / `routine_set_type` / `set_override`, matching the editor.
9. A superset of A1 and A2 with `After each round 1:30` and `Between members 0:00` starts no rest after A1 and 1:30 after A2 in the workout.
10. A timed exercise's sets show `0:45` and the sheet shows `Work time`, never `Reps`.
11. A unilateral exercise shows `per side`; `Rest between sides` is visible but disabled with `Coming later`.
12. `Replace exercise` from barbell to dumbbells resets loads to `Auto` with the reset note; no converted number appears.
13. `Repeat last workout` creates a session in which **no** set is done; targets equal the source session's actuals; skipped sets are listed as not copied; at another gym, loads are rounded down or dropped with notes. (2026-10-09) At a gym with no equipment of the source's kind, `planned.load === null` with the reps kept and the `No … here: no load target (last time …)` note. No text says "kept as done" or "kept as planned" (review B1; competitor test 2g).
14. Editing a `Coach` routine and saving changes its tag to `Ben` and keeps `Based on a coach workout, 8 Oct ›`.
15. A save conflict (coach target applied while editing) shows the conflict sheet; nothing is overwritten without Ben choosing.
16. (Revised 9 Oct evening) `Delete routine` on a rotation routine confirms with `It will be taken out of your rotation.`; Undo within 8 s restores the routine at the same rotation position; a finished session from that routine still opens with its original exercises.
17. With airplane mode on and no AI, the list, Detail, editor, Repeat and Start all work; only `New with coach` shows `Coach offline`.
18. With the keypad open on any number field in the editor, `Save` is fully visible at 375pt width at default size and at AX3.
19. Every gesture has a button equivalent: Reorder has `Move up` / `Move down`; long-press actions are also in `⋯`.
20. All text is at least 16pt, numbers are tabular, and tags, warnings and set types carry text or icons as well as colour, in dark and light modes.
21. (2026-10-09) **Same function as the switch.** For the same exercise, intended loads and gym, Repeat's preview and a mid-workout switch to that gym give the same loads, outcomes and note keys (gym-switch check 3). Repeat never proposes a swap by itself.
22. (2026-10-09) The Repeat preview's gym chip changes the checked gym and rebuilds every row and note without creating a session. `Start workout` uses that gym, and the set card's notes match the preview's.
23. (2026-10-09) `Swap ›` on a `not_here` row replaces the row in the draft only. Its targets come from the substitute's own history at this gym, or none. Nothing is converted from the original load.
24. (2026-10-09) A routine with a Fixed 100 kg bench pinned to Main Gym's bar, started at a dumbbell-only gym, has no bench load target. A routine pinned to Main Gym's dumbbells, started at Hotel · Lisbon (rack to 20 kg each), maps to Hotel's rack and caps at 20 kg each. Routine detail shows the same notes before Start.
25. (2026-10-09) A Repeat started at Hotel · Lisbon (bench load dropped, incline capped at 20 kg each) and then switched to Main Gym mid-workout plans last time's 100 kg and 30 kg each again (gym-switch GS2).
26. (9 Oct evening, D19) With rotation Push A, Pull A, Legs A and Pull A last done, `Your rotation` lists `▶ Next Legs A`, `2 Push A`, `3 Pull A`, with no dates; routines not in the rotation are under `All routines`.
27. (9 Oct evening) `Start` on Push A (not Next) is still 2 taps from Today; after finishing it, the list shows `▶ Next Pull A`.
28. (9 Oct evening, RT9) `⋯` → `Add to rotation` on Push B adds it at the end with a toast and Undo; `Remove from rotation` takes it out; neither changes any workout or target. A coach-made routine saved from the builder isn't in the rotation until Ben adds it.
29. (9 Oct evening, D21) After a Push A summary saved a coach target of 97.5 kg for bench, Push A's detail reads `Next: 97.5 kg (coach)`; after Ben taps Undo on that summary row, it reads `Next: 100 kg (built-in rule)`. A Fixed load reads `(fixed)` in both cases.
30. (9 Oct evening) `1 suggested change ›` never appears for a small coach target (those are already saved); it appears for a bigger-change or structural proposal and opens change-review.

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
- [gym-switch.md](gym-switch.md): `snapPlanToGym`, shared by Repeat, routine Start, routine detail notes and the mid-workout gym switch
- [rest-state.md](rest-state.md) §4.2: rest resolution order used by the editor
- [coach-adjustments.md](coach-adjustments.md) §4.6: next-time proposals that change `Next:`
- `docs/training-guides/programmes.md`: AMRAP note behind RT6
