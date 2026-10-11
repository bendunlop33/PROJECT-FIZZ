# Gym switch and re-snap (mid-workout switch, Repeat, starting at another gym)

Status: v1, 9 Oct 2026. Finalises GE7 ([gym-editor.md](gym-editor.md) §2.8) for build step 2, after Ben approved competitor follow-up 6 (CHANGELOG 2026-10-09: "mid-workout gym switch re-snap (and Repeat B1)"). Tokens: [design-system.md](design-system.md) (no new tokens; see §9).

**This file is the single owner of how a plan is fitted to a gym's equipment:** when a workout starts from a routine, on `Repeat last workout`, on a mid-workout gym switch, and on `[Use changes today]` after an equipment edit. [gym-editor.md](gym-editor.md) §2.8, [active-workout.md](active-workout.md) and [routines.md](routines.md) §2.4 point here.

Sources: brief §4 and §7 (`setActiveGym`, `getEquipmentSnapshot`), §10 scenarios ("Switch to a hotel gym mid-session: completed sets remain intact; proposed substitutions use that equipment only"; "Home gym has only dumbbells up to 30 kg"); CLAUDE.md rules 2, 4, 5 and 9; [slice-3 review](../reviews/slice-3-and-s1.md) B1, SP1 and SP5; [competitor-landscape.md](../research/competitor-landscape.md) #2(g) and #6 (Liftosaur #282 doesn't re-snap after a switch; Gravl blocks the switch); [change-review.md](change-review.md) CR3 and CR4; [exercise-library.md](exercise-library.md) §2.5 and EL4.

## 1. Purpose

The switch card answers **"I'm training somewhere else now. What can I actually lift for the rest of this workout, and is what I've already done safe?"**

Its single primary action is **`Switch`**. It is a secondary-style button on an inline card, so `Log …` stays the screen's only `PrimaryButton` (design-system §9.11). A switch takes **3 taps** from the set card: gym chip, gym row, `Switch`. Log stays visible and usable the whole time.

The same rules answer the question for Repeat and for starting a routine at another gym: **"Will every target I'm given be a load this gym can make?"**

### 1.1 Decisions in this spec

All of these are within Ben's approval of follow-up 6, except GS13, which is his to decide later. GS4 corrects GE7's card.

| # | Decision | Reason |
|---|---|---|
| GS1 | **One pure function, `snapPlanToGym`, fits every plan to a gym.** It is used by `startWorkout` (routines), Repeat (`buildRepeatSessionDraft` / `startWorkoutFromSession`), `setActiveGym` (switch and `[Use changes today]`) and `validateRoutineForGym` (routine detail notes). Repeat's private `pickEquipment` and `startWorkout`'s ID-only equipment lookup are retired | B1 happened because Repeat had its own path. `startWorkout` has the same gap today: a routine started at a gym that lacks its pinned item keeps its load unchecked (§6.6). One function means one property test guards all four entry points |
| GS2 | **Fit from the intended target, never from an already-fitted one.** Each pending set stores the target as its author set it (plan, built-in rule, coach, swap, or Repeat's "last time"), separately from the fitted load (`planned.snap`, §6.5). Fitting rounds toward easier from the intended target. A fitted target is never harder than the intended one. With an active pain flag on the movement, it is also never harder than the current target | Switching Main → Hotel → Main gives the planned 32.5 kg each back, instead of staying at Hotel's 20 kg. `[Use changes today]` after fixing a wrong rack max restores capped targets (review SP1). Re-fitting twice gives the same result. A pain flag still stops any load from going back up (rule 9) |
| GS3 | **Equipment mapping order** at the target gym: (1) the same item, if it's here and usable; (2) the item this exercise last used at this gym; (3) the first usable item of the same kind that suits the exercise; (4) the first usable item of another kind the exercise lists as compatible; (5) none: `not_here`. "Usable" means available, not out of order and not busy today in this session | Deterministic, explainable, and it prefers what Ben used here before. Step 4 lets a chest press move from a plate-loaded machine to a stack machine and keep working steppers (its load is dropped, never converted) |
| GS4 | **Equipment not here means no load target, with the reps kept.** It never means "kept as planned, loads not checked". The card has **no `[Skip it]` button**. After switching, the set card offers `Swap ›`, and Skip is in the exercise `⋯` | Rule 4. This corrects GE7's `Cable row … Kept as planned, loads not checked [Skip it]` line. A Skip inside the card would also change pending sets and make the card itself go out of date, and it broke all-or-nothing apply (CR3) |
| GS5 | **Swaps are proposed only by a gym switch, and only for a clear match.** For a `not_here` exercise, the top `rankSubstitutions(exerciseId, gymId, 'closest_match')` result is proposed if it has the same movement pattern, is doable with equipment here, and isn't already in today's workout. Its load comes from its own history at that equipment (`nextTargetsFor`), fitted by the same function, or none. Repeat never swaps by itself: its preview shows `Swap ›` | Brief §10 says proposed substitutions use the new gym's equipment only. Repeat promises "what you did last time", so swapping is Ben's call there |
| GS6 | **Completed sets keep their exercise row, gym and equipment.** For an exercise with any finished or skipped sets, the pending sets move to a **continuation row** (same exercise, new equipment, unit and convention). This is the pattern `swap_exercise` already uses for done sets. Exercises with no finished sets are updated in place. The session's equipment snapshot becomes append-only, and the session records each gym change | Rule 2. A session-exercise row holds one unit and one convention, and the reducer and set view rely on that. The data shape is in §6.5 |
| GS7 | **The card is bound to what it changes**, not to `session.version`: the session's gym, its snapshot, the set of pending sets it lists, and each one's planned values. Logging, correcting, undoing, skipping, deleting, adding a set or a coach change makes it **Out of date**. Changing the active set, editing a draft, adjusting rest or pausing doesn't | Rule 5 and CR4, without the false alarms of tapping a different set |
| GS8 | **While the card is open it holds the coach slot.** An offer or a coach-adjustment banner waits and comes back after the card closes, if it's still valid. A coach request still in progress when Ben chooses a gym is **cancelled**, and the card says so | The request was about the old equipment. CA7's retry-on-log rule can't fit a change of equipment |
| GS9 | **Voice:** "switch gym to Home" or "I'm at Home" is a deterministic local command (no coach) that opens the card. Voice can confirm (`switch` / `yes`) **only a card that changes no target**. A card with changes needs a tap | Ben should see swaps and dropped loads before they apply. Narrower than CR6, deliberately. The grammar belongs in voice.md (follow-up in §8) |
| GS10 | **The Repeat preview gets a `GymChip`** (`Checked for [Hotel · Lisbon ▾]`). Choosing another gym there re-checks the preview and starts nothing | The most common gym mistake is starting at the wrong gym. Fixing it before Start avoids a mid-workout switch |
| GS11 | **Two kinds of pending set are never re-fitted:** the pending other side of a half-logged unilateral set, which stays with its logged side's equipment, and a set whose work timer is running or paused. The card names them | The pair is one prescribed set (ADR 0003 R4), done in one place. A running timed set is in progress |
| GS12 | **Drafts:** an edited draft is kept only if it's achievable on the new equipment in the same unit and convention. Otherwise it's replaced by the new target, and the card says so for the active set | A draft that can't be set up here would put an impossible load on the Log button |
| GS13 (Ben, later) | **Sets logged before noticing the gym was wrong** stay as logged. Moving them to the right gym would be an explicit correction with Undo, which is a later slice ([open-decisions.md](open-decisions.md) B21) | Rule 2 forbids silent changes to completed sets. Most real switches will be "I started at the wrong gym", so this is worth Ben's call |

## 2. Layout

### 2.1 Entry points

| From | What happens |
|---|---|
| Workout status row `GymChip` | Gym switcher sheet (gym-editor §2.7, title `Gym for this workout`). Tapping a gym row closes the sheet, and the card appears in the coach slot |
| Today's `GymChip` during an unfinished workout | Same sheet. Choosing a gym opens the workout with the card (today.md §4) |
| `+ New travel gym` → `Save and switch` | Saves the gym (gym-editor §2.6), then shows the card. Nothing switches until `Switch` |
| `[Use changes today]` (gym-editor §4.9), `[Update gym]` → `Save` (active-workout §2.11) | The same card for the same gym, titled `Use updated Main Gym`, button `Apply` |
| Voice "I'm at Home", "switch gym to Home" | The card (§4.4) |
| Coach: "I'm at the hotel gym" | The coach calls `setActiveGym`. The card is authored `Checks` (the numbers come from code). It is never a silent switch |

The card sits in the coach slot: under the rest timer while Resting, under the target lines in Ready, and under the active exercise's header in Overview. It is never a sheet or a full screen.

### 2.2 The switch card (Focus view, Resting)

Example: Push A at Main Gym, bench sets 1–2 logged. Ben moves to Hotel · Lisbon, which has dumbbells 2.5–20 kg each and a bench, but no barbell and no cable.

```
├────────────────────────────────────────┤
│ Bench press · Set 3 of 4 next  Adjust ⋯│
│ ┌────────────────────────────────────┐ │
│ │ Rest               2:47            │ │ rest keeps running
│ │ [ −30 s ]  [ +30 s ]  [ Skip ]     │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ [✓ Checks] Switch to Hotel · Lisbon│ │ SourceTag + title
│ │ [▦ Today only]                     │ │ ScopeBadge
│ │ 2 logged sets stay as they are.    │ │ not-changed line, always first
│ │                                    │ │
│ │ ✎ Bench press · sets 3–4           │ │ ChangeLine: swap
│ │   → DB bench press                 │ │
│ │   Target 22.5 kg each × 6–8        │ │ from its own history (target)
│ │   ⓘ No Olympic bar here.           │ │
│ │ ✎ Incline DB press · sets 1–3      │ │ ChangeLine: capped
│ │   Target 32.5 → 20 kg each × 8–10  │ │
│ │   ⓘ Capped: the most here is 20 kg │ │
│ │     each.                          │ │
│ │ ✎ Cable row · sets 1–3             │ │ ChangeLine: load dropped
│ │   Target 50 kg stack × 12          │ │
│ │   → 12 reps, no load target        │ │
│ │   ⚠ No Cable station here. Swap or │ │ NoteLine warning
│ │     skip it after switching.       │ │
│ │ No change: Lateral raise.          │ │ unchanged, one line
│ │                                    │ │
│ │ Why? ›                             │ │
│ │ [ Not now ]            [ Switch ]  │ │ secondary-style, ≥ space.8 apart
│ └────────────────────────────────────┘ │
│ Up next · Set 3                        │ unchanged until Switch
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │
├────────────────────────────────────────┤
│ [ 🎙 ] [       Log 100 kg × 8        ] │ Log unchanged and usable
└────────────────────────────────────────┘
```

Line rules:
- **One line per exercise that has pending sets**, in workout order. The kinds are swap, re-fitted (rounded, capped, converted or restored), and load dropped. Exercises whose targets don't change are collapsed into one `No change: …` line. Exercises with no pending sets are never listed.
- **Every number is a target**, written `Target …`. The arrow reads "to" in VoiceOver. A dropped load reads `→ 12 reps, no load target`, never `0 kg` or `BW`.
- **Notes** come from the deterministic result (§6.1): `ⓘ` (`info.circle`, `text.secondary`) for facts (rounded, capped, converted, restored, swap reason), `⚠` (`exclamationmark.triangle`, `status.warning`) for a dropped load and for pain.
- **At most 4 change lines** (design-system §9.11). With 5 or more, the card shows the first 3, then `Review all 6 changes ›`, and `Switch` moves to the review sheet (§2.4). The not-changed and `No change:` lines always stay on the card.
- **Extra not-changed lines** appear only when they apply (GS11, GS12, GS8): a half-logged unilateral pair, a running work timer, the active set's replaced draft, a cancelled coach request.
- **Unchecked equipment:** if any item the card relies on is still `Typical values, not checked` (GE1), one more `ⓘ` line says so, with `Check ›` (opens that item's editor as a sheet; after `Save`, the card checks again).

### 2.3 Card variants

Nothing changes (every pending target is already achievable on the mapped equipment):

```
│ ┌────────────────────────────────────┐ │
│ │ [✓ Checks] Switch to Home          │ │
│ │ [▦ Today only]                     │ │
│ │ Home has everything for your 9     │ │
│ │ remaining sets. Targets stay as    │ │
│ │ they are.                          │ │
│ │ [ Not now ]            [ Switch ]  │ │
│ └────────────────────────────────────┘ │
```

Nothing left to update (all sets finished or skipped, or an empty workout): `No sets left to update. Anything you add uses Home's equipment.` with [Not now] [Switch].

Target gym has no equipment set up: every loaded exercise is `not_here`. The card leads with `⚠ Hotel · Lisbon has no equipment set up yet, so remaining load targets are removed.` and `Add equipment ›` (gym-editor §2.3 as a sheet; after `Save`, the card checks again).

Out of date (GS7; design-system §9.11 variant: Switch hidden, lines kept in `text.secondary`):

```
│ ┌────────────────────────────────────┐ │
│ │ [✓ Checks] Switch to Hotel · Lisbon│ │
│ │ Out of date. Your workout changed  │ │
│ │ since this was checked.            │ │
│ │ Was suggested:                     │ │
│ │ ✎ Incline DB press · sets 1–3 …    │ │ text.secondary
│ │ [ Dismiss ]       [ Check again ]  │ │
│ └────────────────────────────────────┘ │
```

Same gym after an equipment edit (`[Use changes today]`): title `Use updated Main Gym`, button `Apply`, otherwise identical. Example line after Ben corrected the rack from 30 to 50 kg each: `✎ Incline DB press · sets 2–3` / `Target 30 → 32.5 kg each × 8–10` / `ⓘ Back to the planned load.`

Switch back (Ben chose his earlier gym, or the compensating card after an Undo was refused): title `Switch back to Main Gym`. Lines show restored targets (`ⓘ Back to the planned load.`).

### 2.4 Review sheet (5 or more change lines)

A large-detent sheet over the workout, so Log is one swipe away. It uses change-review.md's Review screen anatomy, with no scope selector (only `Today only` exists).

```
┌────────────────────────────────────────┐
│ Switch to Hotel · Lisbon         Close │
├────────────────────────────────────────┤
│ [✓ Checks] [▦ Today only]              │
│ 3 logged sets stay as they are.        │
│ All values are targets.                │
│ Changes (6)                            │
│ ✎ Bench press · sets 3–4               │
│   → DB bench press                     │
│   Target 22.5 kg each × 6–8            │
│   ⓘ No Olympic bar here.               │
│ … one block per changed exercise …     │
│ No change: Lateral raise, Face pull.   │
│ Why? ›                                 │
├────────────────────────────────────────┤
│ Not now                                │ text button, left
│ [               Switch               ] │ PrimaryButton of this sheet
└────────────────────────────────────────┘
```

### 2.5 After switching: the set card

Focus, Ready. Incline DB press had set 1 logged at Main Gym. Its sets 2–3 moved to the continuation part at Hotel · Lisbon:

```
├────────────────────────────────────────┤
│ Incline DB press          Adjust  ⋯    │
│ Dumbbells · Working · Set 2 of 3       │ numbering runs across parts
│ Last (2 Oct, Hotel · Lisbon):          │ previous at THIS equipment
│ 20 kg each × 12                        │ (an actual)
│  Load each               Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  20 kg     │+ │ │− │  10   │+ │   │ steppers use Hotel's rack
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 20 kg each · 8–10 reps   Why?  │ Why? panel: active-workout §2.12
│  ⓘ Capped: the most here is 20 kg     │ SnapNote (NoteLine, fact)
│    each. Plan was 32.5 kg each.        │
│  Rest after: 1:30 ›                    │
│                                        │
│ ✓ 1  32.5 kg each × 9       Main Gym   │ done set keeps its gym
│ ── At Hotel · Lisbon ───────────────── │ GymPartDivider
│ ▶ 2  now                               │
│ ○ 3  Target 20 kg each × 8–10          │
├────────────────────────────────────────┤
│ [ 🎙 ] [     Log 20 kg each × 10     ] │
└────────────────────────────────────────┘
```

Load dropped with no swap (`not_here`):

```
│ Cable row                 Adjust  ⋯    │
│ Set 1 of 3                             │
│ No previous result                     │
│  Stack                   Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │            │+ │ │− │  12   │+ │   │ load empty; keypad, no step keys
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 12 reps · no load target       │
│  ⚠ No Cable station at Hotel · Lisbon. │ NoteLine warning
│    Plan was 50 kg stack.      Swap ›   │ trailing action, 44pt
├────────────────────────────────────────┤
│ [ 🎙 ] [        Enter load           ] │ as active-workout §2.11
└────────────────────────────────────────┘
```

- **`SnapNote`** is a `NoteLine` (design-system §9.43) under the target line, for the active set (Ready) and `Up next` (Resting). It shows only for **`capped`, `converted` and `dropped`**, the fits that change the number noticeably or remove it. A plain `rounded` step and a `restored` target have no note. Every fit is in the `Why?` panel's `Equipment` row (active-workout §2.12), which reads `planned.snap`, while `Set by` keeps the original author. In the condensed keypad layout it collapses to the `ⓘ` / `⚠` icon after the target, and VoiceOver still reads it in full. Overview shows the same icon after the Target cell.
- **`GymPartDivider`** (§9) separates an exercise's parts done at different gyms, in the mini set list and in Overview. Done sets from a gym other than the current one show that gym's name, right-aligned, `text.secondary`.
- **The `Last` line** for a continuation part uses history at that part's equipment. Without it, the line reads `No previous result`; with history only elsewhere, `Last (1 Oct, Main Gym): …` (active-workout §5).
- **Overview** puts the divider between parts:

```
│ Incline DB press · kg each         ⋯   │
│  Set   Last        Target     Done     │
│ ✓ 1    30×9        32.5×8–10  32.5×9   │
│ ── At Hotel · Lisbon ───────────────── │
│ ▶ 2    20×12       20×8–10ⓘ [20][10]  │
│ ○ 3    20×11       20×8–10ⓘ    —      │
```

- **A swapped exercise** looks like a Ben-picked swap (exercise-library §2.5): done sets stay under Bench press, and DB bench press holds the moved pending sets. The swap line in the coach slot is replaced by the toast; Undo of the switch undoes the swap with it.

### 2.6 Repeat preview

Repeat uses the same function and the same note wording. The layout is owned by [routines.md](routines.md) §2.4; this is its gym-related part (GS10):

```
├────────────────────────────────────────┤
│ Push A · done at Main Gym · 16 sets    │
│ Checked for [⌂ Hotel · Lisbon ▾]       │ GymChip: re-checks, starts nothing
│ Targets are what you did on 6 Oct.     │
│ Nothing is marked done. Progression    │
│ isn't applied.                         │
│ All values are targets.                │
│ Bench press · Barbell              ⋯   │
│  1–3 Target 8 reps · no load target    │
│  ⚠ No Olympic bar at Hotel · Lisbon:   │ same wording as the switch
│    no load target (last time 100 kg ×  │
│    8).                        Swap ›   │ Ben's own swap, draft only
│ Incline DB press · Dumbbells       ⋯   │
│  1–3 Target 20 kg each × 9             │
│  ⓘ Capped: the most here is 20 kg     │
│    each. Last time 30 kg each.         │
├────────────────────────────────────────┤
│ Save as routine                        │
│ [            Start workout           ] │
```

## 3. States

### 3.1 Card

| State | Trigger | Shows | Actions |
|---|---|---|---|
| Computing | Gym chosen; `setActiveGym` runs locally (normally under 100 ms) | After 300 ms only: static `ellipsis` + `Checking Hotel · Lisbon's equipment…` | none; Log usable |
| Ready, changes | ≥ 1 change line | §2.2 | `Not now`, `Switch`, `Why? ›` |
| Ready, many changes | ≥ 5 change lines | First 3 lines + `Review all 6 changes ›` | `Not now`, `Review all …` (Switch on the sheet) |
| Ready, nothing changes | All pending targets achievable as they are | §2.3 one-line variant | `Not now`, `Switch` |
| Ready, nothing left | No pending sets | `No sets left to update. Anything you add uses Home's equipment.` | `Not now`, `Switch` |
| Ready, gym has no equipment | Target gym's snapshot is empty | Lead `⚠` line + `Add equipment ›` | as Ready |
| Ready, unchecked values | Any mapped item has `detailsSource: 'preset'` | Extra `ⓘ` line + `Check ›` | as Ready |
| Out of date | GS7 trigger before `Switch` | §2.3 stale variant | `Dismiss`, `Check again` |
| Applying | `Switch` tapped | Button shows `Switching…`, disabled | none (normally under 100 ms) |
| Applied | Commit succeeded | Card closes. Toast (§5). `GymChip` shows the new gym | Toast `Undo` (`timing.undoToast`, 8 s) |
| Write error | SQLite write failed | Card stays, with `Couldn't switch gym. Nothing changed.` | `Try again` (same opId) |
| Undone | `Undo` within the toast, guard passes | Toast `Back at Main Gym. Remaining sets restored.` | none |
| Undo refused | A set was logged, corrected, skipped, deleted or added since, or a pending target changed | Toast `Can't undo: your workout changed since the switch.` Then a new card `Switch back to Main Gym` (a compensating proposal from the same function) | as Ready |
| Dismissed | `Not now`, `Dismiss`, or choosing the current gym again | Card closes. Old gym, chip and targets unchanged | — |
| Replaced | Ben chooses a different gym while a card is open | The open card is superseded and the new one computes | — |

### 3.2 Workout context

| Context | Behaviour |
|---|---|
| Ready / Resting | As §2.2. Rest keeps running and is never restarted or changed. `Up next` updates only on `Switch` |
| Paused | Switching is allowed. Timers stay frozen, the primary stays `Resume`, and the workout stays paused after `Switch` |
| Work timer running or paused | That set is excluded (GS11), with the line `Dead hang set 2 is running. It stays as it is.` |
| Keypad open | Tapping the gym chip closes the keypad, keeping the draft. The card never takes focus |
| Empty workout / all sets done | "Nothing left" variant. After `Switch`, `Add exercise` and `Add set` use the new gym (§4.3) |
| Unilateral, half-logged pair | The partner is excluded (GS11), with the line `Right side of Single-arm row set 2 stays on Main Gym's equipment, to match its left side.` |
| Superset | A substitute takes the original's place and superset letter for the pending rounds |
| Coach slot busy | GS8: an offer or banner waits behind the card. A coach request in progress is cancelled, and the card adds `Coach request cancelled because the gym is changing. Ask again after switching.` |
| Offline | No effect. Everything is local (rule 1) |
| AI unavailable / coach not connected | No effect. The switch never calls the coach; `Why?` uses stored evidence |
| Voice unavailable | No effect; every voice action has a tap equivalent |
| Restored after force-close, card open | **Deferred to the coach proposals store (build step 4), ADR 0019.** Until then the card isn't stored and doesn't come back; the switch itself is one transaction (next row). When the store exists: the card is a stored proposal and comes back, and if anything changed it shows Out of date |
| Force-close during `Switch` | One transaction: after relaunch the workout is either fully switched (chip shows the new gym; the restore banner says `Workout restored. Nothing was lost.`) or not switched at all |

### 3.3 Transitions

```
Ready/Resting ──gym chip──► switcher ──gym row──► Computing ──► Ready (changes | nothing changes | nothing left)
                                  └─same gym / swipe down──► (closed, nothing changes)
Ready ──Switch──► Applying ──ok──► Applied (toast, Undo 8 s) ──Undo──► Undone
   │                  │                   └─Undo refused──► "Switch back to Main Gym" card
   │                  └─error──► Ready + "Couldn't switch gym. Nothing changed." [Try again]
   ├─Not now──► closed (old gym kept)
   ├─log / correct / undo / skip / delete / add set / coach change──► Out of date ──Check again──► Computing
   └─gym chip → another gym──► Computing (replaces this card)
```

## 4. Interactions

### 4.1 Choosing a gym
- Gym chip → switcher sheet → tap a gym row. That's 2 taps to see the card.
- Choosing the gym the workout already uses closes the sheet, does nothing, and dismisses any open switch card.
- `Edit gyms ›` and `+ Add gym` behave as in gym-editor §2.7. `+ New travel gym` → `Save and switch` shows the card (it never switches by itself).

### 4.2 The card
| Element | Tap | Notes |
|---|---|---|
| `Switch` | `confirmProposal(proposalId, targetVersions)` → `applyCoachProposal` → reducer `change_gym` (§6.4) | One transaction with an opId; a double tap is a duplicate. If the active set's Log label changes, Log ignores taps for `timing.valueChangeGuard` (1 s), as for coach adjustments |
| `Not now` | Closes the card | The proposal is kept until the workout ends (CR7/CR8), and choosing the gym again recomputes it |
| `Why? ›` | `getDecisionEvidence(proposalId)` in the coach sheet's `Why?` frame (medium detent) | Sections `What it used` (the gym's equipment as saved, with dates and checked/not checked), `Checks` (every note), `Not changed`. No AI call |
| `Review all N changes ›` | Review sheet (§2.4) | `Switch` lives there |
| `Check again` | `setActiveGym` again → a new proposal | The old one is recorded as stale, never applied |
| `Dismiss` | Closes the stale card | — |
| `Check ›` / `Add equipment ›` | The item editor or Add equipment as a sheet | After `Save`, the card checks again (the old proposal goes stale) |
| A change line | No action | Lines are read-only. CR3: all or nothing |

### 4.3 What `Switch` does (one SQLite transaction)
1. Sets `session.gymId` to the new gym and appends `{atUtc, tz, fromGymId, toGymId, opId, actionId}` to `session.gymChanges`.
2. Appends the new gym's equipment snapshot (`getEquipmentSnapshot(gymId, date)`) to `session.equipmentSnapshot`. Existing entries are never edited or removed.
3. Per exercise with pending sets: if it has finished or skipped sets, creates a continuation row right after it and moves the pending sets there (set IDs unchanged, so drafts, rest and the active set survive). Otherwise it updates the row in place. A swap uses `swap_exercise` semantics (exercise-library §6).
4. Per moved or updated pending set: writes the fitted `planned.load` and `planned.snap` (§6.5). The intended target, reps, effort, set type, rest and `planned.source` stay as they were.
5. Keeps or replaces drafts (GS12).
6. Never touches finished, skipped or deleted sets, GS11's excluded sets, the rest timer, the work timer, pause state or elapsed time.
7. Bumps `session.version` and records one action with before/after for Undo.

After `Switch`, everything that reads equipment reads **only the current gym's part of the snapshot**: steppers, the keypad's step keys, `Machine busy`, the gym chip's busy count, the exercise picker, `Add set` and `Add exercise`. Corrections of a finished set read that set's own row (its original equipment).

`Add set` on an exercise whose sets are all on another gym's equipment creates a continuation row at the current gym (GS3 mapping), and fits the copied target with the same function.

### 4.4 Voice (GS9; grammar to be added to voice.md)
| Say | Result | Voice strip |
|---|---|---|
| "I'm at Home", "switch gym to Home", "change gym to the hotel" | Gym name matched locally (name, then the word after "the"); `setActiveGym` → card | `Gym: Home. Check the card, then tap Switch.` (card with changes) or `Gym: Home. No targets change. Say "switch" or tap.` |
| "switch" / "yes" | Confirms **only** a card that changes no target | `✓ Switched to Home` with `Undo` in the strip (VO4) |
| "switch" with changes on the card | Nothing applies | `Tap Switch to apply these changes.` |
| "not now" | Dismisses the card | `Not switched. Still at Main Gym.` |
| No match | Nothing | `No gym called "lisbon hotel". Tap the gym chip to choose.` |
| Two matches | One question | `Hotel · Lisbon or Hotel · Porto?` [Hotel · Lisbon] [Hotel · Porto] |

These work with the coach offline. Spoken (Set cues or Conversation): after a `Switch` that changed targets, "Remaining sets updated for today." (rest-state.md §5). Nothing is spoken for a switch that changed no target, or for the card appearing.

### 4.5 Undo paths
| What | Undo |
|---|---|
| Switch, nothing done since | Toast `Undo` (8 s) → `undoAction(actionId)`. Restores the old gym, the exercise rows (continuations removed, sets moved back), every pending target and draft exactly. A reversal entry is appended to `gymChanges`; nothing is deleted from the record |
| Switch, something done since | A compensating card, `Switch back to Main Gym`, built by the same function from the intended targets (§6.1). Never a silent revert |
| After the toast | Gym chip → choose the earlier gym → the switch-back card |
| A proposed swap Ben doesn't want | After switching: exercise `⋯` → `Undo swap` (back to the original exercise with no load target) or `Swap exercise` (pick another). Both are Ben's own swaps (EL4) |
| A coach adjustment or swap undone after a switch | `undoAction` restores the **intended** target and fits it to the current gym with the same function, never the old gym's load (rule 4). If it can't, it offers a compensating card |
| `Not now` | Choose the gym again |

### 4.6 Repeat and routine start (same function)
- **Repeat preview:** the `GymChip` (GS10) calls `buildRepeatSessionDraft(sessionId, gymId)` again and replaces the preview. Nothing is started or saved. `Swap ›` on a `not_here` note opens the Swap sheet (exercise-library §2.5) at that gym; choosing replaces the row **in the draft only**. `Start workout` → `startWorkoutFromSession(…, gymId, opId)`, with the same notes stored on the sets as `planned.snap`.
- **Routine detail / Start:** `validateRoutineForGym` shows the same notes `startWorkout` will apply, because both call `snapPlanToGym` (mode `start`).

### 4.7 Keyboard and accessibility
- The card's buttons are 52pt hit areas (workout screen, design-system §9.48), at least `space.8` apart.
- VoiceOver reads each change line in full, for example: "Incline DB press, sets 1 to 3. Target 32.5 kilograms each, to 20 kilograms each, 8 to 10 reps. Capped: the most here is 20 kilograms each." The divider reads "Sets from here on at Hotel Lisbon."
- At AX1 and larger, each change line stacks: exercise and sets, then before, then after, then the note. Numbers never truncate.
- No animation: the card appears and closes without motion (design-system principle 5).

## 5. Copy

Every load on the card and the set card is a **target** (`Target …`, `Plan was …`, `last time …` in Repeat notes, which is a past actual now used as a target). Done sets and `Last (…)` are **actuals**.

| Element | Text |
|---|---|
| Card titles | `Switch to Hotel · Lisbon` · `Use updated Main Gym` · `Switch back to Main Gym` |
| Author, scope | `Checks` · `Today only` |
| Not changed | `2 logged sets stay as they are.` / `1 logged set stays as it is.` · `Right side of Single-arm row set 2 stays on Main Gym's equipment, to match its left side.` · `Dead hang set 2 is running. It stays as it is.` · `No change: Lateral raise, Face pull.` |
| Draft replaced (active set) | `Your edit on set 3 (102.5 kg) can't be set up here. Set 3 will use the new target.` |
| Coach cancelled | `Coach request cancelled because the gym is changing. Ask again after switching.` |
| Change line, swap | `Bench press · sets 3–4` / `→ DB bench press` / `Target 22.5 kg each × 6–8` / `ⓘ No Olympic bar here.` · no history: `→ 6–8 reps, no load target` / `ⓘ No Olympic bar here. No DB bench press history: start light, enter your load.` |
| Change line, re-fitted | `Target 32.5 → 30 kg each × 8–10` + `ⓘ Rounded down to the nearest load here.` · `Target 32.5 → 20 kg each × 8–10` + `ⓘ Capped: the most here is 20 kg each.` · `Target 22.5 kg each → 45 lb each × 8–10` + `ⓘ Dumbbells here are in lb. Rounded down.` · `Target 20 → 32.5 kg each × 8–10` + `ⓘ Back to the planned load.` |
| Change line, load dropped | `Target 50 kg stack × 12` / `→ 12 reps, no load target` + one of: `⚠ No Cable station here. Swap or skip it after switching.` (`not_here`) · `⚠ This is a different kind of machine, so 140 kg plates isn't converted.` (`convention_mismatch`) · `⚠ The lightest here is 10 kg each, heavier than planned.` (`lightest_is_harder`) · `⚠ Leg press here can't make any load as set up.` (`no_achievable_loads`) · `⚠ Plan says 225 lb. Nothing here can check it in kg.` (`unit_not_convertible`) |
| Pain (with any line on a flagged movement) | `⚠ Pain flag on Bench press: no increases.` |
| Unchecked | `ⓘ Hotel · Lisbon's dumbbells are typical values, not checked.` `Check ›` |
| No equipment | `⚠ Hotel · Lisbon has no equipment set up yet, so remaining load targets are removed.` `Add equipment ›` |
| Variants | `Home has everything for your 9 remaining sets. Targets stay as they are.` · `No sets left to update. Anything you add uses Home's equipment.` |
| States | `Checking Hotel · Lisbon's equipment…` · `Out of date. Your workout changed since this was checked.` · `Was suggested:` · `Couldn't switch gym. Nothing changed.` · `Switching…` |
| Buttons | `Not now` · `Switch` · `Apply` (same gym) · `Why? ›` · `Review all 6 changes ›` · `Check again` · `Dismiss` · `Try again` · `Check ›` · `Add equipment ›` · `Close` (review sheet) |
| Toasts | `Switched to Hotel · Lisbon. Remaining sets updated for today.` [Undo] · `Switched to Home. No targets changed.` [Undo] · `Back at Main Gym. Remaining sets restored.` · `Can't undo: your workout changed since the switch.` |
| Set card `SnapNote` (switch; capped, converted or dropped only) | `Capped: the most here is 20 kg each. Plan was 32.5 kg each.` · `Rounded from 22.5 kg each to 45 lb each to match this gym.` · `No Cable station at Hotel · Lisbon. Plan was 50 kg stack.` `Swap ›` · `The lightest here is 10 kg each, heavier than the plan's 5 kg each.` · convention and no-load wording as active-workout §5 (`Dropped target`) |
| `Why?` `Equipment` row (every fit) | `Rounded down to what Hotel · Lisbon has. Plan was 32.5 kg each (Main Gym).` · `Capped at 20 kg each at Hotel · Lisbon. Plan was 32.5 kg each (Main Gym).` · `Converted to lb and rounded down for Hotel · Lisbon. Plan was 22.5 kg each.` · `Back to the planned load at Main Gym.` · `No load target: no Cable station at Hotel · Lisbon. Plan was 50 kg stack.` |
| Repeat notes (same results, "last time" wording) | `No load target · no olympic bar here · last time 100 kg × 8` `Swap ›` · `Max here 20 kg each · last time 30 kg each` · `Rounded · last time 32.5 kg each` · `Converted from 22.5 kg each` · `No load target · lightest here is above 5 kg each` |
| Divider and gym captions | `At Hotel · Lisbon` · a done set from another gym: `Main Gym` |
| Repeat header | `Push A · done at Main Gym · 16 sets` · `Checked for` + `GymChip` |
| Voice strip | `Gym: Home. Check the card, then tap Switch.` · `Gym: Home. No targets change. Say "switch" or tap.` · `✓ Switched to Home` · `Tap Switch to apply these changes.` · `Not switched. Still at Main Gym.` · `No gym called "lisbon hotel". Tap the gym chip to choose.` · `Hotel · Lisbon or Hotel · Porto?` |
| Spoken | "Remaining sets updated for today." (only when a target changed) |

`<equipment>` in notes is the source item's `name` (not its station label). The gym is named on the set card and in Repeat, and is "here" on the card, whose title already names it.

## 6. Data needed

### 6.1 `snapPlanToGym` (new, pure, `packages/domain`)

```
snapPlanToGym({
  mode: 'start' | 'repeat' | 'gym_switch' | 'equipment_update',
  slots: [{ slotId, exercise: {id, name, compatibleEquipment, laterality, measurement, movementPattern},
            sourceEquipment: EquipmentInstance | null,     // what the intended targets were made on: planned.snap.intendedOn, else the row's current equipment
            sets: [{ id, setType, intended: Load | null, current: Load | null, reps, durationS }] }],
  gym: { id, name, equipment: EquipmentInstance[] },        // getEquipmentSnapshot + this session's busy/out-of-order exclusions
  lastUsedHere: (exerciseId) => equipmentId | null,         // GS3 step 2, from history
  painFlagged: ReadonlySet<exerciseId>,
  ownerUnit: WeightUnit,
}) → { slots: [{ slotId, equipment: EquipmentInstance | null,
                 mapping: 'same_item' | 'last_used_here' | 'same_kind' | 'other_kind' | 'none_needed' | 'not_here',
                 sets: [{ id, load: Load | null, outcome: 'exact' | 'rounded' | 'capped' | 'converted' | 'restored' | 'dropped',
                          reason?: 'not_here' | 'convention_mismatch' | 'unit_not_convertible' | 'no_achievable_loads' | 'lightest_is_harder',
                          bounded: 'min' | 'max' | null }],
                 notes: SnapNote[] }] }
```

Rules, in order:
1. **Map equipment** (GS3). A slot whose `sourceEquipment` is null stays `none_needed`, and keeps its load only if it has the same unit and convention (labelled "loads not checked", as today). That means the intended target was never tied to equipment, not that it was dropped earlier. A bench press whose load was dropped at a dumbbell-only gym still has `intendedOn` = Main Gym's bar, so switching back maps it to a barbell and restores the load.
2. **Fit each set from `intended`**, never from `current`, with `planTemplateLoad` as the per-set core: `roundToAvailableLoad(intended, eq, 'easier')`, unit conversion only through that rounding (review SP5).
3. **Drop, never round up:** if the result is clamped at the hard end (resistance: the minimum; assistance: the maximum), the load is dropped as `lightest_is_harder`.
4. **Never above a max:** results come only from `getAchievableLoads(eq)`, so nothing is extrapolated (rule 4).
5. **No equipment, no load:** `not_here` (and any slot whose source had equipment but nothing maps) gets `load: null`. Reps and duration are kept.
6. **Pain:** for a pain-flagged exercise, the result is never harder than `current` (no restore-up).
7. **Outcome** is `restored` when the new load equals `intended` and differs from `current`; otherwise `exact` / `rounded` / `capped` (`bounded: 'max'`) / `converted` / `dropped`.
8. **Notes** are one per slot per outcome kind, built from fixed text keys (§5), never from the model.
9. **Swaps are not this function's job.** `setActiveGym` adds them (GS5); Repeat never does.

**Invariant (property test across all four modes):** every non-null output load is `isLoadAchievable(load, equipment)` on an item of `gym.equipment`; it is never harder than `intended` (`compareDifficulty ≤ 0` after converting `intended`); with a pain flag it is never harder than `current`; and a slot whose source had equipment never has a non-null load without equipment here.

### 6.2 Callers

| Caller | Mode | Change from today |
|---|---|---|
| `startWorkout(routineId, gymId, opId, opts)` | `start` | Today it looks up `rex.equipmentId` by ID only and, when it isn't in the gym, keeps the template load unchecked (`planTemplateLoad` with `equipment: null`). It now maps with GS3 and fits |
| `buildRepeatSessionDraft(sessionId, gymId)`, `startWorkoutFromSession(…)` | `repeat` | Replaces `pickEquipment`, the B1 drop and the "harder" drop in `repeat.ts` with the shared function. Intended = last time's actual. Keeps `session.source = {kind: 'repeat', sessionId}` (review nit) |
| `setActiveGym(gymId, sessionId)` | `gym_switch` (other gym) / `equipment_update` (same gym) | New. Builds slots from the session's **pending** sets only (minus GS11's), adds GS5 swaps (`rankSubstitutions`, then `nextTargetsFor` on the substitute's own history, fitted with mode `start`), and returns a `Proposal {kind: 'change_gym', author: 'checks', scope: 'this_session', targets[], changes, notChanged, guardNotes}` |
| `validateRoutineForGym(routineVersion, gymId, equipmentVersion)` | `start` | Becomes a thin wrapper, so routine detail notes always equal what Start does |
| `undoAction(actionId)` for coach adjustments and swaps after a switch | `gym_switch` | Restored targets are treated as intended and fitted to the current gym (§4.5) |

### 6.3 Other functions
- `getEquipmentSnapshot(gymId, date)`, `listGyms(ownerId)` (switcher rows), `getAchievableLoads`, `roundToAvailableLoad`, `isLoadAchievable`, `compareDifficulty`.
- `rankSubstitutions(exerciseId, gymId, 'closest_match')`, `nextTargetsFor` / `plannedSetsFromTargets`, `getComparableHistory` (for `lastUsedHere` and `Last`).
- `confirmProposal(proposalId, targetVersions)`, `applyCoachProposal`, `undoAction`, `getDecisionEvidence`.
- `cancelCoachTurn` (GS8), `evaluateCoachTrigger` / `evaluateCheckInOffer` (re-run when the card closes).
- `buildActiveSetView(sessionId)` adds: per set `target.snap {intended, outcome, reason, equipmentName, gymName}` (for the `SnapNote`); per exercise `parts[] {gymId, gymName, equipmentId, setIds}`; per session `gymChanges[]` and `openGymProposal`. Draft prefill rule 3 (`this_session`) uses only sets in the **same part** (active-workout §4.2).
- `explainTarget(sessionId, setId)` (active-workout §2.12, follow-up 3) fills its `Equipment` row from `planned.snap` when the outcome isn't `exact`, for example `Capped at 20 kg each at Hotel · Lisbon. Plan was 32.5 kg each (Main Gym).` or `Back to the planned load at Main Gym.` `TargetProvenance` keeps the author and basis; a fit never changes `Set by`.
- Voice: `parseGymCommand(utterance, gyms)` (pure; for voice.md).

### 6.4 Command `change_gym` (reducer)
`{type: 'change_gym', opId, at, proposalId, toGymId, snapshot, expected: {gymId, pendingSetIds, plannedHash}, slots[]}` applies §4.3 or returns `stale` (rule 5) or `duplicate`. `undo_change_gym {actionId, expected}` applies §4.5 or returns `stale`, and the service then builds the compensating proposal.

### 6.5 Schema proposals (for the developer's ADR before building)

| # | Change | Why |
|---|---|---|
| GS-S1 | `PlannedSet.snap?: {intended: Load \| null, intendedOn: {equipmentId, kind, gymId} \| null, outcome, reason?, equipmentId: string \| null, gymId: string \| null, by: 'start' \| 'repeat' \| 'gym_switch' \| 'equipment_update'}`. `intendedOn` is the equipment the intended target was made for, and it never changes on a fit. It may instead be stored as `TargetProvenance.fit` (active-workout §6); either way it is written only by `snapPlanToGym` | GS2. Persists active-workout §2.11's dropped-target facts across a relaunch (today they exist only as start warnings). It also feeds `Why?`'s `Equipment` row (active-workout §2.12). It is kept apart from the author because a switch changes the fit, not who set the target |
| GS-S2 | `WorkoutSession.gymChanges: {atUtc, tz, fromGymId, toGymId, opId, actionId, undoOf?}[]`, append-only. `session.gymId` = the current gym | Summary, history and Undo |
| GS-S3 | `equipmentSnapshot` is append-only and unique by `(id, version)`. `SessionExercise.equipmentVersion?` (absent = the **latest** entry with that ID; rows already on an item are pinned to their version when a newer one is appended. As built, ADR 0019) | Finished sets resolve their original equipment, including after `[Use changes today]` re-snapshots the same item |
| GS-S4 | `SessionExercise.continuesFromId: string \| null` | GS6 continuation rows. Display joins parts into one block and numbers sets across them |
| GS-S4 (readers) | **Every reader that treats a row as an exercise groups by `continuesFromId` first** (`partRootOf`): the workout screen, Summary, Repeat, Start next session, Past workouts, and later export and progression | Review r1 B1 and r2 B1 came from readers that didn't (as built, ADR 0019) |
| GS-S4a (pending Ben) | **Next-session targets for a split exercise:** one target per exercise, read from the latest part with done working sets that has equipment, for the block's full set count; the Summary's `Next time` reason says which gym decided. Start fits it to the gym it's started at | Built this way (review r2 B1, reviewer's proposal) so Start and the Summary can't disagree. Alternatives for Ben: the first gym's part, or the part on the equipment of the gym the next session starts at (only known at Start, so the Summary couldn't commit to it) |
| GS-S5 | `Proposal.kind: 'change_gym'` (already listed in open-decisions Part 2), `author: 'checks'`; command union `change_gym`, `undo_change_gym` | §6.4 |

### 6.6 Code this replaces (for the developer)
- `packages/domain/src/session/repeat.ts`: `pickEquipment` (GS3 steps 1 and 3 only), the `equipmentMissing` / `harderDropped` / `unitDropped` branches and `missingEquipmentNote` become `snapPlanToGym` results and §5 notes. B1's behaviour is kept and becomes a property of the shared function.
- `packages/domain/src/session/create.ts`: `startWorkout`'s `equipmentById.get(rex.equipmentId)` plus `planTemplateLoad(…, equipment: null)` keeps a pinned item's load **unchecked** at a gym without that item. This is the same rule-4 gap as B1, and it isn't reachable in the app yet because routines aren't wired. `planTemplateLoad` stays as the per-set core.

## 7. Acceptance checks

Fixture "hotel": Main Gym has a 20 kg bar with plates up to 180 kg, dumbbells 2.5–40 kg each every 2.5, and a cable stack 5–100 kg. Hotel · Lisbon has dumbbells 2.5–20 kg each every 2.5 and a bench; no barbell, no cable. Push A: Bench press 4 × 100 kg × 6–8, Incline DB press 3 × 32.5 kg each × 8–10, Cable row 3 × 50 kg stack × 12, Lateral raise 3 × 10 kg each × 12–15. Bench sets 1–2 are logged.

1. **Hotel switch (brief §10).** Switching to Hotel · Lisbon shows `2 logged sets stay as they are.`, Bench sets 3–4 → DB bench press (target from its own history, or no load target), Incline `32.5 → 20 kg each` with the capped note, Cable row `→ 12 reps, no load target`, and `No change: Lateral raise.` After `Switch`, bench sets 1–2 show the same values, gym and equipment in Overview, Edit workout and history. No pending target exceeds 20 kg each, and none uses a barbell or cable.
2. **Property test.** For generated gyms (every equipment kind, kg and lb, min/max, gaps, empty) and plans, in all four modes, `snapPlanToGym` meets the §6.1 invariant.
3. **One code path.** For the same exercise, intended loads and target gym, Repeat and the switch return the same loads, outcomes and note keys (shared fixture). Only "Plan was" vs "last time" differs.
4. **Repeat B1 regression (competitor test 2g).** Repeat of a 100 kg × 5 bench session at a dumbbell-only gym gives `planned.load === null`, reps 5, `equipmentId === null`, every set `pending`, and the note `No Olympic bar at … : no load target (last time 100 kg × 5).` The set card shows `Target 5 reps · no load target` and `Swap ›`. No text says "kept as done" or "kept as planned".
5. **Routine start gap.** A routine with a Fixed 100 kg bench pinned to Main Gym's bar, started at a dumbbell-only gym, has no bench load target. A routine pinned to Main Gym's dumbbells, started at Hotel, maps to Hotel's rack and caps at 20 kg each.
6. **Switch back restores.** Main → Hotel (32.5 → 20) → Main restores 32.5 kg each with `ⓘ Back to the planned load.` If a pain flag is set on Incline DB press in between, the switch back leaves 20 kg each.
7. **Review SP1.** With Main Gym's rack wrongly saved at max 30, a 32.5 target starts capped at 30. After editing the rack to 50, `[Use changes today]` → `Apply` restores 32.5 kg each, and `+` steps past 30.
8. **Out of date.** With the card open, logging a set, correcting one, Undo, `Add set`, `Skip exercise` or an applied coach change each makes it Out of date with `Switch` hidden. `Switch` can't apply it by tap or voice. Tapping a different pending set, editing a draft or `+30 s` doesn't.
9. **Not now** leaves the gym chip, the snapshot, every target and every draft unchanged.
10. **Undo.** Undo within 8 s restores the session's gym, exercise rows, pending targets and drafts exactly (deep-equal apart from version and audit). After a set is logged at Hotel, Undo is refused and the `Switch back to Main Gym` card appears. Nothing reverts silently.
11. **Idempotent.** A double tap on `Switch`, or `Try again` after a simulated write error, produces exactly one `change_gym`.
12. **Exclusions.** A half-logged Left set's pending Right partner and a running timed set are unchanged by `Switch`, and each is named on the card.
13. **Drafts.** An edited 102.5 kg barbell draft on the active bench set is replaced after the swap, and the card says so. An edited 17.5 kg each draft that Hotel's rack can make is kept.
14. **Log guard.** When `Switch` changes the active set's Log label, a Log tap within 1 s is ignored. At all other times Log responds at once.
15. **Current gym only.** After the switch, steppers, the keypad, `Machine busy`, the chip's busy count, the exercise picker, `Add set` and `Add exercise` use only Hotel's items. `Add set` on Bench press (all sets done at Main) creates a set on Hotel equipment with a fitted target, or no load target.
16. **Corrections.** Correcting bench set 1 after the switch uses Main Gym's bar for its steppers and doesn't add `off_profile_load`.
17. **Coach slot.** Choosing a gym during `Coach is working…` cancels the request and the card says so. An offer present before the card returns after `Not now` only if `evaluateCoachTrigger` still raises it. No AI call is made by the switch itself.
18. **Voice.** "I'm at Home" opens the card with no coach connected. "Switch" applies only the no-change card; with changes, the strip says `Tap Switch to apply these changes.`
19. **Offline.** In airplane mode with no coach, the switch, `Why?`, Undo and Repeat all work.
20. **Speed.** From Ready to switched is 3 taps (chip, gym row, `Switch`). Log stays visible and tappable throughout. The card never opens a sheet or a full screen by itself.
21. **Many changes.** With 5 or more change lines, the card shows 3 lines and `Review all N changes ›`. `Switch` is only on the review sheet, and Log is one swipe away.
22. **Force-close.** Killing the app during `Switch` leaves the workout either fully switched or unchanged after relaunch, never partly.
23. **Repeat chip.** Changing the Repeat preview's gym re-checks every row without creating a session. `Start workout` uses the chosen gym, and the set card notes match the preview's.
24. **History and Summary.** A switched workout shows `Main Gym → Hotel · Lisbon` in the Summary title and Past workouts. Comparisons never pair the two gyms' equipment (workout-summary check 5).
25. **Accessibility.** Hit areas are at least 52pt on the card and 44pt elsewhere. Text is at least 16pt, with tabular numerals for every load. Each note has an icon and text. It works at AX3 on a 375pt screen, in dark and light mode. VoiceOver reads the change lines as in §4.7.
26. **Notes vs `Why?`.** A capped, converted or dropped target shows a `SnapNote`. A target rounded down by one step shows none. Both show the fit in `Why?`'s `Equipment` row, and `Set by` still names the original author.

## 8. Effects on other specs
- **gym-editor.md** §2.8, §3.3, §4.6, §4.9, §5, §6, §8 GE7: point here. GE7's card text is corrected by GS4.
- **active-workout.md**: §2.16 (after a switch), §2.11 `not_here`, §3 rows, §4.2 draft rule 3, §4.7, §4.9, §5, §6 and checks 63–70 point here. `Why?` (§2.12, follow-up 3) reads `planned.snap` for its `Equipment` row.
- **routines.md** §2.2, §2.4, §3.4, §4.5, §4.6, §6, §7: the same function, the Repeat `GymChip` and `Swap ›`.
- **workout-summary.md**: the title line shows each gym in order. A held exercise whose pending sets moved to another gym says so. `Next time` has one row per exercise, split or not (GS-S4a).
- **open-decisions.md**: B21 (GS13) for Ben. The Part 2 schema row is GS-S1 to S5.
- **Follow-ups for other owners (not edited here):** voice.md grammar (GS9, §4.4); rest-state.md §5 (the gym cue only when a target changed); coach-adjustments.md §2.1 slot priority (GS8: the gym card holds the slot; a request in progress is cancelled); change-review.md (`author: 'checks'` cards may use a specific verb, `Switch`, instead of `Apply`); design-system.md §9 (`GymPartDivider` below, when the file is free).
- **Coach (rule 3, ADR 0006 amendment 2):** a gym switch counts as "something has changed (equipment)". The coach may later raise a structural proposal for future sessions (for example a travel version of Push A), but only as a proposal and never during the set loop. The switch itself never calls the coach.

## 9. Proposed design-system additions

No new colour, type, spacing or timing tokens. These are components only, specified here because design-system.md is being edited elsewhere:

| Name | Spec |
|---|---|
| `GymPartDivider` | A row inside a set list (mini list and Overview): a `border.divider` rule on each side of the label `At Hotel · Lisbon` (`type.label`, `text.secondary`, `building.2` icon before it). Min height 32pt, not focusable on its own; VoiceOver reads it as a heading: "Sets from here on at Hotel Lisbon". At AX1+, the label wraps and the rules are dropped |
| `SnapNote` | A `NoteLine` (§9.43) under the target line. `info.circle` + `text.secondary` for facts, `exclamationmark.triangle` + `status.warning` for a dropped load, optional trailing `Swap ›`. Condensed layouts show the icon only, with the full text in the VoiceOver label |
| Gym caption on a done set | Trailing `type.callout` `text.secondary` gym name, only when it differs from the current gym |
| `ChangeReviewCard` with a specific verb | Same component (§9.11). `author: 'checks'` cards use `Switch` / `Apply` as the action verb. Everything else is unchanged |

## Cross-links

- [gym-editor.md](gym-editor.md): the switcher sheet (§2.7), travel gyms (§2.6), `[Use changes today]` (§4.9), GE1 unchecked values, GE4 out of order.
- [active-workout.md](active-workout.md): coach slot, §2.11 dropped targets, §2.12 `Why?` (`Equipment` row), §2.16 after a switch, §4.2 draft prefill, §4.3 equipment-aware input, §4.9 Undo.
- [routines.md](routines.md) §2.4 Repeat, §4.5 Start.
- [exercise-library.md](exercise-library.md) §2.5 Swap and EL4; `swap_exercise` semantics.
- [change-review.md](change-review.md): anatomy, CR3 all-or-nothing, CR4 out of date, CR7/CR8 kept and expired.
- [coach-adjustments.md](coach-adjustments.md): coach slot, guard notes, CA7.
- [rest-state.md](rest-state.md) §5: the "Remaining sets updated for today." cue.
- [workout-summary.md](workout-summary.md): the title line, comparability.
- `packages/domain/src/equipment.ts`, `session/create.ts` (`planTemplateLoad`, `startWorkout`), `session/repeat.ts`; `packages/schemas/src/session.ts`.
