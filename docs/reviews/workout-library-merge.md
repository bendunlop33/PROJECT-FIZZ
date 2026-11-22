VERDICT: CHANGES NEEDED

# Review: merge of main into the Workouts library (claude/workout-library)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/workout-library` at `6e1e057` against `claude/gracious-knuth-joxqpw` (`c653dc6`). That covers the merge commit `78445e7` (parents `52ed94c` library slice C r2 and `7769841` main at the coach-tools merge), plus the three commits after it: `17d27c1` (target RPE in edit-before-start and fit), `5380c6b` (coach structural proposals via the change-review card) and `6e1e057` (Ben's decisions WL7, FT6, N6). I read every conflicted hunk with `git show --cc`. I checked them against routines.md Part A, overview-today-edits.md §11, fit-to-time.md, session-picker.md, ADR 0006, ADR 0022 and CLAUDE.md rules 1–10.

## Checks run (in /home/user/wt-library)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=180000` | 4765 passed, 1 todo, 1 failed: `apps/mobile/test/progress-perf.test.ts`, a timing budget under full-suite load. Re-run alone together with `packages/persistence/test/backup-perf.test.ts`: 2 files, 3 tests, all pass. The suite also listed one "failed file", which was my own throwaway probe. I deleted it while the run was collecting, so that failure is mine, not the branch's. |
| `npm run check:migrations` | `Migrations OK: 1 to 12, none reserved or empty.` |
| Throwaway probe (not committed, removed from the tree) | A coach remove + reorder Apply on Push A after Ben added an exercise to today's overview. Result: `coachRefused: 1`. Rows: Bench, Lateral, Triceps (skipped), Dumbbell bench (added). The skip was written, the order was refused. See **B2**. |
| `git merge-tree --write-tree HEAD claude/gracious-knuth-joxqpw` | `CONFLICT (content): docs/design/design-system.md`. See **B1**. |

## Migration 12: numbering and in-place safety (OK)

- `migration-list.ts:39-52`: the list is 1–11 from main, then `12 today-fit`. `git diff claude/gracious-knuth-joxqpw HEAD -- packages/persistence/src/schema/` only adds `0012-today-fit.ts`, so main's 1–11 are byte-identical.
- `0012-today-fit.ts`: the `coach_actions` rebuild has exactly migration 11's columns, CHECK kinds (`log_set`, `correct_set`, `suggest_memory` kept) plus `fit_today`, all four indexes and the no-delete trigger. Nothing references `coach_actions` by foreign key or view, so the drop-and-rename is safe. It is the same pattern as migrations 7 and 11.
- In-place tests: `drafts.test.ts:583-680` covers a populated schema-11 store (rows identical, old CHECK refuses `fit_today`, new one takes it, trigger and indexes present, integrity clean) and a raw schema-11 DB with every kind 11 added. `deleted-workouts-edges.test.ts` covers 8→12, 9→12 and 10→12 against a fresh database's schema. Backup restores from v1 and v4 migrate to `latestVersion()`.
- No device can be at "library 8". No commit on the branch carries `[ios-build]`, and the branch has no remote, so no `.ipa` with the old numbering was ever built.
- Start fence (`drafts.ts:843-851`): counting manual `sessions` rows plus manual `purged_sessions` tombstones is monotonic under delete and purge, because a purge removes a row and adds a tombstone. It is tested in `deleted-workouts-edges.test.ts:414+`.

## Blocking

**B1. The branch is behind main. Main's workout Table merge (`c653dc6`) isn't in it, and the two sides clash on design-system numbers.**
- Evidence: `git diff claude/gracious-knuth-joxqpw HEAD` shows `WorkoutTable.tsx`, `table.ts`, `tile-fit.ts`, `table-view.ts`, their tests, `workout-table.md` and three reviews as *deleted*. `git merge-tree` against main conflicts in `docs/design/design-system.md`. The library's components were renumbered to `9.74 WorkoutRow` … `9.80 ChangeReviewCard per-line checks` (`design-system.md:1012-1024`). Main's Table took the same numbers: `9.74 ExerciseCard` … `9.80 RestBar`.
- Failure scenario: if the PM lands this branch as reviewed (fast-forward, or a reset onto it), the workout Table is lost. A normal merge stops on the conflict. Even if the conflict is resolved, two components share every number from 9.74 to 9.80, and specs cite the numbers. The combined code has never been typechecked or tested either: `workout-services.ts`, `domain/src/index.ts`, `WorkoutScreen.tsx` and `active-view.ts` auto-merge with the library's overview, fit and target-RPE changes.
- Fix: merge `claude/gracious-knuth-joxqpw` into the branch again. Renumber the library's seven components to 9.81–9.87 and update every reference (routines.md, overview-today-edits.md, fit-to-time.md, the index in §11 and the revision note). Then re-run typecheck, lint, the full suite and `check:migrations`.

**B2. A coach reorder Apply is refused, and the proposal half-applied, when today's draft has an added exercise.**
- Code: `apps/mobile/src/services/app-services.ts:546-557` writes each structural op through `overview.edit`. The coach's `order` edit lists only the basis slots (`coach-service.ts:414-421`, routine slots). `today-edits.ts:323-329` (`applyDraftCommand`, `edit` → `order`) then requires `validOrder(e.slotKeys, todayGroups)`, where `slotsNow = allSlots()` *includes* Ben's added slots (`today-edits.ts:256-258`: `order.length === keys.length`). So the write is `invalid: bad_order`. In contrast, `resolveTodayEdits` already handles a stored order that lacks added keys (`normaliseOrder`, `today-edits.ts:672-678`, which appends them).
- Failure scenario (reproduced with real SQLite through the app services):
  1. Ben opens next Push A and adds Dumbbell bench (§11 `add`), or asks for a coach fit that adds an exercise.
  2. He then asks the coach to "drop the pushdown next time and do laterals first" and taps Apply.
  3. On the next overview load the skip is written but the reorder is refused. The card reads `Couldn't apply here` (state `not_here`) and the toast says `Coach change didn't fit here`, while half the proposal *is* live in today's plan.
  
  This is a new interaction from the merge: main's draft had no `add` kind. It breaks the merge note's claim that "Overview edits accept the coach's `order`". Rule 2 says a proposal applies as one change with Undo, and rule 1 says status is shown honestly; here neither holds.
- Fix (either part alone is enough; both is better):
  - In `applyDraftCommand`'s `order` branch, normalise like `resolveTodayEdits` does: append live added keys missing from the order before `validOrder`. Or have `applyCoachChanges` append the draft's added slot keys to a structural `order` edit.
  - Make a structural Apply all-or-nothing per apply (write its edits in one draft write, or undo the ones written when a later one is refused).
  
  Add a service test: an added exercise, then a coach remove + reorder Apply. Expect both edits shown and `coachRefused: 0`. Add a second case where one op is genuinely refused and check that no partial apply is left behind.

## Should fix

**S1. `Save to Workouts` drops distance exercises without saying so (main's distance sets × library save).**
- `packages/domain/src/session/routines.ts:127-128` (`routineFromSession`) and `packages/domain/src/session/library.ts:391` (`routineFromPlan`) skip any set with `reps === null && durationS === null`. A sled push or carry logged as distance only gets no templates, so the whole exercise is left out (`templates.length === 0 → continue`). A distance set that also has a time is saved as a *timed* template instead.
- Scenario: Ben finishes Legs with a sled push and taps `Save to Workouts`. The sheet says `5 exercises`, and the saved Legs has no sled push and no note. Repeat on main reports this case (`Not copied: 3 distance sets (Sled push)`, `repeat.ts` `notCopiedText`, review gaps S4).
- Fix: return the left-out list from both builders and show it on the save sheet's detail line with the same `notCopiedText` wording. Never turn a distance set into a timed template. Add tests for both builders.

**S2. The coach's target RPE replaces the routine's own effort target even when the coach set none (`17d27c1`).**
- `routines.ts:494-496` uses `coachPlan.rpe` whenever it is non-null. `withCoachTargets` (`next-session.ts:345`) fills `rpe` with `row.target.rpe ?? template?.rpe`, which is the *built-in plan's* RPE for the source session. So on a coach-load slot with no coach RPE, whenever that plan carries an RPE, the routine template's `targetRpe` is overwritten by it and labelled as going "with the coach's load". WL7 as recorded says the coach's *own* target RPE goes with its load.
- Fix: carry `row.target.rpe` separately (for example `coach.rpe`) and use only that. Add a test: a routine template with `targetRpe: 7`, and a coach target with a load but no RPE. The set should keep 7.

**S3. The full-suite run includes a timing-budget flake (`progress-perf.test.ts`).**
It passes alone. This isn't caused by this branch, but it appears in every merge review. Running the perf files in their own `vitest` project (or `--pool=forks` serially in CI) would stop masking real failures.

## Nits

**N1.** `0012-today-fit.ts` and `drafts.test.ts:583` don't compare a migrated-from-11 schema dump with a fresh one directly. The 10→12 test in `deleted-workouts-edges.test.ts` does, so coverage exists. A one-line pointer in the migration 12 describe would help the next reader.

**N2.** `startFenceIn` (`drafts.ts:843`) runs two `COUNT(*)` subqueries on every coach-fit write. That's fine at Ben's scale. An index on `purged_sessions (owner_id)` exists only through `purged_sessions_op (owner_id, purge_op_id)`, which serves it, so nothing to do beyond noting it.

**N3.** `coach-structural-library.test.ts` covers remove + reorder. It doesn't cover swap on a library slot that has Ben's `sets`/`reps` edit. Ben's 4 × 6–8 then applies to the swapped-in exercise, the same as his own swap. A test would pin this down.

## Feature parity (no feature lost on either side), merge resolutions

- `duration.ts`: one estimator. `planPace` = `resolvePace(empty, recentPaceSamples(recent))`, and `estimateRemainingDuration({pace})` uses `estimatePendingWork`. The fit tests' figures were updated (54.42 min). OK.
- `routineFromSession`: `isInHistory` (main: deleted and discarded workouts are excluded) plus imported sources with `Auto` loads (library). OK.
- `next-session.ts`: main's `rpe: row.target.rpe ?? …` plus the library's WL7 `coach` metadata. OK (see S2 for the routine side).
- Coach `claims.ts`, `executors.ts`, `render.ts`, `persistence/coach.ts`: `fit_today` added next to main's `log_set`, `correct_set` and `suggest_memory`. The generic Undo returns `unsupported` for `fit_today`, which has its own versioned `drafts.undoCoachFit`. OK.
- `structural.ts`: `DraftEditLike` takes the library's `add`, `sets`, `reps`, `load` and `fit` as never-coach edits. OK. The order write path is B2.
- Session picker: `upNext`, `YOUR WORKOUTS`, `FROM HISTORY`, `OLDER` (WL4) replace SP-D3's single list. session-picker.md has the revision note. Tests that assumed "save adds to rotation" now pass `addToRotation: true` explicitly, which matches WL6 (not a weakened assertion).
- Summary and Past workouts: one `⋯` menu with Save to Workouts and Delete workout. OK.
- Lost by being behind: main's workout Table (B1).

## Rules 1–10 and minimal copy

- Rule 1: the built-in trim and `Clear fit` are offline. `Ask coach` is disabled with `Coach offline` when unavailable (`coachFitAvailable` reads settings only). The coach-refused toast is short and honest, but see B2.
- Rule 2: completed sets aren't touched. A coach fit skips only pending sets (`skippedBy: 'before_start'`). Structural changes go through Apply/Undo, and the template changes only through `Update Push A` (Ben's `update_routine` record, `revert` as Undo).
- Rule 3: WL7 and FT6 are implemented as now recorded. The coach fit runs only when Ben taps `Ask coach`.
- Rules 4 and 9: the fit and structural checks reuse snap, equipment and pain guards (`validateTodayFit`, `checkStructuralProposal`).
- Rule 5: draft writes are versioned and op-ID idempotent. The start fence plus the cancel check makes a late coach fit write nothing. Structural applies use one op ID per change.
- Rule 6: minutes are always `≈` from the one estimator.
- Rules 7 and 8: no credentials or imported content in this diff.
- Rule 10: the fit request sends today's plan, pain flags and equipment kinds in `YOUR DATA` only. Library data is exported with routines.
- Minimal copy: one new Why-only allowance (`Worked out when you start`, behind ⓘ). `LIBRARY_COPY` strings are short. `minimal-copy.test.ts` passes.

## Ben's decisions recorded

`6e1e057` records WL7, FT6 and N6 in `docs/brief/CHANGELOG.md` (2026-10-12), routines.md WL7/§A7.1, fit-to-time.md FT6/§10, ADR 0006 and ADR 0022 notes. "Pending Ben" is removed for these three, and N13 stays open. The entry says the answers were "relayed by the PM session at the merge with main". I can't verify Ben's consent from the repo. The record is consistent and cites its source, which is all a reviewer can check.

## Spec issues

1. **Brief §7 still says `shortenSession` "proposes".** FT6 resolves this in the CHANGELOG in favour of rule 3, but the brief body isn't amended. A reader of §7 alone will build an Apply step. Suggest that the next brief revision edits §7, or adds the item to the v0.2 summary at the top.
2. **Design-system numbering is assigned per branch.** B1 is the third merge to need a renumber (the Progress components took 9.69–9.73 the same way). Suggest that the designer reserves a block per branch in design-system §11, or switches to named anchors instead of sequential numbers.
