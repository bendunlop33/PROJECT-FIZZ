# Workout library, edit before start, and session length

Status: research, 11 Oct 2026 (all sources checked that day). Competitor-researcher, for Ben's request on the session picker. Proposals only: Ben decides.

**Summary**
- Every serious logger keeps a saved-workout library: Strong (templates and folders), Hevy (routines and folders), FitNotes (routine days on Android; templates and groups on iOS). GymSmarter's routines spec (`docs/design/routines.md`) already covers this, but the editor isn't built (backlog: XL). That gap matters most.
- Edit before start: FitNotes copies the workout into today and lets you edit it. Hevy and Strong start the session, let you edit it live, and then ask on Finish whether to update the template. GymSmarter's overview today-edits (Swap, Skip, Do first, Reorder) are ahead of all three for safety, but they can't yet add an exercise, change sets or reps, or save the edited version.
- Session length is only a real per-session control in Fitbod (15–90 min Quick Edits; it scales the exercise count). Alpha uses duration only when generating a plan. No app found fits a saved routine to a chosen time while keeping the main lifts and showing an honest estimate. That is the opening.
- Users complain that estimates are too short or wrong, that the "update routine?" prompt on Finish risks overwriting a template, and that length can only be shortened, never extended.
- Top recommendation: a `How long?` control on the overview's TIME tile. It gets a built-in trim (deterministic, today only, Undo) and a coach option, and the estimate always comes from code.

Legend: **[Doc]** = vendor site, help or listing, opened. **[Doc-snippet]** = vendor page seen only as a search-result summary (the page returned 403). **[User]** = review or forum anecdote. **[Inference]** = my reading. App Store screenshots couldn't be viewed through the fetch tool, so UI claims below come from help text, not pictures.

---

## 1. Pattern matrix

| App | Saved-workout library | Organise | Edit before start | Save a done/ad-hoc workout to the library | Update the template after a workout | Choose session length | How it adapts to length |
|---|---|---|---|---|---|---|---|
| FitNotes (Android) | ✓ Routines → Days → exercises [F1] | Routine dropdown; days reorderable [F1] | ✓ `Log All` copies the day into today; deselect sets or exercises, edit values before saving [F1] | partial: `Copy` routine; copy previous workout [F1][F2] | n/a (the template isn't touched by logging) | ✗ | ✗ |
| FitNotes 2 (iOS) | ✓ Templates [F3] | ✓ Groups ("like folders"), select-mode reorder, duplicate, rename, move [F3] | ✓ Template is logged *into* the current workout (doesn't replace it); then normal editing [F3][F4] | ✓ `Convert to Template`, `Convert Selection to Template` [F4] | n/a | ✗ | ✗ |
| Strong | ✓ Templates; free 3 [S1] | ✓ Folders (iPhone), drag-and-drop, Archive [S3] | ✗ separate step: edit the template, or edit live after Start [S2] | ✓ Prompt on Finish of an empty workout; also from History [S4] | ✓ Prompt: `Update Template` / `Update Values Only` / `Update Template and Values` / `Keep Original`; destructive shown red; can be hidden [S4] | ✗ | ✗ |
| Hevy | ✓ Routines; free 4 [H3] | ✓ Folders, drag-and-drop, Duplicate, Share [H1] | partial: Edit routine from its menu; otherwise edit live after `Start Routine` [H1] | ✓ Profile → past workout `⋯` → Save as routine [H1] | ✓ "Hevy will ask if you want to update the original routine" [H1] | ✗ | ✗ |
| Fitbod | partial: generated workouts; "save, build, or reuse favourite" workouts [B3] | ? | ✓ Regenerate, swap, add sets [B2] | partial [B3] | n/a | ✓ per gym profile (default 60 min, "1 minute to 4 hours"); Quick Edits 15/30/45/60/90 for one workout [B1] | Scales **number of exercises**; help gives ranges such as 4 exercises ≈ 27–51 min [B2] |
| Alpha Progression | ✓ Plans with days; import workouts from other plans (v6.4) [A1] | ? | partial: swap an exercise "for just today's workout or keep the change in your plan" [A2] | ? | partial: the same today/plan choice [A2] | partial: "how long you have" is a **plan-generator** input (Pro) [A1][A2] | At generation only; no per-session fit documented [A2] |
| JEFIT | ✓ Plans with days; public routine library; "Set Plan" [J1] | partial: duplicate or rename days [J1] | partial: edit sets, reps, rest in the plan [J1] | ? | ? | ✗ (none found) | ✗ |
| Future (human coach) | n/a (the coach writes the week) | n/a | via message to the coach [U1] | n/a | n/a | via the coach; a review lists "not ideal" for sessions other than about 30 min as a con [U1] | Human. Marketing shows a coach shortening a workout after a "hectic" day [U2] |
| Caliber | ? | ? | ? | ? | ? | ? (no reliable source found) | ? |
| **GymSmarter (designed / built)** | designed (routines.md), editor not built | `Your rotation` + `All routines` (no folders) | ✓ built: Swap, Skip, Do first, Reorder today (overview-today-edits) | designed: Summary `Save as routine`; picker `⋯ Save as routine` (hidden while today's edits exist) | ✓ by design: coach next-session values saved by default (D21); structure changes only via change-review card (TE4) | ✗ before start; `Finish by` and coach `Shorten` designed for step 4 (active-workout §2.15) | Coach skips lowest-priority sets; minutes from `estimateRemainingDuration`; offline: none yet (AW12) |

---

## 2. Per app

### FitNotes (Android): Ben's reference app
- **[Doc]** A Routine contains Days; each Day holds exercises with optional **Predefined Sets**. A field can be fixed (e.g. warm-up loads) or left blank to "copy from the previous workout" [F1].
- **[Doc]** Logging: `Log All` beside a Day adds its exercises to the current workout. Ben "can deselect any sets or exercises you don't want, and edit values before saving" [F1]. Routines are presented as the easier alternative to copying previous workouts from the Home screen [F1]. The overflow menu can `Copy` a whole routine [F1].
- **[Doc]** When an exercise has history, the set fields fill from "the first set from the last workout" [F2].
- **[User]** A r/FitNotesApp post (2019, seen in a search summary; mirror page returned 403) asks to label a session and load it without doing it first, rather than using "copy workout" [U3].
- **[Inference]** For Ben, "editing before start" means the workout becomes *today's* list, freely editable, with the template untouched. That is GymSmarter's pre-start draft (ADR 0022), so the mental model already matches.

### FitNotes 2 (iOS, separate developer)
- **[Doc]** Templates sit at the top level or inside Groups ("like folders"). Long-press offers rename, move, new group, duplicate, delete and share. Templates import from JSON or HeavySet-style text [F3].
- **[Doc]** Each exercise in a template has one of four set modes: Copy Previous Sets, Don't Populate Sets, Use Predefined Sets, Percent of Training Max [F3].
- **[Doc]** Logging a template "does not replace the workout", so a template can be a block (e.g. a finisher) added to any workout. `Convert to Template` saves the whole workout; `Convert Selection to Template` saves only the selected exercises [F3][F4].
- **[Doc]** Free tier saves up to 12 workouts. Unlimited costs $1.99 or $14.99, Forever $44.99. Rated 4.6 from 569 US ratings; v14 (9 Sep 2026) [F5].
- **[User]** A listing review says the only way to fix a wrongly recorded workout length is to finish and then edit the time by hand [F5].

### Strong
- **[Doc]** A template is "a starting point for a workout". Sets can't be completed in a template, and free users get 3 [S1].
- **[Doc]** Folders (iPhone), drag-and-drop, collapse, Archive instead of delete, and hideable example templates [S3]. Edit or delete is in the `⋯` menu [S2].
- **[Doc]** On Finish, Strong offers to save an empty workout as a new template. For a template workout it offers `Update Template` (red when destructive, e.g. removed exercises), `Update Values Only` (weights and reps), `Update Template and Values`, or `Keep Original Template`. The prompt can be hidden in Settings, and Strong says the flow "will be adjusted in future versions" [S4].
- **[Doc]** A help page exists for "Templates keep disappearing (iOS)" [S5].
- **[Inference]** Strong's split between values and structure is the useful idea. GymSmarter already makes it structurally: values come from coach targets (D21), and structure goes through a proposal (rule 2).

### Hevy
- **[Doc]** Routines live in folders on the Workout tab. `⋯` offers Share, Duplicate, Edit and Delete. A past workout can be saved as a routine from Profile [H1].
- **[Doc]** `Start Routine` starts the stopwatch. In the session you can add, remove, swap and reorder exercises and sets. On Finish, "Hevy will ask if you want to update the original routine with any changes you've made" [H1].
- **[Doc]** The listing doesn't show an estimated routine duration (none on the feature pages either) [H2]. Free tier: 4 routines; Pro $2.99/mo, $23.99/yr, $74.99 lifetime. Rated 4.9 from 97K US ratings; v3.1.16 (2 Oct 2026) [H2][H3].
- **[User, weak]** A search summary described an r/Hevy post: the user changes the routine most sessions, gets the update prompt every time, and fears tapping yes by accident. The specific thread couldn't be opened, so treat this as unverified [U4].

### Fitbod
- **[Doc]** Duration is set per gym profile: default 1 h, "1 minute to 4 hours". The iOS Quick Edits menu generates a 15/30/45/60/90-minute workout without changing the profile. The page's own words are "Shorten your workout to fit your schedule" (blog, last modified 6 Feb 2026) [B1].
- **[Doc-snippet]** Training Session Mods cover 15 min–1 h 30 and scale "the number of exercises". Help gives ranges by exercise count: 4 main exercises "typically between 27 and 51 minutes", 5 → 35–60, 6 → 39–63, and about 7 exercises in an hour. If a workout comes out short, help says to refresh it, add exercises or sets by hand, or change the gym profile duration [B2].
- **[Doc]** Price: $12.99 or $15.99/mo, $79.99 or $95.99/yr. Rated 4.8 from about 287K ratings; v8.35.1 (Oct 2026) [B3].
- **Marketing vs real.** "1 minute to 4 hours" is marketing. Fitbod's own help admits ranges about 24 min wide for one exercise count. **[Inference]** Fitbod picks a count, not a time, so the duration is a coarse target.

### Alpha Progression
- **[Doc]** The plan generator (Pro) asks for goal, days, "how long you have" and priority muscles. "Every detail stays editable." v6.4 can import workouts and days from other plans. $12.99/mo, $79.99/yr; rated 4.9 from 2.2K ratings; v7.7 [A1].
- **[Doc]** Swap an exercise "for just today's workout or keep the change in your plan". The FAQ builds plans around "preferred workout duration". No shorten-to-fit is described [A2].
- **[User]** A reviewer replaced or deleted exercises in the generated plan easily [A1].

### JEFIT
- **[Doc-snippet]** Custom plans are built by days per week, goal and difficulty. An edit button changes sets, reps, rest and intervals. Library plans are applied with `Set Plan`, and days can be duplicated or renamed [J1]. No session-length control was found.

### Future and Caliber (coach-led)
- **[Doc-snippet]** Future's marketing shows a coach note about shortening a workout after a hectic day [U2]. A Healthline review lists "not ideal" for people who want sessions longer or shorter than 30 minutes [U1]. Length is adapted by a human, by message.
- Caliber: no reliable public documentation of a session-length control was found. Only low-quality SEO pages turned up, so it's marked `?`.

### Duration estimates elsewhere (context, not direct competitors)
- **[User]** Freeletics forum (31 Jan 2024): the workout "can be compacted in 45 min" but comes to about 25 min with dumbbells, and "there is no possibility to extend it, only to shorten it" [U5].
- **[User]** Trainerize ideas board (4 Jan 2022, 416 votes): "Estimated workout time is inaccurate (too short) 99% of the time" [U6].

---

## 3. What users praise and complain about

| Theme | Evidence | Type |
|---|---|---|
| Praise: editing plans or workouts is easy (replace, delete exercise) | Alpha reviewer [A1]; Hevy reviewer "easy to replace and add when you're in the gym" [H2] | User |
| Praise: one-tap reuse of past work (copy previous, routines) | FitNotes docs and users [F1][U3] | Doc / User |
| Complaint: template caps on free tiers (3 / 4 / 12) | Strong, Hevy, FitNotes 2 [S1][H3][F5]; Strong cap complaint in landscape | Doc / User |
| Complaint: the Finish-time "update routine?" prompt risks an accidental overwrite; asked to turn it off | Hevy [U4] (weak); Strong made it hideable and promises changes [S4] | User / Doc |
| Complaint: templates vanish (sync) | Strong help article [S5] | Doc |
| Complaint: duration estimates are wrong, usually too short | Trainerize [U6]; Fitbod's wide ranges [B2] | User / Doc |
| Complaint: can shorten but not lengthen | Freeletics [U5] | User |
| Complaint: workout length recorded wrong and hard to fix | FitNotes 2 review [F5] | User |

---

## 4. Recommendations for GymSmarter (ranked)

Each item gives effort (S/M/L/XL), where it fits in the build order (CLAUDE.md), the rules it touches and the evidence.

### R1. Build the routine editor and library (already specified). XL. Build step 2, the next big item.
- **What:** routines.md §2.1–2.3 as written: list (`Your rotation` / `All routines`), detail, editor (sets, reps, Auto/Fixed/%, rest, supersets, reorder), Duplicate, Delete with Undo. It's the "depository" Ben asked for. Every competitor has one, and FitNotes, his reference, is built around it [F1][F3][S1][H1].
- **Naming:** Ben calls them "workouts". FitNotes Android says Routines; FitNotes 2 and Strong say Templates; Hevy says Routines. Ben should pick the label (see Proposed brief changes, P4).
- **Not v1:** folders and groups. With one user and about 5–15 routines, the rotation section already groups them. Add `Archive` (Strong [S3]) before folders if the list grows.
- **Rules:** 4 (loads checked by `snapPlanToGym` at Start), 5 (versioned save, conflict sheet), 10 (routines are Your data).

### R2. A `How long?` control on the overview, with a built-in fit. M. Step 2/3 (pure domain function plus a sheet).
- **Where:** the overview's existing `≈ 45 min · TIME` tile becomes a button. A sheet offers chips `30 · 45 · 60 · 75 · 90 · Other`, defaulting to the plan's own estimate. No lead text.
- **Built-in fit (`fitPlanToMinutes`, pure, `packages/domain`, unit-tested):** it's a new `TodayEdit` variant `{kind: 'fit', minutes}` stored as intent, so it re-runs whenever other edits or the gym change (TE2: preview = Start). Order:
  1. Trim working sets from the lowest-priority exercise upward, down to a floor of 2 working sets per exercise (playbook rule 2: 2–3 per lift per session).
  2. Skip whole lowest-priority exercises (shown `⊘ SKIPPED`, with `Bring back` as today; TE7).
  3. Main lifts and Ben's priority muscles go last (playbook "Order" row and rule G). Priority follows routine order when nothing else ranks them.
  4. **Never** raise a load, reps or sets; never shorten rest or warm-ups of kept lifts; never swap or superset. Those match the existing shorten guards (`shorten_no_increase`, `rest_unchanged`; active-workout §2.15.4) and the brief's "not extra rushed work" (§7 `shortenSession`).
  5. If the priority work alone is still too long, it stops and shows the true estimate (`≈ 52 min`). It never makes hidden extra cuts.
- **Result:** the tile shows the new `≈` value, and the list header reads `N EDITED`. One toast says `Fitted to 45 min` with [Undo]. Minimal copy: no rule text, and `Why?` on the tile lists what was trimmed.
- **Longer than planned:** the built-in fit does nothing (it never adds work). The sheet offers the coach instead (R3). Freeletics shows "shorten only" annoys users [U5].
- **Why built-in:** it works offline (rule 1). Active-workout §2.15.4 currently leaves offline users to skip exercises one by one (AW12), and Fitbod's count-based scaling is coarse [B2].
- **Rules:** 1, 3 (Ben asked, today only, applied at once with Undo), 4 (loads untouched, still snapped), 6 (estimate labelled `≈`).

### R3. A coach fit in the same sheet. S–M on top of step 4's `shortenSession` path. Build step 4.
- **What:** an `Ask coach` row in the `How long?` sheet. It sends `requestCoachAdjustment({intent: 'fit', targetMinutes}, …)` with the pre-start draft as its scope.
- **Shortening by trim or skip** applies at once with a before → after banner and Undo, the same as the designed mid-workout Shorten. Ben asked, it's today only, and that is CLAUDE.md rule 3.
- **Adding work for a longer session** (extra sets, an extra exercise) is fine today-only when Ben asks, bounded by validators.
- **Swaps or supersets** to save time come back as a change-review card with Apply. That follows active-workout's "a swap stays a ChangeReviewCard".
- **Minutes** always come from `estimateRemainingDuration`, never from the model (WB5, rule 6). This answers the main estimate complaint [U6][B2].
- **Offline:** the row reads `Coach offline` and the built-in fit still works (rule 1).

### R4. Fuller edit-before-start: Add exercise, sets and reps today. M. Step 2 (extends ADR 0022 drafts).
- **What:** two new `TodayEdit` variants on the overview.
  - `add` (exercise picker; targets from its own history through the built-in rule, else `No history`, fitted by `snapPlanToGym`).
  - `sets` (± working sets on a row panel; reps range edit), applied at once with toast Undo (TE3).
- **Why:** FitNotes' `Log All` lets Ben deselect or edit before saving [F1], and FitNotes 2 lets a template be added to an open workout [F3]. Today's overview can only swap, skip and reorder.
- **Rules:** 2 (nothing outside today changes), 4, 9 (a pain-flagged exercise is marked in the picker, EL6).

### R5. Save the edited version to the library: `Save as new routine` and `Update Push A`. S. Step 2/3.
- **What:**
  - On the overview `⋯`, `Save as routine` stays available **with** today's edits. It creates a new routine from the edited plan, which changes session-picker §4.3's "hidden while the page has today's edits".
  - `Update Push A` collects all of today's structural edits into **one** change-review card (author Ben, scope `Push A from now on`, before → after, Apply, Undo). It extends TE4 from swaps only to all edits.
  - On Summary, keep `Save as routine` (designed) for empty or ad-hoc workouts, and add it to a past workout's `⋯` in History, as Hevy and Strong do [H1][S4].
- **Avoid:** the Hevy/Strong prompt on every Finish [U4][S4]. Values already update by default (D21), so only structure is ever offered, and only from an explicit button.
- **Rules:** 2, 5 (a stale card is rejected if Push A changed since).

### R6. Default session length per gym. S. Step 2.
- **What:** a `Usual length` field on each gym profile. It sets the `How long?` default, so a hotel gym can be 30 min and the main gym 60. Fitbod does this per gym profile [B1].
- **Overlap:** the brief already has "preferred session length" in first-run setup (§ First-run). Per gym is the refinement (P2).

### R7. Blocks: add a saved routine *into* today. M. Later (after R1).
- **What:** `Add from routine` on the overview or in an empty workout, appending a routine's exercises (a core finisher, a warm-up block). It's FitNotes 2's "does not replace the workout" and `Convert Selection to Template` [F3][F4].
- **Why later:** useful, but Ben hasn't asked for it, and R1 and R4 cover most of the need.

### R8. Library extras. S each. Later.
- Archive instead of delete [S3], folders (only if Ben asks), sharing or importing templates as text [F3]. Template import is low value for one user, except for FitNotes routine import (step 3: check whether Ben's `.fitnotes` backup carries routines; see fitnotes-export-format.md).

### Things to avoid
- Prompting to update the template on every Finish [U4][S4].
- Model-made duration numbers [U6].
- Silent cuts beyond the chosen time, or trimming rest to "fit". Both break rule 3 guards and the brief's "not extra rushed work".
- Caps or artificial limits on saved workouts (personal app).

---

## 5. Proposed brief changes (for Ben to approve)

| # | Change | Why |
|---|---|---|
| P1 | Add a **built-in, offline fit-to-time** before start (R2), as a labelled fallback beside the coach's `shortenSession` (ADR 0006 pattern). It needs a note in ADR 0006 or a new ADR | Brief §7 `shortenSession` is coach-only, and active-workout AW12 leaves offline fitting for "later". Ben asked for "GPT or a pre-existing option" |
| P2 | Make preferred session length **per gym** (default for the `How long?` control), not only global at first-run | Fitbod per-profile duration [B1]; Ben trains at more than one gym |
| P3 | **Flag, conflict:** brief §7 says `shortenSession` "propose[s]" edits, but CLAUDE.md rule 3 says changes Ben asks for to today apply immediately with Undo. Active-workout §2.15.4 already follows rule 3. Recommend the brief wording becomes "applies priority-preserving edits to today with Undo; swaps or supersets are proposals" | Avoid silently picking one source |
| P4 | Choose the library's UI name: `Routines` (current specs, FitNotes Android, Hevy) or `Workouts` (Ben's word) | Ben's request says "workouts"; current specs say "Routines" |
| P5 | Extend TE4: `Update Push A` turns **all** of today's structural edits (swap, skip, add, order, set counts) into one change-review card; `Save as routine` is allowed with edits | Ben asked to save edited workouts back into the library |

---

## 6. Sources (all checked 11 Oct 2026)

- [F1] FitNotes Android, Routines: http://www.fitnotesapp.com/routines/
- [F2] FitNotes Android, Workout tracking: http://www.fitnotesapp.com/workout_tracking/
- [F3] FitNotes 2 docs, Templates: https://getfitnotes.com/docs/templates.html
- [F4] FitNotes 2 docs, Workouts: https://getfitnotes.com/docs/workout.html
- [F5] FitNotes 2, US App Store: https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016
- [S1] Strong help, About templates: https://help.strongapp.io/article/105-about-templates
- [S2] Strong help, Edit or delete a template: https://help.strongapp.io/article/106-edit-template
- [S3] Strong help, Organise templates: https://help.strongapp.io/article/107-organize-templates
- [S4] Strong help, Save or update a template on Finish: https://help.strongapp.io/article/177-update-template
- [S5] Strong help, Templates disappearing (title only): https://help.strongapp.io/article/253-templates-disappearing
- [H1] Hevy, Routines feature page: https://www.hevyapp.com/features/gym-routines/
- [H2] Hevy, US App Store: https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350 and https://www.hevyapp.com/features/track-workouts/
- [H3] Hevy free vs Pro (help centre, seen via search summary; page not opened): https://help.hevyapp.com/hc/en-us/articles/35119778922263
- [B1] Fitbod blog, Your gym profile (last modified 6 Feb 2026): https://fitbod.me/blog/your-gym-profile/
- [B2] Fitbod help, duration ranges and session mods (403; search summaries only): https://help.fitbod.me/hc/en-us/articles/16254175592215 and https://help.fitbod.me/hc/en-us/articles/38318585683991
- [B3] Fitbod, US App Store: https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543
- [A1] Alpha Progression, US App Store: https://apps.apple.com/us/app/gym-workout-alpha-progression/id1462277793
- [A2] Alpha Progression site and FAQ: https://alphaprogression.com/en
- [J1] JEFIT, custom plans (search summary): https://www.jefit.com/blog/how-to-create-custom-workout-plans
- [U1] Healthline, Future review (search summary): https://www.healthline.com/nutrition/future-fitness-review
- [U2] Future marketing site (search summary): https://website.future.co
- [U3] r/FitNotesApp (mirror, 403; search summary): https://redlib.hbubli.cc/r/FitNotesApp
- [U4] r/Hevy (mirror listing, thread not identified; search summary, weak): https://redlib.groet-infra.nl/r/Hevy/new
- [U5] Freeletics forum, workout length: https://forum.freeletics.com/t/dumbell-journey-workout-lenght/14102
- [U6] Trainerize ideas, estimated workout time: https://ideas.abcfitness.com/forums/167887-coach-trainer-abc-trainerize/suggestions/44636433-remove-estimated-workout-time-or-make-it-optional

Related GymSmarter docs: `docs/design/routines.md`, `docs/design/overview-today-edits.md`, `docs/design/session-picker.md`, `docs/design/active-workout.md` §2.15, `docs/design/workout-builder.md` WB5, `docs/backlog.md`, `docs/training-guides/playbook-v1.md`, `docs/research/competitor-landscape.md`.
