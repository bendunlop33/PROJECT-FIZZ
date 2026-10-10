# Active workout (focused set card and Overview table)

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md): Finish refused while a work timer runs (§4.8, S4); end time passed to `finishWorkout(…, endedAt)` (S5); Undo guarded on the set's version and commit order (S1); new empty-workout state (§2.10); homes and copy for add set, add exercise, delete set, skip exercise and discard (§4.4, §4.9); per-side entry for unilateral exercises (§2.9); dropped planned load (`target_dropped`) on the set card (§2.11).
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": a Left/Right log makes the domain add a pending other-side set (`pairedWithSetId`) that becomes next and accepts only its own side; `Log right side ›` just scrolls to it, and Undo removes it (§2.9, §4.9). Progression now evaluates sides (§2.9). Stop works while paused (§4.8, S8). `no_feasible_load` shows `no load target` with `Fix the equipment profile`, never bodyweight (§2.11, §5).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Aligned with [ADR 0006](../decisions/0006-coach-led-progression.md) and rewritten rule 3. The behaviour itself is specified once in [coach-adjustments.md](coach-adjustments.md); this file only places it. Added the `Adjust` control in the exercise header (§2, §2.1), the coach slot in the focused card (§2.1, §2.3), `Coach target` / `Plan was` markers and the Overview `C` badge (§2.4, §5), the 1 s Log guard when an adjustment changes the Log label (§4.1), Ben-asked adjustments applying at once with Undo while swaps and gym changes keep the `ChangeReviewCard` (§3, §4.7), undo rows (§4.9), data (§6) and checks 26–31. The normal Log loop gains no taps.

> **Revision 2026-10-08 (consolidation).** Added `PainFlagNote` under the target line of any exercise with an active pain flag (§2.1, §5; design-system §9.50; coach-memory.md). The pain-flag undo path now points to the canonical Pain flags list (coach-memory.md §2.7). The voice strip (§2.5) is specified in voice.md; a voice-logged set carries its Undo in the strip instead of the undo toast (voice.md VO4). `Swap exercise` is pending Ben's call on exercise-library.md EL4 (§4.4). The banner slot follows system-states.md §2.2: nothing about backups, signing, builds, permissions or alert layers ever appears here.

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** Places [check-in.md](check-in.md) on this screen; behaviour is specified there. (1) The check-in normally happens on Today before the session exists, so this screen is unchanged for it. (2) **Resume / auto-open of a session with no set ever committed and an unanswered check-in** shows the `CheckInSheet` over this screen once; after any set is committed it never appears (never mid-workout). (3) After a check-in, the toast slot shows `✓ Check-in saved · 2 of 5` [Change]. (4) **Check-in offer:** with a low check-in and the coach reachable, the first set card's coach slot shows `Want a lighter session today?` / `You said 2 of 5 · …` [No thanks] [Adjust] **in Ready, before any set is logged** (an exception to "offers only while Resting", check-in.md CI5; never spoken). `Adjust` runs the normal Ben-accepted path for all of today's pending sets, with no increases allowed. Offline: one outcome line `Check-in saved. Coach offline, so today's plan is unchanged.` Changed: §3 (three rows), §4.7, §6, checks 33–35. The Log loop gains no taps.

> **Revision 2026-10-09 (exercise guides, ADR 0013).** `How to` added as the first exercise `⋯` item (§4.4), for exercises with a guide or rich cues. The screen is specified in [exercise-library.md](exercise-library.md) §8. The Log card never shows a guide. The Log loop gains no taps.

> **Revision 2026-10-09 (competitor follow-ups 3, 8, 9 and 10; approved by Ben, [CHANGELOG](../brief/CHANGELOG.md) 2026-10-09).** Four additions. None adds a tap to the Log loop, and all of them work with no network and no AI.
> 1. **`Why?` on every set target** (§2.12). The target line ends in a `Why?` link that opens an inline panel: who set the number and when, the last comparable sets and their date, the rule or the coach's stored reason, the equipment snap or step, any pain hold, and any sets left out. It is read from provenance stored when the target was made, so it never calls the coach. Because the coach's next-session targets are now the default (D21, ADR 0006 amendment 2), those targets keep the plain `Target` label on the card and name their source in `Why?`. The `Coach target` / `Plan was` markers stay for changes made **today** (AW2).
> 2. **Pain flags without the coach** (§2.14): `⚠ May hurt` with a confirm in the exercise picker, a `Still hurts?` check every two weeks that never clears a flag by itself, and the last sets before the flag kept as the reference. A return towards the earlier loads is only ever a coach proposal (build step 4), never a default.
> 3. **Sets that don't count** (§2.13): `Spotted`, `Pain`, `Form broke` and `Other equipment`, set in the correction sheet or by voice. Flagged sets stay in the log and in volume, but are left out of records, estimated 1RM and progression, and say so wherever they appear.
> 4. **Time left** (§2.15): `About 35 min left · ends about 19:40`, worked out by `estimateRemainingDuration` from pending sets, planned rest and Ben's own logged pace, always worded as an estimate. A `Time left` sheet shows how. The coach's `Shorten` (Ben asks, or an offer when a `Finish by` time will be missed) is specified for build step 4 (§2.15.4).
>
> Changed: §2.1–§2.4 (wireframes and notes), new §2.12–§2.15, §3 (new rows), §4.4 (correction sheet), §4.9, new §4.10, §5, §6, checks 36–62, new §8 (decisions AW1–AW13 and follow-ups for other specs) and §9 (tokens and components to merge into design-system.md, which another agent is editing now).

> **Revision 2026-10-09 (gym switch and re-snap, competitor follow-up 6).** This screen hosts the mid-workout gym switch specified in [gym-switch.md](gym-switch.md). Behaviour is there; this file places it.
> - The switch card is a `Checks`-authored `ChangeReviewCard` in the coach slot. While open, it holds the slot (gym-switch GS8).
> - After `Switch`, an exercise done at two gyms shows a `GymPartDivider` in the mini list and in Overview. Done sets keep their gym and equipment (§2.16).
> - A capped, converted or dropped target shows a `SnapNote` under the target line. Every fit, including a plain rounding, is in `Why?`'s `Equipment` row (§2.12).
> - A pending exercise with no equipment at the new gym has **no load target**, with reps kept and a `Swap ›` link (§2.11, reason `not_here`).
> - Dropped-target facts are now stored on the set (`planned.snap`), so they survive a relaunch.
> - Draft prefill rule 3 only uses sets from the same gym part (§4.2).
> - Undo after a switch, and undoing a coach change after a switch, fit restored targets to the current gym (§4.9).
>
> Changed: §2.11, §2.16 (new), §3, §4.2, §4.7, §4.9, §5, §6, checks 17 and 63–70. The Log loop gains no taps; a switch is 3 taps (chip, gym, `Switch`).

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
4. **Content (scrolls).** The focused card or the Overview table. The exercise header carries the `Adjust` control (left of `⋯`). The card has one **coach slot** for an offer, a pending request, an adjustment banner or an outcome line ([coach-adjustments.md](coach-adjustments.md) §2.1). (2026-10-09) The target line carries `Why?` (§2.12), and the card's last line is the `TimeLeftLine` (§2.15).
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
│  Target 100 kg · 6–8 reps        Why?  │ target, always labelled; Why? §2.12
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
│ ◷ About 35 min left · ends about 19:40 │ TimeLeftLine §2.15 (estimate)
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
- **Coach-changed pending sets** read `Coach target 95 kg × 8` with the `Coach` tag and a `Plan was 100 kg × 6–8` line (coach-adjustments §2.7). Unchanged sets keep the plain `Target` label. (2026-10-09, AW2) This marker is only for changes made **during today's workout**. Targets the session started with keep the plain `Target` label whoever set them: the routine, the built-in rule, or the coach's next-session target, which is now the default (D21). Their source is one tap away in `Why?`. Tagging every coach-set target now that the coach is the default would put a tag on nearly every set, so it would stop meaning anything.
- **`Why?`** (2026-10-09, §2.12): a text link at the trailing end of the target line (`accent`, `type.callout`, 52pt hit area). It opens the `TargetWhyPanel` inline under the target line; the link then reads `Hide`. It is hidden while the keypad is open.
- **`TimeLeftLine`** (2026-10-09, §2.15): the card's last line in Ready and Resting, `◷ About 35 min left · ends about 19:40` (`clock` icon, `type.callout`, `text.secondary`, tabular). It is an estimate, worded "about", and tapping it opens the `Time left` sheet.
- **`PainFlagNote`** (consolidation): when the exercise has an active pain flag, one line sits directly under the target line: `⚠ Pain flag: no increases` (`exclamationmark.triangle` in `status.warning`, text `text.secondary`, `type.callout`). It is a 44pt target that opens the pain flag sheet for that flag (§2.14.4; revision 2026-10-09, was the Pain flags list); Log stays one swipe away. When the flag's two-weekly check is due it reads `⚠ Pain flag: no increases · check due` (§2.14.2). It never blocks or changes Log, appears in Ready and Resting (under `Up next`'s target), and in Overview as a `⚠ Pain` text badge on the exercise header. In the condensed keypad layout (§2.2) it collapses to the `⚠` icon after the target, still read in full by VoiceOver: "Pain flag on this movement. Loads won't go up." It appears as soon as `setPainFlag` commits (e.g. `Adjust` → `Pain`) and disappears when the flag is cleared.

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

(2026-10-09) While the keypad is open, the `Why?` link, any open `TargetWhyPanel` and the `TimeLeftLine` are hidden. The target line itself stays. Closing the keypad brings back the link, but not the panel.

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
│ ✓ Set 2 saved: 100 kg × 6            › │ tap = correction sheet (§4.4)
│ Effort (optional)  6  7  8  9  [10]    │
│ That looked hard. Adjust remaining sets?│ coach slot: offer (only after a
│ RPE 10 on set 2                        │ deterministic trigger)
│ [ No thanks ]              [ Adjust ]  │
│ Up next · Set 3                        │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps        Why?  │ §2.12, explains the next set
│  Rest after: 3:00 ›                    │
│ ◷ About 31 min left · ends about 19:40 │ TimeLeftLine §2.15
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
│        Spotted · not counted           │ exclusion line (§2.13), only if set
│ ▶ 2    100×8       100×6–8   [100][ 8] │ active row: inline fields; Target
│                                        │ cell = Why? button (§2.12)
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
│ ◷ About 35 min left · ends about 19:40 │ TimeLeftLine §2.15
│          Finish workout                │ text button at end of list
├────────────────────────────────────────┤
│ ⏱ Rest 2:47     [−30] [+30] [Skip]    │ compact RestTimer (only resting)
│ [ 🎙 ] [  Log set 2 · 100 kg × 8     ] │
└────────────────────────────────────────┘
```

- Column headers show the unit once per exercise header (`kg`, `kg each`). Inside cells, `×` is used without spaces to save width. VoiceOver reads full values.
- At AX1 and larger, each set becomes a stacked block: line 1 is status and set number, line 2 is `Last 100 kg × 8`, line 3 is `Target 100 kg × 6–8`, and line 4 is `Done 100 kg × 8` or the fields.
- The Log label in Overview includes the set number (`Log set 2 · …`), because the active row may be off screen.
- A coach-changed target shows the `C` text badge after the value. VoiceOver: "Coach target, 97.5 kilograms, 8 reps. Plan was 95 kilograms, 8 to 10 reps." The exercise header row gets `Adjust` left of `⋯`, and the coach slot sits directly under the active exercise's header. (2026-10-09) `C` marks only changes made today (AW2).
- (2026-10-09) **`Why?` in Overview:** the active row's Target cell is a 52pt button that opens the `TargetWhyPanel` full width under that row. For any other exercise, its `⋯` menu has `Why these targets?`, which opens the panel under the exercise header for its next pending set. Pending rows keep tap = make active.
- (2026-10-09) **Exclusions in Overview:** a flagged done row gets a second line in `type.label`, `text.secondary`: `Spotted · not counted` (several reasons: `Spotted, form broke · not counted`). VoiceOver reads it after the actual values.
- (2026-10-09) **Time left in Overview:** the `TimeLeftLine` sits at the end of the list, above `Finish workout` (more than `space.8` from it); tap opens the `Time left` sheet.

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
- **Equipment not at this gym (`not_here`, revision 2026-10-09).** The exercise's equipment kind isn't at the session's gym (after a gym switch, on Repeat, or on a routine started at another gym). The target line reads `Target 8–10 reps · no load target`, with `⚠ No Cable station at Hotel · Lisbon. Plan was 50 kg stack.` and a trailing `Swap ›` (opens the Swap sheet, exercise-library §2.5). Skip is in the exercise `⋯`. A Repeat set says `last time` instead of `Plan was`. It is never `BW`, and never a load "kept as planned".
- **Stored, not recomputed (2026-10-09).** Every dropped or fitted target keeps its facts in `planned.snap` (gym-switch §6.5): the intended load, the outcome, the reason, and the equipment and gym. The warnings above therefore show the same text after a force-close or relaunch.
- **No feasible load from progression (`no_feasible_load`):** when the equipment can't make any load, the rules set no load (`loadFeasibility: 'infeasible'`). The target line reads `Target 8–10 reps · no load target` with the warning `<Equipment> can't make any load with its current min/max settings. Fix the equipment profile.` and [Update gym]. It is never shown as `BW` or "bodyweight"; that wording is only for the `bodyweight` convention (or `added` with nothing added).

### 2.12 `Why?` on every set target (revision 2026-10-09, competitor follow-up 3)

**Question it answers:** "Where did this number come from?" It shows the basis of the target Ben is about to lift, in one tap, without leaving the card. It never logs anything. Apart from links to history and evidence, its only actions are two undo-style buttons (`Undo this change`, `Use built-in rule`).

**Where it is:**
- **Focus, Ready:** the active set's target line ends in a `Why?` text link.
- **Focus, Resting:** the same link sits on `Up next`'s target line.
- **Overview:** the active row's Target cell is the button. Exercise `⋯` → `Why these targets?` explains any exercise's next pending set.
- Every set becomes the active set in turn, so every target gets its `Why?`. Pending rows in the mini list keep tap = make active (§4.4). Done rows show actual results and have no `Why?`.
- **Not shown:** with the keypad open; when there is no target (empty workout, where the draft caption `From 1 Oct` explains the draft instead); on Today, the Live Activity or notifications.

**Layout.** The `TargetWhyPanel` (§9) opens inline, directly under the target line, and pushes the rest of the card down. The action bar and Log never move or hide (AW1).

Built-in rule (the fallback when the coach is unavailable or gave no target, D21):

```
│  Target 102.5 kg · 6–8 reps      Hide  │ link reads Hide while open
│ ┌────────────────────────────────────┐ │ TargetWhyPanel (bg.raised)
│ │ Set by     Built-in rule · after   │ │ SourceTag + when
│ │            Push A, 1 Oct           │ │
│ │ Last time  100 kg × 8, 8, 8        │ │ actual: the sets it used
│ │            1 Oct · Main Gym barbell│ │
│ │ Reason     Every set reached 8 at  │ │ the rule's own explanation
│ │            RPE 8.5 or easier, so   │ │
│ │            one step up.            │ │
│ │ Equipment  +2.5 kg (+2.5%), the    │ │ step card from code
│ │            smallest step on this   │ │
│ │            bar.                    │ │
│ │ History ›                          │ │
│ └────────────────────────────────────┘ │
│  Rest after: 3:00 ›                    │
```

Coach next-session target (the default since D21; plain `Target` label, AW2):

```
│  Target 97.5 kg · 6–8 reps       Hide  │
│ ┌────────────────────────────────────┐ │
│ │ Set by     [Coach] after Push A,   │ │
│ │            1 Oct                   │ │
│ │ Last time  100 kg × 8, 6, 5        │ │
│ │            1 Oct · Main Gym barbell│ │
│ │ Coach      "Set 2 hit RPE 10 and   │ │ stored reason, in quotes
│ │            sets 3–4 fell short;    │ │
│ │            hold a little lighter." │ │
│ │ Equipment  Rounded to 97.5 kg:     │ │ guard note (validator)
│ │            nearest your bar and    │ │
│ │            plates allow.           │ │
│ │ Use built-in rule: 100 kg × 6–8    │ │ AW4; today's pending sets only
│ │ History ›              Evidence ›  │ │
│ └────────────────────────────────────┘ │
```

Coach change made today (the `Coach target` marker stays):

```
│  Coach target 95 kg × 8 [Coach]  Hide  │
│  Plan was 100 kg × 6–8                 │
│ ┌────────────────────────────────────┐ │
│ │ Set by     [Coach] today, you asked│ │
│ │ Last time  100 kg × 6 · set 2,     │ │ the set that prompted it (actual)
│ │            today                   │ │
│ │ Coach      "Set 2 was RPE 10; a    │ │
│ │            little lighter should   │ │
│ │            keep 8 reps."           │ │
│ │ Equipment  −5 kg (−5%) on this bar │ │
│ │ Undo this change                   │ │ coach-adjustments §4.4
│ │ History ›              Evidence ›  │ │
│ └────────────────────────────────────┘ │
```

Pain hold, with a set left out and the pre-flag reference:

```
│  Target 50 kg · 6–8 reps         Hide  │
│ ┌────────────────────────────────────┐ │
│ │ Set by     Built-in rule · after   │ │
│ │            Push A, 13 Oct          │ │
│ │ Last time  50 kg × 8, 8 · 13 Oct   │ │
│ │ Reason     Held: every set reached │ │
│ │            8, but the pain flag    │ │
│ │            stops increases.        │ │
│ │ Pain       ⚠ Flag on since 6 Oct   │ │ status.warning icon + text
│ │            (shoulder). Check due › │ │ only when the check is due
│ │ Before flag 55 kg × 6, 6, 6 · 2 Oct│ │ reference only (§2.14.3)
│ │ Not used   Set 3 on 13 Oct: form   │ │ exclusion (§2.13)
│ │            broke.                  │ │
│ │ History ›                          │ │
│ └────────────────────────────────────┘ │
│  ⚠ Pain flag: no increases             │ PainFlagNote moves below the panel
```

**Rows** (fixed order; a row appears only when it has content; at most 7 rows plus the footer):

| Row | Shows | Text from |
|---|---|---|
| `Set by` | Who set the target, and when. `Built-in rule · after Push A, 1 Oct` · `Built-in rule (coach offline) · after Push A, 1 Oct` · `Coach · after Push A, 1 Oct` (next-session default, D21) · `Coach · today, you asked` · `Coach · today, you tapped Adjust` · `Your routine · Push A` (a fixed target Ben typed in the routine) · `Warm-up ramp` · `Swap · from DB bench press history` · `Built-in rule · you chose it today` (after AW4) | `TargetProvenance.source`, shown with `SourceTag` |
| `Last time` | The comparable sets the target was built from, as actual results, with date, gym and equipment. A coach target shows the latest session; older evidence is behind `Evidence ›`. With none: `No earlier sets on this machine.` | `basisSetIds` |
| `Reason` (or `Coach`) | Built-in rule, routine, warm-up and back-off: the domain's explanation (`Every set reached 8 at RPE 8.5 or easier, so one step up.` · `Holding: set 3 was 7 reps.` · `Push A sets 100 kg × 6–8.` · `60% of your first working set (100 kg), rounded down.` · `90% of today's top set (102.5 kg), rounded down.`). Coach: the row is labelled `Coach`, and its stored one-sentence reason is shown in quotes | `ruleOutcome.text` / `coachReason` |
| `Equipment` | The snap, cap or step: `Rounded to 97.5 kg: nearest your bar and plates allow.` · `Capped at 30 kg each: the most Main Gym's rack goes to.` · `+2.5 kg (+2.5%), the smallest step on this bar.` · `Next dumbbell is 12 kg (+20%): adding reps first.` · `No load target: Cable stack can't make any load as set up.` After a gym switch it says what the switch did (§2.16) | `guardNotes`, `stepCard`, and the set's `planned.snap` after a switch (gym-switch §6.5) |
| `Pain` | Only with an active flag on this movement: `⚠ Flag on since 6 Oct (shoulder). Loads, reps and sets can't go up.` plus `Check due ›` when the two-weekly check is due (§2.14.2) | `painHold` |
| `Before flag` | Only while a flag is on, and for `timing.painReferenceWindow` (8 weeks) after it's cleared: the last comparable session before the flag, as actual results. Reference only; it never sets a target (§2.14.3) | `getPainReference` |
| `Not used` | Basis sets left out because Ben marked them (§2.13): `Set 3 on 1 Oct: spotted.` | `excludedSetIds` with reasons |
| Footer | `History ›` (history sheet, §4.4) · `Evidence ›` (coach sources only: the `getDecisionEvidence` sheet, coach-sheet §4.6) · `Undo this change` (a coach change made today, while the set is still pending) · `Use built-in rule: 100 kg × 6–8` (a coach next-session target, AW4) | — |

**Rules:**
1. **Stored, not recomputed (AW3).** The panel shows what produced the number at the time it was set (`TargetProvenance`, written by whichever path set the target: `calculateNextTargets`, `applyCoachProposal`, the routine snapshot, the warm-up ramp or `swap_exercise`). Opening it runs no rule and no coach. If the basis was corrected after the target was set, a `NoteLine` (info) says `Based on 1 Oct before you edited it on 2 Oct.` Nothing changes by itself (rule 2).
2. **Offline.** Everything is local. The coach's reason is stored text.
3. **Whose words.** The coach's own words appear only in the `Coach` row, in quotes, beside the `Coach` tag. Every other line is deterministic app text.
4. **Labels.** `Last time` and `Before flag` are actual results; the line above the panel is the target. No estimated 1RM, %1RM or score appears here.
5. **One at a time.** One panel is open at most. It closes on `Hide`, on Log, when another set becomes active, or when the keypad opens. Switching Focus ↔ Overview keeps it open on the same set.
6. **No motion.** It expands within `timing.fast`, with no animation under Reduce Motion. VoiceOver focus moves to `Set by`.
7. **Missing provenance.** Targets set before this build, or by an import, read `Set by  Not recorded (set before this app version)`, then `Last time` from history if there is any. The panel never guesses a reason.

**`Use built-in rule` (AW4).** D21 puts the Undo for a coach next-session target on the Summary, until that routine's next session starts. Once Ben is in the session, this button is his way back. Tapping it calls `setTargetSource(sessionExerciseId, 'rule', baseVersion, opId)`. The **pending** sets of this exercise **today** take the built-in rule's values at once, with an undo toast `Bench press: built-in rule for today` [Undo]. If the Log label changes, Log ignores taps for `timing.valueChangeGuard`. Done sets, the routine and the next session aren't touched. The next summary works out next time as usual. The button doesn't exist for a built-in target or a routine target.

### 2.13 Sets that don't count: exclusion flags (revision 2026-10-09, competitor follow-up 9)

**Question it answers:** "This set happened, but should it count as a measure of my strength?" A flagged set stays in the log, but it's kept out of records, estimated 1RM and progression, and everywhere it appears it says so (rule 6).

**Reasons** (multi-select; set only by Ben, AW5):

| Chip | Meaning | Typical case |
|---|---|---|
| `Spotted` | Someone helped with reps | Spotter on the last rep |
| `Pain` | It hurt | Also puts a pain flag on the movement (AW7) |
| `Form broke` | Technique broke down | Bouncing, half reps |
| `Other equipment` | Not the usual equipment for this exercise's history | A different bar or machine because the usual one was taken |

**Where Ben sets them.** All of these are off the Log path; logging stays one tap.
1. **Correction sheet** (§4.4): tap the done set, or the rest card's `✓ Set 2 saved … ›`. The chips sit under `Leave out of records and progress`.
2. **Voice:** "that was spotted", "spotter helped", "form broke on that one" and "used a different bar" mark the **last logged** set. "100 for 8, spotted" logs with the flag in one go. The voice strip shows the result with Undo (§4.10).
3. **Pain card:** when Ben sets a pain flag during the rest straight after a set (`Adjust` → `Pain`, or voice), the pain card (coach-memory §2.5) adds one **unselected** chip, `Leave set 2 out of records`. Pain on the movement doesn't mark the set by itself.

**How it shows:**
- Mini list and done rows: `✓ 2  100 kg × 8   RPE 9 · Spotted`. The word is a `Tag` with no colour. VoiceOver: "Set 2, done, 100 kilograms, 8 reps, RPE 9. Spotted: not counted for records or progress."
- Rest card just-saved line: `✓ Set 2 saved: 100 kg × 8 · spotted ›`.
- Overview: a second line under the done row, `Spotted · not counted` (§2.4).
- `Last (1 Oct): 100 kg × 8 · spotted` when the previous comparable set carries a flag. Tapping still copies the values, because they're what happened.
- `Why?` lists flagged basis sets under `Not used`.
- Summary, past workouts and Progress use the same words (progress.md PG21; workout-summary follow-up in §8.2).

**Effects** (deterministic, through one pure check, `isSetCountable(set, purpose)`):

| Used for | A flagged set |
|---|---|
| Log, history, summary exercise rows, export | Shown, with its words |
| Working-set count, volume, sets per muscle | **Counted**: the work happened (AW8) |
| Records | Left out |
| Estimated 1RM | Left out |
| Progression (the built-in rule and the coach's `Last time` basis) | Left out. If every working set of a session is flagged, the built-in rule holds: `No counted sets on 8 Oct (all left out); holding.` |
| Summary `Compared with last time` | Left out. It uses the best unflagged set, or says `Not compared: the only top set was spotted.` |
| Coach offer triggers (rule T) | A flagged set never triggers an offer. Flagging a set while its offer shows removes the offer (`expired`) |
| Coach context | Sent with its words (`spotted`), never as a plain set |
| Today's remaining targets | Unchanged. A flag never changes targets by itself |
| `Next time` | Worked out without it at Finish. A flag added after Finish recomputes like any correction (workout-summary §4) and marks affected coach proposals `Out of date` |

A flag is a versioned correction (`correctSet`, audited in `Edit history` as `Set 2 marked: spotted`), never a deletion (AW6). It is never set automatically and never hidden.

### 2.14 Pain flags without the coach (revision 2026-10-09, competitor follow-up 8)

Pain flags are deterministic guards (coach-memory.md; rule 9). Everything in this section works offline with no AI. Nothing here diagnoses, says a movement is safe, or clears a flag on Ben's behalf.

#### 2.14.1 `May hurt` in the exercise picker

In `Add exercise` (Pick one) and the Swap sheet, an exercise with an active pain flag is tagged `⚠ May hurt`. This replaces `⚠ Pain flagged`. Only exercises the flag covers are tagged; similar movements aren't (coach-memory CM5). The row is never hidden. Tapping it asks first (system action sheet):

```
┌────────────────────────────────────────┐
│ Overhead press may hurt                │
│ You flagged shoulder pain on it on     │
│ 6 Oct. Loads won't go up while the     │
│ flag is on.                            │
│ ┌────────────────────────────────────┐ │
│ │            Add anyway              │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │          Choose another            │ │ cancel role
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

`Add anyway` adds it (or applies the swap) as normal, and the set card shows the `PainFlagNote`. `Choose another` returns to the picker with the query kept. The full picker spec, including routines' Pick several, is exercise-library.md §2.1 and EL9.

#### 2.14.2 `Still hurts?` every two weeks

- A flag's check falls due `timing.painReview` (14 days) after it was set or last checked. The check never clears the flag, and neither does time or the coach. Only Ben's `Clear flag` in the confirmation does (coach-memory CM4; AW9).
- **Where it's asked.** All of these are quiet: none is a modal, a banner or a notification.
  1. **Rest card** (wireframe below), once per due flag per workout, after the first logged set of that movement, and only when the coach slot is empty (lowest priority). It is not the coach, it uses no AI, and it is never spoken.
  2. **`PainFlagNote`** reads `⚠ Pain flag: no increases · check due`. Tapping it opens the pain flag sheet (§2.14.4) with the question first.
  3. **Today:** one quiet row while any check is due and no workout is in progress (today.md region 4b). This also reaches flags on movements Ben has stopped doing.

```
│ ✓ Set 1 saved: 50 kg × 8             › │
│ Effort (optional)  6  7  8  9  10      │
│ Overhead press: still hurting?         │ PainReviewLine (coach slot)
│ Pain flag since 6 Oct · 16 days        │ fact, text.secondary
│ [ Still hurts ]          [ Better… ]   │ text buttons, 52pt, ≥ space.8 apart
│ Up next · Set 2                        │
```

- **Answers:**
  - `Still hurts` → `recordPainFlagReview(flagId, 'still_hurts', opId)`. The next check is 14 days later. The line becomes an outcome line, `Pain flag kept · next check 3 Nov` [Undo], which hides on the next Log. From the second `Still hurts` in a row (4 weeks or more) it adds: `It's been 4 weeks. Pain that lasts this long is worth getting checked by a physio or doctor.`
  - `Better…` → the clear confirmation (§2.14.3). `Keep it` there records nothing, so the check stays due.
  - **No answer** (the next Log) → still due. It isn't asked again in this workout.
- **Voice**, while the line is shown: "still hurts" = `Still hurts`. "It's better" or "clear the pain flag" opens the confirmation on screen. A flag is never cleared by voice alone (coach-memory §4.2).

#### 2.14.3 Clearing a flag, and the pre-flag reference

The confirmation (system action sheet). Its copy revises coach-memory §2.7 (AW10):

```
┌────────────────────────────────────────┐
│ Clear the pain flag on Overhead press? │
│ Loads, reps and sets can go up again,  │
│ starting from your recent sets. Your   │
│ sets from before 6 Oct stay in your    │
│ history as the reference.              │
│ [ Clear flag ]                         │ default style, not red
│ [ Keep it ]                            │
└────────────────────────────────────────┘
```

Toast `Pain flag cleared for Overhead press` [Undo] (8 s). After that, Ben sets a new flag if he needs one.

- **No reset.** Clearing deletes nothing. History, records and charts from before the flag stay, and Progress keeps the flag span on the chart (progress.md PG22).
- **Pre-flag reference.** `getPainReference(flagId)` returns the last comparable session before the flag was set. It shows as `Before flag` in `Why?`, in the pain flag sheet and in the history sheet (heading `Before the pain flag (6 Oct)`), while the flag is on and for `timing.painReferenceWindow` (8 weeks) after it's cleared. It is reference only, never a target.
- **After clearing, targets carry on from the recent sets**, with the normal small steps: the built-in rule (7-F), or the coach's small next-session changes (D21).
- **A return towards the pre-flag loads is never a default.** For 8 weeks after a flag is cleared, any coach next-session target on that movement that is more than one achievable step above its last session is a `CoachTargetProposal` with Apply and Undo (build step 4). It is never applied by default under D21. How fast and how far to return must come from the training-researcher as a playbook candidate, and Ben approves it. Until then the coach makes no return-to-load proposals, and the validator drops any such jump with the guard note `Not raising faster than one step: pain flag cleared 14 Oct.` The coach never says a movement is safe and never diagnoses (rule 9).

#### 2.14.4 Pain flag sheet

Opened from the `PainFlagNote`, the `Pain` row in `Why?`, or Today's check row. Medium detent; the workout keeps running underneath, and swiping down returns to the same set and draft.

```
┌────────────────────────────────────────┐
│ Pain flag                         Done │
│ ⚠ Overhead press · shoulder            │ status.warning icon + text
│ Since 6 Oct (16 days) · you, during    │
│ Push A                                 │
│ No increases in load, reps or sets.    │
│                                        │
│ Still hurts?                           │ only when the check is due
│ [ Still hurts ]   [ Better: clear… ]   │ SecondaryButtons, 52pt
│                                        │
│ Before the flag                        │
│ 2 Oct · 55 kg × 6, 6, 6                │ actual
│ Since the flag                         │
│ 13 Oct · 50 kg × 8, 8, 8               │ actual
│                                        │
│ If pain is sharp, keeps coming back or │
│ doesn't settle, see a physio or        │
│ doctor. The coach can't diagnose.      │
│ Clear flag…                            │ text button when no check is due
│ All pain flags ›                       │ coach-memory §2.1
└────────────────────────────────────────┘
```

### 2.15 Time left (revision 2026-10-09, competitor follow-up 10)

**Question it answers:** "Roughly how long until I'm done?" It is always an estimate: worded `about`, never shown as a clock that counts down, and worked out by code, never by the model (rule 6).

#### 2.15.1 The line

`TimeLeftLine`: `◷ About 35 min left · ends about 19:40` (`clock` icon, `type.callout`, `text.secondary`, tabular).

- **Where:** the last line of the focused card in Ready (after `Next exercise`) and in Resting (after `Up next`'s rest line); the end of the Overview list above `Finish workout`; Today's Resume card (today.md).
- **Not in the top bar** (AW11). The top bar's clock is a fact (elapsed active time). An estimate in the same spot would read as a countdown. Words in the "what comes next" part of the card can't be mistaken for a timer.
- **Hidden:** while the keypad is open, in Loading, in an empty workout, and once all sets are done (Finish is then the primary).
- **Variants:**

| Case | Line |
|---|---|
| Normal | `About 35 min left · ends about 19:40` |
| `Finish by` set, on track | `About 35 min left · on track for 19:45` |
| `Finish by` set, over | `About 35 min left · about 10 min past 19:30` (text only, no warning colour: running long isn't an error) |
| Paused | `Paused · about 35 min left after you resume` |
| Last set | `About 2 min left` (the next line already says `Last set of the workout`) |
| Under 2 min | `Under 2 min left` |

- **Rounding:** 10 min or more → the nearest 5 min; under 10 min → the nearest minute. The end time is rounded to 5 minutes.
- **Updates:** after every commit, skip, add, delete, coach change, rest adjustment, pause and resume, and otherwise once a minute (`timing.timeLeftRefresh`), so standing around makes it grow honestly. Never every second, never animated. VoiceOver doesn't announce updates.
- **Tap** → the `Time left` sheet (§2.15.3).

#### 2.15.2 How it's worked out (`estimateRemainingDuration`, pure, `packages/domain`)

- **What's left:** pending sets (not done, skipped or deleted), including pending other-side sets and superset members.
- **Planned rest:** each pending set's resolved rest (`resolveRestPreset`), except after the final set. Within a superset, only the configured transition counts between members. If resting, the current rest's time left is added.
- **Ben's pace:**
  - `per set`: the median, over consecutive sets of the same exercise, of (time between the two commits − the planned rest between them). This counts work time and any habitual over-rest. Paused time and gaps over `pace.maxGap` (15 min) are left out.
  - `changeover`: the median of (time from an exercise's last set to the next exercise's first set − the planned rest).
  - **Source**, in order: this workout, once it has `pace.minSamplesSession` (3) gaps of that kind; else Ben's last `pace.recentSessions` (5) finished workouts; else defaults of `pace.defaultSetSeconds` (45 s) and `pace.defaultChangeoverSeconds` (2 min), labelled `Default`.
  - Timed sets use their planned duration plus the per-set figure.
- **Range:** low and high from the 25th and 75th percentiles of the pace samples (±25% on defaults). Only the sheet shows it.
- **Never used:** check-ins, coach output, or any readiness-style guess.
- **Returns** `{minutes, lowMinutes, highMinutes, endsAt, finishBy?, overByMinutes?, pace: {source: 'this_workout' | 'recent_workouts' | 'default', secondsPerSet, changeoverSeconds, samples}, plannedRestSeconds, pendingSets, pendingExercises}`. Unit-tested.

#### 2.15.3 Time left sheet

Medium detent. The rest timer and alerts keep running underneath; swiping down returns to the same set.

```
┌────────────────────────────────────────┐
│ Time left                         Done │
│ About 35 min · likely 30–40 min        │ estimate (type.title2 / callout)
│ Ends about 19:40                       │
│                                        │
│ Left to do      11 sets · 3 exercises  │
│ Planned rest    18 min                 │ your rest settings
│ Your pace       1:05 a set · 2 min     │
│                 between exercises      │
│                 [From this workout]    │ SourceTag (or Your last 5 workouts,
│                                        │ Default)
│ So far          24:31 active           │ fact; paused time not counted
│                                        │
│ Finish by       [ Not set ▾ ]          │ today only
│                                        │
│ [ Shorten to fit… ]                    │ SecondaryButton; build step 4
│ This is an estimate from your pace and │ text.secondary
│ rest settings. It doesn't change your  │
│ sets.                                  │
└────────────────────────────────────────┘
```

- **`Finish by`** (AW12): a wheel of times from now + 5 min to now + 3 h in 5-minute steps, plus `Not set`. Saved on the session (`setSessionFinishBy`), for today only, as Your data. It changes only the line's wording and, from build step 4, whether the coach may offer to shorten. To undo it, pick another time or `Not set`.
- **`Shorten to fit…`:** absent until build step 4. From step 4, with the coach offline or not connected, it shows the caption `Coach offline. Skip exercises from their ⋯ menu.` and does nothing else.

#### 2.15.4 Shorten (build step 4: specified now, not built in step 2)

- **Ben asks:** "I've only got 20 minutes", "shorten this", or `Shorten to fit…` → `Fit into [20 min ▾]` or `Finish by 19:30` → `requestCoachAdjustment(sessionId, {origin: 'ben_request', intent: 'shorten', targetMinutes | finishBy}, baseVersion, opId)`. It applies **at once with Undo** (CLAUDE.md rule 3; coach-adjustments CA2 already covers removing pending sets; AW13):

```
┌────────────────────────────────────────┐
│ [Coach] Coach shortened today          │ CoachAdjustmentBanner
│ About 50 → 20 min · kept Bench press   │ before → after from the estimate
│ and Cable row. Skipped Cable fly (3    │
│ sets) and Curl (3 sets).               │
│ Loads and rest unchanged.              │ guard note (validator)
│ Why? ›                       [ Undo ]  │
└────────────────────────────────────────┘
```

- **Coach offers** (a deterministic trigger, `evaluateTimeTrigger`): only when Ben set `Finish by` (or told the coach a time limit today), the estimate passes it by `timing.shortenOfferOver` (5 min) or more, the coach is reachable and nothing is pending. Once per workout, in the rest card only, as a `CoachOfferLine`: `About 10 min past 19:30. Shorten the rest of today?` / `11 sets left · about 35 min (estimate)` [No thanks] [Shorten]. Nothing changes until `Shorten`, which counts as Ben asking (CA1). It is spoken only in Conversation mode, while resting with at least 20 s left.
- **What the coach may do** (validator guards, deterministic):
  - Change only today's pending sets: scope `Today only`. Done sets and the routine are never touched.
  - Skip pending sets or whole pending exercises, keeping the goal's priority order (playbook rule 1 and rule G: main lifts or priority muscles first). Skipped sets show `Skipped · to save time`, so Undo can restore them.
  - Never raise a load, reps or sets (guard `shorten_no_increase`), never shorten rest (CA3; the brief's "not extra rushed work"), never swap an exercise (a swap stays a `ChangeReviewCard`).
  - The before → after minutes come from `estimateRemainingDuration`, never from the model.
  - If the priority work alone won't fit, it skips nothing else silently and says so as an outcome line: `Bench press and Cable row alone take about 28 min. Skipped everything else.`
- **Offline or not connected:** no offer. Ben skips exercises from their `⋯` menu. A built-in trim is a later option (AW12).
- **Undo:** the banner's `Undo`; later, exercise `⋯` → `Undo coach change` while the sets are still pending (coach-adjustments §4.4).

### 2.16 After a gym switch (revision 2026-10-09, competitor follow-up 6)

The switch itself (entry, card, states, Undo) is specified in [gym-switch.md](gym-switch.md). This section shows how the set card looks once a workout has used two gyms.

```
├────────────────────────────────────────┤
│ Incline DB press          Adjust  ⋯    │
│ Dumbbells · Working · Set 2 of 3       │ numbering runs across parts
│ Last (2 Oct, Hotel · Lisbon):          │ previous at THIS equipment
│ 20 kg each × 12                        │ (actual)
│  Load each               Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  20 kg     │+ │ │− │  10   │+ │   │ steppers use Hotel's rack
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 20 kg each · 8–10 reps   Why?  │
│  ⓘ Capped: the most here is 20 kg     │ SnapNote
│    each. Plan was 32.5 kg each.        │
│  Rest after: 1:30 ›                    │
│                                        │
│ ✓ 1  32.5 kg each × 9       Main Gym   │ done set keeps its gym (actual)
│ ── At Hotel · Lisbon ───────────────── │ GymPartDivider
│ ▶ 2  now                               │
│ ○ 3  Target 20 kg each × 8–10          │
├────────────────────────────────────────┤
│ [ 🎙 ] [     Log 20 kg each × 10     ] │
└────────────────────────────────────────┘
```

- **Parts.** An exercise with finished sets at the earlier gym and pending sets at the new one is one block made of two rows in the data (gym-switch GS6). Sets are numbered across the block. A `GymPartDivider` (`At Hotel · Lisbon`) separates the parts in the mini list and in Overview. A done set from a gym other than the current one shows that gym's name, right-aligned, in `text.secondary`.
- **`SnapNote`.** This is a `NoteLine` under the target line in Ready, and under `Up next` in Resting. It shows only for `capped`, `converted` and `dropped` outcomes (`dropped` as the §2.11 warning). A plain rounding (`rounded`) and a restore (`restored`) have no note, but are in `Why?`'s `Equipment` row, which reads the set's `planned.snap`. With the keypad open, the note collapses to its icon after the target. In Overview it is an icon after the Target cell, and VoiceOver reads it in full.
- **`Why?` after a switch.** `Set by` keeps the original author (routine, built-in rule, coach). The `Equipment` row says what the switch did, for example `Capped at 20 kg each at Hotel · Lisbon. Plan was 32.5 kg each (Main Gym).` or `Back to the planned load at Main Gym.`
- **`Last`** for a part uses history at that part's equipment (active-workout §5 `Previous`).
- **Steppers, keypad step keys, `Machine busy`, the gym chip's busy count, `Add set` and `Add exercise`** use only the current gym's equipment. The correction sheet for a done set uses that set's own equipment, so correcting a Main Gym set at Hotel · Lisbon never flags it `off_profile_load`.
- **The switch card** holds the coach slot while it's open (gym-switch GS8). Offers and adjustment banners wait behind it, and a coach request still in progress is cancelled when Ben chooses a gym.

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
| Gym switch card open (revision 2026-10-09) | Coach slot: `ChangeReviewCard` `[Checks] Switch to Hotel · Lisbon` · `Today only` · `2 logged sets stay as they are.` + one line per changed exercise + `No change: …` [Not now] [Switch] (gym-switch §2.2) | unchanged, usable | Holds the slot (GS8). Out of date when the sets it changes change (GS7). Completed sets aren't listed and don't change |
| Gym switched (2026-10-09) | Toast `Switched to Hotel · Lisbon. Remaining sets updated for today.` [Undo]; gym chip shows the new gym; `GymPartDivider` and `SnapNote`s (§2.16) | `Log <fitted values>`, guarded 1 s if the label changed | Rest, pause and elapsed time untouched |
| Ready, equipment not here (2026-10-09) | §2.11 `not_here`: `Target 8–10 reps · no load target` + `⚠ No Cable station at Hotel · Lisbon. Plan was 50 kg stack.` `Swap ›` | `Log …` from the same-part fallback draft, or `Enter load` | Never a load kept unchecked |
| Write error | `Couldn't save this set. Your entry is still here.` [Try again] | `Log …` stays available with the same opId | Extremely rare: SQLite full or locked |
| `Why?` open (2026-10-09) | `TargetWhyPanel` under the target line (§2.12) | unchanged, usable | Closes on `Hide`, Log, another active set or the keypad. Offline and AI-unavailable look the same |
| `Why?`, basis edited since | Panel + `Based on 1 Oct before you edited it on 2 Oct.` | unchanged | Nothing recomputes by itself |
| `Why?`, no stored provenance | `Set by  Not recorded (set before this app version)` + `Last time` from history | unchanged | Never a guessed reason |
| Built-in rule chosen for today (AW4) | Toast `Bench press: built-in rule for today` [Undo]; the `Set by` row reads `Built-in rule · you chose it today` | `Log <built-in values>`, guarded 1 s if the label changed | Pending sets of that exercise only |
| Set marked (exclusion) | Done row and just-saved line show the words (`· Spotted`); toast `Set 2: spotted · not counted for records` [Undo] | unchanged | Targets unchanged; any offer from that set is removed |
| Set marked `Pain` | As above, plus the pain card in the coach slot (`Pain noted for Bench press…`) and the `PainFlagNote` | unchanged | AW7 |
| Adding a flagged exercise | `Overhead press may hurt` confirm (§2.14.1) over the picker | behind the sheet | `Add anyway` adds; `Choose another` returns to the picker |
| Pain flag check due | `PainFlagNote` `… · check due`; after the first set of that movement, `PainReviewLine` in the empty coach slot | unchanged | Once per flag per workout; hidden by the next Log; never spoken |
| Pain flag kept | Outcome line `Pain flag kept · next check 3 Nov` [Undo] (+ the 4-week professional line from the second time) | unchanged | Hides on the next Log |
| Pain flag cleared | Toast `Pain flag cleared for Overhead press` [Undo]; `PainFlagNote` disappears | unchanged | Targets carry on from recent sets (§2.14.3) |
| Time left | `◷ About 35 min left · ends about 19:40` as the card's last line | unchanged | Estimate; updates by event and once a minute; hidden with the keypad |
| Time left, default pace | Same line; the sheet shows `Your pace … [Default]` | unchanged | Until 3 gaps this workout or 5 past workouts exist |
| Time left, finish-by set | `… · on track for 19:45` / `… · about 10 min past 19:30` | unchanged | Text only, no warning colour |
| Time left, paused | `Paused · about 35 min left after you resume` | `Resume` | Frozen while paused |
| Shorten offer (step 4) | Rest card `CoachOfferLine`: `About 10 min past 19:30. Shorten the rest of today?` [No thanks] [Shorten] | unchanged | Only with `Finish by`, coach reachable; once per workout |
| Coach shortened (step 4) | `CoachAdjustmentBanner` `Coach shortened today` · `About 50 → 20 min · …` [Undo]; removed sets show `Skipped · to save time` | `Log <next remaining set>` | Loads and rest unchanged |

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
3. If there's no target (empty workout, or the planned load was dropped, §2.11), use the last logged set of this exercise in this session, **in the same gym part** (same equipment; revision 2026-10-09, gym-switch §6.3). A set logged on Main Gym's bar never becomes the draft for the Hotel · Lisbon part.
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
│ Leave out of records and progress      │ 2026-10-09, §2.13
│ [Spotted] [Pain] [Form broke]          │ ParamChip multi-select, 52pt
│ [Other equipment]                      │
│ Still counts in your log and volume.   │ text.secondary
│ ┌────────────────────────────────────┐ │
│ │            Save changes            │ │
│ └────────────────────────────────────┘ │
│ Delete set                             │ danger text, separated
└────────────────────────────────────────┘
```
  - `Save changes` calls `correctSet(setId, patch, expectedVersion)`. The row gets an `Edited` tag. Rest is not touched. A correction never calls the coach and never changes other targets by itself. If the corrected effort or reps meet a trigger, the deterministic check may show a coach **offer** (no AI call until Ben taps `Adjust`).
  - `Delete set` calls `deleteSet` (`delete_set`, guarded on the set's version). It always confirms: `Delete set 1? It's removed from this workout's totals and history. The edit log keeps a record.` [Delete] [Cancel]. Toast `Set 1 deleted` (no Undo yet; ADR 0003 Open). The set is kept as an audited deleted record and disappears from the mini list, Overview and volume. Pending sets can be deleted the same way from their row's `⋯` in Overview.
  - The sheet also shows the Side control for unilateral exercises (§2.9).
  - (2026-10-09) **Exclusion chips** (§2.13): `Spotted`, `Pain`, `Form broke`, `Other equipment`, multi-select, none selected by default. They save with `Save changes` as part of the same `correctSet` patch (`exclusions`). Selecting `Pain` adds the line `⚠ This also puts a pain flag on Bench press: no increases until you clear it.`; when there's no active flag on the movement, the same commit sets one (`setPainFlag`, source `workout`) and the pain card appears with its Undo (AW7). Unticking `Pain` later doesn't clear the movement flag; that stays an explicit `Clear flag` (§2.14.3). At AX1+ the chips wrap two per row.

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
- **Gym changes (revision 2026-10-09)** come from the gym chip, voice or the coach, and are always `Checks`-authored: the numbers come from `snapPlanToGym`, never from the model. The button reads `Switch` (same gym after an edit: `Apply`). The switch never calls the coach. The cue plays only when a target changed. Full spec: [gym-switch.md](gym-switch.md) §4.

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
| Gym switch (2026-10-09) | Toast `Undo` (8 s) restores the gym, exercise rows, pending targets and drafts exactly. If anything changed since, it shows `Can't undo: your workout changed since the switch.` and a `Switch back to Main Gym` card, which restores the planned loads. Undoing a coach change or a swap after a switch fits the restored target to the current gym (gym-switch §4.5) |
| Coach adjustment | `Undo` on the banner; later, `Why?` on a coach-marked set → `Undo this change`, or exercise `⋯` → `Undo coach change`. `undoAction` restores only sets still pending (coach-adjustments §4.4) |
| Pain flag | Undo on the pain card or toast (8 s); after that, tap `Pain` again or the `PainFlagNote`, which opens the pain flag sheet (§2.14.4) → `Clear flag…` → confirm (§2.14.3; coach-memory.md §2.7). Never cleared automatically, by a check or by the coach |
| Discard workout (0 sets) | Discards at once. Toast `Workout discarded` (no Undo: nothing was logged; start again from Today) |
| Discard workout (≥1 set) | Confirmation alert first: `Discard Push A? 7 logged sets will be discarded.` [Discard] [Cancel]. No undo afterwards, which is why the confirmation is needed |
| Exclusion flag (2026-10-09) | Toast `Undo` (8 s), or the voice strip's Undo for a voice mark. After that, open the set and untick (a versioned correction, kept in `Edit history`) |
| `Use built-in rule` (AW4) | Toast `Undo` (8 s). After that, the change is visible in `Why?` (`Built-in rule · you chose it today`) and lasts only for today |
| `Still hurts` answer | `Undo` on the outcome line, until the next Log |
| Pain flag cleared | Toast `Undo` (8 s). After that, set a new flag |
| `Finish by` | Choose another time or `Not set` in the `Time left` sheet |
| Coach shortened (step 4) | `Undo` on the banner; later exercise `⋯` → `Undo coach change` while the sets are still pending. `Skipped · to save time` sets return to pending |

If an Undo is rejected (the set was corrected from another path, or something was logged after it), the toast changes to `Can't undo: set 2 changed. Tap it to edit or delete.` Nothing is removed.

### 4.10 Why?, exclusions, pain checks and time left (revision 2026-10-09)

None of these is on the Log path, and none needs the network. Voice phrases are a deterministic list (like `parseSpokenSet`), so they work offline. They are proposals for voice.md (§8.2).

| Control | Tap | Voice (when voice is available) | Undo |
|---|---|---|---|
| `Why?` / `Hide` on the target line; Overview active Target cell; exercise `⋯` → `Why these targets?` | Opens or closes the panel (§2.12) | "Why this weight?", "why 100?", "where's that number from?" open the panel. In Set cues or Conversation mode, the `Reason` line is spoken (scripted, §5) | Nothing to undo |
| `History ›` · `Evidence ›` in the panel | History sheet · evidence sheet | — | — |
| `Undo this change` in the panel | coach-adjustments §4.4 | "Undo" (most recent action) | — |
| `Use built-in rule: …` in the panel | `setTargetSource` (AW4) | — | Toast [Undo] |
| Exclusion chips (correction sheet) | Toggle; saved with `Save changes` | "That was spotted", "spotter helped", "form broke on that one", "used a different bar" mark the last logged set; "100 for 8, spotted" logs and marks | Toast or strip [Undo]; then untick |
| `⚠ May hurt` row in the picker | Confirm → `Add anyway` / `Choose another` | "Add overhead press" asks the same question in the strip: `Overhead press may hurt. Add anyway?` [Add anyway] [Cancel] | `Remove exercise` while nothing is logged (exercise-library §4.6) |
| `PainReviewLine` | `Still hurts` / `Better…` | "Still hurts" / "it's better" (opens the confirmation; never clears by voice) | Outcome line [Undo] |
| `PainFlagNote` | Pain flag sheet (§2.14.4) | "Show the pain flag" | — |
| `TimeLeftLine` | `Time left` sheet | "How long left?" → spoken "About 35 minutes left, ending about 7:40." | — |
| `Finish by` (sheet) | Wheel picker | "I need to finish by half seven" sets it and shows `Finish by 19:30` in the strip [Undo] | Pick again or `Not set` |
| `Shorten to fit…` (step 4) | `Fit into` picker → coach | "I've only got 20 minutes" | Banner [Undo] |

- **Keyboard:** none of these opens a keyboard. The `Finish by` wheel and the `Fit into` picker sit in the sheet; the sheet hides the action bar while it's open, and swiping down returns to Log.
- **Gestures:** none. Every action is a visible button with a 52pt hit area (`target.workout`).

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
| `Why?` link (2026-10-09) | `Why?` / `Hide` · Overview menu `Why these targets?` · VoiceOver "Why this number? Button." |
| `Why?` panel rows | `Set by` · `Last time` (**actual**) · `Reason` / `Coach` · `Equipment` · `Pain` · `Before flag` (**actual**, reference only) · `Not used` |
| `Set by` values | `Built-in rule · after Push A, 1 Oct` · `Built-in rule (coach offline) · after Push A, 1 Oct` · `Coach · after Push A, 1 Oct` · `Coach · today, you asked` · `Coach · today, you tapped Adjust` · `Your routine · Push A` · `Warm-up ramp` · `Swap · from DB bench press history` · `Built-in rule · you chose it today` · `Not recorded (set before this app version)` |
| `Why?` texts | `No earlier sets on this machine.` · `Based on 1 Oct before you edited it on 2 Oct.` · `Flag on since 6 Oct (shoulder). Loads, reps and sets can't go up.` · `Check due ›` · `Set 3 on 1 Oct: spotted.` · footer `History ›` · `Evidence ›` · `Undo this change` · `Use built-in rule: 100 kg × 6–8` (a **target**) · toast `Bench press: built-in rule for today` [Undo] |
| Exclusions | Heading `Leave out of records and progress` · chips `Spotted` · `Pain` · `Form broke` · `Other equipment` · `Still counts in your log and volume.` · pain line `This also puts a pain flag on Bench press: no increases until you clear it.` · row words `· Spotted` · Overview `Spotted · not counted` · `Last (1 Oct): 100 kg × 8 · spotted` (**actual**) · toast `Set 2: spotted · not counted for records` [Undo] · audit `Set 2 marked: spotted` · hold `No counted sets on 8 Oct (all left out); holding.` · summary `Not compared: the only top set was spotted.` · pain card chip `Leave set 2 out of records` |
| May hurt | Tag `May hurt` · confirm `Overhead press may hurt` / `You flagged shoulder pain on it on 6 Oct. Loads won't go up while the flag is on.` [Add anyway] [Choose another] |
| Pain check | `Overhead press: still hurting?` · `Pain flag since 6 Oct · 16 days` · [Still hurts] [Better…] · note `Pain flag: no increases · check due` · outcome `Pain flag kept · next check 3 Nov` [Undo] · 4 weeks: `It's been 4 weeks. Pain that lasts this long is worth getting checked by a physio or doctor.` |
| Pain flag sheet | `Pain flag` · `Overhead press · shoulder` · `Since 6 Oct (16 days) · you, during Push A` · `No increases in load, reps or sets.` · `Still hurts?` · [Still hurts] [Better: clear…] · `Before the flag` · `Since the flag` · `If pain is sharp, keeps coming back or doesn't settle, see a physio or doctor. The coach can't diagnose.` · `Clear flag…` · `All pain flags ›` |
| Clear confirm (AW10) | `Clear the pain flag on Overhead press?` · `Loads, reps and sets can go up again, starting from your recent sets. Your sets from before 6 Oct stay in your history as the reference.` [Clear flag] [Keep it] · toast `Pain flag cleared for Overhead press` [Undo] · guard note `Not raising faster than one step: pain flag cleared 14 Oct.` |
| Time left (**estimate**) | `About 35 min left · ends about 19:40` · `About 35 min left · on track for 19:45` · `About 35 min left · about 10 min past 19:30` · `Paused · about 35 min left after you resume` · `About 2 min left` · `Under 2 min left` · VoiceOver "Workout estimate: about 35 minutes left, ending about 7:40 PM." |
| Time left sheet | `Time left` · `About 35 min · likely 30–40 min` · `Ends about 19:40` · `Left to do` `11 sets · 3 exercises` · `Planned rest` `18 min` · `Your pace` `1:05 a set · 2 min between exercises` · tags `From this workout` / `Your last 5 workouts` / `Default` · `So far` `24:31 active` · `Finish by` `Not set` · `Shorten to fit…` · `This is an estimate from your pace and rest settings. It doesn't change your sets.` · offline `Coach offline. Skip exercises from their ⋯ menu.` |
| Shorten (step 4) | Offer `About 10 min past 19:30. Shorten the rest of today?` / `11 sets left · about 35 min (estimate)` [No thanks] [Shorten] · banner `Coach shortened today` · `About 50 → 20 min · kept Bench press and Cable row. Skipped Cable fly (3 sets) and Curl (3 sets).` · guard `Loads and rest unchanged.` · set status `Skipped · to save time` · outcome `Bench press and Cable row alone take about 28 min. Skipped everything else.` · picker `Fit into` / `Finish by` |
| Gym switch (2026-10-09; the card's strings are owned by gym-switch.md §5) | Divider `At Hotel · Lisbon` · done-set gym caption `Main Gym` · `SnapNote` (**targets**): `Capped: the most here is 20 kg each. Plan was 32.5 kg each.` · `Rounded from 22.5 kg each to 45 lb each to match this gym.` · `not_here` warning `No Cable station at Hotel · Lisbon. Plan was 50 kg stack.` `Swap ›` · `Why?` `Equipment` row `Capped at 20 kg each at Hotel · Lisbon. Plan was 32.5 kg each (Main Gym).` / `Back to the planned load at Main Gym.` · toasts `Switched to Hotel · Lisbon. Remaining sets updated for today.` [Undo] · `Switched to Home. No targets changed.` [Undo] · `Can't undo: your workout changed since the switch.` |

Spoken cues (cue mode `Set cues` or `Conversation`; full table in rest-state.md §5):
- Set intro (optional, off by default): "Bench press. Set 2: 100 kilos, target 6 to 8 reps."
- On commit: "Logged 100 kilos for 8. Rest 3 minutes." (actual result + rest)
- Superset member: "Logged 50 on the stack for 12. Face pull next."
- Timed end: "Time."
- Final set: "Logged 100 kilos for 8. That was the last set."
- (2026-10-09) Only when Ben asked by voice, never on their own, and never in Quiet mode:
  - Why: "Target 100 kilos, 6 to 8. Built-in rule: every set reached 8 last time, so one step up." (target + the stored reason; a coach reason is introduced as "The coach said: …")
  - Exclusion: "Set 2 marked as spotted. It won't count for records."
  - Pain check: "Pain flag kept. Next check 3 November." (no spoken question is ever raised unprompted)
  - Time left: "About 35 minutes left, ending about 7:40." (estimate)
  - Shorten (step 4): "Shortened today: about 20 minutes left. Loads unchanged."

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
- **Competitor follow-ups 3, 8, 9 and 10 (2026-10-09).** All local and deterministic except the step 4 shorten. Proposed contracts, for the developer and Ben:

| Function / type | Contract |
|---|---|
| `TargetProvenance` (stored with every target when it's made) | `{source: 'plan' \| 'rule' \| 'rule_offline' \| 'coach_next' \| 'coach_today' \| 'warmup_ramp' \| 'backoff' \| 'swap' \| 'builder' \| 'ben_chose_rule', setAt, setAfterSessionId?, basisSetIds[], excludedSetIds[{setId, reasons[]}], ruleOutcome? {kind, text}, coachReason?, actionId?, guardNotes[], stepCard? {from, to, pctChange, nextUp?, nextDown?, atMax}, painHold? {flagId}, builtInAlternative? {load, reps}, basisVersion}`. Written by `calculateNextTargets`, `applyCoachProposal`, the routine snapshot in `startWorkout`, the warm-up ramp and `swap_exercise`. Your data |
| `explainTarget(sessionId, setId)` → `TargetExplanation` | Pure read of the stored provenance plus `getPainReference` and a basis-edited check (`basisVersion` vs the current version of the basis sets). Returns the panel rows in order, each with its text and kind (`actual` / `target` / `coach_words`). Never calls a rule or the coach |
| `buildActiveSetView` additions | Per set: `target.hasExplanation`, `exclusions[]`. Per exercise: `painFlag? {flagId, area?, since, checkDue}`. Session: `timeLeft` (the `estimateRemainingDuration` result) and `finishBy?` |
| `setTargetSource(sessionExerciseId, 'rule', baseVersion, opId)` | AW4. Pending sets of that exercise today take `builtInAlternative`; one versioned action with `undoAction` |
| `WorkoutSet.exclusions: ('spotted' \| 'pain' \| 'technique' \| 'other_equipment')[]` | Set by `correctSet(setId, {exclusions}, expectedVersion)` or `log_set.exclusions`; audited. Adding `pain` sets the movement's flag in the same transaction when none is active (AW7) |
| `isSetCountable(set, purpose: 'record' \| 'e1rm' \| 'progression' \| 'comparison' \| 'trigger' \| 'volume')` | Pure, `packages/domain`. `false` for flagged sets on every purpose except `volume` (AW8). Used by `calculateNextTargets`, `evaluateCoachTrigger`, `buildWorkoutSummary`, `getPersonalRecords`, `getExerciseTrend` and `estimateOneRepMax` callers |
| `recordPainFlagReview(flagId, 'still_hurts', opId)` · `PainFlagReview {flagId, at, answer}` | Your data. Never clears a flag. Sets the next due date (`timing.painReview`) |
| `getPainFlagChecksDue(ownerId, now)` | Flags whose check is due; used by `buildActiveSetView` and `buildTodayView` |
| `clearPainFlag(painFlagId, expectedVersion)` | Existing (coach-memory §6); explicit only |
| `getPainReference(flagId)` | The last comparable session before the flag was set, as actual sets; `null` if none. Shown for `timing.painReferenceWindow` after clearing |
| `validateCoachProposal` guard kinds | `return_to_load_blocked` (no jump over one step within 8 weeks of a cleared flag, until a playbook rule is approved), `shorten_no_increase`, `rest_unchanged` |
| `estimateRemainingDuration(session, {now, pace?})` | §2.15.2; pure; unit-tested |
| `getSessionPace(ownerId, sessionId)` | Pace samples from this workout and the last 5 finished workouts (pause-aware, gaps over 15 min dropped) |
| `setSessionFinishBy(sessionId, localTime \| null, expectedVersion, opId)` | Today only; Your data |
| Step 4: `evaluateTimeTrigger(timeLeft, finishBy, alreadyOffered)` → `{triggerId, kind: 'over_time', fact}` or `null`; `requestCoachAdjustment(…, {intent: 'shorten', targetMinutes? , finishBy?}, …)` | Pure trigger; the shorten request reuses the coach-adjustment path (coach-adjustments §4.1) |

- **Gym switch and re-snap (2026-10-09, [gym-switch.md](gym-switch.md) §6).**
  - `setActiveGym(gymId, sessionId)` → a `change_gym` proposal built by the pure `snapPlanToGym` (shared with Repeat and routine Start). `confirmProposal` applies the reducer command `change_gym`; Undo is `undo_change_gym`.
  - `buildActiveSetView` adds per set `target.snap {intended, outcome, reason, equipmentName, gymName}` (from `planned.snap`), per exercise `parts[] {gymId, gymName, equipmentId, setIds}`, and per session `gymChanges[]` and `openGymProposal`.
  - `explainTarget` fills the `Equipment` row from `planned.snap` when its outcome isn't `exact`. `TargetProvenance` keeps the author; `planned.snap` is the equipment fit, which a switch can change without changing the author. The developer may store it as `TargetProvenance.fit` instead. Either way, `snapPlanToGym` writes it.
  - The `target_dropped` warning above is read from `planned.snap`, not from start-time warnings, so it survives a relaunch.
  - Schema proposals GS-S1–S5 (gym-switch §6.5).

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
17. Switching gym mid-session shows a review card for pending sets only. Completed sets keep their original gym and equipment. (2026-10-09) The full switch checks are gym-switch.md §7; this screen's share is checks 63–70.
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

**Why?, exclusions, pain flags and time left (2026-10-09)**

36. A full workout of matching sets with none of the new controls touched takes exactly as many taps as before: `Why?`, the exclusion chips, the pain check and the time line add none.
37. Every target line on the focused card (Ready, and `Up next` in Resting) has `Why?`. One tap opens the panel inline; Log stays visible and works with the panel open, and logging closes it.
38. With airplane mode on and no AI connected, `Why?` shows the same rows as online, including a stored coach reason, and makes no network call (check the provider log).
39. For a built-in target the panel shows `Set by` with date, `Last time` as actual sets with date and equipment, the rule's own explanation and the step with its % (matching `calculateNextTargets` and `buildStepCard` in a unit test).
40. For a coach next-session target the label on the card is the plain `Target` (no `Coach target`, no `C`), and the panel shows `Coach`, the quoted stored reason, any guard note and `Use built-in rule: …`. Tapping that changes only today's pending sets of that exercise, guards Log for 1 s if its label changed, and `Undo` restores the coach target.
41. A coach change made today still shows `Coach target` + `Plan was …`, and its panel has `Undo this change`.
42. Correcting the basis session after the target was set shows `Based on 1 Oct before you edited it on 2 Oct.`; the target doesn't change by itself.
43. A target with no stored provenance shows `Not recorded (set before this app version)`, never an invented reason.
44. No text in the panel other than the quoted `Coach` row comes from the model (fixture test: wipe the coach reason and the other rows are unchanged).
45. Marking set 2 `Spotted` in the correction sheet keeps it in the mini list with `· Spotted`, in the summary's working-set count and in volume, and leaves it out of records, estimated 1RM, the summary comparison and the next built-in target (unit tests on `isSetCountable` for every purpose).
46. A set marked spotted never raises a coach offer; marking it while its offer shows removes the offer.
47. Marking a set `Pain` sets the movement's pain flag in the same commit (the `PainFlagNote` appears) and shows the professional line on the pain card. Unticking `Pain` later leaves the movement flag on.
48. Voice "that was spotted" after set 2 marks set 2 only, shows the strip with Undo, and Undo removes the mark. "100 for 8, spotted" logs one set with the mark.
49. Every exclusion is visible as text wherever the set appears (mini list, Overview, `Last` line, summary, Progress), is audited in `Edit history`, and can be removed.
50. In `Add exercise`, a pain-flagged exercise shows `⚠ May hurt`; tapping it asks `… may hurt` before adding, and `Choose another` adds nothing. Unflagged similar movements are not tagged.
51. A flag set 14 days ago shows `check due` on its `PainFlagNote` and, after the first set of that movement, the `PainReviewLine` once in the rest card; it never shows as a modal, banner or notification, and is never spoken.
52. `Still hurts` keeps the flag, shows `Pain flag kept · next check <date 14 days later>` with Undo, and the check doesn't reappear in that workout. The second consecutive `Still hurts` adds the professional line.
53. No path clears a flag without `Clear flag` in the confirmation: not the check, not time, not the coach, not voice alone.
54. After clearing, the history, records and Progress chart from before the flag are unchanged; `Why?` shows `Before flag` for 8 weeks; the next targets continue from the recent sets with a normal step.
55. Within 8 weeks of clearing, a coach next-session target more than one achievable step above the last session is never applied by default; with no approved return-to-load rule, it's dropped with `Not raising faster than one step: …`.
56. The `TimeLeftLine` shows `About N min left · ends about hh:mm`, never seconds, and changes only on events or once a minute. It is hidden with the keypad open and when all sets are done, and never sits in the top bar.
57. Unit test: 6 pending sets with 2:00 rest each, a measured pace of 1:00 a set and one exercise change of 2:00 gives 6 × 1:00 + 5 × 2:00 + 2:00 = 18 min, shown as `About 20 min left` (rounded to 5 min). Paused time and a 40-minute gap never enter the pace.
58. With no logs at all, the sheet shows `Default` pace and the line still says `About …`.
59. Setting `Finish by 19:30` changes only the line's wording; no set, load or rest changes, and `Not set` restores the normal wording.
60. With the coach offline, `Time left` and `Finish by` work fully, no shorten offer appears, and (from step 4) `Shorten to fit…` explains `Coach offline. Skip exercises from their ⋯ menu.`
61. (Step 4) "I've only got 20 minutes" skips only pending sets of today, keeps the main lifts first, never raises a load or shortens rest, shows `About 50 → 20 min` from `estimateRemainingDuration`, and `Undo` restores every still-pending skipped set. The routine is unchanged.
62. (Step 4) The shorten offer appears only when `Finish by` is set and the estimate is at least 5 min past it, at most once per workout, only in the rest card; nothing changes until `Shorten`.

**Gym switch (2026-10-09, [gym-switch.md](gym-switch.md))**

63. From Ready, a gym switch takes 3 taps (gym chip, gym row, `Switch`). Log stays visible and tappable while the switcher and the card are open, and the card never opens a sheet by itself.
64. After switching, Incline DB press with set 1 logged at Main Gym shows `✓ 1 32.5 kg each × 9 Main Gym`, then the `At Hotel · Lisbon` divider, then sets 2–3 with `Target 20 kg each` and the capped `SnapNote`. Set numbering runs 1–3 across the parts.
65. A pending exercise with no equipment at the new gym shows `Target … · no load target`, the `not_here` warning and `Swap ›`. The primary is `Log …` from a same-part draft, or `Enter load`. No load from the earlier gym is ever drafted (§4.2 rule 3).
66. Steppers, keypad step keys, `Machine busy` and the gym chip's busy count use only the current gym's equipment. Correcting a set done at Main Gym uses Main Gym's equipment and adds no `off_profile_load`.
67. `Why?` on a fitted target keeps its original `Set by` and shows the fit in `Equipment`. A plain rounding has no `SnapNote` but appears in `Why?`.
68. With the switch card open, an offer or coach banner is hidden and comes back after `Not now` only if still valid. Choosing a gym while `Coach is working…` cancels that request, and the card says so.
69. When `Switch` changes the active set's Log label, a Log tap within 1 s is ignored. Rest, pause state and the elapsed clock are unchanged by the switch.
70. After a force-close, the `not_here` and dropped-target warnings show the same text as before, because they're read from `planned.snap`.

The full coach-adjustment checks are in [coach-adjustments.md](coach-adjustments.md) §7.

## 8. Decisions and follow-ups (revision 2026-10-09)

### 8.1 Design decisions to confirm with Ben

The four features are approved (CHANGELOG 2026-10-09). These are the design calls inside them.

| # | Decision | Reason | Alternative |
|---|---|---|---|
| AW1 | `Why?` opens an **inline panel** under the target line, not a sheet | Log and the rest timer stay visible and usable. A sheet would cover the action bar between sets | A medium-detent sheet (more room, but it hides Log) |
| AW2 | Under D21, targets the session **started with** keep the plain `Target` label whoever set them. `Coach target` + `Plan was` (and Overview `C`) mark only changes made **today**. The source is in `Why?` | The coach is now the default for next-session targets, so a tag on every coach-set target would be on nearly every set and stop meaning anything. The summary already showed each change with Undo. Today's changes still need the marker because they differ from what Ben saw at the start | Tag every coach-set target `Coach` |
| AW3 | `Why?` shows **stored** provenance from when the target was made; it never recomputes | It tells what actually produced the number. Recomputing could show a reason that didn't exist at the time | Recompute on open (risks explaining a different number) |
| AW4 | For a coach next-session target, `Why?` offers `Use built-in rule: …`, applied at once to today's pending sets of that exercise, with Undo | D21's Undo lives on the summary until the session starts. Once Ben is lifting, this is his one-tap way back, and it's his own request (rule 3) | No in-session way back except editing each set |
| AW5 | Four exclusion reasons (`Spotted`, `Pain`, `Form broke`, `Other equipment`), multi-select, set only by Ben, never inferred | Matches the approved item 9. Inferring "spotted" from a rep jump would be invented data (rule 6) | A free-text reason |
| AW6 | An exclusion is a versioned, audited **correction**, never a deletion | The set happened; rule 2 and the edit history stay intact | — |
| AW7 | Marking a set `Pain` also sets the movement's pain flag | Rule 9: a pain mention stops progression for that movement. Over-flagging is the safe direction (coach-memory CM4) | Mark the set only, and ask about the movement |
| AW8 | Flagged sets **still count** in working sets, volume and sets per muscle; they're left out only of records, estimated 1RM, progression and comparisons | The work was done, and leaving it out of volume would understate training. The approved item lists only PRs, e1RM and progression | Leave them out of volume too |
| AW9 | `Still hurts?` every 14 days, asked in place (rest card once, `PainFlagNote`, a quiet Today row); never a notification, banner or spoken prompt; no answer keeps it due | "Ben clears explicitly", with no nagging (v0.7 safeguards). The rest card right after the movement is when he knows best | A notification every 14 days (not allowed without nagging; push isn't available anyway) |
| AW10 | Clearing keeps the pre-flag sets as the **reference**, targets carry on from the recent sets, and a return towards the pre-flag loads is only a coach proposal once the training-researcher's rule is approved. D21's default doesn't cover it | Item 8 as approved; rule 9 (no diagnosis, no "safe to return") | Built-in return-to-load steps (needs an evidence-graded rule first) |
| AW11 | Time left sits on the card's last line (plus Overview and Today's Resume card), **not** in the top bar | The top bar clock is a fact (elapsed); an estimate there would read as a countdown. "What comes next" is where the card already answers the future | Replace the elapsed clock with time left |
| AW12 | `Finish by` (today only) is the only time input; the coach's shorten offer can fire only against it. No built-in trim offline in this version | Keeps the coach from raising time on its own without a signal Ben gave (rule 3). An offline trim needs its own rule | A built-in `shortenSession` that skips accessories last-first, labelled `Built-in rule` |
| AW13 | A shorten Ben asked for (or accepted) applies at once with Undo, skips only pending sets, and never raises loads or cuts rest | CLAUDE.md rule 3 and coach-adjustments CA1/CA2; the brief's "not extra rushed work" | Show it as a `ChangeReviewCard` with Apply (one more tap) |

### 8.2 Follow-ups for other specs (not edited here)

These files are owned elsewhere or were outside this task. Each item states what must change to match this spec.

- **coach-memory.md:** §2.7 clear-confirmation copy → AW10 text (§2.14.3). §2.5 pain card adds the opt-in chip `Leave set 2 out of records` when set during the rest straight after a set. §2.1 Pain flags rows show `Check due` when due (status `exclamationmark.triangle` + words). §6 adds `recordPainFlagReview`, `getPainFlagChecksDue`, `getPainReference`.
- **workout-summary.md:** exercise rows show exclusion words; `Compared with last time` skips flagged sets (`Not compared: the only top set was spotted.`); `Next time` holds with `No counted sets on 8 Oct (all left out); holding.`; the exercise row line `Coach shortened today: skipped Cable fly (3 sets)` (step 4); §3 "If D21 option A" is now the live state (separate D21 follow-up).
- **coach-adjustments.md:** `intent: 'shorten'` and `origin` for the time trigger; guard kinds `shorten_no_increase`, `rest_unchanged`, `return_to_load_blocked`; coach-slot priority adds the `PainReviewLine` as the lowest item.
- **rest-state.md §2.1:** region list gains the `PainReviewLine` (in the coach slot) and the `TimeLeftLine` as the last line.
- **voice.md:** the deterministic phrases in §4.10 (why, exclusions, pain check, time left, finish by, add-a-flagged-exercise question).
- **design-system.md:** merge §9 below when the other agent's edit lands (`AvailabilityTag` text `May hurt`; new components and tokens).
- **training-researcher:** a playbook candidate rule for returning to load after a pain flag is cleared (how fast, how far, evidence grade). Until Ben approves one, AW10's validator block stands.
- **lock-screen-and-alerts.md:** time left isn't on the Live Activity in this version; a later option.

### 8.3 Build status and open items (developer, 2026-10-10, `claude/active-set` review fixes)

Not built yet (review N6), so these checks are partial until they are:

- Overview `Why?` and the time-left line at the end of Overview (there is no Overview view yet).
- An `Edit history` UI using `exclusionAuditLines` (check 49 is partial: the words show on the card, toast, summary and `Why?`).
- `isSetCountable` purposes `trigger` and `e1rm`: no coach offers or estimated 1RM exist yet; both already return "not counted" for a flagged set.
- The `History ›` footer in the `Why?` panel.
- `Use built-in rule` / `Undo this change` in `Why?` (coach targets, build step 4).
- `Finish by` uses a ±5 min stepper, not the wheel in §2.15.3 (works; designer to confirm).

Implemented differently from this spec, for the designer and Ben to confirm:

- **Undo of a flag Ben just set is a retraction, not a clear** (review B2 / S2). The `Pain noted` toast and the exclusion toast's Undo mark the flag `retracted`: as if it never existed (no `Before flag` reference, not listed, no return-to-load guard, can't be cleared or restored). It's versioned against the flag the action produced; a flag changed since is kept and Ben is told (`Set undone. Pain flag kept: it changed since.`). `Clear flag` with the AW10 confirmation stays the only clear.
- **Minimal copy** (CLAUDE.md, 10 Oct; review S1): the Time left sheet footnote, `Still counts in your log and volume.` and the Profile › Pain flags lead text are not shown; the Pain chip line is `Also flags Bench press for pain`. §5 still lists the old strings and needs the designer's revision.
- **Next-session targets from the built-in rule** keep rule provenance (`Built-in rule · after …`), not Repeat; the no-history starting plan records `Starting plan: 3 sets of 3–6 reps. You choose the load.` (review B1.1).
- **Records and the Today lift highlight** (added on the base branch) read `isSetCountable`: a marked set is never a record, a top set or a trend point (check 45).
- **Two estimators of §2.15.2**: `duration.ts` (Up next and the routine sheet, a workout not started yet) and `time-left.ts` (`estimateTimeLeft`: the workout in progress, with pause, range and `Finish by`). They were built in parallel and differ slightly (rounding under a minute, pause handling). Follow-up: fold `duration.ts` into `estimateTimeLeft` so there is one rule.
- **Schema**: exclusions, `Finish by` and the `retracted` pain flag status are one migration (schema 4). `claude/gym-switch` also has an unreleased migration 4. **Gate (review r2 N3):** no `.ipa` from either branch until whichever merges second has renumbered its migration and a backup taken at the merged schema restores. Migration 4 rebuilds `pain_flags` (drop and rename); any later migration that adds a foreign key or trigger on that table must come after it. **Merged 10 Oct:** gym switch merged second and is now migration 5 (ADR 0019); a schema-4 backup restores and migrates to 5, and a schema-5 backup of a switched workout with exclusions and `Finish by` round-trips (`packages/persistence/test/backup.test.ts`). The gate's real-device part (a backup taken on Ben's phone restoring) still needs a device pass.
- **Merging with `claude/coach`** (review r2 N4): `PainFlag.status` gains `retracted`. Coach code that reads `status === 'cleared'` as "not active" must use `status !== 'active'`, and must use the retraction-aware `clearPainFlag` / `restorePainFlag`.
- **AW7 "in the same commit"** (review r2 S3): services have no transaction across `painFlags` and `sessions`, so `correctSet` writes the flag, then `correct_set`, and takes the flag back (retracts it) if the mark doesn't land, including when the write throws. Only an *active* flag of the save's opId counts as that save's, so a retry after a failed save writes a fresh flag rather than pointing at a withdrawn one (review r2 B1). A cross-repository transaction would remove the compensation; it needs an ADR (persistence contract change) and is not built.

Open question for Ben (review S3): a pain flag set mid-workout leaves today's already-planned targets as they are (`Flagged after this target was set, so the target wasn't changed.`). Rule 9 says a pain mention stops progression for that movement. Should setting a flag offer (or apply, with Undo) "hold today's remaining sets at the last done load"? Not built until Ben decides.

## 9. Tokens and components to merge into design-system.md (revision 2026-10-09)

design-system.md is being edited by another agent, so these are specified here. **No new colour values; one accent kept.** All of them use existing tokens.

**Timing and domain constants**

| Token | Value | Use |
|---|---|---|
| `timing.painReview` | 14 days | A pain flag's `Still hurts?` check falls due this long after it was set or last checked |
| `timing.painReferenceWindow` | 8 weeks | `Before flag` shows this long after a flag is cleared; the return-to-load guard applies for the same window |
| `timing.timeLeftRefresh` | 60 s | The `TimeLeftLine` recomputes at most this often between events |
| `timing.shortenOfferOver` | 5 min | Step 4: the estimate must pass `Finish by` by at least this much before the coach may offer to shorten |
| `pace.defaultSetSeconds` | 45 s | Per-set time over planned rest when Ben's own pace isn't known yet (`Default`) |
| `pace.defaultChangeoverSeconds` | 120 s | Time between exercises over planned rest, when not known yet |
| `pace.maxGap` | 15 min | Gaps longer than this are left out of pace samples |
| `pace.minSamplesSession` | 3 | Gaps needed before this workout's own pace is used |
| `pace.recentSessions` | 5 | Finished workouts used for pace before that |

**Components**

| Component | Spec |
|---|---|
| `TargetWhyLink` | Text button at the trailing end of the target line: `Why?` / `Hide`, `type.callout`, `accent`, hit area `target.workout` (52pt) not overlapping the line's other targets. Hidden with the keypad open. VoiceOver "Why this number?" / "Hide explanation", button |
| `TargetWhyPanel` | Inline block under the target line: `bg.raised`, `radius.sm`, padding `space.3`, rows `space.2` apart. Each row: label column (`type.label`, `text.secondary`, fixed width ≈ 96pt) + value (`type.callout`, `text.primary`, tabular numbers). At AX1+ the label sits above the value. `Coach` row: `SourceTag` `Coach` + the reason in quotes. `Pain` row: `exclamationmark.triangle` in `status.warning` + text. Footer: text buttons in `accent`, `target.workout` hit areas, ≥ `space.8` apart, two per line at most. Expands within `timing.fast`; none under Reduce Motion. No border, so it doesn't read as a card that needs action |
| `ExclusionTag` | The `Tag` frame (§9.28) with the reason words (`Spotted`, `Form broke`, …); no icon, no colour. In Overview it's a second row line `Spotted · not counted` in `type.label`, `text.secondary`. VoiceOver appends "not counted for records or progress" |
| Exclusion chips | `ParamChip` multi-select, 52pt, in the correction sheet under a `type.label` heading; wrap two per row at AX1+ |
| `PainReviewLine` | A `CoachOfferLine` frame (§9.14) without the coach meaning: line 1 question `type.callout` `text.primary`; line 2 fact `type.callout` `text.secondary`; text buttons `Still hurts` (left, `text.primary`) and `Better…` (right, `accent`), `target.workout`, ≥ `space.8` apart. Lowest priority in the coach slot; never spoken; VoiceOver announces it politely once |
| `PainFlagSheet` | System sheet, medium detent: `exclamationmark.triangle` `status.warning` + `Movement · area` (`type.headline`); source/date and effect lines; optional `Still hurts?` with two `SecondaryButton`s (52pt); `Before the flag` / `Since the flag` rows (actual, tabular); the professional-help line; `Clear flag…` (default-style text button, not `DangerTextButton`: clearing isn't destructive) and `All pain flags ›` |
| `PainFlagNote` (change) | Adds the suffix `· check due` when the check is due; tap opens `PainFlagSheet` instead of the Pain flags list |
| `AvailabilityTag` (change) | `⚠ May hurt` replaces `⚠ Pain flagged` (`exclamationmark.triangle`, `status.warning`) |
| `TimeLeftLine` | `clock` icon (`text.secondary`) + `type.callout` `text.secondary`, tabular; the whole line is a ≥ 44pt button opening `TimeLeftSheet`. Never in the top bar, never seconds, never animated. VoiceOver "Workout estimate: …" |
| `TimeLeftSheet` | System sheet, medium detent: headline estimate `type.title2` ("About 35 min") + range and end time `type.callout`; label–value rows as `SettingsRow` metrics; the pace row carries a `SourceTag` (`From this workout` / `Your last 5 workouts` / `Default`); `Finish by` as a `SettingsRow` with a wheel; `Shorten to fit…` as a `SecondaryButton` (step 4); footer `type.callout` `text.secondary` |
