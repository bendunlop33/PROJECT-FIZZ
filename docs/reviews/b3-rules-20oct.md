# Review: Workout builder v3, S2 "Domain rules (pure)" (branch `claude/b3-rules-20oct`)

**Verdict: CHANGES NEEDED**

Scope: `git diff 02a796a..HEAD` (commits 0111f59, 1bfce45, f380fb3). These add `packages/domain/src/builder/*`, an export line in `packages/domain/src/index.ts` and four test files. I checked them against `docs/design/workout-builder-v3.md` §2.0.2, §2.2–§2.4, §3, §4.1/§4.3/§4.7, §8 S2 and §9 answers, and against CLAUDE.md rules 2–6 and 10.

## What I ran

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` and `-p apps/mobile/tsconfig.json` | pass |
| `eslint packages/domain` | clean |
| `vitest run packages/domain/test/builder-v3*` | 4 files, 63 tests pass |
| `vitest run packages/domain` | 138 files, 2,960 tests pass |
| Scratch probes (temporary test file, deleted, not committed) | reproduced B1, B2 and B3, plus S1–S5 below |

These spec numbers recompute correctly: 100 × (1 + 8/30) = 126.67, and 126.67 / (1 + 10/30) = 95.0, so back-offs are 95 × 8 @ 8. 95.25 rounds to 95 on 5 kg bar steps. A stack capped at 100 never goes above 100. Chest at 20 min is the main lift alone: 1,230 s at the shortest rests, which is `over` (about 21 min). The ladder cuts at 55, 50, 45, 40, 30 and 25 min. Bench 102.5 from a coach target wins over the est. max.

There are no schema, migration or persistence changes, so backward compatibility isn't affected. Rules 2 and 5 don't apply because nothing here writes. Rule 10 is respected: no personal data is stored or mixed in.

---

## Blocking

### B1. Loads come out in the item's unit but are labelled with the slot's unit, so a kg/lb mix doubles the load and can exceed the item's max (rules 4 and 6)
`packages/domain/src/builder/loads.ts:98-109` (`roundDownHere`) returns `r.load.value`, which `roundToAvailableLoad` gives in **the item's unit**. `BuilderSetRow.load` is documented as "in the slot's unit" (`types.ts:106`), and `RoundedLoad` doesn't carry a unit. `requested` and `rounded` (`loads.ts:109`) compare kg with lb. `set-rows.ts:92-100` compares `eq.barMass` and every ramp step (both in the item's unit) against `top` (in the slot's unit).

Reproduced with a kg slot:
- On an lb dumbbell rack, a 20 kg target becomes row load `40`, which is 40 lb shown as 40 kg per hand. A 45 kg target becomes 95 "kg", past the rack's 100 lb (45 kg) max.
- On an lb bar, a bench rule target of 100 kg becomes a top set of `220` and back-offs of `205`. The 50/70/85 % warm-ups are all skipped, because 110 lb ≥ 100 "kg".

The `SlotLoadInput` interface explicitly allows `unit ≠ equipment.unit`, and the code handles `convertedRequest`, so this isn't just a theoretical input. The lb test (`builder-v3-loads.test.ts:118`) uses an lb slot on an lb rack, so it doesn't catch the mismatch.

**Fix:** follow the §4.1 code map and round through `snapPlanToGym` / `fitOn` (mode `start`, `loadDirection()`), where the row's unit becomes `equipment.unit`. Or make `RoundedLoad` and `BuilderSetRow` carry `unit`, and do every comparison (bar mass, ramp, pain cap, `rounded`) in one unit. Add tests for a kg slot on an lb bar and an lb rack, covering the top set, back-offs, warm-ups, drops and a typed kg.

### B2. Weighted bodyweight lifts (`added`) always get no load, and the coach, plan or rule target is silently dropped
`loads.ts:100` returns null when `equipment` is null, presence-only, or the convention differs. Weighted dips and pull-ups map to a bodyweight station, or to dumbbells/plates with convention `per_hand`/`total`. Either way `setRowsFor` gives `load: null` on every row, but `source` stays `'rule'` (or `'coach_target'`). Reproduced with a rule target of 10 (BW+10): equipment `null` gives `[null, null, null]`, source `rule`, and equipment = dumbbells gives the same.

So a coach target for weighted dips never shows up (rule 3). The row reads `—` while claiming a source, and §2.3's `BW+10` display can't happen. The developer summary says "Assisted and added-weight lifts keep their kg", but only assisted is tested.

**Fix:** reuse the existing weighted-bodyweight path (`isWeightedBodyweight` + `addedWeightEquipment` in `session/snap.ts:332-333`). Without equipment, keep the target in the slot's own unit and convention (`fitWithoutEquipment`). When the result is null, set `source: 'none'` so the label is honest. Add tests for `added` with no item and with the gym's dumbbells/plates.

### B3. Group changes in Set up, and growing for time, re-pair singles that Ben deliberately unlinked
`merge.ts:90-91` runs `pairSlots` over the **whole** workout whenever a group exercise is added with Supersets on. `fit.ts:248` (`insertAfterGroup`, used by grow) does the same. `pairSlots` pairs every single, and `BuilderBlock` (`types.ts:139-145`) can't tell "Ben unlinked this" apart from "never paired". Reproduced: Ben unlinks every pair, then raises Triceps from 1 to 2. The result has new auto pairs `cable_fly+pushdown` and `oh_ext+crunch`.

This breaks the agreed merge rule (§2.3, Ben: "Supersets re-pairs only pairs the builder made … every other edit is kept") and the S3 acceptance check that "a length or group change keeps an earlier" edit.

**Fix:** pair only the newly added slot, with a single that was never unlinked. Record unlinks, for example with `unlinked?: true` on the slot or a `touched` flag on the block that Unlink and Move set, and have `pairSlots` skip them. Add a merge test and a grow test that start from a Ben-unlinked workout.

---

## Should fix (not blocking)

### S1. `＋ Set` / `setWorkingCount` copies a drop set as a working set and puts it after the drop
`set-rows.ts:232-236`. If the last working row is a drop, the copy becomes a `working` set with the drop's reps (14), its 78 % load and RPE 9, placed after the drop. Reproduced on a cable fly: `[40×8, 40×8, 40×8, drop 30×14, working 30×14 @9]`. §2.4 says `＋ Set` "copies the last working set". The same function drives the fit-ladder grow, `set_count` variation ops and merges.
**Fix:** copy the last non-drop, non-warm-up row and insert it before any trailing drops. When removing sets, remove a drop together with the set it follows. Add a test.

### S2. A typed kg is silently capped by the pain hold, and `Why?` would call it rounding
`set-rows.ts:205-208` rounds a typed kg with `roundCtx(load)`, which includes `painCap`. Reproduced: with a pain cap of 30, Ben types 45 and gets 30 with `rounded: {requested: 45, rounded: true}`. §2.3 says a "Kg Ben typed stays, with `May hurt`", and §2.4 says `Why?` names the rounding item. The result also gives no reason for the cap, so `Why?` would say "Rounded down: … plates" when the real reason is the pain hold (rule 6 honesty).
**Fix:** round typed kg without `painCap` and let the UI show `May hurt`. Alternatively, if Ben decides typed kg should also be capped, add `capped: 'pain'` to `RoundedLoad`. Add a test either way.

### S3. A typed kg below the item's lightest load becomes `—` and is marked as typed
`set-rows.ts:206-207`. Typing 3 on a 5–100 stack stores `{load: null, typed: true}`. Ben's entry disappears, and because the row is "typed", no later reps or RPE edit will recalculate it.
**Fix:** refuse the edit with a reason (e.g. `below_min`, plus the lightest value for the UI), or store the lightest load with `bounded: 'min'`. Never store `null` + `typed`.

### S4. RPE and reps edits aren't range-checked, so loads can go above the anchor
`set-rows.ts:210-215`. With RPE 14 the RIR is negative, and the recalculated kg (45) is heavier than the working load (40). The schemas cap RPE at 1–10 in steps of 0.5 (`schemas/src/coach.ts:278`), but this pure function accepts anything.
**Fix:** clamp or refuse RPE outside 1–10 (0.5 steps) and reps outside 1–100, matching the schema.

### S5. With no main lift, the fit ladder can return an empty workout as `fitted`
`fit.ts:125-133`. Every non-main slot can be dropped. §3.6 says "never below … 1 exercise when there's none". Reproduced with 2 chest accessories and `minutes: 3`: 0 blocks, `status: 'fitted'`. `minutes` isn't clamped to 15–180 either.
**Fix:** stop band (d) when one slot would be left, return `over` in that case, and clamp or validate `minutes`.

### S6. `orderSlots` alternates compounds by part on every day, not only leg days
`arrange.ts:40-47`. Part is the group name off legs, so a different-group compound jumps ahead. Reproduced: bench → lat pulldown → incline DB → machine press. On a Push day the OHP will land between the chest presses. §3.4 calls for alternation only for quad/hinge on leg days.
**Fix:** alternate only when the parts are `quads` / `hamstrings_glutes`. Elsewhere keep the order stable (main group first).

### S7. Mapping `plan` to `coach` would label plan loads "Coach target"
`types.ts:59-64` (MERGE NOTE) maps `plan → coach`. §2.4 `Why this weight?` shows `Plan, week 1` as a separate source, and §4.4 only adds `calc` and `ben`.
**Fix:** ask S1 to add `'plan'` to `DraftLoadSchema.source` (as an optional enum value, so old rows still parse), and update the note. Flag this to S1 now, because it's a schema change that would otherwise collide.

### S8. One S2 acceptance check isn't met, and the code map isn't followed for fit and rounding
§8 S2: "Today, the builder and time left agree for the same workout." `estimate.ts:131` defines new local constants. The existing `session/duration.ts` / `time-left.ts` estimator is pace-based and rounds to 5 min, so the two will disagree for the same workout. §4.1 also maps "Fit to length" to `fitPlanToMinutes` and "rounded down" to `snapPlanToGym`. This branch adds a second fit implementation (`builder/fit.ts`) alongside `session/fit-time.ts`, and bypasses snap, which causes B1 and B2.
**Fix:** either move the shared time constants (Q15) into one module now and assert agreement in a test, or explicitly hand the check to S1 or S8 in the slice tracker. Write an ADR or a comment explaining why a second fit ladder exists and when `fitPlanToMinutes` is retired.

### S9. `makeSlot` throws away the `Start light` cap and the estimate flag
`slot.ts:11` copies `rows`, `source` and `anchorE1rm` but drops `startLight` and `estimate`. `BuilderSlot` has no field for them, so Your workout can't show `Start light` (§2.3 "Load unknown") without calling `ctx.loads` again.
**Fix:** add `startLight: number | null` to `BuilderSlot` (`estimate` can be derived from `source === 'calc'`).

### S10. Test gaps for the edge cases that matter here
The tests don't cover:
- a kg slot on lb equipment (B1)
- `added` loads (B2)
- merging or growing after Ben unlinked a pair (B3)
- a set count change after a drop (S1)
- a typed kg combined with a pain cap or below the item's minimum (S2, S3)
- out-of-range RPE (S4)
- a fit with no main lift (S5)
- order on a non-leg day with compounds from mixed groups (S6)
- growing with Supersets on
- assisted rounding when the requested assistance is past the machine's max, on a set edit

Add these with the fixes.

---

## Nits

- **N1** `set-rows.ts:173-177`: choosing Top set on another row resets the old top's typed kg to a calculated back-off. The new top ignores a typed anchor, so a typed top of 110 is replaced by 100. This is defensible as "a type change recalculates", but the dropped typed kg deserves a test or a `Why?`.
- **N2** `set-rows.ts:177`: changing a back-off to a warm-up leaves the warm-up after the working sets. Either move it into the warm-up block or refuse.
- **N3** `set-rows.ts:248-253`: `lastAtNine` rewrites a middle-set RPE 9 that Ben chose back to 8.
- **N4** `fit.ts:193-198`: the "second arm exercise" candidate isn't restricted to the arm group that has exactly one exercise. Exercises added by grow or merge (`merge.ts:64`) ignore the Focused/Varied set count.
- **N5** `mix.ts:129`: `mixItUpTarget` can pick an ab exercise, or a slot Ben chose himself (`touched`).
- **N6** `build.ts:228`: if the lookup doesn't know the main lift, it's silently left out. Report it, as `short` already does for groups.
- **N7** `fit.ts:142-162`: after a drop, `restoreSets` gives back sets but not rest levels, which is only one reading of "only as far as needed".
- **N8** `variation.ts:271-280`: `add_slot` doesn't check gym availability or pain flags. Make sure S5 does, or add skip reasons.

## Merge and collision notes for parallel streams

- S1 owns `BuilderGroup`, `VariationOp`, `BUILD_LIMITS.maxExercises` and `maxRestS` (360 under Q7). Local copies are marked `MERGE NOTE` (`types.ts:18`, `variation.ts:234`, `rest.ts:38`, `build.ts:19`). Swap them for S1's versions at merge. Also see S7 (`'plan'` source).
- The muscles stream must produce `part` values `quads` / `hamstrings_glutes` / `calves` exactly as `build.ts:139-142` and `arrange.ts` expect, plus `heavy`, `angle` and `barbell`. Agree that contract in writing, or export a shared type.
- `packages/domain/src/index.ts` now re-exports `GroupCount`, `LegPart`, `RestRole`, `VariationOp`, `removeSlot`, `makeSlot`, `canPair` and others from `./builder`. Another stream adding the same names to the domain index will fail with TS2308. Consider a `builder` namespace export.

---

## Spec issues (raise with Ben; not code defects)

1. **The Legs mix breaks the per-group cap.** §3.7 has Legs = 5, but the max is 4 per group with "extras go to other groups". A Legs day therefore becomes Legs 4 + Abs 2 at 6 exercises and Legs 4 + Abs 3 at 7 (verified). Decide whether Legs is exempt, capped at 5, or spills into calves as a separate part.
2. **Two fit ladders disagree.** §3.6 "Doesn't fit" trims main-lift back-offs to 2 and drops "from the end". §2.0.2 never touches the main lift and drops by band. Mark §3.6 as superseded.
3. **"Shorter" rests aren't defined, and neither is the top-set rest.** Only the shortest values (main 2:00 …) are given, and the 3:30 top-set rest has no target in either level.
4. **Step (b) "push effort" saves no time.** Accessory last sets are already RPE 9 by default (§3.1.4), so the step only does anything when Ben lowered them. Remove it, or say what it is meant to buy.
5. **The Mix it up examples break its own rules.** "Cable fly → Machine chest press" swaps an isolation for a compound, and "Cable fly → Cable crossover" may be the same angle.
6. **Example numbers don't match the formula.** §2.2 shows "Recommended for 60 min · 7", and Today shows "5 exercises · ~55 min". With the §3.6 formula, Chest at 60 min with Supersets on recommends 5, because the 6-exercise mix is 66 min at normal rests. Update the mocks, or say whether the recommendation may assume shorter rests.
7. **The §3.6 warm-up term may double-count.** "Each 30 s + 1 min rest, then +1 min after the last" gives the last warm-up 2 min. Confirm this is intended.
8. **§2.0.2 contradicts itself on growing.** Control 3 says "normal rests, +1 set …, then add an exercise", but the later Ben note says exercises before sets. The developer followed the later note; remove the stale order.
9. **Some sessions in `⋯` have no day mix.** §2.0.2 lists `Full body` and `Upper` there, but §3.7 has no mixes for them.
10. **The "Today, builder and time left agree" check (S2) assumes the Q15 shared constants already exist.** They are S1's job, and today's estimator is pace-based with 5-min rounding. The spec should say the pace model is replaced, or how the two reconcile.
