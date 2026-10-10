# Progress

> **Revision 2026-10-08 (consolidation).** PG20 now uses change-review.md's `update_template` kind name (plus `deload_week`). PG6's 10–20 guide band is a playbook rule (Coaching knowledge) that Ben approves in Guides & playbook; its on/off and min/max live with that rule rather than under a separate "Profile → Progress" screen. `SourceTag` (§9.28) is now the canonical tag for every source and provenance label. `Clear…` on the pain status line opens the canonical Pain flags list (coach-memory.md §2.7).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** New home card **`How you said you felt`** after `Sets per muscle` and before `Week review` (PG2 order extended), and a detail screen with a `pointsOnly` chart on a fixed 1–5 axis plus a table and list ([check-in.md](check-in.md) §2.7, CI11). Check-ins are shown raw with plain counts: no average, no line through the points, no overlay on exercise charts, not in the week review's facts (CI10), and never called readiness or recovery. Past workouts show the `CheckInLine` like the summary. Changed: PG2, §1, §2.1, §2.2 (region 5a), §2.6, §3.1, §4.1, §5.1, §6.1, §7 focus order, checks 44–47.

> **Revision 2026-10-09 (competitor follow-ups 8 and 9; approved by Ben, CHANGELOG 2026-10-09).** (1) **Sets that don't count** (PG21; [active-workout.md](active-workout.md) §2.13): sets Ben marked `Spotted`, `Pain`, `Form broke` or `Other equipment` are left out of top sets, records, estimated 1RM and every "best" or "change" value, and say so wherever they're listed (`100×8 (spotted)`; a session with only flagged sets gets a `Not counted` marker instead of a point). They still count in `Sets per muscle` and volume, because the work was done (AW8). (2) **Pre-flag reference** (PG22): clearing a pain flag resets nothing. The chart keeps the flag span, records from before stay, and the exercise detail shows `Before the pain flag (6 Oct): 55 kg × 6` for 8 weeks after clearing. (3) The pain status line shows `check due` and opens the pain flag sheet (PG23). All local. Changed: §0.2 (PG21–PG23), §2.3 region 2, §2.5 (How this is counted), §3.2, §5.2, §5.3, §6.1, §6.2, checks 48–54.

Status: v0.1 draft, 8 Oct 2026. Brief §1 (Progress tab) and §12 "Page 6: Progress". Tokens and components: [design-system.md](design-system.md) (chart tokens §2.1 and §4.1, components §9.21–9.30). Related: [workout-summary.md](workout-summary.md) (the past-workout view and Edit workout reuse it), [coach-adjustments.md](coach-adjustments.md) (coach markers, proposals, Undo), [today.md](today.md) (gets only the compact version), [training-guides/evidence-core.md](../training-guides/evidence-core.md) (E1, E2, E5, E11, E13).

Progress is **not** part of the logging loop. Nothing here is needed to train, nothing here needs a network, and nothing here interrupts a workout. The only AI-dependent part is the weekly review, and it degrades to plain facts.

---

## 0. Decisions to confirm with Ben (flagged, not yet in the brief)

### 0.1 Departures from brief §12 "Page 6"

| # | Brief says / implies | This spec proposes | Reason |
|---|---|---|---|
| PG1 | Calendar is a separate place that "opens saved workouts" | Calendar is the second segment of the Progress tab (`Overview` · `Calendar`), not a fourth tab or a pushed screen | Keeps three tabs (brief §1). One tap from anywhere in Progress. Past workouts and correction live in one predictable spot |
| PG2 | Default to weekly consistency and pinned trends | Fixed order: This week → Lifts you follow → Sets per muscle → How you said you felt (2026-10-09) → Week review → Recent records → Endurance → All exercises. **The order never changes with the data** | Ben learns where things are. Facts sit above the coach's interpretation (same principle as the summary: "saved first, interpreted second") |
| PG3 | (none) | No week switcher on the home screen. Home always shows the current week. Past weeks are one tap away (the `This week` card → Calendar; the `Sets per muscle` card → its detail screen with ‹ ›) | One date context per screen. A switcher that silently changes some cards but not others (pinned lifts aren't weekly) causes misreading |
| PG4 | Volume/muscle breakdown "only when useful data exists" | Sets per muscle is shown once ≥ 1 week of tagged working sets exists, with the 10–20 guide band (see 0.2) | Requested for this slice and grounded in E1/E2 |
| PG5 | (none) | A `ResumeBar` sits above the tab bar on Progress (and should on Profile) while a workout is unfinished and < 6 h old | Keeps "one tap to resume" true from every tab. Today's Resume card only covers the Today tab |

### 0.2 Data and method decisions

| # | Decision | Default in this spec | Why / alternative |
|---|---|---|---|
| PG6 | **The 10–20 guide band is a candidate rule.** Training-guide shortlist rule 1 (E1/E2) isn't approved yet | Band on by default once Ben approves rule 1; until then the rows show counts without a band. Profile → Progress → `Weekly sets guide` [on/off], min/max editable (default 10 and 20) | Rule-of-the-playbook changes need Ben's approval (training-guides README). The band is labelled a muscle-growth guide, not a requirement |
| PG7 | **Sets with no effort rating.** "Hard set = RPE ≥ 6" would count almost nothing: RPE is optional (P3), `effortScale` can be `off`, and FitNotes imports have no RPE | Unrated working sets **count** and are reported separately (`14 sets · 4 unrated`). Sets rated below RPE 6 (or RIR 5+) are excluded and listed under `Not counted` | Excluding unrated sets would show near-zero volume and be misleading. Alternative: exclude unrated sets and show them as a separate grey count |
| PG8 | **Helper muscles need data that doesn't exist.** `Exercise` has `primaryMuscles` only | Add `secondaryMuscles: string[]` and a fixed muscle-group vocabulary to the catalogue schema (`packages/schemas`, `packages/catalogue`). Until then, compounds count for primary muscles only and the method line says `Helper muscles not counted yet` | Fractional (½) counting is the best-fitting method (E1, Pelland et al.). Schema change → developer + Ben |
| PG9 | **Drop sets** | Count as hard sets (any completed non-warm-up set, same as `summariseVolume`) | Consistent with the summary's `Working sets`. Alternative: count a drop-set chain as one set |
| PG10 | **Records need history.** | A record is shown only when the series has ≥ 3 earlier sessions and the new value is strictly better | Otherwise the first weeks (and every FitNotes import) produce a flood of trivial "records" |
| PG11 | **Estimated 1RM** | Epley, only from completed non-warm-up sets of 1–10 reps on load-based conventions (total, per dumbbell, stack, plates). Not for assisted, bodyweight, bodyweight + added, or timed sets | Prediction error grows with reps (E5 notes rating/rep noise). Bodyweight isn't recorded, so BW + added can't be estimated honestly |
| PG12 | **Gaps** | A gap is ≥ 21 days between consecutive sessions of one series. The line breaks there and the marker lane says so | Weekly training with one missed week is normal; three weeks is a real break. Domain constant `TREND_GAP_DAYS`, Ben may change it |
| PG13 | **Pain markers need history.** `PainStatus` holds only the current flag | Store `PainFlagEvent {exerciseId, setAt, clearedAt, note}` when `setPainFlag` writes | Needed to draw "pain flag 2–9 Oct" spans. Developer contract |
| PG14 | **Deloads are never inferred** | A deload marker comes only from (a) a week Ben tags `Deload` in Calendar, (b) an applied coach deload proposal, (c) a programme deload week (build step 6). A lighter week is never labelled a deload by itself | Rule 6: don't invent data |
| PG15 | **Equipment groups** (workout-summary mentions "a group Ben defined") | Not built. One series = one equipment instance (or one unmapped import source). Merging two machines would be a later gym-editor feature, always explicit | Keeps "different machines aren't merged" simple and true |
| PG16 | **Week** | Monday–Sunday in the owner's stored timezone; a session belongs to the week of its (possibly corrected) start time | en-GB locale; matches how Ben plans |
| PG17 | **Weekly streak** | Counts consecutive **weeks** with ≥ 1 finished workout; hidden below 2; never a "lost streak" message; can be hidden in Profile | Daily streaks punish rest days. A weekly count is factual and forgiving |
| PG18 | **Weekly review: when** | One coach call per completed week, made the first time Progress is opened (foreground, coach reachable) on or after Monday. Never in the background, never on a timer | Matches the summary's "one call, retry on next open" pattern; ADR 0006 "not constantly" |
| PG19 | **Weekly review: numbers are checked** | Every number in a coach observation must appear in the deterministic facts payload; an observation that fails is replaced by a built-in fact | "Factual observations" has to be enforceable, not a prompt hope |
| PG21 | (2026-10-09) **Sets Ben marked as not counting** (`Spotted`, `Pain`, `Form broke`, `Other equipment`; active-workout §2.13) | Left out of `Top set`, `Reps at load`, `Est. 1RM`, `Best set`, `Longest hold`, records, `Change` and the `Lifts you follow` latest value. **Counted** in `Volume`, `Sets per muscle`, working-set counts and `This week`. Every list shows the words (`100×8 (spotted)`). A session whose sets are all flagged has no point; the marker lane shows `Not counted` and the table row reads `— Not counted (spotted)` | Records and estimates are claims about strength, so a spotted rep mustn't feed them (rule 6). Volume is work done, so it stays (AW8). Alternative: leave flagged sets out of volume too |
| PG22 | (2026-10-09) **Pain flags never reset history** | Clearing a flag deletes and hides nothing. The `Pain` span stays on charts; records set before the flag stay records. For `timing.painReferenceWindow` (8 weeks) after clearing, exercise detail shows the last comparable session before the flag as `Before the pain flag (6 Oct)`, as a reference line in the selection panel's range summary, never a target | Item 8: pre-injury history stays the reference. Any return towards it is a coach proposal later (active-workout §2.14.3) |
| PG23 | (2026-10-09) **Pain status line** | Adds `· check due` when the two-weekly check is due; tapping the line opens the pain flag sheet (active-workout §2.14.4) instead of the Pain flags list | One place to answer the check, from wherever Ben sees the flag |
| PG20 | **Review proposal kinds** | `Proposal.kind` uses change-review.md's `'update_template'` (future sets/reps/loads of a routine exercise; consolidation: replaces the `'adjust_template'` name proposed here) and adds `'deload_week'`; scope always `future_template` | The brief §8 union lacks them |

---

## 1. Purpose

Progress answers **"Am I getting stronger and training consistently, by the numbers I actually logged?"**, one specific question at a time:

| Screen | Question it answers | Single primary action |
|---|---|---|
| Progress home (`Overview`) | How is this week going, and how are the lifts I care about moving? | Open a lift you follow (a row tap). No `PrimaryButton` is shown except `Resume` in the `ResumeBar` or the empty-state action |
| Exercise detail | How has this lift changed on this equipment, and what happened on a given day? | Tap a point (or row) → open that workout |
| Sets per muscle | How many hard sets did each muscle get this week, against the guide? | Expand a muscle to see what counted |
| Calendar | What did I do on a given day, and is it recorded correctly? | Open a past workout → `Edit` |
| Past workout | Exactly what was logged, and what did it lead to? | `Edit` (nav bar) |
| Week review (card on home) | What happened last week, in three facts, and is one change worth making? | `Apply` on the single proposal, if there is one |
| How you said you felt (card + detail, 2026-10-09) | What did I say before each workout? | Open an entry → its workout |
| Endurance (later) | What endurance work was imported, by source? | Open a sport's activity list |

It never shows a recovery, readiness, fitness, fatigue or "form" score, a percentage grade, a ring or an animated dashboard. Every value says whether it is an **actual result**, a **target** or an **estimate**, or (check-ins, 2026-10-09) **Ben's own rating**, shown as given.

---

## 2. Layout

### 2.1 Navigation map

```
Tab: Progress
 ├─ [Overview] (home)
 │   ├─ This week card ───────────────► [Calendar] segment, that week
 │   ├─ Lift row ─────────────────────► Exercise detail ─► point/row ─► Past workout ─► Edit workout
 │   ├─ Lifts you follow · Edit ──────► Pin editor (sheet)
 │   ├─ Sets per muscle card ─────────► Sets per muscle (week ‹ ›) ─► How this is counted (sheet)
 │   ├─ How you said you felt card ───► Check-in detail (chart / table / list) ─► Past workout
 │   ├─ Week review · Why? / Apply ───► evidence sheet / inline Apply, Undo
 │   ├─ Recent records row ───────────► Exercise detail (that series, point selected)
 │   ├─ Endurance card (later) ───────► Endurance activities
 │   └─ All exercises ────────────────► Exercise list (search) ─► Exercise detail
 └─ [Calendar]
     └─ day ► session row ────────────► Past workout ─► Edit workout
```

Every pushed screen uses the standard iOS back chevron and edge swipe. The `TalkButton` pill (`Ask`) floats bottom-trailing on every Progress screen, above the `ResumeBar` when present. Opening it attaches the current screen's context (for example `Bench press · Main Gym barbell · last 3 months`).

### 2.2 Progress home (`Overview`)

Regions, top to bottom:

1. **Title.** iOS large title `Progress` (collapses on scroll), then a segmented control `Overview | Calendar` (full width, 44pt tall).
2. **ResumeBar (conditional, fixed).** Above the tab bar, only while a workout is unfinished and < 6 h old (design-system §9.29).
3. **This week.** Card heading `This week · 5–11 Oct ›`. Line 1: `2 of 4 planned sessions done` (or `3 workouts this week` with no plan). A static `WeekStrip` (Mon–Sun). Line: `11 of 14 planned sessions in the last 4 weeks`. Optional streak line. A deload-tagged week adds a `Deload week` text tag. The whole card is one tap target → Calendar.
4. **Lifts you follow.** Heading with an `Edit` text button. Up to three `TrendRow`s (pinned series): name + equipment context, `Sparkline` (12 weeks), latest actual top set with date, change since the start of the window. Empty slots show suggestions (§2.4).
5. **Sets per muscle · this week.** Heading `›`. Subtitle with the method in one line. Up to six `VolumeBandRow`s in a fixed body order (only muscles with ≥ 1 counted set in the last 4 weeks), then `Show all (11)`.
5a. **How you said you felt (2026-10-09).** Heading `How you said you felt ›`; line `Before each workout · 1 = rough, 5 = great`; up to four most recent check-ins as given (`Thu 8 Oct  2 · Tired, Poor sleep`, with `· skipped` / `· rescheduled` / `· no workout` when no workout followed); one count line `9 check-ins in the last 4 weeks · 3 at 3 or lower` (the threshold is Ben's "What's up?" setting). Whole card → detail ([check-in.md](check-in.md) §2.7). Absent when there are no check-ins and check-ins are off; with check-ins on and none yet: `No check-ins yet. You're asked when you start a workout.` No chart on the home card.
6. **Week review.** One card for the most recent completed week (§2.7).
7. **Recent records.** Heading `Recent records · last 30 days`. Up to three rows, newest first, then `Show all (5)`. If there are none: one text line, no frame.
8. **Endurance (imported).** Only when imported activities exist in the last 12 weeks (§2.8). Otherwise absent: no heading, no frame.
9. **All exercises ›.** A single row → exercise list.

```
┌────────────────────────────────────────┐
│ Progress                               │ large title
│ [     Overview     |    Calendar    ]  │ segmented
│                                        │
│ This week · 5–11 Oct                 › │ whole card → Calendar
│ 2 of 4 planned sessions done           │
│  M    T    W    T    F    S    S       │ WeekStrip (static)
│  ✓    –    ✓    ○    ○                 │
│ ✓ done  ○ planned  – not logged        │ legend
│ 11 of 14 planned sessions in the last  │
│ 4 weeks · 6 weeks in a row with a      │
│ workout                                │
│                                        │
│ Lifts you follow                  Edit │
│ Bench press                          › │ TrendRow
│ Main Gym · barbell                     │
│ ╱‾╲_╱‾‾   102.5 kg × 6 · 8 Oct         │ sparkline · latest (actual)
│           ↗ Up 7.5 kg since 16 Jul     │ change
│ Back squat                           › │
│ Main Gym · barbell                     │
│ _╱‾‾‾‾╲   130 kg × 5 · 6 Oct           │
│           = Same load as 16 Jul        │
│ Seated row                           › │
│ Main Gym · cable stack 2               │
│ __╱‾‾‾‾   59 kg stack × 10 · 7 Oct     │
│           ↗ Up 5 kg since 16 Jul       │
│                                        │
│ Sets per muscle · this week          › │
│ Hard sets (RPE 6+ or unrated), helpers │
│ count ½ · guide 10–20 ⓘ                │
│ Chest                  14 · in 10–20   │ VolumeBandRow
│ ██████████████[██████····]···          │ [ ] = guide band
│ Back                    8 · under 10   │
│ ████████      [··········]···          │
│ Triceps               7½ · under 10    │
│ ███████▌      [··········]···          │
│ … Show all (11)                        │
│                                        │
│ Week review · 28 Sep – 4 Oct  [Coach]  │ §2.7
│ • You did 4 of 4 planned sessions.     │
│   Your logs                            │ SourceTag
│ • Bench press top set rose to 102.5 kg │
│   × 6 (Main Gym barbell).  Your logs   │
│ • Back had 8 hard sets, under the      │
│   10–20 guide.             Your logs   │
│ ┌ Suggested change · Future sessions ┐ │ ChangeReviewCard
│ │ Add 2 sets of Seated row to Pull A │ │
│ │ Seated row   Target 3 × 8–10       │ │
│ │          →   Target 5 × 8–10       │ │
│ │ Why? ›        [Not now]  [Apply]   │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Recent records · last 30 days          │
│ Bench press · Main Gym barbell       › │
│ Heaviest set: 105 kg × 3 · 1 Oct       │
│ Before: 102.5 kg × 3 (14 Sep)          │
│ … Show all (3)                         │
│                                        │
│ All exercises                        › │
│                            ( 💬 Ask )  │
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
└────────────────────────────────────────┘
```

**With an unfinished workout (`ResumeBar`):**

```
│ …                                      │
│                            ( 💬 Ask )  │
├────────────────────────────────────────┤
│ ▶ Push A · Rest 1:12        [ Resume ] │ ResumeBar, 60pt
├────────────────────────────────────────┤
│   Today        Progress       Profile  │
└────────────────────────────────────────┘
```

### 2.3 Exercise detail

Pushed from a `TrendRow`, a record, the exercise list, the summary's comparison block (workout-summary §4) or a past workout's exercise row.

Regions:

1. **Nav bar.** Back, exercise name (`type.headline`), trailing `Pin` / `Pinned` text button (`pin` / `pin.fill` icon + word).
2. **Pain status line (conditional).** `⚠ Pain flag on since 2 Oct. No increases for this movement.` (`StatusBanner`, warning). `Clear…` opens Profile → Pain flags (clearing stays explicit there). (2026-10-09, PG23) When the two-weekly check is due the line adds `· check due`, and tapping the line opens the pain flag sheet (active-workout.md §2.14.4). (PG22) For 8 weeks after the flag is cleared, the line is replaced by an info line: `Pain flag cleared 14 Oct. Before the flag (6 Oct): 55 kg × 6.` (`info.circle`, `text.secondary`; actual values), which goes away by itself after 8 weeks.
3. **Series picker.** A menu button showing the selected series: `Main Gym · barbell · kg ▾`. The menu lists each series with its session count (`Main Gym · barbell · 24 sessions`, `Hotel Gym · barbell · 3`, `Imported (FitNotes) · kg · 40`), grouped by gym, plus a last option `All equipment (list only)`. Default: the pinned series, else the series used most in the last 12 weeks.
4. **Metric chips** (`ParamChip`, single select, wrap): `Top set` · `Reps at load` · `Est. 1RM` · `Volume`. Unavailable metrics for the convention are hidden (§6.3). `Reps at load` adds a load chip row: `At 100 kg ▾`.
5. **Range chips:** `3 mo` · `6 mo` · `1 yr` · `All`. Default `6 mo`.
6. **Chart heading.** Metric name + what kind of value + range: `Top set (actual) · 9 Apr – 8 Oct`, `Estimated 1RM (estimate, Epley) · 9 Apr – 8 Oct`.
7. **`TrendChart`** (design-system §9.23): one series, one line, points, y-axis with unit, month ticks, the **marker lane** under the x-axis, gap breaks.
8. **Selection panel** (fixed height, under the chart). With nothing selected: range summary `Latest`, `Best in range`, `Change`. With a point selected: that session (§2.3.2).
9. **`Show as table`** toggle button (always visible, not VoiceOver-only) → `ChartDataTable` replaces the chart.
10. **History.** Dated session rows grouped by month, newest first. Paged by month (`Load earlier`).

#### 2.3.1 Wireframe: normal

```
┌────────────────────────────────────────┐
│ ‹ Progress    Bench press    📌 Pinned │
│ [ Main Gym · barbell · kg  ▾ ]         │ series picker
│ [✓Top set] [Reps at load] [Est. 1RM]   │ metric chips
│ [Volume]                               │
│ [3 mo] [✓6 mo] [1 yr] [All]            │ range chips
│                                        │
│ Top set (actual) · 9 Apr – 8 Oct       │
│ kg                                     │
│ 105 ┤                       ●          │
│     ┤                  ●──●╯ ╲●        │
│ 100 ┤      ●──●──●    ╱                │
│     ┤  ●──╯       ╲ ╱                  │ break = gap
│  95 ┤●╯            ●      ┊            │
│     └┬──────┬──────┬──────┬──────┬──   │
│     Apr    May    Jun    Jul    Aug  … │
│  💬        ▒Deload▒   ⚠ Pain   ✎       │ marker lane (icon + word)
│            Gap 24 days                 │
│                                        │
│ Latest        102.5 kg × 6 · 8 Oct     │ selection panel (range summary)
│ Best in range 105 kg × 3 · 1 Oct       │
│ Change        Up 7.5 kg since 9 Apr    │
│ [ Show as table ]                      │
│                                        │
│ History                                │
│ October                                │
│ Thu 8 Oct · Push A                   › │
│ 102.5×6 · 100×8 · 100×7 · 100×7        │ actual working sets, kg
│ 💬 Coach adjusted sets 3–4             │
│ Mon 5 Oct · Push B                   › │
│ 100×6 · 97.5×8 · 97.5×8    ✎ Edited    │
│ Thu 1 Oct · Push A                   › │
│ 105×3 · 97.5×8 · 97.5×8 · 97.5×7       │
│ ⚠ Pain noted (shoulder)                │
│ …                                      │
│ [ Load September ]                     │
│                            ( 💬 Ask )  │
└────────────────────────────────────────┘
```

#### 2.3.2 Wireframe: point selected

The selection panel swaps content in place (no floating callout, nothing covers the chart). The selected point gets the `color.chart.selected` ring and a vertical guide line.

```
│     ┤                  ●──◉╯ ╲●        │ ◉ selected
│     │                     ┊            │ guide line
│ …                                      │
│ Thu 1 Oct · Push A · Main Gym          │ selection panel (point)
│ Top set   105 kg × 3 (actual) · RPE 9  │
│ ⚠ Pain noted (shoulder)                │ markers on that day
│ Open workout ›                Clear ×  │
```

#### 2.3.3 Wireframe: `Show as table`

```
│ Top set (actual) · 9 Apr – 8 Oct       │
│ [ Show chart ]                         │
│ Date     Top set        Notes          │
│ 8 Oct    102.5 kg × 6   Coach adjusted │
│ 5 Oct    100 kg × 6     Edited         │
│ 1 Oct    105 kg × 3     Pain           │
│ 24 Sep   100 kg × 6     —              │
│ …                                      │
│ 14 Aug   —              Gap 24 days    │
```
Columns follow the metric: `Top set` / `Reps at 100 kg` / `Est. 1RM (estimate)` + `From set` / `Volume` + `Sets`. Rows are buttons → Past workout. At AX1+ each row stacks (date line, value line, notes line).

#### 2.3.4 Wireframe: `All equipment (list only)`

```
│ [ All equipment (list only) ▾ ]        │
│ Different equipment isn't combined in  │
│ a chart. Choose one to see a chart.    │
│                                        │
│ History                                │
│ Thu 8 Oct · Push A                   › │
│ Main Gym · barbell                     │
│ 102.5×6 · 100×8 · 100×7 · 100×7        │
│ Sat 3 Oct · Hotel workout            › │
│ Hotel Gym · barbell                    │
│ 80×10 · 80×10 · 80×9                   │
```

### 2.4 Lifts you follow: pinning and suggestions

- `Edit` (home) or `Pin` (exercise detail) opens the **pin editor** sheet (medium detent): the current pins in order with a remove button each (`minus.circle` + `Remove`), drag handles **and** `Move up` / `Move down` buttons (gesture never the only route), and `Add a lift` → exercise list in pick mode. Max three.
- A pin stores a **series** (exercise + equipment instance or import source + convention + unit), not just an exercise. The pin label always shows the equipment.
- Pin #1 is the lift shown on Today (`today.md` "This week", unchanged).
- Pinning a fourth: the sheet asks `Replace which lift?` with the three current pins as buttons.
- Fewer than three pins: each empty slot shows one suggestion row, from the most-logged series of the last 12 weeks that aren't pinned:

```
│ Lifts you follow                  Edit │
│ Bench press                          › │
│ …                                      │
│ Suggested: Back squat · Main Gym       │
│ barbell · 9 sessions        [ + Pin ]  │ secondary text button
```
Nothing is pinned automatically.

### 2.5 Sets per muscle (detail)

Pushed from the home card. Regions: nav bar `Sets per muscle`; week switcher `‹  Week of 5 Oct (this week)  ›` (buttons 44pt; `›` disabled on the current week); method line; every muscle with ≥ 1 counted set in the chosen week or the 3 weeks before, in fixed body order; `Not counted` block; `How this is counted ›`; `Show as table`.

```
┌────────────────────────────────────────┐
│ ‹ Progress     Sets per muscle         │
│ ‹      Week of 5 Oct (this week)     › │
│ Hard sets (RPE 6+ or unrated). Helpers │
│ count ½. Guide 10–20 a week.           │
│                                        │
│ Chest            14 · in 10–20       ⌄ │ tap to expand
│ ██████████████[██████····]···          │
│   Bench press          4 sets  × 1 = 4 │ contributors
│   Incline DB press     4 sets  × 1 = 4 │
│   Machine fly          6 sets  × 1 = 6 │
│ Triceps          7½ · under 10       › │
│ ███████▌      [··········]···          │
│ Back              8 · under 10       › │
│ Quads            12 · in 10–20       › │
│ …                                      │
│ 4 of these sets had no effort rating   │
│ and were counted.                      │
│                                        │
│ Not counted                            │
│ 9 warm-up sets · 1 set rated under     │
│ RPE 6                                  │
│ Cable crunch: no muscles set (3 sets)  │
│ Set muscles ›                          │
│                                        │
│ How this is counted ›                  │
│ [ Show as table ]                      │
└────────────────────────────────────────┘
```

Contributor lines show the arithmetic: `Bench press  4 sets × ½ = 2` under Triceps.

**How this is counted** (sheet, plain text, scrollable):

> **Hard sets per muscle**
> We count completed working sets (not warm-ups) that you rated RPE 6 or harder (RIR 4 or fewer). Sets with no rating are counted too, and shown separately. Sets rated easier than RPE 6 aren't counted. Sets you marked spotted, painful, with form breaking or on other equipment still count here, because you did the work; they're only left out of records and estimates.
> A set counts 1 for the muscles an exercise mainly trains and ½ for helper muscles. For example, a bench press set counts 1 for chest and ½ for triceps and front delts. A left and right set of a single-arm exercise count as one set.
> **The 10–20 guide** comes from research on muscle growth: about 10 or more hard sets a week per muscle is well supported, and benefits continue past 20 with smaller returns. Fewer than 10 is fine for maintenance, for strength-focused training, or for muscles that aren't a priority. It's a guide, not a target.
> Sources: Schoenfeld et al. 2017; Pelland et al. 2026; ACSM 2026 position stand. Evidence: strong for the 10+ dose; the upper end is less certain.
> This doesn't measure fatigue or recovery.

### 2.6 Calendar and past workouts

`Calendar` segment of the Progress tab.

Regions: month header `‹  October 2026  ›` (44pt buttons; swipe also changes month); weekday row (Mon first); `CalendarMonth` grid; legend; the **day list** for the selected day (default: today, or the latest day with a workout this month); the **week row** for the selected day's week with its `⋯` menu.

```
┌────────────────────────────────────────┐
│ Progress                               │
│ [     Overview     |    Calendar    ]  │
│ ‹          October 2026            ›   │
│  M    T    W    T    F    S    S       │
│            1    2    3    4            │
│            ●         ▲    ○            │ glyphs under the date
│  5    6    7   (8)   9   10   11       │ (8) = selected; today ringed
│  ●         ●    ●                      │
│ 12   13   14   15   16   17   18       │
│  ○         ○              ○            │ planned (future)
│ …                                      │
│ ● workout  ▲ endurance (imported)      │ legend
│ ○ planned                              │
│                                        │
│ Thu 8 Oct                              │ day list
│ Push A · Main Gym                    › │
│ 18:02–19:04 · 54 min · 16 working sets │
│ ✎ Edited  💬 Coach adjusted            │ text tags
│                                        │
│ Week of 5 Oct · 3 workouts           ⋯ │ week row (⋯: Mark as deload)
└────────────────────────────────────────┘
```

Past days with a planned-but-not-logged session show `○` too; their day list reads `Pull A was planned · not logged` (neutral wording, no warning colour). Rest days have no glyph. An unfinished workout shows `●` with the day list row `In progress · Resume ›` (< 6 h) or `Unfinished · Finish or resume on Today ›` (stale; routes to Today's stale card). Discarded workouts aren't shown.

**Past workout** (pushed from a day list row, a chart point, a history row or a record):

It reuses the summary layout (workout-summary §2) in **history mode**: no saved banner, no `Done`, no footer bar. (2026-10-09) The `CheckInLine` sits under the title line when the workout had a check-in, exactly as on the summary.

```
┌────────────────────────────────────────┐
│ ‹ Calendar     Push A            Edit  │ Edit = nav-bar text button
│ Thu 8 Oct · Main Gym · 18:02–19:04     │
│ (end time edited)                      │ only if timing was corrected
│                                        │
│ Active time            54 min          │
│ Exercises              5 of 5          │
│ Working sets           16 (2 skipped)  │
│ Warm-up sets           4               │
│                                        │
│ Exercises (actual)                     │
│ Bench press      4 sets              › │ → exercise detail, this series
│   102.5×6 · 100×8 · 100×7 · 100×7      │
│   💬 Coach adjusted sets 3–4 (RPE 10   │
│   on set 2)                            │
│ …                                      │
│ Next time (decided after this workout) │
│ Bench press  ✓ Coach target applied:   │
│ 97.5 kg × 6–8                [Coach]   │
│ Incline DB press  Built-in rule: 32.5  │
│ kg each × 8–10 · Not applied (expired) │
│                                        │
│ Coach note                             │
│ Bench moved well until set 2; …        │
│                                        │
│ Edit history (2 changes)             › │ correction audit
│ ⋯  Share / export                      │
└────────────────────────────────────────┘
```

`Edit` opens the same Edit workout screen as the summary (workout-summary §4: `correctSet`, `updateSessionTiming`, audit kept, no AI regeneration). Saving returns here, recomputed; every Progress number that used that session recomputes (brief scenario 5).

### 2.7 Week review card

Covers the most recent **completed** week (Mon–Sun). During the week, the card shows last week's review. Max three observations, each with a `SourceTag`; at most one proposal.

Card anatomy: heading `Week review · 28 Sep – 4 Oct` + author tag (`Coach` / `Built-in summary` / `Built-in summary (coach offline)` / `Built-in summary (coach unavailable)`); 1–3 bullet observations (`type.callout`), each followed by its `SourceTag` (`Your logs`, `FitNotes import`, `Garmin file, imported 3 Oct`); optional `ChangeReviewCard` (scope `Future sessions`); footer link `Ask about this week ›` (opens the coach sheet with the week attached).

Wireframes of the main states:

```
Coach ready, with proposal: see §2.2.

Coach ready, nothing to change:
│ Week review · 28 Sep – 4 Oct  [Coach]  │
│ • …three observations…                 │
│ No changes suggested.                  │

Coach offline (facts only):
│ Week review · 28 Sep – 4 Oct           │
│ [Built-in summary (coach offline)]     │
│ • You did 4 of 4 planned sessions.     │
│   Your logs                            │
│ • Bench press top set: 102.5 kg × 6,   │
│   up from 100 kg × 6 on 24 Sep.        │
│   Your logs                            │
│ • Pain flag on Overhead press since    │
│   2 Oct.                   Your logs   │
│ Coach review will be added when you're │
│ back online.                           │

Coach reviewing (first open after the week ends):
│ Week review · 28 Sep – 4 Oct           │
│ [Built-in summary]                     │
│ • …built-in facts…                     │
│ Coach is reviewing…                    │

Out of date (a set in that week was corrected after the review):
│ Week review · 28 Sep – 4 Oct  [Coach]  │
│ ⚠ Based on your logs before the edit   │
│ on 9 Oct.            [ Update review ] │
│ • …                                    │
│ ┌ Suggested change · Future sessions ┐ │
│ │ ⚠ Out of date. Your logs changed   │ │
│ │ since this was suggested.          │ │
│ │                        [ Dismiss ] │ │
│ └────────────────────────────────────┘ │
```

### 2.8 Endurance (later; only with imported data)

Shown on home only when `EnduranceActivity` rows exist in the last 12 weeks. One compact card per sport, never one card for "fitness". Each card names its source and import date.

```
│ Endurance (imported)                   │
│ Running          [Garmin FIT files]    │ SourceTag
│ Last import 3 Oct                      │
│ This week: 2 runs · 1 h 35 min ·       │
│ 18.2 km                                │
│ ▁▃▅▂▆▄▃▅  weekly time, last 8 weeks  › │ static bars
│ Cycling          [Strava export]       │
│ …                                      │
│ Imported activities only. Shown        │
│ separately from lifting.               │
```

Tapping a card opens **Endurance activities**: sport filter chips, metric chips limited to fields the source actually provided (`Time` · `Distance` · `Avg heart rate` only if present in every point shown), a bar chart per week, and a dated activity list with source per row. Calendar shows each activity with `▲`.

Never shown: a combined strength + endurance load, training load/stress, readiness, recovery, VO2max or "fitness" values, whether computed by us or not. A source's own derived metrics are out of scope for this version (would need a verified field and a later decision).

---

## 3. States

### 3.1 Progress home

| State | Trigger | Display |
|---|---|---|
| Loading | Cold open before `buildProgressHome` returns | Nothing for 300 ms, then static grey blocks in the region shapes. No shimmer |
| Empty | No finished workouts and no imports | One card only: `Nothing to show yet` / `Log a workout, or import your FitNotes history to see your progress.` Primary `Go to Today` (switches tab) and secondary `Import FitNotes history` (→ Profile → Import). If the first-ever workout is in progress, the `ResumeBar` shows and `Go to Today` becomes a secondary button, so only one accent-filled button is on screen. No chart frames, no empty headings |
| Sparse | < 3 finished sessions overall, or < 2 weeks of history | `This week` shows counts only (no 4-week line, no streak). `Lifts you follow` rows show text instead of sparklines: `1 session so far: 100 kg × 8 (8 Oct). A trend appears after 3 sessions.` `Sets per muscle` shows counts without the band text `in/under/over` until 1 full week exists. Records hidden (PG10). Week review hidden until one completed week has ≥ 1 workout |
| Normal | Data present | As §2.2 |
| No plan | No scheduled sessions this week | `3 workouts this week` (or `No workouts yet this week.`); `WeekStrip` shows `✓` only; 4-week line reads `11 workouts in the last 4 weeks` |
| Plan, nothing done yet | Week started, 0 done | `0 of 4 planned sessions done` and the strip. No warning colour, no "behind" wording |
| Extra workouts | Finished sessions not linked to a planned one | `2 of 3 planned sessions done · 1 extra` |
| Deload week | Current week tagged deload | `Deload week` text tag next to the heading |
| No pins | 0 pins | `Pin up to 3 lifts to follow them here.` + up to three suggestion rows with `+ Pin` |
| Pinned series not trained lately | No session in the pinned series for ≥ 21 days | Row: latest result with its date + `Not done since 14 Aug`; sparkline drawn with its gap |
| Pinned exercise done on other equipment | Latest session of that exercise used another series | Extra line `Last done on Hotel Gym barbell (3 Oct), not in this trend.` |
| No muscle data | No counted sets have muscles (custom exercises without tags) | `Sets per muscle needs muscles on your exercises. 3 exercises have none.` [Set muscles] (→ exercise list filtered to untagged). No bars |
| Guide off / not approved | PG6 | Rows show `14` with a plain bar, no band, no `in/under/over` text; subtitle drops `guide 10–20` |
| Helper muscles not available | PG8 not built yet | Subtitle `Hard sets (RPE 6+ or unrated). Helper muscles not counted yet.` |
| Records: none | No qualifying record in 30 days | `No new records in the last 30 days.` (one line) |
| Endurance: no data | No imported activities | Section absent |
| Check-ins: none (2026-10-09) | No check-ins recorded | Check-ins on: `No check-ins yet. You're asked when you start a workout.` Off: card absent |
| Check-ins: few | 1–2 check-ins | Card lists them; detail shows the list and table, and the chart only from 3 points (`A chart appears after 3 check-ins.`) |
| Check-ins turned off later | Setting off, history exists | Card still shows history with `Check-ins are off. Turn on in Profile → Check-in.` |
| Coach states | see §3.4 | Only the review card changes |
| Offline | No network | No banner. Everything except the coach review is local. Ask pill shows `Offline` |
| Workout in progress | Unfinished < 6 h | `ResumeBar` shown; data includes only finished workouts (the active one appears after Finish) |
| Database error | SQLite read failed | `Couldn't open your training data.` [Try again] + link `Restore from backup` (same as Today) |

### 3.2 Exercise detail

| State | Trigger | Display |
|---|---|---|
| Normal | ≥ 3 points in range | §2.3.1 |
| Too few points | 1–2 sessions in range for the series | No chart frame. Text: `2 sessions in this range. A chart appears after 3.` + the selection panel's range summary + history list. Wider range chip suggested: `Try 1 yr` (button) when it would have ≥ 3 |
| No sessions in range | 0 in range, older ones exist | `No Bench press sessions on this equipment between 9 Apr and 8 Oct. Last one: 2 Feb.` + `Show all time` button |
| Metric not available | Convention doesn't support it (§6.3) | Chip hidden. If deep-linked: `Estimated 1RM isn't available for assisted exercises.` |
| No eligible sets for estimate | Only sets of > 10 reps in range | `Estimated 1RM uses sets of 10 reps or fewer. None in this range.` |
| `All equipment (list only)` | Selected | §2.3.4. No chart, no range summary, list shows equipment per row |
| Long history | > 150 points in range (`All` with years of imports) | Chart shows one point per week (the week's best), heading adds `· weekly best shown`. Table and list still show every session |
| Pain flag active | `PainStatus.active` | Pain status line (region 2). History rows for flagged sessions show `⚠ Pain noted` |
| Point selected | Tap / VoiceOver adjust | §2.3.2 |
| Table view | `Show as table` | §2.3.3 |
| Corrected data | A set in range was corrected | Points use corrected values; the session row and table note `Edited`; marker lane `✎` |
| Imported series | Unmapped FitNotes data | Picker label `Imported (FitNotes) · kg`; rows tagged `Imported (FitNotes)`; original values visible in Past workout → `Edit history` / source fields |
| Sets marked as not counting (2026-10-09, PG21) | A session in range has flagged sets | The point uses the best **unflagged** set. History rows show `100×8 (spotted)`; table notes `1 set not counted (spotted)`. If every set that day is flagged: no point, marker lane `Not counted` (icon `minus.circle` + word), table row `— Not counted (spotted)`. VoiceOver for the point: "… 1 set not counted, spotted." |
| Pain flag cleared, reference window (2026-10-09, PG22) | Flag cleared in the last 8 weeks | Region 2 info line `Pain flag cleared 14 Oct. Before the flag (6 Oct): 55 kg × 6.`; the `Pain` span stays on the chart; the range summary adds `Before the flag  55 kg × 6 · 2 Oct` (actual) |
| Pain flag check due (2026-10-09, PG23) | The flag's two-weekly check is due | Region 2 line ends `· check due`; tapping it opens the pain flag sheet |

### 3.3 Calendar and past workout

| State | Display |
|---|---|
| Month with no workouts | Grid with no glyphs; day list: `No workouts in October.` + `Go to Today` link only for the current month |
| Day selected, no workout | `Nothing logged on Tue 6 Oct.` (plus `Push B was planned · not logged` if so) |
| Several sessions in a day | Day list shows each row; the cell glyph shows `●` once with VoiceOver count (`2 workouts`) |
| Unfinished workout | Row `In progress · Resume ›` or stale `Unfinished · Finish or resume on Today ›` |
| Imported session | Row tag `Imported (FitNotes)` |
| Past workout, coach note still pending | `Coach note: writing…` (same as summary). Offline: `Coach note will be added when you're back online.` |
| Past workout, proposal history | Applied / Not now / Expired / Out of date, read-only, as in workout-summary §3. Only `Undo` on an applied proposal while its window is open (until the next session of that routine starts) |
| Edit saved | Returns to Past workout recomputed, toast `Changes saved` [Undo] (`undoAction` of the correction) |
| Edit conflict | Version changed underneath (e.g. backup restore): `This workout changed since you opened it. Reload to edit.` [Reload] |
| Week tagged deload | Week row: `Week of 5 Oct · Deload` text tag |

### 3.4 Week review card

| State | Trigger | Card shows | Proposal |
|---|---|---|---|
| Hidden | No completed week with ≥ 1 workout | Nothing (no frame) | — |
| Coach not connected | No AI route | Author `Built-in summary (coach not connected)`; up to 3 built-in facts | None |
| Coach offline | Route exists, no network | Author `Built-in summary (coach offline)`; built-in facts; footer `Coach review will be added when you're back online.` | None |
| Coach reviewing | Request in flight (`timing.coachTimeout`, 20 s) | Built-in facts + `Coach is reviewing…` (static icon) | None |
| Coach ready | Validated review stored | Author `Coach`; 1–3 observations with SourceTags | 0 or 1 `ChangeReviewCard` |
| Observation replaced | An observation failed number validation (PG19) | That bullet is a built-in fact with its own `Built-in` tag | — |
| Nothing to change | Coach returned no proposal | `No changes suggested.` | — |
| Failed / timed out | Error, limit or timeout | Built-in facts; author `Built-in summary (coach unavailable)`; `Couldn't get a coach review (limit reached).` [Try again]. Never a paid route | None |
| Applied | Apply tapped, valid | Card collapses to `✓ Applied: Seated row 5 × 8–10 from next Pull A` [Undo] | — |
| Undone | Undo | Back to the unapplied card | — |
| Not now | Not now tapped | Collapses to `Not applied.` + link `Show suggestion` | — |
| Out of date | Logs for that week changed after the review, or the template changed | Warning line + [Update review]; proposal `Out of date…`, Apply disabled, [Dismiss] | Disabled |
| Expired | The next session the proposal targets has started without Apply | `Not applied (expired).` | — |
| Pain-blocked | The proposal would increase load/sets on a pain-flagged movement | `validateCoachProposal` drops it: `Not suggested: you flagged shoulder pain on Overhead press.` No Apply | — |

Built-in fact priority (deterministic, `pickBuiltInObservations`): 1) consistency (`n of m planned` or `n workouts`); 2) the largest like-for-like top-set change among pinned lifts (else among all series); 3) the first of: an active pain flag → a stall (E13: same target missed in 2–3 consecutive sessions) → a muscle under 10 sets (only when the guide is on) → nothing.

### 3.5 Transitions

```
Overview ⇄ Calendar (segmented)          Overview ─ lift row ─► Exercise detail
Exercise detail ─ point/row ─► Past workout ─ Edit ─► Edit workout ─ Save ─► Past workout (recomputed)
Week review: Built-in ─(coach answers)─► Coach ready ─ Apply ─► Applied ─ Undo ─► Coach ready
                       └(timeout/err)─► Failed ─ Try again ─► Coach reviewing
Any week-review state ─(that week's data edited)─► Out of date ─ Update review ─► Coach reviewing
ResumeBar ─ Resume ─► Active workout (one tap)
```

The swap from built-in facts to the coach's review happens in place with no animation (cross-fade ≤ 150 ms, removed under Reduce Motion) and a polite VoiceOver announcement `Coach review ready.`

---

## 4. Interactions

### 4.1 Home

| Element | Tap | Other |
|---|---|---|
| Segmented `Overview / Calendar` | Switches view; each view keeps its scroll position | — |
| `This week` card | Opens `Calendar`, current week's days selected | — |
| `TrendRow` | Opens Exercise detail for that series, metric `Top set`, range `3 mo` (matching the sparkline window as closely as possible) | Long-press → context menu `Unpin`, `Move up`, `Move down` (also in `Edit`) |
| `Edit` (lifts) | Opens the pin editor sheet | — |
| `+ Pin` on a suggestion | `setPinnedLifts` at once; toast `Pinned Back squat` [Undo] | — |
| `Sets per muscle` heading / row | Opens Sets per muscle, current week; a row tap opens it scrolled and expanded to that muscle | `ⓘ` opens `How this is counted` |
| `Show all (11)` | Opens Sets per muscle | — |
| `How you said you felt` card (2026-10-09) | Opens the check-in detail: range chips `4 wk` / `3 mo` / `1 yr` / `All`, `pointsOnly` chart, `Show as table`, list; a list row or point → Past workout (or the edit sheet when no workout followed) | — |
| Week review `Why? ›` | Evidence sheet (`getDecisionEvidence`): the facts used, with links to the sessions | — |
| Week review `Apply` | `confirmProposal` → `applyCoachProposal(id, {kind: 'review_apply', expectedVersion})`; card collapses with [Undo] | — |
| `Undo` | `undoAction(actionId)` while no affected session has started; after that, a compensating proposal (coach-adjustments §4.4) | — |
| `Not now` | Records rejection; nothing changes | — |
| `Update review` | One coach call on the current facts | — |
| `Ask about this week ›` | Coach sheet with the week's facts attached | — |
| Record row | Opens Exercise detail on that series with the record's point selected | — |
| Endurance card | Opens Endurance activities for that sport | — |
| `All exercises` | Exercise list: search field, rows `Bench press · 24 sessions · last 8 Oct`, sorted by last done; `Untagged muscles` filter chip when relevant | — |
| `ResumeBar` `Resume` | Opens Active workout in its persisted state (one tap) | The rest of the bar opens it too |
| Pull to refresh | Not used. Data is local and always current | — |

### 4.2 Exercise detail

| Element | Behaviour |
|---|---|
| Series picker | Menu; selecting a series redraws the chart (no animation). The choice is remembered per exercise |
| Metric / range chips | Single select; redraw without animation. `Reps at load` shows the load chip row (loads used in ≥ 2 sessions in range; default the most used) |
| Chart tap | Selects the nearest point by date (the whole plot is the hit area, so tiny points don't need 44pt). Tap the same point or `Clear ×` to deselect |
| Chart drag | Scrubs the selection across points with `haptic.step` per point. Not required: tap, the table and the list do the same |
| `Open workout ›` | Past workout |
| `Pin` / `Pinned` | Pins this series (or opens `Replace which lift?`); tapping `Pinned` unpins with toast `Unpinned Bench press` [Undo] |
| `Show as table` / `Show chart` | Toggles. Remembered for the session of use. With VoiceOver on, the first open defaults to the table (Profile can change this) |
| History row | Past workout |
| `Load earlier` | Next month page |

### 4.3 Calendar and past workout

| Element | Behaviour |
|---|---|
| Day cell | Selects the day; day list updates. Cells are ≥ 44 × 44 |
| `‹ ›` / horizontal swipe | Previous / next month (swipe has the button equivalent) |
| Day list row | Past workout (or Resume / Today for unfinished) |
| Week `⋯` | `Mark week as deload` / `Remove deload mark` → `setWeekTag`; toast `Week of 5 Oct marked as deload` [Undo] |
| Past workout `Edit` | Edit workout (workout-summary §4). Corrections only; never an AI call; next-time targets recomputed deterministically; affected stale proposals become `Out of date` |
| Exercise row in past workout | Exercise detail for that series, point selected |
| `Edit history ›` | Read-only audit: `9 Oct 07:12 · Set 2 corrected: 100 kg × 8 → 95 kg × 8`, `End time 19:24 → 19:04` |
| `⋯` → `Share / export` | As the summary |

### 4.4 Keyboard

Only the exercise list search field uses a keyboard (system keyboard, `Search` return key, `Cancel` button). No logging happens on Progress, so the "primary above the keyboard" rule isn't affected. Muscle tagging (`Set muscles`) is a checklist, no typing.

### 4.5 Voice and coach

- No spoken cues on Progress, ever. Nothing is read aloud unless Ben asks.
- `Ask` / Talk (long-press) works on every Progress screen with the screen's context attached. Examples: "how's my squat going?", "why did my bench drop in August?", "am I doing enough back work?". The coach answers from `getExerciseTrend` / `getWeeklyMuscleVolume` facts through its read tools, cites dates and equipment, and labels estimates. It can return a link card `Open Bench press · Main Gym barbell ›`. Offline: the sheet says the coach is offline; it never gives a canned answer.
- VoiceOver is the main non-visual route (§7).

### 4.6 Undo paths

| Action | Undo |
|---|---|
| Pin / unpin / reorder | Toast [Undo] (`timing.undoToast`) |
| Week deload tag | Toast [Undo]; or `Remove deload mark` |
| Week-review proposal applied | [Undo] on the collapsed card until an affected session starts; then a compensating proposal |
| Correction in Edit workout | Toast [Undo]; audit always kept |
| Muscle tags set on a custom exercise | Toast [Undo]; editable later in the exercise's `⋯` → `Muscles` |

---

## 5. Copy

Every value is labelled **actual**, **target** or **estimate**. All numbers use tabular numerals and the formats in design-system §3.

### 5.1 Home

| Element | Text | Kind |
|---|---|---|
| Title / segments | `Progress` · `Overview` · `Calendar` | — |
| Week heading | `This week · 5–11 Oct` | — |
| Consistency | `2 of 4 planned sessions done` · `2 of 3 planned sessions done · 1 extra` · `3 workouts this week` · `No workouts yet this week.` | Actual |
| Strip legend | `✓ done  ○ planned  – not logged` | — |
| 4 weeks | `11 of 14 planned sessions in the last 4 weeks` · no plan: `11 workouts in the last 4 weeks` | Actual |
| Streak | `6 weeks in a row with a workout` (shown from 2) | Actual |
| Deload tag | `Deload week` | — |
| Lifts heading | `Lifts you follow` · `Edit` | — |
| Trend row | `Bench press` / `Main Gym · barbell` / `102.5 kg × 6 · 8 Oct` | Actual |
| Change | `Up 7.5 kg since 16 Jul` · `Down 5 kg since 16 Jul` · `Same load as 16 Jul` · `Same load, 2 more reps than 16 Jul` · assisted: `2.5 kg less assistance since 16 Jul` | Actual vs actual |
| Sparse lift | `1 session so far: 100 kg × 8 (8 Oct). A trend appears after 3 sessions.` | Actual |
| Not lately | `Not done since 14 Aug` | — |
| Other equipment | `Last done on Hotel Gym barbell (3 Oct), not in this trend.` | — |
| No pins | `Pin up to 3 lifts to follow them here.` · `Suggested: Back squat · Main Gym barbell · 9 sessions` · `+ Pin` | — |
| Muscle heading | `Sets per muscle · this week` | — |
| Method line | `Hard sets (RPE 6+ or unrated), helpers count ½ · guide 10–20` · without helpers: `Hard sets (RPE 6+ or unrated). Helper muscles not counted yet.` · guide off: drop `· guide 10–20` | — |
| Muscle row | `Chest  14 · in 10–20` · `Back  8 · under 10` · `Quads  23 · over 20` · `Triceps  7½ · under 10` | Actual |
| No muscle data | `Sets per muscle needs muscles on your exercises. 3 exercises have none.` [Set muscles] | — |
| Check-in card (2026-10-09) | `How you said you felt` · `Before each workout · 1 = rough, 5 = great` · `Thu 8 Oct  2 · Tired, Poor sleep` · `· skipped` · `· rescheduled` · `· no workout` · `9 check-ins in the last 4 weeks · 3 at 3 or lower` · detail strings in check-in.md §5.3 | Ben's own rating |
| Records heading | `Recent records · last 30 days` | — |
| Record lines | `Heaviest set: 105 kg × 3 · 1 Oct` / `Before: 102.5 kg × 3 (14 Sep)` · `Most reps at 100 kg: 9 · 5 Oct` / `Before: 8 (24 Sep)` · `Best estimated 1RM: 121 kg (estimate from 105 kg × 5) · 1 Oct` / `Before: 118 kg (estimate, 14 Sep)` · assisted: `Least assistance for 8+ reps: Assist 15 kg · 2 Oct` · bodyweight: `Most reps: 14 · 3 Oct` | Actual; estimates labelled |
| Records none | `No new records in the last 30 days.` | — |
| Records footnote (in `Show all`) | `Records compare the same exercise on the same equipment, unit and load type only.` | — |
| All exercises | `All exercises` | — |
| ResumeBar | `Push A · Rest 1:12` / `Push A · Ready` / `Push A · Paused` · button `Resume` | — |
| Empty | `Nothing to show yet` / `Log a workout, or import your FitNotes history to see your progress.` · `Go to Today` · `Import FitNotes history` | — |
| Error | `Couldn't open your training data.` [Try again] · `Restore from backup` | — |

### 5.2 Exercise detail

| Element | Text | Kind |
|---|---|---|
| Pin | `Pin` / `Pinned` · `Replace which lift?` · toasts `Pinned Bench press` / `Unpinned Bench press` [Undo] | — |
| Pain line | `Pain flag on since 2 Oct. No increases for this movement.` `Clear…` · (2026-10-09) suffix `· check due` · after clearing: `Pain flag cleared 14 Oct. Before the flag (6 Oct): 55 kg × 6.` | Actual (reference only) |
| Not counted (2026-10-09) | Marker `Not counted` · history row `100×8 (spotted)` · `100×8 (form broke)` · `100×8 (pain)` · `100×8 (other equipment)` · table note `1 set not counted (spotted)` · `— Not counted (spotted)` · range summary `Before the flag  55 kg × 6 · 2 Oct` | Actual |
| Series | `Main Gym · barbell · kg` · `Hotel Gym · barbell · kg` · `Imported (FitNotes) · kg` · `All equipment (list only)` · counts `24 sessions` | — |
| List-only note | `Different equipment isn't combined in a chart. Choose one to see a chart.` | — |
| Metric chips | `Top set` · `Reps at load` · `Est. 1RM` · `Volume` · bodyweight: `Best set` · timed: `Longest hold` · load row `At 100 kg` | — |
| Range chips | `3 mo` · `6 mo` · `1 yr` · `All` | — |
| Chart headings | `Top set (actual) · 9 Apr – 8 Oct` · `Reps at 100 kg (actual) · …` · `Estimated 1RM (estimate, Epley) · …` · `Volume: load × reps, working sets (actual) · …` · per dumbbell: `Volume: kg each × reps …` · long history suffix `· weekly best shown` | As stated |
| Axis unit | `kg` · `kg each` · `kg stack` · `reps` · `kg × reps` | — |
| Range summary | `Latest  102.5 kg × 6 · 8 Oct` · `Best in range  105 kg × 3 · 1 Oct` · `Change  Up 7.5 kg since 9 Apr` · estimate: `Latest  ≈ 123 kg (estimate) · 8 Oct` | Actual / estimate |
| Selection | `Thu 1 Oct · Push A · Main Gym` · `Top set  105 kg × 3 (actual) · RPE 9` · `Est. 1RM ≈ 114 kg (estimate from 105 kg × 3)` · `Open workout ›` · `Clear` | — |
| Markers | `Coach adjusted` · `Deload` · `Pain` · `Edited` · `Gap 24 days` · `Coach target` (session ran on an applied coach target) | — |
| History row tags | `Coach adjusted sets 3–4` · `Ran on coach target 97.5 kg × 6–8` (target) · `Edited` · `Pain noted (shoulder)` · `Imported (FitNotes)` | — |
| Too few | `2 sessions in this range. A chart appears after 3.` · `Try 1 yr` | — |
| None in range | `No Bench press sessions on this equipment between 9 Apr and 8 Oct. Last one: 2 Feb.` · `Show all time` | — |
| Not available | `Estimated 1RM isn't available for assisted exercises.` · `…for bodyweight exercises (bodyweight isn't recorded).` · `Estimated 1RM uses sets of 10 reps or fewer. None in this range.` | — |
| Table toggle | `Show as table` / `Show chart` | — |
| Load more | `Load September` | — |

### 5.3 Sets per muscle

| Element | Text |
|---|---|
| Title / week | `Sets per muscle` · `Week of 5 Oct (this week)` · `Week of 28 Sep` |
| Contributor | `Bench press  4 sets × 1 = 4` · `Bench press  4 sets × ½ = 2` |
| Unrated | `4 of these sets had no effort rating and were counted.` |
| Marked sets (2026-10-09) | `2 sets you marked (spotted) are counted here, but not in records.` (shown only when the week has any) |
| Not counted | `9 warm-up sets · 1 set rated under RPE 6` · `Cable crunch: no muscles set (3 sets)` · `Set muscles ›` |
| Link | `How this is counted ›` (sheet text in §2.5) |

### 5.4 Calendar and past workout

| Element | Text |
|---|---|
| Month | `October 2026` |
| Legend | `● workout  ▲ endurance (imported)  ○ planned` |
| Day list | `Push A · Main Gym` / `18:02–19:04 · 54 min · 16 working sets` (actual) |
| Planned, not logged | `Pull A was planned · not logged` |
| Empty | `No workouts in October.` · `Nothing logged on Tue 6 Oct.` |
| Unfinished | `In progress · Resume ›` · `Unfinished · Finish or resume on Today ›` |
| Week row | `Week of 5 Oct · 3 workouts` · tag `Deload` · menu `Mark week as deload` / `Remove deload mark` · toast `Week of 5 Oct marked as deload` [Undo] |
| Past workout | Title/facts/exercises as workout-summary §5; heading `Exercises (actual)`; `Next time (decided after this workout)`; statuses `✓ Coach target applied: 97.5 kg × 6–8` · `Not applied (expired)` · `Built-in rule: …` (targets) |
| Audit | `Edit history (2 changes)` · rows `9 Oct 07:12 · Set 2 corrected: 100 kg × 8 → 95 kg × 8` |
| Saved | `Changes saved` [Undo] |
| Conflict | `This workout changed since you opened it. Reload to edit.` [Reload] |

### 5.5 Week review

| Element | Text |
|---|---|
| Heading | `Week review · 28 Sep – 4 Oct` |
| Author tags | `Coach` · `Built-in summary` · `Built-in summary (coach offline)` · `Built-in summary (coach not connected)` · `Built-in summary (coach unavailable)` |
| Source tags | `Your logs` · `FitNotes import` · `Garmin file, imported 3 Oct` · `Built-in` (replaced observation) |
| Built-in fact templates | `You did 4 of 4 planned sessions.` · `You did 3 workouts.` · `Bench press top set: 102.5 kg × 6, up from 100 kg × 6 on 24 Sep.` · `Pain flag on Overhead press since 2 Oct.` · `Back squat: 130 kg × 5 target missed in the last 3 sessions.` (target) · `Back had 8 hard sets, under the 10–20 guide.` |
| Coach observation rules | One sentence each, ≤ 110 characters, past tense, numbers only from the facts, no praise, no scores, no diagnosis, no causal claims about fatigue ("may", never "caused") |
| Proposal | `ChangeReviewCard`: `Suggested change · Future sessions` + one-sentence reason + before/after rows labelled `Target` + `Why? ›` [Not now] [Apply] |
| Deload proposal | `Lighter week next week` / `Your top sets dropped in the last 2 sessions of Bench press and Back squat.` / rows `Sets 4 → 2 per exercise`, `Effort target RPE 7 or easier` (targets) |
| Applied | `✓ Applied: Seated row 5 × 8–10 from next Pull A` [Undo] |
| Not now | `Not applied.` · `Show suggestion` |
| Nothing | `No changes suggested.` |
| Reviewing | `Coach is reviewing…` |
| Offline footer | `Coach review will be added when you're back online.` |
| Failed | `Couldn't get a coach review (limit reached).` [Try again] · timeout: `The coach didn't answer in time.` [Try again] |
| Out of date | `Based on your logs before the edit on 9 Oct.` [Update review] · proposal `Out of date. Your logs changed since this was suggested.` [Dismiss] |
| Pain-blocked | `Not suggested: you flagged shoulder pain on Overhead press.` |
| Footer | `Ask about this week ›` |

### 5.6 Endurance

| Element | Text |
|---|---|
| Heading | `Endurance (imported)` |
| Source / import | `Garmin FIT files` · `Strava export` · `Last import 3 Oct` |
| Week line | `This week: 2 runs · 1 h 35 min · 18.2 km` (only fields present) |
| Chart caption | `weekly time, last 8 weeks` |
| Footnote | `Imported activities only. Shown separately from lifting.` |
| Missing field | `Distance not in this source.` |

### 5.7 VoiceOver summaries (examples)

| Element | Label |
|---|---|
| TrendRow | "Bench press, Main Gym barbell. Latest top set 102.5 kilograms by 6 on 8 October. Up 7.5 kilograms since 16 July. 11 sessions in 12 weeks." |
| Detail chart | "Top set, actual results, Bench press on Main Gym barbell, 9 April to 8 October. 18 sessions. Lowest 95 kilograms by 8 on 9 April, highest 105 kilograms by 3 on 1 October, latest 102.5 kilograms by 6 on 8 October. One gap of 24 days in August. One deload week. One pain flag. Swipe up or down to move between sessions." |
| Point (adjustable) | "Thursday 1 October, 105 kilograms by 3, RPE 9. Pain noted. Double-tap to open the workout." |
| Estimate chart | "Estimated one-rep max, an estimate using the Epley formula …" |
| Muscle row | "Chest, 14 hard sets this week, within the 10 to 20 guide." / "Triceps, 7 and a half hard sets, under 10." |
| WeekStrip | "This week: Monday done, Tuesday planned, not logged, Wednesday done, Thursday planned, Friday planned." |
| Calendar day | "Thursday 8 October, Push A, 54 minutes, edited. Selected." |

---

## 6. Data needed

All Progress reads are local and pure-domain computed from finished sessions with corrections applied (the same projection `toHistorySessions` uses). Nothing is stored as "the record" or "the trend": derived values are recomputed (or cache-invalidated by data version) so a correction changes every view (brief scenario 5). The UI never computes metrics itself.

### 6.1 Functions

Existing (brief §7–8, other specs): `getWeeklyTrainingSummary(userId, range)`, `getComparableHistory(exerciseId, equipmentId, filters)`, `buildWorkoutSummary(sessionId)`, `summariseVolume`, `toHistorySessions`, `compareDifficulty` / `loadsByDifficulty`, `correctSet`, `updateSessionTiming`, `getAiCapabilities`, `runCoachTurn`, `validateCoachProposal`, `confirmProposal`, `applyCoachProposal`, `undoAction`, `getDecisionEvidence`, `getActiveSession`, `setPainFlag`.

Proposed (contracts for the developer; names follow the brief's style):

| Function | Returns / behaviour |
|---|---|
| `buildProgressHome(ownerId, localDate)` | One view call, no AI dependency: `{resume, week: WeeklyConsistency, pinned: PinnedTrend[0..3], pinSuggestions: SeriesInfo[], muscleVolume: WeeklyMuscleVolume, review: WeeklyReviewView \| null, records: {items: PersonalRecord[0..3], total}, endurance: EnduranceSummary[], dataState: 'empty' \| 'sparse' \| 'normal'}` |
| `getWeeklyConsistency(ownerId, weekStart)` (part of `getWeeklyTrainingSummary`) | `{planned, done, extra, days: [{date, status: 'done' \| 'planned' \| 'not_logged' \| 'rest', sessionIds}], last4Weeks: {planned, done, workouts}, weekStreak, weekTag}` |
| `listExerciseSeries(ownerId, exerciseId)` | `SeriesInfo[] {seriesKey, gymName, equipmentLabel, convention, unit, source: 'app' \| 'import', sessionCount, lastDate}` where `seriesKey = {exerciseId, equipmentId \| importSourceId, convention, unit}` |
| `getExerciseTrend(ownerId, seriesKey, metric, range, opts?)` | `metric: 'top_set' \| 'reps_at_load' \| 'e1rm' \| 'volume' \| 'best_reps' \| 'longest_hold'`; `opts.load` for reps-at-load. Returns `{points: [{sessionId, date, value, display, kind: 'actual' \| 'estimate', sourceSet}], gaps: [{from, to, days}], markers: ChartMarker[], summary: {latest, best, change}, aggregation: 'session' \| 'weekly_best', availableMetrics, a11ySummary}` |
| `getChartMarkers(seriesKey, range)` (inside the trend) | `ChartMarker = {kind: 'coach_adjusted' \| 'coach_target' \| 'deload' \| 'pain' \| 'edited' \| 'gap', date \| span, sessionId?, label}`. Sources: applied, not-undone `ActionRecord`s; `targetSource: 'coach'` on sets; week tags / programme deload weeks / applied deload proposals; `PainFlagEvent`s (PG13); correction audit |
| `getWeeklyMuscleVolume(ownerId, weekStart)` | `{muscles: [{muscle, hardSets (in halves), direct, helper, unrated, contributors: [{exerciseId, sets, factor: 1 \| 0.5}]}], notCounted: {warmups, easy, untagged: [{exerciseId, sets}]}, guide: {enabled, min, max}, helpersCounted: boolean}` |
| `getPersonalRecords(ownerId, {since, seriesKey?, limit})` | `PersonalRecord {kind: 'heaviest_set' \| 'most_reps_at_load' \| 'best_e1rm' \| 'least_assistance' \| 'most_reps', seriesKey, sessionId, setId, value, previous: {value, date} \| null, date, isEstimate}` (PG10 rules) |
| `estimateOneRepMax(load, reps, convention)` | Pure. `{value, formula: 'epley', eligible: boolean, reason?}`. Not snapped to achievable loads (it isn't a target) |
| `buildWeeklyReviewFacts(ownerId, weekStart)` | Deterministic `{factsVersion, facts: [{id, kind, text, numbers[], source, refs}]}` |
| `pickBuiltInObservations(facts)` | The fixed priority in §3.4, max 3 |
| `getWeeklyReview(ownerId, weekStart)` | Stored review: `{status, author, observations: [{text, factIds, source}], proposalId?, factsVersion, stale}` |
| `requestWeeklyReview(ownerId, weekStart, factsVersion, opId)` | Wraps `runCoachTurn` with the facts only (no raw history dump); idempotent per `(weekStart, factsVersion)` |
| `validateWeeklyReview(review, facts)` | Drops observations whose numbers aren't in `facts`, caps at 3, passes any proposal through `validateCoachProposal` (catalogue, achievable loads, equipment max, pain block, versions) |
| `getCalendarMonth(ownerId, month)` | `{days: [{date, sessions: [{sessionId, title, gym, start, end, activeMin, workingSets, tags, state}], plannedNotLogged: [...], endurance: [{activityId, sport, source}]}], weekTags}` |
| `buildWorkoutSummary(sessionId, {mode: 'history'})` | The summary view plus proposal history and `editHistory[]` |
| `setPinnedLifts(ownerId, seriesKeys[], expectedVersion, opId)` | Max 3, ordered |
| `setWeekTag(ownerId, weekStart, tag: 'deload' \| null, expectedVersion, opId)` | Versioned, undoable |
| `setExerciseMuscles(exerciseId, primary[], secondary[], expectedVersion)` | Custom exercises only; catalogue entries are fixed |
| `getEnduranceSummary(ownerId, range)` | Per sport: weekly totals of fields present, `source`, `lastImportAt`. No derived scores |
| (2026-10-09) `buildProgressHome` adds `checkIns: {recent[0..4], count4w, atOrBelowCount, threshold} \| null`; `getCheckInHistory(ownerId, {fromLocalDate, toLocalDate})`; `summariseCheckIns(items, {atOrBelow})` (counts only) | check-in.md §6. `buildWeeklyReviewFacts` never includes check-ins |
| (2026-10-09, PG21–PG23) `isSetCountable(set, purpose)` (active-workout.md §6) used by `getExerciseTrend`, `getPersonalRecords` and `estimateOneRepMax` callers; `ChartMarker.kind` adds `'not_counted'`; points carry `excludedSets: [{setId, reasons[]}]`; `getWeeklyMuscleVolume` adds `markedCounted` (count of flagged sets it included); `getPainReference(flagId)` and `getPainFlagChecksDue` for the pain line | `buildWeeklyReviewFacts` labels flagged sets with their words and never uses them for a "best" fact |

### 6.2 Metric definitions (domain, unit-tested)

| Metric | Definition |
|---|---|
| Top set | Per session, the completed non-warm-up set **not marked as not counting** (PG21) with the highest difficulty (`compareDifficulty`: more load, or less assistance), ties → more reps. Value = load; display `load × reps` |
| Reps at load | Per session, the most reps in one completed non-warm-up, unmarked set at exactly the chosen load |
| Est. 1RM | Per session, the highest Epley estimate `load × (1 + reps / 30)` (reps = 1 → load) over eligible sets (PG11), never a marked set (PG21). Display rounded to 0.5 kg / 1 lb with `≈` |
| Volume | Σ load × reps over completed non-warm-up sets. Unilateral: the busier side (as `summariseVolume`) |
| Best set / Longest hold | Bodyweight: most reps in one set. Timed: longest completed duration |
| Change | Latest point vs the first point in the range: load difference; if equal, rep difference. Words `Up` / `Down` / `Same`; assisted reads as assistance |
| Hard set | Completed, non-warm-up, RPE ≥ 6 or RIR ≤ 4, or unrated (PG7). Deleted and skipped sets never count. Sets marked as not counting (PG21) **do** count here (AW8) |
| Muscle count | 1 per primary muscle, ½ per secondary muscle; a left + right pair counts once |
| Gap | ≥ `TREND_GAP_DAYS` (21) between consecutive sessions of a series |
| Record | Strictly better than every earlier session in the same series, with ≥ 3 earlier sessions. Only unmarked sets can set or hold a record (PG21); marking a record set later recomputes the record. Records from before a pain flag stay records after it's cleared (PG22) |

### 6.3 Metric availability by load convention

| Convention | Top set | Reps at load | Est. 1RM | Volume |
|---|---|---|---|---|
| Barbell total, per dumbbell, stack, plates | Yes | Yes | Yes (1–10 reps) | Yes |
| Assisted | Yes (least assistance) | Yes | No | No |
| Bodyweight + added | Yes (added load) | Yes | No | No |
| Bodyweight | `Best set` (reps) | No | No | Total reps |
| Duration | `Longest hold` | No | No | Total time |

---

## 7. Accessibility, Dynamic Type and appearance

- **Charts are never the only route.** Every chart has a visible `Show as table` toggle, a one-paragraph VoiceOver summary (§5.7) and an adjustable element: swipe up/down moves between points, each read with date, actual value, effort and markers. A native Audio Graph (`accessibilityChartDescriptor`) is a nice-to-have if the Swift bridge allows it later.
- **Not colour-only.** One series per chart, so there are no colour legends. Markers are icon + word. Muscle status is the text `in 10–20` / `under 10` / `over 20`, never a red/green bar. Change uses an arrow icon and the words `Up` / `Down` / `Same`, in `text.secondary`, never status colours (a lower number isn't "bad"; it may be a deload). Calendar glyphs differ in shape (`●` `▲` `○`). Pain uses `status.warning` **plus** the triangle icon and the word.
- **Dynamic Type.** All text uses the type tokens (≥ 16pt). At AX1+: `TrendRow` hides the sparkline and stacks its text; `VolumeBandRow` puts the value line above a full-width bar; the `WeekStrip` becomes a list (`Mon · Done · Push A`); chart axis labels cap at 1.5× and the chart height grows to `chart.detailHeightAX`; the table stacks rows. Nothing scrolls horizontally at AX3.
- **Touch targets.** Every row, chip, toggle and calendar cell ≥ 44 × 44. Chart points use the whole plot as the hit area.
- **Motion.** No animated drawing, no count-up numbers, no transitions on chip changes. Reduce Motion removes the review cross-fade.
- **Dark/light.** All colours are tokens (design-system §2, §2.1), so both modes switch together. Increase Contrast: gridlines become 2pt `border.control`, band fill gets `border.control` edges at 2pt.
- **Focus order** (home): title → segments → This week → Lifts → Sets per muscle → How you said you felt → Week review → Records → Endurance → All exercises → Ask → ResumeBar → tab bar.

---

## 8. Acceptance checks

**Home**
1. With airplane mode on and no AI connected, every Progress screen renders fully. The only AI signs are the `Ask` pill `Offline` and the review tagged `Built-in summary (coach offline)` or `(coach not connected)`; no coach-worded text appears.
2. A fresh install with no data shows only the `Nothing to show yet` card with `Go to Today` and `Import FitNotes history`. No chart frame, axis or empty heading appears anywhere.
3. The home region order is identical with sparse and full data (only content changes).
4. Plan 4 sessions, finish 2 and one unplanned workout: the card reads `2 of 4 planned sessions done · 1 extra`; the strip shows `✓` for done days and `–` for past planned-but-not-logged days, with the legend. No red, no "missed", no "behind".
5. With workouts in each of the last 6 weeks and none yet this week (Wednesday), the streak line still reads `6 weeks in a row with a workout`. With a 1-week break, the streak line is simply absent; no "streak lost" text appears.
6. Pin Bench press on Main Gym barbell; log bench on Hotel Gym barbell: the trend row doesn't include the hotel session and shows `Last done on Hotel Gym barbell (…), not in this trend.`
7. A pinned lift with 2 sessions shows text (`… A trend appears after 3 sessions.`), not a sparkline.
8. Pin #1 is the lift shown on Today; reordering pins changes Today's line.
9. With an unfinished workout < 6 h old, Progress shows the `ResumeBar`, and one tap on `Resume` shows the current set or rest with the correct remaining time.

**Sets per muscle**
10. A week with bench press 4 sets at RPE 8, 2 warm-ups, 1 set at RPE 5 and 2 unrated sets gives Chest `6` (4 + 2 unrated), shows `2 of these sets had no effort rating and were counted.` and lists `2 warm-up sets · 1 set rated under RPE 6` under `Not counted`.
11. With `secondaryMuscles` available, 4 bench sets add `2` to Triceps, and the contributor line reads `Bench press 4 sets × ½ = 2`. Without it, the method line says `Helper muscles not counted yet.`
12. A unilateral exercise logged as 3 left + 3 right sets counts 3, not 6.
13. Rows show `in 10–20` / `under 10` / `over 20` as text; the bar has band edges with ≥ 3:1 contrast. With the guide off, no band or range text appears.
14. A custom exercise with no muscles appears under `Not counted` with `Set muscles ›`, never silently dropped.

**Exercise detail and charts**
15. The chart never mixes series: choosing `All equipment (list only)` hides the chart and shows the explanation.
16. Every chart heading states `(actual)` or `(estimate, Epley)`. Every estimated 1RM on any screen contains "estimate" or "Est." and `≈`.
17. Est. 1RM ignores sets above 10 reps, and isn't offered for assisted, bodyweight or bodyweight + added exercises.
18. Correct a bench set from 100 × 8 to 95 × 8 in Calendar → Past workout → Edit: the chart point, table, history row, records and next week's review facts all use 95 × 8, the session shows `Edited`, and the audit keeps 100 × 8.
19. A 24-day gap breaks the line and shows `Gap 24 days` in the marker lane and table.
20. A session with an applied, not-undone coach adjustment shows the `Coach adjusted` marker; an undone adjustment shows none.
21. A week Ben tagged `Deload` shows the deload span; a lighter week without a tag shows no deload marker.
22. A pain flag set on 2 Oct and cleared on 9 Oct shows a `Pain` span over those dates, and the pain status line appears only while the flag is active.
23. Tapping a point updates the selection panel (nothing covers the chart) and `Open workout ›` opens that exact session.
24. With VoiceOver, the chart reads its summary, swipe up/down moves point by point, and `Show as table` gives the same values in rows.
25. `All` range on 4 years of FitNotes history draws weekly bests with `· weekly best shown` in the heading; the table still lists every session.

**Records**
26. Records never compare across equipment instances, units or load conventions: a heavier set on another gym's bar isn't a record for Main Gym barbell.
27. A series with fewer than 3 earlier sessions never shows a record; importing history doesn't produce a burst of records for the import dates.
28. No record UI has a badge, trophy, confetti or animation; text only.

**Calendar**
29. Calendar glyphs differ by shape and are explained by the legend; VoiceOver reads each day's sessions.
30. `Mark week as deload` adds the tag with an Undo toast, and the marker appears in affected exercise charts.
31. A past workout opens read-only with `Edit` in the nav bar; Edit never calls the coach, and next-time targets recompute deterministically.

**Week review**
32. With the coach connected, opening Progress on Monday makes exactly **one** coach call for the previous week; reopening makes none. No call is made in the background or on Tuesday if Monday's succeeded.
33. The review never shows more than three observations or more than one proposal; each observation has a source tag.
34. A coach observation containing a number not in the facts payload is replaced by a built-in fact tagged `Built-in`.
35. Offline, the card shows built-in facts only, no proposal, and `Coach review will be added when you're back online.`
36. Apply changes only future template targets, shows the scope `Future sessions`, collapses with [Undo], and Undo restores the previous template. Completed sets are never changed.
37. Correcting a set in the reviewed week marks the review `Based on your logs before the edit on …` and the proposal `Out of date` with Apply disabled; no coach call is made until `Update review`.
38. A proposal that increases load or sets on a pain-flagged movement is never shown with Apply.

**Endurance (later)**
39. Without imported endurance data, no endurance heading, card or empty frame appears.
40. With imported runs and rides, each sport has its own card with a source tag and import date; no screen shows a combined strength + endurance number or any readiness, recovery or fitness score.

**General**
41. All text is ≥ 16pt at default size and all numbers use tabular numerals; at AX3 nothing scrolls horizontally.
42. In light mode every chart token switches, and the line, band edges, bars and selected point keep ≥ 3:1 against their background.
43. No element animates other than standard navigation, sheet and segmented-control transitions.

**Check-ins (2026-10-09)**
44. The `How you said you felt` card sits between `Sets per muscle` and `Week review` and shows raw check-ins and counts only; no average, percentage or trend word appears anywhere in Progress for check-ins.
45. The check-in detail chart has a fixed 1–5 axis labelled `1 rough` and `5 great`, points with no connecting line, and `Show as table`; its VoiceOver summary gives counts per value, not a mean.
46. Exercise charts, records, `This week` and the week review never show or use check-ins (the week-review facts payload has none).
47. A past workout with a check-in shows the same `CheckInLine` as its summary.

**Sets that don't count and pain flags (2026-10-09)**
48. A session's 105 kg × 3 set marked `Spotted`: the `Top set` point, `Best in range`, `Recent records` and `Est. 1RM` use the next unmarked set, and the history row reads `105×3 (spotted)`. Unmarking it restores the point and the record (recomputed, nothing stored).
49. A session where every set is marked has no chart point, shows `Not counted` in the marker lane and `— Not counted (spotted)` in the table, and VoiceOver says so.
50. The same marked sets still count in `Sets per muscle` and `Volume`; the detail screen shows `2 sets you marked (spotted) are counted here, but not in records.`
51. With an active flag whose check is due, the pain line ends `· check due`, and tapping it opens the pain flag sheet. No Progress screen ever clears a flag without the confirmation.
52. Clearing a flag on 14 Oct leaves every pre-flag point, record and the `Pain` span on the chart unchanged, and shows `Pain flag cleared 14 Oct. Before the flag (6 Oct): 55 kg × 6.` until 9 Dec, then nothing.
53. The `Before the flag` value is labelled as an actual result and is never offered as a target or a button that sets one.
54. With airplane mode on and no AI, all of checks 48–53 behave the same.
