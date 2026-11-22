# Review r2: imported FitNotes history in progressions (`claude/import-progress`)

Reviewer, 13 Oct 2026. Diff: `claude/gracious-knuth-joxqpw...claude/import-progress` (9 commits, 48 files). This round covers the fix commits `0bf4eae..5e71605`, which respond to `import-progress.md`.
Trigger: Ben, build 131: "The imported data doesn't show up in progressions etc I don't think."

## Verdict: CHANGES NEEDED

Round 1's blockers are fixed, and the fixes are correct:
- **B1** (every set planned at the top load) and **B2** (back-off sets read as warm-ups) are fixed. Only a leading ramp is dropped now. The set count uses the same reading as the load.
- Decision 2 is wired (S1).
- The pain chips include FitNotes workouts (S2).
- The lift highlight no longer mixes app items (S3).
- The pain-sheet anchor is fixed (N1), and the dead code is removed (N4).

On Ben's real files, Start next no longer plans a ramp at the top load. Up next is now the third-newest workout, not the one he just did, and the picker agrees with it.

One problem remains blocking. Reading (a) keeps Ben's heavy top single as a working set. The double-progression rule then judges every kept set against the rep range, so that low-rep single counts as a "miss" at the back-off load. The result is that lifts where Ben hit the top of the range on every back-off set are held, not progressed. Given two such FitNotes sessions in a row, the rule cuts the load and records a reason that isn't true. That is exactly "doesn't show up in progressions", now with a misleading `Why?`.

## Checks run

- `npm run typecheck`: pass. `npm run lint`: pass. `npx vitest run`: 273 files, 5189 tests passed, 1 todo.
- **Local probe with Ben's two files.** The env-var paths were read at runtime by `apps/mobile/test/zz-local-*.test.ts` files. All probe files were deleted afterwards, and `git status` was clean before this file was added. Only counts are reported here.
  - Both imports commit, and Past workouts lists 167 workouts.
  - I ran **Start next** from each of the 80 newest imported workouts: 222 exercise blocks. Rule decisions: `hold` 164, `increase_load` 44, `hold_after_miss` 14, `reduce_load` 0.
    - In 13 of the 14 `hold_after_miss` blocks, the only sets below the rep floor were heavier than the back-off load the rule plans from.
    - In 7 of those 13, every set at the planned load reached the top of the range, so the rule would otherwise have progressed. Blocks repeat across workouts, because each block reads the exercise's full history.
  - **Up next** starts from the 3rd-newest workout (4 exercises), not the newest. The picker's `UP NEXT` has the same source.
- **Privacy.** I grepped the added lines of the diff for every exercise name and date in Ben's files.
  - No row of his files appears.
  - Four names matched. Three are FitNotes stock names used in the synthetic CSV. The fourth is the app catalogue's own name, `Dumbbell bench press`, which also appears in pre-existing tests.
  - Three dates matched. They are synthetic fixture days, plus the data end date already quoted in the round-1 review. No numbers from his files appear.
- **No migration in this diff.** The persistence changes are read queries only:
  - `listFinishedRefs(…, { includeImported })` and `categoriesBySession`. Both are owner-scoped, filtered by `inHistorySql`, and count only `completed` sets.
  - `countImportedFinished` is removed and has no callers.
  - `TargetBasis.imported` is optional, so older rows and backups still decode.
- **Rules 2, 5, 10.** No completed set is modified: the readings happen at read time only. Start next and Up next use the existing idempotent start path, with `opId` and `expectedPreviewKey`. Category cells are read from Ben's own `import_rows`, which is Your data and owner-scoped.

## Blocking

### B1. A top single in a FitNotes session counts as a rep miss at the back-off load: progression stalls, and two sessions trigger a reduction with a false reason
`packages/domain/src/progression.ts:370-397`:
- `load: easiest` is the lightest kept set, which is the back-off load.
- `anyBelowFloor` and `allHitTop` are computed over **all** kept sets, including the heavier top single.

`progression.ts:700-712` then applies the streak and reduction logic. It writes the fact `${streak} sessions in a row fell below ${min} reps at ${lastText}`, where `lastText` is the back-off load.

Since round 1, `comparableSetsOf` (`progression.ts:103-123`) correctly keeps the top set and the back-offs. But the double-progression rule treats that mixed block as one load. It plans at the easiest load, and judges misses and top-of-range on sets at other loads. Ben's typical FitNotes pattern is a ramp, a heavy single or triple well below any default rep floor, then back-offs in range. On that pattern:
- **Stall (real data).** Every set at the planned load hit the top of the range, yet the decision is `hold_after_miss`, "Repeat X for 8–10 reps". This happens in 7 of Ben's 222 probe blocks, and 13 of 14 `hold_after_miss` blocks were caused only by heavier sets.
- **False reduction (synthetic).** I ran two FitNotes sessions, each `40×10, 60×5, 80×3, 70×10, 70×10, 70×10` (default rule, 8–10 reps). The result was `reduce_load`, with the recorded fact "2 sessions in a row fell below 8 reps at 70 kg". Every set at 70 kg was 10 reps. This is an untrue reason recorded with a target (rule 3) and a claim about Ben's training that the data doesn't support (rule 6).

The existing test enshrines the stall. `packages/domain/test/fitnotes-reading.test.ts:77-82` expects `hold_after_miss` for back-offs at `17.5 × 10` with a range of 8–10.

**Fix.** For imported sessions, judge `allHitTop`, `anyBelowFloor`, `minReps` and the effort check on the sets at the reference load (`easiest`). Sets heavier than that are top sets: they are context, not misses at the back-off load. The text in the facts must then name the load the miss was actually at.

An alternative is to read the top set and the back-offs as a top-set/back-off structure. That is a rule change and needs Ben (see Spec issues 1).

Tests to add:
- In-range back-offs after a low-rep top single give `increase_load`, not `hold_after_miss`.
- Two such sessions in a row never give `reduce_load`.
- A genuine miss at the back-off load still holds, and still reduces after two sessions.

## Should fix

### S1. `Why?` on Start next or Up next from a FitNotes workout says the load wasn't checked against equipment, even when it was fitted
- `packages/domain/src/progression.ts:786-813`: with `fitLater`, `equipment` is null, so `loadFeasibility` is `'unchecked'`.
- `packages/domain/src/target-provenance.ts:177` then records the guard note "Not checked against equipment: this exercise has no equipment set up at this gym."
- `packages/domain/src/session/repeat.ts:403` keeps that note and appends the fit's note.

In the probe, every Start next set from a FitNotes source carried the "Not checked … no equipment set up at this gym" note. That includes sets on exercises the gym *does* map. Some sets carry it next to "Rounded to 20 kg stack, the nearest easier load this stack makes", which contradicts it. `target-why.ts:253` shows every guard note. So `Why?` gives a wrong reason for a target (rule 3).

**Fix.** When the target is made with `fitLater`, don't record the unchecked note: the fit's note, or none if the fit was exact, is the equipment explanation. Or have `repeat.ts` replace the rule's equipment notes with the fit's note, as `refitProvenance` already does after a gym switch. Add a test that Start next from a FitNotes workout onto a mapped item has no "Not checked" line in `explainTarget`.

### S2. The tests don't cover how the rule judges the mixed block that reading (a) produces
`packages/domain/test/fitnotes-reading.test.ts`, `apps/mobile/test/import-progress.test.ts`. The round-1 shapes are now tested: a ramp, a top single with back-offs, and pyramids, through Start next, Up next, Repeat and Add exercise. These cases are still missing:
- the decisions in B1: two sessions in a row, and in-range back-offs that should progress;
- the provenance in S1;
- Up next when the newest workout is an in-app routine session and the rotation can't apply (an archived routine). The only coverage is the domain-level `longestGapSource` test.

## Nits

### N1. Up next's basis line doesn't say why it was chosen
`apps/mobile/src/services/workout-services.ts:1661-1666`. Decision 2 now picks the longest gap, but the card still reads D19's `From <date>`. That is true, but it doesn't match session-picker §2.3 (`UP NEXT · LAST DONE …`). The findings doc lists this as Open 5. It's fine to ship, but Ben may read the change as Up next "going backwards" to an older workout.

### N2. `importedWorkingSetCount` caps at 10 silently
`packages/domain/src/progression.ts:134`. A FitNotes session with more than 10 kept sets plans 10. This is consistent with the rule's own cap, but `workingSetsFromPrevious` doesn't cap in-app counts. It's harmless; a short comment on why imported counts are capped and logged ones aren't would help.

## Legitimately empty (unchanged from round 1, rechecked)
- Short Progress windows (the data ends 8 Oct).
- Time in gym `—` (FitNotes has no times).
- e1RM charts with no sets of 10 reps or fewer.
- No planned load for exercises with no equipment at the gym, outside `fitLater`.
- PG30 records from in-app workouts only.
- Return-to-load has no consumer yet.

## Spec issues
1. **Reading (a) is still provisional, and it leaves a modelling gap.** ADR 0016 and the findings ask Ben to confirm the ramp reading. B1 shows the reading isn't enough on its own. Ben's FitNotes lifts are mostly "top single, then back-offs", and the default double-progression rule has no notion of that. Ben needs to decide how such a session is judged:
   - (i) on the back-off sets only, with the top set as context;
   - (ii) as `top_set_backoff`, with the top set progressed separately;
   - (iii) as a single block (today's behaviour: it stalls).
   Record the answer in the CHANGELOG and ADR 0016.
2. **Set-count floor (findings Open 2).** A ramp, then 1–2 sets at the top load, plans 3 sets at that load. In the probe, roughly 1 in 5 `hold` blocks plan more sets at the held load than the source workout had at or above it. Most of those are one extra set where Ben did 2. The figure is approximate: it is measured against the source workout, while the rule reads the newest history. Round 1 asked for the floor, so this is a product choice for Ben, not a code defect.
3. **PG30 / O-PG1** is still open. An imported-only exercise still reads `Records start after 3 logged sessions.`, which Ben may count as part of "progressions etc".
