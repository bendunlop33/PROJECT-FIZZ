# IA simplify: workout structure, chips, Health on Today, calendars (27 Oct 2026)

Designer agent, from Ben's notes on the clickable prototype (27 Oct). This builds on `ux-review-27oct.md`; its P-numbers are
used below. The lens is still **gym first**. Code was read on `claude/gracious-knuth-joxqpw`. Proposed screens are in
the prototype `app-prototype-v2.html` (scratchpad `atlas/`). Nothing here is approved until Ben says so.

**Evidence labels:** **[Code]** read in this repo. **[Doc]** a vendor page, or `docs/research/competitor-first-pages.md`
(which cites vendor pages). **[Guess]** a pattern I couldn't confirm. On 27 Oct, Hevy's routine pages
(`/features/gym-routines/`, `/features/gym-workout-routines/`) and Strong's help article 229 didn't describe the row layout
in text, and the App Store page has no captions, so the row details below come from our earlier research.

---

## 1. One workout-structure component: `WorkoutList`

**Finding: the same planned workout is drawn five different ways [Code].**

| Where | Shape today |
|---|---|
| Today card (`TodaySession.tsx:462` `BreakdownTable`) | `#` · name + muscles · Sets with `+3 W` under it · `Top set (kg)`. Superset rows sit on a raised fill |
| Plan day, this week (`PlanDayScreen.tsx:154`) | Two text lines: `Bench press   4 × 6–8 · 82.5 kg`, then `Last 22 Oct: 80 × 8, 8, 7, 7` |
| Plan day, another week (`:131`) | A third shape: name · line · kg, wrapping |
| Your workout (`builder/WorkoutTable.tsx`) | One boxed card per exercise, `#`, `MAIN` tag, Sets, top set |
| Plan builder day card (`pb_plan`) | Name · sets × reps · kg, with no header |

Ben's "why does it look like this" is fair. The Plan day packs four numbers into one string and then adds a line of history
under every exercise, so a 5-exercise day takes 10 lines of numbers.

**How others do it.**
- **Hevy:** the card shows names only, plus `Start Routine`; the routine detail lists each exercise's sets as `kg × reps`;
  last time lives in the workout's `PREVIOUS` column [Doc]. **Strong:** `3 × Bench Press (Barbell)` plus the body part, and
  **no loads or last time** [Doc]. **Fitbod:** `4 Sets • 12 Reps • 25 Lb` [Doc]. **Boostcamp:** `Sets | Top Set` columns [Doc].
- Neither Hevy nor Strong shows last time in the preview; both show it once the workout starts.

**Proposal: one `WorkoutList`, three columns, everywhere a *planned* workout appears.**
```
EXERCISE                  SETS     TARGET KG
Bench press               4 × 6–8      82.5
Chest · triceps
Dumbbell shoulder press   3 × 8–10   24 each
┃ Cable lateral raise     3 × 12–15     7.5      ← superset: 2pt rule on the left, no fill
┃ Triceps pushdown        3 × 10–12      30
```
- **Columns:** name (`type.body`, main lift Semibold); sets × reps (tabular, right, 72pt); target load (tabular, right, 80pt;
  `each` for per-dumbbell loads, so the load convention stays visible).
- **Header:** `Target kg`, which makes it explicit that every value is a target.
- **Densities:**
  - `full` adds the muscles as a second line (`type.callout`, `text.tertiary`). Used on Plan day, Your workout and saved workouts.
  - `compact` is names only. Used on the Today card and the plan builder's day cards.
- **Cut:** the `#` column, `+3 W` (warm-ups appear in the workout), the per-row `Last …` line, the `MAIN` tag (Semibold does
  that job) and the raised fill on supersets.
- **Kept:** `est.` after an estimated load (rule 6); `⚠` before a held exercise (pain, rule 9).
- **Last time:**
  - it appears in the workout's PREVIOUS column, at the moment it's needed (built already)
  - before Start, **tap a row** to open a small sheet: `Target 4 × 6–8 · 82.5 kg`, `Last 22 Oct: 80 × 8, 8, 7, 7`, `Best 82.5 × 6`, then `How to ›` and `History ›`
  - On Your workout, the row tap stays "edit the exercise", and last time sits in that edit sheet's header.
- **VoiceOver, one element per row:** "Bench press, main lift, 4 sets of 6 to 8, target 82.5 kilograms". The header is hidden.
- **Dynamic Type:** at AX1+, each row stacks (name, then `4 × 6–8 · 82.5 kg`). Nothing truncates; long names wrap.
- **Data:** one row view model, `PlannedRowView { key, name, muscles, sets, reps, target, convention, est, main, held, superset }`,
  built in the domain from `TodayBreakdownRow` and `services.plans.planDay` rows. The UI computes nothing.
- **Effort: M.** One component, five call sites, one view model; Plan day's two branches merge into one.
- **Risk:** last time is no longer visible at a glance before Start. Ben looked at it on Plan day. If he misses it, add an
  optional `Last` column to `full` only (behind a Profile switch), never a second line.

---

## 2. Selected chips: fill, no tick

**Finding [Code]:** `ui/workout.tsx:667` draws a ✓ on every selected `Chip`, accent fill or subtle fill; the check-in tiles
do the same (`ui/overview.tsx:185`). Design system §9.17 asks for the ✓ because its selected state was a *subtle* fill, too
weak on its own. On the near-white accent fill, the ✓ adds nothing. Ben is right.

**Proposal:**
- **One selected style for chips app-wide:** accent fill, `on.accent` label in Semibold, **no ✓**. Fill against outline is a
  large luminance and shape change, not "colour alone".
- **Retire the subtle variant.** Where an accent fill would compete with a primary button in the same sheet (effort / Feel
  chips, check-in tiles; §9.17 and line 1057 forbid the accent fill there), use the subtle fill **plus a 2pt accent border**
  and a Semibold label, still with no tick.
- **Keep ✓ only where it means status or a list choice, not a filled chip:** set rows (logged), Plan week chips for done
  weeks, Consistency weeks at aim, and iOS list multi-select (`checkmark.circle.fill`).
- **VoiceOver:** `accessibilityState.selected` on every chip, so it reads "Push / Pull / Legs, selected".
- **Increase Contrast:** a 2pt `text.primary` edge on the selected fill.
- **Recommended marks stay.** The ✦ on recommended options isn't a selection mark.
- **Effort: S.** One component, one tile and a design-system edit (§9.17 and its compact-size note).
- **Risk:** low. In light mode the accent fill is dark, so it still reads as selected.

---

## 3. Apple Health: a Today row Ben controls, and a `Body` home in Progress

P9 advised keeping Health off Today. Ben has asked for it, so it's his call. What follows makes it cost lifting nothing.

**Today row (below the session card and its Start, never above):**
```
┌──────────────────────────────────────────────┐
│ ♥  Sleep 7h 05m · RHR 58 · 78.4 kg         › │  44–52pt, type.callout, text.secondary, tabular
└──────────────────────────────────────────────┘
```
- **Text:** from `todayHealthLine()` (`packages/domain/src/health-uses.ts:81`), which exists but is unused: last night's
  sleep and this morning's resting heart rate. The arrow vs the 28-day median shows only at **3 bpm or more**, so Ben's
  example `↑2` would not show. Bodyweight is the latest entry, with a day when it isn't today (`78.4 kg · Sat`).
- **Visual weight:** no colour, no verdict, no score (rule 6). The ♥ icon says where the data comes from.
- **Taps:** tap → Progress › Body. Long-press (or VoiceOver's custom action "Customise") → the **Show on Today** sheet.
- **Show on Today sheet:** switches for `Sleep` (on), `Resting heart rate` (on) and `Bodyweight` (off by default), each
  listed only when its Health read switch is on. The same switches sit in Profile › Apple Health under `Show on Today`, and
  Body has a `Show on Today ›` link. `Last activity` isn't offered: runs already show on the strip.
- **States:**
  - **Hidden:** when Health is off or unavailable, when none of the chosen items has a value for today (no placeholder, no
    "No data"), or while a workout is in progress (Today is the Resume hero)
  - **Partial:** only the parts that exist
  - **Offline:** the same, because the data is local
- **Data:** `services.health.lastNight()` → `todayHealthLine`; the latest bodyweight from the bodyweight service; a new
  device pref `todayHealthItems: ('sleep'|'rhr'|'weight')[]`.
- **Copy:** `Sleep`, `RHR`, `kg`. The sheet title is `Show on Today`. There's no explainer, just `Why?` → `vs your 28-day median` behind
  the arrow's VoiceOver label.

**Progress home for Health → `Body` segment** (out of Training, where bodyweight, sleep and RHR sit at the bottom today,
`ProgressScreen.tsx:302–304`):
- **One period control:** `1M · 3M · 1Y · All`. Health fetches 30 days, so the longer ranges need a wider read.
- **Bodyweight:** latest, change over the period, chart, `＋ Weight`.
- **Sleep:** latest night, sparkline, source.
- **Resting heart rate:** latest, sparkline, source.
- **Then** `Show on Today ›`.
- **Removed:** the `Sleep avg · RHR 56 → 58` line on Overview's week card (`charts.tsx:362`).

**Effort: S** (Today row and sheet) **+ M** (Body segment, wider read window). **Risk:** the coach must not comment on
the row unprompted. It uses these values only as context (rule 3: no unprompted adjustments).

---

## 4. Calendars and date views: audit and one model

**Audit [Code] (11 views):**

| # | View | Answers | Shows | Overlap | Verdict |
|---|---|---|---|---|---|
| A | Today 7-day strip + day sheet | What's this week, what's today | 3 past days, today, 3 next; done / planned / activity pills | B, D, E | **Keep.** The one "this week" view |
| B | Today › Recent (14 days) | What did I do lately | List rows, then `All history ›` | A (past 3 days), F | **Cut.** Replace it with an always-visible `History ›` row (P6) |
| C | Progress › Overview › Week | This week vs plan | Chips per plan day, activity line, Health line | A, I | **Cut** with Overview |
| D | Progress › Overview › Month | Last 5 weeks | Week rows M–S with C/L letters, missed/planned list, link to the weekly review | E, G | **Cut.** Consistency covers adherence; History covers dates |
| E | Progress › Training › Calendar | What did I do on a date | Month grid, dots, the selected day's list | F (same data, other shape) | **Move** into History as its header |
| F | History (by week) | What did I do on a date / list | Week groups with totals, `Log a past workout`, Recently deleted | E | **Keep:** the one place for "a date" |
| G | Training › Consistency (8 weeks) | How consistent am I | Sessions a week vs aim, ✓ at aim | D, C | **Keep:** the one place for "consistent" |
| H | Training › Totals `PeriodPicker` | How much in a period | Sessions, time, chart, muscles, records | Recap | **Keep.** The one control on Training |
| I | Monthly recap card + sheet (1st–7th) | How was last month | Workouts, time, sets vs the month before, records | H set to last month | **Cut.** H at `Last month` gives the same numbers |
| J | Library › Plan week chips | What's in week N of the block | Block weeks 1–6, done ✓, deload | None (plan weeks, not dates) | **Keep** |
| K | Lifts / Exercise detail period dropdowns, Bodyweight `1M…All`, Health 30-day sparklines | How's X trending | Per-screen range | Each other | **Keep one per segment** (Lifts; Body). Exercise detail = Lifts (26 Oct #4) |

**Answer to Ben's question:**
- Training › Calendar is a month of *what was logged*: a dot per day, tap a day for its workouts.
- Overview › Month is the last 5 weeks *against the plan*: letters per day, missed days listed, and a link to that week's coach review.
- They overlap with each other, with History and with the strip. That's three date views too many.

**One question, one place:**

| Question | Place |
|---|---|
| What's this week / today? | Today strip (A) and its day sheet |
| What did I do on a date? | **History**, with a month grid header (E moved here). Tap a day to jump the list to it |
| What's in my plan's week N? | Library › Plan week chips (J) |
| How consistent am I? | Progress › Training › Consistency (G) |
| How much did I do in a period? | Progress › Training, one period control (H) |
| How's a lift trending? | Progress › Lifts (one exercise screen everywhere) |
| How's my body trending? | Progress › Body (one period control) |

**Progress before → after.**
- **Before:** `Overview | Lifts | Training`, then `Totals | Calendar` under Training, then `Body parts | PPL` under Totals (three
  stacked segmented controls), with four separate period controls.
- **After:** **`Lifts | Training | Body`** (default `Lifts`, gym first).
  - **Lifts:** lift chips (filled, no ✓) → chart → one period dropdown → stats → sessions → records.
  - **Training:** Consistency → one period dropdown → totals → Muscles (`Body parts | PPL` as a small toggle in its header)
    → Records → `All history ›`.
  - **Body:** as in §3.
- **Where Overview's parts go:**
  - its lifts chart → Lifts (a `Main lifts` chip shows all three lines)
  - Muscles → Training
  - Coach's changes → the Summary's `Next time` block and Plan (P5; the weekly review stays reachable from Plan › `⋯`)
- **History:** the `‹ October 2026 ›` grid (●/○ shapes, legend) sits on top of the week list. `Log a past workout` stays.

**Effort: L overall.** S: cut Recent and the recap. M: move the Calendar into History. L: the Progress restructure and
the Overview removal, including relocating `ReviewsSection`.

**Risks:**
- Overview's weekly-review entry loses its home, so the coach's weekly changes must still surface somewhere. That's on the
  Summary and Plan, so confirm with Ben.
- Ben may use Overview › Month to see missed plan days. Consistency shows a count, not which day.
- Deep links (`focus: 'reviews'`, Today's `Reviews ›`) must be re-pointed.

---

## Decisions for Ben

1. Use one `WorkoutList` (Exercise · Sets · Target kg) everywhere, with last time behind a row tap and in PREVIOUS? **(M)**
2. Selected chips: fill only, no ✓, app-wide? **(S)**
3. Show a Health row on Today *below* Start, with Sleep + RHR by default, customisable, and hidden when empty? **(S)**
4. Progress becomes `Lifts | Training | Body`, defaulting to Lifts, with Overview removed? **(L)**
5. Make History the only date view (month grid on top), and cut Training › Calendar, Overview › Month, Today › Recent and the monthly recap? **(M)**

Once approved: update `design-system.md` §9.17 (chip selected state) and add `WorkoutList` and `HealthTodayRow`, then log the
changes in `docs/brief/CHANGELOG.md`.
