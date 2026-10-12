VERDICT: CHANGES NEEDED

# Review: FitNotes import names (catalogue batch 03 + Category ranking hint)

Branch `claude/import-names`, commits `a6e2221` (catalogue batch 03) and `8f3cfa3` (Category as a ranking hint), diffed against `claude/gracious-knuth-joxqpw`. Independent reviewer, 11 Oct 2026.

## What was checked

- Run by the reviewer, all exit 0:
  - `npm run typecheck`
  - `npm run lint`
  - `npx vitest run --testTimeout=120000`: 196 files, 3909 passed, 1 todo.
  - `npm run catalogue:validate`: 139 files, 139 valid (14 rich, 125 basic), 0 errors. The 1 warning is the old `barbell-landmine-press` one. There are no dangling variation keys and no shared aliases.
  - `npm run catalogue:index`: produces no diff, so the hand-written `exercise-files.ts` matches the generator.
- The 4 new entries (schema, accuracy, sources), and the 15 new aliases on 11 existing entries.
- The Category hint (`category.ts`, `match.ts`, `plan.ts`, `views.ts`):
  - It can never auto-match.
  - It can never change a stored value.
  - Its FitNotes category table.
- Probes through the real import service on SQLite with the bundled catalogue. They used a throwaway test file, deleted afterwards and not committed:
  - Every exercise name in Ben's real export, run with its category and without one. The file stayed outside the repo and none of its rows or values are quoted here.
  - 20 synthetic hinge, pull and fly names under 8 categories.
- All 8 source URLs were fetched. Seven return 200. Menno Henselmans returns 403, which the entry already discloses. Catalyst's page does say "Bench Row AKA Seal row, chest-supported row … barbell or pair of dumbbells", so leaving plain `Seal row` out of the aliases is right.

## What holds

- **The hint never makes a match and never changes a stored value.**
  - It only filters word suggestions (`match.ts:401`) and breaks exact-name ties, and a tie it breaks is always a `Check` (`match.ts:384-386`).
  - An exact name or alias stays `Matched` under any category. Saved answers still win first.
  - `category` on `NameRow` is display only. It is never persisted, and the source cell is still kept in `import_rows` as provenance.
  - Probe on the real names: with and without categories, every result is identical except `Barbell Leg Curls`. That one goes from `Check → Barbell curl` to `No match · Legs`, which is the intended fix. No row became `Matched` because of a category.
- **Unknown, blank, cardio or custom categories give no hint.** A name filed under several categories gets no hint if any one of them is unknown (`categoryHint`). Category text is data (rule 8). An instruction-like category is tested and gives no hint.
- **Exercises with no muscles recorded are never contradicted.** This covers custom exercises with no muscles, and they are tested.
- **The new entries are accurate.**
  - Conventions are explicit: barbell `total` for the seal row, shrug and calf raise, and `stack` for the lat prayer.
  - Uncertainties are recorded.
  - No copied text, `provenance.source: fizz`, `review: draft`.
  - The decision to keep the lat prayer separate from the straight-arm pulldown is reasoned and flagged for Ben.
- **Most new aliases are unambiguous for both movement and load convention:**
  - `Flat barbell bench press`
  - `Leg extension machine`
  - `Seated calf raise machine`
  - `Lateral dumbbell raise`
  - `Rope push down`
  - `Seated machine fly`
  - `Rear delt machine fly`
  - `Straight-arm cable pushdown`
  - `Lat prayers`
- **`Lower Back Extensions` was rightly rejected** as an alias.

## Blocking

### B1. `Cable crossovers` → Cable fly is not unambiguous, and the real export contradicts it. It now auto-matches with no question.

Where: `packages/catalogue/data/exercises/cable-fly.json:6`. Test: `apps/mobile/test/fitnotes-import-categories.test.ts:37`.

Ben's real export has a separate exercise called `Cable Crossovers`:
- He files it under a non-chest category.
- In the same file he logs his chest cable flies under other names, filed under Chest.

So his "crossovers" are very probably something else, such as a reverse or rear-delt crossover. Before this branch the name was a `Check` (→ Cable fly), so Ben would have confirmed or changed it. With the new alias it is `Matched` and no question is asked.

The hint cannot catch this by design (the hint never touches a `Matched`). The probe confirms `Matched → Cable fly` under every category.

The end-to-end test hides this. It files `Cable Crossovers` under `Chest`, which is not how the name actually arrives.

**Failure:** Ben imports his file. All of his `Cable Crossovers` sets go into Cable fly (chest) history, which seeds wrong targets and progression for that exercise, and nothing asks him. The fix is a manual `Change` on a row he has no reason to look at.

**Fix:** remove the `Cable crossovers` alias. Under a non-chest category, the word suggestion is then dropped by the hint (`No match · <category>`) and Ben chooses. Add a test with a non-chest category.

The plain `Cable crossover` alias is older than this branch and has the same weakness. See SP2 for a matcher-level fix (the PM decides).

## Should fix

### S1. The hint can promote a weaker, wrong suggestion, and the Back set leaves out the hinge muscles

Where: `packages/domain/src/import/match.ts:401` and `packages/domain/src/import/category.ts:24`. The comment at `category.ts:17-19` claims the opposite.

The comment says each set is "generous… a deadlift under Back or Legs". But `BACK` has no `glutes` and no `hamstrings`, and FitNotes' own defaults file deadlifts under Back. Because contradicted candidates are dropped *before* the best score is chosen, a lower-scoring candidate that "agrees" becomes the suggestion.

Probe results (no hint → with hint):

| Name | Category | No hint | With hint |
|---|---|---|---|
| `Romanian Deadlifts` | Back | `Check → Romanian deadlift` | `Check → Deadlift` (wrong movement) |
| `Stiff Leg Deadlifts` | Back | `Check → Dumbbell Romanian deadlift` | `Check → Deadlift` |
| `Close Grip Bench` | Back | `Check → Close-grip bench press` | `Check → Neutral-grip pulldown` (shows the mechanism) |
| `Trap Bar Deadlifts` and `Hex Bar Deadlifts` | Back | `Check → Trap-bar deadlift` | `No match` (the correct suggestion is lost) |
| `Kettlebell Swings` | Back | `Check → Kettlebell swing` | `No match` (the correct suggestion is lost) |
| `Hip Thrusts` | Hamstrings | `Check → Hip thrust` | `No match` (the correct suggestion is lost) |

A wrong `Check` is the class of error this feature exists to remove (ADR 0016 r5 N2). If Ben taps `Use this`, the history goes to the wrong exercise.

**Fix:**
1. Add `glutes` and `hamstrings` to `BACK`, and `glutes` to `hamstring`.
2. Make the hint drop-only: compute the best score over *all* fitting candidates first. Suggest an agreeing candidate only when it is within `TIE` of that unfiltered best. Otherwise return `No match`.

The existing "demoted" test, a tie between Barbell curl and Leg curl, still passes under this rule. Add the probe names above as tests.

### S2. `Rear delt dumbell fly` (misspelt) puts Ben's personal naming into Coaching knowledge, and it changes the dumbbell answer without a test

Where: `packages/catalogue/data/exercises/dumbbell-rear-delt-fly.json:6`. Test: `fitnotes-import-categories.test.ts:40`.

There are two problems:

1. **Rule 10.** ADR 0016 (storage section) says Ben's naming is Your data (`exercise_aliases`, owner-scoped). A misspelling taken from one person's export is not general coaching knowledge. After Ben answers it once, his remembered `ExerciseAlias` already handles it.
2. **Stored values.** As a catalogue alias, the name now counts as source (a). It inherits `implements: 2` and is **halved by "Both together"**. Before, it was a suggested `Check` and was asked separately. The PM listed rear-delt dumbbell raises as an unambiguous pair (ADR 0016 l.129), so the outcome may be right. But no test covers the per-hand result for either new rear-delt alias. The defaults test only checks `Lateral Dumbbell Raise`.

**Fix:** drop the misspelt alias, or get the PM to accept it explicitly. Add a per-hand test for `Rear delt dumbbell fly` like the `Lateral Dumbbell Raise` one in `fitnotes-import-defaults.test.ts`.

### S3. `Barbell calf raise` is an alias that its own entry marks uncertain

Where: `packages/catalogue/data/exercises/barbell-standing-calf-raise.json:6` and `:116-118`.

The brief for this batch was "each new alias genuinely unambiguous". The entry itself says it *assumes* the standing version. The load convention is `total` either way, so no stored number changes. But the exercise identity, and so its progression history, is a guess applied without a question.

**Fix:** either the PM or Ben confirms (then delete the `uncertain` note), or remove the alias and leave it as a `Check`.

### S4. ADR 0016 does not record the category hint or the alias batch

Where: `docs/decisions/0016-fitnotes-import.md`, which is unchanged.

The matcher's contract changes: categories now drop and rank suggestions. Research `fitnotes-export-format.md` §3.4 says "Don't use it to classify rows". The decision that the category is a ranking hint only, never matches, and gives no hint when unknown needs to be in the ADR, along with the open catalogue-owner items this batch closed. Otherwise the next reviewer reads the research note as a violation.

**Fix:** add a short bullet to ADR 0016 and tick off the catalogue-owner items it resolves.

## Nits

- **N1.** `docs/catalogue/batches/batch-03.md:38-42`, "Validation status", is out of date. It says nothing was run or committed. Everything now passes and is committed. Update it with the real figures above.
- **N2.** `packages/domain/src/import/plan.ts:831-833`: `categoryOf` hard-codes `cells[2]`. That is correct for every layout today, but use `FITNOTES_HEADERS[variant].indexOf('Category')`, as `columns()` does, so a new layout can't silently feed a weight cell into the hint.
- **N3.** `apps/mobile/src/import/views.ts:534`: the `No match · <category>` text has no length limit. A long or odd category cell would fill the row. Clip it the way `firstLine` is clipped.
- **N4.** `packages/domain/src/import/category.ts:13-16`: the FitNotes 2 (iPhone) category names (`Back (Lower)`, `Trapezius`, …) are not sourced. Research §3.4 lists only the Android values. This is harmless, because an unknown category means no hint, but the test labelled "FitNotes 2 (iPhone) categories" asserts names nobody has verified. Mark them as assumed or cite a source.
- **N5.** `cable-lat-prayer.json` setup cue: "Pulley about collarbone height when standing". `batch-03.md` explains the separate entry by "lower pulley". Make the two say the same thing.
- **N6.** The PM asked for basic-tier entries, but rich ones were delivered (the basic schema refuses cues and safety). That is reasonable and documented, but the PM should accept it, because rich entries normally come with an animated guide.

## Spec issues

- **SP1. Two different source names now merge into one exercise with no question.** `Chest Dips` and `Parallel Bar Triceps Dip` are both now catalogue aliases of `Dip` (`bodyweight-dip.json:6`). When a file has both, as Ben's does, both histories go into one exercise automatically. Before, the triceps one was a `Check`. Each alias names a dip correctly, but upright and leaning dips at different added loads will mix progression. The PM should decide either:
  - that the catalogue's granularity is accepted, or
  - that the preview flags "2 names → 1 exercise" for Ben to confirm.
- **SP2. The hint is deliberately unable to question a `Matched`.** That is the safe reading of "never makes a match". But it means the strongest evidence the file gives, the category, cannot catch a wrong catalogue alias (B1). A downgrade-only rule would still never make a match: a catalogue-alias match (not Ben's own saved answer) whose primary muscles the category contradicts becomes a `Check`. This needs a PM decision.
- **SP3.** Research §3.4 ("don't use it to classify rows") and this feature should agree. Amend the research note, or put the rationale in S4's ADR bullet.
