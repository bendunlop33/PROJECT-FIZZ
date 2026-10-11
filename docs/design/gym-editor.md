# Gym editor (gyms, equipment, availability, switching gym)

> **Revision 2026-10-08 (consolidation).** Proposed components are merged into design-system.md: `SettingsRow` §9.31, `LoadChip`, `CountStepper`, `RangeBuilder` §9.37 area, `LoadPreview` and its warning `NoteLine` §9.43, `ChecklistRow` / `ChoiceCard` §9.33–9.34, icons §9.52; `ProvenanceTag` is now `SourceTag` (value provenance, §9.28). Data domains (design-system §7.2): Ben's gyms and equipment are **Your data**; the gym presets they start from (`listGymPresets`) are **Coaching knowledge**.

> **Revision 2026-10-09 (gym switch finalised, competitor follow-up 6 approved by Ben).** The mid-workout switch (GE7) and the rules that fit any plan to a gym now live in [gym-switch.md](gym-switch.md), which is the single owner. That includes Repeat at another gym (review B1) and routine Start. This file keeps the switcher sheet and the entry points. Corrections to the earlier §2.8: a pending exercise with no equipment here gets **no load target, with the reps kept**, never "Kept as planned, loads not checked" (rule 4; gym-switch GS4). The card has no `[Skip it]`, which would have made the card itself go out of date. Targets are fitted from the **intended** target, so switching back, or `[Use changes today]` after fixing a wrong max, restores capped loads (GS2; review SP1). Changed: §2.8, §3.3, §4.6, §4.9, §5, §6, §7 checks 9–11 and 18, §8 GE7.

Status: v0.1 draft, 8 Oct 2026. Tokens: [design-system.md](design-system.md). Entry points: [profile-and-settings.md](profile-and-settings.md) (Gyms section), [today.md](today.md) and [active-workout.md](active-workout.md) (gym chip, `Machine busy`, `[Update gym]`), [onboarding.md](onboarding.md) (first gym).

## 1. Purpose

The gym editor answers **"What does this gym really have, so every target I'm given is a load I can actually set up?"** (CLAUDE.md rule 4, brief §4).

Primary actions:
- **Equipment editor:** `Save` (the only `PrimaryButton`, fixed above the keyboard).
- **New gym / travel gym:** `Save gym` / `Save and switch`.
- **Gym detail and gym list:** no `PrimaryButton`. These are lists of rows; `Add equipment` and `Add gym` are row-style actions.

The editor lives outside the logging loop (brief §12 Page 7). The workout only reaches it through `[Update gym]`, `Machine busy` and the gym chip, and each of those opens a sheet over the workout, so Log is one swipe-down away.

### Model recap (what the editor writes)

From `packages/schemas/src/equipment.ts`. Every instance has its own `unit`, `loadConvention`, optional `minLoad`/`maxLoad`, `movementTags`, `notes` and permanent `availability` (`available` | `retired`).

| UI name | `kind` | Convention (display, design-system §8) | Load data |
|---|---|---|---|
| Barbell and plates | `barbell` | Total: `100 kg` | `barMass`, `plates[{mass, count}]` (count = physical plates, not pairs) |
| Dumbbells | `dumbbells` | Per dumbbell: `22.5 kg each` | `loads[]` (every dumbbell present, per hand) |
| Cable or weight-stack machine | `weight_stack` | Stack: `45 kg stack` | `stackLoads[]` as printed, `addOns[]` |
| Assisted pull-up / dip | `assisted_stack` | Assist: `Assist 20 kg` | `assistanceLoads[]`; bigger = easier |
| Plate-loaded machine | `plate_loaded_machine` | Added plates: `40 kg plates` | `loadingSides` 1 or 2, `plates[]` |
| Pull-up bar, dip bars | `bodyweight_station` | `BW` | none |
| Bench, rack and other (no load) | proposed `accessory` (GE2) | none | none |

## 2. Layout

### 2.1 Gyms list (Profile → Gyms)

The gyms appear inline in Profile (profile-and-settings.md §2.1). Each row opens the gym detail.

```
│ Gyms                                   │
│ ┌────────────────────────────────────┐ │
│ │ ⌂ Main gym                       › │ │
│ │   Default · 6 items · 3 not checked│ │
│ ├────────────────────────────────────┤ │
│ │ ⌂ Home                           › │ │
│ │   4 items                          │ │
│ ├────────────────────────────────────┤ │
│ │ ⌂ Hotel · Lisbon                 › │ │ airplane icon + the word "Travel"
│ │   Travel, until Sun 18 Oct         │ │
│ ├────────────────────────────────────┤ │
│ │ + Add gym                          │ │
│ └────────────────────────────────────┘ │
│ Archived gyms (1)                    › │
```

### 2.2 Gym detail

```
┌────────────────────────────────────────┐
│ ‹ Profile        Main gym              │
├────────────────────────────────────────┤
│ Name            Main gym             › │ inline edit
│ Location        Pure Gym, Leeds      › │ optional label, no GPS
│ Default gym                    [ On ]  │ switch
│ Gym notes       Busy 17:00–19:00     › │
│                                        │
│ Equipment (6)                          │
│ ┌────────────────────────────────────┐ │
│ │ Olympic bar + plates             › │ │
│ │ 20–332.5 kg · total                │ │ preview from getAchievableLoads
│ │ [? Typical values, not checked]    │ │ ProvenanceTag
│ ├────────────────────────────────────┤ │
│ │ Dumbbells                        › │ │
│ │ 2.5–40 kg each                     │ │
│ ├────────────────────────────────────┤ │
│ │ Cable station · Left stack       › │ │
│ │ 5–100 kg stack                     │ │
│ │ (!) Out of order since 3 Oct       │ │ status.warning icon + text
│ ├────────────────────────────────────┤ │
│ │ Adjustable bench                 › │ │
│ ├────────────────────────────────────┤ │
│ │ Squat rack with safeties         › │ │
│ ├────────────────────────────────────┤ │
│ │ Pull-up bar · BW                 › │ │
│ ├────────────────────────────────────┤ │
│ │ + Add equipment                    │ │
│ └────────────────────────────────────┘ │
│ Removed from this gym (1)            › │
│                                        │
│ Duplicate gym                          │ accent text rows, 44pt
│ New travel gym from this one           │
│                                        │
│ Archive gym                            │ status.danger text, space.8 above
└────────────────────────────────────────┘
```

- During a workout at this gym, a `StatusBanner` sits under the nav bar: `Your workout in progress uses this gym as it was when you started.` [Use changes today] (§4.9). Items marked busy for that workout show `Busy today (this workout only)` with [Clear].
- `Delete gym` replaces `Archive gym` only when no workout has ever used the gym.

### 2.3 Add equipment (sheet, medium detent)

```
┌────────────────────────────────────────┐
│ Add equipment                   Cancel │
│ ┌────────────────────────────────────┐ │
│ │ Barbell and plates               › │ │
│ │ Dumbbells                        › │ │
│ │ Cable or weight-stack machine    › │ │
│ │ Assisted pull-up / dip machine   › │ │
│ │ Plate-loaded machine             › │ │
│ │ Pull-up bar or dip bars          › │ │
│ │ Bench, rack or other (no weight) › │ │
│ └────────────────────────────────────┘ │
│ Copy from another gym              › │ │ picks an item from any gym
└────────────────────────────────────────┘
```

Each choice opens the matching editor (§2.4) with empty fields (or a copy, with a new ID and no shared history).

### 2.4 Equipment editors

All editors share a frame: nav bar `Cancel` (left) and title; content scrolls; a fixed bottom bar with `PrimaryButton` `Save`, which sits above the keyboard. Below the kind-specific fields, every editor has the same **common section**:

```
│ Name            Olympic bar          › │
│ Station label (optional)             › │ e.g. "Rack 2", "Left stack"
│ Make / model (optional)              › │
│ Used for        Bench press, Squat,  › │ movement tags (exercise picker)
│                 Deadlift +6          │
│ Notes (setup)   Seat 4, back pad 2   › │
│ Availability    Available            › │ Available / Out of order / Removed
```

At AX1+ every label/value pair stacks (label above value). Numbers never truncate.

#### 2.4.1 Barbell and plates

```
┌────────────────────────────────────────┐
│ Cancel        Barbell and plates       │
├────────────────────────────────────────┤
│ Unit            [ kg | lb ]            │
│ Bar weight      [−]  20 kg  [+]        │ NumberStepper, 44pt targets
│                                        │
│ Plates   Count every plate             │
│ Use plate set  [ Main gym plates ▾ ]   │ shared set (GE3) or "Just this bar"
│ ┌────────────────────────────────────┐ │
│ │ 25 kg       [−]  4  [+]  2 a side  │ │ count stepper + derived pairs
│ │ 20 kg       [−]  4  [+]  2 a side  │ │
│ │ 15 kg       [−]  4  [+]  2 a side  │ │
│ │ 10 kg       [−]  4  [+]  2 a side  │ │
│ │ 5 kg        [−]  4  [+]  2 a side  │ │
│ │ 2.5 kg      [−]  4  [+]  2 a side  │ │
│ │ 1.25 kg     [−]  3  [+]  1 a side  │ │
│ │   One 1.25 kg plate can't be       │ │ text.secondary hint for odd counts
│ │   balanced, so it isn't used.      │ │
│ │ + Add plate size                   │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Heaviest you'll load (optional)        │
│ [            ] kg                      │ maxLoad; e.g. sleeve or rack limit
│ More options ›                         │ minLoad (preference)
│                                        │
│ Makes 126 loads: 20–332.5 kg, total,   │ LoadPreview
│ every 2.5 kg.                          │
│ Check a load [ 102.5 ] kg              │
│ → Each side: 25 + 15 + 1.25            │ from buildPlateSetup
│ ── common section ──                   │
├────────────────────────────────────────┤
│ [               Save                 ] │
└────────────────────────────────────────┘
```

- Plate counts are **physical plates**, as the schema stores them. The `2 a side` helper is derived (`floor(count / 2)`), so Ben counts what's on the tree and the app works out pairs.
- `Check a load` calls `buildPlateSetup`. Not achievable: `103 kg can't be made. Nearest: 102.5 kg or 105 kg.` Above the max: `335 kg is above this bar's limit (332.5 kg).`

#### 2.4.2 Dumbbells

```
┌────────────────────────────────────────┐
│ Cancel            Dumbbells            │
├────────────────────────────────────────┤
│ Unit            [ kg | lb ]            │
│ Weights are per dumbbell.              │
│                                        │
│ Range                                  │
│ From [ 2.5 ] to [ 40 ] every [ 2.5 ] kg│ numeric fields, custom keypad
│ + Add another range                    │ e.g. 42.5–50 every 2.5
│                                        │
│ In the rack (tap any that are missing) │
│ [2.5] [5] [7.5] [10] [12.5] [15]       │ LoadChip grid
│ [17.5] [20] [22.5] [25] [27.5] [−30]   │ "−30" = missing: minus icon +
│ [32.5] [35] [37.5] [40]                │ strikethrough, text.secondary
│ + Add a single weight                  │
│                                        │
│ Makes 15 loads: 2.5–40 kg each.        │
│ Gap: 27.5 → 32.5 kg.                   │ gaps larger than the usual step
│ ── common section ──                   │
├────────────────────────────────────────┤
│ [               Save                 ] │
└────────────────────────────────────────┘
```

Ranges and single weights generate the chip grid. The chips are the truth: what's saved is the list of chips not marked missing (`loads[]`, ascending, unique). Editing a range after marking chips missing keeps the missing marks for values still in the range.

#### 2.4.3 Cable or weight-stack machine

```
│ Unit            [ kg | lb ]            │
│ Stack, as printed on the pins          │
│ From [ 5 ] to [ 100 ] every [ 5 ] kg   │
│ Uneven stack? Enter each value ›       │ free list for e.g. 4.5, 9, 13.6…
│ Add-on weights (optional)              │
│ [ 2.5 kg ]  + Add                      │ e.g. a magnet or pin plate
│                                        │
│ Attachments (cable only)               │ proposed field (GE2)
│ [x] Rope  [x] Straight bar  [ ] V-bar  │ ChecklistRow chips
│ [x] Single handle  [ ] Lat bar         │
│ [ ] Ankle strap  + Other               │
│                                        │
│ Numbers are as printed on the stack.   │ text.secondary
│ They're never converted to free-weight │
│ equivalents.                           │
│ Makes 40 loads: 5–102.5 kg stack.      │
```

#### 2.4.4 Assisted pull-up / dip machine

```
│ Assistance, as printed                 │
│ From [ 5 ] to [ 70 ] every [ 5 ] kg    │
│ More assistance = easier. In a workout │ text.secondary
│ "+" adds assistance.                   │
│ Makes 14 loads: Assist 5–70 kg.        │
```

#### 2.4.5 Plate-loaded machine

```
│ Plates go on                           │
│ (•) Both sides, balanced               │
│ ( ) One horn                           │
│ Use plate set  [ Main gym plates ▾ ]   │
│ Most plates it takes (optional)        │
│ [ 300 ] kg of plates                   │
│ Logged as plates added. The machine's  │
│ own resistance isn't counted or        │
│ estimated.                             │
│ Makes 121 loads: 0–300 kg plates,      │
│ every 2.5 kg.                          │
│ Check a load [ 140 ] kg plates         │
│ → Each side: 25 + 25 + 20              │
```

A Smith machine is entered here (plates added, bar not counted) unless Ben knows the bar's weight, in which case he enters it as a `Barbell` with that bar weight. The editor says so in the `Smith machine?` hint under `Add equipment`.

#### 2.4.6 Pull-up bar or dip bars, and Bench, rack or other

Only the common section. Bodyweight stations show `Logged as bodyweight (BW).` Adding weight with a belt isn't supported yet (open question GE8); the hint says `Adding weight with a belt isn't supported yet.`

### 2.5 New gym

`+ Add gym` opens a full-screen stack with the same two screens as onboarding Step 2 ([onboarding.md](onboarding.md) §2.3 and §2.4), plus two extra starting points:

```
│ ( ) Copy an existing gym               │ → pick a gym; all items copied
│ ( ) Travel gym (short stay)            │ → §2.6
```

The primary is `Save gym`. The nav bar has `Cancel` (confirm if anything was ticked or typed).

### 2.6 Travel gym (quick)

Reached from the gym switcher sheet (`+ New travel gym`), from `Add gym`, or from a gym's `New travel gym from this one`. Built for standing in a hotel gym with the phone in one hand.

```
┌────────────────────────────────────────┐
│ Cancel        New travel gym           │
├────────────────────────────────────────┤
│ Name   [ Travel gym · 12 Oct         ] │ prefilled, editable
│ Use until  [ Sun 18 Oct ▾ ] (optional) │
│                                        │
│ What's there?                          │
│ [x] Dumbbells                          │
│     From [ 2.5 ] to [ 20 ] every [2.5] │ inline range, kg
│     [? Typical values, not checked]    │
│ [x] Adjustable bench                   │
│ [ ] Cable station                    › │
│ [ ] Barbell and plates               › │
│ [ ] Pull-up bar                        │
│ [ ] Machines                         › │
├────────────────────────────────────────┤
│ [          Save and switch           ] │ in a workout; else "Save travel gym"
└────────────────────────────────────────┘
```

- The dumbbell range is edited inline because it's the one number that decides most hotel workouts. Editing any number in the inline range marks the item `Checked by you`.
- A travel gym is a real gym with `kind: 'travel'` and an optional `useUntil` date (GE5). It doesn't change the default gym.

### 2.7 Gym switcher sheet

Defined in today.md §4 (list, check on the selected gym, `Add gym`, `Edit gyms`). This spec adds two rows and the mid-workout title:

```
┌────────────────────────────────────────┐
│ Gym for this workout              Done │ "Choose gym" outside a workout
│ ┌────────────────────────────────────┐ │
│ │ ✓ Main gym              (current)  │ │
│ │   Home                             │ │
│ │   Hotel · Lisbon  Travel           │ │
│ └────────────────────────────────────┘ │
│ + New travel gym                       │
│ + Add gym                              │
│ Edit gyms ›                            │
└────────────────────────────────────────┘
```

### 2.8 Switching gym mid-workout (proposal)

**Specified in [gym-switch.md](gym-switch.md) (revision 2026-10-09).** In short: choosing another gym during a workout calls `setActiveGym(gymId, sessionId)` and closes the sheet. An inline `ChangeReviewCard` authored `Checks` appears in the workout's coach slot:

```
┌──────────────────────────────────────┐
│ [✓ Checks] Switch to Hotel · Lisbon  │
│ [▦ Today only]                       │
│ ✎ Bench press · sets 3–4             │
│   → DB bench press                   │
│   Target 22.5 kg each × 6–8          │
│   ⓘ No Olympic bar here.             │
│ ✎ Incline DB press · sets 1–3        │
│   Target 32.5 → 20 kg each × 8–10    │
│   ⓘ Capped: the most here is 20 kg   │
│     each.                            │
│ ✎ Cable row · sets 1–3               │
│   Target 50 kg stack × 12            │
│   → 12 reps, no load target          │
│   ⚠ No Cable station here. Swap or   │
│     skip it after switching.         │
│ No change: Lateral raise.            │
│ Why? ›                               │
│ [ Not now ]          [ Switch ]      │
└──────────────────────────────────────┘
```

- **Finished sets are never listed and never change.** They keep their original gym and equipment (gym-switch GS6).
- Every pending target is fitted by `snapPlanToGym`, the same function Repeat and routine Start use (gym-switch GS1). It rounds toward easier from the **intended** target, never goes past a max, and never makes a target harder than intended.
- **No equipment here** means no load target, with the reps kept (GS4). There's no `[Skip it]` in the card: skipping or swapping happens on the set card afterwards (`Swap ›`, exercise `⋯`).
- **The session's gym changes only on `Switch`** (GE7). `Not now` keeps the old gym. The card goes `Out of date` when the sets it changes change (GS7).
- After `Switch`: toast `Switched to Hotel · Lisbon. Remaining sets updated for today.` [Undo]. Rest timer, elapsed clock and achievable drafts are untouched (GS12).

## 3. States

### 3.1 Gym-level

| State | Trigger | Display |
|---|---|---|
| No gyms | Onboarding skipped the gym | Profile Gyms section: `No gym yet. Loads won't be checked against equipment.` + `Add gym` (matches today.md No gym banner) |
| Normal | — | §2.2 |
| No equipment | Gym saved empty | Equipment section: `No equipment yet. Add what this gym has so targets match it.` + `Add equipment` |
| Has unchecked items | Items still at `detailsSource: 'preset'` | Gym row subtitle `3 not checked`; each item shows the `Typical values, not checked` tag |
| Default | `isDefault` | Row subtitle starts `Default`. Exactly one gym is default; switching the default on another gym turns this one off |
| Travel, active | `kind: 'travel'`, today ≤ `useUntil` | Row icon `airplane` + `Travel, until Sun 18 Oct`. Today preselects it while active (GE5) |
| Travel, ended | today > `useUntil` | Moved to Archived automatically. Never deleted. Its workouts keep it |
| Archived | Ben archived it, or a travel gym ended | Under `Archived gyms`. Not in the switcher. [Restore gym] in its detail |
| In use by the current workout | An unfinished session uses this gym | Banner in §2.2; busy items labelled |
| Loading | Local read > 300 ms | Static grey rows, no shimmer |
| Database error | Read or write fails | `Couldn't save Main gym. Your changes are still here.` [Try again] (`StatusBanner`, danger) |
| Offline / AI unavailable | — | No effect. The editor never needs the network or the coach |

### 3.2 Equipment-level

| State | Trigger | Display |
|---|---|---|
| Not checked | Created from a preset, details never saved by Ben | `ProvenanceTag` `Typical values, not checked` |
| Checked | Ben saved the editor (or edited an inline travel range) | `Checked by you` tag for 3 s after saving, then no tag (checked is the normal state) |
| Invalid | Validator rejects | Field: 2pt `status.warning` border + inline text. `Save` disabled with the label `Fix 1 problem`. Texts in §5 |
| Makes no load | Inventory and min/max leave no achievable load | Preview: `(!) This setup can't make any load. Check the min and max.` `Save` disabled |
| Unit locked | The item has logged sets | Unit control disabled with `This item has sets logged in kg. To use lb, add it as new equipment so history stays comparable.` [Add as new] |
| Out of order | Ben set `Out of order` (GE4) | Row: `(!) Out of order since 3 Oct`. Excluded from new workouts' snapshots and from targets and swaps until `Fixed` |
| Busy today | `setTemporaryAvailability(sessionId, id, 'busy' \| 'broken')` during a workout | Row: `Busy today (this workout only)` [Clear]. The saved gym is unchanged |
| Removed | `availability: 'retired'` | Under `Removed from this gym`, with the date. History keeps it. [Put back] |
| Never used, deleted | Ben deletes an item no workout has used | Gone after confirmation (§4.7) |
| Save conflict | The item's version changed since the editor opened | `This item changed since you opened it.` [Show latest] (Ben's edits are kept on screen to re-apply) |

### 3.3 Mid-workout switch

The full state table and transitions are in [gym-switch.md](gym-switch.md) §3. In summary:

| State | Display |
|---|---|
| Computing | After 300 ms only: static `ellipsis` + `Checking Hotel · Lisbon's equipment…` (local, normally under 100 ms) |
| Proposal ready | §2.8. With 5 or more change lines: 3 lines + `Review all N changes ›`, and `Switch` on the review sheet |
| Nothing changes | `No target changes` [Not now] [Switch] |
| Out of date | `Out of date` `Switch` hidden; [Dismiss] [Check again] |
| Applied | Toast with [Undo]; gym chip shows the new gym |
| Undo refused | Something changed after the switch: the toast says `Can't undo: your workout changed since the switch.` and a `Switch back to Main Gym` card appears, built by the same function. Never a silent revert |

## 4. Interactions

### 4.1 Editing equipment
- Tap a row → editor (pushed in Profile, or a sheet when opened from a workout).
- Number fields use the `WorkoutKeypad` layout with the step keys hidden (design-system §9.5); range fields step by the range's own increment. Return / `Next ›` moves to the next field; `Hide` closes the keypad. `Save` stays visible above the keypad.
- The preview line and `Check a load` update after each change, locally (`getAchievableLoads`, `buildPlateSetup`), with no animation.
- `Save` calls `addEquipment` or `updateEquipment(id, patch)` with an operation ID and expected version. On success: `haptic.commit`, back to the gym detail, toast `Saved. Future workouts use the new setup.` [Undo]. Undo saves the previous content as a new version (history of versions is kept; nothing is erased).
- `Cancel` with changes: `Discard changes to Dumbbells?` [Discard] [Keep editing].

### 4.2 Plate sets (GE3)
- A gym has one or more plate sets (most have one). Barbells and plate-loaded machines choose `Use plate set [Main gym plates ▾]` or `Just this bar`.
- Editing the plate list inside any item that uses a set edits the set. A line above the list says `Shared with Leg press and Hip thrust machine.` before Ben changes it.
- On save, each linked instance gets the new plate list as a new version (the domain still reads plates from the instance).

### 4.3 Dumbbell chips
- Tap a chip to toggle missing. VoiceOver: "30 kilograms, in the rack, button. Double-tap to mark missing." / "30 kilograms, missing."
- Long-press is not used. Every chip action is a single tap.

### 4.4 Availability
- `Availability ›` opens a three-option list:
  - `Available`
  - `Out of order` (`Until you mark it fixed. Workouts won't use it.`), optional note
  - `Removed from this gym` (`It's gone for good. History keeps it.`)
- Busy for the current workout only is set **from the workout** (exercise `⋯` → `Machine busy`, active-workout.md §4.4) or by voice, and cleared from the workout or here with [Clear]. It never touches the saved gym (brief §12: "'Machine occupied' is a temporary session restriction").
- Marking an item `Out of order` or `Removed` makes pending coach proposals that use it stale and shows `Future targets will avoid it.` in the toast.

### 4.5 Gym actions
- **Default gym switch:** turns on for this gym and off for the previous default. Today preselects the default (or an active travel gym).
- **Duplicate gym:** `duplicateGym(gymId, opId)` creates `Main gym copy` with every item copied (new IDs, `detailsSource` kept). It opens the new gym's detail with the name field focused. Toast `Copied Main gym. History isn't shared between the two.` [Undo] (deletes the unused copy).
- **New travel gym from this one:** opens §2.6 with this gym's items pre-ticked.
- **Archive gym:** confirm `Archive Main gym? It's hidden from the gym list. Past workouts keep it.` [Archive] [Cancel]. Toast [Undo]. A default gym can't be archived until another gym is default (`Choose another default gym first.`).
- **Delete gym** (never used): confirm `Delete Home? It hasn't been used in a workout. This can't be undone.` [Delete] [Cancel].

### 4.6 Switching gym
- Before a workout (Today): choosing a gym only selects it (today.md §4).
- During a workout: §2.8 and [gym-switch.md](gym-switch.md) §4. `Switch` calls `confirmProposal(proposalId, targetVersions)` → `applyCoachProposal` → `change_gym`. This is the same path as other review cards, so out-of-date proposals are refused (rule 5).
- `+ New travel gym` in a workout: §2.6 → `Save and switch` saves the gym, then runs the same `setActiveGym` proposal. It doesn't switch until `Switch` is tapped on the card.
- Voice "I'm at Home" / "switch gym to Home" opens the same card without the coach. Voice can confirm only a card that changes no target (gym-switch GS9).

### 4.7 Removing and deleting equipment
- An item used by any logged set can't be deleted, only `Removed from this gym` (retired). Copy: `Bench press history uses this bar, so it's kept as removed rather than deleted.`
- An item never used: swipe left → Delete, or `Delete item` at the end of its editor. Both confirm. No Undo after a delete; Undo exists for remove.

### 4.8 Coach and voice
- Voice or text "the cable machine's busy" → the coach calls the session-only `setTemporaryAvailability` and proposes swaps (active-workout.md). It never edits the saved gym.
- "I'm at the hotel gym" → the §2.8 proposal for that gym, never a silent switch.
- "This gym has no cable machine" or "they got new dumbbells" → the coach replies with a link `Edit Main gym ›` that opens the editor at that item. **The coach can't change saved inventory** (brief §12: "updates the saved inventory only through an explicit edit"). Its tool `get_gym_equipment` is read-only.
- No spoken cues in the editor.

### 4.9 Editing the current gym during a workout
- The workout uses the equipment snapshot taken at start (brief §4, `getEquipmentSnapshot`). Saving changes doesn't alter today's targets by itself.
- The banner action [Use changes today] calls `setActiveGym(sameGymId, sessionId)`, which re-snapshots and returns the same kind of proposal as §2.8, titled `Use updated Main Gym` with the button `Apply` (gym-switch §2.3). Because targets are fitted from the intended target, a target capped by a wrongly low max goes back to the planned load once the max is fixed (review SP1). Raising a max never raises a target above what was planned.
- `[Update gym]` from the workout (active-workout.md §2.11, §4.3) opens the editor for that exact item as a sheet. After `Save`, the sheet closes and the same proposal appears in the workout.

## 5. Copy

| Element | Text |
|---|---|
| Kinds | `Barbell and plates` · `Dumbbells` · `Cable or weight-stack machine` · `Assisted pull-up / dip machine` · `Plate-loaded machine` · `Pull-up bar or dip bars` · `Bench, rack or other (no weight)` |
| Common fields | `Name` · `Station label (optional)` · `Make / model (optional)` · `Used for` · `Notes (setup)` · `Availability` |
| Barbell | `Bar weight` · `Plates` · `Count every plate` · `2 a side` · `One 1.25 kg plate can't be balanced, so it isn't used.` · `Heaviest you'll load (optional)` · `More options` · `Lightest you want targets to go (optional)` |
| Dumbbells | `Weights are per dumbbell.` · `Range` · `From … to … every …` · `Add another range` · `In the rack (tap any that are missing)` · `Add a single weight` |
| Stack | `Stack, as printed on the pins` · `Uneven stack? Enter each value` · `Add-on weights (optional)` · `Attachments` · `Rope` `Straight bar` `V-bar` `Single handle` `Lat bar` `Ankle strap` `Other` · `Numbers are as printed on the stack. They're never converted to free-weight equivalents.` |
| Assisted | `Assistance, as printed` · `More assistance = easier. In a workout "+" adds assistance.` |
| Plate-loaded | `Plates go on` · `Both sides, balanced` · `One horn` · `Most plates it takes (optional)` · `Logged as plates added. The machine's own resistance isn't counted or estimated.` |
| Bodyweight | `Logged as bodyweight (BW).` · `Adding weight with a belt isn't supported yet.` |
| Plate sets | `Use plate set` · `Just this bar` · `Shared with Leg press and Hip thrust machine.` |
| Preview | `Makes 126 loads: 20–332.5 kg, total, every 2.5 kg.` · `Makes 15 loads: 2.5–40 kg each.` · `Gap: 27.5 → 32.5 kg.` · `Makes 40 loads: 5–102.5 kg stack.` · `Makes 14 loads: Assist 5–70 kg.` |
| Check a load | `Check a load` · `Each side: 25 + 15 + 1.25` · `103 kg can't be made. Nearest: 102.5 kg or 105 kg.` · `335 kg is above this bar's limit (332.5 kg).` |
| Provenance | `Typical values, not checked` · `Checked by you` |
| Validation | `Max is below the bar weight (20 kg).` · `Min is above max.` · `Add at least one weight.` · `This setup can't make any load. Check the min and max.` · `Each weight can appear once.` · Save label when invalid: `Fix 1 problem` / `Fix 2 problems` |
| Unit lock | `This item has sets logged in kg. To use lb, add it as new equipment so history stays comparable.` [Add as new] |
| Availability | `Available` · `Out of order` / `Until you mark it fixed. Workouts won't use it.` · `Removed from this gym` / `It's gone for good. History keeps it.` · rows `Out of order since 3 Oct` · `Busy today (this workout only)` [Clear] · `Removed 1 Sep` [Put back] · button `Fixed` |
| Saves | `Saved. Future workouts use the new setup.` [Undo] · `Future targets will avoid it.` · `Couldn't save Main gym. Your changes are still here.` [Try again] · `This item changed since you opened it.` [Show latest] |
| Gym detail | `Name` · `Location` · `Default gym` · `Gym notes` · `Equipment (6)` · `Add equipment` · `Removed from this gym (1)` · `Duplicate gym` · `New travel gym from this one` · `Archive gym` · `Delete gym` |
| Empty states | `No gym yet. Loads won't be checked against equipment.` · `No equipment yet. Add what this gym has so targets match it.` |
| In-workout banner | `Your workout in progress uses this gym as it was when you started.` [Use changes today] |
| Travel | `New travel gym` · `Travel gym · 12 Oct` · `Use until` · `What's there?` · `Save and switch` / `Save travel gym` · row `Travel, until Sun 18 Oct` |
| Confirms | `Archive Main gym? It's hidden from the gym list. Past workouts keep it.` · `Choose another default gym first.` · `Delete Home? It hasn't been used in a workout. This can't be undone.` · `Discard changes to Dumbbells?` · `Bench press history uses this bar, so it's kept as removed rather than deleted.` |
| Duplicate | `Main gym copy` · `Copied Main gym. History isn't shared between the two.` [Undo] |
| Switcher | `Gym for this workout` / `Choose gym` · `(current)` · `New travel gym` · `Add gym` · `Edit gyms` |
| Switch card | Owned by [gym-switch.md](gym-switch.md) §5. Main strings: `Switch to Hotel · Lisbon` · `Today only` · `No change: Lateral raise.` · `ⓘ No Olympic bar here.` · `ⓘ Max here 20 kg each` · `→ 12 reps, no load target` · `⚠ No cable station here` · `No target changes` · `Checking Hotel · Lisbon's equipment…` · actions `Not now` / `Switch` (same gym: `Use updated Main Gym` / `Apply`) |
| Switch result | `Switched to Hotel · Lisbon. Remaining sets updated for today.` [Undo] · `Switched to Home. No targets changed.` [Undo] · spoken (Set cues), only when a target changed: "Remaining sets updated for today." |
| Coach link | `Edit Main gym ›` |

All loads in this file are **equipment capabilities**, not targets or results. The only targets shown are in the switch card, and they're labelled `Target`.

## 6. Data needed

Existing (brief §4, §7; `packages/domain/src/equipment.ts`):
- `createGym(profile)`, `updateGym(id, patch)`, `addEquipment(gymId, equipment)`, `updateEquipment(id, patch)` (versioned; invalidates affected future recommendations).
- `setActiveGym(gymId, sessionId?)` → proposal for pending sets; `getEquipmentSnapshot(gymId, date)`; `setTemporaryAvailability(sessionId, equipmentId, status)`.
- (2026-10-09) `snapPlanToGym` (new, pure; contract and invariant in [gym-switch.md](gym-switch.md) §6.1), the reducer command `change_gym` / `undo_change_gym`, and schema proposals GS-S1–S5 (gym-switch §6.5).
- `getCompatibleExercises(gymId, constraints)` (the `Used for` picker and the `No match` check), `rankSubstitutions(exerciseId, gymId, intent)`.
- `getAchievableLoads`, `roundToAvailableLoad` (policy `easier` on switch), `buildPlateSetup`, `stepLoad`.
- `confirmProposal(proposalId, sessionVersion)`, `applyCoachProposal`, `undoAction(actionId)`, `getDecisionEvidence` for `Why?`.

Proposed new:

| Function | Why |
|---|---|
| `listGyms(ownerId, {includeArchived})` → rows with item count, unchecked count, default, travel dates | Gyms list and switcher |
| `duplicateGym(gymId, opId)` | Copies gym + items with new IDs; history not shared |
| `archiveGym(gymId, expectedVersion)` / `restoreGym(gymId)` / `deleteGym(gymId, expectedVersion)` (refused if any session used it) | Gym lifecycle |
| `setDefaultGym(gymId)` | One default, atomically |
| `setEquipmentAvailability(id, 'available' \| 'out_of_order' \| 'retired', note?, expectedVersion)` | GE4 |
| `deleteEquipment(id, expectedVersion)` (refused if any set used it) | Unused items only |
| `summariseLoads(equipment)` → `{count, min, max, usualStep, gaps[]}` | Preview line, built on `getAchievableLoads` |
| `generateLoadList(ranges[], singles[], missing[])` | Dumbbell, stack and assisted range builders produce a valid ascending unique list |
| `savePlateSet(gymId, plateSet, expectedVersion)` | GE3; writes the new list to each linked instance as a new version in one transaction |
| `hasLoggedSets(equipmentId)` | Unit lock and delete-vs-remove |
| `listGymPresets()` / `buildPresetDraft(presetId, unit)` / `createGymFromDraft(draft, opId)` | Shared with onboarding |

## 7. Acceptance checks

1. **Home dumbbells to 30 kg** (brief §10): a gym with only dumbbells 2–30 kg every 2 kg. In a workout the load `+` stops at 30 kg with `Rack maximum 30 kg each`; no target or swap uses a barbell or cable; loads read `kg each`.
2. A barbell with a 20 kg bar and 4 each of 20, 10, 5, 2.5 and 1.25 kg plates previews `Makes 63 loads: 20–175 kg, total, every 2.5 kg.` `Check a load` 102.5 shows `Each side: 20 + 20 + 1.25` (the fewest-plates result from `buildPlateSetup`; the editor never computes its own breakdown). 176 shows `176 kg is above this bar's limit (175 kg).`
3. Entering 3 × 1.25 kg plates on a barbell shows the "can't be balanced" hint and the preview counts only one pair.
4. Marking 30 kg missing in a 2.5–40 kg rack removes it from the saved `loads`, shows `Gap: 27.5 → 32.5 kg.`, and the workout stepper jumps 27.5 → 32.5.
5. An assisted machine's editor says `More assistance = easier`, and in the workout `+` reads "More assistance (easier)" (active-workout.md §4.3).
6. A plate-loaded machine never shows a total resistance or a converted free-weight number anywhere in the editor or preview.
7. `Max` below the bar weight, or min above max, disables `Save` with the validator's text; nothing is written.
8. An item with logged kg sets can't be switched to lb; [Add as new] creates a separate instance with no shared history.
9. **Hotel switch mid-workout** (brief §10): with 2 of 4 bench sets logged at Main gym, switching to a dumbbell-only travel gym shows a card where the 2 logged sets aren't listed; after `Switch` they still show their original values, gym and equipment in Overview and history. Remaining targets never exceed the travel rack's max. A pending exercise with no equipment there has no load target, with its reps kept, and the card has no `Skip it` (gym-switch checks 1 and 4).
10. `Not now` on the switch card leaves the gym chip and every target unchanged. Logging a set before tapping `Switch` makes the card `Out of date` and `Switch` can't apply it, by tap or voice.
11. `Undo` right after a switch restores the old gym and pending targets. After a set is logged at the new gym, Undo offers a `Switch back…` card instead of reverting. Switching back restores the planned loads (gym-switch check 6).
11a. (2026-10-09) The full switch, Repeat and routine-Start checks are [gym-switch.md](gym-switch.md) §7 checks 1–25.
12. `Machine busy` in a workout shows `Busy today (this workout only)` in the gym detail; the next workout at that gym has the item available. The saved gym's version doesn't change.
13. `Out of order` keeps the item out of new workouts' snapshots and swaps until `Fixed`; it's still listed in the gym.
14. Duplicating a gym creates new IDs for every item; editing the copy's dumbbells doesn't change the original; history for the original's items doesn't appear under the copy's items.
15. A travel gym with `Use until Sun 18 Oct` is preselected on Today until then, is archived (not deleted) on 19 Oct, and its workouts still show its name.
16. During a workout, a dumbbell-and-bench travel gym (range edited to 20 kg) is created and switched to in **5 taps**, not counting typing: gym chip, `+ New travel gym`, the range's `to` field, `Save and switch`, `Switch`.
17. Saying "this gym has no cable machine" never changes the saved gym; the reply links to the editor.
18. Saving equipment during a workout at that gym doesn't change today's targets until [Use changes today] → `Apply`. Correcting a wrongly low max then restores targets that were capped by it, never above the plan (gym-switch check 7).
19. Every control is at least 44 × 44, all text is at least 16pt, all loads use tabular numerals, the `Save` button stays visible above the keypad at 375pt and AX3, and every status (not checked, out of order, busy, removed, missing chip) has an icon or text as well as colour.
20. The editor works fully in airplane mode with no coach connected.

## 8. Proposals for Ben (schema and brief changes)

| # | Proposal | Reason |
|---|---|---|
| GE1 | Add `detailsSource: 'preset' \| 'user'` and `checkedAtUtc?` to `EquipmentInstance` | Brief §4 says presets are drafts the user confirms. Without provenance, typical values look the same as checked ones |
| GE2 | Add a no-load `accessory` kind (bench, rack with safeties, Smith frame, etc.) and `attachments: string[]` on `weight_stack` | Brief §4 lists "bench/rack/attachment availability"; the schema has no place for them, so the builder and swaps can't know a bench exists |
| GE3 | Gym-level plate sets that barbells and plate-loaded machines can link to (`plateSetId?`); the instance keeps its own copy of `plates` | One gym usually has one plate tree. Typing it per bar invites mismatches |
| GE4 | `availability: 'available' \| 'out_of_order' \| 'retired'` with `since` and `note` | Brief §4 separates "busy/broken today" from "missing". A machine broken for weeks is neither: it's on the gym but unusable until fixed |
| GE5 | `Gym.kind: 'regular' \| 'travel'` and `useUntil?`; travel gyms auto-archive the day after | Brief §1 asks for a temporary travel setup. Archiving keeps history honest and the list short |
| GE6 | An item's unit can't change once it has logged sets; add it as new equipment instead | Keeps history comparable (design-system §8: never convert silently) |
| GE7 | A mid-workout gym switch is applied only on `Switch`; `Not now` keeps the old gym | Today.md and active-workout.md say the switch "returns a proposal"; this makes explicit that the session's gym is part of the proposal. **Finalised 2026-10-09** in [gym-switch.md](gym-switch.md) (GS1–GS13), after Ben approved competitor follow-up 6 |
| GE8 (open) | How to log added weight on bodyweight stations (dip belt): `BW + 10 kg` exists in design-system §8 but no schema field or equipment source | Needs a domain decision before the editor can offer it |
| GE9 (later) | Optional "same equipment as…" grouping across gyms for shared history | Brief §4 allows explicit grouping. Not needed for the first slice; duplicates stay separate |

## Proposed design-system additions

| Name | Kind | Spec |
|---|---|---|
| `SettingsRow` | Component | Shared with profile-and-settings.md: min 52pt, title `type.body`, value/subtitle `type.callout` `text.secondary`, optional leading SF Symbol, trailing `chevron.right`. At AX1+ the value moves under the title |
| `LoadChip` | Component | 44pt min, `radius.sm`, `type.label`, tabular. Present: `bg.raised`, 1pt `border.control`, `text.primary`. Missing: `minus.circle` icon, strikethrough, `text.secondary`, dashed `border.control` outline. Never colour alone. VoiceOver "30 kilograms, in the rack" / "missing" |
| `CountStepper` | Component | `NumberStepper` variant for counts outside the workout: 44 × 44 buttons (`target.min`), value `type.headline` tabular, trailing derived text (`2 a side`) `type.callout` `text.secondary` |
| `RangeBuilder` | Component | Row `From [ ] to [ ] every [ ] <unit>` of three numeric fields (`bg.raised`, `border.control`, `radius.sm`, min 44pt), with a remove `minus.circle` button 44 × 44 |
| `LoadPreview` | Component | One or two lines `type.callout`, tabular numerals: summary + gaps. Warning variant with `exclamationmark.triangle` in `status.warning`. Updates without animation |
| `ProvenanceTag` | Component | As defined in onboarding.md (same frame as `TargetSourceTag`) |
| `ChecklistRow`, `ChoiceCard` | Components | As defined in onboarding.md |
| Icons | SF Symbols | `building.2` (gym), `airplane` (travel gym, always with the word `Travel`), `wrench.and.screwdriver` (out of order, with text), `archivebox` (archived) |

No new colour, type, spacing or timing tokens. The `ChangeReviewCard` (§9.11) is reused unchanged for the switch proposal.

## Cross-links

- [design-system.md](design-system.md): `ChangeReviewCard` §9.11, `GymChip` §9.7, `NumberStepper` §9.4, `WorkoutKeypad` §9.5, `StatusBanner` §9.12, `UndoToast` §9.10, load display conventions §8.
- [gym-switch.md](gym-switch.md): the mid-workout switch card, `snapPlanToGym` (shared with Repeat and routine Start), Undo and switch back.
- [today.md](today.md) §4: gym switcher sheet, No gym banner.
- [active-workout.md](active-workout.md): `Gym switched mid-session` and proposal states (§3), equipment-aware input and `[Update gym]` (§4.3, §2.11), `Machine busy` (§4.4).
- [rest-state.md](rest-state.md) §5: "Remaining sets updated for today." cue.
- [workout-summary.md](workout-summary.md): `[Update gym]` for `no_feasible_load`.
- [workout-builder.md](workout-builder.md): reads equipment, busy-today items and (proposed) accessories.
- [coach-adjustments.md](coach-adjustments.md): guard notes `snapped` / `capped` use the same equipment data.
- [onboarding.md](onboarding.md): presets, first gym, `ChoiceCard`, `ChecklistRow`, `ProvenanceTag`.
- [profile-and-settings.md](profile-and-settings.md): Gyms section entry, `SettingsRow`.
- `packages/schemas/src/equipment.ts`, `packages/domain/src/equipment.ts`: current model and load functions.
- ADR 0003 (B1 dropped targets), ADR 0006 (guardrails use equipment limits).
