# Exercise library (search, filters, custom exercises, history shortcut, substitutions)

> **Revision 2026-10-08 (consolidation).** Data domains (design-system §7.2): the catalogue, aliases and custom exercise definitions are **Coaching knowledge**; Ben's history shown on rows (`Last …`) is **Your data**. `Reset coaching knowledge` keeps any custom exercise his history or routines use (data-import-export.md §2.7; the placement of custom exercises is listed in open-decisions.md). Proposed components are merged into design-system: `SearchField`, `FilterChip` (§9.37 area), `ExerciseRow` / `SubstituteRow` (§9.35), `AvailabilityTag` (on the `Tag` frame, §9.28), `SwapSlotLine` (a `ResultCard`, §9.48). EL4 and EL6 are in open-decisions.md.

> **Revision 2026-10-09 (exercise guides, [ADR 0013](../decisions/0013-in-app-guide-playback.md)).** Ben approved in-app guide playback on 9 Oct 2026, and the developer has built it. This revision brings the spec in line with the build. **EL8 is replaced**: rich catalogue entries now get an original, code-drawn animated guide plus cues. New **§8 Guide (How to screen)** documents the screen as built and lists the developer's own calls, marked *provisional, confirm on device*, with the designer's view on each. §1 now lists How to as a third screen. §2.4 Exercise detail gains a `How to ›` row (specified here, not built yet). Design-system principle 5 gains the guide motion exception, with guide colour aliases (§2.3) and `ExerciseGuide` (§9.57). The app is now called **GymSmarter**, and new copy uses that name. "Fizz" in older specs means GymSmarter.

> **Revision 2026-10-09 (guides v2, [exercise-guides-v2.md](exercise-guides-v2.md); specified, not built).** Ben reviewed the 10 guides and asked for more detail, the muscles to feel highlighted, and what NOT to do as text. §8 now has **§8.11 Guides v2**, and the as-built sections note where v2 changes them. Summary: an anatomical figure; muscle regions in one violet hue (`guide.muscle`, the neutral-only exception **per Ben's request of 9 Oct 2026**); `Feel it most:` / `Also works:` lines in the player card (replacing the header's `Main muscles:`); a `What not to do` card directly under the player (replacing `Common mistakes`); a `Full screen` view; and higher-quality rendering.

> **Revision 2026-10-09 (pain-flag UX, competitor follow-up 8; approved by Ben, CHANGELOG 2026-10-09).** A pain-flagged exercise is now tagged **`⚠ May hurt`** (was `⚠ Pain flagged`), and adding it asks first: `Overhead press may hurt` [Add anyway] [Choose another] (EL9). This applies in Pick one and in the workout's Swap sheet. Pick several (the routine editor) shows an inline line on tick instead of an alert. Only exercises the flag covers are tagged; similar movements aren't (coach-memory CM5). Rows are never hidden. Everything is local and works offline. The rest of the pain UX (the two-weekly `Still hurts?` check, the pre-flag reference) is in [active-workout.md](active-workout.md) §2.14. Changed: §1 (EL9), §2.1, §2.2, §2.5, §3, §4.2, §5, §6, §7 (check 4 revised; checks 17–20), design-system additions.

Status: v0.1 draft, 8 Oct 2026. Brief §1 ("exercise search"), §4 (`getCompatibleExercises`, `rankSubstitutions`), §6 (`Exercise` / `ExerciseAlias`), §12 Page 2. Schema: `packages/schemas/src/exercise.ts` (`movementPattern`, `primaryMuscles`, `measurement`, `laterality`, `compatibleEquipment`, `defaultLoadConvention`, `defaultRestS`). Tokens: [design-system.md](design-system.md).

One component, four modes. The same search, rows and filters are used everywhere so Ben learns them once.

## 1. Purpose

| Mode | Opened from | Question it answers | Primary action |
|---|---|---|---|
| **Pick one** | Active workout `Add exercise` (empty card, All-done card, Overview `+ Add exercise`) | "Which exercise am I doing next?" | Tap a row (adds it at once, one tap; a `May hurt` row asks first, EL9) |
| **Pick several** | Routine editor `＋ Add exercise` | "Which exercises go in this routine?" | `Add 3 exercises` |
| **Swap** | Active workout exercise `⋯` → `Swap exercise` or `Machine busy`; routine editor `⋯` → `Replace`; routine detail `Swap ›` | "What can I do instead, here, and how different is it?" | Tap a substitute row |
| **Browse** | Plan hub 🔍 (routines.md RT1) | "What do I know about this exercise?" | Tap a row (opens Detail) |

Plus three screens: **Exercise detail** (browse), **Custom exercise** (create/edit; primary `Save exercise`) and **How to** (the exercise guide, §8; read-only, so it has no primary action beyond `Done`).

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
| EL9 | (2026-10-09) **A pain-flagged exercise is tagged `May hurt` and asks before it's added** in Pick one and the workout's Swap sheet (an action sheet: `Add anyway` / `Choose another`). Pick several shows an inline line on tick, with no alert. Only exercises the flag covers are tagged | Approved item 8 (competitor landscape). One extra tap only on a flagged row, which is rare, and it's the moment a flag matters. Tagging similar movements would mean the app deciding which joints are involved (CM5, rule 9). The routine editor is a draft that can be undone, so an alert there would only add friction |
| EL8 | **Rich catalogue entries show an original animated guide and cues on a `How to` screen (§8). Basic entries show none.** Guides are drawn in code from the shared figure rig (ADR 0011, 0013), bundled, and work offline. There is no filmed, third-party or AI-generated media | **Approved by Ben, 9 Oct 2026** (replaces "No images or videos in the library"). A guide opens only when Ben asks for it, so it never adds a tap or any motion to the logging loop. The brief §157 wording ("defer large exercise-media libraries") still needs the matching change (research brief change 1) |

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
- `ⓘ` How to button (revision 2026-10-09, built, provisional; §8.8): `info.circle` in `text.secondary`, 44 × 44. It is shown only for exercises with a guide or rich cues. It sits immediately left of `🕘`, `space.2` apart, so history stays at the trailing edge. It opens How to over the picker. The row tap still adds the exercise in one tap. VoiceOver: "How to do Bench press". At AX1+ the name wraps; the two buttons never push numbers or units into truncation.
- Line 2: `Matches "<alias>"` (only on alias hits), the equipment kinds this gym has for it, `per side` (unilateral), `Time` (timed).
- Line 3 (or end of line 2): `Last <actual> · <date>` from the most recent comparable set **at this gym**; `Last at Hotel Gym: …` if only elsewhere; `No history`.
- Tags, as icon + text: `⚠ Busy today` (`status.warning`), `⊘ Not at Main Gym` (`text.secondary`), `Custom`, `⚠ May hurt` (`status.warning`; revision 2026-10-09, was `⚠ Pain flagged`). `May hurt` appears only on exercises an active pain flag covers, never on similar movements, and the row is never hidden. VoiceOver: "May hurt: you flagged shoulder pain on it."
- (2026-10-09, EL9) **Tapping a `May hurt` row asks first** (system action sheet), instead of adding at once:

```
┌────────────────────────────────────────┐
│ Overhead press may hurt                │
│ Shoulder pain flagged 6 Oct.           │
│ [ Add anyway ]                         │
│ [ Choose another ]                     │ cancel role
└────────────────────────────────────────┘
```

  `Add anyway` → `addExercise` as usual, and the workout card shows the `PainFlagNote`. `Choose another` (or swiping down) returns to the picker with the query and filters kept, and adds nothing. With no area on the flag, the second line reads `You flagged pain on it on 6 Oct.` The confirm never says the exercise is safe or unsafe, and never suggests a cause.

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

(2026-10-09, EL9) Ticking a `⚠ May hurt` row selects it with no alert, and adds one line under the row: `⚠ May hurt: you flagged shoulder pain on 6 Oct. Loads won't go up while the flag is on.` (`type.callout`, `status.warning` icon, `text.secondary` text). The routine draft can still be cancelled or edited, so nothing is asked twice.

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
│ How to         Guide · Draft         › │ opens How to (§8); only with a how-to
│                                        │
│ Default rest   Heavy 3:00            › │ exercise default (step 3)
│ Notes          Grip on the ring      › │
│ Alternatives at Main Gym             › │ Swap list, read-only
│ Used in        Push A, Push B          │ links to routines
└────────────────────────────────────────┘
```

Catalogue exercises are read-only except `Other names`, `Default rest` and `Notes`, which are Ben's. Custom exercises add `Edit` in the nav bar.

**`How to ›` row (revision 2026-10-09; specified, not built).** The row is shown only when `hasHowTo(catalogueKey)` is true. Its value reads `Guide` (animated guide), `Guide · Draft` (guide not yet approved) or `Cues` (rich entry with no guide). It opens the same How to screen as the workout (§8). The player is **not** embedded in Exercise detail. That departs from research §5.7 ("Guide section in Exercise detail"), for three reasons. Detail stays a data screen about Ben's history. There is one player surface to test for battery and Reduce Motion. Detail opens without starting an animation Ben didn't ask for.

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
- (2026-10-09, EL9) A substitute that **itself** has an active pain flag shows `⚠ May hurt`, and choosing it asks the same `… may hurt` question (§2.1) before the swap applies. `Choose another` keeps the Swap sheet open.

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
- **As built (developer, 11 Oct; B3 accepted).** Decided conservatively where this section left details open:
  - The result shows as the standard toast `Bench press → DB bench press` [Undo] (8 s), not a coach-slot card: the slot belongs to the coach, and the focused card already shows the new name and target (minimal copy). After the toast, exercise `⋯` → `Undo swap` while any of the moved sets is pending.
  - `Change Push A too ›` isn't offered mid-workout yet: it needs the routine editor (workout-library branch). Before Start it stays as built (TE4).
  - `Swap exercise` is in the `⋯` menu only while the exercise has a pending set. The sheet is the same `rankSubstitutions` list as before Start, at the workout's current gym (its equipment as the workout has it), leaving out every exercise already in the workout.
  - One new set per pending set, in order, with the same set type and rest. Its target is the substitute's plan for that set type (its own history through the built-in rule), fitted by `snapPlanToGym` (mode `start`); a load that can't be made here is left blank (`—`), never converted from the original. With no history the reps (or time) of the pending set stay and the load is blank.
  - The original row keeps its done and skipped sets. With nothing left on it, it leaves the workout (`removed: swap`) and comes back on Undo.
  - The pending other side of a half-logged left/right pair stays on the original row and finishes that pair there (as a gym switch leaves it); only untouched sets move.
  - Pain (B5, accepted 11 Oct; rule 9): when the row being swapped (or the row it was swapped from today) has an active pain flag, or a logged set on it is marked `Pain`, every substitute's targets are held for today: the plan runs as if pain was reported in this workout, so no load or reps increase. The sheet shows `⚠ Pain flag · no increases` under its title. Before Start, an active flag on the planned exercise does the same.
  - Undo (`undo_op`) puts the moved pending sets back; a set already logged on the substitute stays (it's real); refused once a moved original set changed (rule 5).
  - Command: `swap_exercise {sessionExerciseId, expectedVersion, newSessionExerciseId, exercise, equipmentId, unit, loadConvention, sets[{newSetId, fromSetId, planned}]}`, built by `buildSwapExerciseCommand` (pure, `packages/domain`). Author is Ben; a coach swap still goes through an Apply card (CA2).

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
| Pain flagged (revised 2026-10-09) | Row tag `⚠ May hurt`; Swap header warning (EL6) | Never hidden |
| Adding a flagged exercise (2026-10-09) | Action sheet `<Exercise> may hurt` [Add anyway] [Choose another] (Pick one, Swap); inline line on tick (Pick several) | EL9. Nothing is added until `Add anyway` |
| Flag cleared while the picker is open | The tag disappears on the next search update | Local |
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

(2026-10-09, EL9) A `⚠ May hurt` row asks first in Pick one and Swap (§2.1): `Add anyway` adds or swaps (one extra tap, on flagged rows only); `Choose another` adds nothing. If a row is both not at this gym and flagged, one sheet asks both: `Overhead press may hurt, and Main Gym has no landmine. Add anyway?`. Voice "add overhead press" in a workout asks the same question in the voice strip ([Add anyway] [Cancel]); it never adds a flagged exercise without that answer.

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
| Added an exercise in a workout by mistake | While none of its sets are logged: exercise `⋯` → `Remove exercise` (no confirm, toast `Face pull removed` [Undo]). Built 11 Oct (`remove_exercise`, Undo by `undo_op`): the row stays as an audited record marked removed and leaves every view, the coach's view and the derived title. Not offered for an exercise with parts at another gym (skip it instead) |
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
| Row | `Last 100 kg × 8 · 6 Oct` · `Last at Hotel Gym: 60 kg × 10 · 12 Sep` · `No history` · `per side` · `Time` · `Busy today` · `Not at Main Gym` · `Custom` · `May hurt` (2026-10-09; was `Pain flagged`) · `Already in this workout` |
| May hurt (2026-10-09) | Confirm `Overhead press may hurt` / `Shoulder pain flagged 6 Oct.` (no area: `Pain flagged 6 Oct.`) [Add anyway] [Choose another] · combined `Overhead press may hurt, and Main Gym has no landmine. Add anyway?` · Pick several line `May hurt: you flagged shoulder pain on 6 Oct. Loads won't go up while the flag is on.` · VoiceOver tag "May hurt: you flagged shoulder pain on it." |
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
| `searchExercises(ownerId, query, filters)` | **Pure over the catalogue + aliases.** `filters = {gymId?, availableOnly, muscles[], movements[], equipmentKinds[], includeHidden}`. Returns rows `{exercise, matchedAlias?, availability: 'available' \| 'busy' \| 'not_at_gym' \| 'unknown', lastActual?, painFlag?: {flagId, area?, since}}` (2026-10-09: was the boolean `painFlagged`; the confirm needs the area and date) and `hiddenByGymCount`. `painFlag` is set only when an **active** flag covers that exercise. Ranking per EL1 |
| `listRecentExercises(ownerId, limit)` | Last used, newest first |
| `findSimilarExercises(ownerId, name)` | For the custom form's duplicate note |
| `createCustomExercise(input, opId)` / `updateCustomExercise(id, patch, expectedVersion)` | Validates convention vs equipment (table §2.6); rejects changes to locked fields with `field_locked` (EL3) |
| `addExerciseAlias(exerciseId, alias)` / `removeExerciseAlias` | Ben's own aliases; also used by the FitNotes import mapping |
| `hideExercise(id)` / `unhideExercise(id)` / `deleteCustomExercise(id)` | Delete only with no logged sets |
| Command `swap_exercise` with Undo by `undo_op` (built 11 Oct, see §2.5 "As built") | Moves **pending** sets only, bumps `session.version`. Ben-only for now; a coach swap is a proposal (CA2) |
| `getMovementPatterns()` / `getMuscleGroups()` | Fixed lists for filters and the custom form |

## 7. Acceptance checks

1. In a workout, `Add exercise` → typing `rdl` → tapping `Romanian deadlift` adds it and makes it active: **one tap after typing**, no extra confirmation.
2. Searching `RDL`, `rdl` or `romanain deadlift` (one typo) finds Romanian deadlift; the alias hit shows `Matches "RDL"`.
3. With `At Main Gym` on at a gym without a cable station, no cable exercise is listed and the hidden count line shows the right number; `Show ›` reveals them tagged `Not at Main Gym`.
4. Busy equipment is tagged `Busy today` and still selectable; pain-flagged exercises are tagged `May hurt` (revised 2026-10-09) and never hidden.
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
17. (2026-10-09, EL9) With a shoulder flag on Overhead press, its Pick one row shows `⚠ May hurt`; tapping it shows `Overhead press may hurt` with the flag's area and date. `Choose another` adds nothing and keeps the query; `Add anyway` adds it, and the workout card shows `⚠ Pain flag: no increases`. Unflagged exercises still add in one tap.
18. (2026-10-09) Lateral raise (a similar movement that Ben didn't flag) shows no `May hurt` tag and adds in one tap.
19. (2026-10-09) In Swap, a flagged substitute asks the same question before the swap applies; in Pick several, ticking a flagged row shows the inline line and no alert.
20. (2026-10-09) The confirm text never contains "safe", "unsafe", a condition name or a cause; it works with airplane mode on and no AI.

## 8. Guide (How to screen)

Revision 2026-10-09. This describes the screen **as built** for [ADR 0013](../decisions/0013-in-app-guide-playback.md) (`apps/mobile/src/screens/workout/HowToScreen.tsx`, `apps/mobile/src/guide/`). Nothing here has run on an iPhone yet; see [device-tests/guide-playback.md](../device-tests/guide-playback.md). Items marked **provisional, confirm on device** are the developer's own calls, which no spec had settled. §8.8 gives the designer's view on each. §8.9 lists changes proposed to what was built; none of them is built.

### 8.1 Purpose

**Question:** "What does this movement look like, and what should I watch for?"
**Primary action:** none to commit. The screen is read-only reference, and `Done` returns Ben to where he was. It never logs, swaps or changes anything, so it has no Undo.

Everything shown is **Coaching knowledge** (rule 10): the bundled catalogue entry and its guide. It reads nothing about Ben and writes nothing. It works offline and with no AI (rule 1).

### 8.2 Entry points

| From | Control | Shown when | Notes |
|---|---|---|---|
| Active workout, exercise `⋯` menu | `How to`, **first item** (provisional, confirm on device) | `howToKeyForExerciseId(exerciseId)` finds a guide or a rich entry | Built. Exercises without a how-to have no `How to` item at all; there is never a dead item |
| Exercise picker (Pick one) | `ⓘ` button at the row's trailing edge (provisional, confirm on device; §2.1 row rules) | `hasHowTo(catalogueKey)` | Built. A row tap still adds the exercise in one tap |
| Exercise detail (Browse) | `How to ›` row (§2.4) | `hasHowTo(catalogueKey)` | **Specified, not built** |

The guide is never shown inside a row, the Log card, the rest screen, Today, the Live Activity or a notification.

**Reach (review S2, 2026-10-09):** 10 guides are bundled, but only **nine** can be opened in the app. Sled push has no exercise row: it isn't a starter exercise, and its catalogue entry records distance, which sets can't log yet (`toExerciseRow` refuses it). So neither `ⓘ` nor `⋯ › How to` can reach it. Ben reviews all ten guides on the guide review web page instead. No extra catalogue browsing is built for this; sled push becomes reachable when distance sets or the Browse detail (§2.4) land.

Presentation: a full-height iOS modal (`presentation: 'modal'`, page sheet) over the screen it was opened from. Swiping down or tapping `Done` closes it. The workout underneath keeps running: the rest deadline, the layered rest alerts and any spoken cues behave exactly as they would without the modal.

### 8.3 Layout

Regions, top to bottom: fixed header (title, main muscles, `Done`) · scroll view: **player card** (`Draft guide` tag, square canvas, controls) · notice line (if any) · `Key positions` · `Setup` · `How to do it` · `Common mistakes`.

> **v2 changes this order** (exercise-guides-v2.md §2.1): header (title, `Done`; the muscles line moves) · player card (`Draft guide` tag + `⤢ Full screen`, canvas filling the card width, controls, `MuscleFocusLegend`) · **`What not to do`** card (replaces `Common mistakes`) · `Key positions` · `Setup` · `How to do it` · `Safety` (if P1 is approved). The wireframes below show v1 as built.

Animating (default):

```
┌────────────────────────────────────────┐
│ Back squat                    ✕ Done   │ header, bg.surface; type.title2
│ Main muscles: Quads · Glutes           │ type.callout, text.secondary
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │ Card
│ │ [Draft guide]                      │ │ Tag; until Ben approves the guide
│ │   ┌────────────────────────────┐   │ │
│ │   │                            │   │ │ ExerciseGuide canvas: square,
│ │   │     figure + bar + rack    │   │ │ 200–360pt, radius.md (scaled),
│ │   │     (neutral tones only,   │   │ │ guide colour aliases, no text
│ │   │      no text in the art)   │   │ │ in the art. One VoiceOver image
│ │   │                            │   │ │
│ │   └────────────────────────────┘   │ │
│ │ [ ❚❚ Pause      ] [ ▥ Key positions]│ │ SecondaryButtons, wrap at AX
│ └────────────────────────────────────┘ │
│ Key positions                          │ section header
│ 1 Start                                │ type.headline, tabular number
│ Stand tall, brace                      │ type.callout, text.secondary
│ 2 Bottom                               │
│ Hips just below knees, heels down      │
│ Setup                                  │
│ • Bar on upper back, not neck          │ type.body; bullet hidden from VO
│ • Feet about shoulder width            │
│ How to do it                           │
│ • Brace, then sit down between your    │
│   hips                                 │
│ • Knees track over toes                │
│ Common mistakes                        │
│ • Heels lifting                        │
│ • Chest collapsing at the bottom       │
└────────────────────────────────────────┘
```

After 3 reps (autoplay finished, holding the start position):

```
│ │   │   start position (first frame) │   │ │
│ │ [ ↺ Replay      ] [ ▥ Key positions]│ │
```

Key positions view (the default with Reduce Motion on, or after `Key positions`). A guide with no labelled key positions shows its first frame still with only `Play animation` (P6):

```
│ │ [Draft guide]                      │ │
│ │   ┌────────────────────────────┐   │ │
│ │   │   still: key position 1    │   │ │ the same frames as preview.png
│ │   └────────────────────────────┘   │ │
│ │ 1 of 2 · Start                     │ │ type.headline, tabular
│ │ Stand tall, brace                  │ │ caption, type.callout
│ │ [ ‹ Previous    ] [ Next ›        ]│ │ Previous disabled on 1, Next on last
│ │ ▷ Play animation                   │ │ text button, secondary tone
│ └────────────────────────────────────┘ │
```

No guide, rich cues only: there is no player card. `Key positions` is absent, and `Setup` / `How to do it` / `Common mistakes` follow the header directly.

Sizing: canvas = `min(360, screen width − 2 × screenMargin − 2 × space.4)`, never under 200pt. That is about 311pt on a 375pt phone. It is meant to be legible from about 240pt (device test G5). Control buttons use `flexBasis` 140 with wrap, so at large text sizes they stack one per line rather than truncate.

### 8.4 States

| State | Shows | Notes |
|---|---|---|
| Opening | The first frame (poster) is drawn at once. The rest of the frames are prepared in the background in short slices; the animation starts when they are all ready. `Pause` is shown from the start | No spinner or skeleton. Up to 4 prepared guides are cached per session, so reopening starts at once (G2) |
| Playing (autoplay) | The guide loops at its own tempo (each guide is 2–6 s per rep) | Stops after **3 passes**. One pass is one rep; for a ping-pong guide it is forwards and back, and for sled push it is one stride cycle. **Provisional, confirm on device** |
| Paused by Ben | Holds the current frame; the button reads `Play` | Survives scrolling away and back |
| Finished | Holds the **first frame** (the start position); the button reads `Replay` | `Replay` plays 3 more passes from the start |
| Off-screen | The clock stops and holds the current frame. This happens when the player is scrolled out of view, another screen covers How to, the app goes to the background or the phone locks | Resumes where it was when visible again. Battery during rest. This isn't Ben pausing, so the button still reads `Pause` |
| Reduce Motion on at open | Key positions view on `1 of n`; nothing moves | `Play animation` opts in (3 passes, then `Replay`) |
| Reduce Motion turned on while animating | Switches to the key positions view on `1 of n` at once | — |
| Reduce Motion turned off | No change. An animation never starts by itself | — |
| Key positions view (chosen) | As above; `Play animation` returns to animating from the first frame | — |
| Draft guide | `Draft guide` tag above the canvas | Shown while the guide's `review.status` is `draft` or `checked`; it disappears only at `approved`, which is set from Ben's own message |
| No guide, rich entry | Cues only, no notice | Honest: nothing pretends to be a guide |
| Guide unreadable, rich entry | Notice `The animated guide for Back squat couldn’t be read. The cues below still apply.` + cues | Validation is lazy; a broken file never crashes the screen |
| Guide unreadable, no cues / entry unreadable | Notice `Couldn’t read the how-to for Back squat.` | — |
| Nothing to show | `No how-to for Back squat yet.` | Normally unreachable: the entry points are hidden for these exercises |
| Offline / AI unavailable / coach offline | No change | Everything is bundled. No network, ever |
| Workout resting (opened mid-rest) | No change on this screen. The rest countdown keeps running underneath, and rest-end alerts (haptic, sound, spoken cue, notification) fire as usual | This screen shows no timer (see §8.9 P3) |
| Workout paused | No change | — |
| Light / dark switch | Recolours live from the neutral guide aliases | Never `accent`. v2 adds the muscle hue `guide.muscle` (exercise-guides-v2.md §8 lists the v2 states) |

Transitions:

```
open ─► (Reduce Motion?) ─no──► Playing ─3 passes─► Finished ─Replay─► Playing
            │                    │  ▲ └─Pause─► Paused ─Play─┘
            │                    │  └──── visible again ◄── Off-screen (auto)
            │                    └─Key positions / Reduce Motion on─► Key positions
            └─yes─► Key positions ─Previous/Next─► Key positions
                         └─Play animation─► Playing (from the first frame)
any ─Done / swipe down─► back to the workout or picker, unchanged
```

### 8.5 Interactions

- **Play control** (one button that changes label): `Pause` ↔ `Play`, or `Replay` after autoplay finishes. It is always shown while animating, so the moving content can always be stopped (WCAG 2.2.2).
- **`Key positions`** (shown only when the guide has labelled key positions) switches to the still view on position 1. **`Previous` / `Next`** step through positions; they are disabled, not hidden, at the ends. **`Play animation`** goes back to animating from the first frame.
- **Scroll:** the cues scroll under the fixed header. Once the player scrolls out of view it pauses itself.
- **Close:** `Done` (top right, `xmark` icon plus the word) or the system swipe-down. Ben returns to the exact workout state: same active set, same draft values, same Log label. From the picker he returns with his query and filters kept, and a row tap still adds in one tap.
- **No gestures on the canvas.** It isn't tappable, so a sweaty brush can't start, stop or scrub it.
- **Keyboard:** none. Opening How to from the picker covers the keyboard; it comes back with the picker.
- **Voice:** no voice equivalent in v1. The guide is **silent**: no speech, no sound, and it doesn't touch the audio session, so music and spoken set cues are unaffected. Asking the coach "how do I do a squat?" is a coach question, not a way to open this screen. The coach may quote the same cues, but must not claim to show the animation.
- **Undo:** nothing to undo. The screen changes no data.
- **Haptics:** none.

### 8.6 Copy (as built)

All text here is reference (Coaching knowledge). There are no loads, targets or actuals on this screen.

| Element | Text |
|---|---|
| Entry: workout `⋯` | `How to` |
| Entry: picker `ⓘ` (VoiceOver) | `How to do Back squat` |
| Entry: Exercise detail (not built) | `How to` with value `Guide` · `Guide · Draft` · `Cues` |
| Header | Exercise name · `Main muscles: Quads · Glutes` (muscle filter-group words) · `Done`. **v2:** the muscles line is replaced by `Feel it most:` / `Also works:` / `Not shown from this side:` in the player card, with plain names (exercise-guides-v2.md §5.3) |
| Tag | `Draft guide` |
| Play control | `Pause` (`pause.fill`) · `Play` (`play.fill`) · `Replay` (`arrow.counterclockwise`) |
| Still view | `Key positions` (`rectangle.split.3x1`; hint `Shows the key positions one at a time, without animation.`) · `1 of 3 · Start` + caption · `Previous` · `Next` · `Play animation` |
| Sections | `Key positions` (rows `1 Start` + caption) · `Setup` · `How to do it` · `Common mistakes`. **v2:** `Common mistakes` becomes the `What not to do` card under the player, with items rewritten as `Don't …` |
| Notices (`StatusLine`, `info.circle`) | `The animated guide for Back squat couldn’t be read. The cues below still apply.` · `Couldn’t read the how-to for Back squat.` · `No how-to for Back squat yet.` |
| VoiceOver: canvas (one image, fixed label, so it isn't re-announced while it moves) | `Exercise guide for Back squat. Side view. Bar on upper back. Squat down until hips are just below knees, then stand up.` (the guide's `a11y.summary`) |
| VoiceOver: still view | `Key position 1 of 3, Start. Stand tall, brace.` (also announced after `Previous`, `Next` and `Key positions`, since focus stays on the button) |
| VoiceOver: key position rows | `1, Start. Stand tall, brace.` |

No spoken cues. Captions and cues follow the catalogue copy rules: imperative, at most 60 characters, plain words.

### 8.7 Data needed

All pure, in `apps/mobile/src/guide/` and `@fizz/catalogue`. The screen never reads catalogue files itself.

- `bundledHowToSources()` → `{catalogue, guides}` (lazy: an entry or guide is validated only when first asked for).
- `buildHowToView({name, catalogueKey}, sources)` → `HowToView {title, muscles, guide: HowToGuide | null, setup, execution, mistakes, notice}`. `HowToGuide` carries `{loaded, draftLabel, accessibilityLabel, stops}`.
- `hasHowTo(catalogueKey, sources)` (picker and detail; cheap, reads only the `tier` hint) and `howToKeyForExerciseId(exerciseId, sources)` (workout `⋯`).
- `guideDraftLabel(review.status)`, `keyFrameStops(prepared)`.
- Player model: `initialPlayerState(reduceMotion, stepCount)`, `playerReducer`, `isRunning(state, {visible, appActive, framesReady})`, `playControlLabel`, `stepPosition`.
- Clock (UI-thread worklets): `advanceClock`, `frameIndexAt`, `MAX_AUTOPLAY_PASSES = 3`.
- Colours: `guideStyleFromTokens(theme)` with `GUIDE_PAINT_TOKENS` (design-system §2.3).
- Not called: no session, history, gym, coach or provider function. Opening How to doesn't read or write Your data.

### 8.8 Developer calls (provisional, confirm on device) and the designer's view

| Call | Built as | Designer's view |
|---|---|---|
| Autoplay stops after 3 reps | 3 passes, then hold the start position with `Replay` | **Agree.** Research §5.7 says the same, and it meets WCAG 2.2.2 with `Pause` always shown. At 2–6 s a rep, 3 reps is 6–18 s: enough to read the movement once and check one detail, and it stops before it becomes background motion while Ben rests. Confirm on device (G3) that 3 is enough. If Ben taps `Replay` most times, try 5. Don't make it loop forever |
| `ⓘ` button on picker rows | A separate 44 × 44 `info.circle` button; row tap still adds | **Agree.** It keeps one-tap add, which matters more than discoverability. It respects research §5.7's "never in rows or pickers", because the row opens the guide and never contains it. One condition: when the spec'd `🕘` history button is built, `ⓘ` sits left of `🕘` with `space.2` between them (§2.1 row rules), so each button's position stays stable |
| `How to` first in the `⋯` menu | First item when the exercise has a how-to; absent otherwise | **Agree.** The iOS action sheet is anchored to the bottom, so an item added at the top leaves `Add set`, `Skip exercise` and `Cancel` the same distance from the thumb on every exercise. Muscle memory holds whether or not an exercise has a guide. The top slot is also the farthest reach, which suits a rare, non-urgent action. active-workout.md §4.4 now lists it |
| `Stop if` and variations not shown | How to shows the guide, key positions, setup, execution and common mistakes only | **Variations: agree** to leave them out. A reference screen that can add or swap exercises would be a second, unreviewed path into the workout, and the Swap sheet (§2.5) already covers alternatives. **`Stop if` and safety notes: disagree.** I'd add them (P1 below). They are the most safety-relevant text in a rich entry, they are short, static and offline, and the catalogue rules already forbid naming conditions or diagnosing (rule 9) |

### 8.9 Proposed changes to what was built (not built; for Ben and the developer)

**Status 2026-10-09:** the PM approved P1, P2, P4, P5, P6 and P7 for Ben, and they are now **built** (§8.3–§8.6 updated for P2, P4 and P6 wording; not yet on a device). P3 is **deferred** until device feedback. Also built after review S1: if the player can't load or fails while drawing, How to drops it and shows `The animated guide couldn’t be shown. The cues below still apply.` above the cues; the workout underneath is unaffected.

| # | Change | Why |
|---|---|---|
| P1 | Add a **`Safety`** section after `Common mistakes`: `safety.notes` as bullets, then the line `Stop the set if:` followed by the `safety.stopIf` bullets. Plain text, no status colour (it's reference, not a status) | Same reasons as §8.8. A line like `Set safety arms just below your lowest depth` is practical setup help, and `Stop the set if: sharp or pinching pain` supports rule 9 without diagnosing. Show only text that already passed the catalogue copy rules |
| P2 | Use one word for one thing: rename the `Key frames` button to **`Key positions`**, and the still-view VoiceOver label to `Key position 1 of 3, Start.` | The section header and research both say "key positions". "Key frame" is animation jargon |
| P3 | When How to is opened from a workout that is **resting**, show one line under the muscles line: `Rest 1:12` (`type.callout`, tabular, computed once a second from the saved deadline, the same as the `ResumeBar`), then `Rest over` once it reaches zero. Nothing else changes | Rest is when Ben is most likely to read a guide. Without the countdown he has to close the screen to check it, and the logging loop comes first. Alerts already fire regardless. **Confirm on device** whether he misses it before building |
| P4 | Make the canvas VoiceOver label mode-neutral: `Exercise guide for Back squat. <summary>` | The fixed label says "Animated" even when it shows a still (Reduce Motion) |
| P5 | Show `Draft guide` (or `Draft` on the cue sections when there is no guide) whenever the **catalogue entry's** `review.status` isn't `approved`, not only the guide's | Cues are written by an agent and Ben approves them too. Today, unapproved cues appear with no label |
| P6 | Under Reduce Motion, a guide with **no** labelled key positions must not autoplay. Show the first frame still, with `Play animation` | Today, `initialPlayerState(reduceMotion, 0)` starts animating. `guide:check` makes such a guide unlikely, but the rule shouldn't depend on that |
| P7 | If the entry can't be read but the guide can, say `Couldn’t read the cues for Back squat. The guide above still applies.` | The current `Couldn’t read the how-to…` appears above a working guide, which reads as if nothing works |

### 8.10 Acceptance checks

1. In a workout, an exercise with a guide or rich cues shows `How to` as the **first** `⋯` item; an exercise without one has no `How to` item (G1, G9).
2. In the picker, `ⓘ` appears only on rows with a how-to, is 44 × 44, and opens How to; tapping the same row elsewhere adds the exercise in one tap (G1).
3. Closing How to (Done or swipe) returns to the identical workout state: same active set, draft values and Log label. Nothing was logged, changed or proposed.
4. The first frame is visible immediately on open; no spinner or shimmer (G2).
5. Autoplay stops after 3 reps on the start position with `Replay`; `Pause`/`Play` works before that (G3).
6. The animation stops when scrolled out of view, when the app is backgrounded and when the phone is locked; it resumes when visible again. The rest alert still arrives on time (G4).
7. With Reduce Motion on, nothing moves on open; `1 of n · <label>` and its caption show; `Previous`/`Next` step; `Play animation` plays only when tapped. Turning Reduce Motion on mid-play stops it at once (G7).
8. VoiceOver reads the canvas once as one image with the guide's summary, and isn't re-announced while it moves; key positions and every cue section are reachable by swiping (G8).
9. No pixel of the guide uses `accent` or any status colour, and there's no text in the art, in both looks and both schemes (G6; covered by a unit test on `GUIDE_PAINT_TOKENS`). **v2:** the only non-neutral paint allowed is `guide.muscle`, on muscle regions (exercise-guides-v2.md §12, check 4).
10. `Draft guide` shows for every guide whose `review.status` isn't `approved`.
11. A corrupted `guide.json` shows the notice and the cues, and the app doesn't crash; a corrupted entry shows `Couldn’t read the how-to for …`.
12. In Airplane mode with no AI configured, How to and the animation work fully (G10).
13. At AX3 on a 375pt phone, the control buttons stack without truncation, and the canvas stays at least 200pt.
14. The guide never appears in a row, the Log card, the rest screen, Today, the Live Activity or a notification, and plays no sound.

### 8.11 Guides v2 (specified 9 Oct 2026, not built)

Full spec: [exercise-guides-v2.md](exercise-guides-v2.md). It comes from Ben's review of the 10 guides. What changes on How to:

| Area | v1 (built) | v2 |
|---|---|---|
| Figure | Capsule limbs, circle head, flat neutral fill | Anatomical silhouette from per-segment profiles (deltoid cap, chest, upper back, glutes, thigh and calf shape, forearm taper), shaped hands and shoe-like feet, soft shading and a few contour lines at sizes ≥ 160pt. Still original, with no face and no text (v2 §3) |
| Muscles | Text only, in the header (`Main muscles: Quads · Glutes`) | Regions on the figure in one violet hue, `guide.muscle`: strong = `primaryMuscles`, soft = `secondaryMuscles`. Optional subtle emphasis during the loaded phase, never under Reduce Motion. **The neutral-only exception is per Ben's request of 9 Oct 2026.** Text in the player card: `Feel it most:` / `Also works:` / `Not shown from this side:` with plain names (v2 §4, §5.3) |
| Faults | `Common mistakes`, last section | `What not to do` card directly under the player. Catalogue `cues.faults` rewritten as `Don't …` (exercise-researcher) (v2 §5) |
| Size | Canvas 200–360pt with card padding | Canvas fills the card (to 400pt), plus a `Full screen` view with a portrait canvas (v2 §2.2) |
| Rendering | 1× review sheet, polygon outlines | 3× review sheet and thumbnail sheet, smooth Bézier outlines, stroke floors, two detail tiers (v2 §7) |
| Entry points, motion rules, offline, silence | — | Unchanged |

Proposals in §8.9 still stand. P2 (`Key positions` button name) and P4 (mode-neutral VoiceOver label) are used in the v2 copy. P1 (`Safety`) moves to after `How to do it`, because `Common mistakes` no longer closes the screen.

## Proposed design-system additions

No new colours or timing tokens for the library itself. (Guides v2 adds `color.guide.muscle`, `color.guide.shade`, `guide.musclePulse`, the §4.2 guide dimensions and `MuscleFocusLegend` / `AvoidList` / `GuideFullScreen` in design-system.md.)

| Component | Spec |
|---|---|
| `SearchField` | 52pt tall, `bg.raised`, 1pt `border.control`, `radius.sm`; `magnifyingglass` icon, `type.body` text, `xmark.circle.fill` clear (44 × 44 hit), optional `mic` button (44 × 44) on the right, separated by `space.2`. Hides the mic when `DEP-STT` is unavailable |
| `FilterChip` | `ParamChip` (§9.17) plus a trailing `chevron.down` and, when active, the choice text (`Movement: Vertical pull`). A toggle chip (`At Main Gym`) uses the `checkmark` selected state |
| `ExerciseRow` | 52pt min, `bg.surface`, padding `space.3`. Line 1 `type.headline`; lines 2–3 `type.callout` `text.secondary`, numbers tabular. Optional leading checkbox (Pick several). Trailing history button 44 × 44 (`clock.arrow.circlepath`). Stacks at AX1+ |
| `AvailabilityTag` | Inline icon + word, `type.label`: `⚠ Busy today` / `⚠ May hurt` (2026-10-09, was `⚠ Pain flagged`; `status.warning`), `⊘ Not at Main Gym` (`slash.circle`, `text.secondary`), `Custom` (`text.secondary`). Never colour alone. **To merge into design-system.md §9.28** when its current edit lands (active-workout.md §9) |
| `SubstituteRow` | `ExerciseRow` plus up to 2 reason lines (`checkmark` icon, `text.primary`) and 1 difference line (`notequal` icon, `text.secondary`), `type.callout`; `More ›` when there are more |
| `SwapSlotLine` | Collapsed swap result in the coach slot: `checkmark.circle.fill` (`status.done`) + line 1 `type.headline`, line 2 targets (`type.callout`), row `Change … too ›` (left, `accent`) and `Undo` (right) with `target.workout` hit areas ≥ `space.8` apart. Same frame as `CoachAdjustmentBanner` without the coach icon |

## Cross-links

- [active-workout.md](active-workout.md) §2.10, §4.4: `Add exercise`, `Swap exercise`, `Machine busy` (EL4 proposes changing the swap step), `How to` (§8)
- [ADR 0013](../decisions/0013-in-app-guide-playback.md), [device-tests/guide-playback.md](../device-tests/guide-playback.md), [research/exercise-bank-and-visuals.md](../research/exercise-bank-and-visuals.md) §5.5–5.7: guide playback, the device test and the guide rules
- [design-system.md](design-system.md) principle 5, §2.3, §9.57: guide motion exception, colours and `ExerciseGuide`; §4.2, §9.58–9.60 for guides v2
- [exercise-guides-v2.md](exercise-guides-v2.md): detailed figure, muscle focus, `What not to do`, Full screen
- [coach-adjustments.md](coach-adjustments.md) CA2: coach-initiated swaps keep the Apply card
- [routines.md](routines.md): `＋ Add exercise`, `Replace`, `Swap ›`, Plan hub 🔍
- [change-review.md](change-review.md): `Change Push A too ›` and coach swap proposals
- [workout-builder.md](workout-builder.md) WB4: the builder uses the same `rankSubstitutions` same-movement rule
- [today.md](today.md): gym switcher (equipment context for `At <gym>`)
- `docs/training-guides/concurrent-training.md` C7: sled convention note (EL7)
