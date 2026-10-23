# Workout builder v3 (Set up → Your workout, plan-day templates, variations, coach review)

Status: **Approved by Ben, 20 Oct 2026** ("go" with the designer's recommended answers to §9; later 20 Oct additions on Today, Mix it up, auto-reviews and Progress › Reviews included). Rev 3+.

> **Revision (Ben, 22–23 Oct): decisions D1–D5, D8, D9.** These win where older text below differs. Prototypes: `prototypes/training-blocks.html` (Today with a plan), `prototypes/workout-builder-v3.html`, `prototypes/app/` (whole app).
> - **D1 Start always just starts, today only.** No `Today only` / `Update in your plan` / `Save as a variation` prompt anywhere (§1.3, §2.0.4, §2.8 old prompt and §2.9 `Update plan day` are superseded). On the Summary, **only** when Ben changed the workout's structure (swapped, added or removed exercises, or changed set counts) one row: `Keep for next time?` `Apply` / `Skip`. Apply changes that plan day (or that saved workout) only, with Undo. A Time change never asks: a short day isn't a new plan. Spec: new §2.8.
> - **D2 The coach never applies unasked changes.** The background review of a pre-start draft (§2.0.3 step 2) is an offer line (`✦ Cable fly 3 → 2 sets? Apply ✕`) on Today's card and on Your workout; nothing changes until Apply. Weekly-review changes outside coach-adjustments CA8 "small" are Apply / Skip; stall resets and extra sets Ben didn't ask for always need Apply. Small next-session load/reps/sets changes on the Summary stay as approved (CLAUDE.md rule 3).
> - **D3 Lean Today with a plan.** The card shows the session rows, `Start`, an inline `Time` control (with the fit note) and `Edit`. Main lift, Accessories, Abs and Supersets move to Your workout (Edit, §2.3a). No `Today only` tag. *(Review 23 Oct: D3 doesn't name `↻ Mix it up` (approved 20 Oct) or the session-type chips. Both leave the lean card; the designer proposes `↻ Mix it up` as a fifth row on Your workout's controls, and a saved variation picked on Set up's `Variation` row. Pending Ben, §9 Q-R6; the prototype has neither yet.)*
> - **D4 Back-offs** come from their reps and effort, then snap down: §3.1 item 9.
> - **D5 Muscles.** Broad groups for picking: `Chest`, `Back`, `Shoulders`, `Legs`, `Arms`, `Core` (Legs is one group, rear delts count as Back). The detailed list for counting (plan weekly sets, Progress): Chest, Back, Shoulders, Quads, Hamstrings, Calves, Biceps, Triceps, Core. A broad group is exactly the sum of its detailed parts. Supersedes §4.7's 22 Oct note and Q8's `Abs` label (the group is `Core`).
> - **D8 Coach "next time" changes.** When Ben applies a coach change for his next workout in chat, it lands on that workout's Your workout draft as today-only edits, visible there (and on Today's card) with Undo (§2.1 note). This rebuilds `propose_next_workout_change` after the overview's retirement (CHANGELOG 2026-10-22, B3).
> - **D9 Time** on Today and on Your workout is the one shared fit of [fit-to-time.md](fit-to-time.md)'s 22 Oct revision: shorter rests first, superset pairing only when Supersets is on, then the cheapest cut by training lost per minute, never the main lift; a carry-over offer of up to 4 sets to the next same-muscle day, with Undo. Supersedes the order in §2.0.2 item 3.
>
> **Review fixes (23 Oct, `docs/reviews/batch23-design.md`).** Designer fixes inside D1–D9; the ones that choose between readings are proposals for Ben (§9, R-questions).
> - **Keep for next time? lists only Ben's own changes (B1, S1; SP1).** It compares his structure, replayed on the plan day's template for his chosen controls, with the template for that main lift. The fit's cuts and what it gives back, pairing, a deload and the coach's changes never show; picking another main lift picks that template. §2.8.
> - **Edits on Your workout stay on Today (D3 regression).** Back on Today the card shows the edited draft (`Edited`), Start starts it, Edit reopens it with every control and edit; a control change keeps Ben's earlier edits (S3). §2.0.4, §2.0.5, §2.3a.
> - **A coach offer goes stale (rule 5).** It reads against the draft as shown; once Ben or the fit changes that exercise it's withdrawn on both screens, and Apply changes only it. §2.0.3.
> - **Back-offs (B2, D4 vs SS4/HT8).** No achievable load in the band: the one nearest the band below the top, never the top; a lowered top (pain hold, coach, Ben, deload) lowers the back-offs by the same %; the plan's focus band on Today and in the workout too. §3.1 item 9.
> - **Fit (S2, S5).** Pairing is a counted step; the cut that loses least training overall; the carry-over is an offer by muscle. fit-to-time.md revision.
> - **Set up chat (D5 regression).** A part Ben names (`add hamstrings`) is the exercise added. §2.2.

**§1–§3 are for Ben. §4, §5 and §8 are for the developer.**

Source: Ben's iteration of the prototype [`prototypes/workout-builder-v3.html`](prototypes/workout-builder-v3.html) on 20 Oct, the Today prototype [`prototypes/today-v2.html`](prototypes/today-v2.html), and his decisions that day. Tags:

- **[Ben]** = Ben's decision, 20 Oct 2026 (approved direction; quoted where useful).
- **[Proposal]** = designer proposal, not approved yet. Ben decides (§9).
- **[Proto]** = what the prototype does. It stays a proposal unless it's also tagged [Ben].

Rules: CLAUDE.md 1–10 and minimal copy. Tokens: [design-system.md](design-system.md). The builder sits **outside the logging loop**: nothing here adds a step to Active set, Rest or Summary.

---

## 1. Purpose and how it fits

**Question:** "What am I training today, in what order, at what weights, and does it fit my time?" **Primary action:** `Start`.

**Words:** "the builder" = both pages (Set up and Your workout); "Set up" = its first page. On Today, `Edit` opens the builder on Your workout; `Build your own` opens it on Set up.

### 1.1 The chain [Ben]

> Ben: "this should all still be buildable from the coach as part of the long-term plan goal etc, which gets tracked and separately reviewed and progress seen."

```
Goal (Profile) → Plan (days, order, rotation; training blocks later)
  → Plan days = fixed TEMPLATES in the builder's full format,
    one per day + main lift, each with optional saved VARIATIONS
  → Today (§2.0): Today's session = the next plan day (any day one tap),
    drafted for this week; Start as is, or Edit in the builder
  → Logging → Reviews (session now; weekly / block / goal later)
  → One goal-progress view (later, §6)
```

### 1.2 What changes and what stays [Ben]

> Ben: "i wouldn't imagine chest sessions should change much week on week, it's more about rotating."

| Week to week | Rotates | Stays |
|---|---|---|
| Numbers only: loads, reps, sets from progression; deloads (in training blocks, later) | Plan days (adaptive Up next); accessory variety per block (4–8 weeks) as **coach suggestions Ben approves** | Main lifts (so progress is measurable); each plan day's structure until Ben changes it |

### 1.3 Templates per main lift, with variations [Ben]

- A plan day is saved **per main lift**: `Chest · bench` and `Chest · incline` are separate templates (Ben: "have them saved depending on what the main lift is").
- Each template can have saved **variations**: `Chest · bench · arms superset`, `Chest · bench · abs superset` (Ben: "also have variations saved, such as including arm supersets or abs superset, so it doesn't lose stuff and have to redo unnecessarily"). Picked on Set up's `Variation` row. ~~Picked on Today's session-type chips~~ (D3: the lean card has no chips; how a variation reaches Today or Your workout is open, §9 Q-R6).
- [Proposal] A variation is stored as **the template plus its extras** (the added exercises and pairings), not as a full copy. So when the template changes, every variation picks up the change and nothing has to be redone (§4.3).
- **`Save as default` is removed.** Edits are **today only**. ~~On Start after edits, one prompt: `Today only` / `Update Chest · bench in your plan` / `Save as new variation` (§2.8).~~ **Superseded (Ben, 22–23 Oct, D1):** Start always just starts. After the workout, if Ben changed its structure, the Summary asks once: `Keep for next time?` (§2.8). That row is rule 2's scope choice now: Apply changes only that plan day (or that saved workout), with Undo.
  - ~~**With a plan (Ben, 22 Oct):** `Today only` tag; `Update in your plan` opens the plan's Changes review.~~ Superseded by D1 and D3 (Ben, 22–23 Oct): no tag, no prompt.
  - **Open for Ben:** with `Save as new variation` gone from Start, nothing creates a new variation. Existing ones still show. A third choice on the Summary row (`Save as a version`) is one option; not added here.
- Name format everywhere: `<Day> · <main lift>` and `<Day> · <main lift> · <variation>`.

---

## 2. Screens

**Today (v2)** is the Today tab (§2.0). The builder is two pages in one full-screen modal, **Set up** and **Your workout**, plus sheets. iPhone width 390 pt.

### 2.0 Today (v2)

> Ben (20 Oct): "we have quite a lot of content that's not quite fitting together: last few days workouts, and past or upcoming runs / other planned, and how that interplays with our plan. design a page that combines all of this, and then has the recommended workout - no need for too much summary until clicked on, and then have option to select other workouts already used quickly, or set-up more detailed with the builder we've made". And: "it's also just not clear how the coach uses all this information in building the workouts".
>
> Later the same day: "the runs this week only if i specify which days / told the coach" and "i don't really like the set-up for the recommended and 4-day split. can't really differentiate between sets that easily... having quick option for the different types of session (within the recommended day), but also option to change day if like".

#### 2.0.1 Purpose

**Question:** "Given my week, what should I train today?" **Primary action:** `Start` on the session card, one tap (plus the check-in sheet when due, unchanged). While a workout is in progress the primary action is `Resume` (unchanged from today.md).

#### 2.0.2 Layout

**Today with a plan, lean card (Ben, 22–23 Oct, D3; supersedes the five session controls, the collapsed `Session breakdown`, `↻ Mix it up` and the `Today only` tag below).** One primary: `Start`. Everything else on the card is a value, the Time control or `Edit`.

```
┌──────────────────────────────────────────┐
│ Tuesday · Week 3 of 6          (✦)  (🎙) │
│ SAT  SUN  MON ┃TODAY WED  THU  FRI       │  7-day strip (unchanged)
│ TODAY'S SESSION                          │
│ [ Chest ] Back   Legs  Shoulders   ⋯     │  day control, NEXT under the plan's day
│ ┌──────────────────────────────────────┐ │
│ │ Chest              5 exercises · ~47 min│ estimate
│ │ ✦ Cable fly 3 → 2 sets?   Apply   ✕  │ │  only with a coach offer (D2)
│ │ Time                  [−] 60 min [+] │ │  live fit: "Time · −1 exercise ›" (D9)
│ │     Exercise              Sets  Top set│ │  every value a target
│ │ 1  Barbell bench press      3   102.5 │ │
│ │    1 × 6 + 2 × 8 · 102.5 / 95         │ │  main-lift format (D4 back-offs)
│ │ 2  Incline dumbbell press   3  27.5 ea│ │
│ │ 3  Cable fly                3    15   │ │
│ │ ┌ 4a Triceps pushdown       3    30 ┐ │ │  superset box
│ │ └ 4b Cable crunch           3    40 ┘ │ │
│ │ Why?                                  │ │  collapsed, reasons only
│ │ [          Start          ] [ Edit ]  │ │
│ └──────────────────────────────────────┘ │
│ [  Build your own  ] [   ＋ Activity   ] │
└──────────────────────────────────────────┘
```

- **Rows are always shown** (no expand step): Ben sees what he's about to do before the one tap. If the card doesn't fit at large text sizes, the page scrolls; `Start` stays on the card, and the tab bar stays.
- **Time** is the only control: `[−] 60 min [+]`, 5-minute steps, 20–120. It fits today's draft only (D9, fit-to-time 22 Oct revision and its 23 Oct review fixes). With a live fit, a short note follows the label in light orange (`· −1 exercise ›`, else `· −3 sets ›`, else `· shorter rests ›`); a tap lists everything it changed and the carry-over offer, one muscle per line, to that muscle's next day (`+3 triceps sets on your next Shoulders day?` `Carry over`; after, `Undo`) [Proposal, review S5/SP3]. The control itself never moves.
- **Edit** opens Your workout with this draft (§2.3), where Main lift, Accessories, Abs and Supersets now live (§2.3a).
- **Back from Your workout (review 23 Oct; resolves §2.0.4 vs §2.0.5).** What Ben changed on Your workout is today's draft: the card shows it, with `Edited` under the minutes; `Start` starts it; `Edit` reopens it with every control and edit; Time refits around it (his edits always stand, FT5). Each plan day keeps its own edited draft while Ben looks at another day [Proposal]. The prototype carries controls and structure edits (exercises, set counts) back; loads, reps, order and pairing typed on Your workout stay in Your workout's draft in the build (§4.4) but not in the prototype's card.
- **States added:** coach offer line (D2: `✦ <change>?` `Apply` `✕`; Apply changes that value on today's draft only, with an Undo toast; ✕ skips it, with Undo; withdrawn once the fit or Ben changes that exercise, §2.0.3); early-deload offer (training-blocks §3.1) above it when both apply. Offline or coach not connected: no coach line; `Why?` ends `Not reviewed · Offline`.
- **Copy:** `Start` · `Edit` · `Edited` · `Time` · `45 min` · `−1 exercise` / `−3 sets` / `shorter rests` (estimate notes) · `+3 triceps sets on your next Shoulders day?` · `Carry over` · `Undo` · `Out of date` · `Why?`. No `Today only`, no `Session breakdown`.
- **Acceptance (D3):** with a plan, Today's card has no Main lift, Accessories, Abs or Supersets control, no `Today only` tag and no Start prompt; it shows the rows, `Start`, `Time` and `Edit`. Changing only Time and tapping Start starts the workout at once. Edit → Abs off → `‹ Today`: the card has no Cable crunch and says `Edited`; Edit again shows Abs off; Start starts without abs.

Regions, top to bottom (20 Oct; the session card is now the lean card above):

1. **Day title** `Tuesday`, with the `GymChip` trailing [title Ben/Proto; GymChip kept from today.md, Proposal].
2. **Coach bar + mic** `✦ Ask the coach` [Ben]. Opens the coach sheet (never full screen); the mic starts listening at once.
3. **7-day strip** [Ben; range Proto, §9 Q19]: 3 days back, today, 3 ahead. Each cell: weekday, date, up to two items. A thin divider sits before Monday so the plan week is visible [Proposal]. No plan line and no run counter [Ben]. **Cell items (Ben, 21 Oct):** no ✓; a done session is a soft-green pill (same green as Progress chips), a planned one a dashed outline, cardio its own tint; every label is centred and on one line, shrinking to fit (`adjustsFontSizeToFit`, `numberOfLines={1}`, `minimumFontScale` 0.75) instead of wrapping or being cut off; all seven columns equal width. Label text about 10 pt with slight negative tracking (the prototype's `.pip`, 9.5 px, −0.02 em), growing with Dynamic Type only to 1.1× (the column is fixed; accessibility sizes get the list), so `Shoulders` fits a 375 pt column at the 0.75 floor (review today-fix-21oct SP5).
4. **Banners / rare lines** from today.md (failed backup, check-in line, pain `Still hurts?` line), unchanged, at most two [Proposal].
5. **`Today's session`** [Ben]:
   - **Day segmented control**: the plan's days in plan order, `Chest` `Back` `Legs` `Shoulders` `⋯`. `NEXT` under the plan's next day, which is selected on open. Any day is one tap. `⋯` opens **Other workouts**.
   - ~~**Session-type chips** for the chosen day: its main-lift templates, then its saved variations (`Bench` `Incline` `Bench · arms superset`). Shown only when the day has more than one. The first is the last-used one [Proposal].~~ (D3: none on the lean card; the main lift is on Your workout.)
   - **Session card**, ~~collapsed by default~~ (D3: rows always shown, the lean card above).
6. **`Build your own`** and **`＋ Activity`** side by side [Proto].
7. Tab bar: Today · Library · Progress · Profile.

Collapsed (normal):

```
┌──────────────────────────────────────────┐
│ Tuesday                   [⌂ Main Gym ▾] │
│ ┌──────────────────────────────┐ ┌────┐  │
│ │ ✦ Ask the coach              │ │ 🎙 │  │
│ └──────────────────────────────┘ └────┘  │
│ SAT  SUN  MON ┃TODAY WED  THU  FRI       │  ┃ = week starts
│  17   18   19 ┃ 20    21   22   23       │
│ ✓Sho Run  Rest┃Chest ┆Run ┆Legs ┆Back   │  ✓ green = done
│      12k      ┃      ┆8k                 │  ┆ dashed = planned
│ TODAY'S SESSION                          │
│ ┌──────────────────────────────────────┐ │
│ │[ Chest ] Back   Legs  Shoulders   ⋯  │ │  segmented, 48 pt
│ │  NEXT                                │ │
│ └──────────────────────────────────────┘ │
│ (●Bench) ( Incline ) ( Bench · arms ss ) │  chips, only when > 1
│ ┌──────────────────────────────────────┐ │
│ │ Chest · Bench                      › │ │
│ │ 5 exercises · ~55 min · plan day 1/4 │ │
│ │ [         Start         ] [  Edit  ] │ │
│ └──────────────────────────────────────┘ │
│ [  Build your own  ] [   ＋ Activity   ] │
├──────────────────────────────────────────┤
│  Today    Library    Progress   Profile  │
└──────────────────────────────────────────┘
```

Expanded (tap anywhere on the card except the buttons):

```
│ ┌──────────────────────────────────────┐ │
│ │ Chest · Bench                      ⌄ │ │
│ │ 5 exercises · ~55 min · plan day 1/4 │ │
│ │ Target          sets × reps · kg     │ │
│ │ 1  Barbell bench press               │ │
│ │    1 × 6 + 2 × 8 · 102.5 / 95        │ │  main-lift format
│ │ 2  Incline DB press  3 × 8 · 27.5 ea │ │
│ │ 3  Cable fly             3 × 8 · 15  │ │
│ │ 4a Triceps pushdown      3 × 8 · 30  │ │  superset a/b
│ │ 4b Cable crunch          3 × 8 · 40  │ │
│ │ FROM LAST REVIEW                     │ │
│ │ Include abs                       ✕  │ │
│ │ BASED ON                             │ │
│ │ · Plan: Chest is next (day 1 of 4)   │ │
│ │ · Long run Sat: legs Thu, upper today│ │
│ │ · Last Chest, 13 Oct: bench 100 × 8  │ │  actual
│ │   @ RPE 8 → 102.5                    │ │
│ │ · Goal: strength · bench target 110  │ │
│ │ · Fits your 60 min (about 55)        │ │
│ │ ✦ Coach: 3 sets on fly, not 4 —      │ │  only when the AI changed something
│ │   shoulder felt tight last time  Undo│ │
│ │ [         Start         ] [  Edit  ] │ │
│ └──────────────────────────────────────┘ │
```

Day sheet (tap a day), half height:

```
│ Thu 22 Oct                               │
│ │ Legs · squat                 Planned │ │
│ │ Moved from Fri: long run Sat         │ │
│ [        Move or change (coach)        ] │
│   Close                                  │
```

Other workouts sheet (`⋯`), half height [Proto]:

```
│ Other workouts                           │
│ │ Push                         PPL day │ │
│ │ Pull                         PPL day │ │
│ │ Hotel shoulders       Recent · 17 Oct│ │
│ │ Upper body             Recent · 8 Oct│ │
│ [            Build your own            ] │
│   Close                                  │
```

- **Strip items** [Ben]: done workout `✓ Shoulders` (green fill), done activity `Run 12k` (run colour fill), planned plan day `Legs` and planned run `Run 8k` (dashed outline, same colour, plus `Planned` in the VoiceOver label and the sheet), rest `Rest` (text only). Colour is never the only signal (fill vs dashed outline, plus the VoiceOver word `done` / `Planned`); no ✓ in cells (Ben, 21 Oct; the accessibility list keeps it). Today's cell has the accent outline and shows the chosen day.
- **Runs** (logged or planned) appear only when Ben logged them (`＋ Activity`) or told the coach (`log_activity`) [Ben]. Nothing is inferred or added by the plan. [Proposal] The same goes for future plan days: they show only when dated (a week change Ben applied, or days he told the coach); otherwise future cells stay empty, since the rotation has no dates.
- **Cells** are ≥ 44 pt wide at 390 pt (7 × ~47 pt). At accessibility Dynamic Type sizes the strip becomes a 7-row list (`Sat 17 · ✓ Shoulders`) [Proposal].
- **Session controls** *(Ben, 22–23 Oct, D3: with a plan only Time stays on the card; Main lift, Accessories, Abs and Supersets are on Your workout, §2.3a. The no-plan card keeps all five.)* [Ben, 20 Oct: "when click chest, it should say Main lift: bench, incline. and have option for superset on/off. these are the core crux of the session"]: under the day control, five compact rows (about 38 pt visible, small labels and chips; each control keeps a 44 pt tap area) [Ben, 20 Oct: "make the main lift through to supersets a bit smaller"], and the card rebuilds from them:
  1. `Main lift`: one chip per main-lift template (Bench · Incline).
  2. `Accessories`: `Focused` (2 accessories × 3 sets) / `Varied` (3 accessories × 2 sets at different angles, e.g. incline press, cable crossover, dips) [Ben, 20 Oct]. Default from the Profile goal: Strength → Focused, Muscle/Both → Varied [Proposal].
  3. `Time` *(the fit order below is superseded by D9, Ben 22–23 Oct: fit-to-time.md's 22 Oct revision; no pushed effort, supersets only when Supersets is on)*: − / + in 5-min steps, default the plan's length [Ben, 20 Oct: "quickly adjust everything without me having to build a whole new workout"]. Shorter time applies, in order, only as far as needed: (a) shorter rests, then shortest (main 3:00→2:00, compound 2:00→1:15, isolation 1:30→1:00, superset round 1:30→1:00); (b) push effort: accessory last sets to RPE 9; (c) fewer accessory sets (not below 2); (d) drop exercises: abs, then the other group's isolation, then accessory isolations, compounds last; never the main lift. Longer than the plan: normal rests, +1 set on accessories (max 4), then add an exercise from the day's pool. The card shows one line, e.g. `To fit 45 min: shorter rests · 2 sets fewer`. Main-lift loads never change for time [Proposal].
  - Freed time is filled [Ben, 20 Oct: "if you remove abs and we then have more time, we should be increasing the number of exercises, e.g. have 2 arm exercises, maybe another chest"]: when abs (or anything else) comes out and the time allows, exercises are added before sets: first a second arm exercise, then another accessory for the day's main group. With supersets on, abs off gives the arm exercise an arm partner in the same slot (pushdown + curl), so the time stays the same. The plan's own spare minutes are kept as a buffer; only time beyond that is filled.
  4. `Abs` on/off [Ben, 20 Oct]: default from the plan ("the coach should recommend whether abs are on or not based on the plan"); when Ben differs, a small `plan: on/off` shows under the label. Off removes the ab exercise and splits its superset.
  5. `Supersets` on/off.
  - [Ben, 20 Oct: "rather than having from last review and based on, just have that within a Why which you access only if you want"] The expanded card has no `From last review` or `Based on` blocks; both live in one collapsed `Why?` (plan position, last session and resulting load, last review's note, goal/target, accessories and time, plus the coach's reason if it changed anything; offline: `Not reviewed · Offline`). This supersedes those two blocks wherever this spec describes them.
  - Card order [Ben, 20 Oct: "move Chest above the main lift bit… then have Session breakdown below, then Start. only show session breakdown if clicked on"]: title (`Chest · Bench`, `5 exercises · ~52 min · plan day 1 of 4`) and any fit/clash line, then the five controls, then a collapsed `Session breakdown ›` row (exercise table, `Why?`, `↻ Mix it up`), then `Start` / `Edit`.
  - [Ben, 20 Oct: "doesn't need to say bench if it's selected below. should ideally fit to page without having to scroll"] The title is just the day (`Chest`); the main lift shows only in its chip. With Session breakdown collapsed, everything from the header to `Build your own` fits one iPhone screen without scrolling: the coach becomes a compact `✦ Coach` + mic in the header row next to the date, and the week strip is shorter.
  - [Ben, 20 Oct] Title row: the day on the left; `5 exercises · ~52 min` on the right (and `Chest moves to Thu` under it when another day is picked). No `plan day N of 4` anywhere on Today: `NEXT` on the day control already says it. This replaces every `plan day 1 of 4` example in this spec.
  - `↻ Mix it up` rules [Ben, 20 Oct: agreed]:
    1. **Which one**: never the main lift; the accessory done most often lately on this day (on Varied, one that repeats another's angle goes first).
    2. **Shortlist (code)**: same muscles, different angle; same role (compound ↔ compound, isolation ↔ isolation, so balance and time hold); available at today's gym; not pain-flagged; not done in this day's last two sessions; not already in the workout.
    3. **Pick**: with AI, the coach picks from the shortlist using goal, recent sessions and memories (e.g. "hates dips") and adds a one-line reason (shown under the swap and in `Why?`); offline, code picks the least recently done, labelled not reviewed.
    4. **Load**: from history if done before; else a conservative first-time load, marked estimate (existing `noReferenceCeiling`).
    5. **Use**: `Cable fly → Cable crossover · today only` with the reason, `Another (1/3)` cycles the shortlist, `Undo` restores. Today only; if Ben keeps choosing the same swap, the coach may suggest it as a plan change (proposal).
  - `⋯` = **Other sessions** [Ben, 20 Oct]: session types outside the split, with the same controls and fit-to-time rules: `Full body`, `Upper`, `Push` (not `Pull`/`Lower`, which duplicate Back/Legs; not recent one-off workouts; not saved variations, which the controls now cover). Then `Empty workout` and `Build your own`. When one is picked, the `⋯` segment shows its name (e.g. `Full body`) and the plan's day moves on as for any other pick. This supersedes earlier `⋯` contents in this spec (PPL days, recent workouts, "Your <day> variations").
  Re-rendering keeps the scroll position (e.g. `↻ Mix it up` doesn't jump to the top) [Ben, 20 Oct]. Supersets off splits the pairs and the card's minutes update. Saved variations are not chips; they sit in `⋯` under "Your <day> variations"; picking one shows `Variation: <name> · Back to plan day`.
- **Variety** [Proposal]: mostly coach-driven. (1) Every block (4–8 weeks) the coach proposes swapping a couple of accessories; Ben approves (plan change). (2) `↻ Mix it up` on the card: the coach swaps one accessory for a fresh one hitting the same muscles, today only, shown as `Cable fly → Machine chest press · today only · Undo`; never the main lift. (3) Saved variations for set alternatives Ben wants to keep.
- **Day control** [Ben]: segments ≥ 48 pt high. Unselected days and types are greyed so the chosen one stands out [Ben, 20 Oct], still ≥ 4.5:1 contrast. Up to 4 plan days show; with more, the rest go in `⋯` [Proposal]. `NEXT` is text under the label, not colour alone. Picking a day resets the chips to that day's first type and collapses the card. At accessibility sizes it becomes a row `Day  Chest ›` that opens a list [Proposal].
- **Session-type chips** [Ben]: ≥ 44 pt high (the prototype's 40 pt is too small). The selected chip is filled and carries `●` / selected trait. Labels: `<main lift>` for templates, `<main lift> · <variation>` for variations. They wrap to a second line rather than scroll.
- **Other workouts (`⋯`)** [Ben]: other split days (`Push`, `Pull`, tagged `PPL day`), recent non-plan workouts from the last 14 days (`Recent · 17 Oct`), then `Build your own`. Tapping a row puts it on the card; the day control then shows no selected segment [Proposal]. `Empty workout` is the last row [Proposal].
- **Clash warning** [Ben]: one line on the card when the chosen session clashes with the week: `! Long run Saturday: legs fit better Thursday`. From the weekflex run rule (CHANGELOG 2026-10-20), so it only fires on runs Ben logged or told the coach. Never blocks Start.
- The card's workout **is the builder draft** (§4.4): Edit, Start and the builder all use the same draft, so edits made in the builder show on the card, which then shows `Edited` under its minutes (review 23 Oct; was `Chest · Bench · edited`).
- **Edit opens Today's draft (22 Oct, design review V1/V2/V4/V6).** With a plan, `Edit` opens Your workout with exactly what the card shows: day, time, minutes, supersets (including any fit-to-time added), exercises, sets, reps and kg, and any today-only changes (main lift, Mix it up, abs). It never opens Set up or a different fixture. ~~Back returns to Today with the card unchanged.~~ `‹ Today` returns to Today with whatever Ben changed there on the card (`Edited`; review 23 Oct, D3). Start from there goes straight to the active workout. `Open in builder ›` on a plan day does the same with that day for the week being viewed.
- **One main-lift format (22 Oct, design review V1/V2/V4/V6).** The main lift reads `1 × 6 + 2 × 8 · 102.5 / 95` (top set + back-offs · top / back-off kg; dumbbells add `each`; back-offs from D4, Ben 22–23 Oct) on Today, in the builder, in the plan's day view and week sheet, and in the active workout header. A bodyweight main lift reads `3 × 8`. All values are targets.

#### 2.0.3 How the recommendation is made [Ben asked; steps Proposal]

Plain words, for Ben:

1. **Code drafts it.** Next plan day (adaptive Up next, after this week's runs rule) → that day's template, with the variation last used → loads from history (§3.1) → fitted to his usual length (§3.6) → active `From last review` notes applied (a numeric note sets the load; `Include abs` adds abs).
2. **The coach reviews the draft**, with his goal, lift targets, recent RPE, pain flags and memories. It speaks only with a clear reason (rule 3), and **everything it suggests is an offer** (Ben, 22–23 Oct, D2; supersedes "a small change is applied"): one line on Today's card and on Your workout, `✦ Bench 102.5 → 100? Apply ✕` or `✦ Swap Cable fly for Incline press? Apply ✕`. Nothing changes until Apply; Apply changes today's draft only, with an Undo toast; ✕ skips it (Undo brings the line back). The reason is behind `Why?` (Today) or a tap on the line (Your workout). Start ignores a pending offer.
   - **An offer reads against the draft as shown (rule 5; review 23 Oct).** It carries the value it changes from (`Cable fly 3 → 2`). Once the fit (a new Time) or Ben changes that exercise so it no longer reads that way, the line is withdrawn on Today and on Your workout alike; an Apply that arrives stale is refused with `Out of date` and nothing changes. Apply changes only that value on the draft as shown: nothing is refitted around it. A load offer (`Bench 102.5 → 100`) lowers the back-offs by the same % (§3.1 item 9). Prototyped: `Cable fly 3 → 2 sets?`; the Bench load offer is spec only.
3. **Code checks every number**: loads this gym can make, equipment min/max, pain flags, limits (rules 4, 9).
4. **Based on shows it**: the facts code used, plus the coach's one-line reason when it changed something. If no coach review happened, the last line says so (`Not reviewed · Offline`).

Picking another day or session type drafts that one the same way (steps 1, 3, 4); the coach reviews it once, on first pick, when online. The coach review runs when a draft is made or its inputs change (a workout or activity logged, the plan changed, a new day), not on every visit; the result is stored with the draft [Proposal]. This means Today now makes a background AI call, which today.md said it never did.

#### 2.0.4 States

| State | Behaviour |
|---|---|
| Normal | As the wireframes. The plan's next day selected, `NEXT` under it, its last-used type selected |
| Loading | The code draft is local, so the card shows at once. No spinner; the coach's review, if it has anything, arrives later as one offer line (D2, Ben 22–23 Oct), and the card never moves under a finger: if Ben has touched the card in the last 2 s it waits [Proposal] |
| Offline / AI unavailable | Card = code draft. Based on ends `Not reviewed · Offline` or `Not reviewed · Coach not connected`. Coach bar shows `Offline`; in the coach sheet, Set up words still fill the builder (§2.6) |
| Other day picked | Card shows it (D3: rows always shown; no type chips); no `plan day N of 4`. Tapping the `NEXT` segment goes back. Each day keeps its own edited draft [Proposal]. [Ben, 20 Oct: "if you changed the session today it would change the calendar plan which it should"] The week's planned days reflow straight away in the strip: the skipped day moves into the next lifting slot in plan order (legs never the day before a long run), and the card's sub-line says so, e.g. `Chest moves to Thu`. Committed when the session starts; Up next is credited by what Ben does (§4.2) |
| One type only | No chips; the card name still shows the main lift (`Legs · Squat`) |
| From `⋯` | Card shows that workout (`Push`, `Hotel shoulders · 17 Oct`); no segment selected |
| Clash | One `!` line (above); Start still works |
| Coach offer pending | One `✦` offer line on the card, above Time; Start ignores it (starts without it). Withdrawn once the fit or Ben changes that exercise (§2.0.3) |
| Edited on Your workout | Card shows the edited draft with `Edited` under the minutes (review 23 Oct; was `Chest · Bench · edited`); Start = the edited draft, straight away (D1: no Start prompt; the Summary may ask `Keep for next time?`, §2.8); Edit reopens it with every control and edit; Time refits around Ben's edits (FT5). Picking another day keeps the edited draft for when Ben comes back [Proposal]. Going back to the plan's own version: Edit and Undo, or the controls back to the plan's (open, §9 Q-R7) |
| Workout in progress | Resume card replaces Today's session (today.md, unchanged); day control, chips and Build your own hidden; strip stays |
| Stale unfinished workout | today.md's stale card, unchanged |
| Done today | Card becomes `✓ Chest · 58 min ›` (opens Summary), no Start; day control and Build your own stay for a second session, no day selected |
| No plan | *(Rewritten 23 Oct, review S4; Ben 22 Oct, D7.)* Top to bottom: `No plan` and `Set up a plan ›` on one row; **a day row from Profile › Split** (the one split source without a plan, D7): `Chest NEXT · Back · Legs · Shoulders · ⋯` (NEXT = the Up next resolver's pick: Profile split, routines in rotation, else the longest gap; picking another day shows it, `Picked by you`, today only, and the suggestion moves on; `⋯` = Other workouts: Full body, Upper, Push, `Empty workout`, saved workouts; no chip row under the card). Then the `Up next` card (`Today` when picked): day, `N exercises · ~M min`, the main-lift line, and its own today-only controls: Main lift, Accessories, Time (fit note in light orange, the shared fit, D9), Abs, Supersets; **no `Today only` tag** (D1: edits are always today only), and `Start` (one tap; never the overview). Below: `Build your own` and `＋ Activity` side by side. With no split and nothing to resolve, `Build your own` is the primary. The no-plan card keeps its controls (D3 is about Today with a plan). Back-offs use the band the Profile goal maps to (strength → Strength, muscle → Muscle, both → Balanced) [Proposal, review SP8]. **Pending Ben:** whether a split without an applied plan should show as plan days (review today-fix-21oct SP4) |
| Plan paused | Day control shows the paused plan's days, none marked `NEXT`; `Plan paused` under the label |
| First use | Strip shows today only; as No plan |
| Large Dynamic Type | Strip as a list; day control as a `Day` row; chips wrap |

#### 2.0.5 Interactions

| Action | Result |
|---|---|
| `Start` | Starts the card's workout as is (check-in sheet when due). No builder, no overview |
| Tap a day segment | That plan day on the card (its own edited draft if Ben edited it today). VoiceOver: tab `Chest, next, 1 of 5` |
| ~~Tap a type chip~~ | ~~That template or variation on the card, collapsed~~ (D3: no chips on the lean card) |
| `⋯` | Other workouts sheet; a row puts it on the card; `Build your own` → Set up |
| ~~Tap card~~ | ~~Expand / collapse~~ (D3: rows always shown; the card isn't a button) |
| `Edit` | Builder, Your workout (page 2) with this draft, its controls and Ben's earlier edits. `‹ Today` returns to Today with what he changed there on the card (`Edited`); nothing changed, the card is as it was (review 23 Oct; supersedes "Back returns to Today unchanged", 22 Oct) |
| `✕` on a review note | Note off for today; toast `Note hidden · Undo` |
| `Undo` on a coach line | Restores the code draft value (versioned, rule 5) |
| `Build your own` | Builder Set up, Day = the card's day |
| `＋ Activity` | The existing Activity sheet (weekflex) |
| Tap a day | Day sheet. Past: workouts (`Shoulders · 58 min`, tap → its Summary) and activities (`Run 12 km · 1:02 · easy`, tap → edit). Planned day: `Move or change (coach)` opens the coach with the day named, which returns `propose_week` (before/after, Apply, Undo). Planned run: `Edit`, `Mark done` |
| Coach bar / mic | Coach sheet. A set-up request ("legs, 45 min") opens the builder Set up filled (`fill_setup`, Undo toast). "Long run Saturday" → `log_activity`. "Swap Thursday and Friday" → `propose_week`. Questions answer in the sheet |
| Swipe | None on Today (no swipe between days; the segments are the only way) |

#### 2.0.6 Copy

`Ask the coach` · `Today's session` · `NEXT` · `⋯` (VoiceOver `Other workouts`) · card `Chest` / `5 exercises · ~47 min` (the minutes are an estimate; D3, was `Chest · Bench` / `… · plan day 1 of 4`) · `Edited` · `Start` · `Edit` · `Target` (list header; every list value is a target) · `From last review` · `Based on` (dated lines are actuals, `target` lines are targets) · `Not reviewed · Offline` · `Other workouts` · `PPL day` · `Recent · 17 Oct` · `Build your own` · `＋ Activity` · `Move or change (coach)` · `Planned` · `Close`. No plan line, no run counter [Ben]. Est. 1RM never appears on Today (only behind `Why this weight?`, labelled estimate).

#### 2.0.7 Data needed

`planUpNext` + the weekflex run rule (`NEXT`); `planRoutines` + variations per (splitDayId, mainLift) for the segments and chips (§4.2, §4.3); `checkScheduleConflicts` (clash line); Ben's activities (only those he logged or told the coach) and finished sessions for the strip; recent non-plan workouts and the Profile's other split for `⋯`; week plan (`propose_week` results); `buildFromSetup` / `applyVariation` / `fitPlanToMinutes` / `estimateBuilderMinutes` / `snapPlanToGym`; load sources (§4.1); day notes; `shouldAskCheckIn`; Resume via `estimateRemainingDuration`. New [Proposal]: `buildTodayWeekView` (7 cells, items, planned flag), `buildTodaySessionPicker` (days, `nextDayId`, types per day, other workouts) and `buildRecommendationView` (draft, `basedOn: BasedOnFact[]` from code only, `coachLines`, `reviewStatus: 'reviewed' | 'offline' | 'not_connected' | 'pending'`). The coach review uses `review_workout`'s fact checks; **every change it suggests before Start is an offer** through `propose_workout_edit` (D2; carries the draft version and each changed value's `from`, so a stale Apply is refused, rule 5), never an applying tool. `set_next_session_targets` stays for the Summary's next-session targets only (CLAUDE.md rule 3). *(Review 23 Oct: was "small changes go through `set_next_session_targets`", which applied them.)*

#### 2.0.8 Acceptance checks

1. Airplane mode: Today shows the card, `Start` logs a first set with no network; Based on ends `Not reviewed · Offline`; no coach text anywhere.
2. From cold open to the first set: 1 tap on Start (check-in not due).
3. *(D3; was the collapsed card.)* The card shows the day, `N exercises · ~M min`, the rows, Time, Start and Edit; no `plan day N of 4`, no type chips, no Main lift / Accessories / Abs / Supersets controls.
4. Every `Why?` line matches stored data (dates, actuals, targets). A coach line appears only as an offer (`✦ … ? Apply ✕`, D2) and changes nothing until Apply; Apply changes only that value, and Undo restores the code draft value. Once the fit or Ben changes that exercise, the offer is gone on Today and on Your workout.
5. A coach structural change is never applied without `Apply`.
6. Strip: done items are a filled soft-green pill (no ✓), planned ones a dashed outline and `Planned` in VoiceOver; a run logged in the Activity sheet appears at once. With no activities logged or told to the coach, no run appears anywhere on Today.
7. With a long run Saturday logged, picking Legs on Friday shows the `!` line; Start still works. Without it, no line.
8. Picking another day, type or `⋯` workout changes no plan data; doing Shoulders today moves Up next past Shoulders.
9. *(D3; was 3 type chips on Today.)* Chest with Bench and Incline: Today shows no chips; Your workout from Edit shows `Main lift (Bench) (Incline)`; Legs with one main lift shows no Main lift row.
10. ~~Edit, change one exercise, back to Today: the card shows `Chest · Bench · edited`, and Start shows the §2.8 prompt.~~ (D1, Ben 22–23 Oct) Edit, change one exercise, Start: the workout starts with no prompt; after Finish the Summary shows `Keep for next time?` listing that change. Changing only Time never shows it.
11. With a workout in progress, the Resume card replaces Today's session and is one tap.
12. Segments, chips and buttons ≥ 44 pt; loads and times tabular; the strip and day control become lists at accessibility sizes.

#### 2.0.9 What it replaces in today.md (superseded, not deleted)

| today.md | Today (v2) |
|---|---|
| Header date | Day title (GymChip kept) |
| Up next card + fact line `After Pull A on Wed 14` | Today's session: day control (`NEXT`), type chips, card + `Based on` |
| Rotation notes (rule 12 run window, same-day hint) | Clash `!` line |
| Alternatives row (`Other routine`, `Empty workout`, `Build a workout`, `Shorter session`) | Day control, `⋯` Other workouts (incl. `Empty workout`), `Build your own`; shorter = Edit or the coach ("45 min") |
| This week / Recent (18 Oct) and `Then:` row | 7-day strip |
| Floating Ask pill | Coach bar + mic |
| Tap card → Workout overview | Tap card expands; Edit → builder |

Unchanged: Resume card, stale card, check-in line, pain check line, banners, check-in on Start. today.md gets a superseded banner when Ben approves.

### 2.1 Entry points

| From | Opens | Tag |
|---|---|---|
| Today, session card `Start` | Starts the workout directly (no builder) | [Ben] |
| Today, session card `Edit` (plan in use) | Your workout, for the chosen day and type (on open: the next plan day, with the type last used for that day), loads from history | [Ben]; last-used type [Proposal] |
| Today, `⋯` row, then `Edit` | Your workout, for that workout | [Ben] |
| Today, `Build your own` (below the card or in `⋯`) / no plan | Set up, Day = the card's day | [Ben] |
| Coach (Today bar, or chat) "build me a push workout" | Set up, filled from the words (§2.6) | [Ben] |
| Coach sheet, workout card `Open ›` | Your workout, the coach's draft (`‹ Back`) | [Ben, 22 Oct]; Your workout vs Set up open (§7) |
| Coach sheet, a saved workout | Your workout, that workout (`‹ Back`) | [Ben, 22 Oct] |
| Library › Workouts, a workout row | Your workout, that workout (`‹ Library`) | [Ben, 22 Oct] |
| Library › Workouts › History, a past workout (do again) | Your workout, that workout as done (`‹ Library`) | [Ben, 22 Oct] |
| Library › plan day, `Open <name>` | Your workout, that day (`‹ Library`) | [Ben, 22 Oct]. Renamed from `Start <name>` (the button opens Your workout; Start is there) (22 Oct; relayed by the PM as Ben’s decision, pending Ben’s confirmation) |
| Exercise detail, `Used in` row | Your workout, that workout (`‹ Back`) | [Ben, 22 Oct] |
| Summary, `Saved · <name> ›` | Your workout, the saved workout (`‹ Summary`) | [Ben, 22 Oct] |
| Up next with no plan (`next` target) | Your workout, the routine or last workout's next session. Built in the service; no screen uses it yet | [Ben, 22 Oct] |
| Coach chat, `Apply` on a change for the next workout (`Swap fly for crossover next Chest`) | Nothing opens. The change lands on that workout's Your workout draft as today-only edits (author `coach`, one action ID), shown there and on Today's card when that day comes up, each with Undo. The plan day and saved workout don't change, and the Summary's `Keep for next time?` doesn't list coach edits (only Ben's own, §2.8); "from now on" is a template proposal (change-review). A draft that changed since the proposal refuses it (`Out of date. Ask again.`, rule 5). **Where it waits (review 23 Oct SP5, proposal for Ben):** applied days ahead, there is no draft yet, so it is stored as a pending coach `TodayEdit` on that plan day (template ID, main lift, template version, action ID). When that day's draft is first made (Today or Your workout) it is replayed with Undo, if the template version, main lift and the exercise it names still match; otherwise it isn't applied and Today shows once `Coach change for Chest out of date` (with `Why?`). A `Keep for next time?` Apply or a plan edit that lands first makes it stale the same way; it expires once that plan day is done or after 14 days. **Spec only: no prototype lands a chat change on a later Your workout (review S8).** | Ben, 22–23 Oct (D8). Rebuilds `propose_next_workout_change` (CHANGELOG 2026-10-22, B3) |
| Reopen today after leaving (or a force-close) before Start | The same unstarted workout, with every edit kept | [Proposal] |
| Resuming a workout in progress | **Never** the builder (unchanged) | — |

**Your workout is the only pre-start page (Ben, 22 Oct).** The Workout overview (`WorkoutOverviewScreen`, route `WorkoutOverview`) is retired. Every row above that opens a workout before Start opens Your workout. Its gym chip, `done by` time, `↑ UP` / `SAME` / `↑ REPS` arrows and `after …` header are not carried over. Loads are still rounded to the gym and capped at a machine's max, with nothing shown (rule 4). See CHANGELOG 2026-10-22 and `docs/reviews/retire-workout-overview.md`.

**What the overview had that Your workout now has too.** A Time control to shorten the workout before Start (§2.3; Ben, 22 Oct: "add option to reduce time"). Also built, relayed by the PM as Ben's decisions on 22 Oct and **pending Ben's confirmation**: cardio, timed sets and the same exercise twice show and start exactly as the saved workout has them (no `N left out` for them; §2.3); `How to` and `History` in the exercise pop-up (§2.4); the `May hurt` confirm before a swap or `Add anyway` (§2.5); the plan-day button renamed `Open <name>` (§2.1).

[Ben, 20 Oct] Today's session card keeps a one-tap `Start`; `Edit` opens the builder (§2.0). ~~Tapping the card expands it~~ (D3: rows always shown). Active `From last review` notes are already applied in the draft (§2.0.3), so a one-tap Start never skips them.

### 2.2 Set up [Ben]

```
┌──────────────────────────────────────────┐
│ Set up                                   │
│ ┌──────────────────────────────┐ ┌────┐  │
│ │ ✦ Describe the workout       │ │ 🎙 │  │
│ └──────────────────────────────┘ └────┘  │
│ ┌──────────────────────────────────────┐ │
│ │ Day                      Chest     › │ │
│ │ Main lift          Bench press     › │ │
│ │ Variation             Standard     › │ │  only when variations exist
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
│ │ Recommended for 60 min · 7           │ │  only when Total ≠ recommended
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │          Next: exercises             │ │  primary, above home indicator
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

| Row | Behaviour | Tag |
|---|---|---|
| Day | Sheet: `Your split` (Profile split days) first, then `Push / Pull / Legs`, then `Custom`. Each split option shows its parts (`Chest, triceps`) | [Ben] |
| Main lift | Sheet: the day's main lifts (the first is `From Profile`), plus `None`. Custom: compound lifts of the chosen groups, plus `None`. The main lift counts as one of its own group's exercises | [Ben] |
| Variation | Sheet: `Standard` + this day and main lift's saved variations. Picking one loads it on Your workout. Each row has `⋯` → `Rename` / `Delete` (`Deleted arms superset · Undo`) | Picking on Set up [Ben]; row placement and rename/delete [Proposal, Q3] |
| Length | Any minute, ±1 per tap; hold repeats. 15–180 min | ±1 [Ben]; bounds [Proposal] |
| Supersets | Switch; on = the builder pairs exercises (§3.5) | [Ben] |
| Muscle groups | Recommended for day + length + supersets; ± per group; `＋ Add muscle group`; once edited, the `Recommended` tag becomes a `Use recommended` link. **Broad groups (Ben, 22–23 Oct, D5): `Chest`, `Back`, `Shoulders`, `Legs`, `Arms`, `Core`.** Legs is one group; rear delts count as Back. Max 4 exercises per group (5 for Legs: [Proposal], review N7) (extras go to the other groups); the recommendation is at most 7. Within a group the day sets the pick order: Legs quads → hamstrings/glutes → quads → calves; Arms triceps first on pressing days, biceps first otherwise; Back rear delts first on shoulder and push days. A part Ben names in the Set up chat (`legs, add hamstrings`, `chest, add triceps`) is +1 on its broad group, and the exercise added comes from that part first (review 23 Oct: picking by broad group never overrides a part he named). The Add and Swap sheets pick by the same groups, with focus headings inside (`Quads`, `Hamstrings & glutes`, `Calves`) | [Ben]; D5 [Ben, 22–23 Oct]; pick order and named part [Proto] |
| Next: exercises | Builds Your workout, or returns to it (§2.3, Back to Set up) | [Ben] |

States: **normal**; **custom, empty** (`Next: exercises` disabled, hint `Add a muscle group`); **template loaded** (rows show the template; groups come from its exercises) [Proposal]; **custom day with only some leg parts** (row reads `Legs`; exercises come only from the chosen parts) [Proposal]; **offline / coach not connected** (bar shows `Offline`, §2.6).

### 2.3 Your workout [Ben]

```
┌──────────────────────────────────────────┐
│ ‹ Set up                                 │
│ Chest · about 58 min                     │
│ Time · −1 exercise ›     [−] 45 min [+]  │  22 Oct: note only with a live fit
│ FROM LAST REVIEW                         │
│ │ Include abs                       ✕ │  │
│     Exercise              Sets  Top set  │
│                                   (kg)   │
│  1  Bench press           4     100      │
│     Chest, front delts…   +4 W           │
│  2  Incline DB press      3   30 each    │
│     Upper chest, front…   +1 W           │
│ ┌─────────────────────────────────────┐  │
│ │3a Cable fly             3      20   │  │  superset box,
│ │ │  Chest                            │  │  connecting line a→b
│ │3b Cable crunch          3      45   │  │
│ │    Upper abs                        │  │
│ └─────────────────────────────────────┘  │
│  4  Assisted pull-up      3  25 assist   │
│  ＋ Add exercise                          │
│ ┌──────────────────────────────┐ ┌────┐  │
│ │ ✦ Ask the coach to change it │ │ 🎙 │  │
│ └──────────────────────────────┘ └────┘  │
│ [          Start          ] Coach review │
└──────────────────────────────────────────┘
```

- Title `<Day> · about N min` (§3.6). Numbered rounds 1, 2, 3; a superset is one box lettered `a, b, c` with a connecting line. Columns `Exercise | Sets | Top set (kg)` [Ben].
- **Time (Ben, 22 Oct: "add option to reduce time").** Under the title, the same `[−] 45 min [+]` stepper as Today's card (5-min steps, 15–180). Each step fits **today's draft only** with Today's built-in fit (`fitToMinutes`, shrink only; no coach call, works offline): shorter rests first, then accessory sets (never below 2), then whole exercises (abs and exercises with no builder group first, compounds last), never the main lift. No superset is made (Supersets off is a hard rule, design review V14), no effort is pushed and kept sets keep their own RPE, and no load changes. Every step fits from the workout as it was before the first Time change, so more time brings back what it cut, up to that workout and never more; Ben's edits made after a fit stay. With a live fit a short note follows the label in light orange: the biggest change (`−1 exercise`, else `−2 sets`, else `shorter rests`); a tap shows everything it changed (`Shorter rests`, `Incline DB press 3 → 2 sets`, `Dropped Triceps pushdown`) and `Undo`, which puts that workout back in one step (at the length before the first Time change). Start creates the fitted workout; the saved workout and the plan never change: on a plan day the Start prompt and `Update … in your plan` ignore the cuts and keep the plan day's own length (the length before the first Time change), never Time's. Built 22 Oct; how this differs from fit-to-time.md's 22 Oct revision is listed there.
  - **After a fit [Proposal; review fixes 22 Oct, not Ben's decisions].** `Undo` goes back to the length before the first Time change. An exercise Ben edits after the fit trimmed it (an RPE, a rep) keeps his version at every shorter length: less time never gives it sets back or makes it longer, and nothing else is cut harder to pay for it. What the fit took from it stays in the detail (`Lateral raise 4 → 2 sets`) and comes back at the length before the first Time change, or with `Undo`, never past the original count (re-review R1, 22 Oct). An exercise the fit left out that Ben adds back himself doesn't come back a second time and drops out of the detail. `‹ Set up` with Length left as shown merges the change into the workout and fits it to Time again (note and Undo stay); a new Length there is the set-up's length and ends Time. A new Day or Main lift with Length left as shown builds at the set-up's own length and fits it to Time again, so more time brings the work back (re-review N10, 22 Oct). `Gym changed` moves the workout and fits it to Time again at the new gym (its Undo puts the old gym and the fit back); the exercises it swaps in for ones the gym lacks aren't Ben's edits, so Time can still trim or leave them out (re-review R2, 22 Oct). An applied coach version keeps shortened rests with their note and Undo (`shorter rests`); if it sets its own length while Time is in use, `Update … in your plan` still saves the set-up's length from before Time (Time and the coach's version are today-only; part of SP2, pending Ben; re-review N11). `Reload` starts again without a fit. A past workout opened with `do again` protects the main lift the WL9 rule picks (fit-to-time §4.2).
  - **Ben, 22–23 Oct (D9, D1).** Your workout's Time uses the same shared fit as Today (fit-to-time.md's 22 Oct revision): superset pairing only when Supersets is on, the cheapest cut by training lost per minute, the carry-over offer. The "not built" list in fit-to-time.md is now the plan. With no Start prompt, "the Start prompt and `Update … in your plan`" above reads: `Keep for next time?` on the Summary never counts Time's cuts, and Apply keeps the plan day's own length.
  - **Open, pending Ben (re-review 22 Oct).** A draft from Today's `Edit`: Your workout's Time works on the draft as Today committed it (less time cuts it; `Undo` and more time bring back Today's version, never the plan day's full workout; SP6). A workout already over its length: `⚠ Over` shows whenever the estimate passes Time, but stepping back up to the length it opened at gives back the over-length workout, not a fit to that length (S2).
- **Cardio, timed sets and an exercise twice (22 Oct; relayed by the PM as Ben’s decision, pending Ben’s confirmation).** A library or past workout opens with them as saved: a timed or cardio set shows its time (and distance) where the top set would be (`0:45`, `20:00 · 5,000 m`) and counts its time in the estimate; each copy of an exercise listed twice is its own row. Start creates them exactly as saved. Their sets aren't typed over, retyped, ramped or given drops here (set count, delete, move, swap and remove still work). `N left out` now covers only an exercise the app can't find, a set with no target, a set with both reps and a time or distance, or a workout past the builder's limits.
- Units [Proposal]: the header carries Ben's unit once. A row whose equipment uses the other unit shows it inline (`45 lb`). Per dumbbell shows `each`, assisted `25 assist`, bodyweight `BW` or `BW+10`, no history `—`.
- `+N W` under Sets counts warm-ups. Each exercise has a `works` line (`Chest, front delts, triceps`) [Ben].
- `Top set` is a **target**, never an actual. Loads use tabular numerals.
- [Proposal, Q14] A small `MAIN` tag on the main-lift row. Off unless Ben wants it.
- `Start` is disabled when the workout is empty [Ben]. Start and Coach review sit in the bottom bar, always visible.
- **Opened from Today's Edit or a plan day's `Open in builder ›` (22 Oct, design review V1/V2/V4/V6):** no `‹ Set up` link and no step counter; the only back control is `‹ Today` / `‹ Library`. The same holds for every other entry in §2.1: `‹ Summary` from the Summary, `‹ Back` from the coach sheet or an exercise's detail (there is no Today or Library to name) [Proposal, review S3 22 Oct]. The title's minutes match what Today or the plan showed, and edits change them from there. The top set shown equals the draft's; back-offs never exceed it (matters in deload weeks).

| Gesture | Result | Accessible alternative |
|---|---|---|
| Tap row | Exercise pop-up (§2.4) | Same (VoiceOver activate) |
| Swipe left | Reveals `Delete` → tap: toast `Deleted Cable fly · Undo` | VoiceOver action `Delete`; pop-up `Delete` |
| Swipe right | Reveals `Swap` → Swap pop-up (§2.5) | VoiceOver action `Swap`; pop-up `Swap exercise` |
| Press and hold (~320 ms, light haptic), then drag | Drop on the top or bottom edge of a row = move there; drop on the middle of a row = superset with it | Pop-up `Move up` / `Move down` / `Superset with next` / `Unlink`; VoiceOver actions with the same names |

- **Drag vs scroll:** a finger that moves more than 8 pt before the hold fires is a scroll (vertical) or a swipe (horizontal). Only a still hold starts a drag. During a drag the list doesn't scroll by itself, except near the top or bottom edge, where it scrolls slowly [Proposal].
- [Proposal] Drag ships **after** the pop-up buttons and VoiceOver actions, as its own step tested on Ben's iPhone (§8 S4b). Until then, the pop-up does moving and pairing.
- The main lift can't join a superset (Q5), and a superset holds at most 4. An invalid drop does nothing and the row springs back [Proto].

**When Ben's own change is not recommended** [Ben: the coach says so with the reason; his change stays, with Undo]:
- Drag, swipe or pop-up [Proposal]: a fixed check (works offline) shows a toast: `Not recommended: both work your lats · Undo`. `Why?` opens the one-line reason.
- Chat on Your workout: the coach's reply gives the reason, the proposal line carries `⚠` and the reason, `Apply` still works, and Undo follows.

**Back to Set up** keeps the edits on Your workout [Ben]. [Ben, "agreed" 20 Oct] Length, Supersets and group changes **merge** into the edited workout: a length change trims or adds sets, a group count change adds or removes only that group's exercises, and Supersets re-pairs only pairs the builder made (Ben's own pairs stay) [pairs detail Proposal]; every other edit is kept. A change of Day, Main lift or Variation builds a **new workout**: `Next: exercises` shows `Rebuilt · Undo`, and Undo restores **both** the previous set-up and the previous workout [Proposal].

**States**

| State | Behaviour |
|---|---|
| Normal | As above |
| Empty | List shows `＋ Add exercise`; Start disabled |
| From template | Opens with no rebuild |
| Doesn't fit | Even at the minimum (§3.6) the estimate exceeds Length: title `Chest · about 26 min` with `⚠ Over 20 min`. Start still works |
| Load unknown | `—`; pop-up shows `Start light` |
| Pain-flagged exercise | `May hurt` tag; no load heavier than last comparable (rule 9) |
| Pain check-in after loads were set | Loads for the flagged movement are recalculated (held). Kg Ben typed stays, with `May hurt` |
| Gym changed | Every calculated load is re-rounded down for the new gym. A typed kg is kept if that weight exists there, else recalculated. Exercises this gym doesn't have are swapped for the closest one it has, marked `Swapped`; with none, the row shows `Not at this gym`. One toast `Gym changed · Undo` restores the gym and the workout |
| Plan day updated elsewhere while open | No edits yet: reloads silently. With edits: line `Chest · bench changed · Reload` (Reload has Undo) |
| Plan paused or ended while open | Start still works (today only, D1). Paused: the Summary's `Keep for next time?` still shows; ended: it doesn't (§2.8). *(Was: `Today only` / `Save as new variation` still work, `Update … in your plan` hidden; superseded by D1.)* |
| Unstarted edits from an earlier day | Line `Edits from Mon 19 Oct · Use` (Undo). They're deleted after 14 days |
| Offline / coach not connected | §2.6 |

### 2.3a Today's controls on Your workout (Ben, 22–23 Oct, D3)

**Purpose.** Change today's session the way Today's card used to (main lift, accessories, abs, supersets) without building a new workout. Opened from Today's `Edit` with a plan. Primary action stays `Start`.

```
┌──────────────────────────────────────────┐
│ ‹ Today                                  │  one back control
│ Chest · about 47 min                     │  estimate
│ ┌──────────────────────────────────────┐ │
│ │ Main lift          (●Bench) (Incline)│ │  only when the day has 2+ main lifts
│ │ Accessories     (●Focused) (Varied)  │ │
│ │ Abs                            [ ●]  │ │
│ │ Supersets                      [ ●]  │ │
│ └──────────────────────────────────────┘ │
│ ✦ Cable fly 3 → 2 sets?    Apply   ✕    │  coach offer, only when there is one (D2)
│     Exercise              Sets  Top set  │
│  1  Barbell bench press     3   102.5    │
│ …                                        │
│ [          Start          ] Coach review │
└──────────────────────────────────────────┘
```

- **Layout.** A compact table under the title, rows ≥ 50 pt, chips and switches with 44 pt targets. Then the coach offer line (if any), then the workout table as §2.3.
- **Interactions.** A chip or switch loads Today's draft for that choice at today's Time, from the same draft and fit code as Today (D9, one shared fit), then the coach's applied offer and **Ben's earlier edits replayed on it** (review 23 Oct S3, FT5: a control change never quietly undoes them; was "replaces earlier manual edits" [Proposal]). Toast `Abs off · Undo` (`Main lift: Incline`, `Accessories: Varied`, `Supersets off`); Undo puts back the workout as it was. A coach offer Ben applied is kept across a control change while its exercise still reads as offered. Everything here is today's draft: `‹ Today` shows it on Today's card (`Edited`), and Edit reopens it (§2.0.2).
- **Coach offer line.** Shown while its exercise reads as offered (`Cable fly` at 3 sets); once Ben edits that exercise (sets, swap, remove) or a control loads a draft where it differs, the line is withdrawn; a stale Apply is refused with `Out of date` (rule 5).
- **`↻ Mix it up` (Ben, 23 Oct; was [Proposal], §9 Q-R6).** A fifth row here, under Supersets: `↻ Mix it up`. One tap swaps one accessory for a fresh one with the 20 Oct rules (never the main lift; on Varied an accessory repeating another's angle first, then the one done most lately on this day; same group, another angle, same role, here, not pain-flagged, not in the day's last two sessions, not already in the workout; least recently done first). An accessory with no fresh option gives way to the next. Code's pick, offline (no coach call here). Toast `<from> → <to> · Undo`; a tap with nothing fresh: `No other option`. Each tap mixes again from the workout as it now is (no `Another (1/3)` counter). Its swap is Ben's own (he tapped it), so it's listed by `Keep for next time?`. Built: `mixItUpPick` (domain), `builder.mixItUp` (one versioned write through Your workout's edit, op ID, stale refused). Not in the prototype.
- **States.** From Today's `Edit` with a plan: shown. From a plan day's `Open in builder ›`, Library, a past workout or Build your own: not shown (those have Set up or are fixed workouts). Offline: unchanged (no coach call). Supersets off: nothing is paired, ever (V14).
- **Copy.** `Main lift` · `Accessories` · `Focused` · `Varied` · `Abs` · `Supersets` · `Out of date` · toasts above. VoiceOver: "Abs, switch, on".
- **Data.** Today's draft per choice (`buildTodayDraft(planDay, {mainLift, style, abs, supersets}, minutes)` from the same domain function Today uses, then `fitToMinutes`); the template per choice and per main lift (`planDayTemplate(planDay, choice)`, un-fitted, before the deload and the coach); Ben's edits (`TodayEdit[]` with `author: 'ben'`: remove, add, swap, sets) replayed after the fit and the coach (`replayTodayEdits`); `structureChanges(template(mainLift), replayTodayEdits(template(choice), edits))` for §2.8.
- **Acceptance.** (1) With a plan, Today has no Main lift / Accessories / Abs / Supersets controls and Your workout from Edit has all four (Main lift only with 2+ main lifts). (2) Abs off on Your workout removes the ab exercise and splits its superset; Start; the Summary asks `Keep for next time?` with exactly `− Cable crunch`, at 60, 40 or 35 min. (3) Undo after a control change restores the rows, minutes, the control and Ben's edits exactly. (4) The rows after any control change equal what Today would draft for that choice at that Time, with Ben's edits on top. (5) Delete Cable fly, then Abs off: Cable fly stays deleted. (6) Edit → Abs off → `‹ Today`: Today's card has no Cable crunch and says `Edited`; Edit shows Abs off.

### 2.4 Exercise pop-up (full-height sheet) [Ben]

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
│ [            Done            ]  Delete   │
└──────────────────────────────────────────┘
```

- Per-set table `# | Type | Reps | Kg | RPE`. Reps, kg and RPE are **targets**. The `Kg` header shows the item's unit. Types: `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop`. One Top set per exercise: choosing Top set on another set turns the old one into a Back-off. A type change recalculates that set (§3.1) [Ben].
- Swipe left on a set → `Delete`, toast `Set deleted · Undo`; at least one working set stays (`Keep at least one set`) [Ben]. VoiceOver action `Delete set`.
- `＋ Warm-up` fills the biggest gap in the ramp (disabled at 4). `＋ Set` copies the last working set (disabled at 10 sets, drops included). At most 3 drop sets per exercise [Proposal].
- Rest per set type, 15 s steps (§3.2). If the exercise has a drop set: row `Before drop` (0:15). In a superset, one row: `After each round`.
- `Move up` / `Move down` / `Superset with next` (hidden when the next one is the main lift) / `Unlink` (in a superset) [Ben].
- `Why this weight?` (collapsed, numbers from code only): where the load came from (`Coach target`, `Plan, week 1`, `Last time + 2.5`, `Est. max 127 kg (estimate) · 6 reps @ RPE 8`), plus `Rounded down: 1.25 kg plates` or `Typed by you` when they apply.
- A saved or past workout's rep range shows as a range in Reps (`3–6`) and Start plans that range; editing that set's reps makes it fixed [Proposal, review R1 22 Oct; pending Ben (built; the PM relayed approval on 22 Oct, not yet confirmed by Ben)].
- `How to` and `History` links in the pop-up, where the overview's rows had them (22 Oct; relayed by the PM as Ben’s decision, pending Ben’s confirmation): `How to` when the exercise has a guide, `History` when Ben has logged it (that gym's item). The pop-up closes and the guide or the exercise's history opens.
- `Why this weight?` on a saved or past workout says what the overview said: `Saved workout`, its own rule's line or `Coach target`, plus `Held · pain` and the gym's fit (`Max here`, `Rounded down`) when they apply [Proposal, review R3 22 Oct].
- Editing: reps or RPE recalculates kg unless Ben typed kg in that set [Ben]. Assisted and weighted-bodyweight lifts keep their kg (no estimated max) [Proposal]. A typed kg rounds **down** to what this gym can load when the field closes; if it moved, the cell shows the new value and `Why?` names the item (rule 4).

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

- The group dropdown defaults to the exercise's group (Add: today's first group). Exercises are grouped by focus (`Upper chest` / `Mid chest`; `Lats` / `Mid-back` / `Rear delts`; `Quads` / `Hamstrings & glutes` / `Calves`; …), each with its `works` line. **No est. 1RM** [Ben].
- [Proposal] Lists only exercises this gym has. Ones already in the workout are hidden. Pain-flagged ones show `May hurt` and ask to confirm (rule 9), as the overview did (22 Oct; relayed by the PM as Ben’s decision, pending Ben’s confirmation): `Overhead press may hurt` · `Shoulder pain flagged 6 Oct.` · `Choose another` / `Swap anyway` (`Add anyway` when adding). The active workout's Swap sheet uses the same words.
- Swap keeps the position, superset, set count and set types; loads recalculate. Toast `Swapped · Undo`. Add appends 3 sets; disabled at 10 exercises.

### 2.6 Coach chat and voice [Ben]

- A bar on both pages: Set up `Describe the workout`, Your workout `Ask the coach to change it`, plus a mic button that **starts listening straight away**. The chat opens as a sheet over the page, never full screen.
- **Set up:** a message fills the set-up and **applies at once**, toast `Pull · 50 min · supersets on · Undo` [Ben].
- **Your workout:** a message returns a **proposal**: before/after lines (`Cable fly → Incline barbell press`, `Length 60 → 45 min`, `Bench press: 100 → 102.5 kg`), `Apply` / `Skip`; after Apply, `Applied · Undo` [Ben]. If an exercise it touches changed since, Apply shows `Out of date. Ask again.` and changes nothing (rule 5).
- When a coach proposal goes against the order or pairing advice (§3.8), the line carries `⚠` and the reason.
- Chat header status: `● Coach`, `Offline` or `Coach not connected`. Never a canned reply (rule 1).
- Voice is **on-device only** [Proposal]. If the phone has no on-device speech for Ben's language, the mic shows `⊘` (`Why?` → `Needs on-device speech`). Audio is never sent to a server without Ben saying so.

| State | Set up bar | Your workout bar |
|---|---|---|
| Connected | Chat fills the set-up | Proposals |
| Offline / not connected | Shows `Offline`. [Proposal, Q4] Typing or speaking still fills day, minutes, supersets and groups directly, with the usual Undo toast. No chat sheet, no chat bubble; anything else: toast `Not understood` | Shows `Offline`, disabled; every manual edit still works |
| Listening | Mic filled, field `Listening…`, live words; stops on silence or tap | same |
| Mic or speech permission denied, or no on-device speech | Mic `⊘`; tap → reason, and a Settings link for permissions | same |

### 2.7 Keyboard [Ben]

- The field being typed is never hidden: it scrolls to sit above the keyboard and the keyboard bar.
- Keyboard bar: `Done` always; for set cells also `−` `+` `Next`. Steps: reps 1, RPE 0.5, kg = the next weight this gym can load for that item [Proposal]. `Next` goes Reps → Kg → RPE → next set.
- Tapping outside a field dismisses the keyboard. The sheet's `Done` stays visible above it.

### 2.8 Keep for next time? (Summary row) (Ben, 22–23 Oct, D1; replaces the Start prompt)

**Purpose.** After a workout whose structure Ben changed, ask once whether the next time that plan day (or saved workout) comes up it should look like this. **Primary action on the Summary stays `Done`**; this row is secondary.

**When it shows.** Only when **Ben himself** changed the workout's structure: an exercise swapped, added or removed, or a set count changed (on Your workout, or mid-workout). *(Review 23 Oct, B1 and SP1, proposal for Ben: replaces "differs from `base`, the plan day as drafted for today, Time cuts included", which listed the fit's cuts and restorations as his.)*
- **What it compares.** Ben's edits (`TodayEdit`s with `author: 'ben'`: remove, add, swap, set count) are replayed on the plan day's **template** for the controls he chose (Main lift, Accessories, Abs, Supersets), un-fitted, before the deload and before any coach change; the result is compared with the template for that main lift at the plan's own controls. A set count he chose counts as the number he chose (`Cable fly 2 → 3` in a deload week, or after the coach's `3 → 2`, is back to the template's 3, so nothing to keep).
- **His control choices count** (Abs off → `− Cable crunch`; Varied → its accessories and set counts). **Picking another main lift is picking that template** (`Chest · incline`), never a change to `Chest · bench`; the row then names it (`Kept for next Chest · Incline`) (review S1, SP7).
- **Never for:** Time or the fit (its cuts, what it gives back, the carry-over), pairing (Supersets on/off, the fit's re-pairing), a deload, loads, reps, RPE, rest, order, a coach edit (D2 offers, D8 next-time changes), or a workout with no plan day or saved workout behind it (Build your own, Empty workout, no-plan Today).
- **From a plan day's `Open in builder ›`:** the same, against that plan day (prototyped, review S6). **Mid-workout** structure changes count the same way; the prototype's Summary only sees changes made before Start (known prototype gap). **A saved workout** (`Apply` changes that saved workout only) is **spec only, not prototyped** (re-review 1, S4): the same comparison against the saved workout's own exercises and set counts, with no Time or fit involved.
- **A swap keeps the slot's set count** (re-review 1, R2). The exercise Ben swaps in takes the template slot's count, not today's fitted one, so a Time cut never rides into the plan through a swap. Only a count Ben sets on it himself counts, and the swap line then shows it (`Triceps pushdown → Overhead triceps extension · 3 → 4 sets`).

**Layout (Summary, after `Next time`, above `Edit` / `Done`):**

```
┌──────────────────────────────────────────┐
│ Keep for next time?        Skip  [Apply] │  48 pt row; Apply outline pill, 44 pt
│ − Cable crunch                           │  one line per change, text.secondary
│ Cable fly → Cable crossover              │
│ Incline dumbbell press 3 → 2 sets        │
└──────────────────────────────────────────┘
 Applied:  Kept for next Chest          Undo
```

**States and transitions.** Offer → `Apply` → `Kept for next Chest` + `Undo` (Undo → offer again). Offer → `Skip` → row hidden, toast `Plan unchanged`. Leaving the Summary with the offer untouched = Skip [Proposal, review N4: or keep the row on that workout's Summary in history until the plan day next comes up; Ben to choose, §9 Q-R5]. Plan day changed since the workout started → Apply refused with `Your plan changed`, and the row lists Ben's changes again against the new version (hidden if none are left) (rule 5; review N3: was `Your plan changed. Ask again.`, with nothing to ask). Undo refused if the plan day changed again since: `Changed since · can't undo`. Offline: works (no coach call). Plan paused: the row shows. Plan ended since the workout started: no row.

**Interactions.** `Apply` writes the change to that plan day's template for this main lift (or that saved workout) only, in one versioned write with an op ID; no other day, week or plan setting changes, and the plan day keeps its own length. `Undo` is a versioned inverse write. Voice: "keep it" / "skip" while the Summary is open (voice.md grammar, later).

**Copy.** `Keep for next time?` · `Apply` · `Skip` · `Kept for next Chest` · `Undo` · `Plan unchanged` · `Your plan changed` · change lines `− <exercise>`, `+ <exercise> · 3 sets`, `<from> → <to>` (only when Ben swapped that slot, review N5), `<from> → <to> · 3 → 4 sets` (when he also set its count, R2), `<exercise> 3 → 2 sets`. No explanations.

**Data.** `session.planDay` (planId, splitDayId, templateRoutineId, templateVersion, the chosen controls) or `routineId`; the session's `TodayEdit`s with `author: 'ben'` (before Start and mid-workout); `structureChanges(template(mainLift), replayTodayEdits(template(controls), benEdits))` (pure, `packages/domain`); `applyKeepForNextTime({ templateId, expectedVersion, changes, opId })` and its Undo. Apply writes the listed changes as absolute values (`Cable fly: 3 sets`), never deltas.

**Acceptance.** (1) Today Start with no edits → no row. (2) Time 60 → 45 then Start → no prompt at Start and no row. (3) Edit → Abs off → Start → Finish → row lists `− Cable crunch`; Apply → `Kept for next Chest`, only that template's version moves; Undo restores it. (4) A load or reps edit alone → no row. (5) A stale template → Apply refused, nothing written. (6) The row never replaces `Done` as the primary; 44 pt targets; works at AX3 without sideways scroll. *(Review 23 Oct, B1:)* (7) Time 45, Supersets off on Your workout → no row. (8) Time 40 or 35, Abs off → exactly `− Cable crunch`. (9) The coach's `Cable fly 3 → 2` applied on Today, then Cable fly back to 3 on Your workout → no row. (10) Deload week, Cable fly 2 → 3 → no row. (11) Main lift Incline → no row (another template). (12) Varied → `− Cable fly`, `+ Cable crossover · 2 sets`, `+ Dips · 2 sets`, `Incline dumbbell press 3 → 2 sets`. *(Re-review 1, R1 and R2:)* (13) From Today's Edit and from a plan day's `Open in builder ›`: `＋ Add exercise`, sheet Swap, swipe Swap, the coach chat's swap and a review suggestion each work with no error; from Edit, Today's card shows the change and `Edited`; the row lists `+ <exercise> · 3 sets` or `<from> → <to>`. (14) Time 40 (Triceps pushdown trimmed to 2), swap it → today 2 sets, row `Triceps pushdown → <to>` and Apply writes 3; set it to 4 → `… · 3 → 4 sets`. `check_app.mjs` covers 1–3, 7–10 and 12–14.

<details><summary>Superseded: the Start prompt (20 Oct)</summary>

Shown on `Start` when today's workout differs from the plan day it came from [Ben]. [Proposal, Q11] Load-only edits don't prompt, because loads come from history every week.

```
│ Use these changes for                    │
│ │ Cable fly → Incline barbell press    │ │
│ │ Add Hammer curl                      │ │
│ │ Triceps pushdown: 3 → 4 sets         │ │
│ [           Today only            ]      │
│   Update Chest · bench in your plan      │
│   Save as new variation                  │
│   Cancel                                 │
```

- `Today only` (primary): starts; the plan day is unchanged.
- `Update Chest · bench in your plan` (when a variation is open: `Update Chest · bench · arms superset`): saves and starts in one step, so a force-close can't leave half of it done. No toast on the first set. Summary shows `Chest · bench updated · Undo`.
- `Save as new variation`: a name field prefilled from the change (`arms superset`), then `Save and start` (one step, as above). At the variation limit (Q10) it's disabled, with `Limit reached`.
- If the plan day changed since it was opened, the update is refused: `Your plan changed. Today only?` (rule 5).
- Undo refuses if the plan day has changed again since: `Changed since · can't undo`.
- Not a plan day: no prompt [Proposal]. `Save to Workouts` stays in `⋯`.
- [Proposal] **Summary:** when the finished workout differed from its plan day (including a superset added mid-workout), Summary offers `Save as variation`.

</details>

### 2.9 Coach review (sheet) [Ben]

> (Ben, 22–23 Oct, D1) The Plan section's `Update plan day` is removed: changes before Start are today only. `Add back` stays. The suggestions below are Ben-asked (he opened the review), so Apply / Skip as before.

```
│ Coach review                   ● Coach   │
│ Balanced and varied                      │  verdict (coach)
│ ✓ Upper chest 6 ✓ Mid chest 7 ✓ Triceps 4│  counts (code)
│ · Abs                                    │
│ 2 compound · 4 isolation · free weights… │
│ PLAN · 4-day split · since 13 Oct        │
│ ✓ Chest is next (day 1 of 4)             │
│ ✓ 60 min (plan 60)                       │
│ ✓ Main lift Bench press                  │
│ ! 5 of 6 planned · missing Cable crunch  │
│ ✓ 16 working sets (plan 17)              │
│ │ Add back Cable crunch   [Add] [Skip] │ │
│ SUGGESTED                                │
│ │ Swap Cable fly for Incline barbell…  │ │
│ │ 3 exercises lead with mid chest      │ │
│ │                     [Swap]  [Skip]   │ │
│ FOR NEXT CHEST DAY                       │
│ ☑ Bench top set: 102.5 kg next (hit 8    │
│   last time)                             │
│ ☑ Include abs                            │
│ [            Done            ]           │
```

- Verdict line; ticks per core muscle with **set counts** (✓ trained, · missing; icon plus text, not colour alone); variety line; Plan section (is the day next, length, main lift, planned exercises kept/missing/added, working sets vs plan) with `Add back X`; suggestions, each with its own button (a proposal, Undo after); `For next <day> day` notes ticked by default, saved on `Done` [Ben].
- ~~`Update plan day` opens the same choice as §2.8: `Update Chest · bench in your plan` / `Save as new variation` / `Cancel`.~~ Removed (D1, Ben 22–23 Oct): changes before Start are today only; a structure change Ben keeps is offered on the Summary (§2.8).
- Each suggestion and `Add back` stays usable after another one is applied. It's only refused (`Out of date`) if an exercise it touches has changed.
- **Swipe down = Done:** ticked notes are saved [Proposal].
- Notes show at the top of that day's Your workout next time as `From last review`, each with ✕ [Ben]. They are **Your data** (rule 10). [Proposal] A note with a number in it (`Bench top set: 102.5 kg next`) is saved as the coach's target for that lift, so it actually sets next time's load (§3.1) and can be undone. Text notes (`Include abs`) are saved as notes.
- **The coach writes the verdict, suggestions and notes. Code works out and checks every fact** (counts, plan lines, numbers in the text) [Ben]. Offline / not connected: header `Offline` or `Coach not connected`; the counts, variety and Plan section (with `Add back`) still show; no verdict, no suggestions, no notes [Proposal, rule 1].

---

## 3. Rules (all fixed code, unit-tested)

### 3.1 Loads [Proposal, built on Ben's direction]

Ben's direction: every set's load comes from est. 1RM + reps + target RPE, rounded down to what the gym can load. Rules 3 and 6 add two sources that must come first. Proposal:

1. **Today's working load** for each exercise comes from the first source that has one:
   1. the coach's target for this lift (rule 3; shown on Summary with Undo, or saved from a review note);
   2. the plan's loads, on a plan day's first workout;
   3. the built-in progression rule, labelled, when there's no coach target (for example, no AI at the last Summary);
   4. est. max from Ben's own recent sets (labelled estimate) × the set's reps and target RPE;
   5. none: `—` and `Start light` (a safe cap for the machine, if any).
2. **Every other set** of that exercise (warm-ups, back-offs, drops, extra working sets) follows from the working load by reps and target RPE [Ben]. Example: bench top set 6 @ RPE 8 = 100; back-offs 8 @ RPE 8 = 95 [Ben].
3. **Rounded down** to what this gym can load: real plates and bar, dumbbell rack, stack steps, min/max. Never above a machine's max (rule 4) [Ben].
4. One Top set. Back-offs at their own reps @ RPE 8 [Ben]. Working sets: the lower end of the rep range @ RPE 8, last working set RPE 9 at the same load [Proto].
5. Drop set: reps = top of the range + 2, RPE 9, about 78 % of the previous set, rounded down [Proto].
6. Editing reps or RPE recalculates kg unless Ben typed kg; a type change recalculates [Ben]. Assisted and weighted-bodyweight lifts keep their kg.
7. Pain-flagged movement: no heavier than the last comparable working load (rule 9).
8. Est. max appears only behind `Why this weight?`, always `(estimate)` (rule 6).
9. Defaults [Proto]: main lift 3 sets (1 top set of 6 + 2 back-offs of 8; was 4, changed 22 Oct, design review V1/V2/V4/V6 so Today, the builder and the plan agree); isolation exercises 3 × 12, others 3 × 8–12. ~~**Open for Ben:** back-offs at about 90 % vs step 2's RPE rule.~~ **Decided (Ben, 22–23 Oct, D4):** back-offs are worked out from their reps and effort (training guide SS4: RIR-adjusted Epley from today's top set, top and back-offs @ RPE 8 as item 4), snapped **down** to an achievable load, and kept in a sanity band below the top: Strength 2–8 %, Balanced 4–10 %, Muscle 8–15 % (other focuses 2–15 %); never above the top load. If snapping lands below the band, the next achievable load up is used when that is inside the band. Not a fixed 90 % or 95 %. Example: top 102.5 × 6 → back-offs 8 reps compute 97.4 → snap down 95 (7 % below, inside Balanced): `1 × 6 + 2 × 8 · 102.5 / 95`. Top 100 → 95; squat 117.5 → 110; row 92.5 → 87.5; DB press 32.5 each → 30 each. Domain: `backOffLoad(top, topReps, backReps, focus, { topRpe, backRpe }, kit)`. **Open for Ben:** HT4's Epley vs Nuzzo's tables (training guide SS question 2); the prototypes use Epley.
   - **No achievable load inside the band (review 23 Oct B2; settled by the PM, 23 Oct: the nearest lighter achievable load).** Built as rounding down below the band's top edge, so it is never the top; tested on 2 kg dumbbell steps 20–30 kg in every focus. The "no load below the top: top load, 1 rep fewer" case isn't built (the back-off shows `—`).
   - *(Designer proposal, kept for reference:)* Coarse kit (dumbbells at 20–30 kg on 2 kg steps, sparse racks) often has none. Then: the achievable load **nearest the band that is below the top**, on a tie the lighter; **never the top itself** (a back-off at the top load for more reps is harder than the top set, against SS4). If no achievable load is below the top at all, keep the top load and do 1 rep fewer than the top set. Examples: Strength DB 24 × 7 each → 22 (8.3 %; not 24); Muscle DB 26 × 6 → 24 (7.7 %, nearer the band than 22 at 15.4 %); Balanced 22.5 × 6 → 20; Muscle 32.5 → 30.
   - **When today's top is lowered, the back-offs drop by the same % and snap down** (training guides SS4 and HT8; review 23 Oct: was "worked out again from the new top", which left them unchanged). Lowered = a pain hold (rule 9), a coach offer Ben applied (`Bench 102.5 → 100`), Ben's own lighter top, an R2 return offer, or a deload's −10 %. Bench `102.5 / 95` held at 100 → `100 / 92.5`; deload `105 / 97.5` → `92.5 / 87.5`. Always below the new top. Raising the top never raises them, except when the coach raised it: **(Ben, 23 Oct; batch23-loads SP2) when Ben asks the coach for a heavier (or lighter) top set, the back-offs follow it both ways by the same %** (step 2 wins over HT8's "raising the top never raises back-offs" here), still inside the D4 band's top edge, snapped down and never above the top. A top Ben types himself still never raises them, and typing one ends the follow. A repeat (the top stays where it was after a hard session) is not a lowering: the back-offs are worked out from that top.
   - **Which band (review 23 Oct S7, SP8).** With a plan, its Main focus, on Today, Your workout and the workout as on Your plan. With no plan, the band the Profile goal maps to: strength → Strength, muscle → Muscle, both or not set → Balanced (settled by the PM, 23 Oct; `mainFocusOf`).

Whether step 4 should replace steps 1–3 ("est. 1RM everywhere") is still open in the backlog: §9 Q12.

**Builder loads fix (21 Oct, PROPOSED, needs Ben's approval; not in CHANGELOG or ADR 0006 yet).** Ben's Build B report ("It knew my history but wasn't using it"). Branch `claude/builder-loads-21oct` changes steps 1–2 as below. It applies to every new-workout path: the builder, Describe the workout, and Today.

- **History can replace a stale anchor.** The built-in rule's load gives way to Ben's own sets when it implies an e1RM below 90 % of the est. max from his **last session** (`HISTORY_WINS_SHARE`; cut after a 14+ day gap, R1–R2). A miss, a reduction or a pain hold never gives way. A plan's week-1 load gives way the same way once history newer than the plan exists. The coach's target never gives way. The replaced load reads as `Est. max … (estimate)`.
- **What a rule load means.** For the test above, the rule's load is read at its own rep floor and target RPE (main barbell: 3 reps @ 8.5). Used as the top set, other sets derive from it at the reps and RPE it's used at (6 @ 8). If the rule gives way and the last session's est. max (gap-cut) is higher, other sets use that instead. A set of more reps is never heavier than the top set. Example: after top 100 × 6 @ 8 + back-offs 95 × 8, the next build is top 102.5 × 6 with back-offs at 95 × 8 (not 87.5).
- **Builder-format history.** A main lift logged as a top set + back-offs is judged on both and planned from the top set. Where the rule's plan is plain working sets (a routine's start, swaps, the coach-chat fallback), the first set takes the progressed top load. The rest take the back-off load moved by the same step.
- **Same-mass bars.** The rule reads history on any bar of the same kind and bar mass, as `loadReferences` does, in the builder, Today and swaps.

Open for Ben: the 90 % share; "last session" versus the best of the last 3 sessions; the reading of the rule load at its floor for the test.

**Reps from history (21 Oct, PROPOSED, needs Ben's approval; not in CHANGELOG or ADR 0006/0010 yet).** Ben's live Back workout: shrugs planned at 8 reps though he did 15 last time. Same branch. Applies to the builder, Describe the workout, plan days and ＋ New workout from Today, Start, swaps, adds and `get_progression_targets` (all read the built-in rule through `nextTargetsFor`).

- **The built-in rule's range follows his last session of that exercise** (typical reps = lower median of its working sets), for isolation and compound lifts: inside the goal range → the goal range; above it up to the rule's rep cap (isolation 15, compound 12) → `last − 3 … last` (15 → 12–15); above the cap → the top moves 2 reps a session toward the goal (20 → 15–18); below → `last … last + 3`; bodyweight follows his reps however high. Double progression then runs on that range. Why? fact: `Reps follow your last session (15 reps): 12–15.`
- **One planned rep count** (`aim`): after a load increase, the reps the new load allows at the same effort (Epley; 50 × 15 → 52.5 × 13); a hold repeats his reps; add reps = the rule's next rep; a miss or reduction = the floor.
- **Builder slots** (not the main lift) plan working sets at `aim`; the rule's load is used as is. Behind Why?: `Reps: last time 15` (or `· toward 8–12`).
- **Main lift**: top set / back-offs unchanged; Why? adds `Last time 12 reps · main lift 6–8` when his last reps were outside 6–8. A main barbell lift used as a secondary lift reads its rule as a compound lift's (a row after the main lift at his usual 12 → 9–12).
- **Ben's own rule** keeps its range.
- **A plan's week-1 load older than newer sessions** gives way to the rule (it plans from those sessions at his reps); before, it gave way only when more than 10 % lower.

Open for Ben: the width (3), the cap as "wildly outside", the 2-rep step, Epley for the reps after a load increase, the lower median as "his reps", and leaving main barbell lifts on 3–6.

### 3.2 Rest defaults [Ben]

| Set type | Default |
|---|---|
| Warm-up | 1:00 |
| Top set | 3:30 |
| Back-off | 3:00 |
| Working, main lift | 3:00 |
| Working, compound accessory | 2:00 |
| Working, isolation | 1:30 |
| Before a drop set | 0:15 |
| Superset, after each round | 1:30 |

- Each set's rest runs **after** that set. So `Before a drop set` is the rest after the set the drop follows, and the drop set itself then rests like a normal working set before the next exercise [Proposal].
- In a superset there's no rest between exercises inside a round; `After each round` is the rest after the round's last exercise [Proposal].
- Steps of 15 s. Where Ben has saved rest presets, defaults snap to the nearest one. Limits: Q7.

### 3.3 Warm-ups [Ben]

- Main lift: bar × 10 (barbells only, this gym's bar), then 50 % × 5, 70 % × 3, 85 % × 1 of the top-set load, each **rounded down**. A step no heavier than the one before is skipped. Max 4.
- Compound accessory: 1 warm-up, 60 % × 8 [Proto %]. Isolation: none.

### 3.4 Order [Ben]

Main lift first → compounds (on leg days alternate quad and hinge) → isolations → abs last.

### 3.5 Pairing (Supersets on) [Ben]

Never pair: the main lift [Proto, Q5]; two heavy lifts; abs with a heavy lift; two exercises that share a muscle. Abs pair with the last accessory that fits, then remaining single exercises pair in order. Quads, hamstrings/glutes and calves count as different muscles for pairing, but as one group (Legs) for counts.

"Heavy" [Proposal]: marked per exercise in the catalogue (prototype list: squat, leg press, RDL, hip thrust, Bulgarian split squat, barbell row, incline barbell press). Unmarked: any compound on a barbell or plate-loaded machine.

### 3.6 Time estimate [Ben]

`2 min setup + every exercise + 1 min between exercises`:
- solo exercise = warm-ups (each 30 s + 1 min rest, then +1 min after the last) + each set (45 s + its rest);
- superset = its warm-ups + rounds × (45 s per exercise + rest after the round).

Shown rounded as `about N min`. [Proposal, Q15] Today, the builder and the active workout's time left all use these same numbers, so they agree. Switch time between superset exercises: Q16.

**Doesn't fit** [Proposal]: the builder trims in this order: accessory sets to 2 (last first), then exercises from the end, then main-lift back-offs to 2. It never goes below the main lift (or 1 exercise when there's none). If it still doesn't fit, Your workout shows `⚠ Over 20 min`.

### 3.7 Volume and recommendations [Ben]

- Recommended count = the most exercises (max 7) that fit the length, with Supersets as set (3 sets each, main lift 4). The day's mix is scaled to that count, and the first group keeps at least one. Max 4 per group; extras go to the other groups. If it's still over, accessory sets drop to 2, last first.
- Day mixes [Proto]: Chest = Chest 4, Triceps 1, Abs 1; Back/Pull = Back 4, Biceps 1, Abs 1; Legs = Legs 5, Abs 1; Shoulders = Shoulders 4, Triceps 1, Abs 1; Push = Chest 3, Shoulders 2, Triceps 1, Abs 1.
- A Legs count is spread over the day's leg parts in order: quads, hamstrings/glutes, quads, hamstrings/glutes, then calves [Proposal]. A custom day with only some parts uses only those.
- Exercise picks per group come from Ben's history first, then the catalogue: only exercises this gym has, not pain-flagged [Proposal; the prototype uses a fixed list].

### 3.8 Advice ("not recommended") [Ben]

Fixed checks, each with a one-line reason and a fix:

| Case | Reason line | Fix |
|---|---|---|
| Isolation before a compound for the same muscle | `It tires your chest before the heavier lift.` | `Move <compound> first` |
| Superset of two heavy lifts | `Two heavy lifts back to back: both get weaker and form slips.` | `Unlink <b>` |
| Abs with a heavy lift | `Ab work between sets tires the bracing that protects your lower back.` | `Unlink` |
| Superset that shares a muscle | `Both work your lats, so the second one suffers.` | `Unlink` |

Advice never blocks or undoes Ben's change. He sometimes pairs things on purpose mid-workout.

---

## 4. Data model (developer)

### 4.1 Code map for §2–§3

| Spec words | Code |
|---|---|
| Rounded down to what this gym can load | `snapPlanToGym` (mode `start`, `loadDirection()`); applies to drops, warm-ups and typed kg too |
| Load sources, §3.1 steps 1–5 | (1) coach next-session targets (`set_next_session_targets`; Ben's lift targets, migration 0027, where active); (2) `PlanFirstLoads` (`session/coach-plan.ts`); (3) `nextTargetsFor` (`next-target.ts`, ADR 0006); (4) `checkProposedLoad` / `recheckDraftLoad` over `loadReferences` (handle assisted, added weight, gaps, pain); (5) `noReferenceCeiling` |
| Reps/RPE formula | `expectedLoad` / `referenceE1rm` (Epley, RIR = 10 − RPE), anchored on the working load from step 1 |
| Pain | `painFlagCovering`, `mayHurtConfirm` |
| Only exercises this gym has | `doableHere` |
| Fit to length | `fitPlanToMinutes` with the shared time constants (§4.7) |
| Limits | `BUILD_LIMITS`, `TRAINING_LIMITS` |
| Main lift options | `SplitDay.mainLiftExerciseId`, `TrainingProfile.mainLifts`, `mainLiftOptions` |
| Day notes | `MemorySchema` (Your data); numeric notes → next-session targets, not memories |

### 4.2 Templates, session provenance, Up next (B2, S12, S15)

- **Template:** a `Routine` with `planDay?: { planId, splitDayId, mainLiftExerciseId: Id | null, minutes: 15–180 }`. Unique per (planId, splitDayId, mainLift), enforced inside the write transaction. `minutes` feeds `plan 60` in the review.
- **Plan links:** `plan.applied` records every template it made (per main lift), not just one per day. `planRoutines` returns all of them. Plan Undo/End deletes only templates it made, **never variations**.
- **Session provenance:** at Start, the session stores `planDay: { planId, splitDayId, templateRoutineId, templateVersion, variationId | null }`. `planUpNext` credits days by (planId, splitDayId) and falls back to `routineId` for older sessions, so a `Today only` start (a draft with no routineId) still moves Up next on. Last-used variation per day = the newest session's `variationId`.
- **Existing plan routines:** the key is derived when read, never written on read: `splitDayId = createdFromPlan.splitDayId ?? split day at dayIndex`; `main ?? the split day's default main lift`. Rows with no derivable key stay ordinary routines.
- Tests: Up next moves after a `Today only` start; plan Undo keeps variations; two templates per day both appear in `planRoutines`.

### 4.3 Variations (B3)

- `PlanDayVariation { id, ownerId, splitDayId, mainLiftExerciseId | null, label: string(1–40), extras: VariationOp[], version, createdAtUtc, updatedAtUtc }`, keyed by (splitDayId, mainLift) and **not by plan**, so it carries forward to a new plan's template with the same key. Your data.
- `VariationOp` (discriminated union): `add_slot { after: exerciseId | 'end', slot }`, `pair { a, b }`, `remove_slot { exerciseId }`, `set_count { exerciseId, n }`.
- Opening a variation = the current template + its extras. An op whose anchor exercise is gone is skipped and shown on Your workout: `Not applied: Hammer curl with Cable fly · Add anyway`.
- `Save as new variation` stores the difference from the template; `Update … · arms superset` rewrites that variation's extras.
- Limit (if Ben agrees, Q10) checked in the write transaction.

### 4.4 Builder drafts (B4, S10)

- Staleness checks use **`WorkoutDraft.version`**, which every write bumps, manual edits included. Each slot also has `rev`; proposals and review suggestions carry `preconditions: { slotId, rev }[]` and are refused only when one of those changed.
- `DraftPlanSchema`: zero slots allowed while `status: 'open'`; `startWorkoutDraftIn` refuses an empty plan.
- Manual versions: `request.origin: 'builder'`, `actionId` = the manual op's opId, `contextHash` = hash(setup, gymId, equipmentVersion), `equipmentVersion` = the gym's at build, `focus` = the set-up's SplitBodyPart list, `rawArgs: ''`, `turnId: 'manual'`. Manual edits bump `version` in place. A new draft version (under `MAX_WORKOUT_DRAFT_VERSIONS` 20) only for rebuilds and applied coach proposals.
- `undo?: { opId, snapshot }` on the draft (setup + plan) so Undo survives a force-close.
- One open builder draft per (owner, planId | null, splitDayId | null, mainLift, local date), resumed on reopen. Earlier-date open drafts surface as `Edits from …` and expire at 14 days (existing).
- `request.setup?: { dayId, minutes, mainLiftExerciseId | null, supersets, groups: { parts: SplitBodyPart[], count: 1–4 }[], templateRoutineId?, templateVersion?, variationId? }`. Builder group labels are derived when read (S8).
- `DraftLoadSchema.source` + `'calc'` (formula, labelled estimate) and `'ben'` (typed); existing `coach` / `coach_est` / `rule` / `none` unchanged.

### 4.5 Rest (B5)

- No new `roundRestS`. The session engine (`reducer.ts`) runs each set's rest after that set: "After each round" = the last member's set rest; the switch inside a round = `transitionRestS` (default null = 0).
- "Before a drop set" = `restOverrideS` on the preceding set.
- `DraftSlot.restBySetType` (as on `RoutineExercise`).
- Per-type minimum in the clamp at `coach-draft.ts:480` and in `DraftSetTemplate.restS`: the set before a drop 0–60 s, others 30 s up to the max (Q7). Keep `nearestPreset`.

### 4.6 Atomic Start and Undo (B6)

- Template update or variation write + session create + `startWorkoutDraftIn` run in **one transaction under one opId**. Retrying with the same opId returns the existing session and writes nothing more.
- Undo is a versioned inverse write `{ targetId, expectedVersion, restore }`, refused if the version moved.

### 4.7 Units, groups, limits (S7, S8, S11, S15)

- Units per row from `CheckedOnSchema.unit`; the keyboard ± step from that item; assisted shows `assist`, per-hand `each`.
- Rear delts: the builder uses its own mapping `builderGroupOf` (rear delts → Back). The shared `MUSCLE_TO_GROUP` is unchanged unless Ben says yes to Q13. If he does, update and test every caller: catalogue validator, library filters, `mainLiftOptions`, split matching, Progress charts.
- ~~`BuilderGroup = Chest | Back | Shoulders | Legs | Biceps | Triceps | Abs`~~ **(Ben, 22–23 Oct, D5)** `BuilderGroup = Chest | Back | Shoulders | Legs | Arms | Core` is the picking group, display only: Legs = Quads + Hamstrings + Calves (glutes count under Hamstrings & glutes); Arms = Biceps + Triceps; rear delts are Back. Counting uses the detailed list (Chest, Back, Shoulders, Quads, Hamstrings, Calves, Biceps, Triceps, Core) in the plan's weekly sets and Progress; a broad group's count is exactly the sum of its parts. Stored data is always `SplitBodyPart`. `build_app.py` checks every prototype against these two lists.
  - ~~**22 Oct, design review V1/V2/V4/V6:** one muscle list everywhere.~~ Resolved by D5 above.
- Time: one shared constants module used by `duration.ts`, `time-left.ts` and the builder estimate (Q15).
- Limits: drops count against `maxWorkingSets` (10), max 3 drops per slot; `maxSuperset` 4; `maxWarmups` 4; `maxExercises` 10; length 15–180; `maxRestS` 300 → 360 only if Q7 is yes.
- `heavy?: boolean` on catalogue entries; `builderFocusOf(exercise)` for the focus headings.

### 4.8 Migrations and backup (S12)

- Routines, drafts, variations, memories and catalogue entries are JSON documents, and every new field is optional, so old rows and backups parse unchanged.
- **Migration 0030** rebuilds `coach_actions` for the new tool kinds (§5), as 0019 and 0025 did, and adds the `plan_day_variations` document kind if a table is needed.
- Backup/export: templates with routines; variations and day notes with Your data.

---

## 5. Coach integration (developer) [Proposal unless tagged]

| Tool | Page | Behaviour |
|---|---|---|
| `fill_setup` (new, strict) | Set up | `{ dayId?, minutes?, mainLiftCatalogueId?, supersets?, groups?: [{group, delta\|count}] }`. Applied at once, Undo toast [Ben]. Code checks the day exists, minutes from Ben's words win (`buildMinutesFor`), main lift in `mainLiftOptions`, counts 1–4 |
| `propose_workout_edit` (new, strict) | Your workout | Typed ops `swap`, `add`, `remove`, `sets`, `reps`, `rpe`, `load`, `move`, `superset`, `unlink`, `minutes`, with slot preconditions. Code applies to a copy, runs §3 and limits, shows before/after [Ben] |
| `review_workout` (new, strict) | Your workout | `{ verdict, suggestions: [ops + reason + preconditions], nextNotes: [{ text } \| { target: next-session target }] }`. Code supplies facts; numbers in text checked (`checkCoachClaims`) |
| `propose_plan` (existing) | — | Apply writes templates per main lift (§4.2) |

- **Staleness (rule 5):** slot preconditions (§4.4); template and variation writes carry `expectedVersion`.
- **Code checks:** exercise IDs this gym has; pain flags (left out or held, rule 9); loads via `checkProposedLoad` (ceilings `capE` / `capLastTop` 1.2, `stepsHarderAsked` when Ben asked heavier), then snap down (rule 4); limits clamp with a note; minutes from the estimate, never the model.
- **AI status:** `● Coach` / `Offline` / `Coach not connected`; never a canned reply; the offline Set up parser never appears as a coach message (rule 1). No silent paid route (rule 7). Ben's words and imported text are data (rule 8).
- **Voice:** `expo-speech-recognition` with `requiresOnDeviceRecognition: true`; check on-device support at runtime (not only in the probe, `probe/runners.ts`); no server fallback.
- **Rule 3 (flag, needs Ben + CHANGELOG):** rule 3 says a change Ben asks for to today's remaining sets applies at once with Undo. Ben's 20 Oct decision makes Your-workout chat a proposal (Apply/Skip) **before Start**. Proposed reading: before Start = proposal; after Start, `edit_today` keeps immediate apply (Q9). Once approved, record it in `docs/brief/CHANGELOG.md` and amend rule 3's wording.
- Context sent: today's draft and set-up, the template and its variations' names, active day notes, plan position, gym, pain flags, load references. Your data and Coaching knowledge labelled separately (rule 10).
- Variety rotation per block is a coach **suggestion** on the template (Apply/Undo), raised at block boundaries or when Ben asks (rule 3) [Ben]; waits for training blocks (H4).

---

## 6. Reviews and progress

| Review | When | Now / later |
|---|---|---|
| **Session review** | `Coach review` on Your workout, before Start | Now (§2.9) |
| Post-workout (Summary) | After Finish | Existing; [Proposal] Summary ticks off day notes that were met and offers `Save as variation` (§2.8) |
| Weekly | End of the plan week | Later: facts (days done, sets per muscle vs plan, main-lift trend), coach verdict, plan proposals |
| Block / goal | End of a training block | Later: block facts, next-block proposal (Apply/Undo), accessory rotation suggestions |
| **Goal-progress view** | One place: goal, plan in use, main-lift trends, volume per muscle, review history | Design TBD; facts only, no scores (rule 6); est. 1RM labelled |

Room left for blocks: `Routine.planDay` and session `planDay` gain `blockId?` / `weekN?`; reviews are stored as their own records, facts separate from coach text.

### 6.1 Auto-reviews (the judgement layer) [Ben, 20 Oct: "how can we overcome the judgement point? an auto review by AI"; agreed]
Code drafts and enforces; the AI adds judgement at fixed points; code checks every number it proposes.
- **When they run:** on app open (any connection; iOS background runs are unreliable on a free-provisioned app). The 7 am reminder makes the morning open the natural trigger. Results are cached; a review re-runs only when its inputs changed. Wi-Fi-only is an optional setting [Proposal].
- **Pre-session (daily, opening Today):** readiness from real signals only: check-in score, yesterday's logged run, RPE drift vs target over recent sessions, missed reps, pain flags. Silent unless a clear signal (e.g. 3 sessions at RPE 9–10, a big rep miss, a hard run yesterday, a low check-in). When it speaks: one line on the session card with **Apply** (an offer, rule 3).
- **Post-session (Summary):** next-session small changes applied with reason and Undo (existing rule 3 default).
- **Weekly (Sunday evening or first open after):** sessions vs plan, sets per muscle vs plan, main-lift trends, runs; a short note plus any plan tweak as a proposal (Apply/Skip). (Ben, 22–23 Oct, D2) Only changes inside coach-adjustments CA8 "small" are applied with Undo; anything bigger is Apply / Skip, and a stall reset or an extra set Ben didn't ask for always needs Apply (progress-goals.md, Coach's changes).
- **Block (end of a training block, once blocks exist):** progress to goal, plateaus, deload due; next block proposed for approval.
- **Feedback loops in code (no AI needed):** beating target RPE repeatedly nudges est. 1RM up, missing it nudges down; repeating the same edit suggests a template update; 3 stalled sessions flag the lift for the weekly review.
- **Cost/honesty:** ChatGPT-plan route; light model for the daily check, stronger for weekly/block; never a paid route without asking (rule 7). No invented signals (rule 6). Not run → `Not reviewed` (rule 1); the code draft still stands.

### 6.2 Reviews area in Progress [Ben, 20 Oct: "we will need a review area in the app then, maybe in progress"; Proposal for layout]
Progress gets a **Reviews** section at the top, next to the goal-progress view:
- **Latest:** this week's review (or the block review when one is due) as a card: verdict line, 3–5 facts, any open proposals with Apply/Skip.
- **History:** a list by week (and block), each opening the full review; session reviews open from that workout in history.
- **Goal** (Ben, 21 Oct: "will this also allow for different exercises? and also just to track sessions vs plan, as a set weight target might not be the goal per se"): the view follows what Ben is actually aiming for, not only a weight:
  - **Consistency, always shown first:** sessions done vs planned this week (day dots), and over the last 6 weeks (bars per week, planned vs done, with runs shown separately); missed planned days named, not scored.
  - **Training goal** from Profile (strength / muscle / both) picks what comes next: *muscle* → weekly sets per muscle vs range bars lead; *strength* → lift trends lead; *both* → both.
  - **Lifts, any exercise:** trend lines for the lifts Ben chooses (default: the plan's main lifts; add or remove any exercise he logs, up to 6). Each shows est. 1RM (labelled) or best set, and the existing **lift targets** (up to 3, on/off setting, any exercise) as a target line with `was → now → target` when set. No target needed to see a trend.
  - **No predictions:** no projected date or projection line (lift-targets rule: the app never predicts when a target is reached; rule 6). This replaces the projection in the prototype.
  - Facts only, no scores; est. 1RM labelled.
- Today only ever shows the one-line pre-session nudge, linking here.
Reviews are Your data (rule 10): stored as their own records with facts separate from coach text; included in backup/export/delete.


---

## 7. What this supersedes

| Older spec / item | Superseded by |
|---|---|
| workout-builder.md §3–§4 Build card, length chips, Draft card `Open` → overview | Set up + Your workout (chat build fills Set up). **Open for Ben:** the built app opens a chat draft's `Open ›` on Your workout with the coach's checked plan, not on Set up (review S4) |
| workout-builder.md BD17 `ask_build_question` in the builder | Set up rows ask nothing; [Proposal] keep the tool only for free chat builds |
| workout-builder.md BD19 main-lift insertion | Main lift row on Set up |
| workout-builder.md BD12 `Save to Workouts` from a draft | Start prompt; `Save to Workouts` stays in `⋯` for non-plan workouts |
| Backlog H5: `Save as day default`, default workout per day, Supersets review sheet | Removed [Ben]: today-only edits + Start prompt + variations; pairing in the pop-up (drag later) |
| workout-overview.md (every pre-start entry; Ben, 22 Oct) | Your workout. A library or past workout opens as the overview planned it, cardio, timed sets and an exercise twice included (22 Oct; relayed by the PM as Ben’s decision, pending Ben’s confirmation); `N left out` only for an exercise it can't find, a set with no target or past the limits (review B1). The overview's TIME tile is Your workout's Time row (§2.3) |
| today.md Up next card, alternatives row, This week / Recent, `Then:` row, Ask pill | Today (v2), §2.0.9 |
| routines.md editor for plan-day routines | Builder edits templates through the Start prompt; the library editor stays for other workouts [Proposal] |
| weekly-plan.md / plan Apply making one routine per day | One template per day **per main lift**; variations kept separately |

Unchanged: active workout, Rest, Summary (except `Save as variation`), `edit_today`, adaptive Up next (now credited by plan day), pause/end plan.

---

## 8. Build slices (developer, in order)

> **Order revised (Ben, 20 Oct):** after Today (v2) ships, build the weekly auto-review and the Reviews area in Progress next, then training blocks, then a replay test of the drafting rules against Ben's own logged history (run locally, never committed), before the polish slices. The slices below keep their content; this note sets the order.

**S1 Schemas and limits.** §4.2–§4.8 fields, `BuilderGroup`, `builderGroupOf`, limits, migration 0030.
- Old routines, drafts, memories and backups parse; a backup round-trip keeps templates, variations and day notes.
- A draft with zero slots saves while open; `startWorkoutDraftIn` refuses it.
- A draft with a 0:15 rest before a drop validates; a 5-exercise superset and a 4th drop set fail.

**S2 Domain rules (pure).** `recommendBuilderGroups`, `buildFromSetup`, `orderSlots`, `pairSlots`, `setRowsFor`, `builderLoad`, `estimateBuilderMinutes`, `adviseBuilder`, `applyVariation`.
- With a coach target of 102.5 for bench, the top set is 102.5 whatever the est. max says; with none and no AI, the built-in rule's target is used and labelled.
- Bench working load 100 (6 @ 8): back-offs 8 @ 8 = 95. At a gym whose smallest pair is 2.5 kg, 95.25 → 95 (down, never up). Warm-ups and drops also round down.
- A stack max of 100 never gives more than 100. Assisted pull-up shows `assist` and keeps its kg on a reps change.
- Chest, 60 min, supersets on: ≤ 7 exercises, ≤ 4 per group, main first, abs last, no abs + heavy pair.
- The estimate matches §3.6 to the minute, and Today, the builder and time left agree for the same workout. 20 min Chest gives the main lift alone with `Over 20 min`.
- A variation whose anchor exercise was swapped out of the template reports the skipped op.

**S3 Set up + Your workout, manual, offline.**
- Airplane mode, no AI: Set up → Your workout → Start → first set logged.
- Force-close after 3 edits: reopening shows them; Undo of the last edit still works.
- Day, main lift or variation change → `Rebuilt · Undo` restores both pages exactly. A length or group change keeps an earlier swap.
- Changing gym re-rounds loads down; an exercise the new gym lacks is swapped or tagged.

**S4a Pop-ups, keyboard, accessibility.**
- Every edit is possible with the pop-up and VoiceOver only; swipe actions have VoiceOver equivalents.
- Typing in the last set's RPE at the largest Dynamic Type size: the cell stays above the keyboard bar.
- Typed kg isn't overwritten by a reps change; a type change recalculates; a typed 101 kg becomes 100 with `Why?`.
- Targets ≥ 44 pt; body ≥ 16 pt; loads and timers tabular.

**S4b Drag (ADR: add `react-native-gesture-handler`, pinned, with Reanimated 4.5.1).** Tested on Ben's iPhone.
- A slow vertical scroll never starts a drag; a still 320 ms hold does (haptic). Swipes left and right still work.

**S5 Templates, variations, Keep for next time?, Today entry** (revised Ben 22–23 Oct, D1: no Start prompt).
- Today's session on Chest · Bench, `Edit`, opens `Chest · bench` (or its last-used variation) with no rebuild.
- One swap, then Start: the workout starts with no prompt; the template's version is unchanged and Up next moves on. The Summary's `Keep for next time?` lists the swap.
- `Apply` on it bumps only that template; `Chest · incline` is untouched; Undo restores it, and is refused if the template changed again.
- Force-close during `Apply`: either the template's new version exists or it doesn't; retrying with the same op ID never duplicates.
- Updating the template shows the change in `Chest · bench · arms superset` too.
- Plan Undo leaves variations in place; a new plan with Chest · bench picks them up.
- Rename and delete a variation (Undo works).

**S6 Coach chat and voice.**
- Set up "pull, 50 minutes, no supersets" fills three rows; Undo restores all three.
- A proposal touching Cable fly after Ben edited Cable fly: `Out of date. Ask again.`; one touching only Bench still applies.
- "Bench heavier" never exceeds `capLastTop` and lands on a weight the gym can load.
- Offline: no coach text anywhere, no chat bubble; the bar shows `Offline`. With no on-device speech the mic shows `⊘` and no audio leaves the phone.

**S7 Coach review and day notes.**
- Every count matches a code recount; a coach sentence with a wrong number is hidden.
- Applying one suggestion leaves the others usable.
- ~~`Update plan day` offers update or new variation; Undo toast restores.~~ (D1) No `Update plan day` in the review.
- Unticked notes aren't saved. Swiping the sheet down saves ticked notes, the same as `Done`.
- A numeric note sets next time's load for that lift; text notes show on the next Chest day's Your workout and in Today's card's `Why?`, and ✕ stops them going to the coach.
- Notes are exported and deleted with Your data, not with Coaching knowledge.
- No AI: facts and Plan section show; no verdict; header `Offline`.

**S8 Today (v2).** Needs S2, S5 and weekflex. Checks: §2.0.8.

---

## 9. Open questions for Ben

**Answered 20 Oct**
- Old Q1, one-tap Start on Today: answered by Today (v2) (§2.0): `Start` is one tap on the card, tapping the card expands it, `Edit` opens the builder.
- Old Q4, merge on Set up changes: yes ("agreed"). Edits are kept; length, supersets and groups merge; a new day, main lift or variation builds a new workout with Undo (§2.3).

**Answered 20 Oct (Ben: "go", with these recommended answers)**
1. Your workout replaces the Workout overview for plan days: **yes**. (22 Oct: for every pre-start entry; the overview is retired, §2.1.)
2. Two main-lift templates: **no auto-alternation**; Today opens the last-used one; Ben picks with the Main lift chips.
3. `Variation` row under Main lift on Set up, shown only when variations exist: **yes**.
4. Offline, the Set up bar still fills day, minutes, supersets and groups by code (no coach): **yes**.
5. Main lift never joins a superset: **yes**.
6. Typed weights stay today-only even when the plan day is updated: **yes**.
7. Rest limits: 0–1:00 before a drop, up to 6:00 otherwise: **yes**.
8. Group label: **Abs**. *(Superseded, Ben 22–23 Oct, D5: the group is `Core`.)*
9. Before Start, coach changes Ben asks for are proposals (Apply/Skip); after Start they apply at once with Undo: **yes** (CLAUDE.md rule 3 wording updated; CHANGELOG).
10. Variations per day and main lift: **5**.
11. Load-only edits don't trigger the `Use these changes for` prompt: **yes**.
12. Load source order: **coach target → plan's first-week load → built-in rule → est. 1RM × reps × RPE**; other sets derived by reps and RPE.
13. Rear delts count as Back **everywhere**.
14. `MAIN` tag on the main-lift row: **yes**.
15. Builder time numbers used for Today and time left too: **yes**.
16. Extra 15 s per superset switch: **no**.
17. Variation = plan day + extras: **yes**.
18. Drag ships after the pop-up buttons, once tested on iPhone: **yes**.
19. Day strip: **3 back, today, 3 ahead**.

**Open after the 23 Oct review (`docs/reviews/batch23-design.md`); each has the designer's recommendation, built in the prototypes where noted**
- **Q-R1 (SP1) What `Keep for next time?` compares.** Recommended and built: only Ben's own edits, replayed on the plan day's template for his controls, against the template for that main lift (§2.8). Never the fit, pairing, a deload or the coach.
- **Q-R2 (SP2) Back-offs with no achievable load in the band.** Recommended and built: the load nearest the band below the top, never the top; none below the top → top load, 1 rep fewer (§3.1 item 9). Alternative: always the next load down, even when further from the band (Muscle DB 26 → 22, 15.4 %).
- **Q-R3 (SP3) The carry-over.** Recommended and built: a real offer (`Carry over`, then `Undo`), by muscle, to each muscle's next day; D2 says unasked extra sets always need Apply. Alternative: applied by default with Undo, shown on the visible note.
- **Q-R4 (SP4) Specific targets and the nine counting rows.** Glutes, Adductors, Abductors and Forearms have their own Sets-per-week rows in the plan but not on Progress. Recommended: Progress adds a row for each target Ben set (below the nine), and the broad group sums its rows plus those (Legs = Quads + Hamstrings + Calves + Glutes …), so "broad = exact sum of its parts" holds. Not built.
- **Q-R5 (N4) An untouched `Keep for next time?`.** Recommended: it stays on that workout's Summary in history until the plan day next comes up, then lapses. Now: leaving = Skip.
- **Q-R6 — answered (Ben, 23 Oct):** `↻ Mix it up` is a fifth row on Your workout's controls (§2.3a); `Save as a variation` is in Your workout's `⋯` for plan days (§1.3). Was: **(D3 scope, SP6) `↻ Mix it up`, session-type chips and variations.** D3 doesn't name them. Recommended: `↻ Mix it up` as a fifth row on Your workout's controls; a saved variation picked on Set up's `Variation` row or as a `Variation` row on Your workout; a new variation made from the Summary row (`Save as a version`), since nothing creates one after D1. Not built.
- **Q-R7 Back to the plan's version from an edited Today card.** Recommended: Your workout's `Undo` and controls are enough; no reset on Today (lean card). Ben may want a `Back to plan` on Your workout.
- **Q-R8 (S3) A control change keeps Ben's edits.** Built (FT5): his removals, additions, swaps and set counts are replayed on the new choice. Was a designer assumption (replace them).
- **Q-R9 (SP5) Where a D8 change waits.** Recommended: a pending coach edit on the plan day, checked against the template version, main lift and exercise when that day's draft is made; stale → not applied, shown once; expires when the day is done or after 14 days (§2.1). Spec only.
- **Q-R10 (SP8) Band with no plan.** Recommended: Profile goal strength → Strength, muscle → Muscle, both → Balanced. Built with "both".

---

## 10. Prototype clean-up before Ben's next test

Not done in this revision (spec only). For `prototypes/workout-builder-v3.html`:
- Delete `Supersets save about 6 min` and the `1 of 2` / `2 of 2` counters.
- `Version` → `Variation` everywhere; drop the picker subtext `Your plan's Chest day`; names as `Chest · bench · arms superset`.
- ~~Review: `Make this the plan's Chest day` → `Update plan day` (opening the §2.8 choice)~~ (D1: no `Update plan day`; the prototype's review has none); delete "Future plan sessions start from this workout."
- `Why this weight?`: delete "Hit N reps → add weight next time".
- `Remove` / `Removed …` → `Delete` / `Deleted … · Undo`.
- Recommended line → `Recommended for 60 min · 7`; drop `Start with no muscle groups` under Custom.
- Remove the search field in Swap; drop the 15 s superset switch from the estimate.
- Strip the removed Save-as-default code (`s.defaults`, `useDef`, the `save` action, "Saved as your X default").
- Round warm-ups, drops and typed kg down, not to nearest.

For `prototypes/today-v2.html`:
- The Today day sheet says `Plan day 2 of 4`, but the card and Based on say day 1. Use day 1.
- The review note sets bench to 102.5, but the list and Based on say 100 ("100 kg again"). Show 102.5 and `100 × 8 @ RPE 8 → 102.5`.
- Drop `est. 1RM 127` from Based on (estimates stay behind `Why this weight?`).
- Session-type chips are 40 px high; make them 44.
- Delete the unused `.planline` and `.alt` / `.alts` styles.
- Add the GymChip, `Target` list header, `Not reviewed · Offline` state, and the Resume / Done today states.
