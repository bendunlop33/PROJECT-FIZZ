# Active workout (focused set card and Overview table)

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md): Finish refused while a work timer runs (§4.8, S4); end time passed to `finishWorkout(…, endedAt)` (S5); Undo guarded on the set's version and commit order (S1); new empty-workout state (§2.10); homes and copy for add set, add exercise, delete set, skip exercise and discard (§4.4, §4.9); per-side entry for unilateral exercises (§2.9); dropped planned load (`target_dropped`) on the set card (§2.11).
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": a Left/Right log makes the domain add a pending other-side set (`pairedWithSetId`) that becomes next and accepts only its own side; `Log right side ›` just scrolls to it, and Undo removes it (§2.9, §4.9). Progression now evaluates sides (§2.9). Stop works while paused (§4.8, S8). `no_feasible_load` shows `no load target` with `Fix the equipment profile`, never bodyweight (§2.11, §5).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Aligned with [ADR 0006](../decisions/0006-coach-led-progression.md) and rewritten rule 3. The behaviour itself is specified once in [coach-adjustments.md](coach-adjustments.md); this file only places it. Added the `Adjust` control in the exercise header (§2, §2.1), the coach slot in the focused card (§2.1, §2.3), `Coach target` / `Plan was` markers and the Overview `C` badge (§2.4, §5), the 1 s Log guard when an adjustment changes the Log label (§4.1), Ben-asked adjustments applying at once with Undo while swaps and gym changes keep the `ChangeReviewCard` (§3, §4.7), undo rows (§4.9), data (§6) and checks 26–31. The normal Log loop gains no taps.

> **Revision 2026-10-08 (consolidation).** Added `PainFlagNote` under the target line of any exercise with an active pain flag (§2.1, §5; design-system §9.50; coach-memory.md). The pain-flag undo path now points to the canonical Pain flags list (coach-memory.md §2.7). The voice strip (§2.5) is specified in voice.md; a voice-logged set carries its Undo in the strip instead of the undo toast (voice.md VO4). `Swap exercise` is pending Ben's call on exercise-library.md EL4 (§4.4). The banner slot follows system-states.md §2.2: nothing about backups, signing, builds, permissions or alert layers ever appears here.

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** Places [check-in.md](check-in.md) on this screen; behaviour is specified there. (1) The check-in normally happens on Today before the session exists, so this screen is unchanged for it. (2) **Resume / auto-open of a session with no set ever committed and an unanswered check-in** shows the `CheckInSheet` over this screen once; after any set is committed it never appears (never mid-workout). (3) After a check-in, the toast slot shows `✓ Check-in saved · 2 of 5` [Change]. (4) **Check-in offer:** with a low check-in and the coach reachable, the first set card's coach slot shows `Want a lighter session today?` / `You said 2 of 5 · …` [No thanks] [Adjust] **in Ready, before any set is logged** (an exception to "offers only while Resting", check-in.md CI5; never spoken). `Adjust` runs the normal Ben-accepted path for all of today's pending sets, with no increases allowed. Offline: one outcome line `Check-in saved. Coach offline, so today's plan is unchanged.` Changed: §3 (three rows), §4.7, §6, checks 33–35. The Log loop gains no taps.

> **Revision 2026-10-09 (exercise guides, ADR 0013).** `How to` added as the first exercise `⋯` item (§4.4), for exercises with a guide or rich cues. The screen is specified in [exercise-library.md](exercise-library.md) §8. The Log card never shows a guide. The Log loop gains no taps.

Status: v0.1 draft, 8 Oct 2026. Flow and state machine: [flow-first-milestone.md](flow-first-milestone.md). Rest behaviour: [rest-state.md](rest-state.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

This screen answers three questions at a glance:
- **What am I doing now?** The exercise, the set number and the target.
- **What did I do last time?** The comparable previous result.
- **What comes next?** The next set or exercise, and its rest.

Its single primary action is **`Log <load> × <reps>`**. One tap saves the displayed values as the actual result and starts rest. This screen is where the app either delivers its value or doesn't, so everything else is secondary to that button.

## 2. Layout

The screen is full-screen and pushed from Today. It has no tab bar. It has two views, **Focus** (default) and **Overview**. Both views edit the same data and share the same top bar, rest timer and action bar.

Regions, top to bottom:

1. **Top bar (44pt).**
   - `chevron.down` minimises the workout to Today (the workout keeps running).
   - The title, e.g. `Push A`.
   - Elapsed active time, e.g. `24:31` (tabular; paused time excluded).
   - `Pause`.
   - `⋯` menu: Finish workout, Discard workout, Voice & alerts, Rest presets, Edit workout times.
2. **Status row (44pt).**
   - `GymChip`.
   - `VoiceModePill`.
   - The Focus/Overview segmented control, right-aligned and 44pt tall.
3. **Banner slot (0–2 banners).** Restored, offline-and-coach, equipment warnings, paused. Coach adjustments never use this slot.
4. **Content (scrolls).** The focused card or the Overview table. The exercise header carries the `Adjust` control (left of `⋯`). The card has one **coach slot** for an offer, a pending request, an adjustment banner or an outcome line ([coach-adjustments.md](coach-adjustments.md) §2.1).
5. **Voice strip (only while voice is in use).** Above the action bar.
6. **Undo toast slot.** Above the action bar.
7. **Action bar (fixed).** `TalkButton` (60 × 60) and `PrimaryButton`. It moves up with the keypad.

Finish is in the `⋯` menu, and it is the primary only after the final set. It is never placed next to Log.

### 2.1 Focus view, Ready (normal)

```
┌────────────────────────────────────────┐
│ ⌄  Push A          24:31     ⏸    ⋯   │ top bar
│ [⌂ Main Gym ▾] [🔈 Cues ▾] [Focus|All] │ status row
├────────────────────────────────────────┤
│ Bench press             Adjust  ⋯      │ exercise header (tap → history)
│ Barbell · Working · Set 2 of 4         │
│ Last (1 Oct): 100 kg × 8               │ previous comparable, tap = copy
│                                        │
│  Load                    Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │ NumberSteppers (draft actual)
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │ target, always labelled
│  ⚠ Pain flag: no increases             │ PainFlagNote, only when flagged
│  Rest after: 3:00 ›                    │ resolved preset, tap to edit
│  (coach slot: empty when idle)         │ coach-adjustments §2.1
│                                        │
│ ✓ 1  100 kg × 8   RPE 8                │ done sets for this exercise
│ ▶ 2  now                               │
│ ○ 3  Target 100 kg × 6–8               │
│ ○ 4  Target 100 kg × 6–8               │
│                                        │
│ Next exercise: Incline DB press        │
│ Target 30 kg each × 8–10               │
├────────────────────────────────────────┤
│ ┌──────┐ ┌───────────────────────────┐ │
│ │ 🎙   │ │     Log 100 kg × 8        │ │ action bar
│ │ Talk │ │                           │ │
│ └──────┘ └───────────────────────────┘ │
└────────────────────────────────────────┘
```

Notes:
- **Draft values.** The fields hold the draft *actual*, prefilled by `buildActiveSetView` (rules in §4.2). The line beneath the fields always says `Target …`. The Log button repeats exactly what will be saved.
- **The mini set list** under the fields shows this exercise's sets with the §7 status styles, so progress is visible without switching to Overview.
- **`Adjust`** (text button, `AdjustControl`) asks the coach to change today's remaining sets. It opens an inline reason-chip row, never a sheet. When the coach is unavailable it stays visible with the caption `Coach offline`. Full behaviour: [coach-adjustments.md](coach-adjustments.md) §2.2.
- **Coach-changed pending sets** read `Coach target 95 kg × 8` with the `Coach` tag and a `Plan was 100 kg × 6–8` line (coach-adjustments §2.7). Unchanged sets keep the plain `Target` label.
- **`PainFlagNote`** (consolidation): when the exercise has an active pain flag, one line sits directly under the target line: `⚠ Pain flag: no increases` (`exclamationmark.triangle` in `status.warning`, text `text.secondary`, `type.callout`). It is a 44pt target that opens that flag in Pain flags (coach-memory.md §2.1) as a sheet; Log stays one swipe away. It never blocks or changes Log, appears in Ready and Resting (under `Up next`'s target), and in Overview as a `⚠ Pain` text badge on the exercise header. In the condensed keypad layout (§2.2) it collapses to the `⚠` icon after the target, still read in full by VoiceOver: "Pain flag on this movement. Loads won't go up." It appears as soon as `setPainFlag` commits (e.g. `Adjust` → `Pain`) and disappears when the flag is cleared.

### 2.2 Focus view with the keypad open (editing load)

```
┌────────────────────────────────────────┐
│ ⌄  Push A          24:31     ⏸    ⋯   │
├────────────────────────────────────────┤
│ Bench press · Set 2 of 4               │ header condenses to one line
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │ ‖102.5 kg  │+ │ │− │   8   │+ │   │ focused field: 2pt accent
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │
├────────────────────────────────────────┤
│ ┌──────┐ ┌───────────────────────────┐ │
│ │ 🎙   │ │    Log 102.5 kg × 8       │ │ action bar sits ON the keypad
│ └──────┘ └───────────────────────────┘ │
├────────┬────────┬────────┬─────────────┤
│   1    │   2    │   3    │  ↓ 100      │
│   4    │   5    │   6    │  ↑ 105      │
│   7    │   8    │   9    │    ⌫        │
│   .    │   0    │  Hide  │   Next ›    │
└────────┴────────┴────────┴─────────────┘
```

### 2.3 Focus view, Resting

The rest timer takes the place of the previous-result line at the top of the card. The fields below it are the **next** set's draft. The full spec is in rest-state.md §2.

```
├────────────────────────────────────────┤
│ Bench press · Set 3 of 4 next  Adjust ⋯│
│ ┌────────────────────────────────────┐ │
│ │ Rest                               │ │
│ │              2:47                  │ │
│ │  [ −30 s ]   [ +30 s ]   [ Skip ]  │ │
│ └────────────────────────────────────┘ │
│ ✓ Set 2 saved: 100 kg × 6              │
│ Effort (optional)  6  7  8  9  [10]    │
│ That looked hard. Adjust remaining sets?│ coach slot: offer (only after a
│ RPE 10 on set 2                        │ deterministic trigger)
│ [ No thanks ]              [ Adjust ]  │
│ Up next · Set 3                        │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │
├────────────────────────────────────────┤
│ [ 🎙 ] [       Log 100 kg × 8        ] │
└────────────────────────────────────────┘
```

### 2.4 Overview view (table)

```
┌────────────────────────────────────────┐
│ ⌄  Push A          24:31     ⏸    ⋯   │
│ [⌂ Main Gym ▾] [🔈 Cues ▾] [Focus|All] │
├────────────────────────────────────────┤
│ Bench press · Barbell              ⋯   │
│  Set   Last        Target     Done     │
│ ✓ 1    100×8       100×6–8    100×8 ·8 │
│ ▶ 2    100×8       100×6–8   [100][ 8] │ active row: inline fields
│ ○ 3    100×7       100×6–8      —      │
│ ○ 4    95×8        97.5×8 C     —      │ C = coach target (text badge)
│  + Add set                             │
│                                        │
│ Incline DB press · kg each         ⋯   │
│ ○ W1   20×10       20×10        —      │
│ ○ 1    30×9        30×8–10      —      │
│ ○ 2    30×8        30×8–10      —      │
│  + Add set                             │
│ …                                      │
│                                        │
│          Finish workout                │ text button at end of list
├────────────────────────────────────────┤
│ ⏱ Rest 2:47     [−30] [+30] [Skip]    │ compact RestTimer (only resting)
│ [ 🎙 ] [  Log set 2 · 100 kg × 8     ] │
└────────────────────────────────────────┘
```

- Column headers show the unit once per exercise header (`kg`, `kg each`). Inside cells, `×` is used without spaces to save width. VoiceOver reads full values.
- At AX1 and larger, each set becomes a stacked block: line 1 is status and set number, line 2 is `Last 100 kg × 8`, line 3 is `Target 100 kg × 6–8`, and line 4 is `Done 100 kg × 8` or the fields.
- The Log label in Overview includes the set number (`Log set 2 · …`), because the active row may be off screen.
- A coach-changed target shows the `C` text badge after the value. VoiceOver: "Coach target, 97.5 kilograms, 8 reps. Plan was 95 kilograms, 8 to 10 reps." The exercise header row gets `Adjust` left of `⋯`, and the coach slot sits directly under the active exercise's header.

### 2.5 Voice strip (optional layer; `DEP-STT` / `DEP-AI`)

```
├────────────────────────────────────────┤
│ ● Mic on · Listening…        [ Stop ]  │ red dot + text
│ "one hundred kilos eight reps"         │ live transcript (if available)
├────────────────────────────────────────┤
│ [ ■ ] [       Log 100 kg × 8         ] │ Log still visible and usable
```
Strip states (full list and copy: voice.md §2.1 and §3.1, which own them):
- `Listening…`
- `Working out what you said…`
- `✓ Saved · Bench press set 2` / `100 kg × 8 (actual) · RPE 8` / `Heard: "…"` with [Undo] (the strip carries the Undo for voice logs; no separate toast, voice.md VO4)
- `115 kg or 150 kg?` [115 kg] [150 kg]
- `Didn't catch a number. Say it again or use the buttons.`
- `Voice isn't available: <reason>` [Settings]

The strip has a `Type instead` link that opens the coach sheet.

### 2.6 Superset (shown only when the routine has one)

```
│ Superset A · Round 2 of 3              │
│ A1 Cable row     ▶ now                 │
│ A2 Face pull     next · no rest        │
│ ...fields for A1...                    │
│ [ 🎙 ] [  Log 50 kg stack × 12 → A2  ] │
```
- Logging A1 moves straight to A2's fields. No rest starts, unless a transition is configured, in which case a short rest card shows `Move to A2 · 0:15`.
- Logging A2 (the last member) starts the round rest.
- Overview groups the members under a bracket labelled `Superset A`.

### 2.7 Timed exercise (shown only for duration exercises)

```
│ Dead hang · Set 1 of 3                 │
│ Last (1 Oct): 0:40                     │
│ Target 0:45                            │
│ ┌────────────────────────────────────┐ │
│ │ Work           0:45                │ │ separate work timer, not rest
│ └────────────────────────────────────┘ │
│ [ 🎙 ] [         Start 0:45          ] │
```
Sequence:
1. `Start 0:45` → Working: the countdown runs and the primary reads `Stop`.
2. At 0 there is a cue (`Time.`) and a haptic. The primary becomes `Log 0:45`, with the actual duration in an editable field.
3. Tapping `Stop` early gives `Log 0:38`.
4. Logging starts rest as normal.

With the opt-in `Auto-save timed sets` setting (off by default), the result is saved at 0 with an undo toast. The setting's explanation reads: `When a work timer ends, save the planned time as done. You can undo.`

While the work timer runs or is paused, Finish, Delete set and Skip exercise (for this exercise) are refused by the domain (`work_interval_running`). The UI shows why and offers [Stop] (see §4.8). A Stop tapped just after the timer reached 0 simply shows `Log 0:45`; it is never an error.

### 2.8 Paused

```
│ ⌄  Push A        ⏸ 24:31 Paused    ⋯  │ elapsed frozen, warning colour + text
├────────────────────────────────────────┤
│ ⏸ Workout paused. Timers are stopped.  │ warning banner
│ ... card shows rest frozen at 1:10 ... │
├────────────────────────────────────────┤
│ [ 🎙 ] [           Resume            ] │
```

### 2.9 Unilateral exercise (shown only when the exercise's `laterality` is `unilateral`)

Interim model (ADR 0003 M5): every unilateral set has a side. The default is `Both sides`, meaning the values were done on each side. Ben can log a set as Left or Right instead when the sides differ. Bilateral exercises never show any of this.

```
│ Single-arm cable row · Set 2 of 3      │
│ Cable · Working · per side             │
│ Last (1 Oct): 25 kg stack × 10 per side│
│  Stack                   Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  25 kg     │+ │ │− │  10   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 25 kg stack · 8–10 reps per side│
│  Side [ Both sides | Left | Right ]    │ segmented, 44pt, Both preselected
│  Rest after: 1:30 ›                    │
├────────────────────────────────────────┤
│ [🎙] [ Log 25 kg stack × 10 per side ] │
```
- **Both sides (default):** one tap logs, exactly like a bilateral set. Label `Log 25 kg stack × 10 per side`. Saved with `side: both`.
- **Left or Right:** the segment changes only this set's side. Label `Log Left · 25 kg stack × 10`. Saved with `side: left` / `right` via `log_set.side`.
- **The other side:** logging a prescribed set as Left (or Right) makes the domain add a pending other-side set in the same commit (`pairedWithSetId` = the logged set, same planned values and rest, the logged values as its draft, no effort). It is done straight after its paired set (in a superset, as part of that set's round) and becomes the next active set. After the pair, the order carries on normally (e.g. Left → Right → set 3), so the rest card's `Up next` already shows it. The just-saved line reads `✓ Set 2 saved (left): 25 kg stack × 10` with a link `Log right side ›`. The domain has already added the right side as a pending set (same values drafted) and made it active; the link just scrolls to it. Undo of the left log removes it. Rest keeps running; logging the right side ends it early as usual (P2).
  - The other-side set accepts only its own side: its Side control shows the fixed side (`Right side`) instead of the three segments, and the Log label reads `Log Right · 25 kg stack × 10`.
  - Undo of the single-side log, or deleting that logged set, removes the still-pending partner too (audited). Undo also puts the set's side back to what it was (normally `Both sides`). Deleting only the partner is allowed (e.g. one side injured), with the usual confirmation.
  - The exercise isn't done until each prescribed set has both sides (or a `Both sides` result). Left, Left, Left on three sets leaves three right-side sets pending.
  - Changing a done set's side in the correction sheet doesn't add or remove partner sets (ADR 0003 Open).
- **Lists:** Left/right sets carry an `L` or `R` text badge next to the set number (as set-type badges, design-system §7). `Both` sets have no badge; the exercise header says `per side` once.
- **Correction:** the correction sheet has the same Side control (`correctSet` patch `side`).
- **Volume:** a `Both sides` set counts once with its per-side reps. A Left + Right pair counts as one set using the busier side, never the sum (`summariseVolume`).
- **Progression:** progression evaluates each side; a Left + Right pair is one prescribed set; if the sides differ, `Next time` holds and names the lagging side (workout-summary §3).

### 2.10 Empty workout (phase `empty`)

Shown when the workout has no live sets: started with `Empty workout`, or every set deleted.

```
├────────────────────────────────────────┤
│                                        │
│ Add an exercise to start               │
│ Pick from your exercises. Sets, rest   │
│ and targets come from your history.    │
│                                        │
├────────────────────────────────────────┤
│ [ 🎙 ] [        Add exercise         ] │
└────────────────────────────────────────┘
```
- `Add exercise` opens the exercise picker sheet (search field focused, recent exercises first). Choosing one calls `addExercise`, which adds the exercise with one empty working set and makes it active. The card then shows §2.1 with draft source `last_session` (`From 1 Oct`) or empty fields and the primary `Enter load` / `Enter reps`.
- After that, `Add set` (exercise `⋯`, or `+ Add set` in Overview) adds the next set, copying the last set's values and rest. `+ Add exercise` sits at the end of the Overview list.
- `Finish workout` stays in the `⋯` menu. Finishing an empty workout offers discard instead (§4.8).
- Voice (when available): "add bench press" goes through the same `addExercise` service call.

### 2.11 Planned load dropped (`target_dropped`)

When the template's load can't be honoured on this gym's equipment (ADR 0003 B1), the domain sets no load target and raises a `target_dropped` warning that keeps the template value. The card never shows a converted guess.

```
│ Incline DB press · Set 1 of 3          │
│ Last (1 Oct): 30 kg each × 9           │
│  Load each               Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  30 kg     │+ │ │− │  10   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  From 1 Oct                            │ draft source caption
│  Target 8–10 reps · no load target     │
│  ⚠ Plan says 60 kg total. These are    │ status.warning icon + text
│    dumbbells (kg each), so it isn't    │
│    converted.                          │
```
- The warning sits under the target line on every affected set (one per template set), in `status.warning` with `exclamationmark.triangle` and text. It is not a banner, and it doesn't block Log.
- The draft falls back to this session's last set, then last session (same unit and convention only), then empty. With nothing to fall back on, the load field is empty and the primary reads `Enter load`.
- Overview: the Target cell shows `—×8–10` plus the `⚠` icon; VoiceOver reads `No load target. Plan says 60 kilograms total, not converted.`
- [Update gym] appears only for `no_achievable_loads`. The routine itself is fixed outside the workout.
- **No feasible load from progression (`no_feasible_load`):** when the equipment can't make any load, the rules set no load (`loadFeasibility: 'infeasible'`). The target line reads `Target 8–10 reps · no load target` with the warning `<Equipment> can't make any load with its current min/max settings. Fix the equipment profile.` and [Update gym]. It is never shown as `BW` or "bodyweight"; that wording is only for the `bodyweight` convention (or `added` with nothing added).

## 3. States

| State | Content | Primary | Notes |
|---|---|---|---|
| Loading | `buildActiveSetView` is local and should take < 100 ms. If it takes > 300 ms, the card shows static placeholders | Disabled `Log set` | No shimmer |
| Ready | §2.1 | `Log 100 kg × 8` | — |
| Ready, values incomplete | A field is empty (e.g. an empty workout with no history) | Disabled `Enter reps` / `Enter load` | The empty field gets focus and opens the keypad |
| Ready, equipment warning | The typed load isn't achievable on the selected equipment (§4.3) | Still `Log 37.5 kg each × 8` | Warning under the field. Logging is allowed because the *actual* is what Ben lifted |
| Working (timed) | §2.7 | `Stop` | — |
| Result saved | Guard for 1 s | `Saved` (done style) | Undo toast |
| Resting | §2.3 | `Log` for the next set | See rest-state.md |
| Ready, rest ended | Rest card shows `Ready when you are` + `Rested 3:12` | `Log …` | — |
| Final set ready | Normal | `Log …` | The next line reads `Last set of the workout` |
| Empty workout (phase `empty`) | §2.10: `Add an exercise to start` | `Add exercise` | Not `All planned sets done`. Also reached if every set is deleted |
| Ready, planned load dropped | §2.11: `Target 8–10 reps · no load target` + warning | `Log …` from the fallback draft, or `Enter load` | Never a converted or unchecked number |
| Ready, unilateral | §2.9: Side control under the target | `Log 25 kg stack × 10 per side` / `Log Left · …` | Hidden for bilateral exercises |
| All sets done | Card: `All planned sets done.` + links `Add set` / `Add exercise` | `Finish workout` | No rest after the final set. An empty workout shows `Add an exercise to start` (phase `empty`), not `All planned sets done` |
| Finish blocked by work timer | Finish sheet shows `Stop the timer first` (§4.8) | [Stop] in the sheet | Domain error `work_interval_running` is never shown raw |
| Paused | §2.8 | `Resume` | Log is hidden until Resume. Fields stay editable |
| Restored after force-close | Normal + banner `Workout restored. Nothing was lost.` (4 s) | per state | See flow §4.2 |
| Offline | No change to logging | per state | Status row: no banner unless Ben opens the coach. The Talk button shows `Offline` if the coach needs the network |
| AI unavailable | No change to logging | per state | Talk button `Offline` / `Ask`. Coach sheet explains (§4.7) |
| Voice unavailable, text available | — | — | Talk button shows `Ask` (text bubble). Tapping opens the coach sheet |
| Coach offer | Coach slot: `That looked hard. Adjust remaining sets?` [No thanks] [Adjust] (Resting only, after a deterministic trigger) | unchanged | Nothing changes until `Adjust`. Never a modal; never spoken outside Resting. coach-adjustments §2.3 |
| Check-in offer (2026-10-09) | First set card, Ready, no set logged yet: coach slot `Want a lighter session today?` · `You said 2 of 5 · Tired, Poor sleep` [No thanks] [Adjust] | unchanged | Stays through the first exercise until answered or replaced by a set offer; never spoken. check-in.md §4.4 |
| Check-in, coach offline (2026-10-09) | Coach slot: `Check-in saved. Coach offline, so today's plan is unchanged.` | unchanged | Hides on the first Log. No line when the coach isn't connected at all |
| Check-in sheet over the workout (2026-10-09) | Resume or auto-open of a session with no set ever committed and `checkIn: pending` | Behind the sheet | Shown once; `Skip` or swipe-down returns to this screen. Never after a set has been committed. check-in.md §3 |
| Coach working | Coach slot: `Coach is working on sets 3–4 · Nothing has changed yet.` [Cancel] | unchanged, usable | Rest keeps running. A Log first wins; the result is re-sent once or dropped, never applied to a done set (coach-adjustments §4.3) |
| Coach adjusted (Ben asked or accepted an offer) | Coach slot: `CoachAdjustmentBanner` `Coach adjusted sets 3–4` · `100 → 95 kg × 8 · <reason>` [Undo]; changed sets show `Coach target` | `Log <new values>`, guarded 1 s if the label changed | Applied at once. Guard notes (rounded, capped, pain) shown in the banner |
| Coach blocked / no change / failed / timed out | Coach slot: one outcome line, e.g. `Not increasing: you flagged shoulder pain. Sets unchanged.` | unchanged | No Undo, because nothing changed |
| Coach offline (Adjust tapped) | `Coach offline. Your sets are unchanged. Change the next set's numbers directly.` + `Pain` chip | unchanged | No offers appear while offline |
| Coach proposal pending (swap or gym) | `ChangeReviewCard` inline under the rest timer (Focus) or under the active exercise (Overview) | unchanged | Swaps and gym changes still need Apply (coach-adjustments CA2). It never takes over the screen |
| Proposal stale | The card shows `Out of date` | unchanged | Apply is disabled |
| Gym switched mid-session | `ChangeReviewCard` from `setActiveGym`: `Main Gym → Hotel Gym · Today only` with pending-set changes | unchanged | Completed sets aren't listed and don't change |
| Write error | `Couldn't save this set. Your entry is still here.` [Try again] | `Log …` stays available with the same opId | Extremely rare: SQLite full or locked |

## 4. Interactions

### 4.1 Logging (the core loop)
- **Tap `Log …`.**
  1. `commitSetAndBeginRest({sessionId, setId, values, opId})` runs.
  2. On success:
     - `haptic.commit`
     - the button shows `Saved` for 1 s
     - the undo toast `✓ Set 2 saved · 100 kg × 8` appears
     - the card switches to Resting (or the next superset member, or Final)
     - the commit cue plays, if cue mode is on
- **Matching set:** one tap, nothing else. A coach trigger check (`evaluateCoachTrigger`) runs after the commit, is local, and never delays or blocks the Log.
- **Label changed by a coach adjustment:** if an applied adjustment changes the active set's Log label, Log ignores taps for `timing.valueChangeGuard` (1 s) so a tap aimed at the old values can't save the new ones. Normal logging never has this delay.
- **Different result, reps:** tap `−` on reps (once per missing rep), then Log. Two taps for a single-rep miss.
- **Different result, load:** tap `−`/`+` to the next feasible load, or tap the load field to use the keypad. Typing replaces the value, `Next ›` moves to reps, and `Done` hides the keypad. Log stays visible above the keypad the whole time.
- **Copy last time:** tap the `Last (1 Oct): 100 kg × 8` line. The fields are set to those values and the caption reads `Copied from 1 Oct`. That line never logs anything itself.
- **Keyboard shortcuts:** Return on reps acts as `Done`. Cmd+Return logs.
- **Voice:** see §2.5 and flow §5.1. "Done" or "log it" logs the displayed values only if Ben has enabled the shortcut (Voice & alerts → `Say "done" to log shown values`, off by default) and there is exactly one active set.

### 4.2 Draft prefill rules (deterministic, done by `buildActiveSetView`)

Rules, in order:
1. If a draft was saved for this set (edited earlier or restored after a force-close), use the draft.
2. If the set has a target load, use it for load. For reps, use the single target, or the **top** of a target range (the double-progression aim).
3. If there's no target (empty workout, or the planned load was dropped, §2.11), use the last logged set of this exercise in this session.
4. If there's still nothing, use the last comparable session's matching set from `getComparableHistory`. History in another unit or convention is never used (`prefillDraft` refuses it).
5. Otherwise leave the field empty, and Log is disabled.

The view returns `draftSource` (`draft | target | this_session | last_session | none`). If the source isn't the target, a caption under the fields shows it: `From your last set` / `From 1 Oct`.

### 4.3 Equipment-aware input
- The steppers move through `getAchievableLoads(equipmentId)`, so `+` on 100 kg barbell goes to the next achievable total, such as 102.5 kg.
- At the maximum, `+` is disabled and its hint says `Rack maximum 30 kg each`. The targets themselves are never above the maximum, which is the domain's job.
- Typed loads that aren't achievable show a warning under the field: `37.5 kg each isn't on Main Gym's dumbbell rack (max 30 kg). Log it anyway if that's what you lifted, or update the gym.` with an [Update gym] link. Log still works, and the set is saved with an `off_profile_load` flag.
- Assisted machines: the field label reads `Assist`. The `+` hint reads `More assistance (easier)`.

### 4.4 Set and exercise controls
- **Exercise header tap** opens the history sheet: comparable history from `getComparableHistory` and technique or setup notes.
- **Exercise `⋯` menu:**
  - `How to` (revision 2026-10-09, built for ADR 0013; provisional, confirm on device). This is the **first** item, shown only when the exercise has a guide or rich cues (`howToKeyForExerciseId`), and absent otherwise. It opens the How to modal (exercise-library.md §8) over the workout. The rest timer and alerts carry on underneath, and closing it returns to the same set, draft and Log label. It is first because the action sheet is anchored to the bottom: an item added at the top leaves every other item the same distance from the thumb.
  - `Add set` calls `addSet` (`add_set`). The new set copies the last set's planned values and rest. Toast `Set 4 added`. If nothing else is active, it becomes the active set.
  - `Swap exercise` (→ the Swap sheet in exercise-library.md §2.5 → `ChangeReviewCard` with scope `Today only`). If Ben approves exercise-library EL4, a swap he picks himself applies at once with Undo (`SwapSlotLine`) instead; coach-suggested swaps keep the card either way.
  - `Machine busy` (calls `setTemporaryAvailability`).
  - `Notes`.
  - `Skip exercise` (`skip_exercise`) marks the pending sets skipped; logged sets are untouched. It confirms first because there is no Undo yet: `Skip the 2 remaining sets of Bench press?` [Skip] [Cancel]. Toast `Bench press skipped` (no Undo). Skipped rows stay visible with the Skipped style; `Add set` brings the exercise back.
- **Add exercise:** `+ Add exercise` at the end of the Overview list, and on the All-done and Empty cards. Opens the exercise picker → `addExercise`.
- **Tap a pending set** (mini list or Overview) to make it the active set (`setActiveSet`). The draft and the Log label update.
- **Tap a done set** to open the correction sheet:

```
┌────────────────────────────────────────┐
│ Edit set 1 · Bench press        Cancel │
│ Done at 18:14                          │
│ [− 100 kg +]   [− 8 +]   RPE [8]       │
│ Set type: Working ▾                    │
│ ┌────────────────────────────────────┐ │
│ │            Save changes            │ │
│ └────────────────────────────────────┘ │
│ Delete set                             │ danger text, separated
└────────────────────────────────────────┘
```
  - `Save changes` calls `correctSet(setId, patch, expectedVersion)`. The row gets an `Edited` tag. Rest is not touched. A correction never calls the coach and never changes other targets by itself. If the corrected effort or reps meet a trigger, the deterministic check may show a coach **offer** (no AI call until Ben taps `Adjust`).
  - `Delete set` calls `deleteSet` (`delete_set`, guarded on the set's version). It always confirms: `Delete set 1? It's removed from this workout's totals and history. The edit log keeps a record.` [Delete] [Cancel]. Toast `Set 1 deleted` (no Undo yet; ADR 0003 Open). The set is kept as an audited deleted record and disappears from the mini list, Overview and volume. Pending sets can be deleted the same way from their row's `⋯` in Overview.
  - The sheet also shows the Side control for unilateral exercises (§2.9).

### 4.5 View toggle
- `Focus | All` segmented control. The choice is remembered per device. Switching keeps the active set, the drafts and the timer.
- Swipe gestures aren't used to switch views, so they can't be triggered by accident with sweaty hands.

### 4.6 Top bar
- `⌄` minimises to Today. The workout keeps running, and a mini bar on Today (the Resume card) shows its state.
- `⏸` calls `pauseSession`. The `Resume` primary calls `resumeSession`.
- `⋯` menu items:
  - `Finish workout`
  - `Rest presets`
  - `Voice & alerts`
  - `Edit workout times` opens a small sheet: `Started at [18:02 ▾]` [Save]. It calls `updateSessionTiming(sessionId, expectedVersion, {startedAt})`. The end time can only be changed after Finish (finish sheet or summary Edit). The start can't move later than the first logged set or into the future; the picker limits it.
  - `Discard workout` (destructive; red text) calls `discardWorkout` (`discard`). It also cancels a running rest or work timer. With ≥1 logged set it confirms first (§4.9).

### 4.7 Coach and Talk
- **Tap Talk when voice is available:** this calls `startVoiceSession`, and the voice strip appears. Tap again (or `Stop`) to end listening. Speaking is interrupted with the same button (`interruptSpeech`).
- **Long-press Talk, or `Type instead`:** opens the coach sheet at medium detent with the active-session context. Ben swipes the sheet down to get back to Log. The sheet never opens on its own.
- **Tap Talk when the coach is unavailable:** the sheet shows the honest status and nothing more (`getAiCapabilities` reason), for example:
  - `Coach not connected. Logging, targets and rest timers work without it.` [Connect in Profile]
  - `No connection. The coach needs the internet; your workout is saved on this phone.`
  - `Voice isn't available on this phone yet. You can type to the coach.`
- **Adjusting today's remaining sets** (coach-led progression, ADR 0006) is specified in [coach-adjustments.md](coach-adjustments.md):
  - Ben asks (voice "that was a grind", coach-sheet text, or `Adjust` → reason chip): the result applies at once and shows the `CoachAdjustmentBanner` with Undo in the coach slot.
  - A deterministic trigger fires (RPE ≥ 9.5, reps short by ≥ 2, RPE ≤ 6 on a working set): a one-line offer in the rest card. Nothing changes until Ben taps `Adjust`.
  - The coach sheet never opens by itself, and an adjustment never opens a sheet.
  - (2026-10-09) A low pre-workout check-in may put a lighter-session offer in the first set card's coach slot before any set is logged ([check-in.md](check-in.md) §4.4). `Adjust` calls `requestCoachAdjustment(…, {origin: 'check_in_offer', checkInId, intent: 'lighter_session'}, …)`; the validator drops any increase. Everything after that (pending, banner, Undo, CA7) is the normal path.
- **Other coach suggestions** (exercise swaps, gym changes) still appear only as an inline `ChangeReviewCard`. `Apply` calls `confirmProposal(proposalId, sessionVersion)` → `applyCoachProposal`, followed by a toast `Remaining sets updated for today` [Undo], and the cue `Remaining sets updated for today.`

### 4.8 Finish
- **Triggers:** `Finish workout` from the menu, or the primary once all sets are done. This opens the finish sheet:

```
┌────────────────────────────────────────┐
│ Finish workout?                        │
│ 16 of 18 sets done. 2 not done will be │
│ marked skipped.                        │
│ Ended at  [ 19:04 (now) ▾ ]            │
│ ┌────────────────────────────────────┐ │
│ │              Finish                │ │
│ └────────────────────────────────────┘ │
│ Keep going                             │
└────────────────────────────────────────┘
```
- If the last set was more than 20 min ago, the end time defaults to `19:24 (last set + 3 min)`, with `Use now (20:41)` as the alternative. The picker allows only times between the last logged set and now.
- The chosen time is passed to `finishWorkout` in the same transaction. When it differs from the tap time, the tap time is kept in the timing audit.
- If a work timer is running, the finish sheet shows `Stop the timer first` with a [Stop] action instead of Finish:

```
┌────────────────────────────────────────┐
│ Finish workout?                        │
│ ⏱ Dead hang timer is running (0:38).   │
│ Stop the timer first                   │
│ ┌────────────────────────────────────┐ │
│ │               Stop                 │ │
│ └────────────────────────────────────┘ │
│ Keep going                             │
└────────────────────────────────────────┘
```
  [Stop] calls `stop_work_interval`; the sheet then shows the normal Finish content with an extra line `Dead hang: 0:38 not logged. It will be kept as a draft on the skipped set.` and a secondary `Log 0:38 first` link (which closes the sheet and logs). `Finish` then proceeds as normal. The same applies when the work timer is paused. Stop also works while the workout is paused: the interval ends at the moment the pause began (paused time never counts as work), and the workout stays paused. Finish then proceeds without a Resume.
- With no logged sets, the sheet reads `Nothing logged yet.` with primary `Discard workout` and a secondary `Finish anyway` (saves an empty workout).
- `Finish` calls `finishWorkout(sessionId, expectedVersion, endedAt)` → `cancelObsoleteCues` → Summary.

### 4.9 Undo paths (summary)

| Action | Undo |
|---|---|
| Log set | Toast `Undo` (8 s). Guarded on the set's own version (`expectedSetVersion`) and on it still being the latest commit by commit order, so an effort-chip tap during rest doesn't block it. For a single-side log it also removes the pending other-side set (§2.9). After that: the done row → Delete set |
| Correction | Not yet (ADR 0003 Open). Correct it again; the edit history keeps every version |
| Delete set | Not yet (ADR 0003 Open), so it always confirms. The deleted record is kept, so Undo can be added later |
| Skip exercise | Not yet (ADR 0003 Open), so it confirms. `Add set` brings the exercise back |
| Applied proposal (swap, gym) | Toast `Undo` → `undoAction` (or a compensating proposal if it isn't safe) |
| Coach adjustment | `Undo` on the banner; later, `Why?` on a coach-marked set → `Undo this change`, or exercise `⋯` → `Undo coach change`. `undoAction` restores only sets still pending (coach-adjustments §4.4) |
| Pain flag | Undo on the pain card or toast (8 s); after that, tap `Pain` again or the `PainFlagNote`, which opens Pain flags → `Clear…` → confirm (coach-memory.md §2.7). Never cleared automatically |
| Discard workout (0 sets) | Discards at once. Toast `Workout discarded` (no Undo: nothing was logged; start again from Today) |
| Discard workout (≥1 set) | Confirmation alert first: `Discard Push A? 7 logged sets will be discarded.` [Discard] [Cancel]. No undo afterwards, which is why the confirmation is needed |

If an Undo is rejected (the set was corrected from another path, or something was logged after it), the toast changes to `Can't undo: set 2 changed. Tap it to edit or delete.` Nothing is removed.

## 5. Copy

| Element | Text |
|---|---|
| Header line 2 | `Barbell · Working · Set 2 of 4` (set types: `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop set`) |
| Previous | `Last (1 Oct): 100 kg × 8`. This is an **actual** from history. If the gym or machine differs: `Last (1 Oct, Hotel Gym): …`. If none: `No previous result` |
| Field labels | `Load` (or `Load each`, `Stack`, `Assist`, `Added`), `Reps`, `Time` |
| Target line | `Target 100 kg · 6–8 reps` / `Target 30 kg each · 8–10 reps` / `Target 0:45` |
| Pain flag note | `Pain flag: no increases` (Overview header badge `⚠ Pain`; VoiceOver "Pain flag on this movement. Loads won't go up.") |
| Rest line | `Rest after: 3:00 ›` |
| Primary | `Log 100 kg × 8` · `Log 22.5 kg each × 10` · `Log Assist 20 kg × 6` · `Log BW × 12` · `Log 0:45` · `Start 0:45` · `Stop` · `Saved` · `Resume` · `Finish workout` · `Enter reps` |
| Undo toast | `✓ Set 2 saved · 100 kg × 8` [Undo] |
| Next | `Next exercise: Incline DB press` + `Target 30 kg each × 8–10` / `Last set of the workout` |
| Draft caption | `From your last set` · `From 1 Oct` · `Copied from 1 Oct` · `Unsaved edit restored` |
| All done | `All planned sets done.` |
| Empty workout | `Add an exercise to start` · `Pick from your exercises. Sets, rest and targets come from your history.` · primary `Add exercise` |
| Side control (unilateral only) | `Side` · `Both sides` · `Left` · `Right`; Log `Log 25 kg stack × 10 per side` / `Log Left · 25 kg stack × 10`; link `Log right side ›` / `Log left side ›`; badges `L` / `R` |
| Dropped target | Target line `Target 8–10 reps · no load target`. Warning by reason: `convention_mismatch` → `Plan says 60 kg total. These are dumbbells (kg each), so it isn't converted.`; `unit_not_convertible` → `Plan says 225 lb. No equipment here to check it in kg, so it isn't converted.`; `no_achievable_loads` → `Plan says 40 kg stack, but Cable stack at Hotel Gym can't make any load as set up.` [Update gym] |
| No feasible load (`no_feasible_load`) | Target line `Target 8–10 reps · no load target`; warning `<Equipment> can't make any load with its current min/max settings. Fix the equipment profile.` [Update gym]. Never `BW` |
| Other-side set (unilateral) | Side shows `Right side` (fixed); Log `Log Right · 25 kg stack × 10` |
| Add / delete / skip | Toasts `Set 4 added` · `Set 1 deleted` · `Bench press skipped` · `Workout discarded`. Confirms as in §4.4 and §4.9 |
| Finish blocked | `Dead hang timer is running (0:38).` · `Stop the timer first` · [Stop] · after Stop: `Dead hang: 0:38 not logged. It will be kept as a draft on the skipped set.` · `Log 0:38 first` |
| Undo rejected | `Can't undo: set 2 changed. Tap it to edit or delete.` |
| Banners | `Workout restored. Nothing was lost.` · `Workout paused. Timers are stopped.` · `Couldn't save this set. Your entry is still here.` |
| Coach target (pending sets) | `Coach target 95 kg × 8` + `Plan was 100 kg × 6–8` (both **targets**); Overview badge `C`; draft kept: `Your edit kept · Coach target 95 kg × 8` |
| Adjust | `Adjust` · caption `Coach offline` · chips `What should change?` `Too hard` `Too easy` `Pain` `Type…`. Every other coach-adjustment string: coach-adjustments §5 |
| Talk captions | `Talk` · `Ask` · `Stop` · `Wait` · `Offline` |
| Voice pill | `Quiet` · `Cues` · `Talk` · `Mic on` |

Spoken cues (cue mode `Set cues` or `Conversation`; full table in rest-state.md §5):
- Set intro (optional, off by default): "Bench press. Set 2: 100 kilos, target 6 to 8 reps."
- On commit: "Logged 100 kilos for 8. Rest 3 minutes." (actual result + rest)
- Superset member: "Logged 50 on the stack for 12. Face pull next."
- Timed end: "Time."
- Final set: "Logged 100 kilos for 8. That was the last set."

## 6. Data needed

- `getActiveSession(userId)` and `buildActiveSetView(sessionId)`. The view returns the exercise, set index/count/type, `previous` (from `getComparableHistory`, with date and gym/equipment identity), `target`, `draft` + `draftSource`, `restAfter` (from `resolveRestPreset`), `next`, `timer` (rest or work, with deadline and version), `sessionVersion`, the equipment's `loadConvention`, unit and feasible neighbours (`getAchievableLoads` / `roundToAvailableLoad`).
- `commitSetAndBeginRest(command)` handles Log.
- `correctSet(setId, patch, expectedVersion)` handles corrections and RPE.
- `undoAction(actionId)` handles undo (for a logged set: `undo_log` with `expectedSetVersion`).
- `pauseSession` / `resumeSession`.
- `startWorkInterval(setId, duration)` and `stop_work_interval` for timed exercises.
- `finishWorkout(sessionId, expectedVersion, endedAt?)`, `updateSessionTiming(sessionId, expectedVersion, {startedAt?, endedAt?})` (end time only after Finish).
- `addSet` (`add_set`), `addExercise` (service call that builds the catalogue snapshot), `deleteSet` (`delete_set`), `skipExercise` (`skip_exercise`), `discardWorkout` (`discard`).
- From `buildActiveSetView`: `phase` (including `empty`), the exercise's `laterality`, each set's `side` and `pairedWithSetId` (other-side sets accept only their own side), the target's `loadFeasibility`, and any `target_dropped` warning (`requested` load and `reason`) for the active and pending sets.
- `setActiveGym`, `setTemporaryAvailability`, `rankSubstitutions`, `getEquipmentSnapshot`.
- `buildSetCue`, `scheduleTimerCue`, `cancelObsoleteCues` (cue layer).
- Optional layers:
  - `getAiCapabilities`
  - `startVoiceSession`, `stopVoiceSession`, `transcribeUtterance`, `parseSpokenSet`, `handleVoiceTurn`, `interruptSpeech`
  - `runCoachTurn`
  - `validateCoachProposal`, `confirmProposal`, `applyCoachProposal`, `getDecisionEvidence`
  - Coach adjustments (coach-adjustments §6): from `buildActiveSetView`, per set `target.source` (`plan | rule | coach`), `target.planned` and `adjustmentActionId`, and per session `coachRequest`, `coachOffer`, `lastAdjustment`; plus `evaluateCoachTrigger`, `recordTriggerResponse`, `requestCoachAdjustment`, `cancelCoachTurn`, `setPainFlag` (proposed new)
- Proposed new: `saveSetDraft`, `setActiveSet`, `endRestTimer`.
- Check-in (2026-10-09, check-in.md §6): `buildActiveSetView` adds `session.checkIn` (`answered` / `skipped` / `not_asked` / `pending`) and `coachOffer.kind: 'check_in_low'` with its fact; `setSessionCheckIn` (Resume case), `evaluateCheckInOffer`, `recordTriggerResponse`.

## 7. Acceptance checks

1. A set whose prefilled values match what Ben did is logged in **one tap**, with no dialog, no RPE prompt in the way and no network.
2. A one-rep miss is logged in **two taps** (reps `−`, then Log).
3. With the keypad open on either field, the Log button is fully visible and tappable on a 375pt-wide screen at the default size and at AX3.
4. The Log label always matches exactly what is saved: unit, convention suffix and values. Compare the label with the saved row for 10 sets, including dumbbell (`each`), stack and assisted sets.
5. The load stepper never steps to a load the selected equipment can't make. At the rack maximum, `+` is disabled with a reason.
6. Typing an off-profile load shows the warning, still allows logging, and the saved set carries the flag.
7. Targets are always labelled `Target`, and previous results `Last (date)`. No pending set displays values without the `Target` label or pending style.
8. Each set status (done, active, pending, skipped) can be told apart in greyscale (check icon, triangle, hollow circle, slashed circle, plus text).
9. Correcting a done set doesn't restart or change rest, adds the `Edited` tag, and doesn't trigger any AI call (at most a deterministic offer line appears).
10. Switching Focus ↔ Overview while resting keeps the same timer, draft values and active set.
11. In a superset, logging A1 doesn't start rest, and logging A2 does.
12. A timed exercise's work timer runs separately from rest. Its end doesn't save the set unless `Auto-save timed sets` is on.
13. While paused, the elapsed clock and any timer are frozen, the primary reads `Resume`, and Log can't be triggered.
14. Finish is never next to Log. It is only in the `⋯` menu, at the end of the Overview list, or the primary once all sets are done.
15. With AI disconnected, tapping Talk shows an honest status sheet with no fake coach reply, and the workout is unaffected.
16. A coach swap or gym proposal never opens a sheet by itself. It appears inline with scope, before/after targets, Apply and an Undo path, and it can't change completed sets.
17. Switching gym mid-session shows a review card for pending sets only. Completed sets keep their original gym and equipment.
18. Log → tap effort `8` → `Undo` within 8 s removes the set.
19. With a work timer running or paused, `Finish workout` shows `Stop the timer first` and [Stop], never a raw error. After Stop and Finish without logging, the timed set is skipped and still shows the stopped time as its draft in Edit workout.
20. The finish sheet's end-time picker can't choose a time before the last logged set or after now. A chosen time other than now shows `(end time edited)` on the summary.
21. An empty workout shows `Add an exercise to start` and primary `Add exercise`. Deleting every set of a workout returns to the same state.
22. Delete set and Skip exercise always confirm and never offer an Undo they can't perform. A deleted set disappears from the lists and totals.
23. The Side control appears only for unilateral exercises. `Both sides` logs in one tap; Left logs `side: left`, and the next active set is a pending right-side set with the same values drafted; `Log right side ›` only scrolls to it (no `addSet` call). That set can only be logged as Right. Undo of the Left log removes both the Left result and the pending right-side set. Volume counts a Left + Right pair as one set.
25. An exercise whose equipment can make no load shows `no load target` and `Fix the equipment profile` guidance with [Update gym], never `BW` or "bodyweight".
24. A template load in another convention (e.g. `60 kg total` on a dumbbell rack) shows `no load target` and the warning, never a converted number; Log still works with the fallback draft or `Enter load`.
26. With the coach connected, a full workout of matching sets with no triggers takes exactly as many taps as with the coach off. `Adjust` is the only visible coach control.
27. `Adjust` sits in the exercise header in both Ready and Resting, has a 52pt hit area, opens an inline chip row (no sheet), and with the coach offline stays visible with `Coach offline`.
28. Saying "that was a grind" during rest changes sets 3–4 at once, shows `Coach adjusted sets 3–4: 100 → 95 kg × 8 · <reason>` with Undo, updates the Log label, and leaves the rest countdown unchanged. Undo restores `Target 100 kg · 6–8 reps`.
29. A coach offer appears only in the rest card, after RPE ≥ 9.5, reps short by ≥ 2, or RPE ≤ 6 on a working set, and changes nothing until `Adjust` is tapped.
30. Coach-changed pending sets show `Coach target` + `Plan was …` (Focus) and `C` (Overview); done sets show only actual values; VoiceOver reads both target values.
31. When an adjustment changes the active set's Log label, a Log tap within 1 s is ignored; at all other times Log responds at once.
32. With a pain flag on Bench press, its set card shows `⚠ Pain flag: no increases` under the target in Ready and Resting, Overview shows `⚠ Pain` on the header, tapping it opens that flag, and Log behaves exactly as without it. Setting the flag with `Adjust` → `Pain` makes the note appear at once; clearing it removes the note.
33. (2026-10-09) After a check-in of 2 with the coach connected, the first set card shows the check-in offer in its coach slot; `Log` is visible and logs in one tap with the offer still on screen. No AI call is made until `Adjust`.
34. (2026-10-09) Once any set has been committed in a session, nothing on this screen (Resume, relaunch, voice) shows the check-in sheet.
35. (2026-10-09) Note for check 29: the only coach offer outside the rest card is the check-in offer before the first set; it is never spoken.
The full coach-adjustment checks are in [coach-adjustments.md](coach-adjustments.md) §7.
