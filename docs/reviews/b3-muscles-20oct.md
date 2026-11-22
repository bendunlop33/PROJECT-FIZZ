VERDICT: CHANGES NEEDED

# Review: rear delts as Back, and the builder display layer (claude/b3-muscles-20oct)

Reviewer: independent reviewer agent, 20 Oct 2026.
Scope: `02a796a..4eaa674`. That is two commits (`ee13f6f`, `4eaa674`) touching 13 files. I checked them against
`docs/design/workout-builder-v3.md` §2.4, §2.5, §4.7 and the §9 answers Q8 and Q13, and against CLAUDE.md rules 2–6 and 10.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint` on every changed package (schemas, domain src and tests, catalogue and coach tests): clean.
- `npm run catalogue:validate`: 144 of 144 valid, 0 errors. The 1 warning (landmine press) was already there.
- Targeted vitest: `packages/schemas`, `packages/domain/test`, `apps/mobile/test`, and the catalogue `builder-groups` and
  `catalogue` tests plus coach `build-ask`. 313 files, 5572 passed, 1 todo.
- I dumped `builderGroupOf`, `builderFocusOf` and `worksLine` for all 144 catalogue entries in a throwaway test, now deleted, and
  checked each result by hand.

## What is right

- `MUSCLE_TO_GROUP.rear_delts` is `'Back'`. Every reader that goes through `muscleGroupOf` follows it: Progress credits and
  sub-rows, `workoutMuscleGroups`/`matchSplitDay`, `mainLiftOptions`/`recommendMainLift`, the coach build pool, `plan.ts`
  `topGroup`, the library filters (`muscleGroupsOf`/`passesFilters`) and the custom-exercise chips.
  `first-run.ts` `MUSCLE_WORD` and the `find-exercises` "rear delts" phrase are fixed too. I recomputed the face pull (P rear_delts,
  upper_back; S traps, side_delts): Back 1 and Shoulders 0.5, so 3 sets give Back 3 and Shoulders 1.5. That matches the test.
- **No stored data changes.** Groups are derived when read. Nothing in `packages/persistence` stores a muscle group. Split days,
  drafts and templates store `SplitBodyPart`, and none of those names changed. No migration is needed.
- Pain flags are keyed by exercise/family (`activeFlag`, `painFlagCovering`), not by muscle group, so rule 9 is not weakened.
  The FitNotes category hint (`import/category.ts`) works per muscle, not per group, so import ranking does not change.
- `BuilderGroup` is display only. `BUILDER_GROUP_PARTS` round-trips to `SplitBodyPart` (tested), and stored names are untouched.
  This meets §4.7 and Q8.
- Spec examples come out exactly as written: bench "Chest, front delts, triceps"; incline "Upper chest, front delts, triceps".
- Rules 2, 3, 5 and 6 are not touched: no writes, no proposals, no targets. Rule 10: the new module is coaching knowledge (a
  pure table) and reads no personal data.

## Blocking

**B1. The conditioning, cardio and carry entries get strength builder groups, and a test locks that in.**
`packages/schemas/src/builder-groups.ts:66-79` (`leadMuscle`/`builderGroupOf`), `packages/catalogue/test/builder-groups.test.ts:14-20`.
`builderGroupOf` ignores `movementPattern`/`measurement`. On the real catalogue:

| Entry | Group · focus |
|---|---|
| treadmill-run, exercise-bike, air-bike, stair-climber, cross-trainer, rowing-erg | Legs · Quads |
| burpee, box jump, wall ball | Legs · Quads |
| sled-push | Legs · Quads |
| ski-erg, sled-pull | Back · Lats |
| battle-ropes | Shoulders · Front delts |
| bear crawl | Abs |
| farmers-carry | Back · Mid-back |

All of these are `mechanic: 'compound'`.
- **Failure:** Ben opens Swap on Leg press. Under `QUADS` he sees Treadmill run, Exercise bike, Stair climber, Burpee and Box jump.
- **Worse:** the parallel rules stream (`claude/b3-rules-20oct`, `domain/src/builder/types.ts`) builds its injected
  `BuilderExerciseInfo.group`/`role` from this stream's mapping. A Legs pool could then pick Burpee or Sled push as the compound
  and give it rows like `Top set (kg)`, warm-ups and RPE.
- The catalogue test "every entry has a builder group" makes the wrong result the contract.

Fix:
1. Return `null` from `builderGroupOf` (and so from `builderFocusOf` and `builderFocusSections`) when
   `movementPattern === 'conditioning'`, or when `measurement` is `cardio`/`distance`/`duration`. Use whichever Ben prefers;
   add `measurement?` to `BuilderExerciseInfo` if needed.
2. Decide on carries (see Spec issues).
3. Change the catalogue test to "every *strength* entry has a group; conditioning entries have none". Add
   `treadmill-run → null` and `battle-ropes → null` to the table.

**B2. Spec §4.7 says to "update and test every caller". Two named callers still have no rear-delt test.**
§4.7 lists the catalogue validator, library filters, `mainLiftOptions`, split matching and Progress charts. Split matching
(`training-profile.test.ts`) and Progress (`progress.test.ts`) have tests. These two do not:
- **Library filters:** `packages/domain/src/exercise-search.ts:211-231` (`muscleGroupsOf`, `passesFilters`). Only `findExercises`
  (the coach's search tool) was tested, and that is a different function. Nothing proves that the Library `Back` chip now
  includes Face pull and the `Shoulders` chip excludes it.
- **`mainLiftOptions` / `recommendMainLift`:** `packages/domain/src/training-profile.ts:296-334`. These have no Q13 case.
  For example, a compound exercise led by rear_delts (a custom "high row") should be offered on a Back day and not on a
  Shoulders day.

The catalogue validator does not use groups (`validate.ts` only checks the vocabulary). The vocab test added in
`catalogue.test.ts:79` is enough for it.

Fix: add these 3 tests. Each should fail against the old mapping:
- `passesFilters(facePull, { muscles: ['Back'] })` is true and `{ muscles: ['Shoulders'] }` is false.
- `muscleGroupsOf` returns `['Back']`.
- A `mainLiftOptions` / `recommendMainLift` Back-vs-Shoulders case.

## Should fix

**S1. The coach context grouping in `apps/mobile/src/coach/coach-service.ts:1448` and `:1422` (`groupOf: muscleGroupOf` →
`plan.ts` `topGroup`) has no Q13 test.** The task scope names "coach context". The code follows the shared table, but no test
pins down that a pull plan made mostly of face pulls reports Back as its top group. Add one case to the `plan.ts`/`topGroup`
tests.

**S2. `BuilderExerciseInfo` is defined twice with incompatible shapes.**
- This branch: `@fizz/schemas` `builder-groups.ts:59`, shape `{ primaryMuscles, secondaryMuscles?, movementPattern? }`.
- `claude/b3-rules-20oct`: `@fizz/domain` `builder/types.ts`, shape
  `{ exerciseId, group, role, heavy, part, muscles, angle, barbell }`.

The two packages don't `export *` each other today, so the build won't break. But any service file that imports both will need
aliases, and readers will confuse them. Rename this one to `BuilderMuscleInfo`, or similar, before merge. Also tell the rules
stream that the canonical `BuilderGroup` now lives in `@fizz/schemas` (its `BuilderGroupName` MERGE NOTE).

**S3. `heavy?: boolean` on catalogue entries (§4.7) has no owner.** The rules stream's `types.ts` says "the muscles stream owns
… `heavy?`", but this branch doesn't add it, and the brief for this branch scoped it out. It isn't a code fault. The PM needs to
assign it so the merge doesn't leave `heavy` derived only from the barbell/plate-loaded fallback.

**S4. The `works` line uses jargon and the wrong words for the focus headings.**
`builder-groups.ts:158-182` (`WORKS_WORD`):
- Every curl reads "Biceps, brachialis, forearms" and the hammer curl reads "Brachialis, biceps, forearms". "Brachialis" is not
  a plain short word (§2.4 "short plain list").
- Under the `MID-BACK` heading, rows read "upper back" (the developer flagged this).
- Shrugs read "Traps, forearms, lower back". `forearms` shows as a helper while `grip` is quiet, which is inconsistent.

Fix:
- Map `brachialis → 'biceps'`, de-duplicated, or make it quiet as a helper.
- Make `forearms` quiet when it is a helper, like `grip`.
- Ask Ben whether "upper back" should read "mid-back" so it matches the heading. This is display only.

## Nits

- N1. `find-exercises.ts:41-44`: "rear deltoid(s)", "posterior delts" and "rear shoulders" are not caught. "rear shoulder"
  still names Shoulders, and "deltoid" names nothing, so the muscle filter is silently dropped. This was already like that
  before; only "rear delt(s)" is handled now.
- N2. `findExercises(…, { muscle: 'rear delts' })` returns every Back exercise (rows and pulldowns included), because the filter
  works at group level. That is consistent with "lats", but the coach asking for rear-delt work gets lat work first.
- N3. `builderFocusOf`'s `horizontal_pull` + lats rule needs `movementPattern`. Custom or imported `Exercise` rows without it
  land under `Lats`, not `Mid-back`. That is acceptable, but say so in the doc comment.
- N4. `worksLine(e, max)` with `max ≤ 0` still returns one word (`Math.max(1, max)`). Document it or clamp it explicitly.
- N5. Forearms-only exercises (a custom or imported wrist curl) have no builder group, so Swap can't open on them: the dropdown
  default is "the exercise's group". The screen stream needs a fallback (for example `Biceps`, or today's first group).
- N6. Progress history numbers shift when this merges: Shoulders drops and Back rises for every past face pull or rear-delt fly.
  That is correct under Q13 and not a rule 2 problem, because only derived views change. Ben may notice it, though, and a
  one-line `docs/brief/CHANGELOG.md` entry for Q13 would explain it (the developer skipped it).
- N7. `docs/research/exercise-bank-and-visuals.md:179` still says rear delts are Shoulders.

## Spec issues

- **SP1.** §2.4 and §2.5 mock-ups show works lines the catalogue data can't produce:
  - Machine chest press "Chest, triceps": the data gives "Chest, front delts, triceps".
  - Cable fly "Chest": the data gives "Chest, front delts".
  - Cable crunch "Upper abs": `upper abs` is not a vocabulary muscle.

  Either the mock-ups are illustrative or the line should only list primaries plus the top helper. Ben to confirm.
- **SP2.** §2.5's focus list ends in "…", so these are unspecified: a heading for back extensions (the developer added
  `Lower back`), traps/shrugs (put under `Mid-back`), adductors/abductors (put under `Hamstrings & glutes`) and obliques. Spell
  out the full `BUILDER_FOCI` table in §2.5 or §4.7.
- **SP3.** §4.7 and Q8 never say whether conditioning, cardio and carries belong to builder groups at all (see B1). Add one line,
  for example: "Builder groups are strength exercises only; conditioning and cardio are never in a group, Swap or the
  recommendation."
- **SP4.** The §4.7 text still reads "The shared `MUSCLE_TO_GROUP` is unchanged unless Ben says yes to Q13". Ben said yes in
  §9, so update §4.7 so it doesn't contradict the answer.
