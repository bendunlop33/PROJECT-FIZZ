VERDICT: PASS

# Review r2: merge of main into the Workouts library (claude/workout-library)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/workout-library` at `84e3c41` against `claude/gracious-knuth-joxqpw` (`c653dc6`). This round covers the five commits after review r1 (`ec3d3ff`, [workout-library-merge.md](workout-library-merge.md)):

- `7a817eb`: second merge of main (workout Table), library components renumbered §9.81–9.87 (r1 B1)
- `46d3a59`: coach structural Apply is all-or-nothing and keeps added exercises (r1 B2)
- `c5b6c14`: Save to Workouts lists the distance exercises it leaves out (r1 S1)
- `943ce10`: only the coach's own target RPE goes with its load (r1 S2)
- `84e3c41`: timing-budget tests run in their own vitest project (r1 S3)

I re-read the r1 scope too: migration 12, feature parity, library ↔ picker, target RPE, coach structural proposals, workout gaps, Ben's decisions, rules 1–10 and minimal copy.

## Checks run (in /home/user/wt-library)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (exit 0, no output) |
| `npx vitest run --testTimeout=180000` | **262 files, 4861 passed, 1 todo, 0 failed** (464 s). The perf project ran after the unit project, one file at a time, and nothing flaked. |
| `npm run check:migrations` | `Migrations OK: 1 to 12, none reserved or empty.` |
| `git merge-base --is-ancestor claude/gracious-knuth-joxqpw HEAD` | true: main is fully in the branch |
| `git merge-tree --write-tree HEAD claude/gracious-knuth-joxqpw` | clean, no conflicts |
| `git diff --diff-filter=D claude/gracious-knuth-joxqpw HEAD` | empty: no file from main is deleted |
| Throwaway domain probe (not committed, removed from the tree) | Ben adds an exercise and moves it to the top, then a coach `order` is applied. The added slot goes from index 0 to index 5 of 6. See **S1**. |

## r1 findings: status

| r1 | Status | Evidence |
|---|---|---|
| B1: branch behind main, design-system numbers clash | **Fixed** | Main is an ancestor and nothing is deleted. Table components are at §9.74–9.80 and library components at §9.81–9.87 (`design-system.md:1073-1085`). The §11 index (`:1142-1147`) and the revision note (`:33`) are updated. No library component is cited as §9.74–9.80 anywhere in `docs/` or `apps/`. The combined code typechecks, lints and passes the full suite. The merge commit's only hand edit in code is the `fit.tsx` comment. |
| B2: coach reorder refused and half-applied after an add | **Fixed** | `today-edits.ts:329-331` appends live added keys that are missing from an `order`. `writeDraft` (`workout-services.ts:3293+`) takes several steps, each with its own op ID, and makes one versioned save or none. `editBatch` (`:3650`) runs `edit`'s swap checks. `applyCoachChanges` (`app-services.ts:551-562`) writes one batch per Apply. Tests: `coach-structural-library.test.ts`, where an add then remove + reorder gives `coachRefused 0` and a second load writes nothing, and a refused swap leaves no partial skip, with the version unchanged. Also `today-edits-full.test.ts` (normalisation, and an unknown or missing planned slot is still refused). |
| S1: Save to Workouts drops distance exercises silently | **Fixed** | `isDistanceSet` (`routines.ts:121`) is used in both builders (`routines.ts:187`, `library.ts:392`). `notSavedFromSession` and `notSavedFromPlan` feed `saveSource.notSaved`, which the sheet shows under the summary in Repeat's `notCopiedText` wording. All three entry points (Repeat, Past workouts, Workouts) go through `useSaveToWorkouts`. Domain and service tests cover distance-only sets, distance + time sets, and the Repeat merge. routines.md §A2.5 is updated. |
| S2: built-in RPE overwrote the template's RPE | **Fixed** | `withCoachTargets` now carries `coach.rpe` (`next-session.ts:353`). `routineTemplatesWithTargets` reads only `meta?.rpe` (`routines.ts:553`). A started set's `planned.rpe` comes from the template, and `ruleOf` gives provenance only (`routines.ts:478-488`), so the built-in fallback RPE can't come back in at Start. The test covers template RPE 7 with a built-in plan at RPE 8 and no coach RPE (keeps 7), and a coach RPE of 9 (uses 9, RIR null). |
| S3: perf flake masks real failures | **Fixed** | `vitest.config.ts` has a `unit` project and a `perf` project (`groupOrder 1`, forks, `maxWorkers 1`). All 262 test files are still collected. CI's `npm run check` and the `test:perf:jitless` script still work. |
| N1–N3 | Open (nits, not required) | No pointer in the migration-12 describe to the 10→12 schema-dump test. No swap-with-Ben's-sets/reps coach test. |

## Migration 12: numbering and in-place safety (OK, unchanged since r1)

None of the five commits touches `packages/persistence/src/schema/` or `migration-list.ts`. Main's 1–11 are byte-identical and 12 is `today-fit`. The in-place tests (`drafts.test.ts:583`, `:641`; `deleted-workouts-edges.test.ts` 8/9/10→12) pass. No `[ios-build]` commit exists on the branch, so no device carries a different numbering.

## Blocking

None.

## Should fix

**S1. A coach reorder moves an exercise Ben added and placed himself to the end of today's plan, and the card doesn't show it.**
- Code: `packages/domain/src/session/today-edits.ts:330-331`. `slotKeys = [...e.slotKeys, ...addedNow.filter(k => !e.slotKeys.includes(k))]` always appends added keys at the end. The previous `order` edit, which held Ben's placement, is then replaced (`remove(prev.editId, 'replaced')`).
- Failure scenario (reproduced with a domain probe): Ben opens next Push A, adds Face pull, and moves it to the top in Edit mode. Later he asks the coach to "do laterals first" and taps Apply. On the next overview load, Face pull is last (index 0 → 5 of 6). The coach card's before/after lists only the routine's exercises, so it never says that Ben's own placement changed. This is today's plan, not a completed set, and the coach card's Undo puts it back, so it isn't blocking. But Ben's explicit edit is changed without being shown, which goes against the spirit of rule 2.
- Fix: when a previous live `order` exists, keep each added key at its position relative to the planned slot it followed in that order. Only append added keys that have no earlier placement. Add a domain test: add, Ben's order with the added slot first, then a coach order. The added slot stays ahead of the planned slot it preceded. Add a service variant in `coach-structural-library.test.ts`.

**S2. A once-refused coach Apply lands later without a new tap.**
- Code: `apps/mobile/src/services/app-services.ts:538-568`. Every overview load retries unwritten applies. The second B2 test (`coach-structural-library.test.ts`, "one change refused here") locks this in: the card reads `Couldn't apply here`, then Ben removes his own add, and the whole Apply (swap + skip) appears in today's plan on the next load.
- Scenario: Ben sees `Couldn't apply here` and moves on. An hour later he undoes an unrelated add, and the coach's swap and skip appear in his plan. The only notice is the card state flipping back, which he may never revisit. Rule 2's Apply was given once, for a state that has since changed. This behaviour predates this round (r1's review S1 design), but B2 made it all-or-nothing and the new test now pins it down.
- Fix: decide it in the spec (see Spec issues). Either a refused Apply stays refused, and Ben re-asks or taps Apply again on the card, or the overview says once that the coach change applied when it lands later (the same one-shot pattern as `coachRefused`).

## Nits

**N1.** `workout-services.ts:3338`: `prune` is applied only when step 0 writes. If step 0 is a duplicate or unchanged and a later step writes, that save skips pruning. The next write prunes, so nothing is lost. Apply `prune` to the first step that writes.

**N2.** Repeat and Save disagree on distance + time sets. Repeat still copies a distance set that has a time as a timed set and lists only distance-only sets (`repeat.ts:163`). Save to Workouts now leaves both out (`routines.ts:121`). Each is honest, but `Repeat ›` and `Save to Workouts` on the same sled-push session now give different shapes. Align them, or note the difference in routines.md §A2.5.

**N3.** `isDistanceSet` treats any set with `distanceM` as a distance set, whatever the exercise's measurement. A `duration` exercise logged with a distance too (for example a FitNotes-imported row with time and metres) is now left out of a saved workout instead of saved as timed. It is listed honestly. Consider `ex.measurement === 'distance'` alone, plus distance-only sets.

**N4.** r1 N1 and N3 are still open (a migration-12 pointer to the 10→12 schema-dump test, and a coach swap over Ben's `sets`/`reps` edit).

## Feature parity (no feature lost on either side)

- Main's workout Table (`WorkoutTable.tsx`, `table.ts`, `tile-fit.ts`, `table-view.ts`, their tests, `workout-table.md`, reviews r1–r3) is in the branch. `WorkoutScreen.tsx`, `active-view.ts`, `workout-services.ts` and `domain/src/index.ts` auto-merged and are covered by the passing suite (`workout-table.test.ts`, `table-view.test.ts`, `tile-fit.test.ts`).
- The library side is unchanged from r1 apart from the fixes: picker sections `YOUR WORKOUTS` / `FROM HISTORY` / `OLDER`, the Summary and Past workouts `⋯` menu, edit before start, fit to time, and coach structural changes through the change-review card.
- Workout gaps × library: deleted and discarded workouts stay out of save sources (`isInHistory`). Distance sets are now listed on Save (r1 S1).

## Rules 1–10 and minimal copy

- **Rule 1:** no network path was added. The built-in trim, `Clear fit` and all draft writes are local. The coach-refused state stays honest.
- **Rule 2:** completed sets are untouched. A coach structural Apply is now one atomic draft write with one Undo (B2 fixed). See S1 and S2 for the two remaining edges.
- **Rule 3:** WL7 is narrowed correctly. Only the coach's own RPE goes with its load (S2 fixed).
- **Rules 4 and 9:** `editBatch` re-runs `swapAllowed` and `ensureExercise` per swap. The fit and structural guards are unchanged.
- **Rule 5:** each batch step keeps its own op ID. A retry whose steps are all in `opIds` reads as a duplicate. A version mismatch on a multi-step batch is `stale`, never a partial write. The final save is checked against the version the batch started from.
- **Rule 6:** `≈` minutes come from the one estimator, and no data is invented.
- **Rules 7, 8 and 10:** no credentials, imported content or data-domain changes in this round.
- **Minimal copy:** one new line, `Not copied: 1 distance set (Sled push)`, reuses Repeat's wording. Nothing explains the rule. `minimal-copy.test.ts` passes.

## Ben's decisions recorded

WL7, FT6 and N6 are in `docs/brief/CHANGELOG.md:181-184`, with notes in ADR 0006 and ADR 0022 (unchanged since r1). The S1 behaviour (distance exercises left out of a saved workout, listed) follows the existing Repeat precedent and is recorded in routines.md §A2.5 with the review as its source. It isn't a new product decision. As in r1, I can't verify Ben's consent from the repo; the record is consistent and cites its source.

## Spec issues

1. **What a refused coach Apply does later is unspecified** (S2). Neither overview-today-edits.md nor ADR 0020/0022 says whether `Couldn't apply here` is final or pending. Suggest Ben decides. The conservative option: refused stays refused until Ben taps Apply again on the card.
2. **Where an added exercise sits after a coach reorder is unspecified** (S1). overview-today-edits §11 should state that Ben's own placement of an added exercise survives a coach `order`.
3. Carried from r1: brief §7 still says `shortenSession` "proposes" (FT6 is resolved only in the CHANGELOG), and design-system numbers are still assigned per branch (this is the third renumber). Suggest a reserved block per branch, or named anchors.
