# Active workout: Table view (proposed revision, not yet approved)

To merge into `docs/design/active-workout.md` as a new §2.4 (replacing the current Overview section) once Ben approves. The mockup is `workout-table-final.html`. Rest-state.md and premium-feel.md §3 need the small follow-ups listed in §9.

## 1. Purpose

Answers "where am I in today's session, and what do I lift now?" on one screen. The single primary action is still **`Log <load> × <reps>`** for the current set. It is always visible in a fixed bar and always names the set.

This restyles the existing Overview (`WorkoutOverviewScreen`, `buildWorkoutOverview`) and makes it the **default** view. Focus (§2.1–2.3) stays reachable from ⋯ → `Focus view` (choice 1, §10).

## 2. Layout (iPhone 390 pt wide, Direction D dark)

1. **Header (52 pt):** `⌄` · routine name (`type.sectionLabel`) · `GymChip` · elapsed (tabular) · `⋯`. The voice-mode pill and Pause move into ⋯.
2. **Banner slot (0–2):** restored, offline, equipment warning, paused. Unchanged.
3. **List (scrolls):** one borderless `bg.surface` card per exercise, `radius.lg`.
   - Header: name (`title2`, with a chevron = opens the exercise sheet) · subtitle `<equipment/unit> · Last 100 × 8, 8, 7` · progress `1/3` · `⋯`.
   - Column labels `SET · KG · REPS · ✓` (`sectionLabel`). The unit is written once (`KG`, `kg each` / `kg stack` in the subtitle).
   - Rows, 52 pt minimum: done, pending, or the **open row** (§3).
   - `+ Add set` (44 pt).
   - Finished exercises fold to one 52 pt line: `✓ Bench press   100 × 8, 8, 7`.
   - At the end of the list: `TimeLeftLine`, then the `Finish workout` text button (more than `space.8` below it).
4. **Undo toast slot:** above the rest bar.
5. **Rest bar (56 pt, only while resting):** `REST 2:09` · `−30` `+30` `Skip` (44 pt outline pills), with a 3 pt accent drain along the bottom edge.
6. **Action bar (fixed, on canvas, rides the keypad):** `Chat` (60 pt round) · `Log` pill (60 pt). Once voice is built, `Talk` replaces the Chat glyph's slot, or sits beside it (voice.md decides).

```
┌────────────────────────────────────────┐
│ ⌄  PUSH  (Main Gym ▾)        12:08  ⋯  │
├────────────────────────────────────────┤
│ Bench press ›                  1/3   ⋯ │
│ Barbell · Last 100 × 8, 8, 7           │
│ SET     KG        REPS          ✓      │
│ [W]     60        5             ●✓     │ done = bright + green tick
│ 1       100       8  RPE 8      ●✓     │
│┃2 NOW                 Last 100 × 8 ›  ││ open row (bg.raised)
│┃20 bar + 25 + 15 / side               ││ barbell/plate-loaded only
│┃┌LOAD──────────────┐ ┌REPS──────────┐ ││
│┃│ (−)  100 kg  (+) │ │ (−)  8   (+) │ ││ 52 pt buttons, 38/500 numerals
│┃└──────────────────┘ └──────────────┘ ││
│┃Target 100 kg × 6–8                   ││
│ 3       100       6–8           ○      │ target = dim + open ring
│ + Add set                              │
│ Incline DB press ›             0/3   ⋯ │
├────────────────────────────────────────┤
│ REST 2:09 ▁▁▁▁▁▁   (−30) (+30) (Skip)  │ only while resting
│ (Chat)  ( Set 2 · Log 100 kg × 8     ) │
└────────────────────────────────────────┘
```

## 3. Row anatomy

| Row | Shows | Style | VoiceOver |
|---|---|---|---|
| Done | actual load, reps, optional `RPE 8`, exclusion second line `Spotted · not counted` | `text.primary` 500, filled `status.done` tick | "Set 1, done, 100 kilograms, 8 reps, RPE 8" |
| Pending | target load, rep range | `text.tertiary` 400, open `border.control` ring | "Set 3, target 100 kilograms, 6 to 8 reps" |
| Coach-changed pending (today only) | value + `C` badge | as pending | "Coach target 95 kilograms… Plan was 100 kilograms" |
| Open (current) | `n NOW` / `n NEXT`, `Last 100 × 8` copy link, plate hint, LOAD/REPS steppers, `Target …` line, `⚠ Pain flag: no increases` if flagged, Side control if unilateral | `bg.raised`, 3 pt accent bar on the left | "Set 2, current. Load 100 kilograms, adjustable…" |
| Warm-up | `W` badge in the SET cell | as above | "Warm-up set" |

A range (`6–8`) only ever appears on a target. A done row always shows a single actual value.

## 4. States and transitions

- **Ready:** the current set is open, and Log reads `Set 2 · Log 100 kg × 8`.
- **Resting:** Log commits. The saved row turns done, the effort chips (6–10, 52 pt, optional) appear under it, the **next** row opens prefilled, and the rest bar appears. Tapping the numeral opens the full rest view (rest-state.md, 88/300). The effort chips fold into `RPE n` on the saved row at the next Log or when rest ends. The fold happens above the open row, so the list keeps its scroll position and nothing jumps.
- **Superset:** one card with a `Superset A · Round 2 of 3` header, a bracketed member list (`A1 Cable fly · kg stack`, `A2 Lateral raise · kg each`), and rows grouped under `ROUND n` in lifting order. Logging A1 opens A2 with no rest (`Log 25 kg × 14 → A2`). Logging A2 starts the round rest. A transition rest shows as `Move to A2 · 0:15` in the rest bar.
- **Coach offer (deterministic trigger only):** inline under the triggering done row: `COACH` / `That looked hard. Adjust set 3?` / `Set 3: 100 kg → 95 kg × 6–8` / `No thanks` · `Adjust` (52 pt). Pending rows and Log don't change until Adjust. Adjust applies, marks the row `C`, and shows the toast `Set 3 changed · Undo`. The next Log dismisses the offer. With AI unavailable, no offer card appears.
- **Timed set:** the open row shows a `Work 0:45` tile instead of steppers. Log becomes `Start 0:45`, then `Stop`, then `Log 0:38` (§2.7).
- **Unilateral:** rows show `L`/`R` after the set number. The open row adds the Side control (`Both · Left · Right`, 52 pt) under the steppers (§2.9).
- **Pain flag:** the exercise header shows a `⚠ Pain` badge (icon, word, `status.warning`). The open row shows `⚠ Pain flag: no increases`, which opens the pain sheet. Log is never blocked.
- **Gym switch:** via the GymChip. The re-snap proposal (gym-switch.md) is unchanged. Snapped rows update only after Apply.
- **Paused:** the header shows `⏸ Paused · 3:56` and the rest bar freezes with `REST · PAUSED`. Log becomes `Resume`.
- **Last set logged:** Log becomes `Finish workout` (confirmation sheet). There is no other Finish near the bar.
- **Empty workout:** the §2.10 empty state is unchanged.
- **Offline / AI unavailable:** logging is unaffected. Chat opens the coach sheet, which shows its honest status there. The list shows no fake coach content.
- **Keypad open:** the open row stays visible above the keypad (auto-scroll). Log rides the keypad with no home-indicator gap (both action bars, design pass 1.7, 20 Oct). The Last link and toast hide. The tapped KG / REPS / TIME / DIST cell is the field itself: value selected, number or decimal pad, accent border, no second editor line (Ben, 20 Oct). A bar on the keypad, under Log, holds `−` `+` (one achievable step for the load, 1 for reps), `Next ›` (weight to reps) and `Done` (closes the keypad and the editor; a done row's correction saves then). Cardio's `TIME · DIST` cell keeps its time-and-distance pair under the row. The plate line shows under the row while the load is edited (1.5). While the keypad is open the rest bar collapses to a slim one-line `Rest 1:47` strip (about 32pt, no `−30` `+30` `Skip`), still counting down; the full bar returns when the keypad closes (Ben, 20 Oct).
- **Force-close:** relaunch restores the same open row, the scroll position (anchored to the open row), the drafts (`saveSetDraft`) and the rest deadline.
- **Off-screen current row:** when the open row scrolls out of view, the Log label adds the exercise (`Bench · Set 2 · Log 100 kg × 8`) and a `Now ↓` / `Now ↑` chip (44 pt) appears above the bar. Each Log auto-scrolls the new open row into view (Reduce Motion: jump).
- **AX1+ Dynamic Type:** rows become blocks (`Set 3` / `Target 100 kg × 6–8`). The open row's tiles stack at full width with 60 pt buttons. The GymChip moves into ⋯, the Chat label is dropped (the accessibility label is kept), and Log wraps to two lines and never truncates the load.

## 5. Interactions

- **Log pill:** `commitSetAndBeginRest` with a fresh op ID. `timing.commitGuard` (1 s) stops double taps. `haptic.commit`. Toast `Set 2 saved · 100 kg × 8 · Undo` (8 s) → `undoAction`.
- **Open row's tick:** the same command and op ID path as Log.
- **Pending row (not current), tap anywhere including its ring:** `setActiveSet`. It opens and Log retargets. It **never logs** (choice 3).
- **Done row tap:** opens the correction sheet (`correctSet`, versioned). Ticks never toggle off. Undo and delete happen only from the sheet or the toast.
- **Steppers:** move through `getAchievableLoads` neighbours for the selected gym. Values never pass equipment max/min. Tapping the numeral opens the keypad (§2.2), and keypad values snap via `roundToAvailableLoad`.
- **`Last 100 × 8` link:** copies those values into the draft.
- **Exercise name:** opens a half sheet with plates (all loads), `Why?` (the `TargetWhyPanel` content), `How to`, `History` and `Rest after 3:00 ›`.
- **Exercise ⋯:** Adjust (coach), Add warm-up, Swap, Skip, Pain, Delete exercise.
- **Header ⋯:** Focus view, Pause workout, Voice & alerts, Rest presets, Finish workout, Edit workout times, Discard workout.
- **Folded exercise:** tap to expand. It folds again when it isn't current.
- **Rest bar:** `−30`/`+30`/`Skip` update the stored deadline. The numeral opens the full rest view.
- **Voice (Phase 5):** "log it", "100 for 8" and "skip rest" map to the same commands. The voice strip sits above the bar (§2.5).

## 6. Copy (exact)

- Column labels: `SET` `KG` `REPS` (`KG EACH` is not used in labels; the unit is in the subtitle). Warm-up badge `W`.
- Open row: `2 NOW` (Ready), `3 NEXT` (Resting), `Last 100 × 8`, `20 bar + 25 + 15 / side`, `Target 100 kg × 6–8`.
- Log: `Set 2 · Log 100 kg × 8` · off-screen: `Bench · Set 2 · Log 100 kg × 8` · superset: `A1 · Log 25 kg × 14 → A2` · timed: `Start 0:45` / `Stop` / `Log 0:38` · last: `Finish workout` · paused: `Resume`.
- Rest bar: `REST 2:09`, `−30`, `+30`, `Skip`, `REST · PAUSED`.
- Toasts: `Set 2 saved · 100 kg × 8` [Undo], `Set 3 changed` [Undo].
- Coach: `COACH`, `That looked hard. Adjust set 3?`, `Set 3: 100 kg → 95 kg × 6–8`, `No thanks`, `Adjust`.
- Pain: badge `⚠ Pain`; line `⚠ Pain flag: no increases`.
- Jump chip: `Now ↓` / `Now ↑`.
- Spoken cue on Log (if cues are on): "Saved. Rest 3 minutes." Unchanged from §5.

## 7. Data needed

- `buildWorkoutOverview` (existing, `packages/domain/src/session/overview.ts`): groups, rows, `lastText`, `platesText`, `overviewDoneBy`. Additions: `row.state: 'done' | 'pending' | 'open'`, `exercise.folded`, `superset.rounds[]` (ordered by round), and `exercise.lastSummary` (`100 × 8, 8, 7`).
- `buildActiveSetView`: the open row's draft, target, `restAfter`, `timer`, `painFlag`, `laterality`, `coachOffer`, `timeLeft`.
- Commands: `commitSetAndBeginRest`, `setActiveSet`, `saveSetDraft`, `correctSet`, `undoAction`, `endRestTimer`, `pauseSession`/`resumeSession`, `startWorkInterval`, `finishWorkout`, `addSet`, `skipExercise`, `recordTriggerResponse`, `applyCoachProposal`, `explainTarget`, `setActiveGym`.
- Loads: `getAchievableLoads`, `roundToAvailableLoad`.
- UI-only (persisted for restore): `overviewScrollAnchor {sessionExerciseId, setId}`, `viewMode: 'table' | 'focus'`, which is per session, not per exercise.

## 8. Acceptance checks

1. A fresh workout opens in Table with set 1 of the first exercise open. One tap on Log saves exactly the values on the pill.
2. While resting, one tap on Log saves the next set and ends rest. The rest notification for the old deadline is cancelled.
3. Every pending value has a dim style and an open ring, and VoiceOver reads it as "target". Every done value has a bright style and a green tick, and VoiceOver reads "done". A range never appears on a done row.
4. Tapping a non-current pending row or its ring never creates a set. It only moves Log to that row.
5. Tapping a done row opens the correction sheet. No inline edit or tick-off changes a completed set.
6. A coach offer leaves pending rows and the Log label unchanged until Adjust. Adjust shows `C` and an Undo toast. Undo restores the previous targets. A stale offer (newer session version) is rejected.
7. Stepping load never produces a value that isn't in `getAchievableLoads` for the selected gym, and never passes a machine's max.
8. All logging controls are 52 pt or larger (stepper buttons, rows, chips, coach buttons). Log is 60 pt, and the rest pills are 44 pt or larger.
9. Scrolling the open row off screen adds the exercise name to Log and shows `Now ↓`. Tapping the chip scrolls back.
10. Force-closing mid-rest and relaunching restores the same open row, its draft, and the rest countdown from the stored deadline.
11. At AX3, rows render as blocks, the steppers stack, and Log wraps without truncating the load. Nothing overlaps the action bar.
12. A superset logs A1 → A2 with no rest, and rows read in round order. A pain-flagged member shows the icon and word, and Log is still enabled.
13. Finish appears in the bar only after the last set, and always asks for confirmation.
14. Effort chips fold to `RPE n` without shifting the open row's on-screen position.
15. Airplane mode with no AI: every check above still passes, and no coach card appears.

## 9. Spec changes this needs (Ben approves)

- active-workout.md: Table becomes the default and Focus moves behind ⋯ (§2, §4.5). The header loses Pause and the voice pill (they're already in ⋯ per premium-feel §3.2). The `Last` and `Target` columns are replaced by one state-styled value. Pending-row taps select only. Finished exercises fold. The superset uses round order. The off-screen Log label and `Now` chip are new.
- rest-state.md / premium-feel.md §3: in Table, rest is the slim bar, and the full rest view opens from the numeral (in Focus it stays as today).
- design-system.md: add `component.restBar` (56 pt), `component.openRow` (`bg.raised`, 3 pt accent bar), `component.foldedExercise` (52 pt), and the `JumpChip`.

## 10. Choices for Ben

1. **Keep Focus as an optional view** (recommended) or go Table only.
2. **Bottom bar:** `Chat · Log` with Pause and Finish in ⋯ (recommended, keeps §2's "Finish never next to Log"), or the PM's `Chat · Pause · Finish`.
3. **Tick on a non-current row:** select only (recommended), or FitNotes-style instant log with Undo.

## Ben's decisions (11 Oct 2026)
- **Declutter by default:** the screen opens anchored on the current set. Completed sets and finished exercises sit *above* the viewport (scroll up to see and edit them); a small "↑ N done" chip at the top shows they exist and jumps up on tap. After each Log, the list auto-advances so the just-finished set slides up out of view (Reduce Motion: no animation, same position). Future sets/exercises are below. Force-close restore lands on the same anchored current set.
- **Choices (recommendations accepted):** (1) build 108's single-exercise Focus view stays as an option in ⋯; (2) bottom bar = Chat + Log, Pause and Finish in ⋯, Finish takes the Log slot after the last set; (3) tapping a non-current row's tick selects it and moves Log to it, never logs it.
