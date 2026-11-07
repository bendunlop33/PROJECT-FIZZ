# Review round 5: FitNotes import (build step 3)

**Verdict: PASS.** Round 4's S1–S3 are fixed for the cases they described, and N2–N4 are fixed. I checked this against FitNotes' published default exercise list rather than names recalled from memory. Across 151 names, in kg and in lb, under both "each" and "both":
- no suggestion contradicts an equipment word in the name;
- every stored load equals the conversion shown before commit;
- no kg↔lb conversion happens;
- Ben's per-exercise answers carry over correctly to a second and a third, newer export.

There are no blockers. Everything below is visible before commit. Three should-fixes ought to land before Ben runs his real import, for the same reason round 4's did:
- **S1.** A `Check` suggestion matched only by its words still takes the catalogue's "two dumbbells". After `Use this`, FitNotes' default `Dumbbell Preacher Curl` (often done one arm at a time) is halved by "Both dumbbells together". `Front Dumbbell Raise` → `Lateral raise` is halved the same way.
- **S2.** Undo import doesn't undo the answers that import taught. A dumbbell answer from an undone import comes back as "Your answer last time". A `Use this` mapping from it comes back as a silent `Matched`. Undo was the stated remedy for every earlier should-fix.
- **S3.** The word `Machine` allows assisted machines, so `Triceps Dip Machine` / `Dip Machine` are suggested as `Assisted dip`, which inverts the meaning of the load. `Smith` allows weight stacks, so FitNotes' `Smith Machine Overhead Press` is suggested as the stack `Machine shoulder press`.

Reviewed: `aedd7a5..901c259` on `claude/fitnotes-import`. That is 5 commits:
- `e1a6afa`: theme test;
- `0e4b3a4`: catalogue;
- `7de699c`: matcher;
- `cb5db2d`: remembered answers and nits;
- `901c259`: ADR.

Specs read:
- CLAUDE.md.
- The brief's "Validation before claiming it is better" (scenario 6), the §10 additional scenarios and §12.
- `docs/design/data-import-export.md`: §2.5 steps 3a–3b and checks 16–27.
- ADR 0016 (differences 20–24).
- Rounds 1–4.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0. Typecheck and lint clean. 87 test files and 1,185 tests pass. The catalogue has 135 valid entries (10 rich, 125 basic), 0 errors and 1 warning (landmine press, which predates this branch). Guides: 10/10 |
| `npm run catalogue:index` | No change |
| `e1a6afa` (theme test) | Justified. `design-system.md:24` and `:156` call `color.guide.definition` "specified, not built", and no token for it exists in `apps/mobile/src/theme`. The change is test-only |
| FitNotes default list | Source: `ikkani/Fitnotes2Hevy` `files/fitnotes_exercises.txt`. Its README says it lists "all the default exercises" of FitNotes; its Spanish entries are that user's own, so I used the English ones. I added the names from the real 2020 export the research cites (moferg) and 57 common variants, for **151 names** in total. Of these, 18 are FitNotes dumbbell defaults |
| Probe 1: `apps/mobile/test/zz-reviewer-r5-probe.test.ts` (deleted, not committed) | Uses the bundled catalogue and real SQLite. One B2 file in `kgs` and one in `lbs`, each answered "each" and then "both", giving 4 commits. Every `Check` is accepted with `Use this` (the worst case). A `No match` with a dumbbell word is answered `Add new` (dumbbells); any other `No match` is skipped. Unknown counts are answered `One dumbbell` |
| Probe 2: `…/zz-reviewer-r5-probe2.test.ts` (deleted, not committed) | Two and three newer exports in kg and in lb; a stale preview; undo with remembered answers; undo with name answers; machine and Smith names; the real 2020 sample (A1-lb, 436 rows) |
| Diff grep for `console.*`, secrets, `eval` | None found |

**Probe results:**
- **Equipment.** 0 of 151 suggestions or matches contradict an equipment word in the name. I also scanned every catalogue name and alias against its own equipment: the only contradictions are `Rowing machine` and `Ski machine`, which are ergs and aren't candidates.
- **Stored loads.** Each run stored 131 sets: 69 `per_hand`, 24 `total`, 27 `stack` and 11 `added`.
  - Every stored value equals what the dumbbell screen showed for it.
  - A kg file stores kg and an lb file stores lb (check 19).
  - Under "each", nothing is halved.
  - Under "both", 36 exercises are halved, all of them two-dumbbell readings. The 11 exercises read as one dumbbell import as written.
- **The one-dumbbell defaults** import as written under "both":
  - `One-Arm Standing Dumbbell Press` (matched to the new entry), `Dumbbell Concentration Curl` and `Dumbbell Overhead Triceps Extension`;
  - also `Goblet Squat`, `Dumbbell Pullover`, `Single Arm DB Row` and `One Arm Dumbbell Row`.
  - These are asked, with nothing selected: `Dumbbell Row`, `Dumbbell Squat`, `Dumbbell Kickback`, `Dumbbell Step Up`, `Two-Arm Dumbbell Row`, `Lying Dumbbell Triceps Extension` and `Seated Dumbbell Overhead Triceps Extension`.
- **Halved under "both" although the exercise can be one dumbbell (S1).** All of these are reached through a `Check` accepted with `Use this`:
  - FitNotes defaults: `Dumbbell Preacher Curl` → `Dumbbell curl` (76 → 38), and `Front Dumbbell Raise` → `Lateral raise` (90 → 45).
  - Variants: `Dumbbell Side Bend` → `Lateral raise`, `Dumbbell Calf Raise` → `Lateral raise`, and `Dumbbell Wrist Curl` → `Dumbbell curl`.
- **The real 2020 sample** (A1-lb):
  - It is detected as `weights in lb`.
  - Its 8 `Check`s all have the right equipment and movement.
  - All 436 rows import.
  - `Dumbbell Overhead Triceps Extension` 20 lb imports as 20 lb (one dumbbell).
- **Remembered answers** (kg and lb; a then b then c, each newer and cumulative):
  - Per-exercise answers in a are `one` (`Dumbbell Row`, `Dumbbell Preacher Curl`, `Zottman Curl`), `each` (`Front Dumbbell Raise`) and `both` (`Dumbbell Kickback`, `Goblet Squat`).
  - In b, all of them are filled in and labelled `Your answer last time`. The group options are both unselected, and the only question is `Dumbbell weights: each or both?`.
  - In b, `dumbbell row` (different case) and `Zottman  Curl` (extra space) still match their answers. The 1 Sep rows are skipped.
  - In b, Ben clears the preacher curl's answer. In c, the preacher curl is `not answered yet` and the other answers are still remembered.
  - A preview opened before another import changed a remembered answer is refused as `stale` at commit.
- **Undo (S2):** see S2 below.

## Round-4 findings: status

| # | Status | Evidence |
|---|---|---|
| S1 One-arm names matched by words were halved | **Fixed for names that say one or two; gap: words-only pairs (S1 below)** | `implementCue` / `implementsFor` (`match.ts:226-262`), used at `plan.ts:320` for every mapping path. New entries `dumbbell-concentration-curl` and `dumbbell-one-arm-shoulder-press` (1). `Choose…` to the pair press is asked (test `fitnotes-import-views.test.ts` and my probe) |
| S2 Per-exercise answer not remembered | **Fixed; gap: survives Undo (S2 below)** | `perHand` is stored on the alias (`schemas/import.ts`, `persistence/imports.ts:287`). It is loaded at `import-service.ts:270-273`, filled in by `startingAnswers` (`plan.ts:864`) and labelled in `views.ts` `perHandRow`. Keep and clear: `aliasesToSave` (`plan.ts:838`). It is in the staleness stamp |
| S3 Dumbbell bench suggested as the barbell one | **Fixed; gap: `machine` / `smith` words (S3 below)** | `equipmentInName` / `equipmentFit` / `breakTie` (`match.ts:133-185, 208`). `Flat dumbbell bench press` is an alias. `Barbell Shrug`, `Machine Shrug`, `Barbell Calf Raise` and `Dumbbell Skullcrusher` give `No match` |
| N1 "each" on one-dumbbell sets | Open (ADR 0016, r4 SP1) | Unchanged |
| N2 Re-opened file starts from defaults | Fixed | `startingAnswers` with `earlier.job.answers`. The notice says so |
| N3 Kickback, step-up and reverse lunge | Fixed | `implements` is unset, so they are asked (probe) |
| N4 Two choices for one dumbbell | Fixed | `One dumbbell / Both together`. A remembered answer outside these choices is appended, selected |
| N5 (r3) Undo alert and later imports | Open, acknowledged | Unchanged |

## Blocking

None.

## Should fix (before Ben's real import)

### S1. A words-only `Check` inherits "two dumbbells", so FitNotes' `Dumbbell Preacher Curl` is halved by "Both dumbbells together"

- **Where:**
  - `packages/domain/src/import/match.ts:256`: `if (c.implements === 2) return 2;` applies to any mapping, including a suggestion matched only by its words and accepted with `Use this` or `Choose…`.
  - A one-dumbbell count is inherited only when the source name is the catalogue's own name (`:257-260`). The pair count, which is the one "both" halves, has no such condition.
  - `packages/domain/test/import-match.test.ts:140` asserts this behaviour.
- **Failure path (probe, real catalogue, kg and lb):**
  1. The file has FitNotes' default `Dumbbell Preacher Curl 20 × 10`. The catalogue has no preacher curl, so the matcher suggests `Check: Dumbbell curl`, which is recorded as two dumbbells.
  2. Ben taps `Use this`. That is reasonable, because it is the closest curl.
  3. He answers "Both dumbbells together" for his presses. The preacher curl imports as **10 kg each**. Dumbbell preacher curls are commonly done one arm at a time, so that set was one 20 kg dumbbell.
  4. The same happens to `Front Dumbbell Raise` → `Lateral raise`, which is also the wrong movement; a front raise is often one dumbbell held in both hands.
  5. Among common variants, `Dumbbell Side Bend` (always one dumbbell) and `Dumbbell Calf Raise` → `Lateral raise`, and `Dumbbell Wrist Curl` → `Dumbbell curl`, are halved after `Use this`.
  6. The conversion row shows it (`20 kg → 10 kg each`, with `Same` selected). But `n exercises use one dumbbell…` doesn't count it.
- **Why it matters:** this is round 4's S1 load-convention error, reached through a name with no one-arm word. `Dumbbell Preacher Curl` is on FitNotes' verified default list.
- **Fix (either):**
  - **Symmetric rule.** Inherit a count, 1 or 2, only when the source name is the catalogue's own name or alias, or the name's cue word agrees. A words-only mapping with no cue is asked under `One dumbbell or two?`. On FitNotes' list this asks 7 of the 18 dumbbell defaults: `Lateral Dumbbell Raise`, `Seated Dumbbell Lateral Raise`, `Rear Delt Dumbbell Raise`, `Seated Incline Dumbbell Curl`, `Incline Dumbbell Fly`, `Dumbbell Preacher Curl` and `Front Dumbbell Raise`. The catalogue owner can then add the unambiguous ones as aliases, so they match exactly and stay pairs.
  - **Narrower option.** Give the catalogue a dumbbell preacher curl entry and a dumbbell front raise entry, both with `implements` unset, and the pair aliases above.
- **Test:** FitNotes' 18 dumbbell defaults against the real catalogue under "both". No exercise that can be done with one dumbbell should be halved without Ben's own answer.

### S2. Undo import doesn't undo the answers that import taught

- **Where:**
  - Aliases are written at commit (`packages/persistence/src/imports.ts:212`, `upsertAlias` `:287`).
  - `revertJob` (`:259`) doesn't touch them.
  - `loadContext` reads every alias (`apps/mobile/src/import/import-service.ts:270-273`).
  - `startingAnswers` fills the dumbbell answers in (`packages/domain/src/import/plan.ts:864`).
- **Failure path 1, dumbbell answers (probe, real SQLite):**
  1. `a.csv`: `Zottman Curl` is answered `Add new` (dumbbells) and "One dumbbell", then committed.
  2. `b.csv`, a newer export: Ben changes Zottman to "Both together" and commits. He sees 16 kg → 8 kg each in history and taps Undo import.
  3. He opens `b.csv` again, or a newer `c.csv`. Zottman is pre-selected **"Both together · Your answer last time"** (`18 kg → 9 kg each`), while the history still in effect (a) reads it as one dumbbell.
  4. With the override set, the row isn't an open question, so Ben can pass it without touching it.
- **Failure path 2, names (probe):**
  1. `a.csv`: `Use this` on `Front Dumbbell Raise` → `Lateral raise` and on `Dumbbell Preacher Curl` → `Dumbbell curl`, then committed.
  2. Ben taps Undo import and re-opens `a.csv`.
  3. Both names are now `Matched (your answer last time)`, folded into "2 matched by name". The preview's only question is `Dumbbell weights: each or both?`.
- **Why it matters:** Undo is the documented remedy for a wrong answer (toast: "You can import the file again"; check 25), and rounds 3 and 4 relied on it to rate each finding should-fix rather than blocking. The dumbbell part is new this round. The name part has been there since round 1, but no earlier round exercised it.
- **Fix:**
  - When building the context, ignore the `perHand` and `target` of an alias whose `jobId` is a reverted job. The name and the count are then asked again with nothing selected (DX6), never guessed.
  - Alternatively, `revertJob` can put each alias it taught back to its previous version. Aliases are versioned documents.
- **Test:** the two paths above.

### S3. `Machine` allows assisted machines and `Smith` allows weight stacks, so suggestions can invert or misread the load

- **Where:** `packages/domain/src/import/match.ts:140` (`smith` → plate-loaded or stack) and `:142` (`machine` → stack, plate-loaded or **assisted**).
- **Failure paths (probe, real catalogue):**
  - `Triceps Dip Machine`, `Dip Machine` and `Machine Dip` → `Check: Assisted dip` (`assistance`). A seated dip machine in a commercial gym is a weight stack, where more weight is harder. After `Use this`, 80 kg of stack is stored as **80 kg of assistance**, the opposite meaning.
  - FitNotes' default `Smith Machine Overhead Press` → `Machine shoulder press` (`stack`), and `Smith Machine Row` → `Chest-supported machine row` (`stack`): plates on a Smith bar are recorded as a stack setting.
  - The machines line in the preview names the convention, so this is visible, but it needs Ben to read it.
- **Fix:**
  - `machine` alone shouldn't allow `assisted_stack`. Only `assist`/`assisted`/`gravitron`/`counterweight` should, or never suggest an `assistance` exercise unless the name says assist.
  - `smith` should allow `plate_loaded_machine` only, and prefer a candidate whose own name says Smith. If no candidate does, suggest nothing.
  - The catalogue side is still r2 SP3.
- **Test:** the names above against the real catalogue.

## Nits

- **N1. Suggestions that contradict an implement word.**
  - `Two-Arm Dumbbell Row` → `One-arm dumbbell row` and `Double Kettlebell Press` → `Kettlebell press`. The count is asked, so the load is safe.
  - The one-arm words also outweigh the movement: `Dumbbell Bench Press (Single Arm)` → `One-arm dumbbell shoulder press`, and `Single Arm Dumbbell Preacher Curl` → `One-arm dumbbell row`. Both are read as one dumbbell, so as written, but the movement is wrong.
  - Fix: skip candidates whose `implementCue` contradicts the name's, as is done for equipment, or leave cue words out of `similarity`.
- **N2. Wrong-movement suggestions on FitNotes' defaults (for the catalogue owner):**
  - `Straight-Arm Cable Pushdown` → `Triceps pushdown`, when it should be `Straight-arm pulldown`, a lat exercise. Add it as an alias.
  - `Seated Machine Curl` → `Seated leg curl` (already in ADR 0016).
  - `Crunch` → `Cable crunch` (a bodyweight exercise read as `stack`).
  - `Donkey Calf Raise` → `Standing calf raise` (machine).
  - Variant: `Machine Triceps Extension` → `Leg extension`.
- **N3. Kettlebells on the dumbbell screen.** `Kettlebell Press 282 kg → 282 kg (one dumbbell)` appears under "Dumbbell weights" (`apps/mobile/src/import/views.ts:561, :600`). Say "(one kettlebell)", or just "(one)".
- **N4. The group question counts and samples pairs that have their own answer.**
  - `pairs` (`plan.ts:445`) and `example` (`plan.ts:436`) include two-dumbbell exercises that have an override.
  - With remembered answers, that now happens on every newer export. "For these 4 exercises with two dumbbells, “22” means:" can use as its example an exercise the group answer doesn't apply to, such as the preacher curl remembered as one dumbbell.
  - Count and sample only exercises with `override === null`.
- **N5. ADR 0016 is out of date in one place.** Difference 20 still lists `One dumbbell / Each / Both together` for one-dumbbell exercises. Difference 24 supersedes it, so cross-reference it.

## Tests

**Good:**
- Equipment words, tie-breaking and the name-based count are tested at domain level.
- The new matcher tests fail when the equipment and name rules are switched off (the developer's report). My probes agree with what they assert.
- End to end on SQLite with the real catalogue:
  - FitNotes names, with no suggestion contradicting the name's equipment;
  - the one-dumbbell defaults stored as written;
  - two exports with remembered answers, the group not pre-selected, and the answers recorded on the job.
- Persistence covers storing, keeping and clearing `perHand`.

**Missing:**
- A words-only mapping to a two-dumbbell exercise (S1). The existing assertion at `import-match.test.ts:140` would change.
- Undo, then a re-opened or newer file: neither names nor dumbbell answers from the undone import should come back (S2).
- `machine` / `smith` names against assisted and stack candidates (S3).
- The test list of FitNotes default names is now verifiable. Replace the recalled names in `fitnotes-import-views.test.ts:273-303` with the 18 dumbbell defaults from the published list. `Dumbbell Skullcrusher`, `Lying Dumbbell Triceps Extension`, `Dumbbell Squat` and `Dumbbell Shrug` aren't on it.

## Conditions before calling this done (unchanged, not code defects)

- Check 16: run detection against Ben's real export and add its first line as a fixture. Before he imports it, run his own exercise names through the matcher and check every `Check` suggestion and dumbbell conversion (S1, S3).
- Check 27: on the iPhone, the preview should be ready within 5 s for 10,000 rows.
- The device checks in ADR 0016: migration 3 under expo-sqlite, the CSV picker sources, Stop / force-close / Continue, and Undo.
- Ben's answers in ADR 0016 "Open for Ben", especially how he logged one-arm, preacher and goblet exercises.

## Spec issues

- **SP1. What Undo import does to the answers it taught** (designer / PM). Check 25 says "the file can be imported again" but not whether the undone import's name and dumbbell answers apply. Recommended: they don't; they are asked again with nothing selected (S2).
- **SP2. The group dumbbell answer across imports** (designer / PM). By design it isn't remembered (DX6), so a two-dumbbell exercise can change convention between imports. In the probe, `Seated Dumbbell Press` was 40 → 20 each in a, then 42 → 42 each in b. Option: show the import in effect's group answer as a hint ("Last import: both dumbbells together") without selecting it.
- **SP3. Check 17 says "no convention option is pre-selected"**, but remembered answers (difference 22) and a re-opened file's answers (difference 21) pre-select Ben's own earlier answers. These need designer and PM sign-off, together with differences 22–24. ADR 0016 is still "Proposed".
- **Still open from earlier rounds:**
  - r4 SP1: a one-dumbbell exercise is shown as "each";
  - r3 SP1: P-I3;
  - r3 SP4: the domain of aliases (they now also hold Ben's dumbbell answers, which are clearly Your data);
  - r2 SP3: the Smith machine and other bars;
  - r1 SP2: timed and distance sets;
  - r1 SP8: RPE and warm-ups.
