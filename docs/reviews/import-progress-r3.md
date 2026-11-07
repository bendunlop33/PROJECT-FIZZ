# Review r3: imported FitNotes history in progressions (`claude/import-progress`)

Reviewer, 13 Oct 2026. Diff: `claude/gracious-knuth-joxqpw...claude/import-progress` (13 commits, 49 files). This round covers the fix commits `de858d7..237de95`, which respond to `import-progress-r2.md`.
Trigger: Ben, build 131: "The imported data doesn't show up in progressions etc I don't think."

## Verdict: CHANGES NEEDED

Round 2's findings are addressed as written:
- **r2 B1** is fixed for the shape it described. A top single followed by in-range back-offs now progresses, and two such sessions never reduce. A real miss at the back-off load still holds, and still reduces after two sessions.
- **r2 S1** is fixed. No fitted Start next set says `Not checked` (0 of 448 probe blocks).
- **r2 S2** is fixed. The tests now cover two sessions in a row, lb, the miss and reduce paths, provenance, and Up next after a deleted routine.
- **r2 N2** is fixed (the cap comment).

The r2 fix has a new failure, though. The rule judges an imported session **only** on the sets at its lightest kept load, and every heavier set counts as "context". That works for one top set followed by back-offs. It's wrong for the other common FitNotes shape: several working sets at one load, then one lighter finisher or drop set. In that shape the single light set is the whole judgement. The rule ignores misses at the real working load, says "Increase", and plans *below* what Ben actually trained. This shows up in Ben's real data (B1).

## Checks run

- `npm run typecheck`: pass. `npm run lint`: pass. `npx vitest run`: 273 files, 5199 tests passed, 1 todo.
- **Local probe with Ben's two files.** The env-var paths were read at runtime by `apps/mobile/test/zz-local-probe-r3.test.ts`, plus a throwaway `packages/domain/test/zz-local-r3.test.ts` for synthetic cases. Both files were deleted, and `git status` was clean before this file was added. Only counts and normalised shapes are reported here.
  - Both imports commit, and Past workouts lists 167 workouts.
  - Start next from every imported workout produced 448 exercise blocks. Rule decisions: `hold` 301, `increase_load` 135, `hold_after_miss` 11, `increase_reps` 1, `reduce_load` 0.
  - Start next reads each exercise's full history, so those blocks reduce to **46 distinct current targets**: `hold` 26, `increase_load` 18, `hold_after_miss` 1, `increase_reps` 1.
  - **0** fitted sets carry the `Not checked` note.
  - In **7 of the 46** current targets, the latest session had more kept sets *heavier* than the judged load than at it. Those targets plan at **62–87%** of the load Ben did most of his sets at, and 3 of the 7 are labelled `increase_load`.
  - **6 of the 18** `increase_load` targets rest on a single judged set.
- **Privacy.** I grepped the added lines of the whole diff for every exercise name, date and row in Ben's files.
  - No row of his files appears.
  - Five names matched. Four are FitNotes stock names used in the synthetic CSV. The fifth, `Barbell row` in the new r2 S2 test, is the app catalogue's own name and already appears in pre-existing tests.
  - Three dates matched. They are synthetic fixture days, plus the data end date already quoted in round 1. No numbers from his files appear.
- **No migration in this diff.** The persistence changes are read queries only. They are owner-scoped, filtered by `inHistorySql`, and count only `completed` sets. `TargetBasis.imported` is optional, so older rows and backups still decode.
- **Rules 2, 5, 10.**
  - No completed set is modified: the readings happen at read time only.
  - Start next and Up next use the idempotent start path, with `opId` and `expectedPreviewKey`.
  - Category cells are read from Ben's owner-scoped `import_rows`, which is Your data.

## Blocking

### B1. One lighter set after the working sets decides the whole block: misses at the working load are ignored, and the plan is "Increase" to a load below what Ben trained
`packages/domain/src/progression.ts:374-385` (`easiest`, `judged`), `:405-415` (`load`, `allHitTop`, `anyBelowFloor`, `effortOk` from `judged`), and `:383-385, 419-423` (`topSetsAside`).

`comparableSetsOf` keeps the hardest set and everything after it. The rule then sets `load = easiest` and, since r3, judges reps only on the sets at `easiest`. Every heavier set is called a "top set kept as context", however many there are. For a FitNotes session that ends with one lighter finisher, the rule:
- ignores every rep at the real working load;
- progresses from the finisher's load;
- states that "every counted set reached 10+ reps", when that is one set.

These are synthetic cases, with the default rule (8–10 reps, 3 sets) on dumbbells:

| FitNotes session (kg each × reps) | Result | Expected |
|---|---|---|
| `20×10, 20×10, 20×10, 12×15` | `increase_load` → **3 × 15 kg**, "3 heavier top sets were kept as context; reps were judged on the sets at 12 kg" | increase from 20 |
| `20×7, 20×7, 20×7, 16×12` | `increase_load` → 3 × 17.5 kg | `hold_after_miss` at 20, and after two sessions `reduce_load` |
| `10×12, 16×8, 20×6, 16×8, 10×12` (the up-and-down pyramid already in `fitnotes-reading.test.ts:57`) | `increase_load` → 12.5 kg | judged at the working load, not the 10 kg tail |

These targets are within the equipment, so they are safe. But they are wrong, and the stated reason is misleading:
- Rule 3: the target is recorded with a reason that doesn't describe what happened.
- Rule 6: "Increase" and "3 heavier top sets" are claims about Ben's training that the data doesn't support.
- The second row also means a repeated miss at the working load can **never** trigger a reduction. That is the inverse of r2 B1.

On real data, 7 of 46 current targets have this shape, and they plan at 62–87% of Ben's working load. Ben will read that as the import "not showing up in progressions" again.

The same `calculateNextTargets` feeds every consumer:
- Add exercise;
- Start next and Up next;
- Summary `Next time`;
- the coach's `get_progression_targets`.

So all of them get the wrong target.

**Fix.** Pick the reference load so that heavier sets are treated as context only when they really are a top set:
- the reference is the kept load with the **most sets**;
- ties go to the easiest load, which keeps r2 B1's top single + back-offs and the descending-pyramid behaviour;
- sets heavier than the reference are context only when they are fewer than the sets at the reference; otherwise they are judged.

Sets *lighter* than the reference (a finisher or drop set) are never judged and never the planned load. The fact text should then count what it judged: "1 set" instead of "every counted set".

This is reading (b) from findings Open 1, applied to the kept sets. It needs Ben to confirm (Spec issues 1). The code must not ship with the single-finisher behaviour in either case.

Tests to add (in `fitnotes-reading.test.ts`, plus one end-to-end Start next):
- 3 sets at the top of the range at W, then one lighter finisher: increase from W.
- 3 sets below the floor at W, then a lighter finisher: `hold_after_miss` at W; two sessions give `reduce_load` "at W".
- The up-and-down pyramid is not planned from its lightest tail set.
- r2 B1's top single + 3 back-offs still progresses from the back-off load.

## Should fix

### S1. Heavier sets count toward "all prescribed sets done" but not toward the judgement, so one judged set can progress a 3-set rule
`progression.ts:406` sets `prescribedDone: counted.length`, which includes the context sets. `:642` sets `complete = prescribedDone >= required`.

With a top set and two back-offs, the rule treats `required = 3` as met, but judges 2 sets. With two heavier sets and one back-off, it judges 1 set. In the probe, 6 of 18 current `increase_load` targets rest on one judged set.

The planned count from `importedWorkingSetCount` also includes the context sets, so Ben is then asked for more sets at the new load than he did at the old one. A top single plus 3 back-offs plans 4 sets at the increased load.

**Fix.** After B1:
- for imported sessions, compute `prescribedDone` from the judged sets, or require at least `min(required, 2)` judged sets before `increase_load`;
- decide whether context sets count toward the planned set count, and record the choice in ADR 0016.

Add a test: one heavy set, then a single back-off at the top of the range, should not give `increase_load` under a 3-set rule.

## Nits

### N1. "heavier top set" is the wrong word on assisted loads
`progression.ts:422`. For assisted loads, `easiest` is the *most* assistance, so the "top sets" are lower numbers. Use "harder" (or, for assisted, "less assisted"), as `comparableSetsOf`'s comment already does. There is no assisted FitNotes block in Ben's data, but the import supports `assisted`.

### N2. `UNCHECKED_NOTE` is matched by string equality across modules
`session/repeat.ts:405`. This works, but any edit to the wording in `target-provenance.ts` keeps it in sync only because it is a shared constant. A `guardNotes` entry with a kind (`{ kind: 'unchecked' }`) would be sturdier. Optional.

### N3. r2 N1 is still open
Up next's basis line (`From <date>`) doesn't say it was the longest gap. This is listed as findings Open 5. Fine to ship.

## Legitimately empty (unchanged, rechecked)
- Short Progress windows (the data ends 8 Oct).
- Time in gym `—` (FitNotes has no times).
- e1RM charts with no sets of 10 reps or fewer.
- No planned load for exercises with no equipment at the gym, outside `fitLater`.
- PG30 records from in-app workouts only.
- Return-to-load has no consumer yet.

## Spec issues
1. **How a FitNotes session is read is still unconfirmed, and it now matters more.** Ben needs to decide two things, and the answers belong in the CHANGELOG and ADR 0016:
   - **The ramp reading (findings Open 1).** Option (a), leading ramp only, is provisional.
   - **Top set and back-offs (Open 8).** Option (i), back-offs judged with the top set as context, is provisional.
   B1 shows that (a) + (i) together mishandle a third shape, "working sets + finisher". The two open questions are really one: **which load is the working load of a FitNotes session**. The proposal is the load with the most kept sets (ties to the easiest), with a lone heavier set as context and lighter trailing sets ignored.
2. **Set-count floor (Open 2) and the context sets (S1)** both decide how many sets are planned at the new load. They should be settled together.
3. **PG30 / O-PG1** is still open. An imported-only exercise still reads `Records start after 3 logged sessions.`
