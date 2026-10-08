# Active workout (focused set card and Overview table)

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
3. **Banner slot (0–2 banners).** Restored, offline-and-coach, equipment warnings, paused.
4. **Content (scrolls).** The focused card or the Overview table.
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
│ Bench press                     ⋯      │ exercise header (tap → history)
│ Barbell · Working · Set 2 of 4         │
│ Last (1 Oct): 100 kg × 8               │ previous comparable, tap = copy
│                                        │
│  Load                    Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │ NumberSteppers (draft actual)
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │ target, always labelled
│  Rest after: 3:00 ›                    │ resolved preset, tap to edit
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
│ Bench press · Set 3 of 4 next          │
│ ┌────────────────────────────────────┐ │
│ │ Rest                               │ │
│ │              2:47                  │ │
│ │  [ −30 s ]   [ +30 s ]   [ Skip ]  │ │
│ └────────────────────────────────────┘ │
│ ✓ Set 2 saved: 100 kg × 7              │
│ Effort (optional)  6  7  8  9  10      │
│                                        │
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
│ ○ 4    95×8        95×8–10      —      │
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

### 2.5 Voice strip (optional layer; `DEP-STT` / `DEP-AI`)

```
├────────────────────────────────────────┤
│ ● Mic on · Listening…        [ Stop ]  │ red dot + text
│ "one hundred kilos eight reps"         │ live transcript (if available)
├────────────────────────────────────────┤
│ [ ■ ] [       Log 100 kg × 8         ] │ Log still visible and usable
```
Strip states:
- `Listening…`
- `Working out what you said…`
- `Heard: 100 kg × 8, RPE 8 · saved`
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

### 2.8 Paused

```
│ ⌄  Push A        ⏸ 24:31 Paused    ⋯  │ elapsed frozen, warning colour + text
├────────────────────────────────────────┤
│ ⏸ Workout paused. Timers are stopped.  │ warning banner
│ ... card shows rest frozen at 1:10 ... │
├────────────────────────────────────────┤
│ [ 🎙 ] [           Resume            ] │
```

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
| All sets done | Card: `All planned sets done.` + links `Add set` / `Add exercise` | `Finish workout` | No rest after the final set |
| Paused | §2.8 | `Resume` | Log is hidden until Resume. Fields stay editable |
| Restored after force-close | Normal + banner `Workout restored. Nothing was lost.` (4 s) | per state | See flow §4.2 |
| Offline | No change to logging | per state | Status row: no banner unless Ben opens the coach. The Talk button shows `Offline` if the coach needs the network |
| AI unavailable | No change to logging | per state | Talk button `Offline` / `Ask`. Coach sheet explains (§4.7) |
| Voice unavailable, text available | — | — | Talk button shows `Ask` (text bubble). Tapping opens the coach sheet |
| Coach proposal pending | `ChangeReviewCard` inline under the rest timer (Focus) or under the active exercise (Overview) | unchanged | It never takes over the screen |
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
- **Matching set:** one tap, nothing else.
- **Different result, reps:** tap `−` on reps (once per missing rep), then Log. Two taps for a single-rep miss.
- **Different result, load:** tap `−`/`+` to the next feasible load, or tap the load field to use the keypad. Typing replaces the value, `Next ›` moves to reps, and `Done` hides the keypad. Log stays visible above the keypad the whole time.
- **Copy last time:** tap the `Last (1 Oct): 100 kg × 8` line. The fields are set to those values and the caption reads `Copied from 1 Oct`. That line never logs anything itself.
- **Keyboard shortcuts:** Return on reps acts as `Done`. Cmd+Return logs.
- **Voice:** see §2.5 and flow §5.1. "Done" or "log it" logs the displayed values only if Ben has enabled the shortcut (Voice & alerts → `Say "done" to log shown values`, off by default) and there is exactly one active set.

### 4.2 Draft prefill rules (deterministic, done by `buildActiveSetView`)

Rules, in order:
1. If a draft was saved for this set (edited earlier or restored after a force-close), use the draft.
2. If the set has a target load, use it for load. For reps, use the single target, or the **top** of a target range (the double-progression aim).
3. If there's no target (empty workout), use the last logged set of this exercise in this session.
4. If there's still nothing, use the last comparable session's matching set from `getComparableHistory`.
5. Otherwise leave the field empty, and Log is disabled.

The view returns `draftSource` (`draft | target | this_session | last_session | none`). If the source isn't the target, a caption under the fields shows it: `From your last set` / `From 1 Oct`.

### 4.3 Equipment-aware input
- The steppers move through `getAchievableLoads(equipmentId)`, so `+` on 100 kg barbell goes to the next achievable total, such as 102.5 kg.
- At the maximum, `+` is disabled and its hint says `Rack maximum 30 kg each`. The targets themselves are never above the maximum, which is the domain's job.
- Typed loads that aren't achievable show a warning under the field: `37.5 kg each isn't on Main Gym's dumbbell rack (max 30 kg). Log it anyway if that's what you lifted, or update the gym.` with an [Update gym] link. Log still works, and the set is saved with an `off_profile_load` flag.
- Assisted machines: the field label reads `Assist`. The `+` hint reads `More assistance (easier)`.

### 4.4 Set and exercise controls
- **Exercise header tap** opens the history sheet: comparable history from `getComparableHistory` and technique or setup notes.
- **Exercise `⋯` menu:** `Add set`, `Swap exercise` (→ `rankSubstitutions` list → `ChangeReviewCard` with scope `Today only`), `Machine busy` (calls `setTemporaryAvailability`), `Notes`, `Skip exercise` (marks the pending sets skipped, with an undo toast).
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
  - `Save changes` calls `correctSet(setId, patch, expectedVersion)`. The row gets an `Edited` tag. Rest is not touched. There is no AI replanning, and targets update only through the deterministic rules.
  - `Delete set` asks for confirmation (`Delete set 1? You can undo this.`) and gives an undo toast.

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
  - `Edit workout times` (calls `updateSessionTiming`)
  - `Discard workout` (destructive; red text)

### 4.7 Coach and Talk
- **Tap Talk when voice is available:** this calls `startVoiceSession`, and the voice strip appears. Tap again (or `Stop`) to end listening. Speaking is interrupted with the same button (`interruptSpeech`).
- **Long-press Talk, or `Type instead`:** opens the coach sheet at medium detent with the active-session context. Ben swipes the sheet down to get back to Log. The sheet never opens on its own.
- **Tap Talk when the coach is unavailable:** the sheet shows the honest status and nothing more (`getAiCapabilities` reason), for example:
  - `Coach not connected. Logging, targets and rest timers work without it.` [Connect in Profile]
  - `No connection. The coach needs the internet; your workout is saved on this phone.`
  - `Voice isn't available on this phone yet. You can type to the coach.`
- **Coach suggestions** appear only as an inline `ChangeReviewCard`. `Apply` calls `confirmProposal(proposalId, sessionVersion)` → `applyCoachProposal`, followed by a toast `Remaining sets updated for today` [Undo], and the cue `Remaining sets updated for today.`

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
- If the last set was more than 20 min ago, the end time defaults to `19:24 (last set + 3 min)`, with `Use now (20:41)` as the alternative. The chosen time is recorded through `updateSessionTiming` with an audit, and the original value is kept.
- `Finish` calls `finishWorkout(sessionId, expectedVersion)` → `cancelObsoleteCues` → Summary.

### 4.9 Undo paths (summary)

| Action | Undo |
|---|---|
| Log set | Toast `Undo` (8 s). After that: the done row → Delete set |
| Correction | Toast `Undo` restores the previous version |
| Delete set | Toast `Undo` |
| Skip exercise | Toast `Undo` |
| Applied proposal | Toast `Undo` → `undoAction` (or a compensating proposal if it isn't safe) |
| Discard workout (0 sets) | Toast `Undo` |
| Discard workout (≥1 set) | Confirmation alert first: `Discard Push A? 7 logged sets will be deleted.` [Discard] [Cancel]. No undo afterwards, which is why the confirmation is needed |

## 5. Copy

| Element | Text |
|---|---|
| Header line 2 | `Barbell · Working · Set 2 of 4` (set types: `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop set`) |
| Previous | `Last (1 Oct): 100 kg × 8`. This is an **actual** from history. If the gym or machine differs: `Last (1 Oct, Hotel Gym): …`. If none: `No previous result` |
| Field labels | `Load` (or `Load each`, `Stack`, `Assist`, `Added`), `Reps`, `Time` |
| Target line | `Target 100 kg · 6–8 reps` / `Target 30 kg each · 8–10 reps` / `Target 0:45` |
| Rest line | `Rest after: 3:00 ›` |
| Primary | `Log 100 kg × 8` · `Log 22.5 kg each × 10` · `Log Assist 20 kg × 6` · `Log BW × 12` · `Log 0:45` · `Start 0:45` · `Stop` · `Saved` · `Resume` · `Finish workout` · `Enter reps` |
| Undo toast | `✓ Set 2 saved · 100 kg × 8` [Undo] |
| Next | `Next exercise: Incline DB press` + `Target 30 kg each × 8–10` / `Last set of the workout` |
| Draft caption | `From your last set` · `From 1 Oct` · `Copied from 1 Oct` · `Unsaved edit restored` |
| All done | `All planned sets done.` |
| Banners | `Workout restored. Nothing was lost.` · `Workout paused. Timers are stopped.` · `Couldn't save this set. Your entry is still here.` |
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
- `undoAction(actionId)` handles undo.
- `pauseSession` / `resumeSession`.
- `startWorkInterval(setId, duration)` for timed exercises.
- `finishWorkout(sessionId, expectedVersion)`, `updateSessionTiming(sessionId, correction)`.
- `setActiveGym`, `setTemporaryAvailability`, `rankSubstitutions`, `getEquipmentSnapshot`.
- `buildSetCue`, `scheduleTimerCue`, `cancelObsoleteCues` (cue layer).
- Optional layers:
  - `getAiCapabilities`
  - `startVoiceSession`, `stopVoiceSession`, `transcribeUtterance`, `parseSpokenSet`, `handleVoiceTurn`, `interruptSpeech`
  - `runCoachTurn`
  - `validateCoachProposal`, `confirmProposal`, `applyCoachProposal`, `getDecisionEvidence`
- Proposed new: `saveSetDraft`, `setActiveSet`, `addSet`, `endRestTimer`.

## 7. Acceptance checks

1. A set whose prefilled values match what Ben did is logged in **one tap**, with no dialog, no RPE prompt in the way and no network.
2. A one-rep miss is logged in **two taps** (reps `−`, then Log).
3. With the keypad open on either field, the Log button is fully visible and tappable on a 375pt-wide screen at the default size and at AX3.
4. The Log label always matches exactly what is saved: unit, convention suffix and values. Compare the label with the saved row for 10 sets, including dumbbell (`each`), stack and assisted sets.
5. The load stepper never steps to a load the selected equipment can't make. At the rack maximum, `+` is disabled with a reason.
6. Typing an off-profile load shows the warning, still allows logging, and the saved set carries the flag.
7. Targets are always labelled `Target`, and previous results `Last (date)`. No pending set displays values without the `Target` label or pending style.
8. Each set status (done, active, pending, skipped) can be told apart in greyscale (check icon, triangle, hollow circle, slashed circle, plus text).
9. Correcting a done set doesn't restart or change rest, adds the `Edited` tag, and doesn't trigger any AI call.
10. Switching Focus ↔ Overview while resting keeps the same timer, draft values and active set.
11. In a superset, logging A1 doesn't start rest, and logging A2 does.
12. A timed exercise's work timer runs separately from rest. Its end doesn't save the set unless `Auto-save timed sets` is on.
13. While paused, the elapsed clock and any timer are frozen, the primary reads `Resume`, and Log can't be triggered.
14. Finish is never next to Log. It is only in the `⋯` menu, at the end of the Overview list, or the primary once all sets are done.
15. With AI disconnected, tapping Talk shows an honest status sheet with no fake coach reply, and the workout is unaffected.
16. A coach proposal never opens a sheet by itself. It appears inline with scope, before/after targets, Apply and an Undo path, and it can't change completed sets.
17. Switching gym mid-session shows a review card for pending sets only. Completed sets keep their original gym and equipment.
