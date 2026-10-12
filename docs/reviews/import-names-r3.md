VERDICT: PASS

# Review r3: FitNotes import names (catalogue batch 03 + Category ranking hint)

Branch `claude/import-names` at `dc5448c`, diffed against `claude/gracious-knuth-joxqpw`. This round covers fix commit `dc5448c`, which answers `docs/reviews/import-names-r2.md` S1. It also re-checks the whole branch: the new entries, every new alias, the Category hint contract, the FitNotes category table and the tests. Independent reviewer, 11 Oct 2026.

## What was checked

- Run by the reviewer:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npm run catalogue:validate`: 139 files, 139 valid (14 rich, 125 basic), 0 errors. The 1 warning is the older `barbell-landmine-press` one.
  - `npm run catalogue:index`: no diff, so `exercise-files.ts` matches the generator.
  - `npx vitest run --testTimeout=120000`: I ran the full suite 3 times, and I could not get a clean full run.
    - Machine load: other worktrees were running suites at the same time, with a load average of 17 to 21.
    - Runs 1 and 2: 195 of 196 files passed, with 3925 tests passed and 1 todo. The 1 failure in each was the `packages/catalogue/test/definition.test.ts` "D6: one paint per pixel" timeout. That test sets its own `{ timeout: 60_000 }`, which overrides the CLI flag.
    - Run 3 (`--maxWorkers=6`): 192 of 196 files passed. The failures were D6 again, plus three wall-clock perf tests (`equipment.test.ts` memoised loads, `backup-perf.test.ts` and `data-domains-perf.test.ts`).
    - The branch touches none of those files or their sources.
    - Each of the four failing files passes when run on its own: `definition` 40/40, `equipment` 40/40, and both persistence perf files.
    - All 6 test files this branch touches pass when run together.
    - Round 2 saw the same kind of load timeout, and a clean rerun passed.
- Every alias added to the 11 existing entries and the 4 new entries. For each one I asked whether it could name a different movement or load convention (the ADR 0016 PM principle).
- Name and alias collisions across the whole catalogue, using a throwaway normalised-key script kept in the scratchpad (not committed). I found none.
- The hint contract in `category.ts`, `match.ts`, `plan.ts` and `views.ts`.
- The FitNotes category table against the primary muscles the catalogue actually uses. Every primary muscle in use (abductors through upper_chest) is reachable from at least one category, and no catalogue entry has a primary muscle that every category would contradict.
- No real export data was used or copied. The tests use exercise names only.

## Round-2 findings: status

| R2 | Status |
|---|---|
| S1 `Chest-supported barbell row` (and borderline `Prone barbell row`) on the seal row | **Fixed.** Both aliases are removed from `barbell-seal-row.json`. An `uncertain` note records why. `batch-03.md` lists them under "Removed after review". `fitnotes-import-categories.test.ts:28-30` pins both as a `Check` and keeps `Barbell Bench Row` `Matched`. |
| N1 stale `categoryOf` comment | Not fixed. Carried forward as N2. |
| N2 stale `Barbell Leg Curls` line in batch-03 | Not fixed. Carried forward as N3. |
| N3 hint applied before `sameCount` | Not fixed. Carried forward as N4. It can't occur with today's catalogue. |
| N4 muscle tie-break against an exercise with no muscles | Not fixed. Carried forward as N5. It only ever affects a `Check`. |
| N5 shrug `requiresStation` | Not fixed. Carried forward as N6. |

## What holds

- **The hint can never make a match or change a stored value.**
  - Saved aliases, exact names and catalogue aliases return before any hint code runs (`match.ts:369-379`).
  - When two exercises share an exact name, the hint can only choose which one a `Check` suggests, and only among the ones it doesn't contradict (`match.ts:380-386`).
  - In the word path, `tied` is built over every fitting candidate first, and the hint can only drop from it or break a tie (`match.ts:407-411`). So it never promotes a weaker suggestion.
  - `NameRow.category` is display only and is not persisted. The source cell stays in `import_rows`.
  - The kept-match cache key includes the categories (`plan.ts:821`).
  - Tests show `Barbell Shrug` under `Legs` stays `Matched`, and that a hint never upgrades a `Check`.
- **An unknown, blank, custom, cardio or injection-text category gives no hint**, and so does a mix that includes one. Category text is only ever a table lookup or clipped display text (rule 8).
- **The FitNotes (Android) mapping is sensible and generous.**
  - Back includes the hinge muscles.
  - Shoulders includes traps.
  - Biceps includes brachialis and forearms.
  - Triceps is triceps only, which covers FitNotes' own Triceps defaults.
  - `singular` handles `Biceps`, `Calves`, `Glutes`, `Lats` and `Abs` correctly.
- **Each new alias is unambiguous.** None of them can name another movement or load convention:
  - `Flat barbell bench press`
  - `Leg extension machine`
  - `Seated calf raise machine`
  - `Lateral dumbbell raise` (a pair, halved only by Ben's "Both together", tested in kg and lb)
  - `Rope push down`
  - `Seated machine fly`
  - `Rear delt machine fly`
  - `Rear delt dumbbell fly`
  - `Straight-arm cable pushdown` (with straight arms it is a lat movement, not a triceps pushdown)
  - `Barbell shrugs`, `Barbell shoulder shrug`, `Standing barbell shrug`
  - `Barbell standing calf raise`, `Standing calf raise (barbell)`
  - `Seal row (barbell)`, `Barbell bench row` (Catalyst's "Bench Row" is the flat-bench seal row; the incline version is named "incline")
  - the four lat-prayer aliases
  - `Chest dips` and `Parallel bar triceps dip` are each a dip, but see SP1.
- **The new entries are accurate.**
  - Conventions are explicit: `total` for the barbell entries and `stack` for the lat prayer.
  - They are written in the project's own words, with `provenance.source: fizz` and `review: draft`.
  - Each has two sources whose `supports` fields match the cues and muscles. The Henselmans page is honestly marked as seen only through a search summary.
  - Uncertainties are disclosed: bench height, kneeling vs standing, the merge question and the removed aliases.
  - The safety notes are proportionate and don't diagnose.

## Blocking

None.

## Should fix

None.

## Nits

- **N1. `Chest-Supported Barbell Row` and `Prone Barbell Row` suggest the unsupported bent-over row.**
  - Where: `apps/mobile/test/fitnotes-import-categories.test.ts:28-29` and `docs/catalogue/batches/batch-03.md`.
  - Both names now show as a `Check → Barbell row`. Neither reading of those names (seal row or incline prone row) is a bent-over row.
  - If Ben taps "Use" without reading, the supported row's history seeds the bent-over row's targets.
  - It is still a `Check` that Ben confirms, and the convention is `total` either way, so no stored number changes. That is why this is not blocking. The batch note already says Ben chooses.
  - Optional fix: let a `prone`/`chest-supported` word count as agreeing with the seal row. Or accept this, as ADR 0016 accepts other wrong-movement `Check`s.
- **N2.** `packages/domain/src/import/plan.ts:830`: the stale doc comment "third column in every layout" still sits above the current one for `categoryOf`. Delete it.
- **N3.** `docs/catalogue/batches/batch-03.md:41`: "Not changed" still says `Barbell Leg Curls` → Barbell curl and that "the suggestion is wrong". Under Legs or Hamstrings it is now `No match · Legs`. It is still the curl only when there is no category or the category is unknown.
- **N4.** `packages/domain/src/import/match.ts:411`: the hint filters `tied` before `sameCount`, so a category outranks the name's arm-count cue. This is latent: one-arm and two-arm catalogue variants share their muscles today. `sameCount(tied, cue)` followed by the hint filter keeps the count preference first.
- **N5.** `packages/domain/src/import/match.ts:313-315`: in a tie, an exercise whose muscles `agree` beats one with no muscles recorded (Ben's custom exercise). It is never dropped, but it can now lose a tie it used to block. It is only ever a `Check`. Either break the muscle tie only when every tied candidate has muscles, or note it in ADR 0016.
- **N6.** `barbell-shrug.json`: the setup cue uses a rack but `requiresStation` is unset, while the standing calf raise sets `["rack"]`. Pick one and be consistent.
- **N7.** `packages/domain/src/import/plan.ts:868`: `NameRow.category` is the first category only, but the hint uses all of them. A name filed under Legs and Hamstrings reads `No match · Legs`. This is harmless, but could show `Legs, Hamstrings` if wanted.

## Spec issues

- **SP1 (still open, from r1).** `Chest Dips` and `Parallel Bar Triceps Dip` both match `Dip` exactly, so a file containing both merges their histories without a question. This is recorded in ADR 0016 and needs the PM's decision.
- **SP2 (still open, from r1).** The hint can't downgrade a catalogue-alias `Matched` to a `Check` when the category contradicts it. The older singular `Cable crossover` alias depends on this. It is recorded in ADR 0016.
- **SP3 (still open, from r2).** The FitNotes 2 (iPhone) muscle-level categories are assumed, not sourced. A wrong guess costs nothing, because an unknown name gives no hint. Research §3.4 still needs a real iPhone sample.
- **SP4.** The full suite can't finish cleanly on a shared, heavily loaded runner. `definition.test.ts` D6 has a hard 60 s per-test timeout that `--testTimeout` can't raise. The wall-clock perf tests (`equipment.test.ts` M8 and the two persistence perf files) also fail under load. This isn't caused by this branch, but it makes "run until all pass" depend on machine load. Consider moving wall-clock tests into the existing `test:perf:jitless` lane, or raising D6's timeout.
