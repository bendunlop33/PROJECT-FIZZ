# Review: Ben's 22–23 Oct decisions D1–D9, design track (specs and prototypes)

Branch `claude/gracious-knuth-joxqpw`. I reviewed the builder's **uncommitted** working tree on top of `9261625`: 22 files under `docs/` (+971 / −387). Nothing in `apps/` or `packages/` changed. This commit adds only this review. The builder's changes are still unstaged, so the fix round should commit them, split by topic as the builder proposed.

**Current verdict (re-review 3, after fix round 3, 23 Oct): PASS.** R3 is fixed. `build_app.py` now reports `fixture check: ok` and `click-through check: ok` as delivered (about 158 s), so every R1, R2, S1 and S2 case runs and passes. The remaining items are not blocking: S5 and SP-A to SP-D are Ben's calls, and S6 is only partly fixed (a regression found in a later case still shows as a timeout). See [Re-review 3](#re-review-3-23-oct-after-fix-round-3) at the end.

## Verdict (round 1): CHANGES NEEDED

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

---

## Fixes (23 Oct, designer)

Every finding above and in the follow-up list was checked against the source before fixing. All were confirmed by reading the code paths the review names; N8 is explained, not changed. Files: `docs/design/prototypes/{training-blocks,workout-builder-v3,plan-builder,workout-active-v3,progress-simple}.html`, `prototypes/app/{app-shell.html,build_app.py,check_app.mjs}`, and the specs `workout-builder-v3.md`, `training-blocks.md`, `plan-builder.md`, `fit-to-time.md`, `design-system.md`, `progress-goals.md`, `workout-summary.md`, `README.md`.

**Not done in this session, and why.** This fix round had no shell, so I could not run `build_app.py`, `check_app.mjs` or `git diff --check`, and I could not commit. All checks below were written but **not run**. The builder's 22 files and this round's changes are still uncommitted. Next step for whoever has a shell: run `python3 docs/design/prototypes/app/build_app.py <scratch>/appout` (static checks, then the click-through), fix anything it reports, then commit by topic: (1) B3 label and shared-code checks; (2) Keep for next time? and Today's edits (B1, D3, S1, S3, S6); (3) coach offers (rule 5); (4) back-offs (B2, SS4/HT8, S7); (5) fit (S2, S5); (6) plan setup and app chrome (Any days, one back control, Profile); (7) Set up chat (D5); (8) specs. Do not push.

### Blocking

- **B3 (gate).** Confirmed: `check_text`'s week-range regex reads `22–23 Oct` as a week. Every prototype label now reads `(Ben, 22 and 23 Oct)` (HTML, `build_app.py`, `check_app.mjs`). The specs keep `22–23 Oct` (not checked). `build_app.py` also gains a check that each shared code block is the same in every copy: `BACKOFF` (5 files), `FIT` (Today with a plan, no-plan Today), `EDITS` (Today, the builder).
- **B1 and its other triggers (Keep base).** Confirmed for all three Time cases, the coach-applied offer and the deload. Fix (SP1, proposal for Ben, workout-builder-v3 §2.8):
  - Ben's changes are kept as a list of edits (remove, add, swap, set count) in Today's draft and in the builder (`EDITS` block).
  - `Keep for next time?` replays them on the plan day's **template** for his chosen controls (un-fitted, before the deload and the coach) and compares that with the template for that main lift.
  - Picking another main lift picks that template (S1). The `kept` name is then `Chest · Incline`.
  - Tests added: 45 + Supersets off → no row; 40 and 35 + Abs off → exactly `− Cable crunch`; Varied → its four lines; coach offer applied then Cable fly back to 3 → no row; deload, Cable fly 2 → 3 → no row.
- **B2 and "broader than dumbbells".** Confirmed (dumbbells on 2 kg steps and light barbell tops in every focus). Fix (SP2, proposal for Ben, §3.1 item 9): with no achievable load in the band, the one nearest the band that is below the top, on a tie the lighter; never the top. A top with nothing below it keeps its load and the back-offs do 1 rep fewer (spec; nothing in the prototypes is that light). One copy of `backOff` in all five prototypes, including the active workout's old simplified copy. Tests added:
  - A property test of the shared code for Strength, Balanced and Muscle, steps 1, 1.25, 2, 2.5 and 5 kg, top-set reps 5–8, tops up to 250 kg.
  - Every focus × effort × week × main lift in the plan builder, the dumbbell press included.
  - Muscle 26 → 24 (7.7 %) is outside the band by design: it's nearer the band than 22 (15.4 %). Acceptance §3a.5 is reworded to match.

### Follow-ups

- **Rule 5 and rule 3: a stale offer applied over Ben's edit.** Confirmed. The offer line now shows only while its exercise reads `from` (Cable fly at 3 sets). Apply checks again and refuses with `Out of date`. Test: Edit, Cable fly to 4 → no offer on Your workout or on Today.
- **Rule 5 and rule 2: Today's offer ignored the fit, and its Apply refitted.** Confirmed. The offer is now applied after the fit to the draft as shown (nothing is refitted). It's withdrawn when the fit changes Cable fly. With the new fit, 35 min keeps Cable fly at 3 (Triceps pushdown is dropped), so the offer stays and Apply changes only Cable fly (tested). At 30 min Cable fly is cut to 2 and neither screen offers it (tested).
- **D4 vs SS4/HT8.** Confirmed. When today's top is lowered (pain hold, coach, Ben, R2, deload), the back-offs drop by the same factor and snap down (`lowerBackOff`). Pain-held bench now reads `100 / 92.5`, deload `92.5 / 87.5` (unchanged), early-deload repeat `100 / 95`. Specs fixed (workout-builder-v3 §3.1, training-blocks revision and §4.4, plan-builder §2). Tests added for all three. Note for Ben: deload is treated as a lowering (−10 % on both). HT8's list doesn't name deload, but SS4's general sentence covers it, and the numbers match the old rule here.
- **D3 regression (today-only choices lost).** Confirmed. The builder sends Ben's controls and edits back to Today as he makes them (`todayedit` through the shell). Today's card shows the edited draft with `Edited`; Start and the next Edit use it; Time refits around it (FT5). Spec conflict resolved for "keep" (§2.0.4, §2.0.5, §2.1). Prototype gap: loads, reps, order and pairing typed on Your workout don't come back to Today's card. Tested: Abs off → `‹ Today` → no crunch, `Edited`, Edit shows Abs off, Start has no crunch, Summary `− Cable crunch`.
- **D5 regression in the Set up chat.** Confirmed. A named part is recorded (`s.want`), and `poolFor` takes it first, so "add hamstrings" adds a hamstring exercise, "add triceps" a triceps one, "add biceps" a biceps one. Tested as "one more of that part than without the words".
- **Plan builder Any days.** Confirmed. `Build plan` resets the days to the usual ones for Sessions a week when Any days doesn't match it. Tested.
- **D7 one back control on Your plan's row pages.** Confirmed. The plan builder tells the shell when a row's page is open, and the app's `‹ Library` hides, so Ben can't leave mid-edit (which also removes the "reopens on Your week" path). Tested.
- **Profile › Split and Workout defaults.** Confirmed. They now open Library › Your plan itself. Tested from Library › Exercises.
- **Spec text contradicting D2 and D3.** Confirmed and fixed:
  - §2.0.7: offers via `propose_workout_edit`, never `set_next_session_targets`.
  - §2.0.8 #3, #4, #9.
  - §2.0.4 rows: `Other day`, `Coach offer pending`, `Edited`, and `No plan` (S4).
  - §2.0.5 type-chip and tap-card rows struck.
  - §2.1 line about expanding.
  - §2.3 paused/ended row.
  - §2.9 wireframe and bullets without `Update plan day`.
  - The region list's chips and collapsed card struck.
- **`↻ Mix it up` removal not flagged.** Confirmed. The D3 note no longer presents it as Ben's decision. A proposal (a fifth row on Your workout) and the variation gap (chips gone; nothing creates a variation after D1) are listed for Ben as §9 Q-R6. Not built.

### Should fix and nits

- **S1:** fixed with B1.
- **S2:** fixed. Pairing is a counted step, and the cut that loses the least training overall replaces the step-by-step greedy cut, so the result never improves as Time drops. Same code on both Todays. Sweep test: all four days, 60 → 20 min, sets lost never fall and the estimate fits down to 25 min. Chest at 35 now drops only Triceps pushdown.
- **S3:** fixed. A control change replays Ben's edits on the new choice. Listed for Ben as Q-R8, since it reverses a builder assumption.
- **S4:** fixed. No-plan row rewritten; training-blocks §4.4 now says the deload runs before the fit.
- **S5:** fixed as an offer (`Carry over`, then `Undo`), by muscle, to each muscle's next day, at most 4 sets. Whether it's an offer or on by default is Q-R3 (SP3).
- **S6:** `Open in builder ›` now sends the day's template, so Keep works from the plan. Mid-workout structure changes are listed in §2.8 as a known prototype gap.
- **S7:** the plan's Main focus goes from the plan builder (Apply plan / Apply changes) through the shell to Today, the builder and the workout. With no plan, the Profile goal maps to a band (both → Balanced; Q-R10). Test: a Muscle plan reads `102.5 / 92.5` on Today and in the workout.
- **S8:** README and specs now say what is spec only: D8, the Bench load offer, Mix it up, Your workout's Time, and mid-workout Keep.
- **N1–N7:** fixed. N1: example reworded. N2: VoiceOver uses Quads. N3: `Your plan changed`, with the lines re-listed. N4: proposal Q-R5. N5: a swap line only for a real swap. N6: the ★ line removed. N7: `[Proposal]` tag added.
- **N8:** explained, not changed. Your plan's recorded week uses the fixture's 2.5 kg dumbbells (32.5 / 30, as Today), and a plan built in setup uses the example gym's 2 kg dumbbells. These are two example kits. A comment says so in `recWeek`.

### Spec issues for Ben

SP1–SP8 are written up as workout-builder-v3 §9 Q-R1 to Q-R10, each with the designer's recommendation. SP1, SP2, SP3, SP7 and SP8 are built as recommended; SP4, SP5 and SP6 are spec only. Nothing was added to `docs/brief/CHANGELOG.md`: these are proposals until Ben approves them.

---

## Re-review 1 (23 Oct, after fix round 1)

I reviewed the same uncommitted working tree after the designer's fix round: 23 files under `docs/`, nothing in `apps/` or `packages/`. This commit changes only this review. The other 22 files are still uncommitted.

### Verdict: CHANGES NEEDED

The round-1 blockers are fixed, and so are almost all of the follow-ups:
- `Keep for next time?` no longer lists the fit, pairing, the deload or the coach.
- Back-offs stay below the top in every focus and kit step.
- The gate passes.
- Coach offers go stale correctly.
- Today keeps Your workout's choices.

Two new problems block. Both come from the fix round's edit tracking:
- **R1.** Add and Swap crash Your workout when it's opened from Today or the plan. Today's changes now live on that screen (D3).
- **R2.** A swap on a slot the fit trimmed carries the fit's set count into `Keep for next time?`, without showing it. This is B1's failure through another path.

### Checks run by the reviewer

- `python3 docs/design/prototypes/app/build_app.py <scratch>/appout`: **passed** on a clean run: `fixture check: ok`, then `click-through check: ok` (about 2 min, no page or console errors). The fix round hadn't run it; it passes as delivered.
- `git diff --check`: clean. No changes outside `docs/`. There's no typecheck, lint or vitest for a docs-only batch.
- The six changed prototypes load standalone with no console errors.
- I ran my own Playwright probes on the built app and the standalone prototypes, then deleted them. They covered:
  - Keep after control changes, set changes and removals at 60, 40, 35 and 30 min.
  - The coach offer applied on Your workout, then `‹ Today`.
  - Undo of a control change.
  - Switching days with edits.
  - Removals and added sets followed by a Time change.
  - Add and Swap from Today's `Edit` and from `Open in builder ›`.
  - The stale offer in the standalone builder.
  - Ben typing a lighter top.
  - The shared `EDITS` and `BACKOFF` code run directly on edge cases.

### Round-1 findings: status

| Finding | Status |
|---|---|
| B1 Keep counts Time cuts, coach and deload | **Fixed** for controls, removals and set counts. `check_app.mjs` covers 45 + Supersets off, 40/35 + Abs off, Varied, coach-then-restore and deload. My probes also show no row for: 30 min with Incline put back to 3, and the coach offer applied on Your workout. **Open for swaps (R2).** |
| B2 Back-off equals or leaves the band | **Fixed.** One shared `backOff` in five copies, identical by `build_app.py`. There's a property test over 3 bands × 5 steps × 4 rep counts, and a sweep over every focus, effort, week and main lift, including the DB press. |
| B3 Gate fails | **Fixed.** Labels read `22 and 23 Oct`, and the shared-code check was added. |
| Process: commit by topic | **Not done.** Still 22 builder files uncommitted. |
| Stale offer in the builder | **Fixed.** `+ Set` on Cable fly withdraws the line, and Apply on a stale offer is refused with `Out of date`. |
| Today's offer vs the fit | **Fixed.** At 35 min, Apply changes only Cable fly. At 30 min the offer is gone on both screens. |
| D4 vs SS4/HT8 (lowered top) | **Fixed** for the pain hold (`100 / 92.5`) and the deload. Ben's own lighter top isn't prototyped (S2 below). |
| D3 regression (edits lost going back) | **Fixed** for controls, removals and set counts, with day switching and Undo. **Add and Swap crash (R1).** |
| D5 Set up chat names a part | **Fixed** (tested for triceps, biceps and hamstrings). |
| Any days, one back control, Profile › Split / Workout defaults | **Fixed** (tested). |
| Spec text contradicting D2 and D3 | **Fixed.** None of the listed lines remain unstruck, and `set_next_session_targets` is now Summary-only. |
| `↻ Mix it up` removal not flagged | **Fixed** (§9 Q-R6). |
| S1–S8, N1–N8 | **Fixed or explained.** S2's sweep passes. S5's carry-over is now an offer by muscle, but its content can be wrong (S1 below). S6's `Open in builder ›` path has the R1 crash. |

---

### Blocking

#### R1. Add and Swap crash Your workout when it's opened from Today's `Edit` or a plan day's `Open in builder ›`

**Where:**
- `docs/design/prototypes/workout-builder-v3.html:363`: `rowOf` calls `workRows(e)` (`:303`), which reads `e.per.filter(...)`.
- An added or swapped exercise has `per: undefined` until the next render runs `perOf`:
  - Add: `pick`, `:964`.
  - Swap: `swap`, `:1006` (sheet and swipe).
  - Coach chat: `papply`, `:1054`.
  - Review suggestions: `sy`, `:1019`.
- `view()` runs `syncEdits()` (`:818`) **before** rendering. For a swap or add, `syncEdits` builds `{ op: 'swap' | 'add', row: rowOf(e) }` (`:403`, `:405`).

**Failure (built app, every case reproduced):**
- Today with a plan → `Edit` → `＋ Add exercise` → Machine chest press. Result: `TypeError: Cannot read properties of undefined (reading 'filter')`.
  - The sheet stays open and the list doesn't change.
  - Every later tap throws again, so the screen is stuck.
  - `‹ Today` shows the card without the addition.
- The same happens for:
  - Swap from the exercise sheet and from the swipe.
  - The coach chat's `Swap cable fly` → Apply.
  - Library › Your plan › `Open in builder ›` → Swap.
- The standalone builder (Build your own) works, because `syncEdits` returns early with no `s.from`.

**Effect:**
- D3 moved today-only work to this screen, and the spec's answer to `↻ Mix it up` is "Your workout's Swap does the same job". Neither works.
- The B1 fix can't produce `+ X · 3 sets` or `A → B` in the app at all.
- The gate passes only because `check_app.mjs` never adds or swaps on an opened draft.

**Fix:**
- In `rowOf`, use `perOf(e)`, or have `syncEdits` call `perOf` on every exercise first.
- Add click-through cases, both from Today's `Edit` and from `Open in builder ›`:
  - Add, Swap (sheet), Swap (swipe), chat swap Apply and a review suggestion.
  - Each must give no page error and the change on the list.
  - Then `‹ Today` shows the change with `Edited`, and Start → Summary lists `+ <exercise> · 3 sets` or `<from> → <to>`.

#### R2. A swap on a slot the fit trimmed carries the fit's set count into `Keep for next time?`

**Where:**
- `syncEdits` stores the swapped-in row as shown, with `sets` from the fitted draft (`workout-builder-v3.html:403`, `row: rowOf(e)`).
- `replayEdits` puts that row into the template's slot (`training-blocks.html:431`, the same `EDITS` block in the builder at `:337`).
- `structureLines` prints only `<from> → <to>` for a swap (`:445` / `:351`).
- `workout-builder-v3.md:620` (§2.8 Data) says Apply writes the result as absolute values.

**Failure:** I ran the shared `EDITS` code directly; in the app, R1 hides this until it's fixed.
1. The template has Triceps pushdown × 3.
2. At Time 40 the fit trims it to 2.
3. Ben swaps it for Overhead triceps extension. The replayed template now holds `Overhead triceps extension × 2`.
4. The Summary row shows only `Triceps pushdown → Overhead triceps extension`.
5. Apply writes a 2-set slot into the Chest day.

A set is lost from the plan for good because of a short session, and the row never shows it. That breaks D1 ("Time changes never ask") and §2.8's "Never for: Time or the fit".

**Fix:**
- A swapped-in exercise takes the template slot's set count. Record a `sets` op only when Ben changes the count himself.
- Alternatively, show the count on the swap line whenever it differs from the slot's template count (`… → Overhead triceps extension · 2 sets`).
- Add the test: 40 min, swap Triceps pushdown → the replayed template has 3 sets, and the row shows only the swap.

---

### Should fix (non-blocking)

#### S1. The fit runs on the plan template, not on the draft with Ben's edits, so the Time note, its detail and the carry-over describe a different workout

**Where:** `training-blocks.html:507–519` (`draft()`: `core()` fits the template, then `replayEdits`) and `carryOf` (`:528`). `fit-to-time.md:14` calls this the design. `workout-builder-v3.md:119` and `:271` say "Time refits around it". FT4 (`fit-to-time.md:48`) says the fit re-runs after every other edit.

**Failures** (built app):

| Ben's edit on Your workout | Then on Today | What the card shows |
|---|---|---|
| Removes Triceps pushdown | Time 35 | `Time · −1 exercise ›`, `Dropped Triceps pushdown` and `+3 triceps sets on your next Shoulders day? Carry over`: a carry-over for sets he removed himself |
| Triceps pushdown → 4 sets | Time 35 | Triceps pushdown × 4 (moved to the end), `~43 min` against 35. The detail still says `Dropped Triceps pushdown` and offers the same +3, so one tap gives 7 triceps sets that week. |
| Removes Cable fly and Triceps pushdown (`~36 min`) | Time 45 | `shorter rests`, `~32 min`, though 36 fits |
| Same removals | Time 40 | `−1 set` while no row changed |

**Fix:**
- At least, work out the note, the detail and the carry-over from what's actually cut from today's edited workout. Leave out exercises Ben removed or set himself.
- Skip steps the edited draft doesn't need, such as shorter rests when it fits.
- Better: fit the edited draft with Ben's slots fixed (FT5). Whether added work may cost other cuts is Ben's call (SP-B below).

#### S2. Ben's own lighter top doesn't lower the back-offs on Your workout

**Where:** `workout-builder-v3.html:946–948`. Typing a kg marks it manual and doesn't touch the back-off rows.

**Failure:** standalone builder, bench top 102.5 → 100 reads `1 × 6 + 2 × 8 · 100 / 95`. §3.1 item 9 (`workout-builder-v3.md:707`) now lists "Ben's own lighter top" as a lowering, which gives `100 / 92.5`.

**Fix:** lower the back-offs that aren't manual by the same factor, or add this case to the README's spec-only list.

#### S3. The fit's search is exhaustive, and that won't scale to Your workout's limits

**Where:** `fit-to-time.md:12` ("every way … is tried") and the `FIT` block (`training-blocks.html:396–411`).

**Problem:** Today's 4–5 accessories × 3 sets is about 81 combinations. Your workout allows 10 exercises and up to 8 sets each (§8 limits), which is about 7⁹ ≈ 40 M combinations per Time tap on the phone.

**Fix:** specify a bounded method for `fitPlanToMinutes` before the slice is handed off, e.g. a knapsack over minutes, or a cap with the greedy fallback. Keep the monotonic-sets property as an acceptance test.

#### S4. Saved workouts have no `Keep for next time?`

**Where:** D1 says "or that saved workout", but Library › Workouts opens a fresh builder (`app-shell.html`, `data-wo` → `push('builder')`).

**Problem:** the README's spec-only list (`README.md:28`) doesn't mention it.

**Fix:** add it to the spec-only list, or prototype it.

### Nits

- **N-a.** A `sets` edit on an exercise the fit dropped re-adds it at the end (`replayEdits`, `training-blocks.html:432`). Triceps pushdown jumped after Cable crunch. Put it back in its template position.
- **N-b.** `backOff` returns the top itself when nothing is below it (top ≤ one step) but keeps 8 back-off reps. The spec says 1 rep fewer. The property test starts at 3 steps, so this is untested. Unreachable at the fixtures' loads, but Your workout lets Ben type any top.

### Spec issues (for Ben and the designer)

- **SP-A. A set cut on top of a fit cut.** At 40 min the fit takes Triceps pushdown 3 → 2. If Ben deletes one more set, the row lists `Triceps pushdown 3 → 1 sets`. That follows §2.8 ("the number he chose"), but Apply then keeps the fit's set too. Ben should choose: absolute counts (as now), or relative to what he saw (`3 → 2`).
- **SP-B. Fit before or after Ben's edits.** The fit-to-time revision (replay after the fit; the estimate may go over Time) conflicts with FT4 and with "Time refits around it". Ben should choose whether added work can cost other cuts (S1).
- **SP-C. A coach change Ben asked for in Your workout's chat.** After R1's fix, it would be diffed as Ben's own edit and listed by Keep. §2.8 says "Never for: … a coach edit (D2 offers, D8 next-time changes)", which doesn't say whether a change Ben asked for counts.
- **SP-D. SP2's fallback can drop far.** "Nearest below the top" picks Strength DB 10 each → 8 (20 %) and a 10 kg top on a 5 kg stack → 5 (50 %). Consider: beyond a limit (e.g. the general 15 %), keep the load and do 1 rep fewer instead.

### Process

The fix round's 22 changed files are still uncommitted, and this commit adds only this review. Once R1 and R2 are fixed and `build_app.py` passes, commit them in the topic commits the fixes note lists. Don't push.

## Fixes after re-review 1 (23 Oct, designer)

Each finding was confirmed by reading the code paths the review cites before changing anything.

**Not run yet:** this fix round had no shell, so `python3 docs/design/prototypes/app/build_app.py <out>` and the commit are still to do. Run the build, then commit (no push). The new checks are written but have not been executed.

### Blocking

- **R1, confirmed and fixed.** `rowOf` → `workRows` read `e.per` before an added or swapped-in exercise had rows. `workRows` now makes the rows first (`e.per ??= genRows(e)`), and `rowOf` calls `perOf(e)` so the row's sets match the screen (`workout-builder-v3.html`). That covers every path the review lists: pick, sheet Swap, swipe Swap, chat `papply` and review `sy`. **Test:** `check_app.mjs` runs Add, sheet Swap, swipe Swap, chat swap and a review suggestion (the first Add or Swap one) from `Edit` and from `Open in builder ›`. It checks for no page error. From Edit, it also checks that Today's card shows the change and `Edited`. In both cases the Summary's `Keep for next time?` must list exactly `+ <exercise> · 3 sets` or `<from> → <to>`.
- **R2, confirmed and fixed.** A swapped-in exercise now takes the set count of the slot it replaces when it's replayed (`sets: o.n ?? was.sets`). Today's draft therefore keeps the fit's 2 and the template keeps 3. A count Ben sets himself is recorded on the swap as `n`: `syncEdits` stores it when the swap arrives with a count different from the slot's, and `mergeOps` stores it for a later `sets` edit and keeps it when swaps are chained. `structureLines` adds the count to the swap line when it differs (`Triceps pushdown → Overhead triceps extension · 3 → 4 sets`). The shared `EDITS` block is identical in both prototypes. **Tests:** a unit test of the shared code at Time 40 covers three cases: swap alone (today 2, kept 3, swap line only), swap then Ben sets 4, and swap then Ben sets 2. A click-through does the same on Today: Time 40 → Edit → swipe Swap Triceps pushdown, with and without setting it to 4. Spec: workout-builder-v3 §2.8 (new bullet, copy, acceptance 13–14).

### Should fix

- **S1, partly fixed, the rest goes to Ben (SP-B).** On Today, `draft()` now leaves out of the fit note, its detail and the carry-over anything the fit cut from an exercise Ben removed, swapped or set a count on. Removing Triceps pushdown then setting Time 35 no longer offers `+3 triceps sets` or lists `Dropped Triceps pushdown` (click-through test). The minutes are already the edited draft's. Running the fit **on** the edited draft (so added work could cost other cuts, and removals make Time 45 a no-op) is SP-B and is not changed. Noted in fit-to-time.md (re-review 1 fixes).
- **S2, fixed.** If Ben types a top lighter than the one its back-offs came from, they drop by the same % (`lowerBackOff`, as Today's held top: 102.5 → 100 gives 95 → 92.5). Typing a heavier top, or the original, works them out again (D4). Back-offs he typed himself stay. **Test:** typing 100 on Your workout shows `1 × 6 + 2 × 8 · 100 / 92.5`, and typing 102.5 back shows the fixture line.
- **S3, spec fixed.** fit-to-time.md now specifies an exact grouped knapsack in 15 s buckets, run once per candidate pair: about 0.9 M steps at Your workout's limits, and it keeps the monotonic property. The prototype keeps its exhaustive search, which is fine at 4–5 accessories.
- **S4, spec fixed.** The saved-workout `Keep for next time?` is now marked spec only, not prototyped, in §2.8.

### Nits

- **N-a, fixed.** A set count that brings back an exercise the fit dropped now puts it back in its template place (shared `EDITS` code, unit test).
- **N-b, not changed.** In the prototype, `backOff` returns only a load, so "1 rep fewer when no real load is below the top" needs a return-shape change in all four `BACKOFF` copies. It can't be reached at the fixture loads. It stays a domain requirement (spec §3.1 item 9) for `packages/domain`'s back-off function and its tests. It is related to SP-D.

### Spec issues, still for Ben

SP-A (absolute or relative set counts on top of a fit cut), SP-B (fit before or after his edits), SP-C (whether a chat change he asked for counts in Keep; the prototype currently counts it, as the R1 tests expect), SP-D (a floor on the back-off fallback). None of these is decided here.

## Re-review 2 (23 Oct, after fix round 2)

**Verdict: CHANGES NEEDED.** One blocking issue, and it's in the test, not the design. The R1 and R2 fixes work. I confirmed them by running the prototypes, not just by reading them.

### Checks run by the reviewer

- `python3 docs/design/prototypes/app/build_app.py <scratch>/appout` as delivered: the static checks pass (`fixture check: ok`, shared `BACKOFF`/`EDITS` copies match). The click-through **fails** after about 115 s: `locator.click: Timeout 30000ms exceeded … waiting for locator('.sheet [data-a="to-swap"]')` at `check_app.mjs:370` (R3 below). Exit code is non-zero.
- Scratch copy of `check_app.mjs` with only the three row taps (`:370`, `:446`, `:452`) changed to Playwright pointer clicks (`b.locator('.er', { hasText: … }).first().click()`): **`click-through check: ok`** (about 158 s, no page or console errors). Every R1 case (Add, sheet Swap, swipe Swap, chat swap, review suggestion, each from Edit and from Open in builder ›), the R2 unit and click-through cases, S2 and S1 pass.
- Mutation check: with the R1 fix taken out of the built `workout-builder-v3.html` (`workRows` without `??= genRows`, `rowOf` without `perOf`), the fixed check fails. So the new R1 cases do catch the regression, although it shows as a later timeout (the sheet left open) and not as the R1 message.
- My own probes (Playwright, built app):
  - Chained swap at Time 40 (Triceps pushdown → Overhead triceps extension → EZ-bar curl): today shows 2 sets, and Keep lists exactly `Triceps pushdown → EZ-bar curl`. Correct.
  - Swap at Time 40, then back to Today and Time 60: the swapped-in exercise gets 3 sets on Today's card, and Keep lists the swap alone. Correct.
- `git diff --check`: clean. No untracked files. Nothing in `apps/` or `packages/` was touched.

### Blocking

- **R3. `build_app.py` fails as delivered. The new sheet-Swap and S2 cases tap rows in a way the screen ignores.** Where: `docs/design/prototypes/app/check_app.mjs:370`, `:446`, `:452`, which do `b.evaluate(\`(${rowEl})('…').click()\`)`. Your workout opens an exercise's sheet on `pointerdown` → `pointerup` (`workout-builder-v3.html:836-837` and `:879-882`). There is no `click` handler on `.er`, so a synthetic `click()` does nothing. Failure: the `sheet Swap` case waits 30 s for `.sheet [data-a="to-swap"]` and then throws. That kills the run, so the R2 click-through (`:420-440`), the S2 typed-top case (`:443-455`) and the S1 case after it never execute in the delivered gate. This is the same kind of failure as round-1 B3: the batch's own gate is red. Fix: use a real pointer tap, as `addSetsTo` already does (`b.locator('.er', { hasText: name }).first().click()`). Better still, add a `tapRow(b, name)` helper that matches the name exactly, and use it at all three sites. Then run `build_app.py` to `click-through check: ok` before committing. I verified that this exact change makes the run pass.

### Status of the re-review 1 findings

- **R1: fixed.** `workRows` creates rows (`workout-builder-v3.html:304`) and `rowOf` calls `perOf` (`:365`). All five paths work from Edit and from Open in builder ›. Today's card shows the change and `Edited`, and Keep lists it. Verified by running.
- **R2: fixed.** In the shared `EDITS` code, a swap takes the slot's count (`sets: o.n ?? was.sets`). `syncEdits` (`workout-builder-v3.html:404-412`) records `n` only when the count on screen differs from today's fitted slot. The swap line shows `· 3 → 4 sets` when it differs. The unit cases (swap, then 4, then 2) and the Time 40 click-through pass with R3 fixed. So do my chained-swap and swap-then-Time-60 probes.
- **S1: partly fixed** (tested). Running the fit on the edited draft is still SP-B, for Ben.
- **S2: fixed** (tested once R3 is fixed). Typing goes character by character: an intermediate `1` briefly lowers the back-offs to a tiny ratio. Each keystroke recomputes from the stored originals (`q.from`), so the final value is correct. It's a nit for the app's real input handling, not for the prototype.
- **S3 and S4: spec only**, written in `fit-to-time.md` and §2.8. Acceptable.
- **N-a: fixed** (unit-tested). **N-b: deferred** to `packages/domain`, linked to SP-D. Acceptable.

### Should fix (non-blocking)

- **S5. A count Ben sets that equals the fit's count is lost.** `syncEdits` compares the count on screen with today's **fitted** slot (`workout-builder-v3.html:408`). At Time 40, if Ben sets the swapped-in exercise to 4 and then back to 2, no `n` is recorded, and Keep writes 3. The unit case "swap, then Ben sets 2" assumes `n: 2` is stored, but the screen path can't store it. This is SP-A territory (absolute or relative counts on a fit cut), so I'm only noting it for Ben's answer and not treating it as blocking.
- **S6. The R1 cases report a regression as a timeout, not as R1.** When a case hits a page error, it `continue`s with the sheet still open. The next case's state then breaks a later wait (seen in the mutation run at `:440`). Close any open sheet, or `reset`, before `continue`, so the failure names the case.

### Nits

- `rowEl` matches on `.nm`'s first text node, while `addSetsTo` matches with `hasText` (substring). Pick one exact-name helper for the whole file.

### Spec issues, still for Ben

SP-A, SP-B, SP-C and SP-D are unchanged (see the fixes note above). S5 depends on SP-A.

### Process

The designer's 23 changed files under `docs/` are still uncommitted. This commit adds only this review, as before. After R3 is fixed and `build_app.py` passes, commit the builder's work in the topic commits listed in the fixes notes, with the required trailer. Don't push.

## Fixes after re-review 2 (23 Oct, designer)

Test-only changes, all in `docs/design/prototypes/app/check_app.mjs`. No design or prototype behaviour changed.

- **R3: confirmed and fixed.** Your workout has no `click` handler on `.er`. It opens the sheet on `pointerdown` → `pointerup` (`workout-builder-v3.html:836-837`, `:879-882`), so the three `evaluate(... .click())` row taps never opened anything. New `tapRow(b, name)`: it finds the row whose `.nm` first text node matches the name exactly, taps it with a real Playwright pointer click on `.er` `nth(i)`, and returns whether a `.sheet` opened (`.sheet` is rendered only while a sheet is open, `workout-builder-v3.html:826`). It's used for `sheet Swap`, both S2 bench taps, and `addSetsTo`. The `qswap`/`qdel` taps stay as DOM clicks because they're `[data-a]` buttons served by the `click` handler.
- **S6: fixed.** `sheet Swap` returns a named reason ("tapping Cable fly didn't open its sheet", "no Swap on Cable fly's sheet") instead of waiting 30 s. A case that throws is caught and reported under its own label. Any failing R1 case closes its open sheet (scrim) before `continue`, so later cases start clean.
- **Nit (exact-name helper): fixed.** `addSetsTo` now uses `tapRow` (exact match) instead of the `hasText` substring.
- **S5: not changed.** It depends on Ben's SP-A answer, as the reviewer noted.
- **Not done in this round: running and committing.** This designer session had no shell, so `build_app.py` wasn't run here and nothing was committed. The change matches the reviewer's verified scratch fix (pointer clicks at the same three sites), plus the S6 guard. Next step for the orchestrator: run `python3 docs/design/prototypes/app/build_app.py <scratch>/appout` until it reports `click-through check: ok`, then commit the docs work with the required trailer. Don't push.

## Re-review 3 (23 Oct, after fix round 3)

**Verdict: PASS.** The gate is green as delivered. The one blocking issue (R3) was in the test, and it's fixed. No design or prototype behaviour changed in this round. I checked that by reading the diff, which only touches `check_app.mjs` and this review.

### Checks run by the reviewer

- `python3 docs/design/prototypes/app/build_app.py <scratch>/appout` on the delivered tree: `built 6 files`, `fixture check: ok`, **`click-through check: ok`** (2 min 38 s). That covers every R1 case (Add, sheet Swap, swipe Swap, chat swap and review suggestion, each from Edit and from Open in builder ›), the R2 unit and Time 40 click-through cases, S2 (typed top 100 → `100 / 92.5`, then back to 102.5) and S1.
- Code read of `check_app.mjs`:
  - `tapRow` (`:76-81`) matches `.nm`'s first text node exactly, taps `.er` `nth(i)` with a real Playwright pointer click, and returns whether `.sheet` opened.
  - It's used by `sheet Swap` (`:378`), both S2 bench taps (`:458`, `:464`) and `addSetsTo` (`:84`). The `qswap`/`qdel` taps stay as DOM clicks on `[data-a]` buttons, which the click handler serves. That's correct.
- Mutation check: I removed the R1 fix from the built `workout-builder-v3.html` (`workRows` without `??= genRows`, `rowOf` without `perOf`). The gate goes red (node exits non-zero), so the regression is still caught.
- `git diff --check`: clean. No untracked files. Nothing outside `docs/` was touched.

### Blocking

None.

### Status of earlier findings

- **R3: fixed** and verified by running it.
- **Exact-name nit: fixed.** `addSetsTo` uses `tapRow`.
- **S6: partly fixed (not blocking).** The R1 loop now records a named reason and closes the sheet before `continue`. But in the mutation run, the swap's page error leaves a sheet open in the **R2 click-through** (`check_app.mjs:440-454`), which has no error or sheet guard. `b.locator('[data-a="start"]').click()` at `:452` then times out after 30 s, and the uncaught throw ends the run before the collected `bad` list (including the R1 messages) is printed. So a regression still shows as a timeout at `:452`, not under its own name. Suggested fix: wrap the click-through body in `try/finally` and print `bad` before rethrowing, or give the R2 loop the same `errors.length` check and `closeSheet` that the R1 loop has.
- **S5: open**, depends on SP-A (Ben).
- **R1, R2, S1 (partial, the rest is SP-B), S2, S3, S4, N-a, N-b:** unchanged from re-review 2 and still pass.

### Spec issues, still for Ben

SP-A, SP-B, SP-C and SP-D are unchanged.

### Process

This commit adds only this review. The designer's 23 changed files under `docs/` are still uncommitted. With the gate green, they should now be committed on `claude/gracious-knuth-joxqpw` in the topic commits listed in the fixes notes, with the required trailer. Don't push.
