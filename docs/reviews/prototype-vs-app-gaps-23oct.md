# Prototype vs real app: gap list (23 Oct 2026)

**Type:** audit, no code changes. Branch `claude/gracious-knuth-joxqpw` at `07cf410`.

**Question (Ben):** is everything designed in the clickable prototypes in the real iPhone app?

**Short answer: no.** The logging loop is largely built and matches the prototypes:
- Today with a plan (lean card, Time with fit note and carry-over, Edit)
- Set up and Your workout
- the active workout v3
- the Summary with `Keep for next time?`
- Progress without a plan

What is missing is everything that makes a plan:
- **The plan builder does not exist at all.** No Gym goals, Your week, Check your lifts, Any preferences, deterministic plan engine, week strip, weekly progression, Changes card, or Previous plans.
- **Training blocks are not built:** block week on Today, deload, block view on Progress, block review.
- **There is no Library › Plan tab.** No-plan Today's `Set up a plan ›` goes to a dead end.

Today the only way to get a plan is to ask the coach in chat (`propose_plan`). That needs AI and gives a single week with no length, deload or progression.

## How to read this

**Sources of truth:**

| Kind | Files |
|---|---|
| Prototypes | `docs/design/prototypes/app/app-shell.html`, `training-blocks.html`, `plan-builder.html`, `workout-builder-v3.html`, `workout-active-v3.html`, `progress-simple.html` |
| Specs | `plan-builder.md`, `workout-builder-v3.md`, `training-blocks.md`, `progress-goals.md`, `fit-to-time.md`, `workout-table-v3.md`, `README.md` (D1–D9) |

**Status:**
- **Built:** in the app and behaves as the prototype.
- **Partly:** some of it is built, or it is built differently.
- **Missing:** not in the app.

**Size:**
- **S:** under a day.
- **M:** a few days, one slice.
- **L:** a week or more, or several slices.

**Paths:**
- `P:` = `docs/design/prototypes/`
- `A:` = `apps/mobile/src/`
- `D:` = `packages/domain/src/`
- `C:` = `packages/coach/src/`
- `S:` = `packages/schemas/src/`

**Ben?** column: **Decided** means a spec or a D1–D9 decision already settles it. **Open** means a real open question, listed again in the "Decisions needed" section.

---

## 1. Today, no plan (`P:app/app-shell.html` `renderTodayNo`, lines 309–379; spec `workout-builder-v3.md` §2.0.4 "No plan", rewritten 23 Oct)

| # | Prototype | App today | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| T1 | Header `Tuesday` + `✦ Coach`, 7-day strip with done workouts and runs | `TodayHeader`, `WeekStrip` (`A:screens/today/TodaySession.tsx:35,73`) | Built | – | – | – |
| T2 | `No plan · Set up a plan ›` card. The row opens the **plan builder** (`push('plan')`, line 371) | The row exists (`A:screens/TodayScreen.tsx:789`), but it dispatches `openYourPlan` (`A:navigation/actions.ts:100`): Library › Workouts, scrolled to the top. With no plan, Workouts shows no plan block (`A:screens/routines/WorkoutsScreen.tsx:274`). **Dead end: nothing there sets up a plan** | Missing (dead end) | S to re-route; the destination is §5 | §5 (plan builder) or an interim route | Decided (plan-builder §3: Today `Set up a plan ›` opens the builder). The interim route until §5 ships is a PM call |
| T3 | **Day row from Profile › Split**: `Chest NEXT · Back · Legs · Shoulders · ⋯`. NEXT = the Up next pick. Picking another day is today only, reads `Picked by you`, and the suggestion moves on | None. With no plan, `days` is empty (`A:services/today-session.ts:841`). The split days appear neither as a day row nor as cards | Missing | M | The split resolver exists (`D:session/split-up-next.ts`) | Decided (D7, §2.0.4). **Open:** today-fix SP4, whether a split without a plan shows as plan days |
| T4 | **Up next card**: day name, `N exercises · ~M min`, reason line (`Longest since you trained it · last Chest 12 Oct`), main-lift line `1 × 6 + 2 × 8 · 102.5 / 95` | One tappable row, `Up next · <title>` with a Start pill (`A:screens/TodayScreen.tsx:798-829`). No exercises, minutes, reason or main-lift line | Partly | M | T3; the `today-v2` draft for a split day | Decided |
| T5 | **Up next controls**: Main lift chips, Accessories Focused/Varied, `Time [−] 60 min [+]` with the fit note in light orange (D9 fit), Abs, Supersets. Today only, no `Today only` tag | Not on Up next. The five controls exist only on the non-lean card shown after picking an "Other session" chip (`TodaySession.tsx` non-lean branch, around line 610) and on Your workout (`TodayOptionRows`, `A:screens/builder/BuilderWorkoutScreen.tsx:686`) | Partly | M (reuse the non-lean card for the split day) | T3, T4 | Decided (§2.0.4: "the no-plan card keeps its controls") |
| T6 | `Start` on the card: one tap, straight into the workout | Start on the row: one tap (check-in when due) | Built | – | – | – |
| T7 | **No Edit on Up next** in the prototype (Edit is only on the with-plan card). `Build your own` + `＋ Activity` side by side | `Build your own` + `＋ Activity` built. The no-plan row has no Edit, matching the prototype | Built | – | – | Note: Ben's "Edit/Time on Up next" matches the prototype for **Time**, not for Edit. If he wants Edit there too, that's a new decision |
| T8 | `⋯` = Other workouts sheet: Full body, Upper, Push, Empty workout, saved workouts. **No chip row under the card** (D7) | Still shows the `OtherSessionChips` row (Full body / Upper / Push / Empty workout) under Up next (`A:screens/TodayScreen.tsx:830-835`, `TodaySession.tsx:272`). There is no `⋯` with no plan (`TodayScreen.tsx:1041` passes `[]`) | Partly (contradicts D7) | S | T3 (the `⋯` sits at the end of the day row) | Decided (D7: chip row removed) |
| T9 | Back-offs from the Profile goal's band (strength → Strength, muscle → Muscle, both → Balanced) | Built per batch23-loads (D4 code path; goal band) | Built | – | – | Open Q-R10 is answered "as built" for `both`. Only confirm whether Ben agrees |

## 2. Today, with a plan (`P:training-blocks.html` `today()`, lines 588–640; spec `workout-builder-v3.md` §2.0.2, `training-blocks.md` §3.1)

| # | Prototype | App today | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| W1 | Lean card: day, `N exercises · ~M min`, `Edited`, rows (main-lift line), `Why?`, `Start` / `Edit` | `SessionCard` lean branch (`A:screens/today/TodaySession.tsx:483+`) | Built | – | – | Decided (D3) |
| W2 | `Time` with the fit note `· −1 exercise ›`, the fit detail, and the **carry-over offer** (`Carry over` / `Undo`) | `TimeNoteRow`, the carry-over (`A:ui/time-stepper.tsx`, `A:services/today-session.ts`, `D:builder/carry.ts`) | Built | – | – | Decided (D9, carry-over ceiling 4 per day) |
| W3 | Coach offer line `✦ Cable fly 3 → 2 sets? Apply ✕`, withdrawn when stale | Pre-start offer line on the card (`TodayScreen.tsx` `offerCard`) | Built | – | – | Decided (D2) |
| W4 | Day control with NEXT and `⋯` Other sessions | `DayControl`, `SessionListSheet` | Built | – | – | – |
| W5 | **Header block week** `Tuesday · Week 3 of 6` (tap → Progress), `◐ Deload week`, `Block done ›` | None. No blocks exist (`S:plan-draft.ts:16` "Not in v1: … multi-week blocks, deloads"; `C:plan.ts:234`) | Missing | L (with §6) | Training blocks TB1–TB2 | Decided (training-blocks §8 Q6) |
| W6 | **Deload week**: the card's loads −10 %, 1 set fewer, ~RPE 7. `Why?` shows the deload line | None | Missing | M | TB1 `deloadDraft` | Decided (training-blocks §8 Q3) |
| W7 | **Early-deload offer** `◐ Deload this week? Apply ✕` | None | Missing | M | TB4 `deloadSignals` | Decided (§8 Q4) |
| W8 | `Bench 102.5 → 100?` **load offer** | Not built (README: spec only) | Missing | S–M | – | Decided (spec §2.0.3) |
| W9 | `Light first session?` after a gap of 14 days or more (training-blocks §2.4) | None | Missing | S | – | Decided |

## 3. Your workout and Set up (`P:workout-builder-v3.html`; spec `workout-builder-v3.md` §2.2–2.3a, §2.8)

| # | Prototype | App today | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| B1 | Set up: Day, Main lift, Variation, Length, Supersets, muscle groups with ± and `＋ Add muscle group`, Recommended / `Use recommended` | `A:screens/builder/BuilderSetupScreen.tsx` | Built | – | – | – |
| B2 | **Broad picking groups (D5): Chest, Back, Shoulders, Legs, Arms, Core** on Set up, Add and Swap. `add biceps` = +1 Arms | The builder uses `Chest, Back, Shoulders, Legs, Biceps, Triceps, Abs` (`S:builder-groups.ts:16`). The Add and Swap sheets group the same way | Partly | M (schema enum + migration of stored setups + views + coach words) | – | Decided (D5) |
| B3 | Your workout: rows, sets, drag to superset, swipe delete / sets ±, exercise pop-up, Swap / Add, keyboard bar, Time, today's controls (§2.3a) incl. `↻ Mix it up`, `⋯ Save as a variation`, coach offer line, Start | `A:screens/builder/BuilderWorkoutScreen.tsx`, `BuilderParts.tsx`, `BuilderSheets.tsx` | Built | – | – | – |
| B4 | Opened from Today's `Edit` or a plan day's `Open in builder ›`: Ben's edits replayed, `‹ Today` keeps them | Built (todaylean, `A:builder/builder-service.ts`) | Built | – | – | Open Q-R7 (a `Back to plan` on Your workout?) |
| B5 | D8: a coach change from chat lands on that workout's Your workout draft | Built (v3summary merge) | Built | – | – | Open Q-R9 (where it waits when not yet drafted) |

## 4. Active workout and Summary (`P:workout-active-v3.html`, `P:app/app-shell.html` `renderSummary`, lines 444–487; specs `workout-table-v3.md`, `workout-summary.md`, `workout-builder-v3.md` §2.8)

| # | Prototype | App today | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| A1 | Rounds strip, round card, `Up next:` line, timer bar (REST / SET), Log pill naming the step, `Next round`, swipe between exercises, Workout sheet | `A:workout/rounds.ts`, `A:screens/workout/WorkoutScreen.tsx`, `WorkoutTable.tsx` | Built | – | – | – |
| A2 | Start with a workout in progress resumes it, with the toast `Chest in progress` | `A:workout/library-view.ts:31` and Today's resume card | Built | – | – | – |
| A3 | **Discard with Undo**: `Discard 6 logged sets?` then `Workout discarded · Undo` (4 s), and Undo brings the same workout back (`workout-table-v3.md` §1.2, V4) | Alert, then a permanent discard: "… will be discarded. This can't be undone." (`D:session/discard.ts:33`, `A:screens/workout/WorkoutScreen.tsx:1766-1771`). No Undo | Partly | M (restorable discard, like delete-workouts' Recently deleted; fenced Undo) | – | Decided (spec §1.2) |
| A4 | Summary: `✓ Workout saved on this phone`, Active / Sets / Planned, `Compared with last time` + PB, Logged, `Next time` with Undo, `Keep for next time?` (Apply / Skip / Undo), Edit / Done | `A:screens/workout/SummaryScreen.tsx` (lines 275, 293, 515, 602–630, 779) | Built | – | – | Open Q-R5 (an untouched `Keep for next time?` lapses or stays) |

## 5. Plan builder (`P:plan-builder.html`, 1,430 lines; spec `plan-builder.md`) — entirely missing

**What exists today:**
- The apply / undo / end / pause / resume plumbing for a plan the coach proposes in chat: `C:plan.ts` (`propose_plan`), `D:session/coach-plan.ts` (`applyPlan`, `endPlan`, `undoEndPlan`, `planFirstLoads`), `D:session/plan-adapt.ts` (pause), `packages/persistence/src/plan-drafts.ts`, `A:services/plan-services.ts`, `A:screens/coach/PlanCard.tsx`.
- Plan-day templates per main lift (migration 0030), lift targets (`A:services/lift-target-service.ts`) and Profile split.

**What does not exist:**
- No screen, route or service named for any page below.
- No deterministic plan engine anywhere in `packages/domain`.
- The plan model is one week of days, with no length, effort, focus, priorities, deload or per-week progression (`S:plan-draft.ts:16`).

The spec's data note (`plan-builder.md` §4) says to reuse the `propose_plan` apply path. That keeps rule 5 and Undo for free.

| # | Prototype (function in plan-builder.html) | App | Size | Depends on | Ben? |
|---|---|---|---|---|---|
| PB1 | **Deterministic plan engine** (`build` 542, `splitFor` 313, volume engine 327–466, `pairUp` 666, `weeklySets` 677). Split from days and focus. Weekly set aims per muscle by effort band. Tiered placement (priorities first, specific targets, abs, the rest). Max 8 sets a muscle a session. Session length caps sets. Exercise preference score. A/B variations. No legs the day before a long run | Missing | L | New pure module in `packages/domain` (with tests: the prototype's 2,328-check harness is a ready test list). Exercise prior scores in the catalogue (exercise-researcher) | **Open:** plan-builder §5 Q2 (split defaults), Q3 (set bands) |
| PB2 | **Gym goals** (`renderGoals` 853): Plan length 4/6/8/12, Effort Standard/Push/Maintain, Main focus Strength/Muscle/Balanced/Fitness (ⓘ), `Any priorities?` No/Yes with ✦ suggestion and up to 2 groups, `Specific ＋ Add` (`openSpecSheet` 1383), lift targets with dates (`openTargetSheet` 1403), What to expect table. ✦ answers preselected, `Build plan` beside `Next` on every page, no step counter | Missing. Lift targets exist (`A:lift-targets/*`). Profile goal is Strength/Muscle/Both (`A:training/training-view.ts:63`), not the plan's four focuses | L | PB1. Priority suggestion signals (8-week facts; partly in `D:review/weekly.ts`) | Decided (D7). **Open:** Q6 effort names and assumed weekly gains. Spec drift: focus vs Profile goal (GA17 two-step) |
| PB3 | **Check your lifts** (`renderCheck` 970, `balanceCard` 927, `openLiftSheet` 1003, `openOtherSheet` 998): only when a main lift has no history or none in 8 weeks. `Still right` / `Edit`, estimate from the closest similar lift (`Use` / `Other lift` / `Enter`), `＋ Add a lift`, Strength balance Below / In range / Above with ⓘ. Week-1 top set = the 6-rep estimate, one step lighter unless confirmed (D6) | Missing (`planFirstLoads` covers coach plans only) | M | PB1. Read-across factors with tests | Decided (D6, §1a) |
| PB4 | **Your week** (`renderWeek` 1053): sessions 2–7, split boxes with ✦, Set days / Any days (+ day row), Other training chips (tap, again for ★, again to remove) with their day rows and long run, Session length − 60 ＋ / 30–60 + Other, Supersets No/Yes, Gym, `Rotates: next week starts with Legs` | Missing. The Profile split (`A:screens/profile/SplitScreen.tsx`) and activities exist | M | PB1 | Decided (D7: Other training here, Any days default) |
| PB5 | **Your plan** (`renderPlan` 1240): `N weeks · effort · deload`, **week strip 1…N with D** on deload weeks, weekday strip with runs, day cards that open inline (inset rows: name, sets × reps, kg; main lift in the shared format; superset letters), `Move day` (`openMoveSheet` 1398), `Open in builder ›`, `Do today ›` (this week, not done), **Sets per week** bars against bands with ↓/↑, `Abs: N sets a week · Change` (0/6/10/14/18), `Why?`, rows `Goals ›` / `Week ›` / `Any preferences ›`, `Not reviewed` badge offline, coach box + mic, `Apply plan` → Today with `Plan applied · Undo` | Missing. The closest thing is `YourPlanBlock` (`A:screens/library/YourPlanBlock.tsx`): days with state dots, goal line, days this week, sets done, Ask coach to change, Pause, End | L | PB1, PB6 (multi-week model) | Decided (D7: one back control, no day chips, no Swap day) |
| PB6 | **Weekly progression and warm-ups** (`atWeek` 475, `warmUp` 469, `recWeek` 506): per week, barbell mains rise at the effort rate, snapped. DB mains add reps first. Accessories use double progression. Deload weeks −10 % and ~⅓ fewer sets (Standard: last week; Push: every 4th; Maintain: none). Tap an exercise → week-by-week sheet. `Warm-up this week: bar × 5 · 40 × 5 · …` | Missing. Warm-ups exist in the builder's set rows (`D:builder/set-rows.ts`), not as a plan line | M | Multi-week plan schema (new migration; next free number is **0034**: training-blocks.md §5 says 0031, which is now taken by `0031-rest-resume-on-undo`) | Decided (§2, D4 back-offs). Plan-vs-block overlap, see Q-B1 below |
| PB7 | **Any preferences** (`renderPrefs` 1108): Chest / Legs / Back / Shoulders questions, each with #1 / #2 / Other / No preference. Other opens that movement's own list. A main-lift Other becomes the main lift. `Others I like ＋ Add`. Optional, opened from its row, `Done` rebuilds | Missing (memories hold dislikes in free text only) | M | PB1 preference score. Personal preferences stored as Your data (rule 10) | Decided (D7: optional) |
| PB8 | **Edit plan** (`changesCard` 1214, `diffItems` 1164, `compose` 1179): edits in place. The **Changes card** has one line per change (`+ Hammer curl 2`, `Lat pulldown 3 → 4`, `− Leg curl`), each `✓ Accept` / `✕ Reject`, plus `Accept all` / `Reject all`. **`Weeks` scope chips** (done weeks greyed). The week strip previews it. `Apply changes` + Undo. Done weeks and this week's done workouts never change | Missing. Changes to a running plan go only through the coach (`Ask coach to change`) as a new `propose_plan` | L | PB5, PB6, change-review.md | Decided (§3 "Editing a running plan") |
| PB9 | **Pause / End at the bottom** of Your plan. End = title-only `End plan?` sheet, then Library with `Plan ended · Undo` | Built in `YourPlanBlock` (in-page confirm, Undo; pause until a date) | Built (to move into PB5) | S | PB5 | – |
| PB10 | **Coach in the builder** (`coach` 1326, `rebuild` 1343, `editPlan` 1351): the words decide. A full description rebuilds, a change request edits that part, unclear asks `Build new / Change this one`. Offline the box is disabled and the plan reads `Not reviewed` | Missing (chat `propose_plan` builds a one-week plan card in the coach sheet) | M | PB1, PB8 | **Open:** Q5 (chat "build me a plan": open this screen pre-filled, or keep the chat card) |
| PB11 | **Start again** on a previous plan opens the builder with that plan's answers | Missing (ended plans are stored, `status: 'ended'`, but nothing lists them) | S after PB2–PB4 | Store the plan's answers on the plan | Decided (D7: no saved plans) |
| PB12 | `Do today ›` puts that day on Today's card | Partly: Library plan day `Make next` (`A:screens/library/PlanDayScreen.tsx:143`) pins Up next, a different behaviour | S | PB5 | Decided |

## 6. Training blocks on Progress (`P:training-blocks.html` `progress()`, 788–791, and `review()`, 793–835; spec `training-blocks.md` §3.2–3.3, TB1–TB5)

| # | Prototype | App | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| K1 | This week header `Block 1 · week 3 of 6`. Start-a-block draft card when none is running (`draftCard`) | None | Missing | M | TB1 schema (`TrainingBlock`) | Decided (§8) |
| K2 | Lifts card: **plan path** (dotted) vs done per main lift, `On plan / Ahead / Behind`, projection `about mid-Nov at this rate` (est., ≥ 4 rising weeks) | Lifts card without plan path or status (`A:reviews/charts.tsx` `LiftsCard`). Projection exists (`D:progress/projection.ts`) | Partly | M | TB1 `blockPath` | Decided (§8 Q1, Q8) |
| K3 | Coach's changes with early-deload state | Coach's changes built (`A:reviews/ReviewsSection.tsx`), no deload state | Partly | S | TB4 | Decided |
| K4 | **Block review**: lifts start → end vs plan, sets per muscle vs plan, Easy / Good / Hard counts, next-block proposal (path, up to 2 accessory swaps a day, each row Apply/Skip), `Start next block` offline, Undo | None | Missing | L | TB1–TB4, `propose_block` tool | Decided (§8 Q7, Q9, Q10) |

## 7. Progress without a plan (`P:progress-simple.html`; spec `progress-goals.md` "Progress v3")

| # | Prototype | App | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| G1 | `Overview / Lifts / Training` tabs, This week Week / Month, calendar grid, Lifts card (focus one lift, PB ring, est. hollow dot, `Edit` lifts, `All lifts ›`), Coach's changes (applied + Undo, offers Apply/Skip, the structural `Legs on Saturday?` Apply/Skip, `NEW` until `Got it`, `Past weeks ›`) | `A:screens/progress/ProgressScreen.tsx:146-161`, `A:reviews/ReviewsSection.tsx`, `charts.tsx` | Built | – | – | – |
| G2 | **Muscles card: the 9 detailed rows** (Chest, Back, Shoulders, Quads, Hamstrings, Calves, Biceps, Triceps, Core), each with a sparkline and `N of plan` | 5 broad rows `Chest, Back, Shoulders, Legs, Arms`, with no Core (`D:review/progress-page.ts:825`) | Partly | S–M | D5. The "of plan" number needs a weekly aim per muscle: with a plan from PB1; without a plan, the source isn't specified | Decided (D5: counting uses the detailed list). **Open:** Q-R4 (rows for specific targets: Glutes, Adductors, Forearms) and what "of N" means with no plan |

## 8. Library (`P:app/app-shell.html` `renderLibrary`, lines 381–425; specs `plan-builder.md` §3 "Plans live in Library", `exercise-library.md`, `routines.md`)

| # | Prototype | App | Status | Size | Depends on | Ben? |
|---|---|---|---|---|---|---|
| L1 | **Tabs `Plan | Workouts | Exercises`** | Two segments, `Exercises | Workouts` (`A:screens/library/LibraryScreen.tsx`, `A:workout/library-browse-view.ts:13`, `LibrarySegment` in `A:navigation/types.ts`) | Partly | S | – | Decided (Ben, 22 Oct) |
| L2 | **Plan tab**: `Current` row (`Strength block · Active/Paused · Back / Chest / Legs / Shoulders · week 3 of 6`) opens Your plan. With no plan, a `Set up a plan` row (`Goals, week, preferences`). `Previous` plans with `Start again` | Your plan lives as a block at the top of Workouts (`WorkoutsScreen.tsx:274`). No plan: nothing. No Previous list | Missing | S (shell + Previous list) / L (with PB5) | PB5 for the overview, PB11 for Start again | Decided (D7) |
| L3 | Workouts: rows `Push A · Last done Mon` open Your workout. `＋ Build a workout` opens the **builder** | Rows open Your workout (`WorkoutsScreen.tsx:143`). `＋` / `New workout` opens the routine **editor** (`WorkoutEditor`, lines 40, 298) | Partly | S | – | Decided by the prototype (`data-go="builder"`). The editor stays reachable from a row's `Edit` |
| L4 | Exercises: **muscle filter chips in one row: All + 6 broad groups** (D5) | A `Muscle ▾` sheet with 11 detailed groups, multi-select (`library-browse-view.ts:35`, `S:muscle-groups.ts:8`), plus Gym / Equipment / Movement chips | Partly | S | B2 (shared broad-group list) | Decided (D5; README index row for exercise-library) |
| L5 | **List grouped by broad group, with part sub-headings** (Legs → Quads / Hamstrings / Calves; Arms → Biceps / Triceps) | Flat `MATCHES / RECENT / ALL EXERCISES · N` (`D:exercise-browse.ts:219-231`) | Missing | S–M | L4 | Decided by the prototype |
| L6 | **`＋ Add your own` inline**: name, broad group, then the part for Legs / Arms, Save. Toast `<name> added`. Tagged `Yours` | `＋` in the header opens the full `ExerciseForm` (name, equipment, load convention, up to 3 of 11 muscle groups, measurement, laterality) (`A:screens/library/ExerciseFormScreen.tsx`). `Yours` tag built (`D:exercise-browse.ts:212`) | Partly (works, different shape) | S | L4 | **Open (small):** keep the full form (the app needs equipment and load convention for rule 4 loads), or the prototype's 3-field quick add with defaults? Recommend: the button as in the prototype, opening the existing form preset to the filtered group |
| L7 | Exercise row opens guide, history and swaps | `ExerciseInfoScreen` | Built | – | – | – |

## 9. Profile (`P:app/app-shell.html` `renderProfile`, lines 427–442; spec `profile-and-settings.md`)

| # | Prototype | App | Status | Size | Ben? |
|---|---|---|---|---|---|
| R1 | `Split`: own value with no plan; `Set by your plan` with a plan, opening Library › Your plan | `A:screens/profile/ProfileScreen.tsx:115-124`, `SplitScreen.tsx`, `A:training/training-view.ts:45` | Built (opens Workouts until L2 lands) | – | Decided (D7) |
| R2 | **`Workout defaults`** row (`60 min · Supersets on · Abs on`), `Set by your plan` with a plan | Only session length (in Training details). No default for supersets or abs | Partly | S | Decided (D7) |
| R3 | Rows `Logging (kg · RPE after the set)`, `Rest presets`, `Appearance`, `About this build`, `Import` | `Import` is inside Data & backup. The other four are not Profile rows (the prototype stubs them with "Not in this prototype") | Partly | S | Low priority. The spec owns them |
| R4 | Sections Training, Gyms, Voice & alerts, Coach, Data, App | Same areas plus Morning reminder, Targets hit, App status, Developer. The order differs (Data first) | Built (order differs) | S | – |

## 10. In the app but not in the prototypes

| Item | Where | Status in the specs | Recommendation |
|---|---|---|---|
| **Pre-workout check-in** on Start (1–5, What's up?, lighter-session offer) | `A:screens/workout/CheckInScreen.tsx`, `A:workout/check-in-*.ts` | **Still current.** `check-in.md`, and `workout-builder-v3.md` §2.0.5 says Start "starts the card's workout as is (check-in sheet when due)". The prototypes simply don't draw it | **Open for Ben:** keep it (spec) or drop it (as in the prototype) |
| No-plan `OtherSessionChips` row | `A:screens/today/TodaySession.tsx:272`, `TodayScreen.tsx:830` | **Removed by D7** | Remove it (T8) |
| No-plan non-lean card: collapsed `Session breakdown` + `↻ Mix it up` | `TodaySession.tsx` (`mixShown = !view.lean`) | The no-plan card in the prototype has no breakdown or Mix it up. Mix it up now lives on Your workout | Drop it with T4/T5 so both cards read the same |
| Library › Workouts `Your plan` block (goal line, day dots, Days this week, Planned sets done, `Ask coach to change`) | `A:screens/library/YourPlanBlock.tsx` | Superseded by Library › Plan › Your plan overview (PB5) | Move it under L2 now; replace it with PB5 later |
| Plan day screen with `Edit` (routine editor) and `Make next` | `A:screens/library/PlanDayScreen.tsx` | The prototype opens a day inline (`Open in builder ›`, `Do today ›`, `Move day`). Plan structure changes go through Edit plan (PB8) or `Keep for next time?` | Keep it until PB5. Then `Edit` on a plan day should become a PB8 change, not a direct template edit (rule 2) |
| Coach chat plan card (`propose_plan`, Apply in chat) | `A:screens/coach/PlanCard.tsx`, `C:plan.ts` | Open Q5 | Ben decides (Q5) |
| Week merges / skips (`propose_week`), Activity sheet, Day sheet | `D:session/week-plan.ts`, `A:screens/activity/ActivitySheet.tsx` | Current (weekly-plan.md, Today §2.0.5) | Keep |
| Repeat, Past workouts, Recently deleted, Morning reminder, Targets hit, App status, Developer, Import flows, Memory, Playbook | `A:screens/repeat/*`, `A:reminders/*`, `A:screens/profile/*`, `A:screens/import/*` | Current specs; not drawn in the prototypes | Keep |
| Library Exercises Equipment / Movement / Gym filter chips | `LibraryScreen.tsx` | Not in the prototype, but not contradicted | Keep, after the D5 muscle row (L4) |

---

## Decisions needed from Ben (real open questions only)

Already decided, not to re-ask: D1–D9, the carry-over ceiling (4 per day), training-blocks §8 Q1–Q11, Q-R3, Q-R6, SP7.

1. **Q-B1 Plan length vs training block.** `plan-builder.md` puts length (4/6/8/12), effort and the deload schedule (Standard: last week; Push: every 4th) on the plan. `training-blocks.md` (approved 21 Oct) treats a block as a separate 6-week stretch started with `Start a block` on an existing plan, with its own review and next block. Proposal:
   - The plan's length **is** block 1.
   - The block review offers the next block on the same plan days.
   - `Start a block` is only offered for a plan made by the coach before the builder existed.

   This needs Ben's OK and a CHANGELOG line, because it changes the approved training-blocks flow.
2. **Plan engine numbers:**
   - plan-builder §5 Q2: split defaults by days and focus.
   - Q3: set bands (priority 12–20, others 8–14, small 4–10).
   - Q6: effort names, and the assumed weekly gain behind `Bench est.`.

   The builder can ship with the proposals as placeholders, labelled est.
3. **plan-builder §5 Q5:** should "build me a plan" in chat open the builder pre-filled, or keep the chat card?
4. **plan-builder §5 Q7:** extra optional questions in the flow (experience, always include/avoid, variety, start date).
5. **Pre-workout check-in:** keep it on Start (spec) or drop it (prototype)?
6. **No-plan split days (today-fix SP4):** should Profile split days show as plan days (strip, NEXT) without an applied plan? The prototype's day row says yes for Today. Confirm that the strip and Progress stay plan-free.
7. **Progress Muscles with no plan:** what is "of N" for each detailed row without a plan (the Profile split's implied aims, or no target)? Also Q-R4 (rows for specific targets).
8. **Add your own:** a quick 3-field add (prototype) vs the full form (app). It's small but affects rule 4 loads.
9. Carry-overs from the 23 Oct review, still open: **Q-R2** (back-off with no load in band; built as recommended), **Q-R5** (an untouched `Keep for next time?`), **Q-R7** (`Back to plan` on Your workout), **Q-R9** (where a D8 change waits; built as recommended).

## Proposed build order (vertical slices, each shippable and testable on the iPhone)

The order puts the biggest user value first and removes the dead end immediately.

| Slice | Contents | Size | Testable result |
|---|---|---|---|
| **V1 Library › Plan tab, no dead end** | L1 tabs `Plan | Workouts | Exercises`. L2 shell: `Current` (moves `YourPlanBlock` here), `Set up a plan` row with no plan, `Previous` list of ended plans (read only). Today's `Set up a plan ›` and Profile `Set by your plan` open Library › Plan. Until V2: the `Set up a plan` row opens the coach with `Build me a plan` pre-typed when connected, else shows `Needs the coach` (PM interim, rule 1 honest) | S–M | Tap `Set up a plan ›` on no-plan Today and land somewhere that sets one up |
| **V2 Plan builder MVP, offline-first** | PB1 engine (split, volume placement, session-length cap, abs, supersets pairing). PB2 Gym goals (length, effort, focus, priority, ✦ preselected, `Build plan` on every page). PB4 Your week. PB5 Your plan for **week 1 only** (day cards, Sets per week, Goals/Week rows, `Not reviewed`). Apply / Undo through the existing `applyPlan` path. Plan answers stored on the plan | L | In airplane mode, build a 4-day Balanced plan, apply it, and see it on Today with Undo |
| **V3 Check your lifts + week-1 loads** | PB3 including D6, the similar-lift estimate, `Enter`, Strength balance | M | A stale squat shows `Still right` → 117.5 / 110 (acceptance check 4) |
| **V4 Multi-week plan: progression, deload, block week on Today** | PB6 (week strip 1…N with D, week-by-week sheet, warm-up line) + training blocks TB1–TB2 (schema migration 0034, `blockWeekOf`, `deloadDraft`, Today header `Week 3 of 6`, deload card) per Q-B1 | L | Week 6 drafts −10 % / 1 set fewer. The header reads `Week 3 of 6`. Force-close safe |
| **V5 No-plan Today parity** | T3 day row from Profile split with NEXT and `⋯`. T4/T5 Up next card with reason line, main-lift line, five controls, D9 fit note. T8 remove the chip row. Drop the breakdown / Mix it up from that card | M | No-plan Today matches `app-shell.html` `todayNo` |
| **V6 Edit a running plan** | PB8 Changes card (per-change Accept/Reject, Accept all / Reject all, Weeks scope), PB7 Any preferences, PB9 Pause/End moved into the overview, PB12 `Do today ›`, `Move day`, `Open in builder ›`, PB11 `Start again` | L | Change abs 10 → 14 on a running plan, reject one line, scope weeks 4–6, Apply, Undo |
| **V7 D5 broad groups everywhere** | B2 builder groups Arms / Core (+ stored-setup migration). L4 chip row, L5 grouped list, L6 Add your own. G2 nine detailed rows on Progress | M | `add biceps` is +1 Arms. The Library filter shows the 6 groups. Progress shows 9 rows |
| **V8 Block on Progress + block review** | K1–K4, TB3–TB5 (planned vs done, On plan/Behind, early-deload offer W7, block review with next block, `propose_block`) | L | At the end of week 6 the review shows code-recounted facts. Offline: `Start next block` |
| **V9 Small parity items** | A3 Discard with Undo. W8 load offer. W9 `Light first session?`. L3 `＋ Build a workout` → builder. R2 Workout defaults. R3 Profile rows. PB10 coach in the builder (after Q5) | S–M each | Each one on its own |

**Dependencies in short:**
- V2 → V3 → V4 → V6 → V8 is the plan chain.
- V5 and V7 are independent and can run in parallel with V2.
- V4 needs Q-B1 answered.
- V7's builder-group change touches stored builder setups, so it needs a migration and a backup round-trip test.
