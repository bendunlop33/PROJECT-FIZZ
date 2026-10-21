# Progress goals: one Reviews area for different aims (rev 2)

> **Progress v3, agreed with Ben 21 Oct 2026. This section supersedes the rest of this file where they differ.** Prototype: `docs/design/prototypes/progress-simple.html` (artifact https://claude.ai/artifact/GfDtC5R8YydovHNhtcuoPv).

## Progress v3 (agreed)

**Goals:** Get stronger / Build muscle / Both (Profile training goal). "Follow the plan" is not a goal: plan adherence is always shown in This week. Not set behaves like Both.

**Page, top to bottom (Progress › Reviews):**
1. **Goal (last 8 weeks).**
   - *Strength tracker* (Get stronger, Both): subtitle `Top set at each lift’s reps · ○ est.` (13 pt). Real points filled, estimated points hollow (tap → `est. 97.5 × 6 from 100 × 4`). **Targets in the all-lifts view** sit in a right gutter: a short bar in the lift's colour at the target height with its number (`110`), plus a faint dotted guide from the latest point; the full dashed target line and the `at this rate` estimate appear when one lift is focused (focused subtitle `Top set × 6 (target reps) · 100 now`). Table under the chart (Ben, 21 Oct), compact 34 pt rows, 13 pt text, small caps header `LIFT · REPS · CURRENT · TARGET`, four equal-width columns, name left and every number column right-aligned like the builder/Today tables: colour dot · `Bench` · `× 6` · `100` (no change figure; the chart shows the trend) · `110` (or `–`). Tap a row = focus that lift. One line per tracked lift in **real kg on one axis**, colours = dataviz categorical slots 1–3 (dark: `#3987e5`, `#d95926`, `#199e70`), legend rows under the chart: dot · name · `100 × 6` · `+10 kg` (· `level 3 wk` when the last 3 are equal) · `target 110` when a lift target exists. Tracked lifts default to the plan's main lifts (typically 3, not locked); `Edit lifts` adds/removes (up to 6); adding a lift not in the plan asks for its reps once.
   - **Tap a line or its row** → that lift alone, axis rescaled to it: its target as a dashed line, `On track` when the trend reaches the target, and `about mid-Nov at this rate` (labelled `est.`) as a dotted line — only after ≥ 4 weeks of rising top sets and only if the date is within 6 months (Ben liked it; overrides the earlier no-projection note and the `lift-targets.ts` comment). `All lifts` returns.
   - **Reps each lift is tracked at (Ben, 21 Oct):** the lift target's reps if a target is set, else the plan's reps for that lift's top set (or the reps Ben picked when adding it). Every point is comparable at those reps: a **real** point (solid) when a set was done at those reps (heaviest load for ≥ those reps), otherwise an **estimated** point (hollow, `est.`, tap → `est. from 105 × 4`) converted from the best set of 3–12 reps that session (same e1RM formula the app already uses); singles and >12-rep sets never drive an estimate. History before the plan is shown the same way. When the tracked reps change (new target / plan change), the whole chart is recomputed at the new reps and a small marker shows the date (`now × 4`). Change words and `On track` use real points; if a window has only estimates they are labelled `est.` too. Same-machine rule for stacks/plate-loaded kept.
   - *Muscle tracker* (Build muscle, Both): weekly sets vs plan as 8 bars (plan as background bar, done as fill; paused weeks dashed `⏸`), subtitle `58 of 62 last week · last 8 weeks`.
2. **This week (13–19 Oct).** `Sessions 3 of 4 · 2 runs`; one chip per planned session with **day and % of planned reps done** (names spelled out, no ✓: **done = soft green** chip, **missed = faint grey** (`Thu – missed`, no red; Ben 21 Oct), upcoming/moved = outline; colour is never the only signal, the second line says `– 92%`, `– missed` or `– moved`; 12 pt: `Chest` over `Mon – 100%`, `Back` over `Wed – 92%`, `Shoulders` over `Fri – 104%`, `Legs` over `Sat – moved`; day and % always on one line, no wrapping at 320 pt; Ben, 21 Oct). % = all working reps done ÷ reps planned (warm-ups excluded; planned reps = each set's target reps as planned for that session, e.g. 10 for an 8–12 set planned at 10; only a set with no single target uses the low end of its range); **it can go over 100%** (Ben, 21 Oct): extra reps and sets you added count. Skipped planned sets count 0. Because extras can offset a skipped set, the Summary detail always names what was short or skipped. Tap → that workout's Summary with `156 of 170 planned reps` and what was short. Never write sets/reps as `15/15` (reads as a date); tap → that workout's Summary (or `planned Thu, moved to Sat`). Then sets per muscle vs plan bars (`14 of 12`). More informative than Today's strip, which stays as-is (3 back / 3 ahead, name + day + ✓) for spacing.
3. **Coach's changes (for next week).** One coach sentence, then the changes the coach **already made** to next sessions (rule 3: small load/reps/sets changes on the same exercises are automatic, with reason and Undo), e.g. `Row 3 × 8 → 4 × 6 · next Pull · Stuck at 92.5 × 8 for 3 weeks  Undo`. Only structural changes are asked (day moves, swaps, add/remove), e.g. `Legs has moved to Saturday 3 weeks running. Make Saturday its day in your plan?` [Move Legs to Sat] [Keep as is]. Offline: the built-in rule's changes with `Not reviewed · Offline`. `Past weeks ›` lists earlier weeks (facts + changes).

**Today vs Progress:** Today looks forward (today's session, the spacing strip, the one change that touches today under `Why?`); Progress looks back (trends, the plan week in detail, all of next week's changes with Undo).


Status: **Proposal for Ben, 21 Oct 2026 (rev 2, after two critiques).** Nothing here is approved yet. Ben decides §12.
Prototype: [prototypes/progress-goals.html](prototypes/progress-goals.html) (example data).

> Ben, 21 Oct: "think more about the context of the review / progress and how it would suit different needs. e.g. if the target was following the plan sets, or plan volumes, or progress towards weight etc. — think about how runna and other apps do it"

Builds on [workout-builder-v3.md](workout-builder-v3.md) §6–§6.2 (Reviews area, 21 Oct Goal bullet), [training-blocks.md](training-blocks.md), [progress.md](progress.md) (PG7, PG26), [lift targets](../../packages/schemas/src/lift-targets.ts) and the research in [plans-and-plan-progress.md](../research/plans-and-plan-progress.md), [competitor-analytics.md](../research/competitor-analytics.md) and [competitor-landscape.md](../research/competitor-landscape.md). Tokens: [design-system.md](design-system.md), Direction D. Nothing here adds a step to Active set, Rest or Summary, and nothing new appears on Today.

---

## 0. In short (for Ben)

Each of your three examples gets its own card, and there are no settings to manage:

| You want to see… | Card | Measured against |
|---|---|---|
| "Am I following the plan's sets?" | **Plan** (always first) | Sessions vs your days-a-week aim, and the planned sets in the sessions you did |
| "Am I getting the planned volume?" | **Muscles** | Sets per muscle vs what those sessions planned |
| "Am I getting closer to a weight?" | **Lifts** | Your own earlier sessions at the same reps, plus your lift targets |

- Your training goal (strength / muscle / both) only decides the **order**. There's no separate "focus" setting.
- The cards show **numbers instead of verdicts**: `41/44`, not `Behind`. Only the words the app already uses appear (`Hit`/`Short`/`Over`, `Up`/`Level`/`Down`, `Paused`, `Held · pain`).
- There are no scores, no streaks, nothing called "missed", and no predictions unless you switch on the opt-in Option (Q2).
- The weekly review stores the same facts every week, so any week can be compared with any other.

---

## 1. Purpose

**Question answered:** "How is my training going against what I'm aiming for?" The screen answers it with facts from logged data, measured against the plan where one exists.
**Primary action:** none on a normal visit; it's a read-only screen. When a weekly review is new, its primary action is `Open review`. A proposal's primary action is `Apply`.

**Why the plan is the yardstick (Runna lesson, adapted):** Runna judges each run against the plan and keeps the plan separate from the race outcome. GymSmarter's plan is a rotation and today's loads come from logged sessions, not a path, so only two things borrow the idea: **plan sets** and **targets hit**. Lifts are compared with Ben's own past sessions. Runna's other useful lesson is that its Plan tab leads with *this week* and *the next session*, which the Plan card's day strip copies. We copy no screens, names or assets.

---

## 2. Model

### 2.1 Order comes from the training goal only

| Profile goal | Card order (after `Latest`) | Collapsed |
|---|---|---|
| `strength` | Plan · Lifts · Muscles | Muscles |
| `muscle` | Plan · Muscles · Lifts | Lifts |
| `both` | Plan · Lifts · Muscles | none |
| not set | Plan · Lifts · Muscles | Lifts, Muscles |

- A **collapsed** card is one row showing its first values (`Muscles  Chest 12/12 · Back 13/14 · …  ›`, `Lifts  Bench 102.5 × 6 · Squat 117.5 × 5 · …  ›`), and tapping it expands the card in place. Nothing is hidden, just lower down.
- Changing the goal in Profile reorders the cards. No other write or setting is involved, and nothing about order is stored on reviews.

### 2.2 What counts (code, pure, unit-tested)

| Term | Definition | Source |
|---|---|---|
| **Week** | Local Monday–Sunday | `localWeekBounds` |
| **Aim** | Profile `Days a week you lift` minus paused days (`aimWithPause`). With no aim: the plan's day count. With neither: no aim, and counts are shown with nothing to compare against | Change W3 (today `planWeekOf` uses plan length) |
| **Sessions** | Distinct local dates trained (`consistency().thisWeek.days`) | existing |
| **Plan sessions** | Finished workouts started from a plan day (`routineId` / `createdFromSessionId`). Off-plan workouts that met a day count toward **Sessions** but not toward planned sets; `Why?` lists them as `1 off-plan` | `dayOf`, `planDaysDoneBy` |
| **Planned sets** | Σ planned working sets **snapshotted on each finished plan session** (`WorkoutSet.planned`), never today's templates. Sessions that didn't happen add nothing, so a skipped day appears only once, in the session count | `plannedVsDone` |
| **Sets done** | `plannedVsDone().doneSets`: working sets done, capped per exercise at the planned count. Extra sets don't raise it, and the app never says "ahead" | existing; test pins the cap |
| **Targets hit** | Exercises whose verdict is `Hit` **or** `Over` / exercises with a target, in plan sessions. This is the same definition as `exerciseTargetHistory.hitText` | existing |
| **Muscle sets** | Working sets per muscle group with PG26 credit (1 primary, ½ helper), **done and planned counted the same way**, both from the plan sessions done that week. Off-plan sets add to done only. Hard-set counts (PG7) stay in Progress › Training | new `muscleSetsVsPlanned` |
| **Lift top set** | The heaviest load lifted for at least the lift's **usual reps** in a session. Usual reps = the most common working-set rep count over its last 6 sessions, with ties going to the lower count | new `liftTopAtReps` (uses `repTableByReps`) |
| **Change words** | Compares the latest session's top set at usual reps with the first of the last 3 sessions, which must span ≥ 3 weeks. Heavier load reads `Up x kg in n wk`, the same load reads `Level n wk`, a lighter load reads `Down x kg in n wk`. Comparisons are exact (loads are discrete, so there's no noise band). Fewer sessions: nothing is shown | new `liftChange` |
| **Same equipment** | For `stack` and plate-loaded `added` conventions, only sessions on the same `equipmentId` are compared (`SeriesKey`). If the latest session used different equipment, the row shows `Different machine` and no change word | `SeriesKey` |
| **Est. 1RM** | Never in change words or on this screen. It stays a labelled chart toggle in Progress › Lifts (sets ≤ 10 reps, `est.`) | `estimateOneRepMax` |
| **Runs** | Activities with `type: 'run'` and `status: 'done'`. Rides, swims and the rest are left out of this row, and runs never count toward the lifting aim | activities |
| **Pain hold** | A set is held if a flag on **that exercise** was active at the time of the set (`reportedAt` ≤ set < `clearedAtUtc`). There are no muscle-level holds | `PainFlagSchema` |
| **Paused** | Paused days leave the aim. A fully paused week shows `⏸` and is never compared | `pausedInWeek` |

Deload and Light weeks need training blocks (TB3+) and are not part of Wave 3.

---

## 3. Layout (Progress › Reviews, iPhone 390 pt, Direction D)

Progress keeps its tabs (`Reviews` · `Lifts` · `Training`).

```
┌──────────────────────────────────────────────┐
│ Progress                                     │
│ [ Reviews ][  Lifts  ][ Training ]           │  segmented, 44 pt
│                                              │
│ ┌ WEEK OF 13 OCT · NEW ────────────────────┐ │  only while new or open
│ │ 4 of 4 days, 58 of 62 planned sets. Coach│ │  coach line, or Not reviewed
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ Cable row on Pull                    │ │ │  ≤ 2 proposals
│ │ │ 3 × 10–12 → 3 × 8–10                 │ │ │  before → after (targets)
│ │ │ [Next Pull] [Future Pulls]           │ │ │  scope chips (rule 2)
│ │ │ [ Apply ]          Skip      Why?    │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ │ Open review ›                            │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌ PLAN ──────────────────────────── Why? ──┐ │  always first
│ │ This week   2 of 4                       │ │  actual of aim
│ │ [Push ✓][Pull ✓][Legs  ][    ]           │ │  plan-day strip (§3.1)
│ │  Mon     Wed    next                     │ │
│ │ Runs 1                                   │ │
│ │ Planned sets 27/28 · Targets hit 9 of 10 │ │  plan sessions only
│ │ Push  Mon  15/15 · Hit 5 of 5         ›  │ │  per plan session
│ │ Pull  Wed  12/13 · Short: Cable row   ›  │ │
│ │ ▕█▏▕█▏▕▒▏▕█▏▕█▏▕⏸▏▕▒▏▕█▏                  │ │  8 wk, done vs aim
│ │  4  4  3  4  4  –  3  4                  │ │  digits carry meaning
│ │ Runs 2  1  2  2  1  0  1  2              │ │
│ └──────────────────────────────────────────┘ │
│ ┌ LIFTS ───────────────────────── Edit ────┐ │
│ │ Bench Press          102.5 × 6        ›  │ │  top set at usual reps (actual)
│ │ Up 2.5 kg in 3 wk    ╭─●─●─●┈110╮        │ │  sparkline + target line
│ │ Target 110 × 6 · 7.5 kg to go · 8 wk left│ │  target (no ≈ for weight×reps)
│ │ Squat                117.5 × 5        ›  │ │
│ │ Up 5 kg in 4 wk                          │ │
│ │ Row                   92.5 × 8        ›  │ │
│ │ Level 3 wk                               │ │
│ │ Overhead Press   ⚠ Held · pain        ›  │ │
│ │ Lat Pulldown          59 × 10         ›  │ │
│ │ Different machine                        │ │
│ └──────────────────────────────────────────┘ │
│ Muscles  Chest 12/12 · Back 13/14 · …     ›  │  collapsed (goal = strength)
│                                              │
│ HISTORY                                      │
│ Week of 13 Oct   4 of 4 · 58/62           ›  │
│ Week of 6 Oct    3 of 4 · 44/46           ›  │
│ Week of 29 Sep   ⏸ Paused                 ›  │
└──────────────────────────────────────────────┘
```

### 3.1 Plan card

- **Plan-day strip (this week):** one chip per session of the aim.
  - Done sessions come first, each labelled with its plan day and the weekday it was done (`Push ✓ Mon`). An off-plan session reads `Other ✓ Tue`.
  - Next comes the rotation's **next** plan day, labelled `next`. It has no weekday because rotation days have no dates (D19).
  - Any remaining chips are blank outlines.
  - No glyph ever marks a weekday as "not done".
  - With no plan, the chips are unlabelled (`✓ Mon`, `✓ Wed`, blank, blank).
- **Runs** sit on their own line under the strip and never fill a chip.
- **Plan facts:** `Planned sets 27/28 · Targets hit 9 of 10` for this week's plan sessions so far. With no plan session yet, the line is absent.
- **Per-session rows:** one row per plan session done this week, carrying `Hit`/`Short`/`Over` names. Short and Over appear only here. Tapping a row opens that workout's Summary.
- **8-week bars:** each bar has a 1 pt `chart.bandEdge` outline showing the aim and a `chart.bar` fill showing sessions done. The digit under each bar is the count. A fully paused week shows `⏸` and the digit `–`. Past weeks use the aim stored on that week's review record (§6), so changing the aim never re-judges old weeks. Runs get a digit row under the bars. There's no `Weeks at your aim` ratio.
- **`Why?`** opens the evidence sheet: the plan sessions behind the numbers (date, day, sets, verdicts) and any off-plan sessions (`1 off-plan · not in planned sets`).

### 3.2 Lifts card

- **Rows:** the chosen lifts, up to 6. By default these are the plan's main lifts (`mainLifts`). Lifts with a target come first.
- **Each row:**
  - Name, then the top set at usual reps (actual).
  - The change words, or `Different machine`, or nothing when there are too few sessions.
  - A small sparkline of the last 8 weeks' top sets at usual reps. If the lift has a target, the target is drawn as a dashed line.
  - If the lift has a target (setting on), the target line follows: `Target 110 × 6 · 7.5 kg to go · 8 weeks left`. A `one_rm` target reads `≈` before the gap. A hit target reads `Hit 2 Dec`.
- **Option (Q2), off by default:** `about mid-Dec at this rate` under a target line. It shows only if:
  - Ben switched it on in Profile › Training,
  - there are ≥ 4 weeks of top sets and they're rising,
  - the date is ≤ 6 months away.
  It's text only, with no line drawn on the chart.
- **Pain:** `⚠ Held · pain` (icon `exclamationmark.triangle`, `status.warning`, plus the words) replaces the change words while a flag is active. Older sets still show on the sparkline.
- Tapping a row opens that lift in Progress › Lifts. `Edit` opens the chosen-lifts picker (the existing exercise picker, multi-select, max 6).

### 3.3 Muscles card

```
┌ MUSCLES ─────────────── [Last week|So far] ┐
│ Chest        12 / 12      ████████████│    │  fill = done, │ = planned
│ Back         13 / 14      ███████████ │    │
│ Shoulders   9.5 / 10      ██████████  │    │  ½ credits shown
│ Quads         9 / 9       █████████│       │
│ Triceps     6.5 / 6       ██████│▌         │  over the mark, no word
│ Calves        3           ███              │  not in plan: no mark
│ ⚠ Shoulders incl. 2 held sets              │  only with a pain hold
└────────────────────────────────────────────┘
```

- The bars are `VolumeBandRow` with a 2 pt `chart.bandEdge` tick marking planned. There are no status words and no colour coding.
- Rows follow the plan's split order. Muscles not in the plan come last, with no tick.
- `So far` shows this week's sets done with no planned tick until the week ends.
- **Range band:** a general range (e.g. 10–20) is drawn behind a row only if Ben has approved a playbook rule that supplies it. The on/off switch lives in Settings › Progress, not on this card. `Why?` names the rule's source.

### 3.4 Latest review card

- It shows only:
  - the coach line (≤ 2 sentences), or `Not reviewed` with `Offline` / `Not connected` as the reason,
  - up to 2 open proposals,
  - `Open review ›`.
- Facts live in the full sheet (§3.5), so they never appear twice on screen.
- It sits on top only **while it's new or has open proposals**. After `Open review` → `Done` with nothing open, it folds into History.

### 3.5 Weekly review sheet

```
┌──────────────────────────────────────────────┐
│ Week of 13 Oct                      Done     │
│ 4 of 4 days, 58 of 62 planned sets.   Coach  │
│ FACTS                         this · last    │
│ Days                          4 of 4 · 3 of 4│
│ Planned sets                   58/62 · 44/46 │
│ Targets hit                  17 of 19 · 13/15│
│ Bench Press top set     102.5 × 6 · 100 × 6  │  order follows the goal
│ Squat top set           117.5 × 5 · 115 × 5  │
│ Chest · Back · …       12/12 · 13/14 · …   › │
│ Runs                              2 · 1      │
│ PROPOSALS                                    │
│ (as on the Latest card)                      │
└──────────────────────────────────────────────┘
```

- Every week stores the **same fixed fact set**, and the goal changes only the display order. `last` reads from the previous week's current review record. With no record for that week, the column shows `–`.
- `Felt` counts (`About right 2 · Hard 1`) appear only once how-did-it-feel data exists. Until then the row is absent rather than showing `0`.
- At AX sizes, `this` stacks above `last`.

### 3.6 Weekly proposals (what the review may touch)

Rule 3 already applies small next-session changes (load, reps, sets on the same exercise) on the Summary. To avoid two adjusters fighting over the same targets, the weekly review **only** proposes:

1. A template change the per-session loop can't make: set count or rep range on a plan day's exercise, with scope chips `Next Pull` / `Future Pulls` (rule 2).
2. A structural change (swap, add, remove, order), and only when Ben asked or something changed (goal, schedule, equipment, pain).

It never proposes a load change. Loads stay with the Summary. Further limits:

- At most 2 proposals.
- No proposal for an exercise the Summary has changed since the review's inputs were computed.
- No catch-up: sets not done are never added to a later week (Q5).
- Triggers need ≥ 2 sessions with RPE rated. Unrated sessions never trigger a proposal.
- Any amount is snapped to the gym's achievable loads, reps and stack steps, and the snapped value is shown.
- **The coach makes proposals.** With no AI there are none, and the facts stand alone (rule 1). The 2-of-3 Short at RPE ≥ 9 style thresholds go to the training-researcher. They become code fallbacks only once Ben approves them as playbook rules (ADR 0006).

---

## 4. States

| State | What shows |
|---|---|
| Empty (no sessions) | Plan card with a blank strip and `No sessions yet`. Lifts and Muscles hidden. No Latest card |
| Loading | Card frames with static `…` values, no shimmer and never `0` |
| Normal | §3 |
| No plan | Plan card: strip unlabelled, no planned-sets line, no per-session rows. Muscles: counts with no tick |
| No aim and no plan | Strip shows done chips only. Bars show counts with no outline |
| Few sessions for a lift | Top set only, no change words |
| Different machine | `Different machine` instead of change words |
| Pain-held lift | `⚠ Held · pain` row. Muscles shows `incl. n held sets` |
| Paused now | Plan card header `⏸ Paused until 1 Nov`. The strip shows done chips only |
| Paused past week | Bar `⏸`, digit `–`. History row `⏸ Paused` |
| Offline / AI unavailable | All cards and facts as normal (code). Latest card `Not reviewed · Offline`, no proposals, `Open review` still works |
| Couldn’t load | `Couldn’t load` + `Try again` in the affected card. Never an empty or zero state |
| Stale proposal | `Out of date. Ask again.` with a warning icon (rule 5) |
| Superseded review | A late-logged or corrected session changes the inputs. The review re-runs and supersedes the old one (`TrainingReview.status`). History shows the current one only |
| Option on, limits not met | No projection text; nothing explains why |
| AX sizes | Strip becomes a vertical list, `this · last` stacks, sparklines move under the text |

Transitions:
- A new weekly review appears on top as `NEW`.
- Opening it clears `NEW`. Handling every proposal (Apply, Skip) folds it into History.
- `Apply` writes, then the `Applied · Undo` toast appears. `Undo` restores the prior template version.

---

## 5. Interactions

- **Taps:**
  - A plan session row opens that workout's Summary.
  - A lift row opens Progress › Lifts for that lift.
  - A bar or a History row opens that week's review sheet.
  - `Why?` opens the evidence sheet.
  - A collapsed card expands in place.
  - `[Last week | So far]` switches the Muscles card.
  - There are no other surfaces.
- **Proposals:** `Apply` is primary and takes one tap. The scope chip defaults to the narrower scope (`Next Pull`). `Skip` dismisses for this review. Undo is available in the toast and in the review sheet. Nothing is applied without Apply.
- **Swipe:** none. There are no destructive swipes, and reviews are deleted only with Your data.
- **Voice:**
  - "How's my week?" and "How's my bench?" get the coach reading the same code facts aloud.
  - Any number not among the facts is dropped (`checkReviewNumbers`).
  - Offline, the app says `Offline` and nothing more.
- **VoiceOver:**
  - Plan card: "This week, 2 of 4 sessions. Push done Monday, Pull done Wednesday, Legs next."
  - Each bar: "Week of 6 October, 3 of 4."
  - Lift row: "Bench Press, 102.5 kilograms for 6, up 2.5 kilograms in 3 weeks. Target 110 for 6, 7.5 kilograms to go, 8 weeks left."
  - `Held · pain` is always spoken.
- **Keyboard:** none on this screen.

---

## 6. Copy

All values are **actual** unless marked target.
- **Cards:** `Plan` · `Lifts` · `Muscles` · `This week` · `next` · `Other` · `Runs` · `Planned sets 27/28` · `Targets hit 9 of 10` · `Hit 5 of 5` · `Short: Cable row` · `Over: Curl` · `Edit` · `Last week` · `So far`
- **Lifts:**
  - `102.5 × 6` (actual)
  - `Up 2.5 kg in 3 wk` · `Level 3 wk` · `Down 2.5 kg in 3 wk`
  - `Different machine`
  - `Target 110 × 6` (target)
  - `7.5 kg to go` (`≈` only for `one_rm`)
  - `8 weeks left` · `Hit 2 Dec`
  - `Held · pain`
- **Option only:** `about mid-Dec at this rate`
- **Muscles:** `12 / 12` (done / planned) · `incl. 2 held sets`
- **Review:**
  - `Week of 13 Oct` · `NEW` · `Open review` · `Done` · `this` · `last`
  - `Days` · `Planned sets` · `Targets hit` · `top set` · `Runs` · `Felt`
  - `Not reviewed` · `Offline` · `Not connected`
  - `Apply` · `Skip` · `Why?` · `Next Pull` · `Future Pulls` · `Applied · Undo` · `Out of date. Ask again.`
- **Evidence sheet:** `1 off-plan · not in planned sets` · `No RPE on 6 sets` (only where it changes a number on screen)
- **States:** `No sessions yet` · `Paused until 1 Nov` · `Couldn’t load` · `Try again`
- **Never used:** `streak`, `missed`, `broken`, `failed`, `behind`, `ahead`, `on track`, `%` progress, `score`, `readiness`, `rule`, `snapped`, and `at this rate` unless the Option is on.
- **Spoken cues:** none new.

---

## 7. Data needed (developer)

**Existing:**
- `consistency`, `aimWithPause`, `pausedInWeek`, `planDaysDoneThisWeek`, `planDaysDoneBy`, `dayOf`
- `plannedVsDone`, `PLAN_VERDICT_WORD`, `exerciseTargetHistory`
- `muscleGroupCredits`
- `repTableByReps`, `SeriesKey`
- `liftTargetsInUse`, `liftTargetStatus`, `liftTargetLine`
- `reviewSubjectKey`, `TrainingReviewSchema`

**New domain functions** (pure, `packages/domain/src/progress/goal/`; thresholds are named constants):
- `planWeekView(input)`: strip chips, aim, runs, plan facts, per-session rows, 8 bars with per-week aims
- `muscleSetsVsPlanned(sessions, catalogue)`: done and planned working sets per group (½ credits), plus held counts
- `liftTopAtReps(series, sessions)`, `usualReps(series)`, `liftChange(series)`: rep-matched and same-equipment
- `projectAtThisRate(series, target, today)`: Option only. Returns null unless every limit is met
- `weeklyFacts(week)`: returns the fixed fact set
- `checkReviewNumbers(text, facts)`: every number in a coach sentence must match a fact value (unit-aware). A sentence that fails is hidden, and `numbersChecked` is set from the result. Tests cover this
- `heldAt(set, painFlags)`: time-scoped hold

**View builders:**
- `buildReviewsView(profile, plan, …)`: card order (§2.1), collapsed flags, `accessibilityLabel`s
- `buildWeeklyReviewView(review, prevReview)`
- `buildEvidenceView(kind, week)`

**Schema changes (Wave 3; the earlier "no schema change" was wrong):**
- `ReviewFactSchema` new kinds:
  - `planned_sets {done, planned, offPlanSessions}`
  - `targets_hit {hit, of}`
  - `runs {count}`
  - `lift_top {exerciseId, equipmentId, load, reps, usualReps}`
  - `feel_counts {…}`, added with how-did-it-feel
- `sessions_vs_plan` gains `aim` so past weeks keep their aim.
- `group_sets.sets` and `planned` become `z.number().multipleOf(0.5)`.
- There's no `prev` field: `last` is read from the previous week's current review.
- `TrainingProfile.progressLifts?: string[]` (max 6), via `TrainingChange { kind: 'progress_lifts'; exerciseIds }`, versioned with an opId (rule 5). Absent means the plan's main lifts.
- `TrainingProfile.projectionOption?: boolean` (only if Q2 = opt-in), via `{ kind: 'projection_option'; on }`.
- Supersede stays the correction model. There's no `Corrected since` tag.

**Coach context:** weekly facts (Your data), labelled apart from playbook rules and catalogue (Coaching knowledge, rule 10). Tools are the existing proposal tools, limited to the §3.6 scope.

---

## 8. Acceptance checks

1. Airplane mode, no AI: all three cards show correct numbers. The Latest card reads `Not reviewed · Offline` and shows no proposal, and no coach sentence appears anywhere.
2. Goal `strength`: order Plan → Lifts → Muscles (collapsed). Switching the Profile goal to `muscle` gives Plan → Muscles → Lifts (collapsed), with no other write.
3. 4-day rotation and aim 3: the header reads `n of 3`, not `n of 4` (W3 test). With no aim it reads `n of 4`.
4. Aim 4, Push and Pull done: the strip shows `Push ✓ Mon`, `Pull ✓ Wed`, `Legs next` and one blank chip. No weekday shows a not-done glyph, and "missed" appears nowhere.
5. Same week: `Planned sets` counts only the Push and Pull snapshots (e.g. `27/28`). Editing the Legs template changes no past or current number.
6. An exercise done with 5 sets against 3 planned: `doneSets` contributes 3, and nothing says ahead.
7. An off-plan workout that met Legs: the session count includes it, planned sets don't, and `Why?` shows `1 off-plan · not in planned sets`.
8. Muscles: an unrated set and an RPE-5 set both count as working sets on the done side. Shoulders with helper credit shows `9.5 / 10`.
9. Bench sessions 100 × 6, 100 × 6, 102.5 × 6 over 3 weeks read `Up 2.5 kg in 3 wk`. Adding 105 × 2 (usual reps 6) leaves it unchanged.
10. Lat pulldown 50 kg stack at gym A, then 59 kg at gym B: the row shows `Different machine` with no change word.
11. Lift target `weight_reps` 110 × 6, best 102.5 × 6: `7.5 kg to go` with no `≈`. A `one_rm` target shows `≈`.
12. With the Option off (the default), no projection text appears anywhere. With it on, the text appears only with ≥ 4 rising weeks and a date ≤ 6 months away.
13. Pain flag on OHP reported 15 Oct, cleared 20 Oct: sets 15–19 Oct are held and later sets aren't. Clearing the flag doesn't change the earlier weeks' facts.
14. Changing the aim from 3 to 4: past bars keep their stored aims.
15. Every review fact shows `this · last`, and `last` matches the previous week's stored record. A coach sentence citing a number not among the facts is hidden.
16. Never more than 2 proposals, and none changes a load. After the Summary changes Cable row, a review proposal for Cable row isn't shown. Apply → `Applied · Undo` → Undo restores the prior template version. A template edited after the review shows `Out of date. Ask again.`
17. A late-logged set for last week supersedes that week's review, and History shows only the current one.
18. Runs (`done` only) appear on their own line and never change the session count. A ride doesn't appear in `Runs`.
19. Colour filters on: every state is readable as text or icon. Targets are ≥ 44 pt, body text ≥ 16 pt and numbers tabular. At AX5 the strip is a list and `this · last` stacks.

---

## 9. Borrowed and avoided

| Pattern | From | How we use it |
|---|---|---|
| Plan tab leads with this week and the next session | Runna | Plan-day strip with `next` |
| Plan is the yardstick, separate from the outcome | Runna | Plan sets and targets hit only; lifts against his own past |
| Planned vs done volume | Runna Mileage Insights, TrainingPeaks | Muscles done / planned tick |
| "Why" lists the sessions behind a number | Runna Pace Insights, MacroFactor | `Why?` evidence sheet |
| Compare with last period | WHOOP, Strava | `this · last` column |
| Pause keeps history intact | Apple, Garmin, Runna | `⏸` weeks never compared |
| No catch-up, adherence-neutral | MacroFactor | §3.6 |
| Scoped goals per exercise | StrengthLog | Chosen lifts and lift targets |

Avoided:
- Composite scores (Runna Score, Fitbod Strength Score, Garmin Training Status)
- Status words for numbers that already speak for themselves (Pace Insights needs words because pace is noisy; set counts don't)
- Streaks and banners
- `%` complete
- Tonnage headlines
- Colour-only ranges
- Irreversible re-plans
- Generic AI summaries

Sources are as cited in [competitor-analytics.md](../research/competitor-analytics.md) and [plans-and-plan-progress.md](../research/plans-and-plan-progress.md). We borrow interaction patterns only.

---

## 10. Changes after critique

**Cut (simpler):**
- The Focus concept: the Focus sheet, `progressFocus`, `deriveFocus`, focus proposals, the voice command, the toast and the review header. Order now comes from the goal.
- The status vocabulary (`On plan`/`Ahead`/`Behind`/`Mixed`/`Too few sessions`), `lensStatus` and the 25/40/90 % thresholds.
- The Bodyweight lens and both Today lines.
- Full lens views and the Focus and week sheets.
- `Weeks at your aim` and the RPE-vs-target line.
- The Follow-the-plan lens, merged with Consistency into one Plan card.
- Facts duplicated on the Latest card.
- Offline `Rule` proposals.
- The in-card range toggle (moved to Settings).
- Most gap lines (kept only in `Why?` when they change a number).
- `Corrected since` (supersede instead).
- Open questions: 14 → 8.

**Fixed (honesty / feasibility):**
- Schema additions listed (§7).
- Planned sets now come from snapshots on sessions done, so a skipped day is counted only once.
- Done and planned are counted the same way (working sets).
- No "ahead" from the capped `doneSets`.
- Top sets are rep-matched and compared only on the same equipment for stacks and plate-loaded machines.
- e1RM is kept out of change words.
- Deload and Light deferred to blocks.
- Pain holds are per exercise and time-scoped.
- The aim is decided (days-a-week aim, then plan length) and stored per week.
- `Runs` defined.
- One `Targets hit` definition.
- No `≈` on weight × reps targets.
- Proposals are coach-only, snapped, need ≥ 2 rated sessions, never touch loads, and are suppressed after a Summary change.
- `checkReviewNumbers` specified.
- The projection is offered as an opt-in Option instead of only being deleted.
- `progressLifts` named.
- `Felt` hidden until data exists.
- The strip no longer marks undone weekdays.

**Kept:** consistency first, chosen lifts up to 6, lift targets, no scores, `Not reviewed` with no AI, reviews as Your data.

---

## 11. Changes for the Wave 3 build

| # | Change | Effort |
|---|---|---|
| W1 | Plan card: plan-day strip (done + `next` + blanks), runs line, planned sets and targets hit from plan-session snapshots, per-session rows, 8 bars with stored per-week aims, `Why?` | M |
| W2 | Card order and collapse from the profile goal (§2.1). No focus field | S |
| W3 | `consistency().planThisWeek` measured against the aim (fallback: plan length) + rotation test; the same change applies to Library › Your plan `Days this week` | S |
| W4 | Schema: new fact kinds, `aim` on `sessions_vs_plan`, ½ steps on `group_sets`, `progressLifts` | S–M |
| W5 | Lifts: `usualReps`, `liftTopAtReps`, `liftChange` (exact, same equipment), target line without `≈` for weight × reps | M |
| W6 | Muscles: `muscleSetsVsPlanned` (working sets on both sides, ½ credits), planned tick, no status | S |
| W7 | 8-week window; no "missed" anywhere; no undone-weekday glyphs | S |
| W8 | Slim Latest card, on top only while new or open; review sheet with fixed facts and `this · last` | S |
| W9 | `checkReviewNumbers` + tests | S |
| W10 | Weekly proposal scope (§3.6): templates and structure only, suppression after Summary changes, coach-only | S |
| W11 | `heldAt` time-scoped pain holds, per exercise | S |
| Later | Projection Option (if Q2 = opt-in); range band (after an approved rule); Felt counts (with how-did-it-feel); Deload/Light (blocks TB3+) | — |

Dropped from the old Wave 3 list: `lensStatus`, `deriveFocus`, data-gap lines, and the Follow-the-plan lens as a separate card.

---

## 12. Open questions for Ben

1. **Order from your training goal only, with no separate focus setting?** *Recommended: yes.*
2. **Predictions:** never, or an opt-in Option (off by default, Profile toggle, lift-target rows only, ≥ 4 rising weeks, ≤ 6 months, text `about mid-Dec at this rate`)? *Recommended: never, which matches your 21 Oct "no predictions". Opt-in is ready if you want it.* Either way, training-blocks §3.2/§3.4/Q8 and the `lift-targets.ts` comment get updated, with a CHANGELOG entry.
3. **Weekly count against your days-a-week aim** (plan length only if no aim is set)? *Recommended: yes.* With a 4-day rotation and a 3-day aim, the card reads `of 3`.
4. **Plan-day strip without dates and 8 weeks of bars,** dropping "missed planned days named" and "6 weeks" from v3 §6.2? *Recommended: yes* (D19).
5. **Weekly proposals change templates or structure only; loads stay with the Summary;** no catch-up sets. This also needs a one-line clarification of rule 3 in CLAUDE.md/brief. *Recommended: yes.*
6. **"Progress towards weight"** meant a lift weight, not bodyweight? *Recommended: lift weight. Bodyweight stays a points chart in Progress › Training, with no target.*
7. **Latest review on top only while it's new or has open proposals?** *Recommended: yes.*
8. **Muscles counts working sets on both sides** (hard sets stay in Training)? *Recommended: yes*, so rating easy sets honestly never makes the numbers look worse.

---

## 13. Design-system additions (on approval only)

There are no new colours and no new status words. New components:
- `PlanDayStrip` (chip: done / next / blank; becomes a list at AX)
- `FactRow` (label · this · last; stacks at AX1+)
- `EvidenceSheet`

Variants:
- `WeekBars` gains a planned-outline variant
- `VolumeBandRow` gains a planned tick (2 pt `chart.bandEdge`)
- `LiftRow` (name, actual, change words, sparkline, optional target line)

design-system.md is unchanged until Ben approves.
