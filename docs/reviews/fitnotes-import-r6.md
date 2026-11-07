# Review round 6: FitNotes import (build step 3), adversarial check of the PM decision

**Verdict: CHANGES NEEDED.**

The PM rule: a stored value may differ from the file only with a source for the difference. The sources are:
- **(a)** the FitNotes name is the exercise's own name or a catalogue alias;
- **(b)** Ben's own answer, given in this import or remembered from an import still in effect;
- **(c)** an explicit word in the name.

The rule holds for the dumbbell count and the unit across FitNotes' full default list and 284 tricky variants, in kg and lb, under every group answer. Undo import correctly takes back remembered names and dumbbell answers. Duplicate import (scenario 6) still holds. The rule fails on three paths, each reachable from the app's own screens:
- **B1.** Undo import doesn't take back the equipment an `Add new` answer gave the custom exercise. A later import then reads sets as assistance instead of a stack load, with no question asked.
- **B2.** A name that says Smith and Barbell is suggested as a free-barbell exercise. "Plates only" then adds the 20 kg / 45 lb Olympic bar to a Smith set. ADR 0016 says this can't happen.
- **B3.** A name that says Assisted and Machine can be suggested as a weight-stack exercise. Its values are then stored as a load, although the name says assisted.

Reviewed: `ea65dd5..7ad7f40` on `claude/fitnotes-import`, 4 commits:
- `93c2ad1`
- `c70bcdc`
- `e17c62a`
- `7ad7f40`

Specs read:
- CLAUDE.md;
- the brief's "Validation before claiming it is better" (scenario 6), §10 and §12;
- `docs/design/data-import-export.md` checks 16–27;
- ADR 0016 (differences 20–28);
- review rounds 1–5.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0: typecheck and lint clean, 89 test files and 1,212 tests pass, guides 10/10. Catalogue: 135 valid entries, 0 errors, 1 warning (the landmine press, older than this branch) |
| Probe 1 (`apps/mobile/test/zz-r6-reviewer-probe.test.ts`, deleted) | Real catalogue and real SQLite, end to end through `AppServices`. One B2 file with **381 names**: FitNotes' 97 default names from the fixture, plus 284 variants (see below the table). Each name has its own weight. **8 runs:** kg and lb × `each`/`both` × `total`/`plates_only`. Each run takes the worst case: all 145 `Check`s accepted with `Use this`. A `No match` is answered `Add new` when the name has an assist, dumbbell or barbell word, and skipped otherwise. Anything still asked is answered "One dumbbell" or "Total" |
| My own source check | Every stored set is compared with the file using my own reading of (a), (b) and (c), not the importer's. (a) is name equality with the exercise's name and aliases, excluding import-made exercises. (c) is regexes for pair, bar, assist and Smith words. I also checked: the unit, that the shown conversion equals the stored value, assist-named sets stored as a load, Smith names mapped to non-Smith exercises, and that nothing is pre-selected |
| Probes 2–4 (deleted) | Undo against `Add new` equipment, using only the actions the screens offer; a stale rebuild after an undo; duplicate import; mixed-sign assisted values; Smith plus Barbell names; assisted plus machine names; `Choose…`; kg and lb in one file |
| Diff grep for `console.*`, secrets, `eval` | None found |

The 284 variants in probe 1 cover:
- Smith names;
- assisted, Gravitron and counterweight names;
- one-arm, two-arm, alternating and single-leg names;
- `DB`, `BB`, `EZ`, trap and hex bar names;
- Hevy-style names such as `Bench Press (Barbell)`;
- generic names such as `Shrugs`, `Chest Fly` and `Curl`;
- machine, cable, kettlebell and bodyweight names.

**Probe 1 results (each of the 8 runs):**
- 305 sets stored: 107 `per_hand`, 83 `total`, 56 `stack`, 38 `added` and 21 `assistance`.
- **Units:** kg files stored kg and lb files stored lb, with no conversion (check 19).
- **Shown before commit:** every value on the dumbbell and barbell screens equals the stored value.
- **Nothing pre-selected:** neither group option, nor any row under `One dumbbell or two?` or `Total or plates only?` (check 17).
- **Halved under `both`:** 41 names, each with (a) or (c).
- **Bar added under `plates_only`:**
  - 66 names have (a) or (c), or my `Add new` barbell answer.
  - **6 have no source** (B2).
- **Assistance:** all 21 have an assist word or an exact name, or are my `Add new`. No assist-named set from the catalogue run was stored as a load. Probe 3's extra names found B3.

**Probes 2–4 results:**
- **Scenario 6 holds:**
  - Two concurrent `Import` taps return the same job ID.
  - Re-opening the same file gives `same_file`, with one job.
  - A newer export marks the earlier dates `skipped_duplicate`, and its barbell answer isn't pre-selected.
- **Undo of names and dumbbell answers works.** After Undo import, the next preview shows the name as `Check` again, with nothing selected. The same file opened again starts from `DEFAULT_ANSWERS`.
- **`Choose…`:** choosing a pair exercise for an unknown name asks for the count.
- **kg and lb in one file:** stored per row, halved in its own unit.
- **Gaps:** B1, B3, S1 and S3 below.

## Round-5 findings: status

| # | Status | Evidence |
|---|---|---|
| S1 Words-only pair halved | **Fixed** | `implementsFor` (`match.ts:406-411`). `Dumbbell Preacher Curl` and `Front Dumbbell Raise` are asked |
| S2 Undo keeps taught answers | **Fixed for names and dumbbell answers. Open for `Add new` equipment (B1)** | `remembered.ts`; `loadContext` ignores undone jobs (`import-service.ts:276-277`) |
| S3 Machine and Smith words | **Fixed one way only.** `Machine` is never an assisted machine, and a Smith exercise is never suggested without Smith. **Not fixed the other way:** see B2 (Smith plus Barbell) and B3 (Assisted plus Machine) | `match.ts:340-344` |
| N1 Count words | Fixed | `COUNT_ONLY_WORDS`, `countContradicts`, `sameCount`. `Lat Pulldown (Pulley)` maps to the lat pulldown |
| N2 Wrong-movement suggestions | Open (catalogue owner) | See N1 below |
| N3 Kettlebell wording | Fixed | |
| N4 Group count and example | Fixed | `plan.ts:518, 527` |
| N5 ADR difference 20 | Fixed | |

## Blocking

### B1. Undo import doesn't take back `Add new` equipment, so a later import reads sets as assistance from an undone answer

**Where:**
- `packages/persistence/src/imports.ts:290-302`. `saveImportExercise` overwrites the custom exercise's `compatibleEquipment` and `defaultLoadConvention` (version + 1) whenever a commit's `Add new` names other equipment.
  - The docstring (`:283-289`) assumes the earlier import that made it was undone. Nothing checks that.
  - Nothing checks whether an import still in effect uses the exercise under another name.
- `revertJob` (`:260-275`) doesn't restore the exercise.
- Every later import reads the changed convention:
  - `buildCandidates` (`apps/mobile/src/import/import-service.ts:206-207`);
  - `fromCandidate` (`packages/domain/src/import/plan.ts:376`);
  - `Math.abs` for `assistance` (`plan.ts:775-777`).

**Failure path, using only actions the screens offer (probe 3, real SQLite):**
1. File A has `Pull Up Machine 40 kg`, which is `No match`. Ben chooses `Add new` → Weight stack. It is stored as `40 kg stack`, and custom exercise E is a stack exercise.
2. File A2 has `Pullup Mach 45 kg`, which is `Check: Pull Up Machine` (E). Ben chooses `Choose…` → `Pull Up Machine` (subtitle "Weight stack"). It is stored as `45 kg stack`. A2 now remembers `Pullup Mach → E`.
3. Ben undoes A.
4. File B has `Pull Up Machine -30 kg`, which is `Check` (E; `Add new` is offered). Ben chooses `Add new` → Assisted machine. It is stored as `30 kg assistance`, and **E is now an assistance exercise**. A2 is still in effect, and its `Pullup Mach` sets are now on an assistance exercise.
5. Ben undoes B. E stays an assistance exercise.
6. File C has `Pullup Mach` at 45 (09-05), −20 (09-20) and 50 (09-21). It is `Matched` through A2, with **0 questions**. It is listed under "Kept as written" as read as assistance. C stores **20 kg assistance** and **50 kg assistance**.

The only import in effect that says anything about `Pullup Mach` is A2, and A2 read it as a stack:
- under A2's reading, −20 would be refused as unreadable;
- 50 would be a 50 kg load, not 50 kg of help.

The import that made E an assistance exercise is undone, so this has no (b) source. The service also accepts a shorter path:
- `answer()` takes `Add new` for a name matched through an alias (probe 2), which the names screen doesn't offer (`views.ts:508-516`).
- In that path, the name's own sets flip the same way after the undo.

**Why it blocks:**
- "Load vs assistance" comes from an answer that is no longer in effect. That breaks the PM rule.
- It contradicts ADR 0016 difference 27 ("Undo import takes back the answers it taught").
- Step 4 also silently changes how an import still in effect (A2) maps one of its names.

**Fix (either):**
- **Preferred:** never change an existing exercise from an import. Give each `Add new` equipment kind its own ID, for example `customExerciseIdFor(owner, key, equipment)`, and let the alias use point at it.
  - Undo then falls back automatically: aliases follow the jobs still in effect, and each points at an exercise that never changes.
  - Update `importMade` (`import-service.ts:199`) to recognise every such ID.
- **Alternatively:** record the exercise's previous version on the job and restore it in `revertJob`, refusing the restore if the exercise changed since. This still leaves step 4's effect on A2 while B is in effect, so the preferred fix is better.

**Tests to add:**
- the 6-step path above, which must store stack values or ask, never assistance;
- the mirror case (assisted, then stack, then undo);
- dumbbells, then barbell, then undo: the remembered dumbbell answer applies again, and no bar is added.

### B2. A Smith name that also says Barbell is matched with free-barbell exercises, and "plates only" adds the Olympic bar

**Where:**
- `packages/domain/src/import/match.ts:338-346`. `matchName` skips Smith exercises for names without Smith (`:344`). Nothing skips non-Smith exercises for a Smith name.
- `comparedTokens` (`:170-174`) removes `Smith (Machine)` from the words, so `Smith Machine Barbell Squat` compares as `Barbell Squat`.
- `equipmentFit` (`:255-259`) lets the `barbell` word agree with a free barbell exercise.
- `barNamed` (`:421-423`) then treats `Barbell` as naming the Olympic bar.

**Failure path (probe 1 and probe 3, all 8 runs):**
- Names suggested as `Check: Back squat`: `Smith Machine Barbell Squat`, `Barbell Smith Squat`, `Barbell Squat (Smith)`, `Smith Machine Squat (Barbell)` and `BB Smith Squat`.
- Names suggested as `Check: Bench press`: `Smith Barbell Bench Press`, `Smith Machine Bench Press (Barbell)` and `Barbell Bench Press (Smith Machine)`.
- Other free-barbell suggestions:
  - `Smith Machine Incline Barbell Press` → `Incline bench press`;
  - `Smith Machine Barbell Row` and `Smith Barbell Row` → `Barbell row`;
  - `Smith Machine Deadlift (Barbell)` → `Deadlift`.
- After `Use this` and "Plates only", 220 kg is stored as **240 kg total**; in lb, 220 becomes **265**.
- The added weight is the Olympic bar's. The app never asks a Smith bar's weight (r2 SP3).
- With a single such exercise, the barbell screen doesn't show the 60 → 80 conversion (S2).
- Names that say only Smith are correct: `Squat (Smith Machine)` maps to the Smith machine squat, `added`, as written.

**Why it blocks:**
- A 20 kg / 45 lb change comes from the suggested exercise's identity (a free barbell), and the name's own Smith word contradicts that identity.
- The word `Barbell` establishes a bar, not the Olympic bar.
- ADR 0016 (`docs/decisions/0016-fitnotes-import.md:30`, `:106`) and the fix report say "a Smith name only matches Smith exercises".

**Fix:**
- In `matchName`, add `if (smith && !wordsOf(c).smith) continue;`. Apply the same rule to `exact.length > 1` ties.
- In `barNamed`, return false when the name says Smith unless `namesExercise` holds. A Smith name mapped to a free barbell exercise by `Choose…` is then asked on its own.

**Test:** the 11 names above against the real catalogue. Expect a Smith exercise or `No match`, and never a bar added by the group answer.

### B3. A name that says Assisted and Machine can be suggested as a weight-stack exercise and stored as a load

**Where:**
- `match.ts:191-202` and `:212-221`. `equipmentInName('Assisted … Machine')` returns `assisted_stack`, `weight_stack` and `plate_loaded_machine` (asserted in `packages/domain/test/import-match.test.ts:94`).
- So any stack exercise "agrees" with an assisted-machine name.
- `matchName` has only the opposite guard: no assistance exercise for a name without an assist word (`:342`).

**Failure path (probe 3, real catalogue, `Check` then `Use this`):**
- `Assisted Shoulder Press Machine` → `Machine shoulder press` (stack);
- `Assisted Seated Row Machine` → `Chest-supported machine row` (stack);
- `Assisted Lat Pull Machine` → `Lat pulldown` (stack).
- Their positive values are stored as a stack load (40 → `40 kg stack`). Negative ones are refused.
- B1's custom exercises reach the same guard: an `Add new` weight-stack exercise named `Assisted Chin Up Machine` is suggested for that name.

These names are unusual (every realistic assisted pull-up and dip name I tried maps to an assisted exercise). The guard is still one-sided.

**Why it blocks:**
- The PM decision lists `assisted` as a (c) word, and "load vs assistance" as a stored value that a suggestion must not decide.
- Here the suggestion decides it, against the word.

**Fix:**
- In `matchName`, when the name has an assist word, skip candidates whose convention is neither `assistance` nor `bodyweight`. A bodyweight exercise asks its own question, which is source (b).
- Alternatively, have `equipmentInName` drop the machine and cable kinds when an assist word is present.

**Test:** the three names above give an assisted exercise or `No match`.

## Should fix

### S1. A stale rebuild keeps a pre-filled answer from an import undone in the meantime, now unlabelled

**Where:** `apps/mobile/src/import/import-service.ts:658-667` rebuilds the context but keeps `d.answers`. These include overrides that `startingAnswers` (`plan.ts:999-1016`) pre-filled at open from remembered answers.

**Failure path (probe 4, service level):**
1. In import A, `Dumbbell Row` (asked) is answered "Both together".
2. B's preview opens, showing "Both together · Your answer last time".
3. A is undone, and B's commit is refused as `stale`.
4. The rebuilt draft still selects "Both together", **without** the label, and is `ready`.
5. Committing stores 20 → 10 and 24 → 12 each, from the undone answer.

**Severity:** the screens can't reach this today. The preview has no route to Undo, and leaving the preview discards the draft (`ImportPreviewScreen.tsx:27`). The rule still depends on navigation rather than on the service.

**Fix:** track which overrides were pre-filled and not touched in this preview. On a rebuild, drop any whose key is no longer in `perHandAnswers`.

### S2. A lone barbell exercise never shows its conversion

**Where:**
- `apps/mobile/src/import/views.ts:783-784` hides the rows when one exercise is read by the group answer.
- The plates-only option (`:794`) says only "The bar weight below is added".

**Effect:**
- In probe 2, `Smith Machine Barbell Squat 60 kg` is stored as 80 kg, and the screen showed neither "80" nor a row.
- The PM decision and ADR 0016 difference 26 say every exercise shows its conversion before commit.
- The dumbbell screen's lone case does show it (`Imported as 11.25 kg each`).

**Fix:** put the computed value in the option detail (`Imported as 80 kg (60 + 20 kg bar)`), or always show the row.

### S3. Mixed-sign values on an `assistance` exercise are all read as assistance

This predates the branch.

**Where:** `plan.ts:775-777`.

**Effect:**
- `Assisted Dip` at −30 and +10 stores `30 assistance` and `10 assistance` (probe 2), with no question.
- When a file writes assistance as negative numbers, its +10 most likely means weight added.
- The bodyweight path refuses this case (`plan.ts:761-763`, review B3). This path doesn't.

**Fix:** when an `assistance` exercise's values span zero, mark the positive values unreadable or ask about them, as the bodyweight path does.

## Nits

- **N1. Wrong movement, value-neutral** (for the catalogue owner). Each is a `Check`, and its count or bar is asked or comes from a word:
  - `Barbell Front Raise` → Front squat;
  - `Barbell Upright Row` → Barbell row;
  - `Barbell Wrist Curl` → Barbell curl;
  - `Hex Bar Shrug` and `Trap Bar Shrug` → Trap-bar deadlift;
  - `Machine Tricep(s) Extension` → Leg extension;
  - `Lateral Machine Raise` (a FitNotes default) → Cable lateral raise;
  - `Seated Machine Curl` → Seated leg curl;
  - `Dumbbell Calf Raise` and `Dumbbell Y Raise` → Lateral raise;
  - `Neutral Grip Dumbbell Press` → Hammer curl;
  - `Overhead Press (Dumbbell)` → One-arm dumbbell shoulder press;
  - `SLDL` and `Stiff Leg Deadlift` → Dumbbell Romanian deadlift;
  - `Dumbbell Farmer Walk` and the default `Walking` → Dumbbell walking lunge;
  - `Clean` and `Snatch` → the kettlebell versions.
- **N2.** The "Kept as written" line names the assistance exercises but not their conversion. `−30 → 30 kg assistance` changes the sign and isn't shown as a number.
- **N3.** `TWO_IMPLEMENT` (`match.ts:365`) reads `alternate` and `alt` as two dumbbells even when they describe the grip. In probe 1, `Alternate Grip Dumbbell Row` → Chest-supported dumbbell row is halved under "Both together". It is rare; excluding `alt(ernate)? grip` would close it.
- **N4.** Two docstrings mislead:
  - `saveImportExercise` (`imports.ts:283-289`); fold this into B1.
  - `startingAnswers` (`plan.ts:994`) says "opened again after an undo". The pre-fill comes from the same file's import **still in effect** (`import-service.ts:451` excludes reverted jobs), which is correct, (b). It is not from an undone one.

## Tests

**Good:**
- `fitnotes-import-defaults.test.ts` reads the sources independently and isn't vacuous: it lists the halved, bar-added and asked names.
- The remembered-answer tests cover undo of names and dumbbell answers, and show that a later import using a name keeps it in effect.
- The matcher has tests for the Smith-only, assisted-only and count-word rules.

**Missing:**
- B1: undo after `Add new` equipment changes. `packages/persistence/test/imports.test.ts:162` asserts the change itself but not undo, nor a second name mapped to the exercise.
- B2: Smith plus Barbell names.
- B3: Assisted plus Machine names.
- S1: a stale rebuild after an undo.
- S2: the lone barbell conversion.
- S3: mixed-sign assistance values.

## Spec issues

- **SP1. Source (a) includes catalogue aliases that name no equipment** (for the PM and the catalogue owner). By the rule's letter these are allowed, and they decide the count and the bar. In probe 1:
  - `Shrugs` and `Shrug` → Dumbbell shrug, a pair: 370 → **185 each** under "both".
  - These also map to their dumbbell pair entries:
    - `Chest Fly` → Dumbbell fly;
    - `Biceps Curl` and `Bicep Curl` → Dumbbell curl;
    - `Lateral Raise` and `Side Lateral Raise` → Lateral raise;
    - `Rear Delt Fly`;
    - `Walking Lunge(s)`;
    - `Bulgarian Split Squat`;
    - `Incline Curl`;
    - `Hammer Curl`.
  - `Bent Over Row` → Barbell row, so "plates only" adds the Olympic bar.
  - `Lying Triceps Extension` (a FitNotes default) and `Lying Tricep Extension` → EZ-bar skull crusher, so "plates only" adds the EZ bar. FitNotes lists `EZ-Bar Skullcrusher` as a separate default.

  Ben's own names like these are often cable, machine or barbell exercises. **Recommendation:** for load-affecting properties, (a) should count only names that state the equipment. Alternatively, the catalogue owner moves generic aliases to a "suggest only" list.
- **SP2. Undo and exercises.** Difference 27 lists names and dumbbell answers as what Undo takes back. It should also cover the equipment an `Add new` answer gave (B1). The PM should also decide whether an `Add new` answer can change an exercise that another import still in effect uses.
- **SP3. The Smith bar (r2 SP3) is still open.** After B2, a Smith name should be asked, or get `No match` against free-barbell exercises, until a Smith bar weight exists.
- **Still open from earlier rounds:**
  - ADR 0016 is still "Proposed";
  - check 17's sign-off on pre-filled answers (r5 SP3);
  - checks 16 and 27 on Ben's real file and iPhone, including the speed claim (each answer about 1 ms on Linux), which I didn't time;
  - r4 SP1, r3 SP1 and SP4, r1 SP2 and SP8.
