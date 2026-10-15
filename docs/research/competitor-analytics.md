# Competitor analytics: progress charts and stats

Written by the `competitor-researcher`, 11 Oct 2026, in reply to Ben's request for analytics: "1. frequency of sessions over last 7 / 14 / 30 / 60 days; 2. time in gym; 3. frequency of hitting each main muscle group (PPL etc); 4. 1RM estimate progression, max reps per weight etc; and more that you would expect from a gym app". This file goes with `competitor-landscape.md`, which covers the apps more broadly, and with `docs/design/progress.md` (v0.1, designed but not built). Today the Progress tab is only a list of past workouts (`apps/mobile/src/screens/ProgressScreen.tsx`).

## Summary

- **What everyone has:** per-exercise charts (top weight, e1RM, volume), PR lists, a calendar and body weight. Most also show sets per muscle (Hevy, MacroFactor, Liftosaur, Boostcamp, JEFIT). The common paywall is chart history: Strong charts are PRO-only, Alpha has "No charts" on free, and Hevy free is limited to 3 months.
- **Ben's four asks are covered by competitors, but no one app does all four the way he asked.** Rolling 7/14/30/60-day session counts aren't standard. Hevy uses 7 days, 30 days, 3 months and 1 year. Apple compares the last 7 days with the previous 28. Only Liftosaur documents push/pull/upper/lower splits. Rep-max tables exist in Strong, FitNotes, Hevy and Boostcamp.
- **The main failure modes are honesty failures (rule 6):** formulas that aren't disclosed or contradict each other, recovery percentages and population "strength scores", e1RM that rises when the lifts get lighter, workouts left running that log 70-hour or 299-minute sessions, and history from a different gym that makes progress look like a decline.
- **Recommendation:** build progress.md's exercise detail and records now that FitNotes import gives Ben real history. Add a small **Stats** screen for counts over 7/14/30/60 days, time in gym, sets per week for push/pull/legs, and a rep-record table. Every number must be computed from logs, and estimates must be labelled. Three of these need brief or design changes (see "Proposed brief changes").

## How to read this

- **Dates.** Every URL below was checked on **2026-10-11** unless another date is given.
- **Labels.**
  - **[Doc]** means vendor site, help, listing or changelog.
  - **[User]** means an App Store review.
  - **[Inference]** means my reading of the evidence.
  - Marketing claims are marked **(marketing)** where they go beyond what a help page or changelog shows.
- **Limits.**
  - Reddit is blocked to the crawler (the search tool returned an error for reddit.com), so the user evidence here is App Store reviews only.
  - help.hevyapp.com and help.fitbod.me returned 403.
  - RP Hypertrophy publishes nothing on analytics.
  - I couldn't see App Store screenshots as images; fetched listings return text only. Screenshot claims rely on the listing text and on third-party descriptions, and are marked as such.
  - Hands-on testing needs Ben.
- **Not documented ≠ absent.** "?" means I found no documentation.

## Capability matrix

Legend:
- **✓** documented and substantial.
- **partial** limited, paid-only or only partly documented.
- **✗** documented as absent.
- **?** not documented.
- **avoid** a feature the app has that GymSmarter shouldn't copy (rule 6).

Columns:
- **Freq**: session count or consistency.
- **Time**: time in gym.
- **Sets/musc**: sets per muscle.
- **Split**: push/pull/legs or body-part grouping.
- **Body map**: body diagram.
- **e1RM**: estimated 1RM chart, with its formula.
- **RM table**: best performance at each rep count.
- **PRs**: record types.
- **BW**: body weight.
- **Streak**: streak.
- **Cal**: calendar.
- **Recap**: weekly or monthly summary.
- **Export**: data export.
- **Scores**: recovery, strength or "level" scores.
- **Paywall**: what's paid.

| App | Freq | Time | Sets/musc | Split | Body map | e1RM | RM table | PRs | BW | Streak | Cal | Recap | Export | Scores | Paywall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Strong | ✓ [S1] | partial [S2] | ? | ? | ? | ✓ Brzycki [S3] | ✓ [S4] | ✓ | ✓ [S5] | ✓ weekly [S2] | ✓ [S2] | ? | ✓ CSV [S2] | ? | Charts PRO [S6] |
| Hevy | ✓ [H1] | ✓ [H1] | ✓ [H1] | partial (body parts) [H1] | ✓ sets [H1] | partial (formula not documented) [H2] | ✓ Set Records [H2] | ✓ 5 types [H2] | ✓ [H1] | ✓ weekly [H1] | ✓ [H1] | ✓ monthly, yearly [H3] | ? | avoid: Strength Level [H2] | 3-month limit on free [H1] |
| Fitbod | ✓ [F1] | ✓ [F1] | ? | ? | avoid: recovery % [F1][F2] | ✓ formula conflicting [F3] | ? | ✓ [F1] | ? | partial [F1] | ? | ✓ weekly, monthly [F1] | ? | avoid: Strength Score, mStrength [F3] | Subscription |
| Alpha Progression | ? | ? | partial [A2] | ? | ? | ✓ 10RM default, 1RM option [A1] | ? | ✓ [A3] | ✓ [A3] | ✓ [A3] | ? | ✓ reports [A3] | ✓ CSV, free [A3] | ✓ "strength rating" [A3] | "No charts" on free [A3] |
| Gravl | ? | ? | ? | ? | ? | ✓ [G1] | ? | ✓ per gym [G2] | ✓ measurements [G2] | ✓ [G2] | ? | ✓ monthly [G2] | ✓ [G2] | avoid: Strength Score vs standards [G2] | Subscription |
| JEFIT | ? | ? | partial [J1] | ? | ✓ BodyMap [J2] | partial [J1] | ? | ? | ? | ? | ? | ? | ? | avoid: recovery chart [J1] | Elite (third-party listing) [J1] |
| Liftosaur | ? | ? | ✓ helpers ×0.5 + target band [L1] | ✓ push/pull/upper/lower/core [L1] | ? | ? | ? | ? | ✓ [L2] | ? | ? | ? | ? | ✗ | ? |
| Boostcamp | partial (adherence) [B1] | ? | ✓ [B1] | ? | ✓ Pro [B1] | ✓ [B1] | partial (max weight per rep range) [B1] | ✓ 4 types [B1] | ? | ? | ? | ✓ Sunday report, Wrapped [B1] | ? | avoid: Strength Score (DOTS) Pro [B2] | Heatmap and score Pro [B1] |
| StrongLifts | ? | ? | ✗ | ✗ | ? | ✓ assumed-RPE, NA >12 reps [K1] | ? | ? | ✓ [K1] | ? | ? | ? | ? | partial: SBD Total [K1] | Pay to use [K2] |
| RP Hypertrophy | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | $34.99/mo [R1] |
| MacroFactor Workouts | partial (weekly rings) [M3] | ✗ only time estimates [M5] | ✓ Levels [M2] | ? | ✓ Levels body map [M2] | ✓ 1/3/10RM (formula not documented) [M1] | partial (3RM/10RM lines) [M1] | partial (best-set metrics) [M1] | ? | ? | ? | partial (monthly recaps) [M1] | ? | ✗ | Subscription |
| Apple Fitness | partial [P1] | ✓ duration, Trends [P2] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ Health | ✗ (rings) | ✓ history | ✗ | Health | avoid: Training Load needs effort input [P1] | Free |
| FitNotes (Ben's current app) | ✓ Stats tab [N1] | ? | ? | partial body part [N2] | ✗ | ✓ user rep cap [N1] | ✓ actual + estimated 2–15RM [N1] | ✓ | ✓ separate Body Tracker [N3] | ? | ✓ [N1] | partial custom periods [N1] | ✓ CSV [N3] | ✗ | Free |
| **GymSmarter** | designed: this week + 4 weeks [D1] | designed per day only [D2] | designed, ½ helpers [D1] | **not designed** | **not designed** | designed: Epley, ≤10 reps, labelled [D1] | partial: "Reps at load" chart [D1] | designed: 3 types [D1] | **not recorded** [D1] | designed weekly [D1] | designed [D1] | designed: week review [D1] | built (backup); analytics CSV not designed | ✗ by rule (progress.md §1) | n/a |

**Footnotes.** All were checked on 2026-10-11.

- **[S1]** Strong help, "About Profile Widgets": a Workouts Per Week widget with a goal setting. https://help.strongapp.io/article/239-profile-widgets
- **[S2]** Strong GB listing, release notes. https://apps.apple.com/gb/app/strong-workout-tracker-gym-log/id464254577
  - 6.4.1 (9 Jun): Calendar widget with "monthly workouts and weekly streaks", and an Activity widget.
  - 6.4.3 (23 Jul): a "Week of Year" label for Workouts Per Week.
  - 6.5.1 fixed the calendar widget for zero-minute workouts. [Inference] So Strong stores workout duration. I found no total-time stat.
  - 6.2.0–6.2.3: CSV export, including measurements.
  - [User] Roland 1220 (2019): "does not keep track of the total time you have worked out" (old).
- **[S3]** Strong help: "We use the Brzycki formula"; above 12 reps, "1RM estimations will break down significantly". https://help.strongapp.io/article/133-1rm
- **[S4]** Strong help, Records screen: "real world best performances for a given lift, alongside the 'predicted' or theoretical best lift for each rep value". Limited to sets of 12 reps or fewer. https://help.strongapp.io/article/216-exercise-records-screen
- **[S5]** Strong listing: measurements, with Apple Health.
- **[S6]** Strong help, Exercise Detail: the Charts tab is "Strong PRO only". History and Records are tabs with no PRO marker. https://help.strongapp.io/article/237-about-exercise-detail
- **[H1]** Hevy, gym progress page. https://www.hevyapp.com/features/gym-progress/
  - Last 7 days body graph.
  - Set count per muscle group: weekly or monthly, over 30 days, 3 months or 1 year.
  - Muscle distribution as a chart with workouts, duration, volume and sets, and a body view.
  - Body measurements and photos.
  - Calendar with a streak of "consecutive weeks with at least one logged session".
  - Free graphs cover the last 3 months; Pro unlocks 1 year and all time.
  - **Conflict:** a search-result summary of Hevy's help centre (the page itself returned 403) lists set count per muscle as Pro, while this page says free is limited to 3 months. Unverified.
- **[H2]** Hevy, gym performance page. https://www.hevyapp.com/features/gym-performance/
  - Exercise summary: heaviest weight, "projected or true 1RM", best set volume, best session volume, most reps.
  - Set Records: "most weight lifted for specific rep targets".
  - Strength Level: Beginner to Elite against lifters of a similar age, weight and sex.
  - The formula isn't stated.
- **[H3]** Hevy, monthly report: workouts, time, volume and sets against earlier months; the month's PRs; workout days; volume by body part; muscles trained with set counts; top exercises; sharing. A Year in Review is similar. https://www.hevyapp.com/features/monthly-report/
- **[F1]** Fitbod, Insights (published 17 Sep 2026). https://fitbod.me/blog/fitbod-insights-feature/
  - e1RM charts for SQ/DL/BP/OHP, Strength Score and mStrength.
  - Muscle recovery heat map, 0–100%, which users can edit.
  - Workout Report: total workouts compared with the previous period, total duration, week/month/6-month/year filters, weekly and monthly emails.
  - "25% more likely to keep a consistent streak" (marketing).
- **[F2]** Fitbod help: muscles are treated as fully recovered after 6 days unless other factors apply. https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery (search snippet; the page returned 403).
- **[F3]** **Conflict:** Fitbod's blog says e1RM comes from equations "such as the Epley formula", while its Strength Tester FAQ gives Brzycki. https://fitbod.me/blog/fitbod-algorithm, https://fitbod.me/strength-tester
  - The help centre (search snippet, 403) says "Estimated Strength" was formerly "Projected 1-Rep Max", and that a Strength Score needs ≥ 3 workouts. https://help.fitbod.me/hc/en-us/articles/12732749777047
  - The "2.8% margin" accuracy claim is marketing and unverified.
- **[A1]** Alpha glossary: the default performance metric is 10RM; a setting (v4.9, per the APKMirror changelog) switches it to 1RM or volume. https://alphaprogression.com/en/glossary/1rm, https://alphaprogression.com/en/glossary/10rm
- **[A2]** Alpha. https://apps.apple.com/us/app/alpha-progression-gym-log/id1462277793?see-all=reviews
  - [User] Jsinkwitz (10 Jul 2024): "muscle group volume and load PRs".
  - I found no doc for a per-muscle chart.
- **[A3]** Alpha site. https://alphaprogression.com/en
  - "Charts for weight, strength rating, volume", PRs, streaks, achievements, training reports and CSV export.
  - Free: "No charts"; Pro: "Detailed progress charts".
- **[G1]** Gravl blog (16 Jul 2026, via the landscape): e1RM from every set.
- **[G2]** Gravl GB listing. https://apps.apple.com/gb/app/id6450921637
  - A Strength Score compared against "standards for your body weight and sex".
  - Records and 1RMs are kept per gym.
  - History export (1.44), streak rewards (1.47.1), measurement trends (1.52), exercise analytics (1.53, 26 Sep).
  - Monthly stats.
  - Price: £14.99/month, or £52.00–£69.99/year.
- **[J1]** JEFIT, third-party listing summary (not vendor-verified): weekly sets per muscle, a recovery chart, and automatic 1RM. "Premium Analytics" sits in Elite ($12.99/mo or $69.99/yr). https://www.stork.ai/en/jefit
- **[J2]** JEFIT blog (20 Nov 2025): BodyMap "visually displays muscle growth over time" (marketing; [Inference] it most likely displays training, not growth). https://www.jefit.com/blog/how-to-use-jefit-analytics-to-track-workout-progress-and-unlock-winter-gains
- **[L1]** Liftosaur overview, Week Stats. https://www.liftosaur.com/blog/posts/liftosaur-overview/
  - Total sets split into strength and hypertrophy (8+ reps).
  - Sets split across core, upper, lower, push and pull.
  - Weekly sets per muscle, coloured against a target range, with direct and synergist exercises listed.
  - "Synergist sets count at a default multiplier of 0.5", editable.
  - This is in the web editor; I didn't confirm it in the app.
- **[L2]** Liftosaur listing: "Graphs of exercises, bodyweight, volume per muscle group". https://apps.apple.com/app/id1661880849
- **[B1]** Boostcamp tracker page. https://www.boostcamp.app/workout-tracker
  - PRs: "max weight per rep range, max volume per session, max reps at a given weight, and lifetime bests".
  - An e1RM curve "calculated from every top set"; the formula isn't stated.
  - Per-muscle heatmap (Pro) over 7, 30, 90 days and 1 year.
  - Sunday weekly report: PRs, volume by muscle, adherence and the week's workouts. Year-end Wrapped.
  - **Conflict:** another Boostcamp page says the heatmap lights up "by intensity" rather than by volume.
- **[B2]** Boostcamp Pro: a 0–100 Strength Score from SQ/BP/DL/OHP/rows, adjusted for body weight with IPF DOTS. https://boostcamp.app/pro
- **[K1]** StrongLifts help, "Progress Graphs": exercise graphs, body weight, SBD Total, and an e1RM toggle. https://support.stronglifts.com/article/89-graphs
  - e1RM assumes RPE 8 when the sets were completed and RPE 10 for failed sets or singles.
  - It shows "NA" over 12 reps.
- **[K2]** StrongLifts GB listing: "requires a subscription to use"; Pro is £10.99/month or £54.99/year. https://apps.apple.com/gb/app/stronglifts-weight-lifting-log/id488580022
- **[R1]** RP Hypertrophy app page: no analytics described. It logs pump, soreness and joint feedback. $34.99/month, or $299.99/year. https://rpstrength.com/pages/hypertrophy-app
- **[M1]** MacroFactor help. https://help.macrofactorapp.com/en/articles/344-viewing-exercise-performance-over-time, https://help.macrofactorapp.com/en/articles/334-seeing-detailed-stats-and-data-for-each-exercise
  - Per exercise: e1RM at 1, 3 and 10 reps, total volume, best set volume, heaviest weight, total reps, best set reps, total sets.
  - Monthly recaps. The formula isn't stated.
- **[M2]** MacroFactor help, "Understanding Levels": a body diagram of "the average number of sets per week for a muscle group over the selected time period"; "Levels only reflect logged training … not … load, intensity, or effort". Tapping a muscle shows the lifts that count towards it (April 2026). https://help.macrofactorapp.com/en/articles/342-understanding-levels, https://macrofactor.com/mm-april-2026/
- **[M3]** MacroFactor help, dashboard widgets: weekly target rings for muscles, sets and exercises. https://help.macrofactorapp.com/en/articles/276-understanding-the-widgets-at-the-top-of-the-workouts-dashboard
- **[M5]** [User] "Lots of current issues, all fixable" (12 Jun): a 45-minute leg routine was estimated at 14 minutes. https://apps.apple.com/us/app/macrofactor-workouts-tracker/id6737156524?see-all=reviews
- **[P1]** Apple Support, Training Load. https://support.apple.com/guide/watch/track-your-training-load-apde4c07a6cf/watchos
  - It compares the last 7 days with the previous 28: "well below … well above".
  - Strength workouts need a manual 1–10 effort rating. https://www.apple.com/newsroom/2024/06/watchos-11-brings-powerful-health-and-fitness-insights/
- **[P2]** Apple Support, Trends: the 90-day average against 365 days, shown after 6 months of data. https://support.apple.com/HT205406
- **[N1]** FitNotes progress tracking. http://www.fitnotesapp.com/progress_tracking/
  - Graphs: e1RM, max weight, volume, total reps, max reps, weight and reps at a chosen rep count, rep maxes over time.
  - Records: Actual is the heaviest weight at each rep count, and "a higher rep-count with an equal or greater weight supersedes lower ones". Estimated covers 2RM–15RM from the best e1RM.
  - There is a rep cap setting ("10-12 reps is typically reasonable").
  - The Stats tab covers workout, week, month, year, all time or a custom period.
- **[N2]** FitNotes site: "a breakdown by body part" (via the landscape). https://getfitnotes.com/
- **[N3]** `docs/research/fitnotes-export-format.md`: the CSV is date-only with no times, and body weight is a separate Body Tracker CSV.
- **[D1]** `docs/design/progress.md`: PG2, PG6–PG11, PG17, §2.2–2.3 and the record lines (line 698). The `Exercise` schema has optional `secondaryMuscles` and a free-text `movementPattern` (`packages/schemas/src/exercise.ts:81-84`).
- **[D2]** progress.md, Calendar day list: `18:02–19:04 · 54 min · 16 working sets`. Sessions store `startedAtUtc` and nullable `endedAtUtc` (`packages/schemas/src/session.ts:524-542`).

## Per-app notes (analytics only)

Prices, platforms and the general verdicts are in `competitor-landscape.md`. Only what matters for analytics is here.

### Strong
- **[Doc]** The strongest **rep-record table** in the set. It shows actual bests next to "predicted" values, capped at 12 reps, with Brzycki named [S3][S4].
- **[Doc]** It has a consistency widget with a weekly goal [S1], weekly streaks on a calendar widget, and CSV export [S2].
- **[Doc]** Charts are PRO-only [S6].
- **Meaning for GymSmarter:**
  - **Copy:** a rep-record table, and naming the formula and the rep cap.
  - **Do better:** no paywall, and actual and estimated values in separate, labelled columns (Strong mixes them: "if an actual performance beats the predicted value, the actual performance appears in that column").

### Hevy
- **[Doc]** The broadest free stats.
  - Muscle distribution with workouts, **duration**, volume and sets per period, compared with the previous period.
  - Set count per muscle, weekly or monthly.
  - A body diagram of sets.
  - Five PR types and Set Records (best at each rep target).
  - A weekly streak.
  - A monthly report, a year in review, and body measurements [H1–H3].
- **[Doc]** Strength Level compares Ben to other users by age, weight and sex [H2].
- **[User]** People praise the graphs and "breakdowns by body part" (Organic Mel, 26 Jul 2025; 69burner69, 23 Dec 2024). One user says bodyweight squats add nothing to total volume (Organic Mel). https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews
- **Meaning for GymSmarter:**
  - **Copy:** time and session counts compared with the previous period, a weekly streak (already PG17), and a monthly recap.
  - **Avoid:** population strength levels (they need body weight and a population dataset GymSmarter doesn't have; rule 6) and social sharing (personal-use scope).
  - **Do better:** show the counting method; Hevy doesn't document how secondary muscles count [H1].

### Fitbod
- **[Doc]** Workout Report: workouts compared with the previous period, total duration, and ranges from a week to a year.
- **[Doc]** e1RM charts for 4 lifts.
- **[Doc]** It shows a muscle recovery % heat map, built on a 6-day full-recovery assumption [F1][F2].
- **[Doc]** The formula sources contradict each other [F3].
- **[User]**
  - Apple Fitness logged a 1-hour workout as 299 minutes (chialikeishallgrow, 30 Jun 2024).
  - A user asked for "a tab … to locate your personal records" (alexander .d, 9 Dec 2024).
  - A user who came back from injury couldn't progress against old numbers (Ann2976, 7 Jan 2025).
  - https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543?see-all=reviews
- **Meaning for GymSmarter:**
  - **Avoid:** recovery percentages (progress.md §1 already bans them).
  - **Copy:** one Records screen.
  - **Do better:** session times that are editable and checked for plausibility; pre-flag reference values after pain (already PG22).

### Alpha Progression
- **[Doc]** It uses 10RM as the default strength metric, with a 1RM option [A1].
- **[Doc]** Charts are Pro-only, while CSV export is free [A3].
- **[Doc]** Its glossary warns that volume "rewards" high-rep, low-weight sets [A1].
- **[User]**
  - After a gym switch, history from a different machine made progress look like a decline (Travisharger, 4 Jan).
  - A user asked for 1RM alongside 10RM (AmbassadorJoeM, 27 Mar 2024).
  - https://apps.apple.com/us/app/alpha-progression-gym-log/id1462277793?see-all=reviews
- **Meaning for GymSmarter:**
  - **Confirms** progress.md's one series per equipment instance (PG15).
  - **Consider** an "estimated reps at a chosen load" view as an alternative to 1RM for hypertrophy ranges (the "Reps at load" chart already covers the actual version).

### Gravl
- **[Doc]** Records and 1RMs are kept per gym.
- **[Doc]** It has a Strength Score against body weight and sex standards, streak rewards, a monthly review and history export [G2].
- **Meaning for GymSmarter:**
  - **Copy:** keeping results per gym.
  - **Avoid:** standards-based scores.

### JEFIT
- **[Doc]** BodyMap and a muscle recovery chart; analytics are mostly in Elite [J1][J2] (third-party listing).
- **[User]**
  - A workout that wasn't ended logged "the ENTIRE TIME since you last opened the app", giving 70+ hour workouts (2019).
  - "No easy and intuitive way to see my weight progress on one specific exercise in a clear linear graph" (2020).
  - The body map's selected colour is hard to see (25 Jul, year not shown).
  - https://apps.apple.com/us/app/jefit-workout-plan-gym-tracker/id449810000?see-all=reviews
- **Meaning for GymSmarter:**
  - **Do better:** limit and flag long durations, and keep a plain one-line chart for each exercise (TrendChart already does this).
  - **Never use colour alone** (design-system rule).

### Liftosaur
- **[Doc]** The only app that documents **push/pull/upper/lower/core** set categories and a strength/hypertrophy split by reps.
- **[Doc]** Per-muscle weekly sets use a **0.5 multiplier for synergists** and an editable target band, and list contributing exercises split into direct and synergist [L1].
- **Meaning for GymSmarter:**
  - **Closest match** to Ben's "PPL" ask and to progress.md's ½-helper method (PG8).
  - **Copy:** the category split and "what counted" lists (progress.md already has the expand).

### Boostcamp
- **[Doc]** Four PR types, including max reps at a given weight. An e1RM curve from top sets.
- **[Doc]** A Sunday report with PRs, volume by muscle and adherence; a Pro heatmap over 7, 30 and 90 days and 1 year; a Pro Strength Score using DOTS [B1][B2].
- **[Doc]** It describes the heatmap basis inconsistently ("volume" vs "intensity").
- **Meaning for GymSmarter:**
  - **Copy:** a weekly report of facts (the progress.md week review already does this) and 7/30/90-day windows.
  - **Avoid:** DOTS scores.

### StrongLifts
- **[Doc]** e1RM uses an *assumed* RPE (8 if the sets were completed, 10 if they failed) and shows NA above 12 reps. It also has an SBD Total and body weight on the graphs [K1].
- **[Inference]** Assuming an RPE is a mild form of invented data.
- **Meaning for GymSmarter:** if GymSmarter ever uses RPE in e1RM, use only RPE Ben actually entered, and label it.

### RP Hypertrophy
- **[Doc]** No analytics are documented. Its value is in pump, soreness and joint feedback driving set changes [R1].
- **Meaning for GymSmarter:** nothing to copy for charts.

### MacroFactor Workouts
- **[Doc]** Levels: the average weekly sets per muscle on a body map, explicitly "not load, intensity, or effort", with contributing lifts.
- **[Doc]** Per exercise: 1RM, 3RM and 10RM estimates, best set volume, heaviest weight, best set reps and totals [M1][M2].
- **[User]**
  - "Appears to use some weird rolling window algo to calculate 1rm instead of discrete logged sets", so the e1RM rises when the lifts get lighter.
  - "Easily see number of sets per muscle per week" is praised.
  - Time estimates are "wildly inaccurate" [M5].
- **Meaning for GymSmarter:**
  - **Copy:** the honest caveat wording (behind "Why?") and the contributing-lifts list.
  - **Do better:** one e1RM per session, taken from that session's best eligible set (PG11), never smoothed.
  - **Show only actual elapsed time,** never an estimate presented as a result.

### Apple Fitness
- **[Doc]** It shows duration and exercise minutes. Trends compares the 90-day average with 365 days [P2]. Training Load compares the last 7 days with the previous 28, and strength needs a manual effort rating [P1]. It has no sets, reps or muscles.
- **Meaning for GymSmarter:**
  - **Copy:** the "recent window vs earlier baseline" framing for session counts, and plain counts.
  - **Avoid:** a load score built from effort ratings (rule 6, progress.md §1).

### FitNotes (Ben's baseline)
- **[Doc]** The richest per-exercise view [N1].
  - Graphs of e1RM, max weight, volume, reps, weight at a chosen rep count, and rep maxes over time.
  - An actual rep-max table with the superseding rule, plus estimated 2–15RM.
  - A user-set rep cap.
  - A Stats tab over custom periods.
- **[Inference]** These are the analytics Ben is used to losing if he switches. Matching FitNotes' per-exercise depth is the minimum bar.
- **[Doc]** Imported FitNotes workouts have **no times** [N3], so imported history can't contribute to time in gym.

## What users praise and complain about (across apps)

User evidence is App Store reviews only, because Reddit isn't reachable. These are examples, not a survey.

**Praised:**
- Charts of strength over time:
  - [Hevy, 69burner69]: "The graphs to track different kinds of progress are incredible".
  - [Strong, jasonw754, 2020]: "tracking my progress in chart form so I know when to start trying for higher weights".
- Sets per muscle per week:
  - [Hevy, Zacck, 2025].
  - [MacroFactor, 12 Jun]: "Easily see number of sets per muscle per week".
  - [Alpha, Jsinkwitz, 2024]: "muscle group volume and load PRs".
  - [JEFIT, 2022]: "a detailed break of how much your working each muscle".
- The PR moment:
  - [Hevy]: "my phone vibrates because I've said a personal record".
  - [Strong, Coolio-J, 2022].

**Complained about:**

| Complaint | Examples | GymSmarter answer |
|---|---|---|
| Durations wrong when a workout is left open | JEFIT "70+ hour" workouts (2019); Fitbod 1 h logged as 299 min (2024) | Time stats use editable start/end times (`updateSessionTiming`). Over a plausibility cap, the session is left out of time stats until confirmed (rec 4) |
| e1RM moves the wrong way or is opaque | MacroFactor's rolling window (12 Jun); Fitbod's formula conflicts [F3]; Strong and Hevy formulas not shown or hidden | One value per session from discrete sets; formula and rep cap behind "Why?"; always labelled "Est." (PG11) |
| A gym or machine change looks like regression | Alpha (Travisharger, 4 Jan) | Series per equipment instance (PG15); gym shown on every chart |
| No single place for PRs | Fitbod (alexander .d, 2024) | A Records list (rec 5) |
| Chart unclear | JEFIT (2020): "graph makes no sense" | One series, one line, a table toggle (TrendChart) |
| Paywalled history | Strong charts PRO [S6]; Alpha "No charts" [A3]; Hevy 3 months [H1] | n/a (personal app); all-time ranges by default |
| Bodyweight work missing from volume | Hevy (Organic Mel, 2025) | Show bodyweight sets as sets and reps, never as invented kg (body weight isn't recorded) |
| Injury reset | Fitbod (Ann2976, 2025) | PG22 pre-flag reference (designed) |

## Opportunities for GymSmarter (ranked)

Ranked by Ben's explicit asks first, then by evidence strength. Effort: S ≤ 1 slice, M 1–2 slices, L more.

**Where it fits the build order:** Progress isn't a numbered step in brief §10. FitNotes import (step 3) has now landed through review r8, so real history exists to chart. [Inference] Slot analytics in as a vertical slice before or alongside step 4 (coach), because the coach's context builder and the week review reuse the same pure domain functions.

1. **Stats screen: sessions over 7/14/30/60 days** (Ben's ask 1). **Effort S.**
   - Counts of finished workouts in each rolling window, each compared with the window before it (`6 · previous 14 days: 5`), plus the average per week over 60 days.
   - Imported sessions count, because their dates are real.
   - **Evidence:** Hevy compares with the previous period [H1]; Fitbod compares workouts [F1]; Apple uses 7 vs 28 days [P1]; Strong has workouts per week with a goal [S1].
   - **Rules:** rule 6 (counts only, no score); the minimal-copy rule.
   - **Design:** a pushed `Stats` screen from the `This week` card, so the home order (PG2) is unchanged.
2. **Exercise detail with the e1RM chart and a rep-record table** (Ben's ask 4). **Effort M.**
   - Build progress.md §2.3 as designed: Top set, Reps at load, Est. 1RM, Volume.
   - Add a **Rep records** table: for 1–12 reps, the heaviest *actual* load for that series, with the date, using FitNotes' superseding rule (100 kg × 6 also counts as the 5RM), shown as `from 6 reps`.
   - An optional `Est.` column, behind a toggle and always labelled, uses the same Epley rule and ≤ 10-rep cap.
   - Flagged sets are excluded (PG21).
   - **Evidence:** Strong [S4], FitNotes [N1], Hevy [H2], Boostcamp [B1]; the e1RM complaints [M5].
   - **Rules:** rule 6 and brief §3 ("Label estimated 1RM as an estimate and compare like-for-like").
3. **Muscle and split frequency** (Ben's ask 3). **Effort M.**
   - Build the designed `Sets per muscle` (PG4–PG8).
   - Add a **Split** view: hard sets and **days trained** per week for Push / Pull / Legs / Core (Upper/Lower as an alternative grouping).
   - Add "days hit" per muscle, because frequency is what Ben asked for, not only sets.
   - The mapping comes from catalogue data (a fixed `split` tag per exercise or a fixed `movementPattern` → split table), never inferred at runtime.
   - Helpers count ½ (Liftosaur's default [L1]; E1 in the training guides).
   - **Needs:** `secondaryMuscles` filled across the catalogue and a fixed muscle and split vocabulary (PG8, exercise-researcher).
   - **Evidence:** Liftosaur [L1], Hevy [H1], MacroFactor [M2], plus user praise.
   - **Rule:** rule 10 (the mapping is Coaching knowledge).
4. **Time in gym** (Ben's ask 2). **Effort S.**
   - Per window: total time and the **median** session (median, so one left-open session can't distort it), from `startedAtUtc`–`endedAtUtc`.
   - Sessions without an end time and imported date-only sessions are left out, with a count (`Excludes 40 imported (no times)`).
   - Sessions over a cap (for example 4 h, a domain constant) are left out until Ben confirms or edits them.
   - **Evidence:** Hevy and Fitbod show duration [H1][F1]; the JEFIT and Fitbod duration bugs.
   - **Rules:** rule 6 (no invented times; fitnotes-export-format rec 6).
5. **One Records list.** **Effort S.**
   - All records per series: heaviest set, most reps at a load, best estimated 1RM (labelled), longest hold, and assisted "least assistance".
   - Filter by exercise; newest first.
   - Uses the designed PG10 threshold (≥ 3 earlier sessions) so imports don't flood it.
   - **Evidence:** the Fitbod complaint; Hevy, Strong and Boostcamp PR types.
   - **Rule:** rule 6.
6. **Monthly recap** (facts only). **Effort M.**
   - Workouts, time, working sets, sets by split, records, and the change against the previous month.
   - Deterministic, and shown inside Calendar or Stats. The coach may add an observation under PG19's checked-numbers rule.
   - **Evidence:** Hevy [H3], Fitbod [F1], Boostcamp [B1].
   - **Brief:** §12 "three factual observations" pattern.
7. **Body weight log (manual), read from Apple Health later.** **Effort M.**
   - Enables a body-weight chart and honest e1RM for bodyweight + added load, which PG11 currently blocks.
   - **Evidence:** Strong, Hevy, StrongLifts, Liftosaur, Alpha and FitNotes all have it.
   - **Brief change needed:** this is new owner data.
8. **Body map of weekly sets.** **Effort M.**
   - Reuse the guide figure's muscle highlighting (ADR 0014) to show *sets*, with numbers and a table alternative.
   - Never recovery, readiness or "growth".
   - **Evidence:** Hevy, MacroFactor and Boostcamp; the JEFIT colour complaint.
   - **Rules:** rule 6, and progress.md §1 bans recovery scores.
9. **Extra per-exercise metrics.** **Effort S.**
   - Best set reps, total sets and total reps per range (MacroFactor [M1], FitNotes [N1]).
   - Leave out "best set volume" as a headline record: it rewards high reps [A1].
10. **Workouts-per-week home-screen widget.** **Effort L.**
    - Strong has one [S1][S2].
    - Blocked until the App Group works under SideStore (`docs/device-tests/2026-10-08-probe-build7.md`).
    - The brief says to keep only widgets Ben uses after two weeks.

**Don't build (rule 6 or scope):**
- Recovery or readiness percentages (Fitbod, JEFIT).
- Population strength levels or scores (Hevy, Gravl, Boostcamp DOTS, Alpha's "strength rating").
- Load scores built from effort (Apple Training Load).
- e1RM with an assumed RPE (StrongLifts) or a smoothed rolling window (MacroFactor).
- Daily streaks and "lost streak" messages (PG17).
- Social sharing and comparisons with friends.
- Estimated workout durations shown as results.

## Proposed brief changes (for Ben to approve)

1. **Brief §12 Page 6** says "Do not turn this into an exhaustive daily analytics dashboard." Ben has now asked for analytics.
   - **Proposal:** keep the Progress home calm (PG2 unchanged), and add a pushed **Stats** screen covering:
     - session counts over 7/14/30/60 days;
     - time in gym;
     - the push/pull/legs/core split with days per week;
     - records;
     - a monthly recap.
   - Still no scores, rings or animation.
2. **Body weight as optional owner data** (rec 7).
   - Manual entries are stored as "Your data" (rule 10).
   - Reading from HealthKit later goes behind its runtime capability flag.
   - The data model gains a `BodyWeightEntry`.
3. **A split vocabulary in the catalogue** (rec 3): a fixed `split` tag (`push | pull | legs | core | other`) per exercise, and `secondaryMuscles` required for compounds. This is Coaching knowledge; it touches `packages/schemas` and `packages/catalogue` (progress.md PG8 already flags it).
4. **Time-in-gym rules** (rec 4):
   - leave out imported and open-ended sessions, and say how many;
   - use the median rather than the mean for a typical session;
   - add a plausibility cap as a domain constant.

   This is a design and domain change for the designer to fold into progress.md.

No change to CLAUDE.md is needed. Everything above follows rules 6, 9 and 10 and the minimal-copy convention. Explanations such as formulas, caps and exclusions go behind "Why?".
