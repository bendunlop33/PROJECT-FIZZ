# Competitor first pages: home/Today and pre-workout screens

Written by the `competitor-researcher`, 10 Oct 2026. It adds to [competitor-landscape.md](competitor-landscape.md) and covers only two screens: the page an app opens on (home/Today), and the page shown just before a workout starts. Everything here is a **proposal**. Ben decides.

Compared against: [today.md](../design/today.md), [premium-feel.md](../design/premium-feel.md) §2 (Up next hero, hero detail list, routine sheet), [check-in.md](../design/check-in.md) and CLAUDE.md rules 1–10 plus the minimal-copy convention.

**How this was gathered.** Research agents downloaded and viewed App Store screenshots, real in-app captures (screensdesign.com, help-centre GIFs, review sites) and vendor docs for 19 apps. Ben asked for this on 10 Oct 2026. I checked three of the screenshots myself (Liftosaur home montage, Fitbod App Store 1, Alpha ScreensDesign sheet), and they match the descriptions. One correction from that check: Alpha's `Start` button sits **near the top** of its sheet, under the counts, not at the bottom. No apps were downloaded, no accounts were created, and no competitor assets were copied. The screenshots are stored in this session's scratchpad (paths below). They are not committed and may not last beyond this session.

**Critic pass (10 Oct 2026).** A second agent checked this doc against its sources and CLAUDE.md. Changes: (1) added **StrongLifts 5x5** (77k US ratings) and **MacroFactor Workouts**, two major loggers that were missing, from their current App Store frames; (2) viewed **Hevy's routine detail page** (hevyapp.com feature image), which shows loads, so Hevy is no longer "no loads anywhere before Start"; (3) **corrected the finish-time claim**: StrongLifts already shows `30min · Finish at 17:45`, so idea 5 is not unique; (4) verified Liftosaur's "Why is the weight adjusted?" sheet in its vendor docs; (5) marked the widget claim in idea 12 and one praise line in §4 as unverified/inference; (6) added four matrix rows (programme position, upcoming sessions, plate breakdown, return-after-break). No idea was found to break CLAUDE.md rules 1–10 as written; idea 13 (new) carries its rule constraints explicitly. Remaining gaps are listed under **Limits** in §7.

**Labels.** **[Doc]**: shown in a screenshot or vendor doc. **[User]**: a review or forum anecdote. **[Inference]**: my reading. **(unverified)**: a claim from search snippets, or a tap count that nobody walked through on a device. "Marketing" means an App Store frame, which can be stylised or out of date. "Real" means an in-app capture.

---

## 1. TL;DR

- **The best loggers put the whole session on the first page.** Liftosaur and Boostcamp show every exercise with its sets × reps × load and one Start button on the home card. You see the plan and start in one place. StrongLifts goes further: today's workout with `5×5 215lb` per lift, then the next sessions with their increments (`↑ 5×5 220lb`). Strong and Alpha show names and set counts only, with **no loads**; Hevy shows loads only on the routine detail page, one tap from the card. GymSmarter's designed Up next card with `Target …` rows already follows the better pattern.
- **Fast apps reach the first logged set in 1–2 taps:** RP opens straight onto today's log, and Liftosaur and StrongLifts need Start then one tap on the set. Strong, Hevy and Alpha take 3. Caliber, Centr, Ladder and JuggernautAI take 4–10, and users complain about it. GymSmarter is designed at 2 taps (3 when a check-in is due), which is at the fast end.
- **"Readiness" and "recovery %" on the first page are invented numbers.** Fitbod, Gravl, Dr Muscle and JuggernautAI all lead with them, and none of them comes from measured data. GymSmarter must not copy this (rule 6). Its self-reported check-in is the honest version.
- **Busy, social or promotional home pages draw the clearest complaints:** Caliber ("way too busy… hard to figure out how to add a workout"), Hevy's social feed as the landing page, Peloton, Boostcamp's "bloat" and Apple Fitness+ upsells. Users praise single-purpose screens.
- **Cheap gaps for GymSmarter:** last time's result next to each target in the preview, superset brackets and a warm-up count, an `about 55 min · done ~19:05` line (StrongLifts already does this: `30min · Finish at 17:45`), and today-only swap/skip from the preview. Each one is S effort and fits the minimal-copy rule.
- **Coming back after a break** is handled well by StrongLifts: a `Welcome Back!` card offers a deload with a slider and before/after loads. GymSmarter has no equivalent; it fits as a proposal (idea 13).

---

## 2. Per-app summary

Tap counts run from opening the app to the first set logged with prefilled values. "n/a" means a follow-along video with no set logging.

| App | Home page functions | Pre-workout page functions | Taps to first set | Standout idea |
|---|---|---|---|---|
| **Strong** | Start tab: `Start an Empty Workout`, template grid (name, truncated exercises, last done date). No dashboard. Profile has chart widgets [Doc, real 2019–23] | Modal: `3 × Bench Press (Barbell)`, body part, `?` guide, Start / Edit / Close. **No loads, no last-time values** | 3–4 | "Last performed" date on each template card |
| **Hevy** | Home = social feed and suggested athletes (cannot be removed [Doc help]). Workout tab: Quick Start, routine folders, `Start Routine` on each card | Card's Start Routine goes straight to the log. Tapping the card opens **Routine** detail: `Start Routine` at the top, a volume/reps/duration history chart, then each exercise with rest timer and per-set kg × reps [Doc, feature page; critic pass] | 3 | Start button on every routine card; Previous column ("last time" or "last time in this routine") |
| **FitNotes 2** | Date-based day log: arrows between days, one card per exercise with sets, PR stars. Calendar with category dots [Doc, real] | None: the day page is the workout | ~4 (inferred) | The day log is the home page; there is no "session" ceremony |
| **Jefit** | Workout tab: Find / Planned / Instant. Planned shows day cards with a muscle-map thumbnail, `27m · 9 exercises · Not started` [marketing + blurred real] | Day Details: exercise rows `3 × 8 reps`, swipe to edit or delete, floating Start. Instant: AI session with duration, muscle and equipment filters | 2–3 (inferred) | Estimated duration and status ("Not started", "1 day ago") on each planned day |
| **Liftosaur** | Week strip, week insights (volume, sets, PRs; paid), **Next workout card with the full prescription** and Start, then history [Doc, real Sept 2026] | The same card, or a `New Workout` sheet with `Select next workout` (every day with a muscle map) and `Ad-Hoc Workout` | **2** | Full sets × reps × load (including AMRAP `5+` and timed sets) plus a superset bar, before you start |
| **Fitbod** | Workout tab **is** the preview: gym selector, chips (45m, Recovered Muscles, Equipment), muscle tiles with **recovery %**, exercises `4 Sets • 12 Reps • 25Lb`, superset blocks [marketing] | Same screen. Chips regenerate the workout in place; Swap; `…` per row | ~3 (inferred) | Gym selector at the top, tied to per-gym equipment |
| **Alpha Progression** | Week strip, plan name and `Week 1`, ordered workout list with thumbnails. Nothing else [real, blurred] | Sheet: name, plan/week, `4 exercises · 12 sets`, body map, **Start near the top**, rows `Barbell · 3x6 reps · 3 dropsets`, red superset bracket | 3 | Very plain first page; technique tags and a superset bracket on the preview |
| **Dr. Muscle** | Versions: a strength verdict with charts and a "Rest" tile; `WORKOUT NOW` with today's workout named in text (2025); an AI chat home (not viewed) [marketing + dev blog] | Exercise cards with a muscle figure and `1 of 4`. No loads | ≥3 (inferred) | One `WORKOUT NOW` button under a plain sentence naming today's workout |
| **Gravl** | Gym selector, `0 of 4 completed this week`, **NEXT WORKOUT hero** (`53 mins • 6 exercises • 16 sets`, recovery chip), "Feeling like something different?" alternatives [marketing] | Whole overview **not viewed**. Exercise detail: warm-up sets (Hide), effective sets with plate diagrams, score target; same-muscle swap sheet with converted loads | ~3 (unverified) | Warm-up sets shown separately from working sets, collapsible |
| **JuggernautAI** | Readiness score hero with trend, meet countdown, block-phase chart [marketing, 2021] | Readiness questionnaire, then a session with Daily Movement Ratings and **load ranges** (`85 - 92.5kg`) per set | 6–10 (inferred) | Per-lift "how does it feel today" ratings (also the slowest path) |
| **Future** | Greeting, one Today hero (coach video still, `30 min • Planet Fitness`, coach intro chip), more workouts [marketing] | Current version not viewed. Old (2021): coach audio intro, timed Foam rolling / Warm up sections | n/a (~2 to start) | One prescribed workout with the coach's intro |
| **Caliber** | Strength Score gauge, onboarding checklist, week strip, daily activity rows, **$100 coaching promo**, lessons; red `+` FAB [real, blurred] | Plan workout: Exercises / Overview / Notes tabs, muscle thumbnails, `N sets x 8-8 reps`. A banner says to go to Home and tap `+` to log | 4+ (inferred) | Counter-example: the preview can't start the workout |
| **Ladder** | Team avatars, streak greeting, Mon–Sun ticks, one Today card (photo, name, `60 min • Lower Body`) [marketing + real] | Coach video autoplays; **Total vs Active time**; named time-boxed blocks; per-exercise equipment dropdown; expandable Effort % / Previous; Restore Original; sticky Start; `Start Here` | 4 | Total vs active time, and `Restore original workout` after edits |
| **Boostcamp** | Program card with % progress, **next day previewed inline** (`Sets | Top Set`), big `Start Week 1 – Day 2`, Empty Workout row, streak, photos [real, blurred] | None: the home card is the preview. Live table has Previous and Target side by side; swap asks "This and Future / Just This Workout" | 2–3 | Swap scope choice (today only vs future); Previous next to Target |
| **RP Hypertrophy** | **Opens on today's log**: `WEEK 5 DAY 1`, muscle chip, pinned note, prefilled weight and reps, LOG box [marketing] | None. Per-muscle feedback (joint pain, soreness, pump, volume) is asked mid-workout | **1** | No preview at all; the log is the home page |
| **Apple Fitness+** | App opens on a rings and steps dashboard. Fitness+ tab: one hero with `Let's Go`, then rows [marketing + real] | Video still, `5min · Chill Vibes`, `No Equipment · Lower Body`, Let's Go / Preview, playlist; Stacks | n/a (2 to start) | Two-line metadata packing duration, equipment and focus |
| **Nike Training Club** | Editorial: What's New and a campaign hero. No plan or stats [real 2025] | Four icon rows (time and level, focus, equipment, format/music), trainer paragraph, sticky Start with a music button | n/a (4 to start) | Compact four-row metadata block |
| **Peloton** | Streak dots, three goal rings, Your Plan card ("Today is a cardio day"), carousels [marketing + real] | Tabs: Notes / Equipment / Workout Plan (blocks, per-movement prescription) / Body Activity (muscle % map); sticky Start | n/a (2 to start) | Workout plan grouped into blocks with notes per block |
| **Third Space** | Serif greeting with streak sentence, weekly attendance dots, bookings [marketing only] | Not viewed (marketing exercise sheet only) | ? | One-sentence streak greeting (club app; low relevance) |
| **Centr** | Greeting, week strip, one MOVE card (`22 MIN | Dumbbells`, swap icon), meals [real Dec 2025] | Level / Time / Target / Equipment table, dumbbell weight advice, sectioned list (warm-up, main, cool-down) with inline demos, `Review Logbook`, sticky Start | 5–6 (inferred) | `Review Logbook` (past logs) on the pre-workout page |
| **StrongLifts 5x5** | Program name, **Today's Workout** card (`A`, day) with every lift's `5×5 215lb`, `30min · Finish at 17:45`, big `Start Workout`, then **Upcoming Workouts** with loads and ↑ increments. `Welcome Back!` deload card after a long gap [marketing, v4.4.0] | None: the home card is the preview. Live: Workout / Warmup tabs, tap-a-circle per set, plate breakdown `130lb (42.5/side)`, rest bar | **2** | Finish clock time; next sessions shown with their increments; return-after-break deload with before/after |
| **MacroFactor Workouts** | Workout tab: week strip, **Active Program** (cycle) with each workout's exercise names and muscle chips, rest days, Workout Library. Dashboard: weekly muscles / sets / exercises rings against targets [marketing, v1.4.1] | Programme page: gym chip (`Commercial Gym`), Target Muscles tiles, per-exercise week columns of reps + RIR. Live log: Previous column with RIR, Warm Up / Swap / Note chips | ~3 (inferred) | Per-gym chip on the plan; RIR targets per set |
| **GymSmarter (designed, not all built)** | Date and gym chip, Up next hero (`Push A`, focus, `5 exercises · about 55 min`, `After Pull A on …`), Start, up to 5 `Target …` rows, links, routines, This week strip, lift highlight | Today's hero is the preview. Routine sheet: `Last done …`, target rows, Start this routine. Check-in sheet on Start when due | 2 (3 with check-in) | Targets already snapped to the selected gym's equipment |

---

## 3. Capability matrix: pre-workout functions

✓ = shown before the first set. partial = limited, or shown only after Start. ✗ = not shown. ? = not seen. n/a = no set logging. Sources: the screenshots and docs in §7. Marketing frames count, with the caveat above.

Columns: St Strong · Hv Hevy · FN FitNotes 2 · Jf Jefit · Lo Liftosaur · Fb Fitbod · Al Alpha · DM Dr. Muscle · Gv Gravl · JA JuggernautAI · Fu Future · Ca Caliber · La Ladder · Bc Boostcamp · RP RP Hypertrophy · AF Apple Fitness+ · NTC Nike · Pe Peloton · TS Third Space · Ce Centr · SL StrongLifts 5x5 · MF MacroFactor Workouts · **GS** GymSmarter (designed). SL and MF were added in the critic pass from App Store frames only (marketing, v4.4.0 and v1.4.1, Oct 2026).

| Function | St | Hv | FN | Jf | Lo | Fb | Al | DM | Gv | JA | Fu | Ca | La | Bc | RP | AF | NTC | Pe | TS | Ce | SL | MF | **GS** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Full exercise list | ✓ | partial¹ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | partial² | ✓ | partial³ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ? | ✓ | ✓ | ✓ | ✓⁴ |
| Targets **with loads** | ✗ | partial²⁸ | ✗ | partial⁵ | ✓ | ✓ | partial⁵ | ✗ | partial⁶ | ✓⁷ | ✗ | partial⁵ | partial⁸ | partial⁵ | ✓ | n/a | n/a | n/a | ? | partial⁹ | ✓ | partial²⁴ | ✓ |
| Last-time values | ✗¹⁰ | partial²⁹ | ✗ | ✗ | ✗¹⁰ | ✗ | ✗¹⁰ | ✗ | ? | ✗ | ✗ | ✗¹⁰ | ✓ | ✗¹⁰ | partial | n/a | n/a | n/a | ? | ✓¹¹ | ✗¹⁰ | ✗¹⁰ | partial¹² |
| Estimated duration | ✗ | ✗ | ✗ | ✓ | ✗ | ✓¹³ | ✗ | partial¹³ | ✓ | ✗ | ✓ | partial | ✓¹⁴ | ✗ | ✗ | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ? | ✓ |
| Finish clock time | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? | ✗ | ✓²⁵ | ? | ✗ |
| Muscle map or focus | partial¹⁵ | ✗ | ✗ | ✓ | partial | ✓¹⁶ | ✓ | ✓ | partial¹⁶ | ✗ | ✗ | ✓ | ✗ | ✗ | partial¹⁵ | partial¹⁵ | partial¹⁵ | ✓ | ? | partial¹⁵ | ✗ | ✓²⁶ | partial¹⁵ |
| Warm-up sets shown | ✗ | partial¹⁰ | ✗ | ? | partial¹⁰ | ✗ | partial¹⁰ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ | partial¹⁰ | ✗ | n/a | n/a | ✓ | ? | ✓ | partial¹⁰ | partial¹⁰ | ✗ |
| Gym / equipment check | ✗ | ✗ | ✗ | partial | ✓ | ✓ | ✗ | partial | ✓ | ✗ | partial | ✗ | partial | ✗ | partial | partial¹⁷ | partial | partial | ? | partial | ✗ | ✓²⁷ | ✓ |
| Swap / reorder / remove | ✗ | ✗ | n/a | ✓ | partial | ✓ | ✗ | partial | partial | ✓ | ? | partial | ✓ | ✗¹⁰ | ✓ | ✗ | ✗ | ✗ | ? | partial¹⁸ | ? | partial¹⁰ | ✗¹⁹ |
| Readiness / check-in | ✗ | ✗ | ✗ | ✗ | ✗ | ✗²⁰ | ✗ | ✗²⁰ | ✗²⁰ | ✓ | ✗ | ✗ | ✗ | ✗ | partial²¹ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✓²² |
| Coach note / message | ✗ | partial¹⁰ | ✗ | ✗ | partial¹⁰ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | partial¹⁰ | partial | partial | ✓ | ✓ | ? | ✓ | ✗ | ✗ | partial²³ |
| Superset / block grouping | ✗ | ✗ | ✗ | ? | ✓ | ✓ | ✓ | ✗ | ? | ✗ | ✓ | ✗ | ✓ | ✗ | ? | n/a | n/a | ✓ | ? | ✓ | ✗ | ? | ✗ |
| Music / audio intro | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ? | partial | ✗ | ✗ | ✗ |
| Start placement | modal bottom | card | — | float BR | card bottom | ? | sheet top | home hero | detail bottom | ? | ? | **indirect** | sticky bottom | home card | — | hero | sticky | float | ? | sticky | home card | ? | hero card |
| Taps to first set | 3–4 | 3 | ~4* | 2–3* | **2** | ~3* | 3 | ≥3* | ~3* | 6–10* | n/a | 4+* | 4 | 2–3 | **1** | n/a | n/a | n/a | ? | 5–6* | **2** | ~3* | **2** (3 w/ check-in) |
| Programme position (week/day) | ✗ | ✗ | ✗ | ? | ✓ | ✗ | ✓ | ? | partial | ? | ? | ? | ? | ✓ | ✓ | ? | ? | ? | ? | ? | ✓ | ✓ | partial³⁰ |
| Upcoming sessions with loads | ✗ | ✗ | ? | ? | partial | ✗ | partial | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✓ | partial | ✗ |
| Plate breakdown (per side) | ✗ | ✗ | ? | ? | partial³¹ | ? | ? | ? | ✓ | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | partial¹⁰ | ? | ✗ |
| Return-after-break prompt | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✓³² | ? | ✗ |

\* inferred, not walked through on a device.

Footnotes:
1. Hevy cards show truncated exercise names. There is no preview page (the routine detail page was not viewed).
2. Gravl: only the hero meta line (`6 exercises • 16 sets`) was confirmed. The full overview was not viewed.
3. Future: the current overview was not viewed. The 2021 overview listed timed items.
4. GymSmarter: up to 5 rows, then `+2 more` (premium-feel §2.3).
5. Sets × reps without a load.
6. Gravl's exercise detail before Start shows loads and plate diagrams. Whether the overview does is unverified.
7. JuggernautAI shows load ranges, and only after the readiness questionnaire.
8. Ladder: `Effort 80%` and `Previous 60 lb` in the expanded row.
9. Centr: a dumbbell weight range in the description text.
10. Shown only after Start, on the live logging screen.
11. Centr: the `Review Logbook` button.
12. GymSmarter: `Last (1 Oct): 60 kg × 8` is on the set card after Start. The Today rows show the Target only.
13. User-chosen duration (Fitbod chip; Dr Muscle 30/45 setting), not an estimate of this workout.
14. Ladder: total and active time.
15. A text body part or focus line, no map.
16. Includes an app-estimated **recovery %**, which rule 6 would forbid.
17. Apple Fitness+ equipment metadata is reported as wrong [User, May 2026].
18. Centr swaps the whole workout, not single exercises.
19. GymSmarter Today rows aren't tappable in this pass. Swap and skip exist in the workout, and `Other routine` swaps the whole session.
20. These apps show a recovery estimate instead of asking. Not counted as a check-in.
21. RP asks mid-workout, per muscle.
22. GymSmarter: the optional 1–5 check-in on Start when due. It never changes targets by itself.
23. GymSmarter: the `2 coach suggestions to review ›` line. No coach message on the hero.
24. MacroFactor: the programme editor shows reps ranges and an RIR target per set per week (`3-5 reps`, RIR badge), no load. Loads appear in the live log.
25. StrongLifts: `30min · Finish at 17:45` under Today's Workout, above Start Workout [marketing].
26. MacroFactor: target-muscle tiles with exercise and set counts; a weekly set-volume dashboard with targets per muscle.
27. MacroFactor: a gym chip (`Commercial Gym`) on the programme page.
28. Hevy: the routine detail page (one tap from the card; `Start Routine` at the top) lists each exercise's sets with kg × reps and a volume history chart [Doc, hevyapp.com routines feature page, viewed in the critic pass]. The card itself shows names only.
29. Hevy: the routine detail's chart shows past volume for the routine; per-set Previous values appear only after Start.
30. GymSmarter: `After Pull A on …` on the hero. No week/cycle position.
31. Liftosaur: the rounded weight is tappable to a **Why is the weight adjusted?** sheet that includes plates per side [Doc, liftosaur.com/features/equipment-and-gyms and workout-screen].
32. StrongLifts: `Welcome Back! Last workout 2 months ago. Deload to avoid soreness.` with a `Deload` button, opening a sheet with a 50% slider and the before/after loads per exercise [marketing].

---

## 4. What users praise and complain about on these screens

**Praise**
- **Last time's numbers on the screen.** [User] Boostcamp, 5★, 2026-03-31: "Best feature is having the previous weight and reps on current workout. I was tired of always having to click through a menu." [Inference] Hevy's and Strong's Previous columns are likely core to their appeal (both feature them in store frames; no review quote gathered).
- **No decisions to make.** [User] Alpha: "I like not having to think about what to do at the gym" (5★, 2026-03-13). Gravl: "eliminates decision fatigue" (5★, 2026-08-10). Centr: "takes the hassle out of thinking about what I need to do" (5★, 2024-11).
- **Clear pre-workout overview.** [User] Caliber: "The overviews are extremely helpful" (5★, 2026-07-26). Tom's Guide on Centr: equipment, time and level are clear, and you can watch each move first. Pelo Buddy praises Peloton's class plan and muscle map.
- **Asking how you feel before the session.** [User] JuggernautAI: "the pre workout questions adjust your load based on your answers" (5★, 2021), and readiness is "a great way of gauging where your fatigue is" (3★, 2023). An RP user wants soreness asked **before** the workout, not during it (5★, 2026-06-27).
- **Simple and out of the way.** [User/promo] Strong's testimonials (promotional) and Garage Gym Reviews call it simple and fast.

**Complaints**
- **Busy home page, indirect start.** [User] Caliber: "The home page is way too busy and it's hard to figure out how to add a workout in the first place" (1★, 2026-02-13), and "cognitive overload" (4★, 2026-07-15). [Doc] Caliber's own banner sends users from the preview back to Home's `+`.
- **Redesign bloat.** [User] Boostcamp: "custom workouts hard to find… too much margin spacing" (1★, 2026-03-28), "Less intuitive with every update" (2★, 2026-06-08), and "pop up to subscribe… every single time" (5★, 2024-10). Jefit's redesign "made it harder to make changes in workout" (search summary, unverified). Peloton: "Overly complicated… focused on directing user to classes" (1★, Nov 2025).
- **Workout changes on the home page without warning.** [Doc] Fitbod has a help article titled "Why did my workout change? Understanding workout refreshes". [User] Gravl: had to "regenerate it… the wrong equipment" (2025-11-23).
- **Slow path to the first set.** [User] JuggernautAI: "app lags several seconds after launch", and sessions of "1.5–2 hours… no way to adjust for time available" (4★, 2025-03-10). Boostcamp: "wait 10–20s for the app to open" (3★, 2025-08-10). Centr: "Can't login… waste time before starting my workout" (1★, 2026-01).
- **Social or promotional landing page.** [Doc] Hevy's Discover feed "will remain on the Home screen… no way to remove". [User] Apple Fitness+: "Can't get off the fitness part… you cannot get off that page to find your own data" (1★, Jan 2026).
- **Templates and edits that are hard to understand.** [Doc] Strong's help admits its post-workout Update Template prompt causes "confusion". [User] Alpha: "once it's finished the workouts seem locked in" (5★, 2026-03-13). Boostcamp: deleting an exercise has only "a 3 second timer" to undo (1★, 2026-09-14).
- **Missing timer or time context.** [User] RP: "there is no rest timer even though there should be" (4★, 2026-08-04), plus a request for a workout duration timer. Jefit: "there is no clock on the personalized routine".
- **Coarse muscle model.** [User] Fitbod "treats back as one unit" (4★, 2026-09-04). Any muscle map needs good data behind it.

---

## 5. Ranked ideas for GymSmarter's Today and pre-workout overview

These are proposals. Ben decides. They are ranked by value to Ben divided by effort, then by fit with the first milestone (Today → Active set → Rest → Summary). "Fit" checks against CLAUDE.md: no fake data (rule 6), minimal copy, coach honesty (rules 1 and 3), proposals and Undo (rule 2), and achievable loads (rule 4).

**1. Keep the Up next hero as the preview, with every exercise's full target. Don't add a separate preview page.**
- What: the premium-feel §2.3 rows (`Target 100 kg × 6–8 · 3 sets`), with AMRAP, timed and per-dumbbell conventions written out (`30 kg each`), and the values identical to what Start creates.
- Who does it: Liftosaur and Boostcamp (home card with full prescription and Start). Strong, Hevy and Alpha don't show loads.
- Fit: rule 4 (already snapped to the gym), rule 6 (labelled as `Target`), minimal copy. **Effort S. Already designed**; add an acceptance check that the rows match what Start creates in every load convention.

**2. Hold the line on 2 taps to the first logged set (Start → Log), and 3 only when a check-in is due.**
- What: make this an acceptance check on a real iPhone. Make sure the first-Start permission sheet (premium-feel §3.5) appears only once.
- Who does it: RP (1), Liftosaur (2), StrongLifts (2), Boostcamp (2–3). The complaints are about Caliber, Centr, JuggernautAI and Ladder (4–10).
- Fit: rule 1 and the first milestone. **Effort S** (a test, not a feature).

**3. Add last time's result to each preview row: `Target 100 kg × 6–8 · last 97.5 × 8`.**
- What: one short, tabular fragment showing the **actual** from the last comparable session (same equipment and convention). Omit it when nothing comparable exists. It is never an estimate.
- Who does it: Ladder (Previous in the preview), Centr (Review Logbook), and Boostcamp, Strong and Hevy after Start. Praised by Boostcamp users.
- Fit: rule 6 (actual vs target), minimal copy. Uses the existing `getComparableHistory`. **Effort S.** Watch the row width at AX sizes: drop the fragment before wrapping the target.

**4. Group supersets and show the warm-up count on the preview.**
- What: a thin accent bar or bracket joining superset rows, and `+2 warm-ups` in the row's detail rather than listing warm-up rows.
- Who does it: Liftosaur (bar), Alpha (bracket), Fitbod (superset block); Gravl (warm-ups as a separate, hideable group); Alpha (warm-up pill after Start).
- Fit: minimal copy (a shape, not a sentence). Colour is never the only signal, so VoiceOver reads "superset with …". **Effort S.**

**5. Add a finish clock time to the duration estimate: `about 55 min · done ~19:05`.**
- What: computed from `estimateRemainingDuration` plus the current time, always marked as an estimate. It pairs with the existing availability note (`About 60 min; 30 min available today`).
- Who does it: **StrongLifts** shows `30min · Finish at 17:45` above Start (critic pass; the first draft wrongly said no app does). Jefit, Gravl, Ladder (total and active time), Apple, NTC and Centr show a duration. A JuggernautAI user complained about sessions running 1.5–2 h with no way to fit the time.
- Fit: rule 6 (worded as "about" and "~"). **Effort S.** [Inference] Not unique, but useful for a single user with a fixed schedule; StrongLifts' version shows no "~", which GymSmarter should keep.

**6. Let preview rows open a small exercise sheet: How to, today-only Swap and Skip, and history.**
- What: rows are currently not tappable. A tap opens a sheet with `How to` (Skia guide), `Swap for today`, `Skip today` and `History`. Every change applies to **this session only**, with Undo. Changing the routine template remains a proposal (rule 2), raised only when Ben asks.
- Who does it: Boostcamp ("This and Future / Just This Workout"), Ladder (per-exercise equipment dropdown plus `Restore original workout`), Fitbod and Jefit (swap before start), Strong (`?` guide button).
- Fit: rules 2, 4 (a swap is re-snapped to the gym) and 9 (pain flags block). **Effort M.** Fits after the first milestone (the routines and builder pass).

**7. Make a rounded or capped target visible on the preview row, without explaining it.**
- What: when the snap changed the target (no 31 kg dumbbell, the machine maxes out), show a small `≈` or info glyph on that row, with the reason behind a "Why?" tap. Don't add a NoteLine sentence for each row.
- Who does it: Liftosaur shows the exact weight crossed out next to the rounded one, with a "Why is the weight adjusted?" sheet including plates per side [Doc, verified in the critic pass]. StrongLifts shows `42.5/side` after Start. Fitbod and Gravl put a gym selector at the top.
- Fit: rule 4, plus the minimal-copy rule (explanation only behind "Why?"). This **slims down** the routine sheet's planned NoteLines (premium-feel §2.6). **Effort S.**

**8. If the coach changed next-time targets, mark those rows on the preview.**
- What: a `Coach` tag on changed rows, with `Why?` and Undo reached from the tag (the reason is already recorded under rule 3). The `2 coach suggestions to review ›` line stays for unapplied proposals.
- Who does it: Dr Muscle (today's workout named in plain text; AI chat on the home page), Future and Ladder (coach intros). GymSmarter's version is honest: it is a tag on real changes, not a canned message.
- Fit: rules 1 and 3 (no canned coach text; changes visible, with their reason and Undo). **Effort S–M.** Fits at build step 4.

**9. Keep the check-in on Start (optional and skippable), and allow "sore" to name muscles there.**
- Who does it: JuggernautAI (praised, but slow), and RP (users want soreness asked before the workout rather than during).
- Fit: already designed (check-in.md). The only proposal is to measure the tap cost after two weeks (CI2 already says so). **Effort: none now.**

**10. Optional static muscle-focus figure on the routine sheet only, never on the Today hero.**
- Who does it: Alpha, Jefit, Caliber and Peloton (Body Activity).
- Fit: only from catalogue muscle data (Coaching knowledge), never a recovery %. The text focus line already covers most of the value. **Effort M.** Low priority. The Fitbod complaint shows that coarse muscle data annoys users.

**11. Show the last done date on routine rows (`Pull A · 6 exercises · 8 Oct`).**
- Who does it: Strong.
- Fit: **already designed** (premium-feel §2.2). Listed only to confirm the pattern.

**12. Later: a home-screen or lock-screen widget showing Up next.**
- Who does it: NTC, Strong 6.x and Peloton (unverified: no widget screenshot or doc was gathered).
- Fit: needs a WidgetKit extension with an App Group. Check that it stays free-provisionable (the same App Group problem that is blocking the Live Activity). **Effort L.** Build order step 7.

---

**13. Return after a break: offer a lighter first session as a proposal.**
- What: when the last session of a routine is long ago (threshold TBD by the playbook), the hero shows one line such as `Last session 5 weeks ago · Lighter start?`, opening a before/after proposal for **today only**, with Apply and Undo. Targets don't change unless Ben applies it.
- Who does it: StrongLifts (`Welcome Back!` card, `Deload` button, 50% slider with before/after loads).
- Fit: rules 2 and 3 (an offer, never auto-applied; a broader template change stays a proposal), rule 4 (re-snapped loads), rule 10 (the threshold and percentage are playbook rules, Coaching knowledge, needing Ben's approval). With no AI, the labelled built-in rule is the fallback (ADR 0006). **Effort S–M.** Fits with the coach build (step 4); the no-AI rule could come earlier.

## 6. What to avoid

- **Recovery %, readiness or strength scores on Today** (Fitbod, Gravl, JuggernautAI, Dr Muscle, Caliber). These are computed numbers without measured inputs. Rule 6 forbids them, and check-in.md §5.5 already bans the words.
- **A workout that regenerates silently on the home page** (Fitbod's refreshes, Gravl's regenerate). Today must show the same targets until Ben or an accepted proposal changes them (rules 2 and 5).
- **A preview that can't start the workout** (Caliber's "go to Home and tap +"). Every place that shows a workout gets its own Start.
- **Social, editorial or promotional landing pages** (Hevy feed, NTC campaigns, Apple Fitness+ upsell, Caliber's $100 promo, Ladder's team avatars). They are out of scope for a single-user app, and users complain about them.
- **Previews without loads** (Strong, Alpha, Jefit Day Details). Ben then has to start the workout to find out what he's lifting.
- **Long questionnaires before the first set** (JuggernautAI, Dr Muscle's warm-up prompts). Keep the check-in to one tap, skippable, and only when due.
- **Multi-tab pre-workout pages** (Peloton, Caliber Exercises / Overview / Notes). They suit classes, not a logger.
- **Bloat that comes with redesigns** (Boostcamp, Jefit). Hold Today to one primary button, at most two links and the regions in premium-feel §2.1.
- **Undo windows that are too short to use** (Boostcamp's 3 s undo for a deleted exercise). Keep `timing.undoToast` (8 s), with a longer path from Past workouts.
- **Streak guilt or praise copy** (Ladder's "You're crushing it", Third Space's streak sentence). The minimal-copy rule and premium-feel §6 already exclude these.

---

## 7. Sources and screenshots

URLs as gathered by the research agents (checked between 9 and 10 Oct 2026; RSS reviews pulled 10 Oct 2026). The screenshot paths are in this session's scratchpad, abbreviated `$S` = `/tmp/claude-0/-home-user-PROJECT-FIZZ/7759033f-4645-5709-b253-2b9889fd0578/scratchpad/competitor-shots`. They are not committed and may be cleared.

| App | Screenshots relied on | Sources |
|---|---|---|
| Strong | `$S/loggers/strong/strong-1…5.jpg`, `strong-6-montage.png`, `strong-7-montage.png`, `strong-11.png`, `strong-12.png`, `strong-16to19-montage.png`, `strong-20to25-montage.png`, `strong-25.png`, `strong-hevy-sd-montage.png` | [App Store](https://apps.apple.com/us/app/id464254577) · [My first workout](https://help.strongapp.io/article/229-my-first-workout) · [About templates](https://help.strongapp.io/article/105-about-templates) · [Edit template](https://help.strongapp.io/article/106-edit-template) · [Update template](https://help.strongapp.io/article/177-update-template) · [strong.app](https://www.strong.app/) · [Dr Muscle review](https://dr-muscle.com/strong-workout-app-review/) · [Garage Gym Reviews](https://www.garagegymreviews.com/equipment/strong) · [ScreensDesign](https://screensdesign.com/apps/strong-workout-tracker-gym-log/) · [strong.app/love](https://strong.app/love) |
| Hevy | `$S/loggers/hevy/hevy-1…6.jpg`, `hevy-7…9.png`, `$S/loggers/strong/strong-hevy-sd-montage.png` | [App Store](https://apps.apple.com/us/app/id1458862350) · [Routines](https://www.hevyapp.com/features/gym-routines/) · [Track workouts](https://www.hevyapp.com/features/track-workouts/) · [Social guide](https://help.hevyapp.com/hc/en-us/articles/35688036014231-Hevy-App-Social-Guide-Connect-Follow-and-Share-Your-Workouts) · [How to log](https://help.hevyapp.com/hc/en-us/articles/35361530647959-How-to-Log-a-Workout-in-the-Hevy-App-Step-by-Step-Guide) · [ScreensDesign](https://screensdesign.com/apps/hevy-workout-tracker-gym-log/) |
| FitNotes 2 | `$S/loggers/fitnotes/fitnotes-1…6.jpg` (the unrelated app `fitnotes1-1/2.jpg` was excluded) | [App Store](https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016) · [unrelated app](https://apps.apple.com/us/app/id1059245195) · [apppricinglab](https://apppricinglab.com/app/apple/1538896016) · [WhistleOut](https://www.whistleout.com/CellPhones/Apps/fitnotes-app-review) · [AndroidAuthority](https://cellphoneplans.androidauthority.com/CellPhones/Guides/fitnotes-app-review) |
| Jefit | `$S/loggers/jefit/jefit-1…6.jpg`, `jefit-site-montage.png`, `jefit-site-feature5.png`, `jefit-sd-montage.png` | [App Store](https://apps.apple.com/us/app/id449810000) · [jefit.com](https://www.jefit.com/) · [FAQ](https://www.jefit.com/support/faq) · [Unified editor](https://www.jefit.com/blog/meet-jefits-all-new-unified-workout-editing-screen) · [Workout tab revamp](https://www.jefit.com/blog/upcoming-enhancements-revamped-workout-tab-and-improved-exercise-screens) · [ScreensDesign](https://screensdesign.com/apps/jefit-workout-planner-gym-log/) · [Google Play](https://play.google.com/store/apps/details?id=je.fit) · [GGR](https://www.garagegymreviews.com/equipment/jefit) |
| Liftosaur | `$S/loggers/liftosaur/liftosaur-1…6.jpg`, `liftosaur-7.png`, `liftosaur-video-montage.png`, **`liftosaur-home-preview-montage.png` (viewed by me)**, `liftosaur-workout-montage.png` | [App Store](https://apps.apple.com/app/id1661880849) · [liftosaur.com](https://www.liftosaur.com/) · [History](https://www.liftosaur.com/features/workout-history) · [Changing a workout](https://www.liftosaur.com/features/changing-a-workout) · [Workout screen](https://www.liftosaur.com/features/workout-screen) · [Week insights](https://www.liftosaur.com/features/week-insights) · [Equipment and gyms](https://www.liftosaur.com/features/equipment-and-gyms) · [First run](https://www.liftosaur.com/features/first-run-and-settings) · [Built-in programs](https://www.liftosaur.com/features/built-in-programs) |
| Fitbod | **`$S/adaptive/fitbod/fitbod-1.jpg` (viewed by me)**, `fitbod-2…10.jpg` | [App Store](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1041517543/sortby=mostrecent/json) · [Editing workouts](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod) (403; via snippet) · [Warm-up sets](https://help.fitbod.me/hc/en-us/articles/360006337634-Warm-Up-Sets) · [How Fitbod works](https://help.fitbod.me/hc/en-us/sections/360001078993-How-Fitbod-Works) · [TechRadar](https://www.techradar.com/health-fitness/fitbod-app-review) |
| Alpha Progression | `$S/adaptive/alpha/alpha-1…8.jpg`, `alpha-sd-2.jpg`, **`alpha-sd-3.jpg` (viewed by me)**, `alpha-sd-4.jpg` | [App Store](https://apps.apple.com/us/app/alpha-progression-gym-tracker/id1462277793) · [ScreensDesign](https://screensdesign.com/apps/gym-workout-alpha-progression/) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1462277793/sortby=mostrecent/json) · [hotelgyms guide](https://www.hotelgyms.com/blog/how-to-use-alpha-progression) · [Alpha vs Gravl](https://alphaprogression.com/en/blog/alpha-progression-vs-gravl) |
| Dr. Muscle | `$S/adaptive/drmuscle/drmuscle-1…10.jpg`, `drmuscle-web-workoutnow.png` | [App Store](https://apps.apple.com/us/app/dr-muscle-ai-personal-trainer/id1073943857) · [860 Workout now](https://dr-muscle.com/860-workout-now/) · [Chat AI trainer](https://dr-muscle.com/chat-ai-trainer/) · [What makes it different](https://dr-muscle.com/what-makes-dr-muscle-different/) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1073943857/sortby=mostrecent/json) |
| Gravl | `$S/adaptive/gravl/gravl-1…10.jpg`, `gravl-sd-1…3.jpg` | [App Store](https://apps.apple.com/us/app/gravl-ai-personal-trainer/id6450921637) · [ScreensDesign](https://screensdesign.com/showcase/personal-trainer-gravl) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=6450921637/sortby=mostrecent/json) · [gainframe](https://gainframe.app/blog/gravl-app-review/) · [sensai](https://www.sensai.fit/blog/gravl-app-review-2026) |
| JuggernautAI | `$S/adaptive/juggernaut/juggernaut-1…4.jpg` | [App Store](https://apps.apple.com/us/app/-/id1515756471) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1515756471/sortby=mostrecent/json) · [GGR](https://garagegymreviews.com/juggernautai-review) (404; via snippet) · [AppFollow](https://apps.appfollow.io/ios/juggernautai/1515756471?country=us) |
| Future | `$S/coached/future/future-1…7.jpg`, `ggr-0-1.jpg`, `ggr-0-3.jpg`, `ggr-0-7.jpg`, `site-pro-carousel-workout-still.jpg`, `site-coach-check-in-phone-still.jpg` | [App Store](https://apps.apple.com/app/id1288178982) · [Lookup](https://itunes.apple.com/lookup?id=1288178982&country=us) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1288178982/sortby=mostrecent/json) · [GGR](https://www.garagegymreviews.com/future-app-review) · [future.co](https://www.future.co/) |
| Caliber | `$S/coached/caliber/caliber-1…10.jpg`, `sd-46.jpg`, `sd-66.jpg`, `sd-76.jpg`, `sd-77.jpg`, `sd-79.jpg`, `sd-111.jpg`, `sd-129.jpg` | [App Store](https://apps.apple.com/app/id1482405410) · [Lookup](https://itunes.apple.com/lookup?id=1482405410&country=us) · [ScreensDesign](https://screensdesign.com/apps/caliber-strength-training/) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1482405410/sortby=mostrecent/json) |
| Ladder | `$S/coached/ladder/ladder-1…10.jpg`, `ggr-Ladder-app-workout-view.jpg`, `ggr-Ladder-app-exercise-view.jpg`, `ggr-Ladder-app-profile-and-streak-view.jpg`, `sd-10.jpg`, `sd-13.jpg`, `sd-22.jpg`, `sd-30.jpg`, `sd-35.jpg`, `sd-92.jpg` | [App Store](https://apps.apple.com/us/app/-/id1502936453) · [Lookup](https://itunes.apple.com/lookup?id=1502936453&country=us) · [ScreensDesign](https://screensdesign.com/apps/ladder-strength-training-plans/) · [GGR](https://www.garagegymreviews.com/ladder-app-review) · [Bustle](https://www.bustle.com/wellness/ladder-app-review) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1502936453/sortby=mostrecent/json) |
| Boostcamp | `$S/coached/boostcamp/boostcamp-1…6.jpg`, `sd-42.jpg`, `sd-47.jpg`, `sd-58.jpg`, `sd-79.jpg`, `sd-80.jpg`, `sd-137.jpg` | [App Store](https://apps.apple.com/us/app/boostcamp-gym-workout-fitness/id1529354455) · [Lookup](https://itunes.apple.com/lookup?id=1529354455&country=us) · [ScreensDesign](https://screensdesign.com/apps/boostcamp-gym-workout-fitness/) · [Tips](https://www.boostcamp.app/blogs/tips-and-tricks-to-using-boostcamp-app) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1529354455/sortby=mostrecent/json) |
| RP Hypertrophy | `$S/coached/rp/rp-1…8.jpg` (marketing only) | [Lookup](https://itunes.apple.com/lookup?id=1555614554&country=us) · [App Store](https://apps.apple.com/us/app/rp-hypertrophy/id1555614554) · [Reviews RSS](https://itunes.apple.com/us/rss/customerreviews/id=1555614554/sortby=mostrecent/json) · [Why no rest timer](https://help.rpstrength.com/hc/en-us/articles/30805293312407-Why-is-there-no-rest-timer) (title only; 403) · [rpstrength.com](https://rpstrength.com/rphypeapp) · [Trustpilot](https://www.trustpilot.com/review/renaissanceperiodization.com) |
| Apple Fitness+ | `$S/premium/applefitness/applefitness-1…5.jpg`, `applefitness-sd-foryou-strength.jpg`, `applefitness-sd-detail.jpg`, `applefitness-sd-detail-menu.jpg`, `applefitness-sd-stack.jpg` | [App Store GB](https://apps.apple.com/gb/app/apple-fitness/id1208224953) · [Lookup](https://itunes.apple.com/lookup?id=1208224953&country=gb) · [ScreensDesign](https://screensdesign.com/apps/apple-fitness/) · [Reviews RSS GB](https://itunes.apple.com/gb/rss/customerreviews/page=1/id=1208224953/sortby=mostrecent/json) |
| Nike Training Club | `$S/premium/ntc/ntc-1…8.jpg`, `ntc-sd-home.jpg`, `ntc-sd-detail.jpg`, `ntc-sd-workouts-tab.jpg`, `ntc-sd-music.jpg` | [App Store GB](https://apps.apple.com/gb/app/nike-training-club/id301521403) · [ScreensDesign](https://screensdesign.com/apps/nike-training-club-wellness/) · [Reviews RSS GB](https://itunes.apple.com/gb/rss/customerreviews/page=1/id=301521403/sortby=mostrecent/json) · [PressReader](https://www.pressreader.com/australia/techlife-australia/20200824/284301072293262) |
| Peloton | `$S/premium/peloton/peloton-1…7.jpg`, `peloton-sd-home.jpg`, `peloton-sd-home-plan.jpg`, `peloton-sd-class-detail.jpg`, `peloton-sd-class-plan.jpg`, `peloton-sd-gym-detail.jpg`, `peloton-sd-gym-plan.jpg`, `peloton-sd-body-activity.jpg` | [App Store GB](https://apps.apple.com/gb/app/peloton-fitness-workouts/id792750948) · [ScreensDesign](https://screensdesign.com/apps/peloton-fitness-workouts/) · Pelo Buddy [44659](https://www.pelobuddy.com/?p=44659), [9986](https://www.pelobuddy.com/?p=9986), [10431](https://www.pelobuddy.com/?p=10431), [45405](https://www.pelobuddy.com/?p=45405) · [Reviews RSS GB](https://itunes.apple.com/gb/rss/customerreviews/page=1/id=792750948/sortby=mostrecent/json) |
| Third Space | `$S/premium/thirdspace/thirdspace-1…5.jpg` (marketing only) | [App Store GB](https://apps.apple.com/gb/app/third-space/id1440461613) · [Lookup](https://itunes.apple.com/lookup?id=1706076679&entity=software&country=gb) · [Reviews RSS GB](https://itunes.apple.com/gb/rss/customerreviews/page=1/id=1440461613/sortby=mostrecent/json) · [On demand](https://thirdspace.london/on-demand) |
| StrongLifts 5x5 (critic) | `$S/critic/stronglifts/stronglifts-1…10.jpg`, montages `$S/critic/sl-a.jpg`, `sl-b.jpg` | [App Store](https://apps.apple.com/us/app/id488580022) · [Lookup](https://itunes.apple.com/lookup?id=488580022&country=us) |
| MacroFactor Workouts (critic) | `$S/critic/macrofactor/macrofactor-1…9.jpg`, montages `$S/critic/mf-a.jpg`, `mf-b.jpg` | [App Store](https://apps.apple.com/us/app/id6737156524) · [Lookup](https://itunes.apple.com/lookup?id=6737156524&country=us) |
| Hevy routine detail (critic) | `$S/critic/hevy/Img-7388-7389-7390-1.png`, crop `$S/critic/hevy-routine-detail.png` | [Gym routines feature page](https://www.hevyapp.com/features/gym-routines/) |
| Liftosaur rounding (critic) | — (text only) | [Equipment and gyms](https://www.liftosaur.com/features/equipment-and-gyms) · [Workout screen](https://www.liftosaur.com/features/workout-screen) |
| Centr | `$S/premium/centr/centr-1…9.jpg`, `centr-sd-home.jpg`, `centr-sd-home2.jpg`, `centr-sd-detail.jpg`, `centr-sd-prep.jpg`, `centr-sd-selfguided-detail-full.jpg`, `centr-sd-selfguided-list.jpg`, `centr-sd-log.jpg` | [App Store GB](https://apps.apple.com/gb/app/centr-personal-fitness-app/id1382530817) · [ScreensDesign](https://screensdesign.com/apps/centr-personal-fitness-app/) · [Tom's Guide](https://www.tomsguide.com/uk/reviews/i-used-thors-workout-app-for-a-month-heres-what-happened) · [Fit&Well](https://fitandwell.com/reviews/centr-review) · [TechRadar](https://www.techradar.com/health-fitness/fitness-apps/centr-review) · [Reviews RSS GB](https://itunes.apple.com/gb/rss/customerreviews/page=1/id=1382530817/sortby=mostrecent/json) |

**Limits.**
- Tap counts marked * were inferred from screen structure, not tested on a device.
- Several "real" captures (ScreensDesign) are blurred. Their labels were readable, but small numbers may be wrong.
- Reddit was not searched in this pass, so complaints come from App Store reviews and review sites. They are examples, not a survey.
- Gravl's full overview, Future's current preview and all of Third Space's workout flow were not seen. (Hevy's routine detail was filled in the critic pass.)
- StrongLifts and MacroFactor are covered from App Store frames only: no reviews pulled, no real in-app captures, tap counts inferred. MacroFactor's duration, supersets and Start placement are unknown.
- Still not covered: SmartGym, Setgraf, Gymshark Training, Fitify. They are smaller or less strength-log-focused, but SmartGym and Setgraf are iOS-native loggers worth a later look.
- The four rows added in the critic pass (programme position, upcoming sessions, plate breakdown, return-after-break) were filled only where a viewed screenshot or doc showed them; `?` is common there and means "not checked", not "absent".
