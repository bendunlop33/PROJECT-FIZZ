# Exercise library (search, filters, custom exercises, history shortcut, substitutions)

Status: v0.1 draft, 8 Oct 2026. Brief §1 ("exercise search"), §4 (`getCompatibleExercises`, `rankSubstitutions`), §6 (`Exercise` / `ExerciseAlias`), §12 Page 2. Schema: `packages/schemas/src/exercise.ts` (`movementPattern`, `primaryMuscles`, `measurement`, `laterality`, `compatibleEquipment`, `defaultLoadConvention`, `defaultRestS`). Tokens: [design-system.md](design-system.md).

One component, four modes. The same search, rows and filters are used everywhere so Ben learns them once.

## 1. Purpose

| Mode | Opened from | Question it answers | Primary action |
|---|---|---|---|
| **Pick one** | Active workout `Add exercise` (empty card, All-done card, Overview `+ Add exercise`) | "Which exercise am I doing next?" | Tap a row (adds it at once, one tap) |
| **Pick several** | Routine editor `＋ Add exercise` | "Which exercises go in this routine?" | `Add 3 exercises` |
| **Swap** | Active workout exercise `⋯` → `Swap exercise` or `Machine busy`; routine editor `⋯` → `Replace`; routine detail `Swap ›` | "What can I do instead, here, and how different is it?" | Tap a substitute row |
| **Browse** | Plan hub 🔍 (routines.md RT1) | "What do I know about this exercise?" | Tap a row (opens Detail) |

Plus two screens: **Exercise detail** (browse) and **Custom exercise** (create/edit; primary `Save exercise`).

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| EL1 | Search is **local and deterministic**: name, catalogue aliases, Ben's own aliases and (after step 3) FitNotes names, tolerant of one typo per word of 5+ letters. A match on an alias shows which one (`Matches "RDL"`) | Works offline (rule 1). Shows why a result appeared |
| EL2 | `At <gym>` filter is **on by default** in Pick and Swap, **off** in Browse. Hidden results are counted (`12 more not at Main Gym. Show ›`), never silently missing | Rule 4: don't offer what the gym can't do mid-workout; honesty about what's hidden |
| EL3 | A custom exercise's **load convention, measurement (reps/time) and sides are locked once a set is logged** with it. To change them Ben makes a new exercise | Prevents mixing `total` and `per_hand` history under one name (no silent conversion, design-system §8) |
| EL4 | **A swap Ben picks himself in an active workout applies at once** with a visible change and Undo, scope `Today only`. A swap the **coach** suggests still uses the `ChangeReviewCard` with Apply. **This changes active-workout §4.4 and coach-adjustments CA2**, which route every swap through Apply | Ben choosing a row *is* his consent; an Apply card would add a tap mid-workout. Rule 2 is about coach and broad changes. Keeping the Apply card is the fallback if Ben prefers it |
| EL5 | Substitution reasons are **deterministic text from `rankSubstitutions`**, never model text. No numeric score is shown | No invented scores (rule 6). The coach can quote the same reasons via `get_substitutions` |
| EL6 | With a **pain flag** on the exercise being swapped, the list shows a warning, and same-movement rows say so. For **today's** session, a substitute that shares the flagged movement pattern also gets increases blocked | Rule 9 says pain stops progression "for that movement". This is the conservative reading. **Needs Ben's confirmation** |
| EL7 | Sled push/pull and similar default to the `added` convention with the note `Plates loaded. Not the true resistance.` | concurrent-training.md flag (C7); brief §4: plate maths doesn't prove sled resistance |
| EL8 | No images or videos in the library | Brief defers large exercise-media libraries |

## 2. Layout

### 2.1 Pick one (in an active workout; sheet, large detent)

Regions: sheet header · search field with mic · filter chips · `12 more not at Main Gym` line (when filtered) · `Recent` · `All exercises` (A–Z) · `Create "<query>"` row (when searching).

```
┌────────────────────────────────────────┐
│ Add exercise                    Cancel │
│ ┌──────────────────────────────┬─────┐ │
│ │ 🔍 Search exercises          │  🎙 │ │ SearchField, focused on open
│ └──────────────────────────────┴─────┘ │
│ [✓ At Main Gym] [Muscle ▾] [Movement ▾]│ FilterChips, wrap
│ [Equipment ▾]                          │
│                                        │
│ Recent                                 │
│ ┌────────────────────────────────────┐ │
│ │ Bench press                    🕘  │ │ ExerciseRow; 🕘 = history (44pt)
│ │ Barbell · Last 100 kg × 8 · 6 Oct  │ │ actual, this gym
│ ├────────────────────────────────────┤ │
│ │ Incline DB press               🕘  │ │
│ │ Dumbbells · Last 30 kg each × 9 ·  │ │
│ │ 6 Oct                              │ │
│ ├────────────────────────────────────┤ │
│ │ Cable row                      🕘  │ │
│ │ Cable · ⚠ Busy today               │ │ temporary availability
│ └────────────────────────────────────┘ │
│ All exercises                          │
│ │ Arnold press                   🕘  │ │
│ │ Dumbbells · No history             │ │
│ ...                                    │
└────────────────────────────────────────┘
```

Typing `rdl`:

```
│ ┌──────────────────────────────┬─────┐ │
│ │ 🔍 rdl                    ⓧ │  🎙 │ │
│ └──────────────────────────────┴─────┘ │
│ [✓ At Main Gym] [Muscle ▾] [Movement ▾]│
│ ┌────────────────────────────────────┐ │
│ │ Romanian deadlift              🕘  │ │
│ │ Matches "RDL" · Barbell            │ │ matched alias shown
│ │ Last 120 kg × 8 · 3 Oct            │ │
│ ├────────────────────────────────────┤ │
│ │ Single-leg RDL                 🕘  │ │
│ │ Dumbbells · per side · No history  │ │
│ └────────────────────────────────────┘ │
│ 1 more not at Main Gym. Show ›         │
│ ＋ Create "rdl" as a new exercise      │ always last when searching
├────────────────────────────────────────┤
│               keyboard                 │
```

Row rules (`ExerciseRow`, 52pt min):
- Line 1: name (`type.headline`, two lines max), `🕘` history button on the right (44 × 44, VoiceOver "History for Bench press").
- Line 2: `Matches "<alias>"` (only on alias hits), the equipment kinds this gym has for it, `per side` (unilateral), `Time` (timed).
- Line 3 (or end of line 2): `Last <actual> · <date>` from the most recent comparable set **at this gym**; `Last at Hotel Gym: …` if only elsewhere; `No history`.
- Tags, as icon + text: `⚠ Busy today` (`status.warning`), `⊘ Not at Main Gym` (`text.secondary`), `Custom`, `⚠ Pain flagged` (`status.warning`).

### 2.2 Pick several (routine editor; pushed screen)

Same as §2.1, but rows have a leading checkbox (`circle` / `checkmark.circle.fill`, with "selected" for VoiceOver), tapping toggles, and a fixed action bar shows the primary:

```
│ ☑ Bench press                      🕘  │
│ ☐ Incline DB press                 🕘  │
│ ☑ Cable fly                        🕘  │
├────────────────────────────────────────┤
│ Selected: Bench press, Cable fly       │ type.callout, one line, tail …
│ [         Add 2 exercises            ] │ PrimaryButton, above keyboard
```

Exercises are added in the order they were ticked, each with one working set (`Auto × 8–10`, or `0:45` for timed) and the type presets. `At <gym>` uses the routine's default gym (routines.md).

### 2.3 Filter sheets (medium detent)

```
┌────────────────────────────────────────┐
│ Movement                   Clear  Done │
│ [Horizontal push] [Vertical push]      │ multi-select ParamChips
│ [Horizontal pull] [✓Vertical pull]     │
│ [Squat] [Hinge] [Lunge / single leg]   │
│ [Carry] [Core] [Arms] [Calves]         │
│ [Conditioning]                         │
└────────────────────────────────────────┘
```

- `Muscle`: Chest · Back · Shoulders · Biceps · Triceps · Quads · Hamstrings · Glutes · Calves · Core · Forearms.
- `Equipment`: Barbell · Dumbbells · Cable / stack · Plate-loaded · Bodyweight · Assisted. With `At <gym>` on, kinds the gym lacks are disabled with `Not at Main Gym` (hint).
- An active filter chip shows its choice: `Movement: Vertical pull`, or `Muscle: 2`. `Clear` empties that filter. Filters persist for the sheet's life only; `At <gym>` resets to the mode default each time.

### 2.4 Exercise detail (browse)

```
┌────────────────────────────────────────┐
│ ‹ Exercises     Bench press       ⋯    │ ⋯: Add other name, Hide (custom)
├────────────────────────────────────────┤
│ Bench press                            │ type.title2
│ Horizontal push · Barbell              │
│ Chest · triceps · front shoulders      │
│ Load: total on the bar · both sides    │ convention, laterality in words
│ Also called: Flat bench, BB bench      │ aliases (Ben's marked "yours")
│                                        │
│ History                              › │ opens history sheet
│ Last 100 kg × 8 · 6 Oct · Main Gym     │ actual
│ 14 workouts since 2 Jul                │
│                                        │
│ Default rest   Heavy 3:00            › │ exercise default (step 3)
│ Notes          Grip on the ring      › │
│ Alternatives at Main Gym             › │ Swap list, read-only
│ Used in        Push A, Push B          │ links to routines
└────────────────────────────────────────┘
```

Catalogue exercises are read-only except `Other names`, `Default rest` and `Notes`, which are Ben's. Custom exercises add `Edit` in the nav bar.

### 2.5 Swap (substitutions)

Opened in an active workout as a sheet (large detent, so the Log button is one swipe away); in the editor and routine detail as a pushed screen.

```
┌────────────────────────────────────────┐
│ Swap Bench press                Cancel │
│ At Main Gym · today only               │ context + scope (workout)
│ Why swap?                              │
│ [✓Closest match] [Same muscles]        │ single-select ParamChips (intent)
│ [Different equipment]                  │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ DB bench press                 🕘  │ │ SubstituteRow
│ │ Dumbbells (up to 30 kg each)       │ │
│ │ ✓ Same movement: horizontal push   │ │ reasons (icon + text)
│ │ ✓ Same main muscles                │ │
│ │ ✓ Done 6 times · last 32.5 kg each │ │ actual
│ │   × 8 (29 Sep)                     │ │
│ │ ≠ Loads aren't comparable with     │ │ difference (icon + text)
│ │   Bench press (kg each).           │ │
│ ├────────────────────────────────────┤ │
│ │ Machine chest press            🕘  │ │
│ │ Stack (5–100 kg)                   │ │
│ │ ✓ Same movement: horizontal push   │ │
│ │ ≠ No history: start light, enter   │ │
│ │   your load.                       │ │
│ ├────────────────────────────────────┤ │
│ │ Push-up                        🕘  │ │
│ │ Bodyweight                         │ │
│ │ ✓ Same movement: horizontal push   │ │
│ │ ≠ Bodyweight: reps instead of load │ │
│ └────────────────────────────────────┘ │
│ Search all exercises ›                 │ opens Pick one with this context
└────────────────────────────────────────┘
```

- Order comes from `rankSubstitutions(exerciseId, gymId, intent)`. Up to 2 `✓` reasons and 1 `≠` difference per row; the rest under the row's `More ›`.
- Intents: `Closest match` (movement, then muscles, then Ben's history), `Same muscles` (muscles first; for hypertrophy goals), `Different equipment` (excludes the current equipment kind; preselected when opened from `Machine busy`, with the header `Cable stack 2 is busy today.`).
- **Pain flag** (EL6): a warning line above the list, `⚠ You flagged pain on Bench press. Exercises with the same movement may load the same area.` Same-movement rows add `⚠ Same movement as the one you flagged`. No row is described as safe or recommended for pain.

#### After choosing, in an active workout (EL4)

The sheet closes. The coach slot shows the swap, collapsed (no Apply step):

```
│ ✓ Swapped to DB bench press for today  │ coach slot (focused card)
│ Sets 3–4 · Target 32.5 kg each × 6–8   │ targets from its own history
│ Change Push A too ›          [ Undo ]  │
```

- Completed sets stay under Bench press. Pending sets move to the new exercise with the same set types, reps, effort and rest. Loads come from the substitute's own history (`calculateNextTargets`), or none (`No history: start light, enter your load.`). Never converted.
- `Change Push A too ›` opens [change-review.md](change-review.md) with a `Future sessions` scope, author `Ben`.
- If EL4 is **not** approved: the same content shows as the existing `ChangeReviewCard` (`Today only`) with [Not now] [Apply].

### 2.6 Custom exercise (create / edit; pushed screen)

```
┌────────────────────────────────────────┐
│ Cancel        New exercise             │
├────────────────────────────────────────┤
│ Name                                   │
│ ┌────────────────────────────────────┐ │
│ │ Landmine press                     │ │ prefilled from the search text
│ └────────────────────────────────────┘ │
│ ⓘ Similar in your list: Landmine row.  │ findSimilarExercises
│   Use it instead ›                     │
│ Equipment                              │
│ [✓Barbell] [Dumbbells] [Cable / stack] │ single-select ParamChips
│ [Plate-loaded] [Bodyweight] [Assisted] │
│ How the load is counted                │
│ (•) Total on the bar      e.g. 40 kg   │ only conventions valid for the
│ ( ) Plates added          e.g. 20 kg   │ chosen equipment, with an example
│                           plates       │
│ Measured by     [✓Reps] [Time]         │
│ Sides           [✓Both together]       │
│                 [One side at a time]   │ unilateral
│ Movement        [ Vertical push ▾ ]    │ required (`Not sure` allowed)
│ Main muscles (optional)                │
│ [✓Shoulders] [Triceps] [Chest] [More ▾]│
│ Other names (optional)                 │
│ ┌────────────────────────────────────┐ │
│ │ e.g. LM press                      │ │ comma-separated
│ └────────────────────────────────────┘ │
│ Default rest (optional)  [Use presets ▾]│
├────────────────────────────────────────┤
│ [            Save exercise           ] │ PrimaryButton, above keyboard
└────────────────────────────────────────┘
```

Load convention choices by equipment (schema `LoadConvention`; display per design-system §8):

| Equipment | Choices (first = default) |
|---|---|
| Barbell | `Total on the bar` (`total`) · `Plates added` (`added`) |
| Dumbbells | `Each dumbbell` (`per_hand`) |
| Cable / stack | `Stack reading` (`stack`) |
| Plate-loaded | `Plates added` (`added`), with the note `Plates loaded. Not the true resistance.` |
| Bodyweight | `Bodyweight only` (`bodyweight`) · `Bodyweight + added` (`added`) |
| Assisted | `Assistance (more is easier)` (`assistance`) |

`Measured by: Time` makes load optional and sets show `0:45`. `One side at a time` sets `laterality: unilateral`.

Edit mode: once a set is logged with the exercise, `Equipment`, `How the load is counted`, `Measured by` and `Sides` show their value with a `lock` icon and `Locked: you've logged 6 sets with this. Make a new exercise to change it.` (EL3). Name, movement, muscles, other names and rest stay editable; renaming keeps history.

## 3. States

| State | Shows | Notes |
|---|---|---|
| Loading | Nothing for 300 ms, then static rows | Catalogue is local; normally instant |
| Empty query | `Recent` (last 10 used, newest first) then `All exercises` | In a brand-new install with no history, only `All exercises` |
| Results | Matching rows, best match first: exact name, name prefix, alias, word match, typo match | EL1 |
| Results hidden by gym | `12 more not at Main Gym. Show ›` under the list; `Show` turns `At Main Gym` off | EL2 |
| No results | `No match for "landmine twst".` + `＋ Create "landmine twst" as a new exercise` + `Clear filters` (if any are on) | Never an empty white sheet |
| No gym selected | Chip reads `Any gym` and is disabled; caption `No gym selected, so equipment isn't checked.` [Add gym] | Rows show no availability tags |
| Busy equipment | Rows using it show `⚠ Busy today`; still selectable (Ben may wait) | `setTemporaryAvailability` |
| Pain flagged | Row tag `⚠ Pain flagged`; Swap header warning (EL6) | Never hidden |
| Swap: nothing suitable | `Nothing at Main Gym matches Bench press's movement.` + `Search all exercises ›` + (workout) `Skip exercise` link | Never a fake match |
| Swap: exercise already in today's workout | Row shows `Already in this workout` and moves to the end | Avoids a duplicate block |
| Swap applied (workout) | §2.5 collapsed slot with Undo | — |
| Swap undone | Slot: `Back to Bench press for sets 3–4.` | — |
| Swap stale | Ben logged a set of Bench press between opening the sheet and choosing: the swap applies to the **remaining** pending sets only; the slot names them | Done sets never move |
| Swap rejected | All of Bench press's sets were done meanwhile: `Nothing left to swap: Bench press is done.` | — |
| Custom: duplicate name | `ⓘ Similar in your list: …` (not blocking). An exact duplicate name blocks Save: `You already have "Landmine press".` | — |
| Custom: save failed | `Couldn't save the exercise. Your entries are still here.` [Try again] (same opId) | — |
| Offline / AI unavailable | No change. Everything here is local | Rule 1 |
| Database error | `Couldn't open your exercise list.` [Try again] | — |

Transitions (Pick one, active workout):

```
 Add exercise ─► Pick one ─row tap─► addExercise ─► sheet closes ─► Active workout (new exercise active)
                  │  └─🕘─► History sheet ─Close─► Pick one (query and filters kept)
                  └─Create "…"─► Custom exercise ─Save─► addExercise ─► Active workout
```

## 4. Interactions

### 4.1 Search and filters
- The search field opens focused with the system keyboard (it's text). Return dismisses the keyboard. Results update on each keystroke (local, no debounce needed under ~1,000 exercises).
- `🎙` dictates into the field using on-device speech (`DEP-STT`); it's hidden when speech isn't available. Dictation never selects a row by itself.
- `ⓧ` clears the query; the keyboard stays.
- Filter chips open their sheet; `At <gym>` toggles directly.

### 4.2 Rows
| Mode | Row tap | `🕘` |
|---|---|---|
| Pick one | `addExercise` with this gym's compatible equipment (busy instances last), then close. One tap | History sheet |
| Pick several | Toggle selection | History sheet |
| Swap | Workout: apply the swap (EL4). Editor: replace in the draft (routines.md §4.3). Detail `Swap ›`: as the editor, or `Today only` at Start | History sheet |
| Browse | Exercise detail | History sheet |

A row whose equipment isn't at this gym (with `At <gym>` off) asks before adding in Pick one: `Main Gym has no cable station. Add Cable fly anyway?` [Add] [Cancel]. The added exercise then has no equipment and shows `no load target` in the workout.

### 4.3 History sheet (medium detent)

```
│ Bench press history               Done │
│ Main Gym · Olympic bar                 │ grouped by equipment and gym
│ 6 Oct   100 × 8 · 100 × 7 · 97.5 × 8   │ kg; actuals; tabular
│ 1 Oct   100 × 8 · 100 × 8 · 100 × 6    │
│ Hotel Gym · Smith machine              │ separate group, never merged
│ 12 Sep  60 × 10 · 60 × 10              │
│ Open in Progress ›                     │
```
`getComparableHistory` per equipment group; units and conventions in each group header. Warm-ups shown with `W`. Tapping a date opens that workout's summary.

### 4.4 Custom exercise
- `Save exercise` → `createCustomExercise(input, opId)` (or `updateCustomExercise(id, patch, expectedVersion)`). Disabled 1 s after tap. In Pick modes the new exercise is then added (one more tap saved).
- `Use it instead ›` on the similar-name note picks the existing exercise.
- Delete: a custom exercise with no logged sets can be deleted (`Delete Landmine press?` [Delete] [Cancel], then toast [Undo]). With logged sets, only `Hide from lists` is offered; history and Progress keep it, and `Show hidden exercises` in the Browse `⋯` brings it back.

### 4.5 Voice
- Dictation into the search field (above).
- In a workout, "swap to dumbbell bench" or "the cable machine's busy" goes to the coach (`classifyCoachIntent` → `swap_exercise`), which uses `get_substitutions` and returns a `ChangeReviewCard` with Apply (coach-initiated, CA2). With the coach offline, the voice strip says `Swapping by voice needs the coach. Use Swap exercise in the ⋯ menu.`

### 4.6 Undo paths
| What | Undo |
|---|---|
| Added an exercise in a workout by mistake | While none of its sets are logged: exercise `⋯` → `Remove exercise` (no confirm, toast [Undo]) |
| Swap in a workout | `Undo` in the slot; later, exercise `⋯` → `Undo swap` while its sets are still pending. Logged sets of the new exercise stay (they're real) |
| Replace in the editor | Editor `Cancel` (until Save), then routine Undo |
| New custom exercise | Delete it (no history) |
| Edited custom exercise | Edit again; versions are kept |
| Hidden exercise | `Show hidden exercises` → `Unhide` |

## 5. Copy

`Last …` values are **actuals**. Swap result targets are **targets**.

| Element | Text |
|---|---|
| Titles | `Add exercise` · `Add exercises` (several) · `Swap Bench press` · `Exercises` (browse) · `New exercise` · `Edit exercise` |
| Search | Placeholder `Search exercises` · `Matches "RDL"` · `No match for "landmine twst".` · `＋ Create "landmine twst" as a new exercise` |
| Sections | `Recent` · `All exercises` · `12 more not at Main Gym. Show ›` |
| Chips | `At Main Gym` · `Any gym` · `Muscle` · `Movement` · `Equipment` · `Movement: Vertical pull` · `Muscle: 2` · `Clear` · `Done` |
| Row | `Last 100 kg × 8 · 6 Oct` · `Last at Hotel Gym: 60 kg × 10 · 12 Sep` · `No history` · `per side` · `Time` · `Busy today` · `Not at Main Gym` · `Custom` · `Pain flagged` · `Already in this workout` |
| Pick several | `Selected: Bench press, Cable fly` · primary `Add 2 exercises` / `Add exercise` / disabled `Select exercises` |
| No gym | `No gym selected, so equipment isn't checked.` [Add gym] |
| Not at gym confirm | `Main Gym has no cable station. Add Cable fly anyway?` [Add] [Cancel] |
| Swap header | `At Main Gym · today only` · `Why swap?` · `Closest match` · `Same muscles` · `Different equipment` · `Cable stack 2 is busy today.` |
| Swap reasons | `Same movement: horizontal push` · `Same main muscles` · `Done 6 times · last 32.5 kg each × 8 (29 Sep)` · `At Main Gym: dumbbells up to 30 kg each` |
| Swap differences | `Loads aren't comparable with Bench press (kg each).` · `No history: start light, enter your load.` · `Bodyweight: reps instead of load.` · `Logged per side.` · `Plates loaded. Not the true resistance.` |
| Swap pain | `You flagged pain on Bench press. Exercises with the same movement may load the same area.` · `Same movement as the one you flagged` |
| Swap empty | `Nothing at Main Gym matches Bench press's movement.` · `Search all exercises ›` · `Skip exercise` |
| Swap applied | `Swapped to DB bench press for today` · `Sets 3–4 · Target 32.5 kg each × 6–8` · `Change Push A too ›` · `Undo` |
| Swap undone / rejected | `Back to Bench press for sets 3–4.` · `Nothing left to swap: Bench press is done.` |
| Detail | `Load: total on the bar · both sides` · `Also called:` · `History` · `14 workouts since 2 Jul` · `Default rest` · `Notes` · `Alternatives at Main Gym` · `Used in` |
| History sheet | `Bench press history` · group `Main Gym · Olympic bar` · `Open in Progress ›` |
| Custom form | `Name` · `Similar in your list: Landmine row. Use it instead ›` · `Equipment` · `How the load is counted` · `Total on the bar` · `Plates added` · `Each dumbbell` · `Stack reading` · `Bodyweight only` · `Bodyweight + added` · `Assistance (more is easier)` · `Measured by` (`Reps`, `Time`) · `Sides` (`Both together`, `One side at a time`) · `Movement` (`Not sure`) · `Main muscles (optional)` · `Other names (optional)` · `Default rest (optional)` (`Use presets`) · primary `Save exercise` |
| Custom locks | `Locked: you've logged 6 sets with this. Make a new exercise to change it.` |
| Custom errors | `You already have "Landmine press".` · `Couldn't save the exercise. Your entries are still here.` [Try again] |
| Custom delete / hide | `Delete Landmine press?` [Delete] [Cancel] · `Hide from lists` · `Show hidden exercises` · `Unhide` |
| Voice, coach offline | `Swapping by voice needs the coach. Use Swap exercise in the ⋯ menu.` |

Spoken (Set cues / Conversation, only when the swap came from a voice request): "Swapped to dumbbell bench press for today. Target 32 and a half kilos each, 6 to 8." (targets).

## 6. Data needed

Existing (brief §4, §7; schemas; active-workout §6):
- `getCompatibleExercises(gymId, constraints)`, `getEquipmentSnapshot(gymId, date)` (permanent setup + busy today), `setTemporaryAvailability(sessionId, equipmentId, status)`.
- `rankSubstitutions(exerciseId, gymId, intent)`: must return, per candidate, `{exerciseId, equipmentIds, reasons[{kind, text}], differences[{kind, text}], historyCount, lastActual?}`, ordered, with **no score field exposed to the UI** (EL5). `intent: 'closest' | 'same_muscles' | 'different_equipment'`, plus `excludeEquipmentIds` for busy stations.
- `getComparableHistory(exerciseId, equipmentId, filters)`, `calculateNextTargets(history, rule, equipment)` for a substitute's targets.
- `addExercise` (session; builds the catalogue snapshot, ADR 0003 M4), `PainStatus`, `setPainFlag`.
- Coach path: `classifyCoachIntent`, `get_substitutions` tool, `validateCoachProposal`, `confirmProposal`, `applyCoachProposal`.

**Proposed new (flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `searchExercises(ownerId, query, filters)` | **Pure over the catalogue + aliases.** `filters = {gymId?, availableOnly, muscles[], movements[], equipmentKinds[], includeHidden}`. Returns rows `{exercise, matchedAlias?, availability: 'available' \| 'busy' \| 'not_at_gym' \| 'unknown', lastActual?, painFlagged}` and `hiddenByGymCount`. Ranking per EL1 |
| `listRecentExercises(ownerId, limit)` | Last used, newest first |
| `findSimilarExercises(ownerId, name)` | For the custom form's duplicate note |
| `createCustomExercise(input, opId)` / `updateCustomExercise(id, patch, expectedVersion)` | Validates convention vs equipment (table §2.6); rejects changes to locked fields with `field_locked` (EL3) |
| `addExerciseAlias(exerciseId, alias)` / `removeExerciseAlias` | Ben's own aliases; also used by the FitNotes import mapping |
| `hideExercise(id)` / `unhideExercise(id)` / `deleteCustomExercise(id)` | Delete only with no logged sets |
| Command `swap_exercise {sessionExerciseId, newExerciseId, equipmentId, opId}` with `undo_swap` | Moves **pending** sets only, bumps `session.version`, records `author: 'ben' \| 'coach'` (EL4). Not in the command union yet |
| `getMovementPatterns()` / `getMuscleGroups()` | Fixed lists for filters and the custom form |

## 7. Acceptance checks

1. In a workout, `Add exercise` → typing `rdl` → tapping `Romanian deadlift` adds it and makes it active: **one tap after typing**, no extra confirmation.
2. Searching `RDL`, `rdl` or `romanain deadlift` (one typo) finds Romanian deadlift; the alias hit shows `Matches "RDL"`.
3. With `At Main Gym` on at a gym without a cable station, no cable exercise is listed and the hidden count line shows the right number; `Show ›` reveals them tagged `Not at Main Gym`.
4. Busy equipment is tagged `Busy today` and still selectable; pain-flagged exercises are tagged and never hidden.
5. Every `Last …` value is an actual from the same gym and equipment, or labelled with the other gym. No value is converted between conventions or units.
6. With airplane mode on and no AI, search, filters, history, custom exercises and Ben-initiated swaps all work.
7. Creating `Landmine press` with Barbell offers only `Total on the bar` and `Plates added`; Dumbbells offers only `Each dumbbell`; Plate-loaded shows the `Not the true resistance` note.
8. After logging one set with a custom exercise, its convention, measurement and sides are locked with the explanation; renaming keeps its history.
9. Swap list rows show reason lines with icon and text and never show a number score. Reason text is the same as the `get_substitutions` tool output for the same inputs (unit test).
10. A Ben-initiated swap in a workout (EL4 approved) moves only pending sets, keeps done sets under the original exercise, shows targets from the substitute's own history or `No history: start light, enter your load.`, and Undo restores the original pending sets.
11. A coach-initiated swap still shows a `ChangeReviewCard` and changes nothing until Apply.
12. Opening Swap from `Machine busy` preselects `Different equipment` and never lists the busy station first.
13. With a pain flag on Bench press, the Swap header shows the warning, same-movement rows say so, and (EL6 approved) increases on a same-movement substitute are blocked for today.
14. The history sheet groups by gym and equipment and never merges a Smith machine with a free barbell.
15. At AX3 in Pick several, `Add 2 exercises` is fully visible above the keyboard at 375pt width; rows stack without truncating numbers or units.
16. Every gesture has a button equivalent; every tag and reason has text or an icon as well as colour, in dark and light modes.

## Proposed design-system additions

No new colours or timing tokens.

| Component | Spec |
|---|---|
| `SearchField` | 52pt tall, `bg.raised`, 1pt `border.control`, `radius.sm`; `magnifyingglass` icon, `type.body` text, `xmark.circle.fill` clear (44 × 44 hit), optional `mic` button (44 × 44) on the right, separated by `space.2`. Hides the mic when `DEP-STT` is unavailable |
| `FilterChip` | `ParamChip` (§9.17) plus a trailing `chevron.down` and, when active, the choice text (`Movement: Vertical pull`). A toggle chip (`At Main Gym`) uses the `checkmark` selected state |
| `ExerciseRow` | 52pt min, `bg.surface`, padding `space.3`. Line 1 `type.headline`; lines 2–3 `type.callout` `text.secondary`, numbers tabular. Optional leading checkbox (Pick several). Trailing history button 44 × 44 (`clock.arrow.circlepath`). Stacks at AX1+ |
| `AvailabilityTag` | Inline icon + word, `type.label`: `⚠ Busy today` / `⚠ Pain flagged` (`status.warning`), `⊘ Not at Main Gym` (`slash.circle`, `text.secondary`), `Custom` (`text.secondary`). Never colour alone |
| `SubstituteRow` | `ExerciseRow` plus up to 2 reason lines (`checkmark` icon, `text.primary`) and 1 difference line (`notequal` icon, `text.secondary`), `type.callout`; `More ›` when there are more |
| `SwapSlotLine` | Collapsed swap result in the coach slot: `checkmark.circle.fill` (`status.done`) + line 1 `type.headline`, line 2 targets (`type.callout`), row `Change … too ›` (left, `accent`) and `Undo` (right) with `target.workout` hit areas ≥ `space.8` apart. Same frame as `CoachAdjustmentBanner` without the coach icon |

## Cross-links

- [active-workout.md](active-workout.md) §2.10, §4.4: `Add exercise`, `Swap exercise`, `Machine busy` (EL4 proposes changing the swap step)
- [coach-adjustments.md](coach-adjustments.md) CA2: coach-initiated swaps keep the Apply card
- [routines.md](routines.md): `＋ Add exercise`, `Replace`, `Swap ›`, Plan hub 🔍
- [change-review.md](change-review.md): `Change Push A too ›` and coach swap proposals
- [workout-builder.md](workout-builder.md) WB4: the builder uses the same `rankSubstitutions` same-movement rule
- [today.md](today.md): gym switcher (equipment context for `At <gym>`)
- `docs/training-guides/concurrent-training.md` C7: sled convention note (EL7)
