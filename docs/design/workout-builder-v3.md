# Workout builder v3 (Set up → Your workout, plan-day templates, variations, coach review)

Status: **Proposed, rev 3 (20 Oct 2026). Waiting for Ben's approval.** Rev 2 covers the rules/code review (B1–B6, S7–S15) and the Ben-intent review (1–15). Rev 3 adds **§2.0 Today (v2)** (updated for Ben's later 20 Oct direction: day control + session-type chips, no Or row, no run counter), records Ben's answers to old Q1 and Q4 (§9) and renumbers the open questions.

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
- Each template can have saved **variations**: `Chest · bench · arms superset`, `Chest · bench · abs superset` (Ben: "also have variations saved, such as including arm supersets or abs superset, so it doesn't lose stuff and have to redo unnecessarily"). Picked on Today's session-type chips or on Set up.
- [Proposal] A variation is stored as **the template plus its extras** (the added exercises and pairings), not as a full copy. So when the template changes, every variation picks up the change and nothing has to be redone (§4.3).
- **`Save as default` is removed.** Edits are **today only** by default. On Start after edits, one prompt: `Today only` / `Update Chest · bench in your plan` / `Save as new variation` (§2.8). This is rule 2's scope choice.
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

Regions, top to bottom:

1. **Day title** `Tuesday`, with the `GymChip` trailing [title Ben/Proto; GymChip kept from today.md, Proposal].
2. **Coach bar + mic** `✦ Ask the coach` [Ben]. Opens the coach sheet (never full screen); the mic starts listening at once.
3. **7-day strip** [Ben; range Proto, §9 Q19]: 3 days back, today, 3 ahead. Each cell: weekday, date, up to two items. A thin divider sits before Monday so the plan week is visible [Proposal]. No plan line and no run counter [Ben].
4. **Banners / rare lines** from today.md (failed backup, check-in line, pain `Still hurts?` line), unchanged, at most two [Proposal].
5. **`Today's session`** [Ben]:
   - **Day segmented control**: the plan's days in plan order, `Chest` `Back` `Legs` `Shoulders` `⋯`. `NEXT` under the plan's next day, which is selected on open. Any day is one tap. `⋯` opens **Other workouts**.
   - **Session-type chips** for the chosen day: its main-lift templates, then its saved variations (`Bench` `Incline` `Bench · arms superset`). Shown only when the day has more than one. The first is the last-used one [Proposal].
   - **Session card**, collapsed by default.
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
│ │ 1  Barbell bench press  4 × 6 · 102.5│ │
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

- **Strip items** [Ben]: done workout `✓ Shoulders` (green fill), done activity `Run 12k` (run colour fill), planned plan day `Legs` and planned run `Run 8k` (dashed outline, same colour, plus `Planned` in the VoiceOver label and the sheet), rest `Rest` (text only). Colour is never the only signal (✓, dashed outline, the word). Today's cell has the accent outline and shows the chosen day.
- **Runs** (logged or planned) appear only when Ben logged them (`＋ Activity`) or told the coach (`log_activity`) [Ben]. Nothing is inferred or added by the plan. [Proposal] The same goes for future plan days: they show only when dated (a week change Ben applied, or days he told the coach); otherwise future cells stay empty, since the rotation has no dates.
- **Cells** are ≥ 44 pt wide at 390 pt (7 × ~47 pt). At accessibility Dynamic Type sizes the strip becomes a 7-row list (`Sat 17 · ✓ Shoulders`) [Proposal].
- **Session controls** [Ben, 20 Oct: "when click chest, it should say Main lift: bench, incline. and have option for superset on/off. these are the core crux of the session"]: under the day control, five compact rows (about 38 pt visible, small labels and chips; each control keeps a 44 pt tap area) [Ben, 20 Oct: "make the main lift through to supersets a bit smaller"], and the card rebuilds from them:
  1. `Main lift`: one chip per main-lift template (Bench · Incline).
  2. `Accessories`: `Focused` (2 accessories × 3 sets) / `Varied` (3 accessories × 2 sets at different angles, e.g. incline press, cable crossover, dips) [Ben, 20 Oct]. Default from the Profile goal: Strength → Focused, Muscle/Both → Varied [Proposal].
  3. `Time`: − / + in 5-min steps, default the plan's length [Ben, 20 Oct: "quickly adjust everything without me having to build a whole new workout"]. Shorter time applies, in order, only as far as needed: (a) shorter rests, then shortest (main 3:00→2:00, compound 2:00→1:15, isolation 1:30→1:00, superset round 1:30→1:00); (b) push effort: accessory last sets to RPE 9; (c) fewer accessory sets (not below 2); (d) drop exercises: abs, then the other group's isolation, then accessory isolations, compounds last; never the main lift. Longer than the plan: normal rests, +1 set on accessories (max 4), then add an exercise from the day's pool. The card shows one line, e.g. `To fit 45 min: shorter rests · 2 sets fewer`. Main-lift loads never change for time [Proposal].
  - Freed time is filled [Ben, 20 Oct: "if you remove abs and we then have more time, we should be increasing the number of exercises, e.g. have 2 arm exercises, maybe another chest"]: when abs (or anything else) comes out and the time allows, exercises are added before sets: first a second arm exercise, then another accessory for the day's main group. With supersets on, abs off gives the arm exercise an arm partner in the same slot (pushdown + curl), so the time stays the same. The plan's own spare minutes are kept as a buffer; only time beyond that is filled.
  4. `Abs` on/off [Ben, 20 Oct]: default from the plan ("the coach should recommend whether abs are on or not based on the plan"); when Ben differs, a small `plan: on/off` shows under the label. Off removes the ab exercise and splits its superset.
  5. `Supersets` on/off.
  - [Ben, 20 Oct: "rather than having from last review and based on, just have that within a Why which you access only if you want"] The expanded card has no `From last review` or `Based on` blocks; both live in one collapsed `Why?` (plan position, last session and resulting load, last review's note, goal/target, accessories and time, plus the coach's reason if it changed anything; offline: `Not reviewed · Offline`). This supersedes those two blocks wherever this spec describes them.
  - Card order [Ben, 20 Oct: "move Chest above the main lift bit… then have Session breakdown below, then Start. only show session breakdown if clicked on"]: title (`Chest · Bench`, `5 exercises · ~52 min · plan day 1 of 4`) and any fit/clash line, then the five controls, then a collapsed `Session breakdown ›` row (exercise table, `Why?`, `↻ Mix it up`), then `Start` / `Edit`.
  - [Ben, 20 Oct: "doesn't need to say bench if it's selected below. should ideally fit to page without having to scroll"] The title is just the day (`Chest`); the main lift shows only in its chip. With Session breakdown collapsed, everything from the header to `Build your own` fits one iPhone screen without scrolling: the coach becomes a compact `✦ Coach` + mic in the header row next to the date, and the week strip is shorter.
  Re-rendering keeps the scroll position (e.g. `↻ Mix it up` doesn't jump to the top) [Ben, 20 Oct]. Supersets off splits the pairs and the card's minutes update. Saved variations are not chips; they sit in `⋯` under "Your <day> variations"; picking one shows `Variation: <name> · Back to plan day`.
- **Variety** [Proposal]: mostly coach-driven. (1) Every block (4–8 weeks) the coach proposes swapping a couple of accessories; Ben approves (plan change). (2) `↻ Mix it up` on the card: the coach swaps one accessory for a fresh one hitting the same muscles, today only, shown as `Cable fly → Machine chest press · today only · Undo`; never the main lift. (3) Saved variations for set alternatives Ben wants to keep.
- **Day control** [Ben]: segments ≥ 48 pt high. Unselected days and types are greyed so the chosen one stands out [Ben, 20 Oct], still ≥ 4.5:1 contrast. Up to 4 plan days show; with more, the rest go in `⋯` [Proposal]. `NEXT` is text under the label, not colour alone. Picking a day resets the chips to that day's first type and collapses the card. At accessibility sizes it becomes a row `Day  Chest ›` that opens a list [Proposal].
- **Session-type chips** [Ben]: ≥ 44 pt high (the prototype's 40 pt is too small). The selected chip is filled and carries `●` / selected trait. Labels: `<main lift>` for templates, `<main lift> · <variation>` for variations. They wrap to a second line rather than scroll.
- **Other workouts (`⋯`)** [Ben]: other split days (`Push`, `Pull`, tagged `PPL day`), recent non-plan workouts from the last 14 days (`Recent · 17 Oct`), then `Build your own`. Tapping a row puts it on the card; the day control then shows no selected segment [Proposal]. `Empty workout` is the last row [Proposal].
- **Clash warning** [Ben]: one line on the card when the chosen session clashes with the week: `! Long run Saturday: legs fit better Thursday`. From the weekflex run rule (CHANGELOG 2026-10-20), so it only fires on runs Ben logged or told the coach. Never blocks Start.
- The card's workout **is the builder draft** (§4.4): Edit, Start and the builder all use the same draft, so edits made in the builder show on the card, which then reads `Chest · Bench · edited` [Proposal].

#### 2.0.3 How the recommendation is made [Ben asked; steps Proposal]

Plain words, for Ben:

1. **Code drafts it.** Next plan day (adaptive Up next, after this week's runs rule) → that day's template, with the variation last used → loads from history (§3.1) → fitted to his usual length (§3.6) → active `From last review` notes applied (a numeric note sets the load; `Include abs` adds abs).
2. **The coach reviews the draft**, with his goal, lift targets, recent RPE, pain flags and memories. It changes something only with a clear reason (rule 3): a small load/reps/sets change is applied and shown with its reason and Undo; a swap, add or remove is an offer (`✦ Swap Cable fly for Incline press? Apply`), never applied on its own.
3. **Code checks every number**: loads this gym can make, equipment min/max, pain flags, limits (rules 4, 9).
4. **Based on shows it**: the facts code used, plus the coach's one-line reason when it changed something. If no coach review happened, the last line says so (`Not reviewed · Offline`).

Picking another day or session type drafts that one the same way (steps 1, 3, 4); the coach reviews it once, on first pick, when online. The coach review runs when a draft is made or its inputs change (a workout or activity logged, the plan changed, a new day), not on every visit; the result is stored with the draft [Proposal]. This means Today now makes a background AI call, which today.md said it never did.

#### 2.0.4 States

| State | Behaviour |
|---|---|
| Normal | As the wireframes. The plan's next day selected, `NEXT` under it, its last-used type selected |
| Loading | The code draft is local, so the card shows at once. No spinner; the coach's change, if any, arrives later as one Based on line + Undo, and the card never moves under a finger: if Ben has touched the card in the last 2 s it waits [Proposal] |
| Offline / AI unavailable | Card = code draft. Based on ends `Not reviewed · Offline` or `Not reviewed · Coach not connected`. Coach bar shows `Offline`; in the coach sheet, Set up words still fill the builder (§2.6) |
| Other day or type picked | Card shows it, collapsed; no `plan day N of 4`. Tapping the `NEXT` segment goes back. [Ben, 20 Oct: "if you changed the session today it would change the calendar plan which it should"] The week's planned days reflow straight away in the strip: the skipped day moves into the next lifting slot in plan order (legs never the day before a long run), and the card's sub-line says so, e.g. `Chest moves to Thu`. Committed when the session starts; Up next is credited by what Ben does (§4.2) |
| One type only | No chips; the card name still shows the main lift (`Legs · Squat`) |
| From `⋯` | Card shows that workout (`Push`, `Hotel shoulders · 17 Oct`); no segment selected |
| Clash | One `!` line (above); Start still works |
| Coach offer pending | One `✦` offer line in the expanded card; Start ignores it (starts without it) |
| Edited in builder | Card shows `Chest · Bench · edited`; Start = the edited draft, through the Start prompt (§2.8). Picking another day or type keeps the edited draft for when Ben comes back [Proposal] |
| Workout in progress | Resume card replaces Today's session (today.md, unchanged); day control, chips and Build your own hidden; strip stays |
| Stale unfinished workout | today.md's stale card, unchanged |
| Done today | Card becomes `✓ Chest · 58 min ›` (opens Summary), no Start; day control and Build your own stay for a second session, no day selected |
| No plan | No day control; card replaced by `No plan` with `Build your own` as the primary button and `Set up a plan ›`; `⋯` content (recent workouts) shows as a list |
| Plan paused | Day control shows the paused plan's days, none marked `NEXT`; `Plan paused` under the label |
| First use | Strip shows today only; as No plan |
| Large Dynamic Type | Strip as a list; day control as a `Day` row; chips wrap |

#### 2.0.5 Interactions

| Action | Result |
|---|---|
| `Start` | Starts the card's workout as is (check-in sheet when due). No builder, no overview |
| Tap a day segment | That plan day on the card, its first type selected, collapsed. VoiceOver: tab `Chest, next, 1 of 5` |
| Tap a type chip | That template or variation on the card, collapsed |
| `⋯` | Other workouts sheet; a row puts it on the card; `Build your own` → Set up |
| Tap card | Expand / collapse. VoiceOver: one button `Chest, Bench, details, collapsed` |
| `Edit` | Builder, Your workout (page 2) with this draft |
| `✕` on a review note | Note off for today; toast `Note hidden · Undo` |
| `Undo` on a coach line | Restores the code draft value (versioned, rule 5) |
| `Build your own` | Builder Set up, Day = the card's day |
| `＋ Activity` | The existing Activity sheet (weekflex) |
| Tap a day | Day sheet. Past: workouts (`Shoulders · 58 min`, tap → its Summary) and activities (`Run 12 km · 1:02 · easy`, tap → edit). Planned day: `Move or change (coach)` opens the coach with the day named, which returns `propose_week` (before/after, Apply, Undo). Planned run: `Edit`, `Mark done` |
| Coach bar / mic | Coach sheet. A set-up request ("legs, 45 min") opens the builder Set up filled (`fill_setup`, Undo toast). "Long run Saturday" → `log_activity`. "Swap Thursday and Friday" → `propose_week`. Questions answer in the sheet |
| Swipe | None on Today (no swipe between days; the segments are the only way) |

#### 2.0.6 Copy

`Ask the coach` · `Today's session` · `NEXT` · `⋯` (VoiceOver `Other workouts`) · card `Chest · Bench` / `5 exercises · ~55 min · plan day 1 of 4` (the minutes are an estimate) · `Start` · `Edit` · `Target` (list header; every list value is a target) · `From last review` · `Based on` (dated lines are actuals, `target` lines are targets) · `Not reviewed · Offline` · `Other workouts` · `PPL day` · `Recent · 17 Oct` · `Build your own` · `＋ Activity` · `Move or change (coach)` · `Planned` · `Close`. No plan line, no run counter [Ben]. Est. 1RM never appears on Today (only behind `Why this weight?`, labelled estimate).

#### 2.0.7 Data needed

`planUpNext` + the weekflex run rule (`NEXT`); `planRoutines` + variations per (splitDayId, mainLift) for the segments and chips (§4.2, §4.3); `checkScheduleConflicts` (clash line); Ben's activities (only those he logged or told the coach) and finished sessions for the strip; recent non-plan workouts and the Profile's other split for `⋯`; week plan (`propose_week` results); `buildFromSetup` / `applyVariation` / `fitPlanToMinutes` / `estimateBuilderMinutes` / `snapPlanToGym`; load sources (§4.1); day notes; `shouldAskCheckIn`; Resume via `estimateRemainingDuration`. New [Proposal]: `buildTodayWeekView` (7 cells, items, planned flag), `buildTodaySessionPicker` (days, `nextDayId`, types per day, other workouts) and `buildRecommendationView` (draft, `basedOn: BasedOnFact[]` from code only, `coachLines`, `reviewStatus: 'reviewed' | 'offline' | 'not_connected' | 'pending'`). The coach review uses `review_workout`'s fact checks; small changes go through `set_next_session_targets`, structural ones through `propose_workout_edit` as an offer.

#### 2.0.8 Acceptance checks

1. Airplane mode: Today shows the card, `Start` logs a first set with no network; Based on ends `Not reviewed · Offline`; no coach text anywhere.
2. From cold open to the first set: 1 tap on Start (check-in not due).
3. Collapsed card shows only `Day · Main lift`, exercise count, `~N min`, `plan day N of 4` (next day only), Start, Edit.
4. Every Based on line matches stored data (dates, actuals, targets); a coach line appears only when the draft differs from the code draft, and Undo restores it.
5. A coach structural change is never applied without `Apply`.
6. Strip: done items carry ✓, planned ones a dashed outline and `Planned` in VoiceOver; a run logged in the Activity sheet appears at once. With no activities logged or told to the coach, no run appears anywhere on Today.
7. With a long run Saturday logged, picking Legs on Friday shows the `!` line; Start still works. Without it, no line.
8. Picking another day, type or `⋯` workout changes no plan data; doing Shoulders today moves Up next past Shoulders.
9. Chest with Bench, Incline and one variation shows 3 chips; Legs with one template shows none. Each pick is one tap and changes the card name.
10. Edit, change one exercise, back to Today: the card shows `Chest · Bench · edited`, and Start shows the §2.8 prompt.
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
| Reopen today after leaving (or a force-close) before Start | The same unstarted workout, with every edit kept | [Proposal] |
| Resuming a workout in progress | **Never** the builder (unchanged) | — |

[Proposal] Your workout becomes the one pre-workout page for plan days, replacing the Workout overview there. The overview's gym chip and check-in move onto it (§9 Q1).

[Ben, 20 Oct] Today's session card keeps a one-tap `Start`; tapping the card expands it; `Edit` opens the builder (§2.0). Active `From last review` notes are already applied in the draft (§2.0.3), so a one-tap Start never skips them.

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
| Muscle groups | Recommended for day + length + supersets; ± per group; `＋ Add muscle group`; once edited, the `Recommended` tag becomes a `Use recommended` link. Legs is one group; rear delts count as Back. Max 4 exercises per group (extras go to the other groups); the recommendation is at most 7 | [Ben] |
| Next: exercises | Builds Your workout, or returns to it (§2.3, Back to Set up) | [Ben] |

States: **normal**; **custom, empty** (`Next: exercises` disabled, hint `Add a muscle group`); **template loaded** (rows show the template; groups come from its exercises) [Proposal]; **custom day with only some leg parts** (row reads `Legs`; exercises come only from the chosen parts) [Proposal]; **offline / coach not connected** (bar shows `Offline`, §2.6).

### 2.3 Your workout [Ben]

```
┌──────────────────────────────────────────┐
│ ‹ Set up                                 │
│ Chest · about 58 min                     │
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
- Units [Proposal]: the header carries Ben's unit once. A row whose equipment uses the other unit shows it inline (`45 lb`). Per dumbbell shows `each`, assisted `25 assist`, bodyweight `BW` or `BW+10`, no history `—`.
- `+N W` under Sets counts warm-ups. Each exercise has a `works` line (`Chest, front delts, triceps`) [Ben].
- `Top set` is a **target**, never an actual. Loads use tabular numerals.
- [Proposal, Q14] A small `MAIN` tag on the main-lift row. Off unless Ben wants it.
- `Start` is disabled when the workout is empty [Ben]. Start and Coach review sit in the bottom bar, always visible.

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
| Plan paused or ended while open | `Today only` and `Save as new variation` still work; `Update … in your plan` is hidden |
| Unstarted edits from an earlier day | Line `Edits from Mon 19 Oct · Use` (Undo). They're deleted after 14 days |
| Offline / coach not connected | §2.6 |

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
- [Proposal] Lists only exercises this gym has. Ones already in the workout are hidden. Pain-flagged ones show `May hurt` and ask to confirm.
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

### 2.8 Start prompt (half-height sheet) [Ben]

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

### 2.9 Coach review (sheet) [Ben]

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
│ │ Update plan day        [Update][Skip]│ │
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

- Verdict line; ticks per core muscle with **set counts** (✓ trained, · missing; icon plus text, not colour alone); variety line; Plan section (is the day next, length, main lift, planned exercises kept/missing/added, working sets vs plan) with `Add back X` and `Update plan day`; suggestions, each with its own button (a proposal, Undo after); `For next <day> day` notes ticked by default, saved on `Done` [Ben].
- `Update plan day` opens the same choice as §2.8: `Update Chest · bench in your plan` / `Save as new variation` / `Cancel`. This happens before Start, so Undo is a toast: `Chest · bench updated · Undo`.
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
9. Defaults [Proto]: main lift 4 sets (1 top set of 6 + 3 back-offs of 8); others 3 sets × 8–12.

Whether step 4 should replace steps 1–3 ("est. 1RM everywhere") is still open in the backlog: §9 Q12.

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
- `BuilderGroup = Chest | Back | Shoulders | Legs | Biceps | Triceps | Abs` is display only: Legs = Quads + Hamstrings + Glutes + Calves; Abs = Core. Stored data is always `SplitBodyPart`.
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

---

## 7. What this supersedes

| Older spec / item | Superseded by |
|---|---|
| workout-builder.md §3–§4 Build card, length chips, Draft card `Open` → overview | Set up + Your workout (chat build fills Set up) |
| workout-builder.md BD17 `ask_build_question` in the builder | Set up rows ask nothing; [Proposal] keep the tool only for free chat builds |
| workout-builder.md BD19 main-lift insertion | Main lift row on Set up |
| workout-builder.md BD12 `Save to Workouts` from a draft | Start prompt; `Save to Workouts` stays in `⋯` for non-plan workouts |
| Backlog H5: `Save as day default`, default workout per day, Supersets review sheet | Removed [Ben]: today-only edits + Start prompt + variations; pairing in the pop-up (drag later) |
| workout-overview.md for plan days | Your workout (pending Q1) |
| today.md Up next card, alternatives row, This week / Recent, `Then:` row, Ask pill | Today (v2), §2.0.9 |
| routines.md editor for plan-day routines | Builder edits templates through the Start prompt; the library editor stays for other workouts [Proposal] |
| weekly-plan.md / plan Apply making one routine per day | One template per day **per main lift**; variations kept separately |

Unchanged: active workout, Rest, Summary (except `Save as variation`), `edit_today`, adaptive Up next (now credited by plan day), pause/end plan.

---

## 8. Build slices (developer, in order)

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

**S5 Templates, variations, Start prompt, Today entry.**
- Today's session on Chest · Bench, `Edit`, opens `Chest · bench` (or its last-used variation) with no rebuild.
- One swap, then Start: the prompt `Use these changes for` lists one line; `Today only` leaves the template's version unchanged and Up next moves on.
- `Update Chest · bench in your plan` bumps only that template; `Chest · incline` is untouched; Summary Undo restores it, and is refused if the template changed again.
- Force-close during `Save and start`: either both the variation and session exist, or neither; retrying never duplicates.
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
- `Update plan day` offers update or new variation; Undo toast restores.
- Unticked notes aren't saved. Swiping the sheet down saves ticked notes, the same as `Done`.
- A numeric note sets next time's load for that lift; text notes show on the next Chest day's Your workout and Today's expanded card, and ✕ stops them going to the coach.
- Notes are exported and deleted with Your data, not with Coaching knowledge.
- No AI: facts and Plan section show; no verdict; header `Offline`.

**S8 Today (v2).** Needs S2, S5 and weekflex. Checks: §2.0.8.

---

## 9. Open questions for Ben

**Answered 20 Oct**
- Old Q1, one-tap Start on Today: answered by Today (v2) (§2.0): `Start` is one tap on the card, tapping the card expands it, `Edit` opens the builder.
- Old Q4, merge on Set up changes: yes ("agreed"). Edits are kept; length, supersets and groups merge; a new day, main lift or variation builds a new workout with Undo (§2.3).

**Open**
1. Your workout replaces the Workout overview for plan days (gym chip and check-in move onto it)? (yes/no)
2. When a day has two main-lift templates (bench, incline), should Up next alternate them automatically? (yes / no, use Profile's main lift unless I change it)
3. Put `Variation` as a Set up row under Main lift, shown only when variations exist? (yes / pick another place)
4. Offline, should the Set up bar still fill day, minutes, supersets and groups from what I type or say, with no coach involved? (yes/no)
5. Main lift can never join a superset? (yes / allow it with a "not recommended" note)
6. Typed weights stay today-only even when I update the plan day? (yes / save them as fixed loads)
7. Rest limits: the set before a drop can rest 0–1:00, and other sets up to 6:00 (now 5:00)? (yes/no)
8. Group label: `Abs` or `Core`? (pick)
9. Before Start, coach changes I ask for are proposals (Apply/Skip); after Start they apply at once with Undo as today? This changes rule 3's wording. (yes/no)
10. Limit variations per day and main lift? (no limit / 5 / pick a number)
11. Load-only edits don't trigger the `Use these changes for` prompt? (yes/no)
12. Where today's load comes from: coach target first, then the plan's first-week load, then the built-in rule, and only then est. 1RM × reps × RPE, with every other set worked out from that load by reps and RPE? Or est. 1RM everywhere? (first / est. 1RM everywhere)
13. Rear delts count as Back only in the builder, or everywhere (Progress charts, library filters, split matching)? (builder only / everywhere)
14. Show a `MAIN` tag on the main-lift row? (yes/no)
15. Use the builder's time numbers (45 s per set, etc.) for Today's estimate and the workout's time left too, so they all agree? Some estimates would shift a minute or two. (yes/no)
16. Add 15 s for switching between exercises in a superset to the time estimate? (yes/no)
17. A variation is saved as "the plan day plus its extras", so changes to the plan day flow into every variation? (yes / save full copies)
18. Drag to reorder and pair ships after the pop-up buttons, once tested on your iPhone? (yes / drag needed first)
19. Today's day strip: 3 days back, today, 3 ahead (always shows yesterday's and tomorrow's runs, with a line where Monday starts), or the Mon–Sun week, which matches your plan week but on a Monday hides Sunday's long run? (3 back, 3 ahead / Mon–Sun)

---

## 10. Prototype clean-up before Ben's next test

Not done in this revision (spec only). For `prototypes/workout-builder-v3.html`:
- Delete `Supersets save about 6 min` and the `1 of 2` / `2 of 2` counters.
- `Version` → `Variation` everywhere; drop the picker subtext `Your plan's Chest day`; names as `Chest · bench · arms superset`.
- Review: `Make this the plan's Chest day` → `Update plan day` (opening the §2.8 choice); delete "Future plan sessions start from this workout."
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
