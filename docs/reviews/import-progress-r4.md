# Review r4: imported FitNotes history in progressions (`claude/import-progress`)

Reviewer, 13 Oct 2026. Diff: `claude/gracious-knuth-joxqpw...claude/import-progress` (16 commits, 50 files). This round covers `4714f6e` and `ec85e36`, which respond to `import-progress-r3.md`.
Trigger: Ben, build 131: "The imported data doesn't show up in progressions etc I don't think."

## Verdict: CHANGES NEEDED

Round 3's findings are fixed as written:
- **r3 B1** is fixed for the shapes it named. `readFitNotesWorkingSets` picks the kept load with the most sets (ties to the easiest).
  - Working sets plus a lighter finisher now increase from the working load.
  - A miss at the working load holds, and after two sessions reduces "at W".
  - A top single plus back-offs still progresses from the back-off load.
  - The up-and-down pyramid is no longer *increased* from its tail.
  - All four tests the review asked for are in `fitnotes-reading.test.ts:250-321` and `import-progress.test.ts`.
- **r3 S1** is fixed. Only judged sets make up `prescribedDone` (`progression.ts:494`) and the planned count (`fitNotesJudgedCount` in `active-view.ts:97` and `gym-switch.ts:149`). One heavy set plus one back-off no longer increases under a 3-set rule. The choice is recorded in ADR 0016.
- **r3 N1** is fixed: assisted loads say "less-assisted" and "more-assisted".
- r3 N2 (string-matched `UNCHECKED_NOTE`) and N3 (Up next basis line) are still open. Both are optional.

The tie-break leaves one case of the r3 B1 failure. When the working load and a lighter load have the **same** number of sets, the rule reads every set and plans from the lighter one. It then says "Increase" to a load below one Ben already did at the top of the range (B1). This happens in Ben's real data. A second shape, working sets followed by one heavier set, is read the wrong way round (S1).

## Checks run

- `npm run typecheck`: pass. `npm run lint`: pass.
- `npx vitest run --maxWorkers=2`: see the last line of this section.
- **Synthetic probe.** A throwaway `packages/domain/test/zz-local-r4.test.ts` ran the default rule (8–10 reps, 3 sets, dumbbells) on 12 shapes, once and twice in a row. The results are in the findings below. The file was deleted.
- **Local probe with Ben's two files.** The paths were passed in by env var and read at runtime by a throwaway `apps/mobile/test/zz-local-r4.test.ts`, which was deleted. Only counts and ratios are reported here.
  - Both imports commit (150 + 17 workouts), and Past workouts lists 167.
  - Start next from every imported workout gives 448 exercise blocks (each started and then discarded). Rule decisions: `hold` 361, `increase_load` 66, `hold_after_miss` 20, `increase_reps` 1, `reduce_load` 0.
  - These come to **47 distinct current targets**: `hold` 28, `increase_load` 16, `hold_after_miss` 2, `increase_reps` 1. This matches the developer's findings item 9.
  - 49 blocks carry the `Not checked` note. All 49 have **no planned load** and no equipment at the test gym (exercises the commercial preset doesn't cover), so the note is correct. No fitted set carries it, so r2 S1 still holds.
  - 5 of the 16 increases rest on one judged set. Each is a FitNotes session with only one set, planned as one set (Open 2). None comes from a context set filling the count, so r3 S1 holds.
  - 6 current targets hit the tie fact ("No load had most of the sets…"). **1 of them is `increase_load` planned at 80% of a load Ben did for top-of-range reps in the same session** (B1).
  - **2 current targets** have 2–3 sets at one load followed by one heavier set. Both plan 3 sets at the heavier load (one at +13%). Both say "Only 1 of 3 working sets was logged" (S1).
  - 13 current targets say "Only N of 3 working sets was/were **logged**". In at least 10 of them the FitNotes session had more sets than N (S1).
  - Planned set counts: 1 set ×5, 2 ×9, 3 ×27, 4 ×6. None exceeds what was done.
- **Privacy.** Neither the synthetic shapes nor this file contain any row, name, date or number from Ben's files. `git status` was clean apart from this file.
- **No migration in this round.** `4714f6e` changes domain reading only. Stored sets are untouched (rule 2), and the start path is unchanged: idempotent `opId` with `expectedPreviewKey` (rule 5). The persistence and schema changes from earlier rounds are unchanged (`TargetBasis.imported` is optional).
- **Rules 4, 9, 10.** Targets from FitNotes are still fitted to the gym's equipment (rounded toward easier, never above a max), and no load is prescribed when nothing is there to check against. Pain gating is unchanged. Category cells still come from owner-scoped `import_rows`.

Full suite, after deleting the throwaway files: 273 files, 5217 tests passed, 1 todo. (An earlier run that included the probe files reported 1 failure; that was the real-data probe, which had no file paths in that run.)

## Blocking

### B1. A tie between the working load and a lighter finisher plans from the finisher, and calls it "Increase" to a load below one Ben already did at the top of the range
`packages/domain/src/progression.ts:168-170` (tie to the easiest), `:179` (`contextOnly` is false on a tie), `:471` (`planLoad = reference`), and `:503` / `:776-781` (`allHitTop` over every judged set, including the harder ones).

When the kept loads have equal counts, the reference is the easiest. The harder sets are then judged as well (`harderJudged`), because they are not fewer. If every judged set reached the top of the range, the rule increases **from the easiest**, even though the harder sets also reached the top. It is r3 B1 again, with equal set counts.

Synthetic results, default rule:

| FitNotes session (kg each × reps) | Result | Expected |
|---|---|---|
| `20×10, 20×10, 12×15, 12×15` | `increase_load` → **4 × 15 kg**, "all 4 judged sets reached 10+ reps, the easiest at 12 kg" | increase from 20 (or at least never below 20) |
| `20×10 ×3, 12×15 ×3` (3 working + 3 burnout) | `increase_load` → **6 × 15 kg** | increase from 20, 3 sets |
| `24×10, 20×10, 16×10` (descending pyramid, all at the top) | `increase_load` from 16 (tested as intended at `fitnotes-reading.test.ts:102`) | at least the hardest load that reached the top |
| `20×8, 15×6, 10×6` ×3 (drop-set triplets) | `hold_after_miss` → **9 × 10 kg**; twice → `reduce_load` → 9 × 7.5 kg | never plan 9 sets at the last drop; never reduce from it |

In Ben's data, 1 of the 47 current targets is the first kind: "Increase", planned at 80% of the heaviest load in that session, all of which reached the top of the range.

This breaks:
- **Rule 3.** The recorded reason ("Increase") doesn't describe what happened: the plan is lighter than what Ben did.
- **Rule 6.** "Increase" is a claim the data contradicts.

It also contradicts ADR 0016's own text, "Lighter sets after it (a finisher or drop set) are never judged and never the planned load", for any finisher that has as many sets as the working load.

**Fix (pick one, then record it in ADR 0016):**
- (a) When `harderJudged` is non-empty and every judged set reached the top, plan the increase from the **hardest judged load**, not the reference. If only some reached the top, plan from the hardest load whose sets all did. It is one guard in `decidePrimary`, and it keeps the tie rule for hold and miss.
- (b) Break ties toward the load that comes **first** among the kept sets, i.e. the harder one, since `comparableSetsOf` starts at the hardest set. A tie of 1:1 still needs to go to the back-off load for r2 B1, so this probably needs "ties to the easiest only when the harder load has one set".

Whichever is chosen, never plan more working sets than the session had at the planned load. The drop-set triplets case plans 9.

Tests to add:
- 2 working sets plus 2 equal-count finisher sets at the top of the range: the plan is not below the working load.
- 3 + 3 burnout sets.
- Drop-set triplets: no 9-set plan, and no reduction from the last drop.
- Descending pyramid with every set at the top: the plan is not below the hardest set.

## Should fix

### S1. Working sets followed by one heavier set are read as a warm-up ramp: 3 sets are planned at the single heavier load, and `Why?` says they "were read as warm-ups" and that "1 of 3 working sets was logged"
`progression.ts:117-122` (`comparableSetsOf` keeps only the hardest set and what follows it), `:511`, and `:729-737` (the `logged` wording).

The most-sets reading runs only on the sets `comparableSetsOf` kept. Repeated sets at one load **before** a heavier final set are dropped as a ramp before the reading sees them:

| FitNotes session | Result |
|---|---|
| `20×10 ×3, 22.5×6` | `hold_after_miss` → 3 × 22.5. Twice → `reduce_load` to 20, "fell below 8 reps at 22.5". Facts: "its lighter sets before the top set were read as warm-ups" and "Only 1 of 3 working sets was logged". |
| `20×7 ×3, 22.5×4` (a miss at the working load) | `hold_after_miss` → **3 × 22.5**: a heavier plan after a miss at 20 |
| `12×12, 16×10, 20×8` (a real ascending ramp) | hold at 20, 3 sets (reading (a), as provisionally intended) |

The two misread shapes look the same as a ramp if you go by load alone. That is a spec question (Spec issue 1). Two parts are code problems whatever Ben decides:
- **The wording is false.** "Only 1 of 3 working sets was **logged** on <date>" is wrong when FitNotes has 4 sets. The `judged` branch (`:733`) is taken only when `judgedSets < loggedSets`, and `loggedSets` already excludes the dropped sets. For imported sessions, use "kept" or "judged" whenever `comparableSetsOf` dropped anything. On real data, at least 10 of the 13 "Only N … logged" facts are on sessions with more sets than N. Calling repeated sets at one load "warm-ups" is also a claim the data doesn't support (rule 6).
- **Safety.** After a miss (sets below the range), the rule should never plan a heavier load than the load where the miss was. Suggested guard: if any dropped set has as many reps as or more reps than the range floor, and at least 2 sets share its load, and that load has more sets than the hardest load, treat those sets as working sets (start the kept slice at that load's first set). Then the existing most-sets rule makes the heavier single context.

Real data: 2 of 47 current targets. Both hold 3 sets at the heavier single's load, one at +13% over the load of the 2–3 repeated sets.

Tests to add: both rows above, and a ramp with repeated empty-bar sets (`20×10, 20×10, 60×5, 80×3, 100×5`) that must still read as a ramp.

### S2. A top single plus 2 back-offs never progresses from FitNotes history
`progression.ts:729-734`. Under the default 3-set rule, `22.5×4, 17.5×10, 17.5×10` gives "Only 2 of 3 working sets were judged; holding", and does so every time. It still plans 3 sets at 17.5 (`importedWorkingSetCount` floors at 3). That is honest, and it resolves itself once Ben logs in the app. But "1 top + 2 back-offs" is a common FitNotes shape, so Ben will see "hold" on several lifts that he progressed. Decide this together with Open 2 (Spec issue 2): either require `min(required, judged session sets)` when the planned count is floored, or show the hold reason in the Summary. Already tested as intended (`fitnotes-reading.test.ts:329`). This needs a decision, not necessarily a code change.

## Nits

### N1. The tie fact can be false
`progression.ts:524` prints "No load had most of the sets…" whenever the harder sets are judged, which happens when there are at least as many of them as there are sets at the reference. With `22×8, 20×8, 18×8, 18×8`, 18 kg *has* the most sets (2), but the 2 harder sets aren't fewer, so the fact still says "No load had most of the sets". Word it from the counts instead, e.g. "The 2 heavier sets were judged too; the plan is from 18 kg each."

### N2. r3 N2 and N3 are still open
These are the string-matched `UNCHECKED_NOTE` and the Up next basis line. Both are optional, as before.

## Legitimately empty (unchanged, rechecked)
- `Not checked` with no planned load, for exercises without equipment at the gym.
- Short Progress windows (the data ends 8 Oct).
- Time in gym `—` (FitNotes has no times).
- PG30 records from in-app workouts only.

## Spec issues
1. **D3, "working load = the load with the most sets, ties to the easier", is ambiguous in two places, and Ben should see both before confirming it.**
   - **Over which sets?** Applied to the whole FitNotes session, it picks an empty bar used for 2 warm-up sets over a single top set. Applied only after the leading ramp is dropped (what is built), it misses working sets that come before a heavier final set (S1). Load alone can't separate these shapes. A rule that also uses reps or set counts (as in S1's guard) can.
   - **Ties.** "Ties to the easier" is right for a top single plus one back-off (r2 B1). It is wrong for working sets plus an equal number of finisher or drop sets, and for drop-set triplets (B1). Proposal: ties go to the easier load only when the harder load has a single set. Otherwise the harder load is the working load, and the lighter sets are finishers.
2. **Open 2 (set-count floor) and S2.** With the floor at 3 and only judged sets counting, a 1 + 2 shape holds for ever while planning 3 sets. Settle the floor and the "required" count together.
3. **PG30 / O-PG1** is still open. An imported-only exercise still reads `Records start after 3 logged sessions.`
