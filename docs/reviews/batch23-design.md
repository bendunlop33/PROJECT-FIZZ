# Review: Ben's 22–23 Oct decisions D1–D9, design track (specs and prototypes)

Branch `claude/gracious-knuth-joxqpw`. I reviewed the builder's **uncommitted** working tree on top of `9261625`: 22 files under `docs/` (+971 / −387). Nothing in `apps/` or `packages/` changed. This commit adds only this review. The builder's changes are still unstaged, so the fix round should commit them, split by topic as the builder proposed.

## Verdict: CHANGES NEEDED

Most of D1–D9 is in place and reads well. Today with a plan is lean. Start just starts. The coach's pre-start review and its bigger weekly changes are offers. Picking uses broad groups and counting uses the detailed list. A stale lift confirmed `Still right` starts at full weight. Plan setup, Library and Profile match D7, and the shared fit has no pushed effort and no pairing when Supersets is off.

Three things block:
- `Keep for next time?` presents the Time fit's cuts as Ben's own changes.
- The D4 back-off band breaks on dumbbells, and a back-off can equal the top set.
- The batch's own gate, `build_app.py`, fails as delivered.

## Checks run by the reviewer

- `python3 docs/design/prototypes/app/build_app.py <scratch>/appout`: **FAILED, 43 problems.** Every one is the builder's own `(Ben, 22–23 Oct)` label, which the week-range check reads as a week that isn't Monday to Sunday. The click-through never ran (B3).
- I rebuilt from a scratch copy with only that label changed to `22-23 Oct`. Static checks passed: fixture, PLAN_WEEK, the counting and picking lists, and dates. `node check_app.mjs` then passed (about 55 s, no console errors).
- I also ran four click-throughs of my own (Playwright, headless Chromium) on the built app and the standalone prototypes:
  - `Keep for next time?` after every Your workout control, at 60, 55, 45, 40 and 35 min.
  - The coach offer: pending, applied on Today, applied on Your workout, and offline.
  - A Time sweep from 60 to 20 min on all four plan days.
  - Your workout against no-plan Today for the same controls and Time. All four combinations I tried were identical.
  - Back-off bands for every Main focus × Effort, every week and every main lift.
  - The D7 setup pages, the Your plan rows, editing the plan you have, Library, Profile and the Training-blocks states (deload, early deload, pain, stale).
- All eight standalone prototypes load with no console errors. `git diff --check` is clean.
- This batch changes docs only, so there was no typecheck, lint or vitest to run. There are no schema, persistence or service changes.

## Rule check

- **Rule 1 (offline / AI honest):** met.
  - With the coach offline, the offer line is gone and `Why?` ends `Not reviewed · Offline`.
  - Offline, Progress shows the built-in line labelled `Built-in · Not reviewed · Offline`.
- **Rule 2 (no silent change; proposals with Undo):** the Keep row is a proposal with Apply / Skip / Undo. But B1 means it can propose plan changes Ben never made, so one Apply rewrites a plan day with the fit's cuts. Completed sets are not touched anywhere.
- **Rule 3 (coach offers):** met.
  - The pre-start review is an offer line and Start ignores it.
  - On Progress, the Row stall reset and the extra Lateral raise set wait for Apply, while the small Squat change stays applied with Undo.
  - Coach edits never reach the Keep row (checked: an offer applied on Today, and one applied on Your workout).
- **Rule 4 (achievable loads):** back-offs are snapped down and never above the top. They can equal the top, and they can fall outside the band (B2).
- **Rule 5 (versioned, stale rejected):** the spec covers Keep (op ID, a versioned write, stale refused, a guarded Undo) and D8's stale refusal. Where D8's change is held before a draft exists is open (SP5).
- **Rule 6 (no invented data) and rule 9 (pain):** met. A pain-held bench (100) works its back-offs out from the held top: `100 / 95`.
- **Minimal copy:** mostly met. One explanatory line (N6).

---

## Blocking

### B1. `Keep for next time?` lists the Time fit's cuts and restorations as Ben's changes

**Where:**
- `docs/design/prototypes/workout-builder-v3.html:312` (`structureChanges`) diffs today's rows against `base`.
- `docs/design/prototypes/training-blocks.html:469` sets `base` to the plan day as fitted at the **original** controls.
- The spec defines it the same way at `docs/design/workout-builder-v3.md:584`: "`base`: the plan day as drafted for today, Time cuts included".

**What goes wrong:** once Ben changes a control on Your workout, the fit's cuts at that Time differ from the ones baked into `base`, and the diff reports the difference as his. All of these come from clicking through the built app:

| Today Time | Ben's change on Your workout | Summary shows |
|---|---|---|
| 45 min | Supersets off (pairing alone, which §2.8 says never counts) | `Keep for next time? · Triceps pushdown 3 → 2 sets` |
| 40 min | Abs off | `− Cable crunch · Triceps pushdown 2 → 3 sets` (the plan already has 3) |
| 40 min | Accessories: Varied | `… · Triceps pushdown 2 → 3 sets` |
| 35 min | Abs off | `Cable crunch → Cable fly` (Cable fly was always in the plan; the fit had dropped it) |

- **Failure:** on a short day Ben turns Supersets off and trains. The Summary asks to keep `Triceps pushdown 3 → 2 sets`, and Apply permanently cuts a set from his Chest day because of a 45-minute session. This breaks D1 ("only when Ben changed the structure… Time changes never ask"), §2.8's "Never for: … pairing", and the builder's own assumption that "Time cuts don't trigger Keep for next time?".
- **Fix:**
  - Build the list from **Ben-authored structure edits against the un-fitted plan day**, not from a diff of fitted states. Either compare the un-fitted plan-day draft with the un-fitted draft for Ben's chosen controls plus his manual add/remove/swap/sets edits, or log edits by author (as `TodayEdit` already does for the fit, FT4) and list only Ben's.
  - Reword §2.8's `base` to match (SP1).
  - Add click-through cases: 45 + Supersets off → no row; 40 + Abs off → exactly `− Cable crunch`; 35 + Abs off → exactly `− Cable crunch`.

### B2. Back-offs leave the D4 band on dumbbells, and can equal the top set

**Where:** the shared `backOff()` (`plan-builder.html:699`, `training-blocks.html:348`, `app-shell.html:225`, `workout-builder-v3.html:256`). Its fallback says "snapping fell below the band: the next real load up". That matches the spec rule at `workout-builder-v3.md:690` and `plan-builder.md:88` ("If the snap lands below the band, the next achievable load up").

**Failures** (plan builder, dumbbell shoulder press on 2 kg steps, every week checked):
- **Strength / Standard, week 6:** `1 × 7 + 2 × 8 · 24 / 24 each`. The back-off equals the top at more reps, so it is harder than the top set. That breaks D4 ("below the top") and SS4 ("back-off RPE is never above the top set's").
- **Strength / Push, week 4:** `1 × 5 + 3 × 8 · 24 / 24 each`.
- **Muscle, every effort:** `26 / 24 each`, 7.7 % below the top, outside Muscle's 8–15 % band. That is 3–6 weeks per plan.
- Balanced and Fitness pass in every week.

**Why:** the Strength band at 24 is 22.08–23.52 and the Muscle band at 26 is 22.1–23.9, and no dumbbell falls inside either. "Next load up" then lands on the top itself, or just above the band.

**Effect:** `plan-builder.md:121` (§3a acceptance 5, "every main-lift back-off is ≤ the top and inside the focus's band … in every week") fails. `check_app.mjs` only tests Balanced barbell lifts, so it can't see this.

**Fix:**
1. Define the case where no achievable load is in the band (SP2). Recommended: the achievable load **strictly below the top** that is closest to the band, never the top itself. If there is no load below the top, keep the top load and cut the back-off reps.
2. Apply it in all four copies, plus the active workout's simplified copy.
3. Extend the click-through to Strength and Muscle with a dumbbell main lift.

### B3. The batch's own gate fails: `build_app.py` exits 1

- **Where:** `docs/design/prototypes/app/build_app.py:131`. The week-range regex matches the builder's `(Ben, 22–23 Oct)` comments and copy in every prototype (43 hits). `check()` fails before `check_app.mjs` runs.
- **Failure:** the command the README, `plan-builder.md` §3a and the builder's own report name as the check fails on a clean checkout. Nobody gets the click-through result until it's fixed.
- **Fix:** write the label without a range that looks like a week (`22 and 23 Oct`) in the prototypes, or have `check_text` skip comments and only check labelled weeks. Rerun the full build. With the label neutralised, the static checks and the builder's click-through both pass.

---

## Should fix (non-blocking)

### S1. Picking another main lift on Your workout shows up as a structure change

- **Where:** Main lift `Incline` on Your workout leads to the Summary row `Barbell bench press → Incline barbell press` (`workout-builder-v3.html:312`, `keepFor: Chest`).
- **Failure:** §1.3 says a plan day is saved per main lift (`Chest · bench` and `Chest · incline` are separate templates). Applying this row would put incline into Chest · bench, merging the two templates.
- **Fix:** treat the main-lift choice as choosing the template, so `base` becomes that template's draft. Or leave main-lift swaps out of Keep and say so in §2.8 (SP7).

### S2. D9's superset pairing step isn't modelled, so the fit cuts more than it needs to

- **Where:** `training-blocks.html:408–413` and `app-shell.html` `tnWorkout`. Pairing is never a fit step. The `saves` figure for dropping one half of the planned extra + abs pair ignores the 5 min the pair was saving.
- **Failure:** Chest at 35 min drops Cable fly and Triceps pushdown (6 sets) and the pair is gone. Re-pairing Cable fly with Cable crunch (Supersets on, both isolations, different muscles) fits about 34 min with only Triceps dropped (3 sets).
  - The fit is also non-monotonic. Back at 40 min loses EZ-bar curl plus a crunch set (4 sets); at 35 min it loses only Lat pulldown (3 sets).
  - Chest at 35 → 30 → 25 → 20 alternates which accessory it keeps.
- **Fix:** with Supersets on, make re-pairing a broken partner (and pairing in general) step 1, as fit-to-time's D9 note says. Count the lost pairing in `saves`. Add a sweep that checks sets lost never fall as Time goes down.

### S3. A control change on Your workout quietly undoes Ben's own edits

- **Where:** `workout-builder-v3.html:925`; spec `workout-builder-v3.md:495` ("replaces earlier manual edits", marked [Proposal]).
- **Failure:** Ben deletes Cable fly, then turns Abs off. Cable fly comes back, and the toast only says `Abs off`. This goes against FT5 ("Ben's own edits win") and the 22 Oct R1 rule that his edits survive a fit.
- **Fix:** apply the control's change on top of his edits, or at least name what came back (`Abs off · Cable fly back · Undo`). Get Ben's call, because it's one of the builder's listed assumptions.

### S4. Spec text that now contradicts itself

- **`workout-builder-v3.md:265` (No plan row):** the new D7 note says the chip row and the `Today only` tag are gone, then says "The rest of this row stands". That rest still says "same controls as with a plan … `Today only` tag" and "Other sessions and `Empty workout` as one row of chips". With a plan, the card now has only Time. Rewrite the row.
- **`training-blocks.md:160` (§4.4):** says deload is "applied … after §3.1 and fitting". The revision note at line 7 says Time "runs after the deload transform", and the prototype applies the deload first. Fix §4.4.

### S5. The carry-over is on by default, and its target day isn't the cut muscle's

- **Where:** `training-blocks.html:514`. `+N sets on your next <today's day> day` is applied by default and appears only after Ben taps the fit note.
- **Failure:** at Chest 35 min, the dropped Triceps pushdown and Cable fly become `+4 sets on your next Chest day`. D9 says "next same-muscle day". For triceps that's the Shoulders day here, and for abs it's any day.
- **Fix:** label and route the carry-over by muscle. The default-on question is SP3.

### S6. Prototype gaps for Keep

- `Open in builder ›` from the plan sends no `base` (`plan-builder.html:1200`, `:1266`), so a structure change made there never gets the row.
- §2.8 counts structure changes made mid-workout, but the Summary only reads `session.changes`.
- Either add both or list them as known prototype gaps in §2.8.

### S7. Today, the builder and the workout always use Balanced back-offs

- **Where:** `training-blocks.html:394`, `workout-builder-v3.html:289` (`calcKg(…, 'Balanced', …)`), and the active workout's copy. Only the plan builder passes `S.focus`.
- **Failure:** on a Muscle plan, bench 100 reads `100 / 90` on Your plan and `100 / 95` on Today and in the workout. The shared fixture is Balanced, so V1's click-through can't catch it.
- **Fix:** pass the plan's Main focus (or, with no plan, the band the Profile goal maps to, SP8) through the shared draft.

### S8. The builder's report claims more than the prototypes show

- D8 is spec-only: no prototype lands a chat change on a later Your workout.
- Neither prototype has the D2 example `✦ Bench 102.5 → 100?`. Both use `Cable fly 3 → 2 sets?`, so an applied load offer re-working the back-off (100 → 95) is never shown.
- Your workout still has no Time control (disclosed).
- That's acceptable for a design batch, but the report and README should say "spec only" where that's true, so Ben doesn't expect to click them.

---

## Nits

- **N1.** `plan-builder.md:88`: "Strength 100 × 5 → 92.5 × 8 (held at 8 % below)". 92.5 is 7.5 % below and inside the band, not held. Drop "held at 8 %".
- **N2.** `progress-goals.md:31`: the VoiceOver example still reads `Legs: 9 sets last week, plan 14`, but Legs is no longer a row (D5). Use `Quads: …`.
- **N3.** The §2.8 refusal copy `Your plan changed. Ask again.` (`workout-builder-v3.md:598`) has nothing for Ben to ask again, because the row is gone after the refusal. Use `Your plan changed`, or show the diff again against the new version.
- **N4.** Leaving the Summary (or force-closing) counts as Skip, so the offer is lost for good. Consider showing it on that workout's Summary in history until the plan day next comes up.
- **N5.** `structureChanges` pairs every removed exercise with an added one as a swap. For example, Varied shows `Cable fly → Dips` while also adding Cable crossover. Only show a swap when the slot really was swapped.
- **N6.** `plan-builder.html` Your week: `★ X: lifting fits around it.` explains a rule on the main screen. Drop it, or move it behind the existing ⓘ (minimal copy).
- **N7.** `workout-builder-v3.md` §2.2 Muscle groups row: "5 for Legs" sits under `[Ben]`, but it's the designer's assumption. Tag it [Proposal].
- **N8.** In `plan-builder.html`, `recWeek` (around line 510) uses 2.5 kg steps for dumbbell main lifts, while `atWeek` uses 2 kg (and the PLAN_WEEK fixture uses 2.5). The dumbbell kit differs within one screen. This predates the batch, but D4 now relies on the step.

---

## Spec issues (from the brief or spec, for Ben and the designer)

- **SP1. What `Keep for next time?` compares against.** Defining `base` as "the plan day as drafted for today, Time cuts included" makes the row a diff of fitted states, which can't separate Ben's edits from the fit's cuts (B1). Proposed: list only Ben's own structure edits, measured against the un-fitted plan day.
- **SP2. D4's band against coarse kit.** There's no rule for "no achievable load inside the band". This happens often with dumbbells at 20–30 kg and with sparse racks. Options:
  - (a) the nearest load below the top, even if it's outside the band;
  - (b) keep the load and cut the back-off reps;
  - never equal to the top in either case.
- **SP3. D9's carry-over against D2.** D9 calls it a "carry-over offer … with Undo", but the 22 Oct design and prototype apply up to 4 extra sets to a future day by default, shown only behind a tap. D2 says an extra set Ben didn't ask for "ALWAYS needs Apply". Ben to choose: a real offer (`Carry over` / ✕), or default-with-Undo shown on the visible note.
- **SP4. D5's nine counting muscles against the plan's own rows for specific targets.** `plan-builder.md:91` and `plan-builder.html:412` give Glutes, Adductors, Abductors and Forearms their own Sets-per-week rows. With a Glutes target, hip-thrust sets count to Glutes and not Hamstrings, so Legs ≠ Quads + Hamstrings + Calves, and Progress (nine fixed rows) never shows them. Decide where each rolls up (e.g. Glutes under Hamstrings, Forearms under Biceps).
- **SP5. Where a D8 change waits.** When Ben applies "swap fly next Chest" days ahead, there's no Your workout draft yet. The spec should say:
  - where the change is held, and what version it's checked against (the template version, then the draft's);
  - what happens if a Keep Apply or a plan edit lands first, or Ben does a different Chest variation;
  - when it expires.
- **SP6. Variations after D1.** Nothing creates a new variation now (workout-builder-v3 §1.3 is open; the builder raised it).
- **SP7. Main lift and Keep (S1).** Is picking Incline today a structure change to Chest · bench, or simply picking a different template?
- **SP8. Band with no plan.** Profile goals are strength / muscle / both and the bands are Strength / Balanced / Muscle. The mapping (presumably both → Balanced) isn't written down.

The builder's other assumptions (RPE 8 for top and back-offs, FT8 read as the retired fit, no `Today only` tag without a plan either, broad Library filters with a part picker, ✦ priority preselected as Back, Shoulders days recommending 1 Back exercise, Legs capped at 5) are reasonable. They are correctly listed for Ben.
