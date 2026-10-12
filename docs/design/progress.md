# Progress

Status: **v1.0, 11 Oct 2026.** Replaces v0.1 (8–9 Oct). Brief §1 (Progress tab) and §12 "Page 6: Progress". Tokens and components: [design-system.md](design-system.md) (chart aliases §2.1, chart sizes §4.1, `TrendChart` §9.23, `StatStrip` §9.65, new Progress components §9.69–9.73). Research: [competitor-analytics.md](../research/competitor-analytics.md). Mockup: [mockups/progress.html](mockups/progress.html) (Direction D dark, 390 × 844).

> **What changed from v0.1, and why.** Ben asked for analytics on 11 Oct 2026: (1) sessions over the last 7 / 14 / 30 / 60 days, (2) time in gym, (3) how often each main muscle group is trained, with a push/pull/legs view, and (4) exercise progress: estimated 1RM, best reps at each weight, and the other things a gym app is expected to show. v1.0 makes these four the core of Progress and cuts everything that needs data the app doesn't record yet.
> - **Home is built around a window** (`7 days` · `14 days` · `30 days` · `60 days`). Every card on the home screen uses the same window, so there is one date context per screen. This keeps PG3's principle; only the switcher is new.
> - **New:** Sessions and Time in gym (PG24, PG25), Muscles with a `Body parts` / `Push/Pull/Legs` toggle showing sessions and sets (PG26, PG27), a rep table on exercise detail (PG28), and an explicit way to show FitNotes history on an equipment's chart (PG32).
> - **Kept:** the honesty rules PG7, PG10, PG11, PG12, PG15, PG16 and PG21, the minimal-copy rule, `Overview | Calendar` (PG1) and the `ResumeBar` (PG5).
> - **Deferred** (each needs data or features that aren't built): weekly coach review (PG18–PG20), endurance, pinned "Lifts you follow", the check-in card, planned-vs-done counts (needs the weekly plan), deload markers (PG14, needs week tags), pain spans and the pre-flag reference (PG13, PG22, need `PainFlagEvent`), coach-adjusted chart markers, the weekly-sets guide band (PG6) and the streak line (PG17). §9 lists them with what each one needs.
> - **Build is two slices.** **A:** Progress home and Calendar. **B:** Exercise list and exercise detail. Acceptance checks are per slice (§8).
> - The v0.1 text for the deferred parts is in git history (`docs/design/progress.md` before this revision). It's a starting point when they come back, not current spec.

Progress is **not** part of the logging loop. Nothing here is needed to train, nothing needs a network or AI, and nothing interrupts a workout. In v1.0 the only AI element on Progress is the standard `Ask` pill.

---

## 0. Decisions

### 0.1 Departures from brief §12 "Page 6" (Ben to approve; proposed brief change P-PG1)

| # | Brief says | v1.0 does | Reason |
|---|---|---|---|
| PG1 | Calendar "opens saved workouts" | Kept: Calendar is the second segment of the Progress tab (`Overview` · `Calendar`) | Three tabs (brief §1). Past workouts are one tap from anywhere in Progress |
| PG2 (rev.) | "Default to weekly consistency and three user-pinned exercise trends" | Fixed home order: Window → Activity (sessions, time) → Muscles → Records → Exercises. **The order never changes with the data.** Pinned trends move to a later slice | Ben's four asks come first. Pins need a new store and editor; the exercise list gives one-tap access to every lift meanwhile |
| PG3 (rev.) | (none) | One window picker at the top of Overview drives **every** home card. No card has its own date range | One date context per screen. A picker that changed some cards but not others would cause misreading (v0.1's reason, still true) |
| PG5 | (none) | Kept: `ResumeBar` above the tab bar while a workout is unfinished and < 6 h old | Keeps "one tap to resume" true from every tab |
| P-PG1 | "Do not turn this into an exhaustive daily analytics dashboard" | Window-based counts on the home screen, no daily metrics, no scores, no rings, no animation, five regions at most | Ben asked for these numbers. They answer "how often, how long, what did I train". Proposed wording for the brief: *"Progress shows sessions, time in gym, muscle frequency and records over a chosen window (7/14/30/60 days), and per-exercise history with estimated 1RM, rep records and volume. No scores, rings or animated dashboards."* |

**Why not a separate pushed Stats screen** (the research's suggestion): Ben's asks *are* what he opens Progress for. A Stats screen behind a card would put them two taps away and leave a home screen with nothing to show for the planned-vs-done and pinned cards that can't be built yet. Making the windowed stats the home is fewer screens and fewer taps.

### 0.2 Data and method (kept from v0.1)

| # | Decision |
|---|---|
| PG7 | **Hard sets.** A completed, non-warm-up set counts if it is rated RPE ≥ 6 (RIR ≤ 4) **or has no rating**. Sets rated easier are left out and listed under `Not counted`. FitNotes imports have no ratings, so this matters: leaving unrated sets out would show almost nothing |
| PG9 | Drop sets count as hard sets (same as `summariseVolume`) |
| PG10 | **Records need history.** A record is shown only when its series has ≥ 3 earlier sessions (`RECORD_MIN_SESSIONS`, already in `packages/domain/src/session/records.ts`) and the new value is strictly better. Imports never cause a burst of records |
| PG11 | **Estimated 1RM**: Epley, `load × (1 + reps / 30)`, reps = 1 → load. Only from completed, non-warm-up, countable sets of 1–10 reps on `total`, `per_hand`, `stack` and `added`-to-machine conventions. Never for assisted, bodyweight, bodyweight + added, or timed sets. One value per session (that session's best eligible set), never smoothed or averaged across sessions. Shown with `≈` and `Est.`; rounded to 0.5 kg / 1 lb; never snapped (it isn't a target) |
| PG12 | **Gaps.** ≥ 21 days between sessions of a series (`TREND_GAP_DAYS`) breaks the chart line and shows `Gap 24 days` in the marker lane and table |
| PG15 | **One series = one equipment instance + load convention + unit** (or one import source). Different machines are never merged. The only exception is PG32, which Ben turns on explicitly |
| PG16 | **Days and weeks** use the owner's stored timezone. Weeks run Monday–Sunday. A session belongs to the local date it started (corrected start time if edited; `localDate` for imported workouts) |
| PG21 | **Sets Ben marked as not counting** (`Spotted`, `Pain`, `Form broke`, `Other equipment`; active-workout §2.13) are left out of top set, Est. 1RM, the rep table, records and every "best" or "change" value, and say so in lists (`100×8 (spotted)`). They **do** count in sessions, sets per muscle and volume, because the work was done. A session whose sets are all marked has no chart point; its marker reads `Not counted` |

### 0.3 New decisions in v1.0

| # | Decision | Default | Alternative / note |
|---|---|---|---|
| PG24 | **Windows** | `7 days` · `14 days` · `30 days` · `60 days`, each **ending today, inclusive** (30 days = today and the 29 days before). The previous window is the same length immediately before it. Default `30 days`; Ben's last choice is remembered (Your data, settings) | Calendar weeks instead of rolling days were considered and rejected: Ben asked for "last 7 / 14 / 30 / 60 days" |
| PG24a | **What counts as a session** | Every `finished` workout, logged or imported. Not `active`, `discarded` or `reverted`. Imported workouts count, because their dates are real | — |
| PG24b | **The bars** | `7 days` and `14 days`: a `DayStrip`, one cell per day. `30 days` and `60 days`: `WeekBars`, one bar per Monday–Sunday week that overlaps the window, counting **only sessions inside the window**. The first bar is usually a part week; its label is its first date in the window (`12 Sep`), not the Monday. The bars always add up to the session count | Rolling 7-day buckets were rejected: their edges don't match weeks Ben recognises |
| PG25 | **Time in gym** | Per session, the **same duration as the Summary's `Active time`** (`workoutDurationMs`: start to end, minus paused time inside that window). Shown as `Total` and `Avg` (mean per timed session) for the window, plus the previous window's total. **Left out**, and counted in a footnote: imported workouts (no times, ADR 0016), sessions with no end time, and sessions over `PROGRESS_DURATION_CAP` (**4 h**, domain constant) until Ben confirms or edits them | Ben asked for "average". The research recommends the median so one left-open workout can't distort it. The cap already removes that risk, so v1.0 uses the mean. **Ask Ben (O-PG3).** |
| PG25a | **Confirming a long session** | `Count it` stores `durationConfirmedAt` on the session (versioned, idempotent, Undo). `Edit times` opens the workout's existing time correction (`updateSessionTiming`). Neither changes a set | — |
| PG26 | **Body-part grouping** | The 11 catalogue groups (`MUSCLE_GROUPS` in `packages/catalogue/src/vocab.ts`): Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Core, Forearms, in that fixed order. Each muscle maps to one group (`MUSCLE_TO_GROUP`). **Sets:** a hard set gives **1** to each group among the exercise's `primaryMuscles` and **½** to each group among its `secondaryMuscles`. Each group gets at most one credit per set, the higher one (so `chest` + `upper_chest` is still 1 for Chest). Left + right sets of a unilateral exercise count once. **Sessions:** a session counts for a group when that group got **≥ 1 counted set that day** (helpers included). So `sets ≥ sessions` always holds | Counting only primary muscles for sessions was rejected: it would show `Triceps 0 sessions · 7½ sets`, which looks contradictory. The catalogue now has `secondaryMuscles` on every entry, so v0.1's PG8 gap is closed for catalogue exercises |
| PG27 | **Push/Pull/Legs grouping** | Each **exercise** belongs to exactly one of `Push` · `Pull` · `Legs` · `Core` · `Other`, from a fixed table (Coaching knowledge, rule 10). In order: (1) a `split` field on the catalogue entry if one is set; (2) else `muscleRegion()` (already in `packages/domain/src/session/first-run.ts`: primary muscle first, then movement pattern); (3) else `Other`. Conditioning and carries with no clear region go to `Other`. **Sets:** each hard set counts 1 for its exercise's group, so a bench set is 1 Push, not 1 + ½ + ½. **Sessions:** a session counts for a group when ≥ 1 hard set of that group was done. `Other` is shown only when it's above 0 | Liftosaur-style per-muscle splitting into PPL was rejected: summing helpers inside one group double-counts. Upper/Lower is a possible third grouping later (O-PG4) |
| PG28 | **Rep table** (exercise detail) | Two views of the same countable sets in the selected series and range. **By weight:** one row per load used, with the most reps done in one set at that load and the date. **By reps** (rep records): for each rep count 1–12, the heaviest load lifted for **at least** that many reps, with the date. A heavier or equal load at more reps supersedes (100 kg × 6 is also the 5RM), shown as `from 6 reps`. **Actual values only.** No estimated column in v1.0 | The research's optional `Est.` column is left out: the Est. 1RM chart already covers estimates, and a table that mixes the two invites misreading |
| PG29 | **Exercise detail default metric** | `Est. 1RM` when the convention allows it (PG11), else `Top set` (`Best set` for bodyweight, `Longest hold` for timed). Range default `6 mo` | v0.1 defaulted to `Top set`. Ben asked for e1RM first |
| PG30 | **Records on the home screen** | v1.0 record kinds: `Heaviest set` and `Most reps at <load>` (the logic in `findSetRecord`, judged as each set was logged), plus, in slice B, `Best Est. 1RM` (labelled). Only from workouts logged in the app; imported history can suppress a claim but never makes one (ADR 0016) | — |
| PG31 | **Volume** | Per session, Σ load × reps over completed non-warm-up sets (marked sets included, PG21). Unilateral: the busier side. Per-dumbbell loads use the per-hand value with the unit `kg each × reps`. Not offered for assisted, bodyweight or timed sets | Not a headline on the home screen: it rewards high-rep, light sets (research, Alpha) |
| PG32 | **Showing FitNotes history on an equipment's chart** | Imported sets have no equipment (ADR 0016), so they form their own series, `FitNotes`. Ben can choose **`Add FitNotes history`** in the series menu of one equipment series of the same exercise, convention and unit. The chart then shows both, with FitNotes points **hollow** (○) and app points **filled** (●). Table, rep table and records rows from FitNotes carry a `FitNotes` tag. Stored per exercise as a `SeriesLink` (Your data), versioned, with Undo and `Remove FitNotes history` in the same menu. It changes no stored set, nothing in the workout loop (`Last`, targets, the in-workout record line), and never links two app equipment series | Brief §6: "keep separate history per equipment instance **unless the user explicitly groups equivalent stations**". Without this, years of Ben's history sit in a separate chart from everything he logs from now on. **Ben to confirm (O-PG1).** |
| PG33 | **The window and in-progress workouts** | An unfinished workout is never counted. It appears in every number after `Finish` | Same as v0.1 |

---

## 1. Purpose

Progress answers **"How often am I training, for how long, what am I hitting, and are my lifts going up, by the numbers I actually logged?"**

| Screen | Question | Single primary action | Slice |
|---|---|---|---|
| Progress home (`Overview`) | Over the last 7 / 14 / 30 / 60 days: how many sessions, how much time, which muscles, any records? | Change the window (the picker). No accent-filled button except `Resume` in the `ResumeBar` or the empty state's action | A |
| Muscles | Which groups did I train, how many sessions and sets each, and from which exercises? | Expand a group to see what counted | A |
| Calendar | What did I do on a given day? | Open a workout | A |
| Exercises | Which lift do I want to look at? | Open an exercise | B |
| Exercise detail | How is this lift moving on this equipment: Est. 1RM, top set, best reps at each weight, volume, records? | Tap a point or row → open that workout | B |

Never shown anywhere in Progress: recovery, readiness, fatigue, fitness, "strength level" or any other score; percentage grades; rings; streak-loss messages; animated drawing or count-up numbers. Every value is an **actual result** or, where marked `≈` and `Est.`, an **estimate**. Progress shows no targets in v1.0.

---

## 2. Layout

### 2.1 Navigation map

```
Tab: Progress
 ├─ [Overview] (home)                                             slice A
 │   ├─ Window picker (7 / 14 / 30 / 60 days)
 │   ├─ Activity: StatStrip + bars ───────────► [Calendar] segment, month of today
 │   │    └─ time footnote ⓘ ─────────────────► Time sheet (exclusions, Count it / Edit times)
 │   ├─ Muscles · Body parts | Push/Pull/Legs
 │   │    ├─ row ─────────────────────────────► Muscles screen, that group expanded
 │   │    └─ ⓘ ───────────────────────────────► How this is counted (sheet)
 │   ├─ Records row ──────────────────────────► A: the workout's Summary · B: Exercise detail, point selected
 │   └─ Exercises ›                           ► Exercises list ─► Exercise detail      slice B
 └─ [Calendar]                                                    slice A
     └─ day ► workout row ────────────────────► Summary (existing screen, back to Calendar)

Exercise detail (slice B)
 ├─ series menu ─► Add / Remove FitNotes history (PG32)
 ├─ point / table row / rep-table row / record / history row ─► Summary of that workout
 └─ Est. 1RM ⓘ ─► How Est. 1RM is worked out (sheet)
```

Pushed screens use the standard back chevron and edge swipe. The `Ask` pill floats bottom-trailing on every Progress screen, above the `ResumeBar` when present, and attaches the current screen's context (`Progress · last 30 days`, `Bench press · Main Gym barbell · 6 mo`).

Past workouts open the **existing Summary screen** (workout-summary.md, `back: true`), as the current Progress list does. A dedicated history mode for it is workout-summary's concern, not this spec's.

### 2.2 Progress home (`Overview`), slice A

Regions, top to bottom:

1. **Title.** Large title `Progress`, collapsing on scroll. Segmented `Overview | Calendar` (full width, 44pt).
2. **Window picker** (`WindowPicker`, design-system §9.69). Segmented `7 days | 14 days | 30 days | 60 days`, 44pt. Directly under it, one line: the window's dates, `12 Sep – 11 Oct` (`type.callout`, `text.secondary`).
3. **Activity.** One card, and the whole card is one button to Calendar.
   - `StatStrip` (§9.65): `SESSIONS 9` · `TIME 6 h 39 min` · `AVG 57 min`.
   - Bars: `DayStrip` (7 and 14 days) or `WeekBars` (30 and 60 days), PG24b.
   - Comparison line: `Previous 30 days: 7 sessions · 6 h 50 min`.
   - Footnote, only when sessions were left out of time: `ⓘ Time from 7 of 9 sessions` (a separate 44pt button → Time sheet, §2.3).
4. **Muscles.** Section label `MUSCLES` with `ⓘ` (→ How this is counted). A two-segment toggle `Body parts | Push/Pull/Legs` (44pt). Column headers `SESSIONS` and `SETS`. Then `FrequencyRow`s (§9.72):
   - Body parts: all 11 groups in fixed order. Groups at 0 show `0` and `0` in `text.tertiary`, so a muscle Ben hasn't trained is visible, not missing.
   - Push/Pull/Legs: `Push`, `Pull`, `Legs`, `Core`, then `Other` only if > 0.
   - Each row is a button → Muscles screen with that group expanded.
   - Under the rows, only when some exercises have no muscles: `2 exercises have no muscles set ›` (→ Muscles screen, `Not counted`).
5. **Records.** Section label `RECORDS`. Up to 3 rows, newest first, then `All records (5) ›` when there are more (slice B; in slice A the extra rows simply list inline up to 5). (Build: `All records (n) ›` lists the rest in place on the home, as exercise detail's `Show all`; designer to confirm or name a destination.) None: one line, `No new records in the last 30 days.`
6. **Exercises ›** (slice B). One row → Exercises list.
7. **ResumeBar** (conditional, fixed above the tab bar).

```
┌────────────────────────────────────────┐
│ Progress                               │ large title
│ [     Overview     |    Calendar    ]  │ segmented
│                                        │
│ [7 days][14 days][✓30 days][60 days]   │ WindowPicker
│ 12 Sep – 11 Oct                        │
│                                        │
│ ┌────────────────────────────────────┐ │ Activity card → Calendar
│ │  9        │ 6 h 39 min │ 57 min    │ │ StatStrip
│ │ SESSIONS  │ TIME       │ AVG       │ │
│ │                                    │ │
│ │  1     2     2     2     2         │ │ counts above bars
│ │  ▃     ▆     ▆     ▆     ▆         │ │ WeekBars
│ │ 12 Sep 14 Sep 21 Sep 28 Sep 5 Oct  │ │ first bar: Sat–Sun only
│ │ Previous 30 days: 7 sessions ·     │ │
│ │ 6 h 50 min                         │ │
│ └────────────────────────────────────┘ │
│ ⓘ Time from 7 of 9 sessions            │ → Time sheet
│                                        │
│ MUSCLES ⓘ                              │
│ [ Body parts  |  Push/Pull/Legs ]      │
│                    SESSIONS     SETS   │
│ Chest  ▇▇▇▇▇▇▇▇▇▇▇      3        14   │ FrequencyRow
│ Back   ▇▇▇▇▇▇▇▇▇▇▇▇     3        15   │
│ Shoulders ▇▇▇▇▇▇▇       4      10½   │
│ Biceps ▇▇▇▇             2         6   │
│ Triceps ▇▇▇▇▇▇          3       8½   │
│ Quads  ▇▇▇▇▇▇▇          2         9   │
│ Hamstrings ▇▇▇          2         4   │
│ Glutes ▇▇▇▇▇            2       7½   │
│ Calves                  0         0   │ text.tertiary
│ Core   ▇▇               1         3   │
│ Forearms                0         0   │
│                                        │
│ RECORDS                                │
│ Bench press · Main Gym               › │
│ Heaviest set  105 kg × 3 · 1 Oct       │
│ Seated row · Main Gym                › │
│ Most reps at 59 kg  12 · 7 Oct         │
│                                        │
│ Exercises                            › │ slice B
│                            ( 💬 Ask )  │
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
└────────────────────────────────────────┘
```

The bar in a `FrequencyRow` shows **sets**, on a scale from 0 to the largest row's sets in the current view. The numbers are always printed, so the bar is never the only carrier of the value.

**Push/Pull/Legs view** (same position, toggle on the second segment):

```
│ MUSCLES ⓘ                              │
│ [ Body parts  |✓ Push/Pull/Legs ]      │
│                    SESSIONS     SETS   │
│ Push   ▇▇▇▇▇▇▇▇▇▇▇▇▇    4        38   │
│ Pull   ▇▇▇▇▇▇▇▇▇▇       3        30   │
│ Legs   ▇▇▇▇▇▇▇▇         2        24   │
│ Core   ▇▇               1         6   │
```

**7 days** (`DayStrip`, one cell per day, oldest left; today's letter bold):

```
│ │  2        │ 1 h 58 min │ 59 min    │ │
│ │ SESSIONS  │ TIME       │ AVG       │ │
│ │  M   T   W   T   F   S   S         │ │ day letters (Mon 5 … Sun 11 Oct)
│ │  ·   ●   ·   ●   ·   ·   ·         │ │ ● workout · none; "2" if two
│ │ Previous 7 days: 3 sessions ·      │ │
│ │ 2 h 41 min                         │ │
```

`14 days` shows two `DayStrip` rows of 7, with the first date of each row at its leading edge (`28 Sep`, `5 Oct`).

**With an unfinished workout:**

```
│                            ( 💬 Ask )  │
├────────────────────────────────────────┤
│ ▶ Push A · Rest 1:12        [ Resume ] │ ResumeBar, 60pt
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
```

### 2.3 Time sheet (from the time footnote), slice A

Medium-detent sheet, title `Time in gym`. It lists only what was left out, grouped, then the method.

```
┌────────────────────────────────────────┐
│ Time in gym                       Done │
│                                        │
│ Last 30 days: 7 of 9 sessions          │
│                                        │
│ OVER 4 H                               │
│ Fri 2 Oct · Push A · 5 h 12 min        │
│ [ Count it ]   [ Edit times ]          │ 44pt outline pills
│                                        │
│ NO TIMES                               │
│ 1 imported from FitNotes               │
│                                        │
│ Time is start to finish, minus pauses, │
│ the same as each workout's summary.    │
└────────────────────────────────────────┘
```

`Count it` → `confirmSessionDuration`; the row disappears, the home recomputes, toast `Counted Push A, 5 h 12 min` [Undo]. `Edit times` → the workout's time correction; saving returns here, recomputed.

### 2.4 Muscles screen, slice A

Pushed from a muscle row on home. It uses the **same window** as home and the same toggle; changing either here changes it on home too (one shared setting).

Regions: nav bar `Muscles`; `WindowPicker`; toggle; dates line; one expandable `FrequencyRow` per group, with an extra `PER WEEK` column for windows of 14 days or more (sets ÷ weeks in the window, one decimal); `Not counted`; `How this is counted ›`.

```
┌────────────────────────────────────────┐
│ ‹ Progress        Muscles              │
│ [7 days][14 days][✓30 days][60 days]   │
│ [ Body parts  |  Push/Pull/Legs ]      │
│ 12 Sep – 11 Oct                        │
│               SESSIONS  SETS  PER WEEK │
│ Chest            3       14     3.3  ⌄ │ expanded
│ ▇▇▇▇▇▇▇▇▇▇▇                            │
│   Last trained 8 Oct                   │
│   Bench press     8 sets × 1 = 8       │ contributors
│   Incline DB press 4 sets × 1 = 4      │
│   Dip             4 sets × ½ = 2       │
│ Back             3       15     3.5  › │
│ …                                      │
│ Calves           0        0     0    › │
│   Last trained 14 Aug                  │ shown when 0 in window
│                                        │
│ NOT COUNTED                            │
│ 22 warm-up sets · 2 rated under RPE 6  │
│ Plate pinch: no muscles set (3 sets) › │ → set muscles (custom)
│                                        │
│ How this is counted ›                  │
└────────────────────────────────────────┘
```

In the Push/Pull/Legs view, the expanded lines list exercises with their sets (`Bench press  8 sets`) and no factor, because each set counts 1 for one group (PG27).

**How this is counted** (sheet; the only place the method is explained):

> **Sets** are completed working sets rated RPE 6 or harder, or not rated. Warm-ups and easier sets aren't counted.
> **Body parts:** a set counts 1 for the muscles an exercise mainly works and ½ for helpers. Bench press: 1 chest, ½ shoulders, ½ triceps.
> **Push/Pull/Legs:** each exercise belongs to one group, and each set counts 1 there.
> **Sessions** are workouts with at least 1 counted set for that group.
> Sets you marked spotted, painful or with form breaking still count here, because you did the work.

(v1.0 had a last line, "This counts work done. It doesn't measure recovery or fatigue." It was dropped in build because check 23 bars "recovery" and "fatigue" on every Progress screen; review progress-A SP1.)

### 2.5 Calendar, slice A

`Calendar` segment. Regions: month header `‹  October 2026  ›` (44pt buttons; horizontal swipe does the same); weekday row (Mon first); month grid (`CalendarDay`, §9.30: `●` workout; `●2` for two); legend `● workout`; the **day list** for the selected day (default: today, else the latest day with a workout in the shown month).

```
┌────────────────────────────────────────┐
│ Progress                               │
│ [     Overview     |    Calendar    ]  │
│ ‹          October 2026            ›   │
│  M    T    W    T    F    S    S       │
│            1    2    3    4            │
│            ●    ●                      │
│  5    6    7   (8)   9   10   11       │ (8) selected; today ringed
│  ●         ●    ●                      │
│ …                                      │
│ ● workout                              │
│                                        │
│ Thu 8 Oct                              │
│ Push A · Main Gym                    › │ → Summary
│ 18:02–19:04 · 54 min · 16 sets         │
│                                        │
│ Fri 2 Oct                              │
│ Imported · 22 sets               ›     │ imported: no times
└────────────────────────────────────────┘
```

Tapping the Activity card on home opens Calendar on the current month with today selected. Planned sessions, deload tags and endurance glyphs are deferred (§9).

### 2.6 Exercises list, slice B

Pushed from `Exercises ›`. Search field (system keyboard, `Search` return key, `Cancel`), then rows sorted by last done: `Bench press` / `24 sessions · last 8 Oct`. Only exercises with ≥ 1 finished session appear. Filter chips by body part (the 11 groups, same as the exercise library) in a horizontal row that wraps at AX sizes.

### 2.7 Exercise detail, slice B

Pushed from the Exercises list, a home record, or the Summary's exercise rows (later).

Regions:
1. **Nav bar.** Back, exercise name.
2. **Pain line** (only while a pain flag is active for this exercise): `⚠ Pain flag since 2 Oct` (`StatusBanner`, warning, icon + words). Tapping opens the existing pain flag view. Spans on the chart and the pre-flag reference are deferred (§9).
3. **Series menu.** Button `Main Gym · barbell ▾`. Lists each series with its session count (`Main Gym · barbell · 24`, `Hotel Gym · barbell · 3`, `FitNotes · kg · 40`), then `Add FitNotes history` / `Remove FitNotes history` (PG32, only when a FitNotes series of the same convention and unit exists). Default: the series used most in the last 12 weeks.
4. **`StatStrip`** for the selected series, all-time bests: `EST. 1RM ≈126.5 kg` (the best session value) · `BEST SET 105 × 3` (heaviest) · `SESSIONS 24`. Conventions without Est. 1RM show `BEST SET` · `MOST REPS` · `SESSIONS` (bodyweight), or `LEAST ASSIST` · `MOST REPS` · `SESSIONS` (assisted).
5. **Metric chips** (single select): `Est. 1RM` · `Top set` · `Volume`. Unavailable ones are hidden (§6.3).
6. **Range chips:** `3 mo` · `6 mo` · `1 yr` · `All`.
7. **Chart heading.** `Est. 1RM · 9 Apr – 8 Oct  ⓘ` / `Top set · 9 Apr – 8 Oct` / `Volume · 9 Apr – 8 Oct`. The `ⓘ` (Est. 1RM only) opens a sheet with the formula and limits.
8. **`TrendChart`** (§9.23): one series (PG32 adds hollow FitNotes points to the same series), y-axis with unit, month ticks, marker lane (gap, edited, not counted), gap breaks. `Volume` draws bars (`chart.bar`), not a line.
9. **Selection panel** (fixed height). Nothing selected: `Latest`, `Best`, `Change` for the range. Point selected: that session's date, workout name, value, the set it came from, markers, `Open workout ›`, `Clear`.
10. **`Show as table`** button (always visible).
11. **Rep table** (`RepTable`, §9.73). Section label `BEST REPS`, toggle `By weight | By reps`. Uses the **selected range**. By weight lists up to 10 loads, heaviest first, then `Show all (17)`.
12. **Records.** Section label `RECORDS`. Every record for this series, newest first, up to 5 + `Show all`.
13. **History.** Sessions by month, newest first, each row: date · workout, then the working sets (`102.5×6 · 100×8 · 100×7`), tags (`Edited`, `FitNotes`, `100×8 (spotted)`). `Load September` pages back.

```
┌────────────────────────────────────────┐
│ ‹ Exercises     Bench press            │
│ [ Main Gym · barbell ▾ ]               │ series menu
│                                        │
│ ≈126.5 kg │ 105 × 3    │ 24           │ StatStrip (all-time bests)
│ EST. 1RM  │ BEST SET   │ SESSIONS     │
│                                        │
│ [✓Est. 1RM] [Top set] [Volume]         │ metric chips
│ [3 mo] [✓6 mo] [1 yr] [All]            │ range chips
│                                        │
│ Est. 1RM · 9 Apr – 8 Oct            ⓘ  │
│ kg                                     │
│ 125 ┤                                  │
│     ┤                      ●──●        │
│ 120 ┤             ●──●──●╯    ╲●       │
│     ┤   ●──●──●──╯                     │
│ 115 ┤●─╯                               │
│     └┬──────┬──────┬──────┬──────┬──   │
│     Apr    May    Jun    Jul    Aug  … │
│                  ⋯ Gap 24 days  ✎      │ marker lane
│                                        │
│ Latest  ≈123 kg · 8 Oct                │ selection panel
│ Best    ≈126.5 kg · 24 Sep (100 × 8)   │
│ Change  Up ≈6 kg since 9 Apr           │
│ [ Show as table ]                      │
│                                        │
│ BEST REPS       [ By weight | By reps ]│
│ Weight          Reps      Date         │
│ 105 kg            3       1 Oct        │
│ 102.5 kg          6       8 Oct        │
│ 100 kg            8       24 Sep       │
│ 97.5 kg           8       14 Sep       │
│ 95 kg            10       2 Aug        │
│ Show all (9)                           │
│                                        │
│ RECORDS                                │
│ Heaviest set   105 kg × 3 · 1 Oct      │
│ Most reps at 100 kg  8 · 24 Sep        │
│ Best Est. 1RM  ≈126.5 kg · 24 Sep      │
│                                        │
│ HISTORY                                │
│ October                                │
│ Thu 8 Oct · Push A                   › │
│ 102.5×6 · 100×8 · 100×7 · 100×7        │
│ …                                      │
│                            ( 💬 Ask )  │
└────────────────────────────────────────┘
```

**By reps:**

```
│ BEST REPS       [ By weight |✓By reps ]│
│ Reps   Heaviest                Date    │
│ 1      105 kg   from 3 reps    1 Oct   │
│ 2      105 kg   from 3 reps    1 Oct   │
│ 3      105 kg                  1 Oct   │
│ 4      102.5 kg from 6 reps    8 Oct   │
│ 5      102.5 kg from 6 reps    8 Oct   │
│ 6      102.5 kg                8 Oct   │
│ 7      100 kg   from 8 reps    24 Sep  │
│ 8      100 kg                  24 Sep  │
│ 9      95 kg    from 10 reps   2 Aug   │
│ 10     95 kg                   2 Aug   │
│ 11     —                               │
│ 12     —                               │
```

Rows stop at the highest rep count actually done (up to 12). `—` rows are shown only between done counts, never past the last.

**Point selected** (the panel swaps in place, nothing covers the chart; the point gets a larger ring and a vertical guide line):

```
│ Thu 1 Oct · Push A                     │
│ Est. 1RM  ≈115.5 kg  from 105 kg × 3   │
│ Open workout ›                Clear ×  │
```

**With FitNotes history added** (PG32): series button `Main Gym · barbell + FitNotes ▾`; under the chart a one-line legend `● Logged here  ○ FitNotes`; table and history rows from FitNotes carry the `FitNotes` tag.

**Est. 1RM ⓘ sheet:**

> **Est. 1RM** is an estimate of the most you could lift once, worked out from your best set each session: weight × (1 + reps ÷ 30) (Epley).
> Only sets of 1–10 reps are used. Warm-ups and sets you marked spotted, painful or with form breaking aren't used.
> It's an estimate, not a target.

---

## 3. States

### 3.1 Progress home

| State | Trigger | Display |
|---|---|---|
| Loading | Before `buildProgressHome` returns | Nothing for `timing.placeholderDelay` (300 ms), then static grey blocks in the region shapes. No shimmer |
| Empty | No finished workouts, logged or imported | Only one card: `Nothing to show yet` / `Log a workout or import your FitNotes history.` with `Go to Today` (primary) and `Import FitNotes history` (secondary → Profile → Data & backup → Import). No window picker, no chart frames, no headings. With a first workout in progress, the `ResumeBar` shows and `Go to Today` becomes secondary, so only one accent-filled button is on screen |
| Normal | ≥ 1 finished session ever | §2.2 |
| No sessions in window | 0 in the window, older ones exist | `StatStrip` shows `0` · `—` · `—`. Bars are drawn at 0 with their labels (the empty days are the information). Line: `Last workout: Fri 14 Aug`. Muscles: every row `0 · 0`. Records: `No new records in the last 7 days.` |
| Only imported in window | Every session in the window is imported | `TIME —`, `AVG —`; footnote `ⓘ No times for imported workouts` |
| Some sessions left out of time | PG25 | Footnote `ⓘ Time from 7 of 9 sessions` |
| All timed sessions over the cap | — | `TIME —`, footnote `ⓘ Time from 0 of 3 sessions` |
| Previous window empty | Nothing before the window | Comparison line: `Previous 30 days: none` |
| Two workouts on one day | — | `DayStrip` cell shows `2` instead of `●`; VoiceOver "2 workouts" |
| Muscles: some exercises without muscles | Custom or imported-only exercises with no muscles | Line `2 exercises have no muscles set ›` under the rows. Their sets count in Sessions but in no muscle row |
| Muscles: none at all | No counted sets have muscles | Rows hidden; one line `No muscles set on these exercises.` + `Set muscles ›` |
| Records: none | No qualifying record in the window | `No new records in the last 30 days.` (one line, no frame) |
| Workout in progress | Unfinished, < 6 h | `ResumeBar`; the workout isn't counted until it's finished (PG33) |
| Workout finished while on Progress | — | Numbers recompute on focus. No animation |
| Set or time corrected elsewhere | `correctSet`, `updateSessionTiming`, `Count it` | Every number recomputes (nothing is cached past the data version) |
| Offline / AI unavailable | No network, no coach | No change at all. Progress is local. The `Ask` pill shows its own status (`Offline` / `Not connected`) |
| Database error | SQLite read failed | `Couldn't open your training data.` [Try again] + `Restore from backup` (same as Today) |
| Unreadable workouts | Some rows fail validation | Numbers use the readable ones; a warning line at the bottom: `⚠ 2 workouts couldn't be read and aren't counted.` (kept from the current screen) |

### 3.2 Muscles screen

| State | Display |
|---|---|
| Normal | §2.4 |
| Window < 14 days | No `PER WEEK` column |
| Group at 0 | Row `0 · 0`, `text.tertiary`; expanded line `Last trained 14 Aug` or `Not trained yet` |
| Sets rated under RPE 6 / warm-ups | Counted in `Not counted` |
| Marked sets in the window (PG21) | Line under `Not counted`: `3 sets you marked (spotted) are counted here.` |
| Custom exercise with no muscles | Listed under `Not counted` with `›` → the exercise's muscle editor (exercise-library.md); after saving, the home recomputes; toast `Muscles saved` [Undo] |

### 3.3 Calendar

| State | Display |
|---|---|
| Month with no workouts | Grid with no glyphs; day list `No workouts in October.` |
| Day with no workout | `Nothing logged on Tue 6 Oct.` |
| Imported workout | Row `Imported · 22 sets` (no times, no gym if not recorded) |
| Unfinished workout | Row `In progress · Resume ›` (< 6 h) or `Unfinished · Finish on Today ›` (stale) |
| Discarded / reverted | Not shown |

### 3.4 Exercise detail

| State | Trigger | Display |
|---|---|---|
| Normal | ≥ 3 points in range | §2.7 |
| Too few points | 1–2 sessions in range | No chart frame. `2 sessions in this range.` + `Try 1 yr` button when a wider range would have ≥ 3. Panel, rep table, records and history still show |
| None in range | 0 in range, older exist | `None between 9 Apr and 8 Oct. Last: 2 Feb.` + `Show all` button |
| Est. 1RM: no eligible sets | Every set in range has > 10 reps | Chart area: `No sets of 10 reps or fewer in this range.` Chip stays (other ranges may have some) |
| Convention without Est. 1RM | assisted, bodyweight, bodyweight + added, timed | Chip hidden; default metric per PG29 |
| Long history | > 150 points in range | One point per week (the week's best); heading adds `· weekly best`. Table and history list every session. The range summary's `Latest`, `Best` and `Change` still describe sessions (the last and first session in range), not weeks (build, review progress-B B1/SP3; designer to confirm) |
| Only FitNotes history | The exercise has no logged sessions | Series `FitNotes · kg`; everything works; records section `Records start after 3 logged sessions.` (PG30) |
| FitNotes history added (PG32) | `SeriesLink` exists | Hollow points, legend, `FitNotes` tags |
| Marked sets (PG21) | A session has marked sets | Value from the best unmarked set; history `100×8 (spotted)`; all marked → no point, marker `Not counted` |
| Corrected set | `correctSet` in range | Recomputed; marker lane `✎ Edited` on that date |
| Gap | ≥ 21 days | Line breaks; marker `⋯ Gap 24 days` |
| Pain flag active | Active flag on this exercise | Pain line (region 2) |
| Point selected | Tap or VoiceOver adjust | Panel shows the session |
| Table view | `Show as table` | `ChartDataTable` replaces the chart |
| Series menu change while a point is selected | — | Selection clears |

### 3.5 Transitions

```
Window picker ─ change ─► every home card recomputes at once (no animation)
Body parts ⇄ Push/Pull/Legs ─► rows swap at once; shared with the Muscles screen
Overview ⇄ Calendar (segmented; each keeps its scroll position)
Activity card ─► Calendar (current month, today selected)
Time footnote ─► Time sheet ─ Count it ─► home recomputed + Undo toast
Muscle row ─► Muscles screen (that group expanded)
Exercises ─► Exercise detail ─ point/row ─► Summary ─ back ─► Exercise detail (selection kept)
Series menu ─ Add FitNotes history ─► confirm ─► combined series + Undo toast
ResumeBar ─ Resume ─► Active workout (one tap)
```

---

## 4. Interactions

### 4.1 Home and Muscles

| Element | Behaviour |
|---|---|
| `Overview / Calendar` | Switches view |
| Window picker | Single select; all cards recompute without animation; choice saved (`setProgressWindow`). `haptic.step` |
| Activity card | Opens Calendar |
| Time footnote | Opens the Time sheet |
| `Count it` | `confirmSessionDuration(sessionId, expectedVersion, opId)`; toast with Undo |
| `Edit times` | Opens the workout's time correction (existing `updateSessionTiming` flow) |
| Muscles toggle | Switches grouping; saved (`setProgressGrouping`) |
| Muscle row | Opens the Muscles screen with that row expanded and scrolled into view |
| Muscles `ⓘ` | How this is counted sheet |
| Muscles screen row | Expands / collapses in place (no animation under Reduce Motion; ≤ 150 ms otherwise) |
| Record row | Slice A: opens that workout's Summary. Slice B: opens Exercise detail on that series with the record's point selected |
| `Exercises ›` | Exercises list |
| `ResumeBar` | Resumes the workout (whole bar is the target) |
| Pull to refresh | Not used. Data is local and current |

### 4.2 Exercise detail

| Element | Behaviour |
|---|---|
| Series menu | iOS menu. Selecting redraws at once; the choice is remembered per exercise |
| `Add FitNotes history` | Confirmation sheet: `Show 40 FitNotes sessions (2019–2026) with Main Gym · barbell?` [Add] [Cancel]. `linkImportedSeries`; toast `FitNotes history added` [Undo] |
| `Remove FitNotes history` | Immediate; toast `FitNotes history removed` [Undo] |
| Metric / range chips | Single select, redraw at once |
| Chart tap | Selects the nearest point by date (the whole plot is the hit area, so small points don't need 44pt). Tap the same point or `Clear` to deselect |
| Chart drag | Scrubs point to point with `haptic.step`. Optional: tap, the table and the history do the same |
| `ⓘ` | Est. 1RM sheet |
| `Show as table` / `Show chart` | Toggles. With VoiceOver running, the first open defaults to the table |
| Rep table toggle | `By weight` / `By reps`; remembered per exercise |
| Rep table row, record, history row | Opens that workout's Summary |
| `Show all` | Expands in place |
| `Load September` | Next month of history |

### 4.3 Keyboard

Only the Exercises list search uses a keyboard. Nothing is logged on Progress, so the "primary above the keyboard" rule isn't affected.

### 4.4 Voice and coach

- No spoken cues on Progress, ever.
- `Ask` (long-press Talk) works on every Progress screen, with the screen's context attached: "how many times did I train legs this month?", "is my bench going up?". The coach answers through its read tools using the same functions as these screens (§6) and labels estimates. Offline or not connected, the sheet says so; there's never a canned answer.
- VoiceOver is the main non-visual route (§7).

### 4.5 Undo paths

| Action | Undo |
|---|---|
| `Count it` (long session) | Toast [Undo] (`timing.undoToast`) |
| Add / remove FitNotes history | Toast [Undo]; or the opposite menu item later |
| Muscles set on a custom exercise | Toast [Undo]; editable later in the exercise library |
| Window / grouping / table toggles | Not data; just change them back |

---

## 5. Copy

Every number uses tabular numerals and design-system §3 formats. Estimates always have `≈` and `Est.`. Nothing on Progress is a target.

### 5.1 Home

| Element | Text | Kind |
|---|---|---|
| Title, segments | `Progress` · `Overview` · `Calendar` | — |
| Window | `7 days` · `14 days` · `30 days` · `60 days`; dates line `12 Sep – 11 Oct` | — |
| Stat labels | `SESSIONS` · `TIME` · `AVG` | — |
| Stat values | `9` · `6 h 39 min` (≥ 100 h: `104 h`) · `57 min` · missing `—` | Actual |
| Bars | Week labels `12 Sep` · `14 Sep`; day letters `M T W T F S S`; count above each bar | Actual |
| Comparison | `Previous 30 days: 7 sessions · 6 h 50 min` · `Previous 30 days: none` · no time: `Previous 30 days: 7 sessions` | Actual |
| No sessions | `Last workout: Fri 14 Aug` | Actual |
| Time footnote | `Time from 7 of 9 sessions` · `No times for imported workouts` | — |
| Muscles | `MUSCLES` · `Body parts` · `Push/Pull/Legs` · headers `SESSIONS` `SETS` · groups as §0.3 · `2 exercises have no muscles set ›` · `No muscles set on these exercises.` `Set muscles ›` | Actual |
| Records | `RECORDS` · line 1 `Bench press · Main Gym` · line 2 `Heaviest set  105 kg × 3 · 1 Oct` · `Most reps at 100 kg  9 · 5 Oct` · slice B `Best Est. 1RM  ≈126.5 kg · 24 Sep` · `All records (5) ›` · `No new records in the last 30 days.` | Actual; estimate labelled |
| Exercises | `Exercises` | — |
| Empty | `Nothing to show yet` / `Log a workout or import your FitNotes history.` · `Go to Today` · `Import FitNotes history` | — |
| Error | `Couldn't open your training data.` · `Try again` · `Restore from backup` | — |
| Unreadable | `2 workouts couldn't be read and aren't counted.` | — |
| ResumeBar | `Push A · Rest 1:12` / `· Ready` / `· Paused` · `Resume` | — |

### 5.2 Time sheet

| Element | Text |
|---|---|
| Title | `Time in gym` · `Done` |
| Count line | `Last 30 days: 7 of 9 sessions` |
| Groups | `OVER 4 H` · `NO TIMES` · `NO END TIME` |
| Rows | `Fri 2 Oct · Push A · 5 h 12 min` · `1 imported from FitNotes` |
| Buttons | `Count it` · `Edit times` |
| Toast | `Counted Push A, 5 h 12 min` [Undo] |
| Method | `Time is start to finish, minus pauses, the same as each workout's summary.` |

### 5.3 Muscles screen

| Element | Text |
|---|---|
| Title | `Muscles` |
| Headers | `SESSIONS` · `SETS` · `PER WEEK` |
| Expanded | `Last trained 8 Oct` · `Not trained yet` · `Bench press  8 sets × 1 = 8` · `Dip  4 sets × ½ = 2` · PPL: `Bench press  8 sets` |
| Not counted | `NOT COUNTED` · `22 warm-up sets · 2 rated under RPE 6` · `Plate pinch: no muscles set (3 sets) ›` · `3 sets you marked (spotted) are counted here.` |
| Link | `How this is counted ›` (sheet text in §2.4) |
| Toast | `Muscles saved` [Undo] |

### 5.4 Calendar

| Element | Text |
|---|---|
| Month | `October 2026` |
| Legend | `● workout` |
| Day list | `Push A · Main Gym` / `18:02–19:04 · 54 min · 16 sets` · imported `Imported · 22 sets` |
| Empty | `No workouts in October.` · `Nothing logged on Tue 6 Oct.` |
| Unfinished | `In progress · Resume ›` · `Unfinished · Finish on Today ›` |

### 5.5 Exercises list and exercise detail

| Element | Text | Kind |
|---|---|---|
| List | `Exercises` · search placeholder `Search` · row `Bench press` / `24 sessions · last 8 Oct` | — |
| Series | `Main Gym · barbell` · `Hotel Gym · barbell` · `FitNotes · kg` · `Main Gym · barbell + FitNotes` · menu items `Add FitNotes history` · `Remove FitNotes history` | — |
| Add confirm | `Show 40 FitNotes sessions (2019–2026) with Main Gym · barbell?` · `Add` · `Cancel` · toasts `FitNotes history added` / `FitNotes history removed` [Undo] | — |
| StatStrip | `EST. 1RM ≈126.5 kg` · `BEST SET 105 × 3` · `SESSIONS 24` · `MOST REPS 14` · `LEAST ASSIST 15 kg` | Estimate / actual |
| Metric chips | `Est. 1RM` · `Top set` · `Volume` · bodyweight `Best set` · timed `Longest hold` | — |
| Range chips | `3 mo` · `6 mo` · `1 yr` · `All` | — |
| Headings | `Est. 1RM · 9 Apr – 8 Oct` · `Top set · …` · `Volume · …` · suffix `· weekly best` | As named |
| Axis units | `kg` · `kg each` · `kg stack` · `reps` · `kg × reps` | — |
| Range summary | `Latest  ≈123 kg · 8 Oct` · `Best  ≈126.5 kg · 24 Sep (100 × 8)` · `Change  Up ≈6 kg since 9 Apr` · top set: `Latest  102.5 kg × 6 · 8 Oct` · `Change  Up 7.5 kg since 9 Apr` · `Same load, 2 more reps than 9 Apr` | Estimate / actual |
| Selection | `Thu 1 Oct · Push A` · `Est. 1RM  ≈115.5 kg  from 105 kg × 3` · `Top set  105 kg × 3` · `Open workout ›` · `Clear` | — |
| Legend (PG32) | `● Logged here  ○ FitNotes` | — |
| Markers | `Gap 24 days` · `Edited` · `Not counted` | — |
| Too few / none | `2 sessions in this range.` · `Try 1 yr` · `None between 9 Apr and 8 Oct. Last: 2 Feb.` · `Show all` · `No sets of 10 reps or fewer in this range.` | — |
| Table toggle | `Show as table` / `Show chart` | — |
| Rep table | `BEST REPS` · `By weight` · `By reps` · headers `Weight` `Reps` `Date` / `Reps` `Heaviest` `Date` · `from 6 reps` · `—` · `Show all (9)` | Actual |
| Records | `RECORDS` · `Heaviest set  105 kg × 3 · 1 Oct` · `Most reps at 100 kg  8 · 24 Sep` · `Best Est. 1RM  ≈126.5 kg · 24 Sep` · assisted `Least assistance for 8+ reps  15 kg · 2 Oct` · bodyweight `Most reps  14 · 3 Oct` · `Records start after 3 logged sessions.` (Build: timed series have no records section until a record is defined, review progress-B SP2) | Actual; estimate labelled |
| History | `HISTORY` · month `October` · `Thu 8 Oct · Push A` · `102.5×6 · 100×8` · tags `Edited` · `FitNotes` · `(spotted)` · `Load September` | Actual |
| Pain line | `Pain flag since 2 Oct` | — |
| ⓘ sheet | Text in §2.7 | — |

### 5.6 VoiceOver labels (examples)

| Element | Label |
|---|---|
| Window picker | "Window, 30 days, 3 of 4. 12 September to 11 October." |
| StatStrip | "9 sessions. Time in gym 6 hours 39 minutes. Average 57 minutes per session." |
| WeekBars | "Sessions per week: from 12 September, 1; 14 September, 2; 21 September, 2; 28 September, 2; 5 October, 2." |
| DayStrip | "Last 7 days: Tuesday 6 October, 1 workout; Thursday 8 October, 1 workout. Other days none." |
| Activity card | "…, previous 30 days 7 sessions, 6 hours 50 minutes. Opens calendar." |
| Time footnote | "Time from 7 of 9 sessions. Shows what was left out." |
| FrequencyRow | "Triceps, 3 sessions, 8 and a half sets." |
| Record row | "Bench press, Main Gym. Heaviest set, 105 kilograms by 3, 1 October." |
| Est. 1RM chart | "Estimated one-rep max, an estimate, Bench press on Main Gym barbell, 9 April to 8 October. 18 sessions. Lowest about 115.5 kilograms on 1 October, highest about 126.5 on 24 September, latest about 123 on 8 October. One gap of 24 days in August. Swipe up or down to move between sessions." |
| Point | "Thursday 1 October, estimated one-rep max about 115.5 kilograms, from 105 kilograms by 3. Double-tap to open the workout." |
| Rep table row | "8 reps, heaviest 100 kilograms, 24 September." / "5 reps, heaviest 102.5 kilograms, from a set of 6, 8 October." |

---

## 6. Data needed

All Progress reads are local and pure: they're computed from finished sessions with corrections applied (the same projection as `toHistorySessions`), and recomputed when the data version changes. Nothing is stored as "the record" or "the trend". **The UI computes nothing**: it renders view models from these functions. Each function takes `nowMs` and a timezone so tests are deterministic.

### 6.1 Existing functions used

`toHistorySessions`, `summariseVolume`, `workoutDurationMs` (`packages/domain/src/session/view.ts`), `isSetCountable` (`exclusions.ts`), `findSetRecord` / `sessionRecords` / `RECORD_MIN_SESSIONS` (`session/records.ts`), `muscleRegion` (`session/first-run.ts`), `MUSCLE_GROUPS` / `MUSCLE_TO_GROUP` (`packages/catalogue/src/vocab.ts`), `compareDifficulty`, `correctSet`, `updateSessionTiming`, `getActiveSession`, `buildWorkoutSummary`, the repeat/candidates read the current Progress list uses (for unreadable counts).

### 6.2 New functions (developer contracts)

**Slice A** (`packages/domain/src/progress/`, pure, unit-tested):

| Function | Returns / behaviour |
|---|---|
| `progressWindow(localDate, days: 7 \| 14 \| 30 \| 60, tz)` | `{from, to, previous: {from, to}}` as local dates, inclusive (PG24) |
| `countSessions(sessions, window)` | `{count, previousCount, perWeek (one decimal, windows ≥ 14), days?: [{date, count}] (7/14), weeks?: [{label, from, to, count, partial}] (30/60), lastSessionDate}`; bars sum to `count` (PG24b) |
| `timeInGym(sessions, window, nowMs)` | `{totalMs, avgMs, timedCount, sessionCount, previousTotalMs, excluded: {imported, noEnd, overCap: [{sessionId, title, date, durationMs}]}}`; uses `workoutDurationMs`; `PROGRESS_DURATION_CAP = 4 h`; a session with `durationConfirmedAt` is never over the cap (PG25) |
| `isHardSet(set)` | PG7 rule: completed, non-warm-up, not deleted/skipped, RPE ≥ 6 / RIR ≤ 4 or unrated. Marked sets **are** hard sets here (PG21) |
| `muscleGroupCredits(exercise)` | `Map<MuscleGroup, 1 \| 0.5>` from primary/secondary muscles, max credit per group (PG26) |
| `exerciseSplit(exercise)` | `'push' \| 'pull' \| 'legs' \| 'core' \| 'other'` (PG27): catalogue `split` if set, else `muscleRegion`, else `other` |
| `muscleFrequency(sessions, exercises, window, grouping: 'body_part' \| 'ppl')` | `{rows: [{group, sessions, sets (in halves), perWeek?, lastTrained, contributors: [{exerciseId, name, sets, factor}]}], notCounted: {warmups, easy, noMuscles: [{exerciseId, name, sets}]}, markedCounted}`; rows in fixed order, zero rows included |
| `recordsInWindow(sessionsByExercise, window, limit)` | `[{exerciseId, seriesLabel, sessionId, kind: 'heaviest' \| 'most_reps_at_load' \| 'best_e1rm', text, date, isEstimate}]` newest first, built on `findSetRecord` (each set judged against what came before it); `best_e1rm` added in slice B |
| `buildProgressHome(ownerId, localDate, window, grouping)` (service, `apps/mobile`) | One call: `{dataState: 'empty' \| 'normal', window, sessions, time, muscles, records: {items, total}, resume, unreadable}`. No AI dependency |
| `buildCalendarMonth(ownerId, month)` | `{days: [{date, sessions: [{sessionId, title, gym, start?, end?, activeMs?, workingSets, imported, state}]}]}` |
| `confirmSessionDuration(sessionId, expectedVersion, opId)` (persistence + service) | Sets `durationConfirmedAt` (Your data); idempotent per `opId`; stale version rejected; returns an undo token |
| `setProgressWindow(days)` / `setProgressGrouping(g)` | Settings writes (Your data) |

**Slice B:**

| Function | Returns / behaviour |
|---|---|
| `listExerciseSeries(ownerId, exerciseId)` | `[{seriesKey, label, convention, unit, source: 'app' \| 'import', sessionCount, lastDate, linkedImport?: seriesKey}]`, where `seriesKey = {exerciseId, equipmentId \| 'import', convention, unit}` |
| `listProgressExercises(ownerId, {query?, group?})` | Exercises with ≥ 1 finished session: `{exerciseId, name, sessionCount, lastDate, groups}` sorted by last done |
| `estimateOneRepMax(load, reps, convention)` | Pure: `{value, eligible, reason?}` (PG11). Not snapped |
| `exerciseTrend(sessions, seriesKey, metric: 'e1rm' \| 'top_set' \| 'volume' \| 'best_set' \| 'longest_hold', range)` | `{points: [{sessionId, date, value, display, kind: 'actual' \| 'estimate', fromSet, source: 'app' \| 'import', excludedSets}], gaps, markers: [{kind: 'gap' \| 'edited' \| 'not_counted', date, label}], summary: {latest, best, change}, aggregation: 'session' \| 'weekly_best', a11ySummary}` |
| `repTable(sessions, seriesKey, range, by: 'weight' \| 'reps')` | By weight: `[{load, reps, date, sessionId, source}]` heaviest first. By reps: `[{reps 1..maxDone, load \| null, fromReps, date, sessionId, source}]` with the superseding rule (PG28). Countable sets only (PG21) |
| `exerciseRecords(sessions, seriesKey)` | `[{kind, value, display, date, sessionId, isEstimate, source}]`, with PG10 |
| `exerciseHeadline(sessions, seriesKey)` | The `StatStrip` values, all time, per convention |
| `exerciseHistory(sessions, seriesKey, monthCursor)` | One month page of session rows with tags |
| `linkImportedSeries(exerciseId, appSeriesKey, importSeriesKey, expectedVersion, opId)` / `unlinkImportedSeries(...)` | `SeriesLink` (Your data, backed up, versioned, undoable). Refuses different convention or unit (PG32) |

### 6.3 Metric availability by convention

| Convention | Est. 1RM | Top set | Volume | Rep table | StatStrip |
|---|---|---|---|---|---|
| `total`, `per_hand`, `stack`, plate-loaded `added` | Yes (1–10 reps) | Yes | Yes | Yes | Est. 1RM · Best set · Sessions |
| Assisted | No | Yes (least assistance) | No | Yes (assistance, lightest first) | Least assist · Most reps · Sessions |
| Bodyweight + added | No | Yes (added load) | No | Yes (added load) | Best set · Most reps · Sessions |
| Bodyweight | No | `Best set` (reps) | No (total reps in table only) | No | Most reps · Sessions |
| Timed | No | `Longest hold` | No | No | Longest hold · Sessions |

### 6.4 Schema additions (developer; Ben approves the PG32 one)

- `WorkoutSession.durationConfirmedAt?: ZonedTimestamp` (PG25a).
- `SeriesLink {id, ownerId, exerciseId, appSeriesKey, importSeriesKey, createdAt, version}` (PG32). Your data, in backups.
- Optional catalogue field `split?: 'push' | 'pull' | 'legs' | 'core' | 'other'` for entries where `muscleRegion` gets it wrong (PG27). Coaching knowledge. The exercise-researcher fills it only where needed.
- Settings: `progress.window`, `progress.grouping`, `progress.repTableBy` per exercise (optional).

---

## 7. Charts, accessibility and appearance

### 7.1 How charts are drawn (developer notes)

- **Skia only.** `@shopify/react-native-skia` 2.6.2 is already in the app (ADR 0013). No chart library is added. `TrendChart`, `WeekBars`, the `FrequencyRow` bars and the sparkline later are small components drawing `Path`, `Line`, `Circle` and `RoundedRect` on a `Canvas`.
- **No animation.** No Reanimated values drive the charts. Changing a chip, window or series redraws once.
- **Text is not drawn in Skia.** Axis labels, bar counts, week labels and units are React Native `Text` absolutely positioned over the canvas, so Dynamic Type, Bold Text and tabular numerals work like everywhere else. The canvas is hidden from VoiceOver (`accessibilityElementsHidden`); a wrapping `View` carries the summary.
- **Geometry is pure.** Scales, ticks, gap breaks, nearest-point lookup and bar heights come from a pure helper (`chartLayout(points, size)`) unit-tested in `apps/mobile` or `packages/domain`. The component only draws.
- **Hit testing:** a `Pressable` over the plot; `locationX` → nearest point by date. Drag scrubbing uses the responder events of that same view; no gesture library is required.
- **Colours** are the chart aliases in design-system §2.1, read from the current theme. **Direction D note:** D's `accent` (porcelain) is very close to `text.primary`, so a selected point must stand out by **size, ring and guide line**, not hue (design-system §2.1 revision). The trend line is never `accent`.
- **Points:** filled circle `chart.point` for logged sessions; hollow circle (2pt stroke, `bg.surface` fill) for FitNotes sessions (PG32). Shape carries the difference, not colour.

### 7.2 Accessibility

- **Charts are never the only route.** Every chart has a visible `Show as table`, a one-paragraph VoiceOver summary and an adjustable element (swipe up/down moves point to point). Bars have their numbers printed. The rep table, records and history are plain lists.
- **Not colour-only.** One series per chart. Markers are icon + word. Zero rows use `0` text as well as tertiary colour. Changes use arrow + `Up` / `Down` / `Same` in `text.secondary`, never status colours.
- **Dynamic Type.** All text uses type tokens (≥ 16pt, except Direction D's 12pt tracked section labels, which scale). At AX1+: the `WindowPicker` becomes a menu button `Last 30 days ▾`; `StatStrip` stacks; `FrequencyRow` puts the numbers on a second line and drops the bar; `DayStrip` becomes a list (`Thu 8 Oct · 1 workout`); `WeekBars` becomes a list (`Week from 14 Sep · 2`); the rep table stacks each row. Nothing scrolls horizontally at AX3.
- **Touch targets** ≥ 44 × 44: picker segments, toggles, chips, rows, calendar cells, `ⓘ` buttons. Chart points use the whole plot as the hit area.
- **Motion.** None beyond standard navigation, sheets and segmented controls.
- **Appearance.** All colours are tokens. Direction D is dark-only in code today (`schemeFor`); in Direction A both modes switch together. Increase Contrast: gridlines and bar edges 2pt `border.control`.
- **Focus order (home):** title → segments → window picker → dates → Activity → time footnote → Muscles (toggle, rows) → Records → Exercises → Ask → ResumeBar → tab bar.

---

## 8. Slices and acceptance checks

### Slice A: Progress home and Calendar

Builds: `WindowPicker`, Activity card (`StatStrip`, `DayStrip`, `WeekBars`, comparison, time footnote), Time sheet with `Count it`, Muscles card and screen (both groupings, How this is counted), Records (heaviest set, most reps at load), Calendar segment, `ResumeBar` on Progress, empty/error states. Replaces today's workout list (`ProgressScreen.tsx`); its unreadable-workout line is kept. No exercise detail: record rows open the Summary.

Checks:

1. **Window maths.** On 11 Oct with finished workouts on 12 Sep, 15 Sep, 20 Sep, 23 Sep, 27 Sep, 30 Sep, 3 Oct, 6 Oct and 8 Oct, `30 days` shows `9` sessions and the dates line `12 Sep – 11 Oct`; a workout on 11 Sep counts only in `Previous 30 days`. `7 days` (5–11 Oct) shows `2`. `WeekBars` read `1 · 2 · 2 · 2 · 2` with labels `12 Sep`, `14 Sep`, `21 Sep`, `28 Sep`, `5 Oct`.
2. **Bars add up.** For `30 days` and `60 days`, the `WeekBars` counts sum to the `SESSIONS` value; the first bar's label is its first date inside the window, not the Monday before it.
3. **DayStrip.** `7 days` shows 7 cells ending today, today's letter bold; a day with two workouts shows `2`. `14 days` shows two rows of 7.
4. **Imported workouts** count as sessions, never add time, and appear in the time footnote (`No times for imported workouts` when they're the only ones).
5. **Same time as the Summary.** A workout 18:02–19:04 with an 8-minute pause counts 54 min, exactly what its Summary shows as `Active time`.
6. **Long session.** A workout of 5 h 12 min is left out of `TIME` and `AVG`, the footnote reads `Time from 8 of 9 sessions`, and the Time sheet lists it under `OVER 4 H`. `Count it` adds it at once, with an Undo toast that removes it again; `Edit times` to 1 h 05 min also brings it back in, as 1 h 05 min.
7. **Average.** `AVG` = `TIME` ÷ the number of timed sessions, rounded to the minute; with no timed sessions it shows `—`, never `0 min`.
8. **Comparison** shows the previous window's sessions and time, or `none`. It is never a percentage and never coloured.
9. **Body parts counting.** One session with 4 hard bench press sets (chest primary; front delts and triceps secondary) gives Chest `1 · 4`, Shoulders `1 · 2`, Triceps `1 · 2`. A session with only 1 bench set gives Triceps `0 · ½` (sessions need ≥ 1 counted set).
10. **No double credit.** An exercise whose primary muscles are `chest` and `upper_chest` gives Chest 1 per set, not 2.
11. **Push/Pull/Legs counting.** The same 4 bench sets give Push `1 · 4`; Push + Pull + Legs + Core + Other equals the total hard sets in the window.
12. **Fixed rows.** Body parts always shows the 11 groups in fixed order, including groups at `0 · 0`; Push/Pull/Legs always shows Push, Pull, Legs and Core, and Other only when above 0.
13. **Hard sets.** Warm-ups and sets rated RPE 5 are left out and listed under `Not counted`; unrated sets (including every FitNotes set) count; a set marked `Spotted` counts and the Muscles screen says so.
14. **Unilateral.** 3 left + 3 right sets of a single-arm row count 3 sets. Sides pair within a set type (warm-ups with warm-ups, working with working), hard sides first: a left warm-up then 3 left + 3 right working sets count 3 sets and 1 warm-up; 1 easy + 2 hard left with 2 hard right count 2 sets and 1 easy. (Pairing rule added in build for review progress-A-r2 S2/SP6; designer to confirm.)
15. **Muscles screen** uses the same window and grouping as home; changing either on one screen changes the other. Expanding Chest lists each contributing exercise with `sets × factor = total`.
16. **Untagged exercises** are listed under `Not counted` with a link to set muscles. Saving muscles recomputes the home, with Undo. **Open (O-PG6):** no muscle editor exists, so slice A lists untagged exercises with no link and this check is unmet. Slice A is not complete on this check until Ben decides O-PG6.
17. **Records** only come from workouts logged in the app, need ≥ 3 earlier sessions on the same equipment, convention and unit, and never appear for import dates. A heavier imported set suppresses the claim. Rows have no badge, trophy, colour or animation.
18. **Calendar.** The month grid shows `●` on workout days (`●2` for two), the day list opens the workout's Summary, and back returns to the same day. Imported workouts read `Imported · 22 sets` with no times.
19. **Empty.** A fresh install shows only `Nothing to show yet` with `Go to Today` and `Import FitNotes history`: no window picker, axes or empty headings.
20. **Offline and no AI.** In airplane mode with no coach connected, every slice A screen is identical to online; the only difference is the `Ask` pill's status.
21. **Resume.** With an unfinished workout < 6 h old, the `ResumeBar` shows on Progress; one tap opens the current set or rest with the correct remaining time. The unfinished workout isn't counted anywhere.
22. **Corrections recompute.** Correcting a set or a workout's times changes every number that used it the next time Progress is shown; nothing is stale.
23. **No invented values.** No score, ring, percentage, streak text, "recovery", "readiness" or "fatigue" appears on any Progress screen.
24. **Accessibility.** At AX3 nothing scrolls horizontally; the picker becomes `Last 30 days ▾`; bars become lists. VoiceOver reads the `StatStrip` as one sentence and each `FrequencyRow` as "Triceps, 3 sessions, 8 and a half sets".
25. **Performance.** With 4 years of imported history (about 600 sessions), switching windows redraws in under 100 ms on Ben's iPhone, with no spinner.

### Slice B: Exercises list and exercise detail

Builds: Exercises list, exercise detail (series menu, `StatStrip`, Est. 1RM / Top set / Volume charts with table view, selection panel, rep table both ways, records, history), the Est. 1RM `ⓘ` sheet, `Add FitNotes history` (PG32, deferred until Ben confirms O-PG1; see check 37), `Best Est. 1RM` in home records, record rows opening exercise detail.

Checks:

26. **One series per chart.** Bench on Main Gym barbell and on Hotel Gym barbell are separate entries in the series menu and never share a chart.
27. **Est. 1RM is labelled everywhere.** Every Est. 1RM value on every screen has `≈` and `Est.` (or "estimate" for VoiceOver).
28. **Est. 1RM rules.** 100 kg × 5 shows `≈116.5 kg` (100 × (1 + 5/30) = 116.67, rounded to the nearest 0.5 kg); 100 kg × 1 shows `≈100 kg`. A session's value comes from its single best eligible set; sets over 10 reps, warm-ups and marked sets are ignored; no value is averaged across sessions.
29. **Not offered** for assisted, bodyweight, bodyweight + added and timed exercises; the default metric becomes `Top set`, `Best set` or `Longest hold`.
30. **Rep table by weight.** Sets of 100×8, 100×7 and 102.5×6 list `102.5 kg  6` and `100 kg  8` with their dates.
31. **Rep table by reps.** The same sets give 6 reps `102.5 kg`, 5 reps `102.5 kg  from 6 reps`, 8 reps `100 kg`, 7 reps `100 kg  from 8 reps`, and no rows above 8.
32. **Marked sets.** A 105×3 marked `Spotted` isn't in the chart, rep table, records or `StatStrip`; history reads `105×3 (spotted)`. If every set that day is marked, there's no point and the marker reads `Not counted`.
33. **Gaps.** A 24-day gap breaks the line and shows `Gap 24 days` in the marker lane and table.
34. **Selection.** Tapping a point changes the panel in place (nothing covers the chart); `Open workout ›` opens that exact workout. The selected point is visible in Direction D by size, ring and guide line.
35. **Table and VoiceOver.** `Show as table` lists the same values as the chart; with VoiceOver, the chart reads its summary and swipe up/down moves point by point.
36. **Long history.** `All` with years of FitNotes history draws weekly bests with `· weekly best` in the heading; the table lists every session.
37. **FitNotes history (PG32).** `Add FitNotes history` on Main Gym barbell shows FitNotes sessions as hollow points with the legend, tags FitNotes rows, and changes nothing in the workout (the `Last` line, targets and the in-workout record line are the same before and after). Undo removes it. It's refused for a different convention or unit. **Deferred (O-PG1, review progress-B S6/SP1):** slice B ships without `Add FitNotes history`, `SeriesLink` or hollow points; FitNotes history stays its own `FitNotes · kg` series in the series menu. This check is unmet until Ben answers O-PG1 and the slice that builds it is chosen.
38. **Volume** shows bars of Σ load × reps per session, with marked sets included, and isn't offered for assisted, bodyweight or timed exercises.
39. **Records** list every record of the series, newest first, with `Best Est. 1RM` labelled as an estimate; a series with fewer than 3 logged sessions shows `Records start after 3 logged sessions.`
40. **No new chart library** is added to `apps/mobile/package.json`; charts draw with Skia, and no chart animates.
41. **Offline and no AI**: every slice B screen is identical online and offline.

---

## 9. Deferred (not in v1.0) and what each needs

| Item | Needs | Was |
|---|---|---|
| Weekly coach review card | Coach v1 read tools + facts payload (`buildWeeklyReviewFacts`), PG18–PG20 | v0.1 §2.7 |
| Pinned "Lifts you follow" + Today's lift line | `setPinnedLifts` store and editor; slice B's `exerciseTrend` for sparklines | v0.1 §2.4 |
| Planned vs done (`2 of 4 planned`) | The weekly plan built (weekly-plan.md) | v0.1 This week card |
| Weekly streak (`6 weeks in a row`) | Nothing new; held back to keep the home calm. Ben can ask for it (O-PG5) | PG17 |
| Weekly-sets guide band (10–20) | Goal-adaptive set ranges per muscle from the approved playbook (goal-adaptive.md) wired to Progress | PG6 |
| Pain spans and pre-flag reference | `PainFlagEvent` history (PG13), PG22, PG23 | v0.1 §2.3 |
| Deload markers | Week tags or programme deload weeks (PG14) | v0.1 |
| Coach-adjusted / coach-target markers | Reading applied, not-undone `ActionRecord`s per session | v0.1 §9.24 |
| How you said you felt card | Built data exists; deferred for scope | v0.1 region 5a, check-in.md §2.7 |
| Endurance | Imported endurance data (parked, brief v0.9) | v0.1 §2.8 |
| Monthly recap, body weight, body map of sets, Upper/Lower grouping, estimated reps-at-load | Research recs 6–9; body weight is new owner data needing a brief change | competitor-analytics.md |

---

## 10. Open questions for Ben

| # | Question | Default until answered |
|---|---|---|
| O-PG1 | **PG32:** may FitNotes history be shown on one equipment's chart when you choose it? | Not built in slice B (check 37 deferred, review progress-B S6/SP1); when built, behind the menu item and not added to anything automatically |
| O-PG2 | Default window: 30 days? | `30 days` |
| O-PG3 | Time `AVG`: mean (what you asked for, with the 4 h cap) or median (research)? | Mean |
| O-PG4 | Is Push/Pull/Legs/Core the right second grouping, or do you want Upper/Lower too? | PPL + Core only |
| O-PG5 | Bring back the weekly streak line? | Off |
| P-PG1 | Approve the brief §12 Page 6 wording in §0.1 | Spec proceeds as written; brief unchanged until approved |
| O-PG6 | Check 16 needs a muscle editor (set muscles on an exercise, with Undo), which doesn't exist. Move check 16 to the slice that builds the editor, or add the editor to slice A? (review progress-A SP2) | Slice A ships without the editor; untagged exercises are listed with no link |
