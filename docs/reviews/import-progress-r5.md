# Review r5: imported FitNotes history in progressions (`claude/import-progress`)

Reviewer, 13 Oct 2026. Diff: `claude/gracious-knuth-joxqpw...claude/import-progress` (18 commits, 51 files). This round covers `07bc9b2` and `484dc53`, which respond to `import-progress-r4.md`. It also rechecks the r3 fixes (`4714f6e`, `ec85e36`).
Trigger: Ben, build 131: "The imported data doesn't show up in progressions etc I don't think."

## Verdict: PASS

Round 4's findings are fixed as written, and nothing new is blocking.
- **r4 B1 is fixed.** Ties now resolve like this (`progression.ts:214-221`):
  - A tie of 2 or more sets goes to the harder load.
  - A tie of single sets still goes to the easier load (r2 B1).
  - When harder sets are judged and every judged set reached the top, the increase starts from the hardest judged load (`increaseFrom`, `:543-550`, `:860-873`).
  - Lighter finishers no longer lift the planned count (`fitNotesPlannedSets`, `:257`).
  - The four tests the review asked for are at `fitnotes-reading.test.ts:357-439`: 2 + 2 finishers, 3 + 3 burnouts, drop-set triplets (3 planned, never reduced from the last drop) and the all-at-top pyramid. There is also an lb barbell case and an assisted case.
- **r4 S1 is fixed.** `workingRunBeforeTop` (`:142-164`) keeps 2 or more sets in a row at one load just before a single heavier set, when they outnumber it, have at least its reps and are at least 80% of its load. Real ramps still read as ramps. Every `comparableSetsOf` caller passes `reps` (`HistorySession`, the overview, and `gym-switch.ts:147`, which was updated), so Last, `Why?`, the overview and set counts all read sessions the same way.
  - `Why?` now says "judged" for every imported session: 0 "logged" facts on imported targets in the probe.
  - The ADR explains why the top set's reps are used instead of the rule's floor.
  - The tests are at `:441-505`.
- **r4 N1 is fixed.** The tie fact is now worded from the counts.
- r3 B1, S1 and N1 still hold: the r3 tests pass, and the real-data probe agrees (below).

The open items are product calls already listed for Ben (Spec issues), plus some smaller should-fix and nit items.

## Checks run

- `npm run typecheck`: pass. `npm run lint`: pass.
- `npx vitest run --maxWorkers=2`: 273 files, 5237 tests passed, 1 todo. I ran it again after deleting the throwaway probe files, with the same result.
- **Synthetic probe.** A throwaway `packages/domain/test/zz-local-r5.test.ts` (deleted) ran the 8–10 rule on dumbbells for 11 shapes, once and twice in a row, with and without the default 10% jump cap. The results are quoted in the findings below.
- **Local probe with Ben's two files.** The paths were passed in by env var and read at runtime by a throwaway `apps/mobile/test/zz-local-r5.test.ts`, which was deleted along with its output. Only counts and ratios are reported here.
  - Both imports commit (150 + 17 workouts), and Past workouts lists 167.
  - Start next from every imported workout gives 441 exercise blocks (each started, then discarded, with no errors). Rule decisions: `hold` 325, `increase_load` 95, `hold_after_miss` 20, `increase_reps` 1, `reduce_load` 0.
  - These come to **45 distinct current targets**: `hold` 26, `increase_load` 16, `hold_after_miss` 2, `increase_reps` 1. All 45 rest on a FitNotes basis.
  - `Not checked` appears on 49 blocks, every one with no planned load (exercises the commercial preset has no equipment for). No fitted set carries it.
  - **0** targets plan below the working (most-sets) load, except where the gym's equipment rounded the load toward easier. There are 7 of those, and rule 4 allows it.
  - **0** current targets have the r4 B1 shape (an increase planned from a finisher).
  - 2 current targets have the r4 S1 working run before a heavier set. Both now plan from the run's load.
  - 1 current target has a tie of 2+ sets resolved to the harder load. It is an increase, and it is correct.
  - 1 current target increases from the hardest judged load: 2 sets, about 10% above the heaviest set, which reached the top.
  - Planned set counts: 1 set ×4, 2 ×16, 3 ×25. None is above what was done.
  - **16 of 45** current targets hold with "Only N of M working sets were judged" (S3).
  - **2 of 45** are pyramid holds at a load 17–33% below a heavier set done for as many reps in the same session (S2).
- **Privacy.** I compared the added lines of `1e64ad8..HEAD` against every exercise name, date and row in Ben's files: 0 hits for each. This file contains only counts, ratios and invented shapes. `git status` was clean apart from this file.
- **Migration.** There is none in this round: the domain reading changes only. Stored sets are untouched (rule 2). The start path is unchanged: idempotent `opId` with `expectedPreviewKey` (rule 5). `TargetBasis.imported` is still optional, so older rows and backups decode.
- **Rules 4, 9, 10.**
  - FitNotes targets are still fitted to the gym's real equipment: rounded toward easier, never above a max, and no load when nothing here can check it.
  - The pain gate runs before the reading.
  - Category cells still come from owner-scoped `import_rows`.

## Blocking

None.

## Should fix

### S1. "Last load X is no longer available on <item>" is shown for a FitNotes load that was never on that item
`packages/domain/src/progression.ts:651` (`feasibleHold`). This text is older than this branch, but B7 makes it reachable from imported history.

Add exercise, and any path that passes today's equipment with a FitNotes basis, runs an off-rack FitNotes load (`24 kg each`, for example) through `feasibleHold`. The result is "Last load 24 kg each is no longer available on Home dumbbells; using 22.5 kg each."
- FitNotes recorded no equipment, so "no longer available" claims something the data doesn't show (rule 6).
- Start next isn't affected (`fitLater`, where the rounding note reads `Rounded to …`).

**Fix.** When the latest session is imported, word it as "Last load 24 kg each (FitNotes) isn't on Home dumbbells; using 22.5 kg each." Add a test next to `fitnotes-reading.test.ts:425` that passes a rack without the FitNotes load.

### S2. A pyramid whose heaviest set reached the top but whose middle set didn't holds at the lightest load
`progression.ts:214-221` (single sets tie to the easiest), `:543-550` (`increaseFrom` only when **every** judged set reached the top).

r4 B1's fix (a) had a second half: "If only some reached the top, plan from the hardest load whose sets all did." It wasn't built; ADR 0016 says "otherwise the hold stays at the working load". So:
- `24×10, 22×8, 20×10` is a 1:1:1 tie, so 20 is the reference. Not every set reached the top, so the result is `hold` at 20, for 3 sets.
- `24×9, 20×10, 16×10` gives `hold` at 15 on the test rack.

On real data, 2 of 45 current targets plan a hold 17–33% below a heavier set Ben did for at least as many reps in the same session.

The plan is a hold, not an "Increase", so it isn't a false claim. But it looks like the import was ignored, which is what Ben reported. Whether this changes depends on Spec issue 1.

**Fix, if Ben agrees:** among the judged loads whose sets all reached at least the reference's best reps, hold at the hardest one. Test it with the two rows above.

### S3. r4 S2 / Open 2: a third of the current targets hold only because too few sets were judged
`progression.ts:812-820`. 16 of 45 current targets read "Only N of M working sets were judged on <date>; holding":
- 2 of 3: 12 targets. 3 of them also had a lighter finisher, and 2 had a top set kept as context.
- 1 of 2: 3 targets.
- 1 of 3: 1 target.

Each holds on every Start next until Ben logs the exercise in the app. This is honest, and the ADR records it, but it is now the largest group of "hold" targets. Ben should decide it before the build goes to him (Spec issue 3). Either:
- progress on `min(rule sets, sets done at the working load)` for imported sessions; or
- show the hold reason on the Summary.

No code change is needed until he decides.

## Nits

### N1. Grammar in the ramp fact
`progression.ts:590`. With one set it reads "its 1 lighter set before the top set **was read as warm-ups**". Use "as a warm-up" when n = 1.

### N2. The findings overstate one probe result
`import-progress-findings.md` item 10 says "0 increases planned below a load done at the top of the range in the same session". In the r5 probe, 1 of the 16 current increases has this shape:
- 3 working sets, then one heavier set (12% heavier) for more reps than the range's top.
- The heavier set is context, so the increase is one step from the working load, below it.

This matches D3 ("heavier sets are top-set context"), and the plan is above the working load, so it isn't the r4 B1 failure. But the claim should say "below the working load", or note this case.

### N3. A FitNotes load that isn't on the rack can step two rack positions
`progression.ts:679` rounds `current + increment` to the nearest load. With the 24 kg pyramid's hardest load on a 2.5 kg rack, 24 + 2.5 = 26.5 rounds to 27.5, which is +15%. The default rule's 10% cap turns this into `increase_reps` at 22.5. Only a custom rule without `maxLoadJumpPercent` sees the big step. Optional: when the current load isn't achievable, step from the next achievable load above it.

### N4. r3 N2 and N3 are still open
These are the string-matched `UNCHECKED_NOTE` and the Up next basis line. Both are optional, as before.

## Legitimately empty (unchanged, rechecked)
- `Not checked` with no planned load, for exercises without equipment at the gym.
- Short Progress windows (the data ends 8 Oct).
- Time in gym `—` (FitNotes has no times).
- PG30 records from in-app workouts only.

## Spec issues
1. **The tie rule built is no longer the D3 wording Ben is reviewing.** D3 says "working load = the load with the most sets, ties to the easier". The code (r4 B1) sends ties of **2 or more** sets to the *harder* load, and only single-set ties to the easier. ADR 0016 records this, but D3's text should be updated before Ben confirms it. Ben should also see what it costs:
   - Two top sets plus two back-offs (`22×5 ×2, 18×9 ×2`) is now judged at 22. On an 8–10 rule that holds after a miss, and after two sessions reduces to 17.5, below the back-offs.
   - That shape is in **0** of Ben's current targets. Equal-count finishers and burnouts, which the rule fixes, are more common.
   - Pyramids with one set per load still tie to the easiest (S2).
2. **Increasing from a pyramid's hardest set plans every judged set at or above it.** `24×10, 20×10, 16×10` plans 3 sets above 24. On the default rule with its 10% cap, and with 24 not on the rack, it plans 3 × 22.5 for 11 reps. So Ben is asked for 3 sets near a load he did once. This is what r4 asked for ("never below a load Ben did at the top"). Ben should confirm it, or choose to hold at the hardest load with the pyramid's set count. Real data: 1 current target (2 sets, about 10% up).
3. **Open 2 / S3.** The set-count floor and the "required" count should be settled together. 16 of 45 current targets depend on the answer.
4. **PG30 / O-PG1** is still open. An imported-only exercise still reads `Records start after 3 logged sessions.`
