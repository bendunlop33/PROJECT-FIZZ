# UX review: GymSmarter as built, 27 Oct 2026

Designer agent, for Ben ("don't be agreeable with me"; "it should be gym first still"). I reviewed the code on
`claude/gracious-knuth-joxqpw` (screens, `ui/`, view models) against `docs/design/*`, the CLAUDE.md minimal-copy rule
and iOS HIG. The Library › Plan concept comes from `/home/user/wt-plantab/docs/design/plan-tab-v2.md` (branch
`claude/plantab-27oct`). I read that spec but not its code. Builds on `docs/reviews/app-design-review-2026-10-22.md` and
`docs/reviews/app-review-26oct.md`. Items those two already raised and that are still open (Progress speed, two
exercise-progress screens, units in the plan builder) are mentioned once and not argued again.

**The lens: gym first.** The app's job on a weekday is Today → Start → log sets → rest → Finish. Anything that pushes
that loop down the screen, adds a decision before Start, or puts Health, coach talk or settings at the same weight
as lifting counts as a defect here, even when it is useful.

**Not verified from code** (marked ⚠ below): on-device pixel positions (I estimated them from the layout code at
375×667 and 390×844), real Health data, the Finish sheet's exact tap count, and anything only on the plantab branch's code.

## Core loop tap count (as built)

| Step | Taps | Notes |
|---|---|---|
| Today → workout running | 1 (`Start`) | Check-in off by default. The first ever Start also shows the alerts ask. ⚠ Start may be below the fold (P1) |
| Log a set that matches the target | 1 (row `✓`, or `Log` in the action bar) | Good |
| Log a set with a changed load | 2–3 | Tap the cell, type, then the row `✓` (or `Done` then `✓`). The big `Log` pill is hidden while the keypad is up (P2) |
| Rest | 0 | Automatic. The bar has −/+ and Skip |
| Finish | ~3 ⚠ | `Finish workout` replaces Log after the last set → Finish sheet → Summary `Done` |

A 15-set session with no edits takes about 19 taps, which is competitive. Edited sets and finding Start are where the time goes.

## Top 10 problems, ranked by impact on Ben's daily use

### P1. On Today, Start can sit below the fold, under coach and option content (M)
- **Screen:** Today. `TodayScreen.tsx:935–1047`, `today/TodaySession.tsx:604–668`.
- **What's wrong:** above Start, in this order:
  - header (date, week, coach ask bar)
  - week strip
  - banners
  - check-in line
  - pain line
  - `SESSION` + gym chip row
  - day control
  - card title and summary
  - Time row
  - every exercise row (`BreakdownTable`)
  - `Why?`
  - the coach's pre-session offer (line, change lines, Apply / Skip / Reviews)
  - then **Start**

  With 6–7 exercises and an offer, I estimate Start lands around 650–750 pt from the top: off-screen on a 375×667 phone and borderline on a 390×844 one ⚠. The coach offer sits between the workout and Start, so coach talk literally stands between Ben and lifting.
- **Evidence:** HIG puts a screen's primary action where it is always reachable. The design system says "primary action always visible". The card puts Start last (`TodaySession.tsx:661`).
- **Fix:**
  - Pin a Start bar to the bottom of Today, above the tab bar, whenever a card is shown: `Start Push A` (primary, full width) plus `Edit`. It is the same button, moved, and it scrolls nowhere.
  - In the card, show the main lift row plus `+ 5 exercises ›` (tap expands). Keep the full list one tap away.
  - Move the offer under the bar as a one-line chip (`✦ 1 change for today ›` → sheet with Apply / Skip). No `Reviews` link on Today.
  - Merge the check-in and pain lines into one status line under the header, shown only when present.

### P2. In the table, the big Log pill disappears whenever the keypad is up (S)
- **Screen:** Active workout, table view. `workout/rounds.ts:522–527` (`bottomChrome`: `actionBar: false` when `keypadUp`); `WorkoutScreen.tsx:3178–3201`; `ui/workout.tsx:143–157` (the keypad bar has −, +, RIR, Next ›, Done, but no Log).
- **What's wrong:**
  - The most common edit (bump the kg, then log) loses the full-width named `Log 102.5 kg × 6` pill exactly when it's needed.
  - What's left is the row's `✓`: a 44 pt target at the far right edge, which the page keeps clear of the pad (spec v3 §0). Logging still works in 2 taps if Ben hits it; otherwise it's `Done` then `✓`.
  - This breaks the standing rule "primary action always visible above the keyboard", and the bigger sweaty-finger target is the one that goes.
- **Fix:** while a cell of the current set is being typed in, the keypad bar's trailing key is `Log ✓`, not `Done`. It logs the draft and closes the pad in one tap. `Done` moves to a smaller secondary key, or a tap outside closes the pad (it already does). On a non-current or done row, keep `Done`. VoiceOver label: `Log set 2, 102.5 kg, 6 reps`.

### P3. Two workout UIs, and the empty workout uses the other one (M–L)
- **Screen:** Active workout. `WorkoutScreen.tsx:167` (`workoutView` pref); `:1324` (`⋯ › Focus view`); `:2650` (`tableMode` is false when `phase === 'empty'`); `:3064–3155` (the whole Focus layout: `SetPager`, `ViewedSetCard`, its own all-done screen and buttons).
- **What's wrong:**
  - There are two complete logging UIs with different layouts, different rest presentation (`RestPanel` inline vs `RestBar` plus a full-screen modal) and different "all done" screens.
  - An empty workout always opens in the Focus layout (`Add your first exercise` hero), then switches to the table once there is an exercise. The same session changes shape under Ben's thumb.
  - Every fix lands twice or drifts, as happened with RIR: the Focus done row still parses `RPE 8` text (`WorkoutScreen.tsx:3565`).
- **Fix:** retire Focus view. The table is what Ben uses and what has been tuned (PREVIOUS, RIR, one scroll). The empty workout opens the table with one empty round: an `＋ Add exercise` row, and the Add sheet auto-opens as now. Remove the pref and the `⋯` item. This is the biggest code deletion on this list and pays back on every later change.

### P4. Library › Plan: v2 fixes the duplicate days, but hides Edit plan, and the plan still lives in the wrong tab (M)
- **Screen:** Library › Plan. As built: `YourPlanBlock.tsx:178–355`, `PlanWeeksBlock.tsx:88–104`. Concept: `wt-plantab/docs/design/plan-tab-v2.md`.
- **What's wrong (as built):**
  - The same days are listed twice with different taps. The week block's `DayCard` expands inline with Move day / Do today. `DayRow` pushes the Plan day screen.
  - `Edit plan` is a big button between the two lists.
  - The goal's `Edit` jumps tabs to Profile › Training details (`YourPlanBlock.tsx:140`).
  - Two stat tiles, Lift targets, and three text actions sit at the bottom.

  Ben's "don't understand this page" is fair.
- **On the v2 concept:**
  - **Right:**
    - one list
    - the `Week 3 of 6 · deload in week 6` line
    - current vs selected week as two separate marks
    - stats folded into the list header
  - **Wrong:** everything else goes into one `⋯`: Edit plan, Pause, Resume, Ask coach, Edit goal and End plan. Editing the plan is a key feature Ben asked to find easily, and `⋯` is the least discoverable control in iOS. v2's own open question 2 asks exactly this. Answer: yes, keep it visible.
  - **Also wrong:** row `⋯` plus long-press for Do today / Move day hides the two actions that matter in a given week.
- **Fix (amend v2):**
  - Header card: name, week line, goal, week chips, then a visible `Edit plan` text button on the card (Start next block when done). `⋯` keeps Pause / Resume, Ask coach, Edit goal and End plan.
  - On this week's not-done rows, a swipe action `Do today` (leading) and `Move` (trailing), plus the row `⋯` for VoiceOver and discovery.
  - Edit goal opens the goal sheet in place, not Profile.
  - **IA:** Library remembers its last segment (`LibraryScreen.tsx:55–61`, `librarySegment`), so the plan Ben runs every week can be two taps away behind `Exercises`. When a plan is running, open Library on Plan, or rename the tab `Plan` and keep Workouts and Exercises as its other segments. Ben decides; the default-to-Plan change is S.

### P5. Summary: three "next time" mechanisms, Undo at the bottom, Health above the workout (M)
- **Screen:** Summary. `SummaryScreen.tsx:402–414` (`LinkedActivityRow` before `FeelRow` and everything else); `:605–643` (`MainLiftRow`, `KeepRow`, each with Apply / Skip / Undo); `:645–680` (`Next time` rows plus `Undo all`, after the full exercise list); `:704–719` (`Edit times` as a primary-size button beside Done).
- **What's wrong:**
  - "What happens next session" shows as three differently shaped blocks: keep main lift, keep for next time, and the coach's next-time changes. The one with the auto-applied changes and Undo (rule 3's safety valve) is last, after 6–8 exercise rows. This was raised as 26 Oct spec issue 5 and is unchanged.
  - The watch's row (`Garmin · 61 min`) is the first thing under the title, ahead of the lifting results. That is not gym first.
  - `Edit times` is a rare correction but takes a third of the bottom bar.
- **Fix:**
  - Order: hero → stat strip and New bests → **one `Next time` block** with every change (main lift, keep, coach and rule changes) as rows: applied ones show `Undo`, offered ones `Apply / Skip`, with a `Coach` / `Rule` tag → Exercises → Feel → Linked activity (one quiet row) → `Ask about this workout`.
  - `Edit times` moves into the title `⋯`. The bottom bar is just `Done`.

### P6. Past workouts open different things from different lists, and History's link disappears (S)
- **Screen:** History vs Today › Recent / strip / Calendar / records. `HistoryScreen.tsx:157–160` (a row opens **Repeat**) vs `TodayScreen.tsx:1040, 1064`, `CalendarView.tsx:39`, `ProgressScreen.tsx:297` (open the **Summary**). `TodayScreen.tsx:1036` (Recent, and its `All history ›`, only render when something was done in the last 14 days).
- **What's wrong:**
  - The same workout row does two different things depending on the list. Repeat is a start-a-workout screen, so tapping history in History can feel like starting a session.
  - After two weeks off, which is exactly when Ben wants to log a missed session or look back, Today loses its only visible way into History. `Log a past workout` then survives only in Today's `⋯` sheet and in Library › Workouts.
- **Fix:**
  - Every past-workout row opens its Summary. `Repeat` becomes a button on that Summary (bottom bar `Repeat` / `Done` when opened from a list).
  - Today always shows a one-line `History ›` link (under the start row) even with no Recent section.
  - `History` keeps `＋ Log a past workout` at the top, as now.

### P7. The coach has about ten entry points in five shapes, and some compete with Start (M)
- **Where:**
  - Today header ask bar (`TodayScreen.tsx:942`)
  - Today card offer and `Reviews ›` (`TodaySession.tsx:643–659`)
  - workout ask bar (`WorkoutScreen.tsx:3178`)
  - Your workout ask bar **and a primary-size `Review` button beside Start** (`BuilderWorkoutScreen.tsx:747–767`)
  - Progress floating `AskPill` over the charts (`ProgressScreen.tsx:328`)
  - Summary `Ask about this workout`
  - Plan `Ask coach to change`
  - plan day `Ask coach`
  - Exercise detail
  - Muscles
- **What's wrong:**
  - Same job, five looks: bar, pill, card, text button and big button. The 22 Oct review (V11) asked for one control. It got more.
  - `Review` at Start's size on Your workout reads as a step Ben should take before lifting.
  - The floating pill covers the bottom of Progress content.
- **Fix:**
  - One component (the ask bar) in one position, the bottom bar, on the four places it belongs: Today, the workout, Your workout and Progress.
  - Everything else becomes context passed into that same sheet. Keep Summary's text link, because it is post-workout.
  - `Review` moves into Your workout's `⋯`.
  - Remove the AskPill and use the same ask bar in Progress's bottom area.

### P8. Progress has too many levels and three period controls (L)
- **Screen:** Progress. `ProgressScreen.tsx:153–301`.
- **What's wrong:**
  - `Overview | Lifts | Training`, then inside Training `Totals | Calendar`, then inside Totals `Body parts | Push/Pull/Legs`. That is three stacked segmented controls.
  - Overview has its own week view, Totals its own `PeriodPicker`, and Lifts its own period dropdowns.
  - Calendar, which is history, sits two levels down and duplicates History.
  - Health's resting HR and sleep trends sit at the very bottom of Training › Totals (`:301`), where nobody will scroll.
  - Exercise detail vs Lifts (26 Oct #4) is still two screens (`AppNavigator.tsx:152, 368`).
- **Fix:**
  - Two tabs: `Lifts` (default; gym first: chips, chart, records) and `Training` (one period control at the top: totals, muscles, consistency, then a `Calendar` month block with a link to History).
  - Fold Overview's "This week" into the top of Training, and its coach changes into the Summary and Plan they belong to.
  - Health trends: see P9. This needs Ben's OK; it is a restructure.

### P9. Apple Health is bolted on in several places, and the upcoming Today sleep/RHR line would make it worse (S–M)
- **Where:**
  - Settings under Profile › **Data** (`ProfileScreen.tsx:86–94`)
  - a `Link` text button inline on History rows (`HistoryScreen.tsx:212`)
  - the Summary's first row plus `⋯ › Link activity from Health`
  - the activity sheet's `Link to a workout`
  - trends at the bottom of Progress (P8)
  - Today's `＋ Activity` as a full-width secondary button beside `Build your own` (`TodayScreen.tsx:1016–1033`)
- **What's wrong:**
  - Linking is one job with four entry points, although the auto-link rule (`apple-health.md:249–263`) already handles the common case.
  - The inline History `Link` puts admin into a reading list.
  - `＋ Activity` sits at the same weight as starting a gym workout.
  - Sleep / RHR on Today: no such line exists in the code (grep finds sleep and RHR only in Progress and the coach) ⚠. As proposed, it would be a non-lifting number above Start on the busiest screen. With no interpretation allowed (rule 6), it would be decoration.
- **Fix (gym first):**
  - Health is plumbing. Runs appear on the strip (already) and feed the run rule and the coach.
  - The Summary's linked row moves to the bottom (P5).
  - Remove History's inline `Link`; the question lives on that workout's Summary only.
  - Move `＋ Activity` into the strip's day sheet and Today's `⋯`.
  - **Don't add sleep / RHR to Today.** Give them to the coach's context, and show them only in Progress › Training as one small `Body` card next to bodyweight.
  - Move the Profile row to a `Connections` group with Coach connection: it's a connection, not a backup.

### P10. Too many ways to start, in too many places (S)
- **Where:**
  - On Today: `Start`, `Edit`, `Empty workout` (on the card, `TodaySession.tsx:669`, *or* as its own row, `TodayScreen.tsx:918`), `Build your own` (`:1018`), the Up next pill (no plan), and the `⋯` "Other" sheet. That sheet repeats `Empty workout` and `Build your own` and adds `Log a past workout` (`TodaySession.tsx:318–321`).
  - Library › Workouts adds `Empty workout`, `＋`/`New workout`, Resume, From history and `Log a past workout`.
- **What's wrong:**
  - Five start verbs, with no clear difference between `Edit` (change today's workout) and `Build your own` (set-up questions, then a workout).
  - The duplicates on one screen read as clutter, not discoverability.
- **Fix:**
  - Today: `Start` and `Edit` on the bar (P1).
  - One quiet row under the card: `Empty workout · Other ›`. `Other ›` opens the sheet with the other days, `Build your own`, `Log a past workout` and `＋ Activity`.
  - Nothing else.
  - Library › Workouts keeps its own `＋`, and drops `Empty workout` and `Log a past workout` (History owns that).

## Head-to-head: GymSmarter vs Hevy and Strong

**Evidence labels:**
- **[Code]** GymSmarter, read from this branch.
- **[Doc]** vendor help or feature pages, fetched 27 Oct:
  - Hevy: `hevyapp.com/features/` start-empty-workout, track-exercises (PREVIOUS), workout-rest-timer, exercise-performance, workout-log
  - Strong: `help.strongapp.io` articles 229 (first workout), 231 (rest timer), 237 (exercise detail), 167 (past workout)
  - `docs/research/competitor-first-pages.md` and `competitor-landscape.md`
- **[Guess]** a well-known UI pattern I couldn't confirm in a doc (Hevy's and Strong's help pages for replacing an exercise returned 403/404).

Taps are counted from the app's first screen and exclude typing. "Words" means the rough text before the action, as an order of magnitude only.

| Flow | GymSmarter | Hevy | Strong | Verdict |
|---|---|---|---|---|
| 1. Open → start today's planned workout | **1** (`Start`) [Code], but it may need a scroll first ⚠ (P1). About 60–120 words and two cards above it: strip, day control, gym row, rows, Time, Why, offer | **2**: Workout tab (Home is a social feed), then `Start Routine` on the card [Doc]. The card shows names only | **2**: tap the template card, then Start in the modal [Doc, first-pages] | Fewer taps, but **worse density**. They show a short card with Start on it; we show a wall above Start |
| 2. Log a set (matching / edited) | **1 / 2–3**: row `✓`; edit = cell, type, `✓` (the big Log pill hides with the pad, P2) [Code]. Targets prefilled, PREVIOUS column, tap to copy | **1 / 2** [Guess on edits]: `✓`; PREVIOUS column, tap to copy [Doc] | **1 / 2** [Doc 229: enter weight, reps, tick the checkbox] | Matching set: parity, and our prefilled targets help. Edited set: **slightly worse** (the big target vanishes) |
| 3. Add / swap an exercise mid-workout | **Add:** `＋ Add` is only on the **last** round page (`WorkoutScreen.tsx:3051`), so from round 2 it's round strip → `＋ Add` → pick = 3. **Swap:** name → pop-up → Swap → pick = 3 [Code] | Add: `+ Add Exercise` at the end of the one list, then pick and Add (≈3 plus a scroll) [Doc, start-empty]. Replace: exercise `⋯` → `Replace Exercise` → pick (≈3) [Guess] | Add: `Add Exercises` → pick → Add (≈3) [Doc 229]. Replace via exercise `⋯` [Guess] | Parity on taps. **Worse on findability:** Add exists on one page only, and Swap hides behind the name tap |
| 4. Rest timer | Starts by itself; bar always shown with −/+ and Skip; full-screen on tap [Code]. Live Activity / lock screen: runtime-detected, **not yet proven on device** ⚠ | Starts on set complete, ±15 s, per-exercise length, notification [Doc]. **Free interactive Live Activity:** complete sets and adjust rest without unlocking [Doc, landscape] | Starts on set complete (default 2:00), shown top-left, full screen on tap with Skip, per exercise via `⋯` [Doc 231]; Live Activity since 6.5.0 [Doc] | In-app: **better** (a bigger, always-on bar). Lock screen: **worse until proven**, which is the gap users praise most in Hevy |
| 5. Finish + summary | **≈3**: `Finish workout` (the pill after the last set, or `⋯` earlier) → Finish sheet → Summary `Done` ⚠. Summary: about 10 blocks, with Next time last (P5) [Code] | **2**: `Finish` (always top right) → `Save`; then summary slides (PRs, consistency, volume) [Doc] | **≈2**: `Finish` top right, any time [Doc 229]; a template-update prompt can follow (its own help calls it confusing) [Doc, first-pages] | **Worse.** One extra tap, Finish isn't always visible mid-workout, and our Summary is much denser. Theirs leads with PRs |
| 6. Last time / history for a lift | In session: PREVIOUS column, 0 taps [Code]. Full history: name → pop-up → `History` (≈2) [Code], into Exercise detail, **a different screen from Progress › Lifts** (26 Oct #4) | 0 taps (PREVIOUS); tap the name → exercise screen `Summary · History · How to` (2) [Doc] | 0 taps (Previous [Guess]); tap the name → Exercise Detail `About · History · Charts · Records` (2) [Doc 237] | Parity on taps. **Worse on consistency:** they have one exercise screen everywhere; we have two |
| 7. Start an empty workout | **2**: `Empty workout` on Today → the Add sheet opens by itself → pick [Code]. But the button is a quiet text link, sometimes under the card, so it's hard to see | **≈4**: Workout tab → `Start Empty Workout` → `+ Add Exercise` → pick [Doc] | **≈3–4**: `Start an Empty Workout` → `Add Exercises` → pick → Add [Doc 229, first-pages] | **Better on taps**, worse on visibility (P10) |
| 8. See progress for a lift | **2–3**: Progress → `Lifts` → chip (main lifts) or search [Code]. All history, free. Other lifts: search | **≈3**: Profile → `Exercises` → search → tap, `Summary` chart; **3 months free** [Doc] | **≈2–3**: Exercises tab → tap → `Charts` (PRO only) [Doc 237] | **Better** (no paywall, main lifts one tap away). But Progress has three levels of segmented controls around it (P8) |

**Where we're honestly worse:**
- **The first screen.** Both competitors open on short cards with Start on the card. Our Today is the densest first screen of the three (P1, P10).
- **Finish.** It is always top-right in both of theirs, and takes 2 taps. Ours takes 3, hides in `⋯` until the last set, and lands on a dense Summary (P5).
- **Lock-screen logging.** Hevy's free interactive Live Activity is the feature users single out. Ours is unproven on the device.
- **One exercise screen.** Theirs is one screen with tabs, reached by tapping the name everywhere. Ours is two different screens.

**What to copy (patterns, not branding):**
1. **Start on the card, near the top** (Hevy's `Start Routine` on each routine card). → Our pinned Start bar (P1).
2. **`Finish` always in the top bar** (both). Keep our Log pill turning into `Finish workout` at the end, *and* add a `Finish` text button in the workout's top bar that replaces nothing else. Finish sheet → Summary, with no third tap when every set is logged (Finish logs and opens the Summary; Undo there).
3. **Tap the exercise name → one exercise screen with tabs** (`History · Chart · Records · How to`), the same from the workout, Summary, Library and Progress (closes 26 Oct #4).
4. **`＋ Add exercise` on every round page** (Hevy has it at the end of the one list), not only on the last round. Swap stays in the name pop-up, *and* as a row swipe action.
5. **Summary leads with what changed** (PRs first, as Hevy's slides do, without the share-card fluff). Then Next time, then the rest (P5).
6. **Finish the Live Activity device test** and make it interactive (log the shown set, ±15 s, Skip), as Hevy does for free.

**Don't copy:**
- Hevy's social Home feed (it can't be removed).
- Strong's post-workout "Update template?" prompt; its own help admits it confuses.
- Paywalled chart history.
- Hevy's per-exercise rest picker as the *only* control. Our always-on bar is better mid-set.

## Smaller things (one line each)

- **Plan edit Changes card** uses `Accept / Reject / Accept all / Reject all` (`PlanChangesCard.tsx:44–66`). Everywhere else it's `Apply / Skip` (22 Oct V10). Use per-row checkmarks, then `Apply changes`.
- **Profile** has 9 section headers, 4 of them with one row each.
  - `Morning reminder` sits under `Voice` (`ProfileScreen.tsx:208–222`).
  - `Developer` is a top-level section in a personal app.
  - Fold Developer into App status, and put the reminder under Training.
- **Cross-tab jumps both ways:** Plan's goal → Profile (`YourPlanBlock.tsx:140`), and Profile › Split → Library (`ProfileScreen.tsx:135`). One owner per setting; edit in place.
- **Today's `SESSION` eyebrow** above the gym chip is a label with no job. The chip alone says the gym.
- **`Targets hit` is a switch row in Profile › Training** with the subtitle `Main lifts`. It's a display preference, and the label doesn't say what it shows.
- **`Accessories: Focused | Varied`** (inside Options) is still here. The 22 Oct review proposed cutting it, and it overlaps `Mix it up`.
- **Lift targets** shows under the plan *and* with no plan (`PlanTab.tsx:143`, `YourPlanBlock.tsx:266`). That's fine, but on the plan card it adds height between the days and the actions.

## Keep: works well

- **One-tap Start**, with the check-in off by default and a Start that never dead-ends (`ensureGym`, idempotent op IDs).
- **The table:**
  - one round per page
  - `SET · PREVIOUS · KG · REPS · RIR · ✓`
  - tap PREVIOUS to copy
  - one scroll
  - set rows drawn again only when they change
  - **RIR converted only at the view layer**, with storage untouched
- **The rest bar** is always there with −/+/Skip, and a slim version stays visible over the keypad.
- **Your workout's collapsed `Options` row** (26 Oct #7 fixed): the exercises start near the top.
- **One Swap / Add sheet everywhere.** The old `ExercisePicker` is gone from the navigator (26 Oct #2 fixed).
- **Undo toasts on every write that matters** (plan apply / end / pause, carry-over, delete, link), each with its own op ID.
- **Honest status:** the offline / not-connected coach state on every ask bar, no canned replies, and Health availability spelled out (`Not available on this install`).
- **History's week grouping** with tiny totals, `Show more` skipping gaps, and Recently deleted at the foot.
- **Health's auto-link rule**, which remembers `Not it` / Unlink so a pair is never asked about again. Watch actuals are never merged into logged sets.
- **Profile now separates Your data and Coaching knowledge** (26 Oct #13 fixed).

## Cut or merge candidates

| Candidate | Why | What's lost |
|---|---|---|
| **Focus view** (whole second workout UI) | P3. Double maintenance, and the empty workout changes shape | A one-set-at-a-time layout Ben doesn't use |
| **Build your own** (BuilderSetup questions) | Overlaps `Edit` and `Empty workout`. A setup questionnaire before lifting isn't gym first | Generating a workout from answers. The coach ("give me a 45-min push day") covers it |
| **Progress › Overview tab** | P8. Its content belongs on Training, Summary and Plan | One landing page of mixed facts |
| **Calendar inside Progress** | Duplicates History (and Today's strip). Keep a month block on Training that links to History | Separate calendar navigation |
| **Inline `Link` on History rows; Summary `⋯ › Link activity`** | The auto-link plus the Summary question cover it | Linking from the list, which is rare |
| **Floating AskPill on Progress; `Review` button on Your workout** | P7 | A shortcut that duplicates the ask bar |
| **Profile › Split (with a plan running) and the plan goal's jump to Profile** | One owner per setting (22 Oct V19, still open) | A second door to the same setting |
| **Accessories Focused / Varied** | Overlaps Mix it up and A/B days (22 Oct V21) | One fine-grained knob |
| **Today › Recent *or* the strip's past days** (Ben's call) | Both show the last days. The strip could look forward only (today + planned) while Recent looks back | 3 days of back-strip |
| **Developer section in Profile** | Fold it into App status | Nothing for Ben |

## Decisions for Ben

1. Pin `Start / Edit` to the bottom of Today (P1)?
2. Retire Focus view (P3)?
3. Plan: keep `Edit plan` visible, and open Library on Plan when a plan runs, or rename the tab `Plan` (P4)?
4. Progress down to `Lifts | Training` (P8)?
5. No sleep / RHR on Today. Health stays as plumbing plus one small Body card (P9)?
6. Every past workout opens its Summary, and Repeat moves there (P6)?
