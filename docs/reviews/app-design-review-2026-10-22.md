# Whole-app design review: 22 Oct 2026

Reviewer: independent `reviewer` agent. Scope: the clickable whole-app prototype (`docs/design/prototypes/app/` and `build_app.py` output), the screen prototypes, the `docs/design/*.md` specs, the competitor research, and the shipped screens in `apps/mobile/src/screens`. The review covered five areas: competitors, simplicity, extra complications, consistency and product rules. Every finding below was checked against the prototype (clicked through in Playwright with and without a plan), the specs, or the code. Rejected findings are left out. Evidence screenshots and scripts are in the session scratchpad (`.../scratchpad/verify/`).

## 1. Verdict: **CHANGES NEEDED**

The core loop is sound and in places ahead of the market: real-equipment loads, an honest no-AI fallback, supersets fitted to the session length, and Undo on coach edits. The problem is that the whole app is not yet one coherent product. The same session shows different exercises, numbers, names and dates on Today, the active workout and the Summary. Week-1 plan weights can be heavier than the app's own estimate. Tapping Start can turn into a three-way question that quietly edits every day of the plan. Apply plan, End plan and Discard workout have no Undo. Two specs let the coach apply changes Ben never asked for, which breaks CLAUDE.md rule 3. With a plan, Today opens on the editing controls instead of the workout. Six blocking issues (V1–V6) need fixing before the design is treated as final. After that, the biggest gain comes from cutting: fewer setup questions, one owner for each setting, one coach button and one set of proposal words.

## 2. What's working well

- **Loads on Ben's real equipment.** Snapping, a max for every machine and an explicit load convention match the best competitors and are stricter than most (competitor-landscape: "at parity with the best").
- **The active workout table.** A round per page, both superset partners on screen and one rest after the round. No competitor documents all of these.
- **Honest AI status in the shipped app.** Built-in rule output is labelled, and Progress tags it `Not reviewed · Offline`.
- **Undo already exists in the shipped app** for End plan and Resume after leaving a workout. The prototype needs to catch up with the code here, not the other way round.
- **Fit-to-time as an idea.** Setting a time and letting the app trim the session is a real advantage. It needs tighter rules (V14, V15).
- **Check your lifts.** Asking Ben to confirm stale or estimated lifts before building a plan is the right instinct.

## 3. Top 10 changes, ranked by impact on everyday use

| # | Problem (one line) | Fix (one line) |
|---|---|---|
| 1 | Start sometimes asks "Today only / Update in your plan / Save as a variation", and "Update in your plan" changes every day in the plan (V3). | Start always starts, for today only. Offer "Keep for next time?" once on the Summary, for that day only. |
| 2 | With a plan, Today opens on the editing controls, and Edit lands on a setup page rather than the workout (V6). | Show the session rows, Start, an inline Time control and Edit. Edit opens "Your workout". |
| 3 | The same session shows different exercises, weights, names and dates on each screen (V1). | One shared session fixture for all screens and one main-lift format (`1 × 6 + 2 × 8 · 100 / 90`). |
| 4 | Week-1 plan weights ignore reps and how long since the lift (a stale 120 × 5 squat becomes 122.5 × 6) (V2). | Start from the 6-rep estimate shown on Check your lifts, one step lighter when stale or estimated. |
| 5 | Last time and the plate line are hidden while lifting (V9). | Small grey `last 100×6` under each kg cell. Plate line always visible on the current barbell set. |
| 6 | The coach applies small changes, a stall reset and extra sets without being asked (V5). | Unasked changes become an offer (`✦ Bench 102.5 → 100? Apply`). Stall resets and added sets always need Apply. |
| 7 | Apply plan, End plan and Discard workout happen immediately, with no Undo or confirm (V4). | Apply and End show Undo toasts. End gets a short confirm. Discard asks `Discard N logged sets?`, then offers Undo. |
| 8 | Setting up a plan takes about 19–28 taps, and Next stays blocked until every question is answered (V7). | Preselect suggested answers, allow Build at any time, and make Preferences optional. |
| 9 | Finish is hidden in ⋯, and the prototype has no Resume after leaving a workout (V16). | Show Finish in the action bar after the last set, with a confirm if sets are left. Add a Resume card. |
| 10 | Approval words vary (Accept, Apply changes, Got it…), and Undo appears on rows that changed nothing (V10). | Apply/Skip for proposals, Undo only for applied changes, and no Undo on unchanged rows. |

## 4. Simplifications

| Cut / merge / default | What it loses |
|---|---|
| Remove the Start prompt and ask "Keep for next time?" on the Summary instead (V3). | No way to save a change into the plan before lifting. That's rarely needed, and the Summary covers it. |
| Retire `WorkoutOverviewScreen.tsx` (2,050 lines) and send every "open workout" to the builder (V6). | A separate read-only overview. The builder's "Your workout" page already shows the same thing. |
| Preselect suggested (✦) answers in plan setup and allow Build at any step (V7). | Ben has to stop and think about each answer. This reverses his earlier decision (`plan-builder.md:36`), so it needs his approval. |
| Make Preferences (9–10 questions) an optional row on Your plan, and fold "Other training" into Your week (V7). | Upfront detail. Defaults cover it, and he can still edit it. |
| One coach control instead of six entry points (V11). | Shortcuts placed next to specific tasks. A single coach button with context covers them. |
| Give each setting (length, supersets, abs, main lift, split) one owner. Remove the duplicates from Profile › Training details and Profile › Split (V19). | Changing the split from Profile. It moves to the plan. |
| Plan overview: one back control, no step counter, no day-chip row, no Swap day (V20). | A second way to move days. Today's day picker already does this. |
| Cut Focused/Varied. Keep A/B days and Mix it up. Rename saved variations to "saved versions" (V21). | One fine-grained variety knob that overlaps with the other two. |
| Drop saved plans. Keep Previous plans with Start again (V32). | Named plan templates ("Hotel weeks"). Previous plus Start again does the same job. |
| Turn off the pre-workout check-in by default (V33). | Pain and readiness captured before every session. Pain can still be flagged mid-workout and on the Summary. |
| Remove the no-plan Today chip row (it duplicates ⋯). A Library row opens a preview with Start (V26). | One-tap shortcuts that are already in ⋯. |
| Move Strength balance from plan setup to Progress (V23). | A comparison at plan time that rests on crowd-sourced bands anyway. |

## 5. Inconsistencies to fix

| Area | Current | Proposed |
|---|---|---|
| Session identity | Today: Chest, Tue 20. Active: "UPPER BODY", rear-delt fly. Summary: "Upper B · Thu 22 Oct". | One session, one name and one date across all screens (V1). |
| Main-lift format | `Top 100 × 6 · 2 × 90 × 8`, `4 sets @ 102.5`, and others. | `1 × 6 + 2 × 8 · 100 / 90` everywhere. |
| Muscle groups | Progress uses Chest/Back/Shoulders/Legs/Arms; the plan uses Quads/Hamstrings/Calves/Biceps/Triceps/Core. | One list everywhere. |
| Dumbbell loads | `27.5` and `12.5 kg × 15` with no "each". | `27.5 kg each` everywhere (V9). |
| Proposal words | Accept / Accept all / Reject all / Apply changes / Apply / Skip / Move Legs to Sat / Keep as is / Got it. | Apply / Skip for proposals, Undo for applied changes (V10). |
| ✦ symbol | Means "coach" and also "suggested option". | ✦ = coach only. Mark suggestions some other way (V11). |
| Supersets default | Off in the plan, on in Today's card. | One default, owned by the plan (V19). |
| Feel labels | Summary: Too easy / About right / Too hard. Block review: Easy / Good / Hard. | One set of labels (V34). |
| Exercise names | Bench / bench press / Barbell bench press. "Push" means three things. | Catalogue display names. Screen titles match their row labels (V27). |
| Gym name | "Main gym" vs "PureGym Leeds". | Ben's saved gym name. |
| Plan name | Library says "Strength block" for a Balanced plan. | Name the plan after its goal. |
| Goal options | Schema: `strength | muscle | both`. Builder: Strength / Muscle / Balanced / Fitness / Maintain. | Make the builder options and the enum match (V24). |
| Progress week label | "13–19 Oct" (13 Oct is a Tuesday). | Weeks start on Monday, or use a rolling 7 days labelled as such. |
| Coach vs rule source | Built-in rule output shown under "Coach's changes". | `Coach` / `Rule` tag on every change (V11). |
| Library segments | README says "Plan hub". Prototype: Plan/Workouts/Exercises. | Update the README to match (V35). |

## 6. Competitor position

**Ahead (on paper; most is designed, not built):**
- Superset pairing tied to session length, with the main lift never paired, a round per page and one rest after the round.
- Explicit max per machine and an explicit load convention.
- Coach proposals that are version-checked, with Undo on in-session edits.
- A labelled no-AI fallback, fully offline logging and no subscription.

**Behind:**
- Last time and the plate line during the lift. Hevy, Strong and FitNotes show the previous set inline. GymSmarter hides it behind Why? and only shows plates while editing the load (V9).
- Speed to first workout with a plan. Competitors open on the workout; GymSmarter opens on settings (V6). Plan setup takes 19–28 taps (V7).
- Exercise library breadth: 144 exercises and 10 guides, against 400–1,400 elsewhere. The exercise detail page is a stub (V36).
- Rest Live Activity, which is standard in Hevy, Strong and Arvo. The device test is still to run (V36).

**Missing:**
- An offline / coach-off state in the whole-app prototype. Profile hard-codes "Connected" (V11).
- Resume and a visible Finish in the prototype (V16). The shipped app has Resume.
- Swap, Remove and Add exercise mid-workout in the prototype (V18). The shipped app has them.
- Pain shown in plan setup and on Today (V22). Gravl's pain UX is richer.

**The real competitor is still ChatGPT voice plus a free logger.** The inconsistencies in V1 and V2 undercut the main claim that GymSmarter's numbers can be trusted.

## 7. Rule strains (CLAUDE.md)

- **Rule 3 (coach acts only when asked or on a clear signal):** `workout-builder-v3.md:197` applies background review changes to Today's draft. `progress-goals.md:28` applies a stall reset (`Row 3 × 8 → 4 × 6`) and `Lateral raise 3 → 4 sets` without asking. Both count as "bigger" under CA8 (V5).
- **Rule 2 (broad changes are proposals with scope and Undo):** "Update in your plan" rewrites every day from a Time change (V3). Picking another day on Today silently drops Chest from the week (V13). Apply plan, End plan and Discard have no Undo (V4).
- **Rule 4 (achievable loads):** plan accessories add a flat +2.5 to dumbbells without snapping to the gym's rack. The ± buttons use fixed 2.5 / 1.25 kg steps (V9, V29).
- **Rule 6 (no invented data):** done rows show the target RPE as if Ben logged it (V17). Estimates on Check your lifts are marked by grey text only, and What to expect uses placeholder rates (V23).
- **Rule 1 (honest AI status):** "Coach connection · Connected" is hard-coded, and there is no offline state in the shell (V11).
- **Rule 9 (pain stops progression):** `plan-builder.html` has no pain handling at all (V22).
- **Rule 10 (Your data vs Coaching knowledge):** "What the coach remembers" sits beside "Guides & playbook" in Profile (V31).
- **Minimal copy:** "Longest since you trained it", "Tap a lift to change it. Grey = estimate.", "Back to rule: same as today", "Suggested: Back, fewest sets lately" (V28).

## 8. Remaining findings by screen

**Blocking (high)**

| ID | Where | What's wrong | Fix |
|---|---|---|---|
| V1 | All screens; `app-shell.html:294`, `build_app.py` | Each screen uses its own unshared data: Today shows Chest on Tue 20, the active workout shows "UPPER BODY" already 0:43 in, and the Summary shows "Upper B" on Thu 22. Muscle-group lists differ. Progress labels a week "13–19 Oct". | Use one shared fixture, plus a check in `build_app.py` that fails when screens disagree. Use one muscle list and one main-lift format. |
| V2 | Plan builder, `plan-builder.html:430` | `top = snapFor(n, h.kg + step)`. A stale squat at 120 × 5 gives a week-1 top set of 122.5 × 6, while Check your lifts says 117.5. Row 90 × 12 becomes 92.5 × 6. Leg press 200 × 10 becomes 202.5 × 6. This contradicts `plan-builder.md:56`. | Start from the 6-rep estimate, minus one achievable step when the lift is stale or estimated. Test: a stale 120 × 5 squat never gives more than 117.5 × 6. |
| V3 | Today → Start; `build_app.py` `cmd:'edit'` | Changing only Time (60 → 55) turns Start into a three-way prompt. "Update in your plan" sets the length on every day, drops Calves to 2 sets and lists unrelated Legs changes. No workout starts. The shipped `builder-service.ts` changes only that one template, so the prototype and the code disagree. | Remove the prompt. Ask "Keep for next time?" on the Summary, for that day only. |
| V4 | Shell, `app-shell.html:150,161,163`; `plan-builder.html:1180` | "Plan applied", "Plan ended" and "Workout discarded" are plain toasts with no Undo. Discard has no confirm. | Undo toasts for Apply and End. A title-only confirm for End. `Discard N logged sets?` then Undo. |
| V5 | `workout-builder-v3.md:173,197`; `progress-goals.md:28`; `progress-simple` | Small changes are applied in the background, with the reason hidden behind Why?. A weekly review applies a stall reset and an extra set without being asked. | Make these offers (Apply/Skip). Stall resets and added sets always need Apply. |
| V6 | Today with a plan; Edit; `WorkoutOverviewScreen.tsx` | The card is mostly controls. Edit opens "1 of 2 Set up" with a different 60-minute fixture. The shipped app keeps a third pre-start screen. Q1 in `plan-builder.md:103` is unresolved. | Session rows + Start + Time + Edit. Edit opens Your workout. Retire the overview screen. |

**Status (22 Oct, prototypes only, not committed):**

- **V1 – Fixed.** One shared session from Today (with or without a plan) through the active workout to the Summary (`Chest`, `Tue 20 Oct · Main gym`). This week's plan overview uses the same data as Today. One main-lift format (`1 × 6 + 2 × 8 · 102.5 / 92.5`), one muscle list, Monday-start week labels, `each` on dumbbells. `build_app.py` now fails when screens disagree (fixture check plus a headless click-through). Still open: one time model for Build your own (only Chest matches), the Progress chart's dotted plan line, and Check your lifts history versus Today's.
- **V2 – Fixed.** Week-1 top sets come from the 6-rep estimate on Check your lifts, a step lighter when estimated or stale and not confirmed (stale squat 120 × 5 → 115 × 6). The shipped app doesn't have this flaw. Still open for Ben: whether a confirmed stale lift should also start a step lighter, and the gap cut in the no-AI `builderLoad` fallback.
- **V4 – Fixed.** Apply plan and End plan show Undo toasts; End plan asks `End plan?` first. Discard asks `Discard N logged sets?`, then shows Undo. Start ends a pending Undo and resumes a workout already in progress. Still open: the End plan confirm button isn't styled as destructive in the prototype.
- **V6 – Partly fixed.** Edit on Today, and `Open in builder ›` in the plan, open Your workout with that day's current draft; Back returns unchanged. Hiding Today's controls when there is a plan, and retiring `WorkoutOverviewScreen.tsx`, await Ben.

**Plan setup and plan overview**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V7 | medium-high | All 5 Gym goals questions are required before Next. Suggestions are not preselected. Preferences has 9–10 questions. "Other training" is asked twice. Setup takes about 19–28 taps. | See §4. |
| V8 | medium | The ✦ points to Leg press only because `prefSug` halves the stale squat's score, while Check your lifts still projects squat. The 4-day ✦ split (Chest/Legs/Shoulders/Back) contradicts `plan-builder.md:46,65` and fails the plan's own volume check. | The ✦ follows the spec's split table and the projected lift. Show Profile's split as "Your usual". |
| V20 | medium | `‹ Back | 5 of 5 | Close` on an existing plan. The day chips repeat the day cards. Swap day, Do today and Open in builder overlap with Today. Open in builder contradicts `plan-builder.md:93`. | One back control, no counter, no chips, no Swap day. Header values tappable in Edit. |
| V21 | medium | Focused/Varied, A/B days, Mix it up and saved variations overlap. | Keep A/B days and Mix it up only. |
| V22 | medium | No pain handling in the plan builder or on Today. | Freeze the flagged lift and don't suggest it. Show a `⚠ Pain · held` chip. |
| V23 | medium | Estimates are marked by grey text only. Projections use placeholder rates. Strength balance uses crowd-sourced bands. | `≈` / est. on every derived value. Show projections only once Ben has his own trend. Move Strength balance to Progress. |
| V24 | medium | Goal options don't match `TrainingGoalSchema` (`packages/schemas/src/training-profile.ts:19`). | Align the options and the enum. |
| V25 | medium-low | `plan-builder.html:294`: a body-part split with fewer than 4 days becomes Full body ×3, which the spec rules out. | Use the spec's 3-day split. Show before/after. |
| V30 | low | After Apply, the fixture lands on week 3 with runs. | Load a week-1 state. |
| V32 | low | Saved plans add another kind of saved object. | Drop it. Keep Previous plans. |

**Today and the workout builder**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V13 | medium | Picking Legs on Tue gives Legs twice in the week, and Chest disappears without a tag or Undo. Three specs disagree on what should happen. | Reflow shown as `Chest → Thu · Undo`. Never drop a session. |
| V14 | medium | With supersets off, 45 min gives `Time · supersets ›` while the switch still shows off. | Off is a hard rule. Cut sets instead. |
| V15 | medium-low | At 35 min it cuts Incline DB press (a compound) and keeps Cable fly and Crunch. Time moves only in ±5 steps. | Rank compounds above isolation when cutting. Add 30/45/60/75 chips. |
| V19 | medium | Length, supersets, abs, main lift and split each appear in 3–5 places, with clashing defaults. | One owner per setting (see §4). |
| V26 | low | The no-plan chip row duplicates ⋯. | Remove the chips. |

**Active workout**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V9 | medium-high | Last time is behind Why? (`workout-table-v3.md:28`). The plate line shows only while editing (`WorkoutTable.tsx:1144`), a regression from `active-workout.md:332`. "each" is missing. Dumbbell steps aren't snapped to the rack. | See §3 #5. Write `kg each`. Snap to equipment. |
| V16 | medium | No Resume in the prototype. Finish is only in ⋯, with no confirm for unlogged sets. | Resume card. Finish in the action bar. |
| V17 | medium | Done rows show the target RPE as the logged value (`workout-active-v3.html:146`). | Leave RPE blank until Ben enters it. Optionally show a toast with Undo on untick. |
| V18 | medium (prototype only) | No Swap, Remove or Add in ⋯. | Match the shipped menu. |
| V29 | low | The ± step is fixed at 2.5 or 1.25 kg (`workout-active-v3.html:205`). | Step to the next achievable load, capped at the max. |

**Summary**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V10 | medium | `Same: 35 kg × 10–12 · 0%` has an Undo, and after Undo it reads "Back to rule: same as today" (`app-shell.html:300`). No Coach/Rule tag. The approved "How did it feel?" row is missing. The same change appears in three places. | Next-session changes live on the Summary. Elsewhere they are read-only. Add the tag and the feel row. |
| V33 | low | Up to three check-ins per session (`CheckInScreen.tsx` still exists; whether it's on by default wasn't verified). | Pre-workout check-in off by default. |
| V34 | low | Feel labels differ from the block review. | One label set. |

**Progress**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V12 | medium | Without a plan it shows `Sets vs plan`, `┄ Plan`, `next Pull` and `Make Saturday its day in your plan?`. | Compare against Profile's split or a usual range. Hide the plan prompts. |
| V11 (part) | medium | `progress-simple.html:342` lists built-in rule output under "Coach's changes" (it is tagged Offline). | Coach / Rule tag. |

**Profile and shell**

| ID | Severity | What's wrong | Fix |
|---|---|---|---|
| V11 | medium | `app-shell.html:281` hard-codes "Connected". The shell hides each screen's offline toggle. There are six coach entry points. | Add an AI-off/offline toggle to the shell. One coach control. |
| V31 | low | Memories sit next to the playbook under Coach. | Separate "Your data" and "Coaching knowledge" sections. |

**Across screens:** V27 (naming drift), V28 (minimal-copy violations), V35 (Library naming), V36 (parity items to track: library breadth, exercise detail stub, Live Activity device test).

## 9. Decisions needed from Ben

1. **Start always starts?** Remove the three-way prompt, and offer "Keep for next time?" on the Summary (reverses the `workout-builder-v3.md:51` / §2.8 path).
2. **Today with a plan (plan-builder Q1):** show the session plus Start, with editing behind Edit?
3. **Preselect suggested answers in plan setup?** This reverses the "✦ marked but not picked" decision (`plan-builder.md:36`).
4. **Coach background changes:** confirm that pre-review and weekly-review changes outside CA8 "small" are offers, not auto-applied. This fixes `workout-builder-v3.md` §2.0.3 and `progress-goals.md:28`.
5. **Last time inline:** bring back `last 100×6` under each set. `workout-table-v3.md:28` moved it behind Why? with no recorded decision, against `competitor-first-pages.md`.
6. **Picking another day on Today:** which rule wins. Three specs disagree (`workout-builder-v3` §2.0.4, `plan-builder.md` §3, the no-plan notes).
7. **Progress with no plan:** what to compare against (Profile split or usual range). `progress-goals.md` doesn't define it.
8. **Cuts:** Focused/Varied, saved plans, Profile › Split, pre-workout check-in on by default, Strength balance in setup.
9. **Goal options:** settle on one list and update the schema to match.

## Spec issues

1. `plan-builder.md` contradicts itself. Steady is dropped at `:26` but used at `:60` and `:107`. The split defaults at `:46`, `:48` and `:65` differ, and none of them matches the prototype. "Set days / Fit them in" doesn't match the prototype's "Any days / Set days". The step list doesn't match the prototype's 5 steps. Rewrite §1 as a current-state section and keep the decision log separately.
2. `workout-builder-v3.md` §2.0.3 and `progress-goals.md:28` let the coach apply changes on its own, which conflicts with CLAUDE.md rule 3 and CA8.
3. `workout-table-v3.md:28` hides last time against the research, with no decision recorded.
4. `progress-goals.md` has no no-plan state.
5. Three specs disagree on picking a day on Today.
6. `docs/design/README.md` is out of date: it still describes a "Plan hub" and doesn't list plan-builder, training-blocks, workout-builder-v3 or progress-goals. `today.md`, `workout-overview.md`, `fit-to-time.md` (FT3), `session-picker.md`, `weekly-plan.md` and `workout-builder.md` need "Superseded" banners. Move `progress-goals.html`, `progress-reviews.html` and `today-v2.html` to an archive folder.
