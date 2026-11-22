VERDICT: PASS

# Review r2: FitNotes import names (catalogue batch 03 + Category ranking hint)

Branch `claude/import-names` at `06c80a7`, diffed against `claude/gracious-knuth-joxqpw`. This round covers the fix commits `a164bc3`, `a954269` and `06c80a7` that answer `docs/reviews/import-names.md`, and re-checks the whole branch. Independent reviewer, 11 Oct 2026.

## What was checked

- Run by the reviewer:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npm run catalogue:validate`: 139 files, 139 valid (14 rich, 125 basic), 0 errors. The 1 warning is the older `barbell-landmine-press` one.
  - `npm run catalogue:index`: no diff, so `exercise-files.ts` matches the generator.
  - `npx vitest run --testTimeout=120000`: 196 files passed, 3926 tests passed, 1 todo. An earlier run while other worktrees were running suites at the same time had 3 failures, which were load timeouts (for example `definition.test.ts` "D6: one paint per pixel" at 85 s). None of them were in files this branch touches. A clean rerun passed in full.
- Every round-1 finding against the new code.
- Every alias added to the 11 existing entries and the 4 new entries. For each one I asked whether it could name a different movement or load convention.
- The hint contract in `category.ts`, `match.ts`, `plan.ts` and `views.ts`:
  - It can never make a match or question one.
  - It can never change a stored value.
  - It drops suggestions only and never promotes one.
  - The FitNotes category table.
- A throwaway synthetic probe of `matchName` for tie-break order (deleted, not committed). No real export data was used or copied.

## Round-1 findings: status

| R1 | Status |
|---|---|
| B1 `Cable crossovers` alias | **Fixed.** The alias is removed. `nameKey` does not singularise, so the older `Cable crossover` alias does not catch the plural. Tests show the plural is `No match` under Shoulders and Back and a `Check` under Chest (`fitnotes-import-categories.test.ts` CROSSOVERS). |
| S1 hint promoted weaker suggestions; Back lacked the hinge muscles | **Fixed.** `match.ts:407-411` builds `tied` over every fitting candidate before the hint filters it, so the hint can only remove a suggestion. `BACK` now has glutes and hamstrings, and `hamstring` now has glutes. All 7 probe names from round 1 are tested end to end (DROP_ONLY), and there is a unit test in `import-category.test.ts:115`. |
| S2 misspelt rear-delt alias; no per-hand test | **Fixed.** The misspelt alias is removed. `fitnotes-import-defaults.test.ts` now runs in kg and in lb and checks that `Rear Delt Dumbbell Fly` is halved by "Both together" and that the misspelling is asked and stored as written. |
| S3 `Barbell calf raise` | **Fixed.** It is no longer an alias. It is a `Check` suggesting the standing entry, the entry's `uncertain` note is updated, and it is tested. |
| S4 ADR | **Fixed.** ADR 0016 records the hint contract and batch 03, ticks off the closed items, and lists the names left as a `Check` on purpose. Research §3.4 points to the ADR. |
| N1 batch notes | Fixed (see N2 below for one stale line). |
| N2 Category column by header | Fixed (`plan.ts:849`). A stale doc comment was left behind (N1 below). |
| N3 clip category | Fixed (`views.ts` `clipCategory`, 24 characters, tested). |
| N4 iPhone categories unsourced | Fixed: marked "assumed, not sourced" in `category.ts`. |
| N5 lat prayer pulley wording | Acceptable. The pulley at collarbone height is "lower" relative to the straight-arm pulldown's high pulley. |
| N6 rich vs basic tier | Still the PM's call. It is documented in `batch-03.md`. |

## What holds

- **The hint cannot make a match or change a stored value.**
  - Saved aliases and exact names or aliases return before any hint code runs (`match.ts:369-379`).
  - With two exercises sharing an exact name, the hint can only choose which one a `Check` suggests (`match.ts:380-386`).
  - In the word path, the hint only filters `tied` or breaks a tie inside it (`match.ts:410-411`).
  - `NameRow.category` is display only. The source cell stays in `import_rows`.
  - The kept-match cache includes the categories in its key (`plan.ts:821`), so a cached match can't leak across categories.
- **An unknown, blank, custom or cardio category gives no hint**, and so does a mix that includes one. Category text is never interpreted beyond a table lookup (rule 8).
- **FitNotes Android category mapping is sensible.**
  - Shoulders includes traps (shrugs).
  - Back includes the hinge muscles.
  - Biceps includes forearms and brachialis (hammer and reverse curls).
  - Triceps is triceps only, which is correct for FitNotes' own Triceps defaults (dips, pushdowns, skull crushers).
- **The new aliases on existing entries are unambiguous for both movement and load convention.**
  - `Flat barbell bench press`
  - `Leg extension machine`
  - `Seated calf raise machine`
  - `Lateral dumbbell raise`
  - `Rope push down`
  - `Seated machine fly`: the reverse version has its own FitNotes name.
  - `Rear delt machine fly`
  - `Rear delt dumbbell fly`
  - `Straight-arm cable pushdown`
  - `Chest dips` and `Parallel bar triceps dip` are each a dip. SP1 still stands.
- **The new entries are accurate.**
  - Conventions are explicit (`total` for the three barbell entries, `stack` for the lat prayer).
  - They are written in the project's own words, with `provenance.source: fizz` and `review: draft`.
  - Uncertainties are disclosed, including the seal-row bench height and kneeling vs standing for the lat prayer.
  - Muscles and equipment are plausible and match the cited sources' `supports` fields.
- **Tests are synthetic.** Only exercise names are used. No rows or values from Ben's file are in the repo.

## Blocking

None.

## Should fix

### S1. `Chest-supported barbell row` is not clearly the seal row

Where: `packages/catalogue/data/exercises/barbell-seal-row.json:6`.

A "chest-supported barbell row" is also commonly done face-down on an **incline** bench with the bar hanging below. That is a different torso angle and range from a flat, tall-bench seal row. The load convention is `total` either way, so no stored number changes. But the exercise's identity, and so the history and targets it seeds, is a guess applied without a question.

This is the same class as round-1 S3 (`Barbell calf raise`), which the branch rightly reverted. The brief for this batch was "each new alias genuinely unambiguous". `Prone barbell row` is borderline for the same reason, but it is usually used for the seal or bench row.

**Fix:** drop `Chest-supported barbell row`, so it becomes a `Check` suggesting this entry, or record the PM's acceptance in `batch-03.md`.

## Nits

- **N1.** `packages/domain/src/import/plan.ts:830`: a stale doc comment ("third column in every layout") sits directly above the new one for `categoryOf`. Delete it.
- **N2.** `docs/catalogue/batches/batch-03.md:40`: the "Not changed" line says `Barbell Leg Curls` → Barbell curl and that "the suggestion is wrong". Under Legs or Hamstrings it is now `No match · Legs`. Without a category it is still the barbell curl. Say so.
- **N3.** `packages/domain/src/import/match.ts:410-411`: the hint filters `tied` *before* `sameCount`, so the category outranks the name's arm-count cue.
  - Synthetic probe: `Single Arm Dumbbell Foos` with no hint gives `Check → Single-arm dumbbell foo`. Under Back, with only the two-arm one agreeing, it gives `Check → Dumbbell foo`.
  - This can't happen with today's catalogue, because one-arm and two-arm variants share their muscles.
  - Applying `sameCount` first and then the hint (`sameCount(tied, cue).filter(...)`) keeps the count preference ahead of the hint.
- **N4.** `packages/domain/src/import/match.ts:313-315`: the muscle tie-break favours an exercise with muscles that `agrees` over one with no muscles recorded (`unknown`, e.g. Ben's own custom exercise).
  - Probe: a custom `Cable bar` (no muscles) tied with a catalogue `Cable bar` gives `No match` with no hint. Under Back it gives `Check →` the catalogue one.
  - ADR 0016 says such an exercise "is never dropped". That is true, but it can now lose a tie it used to block.
  - It is always a `Check`, so this is low-risk. Either break the muscle tie only when every tied candidate has muscles, or add a line to the ADR.
- **N5.** `packages/catalogue/data/exercises/barbell-shrug.json`: the first setup cue sets the bar in a rack, but `requiresStation` is unset. The standing calf raise sets `["rack"]`. Shrugs can be taken from the floor, so this is optional. Pick one and be consistent.

## Spec issues

- **SP1 (still open, from r1).** `Chest Dips` and `Parallel Bar Triceps Dip` both match `Dip` exactly, so a file containing both merges their histories without a question. This is recorded for the PM in ADR 0016. It needs a decision: accept the catalogue's level of detail, or have the preview flag "2 names → 1 exercise".
- **SP2 (still open, from r1).** The hint can't downgrade a catalogue-alias `Matched` to a `Check` when the category contradicts it. This is recorded in ADR 0016 for the PM. The older singular `Cable crossover` alias still depends on this.
- **SP3.** The FitNotes 2 (iPhone) muscle-level category names in `category.ts` and in the "FitNotes 2 (iPhone) categories" test are assumed, not sourced. An unknown name means no hint, so a wrong guess costs nothing. But the research note (§3.4) should get a real iPhone sample before the table is treated as reference.
