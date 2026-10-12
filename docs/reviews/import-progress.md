# Review: imported FitNotes history in progressions (`claude/import-progress`)

Reviewer, 12 Oct 2026. Diff: `claude/gracious-knuth-joxqpw...claude/import-progress` (3 commits, 39 files).
Trigger: Ben, build 131: "The imported data doesn't show up in progressions etc I don't think."

## Verdict: CHANGES NEEDED

The diagnosis is right, and most of the wiring is good. The import writes complete rows, and Progress, the calendar, exercise detail and the coach's read tools already read them. The real gap was B7 (approved 11 Oct) not being built, and this branch builds it, labelled `FitNotes` everywhere. Typecheck, lint and the full suite pass.

Re-running the real-file probe found that the new reading of FitNotes sets produces unsafe targets on Ben's actual data. The most visible one is that Today's **Up next** now starts from his last FitNotes workout and plans **every set of it at the top-set load**. That case is untested.

## Checks run

- `npm run typecheck`: pass. `npm run lint`: pass. `npx vitest run`: 272 files and 5165 tests pass (1 file skipped: my local probe, which needs an env var).
- Local probe (`apps/mobile/test/zz-local-review-probe.test.ts`) imported both of Ben's files from env-var paths. It was deleted afterwards, and `git status` was clean before this file was added. Below, counts only; no names, numbers or dates from his files.
  - Both imports commit: 150 + 17 workouts, and every row is imported. Progress windows 7/14/30/60 days give 3/4/7/8 sessions (genuine: the data ends 8 Oct). Time in gym honestly shows `—`. 47 exercises have history.
  - Adding each exercise to a workout: 45/47 show `Last (FitNotes, …)`. 41 get a planned load; 6 get none (5 have no equipment at the gym preset, which is correct per B7/rule 4).
  - 9/47 exercise-detail charts are empty on `All`. All 9 are genuine: the default metric is Est. 1RM, and those exercises have no sets of 10 reps or fewer (`no_eligible`, with the message shown). They are not bugs.
  - Start next from the 3 newest imported workouts: see B1.
  - Shape of Ben's FitNotes sessions (both files, 449 exercise-sessions). 75% have sets lighter than the session's heaviest load. **38% have lighter sets after the heaviest set**, which means back-off sets or descending pyramids, not warm-ups. 20% have a single heaviest set with 3 or more sets in total.
- Privacy grep of the diff's added lines against Ben's exercise names and dates. No row of his files appears. The two exercise names used in the synthetic test are FitNotes' stock library names, and the numbers are invented. See N3 about the dates.
- No migration in this diff. Persistence changes are read queries only (`listRepeatableIds`, `listPastWorkoutIds`, `categoriesBySession`), owner-scoped and filtered with `inHistorySql`. `TargetBasis.imported` is optional, so stored rows and backups made before this change still decode.

## Blocking

### B1. Start next / Up next from a FitNotes workout plans every set, ramp and back-offs included, at the top-set load
`packages/domain/src/session/gym-switch.ts:150` (`workingSets: done.reduce(...)`) and `:178`, `apps/mobile/src/services/workout-services.ts:1289-1292` (`nextTargetsForBlock(..., count: 'done', fitLater)`), `packages/domain/src/progression.ts:100-114` (`comparableSetsOf`).

The block's set count comes from all of the source workout's completed sets, and every imported set is `working`. The load comes from `comparableSetsOf`, which keeps only the heaviest sets. Together, a FitNotes session is planned as N × top load.

**Probe, real data.** Ben's newest imported workout is a typical ramp, then a single heavy set, then back-offs: 7 sets with one set at the heaviest load. **Start next** planned **7 working sets at that top load, 3–6 reps**. The source workout has exactly 1 set at that load, for 4 reps. Another of the three newest workouts produced the same 7 × top-load plan for a different lift. This is what Today's `Up next` now offers first: `resolveNext` and `candidates(1)` at `workout-services.ts:1638,1657` now pick the newest workout, which for Ben is imported. One tap on Start gives this plan.

Rule 4 is satisfied (the loads are achievable), but the deterministic guardrail fails its purpose (rule 3): the plan is far beyond anything recorded. The synthetic test only covers a 2-set, equal-load pulldown (`import-progress.test.ts:139-150`), so this is untested.

**Fix:**
- For imported sources, take the set count from the same reading as the load. Use the number of sets `comparableSetsOf` keeps, with a floor of the rule's default working sets, or read the working block as in B2.
- Add a test with a ramp, then a top single, then back-offs, through Start next, Up next preview and Repeat.

### B2. The ramp heuristic reads back-off sets as warm-ups, so `Last`, the set count and the targets come from one heavy set
`packages/domain/src/progression.ts:100-114`, used by `lastComparableSession` (`session/active-view.ts:62-63`), `planFor` (`workout-services.ts:1237`, `workingSets: previous.sets…length`), `comparableSessions`, `overview.ts:138`, `target-why.ts:205`, `target-provenance.ts:74`.

"Only the sets at the heaviest load are working; everything lighter is a warm-up" is wrong for 38% of Ben's real FitNotes sessions. In those, the lighter sets come after the top set. The findings doc admits this ("A pyramid done top set first would also be read this way"), but ships it as the default, unapproved ("Provisional, Ben to confirm").

Consequences in the probe:
- **Add exercise** plans **1 working set** for every exercise whose last FitNotes session had a single top set. There are 7 such cases among the 41 loaded exercises, e.g. "1 × top load for 8–12 reps" after a top set of 4 reps.
- `Last (FitNotes, 8 Oct)` shows one set and hides the back-off work Ben actually did.
- `Why?` tells him his back-off sets "were read as warm-ups" (`progression.ts:381`). That is untrue for back-offs, and an explanation of a rule in the UI.
- The Summary comparison and Overview `LAST` compare an in-app workout against that single heavy set, so the change marker reads as a drop when he does his normal working sets.

This is a new reading of Ben's data that determines his targets, and it has not been approved (CLAUDE.md: flag it, don't pick silently).

**Fix:** only drop sets that come before the heaviest set and are lighter than it (a leading ramp). Keep lighter sets after the top as working sets (back-offs). Alternatively, pick the "working block" as the load with the most sets in the session, with ties going to the heavier load. Whichever reading is chosen, `planFor`'s set count must not fall below the rule's default because of it, and the reading needs Ben's sign-off before it decides targets. Add domain tests for a top-then-back-off session and a descending pyramid.

## Should fix

### S1. Up next now repeats the workout Ben just did
`workout-services.ts:1657`. Decision 2 (longest gap) was approved on 11 Oct but isn't wired. The D19 fallback, "newest workout", now resolves to his newest FitNotes workout. Before, imports were excluded, so this did not happen. Right after importing, Up next offers the workout he did most recently, which combines with B1. Wire Decision 2, or at least don't let the fallback pick the newest workout, before shipping B7's "repeatable" to Up next.

### S2. The pain chips from Today still read only in-app workouts
`apps/mobile/src/coach/coach-service.ts:1295`, `packages/persistence/src/sessions.ts:798-803`. `painChoices` with a general entry takes "the last workout" from `listFinishedRefs`, which is still `source = 'manual'`. When Ben's only history is imported, mentioning pain from Today offers no movements from his last workout. This history consumer was missed. The fix is a separate `listFinishedRefs` variant that includes imports, used here only. The rotation and pace callers keep the manual-only list.

### S3. The lift highlight mixes equipment once the newest point is imported
`packages/domain/src/session/lift-highlight.ts:75-76`. `anyItem` is true for **every** session when the newest one is imported. In-app sessions on different items (for example a barbell and a Smith machine, both `total`/kg) are then charted together in one sparkline and `change`. Relax only the equipment match against imported sessions. App-to-app pairs should still require the same `equipmentId`.

### S4. The tests don't cover the shapes Ben's data actually has
`apps/mobile/test/import-progress.test.ts`, `packages/domain/test/history.test.ts`. Missing:
- back-off and descending-pyramid sessions (B1, B2);
- the set count from Start next and Add exercise for imported sources;
- Up next's plan when the newest workout is imported (S1);
- the lift highlight with mixed app equipment (S3).

## Nits

### N1. Stale comment in `pain-sheet.ts`
`packages/domain/src/session/pain-sheet.ts:77`. `anchorFromHistory` takes the *first* loaded set's convention. On an imported ramp, that is a warm-up set. It's harmless today, because it only decides unit and convention, but the comment says "decides comparability". If the latest workout is imported (`equipmentId: null`), `Since` can't match later in-app sessions that have equipment.

### N2. Empty exercise detail on the default metric
For 9 of the 47 imported exercises, exercise detail opens on Est. 1RM, which shows `No sets of 10 reps or fewer`. It would be better to open on `Top set` when e1RM has no eligible sets. This is pre-existing and related to Open item 3 in the findings doc.

### N3. Synthetic data mirrors real dates
`import-progress.test.ts:22-37` and `import-progress-findings.md` mirror Ben's real last two workout dates and data end date (6 and 8 Oct, "data ends Thu 8 Oct"). This is not sensitive, but the brief said no excerpts. Shift the synthetic dates.

### N4. `countImportedFinished` is now dead code
`countImportedFinished` (`sessions.ts:848`) has no production caller left; only tests use it. Its doc comment says it is used for "Data & backup counts", which isn't true. Remove it, or fix the comment.

## Legitimately empty (confirmed, not bugs)
- Short windows (data ends 8 Oct).
- Time in gym `—` (FitNotes has no times; rule 6).
- e1RM charts with no ≤10-rep sets.
- Exercises with no equipment at the gym get no load (B7/rule 4).
- Progress records (PG30) from in-app workouts only; see Spec issues.
- Return-to-load: no consumer is built yet (R1–R6 approved, unbuilt), so imports neither feed it nor break it.

## Spec issues
1. **PG30 / O-PG1.** Ben's complaint was "progressions etc". Under the approved spec, the Progress records/PR list and the in-workout set record still ignore FitNotes history. An imported-only exercise reads `Records start after 3 logged sessions.` Ben will likely see that as the same bug. He needs to decide O-PG1 (FitNotes records, labelled).
2. **The ramp reading (B2)** needs Ben's decision before it drives targets. Options:
   - (a) leading lighter sets only;
   - (b) the working block (the load with the most sets);
   - (c) all sets, as stored.
   Record the decision in the CHANGELOG and ADR 0016.
3. **B7's "repeatable"** didn't say how a FitNotes workout's ramp and back-offs become a plan. Repeat as done (snapped) and Start next (progressed) need an explicit rule for imported sessions.
