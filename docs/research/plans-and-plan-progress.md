# Multi-day plans and progress vs plan

Status: research, 18 Oct 2026 (all URLs checked that day). It extends [competitor-landscape.md](competitor-landscape.md). Read it with [weekly-plan.md](../design/weekly-plan.md): under **D19**, lifting follows a rotation, not dates, so lifting has no "missed". Tags: **[Doc]** vendor or help docs · **[User]** anecdote · **[Inf]** my inference. Several help centres (RP, TrainingPeaks strength, Hevy help) returned 403. For those, claims rest on search snippets and are marked (snippet).

## Comparison

| App | How the plan is built and shown | How it adapts | What "progress vs plan" looks like |
|---|---|---|---|
| RP Hypertrophy | Mesocycle builder plus 45+ premade plans ([GB listing](https://apps.apple.com/gb/app/id1555614554)); deload auto-placed in the last week and moves if the meso length changes ([help](https://help.rpstrength.com/hc/en-us/articles/33510413024279-Does-the-app-automatically-place-deloads), snippet) | Pump, soreness and workload ratings set next week's sets; load rises a few % a week, reps rise if the jump is too big for the equipment ([help](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets), snippet) | Weekly weight and rep targets. A reviewer asked for long-term progress charts, and the developer acknowledged it (listing) |
| JuggernautAI | Individual blocks (hypertrophy, strength, peaking); Ben picks days a week and the app places lifts. 3.0 adds a **Full Block View** of past and upcoming weeks ([listing](https://apps.apple.com/us/app/-/id1515756471)) | Pre-session readiness, intra-session RPE, end-of-week and end-of-block check-ins ([help](https://help.jtsstrength.com/en/articles/3-how-juggernautai-is-individualized-to-you)) | Block view, charts, calendar, habit tracker, and a **0–100 readiness score** (listing) |
| Alpha Progression | Plan generator (split, exercises, sets, reps) around gym equipment; sets and RIR ramp week by week; scheduled deloads (Pro, $12.99/mo or $79.99/yr) ([listing](https://apps.apple.com/us/app/gym-workout-alpha-progression/id1462277793)) | Progression recommendations | Sets per muscle; volume and load PRs per muscle group (listing, [User] review) |
| Hevy Trainer (Pro) | Built from frequency and session length; each workout shows exercise count, estimated time and a preview ([Hevy](https://www.hevyapp.com/features/workout-plan-generator/)) | Double progression; a swap asks "permanent or just this session" (same page) | **Progress Report**: week-to-week consistency, sets completed, volume load, lifts progressing or maintaining, sets per body part **green when in the recommended range** |
| Strong | Templates only; no scheduled programme ([GGR](https://www.garagegymreviews.com/equipment/strong)) | None | History only |
| Boostcamp | Library programmes, reschedulable ([site](https://www.boostcamp.app/workout-tracker)) | Fixed programme rules | Sunday report lists workouts done, PRs and sets per muscle. It doesn't compare them with the programme: "check whether the workout count matches what your program asked for" ([report](https://www.boostcamp.app/features/weekly-report)) |
| Fitbod | Generates each session; a "More Consistent" setting keeps about 70–80% of exercises week to week ([Alpha's comparison](https://alphaprogression.com/en/blog/alpha-progression-vs-fitbod)) | After a break, log actuals and it re-learns ([help](https://help.fitbod.me/hc/en-us/articles/34320813009431-Took-a-Break-Here-s-How-to-Recalibrate-Your-Fitbod-Recommendations)) | No plan to compare against |
| Dr. Muscle | Programme selection | Auto-deload on a plateau (−50% sets, −10% load) ([deload](https://dr-muscle.com/deload/)); after a break, a **Light session** option with "return to Normal" ([update, 10 Oct 2026](https://dr-muscle.com/new-dr-muscle-x-2026/)) | Exercise summary vs last workout; a workout summary of lifts, records, streak and volume (same) |
| Caliber / Future / Ladder (human coaches) | Coach writes the week; Future's week is visible by Sunday ([Healthline](https://www.healthline.com/nutrition/future-fitness-review)) | The coach rewrites next week from what was and wasn't done (same) | A human weekly review; Caliber's "Strength Score" ([listing](https://apps.apple.com/app/id1482405410)) |
| TrainingPeaks | Calendar of planned workouts | Coach-led | **Compliance colours**: green ±20% of planned, yellow 50–79% or 121–150%, orange >50% off, red not done, grey unplanned. Strength is compared by **sets** ([help](https://help.trainingpeaks.com/hc/en-us/articles/204861204), snippet; [strength](https://help.trainingpeaks.com/hc/en-us/articles/27972623640333-Reviewing-Your-Athletes-Logged-Strength-Sessions), snippet) |
| Runna | Dated plan; drag and drop within the week; Skip ([help](https://support.runna.com/en/articles/15012850-how-and-when-to-skip-a-run-managing-missed-sessions-in-your-training-plan)) | **Plan Realignment** after more than 3 missed workouts or a missed week: skip, move later, extend, or rebuild to the same end date. It "can't be reversed" ([help](https://support.runna.com/en/articles/10026375-how-to-use-the-plan-realignment-feature)) | Ticks per session; "Mileage Insights" on plan-following ([IT Brief](https://itbrief.co.nz/story/runna-revamps-beginner-plans-with-flexible-guidance)) |
| Garmin Coach | Dated endurance plans | "If you miss a workout, your plan will keep you on track" ([blog](https://www.garmin.com/en-GB/blog/?p=12369)) | Calendar ticks |

## Patterns that work [Inf, from the evidence above]

- **Counts beat scores.** The useful views are plain numbers: sessions done against the aim (Hevy, Boostcamp), sets done against planned (TrainingPeaks strength), and targets hit per lift (RP, Hevy "progressing/maintaining").
- **One block view** with past results and upcoming targets in the same grid (JuggernautAI 3.0 Full Block View).
- **Scope on every change**: "this session or permanent" (Hevy).
- **Return-after-break as a choice**, not a silent change (Dr. Muscle Light/Normal; Runna realignment options).
- **Review at the end of the block**, not every day (JuggernautAI end-of-block check-in; Future and Caliber weekly human reviews).

## Pitfalls

- **Colour-only compliance on the wrong metric.** TrainingPeaks colours by TSS, duration or distance first. Its own docs show a recovery ride that became a 3-hour ride still turning green ([help](https://help.trainingpeaks.com/hc/en-us/articles/208916857-How-to-Analyze-a-file-in-TrainingPeaks), snippet).
- **Irreversible re-plans.** Runna's realignment can't be undone (above). Breaks rule 2 if copied.
- **Calendar rigidity.** [User] a Garmin plan wouldn't let a runner reschedule a missed long run ([forum](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/400635/reschedule-a-missed-workout-in-garmin-coach-plan/1883220)). An r/RPHypertrophy thread title asks whether days can't be changed mid-meso ([index](https://gummysearch.com/r/RPHypertrophy/)). Another reviewer said "the plan doesn't adjust if I happen to miss a workout" ([Trustpilot](https://ca.trustpilot.com/review/runna.com)).
- **No plan, so nothing to track.** [User] Fitbod sessions "seemed random" ([review](https://dr-muscle.com/fitbod-app-review-alternative/), from a competitor).
- **Invented readiness.** JuggernautAI's 0–100 score is the kind of number rule 6 forbids.
- **Leaving the comparison to the user** (Boostcamp).

## Proposals for GymSmarter (ranked; Ben decides)

1. **"Plan vs done" on the Summary (S, step 2–4).** One row per exercise: `3/3 sets · 8, 8, 7 of 8` plus a `Hit` / `Short` / `Over` word (icon and word, never colour alone). Header: `14/15 planned sets`. Uses the planned and actual values already stored separately (brief §1: "Show planned and performed values separately"). Evidence: TrainingPeaks compares strength by sets; Hevy shows progressing/maintaining.
2. **Progress → "Consistency" card (S, step 2–4).** The last 8 weeks as `2/3`, `3/3`, … against `Days a week you lift`, plus `Weeks at your aim: 5 of 8`. Never "missed" for lifting (D19, WP6). This extends WP15's week line backwards. Evidence: Hevy consistency; Boostcamp's report leaves the count to the user.
3. **Targets hit per lift (S–M, step 2–4).** In exercise history, each session shows target vs actual, plus a summary line `Targets hit 5 of last 6`. The comparison is deterministic. The coach may cite it, but it can't compute it. Evidence: RP weekly targets; Hevy per-exercise breakdown.
4. **Programme block view and end-of-block review (L, step 6, with WP18).** Week × slot grid: past cells show done/planned sets and Hit/Short, upcoming cells show targets, and the deload week is labelled. At block end, show facts only: sessions done vs planned, sets done vs planned, targets hit %, and start → end e1RM labelled `est.` for pinned lifts. Then an optional coach recommendation for the next block as a **proposal** (Apply/Undo). Evidence: JuggernautAI Full Block View and block check-in.
5. **Weekly sets per muscle vs a range Ben approved (M, step 6).** Show it only when the range comes from an approved playbook rule or Ben's own setting, and label its source. Otherwise show counts only. Evidence: Hevy's recommended-range green; Alpha's sets per muscle.
6. **Return after a gap (M, step 4+).** After N days with no lifting, Today offers `Light first session?`: a proposal with Undo, never Runna-style irreversible. The threshold and size go to the training-researcher as playbook candidates. ADR 0010's "−10% after 2 missed sessions" is the current fallback. Evidence: Dr. Muscle Light/Normal; Runna realignment.

### Suggested first version

- **Summary**: proposal 1.
- **Progress**: proposals 2 and 3 (the Consistency card, and targets hit inside exercise history).
- **Plan hub (Week)**: as in weekly-plan §2.2; tapping `2 of your 3 days done` opens the Consistency card.
- **Numbers only**: sets done/planned, reps vs target, sessions vs aim, e1RM labelled `est.`. No scores, no colour-only states, no projected e1RM targets.

**Later:** block grid and review (4), muscle ranges (5), return-after-gap (6), endurance compliance (dated, `Not confirmed` rather than `Missed`, per WP3), and charts of planned vs actual tonnage.

## Proposed brief changes (for Ben)

- Brief §12 Page 1 says "Sessions completed versus planned" and Today lists "planned sessions". Under D19 this should read "workouts done vs your aim". The brief and the approved design disagree, so this is flagged rather than chosen.
- Define "adherence" in brief §1 (Progress) and §7 (`getWeeklyTrainingSummary`) as **sets done/planned and sessions vs aim**, never a percentage score on its own.
