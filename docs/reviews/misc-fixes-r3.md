VERDICT: PASS

# Review r3: misc fixes, perf lane split and distance sets in Progress (claude/misc-fixes)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/misc-fixes` (29 files). This round focuses on `bdf332f`, which
addresses r2 S1 and S2. The earlier rounds are `docs/reviews/misc-fixes.md` and `docs/reviews/misc-fixes-r2.md`.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=180000`: exit 0. 242 files, 4560 passed, 1 todo. No `*.perf.test.ts` file ran in
  this suite.
- `npm run test:perf`: exit 0. 7 files and 8 tests passed, run serially, with the same budgets as before.

## r2 findings

| r2 | Status |
|---|---|
| S1 Panel `Best` and StatStrip disagree at equal metres | **Fixed.** `better()` (`packages/domain/src/progress/exercise.ts:472-480`) now takes a `distanceKey`, which is only set for `best_distance` on a distance series (`:502`). At equal metres the heavier `seriesLoadValue` wins, and equal load keeps the earlier point. This matches `sessionBestDistance` (`:312-320`) and `exerciseHeadline` (`:705-708`), including the treatment of off-unit or off-convention loads as 0. Range best (`:544`) and weekly points (`:530`) both use it. The non-distance tie rule is unchanged. |
| S2 progress.md missing Change copy and tie-break | **Fixed.** §6.3 now states "longer, then heavier" for the StatStrip, the panel and the weekly points, and gives the `Same distance, N kg more/less [each] than <date>` copy. Check 38a adds the 1 Sep / 1 Oct scenario in both orders. |
| N1–N7 | Not addressed. All are still nits and are carried forward below. |
| SP1 | Still open for Ben. |

The new tests (`packages/domain/test/progress-distance.test.ts:403-447`) cover these cases:

- Panel and StatStrip agreement with the heavier set second and with it first.
- Equal metres and equal load keep the earlier set.
- A longer distance beats a heavier load.
- 90 weeks of weekly-best points, with the heavier set alternating between Monday and Thursday.

These cover r2 S1 directly.

## Perf lane: re-verified

The perf lane config hasn't changed since r2:

- `vitest.config.ts` excludes `*.perf.test.ts`.
- `vitest.perf.config.ts` includes only those files and runs them serially.
- The `perf` CI job is `continue-on-error`, and nothing `needs:` it.
- `check` still runs `npm test`, and `build` still `needs: check`.
- `perf-lane.test.ts` guards both directions.

## Blocking

None.

## Should fix

None.

## Nits

All of these are carried from r2.

- **N1.** The Change line for a plate-loaded sled reads `40 kg more`, not `kg plates` (`exercise-view.ts:631`).
- **N2.** An assisted convention isn't excluded from the distance load delta or the new tie-break. More assistance
  would read as `more`/up and win a tie. This is unlikely for distance work.
- **N3.** An off-unit set can be the StatStrip or panel best, but it is left out of the `BEST DISTANCE` table.
- **N4.** An all-`No load` `BEST DISTANCE` table on an unloaded series is deliberate, but progress.md doesn't say so.
- **N5.** The axis reads `m` while the values switch to `km` at 1,000 m.
- **N6.** The history unit for a sled reads `kg added × m`.
- **N7.** `repAll` is shared between `RepTable` and the distance table.

## Spec issues

- **SP1 (open, from r1).** For unilateral carries, `Total distance` counts only the busier side, so 40 m left plus
  40 m right reads `40 m`. Ben to decide: sum both sides, or rename the metric.
