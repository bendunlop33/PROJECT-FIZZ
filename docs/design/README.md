# Design

**Name:** the app is called **GymSmarter** (approved 9 Oct 2026). "Fizz" in older specs means GymSmarter.

Written by the `designer` agent. Last consolidated 8 Oct 2026. Index brought up to date 23 Oct 2026 (Ben's decisions D1–D9 of 22–23 Oct; design review 22 Oct V35): current specs are listed first in each table, and superseded ones are marked.

- **Tokens and components:** `design-system.md` is the only source. If a screen needs a value that isn't there, add it there first. Old component names still used in some specs are listed as aliases in design-system §11.
- **Open questions for Ben and gaps for the developer:** `open-decisions.md` (one deduplicated list).
- **Every other file** covers one screen, flow or area. Each spec has Purpose, Layout, States, Interactions, Copy, Data needed and Acceptance checks. Revision notes at the top of a file say what changed and why. A note dated "(Ben, 22–23 Oct)" records decisions D1–D9.
- **Prototypes:** `prototypes/` (clickable HTML, example data). The whole app is `prototypes/app/`: `python3 prototypes/app/build_app.py OUT_DIR` builds it and checks that the screens agree (shared fixture, muscle lists, a headless click-through).

## Ben's decisions, 22–23 Oct (where each lives)

| # | Decision | Owner spec |
|---|---|---|
| D1 | Start always just starts, today only. Only after a structure change, the Summary asks `Keep for next time?` (Apply / Skip, that plan day or saved workout only, Undo). Time changes never ask | workout-builder-v3 §2.8 |
| D2 | The coach never applies unasked changes: pre-start review = offer line; weekly-review changes beyond CA8 "small" = Apply / Skip; stall resets and unasked +1 sets always need Apply | coach-adjustments (revision), progress-goals (revision), workout-builder-v3 §2.0.3 |
| D3 | Lean Today with a plan: rows, Start, inline Time (fit note), Edit; main lift, accessories, abs, supersets on Your workout | workout-builder-v3 §2.0.2, §2.3a |
| D4 | Back-offs from reps and effort, snapped, band below the top (Strength 2–8 %, Balanced 4–10 %, Muscle 8–15 %), never above the top | workout-builder-v3 §3.1 item 9, plan-builder §2 |
| D5 | Broad groups for picking (Chest, Back, Shoulders, Legs, Arms, Core); detailed list for counting; broad = sum of parts; rear delts = Back | workout-builder-v3 §2.2, §4.7 |
| D6 | A stale lift confirmed `Still right` starts at full weight | plan-builder §1a |
| D7 | Plan setup: ✦ answers preselected, Build at any step, Preferences optional, Other training on Your week; plan overview: one back control, no counter, no day chips, no Swap day; Previous plans with Start again (no saved plans); no-plan Today chip row removed; one split source | plan-builder (revision), profile-and-settings (revision) |
| D8 | A coach change for the next workout, applied in chat, lands on that workout's Your workout draft (today only, Undo) | workout-builder-v3 §2.1, coach-adjustments (revision) |
| D9 | Time on Today and Your workout: the 22 Oct fit (rests; supersets only if on; cheapest cut; never the main lift; ≤ 4-set carry-over) | fit-to-time (revision; FT3, FT8 superseded) |

**Review fixes, 23 Oct** (`docs/reviews/batch23-design.md`, "Fixes" section): `Keep for next time?` lists only Ben's own changes against the template; Your workout's edits stay on Today; stale coach offers are withdrawn; back-offs never equal the top and drop with a lowered top; the plan's focus band everywhere; the fit pairs and cuts by least training lost; the carry-over is an offer by muscle; a named muscle part is the one added. Choices between readings are listed for Ben in workout-builder-v3 §9 (Q-R1 to Q-R10).

**Prototyped or spec only.** Clickable in `prototypes/app/`: D1–D7 and D9 as above, the coach's `Cable fly 3 → 2 sets?` offer. **Spec only:** D8 (a chat change landing on a later Your workout), the `Bench 102.5 → 100` load offer, `↻ Mix it up` on Your workout, Your workout's own Time control, and structure changes made mid-workout reaching `Keep for next time?`. Decision labels inside the prototypes read "(Ben, 22 and 23 Oct)", because `build_app.py` reads a range like 22–23 Oct as a week.

## Your data and Coaching knowledge

Everything Fizz stores belongs to one of two domains (approved by Ben, 8 Oct 2026). Specs, backups, exports, deletes and the coach's "What the coach can see" view always use these two names.

| Domain | What's in it | Where Ben manages it |
|---|---|---|
| **Your data** (about Ben, owner-scoped) | Profile, goals and week; workout history; pre-workout check-ins; coach memories; pain flags; gyms and equipment; routines and plans; conversations; settings; his guide files | Profile, Library (Plan, Workouts), Progress; Data & backup → backup, restore, `Export: My data`, `Delete my data (keep coaching knowledge)` |
| **Coaching knowledge** (general, nothing about Ben) | Approved playbook rules with evidence and sources; research candidate rules; the guide library's index and excerpt metadata; the exercise catalogue and aliases; default presets | Guides & playbook; Data & backup → backup, restore, `Export: Coaching knowledge only`, `Reset coaching knowledge` |

Credentials (ChatGPT sign-in, API keys) are in the Keychain, in neither domain, and never in a backup or export. A general training rule said in chat goes to the playbook as a candidate, never into memory (coach-memory.md CM9). Backups hold both domains in two sections that restore independently (data-import-export.md DX11).

**Backups** are kept in the app by default (automatic, after each workout). A copy off the phone is optional: `Save a copy to Files` any time, or turn on automatic off-phone backups. Fizz uses exactly three phrases so Ben always knows where his data is: `Saved on this phone`, `Backed up on this phone`, `Copy saved to Files` (design-system §7.1).

## Index

### Foundations

| File | Purpose |
|---|---|
| `design-system.md` | Colour, type, spacing, touch targets, motion and timing tokens; status vocabularies; data-domain labels; every shared component with one canonical name (22–23 Oct: `PreStartOfferLine`, `KeepNextTimeRow`, `TodayControlTable`) |
| `open-decisions.md` | Every decision still waiting for Ben (preference, bulk-approve defaults, device tests) and the schema/domain gaps the developer needs |
| `system-states.md` | App-wide states and wording: offline, coach availability, durability, permissions, signing expiry, builds, data integrity, blocking covers; banner priority; the App status screen; app icon and launch screen |
| `premium-feel.md` | Premium feel pass: Today, Rest, motion, haptics, finish |
| `minimal-copy-audit.md` | The minimal-copy convention applied screen by screen |

### Today, the workout and the Summary (the logging loop)

| File | Purpose |
|---|---|
| `workout-builder-v3.md` | **Current.** Today v2 (§2.0; with a plan the lean card: rows, Start, Time, Edit), the builder's Set up and **Your workout** (the only pre-start page; §2.3a today's controls), `Keep for next time?` on the Summary (§2.8), loads and back-offs (§3.1), plan-day templates, coach review, auto-reviews |
| `training-blocks.md` | **Current.** 6-week blocks on the plan: week line in Today's header, planned vs done on Progress, deload, block review and next block |
| `fit-to-time.md` | **Current, 22 Oct revision** (Time on Today and Your workout, one shared fit; D9). FT3 and FT8 superseded; the overview's TIME tile, `How long?` sheet and coach fit belonged to the retired overview |
| `workout-table-v3.md` | **Current.** Active workout v3: the builder's format in the workout, Start passes the session, mid-workout fit |
| `active-workout.md` | Table view and the Focus card (`⋯`): one-tap Log, keypad, supersets, timed, distance and unilateral sets, pain flag note, finish sheet. Mockup `mockups/workout-table.html` |
| `workout-table.md` | Table view proposal (12 Oct), folded into active-workout.md |
| `flow-first-milestone.md` | End-to-end state machine (Today → set → rest → summary), persistence and force-close recovery, how optional layers attach, brief proposals P1–P12, dependency status (`DEP-*`) |
| `check-in.md` | Pre-workout check-in on Start (1–5, Skip): "What's up?" reasons, pain-flag and feeling-ill steps, the coach's lighter-session offer, settings, voice |
| `gym-switch.md` | Mid-workout gym switch (card, Undo, switch back) and `snapPlanToGym`, the one function that fits any plan to a gym's equipment |
| `rest-state.md` | Rest timer inside the workout: presets, adjust/skip, background behaviour, spoken cue modes and scripts |
| `workout-summary.md` | Post-workout facts, comparisons, `Next time` targets (coach or built-in rule), `Keep for next time?` (D1), backup line |
| `history.md` | **New (Ben, 26 Oct).** Today › Recent (last 14 days, workouts and activities) and History (Past workouts grown: by week, All · Workouts · Activities, Show more), keeping repeat, delete, Save to Workouts, Log a past workout |
| `log-past-workout.md` | **New (Ben, 25 Oct).** `Log a past workout` (date, start, no clock) and free date/time editing: moving the start moves the whole workout, with Undo; ordering by workout date |
| `lock-screen-and-alerts.md` | Lock-screen Live Activity, rest-end notifications, loud alerts (AlarmKit), speak-while-locked experiment, alert arbitration and Test rest alert |
| `today.md` | *Superseded* by Today v2 (workout-builder-v3 §2.0). Kept for the states v2 keeps (Resume, stale workout, banners) |
| `workout-overview.md`, `overview-today-edits.md`, `session-picker.md` | *Superseded* (Ben, 22 Oct): the Workout overview is retired; every pre-start entry opens Your workout |

### Plans and the Library

| File | Purpose |
|---|---|
| `plan-builder.md` | **Current.** Goal-led plan builder: Check your lifts, Gym goals, Your week, Your plan (✦ answers preselected, Build at any step, optional preferences; D7), weights and back-offs, editing a running plan with the Changes card, Library › Plan, Apply / End with Undo |
| `routines.md` | Workouts library v1.0 (Part A): Library › Workouts, duplicate/delete with Undo, `Save to Workouts`. Part B: v0.1 reference (superseded where Part A differs; rows now open Your workout) |
| `exercise-library.md` | One exercise picker in four modes (pick one, pick several, swap, browse), custom exercises, history shortcut, substitutions. Library › Exercises filters use the broad groups (D5) |
| `exercise-guides-v2.md` | Exercise guides v2: detailed figure, muscle focus, what not to do |
| `weekly-plan.md` | Weekly pattern, move/skip/replace, missed sessions, endurance entries, trade-off warnings. *Partly superseded*: plans are built and edited in plan-builder.md; the "Plan hub" is now Library › Plan |
| `workout-builder.md` | *Superseded where they differ* by workout-builder-v3.md; its load-honesty rules still apply |

### Setup and settings

| File | Purpose |
|---|---|
| `onboarding.md` | First run: units and rest presets, first gym from a preset, a short "how your data is kept" explainer, optional training profile and coach; restore from a backup on Welcome; in-context permissions |
| `profile-and-settings.md` | The Profile hub: goals, logging, rest presets, gyms, Voice & alerts layout, coach rows, Data & backup row, appearance, App status and About this build. Split and Workout defaults read `Set by your plan` with a plan (D7) |
| `gym-editor.md` | Gyms and equipment that targets must fit: plates, dumbbell racks, stacks, assisted and plate-loaded machines; travel gyms |

### Coach

| File | Purpose |
|---|---|
| `coach-adjustments.md` | Coach-led progression (ADR 0006): Ben-asked and trigger-offered changes to today's sets, guardrails, Undo, coach vs built-in `Next time`; pre-start offers, weekly-review offers and next-workout changes from chat (D2, D8) |
| `coach-contract.md` | Coach honesty contract: every change line from the saved action, the claim check, the tool registry |
| `coach-sheet.md` | The conversation sheet: entry points, workout bar, context view grouped by data domain, action cards, history and retention, `Why?` evidence |
| `coach-memory.md` | What the coach may assume about Ben (personal facts only) and pain flags: memory list, editor, suggestions, pain set/clear |
| `coaching-playbook.md` | Approved rules, research candidates, Ben's guides, conflicts, guardrails and citations |
| `ai-connection.md` | ChatGPT-plan sign-in, optional OpenAI API key, model choice, spend caps and usage estimates, coach reply voice |
| `voice.md` | Tap-to-talk, deterministic spoken set logging and commands, clarifications, spoken replies, audio routes |
| `change-review.md` | The one way any broad change is shown, scoped, applied, undone, expired or rejected as out of date |

### Progress and data

| File | Purpose |
|---|---|
| `progress-goals.md` | **Current: "Progress v3 (agreed)"** at its top: This week, Lifts, Muscles (the detailed counting list, D5), Coach's changes (small ones applied with Undo, bigger ones Apply / Skip, D2). The rest of the file is the rev 2 proposal it supersedes where they differ |
| `progress.md` | Progress tab v1.0 (11 Oct): sessions, muscle frequency, records, calendar; exercise detail with Est. 1RM, top set, volume, rep table and records. *Partly superseded* by progress-goals v3 (Overview); the exercise detail stands |
| `data-import-export.md` | Data & backup: automatic backups on this phone, optional copies to Files, check, restore by domain, FitNotes import, export (`My data` / `Coaching knowledge only`), `Delete my data` / `Reset coaching knowledge` |
| `online-backup.md` | Optional online backup to Google Drive |
| `ai-import-build-plan.md` | Build plan for importing from any app with AI |
| `delete-workouts.md` | Deleting past workouts and single sets; Undo toast, Recently deleted (30 days), effect on derived views, imports, backups and restore |

## How specs relate

```
                      design-system.md  (tokens, components, statuses, data domains)
                              │ used by every spec
     ┌────────────────────────┼─────────────────────────────────────────────┐
     │                        │                                             │
  LOGGING LOOP            COACH (optional layer; never blocks logging)   SET-UP & DATA
  flow-first-milestone ◄── coach-adjustments ── change-review            onboarding
    workout-builder-v3 (Today v2, Your workout, Keep for next time?)     profile-and-settings (hub)
      ├ fit-to-time (Time)  coach-sheet ── coach-memory                    ├ gym-editor
      └ training-blocks     voice            coaching-playbook             ├ ai-connection
    check-in               ai-connection (connection, keys, voice out)     ├ coach-memory, coaching-playbook
    active-workout / workout-table-v3                                      ├ data-import-export
    rest-state ◄────────── lock-screen-and-alerts                          └ system-states (App status)
    workout-summary
  PLANS & LIBRARY          PROGRESS
  plan-builder ─ training-blocks   progress-goals (v3) ◄── workout-summary
  routines, exercise-library       progress (exercise detail)

  system-states: wording and priority of every app-wide state shown by any screen
  open-decisions: what Ben still has to decide, and what the developer still needs
```

Single owners of shared things (other specs link here rather than redefine):

| Thing | Owner |
|---|---|
| Today with a plan (lean card) and Your workout's today controls | workout-builder-v3.md §2.0.2, §2.3a |
| `Keep for next time?` on the Summary | workout-builder-v3.md §2.8 |
| Time / fit to time on Today and Your workout | fit-to-time.md (22 Oct revision, D9) |
| Back-off loads | workout-builder-v3.md §3.1 item 9 |
| Picking groups and counting muscles | workout-builder-v3.md §4.7 (D5); checked by `prototypes/app/build_app.py` |
| Plan setup, Your plan, Library › Plan | plan-builder.md |
| Coach adjustments to today's sets, `Next time` sources, pre-start and weekly offers | coach-adjustments.md |
| Any reviewable plan or template change (scopes, stale, undo) | change-review.md |
| Pain flags list, set and clear; `setPainFlag` signature | coach-memory.md |
| API keys, caps, usage, coach reply voice | ai-connection.md |
| Voice strip states and spoken set logging | voice.md |
| Cue modes and cue scripts | rest-state.md §5 |
| Rest-alert layers, Alert check, Test rest alert | lock-screen-and-alerts.md |
| Backup status (`getBackupStatus`), restore, import, export, delete/reset | data-import-export.md |
| Banner priority, durability wording, App status | system-states.md |
| Equipment and achievable-load editing | gym-editor.md |
| Fitting a plan to a gym (start, Repeat, mid-workout switch); `snapPlanToGym` | gym-switch.md |
| Exercise picker and substitutions | exercise-library.md |
| Pre-workout check-in: when it's asked, its record, settings, offer conditions, spoken grammar | check-in.md |

## Prototypes

| File | What it shows |
|---|---|
| `prototypes/app/` (`app-shell.html`, `build_app.py`, `check_app.mjs`) | **The whole app** built from the screens below: Today with and without a plan, Library, Progress, Profile, the Summary (with `Keep for next time?`) |
| `prototypes/training-blocks.html` | Today with a plan (lean card), Progress with a plan, block review |
| `prototypes/workout-builder-v3.html` | The builder: Set up (broad groups), Your workout (today controls, coach offer line) |
| `prototypes/plan-builder.html` | Plan setup and Your plan |
| `prototypes/workout-active-v3.html` | The active workout |
| `prototypes/progress-simple.html` | Progress without a plan |
| `prototypes/today-v2.html`, `progress-goals.html`, `progress-reviews.html`, `mockups/*` | Older studies (superseded by the files above; kept for history, still date-checked by `build_app.py`) |

## Research dependencies

Optional layers depend on device tests. Search the specs for `DEP-AUDIO`, `DEP-NOTIF`, `DEP-LIVE`, `DEP-STT`, `DEP-AI`, `DEP-ALARM`, `DEP-FILES` and `DEP-UPDATE-FEED`. Their status after device probe build 7 is in flow-first-milestone.md §2 and open-decisions.md.
