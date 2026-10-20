# Workout builder v3 (Set up → Your workout, plan-day templates, variations, coach review)

Status: **Proposed (20 Oct 2026) — pending Ben's approval**

Source: Ben's iteration of the prototype [`prototypes/workout-builder-v3.html`](prototypes/workout-builder-v3.html) on 20 Oct, and his decisions that day. Tags used throughout:

- **[Ben]** = Ben's decision, 20 Oct 2026 (approved direction; quoted where useful).
- **[Proposal]** = designer proposal, not yet approved. Ben decides (see §9).
- **[Proto]** = what the prototype does, carried over as a proposal unless also tagged [Ben].

Rules: CLAUDE.md 1–10 and the minimal-copy convention. Tokens: [design-system.md](design-system.md). Code to reuse: `packages/schemas` (`routine.ts`, `workout-draft.ts`, `plan-draft.ts`, `training-profile.ts`), `packages/domain` (`builder-loads.ts`, `session/snap.ts`, `fit-time.ts`, `duration.ts`, `pain-flags.ts`, `training-profile.ts`), `packages/coach` (`build.ts`, `plan.ts`, `edit-today.ts`), `packages/persistence` (`workout-drafts.ts`, `plan-drafts.ts`, routines in `documents.ts`).

The builder sits **outside the logging loop**. Nothing here adds steps to Active set, Rest or Summary.

---

## 1. Purpose and how it fits

**Question:** "What am I training today, in what order, at what weights, and does it fit my time?" **Primary action:** `Start`.

### 1.1 The chain [Ben]

> Ben: "this should all still be buildable from the coach as part of the long-term plan goal etc, which gets tracked and separately reviewed and progress seen."

```
Goal (Profile) → Plan (days, order, rotation; later blocks, H4)
  → Plan days = fixed TEMPLATES in the builder's full format,
    one per day + main lift, each with optional saved VARIATIONS
  → Today: Up next opens the next plan day in the builder, loads from history
  → Logging → Reviews (session now; weekly / block / goal later)
  → One goal-progress view (later, §6)
```

### 1.2 What changes and what stays [Ben]

> Ben: "i wouldn't imagine chest sessions should change much week on week, it's more about rotating."

| Week to week | Rotates | Stays |
|---|---|---|
| Numbers only: loads, reps, sets from progression; deloads (in blocks, H4) | Plan days (adaptive Up next, CHANGELOG 20 Oct); accessory variety per block (4–8 weeks) as **coach suggestions Ben approves** | Main lifts (so progress is measurable); each plan day's structure until Ben changes it |

### 1.3 Templates per main lift, with variations [Ben]

- A plan day is saved **per main lift**: `Chest · bench` and `Chest · incline` are separate templates (Ben: "have them saved depending on what the main lift is").
- Each template can have saved **variations**, e.g. `Chest · bench · arms superset`, `Chest · bench · abs superset` (Ben: "also have variations saved, such as including arm supersets or abs superset, so it doesn't lose stuff and have to redo unnecessarily"). Picked on Set up.
- **`Save as default` is removed.** Edits are **today only** by default. On Start after edits, one prompt: `Today only` / `Update <Day> (<main lift>) in your plan` / `Save as new variation` (§2.7). This is rule 2's scope choice.

---

## 2. Screens

Two pages in one full-screen modal: **1 Set up** and **2 Your workout**, plus sheets. iPhone width 390 pt.

### 2.1 Entry points

| From | Opens | Tag |
|---|---|---|
| Today, Up next (plan in use) | Page 2 for the next plan day's template, loads from history | [Ben] |
| Today, `Change` → another plan day | Page 2 for that day | [Proposal] |
| Today, `Build a workout` / no plan | Page 1, Day = Up next's split day | [Proposal] |
| Coach chat "build me a push workout" | Page 1 filled from the words (§2.6) | [Proposal] |
| Resume, P6 auto-open | **Never** the builder (unchanged) | — |

[Proposal] Page 2 becomes the single pre-workout page for plan days, replacing the Workout overview there (one pre-workout page, as OV decided). The overview's gym chip and check-in move to page 2 (§9 Q2). Today keeps a one-tap `Start` on the Up next card that starts the template unchanged, so the builder is never an extra step (§9 Q1).

### 2.2 Page 1, Set up [Ben]

```
┌──────────────────────────────────────────┐
│                                  1 of 2  │
│ Set up                                   │
│ ┌──────────────────────────────┐ ┌────┐  │
│ │ ✦ Describe the workout       │ │ 🎙 │  │
│ └──────────────────────────────┘ └────┘  │
│ ┌──────────────────────────────────────┐ │
│ │ Day                      Chest     › │ │
│ │ Main lift          Bench press     › │ │
│ │ Variation             Standard     › │ │  [Proposal] only if variations exist
│ │ Length             [−] 60 min [+]    │ │
│ │ Supersets                     [ ●]   │ │
│ └──────────────────────────────────────┘ │
│ MUSCLE GROUPS              Recommended   │
│ ┌──────────────────────────────────────┐ │
│ │ Chest        [−] 4 exercises [+]     │ │
│ │ Triceps      [−] 1 exercise  [+]     │ │
│ │ Abs          [−] 1 exercise  [+]     │ │
│ │ ＋ Add muscle group                   │ │
│ ├──────────────────────────────────────┤ │
│ │ Total                    6 exercises │ │
│ │ Recommended for 60 min with sup… 7   │ │  only when Total ≠ recommended
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │          Next: exercises             │ │  primary, above home indicator
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

| Row | Behaviour | Tag |
|---|---|---|
| Day | Sheet: `Your split` (Profile split days) first, then `Push / Pull / Legs`, then `Custom` (`Start with no muscle groups`). Each option shows its parts (`Chest, triceps`) | [Ben] |
| Main lift | Sheet: the day's main lifts (first is `From Profile`), plus `None`. Custom: compounds of the chosen groups + `None`. The main lift counts as one of its own group's exercises | [Ben] |
| Variation | Sheet: `Standard` + saved variations of this day + main lift. Picking one loads that template on page 2 | [Proposal] (placement; picking on Set up is [Ben]) |
| Length | Any minute, ±1 per tap; hold repeats. Bounds 15–180 (`TRAINING_LIMITS`; the prototype allowed 10) | [Ben] ±1, [Proposal] bounds |
| Supersets | Switch; on = the builder pairs (§3.5) | [Ben] |
| Muscle groups | Recommended for day + length + supersets; ± per group; `＋ Add muscle group`; `Use recommended` link replaces the `Recommended` tag once edited. Legs is one group; rear delts belong to Back. Max 4 exercises per group (excess spills to the other groups); recommendation max 7 | [Ben] |
| Next: exercises | Builds page 2 (or returns to it, §2.3 State "back") | [Ben] |

States: **normal**; **custom, empty** (`Next: exercises` shows toast `Add a muscle group`); **template loaded** (fields reflect the template; groups read from its exercises) [Proposal]; **offline / AI unavailable** (bar still opens chat, see §2.6).

### 2.3 Page 2, Your workout [Ben]

```
┌──────────────────────────────────────────┐
│ ‹ Set up                         2 of 2  │
│ Chest · about 58 min                     │
│ Supersets save about 6 min               │  [Proto]
│ FROM LAST REVIEW                         │
│ │ Bench: 8 reps on top set → 102.5  ✕ │  │
│     Exercise              Sets  Top set  │
│                                   (kg)   │
│  1  Bench press  MAIN     4     100      │
│     Chest, front delts…   +4 W           │
│  2  Incline DB press      3      30      │
│     Upper chest, front…   +1 W   each    │
│ ┌─────────────────────────────────────┐  │
│ │3a Cable fly             3      20   │  │  superset box,
│ │ │  Chest                            │  │  connecting line a→b
│ │3b Cable crunch          3      45   │  │
│ │    Upper abs                        │  │
│ └─────────────────────────────────────┘  │
│  4  Triceps pushdown      3      35      │
│  ＋ Add exercise                          │
│ ┌──────────────────────────────┐ ┌────┐  │
│ │ ✦ Ask the coach to change it │ │ 🎙 │  │
│ └──────────────────────────────┘ └────┘  │
│ [          Start          ] Coach review │
└──────────────────────────────────────────┘
```

- Title `<Day> · about N min` (code estimate, §3.6). Numbered rounds 1, 2, 3; a superset is one box with `a, b, c` and a connecting line. Columns `Exercise | Sets | Top set (kg)`; the unit appears once, in the header (`lb` when Ben's unit is lb). `+N W` under Sets counts warm-ups. Per-dumbbell loads show `each`; bodyweight `BW` or `BW+10`; no history `—` [Ben].
- Each exercise has a `works` line (`Chest, front delts, triceps`) [Ben].
- `Top set` is a **target**, never an actual. Loads are tabular numerals.
- `Start` is disabled when empty [Ben]. Start and Coach review sit in the bottom action bar, always visible.

| Gesture | Result | Accessible alternative |
|---|---|---|
| Tap row | Exercise pop-up (§2.4) | Same (VoiceOver activate) |
| Press and hold (~320 ms, light haptic), then drag | Drop on a block's top/bottom edge (outer 30%) = move there; drop on the middle of a row = superset with it | Pop-up `Move up` / `Move down` / `Superset with next` / `Unlink`; VoiceOver custom actions with the same names |
| Swipe left | Reveals `Delete` → tap = remove, toast `Removed Cable fly · Undo` | Custom action `Delete`; pop-up `Remove` |
| Swipe right | Reveals `Swap` → Swap pop-up (§2.5) | Custom action `Swap`; pop-up `Swap exercise` |

**Drag vs scroll** (review finding): a finger that moves > 8 pt before the hold fires is a scroll (vertical) or a swipe (horizontal); only a still hold arms drag. While armed, the list doesn't scroll; dragging near the top/bottom edge auto-scrolls [Proposal]. The main lift can't join a superset, and a superset holds at most 4 (`BUILD_LIMITS.maxSuperset`); an invalid drop does nothing and the row springs back [Proto + limit].

**After any of Ben's own changes** (drag, swipe, pop-up, chat apply): code runs the advice rules (§3.8). If the change created a new "not recommended" case, the toast says so: `Not recommended: both work your lats · Undo`; `Why?` expands the one-line reason. His change stays [Ben].

**Back to Set up** keeps page-2 edits. If the set-up changed, `Next: exercises` rebuilds and shows `Rebuilt for the new set-up · Undo`; Undo restores **both** the previous set-up and the previous page 2 [Ben, Undo scope Proposal]. [Proposal, review finding "rebuild wipes edits"]: a **length-only** change trims or extends sets with the fit (`fitPlanToMinutes`) instead of rebuilding; a **group count** change adds or removes only that group's exercises, keeping every other edit (§9 Q4).

States: **normal**; **empty** (all removed: list shows `＋ Add exercise`, Start disabled); **from template** (no rebuild on entry); **load unknown** (`—`, pop-up shows `Start light`); **pain-flagged exercise** (existing `May hurt` tag; progression held, rule 9); **not at this gym** (builder never picks it; a template slot falls back to its same-pattern substitute with a check note, BD9); **offline / AI unavailable** (§2.6).

### 2.4 Exercise pop-up (sheet, large detent) [Ben]

```
┌──────────────────────────────────────────┐
│ Bench press                Swap exercise │
│ Chest, front delts, triceps              │
│ ┌──────────────────────────────────────┐ │
│ │ #  Type        Reps   Kg     RPE     │ │
│ │ W  Warm-up      10    20      –      │ │
│ │ W  Warm-up       5    50      –      │ │
│ │ W  Warm-up       3    70      –      │ │
│ │ W  Warm-up       1    85      –      │ │
│ │ 1  Top set       6   100      8      │ │
│ │ 2  Back-off      8    95      8      │ │
│ │ 3  Back-off      8    95      8      │ │
│ │ 4  Back-off      8    95      8      │ │
│ │ ＋ Warm-up                    ＋ Set  │ │
│ └──────────────────────────────────────┘ │
│ REST                                     │
│ │ Warm-ups        [−] 1:00 [+]        │  │
│ │ Top set         [−] 3:30 [+]        │  │
│ │ Back-offs       [−] 3:00 [+]        │  │
│ [↑ Move up] [↓ Move down] [Superset w…]  │
│ Why this weight? ›                       │
│ [            Done            ]  Remove   │
└──────────────────────────────────────────┘
```

- Per-set table `# | Type | Reps | Kg | RPE` (RPE = **target**). Type menu: `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop`. One Top set per exercise: choosing Top set elsewhere turns the old one into a Back-off. A type change recalculates that set (§3.1) [Ben].
- Swipe left on a set → `Delete`, toast `Set deleted · Undo`; at least one working set stays (`Keep at least one set`) [Ben]. VoiceOver: custom action `Delete set`.
- `＋ Warm-up` fills the biggest gap in the ramp (disabled at 4, `BUILD_LIMITS.maxWarmups`); `＋ Set` copies the last working set (disabled at 10).
- Rest per set type, 15 s steps (§3.2). In a superset, one row: `After each round`.
- `Move up` / `Move down` / `Superset with next` (only when the next block isn't the main lift) / `Unlink` (in a superset) [Ben].
- `Why this weight?` (collapsed) → `Est. 1RM 127 kg (estimate) · 6 reps @ RPE 8 → 100 kg`, plus `Typed by you` when Ben typed kg. Numbers come from code only.
- Editing: reps or RPE recalculates kg unless Ben typed kg in that set [Ben]. A typed kg is snapped to the nearest achievable load on blur; if it moved, the cell shows the snapped value and `Why?` says the item (rule 4) [Proposal].

### 2.5 Swap / Add exercise (sheet) [Ben]

```
│ Swap Cable fly                           │
│ Muscle group                  Chest  ⌄   │
│ UPPER CHEST                              │
│ │ Incline barbell press                │ │
│ │ Upper chest, front delts, triceps    │ │
│ MID CHEST                                │
│ │ Machine chest press  May hurt        │ │
│ │ Chest, triceps                       │ │
│ [Back]                                   │
```

- Group dropdown defaults to the exercise's group (Add: today's first group). Exercises are grouped by focus (`Upper chest`/`Mid chest`; `Lats`/`Mid-back`/`Rear delts`; `Quads`/`Hamstrings & glutes`/`Calves`; …) with the `works` line. **No est. 1RM** shown [Ben].
- Only exercises usable at the selected gym (`doableHere`); ones already in the workout are hidden; pain-flagged ones show `May hurt` and confirm with `mayHurtConfirm` [Proposal: reuse].
- Swap keeps the slot's position, superset, set count and set types; loads recalculate. Toast `Swapped · Undo`. Add appends a 3-set slot; disabled at 10 exercises (`BUILD_LIMITS.maxExercises`).
- [Proposal] A search field at the top (the prototype had one in an earlier pass).

### 2.6 Coach chat and voice [Ben]

- A bar on both pages: page 1 `Describe the workout`, page 2 `Ask the coach to change it`, with a mic button that **starts listening straight away** (on-device speech; `expo-speech-recognition`, installed, so far used only in the probe). The chat opens as a sheet over the page, not full screen.
- **Page 1:** a message fills the set-up and **applies at once**, toast `Pull · 50 min · supersets on · Undo` [Ben].
- **Page 2:** a message returns a **proposal**: before/after lines (`Cable fly → Incline barbell press`, `Length 60 → 45 min`, `Bench press: 100 → 102.5 kg`), `Apply` / `Skip`; after Apply, `Applied · Undo`. If the workout changed since, Apply shows `Out of date. Ask again.` and changes nothing (rule 5) [Ben].
- If the coach's own proposal breaks an advice rule, the line carries `⚠` and the reason; if Ben's own change does, see §2.3 [Ben].
- Chat header status: `● Coach` (connected), `Offline`, `Coach not connected` (ai-connection.md words). Never a canned reply (rule 1).

| State | Page 1 bar | Page 2 bar |
|---|---|---|
| Connected | Fills set-up | Proposals |
| Offline / not connected | [Proposal] code reads simple words only (day, minutes, supersets on/off, add/no group), chat header `Offline`; anything else: `Offline. Set it up below.` (§9 Q6) | Bar shows `Offline`, disabled; every manual edit still works |
| Listening | Mic filled, field `Listening…`, live words; stops on silence or tap | same |
| Mic or speech permission denied | Mic shows `⊘`; tap → system Settings link | same |

### 2.7 Keyboard [Ben]

- The field being typed is never hidden: it scrolls to sit above the keyboard and the keyboard bar.
- Keyboard bar (iOS input accessory): `Done` always; for set cells also `−` `+` `Next`. Steps: reps 1, RPE 0.5, kg = the gym's next achievable step for that item (not a fixed 2.5) [Proposal for kg step]. `Next` moves Reps → Kg → RPE → next set.
- Tapping outside a field dismisses the keyboard. Primary actions stay visible above it (the sheet's `Done`).

### 2.8 Start scope prompt (sheet, medium detent) [Ben]

Shown on `Start` only when today's workout differs from the plan day template it came from [Ben], and (Proposal) only for structure changes: exercises, order, supersets, sets, reps, set types or rest. Load-only edits don't prompt (loads come from history every week).

```
│ Keep these changes?                      │
│ │ Cable fly → Incline barbell press    │ │
│ │ Add Hammer curl                      │ │
│ │ Triceps pushdown: 3 → 4 sets         │ │
│ [           Today only            ]      │
│   Update Chest (bench) in your plan      │
│   Save as new variation                  │
│   Cancel                                 │
```

- `Today only` (primary): starts; the template is unchanged.
- `Update Chest (bench) in your plan` (on a variation: `Update Chest (bench) · arms superset`): writes the template (versioned, opId), then starts. No toast on the first set (no interruption); Summary shows `Chest (bench) updated · Undo` [Proposal: where Undo lives].
- `Save as new variation`: a name field, prefilled from the change (`arms superset`), `Save and start`. Max 5 variations per template [Proposal].
- If the template changed since the builder loaded it, the update is refused: `Your plan changed. Today only?` (rule 5).
- Not a plan day: no prompt [Proto]; [Proposal] Start offers nothing; `Save to Workouts` stays in `⋯`.

### 2.9 Coach review (sheet) [Ben]

```
│ Coach review                   ● Coach   │
│ Balanced and varied                      │  verdict (AI)
│ ✓ Upper chest 6 ✓ Mid chest 7 ✓ Triceps 4│  code counts
│ · Abs                                    │
│ 2 compound · 4 isolation · free weights… │
│ PLAN · 4-day split · since 13 Oct        │
│ ✓ Chest is next (day 1 of 4)             │
│ ✓ 60 min (plan 60)                       │
│ ✓ Main lift Bench press                  │
│ ! 5 of 6 planned · missing Cable crunch  │
│ ✓ 16 working sets (plan 17)              │
│ │ Add back Cable crunch   [Add] [Skip] │ │
│ │ Update plan day   [Update plan][Skip]│ │
│ SUGGESTED                                │
│ │ Swap Cable fly for Incline barbell…  │ │
│ │ 3 exercises lead with mid chest      │ │
│ │                     [Swap]  [Skip]   │ │
│ FOR NEXT CHEST DAY                       │
│ ☑ Bench: 8 reps on top set → 102.5 kg    │
│ ☑ Include abs                            │
│ [            Done            ]           │
```

- Verdict line; per-core-muscle ticks with **set counts** (✓ trained, · missing; icon + text, not colour alone); variety line; Plan section (day next?, length, main lift, planned exercises kept/missing/added, working sets vs plan) with `Add back X` and `Update plan day`; suggestions with Apply (each one a proposal, Undo after); `For next <day> day` notes ticked by default, saved on `Done` [Ben].
- Saved notes show at the top of that day's page 2 next time as `From last review`, each with ✕ to dismiss [Ben]. They are **Your data** (personal memories, rule 10).
- **Real review = AI writes the verdict, suggestions and notes; code computes and checks every fact** (counts, plan lines, numbers in text) [Ben]. Offline / not connected: header `Offline` or `Coach not connected`; code facts (ticks, counts, variety, Plan section and its `Add back`) still show; no verdict, no AI suggestions, no notes [Proposal, rule 1].
- `Update plan day` here = the same write as §2.8's update (versioned, Undo toast).

---

## 3. Rules (all pure domain code, unit-tested)

### 3.1 Loads [Ben]

- Every set's load = `expectedLoad(e1rm, reps, targetRpe)` (existing: Epley with RIR = 10 − RPE), where `e1rm = referenceE1rm(...)` from Ben's own recent sets (existing `loadReferences`: 180-day window, return-after-gap cut, personal ratios, then related lifts; labelled est.).
- **Rounded down to achievable** at the selected gym via `snapPlanToGym` (mode `start`, toward easier, `loadDirection()`): real plates and bar, dumbbell rack, stack steps, min/max (rule 4). Never above a machine's max. The prototype's 2.5 kg rounding is a stand-in.
- One Top set. Back-offs at their own reps at RPE 8 (bench est. 1RM 127: top 6 @ 8 → 100; back-offs 8 @ 8 → 95). Working sets: the slot's lower rep bound at RPE 8, last working set target RPE 9 at the same load [Proto].
- Drop set: reps = top of range + 2, RPE 9, load = previous working set × 0.78, rounded down [Proto].
- Editing reps or RPE recalculates kg unless Ben typed kg in that set; a type change recalculates [Ben].
- No reference: `—`, `Why this weight?` → `No history yet · start light` (existing first-time ceiling `noReferenceCeiling` may give a bound) [Proposal]. Pain-flagged movement: no harder than the most recent comparable working load (BD10, rule 9).
- Est. 1RM appears only behind `Why this weight?`, always `(estimate)` (rule 6).
- Defaults [Proto]: main lift 4 sets (1 top 6 reps + 3 back-offs 8 reps); others 3 sets × 8–12.

### 3.2 Rest defaults [Ben]

| Set type | Default |
|---|---|
| Warm-up | 1:00 |
| Top set | 3:30 |
| Back-off | 3:00 |
| Working, main lift | 3:00 |
| Working, compound accessory | 2:00 |
| Working, isolation | 1:30 |
| Drop | 0:15 |
| Superset, after each round | 1:30 |

Steps of 15 s. Limits: §4.4.

### 3.3 Warm-ups [Ben]

- Main lift: bar × 10 (barbells only, the gym's bar), then 50 % × 5, 70 % × 3, 85 % × 1 of the top-set load; a step not heavier than the previous is skipped. Max 4.
- Compound accessory: 1 warm-up, 60 % × 8 [Proto %]. Isolation: none.
- Warm-ups snap to the nearest achievable load (not forced down) [Proposal].

### 3.4 Order [Ben]

Main lift first → compounds (on leg days alternate quad and hinge) → isolations → abs last.

### 3.5 Pairing (Supersets on) [Ben]

Never pair: the main lift [Proto]; two heavy lifts; abs with a heavy lift; two exercises sharing a muscle. Abs pair with the last fitting accessory first, then remaining singles pair in order. Leg parts (quads, hamstrings/glutes, calves) count as different parts for pairing but one group for counts.

`heavy` [Proposal]: a catalogue flag set by exercise-researcher (prototype list: squat, leg press, RDL, hip thrust, Bulgarian split squat, barbell row, incline barbell press); fallback = compound on a barbell or plate-loaded machine.

### 3.6 Time estimate [Ben]

`2 min setup + Σ blocks + 1 min between blocks`, where a solo exercise = warm-ups (each 30 s + 1 min rest, then +1 min after the last) + each set (45 s + its rest), and a superset = its warm-ups + max sets × (n × 45 s + (n − 1) × 15 s switch + round rest) [15 s switch: Proto]. Shown rounded as `about N min`. [Proposal] One estimator (`estimateBuilderMinutes`) replaces the overview's pre-start estimate for builder workouts; `fitPlanToMinutes` uses the same constants.

### 3.7 Volume and recommendations [Ben]

- Recommended count = the most exercises (max 7) whose estimate fits the length, with Supersets as set (3 sets each, main 4). The day's mix is scaled to that count (largest remainder; the first group keeps at least one); cap 4 per group, excess to other groups. If still over, accessory sets drop to 2, last first.
- Day mixes [Proto]: Chest = Chest 4, Triceps 1, Abs 1; Back/Pull = Back 4, Biceps 1, Abs 1; Legs = Legs 5, Abs 1; Shoulders = Shoulders 4, Triceps 1, Abs 1; Push = Chest 3, Shoulders 2, Triceps 1, Abs 1.
- Exercise picks per group come from Ben's history first, then the catalogue, usable at this gym, not pain-flagged [Proposal; the prototype uses a fixed pool].

### 3.8 Advice ("not recommended because…") [Ben]

Code rules, each with a one-line reason and a fix:

| Case | Reason line | Fix |
|---|---|---|
| Isolation before a compound for the same muscle | `It tires your chest before the heavier lift.` | `Move <compound> first` |
| Superset of two heavy lifts | `Two heavy lifts back to back: both get weaker and form slips.` | `Unlink <b>` |
| Abs with a heavy lift | `Ab work between sets tires the bracing that protects your lower back.` | `Unlink` |
| Superset sharing a muscle | `Both work your lats, so the second one suffers.` | `Unlink` |

Advice never blocks or reverts Ben's change (Ben paired the same exercise mid-workout on purpose, ADR 0028).

---

## 4. Data model

### 4.1 Reused

| Need | Existing |
|---|---|
| Per-set type, reps, target RPE, rest | `SetTemplateSchema` (`setType` incl. `top`/`backoff`/`drop`, `targetRpe`, `restOverrideS`), `RoutineExercise.restBySetType`, `supersetGroup`, `main` |
| Plan day as a saved workout | `Routine` with `createdFromPlan` (`RoutinePlanLink`); plan apply/undo/pause in `PlanDraft` |
| Today's working copy | `WorkoutDraft` (versioned, opIds, 14-day expiry, `startWorkoutDraftIn`) |
| Loads | `referenceE1rm`, `expectedLoad`, `loadReferences`, `checkProposedLoad`, `recheckDraftLoad`, `snapPlanToGym` |
| Main lift per day | `SplitDay.mainLiftExerciseId`, `TrainingProfile.mainLifts`, `mainLiftOptions` |
| Pain | `painFlagCovering`, `mayHurtConfirm` |
| Notes | `MemorySchema` (Your data) |

### 4.2 New or changed [Proposal]

| Item | Change |
|---|---|
| **Plan-day template key** | `Routine.planDay?: { planId, splitDayId, mainLiftExerciseId: Id \| null, variation: { label: string(1–40) } \| null }`. Unique per (planId, splitDayId, mainLift, variation label). `Chest · bench` and `Chest · incline` are two routines; a variation is a full routine (not a diff), so nothing is lost when the base changes |
| **Variation limit** | ≤ 5 per (day, main lift) |
| **Templates store structure, not loads** | `targetLoad: null` (Auto) per set; loads computed at open. Ben's typed kg are today only (§9 Q8) |
| **Superset round rest** | `RoutineExercise.roundRestS?: DurationSeconds` and the same on `DraftSlot`; code keeps it equal across a group |
| **Rest by set type on drafts** | `DraftSlot.restBySetType` (as `RoutineExercise`) |
| **Manual-origin drafts** | `BuildRequestOriginSchema` + `'builder'`; `WorkoutDraftVersion.request.setup?: { dayId, minutes, mainLiftExerciseId \| null, supersets, groups: Record<BuilderGroup, 1–4>, templateRoutineId?, templateVersion? }`; `rawArgs: ''` and `turnId: 'manual'` for manual versions |
| **Edit history** | Manual edits update the current version in place (version bump + opId); a new draft version only for rebuilds and applied coach proposals (stays under `MAX_WORKOUT_DRAFT_VERSIONS` 20). The last Undo snapshot is stored on the draft so Undo survives a force-close |
| **Load source** | `DraftLoadSchema.source` + `'calc'` (code: est. 1RM × reps × RPE, labelled estimate) and `'ben'` (typed). `coach` / `coach_est` / `rule` / `none` unchanged |
| **Day notes** | `Memory` + `scope?: { kind: 'plan_day', splitDayId, mainLiftExerciseId \| null }`, `source: 'review'`, `dismissedAtUtc?`. Active notes go to the coach; dismissed ones don't |
| **Builder groups** | `BuilderGroup = Chest \| Back \| Shoulders \| Legs \| Biceps \| Triceps \| Abs`, a display grouping over `SplitBodyPart`: Legs = Quads + Hamstrings + Glutes + Calves; Abs = Core. Stored data keeps `SplitBodyPart` |
| **Rear delts** | [Ben 20 Oct, H5] rear delts count as Back: `MUSCLE_TO_GROUP.rear_delts → 'Back'`. This also changes Progress group counts (computed, no stored data) |
| **Focus line** | `builderFocusOf(exercise)` from primary muscle: Upper chest / Mid chest / Lats / Mid-back / Rear delts / Front delts / Side delts / Quads / Hamstrings & glutes / Calves / Biceps / Triceps / Abs |
| **Heavy flag** | Catalogue `heavy?: boolean` (§3.5) |

### 4.3 Migrations [Proposal]

- Routines, drafts, memories and catalogue entries are JSON documents: the new fields are optional, so older rows and backups parse unchanged. No data rewrite.
- One SQL migration (next free number after 0028) rebuilds `coach_actions` for the new tool kinds (§5), as 0019 and 0025 did.
- Existing plan-applied routines become templates on first open: `planDay` filled from `createdFromPlan.splitDayId` and the routine's `main` exercise, `variation: null`.
- Backup/export: templates and variations go with routines; day notes with memories (Your data).

### 4.4 Limits reconciliation [Proposal]

| Limit | Now | v3 needs | Proposal |
|---|---|---|---|
| `minRestS` | 30 | Drop 0:15 | Per type: drop 0–60 s; others 30 s min |
| `maxRestS` | 300 | Prototype allowed 6:00 | Raise to 360 (`DraftSetTemplate.restS` bound follows) |
| `maxSuperset` | 4 | Prototype letters to `f` | Keep 4; refuse a 5th drop |
| `maxWarmups` | 4 | Ramp is ≤ 4 | Keep; `＋ Warm-up` disabled at 4 |
| `maxExercises` | 10 | Rec. max 7 | Keep; `＋ Add exercise` disabled at 10 |
| `maxWorkingSets` | 10 | Prototype 8 | Keep 10 |
| Length | 15–180 | Prototype 10–180 | 15–180 |

---

## 5. Coach integration [Proposal unless tagged]

| Tool | Page | Behaviour |
|---|---|---|
| `fill_setup` (new, strict) | 1 | `{ dayId?, minutes?, mainLiftCatalogueId?, supersets?, groups?: [{group, delta\|count}] }`. Applied at once, toast Undo [Ben]. Code checks day exists, minutes from Ben's words win (`buildMinutesFor`), main lift in `mainLiftOptions`, counts 1–4 |
| `propose_workout_edit` (new, strict) | 2 | Typed ops: `swap`, `add`, `remove`, `sets`, `reps`, `rpe`, `load`, `move`, `superset`, `unlink`, `minutes`, against `baseDraftVersion`. Code applies to a copy, runs all §3 rules and limits, then shows before/after [Ben] |
| `review_workout` (new, strict) | 2 | `{ verdict, suggestions: [edit ops + reason], nextNotes: string[] }`. Code supplies the facts; text numbers checked (`checkCoachClaims`, number facts) |
| `propose_plan` (existing) | — | Builds plan days; Apply now writes them as templates (§4.2) |

- **Staleness (rule 5):** every proposal carries `baseDraftVersion`; Apply re-reads the draft and refuses if it moved (`Out of date. Ask again.`). Template updates carry `expectedVersion`.
- **What code checks:** exercise IDs usable here; pain flags (left out or held, rule 9); loads via `checkProposedLoad` (ceilings `capE`/`capLastTop` 1.2, `stepsHarderAsked` when Ben asked heavier) then snap (rule 4); limits clamp with a note; minutes from the estimate, never the model; numbers in text against facts.
- **AI status:** connected / `Offline` / `Coach not connected`, never a canned reply; no silent paid route (rule 7). Ben's words and imported text are data (rule 8).
- **Rule 3 note (flag):** CLAUDE.md rule 3 says a change Ben asks for to *today's remaining sets* applies at once with Undo. Ben's 20 Oct decision makes page-2 chat a proposal (Apply/Skip) **before Start**. Proposed reading: before Start = proposal (Ben's decision); after Start, `edit_today` keeps rule 3's immediate apply. Ben to confirm (§9 Q11).
- Context sent: today's draft and set-up, the template and its variations' names, day notes, plan position, gym, pain flags, load references (existing builder context). Your data and Coaching knowledge stay labelled separately (rule 10).
- Variety rotation per block is a coach **suggestion** on the template (Apply/Undo), raised at block boundaries or when Ben asks (rule 3) [Ben]; it waits for H4.

---

## 6. Reviews and progress

| Review | When | Now / later |
|---|---|---|
| **Session (builder) review** | `Coach review` on page 2, before Start | Now (§2.9) |
| Post-workout (Summary) | After Finish | Existing workout-summary.md; [Proposal] Summary reads the day notes and ticks off ones met |
| Weekly | End of the plan week | Later: facts (days done, sets per muscle vs plan, main-lift trend), coach verdict, plan proposals |
| Block / goal | End of a block (H4) | Later: block facts from logged data, next-block proposal (Apply/Undo), accessory rotation suggestions |
| **Goal-progress view** | One place: goal, plan in use, main-lift trends, volume per muscle, review history | Design TBD; facts only (no scores, rule 6); est. 1RM labelled |

Leave room: `Routine.planDay` gains `blockId?` / `weekN?` in H4; reviews store as their own records with facts and the coach text separately.

---

## 7. What this supersedes

| Older spec / item | Superseded by |
|---|---|
| workout-builder.md §3–§4 Build card, length chips (`BUILD_LENGTH_CHIPS`), Draft card `Open` → overview | Set up page + page 2 (chat build fills Set up) |
| workout-builder.md BD17 / `ask_build_question` in the builder | Set up rows ask nothing; [Proposal] keep the tool only for free chat builds |
| workout-builder.md BD19 main-lift insertion | Main lift row on Set up (the template's main lift) |
| workout-builder.md BD12 `Save to Workouts` from a draft | Start scope prompt; `Save to Workouts` stays in `⋯` for non-plan workouts |
| Backlog H5: `Save as day default`, default workout per day, Supersets review sheet | Removed [Ben]: today-only edits + scope prompt + variations; pairing by drag/pop-up |
| workout-overview.md for plan days | Page 2 (§2.1, pending Q2) |
| routines.md editor for plan-day routines | Builder pop-ups edit templates through the scope prompt; the library editor stays for other workouts [Proposal] |
| weekly-plan.md / plan Apply making one routine per day | One routine per day **per main lift**, plus variations |

Unchanged: active workout, Rest, Summary, `edit_today`, adaptive Up next, pause/end plan.

---

## 8. Build slices (in order)

**S1 Schemas and limits.** §4.2 fields, `BuilderGroup`, rear delts → Back, limits §4.4, migration.
- Old routines, drafts, memories and backups parse; a round-trip backup keeps `planDay` and variations.
- `rear_delts` counts as Back in Progress and split matching; tests updated.
- A draft with a 0:15 drop rest and a 6:00 rest validates; a 5-exercise superset fails.

**S2 Domain rules (pure).** `recommendBuilderGroups`, `buildFromSetup`, `orderSlots`, `pairSlots`, `setRowsFor` (warm-ups, top/back-off/drop), `builderLoad`, `estimateBuilderMinutes`, `adviseBuilder`.
- Bench e1RM 127 at a gym with 1.25 kg plates: top 6 @ 8 = 100, back-offs 8 @ 8 = 95; at a gym whose smallest pair is 2.5 kg, 95.25 → 95 (down, never up).
- A stack machine max 100 never yields > 100.
- Chest, 60 min, supersets on: ≤ 7 exercises, ≤ 4 per group, main first, abs last, no abs + heavy pair.
- The estimate for a known fixture equals the §3.6 formula to the minute.
- Each §3.8 case fires once with its reason; none blocks the change.

**S3 Set up + Your workout, manual, offline.** Pages, drafts persisted, Start → session.
- Airplane mode, no AI: Set up → page 2 → Start → first set logged.
- Force-close on page 2 after 3 edits: reopening shows the edits; Undo of the last edit still works.
- Set up change → `Rebuilt for the new set-up · Undo` restores both pages exactly.
- Start disabled with no exercises.

**S4 Gestures, pop-ups, keyboard, accessibility.**
- A slow vertical scroll never starts a drag; a still 320 ms hold does (haptic).
- Every gesture has a pop-up button and a VoiceOver custom action; a full edit is possible with VoiceOver only.
- Typing in the last set's RPE: the cell stays visible above the keyboard bar at the largest Dynamic Type size.
- Typed kg isn't overwritten by a reps change; a type change recalculates.
- Targets ≥ 44 pt; body ≥ 16 pt; loads and timers tabular.

**S5 Plan-day templates, variations, scope prompt, Today entry.**
- Up next Chest opens `Chest · bench` with loads from history, no rebuild.
- Swapping one exercise then Start shows the prompt with one change line; `Today only` leaves the template's version unchanged.
- `Update Chest (bench)` bumps only that template; `Chest · incline` is untouched; Undo restores it.
- `Save as new variation` → appears on Set up `Variation`; picking it loads it exactly.
- A template edited elsewhere after opening: update refused, `Your plan changed. Today only?`.

**S6 Coach chat and voice.**
- Page 1 "pull, 50 minutes, no supersets" fills three rows, toast Undo restores all three.
- Page 2 proposal applied after a manual edit: `Out of date. Ask again.`, nothing changes.
- "Bench heavier" never exceeds `capLastTop`; result is achievable here.
- Offline: no coach text appears anywhere; mic still transcribes on-device.

**S7 Coach review and day notes.**
- Every count in the sheet matches a code recount; a coach sentence with a wrong number is hidden.
- Unticked notes aren't saved; saved ones show on the next Chest day page 2 and dismiss with ✕ (and stop going to the coach).
- Notes appear in Your data export and are deleted with Your data, not with Coaching knowledge.
- No AI: facts and Plan section show, no verdict, header `Offline`.

---

## 9. Open questions for Ben

1. Keep a one-tap `Start` on Today's Up next card that starts the plan day unchanged, with the card body opening the builder? (yes/no)
2. Page 2 replaces the Workout overview for plan days (gym chip and check-in move onto it)? (yes/no)
3. When a day has two main-lift templates (bench, incline), should Up next alternate them automatically? (yes / no, use Profile's main lift unless I change it)
4. Back on Set up, a length-only change trims sets and a group change adds/removes only that group, instead of a full rebuild? (yes/no)
5. Put `Variation` as a Set up row under Main lift, shown only when variations exist? (yes / pick another place)
6. Offline, should the page-1 bar fill simple set-up words with plain code (labelled `Offline`)? (yes/no)
7. Main lift can never join a superset? (yes / allow it with a "not recommended" note)
8. Typed weights stay today-only even when I update the plan day? (yes / save them as fixed loads)
9. Rest limits: drop sets 0–60 s and a 6:00 maximum for other sets? (yes/no)
10. Group label: `Abs` or `Core`? (pick)
11. Before Start, coach changes I ask for are proposals (Apply/Skip); after Start they apply at once with Undo as today? (yes/no)
12. Up to 5 variations per day and main lift? (yes / pick a number)
13. Load-only edits don't trigger the "Keep these changes?" prompt? (yes/no)
