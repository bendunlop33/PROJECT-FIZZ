# Review round 4: FitNotes import (build step 3)

**Verdict: PASS.** Round 3's S2 is fixed and holds up under every undo and re-import order I tried. Round 3's S1 is fixed for the path it described: exercises that match a catalogue entry recorded as one dumbbell import as written, and every exercise shows its conversion before commit. N1–N4 are fixed. The ADR renumbering is clean. There are no blockers.

Three new should-fixes came out of probing S1 with FitNotes' own default exercise names. All three are visible before commit and can be reversed with Undo import, so none of them is a blocker. They should land before Ben runs his real import, for the same reason round 3's S1 had to:
- **S1.** A one-dumbbell name that is matched by its words to a two-dumbbell exercise is still halved by "Both dumbbells together". Examples are FitNotes' defaults `One-Arm Standing Dumbbell Press` and `Dumbbell Concentration Curl`.
- **S2.** Ben's "One dumbbell" answer for an exercise isn't remembered. In the next, newer export, the same name matches silently and is halved again.
- **S3.** FitNotes' default `Flat Dumbbell Bench Press` is suggested as the barbell `Bench press`.

Reviewed: `bf58b38..cd86aa4` on `claude/fitnotes-import`. That is the 6 fix commits (`c7fd753..9067498`) and the merge of main (`cd86aa4`).

Specs read:
- CLAUDE.md.
- The brief's "Validation before claiming it is better" (scenario 6), the §10 additional scenarios and §12.
- `docs/design/data-import-export.md`: §2.5 steps 3a–3b, §3.4 and checks 16–27.
- ADR 0016.
- Rounds 1–3.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, tests, catalogue validate, guide check) | Clean. 87 test files and 1,171 tests pass. The catalogue has 133 valid entries, 0 errors and 1 warning (landmine press, which predates this branch). Guides: 10/10 |
| `npm run catalogue:index` after the merge | No change |
| Catalogue `implements` | 31 per-hand entries: 29 are set (10 one, 19 two), and single-leg RDL and kettlebell front-rack carry are unset. Nothing that isn't per-hand carries it |
| Temporary probes through the app services, the real bundled catalogue and real SQLite (`apps/mobile/test/zz-reviewer-r4-probe{,2,3,4,5}.test.ts`, deleted, not committed) | See below |
| `git grep 0015` | Every remaining `ADR 0015` reference is to the guide motion ADR (`packages/catalogue/src/figure/*`, the motion tests, ADR 0011). The FitNotes docs, the three earlier reviews, the research note and the code comments all say 0016, and their links resolve. Only old commit subjects still say "ADR 0015", which is acceptable |
| Diff grep for `console.*`, secrets, `eval` | None found |

**Probe results:**
- **S1, matched names** (one file under "Both dumbbells together"):
  - `Dumbbell Row` 30 → 30, `One Arm Dumbbell Row` 32 → 32, `Single Arm DB Row` 34 → 34, `Goblet Squat` 24 → 24, `Dumbbell Pullover` 28 → 28 and `Dumbbell Kickback` 8 → 8 (one dumbbell).
  - `Seated Dumbbell Press` 40 → 20 each.
  - `Kettlebell Goblet Squat` → kettlebell, `total` 20, not asked.
  - A file with only one-dumbbell exercises in lb needs no dumbbell answer and stays in lb.
  - A file with kg and lb per row (B1 layout): the curl reads 30 lb → 15 lb and 15 kg → 7.5 kg, the one-arm row 70 lb → 70 lb, and a negative goblet-squat value is unreadable.
- **Unmatched name:** `Zottman Curl` added as new dumbbells is asked on its own with nothing selected, and the group answer never touches it.
- **Undo and re-import (S2):** all of these behave correctly:
  1. The review's sequence: a, then b, undo a, re-open b. The preview has a's 3 dates and the notice. 20 Sep is skipped.
  2. Undo a, re-open a.csv instead, commit. b.csv then reads "Nothing new".
  3. Undo a, commit b again (b2), then undo b1. Re-opening b offers 20 Sep only.
  4. A third file c (adds 1 Oct) skips everything b2 brought. After b2 is undone, re-opening c offers 1, 3 and 5 Sep and names the earlier import of c.
  5. Two previews of b re-opened after the undo are committed one after the other. The second is refused as `stale`.
  6. The same history with CRLF line endings (a different checksum) reads `Nothing to import`, and the button is disabled.
  7. Every date was checked by counting sessions per date across the imports still in effect: never more than one.
- **Brief scenario 6 (duplicates):**
  - Two `Import` taps on one preview with different operation IDs join one job.
  - A second preview committed at the same moment gets `another_import`.
  - The same file again gives `same_file`.
  - The result is 1 job, 3 workouts and no duplicates.

## Round-3 findings: status

| # | Status | Evidence |
|---|---|---|
| S1 One-dumbbell exercises halved | **Fixed for catalogue matches; gaps remain (S1, S2 below)** | `perHandReading` (`plan.ts:349`); the question is built per exercise (`plan.ts:384`); the fate uses the reading (`plan.ts:572`). Catalogue `implements` comes through `buildCandidates` (`import-service.ts:203`) and is in the staleness stamp (`:278`). The screen shows each exercise's conversion (`views.ts:554`, `ImportQuestionScreen.tsx:64-109`). Tests: domain (`import-plan.test.ts`, 5 cases), view and end-to-end through the real catalogue (`fitnotes-import-views.test.ts`), and the catalogue schema and classification (`catalogue.test.ts`) |
| S2 "Nothing new" after an older import is undone | **Fixed** | `open()` analyses the file again with the earlier job's answers against today's context and returns `same_file` only when nothing would import or wait (`import-service.ts:442-450`). Otherwise the preview opens with `importedBefore` and a notice. Test at `fitnotes-import.test.ts:151`. My 7 variants above pass |
| N1 Bar weight above the maximum | Fixed | `barWeightEntry` bounds the value with the shared `BAR_WEIGHT_MAX` (`views.ts:652-661`). Tested |
| N2 Wording when the bar weight is cleared | Fixed | "…is added to plates-only values" |
| N3 Gym footnote | Fixed | Points to Data & backup → Past imports (`ImportQuestionScreen.tsx`) |
| N4 Today counts imports | Fixed | `candidates(1, { countImported: false })` (`workout-services.ts:550`). Tested |
| N5 Undo alert and later imports | Open, acknowledged in ADR 0016 | Unchanged |

## Blocking

None.

## Should fix (before Ben's real import)

### S1. A one-dumbbell name matched by its words to a two-dumbbell exercise is still halved

- **Where:**
  - `packages/domain/src/import/plan.ts:306`: a resolved exercise takes `implements` from whichever candidate it maps to. That includes a `Check` suggestion Ben accepted with `Use this`, which is matched only by its words.
  - `plan.ts:352`: `count === 2` then takes the group answer.
- **Failure path (probe, real catalogue):**
  1. The file has FitNotes' own default names `One-Arm Standing Dumbbell Press 22 × 8` and `Dumbbell Concentration Curl 14 × 10`, plus `Seated Dumbbell Press 40 × 8`.
  2. The matcher suggests `Standing dumbbell shoulder press` and `Dumbbell curl`. Both are recorded as two dumbbells. Ben taps `Use this` on each, which is reasonable because it is the right movement.
  3. Ben answers "Both dumbbells together" for his presses. The press imports as **11 kg each** and the curl as **7 kg each**. Both were done with one dumbbell.
  4. The conversion lines show it (`22 kg → 11 kg each`). But the note directly above the list says `n exercises use one dumbbell, so their weights are imported as written.`, and these two aren't counted in it.
- **Why it matters:** this is the same load-convention error round 3 flagged, now reached through FitNotes' default list. Both names are likely to be in Ben's file.
- **Fix:**
  - When the source name contains a one-implement word (`one arm`, `one-arm`, `1 arm`, `single arm`, `single-arm`, `concentration`) and the target records 2, treat the count as unknown (`null`), so the exercise is asked on its own with nothing selected.
  - Separately, give the catalogue owner entries or aliases for FitNotes' one-dumbbell defaults: a concentration curl and a one-arm dumbbell press, both with `implements: 1`.
- **Test:** the probe above, with the real catalogue and under "both".

### S2. Ben's answer for one exercise isn't remembered, so the next export halves it again without asking

- **Where:**
  - `aliasesToSave` (`plan.ts:792`) remembers the name mapping only.
  - `perHandOverrides` live in the job's answers.
  - A new preview starts from `DEFAULT_ANSWERS` (`import-service.ts:470`).
- **Failure path (probe):**
  1. The first file maps `One-Arm Standing Dumbbell Press` to `Standing dumbbell shoulder press` and sets that exercise to "One dumbbell". 22 kg is stored. The group answer is "both".
  2. A month later, a newer export arrives. The name is now `Matched` through the saved alias, so it is folded into the collapsed "matched" line and is no longer in the names to check.
  3. Ben answers "both" again for the group. 8 Sep imports as **12 kg each**, next to 1 Sep's 22 kg.
  4. `Zottman Curl` (custom, count unknown) is asked again with nothing selected, so it can be answered differently from last time.
- **Why it matters:** Ben's explicit answer is dropped, and the same exercise's history ends up in two conventions across imports. Importing newer exports is the main way this feature is used again and again (check 21).
- **Fix:** save the per-exercise reading with the alias (for example `ExerciseAlias.perHand?: PerHandReading`, source `fitnotes`). Use it as that name's override in later previews, shown as `(your answer last time)` the way names are. That is Ben's own data, not a pre-selected default, so DX6 still holds. At minimum, show a warning line when this preview reads an exercise differently from the import still in effect for it.
- **Test:** the two-file probe above.

### S3. FitNotes' default `Flat Dumbbell Bench Press` is suggested as the barbell `Bench press` (and dumbbell skull crushers as the EZ-bar one)

- **Where:** `packages/domain/src/import/match.ts:140`. The score ties at 0.857:
  - `Flat bench press`, an alias of `barbell-bench-press`;
  - `Dumbbell bench press`.

  Ties go to the first candidate by name, so the barbell entry wins. The matcher never compares the source name's equipment word with the candidate's equipment. Other probe results:
  - `Dumbbell Skullcrusher` and `Lying Dumbbell Triceps Extension` → `Skull crusher` (EZ bar, `total`);
  - `Dumbbell Squat` → `Goblet squat` (one dumbbell, so a pair written as "both" would import doubled);
  - `Front Dumbbell Raise` → `Lateral raise`.
- **Failure path:**
  1. Ben taps `Use this` on `Flat Dumbbell Bench Press` → `Bench press`.
  2. 60 kg dumbbell presses become barbell `total` sets.
  3. With "Plates only", 20 kg is added, giving 80 kg.

  It's a `Check`, so Ben has to tap it, and it then shows in the barbell list. This has been in the matcher since round 1 but wasn't caught.
- **Why it matters:** `Flat Dumbbell Bench Press` is FitNotes' default name for the most common dumbbell exercise, and a wrong `Use this` writes the wrong convention to history (rule 4 and "load convention always explicit").
- **Fix:**
  - In `matchName`, drop or penalise candidates whose `compatibleEquipment` contradicts an equipment word in the source name (dumbbell/db, barbell/bb, cable, machine, kettlebell/kb, ez, smith, trap).
  - Break ties on the equipment match before the name.
  - Add `Flat dumbbell bench press` as an alias of `dumbbell-bench-press`.
- **Test:** the FitNotes default dumbbell names against the real catalogue. Each suggestion's equipment should match the name.

## Nits

- **N1. Lines after the dumbbell screen say "each" for a one-dumbbell exercise.**
  - The dumbbell screen says `70 lb → 70 lb (one dumbbell)`. The preview rows and the imported workout then say `One-arm dumbbell row · 70 lb each × 10`, because `display.ts:55` always formats `per_hand` as `each`.
  - For a goblet squat, `24 kg each` reads as two dumbbells.
  - Pass the exercise's implement count to `loadText`, or see SP1.
- **N2. A re-opened file's preview starts from default answers (`import-service.ts:470`).** ADR 0016 says so on purpose. But the dates it brings back sit next to dates the same file brought in with its earlier answers. Seeding the draft with `earlier.job.answers` keeps them consistent, and they are Ben's own answers, not invented ones.
- **N3. Catalogue classification, for the catalogue owner (already flagged in ADR 0016):**
  - `dumbbell-triceps-kickback: 1` is often done with both arms together.
  - The `Dumbbell row` and `DB row` aliases on `dumbbell-one-arm-row` treat an ambiguous name as one dumbbell. Some people use that name for a two-dumbbell bent-over row.
  - `dumbbell-step-up` and `dumbbell-reverse-lunge: 2` are also commonly done with one dumbbell in a goblet hold.
  - Consider leaving these unset so that Ben is asked.
- **N4.** For an exercise recorded as one dumbbell, `Each` and `One dumbbell` give the same result (`perHandValue`). The real choice is "as written" or "halve". Two choices would be clearer.
- **N5 (round 3).** The undo alert doesn't mention later imports that skipped these dates. Still open.

## Tests

**Good:**
- The catalogued S1 path is covered at domain level, view level and end to end through the real catalogue with stored loads.
- The round-3 S2 sequence is tested, including no duplicates after the commit.
- The bar-weight maximum and Today's count are tested.
- The catalogue schema refuses `implements` on anything that isn't per-hand.

**Missing:**
- Names matched by their words to an exercise with a different implement count (S1).
- A second, newer export after a per-exercise dumbbell answer (S2).
- FitNotes' default dumbbell names against the real catalogue's suggestions (S3).

## Conditions before calling this done (unchanged, not code defects)

- Check 16: re-run detection against Ben's real export and add its first line as a fixture. Before he imports it, also run his exercise names through the matcher, and check every `Check` suggestion and dumbbell conversion (S1–S3).
- Check 27: on the iPhone, the preview should be ready within 5 s for 10,000 rows. Also time each answer and the results screen.
- The device checks in ADR 0016: migration 3 under expo-sqlite, the CSV picker sources, Stop / force-close / Continue, and Undo.
- Ben's answers in ADR 0016 "Open for Ben", especially how he logged one-arm, concentration-curl and goblet exercises.

## Spec issues

- **SP1. How a per-hand load is shown for a one-dumbbell exercise** (designer). `per_hand` is always shown as `n each` across the app. With `implements` in the catalogue, the active set, Summary, preview rows and imported workouts could say `24 kg` or `24 kg dumbbell` for a goblet squat. That would match the import's `(one dumbbell)`.
- **SP2. Should convention answers be remembered like names?** (designer / PM). §2.5 step 3a remembers names ("the next import of a newer file matches it automatically"). Step 3b is silent, and DX6 forbids pre-selected answers. The spec should say that Ben's own earlier per-exercise answer isn't a pre-selection and is carried forward and labelled (S2).
- **SP3. What a `Check` suggestion may propose** (designer). §2.5 says "a suggestion based on the name only". The spec should say that a suggestion never contradicts an equipment word in the name (S3).
- **ADR 0016 differences 20–21** (the dumbbell screen copy, and the same file after an undo) need designer and PM acceptance, together with the earlier 10–19. The ADR is still "Proposed".
- **Still open from earlier rounds:**
  - P-I3, imported history and targets (r3 SP1);
  - the domain of aliases (r3 SP4);
  - Smith machine and other bars (r2 SP3);
  - timed and distance sets (r1 SP2);
  - RPE and warm-ups (r1 SP8).
