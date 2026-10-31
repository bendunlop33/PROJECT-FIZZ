# Fit to time (How long? on the overview; built-in trim and coach fit)

> **Revision (Ben, 28 Oct): `+` makes a session longer properly; the estimate learns Ben's pace.** Replaces "Longer (+) is unchanged: rests back to Standard first, then exercises, then sets" and the plan buffer for an explicit `+`. Shorter (`−`) is unchanged (arms first, `Rest when short on time`).
> 1. **`+` order, only as far as needed to reach the length:** (a) rests back to normal, a level at a time; (b) +1 set on the accessories, round by round in workout order, up to 4 each. A plan day's stored exercises grow for today too; only an exercise Ben edited today (`touched`) never does, and timed or cardio work doesn't; (c) +1 set on the main lift, up to 5 working sets; (d) add exercises: the day's main group first, then the secondary group (arms on a Chest, Back or Shoulders day; a Legs or Arms day adds from its own group only), up to 8 exercises, never a near-duplicate (`autoPickClash`), 3 sets each or 2 when that lands nearer the length; (e) nothing left to add: `Nothing more to add` (a toast; nothing changes).
> 2. **Reaching the length:** a step is taken while the workout is short of the length when it lands within it or nearer to it (a tie goes to the step). If no step would, the smallest one is taken anyway, so every `+` moves something while anything can be added.
> 3. **Where:** Your workout's `+` (the explicit tap) steps from the live estimate to the next 5 minutes at least 3 minutes up (`liveTime` `growFromEstimate`: 32 → 35, 34 → 40), grows today's draft only and records it as Time's fill (`added`, `raised`, `filledTo`; the plan day and saved workout never change, Start never offers it for next time). Each `+` adds to the last; `−` on a fill fills less (from the workout as it was, so the same Time gives the same workout); the note's Undo gives the workout back as it was. Today's card grows only when its Time is above the plan's length, with no plan buffer kept. The routine editors' `Time ±` (`fitTemplateToMinutes`) is not changed.
> 4. **Ben's pace (estimate, rule 6):** the one estimate (`estimateBuilderSeconds`: Today's card, Your workout, the workout editor, the plan builder's day sizing, the fit itself) uses Ben's own pace from his logged times (`learnPace`): seconds per set (45 s by default; fitted only when his planned rests differ enough to tell set time from rest), rest overrun (actual ÷ planned rest, default 1), changeover between exercises (60 s). Only workouts logged live in the last 60 days count (never imports or `Log a past workout`), paused time is taken out, gaps under 20 s (batch logging), far past their rest (3 × rest + 5 min) or changeovers over 20 min are outliers. Blended with the defaults until 3 timed workouts (weight n/3), capped (set 30–75 s, rest ×0.85–×1.5, changeover 30–180 s). No new copy. Not changed: the active workout's `Time left` and its `+N min` offer keep their own pace (`time-left.ts`).
>
> Built: `grow`, `GROW_RULES`, `growSecondaryGroup` (`packages/domain/src/builder/fit.ts`), `fitWorkoutToTime` grow (`builder/time-fit.ts`), `learnPace` (`builder/pace.ts`) with `ctx.pace` in `estimate.ts`; `builder.setTime(…, { grow: true })`, `listPaceWorkouts` (persistence). Tests: `packages/domain/test/builder-grow-28oct.test.ts`, `builder-pace-28oct.test.ts`; real SQLite `apps/mobile/test/plan-progress-28oct.test.ts`.

> **Revision (Ben, 27 Oct (2), redesign-27oct.md §F): arm isolations go first.** On any day whose main group isn't Arms (Chest, Back, Shoulders, Legs; a Push or Pull day by its main lift's group), when exercises must be cut the **arm isolations (biceps, triceps) go first**: trimmed to 2 sets, then left out, **before any other accessory loses a set** (the day's main-group accessories, abs and the rest). Within the 27 Oct order below:
> 1. Accessory rests (to `Rest when short on time`) and, with Supersets on, pairs still come first; the arm isolation keeps its sets while those are enough.
> 2. Step 3 (sets) now starts with the arm isolations: their sets to 2, then the arm isolation left out (the one exception to "nothing left out" in step 3), and only then other accessories' sets to 2.
> 3. Step 4 (leave out) is unchanged except that an arm isolation is always among the first to go.
> 4. The sub-role guards stay above it: on a Back day the vertical pull and the row are still weighed first, so a curl is trimmed and left out before any Back lift is trimmed.
>
> The main lift is untouched, as before. An Arms day (or a day with no known main group) fits as before, and an arm *compound* (close-grip bench, dips) is weighed as before. Among the arm isolations, and among the rest, the least training lost (`FIT_SET_VALUE`) still decides. The workout's `+N min` offer (`session/time-fit-today.ts`) uses the same fit, so the rule applies mid-workout too (pending sets only; done sets never change). Because leaving an arm isolation out can leave its pair partner alone and needing its own warm-up, Today's card and Set up check each cut with the warm-ups the workout will get (`settle`) and cut further if that runs over. Consequence: an arm isolation left out counts in the week's carry-over offer like any other (`+3 Triceps sets on your next … day?`). Built: `armsCutFirst` and the `held` value in `packages/domain/src/builder/fit.ts`; tests `packages/domain/test/builder-fit-arms-first.test.ts` (plus the updated ladders in `builder-fit-order`, `builder-fit-sub-roles`, `builder-v3-build`, `builder-time-fit` and `time-fit-today` tests).

> **Revision (Ben, 27 Oct): fit-to-time order for less time, and `Rest when short on time`.** Replaces the 22 Oct revision's "free savings first: shorter rests, then shortest" for every slot. Shorter now goes, only as far as needed:
> 1. **Accessory rests only**, one level at a time, no lower than Ben's Profile › Training › `Rest when short on time`: `Standard rest` (rests never shortened for time), `Medium rest` (compound accessory 2:00 → 1:30; isolation and superset round 1:30 → 1:15), `Minimum rest` (**default**: isolation and round on to 1:00; a compound accessory never below 1:30). **The main lift's rests (top, back-off, working) never change for time**, whatever is picked. Ben's own rests and slots he edited stay as they are.
> 2. **Then pairs**, with Supersets on only (unchanged rules).
> 3. **Then accessory sets 3 → 2**, nothing left out: the most training value kept, so the lowest-value sets go first (`FIT_SET_VALUE`: extra 1.5, isolation 2, abs 2.5, compound 3; "least training lost", so one compound set can go instead of two isolation sets when it saves the time alone). Wherever trimming alone fits, no exercise is left out. On a day with main sub-roles (Back's vertical pull and row, 24 Oct) their sets go to 2 only once every other accessory is at 2; the 24 Oct ladder (others left out, then the pair's sets, then the row) applies once something must be left out.
> 4. **Only then leave out whole accessories** (the least training lost and the sub-role guards, as before).
>
> Main-lift sets, loads and rests never change for time. Longer (+) is unchanged: rests back to Standard first, then exercises, then sets. The workout's `+N min` offer (workout-table-v3 §5) and Today's card follow the same order and read the same setting; the offer never shortens a main lift's rest, even one longer than the default. The fit's note names the levels as the setting does (`Medium rest`, `Minimum rest`, `Standard rest` when more time puts them back). The setting is Your data on the training profile (one versioned write per tap; no migration: the profile is a JSON document). Built: `BUILDER_REST_LEVELS`, `REST_LEVEL_NAMES`, `fitRestLevelOf` (`packages/domain/src/builder/rest.ts`), `fitToMinutes` steps 1–4 (`builder/fit.ts`), `timeFitOffer` (`session/time-fit-today.ts`), `RestWhenShortScreen`. Tests: `packages/domain/test/builder-fit-order.test.ts`. Not changed: the routine editors' `Time ±` (`fitTemplateToMinutes`) still shortens accessory rests to Medium only and doesn't read the setting (open, below the PM flags).

> **Sub-role coverage (Ben, 24 Oct).** When Time cuts a day whose main group has main sub-roles (the builder's `BUILDER_SUB_ROLES`; today only Back: a vertical pull, then a row), the fit keeps one exercise for each (a compound of it first, else the earliest; a sub-role the main lift or one of Ben's edited exercises already covers needs none). Order, the first that fits:
> 1. **Other exercises are cut first** (sets, then whole exercises, by the least training lost as before); the vertical pull and the row keep every set.
> 2. **Still too long: both stay and lose sets** (never below 2), before anything else that could be kept.
> 3. **Still too long: the row goes, the vertical pull stays** (at 2+ sets). With more main sub-roles, the later ones go first.
> 4. **Not even that fits:** coverage is given up and the plain least-lost fit (or the shortest it can be) applies.
>
> A second exercise for a covered sub-role (a second row) is an ordinary accessory. Rear delts and traps aren't main sub-roles. Days whose main group defines no sub-roles fit as before. Built: `subRoleGuards` and the guarded step (c) in `packages/domain/src/builder/fit.ts`; tests `packages/domain/test/builder-fit-sub-roles.test.ts`.

> **Warm-up time (23 Oct; Ben approved WU1–WU12 incl. WU11 on 22 Oct).** The fit's minutes (`estimateBuilderSeconds`, workout-builder-v3 §3.6) time each exercise's warm-ups with WU11 from the shared planner (`packages/domain/src/warmup`): `warmupTimeS` (Σ reps × 4 s + 60 s between steps) plus the rest before the first working set (`warmupRestS`: 2 min rep band, 3 min heavy band; Ben's own warm-up rest wins). The old §3.6 constants (30 s a warm-up + its rest, then +1 min) are retired. Dropping an exercise still drops its warm-ups, so an exact fit can drop one accessory whole and give another a set back at a shorter length; the exercises other than one Ben edited never get sets back in total (FT5).

> **Warm-ups setting (Ben, 23 Oct).** A plan's Your week › `Warm-ups` (Full / Short / None, plan-builder.md) decides how the plan's days plan warm-ups, so the fit's minutes follow it: Full is WU1–WU12 within D17 as above; Short takes every WU11 cut to its floors (no general warm-up, no WU6/WU7 steps, the short ladder on heavy lifts); None plans none. Today's card, Your workout's Time and Start read the same setting (`settleWarmups` with `warmups`), so a shorter warm-up leaves more of Time for working sets and nothing is cut to pay for warm-ups Ben doesn't do. Warm-ups Ben set himself on an exercise are kept and still timed. The plan builder's per-day set capacity uses the same warm-ups (that day's own, not a flat 8 minutes).

> **Revision (Ben, 23 Oct; SP3 answered): the carry-over is a real offer, never applied by default.**
> - **Where.** Behind Your workout's Time note, under the fit's lines: `+3 Triceps sets on your next Shoulders day?` `Carry over` `✕`. A card Today fitted shows it there too once opened with `Edit` (the fit record goes with it). *(23 Oct, later: was "Today's lean card itself shows no offer".)* **Today's lean card shows the same offer behind its Time note** (workout-builder-v3 §2.0, D3), worked out from the same fit record Start saves. Ben's answer is written with Today's own draft for the card (one versioned write, op ID; refused when the offer or the draft moved, rule 5), so Edit, Start and a force-close keep it; it is for that Time (another Time asks again). An edited card answers on its Your workout draft.
> - **What.** The sets the fit took, by builder group (an exercise left out counts all its sets, a trimmed one what it lost; never the main lift; what Ben changed himself since isn't the fit's), most first (a tie: the day's main group, then the earlier one), each group 2 or more, **at most 4 in all**, each routed to its own next day in plan order (wrapping, never the same day; abs: the next day). No next day with that group: not offered.
> - **Answer.** `Carry over`: one versioned write on the draft (op ID; refused when the draft moved, rule 5), toast `Carried over · Undo`, and the line keeps `Undo` (offered again). `✕`: not carried; the offer is gone for this fit. Any new Time fit clears the answer and asks again (it was for that fit).
> - **Landing.** Once the workout is done (the draft became a workout), the next Today card for that day gets the sets after its own fit (so they aren't cut again): on the group's first exercise that isn't the main lift (the main lift when it's the only one), up to 10 sets, else the exercise they came from, added; `Why?` adds `Carried over: +3 Triceps sets`. Never more per group than the fit as it ended took. It waits 14 days and goes once that day has been started; ~~several add up to at most 4 per group~~ **at most 4 carried sets land on one day in all, oldest first** (Ben, 23 Oct). It is the app's change on that day, so `Keep for next time?` never lists it. It lands on Today's card, Today's `Edit` and a plan day opened from Library's `Open in builder ›`. **Time never cuts it again** (review ben-8-decisions S3): the slot is marked as carried (kept through a force-close), and Your workout's Time fits the workout without those sets and puts them back after.
> - **Built:** `carryOverOffer`, `carriedItems`, `pendingCarryOvers`, `landCarryOver` (domain, `builder/carry.ts`), `withoutCarried` / `withCarriedBack` (`builder/carried.ts`), `BuilderSetup.carryOver`, `DraftSlotBuilder.carried`, `builder.carryOver`, Today's `carryFor`, `todaySession.carryOver` and the card's `carry`. Real-SQLite tests: `apps/mobile/test/your-workout-carry-over.test.ts`, `apps/mobile/test/today-carry-and-coach-sets.test.ts`.

> **Revision (Ben, 22–23 Oct, D9): this 22 Oct revision is the one fit, on Today and on Your workout.** Today's inline `Time` control (Today with a plan is lean, D3: rows, Start, Time, Edit) and Your workout's Time run the same function on today's draft only. Changes to the 22 Oct text below:
> - **Supersets only if Supersets is on.** Step 1 is shorter rests; superset pairing counts as a free saving **only when Supersets is on**. With it off, nothing is ever paired to save time (design review V14). The old "then supersets if they're off" is withdrawn.
> - **The "Not built" list in the Your workout note below is now the plan** for both screens: the cheapest cut by training lost per minute (value per set: compound accessory 3, isolation 2, abs 2.5, extra 1.5), never the main lift, never below 2 sets, and the carry-over offer of at most 4 sets to the next same-muscle day, with Undo. No pushed effort (Today's old step b is gone).
> - **Time never asks anything.** Start after a Time change just starts (D1), and the Summary's `Keep for next time?` never counts Time's cuts (workout-builder-v3 §2.8).
> - **FT3 and FT8 are superseded** (marked in §2). FT3's "trim accessory sets → skip accessories → trim main lifts" order and "never shortens rest" give way to the order above (and, mid-workout, to workout-table-v3 §5, CHANGELOG 2026-10-21). FT8's `Finish by` from a fit belonged to the retired overview's TIME tile; Start doesn't set a finish time from Time [assumption, flagged for Ben].
> - Prototypes: `prototypes/training-blocks.html` (Today with a plan), `prototypes/app/app-shell.html` (no-plan Today), `prototypes/workout-builder-v3.html` (Your workout's controls load Today's fitted drafts).
>
> **Review fixes (23 Oct; designer proposals inside D9, for Ben to confirm).** One copy of the fit code in both Today prototypes (`// FIT-START … FIT-END`, checked by `build_app.py`).
> - **Pairing is a step, and counted (review S2).** With Supersets on, the plan's pair (the extra exercise with abs) stays; when the fit drops one half, the other pairs with an isolation accessory of a different muscle (abs or the extra with e.g. Cable fly; never the main lift or a compound). The 5 minutes a pair saves are part of every cut's cost, so dropping one half of a pair is never counted as a bigger saving than it is.
> - **The least training lost, not one step at a time.** Every way of keeping each accessory at 2 sets or more, or dropping it, is tried; the one that fits and loses the least training wins (ties: fewer sets lost, then the most of the time used). So less time never loses less training: Chest 45 → 40 → 35 → 30 → 25 min loses 0 → 1 → 3 → 5 → 6 sets (35 min: `Dropped Triceps pushdown`, `Superset Cable fly + Cable crunch`). If nothing fits, the most it can cut, and the minutes say so (`~21 min` at 20).
> - **The carry-over is an offer, routed by muscle (S5, SP3).** Behind the Time note: `+3 triceps sets on your next Shoulders day?` `Carry over`, then `Undo`. Each cut muscle goes to its own next day in plan order (abs: the next day), at most 4 sets in all. Not applied by default: D2 says an extra set Ben didn't ask for always needs Apply. Ben to confirm (SP3).
> - **Ben's edits stay (FT5).** Edits from Your workout are replayed after the fit and the coach's applied offer, so a new Time never undoes them and nothing else is cut harder to pay for them; the estimate shows when they take the workout over Time.
> - **The coach's offer reads against the fitted draft (rule 5).** At 30 min the fit cuts Cable fly to 2, so `✦ Cable fly 3 → 2 sets?` is withdrawn on Today and on Your workout. Apply changes only that exercise; nothing is refitted.
>
> **Re-review 1 fixes (23 Oct; designer proposals, for Ben to confirm).**
> - **Bounded search in the app (S3).** The prototype tries every combination, which is fine for its 4–5 accessories but not for Your workout's limits (up to ~12 exercises × 8 sets). `fitToMinutes` in `packages/domain` is an exact 0/1 knapsack instead: each accessory is one group of choices (its sets, down to 2, or dropped), cost in 15 s buckets of the minutes it saves, value = training lost; minimise training lost with minutes ≤ Time. Run it once with no new pair and once per candidate pair (abs or the extra with an isolation accessory, Supersets on only; ≤ 12 candidates), keep the best by the same tie rules. About exercises × options × buckets × pairs ≤ 12 × 8 × 720 × 13 ≈ 0.9 M steps, under 10 ms on device. Being exact, "less time never loses less training" still holds; the property test stays.
> - **Ben's edits leave the fit's notes (S1, partial).** What the fit cut from an exercise Ben then removed, swapped or set a count on is his change, so it leaves the Time note, its detail and the carry-over offer (no `+3 triceps sets` after he removed Triceps pushdown). Still open (SP-B, for Ben): whether the fit should run on his edited draft instead of the template, so the minutes and the cuts describe the workout he now has. Until then the estimate shows when his edits take the workout over or under Time.

> **Revision 22 Oct (Ben): optimised built-in fit, plan-aware.** When the time is shorter than the session:
> 1. **Free savings first:** shorter rests, then superset pairing only if Supersets is on (pairs work, loses none). *(Wording corrected by D9, Ben 22–23 Oct; was "then supersets if they're off".)*
> 2. **Then the cheapest cut, step by step:** a set off an exercise (never below 2) or a whole exercise (saves its changeover). If one cut is enough, the one that loses least; otherwise the least training lost per minute saved. Value per set: compound accessory 3, isolation 2, abs 2.5 (his choice), extra 1.5. The main lift is never cut.
> 3. **The week is protected:** sets lost (2 or more) are offered on the next day for that muscle, capped at 4 (`+4 sets on your next Chest day · Undo`).
> 4. **Honest, without moving the screen:** the Time row shows the biggest change in light orange after the label (`Time · −1 exercise ›`); tapping it lists everything combined (shorter rests, `Incline DB press 3 → 2 sets`, `Dropped Triceps pushdown`, the carry-over with Undo). The card's exercise count and minutes update. Prototype: training-blocks.html (Today with a plan).

> **Your workout's Time (built 22 Oct; Ben, 22 Oct: "add option to reduce time").** The overview is retired, so the time control lives on Your workout (workout-builder-v3 §2.3). It uses the built-in fit Today's card uses (`fitToMinutes`), not a second algorithm, on today's draft only. Against the revision above:
> - **Built:** shorter rests first; never the main lift; no superset made, ever (Supersets off is a hard rule, design review V14); the note after Time in light orange (`−1 exercise`, `−2 sets`, `shorter rests`) with everything it changed behind a tap and a one-step `Undo`; more time brings back what was cut, up to the workout as it was, never more; offline, no coach call; the saved workout and the plan never change. No effort is pushed there and kept sets keep their own RPE (`pushEffort: false`).
> - **Not built, because the shared fit would have to change (which also changes Today's card, out of scope for this batch):** (1) supersets as a free saving when Supersets is on; (2) the cheapest cut by training lost per minute with the value weights (compound accessory 3, isolation 2, abs 2.5, extra 1.5): the shared fit still trims accessory sets last exercise first down to 2, then drops whole exercises by band (abs, and on Your workout only exercises with no builder group such as cardio → the other group's isolations → accessory isolations → compounds; Today's card reads a no-group exercise as before), then gives back sets a drop freed; (3) the week's carry-over (`+4 sets on your next Chest day · Undo`). Today's card still pushes accessory last sets to RPE 9 (its step b). These need Ben's go-ahead to change Today's fit too.
> - **Review fixes (22 Oct):** the plan day keeps its own length on `Update … in your plan` (the length before the first Time change, never Time's); a history source's main lift is the WL9 one at read (§4.2), so it is never cut; a Set up change or `Gym changed` refits Time on the changed original instead of dropping the fit. Re-review fixes (22 Oct): FT5 holds at every shorter length, so an exercise Ben edits after a fit trimmed it is never made longer by less time (what the fit took stays listed and comes back at the original length or with Undo); exercises `Gym changed` swaps in are the gym's, not Ben's edits (FT5 doesn't cover them), so Time can still trim them. Details: workout-builder-v3 §2.3, `docs/reviews/your-workout-time.md` (Fixes, Re-review).
> - The `How long?` sheet, the TIME tile and the coach fit (§3–§5, FT-C1 and FT-C10–C15) belonged to the retired overview; nothing replaces the coach fit here (the coach bar on Your workout can already change the workout).

Status: v1.0 draft, 11 Oct 2026. Build slice C of the Workouts library change ([routines.md](routines.md) §A8). Ben: "on the edit before starting … an option to choose how long the session should be, and then using GPT or a pre-existing option the session gets updated to reflect that time period". Research: [workout-library-and-duration.md](../research/workout-library-and-duration.md) R2, R3. Mockup: [mockups/workout-library.html](mockups/workout-library.html) frames 3 and 4.

Builds on [workout-overview.md](workout-overview.md) (TIME tile, OV3), [overview-today-edits.md](overview-today-edits.md) (pre-start draft, TE2, TE3, §11), [active-workout.md](active-workout.md) §2.15 (`estimateRemainingDuration`, Time left, `Finish by`, coach Shorten), [coach-adjustments.md](coach-adjustments.md) (CA1–CA3) and playbook v1 ("Session length: when time is short, keep the goal's priority order and cut sets, not load"). Rules: CLAUDE.md 1, 2, 3, 4, 5, 6, 9 and the minimal-copy convention.

---

## 1. Purpose

**Question:** "I've got 45 minutes. What does today look like if it has to fit?"

**Primary action on the page: still `Start workout`.** The sheet's own primary is `Trim to 45 min`. Fitting is optional and always undoable.

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| FT1 | **The TIME tile is the control.** `≈ 62 min ▾` opens the `How long?` sheet, in normal and Edit mode | It's where Ben already reads the length. No new row on the page |
| FT2 | **Two ways to fit, one sheet.** `Trim to 45 min` (built-in, deterministic, offline) and `Ask coach` (ChatGPT, online). One fit is live at a time; choosing one replaces the other (Undo brings the old one back) | Ben asked for "GPT or a pre-existing option". Rule 1: the built-in way always works |
| FT3 | ~~**The built-in trim only shortens.** Order: trim accessory sets → skip accessory exercises → trim main lifts to 2 sets. Never skips a main lift, never raises a load, reps or sets, never shortens rest, never removes a top set or the warm-ups of a kept exercise (§4)~~ **Superseded (Ben, 22–23 Oct, D9):** the 22 Oct revision's order (shorter rests; superset pairing only if Supersets is on; the cheapest cut by training lost per minute; never the main lift; carry-over offer). Still true: shrink only, never raises a load, reps or sets, never removes a top set | Playbook: cut sets, not load, keep the priority order |
| FT4 | **The fit is stored as intent** (`TodayEdit {kind: 'fit', minutes}`) and re-runs after every other edit, gym change or new target. It runs **after** the planner, on the planned preview, and marks cut sets `skipped` (`skippedBy: 'before_start'`). So preview = Start (OV3) | Same pattern as TE2. A gym change can't leave stale cuts |
| FT5 | **Ben's own edits win.** A slot Ben edited (add, sets, reps, load, Bring back) is never trimmed or skipped by the fit | Rule 2 in spirit: the machine never overrides a choice Ben just made |
| FT6 | **Choosing a time applies the fit at once**, built-in trim and coach fit alike, with a before → after card and Undo (CLAUDE.md rule 3: Ben asked, today only). No Apply step on the fitted version. Swaps and supersets from the coach come back as a separate change card with `Apply` (today only). **Decided by Ben, 12 Oct 2026** (CHANGELOG) | Rule 3: a change Ben asked for applies immediately, with visible change and one-tap Undo |
| FT7 | **Every minute shown comes from `estimateRemainingDuration`**, with `≈`. The coach never supplies a number of minutes | Rule 6; research: estimates are users' top complaint |
| FT8 | ~~**Start carries the time.** A live fit sets the session's `Finish by` to start + minutes, rounded up to 5 min. The Time left line then reads `on track for 19:45` or `about 7 min past 19:45`, and the coach's mid-workout Shorten offer (active-workout §2.15.4) can use it~~ **Superseded (Ben, 22–23 Oct, D9):** the overview and its TIME tile are retired; Time on Today and Your workout fits today's draft only, and Start sets no finish time from it. The workout's own time left (workout-table-v3 §5) is unchanged | — |
| FT9 | **Mid-workout, the same trim** (slice C2): the Time left sheet's `Shorten to fit…` gets `Trim` beside `Ask coach`, running the same function on pending sets. Replaces AW12's offline caption | One rule before and during the workout; offline users get a fit too |
| FT10 | **Longer than planned:** the built-in trim does nothing (`Fits already`). `Ask coach` can add work, today only, within limits (§5.3) | Research: "shorten only" annoys users, but the built-in rule never invents extra work |

## 3. Layout (390 × 844)

### 3.1 The tile

```
│────────────────────────────────────────│
│  ≈ 62 min ▾│  ≈ 19:05  │     16        │ ▾ caret, text.secondary
│  TIME      │  DONE BY  │    SETS       │
│────────────────────────────────────────│
```
- With a live fit: `≈ 44 min ▾` over `TIME · FIT 45` (label `type.sectionLabel`, clock icon). When the fit can't reach the target: `≈ 52 min ▾` over `TIME · FIT 45`, and the card says so (§3.3).
- The tile is one button, ≥ 44pt tall: "Time, about 62 minutes. How long? button."

### 3.2 `How long?` sheet (`HowLongSheet`, medium detent)

```
┌────────────────────────────────────────┐
│ How long?                        Close │
│ Now ≈ 62 min                       ⓘ  │ estimate; ⓘ = pace source
│                                        │
│ [ 30 ] [✓45 ] [ 60 ] [ 75 ] [ 90 ]     │ ParamChip, 44pt, tabular
│ [ Other ]                              │ wheel 15–180 min, 5-min steps
│                                        │
│ [           Trim to 45 min           ] │ PrimaryButton (sheet)
│ [             Ask coach              ] │ SecondaryButton
│                                        │
│ Clear fit                              │ only with a live fit
└────────────────────────────────────────┘
```

- **Default chip:** the live fit's minutes; else Ben's preferred session length (Goals & schedule) when it's below `Now`; else the largest chip below `Now`. Chips at or above `Now` stay selectable.
- **Chip ≥ Now:** `Trim` turns into disabled `Fits already`. `Ask coach` reads `Ask coach to fill 75 min`.
- **Coach offline / not connected:** `Ask coach` disabled, caption `Coach offline` under it (icon + word). Trim unaffected.
- `ⓘ` opens the Time left sheet's pace lines (active-workout §2.15.3: `Your pace`, source tag). No other explanation.

### 3.3 Fitted result (`FitCard`, a `ResultCard`, above the list)

```
│ ┌────────────────────────────────────┐ │
│ │ ◷ Fitted to 45 min                 │ │ type.headline
│ │ ≈ 62 → 44 min                      │ │ before → after, tabular
│ │ Cable fly · skipped                │ │ one line per cut, plan order
│ │ Lateral raise · 3 → 2 sets         │ │
│ │ Triceps pushdown · 3 → 2 sets      │ │
│ │ (Undo)                   (Change)  │ │ Change = reopen the sheet
│ └────────────────────────────────────┘ │
│ 5 EXERCISES · FITTED           TARGET  │
│ 01 Bench press              SAME       │
│ …                                      │
│┃03 Lateral raise         ◷ TRIMMED     │ ChangeMarker; detail "2 × 12–15"
│ 05 Cable fly             ⊘ SKIPPED     │ panel: Bring back
```

- **Rows:** trimmed rows get `◷ TRIMMED` and their detail shows the new count (`2 × 12–15`); skipped rows `⊘ SKIPPED` as v0.2. Precedence: SKIPPED > HELD > NO LOAD > ADDED > SWAPPED > EDITED > TRIMMED > the §4 markers.
- **Can't reach the target:** first line `Shortest: ≈ 52 min` instead of `Fitted to 45 min`, then the cuts. No extra cuts are made beyond §4.
- **Bring back** on a fit-skipped row, or `[+]` on a trimmed row in Edit mode, is Ben's edit (FT5): that slot leaves the fit and the card updates (`≈ 52 min · 7 over 45`).
- The card collapses to one line (`◷ Fitted to 45 min · ≈ 44 min ›`) after the first scroll, and expands on tap.
- **Coach variant:** first line `[Coach] Coach fitted to 45 min`, `Why? ›` beside `Undo`. Cuts and additions listed the same way (`Face pull · added · 2 × 12–15`). A swap or superset suggestion sits under it as a `ChangeReviewCard` (`Today only`, `Apply`, `Not now`).

### 3.4 Coach pending

```
│ ┌────────────────────────────────────┐ │
│ │ [Coach] Fitting to 45 min…         │ │ no spinner animation; static
│ │                          (Cancel)  │ │
│ └────────────────────────────────────┘ │
```
The page stays usable. Start is live; starting cancels the request and nothing from it is applied.

## 4. Built-in trim (`fitPlanToMinutes`, pure, `packages/domain`)

### 4.1 Input and output

```ts
fitPlanToMinutes(input: {
  preview: SessionAggregate;          // planner output after Ben's edits, not started
  slots: FitSlot[];                   // slotKey, sessionExerciseIds, tier, benEdited, supersetGroup
  minutes: number;                    // 15..180
  pace: PaceInput;                    // same as the TIME tile
}): {
  status: 'fitted' | 'already_fits' | 'over';
  beforeSeconds: number; afterSeconds: number;
  cuts: ({ slotKey: string; kind: 'sets'; from: number; to: number } | { slotKey: string; kind: 'skip' })[];
  skipSetIds: string[];               // the planned sets to mark skipped
}
```

### 4.2 Priority (`fitTier`)

| Tier | Which slots | Cut |
|---|---|---|
| **A: main** | `RoutineExercise.main` (routines.md WL9; for a history basis or an older workout, the WL9 default at read) | Last, and only down to 2 working sets. Never skipped |
| **B** | Other compound exercises (catalogue `mechanic: 'compound'`), and exercises whose primary muscle is one of Ben's priority groups (when set) | Second |
| **C** | Everything else (isolation, unknown mechanic) | First |

- Within a tier, **later in today's order is cut first**.
- A **superset** is one unit: its tier is its highest member's; a trim removes one round (one working set from each member).
- **Ben-edited slots** (FT5) and **pain-held** slots (`⚠ HELD`) are left as they are.

### 4.3 Passes (stop as soon as the estimate fits)

"Fits" means the unrounded `estimateRemainingDuration` seconds ≤ `minutes × 60`.

1. **Trim tiers C, then B.** Round-robin from the lowest-priority unit up: remove one working set from each unit that is above its floor, re-estimate after each removal. Floor: 2 working sets (or the slot's own count if it already has fewer). Within a unit the set removed is the last drop set, then the last back-off, then the last plain working set. A top set is never removed.
2. **Skip whole units**, tier C bottom-up, then tier B. The unit's warm-ups go with it.
3. **Trim tier A** to 2 working sets, round-robin bottom-up, same set order as pass 1.
4. **Stop.** If it still doesn't fit, `status: 'over'`. Nothing else is cut.

Before pass 1, if it already fits: `already_fits`, no cuts.

### 4.4 Never

- Raise any load, rep target or set count. Change any load at all.
- Shorten rest, transition rest or warm-ups of a kept exercise.
- Change order, swap, superset, or add anything.
- Touch a done set (mid-workout use, FT9: pending sets only).
- Use check-ins, readiness guesses or coach output.

### 4.5 Example (fixture, §9)

Push A at Main gym: bench 3 working (A), incline DB 3 (A), superset lateral raise 3 + pushdown 3 (C), cable fly 3 (C). Pace from the last 5 workouts. `≈ 62 min`. Fit 45:
- Pass 1: cable fly 3 → 2, superset 3 → 2 rounds → `≈ 52 min`.
- Pass 2: skip cable fly → `≈ 44 min`. Stop. `Fitted to 45 min · ≈ 62 → 44 min`.
Fit 30: continues; skip the superset → `≈ 34 min`; pass 3: incline 3 → 2 → `≈ 31 min`; bench 3 → 2 → `≈ 28 min`. Fit 20: after pass 3 `≈ 28 min`, `Shortest: ≈ 28 min`.

## 5. Coach fit

### 5.1 Request

`Ask coach` → `services.coach.requestTodayFit({target, draft: {id, version}, previewKey, minutes, opId})` → `requestCoachAdjustment({origin: 'ben_request', intent: 'fit', targetMinutes, scope: 'pre_start'}, …)`.

Context sent: **only today's shown plan** (exercises, set types and counts, targets with units and conventions, rest, the estimate and pace source), Ben's goal and priority groups, active pain flags, and the gym's usable equipment kinds. No other draft, no history beyond each exercise's last comparable session. This is Your data sent because Ben asked (amends ADR 0022 §1 "never in coach context" for this one request; needs an ADR note).

### 5.2 What comes back, and the validator (`validateTodayFit`, deterministic)

The coach returns today edits only: `skip`, `sets`, `add`, and optionally `swap` / `superset` suggestions. The validator:
- **Shortening** (target < Now): rejects any increase (`shorten_no_increase`), any rest change (`rest_unchanged`), and skipping a tier-A slot unless Ben's request said so in words (not possible from this sheet).
- **Lengthening** (target > Now): at most +2 working sets per exercise and at most 2 added exercises; added exercises must be Ben's own, usable at this gym, not pain-flagged; their targets come from `addTargets` (own history or `No history`), never from the model; per-session cap of about 8 hard sets per muscle group (playbook rule 1).
- **Always:** loads fitted by `snapPlanToGym`; pain flags block (rule 9); Ben-edited slots untouched (FT5); swaps and supersets become a suggestion card, never applied.
- Minutes are recomputed with `estimateRemainingDuration`. The model's own minutes, if any, are ignored.

Edits that pass are written to the draft as `author: 'coach'` edits with one `actionId`, in one versioned write, and the `FitCard` (coach variant) shows. Edits that fail are dropped; if all fail, the card reads `Couldn't use the coach's version` with `Why?` and `Trim instead`.

### 5.3 Undo

`Undo` on the card (or `Clear fit` in the sheet) marks every edit with that `actionId` removed, in one write, and records the undo in the coach action log. A built-in fit it replaced comes back.

## 6. States

| State | Shows |
|---|---|
| No fit | Tile `≈ 62 min ▾`, no card |
| Built-in fit, fits | §3.3 |
| Built-in fit, over | `Shortest: ≈ 52 min` card; tile `≈ 52 min` / `TIME · FIT 45` |
| Fits already | Sheet: `Fits already` (disabled); nothing written |
| Coach pending | §3.4 |
| Coach applied | Coach `FitCard`; suggestion card for any swap |
| Coach timeout (`timing.coachTimeout`) | Card `No answer from the coach` [Trim instead] [Dismiss] |
| Coach offline / not connected | Sheet `Ask coach` disabled + `Coach offline`. Trim works |
| Coach result rejected | `Couldn't use the coach's version` [Why?] [Trim instead] |
| Plan changed while the coach worked | Result discarded; card `Plan changed` [Ask again] |
| Other edits after a fit | Built-in: re-runs, card updates. Coach: its edits stay unless the slot is gone (stale, dropped) or Ben edits that slot (Ben wins) |
| Gym changed | Built-in re-runs on the re-fitted plan |
| Start with a fit | One transaction (ADR 0022 §3); `finishBy` set (FT8); `session.todayEdits.fitted = {minutes, by: 'built_in' \| 'coach', cuts}` |
| Mid-workout (C2) | Time left sheet: `Fit into [20 min ▾]` · `Trim` · `Ask coach`. Trim → banner `Trimmed to fit · ≈ 35 → 20 min` [Undo]; sets `skippedBy: 'in_workout'` |
| Force-close | Draft (with the fit) intact; coach request lost, card shows nothing pending |
| AX1+ | Chips wrap two per line; card lines wrap; Start stays in the bar |

Transitions:

```
Overview ─TIME tile─► How long? ─chip─► Trim ─► FitCard (built-in) ─Undo─► previous
                                   └─► Ask coach ─► pending ─ok─► FitCard (coach) ─Undo─► previous
                                                        ├─timeout/reject─► Trim instead
                                                        └─Start─► cancelled
FitCard ─Change─► How long? (chip preselected)
Overview ─Start─► Workout (Finish by = start + minutes)
```

## 7. Interactions and copy

### 7.1 Tap counts

| Path | Taps |
|---|---|
| Fit with the default chip | 2: tile → `Trim to 45 min` |
| Fit to another length | 3: tile → chip → `Trim` |
| Coach fit | 3: tile → chip → `Ask coach` |
| Undo | 1: card `Undo` (or toast) |

Toasts: `Fitted to 45 min` [Undo] (built-in), none for the coach (the card is the result). Voice (step 5, for voice.md): "I've got 45 minutes" on the overview → built-in trim to 45 with Undo, spoken back `About 44 minutes.`; "ask the coach to fit 45" → coach fit.

VoiceOver: the card reads "Fitted to 45 minutes. About 62 to about 44 minutes. Cable fly skipped. Lateral raise 3 to 2 sets. Triceps pushdown 3 to 2 sets. Undo button. Change button."

### 7.2 Copy

`≈` values are **estimates**. Set counts on the card are **targets** for today.

| Element | Text |
|---|---|
| Tile | `≈ 62 min ▾` · `TIME` · `TIME · FIT 45` |
| Sheet | `How long?` · `Now ≈ 62 min` · `30` `45` `60` `75` `90` `Other` · `Trim to 45 min` · `Fits already` · `Ask coach` · `Ask coach to fill 75 min` · `Coach offline` · `Clear fit` · `Close` |
| Card | `Fitted to 45 min` · `Shortest: ≈ 52 min` · `≈ 62 → 44 min` · `Cable fly · skipped` · `Lateral raise · 3 → 2 sets` · `Face pull · added · 2 × 12–15` · `≈ 52 min · 7 over 45` · `Undo` · `Change` · `Coach fitted to 45 min` · `Why? ›` |
| Coach states | `Fitting to 45 min…` · `Cancel` · `No answer from the coach` · `Couldn't use the coach's version` · `Trim instead` · `Plan changed` · `Ask again` · `Dismiss` |
| Markers / header | `◷ TRIMMED` · `5 EXERCISES · FITTED` |
| Mid-workout (C2) | `Fit into` · `Trim` · `Trimmed to fit · ≈ 35 → 20 min` |
| `Why?` (coach card) | The coach's reason in one or two lines, then the checks it passed, e.g. `Loads and rest unchanged.` |

No rule names, no "built-in" label on the trim, no lead text. Honesty is the `≈`, the before → after and `Shortest`.

## 8. Data needed

**Pure (`packages/domain`, unit-tested):** `fitPlanToMinutes` (§4), `fitTier` (§4.2, uses `defaultMain` from routines.md §A6), `validateTodayFit` (§5.2), `estimateRemainingDuration` (`duration.ts`; the follow-up to fold it into `estimateTimeLeft` should land first or with this slice so the tile, the fit and Time left agree), `planWithTodayEdits` (applies the `fit` edit after the planner, FT4), `buildWorkoutOverview` (`fit: {minutes, status, before, after, cuts, by} | null`; `ChangeMarkerKind` gains `trimmed`), `finishByFromFit(startedAt, minutes)`.

**Schema:** `TodayEdit` gains `{kind: 'fit', minutes}`; `editBase` gains `author` and `actionId?` (shared with §11 of overview-today-edits); `SessionTodayEdits.fitted?`; `WorkoutSession.finishBy` (exists, AW12). All JSON or existing columns.

**Migration 12 (`0012-today-fit`, coach fit only):** rebuild `coach_actions` so its `kind` CHECK also accepts `fit_today`, keeping migration 11's kinds (`log_set`, `correct_set`, `suggest_memory`); same rebuild pattern as migrations 7 and 11 (rows, indexes and the no-delete trigger kept). Nothing else. The built-in trim needs no migration; skipped sets reuse `skipped_by = 'before_start'` / `'in_workout'`. Built as 8 on the library branch; numbered 12 at the merge with main (8 deleted-workouts, 9 progress, 10 workout-gaps, 11 coach-set-actions).

**Services:** `services.overview.edit({kind: 'fit', minutes})`, `services.overview.clearFit`, `services.coach.requestTodayFit`, `services.coach.undoAction` (fit_today), `services.workout.trimToFit({sessionId, minutes, expectedRevision, opId})` (C2), `getAiCapabilities`.

## 9. Acceptance checks (slice C)

Fixture: §4.5 Push A; Ben's pace from 5 recent workouts; coach connected unless stated.

- **FT-C1. Tile.** TIME is a button with `▾`; tapping opens `How long?` with `Now ≈ 62 min` equal to the tile.
- **FT-C2. Order.** `fitPlanToMinutes` unit tests reproduce §4.5 exactly for 45, 30 and 20 minutes: accessories trimmed to 2 before any skip, tier C skipped before tier B, tier A never skipped and never below 2 working sets, top sets never removed.
- **FT-C3. Never raises.** Property test over random plans and targets: no output load, rep target or set count is higher than its input; rest and warm-ups of kept slots are identical; order is identical.
- **FT-C4. Already fits / over.** Target ≥ Now writes nothing (`Fits already`). Fit 20 on the fixture shows `Shortest: ≈ 28 min` and makes no cut beyond pass 3.
- **FT-C5. Preview = Start.** With a fit plus any mix of §11 and v0.2 edits, the rows (including skipped and trimmed sets) equal what Start creates. Start sets `finishBy` = start + minutes rounded up to 5 min, and the Time left line uses it.
- **FT-C6. Re-runs.** Changing the gym, adding a set elsewhere or swapping an exercise re-runs the trim; the card and tile update; no stale cut remains.
- **FT-C7. Ben wins.** `Bring back` on a fit-skipped row keeps it in the plan, the card shows `≈ 52 min · 7 over 45`, and no further trim touches that slot.
- **FT-C8. Undo.** Card `Undo` and toast `Undo` restore the plan exactly (rows, SETS, TIME). Choosing a coach fit after a built-in one and undoing it brings the built-in fit back.
- **FT-C9. Offline.** Airplane mode, no AI: Trim works; `Ask coach` is disabled with `Coach offline`; no provider call.
- **FT-C10. Coach shorten.** A coach response that skips cable fly and trims the superset applies at once with the coach card, before → after minutes from `estimateRemainingDuration`, and Undo. A response that raises any load or shortens rest has those edits rejected (validator log), the rest applied.
- **FT-C11. Coach lengthen.** Asking for 90 on a 62-minute plan: the coach's added exercise uses Ben's own history for its target (or `No history`), is usable at this gym and not pain-flagged; more than 2 added exercises or +3 sets on one exercise are rejected.
- **FT-C12. Coach swap.** A coach swap comes back as a `Today only` change card; nothing is swapped until `Apply`.
- **FT-C13. Coach failures.** Timeout shows `No answer from the coach` with `Trim instead`; a plan change while waiting discards the result (`Plan changed`); Start while pending creates the session without any coach edit.
- **FT-C14. Context.** The coach request contains only today's shown plan, goal, priority groups, pain flags and equipment kinds (request log). No other draft, no memories beyond those.
- **FT-C15. Audit.** A coach fit writes one `coach_actions` row (`fit_today`, migration 12) and its Undo one `undo` row. The built-in trim writes none.
- **FT-C16. Mid-workout (C2).** With 11 pending sets and `Fit into 20 min`, `Trim` skips pending sets by the same order, leaves done sets untouched, shows `Trimmed to fit · ≈ 35 → 20 min` with Undo, and works offline.
- **FT-C17. Idempotent and versioned.** Repeated `opId`s give one fit; a stale `expectedDraftVersion` or `previewKey` writes nothing.
- **FT-C18. Visual.** Chips and buttons ≥ 44pt; `◷ TRIMMED`, `⊘ SKIPPED`, `Coach offline` carry icon + word; minutes tabular with `≈`; Start the only filled pill on the page; AX3 at 375pt with no sideways scroll; light and dark.

## 10. For the PM (flags, not decided here)

- **ADR notes needed:** ADR 0006 (a built-in fit-to-time is a labelled offline fallback beside the coach's `shortenSession`; research P1); ADR 0022 (the `load` edit carries Ben's intended number, TE13; coach-authored draft edits; today's plan sent to the coach on Ben's request).
- **Brief conflict (research P3), resolved:** brief §7 says `shortenSession` "proposes"; CLAUDE.md rule 3 says apply at once when Ben asks. Ben decided for rule 3 (FT6, 12 Oct 2026, CHANGELOG): a fit he asks for applies at once with Undo.
- **Later:** per-gym usual length as the chip default (research R6/P2).
